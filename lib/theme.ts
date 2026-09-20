/**
 * Single source for the theme: names, cookie, CSS class and `system` resolution.
 * Everything theme-related (provider, toggle, SSR) imports from here — none of
 * these values may be restated elsewhere.
 */

export const THEMES = ['light', 'dark', 'system'] as const
export type Theme = (typeof THEMES)[number]
export type ResolvedTheme = Exclude<Theme, 'system'>

export const DEFAULT_THEME: Theme = 'system'

/** Cookie readable by the server (flash-free SSR) AND by the inline script. */
export const THEME_COOKIE = 'synapmail-theme'
export const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365

/** `darkMode: "class"` in tailwind.config.ts: the only rendering contract. */
export const DARK_CLASS = 'dark'
export const DARK_MEDIA_QUERY = '(prefers-color-scheme: dark)'

export function isTheme(value: unknown): value is Theme {
  return typeof value === 'string' && (THEMES as readonly string[]).includes(value)
}

export function toTheme(value: unknown): Theme {
  return isTheme(value) ? value : DEFAULT_THEME
}

export function resolveTheme(theme: Theme, prefersDark: boolean): ResolvedTheme {
  if (theme === 'system') return prefersDark ? 'dark' : 'light'
  return theme
}

/** Adds / removes the `dark` class on `<html>` — idempotent. */
export function applyResolvedTheme(resolved: ResolvedTheme) {
  document.documentElement.classList.toggle(DARK_CLASS, resolved === 'dark')
}

export function themeCookieValue(theme: Theme): string {
  return `${THEME_COOKIE}=${theme}; path=/; max-age=${THEME_COOKIE_MAX_AGE}; SameSite=Lax`
}

/**
 * BLOCKING inline script, rendered as the FIRST CHILD OF `<body>`: it is only useful
 * for `system`, where the answer depends on the client and cannot fit in the cookie.
 * For `light` and `dark` the class is already applied during SSR — `null` is returned
 * then (not `''`) so the caller renders NO node rather than an empty text node.
 * No user data enters it: `theme` is one of the THEMES constants.
 */
export function themeInitScript(theme: Theme): string | null {
  if (theme !== 'system') return null
  return `if(matchMedia(${JSON.stringify(DARK_MEDIA_QUERY)}).matches)document.documentElement.classList.add(${JSON.stringify(DARK_CLASS)})`
}
