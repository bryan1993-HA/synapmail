#!/usr/bin/env node
/**
 * PR-29 follow-up: with `theme='system'` and a dark OS, the blocking script in
 * `app/layout.tsx` adds the `dark` class before paint, then `ThemeProvider` mounted with
 * `systemDark = useState(false)`: its first render resolved `system` to light, the apply
 * effect REMOVED the class, and only then did the matchMedia effect put it back — a
 * dark→light→dark flash on every load, the exact thing the rewrite promised to remove.
 *
 * Pure bench: the mount sequence is replayed against a fake `<html>` (one class set, one
 * `matchMedia` answer) with the REAL `resolveTheme()` / `applyResolvedTheme()` from
 * `lib/theme.ts`, driven by the initialiser the provider actually declares (read from
 * the source). A single render where the class is gone is a flash.
 *
 *   node --experimental-strip-types scripts/check-theme-mount.mjs
 *   node --experimental-strip-types scripts/check-theme-mount.mjs --negative
 *
 * NEGATIVE CONTROL (`--negative`): the source is judged as if it still started from
 * `useState(false)` (re-injected into a COPY of the text). The bench MUST go red.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const NEGATIVE = process.argv.includes('--negative')
const failures = []
const check = (label, ok, detail = '') => {
  if (ok) { console.log(`  ok   ${label}`); return }
  console.error(`  FAIL ${label}${detail ? `\n       ${detail}` : ''}`)
  failures.push(label)
}

// ---- fake browser: the OS is dark, the blocking script already ran -----------------
const classes = new Set()
globalThis.window = { matchMedia: () => ({ matches: true }) }
globalThis.document = {
  documentElement: { classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)) } },
}
const { DARK_CLASS, DARK_MEDIA_QUERY, resolveTheme, applyResolvedTheme } =
  await import(new URL('../lib/theme.ts', import.meta.url).href)

// ---- the initialiser the provider really declares ---------------------------------
const ROOT = new URL('..', import.meta.url)
let source = readFileSync(new URL('components/theme/ThemeProvider.tsx', ROOT), 'utf8')
if (NEGATIVE) source = source.replace(/useState\(prefersDark\)/, 'useState(false)')
const initialiser = source.match(/const \[systemDark, setSystemDark\] = useState(?:<[^>]*>)?\(([^)]*)\)/)?.[1]
check('ThemeProvider declares a systemDark state', initialiser !== undefined)

// `prefersDark` is the provider's own helper: same body, replayed here.
const prefersDark = () => window.matchMedia(DARK_MEDIA_QUERY).matches
const initialSystemDark = initialiser === 'prefersDark' ? prefersDark() : initialiser === 'false' ? false : undefined
check(`the initialiser is one the bench understands (${initialiser})`, initialSystemDark !== undefined)

// ---- replay the mount: render → apply effect → matchMedia effect → maybe re-render ----
function mount(theme, systemDarkAtFirstRender) {
  classes.clear()
  if (theme === 'system' && prefersDark()) classes.add(DARK_CLASS) // the blocking script
  const history = [classes.has(DARK_CLASS)]
  let systemDark = systemDarkAtFirstRender
  applyResolvedTheme(resolveTheme(theme, systemDark))
  history.push(classes.has(DARK_CLASS))
  const live = prefersDark()
  if (live !== systemDark) { systemDark = live; applyResolvedTheme(resolveTheme(theme, systemDark)); history.push(classes.has(DARK_CLASS)) }
  return history
}

check('contract: resolveTheme(system, dark OS) is dark', resolveTheme('system', true) === 'dark')
const systemDarkOs = mount('system', initialSystemDark)
check('system theme on a dark OS: the dark class is never removed across the mount',
  systemDarkOs.every(Boolean), `class present per step: ${JSON.stringify(systemDarkOs)}`)
check('system theme on a dark OS: one render is enough (no second apply)', systemDarkOs.length === 2,
  `${systemDarkOs.length - 1} apply step(s)`)
check('explicit dark theme: dark from the first render', mount('dark', initialSystemDark).slice(1).every(Boolean))
check('explicit light theme on a dark OS: never dark', mount('light', initialSystemDark).slice(1).every(v => !v))

// ---- hydration safety: a client-only initial value must not reach any markup -------
const walk = dir => readdirSync(dir).flatMap(name => {
  const p = join(dir, name)
  return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(name) ? [p] : []
})
const leaks = ['components', 'app'].flatMap(d => walk(new URL(d, ROOT).pathname))
  .filter(p => !p.endsWith('components/theme/ThemeProvider.tsx') && /resolvedTheme/.test(readFileSync(p, 'utf8')))
check('resolvedTheme is rendered by no component (so SSR false vs client true cannot mismatch hydration)',
  leaks.length === 0, leaks.join(', '))

if (NEGATIVE) {
  if (failures.length) { console.log(`\nnegative control: ${failures.length} assertion(s) fell, as expected`); process.exit(0) }
  console.error('\nSILENT NEGATIVE CONTROL: useState(false) kept the bench green — it measures nothing')
  process.exit(1)
}
if (failures.length) { console.error(`\n${failures.length} failure(s)`); process.exit(1) }
console.log('\ntheme mount without flash: OK')
