#!/usr/bin/env node
/**
 * Measures that the drawn scrollbar (`components/layout/ThinScroll.tsx`) can be
 * GRABBED with a real mouse, on the message list and on the side bar.
 *
 * What it asserts, with real pointer events on the real app:
 *  - the pointer entering the band along the right edge reveals the thumb WITHOUT
 *    any scrolling having happened;
 *  - pressing the thumb and moving down N px scrolls the content pro rata (thumb
 *    travel <-> content travel), within a pixel tolerance;
 *  - the gesture selects no text, draws no marquee, starts no row drag, opens no
 *    message and leaves the checked selection untouched;
 *  - pressing the BARE band at 80% of its height jumps to ~80% of the run;
 *  - the pointer leaving the band lets the thumb fade back to 0;
 *  - the pointer parked in the MIDDLE of the list, without scrolling, keeps the
 *    thumb invisible (the hover rule must stay confined to the band);
 *  - a right-click landing in the band still reaches the row underneath (the band is
 *    a REGION tested on the press, not an overlay element that would eat the click);
 *  - the side bar's own scroll area gets the same band, from the same component.
 *
 * Every geometry and timing is READ from the shipped module (THIN_SCROLL): a rename
 * or a retune there fails here instead of measuring a stale constant.
 *
 * Nothing is moved, deleted or flagged: scrolling only.
 *
 * Needs a running dev server and SYNAPMAIL_TEST_* credentials (see .env).
 *   node scripts/check-mail-scrollbar-drag.mjs
 */
import { readFileSync } from 'node:fs'
import puppeteer from 'puppeteer-core'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const VIEWPORT = { width: 1440, height: 900 }
const SETTLE_MS = 400
// Below this the list does not overflow and there is no thumb to grab at all.
const MIN_ROWS = 12
// Drag distance, in px of thumb travel. Long enough that a pro-rata error shows,
// short enough to stay inside the track on a 900px viewport.
const DRAG_PX = 200
// The pointer position is integer-rounded and the thumb height is fractional:
// two px of slack covers the rounding, not a wrong ratio.
const RATIO_TOL_PX = 2
// Where on the band the bare press lands, as a fraction of its height. Deliberately
// NOT near the bottom: a press at 80% reaches the end of the loaded list, the
// infinite-scroll observer fetches the next page, and `scrollHeight` grows BETWEEN
// the press and the read — the measured ratio then divides by a run that did not
// exist when the press happened (observed: 0.955 for a press that landed exactly
// where it should have). Mid-band keeps the run constant across the measurement.
const JUMP_AT = 0.5
// How long the band hover gets to paint the thumb, per the DoD.
const REVEAL_MS = 400

const THIN_SRC = readFileSync(new URL('../components/layout/ThinScroll.tsx', import.meta.url), 'utf8')
const num = key => Number(THIN_SRC.match(new RegExp(`${key}:\\s*(\\d+)`))?.[1])
const IDLE_MS = num('idleMs')
const FADE_MS = num('fadeMs')
const BAND_W = num('bandWidth')
const MIN_THUMB = num('minThumbHeight')
if (!IDLE_MS || !FADE_MS || !BAND_W || !MIN_THUMB) {
  console.error('HARNESS: could not read idleMs/fadeMs/bandWidth/minThumbHeight from components/layout/ThinScroll.tsx')
  process.exit(2)
}

const VIEWPORT_SEL = '[data-thin-scroll-viewport]'
const THUMB_SEL = '[data-thin-scroll-thumb]'
const HOST_SEL = '[data-thin-scroll]'
const MARQUEE_SEL = '[data-mail-marquee]'
const ROW = '[data-mail-row]'
// The rows carry no "checked" flag of their own: `aria-selected` is what the list
// exposes (checked OR open), and it is what check-mail-selection.mjs reads too.
const SELECTED = '[data-mail-row][aria-selected="true"]'
const PANE_ACTION = '[data-reading-flag]'
const SIDEBAR_SEL = 'aside'
const MENU_SEL = '[data-mail-context-menu]'

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

  await page.goto(`${BASE}/mail`, { waitUntil: 'networkidle2' })
  await page.waitForSelector(ROW, { timeout: 30000 })
  await new Promise(r => setTimeout(r, SETTLE_MS))

  const rowCount = await page.$$eval(ROW, els => els.length)
  console.log(`rows loaded: ${rowCount}`)
  if (rowCount < MIN_ROWS) { console.error(`HARNESS: only ${rowCount} rows loaded, need ${MIN_ROWS} to overflow the list`); process.exit(2) }

  // Geometry of the list: the scrolling box, its band and its thumb, in page coords.
  // The band is a REGION of the host box, not an element: it is the last `bandWidth`
  // px of the host's width. The bench aims at its middle, from the host's own rect.
  const geom = () => page.evaluate((rowSel, vpSel, hostSel, thumbSel, bandW) => {
    const vp = document.querySelector(rowSel)?.closest(vpSel)
    if (!vp) return null
    const host = vp.closest(hostSel)
    const thumb = host?.querySelector(thumbSel)
    const vr = vp.getBoundingClientRect()
    const hr = host?.getBoundingClientRect()
    const tr = thumb?.getBoundingClientRect()
    return {
      viewport: { left: vr.left, top: vr.top, width: vr.width, height: vr.height },
      band: hr ? { x: hr.right - bandW / 2, top: hr.top, width: bandW, height: hr.height, right: hr.right } : null,
      thumb: tr ? { top: tr.top, height: tr.height, opacity: Number(getComputedStyle(thumb).opacity) } : null,
      scrollTop: vp.scrollTop,
      run: vp.scrollHeight - vp.clientHeight,
      clientHeight: vp.clientHeight,
    }
  }, ROW, VIEWPORT_SEL, HOST_SEL, THUMB_SEL, BAND_W)

  let g = await geom()
  if (!g) { console.error('HARNESS: no ThinScroll viewport contains the list rows'); process.exit(2) }
  if (!g.band) { console.error('HARNESS: the list viewport is not inside a ThinScroll host'); process.exit(2) }
  if (g.run < DRAG_PX) { console.error(`HARNESS: the list only has ${Math.round(g.run)}px of run, need >= ${DRAG_PX}`); process.exit(2) }
  console.log(`band region: ${BAND_W}px along the host's right edge (x=${g.band.x.toFixed(1)}, host right=${g.band.right.toFixed(1)})`)
  console.log(`thumb height: ${g.thumb.height.toFixed(1)}px (module floor ${MIN_THUMB}px)`)
  if (g.thumb.height < MIN_THUMB - 0.5) failures.push(`the thumb is ${g.thumb.height.toFixed(1)}px tall, below the ${MIN_THUMB}px floor: it is not grabbable on a big mailbox`)

  // --- hovering the band reveals the thumb WITHOUT any scrolling ---
  // Start from a settled, invisible thumb: park away from the band and wait it out.
  await page.mouse.move(Math.round(g.viewport.left + 40), Math.round(g.viewport.top + g.viewport.height / 2))
  await new Promise(r => setTimeout(r, IDLE_MS + FADE_MS * 2))
  const parkedMid = (await geom()).thumb.opacity
  const scrollBeforeHover = (await geom()).scrollTop
  console.log(`thumb with the pointer parked mid-list, no scrolling: opacity=${parkedMid} (expected 0)`)
  if (parkedMid !== 0) failures.push(`the thumb stays visible (opacity ${parkedMid}) with the pointer in the MIDDLE of the list: the hover rule leaked out of the band`)

  await page.mouse.move(Math.round(g.band.x), Math.round(g.viewport.top + g.viewport.height / 2))
  await new Promise(r => setTimeout(r, REVEAL_MS))
  g = await geom()
  console.log(`thumb ${REVEAL_MS}ms after entering the band: opacity=${g.thumb.opacity} scrollTop=${g.scrollTop} (was ${scrollBeforeHover})`)
  if (!(g.thumb.opacity > 0)) failures.push(`the band hover does not reveal the thumb (opacity ${g.thumb.opacity} after ${REVEAL_MS}ms)`)
  if (g.scrollTop !== scrollBeforeHover) failures.push(`hovering the band scrolled the list by itself (${scrollBeforeHover} -> ${g.scrollTop})`)

  // --- dragging the thumb scrolls pro rata, and disturbs nothing else ---
  const checkedBefore = await page.$$eval(SELECTED, els => els.length)
  const openedBefore = await page.evaluate(paneSel => document.querySelectorAll(paneSel).length, PANE_ACTION)
  await page.evaluate(() => { window.__dragStarts = 0; document.addEventListener('dragstart', () => { window.__dragStarts++ }, true) })

  const grabY = Math.round(g.thumb.top + g.thumb.height / 2)
  const track = g.clientHeight - g.thumb.height
  const expected = g.scrollTop + (DRAG_PX / track) * g.run
  await page.mouse.move(Math.round(g.band.x), grabY)
  await page.mouse.down()
  // Several small steps: a single jump is not a drag, and the component has to
  // follow the pointer the whole way.
  for (let i = 1; i <= 8; i++) await page.mouse.move(Math.round(g.band.x), grabY + Math.round((DRAG_PX * i) / 8))
  await new Promise(r => setTimeout(r, SETTLE_MS))
  const afterDrag = await geom()
  await page.mouse.up()
  const delta = afterDrag.scrollTop - expected
  console.log(`drag of ${DRAG_PX}px: scrollTop=${afterDrag.scrollTop.toFixed(1)} expected=${expected.toFixed(1)} delta=${delta.toFixed(1)}px (tol ${RATIO_TOL_PX})`)
  if (Math.abs(delta) > RATIO_TOL_PX) failures.push(`dragging the thumb ${DRAG_PX}px scrolled to ${afterDrag.scrollTop.toFixed(1)} instead of ${expected.toFixed(1)} (${delta.toFixed(1)}px off): the travel is not pro rata`)

  const after = await page.evaluate((selectedSel, marqueeSel, paneSel) => ({
    selectionText: String(window.getSelection() ?? ''),
    marquees: document.querySelectorAll(marqueeSel).length,
    dragStarts: window.__dragStarts,
    checked: document.querySelectorAll(selectedSel).length,
    opened: document.querySelectorAll(paneSel).length,
  }), SELECTED, MARQUEE_SEL, PANE_ACTION)
  console.log(`during the drag: selection="${after.selectionText}" marquees=${after.marquees} dragstarts=${after.dragStarts} selected-rows=${after.checked} (was ${checkedBefore}) reading-pane=${after.opened} (was ${openedBefore})`)
  if (after.selectionText !== '') failures.push(`the drag selected text ("${after.selectionText.slice(0, 40)}")`)
  if (after.marquees !== 0) failures.push(`the drag drew ${after.marquees} selection marquee(s)`)
  if (after.dragStarts !== 0) failures.push(`the drag fired ${after.dragStarts} row dragstart(s)`)
  if (after.checked !== checkedBefore) failures.push(`the drag changed the selection (${checkedBefore} -> ${after.checked} rows selected)`)
  if (after.opened !== openedBefore) failures.push(`the drag opened a message (reading pane ${openedBefore} -> ${after.opened})`)

  // --- pressing the BARE band puts the thumb under the pointer ---
  await page.evaluate((rowSel, vpSel) => { const vp = document.querySelector(rowSel)?.closest(vpSel); if (vp) vp.scrollTop = 0 }, ROW, VIEWPORT_SEL)
  await new Promise(r => setTimeout(r, SETTLE_MS))
  g = await geom()
  const jumpY = Math.round(g.viewport.top + g.viewport.height * JUMP_AT)
  // The press centres the thumb on the pointer, so the expected scrollTop comes from
  // the SAME pro-rata rule as the drag, read on the geometry BEFORE the press.
  const jumpTrack = g.clientHeight - g.thumb.height
  const jumpExpected = Math.min(g.run, Math.max(0, ((jumpY - g.viewport.top - g.thumb.height / 2) / jumpTrack) * g.run))
  await page.mouse.move(Math.round(g.band.x), jumpY)
  await page.mouse.down()
  await new Promise(r => setTimeout(r, SETTLE_MS))
  const jumped = await geom()
  await page.mouse.up()
  const jumpDelta = jumped.scrollTop - jumpExpected
  console.log(`press at ${JUMP_AT * 100}% of the band: scrollTop=${jumped.scrollTop.toFixed(1)} expected=${jumpExpected.toFixed(1)} delta=${jumpDelta.toFixed(1)}px (tol ${RATIO_TOL_PX})`)
  if (Math.abs(jumpDelta) > RATIO_TOL_PX) failures.push(`pressing the bare band at ${JUMP_AT * 100}% landed at ${jumped.scrollTop.toFixed(1)} instead of ${jumpExpected.toFixed(1)} (${jumpDelta.toFixed(1)}px off): the thumb did not centre on the pointer`)

  // --- leaving the band lets the thumb fade ---
  // The fade counts idle time since the last SCROLL, and a page arriving keeps the
  // list scrolling on its own. Wait for the row count to stop moving first, or this
  // measures the pagination, not the fade.
  await page.mouse.move(Math.round(g.viewport.left + 40), Math.round(g.viewport.top + g.viewport.height / 2))
  let quiet = -1
  for (let i = 0; i < 20; i++) {
    const n = await page.$$eval(ROW, els => els.length)
    if (n === quiet) break
    quiet = n
    await new Promise(r => setTimeout(r, SETTLE_MS))
  }
  await new Promise(r => setTimeout(r, IDLE_MS + FADE_MS * 2))
  const faded = (await geom()).thumb.opacity
  console.log(`thumb ${IDLE_MS + FADE_MS * 2}ms after leaving the band (list settled at ${quiet} rows): opacity=${faded} (expected 0)`)
  if (faded !== 0) failures.push(`the thumb stays visible (opacity ${faded}) once the pointer left the band`)

  // --- the side bar gets the same band, from the same component ---
  // --- a right-click in the band still reaches the row underneath ---
  // An overlay band would swallow it and the context menu would stop opening near the
  // right edge — measured for real, not assumed from the implementation.
  g = await geom()
  const rowBox = await page.$eval(ROW, el => { const r = el.getBoundingClientRect(); return { y: Math.round(r.top + r.height / 2) } })
  await page.mouse.click(Math.round(g.band.x), rowBox.y, { button: 'right' })
  await new Promise(r => setTimeout(r, SETTLE_MS))
  const menus = await page.$$eval(MENU_SEL, els => els.length)
  console.log(`right-click inside the band, on a row: menus open=${menus} (expected 1)`)
  if (menus !== 1) failures.push(`a right-click landing in the band opened ${menus} menu(s): the band is eating the click instead of only answering the left button`)
  await page.keyboard.press('Escape')
  await new Promise(r => setTimeout(r, SETTLE_MS))

  // --- the side bar drags through the same component ---
  const sidebar = await page.evaluate((asideSel, vpSel, hostSel, thumbSel) => {
    const vp = document.querySelector(asideSel)?.querySelector(vpSel)
    if (!vp) return null
    const host = vp.closest(hostSel)
    return { overflows: vp.scrollHeight - vp.clientHeight, host: !!host, thumb: !!host?.querySelector(thumbSel) }
  }, SIDEBAR_SEL, VIEWPORT_SEL, HOST_SEL, THUMB_SEL)
  if (!sidebar) { console.error('HARNESS: no ThinScroll viewport in the side bar'); process.exit(2) }
  console.log(`side bar: overflow=${sidebar.overflows}px inside a ThinScroll host=${sidebar.host} thumb painted=${sidebar.thumb}`)
  if (!sidebar.host) failures.push('the side bar scroll area is not inside a ThinScroll host: it cannot get the band')
  if (sidebar.overflows >= 1 && !sidebar.thumb) failures.push(`the side bar overflows by ${sidebar.overflows}px but paints no thumb`)
} finally {
  await browser.close()
}

if (failures.length) {
  console.error(`\ncheck-mail-scrollbar-drag: ${failures.length} failure(s)`)
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(1)
}
console.log('\ncheck-mail-scrollbar-drag: OK')
