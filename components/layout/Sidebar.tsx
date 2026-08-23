'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import {
  Mail, Send, FileText, AlertTriangle, Trash2,
  Star, Settings, Plus,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const STANDARD_FOLDERS = [
  { key: 'INBOX', icon: Mail, label: 'inbox' },
  { key: 'Sent', icon: Send, label: 'sent' },
  { key: 'Drafts', icon: FileText, label: 'drafts' },
  { key: 'Starred', icon: Star, label: 'starred' },
  { key: 'Spam', icon: AlertTriangle, label: 'spam' },
  { key: 'Trash', icon: Trash2, label: 'trash' },
] as const

export function Sidebar() {
  const t = useTranslations('mail')
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const currentFolder = searchParams.get('folder') ?? 'INBOX'

  return (
    <div className="flex flex-col h-full p-3 gap-2">
      {/* Logo */}
      <div className="flex items-center gap-2 px-2 py-1 mb-1">
        <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center shrink-0">
          <Mail className="w-4 h-4 text-primary-foreground" />
        </div>
        <span className="font-semibold text-sm tracking-tight">Synapmail</span>
      </div>

      {/* Compose button */}
      <Button className="w-full justify-start gap-2 h-9" size="sm">
        <Plus className="w-4 h-4" />
        {t('compose')}
      </Button>

      {/* Folders */}
      <nav className="flex-1 overflow-y-auto space-y-0.5 mt-2">
        {STANDARD_FOLDERS.map(folder => {
          const Icon = folder.icon
          const isActive = pathname.startsWith('/mail') && currentFolder === folder.key
          return (
            <Link
              key={folder.key}
              href={`/mail?folder=${folder.key}`}
              className={cn(
                'flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-sm transition-colors',
                isActive
                  ? 'bg-primary/10 text-primary font-medium'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent'
              )}
            >
              <Icon className="w-4 h-4 shrink-0" />
              {t(folder.label)}
            </Link>
          )
        })}
      </nav>

      {/* Settings link */}
      <Link
        href="/settings"
        className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
      >
        <Settings className="w-4 h-4" />
        {t('settings')}
      </Link>
    </div>
  )
}
