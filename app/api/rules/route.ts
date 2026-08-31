import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { getRulesForUser, createRule } from '@/lib/rules'
import type { EmailRule } from '@/types/rule'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const accountId = searchParams.get('account')

  try {
    const rules = await getRulesForUser(session.user!.id!)
    const filtered = accountId ? rules.filter(r => r.accountId === accountId) : rules
    return NextResponse.json({ data: filtered })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await req.json() as Partial<EmailRule> & { accountId: string }

    if (!body.accountId) return NextResponse.json({ error: 'accountId required' }, { status: 400 })
    if (!body.name?.trim()) return NextResponse.json({ error: 'name required' }, { status: 400 })
    if (!body.conditions?.length) return NextResponse.json({ error: 'At least one condition required' }, { status: 400 })
    if (!body.actions?.length) return NextResponse.json({ error: 'At least one action required' }, { status: 400 })

    // Verify account belongs to user
    const { query } = await import('@/lib/db')
    const accounts = await query(
      'SELECT id FROM email_accounts WHERE id = $1 AND user_id = $2 LIMIT 1',
      [body.accountId, session.user!.id]
    )
    if (!accounts.length) return NextResponse.json({ error: 'Account not found' }, { status: 404 })

    // Get max priority for this account
    const maxRows = await query<{ max: number | null }>(
      'SELECT MAX(priority) as max FROM email_rules WHERE account_id = $1',
      [body.accountId]
    )
    const nextPriority = (maxRows[0]?.max ?? -1) + 1

    const rule = await createRule(session.user!.id!, body.accountId, {
      name: body.name.trim(),
      enabled: body.enabled ?? true,
      priority: nextPriority,
      conditionLogic: body.conditionLogic ?? 'all',
      conditions: body.conditions ?? [],
      actions: body.actions ?? [],
      stopProcessing: body.stopProcessing ?? false,
    })

    return NextResponse.json({ data: rule }, { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
