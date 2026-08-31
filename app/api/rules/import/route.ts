import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { createRule } from '@/lib/rules'
import { query } from '@/lib/db'
import type { EmailRule } from '@/types/rule'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { searchParams } = new URL(req.url)
    const accountId = searchParams.get('account')
    if (!accountId) return NextResponse.json({ error: 'account param required' }, { status: 400 })

    // Verify account ownership
    const accounts = await query(
      'SELECT id FROM email_accounts WHERE id = $1 AND user_id = $2 LIMIT 1',
      [accountId, session.user!.id]
    )
    if (!accounts.length) return NextResponse.json({ error: 'Account not found' }, { status: 404 })

    const body = await req.json() as { rules?: Partial<EmailRule>[] }
    if (!Array.isArray(body.rules) || !body.rules.length) {
      return NextResponse.json({ error: 'No rules to import' }, { status: 400 })
    }

    // Get current max priority
    const maxRows = await query<{ max: number | null }>(
      'SELECT MAX(priority) as max FROM email_rules WHERE account_id = $1',
      [accountId]
    )
    let nextPriority = (maxRows[0]?.max ?? -1) + 1

    const created = []
    for (const r of body.rules) {
      if (!r.name?.trim() || !r.conditions?.length || !r.actions?.length) continue
      const rule = await createRule(session.user!.id!, accountId, {
        name: r.name.trim(),
        enabled: r.enabled ?? true,
        priority: nextPriority++,
        conditionLogic: r.conditionLogic ?? 'all',
        conditions: r.conditions,
        actions: r.actions,
        stopProcessing: r.stopProcessing ?? false,
      })
      created.push(rule)
    }

    return NextResponse.json({ data: { imported: created.length, rules: created } }, { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
