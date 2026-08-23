import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { query } from '@/lib/db'
import { encrypt } from '@/lib/encrypt'

export const dynamic = 'force-dynamic'

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await req.json()
    const {
      name, email, imapHost, imapPort, imapSecure,
      smtpHost, smtpPort, smtpSecure, username, password,
      isDefault, color,
    } = body

    // Verify ownership
    const existing = await query(
      'SELECT id FROM email_accounts WHERE id = $1 AND user_id = $2',
      [params.id, session.user?.id]
    )
    if (!existing.length) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    if (isDefault) {
      await query(
        'UPDATE email_accounts SET is_default = false WHERE user_id = $1',
        [session.user?.id]
      )
    }

    const fields: string[] = []
    const values: unknown[] = []
    let idx = 1

    const set = (col: string, val: unknown) => {
      if (val !== undefined) {
        fields.push(`${col} = $${idx++}`)
        values.push(val)
      }
    }

    set('name', name)
    set('email', email)
    set('imap_host', imapHost)
    set('imap_port', imapPort)
    set('imap_secure', imapSecure)
    set('smtp_host', smtpHost)
    set('smtp_port', smtpPort)
    set('smtp_secure', smtpSecure)
    set('username', username)
    set('is_default', isDefault)
    set('color', color)
    if (password) {
      fields.push(`password_encrypted = $${idx++}`)
      values.push(encrypt(password))
    }

    if (!fields.length) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })

    values.push(params.id)
    const result = await query(
      `UPDATE email_accounts SET ${fields.join(', ')} WHERE id = $${idx} RETURNING id, name, email, is_default, color`,
      values
    )

    return NextResponse.json({ data: result[0] })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const result = await query(
      'DELETE FROM email_accounts WHERE id = $1 AND user_id = $2 RETURNING id',
      [params.id, session.user?.id]
    )
    if (!result.length) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
