import type {
  CinemaGeneratedAsset,
  CinemaGenerationProgress,
  CinemaImageNodeData as SharedCinemaImageNodeData,
  CinemaImageNodeSourceKind as SharedCinemaImageNodeSourceKind,
} from "@anybox/shared/cinema"

export type CinemaImageNodeSourceKind = SharedCinemaImageNodeSourceKind
export type CinemaImageNodeData = SharedCinemaImageNodeData
export type CinemaImageNodeState = "empty" | "generating" | "choosing" | "ready"

const ACTIVE_IMAGE_STATUSES = new Set([
  "queued",
  "running",
  "submitting",
  "generating",
  "uploading",
  "submitted",
  "processing",
  "downloading",
  "finalizing",
])

const IMAGE_SOURCE_KINDS = new Set<CinemaImageNodeSourceKind>([
  "upload",
  "generation",
  "crop",
])

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function optionalFiniteInteger(
  value: unknown,
  predicate: (value: number) => boolean,
): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && predicate(value)
    ? value
    : undefined
}

export function parseCinemaImageAsset(value: unknown): CinemaGeneratedAsset | null {
  const record = asRecord(value)
  if (record.kind !== undefined && record.kind !== "image") return null

  const path = typeof record.path === "string" && record.path.trim() ? record.path : null
  if (!path) return null

  const id = typeof record.id === "string" && record.id.trim()
    ? record.id
    : `image-${path}`
  const asset: CinemaGeneratedAsset = {
    id,
    kind: "image",
    path,
  }
  if (typeof record.mimeType === "string") asset.mimeType = record.mimeType

  const sizeBytes = optionalFiniteInteger(record.sizeBytes, (candidate) => candidate >= 0)
  if (sizeBytes !== undefined) asset.sizeBytes = sizeBytes

  const width = optionalFiniteInteger(record.width, (candidate) => candidate > 0)
  if (width !== undefined) asset.width = width

  const height = optionalFiniteInteger(record.height, (candidate) => candidate > 0)
  if (height !== undefined) asset.height = height

  if (typeof record.url === "string" && record.url.trim()) asset.url = record.url
  return asset
}

function parseCinemaImageAssetList(value: unknown): CinemaGeneratedAsset[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((candidate) => {
    const asset = parseCinemaImageAsset(candidate)
    return asset ? [asset] : []
  })
}

function selectedAsset(
  assets: CinemaGeneratedAsset[],
  selectedAssetID: unknown,
): CinemaGeneratedAsset | null {
  if (typeof selectedAssetID === "string") {
    const selected = assets.find((asset) => asset.id === selectedAssetID)
    if (selected) return selected
  }
  return assets[0] ?? null
}

function readSourceKind(value: unknown): CinemaImageNodeSourceKind | null {
  return typeof value === "string" && IMAGE_SOURCE_KINDS.has(value as CinemaImageNodeSourceKind)
    ? value as CinemaImageNodeSourceKind
    : null
}

function hasGenerationProvenance(rawData: Record<string, unknown>) {
  return ["taskID", "providerID", "modelID", "generatedAt"]
    .some((key) => typeof rawData[key] === "string" && rawData[key].trim())
}

function inferSourceKind({
  rawData,
  directAsset,
  legacyAsset,
  candidateAssets,
}: {
  rawData: Record<string, unknown>
  directAsset: CinemaGeneratedAsset | null
  legacyAsset: CinemaGeneratedAsset | null
  candidateAssets: CinemaGeneratedAsset[]
}): CinemaImageNodeSourceKind | null {
  const explicitSourceKind = readSourceKind(rawData.sourceKind)
  if (explicitSourceKind) return explicitSourceKind
  if (rawData.derivedOperation === "crop") return "crop"
  if (legacyAsset) return "generation"
  if (directAsset) return hasGenerationProvenance(rawData) ? "generation" : "upload"
  if (candidateAssets.length > 0) return "generation"
  return null
}

export function canonicalizeCinemaImageNodeData(rawData: unknown): CinemaImageNodeData {
  const source = asRecord(rawData)
  const next: Record<string, unknown> = { ...source }
  const directAsset = parseCinemaImageAsset(source.asset)
  const legacyAssets = parseCinemaImageAssetList(source.resultAssets)
  const legacyAsset = directAsset
    ? null
    : selectedAsset(legacyAssets, source.selectedAssetID)
  const finalAsset = directAsset ?? legacyAsset
  const candidateAssets = parseCinemaImageAssetList(source.candidateAssets)

  delete next.resultAssets
  delete next.selectedAssetID

  if (finalAsset) next.asset = finalAsset
  else delete next.asset

  if (!finalAsset && candidateAssets.length > 0) {
    next.candidateAssets = candidateAssets
    next.selectedCandidateAssetID = selectedAsset(
      candidateAssets,
      source.selectedCandidateAssetID,
    )!.id
  } else {
    delete next.candidateAssets
    delete next.selectedCandidateAssetID
  }

  const sourceKind = inferSourceKind({
    rawData: source,
    directAsset,
    legacyAsset,
    candidateAssets,
  })
  if (sourceKind) next.sourceKind = sourceKind
  else delete next.sourceKind

  return next as CinemaImageNodeData
}

export function readCinemaImageFinalAsset(rawData: unknown): CinemaGeneratedAsset | null {
  return parseCinemaImageAsset(canonicalizeCinemaImageNodeData(rawData).asset)
}

export function readCinemaImageCandidateAssets(rawData: unknown): CinemaGeneratedAsset[] {
  return parseCinemaImageAssetList(asRecord(rawData).candidateAssets)
}

export function readCinemaImageSelectedCandidate(rawData: unknown): CinemaGeneratedAsset | null {
  const record = asRecord(rawData)
  return selectedAsset(
    readCinemaImageCandidateAssets(record),
    record.selectedCandidateAssetID,
  )
}

function isActiveImageStatus(value: unknown): boolean {
  return typeof value === "string" && ACTIVE_IMAGE_STATUSES.has(value.toLowerCase())
}

export function deriveCinemaImageNodeState(
  rawData: unknown,
  taskStatus?: string | null,
): CinemaImageNodeState {
  const canonical = canonicalizeCinemaImageNodeData(rawData)
  if (parseCinemaImageAsset(canonical.asset)) return "ready"
  if (readCinemaImageCandidateAssets(canonical).length > 0) return "choosing"

  const progress = asRecord(canonical.progress) as Partial<CinemaGenerationProgress>
  if (
    isActiveImageStatus(taskStatus)
    || isActiveImageStatus(canonical.status)
    || isActiveImageStatus(progress.phase)
  ) {
    return "generating"
  }
  return "empty"
}

export function finalizeCinemaImageCandidate(
  rawData: unknown,
  candidateID?: string | null,
): CinemaImageNodeData {
  const canonical = canonicalizeCinemaImageNodeData(rawData)
  if (parseCinemaImageAsset(canonical.asset)) return canonical

  const candidates = readCinemaImageCandidateAssets(canonical)
  const candidate = candidateID
    ? candidates.find((asset) => asset.id === candidateID) ?? null
    : readCinemaImageSelectedCandidate(canonical)
  if (!candidate) return canonical

  const finalized: Record<string, unknown> = {
    ...canonical,
    asset: candidate,
    sourceKind: "generation",
  }
  delete finalized.candidateAssets
  delete finalized.selectedCandidateAssetID
  return finalized as CinemaImageNodeData
}
