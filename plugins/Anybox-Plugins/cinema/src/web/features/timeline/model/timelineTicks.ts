import type { CinemaTimelineFrameRate } from "@anybox/cinema-plugin/contracts/timeline"
import { timelineFrameDurationUs, timelineTimeToPixels } from "./timelineTime"

export type TimelineRulerTick = {
  timeUs: number
  leftPx: number
  major: boolean
  label: string | null
}

const MAJOR_STEP_SECONDS = [0.5, 1, 2, 5, 10, 30, 60, 120, 300, 600, 1_800, 3_600]

function formatRulerLabel(timeUs: number, majorStepUs: number) {
  const totalSeconds = timeUs / 1_000_000
  const hours = Math.floor(totalSeconds / 3_600)
  const minutes = Math.floor(totalSeconds / 60) % 60
  const seconds = Math.floor(totalSeconds) % 60
  if (majorStepUs < 1_000_000) {
    const milliseconds = Math.floor((timeUs % 1_000_000) / 1_000)
    return `${minutes}:${String(seconds).padStart(2, "0")}.${String(milliseconds).padStart(3, "0")}`
  }
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
  return `${minutes}:${String(seconds).padStart(2, "0")}`
}

export function timelineRulerScale(
  pixelsPerSecond: number,
  frameRate: CinemaTimelineFrameRate,
) {
  const frameStepUs = timelineFrameDurationUs(frameRate)
  const frameStepPx = timelineTimeToPixels(frameStepUs, pixelsPerSecond)
  const majorStepSeconds = MAJOR_STEP_SECONDS.find((step) => step * pixelsPerSecond >= 72)
    ?? MAJOR_STEP_SECONDS.at(-1)!
  const majorStepUs = Math.round(majorStepSeconds * 1_000_000)
  if (frameStepPx >= 6) return { minorStepUs: frameStepUs, majorStepUs }
  const fifthStepUs = Math.round(majorStepUs / 5)
  const minorStepUs = timelineTimeToPixels(fifthStepUs, pixelsPerSecond) >= 5
    ? fifthStepUs
    : Math.round(majorStepUs / 2)
  return { minorStepUs, majorStepUs }
}

export function timelineRulerTicks({
  pixelsPerSecond,
  frameRate,
  scrollLeft,
  viewportWidth,
  trackHeaderWidth,
  durationUs,
}: {
  pixelsPerSecond: number
  frameRate: CinemaTimelineFrameRate
  scrollLeft: number
  viewportWidth: number
  trackHeaderWidth: number
  durationUs: number
}) {
  const { minorStepUs, majorStepUs } = timelineRulerScale(pixelsPerSecond, frameRate)
  const visibleStartPx = Math.max(0, scrollLeft - trackHeaderWidth)
  const visibleEndPx = Math.max(visibleStartPx, scrollLeft + viewportWidth - trackHeaderWidth)
  const visibleStartUs = visibleStartPx / pixelsPerSecond * 1_000_000
  const visibleEndUs = visibleEndPx / pixelsPerSecond * 1_000_000
  const startIndex = Math.max(0, Math.floor(visibleStartUs / minorStepUs) - 2)
  const endIndex = Math.ceil(Math.min(durationUs, visibleEndUs + majorStepUs) / minorStepUs)
  const ticks: TimelineRulerTick[] = []
  for (let index = startIndex; index <= endIndex && ticks.length < 1_000; index += 1) {
    const timeUs = index * minorStepUs
    const nearestMajor = Math.round(timeUs / majorStepUs) * majorStepUs
    const major = Math.abs(timeUs - nearestMajor) <= Math.max(1, minorStepUs / 100)
    ticks.push({
      timeUs,
      leftPx: timelineTimeToPixels(timeUs, pixelsPerSecond),
      major,
      label: major ? formatRulerLabel(timeUs, majorStepUs) : null,
    })
  }
  return ticks
}
