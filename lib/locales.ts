/**
 * Single source of truth for the locales this app ships.
 *
 * Add a code here and a matching `locales/<code>.json`; `scripts/check-locales.mjs`
 * enforces key parity between the two. Kept free of server-only imports so both
 * `lib/i18n.ts` (server) and the appearance settings page (client) can use it.
 *
 * Labels are endonyms — a language is always listed in its own script, so a user
 * who cannot read the current interface language can still find their own.
 */
export const LOCALES = [
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'Français' },
  { code: 'zh', label: '中文' },
] as const

export type Locale = (typeof LOCALES)[number]['code']

export const LOCALE_CODES = LOCALES.map(l => l.code) as readonly Locale[]

export const DEFAULT_LOCALE: Locale = 'en'

/** Cookie written by the appearance settings page and read by `lib/i18n.ts`. */
export const LOCALE_COOKIE = 'synapmail-locale'

export function isLocale(value: string | undefined): value is Locale {
  return !!value && (LOCALE_CODES as readonly string[]).includes(value)
}

/** One year, in seconds: the language choice must outlive the session. */
export const LOCALE_COOKIE_MAX_AGE = 365 * 24 * 60 * 60

/**
 * Changing the language, in ONE place: the cookie `lib/i18n.ts` reads back, the
 * stored preference, then a reload (next-intl picks the language during server
 * rendering, so there is nothing to refresh client-side). The Appearance
 * settings and the omnibar call THIS function, never a copy.
 */
export async function setLocale(code: Locale): Promise<void> {
  document.cookie = `${LOCALE_COOKIE}=${code}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE}; SameSite=Lax`
  await fetch('/api/settings', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ language: code }),
  })
  window.location.reload()
}
