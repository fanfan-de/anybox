import { describe, expect, test } from "bun:test"

import type { CinemaAssetRecord, CinemaAssetRef } from "@anybox/shared/cinema"
import type {
  CinemaRenderRuntimeStatus,
  CinemaRenderSettings,
} from "@anybox/shared/cinema-render"
import type { CinemaTimelineDocument } from "@anybox/shared/cinema-timeline"

import {
  defaultCinemaRenderSettings,
  preflightCinemaRender,
  setCinemaRenderPreflightDependenciesForTesting,
} from "../src/cinema/render-preflight"

const now = "2026-07-10T12:00:00.000Z"

function ref(
  assetID: string,
  kind: "video" | "audio" | "image",
  scope: CinemaAssetRef["scope"] = { type: "project", projectID: "project-1" },
): CinemaAssetRef {
  return {
    scope,
    assetID,
    contentRevision: 2,
    snapshot: {
      kind,
      displayName: assetID,
      mimeType: kind === "video" ? "video/mp4" : kind === "audio" ? "audio/wav" : "image/png",
      ...(kind === "image" ? { width: 100, height: 100 } : { durationSeconds: 5 }),
    },
  }
}

function record(assetRef: CinemaAssetRef, overrides: Partial<CinemaAssetRecord> = {}): CinemaAssetRecord {
  return {
    id: assetRef.assetID,
    folderID: "sources",
    relativePath: `sources/${assetRef.assetID}.bin`,
    displayName: assetRef.snapshot.displayName,
    kind: assetRef.snapshot.kind,
    source: "upload",
    status: "ready",
    mimeType: assetRef.snapshot.mimeType,
    sizeBytes: 1_000,
    checksum: `checksum-${assetRef.assetID}`,
    contentRevision: assetRef.contentRevision,
    createdAt: now,
    updatedAt: now,
    ...(assetRef.snapshot.durationSeconds === undefined
      ? {}
      : { durationSeconds: assetRef.snapshot.durationSeconds }),
    ...overrides,
  }
}

function timeline(extraClips: CinemaTimelineDocument["clips"] = []): CinemaTimelineDocument {
  const videoRef = ref("video-1", "video")
  return {
    schemaVersion: 2,
    id: "timeline-1",
    projectID: "project-1",
    title: "Rough cut",
    revision: 4,
    createdAt: now,
    updatedAt: now,
    settings: {
      width: 1920,
      height: 1080,
      frameRate: { numerator: 30_000, denominator: 1_001 },
      sampleRate: 48_000,
      backgroundColor: "#000000",
    },
    tracks: [
      { id: "v1", kind: "video", title: "V1", order: 0, locked: false, muted: false, hidden: false },
      { id: "a1", kind: "audio", title: "A1", order: 1, locked: false, muted: false, hidden: false },
      { id: "o1", kind: "overlay", title: "O1", order: 2, locked: false, muted: false, hidden: false },
    ],
    clips: [{
      id: "video-clip",
      trackID: "v1",
      kind: "video",
      title: "Main video",
      timelineStartUs: 0,
      durationUs: 5_000_000,
      playbackRate: 1,
      volume: 1,
      opacity: 1,
      assetRef: videoRef,
      sourceInUs: 0,
      sourceDurationUs: 5_000_000,
      createdAt: now,
      updatedAt: now,
    }, ...extraClips],
    markers: [],
  }
}

const runtime: CinemaRenderRuntimeStatus = {
  available: true,
  version: "7.1.1",
  platform: "win32",
  ffprobeAvailable: true,
  videoEncoders: ["libx264"],
  audioEncoders: ["aac"],
}

function dependencies(records: Map<string, CinemaAssetRecord>, overrides: Record<string, unknown> = {}) {
  return {
    getCinemaAsset: async (_scope: CinemaAssetRef["scope"], assetID: string) => {
      const asset = records.get(assetID)
      if (!asset) throw new Error("missing")
      return { revision: 1, asset }
    },
    getCinemaRenderRuntimeStatus: async () => runtime,
    getAvailableBytes: async () => 10_000_000_000,
    now: () => now,
    ...overrides,
  }
}

function recordsFor(source: CinemaTimelineDocument) {
  const records = new Map<string, CinemaAssetRecord>()
  for (const clip of source.clips) {
    if ("assetRef" in clip) records.set(clip.assetRef.assetID, record(clip.assetRef))
  }
  return records
}

describe("Cinema render preflight", () => {
  test("supports a scoped production-path free-space override for deterministic ENOSPC preflight", async () => {
    const source = timeline()
    const restore = setCinemaRenderPreflightDependenciesForTesting(
      dependencies(recordsFor(source), { getAvailableBytes: async () => 0 }),
    )
    try {
      const result = await preflightCinemaRender({
        cinemaRoot: "C:/cinema",
        projectID: "project-1",
        timeline: source,
        settings: defaultCinemaRenderSettings(source),
      })
      expect(result.ready).toBe(false)
      expect(result.issues).toContainEqual(expect.objectContaining({
        code: "working-space-insufficient",
        severity: "error",
      }))
    } finally {
      restore()
    }
  })

  test("accepts the V1 video/audio/image matrix and reports personal copy warnings", async () => {
    const audioRef = ref("audio-1", "audio", { type: "personal" })
    const imageRef = ref("image-1", "image")
    const source = timeline([
      {
        id: "audio-clip",
        trackID: "a1",
        kind: "audio",
        title: "Music",
        timelineStartUs: 0,
        durationUs: 5_000_000,
        playbackRate: 1,
        volume: 1,
        opacity: 1,
        assetRef: audioRef,
        sourceInUs: 0,
        sourceDurationUs: 5_000_000,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "image-clip",
        trackID: "o1",
        kind: "image",
        title: "Logo",
        timelineStartUs: 1_000_000,
        durationUs: 2_000_000,
        playbackRate: 1,
        volume: 1,
        opacity: 1,
        assetRef: imageRef,
        sourceInUs: 0,
        sourceDurationUs: 2_000_000,
        createdAt: now,
        updatedAt: now,
      },
    ])
    const result = await preflightCinemaRender({
      cinemaRoot: "C:/cinema",
      projectID: "project-1",
      timeline: source,
      settings: defaultCinemaRenderSettings(source),
      dependencies: dependencies(recordsFor(source)),
    })

    expect(result.ready).toBe(true)
    expect(result.support).toEqual({ videoClips: 1, audioClips: 1, imageClips: 1, textClips: 0 })
    expect(result.issues).toEqual([expect.objectContaining({
      code: "personal-asset-copy-required",
      severity: "warning",
      assetID: "audio-1",
    })])
    expect(result.estimatedInputBytes).toBe(3_000)
    expect(result.estimatedFrameCount).toBe(150)
  })

  test("blocks unsupported visible overlay video and text but ignores hidden tracks", async () => {
    const overlayVideo = ref("overlay-video", "video")
    const source = timeline([{
      id: "overlay-video-clip",
      trackID: "o1",
      kind: "video",
      title: "Overlay video",
      timelineStartUs: 0,
      durationUs: 2_000_000,
      playbackRate: 1,
      volume: 1,
      opacity: 1,
      assetRef: overlayVideo,
      sourceInUs: 0,
      sourceDurationUs: 2_000_000,
      createdAt: now,
      updatedAt: now,
    }, {
      id: "text-clip",
      trackID: "o1",
      kind: "text",
      title: "Title",
      timelineStartUs: 2_000_000,
      durationUs: 1_000_000,
      playbackRate: 1,
      volume: 1,
      opacity: 1,
      text: { value: "Title", stylePresetID: "default" },
      createdAt: now,
      updatedAt: now,
    }])
    const blocked = await preflightCinemaRender({
      cinemaRoot: "C:/cinema",
      projectID: "project-1",
      timeline: source,
      settings: defaultCinemaRenderSettings(source),
      dependencies: dependencies(recordsFor(source)),
    })
    expect(blocked.ready).toBe(false)
    expect(blocked.issues.filter((item) => item.code === "clip-unsupported")).toHaveLength(2)

    const hidden = {
      ...source,
      tracks: source.tracks.map((track) => track.id === "o1" ? { ...track, hidden: true } : track),
    }
    const hiddenResult = await preflightCinemaRender({
      cinemaRoot: "C:/cinema",
      projectID: "project-1",
      timeline: hidden,
      settings: defaultCinemaRenderSettings(hidden),
      dependencies: dependencies(recordsFor(hidden)),
    })
    expect(hiddenResult.ready).toBe(true)
  })

  test("returns structured asset status, revision, kind, scope, and source-range issues", async () => {
    const source = timeline()
    const videoRef = (source.clips[0] as Extract<CinemaTimelineDocument["clips"][number], { kind: "video" }>).assetRef
    const variants: Array<[Partial<CinemaAssetRecord>, string]> = [
      [{ status: "missing" }, "asset-missing"],
      [{ status: "trashed" }, "asset-trashed"],
      [{ status: "processing" }, "asset-not-ready"],
      [{ contentRevision: 9 }, "asset-revision-stale"],
      [{ kind: "audio" }, "asset-kind-mismatch"],
      [{ durationSeconds: 1 }, "asset-source-range-invalid"],
    ]
    for (const [override, code] of variants) {
      const result = await preflightCinemaRender({
        cinemaRoot: "C:/cinema",
        projectID: "project-1",
        timeline: source,
        settings: defaultCinemaRenderSettings(source),
        dependencies: dependencies(new Map([[videoRef.assetID, record(videoRef, override)]])),
      })
      expect(result.issues.some((item) => item.code === code)).toBe(true)
      expect(result.ready).toBe(false)
    }

    const wrongScope = {
      ...source,
      clips: source.clips.map((clip) => "assetRef" in clip ? {
        ...clip,
        assetRef: { ...clip.assetRef, scope: { type: "project" as const, projectID: "other" } },
      } : clip),
    }
    const result = await preflightCinemaRender({
      cinemaRoot: "C:/cinema",
      projectID: "project-1",
      timeline: wrongScope,
      settings: defaultCinemaRenderSettings(wrongScope),
      dependencies: dependencies(recordsFor(wrongScope)),
    })
    expect(result.issues.some((item) => item.code === "asset-scope-mismatch")).toBe(true)
  })

  test("blocks unavailable encoders, insufficient disk, and invalid custom ranges", async () => {
    const source = timeline()
    const settings: CinemaRenderSettings = {
      ...defaultCinemaRenderSettings(source),
      range: { type: "custom", startUs: 4_500_000, endUs: 5_000_001 },
    }
    const result = await preflightCinemaRender({
      cinemaRoot: "C:/cinema",
      projectID: "project-1",
      timeline: source,
      settings,
      dependencies: dependencies(recordsFor(source), {
        getCinemaRenderRuntimeStatus: async () => ({
          available: true,
          platform: "win32",
          ffprobeAvailable: true,
          videoEncoders: [],
          audioEncoders: [],
        }),
        getAvailableBytes: async () => 1,
      }),
    })
    expect(result.ready).toBe(false)
    expect(result.issues.map((item) => item.code)).toEqual(expect.arrayContaining([
      "render-settings-invalid",
      "video-encoder-unavailable",
      "audio-encoder-unavailable",
      "working-space-insufficient",
    ]))
  })

  test("blocks empty timelines and ranges with no visible main video", async () => {
    const source = { ...timeline(), clips: [] }
    const result = await preflightCinemaRender({
      cinemaRoot: "C:/cinema",
      projectID: "project-1",
      timeline: source,
      settings: defaultCinemaRenderSettings(source),
      dependencies: dependencies(new Map()),
    })
    expect(result.ready).toBe(false)
    expect(result.issues.map((item) => item.code)).toEqual(expect.arrayContaining([
      "timeline-empty",
      "main-video-missing",
    ]))
  })

  test("requires a valid non-empty subtitle track and reviewed libass runtime", async () => {
    const source = timeline()
    source.tracks.push({
      id: "s1", kind: "subtitle", title: "S1", order: 3, locked: false, hidden: false,
      language: "zh-CN", role: "subtitle",
      style: { fontFamilyID: "anybox-subtitle-sans-v1", fontSizePx: 52, textColor: "#FFFFFFFF", outlineColor: "#000000FF", outlineWidthPx: 2, backgroundColor: "#00000000", alignment: "bottom-center", marginBottomPx: 64 },
    })
    source.clips.push({ id: "cue-1", trackID: "s1", kind: "subtitle", timelineStartUs: 0, durationUs: 300_000, cueText: "中文 subtitle", createdAt: now, updatedAt: now })
    const settings = { ...defaultCinemaRenderSettings(source), subtitles: { mode: "burn-in" as const, trackID: "s1" } }
    const blocked = await preflightCinemaRender({ cinemaRoot: "C:/cinema", projectID: "project-1", timeline: source, settings, dependencies: dependencies(recordsFor(source)) })
    expect(blocked.issues.map((item) => item.code)).toEqual(expect.arrayContaining(["subtitle-runtime-unavailable", "subtitle-quality-warning"]))
    const ready = await preflightCinemaRender({
      cinemaRoot: "C:/cinema", projectID: "project-1", timeline: source, settings,
      dependencies: dependencies(recordsFor(source), { getCinemaRenderRuntimeStatus: async () => ({ ...runtime, subtitleRenderer: "libass" }) }),
    })
    expect(ready.issues.some((item) => item.code === "subtitle-runtime-unavailable")).toBe(false)
  })
})
