export type CalendarViewMode = "day" | "week" | "month" | "schedule"
export type CalendarEntityType = "event" | "task" | "project" | "reminder" | "agent_suggestion"
export type CalendarDisplayKind = "external_event" | "scheduled_todo" | "deadline" | "reminder" | "agent_suggestion"
export type CalendarEventStatus = "scheduled" | "canceled"
export type PlannerTaskStatus = "todo" | "done"
export type PlannerTaskPriority = "low" | "medium" | "high"
export type CalendarItemStatus = CalendarEventStatus | PlannerTaskStatus | "pending" | "blocked"

export interface CalendarSource {
  color: string
  enabled: boolean
  id: string
  name: string
  subtitle?: string
}

export interface CalendarEventRecord {
  allDay: boolean
  attendees: string[]
  createdAt: number
  description?: string
  endAt: number
  id: string
  linkedPageIds: string[]
  linkedWorkspaceId?: string
  location?: string
  meetingUrl?: string
  sourceId: string
  startAt: number
  status: CalendarEventStatus
  timezone: string
  title: string
  updatedAt: number
}

export interface PlannerTaskRecord {
  createdAt: number
  description?: string
  dueAt?: number
  estimateMinutes?: number
  id: string
  priority: PlannerTaskPriority
  properties?: Record<string, unknown>
  reminderAt?: number
  scheduledEndAt?: number
  scheduledStartAt?: number
  status: PlannerTaskStatus
  timezone?: string
  title: string
  updatedAt: number
  workspaceId?: string
}

export interface CalendarItem {
  allDay?: boolean
  color?: string
  description?: string
  displayKind?: CalendarDisplayKind
  dueAt?: Date
  endAt?: Date
  entityId?: string
  entityType: CalendarEntityType
  estimateMinutes?: number
  id: string
  isReadOnly?: boolean
  isSuggestion?: boolean
  properties?: Record<string, unknown>
  reminderAt?: Date
  sourceId: string
  startAt?: Date
  status?: CalendarItemStatus
  targetItemId?: string
  timezone?: string
  title: string
  workspace?: string
}

export interface CalendarApiItem {
  allDay: boolean
  color: string
  description?: string
  displayKind: CalendarDisplayKind
  endAt?: number
  entityId: string
  entityType: CalendarEntityType
  estimateMinutes?: number
  id: string
  isReadOnly: boolean
  isSuggestion: boolean
  properties?: Record<string, unknown>
  sourceId: string
  startAt?: number
  status?: string
  timezone?: string
  title: string
  workspace?: string
}

export interface CreateCalendarEventInput {
  allDay?: boolean
  description?: string
  endAt: number
  linkedWorkspaceId?: string
  sourceId: string
  startAt: number
  status?: CalendarEventStatus
  timezone?: string
  title: string
}

export interface UpdateCalendarEventInput {
  allDay?: boolean
  description?: string
  endAt?: number
  linkedWorkspaceId?: string
  sourceId?: string
  startAt?: number
  status?: CalendarEventStatus
  timezone?: string
  title?: string
}

export interface CreateCalendarTaskInput {
  description?: string
  dueAt?: number
  estimateMinutes?: number
  priority?: PlannerTaskPriority
  properties?: Record<string, unknown>
  reminderAt?: number
  scheduledEndAt?: number
  scheduledStartAt?: number
  status?: PlannerTaskStatus
  timezone?: string
  title: string
  workspaceId?: string
}

export interface UpdateCalendarTaskInput {
  description?: string | null
  dueAt?: number | null
  estimateMinutes?: number
  priority?: PlannerTaskPriority
  properties?: Record<string, unknown>
  reminderAt?: number | null
  scheduledEndAt?: number | null
  scheduledStartAt?: number | null
  status?: PlannerTaskStatus
  timezone?: string | null
  title?: string
  workspaceId?: string | null
}

export interface ScheduleCalendarTaskInput {
  scheduledEndAt?: number | null
  scheduledStartAt?: number | null
}
