import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { query } from '@/lib/db'
import { encrypt } from '@/lib/encrypt'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const accounts = await query(
      `SELECT id, name, email,
              imap_host AS "imapHost", imap_port AS "imapPort", imap_secure AS "imapSecure",
              smtp_host AS "smtpHost", smtp_port AS "smtpPort", smtp_secure AS "smtpSecure",
              username, is_default AS "isDefault", color,
              oauth_provider AS "oauthProvider", created_at AS "createdAt"
       FROM email_accounts WHERE user_id = $1 ORDER BY is_default DESC, created_at ASC`,
      [session.user?.id]
    )
    return NextResponse.json({ data: accounts })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await req.json()
    const {
      name, email, imapHost, imapPort, imapSecure,
      smtpHost, smtpPort, smtpSecure, username, password,
      isDefault = false, color = '#6366f1',
    } = body

    if (!name || !email || !imapHost || !smtpHost || !username || !password) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const passwordEncrypted = encrypt(password)

    if (isDefault) {
      await query(
        'UPDATE email_accounts SET is_default = false WHERE user_id = $1',
        [session.user?.id]
      )
    }

    const result = await query(
      `INSERT INTO email_accounts
        (user_id, name, email, imap_host, imap_port, imap_secure,
         smtp_host, smtp_port, smtp_secure, username, password_encrypted, is_default, color)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING id, name, email, imap_host, imap_port, imap_secure,
                 smtp_host, smtp_port, smtp_secure, username, is_default, color, created_at`,
      [
        session.user?.id, name, email,
        imapHost, imapPort ?? 993, imapSecure ?? true,
        smtpHost, smtpPort ?? 587, smtpSecure ?? false,
        username, passwordEncrypted, isDefault, color,
      ]
    )

    return NextResponse.json({ data: result[0] }, { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
