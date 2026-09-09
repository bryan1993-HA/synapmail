'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import useSWR from 'swr'
import { Bell } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  SettingsPage, SettingsHeader, SettingsSection, SettingsRow, Toggle, SaveBar,
} from '@/components/settings/primitives'

interface UserSettings {
  notifications: boolean
}

const fetcher = (url: string) => fetch(url).then(r => r.json())

export default function NotificationsPage() {
  const t = useTranslations('settings.notifications')
  const tc = useTranslations('settings.common')
  const { data, mutate } = useSWR<{ data: UserSettings }>('/api/settings', fetcher)
  const settings = data?.data

  const [enabled, setEnabled] = useState(true)
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)
  const [permissionState, setPermissionState] = useState<NotificationPermission | 'unsupported'>('default')

  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      setPermissionState(Notification.permission)
    } else {
      setPermissionState('unsupported')
    }
  }, [])

  useEffect(() => {
    if (settings) setEnabled(settings.notifications !== false)
  }, [settings])

  const dirty = !!settings && enabled !== (settings.notifications !== false)

  const requestPermission = async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) return
    const result = await Notification.requestPermission()
    setPermissionState(result)
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      if (enabled && permissionState === 'default') {
        await requestPermission()
      }
      await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notifications: enabled }),
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
      <SettingsHeader icon={<Bell className="h-4 w-4" />} title={t('title')} description={t('description')} />

      <div className="space-y-6">
        <SettingsSection title={t('desktop')}>
          <SettingsRow title={t('toggleLabel')} description={t('toggleDesc')}>
            <Toggle checked={enabled} onChange={setEnabled} label={t('toggleLabel')} />
          </SettingsRow>

          {permissionState !== 'unsupported' && (
            <div
              className={cn(
                'rounded-lg px-4 py-3 text-sm',
                permissionState === 'granted'
                  ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                  : permissionState === 'denied'
                    ? 'bg-destructive/10 text-destructive'
                    : 'bg-muted text-muted-foreground',
              )}
            >
              {permissionState === 'granted' && t('permGranted')}
              {permissionState === 'denied' && t('permDenied')}
              {permissionState === 'default' && (
                <div className="flex items-center justify-between gap-3">
                  <span>{t('permDefault')}</span>
                  <button
                    onClick={requestPermission}
                    className="shrink-0 text-xs font-medium underline underline-offset-2 hover:no-underline"
                  >
                    {t('allow')}
                  </button>
                </div>
              )}
            </div>
          )}

          <p className="text-xs text-muted-foreground">{t('hint')}</p>
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
