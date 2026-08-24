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

// Strip Re:/Fwd:/etc. prefixes recursively
function normalizeSubject(subject: string): string {
  return subject
    .replace(/^(Re|Rép|Fwd|Fw|TR|AW|SV|VS):\s*/gi, '')
    .trim()
}

export async function GET(req: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const rawSubject = searchParams.get('subject')
  const folder = searchParams.get('folder') ?? 'INBOX'
  const accountParam = searchParams.get('account')

  if (!rawSubject) {
    return NextResponse.json({ messages: [] })
  }

  const normalizedSubject = normalizeSubject(rawSubject)

  if (!normalizedSubject || normalizedSubject.length < 2) {
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

    // Search IMAP for messages matching the normalized subject
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
      normalizedSubject
    )

    // Filter to only messages that have the same normalized subject
    const filtered = messages.filter(m =>
      normalizeSubject(m.subject).toLowerCase() === normalizedSubject.toLowerCase()
    )

    // Sort oldest first
    filtered.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())

    return NextResponse.json({
      messages: filtered.map(m => ({ ...m, accountId: account.id }))
    })
  } catch (err) {
    return NextResponse.json({ error: String(err), messages: [] }, { status: 500 })
  }
}
