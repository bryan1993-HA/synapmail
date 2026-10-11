#!/usr/bin/env node
/**
 * PR-29 follow-up, measured on the running app: the mail toolbar's « … » menu lists
 * ONLY the groups that actually left the bar. At a width where some groups still
 * fit inline, the menu must not repeat them; at every width, inline + menu = the
 * declared groups, each action exactly once.
 *
 * The fold points are measured by the component, never hard-coded, so this bench
 * walks the viewport down from wide to narrow and asserts every distinct state it
 * finds, requiring at least one PARTIAL one (some groups inline, some in the menu —
 * the state the bug lived in). Whether everything fits at the widest width is the
 * layout's business, not this bench's.
 *
 * Read-only: the menu is only opened and closed.
 *
 * Needs a running server and SYNAPMAIL_TEST_* (.env).
 *   node scripts/check-toolbar-overflow.mjs
 *   node scripts/check-toolbar-overflow.mjs --negative
 *
 * NEGATIVE CONTROL: the overflow menu's rows are replaced, after hydration and on
 * every open, by one row per declared action (a MutationObserver re-injects them) —
 * the "list every group" shape the menu had before the fix. The bench MUST see
 * duplicated actions in the partial state.
 */
import { readFileSync } from 'node:fs'
import puppeteer from 'puppeteer-core'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const NEGATIVE = process.argv.includes('--negative')
const SETTLE_MS = 500
const MORE = '[data-mail-toolbar-more]'
const MORE_MENU = '[data-mail-toolbar-more-menu]'
const ACTION = 'header [data-mail-action]'
// From the widest desktop the header gate uses down to the mobile one, in steps
// small enough that no fold point of a 32 px button group is skipped over.
const WIDEST = 1440
const NARROWEST = 390
const STEP_PX = 20

// The declared order is READ from the shared constant, never retyped here.
const SELECTION_SRC = readFileSync(new URL('../lib/mailSelection.tsx', import.meta.url), 'utf8')
const GROUPS_SRC = SELECTION_SRC.slice(
  SELECTION_SRC.indexOf('MAIL_TOOLBAR_GROUPS'),
  SELECTION_SRC.indexOf('] as const', SELECTION_SRC.indexOf('MAIL_TOOLBAR_GROUPS')))
const TOOLBAR_ORDER = [...GROUPS_SRC.matchAll(/action:\s*'(\w+)'/g)].map(m => m[1])
if (TOOLBAR_ORDER.length < 2) { console.error('HARNESS: could not read MAIL_TOOLBAR_GROUPS'); process.exit(2) }

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
  await page.setViewport({ width: WIDEST, height: 900 })
  const settle = () => new Promise(r => setTimeout(r, SETTLE_MS))

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
  await page.waitForSelector(ACTION, { timeout: 25000 })
  await page.waitForFunction(sel => {
    const el = document.querySelector(sel)
    return !!el && Object.keys(el).some(k => k.startsWith('__reactProps$'))
  }, { timeout: 25000 }, ACTION)
  await settle()

  if (NEGATIVE) {
    await page.evaluate(order => {
      const refill = box => {
        if (box.dataset.negativeFilled) return
        box.dataset.negativeFilled = '1'
        box.replaceChildren(...order.map(a => {
          const b = document.createElement('button')
          b.dataset.mailAction = a
          b.textContent = a
          return b
        }))
      }
      new MutationObserver(() => document.querySelectorAll('[data-mail-toolbar-more-menu]').forEach(refill))
        .observe(document.body, { childList: true, subtree: true })
    }, TOOLBAR_ORDER)
  }

  /** What the header shows at the current width: inline actions, and the menu's, if any. */
  const snapshot = async () => {
    const more = await page.$(MORE)
    if (more) { await more.click(); await settle() }
    const s = await page.evaluate(({ action, menu }) => {
      const box = document.querySelector(menu)
      const all = [...document.querySelectorAll(action)]
      return {
        inline: all.filter(b => !box || !box.contains(b)).map(b => b.dataset.mailAction),
        menu: box ? [...box.querySelectorAll('[data-mail-action]')].map(b => b.dataset.mailAction) : null,
      }
    }, { action: ACTION, menu: MORE_MENU })
    if (more) { await page.keyboard.press('Escape'); await settle() }
    return s
  }

  const states = []
  let prev = ''
  for (let width = WIDEST; width >= NARROWEST; width -= STEP_PX) {
    await page.setViewport({ width, height: 900 })
    await settle()
    const s = await snapshot()
    const key = `${s.inline.join(',')}|${(s.menu ?? []).join(',')}`
    if (key === prev) continue
    prev = key
    states.push({ width, ...s })
    console.log(`  ${width}px: inline=[${s.inline.join(',')}] menu=${s.menu ? `[${s.menu.join(',')}]` : 'none'}`)
  }

  // Every distinct state: the declared actions, each exactly once, split between the bar and the menu.
  for (const s of states) {
    const seen = [...s.inline, ...(s.menu ?? [])]
    const dupes = seen.filter((a, i) => seen.indexOf(a) !== i)
    check(`${s.width}px: no action is both inline and in the menu`, dupes.length === 0, dupes.length ? `duplicated: ${[...new Set(dupes)].join(',')}` : '')
    check(`${s.width}px: inline + menu = the declared actions, in order`,
      seen.join(',') === TOOLBAR_ORDER.join(','), `got ${seen.join(',')}, declared ${TOOLBAR_ORDER.join(',')}`)
  }
  const partial = states.filter(s => s.menu && s.menu.length && s.inline.length)
  check('at least one width has some groups inline AND some in the menu', partial.length > 0,
    'the walk never saw a partial fold — the bug\'s own state was not measured')
  // In the partial state the menu lists strictly fewer actions than declared.
  for (const s of partial)
    check(`${s.width}px: the menu lists only the overflowed part (${s.menu.length} < ${TOOLBAR_ORDER.length})`, s.menu.length < TOOLBAR_ORDER.length)
} finally {
  await browser.close()
}

if (NEGATIVE) {
  if (!failures.length) { console.error('\nnegative control: FAIL — the pre-fix shape stays green, the bench measures nothing'); process.exit(1) }
  console.log(`\nnegative control: OK — the bench sees the regression (${failures.length} failure(s))`)
  process.exit(0)
}
if (failures.length) { console.error(`\n${failures.length} failure(s)`); process.exit(1) }
console.log('\ntoolbar overflow menu: OK')
