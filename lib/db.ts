import { Pool } from 'pg'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
})

export async function query<T = Record<string, unknown>>(
  sql: string,
  values?: unknown[]
): Promise<T[]> {
  const { rows } = await pool.query(sql, values)
  return rows as T[]
}

export async function initDb(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email VARCHAR(255) UNIQUE NOT NULL,
      name VARCHAR(255) NOT NULL,
      password_hash TEXT NOT NULL,
      role VARCHAR(20) NOT NULL DEFAULT 'user',
      avatar_url TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)

  await query(`
    CREATE TABLE IF NOT EXISTS email_accounts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL,
      email VARCHAR(255) NOT NULL,
      imap_host VARCHAR(255) NOT NULL,
      imap_port INTEGER NOT NULL DEFAULT 993,
      imap_secure BOOLEAN NOT NULL DEFAULT true,
      smtp_host VARCHAR(255) NOT NULL,
      smtp_port INTEGER NOT NULL DEFAULT 587,
      smtp_secure BOOLEAN NOT NULL DEFAULT false,
      username VARCHAR(255) NOT NULL,
      password_encrypted TEXT NOT NULL,
      oauth_provider VARCHAR(50),
      oauth_access_token TEXT,
      oauth_refresh_token TEXT,
      oauth_expires_at BIGINT,
      is_default BOOLEAN NOT NULL DEFAULT false,
      color VARCHAR(20) NOT NULL DEFAULT '#6366f1',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)

  await query(`
    CREATE TABLE IF NOT EXISTS signatures (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      account_id UUID REFERENCES email_accounts(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL,
      content_html TEXT NOT NULL DEFAULT '',
      is_default BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)

  await query(`
    CREATE TABLE IF NOT EXISTS messages_cache (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      account_id UUID NOT NULL REFERENCES email_accounts(id) ON DELETE CASCADE,
      folder VARCHAR(255) NOT NULL,
      uid VARCHAR(255) NOT NULL,
      message_id VARCHAR(512),
      from_address VARCHAR(255),
      from_name VARCHAR(255),
      subject TEXT,
      date TIMESTAMPTZ,
      is_read BOOLEAN DEFAULT false,
      is_starred BOOLEAN DEFAULT false,
      is_flagged BOOLEAN DEFAULT false,
      has_attachments BOOLEAN DEFAULT false,
      preview TEXT,
      thread_id VARCHAR(512),
      cached_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(account_id, folder, uid)
    )
  `)

  await query(`
    CREATE TABLE IF NOT EXISTS user_settings (
      user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      theme VARCHAR(20) NOT NULL DEFAULT 'system',
      language VARCHAR(10) NOT NULL DEFAULT 'en',
      messages_per_page INTEGER NOT NULL DEFAULT 30,
      thread_view BOOLEAN NOT NULL DEFAULT true,
      reading_pane BOOLEAN NOT NULL DEFAULT true,
      notifications BOOLEAN NOT NULL DEFAULT true,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)

  // Migrations — colonnes ajoutées après la création initiale
  await query(`ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS undo_send_delay INTEGER NOT NULL DEFAULT 10`)

  await query(`
    CREATE TABLE IF NOT EXISTS contacts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL DEFAULT '',
      email VARCHAR(255) NOT NULL,
      frequency INTEGER NOT NULL DEFAULT 1,
      sent_count INTEGER NOT NULL DEFAULT 0,
      received_count INTEGER NOT NULL DEFAULT 0,
      last_contact_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      is_starred BOOLEAN NOT NULL DEFAULT false,
      is_manual BOOLEAN NOT NULL DEFAULT false,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, email)
    )
  `)
  await query(`CREATE INDEX IF NOT EXISTS contacts_user_email_idx ON contacts(user_id, email)`)
  await query(`CREATE INDEX IF NOT EXISTS contacts_user_score_idx ON contacts(user_id, is_starred, frequency, last_contact_at)`)

  await query(`
    CREATE TABLE IF NOT EXISTS sent_tracking (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      token VARCHAR(36) UNIQUE NOT NULL,
      message_id VARCHAR(512),
      account_id UUID REFERENCES email_accounts(id) ON DELETE CASCADE,
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      sent_to TEXT NOT NULL,
      subject TEXT,
      opened_at TIMESTAMPTZ,
      open_count INTEGER NOT NULL DEFAULT 0,
      user_agent TEXT,
      ip_address VARCHAR(45),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await query(`CREATE INDEX IF NOT EXISTS sent_tracking_token_idx ON sent_tracking(token)`)
  await query(`CREATE INDEX IF NOT EXISTS sent_tracking_user_msgid_idx ON sent_tracking(user_id, message_id)`)

  await query(`
    CREATE TABLE IF NOT EXISTS scheduled_emails (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      account_id UUID NOT NULL REFERENCES email_accounts(id) ON DELETE CASCADE,
      to_addresses TEXT NOT NULL,
      cc_addresses TEXT,
      bcc_addresses TEXT,
      subject TEXT NOT NULL,
      html TEXT,
      in_reply_to TEXT,
      forwarded_attachments TEXT,
      send_at TIMESTAMPTZ NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      error TEXT,
      sent_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)

  await query(`
    CREATE TABLE IF NOT EXISTS email_rules (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      account_id UUID NOT NULL REFERENCES email_accounts(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT true,
      priority INTEGER NOT NULL DEFAULT 0,
      condition_logic VARCHAR(10) NOT NULL DEFAULT 'all',
      conditions JSONB NOT NULL DEFAULT '[]',
      actions JSONB NOT NULL DEFAULT '[]',
      stop_processing BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await query(`CREATE INDEX IF NOT EXISTS email_rules_user_idx ON email_rules(user_id)`)
  await query(`CREATE INDEX IF NOT EXISTS email_rules_account_idx ON email_rules(account_id)`)
  await query(`CREATE INDEX IF NOT EXISTS email_rules_enabled_idx ON email_rules(account_id, enabled, priority)`)

  await query(`
    CREATE TABLE IF NOT EXISTS compose_templates (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL,
      subject VARCHAR(500) NOT NULL DEFAULT '',
      content_html TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await query(`CREATE INDEX IF NOT EXISTS compose_templates_user_idx ON compose_templates(user_id)`)

  // Migrations — stats columns added after initial creation
  await query(`ALTER TABLE email_rules ADD COLUMN IF NOT EXISTS last_run_at TIMESTAMPTZ`)
  await query(`ALTER TABLE email_rules ADD COLUMN IF NOT EXISTS total_processed INTEGER NOT NULL DEFAULT 0`)
  await query(`ALTER TABLE email_rules ADD COLUMN IF NOT EXISTS total_matched INTEGER NOT NULL DEFAULT 0`)

  await query(`
    CREATE TABLE IF NOT EXISTS rule_execution_log (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      rule_id UUID NOT NULL REFERENCES email_rules(id) ON DELETE CASCADE,
      account_id UUID NOT NULL REFERENCES email_accounts(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      folder VARCHAR(255) NOT NULL,
      executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      processed INTEGER NOT NULL DEFAULT 0,
      matched INTEGER NOT NULL DEFAULT 0
    )
  `)
  await query(`CREATE INDEX IF NOT EXISTS rule_exec_log_rule_idx ON rule_execution_log(rule_id, executed_at DESC)`)
  await query(`CREATE INDEX IF NOT EXISTS rule_exec_log_user_idx ON rule_execution_log(user_id, executed_at DESC)`)
}

export default pool
