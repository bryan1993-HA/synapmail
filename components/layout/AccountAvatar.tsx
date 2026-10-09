'use client'

import { useEffect, useState } from 'react'
import useSWR from 'swr'
import { cn } from '@/lib/utils'
import { accountColor, readableInk } from '@/lib/accountColor'
import type { ColorableAccount } from '@/lib/accountColor'
import type { EmailAccount } from '@/types/account'
import { ACCOUNTS_KEY } from '@/lib/unreadSignal'
import { SETTINGS_KEY, saveSettings } from '@/lib/settings'

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
    ACCOUNTS_KEY, fetchJson, { revalidateOnFocus: true, refreshInterval: 60000 },
  )
  const { data: settingsData } = useSWR<{ data: { active_account_id: string | null } }>(SETTINGS_KEY, fetchJson)

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
   * Switch mailbox, in ONE place: the event goes out first (the accent turns on the
   * click), the local state follows, the preference is written through
   * `saveSettings` — so the shared cache turns over with it and a focus
   * revalidation racing the write cannot put the old mailbox back. The sidebar and
   * the omnibar (lot H3f) call THIS function, never a copy.
   */
  const switchAccount = (id: string) => {
    window.dispatchEvent(new CustomEvent('synapmail:account-change', { detail: id }))
    setActiveAccountId(id)
    void saveSettings({ active_account_id: id })
  }
  return { accounts, activeAccount, colorIndex, vars: accentVars(activeAccount, colorIndex), switchAccount }
}

/** Above this the badge reads `99+`. Single source for every unread counter of the bar. */
const UNREAD_CAP = 99

const formatUnread = (count: number) => (count > UNREAD_CAP ? `${UNREAD_CAP}+` : String(count))

type AvatarSize = 'xs' | 'sm' | 'md'

/**
 * Bubble sizes: `xs` inline in a line of running text (the dashboard's mail rows, where a
 * bar-sized bubble would set the line's height), `sm` in the bar's rows (fits the fixed
 * icon column), `md` in the popover list. The type scale is set so TWO letters fit inside
 * the circle without touching its edge: at 10 px in the 28 px bubble and 11 px in the
 * 32 px one, the widest pair this palette can produce stays clear of the rim, and the
 * 20 px bubble keeps the same headroom by shrinking its type further (8 px).
 * `scripts/check-sidebar-collapse.mjs` measures the rendered glyph box against the
 * bubble, so the fit is enforced, not assumed.
 */
/**
 * La BOÎTE de la bulle, séparée de sa graisse de texte : un habillage qui doit
 * couvrir exactement la bulle (la case à cocher de `SelectableBubble`) lit cette
 * carte plutôt que de recopier `w-5 h-5`, sinon les deux tailles divergent au
 * premier changement. Les classes restent littérales : Tailwind lit le texte
 * source, une classe composée par interpolation ne serait jamais émise.
 */
export const BUBBLE_BOX: Record<AvatarSize, string> = {
  xs: 'w-5 h-5',
  sm: 'w-7 h-7',
  md: 'w-8 h-8',
}

const SIZES: Record<AvatarSize, string> = {
  xs: `${BUBBLE_BOX.xs} text-[8px]`,
  sm: `${BUBBLE_BOX.sm} text-[10px]`,
  md: `${BUBBLE_BOX.md} text-[11px]`,
}

/** Letters kept in a bubble. Two, always — one letter reads as an accident, not an identity. */
const INITIAL_LEN = 2

/**
 * What separates two words in a display name or an email local part: whitespace and
 * ASCII punctuation. Written as the separators rather than as "everything that is not
 * a letter" — a Unicode property escape needs the `u` flag, unavailable at this
 * project's compile target, while an ASCII letter class would cut "Élodie" or "王小明"
 * in the wrong place. Punctuation must be in here: without it `Nicolas (Yumi)` renders
 * as `N(` instead of `NY`. Shared with the folder tiles, which split folder names by
 * the same rule — one definition of "what a word is" for the whole bar.
 */
export const WORD_SPLIT = /[\s!-\/:-@[-`{-~]+/

/**
 * Two letters from ONE source string, as the single rule for the whole bar: the
 * initials of its first two words when it has two ("Nicolas Michaut" → "NM",
 * "Controles EDOF" → "CE"), otherwise its own first two letters ("mathilde" → "MA",
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
 *
 * `colour` is the colour of the BOX the count belongs to, read from the same source as
 * the bubble it is pinned on (`accountColor`). Without it the badge falls back to the
 * bar's accent — which is the colour of the ACTIVE account, correct for a folder of
 * that account, and wrong for anything else: on the list of mailboxes it painted all
 * eight counters violet over green, blue and amber bubbles. A counter names the box it
 * counts, so it takes the colour of that box and not of whichever box is open.
 */
export function UnreadBadge({ count, colour }: { count: number; colour?: string }) {
  if (count <= 0) return null
  return (
    <span
      aria-hidden
      style={colour
        ? { top: -BADGE_OFFSET_PX, right: -BADGE_OFFSET_PX, backgroundColor: colour, color: readableInk(colour) }
        : { top: -BADGE_OFFSET_PX, right: -BADGE_OFFSET_PX }}
      className={cn(
        'absolute min-w-[14px] h-[14px] px-[3px] rounded-full ring-[1.5px] ring-[color:var(--synap-surface)]',
        'text-[9px] font-semibold leading-none flex items-center justify-center tabular-nums',
        !colour && ACCENT.solid,
      )}
      // Le compteur DIT a quel titre il est peint : `account` quand il porte la couleur
      // de sa boite (donc volontairement hors de l'accent de la barre), `folder` quand il
      // suit l'accent du compte actif, ce qui est correct pour un dossier de CE compte.
      // Sans cette distinction, le banc d'unite d'accent de la barre
      // (`check-sidebar-collapse.mjs`) devrait exclure TOUS les compteurs, et ne verrait
      // plus un compteur de dossier qui partirait dans une seconde famille de teintes.
      data-unread-badge={colour ? 'account' : 'folder'}
    >
      {formatUnread(count)}
    </span>
  )
}

interface AccountAvatarProps extends React.HTMLAttributes<HTMLSpanElement> {
  account: Pick<EmailAccount, 'name' | 'email'> & ColorableAccount & { id?: string }
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
        // La bulle publie QUELLE boîte elle peint, sur TOUS les écrans : c'est ce qui
        // permet de comparer la couleur RENDUE d'une même boîte d'un écran à l'autre
        // (banc `scripts/check-account-badge-parity.mjs`). Portée ici plutôt que par chaque
        // appelant : posée écran par écran, elle manquait justement là où les rangs
        // divergeaient (tableau de bord), et l'écart ne se voyait plus qu'à l'œil.
        data-account-badge={account.id}
        // La bulle dit aussi a QUELLE taille elle est posee. C'est un fait, pas une
        // interpretation, et c'est ce qui permet au banc de distinguer une bulle de
        // LISTE (`sm`/`md` : une ligne de boite, qui doit porter son compteur) d'une
        // marque INLINE dans du texte courant (`xs` : elle dit de quelle boite vient
        // un message, un compteur de non-lus n'y voudrait rien dire).
        data-account-badge-size={size}
        className={cn(
          'rounded-full flex items-center justify-center font-semibold select-none tracking-[0.02em]',
          SIZES[size],
        )}
        style={{ backgroundColor: bubble, color: readableInk(bubble) }}
      >
        <span data-account-initial>{accountInitials(account)}</span>
      </span>
      <UnreadBadge count={unread} colour={bubble} />
    </span>
  )
}
