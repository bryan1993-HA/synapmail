import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { getMicrosoftAuthUrl } from '@/lib/msOAuth'
import { cookies } from 'next/headers'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const state = crypto.randomBytes(16).toString('hex')

  // Store state in cookie (10min TTL) to prevent CSRF
  const cookieStore = cookies()
  cookieStore.set('ms_oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600,
    path: '/',
  })

  const url = getMicrosoftAuthUrl(state)
  return NextResponse.redirect(url)
}
