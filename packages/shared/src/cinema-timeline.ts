import { z } from "zod"

import { CinemaAssetRefSchema } from "./cinema"

export const CINEMA_TIMELINE_SCHEMA_VERSION = 1 as const
export const CINEMA_TIMELINE_SAMPLE_RATE = 48_000 as const

export const CinemaTimelineIDSchema = z.string()
  .min(1)
  .max(128)
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9_-]*$/,
    "Timeline id must contain only letters, numbers, underscores, and hyphens",
  )
export type CinemaTimelineID = z.infer<typeof CinemaTimelineIDSchema>

export const CinemaTimelineTimeSchema = z.number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER)
export type CinemaTimelineTime = z.infer<typeof CinemaTimelineTimeSchema>

const PositiveCinemaTimelineTimeSchema = CinemaTimelineTimeSchema.refine(
  (value) => value > 0,
  "Timeline duration must be greater than zero",
)

export const CinemaTimelineFrameRateSchema = z.object({
  numerator: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  denominator: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
}).strict()
export type CinemaTimelineFrameRate = z.infer<typeof CinemaTimelineFrameRateSchema>

export const CinemaTimelineSettingsSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  frameRate: CinemaTimelineFrameRateSchema,
  sampleRate: z.literal(CINEMA_TIMELINE_SAMPLE_RATE),
  backgroundColor: z.string().trim().min(1),
}).strict()
export type CinemaTimelineSettings = z.infer<typeof CinemaTimelineSettingsSchema>

export const CinemaTimelineTrackKindSchema = z.enum(["video", "audio", "overlay"])
export type CinemaTimelineTrackKind = z.infer<typeof CinemaTimelineTrackKindSchema>

export const CinemaTimelineClipKindSchema = z.enum(["video", "audio", "image", "text"])
export type CinemaTimelineClipKind = z.infer<typeof CinemaTimelineClipKindSchema>

export const CinemaTimelineTrackSchema = z.object({
  id: z.string().min(1),
  kind: CinemaTimelineTrackKindSchema,
  title: z.string().min(1),
  order: z.number().int().nonnegative(),
  locked: z.boolean(),
  muted: z.boolean(),
  hidden: z.boolean(),
}).strict()
export type CinemaTimelineTrack = z.infer<typeof CinemaTimelineTrackSchema>

const CinemaTimelineClipBaseShape = {
  id: z.string().min(1),
  trackID: z.string().min(1),
  title: z.string().min(1),
  timelineStartUs: CinemaTimelineTimeSchema,
  durationUs: PositiveCinemaTimelineTimeSchema,
  playbackRate: z.number().positive().finite(),
  volume: z.number().nonnegative().finite(),
  opacity: z.number().min(0).max(1).finite(),
  fit: z.enum(["contain", "cover"]).optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
} as const

const CinemaTimelineAssetClipBaseShape = {
  ...CinemaTimelineClipBaseShape,
  assetRef: CinemaAssetRefSchema,
  sourceInUs: CinemaTimelineTimeSchema,
  sourceDurationUs: PositiveCinemaTimelineTimeSchema,
} as const

function sourceRangeFitsKnownAssetDuration(
  clip: {
    assetRef: z.infer<typeof CinemaAssetRefSchema>
    sourceInUs: number
    sourceDurationUs: number
  },
) {
  const durationSeconds = clip.assetRef.snapshot.durationSeconds
  if (durationSeconds === undefined) return true

  const durationUs = Math.round(durationSeconds * 1_000_000)
  return clip.sourceInUs <= durationUs
    && clip.sourceDurationUs <= durationUs - clip.sourceInUs
}

function sourceRangeMessage() {
  return {
    message: "Clip source range exceeds the known asset duration",
    path: ["sourceDurationUs"],
  }
}

function timelineRangeFitsSafeInteger(clip: { timelineStartUs: number; durationUs: number }) {
  return clip.durationUs <= Number.MAX_SAFE_INTEGER - clip.timelineStartUs
}

const timelineRangeMessage = {
  message: "Clip timeline range exceeds the maximum safe timeline time",
  path: ["durationUs"],
}

export const CinemaTimelineVideoClipSchema = z.object({
  ...CinemaTimelineAssetClipBaseShape,
  kind: z.literal("video"),
}).strict()
  .refine((clip) => clip.assetRef.snapshot.kind === "video", {
    message: "Video clips must reference video assets",
    path: ["assetRef", "snapshot", "kind"],
  })
  .refine(timelineRangeFitsSafeInteger, timelineRangeMessage)
  .refine(sourceRangeFitsKnownAssetDuration, sourceRangeMessage())
export type CinemaTimelineVideoClip = z.infer<typeof CinemaTimelineVideoClipSchema>

export const CinemaTimelineAudioClipSchema = z.object({
  ...CinemaTimelineAssetClipBaseShape,
  kind: z.literal("audio"),
  fadeInUs: CinemaTimelineTimeSchema.optional(),
  fadeOutUs: CinemaTimelineTimeSchema.optional(),
}).strict()
  .refine(
    (clip) => clip.assetRef.snapshot.kind === "audio" || clip.assetRef.snapshot.kind === "video",
    {
      message: "Audio clips must reference audio or video assets",
      path: ["assetRef", "snapshot", "kind"],
    },
  )
  .refine((clip) => (clip.fadeInUs ?? 0) + (clip.fadeOutUs ?? 0) <= clip.durationUs, {
    message: "Audio fades must fit within the clip duration",
    path: ["fadeOutUs"],
  })
  .refine(timelineRangeFitsSafeInteger, timelineRangeMessage)
  .refine(sourceRangeFitsKnownAssetDuration, sourceRangeMessage())
export type CinemaTimelineAudioClip = z.infer<typeof CinemaTimelineAudioClipSchema>

export const CinemaTimelineImageClipSchema = z.object({
  ...CinemaTimelineAssetClipBaseShape,
  kind: z.literal("image"),
}).strict()
  .refine((clip) => clip.assetRef.snapshot.kind === "image", {
    message: "Image clips must reference image assets",
    path: ["assetRef", "snapshot", "kind"],
  })
  .refine(timelineRangeFitsSafeInteger, timelineRangeMessage)
  .refine(sourceRangeFitsKnownAssetDuration, sourceRangeMessage())
export type CinemaTimelineImageClip = z.infer<typeof CinemaTimelineImageClipSchema>

export const CinemaTimelineTextClipSchema = z.object({
  ...CinemaTimelineClipBaseShape,
  kind: z.literal("text"),
  text: z.object({
    value: z.string().min(1),
    stylePresetID: z.string().min(1),
  }).strict(),
}).strict()
  .refine(timelineRangeFitsSafeInteger, timelineRangeMessage)
export type CinemaTimelineTextClip = z.infer<typeof CinemaTimelineTextClipSchema>

export const CinemaTimelineClipSchema = z.union([
  CinemaTimelineVideoClipSchema,
  CinemaTimelineAudioClipSchema,
  CinemaTimelineImageClipSchema,
  CinemaTimelineTextClipSchema,
])
export type CinemaTimelineClip = z.infer<typeof CinemaTimelineClipSchema>

export const CinemaTimelineMarkerColorSchema = z.enum([
  "default",
  "warning",
  "success",
  "danger",
])
export type CinemaTimelineMarkerColor = z.infer<typeof CinemaTimelineMarkerColorSchema>

export const CinemaTimelineMarkerSchema = z.object({
  id: z.string().min(1),
  timeUs: CinemaTimelineTimeSchema,
  title: z.string().min(1),
  color: CinemaTimelineMarkerColorSchema,
}).strict()
export type CinemaTimelineMarker = z.infer<typeof CinemaTimelineMarkerSchema>

const CINEMA_TIMELINE_TRACK_CLIP_COMPATIBILITY: Readonly<
  Record<CinemaTimelineTrackKind, ReadonlySet<CinemaTimelineClipKind>>
> = {
  video: new Set(["video"]),
  audio: new Set(["audio"]),
  overlay: new Set(["video", "image", "text"]),
}

export function isCinemaTimelineClipCompatibleWithTrack(
  trackKind: CinemaTimelineTrackKind,
  clipKind: CinemaTimelineClipKind,
) {
  return CINEMA_TIMELINE_TRACK_CLIP_COMPATIBILITY[trackKind].has(clipKind)
}

function findDuplicateID<T extends { id: string }>(items: readonly T[]) {
  const ids = new Set<string>()
  return items.find((item) => {
    if (ids.has(item.id)) return true
    ids.add(item.id)
    return false
  })?.id
}

export const CinemaTimelineDocumentSchema = z.object({
  schemaVersion: z.literal(CINEMA_TIMELINE_SCHEMA_VERSION),
  id: CinemaTimelineIDSchema,
  projectID: z.string().min(1),
  title: z.string().min(1),
  revision: z.number().int().nonnegative(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  settings: CinemaTimelineSettingsSchema,
  tracks: z.array(CinemaTimelineTrackSchema),
  clips: z.array(CinemaTimelineClipSchema),
  markers: z.array(CinemaTimelineMarkerSchema),
}).strict().superRefine((document, context) => {
  const duplicateTrackID = findDuplicateID(document.tracks)
  if (duplicateTrackID) {
    context.addIssue({
      code: "custom",
      message: `Duplicate track id '${duplicateTrackID}'`,
      path: ["tracks"],
    })
  }

  const duplicateClipID = findDuplicateID(document.clips)
  if (duplicateClipID) {
    context.addIssue({
      code: "custom",
      message: `Duplicate clip id '${duplicateClipID}'`,
      path: ["clips"],
    })
  }

  const duplicateMarkerID = findDuplicateID(document.markers)
  if (duplicateMarkerID) {
    context.addIssue({
      code: "custom",
      message: `Duplicate marker id '${duplicateMarkerID}'`,
      path: ["markers"],
    })
  }

  const trackByID = new Map(document.tracks.map((track) => [track.id, track]))
  document.clips.forEach((clip, clipIndex) => {
    const track = trackByID.get(clip.trackID)
    if (!track) {
      context.addIssue({
        code: "custom",
        message: `Clip '${clip.id}' references missing track '${clip.trackID}'`,
        path: ["clips", clipIndex, "trackID"],
      })
      return
    }

    if (!isCinemaTimelineClipCompatibleWithTrack(track.kind, clip.kind)) {
      context.addIssue({
        code: "custom",
        message: `${clip.kind} clip '${clip.id}' is not compatible with ${track.kind} track '${track.id}'`,
        path: ["clips", clipIndex, "kind"],
      })
    }
  })

  for (const track of document.tracks) {
    const orderedClips = document.clips
      .filter((clip) => clip.trackID === track.id)
      .sort((left, right) => left.timelineStartUs - right.timelineStartUs)
    for (let index = 1; index < orderedClips.length; index += 1) {
      const previous = orderedClips[index - 1]
      const current = orderedClips[index]
      if (previous && current && current.timelineStartUs < previous.timelineStartUs + previous.durationUs) {
        context.addIssue({
          code: "custom",
          message: `Clips '${previous.id}' and '${current.id}' overlap on track '${track.id}'`,
          path: ["clips"],
        })
      }
    }
  }
})
export type CinemaTimelineDocument = z.infer<typeof CinemaTimelineDocumentSchema>

const CinemaTimelineCommandBaseShape = {
  id: z.string().min(1),
  timelineID: CinemaTimelineIDSchema,
  baseRevision: z.number().int().nonnegative(),
  actor: z.string().min(1),
} as const

export const CinemaTimelineTrackPatchSchema = z.object({
  title: z.string().min(1).optional(),
  order: z.number().int().nonnegative().optional(),
  locked: z.boolean().optional(),
  muted: z.boolean().optional(),
  hidden: z.boolean().optional(),
}).strict().refine((patch) => Object.keys(patch).length > 0, "Track patch must include at least one field")
export type CinemaTimelineTrackPatch = z.infer<typeof CinemaTimelineTrackPatchSchema>

export const CinemaTimelineClipPatchSchema = z.object({
  title: z.string().min(1).optional(),
  playbackRate: z.number().positive().finite().optional(),
  volume: z.number().nonnegative().finite().optional(),
  opacity: z.number().min(0).max(1).finite().optional(),
  fit: z.enum(["contain", "cover"]).nullable().optional(),
  fadeInUs: CinemaTimelineTimeSchema.nullable().optional(),
  fadeOutUs: CinemaTimelineTimeSchema.nullable().optional(),
  assetRef: CinemaAssetRefSchema.optional(),
}).strict().refine((patch) => Object.keys(patch).length > 0, "Clip patch must include at least one field")
export type CinemaTimelineClipPatch = z.infer<typeof CinemaTimelineClipPatchSchema>

export const CinemaTimelineSettingsPatchSchema = z.object({
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  frameRate: CinemaTimelineFrameRateSchema.optional(),
  backgroundColor: z.string().trim().min(1).optional(),
}).strict().refine((patch) => Object.keys(patch).length > 0, "Settings patch must include at least one field")
export type CinemaTimelineSettingsPatch = z.infer<typeof CinemaTimelineSettingsPatchSchema>

export const CinemaTimelineCommandSchema = z.discriminatedUnion("type", [
  z.object({
    ...CinemaTimelineCommandBaseShape,
    type: z.literal("create-track"),
    track: CinemaTimelineTrackSchema,
  }).strict(),
  z.object({
    ...CinemaTimelineCommandBaseShape,
    type: z.literal("update-track"),
    trackID: z.string().min(1),
    patch: CinemaTimelineTrackPatchSchema,
  }).strict(),
  z.object({
    ...CinemaTimelineCommandBaseShape,
    type: z.literal("add-clip"),
    clip: CinemaTimelineClipSchema,
  }).strict(),
  z.object({
    ...CinemaTimelineCommandBaseShape,
    type: z.literal("move-clip"),
    clipID: z.string().min(1),
    trackID: z.string().min(1),
    timelineStartUs: CinemaTimelineTimeSchema,
  }).strict(),
  z.object({
    ...CinemaTimelineCommandBaseShape,
    type: z.literal("trim-clip"),
    clipID: z.string().min(1),
    timelineStartUs: CinemaTimelineTimeSchema,
    durationUs: PositiveCinemaTimelineTimeSchema,
    sourceInUs: CinemaTimelineTimeSchema,
    sourceDurationUs: PositiveCinemaTimelineTimeSchema,
  }).strict(),
  z.object({
    ...CinemaTimelineCommandBaseShape,
    type: z.literal("split-clip"),
    clipID: z.string().min(1),
    rightClipID: z.string().min(1),
    splitTimeUs: CinemaTimelineTimeSchema,
  }).strict().refine((command) => command.rightClipID !== command.clipID, {
    message: "Split output clip id must be different from the source clip id",
    path: ["rightClipID"],
  }),
  z.object({
    ...CinemaTimelineCommandBaseShape,
    type: z.literal("delete-clips"),
    clipIDs: z.array(z.string().min(1)).min(1),
  }).strict().refine((command) => new Set(command.clipIDs).size === command.clipIDs.length, {
    message: "Clip ids must be unique",
    path: ["clipIDs"],
  }),
  z.object({
    ...CinemaTimelineCommandBaseShape,
    type: z.literal("update-clip"),
    clipID: z.string().min(1),
    patch: CinemaTimelineClipPatchSchema,
  }).strict(),
  z.object({
    ...CinemaTimelineCommandBaseShape,
    type: z.literal("add-marker"),
    marker: CinemaTimelineMarkerSchema,
  }).strict(),
  z.object({
    ...CinemaTimelineCommandBaseShape,
    type: z.literal("move-marker"),
    markerID: z.string().min(1),
    timeUs: CinemaTimelineTimeSchema,
  }).strict(),
  z.object({
    ...CinemaTimelineCommandBaseShape,
    type: z.literal("delete-marker"),
    markerID: z.string().min(1),
  }).strict(),
  z.object({
    ...CinemaTimelineCommandBaseShape,
    type: z.literal("update-settings"),
    patch: CinemaTimelineSettingsPatchSchema,
  }).strict(),
])
export type CinemaTimelineCommand = z.infer<typeof CinemaTimelineCommandSchema>

export const CreateCinemaTimelineBodySchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  settings: CinemaTimelineSettingsSchema.optional(),
}).strict()
export type CreateCinemaTimelineBody = z.infer<typeof CreateCinemaTimelineBodySchema>

export const CinemaTimelineListResultSchema = z.object({
  timelines: z.array(CinemaTimelineDocumentSchema),
}).strict()
export type CinemaTimelineListResult = z.infer<typeof CinemaTimelineListResultSchema>

export const CinemaTimelineEventSchema = z.object({
  time: z.string().min(1),
  timelineID: CinemaTimelineIDSchema,
  type: z.string().min(1),
  actor: z.string().min(1),
  commandID: z.string().min(1),
  baseRevision: z.number().int().nonnegative(),
  revision: z.number().int().positive(),
  message: z.string().min(1),
  command: CinemaTimelineCommandSchema,
}).strict()
export type CinemaTimelineEvent = z.infer<typeof CinemaTimelineEventSchema>

export const CinemaTimelineCommandResultSchema = z.object({
  timeline: CinemaTimelineDocumentSchema,
  event: CinemaTimelineEventSchema,
}).strict()
export type CinemaTimelineCommandResult = z.infer<typeof CinemaTimelineCommandResultSchema>

export const CinemaTimelineEventsResultSchema = z.object({
  events: z.array(CinemaTimelineEventSchema),
  nextCursor: z.number().int().nonnegative(),
}).strict()
export type CinemaTimelineEventsResult = z.infer<typeof CinemaTimelineEventsResultSchema>

export const DeleteCinemaTimelineResultSchema = z.object({
  timelineID: CinemaTimelineIDSchema,
  deleted: z.literal(true),
}).strict()
export type DeleteCinemaTimelineResult = z.infer<typeof DeleteCinemaTimelineResultSchema>

export const CinemaTimelineWaveformSchema = z.object({
  clipID: z.string().min(1),
  contentRevision: z.number().int().nonnegative(),
  sampleCount: z.number().int().positive().max(2048),
  peaks: z.array(z.number().min(0).max(1)).max(2048),
  generatedAt: z.string().min(1),
}).strict().refine((waveform) => waveform.peaks.length === waveform.sampleCount, {
  message: "Waveform sample count must match peak count",
  path: ["peaks"],
})
export type CinemaTimelineWaveform = z.infer<typeof CinemaTimelineWaveformSchema>
