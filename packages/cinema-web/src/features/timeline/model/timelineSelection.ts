import type { CinemaTimelineDocument } from "@anybox/shared/cinema-timeline"
import { TIMELINE_TRACK_HEADER_WIDTH_PX } from "./timelineLayout"
import { timelineTimeToPixels } from "./timelineTime"

export type TimelineSelectionRect = {
  clipID: string
  left: number
  top: number
  right: number
  bottom: number
}

export type TimelineSelectionPoint = {
  x: number
  y: number
}

const TIMELINE_TRACK_HEIGHT_PX = 72
const TIMELINE_CLIP_TOP_PX = 8
const TIMELINE_CLIP_HEIGHT_PX = 54

export function orderedTimelineClipIDs(clipIDs: readonly string[]) {
  return [...new Set(clipIDs.filter((clipID) => clipID.length > 0))]
}

export function toggleTimelineClipSelection(
  selectedClipIDs: readonly string[],
  clipID: string,
) {
  const selected = orderedTimelineClipIDs(selectedClipIDs)
  return selected.includes(clipID)
    ? selected.filter((candidate) => candidate !== clipID)
    : [...selected, clipID]
}

export function reconcileTimelineClipSelection(
  selectedClipIDs: readonly string[],
  document: CinemaTimelineDocument | null | undefined,
) {
  if (!document) return []
  const existing = new Set(document.clips.map((clip) => clip.id))
  return orderedTimelineClipIDs(selectedClipIDs).filter((clipID) => existing.has(clipID))
}

export function timelineClipSelectionRects(
  document: CinemaTimelineDocument,
  pixelsPerSecond: number,
  layout: {
    trackHeightsPx?: Readonly<Record<string, number>>
    collapsedTrackIDs?: ReadonlySet<string>
  } = {},
) {
  const orderedTracks = [...document.tracks].sort((left, right) => left.order - right.order)
  let currentTop = 0
  const trackTops = new Map<string, number>()
  for (const track of orderedTracks) {
    trackTops.set(track.id, currentTop)
    currentTop += layout.collapsedTrackIDs?.has(track.id)
      ? 36
      : layout.trackHeightsPx?.[track.id] ?? TIMELINE_TRACK_HEIGHT_PX
  }
  return document.clips.flatMap<TimelineSelectionRect>((clip) => {
    const trackTop = trackTops.get(clip.trackID)
    if (trackTop === undefined || layout.collapsedTrackIDs?.has(clip.trackID)) return []
    const trackHeight = layout.trackHeightsPx?.[clip.trackID] ?? TIMELINE_TRACK_HEIGHT_PX
    const left = TIMELINE_TRACK_HEADER_WIDTH_PX
      + timelineTimeToPixels(clip.timelineStartUs, pixelsPerSecond)
    const top = trackTop + Math.max(TIMELINE_CLIP_TOP_PX, (trackHeight - TIMELINE_CLIP_HEIGHT_PX) / 2)
    return [{
      clipID: clip.id,
      left,
      top,
      right: left + Math.max(32, timelineTimeToPixels(clip.durationUs, pixelsPerSecond)),
      bottom: top + TIMELINE_CLIP_HEIGHT_PX,
    }]
  })
}

export function normalizedTimelineSelectionRect(
  origin: TimelineSelectionPoint,
  current: TimelineSelectionPoint,
) {
  return {
    left: Math.min(origin.x, current.x),
    top: Math.min(origin.y, current.y),
    right: Math.max(origin.x, current.x),
    bottom: Math.max(origin.y, current.y),
  }
}

export function timelineMarqueeSelectedClipIDs(
  clipRects: readonly TimelineSelectionRect[],
  origin: TimelineSelectionPoint,
  current: TimelineSelectionPoint,
) {
  const marquee = normalizedTimelineSelectionRect(origin, current)
  return clipRects.filter((clip) => (
    clip.right >= marquee.left
    && clip.left <= marquee.right
    && clip.bottom >= marquee.top
    && clip.top <= marquee.bottom
  )).map((clip) => clip.clipID)
}
