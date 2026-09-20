import { getRequestConfig } from 'next-intl/server'
import { cookies, headers } from 'next/headers'
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale, type Locale } from './locales'

/** Length of the primary subtag we match on, so `zh-CN` and `zh-TW` both resolve to `zh`. */
const PRIMARY_SUBTAG_LENGTH = 2

function detectLocale(): Locale {
  // 1. Cookie preference
  const cookieLocale = cookies().get(LOCALE_COOKIE)?.value
  if (isLocale(cookieLocale)) return cookieLocale

  // 2. Accept-Language header
  const acceptLang = headers().get('accept-language') ?? ''
  for (const part of acceptLang.split(',')) {
    const lang = part.split(';')[0].trim().toLowerCase().substring(0, PRIMARY_SUBTAG_LENGTH)
    if (isLocale(lang)) return lang
  }

  return DEFAULT_LOCALE
}

export default getRequestConfig(async () => {
  const locale = detectLocale()
  return {
    locale,
    messages: (await import(`../locales/${locale}.json`)).default,
  }
})
