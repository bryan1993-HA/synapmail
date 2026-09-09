import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { query } from '@/lib/db'

export const dynamic = 'force-dynamic'

/**
 * Snooze / un-snooze a message. `params.id` is the IMAP UID.
 * Snoozed messages are hidden from the list (`/api/messages`) and the focus
 * heuristic until `snooze_until`; the scheduler drops the row once it passes.
 */

async function ownsAccount(accountId: string, userId?: string) {
  if (!accountId || !userId) return false
  const rows = await query<{ id: string }>(
    'SELECT id FROM email_accounts WHERE id = $1 AND user_id = $2 LIMIT 1',
    [accountId, userId],
  )
  return rows.length > 0
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await req.json()
    const { until, folder, accountId, subject, fromAddress, fromName } = body as {
      until?: string; folder?: string; accountId?: string
      subject?: string; fromAddress?: string; fromName?: string
    }

    if (!until || !folder || !accountId) {
      return NextResponse.json({ error: 'until, folder and accountId are required' }, { status: 400 })
    }
    const when = new Date(until)
    if (isNaN(when.getTime()) || when.getTime() <= Date.now()) {
      return NextResponse.json({ error: 'until must be a future date' }, { status: 400 })
    }
    if (!(await ownsAccount(accountId, session.user.id))) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 })
    }

    await query(
      `INSERT INTO snoozed_messages (user_id, account_id, folder, uid, subject, from_address, from_name, snooze_until)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (account_id, folder, uid)
       DO UPDATE SET snooze_until = EXCLUDED.snooze_until,
                     subject = EXCLUDED.subject,
                     from_address = EXCLUDED.from_address,
                     from_name = EXCLUDED.from_name`,
      [session.user.id, accountId, folder, params.id, subject ?? null, fromAddress ?? null, fromName ?? null, when.toISOString()],
    )

    return NextResponse.json({ success: true, until: when.toISOString() })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const accountId = searchParams.get('account')
  const folder = searchParams.get('folder') ?? 'INBOX'
  if (!accountId) return NextResponse.json({ error: 'account param required' }, { status: 400 })

  try {
    if (!(await ownsAccount(accountId, session.user.id))) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 })
    }
    await query(
      'DELETE FROM snoozed_messages WHERE account_id = $1 AND folder = $2 AND uid = $3',
      [accountId, folder, params.id],
    )
    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
