import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import "./sqlite.cleanup.ts"
import * as Sqlite from "#database/Sqlite.ts"
import * as Identifier from "#id/id.ts"
import * as Session from "#session/core/session.ts"
import * as EventStore from "#session/runtime/event-store.ts"
import * as RuntimeEvent from "#session/runtime/runtime-event.ts"
import * as SessionRunner from "#session/runtime/session-runner.ts"
import * as StorageMaintenance from "#session/runtime/storage-maintenance.ts"
import { getStorageUsage } from "#server/usecases/storage.ts"
import { createServerApp } from "#server/server.ts"

async function removeWithRetry(target: string, attempts = 10) {
  let lastError: unknown
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      Bun.gc(true)
      await rm(target, { recursive: true, force: true })
      return
    } catch (error) {
      lastError = error
      await Bun.sleep(50 * (attempt + 1))
    }
  }

  throw lastError
}

function category(snapshot: ReturnType<typeof getStorageUsage>, id: string) {
  const item = snapshot.categories.find((candidate) => candidate.id === id)
  expect(item).toBeTruthy()
  return item!
}

test("storage usage returns a stable empty database snapshot", async () => {
  const root = await mkdtemp(join(tmpdir(), "anybox-storage-empty-"))
  const databaseFile = join(root, "usage.db")

  try {
    Sqlite.setDatabaseFile(databaseFile)

    const snapshot = getStorageUsage()
    expect(snapshot.database.path).toBe(databaseFile)
    expect(snapshot.database.totalBytes).toBeGreaterThanOrEqual(0)
    expect(snapshot.database.pageSize).not.toBeNull()
    expect(snapshot.database.pageSize!).toBeGreaterThan(0)
    expect(snapshot.database.pageCount).not.toBeNull()
    expect(snapshot.database.pageCount!).toBeGreaterThanOrEqual(0)
    expect(snapshot.database.freelistBytes).not.toBeNull()
    expect(snapshot.categories.map((item) => item.id)).toEqual([
      "archivedSessions",
      "activeSessions",
      "otherDatabase",
      "sqliteOverhead",
    ])
    expect(snapshot.archivedSessions).toEqual([])
    expect(snapshot.tables).toEqual([])
  } finally {
    Sqlite.closeDatabase()
    Sqlite.setDatabaseFile(undefined)
    await removeWithRetry(root)
  }
})

test("storage usage groups archived sessions, active sessions, and other tables", async () => {
  const root = await mkdtemp(join(tmpdir(), "anybox-storage-usage-"))
  const databaseFile = join(root, "usage.db")

  try {
    Sqlite.setDatabaseFile(databaseFile)

    await Session.createSession({
      directory: root,
      projectID: "project_active",
    })
    const archivedSession = await Session.createSession({
      directory: root,
      projectID: "project_archive",
    })
    const archived = Session.archiveSession(archivedSession.id)
    expect(archived?.sessionID).toBe(archivedSession.id)

    Sqlite.db.run(`CREATE TABLE IF NOT EXISTS other_records (id TEXT PRIMARY KEY, value TEXT NOT NULL);`)
    Sqlite.db.run(`INSERT INTO other_records (id, value) VALUES ('other-1', 'persistent settings payload');`)

    const snapshot = getStorageUsage()
    expect(snapshot.database.mainBytes).toBeGreaterThan(0)
    expect(snapshot.database.totalBytes).toBeGreaterThanOrEqual(snapshot.database.mainBytes)
    expect(category(snapshot, "archivedSessions").count).toBe(1)
    expect(category(snapshot, "archivedSessions").bytes).toBeGreaterThan(0)
    expect(category(snapshot, "activeSessions").count).toBe(1)
    expect(category(snapshot, "activeSessions").bytes).toBeGreaterThan(0)
    expect(category(snapshot, "otherDatabase").bytes).toBeGreaterThan(0)
    expect(category(snapshot, "sqliteOverhead").bytes).toBeGreaterThanOrEqual(0)

    expect(snapshot.archivedSessions[0]).toMatchObject({
      id: archivedSession.id,
      projectID: "project_archive",
      directory: root,
      messageCount: 0,
    })
    expect(snapshot.archivedSessions[0]!.estimatedBytes).toBeGreaterThan(0)
    expect(snapshot.tables).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "archived_sessions", category: "archivedSessions", rowCount: 1 }),
        expect.objectContaining({ name: "sessions", category: "activeSessions", rowCount: 1 }),
        expect.objectContaining({ name: "other_records", category: "otherDatabase", rowCount: 1 }),
      ]),
    )

    const app = createServerApp()
    const response = await app.request("http://localhost/api/storage/usage")
    expect(response.status).toBe(200)
    const body = await response.json() as { success?: boolean; data?: ReturnType<typeof getStorageUsage> }
    expect(body.success).toBe(true)
    expect(body.data?.database.path).toBe(databaseFile)
  } finally {
    Sqlite.closeDatabase()
    Sqlite.setDatabaseFile(undefined)
    await removeWithRetry(root)
  }
})

test("trace retention preserves the 30-day boundary and running turns", async () => {
  const root = await mkdtemp(join(tmpdir(), "anybox-storage-retention-"))
  const databaseFile = join(root, "retention.db")
  try {
    Sqlite.setDatabaseFile(databaseFile)
    const session = await Session.createSession({ directory: root, projectID: "project_retention" })
    const completedTurn = Session.createTurn({
      id: Identifier.ascending("turn"),
      sessionID: session.id,
      projectID: session.projectID,
    })
    Session.updateTurn(completedTurn.id, { status: "completed", phase: "completed", completedAt: 1 })
    const runningTurn = Session.createTurn({
      id: Identifier.ascending("turn"),
      sessionID: session.id,
      projectID: session.projectID,
    })
    const now = Date.now()
    const cutoff = now - StorageMaintenance.TRACE_RETENTION_DAYS * 24 * 60 * 60 * 1_000
    const completedFactory = RuntimeEvent.createRuntimeEventFactory({
      sessionID: session.id,
      turnID: completedTurn.id,
      timestamp: () => cutoff - 1,
    })
    const runningFactory = RuntimeEvent.createRuntimeEventFactory({
      sessionID: session.id,
      turnID: runningTurn.id,
      timestamp: () => cutoff - 1,
    })
    const boundaryFactory = RuntimeEvent.createRuntimeEventFactory({
      sessionID: session.id,
      turnID: Identifier.ascending("turn"),
      timestamp: () => cutoff,
    })
    const expired = completedFactory.next("retry.scheduled", { attempt: 1 })
    const running = runningFactory.next("retry.scheduled", { attempt: 1 })
    const boundary = boundaryFactory.next("retry.scheduled", { attempt: 1 })
    EventStore.append(expired)
    EventStore.append(running)
    EventStore.append(boundary)

    expect(StorageMaintenance.deleteExpiredTraceBatch(now)).toBe(1)
    const remaining = EventStore.listSessionEvents({ sessionID: session.id })
    expect(remaining.map((event) => event.eventID)).toEqual(expect.arrayContaining([
      running.eventID,
      boundary.eventID,
    ]))
    expect(remaining.map((event) => event.eventID)).not.toContain(expired.eventID)
  } finally {
    Sqlite.closeDatabase()
    Sqlite.setDatabaseFile(undefined)
    await removeWithRetry(root)
  }
})

test("storage optimize returns 409 while a session operation is running", async () => {
  const root = await mkdtemp(join(tmpdir(), "anybox-storage-busy-"))
  const databaseFile = join(root, "busy.db")
  let release!: () => void
  const blocker = new Promise<void>((resolve) => {
    release = resolve
  })
  try {
    Sqlite.setDatabaseFile(databaseFile)
    const handle = SessionRunner.enqueuePrompt({
      sessionID: "session-storage-busy",
      directory: root,
      type: "prompt",
      execute: async () => blocker,
    })
    while (SessionRunner.snapshot().length === 0) await Bun.sleep(1)

    await expect(StorageMaintenance.optimizeStorage({ automatic: true })).rejects.toMatchObject({
      code: "STORAGE_MAINTENANCE_BUSY",
    })
    expect(StorageMaintenance.getMaintenanceState().status).toBe("pending")

    const response = await createServerApp().request("http://localhost/api/storage/optimize", {
      method: "POST",
    })
    expect(response.status).toBe(409)
    const body = await response.json() as { error?: { code?: string } }
    expect(body.error?.code).toBe("STORAGE_MAINTENANCE_BUSY")

    release()
    await handle.promise
  } finally {
    release?.()
    await SessionRunner.waitForIdle("session-storage-busy")
    Sqlite.closeDatabase()
    Sqlite.setDatabaseFile(undefined)
    await removeWithRetry(root)
  }
})

test("the trace v2 migration drops legacy payloads and is idempotent", async () => {
  const root = await mkdtemp(join(tmpdir(), "anybox-trace-v1-migration-"))
  const databaseFile = join(root, "trace-v1.db")
  try {
    Sqlite.setDatabaseFile(databaseFile)
    Sqlite.db.run(`
      CREATE TABLE "session_events" (
        "eventID" TEXT PRIMARY KEY,
        "sessionID" TEXT NOT NULL,
        "turnID" TEXT NOT NULL,
        "seq" INTEGER NOT NULL,
        "type" TEXT NOT NULL,
        "payload" TEXT NOT NULL,
        "timestamp" INTEGER NOT NULL
      )
    `)
    Sqlite.db.prepare(`
      INSERT INTO "session_events" ("eventID", "sessionID", "turnID", "seq", "type", "payload", "timestamp")
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run("legacy-event", "session-legacy", "turn-legacy", 1, "tool.call.settled", JSON.stringify({
      output: "x".repeat(200_000),
      image: `data:image/png;base64,${"a".repeat(100_000)}`,
    }), 1)

    EventStore.ensureEventStoreTables()
    EventStore.ensureEventStoreTables()
    const columns = Sqlite.db.prepare(`PRAGMA table_info("session_events")`).all() as Array<{ name: string }>
    expect(columns.map((column) => column.name)).toEqual(expect.arrayContaining([
      "position",
      "schemaVersion",
      "eventID",
      "sessionID",
      "turnID",
      "seq",
      "type",
      "payload",
      "timestamp",
    ]))
    expect(EventStore.countSessionEvents("session-legacy")).toBe(0)
    const indexes = Sqlite.db.prepare(`PRAGMA index_list("session_events")`).all() as Array<{ name: string }>
    expect(indexes.map((index) => index.name)).toEqual(expect.arrayContaining([
      "idx_session_events_scope_seq_unique",
      "idx_session_events_session_position",
      "idx_session_events_session_timestamp",
    ]))
  } finally {
    Sqlite.closeDatabase()
    Sqlite.setDatabaseFile(undefined)
    await removeWithRetry(root)
  }
})
