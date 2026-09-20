#!/usr/bin/env node
/**
 * Measures that the colour a mailbox carries is the one its owner chose, and is the SAME
 * colour in the settings badge, in the sidebar bubble and in the bar's accent variable, and
 * whatever colour is picked the letters on it stay readable.
 *
 * Every mailbox touched is put back on `Automatic` in the `finally`, so the bench leaves the
 * database as it found it. Fails (exit 1) on any mismatch. Exits 2 on a HARNESS error — a
 * missing browser, an unreachable server, a database with no mailbox — which says nothing
 * about the product.
 *
 * Needs a running dev server and SYNAPMAIL_TEST_* credentials (see .env).
 *   node scripts/check-account-color.mjs
 */
import { existsSync, readFileSync } from 'node:fs'
import pg from 'pg'
import puppeteer from 'puppeteer-core'
import {
  ACCOUNT_PALETTE, HEX_LENGTH, MIN_CONTRAST, accountColor, accountOrderBy, contrastRatio, readableInk,
} from '../lib/accountColor.ts'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const VIEWPORT = { width: 1440, height: 900 }
// A colour that is NOT in the automatic palette, so \"the badge shows what was chosen\" cannot
// pass by accident on a mailbox whose rank colour happens to match.
const CHOSEN = '#0ea5e9'
// A colour light enough that white ink fails on it (measured: 1.32:1 against white): the ink
// rule has to flip to dark, or the initials become unreadable. This is the discriminating case.
const PALE = '#fde047'
// A third colour, chosen only through the WHEEL, so "the wheel's choice was saved" cannot pass
// on a value some other path could have written.
const WHEELED = '#10b981'
// Hue tolerance between the settings badge, the sidebar bubble and `--synap-account`: they
// are the same hex resolved by the same function, so the only spread allowed is the rounding
// of `rgb()` serialisation. GOAL.md fixes this at 1 degree.
const MAX_HUE_SPREAD_DEG = 1
// Values the API must refuse. Not colours: a short hex, a CSS name, an injection attempt.
const REJECTED = ['#0ea5e', 'red', 'rgb(1,2,3)', '#0ea5e9; DROP TABLE', '']
const HTTP_BAD_REQUEST = 400
const SETTLE_MS = 600

// Same two files, same precedence as the dev server: the bench credentials live in `.env`,
// the database URL in `.env.local`.
for (const file of ['../.env', '../.env.local']) {
  const path = new URL(file, import.meta.url)
  if (!existsSync(path)) continue
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
  }
}
const {
  SYNAPMAIL_TEST_URL: BASE, SYNAPMAIL_TEST_EMAIL: EMAIL,
  SYNAPMAIL_TEST_PASSWORD: PASSWORD, DATABASE_URL: DB_URL,
} = process.env
for (const [k, v] of Object.entries({
  SYNAPMAIL_TEST_URL: BASE, SYNAPMAIL_TEST_EMAIL: EMAIL,
  SYNAPMAIL_TEST_PASSWORD: PASSWORD, DATABASE_URL: DB_URL,
})) {
  if (!v) { console.error(`HARNESS: ${k} is not set`); process.exit(2) }
}

const failures = []
const ok = msg => console.log(`ok   ${msg}`)
const fail = msg => { failures.push(msg); console.log(`FAIL ${msg}`) }
const check = (cond, msg) => (cond ? ok(msg) : fail(msg))

/** `rgb(r, g, b)` as rendered by the browser → `#rrggbb`, so it can be compared to the source. */
const toHex = rgb => {
  const m = rgb.match(/\d+/g)
  return m ? '#' + m.slice(0, 3).map(n => Number(n).toString(16).padStart(2, '0')).join('') : null
}
const hue = hex => {
  const n = parseInt(hex.slice(1), 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(c => c / 255)
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min
  if (!d) return 0
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return (h * 60 + 360) % 360
}
const hueSpread = hexes => {
  const angles = hexes.map(hue)
  return Math.max(...angles.map(a => Math.min(...angles.map(b => Math.abs(a - b) > 180 ? 360 - Math.abs(a - b) : Math.abs(a - b)))))
    || Math.max(...angles) - Math.min(...angles)
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] })
  .catch(e => { console.error(`HARNESS: cannot launch Chrome — ${e.message}`); process.exit(2) })

/** Every mailbox this run wrote to, so the `finally` can put each one back on Automatic. */
const touched = new Set()
let page
/** Mailboxes whose `created_at` this run flattened, with the value to put back. */
const originalDates = new Map()
const db = new pg.Client({ connectionString: DB_URL })

/** The list as the product serves it: ids in order, with the colour each mailbox ends up wearing. */
const readOrder = () => page.evaluate(async base => {
  const rows = ((await (await fetch(`${base}/api/accounts`)).json()).data ?? []).filter(a => !a.isShared)
  return rows.map(a => ({ id: a.id, badgeColor: a.badgeColor ?? null }))
}, BASE)

const patch = (id, badgeColor) => page.evaluate(async ({ base, id, badgeColor }) => {
  const res = await fetch(`${base}/api/accounts/${id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ badgeColor }),
  })
  return { status: res.status, body: await res.json().catch(() => null) }
}, { base: BASE, id, badgeColor })

/** The badge in settings, the bubble in the bar and the bar's accent, read from one render. */
const readPaint = (id, activeId) => page.evaluate(async ({ base, id, activeId, settle }) => {
  const paint = {}
  await new Promise(r => setTimeout(r, settle))
  const badge = document.querySelector(`[data-account-badge="${id}"]`)
  if (badge) {
    const s = getComputedStyle(badge)
    paint.badge = s.backgroundColor
    paint.badgeInk = s.color
    paint.badgeLetters = badge.querySelector('[data-account-initial]')?.textContent ?? ''
    paint.badgeBox = badge.getBoundingClientRect().width
  }
  const bar = document.querySelector('[data-sidebar]')
  if (bar && id === activeId) {
    paint.accent = getComputedStyle(bar).getPropertyValue('--synap-account').trim()
    const bubble = bar.querySelector('[data-sidebar-row="account"] [data-account-initial]')?.parentElement
    if (bubble) {
      paint.bubble = getComputedStyle(bubble).backgroundColor
      paint.bubbleInk = getComputedStyle(bubble).color
      paint.bubbleLetters = bubble.querySelector('[data-account-initial]')?.textContent ?? ''
    }
    const compose = bar.querySelector('[data-sidebar-row="compose"]')
    if (compose) {
      paint.compose = getComputedStyle(compose).backgroundColor
      paint.composeInk = getComputedStyle(compose).color
    }
  }
  return paint
}, { base: BASE, id, activeId, settle: SETTLE_MS })

try {
  page = await browser.newPage()
  await page.setViewport(VIEWPORT)
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
  if (accounts.length < 2) { console.error('HARNESS: this database has fewer than two owned mailboxes'); process.exit(2) }
  const target = accounts[0]
  const untouched = accounts[1]

  // BEFORE: what the mailboxes look like with nobody having chosen anything. The second one
  // is never written to, and its colour is compared again at the end — that is the
  // \"an existing mailbox does not change appearance\" criterion, measured, not asserted.
  await page.evaluate(async ({ base, id }) => {
    await fetch(`${base}/api/settings`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active_account_id: id }) })
  }, { base: BASE, id: target.id })
  await page.goto(`${BASE}/settings/accounts`, { waitUntil: 'networkidle2' })
  await page.waitForSelector(`[data-account-badge="${target.id}"]`, { timeout: 20000 })
  const before = await readPaint(target.id, target.id)
  const beforeUntouched = await readPaint(untouched.id, target.id)

  const autoTarget = accountColor({ badgeColor: target.badgeColor ?? null }, accounts.indexOf(target))
  check(toHex(before.badge) === autoTarget,
    `automatic colour of "${target.name || target.email}": badge ${toHex(before.badge)} = rank colour ${autoTarget}`)
  check(before.badgeLetters.length === 2 && before.badgeLetters === before.bubbleLetters,
    `settings badge carries the same two letters as the bar bubble — "${before.badgeLetters}" / "${before.bubbleLetters}"`)

  // CHOSEN colour: settings badge, bar bubble and the accent variable must agree.
  touched.add(target.id)
  const patched = await patch(target.id, CHOSEN)
  check(patched.status === 200 && patched.body?.data?.badgeColor === CHOSEN,
    `PATCH badgeColor=${CHOSEN} accepted and echoed — status ${patched.status}, got ${patched.body?.data?.badgeColor}`)
  await page.goto(`${BASE}/settings/accounts`, { waitUntil: 'networkidle2' })
  await page.waitForSelector(`[data-account-badge="${target.id}"]`, { timeout: 20000 })
  const after = await readPaint(target.id, target.id)
  const trio = [toHex(after.badge), toHex(after.bubble), after.accent].filter(Boolean)
  check(trio.length === 3, `settings badge, bar bubble and --synap-account all rendered — ${trio.join(' / ')}`)
  check(trio.every(c => c.toLowerCase() === CHOSEN), `all three carry the chosen colour ${CHOSEN} — ${trio.join(' / ')}`)
  check(hueSpread([...trio, CHOSEN]) <= MAX_HUE_SPREAD_DEG,
    `hue spread across badge / bubble / accent ≤ ${MAX_HUE_SPREAD_DEG} deg — ${hueSpread([...trio, CHOSEN]).toFixed(2)}`)

  // PALE colour: the ink has to flip, on the bubble AND on the compose control.
  await patch(target.id, PALE)
  await page.goto(`${BASE}/settings/accounts`, { waitUntil: 'networkidle2' })
  await page.waitForSelector(`[data-account-badge="${target.id}"]`, { timeout: 20000 })
  const pale = await readPaint(target.id, target.id)
  for (const [surface, bg, ink] of [
    ['settings badge', pale.badge, pale.badgeInk],
    ['bar bubble', pale.bubble, pale.bubbleInk],
    ['compose control', pale.compose, pale.composeInk],
  ]) {
    if (!bg || !ink) { fail(`${surface} did not render on ${PALE} — nothing to measure`); continue }
    const ratio = contrastRatio(toHex(bg), toHex(ink))
    check(ratio >= MIN_CONTRAST, `${surface} on ${PALE}: ink ${toHex(ink)} reads ${ratio.toFixed(2)}:1 ≥ ${MIN_CONTRAST}`)
  }
  // Same rule, computed rather than rendered, over every palette colour plus the two probes:
  // no colour this product can carry may be left without a readable ink.
  for (const colour of [...ACCOUNT_PALETTE, CHOSEN, PALE]) {
    const ratio = contrastRatio(colour, readableInk(colour))
    check(ratio >= MIN_CONTRAST, `readable ink exists for ${colour} — ${readableInk(colour)} at ${ratio.toFixed(2)}:1`)
  }

  // The API is the boundary: what is not a colour is refused, and nothing is written.
  for (const bad of REJECTED) {
    const res = await patch(target.id, bad)
    check(res.status === HTTP_BAD_REQUEST, `PATCH badgeColor=${JSON.stringify(bad)} refused — status ${res.status} (want ${HTTP_BAD_REQUEST})`)
  }
  const stillPale = await page.evaluate(async ({ base, id }) =>
    ((await (await fetch(`${base}/api/accounts`)).json()).data ?? []).find(a => a.id === id)?.badgeColor,
    { base: BASE, id: target.id })
  check(stillPale === PALE, `a refused colour wrote nothing — mailbox still on ${PALE}, got ${stillPale}`)

  // Automatic puts the rank colour back, exactly the one measured before anything was chosen.
  const auto = await patch(target.id, null)
  check(auto.status === 200 && auto.body?.data?.badgeColor === null, `PATCH badgeColor=null accepted — status ${auto.status}`)
  await page.goto(`${BASE}/settings/accounts`, { waitUntil: 'networkidle2' })
  await page.waitForSelector(`[data-account-badge="${target.id}"]`, { timeout: 20000 })
  const restored = await readPaint(target.id, target.id)
  check(toHex(restored.badge) === toHex(before.badge),
    `Automatic restores the original colour — ${toHex(restored.badge)} = ${toHex(before.badge)}`)
  check(toHex(beforeUntouched.badge) === toHex((await readPaint(untouched.id, target.id)).badge),
    `the mailbox nobody touched kept its colour — ${toHex(beforeUntouched.badge)}`)

  // ORDER — saving one colour must not repaint the mailboxes nobody touched. The order of the
  // list decides each mailbox's automatic colour, so it has to be TOTAL. Here every mailbox is
  // given the SAME `created_at`, which is what a bulk import produces and what makes an order
  // ordered only by (is_default, created_at) fall back to PostgreSQL's physical row order — an
  // order that moves the moment a row is updated. The dates are restored in the `finally`.
  await db.connect()
  const dated = await db.query(
    `SELECT a.id, a.created_at FROM email_accounts a
     JOIN users u ON u.id = a.user_id WHERE u.email = $1`, [EMAIL])
  if (dated.rows.length < 4 || accounts.length < 4) {
    console.error('HARNESS: fewer than four owned mailboxes to order'); process.exit(2)
  }
  for (const row of dated.rows) originalDates.set(row.id, row.created_at)
  await db.query(
    `UPDATE email_accounts SET created_at = (SELECT MIN(created_at) FROM email_accounts WHERE id = ANY($1))
     WHERE id = ANY($1)`, [[...originalDates.keys()]])

  // The mailbox written here must be one NOTHING has written to yet in this run: PostgreSQL
  // relocates a row when it is updated, so a mailbox already patched above sits at the end of
  // the heap and updating it again would move nothing — the probe would pass whatever the
  // ORDER BY says. `accounts[2]` is untouched at this point; it is reset right after.
  const mover = accounts[2]
  const orderBefore = await readOrder()
  touched.add(mover.id)
  await patch(mover.id, CHOSEN)
  const orderAfter = await readOrder()
  check(orderBefore.map(a => a.id).join() === orderAfter.map(a => a.id).join(),
    `tied dates: the order of the mailboxes is unchanged by a save — ${orderAfter.length} ids identical`)
  const moved = orderBefore
    .map((a, i) => ({ a, auto: accountColor({ badgeColor: a.badgeColor }, i) }))
    .filter(({ a }) => a.id !== mover.id)
    .filter(({ a, auto }) => {
      const i = orderAfter.findIndex(b => b.id === a.id)
      return i < 0 || accountColor({ badgeColor: orderAfter[i].badgeColor }, i) !== auto
    })
  check(moved.length === 0,
    `tied dates: every OTHER mailbox keeps its colour through a save — ${moved.length} repainted`)
  await patch(mover.id, null)

  // The same question asked of the DATABASE, with its own reference arm: the product's clause
  // against the one it replaced, over the same rows, in the same run. An update relocates a row
  // in the heap, so an order that does not break ties reads back differently afterwards. This is
  // what makes the check above discriminating: the API's 7-row plan can happen to preserve an
  // arbitrary order, the SQL cannot be relied on to.
  // Its own fresh mailbox, for the same reason the probe above needed one: a row already
  // updated in this run sits at the end of the heap and updating it again moves nothing.
  const sqlMover = accounts[3]
  const idsBy = async clause => (await db.query(
    `SELECT id FROM email_accounts WHERE user_id = (SELECT id FROM users WHERE email = $1) ${clause}`,
    [EMAIL])).rows.map(r => r.id).join()
  const UNTOTAL = 'ORDER BY is_default DESC, created_at ASC'
  const productClause = accountOrderBy()
  const totalBefore = await idsBy(productClause)
  const untotalBefore = await idsBy(UNTOTAL)
  await db.query(
    `UPDATE email_accounts SET badge_color = $2 WHERE id = $1`, [sqlMover.id, CHOSEN])
  const totalAfter = await idsBy(productClause)
  const untotalAfter = await idsBy(UNTOTAL)
  await db.query(`UPDATE email_accounts SET badge_color = NULL WHERE id = $1`, [sqlMover.id])
  check(totalBefore === totalAfter,
    `tied dates, in the database: the order the product uses survives an update — "${productClause}"`)
  // Reference arm. If THIS passes too, the probe above proves nothing on this data set and the
  // bench says so rather than reporting a green it has not earned.
  check(untotalBefore !== untotalAfter,
    `tied dates, in the database: the clause without a tie-break really does move — reference arm for the check above`)

  // WHEEL — a colour picked in the wheel and then abandoned by clicking elsewhere must be
  // SAVED (that is the natural gesture), and Escape must CANCEL it. Both are measured through
  // the real panel: real clicks, real key, the write counted at the network.
  await page.goto(`${BASE}/settings/accounts`, { waitUntil: 'networkidle2' })
  await page.waitForSelector(`[data-account-badge="${target.id}"]`, { timeout: 20000 })
  const openPanelOf = async id => {
    await page.click(`[data-account-color-trigger="${id}"]`)
    await page.waitForSelector(`[data-account-color-panel="${id}"]`, { timeout: 5000 })
  }
  /** Counts the PATCHes this mailbox receives while `run` plays, and returns what they carried. */
  const countWrites = async (id, run) => {
    const writes = []
    const onReq = req => {
      if (req.method() === 'PATCH' && req.url().endsWith(`/api/accounts/${id}`)) {
        try { writes.push(JSON.parse(req.postData() ?? '{}').badgeColor ?? null) } catch { writes.push(undefined) }
      }
    }
    page.on('request', onReq)
    try { await run() } finally { await new Promise(r => setTimeout(r, SETTLE_MS)); page.off('request', onReq) }
    return writes
  }
  // The wheel is a controlled React input: assigning `.value` directly leaves React's own
  // value tracker believing nothing changed, and the event is then swallowed. The native
  // setter is what a real drag goes through, so that is what the bench uses.
  const setWheel = (id, colour) => page.$eval(`[data-account-color-wheel="${id}"]`, (el, c) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, c)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }, colour)
  const storedColor = async id => {
    await new Promise(r => setTimeout(r, SETTLE_MS))
    return (await readOrder()).find(a => a.id === id)?.badgeColor ?? null
  }

  touched.add(target.id)
  const awayWrites = await countWrites(target.id, async () => {
    await openPanelOf(target.id)
    await setWheel(target.id, WHEELED)
    await page.mouse.click(VIEWPORT.width - 8, VIEWPORT.height - 8)
  })
  check(awayWrites.length === 1 && awayWrites[0] === WHEELED,
    `wheel then click away: exactly one write, carrying ${WHEELED} — ${JSON.stringify(awayWrites)}`)
  check(await storedColor(target.id) === WHEELED,
    `wheel then click away: the mailbox really holds ${WHEELED} — ${await storedColor(target.id)}`)

  const escWrites = await countWrites(target.id, async () => {
    await openPanelOf(target.id)
    await setWheel(target.id, PALE)
    await page.keyboard.press('Escape')
  })
  check(escWrites.length === 0, `wheel then Escape: nothing written — ${escWrites.length} write(s)`)
  check(await storedColor(target.id) === WHEELED,
    `wheel then Escape: the mailbox kept ${WHEELED} — ${await storedColor(target.id)}`)
  const cancelled = await readPaint(target.id, target.id)
  check(toHex(cancelled.badge) === WHEELED,
    `wheel then Escape: the badge is back on the stored colour — ${toHex(cancelled.badge)}`)

  // HEX FIELD — bounded to one colour, and its invalidity announced rather than only coloured.
  await openPanelOf(target.id)
  const hexField = await page.$eval(`[data-account-color-hex="${target.id}"]`, el => ({ maxLength: el.maxLength }))
  check(hexField.maxLength === HEX_LENGTH,
    `the hex field cannot hold a second colour — maxLength ${hexField.maxLength} = ${HEX_LENGTH}`)
  await page.type(`[data-account-color-hex="${target.id}"]`, '#0ea5e9#fde047')
  const typed = await page.$eval(`[data-account-color-hex="${target.id}"]`, el => el.value)
  check(typed.length <= HEX_LENGTH, `pasting two colours leaves one — "${typed}"`)
  await page.$eval(`[data-account-color-hex="${target.id}"]`, el => {
    el.value = ''
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await page.type(`[data-account-color-hex="${target.id}"]`, 'nope')
  const announced = await page.$eval(`[data-account-color-hex="${target.id}"]`, el => el.getAttribute('aria-invalid'))
  check(announced === 'true', `an invalid hex is announced to screen readers — aria-invalid="${announced}"`)
  await page.keyboard.press('Escape')
} catch (e) {
  console.error(`HARNESS: ${e.stack}`)
  process.exit(2)
} finally {
  // Every mailbox this run wrote to goes back to Automatic, whatever happened above.
  if (page) for (const id of touched) await patch(id, null).catch(() => {})
  // The dates this run flattened go back to what they were, so the bench leaves the database
  // exactly as it found it — the colours above are only meaningful if the state is.
  for (const [id, when] of originalDates) {
    await db.query('UPDATE email_accounts SET created_at = $2 WHERE id = $1', [id, when]).catch(() => {})
  }
  await db.end().catch(() => {})
  await browser.close().catch(() => {})
}

console.log(failures.length ? `check-account-color: ${failures.length} FAIL` : 'check-account-color: OK')
process.exit(failures.length ? 1 : 0)
