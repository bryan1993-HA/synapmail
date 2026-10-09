'use client'

import { mutate } from 'swr'

/** The SWR key every reader of the user's settings subscribes to. */
export const SETTINGS_KEY = '/api/settings'

type Settings = Record<string, unknown>
type Cached = { data: Settings } | undefined

/**
 * Write user settings, as the ONE way to do it.
 *
 * The change shows at once (optimistic) and the PATCH itself is the SWR mutation
 * on the shared key: for as long as it is in flight, SWR discards any revalidation
 * that finishes meanwhile — the `revalidateOnFocus` GET of an alt-tab, a poll —
 * so a stale answer can no longer overwrite what was just chosen. A bare
 * `mutate(key, value, false)` followed by a separate `fetch()` leaves that window
 * open: the mutation is over before the PATCH has even started. The PATCH answers
 * with the whole settings row, which becomes the cache; a refused or failed write
 * rolls the cache back to what the server last confirmed.
 */
export const saveSettings = (patch: Settings) =>
  mutate<Cached>(
    SETTINGS_KEY,
    fetch(SETTINGS_KEY, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }).then(async res => {
      const body = await res.json() as { data?: Settings; error?: string }
      if (!res.ok || !body.data) throw new Error(body.error ?? `HTTP ${res.status}`)
      return { data: body.data }
    }),
    {
      optimisticData: curr => (curr ? { data: { ...curr.data, ...patch } } : curr),
      revalidate: false,
      throwOnError: false,
    },
  )
