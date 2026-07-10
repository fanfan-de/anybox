import { describe, expect, it } from "vitest"
import type { CinemaTimelineDocument } from "@anybox/shared/cinema-timeline"
import { timelineActiveClips, timelineNextVideoClip } from "./timelineActiveClips"

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
  schemaVersion: 1,
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
  })
})
