'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import useSWR from 'swr'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Trash2 } from 'lucide-react'
import { RowMenu, ContextMenuItem, MENU_ICON } from '@/components/ui/ContextMenu'
import type { AccountShare } from '@/types/account'
import { SettingsSection, SettingsRow, Toggle } from '@/components/settings/primitives'
import { cn } from '@/lib/utils'

const fetcher = (url: string) => fetch(url).then(r => r.json())

const PERMISSION_KEYS = ['canSend', 'canDelete', 'canOrganize', 'canManageRules', 'canManageSignatures'] as const
type PermissionKey = (typeof PERMISSION_KEYS)[number]

const STATUS_STYLES: Record<AccountShare['status'], string> = {
  pending: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  active: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  revoked: 'bg-muted text-muted-foreground',
  expired: 'bg-muted text-muted-foreground',
}

export function AccountSharesPanel({ accountId }: { accountId: string; accountEmail: string }) {
  const t = useTranslations('settings.accounts.shares')
  const { data, mutate } = useSWR<{ data: AccountShare[] }>(`/api/accounts/${accountId}/shares`, fetcher)
  const shares = data?.data ?? []

  const [email, setEmail] = useState('')
  const [permissions, setPermissions] = useState<Record<PermissionKey, boolean>>({
    canSend: false, canDelete: false, canOrganize: false, canManageRules: false, canManageSignatures: false,
  })
  const [expiresAt, setExpiresAt] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [warning, setWarning] = useState('')

  const togglePermission = (key: PermissionKey) => (v: boolean) =>
    setPermissions(p => ({ ...p, [key]: v }))

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault()
    setSending(true)
    setError('')
    setWarning('')
    try {
      const res = await fetch(`/api/accounts/${accountId}/shares`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, ...permissions, expiresAt: expiresAt || undefined }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? t('inviteFailed'))
      } else {
        if (json.data?.emailSent === false) setWarning(t('emailSendFailedWarning'))
        setEmail('')
        setPermissions({ canSend: false, canDelete: false, canOrganize: false, canManageRules: false, canManageSignatures: false })
        setExpiresAt('')
        mutate()
      }
    } catch {
      setError(t('inviteFailed'))
    } finally {
      setSending(false)
    }
  }

  // The confirmation NAMES the invitee: on an account shared with several people,
  // "Revoke access?" does not say which one is being removed.
  const handleRevoke = async (share: AccountShare) => {
    if (!confirm(t('revokeNamed', { email: share.inviteeEmail }))) return
    await fetch(`/api/accounts/${accountId}/shares/${share.id}`, { method: 'DELETE' })
    mutate()
  }

  return (
    <SettingsSection title={t('title')} className="mt-2.5">
      {shares.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('noShares')}</p>
      ) : (
        <div className="space-y-2">
          {shares.map(share => (
            <div key={share.id} className="flex items-center gap-3 rounded-lg border border-border bg-card p-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium truncate">{share.inviteeEmail}</span>
                  <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium shrink-0', STATUS_STYLES[share.status])}>
                    {t(`status.${share.status}`)}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {PERMISSION_KEYS.filter(k => share.permissions[k]).map(k => (
                    <span key={k} className="text-[11px] px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-600 dark:text-violet-400">
                      {t(`permissions.${k}`)}
                    </span>
                  ))}
                  {share.expiresAt && (
                    <span className="text-[11px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                      {t('expiresOn', { date: new Date(share.expiresAt).toLocaleDateString() })}
                    </span>
                  )}
                </div>
              </div>
              {(share.status === 'pending' || share.status === 'active') && (
                <RowMenu label={t('rowMenu', { name: share.inviteeEmail })} itemsKey={share.id}>
                  {close => (
                    <ContextMenuItem
                      itemKey="revoke" icon={<Trash2 className={MENU_ICON} />} label={t('revokeLabel')}
                      onClick={() => handleRevoke(share)} onClose={close} enabled danger
                    />
                  )}
                </RowMenu>
              )}
            </div>
          ))}
        </div>
      )}

      <form onSubmit={handleInvite} className="space-y-3 pt-2 border-t border-border">
        {error && <div className="p-2.5 rounded-lg bg-destructive/10 text-destructive text-xs">{error}</div>}
        {warning && <div className="p-2.5 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 text-xs">{warning}</div>}

        <div className="space-y-1.5">
          <Input
            type="email"
            placeholder={t('emailPlaceholder')}
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
          />
        </div>

        <div className="space-y-2">
          {PERMISSION_KEYS.map(key => (
            <SettingsRow key={key} title={t(`permissions.${key}`)}>
              <Toggle checked={permissions[key]} onChange={togglePermission(key)} />
            </SettingsRow>
          ))}
        </div>

        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground">{t('expiryLabel')}</label>
          <Input type="date" value={expiresAt} onChange={e => setExpiresAt(e.target.value)} />
        </div>

        <Button type="submit" size="sm" disabled={sending || !email}>
          {sending ? '...' : t('sendInvite')}
        </Button>
      </form>
    </SettingsSection>
  )
}
