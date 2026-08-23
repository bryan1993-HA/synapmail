export interface EmailAccount {
  id: string
  userId: string
  name: string
  email: string
  imapHost: string
  imapPort: number
  imapSecure: boolean
  smtpHost: string
  smtpPort: number
  smtpSecure: boolean
  username: string
  isDefault: boolean
  color: string
  oauthProvider?: 'google' | 'microsoft' | null
  createdAt: string
}

export interface User {
  id: string
  email: string
  name: string
  role: 'admin' | 'user'
  avatarUrl?: string
  createdAt: string
}

export interface Signature {
  id: string
  userId: string
  accountId: string | null
  name: string
  contentHtml: string
  isDefault: boolean
}
