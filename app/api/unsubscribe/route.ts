import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { query } from '@/lib/db'
import { sendMail } from '@/lib/smtp'

export const dynamic = 'force-dynamic'

type AccountRow = {
  id: string
  email: string
  smtp_host: string
  smtp_port: number
  smtp_secure: boolean
  username: string
  password_encrypted: string
  oauth_provider: string | null
  oauth_access_token: string | null
  oauth_refresh_token: string | null
  oauth_expires_at: number | null
}

// POST /api/unsubscribe
// Body: { accountId, to, subject }
// Sends an unsubscribe email via the account's SMTP (for mailto: List-Unsubscribe)
export async function POST(req: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { accountId, to, subject } = await req.json() as {
    accountId: string
    to: string
    subject?: string
  }

  if (!accountId || !to) {
    return NextResponse.json({ error: 'Missing params' }, { status: 400 })
  }

  const accounts = await query<AccountRow>(
    'SELECT * FROM email_accounts WHERE id = $1 AND user_id = $2 LIMIT 1',
    [accountId, session.user?.id]
  )
  if (!accounts.length) return NextResponse.json({ error: 'Account not found' }, { status: 404 })

  const account = accounts[0]
  try {
    await sendMail(
      {
        id: account.id,
        smtpHost: account.smtp_host,
        smtpPort: account.smtp_port,
        smtpSecure: account.smtp_secure,
        username: account.username,
        passwordEncrypted: account.password_encrypted,
        oauthProvider: account.oauth_provider,
        oauthAccessToken: account.oauth_access_token,
        oauthRefreshToken: account.oauth_refresh_token,
        oauthExpiresAt: account.oauth_expires_at,
      },
      {
        from: account.email,
        to: [to],
        subject: subject ?? 'unsubscribe',
        text: 'unsubscribe',
      }
    )
    return NextResponse.json({ data: { success: true } })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
