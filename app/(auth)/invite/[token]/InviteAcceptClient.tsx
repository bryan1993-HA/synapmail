'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import Link from 'next/link'
import { useAppName } from '@/components/providers'

type InvitePreview = {
  accountEmail: string
  ownerName: string
  inviteeEmail: string
}

export default function InviteAcceptClient({ token }: { token: string }) {
  const t = useTranslations('auth.invite')
  const appName = useAppName()
  const router = useRouter()
  const [preview, setPreview] = useState<InvitePreview | null>(null)
  const [previewError, setPreviewError] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    fetch(`/api/invites/${token}`)
      .then(async res => {
        const data = await res.json()
        if (!res.ok) {
          setPreviewError(data.error === 'Invalid or expired invitation' ? t('invalidToken') : data.error)
          return
        }
        setPreview(data.data)
      })
      .catch(() => setPreviewError(t('invalidToken')))
  }, [token, t])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (password !== confirm) {
      setError(t('passwordMismatch'))
      return
    }
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/invites/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, password }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? t('invalidToken'))
      } else {
        setSuccess(true)
        setTimeout(() => router.push('/login'), 2000)
      }
    } catch {
      setError(t('invalidToken'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center">
          <div className="flex justify-center mb-4">
            <img src="/brand/anime/synapmail-anime.svg" alt={appName} className="w-16 h-16" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">{appName}</h1>
          {preview && (
            <p className="text-muted-foreground mt-1 text-sm">
              {t('subtitle', { owner: preview.ownerName, email: preview.accountEmail })}
            </p>
          )}
        </div>

        {previewError ? (
          <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm text-center">
            {previewError}
          </div>
        ) : success ? (
          <div className="p-3 rounded-lg bg-emerald-500/10 text-emerald-600 text-sm text-center">
            {t('success')}
          </div>
        ) : preview ? (
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm">{error}</div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="name">{t('nameLabel')}</Label>
              <Input id="name" type="text" value={name} onChange={e => setName(e.target.value)} required autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">{t('passwordLabel')}</Label>
              <Input id="password" type="password" value={password} onChange={e => setPassword(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirm">{t('confirmLabel')}</Label>
              <Input id="confirm" type="password" value={confirm} onChange={e => setConfirm(e.target.value)} required />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? '...' : t('submit')}
            </Button>
          </form>
        ) : null}

        <p className="text-center text-sm text-muted-foreground">
          <Link href="/login" className="text-primary hover:underline">
            {t('backToLogin')}
          </Link>
        </p>
      </div>
    </div>
  )
}
