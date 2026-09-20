import { authenticate } from '@/lib/apiAuth'
import { query } from '@/lib/db'
import {
  callAI, buildMessages, isLoopbackUrl,
  AIAction, AIProvider, AISettings, LOCAL_PROVIDER,
} from '@/lib/ai'
import { NextRequest, NextResponse } from 'next/server'
import { promptGuardApplies } from '@/lib/accounts'

export async function POST(req: NextRequest) {
  const user = await authenticate(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as {
    action: AIAction
    content: string
    context?: string
    tone?: string
    targetLang?: string
    accountId?: string
  }

  const { action, content, context, tone, targetLang, accountId } = body

  if (!content?.trim()) return NextResponse.json({ error: 'Missing content' }, { status: 400 })

  const rows = await query<{
    provider: string
    api_key_encrypted: string | null
    base_url: string | null
    model: string
    system_prompt: string | null
  }>(
    `SELECT provider, api_key_encrypted, base_url, model, system_prompt
     FROM ai_settings WHERE user_id = $1`,
    [user.id]
  )

  if (!rows[0]) {
    return NextResponse.json({ error: 'AI not configured. Go to Settings → IA to configure.' }, { status: 400 })
  }

  const row = rows[0]
  const settings: AISettings = {
    provider: row.provider as AIProvider,
    apiKeyEncrypted: row.api_key_encrypted,
    baseUrl: row.base_url,
    model: row.model,
    systemPrompt: row.system_prompt,
  }

  // The mailbox the content belongs to decides — see lib/accounts.ts.
  const promptGuard = await promptGuardApplies(user.id, accountId)

  try {
    const messages = buildMessages(
      action,
      content,
      { tone, targetLang, context, promptGuard },
      settings.systemPrompt
    )

    // A model on the user's machine is unreachable from here by definition: the
    // server prepares everything (guard included) and the browser carries it.
    if (settings.provider === LOCAL_PROVIDER) {
      if (!isLoopbackUrl(settings.baseUrl)) {
        return NextResponse.json({ error: 'The local provider only accepts a loopback address' }, { status: 400 })
      }
      return NextResponse.json({
        data: { mode: LOCAL_PROVIDER, baseUrl: settings.baseUrl, model: settings.model, messages },
      })
    }

    // `callAI` rebuilds the system turn from the same `guardSystemPrompt`, so the
    // user turns are handed over as-is and both paths send identical messages.
    const userTurns = messages.filter(m => m.role !== 'system')
    const result = await callAI(settings, userTurns, { promptGuard })
    return NextResponse.json({ data: { result } })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'AI error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
