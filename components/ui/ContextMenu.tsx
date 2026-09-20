'use client'

/**
 * The right-click MENU — its surface, its placement and its dismissal. Nothing else:
 * no mail, no folders. Extracted from `MessageContextMenu` so the sidebar right-click is
 * the SAME menu as the message one, and not a second one that would drift (two
 * viewport-edge calculations, two ways of closing).
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronRight, MoreHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils'
import { IconTooltip } from '@/components/ui/IconTooltip'

/** Where the menu opens. Each menu adds whatever ITS own target tells it. */
export interface ContextMenuAnchor {
  x: number
  y: number
}

/** Margin kept between the menu and the viewport edge. */
const EDGE_GAP = 8

/** Item icon size — a single value shared by every menu. */
export const MENU_ICON = 'w-3.5 h-3.5 shrink-0'

/** Minimum menu width, in px. Also used to align a menu on the RIGHT EDGE of whatever
 *  opens it: without this value the width would have to be measured afterwards, so after
 *  a first render already placed in the wrong spot. Applied as an inline style, not a
 *  class: Tailwind does not compile a computed value, and two spellings would drift. */
export const MENU_MIN_WIDTH = 210

export function ContextMenuSurface({
  anchor, onClose, ignoreRef, children, ...rest
}: {
  anchor: ContextMenuAnchor
  onClose: () => void
  /** Element that drives the menu: clicking it does not close the menu, it TOGGLES it.
   *  Otherwise the click would close here then reopen there, and the button would look dead. */
  ignoreRef?: React.RefObject<HTMLElement>
  children: React.ReactNode
} & React.HTMLAttributes<HTMLDivElement>) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x: anchor.x, y: anchor.y })

  // The menu stays on screen based on its ACTUAL size: a guessed height would leave
  // the last items below the edge as soon as one more is added.
  useLayoutEffect(() => {
    const box = ref.current?.getBoundingClientRect()
    if (!box) return
    setPos({
      x: Math.max(EDGE_GAP, Math.min(anchor.x, window.innerWidth - box.width - EDGE_GAP)),
      y: Math.max(EDGE_GAP, Math.min(anchor.y, window.innerHeight - box.height - EDGE_GAP)),
    })
  }, [anchor.x, anchor.y])

  useEffect(() => {
    // `mousedown` closes BEFORE the `click`, so the same click reaches its target
    // under the menu, with no second click and no dead zone.
    const onDown = (e: MouseEvent) => {
      const node = e.target as Node
      if (ignoreRef?.current?.contains(node)) return
      if (ref.current && !ref.current.contains(node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    // Capture phase: the list scrolls inside its own container, not on the window.
    window.addEventListener('scroll', onClose, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onClose, true)
    }
  }, [onClose, ignoreRef])

  // Rendered through a PORTAL onto `document.body`. Otherwise `position: fixed` does NOT
  // resolve against the viewport as soon as an ancestor carries `transform`, `filter`,
  // `backdrop-filter`, `will-change` or `contain`: those properties make the ancestor the
  // containing block, so viewport coordinates get added to its offset. Measured: the
  // settings card carries `backdrop-blur-sm`, and the menu opened 237 px to the right and
  // 469 px below the viewport. The portal lifts the surface out of all those blocks at
  // once, for the settings screens as well as for the mail right-click.
  const surface = (
    <div
      ref={ref}
      className="fixed z-[100] bg-popover border border-border rounded-lg shadow-xl py-1"
      style={{ left: pos.x, top: pos.y, minWidth: MENU_MIN_WIDTH }}
      {...rest}
    >
      {children}
    </div>
  )

  // Server rendering has no `document`; the surface never appears there anyway, since it
  // only exists after an interaction.
  if (typeof document === 'undefined') return null
  return createPortal(surface, document.body)
}

export function ContextMenuItem({
  itemKey, icon, label, onClick, onClose, enabled, danger,
}: {
  itemKey: string
  icon: React.ReactNode
  label: string
  onClick: () => void
  onClose: () => void
  enabled: boolean
  danger?: boolean
}) {
  return (
    <button
      type="button"
      data-menu-item={itemKey}
      disabled={!enabled}
      onClick={() => { onClick(); onClose() }}
      className={cn(
        'w-full flex items-center gap-2.5 px-3 py-1.5 text-xs text-left transition-colors',
        'disabled:opacity-40 disabled:pointer-events-none',
        danger ? 'text-destructive hover:bg-destructive/10' : 'text-foreground hover:bg-accent',
      )}
    >
      {icon}
      {label}
    </button>
  )
}

/** Hover submenu — pure CSS, no state: it cannot get stuck open by mistake. */
export function ContextMenuSubmenu({
  itemKey, icon, label, enabled, children,
}: {
  itemKey: string
  icon: React.ReactNode
  label: string
  enabled: boolean
  children: React.ReactNode
}) {
  return (
    <div className={cn('group relative', !enabled && 'opacity-40 pointer-events-none')} data-menu-item={itemKey}>
      <div className="w-full flex items-center gap-2.5 px-3 py-1.5 text-xs text-foreground hover:bg-accent cursor-default transition-colors">
        {icon}
        {label}
        <ChevronRight className="w-3 h-3 ml-auto" />
      </div>
      <div className="absolute left-full top-0 hidden group-hover:block bg-popover border border-border rounded-lg shadow-xl py-1 z-[101]">
        {children}
      </div>
    </div>
  )
}

export const ContextMenuSeparator = () => <div className="my-1 border-t border-border" />

/** Gap between the bottom of the "..." button and the top of the menu it opens, in px. */
const ROW_MENU_GAP = 4

/**
 * The "..." button on a settings row, and the menu it opens. This is the SAME menu as the
 * mail and folder right-click (`ContextMenuSurface` above): same radius, same shadow,
 * same one-click-outside dismissal that still reaches its target.
 *
 * It exists because deletion is RARE: a red trash icon on every row puts destruction in
 * the foreground of a screen opened for something else entirely. Here the red only shows
 * up inside the opened menu.
 *
 * Keyboard: Tab reaches the button, Enter opens onto the first item, the arrows move
 * through, Escape closes and returns focus to the button.
 */
export function RowMenu({ label, itemsKey, children }: {
  /** Label read by the tooltip and by screen readers — it NAMES the row. */
  label: string
  /** Identifies the row for tests: `data-row-menu="<key>"` on the button. */
  itemsKey: string
  /** The items, built with `ContextMenuItem` / `ContextMenuSeparator`. */
  children: (close: () => void) => React.ReactNode
}) {
  const [anchor, setAnchor] = useState<ContextMenuAnchor | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const open = () => {
    const box = triggerRef.current?.getBoundingClientRect()
    if (box) setAnchor({ x: box.right - MENU_MIN_WIDTH, y: box.bottom + ROW_MENU_GAP })
  }

  // Closing returns focus to the button: otherwise focus falls back to the page body
  // and the next Tab restarts from the top of the screen.
  const close = () => {
    setAnchor(null)
    triggerRef.current?.focus()
  }

  // Opening with the keyboard focuses the first item; opening with the mouse does not
  // (the pointer already picks), otherwise the hover tooltip would stay stuck.
  const focusItem = (step: number) => {
    const items = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('[data-menu-item]:not([disabled])') ?? [])
    if (items.length === 0) return
    const at = items.indexOf(document.activeElement as HTMLButtonElement)
    const next = at === -1 ? (step > 0 ? 0 : items.length - 1) : (at + step + items.length) % items.length
    items[next].focus()
  }

  return (
    <>
      <IconTooltip label={label} align="end">
        <button
          ref={triggerRef}
          type="button"
          data-row-menu={itemsKey}
          aria-haspopup="menu"
          aria-expanded={anchor !== null}
          aria-label={label}
          onClick={() => (anchor ? setAnchor(null) : open())}
          onKeyDown={e => {
            if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
            e.preventDefault()
            if (!anchor) open()
            requestAnimationFrame(() => focusItem(e.key === 'ArrowDown' ? 1 : -1))
          }}
          className={cn(
            'inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground',
            'transition-colors hover:bg-accent hover:text-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          )}
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </IconTooltip>
      {anchor && (
        <ContextMenuSurface
          anchor={anchor}
          onClose={close}
          ignoreRef={triggerRef}
          role="menu"
          data-row-menu-surface={itemsKey}
        >
          <div
            ref={listRef}
            onKeyDown={e => {
              if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
              e.preventDefault()
              focusItem(e.key === 'ArrowDown' ? 1 : -1)
            }}
          >
            {children(close)}
          </div>
        </ContextMenuSurface>
      )}
    </>
  )
}
