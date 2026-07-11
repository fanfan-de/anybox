import { useEffect, useMemo, useState } from "react"
import type { CinemaTimelineVideoClip } from "@anybox/shared/cinema-timeline"
import { createAssetLibraryApi } from "../../assets/assetLibraryApi"
import { timelineFilmstripCells } from "../model/timelineFilmstrip"

export function TimelineFilmstrip({
  agentBaseURL,
  projectID,
  clip,
  clipLeftPx,
  clipWidthPx,
  visibleStartPx,
  visibleEndPx,
  ready,
}: {
  agentBaseURL: string
  projectID: string
  clip: CinemaTimelineVideoClip
  clipLeftPx: number
  clipWidthPx: number
  visibleStartPx: number
  visibleEndPx: number
  ready: boolean
}) {
  const thumbnailURL = useMemo(() => createAssetLibraryApi(
    agentBaseURL,
    projectID,
    clip.assetRef.scope,
  ).assetThumbnailURL(clip.assetRef.assetID), [agentBaseURL, clip.assetRef.assetID, clip.assetRef.scope, projectID])
  const [failedURL, setFailedURL] = useState<string | null>(null)
  useEffect(() => setFailedURL(null), [thumbnailURL])
  const cells = useMemo(() => timelineFilmstripCells({
    clipLeftPx,
    clipWidthPx,
    visibleStartPx,
    visibleEndPx,
  }), [clipLeftPx, clipWidthPx, visibleEndPx, visibleStartPx])
  if (cells.length === 0) return null
  const unavailable = !ready || failedURL === thumbnailURL
  return (
    <span
      className={`cinema-timeline-filmstrip ${unavailable ? "is-unavailable" : ""}`}
      data-filmstrip-cell-count={cells.length}
      aria-hidden="true"
    >
      {cells.map((cell) => (
        <span
          key={cell.index}
          className="cinema-timeline-filmstrip-cell"
          data-filmstrip-cell={cell.index}
          style={{ left: cell.leftPx, width: cell.widthPx }}
        >
          {!unavailable ? (
            <img
              src={thumbnailURL}
              alt=""
              draggable={false}
              onError={() => setFailedURL(thumbnailURL)}
            />
          ) : null}
        </span>
      ))}
    </span>
  )
}
