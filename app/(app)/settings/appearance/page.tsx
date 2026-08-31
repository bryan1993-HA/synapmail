'use client'

import { useState, useEffect } from 'react'
import { useTheme } from 'next-themes'
import useSWR from 'swr'
import { Sun, Moon, Monitor, Check } from 'lucide-react'
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

const THEMES = [
  { value: 'light',  label: 'Clair',   icon: Sun },
  { value: 'dark',   label: 'Sombre',  icon: Moon },
  { value: 'system', label: 'Système', icon: Monitor },
] as const

const LANGUAGES = [
  { value: 'fr', label: 'Français' },
  { value: 'en', label: 'English' },
]

export default function AppearancePage() {
  const { setTheme } = useTheme()
  const { data, mutate } = useSWR<{ data: UserSettings }>('/api/settings', fetcher)
  const settings = data?.data

  const [selectedTheme, setSelectedTheme] = useState('system')
  const [selectedLang, setSelectedLang] = useState('fr')
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    if (settings) {
      setSelectedTheme(settings.theme)
      setSelectedLang(settings.language)
    }
  }, [settings])

  const handleSave = async () => {
    setSaving(true)
    try {
      setTheme(selectedTheme)

      // Pose le cookie de locale — lu par lib/i18n.ts à chaque requête serveur
      document.cookie = `synapmail-locale=${selectedLang}; path=/; max-age=31536000; SameSite=Lax`

      await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme: selectedTheme, language: selectedLang }),
      })
      await mutate()

      const langChanged = selectedLang !== (settings?.language ?? 'fr')
      if (langChanged) {
        // Rechargement pour appliquer la nouvelle locale côté serveur
        window.location.reload()
      } else {
        setSuccess(true)
        setTimeout(() => setSuccess(false), 2000)
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-8 max-w-lg">
      <h1 className="text-2xl font-bold mb-1">Apparence</h1>
      <p className="text-sm text-muted-foreground mb-8">Personnalisez l&apos;affichage de Synapmail</p>

      <div className="space-y-8">
        {/* Theme */}
        <div className="border border-border rounded-xl p-5 space-y-4">
          <div>
            <h2 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground">Thème</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Choisissez l&apos;apparence de l&apos;interface</p>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {THEMES.map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                type="button"
                onClick={() => setSelectedTheme(value)}
                className={cn(
                  'relative flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all',
                  selectedTheme === value
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-border/80 hover:bg-accent/50'
                )}
              >
                {selectedTheme === value && (
                  <span className="absolute top-2 right-2 w-4 h-4 bg-primary rounded-full flex items-center justify-center">
                    <Check className="w-2.5 h-2.5 text-primary-foreground" />
                  </span>
                )}
                <Icon className={cn('w-5 h-5', selectedTheme === value ? 'text-primary' : 'text-muted-foreground')} />
                <span className={cn('text-xs font-medium', selectedTheme === value ? 'text-primary' : 'text-muted-foreground')}>
                  {label}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Language */}
        <div className="border border-border rounded-xl p-5 space-y-4">
          <div>
            <h2 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground">Langue</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Langue de l&apos;interface (nécessite un rechargement)</p>
          </div>
          <div className="flex gap-3">
            {LANGUAGES.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                onClick={() => setSelectedLang(value)}
                className={cn(
                  'flex items-center gap-2 px-4 py-2.5 rounded-lg border-2 text-sm font-medium transition-all',
                  selectedLang === value
                    ? 'border-primary bg-primary/5 text-primary'
                    : 'border-border text-muted-foreground hover:border-border/80 hover:bg-accent/50 hover:text-foreground'
                )}
              >
                {selectedLang === value && <Check className="w-3.5 h-3.5" />}
                {label}
              </button>
            ))}
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
