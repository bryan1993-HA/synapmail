/**
 * What is allowed on a folder: the SINGLE source, read on both sides of the
 * contract: the `/api/folders*` routes refuse (403 / 400) exactly what the sidebar
 * context menu greys out. Writing the rule twice means promising the user, one day,
 * a clickable entry that the server will refuse.
 *
 * The rule knows ONLY two things: the folder role (`lib/specialFolders.ts`)
 * and the account permissions (`lib/accountAccess.ts`). No hardcoded paths.
 */
import type { SpecialType } from './specialFolders'

export const FOLDER_ACTIONS = ['create', 'createChild', 'rename', 'markRead', 'empty', 'remove'] as const
export type FolderAction = (typeof FOLDER_ACTIONS)[number]

/** The only folders that get emptied: the ones whose purpose is to be emptied. */
export const EMPTYABLE: ReadonlySet<SpecialType> = new Set<SpecialType>(['trash', 'spam'])

/** What the rule needs to know about the targeted folder and the session. */
export interface FolderContext {
  /** RFC 6154 role resolved by `detectSpecials`, `null` for an ordinary folder. */
  special: SpecialType
  /** True if another folder is filed UNDER this one: a parent is never deleted. */
  hasChildren: boolean
  /** The account's "organize" permission (create, rename, mark read). */
  canOrganize: boolean
  /** The account's "delete" permission (delete the folder, empty it). */
  canDelete: boolean
}

export type FolderCapabilities = Record<FolderAction, boolean>

/**
 * A special folder carries a role that the server declares (RFC 6154) and that the
 * client assumes everywhere: renaming or deleting it breaks the mailbox, not just the sidebar.
 */
const isSpecial = (special: SpecialType) => special !== null

/**
 * The actions OFFERED for this folder. "Empty" only concerns the folders whose
 * purpose that is: showing it greyed out on each of the twenty others is permanent
 * noise, not information. Greyed out means "here, but not for you";
 * absent means "this does not exist for this folder".
 */
export function offeredActions(special: SpecialType): FolderAction[] {
  return FOLDER_ACTIONS.filter(a => a !== 'empty' || EMPTYABLE.has(special))
}

export function folderCapabilities(ctx: FolderContext): FolderCapabilities {
  const { special, hasChildren, canOrganize, canDelete } = ctx
  const structural = canOrganize && !isSpecial(special)
  return {
    create: canOrganize,
    createChild: canOrganize,
    rename: structural,
    markRead: canOrganize,
    empty: canDelete && EMPTYABLE.has(special),
    remove: canDelete && !isSpecial(special) && !hasChildren,
  }
}

/**
 * A folder name typed by the user, made safe BEFORE it reaches IMAP: the
 * server delimiter would place a hierarchy in it that the user never asked for, and
 * control characters break the command itself. Returns `null` if the name cannot
 * be accepted: the caller then answers 400, it does not "repair" anything.
 */
export const FOLDER_NAME_MAX = 255

// eslint-disable-next-line no-control-regex -- that is precisely what we refuse
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/

export function sanitizeFolderName(raw: unknown, delimiter: string): string | null {
  if (typeof raw !== 'string') return null
  const name = raw.trim()
  if (!name || name.length > FOLDER_NAME_MAX) return null
  if (CONTROL_CHARS.test(name)) return null
  if (delimiter && name.includes(delimiter)) return null
  return name
}

/** Full path of a folder created under `parent` (root if `parent` is empty). */
export function joinFolderPath(parent: string, name: string, delimiter: string): string {
  return parent ? `${parent}${delimiter}${name}` : name
}

/** Path of the renamed folder: it stays with its parent, only its last segment changes. */
export function renamedPath(path: string, name: string, delimiter: string): string {
  const cut = path.lastIndexOf(delimiter)
  return cut < 0 ? name : `${path.slice(0, cut)}${delimiter}${name}`
}

/** True if `child` is filed under `parent`: never true for the folder itself. */
export function isDescendant(child: string, parent: string, delimiter: string): boolean {
  return child.startsWith(`${parent}${delimiter}`)
}

/**
 * Path of `path` AFTER renaming `from` to `to`. IMAP renames the whole
 * hierarchy at once: a folder filed under the one being renamed changes path
 * too. Without this, its cache rows stay under the old path: wrong unread
 * counters, then dead rows. A path outside the subtree comes back intact.
 */
export function rewritePath(path: string, from: string, to: string, delimiter: string): string {
  if (path === from) return to
  return isDescendant(path, from, delimiter) ? to + path.slice(from.length) : path
}

/**
 * Do two paths designate the SAME folder? An IMAP server may list a name in
 * DECOMPOSED Unicode (NFD: an accented letter as base letter plus combining mark)
 * where a name typed on the keyboard arrives composed (NFC). Comparing the raw
 * strings would then let an invisible duplicate be created.
 */
export function samePath(a: string, b: string): boolean {
  return a.normalize('NFC') === b.normalize('NFC')
}

/** The account delimiter, taken from the folders themselves: never assumed to be `/`. */
export function accountDelimiter(folders: ReadonlyArray<{ delimiter?: string | null }>): string {
  return folders.find(f => f.delimiter)?.delimiter ?? '/'
}

/**
 * The refusals of the `/api/folders*` routes. The body of a `Response` can be read
 * only ONCE: a response kept in a module constant goes out empty from the second
 * request of the process onward, and the screen, which displays `error`, has nothing
 * left to show. Hence a NEW response on every call, and a single place writing them.
 *
 * Native `Response` rather than `NextResponse`: a route handler accepts it as
 * is, so the bench can run it without the bundler.
 */
export const FOLDER_REFUSALS = {
  notFound: { error: 'Folder not found', status: 404 },
  forbidden: { error: 'Forbidden', status: 403 },
  badName: { error: 'Invalid folder name', status: 400 },
  exists: { error: 'Folder already exists', status: 409 },
  unknownAction: { error: 'Unknown action', status: 400 },
  unauthorized: { error: 'Unauthorized', status: 401 },
} as const

export type FolderRefusal = keyof typeof FOLDER_REFUSALS

export function refuse(kind: FolderRefusal): Response {
  const { error, status } = FOLDER_REFUSALS[kind]
  return Response.json({ error }, { status })
}
