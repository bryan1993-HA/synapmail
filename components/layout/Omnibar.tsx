'use client'

import Link from 'next/link'
import { Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Check, ChevronDown, LayoutGrid, Languages, Menu, Monitor, Moon, PenSquare, Search, Sun, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { UserMenu } from './UserMenu'
import { MailToolbar, MailToolbarLead } from './MailToolbar'
import { AccountAvatar, BADGE_OFFSET_PX, useAccountAccent } from './AccountAvatar'
import { IconTooltip } from '@/components/ui/IconTooltip'
import {
  ContextMenuSurface, ContextMenuItem, MENU_ANCHOR_GAP, MENU_ICON, MENU_MIN_WIDTH, focusMenuItem,
} from '@/components/ui/ContextMenu'
import { ADMIN_NAV, SETTINGS_NAV } from '@/components/settings/SettingsSidebar'
import { useIsAdmin } from '@/hooks/useIsAdmin'
import { useTheme } from '@/components/theme/ThemeProvider'
import { THEMES, type Theme } from '@/lib/theme'
import { LOCALES, setLocale } from '@/lib/locales'
import { OMNIBAR_SECTIONS, matchOmnibar, type OmnibarEntry, type OmnibarSection } from '@/lib/omnibarCommands'
import { MAIL_PATH, openCompose } from '@/lib/compose'
import {
  SCOPE_ACCOUNTS, SCOPE_LABEL, SCOPE_PARAM, SEARCH_DEBOUNCE_MS, SEARCH_FOCUS_EVENT,
  SEARCH_PARAM, SEARCH_SCOPES, buildSearchHref, readScope, type SearchScope,
} from '@/lib/search'

/**
 * Single source for the header's geometry. `AppShell` mounts the bar from it and
 * the gate script reads the same numbers out of this file, so the shipped height
 * and the measured height can never drift apart.
 */
export const OMNIBAR = {
  height: 44,
  /** The field is bounded: it never stretches from one edge of the window to the other. */
  searchMaxWidth: 640,
  /**
   * Floor the field never goes under. Since lot H3 the field shares the row with the
   * mail toolbar instead of being centred on the header: it takes the space left, so
   * it needs a floor rather than a reserve — below it, the toolbar folds groups into
   * its « … » menu (it measures, it does not guess a breakpoint).
   *
   * Mesuré à 390 px (gate H3 du 19/09) : à 200 px ce plancher ne laissait que 14 px
   * à la barre d'outils, dont le bouton « … » fait 32 px — il débordait sous le
   * champ. À 140 px la barre reçoit la place de son bouton, le champ reste saisissable.
   */
  searchMinWidth: 140,
  /**
   * Écart fixe entre la dernière icône de la barre d'outils et le champ (px).
   * Lot H3c : le champ ne se centre plus dans la place restante — il se colle à la
   * barre, et l'espace libre part à sa DROITE, avant la bulle du compte.
   */
  searchGap: 12,
  /**
   * Place réservée À L'INTÉRIEUR du champ, à sa droite : la puce de portée puis
   * l'indication ⌘K (lot H3g). La saisie s'arrête là, donc le texte tapé ne passe
   * jamais SOUS la puce. Deux valeurs parce que sous `sm` la puce se réduit à son
   * icône et l'indication ⌘K disparaît — la réserve suit, sinon un champ de 140 px
   * n'aurait plus de place pour écrire.
   * Mesuré le 20/09/2026 : puce (icône 14 + libellé borné 92 + chevron 12 + marges)
   * + ⌘K (26) + écarts = 168 px ; icône seule + marges = 60 px.
   */
  searchRightPad: 168,
  searchRightPadNarrow: 60,
  /** Au-delà, le libellé de la portée est coupé : la puce ne pousse pas le champ. */
  scopeLabelMaxWidth: 92,
  /**
   * Width at and above which the bar is a column of its own rather than a drawer —
   * Tailwind's default `lg`, the same breakpoint `AppShell` folds the <aside> on
   * (`hidden lg:flex`). The header's single menu button reads it to know whether a
   * click folds the bar or opens the drawer.
   */
  desktopQuery: '(min-width: 1024px)',
  /**
   * Lot H3k : le champ se centre sur l'ÉCRAN. Ces trois nombres sont ceux du rendu,
   * pas des valeurs recopiées : `ACTION` fait `w-8` (32 px) et le groupe de gauche
   * les espace de `gap-1` (4 px). Le nombre d'actions du groupe de gauche est
   * COMPTÉ (menu + tableau de bord + « Relever » + nouveau message), pas deviné.
   */
  actionSize: 32,
  actionGap: 4,
  headerActions: 4,
  /**
   * Place que la barre d'outils du courrier garde à gauche du champ, comptée en
   * boutons : un GROUPE entier (trois actions) plus le bouton « … » où le reste se
   * replie. Réserver le seul « … » (l'état du 20/09) centrait bien le champ, mais il
   * prenait alors 536 px à 1440 px et la barre se repliait ENTIÈREMENT : mesuré, zéro
   * action cliquable à 1440 et à 1728 px, alors que le lot H3 les veut vivantes.
   * Avec quatre boutons, le champ mesure 368 px à 1440 px — l'ordre de grandeur que
   * Nicolas avait lui-même calculé (« 388 px ») en cadrant H3k.
   */
  toolbarFloorActions: 4,
} as const

/**
 * Place à réserver à GAUCHE du champ pour qu'il tombe sur le centre de l'ÉCRAN,
 * SANS compter la barre latérale (elle s'ajoute en CSS, sa largeur étant animée) :
 * les actions de l'en-tête et leurs écarts, le plancher de la barre d'outils, puis
 * l'écart fixe avant le champ. Dérivé de `OMNIBAR`, donc une action ajoutée demain
 * déplace la réserve toute seule.
 */
export const OMNIBAR_ICONS_PX =
  OMNIBAR.actionSize * OMNIBAR.headerActions +
  OMNIBAR.actionGap * (OMNIBAR.headerActions - 1)

export const OMNIBAR_LEAD_PX =
  OMNIBAR_ICONS_PX + OMNIBAR.actionSize * OMNIBAR.toolbarFloorActions + OMNIBAR.searchGap

/**
 * Panneau de l'omnibar (lot H3f) : une ligne, un motif. Meme surface que le menu
 * du compte (`rounded-xl`, bordure, ombre) pour que les deux deroulants du header
 * ne soient pas deux objets differents.
 */
const PANEL_ROW = 'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors'
const PANEL_ROW_IDLE = 'text-foreground/80 hover:bg-foreground/[0.06] hover:text-foreground'
/** Ligne sous le curseur clavier : la MEME peinture qu'un survol, pour un seul vocabulaire. */
const PANEL_ROW_ACTIVE = 'bg-foreground/[0.06] text-foreground'
const PANEL_SECTION = 'px-2 pb-0.5 pt-1.5 text-[10px] uppercase tracking-wide text-muted-foreground/70'

/** Le titre de chaque section, traduit — une cle par section, pas de `if` en cascade. */
const SECTION_LABEL: Record<OmnibarSection, 'sectionAccounts' | 'sectionActions' | 'sectionSettings'> = {
  accounts: 'sectionAccounts',
  actions: 'sectionActions',
  settings: 'sectionSettings',
}

/** L'icone d'un mode de theme, meme table que le selecteur de `ThemeToggle`. */
const THEME_ICONS = { light: Sun, dark: Moon, system: Monitor } as const
/** Une portée, son libellé : la seule table qui les relie (en/fr/zh). */
function ThemeGlyph({ theme }: { theme: Theme }) {
  const Icon = THEME_ICONS[theme]
  return <Icon className={ICON} />
}

/** Prefixes des identifiants d'entree : ce que le banc designe, jamais une chaine libre. */
const ENTRY = { account: 'account', action: 'action', settings: 'settings' } as const

/** One motif for the three actions — monochrome icon, label on hover, no filled button. */
const ACTION = 'w-8 h-8 shrink-0 flex items-center justify-center rounded-lg ' +
  'text-foreground/70 hover:text-foreground hover:bg-foreground/[0.06] transition-colors'

const ICON = 'w-[18px] h-[18px]'

/** Raccourci affiché dans l'infobulle de « Nouveau message » — la touche que `useKeyboardShortcuts` écoute. */
const COMPOSE_SHORTCUT = 'C'
/** Raccourci du champ de recherche, déjà rendu dans le champ lui-même. */
const SEARCH_SHORTCUT = '⌘K'

/**
 * Application header, above the content column only — the bar owns the full height
 * and the header starts at its right edge. Menu button then transverse actions on
 * the left, global search centred. The menu button is the app's ONLY bar control:
 * it folds the bar on the desktop and opens the drawer on mobile.
 *
 * The field is the app's ONLY search input: it writes the query into the mailbox
 * URL (`/mail?q=…&scope=…`), which the message list reads back. No component
 * keeps a second copy of the query, from any page.
 */
type OmnibarProps = {
  /** Folds the bar at `lg` and above, opens the drawer below it — `AppShell` picks. */
  onMenu: () => void
  menuLabel: string
  /** Whether the thing the button controls (bar or drawer) is currently open. */
  menuExpanded: boolean
}

function OmnibarInner({ onMenu, menuLabel, menuExpanded }: OmnibarProps) {
  const t = useTranslations('mail')
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const inputRef = useRef<HTMLInputElement>(null)
  const urlQuery = searchParams.get(SEARCH_PARAM) ?? ''
  const scope = readScope(searchParams.get(SCOPE_PARAM))
  const [query, setQuery] = useState(urlQuery)
  /**
   * La portée choisie AVANT d'avoir tapé (lot H3g : on choisit la portée puis on
   * écrit). L'URL reste la SEULE source de vérité — mais elle ne porte le paramètre
   * que s'il y a une requête (`buildSearchHref`), donc à champ vide il n'y a rien à
   * relire : ce souvenir tient la place jusqu'à la première frappe, qui l'écrit.
   */
  const [pendingScope, setPendingScope] = useState<SearchScope | null>(null)
  const activeScope = pendingScope ?? scope
  const onMail = pathname === MAIL_PATH
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  // L'URL reste la source : une navigation (retour arrière, lien, changement de
  // dossier) réaligne le champ, qui n'en garde jamais une version divergente.
  useEffect(() => setQuery(urlQuery), [urlQuery])
  // Dès que l'URL porte une portée, elle redevient la seule source : le souvenir
  // s'efface. Sans cela un retour arrière laisserait la puce désigner une portée
  // que la liste n'applique plus.
  useEffect(() => setPendingScope(null), [scope])

  const submit = useCallback((next: string, nextScope: SearchScope) => {
    const href = buildSearchHref(searchParams.toString(), next, nextScope)
    // Depuis la boîte, remplacer l'entrée d'historique : la frappe ne doit pas
    // empiler une entrée par caractère. Depuis ailleurs, on y navigue vraiment.
    //
    // `router.replace` refait RENDRE la route côté serveur alors que SEULS des
    // paramètres d'URL changent : mesuré le 20/09/2026, 4,0 s entre le vrai clic
    // sur une portée et l'URL mise à jour (plus de 12 s sur une machine chargée),
    // pendant lesquelles le sélecteur paraissait mort. L'API native d'historique,
    // que le routeur suit depuis Next 14.2, met `useSearchParams` à jour au rendu
    // suivant sans aller-retour. Le CHEMIN ne change pas ici, seuls ses paramètres.
    if (pathname === MAIL_PATH) window.history.replaceState(null, '', href)
    else router.push(href)
  }, [pathname, router, searchParams])

  // Frappe → URL, débounce partagé avec l'ancien champ de la liste.
  const onQueryChange = (next: string) => {
    setQuery(next)
    // Des le PREMIER caractere le panneau se deroule ; le curseur repart a « aucun
    // choix », pour qu'Entree reste la recherche de courrier tant qu'on n'a pas
    // descendu dans la liste (comportement par defaut inchange).
    setPanelOpen(next.length > 0)
    setPanelIndex(-1)
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(() => submit(next, activeScope), SEARCH_DEBOUNCE_MS)
  }

  const clear = () => {
    if (debounce.current) clearTimeout(debounce.current)
    setQuery('')
    closePanel()
    submit('', activeScope)
  }

  useEffect(() => () => { if (debounce.current) clearTimeout(debounce.current) }, [])

  // --- Lot H3f : tout ce que l'omnibar sait proposer en plus du courrier ---
  const tOmni = useTranslations('omnibar')
  const tNav = useTranslations('settings.nav')
  const { setTheme } = useTheme()
  const { accounts, switchAccount } = useAccountAccent()
  // Lot H3h : les entrées d'administration ne sont PROPOSÉES qu'à un administrateur.
  const isAdmin = useIsAdmin()
  const [panelIndex, setPanelIndex] = useState(-1)
  const [panelOpen, setPanelOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  // --- Lot H3g : la portée est une puce DANS le champ, pas un contrôle à côté ---
  const [scopeAnchor, setScopeAnchor] = useState<{ x: number; y: number } | null>(null)
  const scopeTriggerRef = useRef<HTMLButtonElement>(null)
  const scopeListRef = useRef<HTMLDivElement>(null)
  // « Toutes les boîtes » n'a de sens qu'avec plus d'une boîte : avec une seule,
  // elle ferait doublon avec « Tous les dossiers ». Règle du lot O2, gardée.
  const offeredScopes = SEARCH_SCOPES.filter(value => value !== SCOPE_ACCOUNTS || accounts.length > 1)

  // Le menu s'aligne sur le bord DROIT de la puce, comme celui d'une ligne de
  // réglages : il ne peut donc pas déborder à droite d'un champ déjà collé au bord.
  const openScope = () => {
    const box = scopeTriggerRef.current?.getBoundingClientRect()
    if (box) setScopeAnchor({ x: box.right - MENU_MIN_WIDTH, y: box.bottom + MENU_ANCHOR_GAP })
  }
  const closeScope = () => setScopeAnchor(null)

  const pickScope = (value: SearchScope) => {
    closeScope()
    // Le focus revient au CHAMP, pas à la puce : on choisit une portée POUR écrire.
    inputRef.current?.focus()
    setPendingScope(value)
    if (!query) return
    if (debounce.current) clearTimeout(debounce.current)
    submit(query, value)
  }

  /**
   * Les entrees proposables, et ce que chacune FAIT. Une seule table : le libelle,
   * les mots-cles et l'action vivent sur la meme ligne, donc une entree ne peut pas
   * etre trouvable sans etre activable. Les reglages viennent de SETTINGS_NAV
   * (source unique partagee avec la barre des reglages), jamais d'une copie.
   */
  const commands: (OmnibarEntry & { icon: ReactNode; run: () => void })[] = [
    ...accounts.map((acc, rank) => ({
      id: `${ENTRY.account}:${acc.id}`,
      section: 'accounts' as const,
      label: acc.name || acc.email,
      hint: acc.email,
      icon: <AccountAvatar account={acc} colorIndex={rank} unread={acc.unreadCount ?? 0} />,
      run: () => { switchAccount(acc.id); if (!onMail) router.push(MAIL_PATH) },
    })),
    {
      id: `${ENTRY.action}:dashboard`,
      section: 'actions' as const,
      label: t('dashboard'),
      keywords: tOmni('dashboardKeywords'),
      icon: <LayoutGrid className={ICON} />,
      run: () => router.push('/dashboard'),
    },
    {
      id: `${ENTRY.action}:compose`,
      section: 'actions' as const,
      label: t('compose'),
      keywords: tOmni('composeKeywords'),
      icon: <PenSquare className={ICON} />,
      run: () => openCompose(pathname, router.push),
    },
    ...THEMES.map(value => {
      // `themeLight`/`themeDark`/`themeSystem` : la cle se compose a partir du nom
      // du theme, la table THEMES reste la seule liste des modes.
      const key = `theme${value.charAt(0).toUpperCase()}${value.slice(1)}`
      return {
        id: `${ENTRY.action}:theme-${value}`,
        section: 'actions' as const,
        label: tOmni(key as 'themeLight'),
        // Chaque mode porte SES mots-cles : une liste partagee ferait correspondre
        // « sombre » aux trois, et le clavier designerait le premier declare.
        keywords: tOmni(`${key}Keywords` as 'themeLightKeywords'),
        icon: <ThemeGlyph theme={value} />,
        run: () => setTheme(value),
      }
    }),
    ...LOCALES.map(({ code, label }) => ({
      id: `${ENTRY.action}:language-${code}`,
      section: 'actions' as const,
      label: tOmni('languageAction', { name: label }),
      keywords: tOmni('languageKeywords'),
      icon: <Languages className={ICON} />,
      run: () => { void setLocale(code) },
    })),
    ...SETTINGS_NAV.map(({ href, key, icon: Icon }) => ({
      id: `${ENTRY.settings}:${key}`,
      section: 'settings' as const,
      label: tNav(key),
      hint: href,
      keywords: tOmni(`keywords.${key}` as 'keywords.profile'),
      icon: <Icon className={ICON} />,
      run: () => router.push(href),
    })),
    // Lot H3h : mêmes lignes, même source unique (`ADMIN_NAV`, partagée avec la
    // navigation des réglages), pour un administrateur SEULEMENT. « Nom et icône de
    // l'onglet » mène à l'ancre de sa section, pas en haut d'une page qui ne la nomme pas.
    ...(isAdmin ? ADMIN_NAV : []).map(({ href, key, icon: Icon }) => ({
      id: `${ENTRY.settings}:${key}`,
      section: 'settings' as const,
      label: tNav(key),
      hint: href,
      keywords: tOmni(`keywords.${key}` as 'keywords.profile'),
      icon: <Icon className={ICON} />,
      run: () => router.push(href),
    })),
  ]

  const matches = panelOpen ? matchOmnibar(query, commands) : []
  const suggestions = matches.map(m => commands.find(c => c.id === m.id)!)
  // Le panneau n'existe que s'il propose quelque chose : sans entree, la ligne de
  // repli seule ne vaut pas une surface qui recouvre le contenu.
  const showPanel = panelOpen && suggestions.length > 0
  const closePanel = useCallback(() => { setPanelOpen(false); setPanelIndex(-1) }, [])

  // Clic dehors : simple ecoute `mousedown`, pas de voile — le clic qui ferme
  // atteint aussi sa cible (meme regle que le menu du compte).
  useEffect(() => {
    if (!showPanel) return
    const onDown = (e: MouseEvent) => {
      if (!panelRef.current?.contains(e.target as Node)) closePanel()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [showPanel, closePanel])

  const runSuggestion = (index: number) => {
    const picked = suggestions[index]
    if (!picked) return
    closePanel()
    setQuery('')
    inputRef.current?.blur()
    picked.run()
  }

  // The app-wide shortcut hook bails out on any modifier (hooks/useKeyboardShortcuts.ts),
  // so the field owns its own listener. Works from anywhere, including from another field.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.key.toLowerCase() !== 'k') return
      e.preventDefault()
      inputRef.current?.focus()
      inputRef.current?.select()
    }
    const onFocusRequest = () => { inputRef.current?.focus(); inputRef.current?.select() }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener(SEARCH_FOCUS_EVENT, onFocusRequest)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener(SEARCH_FOCUS_EVENT, onFocusRequest)
    }
  }, [])

  return (
    <header
      data-omnibar
      className="relative shrink-0 flex items-center border-b border-border bg-background px-2 sm:px-3
        lg:grid lg:items-center"
      style={{
        height: OMNIBAR.height,
        /* Lot H3k — le champ se centre sur l'ÉCRAN, en CSS seul (aucune mesure
           JavaScript au redimensionnement).
           À partir de `lg` l'en-tête devient une grille de quatre pistes :
             [ressort gauche 1fr] [champ] [ressort droit 1fr] [rattrapage barre]
           Les deux ressorts portent le même `1fr` : ils finissent donc à la MÊME
           largeur, ce qui centre le champ dans ce qui reste une fois la dernière
           piste retirée. Cette dernière piste vaut exactement la largeur de la barre
           latérale — or l'en-tête commence à son bord droit, donc la retirer à
           DROITE remet le centre du champ sur le centre de l'ÉCRAN, barre dépliée
           comme repliée (sa largeur est publiée par `AppShell` en `--synap-bar-w`,
           depuis la même source `SIDEBAR` qui l'anime).
           RÉTRÉCISSEMENT : la piste du champ est bornée `minmax(searchMinWidth,
           searchMaxWidth)`. Tant que les ressorts ont la place, le champ garde 640 px
           et reste centré ; quand elle manque, le plancher du ressort gauche
           (`--synap-omnibar-lead` : les icônes, le plancher de la barre d'outils et
           l'écart) l'emporte et le champ rétrécit — puis, tout en bas, se retrouve
           simplement collé aux icônes, le repli demandé. */
        ['--synap-omnibar-lead' as string]: `${OMNIBAR_LEAD_PX}px`,
        ['--synap-search-gap' as string]: `${OMNIBAR.searchGap}px`,
        gridTemplateColumns:
          `minmax(var(--synap-omnibar-lead), 1fr)` +
          ` minmax(${OMNIBAR.searchMinWidth}px, ${OMNIBAR.searchMaxWidth}px)` +
          ` minmax(var(--synap-omnibar-lead), 1fr) var(--synap-bar-w, 0px)`,
      }}
    >
      {/* gap-1 : deux boîtes cliquables voisines gardent 4 px d'écart, le plancher
          que le gate mesure — rien ne se touche ni ne se recouvre, même à 390 px. */}
      <div className="flex shrink-0 items-center gap-1 lg:[grid-area:1/1] lg:justify-self-start">
        <IconTooltip label={menuLabel} align="start">
          <button
            type="button"
            onClick={onMenu}
            aria-label={menuLabel}
            aria-expanded={menuExpanded}
            data-omnibar-menu
            className={ACTION}
          >
            <Menu className={ICON} />
          </button>
        </IconTooltip>
        <IconTooltip label={t('dashboard')} align="start">
          <Link href="/dashboard" aria-label={t('dashboard')} data-omnibar-action="dashboard" className={ACTION}>
            <LayoutGrid className={ICON} />
          </Link>
        </IconTooltip>
        {/* Lot H3c : « Relever » passe AVANT « Nouveau message » (demande de Nicolas).
            Sa définition reste celle de MAIL_TOOLBAR_GROUPS — seul l'endroit où le
            header la rend change ; toujours visible, elle ne passe jamais dans le menu « … ». */}
        <MailToolbarLead shown={onMail} />
        <IconTooltip label={t('compose')} shortcut={COMPOSE_SHORTCUT}>
          <button
            type="button"
            onClick={() => openCompose(pathname, router.push)}
            aria-label={t('compose')}
            data-omnibar-action="compose"
            className={ACTION}
          >
            <PenSquare className={ICON} />
          </button>
        </IconTooltip>
      </div>

      {/* Lot H3c : barre d'outils et champ partagent UNE rangée qui porte le `flex-1`.
          La barre y garde sa largeur naturelle (`shrink-0`) et le champ prend ce qui
          reste, borné : le champ se colle donc à la dernière icône, et la place en
          trop tombe APRÈS lui — plus jamais entre la barre et le champ. */}
      {/* Sous `lg` : la rangée d'avant (barre d'outils + champ collé, `flex-1`).
          À partir de `lg` : le conteneur se dissout dans la grille (`display: contents`),
          la barre d'outils se pose dans la piste des icônes, à leur suite, et le champ
          occupe la piste du MILIEU — celle que les deux pistes `1fr` centrent. */}
      <div className="flex min-w-0 flex-1 items-center lg:contents">
        {/* Lot H4b : hors de la boîte la barre n'agit plus, mais sa PLACE reste
            prise — sinon le champ remontait de 342 px vers la gauche et gagnait
            80 px sur le tableau de bord (mesuré en prod à 1440 px).
            Lot H3k : dans la grille elle se pose sur la piste des icônes, décalée de
            leur largeur — même suite visuelle qu'avant, mais elle ne pousse plus le
            champ, donc le centrage ne dépend pas de ce qu'elle affiche. */}
        <div
          className="flex min-w-0 shrink items-center lg:[grid-area:1/1] lg:w-full"
          style={{ ['--synap-omnibar-icons' as string]: `${OMNIBAR_ICONS_PX}px` }}
        >
          {/* Place des icônes, qui sont posées PAR-DESSUS cette même piste : la barre
              d'outils vient donc à leur suite. `minWidth` et non `width`, parce que
              `useOverflowGroups` lit les planchers de ses voisins pour connaître son
              budget — une largeur qu'il ne verrait pas le ferait déborder. */}
          <span
            aria-hidden
            className="hidden lg:block shrink-0"
            style={{ width: 'var(--synap-omnibar-icons)', minWidth: 'var(--synap-omnibar-icons)' }}
          />
          <MailToolbar shown={onMail} />
        </div>

      <div
        ref={panelRef}
        data-omnibar-search-field
        className="relative flex min-w-0 flex-1 items-center
          sm:[--synap-search-pad:var(--synap-search-pad-wide)]
          lg:[grid-area:1/2] lg:w-full lg:[--synap-search-gap:0px]"
        style={{
          maxWidth: OMNIBAR.searchMaxWidth,
          minWidth: OMNIBAR.searchMinWidth,
          // Sous `lg` le champ se colle à la dernière icône (l'écart de H3c) ; dans
          // la grille, c'est la piste qui place le champ, l'écart y vaut donc 0.
          // La remise à zéro est déclarée SUR CE MÊME élément (`lg:` ci-dessus) :
          // l'en-tête publie la valeur, le champ la redéclare pour lui-même et sa
          // propre déclaration bat celle dont il hérite. Posée sur l'en-tête, elle
          // perdait contre le style en ligne qui y écrit la variable.
          marginLeft: 'var(--synap-search-gap)',
          // Réserve intérieure droite : la puce de portée et l'indication ⌘K se
          // posent dessus, la saisie s'arrête avant. Une variable, deux lecteurs
          // (le champ et la classe `sm:` ci-dessous) — jamais deux valeurs écrites.
          ['--synap-search-pad' as string]: `${OMNIBAR.searchRightPadNarrow}px`,
          ['--synap-search-pad-wide' as string]: `${OMNIBAR.searchRightPad}px`,
        }}
      >
        <Search className="absolute left-2.5 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={e => onQueryChange(e.target.value)}
          onKeyDown={e => {
            if (showPanel && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
              e.preventDefault()
              const step = e.key === 'ArrowDown' ? 1 : -1
              // -1 = « aucun choix » : la liste boucle en repassant par cet etat,
              // donc on peut toujours revenir a la recherche de courrier.
              setPanelIndex(i => {
                const next = i + step
                if (next >= suggestions.length) return -1
                if (next < -1) return suggestions.length - 1
                return next
              })
              return
            }
            if (e.key === 'Enter') {
              if (debounce.current) clearTimeout(debounce.current)
              // Une entree choisie l'emporte ; sans choix, Entree cherche dans le
              // courrier exactement comme avant le lot H3f.
              if (showPanel && panelIndex >= 0) { e.preventDefault(); runSuggestion(panelIndex); return }
              closePanel()
              submit(e.currentTarget.value, activeScope)
              return
            }
            if (e.key !== 'Escape') return
            // Echap ferme d'abord le panneau, et seulement ensuite vide le champ.
            if (showPanel) { e.preventDefault(); closePanel(); return }
            clear()
            e.currentTarget.blur()
          }}
          placeholder={t('searchMail')}
          aria-label={t('searchMail')}
          data-omnibar-search
          style={{ paddingRight: `var(--synap-search-pad)` }}
          className="w-full h-8 pl-8 text-xs rounded-lg border border-border bg-muted/50
            placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
        {/* Rail droit DANS le champ (lot H3g) : la puce de portée, puis l'effacement
            ou l'indication ⌘K. Une seule rangée, donc rien ne peut se recouvrir —
            et la réserve `--synap-search-pad` tient exactement sa largeur. */}
        <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1.5">
          <IconTooltip label={t(SCOPE_LABEL[activeScope])} align="end">
            <button
              ref={scopeTriggerRef}
              type="button"
              data-omnibar-scope-trigger
              aria-haspopup="menu"
              aria-expanded={scopeAnchor !== null}
              aria-label={t(SCOPE_LABEL[activeScope])}
              onClick={() => (scopeAnchor ? closeScope() : openScope())}
              onKeyDown={e => {
                if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
                e.preventDefault()
                if (!scopeAnchor) openScope()
                requestAnimationFrame(() => focusMenuItem(scopeListRef.current, e.key === 'ArrowDown' ? 1 : -1))
              }}
              className="flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-[11px] text-muted-foreground
                transition-colors hover:bg-foreground/[0.06] hover:text-foreground
                focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <Search className="h-3 w-3 shrink-0" />
              {/* Sous `sm` la puce se réduit à son icône : l'infobulle dit la portée. */}
              <span
                className="hidden truncate sm:block"
                style={{ maxWidth: OMNIBAR.scopeLabelMaxWidth }}
              >
                {t(SCOPE_LABEL[activeScope])}
              </span>
              <ChevronDown className="h-3 w-3 shrink-0" />
            </button>
          </IconTooltip>
          {query ? (
            <IconTooltip label={t('clearSearch')} align="end">
              <button
                type="button"
                onClick={clear}
                aria-label={t('clearSearch')}
                data-omnibar-search-clear
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </IconTooltip>
          ) : (
            <kbd className="hidden text-[10px] text-muted-foreground pointer-events-none sm:block">
              {SEARCH_SHORTCUT}
            </kbd>
          )}
        </div>

        {scopeAnchor && (
          <ContextMenuSurface
            anchor={scopeAnchor}
            onClose={closeScope}
            ignoreRef={scopeTriggerRef}
            role="menu"
            data-omnibar-scope-menu
          >
            <div
              ref={scopeListRef}
              onKeyDown={e => {
                if (e.key === 'Escape') {
                  // Échap rend le focus au CHAMP, pas à la puce : on revient écrire.
                  closeScope()
                  inputRef.current?.focus()
                  return
                }
                if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
                e.preventDefault()
                focusMenuItem(scopeListRef.current, e.key === 'ArrowDown' ? 1 : -1)
              }}
            >
              {offeredScopes.map(value => (
                <ContextMenuItem
                  key={value}
                  itemKey={value}
                  data-omnibar-scope={value}
                  aria-checked={activeScope === value}
                  enabled
                  icon={activeScope === value
                    ? <Check className={MENU_ICON} />
                    : <span className={MENU_ICON} aria-hidden />}
                  label={t(SCOPE_LABEL[value])}
                  onClick={() => pickScope(value)}
                  onClose={closeScope}
                />
              ))}
            </div>
          </ContextMenuSurface>
        )}

        {/* Lot H3f : le panneau se deroule SOUS le champ, a sa largeur exacte
            (`inset-x-0`), au-dessus du contenu. Il se ferme sans voile, donc le clic
            qui le ferme atteint aussi ce qu'il visait.
            Lot H4c-bis : il publie SA surface (`--synap-surface`), dont le compteur
            epingle sur une bulle de boite tire son cercle, et il reserve en haut et en
            bas de quoi laisser DEPASSER ce compteur — il defile, donc sans cette reserve
            le compteur de la premiere et de la derniere ligne serait rogne. Meme reserve
            que la barre laterale (`BADGE_OFFSET_PX`, une seule source). */}
        {showPanel && (
          <div
            role="listbox"
            data-omnibar-panel
            className="absolute inset-x-0 top-full z-50 mt-1 max-h-[70vh] overflow-y-auto
              rounded-xl border border-border bg-popover px-1 shadow-xl"
            style={{
              ['--synap-surface' as string]: 'var(--popover)',
              paddingTop: `${BADGE_OFFSET_PX}px`,
              paddingBottom: `${BADGE_OFFSET_PX}px`,
            }}
          >
            {OMNIBAR_SECTIONS.map(section => {
              const rows = suggestions.filter(entry => entry.section === section)
              if (!rows.length) return null
              return (
                <div key={section} data-omnibar-section={section}>
                  <div className={PANEL_SECTION}>{tOmni(SECTION_LABEL[section])}</div>
                  {rows.map(entry => {
                    const index = suggestions.indexOf(entry)
                    return (
                      <button
                        key={entry.id}
                        type="button"
                        role="option"
                        aria-selected={index === panelIndex}
                        data-omnibar-entry={entry.id}
                        onMouseEnter={() => setPanelIndex(index)}
                        onClick={() => runSuggestion(index)}
                        className={cn(PANEL_ROW, index === panelIndex ? PANEL_ROW_ACTIVE : PANEL_ROW_IDLE)}
                      >
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center">{entry.icon}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">{entry.label}</span>
                          {entry.hint && (
                            <span className="block truncate text-[10px] text-muted-foreground">{entry.hint}</span>
                          )}
                        </span>
                      </button>
                    )
                  })}
                </div>
              )
            })}
            {/* Ligne de repli, toujours derniere : l'action par defaut du champ. */}
            <div className="mt-1 border-t border-border pt-1">
              <button
                type="button"
                role="option"
                aria-selected={panelIndex === -1}
                data-omnibar-entry="search"
                onClick={() => {
                  if (debounce.current) clearTimeout(debounce.current)
                  closePanel()
                  submit(query, activeScope)
                }}
                className={cn(PANEL_ROW, panelIndex === -1 ? PANEL_ROW_ACTIVE : PANEL_ROW_IDLE)}
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center">
                  <Search className={ICON} />
                </span>
                <span className="min-w-0 flex-1 truncate">{tOmni('searchMailFor', { query })}</span>
              </button>
            </div>
          </div>
        )}
      </div>
      </div>

      {/* Right-hand group: the signed-in user. Depuis le lot H3g la portée n'est plus
          ici — elle est une puce DANS le champ, où l'on choisit AVANT de taper. */}
      {/* `ml-auto` depuis le lot H3c : le champ ne porte plus de marges automatiques,
          c'est donc CE groupe qui absorbe l'espace libre et reste collé au bord droit. */}
      <div
        data-omnibar-right
        className="ml-auto flex shrink-0 items-center gap-2 pl-2 lg:[grid-area:1/3/1/5] lg:justify-self-end"
      >
        <UserMenu />
      </div>
    </header>
  )
}

/**
 * `useSearchParams` impose une frontière Suspense (convention du dépôt) : la
 * barre est rendue derrière un repli de la bonne hauteur, jamais de saut.
 */
export function Omnibar(props: OmnibarProps) {
  return (
    <Suspense fallback={<div className="shrink-0 border-b border-border bg-background" style={{ height: OMNIBAR.height }} />}>
      <OmnibarInner {...props} />
    </Suspense>
  )
}
