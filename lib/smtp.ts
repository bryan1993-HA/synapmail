import nodemailer from 'nodemailer'
import { decrypt } from './encrypt'

interface SmtpConfig {
  smtpHost: string
  smtpPort: number
  smtpSecure: boolean
  username: string
  passwordEncrypted: string
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
  attachments?: Array<{
    filename: string
    content: Buffer | string
    contentType: string
  }>
}

export async function sendMail(config: SmtpConfig, options: SendMailOptions): Promise<void> {
  const password = decrypt(config.passwordEncrypted)
  const transporter = nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpSecure,
    auth: { user: config.username, pass: password },
  })

  await transporter.verify()
  await transporter.sendMail({
    from: options.from,
    to: options.to.join(', '),
    cc: options.cc?.join(', '),
    bcc: options.bcc?.join(', '),
    subject: options.subject,
    html: options.html,
    text: options.text,
    inReplyTo: options.inReplyTo,
    references: options.references,
    attachments: options.attachments,
  })
}

export async function verifySmtp(config: SmtpConfig): Promise<boolean> {
  try {
    const password = decrypt(config.passwordEncrypted)
    const transporter = nodemailer.createTransport({
      host: config.smtpHost,
      port: config.smtpPort,
      secure: config.smtpSecure,
      auth: { user: config.username, pass: password },
    })
    await transporter.verify()
    return true
  } catch {
    return false
  }
}
