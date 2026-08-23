import { query } from './db'
import { encrypt, decrypt } from './encrypt'

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
  is_default: boolean
  color: string
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
            is_default, color, oauth_provider, created_at
     FROM email_accounts WHERE user_id = $1 ORDER BY is_default DESC, created_at ASC`,
    [userId]
  )
}

export const encryptPassword = encrypt
export const decryptPassword = decrypt
