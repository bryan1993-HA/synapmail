'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
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
  Minus, Paperclip, Clock, PenSquare, ChevronDown, Check, SendHorizonal, Eye,
  LayoutTemplate, BookmarkPlus,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import useSWR from 'swr'
import type { Signature } from '@/types/account'
import type { Attachment } from '@/types/email'
import type { ComposeTemplate } from '@/types/template'
import { EmailTokenInput } from './EmailTokenInput'

const fetcher = (url: string) => fetch(url).then(r => r.json())

interface AppSettings {
  undo_send_delay: number
}

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
  return <div className="w-px h-4 bg-border mx-0.5 shrink-0" />
}

export function ComposeModal({ mode, replyTo, accountEmail, accountId, onClose, onSent }: ComposeModalProps) {
  const [toTokens, setToTokens] = useState<string[]>(() => {
    if ((mode === 'reply' || mode === 'replyAll') && replyTo) return [replyTo.from.address]
    return []
  })
  const [ccTokens, setCcTokens] = useState<string[]>(() => {
    if (mode === 'replyAll' && replyTo) {
      return [
        ...(replyTo.to ?? []),
        ...(replyTo.cc ?? []),
      ].map(a => a.address).filter(addr => addr.toLowerCase() !== accountEmail.toLowerCase())
    }
    return []
  })
  const [bccTokens, setBccTokens] = useState<string[]>([])
  const [showCc, setShowCc] = useState(mode === 'replyAll')
  const [showBcc, setShowBcc] = useState(false)
  const [subject, setSubject] = useState(() => {
    if ((mode === 'reply' || mode === 'replyAll') && replyTo) return `Re: ${replyTo.subject.replace(/^(Re|Fwd):\s*/i, '')}`
    if (mode === 'forward' && replyTo) return `Fwd: ${replyTo.subject.replace(/^(Re|Fwd):\s*/i, '')}`
    return ''
  })
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [undoCountdown, setUndoCountdown] = useState(0)
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const undoIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const undoDelayRef = useRef(0)
  const [scheduledAt, setScheduledAt] = useState('')
  const [showSchedulePicker, setShowSchedulePicker] = useState(false)
  const [showCustomDate, setShowCustomDate] = useState(false)
  const [selectedSigId, setSelectedSigId] = useState<string | null>(null)
  const [sigApplied, setSigApplied] = useState(false)
  const [draftRestored, setDraftRestored] = useState(false)
  const [pendingDraftContent, setPendingDraftContent] = useState<string | null>(null)
  const [showSigDropdown, setShowSigDropdown] = useState(false)
  const sigDropdownRef = useRef<HTMLDivElement>(null)
  const [requestReadReceipt, setRequestReadReceipt] = useState(false)
  const [showTplDropdown, setShowTplDropdown] = useState(false)
  const [showSaveAsTemplate, setShowSaveAsTemplate] = useState(false)
  const [templateVars, setTemplateVars] = useState<Record<string, string>>({})
  const [pendingTemplate, setPendingTemplate] = useState<ComposeTemplate | null>(null)
  const [newTplName, setNewTplName] = useState('')
  const [savingTpl, setSavingTpl] = useState(false)
  const tplDropdownRef = useRef<HTMLDivElement>(null)

  const DRAFT_KEY = mode === 'compose' ? `synapmail:draft:${accountId}` : null

  const [forwardedAtts, setForwardedAtts] = useState<ForwardedAtt[]>(() => {
    if (mode === 'forward' && replyTo?.attachments?.length) {
      return replyTo.attachments
    }
    return []
  })

  const { data: sigData } = useSWR<{ data: Signature[] }>('/api/signatures', fetcher)
  const { data: settingsData } = useSWR<{ data: AppSettings }>('/api/settings', fetcher)
  const { data: tplData } = useSWR<{ data: ComposeTemplate[] }>('/api/templates', fetcher)
  const undoSendDelay = settingsData?.data?.undo_send_delay ?? 0

  useEffect(() => {
    if (!DRAFT_KEY) return
    const saved = localStorage.getItem(DRAFT_KEY)
    if (!saved) return
    try {
      const draft = JSON.parse(saved) as {
        to: string | string[]; cc: string | string[]
        bcc: string | string[]; subject: string; content: string
      }
      const parseField = (v: string | string[]): string[] =>
        Array.isArray(v) ? v : (v ? v.split(',').map(s => s.trim()).filter(Boolean) : [])
      const toArr = parseField(draft.to)
      const ccArr = parseField(draft.cc)
      const bccArr = parseField(draft.bcc)
      if (toArr.length || draft.subject || draft.content) {
        setToTokens(toArr)
        setCcTokens(ccArr)
        setBccTokens(bccArr)
        setSubject(draft.subject ?? '')
        if (ccArr.length) setShowCc(true)
        if (bccArr.length) setShowBcc(true)
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
        class: 'outline-none min-h-[200px] text-sm text-foreground px-5 py-4 prose prose-sm dark:prose-invert max-w-none',
      },
    },
  })

  useEffect(() => {
    if (!editor || sigApplied || !signatures.length) return
    const defaultSig = signatures.find(s => s.isDefault) ?? signatures[0]
    if (defaultSig) {
      setSelectedSigId(defaultSig.id)
      const bodyPart = pendingDraftContent ?? '<p></p>'
      editor.commands.setContent(`${bodyPart}<p>-- </p>${defaultSig.contentHtml}`)
      setPendingDraftContent(null)
      setSigApplied(true)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, sigApplied, signatures.length])

  useEffect(() => {
    if (!editor || !pendingDraftContent || sigApplied) return
    if (signatures.length > 0) return
    editor.commands.setContent(pendingDraftContent)
    setPendingDraftContent(null)
  }, [editor, pendingDraftContent, sigApplied, signatures.length])

  useEffect(() => {
    if (!DRAFT_KEY || !editor) return
    const timer = setTimeout(() => {
      const content = editor.getHTML()
      const isEmpty = !toTokens.length && !subject && (content === '<p></p>' || content === '')
      if (isEmpty) return
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ to: toTokens, cc: ccTokens, bcc: bccTokens, subject, content }))
    }, 3000)
    return () => clearTimeout(timer)
  }, [toTokens, ccTokens, bccTokens, subject, editor]) // eslint-disable-line react-hooks/exhaustive-deps

  // Close signature dropdown on outside click
  useEffect(() => {
    if (!showSigDropdown) return
    const handler = (e: MouseEvent) => {
      if (sigDropdownRef.current && !sigDropdownRef.current.contains(e.target as Node)) {
        setShowSigDropdown(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showSigDropdown])

  // Close template dropdown on outside click
  useEffect(() => {
    if (!showTplDropdown) return
    const handler = (e: MouseEvent) => {
      if (tplDropdownRef.current && !tplDropdownRef.current.contains(e.target as Node)) {
        setShowTplDropdown(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showTplDropdown])

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

  const templates = tplData?.data ?? []

  function extractVars(html: string): string[] {
    return Array.from(new Set(Array.from(html.matchAll(/\{\{(\w+)\}\}/g)).map(m => m[1])))
  }

  function resolveVars(html: string, vars: Record<string, string>): string {
    return html.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? `{{${k}}}`)
  }

  const applyTemplate = (tpl: ComposeTemplate) => {
    const vars = extractVars(tpl.contentHtml + ' ' + tpl.subject)
    if (vars.length > 0) {
      setPendingTemplate(tpl)
      setTemplateVars(Object.fromEntries(vars.map(v => [v, ''])))
    } else {
      editor?.commands.setContent(tpl.contentHtml)
      if (tpl.subject && !subject) setSubject(tpl.subject)
    }
    setShowTplDropdown(false)
  }

  const confirmInsertTemplate = () => {
    if (!pendingTemplate) return
    const resolved = resolveVars(pendingTemplate.contentHtml, templateVars)
    editor?.commands.setContent(resolved)
    if (pendingTemplate.subject && !subject) {
      setSubject(resolveVars(pendingTemplate.subject, templateVars))
    }
    setPendingTemplate(null)
  }

  const saveAsTemplate = async () => {
    if (!newTplName.trim() || !editor) return
    setSavingTpl(true)
    await fetch('/api/templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newTplName.trim(), subject, contentHtml: editor.getHTML() }),
    })
    setSavingTpl(false)
    setShowSaveAsTemplate(false)
    setNewTplName('')
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

  const doActualSend = async (payload: Record<string, unknown>, isScheduled: boolean) => {
    setSending(true)
    setError(null)
    try {
      if (isScheduled) {
        const res = await fetch('/api/scheduled', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!res.ok) {
          const data = await res.json()
          throw new Error(data.error ?? 'Erreur lors de la programmation')
        }
      } else {
        const res = await fetch('/api/messages/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!res.ok) {
          const data = await res.json()
          throw new Error(data.error ?? "Erreur lors de l'envoi")
        }
      }
      if (DRAFT_KEY) localStorage.removeItem(DRAFT_KEY)
      onSent()
      onClose()
    } catch (err) {
      setUndoCountdown(0)
      setError(String(err))
    } finally {
      setSending(false)
    }
  }

  const handleCancelUndo = () => {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current)
    if (undoIntervalRef.current) clearInterval(undoIntervalRef.current)
    undoTimerRef.current = null
    undoIntervalRef.current = null
    setUndoCountdown(0)
  }

  const handleSend = async () => {
    if (!toTokens.length || !subject.trim()) {
      setError('Destinataire et sujet requis')
      return
    }
    setError(null)

    const bodyHtml = (editor?.getHTML() ?? '') + quotedHtml()
    const payload: Record<string, unknown> = {
      accountId,
      to: toTokens,
      cc: ccTokens.length ? ccTokens : undefined,
      bcc: bccTokens.length ? bccTokens : undefined,
      subject,
      html: bodyHtml,
      inReplyTo: (mode === 'reply' || mode === 'replyAll') && replyTo ? replyTo.uid : undefined,
      requestReadReceipt,
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

    if (scheduledAt) {
      payload.sendAt = new Date(scheduledAt).toISOString()
      await doActualSend(payload, true)
      return
    }

    // Undo Send — envoi immédiat seulement
    if (undoSendDelay > 0) {
      undoDelayRef.current = undoSendDelay
      setUndoCountdown(undoSendDelay)

      undoIntervalRef.current = setInterval(() => {
        setUndoCountdown(prev => {
          if (prev <= 1) {
            if (undoIntervalRef.current) clearInterval(undoIntervalRef.current)
            return 0
          }
          return prev - 1
        })
      }, 1000)

      undoTimerRef.current = setTimeout(() => {
        if (undoIntervalRef.current) clearInterval(undoIntervalRef.current)
        doActualSend(payload, false)
      }, undoSendDelay * 1000)

      return
    }

    await doActualSend(payload, false)
  }

  const getPresets = () => {
    const now = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
    const in1h = new Date(now.getTime() + 3_600_000)
    const thisEvening = new Date(now)
    thisEvening.setHours(20, 0, 0, 0)
    const tomorrowMorning = new Date(now)
    tomorrowMorning.setDate(tomorrowMorning.getDate() + 1)
    tomorrowMorning.setHours(8, 0, 0, 0)
    const tomorrowNoon = new Date(now)
    tomorrowNoon.setDate(tomorrowNoon.getDate() + 1)
    tomorrowNoon.setHours(12, 0, 0, 0)
    const presets: { label: string; value: string }[] = [
      { label: 'Dans 1h', value: fmt(in1h) },
    ]
    if (thisEvening > new Date(now.getTime() + 3_600_000)) {
      presets.push({ label: 'Ce soir 20h', value: fmt(thisEvening) })
    }
    presets.push({ label: 'Demain 8h', value: fmt(tomorrowMorning) })
    presets.push({ label: 'Demain midi', value: fmt(tomorrowNoon) })
    return presets
  }

  const isCustomDate = scheduledAt !== '' && !getPresets().find(p => p.value === scheduledAt)

  const modeTitle: Record<typeof mode, string> = {
    compose: 'Nouveau message',
    reply: 'Répondre',
    replyAll: 'Répondre à tous',
    forward: 'Transférer',
  }

  // ── Undo Send toast (modal invisible, app utilisable) ────────────────
  if (undoCountdown > 0) {
    const progress = (undoCountdown / undoDelayRef.current) * 100
    return (
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[9999] bg-background border border-border rounded-2xl shadow-2xl px-5 py-4 flex items-center gap-4 min-w-[320px] max-w-sm">
        <SendHorizonal className="w-4 h-4 text-muted-foreground shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground">Envoi dans {undoCountdown}s…</p>
          <div className="mt-1.5 h-1 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 rounded-full transition-all duration-1000 ease-linear"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
        <button
          onClick={handleCancelUndo}
          className="shrink-0 text-sm font-medium text-primary hover:text-primary/80 transition-colors px-1"
        >
          Annuler
        </button>
      </div>
    )
  }

  return (
    /* ── Backdrop ────────────────────────────────────────────────────── */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) { if (DRAFT_KEY) localStorage.removeItem(DRAFT_KEY); onClose() } }}
    >
      <div className="w-full max-w-2xl flex flex-col rounded-2xl shadow-2xl overflow-hidden border border-white/8"
        style={{ maxHeight: '88vh' }}>

        {/* ── Header ──────────────────────────────────────────────────── */}
        <div className="flex items-center gap-3 px-5 py-4 bg-blue-600 shrink-0">
          <PenSquare className="w-4 h-4 text-white/70 shrink-0" />
          <span className="text-sm font-semibold text-white flex-1">{modeTitle[mode]}</span>

          {draftRestored && (
            <span className="text-[10px] text-white/60 bg-white/10 px-2 py-0.5 rounded-full flex items-center gap-1">
              Brouillon restauré
              <button
                onClick={() => { setDraftRestored(false); if (DRAFT_KEY) localStorage.removeItem(DRAFT_KEY) }}
                className="hover:text-white ml-0.5"
              >×</button>
            </span>
          )}

          <button
            onClick={() => { if (DRAFT_KEY) localStorage.removeItem(DRAFT_KEY); onClose() }}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-white/60 hover:text-white hover:bg-white/15 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ── Fields ──────────────────────────────────────────────────── */}
        <div className="bg-background px-5 pt-4 pb-0 shrink-0 space-y-0">
          {/* To */}
          <div className="flex items-start gap-3 py-2 border-b border-border min-h-[40px]">
            <span className="text-xs font-medium text-muted-foreground w-10 shrink-0 uppercase tracking-wide mt-1.5">À</span>
            <EmailTokenInput
              tokens={toTokens}
              onChange={setToTokens}
              placeholder="destinataire@exemple.com"
              accountId={accountId}
            />
            <div className="flex items-center gap-1 shrink-0 mt-1">
              {!showCc && (
                <button onClick={() => setShowCc(true)} className="text-xs text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded hover:bg-accent transition-colors">
                  Cc
                </button>
              )}
              {!showBcc && (
                <button onClick={() => setShowBcc(true)} className="text-xs text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded hover:bg-accent transition-colors">
                  Cci
                </button>
              )}
            </div>
          </div>

          {/* CC */}
          {showCc && (
            <div className="flex items-start gap-3 py-2 border-b border-border min-h-[40px]">
              <span className="text-xs font-medium text-muted-foreground w-10 shrink-0 uppercase tracking-wide mt-1.5">Cc</span>
              <EmailTokenInput
                tokens={ccTokens}
                onChange={setCcTokens}
                placeholder="cc@exemple.com"
                autoFocus={mode !== 'replyAll'}
                accountId={accountId}
              />
              <button onClick={() => { setShowCc(false); setCcTokens([]) }} className="shrink-0 text-muted-foreground hover:text-foreground hover:bg-accent rounded p-0.5 transition-colors mt-1.5">
                <X className="w-3 h-3" />
              </button>
            </div>
          )}

          {/* BCC */}
          {showBcc && (
            <div className="flex items-start gap-3 py-2 border-b border-border min-h-[40px]">
              <span className="text-xs font-medium text-muted-foreground w-10 shrink-0 uppercase tracking-wide mt-1.5">Cci</span>
              <EmailTokenInput
                tokens={bccTokens}
                onChange={setBccTokens}
                placeholder="bcc@exemple.com"
                autoFocus
                accountId={accountId}
              />
              <button onClick={() => { setShowBcc(false); setBccTokens([]) }} className="shrink-0 text-muted-foreground hover:text-foreground hover:bg-accent rounded p-0.5 transition-colors mt-1.5">
                <X className="w-3 h-3" />
              </button>
            </div>
          )}

          {/* Subject */}
          <div className="flex items-center gap-3 py-2.5 border-b border-border">
            <span className="text-xs font-medium text-muted-foreground w-10 shrink-0 uppercase tracking-wide">Objet</span>
            <Input
              value={subject}
              onChange={e => setSubject(e.target.value)}
              placeholder="Objet de votre message"
              className="h-7 text-sm border-0 rounded-none px-0 focus-visible:ring-0 shadow-none flex-1 font-medium"
            />
          </div>

          {/* Forwarded attachments */}
          {mode === 'forward' && forwardedAtts.length > 0 && (
            <div className="flex flex-wrap gap-1.5 py-2.5 border-b border-border">
              {forwardedAtts.map(att => (
                <div key={att.id} className="flex items-center gap-1.5 bg-muted/50 rounded-md px-2 py-1 text-xs text-muted-foreground">
                  <Paperclip className="w-3 h-3 shrink-0" />
                  <span className="max-w-[140px] truncate text-foreground">{att.filename}</span>
                  <button onClick={() => removeForwardedAtt(att.id)} className="hover:text-destructive transition-colors" title="Retirer">
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Toolbar ─────────────────────────────────────────────────── */}
        {editor && (
          <div className="flex items-center gap-0.5 px-3 py-2 bg-muted shrink-0 flex-wrap border-y border-border">
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
            <ToolbarBtn onClick={() => editor.chain().focus().setTextAlign('left').run()} active={editor.isActive({ textAlign: 'left' })} title="Gauche">
              <AlignLeft className="w-3.5 h-3.5" />
            </ToolbarBtn>
            <ToolbarBtn onClick={() => editor.chain().focus().setTextAlign('center').run()} active={editor.isActive({ textAlign: 'center' })} title="Centré">
              <AlignCenter className="w-3.5 h-3.5" />
            </ToolbarBtn>
            <ToolbarBtn onClick={() => editor.chain().focus().setTextAlign('right').run()} active={editor.isActive({ textAlign: 'right' })} title="Droite">
              <AlignRight className="w-3.5 h-3.5" />
            </ToolbarBtn>
            <ToolbarBtn onClick={() => editor.chain().focus().setTextAlign('justify').run()} active={editor.isActive({ textAlign: 'justify' })} title="Justifié">
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
            <ToolbarBtn onClick={setLink} active={editor.isActive('link')} title="Lien">
              <LinkIcon className="w-3.5 h-3.5" />
            </ToolbarBtn>
            <ToolbarBtn onClick={() => editor.chain().focus().setHorizontalRule().run()} title="Séparateur">
              <Minus className="w-3.5 h-3.5" />
            </ToolbarBtn>
            <Separator />
            {([1, 2, 3] as const).map(level => (
              <ToolbarBtn key={level} onClick={() => editor.chain().focus().toggleHeading({ level }).run()} active={editor.isActive('heading', { level })} title={`Titre ${level}`}>
                <span className="text-xs font-bold">H{level}</span>
              </ToolbarBtn>
            ))}
            <ToolbarBtn onClick={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive('blockquote')} title="Citation">
              <span className="text-xs font-bold">&ldquo;</span>
            </ToolbarBtn>
            <ToolbarBtn onClick={() => editor.chain().focus().toggleCode().run()} active={editor.isActive('code')} title="Code">
              <span className="text-xs font-mono">&lt;/&gt;</span>
            </ToolbarBtn>
          </div>
        )}

        {/* ── Editor ──────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto min-h-0 bg-background">
          <EditorContent editor={editor} />
          {(mode === 'reply' || mode === 'replyAll' || mode === 'forward') && replyTo && (
            <div className="px-5 pb-5" dangerouslySetInnerHTML={{ __html: quotedHtml() }} />
          )}
        </div>

        {/* ── Save as Template modal ──────────────────────────────────── */}
        {showSaveAsTemplate && (
          <div className="absolute inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center">
            <div className="bg-card border border-border rounded-xl p-5 w-72 shadow-xl">
              <h3 className="font-semibold text-sm mb-3">Enregistrer comme template</h3>
              <Input
                value={newTplName}
                onChange={e => setNewTplName(e.target.value)}
                placeholder="Nom du template"
                className="mb-3 h-8 text-sm"
                autoFocus
                onKeyDown={e => { if (e.key === 'Enter') saveAsTemplate() }}
              />
              <div className="flex gap-2 justify-end">
                <Button variant="ghost" size="sm" onClick={() => { setShowSaveAsTemplate(false); setNewTplName('') }}>
                  Annuler
                </Button>
                <Button size="sm" onClick={saveAsTemplate} disabled={savingTpl || !newTplName.trim()}>
                  {savingTpl ? 'Enregistrement…' : 'Enregistrer'}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* ── Fill variables modal ─────────────────────────────────────── */}
        {pendingTemplate && (
          <div className="absolute inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center">
            <div className="bg-card border border-border rounded-xl p-5 w-80 shadow-xl">
              <h3 className="font-semibold text-sm mb-1">Remplir les variables</h3>
              <p className="text-xs text-muted-foreground mb-3">{pendingTemplate.name}</p>
              <div className="space-y-2 mb-4">
                {Object.keys(templateVars).map(key => (
                  <div key={key}>
                    <label className="text-xs text-muted-foreground mb-1 block font-mono">{`{{${key}}}`}</label>
                    <Input
                      value={templateVars[key]}
                      onChange={e => setTemplateVars(v => ({ ...v, [key]: e.target.value }))}
                      placeholder={key}
                      className="h-8 text-sm"
                    />
                  </div>
                ))}
              </div>
              <div className="flex gap-2 justify-end">
                <Button variant="ghost" size="sm" onClick={() => setPendingTemplate(null)}>
                  Annuler
                </Button>
                <Button size="sm" onClick={confirmInsertTemplate}>
                  Insérer
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* ── Footer ──────────────────────────────────────────────────── */}
        <div className="flex items-center gap-2 px-4 py-3 border-t border-border bg-muted shrink-0 flex-wrap">
          {error && <p className="text-xs text-destructive w-full mb-1">{error}</p>}

          {/* Schedule presets */}
          {showSchedulePicker && (
            <div className="w-full mb-2 space-y-1.5">
              <div className="flex flex-wrap gap-1.5">
                {getPresets().map(preset => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => setScheduledAt(prev => prev === preset.value ? '' : preset.value)}
                    className={cn(
                      'px-2.5 py-1 text-xs rounded-md border transition-colors',
                      scheduledAt === preset.value
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'border-border text-muted-foreground hover:text-foreground hover:bg-accent'
                    )}
                  >
                    {preset.label}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setShowCustomDate(v => !v)}
                  className={cn(
                    'px-2.5 py-1 text-xs rounded-md border transition-colors',
                    showCustomDate || isCustomDate
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'border-border text-muted-foreground hover:text-foreground hover:bg-accent'
                  )}
                >
                  Personnalisé…
                </button>
                {scheduledAt && (
                  <button type="button" onClick={() => { setScheduledAt(''); setShowCustomDate(false) }}
                    className="px-2 py-1 text-xs text-muted-foreground hover:text-destructive flex items-center gap-1 transition-colors">
                    <X className="w-3 h-3" /> Effacer
                  </button>
                )}
              </div>
              {(showCustomDate || isCustomDate) && (
                <input
                  type="datetime-local"
                  value={scheduledAt}
                  min={new Date(Date.now() + 60_000).toISOString().slice(0, 16)}
                  onChange={e => setScheduledAt(e.target.value)}
                  className="h-7 w-auto text-xs rounded border border-border bg-background text-foreground px-2 focus:outline-none focus:ring-1 focus:ring-ring"
                />
              )}
            </div>
          )}

          <Button size="sm" onClick={handleSend} disabled={sending} className="h-8 px-5 bg-blue-600 hover:bg-blue-500 text-white border-0">
            {sending
              ? (scheduledAt ? 'Programmation…' : 'Envoi…')
              : (scheduledAt ? 'Programmer' : 'Envoyer')}
          </Button>

          <Button size="sm" variant="ghost" onClick={() => { if (DRAFT_KEY) localStorage.removeItem(DRAFT_KEY); onClose() }} className="h-8">
            Annuler
          </Button>

          <button
            type="button"
            title={scheduledAt ? `Programmé : ${new Date(scheduledAt).toLocaleString('fr-FR')}` : 'Envoyer plus tard'}
            onClick={() => setShowSchedulePicker(v => !v)}
            className={cn(
              'w-7 h-7 flex items-center justify-center rounded transition-colors',
              scheduledAt
                ? 'text-primary bg-primary/15'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent'
            )}
          >
            <Clock className="w-4 h-4" />
          </button>

          <button
            type="button"
            title={requestReadReceipt ? 'Accusé de lecture activé — cliquer pour désactiver' : 'Demander un accusé de lecture'}
            onClick={() => setRequestReadReceipt(v => !v)}
            className={cn(
              'flex items-center gap-1.5 h-7 px-2 rounded transition-colors text-xs',
              requestReadReceipt
                ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/15 hover:bg-emerald-500/25'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent'
            )}
          >
            <Eye className="w-3.5 h-3.5 shrink-0" />
            {requestReadReceipt && <span className="font-medium">Accusé</span>}
          </button>

          {/* Template buttons */}
          <div className="relative" ref={tplDropdownRef}>
            <button
              type="button"
              onClick={() => setShowTplDropdown(v => !v)}
              title="Insérer un template"
              className={cn(
                'w-7 h-7 flex items-center justify-center rounded transition-colors',
                showTplDropdown
                  ? 'text-primary bg-primary/15'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent'
              )}
            >
              <LayoutTemplate className="w-4 h-4" />
            </button>
            {showTplDropdown && (
              <div className="absolute bottom-full mb-1 left-0 z-50 bg-popover border border-border rounded-lg shadow-lg min-w-[190px] py-1 overflow-hidden">
                {templates.length === 0 ? (
                  <p className="text-xs text-muted-foreground px-3 py-2">Aucun template</p>
                ) : (
                  templates.map(tpl => (
                    <button
                      key={tpl.id}
                      type="button"
                      onClick={() => applyTemplate(tpl)}
                      className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent transition-colors"
                    >
                      <span className="font-medium">{tpl.name}</span>
                      {tpl.subject && <span className="block text-muted-foreground truncate">{tpl.subject}</span>}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          <button
            type="button"
            title="Enregistrer comme template"
            onClick={() => setShowSaveAsTemplate(true)}
            className="w-7 h-7 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <BookmarkPlus className="w-4 h-4" />
          </button>

          <div className="flex-1" />

          {signatures.length > 0 && (
            <div className="relative" ref={sigDropdownRef}>
              <button
                type="button"
                onClick={() => setShowSigDropdown(v => !v)}
                className={cn(
                  'flex items-center gap-1.5 h-7 px-2.5 rounded-md border text-xs transition-colors',
                  showSigDropdown
                    ? 'border-ring bg-accent text-foreground'
                    : 'border-input bg-background text-muted-foreground hover:text-foreground hover:border-ring/50'
                )}
              >
                <span className="max-w-[100px] truncate">
                  {selectedSigId ? (signatures.find(s => s.id === selectedSigId)?.name ?? 'Signature') : 'Sans signature'}
                </span>
                <ChevronDown className={cn('w-3 h-3 shrink-0 transition-transform', showSigDropdown && 'rotate-180')} />
              </button>

              {showSigDropdown && (
                <div className="absolute bottom-full mb-1 right-0 min-w-[160px] bg-popover border border-border rounded-lg shadow-lg py-1 z-10 overflow-hidden">
                  {/* Sans signature */}
                  <button
                    type="button"
                    onClick={() => { handleSigChange(''); setShowSigDropdown(false) }}
                    className={cn(
                      'w-full flex items-center justify-between gap-2 px-3 py-1.5 text-xs text-left transition-colors',
                      !selectedSigId
                        ? 'text-foreground bg-accent'
                        : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                    )}
                  >
                    <span>Sans signature</span>
                    {!selectedSigId && <Check className="w-3 h-3 shrink-0 text-primary" />}
                  </button>

                  {signatures.length > 0 && <div className="my-1 border-t border-border" />}

                  {signatures.map(s => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => { handleSigChange(s.id); setShowSigDropdown(false) }}
                      className={cn(
                        'w-full flex items-center justify-between gap-2 px-3 py-1.5 text-xs text-left transition-colors',
                        selectedSigId === s.id
                          ? 'text-foreground bg-accent'
                          : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                      )}
                    >
                      <span className="truncate">{s.name}</span>
                      {selectedSigId === s.id && <Check className="w-3 h-3 shrink-0 text-primary" />}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <span className="text-xs text-muted-foreground">{accountEmail}</span>
        </div>
      </div>
    </div>
  )
}
