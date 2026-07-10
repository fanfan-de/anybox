import { ZodError } from "zod"

import {
  CinemaTimelineDocumentSchema,
  type CinemaTimelineClip,
  type CinemaTimelineCommand,
  type CinemaTimelineDocument,
  type CinemaTimelineTrack,
} from "@anybox/shared/cinema-timeline"
import { ApiError } from "#server/error.ts"

function findTrack(document: CinemaTimelineDocument, trackID: string) {
  const track = document.tracks.find((candidate) => candidate.id === trackID)
  if (!track) {
    throw new ApiError(404, "CINEMA_TIMELINE_TRACK_NOT_FOUND", `Track '${trackID}' was not found.`)
  }
  return track
}

function findClip(document: CinemaTimelineDocument, clipID: string) {
  const clip = document.clips.find((candidate) => candidate.id === clipID)
  if (!clip) {
    throw new ApiError(404, "CINEMA_TIMELINE_CLIP_NOT_FOUND", `Clip '${clipID}' was not found.`)
  }
  return clip
}

function assertTrackUnlocked(track: CinemaTimelineTrack) {
  if (track.locked) {
    throw new ApiError(409, "CINEMA_TIMELINE_TRACK_LOCKED", `Track '${track.id}' is locked.`)
  }
}

function replaceClip(
  document: CinemaTimelineDocument,
  clipID: string,
  update: (clip: CinemaTimelineClip) => CinemaTimelineClip,
) {
  let found = false
  const clips = document.clips.map((clip) => {
    if (clip.id !== clipID) return clip
    found = true
    return update(clip)
  })
  if (!found) findClip(document, clipID)
  return clips
}

function applyCommandPayload(
  document: CinemaTimelineDocument,
  command: CinemaTimelineCommand,
  timestamp: string,
): CinemaTimelineDocument {
  switch (command.type) {
    case "create-track": {
      if (document.tracks.some((track) => track.id === command.track.id)) {
        throw new ApiError(409, "CINEMA_TIMELINE_TRACK_ID_CONFLICT", `Track '${command.track.id}' already exists.`)
      }
      return { ...document, tracks: [...document.tracks, command.track] }
    }
    case "update-track": {
      findTrack(document, command.trackID)
      return {
        ...document,
        tracks: document.tracks.map((track) => track.id === command.trackID
          ? { ...track, ...command.patch }
          : track),
      }
    }
    case "add-clip": {
      if (document.clips.some((clip) => clip.id === command.clip.id)) {
        throw new ApiError(409, "CINEMA_TIMELINE_CLIP_ID_CONFLICT", `Clip '${command.clip.id}' already exists.`)
      }
      assertTrackUnlocked(findTrack(document, command.clip.trackID))
      return { ...document, clips: [...document.clips, command.clip] }
    }
    case "move-clip": {
      const clip = findClip(document, command.clipID)
      assertTrackUnlocked(findTrack(document, clip.trackID))
      assertTrackUnlocked(findTrack(document, command.trackID))
      return {
        ...document,
        clips: replaceClip(document, command.clipID, (current) => ({
          ...current,
          trackID: command.trackID,
          timelineStartUs: command.timelineStartUs,
          updatedAt: timestamp,
        })),
      }
    }
    case "trim-clip": {
      const clip = findClip(document, command.clipID)
      assertTrackUnlocked(findTrack(document, clip.trackID))
      if (clip.kind === "text") {
        throw new ApiError(409, "CINEMA_TIMELINE_TRIM_UNSUPPORTED", "Text clips do not have a physical source range.")
      }
      return {
        ...document,
        clips: replaceClip(document, command.clipID, (current) => {
          if (current.kind === "text") return current
          return {
            ...current,
            timelineStartUs: command.timelineStartUs,
            durationUs: command.durationUs,
            sourceInUs: command.sourceInUs,
            sourceDurationUs: command.sourceDurationUs,
            updatedAt: timestamp,
          }
        }),
      }
    }
    case "split-clip": {
      const clip = findClip(document, command.clipID)
      assertTrackUnlocked(findTrack(document, clip.trackID))
      if (document.clips.some((candidate) => candidate.id === command.rightClipID)) {
        throw new ApiError(409, "CINEMA_TIMELINE_CLIP_ID_CONFLICT", `Clip '${command.rightClipID}' already exists.`)
      }
      const splitOffsetUs = command.splitTimeUs - clip.timelineStartUs
      if (splitOffsetUs <= 0 || splitOffsetUs >= clip.durationUs) {
        throw new ApiError(409, "CINEMA_TIMELINE_SPLIT_OUT_OF_RANGE", "Split time must be inside the clip range.")
      }

      const rightDurationUs = clip.durationUs - splitOffsetUs
      let left: CinemaTimelineClip
      let right: CinemaTimelineClip
      if (clip.kind === "text") {
        left = { ...clip, durationUs: splitOffsetUs, updatedAt: timestamp }
        right = {
          ...clip,
          id: command.rightClipID,
          timelineStartUs: command.splitTimeUs,
          durationUs: rightDurationUs,
          createdAt: timestamp,
          updatedAt: timestamp,
        }
      } else {
        const leftSourceDurationUs = Math.round(clip.sourceDurationUs * (splitOffsetUs / clip.durationUs))
        left = {
          ...clip,
          durationUs: splitOffsetUs,
          sourceDurationUs: leftSourceDurationUs,
          ...(clip.kind === "audio" ? { fadeInUs: Math.min(clip.fadeInUs ?? 0, splitOffsetUs), fadeOutUs: 0 } : {}),
          updatedAt: timestamp,
        }
        right = {
          ...clip,
          id: command.rightClipID,
          timelineStartUs: command.splitTimeUs,
          durationUs: rightDurationUs,
          sourceInUs: clip.sourceInUs + leftSourceDurationUs,
          sourceDurationUs: clip.sourceDurationUs - leftSourceDurationUs,
          ...(clip.kind === "audio" ? { fadeInUs: 0, fadeOutUs: Math.min(clip.fadeOutUs ?? 0, rightDurationUs) } : {}),
          createdAt: timestamp,
          updatedAt: timestamp,
        }
      }
      return {
        ...document,
        clips: document.clips.flatMap((candidate) => candidate.id === clip.id ? [left, right] : [candidate]),
      }
    }
    case "delete-clips": {
      const ids = new Set(command.clipIDs)
      for (const clipID of ids) {
        const clip = findClip(document, clipID)
        assertTrackUnlocked(findTrack(document, clip.trackID))
      }
      return { ...document, clips: document.clips.filter((clip) => !ids.has(clip.id)) }
    }
    case "update-clip": {
      const clip = findClip(document, command.clipID)
      assertTrackUnlocked(findTrack(document, clip.trackID))
      if (clip.kind === "text" && command.patch.assetRef) {
        throw new ApiError(409, "CINEMA_TIMELINE_ASSET_REF_UNSUPPORTED", "Text clips cannot reference physical assets.")
      }
      return {
        ...document,
        clips: replaceClip(document, command.clipID, (current) => {
          const next = { ...current, ...command.patch, updatedAt: timestamp } as CinemaTimelineClip
          if (command.patch.fit === null) delete next.fit
          const mutable = next as CinemaTimelineClip & { fadeInUs?: number; fadeOutUs?: number }
          if (command.patch.fadeInUs === null) delete mutable.fadeInUs
          if (command.patch.fadeOutUs === null) delete mutable.fadeOutUs
          return next
        }),
      }
    }
    case "add-marker": {
      if (document.markers.some((marker) => marker.id === command.marker.id)) {
        throw new ApiError(409, "CINEMA_TIMELINE_MARKER_ID_CONFLICT", `Marker '${command.marker.id}' already exists.`)
      }
      return { ...document, markers: [...document.markers, command.marker] }
    }
    case "move-marker": {
      if (!document.markers.some((marker) => marker.id === command.markerID)) {
        throw new ApiError(404, "CINEMA_TIMELINE_MARKER_NOT_FOUND", `Marker '${command.markerID}' was not found.`)
      }
      return {
        ...document,
        markers: document.markers.map((marker) => marker.id === command.markerID
          ? { ...marker, timeUs: command.timeUs }
          : marker),
      }
    }
    case "delete-marker": {
      if (!document.markers.some((marker) => marker.id === command.markerID)) {
        throw new ApiError(404, "CINEMA_TIMELINE_MARKER_NOT_FOUND", `Marker '${command.markerID}' was not found.`)
      }
      return { ...document, markers: document.markers.filter((marker) => marker.id !== command.markerID) }
    }
    case "update-settings":
      return { ...document, settings: { ...document.settings, ...command.patch } }
  }
}

export function applyCinemaTimelineCommandToDocument(
  document: CinemaTimelineDocument,
  command: CinemaTimelineCommand,
  timestamp = new Date().toISOString(),
) {
  if (command.timelineID !== document.id) {
    throw new ApiError(400, "CINEMA_TIMELINE_COMMAND_TARGET_MISMATCH", "Command targets a different Timeline.")
  }
  if (command.baseRevision !== document.revision) {
    throw new ApiError(
      409,
      "CINEMA_TIMELINE_REVISION_CONFLICT",
      `Timeline revision conflict; latest revision is ${document.revision}.`,
      { latestRevision: document.revision },
    )
  }

  const next = {
    ...applyCommandPayload(document, command, timestamp),
    revision: document.revision + 1,
    updatedAt: timestamp,
  }
  try {
    return CinemaTimelineDocumentSchema.parse(next)
  } catch (error) {
    if (!(error instanceof ZodError)) throw error
    throw new ApiError(
      409,
      "CINEMA_TIMELINE_COMMAND_INVALID",
      "Timeline command would produce an invalid document.",
      { issues: error.issues },
    )
  }
}
