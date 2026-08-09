import z from "zod"
import * as db from "#database/Sqlite.ts"
import * as LiveStreamHub from "#session/runtime/live-stream-hub.ts"
import * as Projector from "#session/runtime/projector.ts"
import * as RuntimeEvent from "#session/runtime/runtime-event.ts"
import * as StoredTrace from "#session/runtime/stored-trace-event.ts"
import * as Log from "#util/log.ts"

const log = Log.create({ service: "session.event-store" })

const SessionEventRecord = z.object({
  position: z.number(),
  schemaVersion: z.literal(2),
  eventID: z.string(),
  sessionID: z.string(),
  turnID: z.string().nullable(),
  seq: z.number(),
  type: z.string(),
  payload: z.string(),
  timestamp: z.number(),
})

let sessionEventsGeneration = -1
const subscribers = new Set<(event: RuntimeEvent.RuntimeEvent) => void>()
const FAST_PATH_EVENT_ID_CACHE_LIMIT = 5_000
const appliedEventIDs = new Set<string>()
const appliedEventIDOrder: string[] = []
const sessionScopeSequences = new Map<string, number>()
const turnScopeSequences = new Map<string, number>()
let traceInsertFailureForTest = false
let traceInsertFailures = 0
let lastTraceInsertFailureAt: number | undefined

function resetGenerationState() {
  appliedEventIDs.clear()
  appliedEventIDOrder.length = 0
  sessionScopeSequences.clear()
  turnScopeSequences.clear()
}

export function ensureEventStoreTables() {
  const generation = db.getDatabaseGeneration()
  if (sessionEventsGeneration === generation && generation > 0) return

  if (db.tableExists("session_events")) {
    const columns = db.db.prepare(`PRAGMA table_info("session_events")`).all() as Array<{ name?: string }>
    const names = new Set(columns.map((column) => column.name))
    if (!names.has("position") || !names.has("schemaVersion")) {
      // Trace is explicitly non-authoritative. Rebuilding the table is safer than
      // carrying v1's full Message/Part payloads into the compact v2 store.
      db.db.run(`DROP TABLE "session_events"`)
    }
  }

  db.db.run(`
    CREATE TABLE IF NOT EXISTS "session_events" (
      "position" INTEGER PRIMARY KEY AUTOINCREMENT,
      "schemaVersion" INTEGER NOT NULL DEFAULT 2,
      "eventID" TEXT NOT NULL UNIQUE,
      "sessionID" TEXT NOT NULL,
      "turnID" TEXT,
      "seq" INTEGER NOT NULL,
      "type" TEXT NOT NULL,
      "payload" TEXT NOT NULL CHECK(length(CAST("payload" AS BLOB)) <= ${StoredTrace.MAX_STORED_TRACE_PAYLOAD_BYTES}),
      "timestamp" INTEGER NOT NULL
    );
  `)
  db.db.run(`
    CREATE UNIQUE INDEX IF NOT EXISTS "idx_session_events_scope_seq_unique"
    ON "session_events" ("sessionID", COALESCE("turnID", ''), "seq");
  `)
  db.db.run(`
    CREATE INDEX IF NOT EXISTS "idx_session_events_session_position"
    ON "session_events" ("sessionID", "position");
  `)
  db.db.run(`
    CREATE INDEX IF NOT EXISTS "idx_session_events_session_timestamp"
    ON "session_events" ("sessionID", "timestamp");
  `)

  sessionEventsGeneration = db.getDatabaseGeneration()
  resetGenerationState()
}

function toStoredValues(event: RuntimeEvent.RuntimeEvent) {
  const payload = StoredTrace.summarizeRuntimeEvent(event)
  const serialized = JSON.stringify(payload)
  const bytes = Buffer.byteLength(serialized, "utf8")
  if (bytes > StoredTrace.MAX_STORED_TRACE_PAYLOAD_BYTES) {
    throw new Error(`Stored trace payload exceeded ${StoredTrace.MAX_STORED_TRACE_PAYLOAD_BYTES} bytes after compaction.`)
  }
  return {
    schemaVersion: 2 as const,
    eventID: event.eventID,
    sessionID: event.sessionID,
    turnID: event.turnID,
    seq: event.seq,
    type: event.type,
    payload: serialized,
    timestamp: event.timestamp,
  }
}

function fromStoredRecord(record: z.infer<typeof SessionEventRecord>) {
  return StoredTrace.StoredTraceEvent.parse({
    ...record,
    payload: JSON.parse(record.payload),
  })
}

function notify(event: RuntimeEvent.RuntimeEvent) {
  for (const subscriber of [...subscribers]) {
    try {
      subscriber(event)
    } catch {
      subscribers.delete(subscriber)
    }
  }
}

function isTransientStreamEvent(event: RuntimeEvent.RuntimeEvent) {
  return (
    event.type === "text.part.delta" ||
    event.type === "reasoning.part.delta" ||
    event.type === "tool.call.input_delta"
  )
}

function rememberAppliedEventID(eventID: string) {
  if (appliedEventIDs.has(eventID)) return false
  appliedEventIDs.add(eventID)
  appliedEventIDOrder.push(eventID)
  while (appliedEventIDOrder.length > FAST_PATH_EVENT_ID_CACHE_LIMIT) {
    const expired = appliedEventIDOrder.shift()
    if (expired) appliedEventIDs.delete(expired)
  }
  return true
}

function hasStoredSequence(event: RuntimeEvent.RuntimeEvent) {
  ensureEventStoreTables()
  const row = db.db.prepare(`
    SELECT 1 AS found
    FROM "session_events"
    WHERE "sessionID" = ? AND COALESCE("turnID", '') = COALESCE(?, '') AND "seq" = ?
    LIMIT 1
  `).get(event.sessionID, event.turnID, event.seq) as { found?: number } | null
  return Boolean(row?.found)
}

function insertTrace(event: RuntimeEvent.RuntimeEvent) {
  if (traceInsertFailureForTest) throw new Error("Injected trace insert failure")
  const values = toStoredValues(event)
  db.db.prepare(`
    INSERT INTO "session_events"
      ("schemaVersion", "eventID", "sessionID", "turnID", "seq", "type", "payload", "timestamp")
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    values.schemaVersion,
    values.eventID,
    values.sessionID,
    values.turnID,
    values.seq,
    values.type,
    values.payload,
    values.timestamp,
  )
}

function tryInsertTrace(event: RuntimeEvent.RuntimeEvent) {
  db.db.run("SAVEPOINT trace_event_insert")
  try {
    insertTrace(event)
    db.db.run("RELEASE SAVEPOINT trace_event_insert")
    return true
  } catch (error) {
    try {
      db.db.run("ROLLBACK TO SAVEPOINT trace_event_insert")
      db.db.run("RELEASE SAVEPOINT trace_event_insert")
    } catch {
      // Preserve the original trace error; canonical state has already committed.
    }
    traceInsertFailures += 1
    lastTraceInsertFailureAt = Date.now()
    log.warn("trace insert failed after canonical commit", {
      eventID: event.eventID,
      sessionID: event.sessionID,
      turnID: event.turnID,
      type: event.type,
      error: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}

export function subscribe(subscriber: (event: RuntimeEvent.RuntimeEvent) => void) {
  subscribers.add(subscriber)
  return () => subscribers.delete(subscriber)
}

export function append(event: RuntimeEvent.RuntimeEvent) {
  ensureEventStoreTables()
  if (hasEvent(event.eventID) || hasStoredSequence(event)) return event
  tryInsertTrace(event)
  notify(event)
  return event
}

export function hasEvent(eventID: string) {
  ensureEventStoreTables()
  const row = db.db.prepare(`SELECT 1 AS found FROM "session_events" WHERE "eventID" = ? LIMIT 1`).get(eventID) as {
    found?: number
  } | null
  return Boolean(row?.found)
}

export function appendAndProject(event: RuntimeEvent.RuntimeEvent) {
  ensureEventStoreTables()
  if (isTransientStreamEvent(event)) {
    if (rememberAppliedEventID(event.eventID)) {
      LiveStreamHub.publish(event)
      notify(event)
    }
    return event
  }

  if (appliedEventIDs.has(event.eventID) || hasEvent(event.eventID) || hasStoredSequence(event)) return event

  // Canonical message/part/turn state is the source of truth. Commit it first;
  // the diagnostic trace is deliberately isolated and best-effort.
  const applyCanonical = db.db.transaction((nextEvent: RuntimeEvent.RuntimeEvent) => {
    Projector.project(nextEvent)
  })
  applyCanonical(event)
  rememberAppliedEventID(event.eventID)
  tryInsertTrace(event)

  // Observers only see events after canonical state is readable, regardless of
  // whether the trace insert succeeded.
  LiveStreamHub.publish(event)
  notify(event)
  return event
}

export function appendSessionEvent<TType extends RuntimeEvent.RuntimeEventType>(
  sessionID: string,
  type: TType,
  payload: RuntimeEvent.RuntimeEventPayloadByType[TType],
) {
  ensureEventStoreTables()
  const row = db.db.prepare(`
    SELECT COALESCE(MAX("seq"), 0) AS "seq"
    FROM "session_events"
    WHERE "sessionID" = ? AND "turnID" IS NULL
  `).get(sessionID) as { seq?: number } | null
  const storedSequence = row?.seq ?? 0
  const nextSequence = Math.max(sessionScopeSequences.get(sessionID) ?? storedSequence, storedSequence) + 1
  sessionScopeSequences.set(sessionID, nextSequence)
  const factory = RuntimeEvent.createRuntimeEventFactory({
    sessionID,
    turnID: null,
    initialSeq: nextSequence - 1,
  })
  return appendAndProject(factory.next(type, payload))
}

export function appendTurnEvent<TType extends RuntimeEvent.RuntimeEventType>(
  sessionID: string,
  turnID: string,
  type: TType,
  payload: RuntimeEvent.RuntimeEventPayloadByType[TType],
) {
  ensureEventStoreTables()
  const row = db.db.prepare(`
    SELECT COALESCE(MAX("seq"), 0) AS "seq"
    FROM "session_events"
    WHERE "sessionID" = ? AND "turnID" = ?
  `).get(sessionID, turnID) as { seq?: number } | null
  const storedSequence = row?.seq ?? 0
  const scopeKey = `${sessionID}\u0000${turnID}`
  const nextSequence = Math.max(turnScopeSequences.get(scopeKey) ?? storedSequence, storedSequence) + 1
  turnScopeSequences.set(scopeKey, nextSequence)
  const factory = RuntimeEvent.createRuntimeEventFactory({
    sessionID,
    turnID,
    initialSeq: nextSequence - 1,
  })
  return appendAndProject(factory.next(type, payload))
}

export function listTurnEvents(input: {
  sessionID: string
  turnID: string
  sinceSeq?: number
  limit?: number
}) {
  ensureEventStoreTables()
  const params: Array<string | number> = [input.sessionID, input.turnID]
  let sql = `
    SELECT "position", "schemaVersion", "eventID", "sessionID", "turnID", "seq", "type", "payload", "timestamp"
    FROM "session_events"
    WHERE "sessionID" = ? AND "turnID" = ?
  `
  if (typeof input.sinceSeq === "number" && Number.isFinite(input.sinceSeq)) {
    sql += ` AND "seq" > ?`
    params.push(input.sinceSeq)
  }
  sql += ` ORDER BY "seq" ASC`
  if (input.limit) {
    sql += ` LIMIT ?`
    params.push(Math.max(1, input.limit))
  }
  const rows = db.db.prepare(sql).all(...params)
  return rows.map((row) => fromStoredRecord(SessionEventRecord.parse(row)))
}

export function listSessionEvents(input: {
  sessionID: string
  after?: { position?: number; timestamp?: number }
  limit?: number
}) {
  ensureEventStoreTables()
  const params: Array<string | number> = [input.sessionID]
  let sql = `
    SELECT "position", "schemaVersion", "eventID", "sessionID", "turnID", "seq", "type", "payload", "timestamp"
    FROM "session_events"
    WHERE "sessionID" = ?
  `
  if (typeof input.after?.position === "number") {
    sql += ` AND "position" > ?`
    params.push(input.after.position)
  } else if (typeof input.after?.timestamp === "number") {
    sql += ` AND "timestamp" > ?`
    params.push(input.after.timestamp)
  }
  sql += ` ORDER BY "position" ASC`
  if (input.limit) {
    sql += ` LIMIT ?`
    params.push(Math.max(1, input.limit))
  }
  const rows = db.db.prepare(sql).all(...params)
  return rows.map((row) => fromStoredRecord(SessionEventRecord.parse(row)))
}

export function listRecentSessionEvents(input: { sessionID: string; limit?: number }) {
  ensureEventStoreTables()
  const limit = Math.max(1, Math.min(input.limit ?? 20, 5_000))
  const rows = db.db.prepare(`
    SELECT "position", "schemaVersion", "eventID", "sessionID", "turnID", "seq", "type", "payload", "timestamp"
    FROM "session_events"
    WHERE "sessionID" = ?
    ORDER BY "position" DESC
    LIMIT ?
  `).all(input.sessionID, limit)
  return rows.map((row) => fromStoredRecord(SessionEventRecord.parse(row))).reverse()
}

export function countSessionEvents(sessionID: string) {
  ensureEventStoreTables()
  const row = db.db.prepare(`SELECT COUNT(*) AS count FROM "session_events" WHERE "sessionID" = ?`).get(sessionID) as {
    count: number
  }
  return row.count
}

export function deleteSessionEvents(sessionID: string) {
  ensureEventStoreTables()
  return db.db.prepare(`DELETE FROM "session_events" WHERE "sessionID" = ?`).run(sessionID).changes
}

export function traceStoreHealth() {
  return {
    insertFailures: traceInsertFailures,
    lastInsertFailureAt: lastTraceInsertFailureAt,
  }
}

export function setTraceInsertFailureForTest(enabled: boolean) {
  traceInsertFailureForTest = enabled
}
