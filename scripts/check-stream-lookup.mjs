#!/usr/bin/env node
/**
 * PR-29 follow-up: in `app/api/stream/route.ts` the optional `?account=` lookup (the IMAP
 * IDLE watch) had no try/catch. A transient DB error there rejected the whole handler: a
 * 500 instead of an SSE stream, so `scheduled_sent` / `rule_applied` never reached the
 * tab either — while the comment above the lookup promised the watch would simply be
 * skipped.
 *
 * Pure bench, no server, no database: the REAL route module is imported with three of its
 * imports replaced (`@/lib/auth` → a fixed session, `@/lib/accountAccess` → a lookup that
 * REJECTS like a dropped Postgres connection, `@/lib/idle` → a recorder), `GET` is called
 * with `?account=…`, and the bench asserts: status 200, `text/event-stream`, the `connected`
 * frame arrives, a `scheduled_sent` emitted on the real `schedulerEvents` is delivered, and
 * no IMAP watch was started.
 *
 *   node --experimental-strip-types scripts/check-stream-lookup.mjs
 *   node --experimental-strip-types scripts/check-stream-lookup.mjs --negative
 *
 * NEGATIVE CONTROL (`--negative`): the route is loaded from a COPY with the `.catch(…)`
 * on the lookup removed. `GET` MUST reject (the 500 the followup describes) and the same
 * assertions MUST fall.
 */
import './alias-resolver.mjs'
import { registerHooks } from 'node:module'
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const NEGATIVE = process.argv.includes('--negative')
const failures = []
const check = (label, ok, detail = '') => {
  if (ok) { console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`); return }
  console.error(`  FAIL ${label}${detail ? `\n       ${detail}` : ''}`)
  failures.push(label)
}

const USER_ID = 'user-under-test'
const ACCOUNT_ID = 'account-under-test'
const watchCalls = []
globalThis.__streamBench = { watchCalls }

// Stubs as data: URLs, registered AFTER the alias resolver so they run FIRST.
const stub = (code) => ({ url: `data:text/javascript,${encodeURIComponent(code)}`, shortCircuit: true })
const STUBS = {
  '@/lib/auth': `export const auth = async () => ({ user: { id: ${JSON.stringify(USER_ID)} } })`,
  '@/lib/accountAccess': `export const getAccessibleAccount = async () => { throw new Error('connection terminated unexpectedly') }`,
  '@/lib/idle': `export const watchMailbox = (...args) => { globalThis.__streamBench.watchCalls.push(args); return { close() {} } }`,
  'next/server': `export const NextResponse = { json: (body, init) => new Response(JSON.stringify(body), init) }`,
}
registerHooks({
  resolve(specifier, context, next) {
    return STUBS[specifier] ? stub(STUBS[specifier]) : next(specifier, context)
  },
})

const ROUTE_URL = new URL('../app/api/stream/route.ts', import.meta.url)
let routeHref = ROUTE_URL.href
let tmp = null
if (NEGATIVE) {
  const source = readFileSync(ROUTE_URL, 'utf8')
  const guard = /\.catch\(\(err: unknown\) => \{[\s\S]*?\n\s*\}\)/
  if (!guard.test(source)) { console.error('HARNESS: no .catch on the lookup in the route to remove'); process.exit(2) }
  tmp = mkdtempSync(join(tmpdir(), 'stream-negative-'))
  const copy = join(tmp, 'route.ts')
  writeFileSync(copy, source.replace(guard, ''))
  routeHref = pathToFileURL(copy).href
}

const { GET } = await import(routeHref)
const { schedulerEvents } = await import(new URL('../lib/schedulerEvents.ts', import.meta.url).href)
const { STREAM_ACCOUNT_PARAM } = await import(new URL('../lib/stream.ts', import.meta.url).href)

const req = new Request(`http://bench.invalid/api/stream?${STREAM_ACCOUNT_PARAM}=${ACCOUNT_ID}`)
let res = null
let handlerError = null
try {
  res = await GET(req)
} catch (err) {
  handlerError = err
}

check('GET resolves despite the lookup rejecting', handlerError === null, handlerError?.message ?? '')
check('status 200', res?.status === 200, `status=${res?.status}`)
check('content-type text/event-stream', res?.headers.get('content-type') === 'text/event-stream', res?.headers.get('content-type') ?? '')

if (res?.body) {
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  const readFrame = async () => {
    const { value, done } = await Promise.race([
      reader.read(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('no frame within 2000ms')), 2000)),
    ])
    if (done) throw new Error('stream closed')
    return JSON.parse(decoder.decode(value).replace(/^data: /, '').trim())
  }
  const first = await readFrame().catch(err => ({ error: err.message }))
  check('first frame is `connected` for this user', first.type === 'connected' && first.userId === USER_ID, JSON.stringify(first))

  schedulerEvents.emit('scheduled_sent', { userId: USER_ID, subject: 'bench', to: 'nobody@bench.invalid' })
  const second = await readFrame().catch(err => ({ error: err.message }))
  check('scheduler event still delivered', second.type === 'scheduled_sent' && second.subject === 'bench', JSON.stringify(second))
  await reader.cancel()
} else {
  check('first frame is `connected` for this user', false, 'no stream body')
  check('scheduler event still delivered', false, 'no stream body')
}
check('no IMAP watch started when the lookup fails', watchCalls.length === 0, `watchMailbox calls=${watchCalls.length}`)

if (tmp) rmSync(tmp, { recursive: true, force: true })
if (NEGATIVE) {
  if (failures.length) { console.log(`\nnegative control: ${failures.length} assertion(s) fell, as expected`); process.exit(0) }
  console.error('\nSILENT NEGATIVE CONTROL: the guard-less route kept the bench green — it measures nothing')
  process.exit(1)
}
if (failures.length) { console.error(`\n${failures.length} failure(s)`); process.exit(1) }
console.log('\nstream lookup: all checks passed')
