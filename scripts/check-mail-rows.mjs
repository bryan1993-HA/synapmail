#!/usr/bin/env node
/**
 * Measures the CLEARED mail rows, with REAL clicks and a REAL hover:
 *  - a row carries NO action button, at rest AND under a real hover (the
 *    selection checkbox of the avatar bubble is not an action: it is excluded);
 *  - every row shows a date WITH a time;
 *  - the right-click menu offers "Snooze", its submenu lists the presets, and
 *    choosing one sends a snooze request for EVERY uid of the selection.
 *
 * Nothing is moved, deleted or sent: the snooze request is INTERCEPTED and
 * aborted by the bench, so no real message is ever hidden on the test account.
 *
 * Needs a running dev server and SYNAPMAIL_TEST_* credentials (see .env).
 *   node scripts/check-mail-rows.mjs
 */
import { readFileSync } from 'node:fs'
import puppeteer from 'puppeteer-core'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const VIEWPORT = { width: 1440, height: 900 }
const SETTLE_MS = 400
// Enough rows to build a 2-row selection and still have another to hover.
const MIN_ROWS = 3

// Read from the shipped module so a rename there fails the bench instead of
// silently measuring an attribute nobody writes any more.
const MODULE_SRC = readFileSync(new URL('../lib/mailSelection.tsx', import.meta.url), 'utf8')
const COUNT_ATTR = MODULE_SRC.match(/MAIL_SELECTION_COUNT_ATTR = '([^']+)'/)?.[1]
if (!COUNT_ATTR) { console.error('HARNESS: could not read MAIL_SELECTION_COUNT_ATTR from lib/mailSelection.tsx'); process.exit(2) }

// Same reason: the preset keys come from the shipped module, not from a copy.
const PRESET_SRC = readFileSync(new URL('../lib/snooze-presets.ts', import.meta.url), 'utf8')
const PRESET_KEYS = [...PRESET_SRC.matchAll(/key: '(snooze\w+)'/g)].map(m => m[1])
if (!PRESET_KEYS.length) { console.error('HARNESS: could not read the preset keys from lib/snooze-presets.ts'); process.exit(2) }

const LIST = `[${COUNT_ATTR}]`
const ROW = '[data-mail-row]'
const MENU = '[data-mail-context-menu]'
// A time is present in every locale of the app: fr/zh "10:41", en "10:41 AM".
const HAS_TIME = /\d{1,2}:\d{2}/
// A full date needs a day number AND something naming the month (a word, or the
// CJK 月). "Today, 10:41" is the accepted exception, asked for by name.
const HAS_FULL_DATE = /\d{1,2}.*(\p{L}{3,}|月)|(\p{L}{3,}|月).*\d{1,2}/u

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

  // Every snooze request is captured and aborted: the bench proves the client
  // asks for the right uids WITHOUT hiding a real message on a real mailbox.
  const snoozeCalls = []
  await page.setRequestInterception(true)
  page.on('request', req => {
    const m = req.url().match(/\/api\/messages\/([^/?]+)\/snooze/)
    if (m && req.method() === 'POST') {
      snoozeCalls.push({ uid: m[1], body: req.postData() })
      req.abort().catch(() => {})
      return
    }
    req.continue().catch(() => {})
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
  // Buttons of a row, EXCLUDING the avatar bubble: its checkbox is selection,
  // not an action, and the requirement keeps it (no action icon left on the row).
  const rowButtons = (el) => [...el.querySelectorAll('button, [role="button"]')]
    .filter(b => !b.closest('[class*="group/avatar"]'))
    .map(b => b.getAttribute('title') || b.getAttribute('data-menu-item') || b.textContent.trim().slice(0, 20) || '(unnamed)')

  // --- 1. No action button on any row, AT REST ---
  const atRest = await page.$$eval(ROW, (els, src) => {
    const f = new Function('el', `return (${src})(el)`)
    return els.map(f)
  }, rowButtons.toString())
  const restOffenders = atRest.map((b, i) => [i, b]).filter(([, b]) => b.length)
  console.log(`rows with an action button at rest: ${restOffenders.length}/${atRest.length}`)
  for (const [i, b] of restOffenders) fail(`row ${i} still carries ${b.length} button(s) at rest: ${b.join(', ')}`)

  // --- 2. Still none under a REAL hover (the old strip was hover-styled) ---
  const hoverTarget = await row(1)
  await hoverTarget.hover()
  await settle()
  const hovered = await page.$$eval(ROW, (els, src) => {
    const f = new Function('el', `return (${src})(el)`)
    const hot = els.find(el => el.matches(':hover'))
    return { found: !!hot, buttons: hot ? f(hot) : [] }
  }, rowButtons.toString())
  console.log(`hovered row matched: ${hovered.found}; buttons under hover: ${hovered.buttons.length}`)
  if (!hovered.found) { console.error('HARNESS: the real hover landed on no row'); process.exit(2) }
  if (hovered.buttons.length) fail(`a hovered row shows ${hovered.buttons.length} button(s): ${hovered.buttons.join(', ')}`)

  // --- 3. Every row shows a full date WITH a time ---
  const dates = await page.$$eval(ROW, els => els.map(el => {
    const spans = [...el.querySelectorAll('span')]
    return spans.map(s => s.textContent.trim()).filter(Boolean)
  }))
  let dated = 0
  const els_len = dates.length
  dates.forEach((texts, i) => {
    const hit = texts.find(txt => HAS_TIME.test(txt) && HAS_FULL_DATE.test(txt))
    // Print the first rows AND the last: the top of a busy inbox is all
    // "Today, HH:MM", which would never exercise the dated branch on screen.
    if (hit) { dated++; if (i < 3 || i === els_len - 1) console.log(`  row ${i} date: "${hit}"`) }
    else fail(`row ${i} shows no full date with a time (texts: ${texts.slice(0, 4).join(' | ')})`)
  })
  console.log(`rows showing a full date + time: ${dated}/${dates.length}`)

  // --- 4. "Snooze" lives in the right-click menu and acts on the SELECTION ---
  await clickRow(0, ACCEL)
  await clickRow(1, ACCEL)
  const selected = await readCount()
  if (selected !== 2) { console.error(`HARNESS: could not build a 2-row selection (got ${selected})`); process.exit(2) }
  await (await row(1)).click({ button: 'right' })
  await settle()
  if (!(await page.$(MENU))) { console.error('HARNESS: no context menu opened'); process.exit(2) }

  const entry = await page.$(`${MENU} [data-menu-item="snooze"]`)
  console.log(`context menu carries "snooze": ${!!entry}`)
  if (!entry) {
    fail('the right-click menu has no "Snooze" entry')
  } else {
    await entry.hover()
    await settle()
    const presets = await page.$$eval(`${MENU} [data-menu-snooze]`, els => els.map(el => ({
      key: el.getAttribute('data-menu-snooze'),
      label: el.textContent.trim(),
    })))
    console.log(`submenu presets: ${presets.map(p => `${p.key}="${p.label}"`).join(', ') || '(none)'}`)
    // Past presets are dropped by design (snoozePresets filters them), so the
    // bench requires a non-empty SUBSET of the shipped keys, not all of them.
    if (!presets.length) fail('the "Snooze" submenu lists no preset')
    const unknown = presets.filter(p => !PRESET_KEYS.includes(p.key))
    if (unknown.length) fail(`submenu lists preset(s) unknown to lib/snooze-presets.ts: ${unknown.map(p => p.key).join(', ')}`)

    if (presets.length) {
      const uidsBefore = await page.$$eval(ROW, els => els.map(el => el.getAttribute('data-mail-row')))
      snoozeCalls.length = 0
      await page.click(`${MENU} [data-menu-snooze="${presets[0].key}"]`)
      await settle()
      const gotUids = snoozeCalls.map(c => c.uid).sort()
      const wantUids = uidsBefore.slice(0, 2).sort()
      console.log(`snooze requests: ${gotUids.length} for uid(s) ${gotUids.join(',')} (selection was ${wantUids.join(',')})`)
      if (gotUids.length !== 2) fail(`choosing a preset sent ${gotUids.length} snooze request(s), expected 2 (one per selected uid)`)
      else if (gotUids.join(',') !== wantUids.join(',')) fail(`snooze hit uid(s) ${gotUids.join(',')} instead of the selection ${wantUids.join(',')}`)
      const until = snoozeCalls[0] ? JSON.parse(snoozeCalls[0].body || '{}').until : null
      console.log(`  request body carries until=${until}`)
      if (!until || new Date(until).getTime() <= Date.now()) fail(`the snooze request carries no future date (until=${until})`)
    }
  }
  await page.keyboard.press('Escape')
} finally {
  // The page keeps an SSE stream open through the request interceptor, which
  // can hold `close()` open past the end of the measurements: the bench must
  // still report its verdict rather than hang after every check has run.
  await Promise.race([browser.close(), new Promise(r => setTimeout(r, 5000))])
  browser.process()?.kill('SIGKILL')
}

if (failures.length) {
  console.error(`\ncheck-mail-rows: ${failures.length} failure(s)`)
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(1)
}
console.log('\ncheck-mail-rows: OK')
process.exit(0)
