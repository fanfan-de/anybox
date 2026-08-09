import z from "zod"
import * as Log from "#util/log.ts"
import * as db from "#database/Sqlite.ts"
import * as Identifier from "#id/id.ts"
import { Instance } from "#project/instance.ts"
import * as Agent from "#agent/agent.ts"
import * as Provider from "#provider/provider.ts"
import * as Session from "#session/core/session.ts"
import * as Message from "#session/core/message.ts"
import * as RunningState from "#session/runtime/running-state.ts"

const log = Log.create({ service: "session.subtask" })
const MAX_STORED_SUMMARY_CHARS = 12_000

export const SubtaskStatus = z.enum([
  "running",
  "completed",
  "blocked",
  "stopped",
  "failed",
  "cancelled",
])
export type SubtaskStatus = z.infer<typeof SubtaskStatus>

export const ModelRef = z.object({
  providerID: z.string(),
  modelID: z.string(),
})
export type ModelRef = z.infer<typeof ModelRef>

export const ParentNotificationState = z.object({
  status: z.enum(["pending", "sent", "skipped"]),
  updatedAt: z.number().int().nonnegative(),
  reason: z.string().optional(),
})
export type ParentNotificationState = z.infer<typeof ParentNotificationState>

export const SubtaskRecord = z.object({
  id: Identifier.schema("task"),
  parentSessionID: Identifier.schema("session"),
  parentMessageID: Identifier.schema("message"),
  parentUserMessageID: Identifier.schema("message").optional(),
  parentToolCallID: z.string().optional(),
  childSessionID: Identifier.schema("session"),
  title: z.string(),
  prompt: z.string(),
  agent: z.string(),
  model: ModelRef,
  runInBackground: z.boolean(),
  permissionMode: z.string().default("default"),
  system: z.string().optional(),
  skills: z.array(z.string()).optional(),
  status: SubtaskStatus,
  summary: z.string().optional(),
  finishReason: z.string().optional(),
  error: z.string().optional(),
  latestAssistantMessageID: Identifier.schema("message").optional(),
  parentNotification: ParentNotificationState.optional(),
  startedAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  finishedAt: z.number().int().nonnegative().optional(),
})
  .meta({
    ref: "SubtaskRecord",
  })
export type SubtaskRecord = z.infer<typeof SubtaskRecord>

export type SubtaskView = SubtaskRecord & {
  active: boolean
}

export type CancelSubtasksResult = {
  cancelled: boolean
  cancelledCount: number
  cancelledTaskIDs: string[]
  cancelledSessionIDs: string[]
}

export type SubtaskSessionOrigin = {
  active: boolean
  agent: string
  parentMessageID: string
  parentSessionID: string
  parentToolCallID?: string
  status: SubtaskStatus
  taskID: string
  updatedAt: number
}

export const StartSubtaskInput = z.object({
  parentSessionID: Identifier.schema("session"),
  parentMessageID: Identifier.schema("message"),
  parentToolCallID: z.string().optional(),
  title: z.string().min(1).max(120).optional(),
  prompt: z.string().min(1),
  agent: z.string().min(1).default("default"),
  model: ModelRef.optional(),
  runInBackground: z.boolean().optional(),
  system: z.string().optional(),
  skills: z.array(z.string()).optional(),
})
export type StartSubtaskInput = z.infer<typeof StartSubtaskInput>
export type StartSubtaskOptions = {
  onStarted?: (subtask: SubtaskView) => PromiseLike<void> | void
}

let subtaskTablesGeneration = -1

function ensureSubtaskTables() {
  const generation = db.getDatabaseGeneration()
  if (subtaskTablesGeneration === generation && generation > 0) return

  if (!db.tableExists("subtasks")) {
    db.createTableByZodObject("subtasks", SubtaskRecord)
  } else {
    db.syncTableColumnsWithZodObject("subtasks", SubtaskRecord)
  }

  db.db.run(`
    CREATE INDEX IF NOT EXISTS "idx_subtasks_parent_session"
    ON "subtasks" ("parentSessionID", "updatedAt");
  `)
  db.db.run(`
    CREATE INDEX IF NOT EXISTS "idx_subtasks_child_session"
    ON "subtasks" ("childSessionID");
  `)
  db.db.run(`
    CREATE INDEX IF NOT EXISTS "idx_subtasks_status"
    ON "subtasks" ("status", "updatedAt");
  `)

  subtaskTablesGeneration = db.getDatabaseGeneration()
}

function insertSubtask(record: SubtaskRecord) {
  ensureSubtaskTables()
  db.insertOneWithSchema("subtasks", record, SubtaskRecord)
}

function readStoredSubtask(id: string): SubtaskRecord | null {
  ensureSubtaskTables()
  return db.findById("subtasks", SubtaskRecord, id)
}

function updateStoredSubtask(
  id: string,
  updater: (record: SubtaskRecord) => SubtaskRecord,
): SubtaskRecord | null {
  ensureSubtaskTables()
  const current = readStoredSubtask(id)
  if (!current) return null

  const next = SubtaskRecord.parse(updater(current))
  db.updateByIdWithSchema("subtasks", id, next, SubtaskRecord)
  return next
}

function toView(record: SubtaskRecord): SubtaskView {
  return {
    ...record,
    active: RunningState.isRunning(record.childSessionID),
  }
}

function normalizeSummary(text: string | undefined) {
  const trimmed = text?.trim()
  if (!trimmed) return undefined
  if (trimmed.length <= MAX_STORED_SUMMARY_CHARS) return trimmed
  return `${trimmed.slice(0, MAX_STORED_SUMMARY_CHARS)}\n\n[truncated]`
}

function buildSubagentSystemPrompt(extra?: string) {
  const base = [
    "You are a delegated subagent operating inside the same project as a parent agent.",
    "Focus only on the delegated task and avoid unrelated work.",
    "If you are blocked, explain the blocker clearly.",
    "When finished, respond with a concise summary of what you found or changed.",
  ].join("\n")

  const suffix = extra?.trim()
  return suffix ? `${base}\n\n${suffix}` : base
}

function buildParentNotificationSystemPrompt() {
  return [
    "This is an automated notification from a background subagent in the same session.",
    "Treat it as internal delegated-task output, not as a new human request.",
    "Use it to continue the current task only when it is relevant.",
  ].join("\n")
}

function isAskUserQuestionPart(
  part: Message.Part,
): part is Message.ToolPart {
  if (
    part.type !== "tool" ||
    part.state.phase !== "settled" ||
    part.state.control.mode !== "wait-user"
  ) {
    return false
  }
  const metadata = Message.toolPartMetadata(part)

  return Boolean(
    metadata &&
      metadata.kind === "ask-user-question" &&
      metadata.answered !== true,
  )
}

function hasWaitingApproval(parts: Message.Part[]) {
  return parts.some(
    (part): part is Message.ToolPart =>
      part.type === "tool" && part.state.phase === "waiting-approval",
  )
}

function isBlockingAssistantInteraction(message: Message.WithParts) {
  if (message.info.role !== "assistant") return false

  const hasOpenTool = message.parts.some(
    (part): part is Message.ToolPart =>
      part.type === "tool" &&
      (
        part.state.phase === "pending" ||
        part.state.phase === "running" ||
        part.state.phase === "waiting-approval"
      ),
  )
  if (hasOpenTool) return true

  return message.parts.some(isAskUserQuestionPart)
}

function extractAssistantText(parts: Message.Part[]) {
  const text = parts
    .filter((part): part is Message.TextPart => part.type === "text" && part.ignored !== true)
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join("\n\n")

  return normalizeSummary(text)
}

function inferSubtaskStatus(result: Message.WithParts | undefined): {
  status: SubtaskStatus
  finishReason?: string
  summary?: string
  latestAssistantMessageID?: string
} {
  if (!result || result.info.role !== "assistant") {
    return {
      status: "failed",
      summary: "Subagent did not produce an assistant response.",
    }
  }

  const summary = extractAssistantText(result.parts)
  if (hasWaitingApproval(result.parts)) {
    return {
      status: "blocked",
      finishReason: result.info.finishReason,
      summary: summary ?? "Subagent is blocked waiting for tool approval.",
      latestAssistantMessageID: result.info.id,
    }
  }

  if (result.parts.some(isAskUserQuestionPart)) {
    return {
      status: "blocked",
      finishReason: result.info.finishReason,
      summary: summary ?? "Subagent is blocked waiting for user input.",
      latestAssistantMessageID: result.info.id,
    }
  }

  if (result.info.error) {
    return {
      status: "failed",
      finishReason: result.info.finishReason,
      summary,
      latestAssistantMessageID: result.info.id,
    }
  }

  if (result.info.finishReason && !["tool-calls", "unknown"].includes(result.info.finishReason)) {
    return {
      status: "completed",
      finishReason: result.info.finishReason,
      summary: summary ?? "Subagent completed without a text response.",
      latestAssistantMessageID: result.info.id,
    }
  }

  return {
    status: "stopped",
    finishReason: result.info.finishReason,
    summary: summary ?? "Subagent stopped before reaching a final response.",
    latestAssistantMessageID: result.info.id,
  }
}

function latestAssistantWithParts(sessionID: string): Message.WithParts | undefined {
  const messages = db.findManyWithSchema("messages", Message.MessageInfo, {
    where: [{ column: "sessionID", value: sessionID }],
    orderBy: [
      { column: "created", direction: "ASC" },
      { column: "id", direction: "ASC" },
    ],
  })
  const parts = db.findManyWithSchema("parts", Message.Part, {
    where: [{ column: "sessionID", value: sessionID }],
    orderBy: [{ column: "id", direction: "ASC" }],
  })

  const partsByMessageID = new Map<string, Message.Part[]>()
  for (const part of parts) {
    const list = partsByMessageID.get(part.messageID) ?? []
    list.push(part)
    partsByMessageID.set(part.messageID, list)
  }

  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (!message || message.role !== "assistant") continue
    return {
      info: message,
      parts: partsByMessageID.get(message.id) ?? [],
    }
  }
}

function loadMessagesWithParts(sessionID: string): Message.WithParts[] {
  const messages = db.findManyWithSchema("messages", Message.MessageInfo, {
    where: [{ column: "sessionID", value: sessionID }],
    orderBy: [
      { column: "created", direction: "ASC" },
      { column: "id", direction: "ASC" },
    ],
  })
  const parts = db.findManyWithSchema("parts", Message.Part, {
    where: [{ column: "sessionID", value: sessionID }],
    orderBy: [{ column: "id", direction: "ASC" }],
  })

  const partsByMessageID = new Map<string, Message.Part[]>()
  for (const part of parts) {
    const list = partsByMessageID.get(part.messageID) ?? []
    list.push(part)
    partsByMessageID.set(part.messageID, list)
  }

  return messages.map((message) => ({
    info: message,
    parts: partsByMessageID.get(message.id) ?? [],
  }))
}

function latestUserMessage(sessionID: string): Message.User | undefined {
  const messages = db.findManyWithSchema("messages", Message.MessageInfo, {
    where: [{ column: "sessionID", value: sessionID }],
    orderBy: [
      { column: "created", direction: "ASC" },
      { column: "id", direction: "ASC" },
    ],
  })

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role === "user" && !message.internal) {
      return message
    }
  }
}

function isMessageID(value: string | undefined): value is string {
  return typeof value === "string" && value.startsWith("msg")
}

function resolveParentUserMessageID(
  sessionID: string,
  parentMessage: Message.MessageInfo | null,
) {
  if (!parentMessage) return undefined
  if (parentMessage.role === "user") return parentMessage.internal ? undefined : parentMessage.id
  if (parentMessage.role !== "assistant") return undefined
  if (isMessageID(parentMessage.parentID)) {
    return parentMessage.parentID
  }

  const messages = db.findManyWithSchema("messages", Message.MessageInfo, {
    where: [{ column: "sessionID", value: sessionID }],
    orderBy: [
      { column: "created", direction: "ASC" },
      { column: "id", direction: "ASC" },
    ],
  })
  const parentIndex = messages.findIndex((message) => message.id === parentMessage.id)
  if (parentIndex < 0) {
    return latestUserMessage(sessionID)?.id
  }

  for (let index = parentIndex - 1; index >= 0; index -= 1) {
    const candidate = messages[index]
    if (candidate?.role === "user" && !candidate.internal) {
      return candidate.id
    }
  }
}

function buildParentNotificationText(record: SubtaskRecord) {
  return [
    '<runtime_event type="subagent.completed">',
    `task_id: ${record.id}`,
    `agent_id: ${record.agent}`,
    `child_session_id: ${record.childSessionID}`,
    `status: ${record.status}`,
    record.finishReason ? `finish_reason: ${record.finishReason}` : undefined,
    record.error ? `error: ${record.error}` : undefined,
    "",
    "summary:",
    record.summary ?? "(no summary)",
    "</runtime_event>",
  ].filter(Boolean).join("\n")
}

async function maybeNotifyParentSession(record: SubtaskRecord) {
  if (!record.runInBackground || record.status === "cancelled") {
    return readStoredSubtask(record.id)
  }

  const current = readStoredSubtask(record.id)
  if (!current) return null
  if (current.parentNotification?.status === "sent" || current.parentNotification?.status === "skipped") {
    return current
  }

  await RunningState.waitForStop(record.parentSessionID)

  const parentSession = Session.DataBaseRead("sessions", record.parentSessionID) as Session.SessionInfo | null
  if (!parentSession) {
    return updateStoredSubtask(record.id, (value) => ({
      ...value,
      parentNotification: {
        status: "skipped",
        updatedAt: Date.now(),
        reason: "Parent session no longer exists.",
      },
    }))
  }

  const latestUser = latestUserMessage(record.parentSessionID)
  if (!latestUser) {
    return updateStoredSubtask(record.id, (value) => ({
      ...value,
      parentNotification: {
        status: "skipped",
        updatedAt: Date.now(),
        reason: "Parent session has no user message to continue from.",
      },
    }))
  }

  if (record.parentUserMessageID && latestUser.id !== record.parentUserMessageID) {
    return updateStoredSubtask(record.id, (value) => ({
      ...value,
      parentNotification: {
        status: "skipped",
        updatedAt: Date.now(),
        reason: "Parent session advanced to a newer user turn before the subagent completed.",
      },
    }))
  }

  const latestAssistant = [...loadMessagesWithParts(record.parentSessionID)]
    .reverse()
    .find((message) => message.info.role === "assistant")
  if (latestAssistant && isBlockingAssistantInteraction(latestAssistant)) {
    return updateStoredSubtask(record.id, (value) => ({
      ...value,
      parentNotification: {
        status: "skipped",
        updatedAt: Date.now(),
        reason: "Parent session is blocked on approval or a user question.",
      },
    }))
  }

  const Prompt = await import("#session/core/prompt.ts")
  try {
    await Instance.provide({
      directory: parentSession.directory,
      fn: () => Prompt.prompt({
        sessionID: record.parentSessionID,
        agent: latestUser.agent,
        model: latestUser.model,
        skills: latestUser.skills,
        internal: true,
        system: buildParentNotificationSystemPrompt(),
        parts: [
          {
            type: "text",
            text: buildParentNotificationText(record),
            synthetic: true,
            metadata: {
              kind: "runtime-event",
              runtimeEventType: "subagent.completed",
              taskID: record.id,
              childSessionID: record.childSessionID,
              status: record.status,
              agent: record.agent,
            },
          },
        ],
      }),
    })

    return updateStoredSubtask(record.id, (value) => ({
      ...value,
      parentNotification: {
        status: "sent",
        updatedAt: Date.now(),
      },
    }))
  } catch (error) {
    const message =
      error instanceof Error && error.message
        ? error.message
        : String(error)

    log.warn("failed to notify parent session about subtask completion", {
      id: record.id,
      parentSessionID: record.parentSessionID,
      error: message,
    })

    return updateStoredSubtask(record.id, (value) => ({
      ...value,
      parentNotification: {
        status: "skipped",
        updatedAt: Date.now(),
        reason: message,
      },
    }))
  }
}

async function runSubtaskLifecycle(input: {
  id: string
  directory: string
  promptInput: {
    sessionID: string
    agent: string
    model: ModelRef
    system?: string
    skills?: string[]
    parts: Array<{ type: "text"; text: string }>
  }
}) {
  let finalized: SubtaskRecord | null = null
  try {
    const Prompt = await import("#session/core/prompt.ts")
    const latest = await Instance.provide({
      directory: input.directory,
      fn: () => Prompt.prompt(input.promptInput),
    })
    const inferred = inferSubtaskStatus(latest)
    const now = Date.now()
    const next = updateStoredSubtask(input.id, (record) => {
      if (record.status === "cancelled") {
        return {
          ...record,
          updatedAt: now,
          finishedAt: record.finishedAt ?? now,
        }
      }

      return {
        ...record,
        status: inferred.status,
        summary: inferred.summary,
        finishReason: inferred.finishReason,
        latestAssistantMessageID: inferred.latestAssistantMessageID,
        error: undefined,
        updatedAt: now,
        finishedAt: now,
      }
    })

    finalized = next
  } catch (error) {
    const current = readStoredSubtask(input.id)
    if (!current) return null

    if (current.status === "cancelled") {
      const now = Date.now()
      const cancelled = updateStoredSubtask(input.id, (record) => ({
        ...record,
        updatedAt: now,
        finishedAt: record.finishedAt ?? now,
      }))
      finalized = cancelled
    } else {
      const latest = latestAssistantWithParts(current.childSessionID)
      const summary = latest ? inferSubtaskStatus(latest).summary : undefined
      const now = Date.now()
      const message =
        error instanceof Error && error.message
          ? error.message
          : String(error)

      log.error("subtask failed", {
        id: input.id,
        childSessionID: current.childSessionID,
        error: message,
      })

      const failed = updateStoredSubtask(input.id, (record) => ({
        ...record,
        status: "failed",
        summary,
        error: message,
        latestAssistantMessageID: latest?.info.role === "assistant" ? latest.info.id : undefined,
        updatedAt: now,
        finishedAt: now,
      }))

      finalized = failed
    }
  }

  if (finalized?.runInBackground) {
    finalized = await maybeNotifyParentSession(finalized)
  }

  return finalized ? toView(finalized) : null
}

export async function startSubtask(
  input: StartSubtaskInput,
  options: StartSubtaskOptions = {},
): Promise<SubtaskView> {
  const parentSession = Session.DataBaseRead("sessions", input.parentSessionID) as Session.SessionInfo | null
  if (!parentSession) {
    throw new Error(`Parent session '${input.parentSessionID}' was not found.`)
  }

  const agent = await Agent.get(input.agent)
  if (!agent) {
    throw new Error(`Agent '${input.agent}' was not found.`)
  }

  const model =
    input.model ??
    await Provider.getDefaultModelRef(parentSession.projectID)
  const parentMessage = Session.DataBaseRead("messages", input.parentMessageID) as Message.MessageInfo | null

  const title = input.title?.trim() || `Subagent: ${input.agent}`
  const childSession = await Session.createSession({
    directory: parentSession.directory,
    projectID: parentSession.projectID,
    title,
  })

  const now = Date.now()
  const record = SubtaskRecord.parse({
    id: Identifier.ascending("task"),
    parentSessionID: input.parentSessionID,
    parentMessageID: input.parentMessageID,
    parentUserMessageID: resolveParentUserMessageID(input.parentSessionID, parentMessage),
    parentToolCallID: input.parentToolCallID,
    childSessionID: childSession.id,
    title,
    prompt: input.prompt,
    agent: agent.name,
    model,
    runInBackground: input.runInBackground ?? false,
    system: input.system,
    skills: input.skills,
    status: "running",
    parentNotification:
      input.runInBackground
        ? {
            status: "pending",
            updatedAt: now,
          }
        : undefined,
    startedAt: now,
    updatedAt: now,
  })
  insertSubtask(record)
  const started = toView(record)
  if (options.onStarted) {
    try {
      await options.onStarted(started)
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : String(error)
      log.warn("subtask started hook failed", {
        id: record.id,
        childSessionID: record.childSessionID,
        error: message,
      })
    }
  }

  const promptInput = {
    sessionID: childSession.id,
    agent: agent.name,
    model,
    system: buildSubagentSystemPrompt(input.system),
    skills: input.skills,
    parts: [
      {
        type: "text" as const,
        text: input.prompt,
      },
    ],
  }

  if (record.runInBackground) {
    void runSubtaskLifecycle({
      id: record.id,
      directory: parentSession.directory,
      promptInput,
    })
    return started
  }

  const completed = await runSubtaskLifecycle({
    id: record.id,
    directory: parentSession.directory,
    promptInput,
  })

  return completed ?? started
}

export function readSubtask(id: string): SubtaskView | null {
  const record = readStoredSubtask(id)
  if (!record) return null
  return toView(record)
}

export function getSubtaskSessionOrigin(childSessionID: string): SubtaskSessionOrigin | undefined {
  ensureSubtaskTables()

  const [record] = db.findManyWithSchema("subtasks", SubtaskRecord, {
    where: [{ column: "childSessionID", value: childSessionID }],
    orderBy: [
      { column: "updatedAt", direction: "DESC" },
      { column: "id", direction: "DESC" },
    ],
  })
  if (!record) return undefined

  return {
    active: RunningState.isRunning(record.childSessionID),
    agent: record.agent,
    parentMessageID: record.parentMessageID,
    parentSessionID: record.parentSessionID,
    parentToolCallID: record.parentToolCallID,
    status: record.status,
    taskID: record.id,
    updatedAt: record.updatedAt,
  }
}

export function listSubtasksByParentSession(parentSessionID: string): SubtaskView[] {
  ensureSubtaskTables()
  return db.findManyWithSchema("subtasks", SubtaskRecord, {
    where: [{ column: "parentSessionID", value: parentSessionID }],
    orderBy: [
      { column: "updatedAt", direction: "DESC" },
      { column: "id", direction: "DESC" },
    ],
  }).map(toView)
}

export async function cancelSubtask(id: string): Promise<SubtaskView> {
  return cancelSubtaskWithOptions(id)
}

async function cancelSubtaskWithOptions(
  id: string,
  options: { cancelQueued?: boolean } = {},
): Promise<SubtaskView> {
  const current = readStoredSubtask(id)
  if (!current) {
    throw new Error(`Subtask '${id}' was not found.`)
  }

  if (current.status !== "running") {
    return toView(current)
  }

  const Prompt = await import("#session/core/prompt.ts")
  const cancelled = Prompt.cancelSession(current.childSessionID, {
    cancelQueued: options.cancelQueued,
  }).cancelled
  const now = Date.now()
  const next = updateStoredSubtask(id, (record) => ({
    ...record,
    status: "cancelled",
    error: cancelled ? undefined : "Cancellation requested after the subagent was no longer active.",
    updatedAt: now,
    finishedAt: now,
  }))

  if (!next) {
    throw new Error(`Subtask '${id}' was not found.`)
  }

  return toView(next)
}

export async function cancelRunningSubtasksByParentSession(
  parentSessionID: string,
  options: {
    cancelQueued?: boolean
    seenParentSessionIDs?: Set<string>
  } = {},
): Promise<CancelSubtasksResult> {
  const seenParentSessionIDs = options.seenParentSessionIDs ?? new Set<string>()
  if (seenParentSessionIDs.has(parentSessionID)) {
    return {
      cancelled: false,
      cancelledCount: 0,
      cancelledTaskIDs: [],
      cancelledSessionIDs: [],
    }
  }
  seenParentSessionIDs.add(parentSessionID)

  const runningSubtasks = listSubtasksByParentSession(parentSessionID)
    .filter((subtask) => subtask.status === "running")

  let cancelledCount = 0
  const cancelledTaskIDs: string[] = []
  const cancelledSessionIDs: string[] = []

  for (const subtask of runningSubtasks) {
    const cancelled = await cancelSubtaskWithOptions(subtask.id, {
      cancelQueued: options.cancelQueued,
    })
    if (cancelled.status === "cancelled") {
      cancelledCount += 1
      cancelledTaskIDs.push(cancelled.id)
      cancelledSessionIDs.push(cancelled.childSessionID)
    }

    const childResult = await cancelRunningSubtasksByParentSession(cancelled.childSessionID, {
      cancelQueued: options.cancelQueued,
      seenParentSessionIDs,
    })
    cancelledCount += childResult.cancelledCount
    cancelledTaskIDs.push(...childResult.cancelledTaskIDs)
    cancelledSessionIDs.push(...childResult.cancelledSessionIDs)
  }

  return {
    cancelled: cancelledCount > 0,
    cancelledCount,
    cancelledTaskIDs,
    cancelledSessionIDs,
  }
}
