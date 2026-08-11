import { randomUUID } from "node:crypto"
import { appendFile, copyFile, mkdir, readFile, readdir, realpath, stat } from "node:fs/promises"
import path from "node:path"
import { ApiError } from "#server/error.ts"
import * as Lock from "#util/lock.ts"
import { atomicWriteFile, atomicWriteJson, readJsonFile } from "../storage/atomic.ts"

const MIGRATION_ID = "runtime-v1"
const PROJECT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const MAX_JSON_FILES = 50_000
const MAX_JSON_BYTES = 256 * 1024 * 1024
const PROJECT_DATA_DIRECTORIES = ["assets", "references", "prompts", "generated", "renders", "exports"]
let failAfterWritesForTest: number | undefined

type JsonRecord = Record<string, unknown>

type MigrationFile = {
  absolutePath: string
  relativePath: string
  rewrites: number
  value: unknown
}

type MigrationMarker = {
  schemaVersion: 1
  migration: typeof MIGRATION_ID
  status: "in_progress" | "completed" | "rolled_back"
  migrationID: string
  sourceProjectIDs: string[]
  targetProjectID: string
  backupDirectory: string
  files: string[]
  unresolvedAssetReferences: UnresolvedAssetReference[]
  startedAt: string
  completedAt?: string
  eventAppended?: boolean
  error?: string
}

type UnresolvedAssetReference = {
  file: string
  path: string
  assetID?: string
  legacyScope: "personal" | "global"
  status: "relink-required"
}

export type ProjectMigrationStatus = {
  schemaVersion: 1
  migration: typeof MIGRATION_ID
  state: "ready" | "required" | "completed" | "blocked"
  projectID: string
  sourceProjectIDs: string[]
  files: string[]
  issues: Array<{ path: string; code: "INVALID_JSON" | "INVALID_PROJECT_METADATA"; message: string }>
  unresolvedAssetReferences: UnresolvedAssetReference[]
  marker?: MigrationMarker
}

function cinemaRoot(root: string) {
  return path.join(root, ".anybox-cinema")
}

function markerPath(root: string) {
  return path.join(cinemaRoot(root), "migrations", `${MIGRATION_ID}.json`)
}

function backupRoot(root: string) {
  return path.join(cinemaRoot(root), "backups")
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function validProjectID(value: unknown): value is string {
  return typeof value === "string" && PROJECT_ID.test(value)
}

function safeRelative(root: string, file: string) {
  const relative = path.relative(root, file)
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new ApiError(400, "PROJECT_MIGRATION_INVALID_PATH", "Cinema migration encountered a path outside the project.")
  }
  return relative
}

async function collectJsonFiles(root: string) {
  const candidates = [cinemaRoot(root), ...PROJECT_DATA_DIRECTORIES.map((name) => path.join(root, name))]
  const files: string[] = []
  let totalBytes = 0

  async function visit(directory: string) {
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const absolute = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        if (
          directory === cinemaRoot(root) &&
          (entry.name === "backups" || entry.name === "migrations" || entry.name === "migration-backups")
        ) continue
        await visit(absolute)
        continue
      }
      if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".json") continue
      const info = await stat(absolute)
      totalBytes += info.size
      files.push(absolute)
      if (files.length > MAX_JSON_FILES || totalBytes > MAX_JSON_BYTES) {
        throw new ApiError(413, "PROJECT_MIGRATION_TOO_LARGE", "Cinema project metadata exceeds the migration safety limit.")
      }
    }
  }

  for (const candidate of candidates) await visit(candidate)
  return [...new Set(files)].sort()
}

function rewriteProjectIDs(value: unknown, targetProjectID: string): {
  value: unknown
  rewrites: number
  sources: string[]
  unresolved: Array<Omit<UnresolvedAssetReference, "file">>
} {
  const sources = new Set<string>()
  const unresolved = new Map<string, Omit<UnresolvedAssetReference, "file">>()

  function visit(current: unknown, pointer = ""): { value: unknown; rewrites: number } {
    if (Array.isArray(current)) {
      let rewrites = 0
      const next = current.map((item, index) => {
        const changed = visit(item, `${pointer}/${index}`)
        rewrites += changed.rewrites
        return changed.value
      })
      return { value: rewrites ? next : current, rewrites }
    }
    if (!isRecord(current)) return { value: current, rewrites: 0 }

    const scope = isRecord(current.scope) ? current.scope : undefined
    if (
      (scope?.type === "personal" || scope?.type === "global")
      && (typeof current.assetID === "string" || pointer.toLowerCase().includes("assetref"))
    ) {
      const legacyScope = scope.type
      unresolved.set(pointer || "/", {
        path: pointer || "/",
        ...(typeof current.assetID === "string" ? { assetID: current.assetID } : {}),
        legacyScope,
        status: "relink-required",
      })
    }

    let rewrites = 0
    const next: JsonRecord = { ...current }
    for (const [childKey, child] of Object.entries(current)) {
      if ((childKey === "projectID" || childKey === "projectId") && child !== targetProjectID) {
        if (typeof child === "string" && child.trim()) sources.add(child)
        next[childKey] = targetProjectID
        rewrites += 1
        continue
      }
      const escaped = childKey.replace(/~/g, "~0").replace(/\//g, "~1")
      const changed = visit(child, `${pointer}/${escaped}`)
      next[childKey] = changed.value
      rewrites += changed.rewrites
    }
    return { value: rewrites ? next : current, rewrites }
  }

  const rewritten = visit(value)
  return { ...rewritten, sources: [...sources], unresolved: [...unresolved.values()] }
}

async function inspectFiles(root: string, targetProjectID: string) {
  const migrationFiles: MigrationFile[] = []
  const sourceProjectIDs = new Set<string>()
  const issues: ProjectMigrationStatus["issues"] = []
  const unresolvedAssetReferences: UnresolvedAssetReference[] = []
  const projectFile = path.join(cinemaRoot(root), "project.json")

  for (const absolutePath of await collectJsonFiles(root)) {
    const relativePath = safeRelative(root, absolutePath)
    let value: unknown
    try {
      value = JSON.parse(await readFile(absolutePath, "utf8"))
    } catch (error) {
      issues.push({
        path: relativePath,
        code: "INVALID_JSON",
        message: error instanceof Error ? error.message : "JSON parsing failed.",
      })
      continue
    }

    const rewritten = rewriteProjectIDs(value, targetProjectID)
    let next = rewritten.value
    let rewrites = rewritten.rewrites
    for (const source of rewritten.sources) sourceProjectIDs.add(source)
    unresolvedAssetReferences.push(...rewritten.unresolved.map((reference) => ({
      file: relativePath,
      ...reference,
    })))

    if (path.resolve(absolutePath) === path.resolve(projectFile)) {
      if (!isRecord(next)) {
        issues.push({ path: relativePath, code: "INVALID_PROJECT_METADATA", message: "project.json must contain an object." })
        continue
      }
      let projectRecord = next
      if (validProjectID(projectRecord.id) && projectRecord.id !== targetProjectID) sourceProjectIDs.add(projectRecord.id)
      if (projectRecord.id !== targetProjectID) {
        projectRecord = { ...projectRecord, id: targetProjectID, updatedAt: new Date().toISOString() }
        rewrites += 1
      }
      if (projectRecord.runtimeVersion !== 1) {
        projectRecord = { ...projectRecord, runtimeVersion: 1, updatedAt: new Date().toISOString() }
        rewrites += 1
      }
      next = projectRecord
    }

    if (rewrites > 0) migrationFiles.push({ absolutePath, relativePath, rewrites, value: next })
  }

  return {
    migrationFiles,
    sourceProjectIDs: [...sourceProjectIDs].filter((id) => id !== targetProjectID).sort(),
    issues,
    unresolvedAssetReferences,
  }
}

function isSafeBackupDirectory(root: string, directory: string) {
  const expectedRoot = path.resolve(backupRoot(root))
  const resolved = path.resolve(directory)
  return resolved.startsWith(`${expectedRoot}${path.sep}`)
}

async function restoreFromMarker(root: string, marker: MigrationMarker) {
  if (!isSafeBackupDirectory(root, marker.backupDirectory)) {
    throw new ApiError(500, "PROJECT_MIGRATION_ROLLBACK_FAILED", "Cinema migration backup path is unsafe.")
  }
  for (const relativePath of marker.files) {
    const destination = path.resolve(root, relativePath)
    const backup = path.resolve(marker.backupDirectory, relativePath)
    safeRelative(root, destination)
    safeRelative(marker.backupDirectory, backup)
    await atomicWriteFile(destination, await readFile(backup))
  }
}

async function recoverInterruptedMigration(root: string) {
  const marker = await readJsonFile<MigrationMarker>(markerPath(root)).catch(() => undefined)
  if (!marker || marker.migration !== MIGRATION_ID || marker.status !== "in_progress") return marker
  await restoreFromMarker(root, marker)
  const rolledBack: MigrationMarker = {
    ...marker,
    status: "rolled_back",
    completedAt: new Date().toISOString(),
    error: "Recovered and rolled back an interrupted Cinema runtime migration.",
  }
  await atomicWriteJson(markerPath(root), rolledBack)
  return rolledBack
}

function migrationMappingEvent(root: string, marker: MigrationMarker) {
  return {
    time: marker.completedAt ?? marker.startedAt,
    type: "project.runtime-migrated",
    actor: "cinema-runtime",
    message: `Migrated Cinema project metadata to '${marker.targetProjectID}'.`,
    data: {
      migrationID: marker.migrationID,
      fromProjectIDs: marker.sourceProjectIDs,
      projectID: marker.targetProjectID,
      unresolvedAssetReferences: marker.unresolvedAssetReferences,
      backupDirectory: path.relative(root, marker.backupDirectory),
    },
  }
}

function isMigrationMappingEvent(line: string, migrationID: string) {
  const marker = `\"migrationID\":\"${migrationID}\"`
  if (!line.includes(marker)) return false
  try {
    const event = JSON.parse(line) as unknown
    if (!isRecord(event)) return false
    if (event.migrationID === migrationID) return true
    return isRecord(event.data) && event.data.migrationID === migrationID
  } catch {
    // A partially written legacy mapping event should not keep the project
    // unreadable forever when its migration marker can reconstruct it.
    return true
  }
}

async function ensureMappingEvent(root: string, marker: MigrationMarker) {
  const eventsPath = path.join(cinemaRoot(root), "events.jsonl")
  const existing = await readFile(eventsPath, "utf8").catch(() => "")
  const canonicalEvent = migrationMappingEvent(root, marker)
  const canonicalLine = JSON.stringify(canonicalEvent)
  const lines = existing.split(/\r?\n/)
  const repaired: string[] = []
  let found = false
  let changed = false

  for (const line of lines) {
    if (!isMigrationMappingEvent(line, marker.migrationID)) {
      repaired.push(line)
      continue
    }
    if (!found) {
      repaired.push(canonicalLine)
      found = true
      changed ||= line !== canonicalLine
    } else {
      changed = true
    }
  }

  if (!found) {
    await appendFile(eventsPath, `${canonicalLine}\n`, "utf8")
  } else if (changed) {
    const content = repaired.join("\n")
    await atomicWriteFile(eventsPath, content.endsWith("\n") ? content : `${content}\n`)
  }
  if (!marker.eventAppended) {
    await atomicWriteJson(markerPath(root), { ...marker, eventAppended: true })
  }
}

export async function inspectProjectMigration(rootInput: string, targetProjectID: string): Promise<ProjectMigrationStatus> {
  const root = await realpath(rootInput)
  const marker = await recoverInterruptedMigration(root)
  if (marker?.status === "completed" && marker.targetProjectID === targetProjectID) {
    await ensureMappingEvent(root, marker)
  }
  const inspected = await inspectFiles(root, targetProjectID)
  const state = inspected.issues.length > 0
    ? "blocked"
    : inspected.migrationFiles.length > 0
      ? "required"
      : marker?.status === "completed" && marker.targetProjectID === targetProjectID
        ? "completed"
        : "ready"
  return {
    schemaVersion: 1,
    migration: MIGRATION_ID,
    state,
    projectID: targetProjectID,
    sourceProjectIDs: inspected.sourceProjectIDs,
    files: inspected.migrationFiles.map((item) => item.relativePath),
    issues: inspected.issues,
    unresolvedAssetReferences: inspected.unresolvedAssetReferences,
    ...(marker ? { marker } : {}),
  }
}

export async function migrateProject(rootInput: string, targetProjectID: string): Promise<ProjectMigrationStatus> {
  const root = await realpath(rootInput)
  using _lock = await Lock.write(`cinema-project-migration:${root}`)
  const recovered = await recoverInterruptedMigration(root)
  if (recovered?.status === "completed" && recovered.targetProjectID === targetProjectID) {
    await ensureMappingEvent(root, recovered)
  }
  const inspected = await inspectFiles(root, targetProjectID)
  if (inspected.issues.length > 0) {
    throw new ApiError(409, "PROJECT_MIGRATION_REQUIRED", "Cinema project migration is blocked by invalid metadata.", {
      projectID: targetProjectID,
      issues: inspected.issues,
    })
  }
  if (inspected.migrationFiles.length === 0) return await inspectProjectMigration(root, targetProjectID)

  const startedAt = new Date().toISOString()
  const timestamp = startedAt.replace(/[:.]/g, "-")
  const backupDirectory = path.join(backupRoot(root), `${MIGRATION_ID}-${timestamp}`)
  const marker: MigrationMarker = {
    schemaVersion: 1,
    migration: MIGRATION_ID,
    status: "in_progress",
    migrationID: `${MIGRATION_ID}_${randomUUID()}`,
    sourceProjectIDs: inspected.sourceProjectIDs,
    targetProjectID,
    backupDirectory,
    files: inspected.migrationFiles.map((item) => item.relativePath),
    unresolvedAssetReferences: inspected.unresolvedAssetReferences,
    startedAt,
  }

  await mkdir(backupDirectory, { recursive: true })
  for (const file of inspected.migrationFiles) {
    const backup = path.join(backupDirectory, file.relativePath)
    await mkdir(path.dirname(backup), { recursive: true })
    await copyFile(file.absolutePath, backup)
  }
  await atomicWriteJson(markerPath(root), marker)

  try {
    for (const file of inspected.migrationFiles) {
      await atomicWriteJson(file.absolutePath, file.value)
      if (failAfterWritesForTest !== undefined) {
        failAfterWritesForTest -= 1
        if (failAfterWritesForTest <= 0) {
          failAfterWritesForTest = undefined
          throw new Error("Synthetic Cinema project migration write failure.")
        }
      }
    }
    const completed: MigrationMarker = {
      ...marker,
      status: "completed",
      completedAt: new Date().toISOString(),
      eventAppended: false,
    }
    await atomicWriteJson(markerPath(root), completed)
    await ensureMappingEvent(root, completed)
  } catch (error) {
    await restoreFromMarker(root, marker)
    await atomicWriteJson(markerPath(root), {
      ...marker,
      status: "rolled_back",
      completedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
    } satisfies MigrationMarker)
    throw new ApiError(500, "PROJECT_MIGRATION_FAILED", "Cinema project migration failed and was rolled back.")
  }

  return await inspectProjectMigration(root, targetProjectID)
}

export function setProjectMigrationWriteFailureForTest(afterWrites: number | undefined) {
  failAfterWritesForTest = afterWrites
  return () => { failAfterWritesForTest = undefined }
}
