import { expect, test } from "bun:test"
import { existsSync, rmSync } from "node:fs"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import "./sqlite.cleanup.ts"
import * as Sqlite from "#database/Sqlite.ts"
import * as Identifier from "#id/id.ts"
import { ensureLegacySessionCleanup } from "#database/legacy-session-cleanup.ts"
import * as EventStore from "#session/runtime/event-store.ts"
import * as Session from "#session/core/session.ts"
import * as Task from "#session/tasks/task.ts"

const model = {
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

function tableExists(tableName: string) {
  return Boolean(
    Sqlite.db
      .prepare(`SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?`)
      .get(tableName),
  )
}

function tableColumns(tableName: string) {
  return (Sqlite.db.prepare(`PRAGMA table_info("${tableName}")`).all() as Array<{ name: string }>)
    .map((column) => column.name)
}

function rowCount(tableName: string, column: string, value: string) {
  const row = Sqlite.db
    .prepare(`SELECT COUNT(*) AS count FROM "${tableName}" WHERE "${column}" = ?`)
    .get(value) as { count: number }
  return row.count
}

function addSessionRecords(sessionID: string, projectID: string) {
  const messageID = Identifier.ascending("message")
  Session.recordMessage({
    id: messageID,
    sessionID,
    role: "user",
    created: Date.now(),
    agent: "default",
    model,
  })
  Session.upsertPart({
    id: Identifier.ascending("part"),
    sessionID,
    messageID,
    type: "text",
    text: "legacy data",
  })
  const turn = Session.createTurn({
    sessionID,
    projectID,
    userMessageID: messageID,
  })
  EventStore.appendTurnEvent(sessionID, turn.id, "turn.started", {})
  Task.createSessionTasks({
    sessionID,
    defaultOwner: "default",
    tasks: [{
      subject: "Legacy task",
      description: "Delete with the legacy session.",
    }],
  })
}

function addLegacyAuxiliaryTables(input: {
  archivedSessionID: string
  kindSessionID: string
  linkSessionID: string
  mainSessionID: string
  orphanLinkSessionID: string
}) {
  Sqlite.db.run(`
    CREATE TABLE "side_chat_links" (
      "sessionID" TEXT PRIMARY KEY,
      "parentSessionID" TEXT,
      "anchorMessageID" TEXT
    )
  `)
  const insertLink = Sqlite.db.prepare(`
    INSERT INTO "side_chat_links" ("sessionID", "parentSessionID", "anchorMessageID")
    VALUES (?, ?, ?)
  `)
  insertLink.run(input.linkSessionID, input.mainSessionID, "message-anchor")
  insertLink.run(input.orphanLinkSessionID, input.mainSessionID, "message-orphan")
  Sqlite.db.run(`
    CREATE INDEX "idx_side_chat_links_session"
    ON "side_chat_links" ("sessionID")
  `)

  for (const tableName of ["permission_requests", "permission_audits", "environment_runs"]) {
    Sqlite.db.run(`
      CREATE TABLE "${tableName}" (
        "id" TEXT PRIMARY KEY,
        "sessionID" TEXT
      )
    `)
    const insert = Sqlite.db.prepare(`INSERT INTO "${tableName}" ("id", "sessionID") VALUES (?, ?)`)
    insert.run(`${tableName}-legacy`, input.kindSessionID)
    insert.run(`${tableName}-main`, input.mainSessionID)
  }

  Sqlite.db.run(`
    CREATE TABLE "subtasks" (
      "id" TEXT PRIMARY KEY,
      "parentSessionID" TEXT,
      "childSessionID" TEXT
    )
  `)
  const insertSubtask = Sqlite.db.prepare(`
    INSERT INTO "subtasks" ("id", "parentSessionID", "childSessionID")
    VALUES (?, ?, ?)
  `)
  insertSubtask.run("subtask-parent-legacy", input.kindSessionID, input.mainSessionID)
  insertSubtask.run("subtask-child-legacy", input.mainSessionID, input.linkSessionID)
  insertSubtask.run("subtask-main", input.mainSessionID, input.mainSessionID)

  Sqlite.db.run(`
    CREATE TABLE "automations" (
      "id" TEXT PRIMARY KEY,
      "kind" TEXT,
      "scope" TEXT
    )
  `)
  Sqlite.db.run(`
    CREATE TABLE "automation_runs" (
      "id" TEXT PRIMARY KEY,
      "automationID" TEXT,
      "sessionID" TEXT
    )
  `)
  const insertAutomation = Sqlite.db.prepare(`
    INSERT INTO "automations" ("id", "kind", "scope")
    VALUES (?, ?, ?)
  `)
  insertAutomation.run("automation-legacy", "thread", JSON.stringify({ sessionID: input.archivedSessionID }))
  insertAutomation.run("automation-main", "thread", JSON.stringify({ sessionID: input.mainSessionID }))
  const insertAutomationRun = Sqlite.db.prepare(`
    INSERT INTO "automation_runs" ("id", "automationID", "sessionID")
    VALUES (?, ?, ?)
  `)
  insertAutomationRun.run("automation-run-legacy", "automation-legacy", input.archivedSessionID)
  insertAutomationRun.run("automation-run-orphan", "automation-main", input.orphanLinkSessionID)
  insertAutomationRun.run("automation-run-main", "automation-main", input.mainSessionID)

  Sqlite.db.run(`
    CREATE TABLE "project_configs" (
      "projectID" TEXT PRIMARY KEY,
      "config" TEXT
    )
  `)
  Sqlite.db.prepare(`
    INSERT INTO "project_configs" ("projectID", "config")
    VALUES (?, ?)
  `).run("project-main", JSON.stringify({
    selected_side_chat_prompt_preset: "side-chat",
    prompt_overrides: {
      "side-chat": "remove",
      "system-default": "keep",
    },
    custom_prompt_presets: {
      "side-chat": { content: "remove" },
      custom: { content: "keep" },
    },
    untouched: true,
  }))
}

function markArchivedSnapshotKind(sessionID: string, kind: "main" | "side-chat") {
  const row = Sqlite.db
    .prepare(`SELECT "snapshot" FROM "archived_sessions" WHERE "sessionID" = ?`)
    .get(sessionID) as { snapshot: string }
  const snapshot = JSON.parse(row.snapshot) as { session: Record<string, unknown> }
  snapshot.session.kind = kind
  Sqlite.db
    .prepare(`UPDATE "archived_sessions" SET "snapshot" = ? WHERE "sessionID" = ?`)
    .run(JSON.stringify(snapshot), sessionID)
}

test("legacy side chat migration is destructive, strict-schema safe, retryable, and idempotent", async () => {
  const root = await mkdtemp(join(tmpdir(), "anybox-legacy-side-chat-migration-"))
  const promptRoot = join(root, "prompts")
  const artifactSessionsRoot = join(root, "state", "sessions")
  const freshDatabaseFile = join(root, "fresh.db")
  const legacyDatabaseFile = join(root, "legacy.db")

  try {
    Sqlite.setDatabaseFile(freshDatabaseFile)
    ensureLegacySessionCleanup({ artifactSessionsRoot, promptRoot })
    expect(Session.listByProject("fresh-project")).toEqual([])
    expect(tableColumns("sessions")).not.toContain("kind")
    expect(tableExists("side_chat_links")).toBe(false)
    Sqlite.closeDatabase()

    Sqlite.setDatabaseFile(legacyDatabaseFile)
    const main = await Session.createSession({
      directory: root,
      projectID: "project-main",
      title: "Main",
    })
    const byKind = await Session.createSession({
      directory: root,
      projectID: "project-main",
      title: "Legacy by kind",
    })
    const byLink = await Session.createSession({
      directory: root,
      projectID: "project-main",
      title: "Legacy by link",
    })
    const archivedLegacy = await Session.createSession({
      directory: root,
      projectID: "project-main",
      title: "Archived legacy",
    })
    const archivedMain = await Session.createSession({
      directory: root,
      projectID: "project-main",
      title: "Archived main",
    })

    addSessionRecords(byKind.id, "project-main")
    addSessionRecords(byLink.id, "project-main")
    addSessionRecords(archivedLegacy.id, "project-main")
    addSessionRecords(archivedMain.id, "project-main")
    expect(Session.archiveSession(archivedLegacy.id)?.sessionID).toBe(archivedLegacy.id)
    expect(Session.archiveSession(archivedMain.id)?.sessionID).toBe(archivedMain.id)

    Sqlite.db.run(`ALTER TABLE "sessions" ADD COLUMN "kind" TEXT`)
    Sqlite.db.prepare(`UPDATE "sessions" SET "kind" = 'main'`).run()
    Sqlite.db.prepare(`UPDATE "sessions" SET "kind" = 'side-chat' WHERE "id" = ?`).run(byKind.id)
    markArchivedSnapshotKind(archivedLegacy.id, "side-chat")
    markArchivedSnapshotKind(archivedMain.id, "main")

    const orphanLinkSessionID = "session_orphan_legacy_link"
    addLegacyAuxiliaryTables({
      archivedSessionID: archivedLegacy.id,
      kindSessionID: byKind.id,
      linkSessionID: byLink.id,
      mainSessionID: main.id,
      orphanLinkSessionID,
    })

    for (const sessionID of [byKind.id, byLink.id, archivedLegacy.id, orphanLinkSessionID]) {
      const directory = join(artifactSessionsRoot, sessionID)
      await mkdir(join(directory, "tool-results"), { recursive: true })
      await mkdir(join(directory, "assets", "images"), { recursive: true })
      await writeFile(join(directory, "tool-results", "result.json"), "{}")
      await writeFile(join(directory, "assets", "images", "image.png"), "legacy")
    }
    await mkdir(join(promptRoot, "bundled"), { recursive: true })
    await mkdir(join(promptRoot, "custom"), { recursive: true })
    await writeFile(join(promptRoot, "bundled", "side-chat.md"), "legacy bundled prompt")
    await writeFile(join(promptRoot, "custom", "legacy.md"), "---\nid: side-chat\n---\nlegacy custom prompt")
    await writeFile(join(promptRoot, "custom", "keep.md"), "---\nid: keep\n---\nkeep")

    Sqlite.closeDatabase()
    Sqlite.setDatabaseFile(legacyDatabaseFile)

    const blockedDirectory = resolve(artifactSessionsRoot, byKind.id)
    let failBlockedDirectoryOnce = true
    ensureLegacySessionCleanup({
      artifactSessionsRoot,
      promptRoot,
      removeArtifactDirectory(directory) {
        if (resolve(directory) === blockedDirectory && failBlockedDirectoryOnce) {
          failBlockedDirectoryOnce = false
          throw new Error("injected sharing violation")
        }
        rmSync(directory, { recursive: true, force: true })
      },
    })

    expect(tableExists("side_chat_links")).toBe(false)
    expect(tableColumns("sessions")).not.toContain("kind")
    expect(existsSync(blockedDirectory)).toBe(true)
    expect(rowCount("storage_maintenance_meta", "id", "legacy-side-chat-v1")).toBe(1)

    ensureLegacySessionCleanup({ artifactSessionsRoot, promptRoot })
    expect(existsSync(blockedDirectory)).toBe(false)
    expect(rowCount("storage_maintenance_meta", "id", "legacy-side-chat-v1")).toBe(0)

    expect(Session.listByProject("project-main").map((session) => session.id)).toEqual([main.id])
    expect(Session.listArchivedSessions().map((session) => session.sessionID)).toEqual([archivedMain.id])
    expect((Session.readArchivedSession(archivedMain.id)?.snapshot.session as Record<string, unknown>).kind).toBeUndefined()

    for (const tableName of [
      "sessions",
      "turns",
      "messages",
      "parts",
      "session_tasks",
      "session_events",
      "permission_requests",
      "permission_audits",
      "environment_runs",
      "archived_sessions",
      "automation_runs",
    ]) {
      const idColumn = tableName === "sessions" ? "id" : "sessionID"
      expect(rowCount(tableName, idColumn, byKind.id)).toBe(0)
      expect(rowCount(tableName, idColumn, byLink.id)).toBe(0)
      expect(rowCount(tableName, idColumn, archivedLegacy.id)).toBe(0)
    }
    expect(rowCount("permission_requests", "sessionID", main.id)).toBe(1)
    expect(rowCount("permission_audits", "sessionID", main.id)).toBe(1)
    expect(rowCount("environment_runs", "sessionID", main.id)).toBe(1)
    expect(rowCount("subtasks", "id", "subtask-main")).toBe(1)
    expect(rowCount("subtasks", "id", "subtask-parent-legacy")).toBe(0)
    expect(rowCount("subtasks", "id", "subtask-child-legacy")).toBe(0)
    expect(rowCount("automations", "id", "automation-legacy")).toBe(0)
    expect(rowCount("automations", "id", "automation-main")).toBe(1)
    expect(rowCount("automation_runs", "id", "automation-run-legacy")).toBe(0)
    expect(rowCount("automation_runs", "id", "automation-run-orphan")).toBe(0)
    expect(rowCount("automation_runs", "id", "automation-run-main")).toBe(1)

    const configRow = Sqlite.db
      .prepare(`SELECT "config" FROM "project_configs" WHERE "projectID" = ?`)
      .get("project-main") as { config: string }
    const config = JSON.parse(configRow.config) as Record<string, unknown>
    expect(config.selected_side_chat_prompt_preset).toBeUndefined()
    expect(config.prompt_overrides).toEqual({ "system-default": "keep" })
    expect(config.custom_prompt_presets).toEqual({ custom: { content: "keep" } })
    expect(config.untouched).toBe(true)

    expect(existsSync(join(promptRoot, "bundled", "side-chat.md"))).toBe(false)
    expect(existsSync(join(promptRoot, "custom", "legacy.md"))).toBe(false)
    expect(await readFile(join(promptRoot, "custom", "keep.md"), "utf8")).toContain("id: keep")

    ensureLegacySessionCleanup({ artifactSessionsRoot, promptRoot })
    expect(Session.listByProject("project-main").map((session) => session.id)).toEqual([main.id])
    expect(Session.listArchivedSessions().map((session) => session.sessionID)).toEqual([archivedMain.id])
  } finally {
    Sqlite.closeDatabase()
    Sqlite.setDatabaseFile(undefined)
    await removeWithRetry(root)
  }
})
