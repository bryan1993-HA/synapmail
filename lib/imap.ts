import { ImapFlow } from 'imapflow'
import { decrypt } from './encrypt'
import type { Message, Folder } from '@/types/email'

interface AccountConfig {
  imapHost: string
  imapPort: number
  imapSecure: boolean
  username: string
  passwordEncrypted: string
}

async function createClient(account: AccountConfig): Promise<ImapFlow> {
  const password = decrypt(account.passwordEncrypted)
  const client = new ImapFlow({
    host: account.imapHost,
    port: account.imapPort,
    secure: account.imapSecure,
    auth: { user: account.username, pass: password },
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
  filter: 'all' | 'unread' | 'starred' = 'all'
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
          hasAttachments: false,
          folder,
          accountId: '',
        })
      }
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

    const source = msg.source?.toString() ?? ''

    return {
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
      hasAttachments: false,
      bodyPlain: source,
      folder,
      accountId: '',
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
