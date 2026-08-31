import { EventEmitter } from 'events'

export type ScheduledSentEvent = {
  userId: string
  subject: string
  to: string // first recipient
}

export type RuleAppliedEvent = {
  userId: string
  accountId: string
  ruleName: string
  matched: number
  folder: string
}

// Singleton event bus — scheduler emits, SSE streams consume
export const schedulerEvents = new EventEmitter()
schedulerEvents.setMaxListeners(200) // one per SSE connection
