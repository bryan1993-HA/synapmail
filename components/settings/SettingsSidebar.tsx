'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  User, Palette, BookOpen, Bell, PenSquare,
  Mail, FileSignature, ArrowLeft, ShieldCheck, Users, Filter, LayoutTemplate, Bot,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const NAV_ITEMS = [
  { href: '/settings/profile',       label: 'Profil',        icon: User },
  { href: '/settings/appearance',    label: 'Apparence',     icon: Palette },
  { href: '/settings/reading',       label: 'Lecture',       icon: BookOpen },
  { href: '/settings/notifications', label: 'Notifications', icon: Bell },
  { href: '/settings/composition',   label: 'Composition',   icon: PenSquare },
  { href: '/settings/accounts',      label: 'Comptes',       icon: Mail },
  { href: '/settings/signatures',    label: 'Signatures',    icon: FileSignature },
  { href: '/settings/templates',     label: 'Templates',     icon: LayoutTemplate },
  { href: '/settings/contacts',      label: 'Contacts',      icon: Users },
  { href: '/settings/rules',         label: 'Règles',        icon: Filter },
  { href: '/settings/ai',            label: 'IA Copilot',    icon: Bot },
]

export function SettingsSidebar({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname()

  return (
    <aside className="w-56 shrink-0 border-r border-border bg-background flex flex-col h-full">
      {/* Back to mail */}
      <div className="px-3 pt-4 pb-3 border-b border-border">
        <Link
          href="/mail"
          className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        >
          <ArrowLeft className="w-4 h-4 shrink-0" />
          <span>Messagerie</span>
        </Link>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-3 space-y-0.5 overflow-y-auto">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = pathname.startsWith(href)
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors',
                active
                  ? 'bg-primary/10 text-primary font-medium'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent'
              )}
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span>{label}</span>
            </Link>
          )
        })}

        {isAdmin && (
          <>
            <div className="my-2 border-t border-border" />
            <Link
              href="/admin/users"
              className={cn(
                'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors',
                pathname.startsWith('/admin')
                  ? 'bg-primary/10 text-primary font-medium'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent'
              )}
            >
              <ShieldCheck className="w-4 h-4 shrink-0" />
              <span>Administration</span>
            </Link>
          </>
        )}
      </nav>

      {/* Footer */}
      <div className="px-4 pb-4 pt-2 border-t border-border">
        <p className="text-[10px] text-muted-foreground/50 tracking-wide uppercase">Synapmail</p>
      </div>
    </aside>
  )
}
