'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import useSWR from 'swr'
import { MoreHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Folder } from '@/types/email'
import { FlagPicker } from '@/components/mail/FlagPicker'
import { IconTooltip, type TooltipAlign } from '@/components/ui/IconTooltip'
import {
  MAIL_TOOLBAR_GROUPS, movableFolders, useMailSelection,
  type MailActionName, type MailToolbarItem,
} from '@/lib/mailSelection'

const fetcher = (url: string) => fetch(url).then(r => r.json())

/**
 * Les deux actions qui ne s'exécutent pas au clic : elles ouvrent un petit menu
 * ancré (les sept couleurs, la liste des dossiers). Le reste appelle son action.
 */
const MENU_ACTIONS = new Set<MailActionName>(['setFlag', 'moveTo'])

/**
 * Groupe que le header rend AVANT « Nouveau message » depuis le lot H3c (« Relever,
 * faut qu'il soit avant »). Il sort de la barre d'outils mais reste défini dans
 * `MAIL_TOOLBAR_GROUPS` : ni son icône ni son libellé ne sont recopiés. Always
 * visible in the header, it never overflows, so the « … » menu never lists it.
 */
const LEAD_GROUP = 0

/** Les groupes que la barre rend elle-même — tout sauf celui que le header a pris. */
const IN_BAR_GROUPS = MAIL_TOOLBAR_GROUPS.map((_, i) => i).filter(i => i !== LEAD_GROUP)

/**
 * Ordre dans lequel les groupes passent au menu « … » quand la place manque : le
 * DERNIER groupe part le premier. Le groupe archiver/supprimer reste visible le plus
 * longtemps — la priorité demandée au lot H3.
 */
const OVERFLOW_ORDER = [...IN_BAR_GROUPS].reverse()

/**
 * Largeur qu'il faut pour afficher les groupes visibles. Mesurée, pas devinée :
 * la barre compare la place réelle au besoin réel et replie un groupe de plus tant
 * que ça déborde. Aucun point de rupture en dur — une traduction plus longue ou une
 * police plus large replie simplement plus tôt.
 */
function useOverflowGroups(hostRef: React.RefObject<HTMLElement>, probeRef: React.RefObject<HTMLElement>) {
  const [hidden, setHidden] = useState<number[]>([])

  useEffect(() => {
    const host = hostRef.current
    const probe = probeRef.current
    if (!host || !probe) return

    const measure = () => {
      // La barre ne s'étire plus : sa propre largeur ne dit plus la place disponible.
      // Le budget est celui de la rangée qui la porte, moins le plancher que ses
      // voisins réservent (le champ de recherche) — planchers LUS sur le rendu, donc
      // toujours ceux qui sont livrés, jamais des constantes recopiées ici.
      const row = host.parentElement
      if (!row) return
      const reserved = Array.from(row.children)
        .filter(el => el !== host)
        .reduce((sum, el) => {
          const st = getComputedStyle(el)
          return sum + (parseFloat(st.minWidth) || 0) + (parseFloat(st.marginLeft) || 0) + (parseFloat(st.marginRight) || 0)
        }, 0)
      const available = row.getBoundingClientRect().width - reserved
      // La sonde rend les groupes de la barre puis, en dernier, le bouton « … » :
      // sa largeur est MESURÉE elle aussi, jamais devinée.
      const boxes = Array.from(probe.children).map(el => el.getBoundingClientRect().width)
      const moreWidth = boxes[boxes.length - 1] ?? 0
      const widths = new Map(IN_BAR_GROUPS.map((group, i) => [group, boxes[i] ?? 0]))
      const total = IN_BAR_GROUPS.reduce((sum, group) => sum + (widths.get(group) ?? 0), 0)
      if (total <= available) { setHidden(prev => (prev.length ? [] : prev)); return }
      // Le bouton « … » prend de la place TANT QU'il est affiché, donc à chaque tour.
      const budget = available - moreWidth
      const next: number[] = []
      let used = total
      for (const index of OVERFLOW_ORDER) {
        if (used <= budget) break
        used -= widths.get(index) ?? 0
        next.push(index)
      }
      setHidden(prev => (prev.length === next.length && prev.every((v, i) => v === next[i]) ? prev : next))
    }

    measure()
    const observer = new ResizeObserver(measure)
    // La rangée, PAS la barre : depuis le lot H3c la barre est `shrink-0`, sa propre
    // boîte ne change donc plus quand la fenêtre rétrécit — l'observer posé sur elle
    // ne se déclenchait plus (mesuré : 10 boutons encore affichés à 390 px après un
    // redimensionnement, alors qu'un chargement direct à 390 px en repliait 9).
    if (host.parentElement) observer.observe(host.parentElement)
    observer.observe(probe)
    return () => observer.disconnect()
  }, [hostRef, probeRef])

  return hidden
}

/** Un motif pour tous les boutons d'action — icône seule, jamais de bouton plein. */
const ACTION = 'w-8 h-8 shrink-0 flex items-center justify-center rounded-lg transition-colors ' +
  'text-foreground/70 hover:text-foreground hover:bg-foreground/[0.06] ' +
  'disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-foreground/70 disabled:cursor-default'
/** Même bouton, déplié en ligne lisible : le menu « … » nomme ses actions. */
const ACTION_ROW = 'w-full h-9 shrink-0 flex items-center gap-2 rounded-lg px-2 text-xs transition-colors ' +
  'text-foreground/80 hover:text-foreground hover:bg-foreground/[0.06] ' +
  'disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-foreground/80 disabled:cursor-default'
const ICON = 'w-[18px] h-[18px]'
const SEPARATOR = 'mx-1 h-5 w-px shrink-0 bg-border'
const MENU_BOX = 'absolute left-0 top-full z-50 mt-1 rounded-xl border border-border bg-popover p-1 shadow-xl'
const MENU_ROW = 'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-foreground/80 ' +
  'hover:bg-foreground/[0.06] hover:text-foreground transition-colors'

/**
 * Menu ancré sous un bouton, fermé par UN clic dehors qui atteint sa cible
 * (écouteur `mousedown`, jamais un voile) et par Échap, qui rend le focus.
 * Même motif que le menu du compte utilisateur.
 */
function useAnchoredMenu(open: boolean, close: () => void, triggerRef: React.RefObject<HTMLButtonElement>) {
  const boxRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) close()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      close()
      triggerRef.current?.focus()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, close, triggerRef])
  return boxRef
}

type ButtonProps = {
  item: MailToolbarItem
  openMenu: MailActionName | null
  setOpenMenu: (a: MailActionName | null) => void
  /**
   * `bar` = icône seule, le gabarit de la head bar. `row` = icône + libellé, le
   * gabarit du menu « … » : replié, un bouton doit se LIRE, pas se deviner.
   */
  variant?: 'bar' | 'row'
  /** De quel bord l'infobulle s'aligne — voir `IconTooltip`. Sans effet en variante `row`. */
  align?: TooltipAlign
}

function ToolbarButton({ item, openMenu, setOpenMenu, variant = 'bar', align = 'center' }: ButtonProps) {
  const t = useTranslations('mail')
  const { can, run, state } = useMailSelection()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const isMenu = MENU_ACTIONS.has(item.action)
  const open = isMenu && openMenu === item.action
  const boxRef = useAnchoredMenu(open, () => setOpenMenu(null), triggerRef)
  const label = t(item.labelKey)
  const enabled = can[item.action]

  const { data: foldersRes } = useSWR<{ data: Folder[] }>(
    open && item.action === 'moveTo' && state.accountId ? `/api/folders?account=${state.accountId}` : null,
    fetcher,
  )
  // Seuls les dossiers qu'au moins un groupe visé quitterait : proposer celui où
  // la cible se trouve déjà promettait un déplacement qui n'aurait pas lieu.
  const folders = movableFolders(state, foldersRes?.data ?? [])

  const isRow = variant === 'row'
  const button = (
    <button
      ref={triggerRef}
      type="button"
      disabled={!enabled}
      aria-label={label}
      {...(isMenu ? { 'aria-haspopup': 'menu' as const, 'aria-expanded': open } : {})}
      {...(isRow ? { role: 'menuitem' as const } : {})}
      onClick={() => {
        if (!isMenu) { run(item.action as Exclude<MailActionName, 'setFlag' | 'moveTo'>); return }
        setOpenMenu(open ? null : item.action)
      }}
      data-mail-action={item.action}
      className={isRow ? ACTION_ROW : ACTION}
    >
      <item.Icon className={ICON} />
      {isRow && <span className="flex-1 truncate text-left">{label}</span>}
    </button>
  )

  // Dans le menu « … » chaque action porte déjà son libellé en clair : une bulle y
  // serait une seconde étiquette pour la même chose.
  const tipped = isRow ? button : <IconTooltip label={label} shortcut={item.shortcut} align={align}>{button}</IconTooltip>

  if (!isMenu) return tipped

  return (
    <div ref={boxRef} className="relative shrink-0">
      {tipped}
      {open && item.action === 'setFlag' && (
        <div role="menu" data-mail-action-menu="setFlag" className={cn(MENU_BOX, 'w-auto')}>
          <FlagPicker onPick={flag => { run('setFlag', flag); setOpenMenu(null) }} />
        </div>
      )}
      {open && item.action === 'moveTo' && (
        <div role="menu" data-mail-action-menu="moveTo" className={cn(MENU_BOX, 'max-h-72 w-56 overflow-y-auto')}>
          {folders.map(folder => (
            <button
              key={folder.path}
              type="button"
              role="menuitem"
              data-mail-move-target={folder.path}
              onClick={() => { run('moveTo', folder.path); setOpenMenu(null) }}
              className={MENU_ROW}
            >
              <span className="flex-1 truncate text-left">{folder.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Un groupe = ses boutons, précédés d'un trait fin dès qu'il n'est pas le premier affiché. */
function ToolbarGroup({ items, first, openMenu, setOpenMenu, variant = 'bar', align }: {
  items: readonly MailToolbarItem[]
  first: boolean
} & Pick<ButtonProps, 'openMenu' | 'setOpenMenu' | 'variant' | 'align'>) {
  const isRow = variant === 'row'
  return (
    <>
      {!first && (
        <span
          data-mail-toolbar-separator
          className={isRow ? 'my-1 h-px w-full shrink-0 bg-border' : SEPARATOR}
        />
      )}
      {items.map(item => (
        <ToolbarButton key={item.action} item={item} openMenu={openMenu} setOpenMenu={setOpenMenu} variant={variant} align={align} />
      ))}
    </>
  )
}

/**
 * Lot H4b : hors du courrier, les actions n'ont pas lieu d'être — mais leur PLACE
 * reste prise. Le gabarit RÉEL est rendu, simplement invisible et hors d'atteinte,
 * donc le champ de recherche garde la même position et la même largeur d'une page
 * à l'autre. Réserver le rendu lui-même plutôt qu'une largeur recopiée : une icône
 * ajoutée demain déplace la réserve toute seule, il n'y a rien à retoucher.
 *
 * `visibility: hidden` sort déjà du parcours clavier et du clic ; `aria-hidden` le
 * dit aux lecteurs d'écran, et `data-mail-toolbar-reserved` le dit au banc de mesure
 * (qui doit pouvoir distinguer une barre vivante d'une place réservée).
 */
type ReservedProps = { shown?: boolean }

function reserved(shown: boolean) {
  return shown ? {} : { 'aria-hidden': true, 'data-mail-toolbar-reserved': '' }
}

/**
 * Le groupe de tête de `MAIL_TOOLBAR_GROUPS` (« Relever »), rendu par le header
 * entre le Tableau de bord et Nouveau message — lot H3c. Même bouton, même source :
 * ce composant ne fait que le sortir de la barre d'outils, qui l'ignore ensuite.
 */
export function MailToolbarLead({ shown = true }: ReservedProps) {
  const [openMenu, setOpenMenu] = useState<MailActionName | null>(null)
  return (
    // Une boîte TOUJOURS rendue, même hors du courrier (lot H4b) : c'est elle qui
    // tient la place, donc l'écart `gap-1` du groupe de gauche est le même sur les
    // deux pages et « Nouveau message » ne recule pas sur le tableau de bord.
    <div {...reserved(shown)} className={cn('flex shrink-0 items-center gap-1', !shown && 'invisible')}>
      <ToolbarGroup
        items={MAIL_TOOLBAR_GROUPS[LEAD_GROUP]}
        first
        openMenu={openMenu}
        setOpenMenu={setOpenMenu}
        align="start"
      />
    </div>
  )
}

/**
 * Barre d'outils du courrier, dans la head bar — « comme Mail sur Mac » : relever |
 * archiver, supprimer, indésirable | répondre, répondre à tous, transférer | drapeau,
 * non lu, déplacer. L'ordre, les icônes et les libellés viennent de
 * `MAIL_TOOLBAR_GROUPS` : ce composant ne connaît AUCUNE logique de courrier, il lit
 * une capacité et appelle une action du contexte partagé.
 *
 * Un bouton sans capacité est grisé, jamais masqué : la barre ne saute pas quand la
 * sélection change. Ce qui ne tient plus dans la largeur passe dans le menu « … ».
 */
export function MailToolbar({ shown = true }: ReservedProps) {
  const t = useTranslations('mail')
  const [openMenu, setOpenMenu] = useState<MailActionName | null>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const probeRef = useRef<HTMLDivElement>(null)
  const moreRef = useRef<HTMLButtonElement>(null)
  const [moreOpen, setMoreOpen] = useState(false)
  const moreBoxRef = useAnchoredMenu(moreOpen, () => setMoreOpen(false), moreRef)
  const hidden = useOverflowGroups(hostRef, probeRef)

  const hiddenSet = useMemo(() => new Set(hidden), [hidden])
  // Le groupe de tête est rendu par le header (MailToolbarLead) : la barre ne le
  // rend pas une seconde fois.
  const inBar = MAIL_TOOLBAR_GROUPS.map((items, i) => ({ items, i })).filter(g => g.i !== LEAD_GROUP)
  const visible = inBar.filter(g => !hiddenSet.has(g.i))
  const overflowed = inBar.filter(g => hiddenSet.has(g.i))

  return (
    // `shrink-0` depuis le lot H3c : la barre garde sa largeur naturelle pour que le
    // champ vienne se coller à sa dernière icône. Le budget de repli est donc lu sur
    // la rangée qui la contient, plus sur elle-même (voir `useOverflowGroups`).
    <div
      ref={hostRef}
      data-mail-toolbar
      {...reserved(shown)}
      className={cn('relative flex shrink-0 items-center', !shown && 'invisible')}
    >
      {/* Sonde hors écran : la largeur que TOUS les groupes demanderaient, mesurée
          sur le rendu réel. Elle ne se voit pas et ne se clique pas. */}
      <div
        ref={probeRef}
        aria-hidden
        className="pointer-events-none absolute left-0 top-0 flex items-center opacity-0"
        style={{ visibility: 'hidden' }}
      >
        {IN_BAR_GROUPS.map((group, i) => (
          <span key={group} className="flex items-center">
            {i > 0 && <span className={SEPARATOR} />}
            {MAIL_TOOLBAR_GROUPS[group].map(item => (
              <span key={item.action} className={ACTION}><item.Icon className={ICON} /></span>
            ))}
          </span>
        ))}
        <span className="flex items-center">
          <span className={SEPARATOR} />
          <span className={ACTION}><MoreHorizontal className={ICON} /></span>
        </span>
      </div>

      {visible.map((group, index) => (
        <ToolbarGroup
          key={group.i}
          items={group.items}
          first={index === 0}
          openMenu={openMenu}
          setOpenMenu={setOpenMenu}
        />
      ))}

      {overflowed.length > 0 && (
        <>
        <span data-mail-toolbar-separator className={SEPARATOR} />
        <div ref={moreBoxRef} className="relative shrink-0">
          <IconTooltip label={t('moreActions')} align="end">
            <button
              ref={moreRef}
              type="button"
              aria-label={t('moreActions')}
              aria-haspopup="menu"
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen(o => !o)}
              data-mail-toolbar-more
              className={ACTION}
            >
              <MoreHorizontal className={ICON} />
            </button>
          </IconTooltip>
          {moreOpen && (
            // Centré SOUS le bouton : ancré à gauche il sortait à droite, ancré à
            // droite il sortait à gauche de 3 px à 390 px une fois « Relever » monté
            // dans le groupe de gauche (lot H3c). Centré, ses deux bords tiennent —
            // le bouton est toujours à plus d'une demi-largeur de menu des deux bords,
            // et le gate le vérifie à 390 px (« entirely on screen »).
            <div
              role="menu"
              data-mail-toolbar-more-menu
              className={cn(MENU_BOX, 'left-1/2 flex w-48 -translate-x-1/2 flex-col items-stretch')}
            >
              {/* Only the groups that actually left the bar: a group still
                  visible inline is never listed a second time here. */}
              {overflowed.map((group, index) => (
                <ToolbarGroup
                  key={group.i}
                  items={group.items}
                  first={index === 0}
                  openMenu={openMenu}
                  setOpenMenu={setOpenMenu}
                  variant="row"
                />
              ))}
            </div>
          )}
        </div>
        </>
      )}
    </div>
  )
}
