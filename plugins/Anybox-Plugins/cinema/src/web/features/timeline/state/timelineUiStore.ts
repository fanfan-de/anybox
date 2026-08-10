export type CinemaTimelineUiSnapshot = {
  playheadUs: number
  pixelsPerSecond: number
  previewPercent: number
  mediaOpen: boolean
  inspectorOpen: boolean
  snapEnabled: boolean
  selectedClipIDs: string[]
  scrollLeftPx: number
  scrollTopPx: number
  trackHeightsPx: Record<string, number>
  collapsedTrackIDs: string[]
  followPlayhead: boolean
  activeSubtitleTrackID: string | null
}

const defaultSnapshot: CinemaTimelineUiSnapshot = {
  playheadUs: 0,
  pixelsPerSecond: 48,
  previewPercent: 42,
  mediaOpen: true,
  inspectorOpen: true,
  snapEnabled: true,
  selectedClipIDs: [],
  scrollLeftPx: 0,
  scrollTopPx: 0,
  trackHeightsPx: {},
  collapsedTrackIDs: [],
  followPlayhead: true,
  activeSubtitleTrackID: null,
}

function storageKey(projectID: string, timelineID: string) {
  return `anybox:cinema:timeline-ui:${projectID}:${timelineID}`
}

export function readCinemaTimelineUiSnapshot(projectID: string, timelineID: string) {
  if (typeof localStorage === "undefined") return defaultSnapshot
  try {
    const raw = JSON.parse(localStorage.getItem(storageKey(projectID, timelineID)) ?? "null") as (
      Partial<CinemaTimelineUiSnapshot> & { selectedClipID?: unknown }
    ) | null
    if (!raw) return defaultSnapshot
    return {
      playheadUs: Number.isInteger(raw.playheadUs) && raw.playheadUs! >= 0 ? raw.playheadUs! : 0,
      pixelsPerSecond: typeof raw.pixelsPerSecond === "number" && raw.pixelsPerSecond >= 0.5 && raw.pixelsPerSecond <= 192 ? raw.pixelsPerSecond : 48,
      previewPercent: typeof raw.previewPercent === "number" && raw.previewPercent >= 25 && raw.previewPercent <= 70 ? raw.previewPercent : 42,
      mediaOpen: typeof raw.mediaOpen === "boolean" ? raw.mediaOpen : true,
      inspectorOpen: typeof raw.inspectorOpen === "boolean" ? raw.inspectorOpen : true,
      snapEnabled: typeof raw.snapEnabled === "boolean" ? raw.snapEnabled : true,
      selectedClipIDs: Array.isArray(raw.selectedClipIDs)
        ? [...new Set(raw.selectedClipIDs.filter((clipID): clipID is string => typeof clipID === "string" && clipID.length > 0))]
        : typeof raw.selectedClipID === "string"
          ? [raw.selectedClipID]
          : [],
      scrollLeftPx: typeof raw.scrollLeftPx === "number" && Number.isFinite(raw.scrollLeftPx) && raw.scrollLeftPx >= 0
        ? raw.scrollLeftPx
        : 0,
      scrollTopPx: typeof raw.scrollTopPx === "number" && Number.isFinite(raw.scrollTopPx) && raw.scrollTopPx >= 0
        ? raw.scrollTopPx
        : 0,
      trackHeightsPx: raw.trackHeightsPx && typeof raw.trackHeightsPx === "object" && !Array.isArray(raw.trackHeightsPx)
        ? Object.fromEntries(Object.entries(raw.trackHeightsPx).filter((entry): entry is [string, number] => (
            entry[0].length > 0
            && typeof entry[1] === "number"
            && Number.isFinite(entry[1])
            && entry[1] >= 72
            && entry[1] <= 240
          )))
        : {},
      collapsedTrackIDs: Array.isArray(raw.collapsedTrackIDs)
        ? [...new Set(raw.collapsedTrackIDs.filter((trackID): trackID is string => typeof trackID === "string" && trackID.length > 0))]
        : [],
      followPlayhead: typeof raw.followPlayhead === "boolean" ? raw.followPlayhead : true,
      activeSubtitleTrackID: typeof raw.activeSubtitleTrackID === "string" && raw.activeSubtitleTrackID.length > 0
        ? raw.activeSubtitleTrackID
        : null,
    }
  } catch {
    return defaultSnapshot
  }
}

export function writeCinemaTimelineUiSnapshot(
  projectID: string,
  timelineID: string,
  snapshot: CinemaTimelineUiSnapshot,
) {
  if (typeof localStorage === "undefined") return
  localStorage.setItem(storageKey(projectID, timelineID), JSON.stringify(snapshot))
}
