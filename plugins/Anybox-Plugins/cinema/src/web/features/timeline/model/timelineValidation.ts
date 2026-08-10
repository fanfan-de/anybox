import type { CinemaAssetStatus } from "@anybox/cinema-plugin/contracts"
import type { CinemaTimelineDocument } from "@anybox/cinema-plugin/contracts/timeline"

export type TimelineValidationIssue = {
  code: "empty" | "no-main-video" | "asset-unavailable"
  severity: "error" | "warning"
  message: string
  clipID?: string
}

export function validateTimelineForDelivery(
  document: CinemaTimelineDocument,
  assetStatuses: ReadonlyMap<string, CinemaAssetStatus | "unresolved"> = new Map(),
) {
  const issues: TimelineValidationIssue[] = []
  if (document.clips.length === 0) {
    issues.push({ code: "empty", severity: "error", message: "Timeline is empty." })
  }
  const videoTrackIDs = new Set(document.tracks.filter((track) => track.kind === "video" && !track.hidden).map((track) => track.id))
  if (!document.clips.some((clip) => clip.kind === "video" && videoTrackIDs.has(clip.trackID))) {
    issues.push({ code: "no-main-video", severity: "error", message: "Add a main video clip before delivery." })
  }
  for (const clip of document.clips) {
    if (clip.kind === "text" || clip.kind === "subtitle") continue
    const status = assetStatuses.get(clip.assetRef.assetID)
    if (status && status !== "ready" && status !== "unresolved") {
      issues.push({
        code: "asset-unavailable",
        severity: "error",
        clipID: clip.id,
        message: `${clip.title} is ${status}. Replace its asset.`,
      })
    }
  }
  return {
    ready: issues.every((issue) => issue.severity !== "error"),
    issues,
  }
}
