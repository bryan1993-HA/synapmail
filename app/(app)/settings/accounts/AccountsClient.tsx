'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import useSWR from 'swr'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Plus, Pencil, Trash2, Wifi } from 'lucide-react'
import type { EmailAccount } from '@/types/account'
import { AccountWizard } from './AccountWizard'
import type { AccountFormData } from './AccountWizard'

const fetcher = (url: string) => fetch(url).then(r => r.json())

interface EditFormState {
  name: string
  email: string
  imapHost: string
  imapPort: string
  imapSecure: boolean
  smtpHost: string
  smtpPort: string
  smtpSecure: boolean
  username: string
  password: string
  isDefault: boolean
  color: string
}

interface Props {
  initialError?: string
  initialSuccess?: string
}

export function AccountsClient({ initialError, initialSuccess }: Props) {
  const t = useTranslations('settings.accounts')
  const { data: accountsData, mutate } = useSWR<{ data: EmailAccount[] }>('/api/accounts', fetcher)
  const accounts = accountsData?.data

  const [mode, setMode] = useState<'list' | 'add' | 'edit'>('list')
  const [editId, setEditId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<EditFormState | null>(null)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState(initialError ? decodeURIComponent(initialError) : '')
  const [success, setSuccess] = useState('')
  const [testResult, setTestResult] = useState<{ imap: { ok: boolean; error: string }; smtp: { ok: boolean; error: string } } | null>(null)

  useEffect(() => {
    if (initialSuccess === 'microsoft') {
      setSuccess('Compte Microsoft connecté avec succès.')
      mutate()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const openEdit = (account: EmailAccount) => {
    setEditId(account.id)
    setEditForm({
      name: account.name, email: account.email,
      imapHost: account.imapHost, imapPort: String(account.imapPort), imapSecure: account.imapSecure,
      smtpHost: account.smtpHost, smtpPort: String(account.smtpPort), smtpSecure: account.smtpSecure,
      username: account.username, password: '',
      isDefault: account.isDefault, color: account.color,
    })
    setTestResult(null)
    setError('')
    setMode('edit')
  }

  const handleDelete = async (id: string) => {
    if (!confirm(t('delete') + ' ?')) return
    await fetch(`/api/accounts/${id}`, { method: 'DELETE' })
    mutate()
  }

  const handleWizardSave = async (data: AccountFormData) => {
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...data,
          imapPort: Number(data.imapPort),
          smtpPort: Number(data.smtpPort),
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? t('testError'))
      } else {
        setMode('list')
        mutate()
      }
    } catch {
      setError(t('testError'))
    } finally {
      setSaving(false)
    }
  }

  const handleEditTest = async () => {
    if (!editForm) return
    setTesting(true)
    setTestResult(null)
    setError('')
    try {
      const res = await fetch('/api/accounts/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imapHost: editForm.imapHost, imapPort: parseInt(editForm.imapPort), imapSecure: editForm.imapSecure,
          smtpHost: editForm.smtpHost, smtpPort: parseInt(editForm.smtpPort), smtpSecure: editForm.smtpSecure,
          username: editForm.username, password: editForm.password,
        }),
      })
      setTestResult(await res.json())
    } catch {
      setError(t('testError'))
    } finally {
      setTesting(false)
    }
  }

  const handleEditSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editForm || !editId) return
    setSaving(true)
    setError('')
    try {
      const res = await fetch(`/api/accounts/${editId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...editForm,
          imapPort: parseInt(editForm.imapPort),
          smtpPort: parseInt(editForm.smtpPort),
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? t('testError'))
      } else {
        setMode('list')
        mutate()
      }
    } catch {
      setError(t('testError'))
    } finally {
      setSaving(false)
    }
  }

  // ── MODE : LISTE ─────────────────────────────────────────────────────────
  if (mode === 'list') {
    return (
      <div className="p-8 max-w-2xl">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">{t('title')}</h1>
          <div className="flex gap-2">
            <a href="/api/oauth/microsoft">
              <Button size="sm" variant="outline" className="gap-1.5">
                <svg className="w-4 h-4" viewBox="0 0 21 21" fill="none">
                  <rect x="1" y="1" width="9" height="9" fill="#f25022"/>
                  <rect x="11" y="1" width="9" height="9" fill="#7fba00"/>
                  <rect x="1" y="11" width="9" height="9" fill="#00a4ef"/>
                  <rect x="11" y="11" width="9" height="9" fill="#ffb900"/>
                </svg>
                Microsoft / Outlook
              </Button>
            </a>
            <Button onClick={() => { setError(''); setMode('add') }} size="sm" className="gap-1.5">
              <Plus className="w-4 h-4" /> {t('add')}
            </Button>
          </div>
        </div>

        {success && <div className="mb-4 p-3 rounded-lg bg-green-500/10 text-green-600 text-sm">{success}</div>}
        {error && <div className="mb-4 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">{error}</div>}

        {!accounts?.length && (
          <div className="text-center py-12 text-muted-foreground">
            <p className="font-medium">{t('noAccounts')}</p>
            <p className="text-sm mt-1">{t('noAccountsDesc')}</p>
          </div>
        )}

        <div className="space-y-2">
          {accounts?.map(account => (
            <div key={account.id} className="flex items-center gap-3 p-4 rounded-lg border border-border">
              <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: account.color }} />
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm">{account.name}</div>
                <div className="text-xs text-muted-foreground">{account.email}</div>
              </div>
              {account.isDefault && (
                <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">{t('setDefault')}</span>
              )}
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => openEdit(account)}>
                <Pencil className="w-3.5 h-3.5" />
              </Button>
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-destructive hover:text-destructive" onClick={() => handleDelete(account.id)}>
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          ))}
        </div>
      </div>
    )
  }

  // ── MODE : AJOUT (wizard) ────────────────────────────────────────────────
  if (mode === 'add') {
    return (
      <div className="w-full p-6 overflow-y-auto">
        <AccountWizard
          onSave={handleWizardSave}
          onCancel={() => setMode('list')}
          saving={saving}
        />
      </div>
    )
  }

  // ── MODE : ÉDITION (formulaire classique) ────────────────────────────────
  if (mode === 'edit' && editForm) {
    const ef = editForm
    const set = (k: keyof EditFormState) => (e: React.ChangeEvent<HTMLInputElement>) =>
      setEditForm(f => f ? { ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value } : f)

    return (
      <div className="p-8 max-w-2xl">
        <form onSubmit={handleEditSave} className="border border-border rounded-xl p-6 space-y-4">
          <h2 className="font-semibold">{t('edit')}</h2>
          {error && <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm">{error}</div>}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>{t('name')}</Label>
              <Input value={ef.name} onChange={set('name')} required />
            </div>
            <div className="space-y-1.5"><Label>{t('email')}</Label>
              <Input type="email" value={ef.email} onChange={set('email')} required />
            </div>
            <div className="space-y-1.5"><Label>{t('imapHost')}</Label>
              <Input value={ef.imapHost} onChange={set('imapHost')} required />
            </div>
            <div className="space-y-1.5"><Label>{t('imapPort')}</Label>
              <Input type="number" value={ef.imapPort} onChange={set('imapPort')} />
            </div>
            <div className="space-y-1.5"><Label>{t('smtpHost')}</Label>
              <Input value={ef.smtpHost} onChange={set('smtpHost')} required />
            </div>
            <div className="space-y-1.5"><Label>{t('smtpPort')}</Label>
              <Input type="number" value={ef.smtpPort} onChange={set('smtpPort')} />
            </div>
            <div className="space-y-1.5"><Label>{t('username')}</Label>
              <Input value={ef.username} onChange={set('username')} required />
            </div>
            <div className="space-y-1.5"><Label>{t('password')}</Label>
              <Input type="password" value={ef.password} onChange={set('password')} placeholder="(inchangé)" />
            </div>
          </div>

          {testResult && (
            <div className="rounded-lg border border-border p-3 space-y-1.5 text-sm">
              {(['imap', 'smtp'] as const).map(proto => (
                <div key={proto} className={`flex items-center gap-2 ${testResult[proto].ok ? 'text-green-600' : 'text-destructive'}`}>
                  <span>{testResult[proto].ok ? '✓' : '✗'} {proto.toUpperCase()}</span>
                  {!testResult[proto].ok && <span className="text-xs opacity-75">{testResult[proto].error}</span>}
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <Button type="submit" disabled={saving}>{saving ? '...' : t('save')}</Button>
            <Button type="button" variant="outline" onClick={handleEditTest} disabled={testing} className="gap-1.5">
              <Wifi className="w-4 h-4" />{testing ? '...' : t('test')}
            </Button>
            <Button type="button" variant="outline" onClick={() => setMode('list')}>{t('cancel')}</Button>
          </div>
        </form>
      </div>
    )
  }

  return null
}
