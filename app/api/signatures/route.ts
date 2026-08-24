import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { query } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const signatures = await query(
      `SELECT id, user_id AS "userId", account_id AS "accountId", name,
              content_html AS "contentHtml", is_default AS "isDefault"
       FROM signatures WHERE user_id = $1 ORDER BY is_default DESC, name ASC`,
      [session.user?.id]
    )
    return NextResponse.json({ data: signatures })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await req.json()
    const { name, contentHtml, isDefault = false, accountId = null } = body

    if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 })

    if (isDefault) {
      await query(
        'UPDATE signatures SET is_default = false WHERE user_id = $1',
        [session.user?.id]
      )
    }

    const result = await query(
      `INSERT INTO signatures (user_id, account_id, name, content_html, is_default)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, user_id AS "userId", account_id AS "accountId", name,
                 content_html AS "contentHtml", is_default AS "isDefault"`,
      [session.user?.id, accountId, name, contentHtml ?? '', isDefault]
    )

    return NextResponse.json({ data: result[0] }, { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
