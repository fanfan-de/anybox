import { timelinePixelsToTime, timelineTimeToPixels } from "./timelineTime"

export const TIMELINE_MIN_PIXELS_PER_SECOND = 0.5
export const TIMELINE_MAX_PIXELS_PER_SECOND = 192

export function timelineWheelZoom(
  pixelsPerSecond: number,
  deltaY: number,
) {
  const next = pixelsPerSecond * Math.exp(-deltaY * 0.0025)
  return Math.min(
    TIMELINE_MAX_PIXELS_PER_SECOND,
    Math.max(TIMELINE_MIN_PIXELS_PER_SECOND, next),
  )
}

export function timelinePointerAnchorTime(
  scrollLeft: number,
  pointerOffsetX: number,
  trackHeaderWidth: number,
  pixelsPerSecond: number,
) {
  return timelinePixelsToTime(
    Math.max(0, scrollLeft + pointerOffsetX - trackHeaderWidth),
    pixelsPerSecond,
  )
}

export function timelineScrollLeftForAnchor(
  anchorTimeUs: number,
  pointerOffsetX: number,
  trackHeaderWidth: number,
  pixelsPerSecond: number,
) {
  return Math.max(
    0,
    trackHeaderWidth
      + timelineTimeToPixels(anchorTimeUs, pixelsPerSecond)
      - pointerOffsetX,
  )
}
