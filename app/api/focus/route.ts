import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { query } from '@/lib/db'
import { getFocusItems } from '@/lib/focus'

export const dynamic = 'force-dynamic'

/**
 * Light-weight "à traiter" list for the mail reading-pane empty state.
 * Same ranking as the dashboard focus widget, but a single scoped query
 * instead of the full dashboard aggregation.
 */
export async function GET(req: Request) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const requested = new URL(req.url).searchParams.get('account')
    let acct: string | null = null
    if (requested) {
      const owned = await query<{ id: string }>(
        'SELECT id FROM email_accounts WHERE id = $1 AND user_id = $2 LIMIT 1',
        [requested, userId],
      )
      acct = owned[0]?.id ?? null
    }

    const items = await getFocusItems(userId, acct, 5)
    return NextResponse.json({ data: items })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
