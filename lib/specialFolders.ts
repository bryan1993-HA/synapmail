/**
 * Which IMAP folder plays which special role — single source for the folders API.
 *
 * The server's RFC 6154 SPECIAL-USE flag is authoritative. Name matching is only a
 * fallback for servers that declare nothing, and it is deliberately narrow: it looks
 * at the folder's OWN name, never at its path, and only at the top level (or directly
 * under INBOX, where `INBOX.`-namespaced servers keep their system folders).
 * Matching the whole path turned every sub-folder of a special folder into a second
 * special folder: "Spam/AMELI", "Spam/Crypto"… were all shown as "Spam", and
 * "Corbeille/CONVENTIONS" as another "Corbeille".
 */
export type SpecialType = 'inbox' | 'sent' | 'drafts' | 'spam' | 'trash' | null

/** RFC 6154 SPECIAL-USE attribute → special type. `null` = known flag, no special row. */
export const SPECIAL_USE_MAP: Record<string, SpecialType> = {
  '\\Inbox': 'inbox',
  '\\Sent': 'sent',
  '\\Drafts': 'drafts',
  '\\Junk': 'spam',
  '\\Trash': 'trash',
  '\\Archive': null,
  '\\Flagged': null,
  '\\All': null,
}

const NAME_PATTERNS: Array<[NonNullable<SpecialType>, RegExp]> = [
  ['sent', /\b(sent|envoy[eé]s?)\b/],
  ['drafts', /\b(drafts?|brouillons?)\b/],
  ['spam', /\b(junk|spam|pourriel|ind[eé]sirables?)\b/],
  ['trash', /\b(deleted|trash|corbeille|supprim[eé]s?)\b/],
]

export interface FolderLike {
  path: string
  name: string
  delimiter?: string
  specialUse?: string
}

const INBOX = 'inbox'
const INBOX_TYPE: NonNullable<SpecialType> = 'inbox'

function byFlag(f: FolderLike): SpecialType | undefined {
  return f.specialUse && Object.prototype.hasOwnProperty.call(SPECIAL_USE_MAP, f.specialUse)
    ? SPECIAL_USE_MAP[f.specialUse]
    : undefined
}

/** Resolves every folder of ONE account together: a role the server declares is never guessed again. */
export function detectSpecials<T extends FolderLike>(folders: T[]): Map<string, SpecialType> {
  const declared = new Set<SpecialType>()
  for (const f of folders) {
    const flagged = byFlag(f)
    if (flagged) declared.add(flagged)
  }

  const resolved = new Map<string, SpecialType>()
  for (const f of folders) {
    const flagged = byFlag(f)
    if (flagged !== undefined) { resolved.set(f.path, flagged); continue }

    const delimiter = f.delimiter || '/'
    const cut = f.path.lastIndexOf(delimiter)
    const parent = cut < 0 ? '' : f.path.slice(0, cut).toLowerCase()
    // A sub-folder keeps its own name — the depth test comes BEFORE any name match, including
    // "inbox": "Clients/Inbox" is a client folder, not a second inbox.
    if (parent !== '' && parent !== INBOX) { resolved.set(f.path, null); continue }

    const name = f.name.toLowerCase()
    const type = f.path.toLowerCase() === INBOX || name === INBOX
      ? INBOX_TYPE
      : NAME_PATTERNS.find(([, re]) => re.test(name))?.[0]
    // A role is claimed ONCE: the first folder to take it wins, so a mailbox holding both
    // "Trash" and "Deleted Items" (or two localized names for Sent) still shows a single special row.
    if (!type || declared.has(type)) { resolved.set(f.path, null); continue }
    declared.add(type)
    resolved.set(f.path, type)
  }
  return resolved
}
