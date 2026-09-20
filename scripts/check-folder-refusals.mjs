#!/usr/bin/env node
/**
 * A refusal from the `/api/folders*` routes must carry a READABLE body on every
 * request, not only on the first one in the life of the process.
 *
 * The body of a `Response` can only be read ONCE. A response held in a module-level
 * constant is therefore empty from the second refusal on, and the screen — which
 * renders `error` into `data-folder-error` — has nothing left to show. This harness
 * replays the SAME refusal three times and requires all three bodies.
 *
 *   node --experimental-strip-types scripts/check-folder-refusals.mjs
 */
import assert from 'node:assert/strict'
import { FOLDER_REFUSALS, refuse } from '../lib/folderActions.ts'

const KINDS = Object.keys(FOLDER_REFUSALS)
assert.ok(KINDS.length > 0, 'aucun refus déclaré')

// Three IDENTICAL consecutive refusals: all three carry the same readable JSON.
for (const kind of KINDS) {
  const { error, status } = FOLDER_REFUSALS[kind]
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = refuse(kind)
    assert.equal(res.status, status, `${kind} #${attempt} : statut ${res.status}, attendu ${status}`)
    const body = await res.json()
    assert.deepEqual(body, { error }, `${kind} #${attempt} : corps ${JSON.stringify(body)}, attendu {"error":"${error}"}`)
  }
}

// Two successive refusals really are two DISTINCT objects — otherwise the body is shared.
assert.notEqual(refuse('notFound'), refuse('notFound'), 'refuse() rend deux fois la même réponse')

// No folder route keeps a refusal response in a module-level constant.
// That is the exact pattern which produced the defect: it is banned at the source.
const { readFileSync } = await import('node:fs')
for (const file of ['../app/api/folders/route.ts', '../app/api/folders/actions/route.ts']) {
  const src = readFileSync(new URL(file, import.meta.url), 'utf8')
  const hoisted = src.match(/^const\s+\w+\s*=\s*NextResponse\.json\(/m)
  assert.equal(hoisted, null, `${file} garde une réponse dans une constante de module : ${hoisted?.[0]}`)
}

console.log(`check-folder-refusals: OK (${KINDS.length} refus × 3 requêtes)`)
