import { NextResponse } from 'next/server'
import { authenticate } from '@/lib/apiAuth'
import { getAccessibleAccount } from '@/lib/accountAccess'
import { MAX_UNSUBSCRIBE_BATCH, imapConfigOf, smtpConfigOf, unsubscribeGroups } from '@/lib/subscriptions'

export const dynamic = 'force-dynamic'

// POST /api/subscriptions/unsubscribe
// Body: { account: string, ids: string[], folder?: string }
// Bearer or session, SAME access rule as sending a message (`send`): leaving a
// list either posts to the sender's endpoint or sends a mail from this mailbox.
//
// The client NEVER sends a URL or an address: the server re-reads the headers of
// each group's most recent message and decides from them alone.
export async function POST(req: Request) {
  const authCtx = await authenticate(req)
  if (!authCtx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => null)) as
    | { account?: string; ids?: unknown; folder?: string }
    | null
  const accountId = body?.account
  const ids = Array.isArray(body?.ids) ? body.ids.filter((v): v is string => typeof v === 'string') : []
  const folder = body?.folder ?? 'INBOX'

  if (!accountId || !ids.length) {
    return NextResponse.json({ error: 'account and ids are required' }, { status: 400 })
  }
  if (ids.length > MAX_UNSUBSCRIBE_BATCH) {
    return NextResponse.json(
      { error: `ids must hold at most ${MAX_UNSUBSCRIBE_BATCH} entries` },
      { status: 400 }
    )
  }

  const account = await getAccessibleAccount(accountId, authCtx.id, ['send'])
  if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 })

  try {
    const data = await unsubscribeGroups({
      imap: imapConfigOf(account),
      smtp: smtpConfigOf(account),
      accountId: account.id,
      from: account.email,
      folder,
      ids,
    })
    return NextResponse.json({ data })
  } catch (err) {
    console.error('[/api/subscriptions/unsubscribe] error:', String(err))
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
