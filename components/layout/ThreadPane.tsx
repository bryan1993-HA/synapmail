'use client'

import { useState, useRef, useEffect } from 'react'
import { Reply, Forward, Trash2, ChevronDown, ChevronUp, Mail, Paperclip } from 'lucide-react'
import useSWR from 'swr'
import type { Message } from '@/types/email'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const fetcher = (url: string) => fetch(url).then(r => r.json())

const formatBytes = (bytes: number) =>
  bytes < 1024 ? bytes + 'B'
    : bytes < 1048576 ? (bytes / 1024).toFixed(1) + 'Ko'
    : (bytes / 1048576).toFixed(1) + 'Mo'

const AVATAR_COLORS = [
  'bg-blue-500', 'bg-violet-500', 'bg-emerald-500', 'bg-amber-500',
  'bg-rose-500', 'bg-cyan-500', 'bg-pink-500', 'bg-teal-500',
]

const getAvatarColor = (str: string) => {
  let hash = 0
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash)
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}

const formatDate = (iso: string) => {
  const d = new Date(iso)
  const now = new Date()
  const isToday = d.toDateString() === now.toDateString()
  if (isToday) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function EmailBody({ message }: { message: Message }) {
  const iframeRef = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    if (!message.bodyHtml || !iframeRef.current) return
    const iframe = iframeRef.current
    const doc = iframe.contentDocument
    if (!doc) return
    doc.open()
    doc.write(
      `<html><head><style>
        * { box-sizing: border-box; }
        body { font-family: sans-serif; font-size: 14px; line-height: 1.6; color: #333; padding: 16px; margin: 0; }
        img { max-width: 100%; height: auto; }
      </style></head><body>${message.bodyHtml}</body></html>`
    )
    doc.close()

    const resize = () => {
      if (iframe.contentDocument?.body) {
        iframe.style.height = iframe.contentDocument.body.scrollHeight + 'px'
      }
    }
    iframe.onload = resize
    setTimeout(resize, 150)
  }, [message.bodyHtml])

  if (message.bodyHtml) {
    return (
      <iframe
        ref={iframeRef}
        className="w-full border-0 block"
        style={{ minHeight: 80 }}
        sandbox="allow-same-origin allow-popups"
        title="Email content"
      />
    )
  }
  return (
    <pre className="whitespace-pre-wrap font-sans text-sm text-foreground leading-relaxed px-4 py-3">
      {message.bodyPlain || '(vide)'}
    </pre>
  )
}

interface MessageCardProps {
  uid: string
  accountId: string
  folder: string
  isExpanded: boolean
  isLast: boolean
  onToggle: () => void
  onReply?: (msg: Message) => void
  onForward?: (msg: Message) => void
  onDelete?: (uid: string) => void
  previewMsg: Message
}

function MessageCard({ uid, accountId, folder, isExpanded, isLast, onToggle, onReply, onForward, onDelete, previewMsg }: MessageCardProps) {
  const swrKey = isExpanded
    ? `/api/messages/${uid}?account=${accountId}&folder=${encodeURIComponent(folder)}`
    : null

  const { data: fullMessage, isLoading } = useSWR<Message>(swrKey, fetcher)

  // Mark as read when expanded
  useEffect(() => {
    if (!isExpanded || !fullMessage || fullMessage.isRead) return
    fetch(`/api/messages/${uid}?account=${accountId}&folder=${encodeURIComponent(folder)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isRead: true }),
    })
  }, [isExpanded, fullMessage?.uid]) // eslint-disable-line react-hooks/exhaustive-deps

  const msg = fullMessage ?? previewMsg
  const initial = (msg.from.name || msg.from.address)[0]?.toUpperCase() ?? '?'
  const avatarColor = getAvatarColor(msg.from.address)
  const isUnread = !previewMsg.isRead

  return (
    <div className={cn(
      'border border-border rounded-xl overflow-hidden transition-shadow',
      isExpanded ? 'shadow-sm' : 'hover:shadow-sm'
    )}>
      {/* Card header — always visible */}
      <button
        onClick={onToggle}
        className={cn(
          'w-full text-left flex items-center gap-3 px-4 py-3 transition-colors',
          isExpanded ? 'bg-background' : 'bg-muted/30 hover:bg-muted/50'
        )}
      >
        <div className={cn('w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-white text-xs font-semibold shadow-sm', avatarColor)}>
          {initial}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-2">
            <span className={cn('text-sm truncate', isUnread && !isExpanded ? 'font-semibold text-foreground' : 'font-medium text-foreground')}>
              {msg.from.name || msg.from.address}
            </span>
            <span className="text-xs text-muted-foreground shrink-0">{formatDate(msg.date)}</span>
          </div>
          {!isExpanded && (
            <p className="text-xs text-muted-foreground truncate mt-0.5">
              {previewMsg.preview || '(pas de prévisualisation)'}
            </p>
          )}
        </div>
        {isExpanded ? (
          <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
        )}
        {isUnread && !isExpanded && (
          <div className="w-2 h-2 rounded-full bg-blue-500 shrink-0 shadow-sm shadow-blue-500/50" />
        )}
      </button>

      {/* Expanded body */}
      {isExpanded && (
        <div className="border-t border-border">
          {/* To: header detail */}
          <div className="px-4 py-2 bg-muted/20 border-b border-border/50">
            <p className="text-xs text-muted-foreground">
              <span className="font-medium">À :</span>{' '}
              {(msg.to ?? []).map(r => r.name || r.address).join(', ')}
            </p>
          </div>

          {/* Body */}
          {isLoading ? (
            <div className="px-4 py-6 space-y-2">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="h-3.5 bg-muted animate-pulse rounded-full" style={{ width: `${75 + (i % 3) * 10}%` }} />
              ))}
            </div>
          ) : (
            <EmailBody message={msg} />
          )}

          {/* Attachments */}
          {(fullMessage?.attachments?.length ?? 0) > 0 && (
            <div className="px-4 py-3 border-t border-border bg-muted/20">
              <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">
                Pièces jointes ({fullMessage!.attachments!.length})
              </p>
              <div className="flex flex-wrap gap-2">
                {fullMessage!.attachments!.map(att => (
                  <a
                    key={att.id}
                    href={`/api/messages/${uid}/attachment/${att.id}?account=${accountId}&folder=${encodeURIComponent(folder)}`}
                    download={att.filename}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-background hover:bg-muted/50 transition-colors text-xs"
                  >
                    <Paperclip className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    <span className="max-w-[140px] truncate text-foreground">{att.filename}</span>
                    <span className="text-muted-foreground shrink-0">{formatBytes(att.size)}</span>
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Actions (last message gets full buttons, others get compact) */}
          <div className="flex items-center gap-1.5 px-4 py-2 border-t border-border bg-muted/10">
            {isLast ? (
              <>
                <Button variant="ghost" size="sm" className="gap-1.5 h-8 text-xs" onClick={() => fullMessage && onReply?.(fullMessage)}>
                  <Reply className="w-3.5 h-3.5" /> Répondre
                </Button>
                <Button variant="ghost" size="sm" className="gap-1.5 h-8 text-xs" onClick={() => fullMessage && onForward?.(fullMessage)}>
                  <Forward className="w-3.5 h-3.5" /> Transférer
                </Button>
              </>
            ) : (
              <Button variant="ghost" size="sm" className="gap-1.5 h-8 text-xs" onClick={() => fullMessage && onReply?.(fullMessage)}>
                <Reply className="w-3 h-3" /> Répondre
              </Button>
            )}
            <div className="flex-1" />
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
              onClick={() => onDelete?.(uid)}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

interface Props {
  threadMessages: Message[]  // messages in the thread (sorted oldest first by MailClient)
  subject: string
  folder: string
  accountId: string
  onReply?: (msg: Message) => void
  onForward?: (msg: Message) => void
  onDelete?: (uid: string) => void
}

export function ThreadPane({ threadMessages, subject, folder, accountId, onReply, onForward, onDelete }: Props) {
  // Last message expanded by default
  const [expandedUids, setExpandedUids] = useState<Set<string>>(() => {
    const s = new Set<string>()
    if (threadMessages.length > 0) s.add(threadMessages[threadMessages.length - 1].uid)
    return s
  })

  // When thread changes, expand last message
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (threadMessages.length > 0) {
      setExpandedUids(new Set([threadMessages[threadMessages.length - 1].uid]))
    }
  }, [threadMessages.map(m => m.uid).join(',')])

  if (threadMessages.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
        <Mail className="w-12 h-12 mb-3 opacity-20" />
        <p className="text-sm">Fil de conversation vide</p>
      </div>
    )
  }

  const toggleCard = (uid: string) => {
    setExpandedUids(prev => {
      const next = new Set(prev)
      if (next.has(uid)) {
        next.delete(uid)
      } else {
        next.add(uid)
      }
      return next
    })
  }

  const unreadCount = threadMessages.filter(m => !m.isRead).length

  return (
    <div className="flex flex-col h-full">
      {/* Thread header */}
      <div className="px-6 py-4 border-b border-border shrink-0">
        <h1 className="text-base font-semibold text-foreground leading-tight mb-1 truncate">
          {subject || '(sans objet)'}
        </h1>
        <p className="text-xs text-muted-foreground">
          {threadMessages.length} message{threadMessages.length !== 1 ? 's' : ''}
          {unreadCount > 0 && (
            <span className="ml-2 px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-600 dark:bg-blue-950 dark:text-blue-400 font-medium">
              {unreadCount} non lu{unreadCount !== 1 ? 's' : ''}
            </span>
          )}
        </p>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto min-h-0 p-4 space-y-3">
        {threadMessages.map((msg, idx) => (
          <MessageCard
            key={msg.uid}
            uid={msg.uid}
            accountId={accountId}
            folder={folder}
            isExpanded={expandedUids.has(msg.uid)}
            isLast={idx === threadMessages.length - 1}
            onToggle={() => toggleCard(msg.uid)}
            onReply={onReply}
            onForward={onForward}
            onDelete={onDelete}
            previewMsg={msg}
          />
        ))}
      </div>
    </div>
  )
}
