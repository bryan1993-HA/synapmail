#!/usr/bin/env node
/**
 * Self-check of the message IDENTITY contract (`lib/mailOrigin.ts`): a message is
 * the triplet (account, folder, uid), and a selection spanning several folders
 * produces ONE grouped request per (account, folder).
 *
 * No network, no server, no account: the file under test is imported directly.
 *
 *   node --experimental-strip-types scripts/check-mail-origin.mjs
 */
const { originKey, parseOriginKey, sameOrigin, groupByOrigin } =
  await import(new URL('../lib/mailOrigin.ts', import.meta.url).href)

let failed = 0
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) { console.log(`  ok   ${label}`); return }
  console.error(`  FAIL ${label}\n       expected ${e}\n       got      ${a}`)
  failed++
}

const o = (accountId, folder, uid) => ({ accountId, folder, uid })

console.log('originKey')
check('same uid in two folders yields two keys',
  originKey(o('a', 'INBOX', '3231')) === originKey(o('a', 'Sent', '3231')), false)
check('same uid in two accounts yields two keys',
  originKey(o('a', 'INBOX', '3231')) === originKey(o('b', 'INBOX', '3231')), false)
check('a folder containing the separator cannot forge another key',
  originKey(o('a', 'IN|BOX', '1')) === originKey(o('a', 'IN', 'BOX|1')), false)
check('round trip keeps the triplet', parseOriginKey(originKey(o('a', 'Objets envoyés', '7'))),
  o('a', 'Objets envoyés', '7'))
check('a key missing a part is refused', parseOriginKey('a|INBOX'), null)
check('an empty part is refused', parseOriginKey('a||7'), null)

console.log('sameOrigin')
check('identical triplets match', sameOrigin(o('a', 'INBOX', '1'), o('a', 'INBOX', '1')), true)
check('folder alone differs', sameOrigin(o('a', 'INBOX', '1'), o('a', 'Sent', '1')), false)

console.log('groupByOrigin')
check('one folder yields one request',
  groupByOrigin([o('a', 'INBOX', '1'), o('a', 'INBOX', '2')]),
  [{ accountId: 'a', folder: 'INBOX', uids: ['1', '2'] }])
check('two folders yield two requests, each with its own uids',
  groupByOrigin([o('a', 'INBOX', '1'), o('a', 'Sent', '3231'), o('a', 'INBOX', '2')]),
  [{ accountId: 'a', folder: 'INBOX', uids: ['1', '2'] },
   { accountId: 'a', folder: 'Sent', uids: ['3231'] }])
check('two accounts never share a request',
  groupByOrigin([o('a', 'INBOX', '1'), o('b', 'INBOX', '1')]),
  [{ accountId: 'a', folder: 'INBOX', uids: ['1'] },
   { accountId: 'b', folder: 'INBOX', uids: ['1'] }])
check('the same uid in two folders is NOT merged',
  groupByOrigin([o('a', 'INBOX', '3231'), o('a', 'Sent', '3231')]).length, 2)
check('an exact duplicate is sent once',
  groupByOrigin([o('a', 'INBOX', '1'), o('a', 'INBOX', '1')]),
  [{ accountId: 'a', folder: 'INBOX', uids: ['1'] }])
check('group order follows first appearance',
  groupByOrigin([o('a', 'Sent', '9'), o('a', 'INBOX', '1')]).map(g => g.folder), ['Sent', 'INBOX'])
check('an incomplete origin is dropped, never sent with a wrong folder',
  groupByOrigin([o('a', '', '1'), o('a', 'INBOX', '2')]),
  [{ accountId: 'a', folder: 'INBOX', uids: ['2'] }])
check('an empty selection sends nothing', groupByOrigin([]), [])

if (failed) { console.error(`\n${failed} check(s) failed`); process.exit(1) }
console.log('\ncheck-mail-origin: OK')
