import type { Metadata } from 'next'
import './globals.css'
import { BUNDLED_APPLE_ICON, faviconLinks } from '@/lib/branding'
import { readBranding } from '@/lib/brandingStore'
import { Providers } from '@/components/providers'
import { NextIntlClientProvider } from 'next-intl'
import { getLocale, getMessages } from 'next-intl/server'
import { cookies } from 'next/headers'
import {
  DARK_CLASS,
  THEME_COOKIE,
  themeInitScript,
  toTheme,
} from '@/lib/theme'

/**
 * The tab title and its icon come from the instance setting when one exists, and from
 * the bundled defaults otherwise: an instance that configured nothing does not change
 * appearance on upgrade. The PWA / apple-touch icons are NOT covered by this setting
 * (out of scope): `apple` stays the bundled file.
 */
export async function generateMetadata(): Promise<Metadata> {
  const { appName, faviconVersion } = await readBranding()
  return {
    title: appName,
    description: 'Self-hosted AI-powered email client',
    icons: { icon: [...faviconLinks(faviconVersion)], apple: BUNDLED_APPLE_ICON },
  }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale()
  const messages = await getMessages()
  const theme = toTheme(cookies().get(THEME_COOKIE)?.value)
  const { appName } = await readBranding()
  // `light`/`dark` are resolved right here (no flash); `system` depends on the client,
  // hence the blocking script below, which is `null` for the other two cases.
  const initScript = themeInitScript(theme)

  return (
    <html lang={locale} className={theme === 'dark' ? DARK_CLASS : undefined} suppressHydrationWarning>
      {/* No hand-written `<head>`: the App Router composes it itself (metadata, style
          sheets) and a manual `<head>` breaks hydration. The init script is therefore the
          FIRST child of `<body>` — it runs before the content is rendered, so there is
          never a flash. */}
      <body className="font-sans antialiased">
        {initScript !== null && <script dangerouslySetInnerHTML={{ __html: initScript }} />}
        <NextIntlClientProvider messages={messages}>
          <Providers initialTheme={theme} appName={appName}>{children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
