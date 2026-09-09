'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import useSWR from 'swr'
import { useTranslations, useLocale } from 'next-intl'
import {
  Mail, Send, Eye, Clock, Sparkles, BarChart3, Users, Filter,
  PenSquare, RefreshCw, ArrowUpRight, Minus, CheckCheck,
  Paperclip, Star, FileText, AlarmClock, ChevronRight, ChevronDown, Check,
} from 'lucide-react'
import { cn } from '@/lib/utils'
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

function Card({
  className, icon, title, action, children, index = 0,
}: {
  className?: string
  icon?: React.ReactNode
  title?: React.ReactNode
  action?: React.ReactNode
  children: React.ReactNode
  index?: number
}) {
  return (
    <section
      className={cn(
        'rounded-2xl border border-border bg-card/80 p-[18px] shadow-sm backdrop-blur-sm',
        'motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:duration-500',
        className,
      )}
      style={{ animationDelay: `${index * 45}ms`, animationFillMode: 'backwards' }}
    >
      {(title || action) && (
        <div className="mb-3.5 flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
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

function ActivityChart({ data }: { data: ActivityPoint[] }) {
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

  return (
    <svg viewBox={`0 0 ${W} 172`} width="100%" style={{ aspectRatio: '600 / 172' }} role="img"
      aria-label="Received and sent, last 14 days">
      <defs>
        <linearGradient id="dash-rec" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#8b5cf6" stopOpacity="0.28" />
          <stop offset="1" stopColor="#8b5cf6" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="dash-sent" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3b82f6" stopOpacity="0.22" />
          <stop offset="1" stopColor="#3b82f6" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[46, 98, 150].map(gy => (
        <line key={gy} x1={padX} y1={gy} x2={W - padX} y2={gy} className="stroke-border" strokeWidth="1" />
      ))}
      <path d={area('received')} fill="url(#dash-rec)" />
      <path d={area('sent')} fill="url(#dash-sent)" />
      <path d={path('received')} fill="none" stroke="#8b5cf6" strokeWidth="2.4"
        strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      <path d={path('sent')} fill="none" stroke="#3b82f6" strokeWidth="2.4"
        strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      <circle cx={x(data.length - 1)} cy={y(last.received)} r="3.6" fill="#8b5cf6"
        className="stroke-card" strokeWidth="2" />
      <circle cx={x(data.length - 1)} cy={y(last.sent)} r="3.6" fill="#3b82f6"
        className="stroke-card" strokeWidth="2" />
    </svg>
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

export function DashboardClient() {
  const t = useTranslations('dashboard')
  const locale = useLocale()
  const router = useRouter()

  // Account scope — null = all accounts combined. Persisted per browser.
  const [filterAccount, setFilterAccount] = useState<string | null>(null)
  const [filterReady, setFilterReady] = useState(false)
  useEffect(() => {
    try {
      const stored = localStorage.getItem('synapmail:dashboardAccount')
      if (stored) setFilterAccount(stored)
    } catch { /* ignore */ }
    setFilterReady(true)
  }, [])
  const changeFilter = (id: string | null) => {
    setFilterAccount(id)
    try {
      if (id) localStorage.setItem('synapmail:dashboardAccount', id)
      else localStorage.removeItem('synapmail:dashboardAccount')
    } catch { /* ignore */ }
  }

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

  const openCompose = () => {
    router.push('/mail')
    window.setTimeout(() => window.dispatchEvent(new CustomEvent('synapmail:compose')), 350)
  }

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
  const totalRecv = d.activity.reduce((s, p) => s + p.received, 0)
  const half = Math.max(1, Math.round(d.activity.length / 2))
  const firstHalf = d.activity.slice(0, half).reduce((s, p) => s + p.received, 0)
  const secondHalf = d.activity.slice(half).reduce((s, p) => s + p.received, 0)
  const trafficPct = firstHalf > 0 ? Math.round(((secondHalf - firstHalf) / firstHalf) * 100) : 0
  const newToday = d.kpis.unreadToday
  const currentAccount = filterAccount ? d.accounts.find(a => a.id === filterAccount) ?? null : null
  const scoped = !!currentAccount

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

          <form
            onSubmit={e => {
              e.preventDefault()
              const q = new FormData(e.currentTarget).get('q')?.toString().trim()
              router.push(q ? `/mail?q=${encodeURIComponent(q)}` : '/mail')
            }}
            className="relative hidden max-w-[320px] flex-1 sm:block"
          >
            <input
              name="q"
              type="search"
              placeholder={t('searchPlaceholder')}
              className="h-9 w-full rounded-lg border border-border bg-card/70 pl-3 pr-3 text-sm outline-none backdrop-blur-sm focus-visible:ring-2 focus-visible:ring-violet-500"
            />
          </form>

          <button
            onClick={openCompose}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-gradient-to-br from-violet-500 to-blue-500 px-4 text-sm font-medium text-white shadow-sm transition hover:brightness-105"
          >
            <PenSquare className="h-4 w-4" /> {t('compose')}
          </button>
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
            sub={<span className="text-muted-foreground">{totalRecv > 0 ? `${totalRecv} ${t('activityReceived').toLowerCase()} / 14 j` : '—'}</span>}
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

        {/* bento */}
        <div
          aria-busy={isValidating}
          className={cn('grid grid-cols-12 gap-3.5 transition-opacity', isValidating && 'opacity-60')}
        >

          {/* Focus */}
          <Card
            index={0}
            className="col-span-12 bg-gradient-to-b from-card to-card/40 lg:col-span-6"
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
                      href={`/mail?folder=${encodeURIComponent(f.folder)}`}
                      className="grid grid-cols-[36px_1fr_auto] items-start gap-3 py-3 first:pt-1 last:pb-0"
                    >
                      <span
                        className="grid h-9 w-9 place-items-center rounded-[10px] font-mono text-[13px] font-semibold text-white"
                        style={{ background: f.accountColor }}
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
                              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: f.accountColor }} />
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

          {/* Activity */}
          <Card
            index={1}
            className="col-span-12 lg:col-span-6"
            icon={<BarChart3 className="h-[15px] w-[15px]" />}
            title={<span>{t('activityTitle')} <span className="font-normal text-muted-foreground">· {t('activityRange')}</span></span>}
            action={
              <span className={cn('rounded-full border border-border px-2 py-[3px] text-xs font-semibold',
                trafficPct >= 0 ? 'bg-violet-500/10 text-violet-600 dark:text-violet-400' : 'bg-muted text-muted-foreground')}>
                {t('trafficDelta', { sign: trafficPct >= 0 ? '+' : '−', percent: Math.abs(trafficPct) })}
              </span>
            }
          >
            <ActivityChart data={d.activity} />
            <div className="mt-1.5 flex gap-4 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[3px] bg-violet-500" /> {t('activityReceived')}</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[3px] bg-blue-500" /> {t('activitySent')}</span>
              <span className="ml-auto font-mono">{t('activityStart')}</span>
            </div>
          </Card>

          {/* Accounts */}
          <Card
            index={2}
            className="col-span-12 sm:col-span-6 lg:col-span-4"
            icon={<Mail className="h-[15px] w-[15px]" />}
            title={t('accountsTitle')}
            action={<Link href="/settings/accounts" className="text-xs font-medium text-muted-foreground hover:text-violet-500">{t('manage')}</Link>}
          >
            {d.accounts.length === 0 ? (
              <Empty>
                {t('accountsEmpty')}
                <Link href="/settings/accounts" className="mt-2 block text-violet-500 hover:underline">{t('addAccount')}</Link>
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
                            <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: a.color }} />
                            <span className="truncate">{a.name}</span>
                          </span>
                          <span className="font-mono text-sm font-semibold tabular-nums">{a.unread}</span>
                        </div>
                        <div className="truncate pl-3.5 font-mono text-xs text-muted-foreground">{a.email}</div>
                        <div className="mt-1.5 h-[5px] overflow-hidden rounded-full bg-muted">
                          <div className="h-full rounded-full" style={{ width: `${(a.unread / maxUnread) * 100}%`, background: a.color }} />
                        </div>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </Card>

          {/* Read receipts */}
          <Card
            index={3}
            className="col-span-12 sm:col-span-6 lg:col-span-4"
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
                            <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: r.accountColor ?? '#6366f1' }} />
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

          {/* Scheduled */}
          <Card
            index={4}
            className="col-span-12 sm:col-span-6 lg:col-span-4"
            icon={<Clock className="h-[15px] w-[15px]" />}
            title={t('scheduledTitle')}
            action={<Link href="/settings" className="text-xs font-medium text-muted-foreground hover:text-violet-500">{t('pendingCount', { count: d.kpis.scheduledPending })}</Link>}
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
                          <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: s.accountColor ?? '#6366f1' }} />
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

          {/* Rules */}
          <Card
            index={5}
            className="col-span-12 lg:col-span-8"
            icon={<Filter className="h-[15px] w-[15px]" />}
            title={<span>{t('rulesTitle')} <span className="font-normal text-muted-foreground">— {t('rulesActionsWeek', { count: d.rules.actions7d })}</span></span>}
            action={<span className="rounded-full border border-border bg-emerald-500/10 px-2 py-[3px] text-xs font-semibold text-emerald-600 dark:text-emerald-400">{t('rulesActive', { count: d.rules.activeCount })}</span>}
          >
            {d.rules.items.length === 0 ? (
              <Empty>
                {t('rulesEmpty')}
                <Link href="/settings/rules" className="mt-2 block text-violet-500 hover:underline">{t('rulesConfigure')}</Link>
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

          {/* Follow-ups */}
          <Card
            index={6}
            className="col-span-12 sm:col-span-6 lg:col-span-4"
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

          {/* Quick compose */}
          <Card
            index={7}
            className="col-span-12"
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
                { label: t('quickFromTemplate'), onClick: () => router.push('/settings/templates') },
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

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="py-6 text-center text-sm text-muted-foreground">{children}</p>
  )
}

function AccountFilter({
  accounts, value, onChange, allLabel,
}: {
  accounts: DashboardAccount[]
  value: string | null
  onChange: (id: string | null) => void
  allLabel: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const current = accounts.find(a => a.id === value) ?? null
  const rows: { id: string | null; label: string; email?: string; color?: string; unread?: number }[] = [
    { id: null, label: allLabel },
    ...accounts.map(a => ({ id: a.id, label: a.name, email: a.email, color: a.color, unread: a.unread })),
  ]

  return (
    <div ref={ref} className="relative mt-2 inline-block text-left">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="inline-flex items-center gap-2 rounded-lg border border-border bg-card/70 px-2.5 py-1.5 text-xs font-medium backdrop-blur-sm transition-colors hover:bg-card"
      >
        <span
          className={cn('h-2 w-2 shrink-0 rounded-full', !current && 'bg-gradient-to-br from-violet-500 to-blue-500')}
          style={current ? { background: current.color } : undefined}
        />
        {current ? current.name : allLabel}
        <ChevronDown className={cn('h-3.5 w-3.5 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute left-0 z-20 mt-1.5 w-64 overflow-hidden rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-lg"
        >
          {rows.map(row => {
            const selected = row.id === value
            return (
              <button
                key={row.id ?? '__all__'}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => { onChange(row.id); setOpen(false) }}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors',
                  selected ? 'bg-violet-500/10 text-violet-600 dark:text-violet-400' : 'hover:bg-muted',
                )}
              >
                <span
                  className={cn('h-2 w-2 shrink-0 rounded-full', !row.color && 'bg-gradient-to-br from-violet-500 to-blue-500')}
                  style={row.color ? { background: row.color } : undefined}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{row.label}</span>
                  {row.email && <span className="block truncate font-mono text-xs text-muted-foreground">{row.email}</span>}
                </span>
                {typeof row.unread === 'number' && row.unread > 0 && (
                  <span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">{row.unread}</span>
                )}
                {selected && <Check className="h-3.5 w-3.5 shrink-0" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function reasonLabel(t: ReturnType<typeof useTranslations>, r: FocusReason) {
  const key = `reason${r.charAt(0).toUpperCase()}${r.slice(1)}` as const
  return t(key)
}
