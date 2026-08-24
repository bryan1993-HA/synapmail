import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const PUBLIC_PATHS = ['/login', '/register', '/api/auth', '/api/register', '/api/oauth', '/_next', '/favicon']

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some(p => pathname.startsWith(p))
}

function getSessionCookie(req: NextRequest): string | undefined {
  return (
    req.cookies.get('__Secure-authjs.session-token')?.value ??
    req.cookies.get('authjs.session-token')?.value
  )
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // API routes: only block if no session and not public
  if (pathname.startsWith('/api/')) {
    if (!isPublic(pathname) && !getSessionCookie(req)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return NextResponse.next()
  }

  // Public pages: always allow
  if (isPublic(pathname)) {
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
