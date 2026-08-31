import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { query } from '@/lib/db'

// DELETE — cancel a pending scheduled email
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const rows = await query<{ id: string }>(
      `DELETE FROM scheduled_emails
       WHERE id = $1 AND user_id = $2 AND status = 'pending'
       RETURNING id`,
      [params.id, session.user?.id]
    )

    if (!rows.length) {
      return NextResponse.json({ error: 'Not found or already sent' }, { status: 404 })
    }

    return NextResponse.json({ data: { id: rows[0].id } })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
