import { describe, expect, it } from "vitest"

import {
  CINEMA_TIMELINE_DEFAULT_SUBTITLE_STYLE,
  CINEMA_TIMELINE_SAMPLE_RATE,
  CinemaTimelineClipSchema,
  CinemaTimelineCommandSchema,
  CinemaTimelineDocumentSchema,
  CinemaTimelineFrameRateSchema,
  CinemaTimelineTimeSchema,
} from "../../src/contracts/cinema-timeline"

const now = "2026-07-10T00:00:00.000Z"

function assetRef(kind: "image" | "video" | "audio", durationSeconds?: number) {
  return {
    scope: { type: "project" as const, projectID: "project-1" },
    assetID: `asset-${kind}`,
    contentRevision: 0,
    snapshot: {
      kind,
      displayName: `source.${kind}`,
      mimeType: kind === "image" ? "image/png" : `${kind}/mp4`,
      durationSeconds,
    },
  }
}

const clipBase = {
  id: "clip-1",
  trackID: "track-v1",
  title: "Opening shot",
  timelineStartUs: 0,
  durationUs: 2_000_000,
  playbackRate: 1,
  volume: 1,
  opacity: 1,
  createdAt: now,
  updatedAt: now,
}

describe("cinema timeline contracts", () => {
  it("accepts integer microseconds and rational frame rates", () => {
    expect(CinemaTimelineTimeSchema.parse(1_000_001)).toBe(1_000_001)
    expect(CinemaTimelineFrameRateSchema.parse({
      numerator: 30_000,
      denominator: 1_001,
    })).toEqual({ numerator: 30_000, denominator: 1_001 })
  })

  it.each([-1, 0.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid timeline time %s",
    (value) => {
      expect(() => CinemaTimelineTimeSchema.parse(value)).toThrow()
    },
  )

  it.each([
    { numerator: 0, denominator: 1 },
    { numerator: 24, denominator: 0 },
    { numerator: 23.976, denominator: 1 },
  ])("rejects invalid frame rate $numerator/$denominator", (value) => {
    expect(() => CinemaTimelineFrameRateSchema.parse(value)).toThrow()
  })

  it("parses a persisted timeline document without local UI state", () => {
    const document = CinemaTimelineDocumentSchema.parse({
      schemaVersion: 1,
      id: "timeline-1",
      projectID: "project-1",
      title: "Rough cut",
      revision: 0,
      createdAt: now,
      updatedAt: now,
      settings: {
        width: 1920,
        height: 1080,
        frameRate: { numerator: 24, denominator: 1 },
        sampleRate: CINEMA_TIMELINE_SAMPLE_RATE,
        backgroundColor: "#000000",
      },
      tracks: [
        {
          id: "track-v1",
          kind: "video",
          title: "V1",
          order: 0,
          locked: false,
          muted: false,
          hidden: false,
        },
        {
          id: "track-a1",
          kind: "audio",
          title: "A1",
          order: 1,
          locked: false,
          muted: false,
          hidden: false,
        },
      ],
      clips: [
        {
          ...clipBase,
          kind: "video",
          assetRef: assetRef("video", 5),
          sourceInUs: 1_000_000,
          sourceDurationUs: 2_000_000,
          fit: "contain",
        },
        {
          ...clipBase,
          id: "clip-a1",
          trackID: "track-a1",
          kind: "audio",
          assetRef: assetRef("audio", 5),
          sourceInUs: 0,
          sourceDurationUs: 2_000_000,
        },
      ],
      markers: [
        {
          id: "marker-1",
          timeUs: 1_000_000,
          title: "Beat",
          color: "warning",
        },
      ],
    })

    expect(document.schemaVersion).toBe(2)
    expect(document.clips).toHaveLength(2)
    expect(document.markers[0]?.timeUs).toBe(1_000_000)
    expect("playhead" in document).toBe(false)
  })

  it("accepts overlapping subtitle cues", () => {
    const document = CinemaTimelineDocumentSchema.parse({
      schemaVersion: 2,
      id: "timeline-subtitles",
      projectID: "project-1",
      title: "Subtitles",
      revision: 0,
      createdAt: now,
      updatedAt: now,
      settings: {
        width: 1920,
        height: 1080,
        frameRate: { numerator: 24, denominator: 1 },
        sampleRate: CINEMA_TIMELINE_SAMPLE_RATE,
        backgroundColor: "black",
      },
      tracks: [{
        id: "track-s1",
        kind: "subtitle",
        title: "S1",
        order: 0,
        locked: false,
        hidden: false,
        language: "zh-CN",
        role: "subtitle",
        style: CINEMA_TIMELINE_DEFAULT_SUBTITLE_STYLE,
      }],
      clips: [
        { id: "cue-1", trackID: "track-s1", kind: "subtitle", timelineStartUs: 0, durationUs: 2_000_000, cueText: "第一句", createdAt: now, updatedAt: now },
        { id: "cue-2", trackID: "track-s1", kind: "subtitle", timelineStartUs: 1_000_000, durationUs: 2_000_000, cueText: "第二句", createdAt: now, updatedAt: now },
      ],
      markers: [],
    })
    expect(document.clips).toHaveLength(2)
  })

  it("rejects document-level UI state", () => {
    expect(() => CinemaTimelineDocumentSchema.parse({
      schemaVersion: 1,
      id: "timeline-1",
      projectID: "project-1",
      title: "Rough cut",
      revision: 0,
      createdAt: now,
      updatedAt: now,
      settings: {
        width: 1920,
        height: 1080,
        frameRate: { numerator: 24, denominator: 1 },
        sampleRate: CINEMA_TIMELINE_SAMPLE_RATE,
        backgroundColor: "black",
      },
      tracks: [],
      clips: [],
      markers: [],
      playhead: 0,
    })).toThrow()
  })

  it("requires positive clip durations and physical asset references", () => {
    expect(() => CinemaTimelineClipSchema.parse({
      ...clipBase,
      durationUs: 0,
      kind: "video",
      assetRef: assetRef("video", 5),
      sourceInUs: 0,
      sourceDurationUs: 1_000_000,
    })).toThrow()

    expect(() => CinemaTimelineClipSchema.parse({
      ...clipBase,
      kind: "video",
      sourceInUs: 0,
      sourceDurationUs: 1_000_000,
    })).toThrow()
  })

  it("rejects asset kinds that do not match a clip", () => {
    expect(() => CinemaTimelineClipSchema.parse({
      ...clipBase,
      kind: "image",
      assetRef: assetRef("video", 5),
      sourceInUs: 0,
      sourceDurationUs: 1_000_000,
    })).toThrow()
  })

  it("rejects source ranges beyond known asset duration", () => {
    expect(() => CinemaTimelineClipSchema.parse({
      ...clipBase,
      kind: "video",
      assetRef: assetRef("video", 5),
      sourceInUs: 4_000_000,
      sourceDurationUs: 2_000_000,
    })).toThrow()
  })

  it("allows source ranges pending validation when duration metadata is absent", () => {
    expect(CinemaTimelineClipSchema.parse({
      ...clipBase,
      kind: "audio",
      assetRef: assetRef("video"),
      sourceInUs: 20_000_000,
      sourceDurationUs: 2_000_000,
    }).kind).toBe("audio")
  })

  it("accepts audio fades that fit and rejects fades beyond the clip duration", () => {
    const audio = {
      ...clipBase,
      trackID: "track-a1",
      kind: "audio" as const,
      assetRef: assetRef("audio", 5),
      sourceInUs: 0,
      sourceDurationUs: 2_000_000,
      fadeInUs: 250_000,
      fadeOutUs: 500_000,
    }
    expect(CinemaTimelineClipSchema.parse(audio)).toMatchObject({ fadeInUs: 250_000, fadeOutUs: 500_000 })
    expect(() => CinemaTimelineClipSchema.parse({ ...audio, fadeInUs: 1_500_000, fadeOutUs: 750_000 })).toThrow()
  })

  it("does not allow text clips to persist physical asset fields", () => {
    expect(() => CinemaTimelineClipSchema.parse({
      ...clipBase,
      kind: "text",
      text: {
        value: "Title",
        stylePresetID: "title-default",
      },
      assetRef: assetRef("image"),
      sourceInUs: 0,
      sourceDurationUs: 2_000_000,
    })).toThrow()
  })

  it("rejects clips on incompatible or missing tracks", () => {
    const baseDocument = {
      schemaVersion: 1,
      id: "timeline-1",
      projectID: "project-1",
      title: "Rough cut",
      revision: 0,
      createdAt: now,
      updatedAt: now,
      settings: {
        width: 1920,
        height: 1080,
        frameRate: { numerator: 24, denominator: 1 },
        sampleRate: CINEMA_TIMELINE_SAMPLE_RATE,
        backgroundColor: "black",
      },
      tracks: [{
        id: "track-v1",
        kind: "video",
        title: "V1",
        order: 0,
        locked: false,
        muted: false,
        hidden: false,
      }],
      markers: [],
    }

    expect(() => CinemaTimelineDocumentSchema.parse({
      ...baseDocument,
      clips: [{
        ...clipBase,
        kind: "audio",
        assetRef: assetRef("audio", 5),
        sourceInUs: 0,
        sourceDurationUs: 2_000_000,
      }],
    })).toThrow(/not compatible/)

    expect(() => CinemaTimelineDocumentSchema.parse({
      ...baseDocument,
      clips: [{
        ...clipBase,
        trackID: "track-missing",
        kind: "video",
        assetRef: assetRef("video", 5),
        sourceInUs: 0,
        sourceDurationUs: 2_000_000,
      }],
    })).toThrow(/missing track/)
  })

  it("rejects duplicate ids and same-track overlap", () => {
    const track = {
      id: "track-v1",
      kind: "video" as const,
      title: "V1",
      order: 0,
      locked: false,
      muted: false,
      hidden: false,
    }
    const firstClip = {
      ...clipBase,
      kind: "video" as const,
      assetRef: assetRef("video", 5),
      sourceInUs: 0,
      sourceDurationUs: 2_000_000,
    }
    const document = {
      schemaVersion: 1,
      id: "timeline-1",
      projectID: "project-1",
      title: "Rough cut",
      revision: 0,
      createdAt: now,
      updatedAt: now,
      settings: {
        width: 1920,
        height: 1080,
        frameRate: { numerator: 24, denominator: 1 },
        sampleRate: CINEMA_TIMELINE_SAMPLE_RATE,
        backgroundColor: "black",
      },
      tracks: [track],
      clips: [
        firstClip,
        {
          ...firstClip,
          id: "clip-2",
          timelineStartUs: 1_000_000,
        },
      ],
      markers: [],
    }

    expect(() => CinemaTimelineDocumentSchema.parse(document)).toThrow(/overlap/)
    expect(() => CinemaTimelineDocumentSchema.parse({
      ...document,
      tracks: [track, track],
      clips: [],
    })).toThrow(/Duplicate track id/)
  })

  it("requires command identity, actor, timeline and base revision", () => {
    const command = CinemaTimelineCommandSchema.parse({
      id: "command-1",
      timelineID: "timeline-1",
      baseRevision: 4,
      actor: "cinema-web",
      type: "move-clip",
      clipID: "clip-1",
      trackID: "track-v1",
      timelineStartUs: 2_000_000,
    })
    expect(command.baseRevision).toBe(4)

    expect(() => CinemaTimelineCommandSchema.parse({
      ...command,
      id: undefined,
    })).toThrow()
    expect(() => CinemaTimelineCommandSchema.parse({
      ...command,
      actor: undefined,
    })).toThrow()
  })

  it("parses every structural timeline command and rejects arbitrary patches", () => {
    const base = {
      id: "command-1",
      timelineID: "timeline-1",
      baseRevision: 0,
      actor: "cinema-web",
    }
    const commands = [
      { ...base, type: "create-track", track: { id: "track-a1", kind: "audio", title: "A1", order: 1, locked: false, muted: false, hidden: false } },
      { ...base, type: "update-track", trackID: "track-a1", patch: { muted: true } },
      { ...base, type: "delete-track", trackID: "track-a1", deleteClips: false },
      { ...base, type: "reorder-tracks", trackIDs: ["track-a1", "track-v1"] },
      { ...base, type: "add-clip", clip: { ...clipBase, kind: "video", assetRef: assetRef("video", 5), sourceInUs: 0, sourceDurationUs: 2_000_000 } },
      { ...base, type: "add-clips", clips: [{ ...clipBase, kind: "video", assetRef: assetRef("video", 5), sourceInUs: 0, sourceDurationUs: 2_000_000 }] },
      { ...base, type: "move-clip", clipID: "clip-1", trackID: "track-v1", timelineStartUs: 1_000_000 },
      { ...base, type: "move-clips", placements: [{ clipID: "clip-1", trackID: "track-v1", timelineStartUs: 1_000_000 }] },
      { ...base, type: "trim-clip", clipID: "clip-1", timelineStartUs: 0, durationUs: 1_000_000, sourceInUs: 500_000, sourceDurationUs: 1_000_000 },
      { ...base, type: "split-clip", clipID: "clip-1", rightClipID: "clip-2", splitTimeUs: 1_000_000 },
      { ...base, type: "delete-clips", clipIDs: ["clip-1"] },
      { ...base, type: "ripple-delete-clips", clipIDs: ["clip-1"] },
      { ...base, type: "update-clip", clipID: "clip-1", patch: { volume: 0.5, fit: "stretch", transform: { x: 10, y: -5, scale: 1.2, rotationDegrees: 15, anchorX: 0.5, anchorY: 0.5 } } },
      { ...base, type: "update-clips", updates: [{ clipID: "clip-1", patch: { volume: 0.5 } }] },
      { ...base, type: "add-marker", marker: { id: "marker-1", timeUs: 0, title: "Start", color: "default" } },
      { ...base, type: "move-marker", markerID: "marker-1", timeUs: 1_000_000 },
      { ...base, type: "delete-marker", markerID: "marker-1" },
      { ...base, type: "update-settings", patch: { frameRate: { numerator: 25, denominator: 1 } } },
    ]

    for (const command of commands) {
      expect(CinemaTimelineCommandSchema.parse(command).type).toBe(command.type)
    }

    expect(() => CinemaTimelineCommandSchema.parse({
      ...base,
      type: "patch-document",
      patch: { revision: 99 },
    })).toThrow()
    expect(() => CinemaTimelineCommandSchema.parse({
      ...base,
      type: "update-clip",
      clipID: "clip-1",
      patch: {},
    })).toThrow()
    expect(() => CinemaTimelineCommandSchema.parse({
      ...base,
      type: "update-track",
      trackID: "track-v1",
      patch: { order: 1 },
    })).toThrow()
    expect(() => CinemaTimelineCommandSchema.parse({
      ...base,
      type: "move-clips",
      placements: [
        { clipID: "clip-1", trackID: "track-v1", timelineStartUs: 0 },
        { clipID: "clip-1", trackID: "track-v1", timelineStartUs: 1_000_000 },
      ],
    })).toThrow(/unique/)
    expect(() => CinemaTimelineCommandSchema.parse({
      ...base,
      type: "update-clip",
      clipID: "clip-1",
      patch: { transform: { x: 0, y: 0, scale: 0, rotationDegrees: 0, anchorX: 0.5, anchorY: 0.5 } },
    })).toThrow()
    expect(() => CinemaTimelineCommandSchema.parse({
      ...base,
      type: "reorder-tracks",
      trackIDs: ["track-v1", "track-v1"],
    })).toThrow(/unique/)
    expect(() => CinemaTimelineCommandSchema.parse({
      ...base,
      type: "add-clips",
      clips: [
        { ...clipBase, kind: "video", assetRef: assetRef("video", 5), sourceInUs: 0, sourceDurationUs: 2_000_000 },
        { ...clipBase, kind: "video", assetRef: assetRef("video", 5), sourceInUs: 0, sourceDurationUs: 2_000_000 },
      ],
    })).toThrow(/unique/)
    expect(() => CinemaTimelineCommandSchema.parse({
      ...base,
      type: "ripple-delete-clips",
      clipIDs: ["clip-1", "clip-1"],
    })).toThrow(/unique/)
    expect(() => CinemaTimelineCommandSchema.parse({
      ...base,
      type: "update-clips",
      updates: [
        { clipID: "clip-1", patch: { volume: 0.5 } },
        { clipID: "clip-1", patch: { opacity: 0.5 } },
      ],
    })).toThrow(/unique/)
  })
})
