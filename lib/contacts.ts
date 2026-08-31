import { query } from './db'

// noreply anywhere in local part (before @)
const BLOCKED_NOREPLY = /noreply|no[-.]reply|ne[-.]pas[-.]repondre|nepasrepondre|no[-.]reponse|noreponse|donotreply|do[-.]not[-.]reply/i

// Blocked local parts that must start the address
const BLOCKED_LOCAL = [
  /^notifications?@/i,
  /^mailer(-daemon)?@/i,
  /^bounce[^@]*@/i,
  /^postmaster@/i,
  /^newsletter@/i,
  /^unsubscribe@/i,
  /^support@/i,
  /^help@/i,
  /^info@/i,
  /^contact@/i,
  /^admin@/i,
  /^webmaster@/i,
  /^automated?@/i,
  /^marketing@/i,
  /^promo@/i,
  /^news@/i,
  /^actu@/i,
  /^communique@/i,
  /^pickup[-.]?/i,
  /^payments?[-.]?/i,
  /^confirmation[-.]?/i,
  /^enquete@/i,
  /^account[-.]security/i,
  /^drive[-.]shares/i,
]

// Blocked subdomains in the domain part (@subdomain.example.com)
const BLOCKED_SUBDOMAINS = [
  /^@(actu|news|newsletter|promo|marketing|mailing|noreply|no-reply|bounce|em|sg|services|satisfaction|information|accountprotection|crm|pickup)\./i,
]


const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function isBlocked(email: string): boolean {
  const atIdx = email.indexOf('@')
  const local = email.slice(0, atIdx + 1) // includes @ for anchored patterns
  const domain = email.slice(atIdx)        // @domain.tld
  return BLOCKED_NOREPLY.test(local)
    || BLOCKED_LOCAL.some(p => p.test(email))
    || BLOCKED_SUBDOMAINS.some(p => p.test(domain))
}

function parseAddress(raw: string): { name: string; address: string } {
  const match = raw.match(/^(.+?)\s*<([^>]+)>$/)
  if (match) return { name: match[1].trim(), address: match[2].trim().toLowerCase() }
  return { name: '', address: raw.trim().toLowerCase() }
}

export async function upsertContact(
  userId: string,
  address: { name?: string; address: string },
  direction: 'sent' | 'received'
): Promise<void> {
  const email = address.address?.toLowerCase().trim()
  if (!email || !EMAIL_REGEX.test(email) || isBlocked(email)) return

  const name = (address.name ?? '').trim() || email.split('@')[0]
  const sentDelta = direction === 'sent' ? 1 : 0
  const receivedDelta = direction === 'received' ? 1 : 0

  await query(
    `INSERT INTO contacts (user_id, name, email, frequency, sent_count, received_count, last_contact_at)
     VALUES ($1, $2, $3, 1, $4, $5, NOW())
     ON CONFLICT (user_id, email) DO UPDATE SET
       name        = CASE WHEN EXCLUDED.name != '' THEN EXCLUDED.name ELSE contacts.name END,
       frequency   = contacts.frequency + 1,
       sent_count  = contacts.sent_count + $4,
       received_count = contacts.received_count + $5,
       last_contact_at = NOW(),
       updated_at  = NOW()`,
    [userId, name, email, sentDelta, receivedDelta]
  )
}

export async function upsertContactsFromAddresses(
  userId: string,
  addresses: string[],
  direction: 'sent' | 'received'
): Promise<void> {
  await Promise.all(
    addresses.map(raw => upsertContact(userId, parseAddress(raw), direction))
  )
}
