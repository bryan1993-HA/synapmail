'use client'

import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { RefreshCw, Search, X, Paperclip, CheckSquare, Square, Trash2, Mail, MailOpen, MoveRight, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import useSWR from 'swr'
import type { Message, Folder } from '@/types/email'
import { MessageContextMenu, type ContextMenuState } from '@/components/ui/MessageContextMenu'

const fetcher = (url: string) => fetch(url).then(r => r.json())

const formatDate = (iso: string) => {
  const d = new Date(iso)
  const now = new Date()
  const isToday = d.toDateString() === now.toDateString()
  if (isToday) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const isThisYear = d.getFullYear() === now.getFullYear()
  if (isThisYear) return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
  return d.toLocaleDateString([], { year: '2-digit', month: 'short', day: 'numeric' })
}

const AVATAR_COLORS = [
  'bg-blue-500', 'bg-violet-500', 'bg-emerald-500', 'bg-amber-500',
  'bg-rose-500', 'bg-cyan-500', 'bg-pink-500', 'bg-teal-500',
]

const getAvatarColor = (str: string) => {
  let hash = 0
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash)
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}

const normalizeSubject = (subject: string): string => {
  let prev = ''
  let s = subject.trim()
  while (s !== prev) {
    prev = s
    s = s.replace(/^(Re|Rép|Fwd|Fw|TR|AW|SV|VS):\s*/gi, '').trim()
  }
  return s.toLowerCase()
}

const displaySubject = (subject: string): string => {
  let prev = ''
  let s = subject.trim()
  while (s !== prev) {
    prev = s
    s = s.replace(/^(Re|Rép|Fwd|Fw|TR|AW|SV|VS):\s*/gi, '').trim()
  }
  return s || '(sans objet)'
}

interface ThreadGroup {
  key: string
  subject: string
  messages: Message[]
  lastMessage: Message
  hasUnread: boolean
  count: number
}

const groupIntoThreads = (messages: Message[]): ThreadGroup[] => {
  const map = new Map<string, Message[]>()
  for (const msg of messages) {
    const key = normalizeSubject(msg.subject) || msg.uid
    const existing = map.get(key)
    if (existing) existing.push(msg)
    else map.set(key, [msg])
  }
  const threads: ThreadGroup[] = []
  for (const [key, msgs] of Array.from(map.entries())) {
    const sorted = [...msgs].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    threads.push({
      key,
      subject: displaySubject(sorted[0].subject),
      messages: sorted,
      lastMessage: sorted[0],
      hasUnread: sorted.some(m => !m.isRead),
      count: sorted.length,
    })
  }
  threads.sort((a, b) => new Date(b.lastMessage.date).getTime() - new Date(a.lastMessage.date).getTime())
  return threads
}

interface Props {
  folder: string
  selectedUid: string | null
  onSelect: (uid: string, accountId: string) => void
  onSelectThread: (messages: Message[], subject: string) => void
  activeAccountId?: string | null
  searchInputRef?: React.RefObject<HTMLInputElement>
}

export function MessageList({ folder, onSelect, onSelectThread, activeAccountId, searchInputRef }: Props) {
  const t = useTranslations('mail')
  const [filter, setFilter] = useState<'all' | 'unread'>('all')
  const [page, setPage] = useState(1)
  const [accumulated, setAccumulated] = useState<Message[]>([])
  const [readUids, setReadUids] = useState<Set<string>>(new Set())
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [selectedThreadKey, setSelectedThreadKey] = useState<string | null>(null)

  // Bulk selection
  const [checkedUids, setCheckedUids] = useState<Set<string>>(new Set())
  const [showMoveMenu, setShowMoveMenu] = useState(false)
  const moveMenuRef = useRef<HTMLDivElement>(null)

  // Context menu
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)

  // Drag state
  const [draggingUid, setDraggingUid] = useState<string | null>(null)

  const prevFolder = useRef(folder)
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  const internalSearchRef = useRef<HTMLInputElement>(null)
  const effectiveSearchRef = searchInputRef ?? internalSearchRef

  useEffect(() => {
    if (prevFolder.current !== folder) {
      prevFolder.current = folder
      setPage(1)
      setAccumulated([])
      setReadUids(new Set())
      setSearchQuery('')
      setDebouncedSearch('')
      setSelectedThreadKey(null)
      setCheckedUids(new Set())
    }
  }, [folder])

  useEffect(() => {
    if (searchTimeout.current) clearTimeout(searchTimeout.current)
    searchTimeout.current = setTimeout(() => setDebouncedSearch(searchQuery), 400)
    return () => { if (searchTimeout.current) clearTimeout(searchTimeout.current) }
  }, [searchQuery])

  // Close move menu when clicking outside
  useEffect(() => {
    if (!showMoveMenu) return
    const handler = (e: MouseEvent) => {
      if (moveMenuRef.current && !moveMenuRef.current.contains(e.target as Node)) setShowMoveMenu(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showMoveMenu])

  const accountParam = activeAccountId ? `&account=${activeAccountId}` : ''

  const { data, isValidating, mutate } = useSWR<{ messages: Message[]; total: number }>(
    debouncedSearch
      ? null
      : `/api/messages?folder=${encodeURIComponent(folder)}&filter=${filter}&page=${page}&perPage=30${accountParam}`,
    fetcher,
    { refreshInterval: 60000 }
  )

  const { data: searchData, isValidating: isSearching } = useSWR<{ messages: Message[] }>(
    debouncedSearch && debouncedSearch.length >= 2
      ? `/api/messages/search?q=${encodeURIComponent(debouncedSearch)}&folder=${encodeURIComponent(folder)}${accountParam}`
      : null,
    fetcher
  )

  // Folders for move menu / context menu — API returns { data: [...] }
  const { data: foldersResponse } = useSWR<{ data: Folder[] }>(
    (showMoveMenu || contextMenu) && activeAccountId
      ? `/api/folders?account=${activeAccountId}`
      : null,
    fetcher
  )
  const folders = foldersResponse?.data ?? []

  useEffect(() => {
    if (!data?.messages) return
    if (page === 1) {
      setAccumulated(data.messages)
    } else {
      setAccumulated(prev => {
        const existingUids = new Set(prev.map(m => m.uid))
        const newMsgs = data.messages.filter(m => !existingUids.has(m.uid))
        return [...prev, ...newMsgs]
      })
    }
  }, [data, page])

  const isSearchMode = debouncedSearch.length >= 2
  const messages = isSearchMode ? (searchData?.messages ?? []) : accumulated
  const total = data?.total ?? 0
  const loading = isSearchMode ? (!searchData && isSearching) : !data

  const threads = useMemo(() => groupIntoThreads(messages), [messages])

  const allVisibleUids = useMemo(() => threads.map(t => t.lastMessage.uid), [threads])
  const isAllChecked = allVisibleUids.length > 0 && allVisibleUids.every(uid => checkedUids.has(uid))
  const isIndeterminate = !isAllChecked && allVisibleUids.some(uid => checkedUids.has(uid))

  const toggleAll = () => {
    setCheckedUids(isAllChecked ? new Set() : new Set(allVisibleUids))
  }

  const toggleUid = (uid: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setCheckedUids(prev => {
      const next = new Set(prev)
      if (next.has(uid)) next.delete(uid)
      else next.add(uid)
      return next
    })
  }

  const clearSelection = () => setCheckedUids(new Set())

  const checkedThreadUids = useMemo(() => {
    const uids: string[] = []
    for (const thread of threads) {
      if (checkedUids.has(thread.lastMessage.uid)) {
        thread.messages.forEach(m => uids.push(m.uid))
      }
    }
    return uids
  }, [threads, checkedUids])

  const getAccountId = useCallback(() => {
    for (const thread of threads) {
      if (checkedUids.has(thread.lastMessage.uid)) {
        return thread.lastMessage.accountId || activeAccountId || ''
      }
    }
    return activeAccountId || ''
  }, [threads, checkedUids, activeAccountId])

  // Bulk + single message API actions
  const apiMarkRead = async (uid: string, accountId: string, read: boolean) => {
    await fetch(`/api/messages/${uid}?account=${accountId}&folder=${encodeURIComponent(folder)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isRead: read }),
    })
    setAccumulated(prev => prev.map(m => m.uid === uid ? { ...m, isRead: read } : m))
    mutate()
  }

  const apiStar = async (uid: string, accountId: string, starred: boolean) => {
    await fetch(`/api/messages/${uid}?account=${accountId}&folder=${encodeURIComponent(folder)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isStarred: starred }),
    })
    setAccumulated(prev => prev.map(m => m.uid === uid ? { ...m, isStarred: starred } : m))
  }

  const apiMove = async (uid: string, accountId: string, destination: string) => {
    await fetch('/api/messages/bulk', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uids: [uid], action: 'move', accountId, folder, destination }),
    })
    setAccumulated(prev => prev.filter(m => m.uid !== uid))
    mutate()
  }

  const apiDelete = async (uid: string, accountId: string) => {
    await fetch(`/api/messages/${uid}?account=${accountId}&folder=${encodeURIComponent(folder)}`, {
      method: 'DELETE',
    })
    setAccumulated(prev => prev.filter(m => m.uid !== uid))
    mutate()
  }

  const bulkMarkRead = async (read: boolean) => {
    const accId = getAccountId()
    await fetch('/api/messages/bulk', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uids: checkedThreadUids, action: read ? 'read' : 'unread', accountId: accId, folder }),
    })
    setAccumulated(prev => prev.map(m => checkedThreadUids.includes(m.uid) ? { ...m, isRead: read } : m))
    clearSelection()
    mutate()
  }

  const bulkDelete = async () => {
    const accId = getAccountId()
    await fetch('/api/messages/bulk', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uids: checkedThreadUids, accountId: accId, folder }),
    })
    setAccumulated(prev => prev.filter(m => !checkedThreadUids.includes(m.uid)))
    clearSelection()
    mutate()
  }

  const bulkMove = async (destination: string) => {
    const accId = getAccountId()
    await fetch('/api/messages/bulk', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uids: checkedThreadUids, action: 'move', accountId: accId, folder, destination }),
    })
    setAccumulated(prev => prev.filter(m => !checkedThreadUids.includes(m.uid)))
    clearSelection()
    setShowMoveMenu(false)
    mutate()
  }

  // Drag handlers
  const handleDragStart = useCallback((e: React.DragEvent, thread: ThreadGroup) => {
    const msg = thread.lastMessage
    const accId = msg.accountId || activeAccountId || ''
    // If dragging a checked thread, carry all checked ones
    const uidsToMove = checkedUids.has(msg.uid) ? checkedThreadUids : thread.messages.map(m => m.uid)
    e.dataTransfer.setData('application/synapmail', JSON.stringify({
      uids: uidsToMove,
      accountId: accId,
      folder,
    }))
    e.dataTransfer.effectAllowed = 'move'
    setDraggingUid(msg.uid)
  }, [checkedUids, checkedThreadUids, activeAccountId, folder])

  const handleDragEnd = useCallback(() => setDraggingUid(null), [])

  const handleSelectThread = (thread: ThreadGroup) => {
    if (checkedUids.size > 0) {
      const uid = thread.lastMessage.uid
      setCheckedUids(prev => {
        const next = new Set(prev)
        if (next.has(uid)) next.delete(uid)
        else next.add(uid)
        return next
      })
      return
    }
    setSelectedThreadKey(thread.key)
    thread.messages.forEach(msg => {
      if (!msg.isRead && !readUids.has(msg.uid)) {
        setReadUids(prev => new Set(prev).add(msg.uid))
      }
    })
    if (thread.count === 1) {
      onSelect(thread.lastMessage.uid, thread.lastMessage.accountId)
    } else {
      onSelectThread(thread.messages, thread.subject)
    }
  }

  const handleContextMenu = (e: React.MouseEvent, thread: ThreadGroup) => {
    e.preventDefault()
    const msg = thread.lastMessage
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      uid: msg.uid,
      accountId: msg.accountId || activeAccountId || '',
      isRead: msg.isRead || readUids.has(msg.uid),
      isStarred: msg.isStarred,
      folderPath: folder,
    })
  }

  const handleRefresh = () => { setPage(1); setAccumulated([]); mutate() }
  const clearSearch = () => { setSearchQuery(''); setDebouncedSearch('') }
  const hasSelection = checkedUids.size > 0

  return (
    <div className="flex flex-col h-full bg-background border-r border-border">
      {/* Search bar */}
      <div className="px-3 pt-3 pb-2 shrink-0">
        <div className="relative flex items-center">
          <Search className="absolute left-2.5 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <input
            ref={effectiveSearchRef}
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Rechercher…"
            className="w-full h-8 pl-8 pr-8 text-xs rounded-lg border border-border bg-muted/50 placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
          {searchQuery && (
            <button onClick={clearSearch} className="absolute right-2 text-muted-foreground hover:text-foreground">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Toolbar */}
      {hasSelection ? (
        <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border shrink-0 bg-primary/5">
          <button
            onClick={toggleAll}
            className="w-7 h-7 flex items-center justify-center rounded text-primary hover:bg-primary/10 transition-colors"
            title={isAllChecked ? 'Tout désélectionner' : 'Tout sélectionner'}
          >
            {isAllChecked
              ? <CheckSquare className="w-4 h-4" />
              : isIndeterminate
                ? <Square className="w-4 h-4 opacity-60" />
                : <CheckSquare className="w-4 h-4" />
            }
          </button>
          <span className="text-xs text-primary font-medium mr-1">{checkedUids.size}</span>
          <div className="flex-1" />
          <button onClick={() => bulkMarkRead(true)} title={t('markRead')} className="w-7 h-7 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
            <MailOpen className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => bulkMarkRead(false)} title={t('markUnread')} className="w-7 h-7 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
            <Mail className="w-3.5 h-3.5" />
          </button>
          <div className="relative" ref={moveMenuRef}>
            <button onClick={() => setShowMoveMenu(v => !v)} title={t('move')} className="w-7 h-7 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
              <MoveRight className="w-3.5 h-3.5" />
              <ChevronDown className="w-2.5 h-2.5 -ml-0.5" />
            </button>
            {showMoveMenu && (
              <div className="absolute right-0 top-8 z-50 min-w-[180px] max-h-64 overflow-y-auto bg-popover border border-border rounded-lg shadow-lg py-1">
                {!foldersResponse && <p className="px-3 py-2 text-xs text-muted-foreground">Chargement…</p>}
                {folders.map(f => (
                  <button key={f.path} onClick={() => bulkMove(f.path)} className="w-full text-left px-3 py-1.5 text-xs text-foreground hover:bg-accent transition-colors truncate">
                    {f.name}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button onClick={bulkDelete} title={t('delete')} className="w-7 h-7 flex items-center justify-center rounded text-destructive hover:bg-destructive/10 transition-colors">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
          <button onClick={clearSelection} className="w-7 h-7 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors" title="Annuler la sélection">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : !isSearchMode ? (
        <div className="flex items-center gap-2 px-4 py-2 border-b border-border shrink-0">
          <div className="flex rounded-lg overflow-hidden border border-border text-xs font-medium">
            {(['all', 'unread'] as const).map(f => (
              <button key={f} onClick={() => { setFilter(f); setPage(1); setAccumulated([]) }}
                className={cn('px-3 py-1.5 transition-colors', filter === f ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-accent')}>
                {t(f)}
              </button>
            ))}
          </div>
          <div className="flex-1" />
          <button onClick={handleRefresh} disabled={isValidating} className="w-7 h-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
            <RefreshCw className={cn('w-3.5 h-3.5', isValidating && 'animate-spin')} />
          </button>
        </div>
      ) : (
        <div className="px-4 py-2 border-b border-border shrink-0">
          <p className="text-xs text-muted-foreground">
            {isSearching ? 'Recherche…' : `${messages.length} résultat${messages.length !== 1 ? 's' : ''} pour « ${debouncedSearch} »`}
          </p>
        </div>
      )}

      {/* Thread List */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="space-y-0">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="flex gap-3 px-4 py-3 border-b border-border/50">
                <div className="w-9 h-9 rounded-full bg-muted animate-pulse shrink-0" />
                <div className="flex-1 space-y-2 pt-0.5">
                  <div className="h-3.5 bg-muted animate-pulse rounded-full w-32" />
                  <div className="h-3 bg-muted animate-pulse rounded-full w-full" />
                  <div className="h-3 bg-muted animate-pulse rounded-full w-3/4" />
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && threads.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
            <div className="w-14 h-14 rounded-2xl bg-muted flex items-center justify-center mb-3">
              <Search className="w-6 h-6 opacity-30" />
            </div>
            <p className="text-sm font-medium">{isSearchMode ? 'Aucun résultat' : t('noMessages')}</p>
          </div>
        )}

        {threads.map(thread => {
          const { lastMessage: msg, hasUnread, count } = thread
          const isRead = !hasUnread || readUids.has(msg.uid)
          const isSelected = selectedThreadKey === thread.key
          const isChecked = checkedUids.has(msg.uid)
          const isDragging = draggingUid === msg.uid
          const initial = (msg.from.name || msg.from.address)[0]?.toUpperCase() ?? '?'
          const avatarColor = getAvatarColor(msg.from.address)

          return (
            <div
              key={thread.key}
              draggable
              onDragStart={e => handleDragStart(e, thread)}
              onDragEnd={handleDragEnd}
              onContextMenu={e => handleContextMenu(e, thread)}
              className={cn(
                'w-full text-left flex gap-3 px-4 py-3 border-b border-border/40 transition-colors duration-150 border-l-[3px] cursor-pointer select-none',
                isDragging && 'opacity-40',
                isChecked ? 'bg-primary/10 border-l-primary'
                  : isSelected ? 'bg-primary/10 border-l-primary'
                  : !isRead ? 'border-l-primary hover:bg-muted/50 bg-blue-50/60 dark:bg-blue-950/20'
                  : 'border-l-transparent hover:bg-muted/50'
              )}
              onClick={() => handleSelectThread(thread)}
            >
              {/* Avatar / Checkbox */}
              <div className="relative shrink-0 group/avatar" onClick={e => toggleUid(msg.uid, e)}>
                {isChecked ? (
                  <div className="w-9 h-9 rounded-full flex items-center justify-center bg-primary/10 text-primary">
                    <CheckSquare className="w-4.5 h-4.5" />
                  </div>
                ) : (
                  <>
                    <div className={cn('w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-semibold group-hover/avatar:opacity-0 transition-opacity', avatarColor)}>
                      {initial}
                    </div>
                    <div className="absolute inset-0 w-9 h-9 rounded-full flex items-center justify-center bg-muted/60 opacity-0 group-hover/avatar:opacity-100 transition-opacity">
                      <Square className="w-4 h-4 text-muted-foreground" />
                    </div>
                  </>
                )}
                {count > 1 && !isChecked && (
                  <span className="absolute -bottom-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-white text-[10px] font-bold flex items-center justify-center leading-none shadow-sm">
                    {count}
                  </span>
                )}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-baseline justify-between gap-2 mb-0.5">
                  <span className={cn('text-sm truncate', !isRead ? 'font-semibold text-foreground' : 'font-medium text-muted-foreground')}>
                    {count > 1
                      ? thread.messages.map(m => m.from.name || m.from.address.split('@')[0]).filter((v, i, a) => a.indexOf(v) === i).slice(0, 3).join(', ')
                      : (msg.from.name || msg.from.address)
                    }
                  </span>
                  <div className="flex items-center gap-1 shrink-0">
                    {thread.messages.some(m => m.hasAttachments) && <Paperclip className="w-3 h-3 text-muted-foreground" />}
                    <span className={cn('text-xs tabular-nums', !isRead ? 'text-primary font-medium' : 'text-muted-foreground')}>
                      {formatDate(msg.date)}
                    </span>
                  </div>
                </div>
                <div className={cn('text-xs truncate mb-0.5', !isRead ? 'font-semibold text-foreground' : 'text-foreground/70')}>
                  {thread.subject}
                </div>
                <div className="text-[11px] text-muted-foreground truncate leading-relaxed">{msg.preview}</div>
              </div>
            </div>
          )
        })}

        {!isSearchMode && messages.length > 0 && messages.length < total && (
          <button onClick={() => setPage(p => p + 1)} disabled={isValidating} className="w-full py-3 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors">
            {isValidating ? 'Chargement…' : `Charger plus (${total - messages.length} restants)`}
          </button>
        )}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <MessageContextMenu
          menu={contextMenu}
          folders={folders}
          onClose={() => setContextMenu(null)}
          onMarkRead={apiMarkRead}
          onStar={apiStar}
          onMove={apiMove}
          onDelete={apiDelete}
        />
      )}
    </div>
  )
}
