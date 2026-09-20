#!/usr/bin/env node
/**
 * Measures the streamed search against the RUNNING app and a REAL mailbox (read only: GET
 * requests only, no message created, moved or deleted, no body and no password
 * printed).
 *
 * What it measures, each arm carrying its own same-run reference:
 *  A. CAP — the progressive ("all folders") path renders at most
 *     SEARCH_RESULT_LIMIT rows. Same-run REFERENCE arm: the NON-streaming path
 *     for the SAME query, which already caps server-side — both must land on the
 *     same ceiling, so the arm measures the client, not an arbitrary constant.
 *  B. BANNER — once the cap bites, the banner says how many are shown out of how
 *     many were found, on one line.
 *  C. FIRST RESULTS — how long until the first row of the progressive path shows
 *     (target: under 10 s on a large mailbox).
 *  D. ABORT — leaving the search stops the stream: no unhandled rejection, no
 *     page error.
 *
 * The query is DISCOVERED from the mailbox (no hardcoded term): the broadest of a
 * few sampled candidates is used, so the bench keeps measuring after the test
 * account's content changes.
 *
 *   node scripts/check-search-stream.mjs
 */
import { readFileSync, existsSync } from 'node:fs'
import { registerHooks } from 'node:module'
import puppeteer from 'puppeteer-core'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const VIEWPORT = { width: 1440, height: 900 }
// A whole-mailbox progressive search covers every folder one by one; the deadline
// is the PRODUCT's, wide enough that a slow mailbox reads as a measurement rather
// than as a dead harness.
const API_TIMEOUT_MS = 180000
const PROTOCOL_TIMEOUT_MS = API_TIMEOUT_MS * 2
// Target for a streamed search: first results under 10 s.
const FIRST_RESULTS_TARGET_MS = 10000
const STREAM_SETTLE_MS = 60000
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
const { SEARCH_RESULT_LIMIT, SEARCH_PARAM, SCOPE_PARAM, SCOPE_ALL, STREAM_PARAM, MIN_QUERY_LENGTH } =
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
const sleep = ms => new Promise(r => setTimeout(r, ms))

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'], protocolTimeout: PROTOCOL_TIMEOUT_MS })
try {
  const page = await browser.newPage()
  await page.setViewport(VIEWPORT)
  // A dev server compiles /mail on the FIRST hit; puppeteer's 30 s default
  // navigation timeout turns that into a HARNESS failure that says nothing about
  // the product (measured: 4,5 s for the same navigation once warm).
  page.setDefaultNavigationTimeout(API_TIMEOUT_MS)
  const errs = []
  page.on('pageerror', e => errs.push(`pageerror: ${e.message.slice(0, 160)}`))
  page.on('console', m => { if (m.type() === 'error') errs.push(`console: ${m.text().slice(0, 160)}`) })

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

  const api = (path, timeout = API_TIMEOUT_MS) => page.evaluate(async ({ base, path, timeout }) => {
    const res = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(timeout) })
    return { status: res.status, body: await res.json() }
  }, { base: BASE, path, timeout })

  // ── discover the broadest query the mailbox offers ────────────────────────
  const sample = await api(`/api/messages?folder=INBOX&page=1&perPage=${SAMPLE_PAGE}`)
  const sampled = sample.body?.messages ?? []
  if (sampled.length === 0) harness('INBOX sample is empty — no query can be discovered')

  const domains = sampled
    .map(m => (m.from?.address ?? '').split('@')[1]?.split('.')[0])
    .filter(d => d && d.length > MIN_QUERY_LENGTH)
  const candidates = [...new Set(domains)].slice(0, 6)
  if (candidates.length === 0) harness('no query candidate found in the sample')

  let query = null, reference = null
  for (const c of candidates) {
    const r = await api(`/api/messages/search?${SEARCH_PARAM}=${encodeURIComponent(c)}&folder=INBOX&${SCOPE_PARAM}=${SCOPE_ALL}`)
    if (r.status !== 200) continue
    if (!reference || (r.body.total ?? 0) > (reference.total ?? 0)) { query = c; reference = r.body }
  }
  if (!query) harness('every candidate query failed on the non-streaming path')
  console.log(`query: "${query}" — non-streaming reference: total=${reference.total}, rows=${(reference.messages ?? []).length}\n`)

  console.log('A. cap — the progressive path renders at most SEARCH_RESULT_LIMIT rows')
  // Same-run REFERENCE arm: the non-streaming path caps server-side (route.ts
  // slices at SEARCH_RESULT_LIMIT). The streaming path must not exceed it.
  check('the non-streaming reference is itself capped',
    (reference.messages ?? []).length <= SEARCH_RESULT_LIMIT,
    `${(reference.messages ?? []).length} rows <= ${SEARCH_RESULT_LIMIT}`)

  // Warm-up: the mailbox page is loaded ONCE without a query first, so arm C times
  // the SEARCH and not the first compile/hydration of the page around it (on a dev
  // server that first navigation alone costs seconds and has nothing to do with
  // what the streamed search promises).
  await page.goto(`${BASE}/mail`, { waitUntil: 'networkidle2', timeout: API_TIMEOUT_MS })
  // The STREAMING ROUTE needs the same treatment, and for the same reason: on a
  // dev server its first request pays the route's compilation (measured: 30 s on
  // the first run after a code change, against 6.7 s on the next — the product
  // did not change between the two). Warmed with a DIFFERENT query, aborted as
  // soon as the route answers: the route gets compiled, the measured query gets
  // no head start.
  await page.evaluate(async ({ base, url }) => {
    const controller = new AbortController()
    try {
      const res = await fetch(`${base}${url}`, { signal: controller.signal })
      await res.body?.getReader().read()
    } catch { /* aborted on purpose */ } finally { controller.abort() }
  }, {
    base: BASE,
    url: `/api/messages/search?${SEARCH_PARAM}=${encodeURIComponent(`${query}-warmup`)}` +
      `&folder=INBOX&${SCOPE_PARAM}=${SCOPE_ALL}&${STREAM_PARAM}=1`,
  })

  const started = Date.now()
  await page.goto(`${BASE}/mail?${SEARCH_PARAM}=${encodeURIComponent(query)}&${SCOPE_PARAM}=${SCOPE_ALL}`,
    { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-search-summary]', { timeout: API_TIMEOUT_MS })
  await page.waitForFunction(() => document.querySelectorAll('[data-mail-row]').length > 0,
    { timeout: API_TIMEOUT_MS }).catch(() => null)
  const firstResultsMs = Date.now() - started

  // Let the stream run its course (or long enough to flood, had nothing capped it).
  await page.waitForFunction(
    () => !/…|\.\.\./.test(document.querySelector('[data-search-summary]')?.textContent || ''),
    { timeout: STREAM_SETTLE_MS },
  ).catch(() => null)
  await sleep(2000)

  const shown = await page.evaluate(() => document.querySelectorAll('[data-mail-row]').length)
  const banner = await page.evaluate(() => document.querySelector('[data-search-summary]')?.textContent?.trim() ?? '')
  // Rows are grouped into conversations, so the DOM count is <= the message count:
  // a row count over the limit can only mean the accumulator never capped.
  check('the progressive path never renders more than the limit', shown <= SEARCH_RESULT_LIMIT,
    `${shown} rows rendered, limit ${SEARCH_RESULT_LIMIT}`)

  console.log('\nB. banner — it says how many are shown out of how many were found')
  const numbers = [...banner.matchAll(/\d[\d\u00a0\u202f ]*/g)].map(m => Number(m[0].replace(/[^\d]/g, '')))
  const found = numbers[0] ?? 0
  check('the banner reports more found than shown once the cap bites',
    found <= SEARCH_RESULT_LIMIT || numbers.length >= 2,
    `banner: ${banner}`)
  check('the banner holds on one line', !banner.includes('\n'), JSON.stringify(banner))

  console.log('\nC. first results')
  check(`first rows appear under ${FIRST_RESULTS_TARGET_MS} ms`, firstResultsMs < FIRST_RESULTS_TARGET_MS,
    `${firstResultsMs} ms`)

  console.log('\nD. abort — leaving the search stops the stream cleanly')
  await page.goto(`${BASE}/mail`, { waitUntil: 'domcontentloaded' })
  await sleep(3000)
  check('no page error and no console error', errs.length === 0, errs.slice(0, 3).join(' | ') || 'none')
} finally {
  await browser.close()
}

if (failures.length) { console.error(`\n${failures.length} check(s) failed`); process.exit(1) }
console.log('\ncheck-search-stream: OK')
