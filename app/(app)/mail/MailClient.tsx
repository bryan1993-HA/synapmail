'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import useSWR from 'swr'
import { MessageList } from '@/components/layout/MessageList'
import { ReadingPane } from '@/components/layout/ReadingPane'
import { ThreadPane } from '@/components/layout/ThreadPane'
import { ComposeModal } from '@/components/mail/ComposeModal'
import { useEmailNotifications } from '@/hooks/useEmailNotifications'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
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
  const [activeAccountId, setActiveAccountId] = useState<string | null>(null)
  const [showReadingPane, setShowReadingPane] = useState(false)
  const [currentMessage, setCurrentMessage] = useState<Message | null>(null)

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

  const { data: accountsData } = useSWR<{ data: { id: string; email: string; isDefault?: boolean }[] }>(
    '/api/accounts',
    fetcher
  )

  const accounts = accountsData?.data ?? []
  const resolvedActiveId = activeAccountId ?? accounts.find(a => a.isDefault)?.id ?? accounts[0]?.id
  const activeAccount = accounts.find(a => a.id === resolvedActiveId) ?? accounts[0]
  const accountEmail = activeAccount?.email ?? ''
  const accountId = selectedAccount ?? resolvedActiveId ?? ''

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
      <div className={`${showReadingPane ? 'hidden lg:flex' : 'flex'} w-full lg:w-80 shrink-0 border-r border-border flex-col`}>
        <MessageList
          folder={folder}
          selectedUid={listSelectedUid}
          onSelect={handleSelect}
          onSelectThread={handleSelectThread}
          activeAccountId={resolvedActiveId}
          searchInputRef={searchInputRef}
        />
      </div>

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
              onMessageLoaded={setCurrentMessage}
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
          onClose={() => { setComposeMode(null); setComposeReplyTo(null) }}
          onSent={() => { setComposeMode(null); setComposeReplyTo(null) }}
        />
      )}
    </div>
  )
}
