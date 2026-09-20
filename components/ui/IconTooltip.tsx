'use client'

import { cn } from '@/lib/utils'

/**
 * Tooltip for the header icons. Anchored on the ICON (not on the pointer), in pure
 * CSS: no React state, no measurement, so nothing that could shift from one render to
 * the next. One tooltip per button — the native `title` attribute is removed everywhere
 * this component is used, otherwise the browser stacks a second one on top.
 */

/** Gap between the bottom of the icon and the top of the tooltip, in px. Read from here. */
export const TOOLTIP_OFFSET_PX = 6
/** Hover time before it appears, in ms — the tooltip does not flicker on mouse-over. */
export const TOOLTIP_DELAY_MS = 400

/**
 * Which edge the tooltip aligns to: `start` for the first icons of the bar, `end` for
 * those pinned to the right edge, `center` everywhere else. A tooltip must never run
 * off screen.
 */
export type TooltipAlign = 'start' | 'center' | 'end'

const ALIGN: Record<TooltipAlign, string> = {
  start: 'left-0',
  center: 'left-1/2 -translate-x-1/2',
  end: 'right-0',
}

export function IconTooltip({ label, shortcut, align = 'center', children }: {
  label: string
  /** Keyboard shortcut shown to the right of the label, when there is one. */
  shortcut?: string
  align?: TooltipAlign
  children: React.ReactNode
}) {
  return (
    <span className="group relative inline-flex shrink-0">
      {children}
      <span
        role="tooltip"
        data-icon-tooltip
        style={{ marginTop: TOOLTIP_OFFSET_PX, '--synap-tip-delay': `${TOOLTIP_DELAY_MS}ms` } as React.CSSProperties}
        className={cn(
          'pointer-events-none absolute top-full z-50 flex items-center gap-1.5 rounded-lg',
          'whitespace-nowrap bg-foreground px-2 py-1 text-[11px] text-background shadow-sm',
          // Delayed appearance, immediate dismissal: the delay lives on the hovered
          // state, never on the resting state (otherwise the tooltip would outlive exit).
          'invisible opacity-0 transition-[opacity,visibility] duration-100 delay-0',
          'group-hover:visible group-hover:opacity-100 group-hover:delay-[var(--synap-tip-delay)]',
          // `:focus-visible`, never `focus-within`: a mouse click leaves focus on the
          // button, and the tooltip would stay stuck after the pointer leaves.
          'group-has-[:focus-visible]:visible group-has-[:focus-visible]:opacity-100',
          'group-has-[:focus-visible]:delay-[var(--synap-tip-delay)]',
          ALIGN[align],
        )}
      >
        {label}
        {shortcut && <kbd className="rounded bg-background/25 px-1 font-sans">{shortcut}</kbd>}
      </span>
    </span>
  )
}
