import type { Stats } from "node:fs"
import {
  lstat,
  readdir,
  realpath,
  rmdir,
  unlink,
} from "node:fs/promises"
import path from "node:path"

import { isCinemaRenderTerminalStatus } from "@anybox/cinema-plugin/contracts/render"

import {
  getCinemaRenderJobStoragePaths,
  readCinemaRenderJob,
} from "#cinema/render-storage.ts"

export type CinemaRenderRetentionTarget =
  | "inputs"
  | "input-staging"
  | "temporary-output"

export type CinemaRenderRetentionSkipReason =
  | "active-job"
  | "within-retention"
  | "unsafe-job-directory"
  | "unsafe-candidate"

export type CinemaRenderRetentionErrorCode =
  | "render-root-unavailable"
  | "job-metadata-invalid"
  | "job-metadata-changed"
  | "candidate-cleanup-failed"

export type CinemaRenderRetentionResult = {
  dryRun: boolean
  discoveredJobCount: number
  terminalJobCount: number
  eligibleJobCount: number
  estimatedReclaimableBytes: number
  candidateJobs: Array<{
    jobID: string
    targets: CinemaRenderRetentionTarget[]
    estimatedReclaimableBytes: number
    fileCount: number
    directoryCount: number
  }>
  reclaimedBytes: number
  cleanedJobs: Array<{
    jobID: string
    targets: CinemaRenderRetentionTarget[]
    reclaimedBytes: number
    removedFileCount: number
    removedDirectoryCount: number
  }>
  skipped: Array<{
    jobID: string
    reason: CinemaRenderRetentionSkipReason
    target?: CinemaRenderRetentionTarget
  }>
  errors: Array<{
    jobID?: string
    code: CinemaRenderRetentionErrorCode
    target?: CinemaRenderRetentionTarget | "render-jobs" | "job-metadata"
    message: string
  }>
}

export type CinemaRenderRetentionOptions = {
  /** Required product policy input. This module intentionally has no retention default. */
  retentionDurationMs: number
  /** Inspection only. Existing callers retain execute behavior unless they opt in. */
  dryRun?: boolean
  /** Cancellation is honored only for dry-run inspection; confirmed deletion is non-cancelable. */
  signal?: AbortSignal
  now?: Date | string | number
}

type ValidatedNode = {
  path: string
  canonicalPath: string
  kind: "file" | "directory"
  dev: bigint | number
  ino: bigint | number
  reclaimableBytes: number
}

type RemovedTarget = {
  reclaimedBytes: number
  removedFileCount: number
  removedDirectoryCount: number
}

class UnsafeRetentionPathError extends Error {}

class RetentionRemovalError extends Error {
  readonly removed: RemovedTarget

  constructor(removed: RemovedTarget) {
    super("A validated retention candidate changed or could not be removed.")
    this.name = "RetentionRemovalError"
    this.removed = removed
  }
}

const JOB_DIRECTORY_PATTERN = /^job_([A-Za-z0-9][A-Za-z0-9_-]{0,127})$/
const INPUT_STAGING_PATTERN = /^\.inputs\.[A-Za-z0-9-]+\.tmp$/

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT")
}

function assertRetentionDuration(retentionDurationMs: number) {
  if (!Number.isSafeInteger(retentionDurationMs) || retentionDurationMs <= 0) {
    throw new TypeError("Render retention duration must be an explicit positive integer of milliseconds")
  }
}

function throwIfRetentionAborted(signal: AbortSignal | undefined) {
  if (!signal?.aborted) return
  const error = new Error("Render retention preview was canceled.")
  error.name = "AbortError"
  throw error
}

function parseNow(value: CinemaRenderRetentionOptions["now"]) {
  const milliseconds = value === undefined
    ? Date.now()
    : value instanceof Date
      ? value.getTime()
      : typeof value === "number"
        ? value
        : Date.parse(value)
  if (!Number.isFinite(milliseconds)) {
    throw new TypeError("Render retention time must be a valid Date, timestamp, or ISO date string")
  }
  return milliseconds
}

function isInside(parent: string, candidate: string) {
  const relative = path.relative(parent, candidate)
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative)
}

function assertLexicallyInside(parent: string, candidate: string) {
  if (!isInside(path.resolve(parent), path.resolve(candidate))) {
    throw new UnsafeRetentionPathError("Retention candidate is outside its job sandbox")
  }
}

function assertCanonicallyInside(parent: string, candidate: string) {
  if (!isInside(parent, candidate)) {
    throw new UnsafeRetentionPathError("Retention candidate resolves outside its job sandbox")
  }
}

async function physicalDirectoryCanonicalPath(parentCanonical: string, directoryPath: string) {
  const info = await lstat(directoryPath)
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new UnsafeRetentionPathError("Retention storage must use physical directories")
  }
  const canonicalPath = await realpath(directoryPath)
  assertCanonicallyInside(parentCanonical, canonicalPath)
  return canonicalPath
}

function sameNode(info: Stats, expected: ValidatedNode) {
  return info.dev === expected.dev
    && info.ino === expected.ino
    && !info.isSymbolicLink()
    && (expected.kind === "file" ? info.isFile() : info.isDirectory())
}

function reclaimableFileBytes(info: Stats) {
  // Input snapshots are frequently hard links. Removing a non-final link is safe but
  // does not reclaim file contents, so report zero rather than overstating savings.
  return info.nlink > 1 ? 0 : info.size
}

async function inspectPhysicalTree(
  sandboxCanonicalPath: string,
  candidatePath: string,
  nodes: ValidatedNode[] = [],
  signal?: AbortSignal,
): Promise<ValidatedNode[]> {
  throwIfRetentionAborted(signal)
  const info = await lstat(candidatePath)
  if (info.isSymbolicLink() || (!info.isFile() && !info.isDirectory())) {
    throw new UnsafeRetentionPathError("Retention candidates must be physical files or directories")
  }
  const canonicalPath = await realpath(candidatePath)
  assertCanonicallyInside(sandboxCanonicalPath, canonicalPath)

  if (info.isFile()) {
    nodes.push({
      path: candidatePath,
      canonicalPath,
      kind: "file",
      dev: info.dev,
      ino: info.ino,
      reclaimableBytes: reclaimableFileBytes(info),
    })
    return nodes
  }

  const entries = await readdir(candidatePath, { withFileTypes: true })
  for (const entry of entries) {
    throwIfRetentionAborted(signal)
    const childPath = path.join(candidatePath, entry.name)
    assertLexicallyInside(candidatePath, childPath)
    await inspectPhysicalTree(sandboxCanonicalPath, childPath, nodes, signal)
  }
  nodes.push({
    path: candidatePath,
    canonicalPath,
    kind: "directory",
    dev: info.dev,
    ino: info.ino,
    reclaimableBytes: 0,
  })
  return nodes
}

async function removeValidatedNodes(
  sandboxCanonicalPath: string,
  nodes: ValidatedNode[],
): Promise<RemovedTarget> {
  const removed: RemovedTarget = {
    reclaimedBytes: 0,
    removedFileCount: 0,
    removedDirectoryCount: 0,
  }

  for (const node of nodes) {
    try {
      const info = await lstat(node.path)
      if (!sameNode(info, node)) throw new UnsafeRetentionPathError("Retention candidate changed")
      const canonicalPath = await realpath(node.path)
      if (canonicalPath !== node.canonicalPath) {
        throw new UnsafeRetentionPathError("Retention candidate changed")
      }
      assertCanonicallyInside(sandboxCanonicalPath, canonicalPath)

      if (node.kind === "file") {
        await unlink(node.path)
        removed.reclaimedBytes += node.reclaimableBytes
        removed.removedFileCount += 1
      } else {
        await rmdir(node.path)
        removed.removedDirectoryCount += 1
      }
    } catch (error) {
      if (isMissingFileError(error)) continue
      throw new RetentionRemovalError(removed)
    }
  }
  return removed
}

function addRemoved(left: RemovedTarget, right: RemovedTarget) {
  left.reclaimedBytes += right.reclaimedBytes
  left.removedFileCount += right.removedFileCount
  left.removedDirectoryCount += right.removedDirectoryCount
}

async function inspectCandidate(input: {
  sandboxPath: string
  sandboxCanonicalPath: string
  candidatePath: string
  expectedKind: "file" | "directory"
  signal?: AbortSignal
}): Promise<{ nodes: ValidatedNode[]; summary: RemovedTarget } | undefined> {
  throwIfRetentionAborted(input.signal)
  assertLexicallyInside(input.sandboxPath, input.candidatePath)
  const exists = await lstat(input.candidatePath).catch((error: unknown) => {
    if (isMissingFileError(error)) return undefined
    throw error
  })
  if (!exists) return undefined
  if (
    exists.isSymbolicLink()
    || (input.expectedKind === "file" ? !exists.isFile() : !exists.isDirectory())
  ) {
    throw new UnsafeRetentionPathError("Retention candidate has an unexpected physical type")
  }
  const nodes = await inspectPhysicalTree(
    input.sandboxCanonicalPath,
    input.candidatePath,
    [],
    input.signal,
  )
  return {
    nodes,
    summary: {
      reclaimedBytes: nodes.reduce((total, node) => total + node.reclaimableBytes, 0),
      removedFileCount: nodes.filter((node) => node.kind === "file").length,
      removedDirectoryCount: nodes.filter((node) => node.kind === "directory").length,
    },
  }
}

function emptyResult(dryRun: boolean): CinemaRenderRetentionResult {
  return {
    dryRun,
    discoveredJobCount: 0,
    terminalJobCount: 0,
    eligibleJobCount: 0,
    estimatedReclaimableBytes: 0,
    candidateJobs: [],
    reclaimedBytes: 0,
    cleanedJobs: [],
    skipped: [],
    errors: [],
  }
}

/**
 * Inspects or removes only rebuildable files from terminal render-job sandboxes older
 * than an explicitly supplied retention duration. It does not schedule itself, delete
 * job metadata/events/timeline snapshots, or remove registered output assets.
 */
export async function cleanupCinemaRenderJobRetention(
  cinemaRoot: string,
  options: CinemaRenderRetentionOptions,
): Promise<CinemaRenderRetentionResult> {
  assertRetentionDuration(options.retentionDurationMs)
  const nowMs = parseNow(options.now)
  const dryRun = options.dryRun === true
  const signal = dryRun ? options.signal : undefined
  throwIfRetentionAborted(signal)
  const result = emptyResult(dryRun)
  const renderJobsDirectory = path.join(cinemaRoot, "render-jobs")

  const rootInfo = await lstat(cinemaRoot).catch((error: unknown) => {
    if (isMissingFileError(error)) return undefined
    throw error
  })
  const renderJobsInfo = await lstat(renderJobsDirectory).catch((error: unknown) => {
    if (isMissingFileError(error)) return undefined
    throw error
  })
  if (!renderJobsInfo) return result

  if (
    !rootInfo?.isDirectory()
    || rootInfo.isSymbolicLink()
    || !renderJobsInfo.isDirectory()
    || renderJobsInfo.isSymbolicLink()
  ) {
    result.errors.push({
      code: "render-root-unavailable",
      target: "render-jobs",
      message: "Render retention requires physical Cinema and render-jobs directories.",
    })
    return result
  }

  let renderJobsCanonicalPath: string
  try {
    const cinemaCanonicalPath = await realpath(cinemaRoot)
    renderJobsCanonicalPath = await physicalDirectoryCanonicalPath(
      cinemaCanonicalPath,
      renderJobsDirectory,
    )
  } catch {
    result.errors.push({
      code: "render-root-unavailable",
      target: "render-jobs",
      message: "The render-jobs directory could not be safely resolved.",
    })
    return result
  }

  const entries = await readdir(renderJobsDirectory, { withFileTypes: true }).catch(() => undefined)
  if (!entries) {
    result.errors.push({
      code: "render-root-unavailable",
      target: "render-jobs",
      message: "The render-jobs directory could not be scanned.",
    })
    return result
  }

  for (const entry of entries) {
    throwIfRetentionAborted(signal)
    const match = JOB_DIRECTORY_PATTERN.exec(entry.name)
    if (!match?.[1]) continue
    const jobID = match[1]
    result.discoveredJobCount += 1
    const paths = getCinemaRenderJobStoragePaths(cinemaRoot, jobID)

    let jobDirectoryCanonicalPath: string
    try {
      if (!entry.isDirectory() || entry.isSymbolicLink()) {
        throw new UnsafeRetentionPathError("Render job directory is not physical")
      }
      jobDirectoryCanonicalPath = await physicalDirectoryCanonicalPath(
        renderJobsCanonicalPath,
        paths.jobDirectory,
      )
    } catch {
      result.skipped.push({ jobID, reason: "unsafe-job-directory" })
      continue
    }

    let job = await readCinemaRenderJob(cinemaRoot, jobID).catch(() => undefined)
    if (!job || job.id !== jobID) {
      result.errors.push({
        jobID,
        code: "job-metadata-invalid",
        target: "job-metadata",
        message: "Render job metadata could not be read or validated.",
      })
      continue
    }
    if (!isCinemaRenderTerminalStatus(job.status)) {
      result.skipped.push({ jobID, reason: "active-job" })
      continue
    }
    result.terminalJobCount += 1

    const finishedAtMs = Date.parse(job.finishedAt!)
    if (finishedAtMs > nowMs - options.retentionDurationMs) {
      result.skipped.push({ jobID, reason: "within-retention" })
      continue
    }

    // Re-read immediately before mutation. This makes an explicit cleanup safe when
    // recovery or another process has changed the persisted job since discovery.
    const refreshed = await readCinemaRenderJob(cinemaRoot, jobID).catch(() => undefined)
    if (
      !refreshed
      || refreshed.id !== jobID
      || !isCinemaRenderTerminalStatus(refreshed.status)
      || refreshed.finishedAt !== job.finishedAt
      || Date.parse(refreshed.finishedAt!) > nowMs - options.retentionDurationMs
    ) {
      result.errors.push({
        jobID,
        code: "job-metadata-changed",
        target: "job-metadata",
        message: "Render job metadata changed while retention cleanup was preparing.",
      })
      continue
    }
    job = refreshed
    result.eligibleJobCount += 1

    const candidateTargets: Array<{
      target: CinemaRenderRetentionTarget
      candidatePath: string
      expectedKind: "file" | "directory"
    }> = [
      { target: "inputs", candidatePath: paths.inputsDirectory, expectedKind: "directory" },
      {
        target: "temporary-output",
        candidatePath: paths.temporaryOutputPath,
        expectedKind: "file",
      },
    ]
    const jobEntries = await readdir(paths.jobDirectory, { withFileTypes: true }).catch(() => undefined)
    if (!jobEntries) {
      result.errors.push({
        jobID,
        code: "candidate-cleanup-failed",
        target: "input-staging",
        message: "Input staging candidates could not be safely enumerated.",
      })
    } else {
      for (const jobEntry of jobEntries) {
        if (!INPUT_STAGING_PATTERN.test(jobEntry.name)) continue
        candidateTargets.push({
          target: "input-staging",
          candidatePath: path.join(paths.jobDirectory, jobEntry.name),
          expectedKind: "directory",
        })
      }
    }

    const removedForJob: RemovedTarget = {
      reclaimedBytes: 0,
      removedFileCount: 0,
      removedDirectoryCount: 0,
    }
    const estimatedForJob: RemovedTarget = {
      reclaimedBytes: 0,
      removedFileCount: 0,
      removedDirectoryCount: 0,
    }
    const candidateTargetsForJob: CinemaRenderRetentionTarget[] = []
    const cleanedTargets: CinemaRenderRetentionTarget[] = []

    for (const candidate of candidateTargets) {
      throwIfRetentionAborted(signal)
      try {
        const inspected = await inspectCandidate({
          sandboxPath: paths.jobDirectory,
          sandboxCanonicalPath: jobDirectoryCanonicalPath,
          candidatePath: candidate.candidatePath,
          expectedKind: candidate.expectedKind,
          signal,
        })
        if (!inspected) continue
        addRemoved(estimatedForJob, inspected.summary)
        candidateTargetsForJob.push(candidate.target)
        if (dryRun) continue
        const removed = await removeValidatedNodes(jobDirectoryCanonicalPath, inspected.nodes)
        addRemoved(removedForJob, removed)
        cleanedTargets.push(candidate.target)
      } catch (error) {
        if (signal?.aborted) throw error
        if (error instanceof RetentionRemovalError) {
          addRemoved(removedForJob, error.removed)
          result.errors.push({
            jobID,
            code: "candidate-cleanup-failed",
            target: candidate.target,
            message: "A retention candidate changed or could not be completely removed.",
          })
        } else if (error instanceof UnsafeRetentionPathError) {
          result.skipped.push({
            jobID,
            reason: "unsafe-candidate",
            target: candidate.target,
          })
        } else {
          result.errors.push({
            jobID,
            code: "candidate-cleanup-failed",
            target: candidate.target,
            message: "A retention candidate could not be safely inspected or removed.",
          })
        }
      }
    }

    result.estimatedReclaimableBytes += estimatedForJob.reclaimedBytes
    if (
      estimatedForJob.removedFileCount > 0
      || estimatedForJob.removedDirectoryCount > 0
    ) {
      result.candidateJobs.push({
        jobID,
        targets: [...new Set(candidateTargetsForJob)],
        estimatedReclaimableBytes: estimatedForJob.reclaimedBytes,
        fileCount: estimatedForJob.removedFileCount,
        directoryCount: estimatedForJob.removedDirectoryCount,
      })
    }
    result.reclaimedBytes += removedForJob.reclaimedBytes
    if (
      removedForJob.removedFileCount > 0
      || removedForJob.removedDirectoryCount > 0
    ) {
      result.cleanedJobs.push({
        jobID,
        targets: [...new Set(cleanedTargets)],
        ...removedForJob,
      })
    }
  }

  return result
}
