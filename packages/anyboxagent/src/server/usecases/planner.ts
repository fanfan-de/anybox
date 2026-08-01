import z from "zod"
import { PLANNER_CORE_TOOL_MODULE_ID } from "@anybox/shared"
import * as Automation from "#automation/automation.ts"
import * as Planner from "#planner/model.ts"
import * as PlannerExecutor from "#planner/executor.ts"
import * as PlannerService from "#planner/service.ts"
import { ApiError } from "#server/error.ts"

const TrimmedString = z.string().transform((value) => value.trim()).pipe(z.string().min(1))
const OptionalTrimmedString = z.string().transform((value) => value.trim()).pipe(z.string()).optional()
const TimestampInput = z
  .union([z.string(), z.number()])
  .transform((value) => Number(value))
  .pipe(z.number().int().nonnegative())
const NullableTimestampInput = z.union([TimestampInput, z.null()])
const BooleanQuery = z.enum(["true", "false"]).transform((value) => value === "true")
const PositiveIntegerQuery = z.string().transform(Number).pipe(z.number().int().positive())

export const ListPlannerTodosQuery = z.object({
  view: Planner.PlannerTodoView.optional().default("all"),
  now: TimestampInput.optional(),
  query: z.string().optional(),
  projectId: TrimmedString.optional(),
  status: z.union([Planner.PlannerTodoStatus, z.literal("all")]).optional(),
  schedule: z.enum(["scheduled", "unscheduled", "all"]).optional(),
  dueAfter: TimestampInput.optional(),
  dueBefore: TimestampInput.optional(),
  includeTerminal: BooleanQuery.optional(),
  limit: PositiveIntegerQuery.pipe(z.number().max(500)).optional(),
})

export const CreatePlannerTodoBody = z.object({
  title: TrimmedString,
  description: OptionalTrimmedString,
  status: Planner.PlannerTodoStatus.optional(),
  priority: Planner.PlannerTodoPriority.optional(),
  projectId: TrimmedString.optional(),
  parentTodoId: TrimmedString.optional(),
  estimateMinutes: z.number().int().positive().optional(),
  scheduledStartAt: TimestampInput.optional(),
  scheduledEndAt: TimestampInput.optional(),
  dueAt: TimestampInput.optional(),
  reminderAt: TimestampInput.optional(),
  timezone: TrimmedString.optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
})

export const UpdatePlannerTodoBody = z.object({
  title: TrimmedString.optional(),
  description: OptionalTrimmedString.or(z.null()).optional(),
  status: Planner.PlannerTodoStatus.optional(),
  priority: Planner.PlannerTodoPriority.optional(),
  projectId: TrimmedString.or(z.null()).optional(),
  parentTodoId: TrimmedString.or(z.null()).optional(),
  estimateMinutes: z.number().int().positive().or(z.null()).optional(),
  dueAt: NullableTimestampInput.optional(),
  reminderAt: NullableTimestampInput.optional(),
  timezone: TrimmedString.or(z.null()).optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
}).refine((value) => Object.keys(value).length > 0, {
  message: "At least one Planner todo field must be updated.",
})

export const SchedulePlannerTodoBody = z.object({
  scheduledStartAt: NullableTimestampInput,
  scheduledEndAt: NullableTimestampInput,
})

export const CompletePlannerTodoBody = z.object({
  completed: z.boolean().optional().default(true),
})

export const ListPlanProposalsQuery = z.object({
  status: z.union([Planner.PlanProposalStatus, z.literal("all")]).optional(),
})

export const CreatePlanProposalBody = z.object({
  reason: TrimmedString,
  changes: z.array(Planner.PlannerChange).min(1),
  sourceSessionId: TrimmedString.optional(),
  sourceTurnId: TrimmedString.optional(),
})

export const DismissPlanProposalBody = z.object({
  reason: OptionalTrimmedString,
})

export const ListPlannerRunsQuery = z.object({
  todoId: TrimmedString.optional(),
  status: z.union([Planner.AgentTaskRunStatus, z.literal("all")]).optional(),
})

export const CreatePlannerRunBody = z.object({
  projectId: TrimmedString.optional(),
  directory: TrimmedString.optional(),
  prompt: TrimmedString.optional(),
  permissionMode: z.enum(["read-only", "default"]).optional().default("default"),
})

export const RetryPlannerRunBody = CreatePlannerRunBody.partial()

export const LinkPlannerAutomationBody = z.object({
  automationId: TrimmedString,
})

export const ListPlannerAuditQuery = z.object({
  entityType: Planner.PlannerAuditEvent.shape.entityType.optional(),
  entityId: TrimmedString.optional(),
})

function plannerCall<T>(fn: () => T): T {
  try {
    return fn()
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new ApiError(400, "INVALID_PLANNER_INPUT", "Planner input is invalid", {
        issues: error.issues,
      })
    }
    if (!PlannerService.isPlannerError(error)) throw error
    const status = error.code.endsWith("_NOT_FOUND")
      ? 404
      : [
          "PLANNER_TODO_EXISTS",
          "PLANNER_TODO_HAS_CHILDREN",
          "PLANNER_VERSION_CONFLICT",
          "PLANNER_PROPOSAL_NOT_PENDING",
        ].includes(error.code)
        ? 409
        : 400
    throw new ApiError(status, error.code, error.message, error.data)
  }
}

export function listTodos(input: z.output<typeof ListPlannerTodosQuery>) {
  return plannerCall(() => PlannerService.listTodos(input))
}

export function getTodo(id: string) {
  const todo = PlannerService.getTodo(id)
  if (!todo) throw new ApiError(404, "PLANNER_TODO_NOT_FOUND", `Planner todo '${id}' was not found.`)
  return todo
}

export function createTodo(input: z.output<typeof CreatePlannerTodoBody>) {
  return plannerCall(() => PlannerService.createTodo(input, { actor: "user" }))
}

export function updateTodo(id: string, input: z.output<typeof UpdatePlannerTodoBody>) {
  return plannerCall(() => PlannerService.updateTodo(id, input, { actor: "user" }))
}

export function scheduleTodo(id: string, input: z.output<typeof SchedulePlannerTodoBody>) {
  return plannerCall(() => PlannerService.scheduleTodo(id, input, { actor: "user" }))
}

export function completeTodo(id: string, input: z.output<typeof CompletePlannerTodoBody>) {
  return plannerCall(() => PlannerService.completeTodo(id, input.completed, { actor: "user" }))
}

export function deleteTodo(id: string) {
  return plannerCall(() => PlannerService.deleteTodo(id, { actor: "user" }))
}

export function listProposals(input: z.output<typeof ListPlanProposalsQuery>) {
  return PlannerService.listProposals(input)
}

export function getProposal(id: string) {
  const proposal = PlannerService.getProposal(id)
  if (!proposal) {
    throw new ApiError(404, "PLANNER_PROPOSAL_NOT_FOUND", `Planner proposal '${id}' was not found.`)
  }
  return proposal
}

export function createProposal(input: z.output<typeof CreatePlanProposalBody>) {
  return plannerCall(() => PlannerService.createProposal(input, {
    actor: "agent",
    sourceSessionId: input.sourceSessionId,
    sourceTurnId: input.sourceTurnId,
  }))
}

export function acceptProposal(id: string) {
  return plannerCall(() => PlannerService.acceptProposal(id, { actor: "user" }))
}

export function dismissProposal(id: string, input: z.output<typeof DismissPlanProposalBody>) {
  return plannerCall(() => PlannerService.dismissProposal(id, input.reason, { actor: "user" }))
}

export function listRuns(input: z.output<typeof ListPlannerRunsQuery>) {
  return PlannerService.listRuns(input)
}

export function getRun(id: string) {
  const run = PlannerService.getRun(id)
  if (!run) throw new ApiError(404, "PLANNER_RUN_NOT_FOUND", `Planner Agent run '${id}' was not found.`)
  return run
}

export function createRun(todoId: string, input: z.output<typeof CreatePlannerRunBody>) {
  const todo = getTodo(todoId)
  const projectId = input.projectId ?? todo.projectId
  if (!input.directory && !projectId) {
    throw new ApiError(
      400,
      "PLANNER_RUN_TARGET_REQUIRED",
      "Planner Agent runs need a project or directory target.",
    )
  }
  const run = plannerCall(() => PlannerService.createRun({
    todoId,
    projectId,
    directory: input.directory,
    prompt: input.prompt,
    permissionMode: input.permissionMode,
    requestedToolModuleIds: [PLANNER_CORE_TOOL_MODULE_ID],
    input: {
      trigger: "user",
      instructions: input.prompt,
    },
  }, { actor: "user" }))
  PlannerExecutor.startRun(run.id)
  return run
}

export function cancelRun(id: string) {
  getRun(id)
  return plannerCall(() => PlannerExecutor.cancelRun(id, { actor: "user" }))
}

export function retryRun(id: string, input: z.output<typeof RetryPlannerRunBody>) {
  const existing = getRun(id)
  if (!["failed", "canceled", "blocked"].includes(existing.status)) {
    throw new ApiError(
      409,
      "PLANNER_RUN_NOT_RETRYABLE",
      `Planner Agent run '${id}' cannot be retried while it is ${existing.status}.`,
    )
  }
  const run = plannerCall(() => PlannerService.createRun({
    todoId: existing.todoId,
    projectId: input.projectId ?? existing.projectId,
    directory: input.directory ?? existing.directory,
    prompt: input.prompt ?? existing.prompt,
    permissionMode: input.permissionMode ?? existing.permissionMode,
    requestedToolModuleIds: existing.requestedToolModuleIds ?? [PLANNER_CORE_TOOL_MODULE_ID],
    retryOfRunId: existing.id,
    input: {
      ...existing.input,
      trigger: "retry",
      retryOfRunId: existing.id,
    },
  }, { actor: "user" }))
  PlannerExecutor.startRun(run.id)
  return run
}

export function linkAutomation(todoId: string, input: z.output<typeof LinkPlannerAutomationBody>) {
  const automation = Automation.getAutomation(input.automationId)
  if (!automation || automation.status === "deleted") {
    throw new ApiError(
      404,
      "AUTOMATION_NOT_FOUND",
      `Automation '${input.automationId}' was not found.`,
    )
  }
  return plannerCall(() => PlannerService.linkAutomation(todoId, automation.id, true, { actor: "user" }))
}

export function unlinkAutomation(todoId: string, automationId: string) {
  return plannerCall(() => PlannerService.linkAutomation(todoId, automationId, false, { actor: "user" }))
}

export function listAuditEvents(input: z.output<typeof ListPlannerAuditQuery>) {
  return PlannerService.listAuditEvents(input)
}
