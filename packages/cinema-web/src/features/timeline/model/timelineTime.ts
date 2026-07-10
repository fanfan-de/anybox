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
  const totalSeconds = Math.max(0, Math.floor(timeUs / 1_000_000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":")
}
