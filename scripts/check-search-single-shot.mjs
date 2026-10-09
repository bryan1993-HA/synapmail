#!/usr/bin/env node
/**
 * Minor follow-up of PR-29: the single-shot search route (no `stream=1`) had its
 * own copy of the streamed branch's sort + cap, and under `scope=all` it swept
 * `listFolders()` — every folder, `\Noselect` and measured-empty ones included —
 * while the streamed branch already swept the ranked, filtered list.
 *
 * Pure: reads the route source, runs nothing, no network, no database.
 *
 *   node scripts/check-search-single-shot.mjs
 *   node scripts/check-search-single-shot.mjs --negative   (replays the old source, must go red)
 */
import { readFileSync } from 'node:fs'

const NEGATIVE = process.argv.includes('--negative')
const failures = []
const check = (label, ok, detail = '') => {
  if (ok) { console.log(`  ok   ${label}`); return }
  console.error(`  FAIL ${label}${detail ? `\n       ${detail}` : ''}`)
  failures.push(label)
}

let route = readFileSync(new URL('../app/api/messages/search/route.ts', import.meta.url), 'utf8')
if (NEGATIVE) {
  route = route
    .replace('scope === SCOPE_ALL ? await listFoldersRanked(config) : [folder]',
      'scope === SCOPE_ALL ? (await listFolders(config)).map(f => f.path) : [folder]')
    .replace('messages: streamedMessages(messages, account.id),',
      'messages: messages.sort((a, b) => Date.parse(b.date) - Date.parse(a.date)).slice(0, SEARCH_RESULT_LIMIT).map(m => ({ ...m, accountId: account.id })),')
}

// The one-shot branch is what follows the streamed branch's `return`.
const single = (route.split('opt-in de l\'appelant')[1] ?? '').replace(/^\s*\/\/.*$/gm, '')
check('the one-shot branch exists', single.length > 0)
check('scope=all sweeps the RANKED folder list, the same one the stream uses',
  /scope === SCOPE_ALL \? await listFoldersRanked\(config\)/.test(single) && !/listFolders\(/.test(single))
check('no folder lister other than the ranked ones is imported',
  !/\blistFolders\b/.test(route.split('\n').find(l => l.includes("from '@/lib/imap'")) ?? ''))
check('sort + cap + accountId go through streamedMessages(), not a second copy',
  /messages: streamedMessages\(messages, account\.id\)/.test(single))
const sortCopies = (route.match(/Date\.parse\(b\.date\) - Date\.parse\(a\.date\)/g) ?? []).length
check('the date sort is written exactly once in the route', sortCopies === 1, `${sortCopies} copies`)

if (NEGATIVE) {
  console.log(failures.length >= 3
    ? `negative control: ${failures.length} checks fell on the old source, as they must`
    : 'NEGATIVE CONTROL FAILED: the old source passed')
  process.exit(failures.length >= 3 ? 0 : 1)
}
console.log(failures.length ? `check-search-single-shot: ${failures.length} FAIL` : 'check-search-single-shot: OK')
process.exit(failures.length ? 1 : 0)
