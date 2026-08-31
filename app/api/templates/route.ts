import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { query } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const templates = await query(
      `SELECT id, user_id AS "userId", name, subject,
              content_html AS "contentHtml", created_at AS "createdAt"
       FROM compose_templates WHERE user_id = $1 ORDER BY name ASC`,
      [session.user?.id]
    )
    return NextResponse.json({ data: templates })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await req.json()
    const { name, subject = '', contentHtml = '' } = body

    if (!name?.trim()) return NextResponse.json({ error: 'Name is required' }, { status: 400 })

    const result = await query(
      `INSERT INTO compose_templates (user_id, name, subject, content_html)
       VALUES ($1, $2, $3, $4)
       RETURNING id, user_id AS "userId", name, subject,
                 content_html AS "contentHtml", created_at AS "createdAt"`,
      [session.user?.id, name.trim(), subject, contentHtml]
    )

    return NextResponse.json({ data: result[0] }, { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
