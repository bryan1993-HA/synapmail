'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import useSWR from 'swr'
import { MoreHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Folder } from '@/types/email'
import { FlagPicker } from '@/components/mail/FlagPicker'
import { IconTooltip, type TooltipAlign } from '@/components/ui/IconTooltip'
import {
  MAIL_TOOLBAR_GROUPS, useMailSelection,
  type MailActionName, type MailToolbarItem,
} from '@/lib/mailSelection'

const fetcher = (url: string) => fetch(url).then(r => r.json())

/**
 * The two actions that do not run on click: they open a small anchored menu
 * (the seven colors, the folder list). Everything else calls its action.
 */
const MENU_ACTIONS = new Set<MailActionName>(['setFlag', 'moveTo'])

/**
 * Group the header renders BEFORE the compose button ("Fetch mail", which has to
 * come first). It leaves the toolbar but stays defined in `MAIL_TOOLBAR_GROUPS`:
 * neither its icon nor its label is copied over, and the overflow menu still
 * lists it first.
 */
const LEAD_GROUP = 0

/** The groups the bar renders itself: everything except the one the header took. */
const IN_BAR_GROUPS = MAIL_TOOLBAR_GROUPS.map((_, i) => i).filter(i => i !== LEAD_GROUP)

/**
 * Order in which groups move into the « … » menu when space runs short: the
 * LAST group goes first. The archive/delete group stays visible the
 * longest: the requested priority order.
 */
const OVERFLOW_ORDER = [...IN_BAR_GROUPS].reverse()

/**
 * Width needed to display the visible groups. Measured, not guessed:
 * the bar compares the real space to the real need and folds one more group as
 * long as it overflows. No hard-coded breakpoint: a longer translation or a
 * wider font simply folds earlier.
 */
function useOverflowGroups(hostRef: React.RefObject<HTMLElement>, probeRef: React.RefObject<HTMLElement>) {
  const [hidden, setHidden] = useState<number[]>([])

  useEffect(() => {
    const host = hostRef.current
    const probe = probeRef.current
    if (!host || !probe) return

    const measure = () => {
      // The bar no longer stretches: its own width no longer tells the available space.
      // The budget is that of the row carrying it, minus the floor its
      // neighbors reserve (the search field): floors READ from the render, so
      // always the ones that ship, never constants copied in here.
      const row = host.parentElement
      if (!row) return
      const reserved = Array.from(row.children)
        .filter(el => el !== host)
        .reduce((sum, el) => {
          const st = getComputedStyle(el)
          return sum + (parseFloat(st.minWidth) || 0) + (parseFloat(st.marginLeft) || 0) + (parseFloat(st.marginRight) || 0)
        }, 0)
      const available = row.getBoundingClientRect().width - reserved
      // The probe renders the bar's groups then, last, the « … » button:
      // its width is MEASURED too, never guessed.
      const boxes = Array.from(probe.children).map(el => el.getBoundingClientRect().width)
      const moreWidth = boxes[boxes.length - 1] ?? 0
      const widths = new Map(IN_BAR_GROUPS.map((group, i) => [group, boxes[i] ?? 0]))
      const total = IN_BAR_GROUPS.reduce((sum, group) => sum + (widths.get(group) ?? 0), 0)
      if (total <= available) { setHidden(prev => (prev.length ? [] : prev)); return }
      // The « … » button takes space AS LONG AS it is displayed, so on every pass.
      const budget = available - moreWidth
      const next: number[] = []
      let used = total
      for (const index of OVERFLOW_ORDER) {
        if (used <= budget) break
        used -= widths.get(index) ?? 0
        next.push(index)
      }
      setHidden(prev => (prev.length === next.length && prev.every((v, i) => v === next[i]) ? prev : next))
    }

    measure()
    const observer = new ResizeObserver(measure)
    // The row, NOT the bar: the bar is `shrink-0`, so its own box no longer
    // changes when the window shrinks and an observer placed on it stopped
    // firing (measured: 10 buttons still displayed at 390 px after a resize,
    // whereas a direct load at 390 px folded 9 of them).
    if (host.parentElement) observer.observe(host.parentElement)
    observer.observe(probe)
    return () => observer.disconnect()
  }, [hostRef, probeRef])

  return hidden
}

/** One pattern for every action button: icon only, never a filled button. */
const ACTION = 'w-8 h-8 shrink-0 flex items-center justify-center rounded-lg transition-colors ' +
  'text-foreground/70 hover:text-foreground hover:bg-foreground/[0.06] ' +
  'disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-foreground/70 disabled:cursor-default'
/** Same button, unfolded into a readable row: the « … » menu names its actions. */
const ACTION_ROW = 'w-full h-9 shrink-0 flex items-center gap-2 rounded-lg px-2 text-xs transition-colors ' +
  'text-foreground/80 hover:text-foreground hover:bg-foreground/[0.06] ' +
  'disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-foreground/80 disabled:cursor-default'
const ICON = 'w-[18px] h-[18px]'
const SEPARATOR = 'mx-1 h-5 w-px shrink-0 bg-border'
const MENU_BOX = 'absolute left-0 top-full z-50 mt-1 rounded-xl border border-border bg-popover p-1 shadow-xl'
const MENU_ROW = 'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-foreground/80 ' +
  'hover:bg-foreground/[0.06] hover:text-foreground transition-colors'

/**
 * Menu anchored under a button, closed by ONE outside click that reaches its target
 * (`mousedown` listener, never an overlay) and by Escape, which gives focus back.
 * Same pattern as the user account menu.
 */
function useAnchoredMenu(open: boolean, close: () => void, triggerRef: React.RefObject<HTMLButtonElement>) {
  const boxRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) close()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      close()
      triggerRef.current?.focus()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, close, triggerRef])
  return boxRef
}

type ButtonProps = {
  item: MailToolbarItem
  openMenu: MailActionName | null
  setOpenMenu: (a: MailActionName | null) => void
  /**
   * `bar` = icon only, the head bar template. `row` = icon + label, the
   * « … » menu template: once folded, a button must be READ, not guessed.
   */
  variant?: 'bar' | 'row'
  /** Which edge the tooltip aligns to: see `IconTooltip`. No effect in the `row` variant. */
  align?: TooltipAlign
}

function ToolbarButton({ item, openMenu, setOpenMenu, variant = 'bar', align = 'center' }: ButtonProps) {
  const t = useTranslations('mail')
  const { can, run, state } = useMailSelection()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const isMenu = MENU_ACTIONS.has(item.action)
  const open = isMenu && openMenu === item.action
  const boxRef = useAnchoredMenu(open, () => setOpenMenu(null), triggerRef)
  const label = t(item.labelKey)
  const enabled = can[item.action]

  const { data: foldersRes } = useSWR<{ data: Folder[] }>(
    open && item.action === 'moveTo' && state.accountId ? `/api/folders?account=${state.accountId}` : null,
    fetcher,
  )
  const folders = foldersRes?.data ?? []

  const isRow = variant === 'row'
  const button = (
    <button
      ref={triggerRef}
      type="button"
      disabled={!enabled}
      aria-label={label}
      {...(isMenu ? { 'aria-haspopup': 'menu' as const, 'aria-expanded': open } : {})}
      {...(isRow ? { role: 'menuitem' as const } : {})}
      onClick={() => {
        if (!isMenu) { run(item.action as Exclude<MailActionName, 'setFlag' | 'moveTo'>); return }
        setOpenMenu(open ? null : item.action)
      }}
      data-mail-action={item.action}
      className={isRow ? ACTION_ROW : ACTION}
    >
      <item.Icon className={ICON} />
      {isRow && <span className="flex-1 truncate text-left">{label}</span>}
    </button>
  )

  // In the « … » menu each action already carries its label in plain text: a tooltip
  // there would be a second label for the same thing.
  const tipped = isRow ? button : <IconTooltip label={label} shortcut={item.shortcut} align={align}>{button}</IconTooltip>

  if (!isMenu) return tipped

  return (
    <div ref={boxRef} className="relative shrink-0">
      {tipped}
      {open && item.action === 'setFlag' && (
        <div role="menu" data-mail-action-menu="setFlag" className={cn(MENU_BOX, 'w-auto')}>
          <FlagPicker onPick={flag => { run('setFlag', flag); setOpenMenu(null) }} />
        </div>
      )}
      {open && item.action === 'moveTo' && (
        <div role="menu" data-mail-action-menu="moveTo" className={cn(MENU_BOX, 'max-h-72 w-56 overflow-y-auto')}>
          {folders.map(folder => (
            <button
              key={folder.path}
              type="button"
              role="menuitem"
              data-mail-move-target={folder.path}
              onClick={() => { run('moveTo', folder.path); setOpenMenu(null) }}
              className={MENU_ROW}
            >
              <span className="flex-1 truncate text-left">{folder.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** A group = its buttons, preceded by a thin rule as soon as it is not the first displayed. */
function ToolbarGroup({ items, first, openMenu, setOpenMenu, variant = 'bar', align }: {
  items: readonly MailToolbarItem[]
  first: boolean
} & Pick<ButtonProps, 'openMenu' | 'setOpenMenu' | 'variant' | 'align'>) {
  const isRow = variant === 'row'
  return (
    <>
      {!first && (
        <span
          data-mail-toolbar-separator
          className={isRow ? 'my-1 h-px w-full shrink-0 bg-border' : SEPARATOR}
        />
      )}
      {items.map(item => (
        <ToolbarButton key={item.action} item={item} openMenu={openMenu} setOpenMenu={setOpenMenu} variant={variant} align={align} />
      ))}
    </>
  )
}

/**
 * The lead group of `MAIL_TOOLBAR_GROUPS` ("Fetch mail"), rendered by the header
 * between the dashboard and compose buttons. Same button, same source: this
 * component only takes it out of the toolbar, which then ignores it.
 */
export function MailToolbarLead() {
  const [openMenu, setOpenMenu] = useState<MailActionName | null>(null)
  return (
    <ToolbarGroup
      items={MAIL_TOOLBAR_GROUPS[LEAD_GROUP]}
      first
      openMenu={openMenu}
      setOpenMenu={setOpenMenu}
      align="start"
    />
  )
}

/**
 * Mail toolbar, in the head bar: « like Mail on Mac »: fetch |
 * archive, delete, junk | reply, reply all, forward | flag,
 * unread, move. The order, the icons and the labels come from
 * `MAIL_TOOLBAR_GROUPS`: this component knows NO mail logic, it reads
 * a capability and calls an action from the shared context.
 *
 * A button without its capability is greyed out, never hidden: the bar does not jump when the
 * selection changes. Whatever no longer fits in the width moves into the « … » menu.
 */
export function MailToolbar() {
  const t = useTranslations('mail')
  const [openMenu, setOpenMenu] = useState<MailActionName | null>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const probeRef = useRef<HTMLDivElement>(null)
  const moreRef = useRef<HTMLButtonElement>(null)
  const [moreOpen, setMoreOpen] = useState(false)
  const moreBoxRef = useAnchoredMenu(moreOpen, () => setMoreOpen(false), moreRef)
  const hidden = useOverflowGroups(hostRef, probeRef)

  const hiddenSet = useMemo(() => new Set(hidden), [hidden])
  // The lead group is rendered by the header (MailToolbarLead): the bar does not
  // render it a second time, but the « … » menu still lists it first.
  const inBar = MAIL_TOOLBAR_GROUPS.map((items, i) => ({ items, i })).filter(g => g.i !== LEAD_GROUP)
  const visible = inBar.filter(g => !hiddenSet.has(g.i))
  const overflowed = inBar.filter(g => hiddenSet.has(g.i))

  return (
    // `shrink-0`: the bar keeps its natural width so the
    // field sits flush against its last icon. The fold budget is therefore read from
    // the row that contains it, no longer from itself (see `useOverflowGroups`).
    <div ref={hostRef} data-mail-toolbar className="relative flex shrink-0 items-center">
      {/* Offscreen probe: the width that ALL the groups would ask for, measured
          on the real render. It is neither visible nor clickable. */}
      <div
        ref={probeRef}
        aria-hidden
        className="pointer-events-none absolute left-0 top-0 flex items-center opacity-0"
        style={{ visibility: 'hidden' }}
      >
        {IN_BAR_GROUPS.map((group, i) => (
          <span key={group} className="flex items-center">
            {i > 0 && <span className={SEPARATOR} />}
            {MAIL_TOOLBAR_GROUPS[group].map(item => (
              <span key={item.action} className={ACTION}><item.Icon className={ICON} /></span>
            ))}
          </span>
        ))}
        <span className="flex items-center">
          <span className={SEPARATOR} />
          <span className={ACTION}><MoreHorizontal className={ICON} /></span>
        </span>
      </div>

      {visible.map((group, index) => (
        <ToolbarGroup
          key={group.i}
          items={group.items}
          first={index === 0}
          openMenu={openMenu}
          setOpenMenu={setOpenMenu}
        />
      ))}

      {overflowed.length > 0 && (
        <>
        <span data-mail-toolbar-separator className={SEPARATOR} />
        <div ref={moreBoxRef} className="relative shrink-0">
          <IconTooltip label={t('moreActions')} align="end">
            <button
              ref={moreRef}
              type="button"
              aria-label={t('moreActions')}
              aria-haspopup="menu"
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen(o => !o)}
              data-mail-toolbar-more
              className={ACTION}
            >
              <MoreHorizontal className={ICON} />
            </button>
          </IconTooltip>
          {moreOpen && (
            // Centered UNDER the button: anchored left it overflowed to the right, anchored
            // right it overflowed to the left by 3 px at 390 px once the lead group moved
            // up into the header. Centered, both its edges hold: the button is always
            // more than half a menu width away from both edges, and the harness
            // asserts it at 390 px ("entirely on screen").
            <div
              role="menu"
              data-mail-toolbar-more-menu
              className={cn(MENU_BOX, 'left-1/2 flex w-48 -translate-x-1/2 flex-col items-stretch')}
            >
              {MAIL_TOOLBAR_GROUPS.map((items, index) => (
                <ToolbarGroup
                  key={index}
                  items={items}
                  first={index === 0}
                  openMenu={openMenu}
                  setOpenMenu={setOpenMenu}
                  variant="row"
                />
              ))}
            </div>
          )}
        </div>
        </>
      )}
    </div>
  )
}
