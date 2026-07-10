import { statfs } from "node:fs/promises"

import type { CinemaAssetRecord, CinemaAssetRef } from "@anybox/shared/cinema"
import {
  CinemaRenderPreflightResultSchema,
  CinemaRenderSettingsSchema,
  cinemaRenderRangeFitsTimeline,
  getCinemaRenderV1Support,
  type CinemaRenderPreflightIssue,
  type CinemaRenderPreflightResult,
  type CinemaRenderRuntimeStatus,
  type CinemaRenderSettings,
} from "@anybox/shared/cinema-render"
import {
  CinemaTimelineDocumentSchema,
  type CinemaTimelineDocument,
} from "@anybox/shared/cinema-timeline"

import { getCinemaAsset } from "#cinema/asset-library.ts"
import { getCinemaRenderRuntimeStatus } from "#cinema/render-runtime.ts"

export type CinemaRenderPreflightDependencies = {
  getCinemaAsset: typeof getCinemaAsset
  getCinemaRenderRuntimeStatus: typeof getCinemaRenderRuntimeStatus
  getAvailableBytes: (directory: string) => Promise<number>
  now: () => string
}

async function availableBytes(directory: string) {
  const stats = await statfs(directory)
  return Number(stats.bavail) * Number(stats.bsize)
}

const defaultDependencies: CinemaRenderPreflightDependencies = {
  getCinemaAsset,
  getCinemaRenderRuntimeStatus,
  getAvailableBytes: availableBytes,
  now: () => new Date().toISOString(),
}

let dependencyOverridesForTesting: Partial<CinemaRenderPreflightDependencies> = {}

/**
 * Overrides production dependencies for deterministic integration tests. The
 * returned restore function must be called by the test that installed the
 * override so unrelated preflight requests continue to use the real runtime.
 */
export function setCinemaRenderPreflightDependenciesForTesting(
  overrides: Partial<CinemaRenderPreflightDependencies>,
) {
  const previous = dependencyOverridesForTesting
  dependencyOverridesForTesting = {
    ...previous,
    ...overrides,
  }
  return () => {
    dependencyOverridesForTesting = previous
  }
}

function currentDefaultDependencies(): CinemaRenderPreflightDependencies {
  return {
    ...defaultDependencies,
    ...dependencyOverridesForTesting,
  }
}

function timelineDurationUs(timeline: CinemaTimelineDocument) {
  return timeline.clips.reduce(
    (maximum, clip) => Math.max(maximum, clip.timelineStartUs + clip.durationUs),
    0,
  )
}

function intersectsRange(
  clip: { timelineStartUs: number; durationUs: number },
  startUs: number,
  endUs: number,
) {
  return clip.timelineStartUs < endUs && clip.timelineStartUs + clip.durationUs > startUs
}

function issue(
  code: CinemaRenderPreflightIssue["code"],
  severity: CinemaRenderPreflightIssue["severity"],
  message: string,
  details: Pick<CinemaRenderPreflightIssue, "clipID" | "assetID"> = {},
): CinemaRenderPreflightIssue {
  return { code, severity, message, ...details }
}

function assetReferenceKey(ref: CinemaAssetRef) {
  const scope = ref.scope.type === "project" ? `project:${ref.scope.projectID}` : "personal"
  return `${scope}:${ref.assetID}:${ref.contentRevision}`
}

function validateResolvedAsset(
  projectID: string,
  clip: CinemaTimelineDocument["clips"][number],
  assetRef: CinemaAssetRef,
  asset: CinemaAssetRecord,
) {
  const issues: CinemaRenderPreflightIssue[] = []
  const details = { clipID: clip.id, assetID: assetRef.assetID }
  if (assetRef.scope.type === "project" && assetRef.scope.projectID !== projectID) {
    issues.push(issue(
      "asset-scope-mismatch",
      "error",
      "The project asset reference belongs to another project.",
      details,
    ))
  }
  if (asset.status === "missing") {
    issues.push(issue("asset-missing", "error", "A referenced asset file is missing.", details))
  } else if (asset.status === "trashed") {
    issues.push(issue("asset-trashed", "error", "A referenced asset is in the recycle bin.", details))
  } else if (asset.status !== "ready") {
    issues.push(issue("asset-not-ready", "error", `A referenced asset is ${asset.status}.`, details))
  }
  if (asset.id !== assetRef.assetID || asset.kind !== assetRef.snapshot.kind) {
    issues.push(issue("asset-kind-mismatch", "error", "The referenced asset kind no longer matches the Timeline.", details))
  }
  if (asset.contentRevision !== assetRef.contentRevision) {
    issues.push(issue("asset-revision-stale", "error", "The referenced asset content revision is stale.", details))
  }
  if ("sourceInUs" in clip && asset.durationSeconds !== undefined) {
    const actualDurationUs = Math.round(asset.durationSeconds * 1_000_000)
    if (clip.sourceInUs + clip.sourceDurationUs > actualDurationUs) {
      issues.push(issue(
        "asset-source-range-invalid",
        "error",
        "The Clip source range exceeds the current asset duration.",
        details,
      ))
    }
  }
  if (assetRef.scope.type === "personal") {
    issues.push(issue(
      "personal-asset-copy-required",
      "warning",
      "A personal asset will be copied into the render job snapshot.",
      details,
    ))
  }
  return issues
}

function runtimeIssues(runtime: CinemaRenderRuntimeStatus) {
  const issues: CinemaRenderPreflightIssue[] = []
  if (!runtime.available || !runtime.ffprobeAvailable) {
    issues.push(issue(
      "render-runtime-unavailable",
      "error",
      runtime.issue ?? "FFmpeg and ffprobe are unavailable.",
    ))
    return issues
  }
  if (runtime.videoEncoders.length === 0) {
    issues.push(issue(
      "video-encoder-unavailable",
      "error",
      "No supported H.264 encoder is available in the current FFmpeg runtime.",
    ))
  }
  if (!runtime.audioEncoders.includes("aac")) {
    issues.push(issue(
      "audio-encoder-unavailable",
      "error",
      "The AAC encoder is unavailable in the current FFmpeg runtime.",
    ))
  }
  return issues
}

export function defaultCinemaRenderSettings(timeline: CinemaTimelineDocument): CinemaRenderSettings {
  const rawName = timeline.title.trim().replace(/[\\/]/g, "-").replace(/\.[A-Za-z0-9]{1,16}$/, "")
  const outputName = rawName && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(rawName)
    ? rawName.slice(0, 160)
    : "Timeline render"
  return CinemaRenderSettingsSchema.parse({
    format: "mp4",
    videoCodec: "h264",
    audioCodec: "aac",
    width: Math.min(7_680, timeline.settings.width - timeline.settings.width % 2),
    height: Math.min(7_680, timeline.settings.height - timeline.settings.height % 2),
    frameRate: timeline.settings.frameRate,
    quality: { mode: "balanced" },
    audioBitrateKbps: 192,
    range: { type: "full" },
    outputName,
  })
}

export async function preflightCinemaRender(input: {
  cinemaRoot: string
  projectID: string
  timeline: CinemaTimelineDocument
  settings: CinemaRenderSettings
  dependencies?: CinemaRenderPreflightDependencies
}): Promise<CinemaRenderPreflightResult> {
  const dependencies = input.dependencies ?? currentDefaultDependencies()
  const timelineResult = CinemaTimelineDocumentSchema.safeParse(input.timeline)
  if (!timelineResult.success) {
    return CinemaRenderPreflightResultSchema.parse({
      timelineID: input.timeline.id,
      timelineRevision: input.timeline.revision,
      checkedAt: dependencies.now(),
      ready: false,
      durationUs: 0,
      estimatedFrameCount: 0,
      estimatedInputBytes: 0,
      issues: [issue("timeline-invalid", "error", "The Timeline document is invalid.")],
      support: { videoClips: 0, audioClips: 0, imageClips: 0, textClips: 0 },
    })
  }
  const timeline = timelineResult.data
  const settings = CinemaRenderSettingsSchema.parse(input.settings)
  const durationUs = timelineDurationUs(timeline)
  const rangeStartUs = settings.range.type === "custom" ? settings.range.startUs : 0
  const rangeEndUs = settings.range.type === "custom" ? settings.range.endUs : durationUs
  const issues: CinemaRenderPreflightIssue[] = []
  const trackByID = new Map(timeline.tracks.map((track) => [track.id, track]))
  const support = { videoClips: 0, audioClips: 0, imageClips: 0, textClips: 0 }

  for (const clip of timeline.clips) {
    if (clip.kind === "video") support.videoClips += 1
    else if (clip.kind === "audio") support.audioClips += 1
    else if (clip.kind === "image") support.imageClips += 1
    else support.textClips += 1
    const track = trackByID.get(clip.trackID)
    if (!track || track.hidden) continue
    const rule = getCinemaRenderV1Support(track.kind, clip.kind)
    if (rule.level === "blocked") {
      issues.push(issue(
        "clip-unsupported",
        "error",
        rule.reason ?? `${clip.kind} Clips are not supported on ${track.kind} tracks.`,
        { clipID: clip.id },
      ))
    }
  }

  if (timeline.clips.length === 0 || durationUs === 0) {
    issues.push(issue("timeline-empty", "error", "The Timeline does not contain any Clips."))
  }
  const hasVisibleMainVideo = timeline.clips.some((clip) => {
    const track = trackByID.get(clip.trackID)
    return clip.kind === "video"
      && track?.kind === "video"
      && !track.hidden
      && intersectsRange(clip, rangeStartUs, rangeEndUs)
  })
  if (!hasVisibleMainVideo) {
    issues.push(issue("main-video-missing", "error", "The output range has no visible main video."))
  }
  if (!cinemaRenderRangeFitsTimeline(settings.range, durationUs)) {
    issues.push(issue("render-settings-invalid", "error", "The custom output range exceeds the Timeline duration."))
  } else if (settings.range.type === "custom") {
    const customRange = settings.range
    const hasVisibleContent = timeline.clips.some((clip) => {
      const track = trackByID.get(clip.trackID)
      return track && !track.hidden && track.kind !== "audio"
        && intersectsRange(clip, customRange.startUs, customRange.endUs)
    })
    if (!hasVisibleContent) {
      issues.push(issue("custom-range-empty", "error", "The custom output range has no visible content."))
    }
  }

  const uniqueAssets = new Map<string, { ref: CinemaAssetRef; clips: CinemaTimelineDocument["clips"] }>()
  for (const clip of timeline.clips) {
    if (!("assetRef" in clip)) continue
    const key = assetReferenceKey(clip.assetRef)
    const existing = uniqueAssets.get(key)
    if (existing) existing.clips.push(clip)
    else uniqueAssets.set(key, { ref: clip.assetRef, clips: [clip] })
  }

  let estimatedInputBytes = 0
  for (const { ref, clips } of uniqueAssets.values()) {
    try {
      const { asset } = await dependencies.getCinemaAsset(ref.scope, ref.assetID)
      estimatedInputBytes += asset.sizeBytes
      for (const clip of clips) {
        issues.push(...validateResolvedAsset(input.projectID, clip, ref, asset))
      }
    } catch {
      for (const clip of clips) {
        issues.push(issue(
          "asset-missing",
          "error",
          "A referenced asset could not be found.",
          { clipID: clip.id, assetID: ref.assetID },
        ))
      }
    }
  }

  const runtime = await dependencies.getCinemaRenderRuntimeStatus()
  issues.push(...runtimeIssues(runtime))
  const outputDurationUs = Math.max(0, rangeEndUs - rangeStartUs)
  const frameRate = settings.frameRate.numerator / settings.frameRate.denominator
  const estimatedFrameCount = Math.ceil(outputDurationUs / 1_000_000 * frameRate)
  const estimatedOutputBytes = Math.ceil(outputDurationUs / 1_000_000 * 2_000_000)
  const estimatedWorkingBytes = estimatedInputBytes + estimatedOutputBytes * 2
  try {
    if (await dependencies.getAvailableBytes(input.cinemaRoot) < estimatedWorkingBytes) {
      issues.push(issue(
        "working-space-insufficient",
        "error",
        "The Cinema project does not have enough free space for this render.",
      ))
    }
  } catch {
    issues.push(issue(
      "working-space-insufficient",
      "warning",
      "Available working space could not be measured.",
    ))
  }

  return CinemaRenderPreflightResultSchema.parse({
    timelineID: timeline.id,
    timelineRevision: timeline.revision,
    checkedAt: dependencies.now(),
    ready: !issues.some((item) => item.severity === "error"),
    durationUs,
    estimatedFrameCount,
    estimatedInputBytes,
    estimatedWorkingBytes,
    issues,
    support,
  })
}
