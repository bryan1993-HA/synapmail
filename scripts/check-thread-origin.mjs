#!/usr/bin/env node
/**
 * PR-29 follow-up: a thread can hold two DIFFERENT messages under the same uid (the
 * inbox copy and the sent copy of one exchange). `ThreadPane` used to key its expanded
 * cards by uid alone, and `MailClient.handleThreadDelete(uid)` filtered and looked the
 * message up by uid alone — so expanding one copy expanded both, and deleting one
 * could delete the other.
 *
 * Pure bench: (1) the contract — `originKey()` from `lib/mailOrigin.ts` tells the two
 * copies apart while the uid does not; (2) the two source files use that key (no
 * `Set` of uids, no `.uid ===` / `.uid !==` lookup on a thread message, the delete
 * callback carries a `MessageOrigin` and the request goes through `messageHref()`).
 *
 *   node --experimental-strip-types scripts/check-thread-origin.mjs
 *   node --experimental-strip-types scripts/check-thread-origin.mjs --negative
 *
 * NEGATIVE CONTROL (`--negative`): the sources are judged as if they still keyed by
 * uid (the old lines are re-injected into a COPY of the text). The bench MUST go red.
 */
import { readFileSync } from 'node:fs'
const { originKey, originOfMessage } = await import(new URL('../lib/mailOrigin.ts', import.meta.url).href)

const NEGATIVE = process.argv.includes('--negative')
const failures = []
const check = (label, ok, detail = '') => {
  if (ok) { console.log(`  ok   ${label}`); return }
  console.error(`  FAIL ${label}${detail ? `\n       ${detail}` : ''}`)
  failures.push(label)
}

// ---- the contract: same uid, two folders, two keys ------------------------------
const inbox = { uid: '3231', accountId: 'acc', folder: 'INBOX', subject: 'Re: quote' }
const sent = { uid: '3231', accountId: 'acc', folder: 'Sent', subject: 'Re: quote' }
check('two thread messages sharing a uid have different origin keys',
  originKey(originOfMessage(inbox)) !== originKey(originOfMessage(sent)))
check('the uid alone cannot tell them apart (that is the defect)', inbox.uid === sent.uid)

// ---- the sources ------------------------------------------------------------------
let pane = readFileSync(new URL('../components/layout/ThreadPane.tsx', import.meta.url), 'utf8')
let client = readFileSync(new URL('../app/(app)/mail/MailClient.tsx', import.meta.url), 'utf8')
if (NEGATIVE) {
  pane = pane.replace(/expandedKeys\.has\(cardKey\(msg\)\)/, 'expandedUids.has(msg.uid)')
  client = client.replace(
    /const remaining = selectedThread\.filter\(m => !sameOrigin\(originOfMessage\(m\), origin\)\)/,
    'const remaining = selectedThread.filter(m => m.uid !== uid)')
}

check('ThreadPane: expanded cards are looked up by origin key, never by uid',
  /expandedKeys\.has\(cardKey\(msg\)\)/.test(pane) && !/expandedUids|\.has\(msg\.uid\)|toggleCard\(msg\.uid\)/.test(pane))
check('ThreadPane: the delete callback carries the full MessageOrigin',
  /onDelete\?: \(origin: MessageOrigin\) => void/.test(pane) && /onDelete\?\.\(\{ accountId, folder, uid \}\)/.test(pane))

const handler = client.split('const handleThreadDelete')[1]?.split('}, [')[0] ?? ''
check('MailClient.handleThreadDelete: takes a MessageOrigin and filters by sameOrigin, not by uid',
  /\(origin: MessageOrigin\)/.test(handler) && /sameOrigin\(originOfMessage\(m\), origin\)/.test(handler)
    && !/m\.uid [!=]== uid|find\(m => m\.uid/.test(handler), handler.slice(0, 300))
check('MailClient.handleThreadDelete: the DELETE request is addressed through messageHref(origin)',
  /fetch\(messageHref\(origin\), \{ method: 'DELETE' \}\)/.test(handler) && !/\/api\/messages\/\$\{uid\}/.test(handler))

if (NEGATIVE) {
  if (failures.length) { console.log(`\nnegative control: ${failures.length} assertion(s) fell, as expected`); process.exit(0) }
  console.error('\nSILENT NEGATIVE CONTROL: uid-keyed sources kept the bench green — it measures nothing')
  process.exit(1)
}
if (failures.length) { console.error(`\n${failures.length} failure(s)`); process.exit(1) }
console.log('\nthread cards keyed by origin: OK')
