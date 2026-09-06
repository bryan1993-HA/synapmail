import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { query } from '@/lib/db'
import { listFolders } from '@/lib/imap'

export const dynamic = 'force-dynamic'

type Special = 'inbox' | 'sent' | 'drafts' | 'spam' | 'trash' | null

// IMAP SPECIAL-USE attributes (RFC 6154) — language-independent, most reliable.
const SPECIAL_USE: Record<string, Exclude<Special, null>> = {
  '\\Sent': 'sent',
  '\\Drafts': 'drafts',
  '\\Junk': 'spam',
  '\\Trash': 'trash',
}

function detectSpecial(folder: { path: string; name: string; flags: string[]; specialUse?: string }): Special {
  // 1) Prefer the IMAP special-use flag (works regardless of the mailbox language).
  const su = folder.specialUse || folder.flags.find(f => SPECIAL_USE[f])
  if (su && SPECIAL_USE[su]) return SPECIAL_USE[su]

  // 2) Fall back to name/path matching, including French aliases.
  const p = folder.path.toLowerCase()
  const n = folder.name.toLowerCase()
  const has = (...kw: string[]) => kw.some(k => p.includes(k) || n.includes(k))
  if (p === 'inbox' || n === 'inbox') return 'inbox'
  if (has('sent', 'envoyé', 'envoyes', 'envoyés')) return 'sent'
  if (has('draft', 'brouillon')) return 'drafts'
  if (has('junk', 'spam', 'pourriel', 'indésirable', 'indesirable')) return 'spam'
  if (has('trash', 'deleted', 'corbeille')) return 'trash'
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
      // Skip system folders and non-selectable containers (e.g. Gmail's "[Gmail]"
      // parent, which carries \Noselect and errors when opened).
      .filter(f => !isSystemFolder(f.path, f.name) && !f.flags.includes('\\Noselect'))
      .map(f => ({
        name: f.name,
        path: f.path,
        special: detectSpecial(f),
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
