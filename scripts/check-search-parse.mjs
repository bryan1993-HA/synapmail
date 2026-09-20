#!/usr/bin/env node
/**
 * Self-check of the PURE half of the search contract (`lib/search.ts`): how a typed
 * query becomes the terms the IMAP search must all match, and the fields it looks in.
 *
 * No network, no server, no account: the file under test is imported directly, so a
 * drift in the contract fails here rather than in a mailbox-dependent bench.
 *
 *   node --experimental-strip-types scripts/check-search-parse.mjs
 */
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'

// `lib/search.ts` imports './compose' without an extension (bundler resolution).
// Node's resolver needs the extension, so it is added here — this hook is part of
// the harness, never of the product.
registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith('.') && !/\.[a-z]+$/.test(spec)) {
      const url = new URL(`${spec}.ts`, ctx.parentURL)
      if (existsSync(url)) return next(url.href, ctx)
    }
    return next(spec, ctx)
  },
})

const { parseQuery, SEARCH_FIELDS, SEARCH_RESULT_LIMIT, MIN_QUERY_LENGTH } =
  await import(new URL('../lib/search.ts', import.meta.url).href)

let failed = 0
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) { console.log(`  ok   ${label}`); return }
  console.error(`  FAIL ${label}\n       expected ${e}\n       got      ${a}`)
  failed++
}

console.log('parseQuery')
check('single word', parseQuery('nvidia'), ['nvidia'])
check('two words are two terms', parseQuery('3d cpi'), ['3d', 'cpi'])
check('word order is irrelevant', parseQuery('cpi 3d').slice().sort(), parseQuery('3d cpi').slice().sort())
check('multiple spaces collapse', parseQuery('  3d   cpi  '), ['3d', 'cpi'])
check('quoted phrase stays one term', parseQuery('"3d cpi"'), ['3d cpi'])
check('quoted phrase next to a word', parseQuery('"3d cpi" facture'), ['3d cpi', 'facture'])
check('unclosed quote closes at the end', parseQuery('"3d cpi'), ['3d cpi'])
check(`bare term under ${MIN_QUERY_LENGTH} chars is dropped`, parseQuery('a nvidia'), ['nvidia'])
check('quoted short term is kept', parseQuery('"a" nvidia'), ['a', 'nvidia'])
check('duplicates collapse, case-insensitively', parseQuery('Nvidia nvidia NVIDIA'), ['Nvidia'])
check('an address is one term', parseQuery('ada@example.com'), ['ada@example.com'])
check('empty query has no term', parseQuery('   '), [])
check('null query has no term', parseQuery(null), [])

console.log('contract')
check('fields searched', [...SEARCH_FIELDS], ['from', 'to', 'cc', 'subject'])
check('body is never searched (measured 0 results, and it voids the OR)', SEARCH_FIELDS.includes('body'), false)
check('text is never searched (same measurement)', SEARCH_FIELDS.includes('text'), false)
check('result limit is a single source, raised past 50', SEARCH_RESULT_LIMIT > 50, true)

if (failed) { console.error(`\n${failed} check(s) failed`); process.exit(1) }
console.log('\ncheck-search-parse: OK')
