import { describe, expect, it } from "vitest"
import type { CinemaTimelineDocument } from "@anybox/shared/cinema-timeline"
import { projectTimelineCommand } from "./timelineProjection"
import { snapTimelineTime, timelineSnapCandidates } from "./timelineSnap"
import { quantizeTimelineTimeToFrame, timelinePixelsToTime, timelineTimeToPixels } from "./timelineTime"
import { createTimelineHistoryEntry, materializeTimelineCommand } from "./timelineUndo"
import { validateTimelineForDelivery } from "./timelineValidation"
import { visibleTimelineClips } from "./timelineVirtualization"

const document: CinemaTimelineDocument = {
  schemaVersion: 1,
  id: "timeline-1",
  projectID: "project-1",
  title: "Test",
  revision: 0,
  createdAt: "2026-07-10T00:00:00.000Z",
  updatedAt: "2026-07-10T00:00:00.000Z",
  settings: { width: 1920, height: 1080, frameRate: { numerator: 25, denominator: 1 }, sampleRate: 48_000, backgroundColor: "black" },
  tracks: [{ id: "v1", kind: "video", title: "V1", order: 0, locked: false, muted: false, hidden: false }],
  clips: [{
    id: "clip-1",
    trackID: "v1",
    kind: "video",
    title: "One",
    timelineStartUs: 1_000_000,
    durationUs: 2_000_000,
    playbackRate: 1,
    volume: 1,
    opacity: 1,
    createdAt: "2026-07-10T00:00:00.000Z",
    updatedAt: "2026-07-10T00:00:00.000Z",
    assetRef: { scope: { type: "project", projectID: "project-1" }, assetID: "a", contentRevision: 0, snapshot: { kind: "video", displayName: "a.mp4", mimeType: "video/mp4", durationSeconds: 8 } },
    sourceInUs: 0,
    sourceDurationUs: 2_000_000,
  }],
  markers: [{ id: "m1", timeUs: 4_000_000, title: "Beat", color: "default" }],
}

describe("timeline model", () => {
  it("converts time and pixels without floating persistence", () => {
    expect(timelineTimeToPixels(1_500_000, 100)).toBe(150)
    expect(timelinePixelsToTime(150, 100)).toBe(1_500_000)
    expect(quantizeTimelineTimeToFrame(1_019_000, { numerator: 25, denominator: 1 })).toBe(1_000_000)
  })

  it("snaps to clip edges and markers within a pixel threshold", () => {
    const candidates = timelineSnapCandidates(document)
    expect(candidates).toEqual([0, 1_000_000, 3_000_000, 4_000_000])
    expect(snapTimelineTime(3_050_000, candidates, 100, 8)).toEqual({ timeUs: 3_000_000, snapped: true })
    expect(snapTimelineTime(3_200_000, candidates, 100, 8)).toEqual({ timeUs: 3_200_000, snapped: false })
  })

  it("projects move and split commands without changing the acknowledged revision", () => {
    const moved = projectTimelineCommand(document, {
      id: "move",
      timelineID: "timeline-1",
      actor: "test",
      type: "move-clip",
      clipID: "clip-1",
      trackID: "v1",
      timelineStartUs: 2_000_000,
    })
    expect(moved.revision).toBe(0)
    expect(moved.clips[0]?.timelineStartUs).toBe(2_000_000)

    const split = projectTimelineCommand(document, {
      id: "split",
      timelineID: "timeline-1",
      actor: "test",
      type: "split-clip",
      clipID: "clip-1",
      rightClipID: "clip-2",
      splitTimeUs: 2_000_000,
    })
    expect(split.clips.map((clip) => clip.durationUs)).toEqual([1_000_000, 1_000_000])
  })

  it("creates replay-safe inverse commands with fresh envelopes", () => {
    const draft = {
      id: "move-original",
      timelineID: "timeline-1",
      actor: "test",
      type: "move-clip" as const,
      clipID: "clip-1",
      trackID: "v1",
      timelineStartUs: 2_000_000,
    }
    const history = createTimelineHistoryEntry(document, draft)
    expect(history?.undo).toEqual([{ type: "move-clip", clipID: "clip-1", trackID: "v1", timelineStartUs: 1_000_000 }])
    expect(materializeTimelineCommand(history!.redo[0]!, {
      id: "move-redo",
      timelineID: "timeline-1",
      actor: "test",
    }).id).toBe("move-redo")
  })

  it("undoes a fade added to a legacy audio clip without persisted fade fields", () => {
    const audioDocument: CinemaTimelineDocument = {
      ...document,
      tracks: [{ id: "a1", kind: "audio", title: "A1", order: 0, locked: false, muted: false, hidden: false }],
      clips: [{
        id: "audio-1",
        trackID: "a1",
        kind: "audio",
        title: "Legacy audio",
        timelineStartUs: 0,
        durationUs: 2_000_000,
        playbackRate: 1,
        volume: 1,
        opacity: 1,
        createdAt: "2026-07-10T00:00:00.000Z",
        updatedAt: "2026-07-10T00:00:00.000Z",
        assetRef: {
          scope: { type: "project", projectID: "project-1" },
          assetID: "audio-a",
          contentRevision: 0,
          snapshot: { kind: "audio", displayName: "a.wav", mimeType: "audio/wav", durationSeconds: 8 },
        },
        sourceInUs: 0,
        sourceDurationUs: 2_000_000,
      }],
    }
    const draft = {
      id: "fade",
      timelineID: "timeline-1",
      actor: "test",
      type: "update-clip" as const,
      clipID: "audio-1",
      patch: { fadeInUs: 250_000 },
    }
    const history = createTimelineHistoryEntry(audioDocument, draft)!
    expect(history.undo[0]).toMatchObject({ patch: { fadeInUs: null } })
    const faded = projectTimelineCommand(audioDocument, draft)
    const restored = projectTimelineCommand(faded, materializeTimelineCommand(history.undo[0]!, {
      id: "undo-fade",
      timelineID: "timeline-1",
      actor: "test",
    }))
    expect(restored.clips[0]).not.toHaveProperty("fadeInUs")
  })

  it("reports empty, missing, and no-main-video delivery issues", () => {
    expect(validateTimelineForDelivery({ ...document, clips: [] }).ready).toBe(false)
    expect(validateTimelineForDelivery(document, new Map([["a", "missing"]])).issues.map((issue) => issue.code))
      .toContain("asset-unavailable")
  })

  it("only projects clips inside the visible timeline window plus overscan", () => {
    const clips = Array.from({ length: 500 }, (_, index) => ({
      ...document.clips[0]!,
      id: `clip-${index}`,
      timelineStartUs: index * 2_000_000,
    }))
    const visible = visibleTimelineClips(clips, { scrollLeft: 0, width: 1000 }, 50, 100)
    expect(visible.length).toBeLessThan(20)
    expect(visible[0]?.id).toBe("clip-0")
  })
})
