'use client'

import { useState, useEffect } from 'react'
import { useTheme } from 'next-themes'
import { useTranslations } from 'next-intl'
import useSWR from 'swr'
import { Sun, Moon, Monitor, Palette } from 'lucide-react'
import {
  SettingsPage, SettingsHeader, SettingsSection, ChoiceCards, Chips, SaveBar,
} from '@/components/settings/primitives'

interface UserSettings {
  theme: string
  language: string
}

const fetcher = (url: string) => fetch(url).then(r => r.json())

export default function AppearancePage() {
  const t = useTranslations('settings.appearance')
  const tc = useTranslations('settings.common')
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

  const dirty = !!settings
    && (selectedTheme !== settings.theme || selectedLang !== settings.language)

  const handleSave = async () => {
    setSaving(true)
    try {
      setTheme(selectedTheme)
      document.cookie = `synapmail-locale=${selectedLang}; path=/; max-age=31536000; SameSite=Lax`

      await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme: selectedTheme, language: selectedLang }),
      })
      await mutate()

      if (selectedLang !== (settings?.language ?? 'fr')) {
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
    <SettingsPage width="xl">
      <SettingsHeader icon={<Palette className="h-4 w-4" />} title={t('title')} description={t('description')} />

      <div className="space-y-6">
        <SettingsSection title={t('theme')} description={t('themeDesc')}>
          <ChoiceCards
            columns={3}
            center
            value={selectedTheme}
            onChange={setSelectedTheme}
            options={[
              { value: 'light', label: t('light'), icon: Sun },
              { value: 'dark', label: t('dark'), icon: Moon },
              { value: 'system', label: t('system'), icon: Monitor },
            ]}
          />
        </SettingsSection>

        <SettingsSection title={t('language')} description={t('languageDesc')}>
          <Chips
            value={selectedLang}
            onChange={setSelectedLang}
            options={[
              { value: 'fr', label: 'Français' },
              { value: 'en', label: 'English' },
            ]}
          />
        </SettingsSection>

        <SaveBar
          dirty={dirty}
          saving={saving}
          saved={success}
          onSave={handleSave}
          labels={{ save: tc('save'), saving: tc('saving'), saved: tc('saved'), unsaved: tc('unsaved') }}
        />
      </div>
    </SettingsPage>
  )
}
