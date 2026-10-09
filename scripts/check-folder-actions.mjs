#!/usr/bin/env node
// Self-check of lib/folderActions.ts — la règle que la route ET le menu appliquent.
//   node --experimental-strip-types scripts/check-folder-actions.mjs
//   node --experimental-strip-types scripts/check-folder-actions.mjs --negative
// NEGATIVE CONTROL (`--negative`): names are judged the OLD way, without the `.` / `..`
// refusal, and descendants the OLD way, on raw strings without NFC (two PR-29 follow-ups).
// The traversal and Unicode assertions MUST then go red: they measure the rule itself.
import assert from 'node:assert/strict'
import {
  folderCapabilities, offeredActions, sanitizeFolderName, joinFolderPath, renamedPath,
  isDescendant, rewritePath, samePath, accountDelimiter, FOLDER_ACTIONS,
} from '../lib/folderActions.ts'

const NEGATIVE = process.argv.includes('--negative')
/** The old rule: everything the shipped one does, minus the traversal refusal. */
const sanitizeOld = (raw, delimiter) => {
  const name = sanitizeFolderName(raw, delimiter)
  if (name !== null) return name
  const trimmed = typeof raw === 'string' ? raw.trim() : ''
  return trimmed === '.' || trimmed === '..' ? trimmed : null
}
const sanitize = NEGATIVE ? sanitizeOld : sanitizeFolderName

const owner = { canOrganize: true, canDelete: true }
const caps = (over) => folderCapabilities({ special: null, hasChildren: false, ...owner, ...over })

// Dossier ordinaire, propriétaire : tout sauf « vider » (réservé Corbeille/Indésirables).
assert.deepEqual(caps(), { create: true, createChild: true, rename: true, markRead: true, empty: false, remove: true })

// Dossier spécial : on ne renomme ni ne supprime ce dont le rôle est déclaré au serveur.
for (const special of ['inbox', 'sent', 'drafts', 'spam', 'trash']) {
  const c = caps({ special })
  assert.equal(c.rename, false, `${special} ne doit pas être renommable`)
  assert.equal(c.remove, false, `${special} ne doit pas être supprimable`)
  assert.equal(c.markRead, true, `${special} reste marquable comme lu`)
}

// « Vider » n'existe QUE pour la corbeille et les indésirables.
assert.equal(caps({ special: 'trash' }).empty, true)
assert.equal(caps({ special: 'spam' }).empty, true)
for (const special of [null, 'inbox', 'sent', 'drafts']) assert.equal(caps({ special }).empty, false)

// Un parent ne se supprime pas tant qu'il a des enfants ; le reste est inchangé.
assert.equal(caps({ hasChildren: true }).remove, false)
assert.equal(caps({ hasChildren: true }).rename, true)

// Session en lecture seule (partage sans droits) : plus rien n'est offert.
const readOnly = folderCapabilities({ special: null, hasChildren: false, canOrganize: false, canDelete: false })
assert.deepEqual(Object.values(readOnly), [false, false, false, false, false, false])

// Partage « organiser » sans « supprimer » : on range, on ne détruit pas.
const organizeOnly = folderCapabilities({ special: 'trash', hasChildren: false, canOrganize: true, canDelete: false })
assert.equal(organizeOnly.create, true)
assert.equal(organizeOnly.empty, false)
assert.equal(organizeOnly.remove, false)

// Noms : le délimiteur du serveur ne passe pas — il créerait une hiérarchie non demandée.
assert.equal(sanitizeFolderName('Factures', '/'), 'Factures')
assert.equal(sanitizeFolderName('  Factures  ', '/'), 'Factures')
assert.equal(sanitizeFolderName('a/b', '/'), null)
assert.equal(sanitizeFolderName('a.b', '.'), null)
assert.equal(sanitizeFolderName('a.b', '/'), 'a.b')      // un point n'est spécial que si c'est LE délimiteur
assert.equal(sanitizeFolderName('a\nb', '/'), null)
assert.equal(sanitizeFolderName('', '/'), null)
assert.equal(sanitizeFolderName('   ', '/'), null)
assert.equal(sanitizeFolderName(null, '/'), null)
assert.equal(sanitizeFolderName('x'.repeat(256), '/'), null)
assert.equal(sanitizeFolderName('x'.repeat(255), '/').length, 255)
assert.equal(sanitizeFolderName('Élodie 王小明 (2026)', '/'), 'Élodie 王小明 (2026)')

// `.` / `..` are directory traversal on a Maildir server (Dovecot, Courier) that maps
// mailbox names onto real paths: refused as a name, whatever the delimiter. A dot
// INSIDE a name stays legal — only the two bare traversal segments are refused.
const traversal = []
for (const delimiter of ['/', '.']) {
  for (const raw of ['.', '..', ' .. ', ' . ']) {
    try { assert.equal(sanitize(raw, delimiter), null, `${JSON.stringify(raw)} with delimiter ${delimiter}`) } catch (e) { traversal.push(e.message) }
  }
}
assert.equal(sanitize('...', '/'), '...')
assert.equal(sanitize('.hidden', '/'), '.hidden')
assert.equal(sanitize('a..b', '/'), 'a..b')
if (NEGATIVE) {
  assert.equal(traversal.length, 8, `SILENT NEGATIVE CONTROL: only ${traversal.length} of 8 traversal assertions fell — the bench measures nothing`)
  console.log(`negative control: ${traversal.length} traversal assertion(s) fell, as expected`)
} else {
  assert.deepEqual(traversal, [], traversal.join('\n'))
}

// Chemins : créer sous un parent, renommer sur place, reconnaître un descendant.
assert.equal(joinFolderPath('', 'Tests', '/'), 'Tests')
assert.equal(joinFolderPath('Archive', 'Tests', '/'), 'Archive/Tests')
assert.equal(joinFolderPath('INBOX', 'Tests', '.'), 'INBOX.Tests')
assert.equal(renamedPath('Archive/Old', 'Neuf', '/'), 'Archive/Neuf')
assert.equal(renamedPath('Old', 'Neuf', '/'), 'Neuf')
assert.equal(renamedPath('INBOX.Old', 'Neuf', '.'), 'INBOX.Neuf')
assert.equal(isDescendant('Archive/Old', 'Archive', '/'), true)
assert.equal(isDescendant('Archive', 'Archive', '/'), false)
assert.equal(isDescendant('ArchiveBis', 'Archive', '/'), false)  // le préfixe seul ne suffit pas

// ── Défaut 3 : « vider » n'est PAS affiché grisé sur les dossiers qu'on ne vide pas.
// Grisé veut dire « ici, mais pas pour vous » ; sur vingt dossiers ordinaires, c'est du bruit.
for (const special of [null, 'inbox', 'sent', 'drafts']) {
  assert.equal(offeredActions(special).includes('empty'), false, `« vider » ne doit pas être proposé sur ${special}`)
}
for (const special of ['trash', 'spam']) {
  assert.equal(offeredActions(special).includes('empty'), true, `« vider » doit être proposé sur ${special}`)
}
// Les autres entrées sont là partout, et dans l'ordre de la source unique.
for (const special of [null, 'inbox', 'trash']) {
  const offered = offeredActions(special)
  assert.deepEqual(offered, FOLDER_ACTIONS.filter(a => offered.includes(a)), 'ordre du menu altéré')
  for (const a of ['create', 'createChild', 'rename', 'markRead', 'remove']) {
    assert.equal(offered.includes(a), true, `${a} doit rester proposé sur ${special}`)
  }
}

// ── Défaut 4 : renommer un parent emmène TOUT son sous-arbre, pas seulement lui.
assert.equal(rewritePath('Archive', 'Archive', 'Archives', '/'), 'Archives')
assert.equal(rewritePath('Archive/2025', 'Archive', 'Archives', '/'), 'Archives/2025')
assert.equal(rewritePath('Archive/2025/Q1', 'Archive', 'Archives', '/'), 'Archives/2025/Q1')
assert.equal(rewritePath('INBOX.Vieux.Sous', 'INBOX.Vieux', 'INBOX.Neuf', '.'), 'INBOX.Neuf.Sous')
// Un chemin étranger au sous-arbre ressort INTACT — un préfixe seul ne suffit pas.
assert.equal(rewritePath('ArchiveBis', 'Archive', 'Archives', '/'), 'ArchiveBis')
assert.equal(rewritePath('Autre/Archive', 'Archive', 'Archives', '/'), 'Autre/Archive')

// ── À consigner : un chemin listé par le serveur peut être en Unicode DÉCOMPOSÉ (NFD).
// Comparer des chaînes brutes laisserait créer un doublon invisible du même dossier.
const nfd = 'Administratif socie\u0301te\u0301'   // « société » décomposé, tel qu'IMAP le liste
const nfc = 'Administratif société'                 // le même nom tapé au clavier
assert.notEqual(nfd, nfc, 'le banc doit bien comparer deux encodages DIFFÉRENTS')
assert.equal(samePath(nfd, nfc), true, 'NFD et NFC désignent le même dossier')
assert.equal(samePath('Archive', 'Archives'), false)

// `isDescendant()` applies the SAME normalisation: a child listed in NFD under a parent
// typed in NFC is still its child — else the parent could be deleted (orphaning it) and
// a rename would skip its cache rewrite. NEGATIVE (`--negative`): the raw-string rule.
const isDesc = NEGATIVE ? (child, parent, d) => child.startsWith(`${parent}${d}`) : isDescendant
const rewrite = NEGATIVE
  ? (path, from, to, d) => path === from ? to : isDesc(path, from, d) ? to + path.slice(from.length) : path
  : rewritePath
const unicode = []
const soft = (label, fn) => { try { fn() } catch (e) { unicode.push(`${label}: ${e.message}`) } }
soft('NFD child of NFC parent', () => assert.equal(isDesc(`${nfd}/2025`, nfc, '/'), true))
soft('NFC child of NFD parent', () => assert.equal(isDesc(`${nfc}/2025`, nfd, '/'), true))
soft('rename rewrites the NFD child', () => assert.equal(rewrite(`${nfd}/2025`, nfc, 'Admin', '/'), 'Admin/2025'))
soft('rename rewrites the folder itself across forms', () => assert.equal(rewrite(nfd, nfc, 'Admin', '/'), 'Admin'))
assert.equal(isDesc(`${nfc}Bis/2025`, nfc, '/'), false, 'a prefix alone is still not a child')
assert.equal(rewrite('Elsewhere/2025', nfc, 'Admin', '/'), 'Elsewhere/2025', 'a path outside the subtree is intact')
if (NEGATIVE) {
  assert.equal(unicode.length, 4, `SILENT NEGATIVE CONTROL: only ${unicode.length} of 4 Unicode assertions fell`)
  console.log(`negative control: ${unicode.length} Unicode assertion(s) fell, as expected`)
} else {
  assert.deepEqual(unicode, [], unicode.join('\n'))
}

// Le délimiteur vient des dossiers eux-mêmes, jamais supposé « / ».
assert.equal(accountDelimiter([{ delimiter: '.' }, { delimiter: '.' }]), '.')
assert.equal(accountDelimiter([{ delimiter: null }, { delimiter: '/' }]), '/')
assert.equal(accountDelimiter([]), '/')

if (NEGATIVE) process.exit(0)
console.log('check-folder-actions: OK')
