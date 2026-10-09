'use client'

import { useRef, useState } from 'react'
import useSWR from 'swr'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import {
  BRANDING_ERRORS,
  DEFAULT_APP_NAME,
  FAVICON_TYPES,
  type Branding,
  type BrandingError,
  faviconLinks,
  faviconTypeError,
  faviconUrl,
} from '@/lib/branding'

const ROUTE = '/api/admin/branding'

/**
 * Ancre de cette section dans la page d'administration. Source UNIQUE : la section
 * la porte, et tout ce qui y CONDUIT (palette de l'omnibar, navigation des réglages)
 * bâtit son lien avec — un identifiant recopié à la main finirait par ne plus
 * désigner cette section, et le lien mènerait en haut de page sans rien dire.
 */
export const BRANDING_ANCHOR = 'branding'
const fetcher = (url: string) => fetch(url).then(r => r.json())

/** La taille à laquelle un navigateur affiche réellement une favicon sur un écran dense. */
const FAVICON_PREVIEW = 32

const KNOWN_ERRORS: readonly string[] = Object.values(BRANDING_ERRORS)
const isBrandingError = (value: unknown): value is BrandingError =>
  typeof value === 'string' && KNOWN_ERRORS.includes(value)

/**
 * Applique l'identité à l'onglet SANS recharger : le titre, puis les
 * `<link rel="icon">` de la page, reposés depuis `faviconLinks()` — la MÊME
 * source que le rendu serveur, pour qu'une remise à zéro rétablisse les DEUX
 * icônes livrées et non la seule première. Repartir de `<link>` neufs (plutôt
 * que changer leur `href`) est ce qui force les navigateurs à relire l'icône.
 */
function applyToTab(appName: string, faviconVersion: number | null) {
  document.title = appName
  document.head.querySelectorAll('link[rel~="icon"]').forEach(node => node.remove())
  for (const icon of faviconLinks(faviconVersion)) {
    const link = document.createElement('link')
    link.rel = 'icon'
    link.href = icon.url
    if (icon.type) link.type = icon.type
    if (icon.sizes) link.sizes.value = icon.sizes
    document.head.appendChild(link)
  }
}

/**
 * Identité de l'instance, réservée à l'administrateur : le nom affiché dans
 * l'onglet du navigateur et l'icône de cet onglet, pour TOUT LE MONDE, page de
 * connexion comprise. Les icônes PWA / apple-touch et le logo image ne sont pas
 * concernés.
 */
export function BrandingSection() {
  const t = useTranslations('admin.branding')
  const { data, mutate } = useSWR<{ data: Branding }>(ROUTE, fetcher)
  const branding = data?.data

  const [name, setName] = useState<string | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Survol d'un fichier au-dessus de la zone : le seul retour visuel d'un glisser-déposer. */
  const [dragging, setDragging] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  // The picked file's preview is DRAWN here from its decoded pixels: no URL is ever
  // derived from the file, so nothing file-derived reaches a `src` attribute.
  const previewRef = useRef<HTMLCanvasElement>(null)

  // Tant que l'administrateur n'a rien tapé, le champ montre ce qui est enregistré.
  const nameValue = name ?? branding?.appName ?? ''
  // L'aperçu montre UNE image : la première des icônes livrées, ou celle réglée.
  const iconSrc = branding?.faviconVersion
    ? faviconUrl(branding.faviconVersion)
    : faviconLinks(null)[0].url

  const settle = (next: Branding) => {
    mutate({ data: next }, false)
    applyToTab(next.appName, next.faviconVersion)
    setName(null)
    pickFile(null)
    if (fileRef.current) fileRef.current.value = ''
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const run = async (request: () => Promise<Response>) => {
    setBusy(true)
    setError(null)
    try {
      const res = await request()
      const body = await res.json()
      if (!res.ok) {
        setError(isBrandingError(body.error) ? t(`errors.${body.error}`) : String(body.error))
        return
      }
      settle(body.data as Branding)
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }

  // A file is kept only if its declared type is in the list AND the browser can
  // decode it; a file that fails either gets no preview, just the closest error.
  const pickFile = async (next: File | null) => {
    let refused = next ? faviconTypeError(next.type) : null
    let bitmap: ImageBitmap | null = null
    if (next && !refused) {
      try {
        bitmap = await createImageBitmap(next)
      } catch {
        refused = BRANDING_ERRORS.badType
      }
    }
    const accepted = refused ? null : next
    const canvas = previewRef.current?.getContext('2d')
    canvas?.clearRect(0, 0, FAVICON_PREVIEW, FAVICON_PREVIEW)
    if (bitmap) {
      canvas?.drawImage(bitmap, 0, 0, FAVICON_PREVIEW, FAVICON_PREVIEW)
      bitmap.close()
    }
    setError(refused ? t(`errors.${refused}`) : null)
    setFile(accepted)
  }

  const save = () => {
    const form = new FormData()
    if (name !== null) form.set('appName', name)
    if (file) form.set('favicon', file)
    return run(() => fetch(ROUTE, { method: 'PUT', body: form }))
  }

  const reset = (target: 'name' | 'favicon') =>
    run(() => fetch(`${ROUTE}?target=${target}`, { method: 'DELETE' }))

  const dirty = (name !== null && name !== branding?.appName) || file !== null

  return (
    // `scroll-mt-*` : arrivé par l'ancre, le titre ne se colle pas au bord haut du
    // panneau des réglages — la hauteur de son en-tête est laissée au-dessus.
    // Le fond suit celui des autres cartes de réglages (`SettingsSection`), la
    // section étant désormais rendue parmi elles (lot H4a).
    <section
      id={BRANDING_ANCHOR}
      className="scroll-mt-16 space-y-4 rounded-2xl border border-border bg-card/80 p-5 shadow-sm backdrop-blur-sm"
    >
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('title')}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{t('description')}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs text-muted-foreground" htmlFor="branding-name">
            {t('nameLabel')}
          </label>
          <Input
            id="branding-name"
            value={nameValue}
            onChange={e => setName(e.target.value)}
            placeholder={DEFAULT_APP_NAME}
            className="h-8 text-sm"
          />
          <button
            type="button"
            data-branding-reset="name"
            onClick={() => reset('name')}
            disabled={busy}
            className="mt-2 text-xs text-muted-foreground underline-offset-2 hover:underline disabled:opacity-50"
          >
            {t('resetName')}
          </button>
        </div>

        <div>
          <span className="mb-1 block text-xs text-muted-foreground">{t('iconLabel')}</span>
          {/* Une zone de dépôt plutôt que le champ natif : « Aucun fichier choisi »
              débordait de la carte, et sa largeur dépend du navigateur et de la langue.
              Cliquer la zone ouvre le sélecteur, y glisser un fichier le prend
              directement. Un seul aperçu, à 32 px : deux vignettes côte à côte se
              lisaient comme un défaut d'affichage. */}
          <button
            type="button"
            data-favicon-drop
            onClick={() => fileRef.current?.click()}
            onDragOver={e => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={e => {
              e.preventDefault()
              setDragging(false)
              const file = e.dataTransfer.files?.[0]
              if (file) pickFile(file)
            }}
            className={cn(
              'mt-1 flex w-full items-center gap-3 rounded-lg border border-dashed px-3 py-3 text-left transition-colors',
              dragging ? 'border-[color:var(--synap-account)] bg-muted/50' : 'border-border hover:bg-muted/30',
            )}
          >
            {/* One preview at a time: the picked file's pixels, or else the saved icon. */}
            <canvas
              ref={previewRef}
              role="img"
              aria-label={t('preview')}
              width={FAVICON_PREVIEW}
              height={FAVICON_PREVIEW}
              className={cn('shrink-0', !file && 'hidden')}
            />
            {!file && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={iconSrc}
                alt={t('preview')}
                width={FAVICON_PREVIEW}
                height={FAVICON_PREVIEW}
                style={{ width: FAVICON_PREVIEW, height: FAVICON_PREVIEW }}
                className="shrink-0"
              />
            )}
            <span className="min-w-0">
              <span className="block truncate text-xs text-foreground">{file?.name ?? t('iconDrop')}</span>
              <span className="mt-0.5 block text-[11px] text-muted-foreground">{t('iconHint')}</span>
            </span>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept={FAVICON_TYPES.join(',')}
            onChange={e => pickFile(e.target.files?.[0] ?? null)}
            className="sr-only"
          />
          <button
            type="button"
            data-branding-reset="favicon"
            onClick={() => reset('favicon')}
            disabled={busy}
            className="mt-2 text-xs text-muted-foreground underline-offset-2 hover:underline disabled:opacity-50"
          >
            {t('resetIcon')}
          </button>
        </div>
      </div>

      {error && <p className="mt-3 text-xs text-destructive">{error}</p>}

      <div className="mt-4 flex items-center gap-3">
        <Button size="sm" onClick={save} disabled={busy || !dirty}>
          {busy ? t('saving') : t('save')}
        </Button>
        {saved && <span className="text-xs text-muted-foreground">{t('saved')}</span>}
      </div>
    </section>
  )
}
