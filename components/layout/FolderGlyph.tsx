'use client'

import { cn } from '@/lib/utils'
import { WORD_SPLIT, twoLetters } from './AccountAvatar'

/**
 * A custom folder has no meaningful icon: collapsed, a column of identical `Folder`
 * glyphs tells the user nothing. This renders the folder's own letters in a square
 * tile the exact size of a row icon, so the row keeps its geometry (the collapse
 * contract measures `iconX/iconY/iconW/iconH`) while becoming readable folded.
 * Monochrome on purpose — the bar carries ONE accent, and it is not spent here.
 */

/**
 * Same box as a lucide row icon (`w-4 h-4`) — the tile IS the icon of its row, so the
 * collapse contract keeps measuring one geometry. Letters at 10 px with a touch of
 * tracking: at 9 px and no tracking the pair read as one smudge inside a 16 px plate.
 */
const TILE = 'w-4 h-4 flex items-center justify-center select-none tracking-[0.3px] text-[10px] font-semibold leading-none'
/**
 * A CASE, not a bubble. `rounded-md` resolves to `calc(var(--radius) - 2px)` = 8 px in
 * this theme, which on a 16 px box is a perfect circle: a visual review
 * read a folder tile as an account bubble, two kinds of object wearing one shape. The
 * radius is therefore stated here in pixels and NEVER derived from `--radius`, whose
 * job is the app's cards. Softly rounded corners, still unmistakably square.
 */
const TILE_RADIUS_PX = 3
/**
 * The plate must READ as a plate. `bg-secondary` (the theme's neutral pair) computes to
 * oklch(0.97) on a bar at oklch(0.985) in light — a measured 1.03:1, which a reviewer
 * saw as letters floating with no tile at all. `color-mix` composites the theme's own
 * foreground into the surface at a fixed ratio, so ONE value serves both themes and the
 * tile stays greyscale (both operands are achromatic in this palette).
 * Calibration bench: `scripts/check-sidebar-collapse.mjs`, headless Chrome, the bar's
 * light `--sidebar` oklch(0.985) and dark oklch(0.205) — 24 % yields 1.90:1 light and
 * 1.88:1 dark against the bar, both clear of the 1.5:1 floor the harness enforces, while
 * keeping the letters themselves at ~10:1 on the plate.
 */
const TILE_INK_MIX = '24%'
const TILE_IDLE = 'text-foreground'
const TILE_FILL = {
  backgroundColor: `color-mix(in oklab, var(--foreground) ${TILE_INK_MIX}, var(--sidebar))`,
  borderRadius: `${TILE_RADIUS_PX}px`,
}

/**
 * Whitespace and punctuation inside a name. Stripping it leaves ONLY letters and digits,
 * which is what makes every character of a flattened name a legal tile character — no
 * second "is this alphanumeric" test is needed anywhere below. Same character class as
 * `WORD_SPLIT` (AccountAvatar), globally applied: one definition of a word gap for the bar.
 */
const WORD_GAP = new RegExp(WORD_SPLIT.source, 'g')

/** A folder's own name: the segment after the last separator of its IMAP path. */
const leafName = (folder: { name?: string; path: string }) => {
  const fromPath = folder.path.split(/[/.]/).filter(Boolean).pop() ?? ''
  return (folder.name?.trim() || fromPath).trim()
}

/**
 * Stand-in for a character a name simply does not have: a folder called `A` yields one
 * letter and nothing to pair it with. A tile is two characters WIDE in every case, so
 * the slot is filled rather than left short — the full path stays on hover.
 */
const GLYPH_PAD = '\u00b7'
/** A name made only of separators spells nothing; say so rather than render a blank. */
const GLYPH_UNKNOWN = '??'

/**
 * A tile carries exactly two characters, in every case — a fixed width, not a floor with
 * a ceiling above it. Measured on a real mailbox (92 custom folders, 19/09/2026):
 * the previous rule's 13 three-letter tiles inked 2.2 to 4.7 px past the 16 px plate,
 * because three glyphs at the 10 px semibold this plate is drawn for do not fit in it.
 * Lengthening is therefore not a tie-break the tile can afford; re-spelling is.
 * This is the ONE place a pair is built, so that width cannot drift apart per caller.
 */
const pair = (first: string, second: string | undefined) =>
  first ? `${first}${second ?? GLYPH_PAD}` : GLYPH_UNKNOWN

/**
 * First index at which a set of flattened names stops agreeing — the character a human
 * reading the list would use to tell them apart (`BILAN2021…` vs `BILAN2023…` diverge on
 * the year's third digit, so the tiles read B1/B3 rather than BI/BI). Never index 0: the
 * first character is the one thing homonyms share, and it anchors the pair.
 * When one name is a prefix of the others they agree everywhere they overlap, so the
 * first character PAST the overlap is what separates them.
 */
const divergenceIndex = (flats: string[]) => {
  const overlap = Math.min(...flats.map(f => f.length))
  for (let i = 1; i < overlap; i++) {
    if (flats.some(f => f[i] !== flats[0][i])) return i
  }
  return overlap
}

/**
 * Every pair a name can legally spell, best first: the divergence character when the
 * name is fighting for its base pair, then each of its own remaining characters in
 * order. The name's base pair comes first when nothing contests it, and LAST when
 * something does — a folder that must be re-spelled should not be handed back the very
 * pair its homonym also wants.
 */
const candidates = (base: string, flat: string, siblings: string[]) => {
  if (!flat) return [base]
  const contested = siblings.length > 1
  const want = contested ? [pair(flat[0], flat[divergenceIndex(siblings)])] : [base]
  for (const c of flat.slice(1).split('')) want.push(pair(flat[0], c))
  if (contested) want.push(base)
  return want.filter((c, i) => want.indexOf(c) === i)
}

/**
 * Hands each folder one pair out of its own candidate list, such that no two folders of
 * the list share a pair. Plain greedy is not enough on a real mailbox: measured on the
 * 92-folder box of 19/09/2026, nineteen folders start with `C` and greedy left
 * `CONVENTIONS` with every pair it can spell already handed out, falling back onto a
 * duplicate `CO`. So a folder that finds its candidates taken asks the current holder to
 * move on to one of ITS remaining candidates (an augmenting search — Kuhn's matching),
 * which resolves the whole chain at once and hands out the largest possible number of
 * distinct pairs. `seen` bounds the search to one visit per pair, so it terminates.
 */
const seatFolders = (wants: string[][]) => {
  const owner = new Map<string, number>()
  const seat: (string | null)[] = wants.map(() => null)
  const take = (i: number, seen: Set<string>): boolean => {
    for (const c of wants[i]) {
      if (seen.has(c)) continue
      seen.add(c)
      const held = owner.get(c)
      if (held === undefined || take(held, seen)) {
        owner.set(c, i)
        seat[i] = c
        return true
      }
    }
    return false
  }
  wants.forEach((_, i) => take(i, new Set()))
  return seat
}

/**
 * Characters for every custom folder of ONE list, resolved together — exactly two each.
 * Folders that would spell the same pair are re-spelled rather than lengthened: they keep
 * the first character (the one they share, and the one the eye anchors on) and take as
 * second the character where their names actually diverge — `bilan 2021…`/`bilan 2023…`
 * read B1/B3, not BI/BI. Measured on a real mailbox of 92 folders: lengthening produced
 * 13 tiles inked up to 4.7 px outside the 16 px plate AND still collided, because the
 * third character was shared too; re-spelling fixes both at once.
 * Computed per LIST because a row cannot know about its siblings.
 */
export const folderInitials = <T extends { name?: string; path: string }>(folders: T[]) => {
  const leaves = folders.map(f => leafName(f))
  const flats = leaves.map(l => l.replace(WORD_GAP, '').toUpperCase())
  const bases = leaves.map((l, i) => twoLetters(l) || pair(flats[i][0] ?? '', undefined))
  const byBase = new Map<string, string[]>()
  bases.forEach((base, i) => byBase.set(base, [...(byBase.get(base) ?? []), flats[i]]))
  const seats = seatFolders(bases.map((base, i) => candidates(base, flats[i], byBase.get(base) ?? [])))
  // A folder whose every candidate is spoken for keeps its base pair rather than wear a
  // glyph nobody can map back to a name; the full path stays on hover either way.
  return new Map(folders.map((folder, i) => [folder.path, seats[i] ?? bases[i]]))
}

/**
 * Component identities, kept per letter pair. `folderGlyph` binds its letters by
 * closing over them, so a fresh closure on every render would be a NEW component
 * type and React would unmount then remount the tile each time — the one thing the
 * collapse contract forbids for a row icon. Caching makes the identity stable, and
 * the cache is bounded by the number of distinct letter pairs, not by renders.
 */
const GLYPHS = new Map<string, React.ComponentType<React.HTMLAttributes<HTMLSpanElement>>>()

/**
 * The tile itself, built as a row-icon component so it drops into `RowBody`'s icon
 * slot unchanged: the caller binds the letters, `RowBody` supplies the sizing class
 * and the `data-sidebar-icon` marker every measured row carries.
 */
export const folderGlyph = (initials: string) => {
  const cached = GLYPHS.get(initials)
  if (cached) return cached
  // TILE_IDLE comes LAST so a caller's class can size or place the tile but never
  // colour it: the tile stays monochrome even on the active row, where ordinary
  // rows tint their icon with the accent.
  const Glyph = ({ className, style, ...rest }: React.HTMLAttributes<HTMLSpanElement>) => (
    <span {...rest} style={{ ...TILE_FILL, ...style }} className={cn(TILE, className, TILE_IDLE)} data-folder-glyph>
      {initials}
    </span>
  )
  Glyph.displayName = `FolderGlyph(${initials})`
  GLYPHS.set(initials, Glyph)
  return Glyph
}
