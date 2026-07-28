import z from "zod"
import * as db from "#database/Sqlite.ts"
import * as Message from "#session/core/message.ts"
import * as Orchestrator from "#session/runtime/orchestrator.ts"
import * as Session from "#session/core/session.ts"
import * as Task from "#session/tasks/task.ts"
import * as Tool from "#tool/tool.ts"

const Metadata = z.record(z.string(), z.any())

const TaskCreateItemParameters = z.object({
  id: z.string().min(1).optional().describe("Optional stable task id. If omitted, an id is generated."),
  subject: z.string().min(1).describe("Concise task title for task lists."),
  description: z.string().min(1).describe("Full task instructions for the agent."),
  activeForm: z.string().min(1).optional().describe("In-progress display text, such as 'Running tests'."),
  owner: z.string().min(1).optional().describe("Agent name or id responsible for this task."),
  status: Task.SessionTaskStatus.optional().describe("Initial status. Defaults to pending."),
  sortIndex: z.number().int().nonnegative().optional().describe("Optional stable display order. Defaults to creation order."),
  blocks: z.array(z.string().min(1)).optional().describe("Tasks unblocked when this task completes."),
  blockedBy: z.array(z.string().min(1)).optional().describe("Tasks that must complete before this task can start."),
  metadata: Metadata.optional().describe("Opaque task metadata for internal or product-specific fields."),
})

const TaskCreateParameters = z.object({
  tasks: z.array(TaskCreateItemParameters).min(1).max(50).describe("Tasks to create in the current session."),
})

const TaskGetParameters = z.object({
  id: z.string().min(1).describe("Task id to read."),
})

const TaskListParameters = z.object({
  owner: z.string().min(1).optional().describe("Optional owner filter."),
  status: Task.SessionTaskStatus.optional().describe("Optional status filter."),
  includeCompleted: z.boolean().optional().describe("Whether completed tasks are included. Defaults to true."),
})

const TaskUpdateParameters = z.object({
  id: z.string().min(1).describe("Task id to update."),
  subject: z.string().min(1).optional().describe("Updated concise title."),
  description: z.string().min(1).optional().describe("Updated full task instructions."),
  activeForm: z.string().min(1).optional().describe("Updated in-progress display text."),
  owner: z.string().min(1).optional().describe("Updated task owner."),
  status: Task.SessionTaskStatus.optional().describe("Next task status."),
  sortIndex: z.number().int().nonnegative().optional().describe("Updated stable display order."),
  blocks: z.array(z.string().min(1)).optional().describe("Replacement list of tasks unblocked by this task."),
  blockedBy: z.array(z.string().min(1)).optional().describe("Replacement list of prerequisites for this task."),
  metadata: Metadata.optional().describe("Replacement opaque task metadata."),
})

function findSourceUserMessageID(sessionID: string, assistantMessageID: string) {
  const assistant = Session.DataBaseRead("messages", assistantMessageID) as Message.MessageInfo | null
  const assistantCreated = assistant?.role === "assistant" ? assistant.created : Number.MAX_SAFE_INTEGER
  const messages = db.findManyWithSchema("messages", Message.MessageInfo, {
    where: [{ column: "sessionID", value: sessionID }],
    orderBy: [{ column: "created", direction: "DESC" }],
  })

  return messages.find(
    (message): message is Message.User =>
      message.role === "user" && message.created <= assistantCreated,
  )?.id
}

function defaultOwner(initctx: Tool.InitContext | undefined) {
  return initctx?.agent?.name?.trim() || "default"
}

function sourceFromContext(ctx: Tool.Context): Task.TaskSource {
  return {
    sourceAssistantMessageID: ctx.messageID,
    sourceUserMessageID: findSourceUserMessageID(ctx.sessionID, ctx.messageID),
    toolCallID: ctx.toolCallID,
  }
}

function emitTaskStateUpdated(
  ctx: Tool.Context,
  input: {
    action: "create" | "update" | "replace"
    changedTaskIDs: string[]
    state: Task.SessionTaskListView
  },
) {
  Orchestrator.activeTurn(ctx.sessionID, ctx.turnID)?.emit("task.state.updated", input)
}

function renderTaskListText(state: Task.SessionTaskListView) {
  const lines = state.tasks.map((task) => {
    const blocked = task.isBlocked ? ` blocked by ${task.blockedBy.join(", ")}` : ""
    return `- [${task.status}] ${task.id} ${task.subject} (${task.owner})${blocked}`
  })

  return [
    `Tasks updated: ${state.summary.completed}/${state.summary.total} completed`,
    state.current.length > 0
      ? `Current: ${state.current.map((task) => `${task.owner}: ${task.activeForm}`).join("; ")}`
      : undefined,
    state.next.length > 0
      ? `Next: ${state.next.map((task) => `${task.owner}: ${task.subject}`).join("; ")}`
      : undefined,
    "",
    ...lines,
  ].filter((line): line is string => typeof line === "string").join("\n")
}

function taskMetadata(state: Task.SessionTaskListView, changedTaskIDs: string[], action: "create" | "update" | "replace") {
  return {
    kind: "task-state",
    action,
    changedTaskIDs,
    state,
  }
}

function toTaskModelOutput(result: Tool.ToolOutput) {
  const metadata = (result.metadata ?? {}) as Record<string, unknown>
  const state = Task.SessionTaskListView.safeParse(metadata.state)
  return {
    type: "json" as const,
    value: {
      kind: "task-state",
      updated: metadata.action === "create" || metadata.action === "update" || metadata.action === "replace",
      action: typeof metadata.action === "string" ? metadata.action : undefined,
      changedTaskIDs: Array.isArray(metadata.changedTaskIDs) ? metadata.changedTaskIDs : undefined,
      state: state.success ? state.data : undefined,
      message: result.text,
    },
  }
}

const workflowPermission = {
  action: "allow" as const,
  risk: "low" as const,
  reason: "Updating structured session tasks has no filesystem or command side effects.",
  allowInPlanning: true,
}

export const TaskCreateTool = Tool.define(
  "task_create",
  async (initctx) => ({
    title: "Create Tasks",
    description:
      "Create one or more structured session tasks. Use this to establish task progress, dependencies, owners, and initial statuses.",
    parameters: TaskCreateParameters,
    assessPermission: () => workflowPermission,
    execute: async (parameters, ctx) => {
      const input = TaskCreateParameters.parse(parameters)
      const result = Task.createSessionTasks({
        sessionID: ctx.sessionID,
        tasks: input.tasks,
        defaultOwner: defaultOwner(initctx),
        source: sourceFromContext(ctx),
      })
      emitTaskStateUpdated(ctx, {
        action: "create",
        changedTaskIDs: result.changedTaskIDs,
        state: result.state,
      })

      return {
        title: "Tasks created",
        text: renderTaskListText(result.state),
        metadata: taskMetadata(result.state, result.changedTaskIDs, "create"),
        data: result.state,
      }
    },
    toModelOutput: toTaskModelOutput,
  }),
  {
    title: "Create Tasks",
    aliases: ["TaskCreate", "task-create"],
    capabilities: {
      kind: "workflow",
      readOnly: false,
      destructive: false,
      concurrency: "exclusive",
    },
  },
)

export const TaskGetTool = Tool.define(
  "task_get",
  async () => ({
    title: "Get Task",
    description: "Read a single structured session task by id, including derived blocker information.",
    parameters: TaskGetParameters,
    assessPermission: () => ({
      ...workflowPermission,
      reason: "Reading structured session tasks has no side effects.",
    }),
    execute: async (parameters, ctx) => {
      const input = TaskGetParameters.parse(parameters)
      const task = Task.getSessionTask(ctx.sessionID, input.id)
      if (!task) {
        throw new Error(`Task '${input.id}' was not found.`)
      }

      return {
        title: "Task read",
        text: `${task.id}: ${task.subject} [${task.status}]`,
        metadata: {
          kind: "task",
          task,
        },
        data: task,
      }
    },
    toModelOutput: async (result) => ({
      type: "json" as const,
      value: {
        kind: "task",
        task: result.data as Task.SessionTaskView,
      },
    }),
  }),
  {
    title: "Get Task",
    aliases: ["TaskGet", "task-get"],
    capabilities: {
      kind: "workflow",
      readOnly: true,
      destructive: false,
      concurrency: "safe",
    },
  },
)

export const TaskListTool = Tool.define(
  "task_list",
  async () => ({
    title: "List Tasks",
    description:
      "Read the current structured task state for this session, including current tasks, next tasks, completion counts, blockers, and teammate activity.",
    parameters: TaskListParameters,
    assessPermission: () => ({
      ...workflowPermission,
      reason: "Reading structured session tasks has no side effects.",
    }),
    execute: async (parameters, ctx) => {
      const input = TaskListParameters.parse(parameters)
      const state = Task.listSessionTasks(ctx.sessionID, input)
      return {
        title: "Tasks listed",
        text: renderTaskListText(state),
        metadata: {
          kind: "task-state",
          action: "list",
          state,
        },
        data: state,
      }
    },
    toModelOutput: async (result) => {
      const state = Task.SessionTaskListView.safeParse(result.data)
      return {
        type: "json" as const,
        value: {
          kind: "task-state",
          state: state.success ? state.data : undefined,
          message: result.text,
        },
      }
    },
  }),
  {
    title: "List Tasks",
    aliases: ["TaskList", "task-list"],
    capabilities: {
      kind: "workflow",
      readOnly: true,
      destructive: false,
      concurrency: "safe",
    },
  },
)

export const TaskUpdateTool = Tool.define(
  "task_update",
  async () => ({
    title: "Update Task",
    description:
      "Update one structured session task. Use this to move status pending -> in_progress -> completed, change owner/details, or replace dependency lists.",
    parameters: TaskUpdateParameters,
    assessPermission: () => workflowPermission,
    execute: async (parameters, ctx) => {
      const input = TaskUpdateParameters.parse(parameters)
      const result = Task.updateSessionTask({
        sessionID: ctx.sessionID,
        update: input,
        source: sourceFromContext(ctx),
      })
      emitTaskStateUpdated(ctx, {
        action: "update",
        changedTaskIDs: result.changedTaskIDs,
        state: result.state,
      })

      return {
        title: "Task updated",
        text: renderTaskListText(result.state),
        metadata: taskMetadata(result.state, result.changedTaskIDs, "update"),
        data: result.state,
      }
    },
    toModelOutput: toTaskModelOutput,
  }),
  {
    title: "Update Task",
    aliases: ["TaskUpdate", "task-update"],
    capabilities: {
      kind: "workflow",
      readOnly: false,
      destructive: false,
      concurrency: "exclusive",
    },
  },
)
