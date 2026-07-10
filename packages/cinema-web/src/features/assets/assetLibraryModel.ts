import type {
  CinemaAssetEntryTarget,
  CinemaAssetFolder,
  CinemaAssetLibraryEntry,
  CinemaAssetRecord,
  CinemaAssetScope,
} from "@anybox/shared"

export const CINEMA_ASSET_LIBRARY_DRAG_TYPE = "application/x-anybox-cinema-asset"
export const CINEMA_ASSET_LIBRARY_ENTRY_DRAG_TYPE = "application/x-anybox-cinema-library-entries"
export const CINEMA_ASSET_LIBRARY_VIRTUALIZATION_THRESHOLD = 200
export const CINEMA_ASSET_LIBRARY_GRID_COLUMNS = 2

export type AssetLibraryScopeType = CinemaAssetScope["type"]

export type AssetLibraryEntry = CinemaAssetLibraryEntry

export interface AssetLibraryBreadcrumb {
  id: string
  name: string
}

export interface AssetLibraryDragPayload {
  version: 1
  scope: CinemaAssetScope
  assetID: string
}

export interface AssetLibraryEntryDragPayload {
  version: 1
  scope: CinemaAssetScope
  entries: CinemaAssetEntryTarget[]
}

export interface AssetLibrarySelectionModifiers {
  toggle: boolean
  range: boolean
}

export interface AssetLibrarySelectionResult {
  selectedKeys: Set<string>
  anchorKey: string | null
}

export interface AssetLibrarySelectionSummary {
  count: number
  assetCount: number
  folderCount: number
  knownSizeBytes: number
}

export function assetLibraryScrollPositionKey(options: {
  folderID: string
  query: string
  trash: boolean
}): string {
  if (options.trash) return "trash"
  const query = options.query.normalize("NFC").trim()
  return query ? `search:${query}` : `folder:${options.folderID}`
}

const nameCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
})

export function assetLibraryScope(type: AssetLibraryScopeType, projectID: string): CinemaAssetScope {
  return type === "personal" ? { type: "personal" } : { type: "project", projectID }
}

export function assetLibraryScopeKey(scope: CinemaAssetScope): string {
  return scope.type === "personal" ? "personal" : `project:${scope.projectID}`
}

export function assetLibraryEntryKey(entry: AssetLibraryEntry): string {
  return entry.entryType === "folder" ? `folder:${entry.folder.id}` : `asset:${entry.asset.id}`
}

export function assetLibraryEntryName(entry: AssetLibraryEntry): string {
  return entry.entryType === "folder" ? entry.folder.name : entry.asset.displayName
}

export function assetLibraryEntryPath(entry: AssetLibraryEntry): string {
  if (entry.entryType === "folder") {
    return entry.folder.trash?.originalRelativePath ?? entry.folder.relativePath
  }
  return entry.asset.trash?.originalRelativePath ?? entry.asset.relativePath
}

export function assetLibraryEntryRef(entry: AssetLibraryEntry): CinemaAssetEntryTarget {
  return entry.entryType === "folder"
    ? { entryType: "folder", folderID: entry.folder.id }
    : { entryType: "asset", assetID: entry.asset.id }
}

export function sortAssetLibraryEntries(entries: AssetLibraryEntry[]): AssetLibraryEntry[] {
  return [...entries].sort((left, right) => {
    if (left.entryType !== right.entryType) return left.entryType === "folder" ? -1 : 1
    return nameCollator.compare(assetLibraryEntryName(left), assetLibraryEntryName(right))
  })
}

export function summarizeAssetLibrarySelection(entries: readonly AssetLibraryEntry[]): AssetLibrarySelectionSummary {
  let assetCount = 0
  let folderCount = 0
  let knownSizeBytes = 0
  for (const entry of entries) {
    if (entry.entryType === "folder") {
      folderCount += 1
      continue
    }
    assetCount += 1
    if (Number.isFinite(entry.asset.sizeBytes) && entry.asset.sizeBytes > 0) {
      knownSizeBytes += entry.asset.sizeBytes
    }
  }
  return {
    count: entries.length,
    assetCount,
    folderCount,
    knownSizeBytes,
  }
}

export function shouldVirtualizeAssetLibraryGrid(assetCount: number): boolean {
  return assetCount > CINEMA_ASSET_LIBRARY_VIRTUALIZATION_THRESHOLD
}

export function assetLibraryGridRowCount(assetCount: number): number {
  return Math.ceil(Math.max(0, assetCount) / CINEMA_ASSET_LIBRARY_GRID_COLUMNS)
}

export function applyAssetLibrarySelection(
  current: ReadonlySet<string>,
  orderedKeys: readonly string[],
  targetKey: string,
  anchorKey: string | null,
  modifiers: AssetLibrarySelectionModifiers,
): AssetLibrarySelectionResult {
  if (modifiers.range && anchorKey) {
    const anchorIndex = orderedKeys.indexOf(anchorKey)
    const targetIndex = orderedKeys.indexOf(targetKey)
    if (anchorIndex >= 0 && targetIndex >= 0) {
      const start = Math.min(anchorIndex, targetIndex)
      const end = Math.max(anchorIndex, targetIndex)
      const selectedKeys = modifiers.toggle ? new Set(current) : new Set<string>()
      for (let index = start; index <= end; index += 1) {
        const key = orderedKeys[index]
        if (key) selectedKeys.add(key)
      }
      return { selectedKeys, anchorKey }
    }
  }

  if (modifiers.toggle) {
    const selectedKeys = new Set(current)
    if (selectedKeys.has(targetKey)) selectedKeys.delete(targetKey)
    else selectedKeys.add(targetKey)
    return { selectedKeys, anchorKey: targetKey }
  }

  return { selectedKeys: new Set([targetKey]), anchorKey: targetKey }
}

export function serializeAssetLibraryDragPayload(payload: AssetLibraryDragPayload): string {
  return JSON.stringify(payload)
}

export function serializeAssetLibraryEntryDragPayload(payload: AssetLibraryEntryDragPayload): string {
  return JSON.stringify(payload)
}

export function parseAssetLibraryEntryDragPayload(value: string): AssetLibraryEntryDragPayload | null {
  try {
    const candidate = JSON.parse(value) as Partial<AssetLibraryEntryDragPayload> | null
    if (!candidate || candidate.version !== 1 || !Array.isArray(candidate.entries) || candidate.entries.length === 0) {
      return null
    }
    const scope = candidate.scope
    if (!scope || (scope.type !== "personal" && scope.type !== "project")) return null
    if (scope.type === "project" && (typeof scope.projectID !== "string" || !scope.projectID)) return null
    const entries: CinemaAssetEntryTarget[] = []
    const seen = new Set<string>()
    for (const entry of candidate.entries) {
      if (!entry || typeof entry !== "object") return null
      if (entry.entryType === "folder" && typeof entry.folderID === "string" && entry.folderID) {
        const key = `folder:${entry.folderID}`
        if (!seen.has(key)) entries.push({ entryType: "folder", folderID: entry.folderID })
        seen.add(key)
      } else if (entry.entryType === "asset" && typeof entry.assetID === "string" && entry.assetID) {
        const key = `asset:${entry.assetID}`
        if (!seen.has(key)) entries.push({ entryType: "asset", assetID: entry.assetID })
        seen.add(key)
      } else {
        return null
      }
    }
    return {
      version: 1,
      scope: scope.type === "personal"
        ? { type: "personal" }
        : { type: "project", projectID: scope.projectID },
      entries,
    }
  } catch {
    return null
  }
}

export function parseAssetLibraryDragPayload(value: string): AssetLibraryDragPayload | null {
  try {
    const candidate = JSON.parse(value) as Partial<AssetLibraryDragPayload> | null
    if (!candidate || candidate.version !== 1 || typeof candidate.assetID !== "string" || !candidate.assetID) {
      return null
    }
    const scope = candidate.scope
    if (!scope || (scope.type !== "personal" && scope.type !== "project")) return null
    if (scope.type === "project" && (typeof scope.projectID !== "string" || !scope.projectID)) return null
    return {
      version: 1,
      scope: scope.type === "personal"
        ? { type: "personal" }
        : { type: "project", projectID: scope.projectID },
      assetID: candidate.assetID,
    }
  } catch {
    return null
  }
}

/**
 * Catalog displayName is the editable base name and may itself contain dots.
 * The read-only extension must therefore be recovered from the physical file
 * name instead of splitting displayName at its final dot.
 */
export function assetRenameParts(asset: CinemaAssetRecord): { baseName: string; extension: string } {
  const relativePath = asset.trash?.originalRelativePath ?? asset.relativePath
  const filename = relativePath.split(/[\\/]/).at(-1) ?? ""
  const suffix = filename.startsWith(asset.displayName)
    ? filename.slice(asset.displayName.length)
    : ""
  return {
    baseName: asset.displayName,
    extension: suffix.startsWith(".") ? suffix : "",
  }
}

export function formatAssetLibrarySize(sizeBytes: number | undefined): string {
  if (typeof sizeBytes !== "number" || !Number.isFinite(sizeBytes) || sizeBytes < 0) return ""
  if (sizeBytes < 1024) return `${Math.round(sizeBytes)} B`
  const units = ["KB", "MB", "GB", "TB"]
  let value = sizeBytes / 1024
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`
}

export function formatAssetLibraryDuration(durationSeconds: number | undefined): string {
  if (typeof durationSeconds !== "number" || !Number.isFinite(durationSeconds) || durationSeconds < 0) return ""
  const totalSeconds = Math.round(durationSeconds)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`
}

export function formatAssetLibraryTimestamp(value: string | undefined): string {
  if (!value) return ""
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)
}
