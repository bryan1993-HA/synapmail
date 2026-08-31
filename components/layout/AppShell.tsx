'use client'

import { useState } from 'react'
import { Menu } from 'lucide-react'
import { Sidebar } from './Sidebar'
import { UpdateBanner } from './UpdateBanner'

export function AppShell({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('synapmail:sidebarCollapsed') === 'true'
    }
    return false
  })

  const toggleCollapse = () => {
    setSidebarCollapsed(v => {
      const next = !v
      localStorage.setItem('synapmail:sidebarCollapsed', String(next))
      return next
    })
  }

  return (
    <div className="flex h-screen overflow-hidden bg-muted/30">
      {/* Desktop sidebar */}
      <aside className={`hidden lg:flex shrink-0 flex-col bg-zinc-900 dark:bg-zinc-950 text-zinc-100 transition-all duration-200 ${sidebarCollapsed ? 'w-14' : 'w-64'}`}>
        <Sidebar collapsed={sidebarCollapsed} onToggleCollapse={toggleCollapse} />
      </aside>

      {/* Mobile overlay sidebar */}
      {sidebarOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div
            className="fixed inset-0 bg-black/50"
            onClick={() => setSidebarOpen(false)}
          />
          <aside className="relative z-10 w-64 h-full flex flex-col bg-zinc-900 dark:bg-zinc-950 text-zinc-100 shadow-2xl">
            <Sidebar onClose={() => setSidebarOpen(false)} />
          </aside>
        </div>
      )}

      <main className="flex-1 overflow-hidden flex flex-col min-w-0">
        {/* Update banner */}
        <UpdateBanner />

        {/* Mobile top bar */}
        <div className="lg:hidden flex items-center gap-3 px-4 py-3 border-b border-border bg-background shrink-0">
          <button
            onClick={() => setSidebarOpen(true)}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2">
            <img
              src="/brand/svg/synapmail-icone.svg"
              alt="Synapmail"
              className="w-6 h-6"
            />
            <span className="font-bold text-sm tracking-tight">Synapmail</span>
          </div>
        </div>

        {children}
      </main>
    </div>
  )
}
