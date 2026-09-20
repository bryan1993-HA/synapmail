import { decrypt } from './encrypt'
import { guardSystemPrompt, untrustedBlock } from './promptGuard'
import { htmlToText } from './html'

/**
 * `local` is the only provider the SERVER never contacts: the prompt is built
 * here all the same — guard included — and carried to the model by the BROWSER
 * (see lib/aiClient.ts). Every other provider is called from the server.
 */
export type AIProvider = 'claude' | 'openai' | 'ollama' | 'custom' | 'local'

export const LOCAL_PROVIDER: AIProvider = 'local'

/** Default address of a model served on the user's own machine (OpenAI-compatible route). */
export const LOCAL_DEFAULT_BASE_URL = 'http://127.0.0.1:11434/v1'

/**
 * Ports probed by the browser's "Detect" button. A remote address is refused
 * (see isLoopbackUrl), so only the loopback host is ever tried.
 */
export const LOCAL_DETECT_PORTS = [
  { port: 11434, label: 'Ollama', path: '/v1' },
  { port: 1234, label: 'LM Studio', path: '/v1' },
  { port: 8080, label: 'llama.cpp', path: '/v1' },
] as const

/** Hostnames a browser is allowed to reach over plain HTTP from an HTTPS page. */
export const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost', '[::1]', '::1'] as const

/**
 * True when the URL points at THIS machine. Pure and shared by the settings
 * screen and the API so both refuse exactly the same addresses: a remote host
 * would be blocked by the browser as mixed content anyway, and an API key is
 * the supported path for it.
 */
export function isLoopbackUrl(raw: string | null | undefined): boolean {
  if (!raw?.trim()) return false
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return false
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  return (LOOPBACK_HOSTS as readonly string[]).includes(url.hostname)
}

export interface AISettings {
  provider: AIProvider
  apiKeyEncrypted?: string | null
  baseUrl?: string | null
  model: string
  systemPrompt?: string | null
}

export interface AIMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export type AIAction = 'summarize' | 'reply' | 'improve' | 'tone' | 'translate'

export interface AIPromptOptions {
  tone?: string
  targetLang?: string
  context?: string
  promptGuard: boolean
}

const TONE_LABELS: Record<string, string> = {
  formal: 'formel et professionnel',
  casual: 'décontracté et amical',
  assertive: 'assertif et direct',
  concise: 'très concis (supprime tout ce qui est superflu)',
  empathetic: 'empathique et bienveillant',
}

const DEFAULT_TONE = 'formal'

/**
 * The user turn of the prompt. Mail content is stripped of HTML then fenced by
 * `untrustedBlock` when the mailbox asks for the guard.
 */
function buildPrompt(action: AIAction, content: string, options: AIPromptOptions): string {
  const plain = untrustedBlock(htmlToText(content), { enabled: options.promptGuard })

  switch (action) {
    case 'summarize':
      return `Résume cet email en 3 points clés maximum. Utilise des bullet points (• ). Sois très concis.\n\nEmail :\n${plain}`

    case 'reply':
      return `Rédige une réponse professionnelle et courtoise à cet email${options.context ? ` (contexte : ${options.context})` : ''}. Donne uniquement le corps de la réponse, sans "Bonjour" ni formule de clôture.\n\nEmail original :\n${plain}`

    case 'improve':
      return `Améliore cet email : corrige les fautes, améliore le style et la clarté. Réponds uniquement avec le texte amélioré, sans explication.\n\nEmail :\n${plain}`

    case 'tone': {
      const toneLabel = TONE_LABELS[options.tone ?? DEFAULT_TONE] ?? TONE_LABELS[DEFAULT_TONE]
      return `Réécris cet email dans un ton ${toneLabel}. Réponds uniquement avec le texte réécrit.\n\nEmail :\n${plain}`
    }

    case 'translate':
      if (options.targetLang === 'en') {
        return `Translate this email to English. Reply only with the translated text.\n\nEmail:\n${plain}`
      }
      return `Traduis cet email en français. Réponds uniquement avec le texte traduit.\n\nEmail :\n${plain}`

    default:
      throw new Error(`Unknown action: ${action}`)
  }
}

/**
 * THE prompt builder — the single place a request to a model is assembled, for
 * the server path and the browser path alike. A local model therefore receives
 * byte-for-byte the messages a hosted provider would, guard and delimiters
 * included; nothing is lost on the way out to the browser.
 */
export function buildMessages(
  action: AIAction,
  content: string,
  options: AIPromptOptions,
  systemPrompt?: string | null
): AIMessage[] {
  const system = guardSystemPrompt(systemPrompt, { enabled: options.promptGuard })
  return [
    ...(system ? [{ role: 'system' as const, content: system }] : []),
    { role: 'user' as const, content: buildPrompt(action, content, options) },
  ]
}

export async function callAI(
  settings: AISettings,
  userMessages: AIMessage[],
  /** On when the mailbox the content comes from has its prompt-injection guard enabled. */
  { promptGuard = false }: { promptGuard?: boolean } = {}
): Promise<string> {
  const { provider, apiKeyEncrypted, baseUrl, model, systemPrompt } = settings
  const apiKey = apiKeyEncrypted ? decrypt(apiKeyEncrypted) : null

  const system = guardSystemPrompt(systemPrompt, { enabled: promptGuard })
  const systemPart: AIMessage[] = system
    ? [{ role: 'system', content: system }]
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
    case 'local':
      // The server never reaches a model on the user's machine — the browser does.
      throw new Error('The local provider is called by the browser, not by the server')
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
