'use client'

import { useState, useEffect } from 'react'
import useSWR from 'swr'
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

const PER_PAGE_OPTIONS = [10, 20, 30, 50, 100]

function Toggle({ checked, onChange, label, description }: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  description: string
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
      </div>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={cn(
          'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200',
          checked ? 'bg-primary' : 'bg-muted'
        )}
      >
        <span
          className={cn(
            'pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm ring-0 transition-transform duration-200',
            checked ? 'translate-x-5' : 'translate-x-0'
          )}
        />
      </button>
    </div>
  )
}

export default function ReadingPage() {
  const { data, mutate } = useSWR<{ data: UserSettings }>('/api/settings', fetcher)
  const settings = data?.data

  const [messagesPerPage, setMessagesPerPage] = useState(30)
  const [threadView, setThreadView] = useState(true)
  const [readingPane, setReadingPane] = useState(true)
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    if (settings) {
      setMessagesPerPage(settings.messages_per_page)
      setThreadView(settings.thread_view)
      setReadingPane(settings.reading_pane)
    }
  }, [settings])

  const handleSave = async () => {
    setSaving(true)
    try {
      await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages_per_page: messagesPerPage,
          thread_view: threadView,
          reading_pane: readingPane,
        }),
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
      <h1 className="text-2xl font-bold mb-1">Lecture</h1>
      <p className="text-sm text-muted-foreground mb-8">Configurez l&apos;affichage de vos messages</p>

      <div className="space-y-6">
        {/* Messages per page */}
        <div className="border border-border rounded-xl p-5 space-y-4">
          <div>
            <h2 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground">Messages par page</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Nombre de messages affichés dans la liste</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {PER_PAGE_OPTIONS.map(n => (
              <button
                key={n}
                type="button"
                onClick={() => setMessagesPerPage(n)}
                className={cn(
                  'px-4 py-2 rounded-lg border-2 text-sm font-medium transition-all',
                  messagesPerPage === n
                    ? 'border-primary bg-primary/5 text-primary'
                    : 'border-border text-muted-foreground hover:border-border/80 hover:bg-accent/50 hover:text-foreground'
                )}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        {/* Toggles */}
        <div className="border border-border rounded-xl p-5 space-y-5">
          <h2 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground">Options d&apos;affichage</h2>
          <Toggle
            checked={threadView}
            onChange={setThreadView}
            label="Vue en fil de discussion"
            description="Regrouper les messages par conversation (style Gmail)"
          />
          <div className="border-t border-border" />
          <div className="opacity-60 pointer-events-none">
            <Toggle
              checked={readingPane}
              onChange={setReadingPane}
              label="Volet de lecture"
              description="Afficher le contenu du message dans la colonne de droite"
            />
          </div>
          <div className="-mt-3 mb-1">
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
              Bientôt disponible
            </span>
          </div>
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
