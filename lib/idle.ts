import type { ImapFlow } from 'imapflow'
import { createClient, type AccountConfig } from './imap'

// Reconnect delay: doubles on every failure, capped. A network drop must not hammer
// the IMAP server, and a long outage must eventually find the mailbox again without
// intervention.
const RETRY_BASE_MS = 2_000
const RETRY_MAX_MS = 60_000

export interface MailboxWatcher {
  /** Closes the connection and stops any reconnection. Idempotent. */
  close(): void
}

/**
 * Opens ONE IMAP connection that stays in IDLE on `folder` and calls `onChange` on
 * every server announcement. imapflow enters IDLE by itself as soon as the connection
 * goes quiet: opening the mailbox and listening is enough.
 *
 * One connection per open SSE stream, hence per tab. This ceiling is known and
 * accepted; only pool per user+account if the IMAP server starts refusing
 * connections.
 */
export function watchMailbox(
  account: AccountConfig,
  folder: string,
  onChange: () => void
): MailboxWatcher {
  let stopped = false
  let client: ImapFlow | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let attempt = 0

  const schedule = () => {
    if (stopped || timer) return
    const wait = Math.min(RETRY_BASE_MS * 2 ** attempt, RETRY_MAX_MS)
    attempt += 1
    timer = setTimeout(() => { timer = null; void run() }, wait)
    timer.unref?.()
  }

  const run = async () => {
    if (stopped) return
    let c: ImapFlow | null = null
    try {
      c = await createClient(account)
      // Without an 'error' listener, a transport drop becomes an uncaught exception
      // and takes the process down: imapflow emits, we absorb, and reconnection is
      // handled by 'close'.
      c.on('error', () => {})
      const opened = c
      c.on('close', () => {
        if (client !== opened) return
        client = null
        schedule()
      })
      // The three unsolicited announcements that change what the list shows: a message
      // arrives, a message disappears, a flag moves.
      c.on('exists', onChange)
      c.on('expunge', onChange)
      c.on('flags', onChange)
      await c.mailboxOpen(folder)
      if (stopped) { void opened.logout().catch(() => {}); return }
      client = opened
      attempt = 0
      // imapflow only enters IDLE on its own after 15 s of inactivity: without this
      // call the FIRST arrival waits that long (measured: ~9 s of latency where the
      // requirement is under 5). `idle()` only returns when the IDLE ends, hence the
      // un-awaited call; its interruption surfaces through 'close'.
      void opened.idle().catch(() => {})
    } catch {
      // Connection refused, credentials rejected, mailbox missing: retry.
      if (c) void c.logout().catch(() => {})
      client = null
      schedule()
    }
  }

  void run()

  return {
    close() {
      stopped = true
      if (timer) { clearTimeout(timer); timer = null }
      const c = client
      client = null
      if (c) void c.logout().catch(() => {})
    },
  }
}
