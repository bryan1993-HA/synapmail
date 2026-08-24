'use client'

import { useEffect, useRef } from 'react'
import { Mail, MailOpen, MoveRight, Trash2, Star, StarOff, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Folder } from '@/types/email'

export interface ContextMenuState {
  x: number
  y: number
  uid: string
  accountId: string
  isRead: boolean
  isStarred: boolean
  folderPath: string
}

interface Props {
  menu: ContextMenuState
  folders: Folder[]
  onClose: () => void
  onMarkRead: (uid: string, accountId: string, read: boolean) => void
  onStar: (uid: string, accountId: string, starred: boolean) => void
  onMove: (uid: string, accountId: string, destination: string) => void
  onDelete: (uid: string, accountId: string) => void
}

export function MessageContextMenu({ menu, folders, onClose, onMarkRead, onStar, onMove, onDelete }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  // Clamp position to viewport
  const x = Math.min(menu.x, window.innerWidth - 210)
  const y = Math.min(menu.y, window.innerHeight - 300)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const keyHandler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', handler)
    document.addEventListener('keydown', keyHandler)
    return () => {
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('keydown', keyHandler)
    }
  }, [onClose])

  const item = (icon: React.ReactNode, label: string, onClick: () => void, danger = false) => (
    <button
      onClick={() => { onClick(); onClose() }}
      className={cn(
        'w-full flex items-center gap-2.5 px-3 py-1.5 text-xs text-left transition-colors',
        danger
          ? 'text-destructive hover:bg-destructive/10'
          : 'text-foreground hover:bg-accent'
      )}
    >
      {icon}
      {label}
    </button>
  )

  const nonCurrentFolders = folders.filter(f => f.path !== menu.folderPath)

  return (
    <div
      ref={ref}
      className="fixed z-[100] min-w-[200px] bg-popover border border-border rounded-lg shadow-xl py-1 overflow-hidden"
      style={{ left: x, top: y }}
    >
      {/* Read/Unread */}
      {menu.isRead
        ? item(<MailOpen className="w-3.5 h-3.5 shrink-0" />, 'Marquer comme non lu', () => onMarkRead(menu.uid, menu.accountId, false))
        : item(<Mail className="w-3.5 h-3.5 shrink-0" />, 'Marquer comme lu', () => onMarkRead(menu.uid, menu.accountId, true))
      }

      {/* Star/Unstar */}
      {menu.isStarred
        ? item(<StarOff className="w-3.5 h-3.5 shrink-0" />, 'Retirer le suivi', () => onStar(menu.uid, menu.accountId, false))
        : item(<Star className="w-3.5 h-3.5 shrink-0" />, 'Suivre', () => onStar(menu.uid, menu.accountId, true))
      }

      <div className="my-1 border-t border-border" />

      {/* Move to — inline submenu */}
      <div className="group relative">
        <div className="w-full flex items-center gap-2.5 px-3 py-1.5 text-xs text-foreground hover:bg-accent cursor-default transition-colors">
          <MoveRight className="w-3.5 h-3.5 shrink-0" />
          Déplacer vers
          <ChevronRight className="w-3 h-3 ml-auto" />
        </div>
        {/* Submenu */}
        <div className="absolute left-full top-0 hidden group-hover:block min-w-[180px] max-h-64 overflow-y-auto bg-popover border border-border rounded-lg shadow-xl py-1 z-[101]">
          {nonCurrentFolders.length === 0 && (
            <p className="px-3 py-2 text-xs text-muted-foreground">Aucun dossier</p>
          )}
          {nonCurrentFolders.map(f => (
            <button
              key={f.path}
              onClick={() => { onMove(menu.uid, menu.accountId, f.path); onClose() }}
              className="w-full text-left px-3 py-1.5 text-xs text-foreground hover:bg-accent transition-colors truncate"
            >
              {f.name}
            </button>
          ))}
        </div>
      </div>

      <div className="my-1 border-t border-border" />

      {/* Delete */}
      {item(<Trash2 className="w-3.5 h-3.5 shrink-0" />, 'Supprimer', () => onDelete(menu.uid, menu.accountId), true)}
    </div>
  )
}
