'use client'

import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { COMPOSE_EVENT, COMPOSE_QUERY, MAIL_PATH } from '@/lib/compose'
import { SCOPE_PARAM, SEARCH_PARAM, focusSearch, readScope } from '@/lib/search'
import { ACCOUNT_CHANGE_EVENT, DEFAULT_FOLDER, FOLDER_PARAM, mailboxSwitchHref, pushFolder } from './mailboxUrl'
import { ArrowLeft } from 'lucide-react'
import useSWR from 'swr'
import { MessageList } from '@/components/layout/MessageList'
import { ReadingPane } from '@/components/layout/ReadingPane'
import { ThreadPane } from '@/components/layout/ThreadPane'
import { ComposeModal } from '@/components/mail/ComposeModal'
import { MdnToast } from '@/components/mail/MdnToast'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
import { toast } from '@/components/ui/toast'
import { useMailSelection, targetOrigins } from '@/lib/mailSelection'
import { groupByOrigin, messageHref, originOfMessage, sameOrigin, type MessageOrigin } from '@/lib/mailOrigin'
import { MAILBOX_CHANGED, STREAM_ACCOUNT_PARAM } from '@/lib/stream'
import type { ForwardedMessages } from '@/lib/forward'
import type { Message } from '@/types/email'
import type { EmailAccount } from '@/types/account'

const fetcher = (url: string) => fetch(url).then(r => r.json())

type SelectionMode = 'none' | 'single' | 'thread'

/** Les trois façons d'ouvrir la rédaction à partir d'un message. */
type ComposeKind = 'reply' | 'replyAll' | 'forward'

export function MailClient() {
  const t = useTranslations('mail')
  const [selectionMode, setSelectionMode] = useState<SelectionMode>('none')
  /**
   * Message ouvert, par son ORIGINE (compte, dossier, uid) : ouvrir un résultat
   * d'une recherche « tous les dossiers » doit le lire dans SON dossier, pas
   * dans celui qui est à l'écran — c'est ce raccourci qui ouvrait un autre
   * message, voire faisait tomber l'application.
   */
  const [selectedOrigin, setSelectedOrigin] = useState<MessageOrigin | null>(null)
  const [selectedThread, setSelectedThread] = useState<Message[] | null>(null)
  const [selectedThreadSubject, setSelectedThreadSubject] = useState<string>('')
  const [composeMode, setComposeMode] = useState<'compose' | 'reply' | 'replyAll' | 'forward' | null>(null)
  const [composeReplyTo, setComposeReplyTo] = useState<Message | null>(null)
  const [aiReplyDraft, setAiReplyDraft] = useState<string | null>(null)
  const [activeAccountId, setActiveAccountId] = useState<string | null>(null)
  const [showReadingPane, setShowReadingPane] = useState(false)
  const [currentMessage, setCurrentMessage] = useState<Message | null>(null)
  const [mdnToast, setMdnToast] = useState<{
    uid: string; accountId: string; folder: string;
    fromName: string; subject: string; dispositionNotificationTo: string
  } | null>(null)
  // Track which UIDs already had the MDN toast shown to avoid re-showing
  const shownMdnUids = useRef<Set<string>>(new Set())

  // Resizable list column
  const [listWidth, setListWidth] = useState(320)
  const listWidthRef = useRef(320)
  const isResizingRef = useRef(false)
  const startXRef = useRef(0)
  const startWidthRef = useRef(0)

  const searchParams = useSearchParams()
  const router = useRouter()
  /**
   * Un changement de boîte réécrit l'URL dans le même geste, mais le routeur ne
   * la relit qu'au rendu SUIVANT : pendant ce rendu-là, le compte est déjà le
   * nouveau et `searchParams` porte encore le dossier de l'ancien — la liste
   * partait alors chercher ce dossier DANS LA NOUVELLE BOÎTE (mesuré le
   * 20/09/2026 : 2 requêtes par changement). On lit donc les paramètres à
   * travers la MÊME fonction qui écrit l'URL, le temps que celle-ci suive :
   * les deux ne peuvent pas diverger, puisqu'il n'y en a qu'une.
   */
  const [switching, setSwitching] = useState(false)
  /** Les paramètres tels qu'ils seront, une fois l'URL rattrapée. */
  const switchedParams = useMemo(
    () => new URLSearchParams(mailboxSwitchHref(searchParams.toString()).split('?')[1] ?? ''),
    [searchParams],
  )
  const caughtUp = switchedParams.toString() === searchParams.toString()
  const effectiveParams = switching && !caughtUp ? switchedParams : searchParams
  // L'attente prend fin quand l'URL porte ce que le changement a écrit — mesuré
  // sur l'URL elle-même, jamais sur une minuterie.
  useEffect(() => { if (switching && caughtUp) setSwitching(false) }, [switching, caughtUp])

  const folder = effectiveParams.get(FOLDER_PARAM) ?? DEFAULT_FOLDER
  // La recherche vit dans l'URL : la barre d'application l'écrit, la liste la lit.
  const search = effectiveParams.get(SEARCH_PARAM) ?? ''
  const searchScope = readScope(effectiveParams.get(SCOPE_PARAM))

  const { data: settingsData } = useSWR<{ data: { active_account_id: string | null; list_width: number; notifications: boolean } }>('/api/settings', fetcher)
  const didInitFromSettings = useRef(false)
  useEffect(() => {
    if (!settingsData?.data || didInitFromSettings.current) return
    didInitFromSettings.current = true
    if (settingsData.data.active_account_id) setActiveAccountId(settingsData.data.active_account_id)
    const w = settingsData.data.list_width
    if (w >= 240 && w <= 600) {
      setListWidth(w)
      listWidthRef.current = w
    }
  }, [settingsData])

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizingRef.current) return
      const delta = e.clientX - startXRef.current
      const newWidth = Math.min(600, Math.max(240, startWidthRef.current + delta))
      listWidthRef.current = newWidth
      setListWidth(newWidth)
    }
    const handleMouseUp = () => {
      if (!isResizingRef.current) return
      isResizingRef.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ list_width: listWidthRef.current }),
      })
    }
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [])

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    isResizingRef.current = true
    startXRef.current = e.clientX
    startWidthRef.current = listWidthRef.current
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [])

  useEffect(() => {
    const handler = () => setComposeMode('compose')
    window.addEventListener(COMPOSE_EVENT, handler)
    return () => window.removeEventListener(COMPOSE_EVENT, handler)
  }, [])

  // Arrivée depuis une autre page avec `?compose=1` (barre latérale, tableau de
  // bord) : ouvrir la composition puis retirer le paramètre pour qu'un
  // rechargement ne la rouvre pas.
  useEffect(() => {
    if (!searchParams.get(COMPOSE_QUERY)) return
    setComposeMode('compose')
    const rest = new URLSearchParams(searchParams.toString())
    rest.delete(COMPOSE_QUERY)
    router.replace(rest.size ? `${MAIL_PATH}?${rest}` : MAIL_PATH)
  }, [searchParams, router])

  useEffect(() => {
    const handler = (e: Event) => {
      const id = (e as CustomEvent<string>).detail
      // La nouvelle boîte s'ouvre sur SA réception : le dossier de l'ancienne
      // n'existe souvent pas chez elle, et la liste partait le chercher pour
      // rien. L'URL est lue au moment de l'événement (elle est la source), pas
      // capturée à l'inscription de l'écouteur.
      const href = mailboxSwitchHref(window.location.search)
      // Même idiome que le sélecteur de portée de la barre : seuls des
      // PARAMÈTRES changent, et `router.replace` refait alors rendre la route
      // côté serveur (mesuré le 20/09/2026 dans ce dépôt : 4,0 s avant que
      // l'URL ne bouge). L'API d'historique, que le routeur suit depuis
      // Next 14.2, met `useSearchParams` à jour au rendu suivant — et ce rendu
      // a lieu, puisque le compte actif change juste après.
      if (href !== `${window.location.pathname}${window.location.search}`) {
        window.history.replaceState(null, '', href)
      }
      // Posé dans le MÊME lot que le compte : la liste ne voit jamais un rendu où
      // le compte a changé mais pas le dossier.
      setSwitching(true)
      setActiveAccountId(id)
      setSelectedOrigin(null)
      setSelectedThread(null)
      setSelectionMode('none')
      setCurrentMessage(null)
    }
    window.addEventListener(ACCOUNT_CHANGE_EVENT, handler)
    return () => window.removeEventListener(ACCOUNT_CHANGE_EVENT, handler)
  }, [])

  // Listen for notification click / "à traiter" click → open specific message
  useEffect(() => {
    const handler = (e: Event) => {
      const { uid, accountId, folder: targetFolder } = (e as CustomEvent<{ uid: string; accountId: string; folder?: string }>).detail
      // L'origine voyage entière : le volet lit le message dans SON dossier, sans
      // que la liste ait à changer de dossier d'abord. `pushFolder`: changement
      // d'URL côté client seul, sans rendu serveur (voir mailboxUrl.ts).
      if (targetFolder) pushFolder(targetFolder)
      handleSelect({ uid, accountId, folder: targetFolder ?? folder })
      setShowReadingPane(true)
    }
    window.addEventListener('synapmail:open-message', handler)
    return () => window.removeEventListener('synapmail:open-message', handler)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // `showReadingPane` ne dit qu'UNE chose : un message est ouvert. Au-dessus de `lg` il
  // n'a aucun effet de mise en page (les deux colonnes portent `lg:flex` dans les deux
  // états) ; en dessous, c'est lui qui décide LAQUELLE des deux colonnes occupe l'écran.
  // L'initialiser depuis le réglage `reading_pane` faisait donc arriver sur le volet de
  // lecture, sans liste à cliquer, en fenêtre étroite (mesuré le 20/09/2026 à 900 px sur
  // le staging) — alors que ce réglage vise la vue à DEUX colonnes.

  const { data: accountsData } = useSWR<{ data: EmailAccount[] }>(
    '/api/accounts',
    fetcher
  )

  const accounts = accountsData?.data ?? []
  const resolvedActiveId = activeAccountId ?? accounts.find(a => a.isDefault)?.id ?? accounts[0]?.id
  const activeAccount = accounts.find(a => a.id === resolvedActiveId) ?? accounts[0]
  const accountEmail = activeAccount?.email ?? ''
  const accountId = selectedOrigin?.accountId ?? resolvedActiveId ?? ''
  // Defense-in-depth only — the API routes are the real permission boundary.
  // Owned accounts don't carry `permissions` (POST /api/accounts doesn't return it), hence the permissive fallback.
  const permissions = activeAccount?.permissions ?? {
    canSend: true, canDelete: true, canOrganize: true, canManageRules: true, canManageSignatures: true,
  }

  const { state: mailTarget, register: registerMailActions, run: runMail } = useMailSelection()

  // Flux SSE : événements du planificateur ET temps réel de la boîte. Le compte
  // actif est passé au serveur, qui met sa boîte de réception sous IDLE ; changer
  // de compte rouvre le flux sur la nouvelle boîte.
  useEffect(() => {
    const url = resolvedActiveId
      ? `/api/stream?${STREAM_ACCOUNT_PARAM}=${encodeURIComponent(resolvedActiveId)}`
      : '/api/stream'
    const es = new EventSource(url)
    es.onmessage = (e: MessageEvent<string>) => {
      try {
        const data = JSON.parse(e.data) as { type: string; subject?: string; to?: string }
        if (data.type === 'scheduled_sent') {
          toast.add({
            title: 'Email envoyé',
            description: `"${data.subject}" → ${data.to}`,
            type: 'success',
            timeout: 6000,
          })
          window.dispatchEvent(new CustomEvent('synapmail:scheduled-sent'))
        } else if (data.type === MAILBOX_CHANGED) {
          // La liste sait déjà se relire : on déclenche SON action, aucune
          // logique de relecture dupliquée ici.
          runMail('refresh')
        }
      } catch { /* ignore malformed */ }
    }
    return () => es.close()
  }, [resolvedActiveId, runMail])

  const handleSelect = useCallback((origin: MessageOrigin) => {
    setSelectedOrigin(origin)
    setSelectedThread(null)
    setSelectionMode('single')
    setShowReadingPane(true)
  }, [])

  const handleSelectThread = useCallback((messages: Message[], subject: string) => {
    setSelectedThread([...messages].reverse())
    setSelectedThreadSubject(subject)
    setSelectedOrigin(null)
    setSelectionMode('thread')
    setShowReadingPane(true)
  }, [])

  const handleReply = useCallback((msg: Message) => {
    setComposeReplyTo(msg)
    setComposeMode('reply')
  }, [])

  const handleReplyAll = useCallback((msg: Message) => {
    setComposeReplyTo(msg)
    setComposeMode('replyAll')
  }, [])

  const handleForward = useCallback((msg: Message) => {
    setComposeReplyTo(msg)
    setComposeMode('forward')
  }, [])

  const handleDelete = useCallback(() => {
    setSelectedOrigin(null)
    setSelectedThread(null)
    setSelectionMode('none')
    setShowReadingPane(false)
    setCurrentMessage(null)
  }, [])

  // The card names its message by ORIGIN: a thread can hold the same uid twice
  // (inbox copy and sent copy), and only the triplet tells them apart.
  const handleThreadDelete = useCallback((origin: MessageOrigin) => {
    if (!selectedThread) return
    const remaining = selectedThread.filter(m => !sameOrigin(originOfMessage(m), origin))
    if (remaining.length === selectedThread.length) return
    if (remaining.length === 0) {
      handleDelete()
    } else {
      setSelectedThread(remaining)
    }
    fetch(messageHref(origin), { method: 'DELETE' })
  }, [selectedThread, handleDelete])

  const handleBack = useCallback(() => {
    setShowReadingPane(false)
    setSelectedOrigin(null)
    setSelectedThread(null)
    setSelectionMode('none')
    setCurrentMessage(null)
  }, [])

  // Keyboard shortcut: delete current message
  const handleKbDelete = useCallback(async (msg: Message) => {
    await fetch(messageHref(originOfMessage(msg)), { method: 'DELETE' })
    handleDelete()
  }, [handleDelete])

  // Répondre / Répondre à tous / Transférer pour une barre d'outils hors du volet de
  // lecture (contexte `lib/mailSelection`). La cible est le message sélectionné, sinon
  // le message ouvert. Si elle n'est pas encore chargée (une ligne Cmd-cliquée sans
  // être ouverte), on l'ouvre et l'action part dès que le message arrive.
  // La cible différée retient le message VISÉ, pas seulement le geste : sans lui, ouvrir
  // une autre ligne (ou un message poussé par une notification) pendant le chargement
  // ferait répondre au mauvais message, à l'insu de la personne.
  const pendingCompose = useRef<{ kind: ComposeKind; origin: MessageOrigin } | null>(null)
  // Transfert d'une sélection MULTIPLE : chaque message part entier en pièce
  // jointe. Aucun message n'est ouvert pour ça — on n'a besoin que du compte
  // d'ORIGINE, du dossier et des uid cochés, que le serveur relit lui-même
  // (lot M5). Le compte d'origine voyage avec la sélection : l'expéditeur choisi
  // dans « De » peut en être un autre, et les uid se ressemblent d'une boîte à
  // l'autre.
  const [forwardedMessages, setForwardedMessages] = useState<ForwardedMessages | null>(null)
  const composeHandlers = useMemo(
    () => ({ reply: handleReply, replyAll: handleReplyAll, forward: handleForward }),
    [handleReply, handleReplyAll, handleForward]
  )

  useEffect(() => {
    const composeFromToolbar = (kind: ComposeKind) => () => {
      const origins = targetOrigins(mailTarget)
      if (kind === 'forward' && origins.length > 1) {
        // Un transfert multiple relit les messages à la source, dans UN dossier :
        // l'origine part avec la sélection, jamais le dossier affiché. Une
        // sélection qui mêle des dossiers n'arrive pas ici (`deriveCapabilities`
        // désactive alors le transfert), mais la garde reste : un seul groupe.
        const groups = groupByOrigin(origins)
        if (groups.length !== 1) return
        setForwardedMessages(groups[0])
        setComposeReplyTo(null)
        setComposeMode('forward')
        return
      }
      const origin = origins[0]
      if (!origin) return
      if (currentMessage && sameOrigin(originOfMessage(currentMessage), origin)) {
        return composeHandlers[kind](currentMessage)
      }
      pendingCompose.current = { kind, origin }
      handleSelect(origin)
    }
    registerMailActions({
      reply: composeFromToolbar('reply'),
      replyAll: composeFromToolbar('replyAll'),
      forward: composeFromToolbar('forward'),
    })
  }, [registerMailActions, mailTarget, currentMessage, composeHandlers, handleSelect])

  // Keyboard shortcut: mark unread
  const handleMessageLoaded = useCallback((msg: Message) => {
    setCurrentMessage(msg)
    const pending = pendingCompose.current
    if (pending) {
      pendingCompose.current = null
      if (sameOrigin(pending.origin, originOfMessage(msg))) composeHandlers[pending.kind](msg)
    }
    // Show MDN toast if requested and not already shown for this message
    if (
      msg.dispositionNotificationTo &&
      !shownMdnUids.current.has(msg.uid)
    ) {
      shownMdnUids.current.add(msg.uid)
      setMdnToast({
        uid: msg.uid,
        accountId: msg.accountId,
        folder: msg.folder,
        fromName: msg.from.name || msg.from.address,
        subject: msg.subject,
        dispositionNotificationTo: msg.dispositionNotificationTo,
      })
    }
  }, [composeHandlers])

  const handleKbMarkUnread = useCallback(async (msg: Message) => {
    await fetch(messageHref(originOfMessage(msg)), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isRead: false }),
    })
  }, [])

  // Keyboard shortcuts
  useKeyboardShortcuts({
    onCompose: () => setComposeMode('compose'),
    onReply: handleReply,
    onReplyAll: handleReplyAll,
    onForward: handleForward,
    onDelete: handleKbDelete,
    onMarkUnread: handleKbMarkUnread,
    onFocusSearch: focusSearch,
    currentMessage,
    composeOpen: composeMode !== null,
    onCloseCompose: () => { setComposeMode(null); setComposeReplyTo(null); setForwardedMessages(null) },
  })

  const listSelectedOrigin = selectionMode === 'single' ? selectedOrigin : null

  const composeReplyToProp = composeReplyTo ? {
    uid: composeReplyTo.uid,
    from: composeReplyTo.from,
    to: composeReplyTo.to,
    cc: composeReplyTo.cc,
    subject: composeReplyTo.subject,
    bodyHtml: composeReplyTo.bodyHtml,
    bodyPlain: composeReplyTo.bodyPlain,
    date: composeReplyTo.date,
    accountId: composeReplyTo.accountId,
    attachments: composeMode === 'forward' && composeReplyTo.attachments?.length
      ? composeReplyTo.attachments.map(a => ({
          ...a,
          uid: composeReplyTo.uid,
          accountId: composeReplyTo.accountId,
          folder,
        }))
      : undefined,
  } : undefined

  return (
    <div className="flex h-full min-h-0">
      <div
        className={`${showReadingPane ? 'hidden lg:flex' : 'flex'} w-full lg:w-[var(--synap-list-w)] shrink-0 flex-col border-r border-border`}
        style={{ '--synap-list-w': `${listWidth}px` } as React.CSSProperties}
      >
        <MessageList
          folder={folder}
          selectedOrigin={listSelectedOrigin}
          onSelect={handleSelect}
          onSelectThread={handleSelectThread}
          activeAccountId={resolvedActiveId}
          search={search}
          searchScope={searchScope}
          permissions={permissions}
        />
      </div>

      {/* Resize handle — desktop only */}
      <div
        className="hidden lg:block w-1 shrink-0 bg-transparent hover:bg-primary/30 active:bg-primary/50 cursor-col-resize transition-colors"
        onMouseDown={handleResizeStart}
      />

      <div className={`${showReadingPane ? 'flex' : 'hidden lg:flex'} flex-col flex-1 overflow-hidden min-w-0`}>
        {showReadingPane && (
          <div className="lg:hidden flex items-center gap-2 px-4 py-2 border-b border-border shrink-0">
            <button onClick={handleBack} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
              <ArrowLeft className="w-4 h-4" />
              {t('back')}
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
              uid={selectedOrigin?.uid ?? null}
              accountId={selectedOrigin?.accountId ?? null}
              folder={selectedOrigin?.folder ?? folder}
              activeAccountId={resolvedActiveId}
              onDelete={handleDelete}
              onReply={handleReply}
              onReplyAll={handleReplyAll}
              onForward={handleForward}
              onMessageLoaded={handleMessageLoaded}
              onAiReply={(draft) => setAiReplyDraft(draft)}
              permissions={permissions}
            />
          )}
        </div>
      </div>

      {composeMode && (
        <ComposeModal
          mode={composeMode}
          replyTo={composeReplyToProp}
          forwardedMessages={forwardedMessages ?? undefined}
          accountEmail={accountEmail}
          accountId={accountId}
          initialBody={aiReplyDraft ?? undefined}
          onClose={() => { setComposeMode(null); setComposeReplyTo(null); setForwardedMessages(null); setAiReplyDraft(null) }}
          onSent={() => { setComposeMode(null); setComposeReplyTo(null); setForwardedMessages(null); setAiReplyDraft(null) }}
          canSend={permissions.canSend}
        />
      )}

      {mdnToast && (
        <MdnToast
          uid={mdnToast.uid}
          accountId={mdnToast.accountId}
          folder={mdnToast.folder}
          fromName={mdnToast.fromName}
          subject={mdnToast.subject}
          dispositionNotificationTo={mdnToast.dispositionNotificationTo}
          onDismiss={() => setMdnToast(null)}
        />
      )}
    </div>
  )
}
