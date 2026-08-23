export interface Message {
  uid: string
  messageId: string
  from: EmailAddress
  to: EmailAddress[]
  cc?: EmailAddress[]
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
