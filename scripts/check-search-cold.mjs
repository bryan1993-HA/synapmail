#!/usr/bin/env node
/**
 * Reproduces the COLD-LOAD path of a whole-mailbox search with a real browser:
 * the URL `/mail?q=…&scope=all` is opened DIRECTLY (what the omnibar's navigation,
 * a reload and a shared link all do), not typed into a field on a page where the
 * active account is already known.
 *
 * Why this bench exists: a manual review found that on this exact path
 * the Stop button and the "N folders out of M" progress never appeared, and the
 * banner claimed "0 result" as a final state for three seconds. Two causes, both
 * invisible to a bench that types into the field:
 *  1. a FIRST search fired before the active account was resolved, was abandoned
 *     when it arrived, and its `finally` turned OFF the streaming flag of the
 *     search that had meanwhile started;
 *  2. that first search carried no `account=`, so it swept the DEFAULT mailbox
 *     instead of the displayed one.
 *
 * What it measures, on the cold path only:
 *  A. NO search request leaves without an `account=` parameter.
 *  B. When the FIRST result row appears, the Stop button is present.
 *  C. While the stream runs, the progress "x / y folders" is shown, and the
 *     banner never presents a final "0 result" before the stream ends.
 *  D. The stream DELIVERS EVERY FOLDER and ends on `done`: the last NDJSON line
 *     says `searched === folders`, no line carries an error, and the reader is
 *     told the body is over.
 *
 *     What D deliberately does NOT assert: Chrome's own `finished` / `aborted`
 *     label on the request. Measured 2026-09-19 on this route, five arms, same
 *     query / account / server: an incrementally-delivered body read through
 *     `getReader()` is labelled `net::ERR_ABORTED` by Chrome even when the reader
 *     reaches `done` and every byte arrived (1 173 655 B, 23/23 folders), with or
 *     without `releaseLock()`. The same body read with `res.text()` → `finished`;
 *     the non-streamed branch read with `getReader()` → `finished`; curl → rc=0;
 *     node/undici → clean end. The label tracks Chrome's bookkeeping for a
 *     reader-consumed incremental body, not the response's integrity, so
 *     asserting on it would measure the browser rather than the product.
 *
 * READ ONLY: every non-GET request to /api/messages is refused by the bench, so
 * no message can be created, moved, flagged or deleted.
 *
 * Needs a running server and SYNAPMAIL_TEST_* credentials (see .env).
 *   node scripts/check-search-cold.mjs
 */
import { readFileSync, existsSync } from 'node:fs'
import puppeteer from 'puppeteer-core'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const VIEWPORT = { width: 1440, height: 900 }
// A whole-mailbox sweep on the test account (25 folders) measured 5-9 s end to
// end; the biggest mailbox of the base (101 folders) is slower still.
const STREAM_TIMEOUT_MS = 180000
// The banner is sampled often enough to catch a state that only lasts a few
// hundred milliseconds — the defect this bench exists for lasted ~100 ms.
const SAMPLE_MS = 50
// A dev server compiles /mail and its route on the FIRST hit; puppeteer's 30 s
// default navigation timeout turns that into a HARNESS failure that says nothing
// about the product (measured on this machine: the same navigation costs 4,5 s
// once the route is warm). Same budget as the sweep itself.
const NAV_TIMEOUT_MS = STREAM_TIMEOUT_MS

for (const file of ['.env', '.env.local']) {
  const url = new URL(`../${file}`, import.meta.url)
  if (!existsSync(url)) continue
  for (const line of readFileSync(url, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
  }
}
const { SYNAPMAIL_TEST_URL: BASE, SYNAPMAIL_TEST_EMAIL: EMAIL, SYNAPMAIL_TEST_PASSWORD: PASSWORD } = process.env
for (const [k, v] of Object.entries({ SYNAPMAIL_TEST_URL: BASE, SYNAPMAIL_TEST_EMAIL: EMAIL, SYNAPMAIL_TEST_PASSWORD: PASSWORD })) {
  if (!v) { console.error(`HARNESS: ${k} is not set`); process.exit(2) }
}

// The query, the parameter names and the search path all come from the shipped
// module: renaming one there fails this bench instead of making it measure an
// URL the product no longer serves.
const SEARCH_SRC = readFileSync(new URL('../lib/search.ts', import.meta.url), 'utf8')
const constOf = (name) => SEARCH_SRC.match(new RegExp(`export const ${name} = '([^']+)'`))?.[1]
const [Q_PARAM, SCOPE_P, SCOPE_A] = [constOf('SEARCH_PARAM'), constOf('SCOPE_PARAM'), constOf('SCOPE_ALL')]
if (!Q_PARAM || !SCOPE_P || !SCOPE_A) { console.error('HARNESS: could not read the search params from lib/search.ts'); process.exit(2) }

const failures = []
const check = (label, ok, detail) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures.push(label)
}
const harness = (msg) => { console.error(`HARNESS: ${msg}`); process.exit(2) }

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'], protocolTimeout: NAV_TIMEOUT_MS * 2 })
try {
  const page = await browser.newPage()
  await page.setViewport(VIEWPORT)
  page.setDefaultNavigationTimeout(NAV_TIMEOUT_MS)

  // Read only, enforced: any mutating call on the messages API is aborted.
  await page.setRequestInterception(true)
  const searchRequests = []
  const blockedWrites = []
  page.on('request', (req) => {
    const url = req.url()
    if (req.method() !== 'GET' && /\/api\/messages/.test(url)) { blockedWrites.push(`${req.method()} ${url}`); req.abort(); return }
    if (/\/api\/messages\/search\?/.test(url)) searchRequests.push({ url, at: Date.now() })
    req.continue()
  })
  // Chrome's own label is RECORDED but not asserted on — see arm D's note above.
  const chromeVerdicts = []
  page.on('requestfinished', (req) => { if (/\/api\/messages\/search\?/.test(req.url())) chromeVerdicts.push('finished') })
  page.on('requestfailed', (req) => {
    if (!/\/api\/messages\/search\?/.test(req.url())) return
    chromeVerdicts.push(req.failure()?.errorText ?? 'failed')
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
  if (!loggedIn) harness('credentials login failed')

  // The query is DISCOVERED from the mailbox (the domain of the active account),
  // so the bench keeps finding results after the test account's content changes.
  const account = await page.evaluate(async () => {
    const settings = (await (await fetch('/api/settings')).json()).data
    const accounts = (await (await fetch('/api/accounts')).json()).data ?? []
    const active = accounts.find(a => a.id === settings?.active_account_id) ?? accounts.find(a => a.isDefault) ?? accounts[0]
    return active ? { id: active.id, email: active.email } : null
  })
  if (!account) harness('no email account configured for the test user')
  const domain = account.email.split('@')[1]
  if (!domain) harness(`cannot derive a search term from ${account.email}`)
  console.log(`active account: ${account.email} (search term: ${domain})\n`)

  // Warm the route up: a dev server compiles /api/messages/search on its first
  // hit, which would otherwise be counted as search latency (and could push the
  // first row past the sampling window).
  // `networkidle2` would never fire on /mail: the page holds an SSE connection
  // open for the lifetime of the document.
  await page.goto(`${BASE}/mail`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-mail-row]', { timeout: 60000 })
  await page.evaluate(async (args) => {
    const [q, qp, sp] = args
    await fetch(`/api/messages/search?${qp}=${encodeURIComponent(q)}&folder=INBOX&${sp}=folder`).catch(() => {})
  }, [domain, Q_PARAM, SCOPE_P])

  // ── THE COLD PATH: a direct load of the search URL, in a fresh document. ──
  searchRequests.length = 0
  chromeVerdicts.length = 0
  const href = `${BASE}/mail?${Q_PARAM}=${encodeURIComponent(domain)}&${SCOPE_P}=${SCOPE_A}`
  const t0 = Date.now()
  await page.goto(href, { waitUntil: 'domcontentloaded' })

  const snap = () => page.evaluate(() => {
    const p = document.querySelector('[data-search-summary]')
    if (!p) return null
    const box = p.parentElement
    return {
      text: p.textContent.trim(),
      rows: document.querySelectorAll('[data-mail-row]').length,
      stop: [...box.querySelectorAll('button')].some(b => /Arr[êe]ter|Stop|停止/.test(b.textContent ?? '')),
      hint: !!document.querySelector('[data-search-hint]'),
      scrollTop: document.querySelector('[role="listbox"]')?.scrollTop ?? null,
    }
  })
  // The list is re-sorted by date on every folder that comes back, so rows are
  // re-inserted mid-stream. That is accepted (the human recorded it as an
  // observation for S3) on ONE condition: the reader's own scroll must not be
  // thrown back to the top under them.
  const SCROLL_PROBE_PX = 300

  const trail = []
  let atFirstRow = null   // banner state at the instant the first result row appeared
  let sawProgress = false
  let finalZeroMs = 0     // how long the banner showed a FINAL "0 result" mid-stream
  let zeroSince = null
  let ended = null
  let scrolledAt = null   // when the bench scrolled the list down, mid-stream
  let scrollLow = null    // lowest scrollTop observed after that, while streaming
  for (;;) {
    const s = await snap()
    const t = Date.now() - t0
    if (s) {
      // Scroll ONCE, as soon as there is something to scroll, then watch the
      // position for the rest of the sweep.
      if (scrolledAt === null && s.rows > 0 && s.stop) {
        const applied = await page.evaluate((px) => {
          const el = document.querySelector('[role="listbox"]')
          if (!el || el.scrollHeight <= el.clientHeight + px) return null
          el.scrollTop = px
          return el.scrollTop
        }, SCROLL_PROBE_PX)
        if (applied !== null) { scrolledAt = t; scrollLow = applied }
      } else if (scrolledAt !== null && s.stop && s.scrollTop !== null) {
        scrollLow = Math.min(scrollLow, s.scrollTop)
      }
      if (!trail.length || trail[trail.length - 1].text !== s.text || trail[trail.length - 1].stop !== s.stop) {
        trail.push({ t, text: s.text, rows: s.rows, stop: s.stop })
      }
      if (s.rows > 0 && atFirstRow === null) atFirstRow = { t, ...s }
      if (/\d+\s*\/|sur \d|of \d/.test(s.text)) sawProgress = true
      // "No result" WITHOUT any sign the search is still running = a final claim.
      const finalZero = /^0 /.test(s.text) && !s.stop && !/Recherche|Searching|搜索/.test(s.text)
      if (finalZero) { zeroSince ??= t } else if (zeroSince !== null) { finalZeroMs = Math.max(finalZeroMs, t - zeroSince); zeroSince = null }
      // The stream is over when the Stop button is gone AND nothing announces progress.
      if (!s.stop && trail.length > 1 && !/Recherche|Searching|搜索|sur \d|of \d|\d+\s*\//.test(s.text) && s.rows > 0) { ended = t; break }
    }
    if (Date.now() - t0 > STREAM_TIMEOUT_MS) break
    await new Promise(r => setTimeout(r, SAMPLE_MS))
  }
  if (zeroSince !== null) finalZeroMs = Math.max(finalZeroMs, (Date.now() - t0) - zeroSince)
  if (atFirstRow === null) harness(`no result row appeared in ${Date.now() - t0} ms for "${domain}" — the bench cannot judge the cold path`)

  console.log('banner trail (cold load):')
  for (const s of trail.slice(0, 8)) console.log(`  ${String(s.t).padStart(6)} ms | stop=${s.stop ? 'yes' : 'no '} | rows=${String(s.rows).padStart(3)} | ${s.text}`)
  if (trail.length > 8) console.log(`  … ${trail.length - 8} more state(s), last: ${trail[trail.length - 1].text}`)
  console.log('')

  console.log('A. every search request carries the active account')
  const accountless = searchRequests.filter(r => !/[?&]account=/.test(r.url))
  check('no search fires before the account is resolved',
    accountless.length === 0,
    accountless.length ? `${accountless.length} request(s) without account=, first at +${accountless[0].at - t0} ms` : `${searchRequests.length} request(s), all scoped`)
  const wrongAccount = searchRequests.filter(r => /[?&]account=/.test(r.url) && !r.url.includes(`account=${account.id}`))
  check('every search targets the DISPLAYED mailbox', wrongAccount.length === 0,
    wrongAccount.length
      ? `${wrongAccount.length} of ${searchRequests.length} on another account: ` +
        wrongAccount.map(r => `+${r.at - t0} ms acct=${r.url.match(/account=([^&]+)/)?.[1]} stream=${/[?&]stream=/.test(r.url)}`).join(' | ') +
        ` (expected ${account.id})`
      : `all on ${account.email}`)

  console.log('\nB. the Stop button exists when the first result appears')
  check('Stop is present at the instant the first row is shown', atFirstRow.stop === true,
    `first row at +${atFirstRow.t} ms, banner "${atFirstRow.text}", stop=${atFirstRow.stop}`)

  console.log('\nC. the banner tells the truth while the stream runs')
  check('the folder progress is shown during the sweep', sawProgress,
    sawProgress ? 'progress seen' : 'no "x / y folders" state ever appeared')
  check('no final "0 result" is claimed before the stream ends', finalZeroMs === 0,
    finalZeroMs === 0 ? 'never' : `shown as final for ${finalZeroMs} ms`)
  check('the "body not searched" hint stays hidden while results exist', atFirstRow.hint === false,
    `hint=${atFirstRow.hint}`)
  if (scrolledAt === null) {
    // No arm without a reference: with a list too short to scroll, this mailbox
    // cannot show whether the reader's position survives the re-sorting.
    console.log(`  skip the list never exceeded ${SCROLL_PROBE_PX} px of scrollable height — scroll retention cannot be observed here`)
  } else {
    check('the reader\'s scroll position is not thrown back to the top mid-stream',
      scrollLow >= SCROLL_PROBE_PX / 2,
      `scrolled to ${SCROLL_PROBE_PX} px at +${scrolledAt} ms, lowest seen afterwards ${scrollLow} px`)
  }

  console.log('\nD. the stream covers every folder and ends on `done`')
  // Read once more, directly: the UI keeps only the capped top of the results, so
  // the coverage claim has to be read off the NDJSON lines themselves.
  const streamRead = await page.evaluate(async (args) => {
    const [id, q, qp, sp, sa, stp] = args
    const res = await fetch(`/api/messages/search?${qp}=${encodeURIComponent(q)}&folder=INBOX&${sp}=${sa}&${stp}=1&account=${id}`)
    const rd = res.body.getReader(); const dec = new TextDecoder()
    let buf = ''; const lines = []; let doneSeen = false
    for (;;) {
      const { done, value } = await rd.read()
      if (done) { doneSeen = true; break }
      buf += dec.decode(value, { stream: true })
      const parts = buf.split('\n'); buf = parts.pop()
      for (const x of parts) if (x.trim()) lines.push(JSON.parse(x))
    }
    const last = lines[lines.length - 1]
    return { status: res.status, lines: lines.length, doneSeen,
      searched: last?.searched ?? null, folders: last?.folders ?? null,
      errorLines: lines.filter(l => l.error).length }
  }, [account.id, domain, Q_PARAM, SCOPE_P, SCOPE_A, 'stream'])
  check('the reader reaches the end of the body', streamRead.doneSeen === true, `status ${streamRead.status}, ${streamRead.lines} NDJSON line(s)`)
  check('every folder announced is covered',
    streamRead.searched !== null && streamRead.searched === streamRead.folders,
    `${streamRead.searched} / ${streamRead.folders} folders`)
  check('no folder reports an error', streamRead.errorLines === 0, `${streamRead.errorLines} error line(s)`)
  // Recorded, deliberately NOT asserted on — see arm D's note in the header.
  console.log(`  note Chrome labelled the streamed request(s): ${chromeVerdicts.join(', ') || '(none)'} — not a criterion, see header`)

  console.log('\nE. read-only guarantee')
  check('the bench issued no mutating request on the messages API', blockedWrites.length === 0,
    blockedWrites.slice(0, 3).join(' | ') || 'none')

  console.log(`\nstream ended at ${ended ?? 'timeout'} ms`)
} finally {
  await browser.close().catch(() => {})
}

if (failures.length) { console.error(`\n${failures.length} check(s) failed`); process.exit(1) }
console.log('\ncheck-search-cold: OK')
