/**
 * Routes reachable WITHOUT a session — one list for the Edge middleware (which lets
 * them through) and for client code, which must not call an authenticated API from
 * one of these pages: the browser logs every 401 as a console error.
 */
export const PUBLIC_PATHS = [
  // `/api/branding`: the instance icon is read by the login page, hence before any session exists.
  '/login', '/register', '/invite', '/api/auth', '/api/register', '/api/invites', '/api/oauth',
  '/api/branding', '/_next', '/favicon',
] as const

export const isPublicPath = (pathname: string): boolean => PUBLIC_PATHS.some(p => pathname.startsWith(p))
