import { auth } from '@/lib/auth'
import { query } from '@/lib/db'
import { createClient } from '@/lib/imap'
import { simpleParser } from 'mailparser'

export const dynamic = 'force-dynamic'

type AccountRow = {
  id: string; imap_host: string; imap_port: number; imap_secure: boolean;
  username: string; password_encrypted: string;
  oauth_provider: string | null; oauth_access_token: string | null;
  oauth_refresh_token: string | null; oauth_expires_at: number | null;
}

export async function GET(
  req: Request,
  { params }: { params: { id: string; partId: string } }
) {
  const session = await auth()
  if (!session) return new Response('Unauthorized', { status: 401 })

  const { searchParams } = new URL(req.url)
  const accountId = searchParams.get('account')
  const folder = searchParams.get('folder') ?? 'INBOX'
  const partIdx = parseInt(params.partId)

  if (!accountId) return new Response('account param required', { status: 400 })

  try {
    const accounts = await query<AccountRow>(
      'SELECT * FROM email_accounts WHERE id = $1 AND user_id = $2 LIMIT 1',
      [accountId, session.user?.id]
    )
    if (!accounts.length) return new Response('Account not found', { status: 404 })

    const account = accounts[0]
    const imapClient = await createClient({
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
    })

    try {
      await imapClient.mailboxOpen(folder)
      const msg = await imapClient.fetchOne(params.id, { source: true }, { uid: true })
      if (!msg) return new Response('Message not found', { status: 404 })

      const parsed = await simpleParser(msg.source ?? Buffer.alloc(0))
      const attachment = parsed.attachments?.[partIdx]

      if (!attachment) return new Response('Attachment not found', { status: 404 })

      const filename = attachment.filename ?? `attachment-${partIdx}`
      const contentType = attachment.contentType ?? 'application/octet-stream'

      return new Response(attachment.content.buffer as ArrayBuffer, {
        headers: {
          'Content-Type': contentType,
          'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
          'Content-Length': String(attachment.content.length),
        },
      })
    } finally {
      await imapClient.logout()
    }
  } catch (err) {
    return new Response(String(err), { status: 500 })
  }
}
