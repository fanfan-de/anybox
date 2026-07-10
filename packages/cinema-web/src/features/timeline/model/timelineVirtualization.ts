import type { CinemaTimelineClip } from "@anybox/shared/cinema-timeline"
import { timelineTimeToPixels } from "./timelineTime"

export function visibleTimelineClips(
  clips: readonly CinemaTimelineClip[],
  viewport: { scrollLeft: number; width: number },
  pixelsPerSecond: number,
  overscanPixels = 320,
) {
  const start = Math.max(0, viewport.scrollLeft - 112 - overscanPixels)
  const end = viewport.scrollLeft + viewport.width + overscanPixels
  return clips.filter((clip) => {
    const left = timelineTimeToPixels(clip.timelineStartUs, pixelsPerSecond)
    const right = left + timelineTimeToPixels(clip.durationUs, pixelsPerSecond)
    return right >= start && left <= end
  })
}
