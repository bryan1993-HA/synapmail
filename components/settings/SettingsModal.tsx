'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { useTranslations } from 'next-intl'
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'
import {
  User, Palette, BookOpen, Bell, PenSquare, Mail, FileSignature,
  LayoutTemplate, Users, Filter, Bot, ShieldCheck, X,
} from 'lucide-react'
import { Dialog, DialogPortal, DialogOverlay } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { SettingsModalPanel } from './SettingsModalPanel'

const NAV_ITEMS = [
  { seg: 'profile',       key: 'profile',       icon: User },
  { seg: 'appearance',    key: 'appearance',    icon: Palette },
  { seg: 'reading',       key: 'reading',       icon: BookOpen },
  { seg: 'notifications', key: 'notifications', icon: Bell },
  { seg: 'composition',   key: 'composition',   icon: PenSquare },
  { seg: 'accounts',      key: 'accounts',      icon: Mail },
  { seg: 'signatures',    key: 'signatures',    icon: FileSignature },
  { seg: 'templates',     key: 'templates',     icon: LayoutTemplate },
  { seg: 'contacts',      key: 'contacts',      icon: Users },
  { seg: 'rules',         key: 'rules',         icon: Filter },
  { seg: 'ai',            key: 'ai',            icon: Bot },
] as const

export function SettingsModal() {
  const router = useRouter()
  const pathname = usePathname()
  const t = useTranslations('settings.nav')
  const { data: session } = useSession()
  const isAdmin = (session?.user as { role?: string } | undefined)?.role === 'admin'

  const segment = pathname.replace(/^\/settings\/?/, '').split('/')[0] || 'profile'

  const close = () => router.back()

  const linkClass = (active: boolean) =>
    cn(
      'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors whitespace-nowrap',
      active
        ? 'bg-violet-500/10 text-violet-700 dark:text-violet-300 font-medium'
        : 'text-muted-foreground hover:bg-accent hover:text-foreground',
    )

  return (
    <Dialog open onOpenChange={(o) => { if (!o) close() }}>
      <DialogPortal>
        <DialogOverlay className="bg-black/40 supports-backdrop-filter:backdrop-blur-sm" />
        <DialogPrimitive.Popup
          data-slot="settings-modal"
          className={cn(
            'fixed left-1/2 top-1/2 z-50 flex -translate-x-1/2 -translate-y-1/2 overflow-hidden bg-background text-foreground outline-none',
            'h-[min(86vh,760px)] w-[min(1000px,calc(100vw-2rem))] rounded-2xl border border-border shadow-2xl',
            'data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 duration-150',
            'max-sm:inset-0 max-sm:h-full max-sm:w-full max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none max-sm:border-0',
            'flex-col sm:flex-row',
          )}
        >
          <DialogPrimitive.Title className="sr-only">Paramètres</DialogPrimitive.Title>

          {/* Nav — left rail on desktop, top scroll strip on mobile */}
          <nav
            aria-label="Paramètres"
            className={cn(
              'shrink-0 gap-1 border-border bg-card',
              'sm:flex sm:w-52 sm:flex-col sm:border-r sm:p-3',
              'flex overflow-x-auto border-b p-2',
            )}
          >
            {NAV_ITEMS.map(({ seg, key, icon: Icon }) => (
              <Link key={seg} href={`/settings/${seg}`} className={linkClass(segment === seg)}>
                <Icon className="h-4 w-4 shrink-0" />
                <span>{t(key)}</span>
              </Link>
            ))}
            {isAdmin && (
              <>
                <div className="my-1 hidden border-t border-border sm:block" />
                <Link href="/admin/users" onClick={close} className={linkClass(false)}>
                  <ShieldCheck className="h-4 w-4 shrink-0" />
                  <span>{t('admin')}</span>
                </Link>
              </>
            )}
          </nav>

          {/* Panel */}
          <div className="relative min-w-0 flex-1 overflow-y-auto">
            <DialogPrimitive.Close
              aria-label="Fermer"
              className="absolute right-3 top-3 z-10 grid h-8 w-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </DialogPrimitive.Close>
            <SettingsModalPanel segment={segment} />
          </div>
        </DialogPrimitive.Popup>
      </DialogPortal>
    </Dialog>
  )
}
