#!/usr/bin/env node
/**
 * Self-check of the forward trust boundary, with no database, no
 * network and no browser: `lib/forward.ts` decides ALONE what the send route
 * accepts, so it can be executed alone.
 *
 * Two questions, both raised against the code by review:
 *  1. can a hand-written body reach IMAP unchecked (`1:*`, a huge selection)?
 *  2. are the sources read in the mailbox the SELECTION came from, or in the
 *     one the "From" picker happens to point at?
 *
 *  3. is there ONE size ceiling — the server's, resolved BEFORE the IMAP fetch —
 *     or a fixed forward ceiling that wastes the fetch and contradicts the
 *     final check?
 *
 *   node --experimental-strip-types scripts/check-forward-decision.mjs
 *   node --experimental-strip-types scripts/check-forward-decision.mjs --negative
 * NEGATIVE CONTROL (`--negative`): the route is read as it was BEFORE the fix
 * (a fixed FORWARD_MAX_TOTAL_BYTES fed to the fetch, the server ceiling resolved
 * after it). The ceiling assertions MUST then fail.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { IntlMessageFormat } from 'intl-messageformat'
import {
  FORWARD_ERROR,
  FORWARD_MAX_MESSAGES,
  parseForwardedMessages,
  resolveForwardOrigin,
} from '../lib/forward.ts'

const NEGATIVE = process.argv.includes('--negative')
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ok = (label) => console.log(`  ok  ${label}`)
const failures = []
// Under `--negative` an assertion that falls is the expected outcome: it is
// recorded instead of aborting, so every ceiling assertion gets its turn.
const expect = (cond, label) => {
  if (cond) return
  if (!NEGATIVE) assert.fail(label)
  failures.push(label)
}

console.log('parseForwardedMessages — what the boundary refuses')

const valid = { accountId: 'acc-a', folder: 'INBOX', uids: ['12', '7', '3'] }
const parsed = parseForwardedMessages(valid)
assert.equal(parsed.ok, true)
assert.deepEqual(parsed.value.uids, ['12', '7', '3'], 'selection order is kept')
ok('a plain selection passes, in the order it was clicked')

for (const [label, body] of [
  ['an IMAP sequence set (`1:*` would read the WHOLE folder)', { ...valid, uids: ['1:*'] }],
  ['a range', { ...valid, uids: ['1:500'] }],
  ['a wildcard', { ...valid, uids: ['*'] }],
  ['a negative uid', { ...valid, uids: ['-1'] }],
  ['a zero uid', { ...valid, uids: ['0'] }],
  ['a uid with leading zeros (`007` is not how a server spells 7)', { ...valid, uids: ['007'] }],
  ['a non-string uid', { ...valid, uids: [12] }],
  ['an empty selection', { ...valid, uids: [] }],
  ['a missing origin account', { folder: 'INBOX', uids: ['1'] }],
  ['a blank folder', { ...valid, folder: '   ' }],
  ['an array instead of an object', ['INBOX', '1']],
  ['null', null],
]) {
  const r = parseForwardedMessages(body)
  assert.equal(r.ok, false, label)
  assert.equal(r.status, 400)
  assert.equal(r.code, FORWARD_ERROR.invalid)
  ok(`400 on ${label}`)
}

const many = parseForwardedMessages({ ...valid, uids: Array.from({ length: FORWARD_MAX_MESSAGES + 1 }, (_, i) => String(i + 1)) })
assert.equal(many.ok, false)
assert.equal(many.code, FORWARD_ERROR.tooMany)
assert.equal(many.detail, FORWARD_MAX_MESSAGES)
ok(`400 past ${FORWARD_MAX_MESSAGES} messages, and the limit travels with the refusal`)

const dup = parseForwardedMessages({ ...valid, uids: ['5', '5', '9', '5'] })
assert.deepEqual(dup.value.uids, ['5', '9'], 'duplicates collapse, first position wins')
ok('a repeated uid is attached once, not three times')

console.log('ONE size ceiling — the server\'s, resolved before the IMAP fetch')

// The route's source is read rather than reconstructed: a constant that
// re-appears there, or a ceiling resolved after the fetch, fails here.
let route = readFileSync(join(ROOT, 'app/api/messages/send/route.ts'), 'utf8')
if (NEGATIVE) {
  route = route
    .replace('const ceiling = resolveSendCeiling(account.smtp_max_size, MESSAGE_MAX_TOTAL_BYTES)\n', '')
    .replace('ceiling.limit\n      )\n      if (result.oversized)', 'FORWARD_MAX_TOTAL_BYTES\n      )\n      if (result.oversized)')
    .replace('    // Fichiers joints par l\'appelant.', '    const ceiling = resolveSendCeiling(account.smtp_max_size, MESSAGE_MAX_TOTAL_BYTES)\n    // Fichiers joints par l\'appelant.')
}
const forwardModule = readFileSync(join(ROOT, 'lib/forward.ts'), 'utf8')
expect(!/FORWARD_MAX_TOTAL_BYTES/.test(NEGATIVE ? route : route + forwardModule),
  'no fixed forward ceiling may survive: the server ceiling is the only one')
const fetchAt = route.indexOf('getMessageSources(')
const ceilingAt = route.indexOf('const ceiling = resolveSendCeiling(')
expect(fetchAt > 0 && ceilingAt > 0 && ceilingAt < fetchAt,
  'the ceiling must be resolved BEFORE the IMAP fetch, not after it')
const fetchArgs = route.match(/getMessageSources\(([\s\S]*?)\)\s*if \(result\.oversized\)/)?.[1] ?? ''
expect(/,\s*ceiling\.limit\s*$/.test(fetchArgs),
  'the IMAP fetch must be bounded by that same ceiling')
expect(/FORWARD_ERROR\.tooLarge, limit: ceiling\.limit, \.\.\.ceilingOrigin\(ceiling\)/.test(route),
  'the forward refusal must name the ceiling in force and where it comes from')
expect((route.match(/resolveSendCeiling\(/g) ?? []).length === 1,
  'the ceiling is resolved exactly once')
if (!NEGATIVE) ok('one ceiling, resolved once before the IMAP fetch, named in the refusal')

console.log('resolveForwardOrigin — WHICH mailbox the sources are read from')

const sender = { id: 'acc-sender' }
const originA = { id: 'acc-a' }
// The only account the acting user may read, besides the sender's.
const load = async (id) => (id === originA.id ? originA : null)

const same = await resolveForwardOrigin(sender, sender.id, async () => {
  throw new Error('must not be loaded: the origin IS the sender')
})
assert.equal(same.ok, true)
assert.equal(same.value.id, sender.id)
ok('origin === sender: the already-checked account is reused, no second lookup')

const crossed = await resolveForwardOrigin(sender, originA.id, load)
assert.equal(crossed.ok, true)
assert.equal(crossed.value.id, originA.id, 'sources come from the SELECTION mailbox')
assert.notEqual(crossed.value.id, sender.id, 'never from the "From" mailbox')
ok('origin !== sender: sources are read in the origin, not in the sender')

const denied = await resolveForwardOrigin(sender, 'acc-someone-elses', load)
assert.equal(denied.ok, false)
assert.equal(denied.status, 404)
assert.equal(denied.code, FORWARD_ERROR.originDenied)
ok('an origin the user cannot read: 404, nothing is sent')

console.log('refusal labels — one code, one sentence per locale, singular included')

// The server only returns a CODE: the sentence comes from the translation files.
// They are therefore rendered for real (same engine as next-intl) instead of being
// eyeballed — a badly written plural throws here, so a mismatched count cannot ship.
const LOCALES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'locales')
const MESSAGE_OF_CODE = {
  [FORWARD_ERROR.invalid]: 'forwardInvalid',
  [FORWARD_ERROR.tooMany]: 'forwardTooMany',
  [FORWARD_ERROR.tooLarge]: 'forwardTooLarge',
  [FORWARD_ERROR.missing]: 'forwardMissing',
  [FORWARD_ERROR.originDenied]: 'forwardOriginDenied',
}

// A code added without a sentence surfaces here, not in production.
assert.deepEqual(
  Object.keys(MESSAGE_OF_CODE).sort(),
  Object.values(FORWARD_ERROR).sort(),
  'every refusal code must have a translated sentence',
)

for (const locale of ['en', 'fr', 'zh']) {
  const labels = JSON.parse(readFileSync(join(LOCALES_DIR, `${locale}.json`), 'utf8')).mail
  for (const key of Object.values(MESSAGE_OF_CODE)) {
    for (const count of [1, 3]) {
      const rendered = new IntlMessageFormat(labels[key], locale).format({ count })
      assert.equal(typeof rendered, 'string', `${locale}.${key} must render to a string`)
      assert.ok(rendered.trim() !== '', `${locale}.${key} must not render empty`)
      assert.ok(!/[{}#]/.test(rendered), `${locale}.${key} left an unresolved placeholder: ${rendered}`)
    }
  }
  // `forwardMissing` is the only one whose verb agrees with the count: one missing
  // message reads as singular, three as plural, and the two sentences differ.
  const missing = labels.forwardMissing
  const one = new IntlMessageFormat(missing, locale).format({ count: 1 })
  const many = new IntlMessageFormat(missing, locale).format({ count: 3 })
  assert.ok(one.includes('1'), `${locale}: the singular must name its count`)
  assert.ok(many.includes('3'), `${locale}: the plural must name its count`)
  if (locale !== 'zh') {
    assert.notEqual(one, many, `${locale}: singular and plural must not be the same sentence`)
  }
  ok(`${locale}: 5 refusals render, singular "${one}"`)
}

if (NEGATIVE) {
  if (failures.length) { console.log(`\nnegative control: ${failures.length} assertion(s) fell, as expected`); process.exit(0) }
  console.error('check-forward-decision: --negative was expected to FAIL and did not'); process.exit(1)
}
console.log('check-forward-decision: OK')
