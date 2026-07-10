import { randomUUID } from "node:crypto"
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
} from "node:fs/promises"
import path from "node:path"
import { z } from "zod"

import {
  CinemaRenderJobEventSchema,
  CinemaRenderJobIDSchema,
  CinemaRenderJobSchema,
  type CinemaRenderJob,
  type CinemaRenderJobEvent,
} from "@anybox/shared/cinema-render"

export type CinemaRenderJobStoragePaths = {
  renderJobsDirectory: string
  jobDirectory: string
  jobPath: string
  timelineSnapshotPath: string
  eventsPath: string
  inputsDirectory: string
  temporaryOutputPath: string
}

export const CinemaRenderQueueStateSchema = z.object({
  schemaVersion: z.literal(1),
  pendingJobIDs: z.array(CinemaRenderJobIDSchema).max(10_000),
  updatedAt: z.string().datetime({ offset: true }),
}).strict()
export type CinemaRenderQueueState = z.infer<typeof CinemaRenderQueueStateSchema>

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT")
}

function assertPathInside(parent: string, candidate: string) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate))
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    if (!relative) return
    throw new Error("Render job path resolves outside the Cinema project directory")
  }
}

async function assertDirectoryIsSafe(parent: string, candidate: string) {
  const stats = await lstat(candidate)
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error("Render job storage directory must be a physical directory")
  }
  const [resolvedParent, resolvedCandidate] = await Promise.all([
    realpath(parent),
    realpath(candidate),
  ])
  assertPathInside(resolvedParent, resolvedCandidate)
}

async function assertFileIsNotSymlink(filePath: string) {
  const stats = await lstat(filePath).catch((error: unknown) => {
    if (isMissingFileError(error)) return undefined
    throw error
  })
  if (stats?.isSymbolicLink()) {
    throw new Error("Render job storage files must not be symbolic links")
  }
  if (stats && !stats.isFile()) {
    throw new Error("Render job storage path must be a regular file")
  }
}

async function ensureRenderJobsDirectory(cinemaRoot: string) {
  const renderJobsDirectory = path.join(cinemaRoot, "render-jobs")
  await mkdir(renderJobsDirectory, { recursive: true })
  await assertDirectoryIsSafe(cinemaRoot, renderJobsDirectory)
  return renderJobsDirectory
}

async function ensureRenderJobDirectory(cinemaRoot: string, jobID: string) {
  const paths = getCinemaRenderJobStoragePaths(cinemaRoot, jobID)
  await ensureRenderJobsDirectory(cinemaRoot)
  await mkdir(paths.jobDirectory, { recursive: true })
  await assertDirectoryIsSafe(paths.renderJobsDirectory, paths.jobDirectory)
  return paths
}

async function existingRenderJobDirectory(cinemaRoot: string, jobID: string) {
  const paths = getCinemaRenderJobStoragePaths(cinemaRoot, jobID)
  const exists = await lstat(paths.jobDirectory).catch((error: unknown) => {
    if (isMissingFileError(error)) return undefined
    throw error
  })
  if (!exists) return undefined
  await assertDirectoryIsSafe(cinemaRoot, paths.renderJobsDirectory)
  await assertDirectoryIsSafe(paths.renderJobsDirectory, paths.jobDirectory)
  return paths
}

async function atomicWriteJson(filePath: string, value: unknown) {
  const directory = path.dirname(filePath)
  await assertDirectoryIsSafe(path.dirname(directory), directory)
  await assertFileIsNotSymlink(filePath)
  const temporaryPath = path.join(directory, `.${path.basename(filePath)}.${randomUUID()}.tmp`)
  assertPathInside(directory, temporaryPath)

  const handle = await open(temporaryPath, "wx")
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8")
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

export function assertCinemaRenderJobID(jobID: string) {
  return CinemaRenderJobIDSchema.parse(jobID)
}

export function getCinemaRenderJobStoragePaths(
  cinemaRoot: string,
  jobID: string,
): CinemaRenderJobStoragePaths {
  assertCinemaRenderJobID(jobID)

  const renderJobsDirectory = path.join(cinemaRoot, "render-jobs")
  const jobDirectory = path.join(renderJobsDirectory, `job_${jobID}`)
  const jobPath = path.join(jobDirectory, "job.json")
  const timelineSnapshotPath = path.join(jobDirectory, "timeline.json")
  const eventsPath = path.join(jobDirectory, "events.jsonl")
  const inputsDirectory = path.join(jobDirectory, "inputs")
  const temporaryOutputPath = path.join(jobDirectory, "output.tmp.mp4")

  for (const candidate of [
    renderJobsDirectory,
    jobDirectory,
    jobPath,
    timelineSnapshotPath,
    eventsPath,
    inputsDirectory,
    temporaryOutputPath,
  ]) {
    assertPathInside(cinemaRoot, candidate)
  }

  return {
    renderJobsDirectory,
    jobDirectory,
    jobPath,
    timelineSnapshotPath,
    eventsPath,
    inputsDirectory,
    temporaryOutputPath,
  }
}

export function getCinemaRenderQueuePath(cinemaRoot: string) {
  const queuePath = path.join(cinemaRoot, "render-queue.json")
  assertPathInside(cinemaRoot, queuePath)
  return queuePath
}

export async function readCinemaRenderQueueState(
  cinemaRoot: string,
): Promise<CinemaRenderQueueState> {
  const queuePath = getCinemaRenderQueuePath(cinemaRoot)
  await assertFileIsNotSymlink(queuePath)
  const raw = await readFile(queuePath, "utf8").catch((error: unknown) => {
    if (isMissingFileError(error)) return undefined
    throw error
  })
  if (raw === undefined) {
    return { schemaVersion: 1, pendingJobIDs: [], updatedAt: new Date(0).toISOString() }
  }
  return CinemaRenderQueueStateSchema.parse(JSON.parse(raw))
}

export async function writeCinemaRenderQueueState(
  cinemaRoot: string,
  state: CinemaRenderQueueState,
) {
  const parsed = CinemaRenderQueueStateSchema.parse(state)
  await atomicWriteJson(getCinemaRenderQueuePath(cinemaRoot), parsed)
}

export async function readCinemaRenderJob(
  cinemaRoot: string,
  jobID: string,
): Promise<CinemaRenderJob | undefined> {
  const paths = await existingRenderJobDirectory(cinemaRoot, jobID)
  if (!paths) return undefined
  await assertFileIsNotSymlink(paths.jobPath)
  const raw = await readFile(paths.jobPath, "utf8").catch((error: unknown) => {
    if (isMissingFileError(error)) return undefined
    throw error
  })
  if (raw === undefined) return undefined
  return CinemaRenderJobSchema.parse(JSON.parse(raw))
}

export async function writeCinemaRenderJob(cinemaRoot: string, job: CinemaRenderJob) {
  const parsed = CinemaRenderJobSchema.parse(job)
  const paths = await ensureRenderJobDirectory(cinemaRoot, parsed.id)
  await atomicWriteJson(paths.jobPath, parsed)
}

export async function listCinemaRenderJobs(cinemaRoot: string) {
  const renderJobsDirectory = path.join(cinemaRoot, "render-jobs")
  const entries = await readdir(renderJobsDirectory, { withFileTypes: true }).catch((error: unknown) => {
    if (isMissingFileError(error)) return []
    throw error
  })
  if (entries.length > 0) await assertDirectoryIsSafe(cinemaRoot, renderJobsDirectory)

  const jobIDs: string[] = []
  for (const entry of entries) {
    const match = entry.isDirectory()
      ? /^job_([A-Za-z0-9][A-Za-z0-9_-]{0,127})$/.exec(entry.name)
      : null
    if (!match?.[1]) continue
    jobIDs.push(match[1])
  }

  // A project can legitimately contain thousands of immutable job records. Reading each
  // job serially makes the first Deliver history load scale with filesystem round trips.
  // Keep concurrency bounded so large histories are fast without exhausting file handles.
  const jobsByIndex = new Array<CinemaRenderJob | undefined>(jobIDs.length)
  let nextIndex = 0
  const workerCount = Math.min(32, jobIDs.length)
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < jobIDs.length) {
      const index = nextIndex
      nextIndex += 1
      jobsByIndex[index] = await readCinemaRenderJob(cinemaRoot, jobIDs[index]!)
    }
  }))

  return jobsByIndex
    .filter((job): job is CinemaRenderJob => Boolean(job))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
}

export async function appendCinemaRenderJobEvent(
  cinemaRoot: string,
  event: CinemaRenderJobEvent,
) {
  const parsed = CinemaRenderJobEventSchema.parse(event)
  const paths = await ensureRenderJobDirectory(cinemaRoot, parsed.jobID)
  await assertFileIsNotSymlink(paths.eventsPath)
  const handle = await open(paths.eventsPath, "a")
  try {
    await handle.writeFile(`${JSON.stringify(parsed)}\n`, "utf8")
    await handle.sync()
  } finally {
    await handle.close()
  }
}

export async function readCinemaRenderJobEvents(
  cinemaRoot: string,
  jobID: string,
): Promise<CinemaRenderJobEvent[]> {
  const paths = await existingRenderJobDirectory(cinemaRoot, jobID)
  if (!paths) return []
  await assertFileIsNotSymlink(paths.eventsPath)
  const raw = await readFile(paths.eventsPath, "utf8").catch((error: unknown) => {
    if (isMissingFileError(error)) return ""
    throw error
  })
  return raw
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => CinemaRenderJobEventSchema.parse(JSON.parse(line)))
}
