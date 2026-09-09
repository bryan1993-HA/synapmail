import { query } from './db'
import type { FocusReason } from '@/types/dashboard'

/**
 * Shared "focus" heuristic — scores unread inbox messages so the most
 * actionable ones surface first. Pure scoring lives here so both the dashboard
 * aggregation (`/api/dashboard`) and the mail reading-pane empty state
 * (`/api/focus`) rank identically. No LLM — regex + contact signals only.
 */

export const INVOICE_RE = /\b(facture|invoice|paiement|payment|reçu|receipt|devis|quote)\b/i
export const DEADLINE_RE = /(urgent|expire|expir|échéance|echeance|deadline|action requise|action required|rappel|reminder|dernier délai)/i
export const REPLY_RE = /^\s*(re|ré|rép|tr|fwd|fw)\s*:/i

export interface FocusRow {
  uid: string
  account_id: string
  folder: string
  subject: string | null
  from_name: string | null
  from_address: string | null
  date: string
  is_starred: boolean
  has_attachments: boolean
}

export function scoreFocus(
  row: FocusRow,
  vip: Set<string>,
  frequent: Set<string>,
): { score: number; reason: FocusReason } {
  const subject = row.subject ?? ''
  const from = (row.from_address ?? '').toLowerCase()
  let score = 0
  let reason: FocusReason = 'reply'

  if (row.is_starred) { score += 5; reason = 'starred' }
  if (from && vip.has(from)) { score += 4; reason = 'vip' }
  else if (from && frequent.has(from)) { score += 2; if (reason === 'reply') reason = 'frequent' }
  if (INVOICE_RE.test(subject)) { score += 3; reason = 'invoice' }
  if (DEADLINE_RE.test(subject)) { score += 4; reason = 'deadline' }
  if (REPLY_RE.test(subject)) { score += 2; if (reason === 'reply') reason = 'reply' }
  if (row.has_attachments) { score += 1; if (reason === 'reply') reason = 'attachment' }

  return { score, reason }
}

// Folder-name fragments that must NOT count as "inbox" mail. Includes Gmail's
// "All Mail" / "Important" (localised) so an unread there is not double-counted
// against the copy already sitting in INBOX.
const NON_INBOX = `(mc.folder ILIKE '%trash%' OR mc.folder ILIKE '%sent%' OR mc.folder ILIKE '%junk%'
  OR mc.folder ILIKE '%spam%' OR mc.folder ILIKE '%draft%' OR mc.folder ILIKE '%archive%'
  OR mc.folder ILIKE '%deleted%' OR mc.folder ILIKE '%all mail%' OR mc.folder ILIKE '%tous les messages%'
  OR mc.folder ILIKE '%important%')`

export interface FocusItem {
  uid: string
  accountId: string
  accountName: string
  accountColor: string
  folder: string
  subject: string
  fromName: string | null
  fromAddress: string | null
  date: string
  reason: FocusReason
}

type AccountRow = { id: string; name: string; color: string }
type ContactRow = { email: string; frequency: number; is_starred: boolean }

/**
 * Standalone top-N focus list for a user, optionally scoped to one account.
 * Mirrors the dashboard's ranking. Snoozed messages are excluded.
 */
export async function getFocusItems(userId: string, accountId?: string | null, limit = 5): Promise<FocusItem[]> {
  const scoped = !!accountId
  const params: unknown[] = scoped ? [userId, accountId] : [userId]
  const byEa = scoped ? 'AND ea.id = $2' : ''

  const [accounts, focusRows, contactRows] = await Promise.all([
    query<AccountRow>(
      `SELECT id, name, color FROM email_accounts WHERE user_id = $1`,
      [userId],
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
      params,
    ),
    query<ContactRow>(
      `SELECT email, frequency, is_starred FROM contacts WHERE user_id = $1`,
      [userId],
    ),
  ])

  const accountById = new Map(accounts.map(a => [a.id, a]))
  const vip = new Set(contactRows.filter(c => c.is_starred).map(c => c.email.toLowerCase()))
  const freqThreshold = Math.max(5, ...contactRows.map(c => c.frequency))
  const frequent = new Set(
    contactRows.filter(c => c.frequency >= Math.min(freqThreshold, 10)).map(c => c.email.toLowerCase()),
  )

  return focusRows
    .map(row => ({ row, ...scoreFocus(row, vip, frequent) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score || +new Date(b.row.date) - +new Date(a.row.date))
    .slice(0, limit)
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
}
