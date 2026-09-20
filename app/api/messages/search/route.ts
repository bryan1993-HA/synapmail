import { NextResponse } from 'next/server'
import { authenticate } from '@/lib/apiAuth'
import { query } from '@/lib/db'
import { getAccessibleAccount } from '@/lib/accountAccess'
import { listFolders, listFoldersRanked, searchMessagesByFolder, searchMessagesIn } from '@/lib/imap'
import { guardApiPayload, isMachineRequest } from '@/lib/promptGuard'
import { MIN_QUERY_LENGTH, SCOPE_ALL, SCOPE_PARAM, SEARCH_FIELDS, SEARCH_PARAM, SEARCH_RESULT_LIMIT, STREAM_PARAM, parseQuery, readScope } from '@/lib/search'

export const dynamic = 'force-dynamic'

type AccountRow = {
  id: string; imap_host: string; imap_port: number; imap_secure: boolean;
  username: string; password_encrypted: string; prompt_guard: boolean;
  oauth_provider: string | null; oauth_access_token: string | null;
  oauth_refresh_token: string | null; oauth_expires_at: number | null;
}

export async function GET(req: Request) {
  const authCtx = await authenticate(req)
  if (!authCtx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const q = searchParams.get(SEARCH_PARAM)?.trim()
  const folder = searchParams.get('folder') ?? 'INBOX'
  const accountParam = searchParams.get('account')
  const scope = readScope(searchParams.get(SCOPE_PARAM))

  // A query only means something through its TERMS: "a b" carries none that is long
  // enough, and searching for "a b" as-is would return the whole mailbox.
  const terms = parseQuery(q)
  if (!q || q.length < MIN_QUERY_LENGTH || terms.length === 0) {
    return NextResponse.json({ messages: [], total: 0, fields: SEARCH_FIELDS })
  }

  try {
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
      return NextResponse.json({ messages: [], total: 0, fields: SEARCH_FIELDS, error: 'No account configured' })
    }
    const config = {
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

    // `scope=all` + `stream=1`: the response is sent folder by folder (NDJSON), in the
    // usefulness order returned by listFoldersRanked — the first results appear within a
    // second instead of waiting for full coverage (measured: 101 folders, ~300 ms each).
    if (scope === SCOPE_ALL && searchParams.get(STREAM_PARAM)) {
      const ranked = await listFoldersRanked(config)
      const guard = { enabled: isMachineRequest(req) && account.prompt_guard }
      const accountId = account.id
      const encoder = new TextEncoder()
      // A single abort signal for BOTH ways a search can stop: the request being cut off
      // (`req.signal`) and the stream being dropped by the client, which is only reported
      // through `cancel()`. Without it, leaving the search left the IMAP workers opening
      // all remaining folders for nobody.
      const sweep = new AbortController()
      req.signal.addEventListener('abort', () => sweep.abort(), { once: true })
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          try {
            for await (const chunk of searchMessagesByFolder(config, ranked, terms, sweep.signal)) {
              if (sweep.signal.aborted) break
              const payload = guardApiPayload({
                messages: chunk.messages
                  .slice()
                  .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
                  .slice(0, SEARCH_RESULT_LIMIT)
                  .map(m => ({ ...m, accountId })),
                total: chunk.total,
                fields: SEARCH_FIELDS,
                folder: chunk.folder,
                searched: chunk.searched,
                folders: chunk.folders,
              }, guard)
              controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`))
            }
          } catch (err) {
            // An already-aborted stream has no recipient left: reporting the error on a
            // closed controller would raise a second failure, with nobody to read it.
            if (!sweep.signal.aborted) {
              controller.enqueue(encoder.encode(`${JSON.stringify({ error: String(err) })}\n`))
            }
          } finally {
            controller.close()
          }
        },
        // The client turned away (query changed, page left, Stop button): the remaining
        // folders are not opened and the IMAP connections are closed.
        cancel() { sweep.abort() },
      })
      return new Response(stream, {
        headers: {
          'Content-Type': 'application/x-ndjson; charset=utf-8',
          'Cache-Control': 'no-store, no-transform',
        },
      })
    }

    // Single-shot response: the "this folder" scope (one folder only, so nothing to
    // spread out) and every machine call, whose contract stays unchanged.
    const folders = scope === SCOPE_ALL
      ? (await listFolders(config)).map(f => f.path)
      : [folder]
    const { messages, total } = await searchMessagesIn(config, folders, terms)
    messages.sort((a, b) => Date.parse(b.date) - Date.parse(a.date))

    // `total` = ACTUAL matches (count of identifiers), `messages` = what was returned.
    // The UI derives "the first 200 out of 1,340" from both numbers.
    return NextResponse.json(guardApiPayload({
      messages: messages.slice(0, SEARCH_RESULT_LIMIT).map(m => ({ ...m, accountId: account.id })),
      total,
      fields: SEARCH_FIELDS,
    }, { enabled: isMachineRequest(req) && account.prompt_guard }))
  } catch (err) {
    return NextResponse.json({ error: String(err), messages: [], total: 0, fields: SEARCH_FIELDS }, { status: 500 })
  }
}
