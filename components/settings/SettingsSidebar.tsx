'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import {
  User, Palette, BookOpen, Bell, PenSquare,
  Mail, FileSignature, ArrowLeft, ShieldCheck, Users, Filter, LayoutTemplate, Bot, KeyRound, Terminal,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAppName } from '@/components/providers'

/** Where an account's sharing is managed — the one place the bar's shared mark points to. */
export const ACCOUNTS_SETTINGS_HREF = '/settings/accounts'

/**
 * The ONE source of settings entries: this bar renders them, and the omnibar
 * offers them as you type. Adding an entry here makes it reachable from both
 * places, with no second table to keep in sync; `key` is the i18n key for the
 * label (`settings.nav.<key>`) AND for the search keywords
 * (`omnibar.keywords.<key>`), both checked by check-omnibar-commands.
 */
export const SETTINGS_NAV = [
  { href: '/settings/profile',       key: 'profile',       icon: User },
  { href: '/settings/appearance',    key: 'appearance',    icon: Palette },
  { href: '/settings/reading',       key: 'reading',       icon: BookOpen },
  { href: '/settings/notifications', key: 'notifications', icon: Bell },
  { href: '/settings/composition',   key: 'composition',   icon: PenSquare },
  { href: ACCOUNTS_SETTINGS_HREF,    key: 'accounts',      icon: Mail },
  { href: '/settings/signatures',    key: 'signatures',    icon: FileSignature },
  { href: '/settings/templates',     key: 'templates',     icon: LayoutTemplate },
  { href: '/settings/contacts',      key: 'contacts',      icon: Users },
  { href: '/settings/rules',         key: 'rules',         icon: Filter },
  { href: '/settings/ai',            key: 'ai',            icon: Bot },
  { href: '/settings/pgp',           key: 'pgp',           icon: KeyRound },
  { href: '/settings/api-keys',      key: 'apiKeys',       icon: Terminal },
] as const

export function SettingsSidebar({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname()
  const t = useTranslations('settings.nav')
  const appName = useAppName()

  const linkClass = (active: boolean) =>
    cn(
      'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors',
      active
        ? 'bg-violet-500/10 text-violet-700 dark:text-violet-300 font-medium'
        : 'text-muted-foreground hover:text-foreground hover:bg-accent',
    )

  return (
    <aside className="flex h-full w-56 shrink-0 flex-col border-r border-border bg-background">
      {/* Back to mail */}
      <div className="border-b border-border px-3 pb-3 pt-4">
        <Link
          href="/mail"
          className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4 shrink-0" />
          <span>{t('backToMail')}</span>
        </Link>
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-3">
        {SETTINGS_NAV.map(({ href, key, icon: Icon }) => {
          const active = pathname.startsWith(href)
          return (
            <Link key={href} href={href} className={linkClass(active)}>
              <Icon className="h-4 w-4 shrink-0" />
              <span>{t(key)}</span>
            </Link>
          )
        })}

        {isAdmin && (
          <>
            <div className="my-2 border-t border-border" />
            <Link href="/admin/users" className={linkClass(pathname.startsWith('/admin'))}>
              <ShieldCheck className="h-4 w-4 shrink-0" />
              <span>{t('admin')}</span>
            </Link>
          </>
        )}
      </nav>

      {/* Footer */}
      <div className="border-t border-border px-4 pb-4 pt-2">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground/50">{appName}</p>
      </div>
    </aside>
  )
}
