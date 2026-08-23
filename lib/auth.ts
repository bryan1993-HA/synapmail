import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import { query } from './db'
import bcrypt from 'bcryptjs'

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  session: { strategy: 'jwt' },
  pages: {
    signIn: '/login',
  },
  providers: [
    Credentials({
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null
        const users = await query<{
          id: string; email: string; name: string;
          password_hash: string; role: string; avatar_url: string
        }>('SELECT * FROM users WHERE email = $1 LIMIT 1', [credentials.email as string])
        if (!users.length) return null
        const user = users[0]
        const valid = await bcrypt.compare(credentials.password as string, user.password_hash)
        if (!valid) return null
        return { id: user.id, email: user.email, name: user.name, role: user.role, image: user.avatar_url }
      },
    }),
  ],
  callbacks: {
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
})
