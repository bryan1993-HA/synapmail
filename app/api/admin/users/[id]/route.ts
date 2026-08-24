import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { query } from '@/lib/db'

export const dynamic = 'force-dynamic'

async function requireAdmin(session: { user?: { id?: string } } | null) {
  if (!session?.user?.id) return false
  const rows = await query<{ role: string }>(
    'SELECT role FROM users WHERE id = $1',
    [session.user.id]
  )
  return rows[0]?.role === 'admin'
}

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await requireAdmin(session))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const body = await req.json()
    const { role } = body

    if (!role || !['admin', 'user'].includes(role)) {
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
    }

    const result = await query(
      `UPDATE users SET role = $1 WHERE id = $2
       RETURNING id, email, name, role, created_at AS "createdAt"`,
      [role, params.id]
    )

    if (!result.length) return NextResponse.json({ error: 'User not found' }, { status: 404 })
    return NextResponse.json({ data: result[0] })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: { id: string } }
) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await requireAdmin(session))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  if (params.id === session.user?.id) {
    return NextResponse.json({ error: 'Cannot delete your own account' }, { status: 400 })
  }

  try {
    await query('DELETE FROM users WHERE id = $1', [params.id])
    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
