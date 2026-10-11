import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import { decrypt } from './encrypt'
import { refreshAccessToken } from './msOAuth'
import { query } from './db'
import { upsertContact } from './contacts'
import { DEFAULT_FLAG_KEY, FLAG_BIT_KEYWORDS, FLAG_IMAP_FLAG, flagFromKeywords, keywordsForFlag } from './flags'
import type { MailListFilter } from './flags'
import { SEARCH_FIELDS, SEARCH_RESULT_LIMIT, orderFoldersForSearch, splitFolderPasses } from './search'
import type { FolderRank } from './search'
import type { Message, Folder, AuthResults } from '@/types/email'

/**
 * Date d'un message pour l'app : l'en-tête Date (enveloppe) quand il est
 * présent et valide, sinon la date interne IMAP (réception/dépôt sur le serveur),
 * qui existe toujours. Certains mails générés par des scripts n'ont pas d'en-tête
 * Date exploitable : sans repli, l'API renvoyait '' et l'interface « Invalid Date ».
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
  // Without an 'error' listener a transport drop becomes an uncaught exception and takes
  // the process down; this must be attached BEFORE connect(): a drop during the handshake
  // rejects connect() and then still emits 'error' (imapflow 1.7.2). Every pending command
  // is rejected by imapflow's own close(), so the event carries nothing a caller needs.
  client.on('error', () => {})
  try {
    await client.connect()
  } catch (err) {
    // A rejected login leaves the TCP socket open (imapflow 1.7.2 only tears it down on
    // transport errors and timeouts) and the caller never sees the client to close it.
    client.close()
    throw err
  }
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
    const messages: Message[] = []
    if (pageSeqs.length > 0) {
      // Both branches above produce SEQUENCE numbers, and this range is read as such:
      // `{ uid: true }` must be added to the SEARCH and to this fetch's options together,
      // or never — adding it to one alone silently breaks the filtered pagination.
      for await (const msg of client.fetch(pageSeqs as unknown as string, {
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

    // Upsert messages_cache — fire-and-forget, non-bloquant
    // RETURNING xmax: 0 = nouvelle ligne (message jamais vu) → tracker le contact une seule fois
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
            // xmax = 0 → INSERT réel (message découvert pour la première fois) → 1 seule incrémentation
            // Exclure sa propre adresse (ex: TrueNAS envoie depuis l'adresse de l'utilisateur)
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
 * Pose (ou retire) un drapeau de couleur sur un jeu de messages. La couleur est
 * portée par les mots-clés d'Apple (voir lib/flags.ts) : on retire d'abord TOUS
 * les bits, sinon une couleur en remplaçant une autre garderait les bits de la
 * précédente et donnerait une troisième couleur.
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
 * Source BRUTE de plusieurs messages d'un même dossier, pour les transférer
 * en pièces jointes (lot M5). Une SEULE connexion pour toute la sélection :
 * ouvrir puis fermer une session IMAP par message coûte cher sur les serveurs
 * mesurés. L'objet vient de l'enveloppe, donc le message n'est pas réanalysé
 * juste pour nommer le fichier.
 *
 * Deux passes, dans cet ordre : les TAILLES d'abord (`RFC822.SIZE`, aucun
 * octet de corps), puis les sources seulement si le total tient sous le
 * plafond — sinon une boîte volumineuse serait entièrement chargée en mémoire
 * avant qu'on ait le droit de la refuser.
 *
 * Le résultat porte son propre verdict : `missing` liste les uid demandés que
 * le dossier ne contient plus (message déplacé entre la sélection et l'envoi).
 * L'appelant n'a rien à comparer — un transfert amputé ne peut pas partir par
 * simple oubli.
 */
export interface MessageSourcesResult {
  sources: Array<{ uid: string; subject: string; source: Buffer }>
  /** uid demandés, absents du dossier au moment de la relecture. */
  missing: string[]
  /** Somme des tailles annoncées par le serveur, quand le plafond est dépassé. */
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

    // Passe 1 — tailles seules. `size` vient de RFC822.SIZE : le serveur
    // l'annonce sans transmettre le message.
    const sizeByUid = new Map<string, number>()
    for await (const msg of client.fetch(uids.join(','), { uid: true, size: true }, { uid: true })) {
      sizeByUid.set(String(msg.uid), msg.size ?? 0)
    }
    const missing = uids.filter(uid => !sizeByUid.has(uid))
    if (missing.length) return { ...empty, missing }

    const totalBytes = uids.reduce((sum, uid) => sum + (sizeByUid.get(uid) ?? 0), 0)
    if (totalBytes > maxTotalBytes) return { ...empty, totalBytes, oversized: true }

    // Passe 2 — les sources, maintenant qu'on sait qu'elles tiennent.
    const byUid = new Map<string, { uid: string; subject: string; source: Buffer }>()
    for await (const msg of client.fetch(uids.join(','), { uid: true, envelope: true, source: true }, { uid: true })) {
      if (!msg.source) continue
      byUid.set(String(msg.uid), {
        uid: String(msg.uid),
        subject: msg.envelope?.subject ?? '',
        source: msg.source,
      })
    }
    // IMAP rend les messages dans l'ordre des uid, pas dans celui de la
    // sélection : on rétablit l'ordre demandé, pour que les pièces jointes
    // suivent ce que l'oeil a coché.
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
 * Les quatre verbes qui MANQUAIENT à ce module : l'application savait lister les
 * dossiers, jamais en créer, renommer, supprimer ni vider un. Tous suivent la règle
 * du fichier — `createClient` puis `logout()` dans un `finally`, jamais une connexion
 * laissée ouverte sur une erreur.
 *
 * Aucun contrôle d'accès ici : le droit de faire se décide dans `lib/folderActions.ts`
 * et se refuse dans la route. Ce niveau ne fait qu'exécuter.
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

/** Marque TOUT le dossier comme lu. `1:*` en numéros de séquence : c'est le seul cas du
 *  module où l'UID n'apporte rien — la plage vise la boîte entière, pas des messages choisis. */
export async function markFolderRead(account: AccountConfig, path: string): Promise<void> {
  const client = await createClient(account)
  try {
    const mailbox = await client.mailboxOpen(path)
    if (mailbox.exists > 0) await client.messageFlagsAdd('1:*', ['\\Seen'])
  } finally {
    await client.logout()
  }
}

/** Vide le dossier (\Deleted + EXPUNGE). Le DROIT de vider se décide plus haut. */
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

/** Nombre de messages d'un dossier, sans rien rapatrier — la confirmation de suppression
 *  le nomme à l'utilisateur avant qu'il valide. */
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
 * Nombre de connexions IMAP ouvertes en parallèle par une recherche multi-dossiers.
 * Une connexion ne peut ouvrir qu'un dossier à la fois (verrou de boîte), donc la
 * couverture d'un compte entier se partage entre quelques connexions. Calibré sur
 * le compte de test (IONOS, 100 dossiers, requête « facture ») : 1 connexion par
 * dossier > 300 s ; 1 connexion partagée 152 s ; 4 connexions 44 s. Au-delà, les
 * serveurs IMAP grand public commencent à refuser les connexions simultanées.
 */
export const SEARCH_CONNECTIONS = 4

/** Ce qu'une recherche rapporte : les messages RENDUS et le nombre de correspondances. */
export type SearchOutcome = { messages: Message[]; total: number }

/**
 * Les dossiers d'un compte, DANS L'ORDRE où une recherche « tous les dossiers »
 * doit les ouvrir, et sans les dossiers vides.
 *
 * Deux sources, un seul aller-retour chacune :
 *  - `LIST` avec `statusQuery` (extension LIST-STATUS, annoncée par IONOS) donne
 *    le nombre de messages de CHAQUE dossier en une commande — mesuré sur la plus
 *    grosse boîte de test (101 dossiers) : 222 ms, contre 6 592 ms pour 101
 *    `STATUS` envoyés l'un après l'autre. Un serveur sans LIST-STATUS renvoie
 *    simplement des dossiers sans compte : ils restent dans la liste (seul un zéro
 *    MESURÉ écarte un dossier), la recherche est alors seulement moins bien triée.
 *  - le cache local (`messages_cache`) donne la date du message le plus récent
 *    connu par dossier, ce qui fait remonter les dossiers vivants.
 */
async function rankFolders(account: AccountConfig): Promise<FolderRank[]> {
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
    // Le cache n'est qu'un CLASSEMENT : son absence dégrade l'ordre, jamais le résultat.
  }

  return entries.map(e => ({ ...e, lastKnownDate: freshness.get(e.path) ?? null }))
}

/** Les dossiers d'une boîte, du plus utile au moins utile (lot S2). */
export async function listFoldersRanked(account: AccountConfig): Promise<string[]> {
  return orderFoldersForSearch(await rankFolders(account))
}

/**
 * Les dossiers d'une boîte en DEUX passes : réception + envoyés d'abord, le reste
 * ensuite. La portée « toutes les boîtes » fait la première passe de CHAQUE boîte
 * avant d'attaquer les secondes, pour que la dernière boîte ne soit pas servie
 * derrière les 97 dossiers d'une autre.
 */
export async function listFolderPasses(account: AccountConfig): Promise<{ first: string[]; rest: string[] }> {
  return splitFolderPasses(await rankFolders(account))
}

/** Ce qu'un dossier vient de rapporter, dès qu'il l'a rapporté. */
export type SearchChunk = SearchOutcome & { folder: string; searched: number; folders: number }

/**
 * Cherche dossier par dossier et RESTITUE AU FIL DE L'EAU : la recherche « tous
 * les dossiers » devient utile dès le premier dossier rendu, au lieu d'attendre
 * la couverture complète (mesuré : ~30 s pour 101 dossiers, à ~300 ms l'un).
 *
 * `signal` coupe proprement : les dossiers restants ne sont pas ouverts et les
 * connexions sont fermées par le `finally` de chaque ouvrier.
 */
export async function* searchMessagesByFolder(
  account: AccountConfig,
  folders: string[],
  terms: string[],
  signal?: AbortSignal
): AsyncGenerator<SearchChunk> {
  if (terms.length === 0 || folders.length === 0) return
  const queue = [...folders]
  // Un canal minimal : les ouvriers déposent, le générateur retire. Pas de
  // bibliothèque pour trois lignes, et l'ordre de restitution est celui des
  // RÉPONSES, qui est précisément ce qu'on veut afficher.
  const ready: SearchChunk[] = []
  let wake: (() => void) | null = null
  const deliver = (chunk: SearchChunk) => { ready.push(chunk); wake?.(); wake = null }
  let searched = 0

  const worker = async () => {
    const client = await createClient(account)
    // Couper ENTRE deux dossiers ne suffit pas : un `SEARCH` sur un gros dossier
    // dure des dizaines de secondes (mesuré 23 s sur un dossier de 163 783
    // messages), pendant lesquelles la connexion resterait ouverte après le départ
    // du client. Fermer la connexion interrompt la commande en cours, ce que
    // `logout()` — qui attend poliment la réponse du serveur — ne fait pas.
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
          // Un dossier illisible ne fait pas échouer la recherche entière ; il
          // compte quand même comme couvert, sinon la progression n'arrive jamais à
          // son terme. Une connexion coupée par l'abandon passe ici aussi : la
          // boucle s'arrête au tour suivant, sur le test de `signal`.
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
  // Propage une panne qui aurait touché TOUS les ouvriers (identifiants refusés,
  // serveur injoignable) : sans cela la recherche se terminerait « 0 résultat ».
  const outcomes = await all
  if (outcomes.length > 0 && outcomes.every(o => o.status === 'rejected')) {
    throw (outcomes[0] as PromiseRejectedResult).reason
  }
}

/**
 * Cherche dans PLUSIEURS dossiers en réutilisant les connexions : ouvrir une
 * connexion par dossier coûte une poignée de main TLS + un LOGIN à chaque fois,
 * ce qui rend la recherche « tous les dossiers » inutilisable sur un compte réel.
 * Un dossier illisible est ignoré quand d'autres restent à couvrir.
 *
 * `terms` vient de `parseQuery` (lib/search.ts) : TOUS doivent correspondre.
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
 * Cherche UNE expression exacte dans un dossier. Utilisé par le regroupement en
 * fil de discussion, qui part d'un objet normalisé : le découper en mots
 * élargirait le fil à des messages sans rapport.
 */
export async function searchMessages(
  account: AccountConfig,
  folder: string,
  queryStr: string
): Promise<Message[]> {
  return (await searchMessagesIn(account, [folder], [queryStr])).messages
}

/**
 * Un terme = un `SEARCH` qui interroge tous les champs du contrat en `OR` ; les
 * termes sont croisés en INTERSECTION d'identifiants, ce qui donne le ET attendu
 * (« 3d cpi » et « cpi 3d » rapportent le même ensemble).
 *
 * Pourquoi pas UNE seule requête ? IMAP enchaîne bien ses critères en ET, mais un
 * objet de requête imapflow ne porte qu'une clé `or` : deux groupes `OR` dans la
 * même requête demanderaient un `NOT NOT` imbriqué. Un `SEARCH` par terme ne
 * transporte que des identifiants, sur une boîte DÉJÀ ouverte (mesuré 1,2 s par
 * requête sur IONOS).
 * ponytail: intersection côté client tant que les termes se comptent sur une main ;
 * au-delà, c'est la requête unique qu'il faudrait construire, pas plus de tours.
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
      // `{ uid: true }` est indispensable : sans lui le serveur renvoie des NUMÉROS
      // DE SÉQUENCE, que le `fetch` ci-dessous relirait comme des UID — donc les
      // mauvais messages dès qu'un message a été supprimé du dossier.
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
      // Le troisième argument est ce qui fait de ce FETCH un `UID FETCH` ; `uid: true`
      // dans le second ne fait que DEMANDER le champ UID. Les deux sont nécessaires :
      // sans le troisième, les identifiants renvoyés par la recherche seraient relus
      // comme des numéros de séquence (mesuré : 0 message rendu sur 212 trouvés).
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

/** Ce qu'un dossier rapporte à une recherche par en-tête : ses uid et les bornes de dates. */
export type HeaderMatches = {
  folder: string
  uids: string[]
  /** Date du plus ancien et du plus récent, ISO, `null` quand le dossier ne rapporte rien. */
  oldest: string | null
  newest: string | null
}

/**
 * Cherche dans PLUSIEURS dossiers les messages dont UN en-tête porte `value`,
 * et rapporte leurs uid dossier par dossier, avec les bornes de dates.
 *
 * Même forme que `searchMessagesIn` juste au-dessus — même file de dossiers,
 * mêmes `SEARCH_CONNECTIONS` ouvriers, même règle d'erreur (un dossier illisible
 * est ignoré quand d'autres restent à couvrir, propagé quand il est le seul) —
 * parce que c'est la même contrainte : une connexion n'ouvre qu'un dossier à la
 * fois, et ouvrir une connexion par dossier rend la couverture d'un compte réel
 * inutilisable.
 *
 * Ce qui diffère : le critère est `HEADER <nom> <valeur>` (RFC 3501 §6.4.4,
 * sous-chaîne, insensible à la casse chez le serveur) au lieu des champs de
 * `SEARCH_FIELDS`, et AUCUN message n'est rendu — seulement des uid, une date
 * de plus ancien et une de plus récent. Un historique de newsletter se compte
 * en milliers de messages : les rendre coûterait un FETCH complet là où
 * l'appelant n'a besoin que de savoir COMBIEN et QUOI déplacer.
 *
 * Les bornes viennent d'un `FETCH internalDate` — une date du serveur, pas
 * l'en-tête `Date` que l'expéditeur écrit lui-même.
 */
export async function searchHeaderIn(
  account: AccountConfig,
  folders: string[],
  header: string,
  value: string
): Promise<HeaderMatches[]> {
  if (!header || !value || folders.length === 0) return []
  const queue = [...folders]
  const worker = async (): Promise<HeaderMatches[]> => {
    const client = await createClient(account)
    try {
      const found: HeaderMatches[] = []
      for (let folder = queue.shift(); folder !== undefined; folder = queue.shift()) {
        try {
          const outcome = await searchHeaderOpenFolder(client, folder, header, value)
          if (outcome.uids.length > 0) found.push(outcome)
        } catch (err) {
          if (folders.length === 1) throw err
        }
      }
      return found
    } finally {
      await client.logout().catch(() => {})
    }
  }
  const workers = Array.from({ length: Math.min(SEARCH_CONNECTIONS, folders.length) }, worker)
  return (await Promise.all(workers)).flat()
}

/** Un dossier déjà ouvert : les uid dont l'en-tête correspond, et leurs bornes. */
async function searchHeaderOpenFolder(
  client: ImapFlow,
  folder: string,
  header: string,
  value: string
): Promise<HeaderMatches> {
  const lock = await client.getMailboxLock(folder)
  try {
    // `{ uid: true }` est indispensable ici pour la même raison que dans
    // `searchOpenFolder` : sans lui le serveur renvoie des NUMÉROS DE SÉQUENCE,
    // que le déplacement relirait comme des uid — donc les mauvais messages.
    const result = await client.search({ header: { [header]: value } }, { uid: true })
    const uids = Array.isArray(result) ? result : []
    if (uids.length === 0) return { folder, uids: [], oldest: null, newest: null }

    // Les deux extrémités seulement : les uid d'un dossier IMAP croissent avec
    // le dépôt, donc le premier et le dernier bornent l'historique sans lire les
    // milliers de messages entre les deux.
    const ends = [uids[0], uids[uids.length - 1]]
    const dates: string[] = []
    for await (const msg of client.fetch(
      Array.from(new Set(ends)).join(','),
      { uid: true, internalDate: true },
      { uid: true }
    )) {
      const date = messageDate(msg.internalDate)
      if (date) dates.push(date)
    }
    dates.sort()
    return {
      folder,
      uids: uids.map(String),
      oldest: dates[0] ?? null,
      newest: dates[dates.length - 1] ?? null,
    }
  } finally {
    lock.release()
  }
}
