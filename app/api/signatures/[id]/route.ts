import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { query } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await req.json()
    const { name, contentHtml, isDefault, accountId } = body

    if (isDefault) {
      await query(
        'UPDATE signatures SET is_default = false WHERE user_id = $1',
        [session.user?.id]
      )
    }

    const result = await query(
      `UPDATE signatures
       SET name = COALESCE($1, name),
           content_html = COALESCE($2, content_html),
           is_default = COALESCE($3, is_default),
           account_id = COALESCE($4, account_id)
       WHERE id = $5 AND user_id = $6
       RETURNING id, user_id AS "userId", account_id AS "accountId", name,
                 content_html AS "contentHtml", is_default AS "isDefault"`,
      [name ?? null, contentHtml ?? null, isDefault ?? null, accountId ?? null, params.id, session.user?.id]
    )

    if (!result.length) return NextResponse.json({ error: 'Not found' }, { status: 404 })
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

  try {
    await query(
      'DELETE FROM signatures WHERE id = $1 AND user_id = $2',
      [params.id, session.user?.id]
    )
    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
