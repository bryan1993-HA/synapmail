'use client'

import { useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import useSWR from 'swr'
import { Pencil, Trash2, Plus, LayoutTemplate } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { ComposeTemplate } from '@/types/template'
import { SettingsPage, SettingsHeader } from '@/components/settings/primitives'

const fetcher = (url: string) => fetch(url).then(r => r.json())

const VAR_RE = /\{\{(\w+)\}\}/g

function extractVars(html: string): string[] {
  return Array.from(new Set(Array.from(html.matchAll(VAR_RE)).map(m => m[1])))
}

function TemplateEditor({
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
      Placeholder.configure({ placeholder: 'Contenu du template… Utilisez {{prenom}}, {{societe}} pour des variables.' }),
    ],
    content: initialHtml,
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    editorProps: {
      attributes: {
        class: 'outline-none min-h-[120px] text-sm text-foreground px-4 py-3 prose prose-sm max-w-none',
      },
    },
  })

  return (
    <div className="border border-border rounded-lg overflow-hidden bg-background">
      <EditorContent editor={editor} />
    </div>
  )
}

export default function TemplatesPage() {
  const { data, mutate } = useSWR<{ data: ComposeTemplate[] }>('/api/templates', fetcher)
  const templates = data?.data ?? []

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editSubject, setEditSubject] = useState('')
  const [editHtml, setEditHtml] = useState('')

  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newSubject, setNewSubject] = useState('')
  const [newHtml, setNewHtml] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const startEdit = (tpl: ComposeTemplate) => {
    setEditingId(tpl.id)
    setEditName(tpl.name)
    setEditSubject(tpl.subject)
    setEditHtml(tpl.contentHtml)
    setError(null)
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
      const res = await fetch(`/api/templates/${editingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editName, subject: editSubject, contentHtml: editHtml }),
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

  const deleteTemplate = async (id: string) => {
    if (!confirm('Supprimer ce template ?')) return
    await fetch(`/api/templates/${id}`, { method: 'DELETE' })
    await mutate()
  }

  const createTemplate = async () => {
    if (!newName.trim()) { setError('Nom requis'); return }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName, subject: newSubject, contentHtml: newHtml }),
      })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error ?? 'Erreur')
      }
      await mutate()
      setCreating(false)
      setNewName('')
      setNewSubject('')
      setNewHtml('')
    } catch (err) {
      setError(String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <SettingsPage width="2xl">
      <SettingsHeader
        icon={<LayoutTemplate className="h-4 w-4" />}
        title="Templates"
        description="Modèles de composition réutilisables avec variables dynamiques"
      />

      <div className="mb-4 flex">
        <Button size="sm" onClick={() => { setCreating(true); setError(null) }} className="gap-1.5">
          <Plus className="w-3.5 h-3.5" /> Nouveau template
        </Button>
      </div>

      <p className="text-sm text-muted-foreground mb-6">
        Utilisez <code className="bg-muted px-1 rounded text-xs">{'{{variable}}'}</code> pour insérer des valeurs dynamiques (ex : <code className="bg-muted px-1 rounded text-xs">{'{{prenom}}'}</code>, <code className="bg-muted px-1 rounded text-xs">{'{{societe}}'}</code>).
      </p>

      {error && <p className="text-sm text-destructive mb-4">{error}</p>}

      {/* Create form */}
      {creating && (
        <div className="mb-6 space-y-3 rounded-2xl border border-border bg-card/80 p-5 shadow-sm backdrop-blur-sm">
          <h2 className="text-sm font-semibold">Nouveau template</h2>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Nom</label>
            <Input
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="Ex : Relance client"
              className="h-8 text-sm"
              autoFocus
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Préfixe de sujet <span className="opacity-50">(optionnel)</span></label>
            <Input
              value={newSubject}
              onChange={e => setNewSubject(e.target.value)}
              placeholder="Ex : Relance — {{societe}}"
              className="h-8 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Contenu</label>
            <TemplateEditor initialHtml={newHtml} onChange={setNewHtml} />
          </div>
          {extractVars(newHtml + ' ' + newSubject).length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-xs text-muted-foreground">Variables :</span>
              {extractVars(newHtml + ' ' + newSubject).map(v => (
                <span key={v} className="inline-flex items-center px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-600 dark:text-violet-400 text-xs font-mono">
                  {`{{${v}}}`}
                </span>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <Button size="sm" onClick={createTemplate} disabled={saving}>
              {saving ? 'Enregistrement…' : 'Créer'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setCreating(false); setError(null) }}>
              Annuler
            </Button>
          </div>
        </div>
      )}

      {/* Templates list */}
      {templates.length === 0 && !creating && (
        <p className="text-sm text-muted-foreground">Aucun template. Créez-en un !</p>
      )}

      <div className="space-y-3">
        {templates.map(tpl => (
          <div key={tpl.id} className="border border-border rounded-xl overflow-hidden bg-card shadow-sm">
            {editingId === tpl.id ? (
              <div className="p-4 space-y-3">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Nom</label>
                  <Input value={editName} onChange={e => setEditName(e.target.value)} className="h-8 text-sm" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Préfixe de sujet <span className="opacity-50">(optionnel)</span></label>
                  <Input value={editSubject} onChange={e => setEditSubject(e.target.value)} className="h-8 text-sm" placeholder="Ex : Relance — {{societe}}" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Contenu</label>
                  <TemplateEditor key={editingId} initialHtml={editHtml} onChange={setEditHtml} />
                </div>
                {extractVars(editHtml + ' ' + editSubject).length > 0 && (
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-xs text-muted-foreground">Variables :</span>
                    {extractVars(editHtml + ' ' + editSubject).map(v => (
                      <span key={v} className="inline-flex items-center px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-600 dark:text-violet-400 text-xs font-mono">
                        {`{{${v}}}`}
                      </span>
                    ))}
                  </div>
                )}
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
                  <div>
                    <span className="font-medium text-sm">{tpl.name}</span>
                    {tpl.subject && (
                      <p className="text-xs text-muted-foreground mt-0.5">Sujet : {tpl.subject}</p>
                    )}
                    {extractVars(tpl.contentHtml + ' ' + tpl.subject).length > 0 && (
                      <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                        {extractVars(tpl.contentHtml + ' ' + tpl.subject).map(v => (
                          <span key={v} className="inline-flex items-center px-1.5 py-0.5 rounded bg-muted text-muted-foreground text-xs font-mono">
                            {`{{${v}}}`}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button
                      onClick={() => startEdit(tpl)}
                      className="w-7 h-7 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => deleteTemplate(tpl.id)}
                      className="w-7 h-7 flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                {tpl.contentHtml && (
                  <div
                    className={cn(
                      'mt-2 text-xs text-muted-foreground border-l-2 border-border pl-3 line-clamp-2',
                      'prose prose-sm max-w-none'
                    )}
                    dangerouslySetInnerHTML={{ __html: tpl.contentHtml }}
                  />
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </SettingsPage>
  )
}
