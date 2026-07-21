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

test("archiveSessionCascade archives derived side chats with the parent session", async () => {
  const root = await mkdtemp(join(tmpdir(), "anybox-session-archive-"))
  const databaseFile = join(root, "archive.db")

  try {
    Sqlite.setDatabaseFile(databaseFile)

    const parentSession = await Session.createSession({
      directory: root,
      projectID: "project_archive",
    })

    const userMessage = Message.User.parse({
      id: Identifier.ascending("message"),
      sessionID: parentSession.id,
      role: "user",
      created: Date.now(),
      agent: "default",
      model: baseModel,
    })
    const userPart = Message.TextPart.parse({
      id: Identifier.ascending("part"),
      sessionID: parentSession.id,
      messageID: userMessage.id,
      type: "text",
      text: "Explain the renderer pipeline.",
    })
    const assistantMessage = Message.Assistant.parse({
      id: Identifier.ascending("message"),
      sessionID: parentSession.id,
      role: "assistant",
      created: Date.now() + 1,
      parentID: userMessage.id,
      modelID: baseModel.modelID,
      providerID: baseModel.providerID,
      agent: "default",
      path: {
        cwd: root,
        root,
      },
      cost: 0,
      tokens: {
        input: 0,
        output: 0,
        reasoning: 0,
        cache: {
          read: 0,
          write: 0,
        },
      },
      finishReason: "stop",
    })
    const assistantPart = Message.TextPart.parse({
      id: Identifier.ascending("part"),
      sessionID: parentSession.id,
      messageID: assistantMessage.id,
      type: "text",
      text: "The renderer starts by tracing rays from the camera and collecting hit data.",
    })

    Session.updateMessage(userMessage)
    Session.updatePart(userPart)
    Session.updateMessage(assistantMessage)
    Session.updatePart(assistantPart)

    const sideChat = await Session.createSideChat({
      parentSessionID: parentSession.id,
      anchorMessageID: assistantMessage.id,
    })

    const archivedRecords = Session.archiveSessionCascade(parentSession.id)
    const archivedSessionIDs = new Set(archivedRecords.map((record) => record.sessionID))

    expect(archivedSessionIDs).toEqual(new Set([parentSession.id, sideChat.id]))
    expect(Session.DataBaseRead("sessions", parentSession.id)).toBeNull()
    expect(Session.DataBaseRead("sessions", sideChat.id)).toBeNull()
    expect(Session.readArchivedSession(parentSession.id)?.snapshot.session.id).toBe(parentSession.id)
    expect(Session.readArchivedSession(sideChat.id)?.snapshot.session.id).toBe(sideChat.id)
    expect(Session.listSideChats(parentSession.id).map((link) => link.sessionID)).toEqual([sideChat.id])
  } finally {
    Sqlite.closeDatabase()
    Sqlite.setDatabaseFile(undefined)
    await removeWithRetry(root)
  }
})

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
