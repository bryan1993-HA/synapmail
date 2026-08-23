import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { query } from '@/lib/db'
import { sendMail } from '@/lib/smtp'

export async function POST(req: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await req.json()
    const { accountId, from, to, cc, bcc, subject, html, text, inReplyTo, references } = body

    if (!to?.length || !subject) {
      return NextResponse.json({ error: 'Missing required fields (to, subject)' }, { status: 400 })
    }

    const accounts = await query<{
      id: string; smtp_host: string; smtp_port: number; smtp_secure: boolean;
      username: string; password_encrypted: string;
    }>(
      accountId
        ? 'SELECT * FROM email_accounts WHERE id = $1 AND user_id = $2 LIMIT 1'
        : 'SELECT * FROM email_accounts WHERE user_id = $1 AND is_default = true LIMIT 1',
      accountId ? [accountId, session.user?.id] : [session.user?.id]
    )

    if (!accounts.length) return NextResponse.json({ error: 'No account found' }, { status: 404 })

    const account = accounts[0]
    await sendMail(
      {
        smtpHost: account.smtp_host,
        smtpPort: account.smtp_port,
        smtpSecure: account.smtp_secure,
        username: account.username,
        passwordEncrypted: account.password_encrypted,
      },
      { from, to, cc, bcc, subject, html, text, inReplyTo, references }
    )

    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
