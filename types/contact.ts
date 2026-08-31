export interface Contact {
  id: string
  name: string
  email: string
  frequency: number
  sentCount: number
  receivedCount: number
  lastContactAt: string
  isStarred: boolean
  isManual: boolean
  notes?: string | null
  createdAt: string
}
