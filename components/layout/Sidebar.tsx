'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import {
  Mail, Send, FileText, AlertTriangle, Trash2,
  Settings, PenSquare, Folder, Archive, X, ChevronDown,
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

const FALLBACK_FOLDERS = [
  { path: 'INBOX', name: 'INBOX', special: 'inbox' as SpecialKey },
  { path: 'Sent Items', name: 'Sent Items', special: 'sent' as SpecialKey },
  { path: 'Drafts', name: 'Drafts', special: 'drafts' as SpecialKey },
  { path: 'Junk Email', name: 'Junk Email', special: 'spam' as SpecialKey },
  { path: 'Deleted Items', name: 'Deleted Items', special: 'trash' as SpecialKey },
]

const dispatchCompose = () => window.dispatchEvent(new CustomEvent('synapmail:compose'))

const ACCOUNT_COLORS = ['bg-blue-500', 'bg-violet-500', 'bg-emerald-500', 'bg-amber-500', 'bg-rose-500']

interface SidebarProps {
  onClose?: () => void
}

export function Sidebar({ onClose }: SidebarProps) {
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

  const { data: foldersData } = useSWR<{ data: { name: string; path: string; special: SpecialKey }[] }>(
    resolvedAccountId ? `/api/folders?account=${resolvedAccountId}` : '/api/folders',
    fetcher,
    { revalidateOnFocus: false }
  )

  const folders = foldersData?.data?.length ? foldersData.data : FALLBACK_FOLDERS
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

  const handleFolderClick = () => {
    onClose?.()
  }

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
        {onClose && (
          <button
            onClick={onClose}
            className="ml-auto w-7 h-7 flex items-center justify-center rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-white/10 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Account switcher */}
      {hasMultipleAccounts && activeAccount && (
        <div className="px-3 mb-2">
          <button
            onClick={() => setAccountOpen(o => !o)}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-white/8 transition-colors text-sm"
          >
            <div className={cn('w-5 h-5 rounded-full shrink-0', ACCOUNT_COLORS[accounts.indexOf(activeAccount) % ACCOUNT_COLORS.length])} />
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
              <span>{label ? t(label) : folder.name}</span>
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
                  <span className="truncate">{folder.name}</span>
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
