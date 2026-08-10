import { describe, expect, it } from "vitest"
import type { CinemaTimelineDocument } from "@anybox/cinema-plugin/contracts/timeline"
import { projectTimelineCommand } from "./timelineProjection"
import {
  TIMELINE_MIN_CONTENT_WIDTH_PX,
  TIMELINE_TRACK_HEADER_WIDTH_PX,
  timelineCanvasWidth,
  timelineContentWidth,
  timelineVisibleContentRange,
} from "./timelineLayout"
import { snapTimelineClipEdges, snapTimelineTime, timelineSnapCandidates } from "./timelineSnap"
import { quantizeTimelineTimeToFrame, timelinePixelsToTime, timelineTimeToPixels } from "./timelineTime"
import { createTimelineHistoryEntry, materializeTimelineCommand } from "./timelineUndo"
import { validateTimelineForDelivery } from "./timelineValidation"
import { visibleTimelineClips } from "./timelineVirtualization"

const document: CinemaTimelineDocument = {
  schemaVersion: 2,
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

  it("keeps ruler, track header, and content widths in one coordinate system", () => {
    const contentWidth = timelineContentWidth(30_000_000, 50)
    expect(contentWidth).toBe(TIMELINE_MIN_CONTENT_WIDTH_PX + 200)
    expect(timelineCanvasWidth(contentWidth)).toBe(TIMELINE_TRACK_HEADER_WIDTH_PX + contentWidth)
    expect(timelineVisibleContentRange({
      scrollLeft: TIMELINE_TRACK_HEADER_WIDTH_PX + 400,
      width: 800,
    }, 100)).toEqual({ start: 300, end: 1_300 })
  })

  it("snaps to clip edges and markers within a pixel threshold", () => {
    const candidates = timelineSnapCandidates(document)
    expect(candidates).toEqual([0, 1_000_000, 3_000_000, 4_000_000])
    expect(snapTimelineTime(3_050_000, candidates, 100, 8)).toEqual({ timeUs: 3_000_000, snapped: true })
    expect(snapTimelineTime(3_200_000, candidates, 100, 8)).toEqual({ timeUs: 3_200_000, snapped: false })
    expect(snapTimelineClipEdges(2_950_000, 1_000_000, [4_000_000], 100)).toEqual({
      timelineStartUs: 3_000_000,
      snapGuideUs: 4_000_000,
      snappedEdge: "end",
    })
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

  it("projects and inverts an atomic multi-clip move", () => {
    const clipTwo = {
      ...document.clips[0]!,
      id: "clip-2",
      title: "Two",
      timelineStartUs: 4_000_000,
    }
    const multiDocument = { ...document, clips: [...document.clips, clipTwo] }
    const draft = {
      id: "move-multiple",
      timelineID: "timeline-1",
      actor: "test",
      type: "move-clips" as const,
      placements: [
        { clipID: "clip-1", trackID: "v1", timelineStartUs: 0 },
        { clipID: "clip-2", trackID: "v1", timelineStartUs: 3_000_000 },
      ],
    }
    const moved = projectTimelineCommand(multiDocument, draft)
    expect(moved.clips.map((clip) => clip.timelineStartUs)).toEqual([0, 3_000_000])
    expect(createTimelineHistoryEntry(multiDocument, draft)?.undo).toEqual([{
      type: "move-clips",
      placements: [
        { clipID: "clip-1", trackID: "v1", timelineStartUs: 1_000_000 },
        { clipID: "clip-2", trackID: "v1", timelineStartUs: 4_000_000 },
      ],
    }])
  })

  it("projects and inverts an atomic multi-clip add", () => {
    const clips = [
      { ...document.clips[0]!, id: "clip-2", timelineStartUs: 4_000_000 },
      { ...document.clips[0]!, id: "clip-3", timelineStartUs: 7_000_000 },
    ]
    const draft = {
      id: "add-multiple",
      timelineID: "timeline-1",
      actor: "test",
      type: "add-clips" as const,
      clips,
    }
    expect(projectTimelineCommand(document, draft).clips.map((clip) => clip.id))
      .toEqual(["clip-1", "clip-2", "clip-3"])
    expect(createTimelineHistoryEntry(document, draft)?.undo).toEqual([{
      type: "delete-clips",
      clipIDs: ["clip-2", "clip-3"],
    }])
  })

  it("projects Ripple Delete and restores it through one history step", () => {
    const baseClip = document.clips[0]!
    const rippleDocument = {
      ...document,
      clips: [
        baseClip,
        { ...baseClip, id: "clip-2", timelineStartUs: 4_000_000 },
        { ...baseClip, id: "clip-3", timelineStartUs: 7_000_000 },
        { ...baseClip, id: "clip-4", timelineStartUs: 10_000_000 },
      ],
    }
    const draft = {
      id: "ripple",
      timelineID: "timeline-1",
      actor: "test",
      type: "ripple-delete-clips" as const,
      clipIDs: ["clip-1", "clip-3"],
    }
    const rippled = projectTimelineCommand(rippleDocument, draft)
    expect(rippled.clips.map((clip) => [clip.id, clip.timelineStartUs])).toEqual([
      ["clip-2", 2_000_000],
      ["clip-4", 6_000_000],
    ])
    const history = createTimelineHistoryEntry(rippleDocument, draft)!
    expect(history.undo.map((command) => command.type)).toEqual(["move-clips", "add-clips"])
    const restored = history.undo.reduce((current, template, index) => projectTimelineCommand(
      current,
      materializeTimelineCommand(template, {
        id: `undo-ripple-${index}`,
        timelineID: current.id,
        actor: "test",
      }),
    ), rippled)
    expect(restored.clips.map((clip) => [clip.id, clip.timelineStartUs]).sort())
      .toEqual(rippleDocument.clips.map((clip) => [clip.id, clip.timelineStartUs]).sort())
  })

  it("projects and inverts an atomic multi-clip update", () => {
    const second = { ...document.clips[0]!, id: "clip-2", timelineStartUs: 4_000_000 }
    const multiDocument = { ...document, clips: [...document.clips, second] }
    const draft = {
      id: "update-multiple",
      timelineID: "timeline-1",
      actor: "test",
      type: "update-clips" as const,
      updates: [
        { clipID: "clip-1", patch: { volume: 0.4, opacity: 0.8 } },
        { clipID: "clip-2", patch: { volume: 0.4, opacity: 0.8 } },
      ],
    }
    const updated = projectTimelineCommand(multiDocument, draft)
    expect(updated.clips.map((clip) => ["volume" in clip ? clip.volume : undefined, "opacity" in clip ? clip.opacity : undefined])).toEqual([[0.4, 0.8], [0.4, 0.8]])
    expect(createTimelineHistoryEntry(multiDocument, draft)?.undo).toEqual([{
      type: "update-clips",
      updates: [
        { clipID: "clip-1", patch: { volume: 1, opacity: 1 } },
        { clipID: "clip-2", patch: { volume: 1, opacity: 1 } },
      ],
    }])
  })

  it("projects and inverts track creation, reordering, and non-empty deletion", () => {
    const createdDraft = {
      id: "create-overlay",
      timelineID: document.id,
      actor: "test",
      type: "create-track" as const,
      track: { id: "o1", kind: "overlay" as const, title: "O1", order: 1, locked: false, muted: false, hidden: false },
    }
    const created = projectTimelineCommand(document, createdDraft)
    expect(created.tracks.map((track) => [track.id, track.order])).toEqual([["v1", 0], ["o1", 1]])
    expect(createTimelineHistoryEntry(document, createdDraft)?.undo).toEqual([
      { type: "delete-track", trackID: "o1", deleteClips: false },
    ])

    const reorderDraft = {
      id: "reorder",
      timelineID: document.id,
      actor: "test",
      type: "reorder-tracks" as const,
      trackIDs: ["o1", "v1"],
    }
    const reordered = projectTimelineCommand(created, reorderDraft)
    expect(reordered.tracks.map((track) => track.id)).toEqual(["o1", "v1"])
    expect(createTimelineHistoryEntry(created, reorderDraft)?.undo).toEqual([
      { type: "reorder-tracks", trackIDs: ["v1", "o1"] },
    ])

    const deleteDraft = {
      id: "delete-video-track",
      timelineID: document.id,
      actor: "test",
      type: "delete-track" as const,
      trackID: "v1",
      deleteClips: true,
    }
    const deleted = projectTimelineCommand(reordered, deleteDraft)
    expect(deleted.tracks.map((track) => track.id)).toEqual(["o1"])
    expect(deleted.clips).toEqual([])
    expect(createTimelineHistoryEntry(reordered, deleteDraft)?.undo.map((command) => command.type))
      .toEqual(["create-track", "add-clips"])
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

  it("undoes a visual transform added to a legacy Clip", () => {
    const draft = {
      id: "transform",
      timelineID: document.id,
      actor: "test",
      type: "update-clip" as const,
      clipID: document.clips[0]!.id,
      patch: {
        fit: "stretch" as const,
        transform: { x: 100, y: 50, scale: 1.2, rotationDegrees: 10, anchorX: 0.5, anchorY: 0.5 },
      },
    }
    const history = createTimelineHistoryEntry(document, draft)!
    expect(history.undo).toEqual([{
      type: "update-clip",
      clipID: document.clips[0]!.id,
      patch: { fit: null, transform: null },
    }])
    const transformed = projectTimelineCommand(document, draft)
    const restored = projectTimelineCommand(transformed, materializeTimelineCommand(history.undo[0]!, {
      id: "undo-transform",
      timelineID: document.id,
      actor: "test",
    }))
    expect(restored.clips[0]).not.toHaveProperty("transform")
    expect(restored.clips[0]).not.toHaveProperty("fit")
  })

  it("reports empty, missing, and no-main-video delivery issues", () => {
    expect(validateTimelineForDelivery({ ...document, clips: [] }).ready).toBe(false)
    const unavailableIssue = validateTimelineForDelivery(document, new Map([["a", "missing"]])).issues
      .find((issue) => issue.code === "asset-unavailable")
    expect(unavailableIssue).toMatchObject({
      code: "asset-unavailable",
      message: "One is missing. Replace its asset.",
    })
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
