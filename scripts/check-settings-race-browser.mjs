#!/usr/bin/env node
/**
 * PR-29 follow-up, measured on the running app with a REAL mouse: switch the active
 * mailbox from the sidebar, and while the PATCH is still on its way, let a focus
 * revalidation of `/api/settings` come back with the OLD row (exactly what an
 * alt-tab does). The bar must keep showing the mailbox the user just picked.
 *
 * The race is made deterministic from outside the page: a first switch is let land
 * (the server moves), then the switch back has its PATCH HELD at the network layer, a
 * `focus` event is dispatched (SWR's revalidateOnFocus fires a GET that the server
 * answers with the FIRST switch's row, since the PATCH has not landed), the GET is let
 * through, THEN the PATCH is released. Read-only for the mailbox: only `/api/settings`
 * is written, and the initial active account is restored at the end.
 *
 * Needs a running server and SYNAPMAIL_TEST_* (.env).
 *   node scripts/check-settings-race-browser.mjs
 *   node scripts/check-settings-race-browser.mjs --negative
 *
 * NEGATIVE CONTROL: the pre-fix `switchAccount` (event + a bare `fetch`, no SWR
 * mutation) is replayed in the page instead of the click. The bench MUST see the old
 * mailbox come back.
 */
import { readFileSync } from 'node:fs'
import puppeteer from 'puppeteer-core'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const NEGATIVE = process.argv.includes('--negative')
const SETTLE_MS = 800
/** SWR ignores a focus for `focusThrottleInterval` (5 s) after mount; wait it out before racing. */
const FOCUS_THROTTLE_MS = 5000
const SIDEBAR_ACCOUNT = '[data-sidebar-row="account"]'
const accountRow = id => `[data-sidebar-row="account:${id}"]`

for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
}
const { SYNAPMAIL_TEST_URL: BASE, SYNAPMAIL_TEST_EMAIL: EMAIL, SYNAPMAIL_TEST_PASSWORD: PASSWORD } = process.env
for (const [k, v] of Object.entries({ SYNAPMAIL_TEST_URL: BASE, SYNAPMAIL_TEST_EMAIL: EMAIL, SYNAPMAIL_TEST_PASSWORD: PASSWORD })) {
  if (!v) { console.error(`HARNESS: ${k} n'est pas renseigné`); process.exit(2) }
}
// The key is read from the product, not retyped.
const SETTINGS_KEY = readFileSync(new URL('../lib/settings.ts', import.meta.url), 'utf8').match(/SETTINGS_KEY = '([^']+)'/)?.[1]
if (!SETTINGS_KEY) { console.error('HARNESS: SETTINGS_KEY illisible dans lib/settings.ts'); process.exit(2) }

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'], protocolTimeout: 120000 })
const failures = []
let initialActive = null
let page
let intercept = () => undefined
try {
  page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 900 })
  const hydrated = async selector => {
    await page.waitForSelector(selector, { timeout: 25000 })
    await page.waitForFunction(sel => {
      const el = document.querySelector(sel)
      return !!el && Object.keys(el).some(k => k.startsWith('__reactProps$'))
    }, { timeout: 25000 }, selector)
  }
  const realClick = async selector => {
    await hydrated(selector)
    const box = await page.$eval(selector, el => {
      el.scrollIntoView({ block: 'center' })
      const r = el.getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height }
    })
    if (box.w === 0 || box.h === 0) { console.error(`HARNESS: ${selector} est rendu avec une taille nulle`); process.exit(2) }
    await page.mouse.click(box.x, box.y)
  }

  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  const loggedIn = await page.evaluate(async ({ base, email, password }) => {
    const { csrfToken } = await (await fetch(`${base}/api/auth/csrf`)).json()
    const res = await fetch(`${base}/api/auth/callback/credentials`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ csrfToken, email, password, json: 'true' }),
    })
    return res.ok
  }, { base: BASE, email: EMAIL, password: PASSWORD })
  if (!loggedIn) { console.error('HARNESS: connexion refusée'); process.exit(2) }

  const accounts = await page.evaluate(async base => {
    const b = await (await fetch(`${base}/api/accounts`)).json()
    return (b.data ?? []).map(a => ({ id: a.id, email: a.email, name: a.name }))
  }, BASE)
  if (accounts.length < 2) { console.error(`HARNESS: ${accounts.length} boîte(s) — il en faut 2`); process.exit(2) }
  initialActive = await page.evaluate(async (base, key) =>
    (await (await fetch(`${base}${key}`)).json()).data?.active_account_id ?? null, BASE, SETTINGS_KEY)


  // ---- network control: hold the PATCH, let a stale GET through, then release ----
  await page.setRequestInterception(true)
  let heldPatch = null
  let holdNext = false
  const seen = []
  intercept = req => {
    const u = new URL(req.url())
    if (u.pathname !== SETTINGS_KEY) return req.continue()
    seen.push(req.method())
    if (req.method() === 'PATCH' && holdNext && !heldPatch) { heldPatch = req; return } // held on the wire
    req.continue()
  }
  page.on('request', intercept)

  await page.goto(`${BASE}/mail`, { waitUntil: 'domcontentloaded' })
  await hydrated(SIDEBAR_ACCOUNT)
  await new Promise(r => setTimeout(r, FOCUS_THROTTLE_MS + SETTLE_MS))

  const shownAccount = async () => page.$eval(SIDEBAR_ACCOUNT, el => el.textContent)
  const label = a => a.name || a.email
  const first = accounts.find(a => a.id === initialActive) ?? accounts[0]
  const second = accounts.find(a => a.id !== first.id)
  console.log(`boîtes : ${first.email} → ${second.email} → ${first.email}`)

  /**
   * One switch. Positive: the real click. Negative: the pre-fix `switchAccount`,
   * replayed verbatim against the page's REAL swr — the event turns the accent as the
   * click did, and the preference goes out as a bare fetch that is nobody's mutation,
   * so the shared cache never learns the new value and nothing tells SWR to discard a
   * stale GET.
   */
  const switchTo = async target => {
    if (NEGATIVE) {
      await page.evaluate((key, id) => {
        window.dispatchEvent(new CustomEvent('synapmail:account-change', { detail: id }))
        void fetch(key, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active_account_id: id }) })
      }, SETTINGS_KEY, target.id)
      return
    }
    await realClick(SIDEBAR_ACCOUNT)
    await new Promise(r => setTimeout(r, SETTLE_MS))
    await realClick(accountRow(target.id))
  }

  // 1. A first switch that LANDS: the server now says `second`. Whether the cache
  //    followed is the whole difference between the two shapes.
  holdNext = false
  await switchTo(second)
  await new Promise(r => setTimeout(r, 1500))
  const step1 = await shownAccount()
  console.log(`  1. bascule posée              : ${step1.trim().slice(0, 60)}`)
  if (!step1.includes(label(second))) failures.push(`la première bascule n'a pas mis ${label(second)} à l'écran`)

  // 2. The switch back, its PATCH held on the wire — the server still says `second`.
  holdNext = true
  await switchTo(first)
  await new Promise(r => setTimeout(r, SETTLE_MS))
  if (!heldPatch) { console.error(`HARNESS: aucun PATCH ${SETTINGS_KEY} n'est parti (vu : ${seen.join(', ')})`); process.exit(2) }
  const afterClick = await shownAccount()
  console.log(`  2. après le clic (PATCH retenu): ${afterClick.trim().slice(0, 60)}`)
  if (!afterClick.includes(label(first))) failures.push(`le clic n'a pas basculé la barre sur ${label(first)}`)

  // 3. The alt-tab: SWR revalidates on focus; the GET answers with the server's row.
  const getsBefore = seen.filter(m => m === 'GET').length
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    window.dispatchEvent(new Event('focus'))
  })
  await new Promise(r => setTimeout(r, 1500))
  const getsAfter = seen.filter(m => m === 'GET').length
  console.log(`  3. GET de revalidation au focus: ${getsAfter - getsBefore}`)
  if (getsAfter === getsBefore) { console.error('HARNESS: le focus n\'a déclenché aucune relecture — la course n\'a pas eu lieu'); process.exit(2) }
  const afterFocus = await shownAccount()
  console.log(`     après la relecture périmée : ${afterFocus.trim().slice(0, 60)}`)
  if (!afterFocus.includes(label(first))) failures.push(`la relecture au focus a remis ${label(second)} (attendu ${label(first)})`)

  // 4. The PATCH lands.
  await heldPatch.continue()
  await new Promise(r => setTimeout(r, 1500))
  const afterPatch = await shownAccount()
  const server = await page.evaluate(async (base, key) =>
    (await (await fetch(`${base}${key}`)).json()).data?.active_account_id, BASE, SETTINGS_KEY)
  console.log(`  4. PATCH relâché → écran      : ${afterPatch.trim().slice(0, 60)}`)
  console.log(`     PATCH relâché → serveur    : ${accounts.find(a => a.id === server)?.email ?? server}`)
  if (!afterPatch.includes(label(first))) failures.push(`une fois le PATCH passé, l'écran montre ${afterPatch.trim().slice(0, 40)}`)
  if (server !== first.id) failures.push(`le serveur n'a pas enregistré ${first.email}`)
} finally {
  if (page && initialActive !== undefined) {
    page.off('request', intercept)
    await page.setRequestInterception(false).catch(() => undefined)
    await page.evaluate(async (base, key, id) => {
      await fetch(`${base}${key}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active_account_id: id }) })
    }, BASE, SETTINGS_KEY, initialActive).catch(() => undefined)
  }
  await browser.close()
}

if (NEGATIVE) {
  if (!failures.length) { console.error('\ncontrôle négatif : ÉCHEC — la forme d\'avant reste verte, le banc ne mesure rien'); process.exit(1) }
  console.log(`\ncontrôle négatif : OK — le banc voit la régression (${failures.length} échec(s))`)
  for (const f of failures) console.log(`  · ${f}`)
  process.exit(0)
}
if (failures.length) { console.error(`\n${failures.length} échec(s)`); for (const f of failures) console.error(`  · ${f}`); process.exit(1) }
console.log('\nsettings race: OK')
