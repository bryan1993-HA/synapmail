import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { query } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const q = searchParams.get('q')?.trim()

  if (!q || q.length < 2) {
    return NextResponse.json({ data: [] })
  }

  try {
    const results = await query(
      `SELECT mc.*, ea.id as account_id
       FROM messages_cache mc
       JOIN email_accounts ea ON ea.id = mc.account_id
       WHERE ea.user_id = $1
         AND (
           mc.subject ILIKE $2
           OR mc.from_name ILIKE $2
           OR mc.from_address ILIKE $2
           OR mc.preview ILIKE $2
         )
       ORDER BY mc.date DESC
       LIMIT 50`,
      [session.user?.id, `%${q}%`]
    )

    return NextResponse.json({ data: results })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
