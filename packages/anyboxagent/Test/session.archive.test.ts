import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import "./sqlite.cleanup.ts"
import * as Sqlite from "#database/Sqlite.ts"
import * as Identifier from "#id/id.ts"
import * as EventStore from "#session/runtime/event-store.ts"
import * as Message from "#session/core/message.ts"
import * as RuntimeEvent from "#session/runtime/runtime-event.ts"
import * as Session from "#session/core/session.ts"

const baseModel = {
  providerID: "test-provider",
  modelID: "test-model",
}

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

test("archived session summaries do not parse archived snapshots", async () => {
  const root = await mkdtemp(join(tmpdir(), "anybox-session-archive-summary-"))
  const databaseFile = join(root, "archive.db")

  try {
    Sqlite.setDatabaseFile(databaseFile)

    const session = await Session.createSession({
      directory: root,
      projectID: "project_archive_summary",
    })

    const archived = Session.archiveSession(session.id)
    expect(archived?.sessionID).toBe(session.id)

    const updateSnapshot = Sqlite.db.prepare(
      `UPDATE archived_sessions SET snapshot = ? WHERE sessionID = ?`,
    )
    updateSnapshot.run("{not-json", session.id)
    updateSnapshot.finalize()

    const summaries = Session.listArchivedSessionSummaries()
    expect(summaries).toHaveLength(1)
    expect(summaries[0]!.sessionID).toBe(session.id)
    expect("snapshot" in summaries[0]!).toBe(false)
  } finally {
    Sqlite.closeDatabase()
    Sqlite.setDatabaseFile(undefined)
    await removeWithRetry(root)
  }
})

test("archived sessions tolerate unsupported legacy runtime event types", async () => {
  const root = await mkdtemp(join(tmpdir(), "anybox-session-archive-legacy-"))
  const databaseFile = join(root, "archive.db")

  try {
    Sqlite.setDatabaseFile(databaseFile)

    const session = await Session.createSession({
      directory: root,
      projectID: "project_archive_legacy",
    })
    const factory = RuntimeEvent.createRuntimeEventFactory({
      sessionID: session.id,
      turnID: Identifier.ascending("turn"),
      timestamp: () => Date.now(),
    })
    const knownEvent = factory.next("turn.started", {})
    EventStore.append(knownEvent)

    const archived = Session.archiveSession(session.id)
    expect(archived?.sessionID).toBe(session.id)

    const selectSnapshot = Sqlite.db.query(`SELECT snapshot FROM archived_sessions WHERE sessionID = ?`)
    const raw = selectSnapshot.get(session.id) as { snapshot: string } | null
    selectSnapshot.finalize()
    expect(raw).not.toBeNull()

    const snapshot = JSON.parse(raw!.snapshot)
    snapshot.events = [
      knownEvent,
      {
        ...knownEvent,
        eventID: Identifier.ascending("event"),
        seq: knownEvent.seq + 1,
        type: "tool.call.input.delta",
        payload: {
          callID: "call-legacy",
          delta: "{\"command\":\"pwd\"}",
        },
      },
    ]
    const updateSnapshot = Sqlite.db.prepare(
      `UPDATE archived_sessions SET snapshot = ?, eventCount = ? WHERE sessionID = ?`,
    )
    updateSnapshot.run(JSON.stringify(snapshot), snapshot.events.length, session.id)
    updateSnapshot.finalize()

    const listed = Session.listArchivedSessions()
    expect(listed).toHaveLength(1)
    expect(listed[0]!.snapshot.events).toHaveLength(2)

    const restored = Session.restoreArchivedSession(session.id)
    expect(restored?.id).toBe(session.id)

    const selectRestoredEventTypes = Sqlite.db.query(
      `SELECT type FROM session_events WHERE sessionID = ? ORDER BY seq ASC`,
    )
    const restoredEventTypes = selectRestoredEventTypes
      .all(session.id)
      .map((row) => (row as { type: string }).type)
    selectRestoredEventTypes.finalize()
    expect(restoredEventTypes).toEqual(["turn.started"])
  } finally {
    Sqlite.closeDatabase()
    Sqlite.setDatabaseFile(undefined)
    await removeWithRetry(root)
  }
})
