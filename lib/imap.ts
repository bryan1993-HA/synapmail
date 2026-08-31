import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import { decrypt } from './encrypt'
import { refreshAccessToken } from './msOAuth'
import { query } from './db'
import { upsertContact } from './contacts'
import type { Message, Folder, AuthResults } from '@/types/email'

function normalizeSubjectForThread(subject: string): string {
  let prev = ''
  let s = (subject ?? '').trim()
  while (s !== prev) {
    prev = s
    s = s.replace(/^(Re|Rép|Fwd|Fw|TR|AW|SV|VS):\s*/gi, '').trim()
  }
  return s.toLowerCase() || 'no-subject'
}

// Recursively check bodyStructure for attachment parts.
// In imapflow: disposition is a plain string ('attachment'|'inline'),
// dispositionParameters holds filename, parameters holds Content-Type params (name).
function detectAttachments(structure: Record<string, unknown> | null | undefined): boolean {
  if (!structure) return false
  const disp = String(structure.disposition ?? '').toLowerCase()
  const params = structure.parameters as Record<string, string> | undefined
  const dispParams = structure.dispositionParameters as Record<string, string> | undefined
  // Explicit attachment disposition
  if (disp === 'attachment') return true
  // Non-text, non-multipart part with a filename → treated as attachment
  const type = String(structure.type ?? '').toLowerCase()
  if (type && type !== 'text' && type !== 'multipart' && (params?.name || dispParams?.filename)) return true
  // Recurse into child nodes
  const children = structure.childNodes as Record<string, unknown>[] | undefined
  if (children?.length) return children.some(detectAttachments)
  return false
}

function parseAuthResults(headerLines: ReadonlyArray<{ key: string; line: string }>): AuthResults {
  const raw = headerLines
    .filter(h => h.key === 'authentication-results')
    .map(h => h.line.replace(/^authentication-results:\s*/i, ''))
    .join(' ')

  const extract = (key: string): 'pass' | 'fail' | 'none' => {
    const match = raw.match(new RegExp(`\\b${key}=(\\w+)`, 'i'))
    if (!match) return 'none'
    const val = match[1].toLowerCase()
    if (val === 'pass') return 'pass'
    if (['fail', 'softfail', 'reject', 'permerror', 'temperror', 'hardfail'].includes(val)) return 'fail'
    return 'none'
  }

  return { spf: extract('spf'), dkim: extract('dkim'), dmarc: extract('dmarc') }
}

export interface AccountConfig {
  id?: string
  imapHost: string
  imapPort: number
  imapSecure: boolean
  username: string
  passwordEncrypted: string
  oauthProvider?: string | null
  oauthAccessToken?: string | null
  oauthRefreshToken?: string | null
  oauthExpiresAt?: number | null
}

async function getAccessToken(account: AccountConfig): Promise<string> {
  let accessToken = account.oauthAccessToken!
  const expiresAt = account.oauthExpiresAt ?? 0

  // Refresh if expired or expiring in < 60s
  if (Date.now() > expiresAt - 60_000 && account.oauthRefreshToken) {
    const refreshed = await refreshAccessToken(account.oauthRefreshToken)
    accessToken = refreshed.accessToken
    if (account.id) {
      await query(
        'UPDATE email_accounts SET oauth_access_token = $1, oauth_expires_at = $2 WHERE id = $3',
        [accessToken, refreshed.expiresAt, account.id]
      )
    }
  }
  return accessToken
}

export async function createClient(account: AccountConfig): Promise<ImapFlow> {
  let authOpts: { user: string; pass?: string; accessToken?: string }

  if (account.oauthProvider && account.oauthAccessToken) {
    const accessToken = await getAccessToken(account)
    authOpts = { user: account.username, accessToken }
  } else {
    authOpts = { user: account.username, pass: decrypt(account.passwordEncrypted) }
  }

  const client = new ImapFlow({
    host: account.imapHost,
    port: account.imapPort,
    secure: account.imapSecure,
    auth: authOpts,
    logger: false,
  })
  await client.connect()
  return client
}

export async function listMessages(
  account: AccountConfig,
  folder: string,
  page: number,
  perPage: number,
  filter: 'all' | 'unread' | 'starred' = 'all',
  userId?: string
): Promise<{ messages: Message[]; total: number }> {
  const client = await createClient(account)
  try {
    const mailbox = await client.mailboxOpen(folder)
    const total = mailbox.exists

    let searchQuery: Parameters<typeof client.search>[0]
    if (filter === 'unread') {
      searchQuery = { seen: false }
    } else if (filter === 'starred') {
      searchQuery = { flagged: true }
    } else {
      searchQuery = { all: true }
    }

    const searchResult = await client.search(searchQuery)
    const allUids = Array.isArray(searchResult) ? searchResult : []
    const reversedUids = [...allUids].reverse()
    const pageUids = reversedUids.slice((page - 1) * perPage, page * perPage)

    const messages: Message[] = []
    if (pageUids.length > 0) {
      for await (const msg of client.fetch(pageUids as unknown as string, {
        uid: true, flags: true, envelope: true, bodyStructure: true,
        size: true,
        headers: ['list-unsubscribe', 'x-priority'],
      } as Parameters<typeof client.fetch>[1])) {
        const subject = msg.envelope?.subject ?? '(no subject)'
        // Thread ID: use In-Reply-To from envelope if available (chained reply), else normalized subject
        const inReplyTo = (msg.envelope as Record<string, unknown>)?.inReplyTo as string | undefined
        const threadId = inReplyTo
          ? inReplyTo.trim().replace(/[<>]/g, '').split(/\s+/)[0]
          : normalizeSubjectForThread(subject)

        // Parse optional headers and size fetched in batch (cast via unknown — imapflow dynamic fields)
        // imapflow v1 returns headers as a Buffer (raw MIME bytes), not a Map
        const msgAny = msg as unknown as Record<string, unknown>
        const hdrBuf = msgAny.headers as Buffer | undefined
        const hdrText = Buffer.isBuffer(hdrBuf) ? hdrBuf.toString('utf8') : ''
        const getHeader = (name: string): string | undefined => {
          const match = hdrText.match(new RegExp(`^${name}:\\s*(.+)`, 'im'))
          return match?.[1]?.trim()
        }
        const listUnsub = getHeader('list-unsubscribe')
        const xPriorityRaw = getHeader('x-priority')
        const xPriority = xPriorityRaw ? parseInt(xPriorityRaw.trim(), 10) || undefined : undefined

        messages.push({
          uid: String(msg.uid),
          messageId: msg.envelope?.messageId ?? '',
          from: {
            name: msg.envelope?.from?.[0]?.name ?? '',
            address: msg.envelope?.from?.[0]?.address ?? '',
          },
          to: (msg.envelope?.to ?? []).map(a => ({ name: a.name ?? '', address: a.address ?? '' })),
          subject,
          date: msg.envelope?.date?.toISOString() ?? '',
          preview: '',
          isRead: msg.flags?.has('\\Seen') ?? false,
          isStarred: msg.flags?.has('\\Flagged') ?? false,
          isFlagged: msg.flags?.has('\\Flagged') ?? false,
          hasAttachments: detectAttachments(msg.bodyStructure as unknown as Record<string, unknown>),
          threadId,
          folder,
          accountId: '',
          size: msgAny.size as number | undefined,
          listUnsubscribe: listUnsub,
          xPriority,
        })
      }
    }

    // Upsert messages_cache — fire-and-forget, non-bloquant
    // RETURNING xmax: 0 = nouvelle ligne (message jamais vu) → tracker le contact une seule fois
    if (account.id && messages.length > 0) {
      const accountId = account.id
      void (async () => {
        try {
          for (const m of messages) {
            const result = await query<{ xmax: string }>(
              `INSERT INTO messages_cache
                (account_id, folder, uid, message_id, from_address, from_name, subject, date,
                 is_read, is_starred, is_flagged, has_attachments, preview, thread_id, cached_at)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW())
               ON CONFLICT (account_id, folder, uid) DO UPDATE SET
                 is_read = EXCLUDED.is_read,
                 is_starred = EXCLUDED.is_starred,
                 is_flagged = EXCLUDED.is_flagged,
                 thread_id = EXCLUDED.thread_id,
                 cached_at = NOW()
               RETURNING xmax::text`,
              [
                accountId, folder, m.uid, m.messageId,
                m.from.address, m.from.name, m.subject, m.date,
                m.isRead, m.isStarred, m.isFlagged, m.hasAttachments,
                m.preview, m.threadId ?? null,
              ]
            )
            // xmax = 0 → INSERT réel (message découvert pour la première fois) → 1 seule incrémentation
            // Exclure sa propre adresse (ex: TrueNAS envoie depuis l'adresse de l'utilisateur)
            if (userId && result[0]?.xmax === '0' && m.from.address
              && m.from.address.toLowerCase() !== account.username.toLowerCase()) {
              upsertContact(userId, { name: m.from.name, address: m.from.address }, 'received').catch(() => {})
            }
          }
        } catch { /* non-bloquant */ }
      })()
    }

    return { messages, total }
  } finally {
    await client.logout()
  }
}

export async function getMessage(
  account: AccountConfig,
  folder: string,
  uid: string
): Promise<Message | null> {
  const client = await createClient(account)
  try {
    await client.mailboxOpen(folder)
    const msg = await client.fetchOne(uid, {
      uid: true, flags: true, envelope: true, source: true,
    }, { uid: true })
    if (!msg) return null

    const parsed = await simpleParser(msg.source ?? Buffer.alloc(0))

    return {
      uid: String(msg.uid),
      messageId: parsed.messageId ?? msg.envelope?.messageId ?? '',
      from: {
        name: parsed.from?.value?.[0]?.name ?? msg.envelope?.from?.[0]?.name ?? '',
        address: parsed.from?.value?.[0]?.address ?? msg.envelope?.from?.[0]?.address ?? '',
      },
      to: (parsed.to
        ? (Array.isArray(parsed.to) ? parsed.to : [parsed.to])
            .flatMap(a => a.value)
            .map(a => ({ name: a.name ?? '', address: a.address ?? '' }))
        : (msg.envelope?.to ?? []).map(a => ({ name: a.name ?? '', address: a.address ?? '' }))
      ),
      cc: (parsed.cc
        ? (Array.isArray(parsed.cc) ? parsed.cc : [parsed.cc])
            .flatMap(a => a.value)
            .map(a => ({ name: a.name ?? '', address: a.address ?? '' }))
        : (msg.envelope?.cc ?? []).map(a => ({ name: a.name ?? '', address: a.address ?? '' }))
      ),
      replyTo: (() => {
        const rt = parsed.replyTo?.value?.[0]
        if (!rt?.address) return undefined
        return { name: rt.name ?? '', address: rt.address }
      })(),
      subject: parsed.subject ?? msg.envelope?.subject ?? '(no subject)',
      date: (parsed.date ?? msg.envelope?.date)?.toISOString() ?? '',
      preview: parsed.text?.slice(0, 200) ?? '',
      isRead: msg.flags?.has('\\Seen') ?? false,
      isStarred: msg.flags?.has('\\Flagged') ?? false,
      isFlagged: msg.flags?.has('\\Flagged') ?? false,
      hasAttachments: (parsed.attachments?.length ?? 0) > 0,
      bodyHtml: parsed.html || undefined,
      bodyPlain: parsed.text || undefined,
      folder,
      accountId: '',
      authResults: parseAuthResults(parsed.headerLines ?? []),
      listUnsubscribe: (() => {
        const line = parsed.headerLines?.find(h => h.key === 'list-unsubscribe')
        if (!line) return undefined
        // Strip "List-Unsubscribe: " prefix from raw header line
        return line.line.replace(/^list-unsubscribe:\s*/i, '').trim() || undefined
      })(),
      dispositionNotificationTo: (() => {
        const line = parsed.headerLines?.find(h => h.key === 'disposition-notification-to')
        if (!line) return undefined
        return line.line.replace(/^disposition-notification-to:\s*/i, '').trim() || undefined
      })(),
      attachments: parsed.attachments?.map((a, i) => ({
        id: String(i),
        filename: a.filename ?? `attachment-${i}`,
        contentType: a.contentType,
        size: a.size ?? 0,
      })) ?? [],
    }
  } finally {
    await client.logout()
  }
}

export async function deleteMessage(
  account: AccountConfig,
  folder: string,
  uid: string
): Promise<void> {
  const client = await createClient(account)
  try {
    await client.mailboxOpen(folder)
    await client.messageDelete(uid, { uid: true })
  } finally {
    await client.logout()
  }
}

export async function moveMessage(
  account: AccountConfig,
  folder: string,
  uid: string,
  destination: string
): Promise<void> {
  const client = await createClient(account)
  try {
    await client.mailboxOpen(folder)
    await client.messageMove(uid, destination, { uid: true })
  } finally {
    await client.logout()
  }
}

export async function markRead(
  account: AccountConfig,
  folder: string,
  uid: string,
  read: boolean
): Promise<void> {
  const client = await createClient(account)
  try {
    await client.mailboxOpen(folder)
    if (read) {
      await client.messageFlagsAdd(uid, ['\\Seen'], { uid: true })
    } else {
      await client.messageFlagsRemove(uid, ['\\Seen'], { uid: true })
    }
  } finally {
    await client.logout()
  }
}

export async function markStarred(
  account: AccountConfig,
  folder: string,
  uid: string,
  starred: boolean
): Promise<void> {
  const client = await createClient(account)
  try {
    await client.mailboxOpen(folder)
    if (starred) {
      await client.messageFlagsAdd(uid, ['\\Flagged'], { uid: true })
    } else {
      await client.messageFlagsRemove(uid, ['\\Flagged'], { uid: true })
    }
  } finally {
    await client.logout()
  }
}

export async function markReadBulk(
  account: AccountConfig,
  folder: string,
  uids: string[],
  read: boolean
): Promise<void> {
  const client = await createClient(account)
  try {
    await client.mailboxOpen(folder)
    const uidSet = uids.join(',')
    if (read) {
      await client.messageFlagsAdd(uidSet, ['\\Seen'], { uid: true })
    } else {
      await client.messageFlagsRemove(uidSet, ['\\Seen'], { uid: true })
    }
  } finally {
    await client.logout()
  }
}

export async function deleteMessagesBulk(
  account: AccountConfig,
  folder: string,
  uids: string[]
): Promise<void> {
  const client = await createClient(account)
  try {
    await client.mailboxOpen(folder)
    await client.messageDelete(uids.join(','), { uid: true })
  } finally {
    await client.logout()
  }
}

export async function moveMessagesBulk(
  account: AccountConfig,
  folder: string,
  uids: string[],
  destination: string
): Promise<void> {
  const client = await createClient(account)
  try {
    await client.mailboxOpen(folder)
    await client.messageMove(uids.join(','), destination, { uid: true })
  } finally {
    await client.logout()
  }
}

export async function getAttachmentContent(
  account: AccountConfig,
  folder: string,
  uid: string,
  partIdx: number
): Promise<{ content: Buffer; filename: string; contentType: string } | null> {
  const client = await createClient(account)
  try {
    await client.mailboxOpen(folder)
    const msg = await client.fetchOne(uid, { source: true }, { uid: true })
    if (!msg) return null
    const parsed = await simpleParser(msg.source ?? Buffer.alloc(0))
    const attachment = parsed.attachments?.[partIdx]
    if (!attachment) return null
    return {
      content: attachment.content,
      filename: attachment.filename ?? `attachment-${partIdx}`,
      contentType: attachment.contentType ?? 'application/octet-stream',
    }
  } finally {
    await client.logout()
  }
}

export async function listFolders(account: AccountConfig): Promise<Folder[]> {
  const client = await createClient(account)
  try {
    const list = await client.list()
    return list.map(f => ({
      name: f.name,
      path: f.path,
      delimiter: f.delimiter ?? '/',
      flags: Array.from(f.flags ?? []),
    }))
  } finally {
    await client.logout()
  }
}

export async function searchMessages(
  account: AccountConfig,
  folder: string,
  queryStr: string
): Promise<Message[]> {
  const client = await createClient(account)
  try {
    await client.mailboxOpen(folder)
    const searchResult = await client.search({
      or: [{ from: queryStr }, { subject: queryStr }],
    })
    const allUids = Array.isArray(searchResult) ? searchResult : []
    const recentUids = [...allUids].reverse().slice(0, 50)

    const messages: Message[] = []
    if (recentUids.length > 0) {
      for await (const msg of client.fetch(recentUids as unknown as string, {
        uid: true, flags: true, envelope: true, bodyStructure: true,
      })) {
        messages.push({
          uid: String(msg.uid),
          messageId: msg.envelope?.messageId ?? '',
          from: {
            name: msg.envelope?.from?.[0]?.name ?? '',
            address: msg.envelope?.from?.[0]?.address ?? '',
          },
          to: (msg.envelope?.to ?? []).map(a => ({ name: a.name ?? '', address: a.address ?? '' })),
          subject: msg.envelope?.subject ?? '(no subject)',
          date: msg.envelope?.date?.toISOString() ?? '',
          preview: '',
          isRead: msg.flags?.has('\\Seen') ?? false,
          isStarred: msg.flags?.has('\\Flagged') ?? false,
          isFlagged: msg.flags?.has('\\Flagged') ?? false,
          hasAttachments: detectAttachments(msg.bodyStructure as unknown as Record<string, unknown>),
          folder,
          accountId: '',
        })
      }
    }
    return messages
  } finally {
    await client.logout()
  }
}
