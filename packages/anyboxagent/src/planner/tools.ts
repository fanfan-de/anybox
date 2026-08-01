import type { JSONValue } from "@ai-sdk/provider"
import { PLANNER_CORE_TOOL_MODULE_ID } from "@anybox/shared"
import z from "zod"
import * as Automation from "#automation/automation.ts"
import * as Calendar from "#calendar/calendar.ts"
import * as PlannerExecutor from "#planner/executor.ts"
import * as Planner from "#planner/model.ts"
import * as PlannerService from "#planner/service.ts"
import * as Session from "#session/core/session.ts"
import * as Tool from "#tool/tool.ts"

const TimestampValue = z.union([
  z.number().int().nonnegative(),
  z.string().trim().min(1),
])

const NullableTimestampValue = z.union([TimestampValue, z.null()])

const PlannerListTodosParameters = z.object({
  query: z.string().trim().optional().describe("Optional case-insensitive title or description search."),
  view: Planner.PlannerTodoView.optional().describe("Planner view. Defaults to active todos in All."),
  status: z.union([Planner.PlannerTodoStatus, z.literal("all")]).optional().describe("Optional status filter."),
  schedule: z.enum(["scheduled", "unscheduled", "all"]).optional().describe("Schedule filter. Defaults to all."),
  dueAfter: TimestampValue.optional().describe("Only todos due at or after this epoch-millisecond or ISO timestamp."),
  dueBefore: TimestampValue.optional().describe("Only todos due at or before this epoch-millisecond or ISO timestamp."),
  projectId: z.string().trim().min(1).optional().describe("Optional project id filter."),
  workspaceId: z.string().trim().min(1).optional().describe("Deprecated alias for projectId."),
  limit: z.number().int().min(1).max(200).optional().describe("Maximum todos to return. Defaults to 50."),
})

const PlannerGetTodoParameters = z.object({
  id: z.string().trim().min(1).describe("Todo id."),
})

const PlannerCreateTodoParameters = z.object({
  title: z.string().trim().min(1).describe("Todo title."),
  description: z.string().trim().optional().describe("Optional todo description."),
  status: Planner.PlannerTodoStatus.optional().describe("Initial status. Defaults to todo for this compatibility tool."),
  priority: Planner.PlannerTodoPriority.optional().describe("Priority. Defaults to medium."),
  dueAt: TimestampValue.optional().describe("Optional deadline as epoch milliseconds or an ISO timestamp."),
  reminderAt: TimestampValue.optional().describe("Optional reminder as epoch milliseconds or an ISO timestamp."),
  scheduledStartAt: TimestampValue.optional().describe("Optional scheduled start as epoch milliseconds or an ISO timestamp."),
  scheduledEndAt: TimestampValue.optional().describe("Optional scheduled end as epoch milliseconds or an ISO timestamp."),
  estimateMinutes: z.number().int().positive().optional().describe("Estimated duration in minutes. Defaults to 60."),
  projectId: z.string().trim().min(1).optional().describe("Optional project id."),
  parentTodoId: z.string().trim().min(1).optional().describe("Optional parent todo id."),
  workspaceId: z.string().trim().min(1).optional().describe("Deprecated alias for projectId."),
  properties: z.record(z.string(), z.unknown()).optional().describe("Optional project-defined properties."),
  timezone: z.string().trim().min(1).optional().describe("Optional IANA timezone name."),
})

const PlannerUpdateTodoParameters = z.object({
  id: z.string().trim().min(1).describe("Todo id."),
  title: z.string().trim().min(1).optional().describe("Replacement title."),
  description: z.string().trim().nullable().optional().describe("Replacement description; null clears it."),
  status: Planner.PlannerTodoStatus.optional().describe("Replacement workflow status."),
  priority: Planner.PlannerTodoPriority.optional().describe("Replacement priority."),
  dueAt: NullableTimestampValue.optional().describe("Replacement deadline; null clears it."),
  reminderAt: NullableTimestampValue.optional().describe("Replacement reminder; null clears it."),
  estimateMinutes: z.number().int().positive().optional().describe("Replacement estimate in minutes."),
  projectId: z.string().trim().min(1).nullable().optional().describe("Replacement project id; null clears it."),
  parentTodoId: z.string().trim().min(1).nullable().optional().describe("Replacement parent todo id; null clears it."),
  workspaceId: z.string().trim().min(1).nullable().optional().describe("Deprecated alias for projectId."),
  properties: z.record(z.string(), z.unknown()).optional().describe("Replacement project-defined properties."),
  timezone: z.string().trim().min(1).nullable().optional().describe("Replacement timezone; null clears it."),
}).refine(
  (value) => Object.keys(value).some((key) => key !== "id"),
  { message: "At least one todo field must be updated." },
)

const PlannerCompleteTodoParameters = z.object({
  id: z.string().trim().min(1).describe("Todo id."),
  completed: z.boolean().optional().describe("True completes the todo; false restores it. Defaults to true."),
})

const PlannerScheduleTodoParameters = z.object({
  id: z.string().trim().min(1).describe("Todo id."),
  scheduledStartAt: NullableTimestampValue.describe("Scheduled start; null clears the schedule."),
  scheduledEndAt: NullableTimestampValue.describe("Scheduled end; null clears the schedule."),
})

const PlannerFindFreeTimeParameters = z.object({
  rangeStartAt: TimestampValue.describe("Search range start as epoch milliseconds or an ISO timestamp."),
  rangeEndAt: TimestampValue.describe("Search range end as epoch milliseconds or an ISO timestamp."),
  durationMinutes: z.number().int().positive().max(24 * 60).describe("Required free-slot duration in minutes."),
  bufferMinutes: z.number().int().nonnegative().max(240).optional().describe("Buffer added around busy blocks. Defaults to 0."),
  excludeTodoIDs: z.array(z.string().trim().min(1)).max(100).optional().describe("Scheduled todos to ignore."),
  limit: z.number().int().min(1).max(20).optional().describe("Maximum candidate slots. Defaults to 5."),
})

const ProposalTodoCreate = z.object({
  id: z.string().trim().min(1).optional().describe("Optional preallocated todo id."),
  title: z.string().trim().min(1),
  description: z.string().trim().optional(),
  status: Planner.PlannerTodoStatus.optional(),
  priority: Planner.PlannerTodoPriority.optional(),
  projectId: z.string().trim().min(1).optional(),
  parentTodoId: z.string().trim().min(1).optional(),
  estimateMinutes: z.number().int().positive().optional(),
  scheduledStartAt: TimestampValue.optional(),
  scheduledEndAt: TimestampValue.optional(),
  dueAt: TimestampValue.optional(),
  reminderAt: TimestampValue.optional(),
  timezone: z.string().trim().min(1).optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
})

const ProposalTodoUpdate = z.object({
  title: z.string().trim().min(1).optional(),
  description: z.string().trim().nullable().optional(),
  status: Planner.PlannerTodoStatus.optional(),
  priority: Planner.PlannerTodoPriority.optional(),
  projectId: z.string().trim().min(1).nullable().optional(),
  parentTodoId: z.string().trim().min(1).nullable().optional(),
  estimateMinutes: z.number().int().positive().nullable().optional(),
  dueAt: NullableTimestampValue.optional(),
  reminderAt: NullableTimestampValue.optional(),
  timezone: z.string().trim().min(1).nullable().optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
}).refine((value) => Object.keys(value).length > 0, {
  message: "A proposal update must contain at least one field.",
})

const ProposalChangeParameters = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("create"),
    todo: ProposalTodoCreate,
  }),
  z.object({
    kind: z.literal("update"),
    todoId: z.string().trim().min(1),
    fields: ProposalTodoUpdate,
    expectedUpdatedAt: TimestampValue.optional(),
  }),
  z.object({
    kind: z.literal("schedule"),
    todoId: z.string().trim().min(1),
    scheduledStartAt: NullableTimestampValue,
    scheduledEndAt: NullableTimestampValue,
    expectedUpdatedAt: TimestampValue.optional(),
  }),
  z.object({
    kind: z.literal("complete"),
    todoId: z.string().trim().min(1),
    completed: z.boolean().optional().default(true),
    expectedUpdatedAt: TimestampValue.optional(),
  }),
])

const PlannerCreateProposalParameters = z.object({
  reason: z.string().trim().min(1).describe("Why these changes are being proposed."),
  changes: z.array(ProposalChangeParameters).min(1).max(100).describe("Atomic Planner changes to review."),
})

const PlannerAcceptProposalParameters = z.object({
  id: z.string().trim().min(1).describe("Pending proposal id."),
})

const PlannerDismissProposalParameters = z.object({
  id: z.string().trim().min(1).describe("Pending proposal id."),
  reason: z.string().trim().optional().describe("Optional reason for dismissal."),
})

const PlannerRunTodoParameters = z.object({
  id: z.string().trim().min(1).describe("Todo id to delegate."),
  instructions: z.string().trim().min(1).optional().describe("Optional execution instructions in addition to the todo context."),
  permissionMode: z.enum(["read-only", "default"]).optional().default("default")
    .describe("Use read-only when the delegated work should not modify files or external state."),
})

const PlannerLinkAutomationParameters = z.object({
  id: z.string().trim().min(1).describe("Todo id."),
  automationId: z.string().trim().min(1).describe("Existing Automation definition id."),
  linked: z.boolean().optional().default(true).describe("True links the Automation; false removes the link."),
})

function toTimestamp(value: z.input<typeof TimestampValue>, field: string) {
  if (typeof value === "number") return value

  const numeric = Number(value)
  if (Number.isInteger(numeric) && numeric >= 0) return numeric

  const parsed = Date.parse(value)
  if (Number.isFinite(parsed) && parsed >= 0) return parsed
  throw new Error(`${field} must be an epoch-millisecond value or a valid ISO timestamp.`)
}

function toOptionalTimestamp(
  value: z.input<typeof NullableTimestampValue> | undefined,
  field: string,
) {
  if (value === undefined || value === null) return value
  return toTimestamp(value, field)
}

function toNullableTimestamp(
  value: z.input<typeof NullableTimestampValue>,
  field: string,
) {
  return value === null ? null : toTimestamp(value, field)
}

function requireTodo(id: string) {
  const todo = PlannerService.getTodo(id)
  if (!todo) throw new Error(`Planner todo '${id}' was not found.`)
  return todo
}

function normalizeProposalChange(change: z.output<typeof ProposalChangeParameters>): Planner.PlannerChange {
  switch (change.kind) {
    case "create":
      return Planner.PlannerChange.parse({
        ...change,
        todo: {
          ...change.todo,
          scheduledStartAt: change.todo.scheduledStartAt === undefined
            ? undefined
            : toTimestamp(change.todo.scheduledStartAt, "scheduledStartAt"),
          scheduledEndAt: change.todo.scheduledEndAt === undefined
            ? undefined
            : toTimestamp(change.todo.scheduledEndAt, "scheduledEndAt"),
          dueAt: change.todo.dueAt === undefined ? undefined : toTimestamp(change.todo.dueAt, "dueAt"),
          reminderAt: change.todo.reminderAt === undefined
            ? undefined
            : toTimestamp(change.todo.reminderAt, "reminderAt"),
        },
      })
    case "update":
      return Planner.PlannerChange.parse({
        ...change,
        fields: {
          ...change.fields,
          dueAt: toOptionalTimestamp(change.fields.dueAt, "dueAt"),
          reminderAt: toOptionalTimestamp(change.fields.reminderAt, "reminderAt"),
        },
        expectedUpdatedAt: change.expectedUpdatedAt === undefined
          ? undefined
          : toTimestamp(change.expectedUpdatedAt, "expectedUpdatedAt"),
      })
    case "schedule":
      return Planner.PlannerChange.parse({
        ...change,
        scheduledStartAt: toOptionalTimestamp(change.scheduledStartAt, "scheduledStartAt"),
        scheduledEndAt: toOptionalTimestamp(change.scheduledEndAt, "scheduledEndAt"),
        expectedUpdatedAt: change.expectedUpdatedAt === undefined
          ? undefined
          : toTimestamp(change.expectedUpdatedAt, "expectedUpdatedAt"),
      })
    case "complete":
      return Planner.PlannerChange.parse({
        ...change,
        expectedUpdatedAt: change.expectedUpdatedAt === undefined
          ? undefined
          : toTimestamp(change.expectedUpdatedAt, "expectedUpdatedAt"),
      })
  }
}

function jsonOutput(title: string, data: unknown): Tool.ToolOutput<Record<string, unknown>, unknown> {
  return {
    title,
    text: JSON.stringify(data, null, 2),
    metadata: {
      kind: "planner",
    },
    data,
  }
}

function toJsonModelOutput(result: Tool.ToolOutput<Record<string, unknown>, unknown>) {
  return {
    type: "json" as const,
    value: (result.data ?? { message: result.text }) as JSONValue,
  }
}

const readPermission = {
  action: "allow" as const,
  risk: "low" as const,
  reason: "Reading local Anybox Planner data has no external side effects.",
  allowInPlanning: true,
}

export const PlannerListTodosTool = Tool.define(
  "planner_list_todos",
  async () => ({
    title: "List Planner Todos",
    description: "List Anybox Planner todos with optional status, schedule, deadline, workspace, and text filters.",
    parameters: PlannerListTodosParameters,
    assessPermission: () => readPermission,
    execute: async (parameters) => {
      const input = PlannerListTodosParameters.parse(parameters)
      const query = input.query?.toLocaleLowerCase()
      const dueAfter = input.dueAfter === undefined ? undefined : toTimestamp(input.dueAfter, "dueAfter")
      const dueBefore = input.dueBefore === undefined ? undefined : toTimestamp(input.dueBefore, "dueBefore")
      const todos = PlannerService.listTodos({
        view: input.view,
        query,
        status: input.status,
        schedule: input.schedule,
        dueAfter,
        dueBefore,
        projectId: input.projectId ?? input.workspaceId,
        includeTerminal: input.status === "all",
        limit: input.limit ?? 50,
      })

      return jsonOutput(`Planner todos: ${todos.length}`, {
        todos,
        count: todos.length,
      })
    },
    toModelOutput: toJsonModelOutput,
  }),
  {
    title: "List Planner Todos",
    description: "List and filter Anybox Planner todos.",
    capabilities: {
      kind: "read",
      readOnly: true,
      destructive: false,
      concurrency: "safe",
    },
  },
)

export const PlannerGetTodoTool = Tool.define(
  "planner_get_todo",
  async () => ({
    title: "Get Planner Todo",
    description: "Read one Anybox Planner todo by id.",
    parameters: PlannerGetTodoParameters,
    assessPermission: () => readPermission,
    execute: async ({ id }) => jsonOutput("Planner todo", { todo: requireTodo(id) }),
    toModelOutput: toJsonModelOutput,
  }),
  {
    title: "Get Planner Todo",
    description: "Read one Anybox Planner todo by id.",
    capabilities: {
      kind: "read",
      readOnly: true,
      destructive: false,
      concurrency: "safe",
    },
  },
)

export const PlannerCreateTodoTool = Tool.define(
  "planner_create_todo",
  async () => ({
    title: "Create Planner Todo",
    description: "Create one Anybox Planner todo. Scheduling is optional.",
    parameters: PlannerCreateTodoParameters,
    describeApproval: ({ title }) => ({
      title: "Create Planner todo",
      summary: `Create the Planner todo '${title}'.`,
    }),
    execute: async (parameters) => {
      const input = PlannerCreateTodoParameters.parse(parameters)
      const todo = PlannerService.createTodo({
        ...input,
        status: input.status ?? "todo",
        projectId: input.projectId ?? input.workspaceId,
        workspaceId: input.projectId ?? input.workspaceId,
        dueAt: input.dueAt === undefined ? undefined : toTimestamp(input.dueAt, "dueAt"),
        reminderAt: input.reminderAt === undefined ? undefined : toTimestamp(input.reminderAt, "reminderAt"),
        scheduledStartAt: input.scheduledStartAt === undefined
          ? undefined
          : toTimestamp(input.scheduledStartAt, "scheduledStartAt"),
        scheduledEndAt: input.scheduledEndAt === undefined
          ? undefined
          : toTimestamp(input.scheduledEndAt, "scheduledEndAt"),
      }, { actor: "agent" })
      return jsonOutput("Planner todo created", { todo })
    },
    toModelOutput: toJsonModelOutput,
  }),
  {
    title: "Create Planner Todo",
    description: "Create one Anybox Planner todo with optional dates and properties.",
    capabilities: {
      kind: "write",
      readOnly: false,
      destructive: false,
      concurrency: "exclusive",
    },
  },
)

export const PlannerUpdateTodoTool = Tool.define(
  "planner_update_todo",
  async () => ({
    title: "Update Planner Todo",
    description: "Update fields on one Anybox Planner todo without changing completion or schedule fields.",
    parameters: PlannerUpdateTodoParameters,
    describeApproval: ({ id }) => ({
      title: "Update Planner todo",
      summary: `Update Planner todo '${id}'.`,
    }),
    execute: async (parameters) => {
      const input = PlannerUpdateTodoParameters.parse(parameters)
      const { id, ...fields } = input
      const update: Planner.PlannerTodoUpdate = {
        ...fields,
        dueAt: toOptionalTimestamp(input.dueAt, "dueAt"),
        reminderAt: toOptionalTimestamp(input.reminderAt, "reminderAt"),
      }
      if (Object.prototype.hasOwnProperty.call(input, "projectId")
        || Object.prototype.hasOwnProperty.call(input, "workspaceId")) {
        update.projectId = input.projectId ?? input.workspaceId ?? null
        update.workspaceId = input.projectId ?? input.workspaceId ?? null
      } else {
        delete update.projectId
        delete update.workspaceId
      }
      const todo = PlannerService.updateTodo(id, update, { actor: "agent" })
      return jsonOutput("Planner todo updated", { todo })
    },
    toModelOutput: toJsonModelOutput,
  }),
  {
    title: "Update Planner Todo",
    description: "Update one Anybox Planner todo.",
    capabilities: {
      kind: "write",
      readOnly: false,
      destructive: false,
      concurrency: "exclusive",
    },
  },
)

export const PlannerCompleteTodoTool = Tool.define(
  "planner_complete_todo",
  async () => ({
    title: "Complete Planner Todo",
    description: "Complete or restore one Anybox Planner todo.",
    parameters: PlannerCompleteTodoParameters,
    describeApproval: ({ id, completed = true }) => ({
      title: completed ? "Complete Planner todo" : "Restore Planner todo",
      summary: `${completed ? "Complete" : "Restore"} Planner todo '${id}'.`,
    }),
    execute: async ({ id, completed = true }) => {
      const todo = PlannerService.completeTodo(id, completed, { actor: "agent" })
      return jsonOutput(completed ? "Planner todo completed" : "Planner todo restored", { todo })
    },
    toModelOutput: toJsonModelOutput,
  }),
  {
    title: "Complete Planner Todo",
    description: "Complete or restore one Anybox Planner todo.",
    capabilities: {
      kind: "write",
      readOnly: false,
      destructive: false,
      concurrency: "exclusive",
    },
  },
)

export const PlannerScheduleTodoTool = Tool.define(
  "planner_schedule_todo",
  async () => ({
    title: "Schedule Planner Todo",
    description: "Set, move, or clear the execution time for one Anybox Planner todo without changing its deadline.",
    parameters: PlannerScheduleTodoParameters,
    describeApproval: ({ id, scheduledStartAt }) => ({
      title: scheduledStartAt === null ? "Clear Planner schedule" : "Schedule Planner todo",
      summary: `${scheduledStartAt === null ? "Clear the schedule for" : "Update the schedule of"} Planner todo '${id}'.`,
    }),
    execute: async (parameters) => {
      const input = PlannerScheduleTodoParameters.parse(parameters)
      const todo = PlannerService.scheduleTodo(input.id, {
        scheduledStartAt: toNullableTimestamp(input.scheduledStartAt, "scheduledStartAt"),
        scheduledEndAt: toNullableTimestamp(input.scheduledEndAt, "scheduledEndAt"),
      }, { actor: "agent" })
      return jsonOutput(input.scheduledStartAt === null ? "Planner schedule cleared" : "Planner todo scheduled", { todo })
    },
    toModelOutput: toJsonModelOutput,
  }),
  {
    title: "Schedule Planner Todo",
    description: "Set, move, or clear a Planner todo schedule without changing its deadline.",
    capabilities: {
      kind: "write",
      readOnly: false,
      destructive: false,
      concurrency: "exclusive",
    },
  },
)

type BusyRange = {
  startAt: number
  endAt: number
  source: "event" | "todo"
  sourceID: string
  title: string
}

function mergeBusyRanges(ranges: BusyRange[]) {
  const result: Array<BusyRange & { sources: BusyRange[] }> = []
  for (const range of ranges.toSorted((left, right) => left.startAt - right.startAt || left.endAt - right.endAt)) {
    const previous = result.at(-1)
    if (!previous || range.startAt > previous.endAt) {
      result.push({ ...range, sources: [range] })
      continue
    }

    previous.endAt = Math.max(previous.endAt, range.endAt)
    previous.sources.push(range)
  }
  return result
}

export const PlannerFindFreeTimeTool = Tool.define(
  "planner_find_free_time",
  async () => ({
    title: "Find Planner Free Time",
    description: "Find candidate free slots between scheduled Planner todos and local calendar events in an explicit time range.",
    parameters: PlannerFindFreeTimeParameters,
    assessPermission: () => readPermission,
    execute: async (parameters) => {
      const input = PlannerFindFreeTimeParameters.parse(parameters)
      const rangeStartAt = toTimestamp(input.rangeStartAt, "rangeStartAt")
      const rangeEndAt = toTimestamp(input.rangeEndAt, "rangeEndAt")
      if (rangeEndAt <= rangeStartAt) {
        throw new Error("rangeEndAt must be greater than rangeStartAt.")
      }

      const durationMs = input.durationMinutes * 60_000
      const bufferMs = (input.bufferMinutes ?? 0) * 60_000
      const excludedTodoIDs = new Set(input.excludeTodoIDs ?? [])
      const busyRanges: BusyRange[] = [
        ...PlannerService.listAllTodos()
          .filter((todo) => todo.status !== "done" && !excludedTodoIDs.has(todo.id))
          .filter((todo) => todo.scheduledStartAt !== undefined && todo.scheduledEndAt !== undefined)
          .map((todo) => ({
            startAt: Math.max(rangeStartAt, todo.scheduledStartAt! - bufferMs),
            endAt: Math.min(rangeEndAt, todo.scheduledEndAt! + bufferMs),
            source: "todo" as const,
            sourceID: todo.id,
            title: todo.title,
          })),
        ...Calendar.listEvents({ startAt: rangeStartAt, endAt: rangeEndAt })
          .filter((event) => event.status !== "canceled")
          .map((event) => ({
            startAt: Math.max(rangeStartAt, event.startAt - bufferMs),
            endAt: Math.min(rangeEndAt, event.endAt + bufferMs),
            source: "event" as const,
            sourceID: event.id,
            title: event.title,
          })),
      ].filter((range) => range.endAt > rangeStartAt && range.startAt < rangeEndAt)

      const mergedBusyRanges = mergeBusyRanges(busyRanges)
      const slots: Array<{
        startAt: number
        endAt: number
        startAtISO: string
        endAtISO: string
        availableUntil: number
      }> = []
      let cursor = rangeStartAt
      for (const busy of mergedBusyRanges) {
        if (busy.startAt - cursor >= durationMs) {
          const endAt = cursor + durationMs
          slots.push({
            startAt: cursor,
            endAt,
            startAtISO: new Date(cursor).toISOString(),
            endAtISO: new Date(endAt).toISOString(),
            availableUntil: busy.startAt,
          })
        }
        cursor = Math.max(cursor, busy.endAt)
        if (slots.length >= (input.limit ?? 5)) break
      }

      if (slots.length < (input.limit ?? 5) && rangeEndAt - cursor >= durationMs) {
        const endAt = cursor + durationMs
        slots.push({
          startAt: cursor,
          endAt,
          startAtISO: new Date(cursor).toISOString(),
          endAtISO: new Date(endAt).toISOString(),
          availableUntil: rangeEndAt,
        })
      }

      return jsonOutput(`Planner free slots: ${slots.length}`, {
        slots: slots.slice(0, input.limit ?? 5),
        busy: mergedBusyRanges,
        range: {
          startAt: rangeStartAt,
          endAt: rangeEndAt,
        },
      })
    },
    toModelOutput: toJsonModelOutput,
  }),
  {
    title: "Find Planner Free Time",
    description: "Find free time around scheduled Planner todos and local calendar events.",
    capabilities: {
      kind: "search",
      readOnly: true,
      destructive: false,
      concurrency: "safe",
    },
  },
)

export const PlannerCreateProposalTool = Tool.define(
  "planner_create_proposal",
  async () => ({
    title: "Create Planner Proposal",
    description: "Create a reviewable, unapplied set of Planner changes. This never changes todos until the proposal is accepted.",
    parameters: PlannerCreateProposalParameters,
    describeApproval: ({ changes }) => ({
      title: "Create Planner proposal",
      summary: `Create a Planner proposal with ${changes.length} change${changes.length === 1 ? "" : "s"}.`,
    }),
    execute: async (parameters, context) => {
      const input = PlannerCreateProposalParameters.parse(parameters)
      const proposal = PlannerService.createProposal({
        reason: input.reason,
        changes: input.changes.map(normalizeProposalChange),
        sourceSessionId: context.sessionID,
      }, {
        actor: "agent",
        sourceSessionId: context.sessionID,
      })
      return jsonOutput("Planner proposal created", { proposal })
    },
    toModelOutput: toJsonModelOutput,
  }),
  {
    title: "Create Planner Proposal",
    description: "Create reviewable Planner changes without applying them.",
    capabilities: {
      kind: "write",
      readOnly: false,
      destructive: false,
      concurrency: "exclusive",
    },
  },
)

export const PlannerAcceptProposalTool = Tool.define(
  "planner_accept_proposal",
  async () => ({
    title: "Accept Planner Proposal",
    description: "Atomically apply every change in one pending Planner proposal.",
    parameters: PlannerAcceptProposalParameters,
    assessPermission: () => ({
      action: "ask" as const,
      risk: "medium" as const,
      reason: "Applying a Planner proposal changes todos and always requires an explicit decision.",
      forceAsk: true,
    }),
    describeApproval: ({ id }) => ({
      title: "Apply Planner proposal",
      summary: `Atomically apply Planner proposal '${id}'.`,
    }),
    execute: async ({ id }, context) => {
      const result = PlannerService.acceptProposal(id, {
        actor: "agent",
        sourceSessionId: context.sessionID,
      })
      return jsonOutput("Planner proposal accepted", result)
    },
    toModelOutput: toJsonModelOutput,
  }),
  {
    title: "Accept Planner Proposal",
    description: "Atomically apply a pending Planner proposal after approval.",
    capabilities: {
      kind: "write",
      readOnly: false,
      destructive: false,
      concurrency: "exclusive",
    },
  },
)

export const PlannerDismissProposalTool = Tool.define(
  "planner_dismiss_proposal",
  async () => ({
    title: "Dismiss Planner Proposal",
    description: "Dismiss a pending Planner proposal without changing any todos.",
    parameters: PlannerDismissProposalParameters,
    describeApproval: ({ id }) => ({
      title: "Dismiss Planner proposal",
      summary: `Dismiss Planner proposal '${id}' without applying it.`,
    }),
    execute: async ({ id, reason }, context) => {
      const proposal = PlannerService.dismissProposal(id, reason, {
        actor: "agent",
        sourceSessionId: context.sessionID,
      })
      return jsonOutput("Planner proposal dismissed", { proposal })
    },
    toModelOutput: toJsonModelOutput,
  }),
  {
    title: "Dismiss Planner Proposal",
    description: "Dismiss a pending Planner proposal without applying it.",
    capabilities: {
      kind: "write",
      readOnly: false,
      destructive: false,
      concurrency: "exclusive",
    },
  },
)

export const PlannerRunTodoTool = Tool.define(
  "planner_run_todo",
  async () => ({
    title: "Run Planner Todo with Agent",
    description: "Start one separately tracked AgentTaskRun for an explicitly delegated Planner todo. This never marks the todo complete.",
    parameters: PlannerRunTodoParameters,
    assessPermission: () => ({
      action: "ask" as const,
      risk: "high" as const,
      reason: "Starting a delegated Agent run may use tools and perform external actions, so it always requires explicit approval.",
      forceAsk: true,
    }),
    describeApproval: ({ id, permissionMode }) => ({
      title: "Delegate Planner todo",
      summary: `Start a separate ${permissionMode === "read-only" ? "read-only " : ""}Agent run for Planner todo '${id}'.`,
    }),
    execute: async (parameters, context) => {
      const input = PlannerRunTodoParameters.parse(parameters)
      const todo = requireTodo(input.id)
      const sourceSession = Session.DataBaseRead("sessions", context.sessionID) as Session.SessionInfo | null
      if (!sourceSession) throw new Error(`Source session '${context.sessionID}' was not found.`)
      const projectId = todo.projectId ?? sourceSession.projectID
      const run = PlannerService.createRun({
        todoId: todo.id,
        projectId,
        directory: todo.projectId && todo.projectId !== sourceSession.projectID
          ? undefined
          : sourceSession.directory,
        sourceSessionId: context.sessionID,
        prompt: input.instructions,
        permissionMode: input.permissionMode,
        requestedToolModuleIds: [PLANNER_CORE_TOOL_MODULE_ID],
        input: {
          trigger: "planner_run_todo",
          instructions: input.instructions,
        },
      }, {
        actor: "agent",
        sourceSessionId: context.sessionID,
      })
      PlannerExecutor.startRun(run.id)
      return jsonOutput("Planner Agent run queued", { run, todo })
    },
    toModelOutput: toJsonModelOutput,
  }),
  {
    title: "Run Planner Todo with Agent",
    description: "Start an audited AgentTaskRun without changing Todo completion.",
    capabilities: {
      kind: "write",
      readOnly: false,
      destructive: false,
      concurrency: "exclusive",
    },
  },
)

export const PlannerLinkAutomationTool = Tool.define(
  "planner_link_automation",
  async () => ({
    title: "Link Planner Todo to Automation",
    description: "Link or unlink an existing Automation definition. This does not create or activate an Automation.",
    parameters: PlannerLinkAutomationParameters,
    assessPermission: () => ({
      action: "ask" as const,
      risk: "medium" as const,
      reason: "Changing the persistent Todo-to-Automation relationship requires an explicit decision.",
      forceAsk: true,
    }),
    describeApproval: ({ id, automationId, linked = true }) => ({
      title: linked ? "Link Automation" : "Unlink Automation",
      summary: `${linked ? "Link" : "Unlink"} Automation '${automationId}' ${linked ? "to" : "from"} Planner todo '${id}'.`,
    }),
    execute: async (parameters, context) => {
      const input = PlannerLinkAutomationParameters.parse(parameters)
      if (input.linked) {
        const automation = Automation.getAutomation(input.automationId)
        if (!automation || automation.status === "deleted") {
          throw new Error(`Automation '${input.automationId}' was not found.`)
        }
      }
      const todo = PlannerService.linkAutomation(input.id, input.automationId, input.linked, {
        actor: "agent",
        sourceSessionId: context.sessionID,
      })
      return jsonOutput(input.linked ? "Automation linked" : "Automation unlinked", { todo })
    },
    toModelOutput: toJsonModelOutput,
  }),
  {
    title: "Link Planner Todo to Automation",
    description: "Manage the explicit relationship between a Todo and an existing Automation.",
    capabilities: {
      kind: "write",
      readOnly: false,
      destructive: false,
      concurrency: "exclusive",
    },
  },
)

export const PlannerCoreTools = [
  PlannerListTodosTool,
  PlannerGetTodoTool,
  PlannerCreateTodoTool,
  PlannerUpdateTodoTool,
  PlannerCompleteTodoTool,
  PlannerScheduleTodoTool,
  PlannerFindFreeTimeTool,
  PlannerCreateProposalTool,
  PlannerAcceptProposalTool,
  PlannerDismissProposalTool,
  PlannerRunTodoTool,
  PlannerLinkAutomationTool,
] satisfies Tool.ToolInfo[]
