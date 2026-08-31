'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import {
  Mail, Send, FileText, AlertTriangle, Trash2,
  Settings, PenSquare, Folder, Archive, X, ChevronDown, ChevronLeft, ChevronRight,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import useSWR from 'swr'
import { useState, useEffect } from 'react'
import { ThemeToggle } from '@/components/ui/ThemeToggle'
import type { EmailAccount } from '@/types/account'

const fetcher = (url: string) => fetch(url).then(r => r.json())

type SpecialKey = 'inbox' | 'sent' | 'drafts' | 'spam' | 'trash' | 'archive' | null

const SPECIAL_ICONS: Record<NonNullable<SpecialKey>, React.ComponentType<{ className?: string }>> = {
  inbox: Mail,
  sent: Send,
  drafts: FileText,
  spam: AlertTriangle,
  trash: Trash2,
  archive: Archive,
}

const SPECIAL_LABELS: Record<NonNullable<SpecialKey>, string> = {
  inbox: 'inbox',
  sent: 'sent',
  drafts: 'drafts',
  spam: 'spam',
  trash: 'trash',
  archive: 'archive',
}

type FolderItem = { name: string; path: string; special: SpecialKey; unreadCount?: number }

const FALLBACK_FOLDERS: FolderItem[] = [
  { path: 'INBOX', name: 'INBOX', special: 'inbox', unreadCount: 0 },
  { path: 'Sent Items', name: 'Sent Items', special: 'sent', unreadCount: 0 },
  { path: 'Drafts', name: 'Drafts', special: 'drafts', unreadCount: 0 },
  { path: 'Junk Email', name: 'Junk Email', special: 'spam', unreadCount: 0 },
  { path: 'Deleted Items', name: 'Deleted Items', special: 'trash', unreadCount: 0 },
]

const dispatchCompose = () => window.dispatchEvent(new CustomEvent('synapmail:compose'))

const ACCOUNT_COLORS = ['bg-blue-500', 'bg-violet-500', 'bg-emerald-500', 'bg-amber-500', 'bg-rose-500']

interface SidebarProps {
  onClose?: () => void
  collapsed?: boolean
  onToggleCollapse?: () => void
}

export function Sidebar({ onClose, collapsed, onToggleCollapse }: SidebarProps) {
  const t = useTranslations('mail')
  const pathname = usePathname()
  const [currentFolder, setCurrentFolder] = useState('INBOX')
  const [accountOpen, setAccountOpen] = useState(false)
  const [dragOverPath, setDragOverPath] = useState<string | null>(null)
  const [activeAccountId, setActiveAccountId] = useState<string | null>(
    typeof window !== 'undefined' ? localStorage.getItem('synapmail:activeAccountId') : null
  )

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search)
      setCurrentFolder(params.get('folder') ?? 'INBOX')
    }
  }, [pathname])

  useEffect(() => {
    const handler = (e: Event) => {
      setActiveAccountId((e as CustomEvent<string>).detail)
    }
    window.addEventListener('synapmail:account-change', handler)
    return () => window.removeEventListener('synapmail:account-change', handler)
  }, [])

  const { data: accountsData } = useSWR<{ data: EmailAccount[] }>(
    '/api/accounts',
    fetcher,
    { revalidateOnFocus: false }
  )

  const accounts = accountsData?.data ?? []
  const hasMultipleAccounts = accounts.length > 1
  const activeAccount = accounts.find(a => a.id === activeAccountId) ?? accounts.find(a => a.isDefault) ?? accounts[0]
  const resolvedAccountId = activeAccount?.id ?? null
  const accountColorIdx = activeAccount ? accounts.indexOf(activeAccount) % ACCOUNT_COLORS.length : 0

  const { data: foldersData } = useSWR<{ data: FolderItem[] }>(
    resolvedAccountId ? `/api/folders?account=${resolvedAccountId}` : '/api/folders',
    fetcher,
    { revalidateOnFocus: false }
  )

  const folders: FolderItem[] = foldersData?.data?.length ? foldersData.data : FALLBACK_FOLDERS
  const specialFolders = folders.filter(f => f.special)
  const customFolders = folders.filter(f => !f.special)

  const switchAccount = (id: string) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('synapmail:activeAccountId', id)
      window.dispatchEvent(new CustomEvent('synapmail:account-change', { detail: id }))
    }
    setActiveAccountId(id)
    setAccountOpen(false)
  }

  const handleFolderClick = () => { onClose?.() }

  const handleDragOver = (e: React.DragEvent, path: string) => {
    if (!e.dataTransfer.types.includes('application/synapmail')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverPath(path)
  }

  const handleDragLeave = () => setDragOverPath(null)

  const handleDrop = async (e: React.DragEvent, destinationPath: string) => {
    e.preventDefault()
    setDragOverPath(null)
    const raw = e.dataTransfer.getData('application/synapmail')
    if (!raw) return
    const { uids, accountId, folder } = JSON.parse(raw) as { uids: string[]; accountId: string; folder: string }
    if (!uids?.length || destinationPath === folder) return
    await fetch('/api/messages/bulk', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uids, action: 'move', accountId, folder, destination: destinationPath }),
    })
  }

  // ─── COLLAPSED MODE ──────────────────────────────────────────────────────────
  if (collapsed) {
    return (
      <div className="flex flex-col h-full items-center py-3 gap-1">
        {/* Logo */}
        <div className="mb-2">
          <img src="/brand/svg/synapmail-icone-negatif.svg" alt="Synapmail" className="w-7 h-7" />
        </div>

        {/* Account dot */}
        {activeAccount && hasMultipleAccounts && (
          <button
            onClick={onToggleCollapse}
            title={activeAccount.email}
            className={cn('w-7 h-7 rounded-full mb-1 transition-all hover:ring-2 hover:ring-white/30 shrink-0', ACCOUNT_COLORS[accountColorIdx])}
          />
        )}

        {/* Compose icon */}
        <button
          onClick={dispatchCompose}
          title={t('compose')}
          className="w-10 h-10 flex items-center justify-center rounded-xl bg-blue-500 hover:bg-blue-400 text-white transition-all shadow-lg shadow-blue-500/25 mb-2 shrink-0"
        >
          <PenSquare className="w-4 h-4" />
        </button>

        {/* Nav icons */}
        <nav className="flex-1 w-full px-1.5 space-y-0.5 overflow-y-auto">
          {specialFolders.map(folder => {
            const Icon = SPECIAL_ICONS[folder.special!] ?? Folder
            const label = SPECIAL_LABELS[folder.special!]
            const isActive = pathname.startsWith('/mail') && currentFolder === folder.path
            const isDragOver = dragOverPath === folder.path
            const unread = folder.unreadCount ?? 0
            return (
              <Link
                key={folder.path}
                href={`/mail?folder=${encodeURIComponent(folder.path)}`}
                onClick={handleFolderClick}
                onDragOver={e => handleDragOver(e, folder.path)}
                onDragLeave={handleDragLeave}
                onDrop={e => handleDrop(e, folder.path)}
                title={label ? t(label) : folder.name}
                className={cn(
                  'flex items-center justify-center w-full h-9 rounded-lg transition-all relative',
                  isDragOver
                    ? 'bg-blue-500/30 ring-1 ring-blue-400 text-white'
                    : isActive
                      ? 'bg-white/15 text-white'
                      : 'text-zinc-400 hover:text-zinc-100 hover:bg-white/8'
                )}
              >
                <Icon className={cn('w-4 h-4', isActive && 'text-blue-400')} />
                {unread > 0 && (
                  <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-blue-400" />
                )}
              </Link>
            )
          })}

          {customFolders.length > 0 && (
            <>
              <div className="py-2 flex justify-center">
                <div className="w-4 border-t border-white/10" />
              </div>
              {customFolders.map(folder => {
                const isActive = pathname.startsWith('/mail') && currentFolder === folder.path
                const isDragOver = dragOverPath === folder.path
                return (
                  <Link
                    key={folder.path}
                    href={`/mail?folder=${encodeURIComponent(folder.path)}`}
                    onClick={handleFolderClick}
                    onDragOver={e => handleDragOver(e, folder.path)}
                    onDragLeave={handleDragLeave}
                    onDrop={e => handleDrop(e, folder.path)}
                    title={folder.name}
                    className={cn(
                      'flex items-center justify-center w-full h-9 rounded-lg transition-all',
                      isDragOver
                        ? 'bg-blue-500/30 ring-1 ring-blue-400 text-white'
                        : isActive
                          ? 'bg-white/15 text-white'
                          : 'text-zinc-500 hover:text-zinc-200 hover:bg-white/8'
                    )}
                  >
                    <Folder className="w-3.5 h-3.5" />
                  </Link>
                )
              })}
            </>
          )}
        </nav>

        {/* Footer */}
        <div className="w-full px-1.5 border-t border-white/10 pt-2 space-y-0.5">
          <ThemeToggle collapsed />
          <Link
            href="/settings"
            onClick={handleFolderClick}
            title={t('settings')}
            className="flex items-center justify-center w-full h-9 rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-white/8 transition-all"
          >
            <Settings className="w-4 h-4" />
          </Link>
          <button
            onClick={onToggleCollapse}
            title="Agrandir la barre latérale"
            className="flex items-center justify-center w-full h-9 rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-white/8 transition-all"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    )
  }

  // ─── EXPANDED MODE ───────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-5 py-5">
        <img
          src="/brand/svg/synapmail-icone-negatif.svg"
          alt="Synapmail"
          className="w-8 h-8 shrink-0"
        />
        <span className="font-bold text-base tracking-tight text-white">Synapmail</span>
        {onClose ? (
          <button
            onClick={onClose}
            className="ml-auto w-7 h-7 flex items-center justify-center rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-white/10 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        ) : onToggleCollapse ? (
          <button
            onClick={onToggleCollapse}
            title="Réduire la barre latérale"
            className="ml-auto w-7 h-7 flex items-center justify-center rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-white/10 transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        ) : null}
      </div>

      {/* Account switcher */}
      {hasMultipleAccounts && activeAccount && (
        <div className="px-3 mb-2">
          <button
            onClick={() => setAccountOpen(o => !o)}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-white/8 transition-colors text-sm"
          >
            <div className={cn('w-5 h-5 rounded-full shrink-0', ACCOUNT_COLORS[accountColorIdx])} />
            <span className="text-zinc-200 truncate flex-1 text-left">{activeAccount.email}</span>
            <ChevronDown className={cn('w-3.5 h-3.5 text-zinc-500 transition-transform shrink-0', accountOpen && 'rotate-180')} />
          </button>
          {accountOpen && (
            <div className="mt-1 rounded-lg overflow-hidden border border-white/10 bg-zinc-800">
              {accounts.map((acc, idx) => (
                <button
                  key={acc.id}
                  onClick={() => switchAccount(acc.id)}
                  className={cn(
                    'w-full flex items-center gap-2.5 px-3 py-2 text-sm transition-colors text-left',
                    acc.id === activeAccount?.id
                      ? 'bg-white/10 text-white'
                      : 'text-zinc-400 hover:text-zinc-100 hover:bg-white/8'
                  )}
                >
                  <div className={cn('w-4 h-4 rounded-full shrink-0', ACCOUNT_COLORS[idx % ACCOUNT_COLORS.length])} />
                  <span className="truncate">{acc.email}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Compose button */}
      <div className="px-3 mb-4">
        <button
          onClick={dispatchCompose}
          className="w-full flex items-center gap-2.5 px-4 py-2.5 rounded-xl bg-blue-500 hover:bg-blue-400 text-white text-sm font-semibold transition-all shadow-lg shadow-blue-500/25 hover:shadow-blue-500/40 active:scale-[0.98]"
        >
          <PenSquare className="w-4 h-4" />
          {t('compose')}
        </button>
      </div>

      {/* Main folders */}
      <nav className="flex-1 overflow-y-auto px-2 space-y-0.5">
        {specialFolders.map(folder => {
          const Icon = SPECIAL_ICONS[folder.special!] ?? Folder
          const label = SPECIAL_LABELS[folder.special!]
          const isActive = pathname.startsWith('/mail') && currentFolder === folder.path
          const isDragOver = dragOverPath === folder.path
          const unread = folder.unreadCount ?? 0
          return (
            <Link
              key={folder.path}
              href={`/mail?folder=${encodeURIComponent(folder.path)}`}
              onClick={handleFolderClick}
              onDragOver={e => handleDragOver(e, folder.path)}
              onDragLeave={handleDragLeave}
              onDrop={e => handleDrop(e, folder.path)}
              className={cn(
                'flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all',
                isDragOver
                  ? 'bg-blue-500/30 ring-1 ring-blue-400 text-white'
                  : isActive
                    ? 'bg-white/15 text-white font-medium'
                    : 'text-zinc-400 hover:text-zinc-100 hover:bg-white/8'
              )}
            >
              <Icon className={cn('w-4 h-4 shrink-0', isActive ? 'text-blue-400' : '')} />
              <span className="flex-1">{label ? t(label) : folder.name}</span>
              {unread > 0 && (
                <span className={cn(
                  'text-[11px] font-semibold min-w-[20px] h-5 px-1.5 rounded-full flex items-center justify-center',
                  isActive ? 'bg-white/20 text-white' : 'bg-blue-500/20 text-blue-400'
                )}>
                  {unread > 99 ? '99+' : unread}
                </span>
              )}
            </Link>
          )
        })}

        {/* Custom folders */}
        {customFolders.length > 0 && (
          <>
            <div className="pt-4 pb-1 px-3">
              <span className="text-xs font-semibold text-zinc-500 uppercase tracking-widest">Dossiers</span>
            </div>
            {customFolders.map(folder => {
              const isActive = pathname.startsWith('/mail') && currentFolder === folder.path
              const isDragOver = dragOverPath === folder.path
              const unread = folder.unreadCount ?? 0
              return (
                <Link
                  key={folder.path}
                  href={`/mail?folder=${encodeURIComponent(folder.path)}`}
                  onClick={handleFolderClick}
                  onDragOver={e => handleDragOver(e, folder.path)}
                  onDragLeave={handleDragLeave}
                  onDrop={e => handleDrop(e, folder.path)}
                  className={cn(
                    'flex items-center gap-3 px-3 py-1.5 rounded-lg text-sm transition-all',
                    isDragOver
                      ? 'bg-blue-500/30 ring-1 ring-blue-400 text-white'
                      : isActive
                        ? 'bg-white/15 text-white font-medium'
                        : 'text-zinc-500 hover:text-zinc-200 hover:bg-white/8'
                  )}
                >
                  <Folder className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate flex-1">{folder.name}</span>
                  {unread > 0 && (
                    <span className="text-[11px] font-semibold text-zinc-500">{unread}</span>
                  )}
                </Link>
              )
            })}
          </>
        )}
      </nav>

      {/* Footer */}
      <div className="p-2 border-t border-white/10 space-y-0.5">
        <ThemeToggle />
        <Link
          href="/settings"
          onClick={handleFolderClick}
          className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-zinc-500 hover:text-zinc-200 hover:bg-white/8 transition-all"
        >
          <Settings className="w-4 h-4" />
          {t('settings')}
        </Link>
      </div>
    </div>
  )
}
