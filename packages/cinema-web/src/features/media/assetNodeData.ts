import {
  CinemaAssetLocatorSchema,
  CinemaAssetRefSchema,
  type CinemaAssetKind,
  type CinemaAssetLocator,
  type CinemaAssetRef,
  type CinemaAssetScope,
} from "@anybox/shared/cinema"
import { resolveCinemaRuntimeURL } from "../../runtimeUrl"

export const CINEMA_ASSET_DRAG_MIME = "application/x-anybox-cinema-asset"

export function parseCinemaAssetRef(input: unknown): CinemaAssetRef | null {
  const parsed = CinemaAssetRefSchema.safeParse(input)
  return parsed.success ? parsed.data : null
}

export function cinemaAssetRefFromNodeData(rawData: Record<string, unknown>): CinemaAssetRef | null {
  return parseCinemaAssetRef(rawData.assetRef)
}

export function cinemaAssetLocatorFromDragPayload(payload: string): CinemaAssetLocator | null {
  try {
    const parsed = CinemaAssetLocatorSchema.safeParse(JSON.parse(payload))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export function serializeCinemaAssetDragPayload(locator: CinemaAssetLocator) {
  return JSON.stringify(CinemaAssetLocatorSchema.parse(locator))
}

export function cinemaAssetLibraryBasePath(scope: CinemaAssetScope) {
  return scope.type === "project"
    ? `/api/cinema/projects/${encodeURIComponent(scope.projectID)}/library`
    : "/api/cinema/personal-library"
}

export function cinemaAssetURL(
  agentBaseURL: string,
  locator: CinemaAssetLocator,
  variant: "content" | "thumbnail" | "preview" = "content",
) {
  const path = `${cinemaAssetLibraryBasePath(locator.scope)}/assets/${encodeURIComponent(locator.assetID)}/${variant}`
  const url = new URL(resolveCinemaRuntimeURL(agentBaseURL, path))
  const contentRevision = "contentRevision" in locator
    ? (locator as CinemaAssetRef).contentRevision
    : undefined
  if (Number.isInteger(contentRevision)) url.searchParams.set("v", String(contentRevision))
  return url.toString()
}

export function cinemaAssetNodeKind(rawData: Record<string, unknown>): CinemaAssetKind | null {
  return cinemaAssetRefFromNodeData(rawData)?.snapshot.kind ?? null
}

export function isCinemaAssetNodeReady(rawData: Record<string, unknown>) {
  return Boolean(cinemaAssetRefFromNodeData(rawData)) && rawData.assetStatus !== "missing"
}

export function isPersonalCinemaAssetRef(assetRef: CinemaAssetRef | null | undefined) {
  return assetRef?.scope.type === "personal"
}
