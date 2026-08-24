'use client'

import { useTranslations } from 'next-intl'
import { Reply, Forward, Trash2, Archive, Star, MoreHorizontal, Mail, Paperclip, Download, X, FileText, Image as ImageIcon, ReplyAll } from 'lucide-react'
import useSWR from 'swr'
import type { Message } from '@/types/email'
import type { Attachment } from '@/types/email'
import { Button } from '@/components/ui/button'
import { useRef, useEffect, useState, useCallback } from 'react'
import { cn } from '@/lib/utils'

const fetcher = (url: string) => fetch(url).then(r => r.json())

const formatBytes = (bytes: number) =>
  bytes < 1024 ? bytes + 'B'
    : bytes < 1048576 ? (bytes / 1024).toFixed(1) + 'Ko'
    : (bytes / 1048576).toFixed(1) + 'Mo'

function isImage(contentType: string) {
  return /^image\//i.test(contentType)
}
function isPdf(contentType: string) {
  return contentType === 'application/pdf'
}

function AttachmentSection({
  attachments, uid, accountId, folder,
}: {
  attachments: Attachment[]
  uid: string
  accountId: string
  folder: string
}) {
  const [preview, setPreview] = useState<{ url: string; downloadUrl: string; type: 'image' | 'pdf'; filename: string } | null>(null)

  const attUrl = useCallback(
    (id: string, inline = false) =>
      `/api/messages/${uid}/attachment/${id}?account=${accountId}&folder=${encodeURIComponent(folder)}${inline ? '&inline=true' : ''}`,
    [uid, accountId, folder]
  )

  const openPreview = (att: Attachment) => {
    setPreview({
      url: attUrl(att.id, true),
      downloadUrl: attUrl(att.id, false),
      type: isImage(att.contentType) ? 'image' : 'pdf',
      filename: att.filename,
    })
  }

  return (
    <>
      <div className="px-6 py-4 border-t border-border">
        <p className="text-xs font-semibold text-muted-foreground mb-3 uppercase tracking-wide">
          Pièces jointes ({attachments.length})
        </p>

        {/* Image thumbnails grid */}
        {attachments.some(a => isImage(a.contentType)) && (
          <div className="flex flex-wrap gap-2 mb-3">
            {attachments.filter(a => isImage(a.contentType)).map(att => (
              <button
                key={att.id}
                onClick={() => openPreview(att)}
                className="relative group rounded-lg overflow-hidden border border-border hover:border-primary/50 transition-colors w-24 h-24 bg-muted/30 shrink-0"
                title={att.filename}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={attUrl(att.id, true)}
                  alt={att.filename}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <ImageIcon className="w-5 h-5 text-white" />
                </div>
              </button>
            ))}
          </div>
        )}

        {/* File chips (all attachments) */}
        <div className="flex flex-wrap gap-2">
          {attachments.map(att => {
            const canPreview = isImage(att.contentType) || isPdf(att.contentType)
            return (
              <div
                key={att.id}
                className="flex items-center gap-1 rounded-lg border border-border bg-muted/30 text-xs overflow-hidden"
              >
                {canPreview ? (
                  <button
                    onClick={() => openPreview(att)}
                    className="flex items-center gap-2 px-3 py-2 hover:bg-muted/60 transition-colors"
                    title="Prévisualiser"
                  >
                    {isPdf(att.contentType)
                      ? <FileText className="w-3.5 h-3.5 text-red-500 shrink-0" />
                      : <ImageIcon className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                    }
                    <span className="max-w-[140px] truncate text-foreground">{att.filename}</span>
                    <span className="text-muted-foreground shrink-0">{formatBytes(att.size)}</span>
                  </button>
                ) : (
                  <span className="flex items-center gap-2 px-3 py-2">
                    <Paperclip className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    <span className="max-w-[140px] truncate text-foreground">{att.filename}</span>
                    <span className="text-muted-foreground shrink-0">{formatBytes(att.size)}</span>
                  </span>
                )}
                <a
                  href={attUrl(att.id)}
                  download={att.filename}
                  className="px-2 py-2 hover:bg-muted/60 transition-colors border-l border-border text-muted-foreground hover:text-foreground"
                  title="Télécharger"
                >
                  <Download className="w-3.5 h-3.5" />
                </a>
              </div>
            )
          })}
        </div>
      </div>

      {/* Preview modal */}
      {preview && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setPreview(null)}
        >
          <button
            onClick={() => setPreview(null)}
            className="absolute top-4 right-4 w-9 h-9 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
          <a
            href={preview.downloadUrl}
            download={preview.filename}
            onClick={e => e.stopPropagation()}
            className="absolute top-4 right-16 w-9 h-9 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
            title="Télécharger"
          >
            <Download className="w-4 h-4" />
          </a>
          <div
            className="max-w-5xl max-h-[90vh] w-full flex flex-col items-center gap-3"
            onClick={e => e.stopPropagation()}
          >
            <p className="text-white/70 text-sm truncate max-w-full">{preview.filename}</p>
            {preview.type === 'image' ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={preview.url}
                alt={preview.filename}
                className="max-w-full max-h-[80vh] object-contain rounded-lg shadow-2xl"
              />
            ) : (
              <iframe
                src={preview.url}
                className="w-full rounded-lg shadow-2xl bg-white"
                style={{ height: '80vh' }}
                title={preview.filename}
              />
            )}
          </div>
        </div>
      )}
    </>
  )
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
  onReplyAll?: (msg: Message) => void
  onForward?: (msg: Message) => void
  onMessageLoaded?: (msg: Message) => void
}

export function ReadingPane({ uid, accountId, folder, onDelete, onReply, onReplyAll, onForward, onMessageLoaded }: Props) {
  const t = useTranslations('mail')
  const [isStarred, setIsStarred] = useState<boolean | null>(null)

  const swrKey = uid && accountId
    ? `/api/messages/${uid}?account=${accountId}&folder=${encodeURIComponent(folder)}`
    : null

  const { data: message, isLoading, mutate } = useSWR<Message>(swrKey, fetcher)

  useEffect(() => {
    if (message) {
      setIsStarred(message.isStarred)
      onMessageLoaded?.(message)
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
              {message.to?.length > 0 && (
                <div className="text-xs text-muted-foreground mt-0.5">
                  À : {message.to.map(a => a.name || a.address).join(', ')}
                </div>
              )}
              {message.cc && message.cc.length > 0 && (
                <div className="text-xs text-muted-foreground">
                  Cc : {message.cc.map(a => a.name || a.address).join(', ')}
                </div>
              )}
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
        <Button variant="ghost" size="sm" className="gap-1.5 h-8 text-xs" onClick={() => onReplyAll?.(message)}>
          <ReplyAll className="w-3.5 h-3.5" /> {t('replyAll')}
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

      {/* Attachments — above body */}
      {(message.attachments?.length ?? 0) > 0 && (
        <AttachmentSection
          attachments={message.attachments!}
          uid={uid!}
          accountId={accountId!}
          folder={folder}
        />
      )}

      {/* Body */}
      <div className="flex-1 overflow-y-auto min-h-0">
        <EmailBody message={message} />
      </div>
    </div>
  )
}
