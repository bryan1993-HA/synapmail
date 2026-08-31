import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { getRulesForUser } from '@/lib/rules'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const rules = await getRulesForUser(session.user!.id!)
    const exportData = {
      version: 1,
      exportedAt: new Date().toISOString(),
      rules: rules.map(r => ({
        name: r.name,
        enabled: r.enabled,
        conditionLogic: r.conditionLogic,
        conditions: r.conditions,
        actions: r.actions,
        stopProcessing: r.stopProcessing,
      })),
    }

    return new Response(JSON.stringify(exportData, null, 2), {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="synapmail-rules-${new Date().toISOString().slice(0, 10)}.json"`,
      },
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
