import { describe, expect, test } from "bun:test"

import {
  CinemaTimelineCommandSchema,
  type CinemaTimelineCommand,
  type CinemaTimelineDocument,
} from "@anybox/cinema-plugin/contracts/timeline"
import { applyCinemaTimelineCommandToDocument } from "../src/domain/timeline-commands"

const timestamp = "2026-07-10T00:00:00.000Z"

function document(): CinemaTimelineDocument {
  return {
    schemaVersion: 2,
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

  test("moves multiple clips atomically in one revision", () => {
    const base: CinemaTimelineDocument = {
      ...document(),
      clips: [
        { ...videoClip(), durationUs: 2_000_000, sourceDurationUs: 2_000_000 },
        {
          ...videoClip(),
          id: "clip-2",
          title: "Shot 2",
          timelineStartUs: 3_000_000,
          durationUs: 2_000_000,
          sourceDurationUs: 2_000_000,
        },
      ],
    }
    const moved = applyCinemaTimelineCommandToDocument(base, command({
      type: "move-clips",
      placements: [
        { clipID: "clip-1", trackID: "track-v1", timelineStartUs: 4_000_000 },
        { clipID: "clip-2", trackID: "track-v1", timelineStartUs: 0 },
      ],
    }), "2026-07-10T00:05:00.000Z")

    expect(moved.revision).toBe(1)
    expect(moved.clips.map((clip) => [clip.id, clip.timelineStartUs])).toEqual([
      ["clip-1", 4_000_000],
      ["clip-2", 0],
    ])
    expect(base.clips.map((clip) => clip.timelineStartUs)).toEqual([0, 3_000_000])

    expect(() => applyCinemaTimelineCommandToDocument(base, command({
      type: "move-clips",
      placements: [
        { clipID: "clip-1", trackID: "track-v1", timelineStartUs: 1_000_000 },
        { clipID: "clip-2", trackID: "track-v1", timelineStartUs: 2_000_000 },
      ],
    }))).toThrow("invalid document")
    expect(base.revision).toBe(0)
  })

  test("adds multiple clips atomically in one revision", () => {
    const base = document()
    const added = applyCinemaTimelineCommandToDocument(base, command({
      type: "add-clips",
      clips: [
        { ...videoClip(), durationUs: 2_000_000, sourceDurationUs: 2_000_000 },
        {
          ...videoClip(),
          id: "clip-2",
          title: "Shot 2",
          timelineStartUs: 3_000_000,
          durationUs: 2_000_000,
          sourceDurationUs: 2_000_000,
        },
      ],
    }), "2026-07-10T00:06:00.000Z")

    expect(added.revision).toBe(1)
    expect(added.clips.map((clip) => clip.id)).toEqual(["clip-1", "clip-2"])
    expect(base.clips).toEqual([])

    expect(() => applyCinemaTimelineCommandToDocument(base, command({
      type: "add-clips",
      clips: [
        { ...videoClip(), durationUs: 2_000_000, sourceDurationUs: 2_000_000 },
        {
          ...videoClip(),
          id: "clip-2",
          title: "Overlapping shot",
          timelineStartUs: 1_000_000,
          durationUs: 2_000_000,
          sourceDurationUs: 2_000_000,
        },
      ],
    }))).toThrow("invalid document")
    expect(base.clips).toEqual([])
  })

  test("ripple deletes one track atomically and preserves gaps", () => {
    const clip = { ...videoClip(), durationUs: 2_000_000, sourceDurationUs: 2_000_000 }
    const base: CinemaTimelineDocument = {
      ...document(),
      clips: [
        clip,
        { ...clip, id: "clip-2", timelineStartUs: 3_000_000 },
        { ...clip, id: "clip-3", timelineStartUs: 6_000_000 },
        { ...clip, id: "clip-4", timelineStartUs: 9_000_000 },
      ],
    }
    const rippled = applyCinemaTimelineCommandToDocument(base, command({
      type: "ripple-delete-clips",
      clipIDs: ["clip-1", "clip-3"],
    }), "2026-07-10T00:07:00.000Z")
    expect(rippled.revision).toBe(1)
    expect(rippled.clips.map((candidate) => [candidate.id, candidate.timelineStartUs])).toEqual([
      ["clip-2", 1_000_000],
      ["clip-4", 5_000_000],
    ])
    expect(base.clips).toHaveLength(4)

    const crossTrack: CinemaTimelineDocument = {
      ...base,
      clips: [
        clip,
        {
          ...clip,
          id: "audio-1",
          trackID: "track-a1",
          kind: "audio",
          timelineStartUs: 0,
          assetRef: {
            ...clip.assetRef,
            assetID: "audio-asset",
            snapshot: { ...clip.assetRef.snapshot, kind: "audio", mimeType: "audio/wav" },
          },
          fadeInUs: 0,
          fadeOutUs: 0,
        },
      ],
    }
    expect(() => applyCinemaTimelineCommandToDocument(crossTrack, command({
      type: "ripple-delete-clips",
      clipIDs: ["clip-1", "audio-1"],
    }))).toThrow("one track")
  })

  test("updates multiple clips atomically in one revision", () => {
    const clip = { ...videoClip(), durationUs: 2_000_000, sourceDurationUs: 2_000_000 }
    const base: CinemaTimelineDocument = {
      ...document(),
      clips: [clip, { ...clip, id: "clip-2", timelineStartUs: 3_000_000 }],
    }
    const updated = applyCinemaTimelineCommandToDocument(base, command({
      type: "update-clips",
      updates: [
        { clipID: "clip-1", patch: { volume: 0.4, opacity: 0.8 } },
        { clipID: "clip-2", patch: { volume: 0.4, opacity: 0.8 } },
      ],
    }), "2026-07-10T00:08:00.000Z")
    expect(updated.revision).toBe(1)
    expect(updated.clips.map((candidate) => ["volume" in candidate ? candidate.volume : undefined, "opacity" in candidate ? candidate.opacity : undefined])).toEqual([[0.4, 0.8], [0.4, 0.8]])
    expect(base.clips.map((candidate) => ["volume" in candidate ? candidate.volume : undefined, "opacity" in candidate ? candidate.opacity : undefined])).toEqual([[1, 1], [1, 1]])
  })

  test("updates visual transform atomically and rejects transform on audio", () => {
    const base: CinemaTimelineDocument = { ...document(), clips: [videoClip()] }
    const transformed = applyCinemaTimelineCommandToDocument(base, command({
      type: "update-clip",
      clipID: "clip-1",
      patch: {
        fit: "stretch",
        transform: { x: 120, y: -40, scale: 1.25, rotationDegrees: 15, anchorX: 0.5, anchorY: 0.5 },
      },
    }))
    expect(transformed.clips[0]).toMatchObject({
      fit: "stretch",
      transform: { x: 120, y: -40, scale: 1.25, rotationDegrees: 15, anchorX: 0.5, anchorY: 0.5 },
    })

    const audioClip = {
      ...videoClip(),
      id: "audio-1",
      trackID: "track-a1",
      kind: "audio" as const,
      assetRef: {
        ...videoClip().assetRef,
        assetID: "audio-asset",
        snapshot: { ...videoClip().assetRef.snapshot, kind: "audio" as const, mimeType: "audio/wav" },
      },
      fadeInUs: 0,
      fadeOutUs: 0,
    }
    expect(() => applyCinemaTimelineCommandToDocument({ ...document(), clips: [audioClip] }, command({
      type: "update-clip",
      clipID: "audio-1",
      patch: { transform: { x: 0, y: 0, scale: 1, rotationDegrees: 0, anchorX: 0.5, anchorY: 0.5 } },
    }))).toThrow("Audio clips cannot have visual transforms")
  })

  test("creates, reorders, and deletes tracks atomically", () => {
    const created = applyCinemaTimelineCommandToDocument(document(), command({
      type: "create-track",
      track: { id: "track-o1", kind: "overlay", title: "O1", order: 1, locked: false, muted: false, hidden: false },
    }))
    expect(created.tracks.map((track) => [track.id, track.order])).toEqual([
      ["track-v1", 0],
      ["track-o1", 1],
      ["track-a1", 2],
    ])

    const reordered = applyCinemaTimelineCommandToDocument(created, command({
      type: "reorder-tracks",
      trackIDs: ["track-o1", "track-v1", "track-a1"],
    }, 1))
    expect(reordered.revision).toBe(2)
    expect(reordered.tracks.map((track) => [track.id, track.order])).toEqual([
      ["track-o1", 0],
      ["track-v1", 1],
      ["track-a1", 2],
    ])

    const deleted = applyCinemaTimelineCommandToDocument(reordered, command({
      type: "delete-track",
      trackID: "track-o1",
      deleteClips: false,
    }, 2))
    expect(deleted.revision).toBe(3)
    expect(deleted.tracks.map((track) => [track.id, track.order])).toEqual([
      ["track-v1", 0],
      ["track-a1", 1],
    ])

    expect(() => applyCinemaTimelineCommandToDocument(document(), command({
      type: "reorder-tracks",
      trackIDs: ["track-v1"],
    }))).toThrow("every current track")
  })

  test("requires explicit deletion of clips on a non-empty unlocked track", () => {
    const base: CinemaTimelineDocument = { ...document(), clips: [videoClip()] }
    expect(() => applyCinemaTimelineCommandToDocument(base, command({
      type: "delete-track",
      trackID: "track-v1",
      deleteClips: false,
    }))).toThrow("contains 1 clip")

    const deleted = applyCinemaTimelineCommandToDocument(base, command({
      type: "delete-track",
      trackID: "track-v1",
      deleteClips: true,
    }))
    expect(deleted.clips).toEqual([])
    expect(deleted.tracks.map((track) => [track.id, track.order])).toEqual([["track-a1", 0]])

    const locked: CinemaTimelineDocument = {
      ...base,
      tracks: base.tracks.map((track) => track.id === "track-v1" ? { ...track, locked: true } : track),
    }
    expect(() => applyCinemaTimelineCommandToDocument(locked, command({
      type: "delete-track",
      trackID: "track-v1",
      deleteClips: true,
    }))).toThrow("locked")
  })

  test("creates overlapping subtitle cues atomically and edits timed fields", () => {
    const track = {
      id: "track-s1", kind: "subtitle" as const, title: "S1", order: 2, locked: false, hidden: false,
      language: "zh-CN", role: "subtitle" as const,
      style: { fontFamilyID: "anybox-subtitle-sans-v1" as const, fontSizePx: 52, textColor: "#FFFFFFFF", outlineColor: "#000000FF", outlineWidthPx: 2, backgroundColor: "#00000000", alignment: "bottom-center" as const, marginBottomPx: 64 },
    }
    const cue = (id: string, start: number) => ({ id, trackID: track.id, kind: "subtitle" as const, timelineStartUs: start, durationUs: 2_000_000, cueText: "第一行", speaker: "旁白", createdAt: timestamp, updatedAt: timestamp })
    let current = applyCinemaTimelineCommandToDocument(document(), command({
      type: "create-track-with-clips", track, clips: [cue("cue-1", 0), cue("cue-2", 1_000_000)],
    }))
    expect(current.tracks.at(-1)?.kind).toBe("subtitle")
    expect(current.clips).toHaveLength(2)

    current = applyCinemaTimelineCommandToDocument(current, command({
      type: "update-clip", clipID: "cue-1", patch: { cueText: "更新", speaker: null },
    }, 1))
    expect(current.clips[0]).toMatchObject({ cueText: "更新" })
    expect("speaker" in current.clips[0]!).toBe(false)

    current = applyCinemaTimelineCommandToDocument(current, command({
      type: "trim-timed-clip", clipID: "cue-2", timelineStartUs: 1_500_000, durationUs: 750_000,
    }, 2))
    expect(current.clips[1]).toMatchObject({ timelineStartUs: 1_500_000, durationUs: 750_000 })
  })
})
