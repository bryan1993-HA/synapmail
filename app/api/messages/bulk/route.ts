import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { query } from '@/lib/db'
import { markReadBulk, deleteMessagesBulk, moveMessagesBulk } from '@/lib/imap'

export const dynamic = 'force-dynamic'

type AccountRow = {
  id: string; imap_host: string; imap_port: number; imap_secure: boolean;
  username: string; password_encrypted: string;
  oauth_provider: string | null; oauth_access_token: string | null;
  oauth_refresh_token: string | null; oauth_expires_at: number | null;
}

function accountConfig(a: AccountRow) {
  return {
    id: a.id,
    imapHost: a.imap_host,
    imapPort: a.imap_port,
    imapSecure: a.imap_secure,
    username: a.username,
    passwordEncrypted: a.password_encrypted,
    oauthProvider: a.oauth_provider,
    oauthAccessToken: a.oauth_access_token,
    oauthRefreshToken: a.oauth_refresh_token,
    oauthExpiresAt: a.oauth_expires_at,
  }
}

// PATCH — mark read/unread or move
export async function PATCH(req: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { uids, action, accountId, folder, destination } = body as {
    uids: string[]
    action: 'read' | 'unread' | 'move'
    accountId: string
    folder: string
    destination?: string
  }

  if (!uids?.length || !accountId || !folder || !action) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  try {
    const accounts = await query<AccountRow>(
      'SELECT * FROM email_accounts WHERE id = $1 AND user_id = $2 LIMIT 1',
      [accountId, session.user?.id]
    )
    if (!accounts.length) return NextResponse.json({ error: 'Account not found' }, { status: 404 })

    const config = accountConfig(accounts[0])

    if (action === 'read') {
      await markReadBulk(config, folder, uids, true)
    } else if (action === 'unread') {
      await markReadBulk(config, folder, uids, false)
    } else if (action === 'move') {
      if (!destination) return NextResponse.json({ error: 'destination required for move' }, { status: 400 })
      await moveMessagesBulk(config, folder, uids, destination)
    } else {
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// DELETE — delete multiple messages
export async function DELETE(req: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { uids, accountId, folder } = body as {
    uids: string[]
    accountId: string
    folder: string
  }

  if (!uids?.length || !accountId || !folder) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  try {
    const accounts = await query<AccountRow>(
      'SELECT * FROM email_accounts WHERE id = $1 AND user_id = $2 LIMIT 1',
      [accountId, session.user?.id]
    )
    if (!accounts.length) return NextResponse.json({ error: 'Account not found' }, { status: 404 })

    await deleteMessagesBulk(accountConfig(accounts[0]), folder, uids)
    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
