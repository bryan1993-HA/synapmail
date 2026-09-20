/**
 * Instance identity: the name shown in the browser tab and that tab's icon. The
 * SINGLE source of the default name, the limits, the rejection codes and the type
 * detection — imported by the public route, the admin route, `app/layout.tsx` and
 * the administration screen. None of these values is restated anywhere else.
 *
 * This file reads neither database nor request: it is PURE, hence testable on its
 * own (`scripts/check-branding.mjs`). Everything touching Postgres lives in
 * `lib/brandingStore.ts`, which imports from here.
 */
/** The product name when the instance has not chosen another one. */
export const DEFAULT_APP_NAME = 'Synapmail'

/** Bounds on the entered name: neither empty, nor long enough to overflow a tab. */
export const APP_NAME_MIN = 1
export const APP_NAME_MAX = 60

/** 256 KiB: a favicon fits well within this, a full-size image does not. */
export const FAVICON_MAX_BYTES = 256 * 1024

/** Rejection codes rendered on screen via `locales/*.json` (`admin.branding.errors.*` keys). */
export const BRANDING_ERRORS = {
  tooLarge: 'branding_too_large',
  badType: 'branding_bad_type',
  badName: 'branding_bad_name',
} as const

export type BrandingError = (typeof BRANDING_ERRORS)[keyof typeof BRANDING_ERRORS]

/**
 * Accepted types, decided on the file's MAGIC BYTES and never on its extension or
 * on the type declared by the browser: an SVG renamed `.png` must be rejected, and
 * a PNG renamed `.svg` must pass.
 *
 * SVG is deliberately ABSENT: served from our own origin, it would execute its
 * script if the icon URL were opened directly.
 */
type Signature = { type: string; match: (b: Uint8Array) => boolean }

const startsWith = (bytes: Uint8Array, prefix: readonly number[]): boolean =>
  bytes.length >= prefix.length && prefix.every((byte, i) => bytes[i] === byte)

const SIGNATURES: readonly Signature[] = [
  { type: 'image/png', match: b => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
  // ICO: Windows resource header, reserved 0x0000 then type 1 (icon).
  { type: 'image/x-icon', match: b => startsWith(b, [0x00, 0x00, 0x01, 0x00]) },
  { type: 'image/jpeg', match: b => startsWith(b, [0xff, 0xd8, 0xff]) },
  // WebP: RIFF container, the format signature sits at bytes 8..11.
  {
    type: 'image/webp',
    match: b =>
      startsWith(b, [0x52, 0x49, 0x46, 0x46]) &&
      b.length >= 12 &&
      startsWith(b.subarray(8), [0x57, 0x45, 0x42, 0x50]),
  },
]

/** The file's REAL type, or `null` when no known signature matches. */
export function detectImageType(bytes: Uint8Array): string | null {
  return SIGNATURES.find(s => s.match(bytes))?.type ?? null
}

/**
 * Cleans the entered name: whitespace collapsed, edges trimmed, control characters
 * rejected (they would pass invisibly inside a tab title). Returns `null` when
 * nothing acceptable comes out — the caller then answers `badName`.
 */
export function cleanAppName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(raw)) return null
  const cleaned = raw.replace(/\s+/g, ' ').trim()
  if (cleaned.length < APP_NAME_MIN || cleaned.length > APP_NAME_MAX) return null
  return cleaned
}

/** What the whole application reads: an effective name, and the icon version. */
export type Branding = {
  appName: string
  /**
   * Timestamp of the last stored icon, in milliseconds — used as the version in the
   * icon URL so that long-lived caching is safe. `null` when no icon is set: the
   * files from `public/` are served instead.
   */
  faviconVersion: number | null
}

export const DEFAULT_BRANDING: Branding = { appName: DEFAULT_APP_NAME, faviconVersion: null }

/** Public icon route, with its version: this URL is written in exactly one place. */
export const FAVICON_PATH = '/api/branding/favicon'
export const faviconUrl = (version: number): string => `${FAVICON_PATH}?v=${version}`

/**
 * The icons shipped in `public/`, served as long as the instance has not chosen
 * another one. SINGLE source: read by `app/layout.tsx` for the metadata AND by the
 * administration screen on reset, which must lay down EXACTLY the same links
 * without reloading the page.
 */
export const BUNDLED_FAVICONS = [
  { url: '/favicon.ico', type: 'image/x-icon', sizes: 'any' },
  { url: '/brand/png/synapmail-favicon@64.png', type: 'image/png', sizes: '64x64' },
] as const

/** Shipped apple-touch icon: outside the instance setting's scope, never replaced. */
export const BUNDLED_APPLE_ICON = { url: '/brand/png/synapmail-icone@512.png', sizes: '512x512' } as const

/**
 * The `<link rel="icon">` links to emit for a given identity: the configured icon
 * when there is one, otherwise the shipped files. One single rule, read by the
 * server render as well as by the reload-free tab update.
 */
export function faviconLinks(faviconVersion: number | null): readonly { url: string; type?: string; sizes?: string }[] {
  return faviconVersion === null ? BUNDLED_FAVICONS : [{ url: faviconUrl(faviconVersion) }]
}
