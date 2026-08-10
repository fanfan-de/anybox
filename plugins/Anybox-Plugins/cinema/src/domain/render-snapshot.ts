import { randomUUID } from "node:crypto"
import { constants as fsConstants } from "node:fs"
import {
  copyFile,
  link,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
} from "node:fs/promises"
import path from "node:path"

import type { CinemaAssetRecord, CinemaAssetRef } from "@anybox/cinema-plugin/contracts"
import {
  CinemaRenderSafeIDSchema,
  type CinemaRenderJob,
} from "@anybox/cinema-plugin/contracts/render"
import {
  CinemaTimelineDocumentSchema,
  type CinemaTimelineDocument,
} from "@anybox/cinema-plugin/contracts/timeline"

import { getCinemaAssetFilePath } from "#cinema/asset-library.ts"
import {
  getCinemaRenderJobStoragePaths,
  readCinemaRenderJob,
} from "#cinema/render-storage.ts"

export type CinemaRenderInputSnapshotMethod = "hardlink" | "copy"

export type CinemaRenderInputSnapshot = {
  assetRef: CinemaAssetRef
  fileName: string
  method: CinemaRenderInputSnapshotMethod
  sizeBytes: number
}

export type CinemaRenderStoredInput = {
  assetRef: CinemaAssetRef
  fileName: string
  filePath: string
  sizeBytes: number
}

export type CinemaRenderSnapshotDependencies = {
  getCinemaAssetFilePath: typeof getCinemaAssetFilePath
  createHardLink: typeof link
  copyFile: typeof copyFile
}

const defaultDependencies: CinemaRenderSnapshotDependencies = {
  getCinemaAssetFilePath,
  createHardLink: link,
  copyFile,
}

export type CinemaRenderSnapshotTestHooks = {
  beforeWriteTimelineSnapshot: (input: {
    cinemaRoot: string
    jobID: string
    timelineSnapshotPath: string
  }) => void | Promise<void>
  beforeSnapshotInputs: (input: {
    cinemaRoot: string
    jobID: string
    inputsDirectory: string
  }) => void | Promise<void>
}

let snapshotTestHooks: Partial<CinemaRenderSnapshotTestHooks> = {}

/** Installs deterministic snapshot fault hooks and returns a scoped restore. */
export function setCinemaRenderSnapshotHooksForTesting(
  overrides: Partial<CinemaRenderSnapshotTestHooks>,
) {
  const previous = snapshotTestHooks
  snapshotTestHooks = {
    ...previous,
    ...overrides,
  }
  return () => {
    snapshotTestHooks = previous
  }
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT")
}

function isAlreadyExistsError(error: unknown): error is NodeJS.ErrnoException {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "EEXIST")
}

async function assertPhysicalFile(filePath: string, label: string) {
  const info = await lstat(filePath).catch((error: unknown) => {
    if (isMissingFileError(error)) return undefined
    throw error
  })
  if (!info?.isFile() || info.isSymbolicLink()) {
    throw new Error(`${label} must be a physical file`)
  }
  return info
}

async function requireRenderJob(cinemaRoot: string, jobID: string) {
  const job = await readCinemaRenderJob(cinemaRoot, jobID)
  if (!job) throw new Error("Render job does not exist")
  return job
}

function assertTimelineMatchesJob(job: CinemaRenderJob, timeline: CinemaTimelineDocument) {
  if (timeline.projectID !== job.projectID) {
    throw new Error("Timeline project does not match the render job")
  }
  if (timeline.id !== job.timelineID) {
    throw new Error("Timeline id does not match the render job")
  }
  if (timeline.revision !== job.timelineRevision) {
    throw new Error("Timeline revision does not match the render job")
  }
}

function timelineAssetRefs(timeline: CinemaTimelineDocument) {
  const unique = new Map<string, CinemaAssetRef>()
  for (const clip of timeline.clips) {
    if (!("assetRef" in clip)) continue
    const ref = clip.assetRef
    const scopeKey = ref.scope.type === "project" ? `project:${ref.scope.projectID}` : "personal"
    const key = `${scopeKey}:${ref.assetID}:${ref.contentRevision}`
    unique.set(key, ref)
  }
  return [...unique.values()]
}

function safeSnapshotExtension(filePath: string) {
  const extension = path.extname(filePath).toLowerCase()
  return /^\.[a-z0-9]{1,16}$/.test(extension) ? extension : ".bin"
}

function snapshotFileName(assetRef: CinemaAssetRef, sourcePath: string) {
  const assetID = CinemaRenderSafeIDSchema.parse(assetRef.assetID)
  return `${assetID}_${assetRef.contentRevision}${safeSnapshotExtension(sourcePath)}`
}

function assertAssetMatchesReference(
  job: CinemaRenderJob,
  assetRef: CinemaAssetRef,
  asset: CinemaAssetRecord,
) {
  if (assetRef.scope.type === "project" && assetRef.scope.projectID !== job.projectID) {
    throw new Error("Project asset scope does not match the render job")
  }
  if (asset.id !== assetRef.assetID) {
    throw new Error("Resolved asset id does not match the Timeline reference")
  }
  if (asset.status !== "ready") {
    throw new Error("Resolved asset is not ready")
  }
  if (asset.contentRevision !== assetRef.contentRevision) {
    throw new Error("Asset content revision is stale")
  }
  if (asset.kind !== assetRef.snapshot.kind) {
    throw new Error("Asset kind does not match the Timeline reference")
  }
}

async function writeImmutableJson(filePath: string, value: unknown) {
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${randomUUID()}.tmp`,
  )
  const handle = await open(temporaryPath, "wx")
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8")
    await handle.sync()
  } finally {
    await handle.close()
  }

  try {
    await link(temporaryPath, filePath)
  } catch (error) {
    if (isAlreadyExistsError(error)) {
      throw new Error("Render job Timeline snapshot already exists")
    }
    throw error
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
  }
}

export async function writeCinemaRenderTimelineSnapshot(
  cinemaRoot: string,
  jobID: string,
  timelineInput: CinemaTimelineDocument,
) {
  const job = await requireRenderJob(cinemaRoot, jobID)
  const timeline = CinemaTimelineDocumentSchema.parse(timelineInput)
  assertTimelineMatchesJob(job, timeline)
  const { timelineSnapshotPath } = getCinemaRenderJobStoragePaths(cinemaRoot, jobID)
  await snapshotTestHooks.beforeWriteTimelineSnapshot?.({
    cinemaRoot,
    jobID,
    timelineSnapshotPath,
  })
  await writeImmutableJson(timelineSnapshotPath, timeline)
  return timeline
}

export async function readCinemaRenderTimelineSnapshot(
  cinemaRoot: string,
  jobID: string,
): Promise<CinemaTimelineDocument | undefined> {
  const job = await readCinemaRenderJob(cinemaRoot, jobID)
  if (!job) return undefined
  const { timelineSnapshotPath } = getCinemaRenderJobStoragePaths(cinemaRoot, jobID)
  const raw = await readFile(timelineSnapshotPath, "utf8").catch((error: unknown) => {
    if (isMissingFileError(error)) return undefined
    throw error
  })
  if (raw === undefined) return undefined
  await assertPhysicalFile(timelineSnapshotPath, "Render job Timeline snapshot")
  const timeline = CinemaTimelineDocumentSchema.parse(JSON.parse(raw))
  assertTimelineMatchesJob(job, timeline)
  return timeline
}

async function snapshotOneInput(
  job: CinemaRenderJob,
  assetRef: CinemaAssetRef,
  stagingDirectory: string,
  dependencies: CinemaRenderSnapshotDependencies,
): Promise<CinemaRenderInputSnapshot> {
  const resolved = await dependencies.getCinemaAssetFilePath(assetRef.scope, assetRef.assetID)
  assertAssetMatchesReference(job, assetRef, resolved.asset)
  const sourceInfo = await assertPhysicalFile(resolved.filePath, "Render input source")
  const fileName = snapshotFileName(assetRef, resolved.filePath)
  const destinationPath = path.join(stagingDirectory, fileName)
  let method: CinemaRenderInputSnapshotMethod = "copy"

  if (assetRef.scope.type === "project") {
    try {
      await dependencies.createHardLink(resolved.filePath, destinationPath)
      method = "hardlink"
    } catch {
      await dependencies.copyFile(resolved.filePath, destinationPath, fsConstants.COPYFILE_EXCL)
    }
  } else {
    await dependencies.copyFile(resolved.filePath, destinationPath, fsConstants.COPYFILE_EXCL)
  }

  const [finalSourceInfo, destinationInfo] = await Promise.all([
    assertPhysicalFile(resolved.filePath, "Render input source"),
    assertPhysicalFile(destinationPath, "Render input snapshot"),
  ])
  if (
    finalSourceInfo.size !== sourceInfo.size
    || finalSourceInfo.mtimeMs !== sourceInfo.mtimeMs
    || destinationInfo.size !== sourceInfo.size
  ) {
    throw new Error("Render input changed while it was being snapshotted")
  }

  return {
    assetRef,
    fileName,
    method,
    sizeBytes: destinationInfo.size,
  }
}

export async function snapshotCinemaRenderInputs(
  cinemaRoot: string,
  jobID: string,
  dependencies: CinemaRenderSnapshotDependencies = defaultDependencies,
): Promise<CinemaRenderInputSnapshot[]> {
  const job = await requireRenderJob(cinemaRoot, jobID)
  const timeline = await readCinemaRenderTimelineSnapshot(cinemaRoot, jobID)
  if (!timeline) throw new Error("Render job Timeline snapshot does not exist")
  const paths = getCinemaRenderJobStoragePaths(cinemaRoot, jobID)
  const existingInputs = await lstat(paths.inputsDirectory).catch((error: unknown) => {
    if (isMissingFileError(error)) return undefined
    throw error
  })
  if (existingInputs) throw new Error("Render job input snapshot already exists")

  await snapshotTestHooks.beforeSnapshotInputs?.({
    cinemaRoot,
    jobID,
    inputsDirectory: paths.inputsDirectory,
  })

  const stagingDirectory = path.join(paths.jobDirectory, `.inputs.${randomUUID()}.tmp`)
  await mkdir(stagingDirectory)
  try {
    const snapshots: CinemaRenderInputSnapshot[] = []
    for (const assetRef of timelineAssetRefs(timeline)) {
      snapshots.push(await snapshotOneInput(job, assetRef, stagingDirectory, dependencies))
    }
    await rename(stagingDirectory, paths.inputsDirectory)
    return snapshots
  } catch (error) {
    await rm(stagingDirectory, { recursive: true, force: true }).catch(() => undefined)
    throw error
  }
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

export async function resolveCinemaRenderSnapshotInputs(
  cinemaRoot: string,
  jobID: string,
): Promise<CinemaRenderStoredInput[]> {
  const timeline = await readCinemaRenderTimelineSnapshot(cinemaRoot, jobID)
  if (!timeline) throw new Error("Render job Timeline snapshot does not exist")
  const paths = getCinemaRenderJobStoragePaths(cinemaRoot, jobID)
  const inputsInfo = await lstat(paths.inputsDirectory).catch((error: unknown) => {
    if (isMissingFileError(error)) return undefined
    throw error
  })
  if (!inputsInfo?.isDirectory() || inputsInfo.isSymbolicLink()) {
    throw new Error("Render job input snapshot must be a physical directory")
  }
  const entries = await readdir(paths.inputsDirectory, { withFileTypes: true })
  const stored: CinemaRenderStoredInput[] = []
  for (const assetRef of timelineAssetRefs(timeline)) {
    const assetID = CinemaRenderSafeIDSchema.parse(assetRef.assetID)
    const pattern = new RegExp(`^${escapeRegExp(assetID)}_${assetRef.contentRevision}\\.[a-z0-9]{1,16}$`)
    const matches = entries.filter((entry) => entry.isFile() && pattern.test(entry.name))
    if (matches.length !== 1) {
      throw new Error(`Render input snapshot is missing or ambiguous for asset '${assetID}'`)
    }
    const fileName = matches[0]!.name
    const filePath = path.join(paths.inputsDirectory, fileName)
    const info = await assertPhysicalFile(filePath, "Render input snapshot")
    stored.push({ assetRef, fileName, filePath, sizeBytes: info.size })
  }
  return stored
}

export async function cloneCinemaRenderInputs(
  cinemaRoot: string,
  sourceJobID: string,
  targetJobID: string,
) {
  const sourceInputs = await resolveCinemaRenderSnapshotInputs(cinemaRoot, sourceJobID)
  await requireRenderJob(cinemaRoot, targetJobID)
  const targetPaths = getCinemaRenderJobStoragePaths(cinemaRoot, targetJobID)
  const existing = await lstat(targetPaths.inputsDirectory).catch((error: unknown) => {
    if (isMissingFileError(error)) return undefined
    throw error
  })
  if (existing) throw new Error("Render job input snapshot already exists")

  const stagingDirectory = path.join(targetPaths.jobDirectory, `.inputs.${randomUUID()}.tmp`)
  await mkdir(stagingDirectory)
  try {
    for (const input of sourceInputs) {
      const destination = path.join(stagingDirectory, input.fileName)
      try {
        await link(input.filePath, destination)
      } catch {
        await copyFile(input.filePath, destination, fsConstants.COPYFILE_EXCL)
      }
      const info = await assertPhysicalFile(destination, "Cloned render input snapshot")
      if (info.size !== input.sizeBytes) throw new Error("Cloned render input size changed")
    }
    await rename(stagingDirectory, targetPaths.inputsDirectory)
  } catch (error) {
    await rm(stagingDirectory, { recursive: true, force: true }).catch(() => undefined)
    throw error
  }
  return await resolveCinemaRenderSnapshotInputs(cinemaRoot, targetJobID)
}
