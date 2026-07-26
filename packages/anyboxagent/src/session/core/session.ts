import * as Log from "#util/log.ts"
import z from "zod"
import * as Identifier from "#id/id.ts"
import * as Snapshot from "#snapshot/snapshot.ts"
import * as BusEvent from "#bus/bus-event.ts"
import * as Message from "#session/core/message.ts"
import * as Installation from "#installation/installation.ts"
import { fn } from "#util/fn.ts"
import * as db from "#database/Sqlite.ts"
import * as EventStore from "#session/runtime/event-store.ts"
import * as LiveStreamHub from "#session/runtime/live-stream-hub.ts"
import * as RuntimeEvent from "#session/runtime/runtime-event.ts"
import * as TaskSchema from "#session/tasks/task-schema.ts"
import * as ToolResultPersistence from "#session/support/tool-result-persistence.ts"
import * as TurnError from "#session/core/turn-error.ts"
import * as Worktree from "#project/worktree.ts"

interface TableRecordMap {
  projects: never
  sessions: SessionInfo
  turns: TurnInfo
  archived_sessions: ArchivedSessionRecord
  side_chat_links: SideChatLink
  messages: Message.MessageInfo
  parts: Message.Part
}

type TableName = keyof TableRecordMap

export const SessionKind = z.enum(["main", "side-chat"]).meta({
  ref: "SessionKind",
})
export type SessionKind = z.output<typeof SessionKind>

export const SessionToolPolicy = z.enum(["default", "read-only"]).meta({
  ref: "SessionToolPolicy",
})
export type SessionToolPolicy = z.output<typeof SessionToolPolicy>

export const SessionPolicy = z
  .object({
    toolPolicy: SessionToolPolicy,
    ignoreFullAccess: z.boolean().optional(),
  })
  .meta({
    ref: "SessionPolicy",
  })
export type SessionPolicy = z.output<typeof SessionPolicy>

export const SessionAutomationMetadata = z
  .object({
    automationID: Identifier.schema("automation"),
    runID: Identifier.schema("automationRun"),
    name: z.string(),
    trigger: z.enum(["manual", "schedule"]),
  })
  .meta({
    ref: "SessionAutomationMetadata",
  })
export type SessionAutomationMetadata = z.output<typeof SessionAutomationMetadata>

export const SessionModelSelection = z
  .object({
    model: z.string().optional(),
    small_model: z.string().optional(),
    reasoning_effort: Message.ReasoningEffort.optional(),
  })
  .meta({
    ref: "SessionModelSelection",
  })
export type SessionModelSelection = z.output<typeof SessionModelSelection>

export type SessionModelSelectionInput = {
  model?: string | null
  small_model?: string | null
  reasoning_effort?: Message.ReasoningEffort | null
}

export const TurnStatus = z.enum(["running", "completed", "blocked", "failed", "cancelled", "continued_by_user"]).meta({
  ref: "TurnStatus",
})
export type TurnStatus = z.output<typeof TurnStatus>

export const TurnModelReference = z
  .object({
    providerID: z.string(),
    modelID: z.string(),
  })
  .meta({
    ref: "TurnModelReference",
  })
export type TurnModelReference = z.output<typeof TurnModelReference>

export const TurnInfo = z
  .object({
    id: Identifier.schema("turn"),
    sessionID: Identifier.schema("session"),
    projectID: z.string(),
    userMessageID: Identifier.schema("message").optional(),
    resume: z.boolean().optional(),
    agent: z.string().optional(),
    model: TurnModelReference.optional(),
    status: TurnStatus,
    phase: z.string().optional(),
    lastMessageID: Identifier.schema("message").optional(),
    finishReason: z.string().optional(),
    error: z.string().optional(),
    errorInfo: TurnError.TurnErrorInfo.optional(),
    createdAt: z.number(),
    updatedAt: z.number(),
    completedAt: z.number().optional(),
  })
  .meta({
    ref: "Turn",
  })
export type TurnInfo = z.output<typeof TurnInfo>

export type CreateTurnInput = {
  id?: string
  sessionID: string
  projectID: string
  userMessageID?: string
  resume?: boolean
  agent?: string
  model?: TurnModelReference
  phase?: string
}

export type UpdateTurnInput = Partial<
  Pick<TurnInfo, "status" | "phase" | "lastMessageID" | "finishReason" | "error" | "errorInfo" | "completedAt">
>

export const SessionInfo = z
  .object({
    id: Identifier.schema("session"),
    slug: z.string().optional(),
    projectID: z.string(),
    directory: z.string(),
    worktreeID: Identifier.schema("worktree").optional(),
    summary: z
      .object({
        additions: z.number(),
        deletions: z.number(),
        files: z.number(),
      })
      .optional(),
    share: z
      .object({
        url: z.string(),
      })
      .optional(),
    title: z.string(),
    pinned: z.boolean().optional(),
    activeMessageID: z.string().nullable().optional(),
    version: z.string(),
    workflow: z
      .object({
        mode: z.enum(["execution", "planning"]),
        plan: z.object({
          status: z.enum(["idle", "draft", "pending-approval", "approved"]),
          draftMarkdown: z.string().optional(),
          pendingRequestID: Identifier.schema("permission").optional(),
          approvedMarkdown: z.string().optional(),
          pendingInstruction: z.enum(["plan-mode", "exit-plan", "execute-approved-plan"]).optional(),
          updatedAt: z.number(),
          approvedAt: z.number().optional(),
        }),
      })
      .optional(),
    modelSelection: SessionModelSelection.optional(),
    kind: SessionKind.optional(),
    policy: SessionPolicy.optional(),
    automation: SessionAutomationMetadata.optional(),
    time: z.object({
      created: z.number(),
      updated: z.number(),
      compacting: z.number().optional(),
      archived: z.number().optional(),
    }),
    revert: z
      .object({
        messageID: z.string(),
        partID: z.string().optional(),
        snapshot: z.string().optional(),
        diff: z.string().optional(),
      })
      .optional(),
  })
  .meta({
    ref: "Session",
  })
export type SessionInfo = z.output<typeof SessionInfo>

export type SessionWorkflowState = NonNullable<SessionInfo["workflow"]>

export function defaultWorkflowState(now = Date.now()): SessionWorkflowState {
  return {
    mode: "execution",
    plan: {
      status: "idle",
      updatedAt: now,
    },
  }
}

export function normalizeWorkflowState(
  workflow: SessionInfo["workflow"] | undefined,
  now = Date.now(),
): SessionWorkflowState {
  return {
    mode: workflow?.mode === "planning" ? "planning" : "execution",
    plan: {
      status: workflow?.plan.status ?? "idle",
      draftMarkdown: workflow?.plan.draftMarkdown,
      pendingRequestID: workflow?.plan.pendingRequestID,
      approvedMarkdown: workflow?.plan.approvedMarkdown,
      pendingInstruction: workflow?.plan.pendingInstruction,
      updatedAt: workflow?.plan.updatedAt ?? now,
      approvedAt: workflow?.plan.approvedAt,
    },
  }
}

const ArchivedRuntimeEvent = z.union([
  RuntimeEvent.RuntimeEvent,
  z
    .object({
      eventID: z.string().optional(),
      sessionID: z.string().optional(),
      turnID: z.string().optional(),
      seq: z.number().optional(),
      timestamp: z.number().optional(),
      type: z.string().optional(),
      payload: z.unknown().optional(),
    })
    .passthrough(),
])

export const ArchivedSessionSnapshot = z
  .object({
    session: SessionInfo,
    turns: z.array(TurnInfo).optional(),
    messages: z.array(Message.MessageInfo),
    parts: z.array(Message.Part),
    events: z.array(ArchivedRuntimeEvent).optional(),
    tasks: z.array(TaskSchema.SessionTaskRecord).optional(),
  })
  .meta({
    ref: "ArchivedSessionSnapshot",
  })
export type ArchivedSessionSnapshot = z.output<typeof ArchivedSessionSnapshot>

export const ArchivedSessionRecord = z
  .object({
    sessionID: Identifier.schema("session"),
    projectID: z.string(),
    directory: z.string(),
    title: z.string(),
    createdAt: z.number(),
    updatedAt: z.number(),
    archivedAt: z.number(),
    schemaVersion: z.string(),
    messageCount: z.number().int().nonnegative(),
    eventCount: z.number().int().nonnegative(),
    snapshot: ArchivedSessionSnapshot,
  })
  .meta({
    ref: "ArchivedSessionRecord",
  })
export type ArchivedSessionRecord = z.output<typeof ArchivedSessionRecord>

export const ArchivedSessionSummaryRecord = ArchivedSessionRecord.omit({
  snapshot: true,
}).meta({
  ref: "ArchivedSessionSummaryRecord",
})
export type ArchivedSessionSummaryRecord = z.output<typeof ArchivedSessionSummaryRecord>

export const SideChatSource = z
  .object({
    kind: z.enum(["url", "document"]),
    title: z.string(),
    url: z.string().optional(),
  })
  .meta({
    ref: "SideChatSource",
  })
export type SideChatSource = z.output<typeof SideChatSource>

export const SideChatToolSummary = z
  .object({
    tool: z.string(),
    status: z.enum(["completed", "error", "denied"]),
    summary: z.string(),
  })
  .meta({
    ref: "SideChatToolSummary",
  })
export type SideChatToolSummary = z.output<typeof SideChatToolSummary>

export const SideChatSnapshot = z
  .object({
    userText: z.string().optional(),
    assistantText: z.string(),
    sources: z.array(SideChatSource).optional(),
    toolSummaries: z.array(SideChatToolSummary).optional(),
    filePaths: z.array(z.string()).optional(),
  })
  .meta({
    ref: "SideChatSnapshot",
  })
export type SideChatSnapshot = z.output<typeof SideChatSnapshot>

export const SideChatLink = z
  .object({
    sessionID: Identifier.schema("session"),
    parentSessionID: Identifier.schema("session"),
    anchorMessageID: Identifier.schema("message"),
    anchorUserMessageID: Identifier.schema("message").optional(),
    createdAt: z.number(),
    anchorPreview: z.string(),
    snapshotVersion: z.literal(1),
    snapshot: SideChatSnapshot,
  })
  .meta({
    ref: "SideChatLink",
  })
export type SideChatLink = z.output<typeof SideChatLink>

export type SessionOrigin = Pick<SideChatLink, "parentSessionID" | "anchorMessageID" | "anchorPreview">

export type SideChatContext = {
  session: SessionInfo
  link: SideChatLink
  messages: Message.WithParts[]
}

const TableSchemaMap = {
  sessions: SessionInfo,
  turns: TurnInfo,
  archived_sessions: ArchivedSessionRecord,
  side_chat_links: SideChatLink,
  messages: Message.MessageInfo,
  parts: Message.Part,
} as const

const log = Log.create({ service: "session" })
let sessionTablesGeneration = -1
const DEFAULT_SESSION_TITLE = "New chat"
const DEFAULT_SIDE_CHAT_TITLE = "Side chat"
const DEFAULT_SESSION_KIND: SessionKind = "main"
const DEFAULT_SESSION_POLICY: SessionPolicy = {
  toolPolicy: "default",
}
const SIDE_CHAT_POLICY: SessionPolicy = {
  toolPolicy: "read-only",
  ignoreFullAccess: true,
}
const SIDE_CHAT_PREVIEW_LENGTH = 160

function normalizeSessionPolicy(policy: SessionInfo["policy"] | undefined): SessionPolicy {
  return {
    toolPolicy: policy?.toolPolicy ?? DEFAULT_SESSION_POLICY.toolPolicy,
    ignoreFullAccess: policy?.ignoreFullAccess,
  }
}

function normalizeSessionModelSelection(
  selection: SessionInfo["modelSelection"] | undefined,
): SessionInfo["modelSelection"] | undefined {
  const model = selection?.model?.trim()
  const smallModel = selection?.small_model?.trim()
  const reasoningEffort = selection?.reasoning_effort
  if (!model && !smallModel && !reasoningEffort) return undefined

  return {
    ...(model ? { model } : {}),
    ...(smallModel ? { small_model: smallModel } : {}),
    ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
  }
}

export function normalizeSessionInfo(session: SessionInfo): SessionInfo {
  return {
    ...session,
    kind: session.kind ?? DEFAULT_SESSION_KIND,
    modelSelection: normalizeSessionModelSelection(session.modelSelection),
    policy: normalizeSessionPolicy(session.policy),
    workflow: session.workflow ? normalizeWorkflowState(session.workflow, session.time.updated) : session.workflow,
  }
}

export function isSideChatSession(session: SessionInfo | null | undefined) {
  return (session?.kind ?? DEFAULT_SESSION_KIND) === "side-chat"
}

function ensureSessionTables() {
  const generation = db.getDatabaseGeneration()
  if (sessionTablesGeneration === generation && generation > 0) return

  if (!db.tableExists("sessions")) {
    db.createTableByZodObject("sessions", SessionInfo)
  } else {
    db.syncTableColumnsWithZodObject("sessions", SessionInfo)
  }

  if (!db.tableExists("turns")) {
    db.createTableByZodObject("turns", TurnInfo)
  } else {
    db.syncTableColumnsWithZodObject("turns", TurnInfo)
  }

  if (!db.tableExists("archived_sessions")) {
    db.createTableByZodObject("archived_sessions", ArchivedSessionRecord)
  } else {
    db.syncTableColumnsWithZodObject("archived_sessions", ArchivedSessionRecord)
  }

  if (!db.tableExists("side_chat_links")) {
    db.createTableByZodObject("side_chat_links", SideChatLink)
  } else {
    db.syncTableColumnsWithZodObject("side_chat_links", SideChatLink)
  }

  if (!db.tableExists("messages")) {
    db.createTableByZodDiscriminatedUnion("messages", Message.MessageInfo)
  } else {
    db.syncTableColumnsWithZodDiscriminatedUnion("messages", Message.MessageInfo)
  }

  if (!db.tableExists("parts")) {
    db.createTableByZodDiscriminatedUnion("parts", Message.Part)
  } else {
    db.syncTableColumnsWithZodDiscriminatedUnion("parts", Message.Part)
  }

  db.db.run(`
    CREATE INDEX IF NOT EXISTS "idx_turns_session_created"
    ON "turns" ("sessionID", "createdAt", "id");
  `)
  db.db.run(`
    CREATE INDEX IF NOT EXISTS "idx_turns_session_user_message"
    ON "turns" ("sessionID", "userMessageID", "createdAt");
  `)
  db.db.run(`
    CREATE INDEX IF NOT EXISTS "idx_archived_sessions_project_archived"
    ON "archived_sessions" ("projectID", "archivedAt");
  `)
  db.db.run(`
    CREATE INDEX IF NOT EXISTS "idx_archived_sessions_archived"
    ON "archived_sessions" ("archivedAt");
  `)
  db.db.run(`
    CREATE UNIQUE INDEX IF NOT EXISTS "idx_side_chat_links_session"
    ON "side_chat_links" ("sessionID");
  `)
  db.db.run(`
    CREATE INDEX IF NOT EXISTS "idx_side_chat_links_parent_anchor"
    ON "side_chat_links" ("parentSessionID", "anchorMessageID", "createdAt");
  `)
  db.db.run(`
    CREATE INDEX IF NOT EXISTS "idx_messages_session_parent_created"
    ON "messages" ("sessionID", "parentMessageID", "created", "id");
  `)
  db.db.run(`
    CREATE INDEX IF NOT EXISTS "idx_messages_session_created"
    ON "messages" ("sessionID", "created", "id");
  `)

  backfillLegacySessionTrees()

  sessionTablesGeneration = db.getDatabaseGeneration()
}

function backfillLegacySessionTrees(sessionIDs?: string[]) {
  const targetSessionIDs = sessionIDs ? new Set(sessionIDs) : undefined
  const sessions = db.findManyWithSchema("sessions", SessionInfo)

  for (const session of sessions) {
    if (targetSessionIDs && !targetSessionIDs.has(session.id)) continue
    if (session.activeMessageID) continue

    const messages = db.findManyWithSchema("messages", Message.MessageInfo, {
      where: [{ column: "sessionID", value: session.id }],
      orderBy: [
        { column: "created", direction: "ASC" },
        { column: "id", direction: "ASC" },
      ],
    })
    if (messages.length === 0) continue
    if (messages.some((message) => Boolean(message.parentMessageID))) continue

    let previousMessageID: string | null = null
    const updates = messages.map((message) => {
      const parentMessageID = previousMessageID
      previousMessageID = message.id
      if (message.role === "assistant") {
        return {
          ...message,
          parentMessageID,
          parentID: message.parentID || parentMessageID || "",
        } satisfies Message.MessageInfo
      }
      return {
        ...message,
        parentMessageID,
      } satisfies Message.MessageInfo
    })
    const activeMessageID = updates[updates.length - 1]!.id

    const commitBackfill = db.db.transaction((nextMessages: Message.MessageInfo[], nextActiveMessageID: string) => {
      for (const message of nextMessages) {
        db.updateByIdWithSchema("messages", message.id, message, Message.MessageInfo)
      }
      db.updateByIdWithSchema(
        "sessions",
        session.id,
        normalizeSessionInfo({
          ...session,
          activeMessageID: nextActiveMessageID,
        }),
        SessionInfo,
      )
    })

    commitBackfill(updates, activeMessageID)
  }
}

function DataBaseCreate<T extends Exclude<TableName, "projects">>(tableName: T, tableRecord: TableRecordMap[T]): void {
  ensureSessionTables()
  if (tableName === "sessions") {
    db.insertOneWithSchema(tableName, normalizeSessionInfo(tableRecord as SessionInfo), TableSchemaMap[tableName])
    return
  }

  db.insertOneWithSchema(tableName, tableRecord, TableSchemaMap[tableName])
}

function updateSessionRecord(session: SessionInfo) {
  ensureSessionTables()
  db.updateByIdWithSchema("sessions", session.id, normalizeSessionInfo(session), SessionInfo)
}

function DataBaseRead<T extends Exclude<TableName, "projects">>(
  tableName: T,
  id: string,
  idColumn: string = "id",
): TableRecordMap[T] | null {
  ensureSessionTables()
  const result = db.findById(tableName, TableSchemaMap[tableName], id, idColumn)
  if (!result) return null
  const parsed = TableSchemaMap[tableName].parse(result)
  if (tableName === "sessions") {
    return normalizeSessionInfo(parsed as SessionInfo) as TableRecordMap[T]
  }

  return parsed as TableRecordMap[T]
}

function upsertMessage(message: Message.MessageInfo) {
  ensureSessionTables()
  const existing = db.findById("messages", Message.MessageInfo, message.id)
  if (existing) {
    db.updateByIdWithSchema("messages", message.id, message, Message.MessageInfo)
    return
  }

  db.insertOneWithSchema("messages", message, Message.MessageInfo)
}

function getActiveMessageID(sessionID: string): string | null {
  const existing = DataBaseRead("sessions", sessionID) as SessionInfo | null
  return existing?.activeMessageID ?? null
}

function updateActiveMessageID(
  sessionID: string,
  activeMessageID: string | null,
  options?: {
    touch?: boolean
  },
): SessionInfo | null {
  const existing = DataBaseRead("sessions", sessionID) as SessionInfo | null
  if (!existing) return null

  const next: SessionInfo = {
    ...existing,
    activeMessageID,
    time: options?.touch
      ? {
          ...existing.time,
          updated: Date.now(),
        }
      : existing.time,
  }

  updateSessionRecord(next)
  return next
}

function recordMessage(message: Message.MessageInfo) {
  ensureSessionTables()
  const existing = db.findById("messages", Message.MessageInfo, message.id)
  const currentActiveMessageID = getActiveMessageID(message.sessionID)
  upsertMessage(message)
  if (!existing || !currentActiveMessageID || currentActiveMessageID === message.id) {
    updateActiveMessageID(message.sessionID, message.id)
  }
}

function upsertPart(part: Message.Part) {
  ensureSessionTables()
  const existing = db.findById("parts", Message.Part, part.id)
  if (existing) {
    db.updateByIdWithSchema("parts", part.id, part, Message.Part)
    return
  }

  db.insertOneWithSchema("parts", part, Message.Part)
}

function deletePart(partID: string) {
  ensureSessionTables()
  return db.deleteById("parts", partID)
}

function deleteMessage(sessionID: string, messageID: string) {
  ensureSessionTables()
  db.deleteMany("parts", [{ column: "messageID", value: messageID }])
  const deleted = db.deleteById("messages", messageID)
  if (getActiveMessageID(sessionID) === messageID) {
    const nextActiveMessageID = loadSessionMessages(sessionID).at(-1)?.id ?? null
    updateActiveMessageID(sessionID, nextActiveMessageID)
  }
  return deleted
}

function loadSessionMessages(sessionID: string) {
  ensureSessionTables()
  return db.findManyWithSchema("messages", Message.MessageInfo, {
    where: [{ column: "sessionID", value: sessionID }],
    orderBy: [
      { column: "created", direction: "ASC" },
      { column: "id", direction: "ASC" },
    ],
  })
}

function loadSessionParts(sessionID: string) {
  ensureSessionTables()
  return db.findManyWithSchema("parts", Message.Part, {
    where: [{ column: "sessionID", value: sessionID }],
    orderBy: [{ column: "id", direction: "ASC" }],
  })
}

function loadSessionTurns(sessionID: string) {
  ensureSessionTables()
  return db.findManyWithSchema("turns", TurnInfo, {
    where: [{ column: "sessionID", value: sessionID }],
    orderBy: [
      { column: "createdAt", direction: "ASC" },
      { column: "id", direction: "ASC" },
    ],
  })
}

function loadMessagesWithParts(sessionID: string): Message.WithParts[] {
  const messages = loadSessionMessages(sessionID)
  const parts = loadSessionParts(sessionID)
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

function loadSideChatLinks(input: {
  parentSessionID?: string
  anchorMessageID?: string
  sessionID?: string
}) {
  ensureSessionTables()
  const where: Array<{ column: string; value: string }> = []
  if (input.parentSessionID) {
    where.push({ column: "parentSessionID", value: input.parentSessionID })
  }
  if (input.anchorMessageID) {
    where.push({ column: "anchorMessageID", value: input.anchorMessageID })
  }
  if (input.sessionID) {
    where.push({ column: "sessionID", value: input.sessionID })
  }

  return db.findManyWithSchema("side_chat_links", SideChatLink, {
    where,
    orderBy: [{ column: "createdAt", direction: "DESC" }],
  })
}

function loadSessionTasks(sessionID: string) {
  ensureSessionTables()
  if (!db.tableExists("session_tasks")) return []
  return db.findManyWithSchema("session_tasks", TaskSchema.SessionTaskRecord, {
    where: [{ column: "sessionID", value: sessionID }],
    orderBy: [
      { column: "createdAt", direction: "ASC" },
      { column: "id", direction: "ASC" },
    ],
  })
}

function ensureSessionTaskTableForRestore() {
  if (!db.tableExists("session_tasks")) {
    db.createTableByZodObject("session_tasks", TaskSchema.SessionTaskRecord)
  } else {
    db.syncTableColumnsWithZodObject("session_tasks", TaskSchema.SessionTaskRecord)
  }

  db.db.run(`
    CREATE UNIQUE INDEX IF NOT EXISTS "idx_session_tasks_session_id"
    ON "session_tasks" ("sessionID", "id");
  `)
  db.db.run(`
    CREATE INDEX IF NOT EXISTS "idx_session_tasks_session_sort"
    ON "session_tasks" ("sessionID", "sortIndex", "createdAt");
  `)
}

function removeSessionTasks(sessionID: string) {
  if (!db.tableExists("session_tasks")) return 0
  if (!db.exists("session_tasks", [{ column: "sessionID", value: sessionID }])) return 0
  return db.deleteMany("session_tasks", [{ column: "sessionID", value: sessionID }])
}

function buildArchivedSessionRecord(session: SessionInfo): ArchivedSessionRecord {
  const normalizedSession = normalizeSessionInfo(session)
  const turns = loadSessionTurns(normalizedSession.id)
  const messages = loadSessionMessages(normalizedSession.id)
  const parts = loadSessionParts(session.id)
  const tasks = loadSessionTasks(normalizedSession.id)
  const archivedAt = Date.now()

  return {
    sessionID: normalizedSession.id,
    projectID: normalizedSession.projectID,
    directory: normalizedSession.directory,
    title: normalizedSession.title,
    createdAt: normalizedSession.time.created,
    updatedAt: normalizedSession.time.updated,
    archivedAt,
    schemaVersion: normalizedSession.version,
    messageCount: messages.length,
    eventCount: 0,
    snapshot: {
      session: normalizedSession,
      turns: turns.length > 0 ? turns : undefined,
      messages,
      parts,
      tasks: tasks.length > 0 ? tasks : undefined,
    },
  }
}

export const Event = {
  Created: BusEvent.define(
    "session.created",
    z.object({
      info: SessionInfo,
    }),
  ),
  Updated: BusEvent.define(
    "session.updated",
    z.object({
      info: SessionInfo,
    }),
  ),
  Deleted: BusEvent.define(
    "session.deleted",
    z.object({
      info: SessionInfo,
    }),
  ),
  Diff: BusEvent.define(
    "session.diff",
    z.object({
      sessionID: z.string(),
      diff: Snapshot.FileDiff.array(),
    }),
  ),
  Error: BusEvent.define(
    "session.error",
    z.object({
      sessionID: z.string().optional(),
      error: Message.Assistant.shape.error,
    }),
  ),
}

async function createSession(input: {
  directory: string
  projectID: string
  title?: string
  automation?: SessionAutomationMetadata
}): Promise<SessionInfo> {
  const now = Date.now()
  const worktree = Worktree.findForDirectory(input.projectID, input.directory)
  const result = normalizeSessionInfo({
    id: Identifier.descending("session"),
    projectID: input.projectID,
    directory: input.directory,
    worktreeID: worktree?.id,
    title: normalizeSessionTitle(input.title),
    version: Installation.VERSION,
    kind: "main",
    policy: DEFAULT_SESSION_POLICY,
    automation: input.automation,
    workflow: defaultWorkflowState(now),
    time: {
      created: now,
      updated: now,
    },
  })

  log.info("create", result)
  DataBaseCreate("sessions", result)
  return result
}

function createTurn(input: CreateTurnInput): TurnInfo {
  ensureSessionTables()
  const now = Date.now()
  const turn = TurnInfo.parse({
    id: Identifier.ascending("turn", input.id),
    sessionID: input.sessionID,
    projectID: input.projectID,
    userMessageID: input.userMessageID,
    resume: input.resume,
    agent: input.agent,
    model: input.model,
    status: "running",
    phase: input.phase ?? "preparing",
    lastMessageID: input.userMessageID,
    createdAt: now,
    updatedAt: now,
  })

  const existing = db.findById("turns", TurnInfo, turn.id)
  if (existing) {
    db.updateByIdWithSchema("turns", turn.id, turn, TurnInfo)
    return turn
  }

  db.insertOneWithSchema("turns", turn, TurnInfo)
  return turn
}

function updateTurn(turnID: string | undefined, input: UpdateTurnInput): TurnInfo | null {
  if (!turnID) return null
  ensureSessionTables()
  const existing = DataBaseRead("turns", turnID) as TurnInfo | null
  if (!existing) return null

  const now = Date.now()
  const nextStatus = input.status ?? existing.status
  const completedAt =
    input.completedAt ??
    existing.completedAt ??
    (nextStatus === "completed" ||
      nextStatus === "blocked" ||
      nextStatus === "failed" ||
      nextStatus === "cancelled" ||
      nextStatus === "continued_by_user"
      ? now
      : undefined)
  const next = TurnInfo.parse({
    ...existing,
    ...input,
    status: nextStatus,
    completedAt,
    updatedAt: now,
  })

  db.updateByIdWithSchema("turns", next.id, next, TurnInfo)
  return next
}

function listTurns(sessionID: string): TurnInfo[] {
  return loadSessionTurns(sessionID)
}

function listRunningTurns(): TurnInfo[] {
  ensureSessionTables()
  return db.findManyWithSchema("turns", TurnInfo, {
    where: [{ column: "status", value: "running" }],
    orderBy: [
      { column: "createdAt", direction: "ASC" },
      { column: "id", direction: "ASC" },
    ],
  })
}

function buildSideChatTitle(anchorPreview: string) {
  const preview = anchorPreview.trim()
  if (!preview) return DEFAULT_SIDE_CHAT_TITLE
  return `${DEFAULT_SIDE_CHAT_TITLE}: ${preview}`.slice(0, 120)
}

function compactWhitespace(text: string) {
  return text.replace(/\s+/g, " ").trim()
}

/*
function makeAnchorPreview(text: string) {
  const compact = compactWhitespace(text)
  if (!compact) return ""
  return compact.length > SIDE_CHAT_PREVIEW_LENGTH
    ? `${compact.slice(0, SIDE_CHAT_PREVIEW_LENGTH - 1).trimEnd()}…`
    : compact
}

*/

function makeAnchorPreview(text: string) {
  const compact = compactWhitespace(text)
  if (!compact) return ""
  if (compact.length <= SIDE_CHAT_PREVIEW_LENGTH) {
    return compact
  }

  return `${compact.slice(0, SIDE_CHAT_PREVIEW_LENGTH - 3).trimEnd()}...`
}

function renderToolSummary(part: Message.ToolPart): SideChatToolSummary | null {
  switch (part.state.status) {
    case "completed":
      return {
        tool: part.tool,
        status: "completed",
        summary: compactWhitespace(part.state.output).slice(0, 500),
      }
    case "error":
      return {
        tool: part.tool,
        status: "error",
        summary: compactWhitespace(part.state.error).slice(0, 500),
      }
    case "denied":
      return {
        tool: part.tool,
        status: "denied",
        summary: compactWhitespace(part.state.reason).slice(0, 500),
      }
    default:
      return null
  }
}

function snapshotFromAnchorMessage(input: {
  parentSessionID: string
  anchorMessageID: string
}): Omit<SideChatLink, "sessionID" | "createdAt"> {
  const messages = loadMessagesWithParts(input.parentSessionID)
  const anchorIndex = messages.findIndex(
    (message) => message.info.id === input.anchorMessageID && message.info.role === "assistant",
  )

  if (anchorIndex === -1) {
    throw new Error(
      `Assistant message '${input.anchorMessageID}' was not found in session '${input.parentSessionID}'.`,
    )
  }

  const anchorMessage = messages[anchorIndex]!
  const anchorUserMessage = [...messages.slice(0, anchorIndex)]
    .reverse()
    .find((message) => message.info.role === "user" && !message.info.internal)

  const assistantText = anchorMessage.parts
    .filter((part): part is Message.TextPart => part.type === "text")
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join("\n\n")

  const userText = anchorUserMessage
    ? anchorUserMessage.parts
        .filter((part): part is Message.TextPart => part.type === "text")
        .map((part) => part.text.trim())
        .filter(Boolean)
        .join("\n\n")
        .trim() || undefined
    : undefined

  const sources = anchorMessage.parts
    .flatMap((part): SideChatSource[] => {
      if (part.type === "source-url") {
        return [
          {
            kind: "url",
            title: part.title ?? part.url,
            url: part.url,
          },
        ]
      }

      if (part.type === "source-document") {
        return [
          {
            kind: "document",
            title: part.title,
          },
        ]
      }

      return []
    })

  const toolSummaries = anchorMessage.parts
    .flatMap((part) => (part.type === "tool" ? [renderToolSummary(part)] : []))
    .filter((item): item is SideChatToolSummary => Boolean(item))

  const filePaths = [...new Set(
    anchorMessage.parts.flatMap((part) => (part.type === "patch" ? part.files : [])),
  )]
  const normalizedAssistantText =
    assistantText.trim() ||
    [
      sources.map((source) => source.title).join(", "),
      toolSummaries.map((summary) => `${summary.tool}: ${summary.summary}`).join("\n"),
      filePaths.length > 0 ? `Files: ${filePaths.join(", ")}` : "",
    ]
      .filter(Boolean)
      .join("\n")
      .trim()

  if (!normalizedAssistantText) {
    throw new Error(`Assistant message '${input.anchorMessageID}' does not contain any anchorable content.`)
  }

  return {
    parentSessionID: input.parentSessionID,
    anchorMessageID: input.anchorMessageID,
    anchorUserMessageID: anchorUserMessage?.info.id,
    anchorPreview: makeAnchorPreview(normalizedAssistantText),
    snapshotVersion: 1,
    snapshot: {
      userText,
      assistantText: normalizedAssistantText,
      sources: sources.length > 0 ? sources : undefined,
      toolSummaries: toolSummaries.length > 0 ? toolSummaries : undefined,
      filePaths: filePaths.length > 0 ? filePaths : undefined,
    },
  }
}

async function createSideChat(input: {
  parentSessionID: string
  anchorMessageID: string
}): Promise<SessionInfo> {
  ensureSessionTables()
  const parentSession = DataBaseRead("sessions", input.parentSessionID) as SessionInfo | null
  if (!parentSession) {
    throw new Error(`Parent session '${input.parentSessionID}' was not found.`)
  }
  if (isSideChatSession(parentSession)) {
    throw new Error("Side chats can only be created from main sessions.")
  }

  const now = Date.now()
  const linkSeed = snapshotFromAnchorMessage(input)
  const session = normalizeSessionInfo({
    id: Identifier.descending("session"),
    projectID: parentSession.projectID,
    directory: parentSession.directory,
    worktreeID: parentSession.worktreeID,
    title: buildSideChatTitle(linkSeed.anchorPreview),
    version: Installation.VERSION,
    kind: "side-chat",
    policy: SIDE_CHAT_POLICY,
    workflow: defaultWorkflowState(now),
    time: {
      created: now,
      updated: now,
    },
  })
  const link = SideChatLink.parse({
    ...linkSeed,
    sessionID: session.id,
    createdAt: now,
  })

  const commitCreate = db.db.transaction((nextSession: SessionInfo, nextLink: SideChatLink) => {
    db.insertOneWithSchema("sessions", nextSession, SessionInfo)
    db.insertOneWithSchema("side_chat_links", nextLink, SideChatLink)
  })

  commitCreate(session, link)
  return session
}

function normalizeSessionTitle(title: string | undefined) {
  const trimmed = title?.trim()
  return trimmed ? trimmed : DEFAULT_SESSION_TITLE
}

function isDefaultSessionTitle(title: string | undefined) {
  return normalizeSessionTitle(title) === DEFAULT_SESSION_TITLE
}

function updateSessionTitle(
  sessionID: string,
  title: string,
  options?: {
    ifCurrentTitle?: string
  },
): SessionInfo | null {
  const existing = DataBaseRead("sessions", sessionID) as SessionInfo | null
  if (!existing) return null

  if (options?.ifCurrentTitle && existing.title !== options.ifCurrentTitle) {
    return existing
  }

  const nextTitle = title.trim()
  if (!nextTitle) return existing
  if (existing.title === nextTitle) return existing

  const now = Date.now()
  const next: SessionInfo = {
    ...existing,
    title: nextTitle,
    time: {
      ...existing.time,
      updated: now,
    },
  }

  updateSessionRecord(next)
  return next
}

function updateSessionPinned(sessionID: string, pinned: boolean): SessionInfo | null {
  const existing = DataBaseRead("sessions", sessionID) as SessionInfo | null
  if (!existing) return null
  if (Boolean(existing.pinned) === pinned) return existing

  const next: SessionInfo = {
    ...existing,
    pinned: pinned ? true : undefined,
  }

  updateSessionRecord(next)
  return next
}

function listByProject(projectID: string): SessionInfo[] {
  ensureSessionTables()
  return db
    .findManyWithSchema("sessions", SessionInfo, {
      where: [{ column: "projectID", value: projectID }],
    })
    .map((session) => normalizeSessionInfo(session))
    .sort((left, right) => right.time.updated - left.time.updated)
}

function readArchivedSession(sessionID: string): ArchivedSessionRecord | null {
  return DataBaseRead("archived_sessions", sessionID, "sessionID") as ArchivedSessionRecord | null
}

function listArchivedSessions(): ArchivedSessionRecord[] {
  ensureSessionTables()
  return db.findManyWithSchema("archived_sessions", ArchivedSessionRecord, {
    orderBy: [
      { column: "archivedAt", direction: "DESC" },
      { column: "updatedAt", direction: "DESC" },
    ],
  })
}

function listArchivedSessionSummaries(): ArchivedSessionSummaryRecord[] {
  ensureSessionTables()
  return db.findManyWithSchema("archived_sessions", ArchivedSessionSummaryRecord, {
    columns: [
      "sessionID",
      "projectID",
      "directory",
      "title",
      "createdAt",
      "updatedAt",
      "archivedAt",
      "schemaVersion",
      "messageCount",
      "eventCount",
    ],
    orderBy: [
      { column: "archivedAt", direction: "DESC" },
      { column: "updatedAt", direction: "DESC" },
    ],
  })
}

function listArchivableSessions(sessionID: string): SessionInfo[] {
  ensureSessionTables()
  const existing = DataBaseRead("sessions", sessionID) as SessionInfo | null
  if (!existing) return []

  if (isSideChatSession(existing)) {
    return [existing]
  }

  const sessions = [existing]
  const seenSessionIDs = new Set([existing.id])

  for (const link of loadSideChatLinks({ parentSessionID: sessionID })) {
    if (seenSessionIDs.has(link.sessionID)) continue
    const sideChatSession = DataBaseRead("sessions", link.sessionID) as SessionInfo | null
    if (!sideChatSession) continue

    sessions.push(sideChatSession)
    seenSessionIDs.add(sideChatSession.id)
  }

  return sessions
}

function removeSession(sessionID: string): SessionInfo | null {
  ensureSessionTables()
  const existing = DataBaseRead("sessions", sessionID) as SessionInfo | null
  if (!existing) return null

  db.deleteMany("parts", [{ column: "sessionID", value: sessionID }])
  db.deleteMany("messages", [{ column: "sessionID", value: sessionID }])
  db.deleteMany("turns", [{ column: "sessionID", value: sessionID }])
  removeSessionTasks(sessionID)
  EventStore.deleteSessionEvents(sessionID)
  LiveStreamHub.clearSession(sessionID)
  ToolResultPersistence.removeSessionOutputDirectory(sessionID)
  db.deleteById("sessions", sessionID)
  db.deleteById("side_chat_links", sessionID, "sessionID")

  return existing
}

function archiveSession(sessionID: string): ArchivedSessionRecord | null {
  return archiveSessionCascade(sessionID)[0] ?? null
}

function archiveSessionCascade(sessionID: string): ArchivedSessionRecord[] {
  ensureSessionTables()
  const sessions = listArchivableSessions(sessionID)
  if (sessions.length === 0) return []

  const archivedRecords = sessions.map((session) => buildArchivedSessionRecord(session))
  const commitArchive = db.db.transaction((records: ArchivedSessionRecord[]) => {
    for (const record of records) {
      db.insertOneWithSchema("archived_sessions", record, ArchivedSessionRecord)
    }

    for (const record of records) {
      db.deleteMany("parts", [{ column: "sessionID", value: record.sessionID }])
      db.deleteMany("messages", [{ column: "sessionID", value: record.sessionID }])
      db.deleteMany("turns", [{ column: "sessionID", value: record.sessionID }])
      removeSessionTasks(record.sessionID)
      db.deleteById("sessions", record.sessionID)
    }
  })

  commitArchive(archivedRecords)
  for (const record of archivedRecords) {
    LiveStreamHub.clearSession(record.sessionID)
  }
  return archivedRecords
}

function restoreArchivedSession(sessionID: string): SessionInfo | null {
  ensureSessionTables()
  const archived = readArchivedSession(sessionID)
  if (!archived) return null

  const restoredSession: SessionInfo = {
    ...normalizeSessionInfo(archived.snapshot.session),
    time: {
      ...archived.snapshot.session.time,
      archived: undefined,
    },
  }

  const commitRestore = db.db.transaction((record: ArchivedSessionRecord, session: SessionInfo) => {
    db.insertOneWithSchema("sessions", session, SessionInfo)

    for (const turn of record.snapshot.turns ?? []) {
      db.insertOneWithSchema("turns", turn, TurnInfo)
    }

    for (const message of record.snapshot.messages) {
      db.insertOneWithSchema("messages", message, Message.MessageInfo)
    }

    for (const part of record.snapshot.parts) {
      db.insertOneWithSchema("parts", part, Message.Part)
    }

    const tasks = record.snapshot.tasks ?? []
    if (tasks.length > 0) {
      ensureSessionTaskTableForRestore()
    }
    for (const task of tasks) {
      db.insertOneWithSchema("session_tasks", task, TaskSchema.SessionTaskRecord)
    }

    db.deleteById("archived_sessions", record.sessionID, "sessionID")
  })

  commitRestore(archived, restoredSession)
  backfillLegacySessionTrees([restoredSession.id])
  return (DataBaseRead("sessions", restoredSession.id) as SessionInfo | null) ?? restoredSession
}

function deleteArchivedSession(sessionID: string): ArchivedSessionRecord | null {
  ensureSessionTables()
  const archived = readArchivedSession(sessionID)
  if (!archived) return null

  db.deleteById("archived_sessions", sessionID, "sessionID")
  db.deleteById("side_chat_links", sessionID, "sessionID")
  EventStore.deleteSessionEvents(sessionID)
  LiveStreamHub.clearSession(sessionID)
  ToolResultPersistence.removeSessionOutputDirectory(sessionID)
  return archived
}

function listSideChats(parentSessionID: string, anchorMessageID?: string): SideChatLink[] {
  return loadSideChatLinks({
    parentSessionID,
    anchorMessageID,
  })
}

function getSideChatLink(sessionID: string): SideChatLink | null {
  return (DataBaseRead("side_chat_links", sessionID, "sessionID") as SideChatLink | null) ?? null
}

function getSessionOrigin(sessionID: string): SessionOrigin | undefined {
  const link = getSideChatLink(sessionID)
  if (!link) return undefined
  return {
    parentSessionID: link.parentSessionID,
    anchorMessageID: link.anchorMessageID,
    anchorPreview: link.anchorPreview,
  }
}

function getSideChatContext(sessionID: string): SideChatContext | null {
  const link = getSideChatLink(sessionID)
  if (!link) return null

  const activeSession = DataBaseRead("sessions", sessionID) as SessionInfo | null
  if (activeSession) {
    return {
      session: activeSession,
      link,
      messages: loadMessagesWithParts(sessionID),
    }
  }

  const archived = readArchivedSession(sessionID)
  if (!archived) return null

  const partsByMessageID = new Map<string, Message.Part[]>()
  for (const part of archived.snapshot.parts) {
    const list = partsByMessageID.get(part.messageID) ?? []
    list.push(part)
    partsByMessageID.set(part.messageID, list)
  }

  return {
    session: normalizeSessionInfo(archived.snapshot.session),
    link,
    messages: archived.snapshot.messages.map((message) => ({
      info: message,
      parts: partsByMessageID.get(message.id) ?? [],
    })),
  }
}

function removeProjectSessions(projectID: string): SessionInfo[] {
  const sessions = listByProject(projectID)
  for (const session of sessions) {
    removeSession(session.id)
  }

  return sessions
}

const updateMessage = fn(Message.MessageInfo, (msg) => {
  recordMessage(msg)
})

const updatePart = fn(Message.Part, (part) => {
  upsertPart(part)
})

function updateSessionWorkflow(
  sessionID: string,
  updater: (workflow: SessionWorkflowState) => SessionWorkflowState,
): SessionInfo | null {
  const existing = DataBaseRead("sessions", sessionID) as SessionInfo | null
  if (!existing) return null

  const now = Date.now()
  const nextWorkflow = normalizeWorkflowState(updater(normalizeWorkflowState(existing.workflow, now)), now)
  const next: SessionInfo = {
    ...existing,
    workflow: nextWorkflow,
    time: {
      ...existing.time,
      updated: now,
    },
  }

  updateSessionRecord(next)
  return next
}

function getSessionModelSelection(sessionID: string): SessionModelSelection | undefined {
  const existing = DataBaseRead("sessions", sessionID) as SessionInfo | null
  return normalizeSessionModelSelection(existing?.modelSelection)
}

function updateSessionModelSelection(
  sessionID: string,
  input: SessionModelSelectionInput,
): SessionInfo | null {
  const existing = DataBaseRead("sessions", sessionID) as SessionInfo | null
  if (!existing) return null

  const current = normalizeSessionModelSelection(existing.modelSelection) ?? {}
  const nextSelection = normalizeSessionModelSelection({
    model: input.model === null ? undefined : input.model ?? current.model,
    small_model: input.small_model === null ? undefined : input.small_model ?? current.small_model,
    reasoning_effort: input.reasoning_effort === null
      ? undefined
      : input.reasoning_effort ?? current.reasoning_effort,
  })
  const now = Date.now()
  const next: SessionInfo = {
    ...existing,
    modelSelection: nextSelection,
    time: {
      ...existing.time,
      updated: now,
    },
  }

  updateSessionRecord(next)
  return next
}

export {
  archiveSession,
  archiveSessionCascade,
  createSession,
  createSideChat,
  createTurn,
  deleteArchivedSession,
  DataBaseCreate,
  DataBaseRead,
  deleteMessage,
  deletePart,
  listArchivedSessions,
  listArchivedSessionSummaries,
  listByProject,
  listRunningTurns,
  listSideChats,
  listTurns,
  DEFAULT_SESSION_TITLE,
  isDefaultSessionTitle,
  getSessionOrigin,
  getActiveMessageID,
  getSessionModelSelection,
  getSideChatContext,
  getSideChatLink,
  listArchivableSessions,
  readArchivedSession,
  removeProjectSessions,
  removeSession,
  restoreArchivedSession,
  recordMessage,
  updateActiveMessageID,
  updateSessionPinned,
  updateSessionTitle,
  updateTurn,
  updateSessionModelSelection,
  updateSessionWorkflow,
  updateMessage,
  updatePart,
  upsertMessage,
  upsertPart,
}
