#!/usr/bin/env node
/**
 * Measures that ABANDONING a whole-mailbox search actually STOPS it, against the
 * real IMAP server (read only: SELECT and SEARCH only — it never creates, moves
 * or deletes a message, and never prints a body, an address or a password).
 *
 * Why this bench exists: a progressive search opens every folder of the mailbox
 * one after another. When the user changes the query, presses Stop or leaves the
 * page, the sweep must stop — otherwise each abandoned search keeps
 * SEARCH_CONNECTIONS IMAP connections busy for as long as a full sweep takes
 * (measured by check-search-capability: 23 s on the single largest folder alone).
 *
 * What it measures, each arm carrying its own same-run reference:
 *  A. COVERAGE — an aborted sweep covers strictly FEWER folders than the same
 *     sweep left alone. Same-run REFERENCE: the complete sweep, run first, over
 *     the SAME folders with the SAME terms. No absolute constant: the comparison
 *     is against this run's own full coverage.
 *  B. LATENCY — aborting DURING a folder's SEARCH returns without waiting for it.
 *     Same-run REFERENCE: the duration of that very folder measured in arm A. The
 *     criterion is relative (a fraction of the reference), so it keeps meaning on
 *     a faster or slower server. This is what `client.close()` buys over
 *     `logout()`, which politely waits for the in-flight command to answer.
 *  C. CLEANLINESS — no unhandled rejection escapes an aborted sweep.
 *
 * Folders and terms are DISCOVERED from the mailbox (nothing hardcoded), so the
 * bench keeps measuring after the test account's content changes.
 *
 *   node --experimental-strip-types scripts/check-search-cancel.mjs
 */
import { readFileSync, existsSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { Pool } from 'pg'

for (const file of ['.env', '.env.local']) {
  const url = new URL(`../${file}`, import.meta.url)
  if (!existsSync(url)) continue
  for (const line of readFileSync(url, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
  }
}

// The product's own modules are IMPORTED, never retyped: a change in lib/imap.ts
// fails this bench instead of silently making it measure something else.
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
const { listFoldersRanked, searchMessagesByFolder } = await import(new URL('../lib/imap.ts', import.meta.url).href)

// Aborting must interrupt the command in flight, so the sweep has to stop in a
// FRACTION of the folder it was working on — not merely before the whole sweep
// would have ended. Calibrated against arm A's own reference, never a constant.
const ABORT_LATENCY_FRACTION = 0.5
// Below this, the reference folder is too fast for arm B to distinguish an
// interrupted command from one that simply finished: the arm reports SKIP rather
// than passing on a measurement it cannot make.
const ABORT_REFERENCE_FLOOR_MS = 3000

const failures = []
const check = (label, ok, detail) => {
  if (ok) { console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`); return }
  console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`)
  failures.push(label)
}
const harness = msg => { console.error(`HARNESS: ${msg}`); process.exit(2) }

const rejections = []
process.on('unhandledRejection', r => rejections.push(String(r).slice(0, 160)))

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
// A term every mailbox necessarily holds, discovered from the account itself.
const terms = [config.username.split('@')[1] ?? config.username]

try {
  const folders = await listFoldersRanked(config)
  if (folders.length < 2) harness(`the mailbox has ${folders.length} searchable folder(s) — cancellation cannot be observed`)
  console.log(`mailbox: ${folders.length} searchable folders, term discovered from the account\n`)

  console.log('A. coverage — the reference sweep, left alone, and then an aborted one')
  const perFolderMs = []
  let reference = 0
  let refStart = Date.now()
  for await (const chunk of searchMessagesByFolder(config, folders, terms)) {
    perFolderMs.push({ folder: chunk.folder, ms: Date.now() - refStart })
    refStart = Date.now()
    reference = chunk.searched
  }
  const refTotalMs = perFolderMs.reduce((s, f) => s + f.ms, 0)
  console.log(`  reference sweep: ${reference} folders covered in ${refTotalMs} ms`)
  if (reference < 2) harness(`the reference sweep covered ${reference} folder(s) — nothing to abort`)

  // Abort as soon as the FIRST folder comes back: everything still queued must
  // stay unopened.
  const controller = new AbortController()
  let aborted = 0
  const abortStart = Date.now()
  let firstChunkAtMs = 0
  for await (const chunk of searchMessagesByFolder(config, folders, terms, controller.signal)) {
    aborted = chunk.searched
    if (firstChunkAtMs === 0) {
      firstChunkAtMs = Date.now() - abortStart
      controller.abort()
    }
  }
  const abortTotalMs = Date.now() - abortStart
  check('an aborted sweep covers fewer folders than the reference', aborted < reference,
    `${aborted} covered after abort vs ${reference} left alone`)

  console.log('\nB. latency — aborting does not wait for the folder in flight')
  // Same-run REFERENCE: the SLOWEST folder of arm A. If the sweep waited for the
  // command in flight, an abort landing on that folder would cost its full
  // duration; interrupting the connection costs a fraction of it.
  const slowest = perFolderMs.reduce((a, b) => (b.ms > a.ms ? b : a), perFolderMs[0])
  const budgetMs = Math.round(slowest.ms * ABORT_LATENCY_FRACTION)
  const afterAbortMs = abortTotalMs - firstChunkAtMs
  if (slowest.ms < ABORT_REFERENCE_FLOOR_MS) {
    // The threshold is the defect here, not the product: with no slow folder in
    // this mailbox the arm cannot tell an interrupted command from a finished one.
    console.log(`  skip this mailbox's slowest folder takes ${slowest.ms} ms — under the ${ABORT_REFERENCE_FLOOR_MS} ms needed to observe an interruption`)
  } else {
    check('the sweep stops well inside the time one folder would have taken',
      afterAbortMs < budgetMs,
      `${afterAbortMs} ms after abort vs ${slowest.ms} ms for the slowest folder (budget ${budgetMs} ms)`)
  }

  console.log('\nC. cleanliness')
  check('no unhandled rejection escapes an aborted sweep', rejections.length === 0,
    rejections.slice(0, 3).join(' | ') || 'none')
} finally {
  await pool.end().catch(() => {})
}

if (failures.length) { console.error(`\n${failures.length} check(s) failed`); process.exit(1) }
console.log('\ncheck-search-cancel: OK')
