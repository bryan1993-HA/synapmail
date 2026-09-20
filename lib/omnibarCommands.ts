/**
 * What the app bar can offer beyond a mail search: the mailboxes, the cross-cutting
 * actions and ALL the settings entries.
 *
 * The PURE half of the contract (no React, no network): the component adds the
 * translated labels and the icons, this module only decides what matches the input
 * and in which order. Its self-check is `scripts/check-omnibar-commands.mjs`.
 */

/**
 * Comparable form of a text: accent-free, case-free. Both sides of every comparison
 * go through it, so an accented word is found by typing its unaccented spelling and
 * vice versa.
 */
export function foldText(value: string): string {
  // The combining-diacritics range (U+0300..U+036F) rather than `\p{Diacritic}`:
  // the Unicode class requires an ES6+ `target`, which this project does not pin.
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

/**
 * Order of the panel's sections, as required: mailboxes first (switching happens more
 * often than configuring), then actions, then settings. Mail search is not a section:
 * it is the fallback row, always rendered last by the component.
 */
export const OMNIBAR_SECTIONS = ['accounts', 'actions', 'settings'] as const
export type OmnibarSection = (typeof OMNIBAR_SECTIONS)[number]

export type OmnibarEntry = {
  /** Stable identity of an entry, what the test harness and keyboard navigation address. */
  id: string
  section: OmnibarSection
  label: string
  /** Subdued line under the label: a setting's path, a mailbox's address. */
  hint?: string
  /** Extra comma-separated words the entry can be found by (translated). */
  keywords?: string
}

/**
 * An entry matches when EVERY word of the input appears in at least one of its texts
 * (label, subdued line, keywords) — "api keys" finds "API Keys" whatever the word
 * order, and "api" alone finds it too.
 *
 * Unlike `parseQuery` (IMAP search, where a one-letter term would pull in the whole
 * mailbox), no word is dropped for its length: the panel opens FROM THE FIRST
 * character and filters an already short list, in memory.
 */
export function matchOmnibar(query: string, entries: readonly OmnibarEntry[]): OmnibarEntry[] {
  const terms = foldText(query).split(/\s+/).filter(Boolean)
  if (!terms.length) return []
  const bySection = (e: OmnibarEntry) => OMNIBAR_SECTIONS.indexOf(e.section)
  /**
   * 0 when the LABEL already carries the whole input, 1 otherwise. Breaks ties
   * between neighbouring entries that share keywords: "dark" ranks "Dark theme"
   * before "Light theme", even though both are found through the keyword "theme".
   * Without this rank, declaration order let the keyboard land on an entry while the
   * input actually NAMED the other one.
   */
  const byLabel = (e: OmnibarEntry) => {
    const label = foldText(e.label)
    return terms.every(term => label.includes(term)) ? 0 : 1
  }
  return entries
    .filter(entry => {
      const haystacks = [entry.label, entry.hint ?? '', entry.keywords ?? ''].map(foldText)
      return terms.every(term => haystacks.some(h => h.includes(term)))
    })
    // STABLE sort: at equal section and equal rank, entries keep the order in which
    // the caller declared them (the settings navigation, the mailbox ordering).
    .sort((a, b) => bySection(a) - bySection(b) || byLabel(a) - byLabel(b))
}
