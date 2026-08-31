'use client'

import { useState, useMemo } from 'react'
import useSWR from 'swr'
import { Star, Trash2, Pencil, Plus, Search, X, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { Contact } from '@/types/contact'

const fetcher = (url: string) => fetch(url).then(r => r.json())

// Deterministic avatar color
function emailToHsl(email: string): string {
  let hash = 0
  for (let i = 0; i < email.length; i++) hash = (hash * 31 + email.charCodeAt(i)) % 360
  return `hsl(${hash}, 58%, 42%)`
}

function Avatar({ name, email, size = 'md' }: { name: string; email: string; size?: 'sm' | 'md' }) {
  const initials = name
    ? name.trim().split(/\s+/).map(p => p[0]).join('').slice(0, 2).toUpperCase()
    : email[0].toUpperCase()
  return (
    <div
      className={cn(
        'rounded-full flex items-center justify-center font-semibold text-white shrink-0',
        size === 'sm' ? 'w-7 h-7 text-[10px]' : 'w-9 h-9 text-xs'
      )}
      style={{ backgroundColor: emailToHsl(email) }}
    >
      {initials}
    </div>
  )
}

function formatDate(dateStr: string): string {
  const days = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86_400_000)
  if (days === 0) return "aujourd'hui"
  if (days === 1) return 'hier'
  if (days < 7) return `il y a ${days}j`
  if (days < 30) return `il y a ${Math.floor(days / 7)} sem`
  if (days < 365) return `il y a ${Math.floor(days / 30)} mois`
  return `il y a ${Math.floor(days / 365)} an`
}

type SortKey = 'score' | 'name' | 'frequency' | 'recent'

interface EditForm {
  name: string
  notes: string
}

export default function ContactsPage() {
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortKey>('score')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<EditForm>({ name: '', notes: '' })
  const [creating, setCreating] = useState(false)
  const [newForm, setNewForm] = useState({ name: '', email: '', notes: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cleaning, setCleaning] = useState(false)
  const [cleanResult, setCleanResult] = useState<number | null>(null)

  const { data, mutate } = useSWR<{ data: Contact[] }>(
    `/api/contacts?all=true&limit=200&sort=${sort}`,
    fetcher
  )
  const allContacts = data?.data ?? []

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    if (!q) return allContacts
    return allContacts.filter(c =>
      c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q)
    )
  }, [allContacts, search])

  const oneshots = allContacts.filter(c => c.frequency < 2 && !c.isManual && !c.isStarred).length

  const startEdit = (c: Contact) => {
    setEditingId(c.id)
    setEditForm({ name: c.name, notes: c.notes ?? '' })
    setError(null)
  }

  const saveEdit = async () => {
    if (!editingId) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/contacts/${editingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editForm.name, notes: editForm.notes }),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      await mutate()
      setEditingId(null)
    } catch (err) {
      setError(String(err))
    } finally {
      setSaving(false)
    }
  }

  const toggleStar = async (c: Contact) => {
    await fetch(`/api/contacts/${c.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isStarred: !c.isStarred }),
    })
    await mutate()
  }

  const deleteContact = async (id: string) => {
    if (!confirm('Supprimer ce contact ?')) return
    await fetch(`/api/contacts/${id}`, { method: 'DELETE' })
    await mutate()
  }

  const createContact = async () => {
    if (!newForm.email.trim()) { setError('Email requis'); return }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newForm),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      await mutate()
      setCreating(false)
      setNewForm({ name: '', email: '', notes: '' })
    } catch (err) {
      setError(String(err))
    } finally {
      setSaving(false)
    }
  }

  const cleanOneshots = async () => {
    if (!confirm(`Supprimer ${oneshots} contact${oneshots > 1 ? 's' : ''} one-shot ?`)) return
    setCleaning(true)
    try {
      const res = await fetch('/api/contacts?oneshots=true', { method: 'DELETE' })
      const json = await res.json()
      setCleanResult(json.data?.deleted ?? 0)
      await mutate()
    } finally {
      setCleaning(false)
    }
  }

  const SORT_OPTIONS: { value: SortKey; label: string }[] = [
    { value: 'score', label: 'Pertinence' },
    { value: 'frequency', label: 'Fréquence' },
    { value: 'recent', label: 'Récents' },
    { value: 'name', label: 'Nom A→Z' },
  ]

  return (
    <div className="p-8 max-w-3xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Contacts</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {allContacts.length} contact{allContacts.length !== 1 ? 's' : ''}
            {oneshots > 0 && (
              <span className="ml-1 text-amber-500">· {oneshots} one-shot{oneshots > 1 ? 's' : ''}</span>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          {oneshots > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={cleanOneshots}
              disabled={cleaning}
              className="text-xs h-8 text-amber-600 border-amber-200 hover:bg-amber-50 dark:hover:bg-amber-950"
            >
              {cleaning ? 'Nettoyage…' : `Nettoyer (${oneshots})`}
            </Button>
          )}
          <Button size="sm" onClick={() => { setCreating(true); setError(null) }} className="gap-1.5 h-8">
            <Plus className="w-3.5 h-3.5" /> Ajouter
          </Button>
        </div>
      </div>

      {cleanResult !== null && (
        <div className="mb-4 px-3 py-2 bg-green-500/10 text-green-700 dark:text-green-400 text-sm rounded-lg flex items-center justify-between">
          <span>{cleanResult} contact{cleanResult !== 1 ? 's' : ''} supprimé{cleanResult !== 1 ? 's' : ''}</span>
          <button onClick={() => setCleanResult(null)}><X className="w-3.5 h-3.5" /></button>
        </div>
      )}

      {error && <p className="text-sm text-destructive mb-4">{error}</p>}

      {/* Create form */}
      {creating && (
        <div className="mb-6 p-4 border border-border rounded-xl space-y-3 bg-card">
          <h2 className="text-sm font-semibold">Nouveau contact</h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Nom</label>
              <Input
                value={newForm.name}
                onChange={e => setNewForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Prénom Nom"
                className="h-8 text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Email *</label>
              <Input
                value={newForm.email}
                onChange={e => setNewForm(f => ({ ...f, email: e.target.value }))}
                placeholder="email@exemple.com"
                type="email"
                className="h-8 text-sm"
                autoFocus
              />
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Notes</label>
            <Input
              value={newForm.notes}
              onChange={e => setNewForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="Optionnel…"
              className="h-8 text-sm"
            />
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={createContact} disabled={saving}>
              {saving ? 'Enregistrement…' : 'Créer'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setCreating(false); setError(null) }}>
              Annuler
            </Button>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Rechercher…"
            className="w-full h-8 pl-8 pr-3 text-sm rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-ring"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-1 rounded-lg border border-border bg-muted p-0.5">
          {SORT_OPTIONS.map(o => (
            <button
              key={o.value}
              onClick={() => setSort(o.value)}
              className={cn(
                'px-2.5 py-1 text-xs rounded-md transition-colors',
                sort === o.value
                  ? 'bg-background text-foreground shadow-sm font-medium'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {/* Empty state */}
      {allContacts.length === 0 && !creating && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Users className="w-12 h-12 text-muted-foreground/30 mb-3" />
          <p className="text-sm font-medium text-muted-foreground">Aucun contact</p>
          <p className="text-xs text-muted-foreground/60 mt-1">
            Les contacts apparaissent automatiquement à partir de vos emails envoyés et reçus.
          </p>
        </div>
      )}

      {/* Contact list */}
      <div className="space-y-1">
        {filtered.map(c => (
          <div
            key={c.id}
            className={cn(
              'border border-border rounded-xl overflow-hidden bg-card transition-colors',
              editingId === c.id && 'ring-1 ring-ring'
            )}
          >
            {editingId === c.id ? (
              /* Edit form */
              <div className="p-4 space-y-3">
                <div className="flex items-center gap-3 mb-1">
                  <Avatar name={c.name} email={c.email} />
                  <span className="text-sm text-muted-foreground">{c.email}</span>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Nom</label>
                  <Input
                    value={editForm.name}
                    onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                    className="h-8 text-sm"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Notes</label>
                  <Input
                    value={editForm.notes}
                    onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))}
                    placeholder="Optionnel…"
                    className="h-8 text-sm"
                  />
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={saveEdit} disabled={saving}>
                    {saving ? 'Enregistrement…' : 'Enregistrer'}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>Annuler</Button>
                </div>
              </div>
            ) : (
              /* Row */
              <div className="flex items-center gap-3 px-4 py-3">
                <Avatar name={c.name} email={c.email} />

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-medium truncate">{c.name || c.email}</span>
                    {c.isManual && (
                      <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded shrink-0">Manuel</span>
                    )}
                    {c.sentCount > 0 && c.receivedCount > 0 && (
                      <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded shrink-0">↔ dialogue</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                    <span className="truncate">{c.email}</span>
                    <span>·</span>
                    <span className="shrink-0 tabular-nums">{c.frequency} msg</span>
                    <span>·</span>
                    <span className="shrink-0">{formatDate(c.lastContactAt)}</span>
                    {c.notes && (
                      <>
                        <span>·</span>
                        <span className="truncate italic">{c.notes}</span>
                      </>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-0.5 shrink-0">
                  <button
                    onClick={() => toggleStar(c)}
                    title={c.isStarred ? 'Retirer des favoris' : 'Mettre en favori'}
                    className={cn(
                      'w-7 h-7 flex items-center justify-center rounded transition-colors',
                      c.isStarred
                        ? 'text-yellow-500 hover:text-yellow-400'
                        : 'text-muted-foreground hover:text-yellow-500'
                    )}
                  >
                    <Star className={cn('w-3.5 h-3.5', c.isStarred && 'fill-current')} />
                  </button>
                  <button
                    onClick={() => startEdit(c)}
                    className="w-7 h-7 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => deleteContact(c.id)}
                    className="w-7 h-7 flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {filtered.length === 0 && search && (
        <p className="text-sm text-muted-foreground text-center py-8">
          Aucun contact pour « {search} »
        </p>
      )}
    </div>
  )
}
