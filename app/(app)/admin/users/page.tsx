'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { UserPlus, Trash2, ShieldCheck, User as UserIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

const fetcher = (url: string) => fetch(url).then(r => r.json())

type UserRow = {
  id: string
  name: string
  email: string
  role: 'admin' | 'user'
  createdAt: string
}

export default function AdminUsersPage() {
  const { data, mutate } = useSWR<{ data: UserRow[] }>('/api/admin/users', fetcher)
  const users = data?.data ?? []

  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<'admin' | 'user'>('user')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  const createUser = async () => {
    if (!name || !email || !password) { setError('Tous les champs sont requis'); return }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password, role }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error ?? 'Erreur')
      await mutate()
      setShowForm(false)
      setName(''); setEmail(''); setPassword(''); setRole('user')
    } catch (err) {
      setError(String(err))
    } finally {
      setSaving(false)
    }
  }

  const toggleRole = async (user: UserRow) => {
    const newRole = user.role === 'admin' ? 'user' : 'admin'
    await fetch(`/api/admin/users/${user.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: newRole }),
    })
    await mutate()
  }

  const deleteUser = async (id: string) => {
    await fetch(`/api/admin/users/${id}`, { method: 'DELETE' })
    setConfirmDelete(null)
    await mutate()
  }

  return (
    <div className="p-8 max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Gestion des utilisateurs</h1>
        <Button size="sm" onClick={() => { setShowForm(f => !f); setError(null) }} className="gap-1.5">
          <UserPlus className="w-3.5 h-3.5" /> Ajouter
        </Button>
      </div>

      {/* Create form */}
      {showForm && (
        <div className="mb-6 p-4 border border-border rounded-xl bg-card space-y-3">
          <h2 className="text-sm font-semibold">Nouvel utilisateur</h2>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Nom</label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="Nom" className="h-8 text-sm" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Email</label>
              <Input value={email} onChange={e => setEmail(e.target.value)} placeholder="email@exemple.com" type="email" className="h-8 text-sm" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Mot de passe</label>
              <Input value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" type="password" className="h-8 text-sm" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Rôle</label>
              <select
                value={role}
                onChange={e => setRole(e.target.value as 'admin' | 'user')}
                className="h-8 w-full text-sm rounded-md border border-input bg-background px-3 focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="user">Utilisateur</option>
                <option value="admin">Admin</option>
              </select>
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={createUser} disabled={saving}>
              {saving ? 'Création…' : 'Créer'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setShowForm(false); setError(null) }}>Annuler</Button>
          </div>
        </div>
      )}

      {/* Users table */}
      <div className="border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left px-4 py-3 font-medium">Nom</th>
              <th className="text-left px-4 py-3 font-medium">Email</th>
              <th className="text-left px-4 py-3 font-medium">Rôle</th>
              <th className="text-left px-4 py-3 font-medium">Créé le</th>
              <th className="px-4 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {users.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground text-sm">
                  Aucun utilisateur
                </td>
              </tr>
            )}
            {users.map(user => (
              <tr key={user.id} className="hover:bg-accent/30 transition-colors">
                <td className="px-4 py-3 font-medium">{user.name}</td>
                <td className="px-4 py-3 text-muted-foreground">{user.email}</td>
                <td className="px-4 py-3">
                  <span className={cn(
                    'text-xs px-2 py-0.5 rounded-full font-medium',
                    user.role === 'admin'
                      ? 'bg-primary/10 text-primary'
                      : 'bg-muted text-muted-foreground'
                  )}>
                    {user.role}
                  </span>
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {new Date(user.createdAt).toLocaleDateString('fr-FR')}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    <button
                      onClick={() => toggleRole(user)}
                      title={user.role === 'admin' ? 'Rétrograder en user' : 'Promouvoir admin'}
                      className="w-7 h-7 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                    >
                      {user.role === 'admin' ? <UserIcon className="w-3.5 h-3.5" /> : <ShieldCheck className="w-3.5 h-3.5" />}
                    </button>
                    {confirmDelete === user.id ? (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => deleteUser(user.id)}
                          className="text-xs px-2 py-1 rounded bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
                        >
                          Confirmer
                        </button>
                        <button
                          onClick={() => setConfirmDelete(null)}
                          className="text-xs px-2 py-1 rounded hover:bg-accent transition-colors"
                        >
                          Annuler
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmDelete(user.id)}
                        className="w-7 h-7 flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
