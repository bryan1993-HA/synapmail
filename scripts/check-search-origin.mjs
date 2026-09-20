#!/usr/bin/env node
/**
 * Measures, with REAL clicks, that a search result opens and is acted upon in
 * ITS OWN folder, not in the folder the list happens to display.
 *
 *  1. an "all folders" search returning results from at least TWO folders;
 *  2. clicking a result from ANOTHER folder asks the API for THAT folder, and
 *     the opened subject is the subject of the clicked row;
 *  3. ticking two results from two folders and marking them unread sends TWO
 *     grouped requests, each with its own folder and its own uids;
 *  4. two results carrying the SAME uid in two folders are two distinct rows:
 *     ticking one leaves the other unticked;
 *  5. the app never shows a client-side exception screen during all this.
 *
 * Nothing is read, moved or deleted on the real mailbox: every WRITE request
 * (PATCH/DELETE on the message routes) is captured and ABORTED by the bench.
 * Only GETs reach the server.
 *
 * Needs a running dev server and SYNAPMAIL_TEST_* credentials (see .env).
 *   node scripts/check-search-origin.mjs "<query>"
 */
import { readFileSync } from 'node:fs'
import puppeteer from 'puppeteer-core'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const VIEWPORT = { width: 1440, height: 900 }
const SETTLE_MS = 600
// A streamed "all folders" search keeps arriving: leave it time to cover the
// priority folders (inbox + sent), where a cross-folder pair is found.
const SEARCH_MS = 25000

// Read from the shipped modules so a rename there fails the bench instead of
// silently measuring an attribute nobody writes any more.
const ORIGIN_SRC = readFileSync(new URL('../lib/mailOrigin.ts', import.meta.url), 'utf8')
const ORIGIN_ATTR = ORIGIN_SRC.match(/MAIL_ORIGIN_ATTR = '([^']+)'/)?.[1]
const SEARCH_SRC = readFileSync(new URL('../lib/search.ts', import.meta.url), 'utf8')
const SCOPE_PARAM = SEARCH_SRC.match(/SCOPE_PARAM = '([^']+)'/)?.[1]
const SCOPE_ALL = SEARCH_SRC.match(/SCOPE_ALL = '([^']+)'/)?.[1]
const SEARCH_PARAM = SEARCH_SRC.match(/SEARCH_PARAM = '([^']+)'/)?.[1]
for (const [k, v] of Object.entries({ ORIGIN_ATTR, SCOPE_PARAM, SCOPE_ALL, SEARCH_PARAM })) {
  if (!v) { console.error(`HARNESS: could not read ${k} from the shipped modules`); process.exit(2) }
}

const ROW = `[${ORIGIN_ATTR}]`
const MENU = '[data-mail-context-menu]'
// The "Stop" label of the running stream, read from the shipped locale.
const STOP_LABEL = JSON.parse(readFileSync(new URL('../locales/fr.json', import.meta.url), 'utf8')).mail.searchStop
const QUERY = process.argv[2] ?? 'invoice'

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
const settle = () => new Promise(r => setTimeout(r, SETTLE_MS))

try {
  const page = await browser.newPage()
  await page.setViewport(VIEWPORT)

  const reads = []   // GET /api/messages/<uid>?…  — what the app asks to OPEN
  const writes = []  // grouped writes, captured and aborted
  await page.setRequestInterception(true)
  page.on('request', req => {
    const url = new URL(req.url())
    const method = req.method()
    if (/\/api\/messages\/bulk$/.test(url.pathname) && method !== 'GET') {
      writes.push({ method, body: req.postData() })
      req.abort().catch(() => {})
      return
    }
    const single = url.pathname.match(/^\/api\/messages\/([^/]+)$/)
    if (single) {
      const seen = { uid: single[1], folder: url.searchParams.get('folder'), account: url.searchParams.get('account') }
      if (method === 'GET') reads.push(seen)
      else { writes.push({ method, ...seen }); req.abort().catch(() => {}); return }
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

  // --- 1. An "all folders" search, by URL (cold), with results from 2 folders ---
  const href = `${BASE}/mail?${SEARCH_PARAM}=${encodeURIComponent(QUERY)}&${SCOPE_PARAM}=${SCOPE_ALL}`
  await page.goto(href, { waitUntil: 'networkidle2' })
  await page.waitForSelector(ROW, { timeout: 40000 })
  const deadline = Date.now() + SEARCH_MS
  let rows = []
  // The subject is the row's longest text line: the others are the sender, the
  // date, the folder chip and the preview, all shorter or structured.
  const readRows = () => page.$$eval(ROW, (els, attr) => els.map(el => ({
    key: el.getAttribute(attr),
    lines: el.innerText.split('\n').map(s => s.trim()).filter(Boolean),
  })), ORIGIN_ATTR)
  const folderOf = key => decodeURIComponent(key.split('|')[1] ?? '')
  const uidOf = key => decodeURIComponent(key.split('|')[2] ?? '')
  while (Date.now() < deadline) {
    rows = await readRows()
    if (new Set(rows.map(r => folderOf(r.key))).size >= 2) break
    await settle()
  }
  // The stream keeps inserting and reordering rows; a key read one step earlier
  // may be gone by the next click. Stop it once the cross-folder pair is there:
  // the bench measures what the app DOES with a result, not the stream itself
  // (that is scripts/check-search-cancel.mjs).
  const stop = (await page.$$('button')).length
    ? await page.evaluateHandle(label => [...document.querySelectorAll('button')]
        .find(b => b.textContent.trim() === label) ?? null, STOP_LABEL)
    : null
  if (stop && await stop.evaluate(el => !!el)) { await stop.click(); await settle() }
  rows = await readRows()
  const folders = [...new Set(rows.map(r => folderOf(r.key)))]
  console.log(`rows: ${rows.length}, folders represented: ${folders.length} (${folders.slice(0, 4).join(', ')})`)
  if (folders.length < 2) {
    console.error(`HARNESS: the query "${QUERY}" returned results from ${folders.length} folder(s); a cross-folder pair is required`)
    process.exit(2)
  }

  // The list's own folder, i.e. what the buggy version used to send.
  const listFolder = await page.evaluate(() => new URL(location.href).searchParams.get('folder') ?? 'INBOX')
  const other = rows.find(r => folderOf(r.key) !== listFolder) ?? rows.find(r => folderOf(r.key) !== folderOf(rows[0].key))
  // The pane titles with the subject: the row line that the pane echoes.
  const subjectOf = r => r.lines.slice().sort((a, b) => b.length - a.length)[0] ?? ''
  console.log(`displayed folder: ${listFolder}; clicked result comes from: ${folderOf(other.key)}`)

  // --- 2. Opening it reads it from ITS folder, and shows ITS subject ---
  reads.length = 0
  await page.click(`[${ORIGIN_ATTR}="${other.key}"]`)
  await settle()
  await settle()
  const opened = reads.filter(r => r.uid === uidOf(other.key))
  console.log(`open request(s): ${opened.map(r => `uid=${r.uid} folder=${r.folder}`).join(' | ') || '(none)'}`)
  if (!opened.length) fail('clicking a result sent no read request for its uid')
  for (const r of opened) {
    if (r.folder !== folderOf(other.key)) {
      fail(`the app read uid ${r.uid} from "${r.folder}" instead of its own folder "${folderOf(other.key)}"`)
    }
  }
  const paneSubject = await page.evaluate(() => document.querySelector('h1, h2')?.textContent?.trim() ?? '')
  const rowSubject = subjectOf(other)
  console.log(`row lines: ${JSON.stringify(other.lines.slice(0, 5))}`)
  console.log(`row subject: "${rowSubject.slice(0, 60)}" / pane subject: "${paneSubject.slice(0, 60)}"`)
  // Compare on a normalised prefix: the row truncates, the pane does not.
  const norm = s => s.replace(/\s+/g, ' ').trim().toLowerCase()
  if (!paneSubject) {
    fail('no subject is shown in the reading pane')
  } else if (rowSubject && !norm(paneSubject).startsWith(norm(rowSubject).slice(0, 18))) {
    fail(`the opened message ("${paneSubject}") is not the clicked row ("${rowSubject}")`)
  }

  // --- 3. A cross-folder selection sends ONE grouped request PER folder ---
  // Re-read: a streamed search keeps inserting rows, so a key read minutes ago
  // may no longer be on screen. Measuring a stale key would be a HARNESS error.
  rows = await readRows()
  const onScreen = new Set(rows.map(r => r.key))
  const liveFolders = [...new Set(rows.map(r => folderOf(r.key)))]
  if (liveFolders.length < 2) {
    console.error(`HARNESS: only ${liveFolders.length} folder(s) on screen after the open step (${liveFolders.join(', ')})`)
    process.exit(2)
  }
  const first = rows.find(r => folderOf(r.key) === liveFolders[0])
  const second = rows.find(r => folderOf(r.key) === liveFolders[1])
  console.log(`selection: ${folderOf(first.key)}:${uidOf(first.key)} + ${folderOf(second.key)}:${uidOf(second.key)}`)
  const ACCEL = process.platform === 'darwin' ? 'Meta' : 'Control'
  for (const r of [first, second]) {
    if (!onScreen.has(r.key)) { console.error(`HARNESS: row ${r.key} vanished`); process.exit(2) }
    await page.keyboard.down(ACCEL)
    await page.click(`[${ORIGIN_ATTR}="${r.key}"]`)
    await page.keyboard.up(ACCEL)
    await settle()
  }
  // The selection is acted upon from the right-click menu (the keyboard "u"
  // targets the OPEN message, which is a different, single-target path).
  writes.length = 0
  await page.click(`[${ORIGIN_ATTR}="${second.key}"]`, { button: 'right' })
  await settle()
  const entry = (await page.$(`${MENU} [data-menu-item="markUnread"]`))
    ?? (await page.$(`${MENU} [data-menu-item="markRead"]`))
  if (!entry) { console.error('HARNESS: the right-click menu offers no read/unread entry'); process.exit(2) }
  await entry.click()
  await settle()
  const bulk = writes.filter(w => w.body)
  const parsed = bulk.map(w => { try { return JSON.parse(w.body) } catch { return {} } })
  console.log(`grouped write(s): ${parsed.map(b => `${b.folder}:[${(b.uids ?? []).join(',')}]`).join(' | ') || '(none)'}`)
  if (parsed.length !== 2) fail(`marking a 2-folder selection unread sent ${parsed.length} request(s), expected 2 (one per folder)`)
  for (const r of [first, second]) {
    const group = parsed.find(b => b.folder === folderOf(r.key))
    if (!group) { fail(`no request carried the folder "${folderOf(r.key)}"`); continue }
    if (!(group.uids ?? []).includes(uidOf(r.key))) {
      fail(`the request for "${group.folder}" carries uids ${(group.uids ?? []).join(',')}, not ${uidOf(r.key)}`)
    }
  }
  const strayFolder = parsed.find(b => !liveFolders.includes(b.folder))
  if (strayFolder) fail(`a request went out with folder "${strayFolder.folder}", which no selected row came from`)

  // --- 4. Same uid in two folders = two independent rows ---
  const byUid = new Map()
  for (const r of rows) {
    const u = uidOf(r.key)
    byUid.set(u, [...(byUid.get(u) ?? []), r])
  }
  const twin = [...byUid.values()].find(list => list.length > 1)
  if (!twin) {
    console.log('same-uid pair: none in these results (invariant re-checked by scripts/check-mail-origin.mjs)')
  } else {
    await page.keyboard.press('Escape')
    await settle()
    await page.keyboard.down(ACCEL)
    await page.click(`[${ORIGIN_ATTR}="${twin[0].key}"]`)
    await page.keyboard.up(ACCEL)
    await settle()
    const ticked = await page.$$eval(`${ROW}[aria-selected="true"]`, (els, attr) => els.map(e => e.getAttribute(attr)), ORIGIN_ATTR)
    console.log(`same uid ${uidOf(twin[0].key)} in ${twin.length} folders; ticked rows: ${ticked.length}`)
    if (ticked.includes(twin[1].key)) fail(`ticking ${twin[0].key} also ticked its same-uid twin ${twin[1].key}`)
  }

  // --- 5. No client-side exception screen at any point ---
  const crashed = await page.evaluate(() => /Application error/i.test(document.body.innerText))
  console.log(`client-side exception screen: ${crashed}`)
  if (crashed) fail('the app showed an "Application error" screen')
} finally {
  await browser.close()
}

if (failures.length) { console.error(`\n${failures.length} failure(s)`); process.exit(1) }
console.log('\ncheck-search-origin: OK (no real message was read, moved or deleted)')
