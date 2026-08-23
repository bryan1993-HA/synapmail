import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { query } from '@/lib/db'
import { listFolders } from '@/lib/imap'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const accountId = searchParams.get('account')

  try {
    const accounts = await query<{
      id: string; imap_host: string; imap_port: number; imap_secure: boolean;
      username: string; password_encrypted: string;
    }>(
      accountId
        ? 'SELECT * FROM email_accounts WHERE id = $1 AND user_id = $2 LIMIT 1'
        : 'SELECT * FROM email_accounts WHERE user_id = $1 AND is_default = true LIMIT 1',
      accountId ? [accountId, session.user?.id] : [session.user?.id]
    )

    if (!accounts.length) return NextResponse.json({ data: [] })

    const account = accounts[0]
    const folders = await listFolders({
      imapHost: account.imap_host,
      imapPort: account.imap_port,
      imapSecure: account.imap_secure,
      username: account.username,
      passwordEncrypted: account.password_encrypted,
    })

    return NextResponse.json({ data: folders })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
