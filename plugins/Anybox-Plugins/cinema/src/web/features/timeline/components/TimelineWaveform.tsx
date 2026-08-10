import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { CinemaTimelineApiError, createTimelineApi } from "../api/timelineApi"
import type { CinemaTimelineAudioClip, CinemaTimelineVideoClip } from "@anybox/cinema-plugin/contracts/timeline"
import { timelineSourceRangePeaks } from "../model/timelineWaveform"

export function TimelineWaveform({
  agentBaseURL,
  projectID,
  timelineID,
  clip,
}: {
  agentBaseURL: string
  projectID: string
  timelineID: string
  clip: CinemaTimelineAudioClip | CinemaTimelineVideoClip
}) {
  const api = useMemo(() => createTimelineApi(agentBaseURL, projectID), [agentBaseURL, projectID])
  const query = useQuery({
    queryKey: ["cinema-timeline-waveform", agentBaseURL, projectID, timelineID, clip.id, clip.assetRef.assetID, clip.assetRef.contentRevision],
    queryFn: () => api.getWaveform(timelineID, clip.id),
    staleTime: Number.POSITIVE_INFINITY,
    retry: (failureCount, error) => error instanceof CinemaTimelineApiError && error.status === 404 && failureCount < 3,
    retryDelay: 200,
  })
  if (!query.data) return <span className={`cinema-timeline-waveform-placeholder ${query.isError ? "is-error" : ""}`} aria-hidden="true" />
  const visiblePeaks = timelineSourceRangePeaks(
    query.data.peaks,
    clip.sourceInUs,
    clip.sourceDurationUs,
    clip.assetRef.snapshot.durationSeconds === undefined
      ? null
      : Math.round(clip.assetRef.snapshot.durationSeconds * 1_000_000),
  )
  const middle = 20
  const path = visiblePeaks.map((peak, index) => {
    const x = visiblePeaks.length <= 1 ? 0 : index / (visiblePeaks.length - 1) * 100
    const height = Math.max(1, peak * 18)
    return `M${x.toFixed(2)} ${(middle - height).toFixed(2)}V${(middle + height).toFixed(2)}`
  }).join("")
  return (
    <svg className="cinema-timeline-waveform" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">
      <path d={path} />
    </svg>
  )
}
