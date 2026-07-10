import { createHash, randomUUID } from "node:crypto"
import { createReadStream, type Stats } from "node:fs"
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
  writeFile,
} from "node:fs/promises"
import path from "node:path"
import fuzzysort from "fuzzysort"
import { isSshWorkspaceUri } from "@anybox/shared"
import * as Global from "#global/global.ts"
import * as Project from "#project/project.ts"
import { ApiError } from "#server/error.ts"
import { readImageDimensions } from "#session/support/image-assets.ts"
import * as Lock from "#util/lock.ts"
import { streamCinemaAssetMultipartUpload } from "#cinema/asset-library-multipart.ts"
import { streamCinemaFile } from "#cinema/file-range-stream.ts"
import {
  createAudioPreviewProxy,
  createImageThumbnail,
  createVideoPreviewProxy,
  createVideoThumbnail,
  probeMediaFile,
} from "#cinema/media-runtime.ts"
import {
  CINEMA_ASSET_LIBRARY_DEFAULT_PAGE_SIZE,
  CINEMA_ASSET_LIBRARY_LIMITS,
  CINEMA_ASSET_LIBRARY_MAX_FOLDER_DEPTH,
  CINEMA_ASSET_LIBRARY_MAX_PAGE_SIZE,
  CINEMA_ASSET_LIBRARY_ROOT_FOLDER_ID,
  CINEMA_ASSET_LIBRARY_SCHEMA_VERSION,
  type CinemaAssetCatalog,
  type CinemaAssetFolder,
  type CinemaAssetKind,
  type CinemaAssetLibraryEntriesView,
  type CinemaAssetLibraryEntry,
  type CinemaAssetLibraryEntryRef,
  type CinemaAssetLibraryMutationInput,
  type CinemaAssetLibraryPaths,
  type CinemaAssetRecord,
  type CinemaAssetScope,
} from "#cinema/asset-library-types.ts"

const PROJECT_CINEMA_DIRECTORY = ".anybox-cinema"
const PROJECT_MARKER_FILE = "project.json"
const PROJECT_LIBRARY_RELATIVE_ROOT = "assets/library"
const PROJECT_CATALOG_FILE = "asset-library.json"
const OPERATION_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/
const INVALID_NAME_PATTERN = /[<>:"/\\|?*\x00-\x1F]/
const WINDOWS_DEVICE_NAME_PATTERN = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/i
const ROOT_FOLDER_NAME = "素材库"
const MAX_OPERATION_HISTORY = 500
const nowISO = () => new Date().toISOString()

let personalLibraryRootOverride: string | undefined
let failNextCatalogWriteForTest = false
const catalogAssetReadCache = new Map<string, {
  mtimeMs: number
  size: number
  catalog: CinemaAssetCatalog
  assetsByID: Map<string, CinemaAssetRecord>
}>()

export function setCinemaAssetLibraryPersonalRootForTest(root: string | undefined) {
  const previous = personalLibraryRootOverride
  personalLibraryRootOverride = root
  catalogAssetReadCache.clear()
  return () => {
    personalLibraryRootOverride = previous
    catalogAssetReadCache.clear()
  }
}

export function setCinemaAssetLibraryCatalogWriteFailureForTest(enabled = true) {
  const previous = failNextCatalogWriteForTest
  failNextCatalogWriteForTest = enabled
  return () => {
    failNextCatalogWriteForTest = previous
  }
}

function safeReadProject(projectID: string) {
  const project = Project.get(projectID)
  if (!project) throw new ApiError(404, "PROJECT_NOT_FOUND", `Project '${projectID}' not found.`)
  return project
}

function assertInside(parent: string, child: string) {
  const relative = path.relative(path.resolve(parent), path.resolve(child))
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) return
  throw new ApiError(400, "CINEMA_LIBRARY_PATH_INVALID", "Resolved path is outside the managed asset library.")
}

function toRelativePath(...segments: string[]) {
  return path.posix.join(...segments.map((segment) => segment.replace(/\\/g, "/")))
}

function physicalPath(paths: CinemaAssetLibraryPaths, relativePath: string) {
  const resolved = path.resolve(paths.filesRoot, ...relativePath.split("/").filter(Boolean))
  assertInside(paths.filesRoot, resolved)
  return resolved
}

async function pathExists(input: string) {
  return await stat(input)
    .then(() => true)
    .catch((error: unknown) => {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return false
      throw error
    })
}

async function assertNoSymlinkBelowRoot(root: string, target: string) {
  assertInside(root, target)
  const rootInfo = await lstat(path.resolve(root)).catch((error: unknown) => {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return undefined
    throw error
  })
  if (rootInfo?.isSymbolicLink()) {
    throw new ApiError(400, "CINEMA_LIBRARY_SYMLINK_REJECTED", "Symbolic links and junctions are not supported.")
  }
  const relative = path.relative(path.resolve(root), path.resolve(target))
  let current = path.resolve(root)
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment)
    const info = await lstat(current).catch((error: unknown) => {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return undefined
      throw error
    })
    if (!info) break
    if (info.isSymbolicLink()) {
      throw new ApiError(400, "CINEMA_LIBRARY_SYMLINK_REJECTED", "Symbolic links and junctions are not supported.")
    }
  }
}

async function assertRealDirectory(input: string) {
  const info = await lstat(input)
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new ApiError(
      400,
      "CINEMA_LIBRARY_SYMLINK_REJECTED",
      "Managed asset library directories must be real directories, not symbolic links or junctions.",
    )
  }
}

function resolveLibraryPaths(scope: CinemaAssetScope): CinemaAssetLibraryPaths {
  if (scope.type === "personal") {
    const managedRoot = path.resolve(personalLibraryRootOverride ?? path.join(Global.Path.data, "cinema-library"))
    return {
      scope,
      scopeKey: "cinema-library:personal",
      managedRoot,
      filesRoot: path.join(managedRoot, "files"),
      catalogPath: path.join(managedRoot, "catalog.json"),
      operationsRoot: path.join(managedRoot, "operations"),
    }
  }

  const project = safeReadProject(scope.projectID)
  const root = Project.getRepositoryRoot(project)
  if (isSshWorkspaceUri(root)) {
    throw new ApiError(409, "CINEMA_UNAVAILABLE_FOR_SSH", "Cinema asset libraries are not available for SSH workspaces yet.")
  }
  const resolvedRoot = path.resolve(root)
  const cinemaRoot = path.join(resolvedRoot, PROJECT_CINEMA_DIRECTORY)
  return {
    scope,
    scopeKey: `cinema-library:project:${scope.projectID}`,
    managedRoot: cinemaRoot,
    filesRoot: path.join(resolvedRoot, ...PROJECT_LIBRARY_RELATIVE_ROOT.split("/")),
    catalogPath: path.join(cinemaRoot, PROJECT_CATALOG_FILE),
    operationsRoot: path.join(cinemaRoot, "asset-ops"),
  }
}

type DefaultFolderDefinition = Pick<CinemaAssetFolder, "id" | "parentID" | "name" | "relativePath" | "system">

function defaultFolderDefinitions(scope: CinemaAssetScope): DefaultFolderDefinition[] {
  const common: DefaultFolderDefinition[] = [
    { id: "inbox", parentID: CINEMA_ASSET_LIBRARY_ROOT_FOLDER_ID, name: "收件箱", relativePath: "收件箱", system: true },
    { id: "characters", parentID: CINEMA_ASSET_LIBRARY_ROOT_FOLDER_ID, name: "角色", relativePath: "角色", system: false },
    { id: "scenes", parentID: CINEMA_ASSET_LIBRARY_ROOT_FOLDER_ID, name: "场景", relativePath: "场景", system: false },
    { id: "props", parentID: CINEMA_ASSET_LIBRARY_ROOT_FOLDER_ID, name: "道具", relativePath: "道具", system: false },
    { id: "styles", parentID: CINEMA_ASSET_LIBRARY_ROOT_FOLDER_ID, name: "风格", relativePath: "风格", system: false },
    { id: "sound-effects", parentID: CINEMA_ASSET_LIBRARY_ROOT_FOLDER_ID, name: "音效", relativePath: "音效", system: false },
    { id: "other", parentID: CINEMA_ASSET_LIBRARY_ROOT_FOLDER_ID, name: "其他", relativePath: "其他", system: false },
  ]
  if (scope.type === "personal") return common
  return [
    common[0]!,
    { id: "generated", parentID: CINEMA_ASSET_LIBRARY_ROOT_FOLDER_ID, name: "生成素材", relativePath: "生成素材", system: true },
    { id: "generated-images", parentID: "generated", name: "图片", relativePath: "生成素材/图片", system: true },
    { id: "generated-videos", parentID: "generated", name: "视频", relativePath: "生成素材/视频", system: true },
    { id: "generated-audio", parentID: "generated", name: "音频", relativePath: "生成素材/音频", system: true },
    ...common.slice(1),
  ]
}

function createCatalog(scope: CinemaAssetScope): CinemaAssetCatalog {
  const timestamp = nowISO()
  return {
    schemaVersion: CINEMA_ASSET_LIBRARY_SCHEMA_VERSION,
    scope,
    revision: 0,
    status: "ready",
    rootFolderID: CINEMA_ASSET_LIBRARY_ROOT_FOLDER_ID,
    folders: defaultFolderDefinitions(scope).map((folder) => ({
      ...folder,
      depth: folderDepth(folder.relativePath),
      status: "active",
      createdAt: timestamp,
      updatedAt: timestamp,
    })),
    assets: [],
    completedOperationIDs: [],
    operations: {},
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

function isCatalog(input: unknown): input is CinemaAssetCatalog {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false
  const value = input as Partial<CinemaAssetCatalog>
  return value.schemaVersion === 1 &&
    Number.isInteger(value.revision) &&
    (value.status === "ready" || value.status === "recovery-required") &&
    Array.isArray(value.folders) &&
    Array.isArray(value.assets) &&
    (value.operations === undefined || Boolean(value.operations && typeof value.operations === "object"))
}

async function readCatalogFile(filePath: string) {
  const raw = await readFile(filePath, "utf8")
  const parsed: unknown = JSON.parse(raw)
  if (!isCatalog(parsed)) throw new Error("Catalog does not match schema version 1.")
  return {
    ...parsed,
    rootFolderID: parsed.rootFolderID ?? CINEMA_ASSET_LIBRARY_ROOT_FOLDER_ID,
    folders: parsed.folders.map((folder) => ({
      ...folder,
      depth: Number.isInteger(folder.depth) ? folder.depth : folderDepth(folder.relativePath),
    })),
    completedOperationIDs: Array.isArray(parsed.completedOperationIDs) ? parsed.completedOperationIDs : [],
    operations: parsed.operations ?? {},
  }
}

async function readCatalog(paths: CinemaAssetLibraryPaths) {
  try {
    return await readCatalogFile(paths.catalogPath)
  } catch (error) {
    for (const backup of [`${paths.catalogPath}.bak1`, `${paths.catalogPath}.bak2`]) {
      try {
        const recovered = await readCatalogFile(backup)
        return { ...recovered, status: "recovery-required" as const }
      } catch {
        // Try the next backup before surfacing a corruption error.
      }
    }
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") throw error
    throw new ApiError(409, "CINEMA_LIBRARY_CATALOG_INVALID", "Asset library catalog is corrupt and cannot be recovered.")
  }
}

async function readCatalogAssetIndex(paths: CinemaAssetLibraryPaths) {
  const key = path.resolve(paths.catalogPath)
  const info = await lstat(paths.catalogPath)
  if (info.isSymbolicLink() || !info.isFile()) {
    throw new ApiError(400, "CINEMA_LIBRARY_SYMLINK_REJECTED", "The asset library catalog must be a real file.")
  }
  const cached = catalogAssetReadCache.get(key)
  if (cached && cached.mtimeMs === info.mtimeMs && cached.size === info.size) return cached
  const catalog = await readCatalog(paths)
  const next = {
    mtimeMs: info.mtimeMs,
    size: info.size,
    catalog,
    assetsByID: new Map(catalog.assets.map((asset) => [asset.id, asset])),
  }
  catalogAssetReadCache.set(key, next)
  return next
}

async function catalogWithJournalHealth(paths: CinemaAssetLibraryPaths, catalog: CinemaAssetCatalog) {
  const entries = await readdir(paths.operationsRoot, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue
    try {
      const journal = JSON.parse(await readFile(path.join(paths.operationsRoot, entry.name), "utf8")) as {
        operationID?: unknown
        status?: unknown
      }
      if (journal.status !== "pending" && journal.status !== "recovery-required") continue
      if (typeof journal.operationID === "string" && catalog.completedOperationIDs.includes(journal.operationID)) continue
      return { ...catalog, status: "recovery-required" as const }
    } catch {
      return { ...catalog, status: "recovery-required" as const }
    }
  }
  return catalog
}

async function cleanupAbandonedStaging(paths: CinemaAssetLibraryPaths) {
  const stagingRoot = path.join(paths.filesRoot, ".staging")
  const cutoff = Date.now() - 24 * 60 * 60 * 1000
  for (const entry of await readdir(stagingRoot, { withFileTypes: true }).catch(() => [])) {
    const candidate = path.join(stagingRoot, entry.name)
    assertInside(stagingRoot, candidate)
    const info = await stat(candidate).catch(() => undefined)
    if (info && info.mtimeMs < cutoff) await rm(candidate, { recursive: true, force: true }).catch(() => undefined)
  }
}

async function atomicWriteJson(filePath: string, input: unknown, backups = true) {
  if (backups && failNextCatalogWriteForTest) {
    failNextCatalogWriteForTest = false
    throw new Error("Synthetic catalog write failure for asset-library rollback testing.")
  }
  await mkdir(path.dirname(filePath), { recursive: true })
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`
  const handle = await open(temporaryPath, "wx")
  try {
    await handle.writeFile(`${JSON.stringify(input, null, 2)}\n`, "utf8")
    await handle.sync()
  } finally {
    await handle.close()
  }

  try {
    if (backups && await pathExists(filePath)) {
      if (await pathExists(`${filePath}.bak1`)) {
        await copyFile(`${filePath}.bak1`, `${filePath}.bak2`)
      }
      await copyFile(filePath, `${filePath}.bak1`)
    }
    await rename(temporaryPath, filePath)
    catalogAssetReadCache.delete(path.resolve(filePath))
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
    throw error
  }
}

async function ensureInitializedUnlocked(paths: CinemaAssetLibraryPaths) {
  const safetyBoundary = path.dirname(paths.managedRoot)
  await assertNoSymlinkBelowRoot(safetyBoundary, paths.managedRoot)
  await assertNoSymlinkBelowRoot(safetyBoundary, paths.filesRoot)
  await assertNoSymlinkBelowRoot(safetyBoundary, paths.operationsRoot)

  if (paths.scope.type === "project") {
    const marker = path.join(paths.managedRoot, PROJECT_MARKER_FILE)
    await assertNoSymlinkBelowRoot(safetyBoundary, marker)
    if (!(await pathExists(marker))) {
      throw new ApiError(
        404,
        "CINEMA_PROJECT_NOT_INITIALIZED",
        "This project has not been initialized for anybox for cinema yet.",
      )
    }
  }

  await Promise.all([
    mkdir(paths.filesRoot, { recursive: true }),
    mkdir(paths.operationsRoot, { recursive: true }),
    mkdir(path.join(paths.filesRoot, ".staging"), { recursive: true }),
    mkdir(path.join(paths.filesRoot, ".derived"), { recursive: true }),
    mkdir(path.join(paths.filesRoot, ".trash"), { recursive: true }),
  ])

  await Promise.all([
    assertRealDirectory(paths.managedRoot),
    assertRealDirectory(paths.filesRoot),
    assertRealDirectory(paths.operationsRoot),
    assertRealDirectory(path.join(paths.filesRoot, ".staging")),
    assertRealDirectory(path.join(paths.filesRoot, ".derived")),
    assertRealDirectory(path.join(paths.filesRoot, ".trash")),
  ])

  const catalogInfo = await lstat(paths.catalogPath).catch((error: unknown) => {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return undefined
    throw error
  })
  if (catalogInfo?.isSymbolicLink() || catalogInfo && !catalogInfo.isFile()) {
    throw new ApiError(400, "CINEMA_LIBRARY_SYMLINK_REJECTED", "The asset library catalog must be a real file.")
  }

  if (catalogInfo) {
    await cleanupAbandonedStaging(paths)
    return await catalogWithJournalHealth(paths, await readCatalog(paths))
  }

  const catalog = createCatalog(paths.scope)
  for (const folder of catalog.folders) {
    await mkdir(physicalPath(paths, folder.relativePath), { recursive: true })
  }
  await atomicWriteJson(paths.catalogPath, catalog, false)
  return catalog
}

export async function initializeCinemaAssetLibrary(scope: CinemaAssetScope) {
  const paths = resolveLibraryPaths(scope)
  using _lock = await Lock.write(paths.scopeKey)
  const catalog = await ensureInitializedUnlocked(paths)
  return { paths, catalog }
}

async function readLibrary(scope: CinemaAssetScope) {
  const initialized = await initializeCinemaAssetLibrary(scope)
  using _lock = await Lock.read(initialized.paths.scopeKey)
  return { paths: initialized.paths, catalog: await readCatalog(initialized.paths) }
}

function normalizeName(input: string, maxLength: number, label: string) {
  const value = input.normalize("NFC").trim()
  if (!value || value === "." || value === "..") {
    throw new ApiError(400, "CINEMA_LIBRARY_NAME_INVALID", `${label} cannot be empty.`)
  }
  if (value.length > maxLength) {
    throw new ApiError(400, "CINEMA_LIBRARY_NAME_INVALID", `${label} must be at most ${maxLength} characters.`)
  }
  if (INVALID_NAME_PATTERN.test(value) || /[ .]$/.test(value) || WINDOWS_DEVICE_NAME_PATTERN.test(value)) {
    throw new ApiError(400, "CINEMA_LIBRARY_NAME_INVALID", `${label} contains characters that are not allowed.`)
  }
  return value
}

function normalizeFolderName(input: string) {
  return normalizeName(input, 80, "Folder name")
}

function normalizeAssetName(input: string) {
  return normalizeName(input, 160, "Asset name")
}

function assertOperationInput(input: CinemaAssetLibraryMutationInput) {
  if (!OPERATION_ID_PATTERN.test(input.operationID)) {
    throw new ApiError(400, "CINEMA_LIBRARY_OPERATION_ID_INVALID", "operationID must be a safe 1-128 character identifier.")
  }
  if (!Number.isInteger(input.baseRevision) || input.baseRevision < 0) {
    throw new ApiError(400, "CINEMA_LIBRARY_REVISION_INVALID", "baseRevision must be a non-negative integer.")
  }
}

function rootFolder() {
  const timestamp = nowISO()
  return {
    id: CINEMA_ASSET_LIBRARY_ROOT_FOLDER_ID,
    parentID: null,
    name: ROOT_FOLDER_NAME,
    relativePath: "",
    depth: 0,
    system: true,
    status: "active" as const,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

function findFolder(catalog: CinemaAssetCatalog, folderID: string, includeTrashed = false) {
  if (folderID === CINEMA_ASSET_LIBRARY_ROOT_FOLDER_ID) return rootFolder()
  const folder = catalog.folders.find((item) => item.id === folderID)
  if (!folder || !includeTrashed && folder.status !== "active") {
    throw new ApiError(404, "CINEMA_LIBRARY_FOLDER_NOT_FOUND", `Folder '${folderID}' was not found.`)
  }
  return folder
}

function findAsset(catalog: CinemaAssetCatalog, assetID: string) {
  const asset = catalog.assets.find((item) => item.id === assetID)
  if (!asset) throw new ApiError(404, "CINEMA_LIBRARY_ASSET_NOT_FOUND", `Asset '${assetID}' was not found.`)
  return asset
}

function folderDepth(relativePath: string) {
  return relativePath.split("/").filter(Boolean).length
}

function assertFolderDepth(relativePath: string) {
  if (folderDepth(relativePath) > CINEMA_ASSET_LIBRARY_MAX_FOLDER_DEPTH) {
    throw new ApiError(
      400,
      "CINEMA_LIBRARY_FOLDER_DEPTH_EXCEEDED",
      `Folders can be nested at most ${CINEMA_ASSET_LIBRARY_MAX_FOLDER_DEPTH} levels deep.`,
    )
  }
}

function sameName(left: string, right: string) {
  return left.normalize("NFC").localeCompare(right.normalize("NFC"), undefined, { sensitivity: "accent" }) === 0
}

async function assertNameAvailable(directory: string, filename: string, currentFilename?: string) {
  const names = await readdir(directory)
  if (names.some((item) => sameName(item, filename) && (!currentFilename || !sameName(item, currentFilename)))) {
    throw new ApiError(409, "CINEMA_LIBRARY_NAME_CONFLICT", `'${filename}' already exists in the destination folder.`)
  }
}

async function uniqueFilename(directory: string, displayName: string, extension: string) {
  const names = await readdir(directory)
  const used = new Set(names.map((item) => item.normalize("NFC").toLocaleLowerCase()))
  let suffix = 1
  while (true) {
    const candidate = `${displayName}${suffix === 1 ? "" : ` (${suffix})`}${extension}`
    if (!used.has(candidate.normalize("NFC").toLocaleLowerCase())) return candidate
    suffix += 1
  }
}

function breadcrumbs(catalog: CinemaAssetCatalog, folderID: string) {
  const result: CinemaAssetFolder[] = []
  let current = findFolder(catalog, folderID)
  const seen = new Set<string>()
  while (current.id !== CINEMA_ASSET_LIBRARY_ROOT_FOLDER_ID) {
    if (seen.has(current.id)) throw new ApiError(409, "CINEMA_LIBRARY_CATALOG_INVALID", "Folder hierarchy contains a cycle.")
    seen.add(current.id)
    result.unshift(current)
    current = findFolder(catalog, current.parentID ?? CINEMA_ASSET_LIBRARY_ROOT_FOLDER_ID)
  }
  return [rootFolder(), ...result]
}

function encodeCursor(revision: number, view: CinemaAssetLibraryEntriesView, offset: number) {
  return Buffer.from(`${revision}:${view}:${offset}`, "utf8").toString("base64url")
}

function decodeCursor(cursor: string | undefined, revision: number, view: CinemaAssetLibraryEntriesView) {
  if (!cursor) return 0
  let decoded = ""
  try {
    decoded = Buffer.from(cursor, "base64url").toString("utf8")
  } catch {
    throw new ApiError(400, "CINEMA_LIBRARY_CURSOR_INVALID", "Cursor is invalid.")
  }
  const match = decoded.match(/^(\d+):(library|trash):(\d+)$/)
  if (!match) throw new ApiError(400, "CINEMA_LIBRARY_CURSOR_INVALID", "Cursor is invalid.")
  if (Number(match[1]) !== revision) {
    throw new ApiError(
      409,
      "CINEMA_LIBRARY_CURSOR_STALE",
      `Cursor is stale; latest revision is ${revision}.`,
      { latestRevision: revision },
    )
  }
  if (match[2] !== view) {
    throw new ApiError(400, "CINEMA_LIBRARY_CURSOR_INVALID", "Cursor belongs to a different asset library view.")
  }
  return Number(match[3])
}

function compareNames(left: string, right: string) {
  return left.localeCompare(right, "zh-CN", { sensitivity: "base", numeric: true })
}

function flattenFolderEntry(folder: CinemaAssetFolder): CinemaAssetLibraryEntry {
  return { entryType: "folder", folder }
}

function flattenAssetEntry(asset: CinemaAssetRecord): CinemaAssetLibraryEntry {
  return { entryType: "asset", asset }
}

export async function getCinemaAssetLibraryState(scope: CinemaAssetScope) {
  const { catalog } = await readLibrary(scope)
  return {
    scope: catalog.scope,
    revision: catalog.revision,
    status: catalog.status,
    readOnly: catalog.status !== "ready",
    rootFolderID: CINEMA_ASSET_LIBRARY_ROOT_FOLDER_ID,
    counts: {
      folders: catalog.folders.filter((item) => item.status === "active").length,
      assets: catalog.assets.filter((item) => item.status !== "trashed").length,
      processing: catalog.assets.filter((item) => item.status === "processing" || item.status === "uploading").length,
      failed: catalog.assets.filter((item) => item.status === "failed").length,
      missing: catalog.assets.filter((item) => item.status === "missing").length +
        catalog.folders.filter((item) => item.status === "missing").length,
      trashed: catalog.assets.filter((item) => item.status === "trashed").length +
        catalog.folders.filter((item) => item.status === "trashed").length,
    },
    updatedAt: catalog.updatedAt,
    defaultFolderIDs: Object.fromEntries(defaultFolderDefinitions(scope).map((folder) => [folder.id, folder.id])),
    limits: {
      maxFolderDepth: CINEMA_ASSET_LIBRARY_MAX_FOLDER_DEPTH,
      maxImageBytes: CINEMA_ASSET_LIBRARY_LIMITS.image,
      maxVideoBytes: CINEMA_ASSET_LIBRARY_LIMITS.video,
      maxAudioBytes: CINEMA_ASSET_LIBRARY_LIMITS.audio,
    },
  }
}

export interface ListCinemaAssetLibraryEntriesOptions {
  folderID?: string
  q?: string
  cursor?: string
  limit?: number
  view?: CinemaAssetLibraryEntriesView
}

function topLevelTrashedEntries(catalog: CinemaAssetCatalog) {
  const trashedFolders = catalog.folders.filter((item) => item.status === "trashed" && item.trash)
  const folders = trashedFolders.filter((folder) => !trashedFolders.some((ancestor) => (
    ancestor.id !== folder.id
    && ancestor.trash!.operationID === folder.trash!.operationID
    && folder.trash!.originalRelativePath.startsWith(`${ancestor.trash!.originalRelativePath}/`)
  )))
  const assets = catalog.assets.filter((asset) => (
    asset.status === "trashed"
    && asset.trash
    && !trashedFolders.some((ancestor) => (
      ancestor.trash!.operationID === asset.trash!.operationID
      && asset.trash!.originalRelativePath.startsWith(`${ancestor.trash!.originalRelativePath}/`)
    ))
  ))
  return { folders, assets }
}

export async function listCinemaAssetLibraryEntries(
  scope: CinemaAssetScope,
  options: ListCinemaAssetLibraryEntriesOptions = {},
) {
  const { catalog } = await readLibrary(scope)
  const view = options.view ?? "library"
  const folderID = options.folderID?.trim() || CINEMA_ASSET_LIBRARY_ROOT_FOLDER_ID
  const query = options.q?.normalize("NFC").trim() ?? ""
  const limit = Math.min(
    CINEMA_ASSET_LIBRARY_MAX_PAGE_SIZE,
    Math.max(1, options.limit ?? CINEMA_ASSET_LIBRARY_DEFAULT_PAGE_SIZE),
  )
  const offset = decodeCursor(options.cursor, catalog.revision, view)

  const folder = view === "library" ? findFolder(catalog, folderID) : undefined
  let { folders, assets } = view === "trash"
    ? topLevelTrashedEntries(catalog)
    : {
        folders: catalog.folders.filter((item) => item.status === "active" && (!query ? item.parentID === folderID : true)),
        assets: catalog.assets.filter((item) => item.status !== "trashed" && (!query ? item.folderID === folderID : true)),
      }
  if (query) {
    const folderMatches = new Set(fuzzysort.go(query, folders, { key: "name", threshold: -10000 }).map((item) => item.obj.id))
    const assetMatches = new Set(fuzzysort.go(query, assets, { key: "displayName", threshold: -10000 }).map((item) => item.obj.id))
    const normalizedQuery = query.toLocaleLowerCase()
    folders = folders.filter((item) => folderMatches.has(item.id) || (
      view === "trash" ? item.trash?.originalRelativePath : item.relativePath
    )?.toLocaleLowerCase().includes(normalizedQuery))
    assets = assets.filter((item) => assetMatches.has(item.id) || (
      view === "trash" ? item.trash?.originalRelativePath : item.relativePath
    )?.toLocaleLowerCase().includes(normalizedQuery))
  }
  folders.sort((left, right) => compareNames(left.name, right.name))
  assets.sort((left, right) => compareNames(left.displayName, right.displayName))

  const allEntries: CinemaAssetLibraryEntry[] = [
    ...folders.map(flattenFolderEntry),
    ...assets.map(flattenAssetEntry),
  ]
  const entries = allEntries.slice(offset, offset + limit)
  const nextOffset = offset + entries.length
  return {
    scope: catalog.scope,
    revision: catalog.revision,
    view,
    folder: !folder || folder.id === CINEMA_ASSET_LIBRARY_ROOT_FOLDER_ID ? null : folder,
    breadcrumbs: folder ? breadcrumbs(catalog, folder.id) : [],
    entries,
    nextCursor: nextOffset < allEntries.length ? encodeCursor(catalog.revision, view, nextOffset) : null,
    total: allEntries.length,
    query,
  }
}

type MutationAction<T extends Record<string, unknown>> = (
  catalog: CinemaAssetCatalog,
  paths: CinemaAssetLibraryPaths,
) => Promise<{
  value: T
  rollback?: () => Promise<void>
  afterCommit?: () => Promise<void>
}>

async function mutateLibrary<T extends Record<string, unknown>>(
  scope: CinemaAssetScope,
  input: CinemaAssetLibraryMutationInput,
  type: string,
  action: MutationAction<T>,
): Promise<{
  scope: CinemaAssetScope
  operationID: string
  revision: number
  affected: CinemaAssetLibraryEntryRef[]
  warnings: string[]
} & T> {
  assertOperationInput(input)
  const paths = resolveLibraryPaths(scope)
  using _lock = await Lock.write(paths.scopeKey)
  const catalog = await ensureInitializedUnlocked(paths)
  const previous = catalog.operations[input.operationID]
  if (previous) return previous.result as {
    scope: CinemaAssetScope
    operationID: string
    revision: number
    affected: CinemaAssetLibraryEntryRef[]
    warnings: string[]
  } & T
  if (catalog.status !== "ready") {
    throw new ApiError(409, "CINEMA_LIBRARY_RECOVERY_REQUIRED", "Asset library is read-only until recovery completes.")
  }
  if (catalog.revision !== input.baseRevision) {
    throw new ApiError(
      409,
      "CINEMA_LIBRARY_REVISION_CONFLICT",
      `Asset library revision conflict; latest revision is ${catalog.revision}.`,
      { latestRevision: catalog.revision },
    )
  }

  const journalPath = path.join(
    paths.operationsRoot,
    `${Buffer.from(input.operationID, "utf8").toString("base64url")}.json`,
  )
  assertInside(paths.operationsRoot, journalPath)
  const startedAt = nowISO()
  await atomicWriteJson(journalPath, {
    operationID: input.operationID,
    type,
    status: "pending",
    baseRevision: input.baseRevision,
    startedAt,
  }, false)

  let outcome: Awaited<ReturnType<MutationAction<T>>>
  let keepExistingJournalStatus = false
  try {
    outcome = await action(catalog, paths)
    const timestamp = nowISO()
    catalog.revision += 1
    catalog.updatedAt = timestamp
    const warnings: string[] = []
    const response = {
      scope: catalog.scope,
      operationID: input.operationID,
      revision: catalog.revision,
      affected: [],
      warnings,
      ...outcome.value,
    }
    catalog.operations[input.operationID] = {
      operationID: input.operationID,
      type,
      revision: catalog.revision,
      completedAt: timestamp,
      result: response,
    }
    catalog.completedOperationIDs = [...catalog.completedOperationIDs.filter((item) => item !== input.operationID), input.operationID]
      .slice(-MAX_OPERATION_HISTORY)
    const operationIDs = Object.keys(catalog.operations)
    for (const operationID of operationIDs.slice(0, Math.max(0, operationIDs.length - MAX_OPERATION_HISTORY))) {
      delete catalog.operations[operationID]
    }
    try {
      await atomicWriteJson(paths.catalogPath, catalog)
    } catch (error) {
      try {
        if (outcome.rollback) await outcome.rollback()
        keepExistingJournalStatus = true
        await atomicWriteJson(journalPath, {
          operationID: input.operationID,
          type,
          status: "rolled-back",
          baseRevision: input.baseRevision,
          startedAt,
          failedAt: nowISO(),
        }, false)
      } catch (rollbackError) {
        keepExistingJournalStatus = true
        await atomicWriteJson(journalPath, {
          operationID: input.operationID,
          type,
          status: "recovery-required",
          baseRevision: input.baseRevision,
          startedAt,
          failedAt: nowISO(),
          error: rollbackError instanceof Error ? rollbackError.message.slice(0, 1000) : "Filesystem rollback failed.",
        }, false).catch(() => undefined)
        throw new ApiError(
          409,
          "CINEMA_LIBRARY_RECOVERY_REQUIRED",
          "The asset operation could not be rolled back completely; the library is now read-only until recovery.",
        )
      }
      throw error
    }

    if (outcome.afterCommit) {
      try {
        await outcome.afterCommit()
      } catch {
        warnings.push("The catalog was committed, but deferred filesystem cleanup could not be completed.")
      }
    }

    await atomicWriteJson(journalPath, {
      operationID: input.operationID,
      type,
      status: "committed",
      baseRevision: input.baseRevision,
      revision: catalog.revision,
      startedAt,
      completedAt: timestamp,
    }, false).catch(() => undefined)
    return response
  } catch (error) {
    if (!keepExistingJournalStatus) {
      await atomicWriteJson(journalPath, {
        operationID: input.operationID,
        type,
        status: "failed",
        baseRevision: input.baseRevision,
        startedAt,
        failedAt: nowISO(),
      }, false).catch(() => undefined)
    }
    throw error
  }
}

export interface CreateCinemaAssetFolderInput extends CinemaAssetLibraryMutationInput {
  name: string
  parentFolderID: string
}

export async function createCinemaAssetFolder(scope: CinemaAssetScope, input: CreateCinemaAssetFolderInput) {
  return await mutateLibrary(scope, input, "create-folder", async (catalog, paths) => {
    const parent = findFolder(catalog, input.parentFolderID)
    const name = normalizeFolderName(input.name)
    const relativePath = toRelativePath(parent.relativePath, name)
    assertFolderDepth(relativePath)
    const parentPath = physicalPath(paths, parent.relativePath)
    await assertNoSymlinkBelowRoot(paths.filesRoot, parentPath)
    await assertNameAvailable(parentPath, name)
    const folderPath = physicalPath(paths, relativePath)
    await mkdir(folderPath)
    const timestamp = nowISO()
    const folder: CinemaAssetFolder = {
      id: `folder_${randomUUID()}`,
      parentID: parent.id,
      name,
      relativePath,
      depth: folderDepth(relativePath),
      system: false,
      status: "active",
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    catalog.folders.push(folder)
    return {
      value: { folder },
      rollback: async () => {
        await rm(folderPath, { recursive: true, force: true })
      },
    }
  })
}

function updateFolderPathPrefix(
  catalog: CinemaAssetCatalog,
  folder: CinemaAssetFolder,
  oldPrefix: string,
  nextPrefix: string,
  nextParentID: string,
) {
  const timestamp = nowISO()
  for (const item of catalog.folders) {
    if (item.relativePath !== oldPrefix && !item.relativePath.startsWith(`${oldPrefix}/`)) continue
    const suffix = item.relativePath.slice(oldPrefix.length).replace(/^\//, "")
    item.relativePath = suffix ? toRelativePath(nextPrefix, suffix) : nextPrefix
    item.depth = folderDepth(item.relativePath)
    item.updatedAt = timestamp
  }
  for (const asset of catalog.assets) {
    if (asset.relativePath !== oldPrefix && !asset.relativePath.startsWith(`${oldPrefix}/`)) continue
    const suffix = asset.relativePath.slice(oldPrefix.length).replace(/^\//, "")
    asset.relativePath = suffix ? toRelativePath(nextPrefix, suffix) : nextPrefix
    asset.updatedAt = timestamp
  }
  folder.parentID = nextParentID
  folder.name = path.posix.basename(nextPrefix)
}

function descendantFolderDepth(catalog: CinemaAssetCatalog, folder: CinemaAssetFolder) {
  return catalog.folders
    .filter((item) => item.relativePath === folder.relativePath || item.relativePath.startsWith(`${folder.relativePath}/`))
    .reduce((maximum, item) => Math.max(maximum, folderDepth(item.relativePath) - folder.depth), 0)
}

export interface UpdateCinemaAssetFolderInput extends CinemaAssetLibraryMutationInput {
  name?: string
  parentFolderID?: string
}

export async function updateCinemaAssetFolder(
  scope: CinemaAssetScope,
  folderID: string,
  input: UpdateCinemaAssetFolderInput,
) {
  return await mutateLibrary(scope, input, "update-folder", async (catalog, paths) => {
    const folder = findFolder(catalog, folderID)
    if (folder.id === CINEMA_ASSET_LIBRARY_ROOT_FOLDER_ID || folder.system) {
      throw new ApiError(409, "CINEMA_LIBRARY_SYSTEM_FOLDER", "System folders cannot be renamed or moved.")
    }
    const parent = findFolder(catalog, input.parentFolderID ?? folder.parentID ?? CINEMA_ASSET_LIBRARY_ROOT_FOLDER_ID)
    if (parent.id === folder.id || parent.relativePath.startsWith(`${folder.relativePath}/`)) {
      throw new ApiError(400, "CINEMA_LIBRARY_FOLDER_CYCLE", "A folder cannot be moved into itself or its descendant.")
    }
    const name = input.name === undefined ? folder.name : normalizeFolderName(input.name)
    const oldRelativePath = folder.relativePath
    const nextRelativePath = toRelativePath(parent.relativePath, name)
    const deepestRelativeDepth = descendantFolderDepth(catalog, folder)
    if (folderDepth(nextRelativePath) + deepestRelativeDepth > CINEMA_ASSET_LIBRARY_MAX_FOLDER_DEPTH) {
      throw new ApiError(400, "CINEMA_LIBRARY_FOLDER_DEPTH_EXCEEDED", "Moving this folder would exceed the maximum depth.")
    }
    if (nextRelativePath === oldRelativePath && parent.id === folder.parentID) return { value: { folder } }

    const oldPath = physicalPath(paths, oldRelativePath)
    const nextParentPath = physicalPath(paths, parent.relativePath)
    const nextPath = physicalPath(paths, nextRelativePath)
    await assertNoSymlinkBelowRoot(paths.filesRoot, oldPath)
    await assertNoSymlinkBelowRoot(paths.filesRoot, nextParentPath)
    await assertNameAvailable(nextParentPath, name, parent.id === folder.parentID ? folder.name : undefined)
    await rename(oldPath, nextPath)
    updateFolderPathPrefix(catalog, folder, oldRelativePath, nextRelativePath, parent.id)
    return {
      value: { folder },
      rollback: async () => {
        await rename(nextPath, oldPath)
      },
    }
  })
}

export interface UpdateCinemaAssetInput extends CinemaAssetLibraryMutationInput {
  baseName: string
}

function assertAssetNotProcessing(asset: CinemaAssetRecord, action: string) {
  if (asset.status === "processing" || asset.status === "uploading") {
    throw new ApiError(
      409,
      "CINEMA_LIBRARY_ASSET_PROCESSING",
      `Wait for media processing to finish before ${action} this asset.`,
    )
  }
}

export async function updateCinemaAsset(
  scope: CinemaAssetScope,
  assetID: string,
  input: UpdateCinemaAssetInput,
) {
  return await mutateLibrary(scope, input, "update-asset", async (catalog, paths) => {
    const asset = findAsset(catalog, assetID)
    assertAssetNotProcessing(asset, "renaming")
    if (asset.status === "trashed") {
      throw new ApiError(409, "CINEMA_LIBRARY_ASSET_TRASHED", "Restore the asset before renaming it.")
    }
    if (asset.status === "missing") {
      throw new ApiError(409, "CINEMA_LIBRARY_ASSET_MISSING", "Relink the missing asset before renaming it.")
    }
    const displayName = normalizeAssetName(input.baseName)
    const extension = path.posix.extname(asset.relativePath)
    const filename = `${displayName}${extension}`
    const folder = findFolder(catalog, asset.folderID)
    const directory = physicalPath(paths, folder.relativePath)
    const oldPath = physicalPath(paths, asset.relativePath)
    const nextRelativePath = toRelativePath(folder.relativePath, filename)
    const nextPath = physicalPath(paths, nextRelativePath)
    await assertNoSymlinkBelowRoot(paths.filesRoot, oldPath)
    await assertNameAvailable(directory, filename, path.posix.basename(asset.relativePath))
    if (oldPath !== nextPath) await rename(oldPath, nextPath)
    asset.displayName = displayName
    asset.relativePath = nextRelativePath
    asset.updatedAt = nowISO()
    return {
      value: { asset },
      rollback: oldPath === nextPath ? undefined : async () => {
        await rename(nextPath, oldPath)
      },
    }
  })
}

export async function getCinemaAsset(scope: CinemaAssetScope, assetID: string) {
  const paths = resolveLibraryPaths(scope)
  if (!(await pathExists(paths.catalogPath))) await initializeCinemaAssetLibrary(scope)
  using _lock = await Lock.read(paths.scopeKey)
  const index = await readCatalogAssetIndex(paths)
  const asset = index.assetsByID.get(assetID)
  if (!asset) throw new ApiError(404, "CINEMA_LIBRARY_ASSET_NOT_FOUND", `Asset '${assetID}' was not found.`)
  return {
    revision: index.catalog.revision,
    asset: { ...asset, ...(asset.trash ? { trash: { ...asset.trash } } : {}) },
  }
}

function deduplicateEntryRefs(catalog: CinemaAssetCatalog, entries: CinemaAssetLibraryEntryRef[]) {
  const seen = new Set<string>()
  const unique = entries.filter((entry) => {
    const key = entry.entryType === "folder" ? `folder:${entry.folderID}` : `asset:${entry.assetID}`
    if (seen.has(key)) return false
    seen.add(key)
    if (entry.entryType === "folder") findFolder(catalog, entry.folderID, true)
    else findAsset(catalog, entry.assetID)
    return true
  })
  const selectedFolderPaths = unique
    .filter((entry): entry is { entryType: "folder"; folderID: string } => entry.entryType === "folder")
    .map((entry) => findFolder(catalog, entry.folderID, true).relativePath)
  return unique.filter((entry) => {
    const relativePath = entry.entryType === "folder"
      ? findFolder(catalog, entry.folderID, true).relativePath
      : findAsset(catalog, entry.assetID).relativePath
    return !selectedFolderPaths.some((folderPath) => relativePath !== folderPath && relativePath.startsWith(`${folderPath}/`))
  })
}

function assertEntryRefs(input: CinemaAssetLibraryEntryRef[]) {
  if (!Array.isArray(input) || input.length === 0 || input.length > 1000) {
    throw new ApiError(400, "CINEMA_LIBRARY_SELECTION_INVALID", "Select between 1 and 1000 entries.")
  }
  for (const entry of input) {
    if (!entry || (entry.entryType !== "folder" && entry.entryType !== "asset") ||
      (entry.entryType === "folder" ? !entry.folderID?.trim() : !entry.assetID?.trim())) {
      throw new ApiError(400, "CINEMA_LIBRARY_SELECTION_INVALID", "Selection contains an invalid entry reference.")
    }
  }
}

export interface MoveCinemaAssetEntriesInput extends CinemaAssetLibraryMutationInput {
  entries: CinemaAssetLibraryEntryRef[]
  destinationFolderID: string
}

export async function moveCinemaAssetEntries(scope: CinemaAssetScope, input: MoveCinemaAssetEntriesInput) {
  assertEntryRefs(input.entries)
  return await mutateLibrary(scope, input, "move", async (catalog, paths) => {
    const destination = findFolder(catalog, input.destinationFolderID)
    const destinationPath = physicalPath(paths, destination.relativePath)
    await assertNoSymlinkBelowRoot(paths.filesRoot, destinationPath)
    const selected = deduplicateEntryRefs(catalog, input.entries)
    const moves: Array<{ source: string; destination: string }> = []
    const entries: CinemaAssetLibraryEntryRef[] = []

    for (const entry of selected) {
      if (entry.entryType === "folder") {
        const folder = findFolder(catalog, entry.folderID)
        await assertNoSymlinkBelowRoot(paths.filesRoot, physicalPath(paths, folder.relativePath))
        const processingChild = catalog.assets.find((asset) => (
          asset.relativePath.startsWith(`${folder.relativePath}/`)
          && (asset.status === "processing" || asset.status === "uploading")
        ))
        if (processingChild) assertAssetNotProcessing(processingChild, "moving")
        if (folder.system) throw new ApiError(409, "CINEMA_LIBRARY_SYSTEM_FOLDER", "System folders cannot be moved.")
        if (destination.id === folder.id || destination.relativePath.startsWith(`${folder.relativePath}/`)) {
          throw new ApiError(400, "CINEMA_LIBRARY_FOLDER_CYCLE", "A folder cannot be moved into itself or its descendant.")
        }
        const nextRelativePath = toRelativePath(destination.relativePath, folder.name)
        if (folderDepth(nextRelativePath) + descendantFolderDepth(catalog, folder) > CINEMA_ASSET_LIBRARY_MAX_FOLDER_DEPTH) {
          throw new ApiError(400, "CINEMA_LIBRARY_FOLDER_DEPTH_EXCEEDED", "Moving this folder would exceed the maximum depth.")
        }
        if (nextRelativePath === folder.relativePath) continue
        await assertNameAvailable(destinationPath, folder.name)
        moves.push({ source: folder.relativePath, destination: nextRelativePath })
        entries.push(entry)
      } else {
        const asset = findAsset(catalog, entry.assetID)
        assertAssetNotProcessing(asset, "moving")
        if (asset.status === "trashed") throw new ApiError(409, "CINEMA_LIBRARY_ASSET_TRASHED", "Restore the asset before moving it.")
        await assertNoSymlinkBelowRoot(paths.filesRoot, physicalPath(paths, asset.relativePath))
        const filename = path.posix.basename(asset.relativePath)
        const nextRelativePath = toRelativePath(destination.relativePath, filename)
        if (nextRelativePath === asset.relativePath) continue
        await assertNameAvailable(destinationPath, filename)
        moves.push({ source: asset.relativePath, destination: nextRelativePath })
        entries.push(entry)
      }
    }

    const completed: Array<{ source: string; destination: string }> = []
    try {
      for (const move of moves) {
        await rename(physicalPath(paths, move.source), physicalPath(paths, move.destination))
        completed.push(move)
      }
    } catch (error) {
      for (const move of completed.reverse()) {
        await rename(physicalPath(paths, move.destination), physicalPath(paths, move.source)).catch(() => undefined)
      }
      throw error
    }

    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index]!
      const move = moves[index]!
      if (entry.entryType === "folder") {
        const folder = findFolder(catalog, entry.folderID)
        const processingChild = catalog.assets.find((asset) => (
          asset.relativePath.startsWith(`${folder.relativePath}/`)
          && (asset.status === "processing" || asset.status === "uploading")
        ))
        if (processingChild) assertAssetNotProcessing(processingChild, "moving to trash")
        updateFolderPathPrefix(catalog, folder, move.source, move.destination, destination.id)
      } else {
        const asset = findAsset(catalog, entry.assetID)
        assertAssetNotProcessing(asset, "moving to trash")
        asset.folderID = destination.id
        asset.relativePath = move.destination
        asset.updatedAt = nowISO()
      }
    }
    return {
      value: { affected: entries },
      rollback: async () => {
        for (const move of completed.reverse()) {
          await rename(physicalPath(paths, move.destination), physicalPath(paths, move.source))
        }
      },
    }
  })
}

export interface TrashCinemaAssetEntriesInput extends CinemaAssetLibraryMutationInput {
  entries: CinemaAssetLibraryEntryRef[]
}

function restorableAssetStatus(status: CinemaAssetRecord["status"]): "ready" | "failed" | "missing" {
  if (status === "failed" || status === "missing") return status
  return "ready"
}

function entriesUnderFolders(catalog: CinemaAssetCatalog, folderPaths: string[]) {
  const folderIDs = new Set(
    catalog.folders
      .filter((folder) => folderPaths.some((prefix) => folder.relativePath === prefix || folder.relativePath.startsWith(`${prefix}/`)))
      .map((folder) => folder.id),
  )
  const assetIDs = new Set(
    catalog.assets
      .filter((asset) => folderPaths.some((prefix) => asset.relativePath.startsWith(`${prefix}/`)))
      .map((asset) => asset.id),
  )
  return { folderIDs, assetIDs }
}

export async function trashCinemaAssetEntries(scope: CinemaAssetScope, input: TrashCinemaAssetEntriesInput) {
  assertEntryRefs(input.entries)
  return await mutateLibrary(scope, input, "trash", async (catalog, paths) => {
    const selected = deduplicateEntryRefs(catalog, input.entries).filter((entry) =>
      entry.entryType === "folder"
        ? findFolder(catalog, entry.folderID, true).status !== "trashed"
        : findAsset(catalog, entry.assetID).status !== "trashed"
    )
    const trashOperationRelativePath = toRelativePath(".trash", input.operationID)
    const trashOperationPath = physicalPath(paths, trashOperationRelativePath)
    const moves: Array<{ source: string; destination: string; physical: boolean }> = []

    for (const entry of selected) {
      if (entry.entryType === "folder") {
        const folder = findFolder(catalog, entry.folderID)
        const processingChild = catalog.assets.find((asset) => (
          asset.relativePath.startsWith(`${folder.relativePath}/`)
          && (asset.status === "processing" || asset.status === "uploading")
        ))
        if (processingChild) assertAssetNotProcessing(processingChild, "moving to trash")
        if (folder.system) throw new ApiError(409, "CINEMA_LIBRARY_SYSTEM_FOLDER", "System folders cannot be moved to trash.")
        await assertNoSymlinkBelowRoot(paths.filesRoot, physicalPath(paths, folder.relativePath))
        moves.push({
          source: folder.relativePath,
          destination: toRelativePath(trashOperationRelativePath, `${folder.id}-${folder.name}`),
          physical: true,
        })
      } else {
        const asset = findAsset(catalog, entry.assetID)
        if (asset.status === "trashed") continue
        assertAssetNotProcessing(asset, "moving to trash")
        const source = physicalPath(paths, asset.relativePath)
        await assertNoSymlinkBelowRoot(paths.filesRoot, source)
        moves.push({
          source: asset.relativePath,
          destination: toRelativePath(trashOperationRelativePath, `${asset.id}-${path.posix.basename(asset.relativePath)}`),
          physical: asset.status !== "missing" || await pathExists(source),
        })
      }
    }

    await assertNoSymlinkBelowRoot(paths.filesRoot, physicalPath(paths, ".trash"))
    await mkdir(trashOperationPath, { recursive: true })
    await assertNoSymlinkBelowRoot(paths.filesRoot, trashOperationPath)

    const completed: Array<{ source: string; destination: string }> = []
    try {
      for (const move of moves) {
        if (!move.physical) continue
        await rename(physicalPath(paths, move.source), physicalPath(paths, move.destination))
        completed.push(move)
      }
    } catch (error) {
      for (const move of completed.slice().reverse()) {
        await rename(physicalPath(paths, move.destination), physicalPath(paths, move.source)).catch(() => undefined)
      }
      throw error
    }

    const timestamp = nowISO()
    const trashedEntries: CinemaAssetLibraryEntryRef[] = []
    for (let index = 0; index < selected.length; index += 1) {
      const entry = selected[index]!
      const move = moves[index]
      if (!move) continue
      if (entry.entryType === "folder") {
        const folder = findFolder(catalog, entry.folderID)
        const oldPrefix = folder.relativePath
        const related = entriesUnderFolders(catalog, [oldPrefix])
        for (const child of catalog.folders.filter((item) => related.folderIDs.has(item.id))) {
          const originalRelativePath = child.relativePath
          const suffix = originalRelativePath.slice(oldPrefix.length).replace(/^\//, "")
          child.relativePath = suffix ? toRelativePath(move.destination, suffix) : move.destination
          child.depth = folderDepth(child.relativePath)
          child.status = "trashed"
          child.trash = {
            operationID: input.operationID,
            originalParentID: child.parentID ?? CINEMA_ASSET_LIBRARY_ROOT_FOLDER_ID,
            originalRelativePath,
            trashedRelativePath: child.relativePath,
            trashedAt: timestamp,
          }
          child.updatedAt = timestamp
        }
        for (const asset of catalog.assets.filter((item) => related.assetIDs.has(item.id))) {
          const originalRelativePath = asset.relativePath
          const suffix = originalRelativePath.slice(oldPrefix.length).replace(/^\//, "")
          const previousStatus = restorableAssetStatus(asset.status)
          asset.relativePath = suffix ? toRelativePath(move.destination, suffix) : move.destination
          asset.status = "trashed"
          asset.trash = {
            operationID: input.operationID,
            originalFolderID: asset.folderID,
            originalRelativePath,
            trashedRelativePath: asset.relativePath,
            trashedAt: timestamp,
            previousStatus,
          }
          asset.updatedAt = timestamp
        }
      } else {
        const asset = findAsset(catalog, entry.assetID)
        asset.trash = {
          operationID: input.operationID,
          originalFolderID: asset.folderID,
          originalRelativePath: asset.relativePath,
          trashedRelativePath: move.destination,
          trashedAt: timestamp,
          previousStatus: restorableAssetStatus(asset.status),
        }
        asset.relativePath = move.destination
        asset.status = "trashed"
        asset.updatedAt = timestamp
      }
      trashedEntries.push(entry)
    }

    return {
      value: { affected: trashedEntries },
      rollback: async () => {
        for (const move of completed.slice().reverse()) {
          await rename(physicalPath(paths, move.destination), physicalPath(paths, move.source))
        }
      },
    }
  })
}

function findInbox(catalog: CinemaAssetCatalog) {
  return findFolder(catalog, "inbox")
}

async function uniqueFolderName(directory: string, name: string) {
  const names = await readdir(directory)
  const used = new Set(names.map((item) => item.normalize("NFC").toLocaleLowerCase()))
  let suffix = 1
  while (true) {
    const candidate = `${name}${suffix === 1 ? "" : ` (${suffix})`}`
    if (!used.has(candidate.normalize("NFC").toLocaleLowerCase())) return candidate
    suffix += 1
  }
}

export async function restoreCinemaAssetEntries(scope: CinemaAssetScope, input: TrashCinemaAssetEntriesInput) {
  assertEntryRefs(input.entries)
  return await mutateLibrary(scope, input, "restore", async (catalog, paths) => {
    const selected = deduplicateEntryRefs(catalog, input.entries)
    const moves: Array<{ source: string; destination: string; physical: boolean }> = []
    const restoredEntries: CinemaAssetLibraryEntryRef[] = []

    for (const entry of selected) {
      if (entry.entryType === "folder") {
        const folder = findFolder(catalog, entry.folderID, true)
        if (folder.status !== "trashed" || !folder.trash) continue
        let parent = folder.trash.originalParentID === CINEMA_ASSET_LIBRARY_ROOT_FOLDER_ID
          ? rootFolder()
          : catalog.folders.find((item) => item.id === folder.trash!.originalParentID && item.status === "active")
        parent ??= findInbox(catalog)
        await assertNoSymlinkBelowRoot(paths.filesRoot, physicalPath(paths, folder.relativePath))
        await assertNoSymlinkBelowRoot(paths.filesRoot, physicalPath(paths, parent.relativePath))
        const originalName = path.posix.basename(folder.trash.originalRelativePath)
        const name = await uniqueFolderName(physicalPath(paths, parent.relativePath), originalName)
        const nextRelativePath = toRelativePath(parent.relativePath, name)
        if (folderDepth(nextRelativePath) + descendantFolderDepth(catalog, folder) > CINEMA_ASSET_LIBRARY_MAX_FOLDER_DEPTH) {
          parent = findInbox(catalog)
        }
        const finalName = parent.id === "inbox" && folderDepth(nextRelativePath) + descendantFolderDepth(catalog, folder) > CINEMA_ASSET_LIBRARY_MAX_FOLDER_DEPTH
          ? await uniqueFolderName(physicalPath(paths, parent.relativePath), originalName)
          : name
        const destination = toRelativePath(parent.relativePath, finalName)
        moves.push({ source: folder.relativePath, destination, physical: true })
        restoredEntries.push(entry)
      } else {
        const asset = findAsset(catalog, entry.assetID)
        if (asset.status !== "trashed" || !asset.trash) continue
        const parent = catalog.folders.find((item) => item.id === asset.trash!.originalFolderID && item.status === "active") ?? findInbox(catalog)
        await assertNoSymlinkBelowRoot(paths.filesRoot, physicalPath(paths, asset.relativePath))
        await assertNoSymlinkBelowRoot(paths.filesRoot, physicalPath(paths, parent.relativePath))
        const originalFilename = path.posix.basename(asset.trash.originalRelativePath)
        const extension = path.posix.extname(originalFilename)
        const originalName = path.posix.basename(originalFilename, extension)
        const filename = await uniqueFilename(physicalPath(paths, parent.relativePath), originalName, extension)
        moves.push({
          source: asset.relativePath,
          destination: toRelativePath(parent.relativePath, filename),
          physical: asset.trash.previousStatus !== "missing" || await pathExists(physicalPath(paths, asset.relativePath)),
        })
        restoredEntries.push(entry)
      }
    }

    const completed: Array<{ source: string; destination: string }> = []
    try {
      for (const move of moves) {
        if (!move.physical) continue
        await rename(physicalPath(paths, move.source), physicalPath(paths, move.destination))
        completed.push(move)
      }
    } catch (error) {
      for (const move of completed.slice().reverse()) {
        await rename(physicalPath(paths, move.destination), physicalPath(paths, move.source)).catch(() => undefined)
      }
      throw error
    }

    const timestamp = nowISO()
    for (let index = 0; index < restoredEntries.length; index += 1) {
      const entry = restoredEntries[index]!
      const move = moves[index]!
      if (entry.entryType === "folder") {
        const folder = findFolder(catalog, entry.folderID, true)
        const oldPrefix = folder.relativePath
        const related = entriesUnderFolders(catalog, [oldPrefix])
        const parentRelativePath = path.posix.dirname(move.destination) === "." ? "" : path.posix.dirname(move.destination)
        const nextParent = parentRelativePath === ""
          ? rootFolder()
          : catalog.folders.find((item) => item.status === "active" && item.relativePath === parentRelativePath) ?? findInbox(catalog)
        for (const child of catalog.folders.filter((item) => related.folderIDs.has(item.id))) {
          const suffix = child.relativePath.slice(oldPrefix.length).replace(/^\//, "")
          child.relativePath = suffix ? toRelativePath(move.destination, suffix) : move.destination
          child.depth = folderDepth(child.relativePath)
          child.status = "active"
          if (child.id === folder.id) {
            child.parentID = nextParent.id
            child.name = path.posix.basename(move.destination)
          }
          child.trash = undefined
          child.updatedAt = timestamp
        }
        for (const asset of catalog.assets.filter((item) => related.assetIDs.has(item.id))) {
          const suffix = asset.relativePath.slice(oldPrefix.length).replace(/^\//, "")
          asset.relativePath = suffix ? toRelativePath(move.destination, suffix) : move.destination
          asset.status = asset.trash?.previousStatus ?? "ready"
          asset.trash = undefined
          asset.updatedAt = timestamp
        }
      } else {
        const asset = findAsset(catalog, entry.assetID)
        const parentRelativePath = path.posix.dirname(move.destination) === "." ? "" : path.posix.dirname(move.destination)
        const parent = catalog.folders.find((item) => item.status === "active" && item.relativePath === parentRelativePath) ?? findInbox(catalog)
        asset.folderID = parent.id
        asset.relativePath = move.destination
        asset.displayName = path.posix.basename(move.destination, path.posix.extname(move.destination))
        asset.status = asset.trash?.previousStatus ?? "ready"
        asset.trash = undefined
        asset.updatedAt = timestamp
      }
    }
    return {
      value: { affected: restoredEntries },
      rollback: async () => {
        for (const move of completed.slice().reverse()) {
          await rename(physicalPath(paths, move.destination), physicalPath(paths, move.source))
        }
      },
    }
  })
}

async function assetIDsReferenced(paths: CinemaAssetLibraryPaths, assetIDs: Set<string>) {
  if (assetIDs.size === 0) return new Set<string>()
  const referenced = new Set<string>()
  const files = paths.scope.type === "project"
    ? [
        path.join(paths.managedRoot, "canvas.json"),
        path.join(paths.managedRoot, "tasks.jsonl"),
        path.join(paths.managedRoot, "tasks"),
      ]
    : [path.join(paths.managedRoot, "references.json")]

  async function scan(inputPath: string) {
    const info = await stat(inputPath).catch(() => undefined)
    if (!info) return
    if (info.isDirectory()) {
      for (const entry of await readdir(inputPath, { withFileTypes: true })) {
        if (entry.isFile() && entry.name.endsWith(".json")) await scan(path.join(inputPath, entry.name))
      }
      return
    }
    const raw = await readFile(inputPath, "utf8").catch(() => "")
    for (const assetID of assetIDs) {
      if (raw.includes(assetID)) referenced.add(assetID)
    }
  }
  for (const inputPath of files) await scan(inputPath)
  return referenced
}

export interface PermanentlyDeleteCinemaAssetEntriesInput extends CinemaAssetLibraryMutationInput {
  entries?: CinemaAssetLibraryEntryRef[]
  all?: true
}

export async function permanentlyDeleteCinemaAssetEntries(
  scope: CinemaAssetScope,
  input: PermanentlyDeleteCinemaAssetEntriesInput,
) {
  if (input.all !== true) assertEntryRefs(input.entries ?? [])
  return await mutateLibrary(scope, input, "permanent-delete", async (catalog, paths) => {
    const requestedEntries: CinemaAssetLibraryEntryRef[] = input.all === true
      ? (() => {
          const trash = topLevelTrashedEntries(catalog)
          return [
            ...trash.folders.map((folder) => ({ entryType: "folder" as const, folderID: folder.id })),
            ...trash.assets.map((asset) => ({ entryType: "asset" as const, assetID: asset.id })),
          ]
        })()
      : input.entries!
    const selected = deduplicateEntryRefs(catalog, requestedEntries)
    const selectedFolderPaths: string[] = []
    for (const entry of selected) {
      if (entry.entryType === "folder") {
        const folder = findFolder(catalog, entry.folderID, true)
        if (folder.status !== "trashed") {
          throw new ApiError(409, "CINEMA_LIBRARY_ENTRY_NOT_TRASHED", "Only trashed entries can be permanently deleted.")
        }
        selectedFolderPaths.push(folder.relativePath)
      } else {
        const asset = findAsset(catalog, entry.assetID)
        if (asset.status !== "trashed") {
          throw new ApiError(409, "CINEMA_LIBRARY_ENTRY_NOT_TRASHED", "Only trashed entries can be permanently deleted.")
        }
      }
    }
    const assetIDs = new Set(selected.filter((entry) => entry.entryType === "asset").map((entry) => entry.assetID))
    for (const asset of catalog.assets) {
      if (selectedFolderPaths.some((folderPath) => asset.relativePath.startsWith(`${folderPath}/`))) assetIDs.add(asset.id)
    }
    const referenced = await assetIDsReferenced(paths, assetIDs)
    if (referenced.size > 0) {
      const referencedAssetIDs = [...referenced].sort()
      throw new ApiError(
        409,
        "CINEMA_LIBRARY_ASSET_REFERENCED",
        `Permanent deletion is blocked because ${referenced.size} selected asset(s) are still referenced.`,
        {
          referencedCount: referenced.size,
          referencedAssetIDs,
        },
      )
    }

    const deleted = new Set<string>()
    const purgeRelativePath = toRelativePath(
      ".trash",
      ".purge",
      Buffer.from(input.operationID, "utf8").toString("base64url"),
    )
    const purgePath = physicalPath(paths, purgeRelativePath)
    const moves: Array<{ source: string; destination: string; physical: boolean }> = []
    for (let index = 0; index < selected.length; index += 1) {
      const entry = selected[index]!
      if (entry.entryType === "folder") {
        const folder = findFolder(catalog, entry.folderID, true)
        const sourcePath = physicalPath(paths, folder.relativePath)
        await assertNoSymlinkBelowRoot(paths.filesRoot, sourcePath)
        moves.push({
          source: folder.relativePath,
          destination: toRelativePath(purgeRelativePath, `${index}-folder-${folder.id}`),
          physical: await pathExists(sourcePath),
        })
        for (const item of catalog.folders) {
          if (item.relativePath === folder.relativePath || item.relativePath.startsWith(`${folder.relativePath}/`)) {
            deleted.add(item.id)
          }
        }
        for (const item of catalog.assets) {
          if (item.relativePath.startsWith(`${folder.relativePath}/`)) deleted.add(item.id)
        }
      } else {
        const asset = findAsset(catalog, entry.assetID)
        const sourcePath = physicalPath(paths, asset.relativePath)
        await assertNoSymlinkBelowRoot(paths.filesRoot, sourcePath)
        moves.push({
          source: asset.relativePath,
          destination: toRelativePath(purgeRelativePath, `${index}-asset-${asset.id}`),
          physical: await pathExists(sourcePath),
        })
        deleted.add(asset.id)
      }
    }

    if (moves.some((move) => move.physical)) {
      await assertNoSymlinkBelowRoot(paths.filesRoot, physicalPath(paths, ".trash"))
      await assertNoSymlinkBelowRoot(paths.filesRoot, physicalPath(paths, toRelativePath(".trash", ".purge")))
      await mkdir(purgePath, { recursive: true })
      await assertNoSymlinkBelowRoot(paths.filesRoot, purgePath)
    }
    const completed: Array<{ source: string; destination: string }> = []
    try {
      for (const move of moves) {
        if (!move.physical) continue
        await rename(physicalPath(paths, move.source), physicalPath(paths, move.destination))
        completed.push(move)
      }
    } catch (error) {
      for (const move of completed.slice().reverse()) {
        await rename(physicalPath(paths, move.destination), physicalPath(paths, move.source)).catch(() => undefined)
      }
      await rm(purgePath, { recursive: true, force: true }).catch(() => undefined)
      throw error
    }

    catalog.folders = catalog.folders.filter((item) => !deleted.has(item.id))
    catalog.assets = catalog.assets.filter((item) => !deleted.has(item.id))
    return {
      value: { deletedIDs: [...deleted] },
      rollback: async () => {
        for (const move of completed.slice().reverse()) {
          await rename(physicalPath(paths, move.destination), physicalPath(paths, move.source))
        }
        await rm(purgePath, { recursive: true, force: true }).catch(() => undefined)
      },
      afterCommit: async () => {
        await rm(purgePath, { recursive: true, force: true })
      },
    }
  })
}

const IMAGE_EXTENSIONS = new Set([".png", ".apng", ".jpg", ".jpeg", ".webp", ".gif", ".avif", ".bmp", ".svg"])
const VIDEO_EXTENSIONS = new Set([".mp4", ".m4v", ".mov", ".webm", ".mkv"])
const AUDIO_EXTENSIONS = new Set([".mp3", ".wav", ".m4a", ".aac", ".ogg", ".oga", ".flac", ".webm"])

function ascii(bytes: Uint8Array<ArrayBufferLike>, start: number, end: number) {
  return String.fromCharCode(...bytes.slice(start, end))
}

function startsWithBytes(bytes: Uint8Array<ArrayBufferLike>, expected: number[]) {
  return expected.every((value, index) => bytes[index] === value)
}

function sniffUploadedMedia(
  filename: string,
  claimedMimeType: string,
  bytes: Uint8Array<ArrayBufferLike>,
): { kind: CinemaAssetKind; mimeType: string; extension: string } {
  const extension = path.extname(filename).toLowerCase()
  const isPng = startsWithBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const isJpeg = startsWithBytes(bytes, [0xff, 0xd8, 0xff])
  const isGif = ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a"
  const isBmp = ascii(bytes, 0, 2) === "BM"
  const isWebp = ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP"
  const isWave = ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WAVE"
  const isIsoMedia = bytes.byteLength >= 12 && ascii(bytes, 4, 8) === "ftyp"
  const isAvif = isIsoMedia && ascii(bytes, 8, 32).toLowerCase().includes("avif")
  const isEbml = startsWithBytes(bytes, [0x1a, 0x45, 0xdf, 0xa3])
  const isOgg = ascii(bytes, 0, 4) === "OggS"
  const isFlac = ascii(bytes, 0, 4) === "fLaC"
  const isMp3 = ascii(bytes, 0, 3) === "ID3" || (bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0)
  const isAac = bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xf6) === 0xf0
  const textPrefix = new TextDecoder("utf-8", { fatal: false }).decode(bytes).replace(/^\uFEFF/, "").trimStart()
  const isSvg = extension === ".svg" && (textPrefix.startsWith("<svg") || textPrefix.startsWith("<?xml") && textPrefix.includes("<svg"))

  if ((isPng || isJpeg || isGif || isBmp || isWebp || isAvif || isSvg) && IMAGE_EXTENSIONS.has(extension)) {
    const mimeType = isPng ? (extension === ".apng" ? "image/apng" : "image/png")
      : isJpeg ? "image/jpeg"
      : isGif ? "image/gif"
      : isBmp ? "image/bmp"
      : isWebp ? "image/webp"
      : isAvif ? "image/avif"
      : "image/svg+xml"
    const allowed = isPng ? new Set([".png", ".apng"])
      : isJpeg ? new Set([".jpg", ".jpeg"])
      : new Set([extension])
    if (!allowed.has(extension)) {
      throw new ApiError(415, "CINEMA_LIBRARY_MEDIA_TYPE_MISMATCH", "File extension does not match the detected image type.")
    }
    return { kind: "image", mimeType, extension }
  }

  if (isWave && extension === ".wav") return { kind: "audio", mimeType: "audio/wav", extension }
  if (isOgg && (extension === ".ogg" || extension === ".oga")) return { kind: "audio", mimeType: "audio/ogg", extension }
  if (isFlac && extension === ".flac") return { kind: "audio", mimeType: "audio/flac", extension }
  if (isMp3 && extension === ".mp3") return { kind: "audio", mimeType: "audio/mpeg", extension }
  if (isAac && extension === ".aac") return { kind: "audio", mimeType: "audio/aac", extension }
  if (isIsoMedia) {
    if (extension === ".m4a") return { kind: "audio", mimeType: "audio/mp4", extension }
    if (extension === ".mov") return { kind: "video", mimeType: "video/quicktime", extension }
    if (extension === ".mp4" || extension === ".m4v") return { kind: "video", mimeType: "video/mp4", extension }
  }
  if (isEbml && (extension === ".webm" || extension === ".mkv")) {
    const kind: CinemaAssetKind = extension === ".webm" && claimedMimeType.startsWith("audio/") ? "audio" : "video"
    return {
      kind,
      mimeType: extension === ".mkv" ? "video/x-matroska" : `${kind}/webm`,
      extension,
    }
  }

  throw new ApiError(415, "CINEMA_LIBRARY_MEDIA_UNSUPPORTED", "File is not a supported image, video, or audio asset.")
}

function assertAssetSize(kind: CinemaAssetKind, sizeBytes: number) {
  if (sizeBytes <= CINEMA_ASSET_LIBRARY_LIMITS[kind]) return
  throw new ApiError(
    413,
    "CINEMA_LIBRARY_UPLOAD_TOO_LARGE",
    `Uploaded ${kind} exceeds the ${CINEMA_ASSET_LIBRARY_LIMITS[kind]} byte limit.`,
  )
}

type ProcessedMediaMetadata = Pick<
  CinemaAssetRecord,
  "status" | "failureReason" | "width" | "height" | "durationSeconds" | "fps" | "hasAudio" | "thumbnailPath" | "previewPath"
>

async function processUploadedMedia(
  paths: CinemaAssetLibraryPaths,
  assetID: string,
  kind: CinemaAssetKind,
  inputPath: string,
  headBytes: Uint8Array<ArrayBufferLike>,
  mimeType: string,
  signal?: AbortSignal,
  contentRevision = 1,
): Promise<ProcessedMediaMetadata> {
  const derivedAssetRoot = physicalPath(paths, toRelativePath(".derived", assetID))
  await assertNoSymlinkBelowRoot(paths.filesRoot, derivedAssetRoot)
  if (kind === "image") {
    const thumbnailPath = toRelativePath(".derived", assetID, String(contentRevision), "thumbnail.jpg")
    await createImageThumbnail(inputPath, physicalPath(paths, thumbnailPath), { signal }).catch(() => undefined)
    return {
      status: "ready",
      ...readImageDimensions(headBytes, mimeType),
      thumbnailPath: await pathExists(physicalPath(paths, thumbnailPath)) ? thumbnailPath : undefined,
    }
  }

  const derivedRelativeRoot = toRelativePath(".derived", assetID, String(contentRevision))
  try {
    const probe = await probeMediaFile(inputPath, kind, { signal })
    if (kind === "video") {
      const thumbnailPath = toRelativePath(derivedRelativeRoot, "thumbnail.jpg")
      await createVideoThumbnail(inputPath, physicalPath(paths, thumbnailPath), probe.durationSeconds, { signal }).catch(() => undefined)
      let previewPath: string | undefined
      if (!probe.chromiumPlayable) {
        previewPath = toRelativePath(derivedRelativeRoot, "preview.webm")
        await createVideoPreviewProxy(inputPath, physicalPath(paths, previewPath), { signal })
      }
      return {
        status: "ready",
        width: probe.width,
        height: probe.height,
        durationSeconds: probe.durationSeconds,
        fps: probe.fps,
        hasAudio: probe.hasAudio,
        thumbnailPath: await pathExists(physicalPath(paths, thumbnailPath)) ? thumbnailPath : undefined,
        previewPath,
      }
    }

    let previewPath: string | undefined
    if (!probe.chromiumPlayable) {
      previewPath = toRelativePath(derivedRelativeRoot, "preview.ogg")
      await createAudioPreviewProxy(inputPath, physicalPath(paths, previewPath), { signal })
    }
    return {
      status: "ready",
      durationSeconds: probe.durationSeconds,
      hasAudio: true,
      previewPath,
    }
  } catch (error) {
    if (signal?.aborted || error instanceof DOMException && error.name === "AbortError") throw error
    const failureReason = error instanceof Error && error.message.trim()
      ? error.message.slice(0, 1000)
      : "Media processing failed."
    return { status: "failed", failureReason }
  }
}

const activeAssetProcessing = new Map<string, AbortController>()

function assetProcessingKey(scope: CinemaAssetScope, assetID: string) {
  return `${scope.type === "personal" ? "personal" : `project:${scope.projectID}`}:${assetID}`
}

/**
 * Media probing and proxy generation deliberately runs after the upload
 * mutation commits. This keeps a multi-gigabyte upload request bounded by disk
 * I/O instead of holding the HTTP request open for a long transcode.
 */
export function scheduleCinemaAssetProcessing(scope: CinemaAssetScope, assetID: string) {
  const key = assetProcessingKey(scope, assetID)
  activeAssetProcessing.get(key)?.abort()
  const controller = new AbortController()
  activeAssetProcessing.set(key, controller)

  void (async () => {
    const { paths, catalog } = await readLibrary(scope)
    const snapshot = findAsset(catalog, assetID)
    if (snapshot.status === "trashed" || snapshot.status === "missing") return
    const contentRevision = snapshot.contentRevision
    const filePath = physicalPath(paths, snapshot.relativePath)
    await assertNoSymlinkBelowRoot(paths.filesRoot, filePath)
    const headBytes = await readFileHead(filePath)
    const processed = await processUploadedMedia(
      paths,
      snapshot.id,
      snapshot.kind,
      filePath,
      headBytes,
      snapshot.mimeType,
      controller.signal,
      contentRevision,
    )
    if (controller.signal.aborted) return

    using _lock = await Lock.write(paths.scopeKey)
    const currentCatalog = await readCatalog(paths)
    const asset = findAsset(currentCatalog, assetID)
    if (asset.contentRevision !== contentRevision || asset.status === "trashed" || asset.status === "missing") return
    asset.status = processed.status
    asset.failureReason = processed.failureReason
    asset.width = processed.width ?? asset.width
    asset.height = processed.height ?? asset.height
    asset.durationSeconds = processed.durationSeconds ?? asset.durationSeconds
    asset.fps = processed.fps ?? asset.fps
    asset.hasAudio = processed.hasAudio ?? asset.hasAudio
    asset.thumbnailPath = processed.thumbnailPath ?? asset.thumbnailPath
    asset.previewPath = processed.previewPath ?? asset.previewPath
    asset.updatedAt = nowISO()
    currentCatalog.revision += 1
    currentCatalog.updatedAt = asset.updatedAt
    await atomicWriteJson(paths.catalogPath, currentCatalog)
  })().catch(async (error: unknown) => {
    if (controller.signal.aborted || error instanceof DOMException && error.name === "AbortError") return
    const paths = resolveLibraryPaths(scope)
    using _lock = await Lock.write(paths.scopeKey)
    const catalog = await readCatalog(paths).catch(() => undefined)
    if (!catalog) return
    const asset = catalog.assets.find((item) => item.id === assetID)
    if (!asset || asset.status === "trashed" || asset.status === "missing") return
    asset.status = "failed"
    asset.failureReason = error instanceof Error ? error.message.slice(0, 1000) : "Media processing failed."
    asset.updatedAt = nowISO()
    catalog.revision += 1
    catalog.updatedAt = asset.updatedAt
    await atomicWriteJson(paths.catalogPath, catalog)
  }).finally(() => {
    if (activeAssetProcessing.get(key) === controller) activeAssetProcessing.delete(key)
  })
}

export interface UploadCinemaAssetOptions {
  operationID?: string
  baseRevision?: number
  folderID?: string
  fileName?: string
}

function parseUploadRevision(value: string | undefined, fallback: number | undefined) {
  const parsed = value === undefined ? fallback : Number(value)
  if (!Number.isInteger(parsed) || (parsed ?? -1) < 0) {
    throw new ApiError(400, "CINEMA_LIBRARY_REVISION_INVALID", "Upload baseRevision must be a non-negative integer.")
  }
  return parsed!
}

export async function uploadCinemaAsset(
  scope: CinemaAssetScope,
  request: Request,
  options: UploadCinemaAssetOptions = {},
) {
  const { paths } = await initializeCinemaAssetLibrary(scope)
  const uploadID = randomUUID()
  const stagingPath = path.join(paths.filesRoot, ".staging", uploadID)
  assertInside(paths.filesRoot, stagingPath)
  let derivedRoot: string | undefined
  let committedAssetID: string | undefined
  let processingAssetID: string | undefined
  try {
    const parsed = await streamCinemaAssetMultipartUpload(request, stagingPath)
    const operationID = parsed.fields.operationID?.trim() || options.operationID?.trim() || uploadID
    const baseRevision = parseUploadRevision(parsed.fields.baseRevision, options.baseRevision)
    const folderID = parsed.fields.folderID?.trim() || options.folderID?.trim() || "inbox"
    const requestedFilename = parsed.fields.fileName?.trim() || options.fileName?.trim() || parsed.filename
    const source = parsed.fields.source?.trim() === "crop" ? "crop" as const : "upload" as const
    let detected = sniffUploadedMedia(requestedFilename, parsed.claimedMimeType, parsed.headBytes)
    if (detected.extension === ".webm") {
      const probe = await probeMediaFile(stagingPath, "audio", { signal: request.signal }).catch(() => undefined)
      if (probe && !probe.width && !probe.height) {
        detected = { kind: "audio", mimeType: "audio/webm", extension: detected.extension }
      }
    }
    assertAssetSize(detected.kind, parsed.sizeBytes)
    const originalBaseName = path.basename(requestedFilename, path.extname(requestedFilename))
    const displayName = normalizeAssetName(originalBaseName)
    const assetID = `asset_${randomUUID()}`
    processingAssetID = assetID
    derivedRoot = physicalPath(paths, toRelativePath(".derived", assetID))
    const processing: ProcessedMediaMetadata = detected.kind === "image"
      ? await processUploadedMedia(
          paths,
          assetID,
          detected.kind,
          stagingPath,
          parsed.headBytes,
          detected.mimeType,
          request.signal,
        )
      : { status: "processing" }

    const result = await mutateLibrary(scope, { operationID, baseRevision }, "upload", async (catalog, mutationPaths) => {
      const requestedFolder = catalog.folders.find((item) => item.id === folderID && item.status === "active")
      const folder = requestedFolder && (source === "crop" || !requestedFolder.system || requestedFolder.id === "inbox")
        ? requestedFolder
        : findInbox(catalog)
      const directory = physicalPath(mutationPaths, folder.relativePath)
      await assertNoSymlinkBelowRoot(mutationPaths.filesRoot, directory)
      const filename = await uniqueFilename(directory, displayName, detected.extension)
      const relativePath = toRelativePath(folder.relativePath, filename)
      const destinationPath = physicalPath(mutationPaths, relativePath)
      await rename(stagingPath, destinationPath)
      const destinationInfo = await lstat(destinationPath)
      const timestamp = nowISO()
      const asset: CinemaAssetRecord = {
        id: assetID,
        folderID: folder.id,
        relativePath,
        displayName: path.posix.basename(filename, detected.extension),
        kind: detected.kind,
        source,
        status: processing.status,
        mimeType: detected.mimeType,
        sizeBytes: parsed.sizeBytes,
        checksum: parsed.checksum,
        fileIdentity: fileIdentityFromStats(destinationInfo),
        width: processing.width,
        height: processing.height,
        durationSeconds: processing.durationSeconds,
        fps: processing.fps,
        hasAudio: processing.hasAudio,
        thumbnailPath: processing.thumbnailPath,
        previewPath: processing.previewPath,
        contentRevision: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
        failureReason: processing.failureReason,
      }
      catalog.assets.push(asset)
      const affected: CinemaAssetLibraryEntryRef[] = [{ entryType: "asset", assetID }]
      return {
        value: { asset, affected },
        rollback: async () => {
          await rename(destinationPath, stagingPath)
        },
      }
    })
    committedAssetID = result.asset.id
    if (detected.kind !== "image") scheduleCinemaAssetProcessing(scope, result.asset.id)
    return {
      scope: result.scope,
      operationID: result.operationID,
      revision: result.revision,
      items: [{ fileName: requestedFilename, success: true as const, asset: result.asset }],
    }
  } catch (error) {
    if (request.signal.aborted || error instanceof DOMException && error.name === "AbortError") {
      throw new ApiError(408, "CINEMA_LIBRARY_UPLOAD_CANCELED", "Asset upload was canceled.")
    }
    throw error
  } finally {
    await rm(stagingPath, { force: true }).catch(() => undefined)
    if (derivedRoot && committedAssetID !== processingAssetID) {
      await rm(derivedRoot, { recursive: true, force: true }).catch(() => undefined)
    }
  }
}

export interface RegisterCinemaGeneratedAssetInput extends CinemaAssetLibraryMutationInput {
  sourcePath: string
  kind: CinemaAssetKind
  mimeType?: string
  displayName?: string
  source?: "generation" | "crop" | "render" | "migration"
  destinationFolderID?: string
}

async function checksumFile(filePath: string) {
  const hash = createHash("sha256")
  for await (const chunk of createReadStream(filePath)) hash.update(chunk as Buffer)
  return hash.digest("hex")
}

function fileIdentityFromStats(info: Pick<Stats, "dev" | "ino">) {
  // Node exposes the native device/inode pair on all supported platforms. A
  // zero inode is not useful for matching (some virtual filesystems report it
  // for every file), so those catalogs fall back to size + streaming checksum.
  if (!Number.isFinite(info.dev) || !Number.isFinite(info.ino) || info.ino === 0) return undefined
  return `${info.dev}:${info.ino}`
}

/**
 * Registers a completed media file that already lives inside the same project.
 * The file is moved into the managed generated-assets folder; callers must use
 * the returned stable asset id instead of persisting the old physical path.
 */
export async function registerCinemaGeneratedAsset(
  projectID: string,
  input: RegisterCinemaGeneratedAssetInput,
) {
  const scope: CinemaAssetScope = { type: "project", projectID }
  const { paths } = await initializeCinemaAssetLibrary(scope)
  const projectRoot = path.dirname(paths.managedRoot)
  const sourcePath = path.isAbsolute(input.sourcePath)
    ? path.resolve(input.sourcePath)
    : path.resolve(projectRoot, input.sourcePath)
  assertInside(projectRoot, sourcePath)
  await assertNoSymlinkBelowRoot(projectRoot, sourcePath)
  const sourceInfo = await stat(sourcePath).catch(() => undefined)
  if (!sourceInfo?.isFile()) {
    throw new ApiError(404, "CINEMA_LIBRARY_GENERATED_FILE_MISSING", "Generated asset file was not found.")
  }

  const headBytes = await readFileHead(sourcePath)
  const detected = sniffUploadedMedia(path.basename(sourcePath), input.mimeType ?? "application/octet-stream", headBytes)
  if (detected.kind !== input.kind) {
    throw new ApiError(415, "CINEMA_LIBRARY_MEDIA_TYPE_MISMATCH", "Generated file does not match the declared media kind.")
  }
  assertAssetSize(detected.kind, sourceInfo.size)
  const checksum = await checksumFile(sourcePath)
  const assetID = `asset_${randomUUID()}`
  const processing = await processUploadedMedia(paths, assetID, detected.kind, sourcePath, headBytes, detected.mimeType)
  const generatedFolderID = detected.kind === "image"
    ? "generated-images"
    : detected.kind === "video"
      ? "generated-videos"
      : "generated-audio"
  let committedAssetID: string | undefined

  try {
    const result = await mutateLibrary(scope, input, "register-generated-asset", async (catalog, mutationPaths) => {
      if (catalog.assets.some((asset) => physicalPath(mutationPaths, asset.relativePath) === sourcePath)) {
        throw new ApiError(409, "CINEMA_LIBRARY_ASSET_ALREADY_REGISTERED", "Generated file is already registered.")
      }
      const folder = findFolder(catalog, input.destinationFolderID ?? generatedFolderID)
      const requestedName = input.displayName
        ? normalizeAssetName(input.displayName)
        : normalizeAssetName(path.basename(sourcePath, path.extname(sourcePath)))
      const directory = physicalPath(mutationPaths, folder.relativePath)
      await assertNoSymlinkBelowRoot(mutationPaths.filesRoot, directory)
      const filename = await uniqueFilename(directory, requestedName, detected.extension)
      const relativePath = toRelativePath(folder.relativePath, filename)
      const destinationPath = physicalPath(mutationPaths, relativePath)
      if (sourcePath !== destinationPath) await rename(sourcePath, destinationPath)
      const destinationInfo = await lstat(destinationPath)
      const timestamp = nowISO()
      const asset: CinemaAssetRecord = {
        id: assetID,
        folderID: folder.id,
        relativePath,
        displayName: path.posix.basename(filename, detected.extension),
        kind: detected.kind,
        source: input.source ?? "generation",
        status: processing.status,
        mimeType: detected.mimeType,
        sizeBytes: sourceInfo.size,
        checksum,
        fileIdentity: fileIdentityFromStats(destinationInfo),
        width: processing.width,
        height: processing.height,
        durationSeconds: processing.durationSeconds,
        fps: processing.fps,
        hasAudio: processing.hasAudio,
        thumbnailPath: processing.thumbnailPath,
        previewPath: processing.previewPath,
        contentRevision: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
        failureReason: processing.failureReason,
      }
      catalog.assets.push(asset)
      const affected: CinemaAssetLibraryEntryRef[] = [{ entryType: "asset", assetID }]
      return {
        value: { asset, affected },
        rollback: sourcePath === destinationPath ? undefined : async () => {
          await rename(destinationPath, sourcePath)
        },
      }
    })
    committedAssetID = result.asset.id
    return result
  } finally {
    if (committedAssetID !== assetID) {
      await rm(physicalPath(paths, toRelativePath(".derived", assetID)), { recursive: true, force: true }).catch(() => undefined)
    }
  }
}

type CinemaAssetBinaryVariant = "content" | "preview" | "thumbnail"

function parseByteRange(header: string | null | undefined, total: number) {
  if (!header) return undefined
  if (!header.startsWith("bytes=") || header.includes(",")) {
    throw new ApiError(416, "CINEMA_LIBRARY_RANGE_INVALID", "Only a single bytes range is supported.")
  }
  const match = header.slice(6).match(/^(\d*)-(\d*)$/)
  if (!match || !match[1] && !match[2]) {
    throw new ApiError(416, "CINEMA_LIBRARY_RANGE_INVALID", "Byte range is invalid.")
  }
  let start: number
  let end: number
  if (!match[1]) {
    const suffix = Number(match[2])
    if (!Number.isInteger(suffix) || suffix <= 0) throw new ApiError(416, "CINEMA_LIBRARY_RANGE_INVALID", "Byte range is invalid.")
    start = Math.max(0, total - suffix)
    end = total - 1
  } else {
    start = Number(match[1])
    end = match[2] ? Number(match[2]) : total - 1
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= total || end < start) {
    throw new ApiError(416, "CINEMA_LIBRARY_RANGE_UNSATISFIABLE", "Requested range is outside the asset.")
  }
  return { start, end: Math.min(end, total - 1), total }
}

function mediaPlaceholder(kind: CinemaAssetKind) {
  const label = kind === "video" ? "VIDEO" : "AUDIO"
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="288" viewBox="0 0 512 288"><rect width="512" height="288" rx="24" fill="#242424"/><text x="256" y="154" text-anchor="middle" fill="#b8b8b8" font-family="system-ui,sans-serif" font-size="28">${label}</text></svg>`
}

export async function readCinemaAssetBinary(
  scope: CinemaAssetScope,
  assetID: string,
  variant: CinemaAssetBinaryVariant,
  rangeHeader?: string | null,
) {
  const paths = resolveLibraryPaths(scope)
  if (!(await pathExists(paths.catalogPath))) await initializeCinemaAssetLibrary(scope)
  using _lock = await Lock.read(paths.scopeKey)
  const index = await readCatalogAssetIndex(paths)
  const asset = index.assetsByID.get(assetID)
  if (!asset) throw new ApiError(404, "CINEMA_LIBRARY_ASSET_NOT_FOUND", `Asset '${assetID}' was not found.`)
  if (asset.status === "missing") {
    throw new ApiError(404, "CINEMA_LIBRARY_ASSET_MISSING", "Asset file is missing.")
  }
  if (variant === "thumbnail" && !asset.thumbnailPath && asset.kind !== "image") {
    const body = mediaPlaceholder(asset.kind)
    return {
      body,
      mimeType: "image/svg+xml; charset=utf-8",
      contentLength: Buffer.byteLength(body),
      range: undefined,
      contentRevision: asset.contentRevision,
    }
  }

  const relativePath = variant === "preview" && asset.previewPath
    ? asset.previewPath
    : variant === "thumbnail" && asset.thumbnailPath
      ? asset.thumbnailPath
      : asset.relativePath
  const filePath = physicalPath(paths, relativePath)
  await assertNoSymlinkBelowRoot(paths.filesRoot, filePath)
  const info = await stat(filePath).catch((error: unknown) => {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      throw new ApiError(404, "CINEMA_LIBRARY_ASSET_MISSING", "Asset file is missing.")
    }
    throw error
  })
  if (!info.isFile()) throw new ApiError(404, "CINEMA_LIBRARY_ASSET_MISSING", "Asset file is missing.")
  const range = parseByteRange(rangeHeader, info.size)
  const body = streamCinemaFile(filePath, range)
  const mimeType = variant === "thumbnail" && asset.thumbnailPath
    ? "image/jpeg"
    : variant === "preview" && asset.previewPath?.endsWith(".webm")
      ? "video/webm"
      : variant === "preview" && asset.previewPath?.endsWith(".ogg")
        ? "audio/ogg"
        : asset.mimeType
  return {
    body,
    mimeType,
    contentLength: range ? range.end - range.start + 1 : info.size,
    range,
    contentRevision: asset.contentRevision,
  }
}

async function readFileHead(filePath: string, maxBytes = 64 * 1024) {
  const handle = await open(filePath, "r")
  try {
    const buffer = new Uint8Array(maxBytes)
    const result = await handle.read(buffer, 0, maxBytes, 0)
    return buffer.slice(0, result.bytesRead)
  } finally {
    await handle.close()
  }
}

export async function retryCinemaAssetProcessing(
  scope: CinemaAssetScope,
  assetID: string,
  input: CinemaAssetLibraryMutationInput,
) {
  const result = await mutateLibrary(scope, input, "retry-processing", async (catalog, paths) => {
    const asset = findAsset(catalog, assetID)
    if (asset.status === "trashed") {
      throw new ApiError(409, "CINEMA_LIBRARY_ASSET_TRASHED", "Restore the asset before retrying processing.")
    }
    const filePath = physicalPath(paths, asset.relativePath)
    await assertNoSymlinkBelowRoot(paths.filesRoot, filePath)
    const info = await stat(filePath).catch(() => undefined)
    if (!info?.isFile()) {
      asset.status = "missing"
      asset.failureReason = "Asset file is missing."
      asset.updatedAt = nowISO()
    } else {
      asset.status = "processing"
      asset.failureReason = undefined
      asset.updatedAt = nowISO()
    }
    const affected: CinemaAssetLibraryEntryRef[] = [{ entryType: "asset", assetID }]
    return { value: { asset, affected } }
  })
  if (result.asset.status === "processing") scheduleCinemaAssetProcessing(scope, assetID)
  return result
}

export interface ReconcileCinemaAssetLibraryInput extends CinemaAssetLibraryMutationInput {
  full?: boolean
}

type CinemaAssetReconcileMutationResult = Record<string, unknown> & {
  affected: CinemaAssetLibraryEntryRef[]
  reconciled: number
  full: boolean
  discovered: number
  moved: number
  missing: number
  warnings: string[]
}

const RECONCILE_EXCLUDED_DIRECTORIES = new Set([".staging", ".derived", ".trash"])

type ScannedCinemaAssetFolder = {
  relativePath: string
  parentRelativePath: string
  name: string
  depth: number
}

type ScannedCinemaAssetFile = {
  relativePath: string
  folderRelativePath: string
  displayName: string
  kind: CinemaAssetKind
  mimeType: string
  sizeBytes: number
  checksum: string
  fileIdentity?: string
}

function relativePathKey(relativePath: string) {
  return relativePath.normalize("NFC").toLocaleLowerCase()
}

function appendGrouped<K, V>(groups: Map<K, V[]>, key: K | undefined, value: V) {
  if (key === undefined) return
  const group = groups.get(key)
  if (group) group.push(value)
  else groups.set(key, [value])
}

async function scanCinemaAssetFilesRoot(paths: CinemaAssetLibraryPaths) {
  const folders: ScannedCinemaAssetFolder[] = []
  const files: ScannedCinemaAssetFile[] = []
  const warnings: string[] = []
  const pathKeys = new Set<string>()
  const rootInfo = await lstat(paths.filesRoot)
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) {
    throw new ApiError(400, "CINEMA_LIBRARY_SYMLINK_REJECTED", "The managed asset root must be a real directory.")
  }

  const walk = async (directoryPath: string, parentRelativePath: string, depth: number): Promise<void> => {
    const entries = await readdir(directoryPath, { withFileTypes: true })
    entries.sort((left, right) => compareNames(left.name, right.name))
    for (const entry of entries) {
      if (depth === 0 && RECONCILE_EXCLUDED_DIRECTORIES.has(entry.name)) continue
      const relativePath = toRelativePath(parentRelativePath, entry.name)
      const candidatePath = physicalPath(paths, relativePath)
      const info = await lstat(candidatePath).catch((error: unknown) => {
        if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return undefined
        throw error
      })
      // A Dirent can be stale, so lstat is the authoritative check. On
      // Windows, directory junctions are surfaced as symbolic links here.
      if (!info) continue
      if (entry.isSymbolicLink() || info.isSymbolicLink()) {
        throw new ApiError(
          400,
          "CINEMA_LIBRARY_SYMLINK_REJECTED",
          `Symbolic links and junctions are not supported: '${relativePath}'.`,
        )
      }

      const key = relativePathKey(relativePath)
      if (pathKeys.has(key)) {
        throw new ApiError(
          409,
          "CINEMA_LIBRARY_NAME_CONFLICT",
          `Managed files contain a case-insensitive name conflict at '${relativePath}'.`,
        )
      }
      pathKeys.add(key)

      if (info.isDirectory()) {
        const nextDepth = depth + 1
        assertFolderDepth(relativePath)
        const name = normalizeFolderName(entry.name)
        folders.push({ relativePath, parentRelativePath, name, depth: nextDepth })
        await walk(candidatePath, relativePath, nextDepth)
        continue
      }
      if (!info.isFile()) {
        warnings.push(`Ignored non-file entry '${relativePath}'.`)
        continue
      }

      try {
        const headBytes = await readFileHead(candidatePath)
        let detected = sniffUploadedMedia(entry.name, "application/octet-stream", headBytes)
        // WebM uses the same EBML signature for video and audio-only files. An
        // external scan has no trustworthy client MIME hint, so use ffprobe for
        // this one ambiguous extension. A video containing audio also reports
        // dimensions and remains a video; an audio-only stream does not.
        if (detected.extension === ".webm") {
          const probe = await probeMediaFile(candidatePath, "audio").catch(() => undefined)
          if (probe && !probe.width && !probe.height) {
            detected = { kind: "audio", mimeType: "audio/webm", extension: detected.extension }
          }
        }
        assertAssetSize(detected.kind, info.size)
        const displayName = normalizeAssetName(path.basename(entry.name, path.extname(entry.name)))
        const checksum = await checksumFile(candidatePath)
        const finalInfo = await lstat(candidatePath)
        if (finalInfo.isSymbolicLink()) {
          throw new ApiError(
            400,
            "CINEMA_LIBRARY_SYMLINK_REJECTED",
            `Symbolic links and junctions are not supported: '${relativePath}'.`,
          )
        }
        const initialIdentity = fileIdentityFromStats(info)
        const finalIdentity = fileIdentityFromStats(finalInfo)
        if (!finalInfo.isFile() || finalInfo.size !== info.size || finalInfo.mtimeMs !== info.mtimeMs ||
          Boolean(initialIdentity && finalIdentity && initialIdentity !== finalIdentity)) {
          warnings.push(`Skipped '${relativePath}' because it changed during the scan.`)
          continue
        }
        files.push({
          relativePath,
          folderRelativePath: parentRelativePath,
          displayName,
          kind: detected.kind,
          mimeType: detected.mimeType,
          sizeBytes: finalInfo.size,
          checksum,
          fileIdentity: finalIdentity,
        })
      } catch (error) {
        if (error instanceof ApiError && error.code === "CINEMA_LIBRARY_SYMLINK_REJECTED") throw error
        const message = error instanceof Error ? error.message : "Unsupported or unreadable media."
        warnings.push(`Ignored '${relativePath}': ${message}`)
      }
    }
  }

  await walk(paths.filesRoot, "", 0)
  return { folders, files, warnings }
}

function applyScannedFileToAsset(
  asset: CinemaAssetRecord,
  scanned: ScannedCinemaAssetFile,
  folderID: string,
) {
  if (asset.kind !== scanned.kind) {
    throw new ApiError(
      409,
      "CINEMA_LIBRARY_MEDIA_TYPE_MISMATCH",
      "A filesystem reconciliation cannot change the media kind of an existing stable asset.",
    )
  }
  const previousPath = asset.relativePath
  const previousStatus = asset.status
  const previousFileIdentity = asset.fileIdentity
  const contentChanged = asset.checksum !== scanned.checksum
  asset.folderID = folderID
  asset.relativePath = scanned.relativePath
  asset.displayName = scanned.displayName
  asset.fileIdentity = scanned.fileIdentity
  asset.sizeBytes = scanned.sizeBytes
  asset.mimeType = scanned.mimeType
  if (contentChanged) {
    asset.checksum = scanned.checksum
    asset.contentRevision += 1
    asset.width = undefined
    asset.height = undefined
    asset.durationSeconds = undefined
    asset.fps = undefined
    asset.hasAudio = undefined
    asset.thumbnailPath = undefined
    asset.previewPath = undefined
  }
  const shouldProcess = contentChanged || previousStatus === "missing" || previousStatus === "processing" || previousStatus === "uploading"
  if (shouldProcess) {
    asset.status = "processing"
    asset.failureReason = undefined
  }
  const moved = previousPath !== scanned.relativePath
  const changed = moved || contentChanged || previousStatus !== asset.status || previousFileIdentity !== scanned.fileIdentity
  if (changed) asset.updatedAt = nowISO()
  return { changed, moved, shouldProcess }
}

async function reconcileKnownCinemaAssetPaths(
  catalog: CinemaAssetCatalog,
  paths: CinemaAssetLibraryPaths,
  processingAssetIDs: Set<string>,
) {
  const affected: CinemaAssetLibraryEntryRef[] = []
  for (const folder of catalog.folders) {
    if (folder.status === "trashed") continue
    const folderPath = physicalPath(paths, folder.relativePath)
    const info = await lstat(folderPath).catch(() => undefined)
    if (info?.isSymbolicLink()) {
      throw new ApiError(400, "CINEMA_LIBRARY_SYMLINK_REJECTED", "Symbolic links and junctions are not supported.")
    }
    const nextStatus = info?.isDirectory() ? "active" : "missing"
    if (folder.status !== nextStatus) {
      folder.status = nextStatus
      folder.updatedAt = nowISO()
      affected.push({ entryType: "folder", folderID: folder.id })
    }
  }
  for (const asset of catalog.assets) {
    if (asset.status === "trashed") continue
    const assetPath = physicalPath(paths, asset.relativePath)
    const info = await lstat(assetPath).catch(() => undefined)
    if (info?.isSymbolicLink()) {
      throw new ApiError(400, "CINEMA_LIBRARY_SYMLINK_REJECTED", "Symbolic links and junctions are not supported.")
    }
    if (!info?.isFile() && asset.status !== "missing") {
      asset.status = "missing"
      asset.failureReason = "Asset file is missing."
      asset.updatedAt = nowISO()
      affected.push({ entryType: "asset", assetID: asset.id })
    } else if (info?.isFile()) {
      asset.fileIdentity = fileIdentityFromStats(info)
      if (asset.status === "missing") {
        asset.status = "processing"
        asset.failureReason = undefined
        asset.updatedAt = nowISO()
        affected.push({ entryType: "asset", assetID: asset.id })
        processingAssetIDs.add(asset.id)
      } else if (asset.status === "processing" || asset.status === "uploading") {
        processingAssetIDs.add(asset.id)
      }
    }
  }
  return {
    affected,
    missing: catalog.folders.filter((folder) => folder.status === "missing").length +
      catalog.assets.filter((asset) => asset.status === "missing").length,
  }
}

export async function reconcileCinemaAssetLibrary(
  scope: CinemaAssetScope,
  input: ReconcileCinemaAssetLibraryInput,
) {
  const processingAssetIDs = new Set<string>()
  const full = input.full ?? true
  const result = await mutateLibrary<CinemaAssetReconcileMutationResult>(scope, input, "reconcile", async (catalog, paths) => {
    if (!full) {
      const knownPaths = await reconcileKnownCinemaAssetPaths(catalog, paths, processingAssetIDs)
      return {
        value: {
          affected: knownPaths.affected,
          reconciled: knownPaths.affected.length,
          full,
          discovered: 0,
          moved: 0,
          missing: knownPaths.missing,
          warnings: [],
        },
      }
    }

    const scan = await scanCinemaAssetFilesRoot(paths)
    const timestamp = nowISO()
    const affected = new Map<string, CinemaAssetLibraryEntryRef>()
    const markFolder = (folderID: string) => affected.set(`folder:${folderID}`, { entryType: "folder", folderID })
    const markAsset = (assetID: string) => affected.set(`asset:${assetID}`, { entryType: "asset", assetID })

    const folderIDsByPath = new Map<string, string>([[relativePathKey(""), CINEMA_ASSET_LIBRARY_ROOT_FOLDER_ID]])
    const existingFoldersByPath = new Map<string, CinemaAssetFolder[]>()
    for (const folder of catalog.folders) {
      if (folder.status !== "trashed") appendGrouped(existingFoldersByPath, relativePathKey(folder.relativePath), folder)
    }
    const scannedFolderIDs = new Set<string>()
    for (const scannedFolder of scan.folders) {
      const key = relativePathKey(scannedFolder.relativePath)
      const candidates = existingFoldersByPath.get(key) ?? []
      const folder = candidates.length === 1 ? candidates[0]! : undefined
      const parentID = folderIDsByPath.get(relativePathKey(scannedFolder.parentRelativePath))
      if (!parentID) {
        throw new ApiError(409, "CINEMA_LIBRARY_FOLDER_PARENT_MISSING", "A scanned folder parent could not be resolved.")
      }
      if (folder) {
        const changed = folder.parentID !== parentID || folder.name !== scannedFolder.name ||
          folder.relativePath !== scannedFolder.relativePath || folder.depth !== scannedFolder.depth || folder.status !== "active"
        folder.parentID = parentID
        folder.name = scannedFolder.name
        folder.relativePath = scannedFolder.relativePath
        folder.depth = scannedFolder.depth
        folder.status = "active"
        folder.trash = undefined
        if (changed) {
          folder.updatedAt = timestamp
          markFolder(folder.id)
        }
        scannedFolderIDs.add(folder.id)
        folderIDsByPath.set(key, folder.id)
      } else {
        const created: CinemaAssetFolder = {
          id: `folder_${randomUUID()}`,
          parentID,
          name: scannedFolder.name,
          relativePath: scannedFolder.relativePath,
          depth: scannedFolder.depth,
          system: false,
          status: "active",
          createdAt: timestamp,
          updatedAt: timestamp,
        }
        catalog.folders.push(created)
        scannedFolderIDs.add(created.id)
        folderIDsByPath.set(key, created.id)
        markFolder(created.id)
      }
    }
    for (const folder of catalog.folders) {
      if (folder.status === "trashed" || scannedFolderIDs.has(folder.id)) continue
      if (folder.status !== "missing") {
        folder.status = "missing"
        folder.updatedAt = timestamp
        markFolder(folder.id)
      }
    }

    const catalogAssets = catalog.assets.filter((asset) => asset.status !== "trashed")
    const assetsByPath = new Map<string, CinemaAssetRecord[]>()
    for (const asset of catalogAssets) appendGrouped(assetsByPath, relativePathKey(asset.relativePath), asset)
    const unmatchedAssetIDs = new Set(catalogAssets.map((asset) => asset.id))
    const unmatchedFilePaths = new Set(scan.files.map((file) => file.relativePath))
    let moved = 0
    let discovered = 0

    const applyMatch = (asset: CinemaAssetRecord, scannedFile: ScannedCinemaAssetFile) => {
      const folderID = folderIDsByPath.get(relativePathKey(scannedFile.folderRelativePath))
      if (!folderID) throw new ApiError(409, "CINEMA_LIBRARY_FOLDER_PARENT_MISSING", "A scanned asset folder could not be resolved.")
      const applied = applyScannedFileToAsset(asset, scannedFile, folderID)
      unmatchedAssetIDs.delete(asset.id)
      unmatchedFilePaths.delete(scannedFile.relativePath)
      if (applied.changed) markAsset(asset.id)
      if (applied.moved) moved += 1
      if (applied.shouldProcess) processingAssetIDs.add(asset.id)
    }

    // Exact physical paths are authoritative and do not need heuristic matching.
    for (const scannedFile of scan.files) {
      const candidates = assetsByPath.get(relativePathKey(scannedFile.relativePath)) ?? []
      if (candidates.length === 1 && candidates[0]!.kind === scannedFile.kind) applyMatch(candidates[0]!, scannedFile)
    }

    // A stored device/inode pair is the strongest way to recognize a file
    // moved outside the app. Require uniqueness on both sides before reusing an
    // asset id; network/virtual filesystems sometimes report duplicate values.
    const remainingAssets = () => catalogAssets.filter((asset) => unmatchedAssetIDs.has(asset.id))
    const remainingFiles = () => scan.files.filter((file) => unmatchedFilePaths.has(file.relativePath))
    const assetIdentityGroups = new Map<string, CinemaAssetRecord[]>()
    const fileIdentityGroups = new Map<string, ScannedCinemaAssetFile[]>()
    for (const asset of remainingAssets()) {
      appendGrouped(assetIdentityGroups, asset.fileIdentity ? `${asset.kind}:${asset.fileIdentity}` : undefined, asset)
    }
    for (const file of remainingFiles()) {
      appendGrouped(fileIdentityGroups, file.fileIdentity ? `${file.kind}:${file.fileIdentity}` : undefined, file)
    }
    for (const [identity, assets] of assetIdentityGroups) {
      const files = fileIdentityGroups.get(identity) ?? []
      if (assets.length === 1 && files.length === 1) applyMatch(assets[0]!, files[0]!)
    }

    // Older catalogs and filesystems without stable inodes use size + SHA-256.
    // Both the old-record group and new-file group must contain exactly one
    // item, otherwise keeping the old id would be a silent, ambiguous relink.
    const assetChecksumGroups = new Map<string, CinemaAssetRecord[]>()
    const fileChecksumGroups = new Map<string, ScannedCinemaAssetFile[]>()
    for (const asset of remainingAssets()) appendGrouped(assetChecksumGroups, `${asset.kind}:${asset.sizeBytes}:${asset.checksum}`, asset)
    for (const file of remainingFiles()) appendGrouped(fileChecksumGroups, `${file.kind}:${file.sizeBytes}:${file.checksum}`, file)
    for (const [checksumKey, assets] of assetChecksumGroups) {
      const files = fileChecksumGroups.get(checksumKey) ?? []
      if (assets.length === 1 && files.length === 1) applyMatch(assets[0]!, files[0]!)
      else if (assets.length > 0 && files.length > 0) {
        scan.warnings.push(`Did not relink ambiguous external move group '${checksumKey}'.`)
      }
    }

    let missing = 0
    for (const asset of remainingAssets()) {
      if (asset.status !== "missing") {
        asset.status = "missing"
        asset.failureReason = "Asset file is missing."
        asset.updatedAt = timestamp
        markAsset(asset.id)
      }
      missing += 1
    }
    missing += catalog.folders.filter((folder) => folder.status === "missing").length

    for (const scannedFile of remainingFiles()) {
      const folderID = folderIDsByPath.get(relativePathKey(scannedFile.folderRelativePath))
      if (!folderID) throw new ApiError(409, "CINEMA_LIBRARY_FOLDER_PARENT_MISSING", "A scanned asset folder could not be resolved.")
      const asset: CinemaAssetRecord = {
        id: `asset_${randomUUID()}`,
        folderID,
        relativePath: scannedFile.relativePath,
        displayName: scannedFile.displayName,
        kind: scannedFile.kind,
        source: "discovered",
        status: "processing",
        mimeType: scannedFile.mimeType,
        sizeBytes: scannedFile.sizeBytes,
        checksum: scannedFile.checksum,
        fileIdentity: scannedFile.fileIdentity,
        contentRevision: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      }
      catalog.assets.push(asset)
      processingAssetIDs.add(asset.id)
      markAsset(asset.id)
      discovered += 1
    }

    return {
      value: {
        affected: [...affected.values()],
        reconciled: affected.size,
        full,
        discovered,
        moved,
        missing,
        warnings: scan.warnings,
      },
    }
  })
  for (const assetID of processingAssetIDs) scheduleCinemaAssetProcessing(scope, assetID)
  return result
}

type PersonalAssetReferencesDocument = {
  schemaVersion: 1
  assets: Record<string, Array<{ projectID: string; nodeID: string; updatedAt: string }>>
  updatedAt: string
}

async function readPersonalAssetReferences(paths: CinemaAssetLibraryPaths): Promise<PersonalAssetReferencesDocument> {
  const filePath = path.join(paths.managedRoot, "references.json")
  const raw = await readFile(filePath, "utf8").catch((error: unknown) => {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return ""
    throw error
  })
  if (!raw) return { schemaVersion: 1, assets: {}, updatedAt: nowISO() }
  try {
    const parsed = JSON.parse(raw) as Partial<PersonalAssetReferencesDocument>
    return {
      schemaVersion: 1,
      assets: parsed.assets && typeof parsed.assets === "object" ? parsed.assets : {},
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : nowISO(),
    }
  } catch {
    throw new ApiError(409, "CINEMA_LIBRARY_REFERENCES_INVALID", "Personal asset references are corrupt.")
  }
}

export async function addCinemaPersonalAssetReference(assetID: string, projectID: string, nodeID: string) {
  const scope: CinemaAssetScope = { type: "personal" }
  const paths = resolveLibraryPaths(scope)
  using _lock = await Lock.write(paths.scopeKey)
  const catalog = await ensureInitializedUnlocked(paths)
  const asset = findAsset(catalog, assetID)
  if (asset.status !== "ready") {
    throw new ApiError(409, "CINEMA_LIBRARY_ASSET_NOT_READY", "Only ready personal assets can be referenced.")
  }
  const references = await readPersonalAssetReferences(paths)
  const current = references.assets[assetID] ?? []
  const timestamp = nowISO()
  references.assets[assetID] = [
    ...current.filter((item) => item.projectID !== projectID || item.nodeID !== nodeID),
    { projectID, nodeID, updatedAt: timestamp },
  ]
  references.updatedAt = timestamp
  await atomicWriteJson(path.join(paths.managedRoot, "references.json"), references)
  return { assetID, projectID, nodeID }
}

export async function removeCinemaPersonalAssetReference(assetID: string, projectID: string, nodeID: string) {
  const scope: CinemaAssetScope = { type: "personal" }
  const paths = resolveLibraryPaths(scope)
  using _lock = await Lock.write(paths.scopeKey)
  await ensureInitializedUnlocked(paths)
  const references = await readPersonalAssetReferences(paths)
  const next = (references.assets[assetID] ?? []).filter((item) => item.projectID !== projectID || item.nodeID !== nodeID)
  if (next.length > 0) references.assets[assetID] = next
  else delete references.assets[assetID]
  references.updatedAt = nowISO()
  await atomicWriteJson(path.join(paths.managedRoot, "references.json"), references)
  return { assetID, projectID, nodeID }
}

export async function listCinemaPersonalAssetDependencies(projectID: string) {
  const scope: CinemaAssetScope = { type: "personal" }
  const paths = resolveLibraryPaths(scope)
  using _lock = await Lock.read(paths.scopeKey)
  const references = await readPersonalAssetReferences(paths)
  return Object.entries(references.assets)
    .map(([assetID, items]) => ({
      assetID,
      nodeIDs: items.filter((item) => item.projectID === projectID).map((item) => item.nodeID),
    }))
    .filter((item) => item.nodeIDs.length > 0)
}
