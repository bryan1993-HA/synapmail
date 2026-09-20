'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import useSWR, { mutate } from 'swr'
import { Omnibar, OMNIBAR } from './Omnibar'
import { Sidebar, SIDEBAR } from './Sidebar'
import { UpdateBanner } from './UpdateBanner'

const fetcher = (url: string) => fetch(url).then(r => r.json())

export function AppShell({ children }: { children: React.ReactNode }) {
  const t = useTranslations('mail')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  // SSR-safe default (false) until the settings SWR resolves after mount — no hydration mismatch.
  const { data: settingsData } = useSWR<{ data: { sidebar_collapsed: boolean } }>('/api/settings', fetcher)
  const sidebarCollapsed = settingsData?.data?.sidebar_collapsed ?? false
  // One button, two effects: above `lg` the bar is a column and folds; below it the
  // bar is a drawer and opens. Read from the SAME breakpoint the <aside> is hidden on,
  // so the button can never disagree with what is actually on screen.
  const [isDesktop, setIsDesktop] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia(OMNIBAR.desktopQuery)
    const sync = () => setIsDesktop(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  const toggleCollapse = () => {
    const next = !sidebarCollapsed
    mutate('/api/settings', (curr: { data: Record<string, unknown> } | undefined) =>
      curr ? { data: { ...curr.data, sidebar_collapsed: next } } : curr, false)
    fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sidebar_collapsed: next }),
    }).then(() => mutate('/api/settings'))
  }

  return (
    // A ROW: the bar owns the full height, the header starts at its right edge and
    // follows the width animation on its own (no offset to keep in sync, no jump).
    <div className="relative flex h-screen overflow-hidden bg-muted/30">
      {/* Desktop sidebar — width animated from the single geometry source */}
      <aside
        className="hidden lg:flex shrink-0 flex-col overflow-hidden border-r border-border transition-[width]"
        style={{
          width: sidebarCollapsed ? SIDEBAR.collapsedWidth : SIDEBAR.expandedWidth,
          transitionDuration: `${SIDEBAR.transitionMs}ms`,
        }}
      >
        <Sidebar collapsed={sidebarCollapsed} />
      </aside>

      {/* Mobile overlay sidebar */}
      {sidebarOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex" data-sidebar-drawer>
          <div
            className="fixed inset-0 bg-black/50"
            onClick={() => setSidebarOpen(false)}
          />
          <aside
            className="relative z-10 h-full flex flex-col overflow-hidden border-r border-border shadow-2xl"
            style={{ width: SIDEBAR.expandedWidth }}
          >
            <Sidebar onClose={() => setSidebarOpen(false)} />
          </aside>
        </div>
      )}

      {/* Content column: the header sits above the content only, never above the bar */}
      <div className="flex flex-1 min-w-0 flex-col">
        <Omnibar
          onMenu={isDesktop ? toggleCollapse : () => setSidebarOpen(true)}
          menuLabel={isDesktop && !sidebarCollapsed ? t('collapseSidebar') : t('expandSidebar')}
          menuExpanded={isDesktop ? !sidebarCollapsed : sidebarOpen}
        />

        <main className="flex-1 overflow-hidden flex flex-col min-w-0">
          {/* Update banner */}
          <UpdateBanner />

          {children}
        </main>
      </div>
    </div>
  )
}
