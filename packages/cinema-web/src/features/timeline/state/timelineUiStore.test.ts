/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it } from "vitest"
import { readCinemaTimelineUiSnapshot, writeCinemaTimelineUiSnapshot } from "./timelineUiStore"

beforeEach(() => localStorage.clear())

describe("timeline UI snapshots", () => {
  it("isolates and restores local UI state by project and Timeline", () => {
    writeCinemaTimelineUiSnapshot("p1", "t1", {
      playheadUs: 2_000_000,
      pixelsPerSecond: 72,
      previewPercent: 50,
      mediaOpen: false,
      inspectorOpen: true,
      snapEnabled: false,
      selectedClipID: "clip-1",
    })
    expect(readCinemaTimelineUiSnapshot("p1", "t1")).toMatchObject({ playheadUs: 2_000_000, selectedClipID: "clip-1" })
    expect(readCinemaTimelineUiSnapshot("p1", "t2").playheadUs).toBe(0)
  })

  it("falls back safely from corrupt storage", () => {
    localStorage.setItem("anybox:cinema:timeline-ui:p:t", "{")
    expect(readCinemaTimelineUiSnapshot("p", "t").pixelsPerSecond).toBe(48)
  })
})
