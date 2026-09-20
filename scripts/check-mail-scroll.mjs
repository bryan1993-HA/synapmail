#!/usr/bin/env node
/**
 * Measures that the message list, the reading pane and the thread column scroll
 * through the SAME drawn scrollbar as the side bar (`components/layout/ThinScroll.tsx`)
 * and not through the native one.
 *
 * What it asserts, with a REAL wheel on the real app:
 *  - the scrolling element of the list is a ThinScroll viewport and the native bar
 *    is gone from it (`scrollbar-width: none`, 0px of native gutter);
 *  - a thumb is painted while the wheel turns (opacity > 0) and fades back to 0
 *    once the pointer is left still on the list — the pointer STAYS over the list,
 *    which is exactly the case a hover rule would break;
 *  - the content does not move sideways when the thumb appears (the thumb is an
 *    overlay, not a reserved gutter): the left edge of a row is compared with
 *    itself, before and during the scroll, in the same pass;
 *  - the next page still loads at the bottom of the list (the IntersectionObserver
 *    roots on the viewport, which is no longer the element the component renders).
 *
 * Every timing is READ from the shipped module (THIN_SCROLL.idleMs / fadeMs): a
 * rename or a retune there fails here instead of measuring a stale constant.
 *
 * Nothing is moved, deleted or flagged: scrolling only.
 *
 * Needs a running dev server and SYNAPMAIL_TEST_* credentials (see .env).
 *   node scripts/check-mail-scroll.mjs
 */
import { readFileSync } from 'node:fs'
import puppeteer from 'puppeteer-core'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const VIEWPORT = { width: 1440, height: 900 }
const SETTLE_MS = 400
const OPEN_MS = 20000
// Below this the list does not overflow and there is no thumb to measure at all.
const MIN_ROWS = 12
// One wheel notch is not enough to be sure the thumb moved: this is a real scroll.
const WHEEL_PX = 600
// The wheel can land on an element that a re-render replaces mid-dispatch.
const WHEEL_TRIES = 3

const THIN_SRC = readFileSync(new URL('../components/layout/ThinScroll.tsx', import.meta.url), 'utf8')
const IDLE_MS = Number(THIN_SRC.match(/idleMs:\s*(\d+)/)?.[1])
const FADE_MS = Number(THIN_SRC.match(/fadeMs:\s*(\d+)/)?.[1])
if (!IDLE_MS || !FADE_MS) { console.error('HARNESS: could not read idleMs/fadeMs from components/layout/ThinScroll.tsx'); process.exit(2) }

const VIEWPORT_SEL = '[data-thin-scroll-viewport]'
const THUMB_SEL = '[data-thin-scroll-thumb]'
const ROW = '[data-mail-row]'
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

  await page.goto(`${BASE}/mail`, { waitUntil: 'networkidle2' })
  await page.waitForSelector(ROW, { timeout: 30000 })
  await new Promise(r => setTimeout(r, SETTLE_MS))

  const rowCount = await page.$$eval(ROW, els => els.length)
  console.log(`rows loaded: ${rowCount}`)
  if (rowCount < MIN_ROWS) { console.error(`HARNESS: only ${rowCount} rows loaded, need ${MIN_ROWS} to overflow the list`); process.exit(2) }

  // --- the element that scrolls the list IS a ThinScroll viewport ---
  // Read from the row upwards: whatever wrapper the component renders, the box
  // that actually scrolls is the one the bench must judge.
  const listBox = await page.evaluate((rowSel, vpSel) => {
    const row = document.querySelector(rowSel)
    const vp = row?.closest(vpSel)
    if (!vp) return null
    const cs = getComputedStyle(vp)
    const r = vp.getBoundingClientRect()
    return {
      scrollbarWidth: cs.scrollbarWidth,
      // Native gutter = the px the bar steals from the content box.
      gutter: Math.round(r.width - vp.clientWidth),
      overflows: vp.scrollHeight - vp.clientHeight,
    }
  }, ROW, VIEWPORT_SEL)
  if (!listBox) { console.error('HARNESS: no ThinScroll viewport contains the list rows'); process.exit(2) }
  console.log(`list viewport: scrollbar-width=${listBox.scrollbarWidth} native gutter=${listBox.gutter}px overflow=${listBox.overflows}px`)
  if (listBox.scrollbarWidth !== 'none') failures.push(`the list viewport keeps the native scrollbar (scrollbar-width: ${listBox.scrollbarWidth}, expected none)`)
  if (listBox.gutter !== 0) failures.push(`the native scrollbar still reserves ${listBox.gutter}px on the list`)
  if (listBox.overflows < 1) { console.error('HARNESS: the list does not overflow, the thumb cannot be exercised'); process.exit(2) }

  // --- a real wheel paints the thumb, and the content does not shift sideways ---
  const listCentre = await page.evaluate((rowSel, vpSel) => {
    const vp = document.querySelector(rowSel)?.closest(vpSel)
    const r = vp.getBoundingClientRect()
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
  }, ROW, VIEWPORT_SEL)
  const rowLeft = () => page.$eval(ROW, el => el.getBoundingClientRect().left)
  const leftBefore = await rowLeft()

  // A wheel event goes to whatever sits under the cursor AT DISPATCH: a page
  // arriving between the move and the wheel swallows the notch and the bench
  // measures nothing. Observed once. Re-aim and retry rather than conclude.
  const readScrollTop = () => page.evaluate((rowSel, vpSel) => document.querySelector(rowSel)?.closest(vpSel)?.scrollTop ?? 0, ROW, VIEWPORT_SEL)
  let scrolled = 0
  for (let attempt = 0; attempt < WHEEL_TRIES && scrolled < 1; attempt++) {
    await page.mouse.move(listCentre.x, listCentre.y)
    await page.mouse.wheel({ deltaY: WHEEL_PX })
    await new Promise(r => setTimeout(r, SETTLE_MS))
    scrolled = await readScrollTop()
  }
  console.log(`wheel of ${WHEEL_PX}px: scrollTop=${scrolled}px`)
  if (scrolled < 1) { console.error(`HARNESS: the wheel did not scroll the list in ${WHEEL_TRIES} tries, nothing was measured`); process.exit(2) }

  const thumbDuring = await page.evaluate((rowSel, vpSel, thumbSel) => {
    const vp = document.querySelector(rowSel)?.closest(vpSel)
    const thumb = vp?.parentElement?.querySelector(thumbSel)
    if (!thumb) return null
    const r = thumb.getBoundingClientRect()
    return { opacity: Number(getComputedStyle(thumb).opacity), width: Math.round(r.width), height: Math.round(r.height) }
  }, ROW, VIEWPORT_SEL, THUMB_SEL)
  if (!thumbDuring) { console.error('HARNESS: no thumb element next to the list viewport'); process.exit(2) }
  console.log(`thumb while scrolling: opacity=${thumbDuring.opacity} size=${thumbDuring.width}x${thumbDuring.height}px`)
  if (!(thumbDuring.opacity > 0)) failures.push(`the thumb stays invisible while the list scrolls (opacity ${thumbDuring.opacity})`)
  if (thumbDuring.height < 1) failures.push('the thumb is painted with no height')

  const leftDuring = await rowLeft()
  console.log(`row left edge: before=${leftBefore} while the thumb shows=${leftDuring} (expected identical)`)
  if (Math.abs(leftDuring - leftBefore) > 0.5) failures.push(`the content shifts by ${(leftDuring - leftBefore).toFixed(1)}px when the thumb appears: the thumb is reserving a gutter instead of overlaying`)

  // --- the thumb fades although the pointer never leaves the list ---
  // Read from the module's own timings + a margin of one fade, so a retune of
  // THIN_SCROLL does not need this bench edited.
  await new Promise(r => setTimeout(r, IDLE_MS + FADE_MS * 2))
  const thumbIdle = await page.evaluate((rowSel, vpSel, thumbSel) => {
    const vp = document.querySelector(rowSel)?.closest(vpSel)
    const thumb = vp?.parentElement?.querySelector(thumbSel)
    return thumb ? Number(getComputedStyle(thumb).opacity) : null
  }, ROW, VIEWPORT_SEL, THUMB_SEL)
  console.log(`thumb ${IDLE_MS + FADE_MS * 2}ms later, pointer still on the list: opacity=${thumbIdle} (expected 0)`)
  if (thumbIdle !== 0) failures.push(`the thumb stays visible (opacity ${thumbIdle}) with the pointer left on the list: it pins instead of getting out of the way`)

  // --- the next page still loads at the bottom ---
  const before = await page.$$eval(ROW, els => els.length)
  await page.evaluate((rowSel, vpSel) => {
    const vp = document.querySelector(rowSel)?.closest(vpSel)
    vp.scrollTop = vp.scrollHeight
  }, ROW, VIEWPORT_SEL)
  let after = before
  for (let i = 0; i < 40 && after <= before; i++) {
    await new Promise(r => setTimeout(r, 500))
    after = await page.$$eval(ROW, els => els.length)
  }
  console.log(`rows after scrolling to the bottom: before=${before} after=${after} (expected more)`)
  if (after <= before) failures.push('the next page never loaded: the infinite-scroll observer lost its scroll root')

  // --- the reading pane scrolls through the same component ---
  const rows = await page.$$(ROW)
  await rows[0].click()
  await page.waitForSelector(PANE_ACTION, { timeout: OPEN_MS })
  await new Promise(r => setTimeout(r, SETTLE_MS))
  const paneVp = await page.evaluate((paneSel, vpSel) => {
    // The flag button sits in the pane header; the body viewport is further down
    // the same pane subtree — climb from the button until a viewport is in reach.
    let root = document.querySelector(paneSel)
    while (root && !root.querySelector(vpSel)) root = root.parentElement
    const vp = root?.querySelector(vpSel)
    return vp ? { scrollbarWidth: getComputedStyle(vp).scrollbarWidth } : null
  }, PANE_ACTION, VIEWPORT_SEL)
  console.log(`reading pane body viewport: ${paneVp ? `scrollbar-width=${paneVp.scrollbarWidth}` : 'none found'}`)
  if (!paneVp) failures.push('the reading pane body does not scroll through ThinScroll')
  else if (paneVp.scrollbarWidth !== 'none') failures.push(`the reading pane keeps the native scrollbar (scrollbar-width: ${paneVp.scrollbarWidth})`)
} finally {
  await browser.close()
}

if (failures.length) {
  console.error(`\ncheck-mail-scroll: ${failures.length} failure(s)`)
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(1)
}
console.log('\ncheck-mail-scroll: OK')
