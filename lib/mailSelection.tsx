'use client'

/**
 * Shared mailbox state — the single source of what a mail toolbar needs to know,
 * and of the actions it can trigger.
 *
 * The message list PUBLISHES the account, the folder, the selection and the open
 * message here, then REGISTERS its actions. Every consumer (context menu,
 * app-bar toolbar) only READS the state and CALLS those actions: no mail logic
 * lives outside the list.
 *
 * Outside the mailbox the provider has received nothing: the target is empty and
 * every capability is false.
 */

import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import { Archive, Flag, Forward, Mail, MoveRight, RefreshCw, Reply, ReplyAll, Trash2, MailX } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { groupByOrigin, sameOrigin, type MessageOrigin } from './mailOrigin'

/** Flag colour — `null` clears the flag. */
export type MailFlagValue = string | null

/**
 * The seven-flag palette lives in `lib/flags.ts` (keys, IMAP indexes, colours)
 * and is rendered by `components/mail/FlagPicker.tsx`: a toolbar that offers
 * colours mounts THAT component. No second list here — the previous one had
 * already drifted from the source (`grey` versus `gray`).
 */

/** Actions a toolbar can trigger. An unregistered action does nothing. */
export interface MailActions {
  refresh: () => void
  reply: () => void
  replyAll: () => void
  forward: () => void
  archive: () => void
  remove: () => void
  spam: () => void
  setFlag: (flag: MailFlagValue) => void
  markRead: () => void
  markUnread: () => void
  moveTo: (destination: string) => void
  /** Defers the target: it disappears from the list until this date. */
  snooze: (until: Date) => void
}

export type MailActionName = keyof MailActions

/** What the list publishes on every render. */
export interface MailSelectionState {
  /** The DISPLAYED mailbox and folder — the list's context, not the targets' origin. */
  accountId: string | null
  folder: string | null
  /**
   * Selected rows, each with ITS OWN origin: an "all folders" search mixes
   * several, and a uid only identifies a message within its own folder. Empty =
   * the target is the open message.
   */
  selected: MessageOrigin[]
  /** Message open in the reading pane, with its origin, if there is one. */
  open: MessageOrigin | null
  /** Sharing permissions of the active account (see lib/accountAccess.ts on the server). */
  canSend: boolean
  canDelete: boolean
  canOrganize: boolean
  /** Does an archive / junk folder exist on this account? */
  hasArchive: boolean
  hasSpam: boolean
}

export type MailCapabilities = Record<MailActionName, boolean>

const EMPTY_STATE: MailSelectionState = {
  accountId: null,
  folder: null,
  selected: [],
  open: null,
  canSend: false,
  canDelete: false,
  canOrganize: false,
  hasArchive: false,
  hasSpam: false,
}

/**
 * How many messages the actions would target: the selection if there is one,
 * otherwise the open message. A toolbar shows this count; the capabilities are
 * derived from it.
 */
export function targetOrigins(state: MailSelectionState): MessageOrigin[] {
  if (state.selected.length) return state.selected
  return state.open ? [state.open] : []
}

export function targetCount(state: MailSelectionState): number {
  return targetOrigins(state).length
}

/**
 * Targets grouped by origin: ONE request per (account, folder) group. Every bulk
 * action goes through this — never through the displayed folder.
 */
export function targetGroups(state: MailSelectionState) {
  return groupByOrigin(targetOrigins(state))
}

export function deriveCapabilities(state: MailSelectionState): MailCapabilities {
  const n = targetCount(state)
  const organize = n > 0 && state.canOrganize
  // A multi-message forward re-reads the sources from ONE folder of ONE mailbox
  // (`lib/forward.ts`): a selection mixing several has no single origin to
  // announce, and forwarding it would attach the messages carrying the same uids
  // from the wrong folder. The button disables itself — that is the honest
  // answer, and it costs no second list of rules. Kept this way until a measured
  // need requires one send per origin.
  const oneOrigin = targetGroups(state).length <= 1
  return {
    refresh: !!state.accountId,
    // Replying targets ONE message: on a multiple selection the action is meaningless.
    reply: n === 1 && state.canSend,
    replyAll: n === 1 && state.canSend,
    forward: n > 0 && state.canSend && oneOrigin,
    archive: organize && state.hasArchive,
    remove: n > 0 && state.canDelete,
    spam: organize && state.hasSpam,
    setFlag: organize,
    markRead: organize,
    markUnread: organize,
    moveTo: organize,
    snooze: organize,
  }
}

/**
 * Canonical button order, matching a desktop mail client's toolbar: fetch |
 * archive, delete, junk | reply, reply all, forward | flag, unread, move. A
 * toolbar reads THIS table — the order, the labels and the icons are not copied
 * anywhere else.
 */
export interface MailToolbarItem {
  action: MailActionName
  /** i18n key, under the `mail` namespace. */
  labelKey: string
  Icon: LucideIcon
  /**
   * Key that triggers the same action from the keyboard
   * (`hooks/useKeyboardShortcuts.ts`), shown in the button tooltip. Absent = the
   * action has no shortcut.
   */
  shortcut?: string
}

export const MAIL_TOOLBAR_GROUPS: readonly (readonly MailToolbarItem[])[] = [
  [{ action: 'refresh', labelKey: 'refresh', Icon: RefreshCw }],
  [
    { action: 'archive', labelKey: 'archiveAction', Icon: Archive },
    { action: 'remove', labelKey: 'delete', Icon: Trash2, shortcut: '⌦' },
    { action: 'spam', labelKey: 'spam', Icon: MailX },
  ],
  [
    { action: 'reply', labelKey: 'reply', Icon: Reply, shortcut: 'R' },
    { action: 'replyAll', labelKey: 'replyAll', Icon: ReplyAll, shortcut: 'A' },
    { action: 'forward', labelKey: 'forward', Icon: Forward, shortcut: 'F' },
  ],
  [
    { action: 'setFlag', labelKey: 'flag', Icon: Flag },
    { action: 'markUnread', labelKey: 'markUnread', Icon: Mail, shortcut: 'U' },
    { action: 'moveTo', labelKey: 'move', Icon: MoveRight },
  ],
] as const

interface MailSelectionContextValue {
  state: MailSelectionState
  can: MailCapabilities
  count: number
  /** Calls the registered action, or does nothing when the capability is false. */
  run: <K extends MailActionName>(name: K, ...args: Parameters<MailActions[K]>) => void
  /** Mailbox-only: publishes the state (`null` = the mailbox was left, empty target). */
  publish: (state: MailSelectionState | null) => void
  /** Mailbox-only: adds actions to the registry without erasing the others'. */
  register: (actions: Partial<MailActions>) => void
}

const MailSelectionContext = createContext<MailSelectionContextValue | null>(null)

export function MailSelectionProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<MailSelectionState>(EMPTY_STATE)
  // The actions get a new identity on every render of the list: keeping them in a
  // ref avoids re-rendering every consumer for nothing.
  const actionsRef = useRef<Partial<MailActions>>({})

  const publish = useCallback((next: MailSelectionState | null) => {
    const value = next ?? EMPTY_STATE
    setState(prev => (sameState(prev, value) ? prev : value))
  }, [])

  const register = useCallback((actions: Partial<MailActions>) => {
    actionsRef.current = { ...actionsRef.current, ...actions }
  }, [])

  const can = useMemo(() => deriveCapabilities(state), [state])
  const count = targetCount(state)

  // `run` is stable: it reads the current state through a ref rather than a closure.
  const stateRef = useRef(state)
  stateRef.current = state

  const run = useCallback<MailSelectionContextValue['run']>((name, ...args) => {
    if (!deriveCapabilities(stateRef.current)[name]) return
    const fn = actionsRef.current[name] as ((...a: unknown[]) => void) | undefined
    fn?.(...args)
  }, [])

  const value = useMemo(
    () => ({ state, can, count, run, publish, register }),
    [state, can, count, run, publish, register]
  )

  return <MailSelectionContext.Provider value={value}>{children}</MailSelectionContext.Provider>
}

function sameOpen(a: MessageOrigin | null, b: MessageOrigin | null): boolean {
  return a === b || (!!a && !!b && sameOrigin(a, b))
}

function sameState(a: MailSelectionState, b: MailSelectionState): boolean {
  return (
    a.accountId === b.accountId &&
    a.folder === b.folder &&
    a.canSend === b.canSend &&
    a.canDelete === b.canDelete &&
    a.canOrganize === b.canOrganize &&
    a.hasArchive === b.hasArchive &&
    a.hasSpam === b.hasSpam &&
    sameOpen(a.open, b.open) &&
    a.selected.length === b.selected.length &&
    a.selected.every((origin, i) => sameOrigin(origin, b.selected[i]))
  )
}

/** Read-only access + triggering, for any consumer (menu, toolbar). */
export function useMailSelection(): MailSelectionContextValue {
  const ctx = useContext(MailSelectionContext)
  if (ctx) return ctx
  // Outside the mailbox the provider may not be mounted: empty state, everything false.
  return FALLBACK
}

const FALLBACK: MailSelectionContextValue = {
  state: EMPTY_STATE,
  can: deriveCapabilities(EMPTY_STATE),
  count: 0,
  run: () => {},
  publish: () => {},
  register: () => {},
}

/**
 * Attribute the list sets on its container: how many messages are targeted. The
 * measurement harness reads it from the DOM — no global variable in production.
 */
export const MAIL_SELECTION_COUNT_ATTR = 'data-mail-selection-count'
