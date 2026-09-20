#!/usr/bin/env node
/**
 * Measures in the browser what the "Test connection" button actually PUTS ON THE
 * WIRE from the edit screen, and what the password field tells the browser about itself.
 *
 * Also covers the refusal that protects the saved password: it only ever travels to the
 * SAVED host, so pointing the form somewhere else with an empty field must be refused in a
 * sentence rather than silently sending the secret to a server the request chose.
 *
 * Also covers the CREATION wizard, which shares that route: since the route classifies every
 * failure into a cause instead of forwarding the driver's message, a screen that printed the
 * response verbatim would show the bare code `unreachable` to the reader. Section 5 drives
 * the wizard with a failing host and reads the rendered line back.
 *
 * NOT ONE real authentication attempt is made: `/api/accounts/test` is INTERCEPTED and
 * answered from here, so nothing ever reaches the mail host. That is the whole point of
 * the lot — every press of this button used to cost the provider two failed logins.
 * Nothing is written, nothing is deleted: the bench only reads the edit form.
 *
 * Fails (exit 1) on any mismatch. Exits 2 on a HARNESS error — a missing browser, an
 * unreachable server — which says nothing about the product.
 *
 * Needs a running dev server and SYNAPMAIL_TEST_* credentials (see .env).
 *   node scripts/check-account-test-request.mjs
 */
import { existsSync, readFileSync } from 'node:fs'
import puppeteer from 'puppeteer-core'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const VIEWPORT = { width: 1440, height: 900 }
const SETTLE_MS = 400
const TEST_PATH = '/api/accounts/test'
/** A password no mailbox has: it is intercepted, so it never leaves the browser anyway. */
const TYPED = 'bench-typed-password'
/**
 * The cause codes `lib/accountTest.ts` returns. They are keys, not sentences: seeing one of
 * them on screen means a result line was printed verbatim instead of being translated.
 */
const FAILURE_CODES = ['credentials', 'unreachable', 'other', 'password_required']
/** A host name that resolves nowhere, so the wizard's own fields stay realistic. */
const DEAD_HOST = 'imap.invalid.bench.test'

for (const file of ['../.env', '../.env.local']) {
  const path = new URL(file, import.meta.url)
  if (!existsSync(path)) continue
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
  }
}
const {
  SYNAPMAIL_TEST_URL: BASE, SYNAPMAIL_TEST_EMAIL: EMAIL, SYNAPMAIL_TEST_PASSWORD: PASSWORD,
} = process.env
for (const [k, v] of Object.entries({
  SYNAPMAIL_TEST_URL: BASE, SYNAPMAIL_TEST_EMAIL: EMAIL, SYNAPMAIL_TEST_PASSWORD: PASSWORD,
})) {
  if (!v) { console.error(`HARNESS: ${k} is not set`); process.exit(2) }
}

const failures = []
const ok = msg => console.log(`ok   ${msg}`)
const fail = msg => { failures.push(msg); console.log(`FAIL ${msg}`) }
const check = (cond, msg) => (cond ? ok(msg) : fail(msg))
const settle = () => new Promise(r => setTimeout(r, SETTLE_MS))

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] })
  .catch(e => { console.error(`HARNESS: cannot launch Chrome — ${e.message}`); process.exit(2) })

/** Every test payload the page tried to send. None of them reached the server. */
const sent = []
/** What the intercepted route answers next, so the result line can be read back. */
let reply = { tested: 'stored', imap: { ok: true, error: '' }, smtp: { ok: true, error: '' } }

try {
  const page = await browser.newPage()
  await page.setViewport(VIEWPORT)
  await page.setRequestInterception(true)
  page.on('request', req => {
    if (req.method() === 'POST' && new URL(req.url()).pathname === TEST_PATH) {
      sent.push(JSON.parse(req.postData() ?? '{}'))
      // Answered here, never forwarded: no mail host is contacted, so no failed login is
      // recorded anywhere.
      // `reply` is either a plain body (answered 200) or an explicit { status, body }, so a
      // refusal can be replayed with the status the real route returns.
      const { status = 200, body = reply } = 'status' in reply ? reply : {}
      req.respond({
        status, contentType: 'application/json', body: JSON.stringify(body),
      }).catch(() => {})
      return
    }
    req.continue().catch(() => {})
  })

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2' })
  const loggedIn = await page.evaluate(async ({ base, email, password }) => {
    const { csrfToken } = await (await fetch(`${base}/api/auth/csrf`)).json()
    const res = await fetch(`${base}/api/auth/callback/credentials`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ csrfToken, email, password, json: 'true' }),
    })
    return res.ok
  }, { base: BASE, email: EMAIL, password: PASSWORD })
  if (!loggedIn) { console.error('HARNESS: credentials login failed'); process.exit(2) }

  const listed = await page.evaluate(async base => {
    const res = await fetch(`${base}/api/accounts`)
    return { status: res.status, body: await res.text() }
  }, BASE)
  let accounts = []
  try {
    accounts = (JSON.parse(listed.body).data ?? []).filter(a => !a.isShared)
  } catch { /* reported below with the raw status */ }
  if (accounts.length === 0) {
    console.error(`HARNESS: /api/accounts returned ${listed.status} — ${listed.body.slice(0, 200)}`)
  }
  if (accounts.length === 0) { console.error('HARNESS: this database has no owned mailbox'); process.exit(2) }
  const account = accounts[0]

  /** Opens the edit form of the mailbox under test, from a fresh page. */
  const openEdit = async () => {
    await page.goto(`${BASE}/settings/accounts`, { waitUntil: 'networkidle2' })
    await page.waitForSelector(`[data-row-menu="${account.id}"]`, { timeout: 20000 })
    await page.click(`[data-row-menu="${account.id}"]`)
    await page.waitForSelector(`[data-row-menu-surface="${account.id}"] [data-menu-item="edit"]`,
      { visible: true, timeout: 10000 })
    await page.click(`[data-row-menu-surface="${account.id}"] [data-menu-item="edit"]`)
    await page.waitForSelector('input[type="password"]', { visible: true, timeout: 10000 })
    await settle()
  }

  const clickTest = async () => {
    const before = sent.length
    const clicked = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button'))
        .find(b => b.type === 'button' && /tester|test/i.test(b.textContent ?? ''))
      if (!btn) return false
      btn.click()
      return true
    })
    if (!clicked) return null
    for (let i = 0; i < 60 && sent.length === before; i++) {
      await new Promise(r => setTimeout(r, 50))
    }
    await settle()
    return sent.length > before ? sent.at(-1) : null
  }

  // ── 1. The password field tells the browser not to fill it ────────────────
  await openEdit()
  const field = await page.$eval('input[type="password"]', el => ({
    autoComplete: el.getAttribute('autocomplete'),
    value: el.value,
    placeholder: el.getAttribute('placeholder'),
  }))
  check(field.autoComplete === 'new-password',
    `the password field carries autocomplete="new-password" — got ${JSON.stringify(field.autoComplete)}`)
  check(field.value === '',
    `the password field opens EMPTY: the saved password never reaches the browser — got ${JSON.stringify(field.value)}`)
  check(Boolean(field.placeholder),
    `the empty field says it means "unchanged" — placeholder=${JSON.stringify(field.placeholder)}`)

  const help = await page.evaluate(() => {
    const el = document.querySelector('input[type="password"]')
    const hint = el?.closest('div')?.parentElement?.querySelector('p')
    return hint?.textContent ?? ''
  })
  check(help.length > 0, `the field carries a help line about leaving it empty — "${help}"`)

  // ── 2. Field left empty: the request names the mailbox and carries NO password
  reply = { tested: 'stored', imap: { ok: true, error: '' }, smtp: { ok: true, error: '' } }
  const empty = await clickTest()
  if (empty === null) {
    fail('the test button sent nothing at all with the field empty')
  } else {
    check(empty.accountId === account.id,
      `field empty: the request names the mailbox — accountId=${JSON.stringify(empty.accountId)}`)
    check(!('password' in empty),
      `field empty: the request carries NO password key at all — keys=${JSON.stringify(Object.keys(empty))}`)
    check(empty.username === account.username,
      `field empty: the request carries the mailbox username — ${JSON.stringify(empty.username)}`)
    check(empty.imapHost === account.imapHost && empty.smtpHost === account.smtpHost,
      'field empty: the hosts tested are the ones in the FORM, so a port can be fixed before saving')
  }

  // The result line says WHICH password was tried — a green test on the saved password
  // proves nothing for someone who just typed a new one.
  const storedLine = await page.evaluate(() => document.body.innerText)
  check(/enregistr|saved|已保存/i.test(storedLine),
    'the result says the SAVED password was the one tried')

  // ── 3. Field filled: that password, and only that one, is what goes ───────
  await openEdit()
  await page.type('input[type="password"]', TYPED)
  reply = { tested: 'submitted', imap: { ok: true, error: '' }, smtp: { ok: true, error: '' } }
  const filled = await clickTest()
  if (filled === null) {
    fail('the test button sent nothing at all with the field filled')
  } else {
    check(filled.password === TYPED,
      'field filled: the request carries the TYPED password, so a change can be checked before saving')
    check(filled.accountId === account.id,
      `field filled: the request still names the mailbox — accountId=${JSON.stringify(filled.accountId)}`)
  }
  const submittedLine = await page.evaluate(() => document.body.innerText)
  check(/saisi|typed|输入/i.test(submittedLine),
    'the result says the NEWLY TYPED password was the one tried')

  // ── 4. A refusal reads as a cause, not as the raw server line ─────────────
  await openEdit()
  reply = {
    tested: 'stored',
    imap: { ok: false, error: 'credentials' },
    smtp: { ok: false, error: 'credentials' },
  }
  await clickTest()
  const refused = await page.evaluate(() => document.body.innerText)
  check(/identifiants|credentials|凭据/i.test(refused),
    'a refusal reads as "the server refused these credentials"')
  check(!/\b535\b/.test(refused) && !/AUTHENTICATIONFAILED/i.test(refused),
    'the raw server line is not shown as-is')
  check(!FAILURE_CODES.some(code => new RegExp(`(^|[^-\\w])${code}([^-\\w]|$)`).test(refused)),
    'edit screen: no raw cause CODE is shown, only the translated sentence')

  // ── 5. The CREATION wizard shares the route, so it must read the same way ──
  await page.goto(`${BASE}/settings/accounts`, { waitUntil: 'networkidle2' })
  const opened = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button'))
      .find(b => /ajouter|add|\u6dfb\u52a0/i.test(b.textContent ?? ''))
    if (!btn) return false
    btn.click()
    return true
  })
  if (!opened) {
    fail('HARNESS-ish: the "add account" button was not found on the accounts screen')
  } else {
    await settle()
    // "Autre serveur" goes straight to the manual IMAP/SMTP step, the only one that lets the
    // bench name a host of its own instead of a provider's.
    const picked = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button'))
        .find(b => /autre serveur|other server|\u5176\u4ed6/i.test(b.textContent ?? ''))
      if (!btn) return false
      btn.click()
      return true
    })
    check(picked, 'the wizard offers a manual IMAP/SMTP entry')
    await page.waitForSelector('input[type="password"]', { visible: true, timeout: 10000 })
    await settle()

    // The manual step has no ids: fill by role, in DOM order, leaving the prefilled ports.
    await page.$eval('input[type="email"]', el => { el.value = '' })
    await page.type('input[type="email"]', 'bench@invalid.bench.test')
    // The host fields carry no type attribute, so they are found by placeholder instead.
    for (const handle of await page.$$('input')) {
      const ph = await handle.evaluate(el => el.getAttribute('placeholder') ?? '')
      if (/imap\./i.test(ph)) await handle.type(DEAD_HOST)
      else if (/smtp\./i.test(ph)) await handle.type(DEAD_HOST.replace('imap.', 'smtp.'))
    }
    await page.type('input[type="password"]', TYPED)

    reply = {
      tested: 'submitted',
      imap: { ok: false, error: 'unreachable' },
      smtp: { ok: false, error: 'unreachable' },
    }
    const created = await clickTest()
    if (created === null) {
      fail('creation wizard: the test button sent nothing at all')
    } else {
      check(!created.accountId,
        `creation wizard: the request names NO mailbox — accountId=${JSON.stringify(created.accountId)}`)
      check(created.password === TYPED,
        'creation wizard: the request carries the typed password, unchanged behaviour')
      check(created.imapHost === DEAD_HOST,
        `creation wizard: the request carries the host from the FORM — ${JSON.stringify(created.imapHost)}`)
    }
    const wizardLine = await page.evaluate(() => document.body.innerText)
    check(/injoignable|could not be reached|\u65e0\u6cd5\u8fde\u63a5/i.test(wizardLine),
      'creation wizard: a dead host reads as a translated sentence about reaching the server')
    check(!FAILURE_CODES.some(code => new RegExp(`(^|[^-\\w])${code}([^-\\w]|$)`).test(wizardLine)),
      'creation wizard: no raw cause CODE is shown to the reader')
  }
  // ── 6. Aiming the form elsewhere with an empty field is refused, in words ──
  // The saved password is only ever sent to the SAVED host: otherwise anyone holding a
  // session could point this button at their own server and read it in the LOGIN command.
  // The server decides that (measured alone by scripts/check-account-test.mjs); here we
  // measure that its refusal reaches the reader as a sentence, not as a bare code.
  await openEdit()
  const retargeted = await page.evaluate(savedHost => {
    const el = Array.from(document.querySelectorAll('input')).find(i => i.value === savedHost)
    if (!el) return false
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(el, 'imap.elsewhere.bench.test')
    el.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  }, account.imapHost)
  check(retargeted, 'the edit form exposes the saved IMAP host, so it can be pointed elsewhere')
  reply = { status: 400, body: { error: 'password_required' } }
  const retargetedSend = await clickTest()
  check(retargetedSend !== null, 'host changed, field empty: the button still sends its request')
  const refusedLine = await page.evaluate(() => document.body.innerText)
  check(/saisissez le mot de passe|type the password|请输入密码/i.test(refusedLine),
    'host changed, field empty: the screen asks for the password in a full sentence')
  check(!FAILURE_CODES.some(code => new RegExp(`(^|[^-\\w])${code}([^-\\w]|$)`).test(refusedLine)),
    'host changed, field empty: no raw cause CODE is shown to the reader')
  check(!/✓|✗/.test(refusedLine),
    'host changed, field empty: no connection result is shown — nothing was tried')

} catch (e) {
  console.error(`HARNESS: ${e.stack}`)
  await browser.close().catch(() => {})
  process.exit(2)
}

await browser.close().catch(() => {})
console.log(`intercepted test requests (none reached a mail host): ${sent.length}`)
console.log(failures.length ? `check-account-test-request: ${failures.length} FAIL` : 'check-account-test-request: OK')
process.exit(failures.length ? 1 : 0)
