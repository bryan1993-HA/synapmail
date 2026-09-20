/**
 * Newsletter subscriptions — list them per sender, unsubscribe in one call.
 *
 * Reads HEADERS ONLY (`From`, `List-Id`, `List-Unsubscribe`,
 * `List-Unsubscribe-Post`, date, subject): the body of a message is never read
 * here and never logged.
 *
 * Everything that parses or decides lives in pure functions so it can be
 * measured without a network and without a mailbox; the two IMPURE doors
 * (DNS resolution and the outgoing HTTPS request) are injected.
 *
 * `lib/imap.ts` is NOT modified here: only `createClient` is imported. Its own
 * `List-Unsubscribe` reading (single line, `^list-unsubscribe:`) loses a folded
 * header's continuation lines; that is left untouched rather than fixed from here.
 */
import crypto from 'node:crypto'
import dns from 'node:dns/promises'
import https from 'node:https'
import type { AccountConfig } from './imap'

/**
 * How many of the most recent messages of the folder are scanned for
 * subscription headers. One constant, used by the route and by the bench.
 * Chosen to cover a few weeks of a busy mailbox while staying a single
 * header-only IMAP fetch; the measured duration on the staging mailbox is
 * recorded in PROGRESS.md.
 */
export const RECENT_MESSAGES_SCANNED = 400

/** Hard ceiling of ids accepted by one unsubscribe call. */
export const MAX_UNSUBSCRIBE_BATCH = 50

/**
 * Deadline of ONE outgoing one-click request, milliseconds.
 *
 * Sized together with `UNSUBSCRIBE_CONCURRENCY` so a full batch of
 * `MAX_UNSUBSCRIBE_BATCH` ids that all time out still answers well inside the
 * 60 s most nginx proxies allow: ceil(50 / 8) * 3 s = 21 s. One command must
 * give one answer — a 504 would leave unsubscribes running with nobody reading
 * the report. Measured by the `unsubscribe batch` check of
 * `scripts/check-subscriptions.mjs`, with a requester that never answers.
 */
export const UNSUBSCRIBE_TIMEOUT_MS = 3000

/** How many groups are left at the same time. See `UNSUBSCRIBE_TIMEOUT_MS`. */
export const UNSUBSCRIBE_CONCURRENCY = 8

/** The exact body RFC 8058 requires for a one-click unsubscribe. */
export const ONE_CLICK_BODY = 'List-Unsubscribe=One-Click'
export const ONE_CLICK_CONTENT_TYPE = 'application/x-www-form-urlencoded'

/** How a group can be left. `link` is never automated — see `unsubscribeOneClick`. */
export type UnsubscribeMethod = 'one-click' | 'mailto' | 'link'

/** Outcome of one requested id. Names are part of the API contract. */
export type UnsubscribeOutcome = 'done' | 'manual' | 'failed' | 'not_found'

/** Why the network boundary refused an address or a URL. Part of the contract. */
export const REFUSAL_REASONS = [
  'not-https',
  'no-address',
  'private-address',
  'unresolvable',
  'redirect-not-followed',
  'http-status',
  'transport',
  'timeout',
] as const
export type RefusalReason = (typeof REFUSAL_REASONS)[number]

export interface EmailAddress {
  name: string
  address: string
}

/** One message's subscription-relevant headers, already parsed. */
export interface SubscriptionHeaders {
  from: EmailAddress
  listId?: string
  uris: UnsubscribeUris
  oneClick: boolean
  date: string
  subject: string
  uid: string
}

export interface Subscription {
  id: string
  sender: EmailAddress
  listId?: string
  count: number
  lastDate: string
  lastSubject: string
  lastUid: string
  method: UnsubscribeMethod
  unsubscribedAt: string | null
  /** The folder these UIDs belong to — an UID means nothing without it. */
  folder: string
  /**
   * Every UID of this group INSIDE the window that was read. An agent files or
   * deletes them with the existing `PATCH`/`DELETE /api/messages/bulk`: there is
   * no cleaning route here and no copy of their logic.
   */
  uids: string[]
}

// ---------------------------------------------------------------------------
// Header parsing (RFC 5322 unfolding, RFC 2369 / 8058 values)
// ---------------------------------------------------------------------------

/**
 * Unfolds a raw header block and indexes it by lower-case field name. A field
 * may legitimately appear several times, so every occurrence is kept in order.
 *
 * Folding (RFC 5322 §2.2.3): a continuation line starts with a space or a tab
 * and belongs to the field above it. Reading only the first line — as
 * `lib/imap.ts` does — drops a URI that the sender wrapped onto the next line.
 */
export function unfoldHeaders(raw: string): Map<string, string[]> {
  const fields = new Map<string, string[]>()
  let name: string | null = null
  let value = ''
  const flush = () => {
    if (!name) return
    const list = fields.get(name) ?? []
    list.push(value.trim())
    fields.set(name, list)
    name = null
    value = ''
  }
  for (const line of raw.split(/\r?\n/)) {
    if (/^[ \t]/.test(line)) {
      // Continuation: the fold itself is whitespace, so one space is enough.
      if (name) value += ` ${line.trim()}`
      continue
    }
    flush()
    const sep = line.indexOf(':')
    if (sep > 0) {
      name = line.slice(0, sep).trim().toLowerCase()
      value = line.slice(sep + 1)
    }
  }
  flush()
  return fields
}

/** First occurrence of a field, unfolded. */
export function headerValue(fields: Map<string, string[]>, name: string): string | undefined {
  return fields.get(name.toLowerCase())?.[0]
}

export interface UnsubscribeUris {
  https: string[]
  mailto: string[]
  /**
   * Plain-http pages. KEPT so the sender still appears in the list — dropping
   * them made a whole sender vanish, and a list an agent cannot see is worse
   * than one it cannot automate. Never requested by the server: the boundary
   * refuses `http` (`not-https`), so these only ever travel as a `manual` link
   * for a human to open.
   */
  http: string[]
}

/**
 * Every URI of a `List-Unsubscribe` value. The field carries one or more URIs
 * between angle brackets, comma-separated (RFC 2369): `<https://…>, <mailto:…>`.
 * Anything that is neither https, mailto nor http is dropped here.
 */
export function parseUnsubscribeUris(value: string | undefined): UnsubscribeUris {
  const uris: UnsubscribeUris = { https: [], mailto: [], http: [] }
  if (!value) return uris
  for (const m of Array.from(value.matchAll(/<([^<>]+)>/g))) {
    const uri = m[1].trim()
    if (/^https:\/\//i.test(uri)) uris.https.push(uri)
    else if (/^mailto:/i.test(uri)) uris.mailto.push(uri)
    else if (/^http:\/\//i.test(uri)) uris.http.push(uri)
  }
  return uris
}

/** RFC 8058: one-click is offered only when the POST field says exactly so. */
export function isOneClick(postHeader: string | undefined, uris: UnsubscribeUris): boolean {
  if (!uris.https.length) return false
  return /list-unsubscribe\s*=\s*one-click/i.test(postHeader ?? '')
}

/** `Name <addr@host>` or a bare address. */
export function parseAddress(value: string | undefined): EmailAddress {
  const raw = (value ?? '').trim()
  const angled = raw.match(/^(.*)<([^<>]+)>\s*$/)
  if (angled) {
    return {
      name: angled[1].trim().replace(/^"(.*)"$/, '$1').trim(),
      address: angled[2].trim().toLowerCase(),
    }
  }
  return { name: '', address: raw.toLowerCase() }
}

/** The address that identifies a mailto unsubscribe, without its parameters. */
export function mailtoAddress(uri: string): string | null {
  const target = uri.replace(/^mailto:/i, '').split('?')[0].trim()
  const decoded = (() => {
    try {
      return decodeURIComponent(target)
    } catch {
      return target
    }
  })()
  return /^[^\s@,<>"]+@[^\s@,<>"]+\.[^\s@,<>"]+$/.test(decoded) ? decoded.toLowerCase() : null
}

/** The `subject=` parameter of a mailto URI, when the list asks for one. */
export function mailtoSubject(uri: string): string | undefined {
  const qs = uri.split('?')[1]
  if (!qs) return undefined
  const value = new URLSearchParams(qs).get('subject')?.trim()
  return value || undefined
}

/**
 * The grouping key of a message: its list identity when the sender declares one
 * (`List-Id`, stable across a sender's address rotations), else its From address.
 */
export function groupingKey(h: Pick<SubscriptionHeaders, 'listId' | 'from'>): string {
  const listId = h.listId?.trim().toLowerCase()
  if (listId) {
    // `List-Id: Some name <list.example.com>` — the bracketed identifier is the stable part.
    const bracketed = listId.match(/<([^<>]+)>/)?.[1]
    return `list:${(bracketed ?? listId).trim()}`
  }
  // Lower-cased here too, not only in `parseAddress`: the key must not depend on
  // who built the address (a caller may hand one straight from a database row).
  return `from:${h.from.address.trim().toLowerCase()}`
}

/**
 * Stable, opaque id of a group: the same mailbox and the same key always give
 * the same id, and the id reveals neither the address nor the account.
 */
export function subscriptionId(accountId: string, key: string): string {
  return crypto.createHash('sha256').update(`${accountId}\u0000${key}`).digest('hex').slice(0, 24)
}

/** Parses one message's raw header block. Returns null when no unsubscribe route exists. */
export function parseSubscriptionHeaders(uid: string, raw: string): SubscriptionHeaders | null {
  const fields = unfoldHeaders(raw)
  const uris = parseUnsubscribeUris(headerValue(fields, 'list-unsubscribe'))
  if (!uris.https.length && !uris.mailto.length && !uris.http.length) return null
  return {
    uid,
    from: parseAddress(headerValue(fields, 'from')),
    listId: headerValue(fields, 'list-id'),
    uris,
    oneClick: isOneClick(headerValue(fields, 'list-unsubscribe-post'), uris),
    date: headerValue(fields, 'date') ?? '',
    subject: headerValue(fields, 'subject') ?? '',
  }
}

/** The method a group offers, most automatic first. */
export function methodOf(h: Pick<SubscriptionHeaders, 'oneClick' | 'uris'>): UnsubscribeMethod {
  if (h.oneClick) return 'one-click'
  if (h.uris.mailto.length) return 'mailto'
  return 'link'
}

/** The page a `link` group offers a human, https preferred over plain http. */
export function manualUrl(h: Pick<SubscriptionHeaders, 'uris'>): string | undefined {
  return h.uris.https[0] ?? h.uris.http[0]
}

/**
 * Groups messages per list, newest message first inside a group, groups sorted
 * by decreasing count. The newest message of a group is the one whose headers a
 * later unsubscribe re-reads — the client never sends a URL or an address.
 */
export function groupSubscriptions(
  accountId: string,
  headers: SubscriptionHeaders[],
  unsubscribedAt: Map<string, string> = new Map(),
  folder = 'INBOX'
): Subscription[] {
  const groups = new Map<string, { key: string; newest: SubscriptionHeaders; uids: string[] }>()
  for (const h of headers) {
    const key = groupingKey(h)
    const existing = groups.get(key)
    if (!existing) {
      groups.set(key, { key, newest: h, uids: [h.uid] })
      continue
    }
    existing.uids.push(h.uid)
    if (dateRank(h.date) > dateRank(existing.newest.date)) existing.newest = h
  }
  return Array.from(groups.values())
    .map(({ key, newest, uids }) => ({
      id: subscriptionId(accountId, key),
      sender: newest.from,
      ...(newest.listId ? { listId: newest.listId } : {}),
      // `count` is exactly `uids.length`: one number, one list, never two truths.
      count: uids.length,
      lastDate: newest.date,
      lastSubject: newest.subject,
      lastUid: newest.uid,
      method: methodOf(newest),
      unsubscribedAt: unsubscribedAt.get(key) ?? null,
      folder,
      uids,
    }))
    .sort((a, b) => b.count - a.count || a.sender.address.localeCompare(b.sender.address))
}

function dateRank(date: string): number {
  const t = Date.parse(date)
  return Number.isNaN(t) ? 0 : t
}

// ---------------------------------------------------------------------------
// Network boundary — the server is about to call a URL written by a stranger
// ---------------------------------------------------------------------------

/** One resolved address. `family` is 4 or 6, as `dns.lookup` reports it. */
export interface ResolvedAddress {
  address: string
  family: number
}

/** Injectable resolver, so the refusal battery runs without a network. */
export type AddressResolver = (hostname: string) => Promise<ResolvedAddress[]>

const defaultResolver: AddressResolver = async hostname => {
  const all = await dns.lookup(hostname, { all: true, verbatim: true })
  return all.map(a => ({ address: a.address, family: a.family }))
}

/**
 * True for an address nobody outside this network should be able to make the
 * server talk to: loopback, private ranges, link-local, carrier-grade NAT,
 * `0/8`, multicast and above, plus their IPv6 counterparts and an IPv4 address
 * smuggled inside IPv6.
 */
export function isPrivateAddress(address: string): boolean {
  const ip = address.trim().toLowerCase().replace(/^\[|\]$/g, '')
  const mapped = ip.match(/^(?:::ffff:|::)(\d{1,3}(?:\.\d{1,3}){3})$/)
  if (mapped) return isPrivateAddress(mapped[1])
  const v6mapped = ip.match(/^(?:::ffff:)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
  if (v6mapped) {
    const [hi, lo] = v6mapped.slice(1).map(h => parseInt(h, 16))
    return isPrivateAddress([hi >> 8, hi & 0xff, lo >> 8, lo & 0xff].join('.'))
  }
  if (ip.includes(':')) {
    if (ip === '::' || ip === '::1') return true
    if (/^f[cd][0-9a-f]{2}:/.test(ip)) return true // fc00::/7 unique-local
    if (/^fe[89ab][0-9a-f]:/.test(ip)) return true // fe80::/10 link-local
    if (/^ff[0-9a-f]{2}:/.test(ip)) return true // ff00::/8 multicast
    return false
  }
  const parts = ip.split('.')
  if (parts.length !== 4) return true // not an address we can vouch for
  const [a, b] = parts.map(n => Number(n))
  if (parts.some(p => !/^\d{1,3}$/.test(p)) || parts.some(p => Number(p) > 255)) return true
  if (a === 0 || a === 127) return true
  if (a === 10) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 169 && b === 254) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  if (a >= 224) return true // multicast, reserved, broadcast
  return false
}

export type UrlDecision =
  | { ok: true; url: URL; address: ResolvedAddress }
  | { ok: false; reason: RefusalReason }

/**
 * Decides whether the server may call this URL, and WHICH address it will
 * connect to. https only; every resolved address must be public — one private
 * address among several refuses the whole name, so a DNS answer that mixes a
 * public and a private address cannot smuggle the request inside.
 */
export async function decideUrl(raw: string, resolve: AddressResolver = defaultResolver): Promise<UrlDecision> {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { ok: false, reason: 'not-https' }
  }
  if (url.protocol !== 'https:') return { ok: false, reason: 'not-https' }
  let addresses: ResolvedAddress[]
  try {
    addresses = await resolve(url.hostname)
  } catch {
    return { ok: false, reason: 'unresolvable' }
  }
  if (!addresses.length) return { ok: false, reason: 'no-address' }
  if (addresses.some(a => isPrivateAddress(a.address))) return { ok: false, reason: 'private-address' }
  return { ok: true, url, address: addresses[0] }
}

export interface OneClickResult {
  ok: boolean
  reason?: RefusalReason
  status?: number
}

/** What the boundary needs from an HTTPS client, so a bench can stand in for it. */
export interface HttpsRequester {
  (options: {
    url: URL
    address: ResolvedAddress
    body: string
    contentType: string
    timeoutMs: number
  }): Promise<{ status: number }>
}

/** The two shapes `net.connect` may call a custom `lookup` with. */
type LookupOneCallback = (err: Error | null, address: string, family: number) => void
type LookupAllCallback = (err: Error | null, addresses: ResolvedAddress[]) => void
type LookupCallback = LookupOneCallback | LookupAllCallback

const defaultRequester: HttpsRequester = ({ url, address, body, contentType, timeoutMs }) =>
  new Promise((resolve, reject) => {
    const req = https.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || 443,
        path: `${url.pathname}${url.search}`,
        method: 'POST',
        headers: { 'Content-Type': contentType, 'Content-Length': Buffer.byteLength(body) },
        timeout: timeoutMs,
        // Connect to the address that was VERIFIED, without a second
        // resolution: between the check and the connection, DNS could
        // otherwise answer a private address (rebinding).
        //
        // Two calling conventions: since Node 20 `net.connect` sets
        // `autoSelectFamily` and calls the hook with `{ all: true }`, expecting an
        // ARRAY. Answering the single-address form there yields
        // `ERR_INVALID_IP_ADDRESS: undefined` — every real one-click failed as
        // `transport` while a bench with an injected requester stayed green.
        lookup: ((_hostname: string, opts: { all?: boolean }, cb: LookupCallback) =>
          opts?.all
            ? (cb as LookupAllCallback)(null, [{ address: address.address, family: address.family }])
            : (cb as LookupOneCallback)(null, address.address, address.family)) as never,
      },
      res => {
        // The response body is never read, never returned, never logged: it is
        // a stranger's document and nothing here needs it.
        res.resume()
        resolve({ status: res.statusCode ?? 0 })
      }
    )
    req.on('timeout', () => req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })))
    req.on('error', reject)
    req.end(body)
  })

/**
 * The deadline of one call, held HERE and not only in the socket: the socket's
 * own timeout belongs to `defaultRequester`, so a client that stops answering
 * at another layer would otherwise hang this call — and with it the whole batch
 * and the agent's request — forever. Rejects as `ETIMEDOUT`, the same code the
 * socket uses, so both read as `timeout`.
 */
function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })), ms)
  })
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer)) as Promise<T>
}

/**
 * The RFC 8058 one-click POST, through the boundary above. No redirect is ever
 * followed: a 3xx is an answer the sender has to make unambiguous, not an
 * invitation to call a second, unchecked URL.
 */
export async function unsubscribeOneClick(
  rawUrl: string,
  opts: { resolve?: AddressResolver; request?: HttpsRequester } = {}
): Promise<OneClickResult> {
  const decision = await decideUrl(rawUrl, opts.resolve ?? defaultResolver)
  if (!decision.ok) return { ok: false, reason: decision.reason }
  const request = opts.request ?? defaultRequester
  let status: number
  try {
    status = (
      await withDeadline(
        request({
          url: decision.url,
          address: decision.address,
          body: ONE_CLICK_BODY,
          contentType: ONE_CLICK_CONTENT_TYPE,
          timeoutMs: UNSUBSCRIBE_TIMEOUT_MS,
        }),
        UNSUBSCRIBE_TIMEOUT_MS
      )
    ).status
  } catch (err) {
    const code = (err as { code?: string })?.code
    return { ok: false, reason: code === 'ETIMEDOUT' ? 'timeout' : 'transport' }
  }
  if (status >= 300 && status < 400) return { ok: false, reason: 'redirect-not-followed', status }
  if (status < 200 || status >= 300) return { ok: false, reason: 'http-status', status }
  return { ok: true, status }
}

// ---------------------------------------------------------------------------
// Mailbox reading — headers only
// ---------------------------------------------------------------------------

const SUBSCRIPTION_HEADER_FIELDS = ['from', 'list-id', 'list-unsubscribe', 'list-unsubscribe-post', 'date', 'subject']

/**
 * Reads the subscription headers of the most recent `RECENT_MESSAGES_SCANNED`
 * messages of a folder. Header fetch only: no body is ever requested.
 */
export async function readSubscriptionHeaders(
  account: AccountConfig,
  folder: string,
  limit = RECENT_MESSAGES_SCANNED
): Promise<SubscriptionHeaders[]> {
  // Imported inside the function so the pure half of this module (headers,
  // grouping, network boundary) can be measured on its own, without pulling in
  // the IMAP client — the same reason lib/pgp/crypto.ts imports lazily.
  const { createClient } = await import('./imap')
  const client = await createClient(account)
  const found: SubscriptionHeaders[] = []
  try {
    const lock = await client.getMailboxLock(folder)
    try {
      const uids = (await client.search({ all: true }, { uid: true })) as number[] | false
      const recent = (uids || []).slice(-limit)
      if (!recent.length) return found
      for await (const msg of client.fetch(
        recent as unknown as string,
        { uid: true, headers: SUBSCRIPTION_HEADER_FIELDS } as Parameters<typeof client.fetch>[1],
        { uid: true }
      )) {
        const raw = (msg as unknown as { headers?: Buffer }).headers
        if (!Buffer.isBuffer(raw)) continue
        const parsed = parseSubscriptionHeaders(String(msg.uid), raw.toString('utf8'))
        if (parsed) found.push(parsed)
      }
    } finally {
      lock.release()
    }
  } finally {
    await client.logout().catch(() => {})
  }
  return found
}

// ---------------------------------------------------------------------------
// Service layer — what the two routes call, so neither holds any logic
// ---------------------------------------------------------------------------

/** The columns of an account row these functions read. */
export interface AccountRowLike {
  id: string
  email: string
  imap_host: string
  imap_port: number
  imap_secure: boolean
  smtp_host: string
  smtp_port: number
  smtp_secure: boolean
  username: string
  password_encrypted: string
  oauth_provider: string | null
  oauth_access_token: string | null
  oauth_refresh_token: string | null
  oauth_expires_at: number | null
}

/** Row → IMAP config. Mapped here once instead of in each route. */
export function imapConfigOf(a: AccountRowLike): AccountConfig {
  return {
    id: a.id,
    imapHost: a.imap_host,
    imapPort: a.imap_port,
    imapSecure: a.imap_secure,
    username: a.username,
    passwordEncrypted: a.password_encrypted,
    oauthProvider: a.oauth_provider,
    oauthAccessToken: a.oauth_access_token,
    oauthRefreshToken: a.oauth_refresh_token,
    oauthExpiresAt: a.oauth_expires_at,
  }
}

/** Row → SMTP config, for the mailto branch. */
export function smtpConfigOf(a: AccountRowLike) {
  return {
    id: a.id,
    smtpHost: a.smtp_host,
    smtpPort: a.smtp_port,
    smtpSecure: a.smtp_secure,
    username: a.username,
    passwordEncrypted: a.password_encrypted,
    oauthProvider: a.oauth_provider,
    oauthAccessToken: a.oauth_access_token,
    oauthRefreshToken: a.oauth_refresh_token,
    oauthExpiresAt: a.oauth_expires_at,
  }
}

/** Past unsubscribes of a mailbox, keyed by grouping key. */
async function recordedUnsubscriptions(accountId: string): Promise<Map<string, string>> {
  const { query } = await import('./db')
  const rows = await query<{ group_key: string; created_at: string }>(
    'SELECT group_key, created_at FROM unsubscriptions WHERE account_id = $1',
    [accountId]
  )
  return new Map(rows.map(r => [r.group_key, new Date(r.created_at).toISOString()]))
}

/** The list served by `GET /api/subscriptions`. */
export async function listSubscriptions(
  account: AccountConfig,
  accountId: string,
  folder: string
): Promise<Subscription[]> {
  const [headers, already] = await Promise.all([
    readSubscriptionHeaders(account, folder),
    recordedUnsubscriptions(accountId),
  ])
  return groupSubscriptions(accountId, headers, already, folder)
}

export interface UnsubscribeReport {
  id: string
  outcome: UnsubscribeOutcome
  method?: UnsubscribeMethod
  /** Set on `manual`: the page the human has to open themselves. */
  url?: string
  /** Set on `failed`: which boundary or transport rule stopped it. */
  reason?: RefusalReason | 'no-target'
}

export interface UnsubscribeRequest {
  imap: AccountConfig
  smtp: Parameters<typeof import('./smtp')['sendMail']>[0]
  accountId: string
  from: string
  folder: string
  ids: string[]
  /** Injected in the bench so no real list is ever left. */
  resolve?: AddressResolver
  request?: HttpsRequester
  /** Injected in the bench so a batch is measurable without a mailbox. */
  read?: (imap: AccountConfig, folder: string) => Promise<SubscriptionHeaders[]>
}

/** What must be DONE for one requested id, decided without any effect. */
/** What a carried-out plan records about who was left. */
interface PlannedSender {
  sender: EmailAddress
  listId: string | undefined
}

export type UnsubscribePlan =
  | { id: string; action: 'not_found' }
  | { id: string; action: 'manual'; method: 'link'; url: string }
  | ({ id: string; action: 'one-click'; method: 'one-click'; key: string; url: string } & PlannedSender)
  | ({ id: string; action: 'mailto'; method: 'mailto'; key: string; address: string; subject: string } & PlannedSender)
  | { id: string; action: 'failed'; method: UnsubscribeMethod; reason: 'no-target' }

/** Default subject of a mailto unsubscribe, when the list does not ask for one. */
export const MAILTO_SUBJECT = 'unsubscribe'
export const MAILTO_BODY = 'unsubscribe'

/**
 * Decides what each requested id leads to, from a read of the folder's headers.
 * PURE: no network, no mailbox, no database — so the whole decision, including
 * the refusal to automate a bare link, is measurable on its own.
 *
 * An id that no group in this mailbox produces is `not_found`: the client can
 * neither name a URL nor reach a group that is not here.
 *
 * `link` alone (an https page without RFC 8058 one-click) is never automated:
 * that page may ask the human a question, or be a tracker that counts a visit
 * as a confirmation. It is planned as `manual`, with the link.
 */
export function planUnsubscribe(
  accountId: string,
  headers: SubscriptionHeaders[],
  ids: string[]
): UnsubscribePlan[] {
  const newest = new Map<string, SubscriptionHeaders>()
  for (const h of headers) {
    const key = groupingKey(h)
    const current = newest.get(key)
    if (!current || dateRank(h.date) > dateRank(current.date)) newest.set(key, h)
  }
  const byId = new Map(
    Array.from(newest.entries()).map(([key, h]) => [subscriptionId(accountId, key), { key, h }])
  )

  return ids.map((id): UnsubscribePlan => {
    const group = byId.get(id)
    if (!group) return { id, action: 'not_found' }
    const { key, h } = group
    const method = methodOf(h)
    const who: PlannedSender = { sender: h.from, listId: h.listId }
    if (method === 'one-click') return { id, action: 'one-click', method, key, url: h.uris.https[0], ...who }
    if (method === 'mailto') {
      const address = h.uris.mailto.map(mailtoAddress).find((a): a is string => !!a)
      if (!address) return { id, action: 'failed', method, reason: 'no-target' }
      return {
        id,
        action: 'mailto',
        method,
        key,
        address,
        subject: mailtoSubject(h.uris.mailto[0]) ?? MAILTO_SUBJECT,
        ...who,
      }
    }
    const page = manualUrl(h)
    if (!page) return { id, action: 'failed', method: 'link', reason: 'no-target' }
    return { id, action: 'manual', method: 'link', url: page }
  })
}

/**
 * Carries out the plan above: one-click through the network boundary, mailto
 * through this mailbox's own SMTP, and each completed unsubscribe recorded so a
 * later list says so and an agent does not start over.
 */
export async function unsubscribeGroups(req: UnsubscribeRequest): Promise<UnsubscribeReport[]> {
  const headers = await (req.read ?? readSubscriptionHeaders)(req.imap, req.folder)
  const plans = planUnsubscribe(req.accountId, headers, req.ids)
  return mapBounded(plans, UNSUBSCRIBE_CONCURRENCY, plan => carryOut(plan, req))
}

/** One planned id, carried out. Isolated so the pool above stays a pool. */
async function carryOut(plan: UnsubscribePlan, req: UnsubscribeRequest): Promise<UnsubscribeReport> {
  if (plan.action === 'not_found') return { id: plan.id, outcome: 'not_found' }
  if (plan.action === 'failed') return { id: plan.id, outcome: 'failed', method: plan.method, reason: plan.reason }
  if (plan.action === 'manual') return { id: plan.id, outcome: 'manual', method: plan.method, url: plan.url }

  if (plan.action === 'one-click') {
    const result = await unsubscribeOneClick(plan.url, { resolve: req.resolve, request: req.request })
    if (!result.ok) return { id: plan.id, outcome: 'failed', method: plan.method, reason: result.reason }
  } else {
    const { sendMail } = await import('./smtp')
    try {
      await sendMail(req.smtp, { from: req.from, to: [plan.address], subject: plan.subject, text: MAILTO_BODY })
    } catch {
      // An error text can carry the remote server's answer: only the kind is kept.
      return { id: plan.id, outcome: 'failed', method: plan.method, reason: 'transport' }
    }
  }
  await recordUnsubscription(req.accountId, plan.key, plan.method, plan.sender, plan.listId)
  return { id: plan.id, outcome: 'done', method: plan.method }
}

/**
 * Runs `work` over `items` with at most `limit` in flight, answering in the
 * ORDER OF `items` — the report's Nth entry is the Nth requested id, whatever
 * order the network answered in.
 */
async function mapBounded<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  const worker = async () => {
    for (let i = next++; i < items.length; i = next++) out[i] = await work(items[i])
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

/**
 * Remembers a completed unsubscribe, so a later list can say so. The sender is
 * stored WITH the row: once the messages are filed away, the group is gone from
 * the list and the key alone would no longer name anyone.
 */
async function recordUnsubscription(
  accountId: string,
  key: string,
  method: UnsubscribeMethod,
  sender: EmailAddress,
  listId: string | undefined
): Promise<void> {
  const { query } = await import('./db')
  await query(
    `INSERT INTO unsubscriptions (account_id, group_key, method, sender_address, sender_name, list_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (account_id, group_key) DO UPDATE
       SET method = EXCLUDED.method, created_at = NOW(),
           sender_address = EXCLUDED.sender_address,
           sender_name = EXCLUDED.sender_name,
           list_id = EXCLUDED.list_id`,
    [accountId, key, method, sender.address, sender.name, listId ?? null]
  )
}

/** One past unsubscribe, as `GET /api/subscriptions/unsubscribed` serves it. */
export interface UnsubscribedEntry {
  accountId: string
  sender: EmailAddress
  listId: string | null
  method: UnsubscribeMethod
  unsubscribedAt: string
}

/**
 * Every mailbox id this user may READ: their own, plus the ones an active,
 * non-expired share gives them. Same rule as `getAccessibleAccount(id, user, [])`,
 * asked for the whole set instead of one id — the history route needs the set
 * when no mailbox is named.
 */
export async function accessibleAccountIds(userId: string): Promise<string[]> {
  const { query } = await import('./db')
  const rows = await query<{ id: string }>(
    `SELECT a.id FROM email_accounts a WHERE a.user_id = $1
     UNION
     SELECT a.id FROM account_shares sh
     JOIN email_accounts a ON a.id = sh.account_id
     WHERE sh.invitee_user_id = $1 AND sh.status = 'active'
       AND (sh.expires_at IS NULL OR sh.expires_at > NOW())`,
    [userId]
  )
  return rows.map(r => r.id)
}

/**
 * The history of the mailboxes given, newest first. It OUTLIVES the cleaning:
 * the caller passes the ids it may read, so a mailbox that is not accessible
 * can never appear — the filter is the id list, not a flag on the row.
 */
export async function listUnsubscribed(accountIds: string[]): Promise<UnsubscribedEntry[]> {
  if (!accountIds.length) return []
  const { query } = await import('./db')
  const rows = await query<{
    account_id: string
    sender_address: string | null
    sender_name: string | null
    list_id: string | null
    group_key: string
    method: UnsubscribeMethod
    created_at: string
  }>(
    `SELECT account_id, sender_address, sender_name, list_id, group_key, method, created_at
     FROM unsubscriptions WHERE account_id = ANY($1::uuid[]) ORDER BY created_at DESC`,
    [accountIds]
  )
  return rows.map(r => ({
    accountId: r.account_id,
    // Rows written before the sender was stored still read: the key holds the
    // address (`from:…`) or the list (`list:…`) it was built from.
    sender: {
      name: r.sender_name ?? '',
      address: r.sender_address ?? r.group_key.replace(/^(from|list):/, ''),
    },
    listId: r.list_id ?? (r.group_key.startsWith('list:') ? r.group_key.slice('list:'.length) : null),
    method: r.method,
    unsubscribedAt: new Date(r.created_at).toISOString(),
  }))
}
