import { NextResponse } from 'next/server'
import { authenticate } from '@/lib/apiAuth'
import { query } from '@/lib/db'
import { markFolderRead, emptyFolder, folderMessageCount } from '@/lib/imap'
import { resolveFolder } from '@/lib/folderResolve'
import { refuse } from '@/lib/folderActions'

export const dynamic = 'force-dynamic'

/**
 * Actions that touch a folder's CONTENT, not its structure: "mark all as read" and
 * "empty". Permission is decided in `lib/folderActions.ts` through `resolveFolder` —
 * "empty" only exists for the trash and the spam folder, whatever the client asks
 * for.
 */
const ACTIONS = ['markRead', 'empty', 'count'] as const
type Action = (typeof ACTIONS)[number]

/** The permission each action requires — same vocabulary as `lib/accountAccess.ts`. */
const REQUIRED = { markRead: 'organize', empty: 'delete', count: undefined } as const

export async function POST(req: Request) {
  const authCtx = await authenticate(req)
  if (!authCtx) return refuse('unauthorized')

  let body: Record<string, unknown> = {}
  try {
    const parsed = await req.json()
    if (parsed && typeof parsed === 'object') body = parsed as Record<string, unknown>
  } catch { /* body missing or unreadable — treated as an unknown action */ }

  const action = body.action as Action
  if (!ACTIONS.includes(action)) return refuse('unknownAction')

  const accountId = typeof body.accountId === 'string' ? body.accountId : null
  const path = typeof body.path === 'string' ? body.path : null

  try {
    const needed = REQUIRED[action]
    const ctx = await resolveFolder(accountId, authCtx.id, path, needed ? [needed] : [])
    if (!ctx?.folder) return refuse('notFound')

    if (action === 'count') {
      return NextResponse.json({ data: { count: await folderMessageCount(ctx.config, ctx.folder.path) } })
    }

    if (!ctx.can[action]) return refuse('forbidden')

    if (action === 'markRead') {
      await markFolderRead(ctx.config, ctx.folder.path)
      await query('UPDATE messages_cache SET is_read = true WHERE account_id = $1 AND folder = $2', [ctx.account.id, ctx.folder.path])
      await query('UPDATE mailbox_stats SET unread_count = 0 WHERE account_id = $1 AND folder = $2', [ctx.account.id, ctx.folder.path])
      return NextResponse.json({ data: { path: ctx.folder.path, unreadCount: 0 } })
    }

    const removed = await emptyFolder(ctx.config, ctx.folder.path)
    await query('DELETE FROM messages_cache WHERE account_id = $1 AND folder = $2', [ctx.account.id, ctx.folder.path])
    await query('UPDATE mailbox_stats SET unread_count = 0 WHERE account_id = $1 AND folder = $2', [ctx.account.id, ctx.folder.path])
    return NextResponse.json({ data: { path: ctx.folder.path, removed } })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
