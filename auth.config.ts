import type { NextAuthConfig } from 'next-auth'

// Edge-compatible auth config — no Node.js modules (no pg, no bcrypt)
// Used by middleware only
export const authConfig: NextAuthConfig = {
  trustHost: true,
  session: { strategy: 'jwt' },
  pages: {
    signIn: '/login',
  },
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user
      const { pathname } = nextUrl
      const publicRoutes = ['/login', '/register', '/api/auth', '/api/register']
      if (publicRoutes.some(r => pathname.startsWith(r))) return true
      if (!isLoggedIn) return false
      if (pathname.startsWith('/admin') && (auth.user as { role?: string })?.role !== 'admin') {
        return Response.redirect(new URL('/mail', nextUrl))
      }
      return true
    },
    async jwt({ token, user }) {
      if (user) token.role = (user as { role?: string }).role
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub!
        ;(session.user as { role?: string }).role = token.role as string
      }
      return session
    },
  },
  providers: [], // Providers added in lib/auth.ts (Node.js side only)
}
