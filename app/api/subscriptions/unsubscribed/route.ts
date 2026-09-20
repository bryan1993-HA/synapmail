import { NextResponse } from 'next/server'
import { authenticate } from '@/lib/apiAuth'
import { getAccessibleAccount } from '@/lib/accountAccess'
import { guardApiPayload, isMachineRequest } from '@/lib/promptGuard'
import { accessibleAccountIds, listUnsubscribed } from '@/lib/subscriptions'

export const dynamic = 'force-dynamic'

// GET /api/subscriptions/unsubscribed[?account=<id>]
// The lists already left, newest first. Bearer or session, SAME access rule as
// GET /api/subscriptions (read access is an active share or ownership).
//
// It OUTLIVES the cleaning: once the messages are filed away with
// /api/messages/bulk the group is gone from GET /api/subscriptions, but its
// entry stays here — that is how an agent knows not to start over.
export async function GET(req: Request) {
  const authCtx = await authenticate(req)
  if (!authCtx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const accountId = new URL(req.url).searchParams.get('account')

  // Named mailbox: the same single-account check every other route uses.
  // No mailbox named: every one this user may read, and nothing else.
  let accountIds: string[]
  let guarded: boolean
  if (accountId) {
    const account = await getAccessibleAccount(accountId, authCtx.id, [])
    if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 })
    accountIds = [account.id]
    guarded = account.prompt_guard
  } else {
    accountIds = await accessibleAccountIds(authCtx.id)
    // Across mailboxes the strictest setting wins: one guarded mailbox in the
    // set is enough for the whole answer to travel guarded.
    guarded = await anyGuarded(accountIds)
  }

  const data = await listUnsubscribed(accountIds)
  // A sender's name is content written by a third party, exactly as in the list.
  return NextResponse.json(guardApiPayload({ data }, { enabled: isMachineRequest(req) && guarded }))
}

async function anyGuarded(accountIds: string[]): Promise<boolean> {
  if (!accountIds.length) return false
  const { query } = await import('@/lib/db')
  const rows = await query<{ any: boolean }>(
    'SELECT bool_or(prompt_guard) AS any FROM email_accounts WHERE id = ANY($1::uuid[])',
    [accountIds]
  )
  return !!rows[0]?.any
}
