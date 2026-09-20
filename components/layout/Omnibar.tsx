'use client'

import Link from 'next/link'
import { Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { LayoutGrid, Languages, Menu, Monitor, Moon, PenSquare, Search, Sun, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { UserMenu } from './UserMenu'
import { MailToolbar, MailToolbarLead } from './MailToolbar'
import { AccountAvatar, useAccountAccent } from './AccountAvatar'
import { IconTooltip } from '@/components/ui/IconTooltip'
import { SETTINGS_NAV } from '@/components/settings/SettingsSidebar'
import { useTheme } from '@/components/theme/ThemeProvider'
import { THEMES, type Theme } from '@/lib/theme'
import { LOCALES, setLocale } from '@/lib/locales'
import { OMNIBAR_SECTIONS, matchOmnibar, type OmnibarEntry, type OmnibarSection } from '@/lib/omnibarCommands'
import { MAIL_PATH, openCompose } from '@/lib/compose'
import {
  SCOPE_ALL, SCOPE_FOLDER, SCOPE_PARAM, SEARCH_DEBOUNCE_MS, SEARCH_FOCUS_EVENT, SEARCH_PARAM,
  buildSearchHref, readScope, type SearchScope,
} from '@/lib/search'

/**
 * Single source for the header's geometry. `AppShell` mounts the bar from it and
 * the check script reads the same numbers out of this file, so the shipped height
 * and the measured height can never drift apart.
 */
export const OMNIBAR = {
  height: 44,
  /** The field is bounded: it never stretches from one edge of the window to the other. */
  searchMaxWidth: 640,
  /**
   * Floor the field never goes under. The field shares the row with the mail toolbar
   * instead of being centred on the header: it takes the space left, so it needs a
   * floor rather than a reserve — below it, the toolbar folds groups into its "..."
   * menu (it measures, it does not guess a breakpoint).
   *
   * Measured at 390 px: at 200 px this floor left only 14 px to the toolbar, whose
   * "..." button is 32 px wide — it overflowed under the field. At 140 px the toolbar
   * gets the room for its button and the field stays usable for typing.
   */
  searchMinWidth: 140,
  /**
   * Fixed gap between the toolbar's last icon and the field (px).
   * The field is not centred in the space left over: it sits flush against the
   * toolbar, and the free space goes to its RIGHT, before the account bubble.
   */
  searchGap: 12,
  /**
   * Width at and above which the bar is a column of its own rather than a drawer —
   * Tailwind's default `lg`, the same breakpoint `AppShell` folds the <aside> on
   * (`hidden lg:flex`). The header's single menu button reads it to know whether a
   * click folds the bar or opens the drawer.
   */
  desktopQuery: '(min-width: 1024px)',
} as const

/**
 * Omnibar panel: one row, one motif. Same surface as the account menu
 * (`rounded-xl`, border, shadow) so the header's two dropdowns do not read as two
 * different objects.
 */
const PANEL_ROW = 'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors'
const PANEL_ROW_IDLE = 'text-foreground/80 hover:bg-foreground/[0.06] hover:text-foreground'
/** Row under the keyboard cursor: the SAME paint as a hover, for a single vocabulary. */
const PANEL_ROW_ACTIVE = 'bg-foreground/[0.06] text-foreground'
const PANEL_SECTION = 'px-2 pb-0.5 pt-1.5 text-[10px] uppercase tracking-wide text-muted-foreground/70'

/** Each section's heading, translated — one key per section, no cascade of `if`s. */
const SECTION_LABEL: Record<OmnibarSection, 'sectionAccounts' | 'sectionActions' | 'sectionSettings'> = {
  accounts: 'sectionAccounts',
  actions: 'sectionActions',
  settings: 'sectionSettings',
}

/** The icon for a theme mode, same table as the `ThemeToggle` selector. */
const THEME_ICONS = { light: Sun, dark: Moon, system: Monitor } as const
function ThemeGlyph({ theme }: { theme: Theme }) {
  const Icon = THEME_ICONS[theme]
  return <Icon className={ICON} />
}

/** Entry id prefixes: what tests target, never a free-form string. */
const ENTRY = { account: 'account', action: 'action', settings: 'settings' } as const

/** One motif for the three actions — monochrome icon, label on hover, no filled button. */
const ACTION = 'w-8 h-8 shrink-0 flex items-center justify-center rounded-lg ' +
  'text-foreground/70 hover:text-foreground hover:bg-foreground/[0.06] transition-colors'

const ICON = 'w-[18px] h-[18px]'

/** Shortcut shown in the compose tooltip — the key `useKeyboardShortcuts` listens for. */
const COMPOSE_SHORTCUT = 'C'
/** Search field shortcut, already rendered inside the field itself. */
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
  const onMail = pathname === MAIL_PATH
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  // The URL stays the source: any navigation (back, link, folder change) realigns the
  // field, which never keeps a diverging copy of the query.
  useEffect(() => setQuery(urlQuery), [urlQuery])

  const submit = useCallback((next: string, nextScope: SearchScope) => {
    const href = buildSearchHref(searchParams.toString(), next, nextScope)
    // From the mailbox, replace the history entry: typing must not stack one entry per
    // character. From anywhere else, actually navigate to it.
    if (pathname === MAIL_PATH) router.replace(href)
    else router.push(href)
  }, [pathname, router, searchParams])

  // Keystroke → URL, on the same debounce the list's former field used.
  const onQueryChange = (next: string) => {
    setQuery(next)
    // The panel opens on the FIRST character; the cursor resets to "no selection", so
    // Enter keeps meaning "search mail" until the user has stepped down into the list
    // (default behaviour unchanged).
    setPanelOpen(next.length > 0)
    setPanelIndex(-1)
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(() => submit(next, scope), SEARCH_DEBOUNCE_MS)
  }

  const clear = () => {
    if (debounce.current) clearTimeout(debounce.current)
    setQuery('')
    closePanel()
    submit('', scope)
  }

  useEffect(() => () => { if (debounce.current) clearTimeout(debounce.current) }, [])

  // --- Everything the omnibar can offer beyond mail ---
  const tOmni = useTranslations('omnibar')
  const tNav = useTranslations('settings.nav')
  const { setTheme } = useTheme()
  const { accounts, switchAccount } = useAccountAccent()
  const [panelIndex, setPanelIndex] = useState(-1)
  const [panelOpen, setPanelOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  /**
   * The suggestable entries, and what each one DOES. A single table: the label, the
   * keywords and the action live on the same row, so an entry cannot be findable
   * without being runnable. Settings entries come from SETTINGS_NAV (the single source
   * shared with the settings sidebar), never from a copy.
   */
  const commands: (OmnibarEntry & { icon: ReactNode; run: () => void })[] = [
    ...accounts.map((acc, rank) => ({
      id: `${ENTRY.account}:${acc.id}`,
      section: 'accounts' as const,
      label: acc.name || acc.email,
      hint: acc.email,
      icon: <AccountAvatar account={acc} colorIndex={rank} unread={0} />,
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
      // `themeLight`/`themeDark`/`themeSystem`: the key is built from the theme name, so
      // the THEMES table stays the only list of modes.
      const key = `theme${value.charAt(0).toUpperCase()}${value.slice(1)}`
      return {
        id: `${ENTRY.action}:theme-${value}`,
        section: 'actions' as const,
        label: tOmni(key as 'themeLight'),
        // Each mode carries ITS OWN keywords: a shared list would match "dark" against all
        // three, and the keyboard would land on whichever was declared first.
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
  ]

  const matches = panelOpen ? matchOmnibar(query, commands) : []
  const suggestions = matches.map(m => commands.find(c => c.id === m.id)!)
  // The panel only exists when it has something to offer: with no entry, the fallback
  // row alone does not justify a surface covering the content.
  const showPanel = panelOpen && suggestions.length > 0
  const closePanel = useCallback(() => { setPanelOpen(false); setPanelIndex(-1) }, [])

  // Outside click: a plain `mousedown` listener, no overlay — the click that closes the
  // panel also reaches its target (same rule as the account menu).
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
      className="relative shrink-0 flex items-center border-b border-border bg-background px-2 sm:px-3"
      style={{ height: OMNIBAR.height }}
    >
      {/* gap-1: two neighbouring hit boxes keep 4 px apart, the measured floor — nothing
          touches or overlaps, even at 390 px. */}
      <div className="flex shrink-0 items-center gap-1">
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
        {/* Refresh comes BEFORE compose. Its definition stays the one in
            MAIL_TOOLBAR_GROUPS — only where the header renders it changes; the "..."
            menu keeps it first. */}
        {onMail && <MailToolbarLead />}
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

      {/* Toolbar and field share ONE row, which carries the `flex-1`.
          The toolbar keeps its natural width there (`shrink-0`) and the field takes what
          is left, bounded: the field therefore sits flush against the last icon, and the
          spare room falls AFTER it — never again between toolbar and field. */}
      <div className="flex min-w-0 flex-1 items-center">
        {/* Outside the mailbox there is nothing to grey out: the mail group does not exist. */}
        {onMail && <MailToolbar />}

      <div
        ref={panelRef}
        data-omnibar-search-field
        className="relative flex min-w-0 flex-1 items-center"
        style={{
          maxWidth: OMNIBAR.searchMaxWidth,
          minWidth: OMNIBAR.searchMinWidth,
          marginLeft: OMNIBAR.searchGap,
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
              // -1 = "no selection": the list wraps through that state, so returning to
              // plain mail search is always reachable.
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
              // A selected entry wins; with no selection, Enter searches mail exactly as it
              // did before the panel existed.
              if (showPanel && panelIndex >= 0) { e.preventDefault(); runSuggestion(panelIndex); return }
              closePanel()
              submit(e.currentTarget.value, scope)
              return
            }
            if (e.key !== 'Escape') return
            // Escape closes the panel first, and only then clears the field.
            if (showPanel) { e.preventDefault(); closePanel(); return }
            clear()
            e.currentTarget.blur()
          }}
          placeholder={t('searchMail')}
          aria-label={t('searchMail')}
          data-omnibar-search
          className="w-full h-8 pl-8 pr-12 text-xs rounded-lg border border-border bg-muted/50
            placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
        {query ? (
          <IconTooltip label={t('clearSearch')} align="end">
            <button
              type="button"
              onClick={clear}
              aria-label={t('clearSearch')}
              data-omnibar-search-clear
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </IconTooltip>
        ) : (
          <kbd className="absolute right-2 top-1/2 hidden -translate-y-1/2 text-[10px] text-muted-foreground pointer-events-none sm:block">
            {SEARCH_SHORTCUT}
          </kbd>
        )}

        {/* The panel unfolds BELOW the field, at its exact width (`inset-x-0`), above the
            content. It closes with no overlay, so the click that closes it also reaches
            what it was aimed at. */}
        {showPanel && (
          <div
            role="listbox"
            data-omnibar-panel
            className="absolute inset-x-0 top-full z-50 mt-1 max-h-[70vh] overflow-y-auto
              rounded-xl border border-border bg-popover p-1 shadow-xl"
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
            {/* Fallback row, always last: the field's default action. */}
            <div className="mt-1 border-t border-border pt-1">
              <button
                type="button"
                role="option"
                aria-selected={panelIndex === -1}
                data-omnibar-entry="search"
                onClick={() => {
                  if (debounce.current) clearTimeout(debounce.current)
                  closePanel()
                  submit(query, scope)
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

      {/* Right-hand group: the scope toggle only while searching, then the signed-in
          user. One group, so the field's side reserve has a single thing to clear. */}
      {/* `ml-auto`: the field no longer carries automatic margins, so THIS group absorbs
          the free space and stays flush against the right edge. */}
      <div data-omnibar-right className="ml-auto flex shrink-0 items-center gap-2 pl-2">
      {/* Search scope — only shown while searching, one row, two positions */}
      {query && (
        <div className="hidden sm:flex shrink-0 items-center rounded-lg border border-border bg-muted/50 p-0.5 text-[11px]">
          {([SCOPE_FOLDER, SCOPE_ALL] as const).map(value => (
            <button
              key={value}
              type="button"
              onClick={() => {
                if (debounce.current) clearTimeout(debounce.current)
                submit(query, value)
              }}
              data-omnibar-scope={value}
              aria-pressed={scope === value}
              className={cn(
                'px-2 h-6 rounded-md transition-colors',
                scope === value ? 'bg-background text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {t(value === SCOPE_ALL ? 'searchAllFolders' : 'searchThisFolder')}
            </button>
          ))}
        </div>
      )}

        <UserMenu />
      </div>
    </header>
  )
}

/**
 * `useSearchParams` requires a Suspense boundary (repo convention): the bar renders
 * behind a fallback of the right height, so there is never a layout jump.
 */
export function Omnibar(props: OmnibarProps) {
  return (
    <Suspense fallback={<div className="shrink-0 border-b border-border bg-background" style={{ height: OMNIBAR.height }} />}>
      <OmnibarInner {...props} />
    </Suspense>
  )
}
