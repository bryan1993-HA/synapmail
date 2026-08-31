import { auth } from '@/lib/auth'
import { query } from '@/lib/db'
import { encrypt } from '@/lib/encrypt'
import { NextRequest, NextResponse } from 'next/server'

interface AISettingsRow {
  provider: string
  api_key_encrypted: string | null
  base_url: string | null
  model: string
  system_prompt: string | null
  feature_summarize: boolean
  feature_reply_draft: boolean
  feature_improve: boolean
  feature_translate: boolean
}

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rows = await query<AISettingsRow>(
    `SELECT provider, api_key_encrypted, base_url, model, system_prompt,
            feature_summarize, feature_reply_draft, feature_improve, feature_translate
     FROM ai_settings WHERE user_id = $1`,
    [session.user.id]
  )

  const row = rows[0]

  return NextResponse.json({
    data: {
      provider: row?.provider ?? 'ollama',
      hasApiKey: !!row?.api_key_encrypted,
      baseUrl: row?.base_url ?? 'http://localhost:11434',
      model: row?.model ?? 'llama3',
      systemPrompt: row?.system_prompt ?? '',
      featureSummarize: row?.feature_summarize ?? true,
      featureReplyDraft: row?.feature_reply_draft ?? true,
      featureImprove: row?.feature_improve ?? true,
      featureTranslate: row?.feature_translate ?? true,
      configured: !!row,
    },
  })
}

export async function PATCH(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as {
    provider?: string
    apiKey?: string
    baseUrl?: string
    model?: string
    systemPrompt?: string
    featureSummarize?: boolean
    featureReplyDraft?: boolean
    featureImprove?: boolean
    featureTranslate?: boolean
  }

  const {
    provider = 'ollama',
    apiKey,
    baseUrl,
    model = 'llama3',
    systemPrompt,
    featureSummarize = true,
    featureReplyDraft = true,
    featureImprove = true,
    featureTranslate = true,
  } = body

  const apiKeyEncrypted = apiKey ? encrypt(apiKey) : null

  await query(
    `INSERT INTO ai_settings
       (user_id, provider, api_key_encrypted, base_url, model, system_prompt,
        feature_summarize, feature_reply_draft, feature_improve, feature_translate, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       provider            = EXCLUDED.provider,
       api_key_encrypted   = COALESCE(EXCLUDED.api_key_encrypted, ai_settings.api_key_encrypted),
       base_url            = EXCLUDED.base_url,
       model               = EXCLUDED.model,
       system_prompt       = EXCLUDED.system_prompt,
       feature_summarize   = EXCLUDED.feature_summarize,
       feature_reply_draft = EXCLUDED.feature_reply_draft,
       feature_improve     = EXCLUDED.feature_improve,
       feature_translate   = EXCLUDED.feature_translate,
       updated_at          = NOW()`,
    [
      session.user.id, provider, apiKeyEncrypted, baseUrl ?? null, model,
      systemPrompt ?? null, featureSummarize, featureReplyDraft, featureImprove, featureTranslate,
    ]
  )

  return NextResponse.json({ data: { success: true } })
}
