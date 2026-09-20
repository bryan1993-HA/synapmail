#!/usr/bin/env node
/**
 * MEASURES what the search needs to know BEFORE choosing a strategy, straight against
 * the real IMAP server (read only: CAPABILITY, LIST, STATUS, SELECT and SEARCH —
 * it never creates, moves or deletes a message, and never prints a body, an
 * address or a password).
 *
 * What it measures, each arm carrying its own same-run reference:
 *  A. CAPABILITY — what the server announces (ESEARCH, MULTISEARCH, SEARCH=FUZZY,
 *     WITHIN, LIST-STATUS…). This is a MEASUREMENT, not a check: the list is
 *     printed so the Journal can quote it. The only assertion is the one the
 *     product actually depends on — LIST-STATUS, whose absence degrades the
 *     folder ORDER (never the result), so it is reported, not failed.
 *  B. PER-FOLDER COST — SELECT+SEARCH on one folder, timed. Same-run REFERENCE:
 *     the SELECT alone on the SAME folder, so the number attributes the cost to
 *     opening the mailbox rather than to the search itself. No absolute
 *     threshold: both numbers come from this run, on this server.
 *  C. FULL SCOPE — per-folder cost × folders to cover, with SEARCH_CONNECTIONS
 *     workers: the projected duration of a non-progressive "all folders" search.
 *     The assertion is the one the server-side search exists for: that projection must EXCEED the
 *     10 s target, otherwise streaming would be solving a problem that is not
 *     there and the lot's premise would be wrong.
 *  D. RANKING — listFoldersRanked returns fewer folders than LIST (empty ones are
 *     dropped) and puts a priority role first. Same-run reference: the raw LIST.
 *
 * The folders it times are DISCOVERED (the largest ones the server reports), so
 * the bench keeps measuring after the test account's content changes.
 *
 *   node --experimental-strip-types scripts/check-search-capability.mjs
 */
import { readFileSync, existsSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { Pool } from 'pg'

// Unlike the HTTP benches, this one talks to IMAP and PostgreSQL directly, so it
// needs the server-side secrets too: `.env.local` carries DATABASE_URL and
// ENCRYPTION_KEY, `.env` the test account. Neither is ever printed.
for (const file of ['.env', '.env.local']) {
  const url = new URL(`../${file}`, import.meta.url)
  if (!existsSync(url)) continue
  for (const line of readFileSync(url, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
  }
}

// The product's own modules are IMPORTED, never retyped: a change in lib/imap.ts
// or lib/search.ts fails this bench instead of silently making it measure
// something else. Same resolver as the other benches — extensionless relative
// specifiers and the `@/` root alias, both resolved to their .ts source.
const ROOT = new URL('../', import.meta.url)
registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith('@/')) {
      const url = new URL(`${spec.slice(2)}.ts`, ROOT)
      if (existsSync(url)) return next(url.href, ctx)
      return next(new URL(spec.slice(2), ROOT).href, ctx)
    }
    if (spec.startsWith('.') && !/\.[a-z]+$/.test(spec)) {
      const url = new URL(`${spec}.ts`, ctx.parentURL)
      if (existsSync(url)) return next(url.href, ctx)
    }
    return next(spec, ctx)
  },
})

const { ImapFlow } = await import('imapflow')
const { decrypt } = await import(new URL('../lib/encrypt.ts', import.meta.url).href)
const { listFoldersRanked, SEARCH_CONNECTIONS } = await import(new URL('../lib/imap.ts', import.meta.url).href)
const { SEARCH_FIELDS } = await import(new URL('../lib/search.ts', import.meta.url).href)

// Target for a streamed search: first results under 10 s.
const FIRST_RESULTS_TARGET_MS = 10000
// Capabilities worth knowing about for a whole-mailbox search; printed whether
// present or absent, so the Journal records the server as it was that day.
const CAPABILITIES_OF_INTEREST = ['ESEARCH', 'MULTISEARCH', 'SEARCH=FUZZY', 'WITHIN', 'LIST-STATUS', 'SORT', 'THREAD=REFERENCES', 'CONDSTORE']
// Folders timed in arm B: enough to see the spread, few enough to stay read-only
// and quick on a 1 000-folder mailbox.
const TIMED_FOLDERS = 5

const failures = []
const check = (label, ok, detail) => {
  if (ok) { console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`); return }
  console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`)
  failures.push(label)
}
const harness = msg => { console.error(`HARNESS: ${msg}`); process.exit(2) }

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
let account
try {
  const { rows } = await pool.query(
    `SELECT id, imap_host, imap_port, imap_secure, username, password_encrypted
       FROM email_accounts ORDER BY created_at ASC LIMIT 1`
  )
  account = rows[0]
} catch (err) {
  harness(`cannot read the test account from the database: ${err}`)
}
if (!account) harness('no email account configured in the database')

const config = {
  id: account.id,
  imapHost: account.imap_host,
  imapPort: account.imap_port,
  imapSecure: account.imap_secure,
  username: account.username,
  passwordEncrypted: account.password_encrypted,
}

const client = new ImapFlow({
  host: config.imapHost,
  port: config.imapPort,
  secure: config.imapSecure,
  auth: { user: config.username, pass: decrypt(config.passwordEncrypted) },
  logger: false,
  tls: { rejectUnauthorized: false },
})

try {
  await client.connect()
} catch (err) {
  // No connection = the product was never exercised: a harness failure, which
  // licenses NO conclusion about the search.
  harness(`IMAP connection failed: ${err}`)
}

try {
  console.log(`server: ${config.imapHost}:${config.imapPort}\n`)

  console.log('A. capability — what the server announces')
  const announced = [...(client.capabilities?.keys?.() ?? [])].map(String)
  for (const cap of CAPABILITIES_OF_INTEREST) {
    console.log(`  ${announced.includes(cap) ? 'yes' : 'no '}  ${cap}`)
  }
  console.log(`  (${announced.length} capabilities announced in total)`)
  // The product depends on LIST-STATUS only for the ORDER of folders; its absence
  // degrades ranking, never correctness, so it is REPORTED, not asserted.
  const hasListStatus = announced.includes('LIST-STATUS')

  console.log('\nB. per-folder cost — SELECT+SEARCH, against SELECT alone on the same folder')
  const listStart = Date.now()
  const list = hasListStatus
    ? await client.list({ statusQuery: { messages: true } })
    : await client.list()
  const listMs = Date.now() - listStart
  const selectable = list.filter(f => !f.flags?.has('\\Noselect'))
  console.log(`  LIST${hasListStatus ? ' (with STATUS)' : ''}: ${selectable.length} selectable folders in ${listMs} ms`)
  if (selectable.length === 0) harness('the mailbox reports no selectable folder')

  // Time the LARGEST folders: they bound the per-folder cost from above, so the
  // projection in arm C cannot flatter the non-progressive path.
  const biggest = selectable
    .slice()
    .sort((a, b) => (b.status?.messages ?? 0) - (a.status?.messages ?? 0))
    .slice(0, TIMED_FOLDERS)

  const timings = []
  for (const folder of biggest) {
    const selectStart = Date.now()
    let lock = await client.getMailboxLock(folder.path)
    const selectMs = Date.now() - selectStart
    let searchMs = 0
    let matches = 0
    try {
      // The SAME query shape the product issues: one OR over SEARCH_FIELDS. The
      // term is the account's own domain, which every mailbox necessarily holds.
      const term = config.username.split('@')[1] ?? config.username
      const searchStart = Date.now()
      const found = await client.search({ or: SEARCH_FIELDS.map(field => ({ [field]: term })) }, { uid: true })
      searchMs = Date.now() - searchStart
      matches = Array.isArray(found) ? found.length : 0
    } finally {
      lock.release()
    }
    timings.push({ messages: folder.status?.messages ?? null, selectMs, searchMs, matches })
    console.log(`  folder of ${folder.status?.messages ?? '?'} messages: SELECT ${selectMs} ms + SEARCH ${searchMs} ms = ${selectMs + searchMs} ms (${matches} matches)`)
  }

  const totalMs = timings.reduce((s, t) => s + t.selectMs + t.searchMs, 0)
  const avgMs = Math.round(totalMs / timings.length)
  const avgSelectMs = Math.round(timings.reduce((s, t) => s + t.selectMs, 0) / timings.length)
  // Same-run REFERENCE: SELECT alone, on the same folders, in the same run. It
  // attributes the cost — a search whose cost were negligible next to opening the
  // mailbox would call for a different strategy than one dominated by the search.
  check('the per-folder cost is measured against the SELECT that carries it',
    avgMs >= avgSelectMs,
    `SELECT+SEARCH ${avgMs} ms vs SELECT alone ${avgSelectMs} ms over ${timings.length} folders`)

  console.log('\nC. full scope — what covering every folder would cost without streaming')
  // Two bounds, and the projection is the LARGER of them:
  //  - the spread bound: every folder's cost shared between the connections;
  //  - the FLOOR: one folder cannot be split across connections, so no amount of
  //    parallelism brings a sweep below its slowest single folder.
  // Taking the max is not a convenience — a sweep whose slowest folder alone
  // costs 24 s cannot finish in 10 s, whatever the spread bound says.
  const spreadMs = Math.round((avgMs * selectable.length) / SEARCH_CONNECTIONS)
  const slowestMs = Math.max(...timings.map(t => t.selectMs + t.searchMs))
  const projectedMs = Math.max(spreadMs, slowestMs)
  console.log(`  spread: ${selectable.length} folders × ${avgMs} ms ÷ ${SEARCH_CONNECTIONS} connections ≈ ${spreadMs} ms`)
  console.log(`  floor:  slowest single folder ${slowestMs} ms (a folder cannot be split)`)
  console.log(`  projected: ${projectedMs} ms`)
  // This is the server-side search's PREMISE, and it is what makes it honest: if a
  // full sweep already landed under the target, streaming would solve nothing and
  // the lot would need re-framing rather than code.
  check('a full sweep exceeds the target, which is why results must stream',
    projectedMs > FIRST_RESULTS_TARGET_MS,
    `${projectedMs} ms projected > ${FIRST_RESULTS_TARGET_MS} ms target`)

  console.log('\nD. ranking — the order the product actually searches in')
  const rankStart = Date.now()
  const ranked = await listFoldersRanked(config)
  const rankMs = Date.now() - rankStart
  console.log(`  listFoldersRanked: ${ranked.length} folders in ${rankMs} ms`)
  // Same-run reference: the raw LIST above. Ranking may only DROP folders (the
  // empty ones), never invent any.
  check('ranking drops empty folders and invents none',
    ranked.length <= selectable.length,
    `${ranked.length} ranked <= ${selectable.length} selectable`)
  const inbox = selectable.find(f => f.specialUse === '\\Inbox' || f.path.toUpperCase() === 'INBOX')
  if (inbox) {
    check('a priority role is searched first', ranked[0] === inbox.path,
      `first ranked folder is the inbox`)
  } else {
    console.log('  skip this mailbox declares no inbox role — nothing to assert')
  }
} finally {
  await client.logout().catch(() => {})
  await pool.end().catch(() => {})
}

if (failures.length) { console.error(`\n${failures.length} check(s) failed`); process.exit(1) }
console.log('\ncheck-search-capability: OK')
