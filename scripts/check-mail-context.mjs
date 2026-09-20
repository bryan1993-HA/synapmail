#!/usr/bin/env node
/**
 * Measures the enriched right-click menu with REAL right-clicks, REAL clicks and
 * REAL keystrokes:
 *  - right-click INSIDE a multi-selection keeps the whole selection (the menu
 *    acts on all of it) and greys Reply / Reply all, which target one message;
 *  - right-click OUTSIDE the selection selects that row alone first;
 *  - the menu stays inside the window when opened at the bottom-right corner;
 *  - it closes on ONE click outside, on Escape, and on a scroll;
 *  - rows carry `aria-selected` and the list a listbox/option role pair.
 *
 * Nothing is moved, deleted, flagged or sent: the bench only opens the menu and
 * reads state. Menu entries are never activated.
 *
 * Needs a running dev server and SYNAPMAIL_TEST_* credentials (see .env).
 *   node scripts/check-mail-context.mjs
 */
import { readFileSync } from 'node:fs'
import puppeteer from 'puppeteer-core'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const VIEWPORT = { width: 1440, height: 900 }
const SETTLE_MS = 400
// Opening a message fetches its body over IMAP: orders of magnitude slower than a re-render.
const OPEN_MS = 20000
// Enough rows to right-click inside a 2-row selection AND outside it.
const MIN_ROWS = 4

// Read from the shipped module so a rename there fails the bench instead of
// silently measuring an attribute nobody writes any more.
const MODULE_SRC = readFileSync(new URL('../lib/mailSelection.tsx', import.meta.url), 'utf8')
const COUNT_ATTR = MODULE_SRC.match(/MAIL_SELECTION_COUNT_ATTR = '([^']+)'/)?.[1]
if (!COUNT_ATTR) { console.error('HARNESS: could not read MAIL_SELECTION_COUNT_ATTR from lib/mailSelection.tsx'); process.exit(2) }

const LIST = `[${COUNT_ATTR}]`
const ROW = '[data-mail-row]'
// Proof that the reading pane rendered a message. Archive / delete / reply moved
// to the head bar, so the flag button is what remains inside the pane.
const PANE_ACTION = '[data-reading-flag]'
const MENU = '[data-mail-context-menu]'

for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
}
const { SYNAPMAIL_TEST_URL: BASE, SYNAPMAIL_TEST_EMAIL: EMAIL, SYNAPMAIL_TEST_PASSWORD: PASSWORD } = process.env
for (const [k, v] of Object.entries({ SYNAPMAIL_TEST_URL: BASE, SYNAPMAIL_TEST_EMAIL: EMAIL, SYNAPMAIL_TEST_PASSWORD: PASSWORD })) {
  if (!v) { console.error(`HARNESS: ${k} is not set`); process.exit(2) }
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] })
const failures = []
const fail = (msg) => { console.log(`FAIL ${msg}`); failures.push(msg) }
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

  await page.goto(`${BASE}/mail`, { waitUntil: 'networkidle2' })
  await page.waitForSelector(ROW, { timeout: 30000 })
  await new Promise(r => setTimeout(r, SETTLE_MS))

  const rowCount = await page.$$eval(ROW, els => els.length)
  console.log(`rows loaded: ${rowCount}`)
  if (rowCount < MIN_ROWS) { console.error(`HARNESS: only ${rowCount} rows loaded, need ${MIN_ROWS}`); process.exit(2) }

  const ACCEL = process.platform === 'darwin' ? 'Meta' : 'Control'
  const settle = () => new Promise(r => setTimeout(r, SETTLE_MS))
  const readCount = () => page.$eval(LIST, (el, attr) => Number(el.getAttribute(attr)), COUNT_ATTR)
  const row = async (i) => {
    const handle = (await page.$$(ROW))[i]
    if (!handle) { console.error(`HARNESS: row ${i} vanished`); process.exit(2) }
    return handle
  }
  const clickRow = async (i, modifier) => {
    const handle = await row(i)
    if (modifier) await page.keyboard.down(modifier)
    await handle.click()
    if (modifier) await page.keyboard.up(modifier)
    await settle()
  }
  const rightClickRow = async (i) => {
    const handle = await row(i)
    await handle.click({ button: 'right' })
    await settle()
  }
  const menuOpen = async () => (await page.$(MENU)) !== null
  // A button carries `disabled`; a submenu is a div made inert with a class.
  // The class test must be anchored: the enabled buttons literally contain the
  // string "disabled:pointer-events-none" (a Tailwind variant), so a plain
  // `includes` reports every entry disabled — the bench's own first defect.
  const menuItem = (key) => page.$eval(`${MENU} [data-menu-item="${key}"]`, el => ({
    present: true,
    disabled: el.disabled === true
      || el.getAttribute('aria-disabled') === 'true'
      || /(^|\s)pointer-events-none(\s|$)/.test(el.className),
  })).catch(() => ({ present: false, disabled: null }))
  const closeMenu = async () => { await page.keyboard.press('Escape'); await settle() }
  const clearSelection = async () => { await page.keyboard.press('Escape'); await settle() }

  // --- 1. Right-click INSIDE a multi-selection keeps it whole ---
  await clickRow(0, ACCEL)
  await clickRow(1, ACCEL)
  const before = await readCount()
  if (before !== 2) { console.error(`HARNESS: could not build a 2-row selection (got ${before})`); process.exit(2) }
  await rightClickRow(1)
  const inside = await readCount()
  console.log(`right-click inside selection: count=${inside} (expected 2), menu=${await menuOpen()}`)
  if (!(await menuOpen())) fail('right-click inside selection: no menu opened')
  if (inside !== 2) fail(`right-click inside selection: selection shrank to ${inside}, expected 2`)

  // On a selection > 1, Reply / Reply all target nothing sensible: they must be
  // disabled, while Forward (which handles many) stays available.
  for (const [key, wantDisabled] of [['reply', true], ['replyAll', true], ['forward', false]]) {
    const item = await menuItem(key)
    console.log(`  multi-selection ${key}: present=${item.present} disabled=${item.disabled} (expected disabled=${wantDisabled})`)
    if (!item.present) fail(`menu entry "${key}" is missing`)
    else if (item.disabled !== wantDisabled) fail(`menu entry "${key}" disabled=${item.disabled} on a 2-message selection, expected ${wantDisabled}`)
  }
  // The enrichment asked for: flag submenu, move submenu, spam, archive, delete.
  for (const key of ['flag', 'move', 'spam', 'archive', 'remove', 'markRead', 'markUnread']) {
    const item = await menuItem(key)
    if (!item.present && !['markRead', 'markUnread'].includes(key)) fail(`menu entry "${key}" is missing`)
    console.log(`  entry ${key}: present=${item.present}`)
  }
  // markRead / markUnread is a toggle: exactly ONE of the two is rendered.
  const readEntries = (await menuItem('markRead')).present + (await menuItem('markUnread')).present
  console.log(`  read toggle entries present: ${readEntries} (expected 1)`)
  if (readEntries !== 1) fail(`read/unread toggle rendered ${readEntries} entries, expected exactly 1`)

  // --- 2. Escape closes ---
  await closeMenu()
  console.log(`Escape closes menu: open=${await menuOpen()} (expected false)`)
  if (await menuOpen()) fail('Escape did not close the menu')

  // --- 3. Right-click OUTSIDE the selection selects that row alone ---
  await rightClickRow(3)
  const outside = await readCount()
  console.log(`right-click outside selection: count=${outside} (expected 1), menu=${await menuOpen()}`)
  if (!(await menuOpen())) fail('right-click outside selection: no menu opened')
  if (outside !== 1) fail(`right-click outside selection: selection holds ${outside}, expected 1`)
  // With ONE message targeted, Reply comes back.
  const replyOne = await menuItem('reply')
  console.log(`  single-selection reply: disabled=${replyOne.disabled} (expected false)`)
  if (replyOne.disabled) fail('menu entry "reply" stays disabled on a single-message selection')

  // --- 4. ONE click outside closes the menu AND reaches its target ---
  // The click lands on another row: after it, the menu is gone and the click was
  // not swallowed (the selection changed to that row, proving it was delivered).
  await clickRow(0, ACCEL)
  const afterOutsideClick = await menuOpen()
  const countAfter = await readCount()
  console.log(`one click outside: menu=${afterOutsideClick} (expected false) count=${countAfter}`)
  if (afterOutsideClick) fail('one click outside did not close the menu')
  if (countAfter === outside) fail(`the click that closed the menu was swallowed: selection still holds ${countAfter}`)

  await clearSelection()

  // --- 4b. A PLAIN click outside closes the menu, replaces the selection and opens ---
  // The right-click of point 3 leaves a 1-row selection behind. A bare click on
  // another row must behave like Finder: empty that selection and open the row,
  // not add to it — otherwise the menu makes the list unopenable until Escape.
  await rightClickRow(3)
  const beforePlain = await readCount()
  if (beforePlain !== 1) { console.error(`HARNESS: right-click left ${beforePlain} selected, expected 1`); process.exit(2) }
  await clickRow(0)
  const plainCount = await readCount()
  const plainMenu = await menuOpen()
  // Waited for, not polled: fetching the body is an IMAP round-trip, far longer
  // than SETTLE_MS, so a bare `$()` here would report a working open as a failure.
  const opened = await page.waitForSelector(PANE_ACTION, { timeout: OPEN_MS }).then(() => true, () => false)
  console.log(`plain click after right-click: menu=${plainMenu} (expected false) count=${plainCount} (expected 0) opened=${opened} (expected true)`)
  if (plainMenu) fail('a plain click did not close the context menu')
  if (plainCount > 1) fail(`a plain click accumulated instead of replacing: selection holds ${plainCount}, expected 0 or 1`)
  if (!opened) fail('a plain click after a right-click did not open the message')

  await clearSelection()

  // --- 5. The menu stays inside the window at its bottom-right-most row ---
  // The click must land ON a row, so the corner it aims at is the corner of the
  // lowest row still fully in view, not the window corner (the list is a narrow
  // column: a click at the window's right edge hits no row and opens no menu —
  // the bench's second defect). Measured against THIS run's viewport.
  const boxes = []
  for (const handle of await page.$$(ROW)) {
    const b = await handle.boundingBox()
    if (b && b.y + b.height <= VIEWPORT.height && b.y >= 0) boxes.push(b)
  }
  if (!boxes.length) { console.error('HARNESS: no row is fully in view to aim the corner click at'); process.exit(2) }
  const corner = boxes[boxes.length - 1]
  const clickAt = { x: Math.round(corner.x + corner.width - 3), y: Math.round(corner.y + corner.height - 3) }
  console.log(`corner click at (${clickAt.x},${clickAt.y}) in a ${VIEWPORT.width}x${VIEWPORT.height} window`)
  await page.mouse.click(clickAt.x, clickAt.y, { button: 'right' })
  await settle()
  if (!(await menuOpen())) {
    fail('right-click near the bottom-right corner opened no menu')
  } else {
    const rect = await page.$eval(MENU, el => { const r = el.getBoundingClientRect(); return { right: r.right, bottom: r.bottom, left: r.left, top: r.top } })
    const inView = rect.right <= VIEWPORT.width && rect.bottom <= VIEWPORT.height && rect.left >= 0 && rect.top >= 0
    console.log(`corner clamp: right=${Math.round(rect.right)}/${VIEWPORT.width} bottom=${Math.round(rect.bottom)}/${VIEWPORT.height} inView=${inView}`)
    if (!inView) fail(`menu overflows the window: right=${Math.round(rect.right)} bottom=${Math.round(rect.bottom)} for a ${VIEWPORT.width}x${VIEWPORT.height} window`)
  }

  // --- 6. Scrolling the list closes the menu ---
  if (await menuOpen()) {
    await page.$eval(LIST, el => { const s = el.querySelector('[role="listbox"]'); (s ?? el).scrollBy(0, 120) })
    await settle()
    console.log(`scroll closes menu: open=${await menuOpen()} (expected false)`)
    if (await menuOpen()) fail('scrolling the list did not close the menu')
  }
  await closeMenu()
  await clearSelection()

  // --- 7. Roles and aria-selected follow the real selection ---
  const listRole = await page.$eval(LIST, el => {
    const box = el.querySelector('[role="listbox"]')
    return { role: box?.getAttribute('role') ?? null, multi: box?.getAttribute('aria-multiselectable') ?? null }
  })
  console.log(`list role=${listRole.role} aria-multiselectable=${listRole.multi}`)
  if (listRole.role !== 'listbox') fail(`the list carries role="${listRole.role}", expected "listbox"`)

  await clickRow(0, ACCEL)
  await clickRow(2, ACCEL)
  const aria = await page.$$eval(ROW, els => els.map(el => ({ role: el.getAttribute('role'), sel: el.getAttribute('aria-selected') })))
  const selectedRows = aria.filter(a => a.sel === 'true').length
  const optionRows = aria.filter(a => a.role === 'option').length
  const count = await readCount()
  console.log(`aria: rows=${aria.length} role=option:${optionRows} aria-selected=true:${selectedRows} vs selection ${count}`)
  if (optionRows !== aria.length) fail(`${aria.length - optionRows} row(s) carry no role="option"`)
  if (selectedRows !== count) fail(`aria-selected marks ${selectedRows} row(s) while the selection holds ${count}`)
  await clearSelection()
} finally {
  await browser.close()
}

if (failures.length) {
  console.error(`\ncheck-mail-context: ${failures.length} failure(s)`)
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(1)
}
console.log('\ncheck-mail-context: OK')
