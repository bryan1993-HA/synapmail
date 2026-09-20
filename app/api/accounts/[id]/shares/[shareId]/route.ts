import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { query } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string; shareId: string } }
) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    // Two people may end a share: the OWNER of the account (revoking the access
    // they granted) and the RECIPIENT (giving back an inbox they no longer want).
    // Both write the same row the same way, so they share this one route rather
    // than a second endpoint with its own drift.
    const allowed = await query<{ id: string }>(
      `SELECT sh.id
         FROM account_shares sh
         JOIN email_accounts a ON a.id = sh.account_id
        WHERE sh.id = $1 AND sh.account_id = $2
          AND (a.user_id = $3 OR sh.invitee_user_id = $3)
        LIMIT 1`,
      [params.shareId, params.id, session.user.id]
    )
    if (!allowed.length) return NextResponse.json({ error: 'Share not found' }, { status: 404 })

    await query(
      `UPDATE account_shares SET status = 'revoked', revoked_at = NOW() WHERE id = $1 AND account_id = $2`,
      [params.shareId, params.id]
    )
    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
