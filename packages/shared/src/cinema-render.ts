import { z } from "zod"

import { CinemaAssetRefSchema } from "./cinema"
import {
  CinemaTimelineFrameRateSchema,
  CinemaTimelineIDSchema,
  CinemaTimelineTimeSchema,
  type CinemaTimelineClipKind,
  type CinemaTimelineTrackKind,
} from "./cinema-timeline"

export const CINEMA_RENDER_SCHEMA_VERSION = 1 as const
export const CINEMA_RENDER_MAX_DIMENSION = 7_680 as const
export const CINEMA_RENDER_MAX_FRAME_RATE = 120 as const
export const CINEMA_RENDER_MAX_TARGET_VIDEO_BITRATE_KBPS = 100_000 as const
export const CINEMA_RENDER_MAX_DURATION_US = 86_400_000_000 as const

export const CinemaRenderSafeIDSchema = z.string()
  .min(1)
  .max(128)
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9_-]*$/,
    "Render id must contain only letters, numbers, underscores, and hyphens",
  )
export type CinemaRenderSafeID = z.infer<typeof CinemaRenderSafeIDSchema>

export const CinemaRenderJobIDSchema = CinemaRenderSafeIDSchema
export type CinemaRenderJobID = z.infer<typeof CinemaRenderJobIDSchema>

export const CinemaRenderOperationIDSchema = CinemaRenderSafeIDSchema
export type CinemaRenderOperationID = z.infer<typeof CinemaRenderOperationIDSchema>

const WINDOWS_RESERVED_FILE_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i
const FILE_EXTENSION_SUFFIX = /\.[A-Za-z0-9]{1,16}$/

export const CinemaRenderOutputNameSchema = z.string()
  .trim()
  .min(1)
  .max(160)
  .refine((value) => value !== "." && value !== "..", "Output name must not be a relative path")
  .refine((value) => !/[\\/]/.test(value), "Output name must not contain path separators")
  .refine((value) => !/[\u0000-\u001f\u007f]/.test(value), "Output name must not contain control characters")
  .refine((value) => !/[. ]$/.test(value), "Output name must not end with a dot or space")
  .refine((value) => !WINDOWS_RESERVED_FILE_NAME.test(value), "Output name must not use a reserved file name")
  .refine((value) => !FILE_EXTENSION_SUFFIX.test(value), "Output name must not include a file extension")
export type CinemaRenderOutputName = z.infer<typeof CinemaRenderOutputNameSchema>

const CinemaRenderDimensionSchema = z.number()
  .int()
  .positive()
  .max(CINEMA_RENDER_MAX_DIMENSION)
  .refine((value) => value % 2 === 0, "Render dimensions must be even")

const CinemaRenderFrameRateSchema = CinemaTimelineFrameRateSchema.refine(
  (frameRate) => frameRate.numerator / frameRate.denominator <= CINEMA_RENDER_MAX_FRAME_RATE,
  `Render frame rate must not exceed ${CINEMA_RENDER_MAX_FRAME_RATE} fps`,
)

export const CinemaRenderQualitySchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("balanced"),
  }).strict(),
  z.object({
    mode: z.literal("quality"),
  }).strict(),
  z.object({
    mode: z.literal("target-bitrate"),
    targetVideoBitrateKbps: z.number()
      .int()
      .min(100)
      .max(CINEMA_RENDER_MAX_TARGET_VIDEO_BITRATE_KBPS),
  }).strict(),
])
export type CinemaRenderQuality = z.infer<typeof CinemaRenderQualitySchema>

export const CinemaRenderRangeSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("full"),
  }).strict(),
  z.object({
    type: z.literal("custom"),
    startUs: CinemaTimelineTimeSchema,
    endUs: CinemaTimelineTimeSchema.refine(
      (value) => value <= CINEMA_RENDER_MAX_DURATION_US,
      "Render range exceeds the maximum supported duration",
    ),
  }).strict().refine((range) => range.startUs < range.endUs, {
    message: "Custom render range must end after it starts",
    path: ["endUs"],
  }),
])
export type CinemaRenderRange = z.infer<typeof CinemaRenderRangeSchema>

export const CinemaRenderSubtitlesSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("none") }).strict(),
  z.object({
    mode: z.literal("burn-in"),
    trackID: z.string().min(1),
  }).strict(),
])
export type CinemaRenderSubtitles = z.infer<typeof CinemaRenderSubtitlesSchema>

export const CinemaRenderSettingsSchema = z.object({
  format: z.literal("mp4"),
  videoCodec: z.literal("h264"),
  audioCodec: z.literal("aac"),
  width: CinemaRenderDimensionSchema,
  height: CinemaRenderDimensionSchema,
  frameRate: CinemaRenderFrameRateSchema,
  quality: CinemaRenderQualitySchema,
  audioBitrateKbps: z.union([
    z.literal(128),
    z.literal(192),
    z.literal(256),
    z.literal(320),
  ]),
  range: CinemaRenderRangeSchema,
  outputName: CinemaRenderOutputNameSchema,
  subtitles: CinemaRenderSubtitlesSchema.optional(),
}).strict()
export type CinemaRenderSettings = z.infer<typeof CinemaRenderSettingsSchema>

export function cinemaRenderRangeFitsTimeline(
  range: CinemaRenderRange,
  timelineDurationUs: number,
) {
  return range.type === "full" || range.endUs <= timelineDurationUs
}

export const CinemaRenderPreflightIssueSeveritySchema = z.enum(["error", "warning"])
export type CinemaRenderPreflightIssueSeverity = z.infer<typeof CinemaRenderPreflightIssueSeveritySchema>

export const CinemaRenderPreflightIssueCodeSchema = z.enum([
  "timeline-empty",
  "timeline-revision-missing",
  "timeline-invalid",
  "main-video-missing",
  "asset-missing",
  "asset-trashed",
  "asset-not-ready",
  "asset-scope-mismatch",
  "asset-revision-stale",
  "asset-kind-mismatch",
  "asset-source-range-invalid",
  "personal-asset-copy-required",
  "clip-unsupported",
  "track-unsupported",
  "custom-range-empty",
  "render-runtime-unavailable",
  "video-encoder-unavailable",
  "audio-encoder-unavailable",
  "subtitle-track-invalid",
  "subtitle-track-empty",
  "subtitle-runtime-unavailable",
  "subtitle-quality-warning",
  "render-settings-invalid",
  "working-space-insufficient",
  "output-name-unavailable",
])
export type CinemaRenderPreflightIssueCode = z.infer<typeof CinemaRenderPreflightIssueCodeSchema>

export const CinemaRenderPreflightIssueSchema = z.object({
  code: CinemaRenderPreflightIssueCodeSchema,
  severity: CinemaRenderPreflightIssueSeveritySchema,
  message: z.string().min(1).max(1_000),
  clipID: z.string().min(1).optional(),
  assetID: z.string().min(1).optional(),
}).strict()
export type CinemaRenderPreflightIssue = z.infer<typeof CinemaRenderPreflightIssueSchema>

export const CinemaRenderPreflightResultSchema = z.object({
  timelineID: CinemaTimelineIDSchema,
  timelineRevision: z.number().int().nonnegative(),
  checkedAt: z.string().datetime({ offset: true }),
  ready: z.boolean(),
  durationUs: CinemaTimelineTimeSchema,
  estimatedFrameCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  estimatedInputBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  estimatedWorkingBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  issues: z.array(CinemaRenderPreflightIssueSchema),
  support: z.object({
    videoClips: z.number().int().nonnegative(),
    audioClips: z.number().int().nonnegative(),
    imageClips: z.number().int().nonnegative(),
    textClips: z.number().int().nonnegative(),
  }).strict(),
}).strict().superRefine((result, context) => {
  const hasBlockingIssue = result.issues.some((issue) => issue.severity === "error")
  if (result.ready === hasBlockingIssue) {
    context.addIssue({
      code: "custom",
      message: result.ready
        ? "A ready preflight must not contain blocking issues"
        : "A blocked preflight must contain at least one blocking issue",
      path: ["ready"],
    })
  }
})
export type CinemaRenderPreflightResult = z.infer<typeof CinemaRenderPreflightResultSchema>

export const CinemaRenderJobStatusSchema = z.enum([
  "queued",
  "snapshotting",
  "probing",
  "rendering",
  "registering",
  "succeeded",
  "failed",
  "canceled",
  "interrupted",
])
export type CinemaRenderJobStatus = z.infer<typeof CinemaRenderJobStatusSchema>

export const CINEMA_RENDER_TERMINAL_STATUSES: ReadonlySet<CinemaRenderJobStatus> = new Set([
  "succeeded",
  "failed",
  "canceled",
  "interrupted",
])

export const CINEMA_RENDER_STATUS_TRANSITIONS: Readonly<
  Record<CinemaRenderJobStatus, ReadonlySet<CinemaRenderJobStatus>>
> = {
  queued: new Set(["snapshotting", "failed", "canceled"]),
  snapshotting: new Set(["probing", "failed", "canceled", "interrupted"]),
  probing: new Set(["rendering", "failed", "canceled", "interrupted"]),
  rendering: new Set(["registering", "failed", "canceled", "interrupted"]),
  registering: new Set(["succeeded", "failed", "canceled", "interrupted"]),
  succeeded: new Set(),
  failed: new Set(),
  canceled: new Set(),
  interrupted: new Set(),
}

export function isCinemaRenderTerminalStatus(status: CinemaRenderJobStatus) {
  return CINEMA_RENDER_TERMINAL_STATUSES.has(status)
}

export function canTransitionCinemaRenderJobStatus(
  from: CinemaRenderJobStatus,
  to: CinemaRenderJobStatus,
) {
  return CINEMA_RENDER_STATUS_TRANSITIONS[from].has(to)
}

export const CinemaRenderErrorCodeSchema = z.enum([
  "timeline-revision-conflict",
  "preflight-blocked",
  "snapshot-failed",
  "probe-failed",
  "render-runtime-unavailable",
  "render-start-failed",
  "render-failed",
  "render-timeout",
  "render-canceled",
  "render-interrupted",
  "output-validation-failed",
  "output-registration-failed",
  "working-space-insufficient",
  "permission-denied",
  "job-not-found",
  "invalid-status-transition",
  "internal-error",
])
export type CinemaRenderErrorCode = z.infer<typeof CinemaRenderErrorCodeSchema>

export const CinemaRenderJobProgressSchema = z.object({
  phase: CinemaRenderJobStatusSchema,
  percent: z.number().min(0).max(100).finite().optional(),
  renderedUs: CinemaTimelineTimeSchema.optional(),
  message: z.string().min(1).max(1_000).optional(),
}).strict()
export type CinemaRenderJobProgress = z.infer<typeof CinemaRenderJobProgressSchema>

export const CinemaRenderRuntimeIDSchema = z.string()
  .min(1)
  .max(256)
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._:+-]*$/,
    "Render runtime id must be redacted and path-free",
  )
export type CinemaRenderRuntimeID = z.infer<typeof CinemaRenderRuntimeIDSchema>

export const CinemaRenderPlatformSchema = z.enum(["win32", "darwin", "linux"])
export type CinemaRenderPlatform = z.infer<typeof CinemaRenderPlatformSchema>

export const CinemaRenderVideoEncoderSchema = z.enum([
  "libx264",
  "h264_mf",
  "h264_videotoolbox",
])
export type CinemaRenderVideoEncoder = z.infer<typeof CinemaRenderVideoEncoderSchema>

export const CinemaRenderAudioEncoderSchema = z.literal("aac")
export type CinemaRenderAudioEncoder = z.infer<typeof CinemaRenderAudioEncoderSchema>

export const CinemaRenderExecutionRuntimeSchema = z.object({
  runtimeID: CinemaRenderRuntimeIDSchema,
  ffmpegVersion: z.string()
    .min(1)
    .max(256)
    .refine((value) => !/[\\/\u0000-\u001f\u007f]/.test(value), "FFmpeg version must be path-free"),
  platform: CinemaRenderPlatformSchema,
  videoEncoder: CinemaRenderVideoEncoderSchema,
  audioEncoder: CinemaRenderAudioEncoderSchema,
}).strict()
export type CinemaRenderExecutionRuntime = z.infer<typeof CinemaRenderExecutionRuntimeSchema>

export const CinemaRenderFailurePhaseSchema = z.enum([
  "queued",
  "snapshotting",
  "probing",
  "rendering",
  "registering",
  "unknown",
])
export type CinemaRenderFailurePhase = z.infer<typeof CinemaRenderFailurePhaseSchema>

/** Path-free facts suitable for UI and support diagnostics. */
export const CinemaRenderDiagnosticSummarySchema = z.object({
  phase: CinemaRenderFailurePhaseSchema,
  runtime: CinemaRenderExecutionRuntimeSchema.optional(),
}).strict()
export type CinemaRenderDiagnosticSummary = z.infer<typeof CinemaRenderDiagnosticSummarySchema>

export const CinemaRenderJobErrorSchema = z.object({
  code: CinemaRenderErrorCodeSchema,
  message: z.string().min(1).max(1_000),
  retryable: z.boolean(),
  diagnosticSummary: CinemaRenderDiagnosticSummarySchema.optional(),
}).strict()
export type CinemaRenderJobError = z.infer<typeof CinemaRenderJobErrorSchema>

export const CinemaRenderJobSchema = z.object({
  schemaVersion: z.literal(CINEMA_RENDER_SCHEMA_VERSION),
  id: CinemaRenderJobIDSchema,
  projectID: z.string().min(1),
  timelineID: CinemaTimelineIDSchema,
  timelineRevision: z.number().int().nonnegative(),
  operationID: CinemaRenderOperationIDSchema,
  retryOfJobID: CinemaRenderJobIDSchema.optional(),
  status: CinemaRenderJobStatusSchema,
  settings: CinemaRenderSettingsSchema,
  progress: CinemaRenderJobProgressSchema,
  executionRuntime: CinemaRenderExecutionRuntimeSchema.optional(),
  outputAssetRef: CinemaAssetRefSchema.optional(),
  error: CinemaRenderJobErrorSchema.optional(),
  createdAt: z.string().datetime({ offset: true }),
  startedAt: z.string().datetime({ offset: true }).optional(),
  finishedAt: z.string().datetime({ offset: true }).optional(),
  updatedAt: z.string().datetime({ offset: true }),
}).strict().superRefine((job, context) => {
  if (job.progress.phase !== job.status) {
    context.addIssue({
      code: "custom",
      message: "Render progress phase must match the job status",
      path: ["progress", "phase"],
    })
  }
  const terminal = isCinemaRenderTerminalStatus(job.status)
  if (terminal !== (job.finishedAt !== undefined)) {
    context.addIssue({
      code: "custom",
      message: terminal
        ? "Terminal render jobs must include finishedAt"
        : "Non-terminal render jobs must not include finishedAt",
      path: ["finishedAt"],
    })
  }
  if (job.status === "failed" && !job.error) {
    context.addIssue({
      code: "custom",
      message: "Failed render jobs must include an error",
      path: ["error"],
    })
  }
  if (job.status !== "failed" && job.status !== "interrupted" && job.error) {
    context.addIssue({
      code: "custom",
      message: "Only failed or interrupted render jobs may include an error",
      path: ["error"],
    })
  }
  if (job.status === "interrupted" && job.error && job.error.code !== "render-interrupted") {
    context.addIssue({
      code: "custom",
      message: "Interrupted render job errors must use render-interrupted",
      path: ["error", "code"],
    })
  }
  if (job.status === "failed" && job.error?.code === "render-interrupted") {
    context.addIssue({
      code: "custom",
      message: "render-interrupted is reserved for interrupted render jobs",
      path: ["error", "code"],
    })
  }
  if ((job.status === "succeeded") !== (job.outputAssetRef !== undefined)) {
    context.addIssue({
      code: "custom",
      message: job.status === "succeeded"
        ? "Succeeded render jobs must include an output asset reference"
        : "Only succeeded render jobs may include an output asset reference",
      path: ["outputAssetRef"],
    })
  }
})
export type CinemaRenderJob = z.infer<typeof CinemaRenderJobSchema>

export const CinemaRenderEventTypeSchema = z.enum([
  "job-created",
  "runtime-bound",
  "snapshot-started",
  "snapshot-completed",
  "probe-completed",
  "render-started",
  "render-progress",
  "registration-started",
  "render-succeeded",
  "render-failed",
  "render-canceled",
  "render-interrupted",
])
export type CinemaRenderEventType = z.infer<typeof CinemaRenderEventTypeSchema>

export const CinemaRenderJobEventSchema = z.object({
  schemaVersion: z.literal(CINEMA_RENDER_SCHEMA_VERSION),
  id: CinemaRenderSafeIDSchema,
  jobID: CinemaRenderJobIDSchema,
  type: CinemaRenderEventTypeSchema,
  createdAt: z.string().datetime({ offset: true }),
  executionRuntime: CinemaRenderExecutionRuntimeSchema.optional(),
  progress: CinemaRenderJobProgressSchema.optional(),
  error: CinemaRenderJobErrorSchema.optional(),
  outputAssetRef: CinemaAssetRefSchema.optional(),
  message: z.string().min(1).max(1_000).optional(),
}).strict().superRefine((event, context) => {
  if (event.type === "runtime-bound" && !event.executionRuntime) {
    context.addIssue({
      code: "custom",
      message: "Runtime-bound events must include the selected execution runtime",
      path: ["executionRuntime"],
    })
  }
  if (event.type === "render-progress" && event.progress?.phase !== "rendering") {
    context.addIssue({
      code: "custom",
      message: "Render progress events must include rendering progress",
      path: ["progress"],
    })
  }
  if (event.type === "render-failed" && !event.error) {
    context.addIssue({
      code: "custom",
      message: "Render failed events must include an error",
      path: ["error"],
    })
  }
  if (event.type === "render-succeeded" && !event.outputAssetRef) {
    context.addIssue({
      code: "custom",
      message: "Render succeeded events must include an output asset reference",
      path: ["outputAssetRef"],
    })
  }
})
export type CinemaRenderJobEvent = z.infer<typeof CinemaRenderJobEventSchema>

export const CreateCinemaRenderJobBodySchema = z.object({
  operationID: CinemaRenderOperationIDSchema,
  expectedTimelineRevision: z.number().int().nonnegative(),
  settings: CinemaRenderSettingsSchema,
}).strict()
export type CreateCinemaRenderJobBody = z.infer<typeof CreateCinemaRenderJobBodySchema>

export const RetryCinemaRenderJobBodySchema = z.object({
  operationID: CinemaRenderOperationIDSchema,
}).strict()
export type RetryCinemaRenderJobBody = z.infer<typeof RetryCinemaRenderJobBodySchema>

export const CinemaRenderJobListResultSchema = z.object({
  items: z.array(CinemaRenderJobSchema),
}).strict()
export type CinemaRenderJobListResult = z.infer<typeof CinemaRenderJobListResultSchema>

export const CinemaRenderJobEventsResultSchema = z.object({
  items: z.array(CinemaRenderJobEventSchema),
}).strict()
export type CinemaRenderJobEventsResult = z.infer<typeof CinemaRenderJobEventsResultSchema>

export const CinemaRenderRuntimeStatusSchema = z.object({
  available: z.boolean(),
  version: z.string().min(1).optional(),
  platform: CinemaRenderPlatformSchema,
  ffprobeAvailable: z.boolean(),
  videoEncoders: z.array(CinemaRenderVideoEncoderSchema),
  audioEncoders: z.array(CinemaRenderAudioEncoderSchema),
  subtitleRenderer: z.literal("libass").nullable().optional(),
  issue: z.string().min(1).max(1_000).optional(),
}).strict().superRefine((runtime, context) => {
  if (runtime.available && !runtime.ffprobeAvailable) {
    context.addIssue({
      code: "custom",
      message: "An available render runtime must include ffprobe",
      path: ["ffprobeAvailable"],
    })
  }
  if (!runtime.available && !runtime.issue) {
    context.addIssue({
      code: "custom",
      message: "An unavailable render runtime must explain the issue",
      path: ["issue"],
    })
  }
})
export type CinemaRenderRuntimeStatus = z.infer<typeof CinemaRenderRuntimeStatusSchema>

export type CinemaRenderSupportLevel = "supported" | "blocked"

export type CinemaRenderSupportRule = Readonly<{
  level: CinemaRenderSupportLevel
  reason?: string
}>

export const CINEMA_RENDER_V1_SUPPORT_MATRIX: Readonly<
  Record<CinemaTimelineTrackKind, Readonly<Record<CinemaTimelineClipKind, CinemaRenderSupportRule>>>
> = {
  video: {
    video: { level: "supported" },
    audio: { level: "blocked", reason: "Audio clips must use an audio track" },
    image: { level: "blocked", reason: "Images must use the overlay track" },
    text: { level: "blocked", reason: "Text must use the overlay track" },
    subtitle: { level: "blocked", reason: "Subtitles must use a subtitle track" },
  },
  audio: {
    video: { level: "blocked", reason: "Video clips must use the video track" },
    audio: { level: "supported" },
    image: { level: "blocked", reason: "Images must use the overlay track" },
    text: { level: "blocked", reason: "Text must use the overlay track" },
    subtitle: { level: "blocked", reason: "Subtitles must use a subtitle track" },
  },
  overlay: {
    video: { level: "blocked", reason: "Overlay video is not supported in Deliver V1" },
    audio: { level: "blocked", reason: "Audio clips must use an audio track" },
    image: { level: "supported" },
    text: { level: "blocked", reason: "Text rendering is not supported in Deliver V1" },
    subtitle: { level: "blocked", reason: "Subtitles must use a subtitle track" },
  },
  subtitle: {
    video: { level: "blocked", reason: "Video clips must use a video track" },
    audio: { level: "blocked", reason: "Audio clips must use an audio track" },
    image: { level: "blocked", reason: "Images must use the overlay track" },
    text: { level: "blocked", reason: "Text must use the overlay track" },
    subtitle: { level: "supported" },
  },
}

export function getCinemaRenderV1Support(
  trackKind: CinemaTimelineTrackKind,
  clipKind: CinemaTimelineClipKind,
) {
  return CINEMA_RENDER_V1_SUPPORT_MATRIX[trackKind][clipKind]
}
