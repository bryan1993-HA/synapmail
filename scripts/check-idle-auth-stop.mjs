#!/usr/bin/env node
/**
 * PR-29 follow-up: `watchMailbox()` (lib/idle.ts) retried EVERY failed connection with a
 * capped backoff and no ceiling. A changed/expired password therefore made every open tab
 * retry the IMAP login once a minute, forever — the pattern that already got the reverse
 * proxy's IP banned by fail2ban on this infrastructure. A rejected login never fixes
 * itself, so the watcher must give up on it; a transport failure may, so it must keep
 * retrying.
 *
 * Pure bench, no real mailbox: a fake IMAP server on loopback that answers the greeting,
 * CAPABILITY, and then either
 *   A. rejects LOGIN with `NO [AUTHENTICATIONFAILED]` — the REAL watcher must send exactly
 *      ONE login over a window longer than its first retry delay (read from the source);
 *   B. drops the socket right after the greeting — the watcher must come back at least
 *      once in the same window (the backoff still exists for what can heal).
 * `close()` after the give-up stays idempotent and no unhandled rejection escapes.
 *
 *   node --experimental-strip-types scripts/check-idle-auth-stop.mjs
 *   node --experimental-strip-types scripts/check-idle-auth-stop.mjs --negative
 *
 * NEGATIVE CONTROL (`--negative`): the watcher is loaded from a COPY of lib/idle.ts with
 * the authentication guard removed. Arm A MUST go red (several logins in the window).
 */
import './alias-resolver.mjs'
import { createServer } from 'node:net'
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomBytes } from 'node:crypto'

const NEGATIVE = process.argv.includes('--negative')
const failures = []
const check = (label, ok, detail = '') => {
  if (ok) { console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`); return }
  console.error(`  FAIL ${label}${detail ? `\n       ${detail}` : ''}`)
  failures.push(label)
}
let unhandled = 0
process.on('unhandledRejection', () => { unhandled += 1 })

process.env.ENCRYPTION_KEY ??= randomBytes(32).toString('hex')
process.env.DATABASE_URL ??= 'postgresql://nobody@127.0.0.1:1/none'
const { encrypt } = await import(new URL('../lib/encrypt.ts', import.meta.url).href)

// The window must outlast the FIRST retry delay, read from the shipped module: bumping the
// delay there cannot silently turn "gave up" into "had not retried yet".
const IDLE_URL = new URL('../lib/idle.ts', import.meta.url)
let source = readFileSync(IDLE_URL, 'utf8')
const RETRY_BASE_MS = Number(source.match(/RETRY_BASE_MS = ([\d_]+)/)?.[1].replace(/_/g, ''))
if (!RETRY_BASE_MS) { console.error('HARNESS: cannot read RETRY_BASE_MS from lib/idle.ts'); process.exit(2) }
const WINDOW_MS = RETRY_BASE_MS * 2.5

// The watcher under test: the real module, or a copy of it without the guard.
let tmp = null
let idleHref = IDLE_URL.href
if (NEGATIVE) {
  const guard = /^.*authenticationFailed.*\n/m
  if (!guard.test(source)) { console.error('HARNESS: no authentication guard in lib/idle.ts to remove'); process.exit(2) }
  source = source.replace(guard, '').replace("from './imap'", `from '${new URL('../lib/imap.ts', import.meta.url).href}'`)
  tmp = mkdtempSync(join(tmpdir(), 'idle-negative-'))
  const file = join(tmp, 'idle.ts')
  writeFileSync(file, source)
  idleHref = pathToFileURL(file).href
}
const { watchMailbox } = await import(idleHref)

// ---- fake IMAP server: greeting + CAPABILITY, then the arm's behaviour --------------
const serve = (onLogin) => new Promise(resolve => {
  const stats = { connections: 0, logins: 0 }
  const server = createServer(socket => {
    stats.connections += 1
    socket.on('error', () => {})
    socket.write('* OK fake IMAP ready\r\n')
    if (!onLogin) { socket.destroy(); return }
    let buf = ''
    socket.on('data', chunk => {
      buf += chunk.toString('latin1')
      let nl
      while ((nl = buf.indexOf('\r\n')) !== -1) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 2)
        const [tag, cmd] = line.split(' ')
        const c = (cmd ?? '').toUpperCase()
        if (c === 'CAPABILITY') socket.write(`* CAPABILITY IMAP4rev1\r\n${tag} OK done\r\n`)
        else if (c === 'LOGIN') { stats.logins += 1; socket.write(onLogin(tag)) }
        else if (c === 'LOGOUT') { socket.write(`* BYE\r\n${tag} OK bye\r\n`); socket.end() }
        else socket.write(`${tag} NO not here\r\n`)
      }
    })
  })
  server.listen(0, '127.0.0.1', () => resolve({ server, stats, port: server.address().port }))
})

const account = (port) => ({
  imapHost: '127.0.0.1', imapPort: port, imapSecure: false,
  username: 'bench', passwordEncrypted: encrypt('wrong-password'),
})
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const closeServer = (server) => new Promise(r => server.close(() => r()))

// ---- arm A: the login is rejected ---------------------------------------------------
{
  const { server, stats, port } = await serve(tag => `${tag} NO [AUTHENTICATIONFAILED] Authentication failed\r\n`)
  const watcher = watchMailbox(account(port), 'INBOX', () => {})
  await sleep(WINDOW_MS)
  check(`A. one rejected login is never retried within ${WINDOW_MS}ms`, stats.logins === 1,
    `${stats.logins} LOGIN over ${stats.connections} connection(s), first retry would be at ${RETRY_BASE_MS}ms`)
  watcher.close(); watcher.close()
  await sleep(50)
  await closeServer(server)
}

// ---- arm B: the transport drops — a failure that CAN heal is still retried ----------
{
  const { server, stats, port } = await serve(null)
  const watcher = watchMailbox(account(port), 'INBOX', () => {})
  await sleep(WINDOW_MS)
  check(`B. a dropped connection is retried within ${WINDOW_MS}ms`, stats.connections >= 2,
    `${stats.connections} connection(s)`)
  watcher.close()
  await sleep(50)
  await closeServer(server)
}

check('C. no unhandled rejection escaped', unhandled === 0, `${unhandled} unhandled`)

if (tmp) rmSync(tmp, { recursive: true, force: true })
if (NEGATIVE) {
  if (failures.length) { console.log(`\nnegative control: ${failures.length} assertion(s) fell, as expected`); process.exit(0) }
  console.error('\nSILENT NEGATIVE CONTROL: the guard-less watcher kept the bench green — it measures nothing')
  process.exit(1)
}
if (failures.length) { console.error(`\n${failures.length} failure(s)`); process.exit(1) }
console.log('\nidle auth stop: all checks passed')
