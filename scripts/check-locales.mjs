#!/usr/bin/env node
/**
 * Strict key parity between the locale files of `locales/`.
 *
 * `en.json` is the reference: every other locale must expose exactly the same
 * leaf keys, with the same next-intl placeholders, and no empty value.
 * Locales written in a non-Latin script get an extra check: a value still equal
 * to its English counterpart has not been translated.
 *
 * Exit 0 when every locale matches, 1 otherwise. Node built-ins only.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const LOCALES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'locales')
const REFERENCE = 'en'

/** next-intl interpolation, e.g. `{count}` — the set must be identical across locales. */
const PLACEHOLDER = /\{(\w+)[^}]*\}/g

/**
 * Locales whose values must not remain in English. A locale is flagged as
 * translated-away-from-English when its script is not Latin, which we detect on
 * the file's own content rather than from a hardcoded list of language codes.
 */
const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/

/**
 * Protocol literals that are the same in every language (ASCII armor headers…).
 * Copying them verbatim is correct, so they are exempt from the untranslated check.
 */
const PROTOCOL_LITERAL = /^-{5}(BEGIN|END) /

/**
 * House rule: no em dash in any displayed string, in any
 * locale. Use a comma or two sentences instead. Checked here so the rule holds
 * on its own instead of depending on a reviewer spotting it.
 */
const EM_DASH = '\u2014'

function flatten(value, prefix = '', out = new Map()) {
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (child !== null && typeof child === 'object' && !Array.isArray(child)) {
      flatten(child, path, out)
    } else {
      out.set(path, child)
    }
  }
  return out
}

function placeholders(value) {
  if (typeof value !== 'string') return []
  return [...value.matchAll(PLACEHOLDER)].map(m => m[1]).sort()
}

function readLocale(code) {
  return JSON.parse(readFileSync(join(LOCALES_DIR, `${code}.json`), 'utf8'))
}

function localeCodes() {
  return readdirSync(LOCALES_DIR)
    .filter(name => name.endsWith('.json'))
    .map(name => name.slice(0, -'.json'.length))
    .sort()
}

/** House-rule violations: every displayed string carrying an em dash. */
function emDashProblems(entries) {
  const problems = []
  for (const [key, value] of entries) {
    if (typeof value === 'string' && value.includes(EM_DASH)) {
      problems.push(`em dash               ${key} = ${JSON.stringify(value)}`)
    }
  }
  return problems
}

/** Reports gathered for one locale; each entry is one human-readable line. */
function checkLocale(code, reference) {
  const target = flatten(readLocale(code))
  const problems = []
  const nonLatin = [...target.values()].some(v => typeof v === 'string' && CJK.test(v))

  for (const [key, expected] of reference) {
    if (!target.has(key)) {
      problems.push(`missing key           ${key}`)
      continue
    }
    const actual = target.get(key)
    if (typeof actual !== 'string') {
      problems.push(`not a string          ${key} (${typeof actual})`)
      continue
    }
    if (actual.trim() === '') {
      problems.push(`empty value           ${key}`)
      continue
    }
    const want = placeholders(expected).join(',')
    const got = placeholders(actual).join(',')
    if (want !== got) {
      problems.push(`placeholder mismatch  ${key} (expected {${want}}, got {${got}})`)
      continue
    }
    if (nonLatin && actual === expected && !PROTOCOL_LITERAL.test(expected)) {
      problems.push(`untranslated          ${key} = ${JSON.stringify(expected)}`)
    }
  }

  for (const key of target.keys()) {
    if (!reference.has(key)) problems.push(`orphan key            ${key}`)
  }

  problems.push(...emDashProblems(target))

  return { problems, total: target.size, nonLatin }
}

function main() {
  const codes = localeCodes()
  if (!codes.includes(REFERENCE)) {
    console.error(`check-locales: reference locale ${REFERENCE}.json not found in ${LOCALES_DIR}`)
    process.exit(1)
  }

  const reference = flatten(readLocale(REFERENCE))
  console.log(`reference ${REFERENCE}.json — ${reference.size} keys`)

  let failed = 0
  const referenceProblems = emDashProblems(reference)
  if (referenceProblems.length > 0) {
    failed += 1
    console.log(`  ${REFERENCE}.json — ${referenceProblems.length} problem(s)`)
    for (const problem of referenceProblems) console.log(`    ${problem}`)
  }
  for (const code of codes) {
    if (code === REFERENCE) continue
    const { problems, total, nonLatin } = checkLocale(code, reference)
    const script = nonLatin ? ', non-Latin script' : ''
    if (problems.length === 0) {
      console.log(`  ${code}.json — ${total} keys, parity OK${script}`)
      continue
    }
    failed += 1
    console.log(`  ${code}.json — ${total} keys, ${problems.length} problem(s)${script}`)
    for (const problem of problems) console.log(`    ${problem}`)
  }

  if (failed > 0) {
    console.error(`check-locales: ${failed} locale(s) out of parity with ${REFERENCE}.json`)
    process.exit(1)
  }
  console.log('check-locales: OK')
}

main()
