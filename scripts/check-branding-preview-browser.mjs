#!/usr/bin/env node
/**
 * Measures the favicon PREVIEW of the instance-identity section in a real browser, on a
 * running dev server (CodeQL on PR #30, second pass: the type gate alone left the file ->
 * object URL -> `<img src>` flow in place, so the alert stayed). The preview of a picked
 * file is now drawn into a `<canvas>` from its decoded pixels:
 *   - a PNG and an ICO the bench builds itself, dropped on the zone, leave non-transparent
 *     pixels in the canvas and no error on screen;
 *   - a text file renamed `.png` and declared `image/png` is refused on screen (the
 *     translated error) with NO preview, and nothing throws;
 *   - no `blob:` URL is created at any point, and the console stays silent.
 *
 * The bench drives the role itself (the section is admin-only) and puts it back in its
 * `finally`. Nothing is saved: the file is picked, never sent.
 *
 * Exit 0 when everything holds, 1 on a product failure, 2 on a HARNESS error -- no
 * browser, unreachable server, missing bench account -- which says nothing about the product.
 *   node --experimental-strip-types scripts/check-branding-preview-browser.mjs
 */
import { existsSync, readFileSync } from 'node:fs'
import pg from 'pg'
import puppeteer from 'puppeteer-core'
import { onePixelIco, onePixelPng } from './bench-png.mjs'

/** Read in the sources that carry them, never restated here (Node cannot import a `.tsx`). */
const literal = (file, name) => {
  const src = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
  const m = src.match(new RegExp(`export const ${name} = '([^']+)'`))
  if (!m) { console.error(`HARNESS: ${name} not found in ${file}`); process.exit(2) }
  return m[1]
}
const BRANDING_ANCHOR = literal('components/admin/BrandingSection.tsx', 'BRANDING_ANCHOR')
const APPEARANCE_HREF = literal('components/settings/SettingsSidebar.tsx', 'APPEARANCE_HREF')
/** The type error as each locale words it: the bench account's language is not the bench's business. */
const BAD_TYPE_MESSAGES = ['en', 'fr', 'zh'].map(locale =>
  JSON.parse(readFileSync(new URL(`../locales/${locale}.json`, import.meta.url), 'utf8')).admin.branding.errors.branding_bad_type)

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const VIEWPORT = { width: 1440, height: 900 }
const SETTLE_MS = 600

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
const check = (cond, msg) => {
  if (cond) console.log(`ok   ${msg}`)
  else { failures.push(msg); console.log(`FAIL ${msg}`) }
}

if (!existsSync(CHROME)) { console.error('HARNESS: no browser'); process.exit(2) }
const db = new pg.Client({ connectionString: DB_URL })
let browser
try {
  browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] })
} catch (e) { console.error(`HARNESS: browser — ${e.message}`); process.exit(2) }

const login = page => page.goto(`${BASE}/login`, { waitUntil: 'networkidle2' }).then(() =>
  page.evaluate(async ({ base, email, password }) => {
    const { csrfToken } = await (await fetch(`${base}/api/auth/csrf`)).json()
    const res = await fetch(`${base}/api/auth/callback/credentials`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ csrfToken, email, password, json: 'true' }),
    })
    return res.ok
  }, { base: BASE, email: EMAIL, password: PASSWORD }))

/**
 * Drop a file the bench built on the zone (a real `drop` event with a `DataTransfer`,
 * the path a human's drag takes), then read what the section shows: the canvas's
 * non-transparent pixel count, whether the saved-icon `<img>` is still shown, and
 * the error line, if any.
 */
const drop = (page, { name, type, bytes }) => page.evaluate(async ({ anchor, name, type, bytes }) => {
  const section = document.getElementById(anchor)
  const zone = section.querySelector('[data-favicon-drop]')
  const dt = new DataTransfer()
  dt.items.add(new File([Uint8Array.from(bytes)], name, { type }))
  zone.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
  await new Promise(r => setTimeout(r, 600))
  const canvas = section.querySelector('canvas')
  const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
  let opaque = 0
  for (let i = 3; i < data.length; i += 4) if (data[i] > 0) opaque++
  const img = section.querySelector('img')
  return {
    opaque,
    canvasShown: canvas.checkVisibility(),
    imgShown: img ? img.checkVisibility() : false,
    imgSrc: img?.getAttribute('src') ?? null,
    error: section.querySelector('.text-destructive')?.textContent ?? null,
    fileName: zone.textContent,
  }
}, { anchor: BRANDING_ANCHOR, name, type, bytes: Array.from(bytes) })

const setRole = role => db.query('UPDATE users SET role = $1 WHERE email = $2', [role, EMAIL])
let originalRole = null
const consoleErrors = []
const blobUrls = []
try {
  await db.connect().catch(e => { console.error(`HARNESS: database — ${e.message}`); process.exit(2) })
  const bench = await db.query('SELECT role FROM users WHERE email = $1', [EMAIL])
  if (!bench.rows.length) { console.error('HARNESS: the bench account does not exist'); process.exit(2) }
  originalRole = bench.rows[0].role
  await setRole('admin')

  const page = await browser.newPage()
  await page.setViewport(VIEWPORT)
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()) })
  page.on('pageerror', e => consoleErrors.push(`pageerror: ${e.message}`))
  if (!(await login(page))) { console.error('HARNESS: login refused'); process.exit(2) }
  await page.goto(`${BASE}${APPEARANCE_HREF}#${BRANDING_ANCHOR}`, { waitUntil: 'networkidle2' })
  await page.waitForSelector(`#${BRANDING_ANCHOR} [data-favicon-drop]`)
  // Every object URL the page would create from now on is recorded: there must be none.
  await page.evaluate(() => {
    const original = URL.createObjectURL.bind(URL)
    window.__blobUrls = []
    URL.createObjectURL = o => { const u = original(o); window.__blobUrls.push(u); return u }
  })
  await new Promise(r => setTimeout(r, SETTLE_MS))

  console.log('== before any pick: the saved icon, from the server ==')
  const before = await page.evaluate(anchor => {
    const section = document.getElementById(anchor)
    const img = section.querySelector('img')
    return { imgShown: img ? img.checkVisibility() : false, canvasShown: section.querySelector('canvas')?.checkVisibility() ?? null }
  }, BRANDING_ANCHOR)
  check(before.imgShown, 'the saved icon <img> is shown')
  check(before.canvasShown === false, 'the preview canvas is in the DOM but hidden')

  console.log('== a PNG the bench built, dropped on the zone ==')
  const png = await drop(page, { name: 'bench.png', type: 'image/png', bytes: onePixelPng() })
  check(png.opaque > 0, `the canvas holds non-transparent pixels (${png.opaque})`)
  check(png.canvasShown && !png.imgShown, 'the canvas replaces the saved-icon <img> (one preview at a time)')
  check(png.error === null, 'no error on screen')
  check(png.fileName.includes('bench.png'), 'the zone names the picked file')

  console.log('== an ICO the bench built, dropped on the zone ==')
  const ico = await drop(page, { name: 'bench.ico', type: 'image/vnd.microsoft.icon', bytes: onePixelIco() })
  check(ico.opaque > 0, `the canvas holds non-transparent pixels (${ico.opaque})`)
  check(ico.error === null, 'no error on screen')

  console.log('== a text file renamed .png, declared image/png: refused, no preview ==')
  const txt = await drop(page, { name: 'notes.png', type: 'image/png', bytes: Buffer.from('this is not an image') })
  check(BAD_TYPE_MESSAGES.includes(txt.error), `the translated type error is shown (got ${JSON.stringify(txt.error)})`)
  check(txt.opaque === 0, `the canvas was cleared (${txt.opaque} opaque pixels)`)
  check(!txt.canvasShown && txt.imgShown, 'the saved-icon <img> is back, the canvas hidden')
  check(!txt.fileName.includes('notes.png'), 'the refused file is not named as picked')

  console.log('== no URL was ever derived from a file ==')
  const blobs = await page.evaluate(() => window.__blobUrls)
  blobUrls.push(...blobs)
  check(blobs.length === 0, `createObjectURL was never called (${blobs.length} call(s))`)
  check(txt.imgSrc !== null && !txt.imgSrc.startsWith('blob:'), `the only <img src> is the server icon (${txt.imgSrc})`)
  check(consoleErrors.length === 0, `console: 0 error (${consoleErrors.length}${consoleErrors.length ? ': ' + consoleErrors.join(' | ') : ''})`)
} finally {
  try { if (originalRole !== null) await setRole(originalRole) }
  catch (e) { console.error(`HARNESS: role not restored — ${e.message}`) }
  await db.end().catch(() => {})
  await browser.close().catch(() => {})
}

console.log(failures.length === 0 ? '\ncheck-branding-preview-browser: OK' : `\ncheck-branding-preview-browser: ${failures.length} FAIL`)
process.exit(failures.length === 0 ? 0 : 1)
