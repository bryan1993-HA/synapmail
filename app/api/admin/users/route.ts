import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { query } from '@/lib/db'
import bcrypt from 'bcryptjs'
import { isAdmin } from '@/lib/requireAdmin'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await isAdmin(session))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const users = await query(
      'SELECT id, email, name, role, created_at AS "createdAt" FROM users ORDER BY created_at DESC'
    )
    return NextResponse.json({ data: users })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await isAdmin(session))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const body = await req.json()
    const { name, email, password, role = 'user' } = body

    if (!name || !email || !password) {
      return NextResponse.json({ error: 'name, email, password required' }, { status: 400 })
    }

    const hash = await bcrypt.hash(password, 10)
    const result = await query(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, name, role, created_at AS "createdAt"`,
      [name, email, hash, role]
    )

    return NextResponse.json({ data: result[0] }, { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
