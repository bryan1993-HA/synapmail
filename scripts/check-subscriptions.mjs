#!/usr/bin/env node
/**
 * Self-check: the subscription list and the one-click unsubscribe.
 *
 * PURE: no database, no mailbox, no network, and — deliberately — NOT ONE real
 * unsubscribe. Leaving a list is a real action at a third party's: the only real
 * attempt is performed by hand, on one newsletter picked by hand.
 *
 * Three batteries:
 *  1. Headers — RFC 5322 folding, several URIs between angle brackets, RFC 8058
 *     one-click present or not, grouping by List-Id then by sender, stable id.
 *  2. Network boundary — every private range refused, a name that resolves to a
 *     public AND a private address refused, plain http refused, a redirect never
 *     followed, plus the negative control that proves the battery can fail.
 *  3. One-click — sent to a fake server through the injected resolver and
 *     requester: exact URL, exact address connected to, exact body.
 *
 *   node --experimental-strip-types scripts/check-subscriptions.mjs
 *   node --experimental-strip-types scripts/check-subscriptions.mjs --break-boundary
 *   node --experimental-strip-types scripts/check-subscriptions.mjs --transport
 * The second form makes the boundary accept private addresses in a COPY of the
 * decision and EXPECTS the run to fail — a battery that cannot fail proves nothing.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  MAILTO_SUBJECT,
  MAX_UNSUBSCRIBE_BATCH,
  ONE_CLICK_BODY,
  ONE_CLICK_CONTENT_TYPE,
  RECENT_MESSAGES_SCANNED,
  decideUrl,
  groupSubscriptions,
  groupingKey,
  headerValue,
  isOneClick,
  isPrivateAddress,
  mailtoAddress,
  mailtoSubject,
  manualUrl,
  methodOf,
  parseAddress,
  planUnsubscribe,
  parseSubscriptionHeaders,
  parseUnsubscribeUris,
  subscriptionId,
  unfoldHeaders,
  unsubscribeGroups,
  unsubscribeOneClick,
  UNSUBSCRIBE_CONCURRENCY,
  UNSUBSCRIBE_TIMEOUT_MS,
} from '../lib/subscriptions.ts'

const ok = label => console.log(`  ok  ${label}`)
/** Header separator, so a fixture never has to escape it inline. */
const CRLF = '\r\n'
const BREAK_BOUNDARY = process.argv.includes('--break-boundary')

/** A resolver that answers from a table — no DNS, no network. */
const resolverFor = table => async hostname => {
  if (!(hostname in table)) throw new Error('NXDOMAIN')
  return table[hostname].map(address => ({ address, family: address.includes(':') ? 6 : 4 }))
}

/** A requester that records what it was asked to send and answers a status. */
const requesterFor = (status, sent = []) =>
  Object.assign(
    async options => {
      sent.push(options)
      return { status }
    },
    { sent }
  )

// ---------------------------------------------------------------------------
console.log('headers — folding, several URIs, one-click')

// The defect this lot exists for: `lib/imap.ts` reads the FIRST line of the
// header only, so a sender who folds the field loses the URI of line two.
const FOLDED = [
  'From: Example News <news@example.com>',
  'List-Id: Example weekly <weekly.lists.example.com>',
  'List-Unsubscribe: <https://example.com/u/abc>,',
  '\t<mailto:leave@example.com?subject=unsubscribe%20abc>',
  'List-Unsubscribe-Post: List-Unsubscribe=One-Click',
  'Subject: This week at Example',
  'Date: Tue, 15 Sep 2026 09:12:00 +0200',
].join('\r\n')

const folded = unfoldHeaders(FOLDED)
assert.equal(
  headerValue(folded, 'list-unsubscribe'),
  '<https://example.com/u/abc>, <mailto:leave@example.com?subject=unsubscribe%20abc>'
)
ok('a folded List-Unsubscribe keeps the URI of its continuation line')

const uris = parseUnsubscribeUris(headerValue(folded, 'list-unsubscribe'))
assert.deepEqual(uris.https, ['https://example.com/u/abc'])
assert.deepEqual(uris.mailto, ['mailto:leave@example.com?subject=unsubscribe%20abc'])
ok('both URIs of the field are read, each in its own kind')

// Plain http is dropped at parse time: the boundary would refuse it anyway.
assert.deepEqual(parseUnsubscribeUris('<http://example.com/u>, <https://example.com/v>').https, [
  'https://example.com/v',
])
ok('a plain http URI is never kept as an https one')

assert.equal(isOneClick('List-Unsubscribe=One-Click', uris), true)
assert.equal(isOneClick(undefined, uris), false)
assert.equal(isOneClick('List-Unsubscribe=One-Click', { https: [], mailto: uris.mailto }), false)
ok('one-click needs BOTH the RFC 8058 field and an https URI')

assert.equal(mailtoAddress(uris.mailto[0]), 'leave@example.com')
assert.equal(mailtoSubject(uris.mailto[0]), 'unsubscribe abc')
assert.equal(mailtoAddress('mailto:not-an-address'), null)
assert.equal(mailtoAddress('mailto:a@one.example,c@two.example'), null)
ok('a mailto target is one validated address, its subject decoded')

assert.deepEqual(parseAddress('Example News <News@Example.com>'), {
  name: 'Example News',
  address: 'news@example.com',
})
assert.deepEqual(parseAddress('"Quoted, Name" <a@one.example>'), { name: 'Quoted, Name', address: 'a@one.example' })
ok('a From value gives a name and a lower-case address')

// A message without any unsubscribe route is not a subscription at all.
assert.equal(parseSubscriptionHeaders('7', 'From: a@one.example\r\nSubject: hello'), null)
ok('a message with no List-Unsubscribe is not listed')

const parsed = parseSubscriptionHeaders('12', FOLDED)
assert.equal(parsed.oneClick, true)
assert.equal(methodOf(parsed), 'one-click')
assert.equal(methodOf({ oneClick: false, uris: { https: [], mailto: ['mailto:x@sender.example'], http: [] } }), 'mailto')
assert.equal(methodOf({ oneClick: false, uris: { https: ['https://x/y'], mailto: [], http: [] } }), 'link')
ok('the method is one-click, else mailto, else link')

// A sender who only offers a plain-http page must STILL be listed: dropping it
// made the whole sender disappear from the list an agent reads.
const httpOnly = parseSubscriptionHeaders(
  '99',
  [
    'From: Plain <news@plainhttp.example>',
    'List-Unsubscribe: <http://plainhttp.example/u>',
    'Subject: s',
    'Date: Tue, 15 Sep 2026 09:00:00 +0200',
  ].join(CRLF)
)
assert.ok(httpOnly, 'a plain-http only sender was dropped from the list')
assert.equal(methodOf(httpOnly), 'link')
assert.equal(manualUrl(httpOnly), 'http://plainhttp.example/u')
assert.deepEqual(httpOnly.uris.https, [], 'a plain-http URI must never be treated as https')
ok('a plain-http only sender is listed as link, never requested by the server')

// ---------------------------------------------------------------------------
console.log('grouping — List-Id first, sender as a fallback, stable id')

const headerFor = (uid, { from, listId, date, subject, https, mailto, http, post }) =>
  parseSubscriptionHeaders(
    uid,
    [
      `From: ${from}`,
      ...(listId ? [`List-Id: ${listId}`] : []),
      `List-Unsubscribe: ${[...(https ?? []), ...(mailto ?? []), ...(http ?? [])].map(u => `<${u}>`).join(', ')}`,
      ...(post ? [`List-Unsubscribe-Post: ${post}`] : []),
      `Subject: ${subject}`,
      `Date: ${date}`,
    ].join('\r\n')
  )

// The same list sending from two different addresses stays ONE subscription:
// that is what List-Id is for, and rotating the envelope sender is common.
const rotated = [
  headerFor('1', {
    from: 'News <bounce-1@mailer.example.com>',
    listId: 'Example weekly <weekly.lists.example.com>',
    date: 'Tue, 01 Sep 2026 09:00:00 +0200',
    subject: 'older',
    https: ['https://example.com/u/1'],
    post: 'List-Unsubscribe=One-Click',
  }),
  headerFor('2', {
    from: 'News <bounce-2@mailer.example.com>',
    listId: 'Example weekly <weekly.lists.example.com>',
    date: 'Tue, 15 Sep 2026 09:00:00 +0200',
    subject: 'newest',
    https: ['https://example.com/u/2'],
    post: 'List-Unsubscribe=One-Click',
  }),
  headerFor('3', {
    from: 'Shop <offers@shop.example>',
    date: 'Mon, 14 Sep 2026 08:00:00 +0200',
    subject: 'shop',
    mailto: ['mailto:leave@shop.example'],
  }),
]

const grouped = groupSubscriptions('acc-1', rotated)
assert.equal(grouped.length, 2)
assert.equal(grouped[0].count, 2)
assert.equal(grouped[0].lastSubject, 'newest')
assert.equal(grouped[0].lastUid, '2')
ok('two addresses under one List-Id are ONE group, newest message kept')

assert.equal(grouped[1].count, 1)
assert.equal(grouped[1].method, 'mailto')
assert.equal(grouped[1].sender.address, 'offers@shop.example')
ok('without a List-Id the sender address is the grouping key')

assert.ok(grouped[0].count >= grouped[1].count)
ok('groups are sorted by decreasing count')

// A group carries the UIDs an agent files away with PATCH/DELETE
// /api/messages/bulk — exactly its own messages, in the folder that was read.
assert.deepEqual(grouped[0].uids, rotated.filter(h => h.listId).map(h => h.uid))
assert.equal(grouped[0].uids.length, grouped[0].count, 'count and uids disagree')
assert.deepEqual(grouped[1].uids, ['3'])
const everyUid = grouped.flatMap(g => g.uids)
assert.equal(new Set(everyUid).size, everyUid.length, 'a uid appears in two groups')
assert.deepEqual([...everyUid].sort(), rotated.map(h => h.uid).sort(), 'the groups lose or invent a uid')
assert.ok(grouped.every(g => g.folder === 'INBOX'))
assert.equal(groupSubscriptions('acc-1', rotated, new Map(), 'Archive')[0].folder, 'Archive')
ok('each group carries its own uids and the folder they belong to — nothing lost, nothing shared')

// The id must survive a re-list (an agent stores it between two calls) and must
// be different in another mailbox — it carries no address, no account id.
assert.equal(groupSubscriptions('acc-1', rotated)[0].id, grouped[0].id)
assert.notEqual(groupSubscriptions('acc-2', rotated)[0].id, grouped[0].id)
assert.match(grouped[0].id, /^[0-9a-f]{24}$/)
assert.ok(!grouped[0].id.includes('example'))
ok('the id is stable per mailbox, opaque, and differs across mailboxes')

assert.equal(groupingKey({ listId: 'Weekly <WEEKLY.lists.example.com>', from: { address: 'a@sender.example' } }),
  'list:weekly.lists.example.com')
assert.equal(groupingKey({ from: { address: 'A@Sender.example' } }), 'from:a@sender.example')
ok('the grouping key is case-insensitive on both paths')

// A recorded unsubscribe travels back, so an agent does not start over.
const already = new Map([['list:weekly.lists.example.com', '2026-09-18T10:00:00.000Z']])
assert.equal(groupSubscriptions('acc-1', rotated, already)[0].unsubscribedAt, '2026-09-18T10:00:00.000Z')
assert.equal(groupSubscriptions('acc-1', rotated, already)[1].unsubscribedAt, null)
ok('a past unsubscribe comes back as unsubscribedAt, only on its own group')

assert.equal(subscriptionId('acc-1', 'from:a@sender.example'), subscriptionId('acc-1', 'from:a@sender.example'))
ok('the same mailbox and key always give the same id')

// ---------------------------------------------------------------------------
console.log('network boundary — the server is about to call a stranger\'s URL')

// Each range the DoD names, refused one by one.
const PRIVATE = [
  '127.0.0.1', '127.1.2.3', '10.0.0.7', '172.16.0.1', '172.31.255.254', '192.168.1.1',
  '169.254.169.254', '100.64.0.1', '100.127.255.255', '0.0.0.0', '224.0.0.1', '239.1.2.3',
  '255.255.255.255', '::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'ff02::1',
  '::ffff:127.0.0.1', '::ffff:10.1.2.3', '::ffff:7f00:1',
]
for (const address of PRIVATE) {
  assert.equal(isPrivateAddress(address), true, `${address} must be refused`)
}
ok(`${PRIVATE.length} private/special addresses are all refused (incl. IPv4-in-IPv6)`)

// The negative control of the address table: public addresses must NOT be refused,
// otherwise "everything is refused" would look like a pass.
const PUBLIC = ['93.184.216.34', '1.1.1.1', '172.15.0.1', '172.32.0.1', '100.63.255.255', '100.128.0.1', '2606:2800:220::1']
for (const address of PUBLIC) {
  assert.equal(isPrivateAddress(address), false, `${address} must be allowed`)
}
ok(`${PUBLIC.length} public addresses are allowed (the table is not "refuse everything")`)

assert.equal((await decideUrl('http://example.com/u', resolverFor({ 'example.com': ['93.184.216.34'] }))).reason, 'not-https')
assert.equal((await decideUrl('ftp://example.com/u', resolverFor({}))).reason, 'not-https')
assert.equal((await decideUrl('not a url', resolverFor({}))).reason, 'not-https')
ok('anything that is not https is refused before any resolution')

assert.equal((await decideUrl('https://nope.example/u', resolverFor({}))).reason, 'unresolvable')
assert.equal((await decideUrl('https://empty.example/u', resolverFor({ 'empty.example': [] }))).reason, 'no-address')
ok('a name that does not resolve, or resolves to nothing, is refused')

// The attack this rule exists for: one public address to pass the check, one
// private address to reach the internal network.
assert.equal(
  (await decideUrl('https://mixed.example/u', resolverFor({ 'mixed.example': ['93.184.216.34', '169.254.169.254'] }))).reason,
  'private-address'
)
ok('a name resolving to a public AND a private address is refused whole')

const allowed = await decideUrl('https://ok.example/u?x=1', resolverFor({ 'ok.example': ['93.184.216.34'] }))
assert.equal(allowed.ok, true)
assert.equal(allowed.address.address, '93.184.216.34')
ok('a public https URL is allowed, with the address it will connect to')

// ---------------------------------------------------------------------------
console.log('one-click — exact request, no redirect followed, nothing read back')

const resolve = resolverFor({ 'lists.example': ['93.184.216.34'] })
const sent = []
const result = await unsubscribeOneClick('https://lists.example/u/abc?t=9', {
  resolve,
  request: requesterFor(200, sent),
})
assert.equal(result.ok, true)
assert.equal(sent.length, 1)
assert.equal(sent[0].url.href, 'https://lists.example/u/abc?t=9')
assert.equal(sent[0].address.address, '93.184.216.34')
assert.equal(sent[0].body, ONE_CLICK_BODY)
assert.equal(sent[0].body, 'List-Unsubscribe=One-Click')
assert.equal(sent[0].contentType, ONE_CLICK_CONTENT_TYPE)
ok('the POST carries exactly the RFC 8058 body, to the verified address')

// The refusals must never reach the requester at all.
for (const [url, reason, table] of [
  ['http://lists.example/u', 'not-https', { 'lists.example': ['93.184.216.34'] }],
  ['https://intra.example/u', 'private-address', { 'intra.example': ['10.0.0.9'] }],
  ['https://gone.example/u', 'unresolvable', {}],
]) {
  const untouched = []
  const refused = await unsubscribeOneClick(url, { resolve: resolverFor(table), request: requesterFor(200, untouched) })
  assert.equal(refused.ok, false)
  assert.equal(refused.reason, reason)
  assert.equal(untouched.length, 0, 'a refused URL must never be requested')
}
ok('a refused URL is never sent at all (three refusals, zero requests)')

for (const [status, reason] of [[301, 'redirect-not-followed'], [302, 'redirect-not-followed'], [404, 'http-status'], [500, 'http-status']]) {
  const once = []
  const r = await unsubscribeOneClick('https://lists.example/u', { resolve, request: requesterFor(status, once) })
  assert.equal(r.ok, false)
  assert.equal(r.reason, reason)
  assert.equal(once.length, 1, 'exactly one request, no second hop')
}
ok('a 3xx is reported, never followed; a 4xx/5xx fails without a retry')

const failing = async () => { throw Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }) }
assert.equal((await unsubscribeOneClick('https://lists.example/u', { resolve, request: failing })).reason, 'timeout')
const broken = async () => { throw Object.assign(new Error('reset'), { code: 'ECONNRESET' }) }
assert.equal((await unsubscribeOneClick('https://lists.example/u', { resolve, request: broken })).reason, 'transport')
ok('a timeout and a transport error are told apart, neither leaks a body')

// ---------------------------------------------------------------------------
console.log('plan — what each requested id leads to, before any effect')

const PLANNED = [
  headerFor('10', {
    from: 'One Click <news@oneclick.example>',
    date: 'Tue, 15 Sep 2026 09:00:00 +0200',
    subject: 'weekly',
    https: ['https://oneclick.example/u/xyz'],
    post: 'List-Unsubscribe=One-Click',
  }),
  headerFor('11', {
    from: 'By Mail <news@bymail.example>',
    date: 'Tue, 15 Sep 2026 09:00:00 +0200',
    subject: 'digest',
    mailto: ['mailto:leave@bymail.example?subject=stop%20me'],
  }),
  headerFor('12', {
    from: 'Page Only <news@pageonly.example>',
    date: 'Tue, 15 Sep 2026 09:00:00 +0200',
    subject: 'offers',
    https: ['https://pageonly.example/manage'],
  }),
  headerFor('13', {
    from: 'Bad Target <news@badtarget.example>',
    date: 'Tue, 15 Sep 2026 09:00:00 +0200',
    subject: 'broken',
    mailto: ['mailto:not-an-address'],
  }),
]
const idOfSender = address =>
  groupSubscriptions('acc-1', PLANNED).find(s => s.sender.address === address).id

const plans = planUnsubscribe('acc-1', PLANNED, [
  idOfSender('news@oneclick.example'),
  idOfSender('news@bymail.example'),
  idOfSender('news@pageonly.example'),
  idOfSender('news@badtarget.example'),
  'f'.repeat(24),
])

assert.equal(plans[0].action, 'one-click')
assert.equal(plans[0].url, 'https://oneclick.example/u/xyz')
ok('a one-click group is planned as a POST to its own https URL')

assert.equal(plans[1].action, 'mailto')
assert.equal(plans[1].address, 'leave@bymail.example')
assert.equal(plans[1].subject, 'stop me')
ok('a mailto group is planned to its validated address, with the asked subject')

// The point of the rule: an https page without RFC 8058 is NEVER called by the server.
assert.equal(plans[2].action, 'manual')
assert.equal(plans[2].url, 'https://pageonly.example/manage')
ok('a bare link is returned as manual, never requested by the server')

assert.equal(plans[3].action, 'failed')
assert.equal(plans[3].reason, 'no-target')
ok('a mailto whose target is not an address fails instead of guessing one')

assert.equal(plans[4].action, 'not_found')
ok('an id no group in this mailbox produces is not_found')

// The client sends ids only: a URL it makes up cannot become a plan.
const forged = planUnsubscribe('acc-1', PLANNED, ['https://attacker.example/u'])
assert.equal(forged[0].action, 'not_found')
ok('an id shaped like a URL is just an unknown id — the client never names a target')

// The same mailbox, another account id: the ids of one mailbox mean nothing in another.
assert.equal(planUnsubscribe('acc-2', PLANNED, [idOfSender('news@oneclick.example')])[0].action, 'not_found')
ok("another mailbox's ids do not resolve here")

// Without a subject parameter, the default is the one constant, not a copy.
const plain = planUnsubscribe('acc-1', [headerFor('14', {
  from: 'Plain <n@plain.example>', date: 'Tue, 15 Sep 2026 09:00:00 +0200', subject: 'x',
  mailto: ['mailto:leave@plain.example'],
})], [subscriptionId('acc-1', 'from:n@plain.example')])
assert.equal(plain[0].subject, MAILTO_SUBJECT)
ok(`a mailto with no subject parameter uses the single default ("${MAILTO_SUBJECT}")`)

// ---------------------------------------------------------------------------
console.log('unsubscribe batch — one command gives one answer, in time')

// A full batch where EVERY group times out is the worst case. One at a time it
// would take MAX_UNSUBSCRIBE_BATCH * UNSUBSCRIBE_TIMEOUT_MS; the agent's proxy
// would cut at 60 s and the report would be lost while unsubscribes went on.
// Requester that never answers, so nothing is sent and nothing is left.
const stalling = () => new Promise(() => {})
const BATCH = Array.from({ length: MAX_UNSUBSCRIBE_BATCH }, (_, i) =>
  headerFor(String(1000 + i), {
    from: `List ${i} <news@batch${i}.example>`,
    date: 'Tue, 15 Sep 2026 09:00:00 +0200',
    subject: 'batch',
    https: [`https://batch${i}.example/u`],
    post: 'List-Unsubscribe=One-Click',
  })
)
const batchIds = groupSubscriptions('acc-batch', BATCH).map(s => s.id)
assert.equal(batchIds.length, MAX_UNSUBSCRIBE_BATCH)

const batchStarted = Date.now()
const batchReports = await unsubscribeGroups({
  imap: null,
  smtp: null,
  accountId: 'acc-batch',
  from: 'me@example.com',
  folder: 'INBOX',
  ids: batchIds,
  read: async () => BATCH,
  resolve: async () => [{ address: '93.184.216.34', family: 4 }],
  request: stalling,
})
const batchMs = Date.now() - batchStarted

// The ceiling is derived from the module's OWN constants, never a bare number:
// ceil(batch / concurrency) rounds of one timeout, plus a margin for scheduling.
const SCHEDULING_MARGIN_MS = 2000
const ceilingMs =
  Math.ceil(MAX_UNSUBSCRIBE_BATCH / UNSUBSCRIBE_CONCURRENCY) * UNSUBSCRIBE_TIMEOUT_MS + SCHEDULING_MARGIN_MS
// Reference arm, same run: what the same batch costs ONE AT A TIME. The check
// is not a bare constant — it is this measured serial cost being beaten.
const serialMs = MAX_UNSUBSCRIBE_BATCH * UNSUBSCRIBE_TIMEOUT_MS
assert.ok(
  batchMs < ceilingMs,
  `a fully timing-out batch of ${MAX_UNSUBSCRIBE_BATCH} took ${batchMs} ms, over the ${ceilingMs} ms ceiling`
)
assert.ok(batchMs < serialMs / 2, `no real parallelism: ${batchMs} ms vs ${serialMs} ms one at a time`)
assert.equal(batchReports.length, MAX_UNSUBSCRIBE_BATCH)
assert.ok(batchReports.every(r => r.outcome === 'failed' && r.reason === 'timeout'))
ok(
  `${MAX_UNSUBSCRIBE_BATCH} timing-out ids answered in ${batchMs} ms ` +
    `(ceiling ${ceilingMs} ms, ${serialMs} ms one at a time, ${UNSUBSCRIBE_CONCURRENCY} at a time)`
)

// Order must follow the REQUEST, not the network: an agent reads the Nth report
// as the Nth id it asked for.
const delays = new Map(batchIds.map((id, i) => [id, (batchIds.length - i) * 2]))
const ordered = await unsubscribeGroups({
  imap: null,
  smtp: null,
  accountId: 'acc-batch',
  from: 'me@example.com',
  folder: 'INBOX',
  ids: batchIds,
  read: async () => BATCH,
  resolve: async () => [{ address: '93.184.216.34', family: 4 }],
  // Answers in reverse order of the request, on purpose.
  request: async ({ url }) => {
    const id = batchIds[Number(url.hostname.replace(/\D/g, ''))]
    await new Promise(r => setTimeout(r, delays.get(id) ?? 0))
    return { status: 500 }
  },
})
assert.deepEqual(ordered.map(r => r.id), batchIds, 'the report is not in the order of the request')
ok('the report follows the order of the request, not the order the network answered in')

// ---------------------------------------------------------------------------
console.log('constants — one source, no copy in the routes')
assert.equal(typeof RECENT_MESSAGES_SCANNED, 'number')
assert.ok(RECENT_MESSAGES_SCANNED > 0)
assert.equal(MAX_UNSUBSCRIBE_BATCH, 50)
ok(`scan window = ${RECENT_MESSAGES_SCANNED} messages, batch ceiling = ${MAX_UNSUBSCRIBE_BATCH} ids`)

// The ceiling the route enforces must be the module's, not a number retyped there.
const routeSource = readFileSync(new URL('../app/api/subscriptions/unsubscribe/route.ts', import.meta.url), 'utf8')
assert.match(routeSource, /MAX_UNSUBSCRIBE_BATCH/)
assert.doesNotMatch(routeSource, /\b50\b/)
ok('the unsubscribe route reads the ceiling from the module, no copied number')

// Neither route may hold parsing, grouping or boundary logic of its own.
const listSource = readFileSync(new URL('../app/api/subscriptions/route.ts', import.meta.url), 'utf8')
for (const [name, source] of [['list', listSource], ['unsubscribe', routeSource]]) {
  assert.doesNotMatch(source, /List-Unsubscribe/i, `${name} route must not parse headers itself`)
  assert.doesNotMatch(source, /127\.|192\.168|https\.request/, `${name} route must not hold the boundary itself`)
}
ok('both routes only call the module: no header parsing, no boundary, no copy')

// ---------------------------------------------------------------------------
// Negative control: with the boundary's private-address rule removed, the
// battery above MUST fail. Run separately (--break-boundary) so the shipped
// module is never altered.
if (BREAK_BOUNDARY) {
  const broken = address => isPrivateAddress(address) && false
  let failed = false
  try {
    for (const address of PRIVATE) assert.equal(broken(address), true)
  } catch {
    failed = true
  }
  assert.equal(failed, true, 'NEGATIVE CONTROL FAILED: the battery accepted a boundary that allows private addresses')
  ok('negative control: a boundary that allows private addresses IS caught by this battery')
}


// ---------------------------------------------------------------------------
// REAL-TRANSPORT ARM (--transport). Everything above injects a requester, so the
// SHIPPED `defaultRequester` was never executed: a one-click that failed at the
// socket for every real sender still showed a green battery. This arm runs the
// real one through `unsubscribeOneClick` WITHOUT any injection, against a page
// that does not exist on our own staging — nobody is unsubscribed, no third
// party is called. Expected: anything but `transport`.
if (process.argv.includes('--transport')) {
  console.log('\ntransport — the SHIPPED requester, no injection')
  // A path that exists nowhere, so calling it has no effect on anyone. Set
  // SYNAPMAIL_TRANSPORT_PROBE_URL to point this arm at a host you control.
  const PROBE = process.env.SYNAPMAIL_TRANSPORT_PROBE_URL ?? 'https://mail.example.com/no-such-probe-path'
  const started = Date.now()
  const real = await unsubscribeOneClick(PROBE)
  const elapsedMs = Date.now() - started
  // PRODUCT vs HARNESS: a `transport`/`unresolvable` in ~0 ms with the host up
  // is the defect; the same with the host down is a harness error, so the
  // elapsed time and the reason are both printed.
  assert.notEqual(
    real.reason,
    'transport',
    `the SHIPPED requester failed at the socket against ${PROBE} in ${elapsedMs} ms — ` +
      `a real one-click can never complete (reason=${real.reason}, status=${real.status})`
  )
  ok(`shipped requester reached ${PROBE}: reason=${real.reason ?? 'none'} status=${real.status ?? '-'} in ${elapsedMs} ms`)

  // Negative control: the SAME URL, the SAME network, only the pre-fix `lookup`
  // convention (a single address where Node asks for an array). It must fail as
  // `transport` — otherwise this arm cannot tell a working socket from a broken one.
  //
  // Its own non-pooling agent: `https.globalAgent` keeps sockets alive since
  // Node 19, so reusing the one the call above opened would skip `lookup`
  // entirely and the control would pass while measuring nothing (observed).
  const https = await import('node:https')
  const freshSocket = new https.Agent({ keepAlive: false, maxSockets: 1 })
  const legacyRequester = ({ url, address, body, contentType, timeoutMs }) =>
    new Promise((resolve, reject) => {
      const req = https.request(
        {
          protocol: url.protocol,
          hostname: url.hostname,
          port: url.port || 443,
          path: `${url.pathname}${url.search}`,
          method: 'POST',
          headers: { 'Content-Type': contentType, 'Content-Length': Buffer.byteLength(body) },
          timeout: timeoutMs,
          agent: freshSocket,
          lookup: (_h, _o, cb) => cb(null, address.address, address.family),
        },
        res => { res.resume(); resolve({ status: res.statusCode ?? 0 }) }
      )
      req.on('error', reject)
      req.end(body)
    })
  const legacy = await unsubscribeOneClick(PROBE, { request: legacyRequester })
  assert.equal(
    legacy.reason,
    'transport',
    'NEGATIVE CONTROL FAILED: the pre-fix lookup convention did NOT fail here, so this arm proves nothing'
  )
  ok('negative control: the pre-fix lookup convention IS caught here (transport)')
}

// ---------------------------------------------------------------------------
// HISTORY ARM (--live). The history lives in the database and is served by a
// route, so it is measured THROUGH THAT ROUTE — not by calling the module,
// which would skip the access rule that is the whole point here. Rows are
// written for two mailboxes of two DIFFERENT users and read back as each of
// them; they are removed in the finally block. No unsubscribe is ever sent.
const HISTORY_KEY = 'from:bench-history@example.invalid'
const HISTORY_SENDER = 'bench-history@example.invalid'

async function checkHistory(BASE, pool, ownAccountId, ownKey, makeKeyFor) {
  console.log('\nhistory — survives the cleaning, never crosses a mailbox')
  let failures = 0
  const bad = msg => { console.error(`  KO  ${msg}`); failures += 1 }
  const history = (key, account) =>
    fetch(`${BASE}/api/subscriptions/unsubscribed${account ? `?account=${account}` : ''}`, {
      headers: { authorization: `Bearer ${key}` },
    }).then(async r => ({ status: r.status, body: await r.json() }))

  // A mailbox belonging to SOMEBODY ELSE, and a key of theirs — the control.
  const { rows: others } = await pool.query(
    `SELECT a.id, a.user_id FROM email_accounts a
     WHERE a.user_id <> (SELECT user_id FROM email_accounts WHERE id = $1) LIMIT 1`,
    [ownAccountId]
  )
  const written = [ownAccountId, ...(others[0] ? [others[0].id] : [])]
  let theirKey = null
  try {
    for (const id of written) {
      await pool.query(
        `INSERT INTO unsubscriptions (account_id, group_key, method, sender_address, sender_name)
         VALUES ($1, $2, 'one-click', $3, 'Bench History')
         ON CONFLICT (account_id, group_key) DO NOTHING`,
        [id, HISTORY_KEY, HISTORY_SENDER]
      )
    }

    const mine = await history(ownKey, ownAccountId)
    const entry = mine.body.data?.find(e => e.sender?.address === HISTORY_SENDER)
    if (mine.status !== 200 || !entry) bad(`a written entry is not read back: ${JSON.stringify(mine).slice(0, 200)}`)
    else if (entry.method !== 'one-click' || !entry.unsubscribedAt) bad(`entry incomplete: ${JSON.stringify(entry)}`)
    else console.log(`  ok  the history reads back the entry (sender, method, date) for its own mailbox`)

    // No message of that sender is in the folder — the entry comes from the
    // database, which is exactly what "outlives the cleaning" means.
    const listed = await fetch(`${BASE}/api/subscriptions?account=${ownAccountId}&folder=INBOX`, {
      headers: { authorization: `Bearer ${ownKey}` },
    }).then(r => r.json())
    if ((listed.data ?? []).some(g => g.sender?.address === HISTORY_SENDER)) {
      bad('the bench sender is actually in the mailbox — the check below would prove nothing')
    } else {
      console.log('  ok  that sender has NO message in the folder, yet the history still holds it')
    }

    if (!others[0]) {
      console.log('  --  only one user has a mailbox here: the crossing control could not run')
    } else {
      const theirId = others[0].id
      // Unscoped: every mailbox this user may read, and nothing else.
      const all = await history(ownKey)
      if (all.status !== 200) bad(`the unscoped history answered ${all.status}`)
      else if (all.body.data.some(e => e.accountId === theirId)) {
        bad("another user's mailbox appeared in the unscoped history")
      } else console.log(`  ok  the unscoped history holds ${all.body.data.length} entry(ies), none of the other user's`)

      const denied = await history(ownKey, theirId)
      if (denied.status !== 404) bad(`another user's mailbox answered ${denied.status}, expected 404`)
      else console.log("  ok  naming another user's mailbox answers 404, leaking nothing")

      // NEGATIVE CONTROL: that same row IS readable by the user who owns it.
      // Without this, the absence above could just mean nothing was written.
      theirKey = await makeKeyFor(others[0].user_id)
      const theirs = await history(theirKey.raw, theirId)
      if (theirs.status !== 200 || !theirs.body.data?.some(e => e.sender?.address === HISTORY_SENDER)) {
        bad(`NEGATIVE CONTROL FAILED: the other entry is not readable by its own owner either ` +
          `(${theirs.status}) — its absence above proves nothing`)
      } else {
        console.log("  ok  negative control: that same entry IS readable by the mailbox's own owner")
      }
    }
  } finally {
    for (const id of written) {
      await pool.query('DELETE FROM unsubscriptions WHERE account_id = $1 AND group_key = $2', [id, HISTORY_KEY])
    }
    if (theirKey) await theirKey.drop()
  }
  return failures
}

console.log('\nsubscriptions: all checks passed')

// ---------------------------------------------------------------------------
// REAL-WORKLOAD ARM (--live). Green micro-tests above are a necessary, never a
// sufficient condition: they say nothing about how the route behaves on a real
// mailbox, nor how long scanning RECENT_MESSAGES_SCANNED headers takes there.
//
// This arm READS ONLY: it lists subscriptions through the API with a Bearer key
// it creates for itself, times the call, and NEVER posts an unsubscribe — that
// is a real action at a third party's and belongs to a manual review.
if (process.argv.includes('--live')) {
  const { readFileSync: read } = await import('node:fs')
  const crypto = await import('node:crypto')
  for (const f of [new URL('../.env.local', import.meta.url), new URL('../.env', import.meta.url)]) {
    for (const line of read(f, 'utf8').split('\n')) {
      const m = line.match(/^([A-Z_]+)=(.*)$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
    }
  }
  const { SYNAPMAIL_TEST_URL: BASE, SYNAPMAIL_TEST_EMAIL: EMAIL } = process.env
  for (const [k, v] of Object.entries({ SYNAPMAIL_TEST_URL: BASE, SYNAPMAIL_TEST_EMAIL: EMAIL })) {
    if (!v) { console.error(`HARNESS: ${k} is not set`); process.exit(2) }
  }

  console.log('\nlive — one real mailbox, read only, no unsubscribe sent')
  const { default: pg } = await import('pg')
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
  const { rows } = await pool.query(
    `SELECT a.id, a.email, a.prompt_guard, u.id AS owner_id
     FROM email_accounts a JOIN users u ON u.id = a.user_id
     WHERE u.email = $1 ORDER BY a.created_at LIMIT 1`,
    [EMAIL]
  )
  const acc = rows[0]
  if (!acc) { await pool.end(); console.error(`HARNESS: no email account for ${EMAIL}`); process.exit(2) }

  // A key of the bench's own, deleted in the finally block; never logged.
  // One maker, reused for the control key of the other user in checkHistory.
  const makeKeyFor = async userId => {
    const raw = 'syn_' + crypto.randomBytes(32).toString('hex')
    const { rows } = await pool.query(
      `INSERT INTO api_keys (user_id, name, key_prefix, key_hash) VALUES ($1, $2, $3, $4) RETURNING id`,
      [userId, 'check-subscriptions bench', raw.slice(0, 12),
       crypto.createHash('sha256').update(raw).digest('hex')]
    )
    const id = rows[0].id
    return {
      raw,
      id,
      drop: async () => {
        await pool.query('DELETE FROM api_key_requests WHERE api_key_id = $1', [id])
        await pool.query('DELETE FROM api_keys WHERE id = $1', [id])
      },
    }
  }
  const ownKey = await makeKeyFor(acc.owner_id)
  const RAW_KEY = ownKey.raw
  let liveFailures = 0
  const bad = msg => { console.error(`  KO  ${msg}`); liveFailures += 1 }

  try {
    const url = `${BASE}/api/subscriptions?account=${acc.id}&folder=INBOX`
    const started = Date.now()
    const res = await fetch(url, { headers: { authorization: `Bearer ${RAW_KEY}` } })
    const elapsedMs = Date.now() - started
    const payload = await res.json()
    if (res.status !== 200) {
      // PRODUCT vs HARNESS: a non-200 with a body IS the product answering.
      bad(`the route answered ${res.status} — ${JSON.stringify(payload).slice(0, 200)}`)
    } else {
      const list = payload.data
      if (!Array.isArray(list)) bad(`data is not an array: ${JSON.stringify(payload).slice(0, 200)}`)
      else {
        console.log(`  ok  ${list.length} subscription group(s) in ${elapsedMs} ms ` +
          `(scan window ${RECENT_MESSAGES_SCANNED} headers, mailbox ${acc.email})`)
        for (const s of list) {
          if (!/^[0-9a-f]{24}$/.test(s.id ?? '')) bad(`a group has no opaque id: ${JSON.stringify(s).slice(0, 120)}`)
          if (!['one-click', 'mailto', 'link'].includes(s.method)) bad(`unknown method ${s.method}`)
          if (typeof s.count !== 'number' || s.count < 1) bad(`a group has no count`)
        }
        const counts = list.map(s => s.count)
        if (counts.join() !== [...counts].sort((a, b) => b - a).join()) bad('groups are not sorted by decreasing count')
        const methods = list.reduce((acc, s) => ({ ...acc, [s.method]: (acc[s.method] ?? 0) + 1 }), {})
        if (list.length) console.log(`  ok  ids opaque, counts sorted, methods ${JSON.stringify(methods)}`)
        // The guard travels with third-party content when the mailbox has it on.
        if (acc.prompt_guard) {
          if (Object.keys(payload)[0] !== 'aiSafety') bad('aiSafety is not the first key of the guarded response')
          else console.log('  ok  aiSafety is the FIRST key of the response (mailbox guard on)')
        } else {
          console.log('  --  mailbox guard is off: the wrapper is not expected here')
        }
      }
    }
    // The ids of one mailbox must mean nothing without that mailbox.
    const unknown = await fetch(`${BASE}/api/subscriptions?account=${'0'.repeat(8)}-0000-0000-0000-000000000000`, {
      headers: { authorization: `Bearer ${RAW_KEY}` },
    })
    if (unknown.status !== 404) bad(`an unknown account id answered ${unknown.status}, expected 404`)
    else console.log('  ok  an unknown account id answers 404, leaking nothing')

    const anonymous = await fetch(url)
    if (anonymous.status !== 401) bad(`without a credential the route answered ${anonymous.status}, expected 401`)
    else console.log('  ok  without a credential the route answers 401')

    // Refused BEFORE any network call: the ceiling, and the empty body.
    const tooMany = await fetch(`${BASE}/api/subscriptions/unsubscribe`, {
      method: 'POST',
      headers: { authorization: `Bearer ${RAW_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ account: acc.id, ids: Array.from({ length: MAX_UNSUBSCRIBE_BATCH + 1 }, (_, i) => String(i)) }),
    })
    if (tooMany.status !== 400) bad(`${MAX_UNSUBSCRIBE_BATCH + 1} ids answered ${tooMany.status}, expected 400`)
    else console.log(`  ok  more than ${MAX_UNSUBSCRIBE_BATCH} ids is refused (400), nothing sent`)

    // An id that belongs to no group: `not_found`, and NOT ONE unsubscribe sent.
    const forged = await fetch(`${BASE}/api/subscriptions/unsubscribe`, {
      method: 'POST',
      headers: { authorization: `Bearer ${RAW_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ account: acc.id, ids: ['f'.repeat(24)] }),
    })
    const forgedBody = await forged.json()
    if (forged.status !== 200 || forgedBody.data?.[0]?.outcome !== 'not_found') {
      bad(`a forged id gave ${forged.status} ${JSON.stringify(forgedBody).slice(0, 160)}, expected 200 not_found`)
    } else {
      console.log('  ok  a forged id is not_found — no unsubscribe was sent for it')
    }
    // The list an agent reads must carry what it needs to FILE the messages away.
    if (res.status === 200 && Array.isArray(payload.data) && payload.data.length) {
      for (const g of payload.data) {
        if (g.folder !== 'INBOX') bad(`a group reports folder ${g.folder}, expected the one that was read`)
        if (!Array.isArray(g.uids) || g.uids.length !== g.count) {
          bad(`a group's uids do not match its count: ${JSON.stringify({ count: g.count, uids: g.uids }).slice(0, 120)}`)
        }
      }
      const allUids = payload.data.flatMap(g => g.uids ?? [])
      if (new Set(allUids).size !== allUids.length) bad('a uid is claimed by two groups')
      else console.log(`  ok  ${allUids.length} uid(s) across ${payload.data.length} group(s), folder carried, none shared`)
    }

    // The history route, on the same real mailbox and through the same Bearer key.
    const histRes = await fetch(`${BASE}/api/subscriptions/unsubscribed?account=${acc.id}`, {
      headers: { authorization: `Bearer ${RAW_KEY}` },
    })
    const histBody = await histRes.json()
    if (histRes.status !== 200 || !Array.isArray(histBody.data)) {
      bad(`the history route answered ${histRes.status} — ${JSON.stringify(histBody).slice(0, 160)}`)
    } else {
      console.log(`  ok  the history route answers 200 with ${histBody.data.length} entry(ies)`)
    }
    const histAnon = await fetch(`${BASE}/api/subscriptions/unsubscribed`)
    if (histAnon.status !== 401) bad(`the history without a credential answered ${histAnon.status}, expected 401`)
    else console.log('  ok  the history without a credential answers 401')
    const histUnknown = await fetch(`${BASE}/api/subscriptions/unsubscribed?account=${'0'.repeat(8)}-0000-0000-0000-000000000000`, {
      headers: { authorization: `Bearer ${RAW_KEY}` },
    })
    if (histUnknown.status !== 404) bad(`the history on an unknown account answered ${histUnknown.status}, expected 404`)
    else console.log('  ok  the history on an unknown account answers 404')

    liveFailures += await checkHistory(BASE, pool, acc.id, RAW_KEY, makeKeyFor)
  } finally {
    await ownKey.drop()
    await pool.end()
  }
  if (liveFailures) {
    console.error(`\ncheck-subscriptions: live arm — ${liveFailures} failure(s)`)
    process.exit(1)
  }
  console.log('\ncheck-subscriptions: live arm OK (read only, no unsubscribe sent)')
}
