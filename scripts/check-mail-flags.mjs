#!/usr/bin/env node
/**
 * Measures the colour flags end to end, on the running app, with REAL clicks:
 * each of the seven colours is picked in the reading pane's flag menu, and the
 * result is read back FROM THE IMAP SERVER on a separate connection.
 *
 * The reference is the server, not the screen: a component that paints a flag
 * it never stored would pass a DOM-only check and fail this one.
 *
 * The paint is measured as the COMPUTED colour of the icon, never as a class
 * name: a class that is never generated leaves the icon the colour of the text,
 * which reads as "flag present" in the DOM and as "no flag" to the eye. For the
 * menu AND for the list row, in BOTH themes, the seven colours must be distinct
 * from each other, distinct from the text colour, and contrast at least
 * MIN_CONTRAST against the surface they are painted on (WCAG 1.4.11).
 *
 * Nothing touches a real mailbox: the bench APPENDs its own message into a
 * scratch folder of the test account and deletes it at the end. No other
 * message is read, moved, flagged or deleted.
 *
 * Needs a running dev server and SYNAPMAIL_TEST_* credentials (see .env).
 *   node --experimental-strip-types scripts/check-mail-flags.mjs
 *
 * Negative control — proves the bench can actually see the defect it exists for:
 *   node --experimental-strip-types scripts/check-mail-flags.mjs --break-flag=green
 * kills one colour variable and EXPECTS the run to fail.
 */
import { readFileSync } from 'node:fs'
import puppeteer from 'puppeteer-core'
import { ImapFlow } from 'imapflow'
import { MAIL_FLAGS, flagFromKeywords } from '../lib/flags.ts'
import { decrypt } from '../lib/encrypt.ts'
import { SCRATCH_DOMAIN, SCRATCH_FOLDER } from './bench-constants.mjs'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const VIEWPORT = { width: 1440, height: 900 }
// A flag click is one PATCH against IMAP: slower than a local re-render.
const SETTLE_MS = 1500
const FOLDER = SCRATCH_FOLDER
const THEMES = ['light', 'dark']
// WCAG 2.1 SC 1.4.11 (non-text contrast) — the flag IS the information here.
const MIN_CONTRAST = 3
// Euclidean distance in sRGB. 40 separates every pair of the shipped palette
// (closest: red/orange, 47 in light, 62 in dark) while still rejecting a colour
// that collapsed onto the text or onto its neighbour.
const MIN_DISTANCE = 40

/** `--break-flag=<key>` unsets that colour variable: the negative control. */
const BREAK_FLAG = process.argv.find(a => a.startsWith('--break-flag='))?.split('=')[1] ?? null

const luminance = ([r, g, b]) => {
  const f = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

/**
 * Reads what an icon actually LOOKS like: its computed colour, and the surface
 * behind it (the first opaque ancestor background, with any translucent layers
 * above it composited back in — a selected row tints its own background).
 *
 * Every colour goes through a 1×1 canvas rather than a regex: this theme states
 * its surfaces in `oklch()`, which Chrome hands back verbatim, and reading its
 * three components as if they were r/g/b turns white into near-black — a bench
 * that would then blame the product for a contrast IT miscomputed.
 */
const PAINT_READER = `(sel) => {
  const probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
  const rgba = (css) => {
    probe.clearRect(0, 0, 1, 1)
    probe.fillStyle = css
    probe.fillRect(0, 0, 1, 1)
    const d = probe.getImageData(0, 0, 1, 1).data
    return [d[0], d[1], d[2], d[3] / 255]
  }
  const el = document.querySelector(sel)
  if (!el) return null
  const layers = []
  for (let n = el.parentElement; n; n = n.parentElement) {
    const [r, g, b, a] = rgba(getComputedStyle(n).backgroundColor)
    if (a === 0) continue
    layers.push([r, g, b, a])
    if (a === 1) break
  }
  let surface = [255, 255, 255]
  for (let i = layers.length - 1; i >= 0; i--) {
    const [r, g, b, a] = layers[i]
    surface = [r * a + surface[0] * (1 - a), g * a + surface[1] * (1 - a), b * a + surface[2] * (1 - a)]
  }
  const [r, g, b] = rgba(getComputedStyle(el).color)
  return { color: [r, g, b], surface: surface.map(Math.round) }
}`

for (const f of [new URL('../.env.local', import.meta.url), new URL('../.env', import.meta.url)]) {
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
  }
}
const { SYNAPMAIL_TEST_URL: BASE, SYNAPMAIL_TEST_EMAIL: EMAIL, SYNAPMAIL_TEST_PASSWORD: PASSWORD } = process.env
for (const [k, v] of Object.entries({ SYNAPMAIL_TEST_URL: BASE, SYNAPMAIL_TEST_EMAIL: EMAIL, SYNAPMAIL_TEST_PASSWORD: PASSWORD })) {
  if (!v) { console.error(`HARNESS: ${k} is not set`); process.exit(2) }
}

const { default: pg } = await import('pg')
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const { rows } = await pool.query(
  `SELECT a.* FROM email_accounts a JOIN users u ON u.id = a.user_id
   WHERE u.email = $1 ORDER BY a.created_at LIMIT 1`, [EMAIL])
await pool.end()
const acc = rows[0]
if (!acc) { console.error(`HARNESS: no email account for ${EMAIL}`); process.exit(2) }

const imap = async () => {
  const c = new ImapFlow({
    host: acc.imap_host, port: acc.imap_port, secure: acc.imap_secure,
    auth: { user: acc.username, pass: decrypt(acc.password_encrypted) },
    logger: false, tls: { rejectUnauthorized: false },
  })
  await c.connect()
  return c
}

// --- plant one message of our own in the test folder ---
let uid
{
  const c = await imap()
  try {
    if (!(await c.list()).some(b => b.path === FOLDER)) await c.mailboxCreate(FOLDER)
    await c.mailboxOpen(FOLDER)
    const raw = Buffer.from(
      `From: bench <${acc.email}>\r\nTo: bench <${acc.email}>\r\n` +
      `Subject: check-mail-flags ${Date.now()}\r\nDate: ${new Date().toUTCString()}\r\n` +
      `Message-ID: <check-mail-flags-${Date.now()}@${SCRATCH_DOMAIN}>\r\n\r\nbench message\r\n`)
    uid = String((await c.append(FOLDER, raw, ['\\Seen'])).uid)
  } finally { await c.logout() }
}
console.log(`bench message appended to ${FOLDER}, uid ${uid}`)

const serverFlag = async () => {
  const c = await imap()
  try {
    await c.mailboxOpen(FOLDER)
    const msg = await c.fetchOne(uid, { flags: true }, { uid: true })
    return flagFromKeywords(msg.flags)
  } finally { await c.logout() }
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

  // The active account lives in user_settings, not in the URL: point it at the
  // account the bench planted its message in, or the list would open elsewhere.
  const switched = await page.evaluate(async ({ base, id }) => {
    const res = await fetch(`${base}/api/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active_account_id: id }),
    })
    return res.ok
  }, { base: BASE, id: acc.id })
  if (!switched) { console.error('HARNESS: could not set the active account'); process.exit(2) }

  await page.goto(`${BASE}/mail?folder=${encodeURIComponent(FOLDER)}`, { waitUntil: 'networkidle2' })
  await page.waitForSelector(`[data-mail-row="${uid}"]`, { timeout: 30000 })
  await (await page.$(`[data-mail-row="${uid}"]`)).click()
  await page.waitForSelector('[data-reading-flag]', { timeout: 20000 })

  const openMenu = async () => {
    await page.click('[data-reading-flag]')
    await page.waitForSelector('[data-flag]', { timeout: 5000 })
  }
  const closeMenu = async () => {
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => !document.querySelector('[data-flag]'), { timeout: 5000 })
  }
  const setTheme = async (theme) => {
    await page.evaluate((t) => document.documentElement.classList.toggle('dark', t === 'dark'), theme)
  }
  const readPaint = async (sel) => page.evaluate(new Function(`return ${PAINT_READER}`)(), sel)

  if (BREAK_FLAG) {
    await page.evaluate((key) => {
      document.documentElement.style.setProperty(`--flag-${key}`, 'inherit')
      const s = document.createElement('style')
      s.textContent = `:root, .dark { --flag-${key}: inherit; }`
      document.head.appendChild(s)
    }, BREAK_FLAG)
    console.log(`negative control: --flag-${BREAK_FLAG} unset, this run MUST fail`)
  }

  // --- each of the seven colours: click it, then ASK THE SERVER, then LOOK ---
  // `paints[theme][where][key]` = the rgb the eye would actually see.
  const paints = Object.fromEntries(THEMES.map(t => [t, { menu: {}, row: {} }]))
  const textColor = {}

  for (const f of MAIL_FLAGS) {
    await openMenu()
    for (const theme of THEMES) {
      await setTheme(theme)
      paints[theme].menu[f.key] = await readPaint(`[data-flag="${f.key}"] svg`)
    }
    await setTheme(THEMES[0])
    await page.click(`[data-flag="${f.key}"]`)
    await new Promise(r => setTimeout(r, SETTLE_MS))
    const stored = await serverFlag()
    const ok = stored === f.key
    console.log(`${ok ? 'ok  ' : 'FAIL'} pick ${f.key.padEnd(6)} → server holds ${stored}`)
    if (!ok) failures.push(`picking ${f.key} stored ${stored} on the IMAP server`)

    for (const theme of THEMES) {
      await setTheme(theme)
      paints[theme].row[f.key] = await readPaint(`[data-mail-row="${uid}"] svg.fill-current`)
      // Reference for "the flag is invisible": the subject line right next to it.
      textColor[theme] ??= (await readPaint(`[data-mail-row="${uid}"]`)).color
    }
    await setTheme(THEMES[0])
  }

  // --- the paint itself: distinct, not the text colour, readable ---
  for (const theme of THEMES) {
    for (const where of ['menu', 'row']) {
      const seen = []
      for (const f of MAIL_FLAGS) {
        const paint = paints[theme][where][f.key]
        if (!paint) { failures.push(`${theme}/${where}: ${f.key} was never painted`); continue }
        const rgb = paint.color
        const ratio = contrast(rgb, paint.surface)
        const toText = distance(rgb, textColor[theme])
        const near = seen.find(([, other]) => distance(rgb, other) < MIN_DISTANCE)
        const ok = ratio >= MIN_CONTRAST && toText >= MIN_DISTANCE && !near
        console.log(`${ok ? 'ok  ' : 'FAIL'} ${theme}/${where} ${f.key.padEnd(6)} rgb(${rgb}) on rgb(${paint.surface}) contrast ${ratio.toFixed(2)} vs-text ${toText.toFixed(0)}`)
        if (ratio < MIN_CONTRAST) failures.push(`${theme}/${where}: ${f.key} contrasts ${ratio.toFixed(2)}:1, under ${MIN_CONTRAST}:1`)
        if (toText < MIN_DISTANCE) failures.push(`${theme}/${where}: ${f.key} is the text colour, so it is not painted`)
        if (near) failures.push(`${theme}/${where}: ${f.key} is indistinguishable from ${near[0]}`)
        seen.push([f.key, rgb])
      }
    }
  }

  // --- removing the flag clears it server-side ---
  await openMenu()
  await page.click('[data-flag=""]')
  await new Promise(r => setTimeout(r, SETTLE_MS))
  const cleared = await serverFlag()
  console.log(`${cleared === null ? 'ok  ' : 'FAIL'} remove → server holds ${cleared}`)
  if (cleared !== null) failures.push(`removing the flag left ${cleared} on the IMAP server`)
} finally {
  await browser.close()
  const c = await imap()
  try {
    await c.mailboxOpen(FOLDER)
    await c.messageDelete(uid, { uid: true })
    console.log(`bench message deleted from ${FOLDER}`)
  } finally { await c.logout() }
}

if (BREAK_FLAG) {
  if (failures.length) {
    console.log(`\ncheck-mail-flags: negative control OK — unsetting --flag-${BREAK_FLAG} produced ${failures.length} failure(s)`)
    process.exit(0)
  }
  console.error(`\ncheck-mail-flags: negative control FAILED — the bench passed with --flag-${BREAK_FLAG} unset, so it measures nothing`)
  process.exit(1)
}
if (failures.length) {
  console.error(`\ncheck-mail-flags: ${failures.length} failure(s)`)
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(1)
}
console.log('\ncheck-mail-flags: OK')
