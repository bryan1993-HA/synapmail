'use client'

import { AlertCircle, ShieldAlert } from 'lucide-react'
import { useTranslations } from 'next-intl'

/**
 * What the user reads about the browser permission that gates a model running
 * on their own machine. Two states only:
 *
 *  - `prompt`: the browser is about to ask, so we say what to accept;
 *  - `denied`: it already refused, so we say where to turn it back on.
 *
 * Kept apart from the CORS help on purpose: a refused permission stops the
 * request before it leaves the browser, so telling the user to configure their
 * model would send them after the wrong cause.
 */
export function LocalAccessNotice({ state }: { state: 'prompt' | 'denied' }) {
  const t = useTranslations('mail.ai')

  if (state === 'prompt') {
    return (
      <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
        <AlertCircle className="w-3 h-3 shrink-0 mt-0.5" />
        <span>{t('access.prompt')}</span>
      </p>
    )
  }

  return (
    <div className="rounded-xl border border-border bg-muted/20 px-4 py-3 text-xs space-y-1.5">
      <p className="flex items-start gap-1.5 font-medium">
        <ShieldAlert className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        <span>{t('errors.permission')}</span>
      </p>
      <ol className="space-y-1 text-muted-foreground list-decimal list-inside">
        <li>{t('access.deniedStep1')}</li>
        <li>{t('access.deniedStep2')}</li>
      </ol>
    </div>
  )
}
