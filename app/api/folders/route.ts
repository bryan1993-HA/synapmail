import { NextResponse } from 'next/server'
import { authenticate } from '@/lib/apiAuth'
import { query } from '@/lib/db'
import { getAccessibleAccount } from '@/lib/accountAccess'
import { listFolders, createFolder, renameFolder, deleteFolder } from '@/lib/imap'
import { sanitizeFolderName, joinFolderPath, renamedPath, rewritePath, samePath, isDescendant, refuse } from '@/lib/folderActions'
import { resolveFolder } from '@/lib/folderResolve'
import { detectSpecials } from '@/lib/specialFolders'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const authCtx = await authenticate(req)
  if (!authCtx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const accountId = searchParams.get('account')

  try {
    type AccountRow = {
      id: string; imap_host: string; imap_port: number; imap_secure: boolean;
      username: string; password_encrypted: string;
      oauth_provider: string | null; oauth_access_token: string | null;
      oauth_refresh_token: string | null; oauth_expires_at: number | null;
    }

    let account: AccountRow | null
    if (accountId) {
      account = await getAccessibleAccount(accountId, authCtx.id, [])
    } else {
      const rows = await query<AccountRow>(
        'SELECT * FROM email_accounts WHERE user_id = $1 ORDER BY is_default DESC, created_at ASC LIMIT 1',
        [authCtx.id]
      )
      account = rows[0] ?? null
    }

    if (!account) return NextResponse.json({ data: [] })
    const folders = await listFolders({
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
    })

    // Filter out Outlook system/technical folders
    const SYSTEM_KEYWORDS = [
      'sync issues', 'problèmes de synchronisation', 'synchronisation',
      'server failures', 'défaillances du serveur',
      'local failures', 'défaillances locales',
      'conflicts', 'conflits',
      'partages compte', 'sharing',
      'outbox',
      'calendar', 'contacts', 'tasks', 'journal', 'notes',
      'conversation history', 'quick step',
      'clutter', 'rss', 'social updates',
    ]

    const isSystemFolder = (path: string, name: string) => {
      const p = path.toLowerCase()
      const n = name.toLowerCase()
      return SYSTEM_KEYWORDS.some(kw => p.includes(kw) || n.includes(kw))
    }

    const specials = detectSpecials(folders)
    const normalized = folders
      .filter(f => !isSystemFolder(f.path, f.name))
      .map(f => ({
        name: f.name,
        path: f.path,
        // The server's delimiter: without it the client cannot tell which folder sits
        // UNDER which other one — and "delete" must refuse to run on a parent.
        delimiter: f.delimiter ?? '/',
        special: specials.get(f.path) ?? null,
      }))

    // Sort: special folders first (in order), then alphabetical
    const specialOrder = ['inbox', 'sent', 'drafts', 'spam', 'trash']
    normalized.sort((a, b) => {
      const ai = a.special ? specialOrder.indexOf(a.special) : 999
      const bi = b.special ? specialOrder.indexOf(b.special) : 999
      if (ai !== bi) return ai - bi
      return a.name.localeCompare(b.name)
    })

    // Unread counts — prefer the authoritative SEARCH UNSEEN value in
    // mailbox_stats (not capped by page size), fall back to counting cached rows
    // for folders that have not been synced through listMessages yet.
    const statsRows = await query<{ folder: string; unread_count: number }>(
      `SELECT folder, unread_count FROM mailbox_stats WHERE account_id = $1`,
      [account.id]
    )
    const statsMap = Object.fromEntries(statsRows.map(r => [r.folder, r.unread_count]))

    const unreadRows = await query<{ folder: string; unread_count: string }>(
      `SELECT folder, COUNT(*) as unread_count FROM messages_cache WHERE account_id = $1 AND is_read = false GROUP BY folder`,
      [account.id]
    )
    const unreadMap = Object.fromEntries(unreadRows.map(r => [r.folder, parseInt(r.unread_count)]))

    const withCounts = normalized.map(f => ({
      ...f,
      unreadCount: statsMap[f.path] ?? unreadMap[f.path] ?? 0,
    }))

    return NextResponse.json({ data: withCounts })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

/**
 * Folder mutations. Permission is NOT decided here: `resolveFolder` evaluates
 * `lib/folderActions.ts` against the facts reported by the IMAP server, and this route
 * only rejects (403) what was refused there and runs the rest. A path the server does
 * not know about never reaches IMAP.
 */
async function readBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json()
    return body && typeof body === 'object' ? body as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

const asString = (v: unknown) => (typeof v === 'string' && v ? v : null)

// POST — creates a folder at the root, or under `parent` when one is supplied.
export async function POST(req: Request) {
  const authCtx = await authenticate(req)
  if (!authCtx) return refuse('unauthorized')

  const body = await readBody(req)
  const parent = asString(body.parent)

  try {
    const ctx = await resolveFolder(asString(body.accountId), authCtx.id, parent, ['organize'])
    if (!ctx) return refuse('notFound')
    if (!(parent ? ctx.can.createChild : ctx.can.create)) return refuse('forbidden')

    const name = sanitizeFolderName(body.name, ctx.delimiter)
    if (!name) return refuse('badName')
    const path = joinFolderPath(parent ?? '', name, ctx.delimiter)
    if (ctx.folders.some(f => samePath(f.path, path))) return refuse('exists')

    await createFolder(ctx.config, path)
    return NextResponse.json({ data: { path, name } })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// PATCH — renames a folder in place (it stays under its current parent).
export async function PATCH(req: Request) {
  const authCtx = await authenticate(req)
  if (!authCtx) return refuse('unauthorized')

  const body = await readBody(req)

  try {
    const ctx = await resolveFolder(asString(body.accountId), authCtx.id, asString(body.path), ['organize'])
    if (!ctx?.folder) return refuse('notFound')
    if (!ctx.can.rename) return refuse('forbidden')

    const name = sanitizeFolderName(body.name, ctx.delimiter)
    if (!name) return refuse('badName')
    const from = ctx.folder.path
    const path = renamedPath(from, name, ctx.delimiter)
    if (path === from) return NextResponse.json({ data: { path, name } })
    if (ctx.folders.some(f => samePath(f.path, path))) return refuse('exists')

    await renameFolder(ctx.config, from, path)
    // IMAP renames the WHOLE subtree: the cache follows the same path, otherwise the
    // subfolder rows stay orphaned under the old prefix (wrong unread counts).
    for (const moved of ctx.folders.filter(f => f.path === from || isDescendant(f.path, from, ctx.delimiter))) {
      const to = rewritePath(moved.path, from, path, ctx.delimiter)
      await query('UPDATE messages_cache SET folder = $1 WHERE account_id = $2 AND folder = $3', [to, ctx.account.id, moved.path])
      await query('UPDATE mailbox_stats SET folder = $1 WHERE account_id = $2 AND folder = $3', [to, ctx.account.id, moved.path])
    }
    return NextResponse.json({ data: { path, name } })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// DELETE — removes a folder (never a special one, never a parent).
export async function DELETE(req: Request) {
  const authCtx = await authenticate(req)
  if (!authCtx) return refuse('unauthorized')

  const { searchParams } = new URL(req.url)

  try {
    const ctx = await resolveFolder(searchParams.get('account'), authCtx.id, searchParams.get('path'), ['delete'])
    if (!ctx?.folder) return refuse('notFound')
    if (!ctx.can.remove) return refuse('forbidden')

    await deleteFolder(ctx.config, ctx.folder.path)
    await query('DELETE FROM messages_cache WHERE account_id = $1 AND folder = $2', [ctx.account.id, ctx.folder.path])
    await query('DELETE FROM mailbox_stats WHERE account_id = $1 AND folder = $2', [ctx.account.id, ctx.folder.path])
    return NextResponse.json({ data: { path: ctx.folder.path } })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
