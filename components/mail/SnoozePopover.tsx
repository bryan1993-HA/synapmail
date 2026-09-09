'use client'

import { useState, useRef, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { Clock, X, Inbox } from 'lucide-react'
import useSWR from 'swr'
import { cn } from '@/lib/utils'

type SnoozedItem = {
  uid: string
  accountId: string
  folder: string
  subject: string
  fromAddress: string | null
  fromName: string | null
  snoozeUntil: string
}

const fetcher = (url: string) => fetch(url).then(r => r.json())

const formatWake = (iso: string) => {
  const d = new Date(iso)
  const now = new Date()
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (d.toDateString() === now.toDateString()) return `${time}`
  if (d.toDateString() === tomorrow.toDateString()) return `Demain ${time}`
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' }) + ` ${time}`
}

export function SnoozePopover({ activeAccountId }: { activeAccountId?: string | null }) {
  const t = useTranslations('mail')
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const { data, mutate } = useSWR<{ data: SnoozedItem[] }>(
    activeAccountId ? `/api/snoozed?account=${activeAccountId}` : '/api/snoozed',
    fetcher,
    { refreshInterval: 60_000 },
  )

  const items = data?.data ?? []
  const count = items.length

  useEffect(() => {
    const handler = () => mutate()
    window.addEventListener('synapmail:snooze-changed', handler)
    return () => window.removeEventListener('synapmail:snooze-changed', handler)
  }, [mutate])

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const unsnooze = async (item: SnoozedItem) => {
    await fetch(
      `/api/messages/${item.uid}/snooze?account=${item.accountId}&folder=${encodeURIComponent(item.folder)}`,
      { method: 'DELETE' },
    )
    mutate()
    window.dispatchEvent(new CustomEvent('synapmail:snooze-changed'))
  }

  if (count === 0 && !open) {
    return (
      <button
        onClick={() => setOpen(true)}
        title={t('snoozed')}
        className="w-7 h-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
      >
        <Clock className="w-3.5 h-3.5" />
      </button>
    )
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(v => !v)}
        title={t('snoozed')}
        className={cn(
          'relative w-7 h-7 flex items-center justify-center rounded-lg transition-colors',
          open || count > 0 ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:text-foreground hover:bg-accent',
        )}
      >
        <Clock className="w-3.5 h-3.5" />
        {count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-3.5 px-0.5 text-[9px] font-bold bg-primary text-primary-foreground rounded-full flex items-center justify-center leading-none">
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-9 z-50 w-72 bg-popover border border-border rounded-xl shadow-xl overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
            <span className="text-xs font-semibold">{t('snoozed')}</span>
            <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground transition-colors">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {items.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <Clock className="w-7 h-7 text-muted-foreground/30 mx-auto mb-2" />
              <p className="text-xs text-muted-foreground">{t('snoozedEmpty')}</p>
            </div>
          ) : (
            <div className="max-h-80 overflow-y-auto divide-y divide-border">
              {items.map(item => (
                <div key={`${item.accountId}-${item.folder}-${item.uid}`} className="px-3 py-2.5 hover:bg-muted/40 transition-colors group">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium truncate">{item.subject || t('noSubject')}</p>
                      <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                        {item.fromName || item.fromAddress}
                      </p>
                      <p className="text-[11px] text-primary mt-1 flex items-center gap-1">
                        <Clock className="w-2.5 h-2.5" />
                        {formatWake(item.snoozeUntil)}
                      </p>
                    </div>
                    <button
                      onClick={() => unsnooze(item)}
                      title={t('unsnooze')}
                      className="shrink-0 mt-0.5 text-muted-foreground hover:text-primary transition-colors opacity-0 group-hover:opacity-100"
                    >
                      <Inbox className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
