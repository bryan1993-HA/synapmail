'use client'

import { useTranslations } from 'next-intl'
import { Reply, Forward, Trash2, Archive, Star, MoreHorizontal, Mail, Paperclip, Download, X, FileText, Image as ImageIcon, ReplyAll, MailX, CheckCircle2, AlertCircle, ShieldCheck, ShieldAlert, ShieldX, Filter } from 'lucide-react'
import useSWR from 'swr'
import type { Message } from '@/types/email'
import type { Attachment } from '@/types/email'
import { Button } from '@/components/ui/button'
import { useRef, useEffect, useState, useCallback } from 'react'
import { cn } from '@/lib/utils'

const fetcher = (url: string) => fetch(url).then(r => r.json())

const formatBytes = (bytes: number) =>
  bytes < 1024 ? bytes + 'B'
    : bytes < 1048576 ? (bytes / 1024).toFixed(1) + 'Ko'
    : (bytes / 1048576).toFixed(1) + 'Mo'

function isImage(contentType: string) {
  return /^image\//i.test(contentType)
}
function isPdf(contentType: string) {
  return contentType === 'application/pdf'
}

function AttachmentSection({
  attachments, uid, accountId, folder,
}: {
  attachments: Attachment[]
  uid: string
  accountId: string
  folder: string
}) {
  const [preview, setPreview] = useState<{ url: string; downloadUrl: string; type: 'image' | 'pdf'; filename: string } | null>(null)

  const attUrl = useCallback(
    (id: string, inline = false) =>
      `/api/messages/${uid}/attachment/${id}?account=${accountId}&folder=${encodeURIComponent(folder)}${inline ? '&inline=true' : ''}`,
    [uid, accountId, folder]
  )

  const openPreview = (att: Attachment) => {
    setPreview({
      url: attUrl(att.id, true),
      downloadUrl: attUrl(att.id, false),
      type: isImage(att.contentType) ? 'image' : 'pdf',
      filename: att.filename,
    })
  }

  return (
    <>
      <div className="px-6 py-4 border-t border-border">
        <p className="text-xs font-semibold text-muted-foreground mb-3 uppercase tracking-wide">
          Pièces jointes ({attachments.length})
        </p>

        {/* Image thumbnails grid */}
        {attachments.some(a => isImage(a.contentType)) && (
          <div className="flex flex-wrap gap-2 mb-3">
            {attachments.filter(a => isImage(a.contentType)).map(att => (
              <button
                key={att.id}
                onClick={() => openPreview(att)}
                className="relative group rounded-lg overflow-hidden border border-border hover:border-primary/50 transition-colors w-24 h-24 bg-muted/30 shrink-0"
                title={att.filename}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={attUrl(att.id, true)}
                  alt={att.filename}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <ImageIcon className="w-5 h-5 text-white" />
                </div>
              </button>
            ))}
          </div>
        )}

        {/* File chips (all attachments) */}
        <div className="flex flex-wrap gap-2">
          {attachments.map(att => {
            const canPreview = isImage(att.contentType) || isPdf(att.contentType)
            const ext = '.' + (att.filename.split('.').pop() ?? '').toLowerCase()
            const isDangerous = DANGEROUS_EXTENSIONS.includes(ext)
            return (
              <div
                key={att.id}
                className={`flex items-center gap-1 rounded-lg border text-xs overflow-hidden ${
                  isDangerous
                    ? 'border-red-500/40 bg-red-500/10'
                    : 'border-border bg-muted/30'
                }`}
              >
                {isDangerous && (
                  <span className="pl-2 shrink-0" title="Type de fichier potentiellement dangereux">
                    <ShieldX className="w-3.5 h-3.5 text-red-500" />
                  </span>
                )}
                {canPreview ? (
                  <button
                    onClick={() => openPreview(att)}
                    className="flex items-center gap-2 px-3 py-2 hover:bg-muted/60 transition-colors"
                    title="Prévisualiser"
                  >
                    {isPdf(att.contentType)
                      ? <FileText className="w-3.5 h-3.5 text-red-500 shrink-0" />
                      : <ImageIcon className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                    }
                    <span className="max-w-[140px] truncate text-foreground">{att.filename}</span>
                    <span className="text-muted-foreground shrink-0">{formatBytes(att.size)}</span>
                  </button>
                ) : (
                  <span className="flex items-center gap-2 px-3 py-2">
                    <Paperclip className={`w-3.5 h-3.5 shrink-0 ${isDangerous ? 'text-red-500' : 'text-muted-foreground'}`} />
                    <span className={`max-w-[140px] truncate ${isDangerous ? 'text-red-600 dark:text-red-400 font-medium' : 'text-foreground'}`}>{att.filename}</span>
                    <span className="text-muted-foreground shrink-0">{formatBytes(att.size)}</span>
                  </span>
                )}
                <a
                  href={attUrl(att.id)}
                  download={att.filename}
                  className="px-2 py-2 hover:bg-muted/60 transition-colors border-l border-border text-muted-foreground hover:text-foreground"
                  title={isDangerous ? '⚠ Fichier potentiellement dangereux — télécharger quand même ?' : 'Télécharger'}
                >
                  <Download className={`w-3.5 h-3.5 ${isDangerous ? 'text-red-500' : ''}`} />
                </a>
              </div>
            )
          })}
        </div>
        {/* Dangerous attachment warning */}
        {attachments.some(a => DANGEROUS_EXTENSIONS.includes('.' + (a.filename.split('.').pop() ?? '').toLowerCase())) && (
          <div className="mt-2 flex items-center gap-2 text-[11px] text-red-600 dark:text-red-400">
            <ShieldX className="w-3 h-3 shrink-0" />
            <span>Ce type de fichier peut contenir des logiciels malveillants. Ne téléchargez que si vous faites confiance à l&apos;expéditeur.</span>
          </div>
        )}
      </div>

      {/* Preview modal */}
      {preview && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setPreview(null)}
        >
          <button
            onClick={() => setPreview(null)}
            className="absolute top-4 right-4 w-9 h-9 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
          <a
            href={preview.downloadUrl}
            download={preview.filename}
            onClick={e => e.stopPropagation()}
            className="absolute top-4 right-16 w-9 h-9 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
            title="Télécharger"
          >
            <Download className="w-4 h-4" />
          </a>
          <div
            className="max-w-5xl max-h-[90vh] w-full flex flex-col items-center gap-3"
            onClick={e => e.stopPropagation()}
          >
            <p className="text-white/70 text-sm truncate max-w-full">{preview.filename}</p>
            {preview.type === 'image' ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={preview.url}
                alt={preview.filename}
                className="max-w-full max-h-[80vh] object-contain rounded-lg shadow-2xl"
              />
            ) : (
              <iframe
                src={preview.url}
                className="w-full rounded-lg shadow-2xl bg-white"
                style={{ height: '80vh' }}
                title={preview.filename}
              />
            )}
          </div>
        </div>
      )}
    </>
  )
}

function parseUnsubscribeHeader(header: string): { http?: string; mailto?: string } {
  const result: { http?: string; mailto?: string } = {}
  const matches = header.match(/<([^>]+)>/g) ?? []
  for (const match of matches) {
    const url = match.slice(1, -1).trim()
    if (url.startsWith('http')) result.http = url
    else if (url.startsWith('mailto:')) result.mailto = url
  }
  return result
}

function UnsubscribeBanner({
  listUnsubscribe,
  accountId,
}: {
  listUnsubscribe: string
  accountId: string
}) {
  const t = useTranslations('mail')
  const { http, mailto } = parseUnsubscribeHeader(listUnsubscribe)
  const [state, setState] = useState<'idle' | 'confirm' | 'loading' | 'done' | 'error'>('idle')
  const isSubmitting = state === 'loading'

  if (!http && !mailto) return null

  const handleClick = () => setState('confirm')
  const handleCancel = () => setState('idle')

  const handleConfirm = async () => {
    setState('loading')
    try {
      if (http) {
        window.open(http, '_blank', 'noopener,noreferrer')
        setState('done')
      } else if (mailto) {
        const url = new URL(mailto)
        const to = url.pathname
        const subject = url.searchParams.get('subject') ?? 'unsubscribe'
        const res = await fetch('/api/unsubscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accountId, to, subject }),
        })
        if (res.ok) setState('done')
        else setState('error')
      }
    } catch {
      setState('error')
    }
  }

  if (state === 'done') {
    return (
      <div className="flex items-center gap-2 px-4 py-2 bg-green-500/10 border-b border-green-500/20 text-green-600 dark:text-green-400 text-xs">
        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
        <span>{t('unsubscribeDone')}</span>
      </div>
    )
  }

  if (state === 'error') {
    return (
      <div className="flex items-center gap-2 px-4 py-2 bg-destructive/10 border-b border-destructive/20 text-destructive text-xs">
        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
        <span>{t('unsubscribeError')}</span>
        <button onClick={() => setState('idle')} className="ml-auto underline underline-offset-2 hover:no-underline">
          Réessayer
        </button>
      </div>
    )
  }

  if (state === 'confirm') {
    return (
      <div className="flex items-center gap-3 px-4 py-2 bg-amber-500/10 border-b border-amber-500/20 text-xs">
        <MailX className="w-3.5 h-3.5 text-amber-600 shrink-0" />
        <span className="text-foreground/70">{t('unsubscribeConfirmDesc')}</span>
        <div className="ml-auto flex items-center gap-2 shrink-0">
          <button
            onClick={handleCancel}
            className="px-2.5 py-1 rounded border border-border hover:bg-muted transition-colors text-muted-foreground"
          >
            Annuler
          </button>
          <button
            onClick={handleConfirm}
            disabled={isSubmitting}
            className="px-2.5 py-1 rounded bg-amber-500 hover:bg-amber-600 text-white transition-colors font-medium disabled:opacity-50"
          >
            {t('unsubscribe')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2 px-4 py-2 bg-muted/40 border-b border-border text-xs">
      <MailX className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
      <span className="text-muted-foreground">{t('unsubscribeBanner')}</span>
      <button
        onClick={handleClick}
        className="ml-auto text-amber-600 dark:text-amber-400 hover:underline underline-offset-2 font-medium shrink-0"
      >
        {t('unsubscribe')}
      </button>
    </div>
  )
}

// Each entry: keyword(s) to match in the display name → legitimate sending domains
// Multiple keywords for the same brand cover aliases like "Amazon Prime", "Prime Video", etc.
const BRAND_RULES: Array<{ keywords: string[]; domains: string[]; label: string }> = [
  {
    label: 'Amazon',
    keywords: ['amazon', 'prime video', 'amazon prime', 'aws ', 'kindle'],
    domains: ['amazon.com', 'amazon.fr', 'amazon.co.uk', 'amazon.de', 'amazon.es',
              'amazon.it', 'amazon.ca', 'amazon.com.au', 'ses.amazonaws.com',
              'primevideo.com', 'amazonprime.com'],
  },
  {
    label: 'PayPal',
    keywords: ['paypal'],
    domains: ['paypal.com', 'paypal.fr'],
  },
  {
    label: 'Apple',
    keywords: ['apple', 'icloud', 'app store', 'apple id'],
    domains: ['apple.com', 'icloud.com', 'me.com'],
  },
  {
    label: 'Google',
    keywords: ['google', 'gmail', 'google workspace', 'google pay'],
    domains: ['google.com', 'googlemail.com', 'gmail.com', 'accounts.google.com'],
  },
  {
    label: 'Microsoft',
    keywords: ['microsoft', 'outlook', 'office 365', 'xbox', 'windows', 'azure', 'onedrive'],
    domains: ['microsoft.com', 'outlook.com', 'live.com', 'hotmail.com', 'xbox.com', 'office.com'],
  },
  {
    label: 'Netflix',
    keywords: ['netflix'],
    domains: ['netflix.com'],
  },
  {
    label: 'Facebook / Meta',
    keywords: ['facebook', 'meta ', 'instagram', 'whatsapp'],
    domains: ['facebook.com', 'facebookmail.com', 'fb.com', 'instagram.com', 'meta.com'],
  },
  {
    label: 'Twitter / X',
    keywords: ['twitter', ' x.com'],
    domains: ['twitter.com', 'x.com'],
  },
  {
    label: 'LinkedIn',
    keywords: ['linkedin'],
    domains: ['linkedin.com'],
  },
  {
    label: 'eBay',
    keywords: ['ebay'],
    domains: ['ebay.com', 'ebay.fr', 'ebay.co.uk'],
  },
  {
    label: 'Orange',
    keywords: ['orange'],
    domains: ['orange.fr', 'orange.com'],
  },
  {
    label: 'SFR',
    keywords: ['sfr'],
    domains: ['sfr.fr', 'sfr.com', 'numericable.fr'],
  },
  {
    label: 'Free',
    keywords: ['free mobile', 'free telecom'],
    domains: ['free.fr', 'freemobile.fr', 'iliad.fr'],
  },
  {
    label: 'Boursorama',
    keywords: ['boursorama', 'boursobank'],
    domains: ['boursorama.com'],
  },
  {
    label: 'LCL',
    keywords: ['lcl'],
    domains: ['lcl.fr'],
  },
  {
    label: 'BNP Paribas',
    keywords: ['bnp paribas', 'bnp', 'hello bank'],
    domains: ['bnpparibas.com', 'bnpparibas.fr', 'hellobank.fr'],
  },
  {
    label: 'Crédit Agricole',
    keywords: ['crédit agricole', 'credit agricole', 'ca-'],
    domains: ['credit-agricole.fr'],
  },
  {
    label: 'Impôts / DGFiP',
    keywords: ['impots', 'impôts', 'dgfip', 'direction générale des finances'],
    domains: ['impots.gouv.fr', 'dgfip.finances.gouv.fr'],
  },
  {
    label: 'CAF',
    keywords: ['caf ', 'caisse d\'allocations'],
    domains: ['caf.fr'],
  },
  {
    label: 'Ameli / Assurance Maladie',
    keywords: ['ameli', 'assurance maladie', 'cpam'],
    domains: ['ameli.fr', 'assurance-maladie.fr'],
  },
  {
    label: 'Doctolib',
    keywords: ['doctolib'],
    domains: ['doctolib.fr', 'doctolib.com'],
  },
  {
    label: 'leboncoin',
    keywords: ['leboncoin'],
    domains: ['leboncoin.fr'],
  },
  {
    label: 'Cdiscount',
    keywords: ['cdiscount'],
    domains: ['cdiscount.com'],
  },
  {
    label: 'Spotify',
    keywords: ['spotify'],
    domains: ['spotify.com'],
  },
  {
    label: 'Uber',
    keywords: ['uber'],
    domains: ['uber.com', 'uber.fr'],
  },
  {
    label: 'Airbnb',
    keywords: ['airbnb'],
    domains: ['airbnb.com', 'airbnb.fr'],
  },
]

function detectSpoofedBrand(fromName: string, fromAddress: string): string | null {
  const name = fromName.toLowerCase()
  const domain = fromAddress.split('@')[1]?.toLowerCase() ?? ''
  for (const rule of BRAND_RULES) {
    const matchedKeyword = rule.keywords.some(kw => name.includes(kw.toLowerCase()))
    if (matchedKeyword) {
      const isLegit = rule.domains.some(d => domain === d || domain.endsWith('.' + d))
      if (!isLegit) return rule.label
    }
  }
  return null
}

// Levenshtein distance between two strings
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  )
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
  return dp[m][n]
}

// Detect lookalike domain — e.g. "amaz0n.com" close to "amazon.com"
// Returns the brand being imitated, or null
function detectLookalikeDomain(fromAddress: string): string | null {
  const raw = fromAddress.split('@')[1]?.toLowerCase() ?? ''
  // Strip TLD for comparison (amazon.com → amazon, amazon.co.uk → amazon)
  const domainCore = raw.replace(/\.(com|fr|co\.\w+|net|org|io|de|es|it|ca|uk|ru|cn|info|biz)$/i, '')

  for (const rule of BRAND_RULES) {
    // Skip if it's already a legitimate domain (handled by spoofing detection)
    const isLegit = rule.domains.some(d => raw === d || raw.endsWith('.' + d))
    if (isLegit) return null

    for (const officialDomain of rule.domains) {
      const officialCore = officialDomain.replace(/\.(com|fr|co\.\w+|net|org|io|de|es|it|ca|uk|ru|cn|info|biz)$/i, '')
      // Only compare domain cores of similar length (avoid false positives)
      if (Math.abs(domainCore.length - officialCore.length) > 3) continue
      const dist = levenshtein(domainCore, officialCore)
      // Distance 1 or 2 = very likely typosquatting (one letter changed/swapped/added)
      if (dist > 0 && dist <= 2) return rule.label
    }
  }
  return null
}

// Detect deceptive links in HTML body:
// a link whose displayed text looks like a URL but the href points elsewhere
function detectDeceptiveLinks(bodyHtml: string): Array<{ display: string; href: string }> {
  if (typeof window === 'undefined') return []
  const parser = new DOMParser()
  const doc = parser.parseFromString(bodyHtml, 'text/html')
  const results: Array<{ display: string; href: string }> = []
  doc.querySelectorAll('a[href]').forEach(el => {
    const href = el.getAttribute('href') ?? ''
    const text = el.textContent?.trim() ?? ''
    // Only flag if the displayed text itself looks like a URL (contains a dot + word)
    if (!/\b[\w-]+\.\w{2,}\b/.test(text)) return
    // Ignore mailto/tel
    if (href.startsWith('mailto:') || href.startsWith('tel:')) return
    try {
      const hrefHost = new URL(href).hostname.replace(/^www\./, '').toLowerCase()
      const textHost = text.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].toLowerCase()
      if (hrefHost && textHost && hrefHost !== textHost) {
        results.push({ display: text.slice(0, 60), href: hrefHost })
      }
    } catch { /* invalid URL, skip */ }
  })
  return results.slice(0, 3) // max 3 examples
}

const DANGEROUS_EXTENSIONS = ['.exe', '.scr', '.vbs', '.bat', '.cmd', '.js', '.jar', '.ps1', '.msi', '.com', '.hta', '.pif', '.reg']

const URGENCY_PATTERNS = [
  /urgent/i, /compte.{0,10}suspend/i, /remboursement.{0,10}immédiat/i,
  /vérifi.{0,10}maintenant/i, /action.{0,10}requise/i, /expir.{0,10}aujourd/i,
  /suspendu/i, /désactiv/i, /confirm.{0,10}identité/i, /accès.{0,10}bloqué/i,
  /limite.{0,10}atteinte/i, /compte.{0,10}fermé/i, /dernière.{0,10}chance/i,
  /24.{0,5}heure/i, /48.{0,5}heure/i, /immédiatement/i,
  /account.{0,10}suspend/i, /verify.{0,10}now/i, /action.{0,10}required/i,
  /unusual.{0,10}activity/i, /security.{0,10}alert/i,
]

function detectUrgencyInSubject(subject: string): string | null {
  for (const pattern of URGENCY_PATTERNS) {
    const m = subject.match(pattern)
    if (m) return m[0]
  }
  return null
}

function SecurityBanner({ message }: { message: Message }) {
  const auth = message.authResults
  const spoofedBrand = detectSpoofedBrand(message.from.name ?? '', message.from.address ?? '')
  const lookalikeBrand = !spoofedBrand ? detectLookalikeDomain(message.from.address ?? '') : null
  const replyToDomain = message.replyTo?.address?.split('@')[1]?.toLowerCase()
  const fromDomain = message.from.address?.split('@')[1]?.toLowerCase()
  const replyToMismatch = replyToDomain && fromDomain && replyToDomain !== fromDomain
  const deceptiveLinks = message.bodyHtml ? detectDeceptiveLinks(message.bodyHtml) : []
  const urgencyMatch = detectUrgencyInSubject(message.subject ?? '')

  // Determine overall security level
  const isDanger =
    spoofedBrand !== null ||
    lookalikeBrand !== null ||
    auth?.spf === 'fail' ||
    auth?.dkim === 'fail' ||
    auth?.dmarc === 'fail' ||
    deceptiveLinks.length > 0
  const isWarning =
    !isDanger && (
      (auth && (auth.spf === 'none' || auth.dkim === 'none' || auth.dmarc === 'none')) ||
      !!replyToMismatch ||
      !!urgencyMatch
    )
  const isClean = !isDanger && !isWarning && auth?.spf === 'pass' && auth?.dkim === 'pass' && auth?.dmarc === 'pass'

  const [expanded, setExpanded] = useState(false)

  if (!auth && !spoofedBrand && !lookalikeBrand && !replyToMismatch && deceptiveLinks.length === 0 && !urgencyMatch) return null

  if (isClean) {
    return (
      <div className="flex items-center gap-2 px-4 py-1.5 bg-green-500/8 border-b border-green-500/20 text-green-700 dark:text-green-400 text-xs">
        <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
        <span className="font-medium">Email authentifié</span>
        <span className="text-green-600/70 dark:text-green-500/70">SPF · DKIM · DMARC : ✓</span>
      </div>
    )
  }

  // Build the primary alert message
  const primaryAlert = spoofedBrand
    ? `Usurpation d'identité — se fait passer pour "${spoofedBrand}"`
    : lookalikeBrand
      ? `Domaine suspect — ressemble à "${lookalikeBrand}" (typosquatting probable)`
      : deceptiveLinks.length > 0
        ? `Liens trompeurs détectés — le texte et la destination ne correspondent pas`
        : auth?.spf === 'fail' || auth?.dkim === 'fail' || auth?.dmarc === 'fail'
          ? 'Authentification email échouée'
          : 'Vérification partielle — certains contrôles manquants'

  return (
    <div className={`border-b text-xs ${isDanger ? 'bg-red-500/10 border-red-500/20' : 'bg-amber-500/10 border-amber-500/20'}`}>
      <button
        className="w-full flex items-center gap-2 px-4 py-2 text-left"
        onClick={() => setExpanded(e => !e)}
      >
        {isDanger
          ? <ShieldX className="w-3.5 h-3.5 shrink-0 text-red-500" />
          : <ShieldAlert className="w-3.5 h-3.5 shrink-0 text-amber-500" />
        }
        <span className={`font-semibold ${isDanger ? 'text-red-600 dark:text-red-400' : 'text-amber-700 dark:text-amber-400'}`}>
          {isDanger ? `⚠ ${primaryAlert}` : primaryAlert}
        </span>
        <span className="ml-auto shrink-0 text-muted-foreground">{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div className="px-4 pb-3 space-y-2">
          {/* SPF / DKIM / DMARC */}
          {auth && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-mono">
              {(['spf', 'dkim', 'dmarc'] as const).map(key => (
                <span key={key} className={
                  auth[key] === 'pass' ? 'text-green-600 dark:text-green-400' :
                  auth[key] === 'fail' ? 'text-red-500' : 'text-muted-foreground'
                }>
                  {key.toUpperCase()}: {auth[key] === 'pass' ? '✓ pass' : auth[key] === 'fail' ? '✗ fail' : '– none'}
                </span>
              ))}
            </div>
          )}
          {/* Display name spoofing */}
          {spoofedBrand && (
            <p className="text-red-600 dark:text-red-400">
              Le nom &quot;<strong>{message.from.name}</strong>&quot; imite {spoofedBrand} mais l&apos;adresse <strong>{message.from.address}</strong> n&apos;est pas un domaine officiel.
            </p>
          )}
          {/* Lookalike domain */}
          {lookalikeBrand && (
            <p className="text-red-600 dark:text-red-400">
              Le domaine <strong>{message.from.address?.split('@')[1]}</strong> ressemble fortement à un domaine officiel de {lookalikeBrand} (1-2 caractères de différence).
            </p>
          )}
          {/* Deceptive links */}
          {deceptiveLinks.length > 0 && (
            <div className="text-red-600 dark:text-red-400">
              <p className="font-medium mb-1">Liens trompeurs dans l&apos;email :</p>
              {deceptiveLinks.map((l, i) => (
                <p key={i} className="text-[11px] font-mono ml-2">
                  Texte : &quot;{l.display}&quot; → pointe vers : <strong>{l.href}</strong>
                </p>
              ))}
            </div>
          )}
          {/* Reply-To mismatch */}
          {replyToMismatch && (
            <p className="text-amber-700 dark:text-amber-400">
              Reply-To pointe vers <strong>{message.replyTo?.address}</strong> — domaine différent de l&apos;expéditeur.
            </p>
          )}
          {/* Urgency words */}
          {urgencyMatch && (
            <p className="text-amber-700 dark:text-amber-400">
              Sujet contient un mot d&apos;urgence : &quot;<strong>{urgencyMatch}</strong>&quot; — technique courante de manipulation.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function EmailBody({ message }: { message: Message }) {
  const iframeRef = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    if (!message.bodyHtml || !iframeRef.current) return
    const iframe = iframeRef.current
    const doc = iframe.contentDocument
    if (!doc) return
    doc.open()
    doc.write(
      `<html><head><style>
        * { box-sizing: border-box; }
        body { font-family: sans-serif; font-size: 14px; line-height: 1.6; color: #333; padding: 16px; margin: 0; }
        img { max-width: 100%; height: auto; }
      </style></head><body>${message.bodyHtml}</body></html>`
    )
    doc.close()

    const resize = () => {
      if (iframe.contentDocument?.body) {
        iframe.style.height = iframe.contentDocument.body.scrollHeight + 'px'
      }
    }
    iframe.onload = resize
    setTimeout(resize, 100)
  }, [message.bodyHtml])

  if (message.bodyHtml) {
    return (
      <iframe
        ref={iframeRef}
        className="w-full border-0 block"
        style={{ minHeight: '100%' }}
        sandbox="allow-same-origin allow-popups"
        title="Email content"
      />
    )
  }
  return (
    <pre className="whitespace-pre-wrap font-sans text-sm text-foreground leading-relaxed p-6">
      {message.bodyPlain || '(empty)'}
    </pre>
  )
}

interface Props {
  uid: string | null
  accountId: string | null
  folder: string
  onDelete?: () => void
  onReply?: (msg: Message) => void
  onReplyAll?: (msg: Message) => void
  onForward?: (msg: Message) => void
  onMessageLoaded?: (msg: Message) => void
}

export function ReadingPane({ uid, accountId, folder, onDelete, onReply, onReplyAll, onForward, onMessageLoaded }: Props) {
  const t = useTranslations('mail')
  const [isStarred, setIsStarred] = useState<boolean | null>(null)

  const swrKey = uid && accountId
    ? `/api/messages/${uid}?account=${accountId}&folder=${encodeURIComponent(folder)}`
    : null

  const { data: message, isLoading, mutate } = useSWR<Message>(swrKey, fetcher)

  useEffect(() => {
    if (message) {
      setIsStarred(message.isStarred)
      onMessageLoaded?.(message)
      if (!message.isRead && accountId) {
        fetch(`/api/messages/${uid}?account=${accountId}&folder=${encodeURIComponent(folder)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isRead: true }),
        })
      }
    }
  }, [message?.uid]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleDelete = async () => {
    if (!uid || !accountId) return
    await fetch(`/api/messages/${uid}?account=${accountId}&folder=${encodeURIComponent(folder)}`, {
      method: 'DELETE',
    })
    onDelete?.()
  }

  const handleStar = async () => {
    if (!uid || !accountId || !message) return
    const newStarred = !isStarred
    setIsStarred(newStarred)
    await fetch(`/api/messages/${uid}?account=${accountId}&folder=${encodeURIComponent(folder)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isStarred: newStarred }),
    })
    mutate({ ...message, isStarred: newStarred }, false)
  }

  if (!uid) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 select-none px-6">
        <div className="w-20 h-20 rounded-3xl bg-primary/8 flex items-center justify-center">
          <Mail className="w-10 h-10 text-primary/30" />
        </div>
        <div className="text-center">
          <p className="text-base font-medium text-foreground/60 mb-1">Aucun message sélectionné</p>
          <p className="text-sm text-muted-foreground">Cliquez sur un message pour le lire</p>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground/70 mt-1 w-full max-w-xs">
          <div className="flex items-center gap-2 bg-muted/50 px-3 py-2 rounded-lg">
            <kbd className="font-mono font-bold text-foreground/50 text-[11px]">c</kbd>
            <span>Nouveau message</span>
          </div>
          <div className="flex items-center gap-2 bg-muted/50 px-3 py-2 rounded-lg">
            <kbd className="font-mono font-bold text-foreground/50 text-[11px]">/</kbd>
            <span>Rechercher</span>
          </div>
          <div className="flex items-center gap-2 bg-muted/50 px-3 py-2 rounded-lg">
            <kbd className="font-mono font-bold text-foreground/50 text-[11px]">r</kbd>
            <span>Répondre</span>
          </div>
          <div className="flex items-center gap-2 bg-muted/50 px-3 py-2 rounded-lg">
            <kbd className="font-mono font-bold text-foreground/50 text-[11px]">#</kbd>
            <span>Supprimer</span>
          </div>
        </div>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <div className="h-6 bg-muted animate-pulse rounded w-3/4" />
        <div className="h-4 bg-muted animate-pulse rounded w-1/2" />
        <div className="h-4 bg-muted animate-pulse rounded w-1/3" />
        <div className="mt-8 space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-4 bg-muted animate-pulse rounded" />
          ))}
        </div>
      </div>
    )
  }

  if (!message) return null

  const starred = isStarred ?? message.isStarred
  const spoofedBrand = detectSpoofedBrand(message.from.name ?? '', message.from.address ?? '')
  const urgencyWord = detectUrgencyInSubject(message.subject ?? '')

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b border-border shrink-0">
        <div className="flex items-start gap-2 mb-3">
          <h1 className="text-lg font-semibold text-foreground leading-tight flex-1">
            {message.subject || t('noSubject')}
          </h1>
          {urgencyWord && (
            <span className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-400 text-[11px] font-semibold border border-amber-500/30 mt-0.5"
              title={`Mot d'urgence détecté : "${urgencyWord}"`}>
              <ShieldAlert className="w-3 h-3" />
              Urgence
            </span>
          )}
        </div>
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className={cn(
              'w-9 h-9 rounded-full flex items-center justify-center text-sm font-semibold shrink-0',
              spoofedBrand ? 'bg-red-500/15 text-red-600 dark:text-red-400' : 'bg-primary/10 text-primary'
            )}>
              {message.from.name?.[0]?.toUpperCase() ?? message.from.address[0]?.toUpperCase()}
            </div>
            <div>
              <div className="text-sm font-medium text-foreground">{message.from.name || message.from.address}</div>
              <div className={cn('text-xs', spoofedBrand ? 'text-red-500 dark:text-red-400 font-medium' : 'text-muted-foreground')}>
                {message.from.address}
                {spoofedBrand && <span className="ml-2 font-normal text-red-400/80">(domaine non officiel)</span>}
              </div>
              {message.to?.length > 0 && (
                <div className="text-xs text-muted-foreground mt-0.5">
                  À : {message.to.map(a => a.name || a.address).join(', ')}
                </div>
              )}
              {message.cc && message.cc.length > 0 && (
                <div className="text-xs text-muted-foreground">
                  Cc : {message.cc.map(a => a.name || a.address).join(', ')}
                </div>
              )}
            </div>
          </div>
          <div className="text-xs text-muted-foreground shrink-0">
            {new Date(message.date).toLocaleString()}
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1.5 px-4 py-2 border-b border-border shrink-0">
        <Button variant="ghost" size="sm" className="gap-1.5 h-8 text-xs" onClick={() => onReply?.(message)}>
          <Reply className="w-3.5 h-3.5" /> {t('reply')}
        </Button>
        <Button variant="ghost" size="sm" className="gap-1.5 h-8 text-xs" onClick={() => onReplyAll?.(message)}>
          <ReplyAll className="w-3.5 h-3.5" /> {t('replyAll')}
        </Button>
        <Button variant="ghost" size="sm" className="gap-1.5 h-8 text-xs" onClick={() => onForward?.(message)}>
          <Forward className="w-3.5 h-3.5" /> {t('forward')}
        </Button>
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="sm"
          className={cn('h-8 w-8 p-0', starred && 'text-yellow-500 hover:text-yellow-600')}
          onClick={handleStar}
        >
          <Star className={cn('w-3.5 h-3.5', starred && 'fill-current')} />
        </Button>
        <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
          <Archive className="w-3.5 h-3.5" />
        </Button>
        <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-destructive hover:text-destructive" onClick={handleDelete}>
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0"
          title="Créer une règle depuis ce message"
          onClick={() => {
            const params = new URLSearchParams({
              prefill_from: message.from.address,
              prefill_from_name: message.from.name,
              prefill_subject: message.subject,
              prefill_account: message.accountId,
            })
            window.location.href = `/settings/rules?${params.toString()}`
          }}
        >
          <Filter className="w-3.5 h-3.5" />
        </Button>
        <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
          <MoreHorizontal className="w-3.5 h-3.5" />
        </Button>
      </div>

      {/* Security banner */}
      <SecurityBanner message={message} />

      {/* Unsubscribe banner */}
      {message.listUnsubscribe && accountId && (
        <UnsubscribeBanner listUnsubscribe={message.listUnsubscribe} accountId={accountId} />
      )}

      {/* Attachments — above body */}
      {(message.attachments?.length ?? 0) > 0 && (
        <AttachmentSection
          attachments={message.attachments!}
          uid={uid!}
          accountId={accountId!}
          folder={folder}
        />
      )}

      {/* Body */}
      <div className="flex-1 overflow-y-auto min-h-0">
        <EmailBody message={message} />
      </div>
    </div>
  )
}
