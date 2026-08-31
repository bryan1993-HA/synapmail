import { auth } from '@/lib/auth'
import { NextResponse } from 'next/server'
import { schedulerEvents, type ScheduledSentEvent, type RuleAppliedEvent } from '@/lib/schedulerEvents'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const userId = session.user?.id ?? ''
  const encoder = new TextEncoder()

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

      return () => {
        clearInterval(interval)
        schedulerEvents.off('scheduled_sent', onScheduledSent)
        schedulerEvents.off('rule_applied', onRuleApplied)
      }
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
