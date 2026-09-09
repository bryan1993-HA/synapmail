'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import useSWR from 'swr'
import { Timer, TimerOff, PenSquare } from 'lucide-react'
import {
  SettingsPage, SettingsHeader, SettingsSection, ChoiceCards, SaveBar,
} from '@/components/settings/primitives'

interface UserSettings {
  undo_send_delay: number
}

const fetcher = (url: string) => fetch(url).then(r => r.json())

export default function CompositionPage() {
  const t = useTranslations('settings.composition')
  const tc = useTranslations('settings.common')
  const { data, mutate } = useSWR<{ data: UserSettings }>('/api/settings', fetcher)
  const settings = data?.data

  const [undoDelay, setUndoDelay] = useState(10)
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    if (settings) setUndoDelay(settings.undo_send_delay)
  }, [settings])

  const dirty = !!settings && undoDelay !== settings.undo_send_delay

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
    <SettingsPage width="lg">
      <SettingsHeader icon={<PenSquare className="h-4 w-4" />} title={t('title')} description={t('description')} />

      <div className="space-y-6">
        <SettingsSection>
          <div className="flex items-start gap-3">
            {undoDelay > 0
              ? <Timer className="mt-0.5 h-5 w-5 shrink-0 text-violet-600 dark:text-violet-400" />
              : <TimerOff className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />}
            <div>
              <h2 className="text-sm font-semibold">{t('undoTitle')}</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">{t('undoDesc')}</p>
            </div>
          </div>

          <ChoiceCards
            columns={2}
            value={undoDelay}
            onChange={setUndoDelay}
            options={[
              { value: 0, label: t('disabled'), description: t('immediate') },
              { value: 5, label: t('seconds', { n: 5 }) },
              { value: 10, label: t('seconds', { n: 10 }), description: t('recommended') },
              { value: 30, label: t('seconds', { n: 30 }) },
            ]}
          />

          {undoDelay > 0 && (
            <p className="rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
              {t('undoHint', { n: undoDelay })}
            </p>
          )}
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
