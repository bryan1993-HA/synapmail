import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { query } from '@/lib/db'

export const dynamic = 'force-dynamic'

// PATCH /api/contacts/[id] — update name, notes, isStarred
export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as { name?: string; notes?: string; isStarred?: boolean }
  const { name, notes, isStarred } = body

  const sets: string[] = ['updated_at = NOW()']
  const values: unknown[] = [params.id, session.user?.id]
  let i = 3

  if (name !== undefined) {
    if (!name.trim()) return NextResponse.json({ error: 'name cannot be empty' }, { status: 400 })
    sets.push(`name = $${i++}`)
    values.push(name.trim())
  }
  if (notes !== undefined) { sets.push(`notes = $${i++}`); values.push(notes) }
  if (isStarred !== undefined) { sets.push(`is_starred = $${i++}`); values.push(isStarred) }

  await query(
    `UPDATE contacts SET ${sets.join(', ')} WHERE id = $1 AND user_id = $2`,
    values
  )

  return NextResponse.json({ success: true })
}

// DELETE /api/contacts/[id]
export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await query(
    'DELETE FROM contacts WHERE id = $1 AND user_id = $2',
    [params.id, session.user?.id]
  )

  return NextResponse.json({ success: true })
}
