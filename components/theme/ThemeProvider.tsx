'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import useSWR, { mutate as globalMutate } from 'swr'
import { isPublicPath } from '@/lib/publicPaths'
import {
  DARK_MEDIA_QUERY,
  DEFAULT_THEME,
  applyResolvedTheme,
  resolveTheme,
  themeCookieValue,
  toTheme,
  type ResolvedTheme,
  type Theme,
} from '@/lib/theme'

interface ThemeContextValue {
  /** The user's preference: light | dark | system. */
  theme: Theme
  /** What is actually displayed (`system` already resolved). */
  resolvedTheme: ResolvedTheme
  setTheme: (theme: Theme) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

const fetcher = (url: string) => fetch(url).then((r) => r.json())

function prefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(DARK_MEDIA_QUERY).matches
}

export function ThemeProvider({
  initialTheme = DEFAULT_THEME,
  children,
}: {
  /** Cookie value read during SSR: avoids any flash on the first render. */
  initialTheme?: Theme
  children: React.ReactNode
}) {
  const [theme, setThemeState] = useState<Theme>(initialTheme)
  const [systemDark, setSystemDark] = useState(false)

  // `user_settings.theme` is authoritative (cross-device); the cookie is only a local
  // mirror for SSR. It is applied just once, otherwise a preference changed in the tab
  // would be overwritten on every SWR revalidation. On a public page (sign-in, sign-up)
  // there is no session: nothing is requested and the cookie is enough — otherwise every
  // /login load would log a 401 in the console.
  const pathname = usePathname()
  const { data: settings } = useSWR<{ data?: { theme?: string } }>(isPublicPath(pathname) ? null : '/api/settings', fetcher)
  const hydratedFromServer = useRef(false)

  useEffect(() => {
    const serverTheme = settings?.data?.theme
    if (hydratedFromServer.current || serverTheme === undefined) return
    hydratedFromServer.current = true
    const next = toTheme(serverTheme)
    setThemeState(next)
    document.cookie = themeCookieValue(next)
  }, [settings])

  // `system` follows OS changes live, with no reload.
  useEffect(() => {
    const media = window.matchMedia(DARK_MEDIA_QUERY)
    setSystemDark(media.matches)
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  const resolvedTheme = resolveTheme(theme, systemDark)

  useEffect(() => {
    applyResolvedTheme(resolvedTheme)
  }, [resolvedTheme])

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next)
    setSystemDark(prefersDark())
    document.cookie = themeCookieValue(next)
    // Optimistic on the shared SWR key, then revalidate once the PATCH has landed.
    globalMutate(
      '/api/settings',
      (curr: { data?: Record<string, unknown> } | undefined) =>
        curr?.data ? { ...curr, data: { ...curr.data, theme: next } } : curr,
      false
    )
    fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme: next }),
    })
      .catch(() => undefined)
      .then(() => globalMutate('/api/settings'))
  }, [])

  const value = useMemo(
    () => ({ theme, resolvedTheme, setTheme }),
    [theme, resolvedTheme, setTheme]
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within <ThemeProvider>')
  return ctx
}
