'use client'

/**
 * The seven color flags, plus "remove". A single rendering for every place that sets a
 * flag (reading pane, context menu): the order, the colors and the labels come from
 * lib/flags.ts and are not copied anywhere else.
 */

import { Flag, FlagOff } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { MAIL_FLAGS } from '@/lib/flags'
import { cn } from '@/lib/utils'

interface Props {
  /** The color already set, used to check the current swatch. */
  current?: string | null
  onPick: (flag: string | null) => void
  className?: string
}

export function FlagPicker({ current, onPick, className }: Props) {
  const t = useTranslations('mail')
  return (
    <div className={cn('flex items-center gap-0.5 p-1', className)}>
      {MAIL_FLAGS.map(f => (
        <button
          key={f.key}
          type="button"
          title={t(`flags.${f.labelKey}`)}
          aria-label={t(`flags.${f.labelKey}`)}
          aria-pressed={current === f.key}
          data-flag={f.key}
          onClick={() => onPick(f.key)}
          className={cn(
            'w-7 h-7 flex items-center justify-center rounded hover:bg-accent transition-colors',
            current === f.key && 'bg-accent'
          )}
        >
          <Flag className="w-3.5 h-3.5 fill-current" style={{ color: f.color }} />
        </button>
      ))}
      <button
        type="button"
        title={t('flagRemove')}
        aria-label={t('flagRemove')}
        data-flag=""
        onClick={() => onPick(null)}
        className="w-7 h-7 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
      >
        <FlagOff className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}
