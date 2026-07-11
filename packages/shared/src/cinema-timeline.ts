import { z } from "zod"

import { CinemaAssetRefSchema } from "./cinema"

export const CINEMA_TIMELINE_SCHEMA_VERSION = 2 as const
export const CINEMA_TIMELINE_LEGACY_SCHEMA_VERSION = 1 as const
export const CINEMA_TIMELINE_SAMPLE_RATE = 48_000 as const
export const CINEMA_TIMELINE_MAX_SUBTITLE_CUES = 10_000 as const
export const CINEMA_TIMELINE_MAX_SUBTITLE_TEXT_LENGTH = 4_000 as const

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

export const CinemaTimelineTrackKindSchema = z.enum(["video", "audio", "overlay", "subtitle"])
export type CinemaTimelineTrackKind = z.infer<typeof CinemaTimelineTrackKindSchema>

export const CinemaTimelineClipKindSchema = z.enum(["video", "audio", "image", "text", "subtitle"])
export type CinemaTimelineClipKind = z.infer<typeof CinemaTimelineClipKindSchema>

const CinemaTimelineTrackBaseShape = {
  id: z.string().min(1),
  title: z.string().min(1),
  order: z.number().int().nonnegative(),
  locked: z.boolean(),
  hidden: z.boolean(),
} as const

export const CinemaTimelineSubtitleRoleSchema = z.enum(["subtitle", "caption", "forced"])
export type CinemaTimelineSubtitleRole = z.infer<typeof CinemaTimelineSubtitleRoleSchema>

export const CinemaTimelineSubtitleAlignmentSchema = z.enum([
  "bottom-left",
  "bottom-center",
  "bottom-right",
])
export type CinemaTimelineSubtitleAlignment = z.infer<typeof CinemaTimelineSubtitleAlignmentSchema>

const CinemaTimelineSubtitleColorSchema = z.string().regex(/^#[0-9A-Fa-f]{8}$/, "Subtitle colors must use #RRGGBBAA")

export const CinemaTimelineSubtitleStyleSchema = z.object({
  fontFamilyID: z.literal("anybox-subtitle-sans-v1"),
  fontSizePx: z.number().int().min(12).max(240),
  textColor: CinemaTimelineSubtitleColorSchema,
  outlineColor: CinemaTimelineSubtitleColorSchema,
  outlineWidthPx: z.number().min(0).max(12).finite(),
  backgroundColor: CinemaTimelineSubtitleColorSchema,
  alignment: CinemaTimelineSubtitleAlignmentSchema,
  marginBottomPx: z.number().int().min(0).max(540),
}).strict()
export type CinemaTimelineSubtitleStyle = z.infer<typeof CinemaTimelineSubtitleStyleSchema>

export const CINEMA_TIMELINE_DEFAULT_SUBTITLE_STYLE: CinemaTimelineSubtitleStyle = {
  fontFamilyID: "anybox-subtitle-sans-v1",
  fontSizePx: 52,
  textColor: "#FFFFFFFF",
  outlineColor: "#000000FF",
  outlineWidthPx: 2,
  backgroundColor: "#00000000",
  alignment: "bottom-center",
  marginBottomPx: 64,
}

const CinemaTimelineMediaTrackSchema = z.object({
  ...CinemaTimelineTrackBaseShape,
  kind: z.enum(["video", "audio", "overlay"]),
  muted: z.boolean(),
}).strict()

export const CinemaTimelineSubtitleTrackSchema = z.object({
  ...CinemaTimelineTrackBaseShape,
  kind: z.literal("subtitle"),
  language: z.string().trim().min(1).max(64).refine((language) => {
    try {
      new Intl.Locale(language)
      return true
    } catch {
      return false
    }
  }, "Subtitle language must be a valid BCP 47 tag"),
  role: CinemaTimelineSubtitleRoleSchema,
  style: CinemaTimelineSubtitleStyleSchema,
}).strict()
export type CinemaTimelineSubtitleTrack = z.infer<typeof CinemaTimelineSubtitleTrackSchema>

export const CinemaTimelineTrackSchema = z.discriminatedUnion("kind", [
  CinemaTimelineMediaTrackSchema,
  CinemaTimelineSubtitleTrackSchema,
])
export type CinemaTimelineTrack = z.infer<typeof CinemaTimelineTrackSchema>

export const CinemaTimelineFitSchema = z.enum(["contain", "cover", "stretch"])
export type CinemaTimelineFit = z.infer<typeof CinemaTimelineFitSchema>

export const CinemaTimelineTransformSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  scale: z.number().positive().finite(),
  rotationDegrees: z.number().finite(),
  anchorX: z.number().min(0).max(1).finite(),
  anchorY: z.number().min(0).max(1).finite(),
}).strict()
export type CinemaTimelineTransform = z.infer<typeof CinemaTimelineTransformSchema>

const CinemaTimelineClipBaseShape = {
  id: z.string().min(1),
  trackID: z.string().min(1),
  title: z.string().min(1),
  timelineStartUs: CinemaTimelineTimeSchema,
  durationUs: PositiveCinemaTimelineTimeSchema,
  playbackRate: z.number().positive().finite(),
  volume: z.number().nonnegative().finite(),
  opacity: z.number().min(0).max(1).finite(),
  fit: CinemaTimelineFitSchema.optional(),
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
  transform: CinemaTimelineTransformSchema.optional(),
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
  transform: CinemaTimelineTransformSchema.optional(),
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
  transform: CinemaTimelineTransformSchema.optional(),
}).strict()
  .refine(timelineRangeFitsSafeInteger, timelineRangeMessage)
export type CinemaTimelineTextClip = z.infer<typeof CinemaTimelineTextClipSchema>

export const CinemaTimelineSubtitleCueSchema = z.object({
  id: z.string().min(1),
  trackID: z.string().min(1),
  kind: z.literal("subtitle"),
  timelineStartUs: CinemaTimelineTimeSchema,
  durationUs: PositiveCinemaTimelineTimeSchema,
  cueText: z.string().trim().min(1).max(CINEMA_TIMELINE_MAX_SUBTITLE_TEXT_LENGTH),
  speaker: z.string().trim().min(1).max(160).optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
}).strict()
  .refine(timelineRangeFitsSafeInteger, timelineRangeMessage)
export type CinemaTimelineSubtitleCue = z.infer<typeof CinemaTimelineSubtitleCueSchema>

export const CinemaTimelineClipSchema = z.union([
  CinemaTimelineVideoClipSchema,
  CinemaTimelineAudioClipSchema,
  CinemaTimelineImageClipSchema,
  CinemaTimelineTextClipSchema,
  CinemaTimelineSubtitleCueSchema,
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
  subtitle: new Set(["subtitle"]),
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

const CinemaTimelineLegacyTrackSchema = z.object({
  ...CinemaTimelineTrackBaseShape,
  kind: z.enum(["video", "audio", "overlay"]),
  muted: z.boolean(),
}).strict()

const CinemaTimelineLegacyClipSchema = z.union([
  CinemaTimelineVideoClipSchema,
  CinemaTimelineAudioClipSchema,
  CinemaTimelineImageClipSchema,
  CinemaTimelineTextClipSchema,
])

const CinemaTimelineDocumentShape = {
  id: CinemaTimelineIDSchema,
  projectID: z.string().min(1),
  title: z.string().min(1),
  revision: z.number().int().nonnegative(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  settings: CinemaTimelineSettingsSchema,
  markers: z.array(CinemaTimelineMarkerSchema),
} as const

function validateCinemaTimelineDocument(
  document: {
    tracks: CinemaTimelineTrack[]
    clips: CinemaTimelineClip[]
    markers: Array<{ id: string }>
  },
  context: z.RefinementCtx,
) {
  const duplicateTrackID = findDuplicateID(document.tracks)
  if (duplicateTrackID) {
    context.addIssue({
      code: "custom",
      message: `Duplicate track id '${duplicateTrackID}'`,
      path: ["tracks"],
    })
  }

  const duplicateTrackOrder = document.tracks.find((track, index) => (
    document.tracks.findIndex((candidate) => candidate.order === track.order) !== index
  ))?.order
  if (duplicateTrackOrder !== undefined) {
    context.addIssue({
      code: "custom",
      message: `Duplicate track order '${duplicateTrackOrder}'`,
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
    if (track.kind === "subtitle") continue
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
}

export const CinemaTimelineDocumentV2Schema = z.object({
  schemaVersion: z.literal(CINEMA_TIMELINE_SCHEMA_VERSION),
  ...CinemaTimelineDocumentShape,
  tracks: z.array(CinemaTimelineTrackSchema),
  clips: z.array(CinemaTimelineClipSchema),
}).strict().superRefine(validateCinemaTimelineDocument)

export const CinemaTimelineDocumentV1Schema = z.object({
  schemaVersion: z.literal(CINEMA_TIMELINE_LEGACY_SCHEMA_VERSION),
  ...CinemaTimelineDocumentShape,
  tracks: z.array(CinemaTimelineLegacyTrackSchema),
  clips: z.array(CinemaTimelineLegacyClipSchema),
}).strict()

export const CinemaTimelineDocumentSchema = z.union([
  CinemaTimelineDocumentV2Schema,
  CinemaTimelineDocumentV1Schema,
]).transform((document) => (
  document.schemaVersion === CINEMA_TIMELINE_LEGACY_SCHEMA_VERSION
    ? { ...document, schemaVersion: CINEMA_TIMELINE_SCHEMA_VERSION }
    : document
)).pipe(CinemaTimelineDocumentV2Schema)
export type CinemaTimelineDocument = z.infer<typeof CinemaTimelineDocumentSchema>

const CinemaTimelineCommandBaseShape = {
  id: z.string().min(1),
  timelineID: CinemaTimelineIDSchema,
  baseRevision: z.number().int().nonnegative(),
  actor: z.string().min(1),
} as const

export const CinemaTimelineTrackPatchSchema = z.object({
  title: z.string().min(1).optional(),
  locked: z.boolean().optional(),
  muted: z.boolean().optional(),
  hidden: z.boolean().optional(),
  language: CinemaTimelineSubtitleTrackSchema.shape.language.optional(),
  role: CinemaTimelineSubtitleRoleSchema.optional(),
  style: CinemaTimelineSubtitleStyleSchema.optional(),
}).strict().refine((patch) => Object.keys(patch).length > 0, "Track patch must include at least one field")
export type CinemaTimelineTrackPatch = z.infer<typeof CinemaTimelineTrackPatchSchema>

export const CinemaTimelineClipPatchSchema = z.object({
  title: z.string().min(1).optional(),
  playbackRate: z.number().positive().finite().optional(),
  volume: z.number().nonnegative().finite().optional(),
  opacity: z.number().min(0).max(1).finite().optional(),
  fit: CinemaTimelineFitSchema.nullable().optional(),
  transform: CinemaTimelineTransformSchema.nullable().optional(),
  fadeInUs: CinemaTimelineTimeSchema.nullable().optional(),
  fadeOutUs: CinemaTimelineTimeSchema.nullable().optional(),
  assetRef: CinemaAssetRefSchema.optional(),
  cueText: z.string().trim().min(1).max(CINEMA_TIMELINE_MAX_SUBTITLE_TEXT_LENGTH).optional(),
  speaker: z.string().trim().min(1).max(160).nullable().optional(),
}).strict().refine((patch) => Object.keys(patch).length > 0, "Clip patch must include at least one field")
export type CinemaTimelineClipPatch = z.infer<typeof CinemaTimelineClipPatchSchema>

export const CinemaTimelineClipUpdateSchema = z.object({
  clipID: z.string().min(1),
  patch: CinemaTimelineClipPatchSchema,
}).strict()
export type CinemaTimelineClipUpdate = z.infer<typeof CinemaTimelineClipUpdateSchema>

export const CinemaTimelineSettingsPatchSchema = z.object({
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  frameRate: CinemaTimelineFrameRateSchema.optional(),
  backgroundColor: z.string().trim().min(1).optional(),
}).strict().refine((patch) => Object.keys(patch).length > 0, "Settings patch must include at least one field")
export type CinemaTimelineSettingsPatch = z.infer<typeof CinemaTimelineSettingsPatchSchema>

export const CinemaTimelineClipPlacementSchema = z.object({
  clipID: z.string().min(1),
  trackID: z.string().min(1),
  timelineStartUs: CinemaTimelineTimeSchema,
}).strict()
export type CinemaTimelineClipPlacement = z.infer<typeof CinemaTimelineClipPlacementSchema>

export const CinemaTimelineCommandSchema = z.discriminatedUnion("type", [
  z.object({
    ...CinemaTimelineCommandBaseShape,
    type: z.literal("create-track"),
    track: CinemaTimelineTrackSchema,
  }).strict(),
  z.object({
    ...CinemaTimelineCommandBaseShape,
    type: z.literal("create-track-with-clips"),
    track: CinemaTimelineTrackSchema,
    clips: z.array(CinemaTimelineClipSchema).min(1).max(CINEMA_TIMELINE_MAX_SUBTITLE_CUES),
  }).strict().superRefine((command, context) => {
    const clipIDs = new Set<string>()
    command.clips.forEach((clip, index) => {
      if (clip.trackID !== command.track.id) {
        context.addIssue({ code: "custom", message: "Imported clips must target the created track", path: ["clips", index, "trackID"] })
      }
      if (clipIDs.has(clip.id)) {
        context.addIssue({ code: "custom", message: "Clip ids must be unique", path: ["clips", index, "id"] })
      }
      clipIDs.add(clip.id)
    })
  }),
  z.object({
    ...CinemaTimelineCommandBaseShape,
    type: z.literal("update-track"),
    trackID: z.string().min(1),
    patch: CinemaTimelineTrackPatchSchema,
  }).strict(),
  z.object({
    ...CinemaTimelineCommandBaseShape,
    type: z.literal("delete-track"),
    trackID: z.string().min(1),
    deleteClips: z.boolean(),
  }).strict(),
  z.object({
    ...CinemaTimelineCommandBaseShape,
    type: z.literal("reorder-tracks"),
    trackIDs: z.array(z.string().min(1)).min(1),
  }).strict().refine((command) => new Set(command.trackIDs).size === command.trackIDs.length, {
    message: "Track ids must be unique",
    path: ["trackIDs"],
  }),
  z.object({
    ...CinemaTimelineCommandBaseShape,
    type: z.literal("add-clip"),
    clip: CinemaTimelineClipSchema,
  }).strict(),
  z.object({
    ...CinemaTimelineCommandBaseShape,
    type: z.literal("add-clips"),
    clips: z.array(CinemaTimelineClipSchema).min(1),
  }).strict().refine((command) => (
    new Set(command.clips.map((clip) => clip.id)).size === command.clips.length
  ), {
    message: "Clip ids must be unique",
    path: ["clips"],
  }),
  z.object({
    ...CinemaTimelineCommandBaseShape,
    type: z.literal("move-clip"),
    clipID: z.string().min(1),
    trackID: z.string().min(1),
    timelineStartUs: CinemaTimelineTimeSchema,
  }).strict(),
  z.object({
    ...CinemaTimelineCommandBaseShape,
    type: z.literal("move-clips"),
    placements: z.array(CinemaTimelineClipPlacementSchema).min(1),
  }).strict().refine((command) => (
    new Set(command.placements.map((placement) => placement.clipID)).size === command.placements.length
  ), {
    message: "Clip placement ids must be unique",
    path: ["placements"],
  }),
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
    type: z.literal("trim-timed-clip"),
    clipID: z.string().min(1),
    timelineStartUs: CinemaTimelineTimeSchema,
    durationUs: PositiveCinemaTimelineTimeSchema,
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
    type: z.literal("ripple-delete-clips"),
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
    type: z.literal("update-clips"),
    updates: z.array(CinemaTimelineClipUpdateSchema).min(1),
  }).strict().refine((command) => (
    new Set(command.updates.map((update) => update.clipID)).size === command.updates.length
  ), {
    message: "Clip update ids must be unique",
    path: ["updates"],
  }),
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
