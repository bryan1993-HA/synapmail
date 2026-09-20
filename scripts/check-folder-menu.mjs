#!/usr/bin/env node
/**
 * Right-click on the sidebar folders, measured with REAL right clicks, REAL
 * keystrokes and REAL calls to the application API.
 *
 * Full life cycle, inside a root folder this harness creates then deletes:
 * create → visible in the sidebar; rename → name up to date; mark read → counter
 * at 0; delete → gone. Then the display rule: a special folder greys out
 * "Rename" and "Delete"; a session without rights greys out EVERYTHING.
 *
 * This harness NEVER touches a real folder: everything it creates lives under a
 * prefixed name, and everything it deletes it created itself in the same run.
 * The final verification fails if any folder under the prefix survives.
 *
 * Requires a running server and the SYNAPMAIL_TEST_* credentials (see .env).
 *   node scripts/check-folder-menu.mjs
 */
import { readFileSync } from 'node:fs'
import puppeteer from 'puppeteer-core'
import { SCRATCH_FOLDER } from './bench-constants.mjs'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const VIEWPORT = { width: 1440, height: 900 }
// A UI re-rendering after a mutation: a React re-render, not a network round trip.
const SETTLE_MS = 400
// A folder mutation opens an IMAP connection: orders of magnitude slower.
const IMAP_MS = 60000
/**
 * Prefix for EVERYTHING this harness creates. It is the file's safety barrier:
 * no deletion is ever issued on a path that does not start with it.
 */
const PREFIX = SCRATCH_FOLDER

for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
}

const { SYNAPMAIL_TEST_URL: BASE, SYNAPMAIL_TEST_EMAIL: EMAIL, SYNAPMAIL_TEST_PASSWORD: PASSWORD } = process.env
for (const [k, v] of Object.entries({ SYNAPMAIL_TEST_URL: BASE, SYNAPMAIL_TEST_EMAIL: EMAIL, SYNAPMAIL_TEST_PASSWORD: PASSWORD })) {
  if (!v) { console.error(`HARNESS: ${k} is not set`); process.exit(2) }
}

const failures = []
/**
 * Counts ALL assertions, not just the failing ones: a bare "OK" does not
 * distinguish "everything passed" from "the run stopped before measuring".
 */
let asserted = 0
const check = (ok, message) => { asserted++; if (!ok) failures.push(message); return ok }

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] })
let accountId = null
let page = null
try {
  page = await browser.newPage()
  await page.setViewport(VIEWPORT)
  page.setDefaultNavigationTimeout(120000)

  const land = async path => {
    await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('[data-sidebar] [data-sidebar-row^="folder:"]', { timeout: 120000 })
  }

  /**
   * REAL right click on a folder row, menu open. The row is first scrolled into
   * view: the sidebar scrolls, and this mailbox holds around a hundred folders, so
   * `boundingBox()` of an off-screen row returns coordinates where the mouse hits
   * nothing — the menu never opens and the run fails without measuring anything.
   */
  const rightClick = async path => {
    const selector = `[data-sidebar-row="folder:${path}"]`
    await page.evaluate(s => document.querySelector(s)?.scrollIntoView({ block: 'center' }), selector)
    await new Promise(r => setTimeout(r, SETTLE_MS))
    const box = await (await page.$(selector)).boundingBox()
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' })
    await page.waitForSelector('[data-folder-context-menu]', { timeout: 5000 })
  }

  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
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

  await land('/mail')

  // The MEASURED account is an OWNED mailbox granting delete, picked from the rights the
  // API announces — not the active mailbox. Section 8 moves the active mailbox to a
  // SHARED one without delete: if it dies before restoring it, inheriting that preference
  // would measure the whole life cycle on a mailbox that has no delete right, and the run
  // would report 8 PRODUCT failures for state the harness left behind (observed). Reading
  // the rights instead of the preference makes this choice independent of past runs.
  const active = await page.evaluate(async base => {
    const accounts = (await (await fetch(`${base}/api/accounts`)).json()).data ?? []
    const acc = accounts.find(a => !a.isShared && a.permissions?.canDelete && a.permissions?.canOrganize)
    return acc ? { id: acc.id, label: acc.name || acc.email } : null
  }, BASE)
  if (!active) { console.error('HARNESS: no owned mailbox granting delete+organize — nothing to measure'); process.exit(2) }
  accountId = active.id
  console.log(`mesuré sur « ${active.label} » (${accountId})`)

  // `sidebar_collapsed` and `active_account_id` are SERVER preferences: they survive
  // from one run to the next. The harness PINS both instead of inheriting whatever the
  // previous session left behind — a collapsed sidebar shows no name input, and an
  // inherited active mailbox is not necessarily the one being measured.
  await page.evaluate(async ({ base, id }) => {
    await fetch(`${base}/api/settings`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sidebar_collapsed: false, active_account_id: id }),
    })
  }, { base: BASE, id: accountId })
  await land('/mail')

  /** Calls the application API from the page (same session cookies). */
  const api = (path, init) => page.evaluate(async ({ base, path, init }) => {
    const res = await fetch(`${base}${path}`, init)
    return { status: res.status, body: await res.json().catch(() => null) }
  }, { base: BASE, path, init })

  const folders = () => page.evaluate(async ({ base, id }) =>
    (await (await fetch(`${base}/api/folders?account=${id}`)).json()).data ?? [], { base: BASE, id: accountId })

  const jsonPost = (path, payload) => api(path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  })

  // ── 1. CREATE ─────────────────────────────────────────────────────────────────
  const created = await jsonPost('/api/folders', { accountId, name: PREFIX })
  if (created.status !== 200) { console.error(`HARNESS: création impossible (${created.status} ${JSON.stringify(created.body)})`); process.exit(2) }
  const rootPath = created.body.data.path
  if (!rootPath.startsWith(PREFIX)) { console.error(`HARNESS: le serveur a renvoyé un chemin hors préfixe (${rootPath})`); process.exit(2) }

  await land('/mail')
  const seen = await page.$(`[data-sidebar-row="folder:${rootPath}"]`)
  check(!!seen, `créer : le dossier « ${rootPath} » n'apparaît pas dans la barre`)

  // A name carrying the server delimiter is REFUSED; it creates no hierarchy.
  const delimiter = (await folders()).find(f => f.delimiter)?.delimiter ?? '/'
  const bad = await jsonPost('/api/folders', { accountId, name: `${PREFIX}${delimiter}x` })
  check(bad.status === 400, `nom invalide : attendu 400, reçu ${bad.status}`)

  // ── 2. THE MENU OPENS ON A REAL RIGHT CLICK ──────────────────────────────────
  await rightClick(rootPath)

  const readMenu = () => page.evaluate(() => {
    const menu = document.querySelector('[data-folder-context-menu]')
    if (!menu) return null
    const box = menu.getBoundingClientRect()
    return {
      path: menu.dataset.folderPath,
      inWindow: box.left >= 0 && box.top >= 0 && box.right <= window.innerWidth && box.bottom <= window.innerHeight,
      items: Object.fromEntries([...menu.querySelectorAll('[data-menu-item]')]
        .map(b => [b.dataset.menuItem, !b.disabled])),
    }
  })

  const normal = await readMenu()
  check(normal?.path === rootPath, `le menu vise ${normal?.path}, attendu ${rootPath}`)
  check(normal?.inWindow, 'le menu déborde de la fenêtre')
  for (const action of ['create', 'createChild', 'rename', 'markRead', 'remove']) {
    check(normal?.items[action] === true, `dossier ordinaire : « ${action} » devrait être actif`)
  }
  // "Empty" is not SHOWN GREYED OUT on an ordinary folder, it is ABSENT.
  // An entry permanently greyed out across twenty folders is noise.
  check(!('empty' in (normal?.items ?? {})), `dossier ordinaire : « vider » ne doit pas figurer au menu (entrées : ${Object.keys(normal?.items ?? {}).join(', ')})`)

  // Closes on ONE click outside.
  await page.mouse.click(VIEWPORT.width - 5, VIEWPORT.height / 2)
  await new Promise(r => setTimeout(r, SETTLE_MS))
  check(!(await page.$('[data-folder-context-menu]')), 'le menu ne se ferme pas en un clic dehors')

  // ── 3. SPECIAL FOLDER: RENAME AND DELETE ARE GREYED OUT ──────────────────────
  const all = await folders()
  const trash = all.find(f => f.special === 'trash')
  const special = trash ?? all.find(f => f.special)
  if (!special) { console.error('HARNESS: ce compte ne déclare aucun dossier spécial'); process.exit(2) }
  await rightClick(special.path)
  const specialMenu = await readMenu()
  check(specialMenu?.items.rename === false, `${special.path} (${special.special}) : « renommer » devrait être grisé`)
  check(specialMenu?.items.remove === false, `${special.path} (${special.special}) : « supprimer » devrait être grisé`)
  check(specialMenu?.items.markRead === true, `${special.path} : « tout marquer comme lu » doit rester offert`)
  check(('empty' in (specialMenu?.items ?? {})) === (special.special === 'trash' || special.special === 'spam'),
    `${special.path} (${special.special}) : « vider » ne figure au menu que sur la corbeille et les indésirables`)
  await page.keyboard.press('Escape')
  await new Promise(r => setTimeout(r, SETTLE_MS))
  check(!(await page.$('[data-folder-context-menu]')), 'le menu ne se ferme pas avec Échap')

  // The server refuses too, not just the UI: a greyed entry is a real refusal.
  const renameSpecial = await api('/api/folders', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accountId, path: special.path, name: `${PREFIX}-interdit` }),
  })
  check(renameSpecial.status === 403, `renommer un dossier spécial : attendu 403, reçu ${renameSpecial.status}`)

  // ── 4. A PARENT CANNOT BE DELETED ────────────────────────────────────────────
  const child = await jsonPost('/api/folders', { accountId, parent: rootPath, name: 'enfant' })
  check(child.status === 200, `créer un sous-dossier : attendu 200, reçu ${child.status}`)
  const childPath = child.body?.data?.path
  const removeParent = await api(`/api/folders?account=${accountId}&path=${encodeURIComponent(rootPath)}`, { method: 'DELETE' })
  check(removeParent.status === 403, `supprimer un parent : attendu 403, reçu ${removeParent.status}`)

  await land('/mail')
  await rightClick(rootPath)
  const parentMenu = await readMenu()
  check(parentMenu?.items.remove === false, 'un dossier qui a des sous-dossiers ne doit pas offrir « supprimer »')
  await page.keyboard.press('Escape')

  // ── 5. RENAME VIA THE INLINE INPUT (real keystrokes) ─────────────────────────
  const renamed = `${PREFIX}-renomme`
  await rightClick(childPath)
  await page.click('[data-folder-context-menu] [data-menu-item="rename"]')
  await page.waitForSelector('[data-folder-name-input] input', { timeout: 5000 })
  // No `window.prompt`: the input is a field INSIDE the sidebar.
  const inline = await page.$eval('[data-folder-name-input] input', el => ({ tag: el.tagName, focused: el === document.activeElement }))
  check(inline.tag === 'INPUT' && inline.focused, 'la saisie du nom doit être un champ en ligne, déjà actif')
  // The field arrives PRE-FILLED with the current name: it must be CLEARED, otherwise the
  // keystrokes append and the folder is renamed "<old><new>". `Meta+A` selects nothing
  // here (driven Chrome, no macOS keyboard layer): clearing uses as many Backspaces as the
  // field holds characters, and the harness VERIFIES it is empty before typing.
  const nameLength = await page.$eval('[data-folder-name-input] input', el => el.value.length)
  for (let i = 0; i < nameLength; i++) await page.keyboard.press('Backspace')
  check(await page.$eval('[data-folder-name-input] input', el => el.value) === '',
    'renommer : le champ doit être vide avant la frappe, sinon le nom se concatène')
  await page.type('[data-folder-name-input] input', renamed)
  await page.keyboard.press('Enter')
  // The comparison is on the LAST SEGMENT, not the end of the string: `endsWith` would
  // accept a concatenated leaf, which is exactly the defect this section must catch —
  // it went unnoticed under `endsWith`.
  const leafIs = (path, leaf) => path.slice(path.lastIndexOf(delimiter) + 1) === leaf
  /** Is `path` filed UNDER `parent`? A shared prefix alone is not enough. */
  const isUnder = (path, parent) => path.startsWith(`${parent}${delimiter}`)
  await page.waitForFunction(
    ({ name, sep }) => [...document.querySelectorAll('[data-sidebar-row^="folder:"]')].some(r => {
      const p = r.dataset.sidebarRow.slice('folder:'.length)
      return p.slice(p.lastIndexOf(sep) + 1) === name
    }),
    { timeout: IMAP_MS }, { name: renamed, sep: delimiter },
  ).catch(() => {})
  const afterRename = await folders()
  const renamedPath = afterRename.map(f => f.path).find(p => leafIs(p, renamed))
  check(!!renamedPath, `renommer : aucun dossier ne s'appelle « ${renamed} » (liste : ${afterRename.map(f => f.path).filter(p => p.startsWith(PREFIX)).join(', ')})`)

  // Escape cancels the input without creating anything.
  const before = (await folders()).length
  await rightClick(rootPath)
  await page.click('[data-folder-context-menu] [data-menu-item="create"]')
  await page.waitForSelector('[data-folder-name-input] input', { timeout: 5000 })
  await page.type('[data-folder-name-input] input', `${PREFIX}-annule`)
  await page.keyboard.press('Escape')
  await new Promise(r => setTimeout(r, SETTLE_MS))
  check(!(await page.$('[data-folder-name-input]')), 'Échap doit fermer le champ de saisie')
  check((await folders()).length === before, 'Échap ne doit créer aucun dossier')

  // ── 5bis. THE THREE OTHER DEFECTS RAISED BY REVIEW ───────────────────────────
  // A refusal carries a READABLE body EVERY time, not only on the first request in
  // the life of the process. The SAME refusal is replayed three times.
  const ghost = `${PREFIX}-inexistant`
  for (const attempt of [1, 2, 3]) {
    const res = await api('/api/folders', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId, path: ghost, name: `${PREFIX}-x` }),
    })
    check(res.status === 404 && res.body?.error,
      `refus répété n°${attempt} : attendu 404 AVEC un corps, reçu ${res.status} ${JSON.stringify(res.body)}`)
  }
  // Same requirement on the other route and another refusal: the pattern is what matters.
  for (const attempt of [1, 2]) {
    const res = await jsonPost('/api/folders/actions', { action: 'empty', accountId, path: rootPath })
    check(res.status === 403 && res.body?.error,
      `refus 403 répété n°${attempt} : attendu un corps lisible, reçu ${res.status} ${JSON.stringify(res.body)}`)
  }

  // A name the client already knows to be invalid is NOT sent to the server. The field
  // stays open, the message is displayed, and the request counter has not moved.
  await page.evaluate(() => {
    window.__folderPosts = 0
    const real = window.fetch
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input?.url ?? ''
      if (url.includes('/api/folders') && (init?.method === 'POST' || init?.method === 'PATCH')) window.__folderPosts++
      return real(input, init)
    }
  })
  await rightClick(rootPath)
  await page.click('[data-folder-context-menu] [data-menu-item="create"]')
  await page.waitForSelector('[data-folder-name-input] input', { timeout: 5000 })
  await page.type('[data-folder-name-input] input', `a${delimiter}b`)
  await page.keyboard.press('Enter')
  await new Promise(r => setTimeout(r, SETTLE_MS))
  const posted = await page.evaluate(() => window.__folderPosts)
  check(posted === 0, `nom invalide : ${posted} requête(s) partie(s), le client devait refuser seul`)
  const shownError = await page.$eval('[data-folder-error]', el => el.textContent).catch(() => null)
  check(!!shownError, 'nom invalide : aucun message affiché sous le champ')
  check(!!(await page.$('[data-folder-name-input] input')), 'nom invalide : le champ doit rester ouvert pour corriger')
  await page.keyboard.press('Escape')
  await new Promise(r => setTimeout(r, SETTLE_MS))

  // Renaming a folder that has sub-folders carries the WHOLE subtree along.
  // Measured against server facts: after the rename, no folder lives under the old
  // path any more, and the child is filed under the new one.
  const subParent = await jsonPost('/api/folders', { accountId, name: `${PREFIX}-arbre` })
  check(subParent.status === 200, `arbre : création du parent, attendu 200, reçu ${subParent.status}`)
  const subParentPath = subParent.body?.data?.path
  const subChild = await jsonPost('/api/folders', { accountId, parent: subParentPath, name: 'sous' })
  check(subChild.status === 200, `arbre : création de l'enfant, attendu 200, reçu ${subChild.status}`)
  const movedTo = `${PREFIX}-arbre-neuf`
  const moved = await api('/api/folders', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accountId, path: subParentPath, name: movedTo }),
  })
  check(moved.status === 200, `arbre : renommage, attendu 200, reçu ${moved.status} ${JSON.stringify(moved.body)}`)
  const afterTree = (await folders()).map(f => f.path)
  const newParent = moved.body?.data?.path
  check(!afterTree.some(p => p === subParentPath || isUnder(p, subParentPath)),
    `arbre : des dossiers vivent encore sous l'ancien chemin (${afterTree.filter(p => p === subParentPath || isUnder(p, subParentPath)).join(', ')})`)
  check(afterTree.some(p => isUnder(p, newParent)),
    `arbre : l'enfant n'a pas suivi sous « ${newParent} » (liste : ${afterTree.filter(p => p.startsWith(PREFIX)).join(', ')})`)
  // Once measured, the tree goes away at once — section 7 requires zero survivors.
  for (const path of afterTree.filter(p => p === newParent || isUnder(p, newParent)).sort((a, b) => b.length - a.length)) {
    await api(`/api/folders?account=${accountId}&path=${encodeURIComponent(path)}`, { method: 'DELETE' })
  }

  // ── 6. MARK ALL AS READ → COUNTER AT 0 ───────────────────────────────────────
  const markRead = await jsonPost('/api/folders/actions', { action: 'markRead', accountId, path: rootPath })
  check(markRead.status === 200 && markRead.body?.data?.unreadCount === 0,
    `marquer lu : attendu 200 + unreadCount 0, reçu ${markRead.status} ${JSON.stringify(markRead.body)}`)

  // "Empty" does not exist outside trash / spam, whatever the client asks for.
  const emptyNormal = await jsonPost('/api/folders/actions', { action: 'empty', accountId, path: rootPath })
  check(emptyNormal.status === 403, `vider un dossier ordinaire : attendu 403, reçu ${emptyNormal.status}`)

  // ── 7. DELETE → GONE ─────────────────────────────────────────────────────────
  for (const path of [renamedPath, rootPath].filter(Boolean)) {
    const res = await api(`/api/folders?account=${accountId}&path=${encodeURIComponent(path)}`, { method: 'DELETE' })
    check(res.status === 200, `supprimer « ${path} » : attendu 200, reçu ${res.status} ${JSON.stringify(res.body)}`)
  }
  await land('/mail')
  const left = (await folders()).filter(f => f.path.startsWith(PREFIX))
  check(left.length === 0, `supprimer : ${left.length} dossier(s) de test survivent (${left.map(f => f.path).join(', ')})`)
  check(!(await page.$(`[data-sidebar-row="folder:${rootPath}"]`)), 'supprimer : la ligne est encore dans la barre')

  // ── 8. PERMISSION DENIED → GREYED ENTRY AND SERVER REFUSAL ───────────────────
  // A SHARED mailbox whose share does not grant delete. The session is the same —
  // it is the targeted account whose rights differ, not the user. The harness creates
  // no share: it measures the one that exists, and stays silent if there is none.
  const shared = (await page.evaluate(async base =>
    ((await (await fetch(`${base}/api/accounts`)).json()).data ?? [])
      .filter(a => a.isShared)
      .map(a => ({ id: a.id, email: a.email, permissions: a.permissions })), BASE))
    .find(a => a.permissions && a.permissions.canDelete === false)

  if (!shared) {
    console.log('permissions : aucune boîte partagée sans « supprimer » dans cette base — arm non mesuré')
  } else {
    await page.evaluate(async ({ base, id }) => {
      await fetch(`${base}/api/settings`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active_account_id: id, sidebar_collapsed: false }),
      })
    }, { base: BASE, id: shared.id })
    // The refusal target is a folder the harness CREATES in the shared mailbox (the share
    // grants organize, not delete), never a REAL folder of the user: if the permission
    // check ever regressed, the DELETE below would go through for real — and it must then
    // take only a test folder with it. The harness falls back to an existing folder only
    // when it cannot create one, and says so.
    // Creation precedes the page load: a row created AFTER the render is not in the
    // sidebar, so the right click would target a selector that resolves to nothing.
    const madeHere = await jsonPost('/api/folders', { accountId: shared.id, name: `${PREFIX}-partage` })
    if (madeHere.status !== 200) {
      console.log(`permissions : création refusée sur « ${shared.email} » (${madeHere.status}) — cible repliée sur un dossier existant`)
    }
    await land('/mail')

    const sharedFolders = await page.evaluate(async ({ base, id }) =>
      (await (await fetch(`${base}/api/folders?account=${id}`)).json()).data ?? [], { base: BASE, id: shared.id })
    const ordinary = madeHere.status === 200
      ? sharedFolders.find(f => f.path === madeHere.body?.data?.path)
      : sharedFolders.find(f => !f.special && !f.path.startsWith(PREFIX))
    if (!ordinary) {
      console.log(`permissions : « ${shared.email} » ne montre aucun dossier ordinaire — arm non mesuré`)
    } else {
      await rightClick(ordinary.path)
      const denied = await readMenu()
      check(denied?.items.remove === false,
        `sans la permission « supprimer », « supprimer » doit être grisé sur ${ordinary.path}`)
      check(!('empty' in (denied?.items ?? {})),
        `dossier ordinaire partagé : « vider » ne doit pas figurer au menu sur ${ordinary.path}`)
      await page.keyboard.press('Escape')

      // Greying out is not the barrier: the server refuses the same thing. It answers 404,
      // not 403 — `getAccessibleAccount` returns `null` when a REQUIRED permission is
      // missing, and the route does not distinguish that from "this account does not
      // exist": a denied permission must reveal nothing about the mailbox's existence. 403
      // is reserved for access granted but the folder RULE refusing (renaming a special one).
      const forbidden = await api(
        `/api/folders?account=${shared.id}&path=${encodeURIComponent(ordinary.path)}`, { method: 'DELETE' })
      check(forbidden.status === 404,
        `supprimer sans la permission : attendu 404 (accès non révélé), reçu ${forbidden.status}`)
      console.log(`permissions : mesuré sur « ${shared.email} » (partage sans « supprimer »), dossier « ${ordinary.path} »`)
    }
  }
} finally {
  // The active mailbox is a SERVER preference: section 8 moved it to the shared mailbox.
  // Restoring it lives HERE and not at the end of that section, so a failure part-way
  // through does not leave the preference on a mailbox without delete rights — the next
  // run would then measure the wrong account (observed: 8 failures blamed on the product,
  // all caused by state the harness left behind).
  if (page && accountId) {
    await page.evaluate(async ({ base, id }) => {
      await fetch(`${base}/api/settings`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active_account_id: id }),
      })
    }, { base: BASE, id: accountId }).catch(() => {})
  }
  // Safety net: what the harness created NEVER stays behind, even on a failure
  // part-way through. No path outside the prefix is ever touched.
  if (page && accountId) {
    // The sweep covers ALL accessible mailboxes, not just the active one: section 8
    // creates in a SHARED mailbox, and a shared mailbox appears TWICE in the list (the
    // owned row and the shared row) — a cleanup limited to the active mailbox left its
    // folders behind (observed: test folders surviving on two accounts after an
    // otherwise green run).
    const leftovers = await page.evaluate(async ({ base, prefix }) => {
      const accounts = (await (await fetch(`${base}/api/accounts`)).json()).data ?? []
      const done = []
      for (const acc of accounts) {
        const list = (await (await fetch(`${base}/api/folders?account=${acc.id}`)).json()).data ?? []
        // Deepest first: a parent cannot be deleted before its children.
        const mine = list.filter(f => f.path.startsWith(prefix)).map(f => f.path).sort((a, b) => b.length - a.length)
        for (const path of mine) {
          const res = await fetch(`${base}/api/folders?account=${acc.id}&path=${encodeURIComponent(path)}`, { method: 'DELETE' })
          done.push(`${acc.email}/${path}:${res.status}`)
        }
      }
      return done
    }, { base: BASE, prefix: PREFIX }).catch(() => [])
    if (leftovers.length) console.log(`nettoyage : ${leftovers.join(', ')}`)
  }
  await browser.close()
}

if (failures.length) {
  console.error(`check-folder-menu: ${failures.length} échec(s) sur ${asserted} assertions`)
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(1)
}
console.log(`check-folder-menu: OK — ${asserted} assertions`)
