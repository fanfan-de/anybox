import type { CinemaTimelineDocument } from "@anybox/cinema-plugin/contracts/timeline"

export function timelineSnapCandidates(
  document: CinemaTimelineDocument,
  excludedClipIDs: readonly string[] = [],
  additionalCandidates: readonly number[] = [],
) {
  const excluded = new Set(excludedClipIDs)
  const candidates = new Set<number>([
    0,
    ...additionalCandidates,
    ...document.markers.map((marker) => marker.timeUs),
  ])
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

export function snapTimelineClipEdges(
  proposedStartUs: number,
  durationUs: number,
  candidates: readonly number[],
  pixelsPerSecond: number,
  thresholdPixels = 8,
) {
  const safeStartUs = Math.max(0, proposedStartUs)
  const safeDurationUs = Math.max(1, durationUs)
  const thresholdUs = thresholdPixels / pixelsPerSecond * 1_000_000
  let best: {
    timelineStartUs: number
    snapGuideUs: number
    snappedEdge: "start" | "end"
    distanceUs: number
  } | null = null
  for (const candidate of candidates) {
    const startDistanceUs = Math.abs(candidate - safeStartUs)
    if (startDistanceUs <= thresholdUs && (!best || startDistanceUs < best.distanceUs)) {
      best = {
        timelineStartUs: candidate,
        snapGuideUs: candidate,
        snappedEdge: "start",
        distanceUs: startDistanceUs,
      }
    }
    const proposedEndUs = safeStartUs + safeDurationUs
    const endDistanceUs = Math.abs(candidate - proposedEndUs)
    const snappedStartUs = candidate - safeDurationUs
    if (
      snappedStartUs >= 0
      && endDistanceUs <= thresholdUs
      && (!best || endDistanceUs < best.distanceUs)
    ) {
      best = {
        timelineStartUs: snappedStartUs,
        snapGuideUs: candidate,
        snappedEdge: "end",
        distanceUs: endDistanceUs,
      }
    }
  }
  return best ? {
    timelineStartUs: best.timelineStartUs,
    snapGuideUs: best.snapGuideUs,
    snappedEdge: best.snappedEdge,
  } : {
    timelineStartUs: safeStartUs,
    snapGuideUs: null,
    snappedEdge: null,
  }
}
