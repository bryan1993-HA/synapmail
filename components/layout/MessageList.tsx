'use client'

import { useState, useRef, useEffect, useMemo } from 'react'
import { useTranslations } from 'next-intl'
import { RefreshCw, Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import useSWR from 'swr'
import type { Message } from '@/types/email'

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

// Strip Re:/Fwd: prefixes recursively, return normalized key (lowercase, trimmed)
const normalizeSubject = (subject: string): string => {
  let prev = ''
  let s = subject.trim()
  while (s !== prev) {
    prev = s
    s = s.replace(/^(Re|Rép|Fwd|Fw|TR|AW|SV|VS):\s*/gi, '').trim()
  }
  return s.toLowerCase()
}

// Display subject: strip prefixes but keep original casing
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
  key: string            // normalized subject (lowercase)
  subject: string        // cleaned display subject
  messages: Message[]    // all messages in thread (sorted newest first)
  lastMessage: Message   // most recent message
  hasUnread: boolean
  count: number
}

const groupIntoThreads = (messages: Message[]): ThreadGroup[] => {
  const map = new Map<string, Message[]>()

  for (const msg of messages) {
    const key = normalizeSubject(msg.subject) || msg.uid
    const existing = map.get(key)
    if (existing) {
      existing.push(msg)
    } else {
      map.set(key, [msg])
    }
  }

  const threads: ThreadGroup[] = []
  for (const [key, msgs] of Array.from(map.entries())) {
    // Sort messages newest first within thread
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

  // Sort threads by last message date descending
  threads.sort((a, b) => new Date(b.lastMessage.date).getTime() - new Date(a.lastMessage.date).getTime())
  return threads
}

interface Props {
  folder: string
  selectedUid: string | null
  onSelect: (uid: string, accountId: string) => void
  onSelectThread: (messages: Message[], subject: string) => void
  activeAccountId?: string | null
}

export function MessageList({ folder, onSelect, onSelectThread, activeAccountId }: Props) {
  const t = useTranslations('mail')
  const [filter, setFilter] = useState<'all' | 'unread'>('all')
  const [page, setPage] = useState(1)
  const [accumulated, setAccumulated] = useState<Message[]>([])
  const [readUids, setReadUids] = useState<Set<string>>(new Set())
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [selectedThreadKey, setSelectedThreadKey] = useState<string | null>(null)
  const prevFolder = useRef(folder)
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (prevFolder.current !== folder) {
      prevFolder.current = folder
      setPage(1)
      setAccumulated([])
      setReadUids(new Set())
      setSearchQuery('')
      setDebouncedSearch('')
      setSelectedThreadKey(null)
    }
  }, [folder])

  // Debounce search
  useEffect(() => {
    if (searchTimeout.current) clearTimeout(searchTimeout.current)
    searchTimeout.current = setTimeout(() => {
      setDebouncedSearch(searchQuery)
    }, 400)
    return () => {
      if (searchTimeout.current) clearTimeout(searchTimeout.current)
    }
  }, [searchQuery])

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

  // Group messages into threads
  const threads = useMemo(() => groupIntoThreads(messages), [messages])

  const handleSelectThread = (thread: ThreadGroup) => {
    setSelectedThreadKey(thread.key)

    // Mark all messages in thread as locally read
    thread.messages.forEach(msg => {
      if (!msg.isRead && !readUids.has(msg.uid)) {
        setReadUids(prev => new Set(prev).add(msg.uid))
      }
    })

    if (thread.count === 1) {
      // Single message — open directly in ReadingPane
      const msg = thread.lastMessage
      onSelect(msg.uid, msg.accountId)
    } else {
      // Multiple messages — open thread view
      onSelectThread(thread.messages, thread.subject)
    }
  }

  const handleRefresh = () => {
    setPage(1)
    setAccumulated([])
    mutate()
  }

  const clearSearch = () => {
    setSearchQuery('')
    setDebouncedSearch('')
  }

  return (
    <div className="flex flex-col h-full bg-background border-r border-border">
      {/* Search bar */}
      <div className="px-3 pt-3 pb-2 shrink-0">
        <div className="relative flex items-center">
          <Search className="absolute left-2.5 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Rechercher…"
            className="w-full h-8 pl-8 pr-8 text-xs rounded-lg border border-border bg-muted/50 placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
          {searchQuery && (
            <button
              onClick={clearSearch}
              className="absolute right-2 text-muted-foreground hover:text-foreground"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Toolbar */}
      {!isSearchMode && (
        <div className="flex items-center gap-2 px-4 py-2 border-b border-border shrink-0">
          <div className="flex rounded-lg overflow-hidden border border-border text-xs font-medium">
            {(['all', 'unread'] as const).map(f => (
              <button
                key={f}
                onClick={() => { setFilter(f); setPage(1); setAccumulated([]) }}
                className={cn(
                  'px-3 py-1.5 transition-colors',
                  filter === f ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                )}
              >
                {t(f)}
              </button>
            ))}
          </div>
          <div className="flex-1" />
          <button
            onClick={handleRefresh}
            disabled={isValidating}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <RefreshCw className={cn('w-3.5 h-3.5', isValidating && 'animate-spin')} />
          </button>
        </div>
      )}

      {isSearchMode && (
        <div className="px-4 py-2 border-b border-border shrink-0">
          <p className="text-xs text-muted-foreground">
            {isSearching
              ? 'Recherche…'
              : `${messages.length} résultat${messages.length !== 1 ? 's' : ''} pour « ${debouncedSearch} »`
            }
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
            <p className="text-sm font-medium">
              {isSearchMode ? 'Aucun résultat' : t('noMessages')}
            </p>
          </div>
        )}

        {threads.map(thread => {
          const { lastMessage: msg, hasUnread, count } = thread
          const isRead = !hasUnread || readUids.has(msg.uid)
          const isSelected = selectedThreadKey === thread.key
          const initial = (msg.from.name || msg.from.address)[0]?.toUpperCase() ?? '?'
          const avatarColor = getAvatarColor(msg.from.address)

          return (
            <button
              key={thread.key}
              onClick={() => handleSelectThread(thread)}
              className={cn(
                'w-full text-left flex gap-3 px-4 py-3 border-b border-border/40 transition-all border-l-2',
                isSelected
                  ? 'bg-primary/8 border-l-primary'
                  : cn('border-l-transparent hover:bg-muted/50', !isRead && 'bg-blue-50/50 dark:bg-blue-950/20')
              )}
            >
              {/* Avatar */}
              <div className="relative shrink-0">
                <div className={cn('w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-semibold shadow-sm', avatarColor)}>
                  {initial}
                </div>
                {count > 1 && (
                  <span className="absolute -bottom-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-muted border border-border text-[10px] font-semibold text-foreground flex items-center justify-center leading-none">
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
                  <span className={cn('text-xs shrink-0', !isRead ? 'text-blue-500 font-medium' : 'text-muted-foreground')}>
                    {formatDate(msg.date)}
                  </span>
                </div>
                <div className={cn('text-xs truncate mb-0.5', !isRead ? 'font-semibold text-foreground' : 'text-foreground/70')}>
                  {thread.subject}
                </div>
                <div className="text-xs text-muted-foreground truncate">{msg.preview}</div>
              </div>

              {!isRead && (
                <div className="w-2 h-2 rounded-full bg-blue-500 shrink-0 mt-1.5 shadow-sm shadow-blue-500/50" />
              )}
            </button>
          )
        })}

        {!isSearchMode && messages.length > 0 && messages.length < total && (
          <button
            onClick={() => setPage(p => p + 1)}
            disabled={isValidating}
            className="w-full py-3 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
          >
            {isValidating ? 'Chargement…' : `Charger plus (${total - messages.length} restants)`}
          </button>
        )}
      </div>
    </div>
  )
}
