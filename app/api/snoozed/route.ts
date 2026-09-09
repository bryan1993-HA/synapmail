import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { query } from '@/lib/db'

export const dynamic = 'force-dynamic'

type SnoozedRow = {
  uid: string
  account_id: string
  folder: string
  subject: string | null
  from_address: string | null
  from_name: string | null
  snooze_until: string
}

/** Pending snoozes for the current user, optionally scoped to one account. */
export async function GET(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const accountId = new URL(req.url).searchParams.get('account')

  try {
    const params: unknown[] = [session.user.id]
    let filter = ''
    if (accountId) {
      params.push(accountId)
      filter = 'AND sm.account_id = $2'
    }

    const rows = await query<SnoozedRow>(
      `SELECT sm.uid, sm.account_id, sm.folder, sm.subject, sm.from_address, sm.from_name, sm.snooze_until
       FROM snoozed_messages sm
       WHERE sm.user_id = $1 AND sm.snooze_until > now() ${filter}
       ORDER BY sm.snooze_until ASC
       LIMIT 50`,
      params,
    )

    return NextResponse.json({
      data: rows.map(r => ({
        uid: r.uid,
        accountId: r.account_id,
        folder: r.folder,
        subject: r.subject ?? '',
        fromAddress: r.from_address,
        fromName: r.from_name,
        snoozeUntil: r.snooze_until,
      })),
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
