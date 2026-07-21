import { statSync } from "node:fs"
import { readdir, rm, stat } from "node:fs/promises"
import path from "node:path"
import type { DesktopStorageOptimizeResult } from "@anybox/shared"
import * as db from "#database/Sqlite.ts"
import * as Global from "#global/global.ts"
import * as Message from "#session/core/message.ts"
import * as Session from "#session/core/session.ts"
import * as EventStore from "#session/runtime/event-store.ts"
import * as SessionRunner from "#session/runtime/session-runner.ts"
import * as ToolResultPersistence from "#session/support/tool-result-persistence.ts"
import { Scheduler } from "#scheduler/index.ts"
import * as Log from "#util/log.ts"

const log = Log.create({ service: "storage.maintenance" })
export const TRACE_RETENTION_DAYS = 30
export const TRACE_DELETE_BATCH_SIZE = 5_000
export const ORPHAN_GRACE_MS = 24 * 60 * 60 * 1_000
const RETENTION_MS = TRACE_RETENTION_DAYS * 24 * 60 * 60 * 1_000
const SCHEDULER_ID = "storage.maintenance"
const SCHEDULER_INTERVAL_MS = 24 * 60 * 60 * 1_000
const META_KEY = "trace-v2"

type MaintenanceStatus = "idle" | "running" | "succeeded" | "failed" | "pending"
type PersistedMaintenanceState = {
  status: MaintenanceStatus
  lastRunAt?: number
  lastError?: string
  lastResult?: DesktopStorageOptimizeResult
  initialVacuumComplete?: boolean
}

export class StorageMaintenanceBusyError extends Error {
  readonly code = "STORAGE_MAINTENANCE_BUSY"
  constructor() {
    super("Storage optimization is unavailable while a session task is running.")
    this.name = "StorageMaintenanceBusyError"
  }
}

let running: Promise<DesktopStorageOptimizeResult> | null = null
let currentState: PersistedMaintenanceState | undefined
let stateGeneration = -1
let idleRetrySubscribed = false

function ensureMetaTable() {
  db.db.run(`
    CREATE TABLE IF NOT EXISTS "storage_maintenance_meta" (
      "id" TEXT PRIMARY KEY,
      "data" TEXT NOT NULL,
      "updatedAt" INTEGER NOT NULL
    )
  `)
}

function readState(): PersistedMaintenanceState {
  const generation = db.getDatabaseGeneration()
  if (stateGeneration !== generation) {
    currentState = undefined
    stateGeneration = generation
  }
  if (currentState) return currentState
  ensureMetaTable()
  const row = db.db.prepare(`SELECT "data" FROM "storage_maintenance_meta" WHERE "id" = ?`).get(META_KEY) as {
    data?: string
  } | null
  try {
    currentState = row?.data ? JSON.parse(row.data) as PersistedMaintenanceState : { status: "idle" }
  } catch {
    currentState = { status: "idle" }
  }
  if (currentState.status === "running") currentState.status = "pending"
  return currentState
}

function writeState(state: PersistedMaintenanceState) {
  stateGeneration = db.getDatabaseGeneration()
  currentState = state
  ensureMetaTable()
  db.db.prepare(`
    INSERT INTO "storage_maintenance_meta" ("id", "data", "updatedAt")
    VALUES (?, ?, ?)
    ON CONFLICT("id") DO UPDATE SET "data" = excluded."data", "updatedAt" = excluded."updatedAt"
  `).run(META_KEY, JSON.stringify(state), Date.now())
}

function runningTasksExist() {
  return SessionRunner.snapshot().length > 0
}

function databaseFilesSize() {
  const databasePath = db.getDatabaseFile()
  return [databasePath, `${databasePath}-wal`, `${databasePath}-shm`].reduce((sum, file) => {
    try {
      return sum + statSync(file).size
    } catch {
      return sum
    }
  }, 0)
}

async function listFilesRecursively(root: string): Promise<string[]> {
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return []
  }
  const files: string[] = []
  for (const entry of entries) {
    const candidate = path.join(root, entry.name)
    if (entry.isDirectory()) files.push(...await listFilesRecursively(candidate))
    else if (entry.isFile()) files.push(candidate)
  }
  return files
}

async function allArtifactFiles() {
  const sessionsRoot = path.join(Global.Path.state, "sessions")
  let sessions
  try {
    sessions = await readdir(sessionsRoot, { withFileTypes: true })
  } catch {
    return []
  }
  const files: string[] = []
  for (const session of sessions) {
    if (!session.isDirectory()) continue
    files.push(...await listFilesRecursively(path.join(sessionsRoot, session.name, "tool-results")))
  }
  return files
}

async function artifactBytes() {
  let bytes = 0
  for (const file of await allArtifactFiles()) {
    try {
      bytes += (await stat(file)).size
    } catch {
      // File disappeared between enumeration and stat.
    }
  }
  return bytes
}

function normalizeReference(file: string) {
  const resolved = path.resolve(file)
  return process.platform === "win32" ? resolved.toLowerCase() : resolved
}

function addPartArtifactReferences(part: Message.Part, references: Set<string>) {
  const persisted = part.type === "tool" && part.state.status === "completed"
    ? ToolResultPersistence.readPersistedOutputMetadata(part.state.metadata)
    : (part.type === "file" || part.type === "image")
      ? ToolResultPersistence.readPersistedOutputMetadata(part.metadata)
      : undefined
  if (!persisted) return
  const add = (candidate: unknown) => {
    if (typeof candidate !== "string" || !ToolResultPersistence.isManagedSessionArtifactPath(part.sessionID, candidate)) return
    references.add(normalizeReference(candidate))
  }
  add(persisted.path)
  add(persisted.envelopePath)
  add(persisted.manifestPath)
  for (const artifact of persisted.artifacts ?? []) {
    add(path.join(ToolResultPersistence.getSessionOutputDirectory(part.sessionID), artifact.path))
  }
  if (part.type === "tool" && part.state.status === "completed") {
    for (const attachment of part.state.attachments ?? []) add(attachment.url)
  } else if (part.type === "file" || part.type === "image") {
    add(part.url)
  }
}

function allReferencedArtifactFiles() {
  const references = new Set<string>()
  if (db.tableExists("parts")) {
    for (const part of db.findManyWithSchema("parts", Message.Part)) addPartArtifactReferences(part, references)
  }
  if (db.tableExists("archived_sessions")) {
    for (const archived of db.findManyWithSchema("archived_sessions", Session.ArchivedSessionRecord)) {
      for (const part of archived.snapshot.parts) addPartArtifactReferences(part, references)
    }
  }
  return references
}

async function cleanupOrphanArtifacts(now = Date.now()) {
  const references = allReferencedArtifactFiles()
  let deleted = 0
  const cutoff = now - ORPHAN_GRACE_MS
  for (const file of await allArtifactFiles()) {
    if (references.has(normalizeReference(file))) continue
    try {
      const info = await stat(file)
      if (info.mtimeMs >= cutoff) continue
      await rm(file, { force: true })
      deleted += 1
    } catch {
      // Missing/in-use artifacts are retried on the next maintenance pass.
    }
  }
  return deleted
}

async function compactToolPart(part: Message.Part) {
  if (part.type !== "tool" || part.state.status !== "completed") return undefined
  if (ToolResultPersistence.readPersistedOutputMetadata(part.state.metadata)) return undefined
  const originalAttachments = part.state.attachments
  const processed = await ToolResultPersistence.maybePersistToolResult({
    sessionID: part.sessionID,
    toolCallID: part.callID,
    toolName: part.tool,
    output: part.state.output,
    metadata: part.state.metadata,
    modelOutput: part.state.modelOutput,
    attachments: originalAttachments,
    rawResult: {
      text: part.state.output,
      metadata: part.state.metadata,
      modelOutput: part.state.modelOutput,
      attachments: originalAttachments,
    },
  })
  if (!processed.persisted || processed.persisted.failed) return undefined
  const attachments = processed.attachments?.map((attachment, index) => ({
    ...originalAttachments?.[index],
    ...attachment,
  }))
  return Message.ToolPart.parse({
    ...part,
    state: {
      ...part.state,
      output: processed.output,
      modelOutput: processed.modelOutput,
      metadata: processed.metadata,
      attachments,
      time: {
        ...part.state.time,
        compacted: Date.now(),
      },
    },
  })
}

async function migrateActiveToolParts() {
  if (!db.tableExists("parts")) return 0
  let migrated = 0
  for (const part of db.findManyWithSchema("parts", Message.Part)) {
    const compacted = await compactToolPart(part)
    if (!compacted) continue
    Session.upsertPart(compacted)
    migrated += 1
  }
  return migrated
}

async function migrateArchivedSnapshots() {
  if (!db.tableExists("archived_sessions")) return { snapshots: 0, parts: 0 }
  let snapshots = 0
  let parts = 0
  for (const archived of db.findManyWithSchema("archived_sessions", Session.ArchivedSessionRecord)) {
    let changed = Boolean(archived.snapshot.events?.length) || archived.eventCount !== 0
    const nextParts: Message.Part[] = []
    for (const part of archived.snapshot.parts) {
      const compacted = await compactToolPart(part)
      nextParts.push(compacted ?? part)
      if (compacted) {
        changed = true
        parts += 1
      }
    }
    if (!changed) continue
    const next = Session.ArchivedSessionRecord.parse({
      ...archived,
      eventCount: 0,
      snapshot: {
        ...archived.snapshot,
        parts: nextParts,
        events: undefined,
      },
    })
    db.updateByIdWithSchema("archived_sessions", archived.sessionID, next, Session.ArchivedSessionRecord, "sessionID")
    snapshots += 1
  }
  return { snapshots, parts }
}

export function deleteExpiredTraceBatch(now = Date.now()) {
  EventStore.ensureEventStoreTables()
  const cutoff = now - RETENTION_MS
  const selectExpired = db.tableExists("turns") ? `
        SELECT event."position"
        FROM "session_events" AS event
        LEFT JOIN "turns" AS turn_record ON turn_record."id" = event."turnID"
        WHERE event."timestamp" < ?
          AND COALESCE(turn_record."status", '') NOT IN ('running', 'cancelling')
        ORDER BY event."position" ASC
        LIMIT ${TRACE_DELETE_BATCH_SIZE}
      ` : `
        SELECT "position"
        FROM "session_events"
        WHERE "timestamp" < ?
        ORDER BY "position" ASC
        LIMIT ${TRACE_DELETE_BATCH_SIZE}
      `
  return db.db.prepare(`
    DELETE FROM "session_events"
    WHERE "position" IN (${selectExpired})
  `).run(cutoff).changes
}

function deleteAllExpiredTrace(now = Date.now()) {
  let total = 0
  while (true) {
    const deleted = deleteExpiredTraceBatch(now)
    total += deleted
    if (deleted < TRACE_DELETE_BATCH_SIZE) return total
  }
}

function optimizeSqlite(fullVacuum: boolean) {
  db.db.run("PRAGMA wal_checkpoint(TRUNCATE)")
  db.db.run("PRAGMA auto_vacuum = INCREMENTAL")
  if (fullVacuum) db.db.run("VACUUM")
  else db.db.run("PRAGMA incremental_vacuum(2000)")
  db.db.run("PRAGMA optimize")
}

async function performMaintenance(options: { automatic: boolean }): Promise<DesktopStorageOptimizeResult> {
  if (runningTasksExist()) throw new StorageMaintenanceBusyError()
  const startedAt = Date.now()
  const beforeBytes = databaseFilesSize() + await artifactBytes()
  EventStore.ensureEventStoreTables()
  const toolPartsMigrated = await migrateActiveToolParts()
  const archived = await migrateArchivedSnapshots()
  const traceDeleted = deleteAllExpiredTrace(startedAt)
  const orphanArtifactsDeleted = await cleanupOrphanArtifacts(startedAt)
  if (runningTasksExist()) throw new StorageMaintenanceBusyError()
  const previous = readState()
  const fullVacuum = !options.automatic || !previous.initialVacuumComplete
  optimizeSqlite(fullVacuum)
  const afterBytes = databaseFilesSize() + await artifactBytes()
  const completedAt = Date.now()
  return {
    traceDeleted,
    orphanArtifactsDeleted,
    toolPartsMigrated: toolPartsMigrated + archived.parts,
    archivedSnapshotsMigrated: archived.snapshots,
    cleanedCount: traceDeleted + orphanArtifactsDeleted,
    migratedCount: toolPartsMigrated + archived.parts + archived.snapshots,
    beforeBytes,
    afterBytes,
    reclaimedBytes: Math.max(0, beforeBytes - afterBytes),
    durationMs: completedAt - startedAt,
    completedAt,
  }
}

export function getMaintenanceState() {
  const state = readState()
  return {
    status: running ? "running" as const : state.status,
    lastRunAt: state.lastRunAt,
    lastError: state.lastError,
    lastResult: state.lastResult,
  }
}

export async function optimizeStorage(options: { automatic?: boolean } = {}) {
  const automatic = options.automatic ?? false
  if (running) throw new StorageMaintenanceBusyError()
  if (runningTasksExist()) {
    if (automatic) {
      const previous = readState()
      writeState({ ...previous, status: "pending", lastError: undefined })
    }
    throw new StorageMaintenanceBusyError()
  }
  const previous = readState()
  writeState({ ...previous, status: "running", lastError: undefined })
  running = performMaintenance({ automatic })
  try {
    const result = await running
    writeState({
      status: "succeeded",
      lastRunAt: result.completedAt,
      lastResult: result,
      initialVacuumComplete: true,
    })
    return result
  } catch (error) {
    const busy = error instanceof StorageMaintenanceBusyError
    writeState({
      ...previous,
      status: busy && automatic ? "pending" : "failed",
      lastError: error instanceof Error ? error.message : String(error),
    })
    throw error
  } finally {
    running = null
  }
}

export function startStorageMaintenance() {
  if (!idleRetrySubscribed) {
    idleRetrySubscribed = true
    SessionRunner.subscribe((event) => {
      if (event.type !== "finished" && event.type !== "cancelled") return
      if (running || runningTasksExist() || readState().status !== "pending") return
      void optimizeStorage({ automatic: true }).catch((error) => {
        if (error instanceof StorageMaintenanceBusyError) return
        log.error("deferred storage maintenance failed", {
          error: error instanceof Error ? error.message : String(error),
        })
      })
    })
  }
  Scheduler.register({
    id: SCHEDULER_ID,
    interval: SCHEDULER_INTERVAL_MS,
    scope: "global",
    run: async () => {
      try {
        await optimizeStorage({ automatic: true })
      } catch (error) {
        if (error instanceof StorageMaintenanceBusyError) {
          log.info("automatic storage maintenance deferred while sessions are running")
          return
        }
        log.error("automatic storage maintenance failed", {
          error: error instanceof Error ? error.message : String(error),
        })
      }
    },
  })
}
