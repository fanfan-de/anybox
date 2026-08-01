import z from "zod"
import * as Identifier from "#id/id.ts"

export const PlannerTodoStatus = z.enum([
  "inbox",
  "todo",
  "doing",
  "waiting",
  "done",
  "canceled",
])
export type PlannerTodoStatus = z.output<typeof PlannerTodoStatus>

export const PlannerTodoPriority = z.enum(["low", "medium", "high", "urgent"])
export type PlannerTodoPriority = z.output<typeof PlannerTodoPriority>

export const PlannerTodo = z.object({
  id: Identifier.schema("task"),
  title: z.string().trim().min(1),
  description: z.string().optional(),
  status: PlannerTodoStatus,
  priority: PlannerTodoPriority,
  projectId: z.string().optional(),
  parentTodoId: Identifier.schema("task").optional(),
  estimateMinutes: z.number().int().positive().optional(),
  scheduledStartAt: z.number().int().nonnegative().optional(),
  scheduledEndAt: z.number().int().nonnegative().optional(),
  dueAt: z.number().int().nonnegative().optional(),
  reminderAt: z.number().int().nonnegative().optional(),
  timezone: z.string().optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
  automationIds: z.array(z.string().trim().min(1)).optional(),
  /** @deprecated Calendar compatibility alias. New Planner clients use projectId. */
  workspaceId: z.string().optional(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  completedAt: z.number().int().nonnegative().optional(),
})
export type PlannerTodo = z.output<typeof PlannerTodo>

export const PlannerTodoCreate = z.object({
  id: Identifier.schema("task").optional(),
  title: z.string().trim().min(1),
  description: z.string().optional(),
  status: PlannerTodoStatus.optional(),
  priority: PlannerTodoPriority.optional(),
  projectId: z.string().trim().min(1).optional(),
  parentTodoId: Identifier.schema("task").optional(),
  estimateMinutes: z.number().int().positive().optional(),
  scheduledStartAt: z.number().int().nonnegative().optional(),
  scheduledEndAt: z.number().int().nonnegative().optional(),
  dueAt: z.number().int().nonnegative().optional(),
  reminderAt: z.number().int().nonnegative().optional(),
  timezone: z.string().trim().min(1).optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
  /** @deprecated Calendar compatibility alias. */
  workspaceId: z.string().trim().min(1).optional(),
})
export type PlannerTodoCreate = z.output<typeof PlannerTodoCreate>

export const PlannerTodoUpdate = z.object({
  title: z.string().trim().min(1).optional(),
  description: z.string().nullable().optional(),
  status: PlannerTodoStatus.optional(),
  priority: PlannerTodoPriority.optional(),
  projectId: z.string().trim().min(1).nullable().optional(),
  parentTodoId: Identifier.schema("task").nullable().optional(),
  estimateMinutes: z.number().int().positive().nullable().optional(),
  dueAt: z.number().int().nonnegative().nullable().optional(),
  reminderAt: z.number().int().nonnegative().nullable().optional(),
  timezone: z.string().trim().min(1).nullable().optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
  /** @deprecated Calendar compatibility alias. */
  workspaceId: z.string().trim().min(1).nullable().optional(),
})
export type PlannerTodoUpdate = z.output<typeof PlannerTodoUpdate>

export const PlannerScheduleUpdate = z.object({
  scheduledStartAt: z.number().int().nonnegative().nullable(),
  scheduledEndAt: z.number().int().nonnegative().nullable(),
})
export type PlannerScheduleUpdate = z.output<typeof PlannerScheduleUpdate>

const ExpectedVersion = z.object({
  expectedUpdatedAt: z.number().int().nonnegative().optional(),
})

export const PlannerCreateChange = z.object({
  kind: z.literal("create"),
  todo: PlannerTodoCreate,
})

export const PlannerUpdateChange = z.object({
  kind: z.literal("update"),
  todoId: Identifier.schema("task"),
  fields: PlannerTodoUpdate,
}).extend(ExpectedVersion.shape)

export const PlannerScheduleChange = z.object({
  kind: z.literal("schedule"),
  todoId: Identifier.schema("task"),
  scheduledStartAt: z.number().int().nonnegative().nullable(),
  scheduledEndAt: z.number().int().nonnegative().nullable(),
}).extend(ExpectedVersion.shape)

export const PlannerCompleteChange = z.object({
  kind: z.literal("complete"),
  todoId: Identifier.schema("task"),
  completed: z.boolean().optional().default(true),
}).extend(ExpectedVersion.shape)

export const PlannerChange = z.discriminatedUnion("kind", [
  PlannerCreateChange,
  PlannerUpdateChange,
  PlannerScheduleChange,
  PlannerCompleteChange,
])
export type PlannerChange = z.output<typeof PlannerChange>

export const PlanProposalStatus = z.enum(["pending", "accepted", "dismissed", "expired"])
export type PlanProposalStatus = z.output<typeof PlanProposalStatus>

export const PlanProposal = z.object({
  id: Identifier.schema("plannerProposal"),
  reason: z.string().trim().min(1),
  changes: z.array(PlannerChange).min(1),
  status: PlanProposalStatus,
  sourceSessionId: z.string().optional(),
  sourceTurnId: z.string().optional(),
  createdAt: z.number().int().nonnegative(),
  decidedAt: z.number().int().nonnegative().optional(),
  decisionReason: z.string().optional(),
})
export type PlanProposal = z.output<typeof PlanProposal>

export const AgentTaskRunStatus = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
  "canceled",
  "blocked",
])
export type AgentTaskRunStatus = z.output<typeof AgentTaskRunStatus>

export const AgentTaskRun = z.object({
  id: Identifier.schema("plannerRun"),
  todoId: Identifier.schema("task"),
  projectId: z.string().optional(),
  directory: z.string().optional(),
  sessionId: z.string().optional(),
  turnId: z.string().optional(),
  sourceSessionId: z.string().optional(),
  sourceTurnId: z.string().optional(),
  retryOfRunId: Identifier.schema("plannerRun").optional(),
  status: AgentTaskRunStatus,
  prompt: z.string().optional(),
  permissionMode: z.enum(["read-only", "default"]).optional(),
  requestedToolModuleIds: z.array(z.string().trim().min(1)).optional(),
  input: z.record(z.string(), z.unknown()).optional(),
  result: z.record(z.string(), z.unknown()).optional(),
  error: z.string().optional(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  startedAt: z.number().int().nonnegative().optional(),
  completedAt: z.number().int().nonnegative().optional(),
})
export type AgentTaskRun = z.output<typeof AgentTaskRun>

export const PlannerActor = z.enum(["user", "agent", "calendar", "system"])
export type PlannerActor = z.output<typeof PlannerActor>

export const PlannerAuditEvent = z.object({
  id: Identifier.schema("plannerAudit"),
  action: z.string().trim().min(1),
  entityType: z.enum(["todo", "proposal", "run"]),
  entityId: z.string().trim().min(1),
  actor: PlannerActor,
  sourceSessionId: z.string().optional(),
  sourceTurnId: z.string().optional(),
  before: z.record(z.string(), z.unknown()).optional(),
  after: z.record(z.string(), z.unknown()).optional(),
  createdAt: z.number().int().nonnegative(),
})
export type PlannerAuditEvent = z.output<typeof PlannerAuditEvent>

export const PlannerTodoView = z.enum([
  "today",
  "inbox",
  "upcoming",
  "unscheduled",
  "all",
  "completed",
  "project",
])
export type PlannerTodoView = z.output<typeof PlannerTodoView>
