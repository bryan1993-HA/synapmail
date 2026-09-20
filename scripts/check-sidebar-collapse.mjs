#!/usr/bin/env node
/**
 * Measures the sidebar collapse: every icon must keep its exact position and
 * every row its exact height when the bar folds. Then measures every account
 * bubble: the unread badge must sit ON the corner without covering the initial,
 * and the initial must stay readable on every colour of the palette.
 * Fails (exit 1) on any drift or any bubble under the thresholds.
 *
 * Needs a running dev server and SYNAPMAIL_TEST_* credentials (see .env).
 *   node scripts/check-sidebar-collapse.mjs
 */
import { readFileSync } from 'node:fs'
import puppeteer from 'puppeteer-core'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
// Tolerance for a position/size drift, in CSS pixels. Sub-pixel layout rounding
// is expected; anything a human could see is not. GOAL.md fixes this at 1 px.
const MAX_DRIFT_PX = 1
const VIEWPORT = { width: 1440, height: 900 }
// Clearance demanded between the share mark and the fold chevron of the
// header row. Origin: the spec's floor of a gap >= 6 px; the product lays the
// two columns out 8 px apart (ACCOUNT_ROW_RIGHT.gap in components/layout/Sidebar.tsx),
// so the floor is the spec's, not the implementation's. Bench: this file, 1440x900.
const MIN_CONTROL_GAP_PX = 6
// No round button straddles the bar's edge any more: the bar now
// folds from the application header's menu button. The old marker must be absent.
const EDGE_TOGGLE = '[data-sidebar-edge-toggle]'
// Same trap for the drawer itself: the desktop <aside> stays in the DOM below `lg` with
// a 0x0 box, so `[data-sidebar]` alone resolves to it and every mobile measurement taken
// through it is vacuous (observed: "256px off the edge", and a drawer reported still open
// after it had closed). The drawer is addressed through its own marker.
const DRAWER = '[data-sidebar-drawer]'
// The application header's menu button — the app's ONLY bar control:
// above `lg` it folds the bar, below it opens the drawer. Selecting "the first button
// of main" once clicked whatever the page rendered first and reported a drawer that
// never opened (a harness failure, not a product one), so it is addressed by marker.
const DRAWER_TRIGGER = '[data-omnibar-menu]'
// Badge geometry thresholds, from a visual review that rejected a badge
// covering 37% of the bubble and 40% of the initial's text box: the badge may clip the
// bubble's corner, but the letter underneath must stay whole.
const MAX_BADGE_OVER_BUBBLE = 0.25
const MAX_BADGE_OVER_GLYPH = 0
// WCAG AA floor for small bold text — the letters are 9-12px, so 4.5:1 is the minimum.
const MIN_CONTRAST = 4.5
// A bubble carries TWO letters, never one: a lone initial reads as an accident.
const BUBBLE_LETTERS = 2
// Every name and email of the account list starts at the same x. Same tolerance
// as the collapse contract (MAX_DRIFT_PX) — one pixel is where sub-pixel text layout lands,
// anything above it is a real indent difference between two rows.
const MAX_TEXT_X_SPREAD_PX = MAX_DRIFT_PX

/**
 * The unfolded account list is the bar's own surface, so it may not round its
 * corners like the card it replaces: 0 px is the target and 1 px the tolerance for a
 * sub-pixel resolved value, calibrated against the bar's own root (radius 0) in the same
 * run — the card this lot removes measured 12 px (`rounded-xl`).
 */
const MAX_LIST_RADIUS_PX = 1
/**
 * Fraction of an unread badge's own box that must survive every clipping ancestor.
 * 1 = nothing may be cropped, which is the whole point of the change (the reported
 * defect was the first account's badge being cut); the card it replaces cropped the
 * first row's badge to ~50 %.
 * No calibration bench: the criterion is geometric, not a measured threshold.
 */
const MIN_BADGE_VISIBLE = 1
// The sentence that must NOT be rendered any more, and the destination of the
// glyph that replaces it. Both are read from the shipped sources (`locales/fr.json`,
// `components/settings/SettingsSidebar.tsx`) so this check follows the product instead of
// carrying its own stale copy. The prefix stops at the interpolation: only the fixed part
// of `sharedBy` can be matched against rendered text.
const SHARED_BY_PREFIX = JSON.parse(readFileSync(new URL('../locales/fr.json', import.meta.url), 'utf8'))
  .mail.sharedBy.split('{')[0].trim()
const ACCOUNTS_SETTINGS_HREF = readFileSync(new URL('../components/settings/SettingsSidebar.tsx', import.meta.url), 'utf8')
  .match(/ACCOUNTS_SETTINGS_HREF\s*=\s*'([^']+)'/)?.[1]
/**
 * The separator the collapsed account tooltip must use between a name and an
 * address. House rule: no em dash in product copy. Read out of the shipped `accountTooltip`
 * sentence (placeholders stripped) so this check follows the locale instead of carrying its
 * own copy of the glyph; the em dash below is the character the rule forbids, not a target.
 */
const ACCOUNT_TOOLTIP_SEPARATOR = JSON.parse(readFileSync(new URL('../locales/fr.json', import.meta.url), 'utf8'))
  .mail.accountTooltip.replace(/\{\w+\}/g, '').trim()
const FORBIDDEN_DASH = '\u2014'
if (!ACCOUNT_TOOLTIP_SEPARATOR || ACCOUNT_TOOLTIP_SEPARATOR.includes(FORBIDDEN_DASH)) {
  console.error(`HARNESS: locales/fr.json accountTooltip separates with "${ACCOUNT_TOOLTIP_SEPARATOR}" — unusable as the expected separator`)
  process.exit(2)
}
if (!SHARED_BY_PREFIX || !ACCOUNTS_SETTINGS_HREF) {
  console.error('HARNESS: could not read the sharedBy sentence or the accounts href from the shipped sources')
  process.exit(2)
}
// ...and the ACTIVE account is not in it: it already heads the bar, so the list only
// offers the accounts one can switch TO, none of them marked.
// ...and those letters must stay INSIDE the circle. The inked box is measured with a
// Range over the text node (the span is a flex child stretched to the line box, so its
// own rect says nothing about where the ink is), and compared against the bubble's box
// shrunk by this margin on each side — the visual breathing room a reviewer asks for.
const GLYPH_INSET_PX = 2
// The bar's scrollbar is DRAWN (`components/layout/ThinScroll.tsx`), because a
// native bar cannot fade. These mirror THIN_SCROLL there: one source, asserted here.
const THIN_SCROLL_WIDTH_PX = 6
const THIN_SCROLL_IDLE_MS = 2000
const THIN_SCROLL_FADE_MS = 300
// A drawn thumb at opacity 1 is still invisible if nothing is painted in it: the shipped
// ink is `color-mix(in srgb, currentColor 22%, transparent)`, so any alpha above zero means
// a rule applied, and zero means it did not (observed on `bg-foreground/25`, which compiles
// to nothing on this project's raw `var(--x)` colour tokens). The criterion is "painted at
// all", not a calibrated constant — the 22% itself is asserted by the same-run A/B below.
const THUMB_MIN_ALPHA = 0
// Margin over `idleMs + fadeMs` before reading the faded-out state: covers the timer's
// own scheduling slack on a loaded headless bench. Not a threshold on the product —
// the criterion is the opacity, which is 1 or 0, not a measured constant.
const FADE_SETTLE_MS = 800
// Thumb height is clientHeight²/scrollHeight, thumb top is that ratio applied to the
// scroll offset. Both are RECOMPUTED from the same run's own scroll metrics, never
// compared to a constant. 1 px is sub-pixel layout rounding, as everywhere here.
const MAX_THUMB_DRIFT_PX = MAX_DRIFT_PX
// Mobile width GOAL.md fixes for the drawer check: no horizontal overflow at 390.
const MOBILE_VIEWPORT = { width: 390, height: 844 }
// The bar must follow the theme. Discriminating criterion, measured on the SAME run
// in both themes: the bar's own background must differ between light and dark. A bar
// painted with a fixed dark value (the `bg-zinc-950`/gradient this lot removed) reports
// the identical colour in both and fails here.
const THEMES = ['light', 'dark']
// Accent budget: every accent-bearing surface of the bar must belong to ONE hue family.
// Tints of one accent share its hue by construction, so the discriminating measure is the
// SPREAD of hue angles, not the count of colours. Origin: the bar's accent is violet-600
// (hue ~272 deg); the states this lot removed — the violet->blue Compose gradient and its
// blue ring — put a second family ~60 deg away, far outside this band. 15 deg leaves room
// for the rounding of an alpha-composited tint and nothing else. Verified failable: see
// the negative control in the Journal.
const MAX_ACCENT_HUE_SPREAD_DEG = 15
// Below this saturation a painted surface is a neutral (the bar's own greys), not an accent.
const ACCENT_MIN_SATURATION = 0.12

// A custom folder is told apart when the bar is folded by the characters on its
// tile, and a tile carries EXACTLY two of them — not a floor of two with a ceiling above.
// Measured on the largest real mailbox of the test database (92 custom folders, reviewed
// 19/09/2026): the previous lengthening rule produced 13 three-character tiles whose ink
// spilled 2.2 to 4.7 px past the 16 px plate, AND still left duplicate pairs. Three glyphs
// at the 10 px semibold this plate is drawn for do not fit in it, in either direction.
const FOLDER_GLYPH_LETTERS = 2
// Stand-in the rule pads with when a name has only one character to give (FolderGlyph's
// `GLYPH_PAD`): the only character a tile may carry that its folder's name does not.
const GLYPH_PAD = '\u00b7'
// The tile must READ as a tile, not as letters floating on the bar. Origin: a human
// review measured the shipped `bg-secondary` fill at 1.03:1 (light) and 1.30:1 (dark)
// against the bar and could not see a plate at all; the ceiling it asked for is 1.5:1.
// Calibration bench: this script, headless Chrome, the bar's own light/dark `--sidebar`
// — the shipped 24 % mix measures ~1.9:1 in both themes, so the floor is not grazed.
// Same-run reference: the BAR's own background is read in the same pass, in the same
// theme, from the same rendered page — the ratio is a measured A/B, not a bare constant.
const FOLDER_GLYPH_MIN_TILE_CONTRAST = 1.5
// Two letters at a readable weight do not fit a 16 px plate: measured on this bench, in
// this browser, with the app's own system stack, the widest pair the rule can produce
// (`WM`) inks 17.88 px at the 10 px semibold / 0.3 px tracking the design asks for,
// and still 16.69 px at 9 px with no tracking. The plate size is fixed by the collapse
// contract (it IS a row icon), so a small symmetric bleed is inherent, not a defect —
// what would be a defect is a letter CLIPPED or pushed out of the icon column, both
// checked separately. 1.2 px per side leaves room for the widest pair and nothing more.
const FOLDER_GLYPH_MAX_PLATE_BLEED_PX = 1.2
// The tile must stay monochrome: it carries no accent, so its ink and its background must
// be grey — measured as HSV saturation, the same metric the cleanliness pass already uses.
const FOLDER_GLYPH_MAX_SATURATION = ACCENT_MIN_SATURATION
// A folder tile is a CASE; an account bubble is a BUBBLE. A visual review
// found the two wearing one shape: `rounded-md` resolves to `calc(var(--radius) - 2px)`
// = 8 px in this theme, and 8 px on a 16 px box is a perfect circle. The two ceilings
// below are a SHAPE A/B measured in the same pass on the same page: the tile's corner
// must stay far from half its box, the bubble's must stay at half its own. 4 px on a
// 16 px plate is a quarter of the side — visibly square, still softened.
// Calibration bench: this script, headless Chrome, the shipped tile at 16 px.
const FOLDER_GLYPH_MAX_RADIUS_PX = 4
// A bubble is round when its corner reaches half its own side; below that it is a case.
const BUBBLE_MIN_RADIUS_RATIO = 0.5

// This project maps every theme colour to a bare `var(--x)`, a form Tailwind
// cannot compose an alpha onto — it emitted NO rule at all for the slash variants the bar
// is written with, so a folder row had no hover feedback whatsoever (measured: background-
// color rgba(0, 0, 0, 0) at rest AND under the pointer, identical) and resting label ink
// rendered at full strength instead of the 70 % it asks for. The check
// below is a same-run A/B on ONE real row: its computed background at rest vs under a
// real pointer move. No absolute colour is demanded — only that the two differ, which is
// exactly what a dropped rule cannot produce.
// Calibration bench: this script, headless Chrome, the shipped bar, both themes.
const HOVER_MIN_ALPHA = 0.01

// The bar's accent must BE the active account's own colour, so that switching
// mailbox repaints the whole bar rather than leaving one violet bar behind five coloured
// bubbles. The check is a same-run A/B across TWO accounts of different colours: for each,
// the accent-bearing surfaces of the bar (active folder tint, unread badge, selection
// ring, shadows) are read back and compared to the colour of THAT account's own bubble,
// measured in the same pass on the same page — never to a constant, so the check stays
// true if the palette changes. Hue is the comparison axis: a tint keeps its accent's hue
// and loses only its saturation, so demanding equal rgb would fail by construction.
// 6 deg leaves room for the rounding of an alpha-composited tint read back through a
// canvas and nothing else — the palette's own families sit 60+ deg apart.
// Calibration bench: this script, headless Chrome, the shipped bar, both themes.
const MAX_ACCOUNT_ACCENT_HUE_DRIFT_DEG = 6
// An accent surface that paints nothing has no hue to compare: below this alpha the
// custom property did not resolve (the class never compiled) and the check must say so
// rather than silently pass on a colour nobody can see.
const ACCENT_MIN_ALPHA = 0.05

// Colour tokens inside a composite computed value (background-image gradient, box-shadow).
const COLOUR_TOKEN_SOURCE = '(?:rgba?|hsla?|oklch|oklab|lab|lch|color)\\([^)]*\\)'
// Transition is 180 ms (SIDEBAR.transitionMs); wait well past it before measuring.
const SETTLE_MS = 600

for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
}

const { SYNAPMAIL_TEST_URL: BASE, SYNAPMAIL_TEST_EMAIL: EMAIL, SYNAPMAIL_TEST_PASSWORD: PASSWORD } = process.env
for (const [k, v] of Object.entries({ SYNAPMAIL_TEST_URL: BASE, SYNAPMAIL_TEST_EMAIL: EMAIL, SYNAPMAIL_TEST_PASSWORD: PASSWORD })) {
  if (!v) { console.error(`HARNESS: ${k} is not set`); process.exit(2) }
}

/** Reads the geometry of every sidebar icon and row, keyed so both states match up. */
const probe = strayToggle => {
  const bar = document.querySelector('[data-sidebar]')
  if (!bar) return null
  const rows = [...bar.querySelectorAll('[data-sidebar-row]')].filter(r => !r.closest('[data-account-list]'))
  const aside = bar.closest('aside')
  const asideRect = aside?.getBoundingClientRect()
  return {
    collapsed: bar.dataset.collapsed,
    asideRight: asideRect ? asideRect.right : null,
    // There is no floating round toggle: its absence is measured in the same
    // frame as the geometry, in BOTH states, so a re-introduction fails here.
    strayToggles: document.querySelectorAll(strayToggle).length,
    horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    rows: rows.map((row, i) => {
      const r = row.getBoundingClientRect()
      // Explicit marker — never selector order, which a badge or a decoration could steal.
      const iconEl = row.querySelector('[data-sidebar-icon]')
      const ic = iconEl?.getBoundingClientRect()
      return {
        key: row.dataset.sidebarRow,
        rowHeight: r.height,
        iconX: ic ? ic.x : null,
        iconY: ic ? ic.y : null,
        iconW: ic ? ic.width : null,
        iconH: ic ? ic.height : null,
      }
    }),
  }
}

/**
 * Reads every account bubble: how much of it (and of its initial's text box) the
 * unread badge covers, and the contrast of the initial against the bubble colour.
 * Overlap is measured between bounding boxes — the same metric a reviewer reads on screen.
 */
const probeBubbles = () => {
  const rgb = c => c.match(/[\d.]+/g).slice(0, 3).map(Number)
  const lum = c => {
    const [r, g, b] = rgb(c).map(v => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4) })
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)]; return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }
  const overlap = (a, b) => {
    const w = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left))
    const h = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))
    return w * h
  }
  const inkBox = node => {
    const range = document.createRange()
    range.selectNodeContents(node)
    return range.getBoundingClientRect()
  }
  // The painted corner, in pixels. `rounded-full` computes to a huge length (or to
  // `calc(infinity * 1px)`), which parses to Infinity — clamped to half the box, the
  // largest radius a box can actually paint, so the ratio below stays meaningful.
  const cornerPx = (el, cs) => {
    const box = Math.min(el.getBoundingClientRect().width, el.getBoundingClientRect().height)
    const raw = parseFloat(cs.borderTopLeftRadius)
    return Number.isFinite(raw) ? Math.min(raw, box / 2) : box / 2
  }
  return [...document.querySelectorAll('[data-account-initial]')].map(glyph => {
    const bubble = glyph.parentElement
    const wrapper = bubble.parentElement
    const badge = wrapper.querySelector('[data-unread-badge]')
    const gr = inkBox(glyph)
    const br = bubble.getBoundingClientRect()
    const dr = badge?.getBoundingClientRect()
    const style = getComputedStyle(bubble)
    return {
      where: wrapper.closest('[data-sidebar-row="account"]') ? 'header' : 'list row',
      initial: glyph.textContent,
      letters: [...(glyph.textContent ?? '')].length,
      fontSize: getComputedStyle(glyph).fontSize,
      bubbleW: br.width,
      // Signed slack on each side: how far the inked text sits from the bubble's rim.
      // Negative on any side = a letter touching or crossing the circle.
      slack: { left: gr.left - br.left, right: br.right - gr.right, top: gr.top - br.top, bottom: br.bottom - gr.bottom },
      badgeText: badge?.textContent ?? '',
      overBubble: dr ? overlap(dr, br) / (br.width * br.height) : 0,
      overGlyph: dr && gr.width && gr.height ? overlap(dr, gr) / (gr.width * gr.height) : 0,
      radiusPx: cornerPx(bubble, style),
      boxPx: Math.min(br.width, br.height),
      bg: style.backgroundColor,
      contrast: contrast(style.backgroundColor, getComputedStyle(glyph).color),
    }
  })
}

/**
 * Reads the account popover as a LIST: the x at which each row's text starts, how many
 * bubbles wear the selection ring, and whether any check glyph survives. The text x is
 * taken from the inked box of each line (Range over the text node), not from its span —
 * a truncating flex child is as wide as its slot, so its rect would report the same x
 * even if the ink were centred inside it, and the check this backs would pass vacuously.
 */
const probeAccountList = () => {
  const popover = document.querySelector('[data-account-list-open="true"]')
  if (!popover) return null
  // The INKED box of a line, not its element's: a truncated name fills its span, so the
  // span's right edge says nothing about where the glyphs actually stop.
  const inkBox = node => {
    const range = document.createRange()
    range.selectNodeContents(node)
    const r = range.getBoundingClientRect()
    return r.width ? r : null
  }
  const inkLeft = node => inkBox(node)?.left ?? null
  const header = document.querySelector('[data-sidebar-row="account"]')
  const headerLines = header
    ? [...header.querySelectorAll('span.block')].map(l => (l.textContent ?? '').trim()).filter(Boolean)
    : []
  const rows = [...popover.querySelectorAll('button')].map(row => {
    const lines = [...row.querySelectorAll('span.block')]
      .map(line => {
        const ink = inkBox(line)
        return { text: (line.textContent ?? '').trim(), x: ink?.left ?? null, right: ink?.right ?? null }
      })
      .filter(l => l.x !== null)
    const bubble = row.querySelector('[data-account-initial]')?.parentElement
    // The mark is a sibling of the button (a link inside a button is invalid
    // HTML), so it is read from the row's wrapper, not from the button itself.
    const mark = row.parentElement?.querySelector('[data-account-shared-mark]') ?? null
    const markBox = mark?.getBoundingClientRect() ?? null
    const rowBox = row.getBoundingClientRect()
    return {
      label: lines[0]?.text ?? '(no text)',
      lines,
      ring: bubble ? getComputedStyle(bubble).boxShadow : '',
      textAlign: getComputedStyle(row).textAlign,
      bubbleX: bubble ? bubble.getBoundingClientRect().left : null,
      mark: markBox
        ? {
            href: mark.getAttribute('href'),
            label: mark.getAttribute('aria-label') ?? '',
            svgs: mark.querySelectorAll('svg').length,
            x: markBox.left, right: markBox.right,
            cy: markBox.top + markBox.height / 2,
            inRow: markBox.right <= rowBox.right + 1 && markBox.left >= rowBox.left,
          }
        : null,
      rowCy: rowBox.top + rowBox.height / 2,
      rowRight: rowBox.right,
      // In the unfolded list too, a list row's mark is laid
      // out from the same columns as the header's, so it is measured the same way —
      // against the text it must never cover, and against the bar's own edge.
      textRight: Math.max(...lines.map(l => l.right ?? -Infinity)),
    }
  })
  return {
    rows,
    headerLines,
    barRight: popover.closest('[data-sidebar]')?.getBoundingClientRect().right ?? null,
    // The whole popover's text, so a re-introduced "shared by" LINE is caught wherever
    // it comes back — the target is one glyph, not one glyph plus the old sentence.
    popoverText: (popover.textContent ?? '').trim(),
    headerMarks: document.querySelectorAll('[data-sidebar] [data-account-shared-mark]').length,
    // In the header row the mark and the fold chevron are two clickable
    // boxes in two different flows (absolute link / in-flow span). Their overlap is
    // measured, not assumed: the x-intersection of the two boxes, in pixels.
    // All three boxes are read from the SAME bar: the page can carry two (desktop bar
    // + mobile drawer), and taking the mark from one and the chevron from the other
    // reports a 123 px gap and a 188 px spill that describe no bar that exists.
    headerControls: (() => {
      const row = document.querySelector('[data-sidebar] [data-sidebar-row="account"]')
      const bar = row?.closest('[data-sidebar]')
      // The list of other accounts is a SIBLING block under the same wrapper and every
      // shared row in it carries the same marker, so a lookup widened by one ancestor
      // returns a LIST row's mark whenever the active account is not itself shared — a
      // box that has nothing to do with the header and that happened to land on the
      // chevron's own 28 px. That list is not a fixed popover but an
      // in-bar accordion, so the exclusion is read from the accordion's own marker.
      const mark = [...(row?.parentElement?.querySelectorAll('[data-account-shared-mark]') ?? [])]
        .find(m => !m.closest('[data-account-list]'))
      const chevron = bar?.querySelector('[data-account-chevron]')
      if (!mark || !chevron) return { mark: !!mark, chevron: !!chevron, overlapPx: null }
      // What a human can see, not what the layout engine reports: a collapsed bar folds
      // the label to zero width behind `overflow: hidden`, so the chevron keeps a box at
      // its old x while being painted nowhere. Clipping it against its scrolling/hiding
      // ancestors is what turns "the element's box" into "the pixels on screen" — without
      // it the collapsed bar reports an 81 px spill that nobody can point at.
      const visible = el => {
        let r = el.getBoundingClientRect()
        for (let a = el.parentElement; a; a = a.parentElement) {
          const o = getComputedStyle(a)
          if (o.overflowX === 'visible' && o.overflowY === 'visible') continue
          const k = a.getBoundingClientRect()
          r = {
            left: Math.max(r.left, k.left), right: Math.min(r.right, k.right),
            top: Math.max(r.top, k.top), bottom: Math.min(r.bottom, k.bottom),
          }
        }
        const width = Math.max(0, r.right - r.left)
        return { left: r.left, right: r.right, width, painted: width > 0 }
      }
      const m = visible(mark)
      const c = visible(chevron)
      const b = bar.getBoundingClientRect()
      // A control folded out of sight cannot overlap or spill: it is reported, not judged.
      if (!m.painted || !c.painted) {
        return {
          mark: true, chevron: true,
          markBox: { left: m.left, right: m.right }, chevronBox: { left: c.left, right: c.right },
          painted: { mark: m.painted, chevron: c.painted },
          overlapPx: null, gapPx: null, overflowPx: null,
        }
      }
      return {
        mark: true, chevron: true,
        painted: { mark: true, chevron: true },
        markBox: { left: m.left, right: m.right },
        chevronBox: { left: c.left, right: c.right },
        overlapPx: Math.max(0, Math.min(m.right, c.right) - Math.max(m.left, c.left)),
        gapPx: Math.max(m.left, c.left) - Math.min(m.right, c.right),
        // Neither control may spill past the bar's own right edge.
        overflowPx: Math.max(0, Math.max(m.right, c.right) - b.right),
      }
    })(),
    // Any lucide check, however it is classed, plus the raw glyph as a second net.
    checkGlyphs: popover.querySelectorAll('svg.lucide-check, [class*="lucide-check"]').length,
    checkChars: ((popover.textContent ?? '').match(/[✓✔]/g) ?? []).length,
  }
}

/**
 * The list of accounts unfolds INSIDE the bar. Reads, for the list as it is
 * currently rendered: how it is positioned (a `fixed` layer would be the card this lot
 * removes), and — for every unread badge it carries — how much of the badge's own box
 * actually survives clipping. Visibility is computed by walking the ancestors and
 * intersecting the badge with each scrolling/clipping box, which is what a user sees:
 * a badge "present in the DOM" inside an `overflow-hidden` parent is still invisible.
 */
const probeAccountListBox = () => {
  const list = document.querySelector('[data-account-list-open="true"]')
  if (!list) return null
  const bar = document.querySelector('[data-sidebar]')
  const inter = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left))
    * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))
  // Every ancestor that can crop, up to the viewport — the viewport itself included.
  const clipBoxes = el => {
    const boxes = [{ left: 0, top: 0, right: innerWidth, bottom: innerHeight }]
    for (let n = el.parentElement; n; n = n.parentElement) {
      const cs = getComputedStyle(n)
      if (/hidden|clip|auto|scroll/.test(cs.overflowX + cs.overflowY)) boxes.push(n.getBoundingClientRect())
    }
    return boxes
  }
  const badges = [...list.querySelectorAll('[data-unread-badge]')].map(b => {
    const r = b.getBoundingClientRect()
    const area = r.width * r.height
    // The worst clip wins: a badge clipped by ANY ancestor is clipped, full stop.
    const visible = area ? Math.min(...clipBoxes(b).map(c => inter(r, c))) / area : 0
    return { text: b.textContent ?? '', visible, w: r.width, h: r.height }
  })
  const cs = getComputedStyle(list)
  const lr = list.getBoundingClientRect()
  const br = bar?.getBoundingClientRect() ?? null
  return {
    position: cs.position,
    radiusPx: parseFloat(cs.borderTopLeftRadius) || 0,
    boxShadow: cs.boxShadow,
    // Same surface as the bar: the list must not paint a card of its own.
    background: cs.backgroundColor,
    barBackground: bar ? getComputedStyle(bar).backgroundColor : '',
    // Inside the bar, horizontally: a layer escaping a 56 px bar would fail this.
    insideBar: br ? lr.left >= br.left - 1 && lr.right <= br.right + 1 : false,
    rows: list.querySelectorAll('button').length,
    badges,
    // Rendered tooltip copy of the list's rows — the collapsed bar shows the name and
    // the address here, so this is where a forbidden separator would reach a user.
    tooltips: [...list.querySelectorAll('[data-icon-tooltip]')].map(t => (t.textContent ?? '').trim()),
  }
}

/**
 * A/B of the scrollbar: injects two identical overflowing containers — one with
 * `.scroll-thin`, one bare — and reads what each one resolves to. The bare container
 * is the SAME-RUN reference: whatever this browser does natively is measured here
 * rather than assumed from another machine. Also reports the layout gutter each
 * reserves, and reads the shipped `::-webkit-scrollbar` width out of the compiled
 * stylesheet so a utility dropped at build time cannot pass unnoticed.
 */
/**
 * Reads every custom-folder tile: its letters, its full-path tooltip, and the
 * saturation of its ink and background. Runs in BOTH states — the tile IS the row's
 * icon, so the collapse contract already measures its box; what this adds is that the
 * letters survive the fold and stay readable, which is the whole point of the tile.
 */
const probeFolderGlyphs = () => {
  // Colours are resolved through a canvas, never parsed: this app's tokens compute to
  // `oklch(...)`, whose three numbers are NOT r,g,b — a hand-rolled parser reads
  // `oklch(0.985 0 0)` (pure white) as saturation 1.00 and fails a monochrome tile.
  // Measured on this bench; the same canvas technique is what probeCleanliness uses.
  const cv = document.createElement('canvas')
  cv.width = cv.height = 1
  const ctx = cv.getContext('2d', { willReadFrequently: true })
  const sat = colour => {
    ctx.clearRect(0, 0, 1, 1)
    ctx.fillStyle = colour
    ctx.fillRect(0, 0, 1, 1)
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
    // A fully transparent colour paints nothing — it carries no hue to judge.
    if (a === 0) return 0
    const max = Math.max(r, g, b)
    return max === 0 ? 0 : (max - Math.min(r, g, b)) / max
  }
  const alpha = colour => {
    ctx.clearRect(0, 0, 1, 1)
    ctx.fillStyle = colour
    ctx.fillRect(0, 0, 1, 1)
    return ctx.getImageData(0, 0, 1, 1).data[3]
  }
  // Luminance contrast, read through the same canvas: the tokens are oklch, so the
  // three numbers of a computed value are NOT r,g,b and must not be parsed by hand.
  const rgb = colour => {
    ctx.clearRect(0, 0, 1, 1)
    ctx.fillStyle = colour
    ctx.fillRect(0, 0, 1, 1)
    return [...ctx.getImageData(0, 0, 1, 1).data]
  }
  const lum = colour => {
    const [r, g, b] = rgb(colour).slice(0, 3).map(v => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4) })
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)]; return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }
  // The inked box of the letters, not the span's box: a centred flex child is as wide
  // as its slot, so its rect would report a fit even if the glyphs overflowed it.
  const inkBox = node => {
    const range = document.createRange()
    range.selectNodeContents(node)
    return range.getBoundingClientRect()
  }
  const bar = document.querySelector('[data-sidebar]')
  if (!bar) return null
  // SAME-RUN reference for the tile's contrast: whatever the bar actually paints behind
  // the tile, in the theme this pass is in — never a value carried over from a bench.
  const barBg = getComputedStyle(bar).backgroundColor
  // The painted corner, in pixels. `rounded-full` computes to a huge length (or to
  // `calc(infinity * 1px)`), which parses to Infinity — clamped to half the box, the
  // largest radius a box can actually paint, so the ratio below stays meaningful.
  const cornerPx = (el, cs) => {
    const box = Math.min(el.getBoundingClientRect().width, el.getBoundingClientRect().height)
    const raw = parseFloat(cs.borderTopLeftRadius)
    return Number.isFinite(raw) ? Math.min(raw, box / 2) : box / 2
  }
  // Published by the bar as the ONE width every icon column uses, collapsed or not.
  const iconColW = parseFloat(getComputedStyle(bar).getPropertyValue('--synap-icon-col'))
  return [...bar.querySelectorAll('[data-folder-glyph]')].map(el => {
    const row = el.closest('[data-sidebar-row]')
    const cs = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    const ink = inkBox(el)
    // The slot the tile is centred in — the bar's fixed icon column, read from the width
    // the bar itself publishes (`--synap-icon-col`) and anchored on the row's own left
    // edge, since that column is the row's first child in every state. This, NOT the
    // 16 px plate, is what the letters must fit inside: a plate that size cannot hold
    // two letters at a readable weight (measured on this bench: the widest pair the rule
    // can produce inks 17.88 px at the 10 px semibold the design asks for), so the
    // meaningful question is whether the glyphs stay in their column and unclipped.
    const rowRect = (row ?? el).getBoundingClientRect()
    const slot = { left: rowRect.left, right: rowRect.left + iconColW, top: rowRect.top, bottom: rowRect.bottom, width: iconColW }
    return {
      // Signed slack against the icon column on each side; negative = out of its slot.
      slotSlack: { left: ink.left - slot.left, right: slot.right - ink.right, top: ink.top - slot.top, bottom: slot.bottom - ink.bottom },
      slotW: slot.width,
      // How far the ink spills past the plate's own edge — reported so the drift is
      // visible in the log, and capped below rather than forbidden outright.
      plateBleed: Math.max(0, r.left - ink.left, ink.right - r.right, r.top - ink.top, ink.bottom - r.bottom),
      // A plate that clips would cut a letter; the tile must never do that.
      overflow: cs.overflow,
      radiusPx: cornerPx(el, cs),
      boxPx: Math.min(r.width, r.height),
      fontSize: cs.fontSize,
      barBg,
      // The plate against the bar behind it, and the letters against the plate.
      tileContrast: contrast(cs.backgroundColor, barBg),
      inkContrast: contrast(cs.color, cs.backgroundColor),
      key: row?.dataset.sidebarRow ?? null,
      title: row?.getAttribute('title') ?? null,
      text: (el.textContent || '').trim(),
      // Code points, not UTF-16 units: an accented character the rule can legitimately
      // pick is one character to a reader, and `.length` would have to agree.
      chars: [...(el.textContent || '').trim()].length,
      visible: r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && Number(cs.opacity) > 0,
      inkSat: sat(cs.color),
      bgSat: sat(cs.backgroundColor),
      color: cs.color,
      background: cs.backgroundColor,
      // Alpha of the painted background: 0 means the tile class did not compile and the
      // letters float with no plate. Read through the canvas so any colour syntax counts.
      bgAlpha: alpha(cs.backgroundColor),
    }
  })
}

const probeScrollbars = () => {
  const gutter = el => el.offsetWidth - el.clientWidth
  const read = el => {
    const st = getComputedStyle(el)
    return { widthProp: st.scrollbarWidth, colorProp: st.scrollbarColor, gutter: gutter(el) }
  }
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;left:-9999px;top:0;'
  const make = cls => {
    const box = document.createElement('div')
    box.className = cls
    box.style.cssText = 'width:200px;height:60px;overflow-y:auto;'
    box.innerHTML = '<div style="height:600px"></div>'
    host.appendChild(box)
    return box
  }
  // Same-run A/B: the hidden-bar utility against an unstyled reference of the same box.
  const styled = make('scroll-hidden')
  const bare = make('')
  document.body.appendChild(host)

  // The shipped rule, straight out of the cascade: proves the utility survived the
  // build. Walks nested groups (@layer/@media/@supports) — Tailwind may wrap it.
  let webkitDisplay = null
  const walk = rules => {
    for (const r of rules ?? []) {
      if (r.selectorText === '.scroll-hidden::-webkit-scrollbar') webkitDisplay = r.style.display
      if (r.cssRules) walk(r.cssRules)
    }
  }
  for (const sheet of document.styleSheets) {
    try { walk(sheet.cssRules) } catch { /* cross-origin sheet: not ours */ }
  }

  const result = {
    styled: read(styled),
    bare: read(bare),
    webkitDisplay,
    containers: [...document.querySelectorAll('[data-thin-scroll]')].map(el => {
      const vp = el.querySelector('[data-thin-scroll-viewport]')
      const thumb = el.querySelector('[data-thin-scroll-thumb]')
      const st = thumb && getComputedStyle(thumb)
      const hostBox = el.getBoundingClientRect()
      const thumbBox = thumb && thumb.getBoundingClientRect()
      return {
        tag: el.tagName.toLowerCase(),
        viewportHidden: vp ? getComputedStyle(vp).scrollbarWidth : null,
        gutter: vp ? gutter(vp) : null,
        clientHeight: vp?.clientHeight ?? 0,
        scrollHeight: vp?.scrollHeight ?? 0,
        scrollTop: vp?.scrollTop ?? 0,
        overflowing: vp ? vp.scrollHeight - vp.clientHeight : 0,
        // A folded accordion keeps its scrollable viewport in the DOM at zero height:
        // it overflows, but no wheel can reach it. Only a painted container is a
        // candidate for the fade check below.
        onScreen: !!(hostBox.width && hostBox.height) && getComputedStyle(el).visibility !== 'hidden',
        hasThumb: !!thumb,
        opacity: st ? Number(st.opacity) : null,
        thumbBg: st ? st.backgroundColor : null,
        transitionProp: st ? st.transitionProperty : null,
        transitionMs: st ? st.transitionDuration : null,
        thumbW: thumbBox ? thumbBox.width : null,
        thumbH: thumbBox ? thumbBox.height : null,
        thumbTop: thumbBox ? thumbBox.top - hostBox.top : null,
      }
    }),
  }
  host.remove()
  return result
}

/**
 * Cleanliness probe for the bar itself: the surface it is painted with, the ink and
 * height of every row (one motif => one height), the accent colours actually used,
 * and whether ANY element inside the bar is running an animation. Contrast is
 * recomputed from rendered colours, so "readable in both themes" is measured.
 */
const probeCleanliness = (minSaturation, colourTokenSource) => {
  // Matches the colour function forms a computed style can hold (rgb/rgba/hsl/oklch/color/lab…).
  const COLOUR_TOKEN = new RegExp(colourTokenSource, 'g')
  // Colours are resolved through a canvas rather than parsed: the app's tokens are
  // `oklch()`, which a hand-rolled rgb() regex silently reads as 0,0,0 (measured: every
  // contrast came out 1.00:1). Painting the colour — over its backdrop when it carries
  // alpha — and reading the pixel back makes the BROWSER do the conversion and the
  // alpha compositing, in the same run, for any colour syntax it supports.
  const cv = document.createElement('canvas')
  cv.width = cv.height = 1
  const ctx = cv.getContext('2d', { willReadFrequently: true })
  const paint = (colour, backdrop) => {
    ctx.clearRect(0, 0, 1, 1)
    if (backdrop) { ctx.fillStyle = backdrop; ctx.fillRect(0, 0, 1, 1) }
    ctx.fillStyle = colour
    ctx.fillRect(0, 0, 1, 1)
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
    return { r, g, b, a }
  }
  const lum = ({ r, g, b }) => {
    const [x, y, z] = [r, g, b].map(v => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4) })
    return 0.2126 * x + 0.7152 * y + 0.0722 * z
  }
  const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)]; return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }
  const show = ({ r, g, b }) => `rgb(${r}, ${g}, ${b})`
  // Hue angle on the colour wheel — what "one accent colour" is actually about. A tint
  // of the same accent keeps its hue; a second accent family (a gradient's other end, a
  // blue ring on a violet bar) lands somewhere else entirely.
  const hue = ({ r, g, b }) => {
    const [R, G, B] = [r / 255, g / 255, b / 255]
    const max = Math.max(R, G, B), min = Math.min(R, G, B), d = max - min
    if (!d) return null // neutral: no hue to place
    const h = max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4
    return (h * 60 + 360) % 360
  }
  const saturation = ({ r, g, b }) => {
    const max = Math.max(r, g, b), min = Math.min(r, g, b)
    return max ? (max - min) / max : 0
  }

  const bar = document.querySelector('[data-sidebar]')
  const barBg = paint(getComputedStyle(bar).backgroundColor)
  const rows = [...bar.querySelectorAll('[data-sidebar-row]')].filter(r => !r.closest('[data-account-list]'))
  const accents = new Map()
  const animated = []
  for (const el of bar.querySelectorAll('*')) {
    const st = getComputedStyle(el)
    // Decorative motion only: a transition is not an animation, and a 0s animation is not
    // running. Neither is a one-shot that has already PLAYED OUT: `animation-name` stays on
    // the computed style forever once set, so reading that property alone reports a finished
    // 180ms state-change flip as if it were an endless pulse. The Web Animations API knows
    // the difference -- ask the element what is actually playing right now.
    if (st.animationName !== 'none' && parseFloat(st.animationDuration) > 0) {
      const playing = el.getAnimations().filter(a => a.playState === 'running')
      if (playing.length) animated.push(`${el.tagName.toLowerCase()}:${st.animationName}`)
    }
    // Account bubbles are excluded: their palette is deliberately multi-colour and is
    // contrast-gated above. Everything else the bar paints must share one accent hue.
    if (el.hasAttribute('data-account-initial') || el.querySelector('[data-account-initial]')) continue
    // A gradient lives in background-IMAGE and a ring/glow in box-SHADOW: both compute
    // background-color to transparent, so reading that property alone is blind to exactly
    // the two decorations this lot removes. Every colour token of all three is measured.
    const tokens = [st.backgroundColor, ...`${st.backgroundImage} ${st.boxShadow}`.match(COLOUR_TOKEN) ?? []]
    for (const token of tokens) {
      const painted = paint(token, show(barBg))
      if (saturation(painted) < minSaturation) continue // neutral surface, not an accent
      const h = hue(painted)
      if (h != null) accents.set(show(painted), h)
    }
  }
  return {
    theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light',
    collapsed: bar.dataset.collapsed,
    barBg: show(barBg),
    // The theme and the settings live in the header's user menu: the bar's
    // footer is gone, and a slot or a settings row coming back here is a regression.
    footer: {
      themeSlots: bar.querySelectorAll('[data-sidebar-slot="theme-toggle"]').length,
      settingsRows: bar.querySelectorAll('[data-sidebar-row="settings"]').length,
    },
    animated,
    accents: [...accents].map(([colour, h]) => ({ colour, hue: h })),
    rows: rows.map(r => {
      const st = getComputedStyle(r)
      // A row that paints its own background (the Compose control) is read against THAT,
      // not against the bar: measuring its white ink on the bar behind it would report a
      // contrast the user never sees. Rows with no fill of their own fall back to the bar.
      const backdrop = paint(st.backgroundColor, show(barBg))
      const ink = paint(st.color, show(backdrop))
      return {
        key: r.dataset.sidebarRow,
        height: r.getBoundingClientRect().height,
        ink: show(ink),
        on: show(backdrop),
        contrast: contrast(ink, backdrop),
      }
    }),
  }
}

/**
 * Live background of the first folder row and the computed colour of its label. Called
 * twice per theme — once at rest, once with the pointer really over the row — so the pair
 * is a same-run A/B: the only thing that varies between the two reads is the pointer.
 */
/**
 * The bar's accent, as the browser actually paints it, next to the colour of the account
 * bubble heading the bar — read in the SAME pass so the comparison is an A/B, not a
 * constant. Surfaces measured: the active folder row's tint, the unread badge's fill
 * and the published `--synap-account` itself. Colours are
 * resolved through a canvas — the same technique probeCleanliness uses — because the
 * accent is a `color-mix()` whose serialisation no hand-rolled rgb parser reads.
 */
const probeAccountAccent = () => {
  const cv = document.createElement('canvas')
  cv.width = cv.height = 1
  const ctx = cv.getContext('2d', { willReadFrequently: true })
  const paint = (colour, backdrop) => {
    ctx.clearRect(0, 0, 1, 1)
    if (backdrop) { ctx.fillStyle = backdrop; ctx.fillRect(0, 0, 1, 1) }
    ctx.fillStyle = colour
    ctx.fillRect(0, 0, 1, 1)
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
    return { r, g, b, a: a / 255 }
  }
  const show = ({ r, g, b }) => `rgb(${r}, ${g}, ${b})`
  const hue = ({ r, g, b }) => {
    const [R, G, B] = [r / 255, g / 255, b / 255]
    const max = Math.max(R, G, B), min = Math.min(R, G, B), d = max - min
    if (!d) return null
    const h = max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4
    return (h * 60 + 360) % 360
  }
  const lum = ({ r, g, b }) => {
    const [x, y, z] = [r, g, b].map(v => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4) })
    return 0.2126 * x + 0.7152 * y + 0.0722 * z
  }
  const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)]; return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }

  const bar = document.querySelector('[data-sidebar]')
  const barBg = paint(getComputedStyle(bar).backgroundColor)
  // The reference: the bubble of the account heading the bar, as painted right now.
  const headerBubble = bar.querySelector('[data-sidebar-row="account"] [data-account-initial]')?.parentElement
  if (!headerBubble) return null
  const reference = paint(getComputedStyle(headerBubble).backgroundColor)

  // Every accent surface, each with the backdrop it is actually composited over: a tint
  // read on its own would report the hue of nothing.
  const surfaces = []
  const add = (name, el, prop, backdrop) => {
    if (!el) return
    const raw = getComputedStyle(el)[prop]
    // A shadow is a composite value, and Tailwind always emits its ring placeholders
    // BEFORE the shadow itself (`var(--tw-ring-offset-shadow), var(--tw-ring-shadow),
    // var(--tw-shadow)`), which compute to a transparent `rgba(0, 0, 0, 0)`. Reading the
    // first colour token would therefore measure the placeholder, not the shadow: take
    // the last one, which is the layer the utility actually paints.
    const tokens = prop === 'boxShadow' ? raw.match(/(?:rgba?|oklab|oklch|color|lab|lch)\([^)]*\)/g) ?? [] : [raw]
    const colour = tokens[tokens.length - 1]
    if (!colour) return
    const alone = paint(colour)
    const over = paint(colour, backdrop)
    surfaces.push({ name, raw: colour, alpha: alone.a, painted: show(over), hue: hue(over) })
  }
  const activeRow = [...bar.querySelectorAll('[data-sidebar-row^="folder:"]')]
    .find(r => getComputedStyle(r).backgroundColor !== 'rgba(0, 0, 0, 0)')
  add('active folder tint', activeRow, 'backgroundColor', show(barBg))

  // The published property itself: read from the bar's root, painted alone.
  const published = getComputedStyle(bar).getPropertyValue('--synap-account').trim()
  const publishedPainted = published ? paint(published) : null

  // The bar carries no compose row (the head bar carries it on every
  // page), so the unread badge is now the bar's only white-ink-on-accent surface: it
  // is the one that has to hold contrast at every account colour.
  const badge = bar.querySelector('[data-unread-badge]')
  const badgeBg = badge ? paint(getComputedStyle(badge).backgroundColor, show(barBg)) : null
  const badgeInk = badge ? paint(getComputedStyle(badge).color, show(badgeBg)) : null

  return {
    theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light',
    account: bar.querySelector('[data-sidebar-row="account"] [data-account-initial]')?.textContent ?? '',
    reference: show(reference),
    referenceHue: hue(reference),
    published,
    publishedHue: publishedPainted ? hue(publishedPainted) : null,
    surfaces,
    badgeContrast: badgeInk && badgeBg ? contrast(badgeInk, badgeBg) : null,
  }
}

const probeHoverState = key => {
  const rows = [...document.querySelectorAll('[data-sidebar] [data-sidebar-row^="folder:"]')]
  // The ACTIVE folder paints a permanent accent tint, so it cannot show a hover change:
  // the row to measure is an IDLE one, picked once by the caller and then held fixed.
  const row = key ? rows.find(r => r.dataset.sidebarRow === key)
    : rows.find(r => getComputedStyle(r).backgroundColor === 'rgba(0, 0, 0, 0)')
  if (!row) return null
  const label = row.querySelector('span, a, div') ?? row
  return {
    key: row.dataset.sidebarRow,
    background: getComputedStyle(row).backgroundColor,
    ink: getComputedStyle(label).color,
  }
}

/**
 * Alpha channel of a computed colour. Chrome serialises `rgb()`/`rgba()` for plain values
 * but keeps a `color-mix()` result in its own space — `color(srgb r g b / a)` — so a parser
 * that only knows the rgb form reads null on exactly the colour this check is about.
 * Both forms put the alpha after the `/` (or 4th in the legacy comma list); no `/` at all
 * means fully opaque.
 */
const alphaOf = colour => {
  const m = /^(rgba?|color|oklab|oklch|lab|lch)\(([^)]*)\)$/.exec(colour ?? '')
  if (!m) return null
  const [channels, alpha] = m[2].split('/')
  if (alpha !== undefined) return Number(alpha.trim())
  // No `/`: only the legacy comma form can still carry an alpha, as a 4th number.
  // `color()` spends its first token on the colourspace and the CSS Color 4 functions
  // take exactly three channels, so counting tokens the same way would read a channel
  // as an alpha (self-checked below).
  if (m[1] !== 'rgb' && m[1] !== 'rgba') return 1
  const parts = channels.split(/[,\s]+/).filter(Boolean)
  return parts.length > 3 ? Number(parts[3]) : 1
}
// Self-check: the three serialisations this helper can meet, plus the no-op it must catch.
for (const [colour, expected] of [
  ['rgba(0, 0, 0, 0)', 0],
  ['rgb(12, 12, 12)', 1],
  ['color(srgb 0.039 0.039 0.039 / 0.22)', 0.22],
  ['color(srgb 0.039 0.039 0.039)', 1],
  // Chrome serialises a color-mix() over an oklch token in oklab — the exact form the
  // hover fill comes back as, and the one a rgb-only parser reads as null.
  ['oklab(0.145 0 0 / 0.06)', 0.06],
  ['oklab(0.985 0 0)', 1],
  ['not a colour', null],
]) {
  const got = alphaOf(colour)
  if (got !== expected) throw new Error(`alphaOf("${colour}") = ${got}, expected ${expected}`)
}

/** Shortest angular distance between two hues — 350 deg and 10 deg are 20 deg apart, not 340. */
const hueGap = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d }
for (const [a, b, expected] of [[350, 10, 20], [10, 350, 20], [272, 272, 0], [0, 180, 180]]) {
  if (hueGap(a, b) !== expected) throw new Error(`hueGap(${a}, ${b}) = ${hueGap(a, b)}, expected ${expected}`)
}

const setTheme = theme => {
  document.documentElement.classList.toggle('dark', theme === 'dark')
  document.documentElement.style.colorScheme = theme
}

// A page-level navigation/settle budget. The 30s puppeteer default is a machine-load
// threshold, not a product one: under heavy load a `goto` times out and the script used to
// die with a raw stack and rc=1 — indistinguishable from a product FAIL. Navigation is
// never what this script measures: a slow hop delays the run instead of aborting it.
const NAV_SETTLE_MS = 120000

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] })
let failures = []
try {
  const page = await browser.newPage()
  page.setDefaultNavigationTimeout(NAV_SETTLE_MS)
  await page.setViewport(VIEWPORT)
  // /mail holds an SSE connection open (`/api/stream`), so `networkidle2` can never be
  // reached there: the wait has to be the marker the bar itself renders, not the network
  // going quiet. `domcontentloaded` + waitForSelector is the pair used for every hop.
  // The marker is a FOLDER row, not just any row: the account row is server-rendered and
  // present immediately, so waiting on it would let the measurements run on a bar whose
  // folder list has not arrived yet (observed: 1 row measured instead of 102).
  const land = async path => {
    await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' })
    // The folder list is fetched from the real IMAP server, so the wait is generous:
    // a slow mailbox must delay the measurement, never abort the run as a false failure.
    await page.waitForSelector('[data-sidebar] [data-sidebar-row^="folder:"]', { timeout: NAV_SETTLE_MS })
  }

  // Sign in through the credentials endpoint, then land on /mail.
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  const loggedIn = await page.evaluate(async ({ base, email, password }) => {
    const { csrfToken } = await (await fetch(`${base}/api/auth/csrf`)).json()
    const res = await fetch(`${base}/api/auth/callback/credentials`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ csrfToken, email, password, json: 'true' }),
    })
    return res.ok
  }, { base: BASE, email: EMAIL, password: PASSWORD })
  if (!loggedIn) { console.error('HARNESS: credentials login failed'); process.exit(2) }

  await land('/mail')
  // Which account of this database carries the most custom folders — asked of the app's own
  // API, not hard-coded to a name: this bench exists because the rule was only ever measured on
  // the small box the bench happens to sign into, and "the biggest one" must stay true as the
  // database changes. Read once, up front, so the second pass below knows where to click.
  const inventory = await page.evaluate(async base => {
    const accounts = (await (await fetch(`${base}/api/accounts`)).json()).data ?? []
    const counts = []
    for (const a of accounts) {
      const folders = (await (await fetch(`${base}/api/folders?account=${a.id}`)).json()).data ?? []
      counts.push({ id: a.id, label: a.name || a.email, custom: folders.filter(f => !f.special).length })
    }
    return counts
  }, BASE)
  if (!inventory.length) { console.error('HARNESS: the accounts API returned nothing — no mailbox to measure'); process.exit(2) }
  const biggest = inventory.reduce((best, a) => (a.custom > best.custom ? a : best))
  // FIXTURE, not a measurement: the active account is a server-side preference that
  // SURVIVES between runs, so a previous run leaving the session on the biggest mailbox
  // would silently skip the switch this lot exists to exercise. Pinned here to the
  // smallest mailbox that still has a tile to measure, through the same API the app uses,
  // BEFORE any reading — the switch measured further down is then always a real click.
  const smallest = inventory.filter(a => a.custom > 0 && a.id !== biggest.id)
    .reduce((least, a) => (a.custom < least.custom ? a : least), { custom: Infinity })
  if (!Number.isFinite(smallest.custom)) { console.error('HARNESS: this database has fewer than two mailboxes carrying custom folders — the switch cannot be measured'); process.exit(2) }
  // Switching mailbox goes through the app's own settings endpoint, then a reload: the
  // one way the bench puts a chosen account at the head of the bar.
  // sidebar_collapsed is a server-side preference too, and it survives between runs: every
  // toggle() below counts from the state the PREVIOUS run left behind, so an odd number of
  // folds would leave the next run starting collapsed. Pinned expanded here, alongside the
  // active account, so the sequence of folds always starts from a known state.
  const activate = async id => {
    await page.evaluate(async ({ base, id }) => {
      await fetch(`${base}/api/settings`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active_account_id: id, sidebar_collapsed: false }) })
    }, { base: BASE, id })
    await land('/mail')
    await new Promise(r => setTimeout(r, SETTLE_MS))
  }
  await activate(smallest.id)
  const signedInAs = smallest.label
  console.log(`accounts in this database: ${inventory.map(a => `${a.label}=${a.custom}`).join(', ')} — starting on "${signedInAs}" (${smallest.custom}), biggest is "${biggest.label}" (${biggest.custom})`)
  // The bar folds from the application header's menu button — a REAL click on
  // the shipped control, not a programmatic state change.
  const toggle = async () => {
    await page.click(DRAWER_TRIGGER)
    await new Promise(r => setTimeout(r, SETTLE_MS))
  }

  /**
   * Reads the folder tiles ONLY once the bar shows the number of them this mailbox is
   * known to have. The list re-renders on its own (the accounts SWR refreshes on an
   * interval, and a fold re-lays out 100 rows), so probing straight after a toggle can
   * catch it mid-render: observed as "96 expanded vs 3 collapsed" and as a tile whose
   * letters changed with the fold — both read as product failures while the product had
   * not changed. A count that never arrives is a HARNESS failure, never a verdict.
   */
  const glyphsWhenSettled = async (expected, where) => {
    await page.waitForFunction(
      n => document.querySelectorAll('[data-sidebar] [data-folder-glyph]').length === n,
      { timeout: 60000 }, expected,
    ).catch(() => {})
    const seen = await page.evaluate(() => document.querySelectorAll('[data-sidebar] [data-folder-glyph]').length)
    if (seen !== expected) {
      console.error(`HARNESS: ${where}: the bar shows ${seen} folder tiles, this mailbox has ${expected} — the list never settled, nothing measured`)
      process.exit(2)
    }
    return page.evaluate(probeFolderGlyphs)
  }

  // Nothing is clicked until the folder list has finished arriving: a toggle fired while
  // the bar is still mounting rows resolves against a layout that is about to change, and
  // the bar can come back reporting the state it started from.
  await glyphsWhenSettled(smallest.custom, `"${signedInAs}" before the first fold`)
  let before = await page.evaluate(probe, EDGE_TOGGLE)
  if (before.collapsed === 'true') { await toggle(); before = await page.evaluate(probe, EDGE_TOGGLE) }
  if (before.collapsed !== 'false') { console.error('HARNESS: could not reach the expanded state'); process.exit(2) }
  const glyphsExpanded = await glyphsWhenSettled(smallest.custom, `"${signedInAs}" expanded`)

  await toggle()
  const after = await page.evaluate(probe, EDGE_TOGGLE)
  if (after.collapsed !== 'true') { console.error('HARNESS: could not reach the collapsed state'); process.exit(2) }
  const glyphsCollapsed = await glyphsWhenSettled(smallest.custom, `"${signedInAs}" collapsed`)

  const withIcon = s => s.rows.filter(r => r.iconX != null).length
  console.log(`rows measured: expanded=${before.rows.length} collapsed=${after.rows.length}`)
  console.log(`rows carrying a measurable icon: expanded=${withIcon(before)} collapsed=${withIcon(after)}`)
  // A row whose icon is skipped is not measured — a selector matching nothing would
  // otherwise make this check pass vacuously.
  for (const s of [before, after]) {
    if (withIcon(s) !== s.rows.length) {
      failures.push(`${s.rows.length - withIcon(s)} row(s) have no [data-sidebar-icon] while collapsed=${s.collapsed} — unmeasured`)
    }
  }
  if (before.rows.length !== after.rows.length) {
    failures.push(`row count changed: ${before.rows.length} → ${after.rows.length} (icons were unmounted)`)
  }
  for (const [i, b] of before.rows.entries()) {
    const a = after.rows[i]
    if (!a) continue
    if (b.key !== a.key) failures.push(`row ${i}: identity changed (${b.key} → ${a.key})`)
    for (const f of ['iconX', 'iconY', 'iconW', 'iconH', 'rowHeight']) {
      if (b[f] == null || a[f] == null) continue
      const drift = Math.abs(a[f] - b[f])
      if (drift > MAX_DRIFT_PX) failures.push(`row ${i} (${b.key}): ${f} moved ${drift.toFixed(2)}px (${b[f].toFixed(2)} → ${a[f].toFixed(2)})`)
    }
  }
  for (const s of [before, after]) {
    if (s.horizontalOverflow) failures.push(`horizontal scrollbar present while collapsed=${s.collapsed}`)
  }

  // --- The round floating toggle is gone, in BOTH states ---
  for (const s of [before, after]) {
    console.log(`floating ${EDGE_TOGGLE} elements while collapsed=${s.collapsed}: ${s.strayToggles}`)
    if (s.strayToggles) failures.push(`${s.strayToggles} floating collapse button(s) in the DOM while collapsed=${s.collapsed}, expected none`)
  }

  // The two states must actually differ, otherwise the check above passes vacuously
  // on a button that never moved because the bar never folded.
  if (Math.abs(before.asideRight - after.asideRight) < 1) {
    console.error('HARNESS: the bar\'s right edge did not move between the two states — the fold did nothing')
    process.exit(2)
  }

  // --- Custom folders: a tile of letters, readable folded, monochrome, full path on hover ---
  // Named because it runs twice: once on the account the bench signs into, and once on the
  // account of this database that has the MOST custom folders — the whole point of this arm
  // is that a rule green on a 20-folder test box failed on a 92-folder real one.
  const checkGlyphs = (label, expanded, collapsed) => {
    if (!expanded || !collapsed) { console.error(`HARNESS: the sidebar root was not found when reading folder tiles (${label})`); process.exit(2) }
    if (!collapsed.length) { console.error(`HARNESS: no [data-folder-glyph] tile rendered for ${label} — this account has no custom folder, nothing measured`); process.exit(2) }
    console.log(`custom folder tiles (${label}): expanded=${expanded.length} collapsed=${collapsed.length}`)
    if (expanded.length !== collapsed.length) {
      failures.push(`folder tiles (${label}): ${expanded.length} expanded vs ${collapsed.length} collapsed — tiles were unmounted by the fold`)
    }
    // Read on the COLLAPSED state: that is the state the tile exists for.
    const glyphLetters = new Map()
    for (const g of collapsed) {
      console.log(`  ${g.key}: "${g.text}" (${g.chars} chars, ${g.fontSize}) visible=${g.visible} title="${g.title}" ink=${g.color} (sat ${g.inkSat.toFixed(3)}) bg=${g.background} (sat ${g.bgSat.toFixed(3)}, alpha ${g.bgAlpha}) tile/bar=${g.tileContrast.toFixed(3)}:1 on ${g.barBg} ink/tile=${g.inkContrast.toFixed(2)}:1 radius=${g.radiusPx.toFixed(2)}px on ${g.boxPx.toFixed(0)}px bleed=${g.plateBleed.toFixed(2)}px`)
      if (g.tileContrast < FOLDER_GLYPH_MIN_TILE_CONTRAST) {
        failures.push(`folder tile ${label}/${g.key}: plate ${g.background} on bar ${g.barBg} = ${g.tileContrast.toFixed(3)}:1 (min ${FOLDER_GLYPH_MIN_TILE_CONTRAST}:1) — the tile does not read as a tile`)
      }
      if (g.radiusPx > FOLDER_GLYPH_MAX_RADIUS_PX) {
        const round = g.radiusPx >= g.boxPx / 2 - 0.01 ? ' — this is a circle, not a case' : ''
        failures.push(`folder tile ${label}/${g.key}: corner radius ${g.radiusPx.toFixed(2)}px on a ${g.boxPx.toFixed(0)}px plate (max ${FOLDER_GLYPH_MAX_RADIUS_PX}px)${round}`)
      }
      const tight = Math.min(g.slotSlack.left, g.slotSlack.right, g.slotSlack.top, g.slotSlack.bottom)
      if (tight < 0) failures.push(`folder tile ${label}/${g.key}: letters "${g.text}" leave the ${g.slotW.toFixed(0)}px icon column (slack ${tight.toFixed(2)}px)`)
      if (g.overflow !== 'visible') failures.push(`folder tile ${label}/${g.key}: overflow=${g.overflow} — a wide pair would be clipped mid-letter`)
      if (g.plateBleed > FOLDER_GLYPH_MAX_PLATE_BLEED_PX) {
        failures.push(`folder tile ${label}/${g.key}: letters "${g.text}" spill ${g.plateBleed.toFixed(2)}px past the plate (max ${FOLDER_GLYPH_MAX_PLATE_BLEED_PX}px)`)
      }
      if (!g.visible) failures.push(`folder tile ${label}/${g.key}: not visible while the bar is collapsed — the folder cannot be told apart`)
      if (g.chars !== FOLDER_GLYPH_LETTERS) {
        failures.push(`folder tile ${label}/${g.key}: "${g.text}" is ${g.chars} character(s) (expected exactly ${FOLDER_GLYPH_LETTERS})`)
      }
      if (g.text !== g.text.toUpperCase()) failures.push(`folder tile ${label}/${g.key}: "${g.text}" is not upper-cased`)
      if (g.bgAlpha === 0) failures.push(`folder tile ${label}/${g.key}: background paints nothing (alpha 0, "${g.background}") — the tile class did not compile`)
      if (g.inkSat > FOLDER_GLYPH_MAX_SATURATION || g.bgSat > FOLDER_GLYPH_MAX_SATURATION) {
        failures.push(`folder tile ${label}/${g.key}: not monochrome — ink saturation ${g.inkSat.toFixed(3)}, background ${g.bgSat.toFixed(3)} (max ${FOLDER_GLYPH_MAX_SATURATION})`)
      }
      // The letters replace the name, so the full IMAP path must remain reachable on hover.
      const path = (g.key || '').replace(/^folder:/, '')
      if (!g.title || g.title !== path) failures.push(`folder tile ${label}/${g.key}: title "${g.title}" is not the folder's full path "${path}"`)
      // The RULE, checked against the folder's own name — the geometric checks above would
      // all pass on a rule that handed out distinct, well-fitting but MEANINGLESS pairs
      // (a counter, a hash). Both characters must come from the name, and the first must
      // be the name's own first: that is what makes a tile mappable back to a folder.
      const flat = (g.title || '').split('/').filter(Boolean).pop()?.replace(/[^0-9A-Za-zÀ-ÿ]/g, '').toUpperCase() ?? ''
      const [head, tail] = [...g.text]
      if (flat && head !== flat[0]) {
        failures.push(`folder tile ${label}/${g.key}: "${g.text}" does not start with its folder's own first character ("${flat[0]}")`)
      }
      if (flat && tail !== GLYPH_PAD && !flat.slice(1).includes(tail)) {
        failures.push(`folder tile ${label}/${g.key}: "${g.text}" — second character "${tail}" is not in "${flat}", the tile spells something the folder does not`)
      }
      const clash = glyphLetters.get(g.text)
      if (clash) failures.push(`folder tiles (${label}): "${g.text}" is carried by both ${clash} and ${g.key} — the two folders are indistinguishable folded`)
      glyphLetters.set(g.text, g.key)
    }
    // Same letters in both states: the tile is the row's identity, not a collapsed-only decoration.
    for (const e of expanded) {
      const c = collapsed.find(x => x.key === e.key)
      if (c && c.text !== e.text) failures.push(`folder tile ${label}/${e.key}: letters changed with the fold ("${e.text}" → "${c.text}")`)
    }
    return collapsed.length
  }
  const signedInTiles = checkGlyphs(signedInAs, glyphsExpanded, glyphsCollapsed)

  // --- The SAME checks on the biggest real mailbox of this database ---
  // The bar is still collapsed here. Switching account is done by a REAL click on the row
  // of the shipped popover, exactly as a user would — not by writing a setting — so the
  // whole switch path (popover, filter, SWR re-key, folder re-fetch) is what gets measured.
  if (biggest.label === signedInAs) {
    console.error(`HARNESS: the bench started on the biggest mailbox ("${signedInAs}", ${signedInTiles} tiles) — the switch was not exercised`)
    process.exit(2)
  } else {
    await toggle() // expanded: the popover hangs off the header row
    await page.click('[data-sidebar-row="account"]')
    await new Promise(r => setTimeout(r, SETTLE_MS))
    const filter = await page.$('[data-account-list-open="true"] input')
    if (filter) await filter.type(biggest.label)
    await new Promise(r => setTimeout(r, SETTLE_MS))
    const switched = await page.evaluate(label => {
      const row = [...document.querySelectorAll('[data-account-list-open="true"] button')]
        .find(b => (b.textContent ?? '').includes(label))
      if (!row) return false
      row.click()
      return true
    }, biggest.label)
    if (!switched) { console.error(`HARNESS: no row for "${biggest.label}" in the account popover — the second pass measured nothing`); process.exit(2) }
    // The folder list is re-fetched over IMAP on the switch: wait for the count the
    // inventory promised rather than for a fixed delay, so a slow fetch is not read as a
    // product failure. A count that never arrives is a harness failure, not a verdict.
    const bigExpanded = await glyphsWhenSettled(biggest.custom, `after switching to "${biggest.label}", expanded`)
    await toggle()
    const bigCollapsed = await glyphsWhenSettled(biggest.custom, `"${biggest.label}" collapsed`)
    checkGlyphs(biggest.label, bigExpanded, bigCollapsed)
    // The fold must not drift on a list this long either: same contract, more rows.
    const bigState = await page.evaluate(probe, EDGE_TOGGLE)
    if (bigState.horizontalOverflow) failures.push(`"${biggest.label}" (${biggest.custom} folders): horizontal scrollbar present while collapsed`)
    console.log(`"${biggest.label}": ${bigState.rows.length} rows measured collapsed, horizontal overflow ${bigState.horizontalOverflow}`)
  }

  // --- Account bubbles: badge on the corner, initial readable on every colour ---
  await toggle() // back to expanded, so the header bubble carries its label too
  await page.click('[data-sidebar-row="account"]')
  await new Promise(r => setTimeout(r, SETTLE_MS))
  const bubbles = await page.evaluate(probeBubbles)
  if (!bubbles.length) { console.error('HARNESS: no account bubble found — popover did not open'); process.exit(2) }

  const withBadge = bubbles.filter(b => b.badgeText)
  console.log(`bubbles measured: ${bubbles.length} (with a badge: ${withBadge.length})`)
  if (!withBadge.length) { console.error('HARNESS: no bubble carries an unread badge — nothing to measure'); process.exit(2) }
  for (const b of bubbles) {
    const where = `${b.where} "${b.initial}" (${b.badgeText || 'no badge'})`
    const worstSlack = Math.min(...Object.values(b.slack))
    console.log(`  ${where}: letters=${b.letters} font=${b.fontSize} bubble=${b.bubbleW.toFixed(0)}px inset=${worstSlack.toFixed(2)}px badge/bubble=${(b.overBubble * 100).toFixed(1)}% badge/glyph=${(b.overGlyph * 100).toFixed(1)}% contrast=${b.contrast.toFixed(2)} radius=${b.radiusPx.toFixed(2)}px on ${b.boxPx.toFixed(0)}px bg=${b.bg}`)
    if (b.letters !== BUBBLE_LETTERS) failures.push(`${where}: ${b.letters} letter(s) in the bubble (expected exactly ${BUBBLE_LETTERS})`)
    if (worstSlack < GLYPH_INSET_PX) {
      const sides = Object.entries(b.slack).map(([k, v]) => `${k} ${v.toFixed(2)}px`).join(', ')
      failures.push(`${where}: letters reach the bubble's rim — closest side ${worstSlack.toFixed(2)}px (min ${GLYPH_INSET_PX}px); ${sides}`)
    }
    if (b.overBubble > MAX_BADGE_OVER_BUBBLE) failures.push(`${where}: badge covers ${(b.overBubble * 100).toFixed(1)}% of the bubble (max ${(MAX_BADGE_OVER_BUBBLE * 100)}%)`)
    if (b.overGlyph > MAX_BADGE_OVER_GLYPH) failures.push(`${where}: badge covers ${(b.overGlyph * 100).toFixed(1)}% of the initial (max ${(MAX_BADGE_OVER_GLYPH * 100)}%)`)
    if (b.contrast < MIN_CONTRAST) failures.push(`${where}: initial contrast ${b.contrast.toFixed(2)}:1 on ${b.bg} (min ${MIN_CONTRAST}:1)`)
    // The other half of the shape A/B: a folder tile is a case, so a bubble must stay
    // round — if either drifts toward the other the two objects stop being tellable apart.
    const ratio = b.boxPx ? b.radiusPx / b.boxPx : 0
    if (ratio < BUBBLE_MIN_RADIUS_RATIO) {
      failures.push(`${where}: bubble corner ${b.radiusPx.toFixed(2)}px on a ${b.boxPx.toFixed(0)}px box = ${(ratio * 100).toFixed(0)}% of its side (min ${BUBBLE_MIN_RADIUS_RATIO * 100}%) — a bubble must stay round`)
    }
  }
  const palette = [...new Set(bubbles.map(b => b.bg))]
  console.log(`distinct bubble colours exercised: ${palette.length} (${palette.join(', ')})`)

  // --- Account list: the other accounts only, strictly left-aligned, nothing marked ---
  const list = await page.evaluate(probeAccountList)
  if (!list) { console.error('HARNESS: account popover not found — the list checks measured nothing'); process.exit(2) }
  if (!list.rows.length) { console.error('HARNESS: the account list is empty — nothing to measure'); process.exit(2) }
  if (!list.headerLines.length) { console.error('HARNESS: the active account of the bar has no readable name/email'); process.exit(2) }
  const textXs = list.rows.flatMap(r => r.lines.map(l => l.x))
  if (!textXs.length) { console.error('HARNESS: no inked text line measured in the account list'); process.exit(2) }
  const spread = Math.max(...textXs) - Math.min(...textXs)
  const activeListed = list.rows.filter(r => r.lines.some(l => list.headerLines.includes(l.text)))
  const ringed = list.rows.filter(r => r.ring && r.ring !== 'none')
  console.log(`account list: ${list.rows.length} rows (active account "${list.headerLines[0]}" listed ${activeListed.length}×), ${textXs.length} text lines, x spread ${spread.toFixed(2)}px, ringed bubbles ${ringed.length}, check glyphs ${list.checkGlyphs} (chars ${list.checkChars})`)
  for (const r of list.rows) {
    console.log(`  "${r.label}": bubble x=${r.bubbleX?.toFixed(2)} text x=${r.lines.map(l => l.x.toFixed(2)).join('/')} align=${r.textAlign}`)
    if (r.textAlign !== 'left') failures.push(`account row "${r.label}": text-align ${r.textAlign}, expected left`)
  }
  if (spread > MAX_TEXT_X_SPREAD_PX) {
    failures.push(`account list: names/emails start at ${spread.toFixed(2)}px apart (max ${MAX_TEXT_X_SPREAD_PX}px) — x values ${[...new Set(textXs.map(x => x.toFixed(2)))].join(', ')}`)
  }
  if (activeListed.length) {
    failures.push(`account list: the active account "${list.headerLines[0]}" is still listed (${activeListed.length} row(s)) — it already heads the bar`)
  }
  if (ringed.length) {
    failures.push(`account list: ${ringed.length} bubble(s) carry a ring (box-shadow) — nothing in the list is selected, nothing may be marked`)
  }
  if (list.checkGlyphs || list.checkChars) {
    failures.push(`account list: ${list.checkGlyphs} check icon(s) and ${list.checkChars} check character(s) left in the popover (expected none)`)
  }

  // --- A shared inbox is signalled by ONE glyph, never by a line of text ---
  // The sentence is read from the shipped locale, never retyped here: a re-worded
  // `sharedBy` must keep failing this check, and a check carrying its own copy of the
  // sentence would silently stop matching the product the day the wording changes.
  const sharedRows = list.rows.filter(r => r.mark)
  const sharedSentence = SHARED_BY_PREFIX && list.popoverText.includes(SHARED_BY_PREFIX)
  console.log(`shared inboxes: ${sharedRows.length} row(s) marked, header marks ${list.headerMarks}, "${SHARED_BY_PREFIX}" as a text line in the popover: ${sharedSentence}`)

  // --- The mark and the chevron of the header row never cover each other ---
  // The defect only exists when the ACTIVE account is itself shared, so the bench makes
  // it so: it switches to the shared mailbox of the list, measures both bar states, then
  // puts the previous account back. Reading the header without that switch measured a
  // popover row's mark instead of the header's, in the account list of any database.
  {
    // Rows carry their label, not their id: the id comes from the inventory read from the
    // app's own API at the top of this run, matched on that label.
    const sharedLabel = list.rows.find(r => r.mark)?.label
    const sharedId = inventory.find(a => a.label === sharedLabel)?.id
    if (!sharedId) {
      console.error('HARNESS: no shared inbox in this database — the H3c2 overlap measured nothing (create a share between two local users first)')
      process.exit(2)
    }
    const restoreId = smallest.id
    const measureControls = async where => {
      const hc = await page.evaluate(probeAccountList).then(r => r?.headerControls)
      if (!hc) {
        console.error(`HARNESS: ${where} — the account popover did not open, nothing measured`)
        process.exit(2)
      }
      // A collapsed bar shows the bubble alone: the mark is folded away by design, so
      // there is no pair to judge. Reported, never silently skipped — and never counted
      // as a pass either: the expanded pass is the one that carries the contract.
      if (!hc.mark || !hc.chevron || hc.overlapPx === null) {
        const seen = hc.painted ? `painted: mark ${hc.painted.mark}, chevron ${hc.painted.chevron}` : `mark present ${hc.mark}, chevron present ${hc.chevron}`
        console.log(`header controls (${where}): ${seen} — no pair on screen, nothing to overlap`)
        return
      }
      console.log(`header controls (${where}): mark x ${hc.markBox.left.toFixed(2)}..${hc.markBox.right.toFixed(2)}, chevron x ${hc.chevronBox.left.toFixed(2)}..${hc.chevronBox.right.toFixed(2)} -> overlap ${hc.overlapPx.toFixed(2)}px, gap ${hc.gapPx.toFixed(2)}px, past the bar's edge ${hc.overflowPx.toFixed(2)}px`)
      if (hc.overlapPx > 0) {
        failures.push(`header row (${where}): the share mark and the fold chevron overlap by ${hc.overlapPx.toFixed(2)}px (expected 0) — one clickable box covers the other`)
      }
      if (hc.gapPx < MIN_CONTROL_GAP_PX) {
        failures.push(`header row (${where}): only ${hc.gapPx.toFixed(2)}px between the share mark and the chevron (min ${MIN_CONTROL_GAP_PX}px)`)
      }
      if (hc.overflowPx > MAX_DRIFT_PX) {
        failures.push(`header row (${where}): a right-hand control spills ${hc.overflowPx.toFixed(2)}px past the bar's own edge`)
      }
    }
    await activate(sharedId)
    await page.click('[data-sidebar-row="account"]')
    await new Promise(r => setTimeout(r, SETTLE_MS))
    await measureControls('expanded')
    await toggle()
    await page.click('[data-sidebar-row="account"]')
    await new Promise(r => setTimeout(r, SETTLE_MS))
    await measureControls('collapsed')
    await toggle()
    await activate(restoreId)
    await page.click('[data-sidebar-row="account"]')
    await new Promise(r => setTimeout(r, SETTLE_MS))
  }
  if (!sharedRows.length) {
    console.error('HARNESS: no shared inbox in the account list of this database — the H3b mark measured nothing (create a share between two local users first)')
    process.exit(2)
  }
  if (sharedSentence) {
    failures.push(`account list: the "${SHARED_BY_PREFIX}…" text line is still rendered, expected a single glyph instead`)
  }
  for (const r of sharedRows) {
    const m = r.mark
    console.log(`  shared "${r.label}": mark href=${m.href} svgs=${m.svgs} aria="${m.label}" x=${m.x.toFixed(2)} cy=${m.cy.toFixed(2)} (row cy ${r.rowCy.toFixed(2)})`)
    if (m.href !== ACCOUNTS_SETTINGS_HREF) failures.push(`shared row "${r.label}": mark points to ${m.href}, expected ${ACCOUNTS_SETTINGS_HREF}`)
    if (m.svgs !== 1) failures.push(`shared row "${r.label}": ${m.svgs} icon(s) in the mark, expected exactly 1`)
    if (!m.label) failures.push(`shared row "${r.label}": the mark carries no aria-label`)
    if (!m.inRow) failures.push(`shared row "${r.label}": the mark sits outside its own row box`)
    if (Math.abs(m.cy - r.rowCy) > MAX_DRIFT_PX) {
      failures.push(`shared row "${r.label}": mark centred at y=${m.cy.toFixed(2)}, row centre y=${r.rowCy.toFixed(2)} (max ${MAX_DRIFT_PX}px) — it must sit on the row's axis`)
    }
  }
  // A shared row of the UNFOLDED list carries a mark too,
  // and that list is now inside the bar rather than in a popover of its own — so the
  // mark is judged against the same two things the header's is: the text it must never
  // cover, and the bar's own right edge it must never spill past. A list row has no
  // chevron, so there is no second control to intersect; the text IS the reference.
  for (const r of sharedRows) {
    if (!Number.isFinite(r.textRight) || list.barRight === null) continue
    const textGap = r.mark.x - r.textRight
    const spill = Math.max(0, r.mark.right - list.barRight)
    console.log(`  shared "${r.label}" (unfolded list): text ends x ${r.textRight.toFixed(2)}, mark x ${r.mark.x.toFixed(2)}..${r.mark.right.toFixed(2)} -> gap ${textGap.toFixed(2)}px, past the bar's edge ${spill.toFixed(2)}px`)
    if (textGap < MIN_CONTROL_GAP_PX) {
      failures.push(`shared row "${r.label}" (unfolded list): only ${textGap.toFixed(2)}px between the name and the share mark (min ${MIN_CONTROL_GAP_PX}px) — the mark lands on the text`)
    }
    if (spill > MAX_DRIFT_PX) {
      failures.push(`shared row "${r.label}" (unfolded list): the share mark spills ${spill.toFixed(2)}px past the bar's own edge`)
    }
  }
  // The x of the NAME must not move between a shared row and an ordinary one: the mark
  // lives in its own right-hand gutter. This is the same-run reference — the unshared
  // rows of this very list, not a constant measured elsewhere.
  const plainRows = list.rows.filter(r => !r.mark)
  if (plainRows.length) {
    const nameX = r => r.lines[0]?.x ?? null
    const sharedX = sharedRows.map(nameX).filter(x => x !== null)
    const plainX = plainRows.map(nameX).filter(x => x !== null)
    const gap = Math.abs(Math.max(...sharedX) - Math.max(...plainX))
    console.log(`name x: shared ${sharedX.map(x => x.toFixed(2)).join('/')} vs plain ${plainX.map(x => x.toFixed(2)).join('/')} → ${gap.toFixed(2)}px apart`)
    if (gap > MAX_DRIFT_PX) {
      failures.push(`shared rows indent their name by ${gap.toFixed(2)}px versus an ordinary row (max ${MAX_DRIFT_PX}px) — the mark must not push the text`)
    }
  } else {
    console.log('name x: every account of this list is shared — no same-run reference row, indent not judged')
  }

  // --- The account list unfolds IN the bar, and crops no badge ---
  // Measured in BOTH states of the bar: the list is the same markup folded or not, so a
  // 56 px bar is the harder case — a card would overflow it, and a badge hanging 9 px off
  // its bubble is the first thing an `overflow-hidden` edge cuts.
  const listBoxes = {}
  for (const state of ['expanded', 'collapsed']) {
    const want = state === 'collapsed'
    const now = await page.evaluate(() => document.querySelector('[data-sidebar]')?.dataset.collapsed === 'true')
    if (now !== want) await toggle()
    await page.evaluate(() => {
      if (!document.querySelector('[data-account-list-open="true"]')) document.querySelector('[data-sidebar-row="account"]')?.click()
    })
    await new Promise(r => setTimeout(r, SETTLE_MS))
    const box = await page.evaluate(probeAccountListBox)
    if (!box) { console.error(`HARNESS: ${state}: the account list did not unfold — the A14 checks measured nothing`); process.exit(2) }
    if (!box.rows) { console.error(`HARNESS: ${state}: the unfolded list carries no row — nothing to measure`); process.exit(2) }
    if (!box.badges.length) { console.error(`HARNESS: ${state}: no unread badge in the account list — the clipping check measured nothing`); process.exit(2) }
    listBoxes[state] = box
    const worst = Math.min(...box.badges.map(b => b.visible))
    console.log(`account list (${state}): position=${box.position} radius=${box.radiusPx}px insideBar=${box.insideBar} rows=${box.rows} bg=${box.background} (bar ${box.barBackground}) shadow=${box.boxShadow}`)
    console.log(`  badges: ${box.badges.map(b => `"${b.text}" ${(b.visible * 100).toFixed(1)}%`).join(', ')} — worst ${(worst * 100).toFixed(1)}%`)
    if (box.position === 'fixed' || box.position === 'absolute') {
      failures.push(`account list (${state}): position ${box.position} — the list must unfold inside the bar, not float over it`)
    }
    if (box.radiusPx > MAX_LIST_RADIUS_PX) {
      failures.push(`account list (${state}): ${box.radiusPx}px corner radius (max ${MAX_LIST_RADIUS_PX}) — the list is the bar's surface, not a card`)
    }
    if (box.boxShadow && box.boxShadow !== 'none') {
      failures.push(`account list (${state}): casts a shadow (${box.boxShadow}) — the list is the bar's surface, not a raised card`)
    }
    if (!box.insideBar) failures.push(`account list (${state}): its box escapes the bar horizontally`)
    for (const b of box.badges) {
      if (b.visible < MIN_BADGE_VISIBLE) {
        failures.push(`account list (${state}): badge "${b.text}" is ${(b.visible * 100).toFixed(1)}% visible (min ${(MIN_BADGE_VISIBLE * 100).toFixed(0)}%) — something crops it`)
      }
    }
    // Collapsed, the name and the address live in the tooltip — and they are
    // joined by the house separator, never an em dash. Only judged in that state: the
    // expanded list prints them as rows and renders no tooltip at all.
    if (state === 'collapsed') {
      if (!box.tooltips.length) { console.error('HARNESS: collapsed: the account list renders no tooltip — the separator check measured nothing'); process.exit(2) }
      console.log(`  tooltips: ${box.tooltips.map(t => `"${t}"`).join(', ')}`)
      for (const tip of box.tooltips) {
        if (tip.includes(FORBIDDEN_DASH)) failures.push(`account list (collapsed): tooltip "${tip}" joins with an em dash — the house separator is "${ACCOUNT_TOOLTIP_SEPARATOR}"`)
      }
      if (!box.tooltips.some(t => t.includes(ACCOUNT_TOOLTIP_SEPARATOR))) {
        failures.push(`account list (collapsed): no tooltip uses the shipped separator "${ACCOUNT_TOOLTIP_SEPARATOR}" — got ${box.tooltips.map(t => `"${t}"`).join(', ')}`)
      }
    }
  }
  // Escape folds it, and the folding is what the user sees — not a node left on screen.
  await page.keyboard.press('Escape')
  await new Promise(r => setTimeout(r, SETTLE_MS))
  const afterEscape = await page.evaluate(probeAccountListBox)
  console.log(`account list after Escape: ${afterEscape ? 'STILL OPEN' : 'folded'}`)
  if (afterEscape) failures.push('account list: Escape did not fold it')
  // A click outside must fold it AND reach what it landed on — a backdrop swallowing the
  // first click is the light-dismiss bug this design rule exists to prevent. The target is
  // a folder row: if the click got through, the bar navigated to that folder.
  await page.evaluate(() => document.querySelector('[data-sidebar-row="account"]')?.click())
  await new Promise(r => setTimeout(r, SETTLE_MS))
  const outsideTarget = await page.evaluate(() => {
    const row = [...document.querySelectorAll('[data-sidebar] [data-sidebar-row^="folder:"]')]
      .find(r => r.getAttribute('data-sidebar-row') !== `folder:${new URLSearchParams(location.search).get('folder') ?? 'INBOX'}`)
    if (!row) return null
    const r = row.getBoundingClientRect()
    return { path: row.getAttribute('data-sidebar-row'), x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })
  if (!outsideTarget) { console.error('HARNESS: no second folder row to click outside onto — light-dismiss measured nothing'); process.exit(2) }
  const urlBefore = page.url()
  // The coordinates above were read one evaluate ago, and the bar re-renders on its own
  // (the account SWR refreshes on an interval): if anything shifted the rows since, the
  // point now covers a DIFFERENT row and the click would be judged against a target it
  // never aimed at. Re-read what the point actually covers, immediately before clicking —
  // a mismatch is a harness failure, and says nothing about the product's dismiss.
  const under = await page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y)
    return el?.closest('[data-sidebar-row]')?.getAttribute('data-sidebar-row') ?? null
  }, outsideTarget)
  if (under !== outsideTarget.path) {
    console.error(`HARNESS: the point aimed at ${outsideTarget.path} now covers ${under ?? 'nothing'} — the bar shifted between measuring and clicking, light-dismiss measured nothing`)
    process.exit(2)
  }
  await page.mouse.click(outsideTarget.x, outsideTarget.y)
  await new Promise(r => setTimeout(r, SETTLE_MS))
  const dismissed = await page.evaluate(probeAccountListBox)
  // The navigation this click triggers is a soft one, and on a loaded machine it can land
  // well after SETTLE_MS: sampling the URL on a fixed sleep reports UNCHANGED for a click
  // that DID get through. Poll for the change instead. A swallowed click never navigates
  // at all, so waiting longer cannot turn a real dismiss bug into a pass — it only removes
  // the timing race. Still UNCHANGED when the poll expires = the product failure below.
  await page.waitForFunction(before => location.href !== before, { timeout: NAV_SETTLE_MS }, urlBefore).catch(() => {})
  const urlAfter = page.url()
  console.log(`outside click on ${outsideTarget.path}: list ${dismissed ? 'STILL OPEN' : 'folded'}, url ${urlBefore === urlAfter ? 'UNCHANGED' : 'changed'} -> ${urlAfter}`)
  if (dismissed) failures.push('account list: a click outside did not fold it')
  if (urlBefore === urlAfter) {
    failures.push(`account list: the outside click on ${outsideTarget.path} did not reach its target (url unchanged) — the dismiss swallowed it`)
  }

  // --- The bar's accent IS the active account's colour, in both themes ---
  // Measured across TWO accounts in the SAME run: the bar's accent surfaces are compared
  // to the colour of the bubble heading the bar at that moment, never to a constant. The
  // popover is already open here, so the switch below is a real click on a shipped row.
  const accentOf = async pick => {
    if (pick) {
      const clicked = await page.evaluate(() => {
        const bar = document.querySelector('[data-sidebar]')
        const here = getComputedStyle(bar.querySelector('[data-sidebar-row="account"] [data-account-initial]').parentElement).backgroundColor
        // Picked by MEASUREMENT, not by name: the palette repeats every five accounts, so
        // naming a second mailbox can land on the colour the bar already wears and the
        // check would compare one colour with itself. Take the first row of the shipped
        // popover whose bubble is painted a DIFFERENT colour.
        const row = [...document.querySelectorAll('[data-account-list-open="true"] button')]
          .find(b => {
            const bubble = b.querySelector('[data-account-initial]')?.parentElement
            return bubble && getComputedStyle(bubble).backgroundColor !== here
          })
        if (!row) return null
        const label = (row.textContent ?? '').slice(0, 40)
        row.click()
        return label
      })
      if (!clicked) { console.error('HARNESS: every account listed wears the colour the bar already shows — the accent switch cannot be discriminated on this database'); process.exit(2) }
      console.log(`accent arm B: clicked "${clicked}"`)
      await new Promise(r => setTimeout(r, SETTLE_MS * 2))
    }
    const out = {}
    for (const theme of THEMES) {
      await page.evaluate(setTheme, theme)
      await new Promise(r => setTimeout(r, SETTLE_MS))
      out[theme] = await page.evaluate(probeAccountAccent)
      if (!out[theme]) { console.error('HARNESS: the bar has no account header — the accent measured nothing'); process.exit(2) }
    }
    await page.evaluate(setTheme, 'light')
    return out
  }
  // Arm A: the account the bar is on right now (the biggest mailbox, switched to above).
  const accentA = await accentOf(null)
  // Arm B: an account of a DIFFERENT colour — reached by a real click on a shipped row.
  // The popover must be open for that click; reopening it is itself the shipped path.
  await page.evaluate(() => {
    if (!document.querySelector('[data-account-list-open="true"]')) document.querySelector('[data-sidebar-row="account"]')?.click()
  })
  await new Promise(r => setTimeout(r, SETTLE_MS))
  const accentB = await accentOf(true)
  for (const [arm, measured] of [['A', accentA], ['B', accentB]]) {
    for (const theme of THEMES) {
      const m = measured[theme]
      console.log(`accent arm ${arm} (${theme}), account "${m.account}": published ${m.published || 'MISSING'} hue ${m.publishedHue?.toFixed(1)}deg vs bubble ${m.reference} hue ${m.referenceHue?.toFixed(1)}deg; unread badge ink contrast ${m.badgeContrast?.toFixed(2)}:1`)
      if (m.referenceHue == null) { console.error(`HARNESS: arm ${arm} (${theme}): the account bubble is neutral — no hue to compare against`); process.exit(2) }
      if (!m.published) failures.push(`arm ${arm} (${theme}): the bar publishes no --synap-account — nothing reads the account's colour`)
      if (m.publishedHue != null && hueGap(m.publishedHue, m.referenceHue) > MAX_ACCOUNT_ACCENT_HUE_DRIFT_DEG) {
        failures.push(`arm ${arm} (${theme}): --synap-account is ${m.published} (hue ${m.publishedHue.toFixed(1)}deg), the account's bubble is ${m.reference} (hue ${m.referenceHue.toFixed(1)}deg) — ${hueGap(m.publishedHue, m.referenceHue).toFixed(1)}deg apart (max ${MAX_ACCOUNT_ACCENT_HUE_DRIFT_DEG})`)
      }
      if (!m.surfaces.length) { console.error(`HARNESS: arm ${arm} (${theme}): no accent surface found in the bar`); process.exit(2) }
      for (const sf of m.surfaces) {
        console.log(`  ${sf.name}: ${sf.raw} -> ${sf.painted} hue ${sf.hue?.toFixed(1)}deg alpha ${sf.alpha.toFixed(3)}`)
        if (sf.alpha < ACCENT_MIN_ALPHA) {
          failures.push(`arm ${arm} (${theme}): ${sf.name} paints alpha ${sf.alpha.toFixed(3)} (min ${ACCENT_MIN_ALPHA}) — "${sf.raw}" did not resolve`)
          continue
        }
        if (sf.hue == null) { failures.push(`arm ${arm} (${theme}): ${sf.name} is neutral (${sf.painted}) — it carries no account colour`); continue }
        const gap = hueGap(sf.hue, m.referenceHue)
        if (gap > MAX_ACCOUNT_ACCENT_HUE_DRIFT_DEG) {
          failures.push(`arm ${arm} (${theme}): ${sf.name} is ${sf.painted} (hue ${sf.hue.toFixed(1)}deg), the account's bubble is ${m.reference} (hue ${m.referenceHue.toFixed(1)}deg) — ${gap.toFixed(1)}deg apart (max ${MAX_ACCOUNT_ACCENT_HUE_DRIFT_DEG})`)
        }
      }
      if (m.badgeContrast != null && m.badgeContrast < MIN_CONTRAST) {
        failures.push(`arm ${arm} (${theme}): the unread badge's ink measures ${m.badgeContrast.toFixed(2)}:1 on this account's colour (min ${MIN_CONTRAST}:1)`)
      }
    }
  }
  // The two arms must actually differ, or the check above passed on one colour twice.
  const armGap = hueGap(accentA.light.referenceHue, accentB.light.referenceHue)
  console.log(`arm A "${accentA.light.account}" hue ${accentA.light.referenceHue.toFixed(1)}deg vs arm B "${accentB.light.account}" hue ${accentB.light.referenceHue.toFixed(1)}deg — ${armGap.toFixed(1)}deg apart`)
  if (armGap <= MAX_ACCOUNT_ACCENT_HUE_DRIFT_DEG) {
    console.error(`HARNESS: both arms landed on the same account colour (${armGap.toFixed(1)}deg apart) — the switch did not change the accent, nothing was discriminated`)
    process.exit(2)
  }
  // Arm B left the bar on whichever account happened to carry a different colour — a
  // SMALL mailbox on most databases. The scroll checks below need a folder list that
  // actually overflows, so the bench is restored to the biggest mailbox first, by the
  // same shipped click path. Without this the scrollbar checks measure nothing and the
  // verdict depends on the order the accounts come back in, not on the product.
  await page.evaluate(() => {
    if (!document.querySelector('[data-account-list-open="true"]')) document.querySelector('[data-sidebar-row="account"]')?.click()
  })
  await new Promise(r => setTimeout(r, SETTLE_MS))
  const restored = await page.evaluate(label => {
    const row = [...document.querySelectorAll('[data-account-list-open="true"] button')]
      .find(b => (b.textContent ?? '').includes(label))
    if (!row) return false
    row.click()
    return true
  }, biggest.label)
  if (!restored) { console.error(`HARNESS: could not switch back to "${biggest.label}" — the scroll checks would measure an arbitrary mailbox`); process.exit(2) }
  await page.waitForFunction(
    n => document.querySelectorAll('[data-sidebar] [data-folder-glyph]').length === n,
    { timeout: 60000 }, biggest.custom,
  ).catch(() => {})
  console.log(`bench restored to "${biggest.label}" (${biggest.custom} custom folders) before the scroll checks`)

  // Hand the page back in the state the later checks assume: an open popover overlays the
  // bar, and a `page.hover()` aimed at a folder row underneath it would land on the
  // popover instead — the row would never see the pointer and its hover check would read
  // as a product failure. Dismissed the shipped way, by Escape.
  await page.keyboard.press('Escape')
  await new Promise(r => setTimeout(r, SETTLE_MS))

  // --- Scrollbar: native bar hidden, drawn thumb that fades when scrolling stops ---
  const sb = await page.evaluate(probeScrollbars)
  console.log(`scroll-hidden vs native reference (same run): scrollbar-width ${sb.styled.widthProp} vs ${sb.bare.widthProp}, gutter ${sb.styled.gutter}px vs ${sb.bare.gutter}px`)
  console.log(`shipped .scroll-hidden::-webkit-scrollbar display in the compiled stylesheet: ${sb.webkitDisplay ?? 'MISSING'}`)
  if (sb.webkitDisplay !== 'none') {
    failures.push(`compiled stylesheet ships .scroll-hidden::-webkit-scrollbar display=${sb.webkitDisplay ?? 'nothing'}, expected none`)
  }
  if (sb.styled.widthProp !== 'none') failures.push(`.scroll-hidden resolves scrollbar-width=${sb.styled.widthProp}, expected none`)
  if (sb.styled.widthProp === sb.bare.widthProp) {
    failures.push(`.scroll-hidden resolves the same scrollbar-width as the unstyled reference (${sb.bare.widthProp}) — the utility is not applying`)
  }
  if (sb.styled.gutter > sb.bare.gutter) failures.push(`.scroll-hidden reserves ${sb.styled.gutter}px, more than the native reference (${sb.bare.gutter}px)`)

  console.log(`ThinScroll containers in the bar: ${sb.containers.length}`)
  if (!sb.containers.length) { console.error('HARNESS: no [data-thin-scroll] container found — nothing to measure'); process.exit(2) }
  for (const c of sb.containers) {
    console.log(`  <${c.tag}>: viewport scrollbar-width=${c.viewportHidden} gutter=${c.gutter}px overflowing=${c.overflowing}px onScreen=${c.onScreen} thumb=${c.hasThumb}`)
    if (c.viewportHidden !== 'none') failures.push(`<${c.tag}> viewport resolves scrollbar-width=${c.viewportHidden}, expected none — the native bar is showing`)
    if (c.gutter > sb.bare.gutter) failures.push(`<${c.tag}> viewport reserves ${c.gutter}px, more than the native reference (${sb.bare.gutter}px)`)
  }
  // The fade can only be measured on a container that actually scrolls. The folder nav is
  // the one that overflows in the bar; if none does, the check measured nothing — harness
  // failure, not a product verdict.
  const scroller = sb.containers.findIndex(c => c.overflowing > 0 && c.onScreen)
  if (scroller < 0) { console.error('HARNESS: no ThinScroll container both overflows and is on screen — the thumb was never exercised'); process.exit(2) }

  // Real wheel input over the scrolling viewport, then read the thumb DURING the scroll.
  // Run in BOTH themes: the ink is derived from `currentColor`, so a value that paints on
  // the dark bar can resolve to nothing on the light one, and the paint is exactly what a
  // user sees (an opacity of 1 over a fully transparent background is still invisible).
  const target = await page.evaluate(i => {
    const vp = document.querySelectorAll('[data-thin-scroll]')[i].querySelector('[data-thin-scroll-viewport]')
    const r = vp.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  }, scroller)

  const fade = {}
  for (const theme of THEMES) {
    await page.evaluate(setTheme, theme)
    // Back to the top before each arm so the wheel always has somewhere to go — a container
    // already at its end would not move and the arm would measure nothing.
    await page.evaluate(i => {
      document.querySelectorAll('[data-thin-scroll]')[i].querySelector('[data-thin-scroll-viewport]').scrollTop = 0
    }, scroller)
    await new Promise(r => setTimeout(r, SETTLE_MS))
    await page.mouse.move(target.x, target.y)
    await page.mouse.wheel({ deltaY: 200 })
    // Read AFTER the fade-in has run to completion: at 120ms the first attempt caught the
    // thumb mid-transition at 0.74 and reported a product failure that was a harness one.
    await new Promise(r => setTimeout(r, THIN_SCROLL_FADE_MS + FADE_SETTLE_MS))
    const during = (await page.evaluate(probeScrollbars)).containers[scroller]
    // The pointer STAYS on the list while the idle delay runs: scrolling with the cursor
    // left over the content is how a user actually scrolls, and an earlier version of this
    // check moved it away first — which is precisely why it stayed green while the thumb
    // was pinned visible by a hover rule (found on review, 19/09/2026).
    await new Promise(r => setTimeout(r, THIN_SCROLL_IDLE_MS + THIN_SCROLL_FADE_MS + FADE_SETTLE_MS))
    const idle = (await page.evaluate(probeScrollbars)).containers[scroller]
    fade[theme] = { during, idle }

    const expectedH = (during.clientHeight * during.clientHeight) / during.scrollHeight
    const expectedTop = (during.clientHeight - expectedH) * (during.scrollTop / (during.scrollHeight - during.clientHeight))
    const paintedAlpha = alphaOf(during.thumbBg)
    console.log(`${theme}: thumb during scroll: opacity=${during.opacity} paint=${during.thumbBg} (alpha ${paintedAlpha}) width=${during.thumbW}px height=${during.thumbH?.toFixed(2)}px (expected ${expectedH.toFixed(2)}) top=${during.thumbTop?.toFixed(2)}px (expected ${expectedTop.toFixed(2)}) transition=${during.transitionProp} ${during.transitionMs}`)
    console.log(`${theme}: thumb ${((THIN_SCROLL_IDLE_MS + THIN_SCROLL_FADE_MS + FADE_SETTLE_MS) / 1000).toFixed(1)}s later, pointer still on the list: opacity=${idle.opacity} (scrollTop ${idle.scrollTop})`)
    if (!during.hasThumb) failures.push(`${theme}: no thumb rendered while the container was being scrolled`)
    if (during.scrollTop <= 0) { console.error('HARNESS: the wheel event did not move the viewport — the fade check measured nothing'); process.exit(2) }
    if (during.opacity !== 1) failures.push(`${theme}: thumb opacity ${during.opacity} while scrolling, expected 1`)
    if (paintedAlpha === null) failures.push(`${theme}: thumb background "${during.thumbBg}" is not a colour the alpha can be read from`)
    else if (paintedAlpha <= THUMB_MIN_ALPHA) {
      failures.push(`${theme}: thumb paints ${during.thumbBg} (alpha ${paintedAlpha}) while scrolling — nothing is drawn, the bar is invisible whatever its opacity`)
    }
    if (idle.opacity !== 0) failures.push(`${theme}: thumb opacity ${idle.opacity} ${THIN_SCROLL_IDLE_MS}ms after the last scroll with the pointer left on the list, expected 0 (faded out)`)
    if (during.thumbW !== THIN_SCROLL_WIDTH_PX) failures.push(`${theme}: thumb is ${during.thumbW}px wide, expected ${THIN_SCROLL_WIDTH_PX}px`)
    if (Math.abs(during.thumbH - expectedH) > MAX_THUMB_DRIFT_PX) {
      failures.push(`${theme}: thumb height ${during.thumbH.toFixed(2)}px, expected clientHeight²/scrollHeight = ${expectedH.toFixed(2)}px (max ${MAX_THUMB_DRIFT_PX}px off)`)
    }
    if (Math.abs(during.thumbTop - expectedTop) > MAX_THUMB_DRIFT_PX) {
      failures.push(`${theme}: thumb sits ${during.thumbTop.toFixed(2)}px from the top, expected ${expectedTop.toFixed(2)}px for scrollTop=${during.scrollTop} (max ${MAX_THUMB_DRIFT_PX}px off)`)
    }
    if (!during.transitionProp?.includes('opacity')) failures.push(`${theme}: thumb transitions "${during.transitionProp}", expected opacity`)
    if (during.transitionMs !== `${THIN_SCROLL_FADE_MS / 1000}s`) {
      failures.push(`${theme}: thumb fade lasts ${during.transitionMs}, expected ${THIN_SCROLL_FADE_MS / 1000}s`)
    }
  }
  // Same-run A/B on the paint itself: the ink comes from `currentColor`, so the two themes
  // must NOT resolve to the same colour — an identical value in both would mean the thumb
  // is painted from a fixed constant that ignores the surface it sits on.
  if (fade.light.during.thumbBg === fade.dark.during.thumbBg) {
    failures.push(`thumb paints the same ${fade.light.during.thumbBg} in light and dark — it does not derive from the bar's own ink`)
  }

  // --- Cleanliness: one accent, one row motif, static, follows the theme ---
  await page.keyboard.press('Escape') // fold the account list so only the bar's own rows are measured
  await new Promise(r => setTimeout(r, SETTLE_MS))
  const clean = {}
  for (const theme of THEMES) {
    await page.evaluate(setTheme, theme)
    await new Promise(r => setTimeout(r, SETTLE_MS))
    clean[theme] = await page.evaluate(probeCleanliness, ACCENT_MIN_SATURATION, COLOUR_TOKEN_SOURCE)
    const c = clean[theme]
    const hues = c.accents.map(a => a.hue)
    const spread = hues.length ? Math.max(...hues) - Math.min(...hues) : 0
    console.log(`${theme}: bar collapsed=${c.collapsed}, bar background ${c.barBg}, accent surfaces ${c.accents.length} spanning ${spread.toFixed(1)} deg of hue (${c.accents.map(a => `${a.colour} @${a.hue.toFixed(0)}deg`).join(', ') || 'none'}), animated elements ${c.animated.length}`)
    if (!c.accents.length) { console.error('HARNESS: no accent surface found in the bar — nothing to measure'); process.exit(2) }
    if (spread > MAX_ACCENT_HUE_SPREAD_DEG) {
      failures.push(`${theme}: bar paints accents spanning ${spread.toFixed(1)} deg of hue (max ${MAX_ACCENT_HUE_SPREAD_DEG}): ${c.accents.map(a => `${a.colour} @${a.hue.toFixed(0)}deg`).join(', ')}`)
    }
    if (c.animated.length) failures.push(`${theme}: ${c.animated.length} animated element(s) in the bar: ${c.animated.join(', ')}`)
    console.log(`  footer: theme-toggle slots=${c.footer.themeSlots}, settings rows=${c.footer.settingsRows}`)
    if (c.footer.themeSlots) failures.push(`${theme}: ${c.footer.themeSlots} theme-toggle slot(s) still in the bar, expected the theme in the user menu`)
    if (c.footer.settingsRows) failures.push(`${theme}: ${c.footer.settingsRows} settings row(s) still in the bar, expected the settings in the user menu`)
    const heights = [...new Set(c.rows.map(r => r.height.toFixed(2)))]
    console.log(`  row heights: ${heights.join(', ')} (rows: ${c.rows.length})`)
    if (heights.length > 1) failures.push(`${theme}: rows use ${heights.length} different heights (${heights.join(', ')}) — one motif expected`)
    for (const r of c.rows) {
      if (r.contrast < MIN_CONTRAST) {
        failures.push(`${theme}: row "${r.key}" ink ${r.ink} on ${r.on} = ${r.contrast.toFixed(2)}:1 (min ${MIN_CONTRAST}:1)`)
      }
    }
    const worst = c.rows.reduce((a, b) => (a.contrast < b.contrast ? a : b))
    console.log(`  worst row contrast: ${worst.contrast.toFixed(2)}:1 ("${worst.key}", ${worst.ink} on ${worst.on})`)
    // Hover feedback, measured as a same-run A/B on ONE real row: read at rest,
    // then with the pointer really moved over it. A theme token that cannot carry an alpha
    // makes Tailwind drop `hover:bg-foreground/[0.06]` entirely, and the two reads come
    // back byte-identical — which is precisely what this compares.
    const atRest = await page.evaluate(probeHoverState, null)
    if (!atRest) { console.error('HARNESS: no idle folder row found — nothing to hover'); process.exit(2) }
    await page.hover(`[data-sidebar] [data-sidebar-row="${atRest.key}"]`)
    await new Promise(r => setTimeout(r, SETTLE_MS))
    const hovered = await page.evaluate(probeHoverState, atRest.key)
    await page.mouse.move(0, 0)
    await new Promise(r => setTimeout(r, SETTLE_MS))
    const hoverAlpha = alphaOf(hovered.background) ?? 0
    console.log(`  hover on "${atRest.key}": ${atRest.background} -> ${hovered.background} (alpha ${hoverAlpha.toFixed(3)}), label ink ${atRest.ink}`)
    if (hovered.background === atRest.background) {
      failures.push(`${theme}: row "${atRest.key}" paints the same background at rest and under the pointer (${atRest.background}) — no hover feedback`)
    }
    if (hoverAlpha < HOVER_MIN_ALPHA) {
      failures.push(`${theme}: row "${atRest.key}" hover fill ${hovered.background} has alpha ${hoverAlpha.toFixed(3)} (min ${HOVER_MIN_ALPHA}) — the class emitted no paint`)
    }
    // The folder tiles, re-measured in THIS theme: the plate is painted from the theme's
    // own tokens, so a fill that reads in dark can vanish in light (the defect a human
    // review found on 19/09/2026). Both themes are measured in the SAME run, each against
    // the bar background of that same theme — the reference travels with the measurement.
    const tiles = await page.evaluate(probeFolderGlyphs)
    const worstTile = tiles.reduce((a, b) => (a.tileContrast < b.tileContrast ? a : b))
    console.log(`  worst folder tile: ${worstTile.tileContrast.toFixed(3)}:1 ("${worstTile.text}", plate ${worstTile.background} on bar ${worstTile.barBg}), letters ${worstTile.inkContrast.toFixed(2)}:1 at ${worstTile.fontSize}`)
    for (const t of tiles) {
      if (t.tileContrast < FOLDER_GLYPH_MIN_TILE_CONTRAST) {
        failures.push(`${theme}: folder tile ${t.key} plate ${t.background} on bar ${t.barBg} = ${t.tileContrast.toFixed(3)}:1 (min ${FOLDER_GLYPH_MIN_TILE_CONTRAST}:1)`)
      }
      if (t.chars !== FOLDER_GLYPH_LETTERS) {
        failures.push(`${theme}: folder tile ${t.key} carries ${t.chars} character(s) ("${t.text}") — exactly ${FOLDER_GLYPH_LETTERS} expected`)
      }
      if (t.inkSat > FOLDER_GLYPH_MAX_SATURATION || t.bgSat > FOLDER_GLYPH_MAX_SATURATION) {
        failures.push(`${theme}: folder tile ${t.key} is not monochrome — ink ${t.inkSat.toFixed(3)}, plate ${t.bgSat.toFixed(3)} (max ${FOLDER_GLYPH_MAX_SATURATION})`)
      }
    }
  }
  // Same-run A/B: a bar that ignores the theme reports the same background in both.
  if (clean.light.barBg === clean.dark.barBg) {
    failures.push(`the bar paints the same background in light and dark (${clean.light.barBg}) — it does not follow the theme`)
  }
  await page.evaluate(setTheme, 'dark')

  // --- Mobile 390: the drawer opens, nothing overflows horizontally ---
  await page.setViewport(MOBILE_VIEWPORT)
  await new Promise(r => setTimeout(r, SETTLE_MS))
  const mobile = await page.evaluate(trigger => {
    const burger = document.querySelector(trigger)
    burger?.click()
    return new Promise(resolve => setTimeout(() => {
      const bar = document.querySelector('[data-sidebar-drawer] [data-sidebar]')
      resolve({
        drawerOpen: !!bar,
        rows: bar ? bar.querySelectorAll('[data-sidebar-row]').length : 0,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        widest: Math.max(0, ...[...document.querySelectorAll('[data-sidebar-drawer] [data-sidebar] *')].map(e => e.getBoundingClientRect().right)),
      })
    }, 400))
  }, DRAWER_TRIGGER)
  console.log(`mobile ${MOBILE_VIEWPORT.width}px: drawer open=${mobile.drawerOpen} rows=${mobile.rows} horizontal overflow=${mobile.overflow}px widest bar edge=${mobile.widest.toFixed(1)}px`)
  if (!mobile.drawerOpen) { console.error('HARNESS: the mobile drawer did not open — nothing measured'); process.exit(2) }
  if (mobile.overflow > 0) failures.push(`mobile ${MOBILE_VIEWPORT.width}px: ${mobile.overflow}px of horizontal overflow`)
  if (mobile.widest > MOBILE_VIEWPORT.width) failures.push(`mobile ${MOBILE_VIEWPORT.width}px: an element of the bar reaches ${mobile.widest.toFixed(1)}px, past the viewport`)

  // The drawer has no round button: it closes on ONE click on the veil.
  const drawerStray = await page.evaluate(({ sel, drawer }) =>
    document.querySelector(drawer)?.querySelectorAll(sel).length ?? null, { sel: EDGE_TOGGLE, drawer: DRAWER })
  if (drawerStray == null) { console.error('HARNESS: the drawer is not in the DOM — nothing measured'); process.exit(2) }
  if (drawerStray) failures.push(`mobile: ${drawerStray} floating collapse button(s) in the drawer, expected none`)
  await page.evaluate(drawer => document.querySelector(`${drawer} > div`)?.click(), DRAWER)
  await new Promise(r => setTimeout(r, SETTLE_MS))
  const drawerClosed = await page.evaluate(drawer => !document.querySelector(drawer), DRAWER)
  console.log(`mobile ${MOBILE_VIEWPORT.width}px: floating buttons in the drawer=${drawerStray}, one click on the veil → drawer closed=${drawerClosed}`)
  if (!drawerClosed) failures.push('mobile: one click on the veil did not close the drawer')
} finally {
  // Close the tab before the browser: an open tab keeps its /api/stream SSE
  // connection alive on the dev server, and orphaned tabs pile those up.
  for (const p of await browser.pages()) { await p.close().catch(() => {}) }
  await browser.close()
}

if (failures.length) {
  console.error(`FAIL: ${failures.length} drift(s) over ${MAX_DRIFT_PX}px`)
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(1)
}
console.log(`OK: no icon moved, no row height changed, no horizontal overflow (tolerance ${MAX_DRIFT_PX}px)`)
