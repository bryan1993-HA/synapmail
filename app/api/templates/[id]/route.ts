import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { query } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await req.json()
    const { name, subject, contentHtml } = body

    const result = await query(
      `UPDATE compose_templates
       SET name = COALESCE($1, name),
           subject = COALESCE($2, subject),
           content_html = COALESCE($3, content_html)
       WHERE id = $4 AND user_id = $5
       RETURNING id, user_id AS "userId", name, subject,
                 content_html AS "contentHtml", created_at AS "createdAt"`,
      [name ?? null, subject ?? null, contentHtml ?? null, params.id, session.user?.id]
    )

    if (!result.length) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ data: result[0] })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    await query(
      'DELETE FROM compose_templates WHERE id = $1 AND user_id = $2',
      [params.id, session.user?.id]
    )
    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
