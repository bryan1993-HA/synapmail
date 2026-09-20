/**
 * THE browser-side entry point to the assistant — used by every AI component.
 *
 * `POST /api/ai/action` either answers with a `result` (the server called a
 * hosted provider) or with `mode: 'local'` plus the messages it prepared, which
 * this module carries to a model running on the user's own machine. The prompt
 * is never rebuilt here: the guard, the delimiters and the system turn all come
 * from the server (lib/ai.ts `buildMessages`), so both paths send the same
 * thing to the model.
 */

import { LOCAL_PROVIDER, isLoopbackUrl } from './ai'
import type { AIMessage } from './ai'

export type AIFailureKind =
  /** The server refused, or a hosted provider did. */
  | 'server'
  /** The browser refuses to reach this device at all, before any request leaves. */
  | 'permission'
  /** Nothing is listening on the local address. */
  | 'unreachable'
  /** Something answered, but the browser blocked the response (no CORS header). */
  | 'cors'
  /** The local model answered with an error status. */
  | 'model'

export class AIClientError extends Error {
  // A plain field, not a parameter property: the self-checks import this
  // module directly under node's type-stripping, which rejects the shorthand.
  kind: AIFailureKind

  constructor(kind: AIFailureKind, message: string) {
    super(message)
    this.name = 'AIClientError'
    this.kind = kind
  }
}

interface LocalPlan {
  mode: typeof LOCAL_PROVIDER
  baseUrl: string
  model: string
  messages: AIMessage[]
}

type ActionResponse = { data?: { result?: string } & Partial<LocalPlan>; error?: string }

export interface AIActionRequest {
  action: string
  content: string
  accountId?: string
  context?: string
  tone?: string
  targetLang?: string
}

/**
 * Permission names a browser may use for "this page may reach apps running on
 * this device". Chrome renamed it more than once, so the names are tried in
 * order and the first one the browser knows answers; a browser that knows none
 * is not an error, it just tells us nothing.
 */
export const LOCAL_NETWORK_PERMISSIONS = ['loopback-network', 'local-network-access'] as const

/** `unknown` = this browser exposes no such permission, so the state cannot be read. */
export type LocalAccessState = 'granted' | 'prompt' | 'denied' | 'unknown'

/**
 * Reads whether the page is allowed to reach this device. Never throws: an
 * older browser, a browser without the Permissions API and a browser that does
 * not know these names all answer `unknown`, and the call goes ahead anyway.
 */
export async function localAccessState(): Promise<LocalAccessState> {
  const permissions = globalThis.navigator?.permissions
  if (!permissions?.query) return 'unknown'
  for (const name of LOCAL_NETWORK_PERMISSIONS) {
    try {
      const status = await permissions.query({ name } as unknown as PermissionDescriptor)
      return status.state as LocalAccessState
    } catch {
      // This browser does not know that name: try the next one.
    }
  }
  return 'unknown'
}

/**
 * Tells apart the three ways a call to this device fails, which a browser
 * otherwise reports identically (a TypeError with no status):
 *
 *  1. the permission is refused, so the request never left the browser;
 *  2. something answers but refuses this origin (no CORS header);
 *  3. nothing is listening there.
 *
 * The permission is read FIRST because it also blocks the probe, which would
 * otherwise make a refused permission look like an empty address.
 */
export async function classifyLocalFailure(baseUrl: string): Promise<AIFailureKind> {
  if (await localAccessState() === 'denied') return 'permission'
  return await probeLocal(baseUrl) ? 'cors' : 'unreachable'
}

/** Chat completion on an OpenAI-compatible server (Ollama `/v1`, LM Studio, llama.cpp). */
export async function callLocalModel(plan: LocalPlan): Promise<string> {
  if (!isLoopbackUrl(plan.baseUrl)) {
    throw new AIClientError('server', 'The local provider only accepts a loopback address')
  }

  let res: Response
  try {
    res = await fetch(`${plan.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: plan.model, messages: plan.messages, stream: false }),
    })
  } catch {
    throw new AIClientError(await classifyLocalFailure(plan.baseUrl), plan.baseUrl)
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: { message?: string } | string }
    const detail = typeof err.error === 'string' ? err.error : err.error?.message
    throw new AIClientError('model', detail || `Local model error: ${res.status}`)
  }

  const data = await res.json() as { choices?: { message?: { content?: string } }[] }
  return data.choices?.[0]?.message?.content ?? ''
}

/**
 * True when something answers at that address. `no-cors` gets an opaque
 * response rather than an exception, so a server that is up but refuses this
 * origin still resolves — which is exactly the distinction we need.
 */
async function probeLocal(baseUrl: string): Promise<boolean> {
  try {
    await fetch(`${baseUrl.replace(/\/+$/, '')}/models`, { mode: 'no-cors' })
    return true
  } catch {
    return false
  }
}

/** Models advertised by a local server, read by the BROWSER (the server cannot reach it). */
export async function listLocalModels(baseUrl: string): Promise<string[]> {
  if (!isLoopbackUrl(baseUrl)) throw new AIClientError('server', baseUrl)
  let res: Response
  try {
    res = await fetch(`${baseUrl.replace(/\/+$/, '')}/models`)
  } catch {
    throw new AIClientError(await classifyLocalFailure(baseUrl), baseUrl)
  }
  if (!res.ok) throw new AIClientError('model', `HTTP ${res.status}`)
  const data = await res.json() as { data?: { id: string }[] }
  return (data.data ?? []).map(m => m.id)
}

/** Runs an assistant action, whichever side ends up calling the model. */
export async function runAIAction(req: AIActionRequest): Promise<string> {
  let res: Response
  try {
    res = await fetch('/api/ai/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    })
  } catch {
    throw new AIClientError('server', 'network')
  }

  const json = await res.json().catch(() => ({})) as ActionResponse
  if (!res.ok) throw new AIClientError('server', json.error || `HTTP ${res.status}`)

  if (json.data?.mode === LOCAL_PROVIDER) {
    return callLocalModel(json.data as LocalPlan)
  }
  if (typeof json.data?.result === 'string') return json.data.result
  throw new AIClientError('server', json.error || 'Empty response')
}

/**
 * i18n key describing a failure, under the `mail.ai` namespace. One place maps
 * a failure kind to what the user reads, so both components say the same thing.
 */
export function aiFailureKey(err: unknown): string {
  const kind = err instanceof AIClientError ? err.kind : 'server'
  return `errors.${kind}`
}

// ── Allowing this site in Ollama ────────────────────────────────────────────

/**
 * Ollama only answers pages served from the machine it runs on; every other
 * origin gets a 403 that no client code can work around. The fix is one
 * setting on the user's own computer, so the screen hands them the exact
 * command instead of describing it.
 */
export const OLLAMA_ORIGINS_VAR = 'OLLAMA_ORIGINS'

export type LocalOs = 'mac' | 'windows' | 'linux'

/** Order the commands are offered in, the visitor's own system first. */
export const LOCAL_OS_ORDER = ['mac', 'windows', 'linux'] as const

/**
 * The command lands in a terminal, so the origin is a TRUST BOUNDARY: only a
 * plain http(s) origin passes, which leaves no room for a quote, a space, a
 * `;`, a `$` or a newline to reach the shell.
 */
const SAFE_ORIGIN = /^https?:\/\/[a-z0-9.-]+(:\d{1,5})?$/

export function isSafeOrigin(origin: string): boolean {
  return SAFE_ORIGIN.test(origin)
}

/** Reads the visitor's system from a user agent; anything unknown reads as Linux. */
export function detectLocalOs(userAgent: string): LocalOs {
  if (/Mac OS X|Macintosh/i.test(userAgent)) return 'mac'
  if (/Windows/i.test(userAgent)) return 'windows'
  return 'linux'
}

/**
 * Builds the command that allows `origin` in Ollama on one system. Each one
 * PERSISTS across a reboot, ADDS to any existing value instead of replacing it
 * (another app may rely on it) and restarts Ollama.
 *
 * Throws on an origin that is not a plain http(s) origin: see SAFE_ORIGIN.
 */
export function buildOllamaOriginCommand(os: LocalOs, origin: string): string {
  if (!isSafeOrigin(origin)) {
    throw new AIClientError('server', `Refused origin: ${origin}`)
  }
  const V = OLLAMA_ORIGINS_VAR
  if (os === 'mac') {
    return [
      `ORIGIN='${origin}'`,
      `CUR=$(launchctl getenv ${V})`,
      `case ",$CUR," in *",$ORIGIN,"*) NEW="$CUR" ;; *) NEW="${'${CUR:+$CUR,}'}$ORIGIN" ;; esac`,
      'PLIST="$HOME/Library/LaunchAgents/com.ollama.origins.plist"',
      'mkdir -p "$HOME/Library/LaunchAgents"',
      'cat > "$PLIST" <<PLIST_EOF',
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
      '<plist version="1.0"><dict>',
      '<key>Label</key><string>com.ollama.origins</string>',
      `<key>ProgramArguments</key><array><string>launchctl</string><string>setenv</string><string>${V}</string><string>$NEW</string></array>`,
      '<key>RunAtLoad</key><true/>',
      '</dict></plist>',
      'PLIST_EOF',
      `launchctl setenv ${V} "$NEW"`,
      // Both names, case sensitive: `ollama` is only the server, and the
      // `Ollama` app restarts it with its OLD environment if left running.
      // A quit through AppleScript is refused by the app, so it is not used.
      'pkill -x Ollama || true',
      'pkill -x ollama || true',
      'for i in 1 2 3 4 5 6 7 8 9 10; do pgrep -x Ollama >/dev/null || pgrep -x ollama >/dev/null || break; sleep 1; done',
      'open -a Ollama',
    ].join('\n')
  }
  if (os === 'linux') {
    return [
      `ORIGIN='${origin}'`,
      `CUR=$(systemctl show -p Environment --value ollama.service | tr ' ' '\\n' | sed -n 's/^${V}=//p')`,
      `case ",$CUR," in *",$ORIGIN,"*) NEW="$CUR" ;; *) NEW="${'${CUR:+$CUR,}'}$ORIGIN" ;; esac`,
      'sudo mkdir -p /etc/systemd/system/ollama.service.d',
      `printf '[Service]\\nEnvironment="${V}=%s"\\n' "$NEW" | sudo tee /etc/systemd/system/ollama.service.d/zz-origins.conf`,
      'sudo systemctl daemon-reload',
      'sudo systemctl restart ollama',
    ].join('\n')
  }
  return [
    `$origin = '${origin}'`,
    `$cur = [Environment]::GetEnvironmentVariable('${V}', 'User')`,
    "$list = @($cur -split ',' | Where-Object { $_ -ne '' })",
    'if ($list -notcontains $origin) { $list += $origin }',
    `[Environment]::SetEnvironmentVariable('${V}', ($list -join ','), 'User')`,
    // Same trap as macOS: 'ollama' is the server only, the 'ollama app' tray
    // icon survives it and restarts it with the old environment.
    "Get-Process 'ollama app','ollama' -ErrorAction SilentlyContinue | Stop-Process -Force",
    'Start-Process "$env:LOCALAPPDATA\\Programs\\Ollama\\ollama app.exe"',
  ].join('\n')
}
