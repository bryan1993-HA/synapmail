/** Parses an ISO date coming from the API; null when absent or invalid (never "Invalid Date" on screen). */
export function parseDate(iso: string | null | undefined): Date | null {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * FULL date + time of a list row — single source.
 *
 * `Intl` carries the format, never a hand-copied string: the interface language
 * decides the order and the separator (en "Sep 18, 2026, 10:41 AM", zh
 * "2026年9月18日 10:41"). On the current day, the date gives way to the "Today"
 * label — the one used by the group headers, passed in by the caller so this
 * function stays free of i18n.
 */
export function formatRowDate(iso: string, locale: string, todayLabel: string): string {
  const d = parseDate(iso)
  if (!d) return ''
  const time = new Intl.DateTimeFormat(locale, { timeStyle: 'short' }).format(d)
  if (d.toDateString() === new Date().toDateString()) return `${todayLabel}, ${time}`
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(d)
}
