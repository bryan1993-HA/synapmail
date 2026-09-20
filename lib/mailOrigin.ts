/**
 * A message's identity — single source.
 *
 * A uid is only unique WITHIN one folder of one mailbox: two unrelated messages can
 * both carry uid 3231, one in "Inbox" and one in "Sent". As long as a list only
 * displayed a single folder, carrying the uid alone was enough; an "all folders"
 * search mixes origins, and the application then opened ANOTHER message, or acted
 * (read, flag, move, DELETE) on the wrong ones.
 *
 * The whole path (open, tick, act, drag, forward) therefore carries the TRIPLE
 * below, and requests are built from it.
 */

/** What identifies a message unambiguously, on the client as well as on the server. */
export interface MessageOrigin {
  accountId: string
  folder: string
  uid: string
}

/** Attribute set next to `data-mail-row`: the row's complete origin. */
export const MAIL_ORIGIN_ATTR = 'data-mail-origin'

/**
 * The origin key: what serves as the React key, as a `Set` entry for the ticked
 * checkboxes and as a DOM attribute value. All three parts are encoded, so a folder
 * containing `|` or an accented character cannot produce two identical keys for two
 * different messages.
 */
export function originKey(origin: MessageOrigin): string {
  return [origin.accountId, origin.folder, origin.uid].map(encodeURIComponent).join('|')
}

/** The inverse of `originKey`. `null` when the key does not carry all three parts. */
export function parseOriginKey(key: string): MessageOrigin | null {
  const parts = key.split('|')
  if (parts.length !== 3) return null
  const [accountId, folder, uid] = parts.map(decodeURIComponent)
  if (!accountId || !folder || !uid) return null
  return { accountId, folder, uid }
}

export function sameOrigin(a: MessageOrigin, b: MessageOrigin): boolean {
  return a.accountId === b.accountId && a.folder === b.folder && a.uid === b.uid
}

/** A group of uids sharing the SAME origin: exactly one batched request. */
export interface OriginGroup {
  accountId: string
  folder: string
  uids: string[]
}

/**
 * Groups origins by (account, folder) while preserving order of appearance — on both
 * levels: the order of the groups, and the order of the uids inside a group. Exact
 * duplicates are dropped (a row ticked twice is not sent twice). Each group yields
 * ONE request to the batch API, whose contract (`{ uids, accountId, folder }`) does
 * not change.
 *
 * PURE function: its self-check is `scripts/check-mail-origin.mjs`.
 */
export function groupByOrigin(origins: readonly MessageOrigin[]): OriginGroup[] {
  const groups = new Map<string, OriginGroup>()
  const seen = new Set<string>()
  for (const origin of origins) {
    if (!origin.accountId || !origin.folder || !origin.uid) continue
    const key = originKey(origin)
    if (seen.has(key)) continue
    seen.add(key)
    const groupKey = `${encodeURIComponent(origin.accountId)}|${encodeURIComponent(origin.folder)}`
    const group = groups.get(groupKey)
    if (group) group.uids.push(origin.uid)
    else groups.set(groupKey, { accountId: origin.accountId, folder: origin.folder, uids: [origin.uid] })
  }
  return Array.from(groups.values())
}

/** The origin of a message received from the API — it already carries all three parts. */
export function originOfMessage(msg: { uid: string; accountId: string; folder: string }): MessageOrigin {
  return { accountId: msg.accountId, folder: msg.folder, uid: msg.uid }
}

/**
 * The API address of ONE message. Single source: reading, marking, deleting and
 * downloading an attachment all go through here, so no caller can forget the folder —
 * forgetting it sent the request against the DISPLAYED folder.
 */
export function messageHref(origin: MessageOrigin, path = ''): string {
  return `/api/messages/${encodeURIComponent(origin.uid)}${path}` +
    `?account=${encodeURIComponent(origin.accountId)}&folder=${encodeURIComponent(origin.folder)}`
}
