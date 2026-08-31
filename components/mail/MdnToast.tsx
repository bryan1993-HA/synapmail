'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Mail, X } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface MdnToastProps {
  uid: string
  accountId: string
  folder: string
  fromName: string
  subject: string
  dispositionNotificationTo: string
  onDismiss: () => void
}

const DURATION = 30 // seconds

export function MdnToast({
  uid,
  accountId,
  folder,
  fromName,
  subject,
  onDismiss,
}: MdnToastProps) {
  const [timeLeft, setTimeLeft] = useState(DURATION)
  const [sending, setSending] = useState(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const dismissRef = useRef(onDismiss)
  dismissRef.current = onDismiss

  useEffect(() => {
    timerRef.current = setInterval(() => {
      setTimeLeft(t => {
        if (t <= 1) {
          clearInterval(timerRef.current!)
          dismissRef.current()
          return 0
        }
        return t - 1
      })
    }, 1000)
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [])

  const handleSend = useCallback(async () => {
    setSending(true)
    if (timerRef.current) clearInterval(timerRef.current)
    try {
      await fetch(`/api/messages/${uid}/mdn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId, folder }),
      })
    } finally {
      dismissRef.current()
    }
  }, [uid, accountId, folder])

  const handleIgnore = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    dismissRef.current()
  }, [])

  const pct = (timeLeft / DURATION) * 100

  return (
    <div className="fixed bottom-20 right-4 z-50 w-80 rounded-2xl border border-border bg-popover shadow-xl overflow-hidden">
      {/* Progress bar at top */}
      <div className="h-0.5 bg-muted">
        <div
          className="h-full bg-primary"
          style={{ width: `${pct}%`, transition: 'width 1s linear' }}
        />
      </div>

      <div className="p-4 flex flex-col gap-3">
        {/* Header */}
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center shrink-0 mt-0.5">
            <Mail className="w-4 h-4 text-blue-600 dark:text-blue-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-foreground leading-tight">
              Accusé de lecture demandé
            </p>
            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
              <span className="font-medium text-foreground/80">{fromName || 'Expéditeur inconnu'}</span>
              {' '}demande une confirmation pour{' '}
              <span className="italic">«&nbsp;{subject}&nbsp;»</span>
            </p>
          </div>
          <button
            onClick={handleIgnore}
            className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Ignorer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleSend}
            disabled={sending}
            className={cn(
              'flex-1 h-8 rounded-lg text-xs font-medium transition-colors',
              'bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-60'
            )}
          >
            {sending ? 'Envoi…' : 'Envoyer l\'accusé'}
          </button>
          <button
            onClick={handleIgnore}
            className={cn(
              'flex-1 h-8 rounded-lg text-xs font-medium transition-colors',
              'border border-border text-muted-foreground hover:text-foreground hover:bg-accent'
            )}
          >
            Ignorer
          </button>
          <div className="w-9 h-8 flex items-center justify-center text-xs font-mono text-muted-foreground tabular-nums shrink-0">
            {timeLeft}s
          </div>
        </div>
      </div>
    </div>
  )
}
