import { query } from './db'
import { sendMail } from './smtp'
import { getAttachmentContent, listMessages, getMessage } from './imap'
import { schedulerEvents } from './schedulerEvents'
import { upsertContactsFromAddresses } from './contacts'
import { getEnabledRulesForAccount, applyRulesToMessages, logRuleExecution } from './rules'

type AccountRow = {
  id: string; email: string; smtp_host: string; smtp_port: number; smtp_secure: boolean;
  imap_host: string; imap_port: number; imap_secure: boolean;
  username: string; password_encrypted: string;
  oauth_provider: string | null; oauth_access_token: string | null;
  oauth_refresh_token: string | null; oauth_expires_at: number | null;
}

type ScheduledEmail = {
  id: string
  user_id: string
  account_id: string
  to_addresses: string
  cc_addresses: string | null
  bcc_addresses: string | null
  subject: string
  html: string | null
  in_reply_to: string | null
  forwarded_attachments: string | null
}

type ForwardedAttachment = {
  uid: string
  accountId: string
  folder: string
  partIdx: number
  filename: string
  contentType: string
}

export async function processScheduledEmails(): Promise<void> {
  // Atomically claim emails that are due — FOR UPDATE SKIP LOCKED prevents double-send
  const due = await query<ScheduledEmail>(`
    UPDATE scheduled_emails
    SET status = 'processing'
    WHERE id IN (
      SELECT id FROM scheduled_emails
      WHERE status = 'pending' AND send_at <= NOW()
      LIMIT 10
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *
  `)

  for (const email of due) {
    try {
      const accounts = await query<AccountRow>(
        'SELECT * FROM email_accounts WHERE id = $1 LIMIT 1',
        [email.account_id]
      )
      if (!accounts.length) {
        await query(
          'UPDATE scheduled_emails SET status = $1, error = $2 WHERE id = $3',
          ['failed', 'Account not found', email.id]
        )
        continue
      }
      const account = accounts[0]

      // Resolve forwarded attachments from IMAP
      const attachments: Array<{ filename: string; content: Buffer; contentType: string }> = []
      if (email.forwarded_attachments) {
        const fwdAtts = JSON.parse(email.forwarded_attachments) as ForwardedAttachment[]
        for (const att of fwdAtts) {
          const imapAccounts = await query<AccountRow>(
            'SELECT * FROM email_accounts WHERE id = $1 LIMIT 1',
            [att.accountId]
          )
          if (!imapAccounts.length) continue
          const imapAcc = imapAccounts[0]
          const content = await getAttachmentContent(
            {
              id: imapAcc.id,
              imapHost: imapAcc.imap_host,
              imapPort: imapAcc.imap_port,
              imapSecure: imapAcc.imap_secure,
              username: imapAcc.username,
              passwordEncrypted: imapAcc.password_encrypted,
              oauthProvider: imapAcc.oauth_provider,
              oauthAccessToken: imapAcc.oauth_access_token,
              oauthRefreshToken: imapAcc.oauth_refresh_token,
              oauthExpiresAt: imapAcc.oauth_expires_at,
            },
            att.folder,
            att.uid,
            att.partIdx
          )
          if (content) {
            attachments.push({
              filename: content.filename,
              content: content.content,
              contentType: content.contentType,
            })
          }
        }
      }

      await sendMail(
        {
          id: account.id,
          smtpHost: account.smtp_host,
          smtpPort: account.smtp_port,
          smtpSecure: account.smtp_secure,
          username: account.username,
          passwordEncrypted: account.password_encrypted,
          oauthProvider: account.oauth_provider,
          oauthAccessToken: account.oauth_access_token,
          oauthRefreshToken: account.oauth_refresh_token,
          oauthExpiresAt: account.oauth_expires_at,
        },
        {
          from: account.email,
          to: JSON.parse(email.to_addresses) as string[],
          cc: email.cc_addresses ? (JSON.parse(email.cc_addresses) as string[]) : undefined,
          bcc: email.bcc_addresses ? (JSON.parse(email.bcc_addresses) as string[]) : undefined,
          subject: email.subject,
          html: email.html ?? undefined,
          inReplyTo: email.in_reply_to ?? undefined,
          attachments: attachments.length ? attachments : undefined,
        }
      )

      await query(
        'UPDATE scheduled_emails SET status = $1, sent_at = NOW() WHERE id = $2',
        ['sent', email.id]
      )

      // Track recipients as contacts (fire-and-forget)
      const toArr = JSON.parse(email.to_addresses) as string[]
      const ccArr = email.cc_addresses ? (JSON.parse(email.cc_addresses) as string[]) : []
      upsertContactsFromAddresses(email.user_id, [...toArr, ...ccArr], 'sent').catch(() => {})

      const firstTo = toArr[0] ?? ''
      schedulerEvents.emit('scheduled_sent', {
        userId: email.user_id,
        subject: email.subject,
        to: firstTo,
      })
    } catch (err) {
      await query(
        'UPDATE scheduled_emails SET status = $1, error = $2 WHERE id = $3',
        ['failed', String(err), email.id]
      )
    }
  }
}

// ---------------------------------------------------------------------------
// Rule processing — runs every 5 minutes for all accounts
// ---------------------------------------------------------------------------

type AccountForRules = {
  id: string; user_id: string; email: string;
  imap_host: string; imap_port: number; imap_secure: boolean;
  username: string; password_encrypted: string;
  oauth_provider: string | null; oauth_access_token: string | null;
  oauth_refresh_token: string | null; oauth_expires_at: number | null;
}

const RULE_FOLDERS = ['INBOX']  // folders to scan for rules

export async function processRules(): Promise<void> {
  const accounts = await query<AccountForRules>(`SELECT * FROM email_accounts`)

  for (const acc of accounts) {
    try {
      const rules = await getEnabledRulesForAccount(acc.id)
      if (!rules.length) continue

      const accountConfig = {
        id: acc.id,
        imapHost: acc.imap_host,
        imapPort: acc.imap_port,
        imapSecure: acc.imap_secure,
        username: acc.username,
        passwordEncrypted: acc.password_encrypted,
        oauthProvider: acc.oauth_provider,
        oauthAccessToken: acc.oauth_access_token,
        oauthRefreshToken: acc.oauth_refresh_token,
        oauthExpiresAt: acc.oauth_expires_at,
      }

      for (const folder of RULE_FOLDERS) {
        try {
          // Only process recent unread messages (last 30) to keep it fast
          const { messages } = await listMessages(accountConfig, folder, 1, 30, 'unread', acc.user_id)
          if (!messages.length) continue

          const fullMessageFetcher = async (uid: string) => {
            try { return await getMessage(accountConfig, folder, uid) }
            catch { return null }
          }

          const results = await applyRulesToMessages(accountConfig, folder, messages, rules, fullMessageFetcher)
          if (!results.length) continue

          // Log per-rule stats
          for (const rule of rules) {
            const matched = results.filter(r => r.matchedRules.includes(rule.name)).length
            if (matched > 0) {
              await logRuleExecution(rule.id, acc.id, acc.user_id, folder, messages.length, matched)
              schedulerEvents.emit('rule_applied', {
                userId: acc.user_id,
                accountId: acc.id,
                ruleName: rule.name,
                matched,
                folder,
              })
            }
          }
        } catch (folderErr) {
          console.error(`[rules] folder ${folder} / account ${acc.id}:`, folderErr)
        }
      }
    } catch (err) {
      console.error(`[rules] account ${acc.id}:`, err)
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton scheduler — starts once per process lifetime
// ---------------------------------------------------------------------------

let started = false

export function startScheduler(): void {
  if (started) return
  started = true

  // Scheduled emails — every 60s
  setInterval(() => {
    processScheduledEmails().catch(err => console.error('[scheduler/emails]', err))
  }, 60_000)

  // Rules — every 5 minutes
  setInterval(() => {
    processRules().catch(err => console.error('[scheduler/rules]', err))
  }, 5 * 60_000)
}
