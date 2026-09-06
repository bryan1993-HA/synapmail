'use client'

import { SessionProvider } from 'next-auth/react'
import { ThemeProvider } from 'next-themes'
import { SWRConfig } from 'swr'
import { Toaster } from '@/components/ui/toast'

export function Providers({ children }: { children: React.ReactNode }) {
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
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          {children}
          <Toaster />
        </ThemeProvider>
      </SWRConfig>
    </SessionProvider>
  )
}
