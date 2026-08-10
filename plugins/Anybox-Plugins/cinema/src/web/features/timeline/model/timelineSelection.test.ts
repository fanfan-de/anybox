import { describe, expect, it } from "vitest"
import type { CinemaTimelineDocument } from "@anybox/cinema-plugin/contracts/timeline"
import {
  orderedTimelineClipIDs,
  reconcileTimelineClipSelection,
  timelineClipSelectionRects,
  timelineMarqueeSelectedClipIDs,
  toggleTimelineClipSelection,
} from "./timelineSelection"

const document = {
  tracks: [
    { id: "v1", order: 0 },
    { id: "a1", order: 1 },
  ],
  clips: [
    { id: "clip-1", trackID: "v1", timelineStartUs: 0, durationUs: 2_000_000 },
    { id: "clip-2", trackID: "a1", timelineStartUs: 3_000_000, durationUs: 1_000_000 },
  ],
} as CinemaTimelineDocument

describe("timeline selection", () => {
  it("keeps IDs unique and preserves toggle order", () => {
    expect(orderedTimelineClipIDs(["clip-1", "clip-1", "", "clip-2"]))
      .toEqual(["clip-1", "clip-2"])
    expect(toggleTimelineClipSelection(["clip-1"], "clip-2"))
      .toEqual(["clip-1", "clip-2"])
    expect(toggleTimelineClipSelection(["clip-1", "clip-2"], "clip-1"))
      .toEqual(["clip-2"])
  })

  it("drops deleted Clip IDs when the document changes", () => {
    expect(reconcileTimelineClipSelection(["missing", "clip-2"], document))
      .toEqual(["clip-2"])
  })

  it("selects virtualized Clips from document geometry", () => {
    const rects = timelineClipSelectionRects(document, 50)
    expect(rects).toMatchObject([
      { clipID: "clip-1", left: 112, top: 9, right: 212, bottom: 63 },
      { clipID: "clip-2", left: 262, top: 81, right: 312, bottom: 135 },
    ])
    expect(timelineMarqueeSelectedClipIDs(rects, { x: 100, y: 0 }, { x: 220, y: 70 }))
      .toEqual(["clip-1"])
    expect(timelineMarqueeSelectedClipIDs(rects, { x: 320, y: 140 }, { x: 250, y: 70 }))
      .toEqual(["clip-2"])
  })

  it("accounts for resized and collapsed tracks", () => {
    expect(timelineClipSelectionRects(document, 50, {
      trackHeightsPx: { v1: 120, a1: 96 },
    })).toMatchObject([
      { clipID: "clip-1", top: 33, bottom: 87 },
      { clipID: "clip-2", top: 141, bottom: 195 },
    ])
    expect(timelineClipSelectionRects(document, 50, {
      collapsedTrackIDs: new Set(["v1"]),
    })).toMatchObject([
      { clipID: "clip-2", top: 45, bottom: 99 },
    ])
  })
})
