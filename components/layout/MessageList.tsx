'use client'

import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { RefreshCw, Search, X, Paperclip, CheckSquare, Square, Eye, EyeOff, Flag, Info } from 'lucide-react'
import { MAIL_SELECTION_COUNT_ATTR, useMailSelection } from '@/lib/mailSelection'
import { MAIL_ORIGIN_ATTR, groupByOrigin, groupsToMove, originKey, type MessageOrigin } from '@/lib/mailOrigin'
import { DEFAULT_FLAG_KEY, MAIL_LIST_FILTERS, flagByKey, type MailListFilter } from '@/lib/flags'
import { unreadRefresh, unreadShift } from '@/lib/unreadSignal'
import {
  explorerSelect, gestureOf, isAllSelected, selectAll,
  type ExplorerGesture, type ExplorerSelection,
} from '@/lib/explorerSelection'
import { cn } from '@/lib/utils'
import { formatRowDate } from '@/lib/dates'
import {
  EMPTY_SEARCH_STREAM, SCOPE_ACCOUNTS, SCOPE_FOLDER, SCOPE_LABEL, SCOPE_PARAM, SEARCH_PARAM, STREAM_PARAM, isWideScope,
  accumulateSearchStream, isSearchQuery, parseNdjsonChunk,
  type SearchField, type SearchScope, type SearchStreamChunk, type SearchStreamState,
} from '@/lib/search'
import useSWR from 'swr'
import { SETTINGS_KEY, saveSettings } from '@/lib/settings'
import type { Message, Folder, ReadReceipt } from '@/types/email'
import type { EmailAccount } from '@/types/account'
import { MessageContextMenu, type ContextMenuState } from '@/components/ui/MessageContextMenu'
import { IconTooltip } from '@/components/ui/IconTooltip'
import { ThinScroll } from './ThinScroll'
import { accountColor, accountInitials, readableInk, useAccountAccent } from './AccountAvatar'
import { ScheduledPopover } from '@/components/mail/ScheduledPopover'
import { SnoozePopover } from '@/components/mail/SnoozePopover'
import { useEmailNotifications } from '@/hooks/useEmailNotifications'

const EMPTY_MESSAGES: Message[] = []

const fetcher = async (url: string) => {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Request failed: ${res.status}`)
  return res.json()
}

// Rectangle de sélection (lot M3c). Sous ce seuil, le geste reste un clic —
// c'est aussi le seuil qu'utilise l'explorateur du système.
const MARQUEE_MIN_PX = 4
// Bande sensible le long des bords du conteneur, pas et cadence du défilement
// automatique pendant le geste : mesurés à la main sur le banc, assez lents pour
// rester visés, assez vifs pour traverser une page.
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

const groupIntoThreads = (messages: readonly Message[]): ThreadGroup[] => {
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

/**
 * « Pas encore de résultats » doit être LE MÊME tableau d'un rendu à l'autre. Un
 * `?? []` écrit dans le corps en fabrique un neuf à chaque rendu : `threads` puis
 * `checkedOrigins` changeaient alors d'identité sans que rien ne bouge, l'effet
 * qui PUBLIE l'état de la boîte se rejouait, son nettoyage publiait `null`, le
 * fournisseur re-rendait la liste — et la boucle repartait. Mesuré le 20/09/2026 :
 * 478 « Maximum update depth exceeded » sur `/mail?q=facture`, au point qu'un clic
 * sur le sélecteur de portée n'obtenait plus sa navigation.
 */
const NO_MESSAGES: readonly Message[] = []

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
  /** Message ouvert, avec SON origine : un uid seul désignerait plusieurs messages. */
  selectedOrigin: MessageOrigin | null
  onSelect: (origin: MessageOrigin) => void
  onSelectThread: (messages: Message[], subject: string) => void
  activeAccountId?: string | null
  /** Recherche en cours, portée par l'URL de la boîte et pilotée par la barre d'application. */
  search?: string
  searchScope?: SearchScope
  permissions?: MailPermissions
}

interface AppSettings {
  thread_view: boolean; messages_per_page: number; mail_density: DensityMode
  /** Boîte affichée, telle qu'enregistrée : ce qui dit si le compte reçu est le bon. */
  active_account_id: string | null
}

export function MessageList({ folder, selectedOrigin, onSelect, onSelectThread, activeAccountId, search = '', searchScope = SCOPE_FOLDER, permissions }: Props) {
  const perms = permissions ?? DEFAULT_PERMISSIONS
  const t = useTranslations('mail')
  const locale = useLocale()
  // État partagé : la liste est la SEULE à publier et à enregistrer des actions.
  const { publish, register } = useMailSelection()
  const [filter, setFilter] = useState<MailListFilter>('all')
  const [page, setPage] = useState(1)
  const [accumulated, setAccumulated] = useState<Message[]>([])
  const [refreshKey, setRefreshKey] = useState(0)
  const [readUids, setReadUids] = useState<Set<string>>(new Set())
  const [selectedThreadKey, setSelectedThreadKey] = useState<string | null>(null)

  // Les boîtes de l'utilisateur, prises à la MÊME source que la barre latérale
  // (mêmes clés SWR, donc aucune requête de plus) : la pastille d'un résultat doit
  // porter exactement la couleur et les lettres que la barre lui donne déjà.
  const { accounts } = useAccountAccent()

  const { data: settingsData } = useSWR<{ data: AppSettings }>(SETTINGS_KEY, fetcher)
  const threadView = settingsData?.data?.thread_view ?? true
  // No fallback: the list is only requested once the page size is known
  // (measured: one request at 30 then one at the real size, the first for nothing).
  const perPage = settingsData?.data?.messages_per_page

  // Direction B — comfortable / compact density
  const density = settingsData?.data?.mail_density ?? 'comfortable'
  const changeDensity = (mode: DensityMode) => {
    void saveSettings({ mail_density: mode })
  }
  const compact = density === 'compact'

  // Bulk selection
  const [checkedKeys, setCheckedKeys] = useState<Set<string>>(new Set())

  // Context menu
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)

  // Drag state
  const [draggingUid, setDraggingUid] = useState<string | null>(null)

  // Rectangle de sélection (lot M3c) — seul l'état DESSINÉ vit dans le rendu ;
  // le geste lui-même (origine, sélection d'avant, mode additif) reste en
  // référence : il change à chaque pixel et ne doit rien re-rendre.
  const [marquee, setMarquee] = useState<{ left: number; top: number; width: number; height: number } | null>(null)
  const marqueeRef = useRef<{
    startX: number; startY: number; startScroll: number
    /** Dernière position connue du pointeur — c'est elle qui donne la DIRECTION. */
    lastX: number; lastY: number
    additive: boolean; before: Set<string>; armed: boolean
    /** Un rectangle a-t-il vraiment été tracé ? Armé ne suffit pas : un simple clic arme aussi. */
    drew: boolean
  } | null>(null)

  // Sélection façon explorateur : la dernière ligne cliquée est l'ancre d'une
  // plage Maj-clic. Une référence suffit — elle ne pilote aucun rendu.
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

  // The active account arrives AFTER the first render, and in TWO stages: /api/accounts
  // gives the list, /api/settings says which one is displayed. As long as the settings
  // are missing, the received account is only a fallback on the DEFAULT mailbox: listing
  // there would ask for a different mailbox than the displayed one, would open IMAP
  // connections for nothing, and could briefly show messages from the wrong account.
  //
  // The presence of the settings is NOT enough: a child's effects run BEFORE the
  // parent's, so the list would see the settings arrive one render before the parent
  // has applied the account they name. We therefore require AGREEMENT between the two
  // sources: the displayed account is indeed the one the settings name. Without any
  // mailbox, the (empty) account list received is enough: the server answers "no account".
  const { data: accountsRes } = useSWR<{ data: EmailAccount[] }>('/api/accounts', fetcher)
  const savedAccountId = settingsData?.data?.active_account_id
  const accountSettled = !!settingsData?.data &&
    (activeAccountId ? (!savedAccountId || savedAccountId === activeAccountId) : !!accountsRes)

  const { data, error, isValidating, mutate } = useSWR<{ messages: Message[]; total: number }>(
    isSearchMode || !accountSettled
      ? null
      : `/api/messages?folder=${encodeURIComponent(folder)}&filter=${filter}&page=${page}&perPage=${perPage}${accountParam}`,
    fetcher,
    { refreshInterval: 60000 }
  )

  // `total` = correspondances réelles côté serveur, `fields` = champs interrogés :
  // le bandeau les dit plutôt que de les retaper (source unique : lib/search.ts).
  // La portée « ce dossier » tient en une réponse : un seul dossier, rien à étaler.
  const isStreamingScope = isSearchMode && isWideScope(searchScope)
  // Same wait as the list (`accountSettled`): a SINGLE condition holds back both
  // scopes, and the banner stays in its pending state instead of announcing a
  // definitive "0 results".
  const searchReady = isSearchMode && !!activeAccountId && accountSettled
  const { data: searchData, isValidating: isSearchingOne } = useSWR<{ messages: Message[]; total: number; fields: SearchField[] }>(
    searchReady && !isStreamingScope
      ? `/api/messages/search?${SEARCH_PARAM}=${encodeURIComponent(search)}&folder=${encodeURIComponent(folder)}` +
        `&${SCOPE_PARAM}=${searchScope}${accountParam}`
      : null,
    fetcher
  )

  // Portée « tous les dossiers » : la réponse arrive dossier par dossier (NDJSON).
  // Les résultats s'accumulent au fil de l'eau, la progression est affichée, et
  // changer de requête interrompt la précédente au lieu de la laisser courir.
  const [streamed, setStreamed] = useState<SearchStreamState<Message>>(EMPTY_SEARCH_STREAM)
  const [streaming, setStreaming] = useState(false)
  const streamAbort = useRef<AbortController | null>(null)
  const stopStream = useCallback(() => { streamAbort.current?.abort() }, [])

  // CE que le flux doit couvrir. Un effet ne s'exécute qu'APRÈS la peinture : entre
  // le rendu où la recherche devient prête et celui où l'effet lève `streaming`, le
  // bandeau affichait un « 0 résultat » SANS « Recherche… », donc présenté comme
  // définitif (mesuré le 20/09/2026 : 52 ms de faux zéro au chargement à froid).
  // Comparer la clé visée à celle que le flux a démarrée rend l'attente visible dès
  // le PREMIER rendu, sans second drapeau à tenir en accord avec le premier.
  const streamKey = isStreamingScope && searchReady
    ? `${search}|${folder}|${searchScope}|${accountParam}`
    : null
  const [streamedKey, setStreamedKey] = useState<string | null>(null)

  useEffect(() => {
    if (!isStreamingScope || !searchReady) { setStreamed(EMPTY_SEARCH_STREAM); return }
    const controller = new AbortController()
    streamAbort.current = controller
    setStreamed(EMPTY_SEARCH_STREAM)
    setStreamedKey(streamKey)
    setStreaming(true)
    const url = `/api/messages/search?${SEARCH_PARAM}=${encodeURIComponent(search)}` +
      `&folder=${encodeURIComponent(folder)}&${SCOPE_PARAM}=${searchScope}&${STREAM_PARAM}=1${accountParam}`
    // Un flux lu JUSQU'AU BOUT n'a plus rien à abandonner : l'interrompre quand même
    // au démontage faisait conclure le navigateur à `net::ERR_ABORTED` sur une
    // réponse pourtant complète — trompeur dans les outils réseau, et indissociable
    // d'un vrai abandon.
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
        // Une interruption volontaire n'est pas une panne : les résultats déjà
        // reçus restent affichés, et le bandeau cesse simplement de progresser.
      } finally {
        // SEULE la recherche COURANTE éteint le drapeau. Une recherche abandonnée
        // termine APRÈS que la suivante a démarré : sans ce test, son `finally`
        // éteignait la progression de celle qui court — plus de bouton Arrêter, plus
        // de « N dossiers sur M », et un « 0 résultat » présenté comme définitif.
        if (streamAbort.current === controller) setStreaming(false)
      }
    })()
    return () => { if (!complete) controller.abort() }
  }, [isStreamingScope, searchReady, search, folder, accountParam, searchScope, streamKey])

  // Tant que le compte n'est pas résolu, la recherche est EN COURS de démarrage :
  // le bandeau dit « Recherche… » plutôt que d'affirmer un résultat qu'il n'a pas.
  const isSearching = isSearchMode && !searchReady
    ? true
    : (isStreamingScope ? (streaming || streamedKey !== streamKey) : isSearchingOne)

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
  // Un résultat porte son CHEMIN IMAP (« INBOX.Clients.2026 ») : le bandeau affiche
  // le nom déjà connu de la liste des dossiers, et à défaut le dernier segment —
  // le séparateur est propre au serveur, il vient donc du dossier lui-même.
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
      // Le compteur monte APRÈS ce listage, pas en même temps. C'est lui qui
      // réécrit le nombre autoritatif (SEARCH UNSEEN, `mailbox_stats`), et il
      // dure le temps d'un aller-retour IMAP : demander les comptes en parallèle
      // — ce que faisait l'annonce du flux — relisait donc l'ANCIENNE valeur,
      // `/api/accounts` étant une simple lecture SQL, bien plus rapide. Aucun
      // sondage de plus : on se branche sur la relecture que la liste fait déjà,
      // que ce soit l'annonce IMAP IDLE ou son intervalle.
      unreadRefresh()
    } else {
      setAccumulated(prev => {
        const existingUids = new Set(prev.map(m => m.uid))
        const newMsgs = data.messages.filter(m => !existingUids.has(m.uid))
        return [...prev, ...newMsgs]
      })
    }
  }, [data, page, refreshKey])

  const searchMessages = isStreamingScope ? streamed.messages : (searchData?.messages ?? NO_MESSAGES)
  const messages = isSearchMode ? searchMessages : accumulated
  // The folder as loaded (not a search): no extra poll.
  useEmailNotifications(isSearchMode ? EMPTY_MESSAGES : accumulated, folder, activeAccountId ?? undefined)
  const total = data?.total ?? 0
  // Le serveur peut avoir trouvé plus que ce qu'il rend (plafond SEARCH_RESULT_LIMIT) :
  // le bandeau annonce alors « X premiers sur N » au lieu de laisser croire à N = X.
  const searchTotal = isStreamingScope ? streamed.total : (searchData?.total ?? messages.length)
  const searchTruncated = searchTotal > messages.length
  const showResultFolder = isSearchMode && isWideScope(searchScope)
  // Portée « toutes les boîtes » : le dossier seul ne suffit plus, deux boîtes ont
  // chacune une « Réception ». La bulle à deux lettres dit laquelle, sans grossir
  // la ligne (elle remplace le seul dossier, elle ne s'y ajoute pas).
  const showResultAccount = isSearchMode && searchScope === SCOPE_ACCOUNTS
  // Ce que la pastille d'un résultat affiche, résolu UNE fois par boîte et non à
  // chaque ligne : les lettres et la couleur viennent des mêmes fonctions que la
  // bulle de la barre latérale (AccountAvatar), donc une boîte ne peut pas
  // s'épeler ni se colorer autrement ici que là-bas. Le rang dans la liste EST la
  // clé de la palette automatique — c'est ce même rang que la barre emploie.
  const resultAccountBadges = useMemo(() => {
    const byId = new Map<string, { letters: string; background: string; ink: string; email: string }>()
    accounts.forEach((account, rank) => {
      const background = accountColor(account, rank)
      byId.set(account.id, {
        letters: accountInitials(account),
        background,
        ink: readableInk(background),
        email: account.email,
      })
    })
    return byId
  }, [accounts])
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
   * L'origine d'une ligne : SON compte et SON dossier, pas ceux de l'écran. Une
   * recherche « tous les dossiers » rend des messages de plusieurs dossiers, et
   * un uid ne désigne un message que dans le sien. Les champs manquants
   * retombent sur le contexte affiché (hors recherche, ils sont identiques).
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
  const isAllChecked = isAllSelected(allVisibleKeys, checkedKeys)
  const isIndeterminate = !isAllChecked && allVisibleKeys.some(key => checkedKeys.has(key))

  /**
   * La RÈGLE (clic, Cmd/Ctrl-clic, Maj-clic, tout prendre) vit dans
   * `lib/explorerSelection.ts` et sert aussi la liste des abonnements du
   * tableau de bord. Ici on ne fait que ranger le résultat : l'ensemble dans
   * l'état, l'ancre dans sa référence.
   */
  const applySelection = (next: ExplorerSelection) => {
    setCheckedKeys(next.selected)
    rangeAnchorKey.current = next.anchor
  }

  const currentSelection = (): ExplorerSelection => ({ selected: checkedKeys, anchor: rangeAnchorKey.current })

  const clickRow = (key: string, gesture: ExplorerGesture) =>
    applySelection(explorerSelect(allVisibleKeys, currentSelection(), key, gesture))

  const toggleAll = () => applySelection(selectAll(allVisibleKeys, isAllChecked))

  const toggleRow = (key: string, e: React.MouseEvent) => {
    e.stopPropagation()
    clickRow(key, 'toggle')
  }

  const clearSelection = () => {
    setCheckedKeys(new Set())
    rangeAnchorKey.current = null
  }

  /** Les origines cochées, fil par fil : un fil coché vise tous ses messages. */
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
   * Les primitives prennent les ORIGINES visées : elles groupent par (compte,
   * dossier) et envoient UNE requête groupée par groupe, avec SON dossier. Le
   * dossier AFFICHÉ n'entre plus dans aucune requête — c'est lui qui faisait
   * partir les actions sur les mauvais messages quand un résultat venait d'un
   * autre dossier. Le contrat de l'API groupée ne change pas.
   */
  const bulkByOrigin = (
    origins: MessageOrigin[],
    body: (group: { accountId: string; folder: string; uids: string[] }) => Record<string, unknown>,
    method: 'PATCH' | 'DELETE' = 'PATCH',
    groups = groupByOrigin(origins),
  ) => Promise.all(groups.map(group =>
    fetch('/api/messages/bulk', {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body(group)),
    })
  ))

  /** Les uid visés, tous dossiers confondus : ce que l'affichage doit retirer. */
  const uidsOf = (origins: MessageOrigin[]) => new Set(origins.map(x => x.uid))

  const markReadUids = async (origins: MessageOrigin[], read: boolean) => {
    if (!origins.length) return
    const uids = uidsOf(origins)
    // Le badge descend sur le clic, pas à la relecture suivante. On ne décale
    // que les lignes qui CHANGENT d'état — l'état LU À L'ÉCRAN, `readUids`
    // compris — sinon remarquer « lu » un message déjà lu ferait baisser le
    // compteur une seconde fois. Voir lib/unreadSignal.ts.
    const shown = new Map(accumulated.map(m => [originKey(originOf(m)), m]))
    unreadShift(origins.filter(o => {
      const msg = shown.get(originKey(o))
      return msg ? (msg.isRead || readUids.has(msg.uid)) === !read : false
    }), read)
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

  // Un groupe déjà dans la destination n'émet AUCUNE requête (`groupsToMove`), et
  // ses lignes restent affichées : elles n'ont pas bougé.
  const moveUids = async (origins: MessageOrigin[], destination: string) => {
    const groups = groupsToMove(origins, destination)
    if (!groups.length) return
    const uids = new Set(groups.flatMap(g => g.uids))
    await bulkByOrigin(origins, g => ({ ...g, action: 'move', destination }), 'PATCH', groups)
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
   * Reporte les uids visés. Le report est posé message par message (la route
   * porte l'uid dans son chemin) ; les lignes disparaissent d'un coup, comme
   * pour un déplacement, et le popover de la barre se rafraîchit.
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
    // Arbitrage de direction (lot M3c) : un geste surtout VERTICAL depuis une
    // ligne est un rectangle de sélection, pas un glisser vers un dossier.
    const pending = marqueeRef.current
    if (pending && !pending.armed) {
      // La direction se lit sur la trace du pointeur, pas sur les coordonnées de
      // l'événement de glisser : celles-ci ne sont pas fiables d'un moteur à l'autre.
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
    // Le dépôt (barre latérale) déplace UN groupe : `{ uids, accountId, folder }`.
    // Une sélection qui mêle plusieurs dossiers n'a pas de dossier unique à
    // annoncer — la glisser en déplacerait une partie avec le mauvais dossier.
    // On refuse alors le geste plutôt que d'agir sur de mauvais messages.
    // ponytail: refus, pas un second protocole. Le jour où le dépôt saura lire
    // plusieurs groupes, il suffira de les lui passer ici.
    if (groups.length !== 1) { e.preventDefault(); return }
    e.dataTransfer.setData('application/synapmail', JSON.stringify(groups[0]))
    e.dataTransfer.effectAllowed = 'move'
    setDraggingUid(msg.uid)
  }, [checkedKeys, checkedOrigins, originOf])

  const handleDragEnd = useCallback(() => setDraggingUid(null), [])

  /**
   * Rectangle de sélection à la souris (lot M3c).
   *
   * Les lignes sont `draggable` et occupent toute la largeur : il n'y a pas de
   * vide où commencer un rectangle. La direction du geste tranche donc, au
   * `dragstart` : surtout VERTICAL (|dy| >= |dx|) → le glisser natif est annulé
   * et le rectangle commence ; surtout HORIZONTAL → on part vers la barre
   * latérale, le glisser-déposer reste ce qu'il était. Un appui hors d'une ligne
   * (en-tête de date, marge basse) n'a pas de glisser natif à arbitrer : le
   * rectangle démarre dès que le pointeur a bougé.
   *
   * Tout passe par la sélection de M1 : la barre d'outils et le clic droit
   * voient le résultat sans une ligne de code en plus.
   */

  /** Sélectionne les lignes que le rectangle COUPE, dans les coordonnées de l'écran. */
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

  // Un rectangle relâché sur une ligne fait suivre un `click` : sans ce drapeau,
  // il ouvrirait le message et effacerait la sélection qu'on vient de tracer.
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
    // Bouton gauche seul : le clic droit ouvre le menu, le milieu ne nous regarde pas.
    if (e.button !== 0) return
    // Un rectangle tracé d'une ligne à une AUTRE ne produit aucun `click` (les
    // deux extrémités n'ont pas le même élément) : le drapeau ne peut pas
    // compter sur un clic pour se vider, c'est l'appui suivant qui le fait.
    marqueeDrewRef.current = false
    const box = scrollRef.current
    if (!box) return
    const target = e.target as HTMLElement | null
    // La bulle porte déjà la case à cocher : un appui dessus n'est pas un rectangle.
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
      // Sur une ligne, le rectangle attend l'arbitrage du `dragstart` ; ailleurs,
      // il n'y a rien à arbitrer.
      armed: !target?.closest('[data-mail-row]'),
    }
  }, [checkedKeys])

  /**
   * Le geste vit sur la FENÊTRE, pas sur le conteneur : le pointeur sort de la
   * liste sans que le rectangle se fige, et un relâchement dehors le termine.
   * Un seul jeu d'écouteurs, posé une fois — il sort tout de suite quand aucun
   * geste n'est en cours.
   */
  useEffect(() => {
    let pointer: { x: number; y: number } | null = null
    let scroller: ReturnType<typeof setInterval> | null = null

    const stopScroller = () => {
      if (scroller) { clearInterval(scroller); scroller = null }
    }

    /** Redessine et re-sélectionne à partir de la dernière position connue. */
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
      // Sur une ligne, le rectangle n'est armé qu'une fois le glisser natif écarté.
      if (!state.armed) return
      if (Math.abs(e.clientX - state.startX) < MARQUEE_MIN_PX && Math.abs(e.clientY - state.startY) < MARQUEE_MIN_PX) return
      // Le rectangle remplace la sélection du texte que le navigateur ferait.
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
   * Clic sur une ligne, façon explorateur : Cmd/Ctrl bascule la ligne, Maj
   * étend la plage depuis la dernière ligne cliquée, un clic simple VIDE la
   * sélection et ouvre cette ligne — même quand une sélection est en cours
   * (sinon un clic droit, qui sélectionne, rendrait la liste inouvrable).
   * La case au survol de la bulle (`toggleRow`) reste le chemin qui accumule.
   */
  const handleRowClick = (thread: ThreadGroup, e: React.MouseEvent) => {
    if (marqueeDrewRef.current) { marqueeDrewRef.current = false; return }
    const key = originKey(originOf(thread.lastMessage))
    const gesture = gestureOf(e.nativeEvent)
    if (gesture !== 'replace') {
      clickRow(key, gesture)
      return
    }
    // L'ancre est posée APRÈS l'ouverture : `handleSelectThread` vide la
    // sélection, ce qui efface l'ancre — un Maj-clic ensuite doit partir d'ici.
    handleSelectThread(thread)
    rangeAnchorKey.current = key
  }

  const handleSelectThread = (thread: ThreadGroup) => {
    if (checkedKeys.size > 0) clearSelection()
    setSelectedThreadKey(thread.key)
    thread.messages.forEach(msg => {
      if (!msg.isRead && !readUids.has(msg.uid)) {
        setReadUids(prev => new Set(prev).add(msg.uid))
        // La ligne se grise ICI, sur le clic : le compteur descend au même
        // instant. L'écriture, elle, part du volet de lecture quand le message
        // est chargé — attendre cet aller-retour IMAP pour bouger le badge le
        // faisait arriver une seconde trop tard (mesuré : 1029 ms pour 1000).
        // Le volet décale la même origine ; `unreadShift` ne compte qu'une fois.
        unreadShift([originOf(msg)], true)
      }
    })
    if (thread.count === 1) {
      onSelect(originOf(thread.lastMessage))
    } else {
      onSelectThread(thread.messages, thread.subject)
    }
  }

  /**
   * Clic droit, façon explorateur : DANS la sélection il la garde entière (le
   * menu agit sur tout) ; hors d'elle il sélectionne cette ligne seule d'abord,
   * pour que la cible visée soit toujours celle qu'on voit surlignée.
   */
  const handleContextMenu = (e: React.MouseEvent, thread: ThreadGroup) => {
    e.preventDefault()
    const msg = thread.lastMessage
    const key = originKey(originOf(msg))
    if (!checkedKeys.has(key)) clickRow(key, 'replace')
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      isRead: msg.isRead || readUids.has(msg.uid),
      flag: msg.flag ?? (msg.isStarred ? DEFAULT_FLAG_KEY : null),
      // « Déplacer vers » retire le dossier d'ORIGINE de la ligne, pas celui de l'écran.
      folderPath: originOf(msg).folder,
    })
  }

  const handleRefresh = () => { setPage(1); loadingLockRef.current = 0; setRefreshKey(k => k + 1); mutate() }
  const hasSelection = checkedKeys.size > 0

  /**
   * Cible des actions partagées : la sélection si elle existe, sinon le message
   * OUVERT. Un seul endroit décide — les capacités du contexte suivent la même
   * règle (`targetCount`), donc un bouton actif a toujours quelque chose à viser.
   */
  const targetOrigins = useMemo(
    () => (checkedOrigins.length ? checkedOrigins : selectedOrigin ? [selectedOrigin] : []),
    [checkedOrigins, selectedOrigin]
  )
  const targetOriginsRef = useRef(targetOrigins)
  targetOriginsRef.current = targetOrigins

  // Les primitives de la liste changent d'identité à chaque rendu : une
  // référence les rend appelables sans ré-enregistrer tout le registre.
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

  // Publie ce qu'une barre d'outils doit connaître, et retire la publication en
  // quittant la boîte (le fournisseur retombe alors sur un état vide).
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

  // Clavier de la liste : Cmd/Ctrl+A sélectionne tout le chargé, Échap vide,
  // Suppr supprime la sélection (confirmation au-delà d'un message).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') {
        if (allVisibleKeys.length === 0) return
        e.preventDefault()
        applySelection(selectAll(allVisibleKeys, false))
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
        // Sélectionné = coché OU ouvert : ce que l'œil voit surligné est ce que
        // le lecteur d'écran annonce, et c'est ce que les actions visent.
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
            {/* Portée « tous les dossiers » : un résultat ne dit rien s'il ne dit pas
                d'où il vient. Discret, et seulement quand le dossier peut varier. */}
            {showResultFolder && msg.folder && (
              <span className="shrink-0 max-w-[40%] flex items-center gap-1 text-[11px] text-muted-foreground/70" data-result-folder>
                {/* Portée « toutes les boîtes » : la pastille dit DE QUELLE boîte
                    vient ce résultat. Un point coloré à deux lettres, pas une
                    seconde bulle : la ligne garde exactement la même hauteur. */}
                {showResultAccount && (() => {
                  const badge = resultAccountBadges.get(msg.accountId)
                  if (!badge) return null
                  return (
                    <span
                      data-result-account={msg.accountId}
                      title={badge.email}
                      className="shrink-0 inline-flex h-[14px] items-center rounded-full px-1 text-[9px] font-semibold leading-none tracking-[0.02em]"
                      style={{ backgroundColor: badge.background, color: badge.ink }}
                    >
                      {badge.letters}
                    </span>
                  )
                })()}
                <span className="truncate">{folderLabel(msg.folder)}</span>
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
        Toolbar. Ses trois états n'ont pas la même hauteur (à colonne étroite
        l'en-tête normal passe sur deux lignes). Si la barre de sélection
        REMPLAÇAIT l'en-tête, toute la liste remonterait dès la première ligne
        cochée, et un rectangle de sélection ne couperait plus les lignes visées
        sous le pointeur. Les deux vivent donc dans la MÊME case de grille : la
        hauteur est celle du plus grand, la même avec et sans sélection, sans
        hauteur en dur ni mesure en JS. `invisible` retire aussi de l'ordre de
        tabulation ce qui n'est pas affiché.
      */}
      {/* Les deux bandeaux se superposent dans UNE piste de grille. Un élément de
          grille garde `min-width:auto` : sans `minmax(0,1fr)`, celui qui dépasse
          ÉLARGIT la piste au lieu de se tronquer, et le bandeau de recherche
          poussait Arrêter et l'icône d'information hors de la colonne, sous le
          volet de lecture (mesuré le 20/09/2026 : piste de 318 px pour un
          contenu de 444 px, bouton à 130 px dehors). */}
      <div className="grid grid-cols-[minmax(0,1fr)] shrink-0">
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
          {/* UNE ligne : le compte, ce qui est affiché, et la progression quand elle
              court. Les champs cherchés et la portée — information secondaire —
              passent en infobulle sur l'icône de droite. */}
          <div className="flex items-center gap-2 min-w-0">
            {/* `min-w-0` : un élément de flex garde `min-width:auto`, donc `truncate`
                ne mordait JAMAIS — le texte poussait Arrêter et l'icône HORS de la
                colonne (mesuré le 20/09/2026 à 1440 px : bouton à 130 px dehors,
                sous le volet de lecture, donc plus cliquable). Les deux cibles
                restent dans la colonne, c'est le texte qui cède. */}
            <p className="min-w-0 text-xs text-muted-foreground truncate" data-search-summary>
              {t('searchCount', { count: searchTotal })}
              {searchTruncated && ` · ${t('searchShown', { shown: messages.length })}`}
              {isSearching && streamed.folders > 0 &&
                ` · ${t('searchProgress', { searched: streamed.searched, folders: streamed.folders })}`}
              {/* Portée « toutes les boîtes » : combien de BOÎTES ont rapporté, en plus
                  des dossiers — « 3 boîtes sur 8 ». Les boîtes injoignables sont dites
                  plutôt que tues : un total plus court a sinon l'air d'un vrai résultat. */}
              {streamed.accounts > 0 &&
                ` · ${t('searchAccountProgress', { swept: streamed.sweptIds.length, accounts: streamed.accounts })}`}
              {streamed.unreachable.length > 0 &&
                ` · ${t('searchUnreachable', { count: streamed.unreachable.length })}`}
              {isSearching && streamed.folders === 0 && ` · ${t('searching')}`}
            </p>
            {/* Gardé sur `streaming` et non sur `isSearching` : avant que le compte
                soit résolu, aucun flux ne court encore — un bouton Arrêter n'aurait
                rien à arrêter. */}
            {streaming && isStreamingScope && (
              <button
                onClick={stopStream}
                className="shrink-0 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                {t('searchStop')}
              </button>
            )}
            {/* `IconTooltip` et non l'attribut `title` natif : une seule bulle, au style de
                l'application, posée sous l'icône. `align="end"` — l'icône est collée au
                bord droit de la liste, une bulle centrée en sortirait. */}
            <span className="ml-auto flex shrink-0 text-muted-foreground/60">
              <IconTooltip
                align="end"
                label={t('searchDetails', {
                  fields: t('searchFieldsLabel'),
                  scope: t(SCOPE_LABEL[searchScope]),
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
      {/* `select-none` : un rectangle qui démarre sur un en-tête de date surlignait
          du texte au passage — la sélection de texte naît au `mousedown`, qu'aucun
          `preventDefault()` posé au `mousemove` ne peut plus annuler. La liste n'a
          pas de texte à copier ; ailleurs (volet de lecture) rien ne change. */}
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
