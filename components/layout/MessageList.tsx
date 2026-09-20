'use client'

import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { RefreshCw, Search, X, Paperclip, CheckSquare, Square, Eye, EyeOff, Flag, Info } from 'lucide-react'
import { MAIL_SELECTION_COUNT_ATTR, useMailSelection } from '@/lib/mailSelection'
import { MAIL_ORIGIN_ATTR, groupByOrigin, originKey, type MessageOrigin } from '@/lib/mailOrigin'
import { DEFAULT_FLAG_KEY, MAIL_LIST_FILTERS, flagByKey, type MailListFilter } from '@/lib/flags'
import { cn } from '@/lib/utils'
import { formatRowDate } from '@/lib/dates'
import {
  EMPTY_SEARCH_STREAM, SCOPE_ALL, SCOPE_FOLDER, SCOPE_PARAM, SEARCH_PARAM, STREAM_PARAM,
  accumulateSearchStream, isSearchQuery, parseNdjsonChunk,
  type SearchField, type SearchScope, type SearchStreamChunk, type SearchStreamState,
} from '@/lib/search'
import useSWR, { mutate as globalMutate } from 'swr'
import type { Message, Folder, ReadReceipt } from '@/types/email'
import type { EmailAccount } from '@/types/account'
import { MessageContextMenu, type ContextMenuState } from '@/components/ui/MessageContextMenu'
import { IconTooltip } from '@/components/ui/IconTooltip'
import { ThinScroll } from './ThinScroll'
import { ScheduledPopover } from '@/components/mail/ScheduledPopover'
import { SnoozePopover } from '@/components/mail/SnoozePopover'

const fetcher = async (url: string) => {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Request failed: ${res.status}`)
  return res.json()
}

// Marquee selection. Below this threshold, the gesture stays a click:
// it is also the threshold the system file explorer uses.
const MARQUEE_MIN_PX = 4
// Sensitive band along the container edges, step and rate of the automatic
// scrolling during the gesture: measured by hand on the bench, slow enough to
// stay aimable, brisk enough to cross a page.
const MARQUEE_EDGE_PX = 40
const MARQUEE_SCROLL_PX = 24
const MARQUEE_SCROLL_MS = 50

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

// Account-sharing permissions (defense-in-depth UX gating — the real
// enforcement lives server-side, see lib/accountAccess.ts). Owned accounts
// never carry a `permissions` object, so this fallback is fully permissive.
type MailPermissions = NonNullable<EmailAccount['permissions']>
const DEFAULT_PERMISSIONS: MailPermissions = {
  canSend: true, canDelete: true, canOrganize: true, canManageRules: true, canManageSignatures: true,
}

interface Props {
  folder: string
  /** Open message, with ITS origin: a uid alone would designate several messages. */
  selectedOrigin: MessageOrigin | null
  onSelect: (origin: MessageOrigin) => void
  onSelectThread: (messages: Message[], subject: string) => void
  activeAccountId?: string | null
  /** Current search, carried by the mailbox URL and driven by the app bar. */
  search?: string
  searchScope?: SearchScope
  permissions?: MailPermissions
}

interface AppSettings {
  thread_view: boolean; messages_per_page: number; mail_density: DensityMode
  /** Displayed mailbox, as stored: what tells whether the received account is the right one. */
  active_account_id: string | null
}

export function MessageList({ folder, selectedOrigin, onSelect, onSelectThread, activeAccountId, search = '', searchScope = SCOPE_FOLDER, permissions }: Props) {
  const perms = permissions ?? DEFAULT_PERMISSIONS
  const t = useTranslations('mail')
  const locale = useLocale()
  // Shared state: the list is the ONLY one to publish and to register actions.
  const { publish, register } = useMailSelection()
  const [filter, setFilter] = useState<MailListFilter>('all')
  const [page, setPage] = useState(1)
  const [accumulated, setAccumulated] = useState<Message[]>([])
  const [refreshKey, setRefreshKey] = useState(0)
  const [readUids, setReadUids] = useState<Set<string>>(new Set())
  const [selectedThreadKey, setSelectedThreadKey] = useState<string | null>(null)

  const { data: settingsData } = useSWR<{ data: AppSettings }>('/api/settings', fetcher)
  const threadView = settingsData?.data?.thread_view ?? true
  const perPage = settingsData?.data?.messages_per_page ?? 30

  // Direction B — comfortable / compact density
  const density = settingsData?.data?.mail_density ?? 'comfortable'
  const changeDensity = (mode: DensityMode) => {
    globalMutate('/api/settings', (curr: { data: Record<string, unknown> } | undefined) =>
      curr ? { data: { ...curr.data, mail_density: mode } } : curr, false)
    fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mail_density: mode }),
    }).then(() => globalMutate('/api/settings'))
  }
  const compact = density === 'compact'

  // Bulk selection
  const [checkedKeys, setCheckedKeys] = useState<Set<string>>(new Set())

  // Context menu
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)

  // Drag state
  const [draggingUid, setDraggingUid] = useState<string | null>(null)

  // Marquee selection: only the DRAWN state lives in the render;
  // the gesture itself (origin, previous selection, additive mode) stays in a
  // ref: it changes on every pixel and must not re-render anything.
  const [marquee, setMarquee] = useState<{ left: number; top: number; width: number; height: number } | null>(null)
  const marqueeRef = useRef<{
    startX: number; startY: number; startScroll: number
    /** Last known pointer position: this is what gives the DIRECTION. */
    lastX: number; lastY: number
    additive: boolean; before: Set<string>; armed: boolean
    /** Has a rectangle really been drawn? Armed is not enough: a plain click arms it too. */
    drew: boolean
  } | null>(null)

  // File-explorer style selection: the last clicked row is the anchor of a
  // Shift-click range. A ref is enough: it drives no render.
  const rangeAnchorKey = useRef<string | null>(null)

  // Infinite scroll — sentinel + observer replace the "load more" button
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const loadingLockRef = useRef(0) // last page auto-requested — prevents re-firing while in flight

  const prevListKey = useRef(`${folder}|${activeAccountId ?? ''}`)

  useEffect(() => {
    const listKey = `${folder}|${activeAccountId ?? ''}`
    if (prevListKey.current !== listKey) {
      prevListKey.current = listKey
      setPage(1)
      setAccumulated([])
      loadingLockRef.current = 0
      setReadUids(new Set())
      setSelectedThreadKey(null)
      setCheckedKeys(new Set())
      rangeAnchorKey.current = null
    }
  }, [folder, activeAccountId])


  const accountParam = activeAccountId ? `&account=${activeAccountId}` : ''

  const isSentFolder = /sent/i.test(folder)

  const isSearchMode = isSearchQuery(search)

  const { data, error, isValidating, mutate } = useSWR<{ messages: Message[]; total: number }>(
    isSearchMode
      ? null
      : `/api/messages?folder=${encodeURIComponent(folder)}&filter=${filter}&page=${page}&perPage=${perPage}${accountParam}`,
    fetcher,
    { refreshInterval: 60000 }
  )

  // `total` = real server-side matches, `fields` = queried fields:
  // the banner states them rather than retyping them (single source: lib/search.ts).
  // The "this folder" scope fits in one response: a single folder, nothing to spread out.
  const isStreamingScope = isSearchMode && searchScope === SCOPE_ALL
  // The active account arrives AFTER the first render, and in TWO stages: /api/accounts
  // gives the list, /api/settings says which one is displayed. As long as the settings
  // are missing, the received account is only a fallback on the DEFAULT mailbox: searching
  // there would sweep a different mailbox than the displayed one, would open IMAP connections
  // for nothing, and could briefly show results from the wrong account.
  // A SINGLE condition holds back both scopes, and the banner stays in its pending
  // state instead of announcing a definitive "0 results".
  //
  // The presence of the settings is NOT enough: a child's effects run BEFORE
  // the parent's, so the list would see the settings arrive one render before the
  // parent has applied the account they name. We therefore require AGREEMENT between the two
  // sources: the displayed account is indeed the one the settings name.
  const savedAccountId = settingsData?.data?.active_account_id
  const searchReady = isSearchMode && !!activeAccountId && !!settingsData?.data &&
    (!savedAccountId || savedAccountId === activeAccountId)
  const { data: searchData, isValidating: isSearchingOne } = useSWR<{ messages: Message[]; total: number; fields: SearchField[] }>(
    searchReady && !isStreamingScope
      ? `/api/messages/search?${SEARCH_PARAM}=${encodeURIComponent(search)}&folder=${encodeURIComponent(folder)}` +
        `&${SCOPE_PARAM}=${searchScope}${accountParam}`
      : null,
    fetcher
  )

  // The "all folders" scope: the response arrives folder by folder (NDJSON).
  // Results accumulate as they come, the progress is displayed, and
  // changing the query aborts the previous one instead of letting it run.
  const [streamed, setStreamed] = useState<SearchStreamState<Message>>(EMPTY_SEARCH_STREAM)
  const [streaming, setStreaming] = useState(false)
  const streamAbort = useRef<AbortController | null>(null)
  const stopStream = useCallback(() => { streamAbort.current?.abort() }, [])

  useEffect(() => {
    if (!isStreamingScope || !searchReady) { setStreamed(EMPTY_SEARCH_STREAM); return }
    const controller = new AbortController()
    streamAbort.current = controller
    setStreamed(EMPTY_SEARCH_STREAM)
    setStreaming(true)
    const url = `/api/messages/search?${SEARCH_PARAM}=${encodeURIComponent(search)}` +
      `&folder=${encodeURIComponent(folder)}&${SCOPE_PARAM}=${SCOPE_ALL}&${STREAM_PARAM}=1${accountParam}`
    // A stream read TO THE END has nothing left to abort: aborting it anyway
    // on unmount made the browser conclude `net::ERR_ABORTED` on a
    // response that was nonetheless complete: misleading in the network tools, and
    // indistinguishable from a real abort.
    let complete = false
    ;(async () => {
      try {
        const res = await fetch(url, { signal: controller.signal })
        const body = res.body
        if (!body) return
        const reader = body.getReader()
        const decoder = new TextDecoder()
        let pending = ''
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          const { items, pending: rest } =
            parseNdjsonChunk<SearchStreamChunk<Message> & { error?: string }>(pending, decoder.decode(value, { stream: true }))
          pending = rest
          if (items.length === 0) continue
          setStreamed(prev => accumulateSearchStream(prev, items))
        }
        complete = true
      } catch {
        // A deliberate abort is not a failure: the results already
        // received stay displayed, and the banner simply stops progressing.
      } finally {
        // ONLY the CURRENT search clears the flag. An aborted search
        // finishes AFTER the next one has started: without this test, its `finally`
        // cleared the progress of the running one: no more Stop button, no more
        // "N folders out of M", and a "0 results" presented as definitive.
        if (streamAbort.current === controller) setStreaming(false)
      }
    })()
    return () => { if (!complete) controller.abort() }
  }, [isStreamingScope, searchReady, search, folder, accountParam])

  // As long as the account is not resolved, the search is STILL starting up:
  // the banner says "Searching..." rather than asserting a result it does not have.
  const isSearching = isSearchMode && !searchReady
    ? true
    : (isStreamingScope ? streaming : isSearchingOne)

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
  // A result carries its IMAP PATH (e.g. "INBOX.Clients.2026"): the banner displays
  // the name already known from the folder list, and failing that the last segment:
  // the separator is server-specific, so it comes from the folder itself.
  const folderNames = useMemo(() => {
    const byPath = new Map<string, string>()
    const walk = (list: Folder[]) => list.forEach(f => {
      byPath.set(f.path, f.name)
      if (f.children?.length) walk(f.children)
    })
    walk(folders)
    return byPath
  }, [folders])
  const folderLabel = useCallback(
    (path: string) => folderNames.get(path) ?? path.split(/[/.]/).pop() ?? path,
    [folderNames]
  )

  const spamPath = useMemo(
    () => folders.find(f => /(spam|junk|ind[ée]sirable)/i.test(f.name) || /(spam|junk)/i.test(f.path))?.path ?? null,
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

  const searchMessages = isStreamingScope ? streamed.messages : (searchData?.messages ?? [])
  const messages = isSearchMode ? searchMessages : accumulated
  const total = data?.total ?? 0
  // The server may have found more than it returns (SEARCH_RESULT_LIMIT cap):
  // the banner then announces "first X of N" instead of implying N = X.
  const searchTotal = isStreamingScope ? streamed.total : (searchData?.total ?? messages.length)
  const searchTruncated = searchTotal > messages.length
  const showResultFolder = isSearchMode && searchScope === SCOPE_ALL
  const loadError = !isSearchMode && !!error && accumulated.length === 0
  const loading = isSearchMode ? (messages.length === 0 && isSearching) : (!data && !error)

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

  /**
   * The origin of a row: ITS account and ITS folder, not those of the screen. A
   * "all folders" search returns messages from several folders, and
   * a uid designates a message only within its own. Missing fields
   * fall back to the displayed context (outside search, they are identical).
   */
  const originOf = useCallback((msg: Message): MessageOrigin => ({
    accountId: msg.accountId || activeAccountId || '',
    folder: msg.folder || folder,
    uid: msg.uid,
  }), [activeAccountId, folder])

  const allVisibleKeys = useMemo(
    () => threads.map(t => originKey(originOf(t.lastMessage))),
    [threads, originOf]
  )
  const isAllChecked = allVisibleKeys.length > 0 && allVisibleKeys.every(key => checkedKeys.has(key))
  const isIndeterminate = !isAllChecked && allVisibleKeys.some(key => checkedKeys.has(key))

  const toggleAll = () => {
    setCheckedKeys(isAllChecked ? new Set() : new Set(allVisibleKeys))
  }

  const toggleChecked = (key: string) => {
    setCheckedKeys(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const toggleRow = (key: string, e: React.MouseEvent) => {
    e.stopPropagation()
    rangeAnchorKey.current = key
    toggleChecked(key)
  }

  /** Shift-click: range from the anchor, in displayed order. Without an anchor, the row alone. */
  const selectRangeTo = (key: string) => {
    const anchor = rangeAnchorKey.current
    const from = anchor ? allVisibleKeys.indexOf(anchor) : -1
    const to = allVisibleKeys.indexOf(key)
    if (to < 0) return
    if (from < 0) {
      rangeAnchorKey.current = key
      setCheckedKeys(new Set([key]))
      return
    }
    const [lo, hi] = from <= to ? [from, to] : [to, from]
    setCheckedKeys(new Set(allVisibleKeys.slice(lo, hi + 1)))
  }

  const clearSelection = () => {
    setCheckedKeys(new Set())
    rangeAnchorKey.current = null
  }

  /** The checked origins, thread by thread: a checked thread targets all its messages. */
  const checkedOrigins = useMemo(() => {
    const origins: MessageOrigin[] = []
    for (const thread of threads) {
      if (checkedKeys.has(originKey(originOf(thread.lastMessage)))) {
        thread.messages.forEach(m => origins.push(originOf(m)))
      }
    }
    return origins
  }, [threads, checkedKeys, originOf])

  /**
   * The primitives take the TARGETED ORIGINS: they group by (account,
   * folder) and send ONE bulk request per group, with ITS folder. The
   * DISPLAYED folder no longer enters any request: it was what made
   * actions fire on the wrong messages when a result came from another
   * folder. The bulk API contract does not change.
   */
  const bulkByOrigin = (
    origins: MessageOrigin[],
    body: (group: { accountId: string; folder: string; uids: string[] }) => Record<string, unknown>,
    method: 'PATCH' | 'DELETE' = 'PATCH',
  ) => Promise.all(groupByOrigin(origins).map(group =>
    fetch('/api/messages/bulk', {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body(group)),
    })
  ))

  /** The targeted uids, across all folders: what the display must remove. */
  const uidsOf = (origins: MessageOrigin[]) => new Set(origins.map(x => x.uid))

  const markReadUids = async (origins: MessageOrigin[], read: boolean) => {
    if (!origins.length) return
    const uids = uidsOf(origins)
    await bulkByOrigin(origins, g => ({ ...g, action: read ? 'read' : 'unread' }))
    setAccumulated(prev => prev.map(m => uids.has(m.uid) ? { ...m, isRead: read } : m))
    setReadUids(prev => {
      const next = new Set(prev)
      uids.forEach(u => read ? next.add(u) : next.delete(u))
      return next
    })
    clearSelection()
    mutate()
  }

  const deleteUids = async (origins: MessageOrigin[]) => {
    if (!origins.length) return
    const uids = uidsOf(origins)
    await bulkByOrigin(origins, g => g, 'DELETE')
    setAccumulated(prev => prev.filter(m => !uids.has(m.uid)))
    clearSelection()
    mutate()
  }

  const moveUids = async (origins: MessageOrigin[], destination: string) => {
    if (!origins.length) return
    const uids = uidsOf(origins)
    await bulkByOrigin(origins, g => ({ ...g, action: 'move', destination }))
    setAccumulated(prev => prev.filter(m => !uids.has(m.uid)))
    clearSelection()
    mutate()
  }

  const setFlagUids = async (origins: MessageOrigin[], flag: string | null) => {
    if (!origins.length) return
    const uids = uidsOf(origins)
    await bulkByOrigin(origins, g => ({ ...g, action: 'flag', destination: undefined, flag }))
    setAccumulated(prev => prev.map(m => uids.has(m.uid) ? { ...m, flag, isStarred: flag !== null, isFlagged: flag !== null } : m))
    mutate()
  }

  /**
   * Snoozes the targeted uids. The snooze is set message by message (the route
   * carries the uid in its path); the rows disappear all at once, as
   * for a move, and the bar's popover refreshes.
   */
  const snoozeUids = async (origins: MessageOrigin[], until: Date) => {
    if (!origins.length) return
    const uids = uidsOf(origins)
    const byKey = new Map(accumulated.map(m => [originKey(originOf(m)), m]))
    await Promise.all(origins.map(origin => {
      const msg = byKey.get(originKey(origin))
      return fetch(`/api/messages/${origin.uid}/snooze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          until: until.toISOString(),
          folder: origin.folder,
          accountId: origin.accountId,
          subject: msg?.subject,
          fromAddress: msg?.from.address,
          fromName: msg?.from.name,
        }),
      })
    }))
    setAccumulated(prev => prev.filter(m => !uids.has(m.uid)))
    clearSelection()
    mutate()
    window.dispatchEvent(new CustomEvent('synapmail:snooze-changed'))
  }

  // Drag handlers
  const handleDragStart = useCallback((e: React.DragEvent, thread: ThreadGroup) => {
    // Direction arbitration: a mostly VERTICAL gesture from a
    // row is a marquee selection, not a drag toward a folder.
    const pending = marqueeRef.current
    if (pending && !pending.armed) {
      // The direction is read from the pointer trail, not from the coordinates of
      // the drag event: those are not reliable from one engine to another.
      if (Math.abs(pending.lastY - pending.startY) >= Math.abs(pending.lastX - pending.startX)) {
        e.preventDefault()
        pending.armed = true
        return
      }
      marqueeRef.current = null
    }
    const msg = thread.lastMessage
    const dragged = checkedKeys.has(originKey(originOf(msg)))
      ? checkedOrigins
      : thread.messages.map(originOf)
    const groups = groupByOrigin(dragged)
    // The drop target (sidebar) moves ONE group: `{ uids, accountId, folder }`.
    // A selection mixing several folders has no single folder to
    // announce: dragging it would move part of it with the wrong folder.
    // We therefore refuse the gesture rather than act on wrong messages.
    // ponytail: refusal, not a second protocol. The day the drop target can read
    // several groups, it will be enough to pass them to it here.
    if (groups.length !== 1) { e.preventDefault(); return }
    e.dataTransfer.setData('application/synapmail', JSON.stringify(groups[0]))
    e.dataTransfer.effectAllowed = 'move'
    setDraggingUid(msg.uid)
  }, [checkedKeys, checkedOrigins, originOf])

  const handleDragEnd = useCallback(() => setDraggingUid(null), [])

  /**
   * Mouse marquee selection.
   *
   * The rows are `draggable` and take the full width: there is no
   * empty space to start a rectangle in. The gesture direction therefore decides, at
   * `dragstart`: mostly VERTICAL (|dy| >= |dx|) → the native drag is cancelled
   * and the rectangle begins; mostly HORIZONTAL → we head toward the
   * sidebar, drag-and-drop stays what it was. A press outside a row
   * (date header, bottom margin) has no native drag to arbitrate: the
   * rectangle starts as soon as the pointer has moved.
   *
   * Everything goes through the M1 selection: the toolbar and the right click
   * see the result without one extra line of code.
   */

  /** Selects the rows the rectangle INTERSECTS, in screen coordinates. */
  const selectIntersecting = useCallback((top: number, bottom: number) => {
    const state = marqueeRef.current
    if (!state) return
    const hit: string[] = []
    document.querySelectorAll<HTMLElement>(`[${MAIL_ORIGIN_ATTR}]`).forEach(el => {
      const r = el.getBoundingClientRect()
      if (r.bottom >= top && r.top <= bottom) {
        const key = el.getAttribute(MAIL_ORIGIN_ATTR)
        if (key) hit.push(key)
      }
    })
    if (!state.additive) { setCheckedKeys(new Set(hit)); return }
    const next = new Set(state.before)
    hit.forEach(key => next.add(key))
    setCheckedKeys(next)
  }, [])

  // A rectangle released on a row is followed by a `click`: without this flag,
  // it would open the message and clear the selection just drawn.
  const marqueeDrewRef = useRef(false)

  const endMarquee = useCallback((restore: boolean) => {
    const state = marqueeRef.current
    if (!state) return
    marqueeRef.current = null
    if (state.drew) marqueeDrewRef.current = true
    setMarquee(null)
    if (restore) setCheckedKeys(new Set(state.before))
  }, [])

  const beginMarquee = useCallback((e: React.MouseEvent) => {
    // Left button only: the right click opens the menu, the middle one is none of our business.
    if (e.button !== 0) return
    // A rectangle drawn from one row to ANOTHER produces no `click` (the
    // two ends do not have the same element): the flag cannot
    // rely on a click to clear itself, the next press is what does it.
    marqueeDrewRef.current = false
    const box = scrollRef.current
    if (!box) return
    const target = e.target as HTMLElement | null
    // The avatar already carries the checkbox: a press on it is not a rectangle.
    if (target?.closest('.group\\/avatar')) return
    marqueeRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      startScroll: box.scrollTop,
      additive: e.metaKey || e.ctrlKey || e.shiftKey,
      before: new Set(checkedKeys),
      drew: false,
      // On a row, the rectangle waits for the `dragstart` arbitration; elsewhere,
      // there is nothing to arbitrate.
      armed: !target?.closest('[data-mail-row]'),
    }
  }, [checkedKeys])

  /**
   * The gesture lives on the WINDOW, not on the container: the pointer leaves the
   * list without the rectangle freezing, and a release outside ends it.
   * A single set of listeners, installed once: it bails out immediately when no
   * gesture is in progress.
   */
  useEffect(() => {
    let pointer: { x: number; y: number } | null = null
    let scroller: ReturnType<typeof setInterval> | null = null

    const stopScroller = () => {
      if (scroller) { clearInterval(scroller); scroller = null }
    }

    /** Redraws and re-selects from the last known position. */
    const paint = () => {
      const state = marqueeRef.current
      const box = scrollRef.current
      if (!state || !box || !pointer) return
      const r = box.getBoundingClientRect()
      const anchorY = state.startY - r.top + state.startScroll
      const nowY = pointer.y - r.top + box.scrollTop
      const anchorX = state.startX - r.left
      const nowX = pointer.x - r.left
      const top = Math.min(anchorY, nowY)
      const height = Math.abs(nowY - anchorY)
      setMarquee({ left: Math.min(anchorX, nowX), top, width: Math.abs(nowX - anchorX), height })
      selectIntersecting(top - box.scrollTop + r.top, top + height - box.scrollTop + r.top)
    }

    const onMove = (e: MouseEvent) => {
      const state = marqueeRef.current
      const box = scrollRef.current
      if (!state || !box) return
      pointer = { x: e.clientX, y: e.clientY }
      state.lastX = e.clientX
      state.lastY = e.clientY
      // On a row, the rectangle is armed only once the native drag has been ruled out.
      if (!state.armed) return
      if (Math.abs(e.clientX - state.startX) < MARQUEE_MIN_PX && Math.abs(e.clientY - state.startY) < MARQUEE_MIN_PX) return
      // The rectangle replaces the text selection the browser would make.
      e.preventDefault()
      state.drew = true
      paint()
      const r = box.getBoundingClientRect()
      const step = e.clientY < r.top + MARQUEE_EDGE_PX ? -MARQUEE_SCROLL_PX
        : e.clientY > r.bottom - MARQUEE_EDGE_PX ? MARQUEE_SCROLL_PX
        : 0
      stopScroller()
      if (step !== 0) scroller = setInterval(() => { box.scrollTop += step; paint() }, MARQUEE_SCROLL_MS)
    }

    const onUp = () => { stopScroller(); endMarquee(false) }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && marqueeRef.current) { stopScroller(); endMarquee(true) }
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('keydown', onKey)
    return () => {
      stopScroller()
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('keydown', onKey)
    }
  }, [selectIntersecting, endMarquee])

  /**
   * Click on a row, file-explorer style: Cmd/Ctrl toggles the row, Shift
   * extends the range from the last clicked row, a plain click CLEARS the
   * selection and opens that row: even while a selection is in progress
   * (otherwise a right click, which selects, would make the list unopenable).
   * The checkbox on avatar hover (`toggleRow`) remains the path that accumulates.
   */
  const handleRowClick = (thread: ThreadGroup, e: React.MouseEvent) => {
    if (marqueeDrewRef.current) { marqueeDrewRef.current = false; return }
    const key = originKey(originOf(thread.lastMessage))
    if (e.metaKey || e.ctrlKey) {
      toggleChecked(key)
      rangeAnchorKey.current = key
      return
    }
    if (e.shiftKey) {
      selectRangeTo(key)
      return
    }
    // The anchor is set AFTER the opening: `handleSelectThread` clears the
    // selection, which erases the anchor: a later Shift-click must start from here.
    handleSelectThread(thread)
    rangeAnchorKey.current = key
  }

  const handleSelectThread = (thread: ThreadGroup) => {
    if (checkedKeys.size > 0) clearSelection()
    setSelectedThreadKey(thread.key)
    thread.messages.forEach(msg => {
      if (!msg.isRead && !readUids.has(msg.uid)) {
        setReadUids(prev => new Set(prev).add(msg.uid))
      }
    })
    if (thread.count === 1) {
      onSelect(originOf(thread.lastMessage))
    } else {
      onSelectThread(thread.messages, thread.subject)
    }
  }

  /**
   * Right click, file-explorer style: INSIDE the selection it keeps it whole (the
   * menu acts on everything); outside it, it selects that row alone first,
   * so that the targeted item is always the one seen highlighted.
   */
  const handleContextMenu = (e: React.MouseEvent, thread: ThreadGroup) => {
    e.preventDefault()
    const msg = thread.lastMessage
    const key = originKey(originOf(msg))
    if (!checkedKeys.has(key)) {
      setCheckedKeys(new Set([key]))
      rangeAnchorKey.current = key
    }
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      isRead: msg.isRead || readUids.has(msg.uid),
      flag: msg.flag ?? (msg.isStarred ? DEFAULT_FLAG_KEY : null),
      // "Move to" removes the row's ORIGIN folder, not the screen's.
      folderPath: originOf(msg).folder,
    })
  }

  const handleRefresh = () => { setPage(1); loadingLockRef.current = 0; setRefreshKey(k => k + 1); mutate() }
  const hasSelection = checkedKeys.size > 0

  /**
   * Target of the shared actions: the selection if it exists, otherwise the OPEN
   * message. A single place decides: the context capabilities follow the same
   * rule (`targetCount`), so an enabled button always has something to target.
   */
  const targetOrigins = useMemo(
    () => (checkedOrigins.length ? checkedOrigins : selectedOrigin ? [selectedOrigin] : []),
    [checkedOrigins, selectedOrigin]
  )
  const targetOriginsRef = useRef(targetOrigins)
  targetOriginsRef.current = targetOrigins

  // The list primitives change identity on every render: a
  // ref makes them callable without re-registering the whole registry.
  const moveUidsRef = useRef(moveUids)
  moveUidsRef.current = moveUids
  const deleteUidsRef = useRef(deleteUids)
  deleteUidsRef.current = deleteUids
  const markReadUidsRef = useRef(markReadUids)
  markReadUidsRef.current = markReadUids
  const setFlagUidsRef = useRef(setFlagUids)
  setFlagUidsRef.current = setFlagUids
  const snoozeUidsRef = useRef(snoozeUids)
  snoozeUidsRef.current = snoozeUids

  const handleRefreshRef = useRef(handleRefresh)
  handleRefreshRef.current = handleRefresh


  const moveTarget = useCallback((destination: string) => {
    if (!destination) return
    moveUidsRef.current(targetOriginsRef.current, destination)
  }, [])

  const deleteTarget = useCallback(() => {
    const origins = targetOriginsRef.current
    if (origins.length > 1 && !window.confirm(t('confirmDeleteSelection', { count: origins.length }))) return
    deleteUidsRef.current(origins)
  }, [t])

  // Publishes what a toolbar needs to know, and withdraws the publication when
  // leaving the mailbox (the provider then falls back to an empty state).
  useEffect(() => {
    publish({
      accountId: activeAccountId ?? null,
      folder,
      selected: checkedOrigins,
      open: selectedOrigin,
      canSend: perms.canSend,
      canDelete: perms.canDelete,
      canOrganize: perms.canOrganize,
      hasArchive: !!archivePath,
      hasSpam: !!spamPath,
    })
    return () => publish(null)
  }, [publish, activeAccountId, folder, checkedOrigins, selectedOrigin, perms.canSend, perms.canDelete, perms.canOrganize, archivePath, spamPath])

  useEffect(() => {
    register({
      refresh: () => handleRefreshRef.current(),
      archive: () => { if (archivePath) moveTarget(archivePath) },
      spam: () => { if (spamPath) moveTarget(spamPath) },
      remove: deleteTarget,
      markRead: () => markReadUidsRef.current(targetOriginsRef.current, true),
      markUnread: () => markReadUidsRef.current(targetOriginsRef.current, false),
      setFlag: (flag) => setFlagUidsRef.current(targetOriginsRef.current, flag),
      snooze: (until) => snoozeUidsRef.current(targetOriginsRef.current, until),
      moveTo: moveTarget,
    })
  }, [register, archivePath, spamPath, moveTarget, deleteTarget])

  // List keyboard: Cmd/Ctrl+A selects everything loaded, Escape clears,
  // Delete deletes the selection (confirmation beyond one message).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') {
        if (allVisibleKeys.length === 0) return
        e.preventDefault()
        setCheckedKeys(new Set(allVisibleKeys))
        return
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'Escape' && checkedKeys.size > 0) { e.preventDefault(); clearSelection(); return }
      if ((e.key === 'Delete' || e.key === 'Backspace') && checkedKeys.size > 0 && perms.canDelete) {
        e.preventDefault()
        deleteTarget()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [allVisibleKeys, checkedKeys, perms.canDelete, deleteTarget]) // eslint-disable-line react-hooks/exhaustive-deps

  const renderRow = (thread: ThreadGroup) => {
    const { lastMessage: msg, hasUnread, count } = thread
    const isRead = !hasUnread || readUids.has(msg.uid)
    const isSelected = selectedThreadKey === thread.key
    const rowOrigin = originOf(msg)
    const rowKey = originKey(rowOrigin)
    const isChecked = checkedKeys.has(rowKey)
    const isDragging = draggingUid === msg.uid
    const initial = (msg.from.name || msg.from.address)[0]?.toUpperCase() ?? '?'
    const avatarColor = isRead ? 'bg-muted text-muted-foreground' : cn(getAvatarColor(msg.from.address), 'text-white')

    return (
      <div
        key={rowKey}
        data-mail-row={msg.uid}
        {...{ [MAIL_ORIGIN_ATTR]: rowKey }}
        role="option"
        // Selected = checked OR open: what the eye sees highlighted is what
        // the screen reader announces, and it is what the actions target.
        aria-selected={isChecked || isSelected}
        tabIndex={-1}
        draggable={perms.canOrganize}
        onDragStart={e => handleDragStart(e, thread)}
        onDragEnd={handleDragEnd}
        onContextMenu={e => handleContextMenu(e, thread)}
        className={cn(
          'group/row relative w-full text-left grid grid-cols-[auto_1fr] gap-3 border-b border-border/40 transition-colors duration-150 border-l-[3px] cursor-pointer',
          compact ? 'px-3 py-2' : 'px-4 py-3',
          isDragging && 'opacity-40',
          isChecked ? 'bg-primary/10 border-l-primary'
            : isSelected ? 'bg-primary/10 border-l-primary'
            : !isRead ? 'border-l-primary hover:bg-muted/50 bg-blue-50/60 dark:bg-blue-950/20'
            : 'border-l-transparent hover:bg-muted/50'
        )}
        onClick={e => handleRowClick(thread, e)}
      >
        {/* Avatar / Checkbox */}
        <div
          className={cn('relative shrink-0 group/avatar', compact ? 'w-7 h-7' : 'w-9 h-9')}
          onClick={e => toggleRow(rowKey, e)}
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
          {/* line 1 — sender (truncates first) + full date and time */}
          <div className={cn('flex items-baseline justify-between gap-2', compact ? '' : 'mb-0.5')}>
            <span className={cn('text-sm truncate', !isRead ? 'font-semibold text-foreground' : 'font-medium text-muted-foreground')}>
              {count > 1
                ? thread.messages.map(m => m.from.name || m.from.address.split('@')[0]).filter((v, i, a) => a.indexOf(v) === i).slice(0, 3).join(', ')
                : (msg.from.name || msg.from.address)
              }
            </span>
            {/* The "all folders" scope: a result says nothing if it does not say
                where it comes from. Discreet, and only when the folder can vary. */}
            {showResultFolder && msg.folder && (
              <span className="shrink-0 max-w-[40%] truncate text-[11px] text-muted-foreground/70" data-result-folder>
                {folderLabel(msg.folder)}
              </span>
            )}
            <div className="flex items-center gap-1 shrink-0">
              {(() => {
                const flag = flagByKey(msg.flag ?? (msg.isStarred ? DEFAULT_FLAG_KEY : null))
                if (!flag) return null
                return (
                  <span title={t(`flags.${flag.labelKey}`)}>
                    <Flag className="w-3 h-3 fill-current" style={{ color: flag.color }} />
                  </span>
                )
              })()}
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
                {formatRowDate(msg.date, locale, t('grpToday'))}
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

      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-background border-r border-border" {...{ [MAIL_SELECTION_COUNT_ATTR]: checkedOrigins.length }}>
      {/*
        Toolbar. Its three states do not have the same height (in a narrow column
        the normal header wraps onto two lines). If the selection bar
        REPLACED the header, the whole list would shift up as soon as the first row is
        checked, and a marquee selection would no longer intersect the targeted rows
        under the pointer. Both therefore live in the SAME grid cell: the
        height is that of the tallest, the same with and without a selection, with no
        hard-coded height and no JS measurement. `invisible` also removes from the tab
        order whatever is not displayed.
      */}
      <div className="grid shrink-0">
        <div className={cn('col-start-1 row-start-1 flex flex-wrap items-center gap-1.5 px-3 py-2 border-b border-border bg-primary/5', !hasSelection && 'invisible')} aria-hidden={!hasSelection || undefined}>
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
          <span className="text-xs text-primary font-medium mr-1">{checkedKeys.size}</span>
          <div className="flex-1" />
          <button onClick={clearSelection} className="w-7 h-7 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors" title="Annuler la sélection">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className={cn('col-start-1 row-start-1', hasSelection && 'invisible')} aria-hidden={hasSelection || undefined}>
        {!isSearchMode ? (
        <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-border h-full">
          <div className="flex rounded-lg overflow-hidden border border-border text-xs font-medium">
            {MAIL_LIST_FILTERS.map(f => (
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
          <div className="ml-auto" />
          <ScheduledPopover />
          <SnoozePopover activeAccountId={activeAccountId} />
        </div>
        ) : (
        <div className="px-4 py-2 border-b border-border h-full">
          {/* ONE line: the count, what is displayed, and the progress while it
              runs. The searched fields and the scope (secondary information)
              move into a tooltip on the right-hand icon. */}
          <div className="flex items-center gap-2 min-w-0">
            <p className="text-xs text-muted-foreground truncate" data-search-summary>
              {t('searchCount', { count: searchTotal })}
              {searchTruncated && ` · ${t('searchShown', { shown: messages.length })}`}
              {isSearching && streamed.folders > 0 &&
                ` · ${t('searchProgress', { searched: streamed.searched, folders: streamed.folders })}`}
              {isSearching && streamed.folders === 0 && ` · ${t('searching')}`}
            </p>
            {/* Gated on `streaming` and not on `isSearching`: before the account
                is resolved, no stream is running yet: a Stop button would have
                nothing to stop. */}
            {streaming && isStreamingScope && (
              <button
                onClick={stopStream}
                className="shrink-0 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                {t('searchStop')}
              </button>
            )}
            {/* `IconTooltip` and not the native `title` attribute: a single tooltip, in the
                app's style, placed under the icon. `align="end"`: the icon is flush against the
                right edge of the list, a centered tooltip would overflow it. */}
            <span className="ml-auto flex shrink-0 text-muted-foreground/60">
              <IconTooltip
                align="end"
                label={t('searchDetails', {
                  fields: t('searchFieldsLabel'),
                  scope: searchScope === SCOPE_ALL ? t('searchAllFolders') : t('searchThisFolder'),
                })}
              >
                <Info className="w-3.5 h-3.5" data-search-details />
              </IconTooltip>
            </span>
          </div>
          {!isSearching && messages.length === 0 && (
            <p className="mt-1 text-xs text-muted-foreground/70" data-search-hint>{t('searchNoBodyHint')}</p>
          )}
        </div>
        )}
        </div>
      </div>

      {/* Thread List */}
      {/* `select-none`: a rectangle starting on a date header used to highlight
          text along the way: text selection is born at `mousedown`, which no
          `preventDefault()` placed at `mousemove` can cancel anymore. The list has
          no text to copy; elsewhere (reading pane) nothing changes. */}
      <ThinScroll
        className="flex-1"
        viewportClassName="relative select-none"
        viewportRef={scrollRef}
        viewportProps={{
          role: 'listbox',
          'aria-multiselectable': true,
          'aria-label': t('messageList'),
          onMouseDown: beginMarquee,
        }}
      >
        {marquee && (
          <div
            data-mail-marquee
            className="pointer-events-none absolute z-20 border border-primary bg-primary/10"
            style={{ left: marquee.left, top: marquee.top, width: marquee.width, height: marquee.height }}
          />
        )}
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
            <p className="text-sm font-medium">{isSearchMode ? t('noSearchResults') : t('noMessages')}</p>
          </div>
        )}

        {groupedThreads.map((group, gi) => (
          <div key={group.label ?? `g${gi}`}>
            {group.label && (
              <div data-mail-date-header className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm px-4 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground border-b border-border/40">
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
      </ThinScroll>

      {/* Context menu */}
      {contextMenu && (
        <MessageContextMenu
          menu={contextMenu}
          folders={folders}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  )
}
