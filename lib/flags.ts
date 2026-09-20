/**
 * Colour flags, following the Apple Mail convention — SINGLE source.
 *
 * Measured against a real test account: the mailbox advertises `\*` in its
 * `permanentFlags` and a `STORE +FLAGS ($MailFlagBit0)` survives a reconnect.
 * Apple's keywords are therefore written AS IS into IMAP: a flag set here is the
 * one a desktop mail client displays, and vice versa. No colour is stored in the
 * database.
 *
 * Apple's encoding: `\Flagged` carries the fact of being marked, and the colour
 * INDEX (0..6) is written in binary across three keywords `$MailFlagBit0/1/2`,
 * bit 0 being the least significant. Red (index 0) therefore has NO bit: it is the
 * colour of a bare `\Flagged`, which keeps the legacy star compatible.
 */

export const FLAG_IMAP_FLAG = '\\Flagged'

/** Keywords carrying the colour bits, from least to most significant. */
export const FLAG_BIT_KEYWORDS = ['$MailFlagBit0', '$MailFlagBit1', '$MailFlagBit2'] as const

export interface MailFlag {
  /** Stable key, used by the API and the interface. */
  key: string
  /** Apple's index (0..6), encoded across the bits. */
  index: number
  /**
   * The flag's colour — the ONLY colour in this interface. It is a CSS VALUE, not a
   * utility class: Tailwind does not scan `lib/`, so a class named here would never
   * be generated. The variable is declared in `app/globals.css` (light + `.dark`),
   * to be applied as `style={{ color }}`.
   */
  color: string
  /** i18n key, under the `mail.flags` namespace. */
  labelKey: string
}

export const MAIL_FLAGS: readonly MailFlag[] = [
  { key: 'red',    index: 0, color: 'var(--flag-red)',    labelKey: 'red' },
  { key: 'orange', index: 1, color: 'var(--flag-orange)', labelKey: 'orange' },
  { key: 'yellow', index: 2, color: 'var(--flag-yellow)', labelKey: 'yellow' },
  { key: 'green',  index: 3, color: 'var(--flag-green)',  labelKey: 'green' },
  { key: 'blue',   index: 4, color: 'var(--flag-blue)',   labelKey: 'blue' },
  { key: 'purple', index: 5, color: 'var(--flag-purple)', labelKey: 'purple' },
  { key: 'gray',   index: 6, color: 'var(--flag-gray)',   labelKey: 'gray' },
] as const

/** Colour of a `\Flagged` without bits — and colour of the legacy `isStarred: true`. */
export const DEFAULT_FLAG_KEY = MAIL_FLAGS[0].key

export function flagByKey(key: string | null | undefined): MailFlag | null {
  if (!key) return null
  return MAIL_FLAGS.find(f => f.key === key) ?? null
}

/** IMAP keywords to SET for this colour (bits equal to 1 only). */
export function keywordsForFlag(key: string): string[] {
  const flag = flagByKey(key)
  if (!flag) return []
  return FLAG_BIT_KEYWORDS.filter((_, bit) => (flag.index >> bit) & 1)
}

/** Colour carried by a set of IMAP keywords, or `null` when the message is not marked. */
export function flagFromKeywords(flags: Iterable<string> | null | undefined): string | null {
  if (!flags) return null
  const set = flags instanceof Set ? (flags as Set<string>) : new Set(flags)
  if (!set.has(FLAG_IMAP_FLAG)) return null
  let index = 0
  FLAG_BIT_KEYWORDS.forEach((kw, bit) => { if (set.has(kw)) index |= 1 << bit })
  return flagByKey(MAIL_FLAGS.find(f => f.index === index)?.key ?? null)?.key ?? DEFAULT_FLAG_KEY
}

/**
 * List filters. The value IS the i18n key (`mail.<value>`) and the value sent to the
 * API: a filter added here has nothing else to update.
 */
export const MAIL_LIST_FILTERS = ['all', 'unread', 'flagged'] as const
export type MailListFilter = (typeof MAIL_LIST_FILTERS)[number]
