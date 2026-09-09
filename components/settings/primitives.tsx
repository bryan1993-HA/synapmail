'use client'

/**
 * Shared building blocks for the Settings pages.
 * Visual language is aligned with the dashboard command center:
 * rounded-2xl cards on bg-card/80 + shadow-sm, violet accent, icon-tile headers.
 * These primitives are i18n-free on purpose — pages pass their own translated labels.
 */

import type { ComponentType, ReactNode } from 'react'
import { Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const MAX_WIDTH = {
  lg: 'max-w-2xl',
  xl: 'max-w-2xl',
  '2xl': 'max-w-3xl',
  '3xl': 'max-w-none',
} as const

export function SettingsPage({
  width = 'lg',
  children,
}: {
  width?: keyof typeof MAX_WIDTH
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        'mx-auto p-6 sm:p-8 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1 motion-safe:duration-300',
        MAX_WIDTH[width],
      )}
    >
      {children}
    </div>
  )
}

export function SettingsHeader({
  icon,
  title,
  description,
}: {
  icon?: ReactNode
  title: string
  description?: string
}) {
  return (
    <header className="mb-7 flex items-start gap-3">
      {icon && (
        <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-violet-500/15 text-violet-600 dark:text-violet-300">
          {icon}
        </span>
      )}
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
      </div>
    </header>
  )
}

export function SettingsSection({
  title,
  description,
  children,
  className,
}: {
  title?: string
  description?: string
  children: ReactNode
  className?: string
}) {
  return (
    <section
      className={cn(
        'space-y-4 rounded-2xl border border-border bg-card/80 p-5 shadow-sm backdrop-blur-sm',
        className,
      )}
    >
      {(title || description) && (
        <div>
          {title && (
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {title}
            </h2>
          )}
          {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
        </div>
      )}
      {children}
    </section>
  )
}

export function SettingsRow({
  title,
  description,
  disabled,
  children,
}: {
  title: string
  description?: string
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <div className={cn('flex items-center justify-between gap-4', disabled && 'opacity-50')}>
      <div className="min-w-0">
        <p className="text-sm font-medium">{title}</p>
        {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

export function SettingsDivider() {
  return <div className="border-t border-border" />
}

export function Toggle({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  label?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200',
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
        checked ? 'bg-violet-500' : 'bg-muted',
      )}
    >
      <span
        className={cn(
          'pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200',
          checked ? 'translate-x-5' : 'translate-x-0',
        )}
      />
    </button>
  )
}

export interface ChoiceOption<T extends string | number> {
  value: T
  label: ReactNode
  description?: string
  icon?: ComponentType<{ className?: string }>
}

export function ChoiceCards<T extends string | number>({
  options,
  value,
  onChange,
  columns = 3,
  center = false,
}: {
  options: ChoiceOption<T>[]
  value: T
  onChange: (v: T) => void
  columns?: 1 | 2 | 3
  center?: boolean
}) {
  const grid = columns === 1 ? 'grid-cols-1' : columns === 2 ? 'grid-cols-2' : 'grid-cols-3'
  return (
    <div className={cn('grid gap-2.5', grid)}>
      {options.map((opt) => {
        const active = opt.value === value
        const Icon = opt.icon
        return (
          <button
            key={String(opt.value)}
            type="button"
            onClick={() => onChange(opt.value)}
            className={cn(
              'relative flex gap-1 rounded-xl border-2 p-3.5 transition-all',
              center ? 'flex-col items-center text-center' : 'flex-col items-start text-left',
              active
                ? 'border-violet-500 bg-violet-500/5'
                : 'border-border hover:border-border/70 hover:bg-accent/40',
            )}
          >
            {active && (
              <span className="absolute right-2 top-2 grid h-4 w-4 place-items-center rounded-full bg-violet-500 text-white">
                <Check className="h-2.5 w-2.5" />
              </span>
            )}
            {Icon && (
              <Icon
                className={cn(
                  'h-5 w-5',
                  active ? 'text-violet-600 dark:text-violet-400' : 'text-muted-foreground',
                )}
              />
            )}
            <span
              className={cn(
                'text-sm font-medium',
                active ? 'text-violet-700 dark:text-violet-300' : 'text-foreground',
              )}
            >
              {opt.label}
            </span>
            {opt.description && (
              <span className="text-xs text-muted-foreground">{opt.description}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}

export function Chips<T extends string | number>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: ReactNode }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => {
        const active = opt.value === value
        return (
          <button
            key={String(opt.value)}
            type="button"
            onClick={() => onChange(opt.value)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg border-2 px-3.5 py-2 text-sm font-medium transition-all',
              active
                ? 'border-violet-500 bg-violet-500/5 text-violet-700 dark:text-violet-300'
                : 'border-border text-muted-foreground hover:border-border/70 hover:bg-accent/40 hover:text-foreground',
            )}
          >
            {active && <Check className="h-3.5 w-3.5" />}
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

export function SaveBar({
  dirty,
  saving,
  saved,
  onSave,
  submit = false,
  labels,
}: {
  dirty: boolean
  saving: boolean
  saved: boolean
  onSave?: () => void
  submit?: boolean
  labels: { save: string; saving: string; saved: string; unsaved: string }
}) {
  return (
    <div className="sticky bottom-0 -mx-6 mt-2 flex items-center gap-3 border-t border-border bg-background/85 px-6 py-3 backdrop-blur sm:-mx-8 sm:px-8">
      <Button
        type={submit ? 'submit' : 'button'}
        onClick={submit ? undefined : onSave}
        disabled={saving || (!dirty && !submit)}
      >
        {saving ? labels.saving : labels.save}
      </Button>
      {saved && (
        <span className="inline-flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400">
          <Check className="h-4 w-4" />
          {labels.saved}
        </span>
      )}
      {dirty && !submit && !saving && !saved && (
        <span className="text-xs text-muted-foreground">{labels.unsaved}</span>
      )}
    </div>
  )
}
