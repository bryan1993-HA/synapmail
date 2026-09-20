'use client'

import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { COMPOSE_EVENT, COMPOSE_QUERY, MAIL_PATH } from '@/lib/compose'
import { SCOPE_PARAM, SEARCH_PARAM, focusSearch, readScope } from '@/lib/search'
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
import { useMailSelection, targetOrigins } from '@/lib/mailSelection'
import { groupByOrigin, messageHref, originOfMessage, sameOrigin, type MessageOrigin } from '@/lib/mailOrigin'
import { MAILBOX_CHANGED, STREAM_ACCOUNT_PARAM } from '@/lib/stream'
import type { ForwardedMessages } from '@/lib/forward'
import type { Message } from '@/types/email'
import type { EmailAccount } from '@/types/account'

const fetcher = (url: string) => fetch(url).then(r => r.json())

type SelectionMode = 'none' | 'single' | 'thread'

/** The three ways of opening the composer from an existing message. */
type ComposeKind = 'reply' | 'replyAll' | 'forward'

export function MailClient() {
  const [selectionMode, setSelectionMode] = useState<SelectionMode>('none')
  /**
   * The open message, identified by its ORIGIN (account, folder, uid): a result from
   * an "all folders" search must be read in ITS own folder, not in the one currently
   * displayed. Resolving against the displayed folder opened the wrong message, and
   * could crash the application.
   */
  const [selectedOrigin, setSelectedOrigin] = useState<MessageOrigin | null>(null)
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

  const searchParams = useSearchParams()
  const router = useRouter()
  const folder = searchParams.get('folder') ?? 'INBOX'
  // The search query lives in the URL: the app bar writes it, the list reads it.
  const search = searchParams.get(SEARCH_PARAM) ?? ''
  const searchScope = readScope(searchParams.get(SCOPE_PARAM))

  const { data: settingsData } = useSWR<{ data: { active_account_id: string | null; list_width: number; reading_pane: boolean; notifications: boolean } }>('/api/settings', fetcher)
  const didInitFromSettings = useRef(false)
  useEffect(() => {
    if (!settingsData?.data || didInitFromSettings.current) return
    didInitFromSettings.current = true
    if (settingsData.data.active_account_id) setActiveAccountId(settingsData.data.active_account_id)
    const w = settingsData.data.list_width
    if (w >= 240 && w <= 600) {
      setListWidth(w)
      listWidthRef.current = w
    }
  }, [settingsData])

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
      fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ list_width: listWidthRef.current }),
      })
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
    window.addEventListener(COMPOSE_EVENT, handler)
    return () => window.removeEventListener(COMPOSE_EVENT, handler)
  }, [])

  // Arriving from another page with `?compose=1` (sidebar, dashboard): open the
  // composer, then strip the parameter so a reload does not reopen it.
  useEffect(() => {
    if (!searchParams.get(COMPOSE_QUERY)) return
    setComposeMode('compose')
    const rest = new URLSearchParams(searchParams.toString())
    rest.delete(COMPOSE_QUERY)
    router.replace(rest.size ? `${MAIL_PATH}?${rest}` : MAIL_PATH)
  }, [searchParams, router])

  useEffect(() => {
    const handler = (e: Event) => {
      const id = (e as CustomEvent<string>).detail
      setActiveAccountId(id)
      setSelectedOrigin(null)
      setSelectedThread(null)
      setSelectionMode('none')
      setCurrentMessage(null)
    }
    window.addEventListener('synapmail:account-change', handler)
    return () => window.removeEventListener('synapmail:account-change', handler)
  }, [])

  // Listen for notification click / to-handle list click → open specific message
  useEffect(() => {
    const handler = (e: Event) => {
      const { uid, accountId, folder: targetFolder } = (e as CustomEvent<{ uid: string; accountId: string; folder?: string }>).detail
      // The full origin travels with the event: the pane reads the message in ITS own
      // folder, without the list having to switch folders first.
      if (targetFolder) {
        router.push(`/mail?folder=${encodeURIComponent(targetFolder)}`)
      }
      handleSelect({ uid, accountId, folder: targetFolder ?? folder })
      setShowReadingPane(true)
    }
    window.addEventListener('synapmail:open-message', handler)
    return () => window.removeEventListener('synapmail:open-message', handler)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Initialize showReadingPane from DB setting (once, before any user interaction)
  useEffect(() => {
    if (settingsData?.data && !settingsPaneInitialized.current) {
      settingsPaneInitialized.current = true
      setShowReadingPane(settingsData.data.reading_pane)
    }
  }, [settingsData])

  const { data: accountsData } = useSWR<{ data: EmailAccount[] }>(
    '/api/accounts',
    fetcher
  )

  const accounts = accountsData?.data ?? []
  const resolvedActiveId = activeAccountId ?? accounts.find(a => a.isDefault)?.id ?? accounts[0]?.id
  const activeAccount = accounts.find(a => a.id === resolvedActiveId) ?? accounts[0]
  const accountEmail = activeAccount?.email ?? ''
  const accountId = selectedOrigin?.accountId ?? resolvedActiveId ?? ''
  // Defense-in-depth only — the API routes are the real permission boundary.
  // Owned accounts don't carry `permissions` (POST /api/accounts doesn't return it), hence the permissive fallback.
  const permissions = activeAccount?.permissions ?? {
    canSend: true, canDelete: true, canOrganize: true, canManageRules: true, canManageSignatures: true,
  }

  const { state: mailTarget, register: registerMailActions, run: runMail } = useMailSelection()

  // SSE stream: scheduler events AND real-time mailbox events. The active account is
  // passed to the server, which puts its inbox under IDLE; switching accounts reopens
  // the stream on the new mailbox.
  useEffect(() => {
    const url = resolvedActiveId
      ? `/api/stream?${STREAM_ACCOUNT_PARAM}=${encodeURIComponent(resolvedActiveId)}`
      : '/api/stream'
    const es = new EventSource(url)
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
        } else if (data.type === MAILBOX_CHANGED) {
          // The list already knows how to reload itself: trigger ITS action, so no
          // reload logic is duplicated here.
          runMail('refresh')
        }
      } catch { /* ignore malformed */ }
    }
    return () => es.close()
  }, [resolvedActiveId, runMail])

  useEmailNotifications(folder, resolvedActiveId)

  const handleSelect = useCallback((origin: MessageOrigin) => {
    setSelectedOrigin(origin)
    setSelectedThread(null)
    setSelectionMode('single')
    setShowReadingPane(true)
  }, [])

  const handleSelectThread = useCallback((messages: Message[], subject: string) => {
    setSelectedThread([...messages].reverse())
    setSelectedThreadSubject(subject)
    setSelectedOrigin(null)
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
    setSelectedOrigin(null)
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
      fetch(`/api/messages/${uid}?account=${msg.accountId}&folder=${encodeURIComponent(msg.folder || folder)}`, { method: 'DELETE' })
    }
  }, [selectedThread, folder, handleDelete])

  const handleBack = useCallback(() => {
    setShowReadingPane(false)
    setSelectedOrigin(null)
    setSelectedThread(null)
    setSelectionMode('none')
    setCurrentMessage(null)
  }, [])

  // Keyboard shortcut: delete current message
  const handleKbDelete = useCallback(async (msg: Message) => {
    await fetch(messageHref(originOfMessage(msg)), { method: 'DELETE' })
    handleDelete()
  }, [handleDelete])

  // Reply / Reply all / Forward for a toolbar outside the reading pane (the
  // `lib/mailSelection` context). The target is the selected message, otherwise the open
  // one. If it is not loaded yet (a row Cmd-clicked without being opened), it is opened
  // and the action fires as soon as the message arrives.
  // The deferred target records the INTENDED message, not just the gesture: without it,
  // opening another row (or a message pushed by a notification) while loading would
  // silently reply to the wrong message.
  const pendingCompose = useRef<{ kind: ComposeKind; origin: MessageOrigin } | null>(null)
  // Forwarding a MULTIPLE selection: each message is attached whole. No message is
  // opened for this — only the ORIGIN account, the folder and the checked uids are
  // needed, and the server re-reads them itself. The origin account travels with the
  // selection: the sender chosen in the "From" field may be a different one, and uids
  // look alike from one mailbox to the next.
  const [forwardedMessages, setForwardedMessages] = useState<ForwardedMessages | null>(null)
  const composeHandlers = useMemo(
    () => ({ reply: handleReply, replyAll: handleReplyAll, forward: handleForward }),
    [handleReply, handleReplyAll, handleForward]
  )

  useEffect(() => {
    const composeFromToolbar = (kind: ComposeKind) => () => {
      const origins = targetOrigins(mailTarget)
      if (kind === 'forward' && origins.length > 1) {
        // A multi-forward re-reads the messages at the source, within ONE folder: the
        // origin travels with the selection, never the displayed folder. A selection
        // mixing folders never reaches this point (`deriveCapabilities` disables forward
        // in that case), but the guard stays: exactly one group.
        const groups = groupByOrigin(origins)
        if (groups.length !== 1) return
        setForwardedMessages(groups[0])
        setComposeReplyTo(null)
        setComposeMode('forward')
        return
      }
      const origin = origins[0]
      if (!origin) return
      if (currentMessage && sameOrigin(originOfMessage(currentMessage), origin)) {
        return composeHandlers[kind](currentMessage)
      }
      pendingCompose.current = { kind, origin }
      handleSelect(origin)
    }
    registerMailActions({
      reply: composeFromToolbar('reply'),
      replyAll: composeFromToolbar('replyAll'),
      forward: composeFromToolbar('forward'),
    })
  }, [registerMailActions, mailTarget, currentMessage, composeHandlers, handleSelect])

  // Keyboard shortcut: mark unread
  const handleMessageLoaded = useCallback((msg: Message) => {
    setCurrentMessage(msg)
    const pending = pendingCompose.current
    if (pending) {
      pendingCompose.current = null
      if (sameOrigin(pending.origin, originOfMessage(msg))) composeHandlers[pending.kind](msg)
    }
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
  }, [composeHandlers])

  const handleKbMarkUnread = useCallback(async (msg: Message) => {
    await fetch(messageHref(originOfMessage(msg)), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isRead: false }),
    })
  }, [])

  // Keyboard shortcuts
  useKeyboardShortcuts({
    onCompose: () => setComposeMode('compose'),
    onReply: handleReply,
    onReplyAll: handleReplyAll,
    onForward: handleForward,
    onDelete: handleKbDelete,
    onMarkUnread: handleKbMarkUnread,
    onFocusSearch: focusSearch,
    currentMessage,
    composeOpen: composeMode !== null,
    onCloseCompose: () => { setComposeMode(null); setComposeReplyTo(null); setForwardedMessages(null) },
  })

  const listSelectedOrigin = selectionMode === 'single' ? selectedOrigin : null

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
        className={`${showReadingPane ? 'hidden lg:flex' : 'flex'} w-full lg:w-[var(--synap-list-w)] shrink-0 flex-col border-r border-border`}
        style={{ '--synap-list-w': `${listWidth}px` } as React.CSSProperties}
      >
        <MessageList
          folder={folder}
          selectedOrigin={listSelectedOrigin}
          onSelect={handleSelect}
          onSelectThread={handleSelectThread}
          activeAccountId={resolvedActiveId}
          search={search}
          searchScope={searchScope}
          permissions={permissions}
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
              uid={selectedOrigin?.uid ?? null}
              accountId={selectedOrigin?.accountId ?? null}
              folder={selectedOrigin?.folder ?? folder}
              activeAccountId={resolvedActiveId}
              onDelete={handleDelete}
              onReply={handleReply}
              onReplyAll={handleReplyAll}
              onForward={handleForward}
              onMessageLoaded={handleMessageLoaded}
              onAiReply={(draft) => setAiReplyDraft(draft)}
              permissions={permissions}
            />
          )}
        </div>
      </div>

      {composeMode && (
        <ComposeModal
          mode={composeMode}
          replyTo={composeReplyToProp}
          forwardedMessages={forwardedMessages ?? undefined}
          accountEmail={accountEmail}
          accountId={accountId}
          initialBody={aiReplyDraft ?? undefined}
          onClose={() => { setComposeMode(null); setComposeReplyTo(null); setForwardedMessages(null); setAiReplyDraft(null) }}
          onSent={() => { setComposeMode(null); setComposeReplyTo(null); setForwardedMessages(null); setAiReplyDraft(null) }}
          canSend={permissions.canSend}
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
