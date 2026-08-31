export interface AuthResults {
  spf: 'pass' | 'fail' | 'none'
  dkim: 'pass' | 'fail' | 'none'
  dmarc: 'pass' | 'fail' | 'none'
}

export interface Message {
  uid: string
  messageId: string
  from: EmailAddress
  to: EmailAddress[]
  cc?: EmailAddress[]
  replyTo?: EmailAddress
  subject: string
  date: string
  preview: string
  isRead: boolean
  isStarred: boolean
  isFlagged: boolean
  hasAttachments: boolean
  threadId?: string
  folder: string
  accountId: string
  bodyHtml?: string
  bodyPlain?: string
  attachments?: Attachment[]
  listUnsubscribe?: string
  authResults?: AuthResults
  dispositionNotificationTo?: string
  size?: number       // message size in bytes (from IMAP)
  xPriority?: number  // X-Priority header value (1=highest, 5=lowest)
}

export interface ReadReceipt {
  opened: boolean
  openedAt: string | null
  openCount: number
}

export interface EmailAddress {
  name: string
  address: string
}

export interface Attachment {
  id: string
  filename: string
  contentType: string
  size: number
}

export interface Folder {
  name: string
  path: string
  delimiter: string
  flags: string[]
  unread?: number
  total?: number
  children?: Folder[]
}

export interface Thread {
  threadId: string
  subject: string
  messages: Message[]
  unreadCount: number
  lastDate: string
}
