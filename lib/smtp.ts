import nodemailer from 'nodemailer'
import { decrypt } from './encrypt'
import { refreshAccessToken } from './msOAuth'
import { query } from './db'
import { htmlToText, wrapHtmlDocument } from './html'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const MailComposer = require('nodemailer/lib/mail-composer') as new (opts: Record<string, unknown>) => {
  compile(): { build(cb: (err: Error | null, buf: Buffer) => void): void }
}

interface SmtpConfig {
  id?: string
  smtpHost: string
  smtpPort: number
  smtpSecure: boolean
  username: string
  passwordEncrypted: string
  oauthProvider?: string | null
  oauthAccessToken?: string | null
  oauthRefreshToken?: string | null
  oauthExpiresAt?: number | null
}

export interface SendMailOptions {
  from: string
  to: string[]
  cc?: string[]
  bcc?: string[]
  subject: string
  html?: string
  text?: string
  inReplyTo?: string
  references?: string
  dispositionNotificationTo?: string
  attachments?: Array<{
    filename: string
    content: Buffer | string
    contentType: string
  }>
}

async function getSmtpAuth(config: SmtpConfig) {
  if (config.oauthProvider && config.oauthAccessToken) {
    let accessToken = config.oauthAccessToken
    const expiresAt = config.oauthExpiresAt ?? 0
    if (Date.now() > expiresAt - 60_000 && config.oauthRefreshToken) {
      const refreshed = await refreshAccessToken(config.oauthRefreshToken)
      accessToken = refreshed.accessToken
      if (config.id) {
        await query(
          'UPDATE email_accounts SET oauth_access_token = $1, oauth_expires_at = $2 WHERE id = $3',
          [accessToken, refreshed.expiresAt, config.id]
        )
      }
    }
    return { type: 'OAuth2' as const, user: config.username, accessToken }
  }
  return { user: config.username, pass: decrypt(config.passwordEncrypted) }
}

export async function sendMail(config: SmtpConfig, options: SendMailOptions): Promise<{ messageId: string; raw: Buffer }> {
  const auth = await getSmtpAuth(config)
  const transporter = nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpSecure,
    auth,
    tls: { rejectUnauthorized: false },
  })

  // Ensure outgoing HTML is a full document (avoids SpamAssassin HTML_MIME_NO_HTML_TAG)
  // and derive a text/plain fallback (avoids MIME_HTML_ONLY flag).
  const finalHtml = options.html ? wrapHtmlDocument(options.html) : undefined
  const finalText = options.text ?? (options.html ? htmlToText(options.html) : undefined)

  const mailOptions = {
    from: options.from,
    to: options.to.join(', '),
    cc: options.cc?.join(', '),
    bcc: options.bcc?.join(', '),
    subject: options.subject,
    html: finalHtml,
    text: finalText,
    inReplyTo: options.inReplyTo,
    references: options.references,
    attachments: options.attachments,
    headers: options.dispositionNotificationTo
      ? { 'Disposition-Notification-To': options.dispositionNotificationTo }
      : undefined,
  }

  // Build raw MIME buffer for IMAP append to Sent folder
  const raw = await new Promise<Buffer>((resolve, reject) => {
    new MailComposer(mailOptions as Record<string, unknown>).compile().build(
      (err: Error | null, buf: Buffer) => err ? reject(err) : resolve(buf)
    )
  })

  await transporter.verify()
  const info = await transporter.sendMail(mailOptions)
  return { messageId: info.messageId, raw }
}

export async function verifySmtp(config: SmtpConfig): Promise<boolean> {
  try {
    const auth = await getSmtpAuth(config)
    const transporter = nodemailer.createTransport({
      host: config.smtpHost,
      port: config.smtpPort,
      secure: config.smtpSecure,
      auth,
      tls: { rejectUnauthorized: false },
    })
    await transporter.verify()
    return true
  } catch {
    return false
  }
}
