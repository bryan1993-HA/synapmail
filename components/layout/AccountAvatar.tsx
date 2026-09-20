'use client'

import { useEffect, useState } from 'react'
import useSWR from 'swr'
import { cn } from '@/lib/utils'
import { accountColor, readableInk } from '@/lib/accountColor'
import type { ColorableAccount } from '@/lib/accountColor'
import type { EmailAccount } from '@/types/account'

export { accountColor, readableInk } from '@/lib/accountColor'

/**
 * Shades derived from the active account's colour, in ONE place: the percentages below
 * are the whole vocabulary of the bar's accent. `tint` fills an active row, `tintStrong`
 * a drop target, `deep` a pressed/hovered filled control, `lift` the same hue raised for
 * a dark background (the accents are -600/-700 shades, too dark to read as ink there),
 * `ring` a focus ring, `shadow` the colour a raised surface casts.
 */
const ACCENT_MIXES = {
  tint: ['12%', 'transparent'],
  'tint-strong': ['22%', 'transparent'],
  deep: ['85%', 'black'],
  lift: ['62%', 'white'],
  ring: ['40%', 'transparent'],
  shadow: ['25%', 'transparent'],
} as const

/**
 * The custom properties every accent surface of the bar reads, published on the bar's
 * root — and on the shell's edge toggle, which straddles the bar from outside it. One
 * account colour in, the bar's whole accent out: switching account repaints the active
 * folder, the compose control, the rings and the shadows in one step, with no second
 * palette and nothing to keep in sync.
 */
export const accentVars = (account: ColorableAccount | null | undefined, rank: number): Record<string, string> => {
  const colour = accountColor(account, rank)
  // The ink every filled accent surface writes with — the compose control included, so a
  // pale colour picked from the wheel keeps its label readable instead of losing it in white.
  const vars: Record<string, string> = { '--synap-account': colour, '--synap-account-ink': readableInk(colour) }
  for (const [name, [amount, into]] of Object.entries(ACCENT_MIXES)) {
    vars[`--synap-account-${name}`] = `color-mix(in oklab, ${colour} ${amount}, ${into})`
  }
  return vars
}

/**
 * The bar's ONE accent, as one source. Every primary/active/selected state of the
 * sidebar is painted from here — `solid` for a filled control, `tint` for the
 * background of an active row, `ink` for the glyph that marks it. Nothing else in
 * the bar may introduce a second accent, a gradient or a decorative ring.
 * The classes are written as literals, not composed from the names above: Tailwind
 * scans source text, so a class built by interpolation would never be emitted.
 */
export const ACCENT = {
  solid: 'bg-[color:var(--synap-account)] text-[color:var(--synap-account-ink)]',
  tint: 'bg-[color:var(--synap-account-tint)]',
  tintStrong: 'bg-[color:var(--synap-account-tint-strong)]',
  ink: 'text-[color:var(--synap-account)] dark:text-[color:var(--synap-account-lift)]',
  ring: 'ring-[color:var(--synap-account-ring)]',
  /** Raised surfaces of the bar cast the account's colour rather than a neutral grey. */
  shadow: 'shadow-[0_4px_16px_var(--synap-account-shadow)]',
} as const

/**
 * Which account the bar is showing, as ONE rule: the explicitly selected one, else the
 * default, else the first. The bar and the shell both need it — the bar to paint its
 * rows, the shell to tint the toggle that straddles the bar's edge from outside it —
 * and two answers to that question would mean two accents on screen at once.
 */
export const resolveActiveAccount = (accounts: EmailAccount[], activeId: string | null) =>
  accounts.find(a => a.id === activeId) ?? accounts.find(a => a.isDefault) ?? accounts[0]

const fetchJson = (url: string) => fetch(url).then(r => r.json())

/**
 * The active account and the accent it publishes. The selected id is read from the
 * stored settings and kept live by the `synapmail:account-change` event, which the
 * switcher fires before the PATCH lands — so the accent turns over on the click, not a
 * revalidation later. Both SWR keys are the ones the bar already uses, so subscribing
 * from a second component costs no extra request.
 */
export function useAccountAccent() {
  const [activeAccountId, setActiveAccountId] = useState<string | null>(null)
  const { data: accountsData } = useSWR<{ data: EmailAccount[] }>(
    '/api/accounts', fetchJson, { revalidateOnFocus: true, refreshInterval: 60000 },
  )
  const { data: settingsData } = useSWR<{ data: { active_account_id: string | null } }>('/api/settings', fetchJson)

  useEffect(() => {
    if (settingsData?.data?.active_account_id) setActiveAccountId(settingsData.data.active_account_id)
  }, [settingsData])

  useEffect(() => {
    const handler = (e: Event) => setActiveAccountId((e as CustomEvent<string>).detail)
    window.addEventListener('synapmail:account-change', handler)
    return () => window.removeEventListener('synapmail:account-change', handler)
  }, [])

  const accounts = accountsData?.data ?? []
  const activeAccount = resolveActiveAccount(accounts, activeAccountId)
  const colorIndex = activeAccount ? accounts.indexOf(activeAccount) : 0
  /**
   * Switching mailbox, in ONE place: the event fires first (so the accent turns on the
   * click), local state follows, and the preference is written last. The sidebar and the
   * omnibar both call THIS function, never a copy.
   */
  const switchAccount = (id: string) => {
    window.dispatchEvent(new CustomEvent('synapmail:account-change', { detail: id }))
    setActiveAccountId(id)
    fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active_account_id: id }),
    })
  }
  return { accounts, activeAccount, colorIndex, vars: accentVars(activeAccount, colorIndex), switchAccount }
}

/** Above this the badge reads `99+`. Single source for every unread counter of the bar. */
const UNREAD_CAP = 99

const formatUnread = (count: number) => (count > UNREAD_CAP ? `${UNREAD_CAP}+` : String(count))

type AvatarSize = 'sm' | 'md'

/**
 * Bubble sizes: `sm` in the bar's rows (fits the fixed icon column), `md` in the popover
 * list. The type scale is set so TWO letters fit inside the circle without touching its
 * edge: at 10 px in the 28 px bubble and 11 px in the 32 px one, the widest pair this
 * palette can produce stays clear of the rim. `scripts/check-sidebar-collapse.mjs`
 * measures the rendered glyph box against the bubble, so the fit is enforced, not assumed.
 */
const SIZES: Record<AvatarSize, string> = {
  sm: 'w-7 h-7 text-[10px]',
  md: 'w-8 h-8 text-[11px]',
}

/** Letters kept in a bubble. Two, always — one letter reads as an accident, not an identity. */
const INITIAL_LEN = 2

/**
 * What separates two words in a display name or an email local part: whitespace and
 * ASCII punctuation. Written as the separators rather than as "everything that is not
 * a letter" — a Unicode property escape needs the `u` flag, unavailable at this
 * project's compile target, while an ASCII letter class would cut accented or CJK
 * names in the wrong place. Punctuation must be in here: without it `Ada (Works)` renders
 * as `A(` instead of `AW`. Shared with the folder tiles, which split folder names by
 * the same rule — one definition of "what a word is" for the whole bar.
 */
export const WORD_SPLIT = /[\s!-\/:-@[-`{-~]+/

/**
 * Two letters from ONE source string, as the single rule for the whole bar: the
 * initials of its first two words when it has two ("Ada Lovelace" → "AL",
 * "Payment Alerts" → "PA"), otherwise its own first two letters ("ada" → "AD",
 * "GLS" → "GL"). Returns an EMPTY string when the source cannot yield two characters,
 * so a caller can fall back to another source rather than render a lone letter —
 * one letter reads as an accident, not an identity.
 * Shared with the folder tiles: an account bubble and a folder tile must not spell
 * their name by two different rules.
 */
export const twoLetters = (source: string) => {
  const words = source.trim().split(WORD_SPLIT).filter(Boolean)
  if (words.length >= INITIAL_LEN) return words.slice(0, INITIAL_LEN).map(w => w[0]).join('').toUpperCase()
  const single = words[0] ?? ''
  return single.length >= INITIAL_LEN ? single.slice(0, INITIAL_LEN).toUpperCase() : ''
}

/**
 * The bubble's letters: `twoLetters` applied to the name first, then to the local
 * part of the email, so a name too short to yield two characters falls back to the
 * address instead of rendering a single letter.
 */
export const accountInitials = (account: Pick<EmailAccount, 'name' | 'email'>) => {
  for (const source of [account.name ?? '', (account.email ?? '').split('@')[0] ?? '']) {
    const letters = twoLetters(source)
    if (letters) return letters
  }
  return '??'
}

/**
 * Geometry of the badge, as one source. It hangs off the host's top-right CORNER
 * (Google style): small, and offset far enough that its box clears the initial
 * underneath it — measured on the SMALLEST bubble (28 px), where the letters' text
 * box sits closest to the corner. At `-9px` the widest label (`99+`) covers ~11 % of
 * that bubble and 0 % of the initial's own text box; the previous `-4px` / 16 px-tall
 * badge covered 37 % of the bubble and 40 % of the glyph, hiding the letter.
 */
export const BADGE_OFFSET_PX = 9

/**
 * The bar's ONE unread counter: a badge pinned on the top-right corner of whatever it
 * marks (an account bubble, a folder icon) — never a pill to the right of a label.
 * It is absolutely positioned, so it never changes its host's box, and it stays
 * visible when the bar is collapsed and the labels have folded away.
 * Ringed with `--synap-surface` — the colour of whatever surface it is pinned on,
 * published by that surface itself, so the ring follows the theme with no second palette.
 */
export function UnreadBadge({ count }: { count: number }) {
  if (count <= 0) return null
  return (
    <span
      aria-hidden
      style={{ top: -BADGE_OFFSET_PX, right: -BADGE_OFFSET_PX }}
      className={cn(
        'absolute min-w-[14px] h-[14px] px-[3px] rounded-full ring-[1.5px] ring-[color:var(--synap-surface)]',
        'text-[9px] font-semibold leading-none flex items-center justify-center tabular-nums',
        ACCENT.solid,
      )}
      data-unread-badge
    >
      {formatUnread(count)}
    </span>
  )
}

interface AccountAvatarProps extends React.HTMLAttributes<HTMLSpanElement> {
  account: Pick<EmailAccount, 'name' | 'email'> & ColorableAccount
  /** Rank of the account in the list — used only when its owner picked no colour. */
  colorIndex: number
  unread?: number
  size?: AvatarSize
}

/**
 * Round bubble carrying the account's two letters, with the unread counter pinned on its
 * top-right corner — never a pill sitting to the right of the name. The badge is
 * absolutely positioned, so it can never change the bubble's box: an icon column
 * built on it keeps the exact same geometry collapsed or expanded.
 * `--synap-surface` is the colour the badge is ringed with, so it stays readable
 * even on a bubble that shares the accent colour.
 */
export function AccountAvatar({ account, colorIndex, unread = 0, size = 'sm', ...rest }: AccountAvatarProps) {
  const bubble = accountColor(account, colorIndex)
  return (
    <span className="relative inline-flex shrink-0">
      <span
        {...rest}
        className={cn(
          'rounded-full flex items-center justify-center font-semibold select-none tracking-[0.02em]',
          SIZES[size],
        )}
        style={{ backgroundColor: bubble, color: readableInk(bubble) }}
      >
        <span data-account-initial>{accountInitials(account)}</span>
      </span>
      <UnreadBadge count={unread} />
    </span>
  )
}
