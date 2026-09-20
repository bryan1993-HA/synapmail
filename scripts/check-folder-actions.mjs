#!/usr/bin/env node
// Self-check of lib/folderActions.ts — the one rule the route AND the menu both apply.
// node --experimental-strip-types scripts/check-folder-actions.mjs
import assert from 'node:assert/strict'
import {
  folderCapabilities, offeredActions, sanitizeFolderName, joinFolderPath, renamedPath,
  isDescendant, rewritePath, samePath, accountDelimiter, FOLDER_ACTIONS,
} from '../lib/folderActions.ts'

const owner = { canOrganize: true, canDelete: true }
const caps = (over) => folderCapabilities({ special: null, hasChildren: false, ...owner, ...over })

// Ordinary folder, owner session: everything except "empty" (reserved for trash/spam).
assert.deepEqual(caps(), { create: true, createChild: true, rename: true, markRead: true, empty: false, remove: true })

// Special folder: what the server declares a role for is neither renamed nor removed.
for (const special of ['inbox', 'sent', 'drafts', 'spam', 'trash']) {
  const c = caps({ special })
  assert.equal(c.rename, false, `${special} ne doit pas être renommable`)
  assert.equal(c.remove, false, `${special} ne doit pas être supprimable`)
  assert.equal(c.markRead, true, `${special} reste marquable comme lu`)
}

// "Empty" exists ONLY for trash and spam.
assert.equal(caps({ special: 'trash' }).empty, true)
assert.equal(caps({ special: 'spam' }).empty, true)
for (const special of [null, 'inbox', 'sent', 'drafts']) assert.equal(caps({ special }).empty, false)

// A parent cannot be removed while it still has children; nothing else changes.
assert.equal(caps({ hasChildren: true }).remove, false)
assert.equal(caps({ hasChildren: true }).rename, true)

// Read-only session (share without rights): nothing is offered at all.
const readOnly = folderCapabilities({ special: null, hasChildren: false, canOrganize: false, canDelete: false })
assert.deepEqual(Object.values(readOnly), [false, false, false, false, false, false])

// Share with "organize" but not "delete": rearranging is allowed, destroying is not.
const organizeOnly = folderCapabilities({ special: 'trash', hasChildren: false, canOrganize: true, canDelete: false })
assert.equal(organizeOnly.create, true)
assert.equal(organizeOnly.empty, false)
assert.equal(organizeOnly.remove, false)

// Names: the server delimiter is rejected — it would create an unrequested hierarchy.
assert.equal(sanitizeFolderName('Factures', '/'), 'Factures')
assert.equal(sanitizeFolderName('  Factures  ', '/'), 'Factures')
assert.equal(sanitizeFolderName('a/b', '/'), null)
assert.equal(sanitizeFolderName('a.b', '.'), null)
assert.equal(sanitizeFolderName('a.b', '/'), 'a.b')      // a dot is special only when it IS the delimiter
assert.equal(sanitizeFolderName('a\nb', '/'), null)
assert.equal(sanitizeFolderName('', '/'), null)
assert.equal(sanitizeFolderName('   ', '/'), null)
assert.equal(sanitizeFolderName(null, '/'), null)
assert.equal(sanitizeFolderName('x'.repeat(256), '/'), null)
assert.equal(sanitizeFolderName('x'.repeat(255), '/').length, 255)
assert.equal(sanitizeFolderName('Élodie 王小明 (2026)', '/'), 'Élodie 王小明 (2026)')

// Paths: create under a parent, rename in place, recognise a descendant.
assert.equal(joinFolderPath('', 'Tests', '/'), 'Tests')
assert.equal(joinFolderPath('Archive', 'Tests', '/'), 'Archive/Tests')
assert.equal(joinFolderPath('INBOX', 'Tests', '.'), 'INBOX.Tests')
assert.equal(renamedPath('Archive/Old', 'Neuf', '/'), 'Archive/Neuf')
assert.equal(renamedPath('Old', 'Neuf', '/'), 'Neuf')
assert.equal(renamedPath('INBOX.Old', 'Neuf', '.'), 'INBOX.Neuf')
assert.equal(isDescendant('Archive/Old', 'Archive', '/'), true)
assert.equal(isDescendant('Archive', 'Archive', '/'), false)
assert.equal(isDescendant('ArchiveBis', 'Archive', '/'), false)  // a shared prefix alone is not enough

// ── "Empty" is NOT shown greyed out on folders that are never emptied.
// Greyed out reads as "here, but not for you"; across twenty ordinary folders that is noise.
for (const special of [null, 'inbox', 'sent', 'drafts']) {
  assert.equal(offeredActions(special).includes('empty'), false, `« vider » ne doit pas être proposé sur ${special}`)
}
for (const special of ['trash', 'spam']) {
  assert.equal(offeredActions(special).includes('empty'), true, `« vider » doit être proposé sur ${special}`)
}
// The other entries are present everywhere, in the order of the single source.
for (const special of [null, 'inbox', 'trash']) {
  const offered = offeredActions(special)
  assert.deepEqual(offered, FOLDER_ACTIONS.filter(a => offered.includes(a)), 'ordre du menu altéré')
  for (const a of ['create', 'createChild', 'rename', 'markRead', 'remove']) {
    assert.equal(offered.includes(a), true, `${a} doit rester proposé sur ${special}`)
  }
}

// ── Renaming a parent carries its WHOLE subtree along, not just the parent itself.
assert.equal(rewritePath('Archive', 'Archive', 'Archives', '/'), 'Archives')
assert.equal(rewritePath('Archive/2025', 'Archive', 'Archives', '/'), 'Archives/2025')
assert.equal(rewritePath('Archive/2025/Q1', 'Archive', 'Archives', '/'), 'Archives/2025/Q1')
assert.equal(rewritePath('INBOX.Vieux.Sous', 'INBOX.Vieux', 'INBOX.Neuf', '.'), 'INBOX.Neuf.Sous')
// A path outside the subtree comes back UNTOUCHED — a shared prefix alone is not enough.
assert.equal(rewritePath('ArchiveBis', 'Archive', 'Archives', '/'), 'ArchiveBis')
assert.equal(rewritePath('Autre/Archive', 'Archive', 'Archives', '/'), 'Autre/Archive')

// ── Worth recording: a path listed by the server may be in DECOMPOSED Unicode (NFD).
// Comparing raw strings would allow an invisible duplicate of the same folder to be created.
const nfd = 'Administratif socie\u0301te\u0301'   // decomposed form, as IMAP lists it
const nfc = 'Administratif société'                 // the same name as typed on a keyboard
assert.notEqual(nfd, nfc, 'le banc doit bien comparer deux encodages DIFFÉRENTS')
assert.equal(samePath(nfd, nfc), true, 'NFD et NFC désignent le même dossier')
assert.equal(samePath('Archive', 'Archives'), false)

// The delimiter comes from the folders themselves, never assumed to be "/".
assert.equal(accountDelimiter([{ delimiter: '.' }, { delimiter: '.' }]), '.')
assert.equal(accountDelimiter([{ delimiter: null }, { delimiter: '/' }]), '/')
assert.equal(accountDelimiter([]), '/')

console.log('check-folder-actions: OK')
