import { auth } from '@/lib/auth'
import createMiddleware from 'next-intl/middleware'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { routing } from '@/lib/routing'

const intlMiddleware = createMiddleware(routing)

const publicRoutes = ['/login', '/register', '/api/auth', '/api/register']

export default async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Allow public routes
  if (publicRoutes.some(r => pathname.startsWith(r))) {
    return intlMiddleware(req)
  }

  // Check auth for all other routes
  const session = await auth()
  if (!session && !pathname.startsWith('/api/')) {
    return NextResponse.redirect(new URL('/login', req.url))
  }
  if (!session && pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Admin routes
  if (pathname.startsWith('/admin') && (session?.user as { role?: string })?.role !== 'admin') {
    return NextResponse.redirect(new URL('/mail', req.url))
  }

  return intlMiddleware(req)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.png$|.*\\.svg$).*)'],
}
