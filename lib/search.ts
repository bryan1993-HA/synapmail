/**
 * Mail search: single source of the contract, shared by the app
 * bar (which writes), the message list (which reads) and the API.
 *
 * The search state lives in the mailbox URL (`/mail?q=…&scope=…`): a
 * single field drives it, a reload preserves it, and no component
 * keeps a copy of it that could diverge.
 */
import { MAIL_PATH } from './compose'

export const SEARCH_PARAM = 'q'
export const SCOPE_PARAM = 'scope'
export const SCOPE_FOLDER = 'folder'
export const SCOPE_ALL = 'all'
export type SearchScope = typeof SCOPE_FOLDER | typeof SCOPE_ALL

/** Below this, IMAP would return the whole mailbox: the search stays inactive. */
export const MIN_QUERY_LENGTH = 2
/** Keystroke -> request: same delay as the old field in the list. */
export const SEARCH_DEBOUNCE_MS = 400
/**
 * Maximum number of results returned PER FOLDER queried. Beyond that, the response
 * carries the total number of matches (`total`) and the interface says so.
 * ponytail: 50 -> 200 because an address search on a real mailbox commonly
 * exceeds 50 without saying so; going further would require paginating the
 * search (cursor over the UIDs), not a higher cap.
 */
export const SEARCH_RESULT_LIMIT = 200

/**
 * The fields queried by a search, in the order the interface names them.
 * Single source: the server builds its IMAP query with them, the interface says
 * which one with the same translation keys (`searchField.<champ>`).
 *
 * The message BODY is NOT in there, and that is not an oversight: measured
 * on a consumer-grade server, both `BODY` and `TEXT` return 0
 * results in 2.5 s, and adding them to the `OR` drops the ENTIRE `OR` to 0.
 * Do not put anything back in without having measured it on the target server.
 */
export const SEARCH_FIELDS = ['from', 'to', 'cc', 'subject'] as const
export type SearchField = typeof SEARCH_FIELDS[number]

/** The mailbox "/" shortcut gives focus to the field in the bar. */
export const SEARCH_FOCUS_EVENT = 'synapmail:focus-search'

export function focusSearch() {
  window.dispatchEvent(new CustomEvent(SEARCH_FOCUS_EVENT))
}

export function isSearchQuery(q: string | null | undefined): boolean {
  return (q?.trim().length ?? 0) >= MIN_QUERY_LENGTH
}

export function readScope(raw: string | null | undefined): SearchScope {
  return raw === SCOPE_ALL ? SCOPE_ALL : SCOPE_FOLDER
}

/**
 * Builds the mailbox URL carrying the search, preserving the other
 * parameters already present (the current folder, notably).
 */
export function buildSearchHref(current: string | URLSearchParams, q: string, scope: SearchScope): string {
  const params = new URLSearchParams(current)
  const trimmed = q.trim()
  if (trimmed) params.set(SEARCH_PARAM, trimmed)
  else params.delete(SEARCH_PARAM)
  if (trimmed && scope === SCOPE_ALL) params.set(SCOPE_PARAM, SCOPE_ALL)
  else params.delete(SCOPE_PARAM)
  const qs = params.toString()
  return qs ? `${MAIL_PATH}?${qs}` : MAIL_PATH
}

/**
 * Splits a query into TERMS, all required (AND): "3d cpi" finds the messages
 * where "3d" AND "cpi" each appear in at least one field, in any
 * order, whereas the previous version searched for the substring "3d cpi".
 *
 * - an expression between quotes stays ONE exact substring: the input `"3d cpi"`;
 * - multiple spaces and case have no effect;
 * - a term shorter than MIN_QUERY_LENGTH characters is ignored (IMAP would return
 *   the whole mailbox); between quotes, it is kept as is if it is non-empty;
 * - an unclosed quote closes at the end of the string.
 *
 * PURE function: no network access, no state; its executable self-check
 * is `scripts/check-search-parse.mjs`.
 */
export function parseQuery(q: string | null | undefined): string[] {
  const terms: string[] = []
  const seen = new Set<string>()
  const add = (raw: string, quoted: boolean) => {
    const term = raw.trim()
    if (!term) return
    if (!quoted && term.length < MIN_QUERY_LENGTH) return
    const key = term.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    terms.push(term)
  }
  // A single scan: on each quote we toggle between "words separated by
  // spaces" and "a single expression". No regular expression to remember.
  let buffer = ''
  let quoted = false
  for (const ch of q ?? '') {
    if (ch === '"') { add(buffer, quoted); buffer = ''; quoted = !quoted; continue }
    if (!quoted && /\s/.test(ch)) { add(buffer, false); buffer = ''; continue }
    buffer += ch
  }
  add(buffer, quoted)
  return terms
}

/**
 * What an "all folders" search knows about a folder before opening it:
 * its path, its possible role (`\Inbox`, `\Sent`… via SPECIAL-USE), its message
 * count (LIST-STATUS, a single round trip) and the date of the most
 * recent message the local cache knows of.
 */
export type FolderRank = {
  path: string
  specialUse?: string | null
  messages?: number | null
  lastKnownDate?: string | null
}

/**
 * Privileged roles, in order: these are the folders where what one is looking for
 * is found nine times out of ten, hence the ones a progressive search must return
 * FIRST in order to be useful before having covered everything.
 */
const PRIORITY_SPECIAL_USE = ['\\Inbox', '\\Sent'] as const

/**
 * Orders the folders by USEFULNESS for a progressive search: privileged
 * roles first (inbox then sent), then the folders whose local cache
 * knows the most recent message (a live folder is worth more than a
 * 2019 archive), the rest next by decreasing message count, and the
 * EMPTY folders discarded: opening them costs a round trip for zero possible
 * result.
 *
 * PURE function: it touches neither the network nor the database, its self-check is
 * `scripts/check-search-order.mjs`.
 *
 * ponytail: a sort, not an index. As long as opening a folder costs ~300 ms
 * (measured on a consumer-grade server), the order is enough to make the first results useful;
 * only a measured need for "everything, right now" would justify a local index.
 */
export function orderFoldersForSearch(folders: FolderRank[]): string[] {
  const rank = (f: FolderRank): number => {
    const special = PRIORITY_SPECIAL_USE.indexOf(f.specialUse as typeof PRIORITY_SPECIAL_USE[number])
    if (special >= 0) return special
    return PRIORITY_SPECIAL_USE.length
  }
  const freshness = (f: FolderRank): number => {
    const t = f.lastKnownDate ? Date.parse(f.lastKnownDate) : NaN
    return Number.isNaN(t) ? -Infinity : t
  }
  return folders
    // `messages` absent = unknown, so kept: only a measured ZERO discards a folder.
    .filter(f => f.messages !== 0)
    .slice()
    .sort((a, b) =>
      rank(a) - rank(b) ||
      freshness(b) - freshness(a) ||
      (b.messages ?? 0) - (a.messages ?? 0) ||
      a.path.localeCompare(b.path))
    .map(f => f.path)
}

/**
 * Parameter by which the client asks for PROGRESSIVE delivery: the response
 * is then a sequence of JSON lines (NDJSON), one per folder covered, instead
 * of a single object delivered at the end. The contract of the final object is identical,
 * which leaves the "this folder" scope and any machine call unchanged.
 */
export const STREAM_PARAM = 'stream'

/** One line of the progressive response: one folder covered, what it brings back. */
export type SearchStreamChunk<TMessage> = {
  messages: TMessage[]
  total: number
  folder: string
  /** Folders covered so far / folders to cover: "312 of 1 226". */
  searched: number
  folders: number
}

/**
 * Splits an NDJSON stream into objects, keeping the incomplete line of one chunk
 * for the next. PURE function (it reads no stream): it is given the received
 * text and the previous remainder, and returns the complete objects and the new remainder.
 * Self-check: `scripts/check-search-order.mjs`.
 */
export function parseNdjsonChunk<T>(pending: string, received: string): { items: T[]; pending: string } {
  const lines = (pending + received).split('\n')
  // The last slice is followed by no line break: it may be cut off.
  const rest = lines.pop() ?? ''
  const items: T[] = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try { items.push(JSON.parse(trimmed) as T) } catch { /* line truncated by a cut: ignored */ }
  }
  return { items, pending: rest }
}

/** The accumulated state of a progressive search on the client side. */
export type SearchStreamState<TMessage> = {
  messages: TMessage[]
  total: number
  searched: number
  folders: number
}

/** A message returned by the search, reduced to what the accumulation needs. */
type StreamedMessage = { folder: string; uid: number | string; date: string }

export const EMPTY_SEARCH_STREAM: SearchStreamState<never> = {
  messages: [], total: 0, searched: 0, folders: 0,
}

/**
 * Adds the received NDJSON lines to the current state: deduplicates by folder+uid
 * (the same message can come back if a folder is covered twice), sorts from most
 * recent to oldest, and CAPS at `SEARCH_RESULT_LIMIT`, the same cap as
 * the two non-streamed paths of the route. Without this cap, a broad query
 * would return thousands of rows in a non-virtualized list, and `total >
 * messages.length` would never be true: the banner would never say
 * "first X of N".
 *
 * PURE function: it reads no stream and does not mutate the received state. Self-check:
 * `scripts/check-search-order.mjs`.
 */
export function accumulateSearchStream<TMessage extends StreamedMessage>(
  prev: SearchStreamState<TMessage>,
  items: (Partial<SearchStreamChunk<TMessage>> & { error?: string })[]
): SearchStreamState<TMessage> {
  const seen = new Set(prev.messages.map(m => `${m.folder}#${m.uid}`))
  const next = [...prev.messages]
  let { total, searched, folders } = prev
  for (const item of items) {
    if (item.error) continue
    for (const m of item.messages ?? []) {
      const key = `${m.folder}#${m.uid}`
      if (seen.has(key)) continue
      seen.add(key)
      next.push(m)
    }
    total += item.total ?? 0
    searched = Math.max(searched, item.searched ?? 0)
    folders = Math.max(folders, item.folders ?? 0)
  }
  next.sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
  return { messages: next.slice(0, SEARCH_RESULT_LIMIT), total, searched, folders }
}
