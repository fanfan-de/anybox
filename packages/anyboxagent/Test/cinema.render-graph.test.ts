import { describe, expect, test } from "bun:test"

import type { CinemaAssetRef } from "@anybox/shared/cinema"
import type { CinemaRenderSettings } from "@anybox/shared/cinema-render"
import type { CinemaTimelineDocument } from "@anybox/shared/cinema-timeline"
import {
  buildCinemaRenderPlan,
  cinemaRenderGraphInternals,
  type CinemaRenderResolvedInput,
} from "../src/cinema/render-graph"

const now = "2026-07-10T12:00:00.000Z"

function ref(assetID: string, kind: "video" | "audio" | "image"): CinemaAssetRef {
  return {
    scope: { type: "project", projectID: "project-1" },
    assetID,
    contentRevision: 1,
    snapshot: {
      kind,
      displayName: assetID,
      mimeType: kind === "video" ? "video/mp4" : kind === "audio" ? "audio/wav" : "image/png",
      ...(kind === "image" ? { width: 100, height: 100 } : { durationSeconds: 10 }),
    },
  }
}

const videoA = ref("video-a", "video")
const videoB = ref("video-b", "video")
const music = ref("music", "audio")
const logo = ref("logo", "image")

function timeline(): CinemaTimelineDocument {
  return {
    schemaVersion: 1,
    id: "timeline-1",
    projectID: "project-1",
    title: "Render graph",
    revision: 1,
    createdAt: now,
    updatedAt: now,
    settings: {
      width: 1920,
      height: 1080,
      frameRate: { numerator: 24, denominator: 1 },
      sampleRate: 48_000,
      backgroundColor: "#112233",
    },
    tracks: [
      { id: "v1", kind: "video", title: "V1", order: 0, locked: false, muted: false, hidden: false },
      { id: "a1", kind: "audio", title: "A1", order: 1, locked: false, muted: false, hidden: false },
      { id: "o1", kind: "overlay", title: "O1", order: 2, locked: false, muted: false, hidden: false },
    ],
    // Deliberately put the overlay first to prove visual layering is based on
    // track semantics rather than document array order.
    clips: [
      {
        id: "logo-clip",
        trackID: "o1",
        kind: "image",
        title: "Logo",
        timelineStartUs: 1_000_000,
        durationUs: 2_000_000,
        playbackRate: 1,
        volume: 1,
        opacity: 0.75,
        fit: "contain",
        assetRef: logo,
        sourceInUs: 0,
        sourceDurationUs: 2_000_000,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "video-a-clip",
        trackID: "v1",
        kind: "video",
        title: "Video A",
        timelineStartUs: 0,
        durationUs: 2_000_000,
        playbackRate: 1,
        volume: 0.8,
        opacity: 1,
        fit: "cover",
        assetRef: videoA,
        sourceInUs: 500_000,
        sourceDurationUs: 2_000_000,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "video-b-clip",
        trackID: "v1",
        kind: "video",
        title: "Video B",
        timelineStartUs: 3_000_000,
        durationUs: 2_000_000,
        playbackRate: 2,
        volume: 1,
        opacity: 1,
        fit: "contain",
        assetRef: videoB,
        sourceInUs: 0,
        sourceDurationUs: 4_000_000,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "music-clip",
        trackID: "a1",
        kind: "audio",
        title: "Music",
        timelineStartUs: 500_000,
        durationUs: 4_000_000,
        playbackRate: 1,
        volume: 0.5,
        opacity: 1,
        assetRef: music,
        sourceInUs: 1_000_000,
        sourceDurationUs: 4_000_000,
        fadeInUs: 250_000,
        fadeOutUs: 500_000,
        createdAt: now,
        updatedAt: now,
      },
    ],
    markers: [],
  }
}

function settings(): CinemaRenderSettings {
  return {
    format: "mp4",
    videoCodec: "h264",
    audioCodec: "aac",
    width: 1280,
    height: 720,
    frameRate: { numerator: 24, denominator: 1 },
    quality: { mode: "balanced" },
    audioBitrateKbps: 192,
    range: { type: "full" },
    outputName: "Render graph",
  }
}

function inputs(): CinemaRenderResolvedInput[] {
  return [
    { assetRef: videoA, filePath: "C:/sandbox/video-a_1.mp4", hasAudio: true },
    { assetRef: videoB, filePath: "C:/sandbox/video-b_1.mp4", hasAudio: false },
    { assetRef: music, filePath: "C:/sandbox/music_1.wav" },
    { assetRef: logo, filePath: "C:/sandbox/logo_1.png" },
  ]
}

describe("Cinema FFmpeg render graph", () => {
  test("builds video gaps, fit modes, image overlay, original audio, and A1 mix", () => {
    const plan = buildCinemaRenderPlan({
      timeline: timeline(),
      settings: settings(),
      inputs: inputs(),
      outputPath: "C:/sandbox/output.tmp.mp4",
      videoEncoder: "libx264",
      audioEncoder: "aac",
    })

    expect(plan.outputDurationUs).toBe(5_000_000)
    expect(plan.mediaInputCount).toBe(4)
    expect(plan.args.slice(0, 5)).toEqual([
      "-hide_banner", "-nostdin", "-f", "lavfi",
      "-i",
    ])
    expect(plan.args).toEqual(expect.arrayContaining([
      "C:/sandbox/video-a_1.mp4",
      "C:/sandbox/video-b_1.mp4",
      "C:/sandbox/music_1.wav",
      "C:/sandbox/logo_1.png",
      "-c:v", "libx264",
      "-c:a", "aac",
      "-progress", "pipe:1",
    ]))
    expect(plan.filterComplex).toContain("colorchannelmixer=aa=0.75")
    expect(plan.filterComplex).toContain("scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720")
    expect(plan.filterComplex).toContain("scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720")
    expect(plan.filterComplex).toContain("enable='between(t,0,2)'")
    expect(plan.filterComplex).toContain("enable='between(t,3,5)'")
    expect(plan.filterComplex.indexOf("enable='between(t,0,2)'")).toBeLessThan(
      plan.filterComplex.indexOf("enable='between(t,1,3)'"),
    )
    expect(plan.filterComplex).toContain("[2:a]atrim=start=0.5:duration=2")
    expect(plan.filterComplex).toContain("[4:a]atrim=start=1:duration=4")
    expect(plan.filterComplex).toContain("afade=t=in:st=0:d=0.25")
    expect(plan.filterComplex).toContain("afade=t=out:st=3.5:d=0.5")
    expect(plan.filterComplex).toContain("amix=inputs=3:duration=longest:normalize=0")
  })

  test("trims the final video and audio to a custom integer-microsecond range", () => {
    const custom = {
      ...settings(),
      range: { type: "custom" as const, startUs: 1_250_000, endUs: 4_750_000 },
    }
    const plan = buildCinemaRenderPlan({
      timeline: timeline(),
      settings: custom,
      inputs: inputs(),
      outputPath: "output.mp4",
      videoEncoder: "h264_mf",
      audioEncoder: "aac",
    })
    expect(plan.outputDurationUs).toBe(3_500_000)
    expect(plan.filterComplex).toContain("trim=start=1.25:end=4.75")
    expect(plan.filterComplex).toContain("atrim=start=1.25:end=4.75")
    expect(plan.args).toEqual(expect.arrayContaining(["-b:v", "8000k"]))
    expect(plan.args).not.toContain("-crf")
  })

  test("decomposes playback rates to FFmpeg atempo's supported range", () => {
    expect(cinemaRenderGraphInternals.atempoFilters(4)).toEqual(["atempo=2", "atempo=2"])
    expect(cinemaRenderGraphInternals.atempoFilters(0.25)).toEqual(["atempo=0.5", "atempo=0.5"])
    expect(cinemaRenderGraphInternals.atempoFilters(1.25)).toEqual(["atempo=1.25"])
  })

  test("omits audio from muted tracks while retaining their visual output", () => {
    const source = timeline()
    source.tracks = source.tracks.map((track) => track.id === "v1" || track.id === "a1"
      ? { ...track, muted: true }
      : track)
    const plan = buildCinemaRenderPlan({
      timeline: source,
      settings: settings(),
      inputs: inputs(),
      outputPath: "output.mp4",
      videoEncoder: "libx264",
      audioEncoder: "aac",
    })
    expect(plan.filterComplex).not.toContain("[2:a]")
    expect(plan.filterComplex).not.toContain("[4:a]")
    expect(plan.filterComplex).toContain("amix=inputs=1")
    expect(plan.filterComplex).toContain("enable='between(t,0,2)'")
  })

  test("applies lower-order overlay tracks last so Preview and Deliver share stacking semantics", () => {
    const source = timeline()
    source.tracks.push({ id: "o2", kind: "overlay", title: "O2", order: 3, locked: false, muted: false, hidden: false })
    source.clips.push({
      ...source.clips[0]!,
      id: "logo-bottom-clip",
      trackID: "o2",
      title: "Logo bottom",
    })
    const plan = buildCinemaRenderPlan({
      timeline: source,
      settings: settings(),
      inputs: inputs(),
      outputPath: "output.mp4",
      videoEncoder: "libx264",
      audioEncoder: "aac",
    })
    expect(plan.filterComplex.indexOf("[5:v]")).toBeLessThan(plan.filterComplex.indexOf("[1:v]"))
  })

  test("applies stretch, opacity, scale, rotation, position, and anchor transforms", () => {
    const source = timeline()
    source.clips = source.clips.map((clip) => clip.id === "logo-clip" ? {
      ...clip,
      fit: "stretch" as const,
      transform: { x: 120, y: -60, scale: 1.25, rotationDegrees: 15, anchorX: 0.25, anchorY: 0.75 },
    } : clip)
    const plan = buildCinemaRenderPlan({
      timeline: source,
      settings: settings(),
      inputs: inputs(),
      outputPath: "output.mp4",
      videoEncoder: "libx264",
      audioEncoder: "aac",
    })
    expect(plan.filterComplex).toContain("scale=1280:720,format=rgba,scale=iw*1.25:ih*1.25")
    expect(plan.filterComplex).toContain("rotate=15*PI/180")
    expect(plan.filterComplex).toContain("x='440-overlay_w*0.25'")
    expect(plan.filterComplex).toContain("y='480-overlay_h*0.75'")
    expect(plan.filterComplex).toContain("colorchannelmixer=aa=0.75")
  })

  test("rejects filter injection, missing inputs, unsupported text, and out-of-range output", () => {
    const unsafe = timeline()
    unsafe.settings.backgroundColor = "black;movie=secret"
    expect(() => buildCinemaRenderPlan({
      timeline: unsafe,
      settings: settings(),
      inputs: inputs(),
      outputPath: "output.mp4",
      videoEncoder: "libx264",
      audioEncoder: "aac",
    })).toThrow("not safe")

    expect(() => buildCinemaRenderPlan({
      timeline: timeline(),
      settings: settings(),
      inputs: inputs().filter((input) => input.assetRef.assetID !== "video-a"),
      outputPath: "output.mp4",
      videoEncoder: "libx264",
      audioEncoder: "aac",
    })).toThrow("missing")

    const text = timeline()
    text.clips.push({
      id: "text",
      trackID: "o1",
      kind: "text",
      title: "Text",
      timelineStartUs: 4_000_000,
      durationUs: 1_000_000,
      playbackRate: 1,
      volume: 1,
      opacity: 1,
      text: { value: "Title", stylePresetID: "default" },
      createdAt: now,
      updatedAt: now,
    })
    expect(() => buildCinemaRenderPlan({
      timeline: text,
      settings: settings(),
      inputs: inputs(),
      outputPath: "output.mp4",
      videoEncoder: "libx264",
      audioEncoder: "aac",
    })).toThrow("Text rendering")

    expect(() => buildCinemaRenderPlan({
      timeline: timeline(),
      settings: { ...settings(), range: { type: "custom", startUs: 0, endUs: 5_000_001 } },
      inputs: inputs(),
      outputPath: "output.mp4",
      videoEncoder: "libx264",
      audioEncoder: "aac",
    })).toThrow("exceeds")
  })
})
