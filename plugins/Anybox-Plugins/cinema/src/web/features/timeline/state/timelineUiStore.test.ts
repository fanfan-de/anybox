/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readCinemaTimelineUiSnapshot, writeCinemaTimelineUiSnapshot } from "./timelineUiStore"

beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe("timeline UI snapshots", () => {
  it("isolates and restores local UI state by project and Timeline", () => {
    writeCinemaTimelineUiSnapshot("p1", "t1", {
      playheadUs: 2_000_000,
      pixelsPerSecond: 72,
      previewPercent: 50,
      mediaOpen: false,
      inspectorOpen: true,
      snapEnabled: false,
      selectedClipIDs: ["clip-1", "clip-2"],
      scrollLeftPx: 320,
      scrollTopPx: 48,
      trackHeightsPx: { "track-v1": 128 },
      collapsedTrackIDs: ["track-a1"],
    followPlayhead: false,
    activeSubtitleTrackID: "subtitle-track",
    })
    expect(readCinemaTimelineUiSnapshot("p1", "t1")).toMatchObject({
      playheadUs: 2_000_000,
      selectedClipIDs: ["clip-1", "clip-2"],
      scrollLeftPx: 320,
      scrollTopPx: 48,
      trackHeightsPx: { "track-v1": 128 },
      collapsedTrackIDs: ["track-a1"],
      followPlayhead: false,
    })
    expect(readCinemaTimelineUiSnapshot("p1", "t2").playheadUs).toBe(0)
  })

  it("falls back safely from corrupt storage", () => {
    localStorage.setItem("anybox:cinema:timeline-ui:p:t", "{")
    expect(readCinemaTimelineUiSnapshot("p", "t").pixelsPerSecond).toBe(48)
  })

  it("migrates the legacy single selected Clip ID", () => {
    localStorage.setItem("anybox:cinema:timeline-ui:p:t", JSON.stringify({ selectedClipID: "legacy-clip" }))
    expect(readCinemaTimelineUiSnapshot("p", "t").selectedClipIDs).toEqual(["legacy-clip"])
  })

  it("sanitizes invalid scroll positions", () => {
    localStorage.setItem("anybox:cinema:timeline-ui:p:t", JSON.stringify({ scrollLeftPx: -10, scrollTopPx: "20" }))
    expect(readCinemaTimelineUiSnapshot("p", "t")).toMatchObject({ scrollLeftPx: 0, scrollTopPx: 0 })
  })

  it("sanitizes track layout state", () => {
    localStorage.setItem("anybox:cinema:timeline-ui:p:t", JSON.stringify({
      trackHeightsPx: { valid: 96, tooSmall: 20, text: "100" },
      collapsedTrackIDs: ["a", "a", 2],
    }))
    expect(readCinemaTimelineUiSnapshot("p", "t")).toMatchObject({
      trackHeightsPx: { valid: 96 },
      collapsedTrackIDs: ["a"],
    })
  })

  it("does not surface storage quota or privacy-mode failures", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Storage is unavailable", "QuotaExceededError")
    })

    expect(writeCinemaTimelineUiSnapshot("p", "t", {
      playheadUs: 0,
      pixelsPerSecond: 48,
      previewPercent: 42,
      mediaOpen: true,
      inspectorOpen: true,
      snapEnabled: true,
      selectedClipIDs: [],
      scrollLeftPx: 0,
      scrollTopPx: 0,
      trackHeightsPx: {},
      collapsedTrackIDs: [],
      followPlayhead: true,
      activeSubtitleTrackID: null,
    })).toBe(false)
  })
})
