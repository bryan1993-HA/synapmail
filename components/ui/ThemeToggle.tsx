'use client'

import { useTheme } from 'next-themes'
import { Sun, Moon, Monitor } from 'lucide-react'
import { cn } from '@/lib/utils'

export function ThemeToggle({ className, collapsed }: { className?: string; collapsed?: boolean }) {
  const { theme, setTheme } = useTheme()

  const cycle = () => {
    if (theme === 'light') setTheme('dark')
    else if (theme === 'dark') setTheme('system')
    else setTheme('light')
  }

  const Icon = theme === 'light' ? Sun : theme === 'dark' ? Moon : Monitor
  const label = theme === 'light' ? 'Clair' : theme === 'dark' ? 'Sombre' : 'Système'

  return (
    <button
      onClick={cycle}
      title={`Thème : ${label}`}
      className={cn(
        'flex items-center rounded-lg text-sm text-zinc-500 hover:text-zinc-200 hover:bg-white/8 transition-all w-full',
        collapsed ? 'justify-center py-2' : 'gap-3 px-3 py-2',
        className
      )}
    >
      <Icon className="w-4 h-4 shrink-0" />
      {!collapsed && <span>{label}</span>}
    </button>
  )
}
