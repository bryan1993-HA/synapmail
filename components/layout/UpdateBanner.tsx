'use client'

import { useState, useEffect } from 'react'
import useSWR from 'swr'
import { useTranslations } from 'next-intl'
import { X, Sparkles, Terminal, AlertCircle } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { GitHubRelease } from '@/app/api/updates/route'

const fetcher = (url: string) => fetch(url).then((r) => r.json())

// ── Utilitaire : comparaison semver simple ───────────────────────────────────
function isNewer(latest: string, current: string): boolean {
  const parse = (v: string) =>
    v
      .replace(/^v/, '')
      .split('-')[0]  // ignorer pre-release suffix pour la comparaison
      .split('.')
      .map(Number)
  const [lMaj, lMin, lPat] = parse(latest)
  const [cMaj, cMin, cPat] = parse(current)
  if (lMaj !== cMaj) return lMaj > cMaj
  if (lMin !== cMin) return lMin > cMin
  return lPat > cPat
}

// ── Rendu Markdown minimal (headers, bold, listes, liens) ────────────────────
function renderMarkdown(md: string): string {
  return md
    // Headers
    .replace(/^### (.+)$/gm, '<h3 class="text-sm font-semibold mt-4 mb-1 text-foreground">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="text-base font-semibold mt-5 mb-2 text-foreground">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 class="text-lg font-bold mt-5 mb-2 text-foreground">$1</h1>')
    // Bold + italic
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Code inline
    .replace(/`([^`]+)`/g, '<code class="bg-muted px-1 py-0.5 rounded text-xs font-mono">$1</code>')
    // Listes
    .replace(/^[-*] (.+)$/gm, '<li class="ml-4 list-disc">$1</li>')
    // Liens
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener" class="text-blue-500 underline">$1</a>')
    // Séparateur
    .replace(/^---$/gm, '<hr class="my-3 border-border" />')
    // Sauts de ligne (après les remplacements)
    .replace(/\n/g, '<br />')
    // Nettoyer les <br /> superflus autour des balises block
    .replace(/<br \/>(<h[1-3])/g, '$1')
    .replace(/(<\/h[1-3]>)<br \/>/g, '$1')
    .replace(/<br \/>(<li)/g, '$1')
    .replace(/(<\/li>)<br \/>/g, '$1')
    .replace(/<br \/>(<hr)/g, '$1')
    .replace(/(<\/hr>)<br \/>/g, '$1')
}

// ── Composant principal ──────────────────────────────────────────────────────
export function UpdateBanner() {
  const t = useTranslations('updates')
  const [dismissed, setDismissed] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<'releases' | 'howto'>('releases')

  const { data } = useSWR<{
    data?: { releases: GitHubRelease[]; current: string }
    error?: string
  }>('/api/updates', fetcher, {
    revalidateOnFocus: false,
    refreshInterval: 3600_000, // re-check toutes les heures
    dedupingInterval: 3600_000,
  })

  // Restaurer le dismiss depuis sessionStorage (reset à chaque session)
  useEffect(() => {
    const key = 'synapmail:update-dismissed'
    const stored = sessionStorage.getItem(key)
    if (stored) setDismissed(true)
  }, [])

  const handleDismiss = () => {
    setDismissed(true)
    sessionStorage.setItem('synapmail:update-dismissed', '1')
  }

  const releases = data?.data?.releases ?? []
  const current = data?.data?.current ?? '0.0.0'

  // Trouver toutes les releases plus récentes que la version courante
  const newReleases = releases.filter(
    (r) => !r.prerelease && isNewer(r.tag_name, current)
  )

  if (!data || newReleases.length === 0 || dismissed) return null

  const latest = newReleases[0]

  return (
    <>
      {/* ── Bandeau pleine largeur ─────────────────────────────────────────── */}
      <div
        role="alert"
        className="relative flex items-center justify-between gap-3 w-full
                   bg-gradient-to-r from-violet-600 to-indigo-600
                   text-white px-4 py-2.5 text-sm shrink-0 z-40"
      >
        {/* Icône + texte */}
        <div className="flex items-center gap-2 min-w-0">
          <Sparkles className="w-4 h-4 shrink-0 opacity-90" />
          <span className="font-medium truncate">
            {t('available', { version: latest.tag_name })}
          </span>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => { setActiveTab('releases'); setModalOpen(true) }}
            className="rounded-md border border-white/40 bg-white/10 px-3 py-1
                       text-xs font-medium hover:bg-white/20 transition-colors"
          >
            {t('moreInfo')}
          </button>
          <button
            onClick={handleDismiss}
            aria-label={t('dismiss')}
            className="rounded-md p-1 hover:bg-white/20 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* ── Modale ─────────────────────────────────────────────────────────── */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="!max-w-[960px] w-[92vw] max-h-[85vh] flex flex-col gap-0 p-0 overflow-hidden">
          <DialogHeader className="px-6 pt-5 pb-0 shrink-0">
            <DialogTitle className="flex items-center gap-2 text-base">
              <Sparkles className="w-4 h-4 text-violet-500" />
              {t('modalTitle', { version: latest.tag_name })}
            </DialogTitle>
          </DialogHeader>

          {/* Onglets */}
          <div className="flex border-b border-border mt-4 shrink-0 px-6">
            <button
              onClick={() => setActiveTab('releases')}
              className={`pb-2 px-1 mr-5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'releases'
                  ? 'border-violet-500 text-violet-600 dark:text-violet-400'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {t('tabReleases')}
            </button>
            <button
              onClick={() => setActiveTab('howto')}
              className={`pb-2 px-1 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'howto'
                  ? 'border-violet-500 text-violet-600 dark:text-violet-400'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {t('tabHowTo')}
            </button>
          </div>

          {/* Contenu */}
          <div className="flex-1 overflow-y-auto px-6 py-4">
            {activeTab === 'releases' ? (
              <div className="space-y-6">
                {newReleases.map((release) => (
                  <div key={release.tag_name}>
                    {/* En-tête release */}
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center rounded-full bg-violet-100 dark:bg-violet-900/40 px-2.5 py-0.5 text-xs font-semibold text-violet-700 dark:text-violet-300">
                          {release.tag_name}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {new Date(release.published_at).toLocaleDateString(undefined, {
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric',
                          })}
                        </span>
                      </div>
                      <a
                        href={release.html_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-muted-foreground hover:text-foreground underline transition-colors"
                      >
                        GitHub ↗
                      </a>
                    </div>

                    {/* Contenu release */}
                    {release.body ? (
                      <div
                        className="prose prose-sm dark:prose-invert max-w-none text-sm text-muted-foreground leading-relaxed"
                        dangerouslySetInnerHTML={{ __html: renderMarkdown(release.body) }}
                      />
                    ) : (
                      <p className="text-sm text-muted-foreground italic">{t('noNotes')}</p>
                    )}

                    {/* Séparateur si plusieurs releases */}
                    {newReleases.indexOf(release) < newReleases.length - 1 && (
                      <hr className="mt-6 border-border" />
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <HowToUpdate current={current} latest={latest.tag_name} t={t} />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

// ── Onglet "Comment mettre à jour" ───────────────────────────────────────────
function HowToUpdate({
  current,
  latest,
  t,
}: {
  current: string
  latest: string
  t: ReturnType<typeof useTranslations<'updates'>>
}) {
  const steps = [
    {
      icon: '1',
      title: t('howto.step1Title'),
      desc: t('howto.step1Desc'),
      code: null,
    },
    {
      icon: '2',
      title: t('howto.step2Title'),
      desc: t('howto.step2Desc'),
      code: 'git pull origin main',
    },
    {
      icon: '3',
      title: t('howto.step3Title'),
      desc: t('howto.step3Desc'),
      code: 'docker compose -f /mnt/stockage/docker/synapmail/docker-compose.yml up -d --build',
    },
    {
      icon: '4',
      title: t('howto.step4Title'),
      desc: t('howto.step4Desc'),
      code: 'docker compose -f /mnt/stockage/docker/synapmail/docker-compose.yml logs -f synapmail',
    },
  ]

  return (
    <div className="space-y-5">
      {/* Bandeau info sécurité */}
      <div className="flex gap-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-3">
        <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
        <p className="text-xs text-amber-700 dark:text-amber-300 leading-relaxed">
          {t('howto.safeNote')}
        </p>
      </div>

      {/* Version info */}
      <div className="flex items-center gap-3 text-xs text-muted-foreground bg-muted/50 rounded-lg px-3 py-2">
        <span>{t('howto.from')} <span className="font-mono font-medium">v{current}</span></span>
        <span className="text-muted-foreground/50">→</span>
        <span>{t('howto.to')} <span className="font-mono font-medium">{latest}</span></span>
      </div>

      {/* Étapes */}
      <div className="space-y-4">
        {steps.map((step, i) => (
          <div key={i} className="flex gap-3">
            {/* Numéro */}
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet-100 dark:bg-violet-900/40 text-xs font-bold text-violet-700 dark:text-violet-300 mt-0.5">
              {step.icon}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground">{step.title}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{step.desc}</p>
              {step.code && (
                <div className="mt-2 flex items-start gap-2 rounded-md bg-zinc-900 dark:bg-zinc-950 px-3 py-2">
                  <Terminal className="w-3.5 h-3.5 text-zinc-400 shrink-0 mt-0.5" />
                  <code className="text-xs text-green-400 font-mono break-all">{step.code}</code>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Note données */}
      <div className="rounded-lg bg-muted/50 border border-border p-3 text-xs text-muted-foreground">
        <strong className="text-foreground">{t('howto.dataTitle')}</strong>{' '}
        {t('howto.dataDesc')}
      </div>
    </div>
  )
}
