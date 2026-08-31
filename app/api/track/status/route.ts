import { type NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { query } from '@/lib/db'
import type { ReadReceipt } from '@/types/email'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const accountId = searchParams.get('accountId') ?? ''
  const raw = searchParams.get('subjects') ?? ''
  const subjects = raw.split('|||').map(s => s.trim()).filter(Boolean)

  if (!subjects.length || !accountId) return NextResponse.json({ data: {} })

  // Match by account_id + subject (avoids Outlook message-ID rewrite issue)
  const rows = await query<{
    subject: string
    opened_at: string | null
    open_count: number
  }>(
    `SELECT subject, opened_at, open_count
     FROM sent_tracking
     WHERE user_id = $1 AND account_id = $2 AND subject = ANY($3::text[])
     ORDER BY created_at DESC`,
    [session.user?.id, accountId, subjects]
  )

  // Keep only the most recent tracking record per subject
  const data: Record<string, ReadReceipt> = {}
  for (const row of rows) {
    if (row.subject && !(row.subject in data)) {
      data[row.subject] = {
        opened: !!row.opened_at,
        openedAt: row.opened_at,
        openCount: row.open_count,
      }
    }
  }

  return NextResponse.json({ data })
}
