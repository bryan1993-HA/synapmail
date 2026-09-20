#!/usr/bin/env node
/**
 * Measures, in a real browser and on the running app, what "Detect
 * automatically" SAYS when a local model is running but refuses this site.
 *
 * The defect this bench exists for (measured on 2026-09-19, in production):
 * Ollama was running locally with 10 models but answered 403 to any
 * request carrying the site's origin, and the settings screen read that as
 * "start the model on this computer" — the one thing that was not the problem.
 *
 * A FAKE server imitates that Ollama: 403 WITHOUT any CORS header for an
 * origin it does not know, 200 with `Access-Control-Allow-Origin` once the
 * origin is "allowed". It listens on a spare port; Chrome request
 * interception rewrites the probed port onto it, so a REAL Ollama already
 * running on this machine is never contacted, never stopped and never changed.
 * The rewrite is transparent to CORS: the browser still applies the response's
 * headers, which is the whole point of the measurement (verified leg by leg
 * below — a 403 without the header still raises the same TypeError the app
 * classifies).
 *
 * Four legs:
 *   1. the fake REFUSES this origin  -> the CORS help names the port that
 *      answered, and the "start the model" sentence is NOT on screen;
 *   2. Copy                          -> the clipboard holds exactly the
 *      command shown on screen;
 *   3. the fake ALLOWS this origin   -> the models come back as chips;
 *   4. nothing listening at all      -> the "start the model" help, and NOT
 *      the CORS help.
 *
 * The generated command is NEVER executed: it would change this machine.
 *
 * Needs a running dev server and SYNAPMAIL_TEST_* credentials (see .env).
 *   node scripts/check-ai-detect-cors.mjs
 */
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import puppeteer from 'puppeteer-core'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const VIEWPORT = { width: 1440, height: 900 }
/** The fake listens here; the probed ports are rewritten onto it. */
const FAKE_PORT = 11497
/** Ports `detectLocal` probes, in order — see LOCAL_DETECT_PORTS in lib/ai.ts. */
const DETECT_PORTS = [11434, 1234, 8080]
/** The first probed port is the one detect stops at, so it is the one named. */
const EXPECTED_PORT = DETECT_PORTS[0]
const FAKE_MODEL = 'fake-refusing-model'

for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
}
const { SYNAPMAIL_TEST_URL: BASE, SYNAPMAIL_TEST_EMAIL: EMAIL, SYNAPMAIL_TEST_PASSWORD: PASSWORD } = process.env
for (const [k, v] of Object.entries({ SYNAPMAIL_TEST_URL: BASE, SYNAPMAIL_TEST_EMAIL: EMAIL, SYNAPMAIL_TEST_PASSWORD: PASSWORD })) {
  if (!v) { console.error(`HARNESS: ${k} is not set`); process.exit(2) }
}

const fr = JSON.parse(readFileSync(new URL('../locales/fr.json', import.meta.url), 'utf8'))
const L = fr.settings.ai.local
/** The sentences the screen must, and must not, show. Read from the locale, never retyped. */
const SAY = {
  corsRefuses: L.corsRefusesSite.replace('{label}', 'Ollama').replace('{port}', String(EXPECTED_PORT)),
  startModel: L.startModel,
  detectAgain: L.thenDetectAgain,
  copy: L.copy,
  copied: L.copied,
  providerLocal: fr.settings.ai.provider.local,
}

// ── the fake Ollama ─────────────────────────────────────────────────────────
/** 'refuse' = 403 with no CORS header (Ollama's own default); 'allow' = 200 + header. */
let mood = 'refuse'
const fake = createServer((req, res) => {
  if (mood === 'refuse') {
    res.writeHead(403, { 'Content-Type': 'text/plain' })
    res.end('Forbidden')
    return
  }
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': req.headers.origin ?? '*',
    'Access-Control-Allow-Headers': 'Content-Type',
  }
  if (req.method === 'OPTIONS') { res.writeHead(204, headers); res.end(); return }
  res.writeHead(200, headers)
  res.end(JSON.stringify({ data: [{ id: FAKE_MODEL }] }))
})
await new Promise(r => fake.listen(FAKE_PORT, '127.0.0.1', r))

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
  // The Copy leg reads the clipboard back, which needs both permissions. They
  // are granted ONE BY ONE on purpose: `overridePermissions` denies every
  // permission it is not given, which made the page read its access to this
  // device as refused and show the permission notice instead of the CORS help
  // — a harness fault that looked exactly like the defect under test.
  const cdp = await browser.target().createCDPSession()
  for (const name of ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']) {
    await cdp.send('Browser.setPermission', {
      origin: new URL(BASE).origin,
      permission: { name },
      setting: 'granted',
    }).catch(e => {
      // A Chrome that does not know one of these names is not a harness fault:
      // the next name covers it. A name NONE of them knows shows up as a failed
      // clipboard leg, which is a real failure and reported as one.
      console.log(`  (Browser.setPermission ${name}: ${String(e).split('\n')[0]})`)
    })
  }

  /** 'fake' = probed ports land on the fake; 'silent' = nothing answers there. */
  let ports = 'fake'
  await page.setRequestInterception(true)
  page.on('request', req => {
    const url = req.url()
    const probed = DETECT_PORTS.find(p => url.startsWith(`http://127.0.0.1:${p}`))
    if (probed === undefined) { req.continue(); return }
    if (ports === 'silent') { req.abort('connectionrefused'); return }
    req.continue({ url: url.replace(`:${probed}`, `:${FAKE_PORT}`) })
  })

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
  const read = await page.evaluate(async () => {
    const res = await fetch('/api/ai/settings')
    return { status: res.status, body: await res.text() }
  })
  restore = (() => { try { return JSON.parse(read.body).data } catch { return null } })()
  if (!restore) {
    console.error(`HARNESS: could not read the account AI settings (HTTP ${read.status}: ${read.body.slice(0, 200)})`)
    process.exit(2)
  }

  await page.waitForSelector('button', { timeout: 15000 })
  const picked = await page.evaluate(label => {
    const card = [...document.querySelectorAll('button')]
      .find(b => b.querySelector('p.text-sm.font-semibold')?.textContent?.trim() === label)
    if (!card) return false
    card.click()
    return true
  }, SAY.providerLocal)
  if (!picked) { console.error('HARNESS: the local provider card was not found'); process.exit(2) }

  const clickDetect = () => page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find(b => b.querySelector('svg.lucide-scan-search'))
    if (!btn) return false
    btn.click()
    return true
  })
  /** Waits until the page settles on one of the two helps, then reads the text. */
  const readHelp = async (needle) => {
    const started = Date.now()
    let waitError = null
    await page.waitForFunction(
      text => document.body.innerText.includes(text),
      { timeout: 20000 }, needle,
    ).catch(e => { waitError = String(e).split('\n')[0] })
    const text = await page.evaluate(() => document.body.innerText)
    if (!text.includes(needle)) {
      // The help never came up: say how long we waited and why we stopped, so a
      // harness fault is never read as a product verdict.
      console.log(`  (waited ${Date.now() - started}ms for ${JSON.stringify(needle)}; wait ended with ${waitError ?? 'a match'})`)
    }
    return text
  }

  // ── 1. it answers but refuses this site ───────────────────────────────────
  mood = 'refuse'
  check(await clickDetect(), 'the detect button is rendered for the local provider and was clicked')
  let text = await readHelp(SAY.corsRefuses)
  check(text.includes(SAY.corsRefuses), `the help names the port that answered: ${JSON.stringify(SAY.corsRefuses)}`)
  check(!text.includes(SAY.startModel), 'the misleading "start the model" sentence is NOT shown')
  check(text.includes(SAY.detectAgain), 'the help tells the user to run Detect again afterwards')
  check(text.includes('OLLAMA_ORIGINS'), 'the command to run is on screen')
  const shownOrigin = new URL(BASE).origin
  check(text.includes(shownOrigin), `the command carries this site's real origin (${shownOrigin})`)

  // ── 2. Copy puts exactly the shown command in the clipboard ───────────────
  const copied = await page.evaluate(async labelCopy => {
    const btn = [...document.querySelectorAll('button')]
      .find(b => b.textContent.trim() === labelCopy)
    if (!btn) return { found: false }
    const shown = btn.closest('div')?.parentElement?.querySelector('pre')?.textContent ?? ''
    btn.click()
    await new Promise(r => setTimeout(r, 300))
    return { found: true, shown, clip: await navigator.clipboard.readText(), label: btn.textContent.trim() }
  }, SAY.copy)
  check(copied.found, 'a Copy button is rendered next to the command')
  check(!!copied.shown && copied.clip === copied.shown,
    `the clipboard holds exactly the command shown (${copied.clip?.length ?? 0} vs ${copied.shown?.length ?? 0} chars)`)
  check(copied.label === SAY.copied, `the button turned into ${JSON.stringify(SAY.copied)} (got ${JSON.stringify(copied.label)})`)

  // ── 3. once the origin is allowed, the models come back ───────────────────
  mood = 'allow'
  check(await clickDetect(), 'detect was clicked again with the origin allowed')
  const chips = await page.waitForFunction(model => {
    const found = [...document.querySelectorAll('button.font-mono')].map(b => b.textContent.trim())
    return found.includes(model) ? found : false
  }, { timeout: 20000 }, FAKE_MODEL).then(h => h.jsonValue()).catch(() => [])
  check(chips.includes(FAKE_MODEL), `the allowed server's models are shown as chips (got ${JSON.stringify(chips)})`)
  const afterAllow = await page.evaluate(() => document.body.innerText)
  check(!afterAllow.includes(SAY.corsRefuses), 'the CORS help is gone once the models came back')

  // ── 4. nothing listening at all ──────────────────────────────────────────
  ports = 'silent'
  check(await clickDetect(), 'detect was clicked with nothing listening')
  text = await readHelp(SAY.startModel)
  check(text.includes(SAY.startModel), 'nothing listening: the "start the model" help is shown')
  check(!text.includes(SAY.corsRefuses), 'nothing listening: the CORS help is NOT shown')
} finally {
  if (restore) {
    const page = (await browser.pages())[0]
    await page.evaluate(async r => {
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

if (failures.length) { console.log(`\ncheck-ai-detect-cors: ${failures.length} failure(s)`); process.exit(1) }
console.log('\ncheck-ai-detect-cors: OK')
