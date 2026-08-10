import type { CinemaTimelineClip } from "@anybox/cinema-plugin/contracts/timeline"
import { timelineVisibleContentRange } from "./timelineLayout"
import { timelineTimeToPixels } from "./timelineTime"

export function visibleTimelineClips(
  clips: readonly CinemaTimelineClip[],
  viewport: { scrollLeft: number; width: number },
  pixelsPerSecond: number,
  overscanPixels = 320,
) {
  const { start, end } = timelineVisibleContentRange(viewport, overscanPixels)
  return clips.filter((clip) => {
    const left = timelineTimeToPixels(clip.timelineStartUs, pixelsPerSecond)
    const right = left + timelineTimeToPixels(clip.durationUs, pixelsPerSecond)
    return right >= start && left <= end
  })
}
