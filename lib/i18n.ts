import { getRequestConfig } from 'next-intl/server'
import { cookies, headers } from 'next/headers'

const locales = ['en', 'fr'] as const
type Locale = (typeof locales)[number]

function detectLocale(): Locale {
  // 1. Cookie preference
  const cookieStore = cookies()
  const cookieLocale = cookieStore.get('synapmail-locale')?.value
  if (cookieLocale && locales.includes(cookieLocale as Locale)) {
    return cookieLocale as Locale
  }

  // 2. Accept-Language header
  const headerStore = headers()
  const acceptLang = headerStore.get('accept-language') ?? ''
  for (const part of acceptLang.split(',')) {
    const lang = part.split(';')[0].trim().toLowerCase().substring(0, 2)
    if (locales.includes(lang as Locale)) {
      return lang as Locale
    }
  }

  return 'en'
}

export default getRequestConfig(async () => {
  const locale = detectLocale()
  return {
    locale,
    messages: (await import(`../locales/${locale}.json`)).default,
  }
})
