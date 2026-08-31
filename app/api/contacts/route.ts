import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { query } from '@/lib/db'

export const dynamic = 'force-dynamic'

type ContactRow = {
  id: string
  name: string
  email: string
  frequency: number
  sent_count: number
  received_count: number
  last_contact_at: string
  is_starred: boolean
  is_manual: boolean
  notes: string | null
  created_at: string
}

function toApi(r: ContactRow) {
  return {
    id: r.id,
    name: r.name,
    email: r.email,
    frequency: r.frequency,
    sentCount: r.sent_count,
    receivedCount: r.received_count,
    lastContactAt: r.last_contact_at,
    isStarred: r.is_starred,
    isManual: r.is_manual,
    notes: r.notes,
    createdAt: r.created_at,
  }
}

// GET /api/contacts?q=...&limit=8&all=true&account=<accountId>
// - q: fuzzy search on name or email (default: '')
// - limit: max results (default 8, max 50)
// - all: if true, bypass frequency >= 2 filter (for Settings page)
// - account: if set, only return contacts seen on this account (via messages_cache)
export async function GET(req: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const q = searchParams.get('q') ?? ''
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '8'), 50)
  const all = searchParams.get('all') === 'true'
  const sort = searchParams.get('sort') ?? 'score' // 'score' | 'name' | 'frequency' | 'recent'
  const accountId = searchParams.get('account')

  const pattern = `%${q.replace(/[%_\\]/g, '\\$&')}%`

  let orderBy: string
  if (sort === 'name') {
    orderBy = 'is_starred DESC, name ASC'
  } else if (sort === 'frequency') {
    orderBy = 'is_starred DESC, frequency DESC, last_contact_at DESC'
  } else if (sort === 'recent') {
    orderBy = 'is_starred DESC, last_contact_at DESC'
  } else {
    // Score: frequency + recency boost + bidirectionality bonus
    orderBy = `is_starred DESC,
      (frequency * 0.5
       + (1.0 / LN(EXTRACT(EPOCH FROM (NOW() - last_contact_at)) / 86400.0 + 2)) * 35.0
       + CASE WHEN sent_count > 0 AND received_count > 0 THEN 15.0 ELSE 0 END
      ) DESC`
  }

  const frequencyFilter = all ? '' : 'AND (frequency >= 2 OR is_manual = true)'

  // Filter by account: only contacts seen in messages_cache for this account
  const params: unknown[] = [session.user?.id, pattern, limit]
  let accountFilter = ''
  if (accountId) {
    params.push(accountId)
    accountFilter = `AND email IN (
      SELECT DISTINCT from_address FROM messages_cache WHERE account_id = $${params.length}
    )`
  }

  const rows = await query<ContactRow>(
    `SELECT * FROM contacts
     WHERE user_id = $1
       ${frequencyFilter}
       ${accountFilter}
       AND ($2 = '%%' OR name ILIKE $2 OR email ILIKE $2)
     ORDER BY ${orderBy}
     LIMIT $3`,
    params
  )

  return NextResponse.json({ data: rows.map(toApi) })
}

// POST /api/contacts — create manual contact
export async function POST(req: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { name, email, notes } = body as { name?: string; email: string; notes?: string }

  const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!email?.trim()) return NextResponse.json({ error: 'email required' }, { status: 400 })
  if (!EMAIL_REGEX.test(email.trim())) return NextResponse.json({ error: 'email invalide' }, { status: 400 })

  const normalizedEmail = email.trim().toLowerCase()
  const resolvedName = (name ?? '').trim() || normalizedEmail.split('@')[0]

  const rows = await query<{ id: string }>(
    `INSERT INTO contacts (user_id, name, email, is_manual, notes, frequency)
     VALUES ($1, $2, $3, true, $4, 1)
     ON CONFLICT (user_id, email) DO UPDATE SET
       name       = CASE WHEN $2 != '' THEN $2 ELSE contacts.name END,
       notes      = COALESCE($4, contacts.notes),
       is_manual  = true,
       updated_at = NOW()
     RETURNING id`,
    [session.user?.id, resolvedName, normalizedEmail, notes ?? null]
  )

  return NextResponse.json({ data: { id: rows[0].id } }, { status: 201 })
}

// DELETE /api/contacts?oneshots=true — bulk clean one-shot contacts
export async function DELETE(req: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  if (searchParams.get('oneshots') !== 'true') {
    return NextResponse.json({ error: 'Missing oneshots=true param' }, { status: 400 })
  }

  const result = await query<{ count: string }>(
    `WITH deleted AS (
       DELETE FROM contacts
       WHERE user_id = $1
         AND frequency < 2
         AND is_manual = false
         AND is_starred = false
       RETURNING id
     )
     SELECT COUNT(*) AS count FROM deleted`,
    [session.user?.id]
  )

  return NextResponse.json({ data: { deleted: parseInt(result[0]?.count ?? '0') } })
}
