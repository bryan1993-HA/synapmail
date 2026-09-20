'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import useSWR from 'swr'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PasswordInput } from '@/components/ui/PasswordInput'
import { TEST_DECISION, hasSubmittedPassword } from '@/lib/accountTest'
import { Label } from '@/components/ui/label'
import { Plus, Pencil, Trash2, Wifi, Mail, Share2 } from 'lucide-react'
import { RowMenu, ContextMenuItem, ContextMenuSeparator, MENU_ICON } from '@/components/ui/ContextMenu'
import type { EmailAccount } from '@/types/account'
import { AccountWizard } from './AccountWizard'
import type { AccountFormData } from './AccountWizard'
import { AccountSharesPanel } from './AccountSharesPanel'
import { AccountAvatar } from '@/components/layout/AccountAvatar'
import { AccountColorPicker } from '@/components/settings/AccountColorPicker'
import { SettingsPage, SettingsHeader, Toggle } from '@/components/settings/primitives'

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
  const tShared = useTranslations('settings.accounts.receivedShares')
  const { data: accountsData, mutate } = useSWR<{ data: EmailAccount[] }>('/api/accounts', fetcher)
  // Credentials/sharing management is owner-only — accounts shared with this user
  // are visible in the Sidebar account switcher, not editable from this page.
  const allAccounts = accountsData?.data ?? []
  const accounts = accountsData?.data?.filter(a => !a.isShared)
  // A mailbox's automatic colour comes from its rank in the WHOLE list, the one the bar
  // ranks against — ranking against this page's owner-only subset would paint a different
  // bubble here than in the bar for anyone who also has a mailbox shared with them.
  const rankOf = (account: EmailAccount) => allAccounts.indexOf(account)
  // ...and the inboxes shared WITH this user get their own read-only section below:
  // they cannot be edited, only given back.
  const receivedShares = accountsData?.data?.filter(a => a.isShared) ?? []

  const [mode, setMode] = useState<'list' | 'add' | 'edit'>('list')
  const [editId, setEditId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<EditFormState | null>(null)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState(initialError ? decodeURIComponent(initialError) : '')
  const [success, setSuccess] = useState('')
  const [testResult, setTestResult] = useState<{
    tested: string
    imap: { ok: boolean; error: string } | null
    smtp: { ok: boolean; error: string } | null
  } | null>(null)
  const [expandedShareId, setExpandedShareId] = useState<string | null>(null)
  const [leavingId, setLeavingId] = useState<string | null>(null)

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

  // Optimistic: the control answers the gesture, the account row is the source of truth.
  // The SWR key is the one the sidebar subscribes to, so repainting the cache repaints
  // the bar's bubble and accent in the same frame, with no event and no second request.
  const patchAccount = (account: EmailAccount, patch: Partial<EmailAccount>) =>
    mutate(
      current => current && {
        data: current.data.map(a => (a.id === account.id ? { ...a, ...patch } : a)),
      },
      false
    )

  const saveAccount = async (account: EmailAccount, patch: Partial<EmailAccount>) => {
    patchAccount(account, patch)
    await fetch(`/api/accounts/${account.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    mutate()
  }

  // The confirmation NAMES the mailbox and states the consequence: "delete" on an
  // accounts screen can be read as "erase my mail", which is wrong — the messages stay
  // with the provider. Cancelling sends no request.
  const handleDelete = async (account: EmailAccount) => {
    if (!confirm(t('deleteConfirm', { email: account.email }))) return
    await fetch(`/api/accounts/${account.id}`, { method: 'DELETE' })
    mutate()
  }

  // Giving an inbox back writes the same `account_shares` row the owner's revoke does,
  // through the same route — a share ends one way, whoever ends it.
  const handleLeaveShare = async (account: EmailAccount) => {
    if (!account.shareId) return
    if (!confirm(tShared('leaveNamed', { email: account.email, owner: account.ownerName ?? account.email }))) return
    setLeavingId(account.id)
    try {
      const res = await fetch(`/api/accounts/${account.id}/shares/${account.shareId}`, { method: 'DELETE' })
      if (!res.ok) setError(tShared('leaveFailed'))
      else mutate()
    } catch {
      setError(tShared('leaveFailed'))
    } finally {
      setLeavingId(null)
    }
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
          // The account id, and the password ONLY if one was typed. The field starts empty
          // (the stored password never leaves the server): sending it as-is made the test
          // fail, or shipped to the provider whatever a password manager had dropped in.
          // Empty means "unchanged", so "test the one you already have". Hosts and ports
          // come from the FORM: a port can be corrected and tried without saving.
          accountId: editId,
          imapHost: editForm.imapHost, imapPort: parseInt(editForm.imapPort), imapSecure: editForm.imapSecure,
          smtpHost: editForm.smtpHost, smtpPort: parseInt(editForm.smtpPort), smtpSecure: editForm.smtpSecure,
          username: editForm.username,
          ...(hasSubmittedPassword(editForm.password) ? { password: editForm.password } : {}),
        }),
      })
      const data = await res.json()
      if (data.tested === TEST_DECISION.OAUTH) {
        setTestResult({ tested: data.tested, imap: null, smtp: null })
      } else if (data.imap && data.smtp) {
        setTestResult(data)
      } else if (data.error === TEST_DECISION.PASSWORD_REQUIRED) {
        // The form points at a different server: nothing was attempted, and the stored
        // password was untouched. Say so in a sentence, not with the bare error code.
        setError(t(`testFailure.${TEST_DECISION.PASSWORD_REQUIRED}`))
      } else {
        setError(data.error ?? t('testError'))
      }
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

  // ── MODE: LIST ───────────────────────────────────────────────────────────
  if (mode === 'list') {
    return (
      <SettingsPage width="2xl">
        <SettingsHeader
          icon={<Mail className="h-4 w-4" />}
          title={t('title')}
          description="Vos comptes IMAP / SMTP connectés à Synapmail"
        />

        <p className="mb-4 text-xs text-muted-foreground">{t('promptGuardDesc')}</p>

        <div className="mb-4 flex flex-wrap gap-2">
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

        {success && <div className="mb-4 p-3 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-sm">{success}</div>}
        {error && <div className="mb-4 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">{error}</div>}

        {!accounts?.length && (
          <div className="text-center py-12 text-muted-foreground">
            <p className="font-medium">{t('noAccounts')}</p>
            <p className="text-sm mt-1">{t('noAccountsDesc')}</p>
          </div>
        )}

        <div className="space-y-2.5">
          {accounts?.map(account => (
            <div key={account.id}>
              <div className="rounded-xl border border-border bg-card shadow-sm">
                {/* Clicking the row opens "Edit": that is the obvious action for a mailbox.
                    The gesture fires from the row background only (`e.target ===
                    e.currentTarget` would not hold: the name and address are part of it), so
                    a click on the colour dot, the toggle or "..." keeps ITS own action. */}
                <div
                  className="flex items-center gap-3 p-4 cursor-pointer"
                  data-account-row={account.id}
                  onClick={e => {
                    if ((e.target as HTMLElement).closest('button,input,a,[role="menu"]')) return
                    openEdit(account)
                  }}
                >
                  <AccountAvatar
                    account={account}
                    colorIndex={rankOf(account)}
                    size="md"
                    data-account-badge={account.id}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm">{account.name}</div>
                    <div className="text-xs text-muted-foreground">{account.email}</div>
                  </div>
                  {account.isDefault && (
                    <span className="text-xs bg-violet-500/10 text-violet-600 dark:text-violet-400 px-2 py-0.5 rounded-full font-medium">{t('setDefault')}</span>
                  )}
                  <AccountColorPicker
                    accountId={account.id}
                    value={account.badgeColor ?? null}
                    rank={rankOf(account)}
                    onPreview={colour => patchAccount(account, { badgeColor: colour })}
                    onCommit={colour => saveAccount(account, { badgeColor: colour })}
                  />
                  <RowMenu label={t('rowMenu', { name: account.name || account.email })} itemsKey={account.id}>
                    {close => (<>
                      <ContextMenuItem
                        itemKey="share" icon={<Share2 className={MENU_ICON} />} label={t('share')}
                        onClick={() => setExpandedShareId(id => id === account.id ? null : account.id)}
                        onClose={close} enabled
                      />
                      <ContextMenuItem
                        itemKey="edit" icon={<Pencil className={MENU_ICON} />} label={t('edit')}
                        onClick={() => openEdit(account)} onClose={close} enabled
                      />
                      <ContextMenuSeparator />
                      <ContextMenuItem
                        itemKey="delete" icon={<Trash2 className={MENU_ICON} />} label={t('deleteAccount')}
                        onClick={() => handleDelete(account)} onClose={close} enabled danger
                      />
                    </>)}
                  </RowMenu>
                </div>
                <div className="flex items-center justify-between gap-4 border-t border-border px-4 py-2.5">
                  <span className="text-sm">{t('promptGuard')}</span>
                  <span className="shrink-0" data-prompt-guard={account.id}>
                    <Toggle
                      checked={account.promptGuard}
                      onChange={v => saveAccount(account, { promptGuard: v })}
                      label={t('promptGuard')}
                    />
                  </span>
                </div>
              </div>
              {expandedShareId === account.id && (
                <AccountSharesPanel accountId={account.id} accountEmail={account.email} />
              )}
            </div>
          ))}
        </div>

        {receivedShares.length > 0 && (
          <section className="mt-8">
            <h2 className="mb-3 text-sm font-medium text-foreground">{tShared('title')}</h2>
            <div className="space-y-2.5">
              {receivedShares.map(account => (
                <div
                  key={account.id}
                  data-received-share={account.id}
                  className="flex items-center gap-3 rounded-xl border border-border bg-card p-4 shadow-sm"
                >
                  <Share2 className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">{account.name || account.email}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {tShared('sharedBy', { name: account.ownerName ?? account.email })}
                    </div>
                  </div>
                  <RowMenu label={tShared('rowMenu', { name: account.name || account.email })} itemsKey={account.id}>
                    {close => (
                      <ContextMenuItem
                        itemKey="leave" icon={<Trash2 className={MENU_ICON} />} label={tShared('leaveLabel')}
                        onClick={() => handleLeaveShare(account)} onClose={close}
                        enabled={leavingId !== account.id} danger
                      />
                    )}
                  </RowMenu>
                </div>
              ))}
            </div>
          </section>
        )}
      </SettingsPage>
    )
  }

  // ── MODE: ADD (wizard) ───────────────────────────────────────────────────
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

  // ── MODE: EDIT (plain form) ──────────────────────────────────────────────
  if (mode === 'edit' && editForm) {
    const ef = editForm
    const set = (k: keyof EditFormState) => (e: React.ChangeEvent<HTMLInputElement>) =>
      setEditForm(f => f ? { ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value } : f)

    return (
      <SettingsPage width="2xl">
        <SettingsHeader
          icon={<Mail className="h-4 w-4" />}
          title={t('edit')}
          description={ef.email}
        />
        <form onSubmit={handleEditSave} className="space-y-4 rounded-2xl border border-border bg-card/80 p-5 shadow-sm backdrop-blur-sm">
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
              {/* `new-password`: without it the browser's password manager fills this field
                  on its own, often with the WEBMAIL password, and the test ships it to the
                  provider, which records one more failed authentication. */}
              <PasswordInput
                value={ef.password}
                onChange={set('password')}
                autoComplete="new-password"
                placeholder={t('passwordUnchanged')}
              />
              <p className="text-xs text-muted-foreground">{t('passwordUnchangedHelp')}</p>
            </div>
          </div>

          {testResult && (
            <div className="rounded-lg border border-border p-3 space-y-1.5 text-sm">
              {/* State WHICH password was tried: without it a green test proves nothing to
                  someone who has just typed a new password. */}
              <p className="text-xs text-muted-foreground">{t(`tested.${testResult.tested}`)}</p>
              {(['imap', 'smtp'] as const).map(proto => {
                const r = testResult[proto]
                if (!r) return null
                return (
                  <div key={proto} className={`flex items-center gap-2 ${r.ok ? 'text-green-600' : 'text-destructive'}`}>
                    <span>{r.ok ? '✓' : '✗'} {proto.toUpperCase()}</span>
                    {/* The CAUSE, not the server's raw error: "535 Invalid login" does not
                        tell the reader what they need to fix. */}
                    {!r.ok && <span className="text-xs opacity-75">{t(`testFailure.${r.error}`)}</span>}
                  </div>
                )
              })}
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
      </SettingsPage>
    )
  }

  return null
}
