#!/usr/bin/env node
/**
 * PR-29 follow-up, measured on the running app with a REAL mouse: the sidebar's
 * account picker must fold when the user right-clicks a folder to open its context
 * menu, so the two menus never sit on top of each other. It dismisses on `click`
 * (not `mousedown` — folding the in-flow list on mousedown slides the row out from
 * under the cursor before mouseup), and a right-click never reaches the click phase,
 * so `contextmenu` is watched as well.
 *
 * Read-only: nothing is written, the picker is only opened and closed.
 *
 * Needs a running server and SYNAPMAIL_TEST_* (.env).
 *   node scripts/check-account-picker-dismiss.mjs
 *   node scripts/check-account-picker-dismiss.mjs --negative
 *
 * NEGATIVE CONTROL: `document.addEventListener('contextmenu', …)` is turned into a
 * no-op once the page is hydrated. React's own delegated listeners are registered at
 * hydration (the app router mounts on `document`), so they are already in place and
 * the folder menu still opens; the picker registers its dismiss in an effect when it
 * opens, so only that one is lost — exactly the shape before the fix. The bench MUST
 * see both menus open at once.
 */
import { readFileSync } from 'node:fs'
import puppeteer from 'puppeteer-core'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const NEGATIVE = process.argv.includes('--negative')
const SETTLE_MS = 500
const ACCOUNT_TRIGGER = '[data-sidebar-row="account"]'
const ACCOUNT_LIST = '[data-account-list]'
const FOLDER_ROW = '[data-sidebar-row^="folder:"]'
const MENU_SURFACE = '[data-context-menu-surface]'

for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
}
const { SYNAPMAIL_TEST_URL: BASE, SYNAPMAIL_TEST_EMAIL: EMAIL, SYNAPMAIL_TEST_PASSWORD: PASSWORD } = process.env
for (const [k, v] of Object.entries({ SYNAPMAIL_TEST_URL: BASE, SYNAPMAIL_TEST_EMAIL: EMAIL, SYNAPMAIL_TEST_PASSWORD: PASSWORD })) {
  if (!v) { console.error(`HARNESS: ${k} is not set`); process.exit(2) }
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'], protocolTimeout: 120000 })
const failures = []
const check = (label, ok, detail = '') => {
  if (ok) { console.log(`  ok   ${label}`); return }
  console.error(`  FAIL ${label}${detail ? `\n       ${detail}` : ''}`)
  failures.push(label)
}
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 900 })
  const hydrated = async selector => {
    await page.waitForSelector(selector, { timeout: 25000 })
    await page.waitForFunction(sel => {
      const el = document.querySelector(sel)
      return !!el && Object.keys(el).some(k => k.startsWith('__reactProps$'))
    }, { timeout: 25000 }, selector)
  }
  const centre = async selector => {
    await hydrated(selector)
    const box = await page.$eval(selector, el => {
      el.scrollIntoView({ block: 'center' })
      const r = el.getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height }
    })
    if (box.w === 0 || box.h === 0) { console.error(`HARNESS: ${selector} is rendered with a zero box`); process.exit(2) }
    return box
  }
  const settle = () => new Promise(r => setTimeout(r, SETTLE_MS))
  const pickerOpen = () => page.$eval(ACCOUNT_LIST, el => el.getAttribute('data-account-list-open') === 'true')
  const menuOpen = () => page.$(MENU_SURFACE).then(Boolean)

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
  if (!loggedIn) { console.error('HARNESS: login refused'); process.exit(2) }

  await page.goto(`${BASE}/mail`, { waitUntil: 'domcontentloaded' })
  await hydrated(ACCOUNT_TRIGGER)
  await hydrated(FOLDER_ROW)
  const disabled = await page.$eval(ACCOUNT_TRIGGER, el => el.disabled)
  if (disabled) { console.error('HARNESS: a single mailbox — the picker cannot open'); process.exit(2) }
  if (NEGATIVE) {
    await page.evaluate(() => {
      const add = document.addEventListener.bind(document)
      document.addEventListener = (type, ...rest) => (type === 'contextmenu' ? undefined : add(type, ...rest))
    })
  }

  // 1. Open the picker with a real click.
  const trigger = await centre(ACCOUNT_TRIGGER)
  await page.mouse.click(trigger.x, trigger.y)
  await settle()
  check('the picker opens on click', await pickerOpen())

  // 2. Right-click a folder row: its menu opens, the picker folds.
  const row = await centre(FOLDER_ROW)
  await page.mouse.click(row.x, row.y, { button: 'right' })
  await settle()
  const [menu, picker] = [await menuOpen(), await pickerOpen()]
  check('the folder context menu opens on right-click', menu)
  check('the picker is folded once the folder menu is open', !picker, picker ? 'both menus are open at once' : '')

  // 3. Escape closes the folder menu; the picker stays folded.
  await page.keyboard.press('Escape')
  await settle()
  check('Escape closes the folder menu', !(await menuOpen()))
  check('the picker stays folded afterwards', !(await pickerOpen()))
} finally {
  await browser.close()
}

if (NEGATIVE) {
  if (!failures.length) { console.error('\nnegative control: FAIL — the pre-fix shape stays green, the bench measures nothing'); process.exit(1) }
  console.log(`\nnegative control: OK — the bench sees the regression (${failures.length} failure(s))`)
  process.exit(0)
}
if (failures.length) { console.error(`\n${failures.length} failure(s)`); process.exit(1) }
console.log('\naccount picker dismiss: OK')
