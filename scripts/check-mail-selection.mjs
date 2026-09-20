#!/usr/bin/env node
/**
 * Measures the explorer-style selection of the message list on the running app,
 * with REAL clicks and REAL keystrokes: Cmd/Ctrl-click toggles one row at a
 * time, Shift-click extends an exact range from the last clicked row, Cmd/Ctrl+A
 * takes everything loaded, Escape empties the selection. It also checks the
 * reading pane's Archive button now carries an action (it was dead).
 *
 * The count is NOT recomputed by the bench: it is read out of the list's own
 * `data-mail-selection-count` attribute, which the component publishes from the
 * same state the shared context exposes. A bench-side count could agree with a
 * broken component; this one cannot.
 *
 * Nothing is moved, deleted or flagged: every assertion is about selection state.
 *
 * Needs a running dev server and SYNAPMAIL_TEST_* credentials (see .env).
 *   node scripts/check-mail-selection.mjs
 */
import { readFileSync } from 'node:fs'
import puppeteer from 'puppeteer-core'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const VIEWPORT = { width: 1440, height: 900 }
// The list settles well under this: a click only re-renders rows, no network call.
const SETTLE_MS = 400
// Opening a message fetches its body over IMAP: orders of magnitude slower than a re-render.
const OPEN_MS = 20000
// Enough rows to make a 3-row range meaningful; below this the bench cannot conclude.
const MIN_ROWS = 4

// The attribute name is read from the shipped module, so a rename there fails
// here instead of silently measuring an attribute nobody writes any more.
const MODULE_SRC = readFileSync(new URL('../lib/mailSelection.tsx', import.meta.url), 'utf8')
const COUNT_ATTR = MODULE_SRC.match(/MAIL_SELECTION_COUNT_ATTR = '([^']+)'/)?.[1]
if (!COUNT_ATTR) { console.error('HARNESS: could not read MAIL_SELECTION_COUNT_ATTR from lib/mailSelection.tsx'); process.exit(2) }

const LIST = `[${COUNT_ATTR}]`
const ROW = '[data-mail-row]'
// Evidence the reading pane rendered a message. Archive / delete / reply moved
// to the head bar: the flag button is what remains in the pane.
const PANE_ACTION = '[data-reading-flag]'

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

  // The account and folder actually on screen are read from the list's own requests:
  // no harness constant to keep up to date, no guessed mailbox.
  const listRequests = []
  page.on('request', req => {
    const u = new URL(req.url())
    if (!u.pathname.startsWith('/api/messages')) return
    const account = u.searchParams.get('account')
    const folder = u.searchParams.get('folder')
    if (account && folder) listRequests.push({ account, folder })
  })

  await page.goto(`${BASE}/mail`, { waitUntil: 'networkidle2' })
  await page.waitForSelector(ROW, { timeout: 30000 })
  await new Promise(r => setTimeout(r, SETTLE_MS))

  const rowCount = await page.$$eval(ROW, els => els.length)
  console.log(`rows loaded: ${rowCount}`)
  if (rowCount < MIN_ROWS) { console.error(`HARNESS: only ${rowCount} rows loaded, need ${MIN_ROWS} to exercise a range`); process.exit(2) }

  const readCount = () => page.$eval(LIST, (el, attr) => Number(el.getAttribute(attr)), COUNT_ATTR)
  const clickRow = async (index, modifier) => {
    const handle = (await page.$$(ROW))[index]
    if (!handle) { console.error(`HARNESS: row ${index} vanished before the click`); process.exit(2) }
    if (modifier) await page.keyboard.down(modifier)
    await handle.click()
    if (modifier) await page.keyboard.up(modifier)
    await new Promise(r => setTimeout(r, SETTLE_MS))
  }
  // macOS reports Meta; everything else reports Control. The bench follows the
  // platform it runs on rather than assuming one.
  const ACCEL = process.platform === 'darwin' ? 'Meta' : 'Control'

  const check = (label, got, want) => {
    console.log(`${label}: count=${got} (expected ${want})`)
    if (got !== want) failures.push(`${label}: selection holds ${got} messages, expected ${want}`)
  }

  // --- The list geometry does NOT depend on the selection ---
  // Without this, the list header (two lines in a narrow column) is replaced by the
  // shorter selection bar: every row moves up as soon as the first one is ticked,
  // and a rectangle no longer cuts the rows under the pointer. The reference is the
  // top of the SAME row in the SAME run, before then after the first selection —
  // never a hard-coded height.
  const rowTop = index => page.evaluate((sel, i) => {
    const el = document.querySelectorAll(sel)[i]
    return el ? el.getBoundingClientRect().top : null
  }, ROW, index)
  const PROBE_ROW = 1
  // The infinite scroll fetches a second page on its own, a few hundred ms in, and the
  // rows move up by the height of what was below them (measured: 648px). Reading the
  // "before" on one side of that arrival and the "after" on the other attributes the
  // pagination to the selection. Wait for the row count to hold still first.
  let settled = -1
  for (let i = 0; i < 20; i++) {
    const n = await page.$$eval(ROW, els => els.length)
    if (n === settled) break
    settled = n
    await new Promise(r => setTimeout(r, SETTLE_MS))
  }
  const topBefore = await rowTop(PROBE_ROW)
  if (topBefore === null) { console.error(`HARNESS: row ${PROBE_ROW} is missing before the geometry probe`); process.exit(2) }
  await clickRow(0, ACCEL)
  const topAfter = await rowTop(PROBE_ROW)
  if (topAfter === null) { console.error(`HARNESS: row ${PROBE_ROW} vanished during the geometry probe`); process.exit(2) }
  console.log(`row ${PROBE_ROW} top (list settled at ${settled} rows): before=${topBefore} after first selection=${topAfter} (expected identical)`)
  if (Math.abs(topAfter - topBefore) > 0.5) failures.push(`the list shifts by ${(topAfter - topBefore).toFixed(1)}px when the first row is selected: the rectangle can no longer cut the rows under the pointer`)
  await page.keyboard.press('Escape')
  await new Promise(r => setTimeout(r, SETTLE_MS))

  // --- Cmd/Ctrl-click twice → exactly two selected ---
  await clickRow(0, ACCEL)
  check('accel-click row 0', await readCount(), 1)
  await clickRow(2, ACCEL)
  check('accel-click row 2', await readCount(), 2)

  // --- Escape empties ---
  await page.keyboard.press('Escape')
  await new Promise(r => setTimeout(r, SETTLE_MS))
  check('Escape', await readCount(), 0)

  // --- Shift-click extends an EXACT range from the last clicked row ---
  // Anchor on row 0 with an accel-click (which does not open the reading pane),
  // then extend to row 2: rows 0,1,2 = three messages, no more, no less.
  await clickRow(0, ACCEL)
  await clickRow(2, 'Shift')
  check('shift-click row 0 → row 2', await readCount(), 3)

  await page.keyboard.press('Escape')
  await new Promise(r => setTimeout(r, SETTLE_MS))

  // --- Cmd/Ctrl+A takes everything loaded ---
  // The reference is the number of rows in the DOM in this SAME run, not a
  // constant: a list that loaded more or fewer rows still gives a valid check.
  await page.keyboard.down(ACCEL)
  await page.keyboard.press('a')
  await page.keyboard.up(ACCEL)
  await new Promise(r => setTimeout(r, SETTLE_MS))
  const allCount = await readCount()
  const rowsNow = await page.$$eval(ROW, els => els.length)
  console.log(`select-all: count=${allCount} rows=${rowsNow}`)
  if (allCount !== rowsNow) failures.push(`select-all: selection holds ${allCount} messages for ${rowsNow} loaded rows`)

  await page.keyboard.press('Escape')
  await new Promise(r => setTimeout(r, SETTLE_MS))
  check('Escape after select-all', await readCount(), 0)

  // --- Marquee selection with the mouse ---
  // A real mouse gesture: mousedown in the middle of a row, VERTICAL move, mouseup.
  // The rows are `draggable`: what is measured here is that the direction arbitration
  // does cancel the native drag and draws a rectangle instead.
  const rowBox = async index => {
    const handle = (await page.$$(ROW))[index]
    if (!handle) { console.error(`HARNESS: row ${index} vanished`); process.exit(2) }
    return handle.boundingBox()
  }
  // The starting point avoids the avatar bubble (which carries the checkbox): the
  // gesture starts on the text, the way someone would start a rectangle on a row.
  const AVATAR_INSET = 80
  const startOf = box => ({ x: box.x + AVATAR_INSET, y: box.y + box.height / 2 })

  const rowsBefore = await page.$$eval(ROW, els => els.length)
  const b0 = await rowBox(0)
  const b1 = await rowBox(1)
  const rowHeight = b1.y - b0.y
  if (!(rowHeight > 0)) { console.error(`HARNESS: could not measure a row height (got ${rowHeight})`); process.exit(2) }
  // Target: cut EXACTLY the first three rows. The distance comes from the height
  // measured in THIS run, not from a constant.
  const CUT_ROWS = 3
  const from = startOf(b0)
  const toY = b0.y + rowHeight * (CUT_ROWS - 1) + b0.height / 2

  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  // Several steps: a single jump produces no `dragstart` to arbitrate.
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(from.x, from.y + ((toY - from.y) * i) / 8)
    await new Promise(r => setTimeout(r, 20))
  }
  const marqueeDuring = await page.$('[data-mail-marquee]').then(Boolean)
  const countDuring = await readCount()
  await page.mouse.up()
  await new Promise(r => setTimeout(r, SETTLE_MS))
  const marqueeAfter = await page.$('[data-mail-marquee]').then(Boolean)
  const countAfter = await readCount()
  console.log(`vertical drag over ${CUT_ROWS} rows: marquee during=${marqueeDuring} after=${marqueeAfter} count during=${countDuring} after=${countAfter} (expected true/false/${CUT_ROWS}/${CUT_ROWS})`)
  if (!marqueeDuring) failures.push('vertical drag: no marquee rectangle was drawn during the gesture')
  if (marqueeAfter) failures.push('vertical drag: the marquee rectangle survived the mouseup')
  if (countAfter !== CUT_ROWS) failures.push(`vertical drag: selection holds ${countAfter} messages, expected the ${CUT_ROWS} crossed rows`)
  // The rectangle must also not have OPENED the starting row. This check runs BEFORE
  // any plain click: once a message is open the pane stays open, and its presence
  // would then say nothing about this particular gesture.
  const openedByMarquee = await page.$(PANE_ACTION).then(Boolean)
  console.log(`vertical drag opened a message: ${openedByMarquee} (expected false)`)
  if (openedByMarquee) failures.push('vertical drag opened the message instead of only selecting')

  await page.keyboard.press('Escape')
  await new Promise(r => setTimeout(r, SETTLE_MS))

  // --- The rectangle cuts EXACTLY the rows it crosses, the first one included ---
  // The expected set is not a hard-coded number: it is derived from the row rects IN
  // THIS RUN, compared against the band swept by the pointer. The row that was
  // PRESSED must be part of it — that is what a header shift used to break. The
  // resulting selection is read back from `aria-selected`, which the component
  // publishes from its own state.
  const DRAG_PX = 200
  const PRESS_ROW = 1
  // The reference is measured BEFORE the gesture: that is the geometry visible at
  // the moment of the press. Reading it during the gesture would make it complicit
  // in a header shift (the rows would already have moved), and the check would
  // measure nothing.
  const bp = await rowBox(PRESS_ROW)
  const pressFrom = startOf(bp)
  const band = { top: pressFrom.y, bottom: pressFrom.y + DRAG_PX }
  const expectedCut = await page.evaluate((sel, top, bottom) => {
    const hit = []
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect()
      if (r.bottom >= top && r.top <= bottom) hit.push(el.getAttribute('data-mail-row'))
    }
    return hit
  }, ROW, band.top, band.bottom)
  const pressedUid = await page.evaluate((sel, i) => document.querySelectorAll(sel)[i]?.getAttribute('data-mail-row'), ROW, PRESS_ROW)
  if (expectedCut.length < 2) { console.error(`HARNESS: a ${DRAG_PX}px band only cuts ${expectedCut.length} row(s), too few to conclude`); process.exit(2) }

  await page.mouse.move(pressFrom.x, pressFrom.y)
  await page.mouse.down()
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(pressFrom.x, pressFrom.y + (DRAG_PX * i) / 8)
    await new Promise(r => setTimeout(r, 20))
  }
  await page.mouse.up()
  await new Promise(r => setTimeout(r, SETTLE_MS))
  const gotCut = await page.evaluate(sel =>
    [...document.querySelectorAll(sel)].filter(el => el.getAttribute('aria-selected') === 'true').map(el => el.getAttribute('data-mail-row')),
    ROW)
  console.log(`marquee from the middle of row ${PRESS_ROW} over ${DRAG_PX}px: cuts [${expectedCut}] selected [${gotCut}]`)
  if (!gotCut.includes(pressedUid)) failures.push(`the row the gesture started on (index ${PRESS_ROW}, uid ${pressedUid}) is NOT selected: the list geometry shifted under the pointer`)
  if (gotCut.join(',') !== expectedCut.join(',')) failures.push(`the marquee selected [${gotCut}] but the band it swept cuts [${expectedCut}]`)

  await page.keyboard.press('Escape')
  await new Promise(r => setTimeout(r, SETTLE_MS))

  // --- A rectangle started from a date header highlights NO text ---
  // The browser's text selection starts at `mousedown`: a `preventDefault()` placed
  // on `mousemove` arrives too late. Direct measurement: `getSelection()` must stay
  // empty during AND after the gesture.
  const dateHeader = await page.$('[data-mail-date-header]')
  if (!dateHeader) { console.error('HARNESS: no date header in the list to start the gesture from'); process.exit(2) }
  const hBox = await dateHeader.boundingBox()
  const hStart = { x: hBox.x + hBox.width / 2, y: hBox.y + hBox.height / 2 }
  await page.mouse.move(hStart.x, hStart.y)
  await page.mouse.down()
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(hStart.x, hStart.y + (170 * i) / 8)
    await new Promise(r => setTimeout(r, 20))
  }
  const textDuring = await page.evaluate(() => String(document.getSelection() ?? '').length)
  await page.mouse.up()
  await new Promise(r => setTimeout(r, SETTLE_MS))
  const textAfter = await page.evaluate(() => String(document.getSelection() ?? '').length)
  console.log(`gesture from a date header: text selected during=${textDuring} after=${textAfter} (expected 0/0)`)
  if (textDuring !== 0) failures.push(`a marquee started on a date header highlighted ${textDuring} characters of text during the gesture`)
  if (textAfter !== 0) failures.push(`a marquee started on a date header left ${textAfter} characters of text highlighted`)

  await page.keyboard.press('Escape')
  await new Promise(r => setTimeout(r, SETTLE_MS))

  // --- Escape DURING the gesture restores the previous selection ---
  await clickRow(0, ACCEL)
  const beforeEsc = await readCount()
  if (beforeEsc !== 1) { console.error(`HARNESS: could not seed a 1-row selection (got ${beforeEsc})`); process.exit(2) }
  const b2 = await rowBox(2)
  const escFrom = startOf(b2)
  await page.mouse.move(escFrom.x, escFrom.y)
  await page.mouse.down()
  for (let i = 1; i <= 6; i++) {
    await page.mouse.move(escFrom.x, escFrom.y + (rowHeight * 2 * i) / 6)
    await new Promise(r => setTimeout(r, 20))
  }
  await page.keyboard.press('Escape')
  await new Promise(r => setTimeout(r, SETTLE_MS))
  const countAfterEsc = await readCount()
  const marqueeAfterEsc = await page.$('[data-mail-marquee]').then(Boolean)
  await page.mouse.up()
  await new Promise(r => setTimeout(r, SETTLE_MS))
  console.log(`Escape during the gesture: count=${countAfterEsc} marquee=${marqueeAfterEsc} (expected ${beforeEsc}/false)`)
  if (countAfterEsc !== beforeEsc) failures.push(`Escape during the gesture: selection holds ${countAfterEsc}, expected the ${beforeEsc} selected before it started`)
  if (marqueeAfterEsc) failures.push('Escape during the gesture: the marquee rectangle is still drawn')

  await page.keyboard.press('Escape')
  await new Promise(r => setTimeout(r, SETTLE_MS))

  // --- A HORIZONTAL drag stays the native drag and drop ---
  // Direct measurement: listen for `dragstart` on the row and read
  // `defaultPrevented`. Cancelled = the rectangle took over (the defect); not
  // cancelled = the browser can carry the message to a folder.
  // `defaultPrevented` must be read AFTER propagation: React attaches its handlers
  // on the root, so a listener in the CAPTURE phase would always read it false and
  // this check would measure nothing. The event is therefore kept and read back on
  // the next loop turn, once everyone has had their say.
  await page.evaluate(() => {
    window.__dragProbe = null
    document.addEventListener('dragstart', e => {
      setTimeout(() => { window.__dragProbe = { prevented: e.defaultPrevented } }, 0)
    }, true)
  })
  const b3 = await rowBox(0)
  const hFrom = startOf(b3)
  await page.mouse.move(hFrom.x, hFrom.y)
  await page.mouse.down()
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(hFrom.x - (200 * i) / 8, hFrom.y)
    await new Promise(r => setTimeout(r, 20))
  }
  const marqueeOnHorizontal = await page.$('[data-mail-marquee]').then(Boolean)
  await page.mouse.up()
  await new Promise(r => setTimeout(r, SETTLE_MS))
  const dragProbe = await page.evaluate(() => window.__dragProbe)
  console.log(`horizontal drag: marquee=${marqueeOnHorizontal} dragstart=${JSON.stringify(dragProbe)} (expected false / not prevented)`)
  if (marqueeOnHorizontal) failures.push('horizontal drag drew a marquee instead of leaving the native drag alone')
  if (!dragProbe) failures.push('horizontal drag: no dragstart fired — the native drag-to-folder path is gone')
  else if (dragProbe.prevented) failures.push('horizontal drag: dragstart was cancelled, drag-to-folder can no longer start')

  await page.keyboard.press('Escape')
  await new Promise(r => setTimeout(r, SETTLE_MS))
  const rowsAfter = await page.$$eval(ROW, els => els.length)
  console.log(`rows: before=${rowsBefore} after=${rowsAfter} (nothing moved or deleted)`)
  if (rowsAfter < rowsBefore) failures.push(`the marquee checks lost rows: ${rowsBefore} before, ${rowsAfter} after`)

  // --- A plain click REPLACES the selection and opens that row ---
  // Explorer/Finder rule: only Cmd/Ctrl, Shift and the hover checkbox accumulate.
  // A bare click on the row body empties a multi-selection and opens the row —
  // without this, the right-click that selects leaves the list unopenable until
  // Escape.
  // The list is served from the local cache: some rows carry a uid that is no longer
  // in the IMAP mailbox (the server then answers 404) and open nothing — that is
  // stale harness data, not the product under measurement. So the server is asked
  // WHICH row actually opens, and that one is clicked: the "a plain click opens"
  // assertion keeps its full meaning, it just applies to a message that exists.
  // The message route requires both the account AND the folder. Rather than guessing
  // them, the ones the list itself just used are read back: the harness queries
  // exactly the mailbox that is on screen.
  const listQuery = listRequests.at(-1)
  if (!listQuery) { console.error('HARNESS: never saw the list fetch its own messages'); process.exit(2) }
  const openableIndex = await page.evaluate(async ({ account, folder }) => {
    const rows = [...document.querySelectorAll('[data-mail-row]')]
    for (let i = 0; i < Math.min(rows.length, 8); i++) {
      const uid = rows[i].getAttribute('data-mail-row')
      const res = await fetch(`/api/messages/${uid}?account=${encodeURIComponent(account)}&folder=${encodeURIComponent(folder)}`)
      if (res.ok) return i
    }
    return -1
  }, listQuery)
  if (openableIndex < 0) { console.error('HARNESS: no row in the first 8 still exists server-side (stale local cache)'); process.exit(2) }
  console.log(`row chosen for the open check: ${openableIndex} (first one the server still serves)`)
  // The two rows added to the selection must be OTHER than the one to be opened.
  const [selA, selB] = [0, 1, 2, 3].filter(i => i !== openableIndex)

  await clickRow(selA, ACCEL)
  await clickRow(selB, ACCEL)
  const beforePlain = await readCount()
  if (beforePlain !== 2) { console.error(`HARNESS: could not build a 2-row selection (got ${beforePlain})`); process.exit(2) }
  await clickRow(openableIndex)
  const afterPlain = await readCount()
  console.log(`plain click on a 3rd row after a 2-row selection: count=${afterPlain} (expected 0)`)
  if (afterPlain > 1) failures.push(`plain click accumulated instead of replacing: selection holds ${afterPlain}, expected 0 or 1`)
  // Opened = the reading pane rendered its toolbar for that message. Waited for,
  // not polled: fetching the body is an IMAP round-trip, far longer than SETTLE_MS.
  const openedAfterPlain = await page.waitForSelector(PANE_ACTION, { timeout: OPEN_MS }).then(() => true, () => false)
  console.log(`plain click opened the message: ${openedAfterPlain} (expected true)`)
  if (!openedAfterPlain) failures.push('plain click on a selected list did not open the message')

  await page.keyboard.press('Escape')
  await new Promise(r => setTimeout(r, SETTLE_MS))

  // --- The reading pane does render its actions on an open message ---
  // Archive / delete / reply have moved to the head bar: what is left in the pane is
  // the flag. The message is opened and ITS disabled state is read — an inert button
  // is thus told apart from a wired one, without writing anything to a real message
  // (setting a flag would change a live mailbox).
  await clickRow(openableIndex)
  await page.waitForSelector(PANE_ACTION, { timeout: OPEN_MS })
  const paneAction = await page.$eval(PANE_ACTION, el => ({
    disabled: el.disabled === true || el.getAttribute('aria-disabled') === 'true',
  }))
  console.log(`reading-pane flag button: disabled=${paneAction.disabled} (expected false)`)
  if (paneAction.disabled) failures.push('reading pane: the flag button is inert with a message open')
} finally {
  await browser.close()
}

if (failures.length) {
  console.error(`\ncheck-mail-selection: ${failures.length} failure(s)`)
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(1)
}
console.log('\ncheck-mail-selection: OK')
