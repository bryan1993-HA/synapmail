#!/usr/bin/env node
/**
 * Measures the application header (`components/layout/Omnibar.tsx`) on the running
 * app: it is present on every page, it starts at the sidebar's right edge (the bar
 * owns the full height) in BOTH collapse states, its height is the one the component
 * exports, its three actions sit on the LEFT of a field centred on the header,
 * Cmd/Ctrl+K focuses that field, Escape clears it, and REAL clicks on the three
 * actions reach the dashboard / the compose window / the settings. Also checks the
 * sidebar no longer carries a dashboard row, and that nothing overflows at 390px.
 * Fails (exit 1) on any drift.
 *
 * Needs a running dev server and SYNAPMAIL_TEST_* credentials (see .env).
 *   node scripts/check-omnibar.mjs
 */
import { readFileSync } from 'node:fs'
import puppeteer from 'puppeteer-core'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
// Tolerance for a position/size drift, in CSS pixels — same floor as the sidebar
// check: sub-pixel layout rounding is expected, anything a human could see is not.
const MAX_DRIFT_PX = 1
// The field is not centred, it is BUTTED against the last icon. The expected value
// is read from the component, never transcribed here.
const EXPECTED_FIELD_GAP = Number(readFileSync(new URL('../components/layout/Omnibar.tsx', import.meta.url), 'utf8').match(/searchGap:\s*(\d+)/)?.[1])

// Tooltip geometry and delay, read from the component that exports them.
const TOOLTIP_SRC = readFileSync(new URL('../components/ui/IconTooltip.tsx', import.meta.url), 'utf8')
const EXPECTED_TOOLTIP_OFFSET = Number(TOOLTIP_SRC.match(/TOOLTIP_OFFSET_PX = (\d+)/)?.[1])
const EXPECTED_TOOLTIP_DELAY = Number(TOOLTIP_SRC.match(/TOOLTIP_DELAY_MS = (\d+)/)?.[1])
/** Hover + appearance delay + render margin: the tooltip has had time to show up. */
const TOOLTIP_SETTLE_MS = EXPECTED_TOOLTIP_DELAY + 400
const VIEWPORT = { width: 1440, height: 900 }
// `hasTouch`: this check opens the overflow menu with a REAL tap (`page.tap`), the
// gesture a person makes — a programmatic `click()` would not prove the same thing.
const MOBILE_VIEWPORT = { width: 390, height: 844, hasTouch: true, isMobile: true }
// Pages the header must be present on.
const PAGES = ['/mail', '/dashboard', '/settings']
// The header's height is NOT an absolute constant calibrated elsewhere: it is read
// out of the component's own `OMNIBAR` export in this same run, so the shipped value
// and the measured value cannot drift apart. A hand-retyped height fails here.
const OMNIBAR_SOURCE = new URL('../components/layout/Omnibar.tsx', import.meta.url)
const OMNIBAR_SRC = readFileSync(OMNIBAR_SOURCE, 'utf8')
const EXPECTED_HEIGHT = Number(OMNIBAR_SRC.match(/height:\s*(\d+)/)?.[1])
const EXPECTED_FIELD_MAX_WIDTH = Number(OMNIBAR_SRC.match(/searchMaxWidth:\s*(\d+)/)?.[1])
if (!EXPECTED_HEIGHT) { console.error('HARNESS: could not read OMNIBAR.height from the component'); process.exit(2) }
if (!EXPECTED_FIELD_MAX_WIDTH) { console.error('HARNESS: could not read OMNIBAR.searchMaxWidth from the component'); process.exit(2) }
const BAR = '[data-omnibar]'
const SEARCH = '[data-omnibar-search]'
// ONE menu button, inside the header, first of the left group. Above `lg` it
// folds the bar, below it opens the drawer.
const MENU = '[data-omnibar-menu]'
// The round button that used to straddle the bar's edge is gone: this check asserts its
// absence, so re-introducing it fails here instead of only during visual review.
const EDGE_TOGGLE = '[data-sidebar-edge-toggle]'
const action = name => `[data-omnibar-action="${name}"]`

// --- The mail toolbar ---
const TOOLBAR = '[data-mail-toolbar]'
const ROW = '[data-mail-row]'
// The widths under test, from the widest to the narrowest.
const TOOLBAR_WIDTHS = [1440, 1280, 1024, 390]
// The expected order is READ from the shared constant: neither the order nor the names
// are copied here, otherwise the harness would measure its own copy.
const SELECTION_SRC = readFileSync(new URL('../lib/mailSelection.tsx', import.meta.url), 'utf8')
const GROUPS_SRC = SELECTION_SRC.slice(
  SELECTION_SRC.indexOf('MAIL_TOOLBAR_GROUPS'),
  SELECTION_SRC.indexOf('] as const', SELECTION_SRC.indexOf('MAIL_TOOLBAR_GROUPS')))
const TOOLBAR_ORDER = [...GROUPS_SRC.matchAll(/action:\s*'(\w+)'/g)].map(m => m[1])
// The menu's first colour is READ from the flags source: the harness names no colour
// of its own.
const FLAGS_SRC = readFileSync(new URL('../lib/flags.ts', import.meta.url), 'utf8')
const FIRST_FLAG_KEY = FLAGS_SRC.match(/\{\s*key:\s*'(\w+)'/)?.[1]
const SELECTION_ATTR = SELECTION_SRC.match(/MAIL_SELECTION_COUNT_ATTR = '([\w-]+)'/)?.[1]
if (TOOLBAR_ORDER.length < 2 || !SELECTION_ATTR || !FIRST_FLAG_KEY) {
  console.error('HARNESS: could not read MAIL_TOOLBAR_GROUPS / MAIL_SELECTION_COUNT_ATTR / MAIL_FLAGS')
  process.exit(2)
}
// The signed-in user sits at the far right of the header, and the one door to
// the settings is inside its menu — the left group's "settings" action is gone.
const USER_TRIGGER = '[data-user-menu-trigger]'
const USER_MENU = '[data-user-menu]'
const userItem = name => `[data-user-menu-item="${name}"]`
// Two letters, like an account bubble — the rule lives in AccountAvatar.twoLetters.
const USER_INITIALS_LEN = 2
// Every clickable box of the header, measured together at 390 px: no two of them may
// ever overlap.
const HEADER_BOXES = `${MENU}, [data-omnibar-action], [data-mail-toolbar-more], ${SEARCH}, ${USER_TRIGGER}`
// Minimum gap between two neighbouring touch targets, in CSS pixels — the value asked
// for during visual review (gaps of at least 4 px) and the one `gap-1` delivers.
const MIN_HIT_GAP_PX = 4
// Width of a button in the `ACTION` template (`w-8`), applied by the component through
// Tailwind: an overflow button narrower than that is a squashed button, not a button.
const MORE_BUTTON_PX = 32
// Search debounce delay, READ from the shared contract (`lib/search.ts`): after clearing
// the field, the harness lets the navigation it triggers go through.
const SEARCH_SRC = readFileSync(new URL('../lib/search.ts', import.meta.url), 'utf8')
const SEARCH_DEBOUNCE_MS = Number(SEARCH_SRC.match(/SEARCH_DEBOUNCE_MS = (\d+)/)?.[1])
if (!SEARCH_DEBOUNCE_MS) { console.error('HARNESS: could not read SEARCH_DEBOUNCE_MS from lib/search.ts'); process.exit(2) }
const SEARCH_SETTLE_MS = SEARCH_DEBOUNCE_MS + 400

// --- The omnibar panel ---
const PANEL = '[data-omnibar-panel]'
// The settings entries and the languages are READ from the product sources: the harness
// keeps no list of its own, otherwise it would measure its copy.
const NAV_SRC = readFileSync(new URL('../components/settings/SettingsSidebar.tsx', import.meta.url), 'utf8')
const NAV_BLOCK = NAV_SRC.slice(NAV_SRC.indexOf('export const SETTINGS_NAV'), NAV_SRC.indexOf('] as const', NAV_SRC.indexOf('export const SETTINGS_NAV')))
const SETTINGS_NAV_KEYS = [...NAV_BLOCK.matchAll(/key:\s*'([\w-]+)'/g)].map(m => m[1])
const API_KEYS_HREF = NAV_BLOCK.match(/href:\s*'([^']*api-keys)'/)?.[1]
const SETTINGS_ENTRY_API = 'settings:apiKeys'
const LOCALES_SRC = readFileSync(new URL('../lib/locales.ts', import.meta.url), 'utf8')
const LOCALE_CODES = [...LOCALES_SRC.slice(LOCALES_SRC.indexOf('export const LOCALES'), LOCALES_SRC.indexOf('] as const')).matchAll(/code:\s*'(\w+)'/g)].map(m => m[1])
if (!SETTINGS_NAV_KEYS.length || !API_KEYS_HREF || LOCALE_CODES.length < 2) {
  console.error('HARNESS: could not read SETTINGS_NAV / LOCALES from the product sources')
  process.exit(2)
}

// Navigations and the compose window settle well under this; the bar's own
// transitions are colour-only (no layout animation to wait out).
const SETTLE_MS = 600

for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
}

const { SYNAPMAIL_TEST_URL: BASE, SYNAPMAIL_TEST_EMAIL: EMAIL, SYNAPMAIL_TEST_PASSWORD: PASSWORD } = process.env
for (const [k, v] of Object.entries({ SYNAPMAIL_TEST_URL: BASE, SYNAPMAIL_TEST_EMAIL: EMAIL, SYNAPMAIL_TEST_PASSWORD: PASSWORD })) {
  if (!v) { console.error(`HARNESS: ${k} is not set`); process.exit(2) }
}

/**
 * Reads the header's box against the window and against the sidebar, in one frame.
 * `aboveSidebar` is what tells a full-width application header apart from a bar
 * confined to the content column: the header's left edge must reach the window's,
 * and its bottom must sit above the sidebar's top.
 */
const probeBar = sel => {
  const bar = document.querySelector(sel)
  if (!bar) return null
  const r = bar.getBoundingClientRect()
  const aside = document.querySelector('aside')
  const ar = aside?.getBoundingClientRect()
  const style = getComputedStyle(bar)
  const box = s2 => {
    const el = bar.querySelector(s2)
    if (!el) return null
    const b = el.getBoundingClientRect()
    return { left: b.left, right: b.right, centre: b.left + b.width / 2, width: b.width }
  }
  return {
    height: r.height,
    left: r.left,
    right: r.right,
    top: r.top,
    bottom: r.bottom,
    centre: r.left + r.width / 2,
    windowWidth: document.documentElement.clientWidth,
    asideRight: ar && ar.height ? ar.right : null,
    field: box('[data-omnibar-search]'),
    // The mail toolbar sits between the left group and the field.
    toolbar: box('[data-mail-toolbar]'),
    // The field butts against the last ICON, not against the toolbar container
    // (which is `flex-1` and therefore stretches up to the field).
    lastToolbarButton: (() => {
      const buttons = [...bar.querySelectorAll('[data-mail-toolbar] button')]
        .filter(el => el.getBoundingClientRect().width > 0)
      const last = buttons.at(-1)
      if (!last) return null
      const b = last.getBoundingClientRect()
      return { left: b.left, right: b.right, centre: b.left + b.width / 2, width: b.width }
    })(),
    // ONE tooltip per button: no native `title` anywhere in the header.
    titled: [...bar.querySelectorAll('[title]')].map(el => el.getAttribute('title')),
    menu: box('[data-omnibar-menu]'),
    actions: ['dashboard', 'compose'].map(n => box(`[data-omnibar-action="${n}"]`)),
    user: box('[data-user-menu-trigger]'),
    userInitials: bar.querySelector('[data-user-menu-initials]')?.textContent?.trim() ?? null,
    strayActions: [...bar.querySelectorAll('[data-omnibar-action]')].map(el => el.dataset.omnibarAction),
    background: style.backgroundColor,
    horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    // Decorative animation is forbidden by the spec: the header's state is static.
    animated: [bar, ...bar.querySelectorAll('*')].some(el => {
      const st = getComputedStyle(el)
      return st.animationName !== 'none' && st.animationDuration !== '0s'
    }),
  }
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] })
const failures = []
try {
  const page = await browser.newPage()
// The dev server recompiles a route on its first visit and the mailbox keeps an SSE
// stream open: `networkidle2` sometimes takes longer than puppeteer's 30 s default.
// Observed: two runs failing on two DIFFERENT `goto` calls, both outside the measured
// sections — a harness failure, not a product one. The ceiling goes up; nothing about
// what is measured changes.
page.setDefaultNavigationTimeout(120000)
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

  // --- Present on every page, with the exported height, spanning the window ---
  console.log(`expected height, read from Omnibar.tsx: ${EXPECTED_HEIGHT}px`)
  for (const path of PAGES) {
    await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle2' })
    await page.waitForSelector(BAR, { timeout: 20000 })
    await new Promise(r => setTimeout(r, SETTLE_MS))
    const bar = await page.evaluate(probeBar, BAR)
    if (!bar) { failures.push(`${path}: no ${BAR} in the document`); continue }
    console.log(`${path}: height=${bar.height.toFixed(2)}px left=${bar.left.toFixed(2)} right=${bar.right.toFixed(2)}/${bar.windowWidth} top=${bar.top.toFixed(2)} asideRight=${bar.asideRight?.toFixed(2) ?? 'n/a'}`)
    const drift = Math.abs(bar.height - EXPECTED_HEIGHT)
    if (drift > MAX_DRIFT_PX) failures.push(`${path}: header is ${bar.height.toFixed(2)}px tall, expected ${EXPECTED_HEIGHT}px (drift ${drift.toFixed(2)}px)`)
    if (Math.abs(bar.top) > MAX_DRIFT_PX) failures.push(`${path}: header top is ${bar.top.toFixed(2)}, not 0`)
    // The bar owns the full height: the header begins where the bar ends, never above it.
    if (bar.asideRight == null) failures.push(`${path}: no sidebar measured — cannot tell where the header should start`)
    else if (Math.abs(bar.left - bar.asideRight) > MAX_DRIFT_PX) {
      failures.push(`${path}: header starts at x=${bar.left.toFixed(2)}, not at the sidebar's right edge (${bar.asideRight.toFixed(2)})`)
    }
    if (Math.abs(bar.right - bar.windowWidth) > MAX_DRIFT_PX) failures.push(`${path}: header ends at x=${bar.right.toFixed(2)}, not at the window's right edge (${bar.windowWidth})`)
    // Actions on the LEFT, in order, all of them before the field.
    if (!bar.menu) failures.push(`${path}: the menu button is not inside the header`)
    if (bar.actions.some(a => !a)) failures.push(`${path}: an action is missing from the header`)
    else if (!bar.field || !bar.menu) failures.push(`${path}: no search field in the header`)
    else {
      // Order of the left group: menu, dashboard, compose, settings.
      const xs = [bar.menu, ...bar.actions].map(a => a.left)
      if (xs.some((x, i) => i > 0 && x <= xs[i - 1])) failures.push(`${path}: the left group is not in order menu, dashboard, compose (x = ${xs.map(v => v.toFixed(0)).join(', ')})`)
      if (bar.actions.at(-1).right > bar.field.left) failures.push(`${path}: the actions are not left of the search field (last action ends at ${bar.actions.at(-1).right.toFixed(2)}, field starts at ${bar.field.left.toFixed(2)})`)
      // The field starts right after the LAST visible icon — the toolbar's on /mail,
      // the left group's elsewhere — at the `searchGap` distance read from the
      // component. The free space runs off to its right.
      const lastIcon = Math.max(bar.actions.at(-1).right, bar.lastToolbarButton?.right ?? 0)
      const gap = bar.field.left - lastIcon
      const freeRight = (bar.user ? bar.user.left : bar.right) - bar.field.right
      console.log(`  menu+actions x=${xs.map(v => v.toFixed(0)).join(',')} | last icon ends ${lastIcon.toFixed(0)} | field ${bar.field.left.toFixed(0)}..${bar.field.right.toFixed(0)} (w=${bar.field.width.toFixed(0)}), gap ${gap.toFixed(2)}px, free space right ${freeRight.toFixed(2)}px`)
      if (Math.abs(gap - EXPECTED_FIELD_GAP) > MAX_DRIFT_PX) failures.push(`${path}: the field starts ${gap.toFixed(2)}px after the last icon, expected ${EXPECTED_FIELD_GAP}px (Omnibar.tsx searchGap)`)
      if (freeRight < -MAX_DRIFT_PX) failures.push(`${path}: the field overlaps the user bubble (${freeRight.toFixed(2)}px)`)
      if (bar.toolbar && bar.field.left < bar.toolbar.right) failures.push(`${path}: the search field (x=${bar.field.left.toFixed(2)}) runs under the mail toolbar (ends at ${bar.toolbar.right.toFixed(2)})`)
      if (bar.field.width > EXPECTED_FIELD_MAX_WIDTH + MAX_DRIFT_PX) failures.push(`${path}: the field is ${bar.field.width.toFixed(2)}px wide, above the ${EXPECTED_FIELD_MAX_WIDTH}px bound`)
    }
    if (bar.horizontalOverflow) failures.push(`${path}: horizontal scrollbar at ${VIEWPORT.width}px`)
    if (bar.animated) failures.push(`${path}: an element of the header is running an animation (state must be static)`)
    // The native tooltip (placed on the POINTER) is replaced everywhere.
    if (bar.titled.length) failures.push(`${path}: ${bar.titled.length} header element(s) still carry a native title: ${bar.titled.join(' | ')}`)
    const missing = await page.evaluate(sels => sels.filter(s => !document.querySelector(s)), [SEARCH, action('dashboard'), action('compose'), USER_TRIGGER])
    if (missing.length) failures.push(`${path}: missing from the header: ${missing.join(', ')}`)
    // One door to the settings: the left group no longer carries the action.
    // Outside the mailbox the mail group does not exist (nothing to grey out for nothing).
    if (path === '/mail' && !bar.toolbar) failures.push(`${path}: no mail toolbar in the header`)
    if (path !== '/mail' && bar.toolbar) failures.push(`${path}: the mail toolbar shows outside the mailbox`)
    if (bar.strayActions.includes('settings')) failures.push(`${path}: the header still carries a "settings" action on the left`)
    // The user bubble is the RIGHTMOST thing in the header, past the field, with two letters.
    if (!bar.user) failures.push(`${path}: no user bubble in the header`)
    else {
      console.log(`  user "${bar.userInitials}" at x=${bar.user.left.toFixed(0)}..${bar.user.right.toFixed(0)} (header ends at ${bar.right.toFixed(0)})`)
      if (bar.field && bar.user.left < bar.field.right) failures.push(`${path}: the user bubble (x=${bar.user.left.toFixed(2)}) is not right of the search field (${bar.field.right.toFixed(2)})`)
      if ((bar.userInitials ?? '').length !== USER_INITIALS_LEN) failures.push(`${path}: the user bubble reads "${bar.userInitials}", expected ${USER_INITIALS_LEN} letters`)
    }
  }

  // --- The header follows the bar's right edge in BOTH collapse states ---
  // Driven by the header's own menu button: a REAL click on the shipped
  // control, measured on the SAME page one state after the other, so the two readings
  // share everything but the collapse.
  await page.goto(`${BASE}/mail`, { waitUntil: 'networkidle2' })
  await page.waitForSelector(MENU, { timeout: 20000 })
  await new Promise(r => setTimeout(r, SETTLE_MS))
  const readCollapsed = () => page.evaluate(() => document.querySelector('[data-sidebar]')?.dataset.collapsed ?? null)
  // The bar renders the SSR default (expanded) until its `/api/settings` SWR resolves,
  // which on a cold dev server can take seconds. Clicking during that window measures
  // an unsettled page — observed: the DOM read "false" while the database held "true",
  // and the click PATCHed the value it was already at, folding nothing. Wait until the
  // rendered state matches the persisted one before touching anything.
  const settle = async () => {
    for (let i = 0; i < 40; i++) {
      const [dom, persisted] = await Promise.all([
        readCollapsed(),
        page.evaluate(async b => (await (await fetch(`${b}/api/settings`)).json())?.data?.sidebar_collapsed ?? null, BASE),
      ])
      if (dom != null && persisted != null && dom === String(persisted)) return { dom, persisted }
      await new Promise(r => setTimeout(r, 250))
    }
    return null
  }
  const settled = await settle()
  if (!settled) { console.error('HARNESS: the bar never caught up with the persisted collapse state — the page was unsettled, nothing measured'); process.exit(2) }
  console.log(`bar settled on the persisted state: data-collapsed=${settled.dom}`)
  const edges = []
  const collapseStates = []
  for (const pass of ['as loaded', 'after toggling']) {
    const bar = await page.evaluate(probeBar, BAR)
    const collapsed = await readCollapsed()
    edges.push({ pass, left: bar?.left, asideRight: bar?.asideRight })
    collapseStates.push(collapsed)
    console.log(`collapse ${pass}: data-collapsed=${collapsed} header.left=${bar?.left.toFixed(2)} aside.right=${bar?.asideRight?.toFixed(2) ?? 'n/a'}`)
    if (bar?.asideRight == null) { console.error('HARNESS: no sidebar measured — nothing to compare the header against'); process.exit(2) }
    if (collapsed == null) { console.error('HARNESS: no [data-sidebar] to read the collapse state from'); process.exit(2) }
    if (Math.abs(bar.left - bar.asideRight) > MAX_DRIFT_PX) {
      failures.push(`collapse ${pass}: header starts at x=${bar.left.toFixed(2)}, sidebar ends at ${bar.asideRight.toFixed(2)}`)
    }
    if (pass === 'as loaded') {
      await page.click(MENU)
      // The bar animates its width; wait past the transition so the reading is the settled state.
      await new Promise(r => setTimeout(r, SETTLE_MS))
    }
  }
  // Same-run reference: if the click changed neither the flag nor the width, both
  // readings are the same state and the pair proves nothing about the collapse.
  if (collapseStates[0] === collapseStates[1]) {
    failures.push(`clicking the header menu button left data-collapsed at "${collapseStates[0]}" — it does not fold the bar`)
  }
  if (Math.abs(edges[0].asideRight - edges[1].asideRight) <= MAX_DRIFT_PX) {
    console.error('HARNESS: the bar kept the same width across the click — the collapse was not exercised')
    process.exit(2)
  }
  // Put the persisted preference back the way this check found it.
  await page.click(MENU)
  await new Promise(r => setTimeout(r, SETTLE_MS))
  if (!(await settle())) { console.error('HARNESS: the bar never settled after restoring the collapse state'); process.exit(2) }

  // --- The round floating toggle is gone (removed for both the bar AND the drawer) ---
  const strayToggles = await page.evaluate(s2 => document.querySelectorAll(s2).length, EDGE_TOGGLE)
  console.log(`floating ${EDGE_TOGGLE} elements in the DOM: ${strayToggles}`)
  if (strayToggles) failures.push(`${strayToggles} floating collapse button(s) still in the DOM, expected none`)

  // --- The dashboard row left the sidebar (it is reached from the header now) ---
  await page.goto(`${BASE}/mail`, { waitUntil: 'networkidle2' })
  await page.waitForSelector('[data-sidebar] [data-sidebar-row]', { timeout: 20000 })
  await new Promise(r => setTimeout(r, SETTLE_MS))
  const sidebarRows = await page.evaluate(() =>
    [...document.querySelectorAll('[data-sidebar] [data-sidebar-row]')].map(el => el.dataset.sidebarRow))
  console.log(`sidebar rows: ${sidebarRows.join(', ')}`)
  if (!sidebarRows.length) { console.error('HARNESS: no sidebar row measured'); process.exit(2) }
  if (sidebarRows.includes('dashboard')) failures.push('the sidebar still carries a "dashboard" row')
  // The bar's footer is empty: theme and settings live in the user menu.
  if (sidebarRows.includes('settings')) failures.push('the sidebar still carries a "settings" row')
  // The header carries compose on every page, so the bar does not.
  if (sidebarRows.includes('compose')) failures.push('the sidebar still carries a "compose" row, expected none')
  const themeSlots = await page.evaluate(() => document.querySelectorAll('[data-sidebar] [data-sidebar-slot="theme-toggle"]').length)
  console.log(`sidebar footer: theme-toggle slots=${themeSlots}`)
  if (themeSlots) failures.push(`${themeSlots} theme-toggle slot(s) still in the sidebar, expected the theme in the user menu`)

  // --- Cmd/Ctrl+K focuses the field, from anywhere on the page ---
  await page.evaluate(() => document.body.click())
  const beforeShortcut = await page.evaluate(s => document.activeElement === document.querySelector(s), SEARCH)
  await page.keyboard.down('Meta'); await page.keyboard.press('KeyK'); await page.keyboard.up('Meta')
  const afterMeta = await page.evaluate(s => document.activeElement === document.querySelector(s), SEARCH)
  await page.evaluate(() => document.activeElement?.blur())
  await page.keyboard.down('Control'); await page.keyboard.press('KeyK'); await page.keyboard.up('Control')
  const afterCtrl = await page.evaluate(s => document.activeElement === document.querySelector(s), SEARCH)
  console.log(`search focused — before any shortcut: ${beforeShortcut}, after Cmd+K: ${afterMeta}, after Ctrl+K: ${afterCtrl}`)
  // The "before" reading is the same-run reference: without it, a field that was
  // already focused would make both shortcuts pass vacuously.
  if (beforeShortcut) { console.error('HARNESS: the field was already focused before the shortcut — nothing measured'); process.exit(2) }
  if (!afterMeta) failures.push('Cmd+K does not focus the header search field')
  if (!afterCtrl) failures.push('Ctrl+K does not focus the header search field')

  // --- Escape clears the field and drops the focus ---
  await page.type(SEARCH, 'facture')
  const typed = await page.$eval(SEARCH, el => el.value)
  await page.keyboard.press('Escape')
  const cleared = await page.$eval(SEARCH, el => el.value)
  const stillFocused = await page.evaluate(s => document.activeElement === document.querySelector(s), SEARCH)
  console.log(`Escape: "${typed}" -> "${cleared}", still focused: ${stillFocused}`)
  if (!typed) { console.error('HARNESS: could not type into the field — nothing measured'); process.exit(2) }
  if (cleared !== '') failures.push(`Escape left "${cleared}" in the field`)
  if (stillFocused) failures.push('Escape left the focus in the field')

  // --- REAL clicks on the three actions ---
  await page.goto(`${BASE}/mail`, { waitUntil: 'networkidle2' })
  await page.waitForSelector(action('dashboard'), { timeout: 20000 })
  await new Promise(r => setTimeout(r, SETTLE_MS))
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), page.click(action('dashboard'))])
  await new Promise(r => setTimeout(r, SETTLE_MS))
  let url = new URL(page.url()).pathname
  console.log(`click dashboard -> ${url}`)
  if (!url.startsWith('/dashboard')) failures.push(`clicking the dashboard action landed on ${url}`)

  // --- The user menu is the one door to the settings, the theme and the exit ---
  await page.goto(`${BASE}/mail`, { waitUntil: 'networkidle2' })
  await page.waitForSelector(USER_TRIGGER, { timeout: 20000 })
  await page.waitForSelector('[data-sidebar] [data-sidebar-row]', { timeout: 20000 })
  await new Promise(r => setTimeout(r, SETTLE_MS))
  // Same-run reference: the menu must be CLOSED before the click, otherwise "it is open
  // after the click" would pass on a menu that was never opened by anything.
  const menuOpen = () => page.evaluate(s2 => !!document.querySelector(s2), USER_MENU)
  const beforeOpen = await menuOpen()
  if (beforeOpen) { console.error('HARNESS: the user menu was already open before the click — nothing measured'); process.exit(2) }
  await page.click(USER_TRIGGER)
  await new Promise(r => setTimeout(r, SETTLE_MS))
  const afterOpen = await menuOpen()
  const entries = await page.evaluate(() =>
    [...document.querySelectorAll('[data-user-menu] [data-user-menu-item]')].map(el => el.dataset.userMenuItem))
  const identity = await page.evaluate(s2 => {
    const box = document.querySelector(s2)
    return box ? box.textContent.trim().slice(0, 120) : null
  }, USER_MENU)
  console.log(`user menu: closed before click=${!beforeOpen}, open after click=${afterOpen}, entries=${entries.join(', ') || 'none'}`)
  if (!afterOpen) failures.push('clicking the user bubble does not open the menu')
  for (const want of ['settings', 'theme', 'signout']) {
    if (!entries.includes(want)) failures.push(`the user menu has no "${want}" entry (found: ${entries.join(', ') || 'none'})`)
  }
  // The header of the menu carries the signed-in identity: the address is enough to
  // prove it is the real user and not a placeholder.
  if (!identity || !identity.includes('@')) failures.push(`the user menu shows no e-mail address (read: ${identity ?? 'nothing'})`)

  // Light-dismiss: ONE click outside closes the menu AND reaches its target. Clicking a
  // folder row must both close the menu and open that folder — a veil that swallowed the
  // click would close the menu while leaving the folder untouched.
  const folderBefore = new URL(page.url()).searchParams.get('folder')
  // A FOLDER row, not the account switcher (whose click opens a dropdown and moves no
  // URL) and not the folder already open: the proof is that the URL lands on that folder,
  // so the target has to be a row whose click is a navigation in the first place.
  const folderTarget = await page.evaluate(() => {
    const here = new URL(location.href).searchParams.get('folder')
    const row = [...document.querySelectorAll('[data-sidebar] [data-sidebar-row^="folder:"]')]
      .find(el => el.dataset.sidebarRow.slice('folder:'.length) !== here && el.getBoundingClientRect().height > 0)
    if (!row) return null
    const r = row.getBoundingClientRect()
    return { key: row.dataset.sidebarRow, folder: row.dataset.sidebarRow.slice('folder:'.length), x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })
  if (!folderTarget) { console.error('HARNESS: no other folder row to click through to — light-dismiss not measured'); process.exit(2) }
  await page.mouse.click(folderTarget.x, folderTarget.y)
  await new Promise(r => setTimeout(r, SETTLE_MS * 2))
  const dismissed = !(await menuOpen())
  const folderAfter = new URL(page.url()).searchParams.get('folder')
  console.log(`light-dismiss: one click on folder "${folderTarget.folder}" -> menu closed=${dismissed}, folder ${folderBefore || '(none)'} -> ${folderAfter || '(none)'}`)
  if (!dismissed) failures.push('one click outside does not close the user menu')
  if (folderAfter !== folderTarget.folder) failures.push(`the click that closed the menu did not reach the folder row "${folderTarget.folder}" — the mailbox is on ${folderAfter || '(none)'}`)

  // Settings entry: the ONLY remaining path to /settings from the header.
  await page.click(USER_TRIGGER)
  await new Promise(r => setTimeout(r, SETTLE_MS))
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), page.click(userItem('settings'))])
  await new Promise(r => setTimeout(r, SETTLE_MS))
  url = new URL(page.url()).pathname
  console.log(`click user menu -> settings -> ${url}`)
  if (!url.startsWith('/settings')) failures.push(`the user menu's settings entry landed on ${url}`)

  // Compose has two branches in lib/compose.ts: on /mail it dispatches the event,
  // elsewhere it navigates to /mail?compose=1. Both are clicked, from a FRESHLY
  // loaded page each time — clicking straight after the settings action would land
  // on the settings modal's backdrop and measure the dismiss, not the compose.
  const composeEditor = () => page.evaluate(() =>
    !!document.querySelector('[role="dialog"] .ProseMirror, [role="dialog"] [contenteditable="true"]'))
  for (const from of ['/dashboard', '/mail']) {
    await page.goto(`${BASE}${from}`, { waitUntil: 'networkidle2' })
    await page.waitForSelector(action('compose'), { timeout: 20000 })
    await new Promise(r => setTimeout(r, SETTLE_MS))
    if (await composeEditor()) { console.error(`HARNESS: a compose window was already open on ${from} — nothing measured`); process.exit(2) }
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), page.click(action('compose'))])
    await new Promise(r => setTimeout(r, SETTLE_MS * 4))
    const composeUrl = new URL(page.url())
    const composeOpen = await composeEditor()
    console.log(`click compose from ${from} -> ${composeUrl.pathname}${composeUrl.search}, compose window in the DOM: ${composeOpen}`)
    if (!composeOpen) failures.push(`clicking the compose action from ${from} did not open the compose window (landed on ${composeUrl.pathname}${composeUrl.search})`)
  }

  // --- The mail toolbar in the header ---
  // Order, disabled states and what a button actually DOES, measured on the running
  // app. The expected order is READ from the shared constant, never transcribed here.
  await page.goto(`${BASE}/mail`, { waitUntil: 'networkidle2' })
  await page.waitForSelector(TOOLBAR, { timeout: 20000 })
  await new Promise(r => setTimeout(r, SETTLE_MS))

  const actionStates = () => page.evaluate(() => Object.fromEntries(
    [...document.querySelectorAll('[data-mail-action]')].map(b => [b.dataset.mailAction, b.disabled === true])))
  const actionOrder = () => page.evaluate(() =>
    [...document.querySelectorAll('[data-mail-action]')].map(b => b.dataset.mailAction))

  const order = await actionOrder()
  console.log(`toolbar order : ${order.join(',')}`)
  console.log(`constant says : ${TOOLBAR_ORDER.join(',')}`)
  if (order.join(',') !== TOOLBAR_ORDER.join(','))
    failures.push(`toolbar order is ${order.join(',')}, MAIL_TOOLBAR_GROUPS says ${TOOLBAR_ORDER.join(',')}`)

  // --- The refresh action before compose, and anchored tooltips ---
  // The leading action is READ from the shared constant, never transcribed here.
  const leadAction = TOOLBAR_ORDER[0]
  const leadOrder = await page.evaluate(lead => {
    const bar = document.querySelector('[data-omnibar]')
    const box = sel => {
      const el = bar?.querySelector(sel)
      if (!el) return null
      const b = el.getBoundingClientRect()
      return { left: b.left, right: b.right, centre: b.left + b.width / 2, bottom: b.bottom }
    }
    return {
      lead: box(`[data-mail-action="${lead}"]`),
      compose: box('[data-omnibar-action="compose"]'),
      dashboard: box('[data-omnibar-action="dashboard"]'),
      inToolbar: !!document.querySelector(`[data-mail-toolbar] [data-mail-action="${lead}"]`),
    }
  }, leadAction)
  console.log(`lead "${leadAction}" x=${leadOrder.lead?.left.toFixed(0) ?? 'n/a'} | dashboard ${leadOrder.dashboard?.left.toFixed(0)} | compose ${leadOrder.compose?.left.toFixed(0)} | still inside the toolbar: ${leadOrder.inToolbar}`)
  if (!leadOrder.lead || !leadOrder.compose || !leadOrder.dashboard) failures.push(`the header is missing one of ${leadAction} / compose / dashboard`)
  else {
    if (!(leadOrder.dashboard.right <= leadOrder.lead.left)) failures.push(`"${leadAction}" (x=${leadOrder.lead.left.toFixed(2)}) is not right of the dashboard action (${leadOrder.dashboard.right.toFixed(2)})`)
    if (!(leadOrder.lead.right <= leadOrder.compose.left)) failures.push(`"${leadAction}" (ends ${leadOrder.lead.right.toFixed(2)}) is not BEFORE compose (${leadOrder.compose.left.toFixed(2)}), expected that order`)
  }
  if (leadOrder.inToolbar) failures.push(`"${leadAction}" is rendered twice: the header took it and the mail toolbar still shows it`)

  // A tooltip appears on a REAL hover and sits under the icon, not under the pointer.
  const TIP = '[data-icon-tooltip]'
  const tipVisible = () => page.evaluate(sel => [...document.querySelectorAll(sel)]
    .filter(el => getComputedStyle(el).visibility !== 'hidden' && Number(getComputedStyle(el).opacity) > 0.5)
    .map(el => {
      const b = el.getBoundingClientRect()
      const host = el.parentElement.getBoundingClientRect()
      return { text: el.textContent.trim(), centre: b.left + b.width / 2, top: b.top, left: b.left, right: b.right, hostCentre: host.left + host.width / 2, hostBottom: host.bottom, windowWidth: document.documentElement.clientWidth }
    }), TIP)

  await page.mouse.move(0, 0)
  await new Promise(r => setTimeout(r, SETTLE_MS))
  const tipsAtRest = await tipVisible()
  console.log(`tooltips visible without hovering: ${tipsAtRest.length}`)
  if (tipsAtRest.length) failures.push(`${tipsAtRest.length} tooltip(s) visible without any hover: ${tipsAtRest.map(t => t.text).join(' | ')}`)

  // Three positions: one at the left edge, one in the middle, one at the right edge.
  for (const [where, selector] of [['left edge', MENU], ['middle', `[data-mail-action="${TOOLBAR_ORDER[1]}"]`], ['right edge', USER_TRIGGER]]) {
    await page.hover(selector)
    await new Promise(r => setTimeout(r, TOOLTIP_SETTLE_MS))
    const tips = await tipVisible()
    if (tips.length !== 1) { failures.push(`hovering the ${where} icon (${selector}) showed ${tips.length} tooltip(s), expected exactly 1`); await page.mouse.move(0, 0); continue }
    const tip = tips[0]
    const offCentre = Math.abs(tip.centre - tip.hostCentre)
    const below = tip.top - tip.hostBottom
    console.log(`  ${where}: "${tip.text}" centre off by ${offCentre.toFixed(2)}px, top = icon bottom + ${below.toFixed(2)}px, x ${tip.left.toFixed(0)}..${tip.right.toFixed(0)}/${tip.windowWidth}`)
    if (Math.abs(below - EXPECTED_TOOLTIP_OFFSET) > MAX_DRIFT_PX) failures.push(`${where}: the tooltip sits ${below.toFixed(2)}px under the icon, expected ${EXPECTED_TOOLTIP_OFFSET}px (IconTooltip.tsx)`)
    if (tip.left < -MAX_DRIFT_PX || tip.right > tip.windowWidth + MAX_DRIFT_PX) failures.push(`${where}: the tooltip runs out of the window (${tip.left.toFixed(2)}..${tip.right.toFixed(2)} of ${tip.windowWidth})`)
    // In the middle the tooltip is centred on the icon; at the edges it aligns to it, so
    // only the "stays on screen" constraint above applies.
    if (where === 'middle' && offCentre > MAX_DRIFT_PX) failures.push(`middle: the tooltip centre is ${offCentre.toFixed(2)}px off its icon's centre`)
    await page.mouse.move(0, 0)
    await new Promise(r => setTimeout(r, SETTLE_MS))
  }

  // A mouse CLICK must leave NOTHING behind: the button keeps the focus, but the tooltip
  // only shows on KEYBOARD focus. Without this assertion the tooltip stayed stuck on
  // screen until the next click (a defect raised during visual review).
  const CLICKED = `[data-mail-action="${leadAction}"]`
  await page.click(CLICKED)
  await page.mouse.move(0, 0)
  await new Promise(r => setTimeout(r, TOOLTIP_SETTLE_MS))
  const afterClick = await tipVisible()
  const keptFocus = await page.evaluate(sel => document.activeElement === document.querySelector(sel), CLICKED)
  console.log(`after clicking "${leadAction}" and moving the mouse away -> ${afterClick.length} tooltip(s) (button still focused: ${keptFocus})`)
  // Without a residual focus the check would run vacuously: it would prove nothing.
  if (!keptFocus) { console.error('HARNESS: the clicked button did not keep the focus — nothing measured'); process.exit(2) }
  if (afterClick.length) failures.push(`${afterClick.length} tooltip(s) still showing after a mouse click: ${afterClick.map(t => t.text).join(' | ')}`)

  // Keyboard focus: the same tooltip comes back, without the mouse. A real Tab key (not a
  // programmatic `.focus()`) — that is the gesture which switches the browser into
  // keyboard modality, so the only one that measures `:focus-visible`.
  await page.click(SEARCH)
  await page.keyboard.down('Shift'); await page.keyboard.press('Tab'); await page.keyboard.up('Shift')
  await new Promise(r => setTimeout(r, TOOLTIP_SETTLE_MS))
  const focusTips = await tipVisible()
  const focusedLabel = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.tagName)
  console.log(`Shift+Tab out of the search field -> focus on "${focusedLabel}", ${focusTips.length} tooltip(s): ${focusTips.map(t => t.text).join(' | ') || 'none'}`)
  if (focusTips.length !== 1) failures.push(`keyboard focus on "${focusedLabel}" showed ${focusTips.length} tooltip(s), expected exactly 1`)
  await page.evaluate(() => document.activeElement?.blur())

  // 0 selected: only refresh is live — a button without a capability is greyed, never hidden.
  const at0 = await actionStates()
  console.log(`disabled@0    : ${JSON.stringify(at0)}`)
  if (Object.keys(at0).length !== TOOLBAR_ORDER.length)
    failures.push(`${Object.keys(at0).length} toolbar buttons in the DOM, the constant declares ${TOOLBAR_ORDER.length} — a button is hidden instead of greyed`)
  const liveAt0 = Object.entries(at0).filter(([a, d]) => a !== 'refresh' && !d).map(([a]) => a)
  if (liveAt0.length) failures.push(`with nothing selected these are still enabled: ${liveAt0.join(',')}`)
  if (at0.refresh) failures.push('refresh is disabled although an account is active')

  const rows = await page.$$(ROW)
  if (rows.length < 3) { console.error(`HARNESS: ${rows.length} message rows — H3 needs at least 3`); process.exit(2) }

  // 1 selected: everything the account allows is live.
  await rows[2].click()
  await new Promise(r => setTimeout(r, SETTLE_MS))
  const at1 = await actionStates()
  console.log(`disabled@1    : ${JSON.stringify(at1)}`)
  const deadAt1 = Object.entries(at1).filter(([, d]) => d).map(([a]) => a)
  if (deadAt1.length) failures.push(`with one message open these are still disabled: ${deadAt1.join(',')}`)

  // 2 selected (checkbox on the avatar): replying to two messages makes no sense.
  await page.evaluate(sel => {
    const avatar = n => document.querySelectorAll(sel)[n]?.firstElementChild
    for (const n of [0, 1]) avatar(n)?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  }, ROW)
  await new Promise(r => setTimeout(r, SETTLE_MS))
  const selected = await page.evaluate(attr => document.querySelector(`[${attr}]`)?.getAttribute(attr), SELECTION_ATTR)
  const at2 = await actionStates()
  console.log(`disabled@${selected}    : ${JSON.stringify(at2)}`)
  if (selected !== '2') failures.push(`clicking two avatars selected ${selected} message(s), expected 2`)
  else for (const a of ['reply', 'replyAll']) {
    if (!at2[a]) failures.push(`${a} is still enabled with 2 messages selected — it targets ONE message`)
  }
  if (at2.remove) failures.push('delete is disabled with 2 messages selected, although it acts on the whole target')

  // Back to one message: Escape empties the selection (the list's shortcut), then the
  // 3rd row is reopened. Without this the target would stay at two messages and reply
  // would be greyed out rightly so — a harness defect, not a product one.
  await page.keyboard.press('Escape')
  await new Promise(r => setTimeout(r, SETTLE_MS))
  await (await page.$$(ROW))[2].click()
  await new Promise(r => setTimeout(r, SETTLE_MS * 2))
  const backToOne = await page.evaluate(attr => document.querySelector(`[${attr}]`)?.getAttribute(attr), SELECTION_ATTR)
  if (backToOne !== '0') { console.error(`HARNESS: selection is ${backToOne} after Escape, expected 0 — nothing measured`); process.exit(2) }

  // Flag: set then removed on a TEST message, read back through the API rather than off
  // the button (the toolbar carries no flag state to trust).
  const target = await page.evaluate(async () => {
    const uid = document.querySelectorAll('[data-mail-row]')[2]?.dataset.mailRow
    // The target is the ACTIVE account (`user_settings.active_account_id`), not a
    // "default" one: none of the accounts in this setup carries `isDefault`.
    const settings = (await (await fetch('/api/settings')).json())?.data ?? {}
    const accounts = (await (await fetch('/api/accounts')).json())?.data ?? []
    const account = settings.active_account_id ?? accounts.find(a => a.isDefault)?.id ?? accounts[0]?.id ?? null
    return { uid, account, folder: 'INBOX' }
  })
  if (!target.uid || !target.account) { console.error(`HARNESS: no test message (${JSON.stringify(target)}) — the flag is not measured`); process.exit(2) }
  const flagged = () => page.evaluate(async ({ uid, account, folder }) => {
    const res = await fetch(`/api/messages/${uid}?account=${account}&folder=${encodeURIComponent(folder)}`)
    if (!res.ok) return `HTTP ${res.status}`
    return (await res.json())?.isStarred ?? null
  }, target)

  const before = await flagged()
  if (typeof before !== 'boolean') { console.error(`HARNESS: cannot read the test message's flag (got ${before}) — nothing measured`); process.exit(2) }
  await page.click('[data-mail-action="setFlag"]')
  await new Promise(r => setTimeout(r, SETTLE_MS))
  const flagMenuOpen = await page.evaluate(() => !!document.querySelector('[data-mail-action-menu="setFlag"]'))
  if (!flagMenuOpen) failures.push('the flag button does not open its anchored menu')
  else {
    // The menu renders `FlagPicker` (single source, lib/flags.ts): its swatches carry
    // `data-flag`, not an attribute specific to the toolbar.
    await page.click(`[data-mail-action-menu="setFlag"] [data-flag="${FIRST_FLAG_KEY}"]`)
    await new Promise(r => setTimeout(r, SETTLE_MS * 2))
    const afterSet = await flagged()
    await page.click('[data-mail-action="setFlag"]')
    await new Promise(r => setTimeout(r, SETTLE_MS))
    await page.click('[data-mail-action-menu="setFlag"] [data-flag=""]')
    await new Promise(r => setTimeout(r, SETTLE_MS * 2))
    const afterClear = await flagged()
    console.log(`flag on the test message ${target.uid}: before=${before} after set=${afterSet} after remove=${afterClear}`)
    if (afterSet !== true) failures.push(`choosing a flag colour left isStarred=${afterSet}, expected true`)
    if (afterClear !== false) failures.push(`removing the flag left isStarred=${afterClear}, expected false`)
  }

  // Reply: a real click must open the compose window.
  const replyLive = await page.$('[data-mail-action="reply"]:not([disabled])')
  if (!replyLive) failures.push('reply is disabled although one message is open')
  else {
    await replyLive.click()
    await new Promise(r => setTimeout(r, SETTLE_MS * 4))
    const opened = await page.evaluate(() =>
      !!document.querySelector('[role="dialog"] .ProseMirror, [role="dialog"] [contenteditable="true"]'))
    console.log(`click reply -> compose window in the DOM: ${opened}`)
    if (!opened) failures.push('a real click on Reply did not open the compose window')
    await page.keyboard.press('Escape')
    await new Promise(r => setTimeout(r, SETTLE_MS))
  }

  // The removed duplicates: no second row of the same actions anywhere on /mail.
  await page.goto(`${BASE}/mail`, { waitUntil: 'networkidle2' })
  await page.waitForSelector(ROW, { timeout: 20000 })
  await new Promise(r => setTimeout(r, SETTLE_MS))
  await (await page.$$(ROW))[2].click()
  await new Promise(r => setTimeout(r, SETTLE_MS * 2))
  const strayReadingActions = await page.evaluate(() =>
    [...document.querySelectorAll('[data-reading-pane] button, [data-reading-archive]')]
      .map(b => (b.textContent || '').trim().toLowerCase())
      .filter(txt => ['répondre', 'reply', 'transférer', 'forward', 'répondre à tous'].includes(txt)))
  console.log(`duplicate reply/forward buttons left in the reading pane: ${strayReadingActions.length}`)
  if (strayReadingActions.length) failures.push(`the reading pane still carries ${strayReadingActions.join(', ')} — the head bar owns them now`)

  // No horizontal overflow at any of the widths the lot names; the toolbar folds
  // into its overflow menu rather than pushing the header wider.
  for (const width of TOOLBAR_WIDTHS) {
    await page.setViewport({ width, height: 900 })
    await new Promise(r => setTimeout(r, SETTLE_MS))
    const shot = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      visible: document.querySelectorAll('[data-mail-action]').length,
      more: !!document.querySelector('[data-mail-toolbar-more]'),
    }))
    console.log(`  ${width}px: buttons=${shot.visible} overflow-menu=${shot.more} horizontal-overflow=${shot.overflow}`)
    if (shot.overflow) failures.push(`the header overflows horizontally at ${width}px`)
    if (shot.visible < TOOLBAR_ORDER.length && !shot.more) failures.push(`${width}px: ${shot.visible}/${TOOLBAR_ORDER.length} buttons shown but no overflow menu`)
  }
  await page.setViewport(VIEWPORT)

  // --- Mobile: the header replaces the top bar and carries the drawer hamburger ---
  await page.setViewport(MOBILE_VIEWPORT)
  await page.goto(`${BASE}/mail`, { waitUntil: 'networkidle2' })
  await page.waitForSelector(BAR, { timeout: 20000 })
  await new Promise(r => setTimeout(r, SETTLE_MS))
  const mobileBar = await page.evaluate(probeBar, BAR)
  const hamburgerVisible = await page.evaluate(s => {
    const el = document.querySelector(s)
    if (!el) return false
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  }, MENU)
  // Exactly one top bar: a leftover `lg:hidden` bar above the content would be a second one.
  const barCount = await page.evaluate(s => document.querySelectorAll(s).length, BAR)
  console.log(`mobile ${MOBILE_VIEWPORT.width}px: header height=${mobileBar?.height.toFixed(2)}px, hamburger visible=${hamburgerVisible}, headers in the DOM=${barCount}, overflow=${mobileBar?.horizontalOverflow}`)
  if (!mobileBar) failures.push(`no header at ${MOBILE_VIEWPORT.width}px`)
  else {
    if (Math.abs(mobileBar.height - EXPECTED_HEIGHT) > MAX_DRIFT_PX) failures.push(`mobile: header is ${mobileBar.height.toFixed(2)}px tall, expected ${EXPECTED_HEIGHT}px`)
    if (mobileBar.horizontalOverflow) failures.push(`mobile: horizontal scrollbar at ${MOBILE_VIEWPORT.width}px`)
  }
  if (barCount !== 1) failures.push(`mobile: ${barCount} headers in the DOM, expected exactly 1`)
  if (!hamburgerVisible) failures.push('mobile: the drawer hamburger is not visible in the header')
  const drawerOpened = await (async () => {
    await page.click(MENU)
    await new Promise(r => setTimeout(r, SETTLE_MS))
    return page.evaluate(() => !!document.querySelector('[data-sidebar-drawer]'))
  })()
  console.log(`mobile: clicking the hamburger opens the drawer: ${drawerOpened}`)
  if (!drawerOpened) failures.push('mobile: the header hamburger does not open the drawer')
  // Same button, the other effect — and the drawer carries no floating toggle of its
  // own any more: it closes on the veil.
  const drawerToggles = await page.evaluate(s2 => document.querySelectorAll(s2).length, EDGE_TOGGLE)
  if (drawerToggles) failures.push(`mobile: ${drawerToggles} floating collapse button(s) in the open drawer`)
  await page.evaluate(() => document.querySelector('[data-sidebar-drawer] > div')?.click())
  await new Promise(r => setTimeout(r, SETTLE_MS))
  const drawerClosed = await page.evaluate(() => !document.querySelector('[data-sidebar-drawer]'))
  console.log(`mobile: floating toggles in the drawer=${drawerToggles}, one click on the veil closes it: ${drawerClosed}`)
  if (!drawerClosed) failures.push('mobile: one click on the veil does not close the drawer')

  // --- At 390 px no clickable box of the header overlaps its neighbour, and a REAL tap
  // on the overflow button opens a menu that names the 10 actions, on screen ---
  const boxes = await page.evaluate(sel => [...document.querySelectorAll(sel)]
    .map(el => {
      const r = el.getBoundingClientRect()
      return { name: el.dataset.omnibarMenu !== undefined ? 'menu'
        : el.dataset.omnibarAction ?? (el.dataset.mailToolbarMore !== undefined ? 'more'
        : el.dataset.omnibarSearch !== undefined ? 'search' : 'user'),
        x: r.x, y: r.y, w: r.width, h: r.height }
    })
    .filter(b => b.w > 0 && b.h > 0), HEADER_BOXES)
  for (const [i, a] of boxes.entries()) {
    for (const b of boxes.slice(i + 1)) {
      // Real horizontal gap between two boxes; negative = they overlap.
      const gapX = Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w)
      const gapY = Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h)
      if (gapX < MIN_HIT_GAP_PX && gapY < MIN_HIT_GAP_PX)
        failures.push(`mobile: « ${a.name} » et « ${b.name} » ne laissent que ${Math.max(gapX, gapY).toFixed(1)}px d'écart (plancher ${MIN_HIT_GAP_PX}px)`)
    }
  }
  console.log(`mobile: ${boxes.length} boîtes cliquables mesurées : ${boxes.map(b => `${b.name} ${b.w.toFixed(0)}×${b.h.toFixed(0)}@${b.x.toFixed(0)}`).join(' | ')}`)

  const moreBox = boxes.find(b => b.name === 'more')
  if (!moreBox) failures.push(`mobile: no « … » button at ${MOBILE_VIEWPORT.width}px, although the toolbar cannot fit`)
  else {
    if (Math.abs(moreBox.w - MORE_BUTTON_PX) > MAX_DRIFT_PX)
      failures.push(`mobile: the « … » button is ${moreBox.w.toFixed(1)}px wide, the ACTION template says ${MORE_BUTTON_PX}px — it is being crushed`)
    // A REAL tap (touch), not a programmatic `click()`: that is the gesture under test.
    await page.tap('[data-mail-toolbar-more]')
    await new Promise(r => setTimeout(r, SETTLE_MS))
    const menu = await page.evaluate(() => {
      const box = document.querySelector('[data-mail-toolbar-more-menu]')
      if (!box) return null
      const r = box.getBoundingClientRect()
      return {
        actions: [...box.querySelectorAll('[data-mail-action]')].map(b => b.dataset.mailAction),
        inside: r.left >= 0 && r.right <= document.documentElement.clientWidth
          && r.top >= 0 && r.bottom <= document.documentElement.clientHeight,
        rect: { x: r.x, y: r.y, w: r.width, h: r.height },
      }
    })
    if (!menu) failures.push('mobile: a real tap on « … » opened no menu')
    else {
      console.log(`mobile: tap « … » -> ${menu.actions.length} actions (${menu.actions.join(',')}), entirely on screen=${menu.inside}`)
      if (menu.actions.join(',') !== TOOLBAR_ORDER.join(','))
        failures.push(`mobile: the « … » menu lists ${menu.actions.join(',')}, MAIL_TOOLBAR_GROUPS declares ${TOOLBAR_ORDER.join(',')}`)
      if (!menu.inside) failures.push(`mobile: the « … » menu leaves the screen (${JSON.stringify(menu.rect)})`)
    }
    await page.keyboard.press('Escape')
    await new Promise(r => setTimeout(r, SETTLE_MS))
  }

  // --- Settings, accounts, theme and language all live in the omnibar ---
  await page.setViewport(VIEWPORT)
  await page.goto(`${BASE}/mail`, { waitUntil: 'networkidle2' })
  await page.waitForSelector(SEARCH, { timeout: 20000 })
  await new Promise(r => setTimeout(r, SETTLE_MS))

  /**
   * Clears the field, types `text`, and returns what the panel then proposes.
   *
   * The wait after clearing is not decorative: clearing triggers the debounced search
   * (SEARCH_DEBOUNCE_MS), hence a navigation that REALIGNS the field on the URL. Typing
   * before it has happened would let that navigation wipe the input, and the harness
   * would measure its own race instead of the product.
   */
  const typeInOmnibar = async text => {
    await page.click(SEARCH)
    // Cleared character by character: as observed, a triple-click followed by a
    // Backspace (like a Cmd+A) deletes only ONE character in this headless Chrome, and
    // the typed strings piled up on each other, which made the harness fail on its own
    // input rather than on the product.
    const length = await page.$eval(SEARCH, el => el.value.length)
    for (let i = 0; i < length; i++) await page.keyboard.press('Backspace')
    await new Promise(r => setTimeout(r, SEARCH_SETTLE_MS))
    await page.type(SEARCH, text, { delay: 20 })
    await new Promise(r => setTimeout(r, 250))
    return page.evaluate(sel => {
      const panel = document.querySelector(sel)
      if (!panel) return null
      const rows = [...panel.querySelectorAll('[data-omnibar-entry]')]
      return {
        ids: rows.map(r => r.dataset.omnibarEntry),
        labels: rows.map(r => r.textContent.trim()),
        sections: [...panel.querySelectorAll('[data-omnibar-section]')].map(d => d.dataset.omnibarSection),
        // The panel must match the field width exactly and stay on screen.
        sameWidthAsField: (() => {
          const f = document.querySelector('[data-omnibar-search]')
          if (!f) return null
          const a = panel.getBoundingClientRect(); const b = f.getBoundingClientRect()
          return Math.abs(a.width - b.width) <= 2 && a.bottom <= document.documentElement.clientHeight
        })(),
      }
    }, PANEL)
  }

  // (1) "api" proposes the API-keys entry, and nothing else on the settings side.
  const apiPanel = await typeInOmnibar('api')
  if (!apiPanel) failures.push('H3f: typing « api » opened no panel')
  else {
    console.log(`H3f: « api » -> ${apiPanel.ids.join(' | ')}`)
    if (!apiPanel.ids.includes(SETTINGS_ENTRY_API)) failures.push(`H3f: « api » does not propose ${SETTINGS_ENTRY_API} (got ${apiPanel.ids.join(',')})`)
    if (apiPanel.ids[apiPanel.ids.length - 1] !== 'search') failures.push('H3f: the mail-search row is not last in the panel')
    if (apiPanel.sameWidthAsField === false) failures.push('H3f: the panel does not match the field width / leaves the screen')
  }

  // (2) Arrow down + Enter goes to the page, NOT to /mail?q=api.
  await page.keyboard.press('ArrowDown')
  await new Promise(r => setTimeout(r, 150))
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}),
    page.keyboard.press('Enter'),
  ])
  await new Promise(r => setTimeout(r, SETTLE_MS))
  const apiLanding = new URL(page.url()).pathname
  console.log(`H3f: ArrowDown + Enter on « api » -> ${apiLanding}`)
  if (apiLanding !== API_KEYS_HREF) failures.push(`H3f: choosing the API entry landed on ${apiLanding}, expected ${API_KEYS_HREF}`)

  // (3) The DEFAULT behaviour is unchanged: Enter with no choice searches the mail.
  await page.goto(`${BASE}/mail`, { waitUntil: 'networkidle2' })
  await page.waitForSelector(SEARCH, { timeout: 20000 })
  await new Promise(r => setTimeout(r, SETTLE_MS))
  await typeInOmnibar('api')
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}),
    page.keyboard.press('Enter'),
  ])
  await new Promise(r => setTimeout(r, SETTLE_MS))
  const searchLanding = new URL(page.url())
  console.log(`H3f: Enter with no selection -> ${searchLanding.pathname}?${searchLanding.searchParams}`)
  if (searchLanding.pathname !== '/mail' || searchLanding.searchParams.get('q') !== 'api')
    failures.push(`H3f: plain Enter landed on ${searchLanding.pathname}?${searchLanding.searchParams} instead of /mail?q=api`)

  // (4) Every entry of the settings navigation is findable by its label, in the current
  //     language — the list comes from SETTINGS_NAV, not from a copy.
  await page.goto(`${BASE}/mail`, { waitUntil: 'networkidle2' })
  await page.waitForSelector(SEARCH, { timeout: 20000 })
  await new Promise(r => setTimeout(r, SETTLE_MS))
  const activeLocale = await page.evaluate(() => document.documentElement.lang || 'en')
  // The expected labels are those of the language the page ACTUALLY renders: the harness
  // does not assume English, it reads `<html lang>` then the matching locale file.
  if (!LOCALE_CODES.includes(activeLocale)) { console.error(`HARNESS: the page renders lang="${activeLocale}", which lib/locales does not declare`); process.exit(2) }
  const LABELS = JSON.parse(readFileSync(new URL(`../locales/${activeLocale}.json`, import.meta.url), 'utf8')).settings.nav
  const notFound = []
  for (const key of SETTINGS_NAV_KEYS) {
    const panel = await typeInOmnibar(LABELS[key])
    if (!panel?.ids.includes(`settings:${key}`)) notFound.push(`${key} (« ${LABELS[key]} »)`)
  }
  console.log(`H3f: ${SETTINGS_NAV_KEYS.length - notFound.length}/${SETTINGS_NAV_KEYS.length} settings entries found by their ${activeLocale} label`)
  if (notFound.length) failures.push(`H3f: settings entries not findable by their label: ${notFound.join(', ')}`)

  // (5) The theme surfaces, and the action REALLY changes the theme (not just a row).
  const themeWord = LABELS.appearance
  const themePanel = await typeInOmnibar(themeWord)
  console.log(`H3f: « ${themeWord} » -> ${themePanel?.ids.join(' | ')}`)
  if (!themePanel?.ids.includes('settings:appearance'))
    failures.push(`H3f: « ${themeWord} » does not propose the appearance settings`)

  const darkBefore = await page.evaluate(() => document.documentElement.classList.contains('dark'))
  const themeActionPanel = await typeInOmnibar('dark')
  const darkEntry = themeActionPanel?.ids.find(id => id === 'action:theme-dark')
  if (!darkEntry) failures.push(`H3f: « dark » proposes no dark-theme action (got ${themeActionPanel?.ids.join(',')})`)
  else {
    await page.click(`[data-omnibar-entry="action:theme-dark"]`)
    await new Promise(r => setTimeout(r, SETTLE_MS))
    const darkAfter = await page.evaluate(() => document.documentElement.classList.contains('dark'))
    console.log(`H3f: dark theme from the omnibar — before=${darkBefore}, after=${darkAfter}, still on ${new URL(page.url()).pathname}`)
    if (!darkAfter) failures.push('H3f: choosing « dark theme » in the omnibar did not darken the page')
    if (new URL(page.url()).pathname !== '/mail') failures.push('H3f: choosing a theme navigated away from the mailbox')
  }

  // (5b) What the input NAMES comes out first, and the KEYBOARD really applies it.
  // Observed before the fix: the word for "dark" proposed the light theme first (the
  // three modes shared one keyword list), so the first arrow + Enter LIGHTENED the page
  // instead of darkening it.
  for (const [word, wanted] of [['sombre', 'action:theme-dark'], ['clair', 'action:theme-light']]) {
    const ranked = await typeInOmnibar(word)
    console.log(`H3f: « ${word} » -> ${ranked?.ids.join(' | ')}`)
    if (ranked?.ids[0] !== wanted)
      failures.push(`H3f: « ${word} » proposes ${ranked?.ids[0]} first, expected ${wanted}`)
  }
  // Back to light first, so that darkening is a REAL change.
  await page.click('[data-omnibar-entry="action:theme-light"]')
  await new Promise(r => setTimeout(r, SETTLE_MS))
  const beforeKeyboard = await page.evaluate(() => document.documentElement.classList.contains('dark'))
  await typeInOmnibar('sombre')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await new Promise(r => setTimeout(r, SETTLE_MS))
  const afterKeyboard = await page.evaluate(() => document.documentElement.classList.contains('dark'))
  console.log(`H3f: « sombre » + ArrowDown + Enter — dark before=${beforeKeyboard}, after=${afterKeyboard}`)
  if (beforeKeyboard) failures.push('H3f: the light-theme entry did not lighten the page before the keyboard measurement')
  if (!afterKeyboard) failures.push('H3f: « sombre » + ArrowDown + Enter did not darken the page')

  // (6) The language is also a row of the account menu, with the 3 declared languages.
  await page.click(USER_TRIGGER)
  await new Promise(r => setTimeout(r, SETTLE_MS))
  const langRow = await page.evaluate(() => {
    const row = document.querySelector('[data-user-menu-item="language"]')
    if (!row) return null
    const buttons = [...row.querySelectorAll('[data-user-menu-language]')]
    return {
      codes: buttons.map(b => b.dataset.userMenuLanguage),
      pressed: buttons.filter(b => b.getAttribute('aria-pressed') === 'true').map(b => b.dataset.userMenuLanguage),
    }
  })
  console.log(`H3f: user menu language row -> ${langRow ? langRow.codes.join(',') : 'ABSENT'} (active: ${langRow?.pressed.join(',')})`)
  if (!langRow) failures.push('H3f: the user menu has no language row')
  else {
    if (langRow.codes.join(',') !== LOCALE_CODES.join(','))
      failures.push(`H3f: the language row lists ${langRow.codes.join(',')}, lib/locales declares ${LOCALE_CODES.join(',')}`)
    if (langRow.pressed.length !== 1)
      failures.push(`H3f: the language row marks ${langRow.pressed.length} active languages, expected exactly 1`)
  }
  await page.keyboard.press('Escape')
  await new Promise(r => setTimeout(r, SETTLE_MS))

  // (7) The panel closes on Escape, and the field keeps what was typed.
  await typeInOmnibar('api')
  await page.keyboard.press('Escape')
  await new Promise(r => setTimeout(r, 250))
  const afterEscape = await page.evaluate(sel => ({
    panel: !!document.querySelector(sel),
    value: document.querySelector('[data-omnibar-search]')?.value,
  }), PANEL)
  console.log(`H3f: Escape -> panel present=${afterEscape.panel}, field="${afterEscape.value}"`)
  if (afterEscape.panel) failures.push('H3f: Escape did not close the panel')
  if (afterEscape.value !== 'api') failures.push(`H3f: Escape also cleared the field ("${afterEscape.value}"), it should only close the panel`)

  // --- Sign out, LAST: it invalidates the session every check above needs ---
  await page.setViewport(VIEWPORT)
  await page.goto(`${BASE}/mail`, { waitUntil: 'networkidle2' })
  await page.waitForSelector(USER_TRIGGER, { timeout: 20000 })
  await new Promise(r => setTimeout(r, SETTLE_MS))
  const pathBeforeSignOut = new URL(page.url()).pathname
  if (pathBeforeSignOut.startsWith('/login')) { console.error('HARNESS: already signed out before clicking sign out — nothing measured'); process.exit(2) }
  await page.click(USER_TRIGGER)
  await new Promise(r => setTimeout(r, SETTLE_MS))
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), page.click(userItem('signout'))])
  await new Promise(r => setTimeout(r, SETTLE_MS * 2))
  const afterSignOut = new URL(page.url()).pathname
  console.log(`sign out: ${pathBeforeSignOut} -> ${afterSignOut}`)
  if (!afterSignOut.startsWith('/login')) failures.push(`signing out landed on ${afterSignOut}, not the login page`)
  // And the session really is gone: a fresh visit to the mailbox must not render it.
  await page.goto(`${BASE}/mail`, { waitUntil: 'networkidle2' })
  await new Promise(r => setTimeout(r, SETTLE_MS))
  const afterRevisit = new URL(page.url()).pathname
  console.log(`after signing out, visiting /mail -> ${afterRevisit}`)
  if (afterRevisit.startsWith('/mail')) failures.push('after signing out, /mail still renders — the session was not cleared')
} finally {
  await browser.close()
}

if (failures.length) {
  console.error(`\ncheck-omnibar: ${failures.length} failure(s)`)
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(1)
}
console.log('\ncheck-omnibar: OK')
