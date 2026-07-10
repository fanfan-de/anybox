import type { CinemaTimelineFrameRate } from "@anybox/shared/cinema-timeline"

export function timelineTimeToPixels(timeUs: number, pixelsPerSecond: number) {
  return timeUs / 1_000_000 * pixelsPerSecond
}

export function timelinePixelsToTime(pixels: number, pixelsPerSecond: number) {
  return Math.max(0, Math.round(pixels / pixelsPerSecond * 1_000_000))
}

export function timelineFrameDurationUs(frameRate: CinemaTimelineFrameRate) {
  return Math.max(1, Math.round(1_000_000 * frameRate.denominator / frameRate.numerator))
}

export function quantizeTimelineTimeToFrame(timeUs: number, frameRate: CinemaTimelineFrameRate) {
  const frameDurationUs = timelineFrameDurationUs(frameRate)
  return Math.max(0, Math.round(timeUs / frameDurationUs) * frameDurationUs)
}

export function formatTimelineTime(timeUs: number) {
  const safeTimeUs = Math.max(0, Math.round(timeUs))
  const totalSeconds = Math.floor(safeTimeUs / 1_000_000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const milliseconds = Math.floor((safeTimeUs % 1_000_000) / 1_000)
  return `${[hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":")}.${String(milliseconds).padStart(3, "0")}`
}

export function timelineSecondsInputFromUs(timeUs: number) {
  const seconds = Math.max(0, Math.round(timeUs)) / 1_000_000
  return seconds.toFixed(6).replace(/\.?0+$/, "")
}

export function timelineSecondsInputToUs(value: string) {
  const normalized = value.trim()
  if (!/^(?:\d+(?:\.\d{0,6})?|\.\d{1,6})$/.test(normalized)) return null
  const seconds = Number(normalized)
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > Number.MAX_SAFE_INTEGER / 1_000_000) return null
  return Math.round(seconds * 1_000_000)
}
