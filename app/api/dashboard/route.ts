import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { query } from '@/lib/db'
import type {
  DashboardData, ActivityPoint,
} from '@/types/dashboard'
import { scoreFocus } from '@/lib/focus'

export const dynamic = 'force-dynamic'

// Folder-name fragments that must NOT count as "inbox" mail.
const NON_INBOX = `(mc.folder ILIKE '%trash%' OR mc.folder ILIKE '%sent%' OR mc.folder ILIKE '%junk%'
  OR mc.folder ILIKE '%spam%' OR mc.folder ILIKE '%draft%' OR mc.folder ILIKE '%archive%')`

type CountRow = { n: string }
type UnreadRow = { account_id: string; n: string }
type ActivityRow = { d: string; received: string; sent: string }
type FocusRow = {
  uid: string; account_id: string; folder: string; subject: string | null
  from_name: string | null; from_address: string | null; date: string
  is_starred: boolean; has_attachments: boolean
}
type AccountRow = { id: string; name: string; email: string; color: string }
type ContactRow = { email: string; frequency: number; is_starred: boolean }
type ReceiptRow = {
  subject: string | null; sent_to: string; opened_at: string; open_count: number
  account_name: string | null; account_color: string | null
}
type ScheduledRow = {
  id: string; subject: string; to_addresses: string; send_at: string
  account_name: string | null; account_color: string | null
}
type RuleRow = { id: string; name: string; enabled: boolean; matched_7d: string }
type FollowUpRow = { name: string; email: string; frequency: number; last_contact_at: string }

export async function GET(req: Request) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    // Optional ?account=<id> — narrows every widget except the account list and
    // contacts (contacts carry no per-account dimension in the schema).
    const requested = new URL(req.url).searchParams.get('account')
    let acct: string | null = null
    if (requested) {
      const owned = await query<{ id: string }>(
        'SELECT id FROM email_accounts WHERE id = $1 AND user_id = $2 LIMIT 1',
        [requested, userId],
      )
      acct = owned[0]?.id ?? null
    }

    const P = acct ? [userId, acct] : [userId]
    const byEa = acct ? 'AND ea.id = $2' : ''        // queries joined to email_accounts ea
    const byCol = acct ? 'AND account_id = $2' : ''   // queries directly on a table with account_id
    const byRule = acct ? 'AND r.account_id = $2' : ''

    const [
      accounts,
      unreadAllRows,
      unreadTodayRow,
      sentTodayRow,
      opens7dRow,
      opensTodayRow,
      scheduledCountRow,
      nextScheduledRow,
      activityRows,
      focusRows,
      contactRows,
      receiptRows,
      scheduledRows,
      ruleRows,
      followUpRows,
    ] = await Promise.all([
      query<AccountRow>(
        `SELECT id, name, email, color FROM email_accounts
         WHERE user_id = $1 ORDER BY is_default DESC, created_at ASC`,
        [userId]
      ),
      // Always global — feeds the account list / switcher context.
      query<UnreadRow>(
        `SELECT mc.account_id, COUNT(*)::text AS n
         FROM messages_cache mc JOIN email_accounts ea ON ea.id = mc.account_id
         WHERE ea.user_id = $1 AND mc.is_read = false AND NOT ${NON_INBOX}
         GROUP BY mc.account_id`,
        [userId]
      ),
      query<CountRow>(
        `SELECT COUNT(*)::text AS n
         FROM messages_cache mc JOIN email_accounts ea ON ea.id = mc.account_id
         WHERE ea.user_id = $1 AND mc.is_read = false AND NOT ${NON_INBOX}
           AND mc.date >= date_trunc('day', now()) ${byEa}`,
        P
      ),
      query<CountRow>(
        `SELECT COUNT(*)::text AS n
         FROM messages_cache mc JOIN email_accounts ea ON ea.id = mc.account_id
         WHERE ea.user_id = $1 AND mc.folder ILIKE '%sent%'
           AND mc.date >= date_trunc('day', now()) ${byEa}`,
        P
      ),
      query<CountRow>(
        `SELECT COUNT(*)::text AS n FROM sent_tracking
         WHERE user_id = $1 AND opened_at >= now() - interval '7 days' ${byCol}`,
        P
      ),
      query<CountRow>(
        `SELECT COUNT(*)::text AS n FROM sent_tracking
         WHERE user_id = $1 AND opened_at >= date_trunc('day', now()) ${byCol}`,
        P
      ),
      query<CountRow>(
        `SELECT COUNT(*)::text AS n FROM scheduled_emails
         WHERE user_id = $1 AND status = 'pending' ${byCol}`,
        P
      ),
      query<{ send_at: string }>(
        `SELECT send_at FROM scheduled_emails
         WHERE user_id = $1 AND status = 'pending' ${byCol} ORDER BY send_at ASC LIMIT 1`,
        P
      ),
      query<ActivityRow>(
        `SELECT date_trunc('day', mc.date) AS d,
                COUNT(*) FILTER (WHERE mc.folder NOT ILIKE '%sent%')::text AS received,
                COUNT(*) FILTER (WHERE mc.folder ILIKE '%sent%')::text AS sent
         FROM messages_cache mc JOIN email_accounts ea ON ea.id = mc.account_id
         WHERE ea.user_id = $1 AND mc.date >= date_trunc('day', now()) - interval '13 days' ${byEa}
         GROUP BY 1 ORDER BY 1`,
        P
      ),
      query<FocusRow>(
        `SELECT mc.uid, mc.account_id, mc.folder, mc.subject, mc.from_name, mc.from_address,
                mc.date, mc.is_starred, mc.has_attachments
         FROM messages_cache mc JOIN email_accounts ea ON ea.id = mc.account_id
         WHERE ea.user_id = $1 AND mc.is_read = false AND NOT ${NON_INBOX} ${byEa}
           AND NOT EXISTS (
             SELECT 1 FROM snoozed_messages sm
             WHERE sm.account_id = mc.account_id AND sm.folder = mc.folder
               AND sm.uid = mc.uid AND sm.snooze_until > now()
           )
         ORDER BY mc.date DESC LIMIT 60`,
        P
      ),
      query<ContactRow>(
        `SELECT email, frequency, is_starred FROM contacts WHERE user_id = $1`,
        [userId]
      ),
      query<ReceiptRow>(
        `SELECT st.subject, st.sent_to, st.opened_at, st.open_count,
                ea.name AS account_name, ea.color AS account_color
         FROM sent_tracking st LEFT JOIN email_accounts ea ON ea.id = st.account_id
         WHERE st.user_id = $1 AND st.opened_at IS NOT NULL
           ${acct ? 'AND st.account_id = $2' : ''}
         ORDER BY st.opened_at DESC LIMIT 6`,
        P
      ),
      query<ScheduledRow>(
        `SELECT se.id, se.subject, se.to_addresses, se.send_at,
                ea.name AS account_name, ea.color AS account_color
         FROM scheduled_emails se LEFT JOIN email_accounts ea ON ea.id = se.account_id
         WHERE se.user_id = $1 AND se.status = 'pending'
           ${acct ? 'AND se.account_id = $2' : ''}
         ORDER BY se.send_at ASC LIMIT 6`,
        P
      ),
      query<RuleRow>(
        `SELECT r.id, r.name, r.enabled,
                COALESCE(SUM(l.matched) FILTER (WHERE l.executed_at >= now() - interval '7 days'), 0)::text AS matched_7d
         FROM email_rules r
         LEFT JOIN rule_execution_log l ON l.rule_id = r.id
         WHERE r.user_id = $1 ${byRule}
         GROUP BY r.id, r.name, r.enabled
         ORDER BY matched_7d DESC, r.priority DESC LIMIT 6`,
        P
      ),
      query<FollowUpRow>(
        `SELECT name, email, frequency, last_contact_at FROM contacts
         WHERE user_id = $1 AND last_contact_at < now() - interval '10 days'
         ORDER BY frequency DESC, last_contact_at ASC LIMIT 5`,
        [userId]
      ),
    ])

    const accountById = new Map(accounts.map(a => [a.id, a]))
    const unreadByAccount = new Map(unreadAllRows.map(r => [r.account_id, Number(r.n)]))
    const unreadTotal = acct
      ? (unreadByAccount.get(acct) ?? 0)
      : Array.from(unreadByAccount.values()).reduce((s, n) => s + n, 0)
    const unreadToday = Number(unreadTodayRow[0]?.n ?? 0)

    // VIP = starred contacts; frequent = top decile by frequency (min 5 exchanges).
    const vip = new Set(contactRows.filter(c => c.is_starred).map(c => c.email.toLowerCase()))
    const freqThreshold = Math.max(5, ...contactRows.map(c => c.frequency))
    const frequent = new Set(
      contactRows.filter(c => c.frequency >= Math.min(freqThreshold, 10)).map(c => c.email.toLowerCase())
    )

    const focus = focusRows
      .map(row => ({ row, ...scoreFocus(row, vip, frequent) }))
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score || +new Date(b.row.date) - +new Date(a.row.date))
      .slice(0, 5)
      .map(({ row, reason }) => {
        const acc = accountById.get(row.account_id)
        return {
          uid: row.uid,
          accountId: row.account_id,
          accountName: acc?.name ?? '',
          accountColor: acc?.color ?? '#6366f1',
          folder: row.folder,
          subject: row.subject ?? '',
          fromName: row.from_name,
          fromAddress: row.from_address,
          date: row.date,
          reason,
        }
      })

    // 14-day activity, zero-filled.
    const activity: ActivityPoint[] = []
    for (let i = 13; i >= 0; i--) {
      const d = new Date()
      d.setHours(0, 0, 0, 0)
      d.setDate(d.getDate() - i)
      activity.push({ date: d.toISOString().slice(0, 10), received: 0, sent: 0 })
    }
    const activityByDate = new Map(activity.map(p => [p.date, p]))
    for (const r of activityRows) {
      const key = new Date(r.d).toISOString().slice(0, 10)
      const point = activityByDate.get(key)
      if (point) {
        point.received = Number(r.received)
        point.sent = Number(r.sent)
      }
    }

    const parseAddrs = (raw: string): string[] => {
      try {
        const v = JSON.parse(raw)
        return Array.isArray(v) ? v.map(String) : [String(raw)]
      } catch {
        return raw ? [raw] : []
      }
    }

    const ruleItems = ruleRows.map(r => ({
      id: r.id,
      name: r.name,
      enabled: r.enabled,
      matched7d: Number(r.matched_7d),
    }))

    const data: DashboardData = {
      accountFilter: acct,
      kpis: {
        unreadTotal,
        unreadToday,
        sentToday: Number(sentTodayRow[0]?.n ?? 0),
        trackedOpens7d: Number(opens7dRow[0]?.n ?? 0),
        trackedOpensToday: Number(opensTodayRow[0]?.n ?? 0),
        scheduledPending: Number(scheduledCountRow[0]?.n ?? 0),
        nextScheduledAt: nextScheduledRow[0]?.send_at ?? null,
      },
      accounts: accounts.map(a => ({
        id: a.id,
        name: a.name,
        email: a.email,
        color: a.color,
        unread: unreadByAccount.get(a.id) ?? 0,
      })),
      activity,
      focus,
      receipts: receiptRows.map(r => ({
        subject: r.subject,
        sentTo: r.sent_to,
        openedAt: r.opened_at,
        openCount: r.open_count,
        accountName: r.account_name,
        accountColor: r.account_color,
      })),
      scheduled: scheduledRows.map(s => ({
        id: s.id,
        subject: s.subject,
        to: parseAddrs(s.to_addresses),
        sendAt: s.send_at,
        accountName: s.account_name,
        accountColor: s.account_color,
      })),
      rules: {
        items: ruleItems,
        activeCount: ruleItems.filter(r => r.enabled).length,
        actions7d: ruleItems.reduce((s, r) => s + r.matched7d, 0),
      },
      followUps: followUpRows.map(c => ({
        name: c.name,
        email: c.email,
        frequency: c.frequency,
        lastContactAt: c.last_contact_at,
      })),
    }

    return NextResponse.json({ data })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
