import { describe, expect, test } from "bun:test"

import {
  CinemaTimelineCommandSchema,
  type CinemaTimelineCommand,
  type CinemaTimelineDocument,
} from "@anybox/shared/cinema-timeline"
import { applyCinemaTimelineCommandToDocument } from "../src/cinema/timeline-commands"

const timestamp = "2026-07-10T00:00:00.000Z"

function document(): CinemaTimelineDocument {
  return {
    schemaVersion: 1,
    id: "timeline-1",
    projectID: "project-1",
    title: "Rough cut",
    revision: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
    settings: {
      width: 1920,
      height: 1080,
      frameRate: { numerator: 24, denominator: 1 },
      sampleRate: 48_000,
      backgroundColor: "#000000",
    },
    tracks: [
      { id: "track-v1", kind: "video", title: "V1", order: 0, locked: false, muted: false, hidden: false },
      { id: "track-a1", kind: "audio", title: "A1", order: 1, locked: false, muted: false, hidden: false },
    ],
    clips: [],
    markers: [],
  }
}

type TimelineCommandPayload<T> = T extends unknown
  ? Omit<T, "id" | "timelineID" | "baseRevision" | "actor">
  : never

function command<T extends TimelineCommandPayload<CinemaTimelineCommand>>(
  payload: T,
  baseRevision = 0,
): CinemaTimelineCommand {
  return CinemaTimelineCommandSchema.parse({
    id: `command-${payload.type}-${baseRevision}`,
    timelineID: "timeline-1",
    baseRevision,
    actor: "test",
    ...payload,
  })
}

function videoClip() {
  return {
    id: "clip-1",
    trackID: "track-v1",
    kind: "video" as const,
    title: "Shot 1",
    timelineStartUs: 0,
    durationUs: 4_000_000,
    playbackRate: 1,
    volume: 1,
    opacity: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    assetRef: {
      scope: { type: "project" as const, projectID: "project-1" },
      assetID: "asset-1",
      contentRevision: 0,
      snapshot: {
        kind: "video" as const,
        displayName: "shot.mp4",
        mimeType: "video/mp4",
        durationSeconds: 10,
      },
    },
    sourceInUs: 1_000_000,
    sourceDurationUs: 4_000_000,
  }
}

describe("Cinema timeline command projection", () => {
  test("adds, moves, trims, splits, and deletes clips with monotonic revisions", () => {
    let current = applyCinemaTimelineCommandToDocument(document(), command({
      type: "add-clip",
      clip: videoClip(),
    }), "2026-07-10T00:01:00.000Z")
    expect(current.revision).toBe(1)

    current = applyCinemaTimelineCommandToDocument(current, command({
      type: "move-clip",
      clipID: "clip-1",
      trackID: "track-v1",
      timelineStartUs: 2_000_000,
    }, 1), "2026-07-10T00:02:00.000Z")
    expect(current.clips[0]?.timelineStartUs).toBe(2_000_000)

    current = applyCinemaTimelineCommandToDocument(current, command({
      type: "trim-clip",
      clipID: "clip-1",
      timelineStartUs: 2_000_000,
      durationUs: 3_000_000,
      sourceInUs: 2_000_000,
      sourceDurationUs: 3_000_000,
    }, 2), "2026-07-10T00:03:00.000Z")
    expect(current.clips[0]).toMatchObject({ durationUs: 3_000_000, sourceInUs: 2_000_000 })

    current = applyCinemaTimelineCommandToDocument(current, command({
      type: "split-clip",
      clipID: "clip-1",
      rightClipID: "clip-2",
      splitTimeUs: 3_000_000,
    }, 3), "2026-07-10T00:04:00.000Z")
    expect(current.clips.map((clip) => [clip.id, clip.timelineStartUs, clip.durationUs])).toEqual([
      ["clip-1", 2_000_000, 1_000_000],
      ["clip-2", 3_000_000, 2_000_000],
    ])
    expect(current.clips[1]).toMatchObject({ sourceInUs: 3_000_000, sourceDurationUs: 2_000_000 })

    current = applyCinemaTimelineCommandToDocument(current, command({
      type: "delete-clips",
      clipIDs: ["clip-1", "clip-2"],
    }, 4))
    expect(current.revision).toBe(5)
    expect(current.clips).toEqual([])
  })

  test("rejects stale revisions, overlap, incompatible tracks, and locked tracks", () => {
    const base = document()
    expect(() => applyCinemaTimelineCommandToDocument(base, command({
      type: "add-marker",
      marker: { id: "marker-1", timeUs: 0, title: "Start", color: "default" },
    }, 2))).toThrow("latest revision is 0")

    const withClip = applyCinemaTimelineCommandToDocument(base, command({ type: "add-clip", clip: videoClip() }))
    expect(() => applyCinemaTimelineCommandToDocument(withClip, command({
      type: "add-clip",
      clip: { ...videoClip(), id: "clip-2", timelineStartUs: 2_000_000 },
    }, 1))).toThrow("invalid document")

    expect(() => applyCinemaTimelineCommandToDocument(withClip, command({
      type: "move-clip",
      clipID: "clip-1",
      trackID: "track-a1",
      timelineStartUs: 0,
    }, 1))).toThrow("invalid document")

    const locked = {
      ...withClip,
      tracks: withClip.tracks.map((track) => track.id === "track-v1" ? { ...track, locked: true } : track),
    }
    expect(() => applyCinemaTimelineCommandToDocument(locked, command({
      type: "delete-clips",
      clipIDs: ["clip-1"],
    }, 1))).toThrow("locked")
  })
})
