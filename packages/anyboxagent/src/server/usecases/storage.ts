import { statSync } from "node:fs"
import type { DesktopStorageUsageSnapshot } from "@anybox/shared"
import * as Sqlite from "#database/Sqlite.ts"

type StorageUsageTableCategory = DesktopStorageUsageSnapshot["tables"][number]["category"]
type StorageUsageCategoryID = DesktopStorageUsageSnapshot["categories"][number]["id"]

const ACTIVE_SESSION_TABLES = new Set([
  "sessions",
  "turns",
  "messages",
  "parts",
  "session_events",
  "session_tasks",
  "side_chat_links",
])

const CATEGORY_LABELS: Record<StorageUsageCategoryID, string> = {
  archivedSessions: "Archived sessions",
  activeSessions: "Active sessions",
  otherDatabase: "Other database",
  sqliteOverhead: "SQLite overhead",
}

function quoteIdentifier(identifier: string) {
  return `"${identifier.replaceAll('"', '""')}"`
}

function asNumber(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, value)
  if (typeof value === "bigint") return Number(value)
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback
}

function statSize(filePath: string) {
  try {
    return statSync(filePath).size
  } catch {
    return 0
  }
}

function readPragmaNumber(name: "page_size" | "page_count" | "freelist_count") {
  try {
    const row = Sqlite.db.query(`PRAGMA ${name};`).get() as Record<string, unknown> | null
    if (!row) return null
    return asNumber(row[name] ?? Object.values(row)[0], 0)
  } catch {
    return null
  }
}

function listUserTables() {
  const rows = Sqlite.db
    .query(
      `
      SELECT name
      FROM sqlite_master
      WHERE type = 'table'
        AND name NOT LIKE 'sqlite_%'
      ORDER BY name ASC
      `,
    )
    .all() as Array<{ name?: string }>

  return rows.map((row) => row.name).filter((name): name is string => Boolean(name))
}

function tableColumns(tableName: string) {
  const rows = Sqlite.db
    .query(`PRAGMA table_info(${quoteIdentifier(tableName)});`)
    .all() as Array<{ name?: string }>

  return rows.map((row) => row.name).filter((name): name is string => Boolean(name))
}

function rowLengthExpression(columns: string[]) {
  if (columns.length === 0) return "0"
  return columns
    .map((column) => `COALESCE(length(CAST(${quoteIdentifier(column)} AS TEXT)), 0)`)
    .join(" + ")
}

function estimateTable(tableName: string) {
  const columns = tableColumns(tableName)
  const lengthExpression = rowLengthExpression(columns)
  const row = Sqlite.db
    .query(
      `
      SELECT
        COUNT(*) AS rowCount,
        COALESCE(SUM(${lengthExpression}), 0) AS estimatedBytes
      FROM ${quoteIdentifier(tableName)}
      `,
    )
    .get() as { rowCount?: unknown; estimatedBytes?: unknown } | null

  return {
    rowCount: asNumber(row?.rowCount),
    estimatedBytes: asNumber(row?.estimatedBytes),
  }
}

function classifyTable(tableName: string): StorageUsageTableCategory {
  if (tableName === "archived_sessions") return "archivedSessions"
  if (ACTIVE_SESSION_TABLES.has(tableName)) return "activeSessions"
  return "otherDatabase"
}

function readProjectNames(projectIDs: string[]) {
  const uniqueProjectIDs = Array.from(new Set(projectIDs.map((id) => id.trim()).filter(Boolean)))
  const names = new Map<string, string | null>()
  if (uniqueProjectIDs.length === 0 || !Sqlite.tableExists("projects")) return names

  const placeholders = uniqueProjectIDs.map(() => "?").join(", ")
  const rows = Sqlite.db
    .query(`SELECT id, name FROM projects WHERE id IN (${placeholders})`)
    .all(...uniqueProjectIDs) as Array<{ id?: string; name?: string | null }>

  for (const row of rows) {
    if (!row.id) continue
    names.set(row.id, row.name ?? null)
  }

  return names
}

function listArchivedSessionUsage() {
  if (!Sqlite.tableExists("archived_sessions")) return []

  const rows = Sqlite.db
    .query(
      `
      SELECT
        sessionID AS id,
        projectID,
        directory,
        title,
        updatedAt AS updated,
        archivedAt,
        messageCount,
        eventCount,
        ${rowLengthExpression([
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
          "snapshot",
        ])} AS estimatedBytes
      FROM archived_sessions
      ORDER BY estimatedBytes DESC, archivedAt DESC
      `,
    )
    .all() as Array<{
      id?: string
      projectID?: string
      directory?: string
      title?: string
      updated?: unknown
      archivedAt?: unknown
      messageCount?: unknown
      eventCount?: unknown
      estimatedBytes?: unknown
    }>

  const projectNames = readProjectNames(rows.map((row) => row.projectID ?? ""))

  return rows.map((row) => ({
    id: row.id ?? "",
    title: row.title ?? "",
    projectID: row.projectID ?? "",
    projectName: projectNames.get(row.projectID ?? "") ?? null,
    directory: row.directory ?? "",
    updated: asNumber(row.updated),
    archivedAt: asNumber(row.archivedAt),
    messageCount: asNumber(row.messageCount),
    eventCount: asNumber(row.eventCount),
    estimatedBytes: asNumber(row.estimatedBytes),
  }))
}

export function getStorageUsage(): DesktopStorageUsageSnapshot {
  const databasePath = Sqlite.getDatabaseFile()
  // Ensure the connection is initialized before reading PRAGMA and file stats.
  Sqlite.getDatabase()

  const mainBytes = statSize(databasePath)
  const walBytes = statSize(`${databasePath}-wal`)
  const shmBytes = statSize(`${databasePath}-shm`)
  const totalBytes = mainBytes + walBytes + shmBytes
  const pageSize = readPragmaNumber("page_size")
  const pageCount = readPragmaNumber("page_count")
  const freelistCount = readPragmaNumber("freelist_count")
  const freelistBytes = pageSize === null || freelistCount === null ? null : pageSize * freelistCount

  const tables = listUserTables().map((name) => ({
    name,
    category: classifyTable(name),
    ...estimateTable(name),
  }))

  const categoryBytes: Record<StorageUsageTableCategory, number> = {
    archivedSessions: 0,
    activeSessions: 0,
    otherDatabase: 0,
  }
  const categoryCounts: Record<StorageUsageTableCategory, number> = {
    archivedSessions: 0,
    activeSessions: 0,
    otherDatabase: 0,
  }

  for (const table of tables) {
    categoryBytes[table.category] += table.estimatedBytes
    categoryCounts[table.category] += table.rowCount
  }

  const archivedTable = tables.find((table) => table.name === "archived_sessions")
  const sessionsTable = tables.find((table) => table.name === "sessions")
  const estimatedContentBytes = tables.reduce((total, table) => total + table.estimatedBytes, 0)
  const sqliteOverheadBytes = Math.max(0, totalBytes - estimatedContentBytes)

  return {
    generatedAt: Date.now(),
    database: {
      path: databasePath,
      totalBytes,
      mainBytes,
      walBytes,
      shmBytes,
      pageSize,
      pageCount,
      freelistBytes,
    },
    categories: [
      {
        id: "archivedSessions",
        label: CATEGORY_LABELS.archivedSessions,
        bytes: categoryBytes.archivedSessions,
        approximate: true,
        count: archivedTable?.rowCount ?? 0,
      },
      {
        id: "activeSessions",
        label: CATEGORY_LABELS.activeSessions,
        bytes: categoryBytes.activeSessions,
        approximate: true,
        count: sessionsTable?.rowCount ?? 0,
      },
      {
        id: "otherDatabase",
        label: CATEGORY_LABELS.otherDatabase,
        bytes: categoryBytes.otherDatabase,
        approximate: true,
        count: categoryCounts.otherDatabase,
      },
      {
        id: "sqliteOverhead",
        label: CATEGORY_LABELS.sqliteOverhead,
        bytes: sqliteOverheadBytes,
        approximate: true,
      },
    ],
    archivedSessions: listArchivedSessionUsage(),
    tables: tables.sort((a, b) => b.estimatedBytes - a.estimatedBytes || a.name.localeCompare(b.name)),
  }
}
