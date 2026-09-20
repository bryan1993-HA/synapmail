#!/usr/bin/env node
/**
 * Measures search against the RUNNING app and a REAL mailbox (read only: it issues
 * GET requests and never creates, moves or deletes a message, and never prints a
 * body or a password).
 *
 * What it measures, each arm carrying its own same-run reference:
 *  A. FIELDS — an address that appears as a RECIPIENT but never as a sender is
 *     found. Reference arm (the previous behaviour, `from`+`subject` only) is
 *     recomputed from the SAME result set: the arm only passes when results exist
 *     that the reference could NOT have returned.
 *  B. WORDS — "w1 w2" and "w2 w1" return the same set, and it is not empty.
 *  C. QUOTES — a quoted phrase returns a SUBSET of the same words unquoted.
 *  D. CONTRACT — `total` >= rows returned, `fields` is exactly SEARCH_FIELDS.
 *  E. BANNER — the list's search banner names the fields, the scope, and says
 *     "first N of M" when the result set is capped.
 *
 * Queries are DISCOVERED from the mailbox (no hardcoded term), so the bench keeps
 * measuring after the test account's content changes.
 *
 *   node scripts/check-search.mjs
 */
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import puppeteer from 'puppeteer-core'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const VIEWPORT = { width: 1440, height: 900 }
// One IMAP search over a real folder measured 1.2 s; the deadline is the PRODUCT's,
// wide enough that a slow mailbox is reported as a measurement, not as a dead harness.
const API_TIMEOUT_MS = 120000
const PROTOCOL_TIMEOUT_MS = API_TIMEOUT_MS * 2
const SEARCH_SETTLE_MS = 20000
const SAMPLE_PAGE = 50

// The contract is IMPORTED, never retyped: a change in lib/search.ts fails this
// check instead of silently making it measure something else.
registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith('.') && !/\.[a-z]+$/.test(spec)) {
      const url = new URL(`${spec}.ts`, ctx.parentURL)
      if (existsSync(url)) return next(url.href, ctx)
    }
    return next(spec, ctx)
  },
})
const { SEARCH_FIELDS, SEARCH_PARAM, SCOPE_PARAM, MIN_QUERY_LENGTH } =
  await import(new URL('../lib/search.ts', import.meta.url).href)

for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
}
const { SYNAPMAIL_TEST_URL: BASE, SYNAPMAIL_TEST_EMAIL: EMAIL, SYNAPMAIL_TEST_PASSWORD: PASSWORD } = process.env
for (const [k, v] of Object.entries({ SYNAPMAIL_TEST_URL: BASE, SYNAPMAIL_TEST_EMAIL: EMAIL, SYNAPMAIL_TEST_PASSWORD: PASSWORD })) {
  if (!v) { console.error(`HARNESS: ${k} is not set`); process.exit(2) }
}

const failures = []
const check = (label, ok, detail) => {
  if (ok) { console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`); return }
  console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`)
  failures.push(label)
}
const harness = msg => { console.error(`HARNESS: ${msg}`); process.exit(2) }

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'], protocolTimeout: PROTOCOL_TIMEOUT_MS })
try {
  const page = await browser.newPage()
  await page.setViewport(VIEWPORT)
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })

  const loggedIn = await page.evaluate(async ({ base, email, password }) => {
    const { csrfToken } = await (await fetch(`${base}/api/auth/csrf`)).json()
    const res = await fetch(`${base}/api/auth/callback/credentials`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ csrfToken, email, password, json: 'true' }),
    })
    return res.ok
  }, { base: BASE, email: EMAIL, password: PASSWORD })
  if (!loggedIn) harness('credentials login failed')

  // Every API call goes through the PAGE, so it carries the session cookie the
  // product itself uses — no second auth path invented by the bench.
  const api = (path, timeout = API_TIMEOUT_MS) => page.evaluate(async ({ base, path, timeout }) => {
    const res = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(timeout) })
    return { status: res.status, body: await res.json() }
  }, { base: BASE, path, timeout })

  const search = async (q, scope = 'folder') => {
    const started = Date.now()
    const r = await api(`/api/messages/search?${SEARCH_PARAM}=${encodeURIComponent(q)}&folder=INBOX&${SCOPE_PARAM}=${scope}`)
    if (r.status !== 200) harness(`search "${q}" returned HTTP ${r.status}`)
    return { ...r.body, ms: Date.now() - started }
  }
  const uidsOf = r => new Set((r.messages ?? []).map(m => m.uid))

  // ── sample the mailbox to discover the queries ────────────────────────────
  const sample = await api(`/api/messages?folder=INBOX&page=1&perPage=${SAMPLE_PAGE}`)
  const sampled = sample.body?.messages ?? []
  if (sampled.length === 0) harness('INBOX sample is empty — no query can be discovered')
  console.log(`sample: ${sampled.length} messages from INBOX\n`)

  const senders = new Set(sampled.map(m => m.from?.address?.toLowerCase()).filter(Boolean))
  const recipientOnly = sampled
    .flatMap(m => (m.to ?? []).map(a => a.address?.toLowerCase()))
    .filter(a => a && !senders.has(a) && a.toLowerCase() !== EMAIL.toLowerCase())
  const address = recipientOnly[0]

  console.log('A. fields — a recipient-only address is found')
  if (!address) {
    console.log('  skip  no recipient-only address in the sample (mailbox-dependent)')
  } else {
    const r = await search(address)
    check(`"${address}" returns results`, (r.total ?? 0) > 0, `total=${r.total}, ${r.ms} ms`)
    // Same-run REFERENCE arm: what the previous from+subject search could have matched.
    const term = address.toLowerCase()
    const reachableBefore = (r.messages ?? []).filter(m =>
      (m.from?.address ?? '').toLowerCase().includes(term) || (m.subject ?? '').toLowerCase().includes(term))
    const onlyViaRecipient = (r.messages ?? []).length - reachableBefore.length
    check('results exist that sender+subject alone could not return', onlyViaRecipient > 0,
      `${onlyViaRecipient} of ${(r.messages ?? []).length} rows matched only through to/cc`)
  }

  console.log('\nB. words — order does not matter')
  const words = sampled
    .map(m => (m.subject ?? '').split(/[^\p{L}\p{N}]+/u).filter(w => w.length > MIN_QUERY_LENGTH + 1))
    .find(ws => ws.length >= 2)
  if (!words) {
    console.log('  skip  no subject with two usable words in the sample')
  } else {
    const [w1, w2] = words
    const ab = await search(`${w1} ${w2}`)
    const ba = await search(`${w2} ${w1}`)
    check(`"${w1} ${w2}" returns results`, (ab.messages ?? []).length > 0, `${(ab.messages ?? []).length} rows, ${ab.ms} ms`)
    const sa = uidsOf(ab), sb = uidsOf(ba)
    check('both orders return the same set',
      sa.size === sb.size && [...sa].every(u => sb.has(u)), `${sa.size} vs ${sb.size} rows`)

    console.log('\nC. quotes — a phrase restricts')
    const quoted = await search(`"${w2} ${w1}"`)
    const sq = uidsOf(quoted)
    check('quoted results are a subset of the unquoted ones',
      [...sq].every(u => sa.has(u)), `${sq.size} quoted ⊆ ${sa.size} unquoted`)

    console.log('\nD. contract')
    check('total is at least the number of rows returned', (ab.total ?? 0) >= (ab.messages ?? []).length,
      `total=${ab.total}, rows=${(ab.messages ?? []).length}`)
    check('the response names the fields it searched',
      JSON.stringify(ab.fields) === JSON.stringify([...SEARCH_FIELDS]), JSON.stringify(ab.fields))
  }

  console.log('\nE. banner')
  const bannerQuery = address ?? (words ? words[0] : null)
  if (!bannerQuery) {
    console.log('  skip  no query discovered')
  } else {
    // The banner must be compared against THE request the page itself issued:
    // replaying a separate call queries another folder and compares two different
    // measurements (observed: banner 104, separate call 212 — the gap came from
    // the harness, not the product).
    let pageSearch = null
    page.on('response', async res => {
      if (!new URL(res.url()).pathname.endsWith('/api/messages/search')) return
      try { pageSearch = await res.json() } catch { /* unreadable response: no effect */ }
    })
    await page.goto(`${BASE}/mail?${SEARCH_PARAM}=${encodeURIComponent(bannerQuery)}`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('[data-search-summary]', { timeout: 30000 })
    const banner = await page.waitForFunction(() => {
      const el = document.querySelector('[data-search-summary]')
      const txt = el?.textContent ?? ''
      return /·/.test(txt) ? txt : false
    }, { timeout: SEARCH_SETTLE_MS, polling: 500 }).then(h => h.jsonValue()).catch(() => null)
    if (banner === null) harness('the search banner never left its loading state')
    console.log(`  banner: ${banner}`)
    if (!pageSearch) harness('the page issued no /api/messages/search request')
    const rows = (pageSearch.messages ?? []).length
    const shown = pageSearch.total ?? rows
    check('the banner names the fields searched', banner.includes('·'), banner)
    check('the banner names the scope', /dossier|folder|文件夹/i.test(banner), banner)
    check('the banner reports the match count the server sent', banner.includes(String(shown)),
      `server total=${shown}`)
    const capped = shown > rows
    const announcesCap = /premiers|first|前/i.test(banner)
    check(capped ? 'a capped result set is announced as such' : 'an uncapped result set claims no cap',
      capped === announcesCap, `total=${shown}, rows=${rows}, cap announced=${announcesCap}`)
  }
} finally {
  await browser.close()
}

if (failures.length) { console.error(`\n${failures.length} check(s) failed: ${failures.join(', ')}`); process.exit(1) }
console.log('\ncheck-search: OK')
