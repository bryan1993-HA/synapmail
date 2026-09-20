import { query } from './db'
import { encrypt, decrypt } from './encrypt'
import { getAccessibleAccount } from './accountAccess'
import { accountOrderBy } from './accountColor'

export { accountOrderBy }

export interface DbEmailAccount {
  id: string
  user_id: string
  name: string
  email: string
  imap_host: string
  imap_port: number
  imap_secure: boolean
  smtp_host: string
  smtp_port: number
  smtp_secure: boolean
  username: string
  password_encrypted: string
  oauth_provider: string | null
  oauth_access_token: string | null
  oauth_refresh_token: string | null
  oauth_expires_at: number | null
  is_default: boolean
  color: string
  /** Prompt-injection guard for this mailbox — see lib/promptGuard.ts. */
  prompt_guard: boolean
  created_at: string
}

export async function getDefaultAccount(userId: string): Promise<DbEmailAccount | null> {
  const accounts = await query<DbEmailAccount>(
    'SELECT * FROM email_accounts WHERE user_id = $1 AND is_default = true LIMIT 1',
    [userId]
  )
  return accounts[0] ?? null
}

export async function getAccountById(id: string, userId: string): Promise<DbEmailAccount | null> {
  const accounts = await query<DbEmailAccount>(
    'SELECT * FROM email_accounts WHERE id = $1 AND user_id = $2 LIMIT 1',
    [id, userId]
  )
  return accounts[0] ?? null
}

export async function listAccounts(userId: string): Promise<Omit<DbEmailAccount, 'password_encrypted'>[]> {
  return query(
    `SELECT id, user_id, name, email, imap_host, imap_port, imap_secure,
            smtp_host, smtp_port, smtp_secure, username,
            is_default, color, prompt_guard, oauth_provider, created_at
     FROM email_accounts WHERE user_id = $1 ${accountOrderBy()}`,
    [userId]
  )
}

/**
 * Whether the prompt-injection guard applies to a piece of mail content.
 *
 * Fails CLOSED: the guard is only ever lifted when the mailbox is found and its
 * owner has explicitly switched it off. A mailbox that cannot be resolved — an
 * unknown or malformed id, one the caller has no access to, a database error —
 * keeps the guard on, as does a user with no mailbox at all. A mailbox reached
 * through a share is read with the same access rule as the message routes, and
 * the setting that applies is the one its OWNER chose.
 *
 * With no mailbox named by the caller, the guard is on as soon as ONE of the
 * user's mailboxes asks for it, so unattributed content is never trusted.
 */
export async function promptGuardApplies(userId: string, accountId?: string | null): Promise<boolean> {
  try {
    if (accountId) {
      const account = await getAccessibleAccount(accountId, userId)
      return account?.prompt_guard ?? true
    }
    const rows = await query<{ on: boolean | null }>(
      'SELECT bool_or(prompt_guard) AS on FROM email_accounts WHERE user_id = $1',
      [userId]
    )
    return rows[0]?.on ?? true
  } catch {
    return true
  }
}

export const encryptPassword = encrypt
export const decryptPassword = decrypt

/**
 * `email_accounts` row → IMAP configuration. The conversion used to be repeated in every
 * route that opens a connection; a renamed column would have survived there silently.
 * It accepts anything carrying these columns (a full row or a partial `SELECT`).
 */
export type ImapAccountRow = Pick<
  DbEmailAccount,
  'id' | 'imap_host' | 'imap_port' | 'imap_secure' | 'username' | 'password_encrypted'
  | 'oauth_provider' | 'oauth_access_token' | 'oauth_refresh_token' | 'oauth_expires_at'
>

export function toImapConfig(a: ImapAccountRow) {
  return {
    id: a.id,
    imapHost: a.imap_host,
    imapPort: a.imap_port,
    imapSecure: a.imap_secure,
    username: a.username,
    passwordEncrypted: a.password_encrypted,
    oauthProvider: a.oauth_provider,
    oauthAccessToken: a.oauth_access_token,
    oauthRefreshToken: a.oauth_refresh_token,
    oauthExpiresAt: a.oauth_expires_at,
  }
}
