#!/usr/bin/env node
/**
 * Measures the instance identity end to end, on a running dev server: an admin uploads a 1-pixel PNG the
 * script builds itself, and the browser tab actually changes -- the `<link rel=icon>` points
 * at the instance route, that route returns EXACTLY those bytes with the detected type and
 * `nosniff`, the tab title carries the chosen name, and the LOGGED-OUT login page shows the
 * same name and the same icon. A non-admin gets 403. Both resets put the original look back.
 *
 * The bench restores the default name and icon in its `finally`, so it leaves the instance
 * as it found it.
 *
 * Exit 0 when everything holds, 1 on a product failure, 2 on a HARNESS error -- a missing
 * browser, an unreachable server, a database without an admin -- which says nothing about
 * the product.
 *   node scripts/check-branding-live.mjs
 */
import { existsSync, readFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import pg from 'pg'
import puppeteer from 'puppeteer-core'
import { BUNDLED_FAVICONS, DEFAULT_APP_NAME, FAVICON_PATH, detectImageType } from '../lib/branding.ts'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const VIEWPORT = { width: 1440, height: 900 }
/** A name that cannot be the default, so "the tab shows the chosen name" cannot pass by accident. */
const CHOSEN_NAME = 'Acme Mail Bench'
const HTTP_FORBIDDEN = 403
const HTTP_NOT_FOUND = 404
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

/**
 * A real 1x1 PNG, built here rather than read from disk: the bytes the bench uploads are
 * the bytes it compares against, so "the route serves exactly what was stored" is measured
 * and not assumed.
 */
function onePixelPng() {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = buf => {
    let c = 0xffffffff
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body))
    return Buffer.concat([len, body, sum])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4)
  ihdr[8] = 8; ihdr[9] = 2 // 8-bit, truecolour
  // One scanline: filter byte 0, then an opaque violet pixel.
  const idat = deflateSync(Buffer.from([0, 0x7c, 0x3a, 0xed]))
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0)),
  ])
}

const PNG = onePixelPng()
if (detectImageType(PNG) !== 'image/png') {
  console.error('HARNESS: the PNG this bench builds is not detected as a PNG')
  process.exit(2)
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] })
  .catch(e => { console.error(`HARNESS: cannot launch Chrome — ${e.message}`); process.exit(2) })

const db = new pg.Client({ connectionString: DB_URL })
let page

/** Upload through the admin route, from inside the page so the session cookie rides along. */
const put = (session, { appName, bytes }) => session.evaluate(async ({ base, appName, bytes }) => {
  const form = new FormData()
  if (appName !== null) form.set('appName', appName)
  if (bytes !== null) form.set('favicon', new File([Uint8Array.from(bytes)], 'icon.svg', { type: 'image/svg+xml' }))
  const res = await fetch(`${base}/api/admin/branding`, { method: 'PUT', body: form })
  return { status: res.status, body: await res.json().catch(() => null) }
}, { base: BASE, appName: appName ?? null, bytes: bytes ? Array.from(bytes) : null })

const reset = (session, target) => session.evaluate(async ({ base, target }) => {
  const res = await fetch(`${base}/api/admin/branding?target=${target}`, { method: 'DELETE' })
  return { status: res.status, body: await res.json().catch(() => null) }
}, { base: BASE, target })

/** The icon route, read as raw bytes plus the headers that decide how a browser treats them. */
const readIcon = (session, url) => session.evaluate(async target => {
  const res = await fetch(target, { cache: 'no-store' })
  return {
    status: res.status,
    type: res.headers.get('content-type'),
    nosniff: res.headers.get('x-content-type-options'),
    cache: res.headers.get('cache-control'),
    bytes: Array.from(new Uint8Array(await res.arrayBuffer())),
  }
}, url)

const iconHref = session => session.evaluate(() =>
  document.querySelector('link[rel~="icon"]')?.getAttribute('href') ?? null)

/** EVERY icon link the page currently declares, in order -- a reset must restore them all. */
const iconHrefs = session => session.evaluate(() =>
  [...document.querySelectorAll('link[rel~="icon"]')].map(l => l.getAttribute('href') ?? ''))

/** The admin screen's own button, found by its marker so the bench does not depend on a language. */
const clickReset = async (session, target) => {
  await session.click(`[data-branding-reset="${target}"]`)
  await new Promise(r => setTimeout(r, SETTLE_MS))
}

const login = async (session, email, password) => {
  await session.goto(`${BASE}/login`, { waitUntil: 'networkidle2' })
  return session.evaluate(async ({ base, email, password }) => {
    const { csrfToken } = await (await fetch(`${base}/api/auth/csrf`)).json()
    const res = await fetch(`${base}/api/auth/callback/credentials`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ csrfToken, email, password, json: 'true' }),
    })
    return res.ok
  }, { base: BASE, email, password })
}

/** The bench account's role as found, put back in the `finally` whatever happens. */
let originalRole = null

try {
  await db.connect().catch(e => { console.error(`HARNESS: database — ${e.message}`); process.exit(2) })
  const bench = await db.query('SELECT id, role FROM users WHERE email = $1', [EMAIL])
  if (!bench.rows.length) { console.error('HARNESS: the bench account does not exist'); process.exit(2) }
  const benchId = bench.rows[0].id
  // The bench needs BOTH sides of the guard, so it drives the role itself and puts back
  // exactly what it found -- including when the account was not an admin to begin with.
  originalRole = bench.rows[0].role
  await db.query("UPDATE users SET role = 'admin' WHERE id = $1", [benchId])

  page = await browser.newPage()
  await page.setViewport(VIEWPORT)
  if (!(await login(page, EMAIL, PASSWORD))) { console.error('HARNESS: credentials login failed'); process.exit(2) }

  console.log('== nothing set: the original look ==')
  await reset(page, 'name')
  await reset(page, 'favicon')
  await page.goto(`${BASE}/mail`, { waitUntil: 'networkidle2' })
  check(await page.title() === DEFAULT_APP_NAME, `tab title is "${DEFAULT_APP_NAME}"`)
  const bundled = await iconHref(page)
  check(bundled !== null && !bundled.startsWith(FAVICON_PATH), `icon is the bundled file (${bundled})`)
  const missing = await readIcon(page, `${BASE}${FAVICON_PATH}`)
  check(missing.status === HTTP_NOT_FOUND, `icon route answers ${HTTP_NOT_FOUND} with nothing stored (got ${missing.status})`)

  console.log('== an admin saves a name and an icon ==')
  // The file is deliberately announced as `icon.svg` / `image/svg+xml`: if the extension or
  // the declared type were trusted, this upload would be REFUSED. It must be accepted on its
  // bytes, and stored as image/png.
  const saved = await put(page, { appName: CHOSEN_NAME, bytes: PNG })
  check(saved.status === 200, `upload accepted (status ${saved.status})`)
  check(saved.body?.data?.appName === CHOSEN_NAME, 'the saved name comes back')
  const version = saved.body?.data?.faviconVersion
  check(typeof version === 'number' && version > 0, `the icon carries a version (${version})`)

  console.log('== the tab actually changes ==')
  await page.goto(`${BASE}/mail`, { waitUntil: 'networkidle2' })
  await new Promise(r => setTimeout(r, SETTLE_MS))
  check(await page.title() === CHOSEN_NAME, `tab title is "${CHOSEN_NAME}" (got "${await page.title()}")`)
  const href = await iconHref(page)
  check(href?.startsWith(FAVICON_PATH) === true, `icon points at the instance route (${href})`)
  check(href?.includes(String(version)) === true, 'the icon URL carries the version')

  console.log('== the route serves exactly those bytes ==')
  const served = await readIcon(page, `${BASE}${href}`)
  check(served.status === 200, `icon route answers 200 (got ${served.status})`)
  check(served.type === 'image/png', `served as the DETECTED type image/png, not the declared image/svg+xml (got ${served.type})`)
  check(served.nosniff === 'nosniff', `X-Content-Type-Options: nosniff (got ${served.nosniff})`)
  check(Buffer.from(served.bytes).equals(PNG), `byte-for-byte the uploaded file (${served.bytes.length} of ${PNG.length} bytes)`)
  check(served.cache?.includes('immutable') === true, `cache is long and immutable (${served.cache})`)

  console.log('== the login page, logged out, shows the same identity ==')
  const anon = await browser.createBrowserContext()
  const anonPage = await anon.newPage()
  await anonPage.setViewport(VIEWPORT)
  await anonPage.goto(`${BASE}/login`, { waitUntil: 'networkidle2' })
  check(await anonPage.title() === CHOSEN_NAME, `logged-out tab title is "${CHOSEN_NAME}" (got "${await anonPage.title()}")`)
  const anonHref = await iconHref(anonPage)
  check(anonHref?.startsWith(FAVICON_PATH) === true, `logged-out icon points at the instance route (${anonHref})`)
  const anonIcon = await readIcon(anonPage, `${BASE}${anonHref}`)
  check(anonIcon.status === 200, `logged-out, the icon route answers 200 (got ${anonIcon.status})`)
  check(Buffer.from(anonIcon.bytes).equals(PNG), 'logged-out, the same bytes are served')
  const anonName = await anonPage.$eval('h1', h => h.textContent?.trim() ?? '')
  check(anonName === CHOSEN_NAME, `the login heading shows the chosen name (got "${anonName}")`)
  await anon.close()

  console.log('== refusals ==')
  const tooBig = await put(page, { appName: null, bytes: Buffer.alloc(300 * 1024, 0x41) })
  check(tooBig.body?.error === 'branding_too_large', `300 KiB refused as branding_too_large (got ${tooBig.body?.error})`)
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>', 'utf8')
  const badType = await put(page, { appName: null, bytes: svg })
  check(badType.body?.error === 'branding_bad_type', `an SVG announced as a PNG is refused (got ${badType.body?.error})`)
  const badName = await put(page, { appName: '   ', bytes: null })
  check(badName.body?.error === 'branding_bad_name', `a blank name is refused (got ${badName.body?.error})`)
  // The refusals must not have changed anything: the icon on file is still the PNG.
  const untouched = await readIcon(page, `${BASE}${FAVICON_PATH}?v=${version}`)
  check(Buffer.from(untouched.bytes).equals(PNG), 'a refused upload left the stored icon untouched')

  console.log('== a non-admin is refused ==')
  await db.query("UPDATE users SET role = 'user' WHERE id = $1", [benchId])
  const plain = await browser.createBrowserContext()
  const plainPage = await plain.newPage()
  await plainPage.setViewport(VIEWPORT)
  if (!(await login(plainPage, EMAIL, PASSWORD))) { console.error('HARNESS: the demoted account cannot log in'); process.exit(2) }
  const denied = await put(plainPage, { appName: 'Not allowed', bytes: PNG })
  check(denied.status === HTTP_FORBIDDEN, `a non-admin PUT gets ${HTTP_FORBIDDEN} (got ${denied.status})`)
  const deniedReset = await reset(plainPage, 'name')
  check(deniedReset.status === HTTP_FORBIDDEN, `a non-admin DELETE gets ${HTTP_FORBIDDEN} (got ${deniedReset.status})`)
  // A non-admin still READS the icon: the route is public on purpose.
  const stillReadable = await readIcon(plainPage, `${BASE}${FAVICON_PATH}?v=${version}`)
  check(stillReadable.status === 200, `the icon stays readable for everyone (got ${stillReadable.status})`)
  await plain.close()
  await db.query("UPDATE users SET role = 'admin' WHERE id = $1", [benchId])

  console.log('== the screen\'s own reset buttons restore EVERY bundled link, without a reload ==')
  // A visual check found that after "restore the default icon" the page kept only ONE of the two
  // bundled links until a reload. The bench now drives the BUTTON, not the route, and reads
  // the links the page really declares -- compared against the shipped list itself.
  await page.goto(`${BASE}/admin/users`, { waitUntil: 'networkidle2' })
  await page.waitForSelector('[data-branding-reset="favicon"]')
  const set = await put(page, { appName: CHOSEN_NAME, bytes: PNG })
  check(set.status === 200, `the bench re-sets an identity to reset from (status ${set.status})`)
  await page.reload({ waitUntil: 'networkidle2' })
  await page.waitForSelector('[data-branding-reset="favicon"]')
  await clickReset(page, 'favicon')
  const restored = await iconHrefs(page)
  const expected = BUNDLED_FAVICONS.map(i => i.url)
  check(
    JSON.stringify(restored) === JSON.stringify(expected),
    `after the icon reset, and WITHOUT a reload, the page declares every bundled link (got ${JSON.stringify(restored)}, want ${JSON.stringify(expected)})`
  )
  await clickReset(page, 'name')
  const titleAfterButton = await page.title()
  check(titleAfterButton === DEFAULT_APP_NAME, `after the name reset, and WITHOUT a reload, the tab reads "${DEFAULT_APP_NAME}" (got "${titleAfterButton}")`)

  console.log('== both resets put the original look back ==')
  const afterName = await reset(page, 'name')
  check(afterName.body?.data?.appName === DEFAULT_APP_NAME, `"restore the default name" gives back ${DEFAULT_APP_NAME}`)
  const afterIcon = await reset(page, 'favicon')
  check(afterIcon.body?.data?.faviconVersion === null, 'restoring the default icon clears the version')
  await page.goto(`${BASE}/mail`, { waitUntil: 'networkidle2' })
  check(await page.title() === DEFAULT_APP_NAME, `the tab title is back to "${DEFAULT_APP_NAME}"`)
  const backHref = await iconHref(page)
  check(backHref !== null && !backHref.startsWith(FAVICON_PATH), `the icon is the bundled file again (${backHref})`)
  const gone = await readIcon(page, `${BASE}${FAVICON_PATH}`)
  check(gone.status === HTTP_NOT_FOUND, `the icon route answers ${HTTP_NOT_FOUND} again (got ${gone.status})`)
} finally {
  // Whatever happened above, leave the instance on its defaults and the account an admin.
  try {
    if (originalRole !== null) await db.query('UPDATE users SET role = $1 WHERE email = $2', [originalRole, EMAIL])
    await db.query('UPDATE instance_settings SET app_name = NULL, favicon = NULL, favicon_type = NULL, favicon_updated_at = NULL WHERE id = TRUE')
  } catch (e) {
    console.error(`HARNESS: could not restore defaults — ${e.message}`)
  }
  await db.end().catch(() => {})
  await browser.close().catch(() => {})
}

console.log(failures.length === 0 ? '\ncheck-branding-live: OK' : `\ncheck-branding-live: ${failures.length} FAIL`)
process.exit(failures.length === 0 ? 0 : 1)
