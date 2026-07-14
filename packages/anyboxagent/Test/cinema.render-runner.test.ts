import { afterEach, describe, expect, test } from "bun:test"
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import type { CinemaAssetRef } from "@anybox/shared/cinema"
import type { CinemaRenderSettings } from "@anybox/shared/cinema-render"
import type { CinemaTimelineDocument } from "@anybox/shared/cinema-timeline"
import { resolveMediaToolPaths, runMediaTool } from "../src/cinema/media-runtime"
import { buildCinemaRenderPlan } from "../src/cinema/render-graph"
import {
  CinemaRenderRunnerError,
  createCinemaRenderProgressThrottle,
  parseCinemaFFmpegProgress,
  runCinemaRenderPlan,
} from "../src/cinema/render-runner"

const roots: string[] = []
const now = "2026-07-10T12:00:00.000Z"

async function temporaryRoot() {
  const root = await mkdtemp(path.join(tmpdir(), "anybox-render-runner-"))
  roots.push(root)
  return root
}

function ref(assetID: string, kind: "video" | "audio" | "image"): CinemaAssetRef {
  return {
    scope: { type: "project", projectID: "project-1" },
    assetID,
    contentRevision: 1,
    snapshot: {
      kind,
      displayName: assetID,
      mimeType: kind === "video" ? "video/mp4" : kind === "audio" ? "audio/wav" : "image/png",
      ...(kind === "image" ? { width: 64, height: 64 } : { durationSeconds: 3 }),
    },
  }
}

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
  outputName: "Runner fixture",
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("Cinema render runner", () => {
  test("parses and throttles real FFmpeg progress values", () => {
    expect(parseCinemaFFmpegProgress({ out_time_us: "2500000" }, 5_000_000)).toEqual({
      renderedUs: 2_500_000,
      percent: 50,
    })
    expect(parseCinemaFFmpegProgress({ out_time_us: "9000000" }, 5_000_000)).toEqual({
      renderedUs: 5_000_000,
      percent: 100,
    })
    expect(parseCinemaFFmpegProgress({ frame: "20" }, 5_000_000)).toBeUndefined()

    let timestamp = 0
    const emitted: number[] = []
    const emit = createCinemaRenderProgressThrottle(
      (progress) => emitted.push(progress.percent),
      () => timestamp,
    )
    expect(emit({ renderedUs: 50_000, percent: 1 })).toBe(true)
    timestamp = 100
    expect(emit({ renderedUs: 100_000, percent: 2 })).toBe(false)
    timestamp = 300
    expect(emit({ renderedUs: 150_000, percent: 3 })).toBe(true)
    expect(emit({ renderedUs: 150_000, percent: 3 }, true)).toBe(false)
    expect(emitted).toEqual([1, 3])
  })

  test("renders and validates a real V1 video, gap, image overlay, original audio, and A1 fixture", async () => {
    const tools = await resolveMediaToolPaths().catch(() => undefined)
    if (!tools) return
    const root = await temporaryRoot()
    const videoAPath = path.join(root, "video a.mp4")
    const videoBPath = path.join(root, "video b.mp4")
    const audioPath = path.join(root, "music.wav")
    const imagePath = path.join(root, "logo.png")
    const outputPath = path.join(root, "output.tmp.mp4")

    await runMediaTool(tools.ffmpeg, [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "color=c=red:s=160x90:r=24:d=2",
      "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=2",
      "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", videoAPath,
    ])
    await runMediaTool(tools.ffmpeg, [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "color=c=blue:s=160x90:r=24:d=2",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", videoBPath,
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

    const videoA = ref("video-a", "video")
    const videoB = ref("video-b", "video")
    const audio = ref("audio", "audio")
    const image = ref("image", "image")
    const timeline: CinemaTimelineDocument = {
      schemaVersion: 2,
      id: "timeline-1",
      projectID: "project-1",
      title: "Runner fixture",
      revision: 1,
      createdAt: now,
      updatedAt: now,
      settings: { width: 160, height: 90, frameRate: { numerator: 24, denominator: 1 }, sampleRate: 48_000, backgroundColor: "#101010" },
      tracks: [
        { id: "v1", kind: "video", title: "V1", order: 0, locked: false, muted: false, hidden: false },
        { id: "a1", kind: "audio", title: "A1", order: 1, locked: false, muted: false, hidden: false },
        { id: "o1", kind: "overlay", title: "O1", order: 2, locked: false, muted: false, hidden: false },
      ],
      clips: [
        { id: "v-a", trackID: "v1", kind: "video", title: "A", timelineStartUs: 0, durationUs: 1_000_000, playbackRate: 1, volume: 0.8, opacity: 1, fit: "contain", assetRef: videoA, sourceInUs: 500_000, sourceDurationUs: 1_000_000, createdAt: now, updatedAt: now },
        { id: "v-b", trackID: "v1", kind: "video", title: "B", timelineStartUs: 1_500_000, durationUs: 1_000_000, playbackRate: 2, volume: 1, opacity: 1, fit: "cover", assetRef: videoB, sourceInUs: 0, sourceDurationUs: 2_000_000, createdAt: now, updatedAt: now },
        { id: "a-1", trackID: "a1", kind: "audio", title: "Music", timelineStartUs: 0, durationUs: 2_500_000, playbackRate: 1, volume: 0.25, opacity: 1, assetRef: audio, sourceInUs: 0, sourceDurationUs: 2_500_000, fadeInUs: 100_000, fadeOutUs: 200_000, createdAt: now, updatedAt: now },
        { id: "i-1", trackID: "o1", kind: "image", title: "Logo", timelineStartUs: 500_000, durationUs: 1_000_000, playbackRate: 1, volume: 1, opacity: 0.5, fit: "contain", assetRef: image, sourceInUs: 0, sourceDurationUs: 1_000_000, createdAt: now, updatedAt: now },
      ],
      markers: [],
    }
    const plan = buildCinemaRenderPlan({
      timeline,
      settings,
      inputs: [
        { assetRef: videoA, filePath: videoAPath, hasAudio: true },
        { assetRef: videoB, filePath: videoBPath, hasAudio: false },
        { assetRef: audio, filePath: audioPath },
        { assetRef: image, filePath: imagePath },
      ],
      outputPath,
      videoEncoder: "libx264",
      audioEncoder: "aac",
    })
    const progress: number[] = []
    const probe = await runCinemaRenderPlan({
      ffmpegPath: tools.ffmpeg,
      ffprobePath: tools.ffprobe,
      outputPath,
      plan,
      settings,
      onProgress: (update) => progress.push(update.percent),
    })

    expect(probe).toMatchObject({
      width: 160,
      height: 90,
      fps: 24,
      videoCodec: "h264",
      audioCodec: "aac",
      hasAudio: true,
    })
    expect(probe.durationSeconds).toBeCloseTo(2.5, 1)
    expect(probe.sizeBytes).toBeGreaterThan(0)
    expect(progress.at(-1)).toBe(100)
  }, 30_000)

  test("cancels a running FFmpeg process and removes partial output", async () => {
    const tools = await resolveMediaToolPaths().catch(() => undefined)
    if (!tools) return
    const root = await temporaryRoot()
    const outputPath = path.join(root, "canceled.tmp.mp4")
    const controller = new AbortController()
    const plan = {
      args: [
        "-hide_banner", "-nostdin", "-re",
        "-f", "lavfi", "-i", "color=c=black:s=160x90:r=24:d=30",
        "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo:d=30",
        "-shortest", "-c:v", "libx264", "-c:a", "aac",
        "-progress", "pipe:1", "-nostats", "-y", outputPath,
      ],
      filterComplex: "",
      outputDurationUs: 30_000_000,
      mediaInputCount: 0,
      videoOutputLabel: "vout" as const,
      audioOutputLabel: "aout" as const,
    }
    setTimeout(() => controller.abort(), 150)
    const error = await runCinemaRenderPlan({
      ffmpegPath: tools.ffmpeg,
      ffprobePath: tools.ffprobe,
      outputPath,
      plan,
      settings: { ...settings, range: { type: "full" } },
      signal: controller.signal,
    }).catch((caught) => caught)

    expect(error).toBeInstanceOf(CinemaRenderRunnerError)
    expect(error.code).toBe("render-canceled")
    expect(access(outputPath)).rejects.toThrow()
  }, 10_000)

  test("force-kills a media child that ignores SIGTERM during Agent shutdown", async () => {
    const root = await temporaryRoot()
    const outputPath = path.join(root, "shutdown.tmp.mp4")
    const pidPath = path.join(root, "media-child.pid")
    const controller = new AbortController()
    const childScript = [
      `require("node:fs").writeFileSync(${JSON.stringify(pidPath)}, String(process.pid))`,
      `process.on("SIGTERM", () => undefined)`,
      `setInterval(() => undefined, 1_000)`,
    ].join(";")
    const running = runCinemaRenderPlan({
      ffmpegPath: process.execPath,
      ffprobePath: process.execPath,
      outputPath,
      plan: {
        args: ["-e", childScript],
        filterComplex: "",
        outputDurationUs: 30_000_000,
        mediaInputCount: 0,
        videoOutputLabel: "vout",
        audioOutputLabel: "aout",
      },
      settings,
      signal: controller.signal,
      shouldForceKillOnAbort: () => true,
    }).catch((caught) => caught)

    for (let attempt = 0; attempt < 200; attempt += 1) {
      if (await access(pidPath).then(() => true, () => false)) break
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    const childPID = Number.parseInt(await readFile(pidPath, "utf8"), 10)
    controller.abort()
    const error = await running

    expect(error).toBeInstanceOf(CinemaRenderRunnerError)
    expect(error.code).toBe("render-canceled")
    expect(() => process.kill(childPID, 0)).toThrow()
    expect(access(outputPath)).rejects.toThrow()
  }, 10_000)

  test("times out a long FFmpeg process and removes partial output", async () => {
    const tools = await resolveMediaToolPaths().catch(() => undefined)
    if (!tools) return
    const root = await temporaryRoot()
    const outputPath = path.join(root, "timed-out.tmp.mp4")
    const plan = {
      args: [
        "-hide_banner", "-nostdin", "-re",
        "-f", "lavfi", "-i", "color=c=black:s=160x90:r=24:d=30",
        "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo:d=30",
        "-shortest", "-c:v", "libx264", "-c:a", "aac",
        "-progress", "pipe:1", "-nostats", "-y", outputPath,
      ],
      filterComplex: "",
      outputDurationUs: 30_000_000,
      mediaInputCount: 0,
      videoOutputLabel: "vout" as const,
      audioOutputLabel: "aout" as const,
    }
    const error = await runCinemaRenderPlan({
      ffmpegPath: tools.ffmpeg,
      ffprobePath: tools.ffprobe,
      outputPath,
      plan,
      settings,
      timeoutMs: 100,
    }).catch((caught) => caught)

    expect(error).toBeInstanceOf(CinemaRenderRunnerError)
    expect(error.code).toBe("render-timeout")
    expect(access(outputPath)).rejects.toThrow()
  }, 10_000)

  test("removes a pre-existing partial output after FFmpeg failure without leaking its path", async () => {
    const tools = await resolveMediaToolPaths().catch(() => undefined)
    if (!tools) return
    const root = await temporaryRoot()
    const outputPath = path.join(root, "private partial.tmp.mp4")
    await writeFile(outputPath, "partial", "utf8")
    const error = await runCinemaRenderPlan({
      ffmpegPath: tools.ffmpeg,
      ffprobePath: tools.ffprobe,
      outputPath,
      plan: {
        args: ["-hide_banner", "-i", path.join(root, "secret missing.mp4"), "-y", outputPath],
        filterComplex: "",
        outputDurationUs: 1_000_000,
        mediaInputCount: 1,
        videoOutputLabel: "vout",
        audioOutputLabel: "aout",
      },
      settings,
    }).catch((caught) => caught)

    expect(error).toBeInstanceOf(CinemaRenderRunnerError)
    expect(error.code).toBe("render-failed")
    expect(error.message).not.toContain(root)
    expect(access(outputPath)).rejects.toThrow()
  })
})
