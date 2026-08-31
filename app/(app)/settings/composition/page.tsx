'use client'

import { useState, useEffect } from 'react'
import useSWR from 'swr'
import { Timer, TimerOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface UserSettings {
  theme: string
  language: string
  messages_per_page: number
  thread_view: boolean
  reading_pane: boolean
  notifications: boolean
  undo_send_delay: number
}

const fetcher = (url: string) => fetch(url).then(r => r.json())

const DELAY_OPTIONS = [
  { value: 0,  label: 'Désactivé', description: 'Envoi immédiat' },
  { value: 5,  label: '5 secondes',  description: null },
  { value: 10, label: '10 secondes', description: 'Recommandé' },
  { value: 30, label: '30 secondes', description: null },
]

export default function CompositionPage() {
  const { data, mutate } = useSWR<{ data: UserSettings }>('/api/settings', fetcher)
  const settings = data?.data

  const [undoDelay, setUndoDelay] = useState(10)
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    if (settings) setUndoDelay(settings.undo_send_delay)
  }, [settings])

  const handleSave = async () => {
    setSaving(true)
    try {
      await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ undo_send_delay: undoDelay }),
      })
      await mutate()
      setSuccess(true)
      setTimeout(() => setSuccess(false), 2000)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-8 max-w-lg">
      <h1 className="text-2xl font-bold mb-1">Composition</h1>
      <p className="text-sm text-muted-foreground mb-8">Options liées à la rédaction et à l&apos;envoi</p>

      <div className="space-y-6">
        {/* Undo Send */}
        <div className="border border-border rounded-xl p-5 space-y-4">
          <div className="flex items-start gap-3">
            {undoDelay > 0
              ? <Timer className="w-5 h-5 text-primary mt-0.5 shrink-0" />
              : <TimerOff className="w-5 h-5 text-muted-foreground mt-0.5 shrink-0" />
            }
            <div>
              <h2 className="font-semibold text-sm">Annulation d&apos;envoi</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Après avoir cliqué sur &quot;Envoyer&quot;, un toast apparaît avec un compte à rebours.
                Vous pouvez annuler pendant ce délai. Uniquement pour les envois immédiats.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {DELAY_OPTIONS.map(({ value, label, description }) => (
              <button
                key={value}
                type="button"
                onClick={() => setUndoDelay(value)}
                className={cn(
                  'flex flex-col items-start px-4 py-3 rounded-xl border-2 text-left transition-all',
                  undoDelay === value
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-border/80 hover:bg-accent/50'
                )}
              >
                <span className={cn(
                  'text-sm font-medium',
                  undoDelay === value ? 'text-primary' : 'text-foreground'
                )}>
                  {label}
                </span>
                {description && (
                  <span className="text-xs text-muted-foreground mt-0.5">{description}</span>
                )}
              </button>
            ))}
          </div>

          {undoDelay > 0 && (
            <p className="text-xs text-muted-foreground bg-muted/50 rounded-lg px-3 py-2">
              Le modal se fermera immédiatement. Un toast &quot;Envoi dans {undoDelay}s… Annuler&quot; apparaîtra en bas de l&apos;écran.
            </p>
          )}
        </div>

        {success && (
          <div className="p-3 rounded-lg bg-green-500/10 text-green-600 dark:text-green-400 text-sm">
            Paramètres enregistrés
          </div>
        )}

        <Button onClick={handleSave} disabled={saving}>
          {saving ? 'Enregistrement…' : 'Enregistrer'}
        </Button>
      </div>
    </div>
  )
}
