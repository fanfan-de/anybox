import * as Log from "#util/log.ts"
import z from "zod"
import * as Identifier from "#id/id.ts"
import * as Snapshot from "#snapshot/snapshot.ts"
import * as BusEvent from "#bus/bus-event.ts"
import * as Message from "#session/core/message.ts"
import * as Installation from "#installation/installation.ts"
import { fn } from "#util/fn.ts"
import * as db from "#database/Sqlite.ts"
import { ensureLegacySessionCleanup } from "#database/legacy-session-cleanup.ts"
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
  messages: Message.MessageInfo
  parts: Message.Part
}

type TableName = keyof TableRecordMap

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

const TableSchemaMap = {
  sessions: SessionInfo,
  turns: TurnInfo,
  archived_sessions: ArchivedSessionRecord,
  messages: Message.MessageInfo,
  parts: Message.Part,
} as const

const log = Log.create({ service: "session" })
let sessionTablesGeneration = -1
const DEFAULT_SESSION_TITLE = "New chat"
const DEFAULT_SESSION_POLICY: SessionPolicy = {
  toolPolicy: "default",
}

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
    modelSelection: normalizeSessionModelSelection(session.modelSelection),
    policy: normalizeSessionPolicy(session.policy),
    workflow: session.workflow ? normalizeWorkflowState(session.workflow, session.time.updated) : session.workflow,
  }
}

function ensureSessionTables() {
  ensureLegacySessionCleanup()
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

  return existing
}

function archiveSession(sessionID: string): ArchivedSessionRecord | null {
  ensureSessionTables()
  const session = DataBaseRead("sessions", sessionID) as SessionInfo | null
  if (!session) return null

  const archivedRecord = buildArchivedSessionRecord(session)
  const commitArchive = db.db.transaction((record: ArchivedSessionRecord) => {
    db.insertOneWithSchema("archived_sessions", record, ArchivedSessionRecord)
    db.deleteMany("parts", [{ column: "sessionID", value: record.sessionID }])
    db.deleteMany("messages", [{ column: "sessionID", value: record.sessionID }])
    db.deleteMany("turns", [{ column: "sessionID", value: record.sessionID }])
    removeSessionTasks(record.sessionID)
    db.deleteById("sessions", record.sessionID)
  })

  commitArchive(archivedRecord)
  LiveStreamHub.clearSession(archivedRecord.sessionID)
  return archivedRecord
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
  EventStore.deleteSessionEvents(sessionID)
  LiveStreamHub.clearSession(sessionID)
  ToolResultPersistence.removeSessionOutputDirectory(sessionID)
  return archived
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
  createSession,
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
  listTurns,
  DEFAULT_SESSION_TITLE,
  isDefaultSessionTitle,
  getActiveMessageID,
  getSessionModelSelection,
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
