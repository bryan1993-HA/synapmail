'use client'

/**
 * The right-click menu. It holds NO mail logic of its own: it reads the capabilities
 * from `lib/mailSelection` and calls its actions, exactly like the app bar's toolbar.
 * What the menu knows about the clicked row is limited to what it DISPLAYS (read /
 * unread, color of the flag already set); the TARGET of the actions is the selection
 * published by the list.
 */

import { Archive, Clock, Flag, Forward, Mail, MailOpen, MailX, MoveRight, Reply, ReplyAll, Trash2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { FlagPicker } from '@/components/mail/FlagPicker'
import {
  ContextMenuSurface, ContextMenuItem, ContextMenuSubmenu, ContextMenuSeparator, MENU_ICON,
} from '@/components/ui/ContextMenu'
import { flagByKey } from '@/lib/flags'
import { useMailSelection } from '@/lib/mailSelection'
import { snoozePresets } from '@/lib/snooze-presets'
import { cn } from '@/lib/utils'
import type { Folder } from '@/types/email'

export interface ContextMenuState {
  x: number
  y: number
  /** The clicked row — used for DISPLAY (read/unread toggle, checked swatch). */
  isRead: boolean
  flag: string | null
  folderPath: string
}

interface Props {
  menu: ContextMenuState
  folders: Folder[]
  onClose: () => void
}

export function MessageContextMenu({ menu, folders, onClose }: Props) {
  const t = useTranslations('mail')
  const { can, run } = useMailSelection()
  const item = (
    key: string,
    icon: React.ReactNode,
    label: string,
    onClick: () => void,
    { enabled, danger }: { enabled: boolean; danger?: boolean },
  ) => (
    <ContextMenuItem key={key} itemKey={key} icon={icon} label={label} onClick={onClick} onClose={onClose} enabled={enabled} danger={danger} />
  )

  const submenu = (key: string, icon: React.ReactNode, label: string, enabled: boolean, body: React.ReactNode) => (
    <ContextMenuSubmenu itemKey={key} icon={icon} label={label} enabled={enabled}>{body}</ContextMenuSubmenu>
  )

  const ICON = MENU_ICON
  const separator = <ContextMenuSeparator />
  const otherFolders = folders.filter(f => f.path !== menu.folderPath)

  return (
    <ContextMenuSurface anchor={menu} onClose={onClose} data-mail-context-menu>
      {item('reply', <Reply className={ICON} />, t('reply'), () => run('reply'), { enabled: can.reply })}
      {item('replyAll', <ReplyAll className={ICON} />, t('replyAll'), () => run('replyAll'), { enabled: can.replyAll })}
      {item('forward', <Forward className={ICON} />, t('forward'), () => run('forward'), { enabled: can.forward })}

      {separator}

      {submenu(
        'flag',
        <Flag className={cn(ICON, menu.flag && 'fill-current')} style={flagByKey(menu.flag)?.color ? { color: flagByKey(menu.flag)!.color } : undefined} />,
        t('flag'),
        can.setFlag,
        <FlagPicker current={menu.flag} onPick={flag => { run('setFlag', flag); onClose() }} />,
      )}
      {menu.isRead
        ? item('markUnread', <Mail className={ICON} />, t('markUnread'), () => run('markUnread'), { enabled: can.markUnread })
        : item('markRead', <MailOpen className={ICON} />, t('markRead'), () => run('markRead'), { enabled: can.markRead })}

      {separator}

      {item('archive', <Archive className={ICON} />, t('archiveAction'), () => run('archive'), { enabled: can.archive })}
      {submenu(
        'move',
        <MoveRight className={ICON} />,
        t('move'),
        can.moveTo,
        <div className="min-w-[180px] max-h-64 overflow-y-auto">
          {otherFolders.length === 0 && <p className="px-3 py-2 text-xs text-muted-foreground">{t('noFolders')}</p>}
          {otherFolders.map(f => (
            <button
              key={f.path}
              type="button"
              data-menu-folder={f.path}
              onClick={() => { run('moveTo', f.path); onClose() }}
              className="w-full text-left px-3 py-1.5 text-xs text-foreground hover:bg-accent transition-colors truncate"
            >
              {f.name}
            </button>
          ))}
        </div>,
      )}
      {item('spam', <MailX className={ICON} />, t('spam'), () => run('spam'), { enabled: can.spam })}
      {/* Snooze: removed from the rows, since it existed nowhere else. */}
      {submenu(
        'snooze',
        <Clock className={ICON} />,
        t('snooze'),
        can.snooze,
        <div className="min-w-[180px]">
          {snoozePresets().map(p => (
            <button
              key={p.key}
              type="button"
              data-menu-snooze={p.key}
              onClick={() => { run('snooze', p.date); onClose() }}
              className="w-full flex items-center justify-between gap-2 px-3 py-1.5 text-xs text-foreground hover:bg-accent transition-colors"
            >
              <span>{t(p.key)}</span>
              <span className="text-[10px] text-muted-foreground tabular-nums">
                {p.date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </button>
          ))}
        </div>,
      )}

      {separator}

      {item('remove', <Trash2 className={ICON} />, t('delete'), () => run('remove'), { enabled: can.remove, danger: true })}
    </ContextMenuSurface>
  )
}
