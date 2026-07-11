import { afterEach, describe, expect, test } from "bun:test"
import "./sqlite.cleanup.ts"
import { access, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import type { CinemaAssetRecord, CinemaAssetRef } from "@anybox/shared/cinema"
import type {
  CinemaRenderJob,
  CinemaRenderJobEventsResult,
  CinemaRenderJobListResult,
  CinemaRenderSettings,
} from "@anybox/shared/cinema-render"
import type { CinemaTimelineDocument } from "@anybox/shared/cinema-timeline"
import {
  getCinemaAssetLibraryState,
  initializeCinemaAssetLibrary,
  registerCinemaGeneratedAsset,
  setCinemaAssetLibraryCatalogWriteFailureForTest,
} from "../src/cinema/asset-library"
import { findRegisteredCinemaRenderOutput } from "../src/cinema/render-assets"
import { resolveMediaToolPaths, runMediaTool } from "../src/cinema/media-runtime"
import { holdCinemaRenderPhaseUntilCanceledForTesting } from "../src/cinema/render-queue"
import { clearCinemaRenderRecoveryForTest } from "../src/cinema/render-recovery"
import {
  setCinemaRenderSnapshotHooksForTesting,
  snapshotCinemaRenderInputs,
  writeCinemaRenderTimelineSnapshot,
} from "../src/cinema/render-snapshot"
import {
  getCinemaRenderJobStoragePaths,
  readCinemaRenderJob,
  writeCinemaRenderJob,
} from "../src/cinema/render-storage"
import { writeCinemaTimelineDocument } from "../src/cinema/timeline-storage"
import { createServerApp } from "../src/server/server"

interface JsonEnvelope<T> {
  success: boolean
  data?: T
  error?: { code: string; message: string; data?: unknown }
}

const roots: string[] = []
const now = "2026-07-10T12:00:00.000Z"

async function json<T>(response: Response) {
  return await response.json() as JsonEnvelope<T>
}

function assetRef(projectID: string, asset: CinemaAssetRecord): CinemaAssetRef {
  return {
    scope: { type: "project", projectID },
    assetID: asset.id,
    contentRevision: asset.contentRevision,
    snapshot: {
      kind: asset.kind,
      displayName: asset.displayName,
      mimeType: asset.mimeType,
      ...(asset.width ? { width: asset.width } : {}),
      ...(asset.height ? { height: asset.height } : {}),
      ...(asset.durationSeconds !== undefined ? { durationSeconds: asset.durationSeconds } : {}),
    },
  }
}

async function waitForTerminal(app: ReturnType<typeof createServerApp>, url: string, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  while (true) {
    const response = await app.request(url)
    expect(response.status).toBe(200)
    const current = (await json<CinemaRenderJob>(response)).data!
    if (["succeeded", "failed", "canceled", "interrupted"].includes(current.status)) return current
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for render job; last status ${current.status}`)
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

async function waitForStatus(
  app: ReturnType<typeof createServerApp>,
  url: string,
  status: CinemaRenderJob["status"],
  timeoutMs = 15_000,
) {
  const deadline = Date.now() + timeoutMs
  while (true) {
    const response = await app.request(url)
    expect(response.status).toBe(200)
    const current = (await json<CinemaRenderJob>(response)).data!
    if (current.status === status) return current
    if (["succeeded", "failed", "canceled", "interrupted"].includes(current.status)) {
      throw new Error(`Render job reached '${current.status}' before '${status}'.`)
    }
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for render job status '${status}'.`)
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

async function createFixture() {
  const tools = await resolveMediaToolPaths()
  const app = createServerApp()
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "anybox-render-job-api-")))
  roots.push(root)
  const projectResponse = await app.request("http://localhost/api/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ directory: root }),
  })
  const projectID = (await json<{ id: string }>(projectResponse)).data!.id
  const cinemaRoot = path.join(root, ".anybox-cinema")
  await mkdir(cinemaRoot, { recursive: true })
  await writeFile(path.join(cinemaRoot, "project.json"), JSON.stringify({
    schemaVersion: 1,
    name: "Render Job API",
    createdAt: now,
  }), "utf8")
  await initializeCinemaAssetLibrary({ type: "project", projectID })

  const generated = path.join(root, "generated-fixtures")
  await mkdir(generated)
  const videoPath = path.join(generated, "source video.mp4")
  const audioPath = path.join(generated, "source audio.wav")
  const imagePath = path.join(generated, "source image.png")
  await runMediaTool(tools.ffmpeg, [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "color=c=red:s=160x90:r=24:d=3",
    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=3",
    "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", videoPath,
  ])
  await runMediaTool(tools.ffmpeg, [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "sine=frequency=220:sample_rate=48000:duration=3",
    "-c:a", "pcm_s16le", audioPath,
  ])
  await runMediaTool(tools.ffmpeg, [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "color=c=green:s=64x64:d=0.04",
    "-frames:v", "1", "-update", "1", imagePath,
  ])
  let revision = 0
  const video = await registerCinemaGeneratedAsset(projectID, {
    operationID: "fixture-video",
    baseRevision: revision++,
    sourcePath: videoPath,
    kind: "video",
  })
  const audio = await registerCinemaGeneratedAsset(projectID, {
    operationID: "fixture-audio",
    baseRevision: revision++,
    sourcePath: audioPath,
    kind: "audio",
  })
  const image = await registerCinemaGeneratedAsset(projectID, {
    operationID: "fixture-image",
    baseRevision: revision++,
    sourcePath: imagePath,
    kind: "image",
  })
  const videoRef = assetRef(projectID, video.asset)
  const audioRef = assetRef(projectID, audio.asset)
  const imageRef = assetRef(projectID, image.asset)
  const timeline: CinemaTimelineDocument = {
    schemaVersion: 2,
    id: "delivery-timeline",
    projectID,
    title: "Delivery timeline",
    revision: 3,
    createdAt: now,
    updatedAt: now,
    settings: { width: 160, height: 90, frameRate: { numerator: 24, denominator: 1 }, sampleRate: 48_000, backgroundColor: "#101010" },
    tracks: [
      { id: "v1", kind: "video", title: "V1", order: 0, locked: false, muted: false, hidden: false },
      { id: "a1", kind: "audio", title: "A1", order: 1, locked: false, muted: false, hidden: false },
      { id: "o1", kind: "overlay", title: "O1", order: 2, locked: false, muted: false, hidden: false },
    ],
    clips: [
      { id: "video-1", trackID: "v1", kind: "video", title: "Video", timelineStartUs: 0, durationUs: 2_500_000, playbackRate: 1, volume: 0.7, opacity: 1, fit: "contain", assetRef: videoRef, sourceInUs: 250_000, sourceDurationUs: 2_500_000, createdAt: now, updatedAt: now },
      { id: "audio-1", trackID: "a1", kind: "audio", title: "Audio", timelineStartUs: 0, durationUs: 2_500_000, playbackRate: 1, volume: 0.2, opacity: 1, assetRef: audioRef, sourceInUs: 0, sourceDurationUs: 2_500_000, fadeInUs: 100_000, fadeOutUs: 200_000, createdAt: now, updatedAt: now },
      { id: "image-1", trackID: "o1", kind: "image", title: "Image", timelineStartUs: 500_000, durationUs: 1_000_000, playbackRate: 1, volume: 1, opacity: 0.5, fit: "contain", assetRef: imageRef, sourceInUs: 0, sourceDurationUs: 1_000_000, createdAt: now, updatedAt: now },
    ],
    markers: [],
  }
  await writeCinemaTimelineDocument(cinemaRoot, timeline)
  const settings: CinemaRenderSettings = {
    format: "mp4",
    videoCodec: "h264",
    audioCodec: "aac",
    width: 160,
    height: 90,
    frameRate: { numerator: 24, denominator: 1 },
    quality: { mode: "balanced" },
    audioBitrateKbps: 128,
    range: { type: "full" },
    outputName: "API final export",
  }
  return { app, root, cinemaRoot, projectID, timeline, settings }
}

afterEach(async () => {
  clearCinemaRenderRecoveryForTest()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("Cinema render Job API", () => {
  test("maps an injected input snapshot EACCES to snapshot-failed and leaves no partial output", async () => {
    const { app, cinemaRoot, projectID, timeline, settings } = await createFixture()
    const jobsURL = `http://localhost/api/cinema/projects/${encodeURIComponent(projectID)}/timelines/${timeline.id}/render-jobs`
    const restore = setCinemaRenderSnapshotHooksForTesting({
      beforeSnapshotInputs: async () => {
        throw Object.assign(new Error("Synthetic render snapshot permission failure"), { code: "EACCES" })
      },
    })
    try {
      const response = await app.request(jobsURL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          operationID: "snapshot-eacces-operation",
          expectedTimelineRevision: timeline.revision,
          settings: { ...settings, outputName: "Snapshot permission failure" },
        }),
      })
      expect(response.status).toBe(202)
      const created = (await json<CinemaRenderJob>(response)).data!
      const jobURL = `http://localhost/api/cinema/projects/${encodeURIComponent(projectID)}/render-jobs/${created.id}`
      const terminal = await waitForTerminal(app, jobURL)
      expect(terminal).toMatchObject({
        status: "failed",
        error: {
          code: "snapshot-failed",
          message: "Render inputs could not be snapshotted.",
          retryable: true,
        },
      })
      expect("outputAssetRef" in terminal).toBe(false)
      const paths = getCinemaRenderJobStoragePaths(cinemaRoot, created.id)
      expect(access(paths.inputsDirectory)).rejects.toThrow()
      expect(access(paths.temporaryOutputPath)).rejects.toThrow()
      expect(await findRegisteredCinemaRenderOutput(terminal)).toBeUndefined()
    } finally {
      restore()
    }
  }, 30_000)

  test("rolls back a catalog commit failure to output-registration-failed with no fake asset", async () => {
    const { app, cinemaRoot, projectID, timeline, settings } = await createFixture()
    const jobsURL = `http://localhost/api/cinema/projects/${encodeURIComponent(projectID)}/timelines/${timeline.id}/render-jobs`
    const initialAssetCount = (await getCinemaAssetLibraryState({ type: "project", projectID })).counts.assets
    const restore = setCinemaAssetLibraryCatalogWriteFailureForTest(true)
    try {
      const response = await app.request(jobsURL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          operationID: "catalog-commit-failure-operation",
          expectedTimelineRevision: timeline.revision,
          settings: { ...settings, outputName: "Catalog commit failure" },
        }),
      })
      expect(response.status).toBe(202)
      const created = (await json<CinemaRenderJob>(response)).data!
      const jobURL = `http://localhost/api/cinema/projects/${encodeURIComponent(projectID)}/render-jobs/${created.id}`
      const terminal = await waitForTerminal(app, jobURL)
      expect(terminal).toMatchObject({
        status: "failed",
        error: {
          code: "output-registration-failed",
          message: "Rendered output could not be registered.",
          retryable: true,
        },
      })
      expect("outputAssetRef" in terminal).toBe(false)
      expect(await findRegisteredCinemaRenderOutput(terminal)).toBeUndefined()
      const library = await getCinemaAssetLibraryState({ type: "project", projectID })
      expect(library.counts.assets).toBe(initialAssetCount)
      const paths = getCinemaRenderJobStoragePaths(cinemaRoot, created.id)
      expect(access(paths.temporaryOutputPath)).rejects.toThrow()
    } finally {
      restore()
    }
  }, 30_000)

  test("holds the real rendering phase until active cancellation without production sleeps", async () => {
    const { app, projectID, timeline, settings } = await createFixture()
    const jobsURL = `http://localhost/api/cinema/projects/${encodeURIComponent(projectID)}/timelines/${timeline.id}/render-jobs`
    const restore = holdCinemaRenderPhaseUntilCanceledForTesting("rendering")
    try {
      const response = await app.request(jobsURL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          operationID: "active-cancel-operation",
          expectedTimelineRevision: timeline.revision,
          settings: { ...settings, outputName: "Active cancellation" },
        }),
      })
      expect(response.status).toBe(202)
      const created = (await json<CinemaRenderJob>(response)).data!
      const jobURL = `http://localhost/api/cinema/projects/${encodeURIComponent(projectID)}/render-jobs/${created.id}`
      expect(await waitForStatus(app, jobURL, "rendering")).toMatchObject({
        status: "rendering",
        progress: { phase: "rendering" },
      })

      const cancelResponse = await app.request(`${jobURL}/cancel`, { method: "POST" })
      expect(cancelResponse.status).toBe(200)
      const canceled = (await json<CinemaRenderJob>(cancelResponse)).data!
      expect(canceled).toMatchObject({
        status: "canceled",
        progress: { phase: "canceled" },
      })
      expect("outputAssetRef" in canceled).toBe(false)
    } finally {
      restore()
    }
  }, 30_000)

  test("creates idempotently, queues, renders, registers, lists, and streams the output", async () => {
    const { app, projectID, timeline, settings } = await createFixture()
    const timelineJobsURL = `http://localhost/api/cinema/projects/${encodeURIComponent(projectID)}/timelines/${timeline.id}/render-jobs`
    const body = {
      operationID: "render-api-operation",
      expectedTimelineRevision: timeline.revision,
      settings,
    }
    const [createResponse, duplicateResponse] = await Promise.all([
      app.request(timelineJobsURL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      app.request(timelineJobsURL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    ])
    expect(createResponse.status).toBe(202)
    const created = (await json<CinemaRenderJob>(createResponse)).data!
    expect(created).toMatchObject({ status: "queued", timelineRevision: 3, operationID: body.operationID })
    expect(created.executionRuntime).toMatchObject({
      runtimeID: expect.any(String),
      ffmpegVersion: expect.any(String),
      platform: expect.any(String),
      videoEncoder: expect.any(String),
      audioEncoder: "aac",
    })
    expect((await json<CinemaRenderJob>(duplicateResponse)).data?.id).toBe(created.id)

    const conflictingResponse = await app.request(timelineJobsURL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...body,
        settings: { ...body.settings, outputName: "Different payload" },
      }),
    })
    expect(conflictingResponse.status).toBe(409)
    expect((await json<never>(conflictingResponse)).error?.code).toBe("CINEMA_RENDER_OPERATION_CONFLICT")

    const jobURL = `http://localhost/api/cinema/projects/${encodeURIComponent(projectID)}/render-jobs/${created.id}`
    const terminal = await waitForTerminal(app, jobURL)
    expect(terminal.status, terminal.error?.message).toBe("succeeded")
    expect(terminal.outputAssetRef?.snapshot).toMatchObject({ kind: "video", mimeType: "video/mp4" })
    expect(terminal.outputAssetRef?.snapshot.durationSeconds).toBeCloseTo(2.5, 1)

    const list = (await json<CinemaRenderJobListResult>(await app.request(timelineJobsURL))).data!
    expect(list.items.map((job) => job.id)).toContain(created.id)
    const events = (await json<CinemaRenderJobEventsResult>(await app.request(`${jobURL}/events`))).data!
    expect(events.items.map((event) => event.type)).toEqual(expect.arrayContaining([
      "job-created",
      "runtime-bound",
      "snapshot-started",
      "snapshot-completed",
      "probe-completed",
      "render-started",
      "render-progress",
      "registration-started",
      "render-succeeded",
    ]))
    for (const eventType of ["job-created", "runtime-bound", "render-started"] as const) {
      expect(events.items.find((event) => event.type === eventType)?.executionRuntime)
        .toEqual(created.executionRuntime)
    }
    expect(JSON.stringify(events)).not.toContain("render-jobs\\")

    const assetID = terminal.outputAssetRef!.assetID
    const contentResponse = await app.request(
      `http://localhost/api/cinema/projects/${encodeURIComponent(projectID)}/library/assets/${assetID}/content`,
      { headers: { range: "bytes=0-31" } },
    )
    expect(contentResponse.status).toBe(206)
    expect(contentResponse.headers.get("content-type")).toBe("video/mp4")
    expect((await contentResponse.arrayBuffer()).byteLength).toBe(32)
  }, 30_000)

  test("returns revision/preflight conflicts and cancels a second queued job without an output asset", async () => {
    const { app, projectID, timeline, settings } = await createFixture()
    const timelineJobsURL = `http://localhost/api/cinema/projects/${encodeURIComponent(projectID)}/timelines/${timeline.id}/render-jobs`
    const conflict = await app.request(timelineJobsURL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ operationID: "revision-conflict", expectedTimelineRevision: 99, settings }),
    })
    expect(conflict.status).toBe(409)
    expect((await json<unknown>(conflict)).error).toMatchObject({
      code: "CINEMA_TIMELINE_REVISION_CONFLICT",
      data: { latestRevision: 3 },
    })

    const firstResponse = await app.request(timelineJobsURL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ operationID: "queue-first", expectedTimelineRevision: 3, settings }),
    })
    const secondResponse = await app.request(timelineJobsURL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ operationID: "queue-second", expectedTimelineRevision: 3, settings: { ...settings, outputName: "Canceled export" } }),
    })
    const first = (await json<CinemaRenderJob>(firstResponse)).data!
    const second = (await json<CinemaRenderJob>(secondResponse)).data!
    const secondURL = `http://localhost/api/cinema/projects/${encodeURIComponent(projectID)}/render-jobs/${second.id}`
    const cancel = await app.request(`${secondURL}/cancel`, { method: "POST" })
    expect(cancel.status).toBe(200)
    const canceled = (await json<CinemaRenderJob>(cancel)).data!
    expect(canceled.status).toBe("canceled")
    expect("outputAssetRef" in canceled).toBe(false)
    expect((await json<CinemaRenderJob>(await app.request(`${secondURL}/cancel`, { method: "POST" }))).data?.status)
      .toBe("canceled")
    const firstURL = `http://localhost/api/cinema/projects/${encodeURIComponent(projectID)}/render-jobs/${first.id}`
    expect((await waitForTerminal(app, firstURL)).status).toBe("succeeded")
  }, 30_000)

  test("retries from the original immutable snapshot after the live Timeline changes", async () => {
    const { app, cinemaRoot, projectID, timeline, settings } = await createFixture()
    const failed: CinemaRenderJob = {
      schemaVersion: 1,
      id: "failed-original-job",
      projectID,
      timelineID: timeline.id,
      timelineRevision: timeline.revision,
      operationID: "failed-original-operation",
      status: "failed",
      settings,
      progress: { phase: "failed", message: "Synthetic encoder failure" },
      error: { code: "render-failed", message: "Synthetic encoder failure", retryable: true },
      createdAt: now,
      startedAt: now,
      finishedAt: now,
      updatedAt: now,
    }
    await writeCinemaRenderJob(cinemaRoot, failed)
    await writeCinemaRenderTimelineSnapshot(cinemaRoot, failed.id, timeline)
    await snapshotCinemaRenderInputs(cinemaRoot, failed.id)
    await writeCinemaTimelineDocument(cinemaRoot, {
      ...timeline,
      title: "Changed after the failed job",
      revision: 4,
      updatedAt: "2026-07-10T13:00:00.000Z",
    })

    const retryURL = `http://localhost/api/cinema/projects/${encodeURIComponent(projectID)}/render-jobs/${failed.id}/retry`
    const wrongKind = await app.request(retryURL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ operationID: failed.operationID }),
    })
    expect(wrongKind.status).toBe(409)
    expect((await json<never>(wrongKind)).error?.code).toBe("CINEMA_RENDER_OPERATION_CONFLICT")

    const [retryResponse, duplicate] = await Promise.all([
      app.request(retryURL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ operationID: "retry-original-snapshot" }),
      }),
      app.request(retryURL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ operationID: "retry-original-snapshot" }),
      }),
    ])
    expect(retryResponse.status).toBe(202)
    const retry = (await json<CinemaRenderJob>(retryResponse)).data!
    expect(retry).toMatchObject({
      status: "queued",
      retryOfJobID: failed.id,
      timelineRevision: 3,
      executionRuntime: {
        runtimeID: expect.any(String),
        ffmpegVersion: expect.any(String),
        videoEncoder: expect.any(String),
        audioEncoder: "aac",
      },
    })
    expect((await json<CinemaRenderJob>(duplicate)).data?.id).toBe(retry.id)
    expect((await readCinemaRenderJob(cinemaRoot, failed.id))?.executionRuntime).toBeUndefined()

    const otherFailed = {
      ...failed,
      id: "failed-other-job",
      operationID: "failed-other-operation",
    }
    await writeCinemaRenderJob(cinemaRoot, otherFailed)
    await writeCinemaRenderTimelineSnapshot(cinemaRoot, otherFailed.id, timeline)
    const conflictingRetry = await app.request(
      `http://localhost/api/cinema/projects/${encodeURIComponent(projectID)}/render-jobs/${otherFailed.id}/retry`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ operationID: "retry-original-snapshot" }),
      },
    )
    expect(conflictingRetry.status).toBe(409)
    expect((await json<never>(conflictingRetry)).error?.code).toBe("CINEMA_RENDER_OPERATION_CONFLICT")

    const retryJobURL = `http://localhost/api/cinema/projects/${encodeURIComponent(projectID)}/render-jobs/${retry.id}`
    const terminal = await waitForTerminal(app, retryJobURL)
    expect(terminal.status, terminal.error?.message).toBe("succeeded")
    expect(terminal.timelineRevision).toBe(3)
    expect(terminal.retryOfJobID).toBe(failed.id)
  }, 30_000)
})
