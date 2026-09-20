'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { signOut } from 'next-auth/react'
import { useLocale, useTranslations } from 'next-intl'
import useSWR from 'swr'
import { LogOut, Settings } from 'lucide-react'
import { ThemeToggle } from '@/components/ThemeToggle'
import { LOCALES, setLocale, type Locale } from '@/lib/locales'
import { twoLetters } from './AccountAvatar'
import { IconTooltip } from '@/components/ui/IconTooltip'
import { cn } from '@/lib/utils'

const fetcher = (url: string) => fetch(url).then(r => r.json())

/** Where the signed-out user lands — the app's only public entry point. */
const LOGIN_PATH = '/login'

/**
 * The bubble's letters, from the signed-out-safe pair the profile route returns.
 * Same rule as an account bubble (`twoLetters`), name first then the local part of
 * the address, so the two never disagree on what two letters mean.
 */
export const userInitials = (user: { name?: string | null; email?: string | null }) => {
  for (const source of [user.name ?? '', (user.email ?? '').split('@')[0] ?? '']) {
    const letters = twoLetters(source)
    if (letters) return letters
  }
  return '??'
}

/** One motif for a menu line — a row, an icon column, a label, nothing filled. */
const MENU_ROW = 'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-foreground/80 ' +
  'hover:bg-foreground/[0.06] hover:text-foreground transition-colors'
const MENU_ICON = 'w-4 h-4 shrink-0'

/**
 * The signed-in user, top right of the header: a NEUTRAL two-letter bubble (this is a
 * person, not a mailbox — an account colour here would read as a seventh inbox) and,
 * above `sm`, their name. Clicking opens the one door to the app's own settings: name
 * and address, Settings, the shared theme toggle, and the app's ONLY sign-out control.
 *
 * Light-dismiss is a plain `mousedown` listener, NOT a backdrop: the click that closes
 * the menu also reaches whatever it landed on, so a folder row behind the menu opens on
 * that same single click.
 */
export function UserMenu() {
  const t = useTranslations('mail')
  // The theme label already exists for the appearance settings — one string, one key.
  const tTheme = useTranslations('settings.appearance')
  // The "Language" label already exists for the command palette: one string, one key.
  const tOmni = useTranslations('omnibar')
  const locale = useLocale()
  const { data } = useSWR<{ data?: { name?: string; email?: string } }>('/api/profile', fetcher, {
    revalidateOnFocus: false,
  })
  const user = data?.data
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setOpen(false)
      triggerRef.current?.focus()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const label = user?.name || user?.email || ''

  const trigger = (
    <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-label={label || t('userMenu')}
        aria-haspopup="menu"
        aria-expanded={open}
        data-user-menu-trigger
        className="flex items-center gap-2 rounded-lg px-1 py-0.5 text-foreground/80
          hover:bg-foreground/[0.06] hover:text-foreground transition-colors"
      >
        <span className="hidden md:block max-w-[10rem] truncate text-xs">{label}</span>
        <span
          data-user-menu-initials
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full
            bg-foreground text-background text-[11px] font-semibold"
        >
          {user ? userInitials(user) : ''}
        </span>
      </button>
  )

  return (
    <div ref={boxRef} className="relative shrink-0">
      {/* While the menu is open: no tooltip, it would sit on top of the list. */}
      {open ? trigger : <IconTooltip label={label || t('userMenu')} align="end">{trigger}</IconTooltip>}

      {open && (
        <div
          role="menu"
          data-user-menu
          className={cn(
            'absolute right-0 top-full z-50 mt-1 w-64 rounded-xl border border-border',
            'bg-popover p-1 shadow-xl',
          )}
        >
          <div className="px-2 py-1.5">
            <div className="truncate text-xs font-medium text-foreground">{user?.name ?? ''}</div>
            <div className="truncate text-[11px] text-muted-foreground">{user?.email ?? ''}</div>
          </div>
          <div className="my-1 border-t border-border" />
          <Link href="/settings" onClick={() => setOpen(false)} role="menuitem" data-user-menu-item="settings" className={MENU_ROW}>
            <Settings className={MENU_ICON} />
            <span className="flex-1 truncate text-left">{t('settings')}</span>
          </Link>
          <div className={cn(MENU_ROW, 'hover:bg-transparent hover:text-foreground/80')} data-user-menu-item="theme">
            <span className="flex-1 truncate text-left">{tTheme('theme')}</span>
            <ThemeToggle />
          </div>
          {/* Language switches from here, on the same template as the theme row.
              It reuses the Appearance settings mechanism (lib/locales.ts), not a second one. */}
          <div className={cn(MENU_ROW, 'hover:bg-transparent hover:text-foreground/80')} data-user-menu-item="language">
            <span className="flex-1 truncate text-left">{tOmni('language')}</span>
            <div className="flex shrink-0 items-center rounded-lg border border-border bg-muted/40 p-0.5">
              {LOCALES.map(({ code, label }) => (
                <button
                  key={code}
                  type="button"
                  data-user-menu-language={code}
                  aria-pressed={locale === code}
                  onClick={() => { if (locale !== code) void setLocale(code as Locale) }}
                  className={cn(
                    'rounded-[7px] px-2 py-1 text-[11px] transition-colors',
                    locale === code ? 'bg-background text-foreground shadow-sm dark:bg-white/15'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="my-1 border-t border-border" />
          <button
            type="button"
            role="menuitem"
            onClick={() => signOut({ callbackUrl: LOGIN_PATH })}
            data-user-menu-item="signout"
            className={MENU_ROW}
          >
            <LogOut className={MENU_ICON} />
            <span className="flex-1 truncate text-left">{t('signOut')}</span>
          </button>
        </div>
      )}
    </div>
  )
}
