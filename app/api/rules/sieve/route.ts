import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { getRulesForUser, generateSieveScript } from '@/lib/rules'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { searchParams } = new URL(req.url)
    const accountId = searchParams.get('account')

    const rules = await getRulesForUser(session.user!.id!)
    const filtered = accountId ? rules.filter(r => r.accountId === accountId) : rules
    const script = generateSieveScript(filtered)

    return new Response(script, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="synapmail-${new Date().toISOString().slice(0, 10)}.sieve"`,
      },
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
