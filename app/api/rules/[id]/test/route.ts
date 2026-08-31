/**
 * POST /api/rules/[id]/test
 * Preview which messages in a folder would be matched by the rule.
 * Does NOT execute any actions — read-only.
 */
import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { getRuleById, testRule } from '@/lib/rules'
import { listMessages } from '@/lib/imap'
import { query } from '@/lib/db'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } }

export async function POST(req: Request, { params }: Ctx) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { folder = 'INBOX', limit = 50 } = await req.json().catch(() => ({}))

    const rule = await getRuleById(params.id, session.user!.id!)
    if (!rule) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // Load account
    const accounts = await query<{
      id: string; imap_host: string; imap_port: number; imap_secure: boolean;
      username: string; password_encrypted: string;
      oauth_provider: string | null; oauth_access_token: string | null;
      oauth_refresh_token: string | null; oauth_expires_at: number | null;
    }>(
      'SELECT * FROM email_accounts WHERE id = $1 AND user_id = $2 LIMIT 1',
      [rule.accountId, session.user!.id]
    )
    if (!accounts.length) return NextResponse.json({ error: 'Account not found' }, { status: 404 })

    const account = accounts[0]
    const accountConfig = {
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
    }

    // Fetch messages (first page, large limit for test)
    const perPage = Math.min(Number(limit), 200)
    const result = await listMessages(accountConfig, folder, 1, perPage, 'all', session.user!.id!)

    const matched = testRule(result.messages, rule)

    return NextResponse.json({
      data: {
        matched: matched.map(m => ({
          uid: m.uid,
          from: m.from,
          subject: m.subject,
          date: m.date,
          isRead: m.isRead,
          folder: m.folder,
        })),
        total: result.total,
        scanned: result.messages.length,
      },
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
