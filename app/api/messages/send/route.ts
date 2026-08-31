import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { query } from '@/lib/db'
import { sendMail } from '@/lib/smtp'
import { upsertContactsFromAddresses } from '@/lib/contacts'
import { randomUUID } from 'crypto'

export const dynamic = 'force-dynamic'

function injectTrackingPixel(html: string, pixelUrl: string): string {
  const pixel = `<img src="${pixelUrl}" width="1" height="1" style="display:none;border:0;width:1px;height:1px;" alt="" />`
  // Insert before </body> if present, otherwise append
  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${pixel}</body>`)
  }
  return html + pixel
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await req.json()
    const { accountId, to, cc, bcc, subject, html, text, inReplyTo, references, requestReadReceipt } = body

    if (!accountId || !to || !subject) {
      return NextResponse.json({ error: 'accountId, to, and subject are required' }, { status: 400 })
    }

    const accounts = await query<{
      id: string; email: string;
      smtp_host: string; smtp_port: number; smtp_secure: boolean;
      username: string; password_encrypted: string;
      oauth_provider: string | null; oauth_access_token: string | null;
      oauth_refresh_token: string | null; oauth_expires_at: number | null;
    }>(
      'SELECT * FROM email_accounts WHERE id = $1 AND user_id = $2 LIMIT 1',
      [accountId, session.user?.id]
    )

    if (!accounts.length) return NextResponse.json({ error: 'Account not found' }, { status: 404 })

    const account = accounts[0]

    const toArr = Array.isArray(to) ? to : [to]
    const ccArr = cc ? (Array.isArray(cc) ? cc : [cc]) : []

    // Tracking — pixel + MDN header — only when explicitly requested
    let token: string | null = null
    let trackedHtml = html
    if (requestReadReceipt && html) {
      token = randomUUID()
      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
      trackedHtml = injectTrackingPixel(html, `${appUrl}/api/track/${token}`)
    }

    const { messageId } = await sendMail(
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
      {
        from: account.email,
        to: toArr,
        cc: ccArr.length ? ccArr : undefined,
        bcc: bcc ? (Array.isArray(bcc) ? bcc : [bcc]) : undefined,
        subject,
        html: trackedHtml,
        text,
        inReplyTo,
        references,
        dispositionNotificationTo: requestReadReceipt ? account.email : undefined,
      }
    )

    // Store tracking record — fire-and-forget
    const userId = session.user?.id
    if (requestReadReceipt && token) {
      query(
        `INSERT INTO sent_tracking (token, message_id, account_id, user_id, sent_to, subject)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (token) DO NOTHING`,
        [token, messageId, accountId, userId, toArr.concat(ccArr).join(', '), subject]
      ).catch(() => {})
    }

    // Fire-and-forget: extract recipients as sent contacts
    if (userId) {
      upsertContactsFromAddresses(userId, [...toArr, ...ccArr], 'sent').catch(() => {})
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
