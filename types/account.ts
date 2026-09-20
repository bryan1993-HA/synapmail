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
  /** Prompt-injection guard for this mailbox (default on) — see lib/promptGuard.ts. */
  promptGuard: boolean
  /** Badge colour chosen by the owner, `null` = automatic colour by rank — see lib/accountColor.ts. */
  badgeColor?: string | null
  createdAt: string
  /** Unread count in the account's top-level INBOX — authoritative IMAP SEARCH UNSEEN
   *  (mailbox_stats), falling back to cached-row count. GET /api/accounts only. */
  unreadCount?: number
  /** True when this account was shared with the current user rather than owned by them. GET /api/accounts only. */
  isShared?: boolean
  /** Id of the `account_shares` row granting this access — only set when `isShared`. */
  shareId?: string | null
  ownerName?: string | null
  expiresAt?: string | null
  permissions?: {
    canSend: boolean
    canDelete: boolean
    canOrganize: boolean
    canManageRules: boolean
    canManageSignatures: boolean
  }
}

export interface AccountShare {
  id: string
  status: 'pending' | 'active' | 'revoked' | 'expired'
  inviteeEmail: string
  inviteeName: string
  permissions: {
    canSend: boolean
    canDelete: boolean
    canOrganize: boolean
    canManageRules: boolean
    canManageSignatures: boolean
  }
  expiresAt: string | null
  acceptedAt: string | null
  revokedAt: string | null
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

/** Never carries the raw key or its hash — those exist only at creation time / server-side. */
export interface ApiKey {
  id: string
  name: string
  keyPrefix: string
  lastUsedAt: string | null
  createdAt: string
  /** Bearer requests logged for this key in the last 24h — see api_key_requests. */
  requestCount24h: number
}

/** One row from GET /api/api-keys/[id]/logs — a single logged Bearer request. */
export interface ApiKeyRequestLog {
  id: string
  method: string
  path: string
  ipAddress: string | null
  createdAt: string
}
