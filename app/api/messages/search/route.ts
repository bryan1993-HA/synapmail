import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { query } from '@/lib/db'
import { searchMessages } from '@/lib/imap'

export const dynamic = 'force-dynamic'

type AccountRow = {
  id: string; imap_host: string; imap_port: number; imap_secure: boolean;
  username: string; password_encrypted: string;
  oauth_provider: string | null; oauth_access_token: string | null;
  oauth_refresh_token: string | null; oauth_expires_at: number | null;
}

export async function GET(req: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const q = searchParams.get('q')?.trim()
  const folder = searchParams.get('folder') ?? 'INBOX'
  const accountParam = searchParams.get('account')

  if (!q || q.length < 2) {
    return NextResponse.json({ messages: [] })
  }

  try {
    let sql: string
    let values: unknown[]

    if (accountParam) {
      sql = 'SELECT * FROM email_accounts WHERE id = $1 AND user_id = $2 LIMIT 1'
      values = [accountParam, session.user?.id]
    } else {
      sql = `SELECT * FROM email_accounts WHERE user_id = $1 ORDER BY is_default DESC, created_at ASC LIMIT 1`
      values = [session.user?.id]
    }

    const accounts = await query<AccountRow>(sql, values)
    if (!accounts.length) {
      return NextResponse.json({ messages: [], error: 'No account configured' })
    }

    const account = accounts[0]
    const messages = await searchMessages(
      {
        id: account.id,
        imapHost: account.imap_host,
        imapPort: account.imap_port,
        imapSecure: account.imap_secure,
        username: account.username,
        passwordEncrypted: account.password_encrypted,
        oauthProvider: account.oauth_provider,
        oauthAccessToken: account.oauth_access_token,
        oauthRefreshToken: account.oauth_refresh_token,
        oauthExpiresAt: account.oauth_expires_at,
      },
      folder,
      q
    )

    return NextResponse.json({ messages: messages.map(m => ({ ...m, accountId: account.id })) })
  } catch (err) {
    return NextResponse.json({ error: String(err), messages: [] }, { status: 500 })
  }
}
