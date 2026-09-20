import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { isPublicPath } from '@/lib/publicPaths'

function getSessionCookie(req: NextRequest): string | undefined {
  return (
    req.cookies.get('__Secure-authjs.session-token')?.value ??
    req.cookies.get('authjs.session-token')?.value
  )
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // API routes: only block if no session, no bearer token, and not public.
  // The bearer token itself is validated in the route handler via lib/apiAuth.ts —
  // this Edge middleware can't query Postgres, it only checks the header is present.
  if (pathname.startsWith('/api/')) {
    const hasBearer = req.headers.get('authorization')?.startsWith('Bearer ') ?? false
    if (!isPublicPath(pathname) && !getSessionCookie(req) && !hasBearer) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return NextResponse.next()
  }

  // Public pages: always allow
  if (isPublicPath(pathname)) {
    return NextResponse.next()
  }

  // Protected pages: check session cookie
  if (!getSessionCookie(req)) {
    const loginUrl = new URL('/login', req.url)
    loginUrl.searchParams.set('callbackUrl', pathname)
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.png$|.*\\.svg$|.*\\.woff$|.*\\.woff2$).*)'],
}
