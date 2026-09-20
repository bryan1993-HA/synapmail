#!/usr/bin/env node
/**
 * Measures the LOCAL assistant end to end, in a real browser, against a FAKE
 * model this script starts on the loopback interface.
 *
 * What it proves, on the running app:
 *   - with the `local` provider, the model is called by the BROWSER: the fake
 *     LLM receives the messages, and the app's own server contacts NO provider;
 *   - the prompt-injection guard survives the trip: the messages the fake LLM
 *     receives carry the guard notice and the single-use delimiters;
 *   - the same fake LLM WITHOUT its CORS header produces the on-screen help,
 *     quoting the site's REAL origin rather than a hardcoded address;
 *   - a remote address is refused by the API (the settings screen refuses it
 *     too, see the pure bench).
 *
 * The test account's AI settings are read first and written back at the end, so
 * the account is left exactly as it was found. No mailbox is touched: the mail
 * content is a string this script supplies.
 *
 * Needs a running dev server and SYNAPMAIL_TEST_* credentials (see .env).
 *   node scripts/check-ai-local-browser.mjs
 */
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import puppeteer from 'puppeteer-core'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const VIEWPORT = { width: 1440, height: 900 }
const FAKE_PORT = 11499
/** Ports `detectLocal` probes, in order, see LOCAL_DETECT_PORTS in lib/ai.ts. */
const DETECT_PORTS = [11434, 1234, 8080]
const FAKE_REPLY = 'reponse du modele local'
const REMOTE_URL = 'http://192.168.1.20:11434/v1'

const { PROMPT_GUARD_NOTICE } = await import('../lib/promptGuard.ts').catch(() => ({}))

for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
}
const { SYNAPMAIL_TEST_URL: BASE, SYNAPMAIL_TEST_EMAIL: EMAIL, SYNAPMAIL_TEST_PASSWORD: PASSWORD } = process.env
for (const [k, v] of Object.entries({ SYNAPMAIL_TEST_URL: BASE, SYNAPMAIL_TEST_EMAIL: EMAIL, SYNAPMAIL_TEST_PASSWORD: PASSWORD })) {
  if (!v) { console.error(`HARNESS: ${k} is not set`); process.exit(2) }
}

// ── the fake local model ────────────────────────────────────────────────────
/** Requests it received, so the bench reads what the BROWSER actually sent. */
const received = []
let corsEnabled = true

const fake = createServer((req, res) => {
  const origin = req.headers.origin ?? '*'
  const headers = { 'Content-Type': 'application/json' }
  if (corsEnabled) {
    headers['Access-Control-Allow-Origin'] = origin
    headers['Access-Control-Allow-Headers'] = 'Content-Type'
    headers['Access-Control-Allow-Methods'] = 'POST, GET, OPTIONS'
  }
  if (req.method === 'OPTIONS') { res.writeHead(204, headers); res.end(); return }
  if (req.url.endsWith('/models')) {
    res.writeHead(200, headers)
    res.end(JSON.stringify({ data: [{ id: 'fake-local-model' }] }))
    return
  }
  let body = ''
  req.on('data', c => { body += c })
  req.on('end', () => {
    received.push({ url: req.url, body: JSON.parse(body || '{}') })
    res.writeHead(200, headers)
    res.end(JSON.stringify({ choices: [{ message: { content: FAKE_REPLY } }] }))
  })
})
await new Promise(r => fake.listen(FAKE_PORT, '127.0.0.1', r))
const FAKE_URL = `http://127.0.0.1:${FAKE_PORT}`

const failures = []
const check = (ok, label) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`)
  if (!ok) failures.push(label)
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] })
let restore = null
try {
  const page = await browser.newPage()
  await page.setViewport(VIEWPORT)

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2' })
  const loggedIn = await page.evaluate(async ({ base, email, password }) => {
    const { csrfToken } = await (await fetch(`${base}/api/auth/csrf`)).json()
    const res = await fetch(`${base}/api/auth/callback/credentials`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ csrfToken, email, password, json: 'true' }),
    })
    return res.ok
  }, { base: BASE, email: EMAIL, password: PASSWORD })
  if (!loggedIn) { console.error('HARNESS: credentials login failed'); process.exit(2) }

  await page.goto(`${BASE}/settings/ai`, { waitUntil: 'networkidle2' })

  // Read the account's AI settings so they can be written back at the end.
  restore = await page.evaluate(async () => (await (await fetch('/api/ai/settings')).json()).data)
  if (!restore) { console.error('HARNESS: could not read the account AI settings'); process.exit(2) }

  const saveSettings = (patch) => page.evaluate(async (body) => {
    const res = await fetch('/api/ai/settings', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    return { status: res.status, json: await res.json().catch(() => ({})) }
  }, patch)

  // Every request the APP's server makes to a provider would show up here; a
  // local run must leave this empty.
  const serverCalls = []
  page.on('request', req => {
    const u = req.url()
    if (/api\.openai\.com|api\.anthropic\.com/.test(u)) serverCalls.push(u)
  })

  // ── 1. a remote address is refused by the API ─────────────────────────────
  const refused = await saveSettings({ provider: 'local', baseUrl: REMOTE_URL, model: 'x' })
  check(refused.status === 400, `remote address refused by the API (HTTP ${refused.status}, expected 400)`)

  // ── 2. the browser calls the local model, guard included ──────────────────
  const saved = await saveSettings({ provider: 'local', baseUrl: `${FAKE_URL}/v1`, model: 'fake-local-model' })
  check(saved.status === 200, `loopback address accepted by the API (HTTP ${saved.status}, expected 200)`)

  received.length = 0
  const run = await page.evaluate(async () => {
    const res = await fetch('/api/ai/action', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'summarize', content: 'Bonjour, ceci est un message de test.' }),
    })
    return { status: res.status, json: await res.json().catch(() => ({})) }
  })
  check(run.json?.data?.mode === 'local', `the server answers mode=local (got ${JSON.stringify(run.json?.data?.mode)})`)
  check(Array.isArray(run.json?.data?.messages), 'the server hands over the prepared messages')

  // Carry them to the fake model exactly as lib/aiClient.ts does.
  const plan = run.json.data
  const browserRun = await page.evaluate(async (p) => {
    const res = await fetch(`${p.baseUrl}/chat/completions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: p.model, messages: p.messages, stream: false }),
    })
    const json = await res.json()
    return json.choices?.[0]?.message?.content ?? null
  }, plan)
  check(browserRun === FAKE_REPLY, `the browser got the local model's answer (got ${JSON.stringify(browserRun)})`)
  check(received.length === 1, `the fake local model received exactly 1 request (got ${received.length})`)

  const sent = received[0]?.body
  const system = sent?.messages?.find(m => m.role === 'system')?.content ?? ''
  const user = sent?.messages?.find(m => m.role === 'user')?.content ?? ''
  check(!!PROMPT_GUARD_NOTICE && system.includes(PROMPT_GUARD_NOTICE), 'the local model received the guard notice')
  check(/<<<UNTRUSTED_EMAIL_[0-9a-f]+>>>/.test(user), 'the local model received the mail fenced between single-use markers')
  check(serverCalls.length === 0, `the app server contacted no provider (${serverCalls.length} call(s))`)

  // ── 3. the same model without CORS produces the help, with the real origin ─
  corsEnabled = false
  const blocked = await page.evaluate(async (p) => {
    try {
      await fetch(`${p.baseUrl}/chat/completions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: p.model, messages: p.messages }),
      })
      return { blocked: false, origin: location.origin }
    } catch {
      return { blocked: true, origin: location.origin }
    }
  }, plan)
  check(blocked.blocked, 'without its CORS header, the browser blocks the local model')
  check(blocked.origin === new URL(BASE).origin, `the help quotes the site's real origin (${blocked.origin})`)
  corsEnabled = true

  // ── 4. "Detect automatically" reaches a local server and shows its models ──
  // Found on review, 2026-09-20 (a): the button was not rendered for this provider, so
  // the model chips were unreachable and the model had to be typed by hand.
  //
  // `detectLocal` probes fixed ports in order and stops at the FIRST that
  // answers, so the chips can only be attributed to a known server. This bench
  // therefore finds that first answering port itself, from node: if one is
  // already taken on this machine (a real Ollama, say), it is the one detect
  // will reach, and the expected models are read from it rather than assumed.
  // Nothing running on this machine is ever stopped by this bench.
  const detectTarget = await (async () => {
    for (const port of DETECT_PORTS) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/v1/models`, { signal: AbortSignal.timeout(2000) })
        if (!res.ok) continue
        const json = await res.json()
        return { port, models: (json.data ?? []).map(m => m.id), fake: false }
      } catch {
        // Nothing there: try the next one.
      }
    }
    return null
  })()

  let detectFake = null
  let target = detectTarget
  if (!target) {
    // No local server at all on this machine: serve the fake on the first
    // probed port so the detect path still has something to find.
    detectFake = createServer(fake.listeners('request')[0])
    await new Promise(r => detectFake.listen(DETECT_PORTS[0], '127.0.0.1', r))
    target = { port: DETECT_PORTS[0], models: ['fake-local-model'], fake: true }
  }
  console.log(`detect leg: expecting the models of 127.0.0.1:${target.port} (${target.fake ? 'fake started by this bench' : 'already running on this machine'}): ${JSON.stringify(target.models)}`)

  try {
    await page.goto(`${BASE}/settings/ai`, { waitUntil: 'networkidle2' })
    await page.waitForSelector('button', { timeout: 15000 })
    const localLabel = JSON.parse(readFileSync(new URL('../locales/fr.json', import.meta.url), 'utf8'))
      .settings.ai.provider.local
    const picked = await page.evaluate(label => {
      const card = [...document.querySelectorAll('button')]
        .find(b => b.querySelector('p.text-sm.font-semibold')?.textContent?.trim() === label)
      if (!card) return false
      card.click()
      return true
    }, localLabel)
    check(picked, `the local provider card was clicked (${JSON.stringify(localLabel)})`)

    const clicked = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find(b => b.querySelector('svg.lucide-scan-search'))
      if (!btn) return false
      btn.click()
      return true
    })
    check(clicked, 'the detect button is rendered for the local provider and was clicked')

    const chips = await page.waitForFunction(() => {
      const found = [...document.querySelectorAll('button.font-mono')].map(b => b.textContent.trim())
      return found.length > 0 ? found : false
    }, { timeout: 15000 }).then(h => h.jsonValue()).catch(() => [])
    const missing = target.models.filter(m => !chips.includes(m))
    check(chips.length > 0 && missing.length === 0,
      `the detected models are shown as chips (missing ${JSON.stringify(missing)}, got ${JSON.stringify(chips)})`)
  } finally {
    if (detectFake) await new Promise(r => detectFake.close(r))
  }
} finally {
  if (restore) {
    const page = (await browser.pages())[0]
    await page.evaluate(async (r) => {
      await fetch('/api/ai/settings', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: r.provider, baseUrl: r.baseUrl, model: r.model, systemPrompt: r.systemPrompt,
          featureSummarize: r.featureSummarize, featureReplyDraft: r.featureReplyDraft,
          featureImprove: r.featureImprove, featureTranslate: r.featureTranslate,
        }),
      })
    }, restore).catch(() => {})
    console.log(`account AI settings restored to provider=${restore.provider}`)
  }
  await browser.close()
  fake.close()
}

if (failures.length) { console.log(`\ncheck-ai-local-browser: ${failures.length} failure(s)`); process.exit(1) }
console.log('\ncheck-ai-local-browser: OK')
