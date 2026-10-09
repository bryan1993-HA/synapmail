#!/usr/bin/env node
/**
 * PR-29 follow-up: switching the active account wrote `/api/settings` with a bare
 * `fetch()` and no SWR mutation — and the other writers did `mutate(key, value, false)`
 * THEN a separate `fetch()`, which ends the mutation before the PATCH has even left.
 * Either way, a revalidation racing the write (the `revalidateOnFocus` GET of an
 * alt-tab, the 60 s poll) lands with the OLD row and SWR accepts it: the choice the
 * user just made is undone on screen.
 *
 * `lib/settings.ts` → `saveSettings()` makes the PATCH itself the SWR mutation. This
 * bench drives the REAL `swr` (its default cache and mutation bookkeeping, read from
 * `swr/_internal`) with a fetch it holds in its hand, and reads the state `useSWR`
 * consults to discard a stale revalidation: a mutation whose end stamp is still `0`
 * is in flight, and any revalidation finishing meanwhile is thrown away (swr
 * `use-swr` "case 3"). No React, no browser — the end-to-end run is
 * `scripts/check-settings-race-browser.mjs`.
 *
 *   node --experimental-strip-types scripts/check-settings-write.mjs
 *   node --experimental-strip-types scripts/check-settings-write.mjs --negative
 *
 * NEGATIVE CONTROL (`--negative`): the legacy write (optimistic `mutate(..., false)`
 * + detached `fetch`) replaces `saveSettings`. The bench MUST go red.
 */
import { mutate } from 'swr'
import { SWRGlobalState, cache } from 'swr/_internal'

const NEGATIVE = process.argv.includes('--negative')
const failures = []
const check = (label, ok, detail = '') => {
  if (ok) { console.log(`  ok   ${label}`); return }
  console.error(`  FAIL ${label}${detail ? `\n       ${detail}` : ''}`)
  failures.push(label)
}

// ---- a fetch the bench answers when it decides to -------------------------------------
let pending = null
globalThis.fetch = (url, init) => new Promise((resolve, reject) => {
  pending = { url, init, resolve, reject }
})
const answer = (status, body) => {
  const p = pending; pending = null
  p.resolve({ ok: status < 400, status, json: async () => body })
}

const { SETTINGS_KEY, saveSettings } = await import(new URL('../lib/settings.ts', import.meta.url).href)
const MUTATION = SWRGlobalState.get(cache)[1]
const shown = () => cache.get(SETTINGS_KEY)?.data?.data
const inFlight = () => MUTATION[SETTINGS_KEY]?.[1] === 0
const tick = () => new Promise(r => setTimeout(r, 0))

// The write under test — the shipped one, or the legacy shape for the negative control.
const legacyWrite = patch => {
  mutate(SETTINGS_KEY, curr => (curr ? { data: { ...curr.data, ...patch } } : curr), false)
  return fetch(SETTINGS_KEY, { method: 'PATCH', body: JSON.stringify(patch) })
    .then(() => mutate(SETTINGS_KEY))
}
const write = NEGATIVE ? legacyWrite : saveSettings

const seed = { active_account_id: 'old', theme: 'light' }
cache.set(SETTINGS_KEY, { data: { data: { ...seed } } })

console.log('a write in flight')
const done = write({ active_account_id: 'new' })
check('the PATCH goes to the settings key with the patch as its body',
  pending?.url === SETTINGS_KEY && pending?.init?.method === 'PATCH' && JSON.parse(pending.init.body).active_account_id === 'new')
check('the new value shows at once (optimistic), the rest of the row untouched',
  shown()?.active_account_id === 'new' && shown()?.theme === 'light', JSON.stringify(shown()))
await tick()
check('while the PATCH is pending, the mutation is still open: a revalidation landing now is discarded by useSWR',
  inFlight(), `mutation stamps ${JSON.stringify(MUTATION[SETTINGS_KEY])}`)

console.log('the server answers')
const row = { ...seed, active_account_id: 'new', list_width: 333 }
answer(200, { data: row })
await done
check('the cache holds the row the server answered with (single source, no second GET needed)',
  JSON.stringify(shown()) === JSON.stringify(row), JSON.stringify(shown()))
check('the mutation is closed once the write has landed', !inFlight() && MUTATION[SETTINGS_KEY]?.[1] > 0)
check('no second request was fired after the PATCH', pending === null, pending ? `${pending.init?.method ?? 'GET'} ${pending.url}` : '')

console.log('a refused write')
const refused = write({ active_account_id: 'refused' })
check('optimistic again', shown()?.active_account_id === 'refused')
answer(500, { error: 'boom' })
let threw = false
await refused.catch(() => { threw = true })
check('a refused write rolls the cache back to what the server last confirmed',
  shown()?.active_account_id === 'new', JSON.stringify(shown()))
check('and the caller is not made to catch it (fire-and-forget callers stay clean)', !threw)

if (NEGATIVE) {
  if (failures.length) { console.log(`\nnegative control: ${failures.length} assertion(s) fell, as expected`); process.exit(0) }
  console.error('\nSILENT NEGATIVE CONTROL: the legacy write kept the bench green — it measures nothing')
  process.exit(1)
}
if (failures.length) { console.error(`\n${failures.length} failure(s)`); process.exit(1) }
console.log('\nsettings write: OK')
