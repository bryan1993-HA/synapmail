'use client'

import { Sun, Moon, Monitor, type LucideIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useTheme } from '@/components/theme/ThemeProvider'
import { THEMES, type Theme } from '@/lib/theme'
import { cn } from '@/lib/utils'

const ICONS: Record<Theme, LucideIcon> = { light: Sun, dark: Moon, system: Monitor }

/** The SINGLE duration of the thumb slide (ms). `prefers-reduced-motion` cancels it. */
export const THEME_TOGGLE_TRANSITION_MS = 180

/**
 * Side of one cell, in Tailwind units (`h-8`/`w-8` = 2rem). The cell is SQUARE and the
 * same size in both orientations: that is what keeps the vertical track narrow enough
 * for a collapsed sidebar, and the thumb calculation exact.
 */
const CELL = 'h-8 w-8'
/** Track padding, on both sides — reused verbatim in the thumb calculation. */
const TRACK_PAD_PX = 2

/**
 * The application's single theme toggle: 3 icons, no visible label (the name lives in
 * `aria-label`/`title`), and one thumb that SLIDES from cell to cell. `compact`
 * (collapsed sidebar) = a SINGLE cell showing the active mode's icon; a click advances
 * to the next mode (light -> dark -> system) and the icon flips.
 */
export function ThemeToggle({ className, compact }: { className?: string; compact?: boolean }) {
  const t = useTranslations('settings.appearance')
  const { theme, setTheme } = useTheme()
  const index = Math.max(0, THEMES.indexOf(theme))

  if (compact) {
    const next = THEMES[(index + 1) % THEMES.length]
    const Icon = ICONS[theme]
    const label = t('cycleTheme', { current: t(theme), next: t(next) })
    return (
      <button
        type="button"
        data-theme-cycle={theme}
        aria-label={label}
        title={label}
        onClick={() => setTheme(next)}
        className={cn(
          'mx-auto flex items-center justify-center rounded-lg border border-border bg-muted/40 p-0.5',
          'text-foreground/70 hover:text-foreground',
          className
        )}
      >
        {/* `key={theme}` remounts the icon on every change: that is what replays the
            flip (animation defined in globals.css, same duration as the thumb). */}
        <span
          key={theme}
          className={cn('flex items-center justify-center rounded-[7px]', CELL, 'theme-flip motion-reduce:animate-none')}
          style={{ animationDuration: `${THEME_TOGGLE_TRANSITION_MS}ms` }}
        >
          <Icon className="h-4 w-4 shrink-0" />
        </span>
      </button>
    )
  }

  return (
    <div
      role="radiogroup"
      aria-label={t('theme')}
      className={cn(
        // `w-max` (and NEVER `w-fit`/`w-full`): the track keeps its INTRINSIC width
        // — 3 square cells + padding — even inside a narrow column. With
        // `fit-content`, `1fr` tracks (min-content = 0) collapsed below 3 cells and
        // the icons overlapped at 390 px.
        'relative isolate grid w-max rounded-lg border border-border bg-muted/40 p-0.5',
        className
      )}
      // `auto` tracks: each column (or row) takes the size of its cell and does not
      // shrink. The count comes from THEMES — no hard-coded value.
      style={{ gridTemplateColumns: `repeat(${THEMES.length}, auto)` }}
    >
      {/* Thumb: the ONLY element that moves. Its size is exactly one cell, so
          `translate(index * 100%)` lands it precisely on the active cell, with no magic
          value to maintain. The cells themselves never change their paint. */}
      <span
        aria-hidden
        className={cn(
          'pointer-events-none absolute -z-10 rounded-[7px] bg-background shadow-sm',
          // In dark mode `bg-background` is the page color: a white veil separates the
          // thumb from the track (contrast measured by check-segmented).
          'dark:bg-white/15',
          'ease-out transition-[left] motion-reduce:transition-none'
        )}
        style={{
          transitionDuration: `${THEME_TOGGLE_TRANSITION_MS}ms`,
          width: `calc((100% - ${2 * TRACK_PAD_PX}px) / ${THEMES.length})`,
          height: `calc(100% - ${2 * TRACK_PAD_PX}px)`,
          top: TRACK_PAD_PX,
          left: `calc(${TRACK_PAD_PX}px + (100% - ${2 * TRACK_PAD_PX}px) * ${index} / ${THEMES.length})`,
        }}
      />
      {THEMES.map((value) => {
        const Icon = ICONS[value]
        const label = t(value)
        const active = theme === value
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={label}
            title={label}
            onClick={() => setTheme(value)}
            className={cn(
              'flex items-center justify-center rounded-[7px]',
              CELL,
              active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
          </button>
        )
      })}
    </div>
  )
}
