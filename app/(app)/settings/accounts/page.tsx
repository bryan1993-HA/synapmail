'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import useSWR from 'swr'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import type { EmailAccount } from '@/types/account'

const fetcher = (url: string) => fetch(url).then(r => r.json()).then(d => d.data)

interface AccountFormState {
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

const defaultForm: AccountFormState = {
  name: '', email: '', imapHost: '', imapPort: '993', imapSecure: true,
  smtpHost: '', smtpPort: '587', smtpSecure: false,
  username: '', password: '', isDefault: false, color: '#6366f1',
}

export default function AccountsPage() {
  const t = useTranslations('settings.accounts')
  const { data: accounts, mutate } = useSWR<EmailAccount[]>('/api/accounts', fetcher)
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<AccountFormState>(defaultForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const openNew = () => {
    setEditId(null)
    setForm(defaultForm)
    setShowForm(true)
    setError('')
  }

  const openEdit = (account: EmailAccount) => {
    setEditId(account.id)
    setForm({
      name: account.name, email: account.email,
      imapHost: account.imapHost, imapPort: String(account.imapPort), imapSecure: account.imapSecure,
      smtpHost: account.smtpHost, smtpPort: String(account.smtpPort), smtpSecure: account.smtpSecure,
      username: account.username, password: '',
      isDefault: account.isDefault, color: account.color,
    })
    setShowForm(true)
    setError('')
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this account?')) return
    await fetch(`/api/accounts/${id}`, { method: 'DELETE' })
    mutate()
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      const body = {
        ...form,
        imapPort: parseInt(form.imapPort),
        smtpPort: parseInt(form.smtpPort),
      }
      const res = await fetch(editId ? `/api/accounts/${editId}` : '/api/accounts', {
        method: editId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Save failed')
      } else {
        setShowForm(false)
        mutate()
      }
    } catch {
      setError('An error occurred')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-8 max-w-2xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <Button onClick={openNew} size="sm" className="gap-1.5">
          <Plus className="w-4 h-4" /> {t('add')}
        </Button>
      </div>

      {!accounts?.length && !showForm && (
        <div className="text-center py-12 text-muted-foreground">
          <p className="font-medium">{t('noAccounts')}</p>
          <p className="text-sm mt-1">{t('noAccountsDesc')}</p>
        </div>
      )}

      <div className="space-y-2 mb-6">
        {accounts?.map(account => (
          <div key={account.id} className="flex items-center gap-3 p-4 rounded-lg border border-border">
            <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: account.color }} />
            <div className="flex-1 min-w-0">
              <div className="font-medium text-sm">{account.name}</div>
              <div className="text-xs text-muted-foreground">{account.email}</div>
            </div>
            {account.isDefault && (
              <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">default</span>
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

      {showForm && (
        <form onSubmit={handleSubmit} className="border border-border rounded-lg p-5 space-y-4">
          <h2 className="font-semibold">{editId ? t('edit') : t('add')}</h2>
          {error && <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm">{error}</div>}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{t('name')}</Label>
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required />
            </div>
            <div className="space-y-1.5">
              <Label>{t('email')}</Label>
              <Input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} required />
            </div>
            <div className="space-y-1.5">
              <Label>{t('imapHost')}</Label>
              <Input value={form.imapHost} onChange={e => setForm(f => ({ ...f, imapHost: e.target.value }))} required />
            </div>
            <div className="space-y-1.5">
              <Label>{t('imapPort')}</Label>
              <Input type="number" value={form.imapPort} onChange={e => setForm(f => ({ ...f, imapPort: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>{t('smtpHost')}</Label>
              <Input value={form.smtpHost} onChange={e => setForm(f => ({ ...f, smtpHost: e.target.value }))} required />
            </div>
            <div className="space-y-1.5">
              <Label>{t('smtpPort')}</Label>
              <Input type="number" value={form.smtpPort} onChange={e => setForm(f => ({ ...f, smtpPort: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>{t('username')}</Label>
              <Input value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} required />
            </div>
            <div className="space-y-1.5">
              <Label>{t('password')}</Label>
              <Input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder={editId ? '(unchanged)' : ''} required={!editId} />
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <Button type="submit" disabled={saving}>{saving ? '...' : t('save')}</Button>
            <Button type="button" variant="outline" onClick={() => setShowForm(false)}>{t('cancel')}</Button>
          </div>
        </form>
      )}
    </div>
  )
}
