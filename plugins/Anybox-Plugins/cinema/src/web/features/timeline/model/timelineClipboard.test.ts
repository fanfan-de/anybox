import { describe, expect, it } from "vitest"
import type { CinemaTimelineDocument } from "@anybox/cinema-plugin/contracts/timeline"
import {
  copyTimelineClips,
  duplicateTimelineClips,
  pasteTimelineClipboard,
} from "./timelineClipboard"

const timestamp = "2026-07-12T00:00:00.000Z"
const document: CinemaTimelineDocument = {
  schemaVersion: 2,
  id: "timeline-1",
  projectID: "project-1",
  title: "Clipboard",
  revision: 0,
  createdAt: timestamp,
  updatedAt: timestamp,
  settings: { width: 1920, height: 1080, frameRate: { numerator: 24, denominator: 1 }, sampleRate: 48_000, backgroundColor: "black" },
  tracks: [{ id: "v1", kind: "video", title: "V1", order: 0, locked: false, muted: false, hidden: false }],
  clips: [
    {
      id: "clip-1",
      trackID: "v1",
      kind: "video",
      title: "One",
      timelineStartUs: 1_000_000,
      durationUs: 2_000_000,
      playbackRate: 1,
      volume: 1,
      opacity: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      assetRef: { scope: { type: "project", projectID: "project-1" }, assetID: "a1", contentRevision: 0, snapshot: { kind: "video", displayName: "one.mp4", mimeType: "video/mp4", durationSeconds: 8 } },
      sourceInUs: 0,
      sourceDurationUs: 2_000_000,
    },
    {
      id: "clip-2",
      trackID: "v1",
      kind: "video",
      title: "Two",
      timelineStartUs: 4_000_000,
      durationUs: 2_000_000,
      playbackRate: 1,
      volume: 1,
      opacity: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      assetRef: { scope: { type: "project", projectID: "project-1" }, assetID: "a2", contentRevision: 0, snapshot: { kind: "video", displayName: "two.mp4", mimeType: "video/mp4", durationSeconds: 8 } },
      sourceInUs: 0,
      sourceDurationUs: 2_000_000,
    },
  ],
  markers: [],
}

describe("timeline clipboard", () => {
  it("pastes new IDs while preserving selection order and relative time", () => {
    const clipboard = copyTimelineClips(document, ["clip-2", "clip-1"])
    expect(clipboard).toMatchObject({ originStartUs: 1_000_000, durationUs: 5_000_000 })
    const ids = ["copy-2", "copy-1"]
    const pasted = pasteTimelineClipboard(clipboard!, document, 10_000_000, () => ids.shift()!, timestamp)
    expect(pasted.selectedClipIDs).toEqual(["copy-2", "copy-1"])
    expect(pasted.clips.map((clip) => [clip.id, clip.timelineStartUs, clip.trackID])).toEqual([
      ["copy-2", 13_000_000, "v1"],
      ["copy-1", 10_000_000, "v1"],
    ])
  })

  it("maps copied tracks to compatible unlocked target tracks", () => {
    const clipboard = copyTimelineClips(document, ["clip-1"])
    const target: CinemaTimelineDocument = {
      ...document,
      id: "timeline-2",
      tracks: [{ id: "video-main", kind: "video", title: "Main", order: 2, locked: false, muted: false, hidden: false }],
      clips: [],
    }
    expect(pasteTimelineClipboard(clipboard!, target, 0, () => "mapped", timestamp).clips[0])
      .toMatchObject({ id: "mapped", trackID: "video-main", timelineStartUs: 0 })
  })

  it("duplicates the group immediately after its outer edge", () => {
    const ids = ["duplicate-1", "duplicate-2"]
    const duplicated = duplicateTimelineClips(document, ["clip-1", "clip-2"], () => ids.shift()!, timestamp)
    expect(duplicated?.clips.map((clip) => clip.timelineStartUs)).toEqual([6_000_000, 9_000_000])
  })

  it("rejects overlapping paste results and duplicate generated IDs", () => {
    const clipboard = copyTimelineClips(document, ["clip-1"])
    expect(() => pasteTimelineClipboard(clipboard!, document, 1_000_000, () => "copy", timestamp)).toThrow(/overlap/)
    const two = copyTimelineClips(document, ["clip-1", "clip-2"])
    expect(() => pasteTimelineClipboard(two!, document, 10_000_000, () => "same", timestamp)).toThrow(/unique Clip ID/)
  })
})
