import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import type { CinemaRenderJob } from "@anybox/cinema-plugin/contracts/render"
import {
  CinemaRenderQueue,
  createCinemaRenderProgressWriter,
  executeCinemaRenderJob,
  isCinemaRenderAgentShutdownSignal,
  type CinemaRenderQueueEntry,
} from "../src/domain/render-queue"
import {
  readCinemaRenderJob,
  readCinemaRenderQueueState,
  writeCinemaRenderJob,
  writeCinemaRenderQueueState,
} from "../src/domain/render-storage"

const roots: string[] = []
const now = "2026-07-10T12:00:00.000Z"

async function temporaryCinemaRoot() {
  const root = await mkdtemp(path.join(tmpdir(), "anybox-render-queue-"))
  roots.push(root)
  return root
}

function job(id: string): CinemaRenderJob {
  return {
    schemaVersion: 1,
    id,
    projectID: "project-1",
    timelineID: "timeline-1",
    timelineRevision: 1,
    operationID: `operation-${id}`,
    status: "queued",
    settings: {
      format: "mp4",
      videoCodec: "h264",
      audioCodec: "aac",
      width: 320,
      height: 180,
      frameRate: { numerator: 24, denominator: 1 },
      quality: { mode: "balanced" },
      audioBitrateKbps: 128,
      range: { type: "full" },
      outputName: `Output ${id}`,
    },
    progress: { phase: "queued" },
    createdAt: now,
    updatedAt: now,
  }
}

async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs
  while (!(await predicate())) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for queue state")
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("Cinema persistent render queue", () => {
  test("fails instead of rebinding a queued job whose runtime identity drifted", async () => {
    const root = await temporaryCinemaRoot()
    const locked: CinemaRenderJob = {
      ...job("job-runtime-drift"),
      executionRuntime: {
        runtimeID: "runtime-that-is-no-longer-active",
        ffmpegVersion: "0.0.0",
        platform: "win32",
        videoEncoder: "h264_mf",
        audioEncoder: "aac",
      },
    }
    await writeCinemaRenderJob(root, locked)

    await executeCinemaRenderJob(
      { cinemaRoot: root, projectID: locked.projectID, jobID: locked.id },
      new AbortController().signal,
    )

    expect(await readCinemaRenderJob(root, locked.id)).toMatchObject({
      status: "failed",
      executionRuntime: locked.executionRuntime,
      error: { code: "render-runtime-unavailable", retryable: true },
    })
  })

  test("drains progress before terminal persistence and rejects late progress", async () => {
    const root = await temporaryCinemaRoot()
    const running: CinemaRenderJob = {
      ...job("job-progress-race"),
      status: "rendering",
      progress: { phase: "rendering", percent: 0 },
      startedAt: now,
    }
    await writeCinemaRenderJob(root, running)
    const persistenceStarted = deferred()
    const releasePersistence = deferred()
    const order: string[] = []
    const controller = new AbortController()
    const writer = createCinemaRenderProgressWriter({
      cinemaRoot: root,
      initialJob: running,
      signal: controller.signal,
      persist: async (snapshot) => {
        order.push(`progress-${snapshot.progress.percent}-start`)
        persistenceStarted.resolve()
        await releasePersistence.promise
        await writeCinemaRenderJob(root, snapshot)
        order.push(`progress-${snapshot.progress.percent}-end`)
      },
    })

    expect(writer.accept({ renderedUs: 1_000_000, percent: 10 })).toBe(true)
    await persistenceStarted.promise
    controller.abort()
    expect(writer.accept({ renderedUs: 9_000_000, percent: 90 })).toBe(false)
    const closing = writer.close()
    expect(writer.accept({ renderedUs: 10_000_000, percent: 100 })).toBe(false)
    expect(order).toEqual(["progress-10-start"])

    releasePersistence.resolve()
    const drained = await closing
    order.push("terminal-start")
    const finishedAt = "2026-07-10T12:00:01.000Z"
    await writeCinemaRenderJob(root, {
      ...drained,
      status: "canceled",
      progress: { phase: "canceled", message: "Render was canceled." },
      finishedAt,
      updatedAt: finishedAt,
    })
    order.push("terminal-end")
    expect(writer.accept({ renderedUs: 10_000_000, percent: 100 })).toBe(false)

    expect(order).toEqual([
      "progress-10-start",
      "progress-10-end",
      "terminal-start",
      "terminal-end",
    ])
    expect(await readCinemaRenderJob(root, running.id)).toMatchObject({
      status: "canceled",
      progress: { phase: "canceled" },
    })
  })

  test("runs only one job globally and persists pending ids per project", async () => {
    const firstRoot = await temporaryCinemaRoot()
    const secondRoot = await temporaryCinemaRoot()
    const gates = new Map<string, ReturnType<typeof deferred>>()
    const starts: string[] = []
    let running = 0
    let maximumRunning = 0
    const queue = new CinemaRenderQueue(async (entry) => {
      starts.push(entry.jobID)
      running += 1
      maximumRunning = Math.max(maximumRunning, running)
      const gate = deferred()
      gates.set(entry.jobID, gate)
      await gate.promise
      running -= 1
    })
    const first: CinemaRenderQueueEntry = { cinemaRoot: firstRoot, projectID: "project-1", jobID: "job-1" }
    const second: CinemaRenderQueueEntry = { cinemaRoot: secondRoot, projectID: "project-2", jobID: "job-2" }
    await Promise.all([queue.enqueue(first), queue.enqueue(second)])
    await waitFor(() => starts.length === 1)

    expect(maximumRunning).toBe(1)
    expect(queue.snapshot()).toEqual({ activeJobID: "job-1", pendingJobIDs: ["job-2"] })
    expect((await readCinemaRenderQueueState(secondRoot)).pendingJobIDs).toEqual(["job-2"])

    gates.get("job-1")!.resolve()
    await waitFor(() => starts.length === 2)
    expect(maximumRunning).toBe(1)
    expect(starts).toEqual(["job-1", "job-2"])
    gates.get("job-2")!.resolve()
    await waitFor(() => queue.snapshot().activeJobID === undefined)
  })

  test("cancels a queued job atomically and keeps terminal cancel idempotent", async () => {
    const root = await temporaryCinemaRoot()
    const gate = deferred()
    const queue = new CinemaRenderQueue(async () => gate.promise)
    await writeCinemaRenderJob(root, job("job-active"))
    await writeCinemaRenderJob(root, job("job-pending"))
    await queue.enqueue({ cinemaRoot: root, projectID: "project-1", jobID: "job-active" })
    await queue.enqueue({ cinemaRoot: root, projectID: "project-1", jobID: "job-pending" })
    await waitFor(() => queue.snapshot().activeJobID === "job-active")

    const canceled = await queue.cancel(root, "job-pending")
    expect(canceled).toMatchObject({ status: "canceled", progress: { phase: "canceled" } })
    expect((await readCinemaRenderQueueState(root)).pendingJobIDs).toEqual([])
    expect(await queue.cancel(root, "job-pending")).toMatchObject({ status: "canceled" })
    gate.resolve()
  })

  test("aborts the active executor and then advances to the next job", async () => {
    const root = await temporaryCinemaRoot()
    const starts: string[] = []
    const aborted: string[] = []
    const nextGate = deferred()
    const queue = new CinemaRenderQueue(async (entry, signal) => {
      starts.push(entry.jobID)
      if (entry.jobID === "job-active") {
        await new Promise<void>((resolve) => signal.addEventListener("abort", () => {
          aborted.push(entry.jobID)
          resolve()
        }, { once: true }))
      } else {
        await nextGate.promise
      }
    })
    await writeCinemaRenderJob(root, job("job-active"))
    await writeCinemaRenderJob(root, job("job-next"))
    await queue.enqueue({ cinemaRoot: root, projectID: "project-1", jobID: "job-active" })
    await queue.enqueue({ cinemaRoot: root, projectID: "project-1", jobID: "job-next" })
    await waitFor(() => starts.length === 1)
    await queue.cancel(root, "job-active")
    await waitFor(() => starts.length === 2)

    expect(aborted).toEqual(["job-active"])
    expect(starts).toEqual(["job-active", "job-next"])
    nextGate.resolve()
  })

  test("stops the active executor on Agent shutdown without starting pending work", async () => {
    const root = await temporaryCinemaRoot()
    const starts: string[] = []
    let shutdownSignal: AbortSignal | undefined
    const queue = new CinemaRenderQueue(async (entry, signal) => {
      starts.push(entry.jobID)
      if (entry.jobID !== "job-active") return
      await new Promise<void>((resolve) => signal.addEventListener("abort", () => {
        shutdownSignal = signal
        resolve()
      }, { once: true }))
    })
    await queue.enqueue({ cinemaRoot: root, projectID: "project-1", jobID: "job-active" })
    await queue.enqueue({ cinemaRoot: root, projectID: "project-1", jobID: "job-pending" })
    await waitFor(() => queue.snapshot().activeJobID === "job-active")

    await queue.shutdown()
    await waitFor(() => queue.snapshot().activeJobID === undefined)

    expect(starts).toEqual(["job-active"])
    expect(shutdownSignal).toBeDefined()
    expect(isCinemaRenderAgentShutdownSignal(shutdownSignal!)).toBe(true)
    expect(queue.snapshot().pendingJobIDs).toEqual(["job-pending"])
    expect((await readCinemaRenderQueueState(root)).pendingJobIDs).toEqual(["job-pending"])
  })

  test("restores persisted and recovered queued jobs without duplicates", async () => {
    const root = await temporaryCinemaRoot()
    await mkdir(root, { recursive: true })
    await writeCinemaRenderJob(root, job("job-1"))
    await writeCinemaRenderJob(root, job("job-2"))
    await writeCinemaRenderQueueState(root, {
      schemaVersion: 1,
      pendingJobIDs: ["job-1", "job-2"],
      updatedAt: now,
    })
    const starts: string[] = []
    const gates = new Map<string, ReturnType<typeof deferred>>()
    const queue = new CinemaRenderQueue(async (entry) => {
      starts.push(entry.jobID)
      const gate = deferred()
      gates.set(entry.jobID, gate)
      await gate.promise
    })
    await queue.resume(root, "project-1", ["job-2"])
    await waitFor(() => starts.length === 1)
    expect(queue.snapshot().pendingJobIDs).toEqual(["job-2"])
    gates.get("job-1")!.resolve()
    await waitFor(() => starts.length === 2)
    gates.get("job-2")!.resolve()
    await waitFor(() => queue.snapshot().activeJobID === undefined)
    expect(starts).toEqual(["job-1", "job-2"])
    expect((await readCinemaRenderJob(root, "job-1"))?.status).toBe("queued")
  })
})
