'use client'

import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { RefreshCw, Search, X, Paperclip, CheckSquare, Square, Trash2, Mail, MailOpen, MoveRight, ChevronDown, Eye, EyeOff, Archive, Clock } from 'lucide-react'
import { cn } from '@/lib/utils'
import useSWR from 'swr'
import type { Message, Folder, ReadReceipt } from '@/types/email'
import { MessageContextMenu, type ContextMenuState } from '@/components/ui/MessageContextMenu'
import { ScheduledPopover } from '@/components/mail/ScheduledPopover'
import { SnoozePopover } from '@/components/mail/SnoozePopover'
import { snoozePresets } from '@/lib/snooze-presets'

const fetcher = async (url: string) => {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Request failed: ${res.status}`)
  return res.json()
}

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

// ─── time bucketing (Direction B — grouped list) ──────────────────────────
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())

type DensityMode = 'comfortable' | 'compact'

interface Props {
  folder: string
  selectedUid: string | null
  onSelect: (uid: string, accountId: string) => void
  onSelectThread: (messages: Message[], subject: string) => void
  activeAccountId?: string | null
  searchInputRef?: React.RefObject<HTMLInputElement>
}

interface AppSettings { thread_view: boolean; messages_per_page: number }

export function MessageList({ folder, onSelect, onSelectThread, activeAccountId, searchInputRef }: Props) {
  const t = useTranslations('mail')
  const [filter, setFilter] = useState<'all' | 'unread'>('all')
  const [page, setPage] = useState(1)
  const [accumulated, setAccumulated] = useState<Message[]>([])
  const [refreshKey, setRefreshKey] = useState(0)
  const [readUids, setReadUids] = useState<Set<string>>(new Set())
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [selectedThreadKey, setSelectedThreadKey] = useState<string | null>(null)

  // Direction B — comfortable / compact density (per browser)
  const [density, setDensity] = useState<DensityMode>('comfortable')
  useEffect(() => {
    try {
      const stored = localStorage.getItem('synapmail:mailDensity')
      if (stored === 'compact' || stored === 'comfortable') setDensity(stored)
    } catch { /* ignore */ }
  }, [])
  const changeDensity = (mode: DensityMode) => {
    setDensity(mode)
    try { localStorage.setItem('synapmail:mailDensity', mode) } catch { /* ignore */ }
  }
  const compact = density === 'compact'

  // Bulk selection
  const [checkedUids, setCheckedUids] = useState<Set<string>>(new Set())
  const [showMoveMenu, setShowMoveMenu] = useState(false)
  const moveMenuRef = useRef<HTMLDivElement>(null)

  // Per-row snooze menu
  const [snoozeFor, setSnoozeFor] = useState<string | null>(null)
  const snoozeRef = useRef<HTMLDivElement>(null)

  // Context menu
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)

  // Drag state
  const [draggingUid, setDraggingUid] = useState<string | null>(null)

  // Infinite scroll — sentinel + observer replace the "load more" button
  const scrollRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const loadingLockRef = useRef(0) // last page auto-requested — prevents re-firing while in flight

  const prevListKey = useRef(`${folder}|${activeAccountId ?? ''}`)
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  const internalSearchRef = useRef<HTMLInputElement>(null)
  const effectiveSearchRef = searchInputRef ?? internalSearchRef

  useEffect(() => {
    const listKey = `${folder}|${activeAccountId ?? ''}`
    if (prevListKey.current !== listKey) {
      prevListKey.current = listKey
      setPage(1)
      setAccumulated([])
      loadingLockRef.current = 0
      setReadUids(new Set())
      setSearchQuery('')
      setDebouncedSearch('')
      setSelectedThreadKey(null)
      setCheckedUids(new Set())
      setSnoozeFor(null)
    }
  }, [folder, activeAccountId])

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

  // Close snooze menu when clicking outside / Escape
  useEffect(() => {
    if (!snoozeFor) return
    const onDoc = (e: MouseEvent) => {
      if (snoozeRef.current && !snoozeRef.current.contains(e.target as Node)) setSnoozeFor(null)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSnoozeFor(null) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [snoozeFor])

  const { data: settingsData } = useSWR<{ data: AppSettings }>('/api/settings', fetcher)
  const threadView = settingsData?.data?.thread_view ?? true
  const perPage = settingsData?.data?.messages_per_page ?? 30

  const accountParam = activeAccountId ? `&account=${activeAccountId}` : ''

  const isSentFolder = /sent/i.test(folder)

  const { data, error, isValidating, mutate } = useSWR<{ messages: Message[]; total: number }>(
    debouncedSearch
      ? null
      : `/api/messages?folder=${encodeURIComponent(folder)}&filter=${filter}&page=${page}&perPage=${perPage}${accountParam}`,
    fetcher,
    { refreshInterval: 60000 }
  )

  const { data: searchData, isValidating: isSearching } = useSWR<{ messages: Message[] }>(
    debouncedSearch && debouncedSearch.length >= 2
      ? `/api/messages/search?q=${encodeURIComponent(debouncedSearch)}&folder=${encodeURIComponent(folder)}${accountParam}`
      : null,
    fetcher
  )

  // Folders — needed for the move menu, the context menu AND the row "Archive"
  // quick action, so it is fetched whenever an account is active. The key is
  // identical to the Sidebar's, so SWR serves it from one shared fetch.
  const { data: foldersResponse } = useSWR<{ data: Folder[] }>(
    activeAccountId ? `/api/folders?account=${activeAccountId}` : null,
    fetcher
  )
  const folders = useMemo(() => foldersResponse?.data ?? [], [foldersResponse])
  // No RFC-6154 flag survives /api/folders, so fall back to name/path matching.
  const archivePath = useMemo(
    () => folders.find(f => /archives?\b/i.test(f.name) || /archives?\b/i.test(f.path))?.path ?? null,
    [folders]
  )

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
  }, [data, page, refreshKey])

  const isSearchMode = debouncedSearch.length >= 2
  const messages = isSearchMode ? (searchData?.messages ?? []) : accumulated
  const total = data?.total ?? 0
  const loadError = !isSearchMode && !!error && accumulated.length === 0
  const loading = isSearchMode ? (!searchData && isSearching) : (!data && !error)

  // Infinite scroll — a failed page > 1 keeps the list but shows a retry button
  const morePageError = !isSearchMode && !!error && accumulated.length > 0
  const canLoadMore = !isSearchMode && !error && messages.length > 0 && messages.length < total

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!canLoadMore || !sentinel) return
    const io = new IntersectionObserver(
      entries => {
        if (entries[0]?.isIntersecting && !isValidating && loadingLockRef.current !== page) {
          loadingLockRef.current = page
          setPage(p => p + 1)
        }
      },
      { root: scrollRef.current, rootMargin: '600px 0px' }
    )
    io.observe(sentinel)
    return () => io.disconnect()
  }, [canLoadMore, isValidating, page])

  // Tracking status for Sent folder
  const sentSubjects = isSentFolder
    ? messages.map(m => m.subject).filter(Boolean).join('|||')
    : ''
  const trackingKey = isSentFolder && sentSubjects && activeAccountId
    ? `/api/track/status?accountId=${activeAccountId}&subjects=${encodeURIComponent(sentSubjects)}`
    : null
  const { data: trackingData } = useSWR<{ data: Record<string, ReadReceipt> }>(
    trackingKey,
    fetcher,
    { refreshInterval: 30000 }
  )
  const trackingMap = trackingData?.data ?? {}

  const threads = useMemo<ThreadGroup[]>(() => {
    if (!threadView) {
      return [...messages]
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
        .map(msg => ({
          key: msg.uid,
          subject: displaySubject(msg.subject),
          messages: [msg],
          lastMessage: msg,
          hasUnread: !msg.isRead,
          count: 1,
        }))
    }
    return groupIntoThreads(messages)
  }, [messages, threadView])

  // Direction B — bucket threads by recency for sticky date headers.
  const timeBucket = useCallback((iso: string): string => {
    const days = Math.round((startOfDay(new Date()).getTime() - startOfDay(new Date(iso)).getTime()) / 86_400_000)
    if (days <= 0) return t('grpToday')
    if (days === 1) return t('grpYesterday')
    if (days < 7) return t('grpThisWeek')
    if (days < 30) return t('grpThisMonth')
    return new Date(iso).toLocaleDateString([], { month: 'long', year: 'numeric' })
  }, [t])

  const groupedThreads = useMemo(() => {
    if (isSearchMode) return [{ label: null as string | null, items: threads }]
    const out: { label: string | null; items: ThreadGroup[] }[] = []
    for (const thread of threads) {
      const label = timeBucket(thread.lastMessage.date)
      const last = out[out.length - 1]
      if (last && last.label === label) last.items.push(thread)
      else out.push({ label, items: [thread] })
    }
    return out
  }, [threads, isSearchMode, timeBucket])

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

  // Single-message API actions
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

  // Direction B — row quick actions (top-right corner)
  const archiveThread = async (thread: ThreadGroup) => {
    if (!archivePath) return
    const accId = thread.lastMessage.accountId || activeAccountId || ''
    const uids = thread.messages.map(m => m.uid)
    await fetch('/api/messages/bulk', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uids, action: 'move', accountId: accId, folder, destination: archivePath }),
    })
    setAccumulated(prev => prev.filter(m => !uids.includes(m.uid)))
    mutate()
  }

  const markThreadRead = async (thread: ThreadGroup, read: boolean) => {
    const accId = thread.lastMessage.accountId || activeAccountId || ''
    const uids = thread.messages.map(m => m.uid)
    await fetch('/api/messages/bulk', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uids, action: read ? 'read' : 'unread', accountId: accId, folder }),
    })
    setAccumulated(prev => prev.map(m => uids.includes(m.uid) ? { ...m, isRead: read } : m))
    setReadUids(prev => {
      const next = new Set(prev)
      uids.forEach(u => read ? next.add(u) : next.delete(u))
      return next
    })
    mutate()
  }

  const snoozeThread = async (thread: ThreadGroup, until: Date) => {
    const msg = thread.lastMessage
    const accId = msg.accountId || activeAccountId || ''
    const uids = thread.messages.map(m => m.uid)
    await fetch(`/api/messages/${msg.uid}/snooze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        until: until.toISOString(),
        folder,
        accountId: accId,
        subject: msg.subject,
        fromAddress: msg.from.address,
        fromName: msg.from.name,
      }),
    })
    setSnoozeFor(null)
    setAccumulated(prev => prev.filter(m => !uids.includes(m.uid)))
    mutate()
    window.dispatchEvent(new CustomEvent('synapmail:snooze-changed'))
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

  const handleRefresh = () => { setPage(1); loadingLockRef.current = 0; setRefreshKey(k => k + 1); mutate() }
  const clearSearch = () => { setSearchQuery(''); setDebouncedSearch('') }
  const hasSelection = checkedUids.size > 0

  const renderRow = (thread: ThreadGroup) => {
    const { lastMessage: msg, hasUnread, count } = thread
    const isRead = !hasUnread || readUids.has(msg.uid)
    const isSelected = selectedThreadKey === thread.key
    const isChecked = checkedUids.has(msg.uid)
    const isDragging = draggingUid === msg.uid
    const initial = (msg.from.name || msg.from.address)[0]?.toUpperCase() ?? '?'
    const avatarColor = isRead ? 'bg-muted text-muted-foreground' : cn(getAvatarColor(msg.from.address), 'text-white')

    return (
      <div
        key={thread.key}
        draggable
        onDragStart={e => handleDragStart(e, thread)}
        onDragEnd={handleDragEnd}
        onContextMenu={e => handleContextMenu(e, thread)}
        className={cn(
          'group/row relative w-full text-left grid grid-cols-[auto_1fr] gap-3 border-b border-border/40 transition-colors duration-150 border-l-[3px] cursor-pointer select-none',
          compact ? 'px-3 py-2' : 'px-4 py-3',
          isDragging && 'opacity-40',
          isChecked ? 'bg-primary/10 border-l-primary'
            : isSelected ? 'bg-primary/10 border-l-primary'
            : !isRead ? 'border-l-primary hover:bg-muted/50 bg-blue-50/60 dark:bg-blue-950/20'
            : 'border-l-transparent hover:bg-muted/50'
        )}
        onClick={() => handleSelectThread(thread)}
      >
        {/* Avatar / Checkbox */}
        <div
          className={cn('relative shrink-0 group/avatar', compact ? 'w-7 h-7' : 'w-9 h-9')}
          onClick={e => toggleUid(msg.uid, e)}
        >
          {isChecked ? (
            <div className="w-full h-full rounded-full flex items-center justify-center bg-primary/10 text-primary">
              <CheckSquare className="w-4 h-4" />
            </div>
          ) : (
            <>
              <div className={cn(
                'w-full h-full rounded-full flex items-center justify-center font-semibold group-hover/avatar:opacity-0 transition-opacity',
                compact ? 'text-xs' : 'text-sm',
                avatarColor,
              )}>
                {initial}
              </div>
              <div className="absolute inset-0 rounded-full flex items-center justify-center bg-muted/60 opacity-0 group-hover/avatar:opacity-100 transition-opacity">
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

        <div className="min-w-0">
          {/* line 1 — sender + date, right padding reserves the corner-action strip */}
          <div className={cn('flex items-baseline justify-between gap-2', archivePath ? 'pr-[104px]' : 'pr-[80px]', compact ? '' : 'mb-0.5')}>
            <span className={cn('text-sm truncate', !isRead ? 'font-semibold text-foreground' : 'font-medium text-muted-foreground')}>
              {count > 1
                ? thread.messages.map(m => m.from.name || m.from.address.split('@')[0]).filter((v, i, a) => a.indexOf(v) === i).slice(0, 3).join(', ')
                : (msg.from.name || msg.from.address)
              }
            </span>
            <div className="flex items-center gap-1 shrink-0">
              {thread.messages.some(m => m.hasAttachments) && <Paperclip className="w-3 h-3 text-muted-foreground" />}
              {isSentFolder && (() => {
                const receipt = trackingMap[msg.subject]
                if (!receipt) return null
                return receipt.opened ? (
                  <span title={receipt.openedAt ? `Lu le ${new Date(receipt.openedAt).toLocaleString()}` : 'Lu'}>
                    <Eye className="w-3 h-3 text-emerald-500" />
                  </span>
                ) : (
                  <span title="Non ouvert"><EyeOff className="w-3 h-3 text-muted-foreground/50" /></span>
                )
              })()}
              <span className={cn('text-xs tabular-nums', !isRead ? 'text-primary font-medium' : 'text-muted-foreground')}>
                {formatDate(msg.date)}
              </span>
            </div>
          </div>

          {/* line 2 — subject (full width) */}
          <div className={cn('text-xs truncate', !isRead ? 'font-semibold text-foreground' : 'text-foreground/60', compact ? '' : 'mb-0.5')}>
            {thread.subject}
          </div>

          {/* line 3 — preview (hidden in compact) */}
          {!compact && (
            <div className={cn('text-[11px] truncate leading-relaxed', isRead ? 'text-muted-foreground/70' : 'text-muted-foreground')}>
              {msg.preview}
            </div>
          )}
        </div>

        {/* corner actions — always visible, out of the text flow */}
        <div className="absolute top-1.5 right-2 flex items-center gap-0.5" onClick={e => e.stopPropagation()}>
          {archivePath && (
            <button
              onClick={() => archiveThread(thread)}
              title={t('archiveAction')}
              className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              <Archive className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={() => markThreadRead(thread, !isRead)}
            title={isRead ? t('markUnread') : t('markDone')}
            className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            {isRead ? <Mail className="w-3.5 h-3.5" /> : <MailOpen className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={() => apiDelete(msg.uid, msg.accountId || activeAccountId || '')}
            title={t('delete')}
            className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
          <div className="relative" ref={snoozeFor === thread.key ? snoozeRef : undefined}>
            <button
              onClick={() => setSnoozeFor(snoozeFor === thread.key ? null : thread.key)}
              title={t('snooze')}
              className={cn(
                'w-6 h-6 flex items-center justify-center rounded transition-colors',
                snoozeFor === thread.key ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:text-foreground hover:bg-accent',
              )}
            >
              <Clock className="w-3.5 h-3.5" />
            </button>
            {snoozeFor === thread.key && (
              <div className="absolute right-0 top-7 z-50 w-44 bg-popover border border-border rounded-lg shadow-xl py-1">
                {snoozePresets().map(p => (
                  <button
                    key={p.key}
                    onClick={() => snoozeThread(thread, p.date)}
                    className="w-full flex items-center justify-between gap-2 px-3 py-1.5 text-xs text-foreground hover:bg-accent transition-colors"
                  >
                    <span>{t(p.key)}</span>
                    <span className="text-[10px] text-muted-foreground tabular-nums">
                      {p.date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

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
        <div className="flex flex-wrap items-center gap-1.5 px-3 py-2 border-b border-border shrink-0 bg-primary/5">
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
          <button onClick={() => bulkMarkRead(true)} title={t('markRead')} className="ml-auto w-7 h-7 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
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
        <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-border shrink-0">
          <div className="flex rounded-lg overflow-hidden border border-border text-xs font-medium">
            {(['all', 'unread'] as const).map(f => (
              <button key={f} onClick={() => { setFilter(f); setPage(1); setAccumulated([]); loadingLockRef.current = 0 }}
                className={cn('px-3 py-1.5 transition-colors', filter === f ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-accent')}>
                {t(f)}
              </button>
            ))}
          </div>
          <div className="flex rounded-lg overflow-hidden border border-border text-xs font-medium">
            {(['comfortable', 'compact'] as const).map(d => (
              <button key={d} onClick={() => changeDensity(d)}
                title={d === 'comfortable' ? t('densityComfortable') : t('densityCompact')}
                className={cn('px-2.5 py-1.5 transition-colors', density === d ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-accent')}>
                {d === 'comfortable' ? t('densityComfortable') : t('densityCompact')}
              </button>
            ))}
          </div>
          <button onClick={handleRefresh} disabled={isValidating} className="ml-auto w-7 h-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
            <RefreshCw className={cn('w-3.5 h-3.5', isValidating && 'animate-spin')} />
          </button>
          <ScheduledPopover />
          <SnoozePopover activeAccountId={activeAccountId} />
        </div>
      ) : (
        <div className="px-4 py-2 border-b border-border shrink-0">
          <p className="text-xs text-muted-foreground">
            {isSearching ? 'Recherche…' : `${messages.length} résultat${messages.length !== 1 ? 's' : ''} pour « ${debouncedSearch} »`}
          </p>
        </div>
      )}

      {/* Thread List */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
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

        {!loading && loadError && (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground px-6 text-center">
            <div className="w-14 h-14 rounded-2xl bg-destructive/10 flex items-center justify-center mb-3">
              <RefreshCw className="w-6 h-6 text-destructive/60" />
            </div>
            <p className="text-sm font-medium text-foreground">{t('loadError')}</p>
            <p className="text-xs mt-1 mb-4 max-w-xs">{t('loadErrorDesc')}</p>
            <button
              onClick={() => mutate()}
              className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:opacity-90 transition-opacity"
            >
              {t('retry')}
            </button>
          </div>
        )}

        {!loading && !loadError && threads.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
            <div className="w-14 h-14 rounded-2xl bg-muted flex items-center justify-center mb-3">
              <Search className="w-6 h-6 opacity-30" />
            </div>
            <p className="text-sm font-medium">{isSearchMode ? 'Aucun résultat' : t('noMessages')}</p>
          </div>
        )}

        {groupedThreads.map((group, gi) => (
          <div key={group.label ?? `g${gi}`}>
            {group.label && (
              <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm px-4 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground border-b border-border/40">
                {group.label}
              </div>
            )}
            {group.items.map(renderRow)}
          </div>
        ))}

        {!isSearchMode && messages.length > 0 && (
          messages.length < total ? (
            <div ref={sentinelRef} className="px-4 py-4">
              {morePageError ? (
                <button
                  onClick={() => { loadingLockRef.current = 0; mutate() }}
                  className="w-full py-2 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:opacity-90 transition-opacity"
                >
                  {t('retry')}
                </button>
              ) : (
                <button
                  onClick={() => setPage(p => p + 1)}
                  disabled={isValidating}
                  className="w-full flex items-center justify-center gap-2 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  {isValidating ? (
                    <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> {t('loadingMore')}</>
                  ) : (
                    t('messagesRemaining', { count: total - messages.length })
                  )}
                </button>
              )}
            </div>
          ) : (
            <div className="py-4 text-center text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">
              {t('endOfList')}
            </div>
          )
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
