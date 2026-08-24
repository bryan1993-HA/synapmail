'use client'

import { useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import useSWR from 'swr'
import { MessageList } from '@/components/layout/MessageList'
import { ReadingPane } from '@/components/layout/ReadingPane'
import { ThreadPane } from '@/components/layout/ThreadPane'
import { ComposeModal } from '@/components/mail/ComposeModal'
import { useEmailNotifications } from '@/hooks/useEmailNotifications'
import type { Message } from '@/types/email'

const fetcher = (url: string) => fetch(url).then(r => r.json())

type SelectionMode = 'none' | 'single' | 'thread'

export function MailClient() {
  const [selectionMode, setSelectionMode] = useState<SelectionMode>('none')
  const [selectedUid, setSelectedUid] = useState<string | null>(null)
  const [selectedAccount, setSelectedAccount] = useState<string | null>(null)
  const [selectedThread, setSelectedThread] = useState<Message[] | null>(null)
  const [selectedThreadSubject, setSelectedThreadSubject] = useState<string>('')
  const [composeMode, setComposeMode] = useState<'compose' | 'reply' | 'forward' | null>(null)
  const [composeReplyTo, setComposeReplyTo] = useState<Message | null>(null)
  const [activeAccountId, setActiveAccountId] = useState<string | null>(null)
  const [showReadingPane, setShowReadingPane] = useState(false)

  const searchParams = useSearchParams()
  const folder = searchParams.get('folder') ?? 'INBOX'

  // Init active account from localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('synapmail:activeAccountId')
      if (stored) setActiveAccountId(stored)
    }
  }, [])

  // Listen for compose event
  useEffect(() => {
    const handler = () => setComposeMode('compose')
    window.addEventListener('synapmail:compose', handler)
    return () => window.removeEventListener('synapmail:compose', handler)
  }, [])

  // Listen for account switch event
  useEffect(() => {
    const handler = (e: Event) => {
      const id = (e as CustomEvent<string>).detail
      setActiveAccountId(id)
      setSelectedUid(null)
      setSelectedAccount(null)
      setSelectedThread(null)
      setSelectionMode('none')
    }
    window.addEventListener('synapmail:account-change', handler)
    return () => window.removeEventListener('synapmail:account-change', handler)
  }, [])

  const { data: accountsData } = useSWR<{ data: { id: string; email: string; isDefault?: boolean }[] }>(
    '/api/accounts',
    fetcher
  )

  const accounts = accountsData?.data ?? []
  const resolvedActiveId = activeAccountId ?? accounts.find(a => a.isDefault)?.id ?? accounts[0]?.id
  const activeAccount = accounts.find(a => a.id === resolvedActiveId) ?? accounts[0]
  const accountEmail = activeAccount?.email ?? ''
  const accountId = selectedAccount ?? resolvedActiveId ?? ''

  // Email notifications
  useEmailNotifications(folder, resolvedActiveId)

  // Single message selected from MessageList (thread of 1)
  const handleSelect = (uid: string, accId: string) => {
    setSelectedUid(uid)
    setSelectedAccount(accId)
    setSelectedThread(null)
    setSelectionMode('single')
    setShowReadingPane(true)
  }

  // Thread selected from MessageList (multiple messages)
  // messages arrive newest-first from the list; reverse to oldest-first for ThreadPane
  const handleSelectThread = (messages: Message[], subject: string) => {
    setSelectedThread([...messages].reverse())
    setSelectedThreadSubject(subject)
    setSelectedUid(null)
    setSelectedAccount(null)
    setSelectionMode('thread')
    setShowReadingPane(true)
  }

  const handleReply = (msg: Message) => {
    setComposeReplyTo(msg)
    setComposeMode('reply')
  }

  const handleForward = (msg: Message) => {
    setComposeReplyTo(msg)
    setComposeMode('forward')
  }

  const handleDelete = () => {
    setSelectedUid(null)
    setSelectedAccount(null)
    setSelectedThread(null)
    setSelectionMode('none')
    setShowReadingPane(false)
  }

  const handleThreadDelete = (uid: string) => {
    if (!selectedThread) return
    const remaining = selectedThread.filter(m => m.uid !== uid)
    if (remaining.length === 0) {
      handleDelete()
    } else {
      setSelectedThread(remaining)
    }
    // Actually delete via API
    const msg = selectedThread.find(m => m.uid === uid)
    if (msg) {
      fetch(`/api/messages/${uid}?account=${msg.accountId}&folder=${encodeURIComponent(folder)}`, {
        method: 'DELETE',
      })
    }
  }

  const handleBack = () => {
    setShowReadingPane(false)
    setSelectedUid(null)
    setSelectedAccount(null)
    setSelectedThread(null)
    setSelectionMode('none')
  }

  // The uid shown as selected in MessageList (for single selection highlight)
  const listSelectedUid = selectionMode === 'single' ? selectedUid : null

  return (
    <div className="flex h-full min-h-0">
      {/* Message List — center column */}
      <div className={`${showReadingPane ? 'hidden lg:flex' : 'flex'} w-full lg:w-80 shrink-0 border-r border-border flex-col`}>
        <MessageList
          folder={folder}
          selectedUid={listSelectedUid}
          onSelect={handleSelect}
          onSelectThread={handleSelectThread}
          activeAccountId={resolvedActiveId}
        />
      </div>

      {/* Reading Pane / Thread Pane — right column */}
      <div className={`${showReadingPane ? 'flex' : 'hidden lg:flex'} flex-col flex-1 overflow-hidden min-w-0`}>
        {/* Mobile back button */}
        {showReadingPane && (
          <div className="lg:hidden flex items-center gap-2 px-4 py-2 border-b border-border shrink-0">
            <button
              onClick={handleBack}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
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
              onForward={handleForward}
            />
          )}
        </div>
      </div>

      {composeMode && (
        <ComposeModal
          mode={composeMode}
          replyTo={composeReplyTo ? {
            uid: composeReplyTo.uid,
            from: composeReplyTo.from,
            to: composeReplyTo.to,
            subject: composeReplyTo.subject,
            bodyHtml: composeReplyTo.bodyHtml,
            bodyPlain: composeReplyTo.bodyPlain,
            date: composeReplyTo.date,
            accountId: composeReplyTo.accountId,
          } : undefined}
          accountEmail={accountEmail}
          accountId={accountId}
          onClose={() => { setComposeMode(null); setComposeReplyTo(null) }}
          onSent={() => { setComposeMode(null); setComposeReplyTo(null) }}
        />
      )}
    </div>
  )
}
