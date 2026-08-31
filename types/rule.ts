export type RuleField =
  | 'from'
  | 'to'
  | 'cc'
  | 'subject'
  | 'body'
  | 'has_attachments'
  | 'list_unsubscribe'
  | 'size'
  | 'date_received'
  | 'priority'
  | 'header'

export type RuleOperator =
  | 'contains'
  | 'not_contains'
  | 'equals'
  | 'not_equals'
  | 'starts_with'
  | 'ends_with'
  | 'is_true'
  | 'is_false'
  | 'greater_than'
  | 'less_than'
  | 'before'
  | 'after'

export type RuleActionType =
  | 'move'
  | 'mark_read'
  | 'mark_unread'
  | 'mark_starred'
  | 'mark_unstarred'
  | 'delete'
  | 'forward'

export type ConditionLogic = 'all' | 'any'

export interface RuleCondition {
  id: string
  field: RuleField
  operator: RuleOperator
  value: string
  headerName?: string  // for 'header' field
}

export interface RuleAction {
  id: string
  type: RuleActionType
  value?: string
}

export interface RuleStats {
  lastRunAt: string | null
  totalProcessed: number
  totalMatched: number
}

export interface EmailRule {
  id: string
  userId: string
  accountId: string
  name: string
  enabled: boolean
  priority: number
  conditionLogic: ConditionLogic
  conditions: RuleCondition[]
  actions: RuleAction[]
  stopProcessing: boolean
  createdAt: string
  updatedAt: string
  // Stats (populated from DB)
  lastRunAt?: string | null
  totalProcessed?: number
  totalMatched?: number
}

// Template for quick rule creation
export interface RuleTemplate {
  id: string
  name: string
  description: string
  icon: string
  conditionLogic: ConditionLogic
  conditions: Omit<RuleCondition, 'id'>[]
  actions: Omit<RuleAction, 'id'>[]
}
