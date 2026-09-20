'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import {
  Mail, Send, FileText, AlertTriangle, Trash2,
  Folder, FolderPlus, Archive, ChevronDown, RefreshCw, Share2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import useSWR from 'swr'
import { useState, useEffect, useRef, useCallback } from 'react'
import { ACCENT, AccountAvatar, BADGE_OFFSET_PX, UnreadBadge, useAccountAccent } from './AccountAvatar'
import { IconTooltip } from '@/components/ui/IconTooltip'
import { folderGlyph, folderInitials } from './FolderGlyph'
import { ThinScroll } from './ThinScroll'
import { ACCOUNTS_SETTINGS_HREF } from '@/components/settings/SettingsSidebar'
import { FolderContextMenu, type FolderMenuState } from './FolderContextMenu'
import { accountDelimiter, isDescendant, sanitizeFolderName, type FolderAction } from '@/lib/folderActions'
import type { EmailAccount } from '@/types/account'

/**
 * Single source for the bar's geometry. `AppShell` sizes the <aside> from it and
 * the bar exposes `collapsedWidth` as the CSS var consumed by every icon column,
 * so an icon sits at the exact same x in both states.
 */
export const SIDEBAR = {
  expandedWidth: 256,
  collapsedWidth: 56,
  transitionMs: 180,
  /** Height of one row, published as `--synap-row-h` and consumed by the `ROW` class. */
  rowHeight: 36,
  /** Vertical padding above and below the header row carrying the account. */
  headerPadY: 8,
  /** Rows the unfolded account list shows before it starts scrolling. */
  accountListRows: 8,
  /** Past this many other accounts the list offers a filter field. */
  accountFilterFrom: 8,
} as const

/** The bar's surface, as a CSS value: the theme's own sidebar token, so the bar
 *  follows light/dark instead of forcing a dark background. Published on the root
 *  as `--synap-surface` so a badge pinned on an avatar rings itself with the
 *  surface actually behind it, in either theme. */
const SURFACE = 'var(--sidebar)'

const fetcher = (url: string) => fetch(url).then(r => r.json())

type SpecialKey = 'inbox' | 'sent' | 'drafts' | 'spam' | 'trash' | 'archive' | null

const SPECIAL_ICONS: Record<NonNullable<SpecialKey>, React.ComponentType<{ className?: string }>> = {
  inbox: Mail,
  sent: Send,
  drafts: FileText,
  spam: AlertTriangle,
  trash: Trash2,
  archive: Archive,
}

const SPECIAL_LABELS: Record<NonNullable<SpecialKey>, string> = {
  inbox: 'inbox',
  sent: 'sent',
  drafts: 'drafts',
  spam: 'spam',
  trash: 'trash',
  archive: 'archive',
}

type FolderItem = { name: string; path: string; delimiter: string; special: SpecialKey; unreadCount?: number }


/** Rows drawn while the folder list loads — static placeholders, never a pulse. */
const FOLDER_PLACEHOLDERS = [0, 1, 2, 3, 4]

// One row pattern for every entry of the bar (folder, link, account, action).
const ROW = 'flex w-full items-center h-[var(--synap-row-h)] rounded-lg transition-colors'
// Idle ink is derived from the theme's own foreground rather than the muted token:
// muted-foreground on the light sidebar measures ~3.2:1, under the 4.5:1 floor for
// body text. At 70% opacity the same ink measures 5.8:1 light / 7.0:1 dark — the
// check recomputes both from the rendered rows, so the floor is enforced, not asserted.
const ROW_IDLE = 'text-foreground/70 hover:text-foreground hover:bg-foreground/[0.06]'
const ROW_ACTIVE = cn(ACCENT.tint, 'text-foreground font-medium')
// Drop target: the same accent, one step stronger — not a second colour.
const ROW_DRAG = cn(ACCENT.tintStrong, 'text-foreground')
// Fixed-width column: never shrinks, so collapsing the bar cannot move an icon.
const ICON_COL = 'shrink-0 flex items-center justify-center w-[var(--synap-icon-col)]'
// Collapsible half of a row: folds to zero width, clipped by its own overflow.
const ROW_LABEL = 'flex-1 min-w-0 flex items-center gap-2 pr-3 text-sm whitespace-nowrap overflow-hidden transition-opacity'
// Right-hand controls of an account row, in pixels — the ONE source both the chevron
// and the share mark are laid out from. The chevron sits INSIDE the row (last child of
// its label) while the mark is an absolute sibling, because a link cannot nest in a
// button: two different flows, so their boxes are only disjoint if they are derived
// from the same numbers rather than hand-tuned apart.
const ACCOUNT_ROW_RIGHT = {
  /** Clearance every row keeps between its content and the bar's right edge. */
  edge: 12,
  /** Box of the fold chevron — present only when there are several accounts. */
  chevron: 28,
  /** Box of the share mark — present only on a shared account's row. */
  mark: 28,
  /** Clearance kept between the two boxes, and between the mark and the text. */
  gap: 8,
} as const

// Columns of an account row, read from its RIGHT edge inwards: chevron, then mark, then
// the text. Every offset below is derived from that single order, so the two boxes cannot
// drift onto each other the way they did when each was padded on its own.

/** Right offset of the share mark: past the edge, and past the chevron when there is one. */
function markRight(withChevron: boolean) {
  const { edge, chevron, gap } = ACCOUNT_ROW_RIGHT
  return edge + (withChevron ? chevron + gap : 0)
}

/** Distance from the row's right edge at which a shared row's text has to stop. */
function textStop(withChevron: boolean) {
  const { mark, gap } = ACCOUNT_ROW_RIGHT
  return markRight(withChevron) + mark + gap
}

/**
 * Right margin the TEXT of a SHARED row gives up, counted from where the row's IN-FLOW
 * content already ends — the edge clearance, plus the chevron column when the row has
 * one. The chevron pushes the text by itself; only the absolute mark has to be reserved
 * for. Padding the whole label for the mark instead would push the chevron out with it,
 * which is exactly how the two controls came to sit on the same 28 px.
 */
function textInset(withChevron: boolean) {
  const { edge, chevron } = ACCOUNT_ROW_RIGHT
  return textStop(withChevron) - edge - (withChevron ? chevron : 0)
}

/**
 * The ONLY sign that an inbox is shared: one monochrome glyph, in a fixed column
 * at the right of the row. It carries its own box, so the name and the email of a
 * shared account start at the exact same x as any other account's. Clicking it
 * goes to where a share is removed, without switching the active account.
 */
function SharedMark({ account, label, withChevron = false, hidden = false }: {
  account: EmailAccount
  label: string
  /** The row also carries a fold chevron: the mark steps one column left of it. */
  withChevron?: boolean
  hidden?: boolean
}) {
  if (!account.isShared) return null
  return (
    <Link
      href={ACCOUNTS_SETTINGS_HREF}
      title={label}
      aria-label={label}
      data-account-shared-mark
      style={{ right: markRight(withChevron), width: ACCOUNT_ROW_RIGHT.mark }}
      className={cn(
        'absolute top-0 h-full flex items-center justify-center',
        'text-muted-foreground hover:text-foreground transition-colors',
        hidden && 'hidden',
      )}
    >
      <Share2 className="w-3.5 h-3.5" />
    </Link>
  )
}

interface SidebarProps {
  /** Mobile drawer only: closes the drawer after a navigation. */
  onClose?: () => void
  collapsed?: boolean
}

/** Icon column + collapsible label — shared by every row so all rows stay aligned. */
function RowBody({
  icon: Icon, iconClassName, label, badge = 0, collapsed,
}: {
  icon: React.ComponentType<{ className?: string }>
  iconClassName?: string
  label: React.ReactNode
  /** Unread count — rendered ON the icon, never as a pill to the right of the label. */
  badge?: number
  collapsed: boolean
}) {
  return (
    <>
      <span className={ICON_COL}>
        <span className="relative inline-flex">
          <Icon className={cn('w-4 h-4', iconClassName)} data-sidebar-icon />
          <UnreadBadge count={badge} />
        </span>
      </span>
      <span
        className={cn(ROW_LABEL, collapsed && 'opacity-0')}
        style={{ transitionDuration: `${SIDEBAR.transitionMs}ms` }}
        aria-hidden={collapsed}
      >
        <span className="flex-1 truncate text-left">{label}</span>
      </span>
    </>
  )
}

export function Sidebar({ onClose, collapsed = false }: SidebarProps) {
  const t = useTranslations('mail')
  const pathname = usePathname()
  const [currentFolder, setCurrentFolder] = useState('INBOX')
  const [accountOpen, setAccountOpen] = useState(false)
  const [accountFilter, setAccountFilter] = useState('')
  const accountBoxRef = useRef<HTMLDivElement>(null)
  const [dragOverPath, setDragOverPath] = useState<string | null>(null)
  const [folderMenu, setFolderMenu] = useState<FolderMenuState | null>(null)
  /** INLINE entry of a folder name — never `window.prompt`. An empty `path` = create at the root. */
  const [naming, setNaming] = useState<{ action: 'create' | 'createChild' | 'rename'; parent: string; path: string; value: string } | null>(null)
  const [folderError, setFolderError] = useState<string | null>(null)

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search)
      setCurrentFolder(params.get('folder') ?? 'INBOX')
    }
  }, [pathname])

  // Close the account dropdown on outside click / Escape
  useEffect(() => {
    if (!accountOpen) return
    // On `click`, NOT on `mousedown`: the list is in the bar's flow, so folding it pulls
    // every row underneath it upwards. Dismissing on mousedown moves the row out from
    // under the cursor before mouseup, and the browser then resolves the click on
    // whatever slid into its place — the "the dismiss ate my click" bug the design rule
    // forbids. By the click phase the target is already settled on the unshifted layout.
    const onClick = (e: MouseEvent) => {
      if (accountBoxRef.current && !accountBoxRef.current.contains(e.target as Node)) setAccountOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setAccountOpen(false) }
    document.addEventListener('click', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('click', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [accountOpen])

  useEffect(() => {
    if (!accountOpen) setAccountFilter('')
  }, [accountOpen])

  const toggleAccountList = useCallback(() => setAccountOpen(o => !o), [])

  // Active account + the accent it publishes — the same hook the shell's edge toggle
  // subscribes to, so the bar and the button straddling its edge can never disagree.
  const { accounts, activeAccount, colorIndex: accountColorIdx, vars: accentStyle, switchAccount } = useAccountAccent()
  const hasMultipleAccounts = accounts.length > 1
  const resolvedAccountId = activeAccount?.id ?? null

  const totalUnread = accounts.reduce((sum, a) => sum + (a.unreadCount ?? 0), 0)
  const otherUnread = totalUnread - (activeAccount?.unreadCount ?? 0)
  // The list offers the OTHER accounts only: the active one already heads the bar,
  // repeating it as a row would be a line that does nothing.
  const otherAccounts = accounts.filter(acc => acc.id !== activeAccount?.id)
  const filteredAccounts = otherAccounts.filter(acc => {
    const q = accountFilter.trim().toLowerCase()
    return !q || acc.email.toLowerCase().includes(q) || (acc.name ?? '').toLowerCase().includes(q)
  })

  const { data: foldersData, error: foldersError, mutate: mutateFolders } = useSWR<{ data: FolderItem[] }>(
    resolvedAccountId ? `/api/folders?account=${resolvedAccountId}` : '/api/folders',
    fetcher,
    { revalidateOnFocus: false }
  )

  const foldersLoading = !foldersData && !foldersError
  const folders: FolderItem[] = foldersData?.data ?? []
  const specialFolders = folders.filter(f => f.special)
  const customFolders = folders.filter(f => !f.special)
  // Resolved once per list: a folder grows to two letters only when a sibling shares its first.
  const customInitials = folderInitials(customFolders)

  // The switch itself lives in `useAccountAccent` (single source, shared with the
  // omnibar); here we only add closing the expanded list on top of it.
  const pickAccount = (id: string) => {
    switchAccount(id)
    setAccountOpen(false)
  }

  const handleFolderClick = (path?: string) => {
    if (path) setCurrentFolder(path)
    onClose?.()
  }

  const handleDragOver = (e: React.DragEvent, path: string) => {
    if (!e.dataTransfer.types.includes('application/synapmail')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverPath(path)
  }

  const handleDragLeave = () => setDragOverPath(null)

  const handleDrop = async (e: React.DragEvent, destinationPath: string) => {
    e.preventDefault()
    setDragOverPath(null)
    const raw = e.dataTransfer.getData('application/synapmail')
    if (!raw) return
    const { uids, accountId, folder } = JSON.parse(raw) as { uids: string[]; accountId: string; folder: string }
    if (!uids?.length || destinationPath === folder) return
    await fetch('/api/messages/bulk', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uids, action: 'move', accountId, folder, destination: destinationPath }),
    })
  }

  /**
   * One account of the unfolded list. Same row pattern as everything else in the bar:
   * a fixed icon column, then a label that folds away — so a collapsed bar shows the
   * bubbles alone, at the exact x the header's bubble sits at, and the name and the
   * address move into the tooltip instead of overflowing 56 px.
   */
  const accountRow = (acc: EmailAccount) => {
    const label = acc.name || acc.email
    const bubble = (
      <AccountAvatar account={acc} colorIndex={accounts.indexOf(acc)} unread={acc.unreadCount ?? 0} />
    )
    return (
      // The row is a button, the shared mark is a link: a link nested in a button is
      // invalid HTML, so they are siblings and the mark sits in the gutter the row
      // reserves for it (textInset). A list row never carries a chevron, so it
      // reserves for the mark alone.
      <div key={acc.id} className="relative">
        <button
          onClick={() => pickAccount(acc.id)}
          data-sidebar-row={`account:${acc.id}`}
          className={cn(ROW, ROW_IDLE, 'text-left')}
        >
          <span className={ICON_COL}>
            {collapsed ? <IconTooltip label={acc.name ? t('accountTooltip', { name: acc.name, email: acc.email }) : acc.email} align="start">{bubble}</IconTooltip> : bubble}
          </span>
          <span
            className={cn(ROW_LABEL, collapsed && 'opacity-0')}
            style={{ transitionDuration: `${SIDEBAR.transitionMs}ms`, paddingRight: ACCOUNT_ROW_RIGHT.edge }}
            aria-hidden={collapsed}
          >
            <span
              className="flex-1 min-w-0 text-left"
              style={acc.isShared ? { marginRight: textInset(false) } : undefined}
            >
              <span className="block text-sm font-medium truncate leading-tight">{label}</span>
              {acc.name && (
                <span className="block text-[11px] text-muted-foreground truncate leading-tight">{acc.email}</span>
              )}
            </span>
          </span>
        </button>
        {!collapsed && <SharedMark account={acc} label={t('sharedBy', { name: acc.ownerName ?? acc.email })} />}
      </div>
    )
  }

  // Permissions of the active account — the menu greys out what the server will refuse.
  const canOrganize = activeAccount?.permissions?.canOrganize ?? true
  const canDelete = activeAccount?.permissions?.canDelete ?? true

  const openFolderMenu = (e: React.MouseEvent, folder: FolderItem) => {
    e.preventDefault()
    setFolderError(null)
    setFolderMenu({
      x: e.clientX,
      y: e.clientY,
      path: folder.path,
      name: folder.name,
      special: folder.special === 'archive' ? null : folder.special,
      hasChildren: folders.some(f => isDescendant(f.path, folder.path, folder.delimiter)),
    })
  }

  /** The server has the final say: its message replaces any optimism from the UI. */
  const callFolderApi = async (input: string, init: RequestInit) => {
    const res = await fetch(input, init)
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(body?.error || t('folderActionFailed'))
    await mutateFolders()
    return body?.data
  }

  const runFolderAction = async (action: FolderAction, menu: FolderMenuState) => {
    if (!resolvedAccountId) return
    setFolderError(null)

    // The three actions that need a NAME open the inline field; they call nothing.
    if (action === 'create' || action === 'createChild' || action === 'rename') {
      setNaming({
        action,
        parent: action === 'createChild' ? menu.path : '',
        path: action === 'rename' ? menu.path : '',
        value: action === 'rename' ? menu.name : '',
      })
      return
    }

    try {
      if (action === 'markRead') {
        await callFolderApi('/api/folders/actions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'markRead', accountId: resolvedAccountId, path: menu.path }),
        })
        return
      }

      // Delete and empty are confirmed against facts: the folder NAMED and its real
      // message count, asked of the server — not the sidebar's unread counter.
      const counted = await fetch('/api/folders/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'count', accountId: resolvedAccountId, path: menu.path }),
      }).then(r => r.json()).catch(() => null)
      const count = counted?.data?.count ?? 0

      if (action === 'empty') {
        if (!confirm(t('folderConfirmEmpty', { name: menu.name, count }))) return
        await callFolderApi('/api/folders/actions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'empty', accountId: resolvedAccountId, path: menu.path }),
        })
        return
      }

      if (menu.hasChildren) { setFolderError(t('folderHasChildren')); return }
      if (!confirm(t('folderConfirmDelete', { name: menu.name, count }))) return
      await callFolderApi(
        `/api/folders?account=${encodeURIComponent(resolvedAccountId)}&path=${encodeURIComponent(menu.path)}`,
        { method: 'DELETE' },
      )
    } catch (err) {
      setFolderError(err instanceof Error ? err.message : t('folderActionFailed'))
    }
  }

  const submitFolderName = async () => {
    if (!naming || !resolvedAccountId) return
    if (!naming.value.trim()) { setNaming(null); return }
    // The SAME function as the route: we do not send a name already known to be refused.
    // The server stays the authority — its 400/409 surfaces in the same place.
    const delimiter = accountDelimiter(folders)
    const value = sanitizeFolderName(naming.value, delimiter)
    if (!value) { setFolderError(t('folderNameInvalid', { delimiter })); return }
    const { action, parent, path } = naming
    setNaming(null)
    try {
      await callFolderApi('/api/folders', {
        method: action === 'rename' ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          action === 'rename'
            ? { accountId: resolvedAccountId, path, name: value }
            : { accountId: resolvedAccountId, parent: parent || undefined, name: value },
        ),
      })
    } catch (err) {
      setFolderError(err instanceof Error ? err.message : t('folderActionFailed'))
    }
  }

  const folderRow = (
    folder: FolderItem,
    icon: React.ComponentType<{ className?: string }>,
    label: string,
    /** Custom folders hover their full IMAP path — the tile only shows its letters. */
    title: string = label,
  ) => {
    const isActive = pathname.startsWith('/mail') && currentFolder === folder.path
    const isDragOver = dragOverPath === folder.path
    const unread = folder.unreadCount ?? 0
    return (
      <Link
        key={folder.path}
        href={`/mail?folder=${encodeURIComponent(folder.path)}`}
        onClick={() => handleFolderClick(folder.path)}
        onDragOver={e => handleDragOver(e, folder.path)}
        onDragLeave={handleDragLeave}
        onDrop={e => handleDrop(e, folder.path)}
        onContextMenu={e => openFolderMenu(e, folder)}
        title={title}
        data-sidebar-row={`folder:${folder.path}`}
        className={cn(ROW, isDragOver ? ROW_DRAG : isActive ? ROW_ACTIVE : ROW_IDLE)}
      >
        <RowBody
          icon={icon}
          iconClassName={isActive ? ACCENT.ink : undefined}
          label={label}
          badge={unread}
          collapsed={collapsed}
        />
      </Link>
    )
  }

  return (
    <div
      className="relative flex flex-col h-full bg-sidebar text-sidebar-foreground"
      style={{
        ['--synap-icon-col' as string]: `${SIDEBAR.collapsedWidth}px`,
        ['--synap-row-h' as string]: `${SIDEBAR.rowHeight}px`,
        ['--synap-surface' as string]: SURFACE,
        ...accentStyle,
      }}
      data-sidebar
      data-collapsed={collapsed ? 'true' : 'false'}
    >
      {/* Header — line 1 of the bar: the account, then the list of the OTHER accounts
          unfolding UNDER it, inside the bar. The list is not a card and not a layer:
          it is the bar's own surface, so nothing can crop what the rows paint outside
          their box (an unread badge hangs 9 px off its bubble's corner). */}
      {activeAccount && (
        <div ref={accountBoxRef} className="relative shrink-0">
          <div
            className="relative"
            style={{ paddingTop: SIDEBAR.headerPadY, paddingBottom: SIDEBAR.headerPadY }}
          >
            <button
              onClick={hasMultipleAccounts ? toggleAccountList : undefined}
              disabled={!hasMultipleAccounts}
              title={otherUnread > 0 ? t('unreadOtherAccounts', { count: otherUnread }) : t('switchAccount')}
              aria-expanded={hasMultipleAccounts ? accountOpen : undefined}
              data-sidebar-row="account"
              className={cn(ROW, ROW_IDLE, !hasMultipleAccounts && 'cursor-default hover:bg-transparent')}
            >
              <span className={ICON_COL}>
                <AccountAvatar
                  account={activeAccount}
                  colorIndex={accountColorIdx}
                  unread={activeAccount.unreadCount ?? 0}
                  data-sidebar-icon
                />
              </span>
              <span
                className={cn(ROW_LABEL, collapsed && 'opacity-0')}
                // The label's padding places the CHEVRON, so it stays at the edge clearance
                // whatever else the row carries; the mark's room is taken by the text below.
                style={{
                  transitionDuration: `${SIDEBAR.transitionMs}ms`,
                  paddingRight: ACCOUNT_ROW_RIGHT.edge,
                }}
                aria-hidden={collapsed}
              >
                <span
                  className="flex-1 min-w-0 text-left"
                  style={activeAccount.isShared ? { marginRight: textInset(hasMultipleAccounts) } : undefined}
                >
                  <span className="block text-sm font-medium text-foreground truncate leading-tight">
                    {activeAccount.name || activeAccount.email}
                  </span>
                  {activeAccount.name && (
                    <span className="block text-[11px] text-muted-foreground truncate leading-tight">{activeAccount.email}</span>
                  )}
                </span>
                {hasMultipleAccounts && (
                  <span
                    className="shrink-0 flex items-center justify-center"
                    style={{ width: ACCOUNT_ROW_RIGHT.chevron }}
                    data-account-chevron
                  >
                    <ChevronDown className={cn('w-3.5 h-3.5 text-muted-foreground transition-transform', accountOpen && 'rotate-180')} />
                  </span>
                )}
              </span>
            </button>
            <SharedMark
              account={activeAccount}
              label={t('sharedBy', { name: activeAccount.ownerName ?? activeAccount.email })}
              withChevron={hasMultipleAccounts}
              // A collapsed bar shows the bubble alone: nothing may be painted beside it.
              hidden={collapsed}
            />
          </div>
          {/* Accordion: the row count is animated, not a height in pixels — a grid track
              going from `0fr` to `1fr` measures its own content, so the list works the
              same with two accounts or with twenty, and the folders below are pushed
              down by exactly what the list takes. */}
          <div
            className={cn(
              'grid transition-[grid-template-rows,visibility] ease-out motion-reduce:transition-none',
              // `visibility`, not just a clipped height: a folded list is still in the
              // DOM, and without this its rows stay in the tab order — seven invisible
              // buttons that switch account. It is a discrete property, so it flips only
              // at the END of the fold, leaving the animation intact.
              !accountOpen && 'invisible',
            )}
            style={{
              gridTemplateRows: accountOpen ? '1fr' : '0fr',
              transitionDuration: `${SIDEBAR.transitionMs}ms`,
            }}
          >
            <div className="overflow-hidden">
              <div
                className="border-b border-border"
                style={{ ['--synap-badge-pad' as string]: `${BADGE_OFFSET_PX}px` }}
                data-account-list
                data-account-list-open={accountOpen ? 'true' : 'false'}
              >
                {otherAccounts.length > SIDEBAR.accountFilterFrom && (
                  <div className="px-1.5 pb-1.5">
                    <input
                      value={accountFilter}
                      onChange={e => setAccountFilter(e.target.value)}
                      placeholder={t('searchAccounts')}
                      className={cn(
                        'w-full px-2.5 py-1.5 rounded-md bg-foreground/[0.06] text-sm text-foreground',
                        'placeholder:text-muted-foreground outline-none focus:ring-1', ACCENT.ring,
                      )}
                    />
                  </div>
                )}
                {/* The viewport pads itself by the badge's own overhang, read from the
                    single source that positions the badge: the first row's counter then
                    sits inside the scrolled box instead of being clipped by its edge. */}
                <ThinScroll
                  viewportClassName="overscroll-contain py-[var(--synap-badge-pad)]"
                  style={{ maxHeight: SIDEBAR.rowHeight * SIDEBAR.accountListRows + 2 * BADGE_OFFSET_PX }}
                >
                  {filteredAccounts.length === 0 && (
                    <p className={cn('px-3 py-4 text-xs text-muted-foreground text-center', collapsed && 'opacity-0')}>
                      {t('noAccountMatch')}
                    </p>
                  )}
                  {filteredAccounts.map(acc => accountRow(acc))}
                </ThinScroll>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Folders */}
      <ThinScroll className="flex-1 mt-1" viewportClassName="overscroll-contain">
        <nav>
        {foldersLoading && FOLDER_PLACEHOLDERS.map(i => (
          <div key={i} className={ROW} aria-hidden>
            <span className={ICON_COL}><span className="w-4 h-4 rounded bg-foreground/[0.08]" /></span>
            <span className={cn(ROW_LABEL, collapsed && 'opacity-0')}>
              <span className="h-3 flex-1 rounded bg-foreground/[0.08]" />
            </span>
          </div>
        ))}
        {foldersError && (
          <button
            onClick={() => mutateFolders()}
            title={t('retry')}
            data-sidebar-row="folders-error"
            className={cn(ROW, 'text-destructive/70 hover:text-destructive hover:bg-destructive/10')}
          >
            <RowBody icon={RefreshCw} label={t('foldersError')} collapsed={collapsed} />
          </button>
        )}
        {!foldersLoading && !foldersError && specialFolders.map(folder =>
          folderRow(folder, SPECIAL_ICONS[folder.special!] ?? Folder, t(SPECIAL_LABELS[folder.special!]))
        )}

        {customFolders.length > 0 && (
          <>
            <div className="flex items-center h-7">
              <span className={ICON_COL}><span className="w-4 border-t border-border" /></span>
              <span
                className={cn(ROW_LABEL, 'text-xs font-semibold text-muted-foreground uppercase tracking-widest', collapsed && 'opacity-0')}
                style={{ transitionDuration: `${SIDEBAR.transitionMs}ms` }}
                aria-hidden={collapsed}
              >
                <span className="flex-1 truncate">{t('folders')}</span>
              </span>
            </div>
            {customFolders.map(folder =>
              folderRow(folder, folderGlyph(customInitials.get(folder.path) ?? '?'), folder.name, folder.path)
            )}
          </>
        )}
        {naming && !collapsed && (
          <div className={cn(ROW, 'text-foreground')} data-folder-name-input>
            <span className={ICON_COL}><FolderPlus className="w-4 h-4" /></span>
            <span className={ROW_LABEL}>
              <input
                autoFocus
                value={naming.value}
                placeholder={t('folderNamePlaceholder')}
                onChange={e => setNaming({ ...naming, value: e.target.value })}
                onKeyDown={e => {
                  if (e.key === 'Enter') submitFolderName()
                  if (e.key === 'Escape') { setFolderError(null); setNaming(null) }
                }}
                onBlur={() => setNaming(null)}
                className="flex-1 min-w-0 bg-transparent text-sm outline-none border-b border-border focus:border-foreground"
              />
            </span>
          </div>
        )}
        {folderError && !collapsed && (
          <p className="px-3 py-1 text-[11px] text-destructive" data-folder-error>{folderError}</p>
        )}
        </nav>
      </ThinScroll>

      {folderMenu && (
        <FolderContextMenu
          menu={folderMenu}
          canOrganize={canOrganize}
          canDelete={canDelete}
          onAction={runFolderAction}
          onClose={() => setFolderMenu(null)}
        />
      )}

    </div>
  )
}
