import { afterEach, describe, expect, test } from "bun:test"
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import type { CinemaRenderJob } from "@anybox/shared/cinema-render"
import {
  clearCinemaRenderRecoveryForTest,
  recoverCinemaRenderJobs,
  recoverCinemaRenderJobsOnce,
} from "../src/cinema/render-recovery"
import {
  getCinemaRenderJobStoragePaths,
  readCinemaRenderJob,
  readCinemaRenderJobEvents,
  writeCinemaRenderJob,
} from "../src/cinema/render-storage"

const roots: string[] = []
const createdAt = "2026-07-10T10:00:00.000Z"
const recoveredAt = "2026-07-10T12:00:00.000Z"

async function temporaryCinemaRoot() {
  const root = await mkdtemp(path.join(tmpdir(), "anybox-render-recovery-"))
  roots.push(root)
  return root
}

function job(id: string, status: CinemaRenderJob["status"]): CinemaRenderJob {
  const base = {
    schemaVersion: 1 as const,
    id,
    projectID: "project-1",
    timelineID: "timeline-1",
    timelineRevision: 3,
    operationID: `operation-${id}`,
    status,
    settings: {
      format: "mp4" as const,
      videoCodec: "h264" as const,
      audioCodec: "aac" as const,
      width: 1920,
      height: 1080,
      frameRate: { numerator: 24, denominator: 1 },
      quality: { mode: "balanced" as const },
      audioBitrateKbps: 192 as const,
      range: { type: "full" as const },
      outputName: `Output ${id}`,
    },
    progress: { phase: status },
    createdAt,
    updatedAt: createdAt,
  }
  if (status === "succeeded") {
    return {
      ...base,
      status,
      progress: { phase: status, percent: 100 },
      outputAssetRef: {
        scope: { type: "project", projectID: "project-1" },
        assetID: `output-${id}`,
        contentRevision: 0,
        snapshot: { kind: "video", displayName: `${id}.mp4`, mimeType: "video/mp4" },
      },
      finishedAt: createdAt,
    }
  }
  return base as CinemaRenderJob
}

afterEach(async () => {
  clearCinemaRenderRecoveryForTest()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("Cinema render restart recovery", () => {
  test("keeps queued jobs and interrupts every in-flight phase", async () => {
    const root = await temporaryCinemaRoot()
    const statuses: CinemaRenderJob["status"][] = [
      "queued",
      "snapshotting",
      "probing",
      "rendering",
      "registering",
      "succeeded",
    ]
    for (const status of statuses) {
      const current = job(`job-${status}`, status)
      await writeCinemaRenderJob(root, current)
      if (status === "queued" || status === "rendering") {
        const paths = getCinemaRenderJobStoragePaths(root, current.id)
        await writeFile(paths.temporaryOutputPath, "partial", "utf8")
        await mkdir(path.join(paths.jobDirectory, ".inputs.test.tmp"))
        await writeFile(path.join(paths.jobDirectory, ".inputs.test.tmp", "partial.bin"), "partial", "utf8")
      }
    }

    const result = await recoverCinemaRenderJobs(root, recoveredAt)
    expect(result.queuedJobIDs).toEqual(["job-queued"])
    expect(result.interruptedJobIDs.sort()).toEqual([
      "job-probing",
      "job-registering",
      "job-rendering",
      "job-snapshotting",
    ])

    expect(await readCinemaRenderJob(root, "job-queued")).toMatchObject({
      status: "queued",
      progress: { phase: "queued" },
    })
    for (const status of ["snapshotting", "probing", "rendering", "registering"] as const) {
      const recovered = await readCinemaRenderJob(root, `job-${status}`)
      expect(recovered).toMatchObject({
        status: "interrupted",
        progress: { phase: "interrupted" },
        finishedAt: recoveredAt,
        updatedAt: recoveredAt,
      })
      expect((await readCinemaRenderJobEvents(root, `job-${status}`)).map((event) => event.type))
        .toEqual(["render-interrupted"])
    }
    expect(await readCinemaRenderJob(root, "job-succeeded")).toMatchObject({ status: "succeeded" })

    for (const id of ["job-queued", "job-rendering"]) {
      const paths = getCinemaRenderJobStoragePaths(root, id)
      expect(access(paths.temporaryOutputPath)).rejects.toThrow()
      expect(access(path.join(paths.jobDirectory, ".inputs.test.tmp"))).rejects.toThrow()
    }
  })

  test("is idempotent and does not append duplicate interruption events", async () => {
    const root = await temporaryCinemaRoot()
    await writeCinemaRenderJob(root, job("job-rendering", "rendering"))
    await recoverCinemaRenderJobs(root, recoveredAt)
    const second = await recoverCinemaRenderJobs(root, "2026-07-10T13:00:00.000Z")

    expect(second).toEqual({ queuedJobIDs: [], interruptedJobIDs: [] })
    expect(await readCinemaRenderJobEvents(root, "job-rendering")).toHaveLength(1)
    expect(await readCinemaRenderJob(root, "job-rendering")).toMatchObject({
      status: "interrupted",
      finishedAt: recoveredAt,
    })
  })

  test("coalesces concurrent startup recovery for the same Cinema project", async () => {
    const root = await temporaryCinemaRoot()
    await writeCinemaRenderJob(root, job("job-rendering", "rendering"))
    const [first, second] = await Promise.all([
      recoverCinemaRenderJobsOnce(root),
      recoverCinemaRenderJobsOnce(root),
    ])

    expect(second).toEqual(first)
    expect(first.interruptedJobIDs).toEqual(["job-rendering"])
    expect(await readCinemaRenderJobEvents(root, "job-rendering")).toHaveLength(1)
  })
})
