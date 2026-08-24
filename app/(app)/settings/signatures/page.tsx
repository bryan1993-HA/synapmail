'use client'

import { useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import useSWR from 'swr'
import { Pencil, Trash2, Plus, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { Signature } from '@/types/account'

const fetcher = (url: string) => fetch(url).then(r => r.json())

function SignatureEditor({
  initialHtml,
  onChange,
}: {
  initialHtml: string
  onChange: (html: string) => void
}) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Link.configure({ openOnClick: false }),
      Placeholder.configure({ placeholder: 'Contenu de la signature…' }),
    ],
    content: initialHtml,
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    editorProps: {
      attributes: {
        class: 'outline-none min-h-[100px] text-sm text-foreground px-4 py-3 prose prose-sm max-w-none',
      },
    },
  })

  return (
    <div className="border border-border rounded-lg overflow-hidden bg-background">
      <EditorContent editor={editor} />
    </div>
  )
}

export default function SignaturesPage() {
  const { data, mutate } = useSWR<{ data: Signature[] }>('/api/signatures', fetcher)
  const signatures = data?.data ?? []

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editHtml, setEditHtml] = useState('')
  const [editDefault, setEditDefault] = useState(false)

  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newHtml, setNewHtml] = useState('')
  const [newDefault, setNewDefault] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const startEdit = (sig: Signature) => {
    setEditingId(sig.id)
    setEditName(sig.name)
    setEditHtml(sig.contentHtml)
    setEditDefault(sig.isDefault)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setError(null)
  }

  const saveEdit = async () => {
    if (!editingId) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/signatures/${editingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editName, contentHtml: editHtml, isDefault: editDefault }),
      })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error ?? 'Erreur')
      }
      await mutate()
      setEditingId(null)
    } catch (err) {
      setError(String(err))
    } finally {
      setSaving(false)
    }
  }

  const deleteSignature = async (id: string) => {
    if (!confirm('Supprimer cette signature ?')) return
    await fetch(`/api/signatures/${id}`, { method: 'DELETE' })
    await mutate()
  }

  const createSignature = async () => {
    if (!newName.trim()) { setError('Nom requis'); return }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/signatures', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName, contentHtml: newHtml, isDefault: newDefault }),
      })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error ?? 'Erreur')
      }
      await mutate()
      setCreating(false)
      setNewName('')
      setNewHtml('')
      setNewDefault(false)
    } catch (err) {
      setError(String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-8 max-w-2xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Signatures</h1>
        <Button size="sm" onClick={() => { setCreating(true); setError(null) }} className="gap-1.5">
          <Plus className="w-3.5 h-3.5" /> Nouvelle signature
        </Button>
      </div>

      {error && <p className="text-sm text-destructive mb-4">{error}</p>}

      {/* Create form */}
      {creating && (
        <div className="mb-6 p-4 border border-border rounded-xl space-y-3 bg-card">
          <h2 className="text-sm font-semibold">Nouvelle signature</h2>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Nom</label>
            <Input
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="Ma signature"
              className="h-8 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Contenu</label>
            <SignatureEditor initialHtml={newHtml} onChange={setNewHtml} />
          </div>
          <label className="flex items-center gap-2 cursor-pointer text-sm">
            <input
              type="checkbox"
              checked={newDefault}
              onChange={e => setNewDefault(e.target.checked)}
              className="rounded"
            />
            Signature par défaut
          </label>
          <div className="flex gap-2">
            <Button size="sm" onClick={createSignature} disabled={saving}>
              {saving ? 'Enregistrement…' : 'Créer'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setCreating(false); setError(null) }}>
              Annuler
            </Button>
          </div>
        </div>
      )}

      {/* Signatures list */}
      {signatures.length === 0 && !creating && (
        <p className="text-sm text-muted-foreground">Aucune signature. Créez-en une !</p>
      )}

      <div className="space-y-3">
        {signatures.map(sig => (
          <div key={sig.id} className="border border-border rounded-xl overflow-hidden bg-card">
            {editingId === sig.id ? (
              <div className="p-4 space-y-3">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Nom</label>
                  <Input
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    className="h-8 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Contenu</label>
                  <SignatureEditor key={editingId} initialHtml={editHtml} onChange={setEditHtml} />
                </div>
                <label className="flex items-center gap-2 cursor-pointer text-sm">
                  <input
                    type="checkbox"
                    checked={editDefault}
                    onChange={e => setEditDefault(e.target.checked)}
                    className="rounded"
                  />
                  Signature par défaut
                </label>
                <div className="flex gap-2">
                  <Button size="sm" onClick={saveEdit} disabled={saving}>
                    {saving ? 'Enregistrement…' : 'Enregistrer'}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={cancelEdit}>Annuler</Button>
                </div>
              </div>
            ) : (
              <div className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{sig.name}</span>
                    {sig.isDefault && (
                      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                        <Check className="w-3 h-3" /> Par défaut
                      </span>
                    )}
                  </div>
                  <div className="flex gap-1">
                    <button
                      onClick={() => startEdit(sig)}
                      className="w-7 h-7 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => deleteSignature(sig.id)}
                      className="w-7 h-7 flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                {sig.contentHtml && (
                  <div
                    className={cn(
                      'mt-2 text-xs text-muted-foreground border-l-2 border-border pl-3',
                      'prose prose-sm max-w-none'
                    )}
                    dangerouslySetInnerHTML={{ __html: sig.contentHtml }}
                  />
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
