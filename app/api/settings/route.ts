import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { query } from '@/lib/db'

export const dynamic = 'force-dynamic'

interface UserSettings {
  theme: string
  language: string
  messages_per_page: number
  thread_view: boolean
  reading_pane: boolean
  notifications: boolean
  undo_send_delay: number
}

const DEFAULTS: UserSettings = {
  theme: 'system',
  language: 'fr',
  messages_per_page: 30,
  thread_view: true,
  reading_pane: true,
  notifications: true,
  undo_send_delay: 10,
}

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const rows = await query<UserSettings>(
      `SELECT theme, language, messages_per_page, thread_view, reading_pane, notifications, undo_send_delay
       FROM user_settings WHERE user_id = $1`,
      [session.user.id]
    )
    return NextResponse.json({ data: rows[0] ?? DEFAULTS })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function PATCH(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await req.json() as Partial<UserSettings>

    const allowed: (keyof UserSettings)[] = [
      'theme', 'language', 'messages_per_page',
      'thread_view', 'reading_pane', 'notifications', 'undo_send_delay',
    ]

    const updates: Partial<UserSettings> = {}
    for (const key of allowed) {
      if (key in body) updates[key] = body[key] as never
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No valid fields' }, { status: 400 })
    }

    const cols = Object.keys(updates)
    const vals = Object.values(updates)
    const setClauses = cols.map((c, i) => `${c} = $${i + 2}`).join(', ')

    await query(
      `INSERT INTO user_settings (user_id, ${cols.join(', ')}, updated_at)
       VALUES ($1, ${cols.map((_, i) => `$${i + 2}`).join(', ')}, NOW())
       ON CONFLICT (user_id) DO UPDATE SET ${setClauses}, updated_at = NOW()`,
      [session.user.id, ...vals]
    )

    const rows = await query<UserSettings>(
      `SELECT theme, language, messages_per_page, thread_view, reading_pane, notifications, undo_send_delay
       FROM user_settings WHERE user_id = $1`,
      [session.user.id]
    )
    return NextResponse.json({ data: rows[0] ?? DEFAULTS })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
