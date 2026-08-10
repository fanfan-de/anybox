import { describe, expect, test } from "bun:test"
import { CinemaTimelineDocumentSchema } from "@anybox/cinema-plugin/contracts/timeline"
import { CinemaRenderSettingsSchema } from "@anybox/cinema-plugin/contracts/render"
import { escapeCinemaAssText, generateCinemaSubtitleAss } from "../src/domain/render-subtitles"

const timeline = CinemaTimelineDocumentSchema.parse({
  schemaVersion: 2,
  id: "timeline-1",
  projectID: "project-1",
  title: "Subtitles",
  revision: 1,
  settings: { width: 1920, height: 1080, frameRate: { numerator: 24, denominator: 1 }, sampleRate: 48_000, backgroundColor: "#000000" },
  tracks: [{
    id: "s1", kind: "subtitle", title: "S1", order: 0, locked: false, hidden: false,
    language: "zh-CN", role: "subtitle",
    style: { fontFamilyID: "anybox-subtitle-sans-v1", fontSizePx: 52, textColor: "#FFFFFFFF", outlineColor: "#000000FF", outlineWidthPx: 2, backgroundColor: "#00000000", alignment: "bottom-center", marginBottomPx: 64 },
  }],
  clips: [{ id: "cue-1", trackID: "s1", kind: "subtitle", timelineStartUs: 1_230_000, durationUs: 2_000_000, cueText: "你好\n{\\bord20} Hello", speaker: "旁白", createdAt: "2026-07-12T00:00:00.000Z", updatedAt: "2026-07-12T00:00:00.000Z" }],
  markers: [],
  createdAt: "2026-07-12T00:00:00.000Z",
  updatedAt: "2026-07-12T00:00:00.000Z",
})

const settings = CinemaRenderSettingsSchema.parse({
  format: "mp4", videoCodec: "h264", audioCodec: "aac", width: 1280, height: 720,
  frameRate: { numerator: 24, denominator: 1 }, quality: { mode: "balanced" }, audioBitrateKbps: 192,
  range: { type: "full" }, outputName: "subtitles", subtitles: { mode: "burn-in", trackID: "s1" },
})

describe("Cinema subtitle ASS", () => {
  test("scales the track style and safely escapes cue overrides", () => {
    const ass = generateCinemaSubtitleAss({ timeline, settings, trackID: "s1" })
    expect(ass).toContain("PlayResX: 1280")
    expect(ass).toContain("PlayResY: 720")
    expect(ass).toContain("Style: Cinema,Noto Sans CJK SC,34.67")
    expect(ass).toContain("旁白: 你好\\N\\{\\\\bord20\\} Hello")
    expect(ass).not.toContain("{\\bord20}")
  })

  test("escapes backslashes, braces, and both newline forms", () => {
    expect(escapeCinemaAssText("a\\b{c}\r\nd")).toBe("a\\\\b\\{c\\}\\Nd")
  })
})
