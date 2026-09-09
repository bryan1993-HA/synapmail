'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { useSession } from 'next-auth/react'
import { User } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  SettingsPage, SettingsHeader, SettingsSection, SaveBar,
} from '@/components/settings/primitives'

interface ProfileData {
  id: string
  name: string
  email: string
  role: string
}

export default function ProfilePage() {
  const t = useTranslations('settings.profile')
  const tc = useTranslations('settings.common')
  const { update: updateSession } = useSession()

  const [profile, setProfile] = useState<ProfileData | null>(null)
  const [name, setName] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    fetch('/api/profile')
      .then(r => r.json())
      .then(d => {
        if (d.data) {
          setProfile(d.data)
          setName(d.data.name ?? '')
        }
      })
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSuccess(false)

    if (newPassword && newPassword !== confirmPassword) {
      setError(t('passwordMismatch'))
      return
    }
    if (newPassword && newPassword.length < 8) {
      setError(t('passwordTooShort'))
      return
    }

    setSaving(true)
    try {
      const body: Record<string, string> = { name }
      if (newPassword) {
        body.currentPassword = currentPassword
        body.newPassword = newPassword
      }

      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()

      if (!res.ok) {
        setError(data.error ?? t('saveError'))
      } else {
        setSuccess(true)
        setTimeout(() => setSuccess(false), 2000)
        setCurrentPassword('')
        setNewPassword('')
        setConfirmPassword('')
        setProfile(data.data)
        await updateSession({ name: data.data.name })
      }
    } catch {
      setError(t('genericError'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <SettingsPage width="lg">
      <SettingsHeader icon={<User className="h-4 w-4" />} title={t('title')} description={t('description')} />

      <form onSubmit={handleSubmit} className="space-y-6">
        <SettingsSection title={t('infoSection')}>
          <div className="space-y-1.5">
            <Label>{t('name')}</Label>
            <Input value={name} onChange={e => setName(e.target.value)} required />
          </div>

          <div className="space-y-1.5">
            <Label>{t('email')}</Label>
            <Input value={profile?.email ?? ''} disabled className="opacity-60" />
            <p className="text-xs text-muted-foreground">{t('emailLocked')}</p>
          </div>

          {profile?.role === 'admin' && (
            <span className="inline-flex items-center rounded-full bg-violet-500/10 px-2.5 py-0.5 text-xs font-medium text-violet-700 dark:text-violet-300">
              {t('adminBadge')}
            </span>
          )}
        </SettingsSection>

        <SettingsSection title={t('password')}>
          <div className="space-y-1.5">
            <Label>{t('currentPassword')}</Label>
            <Input
              type="password"
              value={currentPassword}
              onChange={e => setCurrentPassword(e.target.value)}
              placeholder={t('currentPasswordPlaceholder')}
              autoComplete="current-password"
            />
          </div>

          <div className="space-y-1.5">
            <Label>{t('newPassword')}</Label>
            <Input
              type="password"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              placeholder={t('newPasswordPlaceholder')}
              autoComplete="new-password"
            />
          </div>

          <div className="space-y-1.5">
            <Label>{t('confirmPassword')}</Label>
            <Input
              type="password"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
            />
          </div>
        </SettingsSection>

        {error && (
          <div className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
        )}

        <SaveBar
          submit
          dirty
          saving={saving}
          saved={success}
          labels={{ save: t('save'), saving: tc('saving'), saved: t('updated'), unsaved: tc('unsaved') }}
        />
      </form>
    </SettingsPage>
  )
}
