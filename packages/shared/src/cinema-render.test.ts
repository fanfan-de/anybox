import { describe, expect, it } from "vitest"

import {
  CINEMA_RENDER_STATUS_TRANSITIONS,
  CINEMA_RENDER_V1_SUPPORT_MATRIX,
  CinemaRenderExecutionRuntimeSchema,
  CinemaRenderJobEventSchema,
  CinemaRenderJobSchema,
  CinemaRenderOutputNameSchema,
  CinemaRenderPreflightResultSchema,
  CinemaRenderRuntimeStatusSchema,
  CinemaRenderSettingsSchema,
  CreateCinemaRenderJobBodySchema,
  canTransitionCinemaRenderJobStatus,
  cinemaRenderRangeFitsTimeline,
  getCinemaRenderV1Support,
  isCinemaRenderTerminalStatus,
} from "./cinema-render"

const now = "2026-07-10T12:00:00.000Z"

const executionRuntime = {
  runtimeID: "ffmpeg-win32-preview-1",
  ffmpegVersion: "N-125509-g8ad6288553",
  platform: "win32" as const,
  videoEncoder: "h264_mf" as const,
  audioEncoder: "aac" as const,
}

const settings = {
  format: "mp4" as const,
  videoCodec: "h264" as const,
  audioCodec: "aac" as const,
  width: 1920,
  height: 1080,
  frameRate: { numerator: 30_000, denominator: 1_001 },
  quality: { mode: "balanced" as const },
  audioBitrateKbps: 192 as const,
  range: { type: "full" as const },
  outputName: "Rough cut 01",
}

function outputAssetRef() {
  return {
    scope: { type: "project" as const, projectID: "project-1" },
    assetID: "asset-render-1",
    contentRevision: 0,
    snapshot: {
      kind: "video" as const,
      displayName: "Rough cut 01.mp4",
      mimeType: "video/mp4",
      width: 1920,
      height: 1080,
      durationSeconds: 5,
    },
  }
}

function renderJob(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    id: "render-job-1",
    projectID: "project-1",
    timelineID: "timeline-1",
    timelineRevision: 3,
    operationID: "render-operation-1",
    status: "queued",
    settings,
    progress: { phase: "queued" },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

describe("cinema render settings contracts", () => {
  it("accepts the V1 MP4 settings contract", () => {
    expect(CinemaRenderSettingsSchema.parse(settings)).toEqual(settings)
    expect(CinemaRenderSettingsSchema.parse({
      ...settings,
      quality: { mode: "target-bitrate", targetVideoBitrateKbps: 12_000 },
      range: { type: "custom", startUs: 1_000_000, endUs: 4_000_000 },
      outputName: "成片 第一版",
    })).toMatchObject({
      quality: { mode: "target-bitrate", targetVideoBitrateKbps: 12_000 },
    })
  })

  it.each([
    { width: 1919 },
    { height: 0 },
    { width: 7_682 },
    { frameRate: { numerator: 121, denominator: 1 } },
    { audioBitrateKbps: 160 },
  ])("rejects settings outside a bounded V1 profile: %o", (override) => {
    expect(() => CinemaRenderSettingsSchema.parse({ ...settings, ...override })).toThrow()
  })

  it("requires target bitrate only in target-bitrate mode", () => {
    expect(() => CinemaRenderSettingsSchema.parse({
      ...settings,
      quality: { mode: "balanced", targetVideoBitrateKbps: 8_000 },
    })).toThrow()
    expect(() => CinemaRenderSettingsSchema.parse({
      ...settings,
      quality: { mode: "target-bitrate" },
    })).toThrow()
    expect(() => CinemaRenderSettingsSchema.parse({
      ...settings,
      quality: { mode: "target-bitrate", targetVideoBitrateKbps: 100_001 },
    })).toThrow()
  })

  it("rejects empty or reversed custom ranges and checks the timeline boundary separately", () => {
    expect(() => CinemaRenderSettingsSchema.parse({
      ...settings,
      range: { type: "custom", startUs: 2_000_000, endUs: 2_000_000 },
    })).toThrow()
    expect(() => CinemaRenderSettingsSchema.parse({
      ...settings,
      range: { type: "custom", startUs: 3_000_000, endUs: 2_000_000 },
    })).toThrow()

    expect(cinemaRenderRangeFitsTimeline({ type: "full" }, 5_000_000)).toBe(true)
    expect(cinemaRenderRangeFitsTimeline(
      { type: "custom", startUs: 1_000_000, endUs: 5_000_000 },
      5_000_000,
    )).toBe(true)
    expect(cinemaRenderRangeFitsTimeline(
      { type: "custom", startUs: 1_000_000, endUs: 5_000_001 },
      5_000_000,
    )).toBe(false)
  })

  it.each([
    "../output",
    "folder/output",
    "folder\\output",
    "output.mp4",
    "output.exe",
    "CON",
    "LPT1",
    "trailing.",
  ])("rejects unsafe output name %s", (outputName) => {
    expect(() => CinemaRenderOutputNameSchema.parse(outputName)).toThrow()
  })

  it("normalizes harmless outer whitespace in output names", () => {
    expect(CinemaRenderOutputNameSchema.parse("  Final cut  ")).toBe("Final cut")
  })

  it("does not accept paths or unknown request fields", () => {
    expect(() => CreateCinemaRenderJobBodySchema.parse({
      operationID: "operation-1",
      expectedTimelineRevision: 3,
      settings,
      inputTimelinePath: "C:\\private\\timeline.json",
    })).toThrow()
    expect(() => CreateCinemaRenderJobBodySchema.parse({
      operationID: "operation/1",
      expectedTimelineRevision: 3,
      settings,
    })).toThrow()
  })
})

describe("cinema render preflight contracts", () => {
  const result = {
    timelineID: "timeline-1",
    timelineRevision: 3,
    checkedAt: now,
    ready: true,
    durationUs: 5_000_000,
    estimatedFrameCount: 150,
    estimatedInputBytes: 1_000_000,
    estimatedWorkingBytes: 5_000_000,
    issues: [],
    support: {
      videoClips: 2,
      audioClips: 1,
      imageClips: 1,
      textClips: 0,
    },
  }

  it("keeps ready consistent with blocking issues", () => {
    expect(CinemaRenderPreflightResultSchema.parse(result).ready).toBe(true)
    expect(() => CinemaRenderPreflightResultSchema.parse({
      ...result,
      issues: [{
        code: "asset-missing",
        severity: "error",
        message: "A source asset is missing",
        assetID: "asset-1",
      }],
    })).toThrow()
    expect(CinemaRenderPreflightResultSchema.parse({
      ...result,
      ready: false,
      issues: [{
        code: "asset-missing",
        severity: "error",
        message: "A source asset is missing",
        assetID: "asset-1",
      }],
    }).ready).toBe(false)
  })

  it("allows warnings without blocking delivery", () => {
    expect(CinemaRenderPreflightResultSchema.parse({
      ...result,
      issues: [{
        code: "working-space-insufficient",
        severity: "warning",
        message: "Available space is close to the estimate",
      }],
    }).ready).toBe(true)
  })
})

describe("cinema render job lifecycle", () => {
  it("exposes only the documented forward transitions", () => {
    expect(canTransitionCinemaRenderJobStatus("queued", "snapshotting")).toBe(true)
    expect(canTransitionCinemaRenderJobStatus("queued", "failed")).toBe(true)
    expect(canTransitionCinemaRenderJobStatus("queued", "canceled")).toBe(true)
    expect(canTransitionCinemaRenderJobStatus("rendering", "registering")).toBe(true)
    expect(canTransitionCinemaRenderJobStatus("rendering", "failed")).toBe(true)
    expect(canTransitionCinemaRenderJobStatus("succeeded", "queued")).toBe(false)
    expect(canTransitionCinemaRenderJobStatus("failed", "queued")).toBe(false)
    expect(isCinemaRenderTerminalStatus("interrupted")).toBe(true)
    expect(isCinemaRenderTerminalStatus("rendering")).toBe(false)
    expect([...CINEMA_RENDER_STATUS_TRANSITIONS.succeeded]).toHaveLength(0)
  })

  it("requires progress phase to match persisted status", () => {
    expect(CinemaRenderJobSchema.parse(renderJob()).status).toBe("queued")
    expect(CinemaRenderJobSchema.parse(renderJob({ executionRuntime }))).toMatchObject({ executionRuntime })
    expect(() => CinemaRenderJobSchema.parse(renderJob({
      status: "rendering",
      progress: { phase: "probing", percent: 10 },
    }))).toThrow()
  })

  it("requires terminal timestamps and status-specific payloads", () => {
    expect(CinemaRenderJobSchema.parse(renderJob({
      status: "succeeded",
      progress: { phase: "succeeded", percent: 100, renderedUs: 5_000_000 },
      outputAssetRef: outputAssetRef(),
      startedAt: now,
      finishedAt: now,
    }))).toMatchObject({ status: "succeeded" })

    expect(CinemaRenderJobSchema.parse(renderJob({
      status: "failed",
      progress: { phase: "failed" },
      error: { code: "render-failed", message: "Encoder exited", retryable: true },
      startedAt: now,
      finishedAt: now,
    }))).toMatchObject({ status: "failed" })

    expect(() => CinemaRenderJobSchema.parse(renderJob({
      status: "succeeded",
      progress: { phase: "succeeded", percent: 100 },
      finishedAt: now,
    }))).toThrow()
    expect(() => CinemaRenderJobSchema.parse(renderJob({
      status: "failed",
      progress: { phase: "failed" },
      finishedAt: now,
    }))).toThrow()
    expect(() => CinemaRenderJobSchema.parse(renderJob({ finishedAt: now }))).toThrow()
  })

  it("rejects private paths and command previews in persisted jobs", () => {
    expect(() => CinemaRenderJobSchema.parse(renderJob({
      inputTimelinePath: "C:\\private\\timeline.json",
    }))).toThrow()
    expect(() => CinemaRenderJobSchema.parse(renderJob({
      ffmpegCommandPreview: "ffmpeg -i private.mp4",
    }))).toThrow()
    expect(() => CinemaRenderExecutionRuntimeSchema.parse({
      ...executionRuntime,
      runtimeID: "C:\\private\\ffmpeg.exe",
    })).toThrow()
    expect(() => CinemaRenderExecutionRuntimeSchema.parse({
      ...executionRuntime,
      ffmpegVersion: "/private/ffmpeg",
    })).toThrow()
  })

  it("requires meaningful payloads on progress, failure, and success events", () => {
    const baseEvent = {
      schemaVersion: 1,
      id: "event-1",
      jobID: "render-job-1",
      createdAt: now,
    }
    expect(CinemaRenderJobEventSchema.parse({
      ...baseEvent,
      type: "runtime-bound",
      executionRuntime,
    })).toMatchObject({ type: "runtime-bound", executionRuntime })
    expect(() => CinemaRenderJobEventSchema.parse({
      ...baseEvent,
      type: "runtime-bound",
    })).toThrow()
    expect(CinemaRenderJobEventSchema.parse({
      ...baseEvent,
      type: "render-progress",
      progress: { phase: "rendering", percent: 50, renderedUs: 2_500_000 },
    }).type).toBe("render-progress")
    expect(() => CinemaRenderJobEventSchema.parse({
      ...baseEvent,
      type: "render-progress",
    })).toThrow()
    expect(() => CinemaRenderJobEventSchema.parse({
      ...baseEvent,
      type: "render-failed",
    })).toThrow()
    expect(() => CinemaRenderJobEventSchema.parse({
      ...baseEvent,
      type: "render-succeeded",
    })).toThrow()
  })
})

describe("cinema render V1 support and runtime contracts", () => {
  it("supports V1 video, A1 audio, and image overlays while blocking overlay video and text", () => {
    expect(getCinemaRenderV1Support("video", "video").level).toBe("supported")
    expect(getCinemaRenderV1Support("audio", "audio").level).toBe("supported")
    expect(getCinemaRenderV1Support("overlay", "image").level).toBe("supported")
    expect(getCinemaRenderV1Support("overlay", "video")).toMatchObject({ level: "blocked" })
    expect(getCinemaRenderV1Support("overlay", "text")).toMatchObject({ level: "blocked" })
    expect(CINEMA_RENDER_V1_SUPPORT_MATRIX.overlay.text.reason).toBeTruthy()
  })

  it("returns a redacted render runtime capability shape", () => {
    expect(CinemaRenderRuntimeStatusSchema.parse({
      available: true,
      version: "7.1.1",
      platform: "win32",
      ffprobeAvailable: true,
      videoEncoders: ["libx264", "h264_mf"],
      audioEncoders: ["aac"],
    }).available).toBe(true)
    expect(() => CinemaRenderRuntimeStatusSchema.parse({
      available: true,
      version: "7.1.1",
      platform: "win32",
      ffprobeAvailable: true,
      videoEncoders: ["libx264"],
      audioEncoders: ["aac"],
      binaryPath: "C:\\private\\ffmpeg.exe",
    })).toThrow()
    expect(() => CinemaRenderRuntimeStatusSchema.parse({
      available: false,
      platform: "linux",
      ffprobeAvailable: false,
      videoEncoders: [],
      audioEncoders: [],
    })).toThrow()
  })
})
