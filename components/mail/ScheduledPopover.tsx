'use client'

import { useState, useRef, useEffect } from 'react'
import { Clock, X } from 'lucide-react'
import useSWR from 'swr'
import { cn } from '@/lib/utils'

type ScheduledEmail = {
  id: string
  to_addresses: string
  subject: string
  send_at: string
}

const fetcher = (url: string) => fetch(url).then(r => r.json())

const formatSendAt = (iso: string) => {
  const d = new Date(iso)
  const now = new Date()
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)

  const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
  if (d.toDateString() === now.toDateString()) return `Aujourd'hui ${time}`
  if (d.toDateString() === tomorrow.toDateString()) return `Demain ${time}`
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) + ` ${time}`
}

export function ScheduledPopover() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const { data, mutate } = useSWR<{ data: ScheduledEmail[] }>(
    '/api/scheduled',
    fetcher,
    { refreshInterval: 60_000 }
  )

  const items = data?.data ?? []
  const count = items.length

  // Refresh when a scheduled email is sent (SSE fires custom event)
  useEffect(() => {
    const handler = () => mutate()
    window.addEventListener('synapmail:scheduled-sent', handler)
    return () => window.removeEventListener('synapmail:scheduled-sent', handler)
  }, [mutate])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const cancel = async (id: string) => {
    await fetch(`/api/scheduled/${id}`, { method: 'DELETE' })
    mutate()
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(v => !v)}
        title={count > 0 ? `${count} envoi${count > 1 ? 's' : ''} programmé${count > 1 ? 's' : ''}` : 'Envois programmés'}
        className={cn(
          'relative w-7 h-7 flex items-center justify-center rounded-lg transition-colors',
          open || count > 0
            ? 'text-primary bg-primary/10'
            : 'text-muted-foreground hover:text-foreground hover:bg-accent'
        )}
      >
        <Clock className="w-3.5 h-3.5" />
        {count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 text-[9px] font-bold bg-primary text-primary-foreground rounded-full flex items-center justify-center leading-none">
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-9 z-50 w-72 bg-popover border border-border rounded-xl shadow-xl overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
            <span className="text-xs font-semibold">Envois programmés</span>
            <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground transition-colors">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {items.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <Clock className="w-7 h-7 text-muted-foreground/30 mx-auto mb-2" />
              <p className="text-xs text-muted-foreground">Aucun envoi programmé</p>
            </div>
          ) : (
            <div className="max-h-80 overflow-y-auto divide-y divide-border">
              {items.map(item => {
                const toList = JSON.parse(item.to_addresses) as string[]
                return (
                  <div key={item.id} className="px-3 py-2.5 hover:bg-muted/40 transition-colors group">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium truncate">{item.subject || '(sans objet)'}</p>
                        <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                          À : {toList.join(', ')}
                        </p>
                        <p className="text-[11px] text-primary mt-1 flex items-center gap-1">
                          <Clock className="w-2.5 h-2.5" />
                          {formatSendAt(item.send_at)}
                        </p>
                      </div>
                      <button
                        onClick={() => cancel(item.id)}
                        title="Annuler l'envoi"
                        className="shrink-0 mt-0.5 text-muted-foreground hover:text-destructive transition-colors opacity-0 group-hover:opacity-100"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
