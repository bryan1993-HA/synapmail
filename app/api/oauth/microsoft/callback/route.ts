import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { exchangeCode } from '@/lib/msOAuth'
import { query } from '@/lib/db'
import { cookies } from 'next/headers'
import { encrypt } from '@/lib/encrypt'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.redirect(new URL('/login', req.url))

  const { searchParams } = req.nextUrl
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const error = searchParams.get('error')

  if (error) {
    return NextResponse.redirect(new URL(`/settings/accounts?error=${encodeURIComponent(error)}`, req.url))
  }

  // Validate CSRF state
  const cookieStore = cookies()
  const savedState = cookieStore.get('ms_oauth_state')?.value
  cookieStore.delete('ms_oauth_state')

  if (!state || state !== savedState) {
    return NextResponse.redirect(new URL('/settings/accounts?error=invalid_state', req.url))
  }

  if (!code) {
    return NextResponse.redirect(new URL('/settings/accounts?error=no_code', req.url))
  }

  try {
    const { accessToken, refreshToken, expiresAt, email } = await exchangeCode(code)

    const accountEmail = email || session.user?.email || ''
    const username = accountEmail

    // Check if an account with this email already exists for this user
    const existing = await query(
      `SELECT id FROM email_accounts WHERE user_id = $1 AND email = $2`,
      [session.user?.id, accountEmail]
    )

    if (existing.length > 0) {
      // Update tokens on existing account
      await query(
        `UPDATE email_accounts SET
           oauth_access_token = $1, oauth_refresh_token = $2, oauth_expires_at = $3,
           oauth_provider = 'microsoft'
         WHERE id = $4`,
        [accessToken, refreshToken, expiresAt, (existing[0] as { id: string }).id]
      )
    } else {
      // Create new account with Microsoft OAuth
      // Use a dummy encrypted password (won't be used for OAuth auth)
      const dummyPassword = encrypt('oauth-not-used')
      await query(
        `INSERT INTO email_accounts
           (user_id, name, email, imap_host, imap_port, imap_secure,
            smtp_host, smtp_port, smtp_secure, username, password_encrypted,
            oauth_provider, oauth_access_token, oauth_refresh_token, oauth_expires_at,
            is_default, color)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
        [
          session.user?.id,
          'Live / Outlook',
          accountEmail,
          'outlook.office365.com', 993, true,
          'smtp-mail.outlook.com', 587, false,
          username, dummyPassword,
          'microsoft', accessToken, refreshToken, expiresAt,
          false, '#0078d4',
        ]
      )
    }

    return NextResponse.redirect(new URL('/settings/accounts?success=microsoft', req.url))
  } catch (err) {
    console.error('Microsoft OAuth callback error:', err)
    return NextResponse.redirect(
      new URL(`/settings/accounts?error=${encodeURIComponent(String(err))}`, req.url)
    )
  }
}
