/**
 * Reading the instance identity from the database — the only door to the
 * `instance_settings` table. The rules (default name, bounds, accepted types) live
 * in `lib/branding.ts`, which stays pure and testable without Postgres.
 */
import { query } from '@/lib/db'
import { DEFAULT_APP_NAME, DEFAULT_BRANDING, cleanAppName, type Branding } from '@/lib/branding'

type BrandingRow = { app_name: string | null; favicon_updated_at: Date | null }

/**
 * A database not yet initialised (table missing on first start) must yield the
 * original appearance, not an error page: the failure therefore falls back to
 * `DEFAULT_BRANDING`.
 */
export async function readBranding(): Promise<Branding> {
  try {
    const rows = await query<BrandingRow>(
      'SELECT app_name, favicon_updated_at FROM instance_settings WHERE id = TRUE'
    )
    const row = rows[0]
    if (!row) return DEFAULT_BRANDING
    return {
      appName: cleanAppName(row.app_name) ?? DEFAULT_APP_NAME,
      faviconVersion: row.favicon_updated_at ? row.favicon_updated_at.getTime() : null,
    }
  } catch {
    return DEFAULT_BRANDING
  }
}

export type StoredFavicon = { bytes: Buffer; type: string; version: number }

/** The icon bytes, or `null` when none is set (the route then answers 404). */
export async function readFavicon(): Promise<StoredFavicon | null> {
  try {
    const rows = await query<{ favicon: Buffer | null; favicon_type: string | null; favicon_updated_at: Date | null }>(
      'SELECT favicon, favicon_type, favicon_updated_at FROM instance_settings WHERE id = TRUE'
    )
    const row = rows[0]
    if (!row?.favicon || !row.favicon_type || !row.favicon_updated_at) return null
    return { bytes: row.favicon, type: row.favicon_type, version: row.favicon_updated_at.getTime() }
  } catch {
    return null
  }
}
