import { createHash, randomUUID } from "node:crypto"
import {
  copyFile,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
} from "node:fs/promises"
import path from "node:path"
import {
  CinemaAssetMigrationCandidateSchema,
  CinemaAssetMigrationResultSchema,
  CinemaAssetMigrationStatusResultSchema,
  CinemaAssetRefSchema,
  type CinemaAssetKind,
  type CinemaAssetMigrationCandidate,
  type CinemaAssetMigrationResult,
  type CinemaAssetMigrationStatusResult,
  type CinemaAssetRecord,
  type CinemaAssetRef,
  type StartCinemaAssetMigrationBody,
} from "@anybox/shared/cinema"
import { isSshWorkspaceUri } from "@anybox/shared"
import { z } from "zod"
import * as Project from "#project/project.ts"
import { ApiError } from "#server/error.ts"
import * as Lock from "#util/lock.ts"
import {
  getCinemaAssetLibraryState,
  registerCinemaGeneratedAsset,
} from "#cinema/asset-library.ts"

const CINEMA_DIRECTORY = ".anybox-cinema"
const PROJECT_METADATA_FILE = "project.json"
const CANVAS_FILE = "canvas.json"
const TASKS_FILE = "tasks.jsonl"
const TASKS_DIRECTORY = "tasks"
const MIGRATION_BACKUPS_DIRECTORY = "migration-backups"
const MIGRATION_OPERATIONS_DIRECTORY = "asset-ops"
const ASSET_LIBRARY_SCHEMA_VERSION = 1

const LEGACY_ROOTS = [
  "assets/imported",
  "generated",
  "renders",
  "exports",
] as const

const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".avif",
  ".apng",
  ".bmp",
  ".svg",
])
const VIDEO_EXTENSIONS = new Set([".mp4", ".m4v", ".mov", ".webm", ".mkv"])
const AUDIO_EXTENSIONS = new Set([".mp3", ".wav", ".m4a", ".aac", ".ogg", ".oga", ".flac"])

const MigratedAssetSchema = z.object({
  candidateID: z.string().min(1),
  sourcePath: z.string().min(1),
  path: z.string().min(1),
  asset: z.object({
    id: z.string().min(1),
    relativePath: z.string().min(1),
    displayName: z.string().min(1),
    kind: z.enum(["image", "video", "audio"]),
    mimeType: z.string().min(1),
    sizeBytes: z.number().int().nonnegative(),
    contentRevision: z.number().int().nonnegative(),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    durationSeconds: z.number().nonnegative().optional(),
  }).passthrough(),
  assetRef: CinemaAssetRefSchema,
})

const MigrationJournalSchema = z.object({
  schemaVersion: z.literal(1),
  projectID: z.string().min(1),
  operationID: z.string().min(1),
  baseRevision: z.number().int().nonnegative(),
  phase: z.enum(["running", "rolling-back", "completed", "failed", "recovery-required"]),
  candidates: z.array(CinemaAssetMigrationCandidateSchema),
  migrated: z.array(MigratedAssetSchema).default([]),
  backupFiles: z.array(z.string()).default([]),
  commitBackupReady: z.boolean().default(false),
  startedAt: z.string().min(1),
  updatedAt: z.string().min(1),
  result: CinemaAssetMigrationResultSchema.optional(),
  error: z.string().min(1).optional(),
})

type MigrationJournal = z.infer<typeof MigrationJournalSchema>
type MigratedAsset = z.infer<typeof MigratedAssetSchema>

function errorMessage(error: unknown) {
  return error instanceof Error && error.message.trim() ? error.message : String(error)
}

function projectPaths(projectID: string) {
  const project = Project.get(projectID)
  if (!project) throw new ApiError(404, "PROJECT_NOT_FOUND", `Project '${projectID}' not found.`)
  const repositoryRoot = Project.getRepositoryRoot(project)
  if (isSshWorkspaceUri(repositoryRoot)) {
    throw new ApiError(
      409,
      "CINEMA_UNAVAILABLE_FOR_SSH",
      "Cinema asset migration is not available for SSH workspaces yet.",
    )
  }
  const root = path.resolve(repositoryRoot)
  const cinemaRoot = path.join(root, CINEMA_DIRECTORY)
  return {
    root,
    cinemaRoot,
    projectMetadataPath: path.join(cinemaRoot, PROJECT_METADATA_FILE),
    operationsRoot: path.join(cinemaRoot, MIGRATION_OPERATIONS_DIRECTORY),
    backupsRoot: path.join(cinemaRoot, MIGRATION_BACKUPS_DIRECTORY),
  }
}

async function pathInfo(input: string) {
  return await lstat(input).catch((error: unknown) => {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return undefined
    throw error
  })
}

function projectRelativePath(root: string, filePath: string) {
  const relative = path.relative(root, filePath)
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new ApiError(400, "CINEMA_LIBRARY_MIGRATION_PATH_INVALID", "Legacy asset path is outside the project.")
  }
  return relative.split(path.sep).join("/")
}

function kindForExtension(fileName: string): CinemaAssetKind | undefined {
  const extension = path.extname(fileName).toLocaleLowerCase()
  if (IMAGE_EXTENSIONS.has(extension)) return "image"
  if (VIDEO_EXTENSIONS.has(extension)) return "video"
  if (AUDIO_EXTENSIONS.has(extension)) return "audio"
  return undefined
}

function candidateID(sourcePath: string) {
  const digest = createHash("sha256").update(sourcePath.normalize("NFC").toLocaleLowerCase()).digest("hex")
  return `migration_${digest.slice(0, 32)}`
}

function generatedDestinationFolderID(kind: CinemaAssetKind, defaultFolderIDs: Record<string, string>) {
  const key = kind === "image" ? "generated-images" : kind === "video" ? "generated-videos" : "generated-audio"
  const folderID = defaultFolderIDs[key]
  if (!folderID) {
    throw new ApiError(500, "CINEMA_LIBRARY_DEFAULT_FOLDER_MISSING", `Default migration folder '${key}' is missing.`)
  }
  return folderID
}

async function scanLegacyAssets(
  root: string,
  defaultFolderIDs: Record<string, string>,
) {
  const candidates: CinemaAssetMigrationCandidate[] = []
  let unrecognizedCount = 0

  const visit = async (directory: string, legacyRoot: typeof LEGACY_ROOTS[number]) => {
    const directoryInfo = await pathInfo(directory)
    if (!directoryInfo || !directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) return
    const entries = await readdir(directory, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name, "en", { sensitivity: "base", numeric: true }))
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue
      const entryPath = path.join(directory, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        await visit(entryPath, legacyRoot)
        continue
      }
      if (!entry.isFile()) continue
      const info = await stat(entryPath)
      const kind = kindForExtension(entry.name)
      if (!kind) {
        unrecognizedCount += 1
        continue
      }
      const sourcePath = projectRelativePath(root, entryPath).normalize("NFC")
      const destinationFolderID = legacyRoot === "assets/imported"
        ? defaultFolderIDs.inbox
        : generatedDestinationFolderID(kind, defaultFolderIDs)
      if (!destinationFolderID) {
        throw new ApiError(500, "CINEMA_LIBRARY_DEFAULT_FOLDER_MISSING", "Default migration inbox is missing.")
      }
      candidates.push(CinemaAssetMigrationCandidateSchema.parse({
        id: candidateID(sourcePath),
        sourcePath,
        destinationFolderID,
        kind,
        sizeBytes: info.size,
        selected: true,
      }))
    }
  }

  for (const legacyRoot of LEGACY_ROOTS) {
    await visit(path.resolve(root, ...legacyRoot.split("/")), legacyRoot)
  }
  candidates.sort((left, right) => left.sourcePath.localeCompare(right.sourcePath, "en", {
    sensitivity: "base",
    numeric: true,
  }))
  return { candidates, unrecognizedCount }
}

async function readProjectMetadata(projectMetadataPath: string) {
  const raw = await readFile(projectMetadataPath, "utf8").catch((error: unknown) => {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return "{}"
    throw error
  })
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Expected an object.")
    return parsed as Record<string, unknown>
  } catch (error) {
    throw new ApiError(
      500,
      "CINEMA_PROJECT_METADATA_INVALID",
      `Cinema project metadata is invalid: ${errorMessage(error)}`,
    )
  }
}

function operationSegment(operationID: string) {
  const normalized = operationID.normalize("NFC")
  if (/^[A-Za-z0-9._-]{1,96}$/.test(normalized)) return normalized
  return `operation-${createHash("sha256").update(normalized).digest("hex").slice(0, 32)}`
}

function journalPath(operationsRoot: string, operationID: string) {
  const digest = createHash("sha256").update(operationID).digest("hex").slice(0, 32)
  return path.join(operationsRoot, `migration-${digest}.json`)
}

async function writeTextAtomic(filePath: string, contents: string) {
  await mkdir(path.dirname(filePath), { recursive: true })
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`,
  )
  const handle = await open(temporaryPath, "wx")
  try {
    await handle.writeFile(contents, "utf8")
    await handle.sync()
  } finally {
    await handle.close()
  }
  try {
    await rename(temporaryPath, filePath)
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
    throw error
  }
}

async function writeJsonAtomic(filePath: string, value: unknown) {
  await writeTextAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

async function readJournal(filePath: string) {
  const raw = await readFile(filePath, "utf8").catch((error: unknown) => {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return undefined
    throw error
  })
  if (raw === undefined) return undefined
  try {
    return MigrationJournalSchema.parse(JSON.parse(raw))
  } catch (error) {
    throw new ApiError(
      500,
      "CINEMA_LIBRARY_MIGRATION_JOURNAL_INVALID",
      `Asset migration operation journal is invalid: ${errorMessage(error)}`,
    )
  }
}

async function writeJournal(filePath: string, journal: MigrationJournal) {
  journal.updatedAt = new Date().toISOString()
  await writeJsonAtomic(filePath, MigrationJournalSchema.parse(journal))
}

async function latestIncompleteJournal(operationsRoot: string, projectID: string) {
  const entries = await readdir(operationsRoot, { withFileTypes: true }).catch((error: unknown) => {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return []
    throw error
  })
  const journals: MigrationJournal[] = []
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.startsWith("migration-") || !entry.name.endsWith(".json")) continue
    const journal = await readJournal(path.join(operationsRoot, entry.name))
    if (journal && journal.projectID === projectID && journal.phase !== "completed") journals.push(journal)
  }
  return journals.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]
}

function metadataSourcePaths(cinemaRoot: string) {
  return [
    path.join(cinemaRoot, PROJECT_METADATA_FILE),
    path.join(cinemaRoot, CANVAS_FILE),
    path.join(cinemaRoot, TASKS_FILE),
  ]
}

async function listTaskMetadataFiles(cinemaRoot: string) {
  const tasksRoot = path.join(cinemaRoot, TASKS_DIRECTORY)
  const result: string[] = []
  const visit = async (directory: string) => {
    const info = await pathInfo(directory)
    if (!info || !info.isDirectory() || info.isSymbolicLink()) return
    const entries = await readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue
      const child = path.join(directory, entry.name)
      if (entry.isDirectory()) await visit(child)
      else if (entry.isFile() && entry.name.toLocaleLowerCase().endsWith(".json")) result.push(child)
    }
  }
  await visit(tasksRoot)
  return result.sort((left, right) => left.localeCompare(right))
}

async function backupMetadata(cinemaRoot: string, backupRoot: string) {
  await rm(backupRoot, { recursive: true, force: true })
  await mkdir(backupRoot, { recursive: true })
  const sources = [...metadataSourcePaths(cinemaRoot), ...await listTaskMetadataFiles(cinemaRoot)]
  const backedUpFiles: string[] = []
  for (const source of sources) {
    const info = await pathInfo(source)
    if (!info?.isFile() || info.isSymbolicLink()) continue
    const relative = path.relative(cinemaRoot, source)
    const destination = path.join(backupRoot, relative)
    await mkdir(path.dirname(destination), { recursive: true })
    await copyFile(source, destination)
    backedUpFiles.push(relative.split(path.sep).join("/"))
  }
  return backedUpFiles
}

async function restoreMetadata(cinemaRoot: string, backupRoot: string, backedUpFiles: string[]) {
  const failures: string[] = []
  for (const relative of backedUpFiles) {
    const source = path.resolve(backupRoot, ...relative.split("/"))
    const destination = path.resolve(cinemaRoot, ...relative.split("/"))
    try {
      const contents = await readFile(source)
      await writeTextAtomic(destination, contents.toString("utf8"))
    } catch (error) {
      failures.push(`${relative}: ${errorMessage(error)}`)
    }
  }
  return failures
}

function normalizeComparableProjectPath(root: string, value: string) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) && !/^[a-z]:[\\/]/i.test(value)) return undefined
  const candidate = path.isAbsolute(value)
    ? path.resolve(value)
    : path.resolve(root, value.replace(/\\/g, "/"))
  const relative = path.relative(root, candidate)
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return undefined
  return relative.split(path.sep).join("/").normalize("NFC").toLocaleLowerCase()
}

function collectAssetIDReplacements(
  value: unknown,
  root: string,
  migrationsByPath: Map<string, MigratedAsset>,
  replacements: Map<string, string>,
) {
  if (Array.isArray(value)) {
    for (const item of value) collectAssetIDReplacements(item, root, migrationsByPath, replacements)
    return
  }
  if (!value || typeof value !== "object") return
  const record = value as Record<string, unknown>
  const comparable = typeof record.path === "string" ? normalizeComparableProjectPath(root, record.path) : undefined
  const migration = comparable ? migrationsByPath.get(comparable) : undefined
  if (migration) {
    if (typeof record.id === "string" && record.id) replacements.set(record.id, migration.asset.id)
    if (typeof record.assetID === "string" && record.assetID) replacements.set(record.assetID, migration.asset.id)
  }
  for (const child of Object.values(record)) {
    collectAssetIDReplacements(child, root, migrationsByPath, replacements)
  }
}

function rewriteMetadataValue(
  value: unknown,
  root: string,
  migrationsByPath: Map<string, MigratedAsset>,
  idReplacements: Map<string, string>,
  key = "",
): { value: unknown; rewrites: number } {
  if (Array.isArray(value)) {
    let rewrites = 0
    const items = value.map((item) => {
      const rewritten = rewriteMetadataValue(item, root, migrationsByPath, idReplacements)
      rewrites += rewritten.rewrites
      return rewritten.value
    })
    return { value: items, rewrites }
  }
  if (!value || typeof value !== "object") {
    if (typeof value === "string") {
      if (/assetid/i.test(key) && idReplacements.has(value)) {
        return { value: idReplacements.get(value)!, rewrites: 1 }
      }
      if (/path$/i.test(key)) {
        const comparable = normalizeComparableProjectPath(root, value)
        const migration = comparable ? migrationsByPath.get(comparable) : undefined
        if (migration) return { value: migration.path, rewrites: 1 }
      }
    }
    return { value, rewrites: 0 }
  }

  const source = value as Record<string, unknown>
  let rewrites = 0
  const record: Record<string, unknown> = {}
  for (const [childKey, child] of Object.entries(source)) {
    const rewritten = rewriteMetadataValue(child, root, migrationsByPath, idReplacements, childKey)
    record[childKey] = rewritten.value
    rewrites += rewritten.rewrites
  }

  const comparable = typeof source.path === "string" ? normalizeComparableProjectPath(root, source.path) : undefined
  const migration = comparable ? migrationsByPath.get(comparable) : undefined
  if (!migration) return { value: record, rewrites }

  record.path = migration.path
  if ("id" in source) record.id = migration.asset.id
  if ("assetID" in source || !("id" in source)) record.assetID = migration.asset.id
  if (source.text === source.path) record.text = migration.path
  record.kind = migration.asset.kind
  record.mimeType = migration.asset.mimeType
  record.sizeBytes = migration.asset.sizeBytes
  if (migration.asset.width !== undefined) record.width = migration.asset.width
  if (migration.asset.height !== undefined) record.height = migration.asset.height
  if (migration.asset.durationSeconds !== undefined) record.durationSeconds = migration.asset.durationSeconds
  record.assetRef = migration.assetRef
  return { value: record, rewrites: rewrites + 1 }
}

async function rewriteJsonMetadataFile(
  filePath: string,
  root: string,
  migrationsByPath: Map<string, MigratedAsset>,
  options: { bumpCanvasRevision?: boolean } = {},
) {
  const raw = await readFile(filePath, "utf8")
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new ApiError(
      500,
      "CINEMA_LIBRARY_MIGRATION_METADATA_INVALID",
      `Cannot migrate invalid JSON metadata '${path.basename(filePath)}': ${errorMessage(error)}`,
    )
  }
  const idReplacements = new Map<string, string>()
  collectAssetIDReplacements(parsed, root, migrationsByPath, idReplacements)
  const rewritten = rewriteMetadataValue(parsed, root, migrationsByPath, idReplacements)
  if (rewritten.rewrites > 0) {
    const value = options.bumpCanvasRevision
      && rewritten.value
      && typeof rewritten.value === "object"
      && !Array.isArray(rewritten.value)
      ? {
        ...rewritten.value,
        revision: (
          "revision" in rewritten.value
          && typeof rewritten.value.revision === "number"
          && Number.isInteger(rewritten.value.revision)
          && rewritten.value.revision >= 0
        ) ? rewritten.value.revision + 1 : 1,
      }
      : rewritten.value
    await writeJsonAtomic(filePath, value)
  }
  return rewritten.rewrites
}

async function rewriteJsonLinesMetadataFile(
  filePath: string,
  root: string,
  migrationsByPath: Map<string, MigratedAsset>,
) {
  const raw = await readFile(filePath, "utf8")
  if (!raw.trim()) return 0
  const output: string[] = []
  let totalRewrites = 0
  for (const [index, line] of raw.split(/\r?\n/).entries()) {
    if (!line.trim()) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch (error) {
      throw new ApiError(
        500,
        "CINEMA_LIBRARY_MIGRATION_METADATA_INVALID",
        `Cannot migrate invalid JSONL metadata '${path.basename(filePath)}' at line ${index + 1}: ${errorMessage(error)}`,
      )
    }
    const idReplacements = new Map<string, string>()
    collectAssetIDReplacements(parsed, root, migrationsByPath, idReplacements)
    const rewritten = rewriteMetadataValue(parsed, root, migrationsByPath, idReplacements)
    totalRewrites += rewritten.rewrites
    output.push(JSON.stringify(rewritten.value))
  }
  if (totalRewrites > 0) await writeTextAtomic(filePath, `${output.join("\n")}\n`)
  return totalRewrites
}

function canonicalAssetRef(projectID: string, asset: CinemaAssetRecord): CinemaAssetRef {
  return CinemaAssetRefSchema.parse({
    scope: { type: "project", projectID },
    assetID: asset.id,
    contentRevision: asset.contentRevision,
    snapshot: {
      kind: asset.kind,
      displayName: asset.displayName,
      mimeType: asset.mimeType,
      ...(asset.width !== undefined ? { width: asset.width } : {}),
      ...(asset.height !== undefined ? { height: asset.height } : {}),
      ...(asset.durationSeconds !== undefined ? { durationSeconds: asset.durationSeconds } : {}),
    },
  })
}

async function commitMetadataMigration(
  projectID: string,
  root: string,
  cinemaRoot: string,
  projectMetadataPath: string,
  migrations: MigratedAsset[],
) {
  const migrationsByPath = new Map<string, MigratedAsset>()
  for (const migration of migrations) {
    migrationsByPath.set(normalizeComparableProjectPath(root, migration.sourcePath)!, migration)
  }

  const canvasPath = path.join(cinemaRoot, CANVAS_FILE)
  const canvasInfo = await pathInfo(canvasPath)
  if (canvasInfo?.isFile() && !canvasInfo.isSymbolicLink()) {
    await rewriteJsonMetadataFile(canvasPath, root, migrationsByPath, { bumpCanvasRevision: true })
  }
  for (const taskPath of await listTaskMetadataFiles(cinemaRoot)) {
    await rewriteJsonMetadataFile(taskPath, root, migrationsByPath)
  }
  const tasksPath = path.join(cinemaRoot, TASKS_FILE)
  const tasksInfo = await pathInfo(tasksPath)
  if (tasksInfo?.isFile() && !tasksInfo.isSymbolicLink()) {
    await rewriteJsonLinesMetadataFile(tasksPath, root, migrationsByPath)
  }

  const metadata = await readProjectMetadata(projectMetadataPath)
  await writeJsonAtomic(projectMetadataPath, {
    ...metadata,
    assetLibrarySchemaVersion: ASSET_LIBRARY_SCHEMA_VERSION,
  })
}

export async function getCinemaAssetMigrationStatus(
  projectID: string,
): Promise<CinemaAssetMigrationStatusResult> {
  const paths = projectPaths(projectID)
  const state = await getCinemaAssetLibraryState(
    { type: "project", projectID },
    { maintainPendingDeletes: false },
  )
  const metadata = await readProjectMetadata(paths.projectMetadataPath)
  const incomplete = await latestIncompleteJournal(paths.operationsRoot, projectID)
  if (incomplete) {
    return CinemaAssetMigrationStatusResultSchema.parse({
      projectID,
      phase: incomplete.phase,
      readOnly: true,
      candidateCount: incomplete.candidates.length,
      totalBytes: incomplete.candidates.reduce((total, candidate) => total + candidate.sizeBytes, 0),
      unrecognizedCount: 0,
      candidates: incomplete.candidates,
      ...(incomplete.error ? { error: incomplete.error } : {}),
    })
  }
  if (typeof metadata.assetLibrarySchemaVersion === "number" && metadata.assetLibrarySchemaVersion >= 1) {
    return CinemaAssetMigrationStatusResultSchema.parse({
      projectID,
      phase: "completed",
      readOnly: false,
      candidateCount: 0,
      totalBytes: 0,
      unrecognizedCount: 0,
      candidates: [],
    })
  }

  const scan = await scanLegacyAssets(paths.root, state.defaultFolderIDs)
  const phase = scan.candidates.length > 0 ? "required" : "not-required"
  if (scan.candidates.length === 0) {
    await writeJsonAtomic(paths.projectMetadataPath, {
      ...metadata,
      assetLibrarySchemaVersion: ASSET_LIBRARY_SCHEMA_VERSION,
    })
  }
  return CinemaAssetMigrationStatusResultSchema.parse({
    projectID,
    phase,
    readOnly: phase !== "not-required",
    candidateCount: scan.candidates.length,
    totalBytes: scan.candidates.reduce((total, candidate) => total + candidate.sizeBytes, 0),
    unrecognizedCount: scan.unrecognizedCount,
    candidates: scan.candidates,
  })
}

function incompleteJournalError(journal: MigrationJournal) {
  const recoveryRequired = journal.phase === "rolling-back" || journal.phase === "recovery-required"
  return new ApiError(
    500,
    recoveryRequired
      ? "CINEMA_LIBRARY_MIGRATION_RECOVERY_REQUIRED"
      : "CINEMA_LIBRARY_MIGRATION_FAILED",
    journal.error
      ?? `Migration '${journal.operationID}' is ${journal.phase} and must be recovered before starting another migration.`,
  )
}

async function completeMigrationJournal(
  journalFilePath: string,
  journal: MigrationJournal,
  revision: number,
) {
  const result = CinemaAssetMigrationResultSchema.parse({
    projectID: journal.projectID,
    operationID: journal.operationID,
    phase: "completed",
    revision,
    migratedAssetIDs: journal.migrated.map((item) => item.asset.id),
    warnings: [],
  })
  journal.phase = "completed"
  journal.result = result
  journal.error = undefined
  await writeJournal(journalFilePath, journal)
  return result
}

export async function startCinemaAssetMigration(
  projectID: string,
  input: StartCinemaAssetMigrationBody,
): Promise<CinemaAssetMigrationResult> {
  if (!input.operationID?.trim()) {
    throw new ApiError(400, "CINEMA_LIBRARY_OPERATION_ID_INVALID", "Migration operationID is required.")
  }
  if (!Number.isInteger(input.baseRevision) || input.baseRevision < 0) {
    throw new ApiError(400, "CINEMA_LIBRARY_REVISION_INVALID", "Migration baseRevision must be non-negative.")
  }

  using _migrationLock = await Lock.write(`cinema-library-migration:${projectID}`)
  const paths = projectPaths(projectID)
  const requestedOperationID = input.operationID.trim()
  let operationID = requestedOperationID
  let operationJournalPath = journalPath(paths.operationsRoot, operationID)
  let journal = await readJournal(operationJournalPath)
  if (journal) {
    if (journal.projectID !== projectID || journal.operationID !== requestedOperationID) {
      throw new ApiError(409, "CINEMA_LIBRARY_OPERATION_CONFLICT", "Migration operationID belongs to another project.")
    }
    if (journal.phase === "completed" && journal.result) return journal.result
    if (journal.phase === "completed") {
      throw new ApiError(500, "CINEMA_LIBRARY_MIGRATION_JOURNAL_INVALID", "Completed migration journal has no result.")
    }
  }

  if (!journal) {
    const incomplete = await latestIncompleteJournal(paths.operationsRoot, projectID)
    if (incomplete) {
      if (incomplete.phase !== "running") throw incompleteJournalError(incomplete)
      journal = incomplete
      operationID = incomplete.operationID
      operationJournalPath = journalPath(paths.operationsRoot, operationID)
    }
  }
  if (journal && journal.phase !== "running") throw incompleteJournalError(journal)

  const state = await getCinemaAssetLibraryState({ type: "project", projectID })
  if (!journal && state.revision !== input.baseRevision) {
    throw new ApiError(
      409,
      "CINEMA_LIBRARY_REVISION_CONFLICT",
      `Asset library revision changed; latest revision is ${state.revision}.`,
      { latestRevision: state.revision },
    )
  }

  const metadata = await readProjectMetadata(paths.projectMetadataPath)
  if (typeof metadata.assetLibrarySchemaVersion === "number" && metadata.assetLibrarySchemaVersion >= 1) {
    if (journal) {
      const migratedCandidateIDs = new Set(journal.migrated.map((item) => item.candidateID))
      const missingCandidates = journal.candidates.filter((candidate) => !migratedCandidateIDs.has(candidate.id))
      if (missingCandidates.length > 0) {
        journal.phase = "recovery-required"
        journal.error = "Project metadata was committed before every migration candidate was registered."
        await writeJournal(operationJournalPath, journal)
        throw incompleteJournalError(journal)
      }
      return await completeMigrationJournal(operationJournalPath, journal, state.revision)
    }
    throw new ApiError(409, "CINEMA_LIBRARY_MIGRATION_COMPLETED", "This project has already been migrated.")
  }

  if (!journal) {
    const scan = await scanLegacyAssets(paths.root, state.defaultFolderIDs)
    const candidatesByID = new Map(scan.candidates.map((candidate) => [candidate.id, candidate]))
    const requestedIDs = [...new Set(input.candidateIDs)]
    const unknownIDs = requestedIDs.filter((id) => !candidatesByID.has(id))
    if (unknownIDs.length > 0) {
      throw new ApiError(
        400,
        "CINEMA_LIBRARY_MIGRATION_CANDIDATE_INVALID",
        `Unknown or unavailable migration candidate(s): ${unknownIDs.join(", ")}`,
      )
    }
    const selected = scan.candidates.filter((candidate) => requestedIDs.includes(candidate.id))
    const timestamp = new Date().toISOString()
    journal = {
      schemaVersion: 1,
      projectID,
      operationID,
      baseRevision: input.baseRevision,
      phase: "running",
      candidates: selected,
      migrated: [],
      backupFiles: [],
      commitBackupReady: false,
      startedAt: timestamp,
      updatedAt: timestamp,
    }
    await writeJournal(operationJournalPath, journal)
  }

  const backupRoot = path.join(paths.backupsRoot, operationSegment(operationID))
  const originalBackupRoot = path.join(backupRoot, "original")
  const commitBackupRoot = path.join(backupRoot, "commit")
  let revision = journal.migrated.length > 0
    ? (await getCinemaAssetLibraryState({ type: "project", projectID })).revision
    : state.revision

  using _canvasLock = await Lock.write(`cinema-canvas:${paths.cinemaRoot}`)
  try {
    if (journal.backupFiles.length === 0) {
      journal.backupFiles = await backupMetadata(paths.cinemaRoot, originalBackupRoot)
      await writeJournal(operationJournalPath, journal)
    }

    const migratedCandidateIDs = new Set(journal.migrated.map((item) => item.candidateID))
    for (const candidate of journal.candidates) {
      if (migratedCandidateIDs.has(candidate.id)) continue
      const registered = await registerCinemaGeneratedAsset(projectID, {
        operationID: `migration:${createHash("sha256").update(operationID).digest("hex").slice(0, 20)}:${candidate.id.slice(-32)}`,
        baseRevision: revision,
        sourcePath: candidate.sourcePath,
        kind: candidate.kind,
        displayName: path.posix.basename(candidate.sourcePath, path.posix.extname(candidate.sourcePath)),
        source: "migration",
        destinationFolderID: candidate.destinationFolderID,
      })
      revision = registered.revision
      const asset = registered.asset as CinemaAssetRecord
      journal.migrated.push(MigratedAssetSchema.parse({
        candidateID: candidate.id,
        sourcePath: candidate.sourcePath,
        path: path.posix.join("assets/library", asset.relativePath.replace(/\\/g, "/")),
        asset,
        assetRef: canonicalAssetRef(projectID, asset),
      }))
      await writeJournal(operationJournalPath, journal)
    }

    journal.backupFiles = await backupMetadata(paths.cinemaRoot, commitBackupRoot)
    journal.commitBackupReady = true
    await writeJournal(operationJournalPath, journal)
    await commitMetadataMigration(
      projectID,
      paths.root,
      paths.cinemaRoot,
      paths.projectMetadataPath,
      journal.migrated,
    )

    return await completeMigrationJournal(operationJournalPath, journal, revision)
  } catch (error) {
    const failure = errorMessage(error)
    journal.phase = "rolling-back"
    journal.error = failure
    await writeJournal(operationJournalPath, journal).catch(() => undefined)
    const restoreFailures = journal.backupFiles.length > 0
      ? await restoreMetadata(
          paths.cinemaRoot,
          journal.commitBackupReady ? commitBackupRoot : originalBackupRoot,
          journal.backupFiles,
        )
      : []
    const recoveryRequired = journal.migrated.length > 0 || restoreFailures.length > 0
    journal.phase = recoveryRequired ? "recovery-required" : "failed"
    journal.error = restoreFailures.length > 0
      ? `${failure} Metadata restore also failed: ${restoreFailures.join("; ")}`
      : failure
    await writeJournal(operationJournalPath, journal).catch(() => undefined)
    throw new ApiError(
      500,
      recoveryRequired
        ? "CINEMA_LIBRARY_MIGRATION_RECOVERY_REQUIRED"
        : "CINEMA_LIBRARY_MIGRATION_FAILED",
      recoveryRequired
        ? `Asset migration could not complete safely and requires recovery. ${journal.error}`
        : `Asset migration failed before changing the library. ${journal.error}`,
    )
  }
}
