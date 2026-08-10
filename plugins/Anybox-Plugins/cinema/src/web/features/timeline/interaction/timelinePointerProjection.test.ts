import { describe, expect, it } from "vitest"
import {
  beginTimelineClipMove,
  cancelTimelinePointerInteraction,
  committedTimelineClipMove,
  projectTimelineClipMove,
  timelineClipGrabOffsetUs,
  updateTimelineClipMove,
} from "./timelinePointerProjection"
import {
  beginTimelineTrim,
  committedTimelineTrim,
  updateTimelineTrim,
} from "./timelineTrimProjection"
import {
  beginTimelinePlayheadScrub,
  projectTimelinePlayhead,
  updateTimelinePlayheadScrub,
} from "./timelineScrubProjection"

describe("timeline pointer projection", () => {
  it("preserves the pointer grab offset at different zoom levels", () => {
    expect(timelineClipGrabOffsetUs(175, 100, 2_000_000, 50)).toBe(1_500_000)
    expect(timelineClipGrabOffsetUs(250, 100, 2_000_000, 100)).toBe(1_500_000)
    expect(projectTimelineClipMove(400, 100, 1_500_000, 50)).toBe(4_500_000)
    expect(projectTimelineClipMove(700, 100, 1_500_000, 100)).toBe(4_500_000)
  })

  it("begins, updates, and commits a valid move without mutating the original placement", () => {
    const original = { clipID: "clip-1", trackID: "v1", timelineStartUs: 1_000_000 }
    const moving = beginTimelineClipMove({
      pointerID: 7,
      clientX: 175,
      clipLeft: 100,
      pixelsPerSecond: 50,
      snapCandidates: [],
      activeClipID: "clip-1",
      clips: [{ ...original, durationUs: 2_000_000 }],
    })
    const updated = updateTimelineClipMove(moving, {
      clientX: 400,
      laneLeft: 100,
      targetTrackID: "v2",
      pixelsPerSecond: 50,
      validTarget: true,
    })
    expect(original).toEqual({ clipID: "clip-1", trackID: "v1", timelineStartUs: 1_000_000 })
    expect(updated).toMatchObject({
      type: "moving-clip",
      draftClips: [{ clipID: "clip-1", trackID: "v2", timelineStartUs: 4_500_000 }],
    })
    expect(committedTimelineClipMove(updated)).toEqual([{
      clipID: "clip-1",
      trackID: "v2",
      timelineStartUs: 4_500_000,
    }])
  })

  it("does not commit unchanged or invalid moves and exposes an explicit cancel path", () => {
    const moving = beginTimelineClipMove({
      pointerID: 8,
      clientX: 100,
      clipLeft: 100,
      pixelsPerSecond: 50,
      snapCandidates: [],
      activeClipID: "clip-1",
      clips: [{ clipID: "clip-1", trackID: "v1", timelineStartUs: 0, durationUs: 2_000_000 }],
    })
    expect(committedTimelineClipMove(moving)).toBeNull()
    const invalid = updateTimelineClipMove(moving, {
      clientX: 250,
      laneLeft: 100,
      targetTrackID: "a1",
      pixelsPerSecond: 50,
      validTarget: false,
    })
    expect(committedTimelineClipMove(invalid)).toBeNull()
    expect(cancelTimelinePointerInteraction()).toEqual({ type: "idle" })
  })

  it("projects start and end trims without mutating the original clip", () => {
    const original = {
      timelineStartUs: 2_000_000,
      durationUs: 4_000_000,
      sourceInUs: 1_000_000,
      sourceDurationUs: 4_000_000,
    }
    const startTrim = beginTimelineTrim({
      pointerID: 9,
      clientX: 100,
      clipID: "clip-1",
      edge: "start",
      originalClip: original,
      minimumDurationUs: 100_000,
      assetDurationUs: 8_000_000,
      snapCandidates: [],
    })
    const startDraft = updateTimelineTrim(startTrim, 125, 50)
    expect(startDraft).toMatchObject({
      draft: {
        timelineStartUs: 2_500_000,
        durationUs: 3_500_000,
        sourceInUs: 1_500_000,
        sourceDurationUs: 3_500_000,
      },
    })
    expect(original.durationUs).toBe(4_000_000)

    const endTrim = beginTimelineTrim({
      pointerID: 10,
      clientX: 200,
      clipID: "clip-1",
      edge: "end",
      originalClip: original,
      minimumDurationUs: 100_000,
      assetDurationUs: 8_000_000,
      snapCandidates: [],
    })
    const endDraft = updateTimelineTrim(endTrim, 175, 50)
    expect(committedTimelineTrim(endDraft)).toEqual({
      clipID: "clip-1",
      draft: {
        timelineStartUs: 2_000_000,
        durationUs: 3_500_000,
        sourceInUs: 1_000_000,
        sourceDurationUs: 3_500_000,
      },
    })
  })

  it("snaps a moving clip by either edge and exposes the guide time", () => {
    const moving = beginTimelineClipMove({
      pointerID: 12,
      clientX: 100,
      clipLeft: 100,
      pixelsPerSecond: 100,
      snapCandidates: [5_000_000],
      activeClipID: "clip-1",
      clips: [{ clipID: "clip-1", trackID: "v1", timelineStartUs: 0, durationUs: 2_000_000 }],
    })
    const snappedByEnd = updateTimelineClipMove(moving, {
      clientX: 395,
      laneLeft: 100,
      targetTrackID: "v1",
      pixelsPerSecond: 100,
      validTarget: true,
    })
    expect(snappedByEnd).toMatchObject({
      draftClips: [{ timelineStartUs: 3_000_000 }],
      snapGuideUs: 5_000_000,
      snappedEdge: "end",
    })
  })

  it("moves a selection as one group and snaps its outer edges", () => {
    const moving = beginTimelineClipMove({
      pointerID: 14,
      clientX: 250,
      clipLeft: 200,
      pixelsPerSecond: 100,
      snapCandidates: [8_000_000],
      activeClipID: "clip-2",
      clips: [
        { clipID: "clip-1", trackID: "v1", timelineStartUs: 1_000_000, durationUs: 2_000_000 },
        { clipID: "clip-2", trackID: "v2", timelineStartUs: 4_000_000, durationUs: 2_000_000 },
      ],
    })
    const updated = updateTimelineClipMove(moving, {
      clientX: 750,
      laneLeft: 100,
      targetTrackID: "v3",
      targetTrackIDs: { "clip-1": "v2", "clip-2": "v3" },
      pixelsPerSecond: 100,
      validTarget: true,
    })
    expect(updated).toMatchObject({
      draftClips: [
        { clipID: "clip-1", trackID: "v2", timelineStartUs: 3_000_000 },
        { clipID: "clip-2", trackID: "v3", timelineStartUs: 6_000_000 },
      ],
      snapGuideUs: 8_000_000,
      snappedEdge: "end",
    })
  })

  it("snaps only the active trim edge", () => {
    const trimming = beginTimelineTrim({
      pointerID: 13,
      clientX: 100,
      clipID: "clip-1",
      edge: "end",
      originalClip: {
        timelineStartUs: 1_000_000,
        durationUs: 2_000_000,
        sourceInUs: 0,
        sourceDurationUs: 2_000_000,
      },
      minimumDurationUs: 100_000,
      assetDurationUs: 8_000_000,
      snapCandidates: [4_000_000],
    })
    expect(updateTimelineTrim(trimming, 195, 100)).toMatchObject({
      draft: { timelineStartUs: 1_000_000, durationUs: 3_000_000 },
      snapGuideUs: 4_000_000,
    })
  })

  it("projects a continuous ruler scrub from client coordinates", () => {
    expect(projectTimelinePlayhead(350, 100, 50)).toBe(5_000_000)
    const scrubbing = beginTimelinePlayheadScrub({
      pointerID: 11,
      clientX: 150,
      rulerLeft: 100,
      pixelsPerSecond: 50,
      originalPlayheadUs: 4_000_000,
    })
    expect(scrubbing).toMatchObject({
      type: "scrubbing-playhead",
      originalPlayheadUs: 4_000_000,
      draftPlayheadUs: 1_000_000,
    })
    expect(updateTimelinePlayheadScrub(scrubbing, 250, 100, 50)).toMatchObject({
      draftPlayheadUs: 3_000_000,
    })
  })
})
