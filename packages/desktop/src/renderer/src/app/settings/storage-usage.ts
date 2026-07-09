import type { DesktopStorageUsageSnapshot } from "../../../../shared/desktop-ipc-contract"

export function formatStorageBytes(bytes: number | null | undefined) {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return "Unknown"
  if (bytes < 1024) return `${Math.max(0, Math.round(bytes))} B`

  const units = ["KB", "MB", "GB", "TB"] as const
  let value = Math.max(0, bytes) / 1024
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }

  return `${value >= 100 ? value.toFixed(0) : value >= 10 ? value.toFixed(1) : value.toFixed(2)} ${units[unitIndex]}`
}

export function sortStorageTables(tables: DesktopStorageUsageSnapshot["tables"]) {
  return [...tables].sort((a, b) => b.estimatedBytes - a.estimatedBytes || a.name.localeCompare(b.name))
}

export function sortArchivedSessionUsage(sessions: DesktopStorageUsageSnapshot["archivedSessions"]) {
  return [...sessions].sort((a, b) => b.estimatedBytes - a.estimatedBytes || b.archivedAt - a.archivedAt)
}
