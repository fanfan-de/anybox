import { createHash } from "node:crypto"
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import matter from "gray-matter"
import { getProcessEnvValue } from "#env/compat.ts"
import * as Global from "#global/global.ts"
import * as db from "#database/Sqlite.ts"

const LEGACY_SESSION_KIND = "side-chat"
const LEGACY_PROMPT_PRESET_ID = "side-chat"
const CLEANUP_META_KEY = "legacy-side-chat-v1"
const SAFE_SEGMENT_PATTERN = /^[A-Za-z0-9._-]+$/

type SQLiteRow = Record<string, unknown>

export interface LegacySideChatMigrationOptions {
  artifactSessionsRoot?: string
  promptRoot?: string
  removeArtifactDirectory?: (directory: string) => void
}

let migratedGeneration = -1

function tableColumns(tableName: string) {
  if (!db.tableExists(tableName)) return new Set<string>()
  const rows = db.db.prepare(`PRAGMA table_info("${tableName}")`).all() as Array<{ name?: string }>
  return new Set(rows.flatMap((row) => typeof row.name === "string" ? [row.name] : []))
}

function tableHasColumn(tableName: string, columnName: string) {
  return tableColumns(tableName).has(columnName)
}

function readString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  if (typeof value !== "string") return undefined
  try {
    const parsed = JSON.parse(value)
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined
  } catch {
    return undefined
  }
}

function collectLegacySessionIDs() {
  const sessionIDs = new Set<string>()

  if (tableHasColumn("side_chat_links", "sessionID")) {
    const rows = db.db.prepare(`SELECT "sessionID" FROM "side_chat_links"`).all() as SQLiteRow[]
    for (const row of rows) {
      const sessionID = readString(row.sessionID)
      if (sessionID) sessionIDs.add(sessionID)
    }
  }

  if (tableHasColumn("sessions", "id") && tableHasColumn("sessions", "kind")) {
    const rows = db.db
      .prepare(`SELECT "id" FROM "sessions" WHERE "kind" = ?`)
      .all(LEGACY_SESSION_KIND) as SQLiteRow[]
    for (const row of rows) {
      const sessionID = readString(row.id)
      if (sessionID) sessionIDs.add(sessionID)
    }
  }

  if (tableHasColumn("archived_sessions", "sessionID") && tableHasColumn("archived_sessions", "snapshot")) {
    const rows = db.db
      .prepare(`SELECT "sessionID", "snapshot" FROM "archived_sessions"`)
      .all() as SQLiteRow[]
    for (const row of rows) {
      const snapshot = readRecord(row.snapshot)
      const session = readRecord(snapshot?.session)
      if (session?.kind !== LEGACY_SESSION_KIND) continue
      const sessionID = readString(row.sessionID)
      if (sessionID) sessionIDs.add(sessionID)
    }
  }

  return sessionIDs
}

function collectLegacyAutomationIDs(sessionIDs: Set<string>) {
  const automationIDs = new Set<string>()
  if (sessionIDs.size === 0 || !tableHasColumn("automations", "id") || !tableHasColumn("automations", "scope")) {
    return automationIDs
  }

  const hasKind = tableHasColumn("automations", "kind")
  const rows = db.db
    .prepare(`SELECT "id", "scope"${hasKind ? `, "kind"` : ""} FROM "automations"`)
    .all() as SQLiteRow[]
  for (const row of rows) {
    if (hasKind && row.kind !== "thread") continue
    const scope = readRecord(row.scope)
    const sessionID = readString(scope?.sessionID)
    const automationID = readString(row.id)
    if (automationID && sessionID && sessionIDs.has(sessionID)) {
      automationIDs.add(automationID)
    }
  }
  return automationIDs
}

function rewriteProjectConfigs() {
  if (!tableHasColumn("project_configs", "projectID") || !tableHasColumn("project_configs", "config")) return
  const rows = db.db.prepare(`SELECT "projectID", "config" FROM "project_configs"`).all() as SQLiteRow[]
  const update = db.db.prepare(`UPDATE "project_configs" SET "config" = ? WHERE "projectID" = ?`)

  for (const row of rows) {
    const projectID = readString(row.projectID)
    const config = readRecord(row.config)
    if (!projectID || !config) continue

    let changed = false
    if (Object.prototype.hasOwnProperty.call(config, "selected_side_chat_prompt_preset")) {
      delete config.selected_side_chat_prompt_preset
      changed = true
    }

    for (const key of ["prompt_overrides", "custom_prompt_presets"] as const) {
      const entries = readRecord(config[key])
      if (!entries || !Object.prototype.hasOwnProperty.call(entries, LEGACY_PROMPT_PRESET_ID)) continue
      delete entries[LEGACY_PROMPT_PRESET_ID]
      if (Object.keys(entries).length === 0) delete config[key]
      else config[key] = entries
      changed = true
    }

    if (changed) update.run(JSON.stringify(config), projectID)
  }
}

function rewriteSurvivingArchivedSnapshots(sessionIDs: Set<string>) {
  if (!tableHasColumn("archived_sessions", "sessionID") || !tableHasColumn("archived_sessions", "snapshot")) return
  const rows = db.db
    .prepare(`SELECT "sessionID", "snapshot" FROM "archived_sessions"`)
    .all() as SQLiteRow[]
  const update = db.db.prepare(`UPDATE "archived_sessions" SET "snapshot" = ? WHERE "sessionID" = ?`)

  for (const row of rows) {
    const sessionID = readString(row.sessionID)
    if (!sessionID || sessionIDs.has(sessionID)) continue
    const snapshot = readRecord(row.snapshot)
    const session = readRecord(snapshot?.session)
    if (!snapshot || !session || !Object.prototype.hasOwnProperty.call(session, "kind")) continue
    delete session.kind
    snapshot.session = session
    update.run(JSON.stringify(snapshot), sessionID)
  }
}

function ensureCleanupMetaTable() {
  db.db.run(`
    CREATE TABLE IF NOT EXISTS "storage_maintenance_meta" (
      "id" TEXT PRIMARY KEY,
      "data" TEXT NOT NULL,
      "updatedAt" INTEGER NOT NULL
    )
  `)
}

function readPendingArtifactSessionIDs() {
  ensureCleanupMetaTable()
  const row = db.db
    .prepare(`SELECT "data" FROM "storage_maintenance_meta" WHERE "id" = ?`)
    .get(CLEANUP_META_KEY) as { data?: string } | null
  const record = readRecord(row?.data)
  return new Set(
    Array.isArray(record?.sessionIDs)
      ? record.sessionIDs.filter((value): value is string => typeof value === "string" && value.length > 0)
      : [],
  )
}

function writePendingArtifactSessionIDs(sessionIDs: Set<string>) {
  ensureCleanupMetaTable()
  if (sessionIDs.size === 0) {
    db.db.prepare(`DELETE FROM "storage_maintenance_meta" WHERE "id" = ?`).run(CLEANUP_META_KEY)
    return
  }
  db.db.prepare(`
    INSERT INTO "storage_maintenance_meta" ("id", "data", "updatedAt")
    VALUES (?, ?, ?)
    ON CONFLICT("id") DO UPDATE SET "data" = excluded."data", "updatedAt" = excluded."updatedAt"
  `).run(
    CLEANUP_META_KEY,
    JSON.stringify({ sessionIDs: [...sessionIDs].sort() }),
    Date.now(),
  )
}

function deleteRowsBySessionID(tableName: string, sessionIDs: Set<string>) {
  if (!tableHasColumn(tableName, "sessionID")) return
  const statement = db.db.prepare(`DELETE FROM "${tableName}" WHERE "sessionID" = ?`)
  for (const sessionID of sessionIDs) statement.run(sessionID)
}

function purgeLegacyDatabaseRecords(sessionIDs: Set<string>, automationIDs: Set<string>) {
  const commit = db.db.transaction(() => {
    const pendingArtifactSessionIDs = readPendingArtifactSessionIDs()
    for (const sessionID of sessionIDs) pendingArtifactSessionIDs.add(sessionID)
    writePendingArtifactSessionIDs(pendingArtifactSessionIDs)

    rewriteProjectConfigs()
    rewriteSurvivingArchivedSnapshots(sessionIDs)

    if (tableHasColumn("session_tasks", "childSessionID")) {
      const clearChild = db.db.prepare(`UPDATE "session_tasks" SET "childSessionID" = NULL WHERE "childSessionID" = ?`)
      for (const sessionID of sessionIDs) clearChild.run(sessionID)
    }

    for (const tableName of [
      "parts",
      "messages",
      "turns",
      "session_tasks",
      "session_events",
      "permission_requests",
      "permission_audits",
      "environment_runs",
      "automation_runs",
      "archived_sessions",
    ]) {
      deleteRowsBySessionID(tableName, sessionIDs)
    }

    if (tableHasColumn("subtasks", "parentSessionID") || tableHasColumn("subtasks", "childSessionID")) {
      const conditions = [
        tableHasColumn("subtasks", "parentSessionID") ? `"parentSessionID" = ?` : null,
        tableHasColumn("subtasks", "childSessionID") ? `"childSessionID" = ?` : null,
      ].filter((value): value is string => Boolean(value))
      const statement = db.db.prepare(`DELETE FROM "subtasks" WHERE ${conditions.join(" OR ")}`)
      for (const sessionID of sessionIDs) {
        statement.run(...conditions.map(() => sessionID))
      }
    }

    if (automationIDs.size > 0 && tableHasColumn("automation_runs", "automationID")) {
      const deleteRuns = db.db.prepare(`DELETE FROM "automation_runs" WHERE "automationID" = ?`)
      for (const automationID of automationIDs) deleteRuns.run(automationID)
    }
    if (automationIDs.size > 0 && tableHasColumn("automations", "id")) {
      const deleteAutomation = db.db.prepare(`DELETE FROM "automations" WHERE "id" = ?`)
      for (const automationID of automationIDs) deleteAutomation.run(automationID)
    }

    if (tableHasColumn("sessions", "id")) {
      const deleteSession = db.db.prepare(`DELETE FROM "sessions" WHERE "id" = ?`)
      for (const sessionID of sessionIDs) deleteSession.run(sessionID)
    }

    if (db.tableExists("side_chat_links")) {
      db.db.run(`DROP TABLE "side_chat_links"`)
    }

    if (tableHasColumn("sessions", "kind")) {
      db.db.run(`ALTER TABLE "sessions" DROP COLUMN "kind"`)
    }
  })

  commit()
}

function safeFileSegment(value: string) {
  if (SAFE_SEGMENT_PATTERN.test(value) && value !== "." && value !== "..") return value
  return `tool_${createHash("sha256").update(value).digest("hex").slice(0, 16)}`
}

function retryPendingArtifactCleanup(options: LegacySideChatMigrationOptions = {}) {
  const pending = readPendingArtifactSessionIDs()
  if (pending.size === 0) return

  const sessionsRoot = path.resolve(options.artifactSessionsRoot ?? path.join(Global.Path.state, "sessions"))
  const removeArtifactDirectory = options.removeArtifactDirectory
    ?? ((directory: string) => rmSync(directory, { recursive: true, force: true }))
  for (const sessionID of [...pending]) {
    const sessionDirectory = path.resolve(sessionsRoot, safeFileSegment(sessionID))
    const relative = path.relative(sessionsRoot, sessionDirectory)
    if (relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      continue
    }
    try {
      removeArtifactDirectory(sessionDirectory)
      pending.delete(sessionID)
    } catch {
      // The persisted cleanup record keeps this directory retryable on the next startup.
    }
  }
  writePendingArtifactSessionIDs(pending)
}

function promptRoot() {
  const configured = getProcessEnvValue("ANYBOX_PROMPTS_ROOT")?.trim()
  return path.resolve(configured || path.join(homedir(), ".anybox", "prompts"))
}

function removeLegacyCustomPromptFiles(directory: string, root: string) {
  if (!existsSync(directory)) return
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const candidate = path.resolve(directory, entry.name)
    const relative = path.relative(root, candidate)
    if (relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      continue
    }
    if (entry.isDirectory()) {
      removeLegacyCustomPromptFiles(candidate, root)
      continue
    }
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue
    try {
      const parsed = matter(readFileSync(candidate, "utf8"))
      if (parsed.data?.id === LEGACY_PROMPT_PRESET_ID) {
        rmSync(candidate, { force: true })
      }
    } catch {
      // Invalid or locked files remain untouched and will be retried on the next startup.
    }
  }
}

function cleanupLegacySideChatPromptFiles(rootOverride?: string) {
  const root = path.resolve(rootOverride ?? promptRoot())
  const bundledFile = path.resolve(root, "bundled", `${LEGACY_PROMPT_PRESET_ID}.md`)
  const relative = path.relative(root, bundledFile)
  if (relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) {
    try {
      rmSync(bundledFile, { force: true })
    } catch {
      // A locked file remains inert and will be retried on the next startup.
    }
  }
  removeLegacyCustomPromptFiles(path.resolve(root, "custom"), root)
}

export function ensureLegacySessionCleanup(options: LegacySideChatMigrationOptions = {}) {
  const generation = db.getDatabaseGeneration()
  if (migratedGeneration === generation && generation > 0) {
    if (Object.keys(options).length > 0) {
      retryPendingArtifactCleanup(options)
      cleanupLegacySideChatPromptFiles(options.promptRoot)
    }
    return
  }

  const sessionIDs = collectLegacySessionIDs()
  const automationIDs = collectLegacyAutomationIDs(sessionIDs)
  purgeLegacyDatabaseRecords(sessionIDs, automationIDs)
  retryPendingArtifactCleanup(options)
  cleanupLegacySideChatPromptFiles(options.promptRoot)
  migratedGeneration = db.getDatabaseGeneration()
}
