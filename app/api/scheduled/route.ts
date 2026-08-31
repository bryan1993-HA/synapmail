import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { query } from '@/lib/db'

type ScheduledEmailRow = {
  id: string
  account_id: string
  to_addresses: string
  cc_addresses: string | null
  bcc_addresses: string | null
  subject: string
  send_at: string
  status: string
  created_at: string
}

// GET — list pending scheduled emails for current user
export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const rows = await query<ScheduledEmailRow>(
      `SELECT id, account_id, to_addresses, cc_addresses, bcc_addresses, subject, send_at, status, created_at
       FROM scheduled_emails
       WHERE user_id = $1 AND status = 'pending'
       ORDER BY send_at ASC`,
      [session.user?.id]
    )
    return NextResponse.json({ data: rows })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

interface ForwardedAttachment {
  uid: string
  accountId: string
  folder: string
  partIdx: number
  filename: string
  contentType: string
}

// POST — schedule an email
export async function POST(req: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await req.json()
    const { accountId, to, cc, bcc, subject, html, inReplyTo, forwardedAttachments, sendAt } = body as {
      accountId?: string
      to: string[]
      cc?: string[]
      bcc?: string[]
      subject: string
      html?: string
      inReplyTo?: string
      forwardedAttachments?: ForwardedAttachment[]
      sendAt: string
    }

    if (!to?.length || !subject || !sendAt) {
      return NextResponse.json({ error: 'Missing required fields (to, subject, sendAt)' }, { status: 400 })
    }

    const sendAtDate = new Date(sendAt)
    if (isNaN(sendAtDate.getTime()) || sendAtDate <= new Date()) {
      return NextResponse.json({ error: 'sendAt must be a future date' }, { status: 400 })
    }

    // Resolve account
    const accounts = await query<{ id: string }>(
      accountId
        ? 'SELECT id FROM email_accounts WHERE id = $1 AND user_id = $2 LIMIT 1'
        : 'SELECT id FROM email_accounts WHERE user_id = $1 AND is_default = true LIMIT 1',
      accountId ? [accountId, session.user?.id] : [session.user?.id]
    )
    if (!accounts.length) {
      return NextResponse.json({ error: 'No account found' }, { status: 404 })
    }

    const resolvedAccountId = accountId ?? accounts[0].id

    const rows = await query<{ id: string }>(
      `INSERT INTO scheduled_emails
         (user_id, account_id, to_addresses, cc_addresses, bcc_addresses, subject, html, in_reply_to, forwarded_attachments, send_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id`,
      [
        session.user?.id,
        resolvedAccountId,
        JSON.stringify(to),
        cc?.length ? JSON.stringify(cc) : null,
        bcc?.length ? JSON.stringify(bcc) : null,
        subject,
        html ?? null,
        inReplyTo ?? null,
        forwardedAttachments?.length ? JSON.stringify(forwardedAttachments) : null,
        sendAtDate.toISOString(),
      ]
    )

    return NextResponse.json({ data: { id: rows[0].id } })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
