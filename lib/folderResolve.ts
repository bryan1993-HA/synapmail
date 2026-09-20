/**
 * Resolving a folder path BEFORE acting on it: the accessible account, the folder that
 * actually exists on the server, its role, its delimiter and its children. Every mutating
 * route starts from here — a path invented by the client never reaches IMAP, and the rule
 * in `lib/folderActions.ts` is evaluated against server facts, not against whatever the
 * client chose to send.
 */
import { getAccessibleAccount, type AccessibleAccount, type AccountPermission } from './accountAccess'
import { toImapConfig } from './accounts'
import { listFolders } from './imap'
import { detectSpecials, type SpecialType } from './specialFolders'
import { accountDelimiter, folderCapabilities, isDescendant, samePath, type FolderCapabilities } from './folderActions'
import type { Folder } from '@/types/email'

export interface ResolvedFolder {
  account: AccessibleAccount
  config: ReturnType<typeof toImapConfig>
  folders: Folder[]
  /** The targeted folder, `null` when only the account is targeted (creation at the root). */
  folder: Folder | null
  special: SpecialType
  delimiter: string
  hasChildren: boolean
  can: FolderCapabilities
}

/**
 * An empty or absent `path` = no folder is targeted (creation at the root). Returns
 * `null` when the account is not accessible OR when the path does not exist: the same
 * shape of failure in both cases, so nothing about what exists is revealed.
 */
export async function resolveFolder(
  accountId: string | null,
  userId: string,
  path: string | null,
  required: AccountPermission[] = [],
): Promise<ResolvedFolder | null> {
  if (!accountId) return null
  const account = await getAccessibleAccount(accountId, userId, required)
  if (!account) return null

  const config = toImapConfig(account)
  const folders = await listFolders(config)
  const delimiter = accountDelimiter(folders)

  const folder = path ? folders.find(f => samePath(f.path, path)) ?? null : null
  if (path && !folder) return null

  const specials = detectSpecials(folders)
  const special = folder ? specials.get(folder.path) ?? null : null
  const hasChildren = folder ? folders.some(f => isDescendant(f.path, folder.path, delimiter)) : false

  return {
    account, config, folders, folder, special, delimiter, hasChildren,
    can: folderCapabilities({
      special,
      hasChildren,
      canOrganize: account.permissions.organize,
      canDelete: account.permissions.delete,
    }),
  }
}

