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

function orderedTracks(tracks: readonly CinemaTimelineTrack[]) {
  return [...tracks].sort((left, right) => left.order - right.order)
}

function indexTracks(tracks: readonly CinemaTimelineTrack[]) {
  return tracks.map((track, order) => ({ ...track, order }))
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

function applyClipPatch(
  clip: CinemaTimelineClip,
  patch: Extract<CinemaTimelineCommand, { type: "update-clip" }>["patch"],
  timestamp: string,
) {
  const next = { ...clip, ...patch, updatedAt: timestamp } as CinemaTimelineClip
  if (patch.fit === null && "fit" in next) delete next.fit
  const mutable = next as CinemaTimelineClip & { fadeInUs?: number; fadeOutUs?: number; transform?: unknown; speaker?: string }
  if (patch.transform === null) delete mutable.transform
  if (patch.fadeInUs === null) delete mutable.fadeInUs
  if (patch.fadeOutUs === null) delete mutable.fadeOutUs
  if (patch.speaker === null) delete mutable.speaker
  return next
}

function assertClipPatchCompatible(
  clip: CinemaTimelineClip,
  patch: Extract<CinemaTimelineCommand, { type: "update-clip" }>["patch"],
) {
  if ((clip.kind === "text" || clip.kind === "subtitle") && patch.assetRef) {
    throw new ApiError(409, "CINEMA_TIMELINE_ASSET_REF_UNSUPPORTED", `${clip.kind} clips cannot reference physical assets.`)
  }
  if (clip.kind === "audio" && patch.transform !== undefined) {
    throw new ApiError(409, "CINEMA_TIMELINE_TRANSFORM_UNSUPPORTED", "Audio clips cannot have visual transforms.")
  }
  if (clip.kind !== "subtitle" && (patch.cueText !== undefined || patch.speaker !== undefined)) {
    throw new ApiError(409, "CINEMA_TIMELINE_SUBTITLE_PATCH_UNSUPPORTED", "Subtitle fields can only update subtitle cues.")
  }
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
      if (command.track.order > document.tracks.length) {
        throw new ApiError(409, "CINEMA_TIMELINE_TRACK_ORDER_INVALID", "Track insertion order is outside the current track range.")
      }
      const tracks = orderedTracks(document.tracks)
      tracks.splice(command.track.order, 0, command.track)
      return { ...document, tracks: indexTracks(tracks) }
    }
    case "create-track-with-clips": {
      if (document.tracks.some((track) => track.id === command.track.id)) {
        throw new ApiError(409, "CINEMA_TIMELINE_TRACK_ID_CONFLICT", `Track '${command.track.id}' already exists.`)
      }
      if (command.track.order > document.tracks.length) {
        throw new ApiError(409, "CINEMA_TIMELINE_TRACK_ORDER_INVALID", "Track insertion order is outside the current track range.")
      }
      const existingClipIDs = new Set(document.clips.map((clip) => clip.id))
      for (const clip of command.clips) {
        if (existingClipIDs.has(clip.id)) {
          throw new ApiError(409, "CINEMA_TIMELINE_CLIP_ID_CONFLICT", `Clip '${clip.id}' already exists.`)
        }
      }
      const tracks = orderedTracks(document.tracks)
      tracks.splice(command.track.order, 0, command.track)
      return {
        ...document,
        tracks: indexTracks(tracks),
        clips: [...document.clips, ...command.clips],
      }
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
    case "delete-track": {
      const track = findTrack(document, command.trackID)
      assertTrackUnlocked(track)
      const trackClips = document.clips.filter((clip) => clip.trackID === track.id)
      if (trackClips.length > 0 && !command.deleteClips) {
        throw new ApiError(
          409,
          "CINEMA_TIMELINE_TRACK_NOT_EMPTY",
          `Track '${track.id}' contains ${trackClips.length} clip(s).`,
          { clipCount: trackClips.length },
        )
      }
      return {
        ...document,
        tracks: indexTracks(orderedTracks(document.tracks).filter((candidate) => candidate.id !== track.id)),
        clips: command.deleteClips
          ? document.clips.filter((clip) => clip.trackID !== track.id)
          : document.clips,
      }
    }
    case "reorder-tracks": {
      const tracksByID = new Map(document.tracks.map((track) => [track.id, track]))
      if (
        command.trackIDs.length !== document.tracks.length
        || command.trackIDs.some((trackID) => !tracksByID.has(trackID))
      ) {
        throw new ApiError(
          409,
          "CINEMA_TIMELINE_TRACK_ORDER_INVALID",
          "Track ordering must contain every current track exactly once.",
        )
      }
      return {
        ...document,
        tracks: command.trackIDs.map((trackID, order) => ({ ...tracksByID.get(trackID)!, order })),
      }
    }
    case "add-clip": {
      if (document.clips.some((clip) => clip.id === command.clip.id)) {
        throw new ApiError(409, "CINEMA_TIMELINE_CLIP_ID_CONFLICT", `Clip '${command.clip.id}' already exists.`)
      }
      assertTrackUnlocked(findTrack(document, command.clip.trackID))
      return { ...document, clips: [...document.clips, command.clip] }
    }
    case "add-clips": {
      const existingIDs = new Set(document.clips.map((clip) => clip.id))
      for (const clip of command.clips) {
        if (existingIDs.has(clip.id)) {
          throw new ApiError(409, "CINEMA_TIMELINE_CLIP_ID_CONFLICT", `Clip '${clip.id}' already exists.`)
        }
        assertTrackUnlocked(findTrack(document, clip.trackID))
      }
      return { ...document, clips: [...document.clips, ...command.clips] }
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
    case "move-clips": {
      for (const placement of command.placements) {
        const clip = findClip(document, placement.clipID)
        assertTrackUnlocked(findTrack(document, clip.trackID))
        assertTrackUnlocked(findTrack(document, placement.trackID))
      }
      const placements = new Map(command.placements.map((placement) => [placement.clipID, placement]))
      return {
        ...document,
        clips: document.clips.map((clip) => {
          const placement = placements.get(clip.id)
          return placement ? {
            ...clip,
            trackID: placement.trackID,
            timelineStartUs: placement.timelineStartUs,
            updatedAt: timestamp,
          } : clip
        }),
      }
    }
    case "trim-clip": {
      const clip = findClip(document, command.clipID)
      assertTrackUnlocked(findTrack(document, clip.trackID))
      if (clip.kind === "text" || clip.kind === "subtitle") {
        throw new ApiError(409, "CINEMA_TIMELINE_TRIM_UNSUPPORTED", `${clip.kind} clips do not have a physical source range.`)
      }
      return {
        ...document,
        clips: replaceClip(document, command.clipID, (current) => {
          if (current.kind === "text" || current.kind === "subtitle") return current
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
    case "trim-timed-clip": {
      const clip = findClip(document, command.clipID)
      assertTrackUnlocked(findTrack(document, clip.trackID))
      if (clip.kind !== "text" && clip.kind !== "subtitle") {
        throw new ApiError(409, "CINEMA_TIMELINE_TIMED_TRIM_UNSUPPORTED", "Only text and subtitle clips support timed trimming.")
      }
      return {
        ...document,
        clips: replaceClip(document, command.clipID, (current) => ({
          ...current,
          timelineStartUs: command.timelineStartUs,
          durationUs: command.durationUs,
          updatedAt: timestamp,
        })),
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
      if (clip.kind === "text" || clip.kind === "subtitle") {
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
    case "ripple-delete-clips": {
      const ids = new Set(command.clipIDs)
      const deleted = command.clipIDs.map((clipID) => findClip(document, clipID))
      const trackIDs = new Set(deleted.map((clip) => clip.trackID))
      if (trackIDs.size !== 1) {
        throw new ApiError(409, "CINEMA_TIMELINE_RIPPLE_MULTI_TRACK_UNSUPPORTED", "Ripple Delete currently requires clips from one track.")
      }
      const trackID = deleted[0]!.trackID
      assertTrackUnlocked(findTrack(document, trackID))
      const intervals = deleted
        .map((clip) => ({ endUs: clip.timelineStartUs + clip.durationUs, durationUs: clip.durationUs }))
        .sort((left, right) => left.endUs - right.endUs)
      return {
        ...document,
        clips: document.clips.flatMap((clip) => {
          if (ids.has(clip.id)) return []
          if (clip.trackID !== trackID) return [clip]
          const shiftUs = intervals.reduce((total, interval) => (
            interval.endUs <= clip.timelineStartUs ? total + interval.durationUs : total
          ), 0)
          return [{
            ...clip,
            timelineStartUs: clip.timelineStartUs - shiftUs,
            ...(shiftUs > 0 ? { updatedAt: timestamp } : {}),
          }]
        }),
      }
    }
    case "update-clip": {
      const clip = findClip(document, command.clipID)
      assertTrackUnlocked(findTrack(document, clip.trackID))
      assertClipPatchCompatible(clip, command.patch)
      return {
        ...document,
        clips: replaceClip(document, command.clipID, (current) => applyClipPatch(current, command.patch, timestamp)),
      }
    }
    case "update-clips": {
      for (const update of command.updates) {
        const clip = findClip(document, update.clipID)
        assertTrackUnlocked(findTrack(document, clip.trackID))
        assertClipPatchCompatible(clip, update.patch)
      }
      const updates = new Map(command.updates.map((update) => [update.clipID, update.patch]))
      return {
        ...document,
        clips: document.clips.map((clip) => {
          const patch = updates.get(clip.id)
          return patch ? applyClipPatch(clip, patch, timestamp) : clip
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
