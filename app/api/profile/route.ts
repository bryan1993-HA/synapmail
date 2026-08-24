import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { query } from '@/lib/db'
import bcrypt from 'bcryptjs'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const rows = await query<{ id: string; name: string; email: string; role: string; avatar_url: string | null }>(
      'SELECT id, name, email, role, avatar_url FROM users WHERE id = $1',
      [session.user.id]
    )
    if (!rows[0]) return NextResponse.json({ error: 'User not found' }, { status: 404 })
    return NextResponse.json({ data: rows[0] })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function PATCH(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await req.json()
    const { name, currentPassword, newPassword } = body

    if (newPassword) {
      // Verify current password before changing
      const rows = await query<{ password_hash: string }>(
        'SELECT password_hash FROM users WHERE id = $1',
        [session.user.id]
      )
      if (!rows[0]) return NextResponse.json({ error: 'User not found' }, { status: 404 })

      const valid = await bcrypt.compare(currentPassword ?? '', rows[0].password_hash)
      if (!valid) return NextResponse.json({ error: 'Mot de passe actuel incorrect' }, { status: 400 })

      const hash = await bcrypt.hash(newPassword, 10)
      await query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, session.user.id])
    }

    if (name !== undefined) {
      await query('UPDATE users SET name = $1 WHERE id = $2', [name.trim(), session.user.id])
    }

    const updated = await query<{ id: string; name: string; email: string; role: string }>(
      'SELECT id, name, email, role FROM users WHERE id = $1',
      [session.user.id]
    )
    return NextResponse.json({ data: updated[0] })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
