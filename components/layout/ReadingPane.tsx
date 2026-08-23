'use client'

import { useTranslations } from 'next-intl'
import { Reply, Forward, Trash2, Archive, Star, MoreHorizontal, Mail } from 'lucide-react'
import useSWR from 'swr'
import type { Message } from '@/types/email'
import { Button } from '@/components/ui/button'
import { useRef, useEffect } from 'react'

const fetcher = (url: string) => fetch(url).then(r => r.json())

function EmailBody({ message }: { message: Message }) {
  const iframeRef = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    if (!message.bodyHtml || !iframeRef.current) return
    const doc = iframeRef.current.contentDocument
    if (!doc) return
    doc.open()
    doc.write(
      `<html><head><style>body{font-family:sans-serif;font-size:14px;line-height:1.6;color:#333;padding:0 16px;margin:0}</style></head><body>${message.bodyHtml}</body></html>`
    )
    doc.close()
  }, [message.bodyHtml])

  if (message.bodyHtml) {
    return (
      <iframe
        ref={iframeRef}
        className="w-full border-0 flex-1"
        style={{ minHeight: 400 }}
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
}

export function ReadingPane({ uid, accountId, folder }: Props) {
  const t = useTranslations('mail')

  const { data: message, isLoading } = useSWR<Message>(
    uid && accountId
      ? `/api/messages/${uid}?account=${accountId}&folder=${encodeURIComponent(folder)}`
      : null,
    fetcher
  )

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
        <Button variant="ghost" size="sm" className="gap-1.5 h-8 text-xs">
          <Reply className="w-3.5 h-3.5" /> {t('reply')}
        </Button>
        <Button variant="ghost" size="sm" className="gap-1.5 h-8 text-xs">
          <Forward className="w-3.5 h-3.5" /> {t('forward')}
        </Button>
        <div className="flex-1" />
        <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
          <Star className="w-3.5 h-3.5" />
        </Button>
        <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
          <Archive className="w-3.5 h-3.5" />
        </Button>
        <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-destructive hover:text-destructive">
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
        <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
          <MoreHorizontal className="w-3.5 h-3.5" />
        </Button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        <EmailBody message={message} />
      </div>
    </div>
  )
}
