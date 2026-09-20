'use client'

import { createContext, useContext } from 'react'
import { SessionProvider } from 'next-auth/react'
import { ThemeProvider } from '@/components/theme/ThemeProvider'
import { SWRConfig } from 'swr'
import { Toaster } from '@/components/ui/toast'
import { DEFAULT_THEME, type Theme } from '@/lib/theme'
import { DEFAULT_APP_NAME } from '@/lib/branding'

/**
 * The instance name, resolved once on the server in `app/layout.tsx` and distributed
 * here: every VISIBLE piece of text that names the product reads `useAppName()`, so a
 * single setting is enough to rename them all.
 */
const AppNameContext = createContext(DEFAULT_APP_NAME)
export const useAppName = () => useContext(AppNameContext)

export function Providers({
  initialTheme = DEFAULT_THEME,
  appName = DEFAULT_APP_NAME,
  children,
}: {
  initialTheme?: Theme
  appName?: string
  children: React.ReactNode
}) {
  return (
    <SessionProvider>
      {/* Global SWR resilience:
          - dedupingInterval collapses identical requests fired in a short burst
            (e.g. clicking quickly between folders), so each IMAP-backed endpoint
            is not hit repeatedly for the same key.
          - errorRetryCount caps retries so a failing request (IMAP down / 500)
            does not turn into an endless retry storm that saturates the mail
            server's simultaneous-connection limit. */}
      <SWRConfig
        value={{
          dedupingInterval: 5000,
          errorRetryCount: 2,
          errorRetryInterval: 5000,
        }}
      >
        <ThemeProvider initialTheme={initialTheme}>
          <AppNameContext.Provider value={appName}>
            {children}
            <Toaster />
          </AppNameContext.Provider>
        </ThemeProvider>
      </SWRConfig>
    </SessionProvider>
  )
}
