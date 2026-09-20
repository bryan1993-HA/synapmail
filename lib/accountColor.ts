/**
 * The colour of a mailbox, as ONE source — read by the bar's bubbles and accent, by the
 * accounts screen and by the API that validates what the user picks. No Tailwind class
 * lives here: Tailwind does not scan `lib/`, so a class written here would never ship.
 */

/**
 * Automatic palette — indexed with the account's rank in the list, used whenever the
 * user has not picked a colour. Shades are chosen so a white initial stays readable on
 * every bubble: measured WCAG contrast against #fff is 5.17 / 5.70 / 5.48 / 5.02 / 4.70,
 * all above the 4.5:1 floor for small bold text. The 500 shades this replaced fell as
 * low as 2.15 (amber) and 2.54 (emerald). `scripts/check-account-color.mjs` recomputes
 * these ratios from the rendered bubbles, so the floor is enforced, not asserted.
 */
export const ACCOUNT_PALETTE = ['#2563eb', '#7c3aed', '#047857', '#b45309', '#e11d48'] as const

/** What the API accepts as a chosen colour, and what the hex field validates against. */
export const BADGE_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/

/** Length of a `#RRGGBB` colour — what the hex field is allowed to hold, and nothing more. */
export const HEX_LENGTH = 7

export const isBadgeColor = (value: unknown): value is string =>
  typeof value === 'string' && BADGE_COLOR_PATTERN.test(value)

/** The two inks a bubble can carry. Pure black, not a near-black: see `readableInk`. */
export const INK = { light: '#ffffff', dark: '#000000' } as const

/** WCAG AA floor for small bold text — bubble letters are 9-12 px, so 4.5:1 is the minimum. */
export const MIN_CONTRAST = 4.5

const channel = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)

/** Relative luminance of a `#RRGGBB` colour, per WCAG 2.x. */
export const luminance = (hex: string) => {
  const n = parseInt(hex.slice(1), 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(c => channel(c / 255))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Contrast ratio between two `#RRGGBB` colours, per WCAG 2.x. */
export const contrastRatio = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/**
 * The ink that stays readable on `background`, whatever the user picked. White and PURE
 * black are the two candidates because the worse of the two is at its best there: the two
 * curves cross at luminance 0.179, where both read 4.58:1 — above the 4.5:1 floor. A
 * near-black ink (#111) would drop that crossing point to 4.34:1, so a mid-tone colour
 * chosen from the wheel would have no readable ink at all.
 */
export const readableInk = (background: string) =>
  contrastRatio(background, INK.light) >= contrastRatio(background, INK.dark) ? INK.light : INK.dark

/** An account, as far as its colour is concerned. */
export interface ColorableAccount {
  badgeColor?: string | null
}

/**
 * The effective colour of an account: the one its owner chose, else the automatic colour
 * for its rank in the list. Every surface that paints an account — bubble, accent
 * variables, settings badge, omnibar suggestion — resolves it here and nowhere else.
 */
export const accountColor = (account: ColorableAccount | null | undefined, rank: number) => {
  const chosen = account?.badgeColor
  return isBadgeColor(chosen) ? chosen : ACCOUNT_PALETTE[rank % ACCOUNT_PALETTE.length]
}

/**
 * Total order of a user's mailboxes: the chosen default first, then the oldest, then the id
 * as the tie-break. Without that last term the order is NOT total — mailboxes imported in one
 * go share a `created_at`, and PostgreSQL then returns ties in physical order, which changes
 * as soon as any row is updated. A mailbox's rank in this list decides its automatic colour,
 * so an unstable order repaints every mailbox its owner never touched. Both queries that list
 * mailboxes read this one clause, each passing the names it exposes: a UNION can only be
 * ordered by its OUTPUT names, which are quoted camelCase in `app/api/accounts/route.ts`.
 */
export const accountOrderBy = (
  cols: { isDefault: string; createdAt: string; id: string } = {
    isDefault: 'is_default',
    createdAt: 'created_at',
    id: 'id',
  }
) => `ORDER BY ${cols.isDefault} DESC, ${cols.createdAt} ASC, ${cols.id} ASC`
