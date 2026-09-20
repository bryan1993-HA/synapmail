'use client'

/**
 * Right-click on a sidebar folder. The menu INVENTS no rule of its own: it disables
 * whatever `lib/folderActions.ts` refuses — the SAME function the `/api/folders*` routes
 * apply before acting. So an item offered here is an item the server will accept, and
 * the other way around.
 *
 * It does not make the calls either: it reports the intent, and the sidebar runs it
 * (the sidebar owns the inline input and the list refresh).
 */

import { FolderPlus, FolderTree, Pencil, MailOpen, Eraser, Trash2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import {
  ContextMenuSurface, ContextMenuItem, ContextMenuSeparator, MENU_ICON,
} from '@/components/ui/ContextMenu'
import { folderCapabilities, offeredActions, type FolderAction } from '@/lib/folderActions'
import type { SpecialType } from '@/lib/specialFolders'

export interface FolderMenuState {
  x: number
  y: number
  path: string
  name: string
  special: SpecialType
  /** True if another folder lives under this one: a parent is not deleted. */
  hasChildren: boolean
}

interface Props {
  menu: FolderMenuState
  canOrganize: boolean
  canDelete: boolean
  onAction: (action: FolderAction, menu: FolderMenuState) => void
  onClose: () => void
}

/** The icon and label of each action — the only thing this file decides.
 *  WHICH items show up comes from `offeredActions`, the order from `FOLDER_ACTIONS`. */
const ENTRY: Record<FolderAction, { icon: React.ComponentType<{ className?: string }>; label: string; danger?: boolean }> = {
  create: { icon: FolderPlus, label: 'folderNew' },
  createChild: { icon: FolderTree, label: 'folderNewChild' },
  rename: { icon: Pencil, label: 'folderRename' },
  markRead: { icon: MailOpen, label: 'folderMarkRead' },
  empty: { icon: Eraser, label: 'folderEmpty' },
  remove: { icon: Trash2, label: 'folderDelete', danger: true },
}

export function FolderContextMenu({ menu, canOrganize, canDelete, onAction, onClose }: Props) {
  const t = useTranslations('mail')
  const can = folderCapabilities({
    special: menu.special,
    hasChildren: menu.hasChildren,
    canOrganize,
    canDelete,
  })

  return (
    <ContextMenuSurface anchor={menu} onClose={onClose} data-folder-context-menu data-folder-path={menu.path}>
      {offeredActions(menu.special).map(action => {
        const { icon: Icon, label, danger } = ENTRY[action]
        return (
        <div key={action}>
          {danger && <ContextMenuSeparator />}
          <ContextMenuItem
            itemKey={action}
            icon={<Icon className={MENU_ICON} />}
            label={t(label)}
            onClick={() => onAction(action, menu)}
            onClose={onClose}
            enabled={can[action]}
            danger={danger}
          />
        </div>
        )
      })}
    </ContextMenuSurface>
  )
}
