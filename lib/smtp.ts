import nodemailer from 'nodemailer'
import { decrypt } from './encrypt'
import { refreshAccessToken } from './msOAuth'
import { query } from './db'

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

// Wrap a bare HTML fragment (e.g. Tiptap output) in a complete document so the
// message is not "HTML-only with no <html> tag" (SpamAssassin HTML_MIME_NO_HTML_TAG).
function wrapHtmlDocument(html: string): string {
  if (/<html[\s>]/i.test(html)) return html
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${html}</body></html>`
}

// Derive a reasonable text/plain version from HTML so the message is multipart
// (MIME_HTML_ONLY otherwise). Not a full renderer — just readable fallback text.
function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

export async function sendMail(config: SmtpConfig, options: SendMailOptions): Promise<{ messageId: string }> {
  const auth = await getSmtpAuth(config)
  const transporter = nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpSecure,
    auth,
  })

  // Ensure a full HTML document + a text/plain alternative for deliverability.
  const html = options.html ? wrapHtmlDocument(options.html) : undefined
  const text = options.text ?? (options.html ? htmlToText(options.html) : undefined)

  await transporter.verify()
  const info = await transporter.sendMail({
    from: options.from,
    to: options.to.join(', '),
    cc: options.cc?.join(', '),
    bcc: options.bcc?.join(', '),
    subject: options.subject,
    html,
    text,
    inReplyTo: options.inReplyTo,
    references: options.references,
    attachments: options.attachments,
    headers: options.dispositionNotificationTo
      ? { 'Disposition-Notification-To': options.dispositionNotificationTo }
      : undefined,
  })
  return { messageId: info.messageId }
}

export async function verifySmtp(config: SmtpConfig): Promise<boolean> {
  try {
    const auth = await getSmtpAuth(config)
    const transporter = nodemailer.createTransport({
      host: config.smtpHost,
      port: config.smtpPort,
      secure: config.smtpSecure,
      auth,
    })
    await transporter.verify()
    return true
  } catch {
    return false
  }
}
