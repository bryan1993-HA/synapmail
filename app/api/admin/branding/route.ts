import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { query } from '@/lib/db'
import { isAdmin } from '@/lib/requireAdmin'
import { BRANDING_ERRORS, FAVICON_MAX_BYTES, cleanAppName, detectImageType } from '@/lib/branding'
import { readBranding } from '@/lib/brandingStore'

export const dynamic = 'force-dynamic'

const FORBIDDEN = 403
const BAD_REQUEST = 400

async function guard() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await isAdmin(session))) return NextResponse.json({ error: 'Forbidden' }, { status: FORBIDDEN })
  return null
}

/** The instance row always exists after this call: everything else is an UPDATE. */
async function ensureRow() {
  await query('INSERT INTO instance_settings (id) VALUES (TRUE) ON CONFLICT (id) DO NOTHING')
}

export async function GET() {
  const refused = await guard()
  if (refused) return refused
  return NextResponse.json({ data: await readBranding() })
}

/**
 * Saves the name, the icon, or both. The body is `multipart/form-data` because it
 * carries a file: `appName` (text) and `favicon` (file) are both optional, which
 * allows changing only one of the two.
 *
 * The icon's type is decided from its BYTES, never from its extension nor from the
 * type declared by the browser: the detected type is the one stored, and later
 * re-served by `GET /api/branding/favicon`.
 */
export async function PUT(req: Request) {
  const refused = await guard()
  if (refused) return refused

  try {
    const form = await req.formData()
    const rawName = form.get('appName')
    const file = form.get('favicon')

    let appName: string | null = null
    if (rawName !== null) {
      appName = cleanAppName(rawName)
      if (appName === null) {
        return NextResponse.json({ error: BRANDING_ERRORS.badName }, { status: BAD_REQUEST })
      }
    }

    let favicon: { bytes: Buffer; type: string } | null = null
    if (file instanceof File && file.size > 0) {
      if (file.size > FAVICON_MAX_BYTES) {
        return NextResponse.json({ error: BRANDING_ERRORS.tooLarge }, { status: BAD_REQUEST })
      }
      const bytes = Buffer.from(await file.arrayBuffer())
      // Second size check, on the bytes actually read: `file.size` comes from the
      // client and proves nothing.
      if (bytes.length > FAVICON_MAX_BYTES) {
        return NextResponse.json({ error: BRANDING_ERRORS.tooLarge }, { status: BAD_REQUEST })
      }
      const type = detectImageType(bytes)
      if (!type) return NextResponse.json({ error: BRANDING_ERRORS.badType }, { status: BAD_REQUEST })
      favicon = { bytes, type }
    }

    if (!appName && !favicon) {
      return NextResponse.json({ error: BRANDING_ERRORS.badName }, { status: BAD_REQUEST })
    }

    await ensureRow()
    if (appName) await query('UPDATE instance_settings SET app_name = $1 WHERE id = TRUE', [appName])
    if (favicon) {
      await query(
        'UPDATE instance_settings SET favicon = $1, favicon_type = $2, favicon_updated_at = NOW() WHERE id = TRUE',
        [favicon.bytes, favicon.type]
      )
    }

    return NextResponse.json({ data: await readBranding() })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

/**
 * Reset, field by field: `?target=name` restores the original name,
 * `?target=favicon` restores the files from `public/`. Without a recognized target,
 * nothing is cleared — an accidental full reset would be irreversible.
 */
export async function DELETE(req: Request) {
  const refused = await guard()
  if (refused) return refused

  const target = new URL(req.url).searchParams.get('target')
  try {
    if (target === 'name') {
      await query('UPDATE instance_settings SET app_name = NULL WHERE id = TRUE')
    } else if (target === 'favicon') {
      await query(
        'UPDATE instance_settings SET favicon = NULL, favicon_type = NULL, favicon_updated_at = NULL WHERE id = TRUE'
      )
    } else {
      return NextResponse.json({ error: 'target must be name or favicon' }, { status: BAD_REQUEST })
    }
    return NextResponse.json({ data: await readBranding() })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
