#!/usr/bin/env node
/**
 * PR-29 follow-up (security list): `POST /api/ai/action` accepts a Bearer key, and every
 * call is billed to the user's own provider account. Without a ceiling on `content`, one
 * key is an open line on that budget. The route now refuses, BEFORE any database or
 * provider work, a body whose `content` + `context` exceed `AI_CONTENT_MAX_CHARS`.
 *
 * Measured on a running instance through the real route, with a Bearer key scoped
 * `ai:use`, under a THROWAWAY user who has NO assistant configured — so a body under the
 * ceiling is answered `400 AI not configured` and no provider is ever reached, at no cost:
 *   A. content one character over the ceiling         → 413, the body names the ceiling;
 *   B. content exactly at the ceiling                  → 400 (the ceiling is inclusive; and
 *      413 in A came BEFORE the settings lookup that answers 400 here);
 *   C. content + context together over the ceiling    → 413;
 *   D. the route reads the ceiling from `lib/ai.ts`, no retyped number;
 *   E. `docs/API.md` and `docs/openapi.json` announce the 413 for this route.
 *
 *   node --experimental-strip-types scripts/check-ai-content-limit.mjs
 *   node --experimental-strip-types scripts/check-ai-content-limit.mjs --negative
 *
 * NEGATIVE CONTROL (`--negative`): the oversized bodies are judged the OLD way — as if the
 * route had no ceiling and answered 400 like any other unconfigured call. The bench MUST
 * then go red on A and C. What it shows: the assertions measure the refusal, not merely
 * that the route answered.
 *
 * SAFETY: no `ai_settings` row exists for the bench user, so no model is called and no
 * credit is spent. The user and its key are deleted in `finally`. Needs a running dev
 * server and SYNAPMAIL_TEST_URL + DATABASE_URL (see .env).
 */
import './alias-resolver.mjs'
import crypto from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import pg from 'pg'
const { AI_CONTENT_MAX_CHARS } = await import('../lib/ai.ts')

for (const file of ['../.env', '../.env.local']) {
  const path = new URL(file, import.meta.url)
  if (!existsSync(path)) continue
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
  }
}
const { SYNAPMAIL_TEST_URL: BASE, DATABASE_URL: DB_URL } = process.env
const NEGATIVE = process.argv.includes('--negative')
const harness = msg => { console.error(`HARNESS: ${msg}`); process.exit(2) }
for (const [k, v] of Object.entries({ SYNAPMAIL_TEST_URL: BASE, DATABASE_URL: DB_URL })) if (!v) harness(`${k} is not set`)

const failures = []
const check = (label, ok, detail = '') => {
  if (ok) { console.log(`  ok   ${label}`); return }
  console.error(`  FAIL ${label}${detail ? `\n       ${detail}` : ''}`)
  failures.push(label)
}

const pool = new pg.Pool({ connectionString: DB_URL })
const created = { users: [], keys: [] }

try {
  const tag = crypto.randomBytes(4).toString('hex')
  const user = await pool.query(
    `INSERT INTO users (email, name, password_hash, role, status)
     VALUES ($1, $2, 'bench-not-a-real-hash', 'user', 'active') RETURNING id`,
    [`bench-ai-limit-${tag}@bench.invalid`, `bench ai limit ${tag}`]
  )
  const userId = user.rows[0].id
  created.users.push(userId)
  const configured = await pool.query('SELECT 1 FROM ai_settings WHERE user_id = $1', [userId])
  if (configured.rows.length) harness('the throwaway user must have NO assistant configured')

  const raw = `syn_${crypto.randomBytes(24).toString('hex')}`
  const key = await pool.query(
    `INSERT INTO api_keys (user_id, name, key_prefix, key_hash, scopes, scopes_migrated_at, accounts_migrated_at)
     VALUES ($1, $2, $3, $4, $5::text[], NOW(), NOW()) RETURNING id`,
    [userId, 'bench ai limit', raw.slice(0, 12), crypto.createHash('sha256').update(raw).digest('hex'), ['ai:use']]
  )
  created.keys.push(key.rows[0].id)

  const call = async body => {
    const res = await fetch(`${BASE}/api/ai/action`, {
      method: 'POST',
      headers: { authorization: `Bearer ${raw}`, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'summarize', ...body }),
    })
    const text = await res.text()
    let parsed = null
    try { parsed = JSON.parse(text) } catch { /* reported via text */ }
    return { status: res.status, body: parsed, text }
  }

  // The old route had no ceiling: an oversized body was just another unconfigured call.
  const expectedOver = NEGATIVE ? 400 : 413

  const a = await call({ content: 'x'.repeat(AI_CONTENT_MAX_CHARS + 1) })
  check(`A one character over the ceiling: ${expectedOver}`,
    a.status === expectedOver && (NEGATIVE || a.body?.limit === AI_CONTENT_MAX_CHARS),
    `got ${a.status} — ${a.text.slice(0, 200)}`)

  const b = await call({ content: 'x'.repeat(AI_CONTENT_MAX_CHARS) })
  check('B exactly at the ceiling: passes the ceiling, stops at 400 (no assistant configured)',
    b.status === 400 && /not configured/i.test(b.body?.error ?? ''),
    `got ${b.status} — ${b.text.slice(0, 200)}`)

  const half = Math.ceil(AI_CONTENT_MAX_CHARS / 2) + 1
  const c = await call({ content: 'x'.repeat(half), context: 'y'.repeat(half) })
  check(`C content + context together over the ceiling: ${expectedOver}`,
    c.status === expectedOver, `got ${c.status} — ${c.text.slice(0, 200)}`)

  const route = readFileSync(new URL('../app/api/ai/action/route.ts', import.meta.url), 'utf8')
  check('D the route reads AI_CONTENT_MAX_CHARS from lib/ai, no retyped number',
    /AI_CONTENT_MAX_CHARS/.test(route) && !/\b200[_ ]?000\b/.test(route))

  const apiDoc = readFileSync(new URL('../docs/API.md', import.meta.url), 'utf8')
  const section = apiDoc.split('### `POST /api/ai/action`')[1]?.split('\n### ')[0] ?? ''
  const openapi = JSON.parse(readFileSync(new URL('../docs/openapi.json', import.meta.url), 'utf8'))
  check('E docs/API.md and docs/openapi.json announce the 413 on this route',
    /413/.test(section) && String(AI_CONTENT_MAX_CHARS).length > 0 && new RegExp(String(AI_CONTENT_MAX_CHARS).replace(/(\d)(?=(\d{3})+$)/g, '$1[ ,_]?')).test(section)
      && !!openapi.paths['/api/ai/action']?.post?.responses?.['413'])
} finally {
  for (const id of created.keys) await pool.query('DELETE FROM api_keys WHERE id = $1', [id]).catch(() => {})
  for (const id of created.users) await pool.query('DELETE FROM users WHERE id = $1', [id]).catch(() => {})
  await pool.end()
}

if (NEGATIVE) {
  if (failures.length) { console.log(`\nnegative control: ${failures.length} assertion(s) fell, as expected`); process.exit(0) }
  console.error('\nSILENT NEGATIVE CONTROL: an oversized body judged as an ordinary call, and the bench stays green — it measures nothing')
  process.exit(1)
}
if (failures.length) { console.error(`\n${failures.length} failure(s)`); process.exit(1) }
console.log('\nassistant content ceiling: OK')
