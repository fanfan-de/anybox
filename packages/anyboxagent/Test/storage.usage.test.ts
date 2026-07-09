import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import "./sqlite.cleanup.ts"
import * as Sqlite from "#database/Sqlite.ts"
import * as Session from "#session/core/session.ts"
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
