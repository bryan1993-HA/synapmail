#!/usr/bin/env node
/**
 * Self-check: WHICH password "Test connection" tries, and for WHOM.
 *
 * No database, no network, no browser, and — the point of the lot — NOT ONE real
 * authentication attempt against a mail host. Measured in production on 20/09/2026, the
 * button was sending whatever the password FIELD held: empty (the saved password never
 * leaves the server, so the field starts empty) gave "Missing fields"; filled in by the
 * browser's password manager, it sent the WEBMAIL password to the host, and every press
 * cost two failed logins that a provider eventually locks an account for.
 *
 * `lib/accountTest.ts` decides alone, so it is executed alone with an injected account
 * loader.
 *
 *   node --experimental-strip-types scripts/check-account-test.mjs
 */
import assert from 'node:assert/strict'
import {
  DEFAULT_IMAP_PORT,
  DEFAULT_SMTP_PORT,
  TEST_DECISION,
  TEST_FAILURE,
  classifyTestFailure,
  decideTestPassword,
  hasSubmittedPassword,
  resolveTestPassword,
} from '../lib/accountTest.ts'

const ok = label => console.log(`  ok  ${label}`)

/** The account the loader hands back, and a ledger of what it was asked for. */
const loaderFor = (account, asked = []) => Object.assign(
  async id => { asked.push(id); return account },
  { asked }
)

/** The mailbox as SAVED: the only place its saved password is ever allowed to travel. */
const SAVED = {
  imapHost: 'imap.example.com', imapPort: 993, imapSecure: true,
  smtpHost: 'smtp.example.com', smtpPort: 587, smtpSecure: false,
  username: 'me@example.com',
}
const OWNED = { isOwner: true, oauthProvider: null, hasStoredPassword: true, ...SAVED }
/** A request whose form still points at the saved server — the ordinary case. */
const atSavedServer = extra => ({ accountId: 'acc-1', ...SAVED, ...extra })

console.log('decideTestPassword — which password leaves the server')

// The bug itself: editing with the field left alone must test the SAVED password.
assert.equal(
  await decideTestPassword(atSavedServer({ password: '' }), loaderFor(OWNED)),
  TEST_DECISION.STORED
)
assert.equal(
  await decideTestPassword(atSavedServer({ password: undefined }), loaderFor(OWNED)),
  TEST_DECISION.STORED
)
ok('editing, field left empty: the SAVED password is tested, not the empty field')

// A field of spaces is a field the user did not fill. Sending it would be one more
// failed login at the provider, for nothing.
assert.equal(
  await decideTestPassword(atSavedServer({ password: '   ' }), loaderFor(OWNED)),
  TEST_DECISION.STORED
)
assert.equal(hasSubmittedPassword('   '), false)
assert.equal(hasSubmittedPassword('s3cret'), true)
ok('a field holding only spaces counts as empty, not as a password to try')

// Changing password: what was typed wins, so it can be checked before saving.
assert.equal(
  await decideTestPassword(atSavedServer({ password: 'brand-new' }), loaderFor(OWNED)),
  TEST_DECISION.SUBMITTED
)
ok('editing, field filled: the TYPED password is tested, so a change can be checked first')

// A guest of a shared mailbox never tests credentials that are not theirs, and gets the
// same answer as for a mailbox that does not exist.
assert.equal(
  await decideTestPassword(atSavedServer({ password: '' }),
    loaderFor({ ...OWNED, isOwner: false })),
  TEST_DECISION.DENIED
)
assert.equal(
  await decideTestPassword(atSavedServer({ accountId: 'ghost', password: '' }), loaderFor(null)),
  TEST_DECISION.DENIED
)
ok('a guest, and an unknown mailbox, get the same refusal — existence is not revealed')

// A guest with a password of their own must not get it tried against someone else's
// mailbox either: the refusal comes before the field is ever read.
assert.equal(
  await decideTestPassword(atSavedServer({ password: 'guest-typed' }),
    loaderFor({ ...OWNED, isOwner: false })),
  TEST_DECISION.DENIED
)
ok('a guest is refused even when they type a password — the refusal comes first')

// Token mailboxes have no password to try; saying so beats a red error.
assert.equal(
  await decideTestPassword(atSavedServer({ password: '' }),
    loaderFor({ ...OWNED, oauthProvider: 'microsoft', hasStoredPassword: false })),
  TEST_DECISION.OAUTH
)
ok('a token mailbox reports "nothing to test", not a failure')

// Creation is untouched: no account, so nothing saved to fall back on.
assert.equal(
  await decideTestPassword({ password: 'typed-at-creation' }, loaderFor(null)),
  TEST_DECISION.SUBMITTED
)
assert.equal(await decideTestPassword({ password: '' }, loaderFor(null)), TEST_DECISION.MISSING)
ok('creating an account behaves exactly as before')

// A mailbox row with no stored password and no token has nothing to try.
assert.equal(
  await decideTestPassword(atSavedServer({ password: '' }),
    loaderFor({ ...OWNED, hasStoredPassword: false })),
  TEST_DECISION.MISSING
)
ok('a mailbox with neither a saved password nor a token reports nothing to try')

// The decision never carries the secret: it names a source, and the route fetches it.
const returned = new Set()
for (const password of ['', 'brand-new']) {
  returned.add(await decideTestPassword(atSavedServer({ password }), loaderFor(OWNED)))
}
assert.deepEqual([...returned].sort(), [TEST_DECISION.STORED, TEST_DECISION.SUBMITTED].sort())
for (const value of returned) {
  assert.equal(typeof value, 'string')
  assert.ok(!value.includes('brand-new'), 'the decision must never echo a password')
}
ok('the decision returns a SOURCE, never a password')

// The loader is asked for exactly the mailbox the request named, never another.
const asked = []
await decideTestPassword(atSavedServer({ accountId: 'acc-42', password: '' }), loaderFor(OWNED, asked))
assert.deepEqual(asked, ['acc-42'])
ok('the mailbox loaded is the one the request names')

// Creation must not hit the loader at all: there is no mailbox to load.
const askedAtCreation = []
await decideTestPassword({ password: 'x' }, loaderFor(OWNED, askedAtCreation))
assert.deepEqual(askedAtCreation, [])
ok('creating an account loads no mailbox')

console.log('the SAVED password only ever travels to the SAVED server')

// The hole this section closes: with a mailbox id and an empty field, the route decrypted
// the saved password and logged in to whatever host the REQUEST BODY named. Anyone holding
// a session (stolen cookie, unlocked desk, injected script) could point the test at their
// own server and read every mailbox password in clear, inside the LOGIN command.
for (const [label, form] of [
  ['the IMAP host', { imapHost: 'attacker.example.net' }],
  ['the SMTP host', { smtpHost: 'attacker.example.net' }],
  ['the username', { username: 'someone-else@example.com' }],
]) {
  const loader = loaderFor(OWNED)
  let storedRead = 0
  const { decision, password } = await resolveTestPassword(
    atSavedServer({ password: '', ...form }),
    loader,
    async () => { storedRead += 1; return 'the-saved-secret' }
  )
  assert.equal(decision, TEST_DECISION.PASSWORD_REQUIRED, label)
  assert.equal(password, null, label)
  assert.equal(storedRead, 0, `${label}: the saved password must not even be read`)
  ok(`${label} changed with an empty field: the password is REQUIRED, and never read`)
}

// Same host written differently is the same host: refusing here would read as a bug and
// push people to retype their password for nothing.
assert.equal(
  await decideTestPassword(
    atSavedServer({ password: '', imapHost: '  IMAP.Example.COM ', username: ' ME@example.com' }),
    loaderFor(OWNED)
  ),
  TEST_DECISION.STORED
)
ok('a different case or stray spaces is the same server: the saved password still applies')

// A port or a TLS box is what people come here to fix, and neither changes WHO receives
// the secret.
assert.equal(
  await decideTestPassword(
    atSavedServer({ password: '', imapPort: 143, imapSecure: false, smtpPort: 465 }),
    loaderFor(OWNED)
  ),
  TEST_DECISION.STORED
)
ok('a corrected port or TLS box still tests with the saved password: the host is unchanged')

// A password the person just typed is THEIRS to send wherever they like: that is how a
// mailbox gets moved to a new server.
assert.equal(
  await decideTestPassword(
    atSavedServer({ password: 'typed-by-me', imapHost: 'imap.newhost.example' }),
    loaderFor(OWNED)
  ),
  TEST_DECISION.SUBMITTED
)
ok('a TYPED password can still be tested against a new host: it is the person\'s own')

// Negative control: were the rule not wired at all, the run above would be green anyway.
// The unchanged form MUST reach the saved password, or this whole section proves nothing.
let readAtSavedServer = 0
const atRest = await resolveTestPassword(
  atSavedServer({ password: '' }),
  loaderFor(OWNED),
  async () => { readAtSavedServer += 1; return 'the-saved-secret' }
)
assert.equal(atRest.decision, TEST_DECISION.STORED)
assert.equal(atRest.password, 'the-saved-secret')
assert.equal(readAtSavedServer, 1)
ok('negative control: the unchanged form DOES reach the saved password (the rule is not a blanket refusal)')

// And the refusal must be a decision of its own, never mistaken for the two older ones.
assert.notEqual(TEST_DECISION.PASSWORD_REQUIRED, TEST_DECISION.MISSING)
assert.notEqual(TEST_DECISION.PASSWORD_REQUIRED, TEST_DECISION.DENIED)
ok('"password required" is its own answer, distinct from "nothing to try" and "not yours"')

console.log('what is COMPARED is what is JOINED')

// Measured by the human on staging, 19/09: the comparison trims and lowercases, but the
// route then connected with the form's RAW string. A saved SMTP host followed by one space
// was accepted as the same server, then joined as "smtp.example.com " — a name that does
// not resolve, so the probe read tested=stored with smtp unreachable while the exact
// settings gave imap ok + smtp ok. On a STORED verdict the SAVED values are what travel.
const connectionOf = async form => {
  const { decision, connection } = await resolveTestPassword(
    atSavedServer(form), loaderFor(OWNED), async () => 'the-saved-secret'
  )
  return { decision, connection }
}

const exact = await connectionOf({ password: '' })
assert.equal(exact.decision, TEST_DECISION.STORED)
assert.deepEqual(exact.connection, {
  imapHost: 'imap.example.com', imapPort: 993, imapSecure: true,
  smtpHost: 'smtp.example.com', smtpPort: 587, smtpSecure: false,
  username: 'me@example.com',
})
ok('the exact saved settings join the saved host, port, TLS and username')

// The human's own probe, replayed: stray spaces and a different case must give EXACTLY the
// same connection as the exact settings — not a host with a space glued to it.
for (const [label, form] of [
  ['a trailing space on the SMTP host', { smtpHost: 'smtp.example.com ' }],
  ['a leading space on the IMAP host', { imapHost: ' imap.example.com' }],
  ['a different case everywhere', {
    imapHost: 'IMAP.Example.COM', smtpHost: 'SMTP.Example.COM', username: 'ME@Example.com',
  }],
  ['spaces and case together', {
    imapHost: '  IMAP.Example.COM ', smtpHost: ' smtp.EXAMPLE.com  ', username: ' Me@Example.COM ',
  }],
]) {
  const got = await connectionOf({ password: '', ...form })
  assert.equal(got.decision, TEST_DECISION.STORED, label)
  assert.deepEqual(got.connection, exact.connection, label)
  ok(`${label}: same connection as the exact settings, not the raw form string`)
}

// The PORT and the TLS box come from the FORM, even on
// a stored test. Repairing a mailbox means trying 587 -> 465 BEFORE saving it; testing the
// old port instead makes the button lie a second way. The host is unchanged, so the secret
// is still confided to nobody new — only the way we knock at that door changes.
const retuned = await connectionOf({ password: '', smtpPort: 465, smtpSecure: true })
assert.equal(retuned.decision, TEST_DECISION.STORED)
assert.deepEqual(retuned.connection, {
  ...exact.connection, smtpPort: 465, smtpSecure: true,
})
ok('a corrected SMTP port and TLS box are what gets tried, on the SAVED host')

const retunedImap = await connectionOf({ password: '', imapPort: 143, imapSecure: false })
assert.equal(retunedImap.decision, TEST_DECISION.STORED)
assert.deepEqual(retunedImap.connection, {
  ...exact.connection, imapPort: 143, imapSecure: false,
})
ok('the same holds for the IMAP port and its TLS box')

// The security boundary is untouched by that: a retuned port does NOT buy a new host.
// Spaces and case still collapse to the saved host, and the ports still follow the form.
const retunedAndSloppy = await connectionOf({
  password: '', smtpHost: ' SMTP.Example.COM ', smtpPort: 465, smtpSecure: true,
})
assert.equal(retunedAndSloppy.decision, TEST_DECISION.STORED)
assert.deepEqual(retunedAndSloppy.connection, retuned.connection)
ok('a retuned port on a sloppily-written host still joins the SAVED host, exactly')

const retunedElsewhere = await connectionOf({
  password: '', imapHost: 'attacker.example.net', imapPort: 143,
})
assert.equal(retunedElsewhere.decision, TEST_DECISION.PASSWORD_REQUIRED)
assert.equal(retunedElsewhere.connection, null)
ok('changing the HOST still refuses: a port is tunable, a destination is not')

// A TYPED password is the person's own: it goes exactly where the FORM says, ports included.
const typed = await resolveTestPassword(
  atSavedServer({ password: 'typed-by-me', imapHost: 'imap.newhost.example', imapPort: '143', imapSecure: false }),
  loaderFor(OWNED),
  async () => { throw new Error('the saved password must not be read on a typed password') }
)
assert.equal(typed.decision, TEST_DECISION.SUBMITTED)
assert.equal(typed.password, 'typed-by-me')
assert.equal(typed.connection.imapHost, 'imap.newhost.example')
assert.equal(typed.connection.imapPort, 143)
assert.equal(typed.connection.imapSecure, false)
ok('a typed password travels to the FORM settings, ports and TLS included')

// A refusal joins nothing at all: there is no connection to hand the route.
for (const form of [
  { password: '', imapHost: 'attacker.example.net' },
  { password: '', username: 'someone-else@example.com' },
]) {
  const refused = await connectionOf(form)
  assert.equal(refused.decision, TEST_DECISION.PASSWORD_REQUIRED)
  assert.equal(refused.connection, null)
}
ok('a refused test carries no connection: nothing is joined')

// Defaults exist so a blank port never becomes port 0 — a connection that fails for the
// wrong reason and reads as "unreachable" to the person.
const noPorts = await resolveTestPassword(
  { accountId: 'acc-1', ...SAVED, password: '',
    imapPort: null, smtpPort: null, imapSecure: null, smtpSecure: null },
  loaderFor({ ...OWNED, imapPort: null, smtpPort: null, imapSecure: null, smtpSecure: null }),
  async () => 'the-saved-secret'
)
assert.equal(noPorts.connection.imapPort, DEFAULT_IMAP_PORT)
assert.equal(noPorts.connection.smtpPort, DEFAULT_SMTP_PORT)
assert.equal(noPorts.connection.imapSecure, true)
assert.equal(noPorts.connection.smtpSecure, false)
ok('a mailbox row with no port falls back to the usual ports, never to port 0')

console.log('classifyTestFailure — the cause, not the raw server line')

// The two real messages from the production report.
assert.equal(classifyTestFailure('Invalid login: 535 Authentication credentials invalid'),
  TEST_FAILURE.CREDENTIALS)
assert.equal(classifyTestFailure('Command failed: AUTHENTICATIONFAILED'), TEST_FAILURE.CREDENTIALS)
ok('the two failures seen in production read as "credentials refused"')

assert.equal(classifyTestFailure('getaddrinfo ENOTFOUND imap.example.invalid'),
  TEST_FAILURE.UNREACHABLE)
assert.equal(classifyTestFailure('connect ECONNREFUSED 127.0.0.1:993'), TEST_FAILURE.UNREACHABLE)
assert.equal(classifyTestFailure('Timed out while connecting'), TEST_FAILURE.UNREACHABLE)
ok('a host that never answered reads as "unreachable", a different thing to fix')

// Anything unrecognised must NOT be dressed up as one of the two known causes.
assert.equal(classifyTestFailure('self signed certificate in chain'), TEST_FAILURE.OTHER)
ok('an unrecognised failure stays "other" rather than being filed wrongly')

console.log('check-account-test: OK')
