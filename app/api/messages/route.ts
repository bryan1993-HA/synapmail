import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { query } from '@/lib/db'
import { listMessages } from '@/lib/imap'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const folder = searchParams.get('folder') ?? 'INBOX'
  const page = parseInt(searchParams.get('page') ?? '1')
  const perPage = parseInt(searchParams.get('perPage') ?? '30')
  const filter = (searchParams.get('filter') ?? 'all') as 'all' | 'unread' | 'starred'

  try {
    const accounts = await query<{
      id: string; imap_host: string; imap_port: number; imap_secure: boolean;
      username: string; password_encrypted: string;
    }>(
      'SELECT * FROM email_accounts WHERE user_id = $1 AND is_default = true LIMIT 1',
      [session.user?.id]
    )

    if (!accounts.length) {
      return NextResponse.json({ messages: [], total: 0, error: 'No account configured' })
    }

    const account = accounts[0]
    const result = await listMessages(
      {
        imapHost: account.imap_host,
        imapPort: account.imap_port,
        imapSecure: account.imap_secure,
        username: account.username,
        passwordEncrypted: account.password_encrypted,
      },
      folder,
      page,
      perPage,
      filter
    )

    result.messages = result.messages.map(m => ({ ...m, accountId: account.id }))

    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json({ error: String(err), messages: [], total: 0 }, { status: 500 })
  }
}
