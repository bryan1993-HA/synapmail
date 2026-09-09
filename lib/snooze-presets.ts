/**
 * Client-side snooze preset times. Keys map to i18n strings in the `mail`
 * namespace. Presets already in the past (e.g. "this evening" after 18:00)
 * are dropped.
 */
export function snoozePresets(now: Date = new Date()): { key: string; date: Date }[] {
  const clone = (d: Date) => new Date(d.getTime())

  const later = clone(now)
  later.setHours(later.getHours() + 3)

  const tonight = clone(now)
  tonight.setHours(18, 0, 0, 0)

  const tomorrow = clone(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  tomorrow.setHours(8, 0, 0, 0)

  const weekend = clone(now)
  const toSat = (6 - weekend.getDay() + 7) % 7 || 7
  weekend.setDate(weekend.getDate() + toSat)
  weekend.setHours(8, 0, 0, 0)

  const nextWeek = clone(now)
  const toMon = (1 - nextWeek.getDay() + 7) % 7 || 7
  nextWeek.setDate(nextWeek.getDate() + toMon)
  nextWeek.setHours(8, 0, 0, 0)

  return [
    { key: 'snoozeLater', date: later },
    { key: 'snoozeTonight', date: tonight },
    { key: 'snoozeTomorrow', date: tomorrow },
    { key: 'snoozeWeekend', date: weekend },
    { key: 'snoozeNextWeek', date: nextWeek },
  ].filter(p => p.date.getTime() > now.getTime() + 60_000)
}
