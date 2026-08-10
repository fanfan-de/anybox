import { afterEach, describe, expect, test } from "bun:test"
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import type { CinemaRenderJob } from "@anybox/cinema-plugin/contracts/render"
import {
  appendCinemaRenderJobEvent,
  getCinemaRenderJobStoragePaths,
  readCinemaRenderJob,
  readCinemaRenderJobEvents,
  writeCinemaRenderJob,
} from "../src/domain/render-storage"
import { createServerApp } from "../src/api/app"
import { initializeCinemaProject } from "#project/project.ts"

type Envelope<T> = {
  success: boolean
  data?: T
  error?: { code: string; message: string }
}

type RetentionResponse = {
  operationID: string
  dryRun: boolean
  estimatedReclaimableBytes: number
  reclaimedBytes: number
  candidateJobs: Array<{ jobID: string; targets: string[] }>
}

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function json<T>(response: Response) {
  return await response.json() as Envelope<T>
}

describe("Cinema render retention API", () => {
  test("previews by default and executes only with explicit confirmation", async () => {
    const app = createServerApp()
    const root = await realpath(await mkdtemp(path.join(tmpdir(), "anybox-render-retention-api-")))
    roots.push(root)
    const projectID = (await initializeCinemaProject(root)).id
    const cinemaRoot = path.join(root, ".anybox-cinema")
    await mkdir(cinemaRoot, { recursive: true })
    await writeFile(path.join(cinemaRoot, "project.json"), JSON.stringify({
      schemaVersion: 1,
      name: "Retention API",
      createdAt: "2020-01-01T00:00:00.000Z",
    }), "utf8")

    const job: CinemaRenderJob = {
      schemaVersion: 1,
      id: "retention-api-job",
      projectID,
      timelineID: "timeline-1",
      timelineRevision: 1,
      operationID: "retention-source-job",
      status: "canceled",
      settings: {
        format: "mp4",
        videoCodec: "h264",
        audioCodec: "aac",
        width: 1920,
        height: 1080,
        frameRate: { numerator: 24, denominator: 1 },
        quality: { mode: "balanced" },
        audioBitrateKbps: 192,
        range: { type: "full" },
        outputName: "Retention output",
      },
      progress: { phase: "canceled" },
      createdAt: "2020-01-01T00:00:00.000Z",
      finishedAt: "2020-01-01T00:01:00.000Z",
      updatedAt: "2020-01-01T00:01:00.000Z",
    }
    await writeCinemaRenderJob(cinemaRoot, job)
    await appendCinemaRenderJobEvent(cinemaRoot, {
      schemaVersion: 1,
      id: "retention-api-event",
      jobID: job.id,
      type: "render-canceled",
      createdAt: job.finishedAt!,
    })
    const paths = getCinemaRenderJobStoragePaths(cinemaRoot, job.id)
    await writeFile(paths.timelineSnapshotPath, "timeline snapshot", "utf8")
    await mkdir(paths.inputsDirectory)
    await writeFile(path.join(paths.inputsDirectory, "media.bin"), "media", "utf8")
    await writeFile(paths.temporaryOutputPath, "temp", "utf8")
    const preservedOutput = path.join(paths.jobDirectory, "output.final.mp4")
    await writeFile(preservedOutput, "registered output", "utf8")

    const endpoint = `http://localhost/api/cinema/projects/${encodeURIComponent(projectID)}/render-retention/cleanup`
    const previewResponse = await app.request(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ operationID: "retention-preview", retentionDurationMs: 1 }),
    })
    expect(previewResponse.status).toBe(200)
    const preview = (await json<RetentionResponse>(previewResponse)).data!
    expect(preview).toMatchObject({
      operationID: "retention-preview",
      dryRun: true,
      estimatedReclaimableBytes: 9,
      reclaimedBytes: 0,
      candidateJobs: [{ jobID: job.id, targets: ["inputs", "temporary-output"] }],
    })
    expect(JSON.stringify(preview)).not.toContain(root)
    await expect(access(paths.inputsDirectory)).resolves.toBeNull()
    await expect(access(paths.temporaryOutputPath)).resolves.toBeNull()

    const unconfirmed = await app.request(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ operationID: "retention-unconfirmed", retentionDurationMs: 1, dryRun: false }),
    })
    expect(unconfirmed.status).toBe(400)

    const executeBody = {
      operationID: "retention-execute",
      retentionDurationMs: 1,
      dryRun: false,
      confirm: "DELETE_REBUILDABLE_RENDER_FILES",
    }
    const crossOriginExecute = await app.request(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://untrusted.example",
        "sec-fetch-site": "cross-site",
      },
      body: JSON.stringify({ ...executeBody, operationID: "retention-cross-origin" }),
    })
    expect(crossOriginExecute.status).toBe(403)
    expect((await json<never>(crossOriginExecute)).error?.code)
      .toBe("CINEMA_RENDER_RETENTION_EXECUTION_FORBIDDEN")
    await expect(access(paths.inputsDirectory)).resolves.toBeNull()

    const executeResponse = await app.request(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(executeBody),
    })
    expect(executeResponse.status).toBe(200)
    expect((await json<RetentionResponse>(executeResponse)).data).toMatchObject({
      operationID: "retention-execute",
      dryRun: false,
      estimatedReclaimableBytes: 9,
      reclaimedBytes: 9,
    })
    await expect(access(paths.inputsDirectory)).rejects.toThrow()
    await expect(access(paths.temporaryOutputPath)).rejects.toThrow()
    expect(await readCinemaRenderJob(cinemaRoot, job.id)).toEqual(job)
    expect(await readCinemaRenderJobEvents(cinemaRoot, job.id)).toHaveLength(1)
    expect(await readFile(paths.timelineSnapshotPath, "utf8")).toBe("timeline snapshot")
    expect(await readFile(preservedOutput, "utf8")).toBe("registered output")

    const replay = await app.request(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(executeBody),
    })
    expect(replay.status).toBe(409)
    expect((await json<never>(replay)).error?.code).toBe("CINEMA_RENDER_RETENTION_OPERATION_REPLAYED")
  })
})
