import {
  CinemaAssetRecordMutationResultSchema,
  type CinemaAssetRecord,
  type CinemaAssetRef,
} from "@anybox/shared/cinema"
import type { CinemaRenderJob } from "@anybox/shared/cinema-render"

import {
  getCinemaAssetLibraryOperationResult,
  getCinemaAssetLibraryState,
  registerCinemaGeneratedAsset,
} from "#cinema/asset-library.ts"
import { ApiError } from "#server/error.ts"

export function cinemaRenderAssetRef(projectID: string, asset: CinemaAssetRecord): CinemaAssetRef {
  return {
    scope: { type: "project", projectID },
    assetID: asset.id,
    contentRevision: asset.contentRevision,
    snapshot: {
      kind: asset.kind,
      displayName: asset.displayName,
      mimeType: asset.mimeType,
      ...(asset.width ? { width: asset.width } : {}),
      ...(asset.height ? { height: asset.height } : {}),
      ...(asset.durationSeconds !== undefined ? { durationSeconds: asset.durationSeconds } : {}),
    },
  }
}

export async function findRegisteredCinemaRenderOutput(job: CinemaRenderJob) {
  const previous = await getCinemaAssetLibraryOperationResult(
    { type: "project", projectID: job.projectID },
    job.operationID,
  )
  const parsed = CinemaAssetRecordMutationResultSchema.safeParse(previous)
  if (!parsed.success || parsed.data.asset.source !== "render") return undefined
  return cinemaRenderAssetRef(job.projectID, parsed.data.asset)
}

export async function registerCinemaRenderOutput(job: CinemaRenderJob, outputPath: string) {
  const previous = await findRegisteredCinemaRenderOutput(job)
  if (previous) return previous

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const state = await getCinemaAssetLibraryState({ type: "project", projectID: job.projectID })
    try {
      const registered = await registerCinemaGeneratedAsset(job.projectID, {
        operationID: job.operationID,
        baseRevision: state.revision,
        sourcePath: outputPath,
        kind: "video",
        mimeType: "video/mp4",
        displayName: job.settings.outputName,
        source: "render",
        destinationFolderID: "generated-videos",
      })
      return cinemaRenderAssetRef(job.projectID, registered.asset)
    } catch (error) {
      const recovered = await findRegisteredCinemaRenderOutput(job)
      if (recovered) return recovered
      if (!(error instanceof ApiError) || error.code !== "CINEMA_LIBRARY_REVISION_CONFLICT" || attempt === 3) {
        throw error
      }
    }
  }
  throw new Error("Render output registration could not be completed")
}
