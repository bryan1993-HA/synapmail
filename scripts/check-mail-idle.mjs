#!/usr/bin/env node
/**
 * Measures the REAL-TIME arrival of a new message, on the running app: a
 * message is APPENDed into the test account's INBOX over a SEPARATE IMAP
 * connection, and the bench waits for its row to appear in the open list.
 *
 * What makes this a real-time measurement and not a polling one: the deadline
 * is read from the list's OWN refresh interval. The bench requires its deadline
 * to be a small fraction of that interval, so a row that only appeared because
 * the periodic refetch happened to fire cannot pass. The bench also demands a
 * QUIET window (no /api/messages call at all) right before the append, so the
 * refetch that does arrive is provably caused by the append.
 *
 * The deadline is never compared to the app alone: the bench opens its OWN IDLE
 * connection to the same mailbox and records when the SERVER announces the new
 * message. That reference arm, measured in the SAME run, is what says whether a
 * missed deadline is the app's latency or the IMAP server's announcement cadence.
 * Both criteria are checked: the absolute ceiling the user experiences, and the
 * delay the app adds on top of the announcement, which is the part our code owns.
 *
 * Nothing touches a real message: the bench appends ITS OWN message and expunges
 * exactly that uid at the end. No other message is read, moved, flagged or deleted.
 *
 * Needs a running dev server and SYNAPMAIL_TEST_* credentials (see .env).
 *   node --experimental-strip-types scripts/check-mail-idle.mjs
 *
 * Negative control — proves the bench can see the defect it exists for:
 *   node --experimental-strip-types scripts/check-mail-idle.mjs --no-idle
 * strips the account parameter from the SSE stream (so the server watches
 * nothing) and EXPECTS the run to fail.
 */
import { readFileSync } from 'node:fs'
import puppeteer from 'puppeteer-core'
import { ImapFlow } from 'imapflow'
import { IDLE_FOLDER, STREAM_ACCOUNT_PARAM } from '../lib/stream.ts'
import { decrypt } from '../lib/encrypt.ts'
import { SCRATCH_DOMAIN } from './bench-constants.mjs'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const VIEWPORT = { width: 1440, height: 900 }
// The DoD's deadline, decided by the human on 2026-09-19 after this bench had
// MEASURED that the server itself only announces a new message 7.5-9.2s after the
// append: an absolute ceiling the whole chain must hold, plus a budget on the
// only part the app controls (the delay it adds on top of the announcement).
// Calibration bench: one IMAP provider, test account, local dev server.
const REALTIME_MS = 15000
// How much the app may add on top of the server's announcement, measured in the
// SAME pass by the reference arm below. This is the real criterion on our code.
const APP_BUDGET_MS = 3000
// No /api/messages call may happen during this window before the append: it is
// what proves the refetch that follows was caused by the append, not by a poll.
const QUIET_MS = 3000
const POLL_MS = 100
// How long the reference arm is given to hear the server out. Must exceed the
// deadline, otherwise a missed deadline could never be attributed to the server.
const REFERENCE_MS = 30000
// The bench must not stop looking at the row before the ceiling: the two numbers
// (row shown, server announced) are only comparable inside the same pass.

/** `--no-idle` drops the account from the stream URL: the negative control. */
const NO_IDLE = process.argv.includes('--no-idle')

// The deadline must be provably out of reach of the periodic refetch, which is
// read from the shipped component: bumping the interval there cannot silently
// turn this bench into a polling measurement.
const LIST_SRC = readFileSync(new URL('../components/layout/MessageList.tsx', import.meta.url), 'utf8')
const REFRESH_MS = Number(LIST_SRC.match(/refreshInterval:\s*(\d+)/)?.[1])
if (!REFRESH_MS) { console.error('HARNESS: could not read refreshInterval from components/layout/MessageList.tsx'); process.exit(2) }
if (REFRESH_MS < REALTIME_MS * 4) {
  console.error(`HARNESS: refetch every ${REFRESH_MS}ms is too close to the ${REALTIME_MS}ms deadline — the bench could not tell real time from polling`)
  process.exit(2)
}

const ROW = '[data-mail-row]'

for (const file of ['../.env', '../.env.local']) {
  for (const line of readFileSync(new URL(file, import.meta.url), 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
  }
}
const { SYNAPMAIL_TEST_URL: BASE, SYNAPMAIL_TEST_EMAIL: EMAIL, SYNAPMAIL_TEST_PASSWORD: PASSWORD } = process.env
for (const [k, v] of Object.entries({ SYNAPMAIL_TEST_URL: BASE, SYNAPMAIL_TEST_EMAIL: EMAIL, SYNAPMAIL_TEST_PASSWORD: PASSWORD })) {
  if (!v) { console.error(`HARNESS: ${k} is not set`); process.exit(2) }
}

// The account the UI actually shows: the one the user settings point at, else
// the default one. Appending to any other account would measure nothing.
const { default: pg } = await import('pg')
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const { rows } = await pool.query(
  `SELECT a.* FROM email_accounts a
     JOIN users u ON u.id = a.user_id
     LEFT JOIN user_settings s ON s.user_id = u.id
   WHERE u.email = $1
   ORDER BY (a.id = s.active_account_id) DESC, a.is_default DESC, a.created_at
   LIMIT 1`, [EMAIL])
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

const SUBJECT = `check-mail-idle ${Date.now()}`
const failures = []
const fail = (m) => { failures.push(m); console.error(`FAIL: ${m}`) }
let uid = null

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] })
try {
  const page = await browser.newPage()
  await page.setViewport(VIEWPORT)

  if (NO_IDLE) {
    // Negative control: the page opens its stream without naming an account, so
    // the server has nothing to watch. Everything else is identical.
    await page.evaluateOnNewDocument((param) => {
      const Native = window.EventSource
      window.EventSource = function (url, init) {
        const stripped = new URL(url, location.origin)
        stripped.searchParams.delete(param)
        return new Native(stripped.toString(), init)
      }
    }, STREAM_ACCOUNT_PARAM)
  }

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

  // Every list refetch is timestamped: this is what separates "pushed" from "polled".
  const listCalls = []
  page.on('request', (r) => {
    const u = r.url()
    if (u.includes('/api/messages?') || u.endsWith('/api/messages')) listCalls.push(Date.now())
  })

  // A live EventSource never completes, so it is absent from the performance
  // resource entries: the URL is taken from the request the browser issued
  // (the bench's own first defect was reading the entries and seeing nothing).
  const streamUrls = []
  page.on('request', (r) => { if (r.url().includes('/api/stream')) streamUrls.push(r.url()) })

  await page.goto(`${BASE}/mail`, { waitUntil: 'networkidle2' })
  await page.waitForSelector(ROW, { timeout: 30000 })

  const streamUrl = streamUrls.find(u => u.includes(`${STREAM_ACCOUNT_PARAM}=`)) ?? streamUrls[0] ?? null
  console.log(`stream opened: ${streamUrl ?? 'none'}`)
  if (!NO_IDLE) {
    if (!streamUrl) fail('no /api/stream connection was opened')
    else if (!streamUrl.includes(`${STREAM_ACCOUNT_PARAM}=`)) fail(`stream URL carries no ${STREAM_ACCOUNT_PARAM} parameter: ${streamUrl}`)
  }

  // Quiet window: no refetch at all, so the one that follows the append is the append's.
  const quietFrom = Date.now()
  await new Promise(r => setTimeout(r, QUIET_MS))
  const duringQuiet = listCalls.filter(t => t >= quietFrom).length
  console.log(`refetches during the ${QUIET_MS}ms quiet window: ${duringQuiet} (expected 0)`)
  if (duringQuiet > 0) { console.error('HARNESS: the list refetched while idle — cannot attribute the next refetch to the append'); process.exit(2) }

  // Reference arm: an IDLE connection of the bench's own, on the same mailbox.
  // It measures what the SERVER does, independently of the app.
  let announcedAt = null
  const reference = await imap()
  reference.on('error', () => {})
  reference.on('exists', () => { announcedAt ??= Date.now() })
  await reference.mailboxOpen(IDLE_FOLDER)
  void reference.idle().catch(() => {})

  // --- APPEND our own message into the watched mailbox ---
  {
    const c = await imap()
    try {
      await c.mailboxOpen(IDLE_FOLDER)
      const raw = Buffer.from(
        `From: bench <${acc.email}>\r\nTo: bench <${acc.email}>\r\n` +
        `Subject: ${SUBJECT}\r\nDate: ${new Date().toUTCString()}\r\n` +
        `Message-ID: <${SUBJECT.replace(/\s/g, '-')}@${SCRATCH_DOMAIN}>\r\n\r\nbench message\r\n`)
      uid = String((await c.append(IDLE_FOLDER, raw, ['\\Seen'])).uid)
    } finally { await c.logout() }
  }
  const appendedAt = Date.now()
  console.log(`appended uid ${uid} to ${IDLE_FOLDER} with subject "${SUBJECT}"`)

  // --- wait for the row, with no help from the bench (no refresh click, no reload) ---
  let shownAt = null
  while (Date.now() - appendedAt < REALTIME_MS) {
    const present = await page.$$eval(ROW, (els, subject) => els.some(el => el.textContent.includes(subject)), SUBJECT)
    if (present) { shownAt = Date.now(); break }
    await new Promise(r => setTimeout(r, POLL_MS))
  }
  const elapsed = (shownAt ?? Date.now()) - appendedAt
  console.log(`row visible after ${elapsed}ms (ceiling ${REALTIME_MS}ms, periodic refetch every ${REFRESH_MS}ms)`)
  if (!shownAt) fail(`the appended message did not appear within ${REALTIME_MS}ms`)

  const pushed = listCalls.filter(t => t >= appendedAt).length
  console.log(`refetches caused by the append: ${pushed} (expected at least 1)`)
  if (shownAt && pushed < 1) fail('the row appeared without any refetch — measurement is not trustworthy')

  // Attribution: how much of the elapsed time is the server's, how much is ours.
  while (!announcedAt && Date.now() - appendedAt < REFERENCE_MS) await new Promise(r => setTimeout(r, POLL_MS))
  await reference.logout().catch(() => {})
  const serverMs = announcedAt ? announcedAt - appendedAt : null
  console.log(`reference arm — server announced the message after ${serverMs ?? `NEVER (>${REFERENCE_MS}ms)`}ms`)
  if (serverMs === null) {
    // Without the reference arm there is no same-pass control, so the app's own
    // share is unknown: the run proves nothing and must not be read as a pass.
    fail(`the server never announced the message on the reference connection within ${REFERENCE_MS}ms — the app's share cannot be measured`)
  } else {
    const appMs = elapsed - serverMs
    console.log(`app share: ${appMs}ms on top of the server's announcement (budget ${APP_BUDGET_MS}ms)`)
    if (shownAt && appMs > APP_BUDGET_MS) fail(`the app added ${appMs}ms on top of the server's ${serverMs}ms announcement, over the ${APP_BUDGET_MS}ms budget`)
  }
} finally {
  await browser.close()
  if (uid) {
    const c = await imap()
    try {
      await c.mailboxOpen(IDLE_FOLDER)
      await c.messageDelete(uid, { uid: true })
      console.log(`bench message uid ${uid} deleted from ${IDLE_FOLDER}`)
    } catch (err) {
      console.error(`HARNESS: could not delete bench message uid ${uid}: ${err.message}`)
    } finally { await c.logout() }
  }
}

if (NO_IDLE) {
  if (failures.length) { console.log(`OK (negative control) — without ${STREAM_ACCOUNT_PARAM}, the bench fails as it must: ${failures.length} failure(s)`); process.exit(0) }
  console.error('FAIL (negative control): the bench passed with the stream stripped of its account — it cannot see the defect it exists for')
  process.exit(1)
}
if (failures.length) { console.error(`\n${failures.length} failure(s)`); process.exit(1) }
console.log('\nOK — real time measured end to end')
