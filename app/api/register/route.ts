import { NextResponse } from 'next/server'
import { query, initDb } from '@/lib/db'
import bcrypt from 'bcryptjs'

export async function POST(req: Request) {
  if (process.env.REGISTRATION_ENABLED === 'false') {
    return NextResponse.json({ error: 'Registration is disabled' }, { status: 403 })
  }

  try {
    const { name, email, password } = await req.json()

    if (!name || !email || !password) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    if (password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
    }

    await initDb()

    const existing = await query('SELECT id FROM users WHERE email = $1', [email])
    if (existing.length) {
      return NextResponse.json({ error: 'Email already registered' }, { status: 409 })
    }

    const hash = await bcrypt.hash(password, 12)

    // First user gets admin role
    const count = await query<{ count: string }>('SELECT COUNT(*) as count FROM users')
    const isFirst = parseInt(count[0]?.count ?? '0') === 0

    const result = await query(
      'INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id, email, name, role',
      [name, email, hash, isFirst ? 'admin' : 'user']
    )

    return NextResponse.json({ data: result[0] }, { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
