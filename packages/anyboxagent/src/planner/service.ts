import z from "zod"
import {
  AgentTaskRun,
  AgentTaskRunStatus,
  PlanProposal,
  PlanProposalStatus,
  PlannerActor,
  PlannerChange,
  PlannerScheduleUpdate,
  PlannerTodo,
  PlannerTodoCreate,
  PlannerTodoStatus,
  PlannerTodoUpdate,
  PlannerTodoView,
  type PlannerAuditEvent,
} from "#planner/model.ts"
import * as Repository from "#planner/repository.ts"

export class PlannerError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly data?: unknown,
  ) {
    super(message)
    this.name = "PlannerError"
  }
}

export function isPlannerError(error: unknown): error is PlannerError {
  return error instanceof PlannerError
}

export type MutationContext = {
  actor?: PlannerActor
  sourceSessionId?: string
  sourceTurnId?: string
  now?: number
}

export type ListTodosInput = {
  view?: PlannerTodoView
  now?: number
  query?: string
  projectId?: string
  status?: PlannerTodoStatus | "all"
  schedule?: "scheduled" | "unscheduled" | "all"
  dueAfter?: number
  dueBefore?: number
  includeTerminal?: boolean
  limit?: number
}

function mutationTime(context: MutationContext) {
  return context.now ?? Date.now()
}

function nextUpdatedAt(existing: PlannerTodo, context: MutationContext) {
  return Math.max(mutationTime(context), existing.updatedAt + 1)
}

function toRecord(value: object | undefined) {
  return value as Record<string, unknown> | undefined
}

function insertAudit(
  input: Omit<PlannerAuditEvent, "id" | "actor" | "createdAt" | "sourceSessionId" | "sourceTurnId">,
  context: MutationContext,
) {
  const event = {
    ...input,
    id: Repository.createAuditID(),
    actor: context.actor ?? "user",
    sourceSessionId: context.sourceSessionId,
    sourceTurnId: context.sourceTurnId,
    createdAt: mutationTime(context),
  }
  return Repository.insertAuditEvent(event)
}

function requireTodo(id: string) {
  const todo = Repository.getTodo(id)
  if (!todo) {
    throw new PlannerError("PLANNER_TODO_NOT_FOUND", `Planner todo '${id}' was not found.`, { id })
  }
  return todo
}

function requireProposal(id: string) {
  const proposal = Repository.getProposal(id)
  if (!proposal) {
    throw new PlannerError("PLANNER_PROPOSAL_NOT_FOUND", `Planner proposal '${id}' was not found.`, { id })
  }
  return proposal
}

function requireRun(id: string) {
  const run = Repository.getRun(id)
  if (!run) {
    throw new PlannerError("PLANNER_RUN_NOT_FOUND", `Planner Agent run '${id}' was not found.`, { id })
  }
  return run
}

function validateSchedule(input: {
  scheduledStartAt?: number | null
  scheduledEndAt?: number | null
}) {
  const start = input.scheduledStartAt
  const end = input.scheduledEndAt
  const clearing = start === null && end === null
  const absent = start === undefined && end === undefined
  if (clearing || absent) return
  if (start === null || end === null || start === undefined || end === undefined) {
    throw new PlannerError(
      "INVALID_PLANNER_SCHEDULE",
      "Planner schedule must set or clear both scheduledStartAt and scheduledEndAt.",
    )
  }
  if (end < start) {
    throw new PlannerError(
      "INVALID_PLANNER_SCHEDULE",
      "Planner scheduledEndAt must be greater than or equal to scheduledStartAt.",
    )
  }
}

function resolveProject(input: { projectId?: string | null; workspaceId?: string | null }) {
  const projectId = input.projectId?.trim() || undefined
  const workspaceId = input.workspaceId?.trim() || undefined
  if (projectId && workspaceId && projectId !== workspaceId) {
    throw new PlannerError(
      "PLANNER_PROJECT_ALIAS_CONFLICT",
      "projectId and the legacy workspaceId alias must identify the same project.",
    )
  }
  return projectId ?? workspaceId
}

function validateParent(todoId: string, parentTodoId: string | undefined) {
  if (!parentTodoId) return
  if (parentTodoId === todoId) {
    throw new PlannerError("INVALID_PLANNER_PARENT", "A Planner todo cannot be its own parent.")
  }

  let cursor = requireTodo(parentTodoId)
  const visited = new Set([todoId])
  while (cursor) {
    if (visited.has(cursor.id)) {
      throw new PlannerError("INVALID_PLANNER_PARENT", "Planner todo parent relationships cannot contain a cycle.")
    }
    visited.add(cursor.id)
    if (!cursor.parentTodoId) break
    cursor = requireTodo(cursor.parentTodoId)
  }
}

function isTerminal(status: PlannerTodoStatus) {
  return status === "done" || status === "canceled"
}

function localDayRange(now: number) {
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  const endExclusive = new Date(start)
  endExclusive.setDate(endExclusive.getDate() + 1)
  return {
    startAt: start.getTime(),
    endAt: endExclusive.getTime() - 1,
  }
}

function matchesView(todo: PlannerTodo, input: ListTodosInput) {
  const view = input.view ?? "all"
  const { startAt, endAt } = localDayRange(input.now ?? Date.now())
  const active = !isTerminal(todo.status)

  switch (view) {
    case "today": {
      if (!active) return false
      const scheduledToday = todo.scheduledStartAt !== undefined
        && todo.scheduledStartAt <= endAt
        && (todo.scheduledEndAt ?? todo.scheduledStartAt) >= startAt
      const dueTodayOrOverdue = todo.dueAt !== undefined && todo.dueAt <= endAt
      return scheduledToday || dueTodayOrOverdue
    }
    case "inbox":
      return todo.status === "inbox"
    case "upcoming":
      return active && (
        (todo.scheduledStartAt !== undefined && todo.scheduledStartAt > endAt)
        || (todo.dueAt !== undefined && todo.dueAt > endAt)
      )
    case "unscheduled":
      return active && todo.scheduledStartAt === undefined && todo.scheduledEndAt === undefined
    case "completed":
      return todo.status === "done"
    case "project":
      return active && Boolean(input.projectId) && todo.projectId === input.projectId
    case "all":
      return input.includeTerminal ? true : active
  }
}

function compareTodos(left: PlannerTodo, right: PlannerTodo) {
  const leftTime = left.scheduledStartAt ?? left.dueAt ?? Number.MAX_SAFE_INTEGER
  const rightTime = right.scheduledStartAt ?? right.dueAt ?? Number.MAX_SAFE_INTEGER
  if (leftTime !== rightTime) return leftTime - rightTime
  if (left.priority !== right.priority) {
    const weight = { urgent: 0, high: 1, medium: 2, low: 3 }
    return weight[left.priority] - weight[right.priority]
  }
  if (left.updatedAt !== right.updatedAt) return right.updatedAt - left.updatedAt
  return left.id.localeCompare(right.id)
}

export function listTodos(input: ListTodosInput = {}) {
  if (input.view === "project" && !input.projectId) {
    throw new PlannerError("PLANNER_PROJECT_REQUIRED", "The project Planner view requires projectId.")
  }
  if (input.dueAfter !== undefined && input.dueBefore !== undefined && input.dueBefore < input.dueAfter) {
    throw new PlannerError("INVALID_PLANNER_DUE_RANGE", "dueBefore must be greater than or equal to dueAfter.")
  }

  const query = input.query?.trim().toLocaleLowerCase()
  const effectiveInput = {
    ...input,
    includeTerminal: input.includeTerminal
      || input.status === "all"
      || input.status === "done"
      || input.status === "canceled",
  }
  return Repository.listTodos()
    .filter((todo) => matchesView(todo, effectiveInput))
    .filter((todo) => input.status === undefined || input.status === "all" || todo.status === input.status)
    .filter((todo) => {
      if (input.schedule === "scheduled") return todo.scheduledStartAt !== undefined
      if (input.schedule === "unscheduled") return todo.scheduledStartAt === undefined
      return true
    })
    .filter((todo) => !input.projectId || todo.projectId === input.projectId)
    .filter((todo) => input.dueAfter === undefined || (todo.dueAt !== undefined && todo.dueAt >= input.dueAfter))
    .filter((todo) => input.dueBefore === undefined || (todo.dueAt !== undefined && todo.dueAt <= input.dueBefore))
    .filter((todo) => !query || `${todo.title}\n${todo.description ?? ""}`.toLocaleLowerCase().includes(query))
    .sort(compareTodos)
    .slice(0, input.limit ?? 200)
}

export function listAllTodos() {
  return Repository.listTodos()
}

export function getTodo(id: string) {
  return Repository.getTodo(id)
}

export function createTodo(rawInput: PlannerTodoCreate, context: MutationContext = {}) {
  const input = PlannerTodoCreate.parse(rawInput)
  validateSchedule(input)
  const now = mutationTime(context)
  const id = input.id ?? Repository.createTodoID()
  if (Repository.getTodo(id)) {
    throw new PlannerError("PLANNER_TODO_EXISTS", `Planner todo '${id}' already exists.`, { id })
  }
  validateParent(id, input.parentTodoId)
  const projectId = resolveProject(input)
  const status = input.status ?? "inbox"
  const todo = PlannerTodo.parse({
    ...input,
    id,
    status,
    priority: input.priority ?? "medium",
    projectId,
    workspaceId: projectId,
    completedAt: status === "done" ? now : undefined,
    createdAt: now,
    updatedAt: now,
  })
  Repository.insertTodo(todo)
  insertAudit({
    action: "todo.created",
    entityType: "todo",
    entityId: todo.id,
    after: toRecord(todo),
  }, context)
  return todo
}

export function updateTodo(id: string, rawFields: PlannerTodoUpdate, context: MutationContext = {}) {
  const fields = PlannerTodoUpdate.parse(rawFields)
  if (Object.keys(fields).length === 0) {
    throw new PlannerError("EMPTY_PLANNER_UPDATE", "At least one Planner todo field must be updated.")
  }
  const existing = requireTodo(id)
  const hasProjectId = Object.prototype.hasOwnProperty.call(fields, "projectId")
  const hasWorkspaceId = Object.prototype.hasOwnProperty.call(fields, "workspaceId")
  let projectId = existing.projectId ?? existing.workspaceId
  if (hasProjectId || hasWorkspaceId) {
    projectId = resolveProject({
      projectId: hasProjectId ? fields.projectId : undefined,
      workspaceId: hasWorkspaceId ? fields.workspaceId : undefined,
    })
  }

  const parentTodoId = fields.parentTodoId === null
    ? undefined
    : fields.parentTodoId ?? existing.parentTodoId
  validateParent(id, parentTodoId)
  const status = fields.status ?? existing.status
  const now = nextUpdatedAt(existing, context)
  const todo = PlannerTodo.parse({
    ...existing,
    ...fields,
    description: fields.description === null ? undefined : fields.description ?? existing.description,
    projectId,
    workspaceId: projectId,
    parentTodoId,
    estimateMinutes: fields.estimateMinutes === null ? undefined : fields.estimateMinutes ?? existing.estimateMinutes,
    dueAt: fields.dueAt === null ? undefined : fields.dueAt ?? existing.dueAt,
    reminderAt: fields.reminderAt === null ? undefined : fields.reminderAt ?? existing.reminderAt,
    timezone: fields.timezone === null ? undefined : fields.timezone ?? existing.timezone,
    properties: fields.properties ?? existing.properties,
    status,
    completedAt: status === "done"
      ? existing.completedAt ?? now
      : undefined,
    updatedAt: now,
  })
  Repository.updateTodo(todo)
  insertAudit({
    action: "todo.updated",
    entityType: "todo",
    entityId: todo.id,
    before: toRecord(existing),
    after: toRecord(todo),
  }, { ...context, now })
  return todo
}

export function scheduleTodo(id: string, rawSchedule: PlannerScheduleUpdate, context: MutationContext = {}) {
  const schedule = PlannerScheduleUpdate.parse(rawSchedule)
  validateSchedule(schedule)
  const existing = requireTodo(id)
  const now = nextUpdatedAt(existing, context)
  const clearing = schedule.scheduledStartAt === null && schedule.scheduledEndAt === null
  const todo = PlannerTodo.parse({
    ...existing,
    scheduledStartAt: clearing ? undefined : schedule.scheduledStartAt,
    scheduledEndAt: clearing ? undefined : schedule.scheduledEndAt,
    updatedAt: now,
  })
  Repository.updateTodo(todo)
  insertAudit({
    action: clearing ? "todo.unscheduled" : "todo.scheduled",
    entityType: "todo",
    entityId: todo.id,
    before: toRecord(existing),
    after: toRecord(todo),
  }, { ...context, now })
  return todo
}

/**
 * Compatibility mutation for clients that historically edited todo fields and
 * schedule fields through one Calendar endpoint. Validation happens before the
 * transaction writes either part.
 */
export function updateTodoAndSchedule(
  id: string,
  rawFields: PlannerTodoUpdate,
  rawSchedule: {
    scheduledStartAt?: number | null
    scheduledEndAt?: number | null
  },
  context: MutationContext = {},
) {
  const fields = PlannerTodoUpdate.parse(rawFields)
  const existing = requireTodo(id)
  const hasStart = Object.prototype.hasOwnProperty.call(rawSchedule, "scheduledStartAt")
  const hasEnd = Object.prototype.hasOwnProperty.call(rawSchedule, "scheduledEndAt")
  const hasScheduleChange = hasStart || hasEnd
  const clearSchedule = rawSchedule.scheduledStartAt === null || rawSchedule.scheduledEndAt === null
  const schedule = hasScheduleChange
    ? {
        scheduledStartAt: clearSchedule
          ? null
          : rawSchedule.scheduledStartAt ?? existing.scheduledStartAt ?? null,
        scheduledEndAt: clearSchedule
          ? null
          : rawSchedule.scheduledEndAt ?? existing.scheduledEndAt ?? null,
      }
    : undefined

  if (schedule) validateSchedule(schedule)
  return Repository.transaction(() => {
    let todo = existing
    if (Object.keys(fields).length > 0) todo = updateTodo(id, fields, context)
    if (schedule) todo = scheduleTodo(id, schedule, context)
    return todo
  })
}

export function completeTodo(id: string, completed = true, context: MutationContext = {}) {
  const existing = requireTodo(id)
  const now = nextUpdatedAt(existing, context)
  const todo = PlannerTodo.parse({
    ...existing,
    status: completed ? "done" : "todo",
    completedAt: completed ? existing.completedAt ?? now : undefined,
    updatedAt: now,
  })
  Repository.updateTodo(todo)
  insertAudit({
    action: completed ? "todo.completed" : "todo.restored",
    entityType: "todo",
    entityId: todo.id,
    before: toRecord(existing),
    after: toRecord(todo),
  }, { ...context, now })
  return todo
}

export function deleteTodo(id: string, context: MutationContext = {}) {
  const existing = requireTodo(id)
  const child = Repository.listTodos().find((todo) => todo.parentTodoId === id)
  if (child) {
    throw new PlannerError(
      "PLANNER_TODO_HAS_CHILDREN",
      `Planner todo '${id}' cannot be deleted while it has child todos.`,
      { id, childTodoId: child.id },
    )
  }
  Repository.deleteTodo(id)
  insertAudit({
    action: "todo.deleted",
    entityType: "todo",
    entityId: id,
    before: toRecord(existing),
  }, context)
  return { todoId: id, deleted: true as const }
}

function validateChange(change: PlannerChange, createdTodoIds = new Set<string>()) {
  switch (change.kind) {
    case "create": {
      validateSchedule(change.todo)
      if (change.todo.id && (Repository.getTodo(change.todo.id) || createdTodoIds.has(change.todo.id))) {
        throw new PlannerError("PLANNER_TODO_EXISTS", `Planner todo '${change.todo.id}' already exists.`)
      }
      if (change.todo.id) createdTodoIds.add(change.todo.id)
      if (change.todo.parentTodoId
        && !Repository.getTodo(change.todo.parentTodoId)
        && !createdTodoIds.has(change.todo.parentTodoId)) {
        throw new PlannerError(
          "PLANNER_TODO_NOT_FOUND",
          `Planner parent todo '${change.todo.parentTodoId}' was not found.`,
        )
      }
      return
    }
    case "update":
      requireTodo(change.todoId)
      if (Object.keys(change.fields).length === 0) {
        throw new PlannerError("EMPTY_PLANNER_UPDATE", "A proposal update change must contain at least one field.")
      }
      return
    case "schedule":
      requireTodo(change.todoId)
      validateSchedule(change)
      return
    case "complete":
      requireTodo(change.todoId)
      return
  }
}

export function listProposals(input: { status?: PlanProposalStatus | "all" } = {}) {
  return Repository.listProposals().filter((proposal) =>
    !input.status || input.status === "all" || proposal.status === input.status,
  )
}

export function getProposal(id: string) {
  return Repository.getProposal(id)
}

export function createProposal(rawInput: {
  reason: string
  changes: PlannerChange[]
  sourceSessionId?: string
  sourceTurnId?: string
}, context: MutationContext = {}) {
  const parsed = z.object({
    reason: z.string().trim().min(1),
    changes: z.array(PlannerChange).min(1),
    sourceSessionId: z.string().optional(),
    sourceTurnId: z.string().optional(),
  }).parse(rawInput)
  const createdTodoIds = new Set<string>()
  for (const change of parsed.changes) validateChange(change, createdTodoIds)
  const proposal = PlanProposal.parse({
    id: Repository.createProposalID(),
    reason: parsed.reason,
    changes: parsed.changes,
    status: "pending",
    sourceSessionId: parsed.sourceSessionId ?? context.sourceSessionId,
    sourceTurnId: parsed.sourceTurnId ?? context.sourceTurnId,
    createdAt: mutationTime(context),
  })
  Repository.insertProposal(proposal)
  insertAudit({
    action: "proposal.created",
    entityType: "proposal",
    entityId: proposal.id,
    after: toRecord(proposal),
  }, context)
  return proposal
}

function assertExpectedVersions(changes: PlannerChange[]) {
  for (const change of changes) {
    if (change.kind === "create" || change.expectedUpdatedAt === undefined) continue
    const todo = requireTodo(change.todoId)
    if (todo.updatedAt !== change.expectedUpdatedAt) {
      throw new PlannerError(
        "PLANNER_VERSION_CONFLICT",
        `Planner todo '${todo.id}' changed after this proposal was created.`,
        {
          todoId: todo.id,
          expectedUpdatedAt: change.expectedUpdatedAt,
          actualUpdatedAt: todo.updatedAt,
        },
      )
    }
  }
}

function applyProposalChange(change: PlannerChange, context: MutationContext) {
  switch (change.kind) {
    case "create":
      return createTodo(change.todo, context)
    case "update":
      return updateTodo(change.todoId, change.fields, context)
    case "schedule":
      return scheduleTodo(change.todoId, {
        scheduledStartAt: change.scheduledStartAt,
        scheduledEndAt: change.scheduledEndAt,
      }, context)
    case "complete":
      return completeTodo(change.todoId, change.completed, context)
  }
}

export function acceptProposal(id: string, context: MutationContext = {}) {
  return Repository.transaction(() => {
    const proposal = requireProposal(id)
    if (proposal.status !== "pending") {
      throw new PlannerError(
        "PLANNER_PROPOSAL_NOT_PENDING",
        `Planner proposal '${id}' is already ${proposal.status}.`,
        { id, status: proposal.status },
      )
    }
    assertExpectedVersions(proposal.changes)
    const now = mutationTime(context)
    const appliedTodos = proposal.changes.map((change) => applyProposalChange(change, { ...context, now }))
    const accepted = PlanProposal.parse({
      ...proposal,
      status: "accepted",
      decidedAt: now,
    })
    Repository.updateProposal(accepted)
    insertAudit({
      action: "proposal.accepted",
      entityType: "proposal",
      entityId: accepted.id,
      before: toRecord(proposal),
      after: toRecord(accepted),
    }, { ...context, now })
    return { proposal: accepted, appliedTodos }
  })
}

export function dismissProposal(id: string, decisionReason?: string, context: MutationContext = {}) {
  return Repository.transaction(() => {
    const proposal = requireProposal(id)
    if (proposal.status !== "pending") {
      throw new PlannerError(
        "PLANNER_PROPOSAL_NOT_PENDING",
        `Planner proposal '${id}' is already ${proposal.status}.`,
        { id, status: proposal.status },
      )
    }
    const now = mutationTime(context)
    const dismissed = PlanProposal.parse({
      ...proposal,
      status: "dismissed",
      decidedAt: now,
      decisionReason: decisionReason?.trim() || undefined,
    })
    Repository.updateProposal(dismissed)
    insertAudit({
      action: "proposal.dismissed",
      entityType: "proposal",
      entityId: dismissed.id,
      before: toRecord(proposal),
      after: toRecord(dismissed),
    }, { ...context, now })
    return dismissed
  })
}

export function listRuns(input: { todoId?: string; status?: AgentTaskRunStatus | "all" } = {}) {
  return Repository.listRuns().filter((run) => {
    if (input.todoId && run.todoId !== input.todoId) return false
    if (input.status && input.status !== "all" && run.status !== input.status) return false
    return true
  })
}

export function getRun(id: string) {
  return Repository.getRun(id)
}

export function createRun(rawInput: {
  todoId: string
  projectId?: string
  directory?: string
  sessionId?: string
  turnId?: string
  sourceSessionId?: string
  sourceTurnId?: string
  retryOfRunId?: string
  prompt?: string
  permissionMode?: "read-only" | "default"
  requestedToolModuleIds?: string[]
  input?: Record<string, unknown>
}, context: MutationContext = {}) {
  const todo = requireTodo(rawInput.todoId)
  const parsed = z.object({
    todoId: z.string().trim().min(1),
    projectId: z.string().trim().min(1).optional(),
    directory: z.string().trim().min(1).optional(),
    sessionId: z.string().trim().min(1).optional(),
    turnId: z.string().trim().min(1).optional(),
    sourceSessionId: z.string().trim().min(1).optional(),
    sourceTurnId: z.string().trim().min(1).optional(),
    retryOfRunId: z.string().trim().min(1).optional(),
    prompt: z.string().trim().min(1).optional(),
    permissionMode: z.enum(["read-only", "default"]).optional(),
    requestedToolModuleIds: z.array(z.string().trim().min(1)).optional(),
    input: z.record(z.string(), z.unknown()).optional(),
  }).parse(rawInput)
  if (parsed.retryOfRunId) requireRun(parsed.retryOfRunId)
  const now = mutationTime(context)
  const run = AgentTaskRun.parse({
    id: Repository.createRunID(),
    todoId: parsed.todoId,
    projectId: parsed.projectId ?? todo.projectId,
    directory: parsed.directory,
    sessionId: parsed.sessionId,
    turnId: parsed.turnId,
    sourceSessionId: parsed.sourceSessionId ?? context.sourceSessionId,
    sourceTurnId: parsed.sourceTurnId ?? context.sourceTurnId,
    retryOfRunId: parsed.retryOfRunId,
    status: "queued",
    prompt: parsed.prompt,
    permissionMode: parsed.permissionMode ?? "default",
    requestedToolModuleIds: [...new Set(parsed.requestedToolModuleIds ?? [])],
    input: parsed.input,
    createdAt: now,
    updatedAt: now,
  })
  Repository.insertRun(run)
  insertAudit({
    action: "run.created",
    entityType: "run",
    entityId: run.id,
    after: toRecord(run),
  }, context)
  return run
}

const allowedRunTransitions: Record<AgentTaskRunStatus, AgentTaskRunStatus[]> = {
  queued: ["running", "canceled", "blocked", "failed"],
  running: ["completed", "failed", "canceled", "blocked"],
  blocked: ["queued", "running", "canceled", "failed"],
  completed: [],
  failed: [],
  canceled: [],
}

export function transitionRun(id: string, rawInput: {
  status: AgentTaskRunStatus
  projectId?: string
  directory?: string
  sessionId?: string
  turnId?: string
  result?: Record<string, unknown>
  error?: string
}, context: MutationContext = {}) {
  const input = z.object({
    status: AgentTaskRunStatus,
    projectId: z.string().trim().min(1).optional(),
    directory: z.string().trim().min(1).optional(),
    sessionId: z.string().trim().min(1).optional(),
    turnId: z.string().trim().min(1).optional(),
    result: z.record(z.string(), z.unknown()).optional(),
    error: z.string().optional(),
  }).parse(rawInput)
  const existing = requireRun(id)
  if (!allowedRunTransitions[existing.status].includes(input.status)) {
    throw new PlannerError(
      "INVALID_PLANNER_RUN_TRANSITION",
      `Planner Agent run cannot transition from ${existing.status} to ${input.status}.`,
    )
  }
  const now = Math.max(mutationTime(context), existing.updatedAt + 1)
  const terminal = ["completed", "failed", "canceled"].includes(input.status)
  const run = AgentTaskRun.parse({
    ...existing,
    status: input.status,
    projectId: input.projectId ?? existing.projectId,
    directory: input.directory ?? existing.directory,
    sessionId: input.sessionId ?? existing.sessionId,
    turnId: input.turnId ?? existing.turnId,
    result: input.result ?? existing.result,
    error: input.error ?? existing.error,
    startedAt: input.status === "running" ? existing.startedAt ?? now : existing.startedAt,
    completedAt: terminal ? now : undefined,
    updatedAt: now,
  })
  Repository.updateRun(run)
  insertAudit({
    action: `run.${input.status}`,
    entityType: "run",
    entityId: run.id,
    before: toRecord(existing),
    after: toRecord(run),
  }, { ...context, now })
  return run
}

export function linkAutomation(
  todoId: string,
  automationId: string,
  linked = true,
  context: MutationContext = {},
) {
  const existing = requireTodo(todoId)
  const normalizedAutomationId = z.string().trim().min(1).parse(automationId)
  const current = [...new Set(existing.automationIds ?? [])]
  const nextAutomationIds = linked
    ? [...new Set([...current, normalizedAutomationId])]
    : current.filter((id) => id !== normalizedAutomationId)
  if (nextAutomationIds.length === current.length
    && nextAutomationIds.every((id, index) => id === current[index])) {
    return existing
  }

  const now = Math.max(mutationTime(context), existing.updatedAt + 1)
  const todo = PlannerTodo.parse({
    ...existing,
    automationIds: nextAutomationIds.length > 0 ? nextAutomationIds : undefined,
    updatedAt: now,
  })
  Repository.updateTodo(todo)
  insertAudit({
    action: linked ? "todo.automation.linked" : "todo.automation.unlinked",
    entityType: "todo",
    entityId: todo.id,
    before: toRecord(existing),
    after: toRecord(todo),
  }, { ...context, now })
  return todo
}

export function listAuditEvents(input: Parameters<typeof Repository.listAuditEvents>[0] = {}) {
  return Repository.listAuditEvents(input)
}
