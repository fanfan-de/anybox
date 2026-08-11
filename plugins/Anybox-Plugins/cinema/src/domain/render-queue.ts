import { randomUUID } from "node:crypto"
import { copyFile, mkdir, rm, writeFile } from "node:fs/promises"
import path from "node:path"

import type {
  CinemaRenderDiagnosticSummary,
  CinemaRenderExecutionRuntime,
  CinemaRenderJob,
  CinemaRenderEventType,
  CinemaRenderJobProgress,
} from "@anybox/cinema-plugin/contracts/render"

import { buildCinemaRenderPlan, type CinemaRenderResolvedInput } from "#cinema/render-graph.ts"
import { generateCinemaSubtitleAss } from "#cinema/render-subtitles.ts"
import { probeMediaFile } from "#cinema/media-runtime.ts"
import {
  findRegisteredCinemaRenderOutput,
  registerCinemaRenderOutput,
} from "#cinema/render-assets.ts"
import {
  CinemaRenderRunnerError,
  runCinemaRenderPlan,
  type CinemaRenderProgressUpdate,
} from "#cinema/render-runner.ts"
import {
  resolveLockedCinemaRenderExecutionRuntime,
  selectCinemaRenderExecutionRuntime,
} from "#cinema/render-runtime.ts"
import {
  resolveCinemaRenderSnapshotInputs,
  readCinemaRenderTimelineSnapshot,
  snapshotCinemaRenderInputs,
} from "#cinema/render-snapshot.ts"
import {
  appendCinemaRenderJobEvent,
  getCinemaRenderJobStoragePaths,
  readCinemaRenderJob,
  readCinemaRenderQueueState,
  writeCinemaRenderJob,
  writeCinemaRenderQueueState,
} from "#cinema/render-storage.ts"

export type CinemaRenderQueueEntry = {
  cinemaRoot: string
  projectID: string
  jobID: string
}

type CinemaRenderJobExecutor = (
  entry: CinemaRenderQueueEntry,
  signal: AbortSignal,
) => Promise<void>

const CINEMA_RENDER_AGENT_SHUTDOWN_REASON = Symbol("cinema-render-agent-shutdown")

export function isCinemaRenderAgentShutdownSignal(signal: AbortSignal) {
  return signal.aborted && signal.reason === CINEMA_RENDER_AGENT_SHUTDOWN_REASON
}

export type CinemaRenderExecutionPhase = "snapshotting" | "probing" | "rendering" | "registering"

export type CinemaRenderExecutionTestHooks = {
  beforePhase: (input: {
    entry: CinemaRenderQueueEntry
    job: Readonly<CinemaRenderJob>
    phase: CinemaRenderExecutionPhase
    signal: AbortSignal
  }) => void | Promise<void>
}

let executionTestHooks: Partial<CinemaRenderExecutionTestHooks> = {}

/** Installs deterministic executor hooks and returns a scoped restore. */
export function setCinemaRenderExecutionHooksForTesting(
  overrides: Partial<CinemaRenderExecutionTestHooks>,
) {
  const previous = executionTestHooks
  executionTestHooks = {
    ...previous,
    ...overrides,
  }
  return () => {
    executionTestHooks = previous
  }
}

/**
 * Holds the selected real executor phase until its AbortSignal is canceled.
 * This gives browser tests a stable active job without adding production
 * sleeps or substituting a fake queue.
 */
export function holdCinemaRenderPhaseUntilCanceledForTesting(
  heldPhase: CinemaRenderExecutionPhase = "rendering",
) {
  return setCinemaRenderExecutionHooksForTesting({
    beforePhase: async ({ phase, signal }) => {
      if (phase !== heldPhase || signal.aborted) return
      await new Promise<void>((resolve) => {
        signal.addEventListener("abort", () => resolve(), { once: true })
      })
    },
  })
}

function queueEntryKey(entry: CinemaRenderQueueEntry) {
  return `${entry.cinemaRoot}\u0000${entry.jobID}`
}

function eventID() {
  return `render-event-${randomUUID()}`
}

function nowISO() {
  return new Date().toISOString()
}

async function appendEvent(
  cinemaRoot: string,
  jobID: string,
  type: CinemaRenderEventType,
  details: {
    executionRuntime?: CinemaRenderExecutionRuntime
    progress?: CinemaRenderJobProgress
    error?: CinemaRenderJob["error"]
    outputAssetRef?: CinemaRenderJob["outputAssetRef"]
    message?: string
  } = {},
) {
  await appendCinemaRenderJobEvent(cinemaRoot, {
    schemaVersion: 1,
    id: eventID(),
    jobID,
    type,
    createdAt: nowISO(),
    ...details,
  })
}

/**
 * Serializes progress persistence and provides a hard close boundary before a
 * render job can enter a terminal state. Exported for deterministic queue
 * tests; production callers use the default job/event persistence.
 */
export function createCinemaRenderProgressWriter(input: {
  cinemaRoot: string
  initialJob: CinemaRenderJob
  signal: AbortSignal
  persist?: (job: CinemaRenderJob) => Promise<void>
  now?: () => string
}) {
  let accepting = true
  let currentJob = input.initialJob
  let pendingWrites = Promise.resolve()
  let writeError: unknown
  const timestamp = input.now ?? nowISO
  const persist = input.persist ?? (async (snapshot: CinemaRenderJob) => {
    await writeCinemaRenderJob(input.cinemaRoot, snapshot)
    await appendEvent(input.cinemaRoot, snapshot.id, "render-progress", { progress: snapshot.progress })
  })

  return {
    accept(progress: CinemaRenderProgressUpdate) {
      if (!accepting || input.signal.aborted) return false
      currentJob = {
        ...currentJob,
        progress: { phase: "rendering", ...progress, message: "Rendering with FFmpeg" },
        updatedAt: timestamp(),
      }
      const snapshot = currentJob
      pendingWrites = pendingWrites.then(() => persist(snapshot)).catch((error) => {
        accepting = false
        writeError ??= error
      })
      return true
    },
    async close() {
      accepting = false
      await pendingWrites
      if (writeError) throw writeError
      return currentJob
    },
  }
}

function throwIfCanceled(signal: AbortSignal) {
  if (signal.aborted) {
    throw new CinemaRenderRunnerError("render-canceled", "Render was canceled.", true)
  }
}

async function runBeforePhaseHook(
  entry: CinemaRenderQueueEntry,
  job: CinemaRenderJob,
  phase: CinemaRenderExecutionPhase,
  signal: AbortSignal,
) {
  await executionTestHooks.beforePhase?.({ entry, job, phase, signal })
  throwIfCanceled(signal)
}

async function updateRunningJob(
  cinemaRoot: string,
  job: CinemaRenderJob,
  status: "snapshotting" | "probing" | "rendering" | "registering",
  message: string,
) {
  const timestamp = nowISO()
  const next: CinemaRenderJob = {
    ...job,
    status,
    progress: { phase: status, message },
    ...(job.startedAt ? {} : { startedAt: timestamp }),
    updatedAt: timestamp,
  }
  await writeCinemaRenderJob(cinemaRoot, next)
  return next
}

function stableDiagnosticSummary(job: CinemaRenderJob): CinemaRenderDiagnosticSummary {
  const phase = ["queued", "snapshotting", "probing", "rendering", "registering"].includes(job.status)
    ? job.status as CinemaRenderDiagnosticSummary["phase"]
    : "unknown"
  return {
    phase,
    ...(job.executionRuntime ? { runtime: job.executionRuntime } : {}),
  }
}

function stableFailure(
  job: CinemaRenderJob,
  error: unknown,
): NonNullable<CinemaRenderJob["error"]> {
  const diagnosticSummary = stableDiagnosticSummary(job)
  if (error instanceof CinemaRenderRunnerError) {
    return { code: error.code, message: error.message, retryable: error.retryable, diagnosticSummary }
  }
  if (job.status === "snapshotting") {
    return { code: "snapshot-failed", message: "Render inputs could not be snapshotted.", retryable: true, diagnosticSummary }
  }
  if (job.status === "probing") {
    return { code: "probe-failed", message: "A snapshotted render input could not be probed.", retryable: true, diagnosticSummary }
  }
  if (job.status === "registering") {
    return { code: "output-registration-failed", message: "Rendered output could not be registered.", retryable: true, diagnosticSummary }
  }
  return { code: "render-failed", message: "Render failed unexpectedly.", retryable: true, diagnosticSummary }
}

async function terminalFailure(
  cinemaRoot: string,
  job: CinemaRenderJob,
  error: unknown,
  canceled: boolean,
) {
  const timestamp = nowISO()
  if (canceled) {
    const canceledJob: CinemaRenderJob = {
      ...job,
      status: "canceled",
      progress: { phase: "canceled", message: "Render was canceled." },
      finishedAt: timestamp,
      updatedAt: timestamp,
    }
    await writeCinemaRenderJob(cinemaRoot, canceledJob)
    await appendEvent(cinemaRoot, job.id, "render-canceled", { message: "Render was canceled." })
    return
  }
  const failure = stableFailure(job, error)
  const failedJob: CinemaRenderJob = {
    ...job,
    status: "failed",
    progress: { phase: "failed", message: failure.message },
    error: failure,
    finishedAt: timestamp,
    updatedAt: timestamp,
  }
  await writeCinemaRenderJob(cinemaRoot, failedJob)
  await appendEvent(cinemaRoot, job.id, "render-failed", { error: failure })
}

export async function executeCinemaRenderJob(
  entry: CinemaRenderQueueEntry,
  signal: AbortSignal,
) {
  let job = await readCinemaRenderJob(entry.cinemaRoot, entry.jobID)
  if (!job || job.status !== "queued") return
  const paths = getCinemaRenderJobStoragePaths(entry.cinemaRoot, job.id)

  try {
    throwIfCanceled(signal)
    let runtimeSelection
    try {
      runtimeSelection = job.executionRuntime
        ? await resolveLockedCinemaRenderExecutionRuntime(job.executionRuntime)
        : await selectCinemaRenderExecutionRuntime()
    } catch {
      throw new CinemaRenderRunnerError(
        "render-runtime-unavailable",
        "The runtime or encoder locked for this render job is unavailable.",
        true,
      )
    }
    const executionRuntime = runtimeSelection.executionRuntime
    const tools = runtimeSelection.tools
    if (!job.executionRuntime) {
      job = {
        ...job,
        executionRuntime,
        updatedAt: nowISO(),
      }
      await writeCinemaRenderJob(entry.cinemaRoot, job)
    }
    await appendEvent(entry.cinemaRoot, job.id, "runtime-bound", {
      executionRuntime,
      message: "Locked render runtime validated",
    })
    throwIfCanceled(signal)

    job = await updateRunningJob(entry.cinemaRoot, job, "snapshotting", "Freezing render inputs")
    await appendEvent(entry.cinemaRoot, job.id, "snapshot-started")
    await runBeforePhaseHook(entry, job, "snapshotting", signal)
    let storedInputs
    try {
      storedInputs = await resolveCinemaRenderSnapshotInputs(entry.cinemaRoot, job.id)
    } catch {
      await snapshotCinemaRenderInputs(entry.cinemaRoot, job.id)
      storedInputs = await resolveCinemaRenderSnapshotInputs(entry.cinemaRoot, job.id)
    }
    await appendEvent(entry.cinemaRoot, job.id, "snapshot-completed")
    throwIfCanceled(signal)

    job = await updateRunningJob(entry.cinemaRoot, job, "probing", "Inspecting snapshotted media")
    await runBeforePhaseHook(entry, job, "probing", signal)
    const resolvedInputs: CinemaRenderResolvedInput[] = []
    for (const input of storedInputs) {
      throwIfCanceled(signal)
      if (input.assetRef.snapshot.kind === "video") {
        const probe = await probeMediaFile(input.filePath, "video", { signal })
        resolvedInputs.push({ assetRef: input.assetRef, filePath: input.filePath, hasAudio: probe.hasAudio })
      } else if (input.assetRef.snapshot.kind === "audio") {
        await probeMediaFile(input.filePath, "audio", { signal })
        resolvedInputs.push({ assetRef: input.assetRef, filePath: input.filePath })
      } else {
        resolvedInputs.push({ assetRef: input.assetRef, filePath: input.filePath })
      }
    }
    const timeline = await readCinemaRenderTimelineSnapshot(entry.cinemaRoot, job.id)
    if (!timeline) throw new Error("Timeline snapshot is missing")
    const burnIn = job.settings.subtitles?.mode === "burn-in" ? job.settings.subtitles : null
    if (burnIn) {
      if (!tools.subtitleFontPath) throw new Error("The reviewed subtitle font is unavailable")
      await writeFile(
        path.join(paths.jobDirectory, "subtitle.ass"),
        generateCinemaSubtitleAss({ timeline, settings: job.settings, trackID: burnIn.trackID }),
        "utf8",
      )
      await mkdir(path.join(paths.jobDirectory, "fonts"), { recursive: true })
      await copyFile(tools.subtitleFontPath, path.join(paths.jobDirectory, "fonts", "NotoSansCJKsc-Regular.otf"))
    }
    const plan = buildCinemaRenderPlan({
      timeline,
      settings: job.settings,
      inputs: resolvedInputs,
      outputPath: paths.temporaryOutputPath,
      videoEncoder: executionRuntime.videoEncoder,
      audioEncoder: executionRuntime.audioEncoder,
      ...(burnIn ? { subtitleAssFilename: "subtitle.ass" as const } : {}),
    })
    await appendEvent(entry.cinemaRoot, job.id, "probe-completed")
    throwIfCanceled(signal)

    job = await updateRunningJob(entry.cinemaRoot, job, "rendering", "Rendering with FFmpeg")
    await appendEvent(entry.cinemaRoot, job.id, "render-started", { executionRuntime })
    await runBeforePhaseHook(entry, job, "rendering", signal)
    const progressWriter = createCinemaRenderProgressWriter({
      cinemaRoot: entry.cinemaRoot,
      initialJob: job,
      signal,
    })
    try {
      await runCinemaRenderPlan({
        ffmpegPath: tools.ffmpeg,
        ffprobePath: tools.ffprobe,
        outputPath: paths.temporaryOutputPath,
        plan,
        settings: job.settings,
        signal,
        onProgress: progressWriter.accept,
        workingDirectory: paths.jobDirectory,
        shouldForceKillOnAbort: () => isCinemaRenderAgentShutdownSignal(signal),
      })
    } finally {
      job = await progressWriter.close()
    }
    throwIfCanceled(signal)

    job = await updateRunningJob(entry.cinemaRoot, job, "registering", "Registering output asset")
    await appendEvent(entry.cinemaRoot, job.id, "registration-started")
    await runBeforePhaseHook(entry, job, "registering", signal)
    const outputAssetRef = await registerCinemaRenderOutput(job, paths.temporaryOutputPath)
    const timestamp = nowISO()
    const succeeded: CinemaRenderJob = {
      ...job,
      status: "succeeded",
      progress: {
        phase: "succeeded",
        percent: 100,
        renderedUs: plan.outputDurationUs,
        message: "Render completed",
      },
      outputAssetRef,
      finishedAt: timestamp,
      updatedAt: timestamp,
    }
    await writeCinemaRenderJob(entry.cinemaRoot, succeeded)
    await appendEvent(entry.cinemaRoot, job.id, "render-succeeded", { outputAssetRef })
  } catch (error) {
    const latest = await readCinemaRenderJob(entry.cinemaRoot, entry.jobID)
    if (!latest || latest.status === "succeeded" || latest.status === "canceled") return
    if (latest.status === "registering") {
      const recoveredOutput = await findRegisteredCinemaRenderOutput(latest).catch(() => undefined)
      if (recoveredOutput) {
        const timestamp = nowISO()
        const recovered: CinemaRenderJob = {
          ...latest,
          status: "succeeded",
          progress: { phase: "succeeded", percent: 100, message: "Render completed" },
          outputAssetRef: recoveredOutput,
          finishedAt: timestamp,
          updatedAt: timestamp,
        }
        await writeCinemaRenderJob(entry.cinemaRoot, recovered)
        await appendEvent(entry.cinemaRoot, latest.id, "render-succeeded", { outputAssetRef: recoveredOutput })
        return
      }
    }
    await rm(paths.temporaryOutputPath, { force: true }).catch(() => undefined)
    if (isCinemaRenderAgentShutdownSignal(signal)) return
    await terminalFailure(
      entry.cinemaRoot,
      latest,
      error,
      signal.aborted || error instanceof CinemaRenderRunnerError && error.code === "render-canceled",
    )
  }
}

export class CinemaRenderQueue {
  private readonly pending: CinemaRenderQueueEntry[] = []
  private active: {
    entry: CinemaRenderQueueEntry
    controller: AbortController
    completion: Promise<void>
  } | undefined
  private mutations: Promise<void> = Promise.resolve()
  private shuttingDown = false

  constructor(private readonly executor: CinemaRenderJobExecutor = executeCinemaRenderJob) {}

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutations.then(operation, operation)
    this.mutations = result.then(() => undefined, () => undefined)
    return result
  }

  private async persist(cinemaRoot: string) {
    await writeCinemaRenderQueueState(cinemaRoot, {
      schemaVersion: 1,
      pendingJobIDs: this.pending
        .filter((entry) => entry.cinemaRoot === cinemaRoot)
        .map((entry) => entry.jobID),
      updatedAt: nowISO(),
    })
  }

  private schedule() {
    void this.serialize(async () => {
      if (this.shuttingDown || this.active || this.pending.length === 0) return
      const entry = this.pending.shift()!
      const controller = new AbortController()
      await this.persist(entry.cinemaRoot)
      const completion = this.executor(entry, controller.signal)
      this.active = { entry, controller, completion }
      void completion.finally(() => {
        void this.serialize(async () => {
          if (this.active?.entry === entry) this.active = undefined
        }).finally(() => this.schedule())
      }).catch(() => undefined)
    })
  }

  async enqueue(entry: CinemaRenderQueueEntry) {
    await this.serialize(async () => {
      const key = queueEntryKey(entry)
      if (this.active && queueEntryKey(this.active.entry) === key) return
      if (this.pending.some((item) => queueEntryKey(item) === key)) return
      this.pending.push(entry)
      await this.persist(entry.cinemaRoot)
    })
    this.schedule()
  }

  async resume(cinemaRoot: string, projectID: string, recoveredQueuedJobIDs: readonly string[]) {
    const persisted = await readCinemaRenderQueueState(cinemaRoot)
    const jobIDs = [...new Set([...persisted.pendingJobIDs, ...recoveredQueuedJobIDs])]
    for (const jobID of jobIDs) {
      const job = await readCinemaRenderJob(cinemaRoot, jobID)
      if (job?.projectID === projectID && job.status === "queued") {
        await this.enqueue({ cinemaRoot, projectID, jobID })
      }
    }
  }

  async cancel(cinemaRoot: string, jobID: string) {
    let activeCompletion: Promise<void> | undefined
    let canceledPending = false
    await this.serialize(async () => {
      const index = this.pending.findIndex((entry) => entry.cinemaRoot === cinemaRoot && entry.jobID === jobID)
      if (index >= 0) {
        this.pending.splice(index, 1)
        await this.persist(cinemaRoot)
        canceledPending = true
      }
      if (this.active?.entry.cinemaRoot === cinemaRoot && this.active.entry.jobID === jobID) {
        this.active.controller.abort()
        activeCompletion = this.active.completion
      }
    })
    if (canceledPending) {
      const job = await readCinemaRenderJob(cinemaRoot, jobID)
      if (job?.status === "queued") await terminalFailure(cinemaRoot, job, undefined, true)
    }
    if (activeCompletion) await activeCompletion.catch(() => undefined)
    if (!activeCompletion && !canceledPending) {
      const job = await readCinemaRenderJob(cinemaRoot, jobID)
      if (job?.status === "queued") await terminalFailure(cinemaRoot, job, undefined, true)
    }
    this.schedule()
    return await readCinemaRenderJob(cinemaRoot, jobID)
  }

  async shutdown() {
    let activeCompletion: Promise<void> | undefined
    await this.serialize(async () => {
      this.shuttingDown = true
      if (!this.active) return
      this.active.controller.abort(CINEMA_RENDER_AGENT_SHUTDOWN_REASON)
      activeCompletion = this.active.completion
    })
    await activeCompletion?.catch(() => undefined)
  }

  /** Waits until queued executor work and its completion bookkeeping settle. */
  async waitForIdleForTesting() {
    while (true) {
      let activeCompletion: Promise<void> | undefined
      let hasPending = false
      await this.serialize(async () => {
        activeCompletion = this.active?.completion
        hasPending = this.pending.length > 0
      })
      if (!activeCompletion && !hasPending) return
      if (activeCompletion) {
        await activeCompletion.catch(() => undefined)
      } else {
        this.schedule()
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
      }
    }
  }

  snapshot() {
    return {
      activeJobID: this.active?.entry.jobID,
      pendingJobIDs: this.pending.map((entry) => entry.jobID),
    }
  }
}

export const cinemaRenderQueue = new CinemaRenderQueue()
