/**
 * The admin guard, in ONE single place: the role lives in the database (`users.role`)
 * and not in the session, so every protected route must re-read it. Extracted from
 * `app/api/admin/users/route.ts` when a second administration area appeared, so that
 * both refuse in exactly the same way.
 */
import { query } from '@/lib/db'

type SessionLike = { user?: { id?: string } } | null

export async function isAdmin(session: SessionLike): Promise<boolean> {
  if (!session?.user?.id) return false
  const rows = await query<{ role: string }>('SELECT role FROM users WHERE id = $1', [session.user.id])
  return rows[0]?.role === 'admin'
}
