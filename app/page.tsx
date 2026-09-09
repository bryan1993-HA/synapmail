import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { query } from '@/lib/db'

export const dynamic = 'force-dynamic'

export default async function RootPage() {
  let target = '/mail'

  const session = await auth()
  if (session?.user?.id) {
    try {
      const rows = await query<{ start_view: string }>(
        'SELECT start_view FROM user_settings WHERE user_id = $1',
        [session.user.id]
      )
      if (rows[0]?.start_view === 'dashboard') target = '/dashboard'
    } catch {
      // fall back to /mail
    }
  }

  redirect(target)
}
