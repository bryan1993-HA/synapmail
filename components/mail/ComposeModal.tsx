'use client'

import { useState, useCallback, useEffect } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Link from '@tiptap/extension-link'
import TextAlign from '@tiptap/extension-text-align'
import Placeholder from '@tiptap/extension-placeholder'
import {
  X, Bold, Italic, Underline as UnderlineIcon, Strikethrough,
  AlignLeft, AlignCenter, AlignRight, AlignJustify,
  List, ListOrdered, Link as LinkIcon, Undo, Redo,
  Minus, Paperclip,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import useSWR from 'swr'
import type { Signature } from '@/types/account'
import type { Attachment } from '@/types/email'

const fetcher = (url: string) => fetch(url).then(r => r.json())

interface ForwardedAtt extends Attachment {
  uid: string
  accountId: string
  folder: string
}

interface ComposeModalProps {
  mode: 'compose' | 'reply' | 'replyAll' | 'forward'
  replyTo?: {
    uid: string
    from: { name: string; address: string }
    to: { address: string; name?: string }[]
    cc?: { address: string; name?: string }[]
    subject: string
    bodyHtml?: string
    bodyPlain?: string
    date: string
    accountId: string
    attachments?: ForwardedAtt[]
  }
  accountEmail: string
  accountId: string
  onClose: () => void
  onSent: () => void
}

function ToolbarBtn({
  onClick, active, disabled, title, children,
}: {
  onClick: () => void
  active?: boolean
  disabled?: boolean
  title: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onMouseDown={e => { e.preventDefault(); onClick() }}
      disabled={disabled}
      title={title}
      className={cn(
        'w-7 h-7 flex items-center justify-center rounded text-sm transition-colors',
        active
          ? 'bg-primary/15 text-primary'
          : 'text-muted-foreground hover:text-foreground hover:bg-accent',
        disabled && 'opacity-30 cursor-not-allowed'
      )}
    >
      {children}
    </button>
  )
}

function Separator() {
  return <div className="w-px h-5 bg-border mx-0.5 shrink-0" />
}

export function ComposeModal({ mode, replyTo, accountEmail, accountId, onClose, onSent }: ComposeModalProps) {
  const [to, setTo] = useState(() => {
    if ((mode === 'reply' || mode === 'replyAll') && replyTo) return replyTo.from.address
    return ''
  })
  const [cc, setCc] = useState(() => {
    if (mode === 'replyAll' && replyTo) {
      // All original recipients (To + CC) minus our own email
      const allRecipients = [
        ...(replyTo.to ?? []),
        ...(replyTo.cc ?? []),
      ].map(a => a.address).filter(addr => addr.toLowerCase() !== accountEmail.toLowerCase())
      return allRecipients.join(', ')
    }
    return ''
  })
  const [bcc, setBcc] = useState('')
  const [showCc, setShowCc] = useState(mode === 'replyAll')
  const [showBcc, setShowBcc] = useState(false)
  const [subject, setSubject] = useState(() => {
    if ((mode === 'reply' || mode === 'replyAll') && replyTo) return `Re: ${replyTo.subject.replace(/^(Re|Fwd):\s*/i, '')}`
    if (mode === 'forward' && replyTo) return `Fwd: ${replyTo.subject.replace(/^(Re|Fwd):\s*/i, '')}`
    return ''
  })
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedSigId, setSelectedSigId] = useState<string | null>(null)
  const [sigApplied, setSigApplied] = useState(false)
  const [draftRestored, setDraftRestored] = useState(false)
  const [pendingDraftContent, setPendingDraftContent] = useState<string | null>(null)

  // Draft auto-save key — only for compose mode
  const DRAFT_KEY = mode === 'compose' ? `synapmail:draft:${accountId}` : null

  // Forwarded attachments (for forward mode) — user can remove them
  const [forwardedAtts, setForwardedAtts] = useState<ForwardedAtt[]>(() => {
    if (mode === 'forward' && replyTo?.attachments?.length) {
      return replyTo.attachments
    }
    return []
  })

  const { data: sigData } = useSWR<{ data: Signature[] }>('/api/signatures', fetcher)

  // Restore draft on mount (compose mode only)
  useEffect(() => {
    if (!DRAFT_KEY) return
    const saved = localStorage.getItem(DRAFT_KEY)
    if (!saved) return
    try {
      const draft = JSON.parse(saved) as { to: string; cc: string; bcc: string; subject: string; content: string }
      if (draft.to || draft.subject || draft.content) {
        setTo(draft.to ?? '')
        setCc(draft.cc ?? '')
        setBcc(draft.bcc ?? '')
        setSubject(draft.subject ?? '')
        if (draft.cc) setShowCc(true)
        if (draft.bcc) setShowBcc(true)
        setPendingDraftContent(draft.content)
        setDraftRestored(true)
      }
    } catch { /* ignore */ }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const quotedHtml = useCallback(() => {
    if (!replyTo || mode === 'compose') return ''
    const from = replyTo.from.name
      ? `${replyTo.from.name} &lt;${replyTo.from.address}&gt;`
      : replyTo.from.address
    const date = new Date(replyTo.date).toLocaleString('fr-FR')
    const body = replyTo.bodyHtml || `<pre style="white-space:pre-wrap">${replyTo.bodyPlain ?? ''}</pre>`
    return `<br/><blockquote style="border-left:3px solid #cbd5e1;padding-left:12px;color:#64748b;margin:16px 0 0">
      <p style="color:#94a3b8;font-size:12px;margin:0 0 8px">Le ${date}, ${from} a écrit :</p>
      ${body}
    </blockquote>`
  }, [replyTo, mode])

  const signatures = sigData?.data ?? []

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Link.configure({ openOnClick: false }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Placeholder.configure({ placeholder: 'Écrivez votre message…' }),
    ],
    content: '',
    editorProps: {
      attributes: {
        class: 'outline-none min-h-[180px] text-sm text-foreground px-4 py-3 prose prose-sm max-w-none',
      },
    },
  })

  // Apply default signature once editor is ready
  useEffect(() => {
    if (!editor || sigApplied || !signatures.length) return
    const defaultSig = signatures.find(s => s.isDefault) ?? signatures[0]
    if (defaultSig) {
      setSelectedSigId(defaultSig.id)
      // If draft content restored, prepend it before signature
      const bodyPart = pendingDraftContent ?? '<p></p>'
      editor.commands.setContent(`${bodyPart}<p>-- </p>${defaultSig.contentHtml}`)
      setPendingDraftContent(null)
      setSigApplied(true)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, sigApplied, signatures.length])

  // Apply pending draft content once editor ready (no signatures case)
  useEffect(() => {
    if (!editor || !pendingDraftContent || sigApplied) return
    if (signatures.length > 0) return // handled above
    editor.commands.setContent(pendingDraftContent)
    setPendingDraftContent(null)
  }, [editor, pendingDraftContent, sigApplied, signatures.length])

  // Auto-save draft every 3s after last change (compose mode only)
  useEffect(() => {
    if (!DRAFT_KEY || !editor) return
    const timer = setTimeout(() => {
      const content = editor.getHTML()
      const isEmpty = !to && !subject && (content === '<p></p>' || content === '')
      if (isEmpty) return
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ to, cc, bcc, subject, content }))
    }, 3000)
    return () => clearTimeout(timer)
  }, [to, cc, bcc, subject, editor]) // eslint-disable-line react-hooks/exhaustive-deps

  const SIG_SEP_RE = /<p[^>]*>--\s*<\/p>/

  const handleSigChange = (sigId: string) => {
    if (!editor) return
    setSelectedSigId(sigId || null)
    const sig = sigId ? signatures.find(s => s.id === sigId) : null
    const currentHtml = editor.getHTML()
    const match = SIG_SEP_RE.exec(currentHtml)
    const bodyHtml = match ? currentHtml.slice(0, match.index) : currentHtml
    const newContent = sig
      ? `${bodyHtml}<p>-- </p>${sig.contentHtml}`
      : bodyHtml || '<p></p>'
    editor.commands.setContent(newContent)
  }

  const setLink = () => {
    if (!editor) return
    const url = window.prompt('URL du lien :')
    if (!url) return
    editor.chain().focus().setLink({ href: url }).run()
  }

  const removeForwardedAtt = (id: string) => {
    setForwardedAtts(prev => prev.filter(a => a.id !== id))
  }

  const handleSend = async () => {
    if (!to.trim() || !subject.trim()) {
      setError('Destinataire et sujet requis')
      return
    }
    setSending(true)
    setError(null)
    try {
      const bodyHtml = (editor?.getHTML() ?? '') + quotedHtml()
      const payload: Record<string, unknown> = {
        accountId,
        to: to.split(',').map(s => s.trim()).filter(Boolean),
        cc: cc ? cc.split(',').map(s => s.trim()).filter(Boolean) : undefined,
        bcc: bcc ? bcc.split(',').map(s => s.trim()).filter(Boolean) : undefined,
        subject,
        html: bodyHtml,
        inReplyTo: (mode === 'reply' || mode === 'replyAll') && replyTo ? replyTo.uid : undefined,
      }

      if (mode === 'forward' && forwardedAtts.length) {
        payload.forwardedAttachments = forwardedAtts.map(a => ({
          uid: a.uid,
          accountId: a.accountId,
          folder: a.folder,
          partIdx: parseInt(a.id),
          filename: a.filename,
          contentType: a.contentType,
        }))
      }

      const res = await fetch('/api/messages/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error ?? 'Erreur lors de l\'envoi')
      }
      if (DRAFT_KEY) localStorage.removeItem(DRAFT_KEY)
      onSent()
      onClose()
    } catch (err) {
      setError(String(err))
    } finally {
      setSending(false)
    }
  }

  const modeTitle: Record<typeof mode, string> = {
    compose: 'Nouveau message',
    reply: 'Répondre',
    replyAll: 'Répondre à tous',
    forward: 'Transférer',
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-end p-4 pointer-events-none">
      <div className="pointer-events-auto w-[660px] max-w-[95vw] bg-background border border-border rounded-xl shadow-2xl flex flex-col max-h-[85vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0 bg-muted/30 rounded-t-xl">
          <span className="text-sm font-semibold text-foreground">{modeTitle[mode]}</span>
          {draftRestored && (
            <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded flex items-center gap-1">
              Brouillon restauré
              <button onClick={() => { setDraftRestored(false); if (DRAFT_KEY) localStorage.removeItem(DRAFT_KEY) }} className="hover:text-foreground">×</button>
            </span>
          )}
          <button
            onClick={() => { if (DRAFT_KEY) localStorage.removeItem(DRAFT_KEY); onClose() }}
            className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Fields */}
        <div className="px-4 pt-3 space-y-1.5 shrink-0">
          {/* To */}
          <div className="flex items-center gap-2 border-b border-border pb-1.5">
            <span className="text-xs text-muted-foreground w-10 shrink-0">À</span>
            <Input
              value={to}
              onChange={e => setTo(e.target.value)}
              placeholder="destinataire@exemple.com"
              className="h-7 text-sm border-0 rounded-none px-0 focus-visible:ring-0 shadow-none"
            />
            <div className="flex items-center gap-1 shrink-0">
              {!showCc && (
                <button
                  onClick={() => setShowCc(true)}
                  className="text-xs text-muted-foreground hover:text-foreground px-1"
                >
                  Cc
                </button>
              )}
              {!showBcc && (
                <button
                  onClick={() => setShowBcc(true)}
                  className="text-xs text-muted-foreground hover:text-foreground px-1"
                >
                  Cci
                </button>
              )}
            </div>
          </div>

          {/* CC */}
          {showCc && (
            <div className="flex items-center gap-2 border-b border-border pb-1.5">
              <span className="text-xs text-muted-foreground w-10 shrink-0">Cc</span>
              <Input
                value={cc}
                onChange={e => setCc(e.target.value)}
                placeholder="cc@exemple.com"
                className="h-7 text-sm border-0 rounded-none px-0 focus-visible:ring-0 shadow-none"
                autoFocus={mode !== 'replyAll'}
              />
              <button onClick={() => setShowCc(false)} className="shrink-0 text-muted-foreground hover:text-foreground">
                <X className="w-3 h-3" />
              </button>
            </div>
          )}

          {/* BCC */}
          {showBcc && (
            <div className="flex items-center gap-2 border-b border-border pb-1.5">
              <span className="text-xs text-muted-foreground w-10 shrink-0">Cci</span>
              <Input
                value={bcc}
                onChange={e => setBcc(e.target.value)}
                placeholder="bcc@exemple.com"
                className="h-7 text-sm border-0 rounded-none px-0 focus-visible:ring-0 shadow-none"
                autoFocus
              />
              <button onClick={() => setShowBcc(false)} className="shrink-0 text-muted-foreground hover:text-foreground">
                <X className="w-3 h-3" />
              </button>
            </div>
          )}

          {/* Subject */}
          <div className="flex items-center gap-2 border-b border-border pb-1.5">
            <span className="text-xs text-muted-foreground w-10 shrink-0">Objet</span>
            <Input
              value={subject}
              onChange={e => setSubject(e.target.value)}
              placeholder="Objet de votre message"
              className="h-7 text-sm border-0 rounded-none px-0 focus-visible:ring-0 shadow-none"
            />
          </div>

          {/* Forwarded attachments */}
          {mode === 'forward' && forwardedAtts.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pb-1.5 border-b border-border">
              {forwardedAtts.map(att => (
                <div key={att.id} className="flex items-center gap-1.5 bg-muted/50 rounded-md px-2 py-1 text-xs text-muted-foreground">
                  <Paperclip className="w-3 h-3 shrink-0" />
                  <span className="max-w-[140px] truncate text-foreground">{att.filename}</span>
                  <button
                    onClick={() => removeForwardedAtt(att.id)}
                    className="hover:text-destructive transition-colors"
                    title="Retirer cette pièce jointe"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Toolbar */}
        {editor && (
          <div className="flex items-center gap-0.5 px-3 py-1.5 border-b border-border shrink-0 flex-wrap">
            <ToolbarBtn onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()} title="Annuler">
              <Undo className="w-3.5 h-3.5" />
            </ToolbarBtn>
            <ToolbarBtn onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()} title="Rétablir">
              <Redo className="w-3.5 h-3.5" />
            </ToolbarBtn>

            <Separator />

            <ToolbarBtn onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')} title="Gras">
              <Bold className="w-3.5 h-3.5" />
            </ToolbarBtn>
            <ToolbarBtn onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')} title="Italique">
              <Italic className="w-3.5 h-3.5" />
            </ToolbarBtn>
            <ToolbarBtn onClick={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive('underline')} title="Souligné">
              <UnderlineIcon className="w-3.5 h-3.5" />
            </ToolbarBtn>
            <ToolbarBtn onClick={() => editor.chain().focus().toggleStrike().run()} active={editor.isActive('strike')} title="Barré">
              <Strikethrough className="w-3.5 h-3.5" />
            </ToolbarBtn>

            <Separator />

            <ToolbarBtn onClick={() => editor.chain().focus().setTextAlign('left').run()} active={editor.isActive({ textAlign: 'left' })} title="Aligner à gauche">
              <AlignLeft className="w-3.5 h-3.5" />
            </ToolbarBtn>
            <ToolbarBtn onClick={() => editor.chain().focus().setTextAlign('center').run()} active={editor.isActive({ textAlign: 'center' })} title="Centrer">
              <AlignCenter className="w-3.5 h-3.5" />
            </ToolbarBtn>
            <ToolbarBtn onClick={() => editor.chain().focus().setTextAlign('right').run()} active={editor.isActive({ textAlign: 'right' })} title="Aligner à droite">
              <AlignRight className="w-3.5 h-3.5" />
            </ToolbarBtn>
            <ToolbarBtn onClick={() => editor.chain().focus().setTextAlign('justify').run()} active={editor.isActive({ textAlign: 'justify' })} title="Justifier">
              <AlignJustify className="w-3.5 h-3.5" />
            </ToolbarBtn>

            <Separator />

            <ToolbarBtn onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive('bulletList')} title="Liste à puces">
              <List className="w-3.5 h-3.5" />
            </ToolbarBtn>
            <ToolbarBtn onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive('orderedList')} title="Liste numérotée">
              <ListOrdered className="w-3.5 h-3.5" />
            </ToolbarBtn>

            <Separator />

            <ToolbarBtn onClick={setLink} active={editor.isActive('link')} title="Insérer un lien">
              <LinkIcon className="w-3.5 h-3.5" />
            </ToolbarBtn>
            <ToolbarBtn onClick={() => editor.chain().focus().setHorizontalRule().run()} title="Ligne de séparation">
              <Minus className="w-3.5 h-3.5" />
            </ToolbarBtn>

            <Separator />

            {([1, 2, 3] as const).map(level => (
              <ToolbarBtn
                key={level}
                onClick={() => editor.chain().focus().toggleHeading({ level }).run()}
                active={editor.isActive('heading', { level })}
                title={`Titre ${level}`}
              >
                <span className="text-xs font-bold">H{level}</span>
              </ToolbarBtn>
            ))}

            <ToolbarBtn onClick={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive('blockquote')} title="Citation">
              <span className="text-xs font-bold">&ldquo;</span>
            </ToolbarBtn>

            <ToolbarBtn onClick={() => editor.chain().focus().toggleCode().run()} active={editor.isActive('code')} title="Code inline">
              <span className="text-xs font-mono">&lt;/&gt;</span>
            </ToolbarBtn>
          </div>
        )}

        {/* Editor */}
        <div className="flex-1 overflow-y-auto min-h-0">
          <EditorContent editor={editor} />
          {(mode === 'reply' || mode === 'replyAll' || mode === 'forward') && replyTo && (
            <div
              className="px-4 pb-4"
              dangerouslySetInnerHTML={{ __html: quotedHtml() }}
            />
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 px-4 py-3 border-t border-border shrink-0 flex-wrap">
          {error && <p className="text-xs text-destructive mr-2 w-full">{error}</p>}
          <Button size="sm" onClick={handleSend} disabled={sending} className="h-8 px-5">
            {sending ? 'Envoi…' : 'Envoyer'}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => { if (DRAFT_KEY) localStorage.removeItem(DRAFT_KEY); onClose() }} className="h-8">
            Annuler
          </Button>
          <div className="flex-1" />
          {signatures.length > 0 && (
            <select
              value={selectedSigId ?? ''}
              onChange={e => handleSigChange(e.target.value)}
              className="h-7 text-xs rounded border border-border bg-background text-muted-foreground px-2 focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="">Sans signature</option>
              {signatures.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          )}
          <span className="text-xs text-muted-foreground">{accountEmail}</span>
        </div>
      </div>
    </div>
  )
}
