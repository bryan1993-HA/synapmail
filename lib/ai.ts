import { decrypt } from './encrypt'

export type AIProvider = 'claude' | 'openai' | 'ollama' | 'custom'

export interface AISettings {
  provider: AIProvider
  apiKeyEncrypted?: string | null
  baseUrl?: string | null
  model: string
  systemPrompt?: string | null
}

interface AIMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export async function callAI(settings: AISettings, userMessages: AIMessage[]): Promise<string> {
  const { provider, apiKeyEncrypted, baseUrl, model, systemPrompt } = settings
  const apiKey = apiKeyEncrypted ? decrypt(apiKeyEncrypted) : null

  const systemPart: AIMessage[] = systemPrompt
    ? [{ role: 'system', content: systemPrompt }]
    : []
  const messages = [...systemPart, ...userMessages]

  switch (provider) {
    case 'claude':
      return callClaude(apiKey!, model, messages)
    case 'openai':
      return callOpenAICompat(apiKey!, model, messages, 'https://api.openai.com/v1')
    case 'ollama':
      return callOllama(baseUrl || 'http://localhost:11434', model, messages)
    case 'custom':
      return callOpenAICompat(apiKey ?? '', model, messages, baseUrl ?? '')
    default:
      throw new Error(`Unknown AI provider: ${provider}`)
  }
}

async function callClaude(apiKey: string, model: string, messages: AIMessage[]): Promise<string> {
  const systemMsg = messages.find(m => m.role === 'system')
  const userMessages = messages.filter(m => m.role !== 'system')

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 2048,
      ...(systemMsg ? { system: systemMsg.content } : {}),
      messages: userMessages.map(m => ({ role: m.role, content: m.content })),
    }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: { message?: string } }
    throw new Error(err.error?.message || `Claude API error: ${res.status}`)
  }

  const data = await res.json() as { content: { text: string }[] }
  return data.content[0]?.text ?? ''
}

async function callOpenAICompat(
  apiKey: string,
  model: string,
  messages: AIMessage[],
  baseUrl: string
): Promise<string> {
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: 2048,
    }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: { message?: string } }
    throw new Error(err.error?.message || `API error: ${res.status}`)
  }

  const data = await res.json() as { choices: { message: { content: string } }[] }
  return data.choices[0]?.message?.content ?? ''
}

async function callOllama(baseUrl: string, model: string, messages: AIMessage[]): Promise<string> {
  const res = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, stream: false }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(err.error || `Ollama error: ${res.status}`)
  }

  const data = await res.json() as { message?: { content: string } }
  return data.message?.content ?? ''
}
