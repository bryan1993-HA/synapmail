#!/usr/bin/env node
/**
 * Measures the house rules on the assistant settings screen, as RENDERED:
 * no emoji and no em dash in what the user actually reads, and the step
 * titles coming from the locale files rather than from the component.
 *
 * Reading the rendered text is the point: a previous review found emoji and
 * em dashes that `check-locales` could not see, because they were written
 * straight into the JSX instead of going through a locale file.
 *
 * Negative control:
 *   node scripts/check-ai-screen.mjs --break=<case>
 *
 *   node scripts/check-ai-screen.mjs
 */
import { readFileSync } from 'node:fs'
import puppeteer from 'puppeteer-core'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const VIEWPORT = { width: 1440, height: 900 }
const EM_DASH = '\u2014'
/** Anything outside the plane of ordinary text: pictographs, flags, symbols. */
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{1F1E6}-\u{1F1FF}]/u

const BREAKAGES = {
  'emoji-in-screen': 'an emoji in the rendered screen goes unnoticed',
  'em-dash-in-screen': 'an em dash in the rendered screen goes unnoticed',
  'detect-hidden-for-local': 'the local provider losing its detect button goes unnoticed',
  'permission-said-twice': 'the permission sentence printed twice goes unnoticed',
}
const BREAK = process.argv.find(a => a.startsWith('--break='))?.slice('--break='.length) ?? null
if (BREAK && !BREAKAGES[BREAK]) {
  console.error(`HARNESS: --break=${BREAK} is not one of ${Object.keys(BREAKAGES).join(', ')}`)
  process.exit(1)
}

for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
}
const { SYNAPMAIL_TEST_URL: BASE, SYNAPMAIL_TEST_EMAIL: EMAIL, SYNAPMAIL_TEST_PASSWORD: PASSWORD } = process.env
for (const [k, v] of Object.entries({ SYNAPMAIL_TEST_URL: BASE, SYNAPMAIL_TEST_EMAIL: EMAIL, SYNAPMAIL_TEST_PASSWORD: PASSWORD })) {
  if (!v) { console.error(`HARNESS: ${k} is not set`); process.exit(2) }
}

const locales = Object.fromEntries(['en', 'fr', 'zh'].map(code =>
  [code, JSON.parse(readFileSync(new URL(`../locales/${code}.json`, import.meta.url), 'utf8'))]))

let failures = 0
const check = (ok, label) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`)
  if (!ok) failures++
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] })
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
  await page.waitForSelector('button', { timeout: 15000 })

  let text = await page.evaluate(() => document.body.innerText)
  if (BREAK === 'emoji-in-screen') text += '\n\u{1F916}'
  if (BREAK === 'em-dash-in-screen') text += `\n1 ${EM_DASH} Fournisseur`

  const emoji = text.match(new RegExp(EMOJI, 'gu')) ?? []
  check(emoji.length === 0, `no emoji in the rendered screen (found ${JSON.stringify(emoji)})`)
  check(!text.includes(EM_DASH), 'no em dash in the rendered screen')

  // The step titles must come from a locale file: their presence in the page
  // for the served language is what proves the component stopped hardcoding
  // them, and check-locales then covers the other two languages. The titles
  // are uppercased by CSS, which innerText reports, so the case is dropped.
  const flat = text.toLowerCase()
  const served = ['en', 'fr', 'zh'].filter(code =>
    flat.includes(locales[code].settings.ai.stepProvider.toLowerCase())
    && flat.includes(locales[code].settings.ai.stepAccess.toLowerCase()))
  check(served.length > 0, `the step titles come from a locale file (matched: ${served.join(', ') || 'none'})`)

  // Each provider card carries an icon (an svg), not a character.
  const cardsWithIcon = await page.evaluate(() =>
    [...document.querySelectorAll('button')]
      .filter(b => b.querySelector('p.text-sm.font-semibold'))
      .map(b => !!b.querySelector('svg')))
  check(cardsWithIcon.length >= 5, `the five provider cards are on screen (found ${cardsWithIcon.length})`)
  check(cardsWithIcon.every(Boolean), 'every provider card carries an icon')

  // ── the local provider, picked with a real click ──────────────────────────
  // Found on review, 2026-09-20 (a): with "Local, on this device" the detect button was
  // not rendered at all, so the model chips were never reachable and the model
  // had to be typed by hand.
  const localLabel = locales[served[0] ?? 'fr'].settings.ai.provider.local
  const picked = await page.evaluate(label => {
    const card = [...document.querySelectorAll('button')]
      .find(b => b.querySelector('p.text-sm.font-semibold')?.textContent?.trim() === label)
    if (!card) return false
    card.click()
    return true
  }, localLabel)
  check(picked, `the local provider card is on screen and clickable (${JSON.stringify(localLabel)})`)
  await new Promise(r => setTimeout(r, 500))

  const detectVisible = await page.evaluate(breakIt => {
    const btn = [...document.querySelectorAll('button')].find(b => b.querySelector('svg.lucide-scan-search'))
    if (breakIt && btn) btn.remove()
    const shown = [...document.querySelectorAll('button')].some(b => b.querySelector('svg.lucide-scan-search'))
    return shown
  }, BREAK === 'detect-hidden-for-local')
  check(detectVisible, 'the local provider offers the detect button')

  // Found on review, 2026-09-20 (c): the refused-permission sentence was printed twice,
  // once inline and once in its own box. It must be said exactly once.
  const permissionSentence = locales[served[0] ?? 'fr'].mail.ai.errors.permission
  // The denied state is NOT reachable from this bench: a loopback origin is
  // exempt from the browser permission, so the baseline count here is 0 and
  // only a manual review on an HTTPS origin sees the sentence for real. The
  // control therefore injects the defect exactly as it was read on screen, twice.
  const saidTimes = await page.evaluate(({ sentence, breakIt }) => {
    const body = document.body
    if (breakIt) {
      for (let i = 0; i < 2; i++) {
        const extra = document.createElement('p')
        extra.textContent = sentence
        body.appendChild(extra)
      }
    }
    return body.innerText.split(sentence).length - 1
  }, { sentence: permissionSentence, breakIt: BREAK === 'permission-said-twice' })
  check(saidTimes <= 1, `the refused-permission sentence is never repeated (found ${saidTimes} time(s))`)
} finally {
  await browser.close()
}

if (BREAK) {
  if (failures > 0) { console.log(`\ncheck-ai-screen: negative control OK, "${BREAKAGES[BREAK]}" produced ${failures} failure(s)`); process.exit(0) }
  console.log(`\ncheck-ai-screen: negative control FAILED, "${BREAKAGES[BREAK]}" went unnoticed`)
  process.exit(1)
}
if (failures > 0) { console.log(`\ncheck-ai-screen: ${failures} failure(s)`); process.exit(1) }
console.log('\ncheck-ai-screen: OK')
