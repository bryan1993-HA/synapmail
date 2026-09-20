import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import { decrypt } from './encrypt'
import { refreshAccessToken } from './msOAuth'
import { query } from './db'
import { upsertContact } from './contacts'
import { DEFAULT_FLAG_KEY, FLAG_BIT_KEYWORDS, FLAG_IMAP_FLAG, flagFromKeywords, keywordsForFlag } from './flags'
import type { MailListFilter } from './flags'
import { SEARCH_FIELDS, SEARCH_RESULT_LIMIT, orderFoldersForSearch } from './search'
import type { FolderRank } from './search'
import type { Message, Folder, AuthResults } from '@/types/email'

/**
 * Date of a message for the app: the Date header (envelope) when it is present and
 * valid, otherwise the IMAP internal date (arrival on the server), which always
 * exists. Some script-generated mails carry no usable Date header: without this
 * fallback the API returned '' and the interface showed "Invalid Date".
 */
export function messageDate(...candidates: Array<Date | string | null | undefined>): string {
  for (const c of candidates) {
    if (!c) continue
    const d = c instanceof Date ? c : new Date(c)
    if (!Number.isNaN(d.getTime())) return d.toISOString()
  }
  return ''
}

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
    tls: { rejectUnauthorized: false },
    // Fail fast on connection issues instead of hanging on imapflow's long
    // defaults (~90s to connect). A slow/unreachable IMAP host or a bad greeting
    // now errors within ~10s, so the API returns an error quickly rather than
    // holding the request (and an IMAP connection) open for a long time.
    connectionTimeout: 10000,
    greetingTimeout: 8000,
  })
  await client.connect()
  return client
}

export async function listMessages(
  account: AccountConfig,
  folder: string,
  page: number,
  perPage: number,
  filter: MailListFilter = 'all',
  userId?: string
): Promise<{ messages: Message[]; total: number }> {
  const client = await createClient(account)
  try {
    const mailbox = await client.mailboxOpen(folder)
    // Two distinct sizes, never merged: `mailboxSize` is how many messages the folder holds
    // (what the cache reconcile and the unread count reason about), `total` is the size of the
    // VIEW being paged — the whole mailbox for "all", the MATCHES for a filter.
    const mailboxSize = mailbox.exists
    let total = mailboxSize

    // For "all" we derive the page range directly from mailbox.exists:
    // sequence numbers are 1..N, with N being the newest message.
    // This avoids SEARCH ALL which returns all N sequence numbers just to
    // slice a small page — a significant win on large mailboxes.
    // For filtered views (unread/starred) we still need SEARCH.
    let pageSeqs: number[]
    if (filter === 'all') {
      const end = mailboxSize - (page - 1) * perPage
      const start = Math.max(1, end - perPage + 1)
      pageSeqs = []
      for (let seq = end; seq >= start; seq--) pageSeqs.push(seq)
    } else {
      const criteria = filter === 'unread' ? { seen: false } : { flagged: true }
      const raw = await client.search(criteria)
      const allSeqs = Array.isArray(raw) ? raw : []
      // A filtered view ends where its matches end. Reporting the mailbox size here made the
      // list believe thousands of messages remained: it kept asking for empty pages forever.
      total = allSeqs.length
      const reversed = [...allSeqs].reverse()
      pageSeqs = reversed.slice((page - 1) * perPage, page * perPage) as number[]
    }
    const pageUids = pageSeqs

    const messages: Message[] = []
    if (pageUids.length > 0) {
      for await (const msg of client.fetch(pageUids as unknown as string, {
        uid: true, flags: true, envelope: true, bodyStructure: true, internalDate: true,
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
          date: messageDate(msg.envelope?.date, msg.internalDate),
          preview: '',
          isRead: msg.flags?.has('\\Seen') ?? false,
          isStarred: msg.flags?.has(FLAG_IMAP_FLAG) ?? false,
          isFlagged: msg.flags?.has(FLAG_IMAP_FLAG) ?? false,
          flag: flagFromKeywords(msg.flags),
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

    // Reconcile the cache for this folder on the first page: collect every live
    // UID so ghost rows (message moved/deleted from another client, rule, or
    // expunge) can be pruned. Without this, `messages_cache` accumulates stale
    // `is_read = false` rows that pollute the focus list and unread counts.
    let liveUids: string[] | null = null
    let unseenCount: number | null = null
    if (page === 1 && account.id) {
      try {
        const all = await client.search({ all: true }, { uid: true })
        if (Array.isArray(all)) {
          liveUids = all.map(String)
        } else if (mailboxSize === 0) {
          liveUids = []          // genuinely empty mailbox — NOT an empty filtered view
        }
        // a non-array result on a non-empty mailbox → leave null, skip pruning
      } catch {
        liveUids = null
      }
      // Authoritative unread count for this folder — server-side SEARCH UNSEEN,
      // not bounded by `perPage` like counting messages_cache rows would be.
      try {
        if (mailboxSize === 0) {
          unseenCount = 0
        } else {
          const unseen = await client.search({ seen: false }, { uid: true })
          if (Array.isArray(unseen)) unseenCount = unseen.length
        }
      } catch {
        unseenCount = null
      }
    }

    // Upsert messages_cache — fire-and-forget, non-blocking
    // RETURNING xmax: 0 = new row (message never seen before) → track the contact only once
    if (account.id) {
      const accountId = account.id
      const seenUids = liveUids
      const unseen = unseenCount
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
                m.from.address, m.from.name, m.subject, m.date || null,
                m.isRead, m.isStarred, m.isFlagged, m.hasAttachments,
                m.preview, m.threadId ?? null,
              ]
            )
            // xmax = 0 → real INSERT (message seen for the first time) → count it only once
            // Skip the account's own address (some devices send from the user's own address)
            if (userId && result[0]?.xmax === '0' && m.from.address
              && m.from.address.toLowerCase() !== account.username.toLowerCase()) {
              upsertContact(userId, { name: m.from.name, address: m.from.address }, 'received').catch(() => {})
            }
          }

          // Prune ghost rows for this folder (UID no longer live).
          if (seenUids !== null) {
            if (seenUids.length > 0) {
              await query(
                `DELETE FROM messages_cache
                 WHERE account_id = $1 AND folder = $2 AND NOT (uid = ANY($3::varchar[]))`,
                [accountId, folder, seenUids]
              )
            } else {
              await query(
                `DELETE FROM messages_cache WHERE account_id = $1 AND folder = $2`,
                [accountId, folder]
              )
            }
          }

          // Persist the authoritative unread count (SEARCH UNSEEN above).
          if (unseen !== null) {
            await query(
              `INSERT INTO mailbox_stats (account_id, folder, unread_count, synced_at)
               VALUES ($1, $2, $3, NOW())
               ON CONFLICT (account_id, folder) DO UPDATE SET
                 unread_count = EXCLUDED.unread_count, synced_at = NOW()`,
              [accountId, folder, unseen]
            )
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
      uid: true, flags: true, envelope: true, source: true, internalDate: true,
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
      date: messageDate(parsed.date, msg.envelope?.date, msg.internalDate),
      preview: parsed.text?.slice(0, 200) ?? '',
      isRead: msg.flags?.has('\\Seen') ?? false,
      isStarred: msg.flags?.has(FLAG_IMAP_FLAG) ?? false,
      isFlagged: msg.flags?.has(FLAG_IMAP_FLAG) ?? false,
      flag: flagFromKeywords(msg.flags),
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
  await setFlagBulk(account, folder, [uid], starred ? DEFAULT_FLAG_KEY : null)
}

/**
 * Sets (or clears) a color flag on a set of messages. The color is carried by the
 * Apple keywords (see lib/flags.ts): ALL bits are removed first, otherwise a color
 * replacing another one would keep the previous color's bits and end up rendering a
 * third color.
 */
export async function setFlagBulk(
  account: AccountConfig,
  folder: string,
  uids: string[],
  flag: string | null
): Promise<void> {
  if (!uids.length) return
  const client = await createClient(account)
  try {
    await client.mailboxOpen(folder)
    const uidSet = uids.join(',')
    const stale = flag === null ? [FLAG_IMAP_FLAG, ...FLAG_BIT_KEYWORDS] : [...FLAG_BIT_KEYWORDS]
    await client.messageFlagsRemove(uidSet, stale, { uid: true })
    if (flag !== null) {
      await client.messageFlagsAdd(uidSet, [FLAG_IMAP_FLAG, ...keywordsForFlag(flag)], { uid: true })
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

/**
 * RAW source of several messages from a single folder, so they can be forwarded as
 * attachments. A SINGLE connection for the whole selection: opening then closing one
 * IMAP session per message is expensive on the servers that were measured. The
 * subject comes from the envelope, so the message is not re-parsed just to name the
 * file.
 *
 * Two passes, in this order: SIZES first (`RFC822.SIZE`, no body bytes at all), then
 * the sources only if the total fits under the cap. Otherwise a large mailbox would
 * be fully loaded into memory before there is any chance to reject it.
 *
 * The result carries its own verdict: `missing` lists the requested uids the folder
 * no longer holds (message moved between selection and send). The caller has nothing
 * to compare: a truncated forward cannot go out by simple oversight.
 */
export interface MessageSourcesResult {
  sources: Array<{ uid: string; subject: string; source: Buffer }>
  /** Requested uids that were absent from the folder at re-read time. */
  missing: string[]
  /** Sum of the sizes advertised by the server, when the cap is exceeded. */
  totalBytes: number
  oversized: boolean
}

export async function getMessageSources(
  account: AccountConfig,
  folder: string,
  uids: string[],
  maxTotalBytes: number
): Promise<MessageSourcesResult> {
  const empty: MessageSourcesResult = { sources: [], missing: [], totalBytes: 0, oversized: false }
  if (!uids.length) return empty
  const client = await createClient(account)
  try {
    await client.mailboxOpen(folder)

    // Pass 1: sizes only. `size` comes from RFC822.SIZE, which the server
    // advertises without transferring the message.
    const sizeByUid = new Map<string, number>()
    for await (const msg of client.fetch(uids.join(','), { uid: true, size: true }, { uid: true })) {
      sizeByUid.set(String(msg.uid), msg.size ?? 0)
    }
    const missing = uids.filter(uid => !sizeByUid.has(uid))
    if (missing.length) return { ...empty, missing }

    const totalBytes = uids.reduce((sum, uid) => sum + (sizeByUid.get(uid) ?? 0), 0)
    if (totalBytes > maxTotalBytes) return { ...empty, totalBytes, oversized: true }

    // Pass 2: the sources, now that we know they fit under the cap.
    const byUid = new Map<string, { uid: string; subject: string; source: Buffer }>()
    for await (const msg of client.fetch(uids.join(','), { uid: true, envelope: true, source: true }, { uid: true })) {
      if (!msg.source) continue
      byUid.set(String(msg.uid), {
        uid: String(msg.uid),
        subject: msg.envelope?.subject ?? '',
        source: msg.source,
      })
    }
    // IMAP returns messages in uid order, not in selection order: restore the
    // requested order so the attachments follow what the user actually checked
    // in the list.
    return {
      sources: uids
        .map(uid => byUid.get(uid))
        .filter((m): m is { uid: string; subject: string; source: Buffer } => !!m),
      missing: uids.filter(uid => !byUid.has(uid)),
      totalBytes,
      oversized: false,
    }
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

export async function appendToSentFolder(account: AccountConfig, raw: Buffer): Promise<void> {
  const client = await createClient(account)
  try {
    const folders = await client.list()
    // Prefer folder with \Sent special-use flag, fall back to common names
    const sentFolder = folders.find(f =>
      (f as unknown as Record<string, unknown>).specialUse === '\\Sent' ||
      f.flags?.has('\\Sent')
    ) ?? folders.find(f =>
      ['sent', 'sent items', 'sent messages'].includes(f.name.toLowerCase())
    )
    if (!sentFolder) return
    await client.append(sentFolder.path, raw, ['\\Seen'])
  } finally {
    await client.logout()
  }
}

/**
 * The four verbs this module was MISSING: the application could list folders, but
 * never create, rename, delete or empty one. All follow this file's rule:
 * `createClient` then `logout()` in a `finally`, never a connection left open on an
 * error.
 *
 * No access control here: whether an action is allowed is decided in
 * `lib/folderActions.ts` and refused in the route. This layer only executes.
 */
export async function createFolder(account: AccountConfig, path: string): Promise<void> {
  const client = await createClient(account)
  try {
    await client.mailboxCreate(path)
  } finally {
    await client.logout()
  }
}

export async function renameFolder(account: AccountConfig, path: string, newPath: string): Promise<void> {
  const client = await createClient(account)
  try {
    await client.mailboxRename(path, newPath)
  } finally {
    await client.logout()
  }
}

export async function deleteFolder(account: AccountConfig, path: string): Promise<void> {
  const client = await createClient(account)
  try {
    await client.mailboxDelete(path)
  } finally {
    await client.logout()
  }
}

/** Marks the WHOLE folder as read. `1:*` in sequence numbers: this is the one case in the
 *  module where UIDs add nothing, since the range targets the whole mailbox, not a selection. */
export async function markFolderRead(account: AccountConfig, path: string): Promise<void> {
  const client = await createClient(account)
  try {
    const mailbox = await client.mailboxOpen(path)
    if (mailbox.exists > 0) await client.messageFlagsAdd('1:*', ['\\Seen'])
  } finally {
    await client.logout()
  }
}

/** Empties the folder (\Deleted + EXPUNGE). Whether emptying is ALLOWED is decided higher up. */
export async function emptyFolder(account: AccountConfig, path: string): Promise<number> {
  const client = await createClient(account)
  try {
    const mailbox = await client.mailboxOpen(path)
    if (mailbox.exists === 0) return 0
    await client.messageDelete('1:*')
    return mailbox.exists
  } finally {
    await client.logout()
  }
}

/** Message count of a folder, without downloading anything: the delete confirmation
 *  shows this number to the user before they confirm. */
export async function folderMessageCount(account: AccountConfig, path: string): Promise<number> {
  const client = await createClient(account)
  try {
    const mailbox = await client.mailboxOpen(path, { readOnly: true })
    return mailbox.exists
  } finally {
    await client.logout()
  }
}

export async function listFolders(account: AccountConfig): Promise<Folder[]> {
  const client = await createClient(account)
  try {
    const list = await client.list()
    return list
      // Hide non-selectable containers (e.g. Gmail's [Gmail] parent folder)
      .filter(f => !f.flags?.has('\\Noselect'))
      .map(f => ({
        name: f.name,
        path: f.path,
        delimiter: f.delimiter ?? '/',
        flags: Array.from(f.flags ?? []),
        specialUse: (f as unknown as Record<string, unknown>).specialUse as string | undefined ?? undefined,
      }))
  } finally {
    await client.logout()
  }
}

/**
 * Number of IMAP connections opened in parallel by a multi-folder search. A connection
 * can only have one folder open at a time (mailbox lock), so covering a whole account
 * is shared across a few connections. Calibrated on a test account (100 folders, one
 * single-word query): one connection per folder > 300 s; one shared connection 152 s;
 * four connections 44 s. Beyond that, consumer IMAP servers start refusing
 * simultaneous connections.
 */
export const SEARCH_CONNECTIONS = 4

/** What a search reports: the messages RETURNED and the total number of matches. */
export type SearchOutcome = { messages: Message[]; total: number }

/**
 * The folders of an account, IN THE ORDER an "all folders" search should open them,
 * and without the empty folders.
 *
 * Two sources, a single round trip each:
 *  - `LIST` with `statusQuery` (LIST-STATUS extension, when the server advertises it)
 *    gives the message count of EVERY folder in one command: measured on the largest
 *    test account (101 folders) at 222 ms, against 6592 ms for 101 `STATUS` commands
 *    sent one after another. A server without LIST-STATUS simply returns folders with
 *    no count: they stay in the list (only a MEASURED zero drops a folder), and the
 *    search is then merely less well ordered.
 *  - the local cache (`messages_cache`) gives the date of the most recent known
 *    message per folder, which floats the live folders to the top.
 */
export async function listFoldersRanked(account: AccountConfig): Promise<string[]> {
  const client = await createClient(account)
  let entries: FolderRank[]
  try {
    const list = await client.list({ statusQuery: { messages: true } })
    entries = list
      .filter(f => !f.flags?.has('\\Noselect'))
      .map(f => ({
        path: f.path,
        specialUse: (f as unknown as Record<string, unknown>).specialUse as string | undefined ?? null,
        messages: f.status?.messages ?? null,
      }))
  } finally {
    await client.logout()
  }

  const freshness = new Map<string, string>()
  try {
    const rows = await query<{ folder: string; last_date: string | null }>(
      `SELECT folder, MAX(date) AS last_date FROM messages_cache WHERE account_id = $1 GROUP BY folder`,
      [account.id]
    )
    for (const r of rows) if (r.last_date) freshness.set(r.folder, new Date(r.last_date).toISOString())
  } catch {
    // The cache is only a RANKING: its absence degrades the order, never the result.
  }

  return orderFoldersForSearch(entries.map(e => ({ ...e, lastKnownDate: freshness.get(e.path) ?? null })))
}

/** What one folder has just reported, as soon as it reported it. */
export type SearchChunk = SearchOutcome & { folder: string; searched: number; folders: number }

/**
 * Searches folder by folder and STREAMS RESULTS AS THEY COME: an "all folders"
 * search becomes useful as soon as the first folder is returned, instead of waiting
 * for full coverage (measured: ~30 s for 101 folders, at ~300 ms each).
 *
 * `signal` cancels cleanly: the remaining folders are not opened and the connections
 * are closed by each worker's `finally`.
 */
export async function* searchMessagesByFolder(
  account: AccountConfig,
  folders: string[],
  terms: string[],
  signal?: AbortSignal
): AsyncGenerator<SearchChunk> {
  if (terms.length === 0 || folders.length === 0) return
  const queue = [...folders]
  // A minimal channel: the workers push, the generator pops. No library for three
  // lines, and the delivery order is the order of the RESPONSES, which is precisely
  // what we want to display.
  const ready: SearchChunk[] = []
  let wake: (() => void) | null = null
  const deliver = (chunk: SearchChunk) => { ready.push(chunk); wake?.(); wake = null }
  let searched = 0

  const worker = async () => {
    const client = await createClient(account)
    // Cancelling BETWEEN two folders is not enough: a `SEARCH` on a large folder
    // takes tens of seconds (measured 23 s on a folder holding 163783 messages),
    // during which the connection would stay open after the client has left. Closing
    // the connection aborts the in-flight command, which `logout()` does not, since
    // it politely waits for the server's response.
    const cut = () => { client.close() }
    signal?.addEventListener('abort', cut, { once: true })
    try {
      for (let folder = queue.shift(); folder !== undefined; folder = queue.shift()) {
        if (signal?.aborted) return
        try {
          const outcome = await searchOpenFolder(client, folder, terms)
          searched += 1
          deliver({ ...outcome, folder, searched, folders: folders.length })
        } catch {
          // An unreadable folder does not fail the whole search; it still counts as
          // covered, otherwise progress never reaches completion. A connection cut by
          // cancellation lands here too: the loop stops on the next iteration, at the
          // `signal` check.
          searched += 1
          deliver({ messages: [], total: 0, folder, searched, folders: folders.length })
        }
      }
    } finally {
      signal?.removeEventListener('abort', cut)
      await client.logout().catch(() => {})
    }
  }

  const running = Array.from({ length: Math.min(SEARCH_CONNECTIONS, folders.length) }, worker)
  const all = Promise.allSettled(running)
  let done = false
  all.then(() => { done = true; wake?.(); wake = null })

  while (!done || ready.length > 0) {
    if (ready.length === 0) { await new Promise<void>(resolve => { wake = resolve }); continue }
    yield ready.shift() as SearchChunk
  }
  // Propagate a failure that hit ALL workers (credentials refused, server
  // unreachable): without this the search would end reporting "0 results".
  const outcomes = await all
  if (outcomes.length > 0 && outcomes.every(o => o.status === 'rejected')) {
    throw (outcomes[0] as PromiseRejectedResult).reason
  }
}

/**
 * Searches SEVERAL folders while reusing the connections: opening one connection per
 * folder costs a TLS handshake plus a LOGIN every time, which makes an "all folders"
 * search unusable on a real account. An unreadable folder is ignored while others
 * remain to be covered.
 *
 * `terms` comes from `parseQuery` (lib/search.ts): ALL of them must match.
 */
export async function searchMessagesIn(
  account: AccountConfig,
  folders: string[],
  terms: string[]
): Promise<SearchOutcome> {
  if (terms.length === 0) return { messages: [], total: 0 }
  const queue = [...folders]
  const worker = async (): Promise<SearchOutcome> => {
    const client = await createClient(account)
    try {
      const found: Message[] = []
      let total = 0
      for (let folder = queue.shift(); folder !== undefined; folder = queue.shift()) {
        try {
          const outcome = await searchOpenFolder(client, folder, terms)
          found.push(...outcome.messages)
          total += outcome.total
        } catch (err) {
          if (folders.length === 1) throw err
        }
      }
      return { messages: found, total }
    } finally {
      await client.logout()
    }
  }
  const workers = Array.from({ length: Math.min(SEARCH_CONNECTIONS, folders.length) }, worker)
  const outcomes = await Promise.all(workers)
  return {
    messages: outcomes.flatMap(o => o.messages),
    total: outcomes.reduce((sum, o) => sum + o.total, 0),
  }
}

/**
 * Searches for ONE exact phrase in a folder. Used by thread grouping, which starts
 * from a normalized subject: splitting it into words would widen the thread to
 * unrelated messages.
 */
export async function searchMessages(
  account: AccountConfig,
  folder: string,
  queryStr: string
): Promise<Message[]> {
  return (await searchMessagesIn(account, [folder], [queryStr])).messages
}

/**
 * One term = one `SEARCH` querying every field of the contract with `OR`; the terms
 * are then crossed as an INTERSECTION of identifiers, which gives the expected AND
 * ("a b" and "b a" report the same set).
 *
 * Why not ONE single query? IMAP does chain its criteria with AND, but an imapflow
 * query object carries only one `or` key: two `OR` groups in the same query would
 * require a nested `NOT NOT`. One `SEARCH` per term only carries identifiers, on an
 * ALREADY open mailbox (measured 1.2 s per query on a consumer server).
 * ponytail: client-side intersection as long as the terms can be counted on one hand;
 * beyond that, the single query is what should be built, not more round trips.
 */
async function searchOpenFolder(
  client: ImapFlow,
  folder: string,
  terms: string[]
): Promise<SearchOutcome> {
  const lock = await client.getMailboxLock(folder)
  try {
    let matching: number[] | null = null
    for (const term of terms) {
      // `{ uid: true }` is mandatory: without it the server returns SEQUENCE NUMBERS,
      // which the `fetch` below would read back as UIDs, hence the wrong messages as
      // soon as any message has been deleted from the folder.
      const result = await client.search(
        { or: SEARCH_FIELDS.map(field => ({ [field]: term })) },
        { uid: true }
      )
      const uids = Array.isArray(result) ? result : []
      if (matching === null) matching = uids
      else {
        const keep = new Set(uids)
        matching = matching.filter(uid => keep.has(uid))
      }
      if (matching.length === 0) break
    }
    const allUids = matching ?? []
    const recentUids = [...allUids].reverse().slice(0, SEARCH_RESULT_LIMIT)

    const messages: Message[] = []
    if (recentUids.length > 0) {
      // The third argument is what turns this FETCH into a `UID FETCH`; `uid: true` in
      // the second one only ASKS for the UID field. Both are required: without the
      // third, the identifiers returned by the search would be read back as sequence
      // numbers (measured: 0 messages returned out of 212 found).
      for await (const msg of client.fetch(recentUids.join(','), {
        uid: true, flags: true, envelope: true, bodyStructure: true, internalDate: true,
      }, { uid: true })) {
        messages.push({
          uid: String(msg.uid),
          messageId: msg.envelope?.messageId ?? '',
          from: {
            name: msg.envelope?.from?.[0]?.name ?? '',
            address: msg.envelope?.from?.[0]?.address ?? '',
          },
          to: (msg.envelope?.to ?? []).map(a => ({ name: a.name ?? '', address: a.address ?? '' })),
          subject: msg.envelope?.subject ?? '(no subject)',
          date: messageDate(msg.envelope?.date, msg.internalDate),
          preview: '',
          isRead: msg.flags?.has('\\Seen') ?? false,
          isStarred: msg.flags?.has(FLAG_IMAP_FLAG) ?? false,
          isFlagged: msg.flags?.has(FLAG_IMAP_FLAG) ?? false,
          flag: flagFromKeywords(msg.flags),
          hasAttachments: detectAttachments(msg.bodyStructure as unknown as Record<string, unknown>),
          folder,
          accountId: '',
        })
      }
    }
    return { messages, total: allUids.length }
  } finally {
    lock.release()
  }
}
