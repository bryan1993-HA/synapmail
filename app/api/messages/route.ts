import { NextResponse } from 'next/server'
import type { MailListFilter } from '@/lib/flags'
import { authenticate } from '@/lib/apiAuth'
import { query } from '@/lib/db'
import { getAccessibleAccount } from '@/lib/accountAccess'
import { listMessages } from '@/lib/imap'
import { guardApiPayload, isMachineRequest } from '@/lib/promptGuard'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const authCtx = await authenticate(req)
  if (!authCtx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const folder = searchParams.get('folder') ?? 'INBOX'
  const page = parseInt(searchParams.get('page') ?? '1')
  const perPage = parseInt(searchParams.get('perPage') ?? '30')
  const filter = (searchParams.get('filter') ?? 'all') as MailListFilter
  const accountParam = searchParams.get('account')

  try {
    type AccountRow = {
      id: string; imap_host: string; imap_port: number; imap_secure: boolean;
      username: string; password_encrypted: string; prompt_guard: boolean;
      oauth_provider: string | null; oauth_access_token: string | null;
      oauth_refresh_token: string | null; oauth_expires_at: number | null;
    }

    let account: AccountRow | null
    if (accountParam) {
      account = await getAccessibleAccount(accountParam, authCtx.id, [])
    } else {
      const rows = await query<AccountRow>(
        `SELECT * FROM email_accounts WHERE user_id = $1 ORDER BY is_default DESC, created_at ASC LIMIT 1`,
        [authCtx.id]
      )
      account = rows[0] ?? null
    }

    if (!account) {
      return NextResponse.json({ messages: [], total: 0, error: 'No account configured' })
    }
    const result = await listMessages(
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
      page,
      perPage,
      filter,
      authCtx.id
    )

    result.messages = result.messages.map(m => ({ ...m, accountId: account.id }))

    // Hide snoozed messages until their wake time (scheduler drops expired rows).
    const snoozed = await query<{ uid: string }>(
      `SELECT uid FROM snoozed_messages
       WHERE account_id = $1 AND folder = $2 AND snooze_until > now()`,
      [account.id, folder]
    )
    if (snoozed.length) {
      const hidden = new Set(snoozed.map(s => s.uid))
      const before = result.messages.length
      result.messages = result.messages.filter(m => !hidden.has(m.uid))
      result.total = Math.max(0, result.total - (before - result.messages.length))
    }

    // Mail content is untrusted input: an agent reading this response is warned,
    // a browser session keeps the historical payload (see lib/promptGuard.ts).
    return NextResponse.json(guardApiPayload(result, {
      enabled: isMachineRequest(req) && account.prompt_guard,
    }))
  } catch (err) {
    console.error('[/api/messages] IMAP error:', String(err))
    return NextResponse.json({ error: String(err), messages: [], total: 0 }, { status: 500 })
  }
}
