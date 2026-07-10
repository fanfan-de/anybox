import type { CinemaTimelineDocument } from "@anybox/shared/cinema-timeline"

export function timelineSnapCandidates(document: CinemaTimelineDocument, excludedClipIDs: readonly string[] = []) {
  const excluded = new Set(excludedClipIDs)
  const candidates = new Set<number>([0, ...document.markers.map((marker) => marker.timeUs)])
  for (const clip of document.clips) {
    if (excluded.has(clip.id)) continue
    candidates.add(clip.timelineStartUs)
    candidates.add(clip.timelineStartUs + clip.durationUs)
  }
  return [...candidates].sort((left, right) => left - right)
}

export function snapTimelineTime(
  proposedTimeUs: number,
  candidates: readonly number[],
  pixelsPerSecond: number,
  thresholdPixels = 8,
) {
  const thresholdUs = thresholdPixels / pixelsPerSecond * 1_000_000
  let snappedTimeUs = Math.max(0, proposedTimeUs)
  let distanceUs = Number.POSITIVE_INFINITY
  for (const candidate of candidates) {
    const nextDistance = Math.abs(candidate - proposedTimeUs)
    if (nextDistance <= thresholdUs && nextDistance < distanceUs) {
      distanceUs = nextDistance
      snappedTimeUs = candidate
    }
  }
  return { timeUs: snappedTimeUs, snapped: Number.isFinite(distanceUs) }
}
