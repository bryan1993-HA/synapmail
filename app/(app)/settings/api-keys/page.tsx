'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { useTranslations } from 'next-intl'
import { Plus, Trash2, Terminal, Copy, Check, TriangleAlert, ChevronDown, Activity } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { ApiKey, ApiKeyRequestLog } from '@/types/account'
import { SettingsPage, SettingsHeader } from '@/components/settings/primitives'
import { RowMenu, ContextMenuItem, MENU_ICON } from '@/components/ui/ContextMenu'
import { cn } from '@/lib/utils'

const fetcher = (url: string) => fetch(url).then(r => r.json())

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function ActivityPanel({ keyId }: { keyId: string }) {
  const { data, isLoading } = useSWR<{ data: ApiKeyRequestLog[] }>(`/api/api-keys/${keyId}/logs`, fetcher)
  const logs = data?.data ?? []

  return (
    <div className="mt-3 rounded-lg border border-border bg-muted/40 p-3">
      {isLoading && <p className="text-xs text-muted-foreground">Chargement…</p>}
      {!isLoading && logs.length === 0 && (
        <p className="text-xs text-muted-foreground">Aucune requête enregistrée pour cette clé.</p>
      )}
      {logs.length > 0 && (
        <div className="space-y-1.5 max-h-64 overflow-y-auto">
          {logs.map(log => (
            <div key={log.id} className="flex items-center gap-2 text-xs">
              <span className="shrink-0 w-14 font-mono font-medium text-muted-foreground">{log.method}</span>
              <span className="flex-1 min-w-0 truncate font-mono">{log.path}</span>
              <span className="shrink-0 text-muted-foreground">{log.ipAddress ?? '—'}</span>
              <span className="shrink-0 text-muted-foreground">{formatDateTime(log.createdAt)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function ApiKeysPage() {
  const tRow = useTranslations('settings.rowActions')
  const { data, mutate } = useSWR<{ data: ApiKey[] }>('/api/api-keys', fetcher)
  const keys = data?.data ?? []

  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [revealedKey, setRevealedKey] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [expandedKeyId, setExpandedKeyId] = useState<string | null>(null)

  const createKey = async () => {
    if (!newName.trim()) { setError('Nom requis'); return }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error ?? 'Erreur')
      await mutate()
      setCreating(false)
      setNewName('')
      setRevealedKey(d.data.key)
    } catch (err) {
      setError(String(err))
    } finally {
      setSaving(false)
    }
  }

  const revokeKey = async (key: ApiKey) => {
    if (!confirm(tRow('apiKeyRevokeConfirm', { name: key.name }))) return
    await fetch(`/api/api-keys/${key.id}`, { method: 'DELETE' })
    await mutate()
  }

  const copyKey = () => {
    if (!revealedKey) return
    navigator.clipboard.writeText(revealedKey).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <SettingsPage width="2xl">
      <SettingsHeader
        icon={<Terminal className="h-4 w-4" />}
        title="Clés API"
        description="Accès Bearer en lecture et écriture pour un script ou un agent externe, en plus de la connexion navigateur"
      />

      {revealedKey && (
        <div className="mb-6 rounded-2xl border border-violet-500/30 bg-violet-500/5 p-5 shadow-sm">
          <div className="flex items-start gap-2 text-sm font-medium text-violet-700 dark:text-violet-300">
            <TriangleAlert className="w-4 h-4 shrink-0 mt-0.5" />
            Cette clé ne sera plus jamais affichée. Copiez-la maintenant.
          </div>
          <div className="mt-3 flex items-center gap-2">
            <code className="flex-1 rounded-lg bg-background border border-border px-3 py-2 text-xs break-all">
              {revealedKey}
            </code>
            <Button size="sm" variant="outline" onClick={copyKey} className="gap-1.5 shrink-0">
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Copié' : 'Copier'}
            </Button>
          </div>
          <Button size="sm" variant="ghost" className="mt-3" onClick={() => setRevealedKey(null)}>
            J&apos;ai copié ma clé
          </Button>
        </div>
      )}

      <div className="mb-4 flex">
        <Button size="sm" onClick={() => { setCreating(true); setError(null) }} className="gap-1.5">
          <Plus className="w-3.5 h-3.5" /> Nouvelle clé
        </Button>
      </div>

      {error && <p className="text-sm text-destructive mb-4">{error}</p>}

      {creating && (
        <div className="mb-6 space-y-3 rounded-2xl border border-border bg-card/80 p-5 shadow-sm backdrop-blur-sm">
          <h2 className="text-sm font-semibold">Nouvelle clé API</h2>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Nom</label>
            <Input
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="Agent de synchronisation IONOS"
              className="h-8 text-sm"
            />
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={createKey} disabled={saving}>
              {saving ? 'Création…' : 'Créer'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setCreating(false); setError(null) }}>
              Annuler
            </Button>
          </div>
        </div>
      )}

      {keys.length === 0 && !creating && (
        <p className="text-sm text-muted-foreground">Aucune clé API. Créez-en une pour donner un accès lecture/écriture à un script ou un agent externe.</p>
      )}

      <div className="space-y-3">
        {keys.map(key => {
          const expanded = expandedKeyId === key.id
          return (
            <div key={key.id} className="border border-border rounded-xl bg-card shadow-sm p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium text-sm">{key.name}</div>
                  <div className="text-xs text-muted-foreground mt-0.5 font-mono">{key.keyPrefix}…</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    Créée le {formatDate(key.createdAt)}
                    {key.lastUsedAt ? ` · Dernière utilisation le ${formatDate(key.lastUsedAt)}` : ' · Jamais utilisée'}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => setExpandedKeyId(expanded ? null : key.id)}
                    className="h-8 px-2.5 flex items-center gap-1.5 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    title="Voir l'activité récente"
                  >
                    <Activity className="w-3.5 h-3.5" />
                    {key.requestCount24h > 0 ? `${key.requestCount24h} / 24h` : 'Activité'}
                    <ChevronDown className={cn('w-3 h-3 transition-transform', expanded && 'rotate-180')} />
                  </button>
                  <RowMenu label={tRow('menu', { name: key.name })} itemsKey={key.id}>
                    {close => (
                      <ContextMenuItem
                        itemKey="revoke" icon={<Trash2 className={MENU_ICON} />} label={tRow('apiKeyRevoke')}
                        onClick={() => revokeKey(key)} onClose={close} enabled danger
                      />
                    )}
                  </RowMenu>
                </div>
              </div>
              {expanded && <ActivityPanel keyId={key.id} />}
            </div>
          )
        })}
      </div>
    </SettingsPage>
  )
}
