#!/usr/bin/env node
/**
 * Measures the multi-message forward with REAL clicks, on the running
 * app: N rows are selected in the list, the toolbar's Forward action is fired,
 * and the compose window must open carrying those N messages.
 *
 * NOTHING IS SENT. The bench stops at the built payload: it intercepts the POST
 * to /api/messages/send in the page, reads what the window WOULD have sent, and
 * aborts the request. No message is moved, deleted, flagged or mailed.
 *
 * The attached sources are not taken on trust either: the bench opens its OWN
 * IMAP connection to the same mailbox and checks those uids really yield N
 * non-empty message sources. File names and MIME type are read from lib/eml.ts,
 * the single definition the route dresses the attachments with, so a rename
 * there fails the bench instead of letting it measure a constant nobody writes
 * any more. (The bench cannot import lib/imap.ts itself: that module reaches its
 * siblings without a file extension, which Node's type stripping cannot resolve.
 * What the ROUTE does with these sources — order restoration, naming — is
 * therefore not measured here; see the Journal's WHAT THIS DOES NOT SAY.)
 *
 * Needs a running dev server and SYNAPMAIL_TEST_* credentials (see .env).
 *   node --experimental-strip-types scripts/check-mail-forward.mjs
 */
import { readFileSync } from 'node:fs'
import puppeteer from 'puppeteer-core'
import { ImapFlow } from 'imapflow'
import { EML_CONTENT_TYPE, EML_EXTENSION, emlFilename } from '../lib/eml.ts'
import { decrypt } from '../lib/encrypt.ts'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const VIEWPORT = { width: 1440, height: 900 }
const SETTLE_MS = 400
// Forward on a selection of this size. 3 is the smallest count that can expose
// an order defect (a 2-item list is its own reverse).
const FORWARD_N = 3
const MIN_ROWS = FORWARD_N + 1
// Margin on top of the app's own undo-send delay, for the round-trip the window
// makes once the countdown ends. Calibrated on a local dev server.
const SEND_GRACE_MS = 5000

// Read from the shipped module so a rename there fails the bench instead of
// silently measuring an attribute nobody writes any more.
const MODULE_SRC = readFileSync(new URL('../lib/mailSelection.tsx', import.meta.url), 'utf8')
const COUNT_ATTR = MODULE_SRC.match(/MAIL_SELECTION_COUNT_ATTR = '([^']+)'/)?.[1]
if (!COUNT_ATTR) { console.error('HARNESS: could not read MAIL_SELECTION_COUNT_ATTR from lib/mailSelection.tsx'); process.exit(2) }

const LIST = `[${COUNT_ATTR}]`
const ROW = '[data-mail-row]'
const MENU = '[data-mail-context-menu]'
const FORWARD_ITEM = `${MENU} [data-menu-item="forward"]`
const COMPOSE_CHIP = '[data-forwarded-count]'
// The "From" picker: a real listbox of buttons, one per account. Scoped by its
// own attribute — the message list's rows are `role="option"` too, and a bare
// role selector picks a mail row instead of an account.
const FROM_TRIGGER = '[data-compose-from]'
const FROM_OPTION = '[data-compose-from-list] [role="option"]'
// Budget for the accounts round-trip the compose window makes on mount.
// Measured on a local dev server: the picker appears well under 1 s.
const FROM_PICKER_TIMEOUT_MS = 5000

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
// the default one. Reading any other account would measure nothing.
const { default: pg } = await import('pg')
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const { rows: accRows } = await pool.query(
  `SELECT a.* FROM email_accounts a
     JOIN users u ON u.id = a.user_id
     LEFT JOIN user_settings s ON s.user_id = u.id
   WHERE u.email = $1
   ORDER BY (a.id = s.active_account_id) DESC, a.is_default DESC, a.created_at
   LIMIT 1`, [EMAIL])
await pool.end()
const acc = accRows[0]
if (!acc) { console.error(`HARNESS: no email account for ${EMAIL}`); process.exit(2) }

const failures = []
const fail = (m) => { failures.push(m); console.error(`FAIL: ${m}`) }

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] })
let sentPayload = null
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

  // NOTHING IS SENT: the send request is read and aborted before it leaves.
  await page.setRequestInterception(true)
  page.on('request', (req) => {
    if (req.method() === 'POST' && req.url().includes('/api/messages/send')) {
      try { sentPayload = JSON.parse(req.postData() ?? '{}') } catch { sentPayload = null }
      return req.abort()
    }
    return req.continue()
  })

  await page.goto(`${BASE}/mail`, { waitUntil: 'networkidle2' })
  await page.waitForSelector(ROW, { timeout: 30000 })
  await new Promise(r => setTimeout(r, SETTLE_MS))

  const rowCount = await page.$$eval(ROW, els => els.length)
  console.log(`rows loaded: ${rowCount}`)
  if (rowCount < MIN_ROWS) { console.error(`HARNESS: only ${rowCount} rows loaded, need ${MIN_ROWS}`); process.exit(2) }

  const ACCEL = process.platform === 'darwin' ? 'Meta' : 'Control'
  const settle = () => new Promise(r => setTimeout(r, SETTLE_MS))
  const readCount = () => page.$eval(LIST, (el, attr) => Number(el.getAttribute(attr)), COUNT_ATTR)
  const row = async (i) => {
    const handle = (await page.$$(ROW))[i]
    if (!handle) { console.error(`HARNESS: row ${i} vanished`); process.exit(2) }
    return handle
  }
  const clickRow = async (i, modifier) => {
    const handle = await row(i)
    if (modifier) await page.keyboard.down(modifier)
    await handle.click()
    if (modifier) await page.keyboard.up(modifier)
    await settle()
  }

  // --- 1. Select N rows, in a known order, and read back what they are ---
  await clickRow(0, ACCEL)
  for (let i = 1; i < FORWARD_N; i++) await clickRow(i, ACCEL)
  const selected = await readCount()
  console.log(`selection built: ${selected} (expected ${FORWARD_N})`)
  if (selected !== FORWARD_N) { console.error(`HARNESS: could not build a ${FORWARD_N}-row selection (got ${selected})`); process.exit(2) }
  const selectedUids = await page.$$eval(ROW, els =>
    els.filter(el => el.getAttribute('aria-selected') === 'true').map(el => el.getAttribute('data-mail-row')))
  console.log(`selected uids: ${selectedUids.join(',')}`)
  if (selectedUids.length !== FORWARD_N) { console.error(`HARNESS: aria-selected marks ${selectedUids.length} rows, expected ${FORWARD_N}`); process.exit(2) }

  // --- 2. Forward the selection from the context menu (a REAL right-click + click) ---
  const anchor = await row(FORWARD_N - 1)
  await anchor.click({ button: 'right' })
  await settle()
  if (!(await page.$(MENU))) { console.error('HARNESS: the context menu did not open'); process.exit(2) }
  const stillSelected = await readCount()
  if (stillSelected !== FORWARD_N) { console.error(`HARNESS: right-click shrank the selection to ${stillSelected}`); process.exit(2) }
  await page.click(FORWARD_ITEM)
  await settle()

  // --- 3. The compose window opens, holding exactly those N messages ---
  const chip = await page.$(COMPOSE_CHIP)
  if (!chip) fail('the compose window opened without the attached-messages row')
  const chipCount = chip ? await page.$eval(COMPOSE_CHIP, el => Number(el.getAttribute('data-forwarded-count'))) : 0
  console.log(`compose shows attached messages: ${chipCount} (expected ${FORWARD_N})`)
  if (chip && chipCount !== FORWARD_N) fail(`the compose window shows ${chipCount} attached message(s), expected ${FORWARD_N}`)

  // The subject is the multi-message one, not a single message's "Fwd: <subject>".
  const subject = await page.$eval('input[placeholder="Objet de votre message"]', el => el.value).catch(() => null)
  console.log(`compose subject: ${JSON.stringify(subject)}`)
  if (!subject || !subject.includes(String(FORWARD_N))) fail(`the subject ${JSON.stringify(subject)} does not name the ${FORWARD_N} forwarded messages`)

  // --- 4. The sender is switched to ANOTHER mailbox ---
  // This is the defect review caught: the selection was clicked in mailbox A,
  // the user then picks mailbox B in "From". The uids of an inbox are small
  // integers and exist in BOTH, so a payload that names only a folder would
  // make the server attach B's messages — three mails the user never saw.
  // The request must keep naming A.
  let switchedFrom = null
  // The picker only exists once the window knows the user's accounts (one SWR
  // round-trip after it mounts), and only when there are several — probing it
  // the instant the window opens would read "single account" on a multi-account
  // user and quietly skip the very case under test.
  const fromTrigger = await page.waitForSelector(FROM_TRIGGER, { timeout: FROM_PICKER_TIMEOUT_MS }).catch(() => null)
  if (fromTrigger) {
    await fromTrigger.click()
    await settle()
    switchedFrom = await page.$$eval(FROM_OPTION, (els) => {
      const other = els.find(el => el.getAttribute('aria-selected') !== 'true')
      if (!other) return null
      other.click()
      return (other.textContent ?? '').trim()
    })
    await settle()
  }
  console.log(`sender switched to another mailbox: ${switchedFrom ? JSON.stringify(switchedFrom) : 'NO (single account)'}`)

  // --- 5. What the window WOULD send names those uids, in the selection's order ---
  await page.type('input[placeholder="destinataire@exemple.com"]', `${EMAIL}\n`)
  await settle()
  await page.$$eval('button', (els) => {
    const btn = els.find(b => /envoyer/i.test(b.textContent ?? ''))
    if (btn) btn.click()
  })
  // The window holds the request back for the user's undo-send delay. That delay
  // is read from the app itself — a constant here would go stale the day the
  // setting changes, and the bench would call a working window silent.
  const undoDelayMs = await page.evaluate(async () => {
    const res = await fetch('/api/settings')
    const json = await res.json()
    return (json?.data?.undo_send_delay ?? 0) * 1000
  })
  const sendDeadline = Date.now() + undoDelayMs + SEND_GRACE_MS
  console.log(`waiting for the send request: undo-send delay ${undoDelayMs}ms + ${SEND_GRACE_MS}ms grace`)
  while (!sentPayload && Date.now() < sendDeadline) await new Promise(r => setTimeout(r, 200))
  if (!sentPayload) fail('the window built no send request (nothing could be read, and nothing was sent)')
  else {
    const fw = sentPayload.forwardedMessages
    console.log(`payload.forwardedMessages: accountId=${fw?.accountId} folder=${fw?.folder} uids=${fw?.uids?.join(',')}`)
    console.log(`payload.accountId (the SENDER): ${sentPayload.accountId}`)
    if (!fw) fail('the send payload carries no forwardedMessages')
    else {
      if (!fw.folder) fail('the send payload names no folder for the forwarded messages')
      if (fw.uids?.join(',') !== selectedUids.join(',')) {
        fail(`the payload forwards [${fw.uids?.join(',')}] while the selection was [${selectedUids.join(',')}]`)
      }
      // The origin travels with the selection, not with the "From" picker.
      if (fw.accountId !== acc.id) {
        fail(`the payload reads the sources in ${fw.accountId}, while the selection was clicked in ${acc.id}`)
      }
      if (switchedFrom && sentPayload.accountId === fw.accountId) {
        fail('the sender was switched to another mailbox, yet sender and origin are still the same account')
      }
      if (switchedFrom) {
        console.log(`origin ${fw.accountId} != sender ${sentPayload.accountId}: sources stay in the selected mailbox`)
      }
    }
  }
} finally {
  await browser.close()
}

// --- 6. Those uids really yield N non-empty message sources ---
// READ ONLY: the mailbox is opened read-only, nothing is written, moved or flagged.
if (sentPayload?.forwardedMessages?.uids?.length) {
  const { folder, uids } = sentPayload.forwardedMessages
  const client = new ImapFlow({
    host: acc.imap_host, port: acc.imap_port, secure: acc.imap_secure,
    auth: { user: acc.username, pass: decrypt(acc.password_encrypted) },
    logger: false, tls: { rejectUnauthorized: false },
  })
  await client.connect()
  const fetched = []
  try {
    await client.mailboxOpen(folder, { readOnly: true })
    for await (const msg of client.fetch(uids.join(','), { uid: true, envelope: true, source: true }, { uid: true })) {
      fetched.push({ uid: String(msg.uid), subject: msg.envelope?.subject ?? '', bytes: msg.source?.length ?? 0 })
    }
  } finally {
    await client.logout()
  }
  console.log(`\nsources fetched from ${folder}: ${fetched.length} (expected ${uids.length})`)
  if (fetched.length !== uids.length) fail(`${fetched.length} source(s) came back for ${uids.length} uid(s)`)
  for (const s of fetched) {
    const name = emlFilename(s.subject)
    console.log(`  uid ${s.uid}: ${s.bytes} bytes, ${EML_CONTENT_TYPE}, "${name}"`)
    if (s.bytes <= 0) fail(`uid ${s.uid} yields an empty source (${s.bytes} bytes)`)
    if (!name.endsWith(EML_EXTENSION)) fail(`uid ${s.uid} would be attached as "${name}", not a ${EML_EXTENSION} file`)
  }
}

if (failures.length) {
  console.error(`\ncheck-mail-forward: ${failures.length} failure(s)`)
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(1)
}
console.log('\ncheck-mail-forward: OK (nothing was sent)')
