import { describe, expect, it } from "vitest"
import type { CinemaTimelineDocument } from "@anybox/shared/cinema-timeline"
import { timelineActiveClips, timelineNextVideoClip, timelinePreviousVideoClip } from "./timelineActiveClips"

const baseClip = {
  trackID: "v1",
  kind: "video" as const,
  title: "Clip",
  durationUs: 1_000_000,
  playbackRate: 1,
  volume: 1,
  opacity: 1,
  createdAt: "2026-07-10T00:00:00.000Z",
  updatedAt: "2026-07-10T00:00:00.000Z",
  assetRef: { scope: { type: "project" as const, projectID: "p" }, assetID: "a", contentRevision: 0, snapshot: { kind: "video" as const, displayName: "a", mimeType: "video/mp4", durationSeconds: 2 } },
  sourceInUs: 0,
  sourceDurationUs: 1_000_000,
}

const document: CinemaTimelineDocument = {
  schemaVersion: 2,
  id: "t",
  projectID: "p",
  title: "T",
  revision: 0,
  createdAt: "2026-07-10T00:00:00.000Z",
  updatedAt: "2026-07-10T00:00:00.000Z",
  settings: { width: 1, height: 1, frameRate: { numerator: 25, denominator: 1 }, sampleRate: 48_000, backgroundColor: "black" },
  tracks: [{ id: "v1", kind: "video", title: "V1", order: 0, locked: false, muted: false, hidden: false }],
  clips: [
    { ...baseClip, id: "one", timelineStartUs: 0 },
    { ...baseClip, id: "two", timelineStartUs: 1_000_000 },
  ],
  markers: [],
}

describe("timeline active clips", () => {
  it("uses half-open clip ranges at exact boundaries", () => {
    expect(timelineActiveClips(document, 999_999).video?.id).toBe("one")
    expect(timelineActiveClips(document, 1_000_000).video?.id).toBe("two")
    expect(timelineActiveClips(document, 2_000_000).video).toBeUndefined()
  })

  it("finds the adjacent video for preloading", () => {
    expect(timelineNextVideoClip(document, 0)?.id).toBe("two")
    expect(timelinePreviousVideoClip(document, 1_000_000)?.id).toBe("one")
  })

  it("returns overlays bottom-to-top according to track order", () => {
    const textClip = {
      id: "top",
      trackID: "overlay-top",
      kind: "text" as const,
      title: "Top",
      timelineStartUs: 0,
      durationUs: 1_000_000,
      playbackRate: 1,
      volume: 1,
      opacity: 1,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
      text: { value: "Top", stylePresetID: "default" },
    }
    const layered: CinemaTimelineDocument = {
      ...document,
      tracks: [
        { id: "overlay-top", kind: "overlay", title: "Top", order: 0, locked: false, muted: false, hidden: false },
        { id: "overlay-bottom", kind: "overlay", title: "Bottom", order: 1, locked: false, muted: false, hidden: false },
      ],
      clips: [textClip, { ...textClip, id: "bottom", trackID: "overlay-bottom", title: "Bottom", text: { ...textClip.text, value: "Bottom" } }],
    }
    expect(timelineActiveClips(layered, 0).overlays.map((clip) => clip.id)).toEqual(["bottom", "top"])
    expect(timelineActiveClips({
      ...layered,
      tracks: layered.tracks.map((track) => ({ ...track, order: 1 - track.order })),
    }, 0).overlays.map((clip) => clip.id)).toEqual(["top", "bottom"])
  })
})
