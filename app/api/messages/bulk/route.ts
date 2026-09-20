import { NextResponse } from 'next/server'
import { authenticate } from '@/lib/apiAuth'
import { getAccessibleAccount } from '@/lib/accountAccess'
import { markReadBulk, deleteMessagesBulk, moveMessagesBulk, setFlagBulk } from '@/lib/imap'
import { flagByKey } from '@/lib/flags'

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
  const authCtx = await authenticate(req)
  if (!authCtx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { uids, action, accountId, folder, destination, flag } = body as {
    uids: string[]
    action: 'read' | 'unread' | 'move' | 'flag'
    accountId: string
    folder: string
    destination?: string
    /** A colour from lib/flags.ts, or `null` to clear the flag. */
    flag?: string | null
  }

  if (!uids?.length || !accountId || !folder || !action) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  try {
    const account = await getAccessibleAccount(accountId, authCtx.id, ['organize'])
    if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 })

    const config = accountConfig(account)

    if (action === 'read') {
      await markReadBulk(config, folder, uids, true)
    } else if (action === 'unread') {
      await markReadBulk(config, folder, uids, false)
    } else if (action === 'flag') {
      if (flag === undefined) return NextResponse.json({ error: 'flag required for flag' }, { status: 400 })
      if (flag !== null && !flagByKey(flag)) return NextResponse.json({ error: 'Unknown flag' }, { status: 400 })
      await setFlagBulk(config, folder, uids, flag)
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
  const authCtx = await authenticate(req)
  if (!authCtx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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
    const account = await getAccessibleAccount(accountId, authCtx.id, ['delete'])
    if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 })

    await deleteMessagesBulk(accountConfig(account), folder, uids)
    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
