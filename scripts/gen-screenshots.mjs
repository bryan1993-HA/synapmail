#!/usr/bin/env node
/**
 * Generates the four README screenshots against a running dev server.
 *
 * Every screen is REAL: the app's own components render, with its own styles,
 * from its own routes. Only the DATA is fictitious — every mailbox API call is
 * intercepted and answered with the demo payloads below, so no real address,
 * name or host can reach an image. Interception also makes the run READ ONLY:
 * any non-GET call to /api is answered without reaching the server.
 *
 * The previous version injected raw HTML over the empty state, which captured
 * the script's own markup rather than the product, and clicked a "New message"
 * row that no longer exists in the sidebar (it moved into the header), so
 * compose never opened and its capture silently reused the inbox. Both are why
 * this one drives the real UI and asserts that each screen actually changed.
 *
 *   SYNAPMAIL_TEST_URL=http://localhost:3101 node scripts/gen-screenshots.mjs
 *
 * Output: docs/screenshots/{inbox,compose,settings,mobile}.png
 *
 * RE-RUN whenever the UI changes visually: a stale screenshot is the first
 * thing a visitor sees.
 */
import { mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import puppeteer from 'puppeteer-core'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const OUT_DIR = new URL('../docs/screenshots/', import.meta.url)
const VIEWPORT = { width: 1440, height: 900 }
const MOBILE_VIEWPORT = { width: 390, height: 844, hasTouch: true, isMobile: true }
/** A route change plus the entrance animations. */
const SETTLE_MS = 900
/** Opening compose mounts a Tiptap editor: heavier than a re-render. */
const COMPOSE_SETTLE_MS = 1600

for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
}
const { SYNAPMAIL_TEST_URL: BASE, SYNAPMAIL_TEST_EMAIL: EMAIL, SYNAPMAIL_TEST_PASSWORD: PASSWORD } = process.env
/**
 * The README is written in English, so its images must be too. The language is
 * resolved server-side from this cookie (`lib/locales.ts`), so it has to be set
 * before the first navigation — a client-side toggle would only repaint half
 * the screen.
 */
const SHOT_LOCALE = 'en'
// Read from the app's own source rather than repeated here: if the cookie is
// ever renamed, this run must follow it instead of silently shooting in French.
const LOCALE_COOKIE = readFileSync(new URL('../lib/locales.ts', import.meta.url), 'utf8')
  .match(/LOCALE_COOKIE = '([^']+)'/)?.[1]
if (!LOCALE_COOKIE) { console.error('HARNESS: LOCALE_COOKIE not found in lib/locales.ts'); process.exit(2) }
for (const [k, v] of Object.entries({ SYNAPMAIL_TEST_URL: BASE, SYNAPMAIL_TEST_EMAIL: EMAIL, SYNAPMAIL_TEST_PASSWORD: PASSWORD })) {
  if (!v) { console.error(`HARNESS: ${k} is not set`); process.exit(2) }
}

// ── Fictitious data ─────────────────────────────────────────────────────────
// Addresses use the RFC 2606 reserved names, which can never belong to anyone.

const ACCOUNTS = [
  { id: 'demo-1', name: 'Demo', email: 'demo@example.com', badgeColor: '#6366f1', unreadCount: 3, isDefault: true },
  { id: 'demo-2', name: 'Team', email: 'team@example.org', badgeColor: '#10b981', unreadCount: 1, isDefault: false },
].map(a => ({
  ...a,
  userId: 'demo-user',
  imapHost: 'imap.example.com', imapPort: 993, imapSecure: true,
  smtpHost: 'smtp.example.com', smtpPort: 465, smtpSecure: true,
  username: a.email, color: a.badgeColor, promptGuard: true,
  createdAt: '2026-01-05T09:00:00.000Z', oauthProvider: null,
  isShared: false, shareId: null, ownerName: null, expiresAt: null,
  permissions: { canSend: true, canDelete: true, canOrganize: true, canManageRules: true, canManageSignatures: true },
}))

const FOLDERS = [
  { name: 'Inbox', path: 'INBOX', specialUse: '\\Inbox', unread: 3, total: 128 },
  { name: 'Sent', path: 'Sent', specialUse: '\\Sent', unread: 0, total: 96 },
  { name: 'Drafts', path: 'Drafts', specialUse: '\\Drafts', unread: 0, total: 2 },
  { name: 'Archive', path: 'Archive', specialUse: '\\Archive', unread: 0, total: 431 },
  { name: 'Trash', path: 'Trash', specialUse: '\\Trash', unread: 0, total: 7 },
  { name: 'Invoices', path: 'Invoices', specialUse: null, unread: 1, total: 52 },
  { name: 'Newsletters', path: 'Newsletters', specialUse: null, unread: 0, total: 210 },
  { name: 'Travel', path: 'Travel', specialUse: null, unread: 0, total: 23 },
].map(f => ({ ...f, delimiter: '/', flags: [] }))

const MESSAGES = [
  { from: ['Alice Martin', 'alice.martin@example.com'], subject: 'Re: Project kickoff — Q3 planning', preview: 'Sounds great. Thursday morning works on my side, I will send an invite with the agenda attached.', day: 0, hour: 10, min: 42, unread: true, starred: false, flag: 'blue', attach: true },
  { from: ['Build service', 'builds@example.net'], subject: 'Pull request ready for review: dark mode contrast', preview: 'Three files changed, all checks passed. The reading pane now keeps a 4.8:1 contrast in dark mode.', day: 0, hour: 9, min: 17, unread: true, starred: false, flag: null, attach: false },
  { from: ['Billing', 'billing@example.org'], subject: 'Your receipt — September', preview: 'A payment of 29.00 EUR was processed on 1 September. The invoice is attached as a PDF.', day: 0, hour: 8, min: 4, unread: true, starred: true, flag: 'orange', attach: true },
  { from: ['Thomas Berger', 'thomas.berger@example.com'], subject: 'Quick question about the API', preview: 'I was reading the REST reference and I am not sure which header carries the key. A bearer token?', day: 1, hour: 17, min: 25, unread: false, starred: false, flag: null, attach: false },
  { from: ['Sara Nilsson', 'sara.nilsson@example.org'], subject: 'Welcome to the team', preview: 'Very glad to be joining on Monday. Is there anything you would like me to read beforehand?', day: 1, hour: 14, min: 3, unread: false, starred: false, flag: 'green', attach: false },
  { from: ['Conference desk', 'tickets@example.net'], subject: 'Fwd: Ticket confirmation, 14-16 October', preview: 'Forwarding the confirmation. Both passes are registered, the badges can be collected on site.', day: 2, hour: 11, min: 48, unread: false, starred: false, flag: null, attach: true },
  { from: ['Workspace', 'notify@example.net'], subject: 'A comment was left on "Product roadmap"', preview: 'The mobile release should move to Q4: the sync API will not be ready before the end of October.', day: 3, hour: 16, min: 12, unread: false, starred: false, flag: null, attach: false },
  { from: ['Issue tracker', 'tracker@example.net'], subject: 'Reading pane flickers on small screens', preview: 'Status changed to In progress. The flicker only shows below 420 px, on the first paint.', day: 4, hour: 10, min: 30, unread: false, starred: false, flag: 'purple', attach: false },
  { from: ['Marie Lefevre', 'marie.lefevre@example.com'], subject: 'Contract — signed copy', preview: 'Here is the countersigned version. Nothing changed apart from the start date on page two.', day: 5, hour: 15, min: 55, unread: false, starred: true, flag: null, attach: true },
  { from: ['Hosting', 'status@example.net'], subject: 'Scheduled maintenance on Sunday', preview: 'The storage nodes will be upgraded between 02:00 and 04:00 UTC. No action is required.', day: 6, hour: 9, min: 0, unread: false, starred: false, flag: null, attach: false },
]

/**
 * Dates come from a FIXED instant, never from the clock: two runs a week apart
 * must produce the same image, otherwise every regeneration rewrites all four
 * files and the diff stops saying anything.
 */
const REFERENCE_DATE = Date.UTC(2026, 8, 17, 12, 0, 0)
const DAY_MS = 24 * 60 * 60 * 1000

const accountOf = url => {
  const q = new URL(url).searchParams
  return q.get('accountId') || q.get('account') || ACCOUNTS[0].id
}
const folderOf = url => new URL(url).searchParams.get('folder') || 'INBOX'

const messagesFor = (accountId, folder) => MESSAGES.map((m, i) => {
  const d = new Date(REFERENCE_DATE - m.day * DAY_MS)
  d.setUTCHours(m.hour, m.min, 0, 0)
  return {
    uid: String(1000 - i),
    messageId: `<demo-${i}@example.com>`,
    from: { name: m.from[0], address: m.from[1] },
    to: [{ name: 'Demo', address: 'demo@example.com' }],
    subject: m.subject,
    date: d.toISOString(),
    preview: m.preview,
    isRead: !m.unread,
    isStarred: m.starred,
    isFlagged: false,
    flag: m.flag,
    hasAttachments: m.attach,
    folder,
    accountId,
  }
})

/**
 * The signed-in user's own preferences, stubbed like the mailbox: the capture
 * must not depend on how this machine's test account happens to be configured.
 * `sidebar_collapsed: false` shows the bar with its labels and folder tree, and
 * `reading_pane: false` opens the narrow layout on the message LIST — both are
 * what the README is supposed to show.
 */
const SETTINGS = {
  theme: 'system', language: SHOT_LOCALE, messages_per_page: 30, thread_view: true,
  reading_pane: false, notifications: false, undo_send_delay: 10, start_view: 'inbox',
  active_account_id: null, sidebar_collapsed: false, mail_density: 'comfortable',
  list_width: 320, dashboard_account_id: null, update_dismissed_version: null,
}

/** Every mailbox route these screens call, answered from the data above. */
const ROUTES = [
  [/\/api\/settings(\?|$)/, () => ({ data: SETTINGS })],
  // The signed-in identity is the TEST account's, so it is stubbed too: the user
  // menu renders it, and a real address must never reach an image.
  [/\/api\/profile(\?|$)/, () => ({ data: { name: 'Demo', email: ACCOUNTS[0].email } })],
  [/\/api\/accounts(\?|$)/, () => ({ data: ACCOUNTS })],
  [/\/api\/folders(\?|$)/, url => ({ data: FOLDERS.map(f => ({ ...f, accountId: accountOf(url) })) })],
  [/\/api\/messages\/thread(\?|$)/, url => ({ messages: messagesFor(accountOf(url), folderOf(url)).slice(0, 1), total: 1 })],
  [/\/api\/messages\/search(\?|$)/, () => ({ messages: [], total: 0, fields: [] })],
  [/\/api\/messages(\?|$)/, url => {
    const list = messagesFor(accountOf(url), folderOf(url))
    return { messages: list, total: list.length }
  }],
  [/\/api\/track\/status(\?|$)/, () => ({ data: {} })],
  [/\/api\/contacts(\?|$)/, () => ({ data: [] })],
  [/\/api\/signatures(\?|$)/, () => ({ data: [] })],
  [/\/api\/templates(\?|$)/, () => ({ data: [] })],
  [/\/api\/drafts(\?|$)/, () => ({ data: null })],
  [/\/api\/scheduled(\?|$)/, () => ({ data: [] })],
  [/\/api\/snoozed(\?|$)/, () => ({ data: [] })],
  [/\/api\/focus(\?|$)/, () => ({ data: [] })],
  [/\/api\/pgp\/contacts(\?|$)/, () => ({ data: [] })],
  [/\/api\/subscriptions(\?|$)/, () => ({ data: [] })],
]

// ── Capture ─────────────────────────────────────────────────────────────────

mkdirSync(OUT_DIR, { recursive: true })
const failures = []
/**
 * Anything that would identify a real person, mailbox or host. Derived from the
 * environment rather than listed literally, so it forbids whatever this machine
 * is actually configured with instead of a list that goes stale. Checked on the
 * TEXT of every screen before it is written: reviewing four images by eye is
 * exactly the step that let a real address through once already.
 */
const FORBIDDEN = [...new Set([
  EMAIL,
  EMAIL.split('@')[1],
  new URL(BASE).hostname,
  // The registrable part of the host, so a sibling subdomain is caught too.
  new URL(BASE).hostname.split('.').slice(-2).join('.'),
].filter(t => t && t !== 'localhost'))]

/**
 * Words the interface writes ONLY when it renders in French, used to prove the
 * capture came out in the README's language. Taken from the locale file rather
 * than typed here, so they cannot drift from what the app renders — then any
 * candidate that ALSO exists as a hardcoded literal somewhere in the source is
 * dropped: such a string is on screen whatever the language, so it would fail
 * this assertion forever and say nothing about the locale.
 */
const FR_STRINGS = JSON.parse(readFileSync(new URL('../locales/fr.json', import.meta.url), 'utf8')).mail
const MARKER_KEYS = ['compose', 'searchMail', 'settings', 'inbox']
const SOURCE_TEXT = ['components', 'app', 'lib']
  .flatMap(dir => sourceFiles(new URL(`../${dir}/`, import.meta.url)))
  .map(f => readFileSync(f, 'utf8'))
  .join('\n')
const OFF_LOCALE_MARKERS = MARKER_KEYS.map(k => FR_STRINGS[k]).filter(v => v && !SOURCE_TEXT.includes(v))
if (!OFF_LOCALE_MARKERS.length) { console.error('HARNESS: no usable French marker left — the language assertion would be blind'); process.exit(2) }
console.log(`language markers  ${OFF_LOCALE_MARKERS.length}/${MARKER_KEYS.length} (the rest are hardcoded in the source, so they carry no locale signal)`)

/** Every `.ts`/`.tsx` under a directory — the text the app can render regardless of locale. */
function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const child = new URL(`${e.name}${e.isDirectory() ? '/' : ''}`, dir)
    if (e.isDirectory()) return sourceFiles(child)
    return /\.tsx?$/.test(e.name) ? [child.pathname] : []
  })
}

const shot = async (page, name) => {
  const text = await page.evaluate(() => document.body.innerText)
  for (const marker of OFF_LOCALE_MARKERS) {
    if (text.includes(marker)) failures.push(`${name}: the screen reads ${JSON.stringify(marker)} — it rendered in French, but the README is in English`)
  }
  for (const term of FORBIDDEN) {
    if (term && text.toLowerCase().includes(term.toLowerCase())) {
      failures.push(`${name}: the screen shows ${JSON.stringify(term)} — a real identity would be published in the README`)
    }
  }
  await page.screenshot({ path: new URL(`${name}.png`, OUT_DIR).pathname })
  console.log(`  wrote ${name}.png`)
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] })
try {
  const page = await browser.newPage()
  page.setDefaultNavigationTimeout(120000)
  await page.setViewport(VIEWPORT)

  // The session is real — the app must render as a signed-in user sees it —
  // but every mailbox read after this point is answered from the demo data.
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2' })
  await page.setCookie({ name: LOCALE_COOKIE, value: SHOT_LOCALE, url: BASE, path: '/' })
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

  await page.setRequestInterception(true)
  page.on('request', req => {
    const url = req.url()
    const json = body => req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
    if (!url.includes('/api/')) return req.continue()
    // Auth stays real: faking it signs the session out mid-run.
    if (url.includes('/api/auth/')) return req.continue()
    // Read only: a write never reaches the server, and never changes a screen.
    if (req.method() !== 'GET') return json({ data: null })
    for (const [re, build] of ROUTES) if (re.test(url)) return json(build(url))
    return req.continue()
  })

  console.log('capturing…')

  // 1. Inbox — the three-column shell with the demo mailbox loaded.
  await page.goto(`${BASE}/mail`, { waitUntil: 'networkidle2' })
  await new Promise(r => setTimeout(r, SETTLE_MS))
  const rows = await page.$$eval('[data-mail-row]', els => els.length)
  if (rows < MESSAGES.length) failures.push(`inbox: ${rows} message row(s) rendered, expected ${MESSAGES.length} — the demo data did not reach the list`)
  const folderRows = await page.$$eval('[data-sidebar-row^="folder:"]', els => els.length)
  if (folderRows < FOLDERS.length) failures.push(`inbox: the sidebar rendered ${folderRows} folder row(s), expected ${FOLDERS.length} — the demo folder tree did not reach the bar`)
  // A folded bar shows initials-only tiles and says nothing about the product.
  // Read from the bar's own state attribute, not from its width, so it stays
  // true whatever the geometry becomes.
  const barCollapsed = await page.$eval('[data-sidebar]', el => el.dataset.collapsed)
  if (barCollapsed !== 'false') failures.push(`inbox: the sidebar is collapsed (data-collapsed=${barCollapsed}) — the capture would show tiles instead of the folder tree`)
  console.log(`  inbox: ${rows} message rows, ${folderRows} folder rows, sidebar collapsed=${barCollapsed}`)
  await shot(page, 'inbox')

  // 2. Compose — opened from the header button, which is where this fork put it.
  const composeBtn = await page.$('[data-omnibar-action="compose"]')
  if (!composeBtn) { console.error('HARNESS: no [data-omnibar-action="compose"] in the header'); process.exit(2) }
  await composeBtn.click()
  await new Promise(r => setTimeout(r, COMPOSE_SETTLE_MS))
  const composeOpen = await page.$('.ProseMirror, [contenteditable="true"]')
  if (!composeOpen) failures.push('compose: no editor on screen after clicking the header button — the capture would repeat the inbox')
  await shot(page, 'compose')
  await page.keyboard.press('Escape')
  await new Promise(r => setTimeout(r, SETTLE_MS))

  // 3. Settings — the Accounts screen, populated with the two demo mailboxes.
  await page.goto(`${BASE}/settings/accounts`, { waitUntil: 'networkidle2' })
  await new Promise(r => setTimeout(r, SETTLE_MS))
  const shown = await page.evaluate(() => document.body.innerText)
  for (const acc of ACCOUNTS) {
    if (!shown.includes(acc.email)) failures.push(`settings: ${acc.email} is not on the accounts screen — it would read as "no account configured"`)
  }
  await shot(page, 'settings')

  // 4. Mobile — the message LIST, which is what the narrow layout opens on.
  await page.setViewport(MOBILE_VIEWPORT)
  await page.goto(`${BASE}/mail`, { waitUntil: 'networkidle2' })
  await new Promise(r => setTimeout(r, SETTLE_MS))
  const mobileRows = await page.$$eval('[data-mail-row]', els => els.length)
  if (mobileRows === 0) failures.push('mobile: no message row on screen — the capture shows an empty reading pane, not the list')
  // Rows can exist in a hidden column: at 390 px the list and the reading pane
  // swap, so the rows have to be ON SCREEN, not merely mounted.
  const firstRowVisible = await page.evaluate(() => {
    const el = document.querySelector('[data-mail-row]')
    if (!el) return false
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0 && r.top < window.innerHeight
  })
  if (!firstRowVisible) failures.push('mobile: the message rows are mounted but off screen — the reading pane is on top, which is not what this image is for')
  console.log(`  mobile: ${mobileRows} message rows, first row on screen=${firstRowVisible}`)
  await shot(page, 'mobile')
} finally {
  await browser.close()
}

// ── The capture is only useful if the four images actually differ ───────────
// Two identical files mean a screen never opened and its capture silently
// repeated the previous one. That is the exact defect this file exists for, so
// it is asserted here rather than left to the eye.
const seen = new Map()
for (const f of readdirSync(OUT_DIR).filter(n => n.endsWith('.png')).sort()) {
  const p = new URL(f, OUT_DIR).pathname
  const sum = createHash('md5').update(readFileSync(p)).digest('hex')
  console.log(`  ${f.padEnd(14)} ${(statSync(p).size / 1024).toFixed(0).padStart(5)} KB  ${sum}`)
  if (seen.has(sum)) failures.push(`${f} is byte-identical to ${seen.get(sum)} — one of the two screens never rendered`)
  seen.set(sum, f)
}

if (failures.length) {
  console.error(`\ngen-screenshots: FAIL — ${failures.length} problem(s)`)
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(1)
}
console.log('\ngen-screenshots: OK — 4 distinct screens, fictitious data only. Review each image before committing.')
