import { NextResponse } from 'next/server'
import { authenticate } from '@/lib/apiAuth'
import { getAccessibleAccount } from '@/lib/accountAccess'
import { DEFAULT_FLAG_KEY, flagByKey } from '@/lib/flags'
import { getMessage, deleteMessage, markRead, setFlagBulk } from '@/lib/imap'
import { guardApiPayload, isMachineRequest } from '@/lib/promptGuard'

export const dynamic = 'force-dynamic'

type AccountRow = {
  id: string; imap_host: string; imap_port: number; imap_secure: boolean;
  username: string; password_encrypted: string; prompt_guard: boolean;
  oauth_provider: string | null; oauth_access_token: string | null;
  oauth_refresh_token: string | null; oauth_expires_at: number | null;
}

function accountConfig(account: AccountRow) {
  return {
    id: account.id,
    imapHost: account.imap_host,
    imapPort: account.imap_port,
    imapSecure: account.imap_secure,
    username: account.username,
    passwordEncrypted: account.password_encrypted,
    oauthProvider: account.oauth_provider,
    oauthAccessToken: account.oauth_access_token,
    oauthRefreshToken: account.oauth_refresh_token,
    oauthExpiresAt: account.oauth_expires_at,
  }
}

export async function GET(
  req: Request,
  { params }: { params: { id: string } }
) {
  const authCtx = await authenticate(req)
  if (!authCtx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const accountId = searchParams.get('account')
  const folder = searchParams.get('folder') ?? 'INBOX'

  if (!accountId) return NextResponse.json({ error: 'account param required' }, { status: 400 })

  try {
    const account = await getAccessibleAccount(accountId, authCtx.id, [])
    if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 })

    const message = await getMessage(accountConfig(account), folder, params.id)
    if (!message) return NextResponse.json({ error: 'Message not found' }, { status: 404 })

    return NextResponse.json(guardApiPayload({ ...message, accountId }, {
      enabled: isMachineRequest(req) && account.prompt_guard,
    }))
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  const authCtx = await authenticate(req)
  if (!authCtx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const accountId = searchParams.get('account')
  const folder = searchParams.get('folder') ?? 'INBOX'

  if (!accountId) return NextResponse.json({ error: 'account param required' }, { status: 400 })

  try {
    const body = await req.json()
    // `flag` carries the colour (lib/flags.ts); `isStarred` is still accepted and maps
    // to the default colour, so existing callers keep working.
    const { isRead, isStarred, flag } = body as
      { isRead?: boolean; isStarred?: boolean; flag?: string | null }

    const account = await getAccessibleAccount(accountId, authCtx.id, ['organize'])
    if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 })

    const config = accountConfig(account)

    if (isRead !== undefined) {
      await markRead(config, folder, params.id, isRead)
    }
    if (flag !== undefined) {
      if (flag !== null && !flagByKey(flag)) {
        return NextResponse.json({ error: 'Unknown flag' }, { status: 400 })
      }
      await setFlagBulk(config, folder, [params.id], flag)
    } else if (isStarred !== undefined) {
      await setFlagBulk(config, folder, [params.id], isStarred ? DEFAULT_FLAG_KEY : null)
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: { id: string } }
) {
  const authCtx = await authenticate(req)
  if (!authCtx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const accountId = searchParams.get('account')
  const folder = searchParams.get('folder') ?? 'INBOX'

  if (!accountId) return NextResponse.json({ error: 'account param required' }, { status: 400 })

  try {
    const account = await getAccessibleAccount(accountId, authCtx.id, ['delete'])
    if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 })

    await deleteMessage(accountConfig(account), folder, params.id)
    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
