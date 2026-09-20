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
 *   node --experimental-strip-types scripts/check-forward-decision.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { IntlMessageFormat } from 'intl-messageformat'
import {
  FORWARD_ERROR,
  FORWARD_MAX_MESSAGES,
  FORWARD_MAX_TOTAL_BYTES,
  parseForwardedMessages,
  resolveForwardOrigin,
} from '../lib/forward.ts'

const ok = (label) => console.log(`  ok  ${label}`)

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

assert.ok(FORWARD_MAX_TOTAL_BYTES > 0 && FORWARD_MAX_TOTAL_BYTES <= 25 * 1024 * 1024)
ok(`total size ceiling is ${Math.round(FORWARD_MAX_TOTAL_BYTES / (1024 * 1024))} MB, at or under the common SMTP limit`)

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

console.log('check-forward-decision: OK')
