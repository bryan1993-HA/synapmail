import { auth } from '@/lib/auth'
import { query } from '@/lib/db'
import { callAI, AIProvider, AISettings } from '@/lib/ai'
import { NextRequest, NextResponse } from 'next/server'

type AIAction = 'summarize' | 'reply' | 'improve' | 'tone' | 'translate'

function buildPrompt(action: AIAction, content: string, options: { tone?: string; targetLang?: string; context?: string }): string {
  const plain = content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

  switch (action) {
    case 'summarize':
      return `Résume cet email en 3 points clés maximum. Utilise des bullet points (• ). Sois très concis.\n\nEmail :\n${plain}`

    case 'reply':
      return `Rédige une réponse professionnelle et courtoise à cet email${options.context ? ` (contexte : ${options.context})` : ''}. Donne uniquement le corps de la réponse, sans "Bonjour" ni formule de clôture.\n\nEmail original :\n${plain}`

    case 'improve':
      return `Améliore cet email : corrige les fautes, améliore le style et la clarté. Réponds uniquement avec le texte amélioré, sans explication.\n\nEmail :\n${plain}`

    case 'tone':
      const toneMap: Record<string, string> = {
        formal: 'formel et professionnel',
        casual: 'décontracté et amical',
        assertive: 'assertif et direct',
        concise: 'très concis (supprime tout ce qui est superflu)',
        empathetic: 'empathique et bienveillant',
      }
      const toneLabel = toneMap[options.tone ?? 'formal'] ?? 'formel et professionnel'
      return `Réécris cet email dans un ton ${toneLabel}. Réponds uniquement avec le texte réécrit.\n\nEmail :\n${plain}`

    case 'translate':
      if (options.targetLang === 'en') {
        return `Translate this email to English. Reply only with the translated text.\n\nEmail:\n${plain}`
      }
      return `Traduis cet email en français. Réponds uniquement avec le texte traduit.\n\nEmail :\n${plain}`

    default:
      throw new Error(`Unknown action: ${action}`)
  }
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as {
    action: AIAction
    content: string
    context?: string
    tone?: string
    targetLang?: string
  }

  const { action, content, context, tone, targetLang } = body

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
    [session.user.id]
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

  try {
    const prompt = buildPrompt(action, content, { tone, targetLang, context })
    const result = await callAI(settings, [{ role: 'user', content: prompt }])
    return NextResponse.json({ data: { result } })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'AI error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
