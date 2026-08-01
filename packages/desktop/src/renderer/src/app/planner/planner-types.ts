export type PlannerTodoStatus = "inbox" | "todo" | "doing" | "waiting" | "done" | "canceled"
export type PlannerTodoPriority = "low" | "medium" | "high" | "urgent"
export type PlannerTodoView = "today" | "inbox" | "upcoming" | "unscheduled" | "all" | "completed" | "project"
export type PlanProposalStatus = "pending" | "accepted" | "dismissed" | "expired"
export type AgentTaskRunStatus = "queued" | "running" | "completed" | "failed" | "canceled" | "blocked"

export interface PlannerTodo {
  id: string
  title: string
  description?: string
  status: PlannerTodoStatus
  priority: PlannerTodoPriority
  projectId?: string
  parentTodoId?: string
  estimateMinutes?: number
  scheduledStartAt?: number
  scheduledEndAt?: number
  dueAt?: number
  reminderAt?: number
  timezone?: string
  properties?: Record<string, unknown>
  automationIds?: string[]
  workspaceId?: string
  createdAt: number
  updatedAt: number
  completedAt?: number
}

export interface CreatePlannerTodoInput {
  title: string
  description?: string
  status?: PlannerTodoStatus
  priority?: PlannerTodoPriority
  projectId?: string
  parentTodoId?: string
  estimateMinutes?: number
  scheduledStartAt?: number
  scheduledEndAt?: number
  dueAt?: number
  reminderAt?: number
  timezone?: string
  properties?: Record<string, unknown>
}

export interface UpdatePlannerTodoInput {
  title?: string
  description?: string | null
  status?: PlannerTodoStatus
  priority?: PlannerTodoPriority
  projectId?: string | null
  parentTodoId?: string | null
  estimateMinutes?: number | null
  dueAt?: number | null
  reminderAt?: number | null
  timezone?: string | null
  properties?: Record<string, unknown>
}

export interface PlannerScheduleInput {
  scheduledStartAt: number | null
  scheduledEndAt: number | null
}

export type PlannerChange =
  | { kind: "create"; todo: CreatePlannerTodoInput }
  | { kind: "update"; todoId: string; fields: UpdatePlannerTodoInput; expectedUpdatedAt?: number }
  | { kind: "schedule"; todoId: string; scheduledStartAt: number | null; scheduledEndAt: number | null; expectedUpdatedAt?: number }
  | { kind: "complete"; todoId: string; completed?: boolean; expectedUpdatedAt?: number }

export interface PlanProposal {
  id: string
  reason: string
  changes: PlannerChange[]
  status: PlanProposalStatus
  sourceSessionId?: string
  sourceTurnId?: string
  createdAt: number
  decidedAt?: number
  decisionReason?: string
}

export interface PlannerProjectOption {
  directory?: string
  id: string
  name: string
}

export interface AgentTaskRun {
  id: string
  todoId: string
  projectId?: string
  directory?: string
  sessionId?: string
  turnId?: string
  sourceSessionId?: string
  sourceTurnId?: string
  retryOfRunId?: string
  status: AgentTaskRunStatus
  prompt?: string
  permissionMode?: "read-only" | "default"
  requestedToolModuleIds?: string[]
  input?: Record<string, unknown>
  result?: Record<string, unknown>
  error?: string
  createdAt: number
  updatedAt: number
  startedAt?: number
  completedAt?: number
}

export interface CreateAgentTaskRunInput {
  projectId?: string
  directory?: string
  prompt?: string
  permissionMode?: "read-only" | "default"
}

export type PlannerSection = PlannerTodoView | "pending" | "calendar"
