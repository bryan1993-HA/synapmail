#!/usr/bin/env node
/**
 * Measures on the running app that the header's field is the app's ONLY search
 * input, typing in it drives the message list through the mailbox URL, the scope
 * toggle widens the search to every folder, typing from another page lands on the
 * mailbox, and the list no longer carries its own search field nor its own compose
 * button. Fails (exit 1) on any drift.
 *
 * Needs a running dev server and SYNAPMAIL_TEST_* credentials (see .env).
 *   node scripts/check-omnibar-search.mjs
 */
import { readFileSync } from 'node:fs'
import puppeteer from 'puppeteer-core'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const VIEWPORT = { width: 1440, height: 900 }

// The debounce and the URL parameter names are NOT retyped here: they are read out
// of the shared contract (lib/search.ts) in this same run, so a change there fails
// this check instead of silently making it measure the wrong thing.
const CONTRACT = readFileSync(new URL('../lib/search.ts', import.meta.url), 'utf8')
const constant = (name, re) => {
  const m = CONTRACT.match(re)
  if (!m) { console.error(`HARNESS: could not read ${name} from lib/search.ts`); process.exit(2) }
  return m[1]
}
const SEARCH_PARAM = constant('SEARCH_PARAM', /SEARCH_PARAM = '([^']+)'/)
const SCOPE_PARAM = constant('SCOPE_PARAM', /SCOPE_PARAM = '([^']+)'/)
const SCOPE_ALL = constant('SCOPE_ALL', /SCOPE_ALL = '([^']+)'/)
const DEBOUNCE_MS = Number(constant('SEARCH_DEBOUNCE_MS', /SEARCH_DEBOUNCE_MS = (\d+)/))
const MIN_LENGTH = Number(constant('MIN_QUERY_LENGTH', /MIN_QUERY_LENGTH = (\d+)/))

const SEARCH = '[data-omnibar-search]'
const SUMMARY = '[data-search-summary]'
const scopeBtn = v => `[data-omnibar-scope="${v}"]`
// A query that matches nothing in a real mailbox would leave an empty list, which
// says nothing about the wiring; what is measured is the REQUEST the field issues
// and the list's own search-mode banner, not how many mails come back.
const QUERY = 'facture'
// IMAP search over every folder of a real account is the slow arm — generous.
const SETTLE_MS = 600
const SEARCH_SETTLE_MS = 12000
// A direct all-folder IMAP search on a real 7-mailbox account is the slowest call the
// check makes. It gets its OWN deadline (AbortSignal below) so a slow API is REPORTED as
// a measured failure; the CDP transport is given more than that, so the transport can
// never fire first and turn a product measurement into a dead harness.
const API_TIMEOUT_MS = 120000
const PROTOCOL_TIMEOUT_MS = API_TIMEOUT_MS * 2

for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
}
const { SYNAPMAIL_TEST_URL: BASE, SYNAPMAIL_TEST_EMAIL: EMAIL, SYNAPMAIL_TEST_PASSWORD: PASSWORD } = process.env
for (const [k, v] of Object.entries({ SYNAPMAIL_TEST_URL: BASE, SYNAPMAIL_TEST_EMAIL: EMAIL, SYNAPMAIL_TEST_PASSWORD: PASSWORD })) {
  if (!v) { console.error(`HARNESS: ${k} is not set`); process.exit(2) }
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'], protocolTimeout: PROTOCOL_TIMEOUT_MS })
const failures = []
try {
  const page = await browser.newPage()
  await page.setViewport(VIEWPORT)

  // The app holds a Server-Sent Events stream open for as long as a page lives, so
  // `networkidle2` can NEVER settle on it: waiting for it makes the harness die on a
  // transport timeout that says nothing about the product. Navigation is therefore
  // considered done when the DOM is ready and the element the step needs is present.
  //
  // Waiting for the element is NOT enough: the server-rendered field is in the DOM
  // before React has hydrated it, and a keystroke sent during that window is dropped
  // (observed: "typed \"facture\" -> url /mail?", 0 request, 1 run out of 2). React 18
  // attaches its props to a DOM node AT hydration, so the presence of a `__reactProps$…`
  // key on the element is the event handler being live — the exact condition a keystroke
  // needs. That is what is waited on, not a fixed delay.
  const visit = async (path, selector = SEARCH) => {
    await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' })
    if (!selector) return
    await page.waitForSelector(selector, { timeout: 20000 })
    await page.waitForFunction(
      sel => {
        const el = document.querySelector(sel)
        return !!el && Object.keys(el).some(k => k.startsWith('__reactProps$'))
      },
      { timeout: 20000 }, selector,
    )
  }

  // Every /api/messages/search request the app issues, in order — this is the
  // evidence that the FIELD drives the QUERY, not just that the URL changed.
  const searchCalls = []
  page.on('request', req => {
    const u = new URL(req.url())
    if (u.pathname === '/api/messages/search') {
      searchCalls.push({ q: u.searchParams.get(SEARCH_PARAM), scope: u.searchParams.get(SCOPE_PARAM), folder: u.searchParams.get('folder') })
    }
  })

  await visit('/login', null)
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

  // --- Exactly one search field in the whole app, and it is the header's ---
  for (const path of ['/mail', '/dashboard']) {
    await visit(path)
    await new Promise(r => setTimeout(r, SETTLE_MS))
    const fields = await page.evaluate(sel => {
      const visible = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
      const all = [...document.querySelectorAll('input[type="search"], input[type="text"], input:not([type])')]
        .filter(visible)
        .filter(el => /search|recherch|搜索/i.test(`${el.placeholder} ${el.getAttribute('aria-label') ?? ''} ${el.name}`))
      return { total: all.length, inHeader: all.filter(el => el.matches(sel)).length }
    }, SEARCH)
    const composeButtons = await page.evaluate(() => document.querySelectorAll('[data-compose-button]').length)
    console.log(`${path}: visible search fields=${fields.total} (in the header: ${fields.inHeader}), list compose buttons=${composeButtons}`)
    if (fields.total !== 1) failures.push(`${path}: ${fields.total} visible search fields, expected exactly 1`)
    if (fields.inHeader !== 1) failures.push(`${path}: the only search field is not the header's`)
    if (composeButtons !== 0) failures.push(`${path}: the list still carries its own compose button`)
  }

  // --- Typing in the header drives the list, through the URL ---
  await visit('/mail')
  await new Promise(r => setTimeout(r, SETTLE_MS))
  const before = { url: page.url(), calls: searchCalls.length, summary: await page.$(SUMMARY) }
  if (before.calls !== 0) { console.error('HARNESS: a search request fired before anything was typed'); process.exit(2) }
  if (before.summary) { console.error('HARNESS: the list was already in search mode before typing'); process.exit(2) }

  await page.click(SEARCH)
  await page.type(SEARCH, QUERY, { delay: 30 })
  await new Promise(r => setTimeout(r, DEBOUNCE_MS + SEARCH_SETTLE_MS))
  const afterUrl = new URL(page.url())
  const folderCall = searchCalls.at(-1)
  const summaryText = await page.$eval(SUMMARY, el => el.textContent.trim()).catch(() => null)
  console.log(`typed "${QUERY}" -> url ${afterUrl.pathname}?${afterUrl.searchParams}`)
  console.log(`  search requests: ${searchCalls.length}, last: q="${folderCall?.q}" scope="${folderCall?.scope}" folder="${folderCall?.folder}"`)
  console.log(`  list banner: ${summaryText === null ? '(absent)' : `"${summaryText}"`}`)
  if (afterUrl.searchParams.get(SEARCH_PARAM) !== QUERY) failures.push(`the URL carries ${SEARCH_PARAM}="${afterUrl.searchParams.get(SEARCH_PARAM)}", expected "${QUERY}"`)
  if (!folderCall) failures.push('typing in the header issued no /api/messages/search request')
  else if (folderCall.q !== QUERY) failures.push(`the search request asked for "${folderCall.q}", expected "${QUERY}"`)
  // The debounce is what keeps one request per pause instead of one per keystroke.
  if (searchCalls.length > QUERY.length - MIN_LENGTH) failures.push(`${searchCalls.length} search requests for ${QUERY.length} keystrokes — the debounce is not holding`)
  if (summaryText === null) failures.push('the list did not enter search mode (no result banner)')

  // --- The scope toggle widens the search to every folder ---
  const callsBeforeScope = searchCalls.length
  await page.waitForSelector(scopeBtn(SCOPE_ALL), { timeout: 5000 })
  await page.click(scopeBtn(SCOPE_ALL))
  await new Promise(r => setTimeout(r, SEARCH_SETTLE_MS))
  const scopeUrl = new URL(page.url())
  const scopeCall = searchCalls.at(-1)
  console.log(`clicked "all folders" -> url ${scopeUrl.pathname}?${scopeUrl.searchParams}, last request scope="${scopeCall?.scope}"`)
  if (searchCalls.length === callsBeforeScope) failures.push('the scope toggle issued no new search request')
  if (scopeUrl.searchParams.get(SCOPE_PARAM) !== SCOPE_ALL) failures.push(`the URL carries ${SCOPE_PARAM}="${scopeUrl.searchParams.get(SCOPE_PARAM)}", expected "${SCOPE_ALL}"`)
  if (scopeCall?.scope !== SCOPE_ALL) failures.push(`the widened request asked for scope="${scopeCall?.scope}", expected "${SCOPE_ALL}"`)
  const scopeStatus = await page.evaluate(async (base, q, scope, param, deadline) => {
    const started = performance.now()
    try {
      const res = await fetch(`${base}/api/messages/search?q=${q}&folder=INBOX&${param}=${scope}`, { signal: AbortSignal.timeout(deadline) })
      const body = await res.json()
      return { status: res.status, count: Array.isArray(body.messages) ? body.messages.length : null, error: body.error ?? null, ms: Math.round(performance.now() - started) }
    } catch (e) {
      return { status: null, count: null, error: `${e.name}: ${e.message}`, ms: Math.round(performance.now() - started) }
    }
  }, BASE, QUERY, SCOPE_ALL, SCOPE_PARAM, API_TIMEOUT_MS)
  console.log(`  API scope=${SCOPE_ALL}: HTTP ${scopeStatus.status}, ${scopeStatus.count} messages, ${scopeStatus.ms} ms, error=${scopeStatus.error ?? 'none'}`)
  if (scopeStatus.status !== 200) failures.push(`the widened API call returned HTTP ${scopeStatus.status} after ${scopeStatus.ms} ms`)
  if (scopeStatus.error) failures.push(`the widened API call reported: ${scopeStatus.error}`)

  // --- Clearing the field leaves search mode ---
  await page.click('[data-omnibar-search-clear]')
  await new Promise(r => setTimeout(r, DEBOUNCE_MS + SETTLE_MS * 3))
  const clearedUrl = new URL(page.url())
  const stillSearching = await page.$(SUMMARY)
  console.log(`cleared -> url ${clearedUrl.pathname}?${clearedUrl.searchParams}, list still in search mode: ${!!stillSearching}`)
  if (clearedUrl.searchParams.get(SEARCH_PARAM)) failures.push(`clearing left ${SEARCH_PARAM}="${clearedUrl.searchParams.get(SEARCH_PARAM)}" in the URL`)
  if (stillSearching) failures.push('clearing the field left the list in search mode')

  // --- From another page, submitting navigates to the mailbox ---
  await visit('/dashboard')
  await new Promise(r => setTimeout(r, SETTLE_MS))
  await page.click(SEARCH)
  await page.type(SEARCH, QUERY, { delay: 30 })
  await page.keyboard.press('Enter')
  await new Promise(r => setTimeout(r, SEARCH_SETTLE_MS))
  const fromDash = new URL(page.url())
  console.log(`searched from /dashboard -> ${fromDash.pathname}?${fromDash.searchParams}`)
  if (fromDash.pathname !== '/mail') failures.push(`searching from the dashboard landed on ${fromDash.pathname}, expected /mail`)
  if (fromDash.searchParams.get(SEARCH_PARAM) !== QUERY) failures.push(`searching from the dashboard carried ${SEARCH_PARAM}="${fromDash.searchParams.get(SEARCH_PARAM)}"`)

  // --- A deep link restores the search (the URL is the state) ---
  await visit(`/mail?${SEARCH_PARAM}=${QUERY}&${SCOPE_PARAM}=${SCOPE_ALL}`)
  await new Promise(r => setTimeout(r, SEARCH_SETTLE_MS))
  const restored = await page.$eval(SEARCH, el => el.value)
  const restoredScope = await page.$eval(scopeBtn(SCOPE_ALL), el => el.getAttribute('aria-pressed'))
  const restoredBanner = await page.$eval(SUMMARY, el => el.textContent.trim()).catch(() => null)
  console.log(`deep link -> field="${restored}", "all folders" pressed=${restoredScope}, banner=${restoredBanner === null ? '(absent)' : `"${restoredBanner}"`}`)
  if (restored !== QUERY) failures.push(`a deep link left "${restored}" in the field, expected "${QUERY}"`)
  if (restoredScope !== 'true') failures.push('a deep link did not restore the "all folders" scope')
  if (restoredBanner === null) failures.push('a deep link did not put the list in search mode')

  const consoleErrors = []
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()) })
  await visit('/mail')
  await new Promise(r => setTimeout(r, SETTLE_MS * 2))
  console.log(`console errors on a fresh /mail load: ${consoleErrors.length}`)
  if (consoleErrors.length) failures.push(`console errors: ${consoleErrors.slice(0, 3).join(' | ')}`)
} finally {
  await browser.close()
}

if (failures.length) {
  console.error(`\ncheck-omnibar-search: ${failures.length} failure(s)`)
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(1)
}
console.log('\ncheck-omnibar-search: OK')
