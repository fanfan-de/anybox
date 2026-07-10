import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { createServerRuntime } from "#server/server.ts"
import { setServerBaseURL } from "#server/base-url.ts"
import { createProject } from "#server/usecases/projects.ts"
import { initializeCinemaAssetLibrary } from "#cinema/asset-library.ts"
import { resolveMediaToolPaths, runMediaTool } from "#cinema/media-runtime.ts"

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
        id: "director-agent",
        type: "agent",
        title: "Director Agent",
        position: { x: 660, y: 220 },
        size: { width: 360, height: 220 },
        data: { text: "Coordinate shots." },
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
    edges: [
      {
        id: "edge-story-director",
        source: "story-brief",
        target: "director-agent",
      },
    ],
    nodeTypes: ["text", "agent"],
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
  const folder = path.join(projectRoot, "assets", "library", "生成素材", "图片")
  const videoFolder = path.join(projectRoot, "assets", "library", "生成素材", "视频")
  const audioFolder = path.join(projectRoot, "assets", "library", "生成素材", "音频")
  await Promise.all([mkdir(folder, { recursive: true }), mkdir(videoFolder, { recursive: true }), mkdir(audioFolder, { recursive: true })])
  const timestamp = "2026-07-10T00:00:00.000Z"
  for (let index = 1; index <= 3; index += 1) {
    const filename = `fixture-image-${index}.png`
    await writeFile(path.join(folder, filename), fixturePng)
    catalog.assets.push({
      id: `fixture-image-${index}`,
      folderID: "generated-images",
      relativePath: `生成素材/图片/${filename}`,
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
      relativePath: `生成素材/视频/${videoFilename}`,
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
    relativePath: `生成素材/音频/${audioFilename}`,
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
  const cinemaRoot = path.join(projectRoot, ".anybox-cinema")
  await rm(path.join(cinemaRoot, "timelines"), { recursive: true, force: true })
  await rm(path.join(cinemaRoot, "timeline-events"), { recursive: true, force: true })
  await rm(path.join(cinemaRoot, "cache", "timelines"), { recursive: true, force: true })
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

runtime.app.post("/e2e/seed-large-timeline", async (context) => {
  const timestamp = "2026-07-10T00:00:00.000Z"
  const cinemaRoot = path.join(projectRoot, ".anybox-cinema")
  const timelinesRoot = path.join(cinemaRoot, "timelines")
  await mkdir(timelinesRoot, { recursive: true })
  const durationUs = 3_600_000
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
      kind: "image",
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
        assetID: "fixture-image-1",
        contentRevision: 0,
        snapshot: { kind: "image", displayName: "Fixture image 1", mimeType: "image/png", width: 1, height: 1 },
      },
      sourceInUs: 0,
      sourceDurationUs: durationUs,
    })),
    markers: [],
  }
  await writeFile(path.join(timelinesRoot, "timeline_large-timeline.json"), `${JSON.stringify(timeline)}\n`, "utf8")
  return context.json({ success: true, data: { timelineID: timeline.id, clipCount: timeline.clips.length } })
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
  server.stop(true)
  await rm(projectRoot, { recursive: true, force: true })
  process.exit(0)
}

process.on("SIGINT", () => void shutdown())
process.on("SIGTERM", () => void shutdown())

await new Promise(() => undefined)
