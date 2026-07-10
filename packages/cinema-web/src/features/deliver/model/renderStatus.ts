import {
  isCinemaRenderTerminalStatus,
  type CinemaRenderJob,
  type CinemaRenderJobStatus,
} from "@anybox/shared/cinema-render"

export const RENDER_ACTIVE_STATUSES: ReadonlySet<CinemaRenderJobStatus> = new Set([
  "queued",
  "snapshotting",
  "probing",
  "rendering",
  "registering",
])

const STATUS_LABELS: Record<CinemaRenderJobStatus, string> = {
  queued: "Queued",
  snapshotting: "Preparing inputs",
  probing: "Checking media",
  rendering: "Rendering",
  registering: "Adding output to Assets",
  succeeded: "Completed",
  failed: "Failed",
  canceled: "Canceled",
  interrupted: "Interrupted",
}

export function isRenderActive(status: CinemaRenderJobStatus) {
  return RENDER_ACTIVE_STATUSES.has(status)
}

export function renderStatusLabel(status: CinemaRenderJobStatus) {
  return STATUS_LABELS[status]
}

export function renderProgressPercent(job: CinemaRenderJob) {
  if (job.status === "succeeded") return 100
  if (job.status !== "rendering" || job.progress.percent === undefined) return undefined
  return Math.round(Math.min(100, Math.max(0, job.progress.percent)))
}

export function renderStatusTone(status: CinemaRenderJobStatus) {
  if (status === "succeeded") return "success"
  if (status === "failed") return "error"
  if (status === "canceled" || status === "interrupted") return "neutral"
  return "active"
}

export function renderHasNextStep(job: CinemaRenderJob) {
  return isCinemaRenderTerminalStatus(job.status)
}

export function formatRenderDuration(durationUs: number) {
  const totalSeconds = Math.max(0, Math.round(durationUs / 1_000_000))
  const hours = Math.floor(totalSeconds / 3_600)
  const minutes = Math.floor((totalSeconds % 3_600) / 60)
  const seconds = totalSeconds % 60
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`
}

export function formatBytes(bytes: number) {
  if (bytes < 1_024) return `${bytes} B`
  if (bytes < 1_024 ** 2) return `${(bytes / 1_024).toFixed(1)} KB`
  if (bytes < 1_024 ** 3) return `${(bytes / 1_024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1_024 ** 3).toFixed(1)} GB`
}
