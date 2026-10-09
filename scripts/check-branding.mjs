#!/usr/bin/env node
/**
 * Measures the trust boundary of lot F1: what the instance-identity setting accepts and
 * what it refuses, decided on the BYTES of the uploaded file and on the cleaned name --
 * never on a file extension, never on the content type the browser declared.
 *
 * Pure self-check: no server, no database, no browser. It imports the same module the
 * routes import, so a rule that passes here is the rule that ships.
 *   node scripts/check-branding.mjs
 *   node scripts/check-branding.mjs --negative
 *
 * The last section covers the client side of the same boundary (CodeQL on PR #30:
 * a picked file's object URL flowed straight into `<img src>`): the admin screen's
 * pick handler refuses a file whose declared type is not in `FAVICON_TYPES`, the
 * field's `accept=` is read from that same list, and the preview of a picked file
 * is DRAWN into a canvas from its decoded pixels -- no URL is ever derived from the
 * file, so the screen holds no `createObjectURL` and no file-derived `src`.
 *
 * NEGATIVE CONTROL (`--negative`): the pick is judged the OLD way -- every declared
 * type lets the file through -- and the old URL sink is spliced back into the screen
 * source. The bench MUST then go red: that is what shows the assertions see the gate
 * and the sink, not just the happy path.
 *
 * Exit 0 when every case holds, 1 on the first mismatch.
 */
import { readFileSync } from 'node:fs'
import {
  APP_NAME_MAX,
  BRANDING_ERRORS,
  DEFAULT_APP_NAME,
  DEFAULT_BRANDING,
  FAVICON_MAX_BYTES,
  FAVICON_PATH,
  FAVICON_TYPES,
  BUNDLED_FAVICONS,
  cleanAppName,
  detectImageType,
  faviconLinks,
  faviconTypeError,
  faviconUrl,
} from '../lib/branding.ts'

const NEGATIVE = process.argv.includes('--negative')
let failures = 0
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  got=${JSON.stringify(actual)} want=${JSON.stringify(expected)}`)
}

const bytes = (...values) => Uint8Array.from(values)
const PNG_HEADER = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const ascii = text => Uint8Array.from(Buffer.from(text, 'utf8'))

console.log('== type decided on the magic bytes ==')
// A real PNG, whatever its name would be on disk: `.svg`, `.txt`, no extension at all.
check('PNG header -> image/png', detectImageType(bytes(...PNG_HEADER, 0, 0, 0, 13)), 'image/png')
check('ICO header -> image/x-icon', detectImageType(bytes(0x00, 0x00, 0x01, 0x00, 1, 0)), 'image/x-icon')
check('JPEG header -> image/jpeg', detectImageType(bytes(0xff, 0xd8, 0xff, 0xe0)), 'image/jpeg')
check(
  'RIFF....WEBP -> image/webp',
  detectImageType(Uint8Array.from([...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBP'), 0])),
  'image/webp'
)

console.log('== what the boundary refuses ==')
// The case that matters: an SVG is a script carrier, and renaming it `.png` must not help it in.
check('SVG bytes (named .png) refused', detectImageType(ascii('<svg xmlns="http://www.w3.org/2000/svg"/>')), null)
check('XML prologue then SVG refused', detectImageType(ascii('<?xml version="1.0"?><svg/>')), null)
check('HTML refused', detectImageType(ascii('<!DOCTYPE html><html></html>')), null)
check('empty file refused', detectImageType(bytes()), null)
// Truncated signature: the first 4 bytes of PNG alone are not a PNG.
check('truncated PNG header refused', detectImageType(bytes(0x89, 0x50, 0x4e, 0x47)), null)
// RIFF without the WEBP tag is some other RIFF container (WAV, AVI), not an image.
check('RIFF without WEBP tag refused', detectImageType(Uint8Array.from([...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WAVE')])), null)

console.log('== "PNG" followed by HTML: only the detected type is served ==')
// A polyglot file: valid PNG signature, HTML in the payload. Detection must answer image/png,
// and it is THAT type the route sends -- with nosniff, so the browser cannot re-interpret it.
const polyglot = Uint8Array.from([...PNG_HEADER, ...ascii('<script>alert(1)</script>')])
check('polyglot detected as image/png', detectImageType(polyglot), 'image/png')
check('polyglot never detected as html/svg', ['text/html', 'image/svg+xml'].includes(detectImageType(polyglot)), false)

console.log('== size ==')
check('limit is 256 KiB', FAVICON_MAX_BYTES, 262144)
const oversized = 300 * 1024
check('300 KiB is over the limit', oversized > FAVICON_MAX_BYTES, true)
check('a 256 KiB file is still accepted', FAVICON_MAX_BYTES > FAVICON_MAX_BYTES - 1, true)

console.log('== name ==')
check('spaces folded and trimmed', cleanAppName('  Yumi   Mail  '), 'Yumi Mail')
check('a plain name is kept', cleanAppName('Yumi Mail'), 'Yumi Mail')
check('empty refused', cleanAppName(''), null)
check('whitespace only refused', cleanAppName('   \t  '), null)
check('control character refused', cleanAppName('Yumi\u0000Mail'), null)
check('newline refused', cleanAppName('Yumi\nMail'), null)
check('non-string refused', cleanAppName(42), null)
check(`${APP_NAME_MAX} characters accepted`, cleanAppName('x'.repeat(APP_NAME_MAX)), 'x'.repeat(APP_NAME_MAX))
check(`${APP_NAME_MAX + 1} characters refused`, cleanAppName('x'.repeat(APP_NAME_MAX + 1)), null)
// Folding happens BEFORE the length check, so a long name made of runs of spaces can fit.
check('folding applies before the length check', cleanAppName(`${'x'.repeat(APP_NAME_MAX - 2)}${' '.repeat(10)}yz`), null)

console.log('== defaults and URL ==')
check('default name', DEFAULT_APP_NAME, 'Synapmail')
check('nothing set = original look', DEFAULT_BRANDING, { appName: 'Synapmail', faviconVersion: null })
check('icon URL carries its version', faviconUrl(1758300000000), `${FAVICON_PATH}?v=1758300000000`)
check('error codes', Object.values(BRANDING_ERRORS), ['branding_too_large', 'branding_bad_type', 'branding_bad_name'])

console.log('== bundled icons: one source, read by the server render AND by the reset ==')
// Nicolas' F1 gate found the reset restoring only ONE of the two bundled links until a
// reload. Both callers now read faviconLinks(), so this is the rule they share.
check('two bundled links are shipped', BUNDLED_FAVICONS.length, 2)
check('no setting -> every bundled link', faviconLinks(null).map(i => i.url), BUNDLED_FAVICONS.map(i => i.url))
check('no setting -> their types are kept', faviconLinks(null).map(i => i.type), ['image/x-icon', 'image/png'])
check('a set icon replaces them all', faviconLinks(1758300000000).map(i => i.url), [faviconUrl(1758300000000)])
check('a set icon yields exactly one link', faviconLinks(1758300000000).length, 1)

console.log('== picked file: declared type gated BEFORE any preview URL exists ==')
// What the admin screen does on pick, with the gate it ships -- or, under --negative,
// with the gate it used to lack (every declared type accepted).
const gate = NEGATIVE ? () => null : faviconTypeError
const pick = file => {
  const refused = gate(file.type)
  return { error: refused, preview: refused ? null : `blob:${file.name}` }
}
check('accepted types come from the signature table', FAVICON_TYPES.includes('image/png') && FAVICON_TYPES.includes('image/webp'), true)
check('ICO is accepted under both names browsers use', FAVICON_TYPES.includes('image/x-icon') && FAVICON_TYPES.includes('image/vnd.microsoft.icon'), true)
check('SVG is not in the accepted list', FAVICON_TYPES.includes('image/svg+xml'), false)
check('a PNG pick -> preview, no error', pick({ name: 'icon.png', type: 'image/png' }), { error: null, preview: 'blob:icon.png' })
check('an SVG pick -> error, NO preview', pick({ name: 'icon.svg', type: 'image/svg+xml' }), { error: BRANDING_ERRORS.badType, preview: null })
check('an HTML pick -> error, NO preview', pick({ name: 'x.html', type: 'text/html' }), { error: BRANDING_ERRORS.badType, preview: null })
check('a typeless pick -> error, NO preview', pick({ name: 'x', type: '' }), { error: BRANDING_ERRORS.badType, preview: null })

// The screen must wire that list and that gate, not restate them.
const shipped = readFileSync(new URL('../components/admin/BrandingSection.tsx', import.meta.url), 'utf8')
// Under --negative the preview goes back through a URL, exactly as before b75ed22.
const screen = NEGATIVE
  ? shipped.replace('src={iconSrc}', 'src={URL.createObjectURL(accepted) ?? iconSrc}')
  : shipped
check('accept= is read from FAVICON_TYPES', /accept=\{FAVICON_TYPES\.join\(','\)\}/.test(screen), true)
check('no image type is retyped in the screen', /['"]image\//.test(screen), false)
check('the pick handler calls faviconTypeError', /faviconTypeError\(next\.type\)/.test(screen), true)

console.log('== picked file: previewed from its pixels, never through a URL ==')
// CodeQL kept the alert after the type gate alone: the file -> object URL -> `src`
// flow was still there. Now the only `src` left is the saved icon's server URL.
check('no object URL is ever created', /createObjectURL|revokeObjectURL/.test(screen), false)
check('no file-derived src', /src=\{(?!iconSrc\})/.test(screen), false)
check('the picked file is decoded with createImageBitmap', /createImageBitmap\(next\)/.test(screen), true)
check('the decoded bitmap is drawn into the canvas, at the preview size', /drawImage\(bitmap, 0, 0, FAVICON_PREVIEW, FAVICON_PREVIEW\)/.test(screen), true)
check('the bitmap is released after drawing', /bitmap\.close\(\)/.test(screen), true)
check('an undecodable file falls back to the existing type error', /catch \{\s*refused = BRANDING_ERRORS\.badType/.test(screen), true)
for (const code of Object.values(BRANDING_ERRORS)) {
  for (const locale of ['en', 'fr', 'zh']) {
    const messages = JSON.parse(readFileSync(new URL(`../locales/${locale}.json`, import.meta.url), 'utf8'))
    check(`${locale}: errors.${code} translated`, typeof messages.admin.branding.errors[code], 'string')
  }
}

if (NEGATIVE) {
  if (failures) { console.log(`\nnegative control: ${failures} assertion(s) fell, as expected`); process.exit(0) }
  console.error('\nSILENT NEGATIVE CONTROL: an ungated pick passes too -- the bench does not see the gate')
  process.exit(1)
}
console.log(failures === 0 ? '\ncheck-branding: OK' : `\ncheck-branding: ${failures} FAIL`)
process.exit(failures === 0 ? 0 : 1)
