import { createHash, randomUUID } from "node:crypto"
import { mkdir, open, readFile, rename, rm } from "node:fs/promises"
import path from "node:path"

import {
  CinemaTimelineWaveformSchema,
  type CinemaTimelineClip,
  type CinemaTimelineDocument,
} from "@anybox/shared/cinema-timeline"
import * as CinemaAssetLibrary from "#cinema/asset-library.ts"
import { extractAudioWaveformPeaks } from "#cinema/media-runtime.ts"
import { getCinemaTimelineStoragePaths } from "#cinema/timeline-storage.ts"
import { ApiError } from "#server/error.ts"
import * as Lock from "#util/lock.ts"

function clipCacheKey(clip: CinemaTimelineClip) {
  return createHash("sha256").update(clip.id).digest("hex").slice(0, 24)
}

function missingFile(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT")
}

export async function getCinemaTimelineClipWaveform(options: {
  projectID: string
  cinemaRoot: string
  timeline: CinemaTimelineDocument
  clipID: string
}) {
  const clip = options.timeline.clips.find((candidate) => candidate.id === options.clipID)
  if (!clip) throw new ApiError(404, "CINEMA_TIMELINE_CLIP_NOT_FOUND", `Clip '${options.clipID}' was not found.`)
  if (clip.kind !== "audio" && clip.kind !== "video") {
    throw new ApiError(409, "CINEMA_TIMELINE_WAVEFORM_UNSUPPORTED", "Only audio and video clips can have waveforms.")
  }
  if (clip.assetRef.scope.type === "project" && clip.assetRef.scope.projectID !== options.projectID) {
    throw new ApiError(400, "CINEMA_ASSET_SCOPE_INVALID", "Timeline cannot read an asset from another project.")
  }

  const paths = getCinemaTimelineStoragePaths(options.cinemaRoot, options.timeline.id)
  const waveformDirectory = path.join(paths.timelineCacheDirectory, "waveforms")
  const cachePath = path.join(
    waveformDirectory,
    `waveform_${clipCacheKey(clip)}_${clip.assetRef.contentRevision}.json`,
  )
  using _lock = await Lock.write(`cinema-timeline-waveform:${cachePath}`)
  const cached = await readFile(cachePath, "utf8").catch((error: unknown) => {
    if (missingFile(error)) return undefined
    throw error
  })
  if (cached) return CinemaTimelineWaveformSchema.parse(JSON.parse(cached))

  const { filePath } = await CinemaAssetLibrary.getCinemaAssetFilePath(clip.assetRef.scope, clip.assetRef.assetID)
  let peaks: number[]
  try {
    peaks = await extractAudioWaveformPeaks(filePath, 256)
  } catch (error) {
    throw new ApiError(
      409,
      "CINEMA_TIMELINE_WAVEFORM_UNAVAILABLE",
      error instanceof Error ? error.message : "Could not derive an audio waveform.",
    )
  }
  const waveform = CinemaTimelineWaveformSchema.parse({
    clipID: clip.id,
    contentRevision: clip.assetRef.contentRevision,
    sampleCount: peaks.length,
    peaks,
    generatedAt: new Date().toISOString(),
  })
  await mkdir(waveformDirectory, { recursive: true })
  const temporaryPath = `${cachePath}.${randomUUID()}.tmp`
  const handle = await open(temporaryPath, "wx")
  try {
    await handle.writeFile(`${JSON.stringify(waveform)}\n`, "utf8")
    await handle.sync()
  } finally {
    await handle.close()
  }
  try {
    await rename(temporaryPath, cachePath)
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
    throw error
  }
  return waveform
}
