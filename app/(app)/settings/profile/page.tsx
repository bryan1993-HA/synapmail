'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useSession } from 'next-auth/react'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'

interface ProfileData {
  id: string
  name: string
  email: string
  role: string
}

export default function ProfilePage() {
  const t = useTranslations('settings.profile')
  const { update: updateSession } = useSession()

  const [profile, setProfile] = useState<ProfileData | null>(null)
  const [name, setName] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

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
    setSuccess('')

    if (newPassword && newPassword !== confirmPassword) {
      setError('Les mots de passe ne correspondent pas')
      return
    }
    if (newPassword && newPassword.length < 8) {
      setError('Le nouveau mot de passe doit faire au moins 8 caractères')
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
        setError(data.error ?? 'Erreur lors de la sauvegarde')
      } else {
        setSuccess('Profil mis à jour')
        setCurrentPassword('')
        setNewPassword('')
        setConfirmPassword('')
        setProfile(data.data)
        // Refresh session so displayed name updates
        await updateSession({ name: data.data.name })
      }
    } catch {
      setError('Une erreur est survenue')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-8 max-w-lg">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/settings" className="text-muted-foreground hover:text-foreground transition-colors">
          <ChevronLeft className="w-5 h-5" />
        </Link>
        <h1 className="text-2xl font-bold">{t('title')}</h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Info section */}
        <div className="border border-border rounded-lg p-5 space-y-4">
          <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Informations</h2>

          <div className="space-y-1.5">
            <Label>{t('name')}</Label>
            <Input
              value={name}
              onChange={e => setName(e.target.value)}
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label>{t('email')}</Label>
            <Input
              value={profile?.email ?? ''}
              disabled
              className="opacity-60"
            />
            <p className="text-xs text-muted-foreground">{"L'adresse email ne peut pas être modifiée."}</p>
          </div>

          {profile?.role === 'admin' && (
            <div className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary">
              Administrateur
            </div>
          )}
        </div>

        {/* Password section */}
        <div className="border border-border rounded-lg p-5 space-y-4">
          <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">{t('password')}</h2>

          <div className="space-y-1.5">
            <Label>Mot de passe actuel</Label>
            <Input
              type="password"
              value={currentPassword}
              onChange={e => setCurrentPassword(e.target.value)}
              placeholder="Requis pour changer le mot de passe"
              autoComplete="current-password"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Nouveau mot de passe</Label>
            <Input
              type="password"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              placeholder="8 caractères minimum"
              autoComplete="new-password"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Confirmer le nouveau mot de passe</Label>
            <Input
              type="password"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
            />
          </div>
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm">{error}</div>
        )}
        {success && (
          <div className="p-3 rounded-lg bg-green-500/10 text-green-600 text-sm">{success}</div>
        )}

        <Button type="submit" disabled={saving}>
          {saving ? '...' : t('save')}
        </Button>
      </form>
    </div>
  )
}
