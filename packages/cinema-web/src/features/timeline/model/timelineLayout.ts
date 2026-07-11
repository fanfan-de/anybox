export const TIMELINE_TRACK_HEADER_WIDTH_PX = 112
export const TIMELINE_MIN_CONTENT_WIDTH_PX = 1_800
export const TIMELINE_END_PADDING_PX = 500

export function timelineContentWidth(
  durationUs: number,
  pixelsPerSecond: number,
) {
  const durationWidth = Math.max(0, durationUs) / 1_000_000 * pixelsPerSecond
  return Math.max(TIMELINE_MIN_CONTENT_WIDTH_PX, durationWidth + TIMELINE_END_PADDING_PX)
}

export function timelineCanvasWidth(contentWidth: number) {
  return TIMELINE_TRACK_HEADER_WIDTH_PX + Math.max(0, contentWidth)
}

export function timelineVisibleContentRange(
  viewport: { scrollLeft: number; width: number },
  overscanPixels = 0,
) {
  const viewportStart = Math.max(0, viewport.scrollLeft)
  const viewportEnd = viewportStart + Math.max(0, viewport.width)
  return {
    start: Math.max(0, viewportStart - TIMELINE_TRACK_HEADER_WIDTH_PX - overscanPixels),
    end: Math.max(0, viewportEnd - TIMELINE_TRACK_HEADER_WIDTH_PX + overscanPixels),
  }
}
