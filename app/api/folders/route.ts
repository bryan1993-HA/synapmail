import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { query } from '@/lib/db'
import { listFolders } from '@/lib/imap'

export const dynamic = 'force-dynamic'

type SpecialType = 'inbox' | 'sent' | 'drafts' | 'spam' | 'trash' | null

// RFC 6154 SPECIAL-USE attribute → special type mapping
const SPECIAL_USE_MAP: Record<string, SpecialType> = {
  '\\Inbox':   'inbox',
  '\\Sent':    'sent',
  '\\Drafts':  'drafts',
  '\\Junk':    'spam',
  '\\Trash':   'trash',
  '\\Archive': null,
  '\\Flagged': null,
  '\\All':     null,
}

function detectSpecial(path: string, name: string, specialUse?: string): SpecialType {
  // 1. Prefer RFC 6154 SPECIAL-USE flag — language-independent
  if (specialUse && Object.prototype.hasOwnProperty.call(SPECIAL_USE_MAP, specialUse)) {
    return SPECIAL_USE_MAP[specialUse]
  }

  // 2. Word-boundary regex on path/name — avoids false positives like "Sentiments"
  const p = path.toLowerCase()
  const n = name.toLowerCase()
  if (p === 'inbox' || n === 'inbox') return 'inbox'
  if (/\b(sent|envoy[eé]s?)\b/.test(p) || /\b(sent|envoy[eé]s?)\b/.test(n)) return 'sent'
  if (/\b(drafts?|brouillons?)\b/.test(p) || /\b(drafts?|brouillons?)\b/.test(n)) return 'drafts'
  if (/\b(junk|spam|pourriel|ind[eé]sirables?)\b/.test(p) || /\b(junk|spam|pourriel|ind[eé]sirables?)\b/.test(n)) return 'spam'
  if (/\b(deleted|trash|corbeille|supprim[eé]s?)\b/.test(p) || /\b(deleted|trash|corbeille|supprim[eé]s?)\b/.test(n)) return 'trash'
  return null
}

export async function GET(req: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const accountId = searchParams.get('account')

  try {
    const accounts = await query<{
      id: string; imap_host: string; imap_port: number; imap_secure: boolean;
      username: string; password_encrypted: string;
      oauth_provider: string | null; oauth_access_token: string | null;
      oauth_refresh_token: string | null; oauth_expires_at: number | null;
    }>(
      accountId
        ? 'SELECT * FROM email_accounts WHERE id = $1 AND user_id = $2 LIMIT 1'
        : 'SELECT * FROM email_accounts WHERE user_id = $1 ORDER BY is_default DESC, created_at ASC LIMIT 1',
      accountId ? [accountId, session.user?.id] : [session.user?.id]
    )

    if (!accounts.length) return NextResponse.json({ data: [] })

    const account = accounts[0]
    const folders = await listFolders({
      id: account.id,
      imapHost: account.imap_host,
      imapPort: account.imap_port,
      imapSecure: account.imap_secure,
      username: account.username,
      passwordEncrypted: account.password_encrypted,
      oauthProvider: account.oauth_provider,
      oauthAccessToken: account.oauth_access_token,
      oauthRefreshToken: account.oauth_refresh_token,
      oauthExpiresAt: account.oauth_expires_at,
    })

    // Filter out Outlook system/technical folders
    const SYSTEM_KEYWORDS = [
      'sync issues', 'problèmes de synchronisation', 'synchronisation',
      'server failures', 'défaillances du serveur',
      'local failures', 'défaillances locales',
      'conflicts', 'conflits',
      'partages compte', 'sharing',
      'outbox',
      'calendar', 'contacts', 'tasks', 'journal', 'notes',
      'conversation history', 'quick step',
      'clutter', 'rss', 'social updates',
    ]

    const isSystemFolder = (path: string, name: string) => {
      const p = path.toLowerCase()
      const n = name.toLowerCase()
      return SYSTEM_KEYWORDS.some(kw => p.includes(kw) || n.includes(kw))
    }

    const normalized = folders
      .filter(f => !isSystemFolder(f.path, f.name))
      .map(f => ({
        name: f.name,
        path: f.path,
        special: detectSpecial(f.path, f.name, f.specialUse),
      }))

    // Sort: special folders first (in order), then alphabetical
    const specialOrder = ['inbox', 'sent', 'drafts', 'spam', 'trash']
    normalized.sort((a, b) => {
      const ai = a.special ? specialOrder.indexOf(a.special) : 999
      const bi = b.special ? specialOrder.indexOf(b.special) : 999
      if (ai !== bi) return ai - bi
      return a.name.localeCompare(b.name)
    })

    // Unread counts from cache
    const unreadRows = await query<{ folder: string; unread_count: string }>(
      `SELECT folder, COUNT(*) as unread_count FROM messages_cache WHERE account_id = $1 AND is_read = false GROUP BY folder`,
      [account.id]
    )
    const unreadMap = Object.fromEntries(unreadRows.map(r => [r.folder, parseInt(r.unread_count)]))

    const withCounts = normalized.map(f => ({
      ...f,
      unreadCount: unreadMap[f.path] ?? 0,
    }))

    return NextResponse.json({ data: withCounts })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
