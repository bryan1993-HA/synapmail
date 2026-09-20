import { auth } from '@/lib/auth'
import { NextResponse } from 'next/server'
import { schedulerEvents, type ScheduledSentEvent, type RuleAppliedEvent, type AccountShareAcceptedEvent } from '@/lib/schedulerEvents'
import { getAccessibleAccount } from '@/lib/accountAccess'
import { watchMailbox, type MailboxWatcher } from '@/lib/idle'
import { IDLE_FOLDER, MAILBOX_CHANGED, STREAM_ACCOUNT_PARAM } from '@/lib/stream'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const userId = session.user?.id ?? ''
  const encoder = new TextEncoder()

  // Account to watch in real time. Missing or inaccessible → the stream keeps its
  // scheduler events, with no IMAP watch (not an error: real time is an extra, the
  // periodic refresh remains the safety net).
  const accountId = new URL(req.url).searchParams.get(STREAM_ACCOUNT_PARAM)
  const account = accountId ? await getAccessibleAccount(accountId, userId) : null

  // Stream teardown. `start()` used to return a cleanup function, which the streams API
  // never calls: the listeners stayed attached and, now, the IMAP connection would stay
  // open for every closed tab. `cancel()` is the callback actually invoked when the
  // client disconnects.
  let cleanup = () => {}

  const stream = new ReadableStream({
    start(controller) {
      const send = (data: object) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      }

      send({ type: 'connected', userId })

      // Keep-alive every 25s
      const interval = setInterval(() => {
        try {
          send({ type: 'ping' })
        } catch {
          clearInterval(interval)
        }
      }, 25000)

      // Forward scheduler sent-events to this SSE client
      const onScheduledSent = (evt: ScheduledSentEvent) => {
        if (evt.userId !== userId) return
        try {
          send({ type: 'scheduled_sent', subject: evt.subject, to: evt.to })
        } catch {
          // Stream already closed
        }
      }
      schedulerEvents.on('scheduled_sent', onScheduledSent)

      const onRuleApplied = (evt: RuleAppliedEvent) => {
        if (evt.userId !== userId) return
        try {
          send({ type: 'rule_applied', ruleName: evt.ruleName, matched: evt.matched, folder: evt.folder })
        } catch {
          // Stream already closed
        }
      }
      schedulerEvents.on('rule_applied', onRuleApplied)

      const onShareAccepted = (evt: AccountShareAcceptedEvent) => {
        if (evt.ownerId !== userId) return
        try {
          send({ type: 'account_share_accepted', accountEmail: evt.accountEmail, inviteeEmail: evt.inviteeEmail })
        } catch {
          // Stream already closed
        }
      }
      schedulerEvents.on('account_share_accepted', onShareAccepted)

      // Real time: one IMAP connection in IDLE on the active account's mailbox. The
      // server does not report WHAT changed, only THAT something changed: the client
      // reloads its list, which is all it needs to do.
      let watcher: MailboxWatcher | null = null
      if (account) {
        watcher = watchMailbox(
          {
            id: account.id,
            imapHost: account.imap_host,
            imapPort: account.imap_port,
            imapSecure: account.imap_secure,
            username: account.username,
            passwordEncrypted: account.password_encrypted,
            oauthProvider: account.oauth_provider,
            oauthAccessToken: account.oauth_access_token,
            oauthRefreshToken: account.oauth_refresh_token,
            oauthExpiresAt: account.oauth_expires_at,
          },
          IDLE_FOLDER,
          () => {
            try {
              send({ type: MAILBOX_CHANGED, accountId: account.id, folder: IDLE_FOLDER })
            } catch {
              // Stream already closed
            }
          }
        )
      }

      cleanup = () => {
        watcher?.close()
        watcher = null
        clearInterval(interval)
        schedulerEvents.off('scheduled_sent', onScheduledSent)
        schedulerEvents.off('rule_applied', onRuleApplied)
        schedulerEvents.off('account_share_accepted', onShareAccepted)
      }
    },
    cancel() {
      cleanup()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
