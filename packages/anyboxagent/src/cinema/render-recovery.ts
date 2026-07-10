import { randomUUID } from "node:crypto"
import { readdir, rm } from "node:fs/promises"
import path from "node:path"

import type { CinemaRenderJob } from "@anybox/shared/cinema-render"
import { findRegisteredCinemaRenderOutput } from "#cinema/render-assets.ts"

import {
  appendCinemaRenderJobEvent,
  getCinemaRenderJobStoragePaths,
  listCinemaRenderJobs,
  writeCinemaRenderJob,
} from "#cinema/render-storage.ts"

type InterruptibleStatus = "snapshotting" | "probing" | "rendering" | "registering"

const INTERRUPTIBLE_STATUSES: ReadonlySet<InterruptibleStatus> = new Set([
  "snapshotting",
  "probing",
  "rendering",
  "registering",
])

function isInterruptibleStatus(status: CinemaRenderJob["status"]): status is InterruptibleStatus {
  return INTERRUPTIBLE_STATUSES.has(status as InterruptibleStatus)
}

const recoveryByCinemaRoot = new Map<string, Promise<{
  queuedJobIDs: string[]
  interruptedJobIDs: string[]
}>>()

async function cleanInterruptedJobFiles(cinemaRoot: string, jobID: string) {
  const paths = getCinemaRenderJobStoragePaths(cinemaRoot, jobID)
  await rm(paths.temporaryOutputPath, { force: true }).catch(() => undefined)
  const entries = await readdir(paths.jobDirectory, { withFileTypes: true }).catch(() => [])
  await Promise.all(entries
    .filter((entry) => entry.isDirectory() && /^\.inputs\.[A-Za-z0-9-]+\.tmp$/.test(entry.name))
    .map((entry) => rm(path.join(paths.jobDirectory, entry.name), { recursive: true, force: true })))
}

export async function recoverCinemaRenderJobs(
  cinemaRoot: string,
  now = new Date().toISOString(),
) {
  const jobs = await listCinemaRenderJobs(cinemaRoot)
  const queuedJobIDs: string[] = []
  const interruptedJobIDs: string[] = []

  for (const job of jobs) {
    if (job.status === "queued") {
      queuedJobIDs.push(job.id)
      await cleanInterruptedJobFiles(cinemaRoot, job.id)
      continue
    }
    if (!isInterruptibleStatus(job.status)) continue
    const interruptedPhase = job.status

    if (job.status === "registering") {
      const outputAssetRef = await findRegisteredCinemaRenderOutput(job).catch(() => undefined)
      if (outputAssetRef) {
        const succeeded: CinemaRenderJob = {
          ...job,
          status: "succeeded",
          progress: { phase: "succeeded", percent: 100, message: "Render completed" },
          outputAssetRef,
          finishedAt: now,
          updatedAt: now,
        }
        await writeCinemaRenderJob(cinemaRoot, succeeded)
        await appendCinemaRenderJobEvent(cinemaRoot, {
          schemaVersion: 1,
          id: `recovery-${randomUUID()}`,
          jobID: job.id,
          type: "render-succeeded",
          createdAt: now,
          outputAssetRef,
          message: "Recovered an output that was registered before the Agent stopped.",
        })
        continue
      }
    }

    const interruptionError: NonNullable<CinemaRenderJob["error"]> = {
      code: "render-interrupted",
      message: "The Agent stopped before the render job reached a terminal state.",
      retryable: true,
      diagnosticSummary: {
        phase: interruptedPhase,
        ...(job.executionRuntime ? { runtime: job.executionRuntime } : {}),
      },
    }
    const interrupted: CinemaRenderJob = {
      ...job,
      status: "interrupted",
      progress: {
        phase: "interrupted",
        message: "The Agent stopped while this render job was running.",
      },
      error: interruptionError,
      finishedAt: now,
      updatedAt: now,
    }
    await cleanInterruptedJobFiles(cinemaRoot, job.id)
    await writeCinemaRenderJob(cinemaRoot, interrupted)
    await appendCinemaRenderJobEvent(cinemaRoot, {
      schemaVersion: 1,
      id: `recovery-${randomUUID()}`,
      jobID: job.id,
      type: "render-interrupted",
      createdAt: now,
      error: interruptionError,
      message: "The Agent stopped before the render job reached a terminal state.",
    })
    interruptedJobIDs.push(job.id)
  }

  return { queuedJobIDs, interruptedJobIDs }
}

export function recoverCinemaRenderJobsOnce(cinemaRoot: string) {
  const existing = recoveryByCinemaRoot.get(cinemaRoot)
  if (existing) return existing
  const recovery = recoverCinemaRenderJobs(cinemaRoot).catch((error) => {
    recoveryByCinemaRoot.delete(cinemaRoot)
    throw error
  })
  recoveryByCinemaRoot.set(cinemaRoot, recovery)
  return recovery
}

export function clearCinemaRenderRecoveryForTest(cinemaRoot?: string) {
  if (cinemaRoot) recoveryByCinemaRoot.delete(cinemaRoot)
  else recoveryByCinemaRoot.clear()
}
