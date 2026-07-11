import type { CinemaAssetRef } from "@anybox/shared/cinema"
import {
  getCinemaRenderV1Support,
  type CinemaRenderAudioEncoder,
  type CinemaRenderSettings,
  type CinemaRenderVideoEncoder,
} from "@anybox/shared/cinema-render"
import type {
  CinemaTimelineClip,
  CinemaTimelineDocument,
  CinemaTimelineFrameRate,
} from "@anybox/shared/cinema-timeline"

export type CinemaRenderResolvedInput = {
  assetRef: CinemaAssetRef
  filePath: string
  hasAudio?: boolean
}

export type CinemaRenderGraphOptions = {
  timeline: CinemaTimelineDocument
  settings: CinemaRenderSettings
  inputs: readonly CinemaRenderResolvedInput[]
  outputPath: string
  videoEncoder: CinemaRenderVideoEncoder
  audioEncoder: CinemaRenderAudioEncoder
}

export type CinemaRenderPlan = {
  args: string[]
  filterComplex: string
  outputDurationUs: number
  mediaInputCount: number
  videoOutputLabel: "vout"
  audioOutputLabel: "aout"
}

type CinemaRenderAssetClip = Exclude<CinemaTimelineClip, { kind: "text" }>
type CinemaRenderVisualClip = Extract<CinemaRenderAssetClip, { kind: "video" | "image" }>
type CinemaRenderAudioClip = Extract<CinemaRenderAssetClip, { kind: "video" | "audio" }>

function assetKey(ref: CinemaAssetRef) {
  const scope = ref.scope.type === "project" ? `project:${ref.scope.projectID}` : "personal"
  return `${scope}:${ref.assetID}:${ref.contentRevision}`
}

function formatSeconds(microseconds: number) {
  const seconds = microseconds / 1_000_000
  return Number.isInteger(seconds)
    ? String(seconds)
    : seconds.toFixed(6).replace(/0+$/, "").replace(/\.$/, "")
}

function frameRateValue(frameRate: CinemaTimelineFrameRate) {
  return `${frameRate.numerator}/${frameRate.denominator}`
}

function safeBackgroundColor(value: string) {
  if (!/^(?:#[0-9A-Fa-f]{6}|#[0-9A-Fa-f]{8}|[A-Za-z]{1,32})$/.test(value)) {
    throw new Error("Timeline background color is not safe for FFmpeg")
  }
  return value.startsWith("#") ? `0x${value.slice(1)}` : value
}

function atempoFilters(playbackRate: number) {
  if (!Number.isFinite(playbackRate) || playbackRate <= 0) {
    throw new Error("Clip playback rate must be positive")
  }
  const factors: number[] = []
  let remaining = playbackRate
  while (remaining > 2) {
    factors.push(2)
    remaining /= 2
  }
  while (remaining < 0.5) {
    factors.push(0.5)
    remaining /= 0.5
  }
  factors.push(remaining)
  return factors.map((factor) => `atempo=${factor.toFixed(6).replace(/0+$/, "").replace(/\.$/, "")}`)
}

function visualFitFilters(clip: CinemaRenderVisualClip, width: number, height: number) {
  if (clip.fit === "stretch") return [`scale=${width}:${height}`]
  if (clip.fit === "cover") {
    return [
      `scale=${width}:${height}:force_original_aspect_ratio=increase`,
      `crop=${width}:${height}`,
    ]
  }
  return [
    `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black@0`,
  ]
}

function qualityArgs(
  settings: CinemaRenderSettings,
  encoder: CinemaRenderGraphOptions["videoEncoder"],
) {
  if (settings.quality.mode === "target-bitrate") {
    const bitrate = settings.quality.targetVideoBitrateKbps
    return [
      "-b:v", `${bitrate}k`,
      "-maxrate", `${bitrate}k`,
      "-bufsize", `${bitrate * 2}k`,
    ]
  }
  if (encoder !== "libx264") {
    const bitrate = settings.quality.mode === "quality" ? 12_000 : 8_000
    return [
      "-b:v", `${bitrate}k`,
      "-maxrate", `${bitrate}k`,
      "-bufsize", `${bitrate * 2}k`,
    ]
  }
  return settings.quality.mode === "quality"
    ? ["-preset", "slow", "-crf", "18"]
    : ["-preset", "medium", "-crf", "23"]
}

function renderRange(settings: CinemaRenderSettings, timelineDurationUs: number) {
  if (settings.range.type === "full") {
    return { startUs: 0, endUs: timelineDurationUs }
  }
  if (settings.range.endUs > timelineDurationUs) {
    throw new Error("Custom render range exceeds the Timeline duration")
  }
  return { startUs: settings.range.startUs, endUs: settings.range.endUs }
}

function timelineDuration(timeline: CinemaTimelineDocument) {
  return timeline.clips.reduce(
    (maximum, clip) => Math.max(maximum, clip.timelineStartUs + clip.durationUs),
    0,
  )
}

function resolvedInputFor(
  inputsByAsset: ReadonlyMap<string, CinemaRenderResolvedInput>,
  ref: CinemaAssetRef,
) {
  const input = inputsByAsset.get(assetKey(ref))
  if (!input) throw new Error(`Render input is missing for asset '${ref.assetID}'`)
  return input
}

export function buildCinemaRenderPlan(options: CinemaRenderGraphOptions): CinemaRenderPlan {
  const { timeline, settings } = options
  const durationUs = timelineDuration(timeline)
  if (durationUs <= 0) throw new Error("Cannot render an empty Timeline")
  const range = renderRange(settings, durationUs)
  const outputDurationUs = range.endUs - range.startUs
  const fps = frameRateValue(settings.frameRate)
  const background = safeBackgroundColor(timeline.settings.backgroundColor)
  const inputsByAsset = new Map(options.inputs.map((input) => [assetKey(input.assetRef), input]))
  const trackByID = new Map(timeline.tracks.map((track) => [track.id, track]))
  const args: string[] = [
    "-hide_banner",
    "-nostdin",
    "-f", "lavfi",
    "-i", `color=c=${background}:s=${settings.width}x${settings.height}:r=${fps}:d=${formatSeconds(durationUs)}`,
  ]
  const filters: string[] = []
  const visualClips: Array<{ clip: CinemaRenderVisualClip; inputIndex: number }> = []
  const audioClips: Array<{ clip: CinemaRenderAudioClip; inputIndex: number }> = []
  let nextInputIndex = 1

  for (const clip of timeline.clips) {
    const track = trackByID.get(clip.trackID)
    if (!track || track.hidden) continue
    const support = getCinemaRenderV1Support(track.kind, clip.kind)
    if (support.level === "blocked") {
      throw new Error(support.reason ?? `Unsupported ${clip.kind} Clip`)
    }
    if (clip.kind === "text") throw new Error("Text rendering is not supported in Deliver V1")
    const input = resolvedInputFor(inputsByAsset, clip.assetRef)
    const inputIndex = nextInputIndex
    nextInputIndex += 1
    if (clip.kind === "image") {
      args.push("-i", input.filePath)
      visualClips.push({ clip, inputIndex })
      continue
    }
    args.push("-noautorotate", "-i", input.filePath)
    if (clip.kind === "video") visualClips.push({ clip, inputIndex })
    if (!track.muted && (clip.kind === "audio" || (clip.kind === "video" && input.hasAudio))) {
      audioClips.push({ clip, inputIndex })
    }
  }

  visualClips.sort((left, right) => {
    const leftTrack = trackByID.get(left.clip.trackID)
    const rightTrack = trackByID.get(right.clip.trackID)
    const leftLayer = leftTrack?.kind === "video" ? 0 : 1
    const rightLayer = rightTrack?.kind === "video" ? 0 : 1
    return leftLayer - rightLayer
      || (rightTrack?.order ?? 0) - (leftTrack?.order ?? 0)
      || left.clip.timelineStartUs - right.clip.timelineStartUs
  })

  filters.push(`[0:v]format=rgba[base0]`)
  let currentVideoLabel = "base0"
  visualClips.forEach(({ clip, inputIndex }, index) => {
    const preparedLabel = `visual${index}`
    const start = formatSeconds(clip.timelineStartUs)
    const end = formatSeconds(clip.timelineStartUs + clip.durationUs)
    const visualFilters: string[] = []
    if (clip.kind === "image") {
      visualFilters.push("loop=loop=-1:size=1:start=0")
    } else {
      visualFilters.push(
        `trim=start=${formatSeconds(clip.sourceInUs)}:duration=${formatSeconds(clip.sourceDurationUs)}`,
        `setpts=(PTS-STARTPTS)/${clip.playbackRate}`,
      )
    }
    visualFilters.push(
      ...visualFitFilters(clip, settings.width, settings.height),
      "format=rgba",
    )
    const transform = clip.transform ?? {
      x: 0,
      y: 0,
      scale: 1,
      rotationDegrees: 0,
      anchorX: 0.5,
      anchorY: 0.5,
    }
    if (transform.scale !== 1) {
      visualFilters.push(`scale=iw*${transform.scale}:ih*${transform.scale}`)
    }
    if (transform.rotationDegrees !== 0) {
      visualFilters.push(`rotate=${transform.rotationDegrees}*PI/180:ow=rotw(iw):oh=roth(ih):c=black@0`)
    }
    if (clip.opacity < 1) visualFilters.push(`colorchannelmixer=aa=${clip.opacity}`)
    visualFilters.push(
      `trim=duration=${formatSeconds(clip.durationUs)}`,
      `setpts=PTS-STARTPTS+${start}/TB`,
    )
    filters.push(`[${inputIndex}:v]${visualFilters.join(",")}[${preparedLabel}]`)
    const nextLabel = `base${index + 1}`
    filters.push(
      `[${currentVideoLabel}][${preparedLabel}]overlay=x='${settings.width * transform.anchorX + transform.x}-overlay_w*${transform.anchorX}':y='${settings.height * transform.anchorY + transform.y}-overlay_h*${transform.anchorY}':eof_action=pass:shortest=0:enable='between(t,${start},${end})'[${nextLabel}]`,
    )
    currentVideoLabel = nextLabel
  })
  filters.push(
    `[${currentVideoLabel}]trim=start=${formatSeconds(range.startUs)}:end=${formatSeconds(range.endUs)},setpts=PTS-STARTPTS,fps=${fps},format=yuv420p[vout]`,
  )

  filters.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${formatSeconds(durationUs)},asetpts=PTS-STARTPTS[silence]`)
  const audioLabels = ["silence"]
  audioClips.forEach(({ clip, inputIndex }, index) => {
    const label = `audio${index}`
    const filtersForClip = [
      `atrim=start=${formatSeconds(clip.sourceInUs)}:duration=${formatSeconds(clip.sourceDurationUs)}`,
      "asetpts=PTS-STARTPTS",
      ...atempoFilters(clip.playbackRate),
      `volume=${clip.volume}`,
    ]
    if (clip.kind === "audio" && (clip.fadeInUs ?? 0) > 0) {
      filtersForClip.push(`afade=t=in:st=0:d=${formatSeconds(clip.fadeInUs!)}`)
    }
    if (clip.kind === "audio" && (clip.fadeOutUs ?? 0) > 0) {
      filtersForClip.push(
        `afade=t=out:st=${formatSeconds(clip.durationUs - clip.fadeOutUs!)}:d=${formatSeconds(clip.fadeOutUs!)}`,
      )
    }
    const delayMs = Math.round(clip.timelineStartUs / 1_000)
    filtersForClip.push(
      `atrim=duration=${formatSeconds(clip.durationUs)}`,
      `adelay=${delayMs}:all=1`,
      "aresample=48000",
      "aformat=sample_fmts=fltp:channel_layouts=stereo",
    )
    filters.push(`[${inputIndex}:a]${filtersForClip.join(",")}[${label}]`)
    audioLabels.push(label)
  })
  filters.push(
    `${audioLabels.map((label) => `[${label}]`).join("")}amix=inputs=${audioLabels.length}:duration=longest:normalize=0,atrim=start=${formatSeconds(range.startUs)}:end=${formatSeconds(range.endUs)},asetpts=PTS-STARTPTS[aout]`,
  )

  const filterComplex = filters.join(";")
  args.push(
    "-filter_complex", filterComplex,
    "-map", "[vout]",
    "-map", "[aout]",
    "-c:v", options.videoEncoder,
    ...qualityArgs(settings, options.videoEncoder),
    "-pix_fmt", "yuv420p",
    "-c:a", options.audioEncoder,
    "-b:a", `${settings.audioBitrateKbps}k`,
    "-ar", "48000",
    "-movflags", "+faststart",
    "-progress", "pipe:1",
    "-nostats",
    "-y",
    options.outputPath,
  )

  return {
    args,
    filterComplex,
    outputDurationUs,
    mediaInputCount: nextInputIndex - 1,
    videoOutputLabel: "vout",
    audioOutputLabel: "aout",
  }
}

export const cinemaRenderGraphInternals = {
  atempoFilters,
  formatSeconds,
}
