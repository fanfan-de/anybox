export type CinemaTimelineUiSnapshot = {
  playheadUs: number
  pixelsPerSecond: number
  previewPercent: number
  mediaOpen: boolean
  inspectorOpen: boolean
  snapEnabled: boolean
  selectedClipID: string | null
}

const defaultSnapshot: CinemaTimelineUiSnapshot = {
  playheadUs: 0,
  pixelsPerSecond: 48,
  previewPercent: 42,
  mediaOpen: true,
  inspectorOpen: true,
  snapEnabled: true,
  selectedClipID: null,
}

function storageKey(projectID: string, timelineID: string) {
  return `anybox:cinema:timeline-ui:${projectID}:${timelineID}`
}

export function readCinemaTimelineUiSnapshot(projectID: string, timelineID: string) {
  if (typeof localStorage === "undefined") return defaultSnapshot
  try {
    const raw = JSON.parse(localStorage.getItem(storageKey(projectID, timelineID)) ?? "null") as Partial<CinemaTimelineUiSnapshot> | null
    if (!raw) return defaultSnapshot
    return {
      playheadUs: Number.isInteger(raw.playheadUs) && raw.playheadUs! >= 0 ? raw.playheadUs! : 0,
      pixelsPerSecond: typeof raw.pixelsPerSecond === "number" && raw.pixelsPerSecond >= 12 && raw.pixelsPerSecond <= 192 ? raw.pixelsPerSecond : 48,
      previewPercent: typeof raw.previewPercent === "number" && raw.previewPercent >= 25 && raw.previewPercent <= 70 ? raw.previewPercent : 42,
      mediaOpen: typeof raw.mediaOpen === "boolean" ? raw.mediaOpen : true,
      inspectorOpen: typeof raw.inspectorOpen === "boolean" ? raw.inspectorOpen : true,
      snapEnabled: typeof raw.snapEnabled === "boolean" ? raw.snapEnabled : true,
      selectedClipID: typeof raw.selectedClipID === "string" ? raw.selectedClipID : null,
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
