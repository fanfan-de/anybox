import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { CinemaTimelineApiError, createTimelineApi } from "../api/timelineApi"

export function TimelineWaveform({
  agentBaseURL,
  projectID,
  timelineID,
  clipID,
}: {
  agentBaseURL: string
  projectID: string
  timelineID: string
  clipID: string
}) {
  const api = useMemo(() => createTimelineApi(agentBaseURL, projectID), [agentBaseURL, projectID])
  const query = useQuery({
    queryKey: ["cinema-timeline-waveform", agentBaseURL, projectID, timelineID, clipID],
    queryFn: () => api.getWaveform(timelineID, clipID),
    staleTime: Number.POSITIVE_INFINITY,
    retry: (failureCount, error) => error instanceof CinemaTimelineApiError && error.status === 404 && failureCount < 3,
    retryDelay: 200,
  })
  if (!query.data) return <span className={`cinema-timeline-waveform-placeholder ${query.isError ? "is-error" : ""}`} aria-hidden="true" />
  const middle = 20
  const path = query.data.peaks.map((peak, index) => {
    const x = query.data!.peaks.length <= 1 ? 0 : index / (query.data!.peaks.length - 1) * 100
    const height = Math.max(1, peak * 18)
    return `M${x.toFixed(2)} ${(middle - height).toFixed(2)}V${(middle + height).toFixed(2)}`
  }).join("")
  return (
    <svg className="cinema-timeline-waveform" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">
      <path d={path} />
    </svg>
  )
}
