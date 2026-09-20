#!/usr/bin/env node
/**
 * Measures that the six other settings screens carry no bin on a row either. Each one
 * now opens the SAME discreet "..." menu as the accounts screen, and each
 * confirmation NAMES the object it is about to remove.
 *
 * NOTHING PRE-EXISTING IS EVER DELETED by this bench: every DELETE request is intercepted
 * and aborted before it leaves the browser, and every confirmation is dismissed unless the
 * bench explicitly arms an acceptance. A key, signature, template, contact or rule really
 * removed here would be user data lost.
 *
 * A screen with no row cannot be measured, so the bench SEEDS one through the API. Every
 * row it seeds is removed in the `finally`, directly in the database: the page's only
 * delete path is the intercepted one, and revoking an API key through the route would
 * leave the row behind anyway. The bench leaves the database as it found it.
 *
 * Fails (exit 1) on any mismatch. Exits 2 on a HARNESS error — a missing browser, an
 * unreachable server — which says nothing about the product.
 *
 * Needs a running dev server and SYNAPMAIL_TEST_* credentials (see .env).
 *   node scripts/check-settings-row-menus.mjs
 */
import { existsSync, readFileSync } from 'node:fs'
import pg from 'pg'
import puppeteer from 'puppeteer-core'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
// The name every seeded row wears, so the `finally` can find them all again by one value.
const SEED_NAME = 'bench-row-menu'
const VIEWPORT = { width: 1440, height: 900 }
const SETTLE_MS = 400

/**
 * A throwaway PGP public key, generated once for this bench and used nowhere else. The
 * contact keys screen has no row unless one is imported, and a screen with no row is a
 * screen this bench cannot measure. Only the PUBLIC half exists — there is no private
 * key to leak, and the address is in the reserved `.invalid` domain, so nothing can be
 * encrypted to a real person with it.
 */
const BENCH_PGP_FINGERPRINT = 'c3a3e52386ad8b1e6913129352a19d99451a70c0'
const BENCH_PGP_KEY = `-----BEGIN PGP PUBLIC KEY BLOCK-----

xjMEaq5tWBYJKwYBBAHaRw8BAQdAtHYI1M4p5gKIHzRvuMmq96LjmdO6qy2i
1lxYSavknvDNL2JlbmNoLXJvdy1tZW51IDxiZW5jaC1yb3ctbWVudUBleGFt
cGxlLmludmFsaWQ+wsATBBMWCgCFBYJqrm1YAwsJBwkQUqGdmUUacMBFFAAA
AAAAHAAgc2FsdEBub3RhdGlvbnMub3BlbnBncGpzLm9yZ+opL6ZI3AH/3DUI
XPjH10ngAG4ZzyU1SG70HzLlCAbbBRUKCA4MBBYAAgECGQECmwMCHgEWIQTD
o+Ujhq2LHmkTEpNSoZ2ZRRpwwAAASokA/RPHDWZPy16QH0eUbbYrQaO/vru9
JOA8MUPae0kNJ9n7AQDmmUA3paj/D40XOlWjPYTBgRiczUI8q7x7jRgl6kCc
Bs44BGqubVgSCisGAQQBl1UBBQEBB0D9pOffj29nq34/6BTQvUFZQr194/zQ
KriKzahoL/1lLQMBCAfCvgQYFgoAcAWCaq5tWAkQUqGdmUUacMBFFAAAAAAA
HAAgc2FsdEBub3RhdGlvbnMub3BlbnBncGpzLm9yZ68tTIo0o75g6mPcCTry
WuVgFF1zUWmtegkHt8NNZ/WvApsMFiEEw6PlI4atix5pExKTUqGdmUUacMAA
AEY2APkBulgbXTptWPIF0iFpKGBj2N9rU+I+2Vzooj83vuFvFAEArML1mAtC
aF2fEOKnsf+tDT5IyGatY50GBWnO1D01ugs=
=wc2f
-----END PGP PUBLIC KEY BLOCK-----`

/**
 * The screens this lot converts, plus the accounts screen it copies — measured together
 * so a regression on either side shows up in the same run. `probe` is what proves the
 * screen finished loading; `seed` creates one row through the API when the screen is
 * empty, so the bench measures a real row instead of quietly skipping the screen.
 */
const SCREENS = [
  {
    key: 'accounts', path: '/settings/accounts',
    list: '/api/accounts', rowsOf: d => d.filter(a => !a.isShared),
    entries: 'share,edit,delete', nameOf: a => a.name || a.email, confirmNeedle: a => a.email,
  },
  {
    key: 'api-keys', path: '/settings/api-keys',
    list: '/api/api-keys', rowsOf: d => d,
    entries: 'revoke', nameOf: k => k.name, confirmNeedle: k => k.name,
    seed: { url: '/api/api-keys', table: 'api_keys', body: { name: SEED_NAME } },
  },
  {
    key: 'signatures', path: '/settings/signatures',
    list: '/api/signatures', rowsOf: d => d,
    entries: 'edit,delete', nameOf: s => s.name, confirmNeedle: s => s.name,
    seed: { url: '/api/signatures', table: 'signatures', body: { name: SEED_NAME, contentHtml: '<p>bench</p>' } },
  },
  {
    key: 'templates', path: '/settings/templates',
    list: '/api/templates', rowsOf: d => d,
    entries: 'edit,delete', nameOf: t => t.name, confirmNeedle: t => t.name,
    seed: { url: '/api/templates', table: 'compose_templates', body: { name: SEED_NAME, subject: 'bench', contentHtml: '<p>bench</p>' } },
  },
  {
    key: 'contacts', path: '/settings/contacts',
    list: '/api/contacts', rowsOf: d => d,
    entries: 'edit,delete', nameOf: c => c.name || c.email, confirmNeedle: c => c.name || c.email,
  },
  {
    key: 'rules', path: '/settings/rules',
    list: '/api/rules', rowsOf: d => d,
    entries: 'edit,delete', nameOf: r => r.name, confirmNeedle: r => r.name,
    seed: {
      url: '/api/rules', table: 'email_rules',
      body: {
        name: SEED_NAME, conditionLogic: 'all',
        conditions: [{ field: 'from', operator: 'contains', value: `${SEED_NAME}.invalid` }],
        actions: [{ type: 'star' }],
      },
    },
  },
  {
    key: 'pgp', path: '/settings/pgp',
    list: '/api/pgp/contacts', rowsOf: d => d,
    entries: 'delete', nameOf: c => c.name || c.email, confirmNeedle: c => c.name || c.email,
    seed: {
      url: '/api/pgp/contacts', table: 'pgp_public_keys',
      body: {
        email: `${SEED_NAME}@example.invalid`, name: SEED_NAME,
        fingerprint: BENCH_PGP_FINGERPRINT, armoredKey: BENCH_PGP_KEY,
      },
    },
  },
]

/** The tables a seed can write to, read off SCREENS so the cleanup check can never drift
 *  from the seeds themselves. */
const SEED_TABLES = [...new Set(SCREENS.filter(s => s.seed).map(s => s.seed.table))]

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
  DATABASE_URL: DB_URL,
} = process.env
for (const [k, v] of Object.entries({
  SYNAPMAIL_TEST_URL: BASE, SYNAPMAIL_TEST_EMAIL: EMAIL, SYNAPMAIL_TEST_PASSWORD: PASSWORD,
  DATABASE_URL: DB_URL,
})) {
  if (!v) { console.error(`HARNESS: ${k} is not set`); process.exit(2) }
}

const failures = []
const ok = msg => console.log(`ok   ${msg}`)
const fail = msg => { failures.push(msg); console.log(`FAIL ${msg}`) }
const check = (cond, msg) => (cond ? ok(msg) : fail(msg))

const settle = () => new Promise(r => setTimeout(r, SETTLE_MS))

/**
 * Opens a row's menu and waits for the entry to actually exist before clicking it. A
 * fixed delay guesses how fast the screen re-renders; on a screen that re-renders after
 * a refused confirmation the guess was wrong and the click hit nothing, which reads as a
 * product failure when it is only the bench being early.
 */
/** Waits until the page has actually raised a new confirmation, and returns its text.
 *  Reading `confirmations.at(-1)` straight after the click can return the PREVIOUS
 *  screen's message when the dialog event has not been dispatched yet — an assertion
 *  that then passes on another screen's text, which is worse than failing. */
const confirmationAfter = async before => {
  for (let i = 0; i < 40 && confirmations.length === before; i++) {
    await new Promise(r => setTimeout(r, 50))
  }
  return confirmations.length > before ? confirmations.at(-1) : null
}

/**
 * Where the OPEN menu really is, and whether it can be clicked. Reading only that the
 * surface exists in the DOM says nothing about it being reachable: measured on the pgp
 * screen, the surface existed while sitting 237 px right and 469 px below the window,
 * because `position: fixed` had latched onto an ancestor carrying `backdrop-filter`
 * instead of the window. So this reads the rectangle AND hit-tests the middle of it.
 */
const measureOpenMenu = rowId => page.evaluate(id => {
  const surface = document.querySelector(`[data-row-menu-surface="${id}"]`)
  if (!surface) return null
  const b = surface.getBoundingClientRect()
  const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2)
  return {
    left: Math.round(b.left), top: Math.round(b.top),
    right: Math.round(b.right), bottom: Math.round(b.bottom),
    vw: window.innerWidth, vh: window.innerHeight,
    // `contains` covers the surface itself and every entry inside it.
    hitIsMenu: hit !== null && surface.contains(hit),
  }
}, rowId)

/** How much window is left under the trigger for the bottom-edge check, in px. */
const BOTTOM_EDGE_GAP = 20

/**
 * Shortens the window until the given trigger sits at its bottom edge, and returns the
 * pixels left underneath so the caller can assert the squeeze really happened. Returns
 * null when the trigger is gone. Restoring the viewport is the caller's business.
 */
const squeezeViewportUnder = async selector => {
  const box = await page.$eval(selector, el => el.getBoundingClientRect().bottom).catch(() => null)
  if (box === null) return null
  await page.setViewport({ ...VIEWPORT, height: Math.max(200, Math.round(box + BOTTOM_EDGE_GAP)) })
  await settle()
  return page.evaluate(sel => {
    const el = document.querySelector(sel)
    if (!el) return null
    return Math.round(window.innerHeight - el.getBoundingClientRect().bottom)
  }, selector)
}

/** Reads the two things a menu must satisfy wherever it opens, and says so in one line. */
const checkMenuReachable = (screenKey, where, m) => {
  if (m === null) { fail(`${screenKey}: the menu did not open ${where}`); return }
  const inWindow = m.left >= 0 && m.top >= 0 && m.right <= m.vw && m.bottom <= m.vh
  check(inWindow,
    `${screenKey}: the open menu is entirely inside the window ${where} — (${m.left},${m.top})-(${m.right},${m.bottom}) in ${m.vw}x${m.vh}`)
  check(m.hitIsMenu,
    `${screenKey}: the middle of the open menu is actually the menu, not something on top of it ${where}`)
}

const openMenuAndClick = async (path, rowId, itemKey) => {
  // Reload before every interaction. The lists revalidate in the background, so a row's
  // DOM can be swapped out between the scroll and the click; the retries that swap
  // produced were the bench fighting its own leftover state, not the product. A fresh
  // page has exactly one state: menu closed, row at a known place.
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle2' })
  const trigger = `[data-row-menu="${rowId}"]`
  const item = `[data-row-menu-surface="${rowId}"] [data-menu-item="${itemKey}"]`
  await page.waitForSelector(trigger, { visible: true, timeout: 20000 })
  // The pgp screen puts its list above a long import form, so the row can sit off-screen;
  // an off-screen trigger is not clickable.
  await page.$eval(trigger, el => el.scrollIntoView({ block: 'center' }))
  await settle()
  await page.click(trigger)
  await page.waitForSelector(item, { visible: true, timeout: 10000 })
  await page.click(item)
  await settle()
}

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
/** Every row this run created, so the `finally` can remove each one. `{ table, id }`. */
const seeded = []
/** Set when the run dies on a harness error, so the exit can wait for the cleanup below. */
let harnessError = null
const db = new pg.Client({ connectionString: DB_URL })

try {
  await db.connect()
  page = await browser.newPage()
  await page.setViewport(VIEWPORT)

  await page.setRequestInterception(true)
  page.on('request', req => {
    if (req.method() === 'DELETE') {
      blockedDeletes.push(new URL(req.url()).pathname)
      // `abort`, not `respond`: nothing reaches the server, so no key, signature,
      // template, contact or rule can be removed by this bench.
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

  const read = (url, account) => page.evaluate(async ({ base, url, account }) => {
    const qs = account ? `?account=${account}` : ''
    const res = await fetch(`${base}${url}${qs}`)
    if (!res.ok) return []
    return (await res.json()).data ?? []
  }, { base: BASE, url, account })

  // Rules and PGP contact keys are scoped to a mailbox / need one to exist; read it once.
  const accounts = (await read('/api/accounts')).filter(a => !a.isShared)
  if (accounts.length === 0) { console.error('HARNESS: this database has no owned mailbox'); process.exit(2) }
  const accountId = accounts[0].id

  for (const screen of SCREENS) {
    const scoped = screen.key === 'rules' ? accountId : undefined
    let rows = screen.rowsOf(await read(screen.list, scoped))

    if (rows.length === 0 && screen.seed) {
      await page.evaluate(async ({ base, url, body }) => {
        await fetch(`${base}${url}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
      }, { base: BASE, url: screen.seed.url, body: { ...screen.seed.body, accountId } })
      rows = screen.rowsOf(await read(screen.list, scoped))
      // Remembered BEFORE anything can fail below: a row created and then forgotten is
      // real user data left in the database, which is what this ledger exists to prevent.
      for (const r of rows) seeded.push({ table: screen.seed.table, id: r.id })
    }
    if (rows.length === 0) {
      // A screen with no row is NOT measured. Reporting it as a pass would tell a reader
      // the screen was checked when nothing was looked at, so it fails instead.
      fail(`${screen.key}: no row to measure, and seeding one did not produce one — this screen was NOT measured`)
      continue
    }
    const row = rows[0]

    await page.goto(`${BASE}${screen.path}`, { waitUntil: 'networkidle2' })
    await page.waitForSelector(`[data-row-menu="${row.id}"]`, { timeout: 20000 })
      .catch(() => {})
    await settle()

    // ── 1. No bin drawn on the screen at rest ────────────────────────────────
    // Scoped to `[data-settings-page]`: the sidebar's own bin is the Trash FOLDER, which
    // no settings lot touches. Counting it would accuse the settings screen of a bin it
    // does not draw.
    const restingBins = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-settings-page] svg')).filter(s => {
        if (!/trash/i.test(s.getAttribute('class') ?? '')) return false
        const box = s.getBoundingClientRect()
        return box.width > 0 && box.height > 0
      }).length)
    check(restingBins === 0, `${screen.key}: no bin icon is drawn at rest — found ${restingBins}`)

    // ── 2. The trigger announces itself ──────────────────────────────────────
    const trigger = await page.$eval(`[data-row-menu="${row.id}"]`, el => ({
      haspopup: el.getAttribute('aria-haspopup'),
      expanded: el.getAttribute('aria-expanded'),
      label: el.getAttribute('aria-label'),
      nativeTitle: el.getAttribute('title'),
      tabbable: el.tabIndex >= 0 && !el.disabled,
    })).catch(() => null)
    if (!trigger) {
      fail(`${screen.key}: the row carries no "..." button`)
      continue
    }
    check(trigger.haspopup === 'menu' && trigger.expanded === 'false' && trigger.tabbable,
      `${screen.key}: the "..." button announces a closed menu and is reachable with Tab — aria-haspopup="${trigger.haspopup}", aria-expanded="${trigger.expanded}"`)
    check(Boolean(trigger.label) && trigger.label.includes(screen.nameOf(row)),
      `${screen.key}: the "..." button names its row — aria-label="${trigger.label}"`)
    check(trigger.nativeTitle === null,
      `${screen.key}: the tooltip is the house one, not a native title — title=${JSON.stringify(trigger.nativeTitle)}`)

    // ── 3. The menu opens with the expected entries, red only inside it ──────
    await page.click(`[data-row-menu="${row.id}"]`)
    await settle()
    const entries = await page.$$eval(`[data-row-menu-surface="${row.id}"] [data-menu-item]`,
      els => els.map(el => ({ key: el.dataset.menuItem, danger: /text-destructive/.test(el.className) })))
    check(entries.map(e => e.key).join(',') === screen.entries,
      `${screen.key}: the menu offers "${screen.entries}" — got "${entries.map(e => e.key).join(',')}"`)
    check(entries.at(-1)?.danger === true && entries.slice(0, -1).every(e => !e.danger),
      `${screen.key}: only the destructive entry is red, and only while the menu is open`)

    // ── 3b. The open menu is where a human can see and click it ─────────────
    checkMenuReachable(screen.key, 'below its button', await measureOpenMenu(row.id))

    // ── 4. Escape closes and gives the focus back ────────────────────────────
    await page.keyboard.press('Escape')
    await settle()
    const afterEscape = await page.evaluate(id => ({
      surface: document.querySelector(`[data-row-menu-surface="${id}"]`) !== null,
      focused: document.activeElement?.dataset?.rowMenu ?? null,
    }), row.id)
    check(!afterEscape.surface && afterEscape.focused === row.id,
      `${screen.key}: Escape closes the menu and gives the focus back — focus is on ${afterEscape.focused}`)

    // ── 4b. Same button, now at the bottom edge: the menu must fold upwards or
    // slide back in, never spill below the window where nothing is clickable.
    // The window is SHRUNK to just under the button rather than scrolled to it:
    // scrolling only moves a button that has somewhere to go, and on a short list it
    // has none — the first write of this check scrolled, measured the very same
    // rectangle twice, and asserted nothing at all.
    const edgeGap = await squeezeViewportUnder(`[data-row-menu="${row.id}"]`)
    if (edgeGap === null) {
      fail(`${screen.key}: the "..." button vanished when the window was shortened`)
    } else {
      check(edgeGap <= BOTTOM_EDGE_GAP + 1,
        `${screen.key}: the button really sits at the bottom edge for this check — ${edgeGap}px of window left under it`)
      await page.click(`[data-row-menu="${row.id}"]`)
      await settle()
      checkMenuReachable(screen.key, 'with its button at the bottom edge', await measureOpenMenu(row.id))
      await page.keyboard.press('Escape')
    }
    await page.setViewport(VIEWPORT)
    await settle()

    // ── 5. The confirmation names the object, refusing sends nothing ─────────
    const before = blockedDeletes.length
    const saidBefore = confirmations.length
    acceptNextConfirm = false
    await openMenuAndClick(screen.path, row.id, entries.at(-1).key)
    const text = await confirmationAfter(saidBefore)
    if (text === null) {
      fail(`${screen.key}: the destructive entry raised no confirmation at all`)
      continue
    }
    const needle = screen.confirmNeedle(row)
    check(text.includes(needle),
      `${screen.key}: the confirmation names the object — "${text.slice(0, 80)}…"`)
    check(text.length > needle.length + 20,
      `${screen.key}: the confirmation states the consequence, not just the question`)
    check(text.includes('—') === false,
      `${screen.key}: the confirmation uses no em-dash`)
    check(blockedDeletes.length === before,
      `${screen.key}: refusing sends no request — ${blockedDeletes.length - before} DELETE attempted`)

    // ── 6. Accepting sends exactly ONE DELETE, on the right id ──────────────
    // Intercepted, so the object lives: this says the route is CALLED once on the right
    // id, not that the route works.
    acceptNextConfirm = true
    await openMenuAndClick(screen.path, row.id, entries.at(-1).key)
    acceptNextConfirm = false
    const sent = blockedDeletes.slice(before)
    check(sent.length === 1 && sent[0].endsWith(`/${row.id}`),
      `${screen.key}: accepting sends exactly one DELETE, on the right row — ${JSON.stringify(sent)}`)

    // ── 7. It is still there: the interception held ─────────────────────────
    const stillThere = screen.rowsOf(await read(screen.list, scoped)).some(r => r.id === row.id)
    check(stillThere, `${screen.key}: the row still exists — the bench destroyed nothing`)
  }
} catch (e) {
  // No process.exit() here: it ends the process at once, before a `finally` that has not
  // started can run, which would leave every row seeded above in the database. The exit
  // is deferred until after the cleanup.
  console.error(`HARNESS: ${e.stack}`)
  harnessError = e
} finally {
  // Every row this run created goes, whatever happened above. Straight in the database:
  // the page's DELETE path is intercepted on purpose, and the api-keys route only marks a
  // key revoked, so neither could ever bring these counts back to zero.
  for (const { table, id } of seeded) {
    await db.query(`DELETE FROM ${table} WHERE id = $1`, [id]).catch(() => {})
  }
  // One query at a time: a single pg client cannot run them in parallel.
  const left = []
  for (const table of SEED_TABLES) {
    const r = await db.query(`SELECT count(*)::int AS n FROM ${table} WHERE name = $1`, [SEED_NAME])
      .catch(() => ({ rows: [{ n: -1 }] }))
    left.push(`${table}=${r.rows[0].n}`)
  }
  await db.end().catch(() => {})
  await browser.close().catch(() => {})
  console.log(`rows seeded then removed: ${seeded.length} — left behind: ${left.join(' ')}`)
  // The cleanup is part of what this bench asserts: a run that leaves a row behind has not
  // passed, however green its measurements were.
  const leaked = left.filter(t => !t.endsWith('=0'))
  if (leaked.length) fail(`the bench left rows behind — ${leaked.join(' ')}`)
}

// Now that the cleanup has run, a harness error can end the run.
if (harnessError) process.exit(2)

console.log(`intercepted DELETE requests (none reached the server): ${JSON.stringify(blockedDeletes)}`)
console.log(failures.length ? `check-settings-row-menus: ${failures.length} FAIL` : 'check-settings-row-menus: OK')
process.exit(failures.length ? 1 : 0)
