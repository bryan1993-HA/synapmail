/**
 * Synapmail — Email Rules Engine v2
 *
 * Full-featured rule evaluation + action execution.
 * Supports: from/to/cc/subject/body/size/date/list-unsubscribe/priority conditions,
 * move/mark/delete/forward actions, AND/OR logic, stop-processing, history logging.
 */

import { query } from './db'
import { markReadBulk, deleteMessagesBulk, moveMessagesBulk, markStarred } from './imap'
import { sendMail } from './smtp'
import type { AccountConfig } from './imap'
import type { Message } from '@/types/email'
import type { EmailRule, RuleCondition, RuleAction } from '@/types/rule'

// ---------------------------------------------------------------------------
// DB row → domain type
// ---------------------------------------------------------------------------

interface RuleRow {
  id: string
  user_id: string
  account_id: string
  name: string
  enabled: boolean
  priority: number
  condition_logic: string
  conditions: RuleCondition[]
  actions: { id: string; type: string; value?: string }[]
  stop_processing: boolean
  created_at: string
  updated_at: string
  last_run_at: string | null
  total_processed: number
  total_matched: number
}

function rowToRule(r: RuleRow): EmailRule {
  return {
    id: r.id,
    userId: r.user_id,
    accountId: r.account_id,
    name: r.name,
    enabled: r.enabled,
    priority: r.priority,
    conditionLogic: r.condition_logic as 'all' | 'any',
    conditions: r.conditions ?? [],
    actions: (r.actions ?? []) as EmailRule['actions'],
    stopProcessing: r.stop_processing,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    lastRunAt: r.last_run_at ?? null,
    totalProcessed: r.total_processed ?? 0,
    totalMatched: r.total_matched ?? 0,
  }
}

// ---------------------------------------------------------------------------
// DB CRUD
// ---------------------------------------------------------------------------

export async function getRulesForUser(userId: string): Promise<EmailRule[]> {
  const rows = await query<RuleRow>(
    `SELECT * FROM email_rules WHERE user_id = $1 ORDER BY priority ASC, created_at ASC`,
    [userId]
  )
  return rows.map(rowToRule)
}

export async function getEnabledRulesForAccount(accountId: string): Promise<EmailRule[]> {
  const rows = await query<RuleRow>(
    `SELECT * FROM email_rules WHERE account_id = $1 AND enabled = true ORDER BY priority ASC, created_at ASC`,
    [accountId]
  )
  return rows.map(rowToRule)
}

export async function getRuleById(id: string, userId: string): Promise<EmailRule | null> {
  const rows = await query<RuleRow>(
    `SELECT * FROM email_rules WHERE id = $1 AND user_id = $2 LIMIT 1`,
    [id, userId]
  )
  return rows.length ? rowToRule(rows[0]) : null
}

export async function createRule(
  userId: string,
  accountId: string,
  data: Omit<EmailRule, 'id' | 'userId' | 'accountId' | 'createdAt' | 'updatedAt' | 'lastRunAt' | 'totalProcessed' | 'totalMatched'>
): Promise<EmailRule> {
  const rows = await query<RuleRow>(
    `INSERT INTO email_rules (user_id, account_id, name, enabled, priority, condition_logic, conditions, actions, stop_processing)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9)
     RETURNING *`,
    [
      userId, accountId, data.name, data.enabled, data.priority, data.conditionLogic,
      JSON.stringify(data.conditions), JSON.stringify(data.actions), data.stopProcessing,
    ]
  )
  return rowToRule(rows[0])
}

export async function updateRule(
  id: string,
  userId: string,
  data: Partial<Omit<EmailRule, 'id' | 'userId' | 'accountId' | 'createdAt' | 'updatedAt'>>
): Promise<EmailRule | null> {
  const current = await getRuleById(id, userId)
  if (!current) return null

  const rows = await query<RuleRow>(
    `UPDATE email_rules
     SET name = $1, enabled = $2, priority = $3, condition_logic = $4,
         conditions = $5::jsonb, actions = $6::jsonb, stop_processing = $7,
         updated_at = NOW()
     WHERE id = $8 AND user_id = $9
     RETURNING *`,
    [
      data.name ?? current.name,
      data.enabled ?? current.enabled,
      data.priority ?? current.priority,
      data.conditionLogic ?? current.conditionLogic,
      JSON.stringify(data.conditions ?? current.conditions),
      JSON.stringify(data.actions ?? current.actions),
      data.stopProcessing ?? current.stopProcessing,
      id, userId,
    ]
  )
  return rows.length ? rowToRule(rows[0]) : null
}

export async function deleteRule(id: string, userId: string): Promise<boolean> {
  const rows = await query(`DELETE FROM email_rules WHERE id = $1 AND user_id = $2 RETURNING id`, [id, userId])
  return rows.length > 0
}

// ---------------------------------------------------------------------------
// History logging
// ---------------------------------------------------------------------------

export async function logRuleExecution(
  ruleId: string,
  accountId: string,
  userId: string,
  folder: string,
  processed: number,
  matched: number
): Promise<void> {
  await query(
    `INSERT INTO rule_execution_log (rule_id, account_id, user_id, folder, processed, matched)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [ruleId, accountId, userId, folder, processed, matched]
  )
  // Update cumulative stats on the rule
  await query(
    `UPDATE email_rules
     SET last_run_at = NOW(), total_processed = total_processed + $1, total_matched = total_matched + $2
     WHERE id = $3`,
    [processed, matched, ruleId]
  )
}

export async function getRecentLogs(
  ruleId: string,
  limit = 10
): Promise<Array<{ executedAt: string; folder: string; processed: number; matched: number }>> {
  const rows = await query<{
    executed_at: string; folder: string; processed: number; matched: number
  }>(
    `SELECT executed_at, folder, processed, matched FROM rule_execution_log
     WHERE rule_id = $1 ORDER BY executed_at DESC LIMIT $2`,
    [ruleId, limit]
  )
  return rows.map(r => ({ executedAt: r.executed_at, folder: r.folder, processed: r.processed, matched: r.matched }))
}

// ---------------------------------------------------------------------------
// Condition evaluation
// ---------------------------------------------------------------------------

function evalCondition(msg: Message, cond: RuleCondition): boolean {
  // Boolean fields
  if (cond.field === 'has_attachments') {
    if (cond.operator === 'is_true')  return msg.hasAttachments === true
    if (cond.operator === 'is_false') return msg.hasAttachments !== true
    return false
  }

  if (cond.field === 'list_unsubscribe') {
    if (cond.operator === 'is_true')  return !!msg.listUnsubscribe
    if (cond.operator === 'is_false') return !msg.listUnsubscribe
    return false
  }

  // Numeric: size (in KB for readability, stored in bytes in message)
  if (cond.field === 'size') {
    const sizeKb = (msg.size ?? 0) / 1024
    const threshold = parseFloat(cond.value) || 0
    if (cond.operator === 'greater_than') return sizeKb > threshold
    if (cond.operator === 'less_than')    return sizeKb < threshold
    return false
  }

  // Numeric: priority (X-Priority header, 1=highest … 5=lowest)
  if (cond.field === 'priority') {
    const prio = msg.xPriority ?? 3
    const threshold = parseInt(cond.value, 10) || 3
    if (cond.operator === 'equals')        return prio === threshold
    if (cond.operator === 'greater_than')  return prio > threshold   // lower number = higher importance
    if (cond.operator === 'less_than')     return prio < threshold
    return false
  }

  // Date
  if (cond.field === 'date_received') {
    const msgDate = new Date(msg.date).getTime()
    const condDate = new Date(cond.value).getTime()
    if (isNaN(msgDate) || isNaN(condDate)) return false
    if (cond.operator === 'before') return msgDate < condDate
    if (cond.operator === 'after')  return msgDate > condDate
    return false
  }

  // Text fields
  let fieldVal = ''
  switch (cond.field) {
    case 'from':    fieldVal = `${msg.from.name ?? ''} ${msg.from.address ?? ''}`.toLowerCase(); break
    case 'to':      fieldVal = (msg.to ?? []).map(a => `${a.name ?? ''} ${a.address ?? ''}`).join(' ').toLowerCase(); break
    case 'cc':      fieldVal = (msg.cc ?? []).map(a => `${a.name ?? ''} ${a.address ?? ''}`).join(' ').toLowerCase(); break
    case 'subject': fieldVal = (msg.subject ?? '').toLowerCase(); break
    case 'body':    fieldVal = (msg.bodyPlain ?? msg.bodyHtml ?? msg.preview ?? '').toLowerCase(); break
    case 'header':  return false  // would need raw headers
    default:        return false
  }

  const condVal = (cond.value ?? '').toLowerCase()
  switch (cond.operator) {
    case 'contains':     return fieldVal.includes(condVal)
    case 'not_contains': return !fieldVal.includes(condVal)
    case 'equals':       return fieldVal === condVal
    case 'not_equals':   return fieldVal !== condVal
    case 'starts_with':  return fieldVal.startsWith(condVal)
    case 'ends_with':    return fieldVal.endsWith(condVal)
    default:             return false
  }
}

export function evaluateRule(msg: Message, rule: EmailRule): boolean {
  if (!rule.enabled || !rule.conditions.length) return false
  if (rule.conditionLogic === 'all') return rule.conditions.every(c => evalCondition(msg, c))
  return rule.conditions.some(c => evalCondition(msg, c))
}

export function testRule(messages: Message[], rule: EmailRule): Message[] {
  return messages.filter(msg => evaluateRule(msg, rule))
}

// ---------------------------------------------------------------------------
// Action execution
// ---------------------------------------------------------------------------

interface FullAccountRow {
  id: string
  email: string
  smtp_host: string; smtp_port: number; smtp_secure: boolean
  username: string; password_encrypted: string
  oauth_provider: string | null; oauth_access_token: string | null
  oauth_refresh_token: string | null; oauth_expires_at: number | null
}

export async function executeActions(
  account: AccountConfig,
  folder: string,
  uid: string,
  rule: EmailRule,
  fullMessage?: Message   // needed for forward action
): Promise<{ movedOrDeleted: boolean }> {
  let movedOrDeleted = false

  for (const action of rule.actions) {
    try {
      switch (action.type) {
        case 'mark_read':
          await markReadBulk(account, folder, [uid], true)
          break
        case 'mark_unread':
          await markReadBulk(account, folder, [uid], false)
          break
        case 'mark_starred':
          await markStarred(account, folder, uid, true)
          break
        case 'mark_unstarred':
          await markStarred(account, folder, uid, false)
          break
        case 'move':
          if (action.value) {
            await moveMessagesBulk(account, folder, [uid], action.value)
            movedOrDeleted = true
          }
          break
        case 'delete':
          await deleteMessagesBulk(account, folder, [uid])
          movedOrDeleted = true
          break
        case 'forward':
          if (action.value && fullMessage && account.id) {
            await forwardMessage(account.id, fullMessage, action.value)
          } else if (action.value) {
            console.log(`[Rules] Forward: full message not available for uid ${uid}, skipping`)
          }
          break
      }
    } catch (err) {
      console.error(`[Rules] Action ${action.type} failed for uid ${uid}:`, err)
    }
  }

  return { movedOrDeleted }
}

async function forwardMessage(accountId: string, msg: Message, to: string): Promise<void> {
  const accounts = await query<FullAccountRow>(
    'SELECT * FROM email_accounts WHERE id = $1 LIMIT 1',
    [accountId]
  )
  if (!accounts.length) return
  const acc = accounts[0]

  const fwdSubject = msg.subject.startsWith('Fwd:') ? msg.subject : `Fwd: ${msg.subject}`
  const fwdBody = `
    <p><em>--- Message transféré automatiquement ---</em></p>
    <p><strong>De :</strong> ${msg.from.name ? `${msg.from.name} &lt;${msg.from.address}&gt;` : msg.from.address}</p>
    <p><strong>Date :</strong> ${new Date(msg.date).toLocaleString('fr')}</p>
    <p><strong>Objet :</strong> ${msg.subject}</p>
    <hr>
    ${msg.bodyHtml ?? `<pre>${msg.bodyPlain ?? ''}</pre>`}
  `

  await sendMail(
    {
      id: acc.id,
      smtpHost: acc.smtp_host,
      smtpPort: acc.smtp_port,
      smtpSecure: acc.smtp_secure,
      username: acc.username,
      passwordEncrypted: acc.password_encrypted,
      oauthProvider: acc.oauth_provider,
      oauthAccessToken: acc.oauth_access_token,
      oauthRefreshToken: acc.oauth_refresh_token,
      oauthExpiresAt: acc.oauth_expires_at,
    },
    { from: acc.email, to: [to], subject: fwdSubject, html: fwdBody }
  )
}

// ---------------------------------------------------------------------------
// Batch: apply rules to a list of messages
// ---------------------------------------------------------------------------

export interface RuleResult {
  uid: string
  matchedRules: string[]
  movedOrDeleted: boolean
}

export async function applyRulesToMessages(
  account: AccountConfig,
  folder: string,
  messages: Message[],
  rules: EmailRule[],
  fullMessageFetcher?: (uid: string) => Promise<Message | null>
): Promise<RuleResult[]> {
  const results: RuleResult[] = []

  for (const msg of messages) {
    const result: RuleResult = { uid: msg.uid, matchedRules: [], movedOrDeleted: false }

    for (const rule of rules) {
      if (evaluateRule(msg, rule)) {
        result.matchedRules.push(rule.name)

        // Fetch full message if forward action is present and we have a fetcher
        let fullMsg: Message | undefined
        if (rule.actions.some(a => a.type === 'forward') && fullMessageFetcher) {
          fullMsg = (await fullMessageFetcher(msg.uid)) ?? undefined
        }

        const { movedOrDeleted } = await executeActions(account, folder, msg.uid, rule, fullMsg ?? msg)
        if (movedOrDeleted) result.movedOrDeleted = true

        if (result.movedOrDeleted || rule.stopProcessing) break
      }
    }

    if (result.matchedRules.length > 0) results.push(result)
  }

  return results
}

// ---------------------------------------------------------------------------
// Sieve script export
// ---------------------------------------------------------------------------

function sieveCondition(c: RuleCondition): string {
  switch (c.field) {
    case 'from':
    case 'to':
    case 'cc':
    case 'subject': {
      const header = { from: 'From', to: 'To', cc: 'Cc', subject: 'Subject' }[c.field]
      const negPrefix = c.operator.startsWith('not_') ? 'not ' : ''
      const match = c.operator === 'equals' || c.operator === 'not_equals' ? ':is' : ':contains'
      return `${negPrefix}header ${match} "${header}" "${c.value.replace(/"/g, '\\"')}"`
    }
    case 'has_attachments':
      return c.operator === 'is_true'
        ? 'header :matches "Content-Type" "multipart/mixed*"'
        : 'not header :matches "Content-Type" "multipart/mixed*"'
    case 'list_unsubscribe':
      return c.operator === 'is_true' ? 'exists "List-Unsubscribe"' : 'not exists "List-Unsubscribe"'
    case 'body':
      return `${c.operator === 'not_contains' ? 'not ' : ''}body :contains "${c.value.replace(/"/g, '\\"')}"`
    case 'size':
      if (c.operator === 'greater_than') return `size :over ${Math.round(parseFloat(c.value) * 1024)}`
      if (c.operator === 'less_than')    return `size :under ${Math.round(parseFloat(c.value) * 1024)}`
      return ''
    case 'date_received':
      return '' // Sieve date extension is complex — skip
    default:
      return ''
  }
}

function sieveAction(a: RuleAction, requires: Set<string>): string {
  switch (a.type) {
    case 'move':
      requires.add('fileinto')
      return `fileinto "${(a.value ?? '').replace(/"/g, '\\"')}";`
    case 'mark_read':
      requires.add('imap4flags')
      return 'addflag "\\\\Seen";'
    case 'mark_unread':
      requires.add('imap4flags')
      return 'removeflag "\\\\Seen";'
    case 'mark_starred':
      requires.add('imap4flags')
      return 'addflag "\\\\Flagged";'
    case 'mark_unstarred':
      requires.add('imap4flags')
      return 'removeflag "\\\\Flagged";'
    case 'delete':
      return 'discard;'
    case 'forward':
      return a.value ? `redirect "${a.value.replace(/"/g, '\\"')}";` : ''
    default:
      return ''
  }
}

export function generateSieveScript(rules: EmailRule[]): string {
  const requires = new Set<string>(['fileinto', 'imap4flags'])
  const blocks: string[] = [
    '# Synapmail — Règles auto-générées',
    `# Exporté le ${new Date().toISOString()}`,
    '',
  ]

  for (const rule of rules) {
    if (!rule.enabled || !rule.conditions.length || !rule.actions.length) continue

    const conds = rule.conditions.map(c => sieveCondition(c)).filter(Boolean)
    const acts  = rule.actions.map(a => sieveAction(a, requires)).filter(Boolean)
    if (!conds.length || !acts.length) continue

    const condStr = conds.length === 1
      ? conds[0]
      : `${rule.conditionLogic === 'all' ? 'allof' : 'anyof'} (${conds.join(',\n        ')})`

    let block = `# ${rule.name}\nif ${condStr} {\n`
    block += acts.map(a => `    ${a}`).join('\n') + '\n'
    if (rule.stopProcessing) block += '    stop;\n'
    block += '}'
    blocks.push(block)
  }

  const requireLine = `require [${Array.from(requires).map(r => `"${r}"`).join(', ')}];`
  return [requireLine, '', ...blocks].join('\n')
}
