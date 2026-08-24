import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { ImapFlow } from 'imapflow'
import nodemailer from 'nodemailer'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { imapHost, imapPort, imapSecure, smtpHost, smtpPort, smtpSecure, username, password } = await req.json()

    if (!imapHost || !smtpHost || !username || !password) {
      return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
    }

    // Test IMAP
    let imapOk = false
    let imapError = ''
    try {
      const client = new ImapFlow({
        host: imapHost,
        port: Number(imapPort) || 993,
        secure: imapSecure ?? true,
        auth: { user: username, pass: password },
        logger: false,
        tls: { rejectUnauthorized: false },
      })
      await client.connect()
      await client.logout()
      imapOk = true
    } catch (e) {
      imapError = String(e instanceof Error ? e.message : e)
    }

    // Test SMTP
    let smtpOk = false
    let smtpError = ''
    try {
      const transport = nodemailer.createTransport({
        host: smtpHost,
        port: Number(smtpPort) || 587,
        secure: smtpSecure ?? false,
        auth: { user: username, pass: password },
        tls: { rejectUnauthorized: false },
      })
      await transport.verify()
      smtpOk = true
    } catch (e) {
      smtpError = String(e instanceof Error ? e.message : e)
    }

    return NextResponse.json({ imap: { ok: imapOk, error: imapError }, smtp: { ok: smtpOk, error: smtpError } })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
