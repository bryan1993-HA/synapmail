/**
 * POST /api/rules/run
 * Apply all enabled rules for an account to messages in a given folder.
 * Body: { accountId, folder?, page? }
 */
import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { getEnabledRulesForAccount, applyRulesToMessages } from '@/lib/rules'
import { listMessages } from '@/lib/imap'
import { query } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { accountId, folder = 'INBOX', page = 1, perPage = 50 } = await req.json()

    if (!accountId) return NextResponse.json({ error: 'accountId required' }, { status: 400 })

    // Verify account ownership
    const accounts = await query<{
      id: string; imap_host: string; imap_port: number; imap_secure: boolean;
      username: string; password_encrypted: string;
      oauth_provider: string | null; oauth_access_token: string | null;
      oauth_refresh_token: string | null; oauth_expires_at: number | null;
    }>(
      'SELECT * FROM email_accounts WHERE id = $1 AND user_id = $2 LIMIT 1',
      [accountId, session.user!.id]
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

    // Load enabled rules for this account
    const rules = await getEnabledRulesForAccount(accountId)
    if (!rules.length) {
      return NextResponse.json({ data: { processed: 0, matched: 0, results: [] } })
    }

    // Fetch messages
    const safePerPage = Math.min(Number(perPage), 200)
    const result = await listMessages(
      accountConfig,
      folder,
      Number(page),
      safePerPage,
      'all',
      session.user!.id!
    )

    // Apply rules
    const ruleResults = await applyRulesToMessages(
      accountConfig,
      folder,
      result.messages,
      rules
    )

    return NextResponse.json({
      data: {
        processed: result.messages.length,
        matched: ruleResults.length,
        results: ruleResults,
      },
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
