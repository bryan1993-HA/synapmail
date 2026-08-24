'use client'

import { useTranslations } from 'next-intl'
import { Reply, Forward, Trash2, Archive, Star, MoreHorizontal, Mail, Paperclip } from 'lucide-react'
import useSWR from 'swr'
import type { Message } from '@/types/email'
import { Button } from '@/components/ui/button'
import { useRef, useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

const fetcher = (url: string) => fetch(url).then(r => r.json())

const formatBytes = (bytes: number) =>
  bytes < 1024 ? bytes + 'B'
    : bytes < 1048576 ? (bytes / 1024).toFixed(1) + 'Ko'
    : (bytes / 1048576).toFixed(1) + 'Mo'

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
    setTimeout(resize, 100)
  }, [message.bodyHtml])

  if (message.bodyHtml) {
    return (
      <iframe
        ref={iframeRef}
        className="w-full border-0 block"
        style={{ minHeight: '100%' }}
        sandbox="allow-same-origin allow-popups"
        title="Email content"
      />
    )
  }
  return (
    <pre className="whitespace-pre-wrap font-sans text-sm text-foreground leading-relaxed p-6">
      {message.bodyPlain || '(empty)'}
    </pre>
  )
}

interface Props {
  uid: string | null
  accountId: string | null
  folder: string
  onDelete?: () => void
  onReply?: (msg: Message) => void
  onForward?: (msg: Message) => void
}

export function ReadingPane({ uid, accountId, folder, onDelete, onReply, onForward }: Props) {
  const t = useTranslations('mail')
  const [isStarred, setIsStarred] = useState<boolean | null>(null)

  const swrKey = uid && accountId
    ? `/api/messages/${uid}?account=${accountId}&folder=${encodeURIComponent(folder)}`
    : null

  const { data: message, isLoading, mutate } = useSWR<Message>(swrKey, fetcher)

  useEffect(() => {
    if (message) {
      setIsStarred(message.isStarred)
      if (!message.isRead && accountId) {
        fetch(`/api/messages/${uid}?account=${accountId}&folder=${encodeURIComponent(folder)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isRead: true }),
        })
      }
    }
  }, [message?.uid]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleDelete = async () => {
    if (!uid || !accountId) return
    await fetch(`/api/messages/${uid}?account=${accountId}&folder=${encodeURIComponent(folder)}`, {
      method: 'DELETE',
    })
    onDelete?.()
  }

  const handleStar = async () => {
    if (!uid || !accountId || !message) return
    const newStarred = !isStarred
    setIsStarred(newStarred)
    await fetch(`/api/messages/${uid}?account=${accountId}&folder=${encodeURIComponent(folder)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isStarred: newStarred }),
    })
    mutate({ ...message, isStarred: newStarred }, false)
  }

  if (!uid) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
        <Mail className="w-12 h-12 mb-3 opacity-20" />
        <p className="text-sm">Select a message to read</p>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <div className="h-6 bg-muted animate-pulse rounded w-3/4" />
        <div className="h-4 bg-muted animate-pulse rounded w-1/2" />
        <div className="h-4 bg-muted animate-pulse rounded w-1/3" />
        <div className="mt-8 space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-4 bg-muted animate-pulse rounded" />
          ))}
        </div>
      </div>
    )
  }

  if (!message) return null

  const starred = isStarred ?? message.isStarred

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b border-border shrink-0">
        <h1 className="text-lg font-semibold text-foreground leading-tight mb-3">
          {message.subject || t('noSubject')}
        </h1>
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-primary text-sm font-semibold shrink-0">
              {message.from.name?.[0]?.toUpperCase() ?? message.from.address[0]?.toUpperCase()}
            </div>
            <div>
              <div className="text-sm font-medium text-foreground">{message.from.name || message.from.address}</div>
              <div className="text-xs text-muted-foreground">{message.from.address}</div>
            </div>
          </div>
          <div className="text-xs text-muted-foreground shrink-0">
            {new Date(message.date).toLocaleString()}
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1.5 px-4 py-2 border-b border-border shrink-0">
        <Button variant="ghost" size="sm" className="gap-1.5 h-8 text-xs" onClick={() => onReply?.(message)}>
          <Reply className="w-3.5 h-3.5" /> {t('reply')}
        </Button>
        <Button variant="ghost" size="sm" className="gap-1.5 h-8 text-xs" onClick={() => onForward?.(message)}>
          <Forward className="w-3.5 h-3.5" /> {t('forward')}
        </Button>
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="sm"
          className={cn('h-8 w-8 p-0', starred && 'text-yellow-500 hover:text-yellow-600')}
          onClick={handleStar}
        >
          <Star className={cn('w-3.5 h-3.5', starred && 'fill-current')} />
        </Button>
        <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
          <Archive className="w-3.5 h-3.5" />
        </Button>
        <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-destructive hover:text-destructive" onClick={handleDelete}>
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
        <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
          <MoreHorizontal className="w-3.5 h-3.5" />
        </Button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto min-h-0">
        <EmailBody message={message} />

        {/* Attachments */}
        {(message.attachments?.length ?? 0) > 0 && (
          <div className="px-6 py-4 border-t border-border">
            <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">
              Pièces jointes ({message.attachments!.length})
            </p>
            <div className="flex flex-wrap gap-2">
              {message.attachments!.map(att => (
                <a
                  key={att.id}
                  href={`/api/messages/${uid}/attachment/${att.id}?account=${accountId}&folder=${encodeURIComponent(folder)}`}
                  download={att.filename}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-muted/30 hover:bg-muted/60 transition-colors text-xs group"
                >
                  <Paperclip className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <span className="max-w-[160px] truncate text-foreground">{att.filename}</span>
                  <span className="text-muted-foreground shrink-0">{formatBytes(att.size)}</span>
                </a>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
