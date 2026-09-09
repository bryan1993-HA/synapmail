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
import type { Signature, EmailAccount } from '@/types/account'
import type { Attachment } from '@/types/email'
import type { ComposeTemplate } from '@/types/template'
import { EmailTokenInput } from './EmailTokenInput'
import { AICompose } from '@/components/ai/AICompose'

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
  initialBody?: string
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
        'w-7 h-7 flex items-center justify-center rounded-md text-sm transition-colors shrink-0',
        active
          ? 'bg-violet-500/20 text-violet-700 dark:text-violet-200'
          : 'text-muted-foreground hover:text-foreground hover:bg-muted',
        disabled && 'opacity-30 cursor-not-allowed'
      )}
    >
      {children}
    </button>
  )
}

function Separator() {
  return <div className="w-px h-5 bg-border mx-1 shrink-0" />
}

/* Aurora — inset field row, violet ring on focus */
const FIELD_ROW =
  'rounded-2xl border px-4 min-h-[46px] transition-colors ' +
  'border-black/10 bg-black/[0.02] dark:border-white/10 dark:bg-white/[0.03] ' +
  'focus-within:border-violet-500 focus-within:bg-violet-500/[0.06] focus-within:ring-2 focus-within:ring-violet-500/40'

export function ComposeModal({ mode, replyTo, accountEmail, accountId, initialBody, onClose, onSent }: ComposeModalProps) {
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
  const [pendingDraftContent, setPendingDraftContent] = useState<string | null>(initialBody ?? null)
  const [showSigDropdown, setShowSigDropdown] = useState(false)
  const sigDropdownRef = useRef<HTMLDivElement>(null)
  const [showFromDropdown, setShowFromDropdown] = useState(false)
  const fromDropdownRef = useRef<HTMLDivElement>(null)
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
  const { data: acctData } = useSWR<{ data: EmailAccount[] }>('/api/accounts', fetcher)
  const accounts = acctData?.data ?? []

  // Compte d'envoi — modifiable par message quand l'utilisateur a plusieurs comptes
  const [fromAccountId, setFromAccountId] = useState(accountId)
  const fromAccount = accounts.find(a => a.id === fromAccountId)
  const fromEmail = fromAccount?.email ?? accountEmail
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
        class: 'outline-none min-h-[220px] text-sm leading-relaxed text-foreground px-6 py-5 prose prose-sm dark:prose-invert max-w-none',
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

  // Close "from account" dropdown on outside click
  useEffect(() => {
    if (!showFromDropdown) return
    const handler = (e: MouseEvent) => {
      if (fromDropdownRef.current && !fromDropdownRef.current.contains(e.target as Node)) {
        setShowFromDropdown(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showFromDropdown])

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
      accountId: fromAccountId,
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
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[9999] bg-card border border-border ring-1 ring-inset ring-white/25 dark:ring-white/[0.06] rounded-[20px] shadow-[0_28px_80px_-16px_rgba(0,0,0,0.55)] px-5 py-4 flex items-center gap-4 min-w-[320px] max-w-sm motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:duration-300">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-white/50 dark:bg-white/10 border border-white/60 dark:border-white/15 text-violet-600 dark:text-violet-200">
          <SendHorizonal className="w-3.5 h-3.5" />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground">Envoi dans <span className="font-mono tabular-nums">{undoCountdown}s</span>…</p>
          <div className="mt-1.5 h-1 bg-black/10 dark:bg-white/10 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-violet-400 to-blue-400 rounded-full transition-all duration-1000 ease-linear"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
        <button
          onClick={handleCancelUndo}
          className="shrink-0 text-sm font-medium text-violet-600 dark:text-violet-300 hover:text-violet-500 transition-colors px-1"
        >
          Annuler
        </button>
      </div>
    )
  }

  return (
    /* ── Backdrop ────────────────────────────────────────────────────── */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-lg motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200"
      onClick={e => { if (e.target === e.currentTarget) { if (DRAFT_KEY) localStorage.removeItem(DRAFT_KEY); onClose() } }}
    >
      {/* ── Aurora — soft colour glow in the margin around the panel ── */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="synap-aurora absolute inset-[-15%]">
          <div
            className="absolute -left-[8%] -top-[8%] h-[42vh] w-[42vh] rounded-full blur-[120px]"
            style={{ background: 'radial-gradient(circle at 50% 50%, rgba(217,70,239,0.14), transparent 70%)' }}
          />
          <div
            className="absolute -right-[8%] -bottom-[8%] h-[40vh] w-[40vh] rounded-full blur-[120px]"
            style={{ background: 'radial-gradient(circle at 50% 50%, rgba(34,211,238,0.10), transparent 70%)' }}
          />
          <div
            className="absolute left-1/2 top-[8%] h-[46vh] w-[46vh] -translate-x-1/2 rounded-full blur-[130px]"
            style={{ background: 'radial-gradient(circle at 50% 50%, rgba(139,92,246,0.12), transparent 72%)' }}
          />
        </div>
      </div>

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="compose-title"
        className="relative w-full max-w-[820px] flex flex-col rounded-[24px] overflow-hidden border border-border bg-card ring-1 ring-inset ring-white/25 dark:ring-white/[0.06] shadow-[0_40px_100px_-20px_rgba(0,0,0,0.6)] motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 motion-safe:slide-in-from-bottom-2 motion-safe:duration-200"
        style={{ maxHeight: '88vh' }}>

        {/* ── Header ──────────────────────────────────────────────────── */}
        <div className="flex items-center gap-3 px-6 py-4 border-b border-border shrink-0">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-violet-500/10 border border-violet-500/20 text-violet-600 dark:text-violet-300">
            <PenSquare className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div id="compose-title" className="text-[15px] font-semibold leading-tight tracking-tight text-foreground">{modeTitle[mode]}</div>
            <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground" title={fromEmail}>{fromEmail}</div>
          </div>

          {draftRestored && (
            <span className="text-[10px] font-medium text-violet-700 dark:text-violet-300 bg-violet-500/10 border border-violet-500/20 px-2 py-0.5 rounded-full flex items-center gap-1">
              Brouillon restauré
              <button
                onClick={() => { setDraftRestored(false); if (DRAFT_KEY) localStorage.removeItem(DRAFT_KEY) }}
                className="hover:text-foreground ml-0.5"
              >×</button>
            </span>
          )}

          <button
            onClick={() => { if (DRAFT_KEY) localStorage.removeItem(DRAFT_KEY); onClose() }}
            aria-label="Fermer"
            className="w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ── Fields ──────────────────────────────────────────────────── */}
        <div className="px-4 pt-3 pb-1 shrink-0 space-y-1.5">
          {/* From — only when several accounts */}
          {accounts.length > 1 && (
            <div className={cn('relative flex items-center gap-3 py-2.5', FIELD_ROW, showFromDropdown && 'border-violet-500 ring-2 ring-violet-500/40')}>
              <span className="text-[11px] font-semibold text-muted-foreground w-12 shrink-0 uppercase tracking-wider">De</span>
              <div className="relative flex-1 min-w-0" ref={fromDropdownRef}>
                <button
                  type="button"
                  onClick={() => setShowFromDropdown(v => !v)}
                  aria-haspopup="listbox"
                  aria-expanded={showFromDropdown}
                  className="w-full flex items-center gap-2 bg-transparent text-sm text-foreground py-1 outline-none"
                >
                  <span className="truncate">
                    {fromAccount ? `${fromAccount.name} · ${fromAccount.email}` : fromEmail}
                  </span>
                  <ChevronDown className={cn('w-3.5 h-3.5 shrink-0 ml-auto text-muted-foreground transition-transform', showFromDropdown && 'rotate-180')} />
                </button>
                {showFromDropdown && (
                  <div role="listbox" className="absolute top-full mt-2 left-0 right-0 z-20 bg-popover border border-border rounded-xl shadow-lg py-1 overflow-hidden">
                    {accounts.map(a => {
                      const active = a.id === fromAccountId
                      return (
                        <button
                          key={a.id}
                          type="button"
                          role="option"
                          aria-selected={active}
                          onClick={() => { setFromAccountId(a.id); setShowFromDropdown(false) }}
                          className={cn(
                            'w-full flex items-center justify-between gap-2 px-3 py-2 text-xs text-left transition-colors',
                            active ? 'bg-violet-500/10' : 'hover:bg-violet-500/10'
                          )}
                        >
                          <span className="min-w-0 flex-1 truncate">
                            <span className="font-medium text-foreground">{a.name}</span>
                            <span className="text-muted-foreground"> · {a.email}</span>
                          </span>
                          {active && <Check className="w-3 h-3 shrink-0 text-violet-500" />}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
          {/* To */}
          <div className={cn('flex items-start gap-3 py-2.5', FIELD_ROW)}>
            <span className="text-[11px] font-semibold text-muted-foreground w-12 shrink-0 uppercase tracking-wider mt-1.5">À</span>
            <EmailTokenInput
              tokens={toTokens}
              onChange={setToTokens}
              placeholder="destinataire@exemple.com"
              accountId={accountId}
            />
            <div className="flex items-center gap-1 shrink-0 mt-1">
              {!showCc && (
                <button onClick={() => setShowCc(true)} className="text-xs text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded hover:bg-muted transition-colors">
                  Cc
                </button>
              )}
              {!showBcc && (
                <button onClick={() => setShowBcc(true)} className="text-xs text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded hover:bg-muted transition-colors">
                  Cci
                </button>
              )}
            </div>
          </div>

          {/* CC */}
          {showCc && (
            <div className={cn('flex items-start gap-3 py-2.5', FIELD_ROW)}>
              <span className="text-[11px] font-semibold text-muted-foreground w-12 shrink-0 uppercase tracking-wider mt-1.5">Cc</span>
              <EmailTokenInput
                tokens={ccTokens}
                onChange={setCcTokens}
                placeholder="cc@exemple.com"
                autoFocus={mode !== 'replyAll'}
                accountId={accountId}
              />
              <button onClick={() => { setShowCc(false); setCcTokens([]) }} className="shrink-0 text-muted-foreground hover:text-foreground hover:bg-muted rounded p-0.5 transition-colors mt-1.5">
                <X className="w-3 h-3" />
              </button>
            </div>
          )}

          {/* BCC */}
          {showBcc && (
            <div className={cn('flex items-start gap-3 py-2.5', FIELD_ROW)}>
              <span className="text-[11px] font-semibold text-muted-foreground w-12 shrink-0 uppercase tracking-wider mt-1.5">Cci</span>
              <EmailTokenInput
                tokens={bccTokens}
                onChange={setBccTokens}
                placeholder="bcc@exemple.com"
                autoFocus
                accountId={accountId}
              />
              <button onClick={() => { setShowBcc(false); setBccTokens([]) }} className="shrink-0 text-muted-foreground hover:text-foreground hover:bg-muted rounded p-0.5 transition-colors mt-1.5">
                <X className="w-3 h-3" />
              </button>
            </div>
          )}

          {/* Subject */}
          <div className={cn('flex items-center gap-3 py-2.5', FIELD_ROW)}>
            <span className="text-[11px] font-semibold text-muted-foreground w-12 shrink-0 uppercase tracking-wider">Objet</span>
            <Input
              value={subject}
              onChange={e => setSubject(e.target.value)}
              placeholder="Objet de votre message"
              className="h-7 text-sm border-0 rounded-none px-0 bg-transparent focus-visible:ring-0 shadow-none flex-1 font-semibold"
            />
          </div>

          {/* Forwarded attachments */}
          {mode === 'forward' && forwardedAtts.length > 0 && (
            <div className={cn('flex flex-wrap gap-1.5 py-2.5', FIELD_ROW)}>
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
          <div className="flex items-center gap-0.5 px-4 py-2 shrink-0 flex-wrap border-y border-border bg-muted/40">
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
        <div className="flex-1 overflow-y-auto min-h-0 bg-transparent">
          <EditorContent editor={editor} />
          {(mode === 'reply' || mode === 'replyAll' || mode === 'forward') && replyTo && (
            <div className="px-6 pb-6" dangerouslySetInnerHTML={{ __html: quotedHtml() }} />
          )}
        </div>

        {/* ── Save as Template modal ──────────────────────────────────── */}
        {showSaveAsTemplate && (
          <div className="absolute inset-0 z-50 bg-background/80 flex items-center justify-center">
            <div className="bg-popover border border-border rounded-2xl p-5 w-72 shadow-2xl">
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
          <div className="absolute inset-0 z-50 bg-background/80 flex items-center justify-center">
            <div className="bg-popover border border-border rounded-2xl p-5 w-80 shadow-2xl">
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
        <div className="flex items-center gap-2 px-5 py-3.5 border-t border-border bg-muted/40 shrink-0 flex-wrap">
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
                      'px-2.5 py-1 text-xs rounded-full border transition-colors',
                      scheduledAt === preset.value
                        ? 'bg-gradient-to-br from-violet-500 to-blue-500 text-white border-transparent'
                        : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted'
                    )}
                  >
                    {preset.label}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setShowCustomDate(v => !v)}
                  className={cn(
                    'px-2.5 py-1 text-xs rounded-full border transition-colors',
                    showCustomDate || isCustomDate
                      ? 'bg-gradient-to-br from-violet-500 to-blue-500 text-white border-transparent'
                      : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted'
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
                  className="h-7 w-auto text-xs rounded-md border border-border bg-background text-foreground px-2 focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
              )}
            </div>
          )}

          <Button
            size="sm"
            onClick={handleSend}
            disabled={sending}
            className="h-9 gap-2 px-6 rounded-full border-0 bg-gradient-to-br from-violet-400 to-blue-400 text-[13px] font-semibold text-white ring-1 ring-inset ring-white/40 shadow-[0_10px_30px_-6px_rgba(139,92,246,0.65)] transition hover:brightness-105 disabled:opacity-60"
          >
            {scheduledAt ? <Clock className="w-4 h-4" /> : <SendHorizonal className="w-4 h-4" />}
            {sending
              ? (scheduledAt ? 'Programmation…' : 'Envoi…')
              : (scheduledAt ? 'Programmer' : 'Envoyer')}
          </Button>

          <Button size="sm" variant="ghost" onClick={() => { if (DRAFT_KEY) localStorage.removeItem(DRAFT_KEY); onClose() }} className="h-9 hover:bg-muted">
            Annuler
          </Button>

          <div className="w-px h-5 bg-white/40 dark:bg-white/15 mx-0.5 shrink-0" />

          <button
            type="button"
            title={scheduledAt ? `Programmé : ${new Date(scheduledAt).toLocaleString('fr-FR')}` : 'Envoyer plus tard'}
            onClick={() => setShowSchedulePicker(v => !v)}
            className={cn(
              'w-7 h-7 flex items-center justify-center rounded-md transition-colors shrink-0',
              scheduledAt
                ? 'text-violet-700 dark:text-violet-200 bg-violet-500/20'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted'
            )}
          >
            <Clock className="w-4 h-4" />
          </button>

          <button
            type="button"
            title={requestReadReceipt ? 'Accusé de lecture activé — cliquer pour désactiver' : 'Demander un accusé de lecture'}
            onClick={() => setRequestReadReceipt(v => !v)}
            className={cn(
              'flex items-center gap-1.5 h-7 px-2 rounded-md transition-colors text-xs shrink-0',
              requestReadReceipt
                ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/15 hover:bg-emerald-500/25'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted'
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
                'w-7 h-7 flex items-center justify-center rounded-md transition-colors shrink-0',
                showTplDropdown
                  ? 'text-violet-700 dark:text-violet-200 bg-violet-500/20'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              )}
            >
              <LayoutTemplate className="w-4 h-4" />
            </button>
            {showTplDropdown && (
              <div className="absolute bottom-full mb-1 left-0 z-50 bg-popover border border-border rounded-xl shadow-lg min-w-[190px] py-1 overflow-hidden">
                {templates.length === 0 ? (
                  <p className="text-xs text-muted-foreground px-3 py-2">Aucun template</p>
                ) : (
                  templates.map(tpl => (
                    <button
                      key={tpl.id}
                      type="button"
                      onClick={() => applyTemplate(tpl)}
                      className="w-full text-left px-3 py-1.5 text-xs hover:bg-violet-500/10 transition-colors"
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
            className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
          >
            <BookmarkPlus className="w-4 h-4" />
          </button>

          {editor && (
            <AICompose
              getContent={() => editor.getHTML()}
              onResult={(text) => {
                const sig = selectedSigId ? signatures.find(s => s.id === selectedSigId) : null
                const newContent = sig ? `<p>${text}</p><p>-- </p>${sig.contentHtml}` : `<p>${text}</p>`
                editor.commands.setContent(newContent)
              }}
              onError={(msg) => setError(msg)}
            />
          )}

          <div className="flex-1" />

          {signatures.length > 0 && (
            <div className="relative" ref={sigDropdownRef}>
              <button
                type="button"
                onClick={() => setShowSigDropdown(v => !v)}
                className={cn(
                  'flex items-center gap-1.5 h-8 px-3 rounded-lg border text-xs transition-colors',
                  showSigDropdown
                    ? 'border-violet-400/60 bg-violet-500/10 text-foreground'
                    : 'border-border bg-transparent text-muted-foreground hover:text-foreground hover:border-violet-500/50'
                )}
              >
                <span className="max-w-[100px] truncate">
                  {selectedSigId ? (signatures.find(s => s.id === selectedSigId)?.name ?? 'Signature') : 'Sans signature'}
                </span>
                <ChevronDown className={cn('w-3 h-3 shrink-0 transition-transform', showSigDropdown && 'rotate-180')} />
              </button>

              {showSigDropdown && (
                <div className="absolute bottom-full mb-1 right-0 min-w-[160px] bg-popover border border-border rounded-xl shadow-lg py-1 z-10 overflow-hidden">
                  {/* Sans signature */}
                  <button
                    type="button"
                    onClick={() => { handleSigChange(''); setShowSigDropdown(false) }}
                    className={cn(
                      'w-full flex items-center justify-between gap-2 px-3 py-1.5 text-xs text-left transition-colors',
                      !selectedSigId
                        ? 'text-foreground bg-violet-500/10'
                        : 'text-muted-foreground hover:text-foreground hover:bg-violet-500/10'
                    )}
                  >
                    <span>Sans signature</span>
                    {!selectedSigId && <Check className="w-3 h-3 shrink-0 text-violet-500" />}
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
                          ? 'text-foreground bg-violet-500/10'
                          : 'text-muted-foreground hover:text-foreground hover:bg-violet-500/10'
                      )}
                    >
                      <span className="truncate">{s.name}</span>
                      {selectedSigId === s.id && <Check className="w-3 h-3 shrink-0 text-violet-500" />}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
