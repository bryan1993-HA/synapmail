'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import useSWR from 'swr'
import { MessageList } from '@/components/layout/MessageList'
import { ReadingPane } from '@/components/layout/ReadingPane'
import { ThreadPane } from '@/components/layout/ThreadPane'
import { ComposeModal } from '@/components/mail/ComposeModal'
import { MdnToast } from '@/components/mail/MdnToast'
import { useEmailNotifications } from '@/hooks/useEmailNotifications'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
import { toast } from '@/components/ui/toast'
import type { Message } from '@/types/email'

const fetcher = (url: string) => fetch(url).then(r => r.json())

type SelectionMode = 'none' | 'single' | 'thread'

export function MailClient() {
  const [selectionMode, setSelectionMode] = useState<SelectionMode>('none')
  const [selectedUid, setSelectedUid] = useState<string | null>(null)
  const [selectedAccount, setSelectedAccount] = useState<string | null>(null)
  const [selectedThread, setSelectedThread] = useState<Message[] | null>(null)
  const [selectedThreadSubject, setSelectedThreadSubject] = useState<string>('')
  const [composeMode, setComposeMode] = useState<'compose' | 'reply' | 'replyAll' | 'forward' | null>(null)
  const [composeReplyTo, setComposeReplyTo] = useState<Message | null>(null)
  const [aiReplyDraft, setAiReplyDraft] = useState<string | null>(null)
  const [activeAccountId, setActiveAccountId] = useState<string | null>(null)
  const [showReadingPane, setShowReadingPane] = useState(false)
  const settingsPaneInitialized = useRef(false)
  const [currentMessage, setCurrentMessage] = useState<Message | null>(null)
  const [mdnToast, setMdnToast] = useState<{
    uid: string; accountId: string; folder: string;
    fromName: string; subject: string; dispositionNotificationTo: string
  } | null>(null)
  // Track which UIDs already had the MDN toast shown to avoid re-showing
  const shownMdnUids = useRef<Set<string>>(new Set())

  // Resizable list column
  const [listWidth, setListWidth] = useState(320)
  const listWidthRef = useRef(320)
  const isResizingRef = useRef(false)
  const startXRef = useRef(0)
  const startWidthRef = useRef(0)

  // Ref for focusing search input via keyboard shortcut
  const searchInputRef = useRef<HTMLInputElement>(null)

  const searchParams = useSearchParams()
  const folder = searchParams.get('folder') ?? 'INBOX'

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('synapmail:activeAccountId')
      if (stored) setActiveAccountId(stored)
    }
  }, [])

  useEffect(() => {
    const stored = localStorage.getItem('synapmail:listWidth')
    if (stored) {
      const w = parseInt(stored)
      if (w >= 240 && w <= 600) {
        setListWidth(w)
        listWidthRef.current = w
      }
    }
  }, [])

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizingRef.current) return
      const delta = e.clientX - startXRef.current
      const newWidth = Math.min(600, Math.max(240, startWidthRef.current + delta))
      listWidthRef.current = newWidth
      setListWidth(newWidth)
    }
    const handleMouseUp = () => {
      if (!isResizingRef.current) return
      isResizingRef.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      localStorage.setItem('synapmail:listWidth', String(listWidthRef.current))
    }
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [])

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    isResizingRef.current = true
    startXRef.current = e.clientX
    startWidthRef.current = listWidthRef.current
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [])

  useEffect(() => {
    const handler = () => setComposeMode('compose')
    window.addEventListener('synapmail:compose', handler)
    return () => window.removeEventListener('synapmail:compose', handler)
  }, [])

  useEffect(() => {
    const handler = (e: Event) => {
      const id = (e as CustomEvent<string>).detail
      setActiveAccountId(id)
      setSelectedUid(null)
      setSelectedAccount(null)
      setSelectedThread(null)
      setSelectionMode('none')
      setCurrentMessage(null)
    }
    window.addEventListener('synapmail:account-change', handler)
    return () => window.removeEventListener('synapmail:account-change', handler)
  }, [])

  // Listen for notification click → open specific message
  useEffect(() => {
    const handler = (e: Event) => {
      const { uid, accountId } = (e as CustomEvent<{ uid: string; accountId: string; folder: string }>).detail
      handleSelect(uid, accountId)
      setShowReadingPane(true)
    }
    window.addEventListener('synapmail:open-message', handler)
    return () => window.removeEventListener('synapmail:open-message', handler)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const { data: settingsData } = useSWR<{ data: { reading_pane: boolean; notifications: boolean } }>(
    '/api/settings',
    fetcher
  )

  // Initialize showReadingPane from DB setting (once, before any user interaction)
  useEffect(() => {
    if (settingsData?.data && !settingsPaneInitialized.current) {
      settingsPaneInitialized.current = true
      setShowReadingPane(settingsData.data.reading_pane)
    }
  }, [settingsData])

  const { data: accountsData } = useSWR<{ data: { id: string; email: string; isDefault?: boolean }[] }>(
    '/api/accounts',
    fetcher
  )

  const accounts = accountsData?.data ?? []
  const resolvedActiveId = activeAccountId ?? accounts.find(a => a.isDefault)?.id ?? accounts[0]?.id
  const activeAccount = accounts.find(a => a.id === resolvedActiveId) ?? accounts[0]
  const accountEmail = activeAccount?.email ?? ''
  const accountId = selectedAccount ?? resolvedActiveId ?? ''

  // SSE connection — receives scheduled_sent events from the server
  useEffect(() => {
    const es = new EventSource('/api/stream')
    es.onmessage = (e: MessageEvent<string>) => {
      try {
        const data = JSON.parse(e.data) as { type: string; subject?: string; to?: string }
        if (data.type === 'scheduled_sent') {
          toast.add({
            title: 'Email envoyé',
            description: `"${data.subject}" → ${data.to}`,
            type: 'success',
            timeout: 6000,
          })
          window.dispatchEvent(new CustomEvent('synapmail:scheduled-sent'))
        }
      } catch { /* ignore malformed */ }
    }
    return () => es.close()
  }, [])

  useEmailNotifications(folder, resolvedActiveId)

  const handleSelect = useCallback((uid: string, accId: string) => {
    setSelectedUid(uid)
    setSelectedAccount(accId)
    setSelectedThread(null)
    setSelectionMode('single')
    setShowReadingPane(true)
  }, [])

  const handleSelectThread = useCallback((messages: Message[], subject: string) => {
    setSelectedThread([...messages].reverse())
    setSelectedThreadSubject(subject)
    setSelectedUid(null)
    setSelectedAccount(null)
    setSelectionMode('thread')
    setShowReadingPane(true)
  }, [])

  const handleReply = useCallback((msg: Message) => {
    setComposeReplyTo(msg)
    setComposeMode('reply')
  }, [])

  const handleReplyAll = useCallback((msg: Message) => {
    setComposeReplyTo(msg)
    setComposeMode('replyAll')
  }, [])

  const handleForward = useCallback((msg: Message) => {
    setComposeReplyTo(msg)
    setComposeMode('forward')
  }, [])

  const handleDelete = useCallback(() => {
    setSelectedUid(null)
    setSelectedAccount(null)
    setSelectedThread(null)
    setSelectionMode('none')
    setShowReadingPane(false)
    setCurrentMessage(null)
  }, [])

  const handleThreadDelete = useCallback((uid: string) => {
    if (!selectedThread) return
    const remaining = selectedThread.filter(m => m.uid !== uid)
    if (remaining.length === 0) {
      handleDelete()
    } else {
      setSelectedThread(remaining)
    }
    const msg = selectedThread.find(m => m.uid === uid)
    if (msg) {
      fetch(`/api/messages/${uid}?account=${msg.accountId}&folder=${encodeURIComponent(folder)}`, { method: 'DELETE' })
    }
  }, [selectedThread, folder, handleDelete])

  const handleBack = useCallback(() => {
    setShowReadingPane(false)
    setSelectedUid(null)
    setSelectedAccount(null)
    setSelectedThread(null)
    setSelectionMode('none')
    setCurrentMessage(null)
  }, [])

  // Keyboard shortcut: delete current message
  const handleKbDelete = useCallback(async (uid: string, accId: string) => {
    await fetch(`/api/messages/${uid}?account=${accId}&folder=${encodeURIComponent(folder)}`, { method: 'DELETE' })
    handleDelete()
  }, [folder, handleDelete])

  // Keyboard shortcut: mark unread
  const handleMessageLoaded = useCallback((msg: Message) => {
    setCurrentMessage(msg)
    // Show MDN toast if requested and not already shown for this message
    if (
      msg.dispositionNotificationTo &&
      !shownMdnUids.current.has(msg.uid)
    ) {
      shownMdnUids.current.add(msg.uid)
      setMdnToast({
        uid: msg.uid,
        accountId: msg.accountId,
        folder: msg.folder,
        fromName: msg.from.name || msg.from.address,
        subject: msg.subject,
        dispositionNotificationTo: msg.dispositionNotificationTo,
      })
    }
  }, [])

  const handleKbMarkUnread = useCallback(async (uid: string, accId: string) => {
    await fetch(`/api/messages/${uid}?account=${accId}&folder=${encodeURIComponent(folder)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isRead: false }),
    })
  }, [folder])

  // Keyboard shortcuts
  useKeyboardShortcuts({
    onCompose: () => setComposeMode('compose'),
    onReply: handleReply,
    onReplyAll: handleReplyAll,
    onForward: handleForward,
    onDelete: handleKbDelete,
    onMarkUnread: handleKbMarkUnread,
    onFocusSearch: () => searchInputRef.current?.focus(),
    currentMessage,
    composeOpen: composeMode !== null,
    onCloseCompose: () => { setComposeMode(null); setComposeReplyTo(null) },
  })

  const listSelectedUid = selectionMode === 'single' ? selectedUid : null

  const composeReplyToProp = composeReplyTo ? {
    uid: composeReplyTo.uid,
    from: composeReplyTo.from,
    to: composeReplyTo.to,
    cc: composeReplyTo.cc,
    subject: composeReplyTo.subject,
    bodyHtml: composeReplyTo.bodyHtml,
    bodyPlain: composeReplyTo.bodyPlain,
    date: composeReplyTo.date,
    accountId: composeReplyTo.accountId,
    attachments: composeMode === 'forward' && composeReplyTo.attachments?.length
      ? composeReplyTo.attachments.map(a => ({
          ...a,
          uid: composeReplyTo.uid,
          accountId: composeReplyTo.accountId,
          folder,
        }))
      : undefined,
  } : undefined

  return (
    <div className="flex h-full min-h-0">
      <div
        className={`${showReadingPane ? 'hidden lg:flex' : 'flex'} shrink-0 flex-col border-r border-border`}
        style={{ width: listWidth }}
      >
        <MessageList
          folder={folder}
          selectedUid={listSelectedUid}
          onSelect={handleSelect}
          onSelectThread={handleSelectThread}
          activeAccountId={resolvedActiveId}
          searchInputRef={searchInputRef}
        />
      </div>

      {/* Resize handle — desktop only */}
      <div
        className="hidden lg:block w-1 shrink-0 bg-transparent hover:bg-primary/30 active:bg-primary/50 cursor-col-resize transition-colors"
        onMouseDown={handleResizeStart}
      />

      <div className={`${showReadingPane ? 'flex' : 'hidden lg:flex'} flex-col flex-1 overflow-hidden min-w-0`}>
        {showReadingPane && (
          <div className="lg:hidden flex items-center gap-2 px-4 py-2 border-b border-border shrink-0">
            <button onClick={handleBack} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
              <ArrowLeft className="w-4 h-4" />
              Retour
            </button>
          </div>
        )}
        <div className="flex-1 overflow-hidden min-h-0">
          {selectionMode === 'thread' && selectedThread ? (
            <ThreadPane
              threadMessages={selectedThread}
              subject={selectedThreadSubject}
              folder={folder}
              accountId={resolvedActiveId ?? accountId}
              onReply={handleReply}
              onForward={handleForward}
              onDelete={handleThreadDelete}
            />
          ) : (
            <ReadingPane
              uid={selectedUid}
              accountId={selectedAccount}
              folder={folder}
              onDelete={handleDelete}
              onReply={handleReply}
              onReplyAll={handleReplyAll}
              onForward={handleForward}
              onMessageLoaded={handleMessageLoaded}
              onAiReply={(draft) => setAiReplyDraft(draft)}
            />
          )}
        </div>
      </div>

      {composeMode && (
        <ComposeModal
          mode={composeMode}
          replyTo={composeReplyToProp}
          accountEmail={accountEmail}
          accountId={accountId}
          initialBody={aiReplyDraft ?? undefined}
          onClose={() => { setComposeMode(null); setComposeReplyTo(null); setAiReplyDraft(null) }}
          onSent={() => { setComposeMode(null); setComposeReplyTo(null); setAiReplyDraft(null) }}
        />
      )}

      {mdnToast && (
        <MdnToast
          uid={mdnToast.uid}
          accountId={mdnToast.accountId}
          folder={mdnToast.folder}
          fromName={mdnToast.fromName}
          subject={mdnToast.subject}
          dispositionNotificationTo={mdnToast.dispositionNotificationTo}
          onDismiss={() => setMdnToast(null)}
        />
      )}
    </div>
  )
}
