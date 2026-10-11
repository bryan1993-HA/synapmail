'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, usePathname } from 'next/navigation'
import { openCompose as openComposeFrom } from '@/lib/compose'
import { folderHref } from '@/app/(app)/mail/mailboxUrl'
import useSWR from 'swr'
import { SETTINGS_KEY, saveSettings } from '@/lib/settings'
import { useTranslations, useLocale } from 'next-intl'
import {
  Mail, Send, Eye, Clock, Sparkles, BarChart3, Users, Filter,
  PenSquare, RefreshCw, ArrowUpRight, Minus, CheckCheck,
  Paperclip, Star, FileText, AlarmClock, ChevronRight, ChevronDown, Check, MailX,
  GripVertical, Undo2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { ACCOUNTS_SETTINGS_HREF, SETTINGS_ROOT, SettingsLink } from '@/components/settings/SettingsSidebar'
import { AccountAvatar } from '@/components/layout/AccountAvatar'
import { AccountPickerFilter, AccountPickerText, useAccountPicker } from '@/components/layout/AccountPicker'
import { SubscriptionsCard } from './SubscriptionsCard'
import { ContextMenuSurface, type ContextMenuAnchor } from '@/components/ui/ContextMenu'
import { accountColor } from '@/lib/accountColor'
import {
  cardSpan, isDefaultCardOrder, moveCard, normalizeCardOrder, shiftCard,
  DASHBOARD_CARD_MIME, type DashboardCardId,
} from '@/lib/dashboardOrder'
import type { DashboardData, DashboardAccount, FocusReason, ActivityPoint } from '@/types/dashboard'

const fetcher = (url: string) => fetch(url).then(r => r.json())

/* ─── helpers ──────────────────────────────────────────────── */

function prefersReducedMotion() {
  return typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

function useCountUp(target: number, active: boolean) {
  const [value, setValue] = useState(0)
  const done = useRef(false)
  useEffect(() => {
    if (!active) return
    if (done.current || prefersReducedMotion()) { setValue(target); return }
    done.current = true
    let raf = 0
    const start = performance.now()
    const dur = 750
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / dur)
      setValue(Math.round(target * (1 - Math.pow(1 - p, 3))))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [active, target])
  return value
}

function initials(name: string | null, addr: string | null) {
  const src = (name || addr || '?').trim()
  const parts = src.split(/[\s@._-]+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return src.slice(0, 2).toUpperCase()
}

function daysSince(iso: string) {
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 86_400_000))
}

/* ─── skeleton ─────────────────────────────────────────────── */

function Skeleton() {
  return (
    <div className="animate-pulse space-y-3.5">
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map(i => <div key={i} className="h-[104px] rounded-2xl bg-muted/60" />)}
      </div>
      <div className="grid grid-cols-12 gap-3.5">
        <div className="col-span-12 h-72 rounded-2xl bg-muted/60 lg:col-span-6" />
        <div className="col-span-12 h-72 rounded-2xl bg-muted/60 lg:col-span-6" />
        <div className="col-span-12 h-60 rounded-2xl bg-muted/60 sm:col-span-6 lg:col-span-4" />
        <div className="col-span-12 h-60 rounded-2xl bg-muted/60 sm:col-span-6 lg:col-span-4" />
        <div className="col-span-12 h-60 rounded-2xl bg-muted/60 sm:col-span-6 lg:col-span-4" />
      </div>
    </div>
  )
}

/* ─── section shell ────────────────────────────────────────── */

/**
 * La poignée d'une carte : c'est ELLE qui arme le glissement, jamais la carte
 * entière — sinon le moindre balayage sur un titre partirait en déplacement et
 * le texte deviendrait insélectionnable. Au clavier elle porte le même geste
 * avec les flèches, parce qu'un déplacement réservé à la souris n'en est pas un.
 */
function CardHandle({
  label, hint, onShift,
}: {
  label: string
  hint: string
  onShift: (delta: number) => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={`${label} — ${hint}`}
      onKeyDown={e => {
        const delta = e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1
          : e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : 0
        if (delta === 0) return
        e.preventDefault()
        onShift(delta)
      }}
      className="grid h-7 w-6 shrink-0 cursor-grab place-items-center rounded-md text-muted-foreground/50 transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/50 active:cursor-grabbing"
    >
      <GripVertical className="h-4 w-4" />
    </button>
  )
}

function Card({
  className, icon, title, action, children, index = 0,
  cardId, handle, draggable, dragging, dropTarget,
  onDragStart, onDragOver, onDrop, onDragEnd,
}: {
  className?: string
  icon?: React.ReactNode
  title?: React.ReactNode
  action?: React.ReactNode
  children: React.ReactNode
  index?: number
  cardId?: DashboardCardId
  handle?: React.ReactNode
  draggable?: boolean
  dragging?: boolean
  dropTarget?: boolean
  onDragStart?: (e: React.DragEvent) => void
  onDragOver?: (e: React.DragEvent) => void
  onDrop?: (e: React.DragEvent) => void
  onDragEnd?: () => void
}) {
  return (
    <section
      data-dashboard-card={cardId}
      data-dashboard-rank={cardId ? index : undefined}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      className={cn(
        'rounded-2xl border border-border bg-card/80 p-[18px] shadow-sm backdrop-blur-sm',
        'motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:duration-500',
        dragging && 'opacity-50',
        dropTarget && 'ring-2 ring-violet-500/60',
        className,
      )}
      style={{ animationDelay: `${index * 45}ms`, animationFillMode: 'backwards' }}
    >
      {(title || action || handle) && (
        <div className="mb-3.5 flex items-center justify-between gap-3">
          <h2 className="flex min-w-0 items-center gap-2 text-sm font-semibold tracking-tight">
            {handle}
            {icon && (
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-violet-500/10 text-violet-600 dark:text-violet-400">
                {icon}
              </span>
            )}
            {title}
          </h2>
          {action}
        </div>
      )}
      {children}
    </section>
  )
}

/* ─── activity chart ───────────────────────────────────────── */

const REC_COLOR = '#8b5cf6'   // violet — reçus
const SENT_COLOR = '#10b981'  // emerald — envoyés

function ActivityChart({
  data, locale, recLabel, sentLabel,
}: {
  data: ActivityPoint[]
  locale: string
  recLabel: string
  sentLabel: string
}) {
  const [hover, setHover] = useState<number | null>(null)
  const W = 600, top = 22, base = 150
  const padX = 12
  const n = Math.max(1, data.length - 1)
  const max = Math.max(1, ...data.flatMap(d => [d.received, d.sent]))
  const x = (i: number) => padX + i * ((W - 2 * padX) / n)
  const y = (v: number) => base - (v / max) * (base - top)
  const path = (key: 'received' | 'sent') =>
    data.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(d[key]).toFixed(1)}`).join(' ')
  const area = (key: 'received' | 'sent') =>
    `${path(key)} L ${x(data.length - 1).toFixed(1)} ${base} L ${x(0).toFixed(1)} ${base} Z`
  const last = data[data.length - 1] ?? { received: 0, sent: 0 }
  const hv = hover != null ? data[hover] : null

  const fmtDay = (iso: string) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' })

  const leftPct = hover != null ? (x(hover) / W) * 100 : 0
  const tipTx = leftPct < 22 ? '0' : leftPct > 78 ? '-100%' : '-50%'

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} 172`} width="100%" style={{ aspectRatio: '600 / 172' }} role="img"
        aria-label={`${recLabel} / ${sentLabel} — 14 j`}>
        <defs>
          <linearGradient id="dash-rec" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={REC_COLOR} stopOpacity="0.28" />
            <stop offset="1" stopColor={REC_COLOR} stopOpacity="0" />
          </linearGradient>
          <linearGradient id="dash-sent" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={SENT_COLOR} stopOpacity="0.24" />
            <stop offset="1" stopColor={SENT_COLOR} stopOpacity="0" />
          </linearGradient>
        </defs>
        {[46, 98, 150].map(gy => (
          <line key={gy} x1={padX} y1={gy} x2={W - padX} y2={gy} className="stroke-border" strokeWidth="1" />
        ))}
        <path d={area('received')} fill="url(#dash-rec)" />
        <path d={area('sent')} fill="url(#dash-sent)" />
        <path d={path('received')} fill="none" stroke={REC_COLOR} strokeWidth="2.4"
          strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        <path d={path('sent')} fill="none" stroke={SENT_COLOR} strokeWidth="2.4"
          strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />

        {hover != null ? (
          <g>
            <line x1={x(hover)} y1={top - 6} x2={x(hover)} y2={base}
              className="stroke-border" strokeWidth="1" strokeDasharray="3 3" />
            <circle cx={x(hover)} cy={y(data[hover].received)} r="4" fill={REC_COLOR} className="stroke-card" strokeWidth="2" />
            <circle cx={x(hover)} cy={y(data[hover].sent)} r="4" fill={SENT_COLOR} className="stroke-card" strokeWidth="2" />
          </g>
        ) : (
          <g>
            <circle cx={x(data.length - 1)} cy={y(last.received)} r="3.6" fill={REC_COLOR} className="stroke-card" strokeWidth="2" />
            <circle cx={x(data.length - 1)} cy={y(last.sent)} r="3.6" fill={SENT_COLOR} className="stroke-card" strokeWidth="2" />
          </g>
        )}

        <rect x="0" y="0" width={W} height="172" fill="transparent" style={{ touchAction: 'pan-y' }}
          onPointerMove={e => {
            const r = e.currentTarget.getBoundingClientRect()
            const px = ((e.clientX - r.left) / r.width) * W
            const i = Math.round((px - padX) / ((W - 2 * padX) / n))
            setHover(Math.max(0, Math.min(data.length - 1, i)))
          }}
          onPointerLeave={() => setHover(null)}
        />
      </svg>

      {hv && (
        <div
          className="pointer-events-none absolute top-0 z-10 min-w-[128px] whitespace-nowrap rounded-lg border border-border bg-popover px-2.5 py-1.5 text-xs shadow-md"
          style={{ left: `${leftPct}%`, transform: `translateX(${tipTx})` }}
        >
          <div className="mb-1 font-medium capitalize text-foreground">{fmtDay(hv.date)}</div>
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <span className="h-2 w-2 rounded-[2px]" style={{ background: REC_COLOR }} />
            {recLabel}<span className="ml-auto font-mono font-semibold text-foreground">{hv.received}</span>
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-muted-foreground">
            <span className="h-2 w-2 rounded-[2px]" style={{ background: SENT_COLOR }} />
            {sentLabel}<span className="ml-auto font-mono font-semibold text-foreground">{hv.sent}</span>
          </div>
        </div>
      )}
    </div>
  )
}

/* ─── main ─────────────────────────────────────────────────── */

const REASON_STYLE: Record<FocusReason, string> = {
  invoice: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
  deadline: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20',
  reply: 'bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20',
  vip: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
  frequent: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20',
  starred: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
  attachment: 'bg-muted text-muted-foreground border-border',
}
const REASON_ICON: Record<FocusReason, React.ReactNode> = {
  invoice: <FileText className="h-3 w-3" />,
  deadline: <AlarmClock className="h-3 w-3" />,
  reply: <ChevronRight className="h-3 w-3" />,
  vip: <Star className="h-3 w-3" />,
  frequent: <Users className="h-3 w-3" />,
  starred: <Star className="h-3 w-3" />,
  attachment: <Paperclip className="h-3 w-3" />,
}

/** Le nom lisible d'une carte, pour la poignée. Même source d'identités que l'ordre. */
const CARD_LABEL_KEY: Record<DashboardCardId, string> = {
  focus: 'cardFocus',
  activity: 'cardActivity',
  accounts: 'cardAccounts',
  receipts: 'cardReceipts',
  scheduled: 'cardScheduled',
  rules: 'cardRules',
  followUps: 'cardFollowUps',
  subscriptions: 'cardSubscriptions',
  quickCompose: 'cardQuickCompose',
}

export function DashboardClient() {
  const t = useTranslations('dashboard')
  const locale = useLocale()
  const router = useRouter()
  const pathname = usePathname()

  // Account scope — null = all accounts combined. Persisted server-side per user.
  const { data: settingsRes, isLoading: settingsLoading } = useSWR<{
    data: { dashboard_account_id: string | null; dashboard_card_order: DashboardCardId[] | null }
  }>(SETTINGS_KEY, fetcher)
  const filterAccount = settingsRes?.data?.dashboard_account_id ?? null
  const filterReady = !settingsLoading
  const changeFilter = (id: string | null) => {
    void saveSettings({ dashboard_account_id: id })
  }

  // L'ordre des cartes vient du serveur et passe par la règle partagée : une valeur
  // abîmée ou incomplète ne peut donc pas faire disparaître une carte de l'écran.
  const cardOrder = useMemo(
    () => normalizeCardOrder(settingsRes?.data?.dashboard_card_order),
    [settingsRes],
  )
  const saveCardOrder = (order: DashboardCardId[] | null) => {
    void saveSettings({ dashboard_card_order: order })
  }
  const [draggedCard, setDraggedCard] = useState<DashboardCardId | null>(null)
  const [dropCard, setDropCard] = useState<DashboardCardId | null>(null)

  const swrKey = filterReady
    ? `/api/dashboard${filterAccount ? `?account=${filterAccount}` : ''}`
    : null
  const { data: res, error, isValidating, mutate } = useSWR<{ data: DashboardData }>(
    swrKey, fetcher, { revalidateOnFocus: false, keepPreviousData: true },
  )
  const { data: profileRes } = useSWR<{ data?: { name?: string } }>('/api/profile', fetcher, { revalidateOnFocus: false })
  const firstName = profileRes?.data?.name?.trim().split(/\s+/)[0]
  const d = res?.data

  const loaded = !!d

  // Drop a stale filter (deleted account): once a fetch settles, the API echoes the
  // scope it actually applied — if it ignored our account id, reset to "all".
  useEffect(() => {
    if (d && !isValidating && filterAccount && d.accountFilter !== filterAccount) {
      changeFilter(null)
    }
  }, [d, isValidating, filterAccount])

  const rel = useMemo(() => {
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
    return (iso: string) => {
      const diff = new Date(iso).getTime() - Date.now()
      const abs = Math.abs(diff)
      if (abs < 3_600_000) return rtf.format(Math.round(diff / 60_000), 'minute')
      if (abs < 86_400_000) return rtf.format(Math.round(diff / 3_600_000), 'hour')
      return rtf.format(Math.round(diff / 86_400_000), 'day')
    }
  }, [locale])

  const fmtTime = (iso: string) =>
    new Date(iso).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })

  const greeting = () => {
    const h = new Date().getHours()
    if (h < 6) return t('greetingNight')
    if (h < 12) return t('greetingMorning')
    if (h < 18) return t('greetingAfternoon')
    return t('greetingEvening')
  }

  const openCompose = () => openComposeFrom(pathname, router.push)

  const unread = useCountUp(d?.kpis.unreadTotal ?? 0, loaded)
  const sent = useCountUp(d?.kpis.sentToday ?? 0, loaded)
  const opens = useCountUp(d?.kpis.trackedOpens7d ?? 0, loaded)
  const scheduled = useCountUp(d?.kpis.scheduledPending ?? 0, loaded)

  if (!d && !error) {
    return (
      <div className="relative flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1240px] px-5 py-7 sm:px-6"><Skeleton /></div>
      </div>
    )
  }

  if (error || !d) {
    return (
      <div className="relative flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-md flex-col items-center gap-3 px-5 py-24 text-center">
          <BarChart3 className="h-6 w-6 text-muted-foreground/60" />
          <p className="text-sm text-muted-foreground">{t('loadError')}</p>
          <button
            onClick={() => mutate()}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
          >
            <RefreshCw className="h-3.5 w-3.5" /> {t('retry')}
          </button>
        </div>
      </div>
    )
  }

  const maxUnread = Math.max(1, ...d.accounts.map(a => a.unread))
  const maxRule = Math.max(1, ...d.rules.items.map(r => r.matched7d))
  const totalSent = d.activity.reduce((s, p) => s + p.sent, 0)
  const half = Math.max(1, Math.round(d.activity.length / 2))
  const firstHalf = d.activity.slice(0, half).reduce((s, p) => s + p.received, 0)
  const secondHalf = d.activity.slice(half).reduce((s, p) => s + p.received, 0)
  const trafficPct = firstHalf > 0 ? Math.round(((secondHalf - firstHalf) / firstHalf) * 100) : 0
  const newToday = d.kpis.unreadToday
  const currentAccount = filterAccount ? d.accounts.find(a => a.id === filterAccount) ?? null : null
  const scoped = !!currentAccount

  /**
   * Ce qu'une carte reçoit pour être déplaçable : son rang d'affichage, sa
   * largeur (depuis la source unique), la poignée, et le dépôt. Un seul endroit :
   * neuf cartes ne peuvent pas diverger sur la façon d'être saisies.
   */
  const cardProps = (id: DashboardCardId) => ({
    cardId: id,
    index: cardOrder.indexOf(id),
    className: cardSpan(id),
    draggable: true,
    dragging: draggedCard === id,
    dropTarget: dropCard === id && draggedCard !== id,
    handle: (
      <CardHandle
        label={t('cardOrderHandle', { card: t(CARD_LABEL_KEY[id]) })}
        hint={t('cardOrderHint')}
        onShift={delta => saveCardOrder(shiftCard(cardOrder, id, delta))}
      />
    ),
    onDragStart: (e: React.DragEvent) => {
      // L'identité voyage DANS le geste : au survol le navigateur ne laisse lire
      // que les types, et l'état React n'est pas encore à jour quand le premier
      // `dragover` arrive.
      e.dataTransfer.setData(DASHBOARD_CARD_MIME, id)
      e.dataTransfer.effectAllowed = 'move'
      setDraggedCard(id)
    },
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes(DASHBOARD_CARD_MIME)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      setDropCard(id)
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault()
      const from = e.dataTransfer.getData(DASHBOARD_CARD_MIME) as DashboardCardId
      if (from && from !== id) saveCardOrder(moveCard(cardOrder, from, id))
      setDraggedCard(null)
      setDropCard(null)
    },
    onDragEnd: () => { setDraggedCard(null); setDropCard(null) },
  })

  // Chaque carte, sous son identité. Le RANG ne vit plus ici : il vient de `cardOrder`,
  // si bien qu'un déplacement ne déplace aucune ligne de ce fichier.
  const cards: Record<DashboardCardId, React.ReactNode> = {
    focus: (
      <Card
        {...cardProps('focus')}
        className="bg-gradient-to-b from-card to-card/40"
        icon={<Sparkles className="h-[15px] w-[15px]" />}
        title={<span>{t('focusTitle')} <span className="font-normal text-muted-foreground">— {t('focusSubtitle')}</span></span>}
        action={<Link href="/mail" className="text-xs font-medium text-muted-foreground hover:text-violet-500">{t('viewAll')}</Link>}
      >
        {d.focus.length === 0 ? (
          <Empty>{t('focusEmpty')}</Empty>
        ) : (
          <ul className="divide-y divide-border">
            {d.focus.map(f => (
              <li key={`${f.accountId}-${f.uid}`}>
                <Link
                  href={folderHref(f.folder)}
                  prefetch={false}
                  className="grid grid-cols-[36px_1fr_auto] items-start gap-3 py-3 first:pt-1 last:pb-0"
                >
                  <span
                    className="grid h-9 w-9 place-items-center rounded-[10px] font-mono text-[13px] font-semibold text-white"
                    style={{ background: colorOf(d.accounts, f.accountId) ?? undefined }}
                  >
                    {initials(f.fromName, f.fromAddress)}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">{f.subject || t('from')}</span>
                    <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-[2px] font-semibold', REASON_STYLE[f.reason])}>
                        {REASON_ICON[f.reason]}{reasonLabel(t, f.reason)}
                      </span>
                      {!scoped && f.accountName && (
                        <span className="inline-flex items-center gap-1">
                          <AccountBubble accounts={d.accounts} id={f.accountId} />
                          {f.accountName}
                        </span>
                      )}
                      <span className="truncate">{f.fromName || f.fromAddress}</span>
                    </span>
                  </span>
                  <span className="whitespace-nowrap font-mono text-xs text-muted-foreground">{rel(f.date)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    ),
    activity: (
      <Card
        {...cardProps('activity')}
        icon={<BarChart3 className="h-[15px] w-[15px]" />}
        title={<span>{t('activityTitle')} <span className="font-normal text-muted-foreground">· {t('activityRange')}</span></span>}
        action={
          <span className={cn('rounded-full border border-border px-2 py-[3px] text-xs font-semibold',
            trafficPct >= 0 ? 'bg-violet-500/10 text-violet-600 dark:text-violet-400' : 'bg-muted text-muted-foreground')}>
            {t('trafficDelta', { sign: trafficPct >= 0 ? '+' : '−', percent: Math.abs(trafficPct) })}
          </span>
        }
      >
        <ActivityChart
          data={d.activity}
          locale={locale}
          recLabel={t('activityReceived')}
          sentLabel={t('activitySent')}
        />
        <div className="mt-1.5 flex gap-4 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[3px] bg-violet-500" /> {t('activityReceived')}</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[3px] bg-emerald-500" /> {t('activitySent')}</span>
          <span className="ml-auto font-mono">{t('activityStart')}</span>
        </div>
      </Card>
    ),
    accounts: (
      <Card
        {...cardProps('accounts')}
        icon={<Mail className="h-[15px] w-[15px]" />}
        title={t('accountsTitle')}
        action={<SettingsLink href={ACCOUNTS_SETTINGS_HREF} className="text-xs font-medium text-muted-foreground hover:text-violet-500">{t('manage')}</SettingsLink>}
      >
        {d.accounts.length === 0 ? (
          <Empty>
            {t('accountsEmpty')}
            <SettingsLink href={ACCOUNTS_SETTINGS_HREF} className="mt-2 block text-violet-500 hover:underline">{t('addAccount')}</SettingsLink>
          </Empty>
        ) : (
          <ul className="-mx-2 space-y-0.5">
            {d.accounts.map(a => {
              const active = filterAccount === a.id
              return (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => changeFilter(active ? null : a.id)}
                    aria-pressed={active}
                    className={cn(
                      'w-full rounded-lg px-2 py-2 text-left transition-colors',
                      active ? 'bg-violet-500/10 ring-1 ring-inset ring-violet-500/40' : 'hover:bg-muted',
                    )}
                  >
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span className="flex min-w-0 items-center gap-2 font-semibold">
                        <AccountBubble accounts={d.accounts} id={a.id} />
                        <span className="truncate">{a.name}</span>
                      </span>
                      <span className="font-mono text-sm font-semibold tabular-nums">{a.unread}</span>
                    </div>
                    <div className="truncate pl-3.5 font-mono text-xs text-muted-foreground">{a.email}</div>
                    <div className="mt-1.5 h-[5px] overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full" style={{ width: `${(a.unread / maxUnread) * 100}%`, background: colorOf(d.accounts, a.id) ?? undefined }} />
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </Card>
    ),
    receipts: (
      <Card
        {...cardProps('receipts')}
        icon={<Eye className="h-[15px] w-[15px]" />}
        title={t('receiptsTitle')}
        action={<Link href="/mail?folder=Sent" className="text-xs font-medium text-muted-foreground hover:text-violet-500">{t('history')}</Link>}
      >
        {d.receipts.length === 0 ? (
          <Empty>{t('receiptsEmpty')}</Empty>
        ) : (
          <ul className="divide-y divide-border">
            {d.receipts.map((r, i) => (
              <li key={i} className="grid grid-cols-[24px_1fr_auto] items-start gap-2.5 py-2.5 first:pt-0 last:pb-0">
                <span className="grid h-6 w-6 place-items-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                  <CheckCheck className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">{r.subject || '—'}</span>
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    {!scoped && r.accountName && (
                      <>
                        <AccountBubble accounts={d.accounts} id={r.accountId} />
                        <span className="shrink-0">{r.accountName} ·</span>
                      </>
                    )}
                    <span className="truncate">
                      {r.sentTo}{r.openCount > 1 && ` · ${t('reopened', { count: r.openCount })}`}
                    </span>
                  </span>
                </span>
                <span className="whitespace-nowrap font-mono text-xs text-muted-foreground">{rel(r.openedAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    ),
    scheduled: (
      <Card
        {...cardProps('scheduled')}
        icon={<Clock className="h-[15px] w-[15px]" />}
        title={t('scheduledTitle')}
        action={<SettingsLink href={SETTINGS_ROOT} className="text-xs font-medium text-muted-foreground hover:text-violet-500">{t('pendingCount', { count: d.kpis.scheduledPending })}</SettingsLink>}
      >
        {d.scheduled.length === 0 ? (
          <Empty>{t('scheduledEmpty')}</Empty>
        ) : (
          <ol className="relative space-y-1 pl-[18px] before:absolute before:inset-y-1.5 before:left-1 before:w-[2px] before:bg-border">
            {d.scheduled.map(s => (
              <li key={s.id} className="relative py-2 before:absolute before:-left-[18px] before:top-[13px] before:h-[9px] before:w-[9px] before:rounded-full before:bg-violet-500 before:shadow-[0_0_0_4px_rgba(139,92,246,0.15)]">
                <div className="font-mono text-xs font-semibold text-violet-600 dark:text-violet-400">
                  {new Date(s.sendAt).toLocaleString(locale, { weekday: 'short', hour: '2-digit', minute: '2-digit' })}
                </div>
                <div className="truncate text-sm font-semibold">{s.subject}</div>
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  {!scoped && s.accountName && (
                    <>
                      <AccountBubble accounts={d.accounts} id={s.accountId} />
                      <span className="shrink-0">{s.accountName} ·</span>
                    </>
                  )}
                  <span className="truncate">→ {s.to[0]}{s.to.length > 1 && ` +${s.to.length - 1}`}</span>
                </div>
              </li>
            ))}
          </ol>
        )}
      </Card>
    ),
    rules: (
      <Card
        {...cardProps('rules')}
        icon={<Filter className="h-[15px] w-[15px]" />}
        title={<span>{t('rulesTitle')} <span className="font-normal text-muted-foreground">— {t('rulesActionsWeek', { count: d.rules.actions7d })}</span></span>}
        action={<span className="rounded-full border border-border bg-emerald-500/10 px-2 py-[3px] text-xs font-semibold text-emerald-600 dark:text-emerald-400">{t('rulesActive', { count: d.rules.activeCount })}</span>}
      >
        {d.rules.items.length === 0 ? (
          <Empty>
            {t('rulesEmpty')}
            <SettingsLink href={`${SETTINGS_ROOT}/rules`} className="mt-2 block text-violet-500 hover:underline">{t('rulesConfigure')}</SettingsLink>
          </Empty>
        ) : (
          <ul className="space-y-2.5">
            {d.rules.items.map(r => (
              <li key={r.id}>
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className={cn('truncate font-medium', !r.enabled && 'text-muted-foreground line-through')}>{r.name}</span>
                  <span className="shrink-0 font-mono text-xs font-semibold text-muted-foreground tabular-nums">{r.matched7d}</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-blue-500" style={{ width: `${(r.matched7d / maxRule) * 100}%` }} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    ),
    followUps: (
      <Card
        {...cardProps('followUps')}
        icon={<Users className="h-[15px] w-[15px]" />}
        title={t('followUpTitle')}
      >
        {d.followUps.length === 0 ? (
          <Empty>{t('followUpEmpty')}</Empty>
        ) : (
          <ul className="divide-y divide-border">
            {d.followUps.map((c, i) => (
              <li key={i} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] bg-muted font-mono text-xs font-semibold">
                  {initials(c.name, c.email)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{c.name || c.email}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {t('followUpMeta', { days: daysSince(c.lastContactAt), count: c.frequency })}
                  </span>
                </span>
                <button
                  onClick={openCompose}
                  className="shrink-0 rounded-lg border border-border bg-violet-500/10 px-2.5 py-1.5 text-xs font-semibold text-violet-600 dark:text-violet-400 hover:bg-violet-500/20"
                >
                  {t('write')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    ),
    subscriptions: (
      <SubscriptionsCard
        accounts={d.accounts}
        filterAccount={filterAccount}
        renderCard={({ title, action, children }) => (
          <Card
            {...cardProps('subscriptions')}
            icon={<MailX className="h-[15px] w-[15px]" />}
            title={title}
            action={action}
          >
            {children}
          </Card>
        )}
      />
    ),
    quickCompose: (
      <Card
        {...cardProps('quickCompose')}
        icon={<PenSquare className="h-[15px] w-[15px]" />}
        title={t('quickComposeTitle')}
      >
        <button
          onClick={openCompose}
          className="flex w-full items-center gap-2.5 rounded-xl border border-dashed border-border bg-card/60 px-3 py-3 text-left text-sm text-muted-foreground hover:border-violet-500/40"
        >
          <Mail className="h-4 w-4" />
          {t('quickComposePlaceholder')}
          <span className="ml-auto text-xs">
            {d.accounts[0] && t('quickComposeFrom', { account: d.accounts[0].name })}
          </span>
        </button>
        <div className="mt-3 flex flex-wrap gap-2">
          {[
            { label: t('quickNewMessage'), onClick: openCompose },
            { label: t('quickFromTemplate'), onClick: () => router.push(`${SETTINGS_ROOT}/templates`) },
            { label: t('quickSchedule'), onClick: openCompose },
          ].map(chip => (
            <button
              key={chip.label}
              onClick={chip.onClick}
              className="rounded-lg border border-border bg-card/60 px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              {chip.label}
            </button>
          ))}
        </div>
      </Card>
    ),
  }


  return (
    <div className="relative flex-1 overflow-y-auto">
      {/* ambient mesh */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden opacity-70">
        <div
          className="absolute -left-[14vw] -top-[18vw] h-[52vw] w-[52vw] rounded-full blur-[90px]"
          style={{ background: 'radial-gradient(circle at 30% 30%, rgba(139,92,246,0.20), transparent 70%)' }}
        />
        <div
          className="absolute -bottom-[16vw] -right-[12vw] h-[44vw] w-[44vw] rounded-full blur-[90px]"
          style={{ background: 'radial-gradient(circle at 60% 60%, rgba(59,130,246,0.18), transparent 70%)' }}
        />
      </div>

      <div className="relative mx-auto max-w-[1240px] px-5 py-7 sm:px-6">
        {/* header */}
        <header className="mb-6 flex flex-wrap items-center gap-4">
          <div className="mr-auto">
            <h1 className="text-xl font-bold tracking-tight">
              {greeting()}{firstName ? <span className="font-medium text-muted-foreground">, {firstName}</span> : null}
            </h1>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {currentAccount
                ? currentAccount.email
                : t('accountsConnected', { count: d.accounts.length })} · {t('lastSync')}
            </p>
            {d.accounts.length > 1 && (
              <AccountFilter
                accounts={d.accounts}
                value={filterAccount}
                onChange={changeFilter}
                allLabel={t('allAccounts')}
              />
            )}
          </div>

          <button
            onClick={openCompose}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-gradient-to-br from-violet-500 to-blue-500 px-4 text-sm font-medium text-white shadow-sm transition hover:brightness-105"
          >
            <PenSquare className="h-4 w-4" /> {t('compose')}
          </button>
          {!isDefaultCardOrder(cardOrder) && (
            <button
              onClick={() => saveCardOrder(null)}
              aria-label={t('cardOrderReset')}
              title={t('cardOrderReset')}
              data-dashboard-order-reset
              className="grid h-9 w-9 place-items-center rounded-lg border border-border bg-card/70 text-muted-foreground backdrop-blur-sm transition hover:text-foreground"
            >
              <Undo2 className="h-4 w-4" />
            </button>
          )}
          <button
            onClick={() => mutate()}
            aria-label={t('refresh')}
            className="grid h-9 w-9 place-items-center rounded-lg border border-border bg-card/70 text-muted-foreground backdrop-blur-sm transition hover:text-foreground"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </header>

        {/* KPI strip */}
        <div
          aria-busy={isValidating}
          className={cn(
            'mb-3.5 grid grid-cols-1 gap-3.5 transition-opacity sm:grid-cols-2 lg:grid-cols-4',
            isValidating && 'opacity-60',
          )}
        >
          <Kpi
            index={0} accent="bg-violet-500" icon={<Mail className="h-3.5 w-3.5" />}
            label={t('kpiUnread')} value={unread}
            sub={
              newToday > 0 ? (
                <span className="inline-flex items-center gap-1 text-violet-600 dark:text-violet-400">
                  <ArrowUpRight className="h-3.5 w-3.5" />{t('newToday', { count: newToday })}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-muted-foreground">
                  <Minus className="h-3.5 w-3.5" />{t('upToDate')}
                </span>
              )
            }
          />
          <Kpi
            index={1} accent="bg-blue-500" icon={<Send className="h-3.5 w-3.5" />}
            label={t('kpiSent')} value={sent}
            sub={<span className="text-muted-foreground">{totalSent > 0 ? `${totalSent} ${t('activitySent').toLowerCase()} / 14 j` : '—'}</span>}
          />
          <Kpi
            index={2} accent="bg-emerald-500" icon={<Eye className="h-3.5 w-3.5" />}
            label={t('kpiOpens')} value={opens}
            sub={<span className="text-emerald-600 dark:text-emerald-400">{t('opensToday', { count: d.kpis.trackedOpensToday })}</span>}
          />
          <Kpi
            index={3} accent="bg-amber-500" icon={<Clock className="h-3.5 w-3.5" />}
            label={t('kpiScheduled')} value={scheduled}
            sub={
              <span className="text-muted-foreground">
                {d.kpis.nextScheduledAt ? t('nextAt', { time: fmtTime(d.kpis.nextScheduledAt) }) : t('noneScheduled')}
              </span>
            }
          />
        </div>

        {/* bento — l'ordre vient de `cardOrder`, pas de la position dans ce fichier */}
        <div
          aria-busy={isValidating}
          className={cn('grid grid-cols-12 gap-3.5 transition-opacity', isValidating && 'opacity-60')}
        >
          {cardOrder.map(id => <React.Fragment key={id}>{cards[id]}</React.Fragment>)}
        </div>
      </div>
    </div>
  )
}

/* ─── small pieces ─────────────────────────────────────────── */

function Kpi({
  index, accent, icon, label, value, sub,
}: {
  index: number
  accent: string
  icon: React.ReactNode
  label: string
  value: number
  sub: React.ReactNode
}) {
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-2xl border border-border bg-card/80 p-4 shadow-sm backdrop-blur-sm',
        'motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:duration-500',
      )}
      style={{ animationDelay: `${index * 45}ms`, animationFillMode: 'backwards' }}
    >
      <span className={cn('absolute inset-y-0 left-0 w-[3px]', accent)} />
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        {icon}{label}
      </div>
      <div className="mt-2 font-mono text-[28px] font-semibold leading-none tracking-tight tabular-nums">
        {value}
      </div>
      <div className="mt-2 text-xs font-medium">{sub}</div>
    </div>
  )
}

/**
 * La boîte que porte une ligne, cherchée par son identifiant. `null` quand la ligne n'en
 * porte pas, ou quand elle en nomme une que cet écran ne liste pas. Tout ce qui peint une
 * boîte ici passe par elle, puis par SON rang (`account.rank`) : celui que le serveur a
 * calculé sur la liste partagée (boîtes possédées + partages actifs), jamais l'index dans
 * la liste de cet écran. Celle-ci ne montre que les boîtes possédées, donc un index local
 * glisserait d'un cran par boîte partagée et repeindrait la même boîte d'une autre couleur
 * que la barre latérale et les réglages — c'est le défaut mesuré au banc le 20/09/2026.
 */
const accountOf = (accounts: DashboardAccount[], id: string | null) =>
  (id ? accounts.find(a => a.id === id) ?? null : null)

/**
 * La couleur d'une boîte, pour ce que le tableau de bord peint À CÔTÉ de sa bulle
 * (la vignette d'un expéditeur, une barre de proportion) : exactement la même
 * fonction que la bulle elle-même, donc jamais une seconde teinte pour la même boîte.
 */
const colorOf = (accounts: DashboardAccount[], id: string | null) => {
  const account = accountOf(accounts, id)
  return account ? accountColor(account, account.rank) : null
}

/**
 * La bulle d'une boîte, sur une ligne du tableau de bord. Elle ne dessine RIEN :
 * c'est `AccountAvatar`, celui de la barre latérale, nourri du rang de la boîte —
 * donc les mêmes initiales et la même couleur des deux côtés de l'écran.
 */
function AccountBubble({ accounts, id }: { accounts: DashboardAccount[]; id: string | null }) {
  const account = accountOf(accounts, id)
  // Une ligne sans boîte (l'enregistrement n'en porte pas) ne montre RIEN plutôt
  // qu'un repli qui ferait croire à une vraie boîte.
  if (!account) return null
  return <AccountAvatar account={account} colorIndex={account.rank} size="xs" />
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="py-6 text-center text-sm text-muted-foreground">{children}</p>
  )
}

/** Écart entre le bas du bouton et le haut de la liste qu'il ouvre, en px. */
const PICKER_GAP = 4

/**
 * Le sélecteur de boîte du tableau de bord. Il ne recode RIEN : la bulle, le texte,
 * le filtre et son clavier viennent du composant partagé avec la barre latérale
 * (`components/layout/AccountPicker.tsx`), et la surface qui les porte est celle des
 * autres menus de l'application (`ContextMenuSurface` : portail, maintien dans
 * l'écran, fermeture en UN clic qui atteint sa cible). Ce qui lui est propre tient
 * en une chose : l'entrée « Toutes les boîtes » en tête.
 */
function AccountFilter({
  accounts, value, onChange, allLabel,
}: {
  accounts: DashboardAccount[]
  value: string | null
  onChange: (id: string | null) => void
  allLabel: string
}) {
  const [anchor, setAnchor] = useState<ContextMenuAnchor | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const open = anchor !== null

  const pick = (id: string | null) => {
    onChange(id)
    setAnchor(null)
  }

  const {
    filter, setFilter, filtered, highlight, showFilter, inputRef, onKeyDown,
  } = useAccountPicker({ open, accounts, onPick: pick })

  // La liste s'ouvre SOUS le bouton et alignée sur son bord gauche ; la surface
  // partagée se charge ensuite de la garder dans l'écran.
  const toggle = () => {
    if (open) { setAnchor(null); return }
    const box = triggerRef.current?.getBoundingClientRect()
    if (box) setAnchor({ x: box.left, y: box.bottom + PICKER_GAP })
  }

  const current = accountOf(accounts, value)

  const row = (
    id: string | null,
    selected: boolean,
    highlighted: boolean,
    body: React.ReactNode,
  ) => (
    <button
      key={id ?? 'all'}
      type="button"
      role="option"
      aria-selected={selected}
      onClick={() => pick(id)}
      data-account-highlight={highlighted ? 'true' : undefined}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors',
        selected ? 'bg-violet-500/10 text-violet-600 dark:text-violet-400' : 'hover:bg-muted',
        highlighted && !selected && 'bg-foreground/[0.06]',
      )}
    >
      {body}
      {selected && <Check className="h-3.5 w-3.5 shrink-0" />}
    </button>
  )

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        aria-haspopup="listbox"
        aria-expanded={open}
        data-dashboard-account-trigger
        className="mt-2 inline-flex items-center gap-2 rounded-lg border border-border bg-card/70 px-2.5 py-1.5 text-xs font-medium backdrop-blur-sm transition-colors hover:bg-card"
      >
        {current
          ? <AccountAvatar account={current} colorIndex={current.rank} size="sm" />
          : <Filter className="h-3.5 w-3.5 text-muted-foreground" />}
        {current ? current.name : allLabel}
        <ChevronDown className={cn('h-3.5 w-3.5 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>

      {anchor && (
        <ContextMenuSurface
          anchor={anchor}
          onClose={() => setAnchor(null)}
          ignoreRef={triggerRef}
          role="listbox"
          data-dashboard-account-list
          // La surface place et ferme ; la classe n'ajoute que la LARGEUR des lignes
          // de boîte. `fixed z-[100]` est répété parce qu'un `className` passé à la
          // surface REMPLACE le sien : `components/ui/ContextMenu.tsx` est tenu hors
          // de ce lot (la lane `search` le corrige au lot S7), donc pas de fusion ici.
          className="fixed z-[100] w-72 rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-xl"
        >
          {showFilter && (
            <div className="p-1">
              <AccountPickerFilter
                value={filter}
                onChange={setFilter}
                onKeyDown={onKeyDown}
                inputRef={inputRef}
              />
            </div>
          )}
          {row(
            null,
            value === null,
            false,
            <>
              <Filter className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate font-medium">{allLabel}</span>
            </>,
          )}
          {filtered.map((a, i) => row(
            a.id,
            a.id === value,
            i === highlight,
            <>
              <AccountAvatar account={a} colorIndex={a.rank} unread={a.unread} size="sm" />
              <AccountPickerText account={a} />
            </>,
          ))}
        </ContextMenuSurface>
      )}
    </>
  )
}

function reasonLabel(t: ReturnType<typeof useTranslations>, r: FocusReason) {
  const key = `reason${r.charAt(0).toUpperCase()}${r.slice(1)}` as const
  return t(key)
}
