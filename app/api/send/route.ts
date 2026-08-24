import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { query } from '@/lib/db'
import { sendMail } from '@/lib/smtp'
import { getAttachmentContent } from '@/lib/imap'

type AccountRow = {
  id: string; email: string; smtp_host: string; smtp_port: number; smtp_secure: boolean;
  imap_host: string; imap_port: number; imap_secure: boolean;
  username: string; password_encrypted: string;
  oauth_provider: string | null; oauth_access_token: string | null;
  oauth_refresh_token: string | null; oauth_expires_at: number | null;
}

interface ForwardedAttachment {
  uid: string
  accountId: string
  folder: string
  partIdx: number
  filename: string
  contentType: string
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await req.json()
    const { accountId, from, to, cc, bcc, subject, html, text, inReplyTo, references, forwardedAttachments } = body as {
      accountId?: string
      from?: string
      to: string[]
      cc?: string[]
      bcc?: string[]
      subject: string
      html?: string
      text?: string
      inReplyTo?: string
      references?: string
      forwardedAttachments?: ForwardedAttachment[]
    }

    if (!to?.length || !subject) {
      return NextResponse.json({ error: 'Missing required fields (to, subject)' }, { status: 400 })
    }

    const accounts = await query<AccountRow>(
      accountId
        ? 'SELECT * FROM email_accounts WHERE id = $1 AND user_id = $2 LIMIT 1'
        : 'SELECT * FROM email_accounts WHERE user_id = $1 AND is_default = true LIMIT 1',
      accountId ? [accountId, session.user?.id] : [session.user?.id]
    )

    if (!accounts.length) return NextResponse.json({ error: 'No account found' }, { status: 404 })

    const account = accounts[0]

    // Resolve forwarded attachments from IMAP
    const attachments: Array<{ filename: string; content: Buffer; contentType: string }> = []
    if (forwardedAttachments?.length) {
      for (const att of forwardedAttachments) {
        // Find the IMAP account (may differ from SMTP account)
        const imapAccounts = await query<AccountRow>(
          'SELECT * FROM email_accounts WHERE id = $1 AND user_id = $2 LIMIT 1',
          [att.accountId, session.user?.id]
        )
        if (!imapAccounts.length) continue

        const imapAcc = imapAccounts[0]
        const content = await getAttachmentContent(
          {
            id: imapAcc.id,
            imapHost: imapAcc.imap_host,
            imapPort: imapAcc.imap_port,
            imapSecure: imapAcc.imap_secure,
            username: imapAcc.username,
            passwordEncrypted: imapAcc.password_encrypted,
            oauthProvider: imapAcc.oauth_provider,
            oauthAccessToken: imapAcc.oauth_access_token,
            oauthRefreshToken: imapAcc.oauth_refresh_token,
            oauthExpiresAt: imapAcc.oauth_expires_at,
          },
          att.folder,
          att.uid,
          att.partIdx
        )
        if (content) {
          attachments.push({
            filename: content.filename,
            content: content.content,
            contentType: content.contentType,
          })
        }
      }
    }

    await sendMail(
      {
        id: account.id,
        smtpHost: account.smtp_host,
        smtpPort: account.smtp_port,
        smtpSecure: account.smtp_secure,
        username: account.username,
        passwordEncrypted: account.password_encrypted,
        oauthProvider: account.oauth_provider,
        oauthAccessToken: account.oauth_access_token,
        oauthRefreshToken: account.oauth_refresh_token,
        oauthExpiresAt: account.oauth_expires_at,
      },
      { from: from ?? account.email, to, cc, bcc, subject, html, text, inReplyTo, references, attachments: attachments.length ? attachments : undefined }
    )

    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
