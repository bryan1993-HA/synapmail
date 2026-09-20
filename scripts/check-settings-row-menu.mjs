#!/usr/bin/env node
/**
 * Measures that Settings → Accounts no longer puts a bin on every row. Deletion moved
 * into a discreet "..." menu, the confirmation NAMES the mailbox, cancelling sends nothing,
 * and clicking the row opens the edit form.
 *
 * NOTHING IS EVER DELETED by this bench: every DELETE request is intercepted and aborted
 * before it leaves the browser, and the bench counts what it intercepted. A mailbox really
 * removed here would be a real mailbox lost.
 *
 * Fails (exit 1) on any mismatch. Exits 2 on a HARNESS error — a missing browser, an
 * unreachable server, a database with no mailbox — which says nothing about the product.
 *
 * Needs a running dev server and SYNAPMAIL_TEST_* credentials (see .env).
 *   node scripts/check-settings-row-menu.mjs
 */
import { existsSync, readFileSync } from 'node:fs'
import puppeteer from 'puppeteer-core'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const VIEWPORT = { width: 1440, height: 900 }
// Height of an account row before this lot, measured on the delivered screen: avatar `md`
// plus `p-4` above and below. The lot must not make the row grow — the menu replaces three
// buttons with one, so anything taller means the row wrapped onto a second line.
const ROW_HEIGHT_PX = 68
// Rounding of `getBoundingClientRect` plus sub-pixel borders. Not a licence to drift: one
// wrapped line would add ~20 px, far outside this.
const ROW_HEIGHT_TOLERANCE_PX = 2
const SETTLE_MS = 400

for (const file of ['../.env', '../.env.local']) {
  const path = new URL(file, import.meta.url)
  if (!existsSync(path)) continue
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
  }
}
const {
  SYNAPMAIL_TEST_URL: BASE, SYNAPMAIL_TEST_EMAIL: EMAIL, SYNAPMAIL_TEST_PASSWORD: PASSWORD,
} = process.env
for (const [k, v] of Object.entries({
  SYNAPMAIL_TEST_URL: BASE, SYNAPMAIL_TEST_EMAIL: EMAIL, SYNAPMAIL_TEST_PASSWORD: PASSWORD,
})) {
  if (!v) { console.error(`HARNESS: ${k} is not set`); process.exit(2) }
}

const failures = []
const ok = msg => console.log(`ok   ${msg}`)
const fail = msg => { failures.push(msg); console.log(`FAIL ${msg}`) }
const check = (cond, msg) => (cond ? ok(msg) : fail(msg))

const settle = () => new Promise(r => setTimeout(r, SETTLE_MS))

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] })
  .catch(e => { console.error(`HARNESS: cannot launch Chrome — ${e.message}`); process.exit(2) })

/** Every DELETE the page tried to send. None of them ever reached the server. */
const blockedDeletes = []
/** Every confirmation text the page raised, in order. */
const confirmations = []
/** What the next confirmation answers — `false` is the default, so a bench that forgets to
 *  arm an acceptance still cannot destroy anything. */
let acceptNextConfirm = false
let page

try {
  page = await browser.newPage()
  await page.setViewport(VIEWPORT)

  await page.setRequestInterception(true)
  page.on('request', req => {
    if (req.method() === 'DELETE') {
      blockedDeletes.push(new URL(req.url()).pathname)
      // `abort`, not `respond`: nothing reaches the server, so no real mailbox, key or
      // share can be removed by this bench, whatever the product asks for.
      req.abort('failed').catch(() => {})
      return
    }
    req.continue().catch(() => {})
  })
  page.on('dialog', async dialog => {
    confirmations.push(dialog.message())
    await (acceptNextConfirm ? dialog.accept() : dialog.dismiss())
  })

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2' })
  const loggedIn = await page.evaluate(async ({ base, email, password }) => {
    const { csrfToken } = await (await fetch(`${base}/api/auth/csrf`)).json()
    const res = await fetch(`${base}/api/auth/callback/credentials`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ csrfToken, email, password, json: 'true' }),
    })
    return res.ok
  }, { base: BASE, email: EMAIL, password: PASSWORD })
  if (!loggedIn) { console.error('HARNESS: credentials login failed'); process.exit(2) }

  const accounts = (await page.evaluate(async base =>
    (await (await fetch(`${base}/api/accounts`)).json()).data ?? [], BASE)).filter(a => !a.isShared)
  if (accounts.length === 0) { console.error('HARNESS: this database has no owned mailbox'); process.exit(2) }
  const target = accounts[0]

  const openList = async () => {
    await page.goto(`${BASE}/settings/accounts`, { waitUntil: 'networkidle2' })
    await page.waitForSelector(`[data-row-menu="${target.id}"]`, { timeout: 20000 })
    await settle()
  }
  await openList()

  // ── 1. No bin on the screen at rest ────────────────────────────────────────
  // `lucide-react` renders each icon as an `<svg class="lucide-trash-2">`; a bin drawn
  // anywhere on the resting screen is exactly what this lot removes.
  // Scoped to `[data-settings-page]`: the sidebar's own bin is the Trash FOLDER, which
  // this lot does not touch. Counting it would accuse the settings screen of a bin it
  // does not draw.
  const restingBins = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-settings-page] svg')).filter(s => {
      if (!/trash/i.test(s.getAttribute('class') ?? '')) return false
      const box = s.getBoundingClientRect()
      return box.width > 0 && box.height > 0
    }).length)
  check(restingBins === 0, `no bin icon is drawn on the resting settings panel — found ${restingBins}`)

  const destructiveAtRest = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-account-row] *')).filter(el =>
      /text-destructive/.test(el.getAttribute('class') ?? '')).length)
  check(destructiveAtRest === 0, `no permanent red on an account row — found ${destructiveAtRest} destructive-coloured elements`)

  // ── 2. The row keeps its height ────────────────────────────────────────────
  const rowHeight = await page.$eval(`[data-account-row="${target.id}"]`, el => el.getBoundingClientRect().height)
  check(Math.abs(rowHeight - ROW_HEIGHT_PX) <= ROW_HEIGHT_TOLERANCE_PX,
    `account row still ${ROW_HEIGHT_PX} px tall — measured ${rowHeight.toFixed(1)} px`)

  // ── 3. The trigger announces itself ────────────────────────────────────────
  const trigger = await page.$eval(`[data-row-menu="${target.id}"]`, el => ({
    haspopup: el.getAttribute('aria-haspopup'),
    expanded: el.getAttribute('aria-expanded'),
    label: el.getAttribute('aria-label'),
    tabbable: el.tabIndex >= 0 && !el.disabled,
  }))
  check(trigger.haspopup === 'menu' && trigger.expanded === 'false',
    `the "..." button announces a menu and starts closed — aria-haspopup="${trigger.haspopup}", aria-expanded="${trigger.expanded}"`)
  check(Boolean(trigger.label) && trigger.label.includes(target.name || target.email),
    `the "..." button names its row — aria-label="${trigger.label}"`)
  check(trigger.tabbable, 'the "..." button is reachable with Tab')

  // ── 4. The menu opens with the expected entries ────────────────────────────
  await page.click(`[data-row-menu="${target.id}"]`)
  await settle()
  const entries = await page.$$eval(`[data-row-menu-surface="${target.id}"] [data-menu-item]`,
    els => els.map(el => ({ key: el.dataset.menuItem, danger: /text-destructive/.test(el.className) })))
  check(entries.map(e => e.key).join(',') === 'share,edit,delete',
    `the menu offers Share, Edit then Delete, in that order — got "${entries.map(e => e.key).join(',')}"`)
  check(entries.at(-1)?.danger === true && entries.slice(0, -1).every(e => !e.danger),
    'only the last entry is red, and only while the menu is open')
  const expandedWhileOpen = await page.$eval(`[data-row-menu="${target.id}"]`, el => el.getAttribute('aria-expanded'))
  check(expandedWhileOpen === 'true', `the trigger reports the menu open — aria-expanded="${expandedWhileOpen}"`)

  // ── 5. Escape closes and gives the focus back ──────────────────────────────
  await page.keyboard.press('Escape')
  await settle()
  const afterEscape = await page.evaluate(id => ({
    surface: document.querySelector(`[data-row-menu-surface="${id}"]`) !== null,
    focused: document.activeElement?.dataset?.rowMenu ?? null,
  }), target.id)
  check(!afterEscape.surface, 'Escape closes the menu')
  check(afterEscape.focused === target.id, `Escape gives the focus back to the "..." button — focus is on ${afterEscape.focused}`)

  // ── 6. Deleting: the confirmation names the mailbox, cancelling sends nothing ─
  const deletesBefore = blockedDeletes.length
  acceptNextConfirm = false
  await page.click(`[data-row-menu="${target.id}"]`)
  await settle()
  await page.click(`[data-row-menu-surface="${target.id}"] [data-menu-item="delete"]`)
  await settle()
  const cancelled = confirmations.at(-1) ?? ''
  check(cancelled.includes(target.email),
    `the confirmation names the mailbox — "${cancelled.slice(0, 90)}..."`)
  check(cancelled.length > target.email.length + 20,
    'the confirmation states the consequence, not just the question')
  check(blockedDeletes.length === deletesBefore,
    `cancelling sends no request — ${blockedDeletes.length - deletesBefore} DELETE attempted`)

  // Accepting: exactly ONE DELETE, on the right id. It is intercepted, so the mailbox lives.
  acceptNextConfirm = true
  await page.click(`[data-row-menu="${target.id}"]`)
  await settle()
  await page.click(`[data-row-menu-surface="${target.id}"] [data-menu-item="delete"]`)
  await settle()
  acceptNextConfirm = false
  const sent = blockedDeletes.slice(deletesBefore)
  check(sent.length === 1 && sent[0] === `/api/accounts/${target.id}`,
    `accepting sends exactly one DELETE, on the right mailbox — ${JSON.stringify(sent)}`)

  // The mailbox is still there: the interception held.
  const stillThere = await page.evaluate(async ({ base, id }) =>
    ((await (await fetch(`${base}/api/accounts`)).json()).data ?? []).some(a => a.id === id),
    { base: BASE, id: target.id })
  check(stillThere, 'the mailbox still exists — the bench destroyed nothing')

  // ── 7. Clicking the row opens the edit form ────────────────────────────────
  await openList()
  await page.click(`[data-account-row="${target.id}"] [data-account-badge="${target.id}"]`)
  await settle()
  const opened = await page.evaluate(() => ({
    form: document.querySelector('input[name="email"], form') !== null,
    stillList: document.querySelector('[data-account-row]') !== null,
  }))
  check(opened.form && !opened.stillList, 'clicking the row opens the edit form')

  // ── 8. The controls on the row keep their own action ───────────────────────
  await openList()
  const guardBefore = await page.$eval(`[data-prompt-guard="${target.id}"] button`, el => el.getAttribute('aria-checked'))
  await page.click(`[data-prompt-guard="${target.id}"] button`)
  await settle()
  const stayedOnList = await page.evaluate(() => document.querySelector('[data-account-row]') !== null)
  check(stayedOnList, 'clicking the guard switch does not open the edit form')
  // Put the switch back where it was, so the bench leaves the mailbox as it found it.
  await page.click(`[data-prompt-guard="${target.id}"] button`).catch(() => {})
  await settle()
  const guardAfter = await page.$eval(`[data-prompt-guard="${target.id}"] button`, el => el.getAttribute('aria-checked'))
  check(guardAfter === guardBefore, `the guard switch is back where it was — ${guardBefore} then ${guardAfter}`)
} catch (e) {
  console.error(`HARNESS: ${e.stack}`)
  process.exit(2)
} finally {
  await browser.close().catch(() => {})
}

console.log(`intercepted DELETE requests (none reached the server): ${JSON.stringify(blockedDeletes)}`)
console.log(failures.length ? `check-settings-row-menu: ${failures.length} FAIL` : 'check-settings-row-menu: OK')
process.exit(failures.length ? 1 : 0)
