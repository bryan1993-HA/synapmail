'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { RefreshCw, Mail } from 'lucide-react'
import { cn } from '@/lib/utils'
import useSWR from 'swr'
import type { Message } from '@/types/email'

const fetcher = (url: string) => fetch(url).then(r => r.json())

const formatDate = (iso: string) => {
  const d = new Date(iso)
  const now = new Date()
  const isToday = d.toDateString() === now.toDateString()
  if (isToday) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

interface Props {
  folder: string
  selectedUid: string | null
  onSelect: (uid: string, accountId: string) => void
}

export function MessageList({ folder, selectedUid, onSelect }: Props) {
  const t = useTranslations('mail')
  const [filter, setFilter] = useState<'all' | 'unread'>('all')

  const { data, isValidating, mutate } = useSWR<{ messages: Message[]; total: number }>(
    `/api/messages?folder=${encodeURIComponent(folder)}&filter=${filter}&page=1&perPage=30`,
    fetcher,
    { refreshInterval: 30000 }
  )

  const messages = data?.messages ?? []

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border shrink-0">
        <div className="flex rounded-lg overflow-hidden border border-border text-xs font-medium">
          {(['all', 'unread'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                'px-2.5 py-1 transition-colors',
                filter === f ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {t(f)}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <button
          onClick={() => mutate()}
          disabled={isValidating}
          className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        >
          <RefreshCw className={cn('w-3.5 h-3.5', isValidating && 'animate-spin')} />
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto divide-y divide-border">
        {!data && (
          <div className="space-y-0">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="flex gap-3 px-3 py-3">
                <div className="w-8 h-8 rounded-full bg-muted animate-pulse shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3.5 bg-muted animate-pulse rounded w-32" />
                  <div className="h-3 bg-muted animate-pulse rounded w-full" />
                  <div className="h-3 bg-muted animate-pulse rounded w-3/4" />
                </div>
              </div>
            ))}
          </div>
        )}

        {data && messages.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Mail className="w-8 h-8 mb-2 opacity-30" />
            <p className="text-sm">{t('noMessages')}</p>
          </div>
        )}

        {messages.map(msg => (
          <button
            key={msg.uid}
            onClick={() => onSelect(msg.uid, msg.accountId)}
            className={cn(
              'w-full text-left flex gap-3 px-3 py-3 hover:bg-accent/50 transition-colors',
              selectedUid === msg.uid && 'bg-primary/5',
              !msg.isRead && 'bg-primary/[0.03]'
            )}
          >
            {/* Avatar */}
            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0 text-primary text-xs font-semibold">
              {msg.from.name?.[0]?.toUpperCase() ?? msg.from.address[0]?.toUpperCase()}
            </div>
            {/* Content */}
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline justify-between gap-1">
                <span className={cn('text-sm truncate', !msg.isRead ? 'font-semibold text-foreground' : 'text-muted-foreground')}>
                  {msg.from.name || msg.from.address}
                </span>
                <span className="text-xs text-muted-foreground shrink-0">{formatDate(msg.date)}</span>
              </div>
              <div className={cn('text-xs truncate mt-0.5', !msg.isRead ? 'font-medium text-foreground' : 'text-muted-foreground')}>
                {msg.subject}
              </div>
              <div className="text-xs text-muted-foreground truncate mt-0.5">
                {msg.preview}
              </div>
            </div>
            {/* Unread dot */}
            {!msg.isRead && (
              <div className="w-1.5 h-1.5 rounded-full bg-primary shrink-0 mt-2" />
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
