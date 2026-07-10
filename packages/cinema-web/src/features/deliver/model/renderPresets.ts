import {
  CinemaRenderSettingsSchema,
  type CinemaRenderQuality,
  type CinemaRenderSettings,
} from "@anybox/shared/cinema-render"
import type { CinemaTimelineDocument } from "@anybox/shared/cinema-timeline"

export type RenderPresetID = "balanced" | "quality" | "target-bitrate"

export type RetainedRenderOperation = Readonly<{
  fingerprint: string
  operationID: string
}>

export type RenderPreset = Readonly<{
  id: RenderPresetID
  label: string
  description: string
  quality: CinemaRenderQuality
  audioBitrateKbps: CinemaRenderSettings["audioBitrateKbps"]
}>

export const RENDER_PRESETS: readonly RenderPreset[] = [
  {
    id: "balanced",
    label: "Balanced",
    description: "Good quality with a practical file size.",
    quality: { mode: "balanced" },
    audioBitrateKbps: 192,
  },
  {
    id: "quality",
    label: "Quality",
    description: "Preserve more detail for review masters.",
    quality: { mode: "quality" },
    audioBitrateKbps: 256,
  },
  {
    id: "target-bitrate",
    label: "Target bitrate",
    description: "Keep the video stream near a chosen bitrate.",
    quality: { mode: "target-bitrate", targetVideoBitrateKbps: 8_000 },
    audioBitrateKbps: 192,
  },
]

function evenDimension(value: number) {
  const bounded = Math.min(7_680, Math.max(2, Math.trunc(value)))
  return bounded - (bounded % 2)
}

function safeOutputName(title: string) {
  const cleaned = title.trim()
    .replace(/[\\/]/g, "-")
    .replace(/\.[A-Za-z0-9]{1,16}$/, "")
    .replace(/[. ]+$/, "")
    .slice(0, 160)
  if (!cleaned || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(cleaned)) return "Timeline render"
  return cleaned
}

export function defaultRenderSettings(timeline: CinemaTimelineDocument): CinemaRenderSettings {
  const frameRate = timeline.settings.frameRate.numerator / timeline.settings.frameRate.denominator <= 120
    ? timeline.settings.frameRate
    : { numerator: 24, denominator: 1 }
  return CinemaRenderSettingsSchema.parse({
    format: "mp4",
    videoCodec: "h264",
    audioCodec: "aac",
    width: evenDimension(timeline.settings.width),
    height: evenDimension(timeline.settings.height),
    frameRate,
    quality: { mode: "balanced" },
    audioBitrateKbps: 192,
    range: { type: "full" },
    outputName: safeOutputName(timeline.title),
  })
}

export function presetForSettings(settings: CinemaRenderSettings): RenderPresetID {
  if (settings.quality.mode === "quality") return "quality"
  if (settings.quality.mode === "target-bitrate") return "target-bitrate"
  return "balanced"
}

export function applyRenderPreset(settings: CinemaRenderSettings, presetID: RenderPresetID): CinemaRenderSettings {
  const preset = RENDER_PRESETS.find((candidate) => candidate.id === presetID) ?? RENDER_PRESETS[0]
  return CinemaRenderSettingsSchema.parse({
    ...settings,
    quality: preset.quality,
    audioBitrateKbps: preset.audioBitrateKbps,
  })
}

export function makeRenderOperationID(prefix = "render") {
  const random = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `${prefix}-${random.replace(/[^A-Za-z0-9_-]/g, "-")}`.slice(0, 128)
}

function stableFingerprint(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableFingerprint).join(",")}]`
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableFingerprint(record[key])}`).join(",")}}`
  }
  return JSON.stringify(value)
}

export function createRenderOperationFingerprint(
  timelineID: string,
  expectedTimelineRevision: number,
  settings: CinemaRenderSettings,
) {
  return stableFingerprint({
    kind: "create",
    timelineID,
    expectedTimelineRevision,
    settings: CinemaRenderSettingsSchema.parse(settings),
  })
}

export function retryRenderOperationFingerprint(originalJobID: string) {
  return stableFingerprint({ kind: "retry", originalJobID })
}

export function retainRenderOperation(
  current: RetainedRenderOperation | null,
  fingerprint: string,
  prefix = "render",
): RetainedRenderOperation {
  if (current?.fingerprint === fingerprint) return current
  return { fingerprint, operationID: makeRenderOperationID(prefix) }
}
