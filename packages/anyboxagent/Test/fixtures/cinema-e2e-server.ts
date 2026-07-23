import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  CinemaRenderJobSchema,
  type CinemaRenderJob,
  type CinemaRenderSettings,
} from "@anybox/shared/cinema-render"
import { createServerRuntime } from "#server/server.ts"
import { setServerBaseURL } from "#server/base-url.ts"
import { createProject } from "#server/usecases/projects.ts"
import {
  initializeCinemaAssetLibrary,
  setCinemaAssetLibraryCatalogWriteFailureForTest,
} from "#cinema/asset-library.ts"
import { resolveMediaToolPaths, runMediaTool } from "#cinema/media-runtime.ts"
import { setCinemaRenderPreflightDependenciesForTesting } from "#cinema/render-preflight.ts"
import { recoverCinemaRenderJobs } from "#cinema/render-recovery.ts"
import {
  cinemaRenderQueue,
  executeCinemaRenderJob,
  holdCinemaRenderPhaseUntilCanceledForTesting,
} from "#cinema/render-queue.ts"
import {
  getCinemaRenderJobStoragePaths,
  readCinemaRenderJob,
  writeCinemaRenderJob,
} from "#cinema/render-storage.ts"
import {
  setCinemaRenderSnapshotHooksForTesting,
  snapshotCinemaRenderInputs,
  writeCinemaRenderTimelineSnapshot,
} from "#cinema/render-snapshot.ts"
import { readCinemaTimelineDocument } from "#cinema/timeline-storage.ts"

const host = "127.0.0.1"
const port = Number.parseInt(process.env.CINEMA_E2E_AGENT_PORT ?? "4187", 10)
const moduleDirectory = path.dirname(fileURLToPath(import.meta.url))
const cinemaWebDist = path.resolve(moduleDirectory, "../../../cinema-web/dist")
const projectRoot = await mkdtemp(path.join(tmpdir(), "anybox-cinema-e2e-"))
const fixtureMediaRoot = path.join(projectRoot, "fixture-media")

process.env.ANYBOX_CINEMA_WEB_DIST = cinemaWebDist
process.env.ANYBOX_LOG_PRINT = "false"
process.env.ANYBOX_LOG_FILE = "false"

const runtime = createServerRuntime({
  corsWhitelist: [`http://${host}:${port}`],
})

const project = await createProject({ directory: projectRoot })
const projectID = project.id

type RestoreTestHook = () => void

let restorePreflightFault: RestoreTestHook | undefined
let restoreSnapshotFault: RestoreTestHook | undefined
let restoreRegistrationFault: RestoreTestHook | undefined
let restoreExecutionHold: RestoreTestHook | undefined

async function restoreFaultHooks() {
  const activeJobID = cinemaRenderQueue.snapshot().activeJobID
  if (activeJobID) {
    await cinemaRenderQueue.cancel(path.join(projectRoot, ".anybox-cinema"), activeJobID)
  }
  restorePreflightFault?.()
  restoreSnapshotFault?.()
  restoreRegistrationFault?.()
  restoreExecutionHold?.()
  restorePreflightFault = undefined
  restoreSnapshotFault = undefined
  restoreRegistrationFault = undefined
  restoreExecutionHold = undefined
}

function fixtureCanvas() {
  return {
    schemaVersion: 1,
    revision: 0,
    canvasType: "node-canvas",
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [
      {
        id: "story-brief",
        type: "text",
        title: "Story Brief",
        position: { x: 160, y: 180 },
        size: { width: 360, height: 220 },
        data: { text: "A test story brief." },
      },
      {
        id: "second-brief",
        type: "text",
        title: "Second Brief",
        position: { x: 160, y: 520 },
        size: { width: 360, height: 220 },
        data: { text: "A second test story brief." },
      },
    ],
    edges: [],
    nodeTypes: ["text"],
  }
}

const fixturePng = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
  0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
  0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
])

async function ensureFixtureMedia() {
  await mkdir(fixtureMediaRoot, { recursive: true })
  const videoPath = path.join(fixtureMediaRoot, "fixture-video.mp4")
  const audioPath = path.join(fixtureMediaRoot, "fixture-audio.wav")
  const tools = await resolveMediaToolPaths()
  try {
    await stat(videoPath)
  } catch {
    await runMediaTool(tools.ffmpeg, [
      "-y", "-f", "lavfi", "-i", "color=c=0x5b5bd6:s=320x180:r=25:d=2",
      "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=2",
      "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", videoPath,
    ])
  }
  try {
    await stat(audioPath)
  } catch {
    await runMediaTool(tools.ffmpeg, [
      "-y", "-f", "lavfi", "-i", "sine=frequency=660:sample_rate=48000:duration=2",
      "-c:a", "pcm_s16le", audioPath,
    ])
  }
  return { videoPath, audioPath }
}

async function resetFixtureAssets() {
  const media = await ensureFixtureMedia()
  const scope = { type: "project" as const, projectID }
  await rm(path.join(projectRoot, "assets", "library"), { recursive: true, force: true })
  await rm(path.join(projectRoot, ".anybox-cinema", "asset-library.json"), { force: true })
  await initializeCinemaAssetLibrary(scope)
  const catalogPath = path.join(projectRoot, ".anybox-cinema", "asset-library.json")
  const catalog = JSON.parse(await readFile(catalogPath, "utf8")) as {
    revision: number
    updatedAt: string
    assets: Array<Record<string, unknown>>
  }
  const folder = path.join(projectRoot, "assets", "library", "产出", "图片")
  const videoFolder = path.join(projectRoot, "assets", "library", "产出", "视频")
  const audioFolder = path.join(projectRoot, "assets", "library", "产出", "音频")
  await Promise.all([mkdir(folder, { recursive: true }), mkdir(videoFolder, { recursive: true }), mkdir(audioFolder, { recursive: true })])
  const timestamp = "2026-07-10T00:00:00.000Z"
  for (let index = 1; index <= 3; index += 1) {
    const filename = `fixture-image-${index}.png`
    await writeFile(path.join(folder, filename), fixturePng)
    catalog.assets.push({
      id: `fixture-image-${index}`,
      folderID: "generated-images",
      relativePath: `产出/图片/${filename}`,
      displayName: `Fixture image ${index}`,
      kind: "image",
      source: "generation",
      status: "ready",
      mimeType: "image/png",
      sizeBytes: fixturePng.byteLength,
      checksum: `fixture-checksum-${index}`,
      width: 1,
      height: 1,
      contentRevision: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    const videoFilename = `fixture-video-${index}.mp4`
    await copyFile(media.videoPath, path.join(videoFolder, videoFilename))
    catalog.assets.push({
      id: `fixture-video-${index}`,
      folderID: "generated-videos",
      relativePath: `产出/视频/${videoFilename}`,
      displayName: `Fixture video ${index}`,
      kind: "video",
      source: "generation",
      status: "ready",
      mimeType: "video/mp4",
      sizeBytes: (await stat(media.videoPath)).size,
      checksum: `fixture-video-checksum-${index}`,
      width: 320,
      height: 180,
      durationSeconds: 2,
      contentRevision: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
  }
  const audioFilename = "fixture-audio.wav"
  await copyFile(media.audioPath, path.join(audioFolder, audioFilename))
  catalog.assets.push({
    id: "fixture-audio-1",
    folderID: "generated-audio",
    relativePath: `产出/音频/${audioFilename}`,
    displayName: "Fixture audio 1",
    kind: "audio",
    source: "generation",
    status: "ready",
    mimeType: "audio/wav",
    sizeBytes: (await stat(media.audioPath)).size,
    checksum: "fixture-audio-checksum-1",
    durationSeconds: 2,
    contentRevision: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  catalog.revision = 1
  catalog.updatedAt = timestamp
  await writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`, "utf8")
}

async function resetFixture() {
  await restoreFaultHooks()
  const cinemaRoot = path.join(projectRoot, ".anybox-cinema")
  await rm(path.join(cinemaRoot, "timelines"), { recursive: true, force: true })
  await rm(path.join(cinemaRoot, "timeline-events"), { recursive: true, force: true })
  await rm(path.join(cinemaRoot, "cache", "timelines"), { recursive: true, force: true })
  await rm(path.join(cinemaRoot, "render-jobs"), { recursive: true, force: true })
  await rm(path.join(cinemaRoot, "render-queue.json"), { force: true })
  await mkdir(cinemaRoot, { recursive: true })
  await writeFile(path.join(cinemaRoot, "project.json"), `${JSON.stringify({
    schemaVersion: 1,
    name: "Cinema Reliability E2E",
    createdAt: "2026-07-10T00:00:00.000Z",
  }, null, 2)}\n`, "utf8")
  await writeFile(path.join(cinemaRoot, "canvas.json"), `${JSON.stringify(fixtureCanvas(), null, 2)}\n`, "utf8")
  await writeFile(path.join(cinemaRoot, "events.jsonl"), "", "utf8")
  await writeFile(path.join(cinemaRoot, "tasks.jsonl"), "", "utf8")
  await resetFixtureAssets()
}

await resetFixture()

runtime.app.get("/e2e/project", (context) => context.json({
  success: true,
  data: {
    projectID,
    projectRoot,
    cinemaURL: `http://${host}:${port}/cinema/?projectID=${encodeURIComponent(projectID)}&agentBaseURL=${encodeURIComponent(`http://${host}:${port}`)}`,
  },
}))

runtime.app.post("/e2e/reset", async (context) => {
  await resetFixture()
  return context.json({ success: true, data: { projectID } })
})

runtime.app.post("/e2e/faults/restore", async (context) => {
  await restoreFaultHooks()
  return context.json({ success: true })
})

runtime.app.post("/e2e/faults/working-space-insufficient", (context) => {
  restorePreflightFault?.()
  restorePreflightFault = setCinemaRenderPreflightDependenciesForTesting({
    getAvailableBytes: async () => 0,
  })
  return context.json({ success: true })
})

runtime.app.post("/e2e/faults/snapshot-permission-denied", (context) => {
  restoreSnapshotFault?.()
  restoreSnapshotFault = setCinemaRenderSnapshotHooksForTesting({
    beforeSnapshotInputs: async () => {
      throw Object.assign(new Error("Synthetic snapshot permission denial."), { code: "EACCES" })
    },
  })
  return context.json({ success: true })
})

runtime.app.post("/e2e/faults/output-registration-failure", (context) => {
  restoreRegistrationFault?.()
  restoreRegistrationFault = setCinemaAssetLibraryCatalogWriteFailureForTest(true)
  return context.json({ success: true })
})

runtime.app.post("/e2e/faults/hold-running-render", (context) => {
  restoreExecutionHold?.()
  restoreExecutionHold = holdCinemaRenderPhaseUntilCanceledForTesting("rendering")
  return context.json({ success: true })
})

runtime.app.post("/e2e/seed-large-timeline", async (context) => {
  const timestamp = "2026-07-10T00:00:00.000Z"
  const cinemaRoot = path.join(projectRoot, ".anybox-cinema")
  const timelinesRoot = path.join(cinemaRoot, "timelines")
  await mkdir(timelinesRoot, { recursive: true })
  const durationUs = 1_500_000
  const timeline = {
    schemaVersion: 1,
    id: "large-timeline",
    projectID,
    title: "500 Clip performance",
    revision: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
    settings: { width: 1920, height: 1080, frameRate: { numerator: 25, denominator: 1 }, sampleRate: 48_000, backgroundColor: "#000000" },
    tracks: [
      { id: "v1", kind: "video", title: "V1", order: 0, locked: false, muted: false, hidden: false },
      { id: "a1", kind: "audio", title: "A1", order: 1, locked: false, muted: false, hidden: false },
      { id: "o1", kind: "overlay", title: "O1", order: 2, locked: false, muted: false, hidden: false },
    ],
    clips: Array.from({ length: 500 }, (_, index) => ({
      id: `large-clip-${index}`,
      trackID: "o1",
      kind: "video",
      title: `Clip ${index + 1}`,
      timelineStartUs: index * durationUs,
      durationUs,
      playbackRate: 1,
      volume: 1,
      opacity: 1,
      fit: "contain",
      createdAt: timestamp,
      updatedAt: timestamp,
      assetRef: {
        scope: { type: "project", projectID },
        assetID: "fixture-video-1",
        contentRevision: 0,
        snapshot: { kind: "video", displayName: "Fixture video 1", mimeType: "video/mp4", width: 320, height: 180, durationSeconds: 2 },
      },
      sourceInUs: 0,
      sourceDurationUs: durationUs,
    })),
    markers: [],
  }
  await writeFile(path.join(timelinesRoot, "timeline_large-timeline.json"), `${JSON.stringify(timeline)}\n`, "utf8")
  return context.json({ success: true, data: { timelineID: timeline.id, clipCount: timeline.clips.length } })
})

runtime.app.post("/e2e/seed-deliver-timeline", async (context) => {
  const timestamp = "2026-07-10T00:00:00.000Z"
  const cinemaRoot = path.join(projectRoot, ".anybox-cinema")
  const timelinesRoot = path.join(cinemaRoot, "timelines")
  await mkdir(timelinesRoot, { recursive: true })
  const projectScope = { type: "project" as const, projectID }
  const assetRef = (assetID: string, kind: "video" | "audio" | "image", displayName: string, mimeType: string, durationSeconds?: number) => ({
    scope: projectScope,
    assetID,
    contentRevision: 0,
    snapshot: {
      kind,
      displayName,
      mimeType,
      ...(kind === "video" ? { width: 320, height: 180 } : {}),
      ...(kind === "image" ? { width: 1, height: 1 } : {}),
      ...(durationSeconds !== undefined ? { durationSeconds } : {}),
    },
  })
  const timeline = {
    schemaVersion: 1,
    id: "deliver-timeline",
    projectID,
    title: "Delivery fixture",
    revision: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
    settings: { width: 320, height: 180, frameRate: { numerator: 25, denominator: 1 }, sampleRate: 48_000, backgroundColor: "#000000" },
    tracks: [
      { id: "v1", kind: "video", title: "V1", order: 0, locked: false, muted: false, hidden: false },
      { id: "a1", kind: "audio", title: "A1", order: 1, locked: false, muted: false, hidden: false },
      { id: "o1", kind: "overlay", title: "O1", order: 2, locked: false, muted: false, hidden: false },
    ],
    clips: [
      ...Array.from({ length: 3 }, (_, index) => ({
        id: `deliver-video-${index + 1}`,
        trackID: "v1",
        kind: "video" as const,
        title: `Fixture video ${index + 1}`,
        timelineStartUs: index * 500_000,
        durationUs: 500_000,
        playbackRate: 1,
        volume: 1,
        opacity: 1,
        fit: "contain" as const,
        assetRef: assetRef(`fixture-video-${index + 1}`, "video", `Fixture video ${index + 1}`, "video/mp4", 2),
        sourceInUs: 0,
        sourceDurationUs: 500_000,
        createdAt: timestamp,
        updatedAt: timestamp,
      })),
      { id: "deliver-audio", trackID: "a1", kind: "audio", title: "Fixture audio", timelineStartUs: 0, durationUs: 1_500_000, playbackRate: 1, volume: 0.25, opacity: 1, assetRef: assetRef("fixture-audio-1", "audio", "Fixture audio 1", "audio/wav", 2), sourceInUs: 0, sourceDurationUs: 1_500_000, createdAt: timestamp, updatedAt: timestamp },
      { id: "deliver-image", trackID: "o1", kind: "image", title: "Fixture overlay", timelineStartUs: 500_000, durationUs: 500_000, playbackRate: 1, volume: 1, opacity: 0.55, fit: "contain", assetRef: assetRef("fixture-image-1", "image", "Fixture image 1", "image/png"), sourceInUs: 0, sourceDurationUs: 500_000, createdAt: timestamp, updatedAt: timestamp },
    ],
    markers: [],
  }
  await writeFile(path.join(timelinesRoot, "timeline_deliver-timeline.json"), `${JSON.stringify(timeline)}\n`, "utf8")
  return context.json({
    success: true,
    data: { timelineID: timeline.id, videoClips: 3, audioClips: 1, imageClips: 1 },
  })
})

runtime.app.post("/e2e/seed-subtitle-deliver-timeline", async (context) => {
  const timestamp = "2026-07-12T00:00:00.000Z"
  const cinemaRoot = path.join(projectRoot, ".anybox-cinema")
  const timelinesRoot = path.join(cinemaRoot, "timelines")
  await mkdir(timelinesRoot, { recursive: true })
  const timeline = {
    schemaVersion: 2,
    id: "subtitle-deliver-timeline",
    projectID,
    title: "Subtitle delivery fixture",
    revision: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
    settings: { width: 320, height: 180, frameRate: { numerator: 25, denominator: 1 }, sampleRate: 48_000, backgroundColor: "#000000" },
    tracks: [
      { id: "subtitle-v1", kind: "video", title: "V1", order: 0, locked: false, muted: false, hidden: false },
      {
        id: "subtitle-s1",
        kind: "subtitle",
        title: "S1",
        order: 1,
        locked: false,
        hidden: false,
        language: "zh-CN",
        role: "subtitle",
        style: {
          fontFamilyID: "anybox-subtitle-sans-v1",
          fontSizePx: 24,
          textColor: "#FFFFFFFF",
          outlineColor: "#000000FF",
          outlineWidthPx: 2,
          backgroundColor: "#00000000",
          alignment: "bottom-center",
          marginBottomPx: 18,
        },
      },
    ],
    clips: [
      {
        id: "subtitle-video",
        trackID: "subtitle-v1",
        kind: "video",
        title: "Fixture video",
        timelineStartUs: 0,
        durationUs: 2_000_000,
        playbackRate: 1,
        volume: 1,
        opacity: 1,
        fit: "contain",
        assetRef: {
          scope: { type: "project", projectID },
          assetID: "fixture-video-1",
          contentRevision: 0,
          snapshot: { kind: "video", displayName: "Fixture video 1", mimeType: "video/mp4", width: 320, height: 180, durationSeconds: 2 },
        },
        sourceInUs: 0,
        sourceDurationUs: 2_000_000,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      {
        id: "subtitle-cue-1",
        trackID: "subtitle-s1",
        kind: "subtitle",
        timelineStartUs: 250_000,
        durationUs: 750_000,
        cueText: "Cinema 字幕 smoke",
        speaker: "旁白",
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      {
        id: "subtitle-cue-2",
        trackID: "subtitle-s1",
        kind: "subtitle",
        timelineStartUs: 1_000_000,
        durationUs: 750_000,
        cueText: "安全区检查\nSecond line",
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
    markers: [],
  }
  await writeFile(path.join(timelinesRoot, "timeline_subtitle-deliver-timeline.json"), `${JSON.stringify(timeline)}\n`, "utf8")
  return context.json({ success: true, data: { timelineID: timeline.id, subtitleCues: 2 } })
})

runtime.app.post("/e2e/seed-blocked-timeline", async (context) => {
  const timestamp = "2026-07-11T00:00:00.000Z"
  const cinemaRoot = path.join(projectRoot, ".anybox-cinema")
  const timelinesRoot = path.join(cinemaRoot, "timelines")
  await mkdir(timelinesRoot, { recursive: true })
  const timeline = {
    schemaVersion: 1,
    id: "blocked-timeline",
    projectID,
    title: "Blocked empty fixture",
    revision: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
    settings: { width: 320, height: 180, frameRate: { numerator: 25, denominator: 1 }, sampleRate: 48_000, backgroundColor: "#000000" },
    tracks: [
      { id: "blocked-v1", kind: "video", title: "V1", order: 0, locked: false, muted: false, hidden: false },
      { id: "blocked-a1", kind: "audio", title: "A1", order: 1, locked: false, muted: false, hidden: false },
    ],
    clips: [],
    markers: [],
  }
  await writeFile(path.join(timelinesRoot, "timeline_blocked-timeline.json"), `${JSON.stringify(timeline)}\n`, "utf8")
  return context.json({ success: true, data: { timelineID: timeline.id } })
})

function fixtureRenderSettings(outputName: string): CinemaRenderSettings {
  return {
    format: "mp4",
    videoCodec: "h264",
    audioCodec: "aac",
    width: 320,
    height: 180,
    frameRate: { numerator: 25, denominator: 1 },
    quality: { mode: "balanced" },
    audioBitrateKbps: 192,
    range: { type: "full" },
    outputName,
  }
}

async function createFixtureRenderJob(input: {
  id: string
  operationID: string
  outputName: string
  status?: "queued" | "rendering"
}) {
  const cinemaRoot = path.join(projectRoot, ".anybox-cinema")
  const timeline = await readCinemaTimelineDocument(cinemaRoot, "deliver-timeline")
  if (!timeline) throw new Error("Seed the Deliver Timeline before injecting a render job.")
  const timestamp = new Date().toISOString()
  const status = input.status ?? "queued"
  const job: CinemaRenderJob = {
    schemaVersion: 1,
    id: input.id,
    projectID,
    timelineID: timeline.id,
    timelineRevision: timeline.revision,
    operationID: input.operationID,
    status,
    settings: fixtureRenderSettings(input.outputName),
    progress: {
      phase: status,
      message: status === "rendering" ? "Rendering with FFmpeg" : "Waiting for the render queue",
    },
    createdAt: timestamp,
    ...(status === "rendering" ? { startedAt: timestamp } : {}),
    updatedAt: timestamp,
  }
  await writeCinemaRenderJob(cinemaRoot, job)
  await writeCinemaRenderTimelineSnapshot(cinemaRoot, job.id, timeline)
  return { cinemaRoot, job }
}

runtime.app.post("/e2e/inject-render-failure", async (context) => {
  const { cinemaRoot, job } = await createFixtureRenderJob({
    id: "render-e2e-ffmpeg-failure",
    operationID: "e2e-ffmpeg-failure",
    outputName: "Injected FFmpeg failure",
  })
  await snapshotCinemaRenderInputs(cinemaRoot, job.id)
  const paths = getCinemaRenderJobStoragePaths(cinemaRoot, job.id)
  // A directory at the temporary output path makes the real FFmpeg process fail without
  // mutating the immutable Timeline or input snapshot. A retry gets a fresh job sandbox.
  await mkdir(paths.temporaryOutputPath)
  await executeCinemaRenderJob({ cinemaRoot, projectID, jobID: job.id }, new AbortController().signal)
  const failed = await readCinemaRenderJob(cinemaRoot, job.id)
  if (failed?.status !== "failed" || failed.error?.code !== "render-failed") {
    throw new Error(`Expected an FFmpeg render failure, received '${failed?.status ?? "missing"}'.`)
  }
  await rm(paths.temporaryOutputPath, { recursive: true, force: true })
  return context.json({ success: true, data: { job: failed } })
})

runtime.app.post("/e2e/inject-queued-render", async (context) => {
  const { job } = await createFixtureRenderJob({
    id: "render-e2e-queued-cancel",
    operationID: "e2e-queued-cancel",
    outputName: "Queued cancel fixture",
  })
  return context.json({ success: true, data: { job } })
})

runtime.app.post("/e2e/inject-agent-interruption", async (context) => {
  const { cinemaRoot, job } = await createFixtureRenderJob({
    id: "render-e2e-agent-interruption",
    operationID: "e2e-agent-interruption",
    outputName: "Interrupted render fixture",
    status: "rendering",
  })
  const paths = getCinemaRenderJobStoragePaths(cinemaRoot, job.id)
  await writeFile(paths.temporaryOutputPath, "partial output", "utf8")
  const recovery = await recoverCinemaRenderJobs(cinemaRoot)
  const interrupted = await readCinemaRenderJob(cinemaRoot, job.id)
  const partialOutputExists = await stat(paths.temporaryOutputPath).then(() => true, () => false)
  if (interrupted?.status !== "interrupted") {
    throw new Error(`Expected an interrupted render job, received '${interrupted?.status ?? "missing"}'.`)
  }
  return context.json({
    success: true,
    data: { job: interrupted, recovery, partialOutputExists },
  })
})

runtime.app.post("/e2e/seed-render-history", async (context) => {
  const cinemaRoot = path.join(projectRoot, ".anybox-cinema")
  const timeline = await readCinemaTimelineDocument(cinemaRoot, "deliver-timeline")
  if (!timeline) throw new Error("Seed the Deliver Timeline before seeding render history.")
  const startedAt = performance.now()
  const baseTime = Date.now()
  const jobs = Array.from({ length: 1_000 }, (_, index) => {
    const sequence = index.toString().padStart(4, "0")
    const timestamp = new Date(baseTime - index * 1_000).toISOString()
    return CinemaRenderJobSchema.parse({
      schemaVersion: 1,
      id: `render-history-${sequence}`,
      projectID,
      timelineID: timeline.id,
      timelineRevision: timeline.revision,
      operationID: `e2e-history-${sequence}`,
      status: "canceled",
      settings: fixtureRenderSettings(`History render ${sequence}`),
      progress: { phase: "canceled", message: "Render was canceled." },
      createdAt: timestamp,
      finishedAt: timestamp,
      updatedAt: timestamp,
    })
  })
  const renderJobsRoot = path.join(cinemaRoot, "render-jobs")
  await mkdir(renderJobsRoot, { recursive: true })
  for (let offset = 0; offset < jobs.length; offset += 100) {
    await Promise.all(jobs.slice(offset, offset + 100).map(async (job) => {
      const jobDirectory = path.join(renderJobsRoot, `job_${job.id}`)
      await mkdir(jobDirectory)
      await writeFile(path.join(jobDirectory, "job.json"), `${JSON.stringify(job)}\n`, "utf8")
    }))
  }
  return context.json({
    success: true,
    data: { count: jobs.length, seedElapsedMs: performance.now() - startedAt },
  })
})

const server = Bun.serve({
  hostname: host,
  port,
  idleTimeout: 120,
  fetch(request, bunServer) {
    return runtime.app.fetch(request, bunServer)
  },
  websocket: runtime.websocket,
})
setServerBaseURL(`http://${host}:${port}`)

async function shutdown() {
  await restoreFaultHooks()
  server.stop(true)
  await rm(projectRoot, { recursive: true, force: true })
  process.exit(0)
}

process.on("SIGINT", () => void shutdown())
process.on("SIGTERM", () => void shutdown())

await new Promise(() => undefined)
