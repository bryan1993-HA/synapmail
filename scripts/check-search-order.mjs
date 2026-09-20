#!/usr/bin/env node
/**
 * Self-check for the PURE part of progressive search: the order in which an
 * "all folders" search opens the folders. No network, no database.
 *
 *   node --experimental-strip-types scripts/check-search-order.mjs
 */
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'

registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith('.') && !/\.[a-z]+$/.test(spec)) {
      const url = new URL(`${spec}.ts`, ctx.parentURL)
      if (existsSync(url)) return next(url.href, ctx)
    }
    return next(spec, ctx)
  },
})
const { orderFoldersForSearch, parseNdjsonChunk, accumulateSearchStream, EMPTY_SEARCH_STREAM, SEARCH_RESULT_LIMIT } =
  await import(new URL('../lib/search.ts', import.meta.url).href)

let failed = 0
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected)
  if (a === e) { console.log(`  ok   ${label}`); return }
  console.error(`  FAIL ${label}\n       expected ${e}\n       got      ${a}`)
  failed++
}

console.log('orderFoldersForSearch')

check('inbox comes first, sent second, whatever the input order',
  orderFoldersForSearch([
    { path: 'Archive', messages: 900 },
    { path: 'Sent', specialUse: '\\Sent', messages: 10 },
    { path: 'INBOX', specialUse: '\\Inbox', messages: 5 },
  ]),
  ['INBOX', 'Sent', 'Archive'])

check('a folder with no message at all is never opened',
  orderFoldersForSearch([
    { path: 'Empty', messages: 0 },
    { path: 'Full', messages: 3 },
  ]),
  ['Full'])

check('an unknown message count is kept (only a measured zero excludes)',
  orderFoldersForSearch([{ path: 'Unknown' }, { path: 'Empty', messages: 0 }]),
  ['Unknown'])

check('among plain folders, the freshest known message wins over the biggest',
  orderFoldersForSearch([
    { path: 'Big archive', messages: 5000, lastKnownDate: '2019-01-01T00:00:00Z' },
    { path: 'Small but live', messages: 12, lastKnownDate: '2026-09-01T00:00:00Z' },
  ]),
  ['Small but live', 'Big archive'])

check('with no date known anywhere, the biggest folder goes first',
  orderFoldersForSearch([
    { path: 'Small', messages: 3 },
    { path: 'Big', messages: 300 },
  ]),
  ['Big', 'Small'])

check('a dated folder outranks an undated one',
  orderFoldersForSearch([
    { path: 'Undated', messages: 900 },
    { path: 'Dated', messages: 2, lastKnownDate: '2026-01-01T00:00:00Z' },
  ]),
  ['Dated', 'Undated'])

check('an unparsable date is treated as unknown, not as now',
  orderFoldersForSearch([
    { path: 'Broken', messages: 2, lastKnownDate: 'not a date' },
    { path: 'Dated', messages: 2, lastKnownDate: '2020-01-01T00:00:00Z' },
  ]),
  ['Dated', 'Broken'])

check('ties break on the path, so the order is stable across runs',
  orderFoldersForSearch([{ path: 'b', messages: 5 }, { path: 'a', messages: 5 }]),
  ['a', 'b'])

check('the input array is not mutated',
  (() => {
    const input = [{ path: 'b', messages: 1 }, { path: 'a', messages: 1 }]
    orderFoldersForSearch(input)
    return input.map(f => f.path)
  })(),
  ['b', 'a'])

check('no folder at all yields no folder', orderFoldersForSearch([]), [])

console.log('parseNdjsonChunk')

check('a whole line yields its object and leaves nothing pending',
  parseNdjsonChunk('', '{"folder":"INBOX","total":3}\n'),
  { items: [{ folder: 'INBOX', total: 3 }], pending: '' })

check('a truncated line is held back until its end arrives',
  parseNdjsonChunk('', '{"folder":"INBOX"}\n{"fol'),
  { items: [{ folder: 'INBOX' }], pending: '{"fol' })

check('the held-back start is joined to the next chunk',
  parseNdjsonChunk('{"fol', 'der":"Sent"}\n'),
  { items: [{ folder: 'Sent' }], pending: '' })

check('several lines in one chunk come out in order',
  parseNdjsonChunk('', '{"n":1}\n{"n":2}\n{"n":3}\n').items,
  [{ n: 1 }, { n: 2 }, { n: 3 }])

check('blank lines are skipped, not turned into objects',
  parseNdjsonChunk('', '\n\n{"n":1}\n').items, [{ n: 1 }])

check('a line cut mid-stream is dropped rather than throwing',
  parseNdjsonChunk('', '{"broken\n{"n":1}\n').items, [{ n: 1 }])

console.log('accumulateSearchStream')

// A folder yields messages: they accumulate, the totals add up, and the progress
// keeps the latest state announced by the server.
const chunk = (folder, uids, total, searched, folders) => ({
  folder, total, searched, folders,
  messages: uids.map(uid => ({ folder, uid, date: new Date(2026, 0, uid).toISOString() })),
})

check('a chunk adds its messages and its share of the total',
  (({ messages, ...rest }) => ({ uids: messages.map(m => m.uid), ...rest }))(
    accumulateSearchStream(EMPTY_SEARCH_STREAM, [chunk('INBOX', [2, 1], 7, 1, 40)])),
  { uids: [2, 1], total: 7, searched: 1, folders: 40 })

check('totals add up across chunks, progress is the latest value',
  (({ messages, ...rest }) => rest)(
    accumulateSearchStream(
      accumulateSearchStream(EMPTY_SEARCH_STREAM, [chunk('INBOX', [1], 7, 1, 40)]),
      [chunk('Sent', [2], 5, 2, 40)])),
  { total: 12, searched: 2, folders: 40 })

check('the same message seen twice is kept once',
  accumulateSearchStream(
    accumulateSearchStream(EMPTY_SEARCH_STREAM, [chunk('INBOX', [1], 1, 1, 2)]),
    [chunk('INBOX', [1], 1, 2, 2)]).messages.length,
  1)

check('the same uid in two folders is not a duplicate',
  accumulateSearchStream(EMPTY_SEARCH_STREAM, [chunk('INBOX', [1], 1, 1, 2), chunk('Sent', [1], 1, 2, 2)])
    .messages.length,
  2)

check('a chunk carrying an error contributes nothing',
  accumulateSearchStream(EMPTY_SEARCH_STREAM, [{ folder: 'Broken', error: 'nope' }]),
  EMPTY_SEARCH_STREAM)

check('messages come out most recent first, across chunks',
  accumulateSearchStream(
    accumulateSearchStream(EMPTY_SEARCH_STREAM, [chunk('INBOX', [1, 3], 2, 1, 2)]),
    [chunk('Sent', [2], 1, 2, 2)]).messages.map(m => m.uid),
  [3, 2, 1])

// The point the review insisted on: with no cap, a broad query pushed thousands of
// rows into a non-virtualised list and `total > messages.length` stayed false — so
// the banner never said "first X of N".
const flood = accumulateSearchStream(EMPTY_SEARCH_STREAM, [
  chunk('INBOX', Array.from({ length: SEARCH_RESULT_LIMIT * 3 }, (_, i) => i + 1), 9000, 1, 2),
])
check('a flooding chunk is capped at SEARCH_RESULT_LIMIT',
  flood.messages.length, SEARCH_RESULT_LIMIT)

check('the cap keeps the most recent results, not the first received',
  flood.messages[0].uid, SEARCH_RESULT_LIMIT * 3)

check('once capped, the banner can tell the results are truncated',
  flood.total > flood.messages.length, true)

check('the cap holds as chunks keep arriving',
  [1, 2, 3].reduce(
    (state, n) => accumulateSearchStream(state, [
      chunk(`F${n}`, Array.from({ length: SEARCH_RESULT_LIMIT }, (_, i) => i + 1), 500, n, 3),
    ]),
    EMPTY_SEARCH_STREAM).messages.length,
  SEARCH_RESULT_LIMIT)

check('the previous state is never mutated',
  (() => {
    const before = accumulateSearchStream(EMPTY_SEARCH_STREAM, [chunk('INBOX', [1], 1, 1, 2)])
    const snapshot = JSON.stringify(before)
    accumulateSearchStream(before, [chunk('Sent', [2], 1, 2, 2)])
    return JSON.stringify(before) === snapshot
  })(),
  true)

if (failed) { console.error(`\n${failed} check(s) failed`); process.exit(1) }
console.log('\ncheck-search-order: OK')
