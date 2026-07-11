import {
  CinemaTimelineDocumentSchema,
  type CinemaTimelineClip,
  type CinemaTimelineDocument,
} from "@anybox/shared/cinema-timeline"
import type { CinemaTimelineCommandDraft } from "../state/TimelineCommandQueue"

export class TimelineProjectionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "TimelineProjectionError"
  }
}

function clipByID(document: CinemaTimelineDocument, clipID: string) {
  const clip = document.clips.find((candidate) => candidate.id === clipID)
  if (!clip) throw new TimelineProjectionError(`Clip '${clipID}' was not found.`)
  return clip
}

function trackByID(document: CinemaTimelineDocument, trackID: string) {
  const track = document.tracks.find((candidate) => candidate.id === trackID)
  if (!track) throw new TimelineProjectionError(`Track '${trackID}' was not found.`)
  return track
}

export function projectTimelineCommand(
  document: CinemaTimelineDocument,
  command: CinemaTimelineCommandDraft,
  timestamp = new Date().toISOString(),
) {
  let next: CinemaTimelineDocument
  switch (command.type) {
    case "create-track": {
      if (document.tracks.some((track) => track.id === command.track.id)) {
        throw new TimelineProjectionError(`Track '${command.track.id}' already exists.`)
      }
      if (command.track.order > document.tracks.length) {
        throw new TimelineProjectionError("Track insertion order is outside the current track range.")
      }
      const tracks = [...document.tracks].sort((left, right) => left.order - right.order)
      tracks.splice(command.track.order, 0, command.track)
      next = { ...document, tracks: tracks.map((track, order) => ({ ...track, order })) }
      break
    }
    case "create-track-with-clips": {
      if (document.tracks.some((track) => track.id === command.track.id)) {
        throw new TimelineProjectionError(`Track '${command.track.id}' already exists.`)
      }
      if (command.track.order > document.tracks.length) {
        throw new TimelineProjectionError("Track insertion order is outside the current track range.")
      }
      const tracks = [...document.tracks].sort((left, right) => left.order - right.order)
      tracks.splice(command.track.order, 0, command.track)
      next = {
        ...document,
        tracks: tracks.map((track, order) => ({ ...track, order })),
        clips: [...document.clips, ...command.clips],
      }
      break
    }
    case "update-track":
      trackByID(document, command.trackID)
      next = { ...document, tracks: document.tracks.map((track) => track.id === command.trackID ? { ...track, ...command.patch } : track) }
      break
    case "delete-track": {
      const track = trackByID(document, command.trackID)
      if (track.locked) throw new TimelineProjectionError(`Track '${track.id}' is locked.`)
      if (document.clips.some((clip) => clip.trackID === command.trackID) && !command.deleteClips) {
        throw new TimelineProjectionError("Track is not empty.")
      }
      next = {
        ...document,
        tracks: document.tracks
          .filter((track) => track.id !== command.trackID)
          .sort((left, right) => left.order - right.order)
          .map((track, order) => ({ ...track, order })),
        clips: command.deleteClips
          ? document.clips.filter((clip) => clip.trackID !== command.trackID)
          : document.clips,
      }
      break
    }
    case "reorder-tracks": {
      const tracksByID = new Map(document.tracks.map((track) => [track.id, track]))
      if (
        command.trackIDs.length !== document.tracks.length
        || command.trackIDs.some((trackID) => !tracksByID.has(trackID))
      ) throw new TimelineProjectionError("Track ordering must contain every track exactly once.")
      next = {
        ...document,
        tracks: command.trackIDs.map((trackID, order) => ({ ...tracksByID.get(trackID)!, order })),
      }
      break
    }
    case "add-clip":
      next = { ...document, clips: [...document.clips, command.clip] }
      break
    case "add-clips":
      next = { ...document, clips: [...document.clips, ...command.clips] }
      break
    case "move-clip":
      next = {
        ...document,
        clips: document.clips.map((clip) => clip.id === command.clipID ? {
          ...clip,
          trackID: command.trackID,
          timelineStartUs: command.timelineStartUs,
          updatedAt: timestamp,
        } : clip),
      }
      break
    case "move-clips": {
      const placements = new Map(command.placements.map((placement) => [placement.clipID, placement]))
      next = {
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
      break
    }
    case "trim-clip":
      next = {
        ...document,
        clips: document.clips.map((clip) => {
          if (clip.id !== command.clipID) return clip
          if (clip.kind === "text" || clip.kind === "subtitle") throw new TimelineProjectionError(`${clip.kind} clips do not have a source range.`)
          return {
            ...clip,
            timelineStartUs: command.timelineStartUs,
            durationUs: command.durationUs,
            sourceInUs: command.sourceInUs,
            sourceDurationUs: command.sourceDurationUs,
            updatedAt: timestamp,
          }
        }),
      }
      break
    case "trim-timed-clip":
      next = {
        ...document,
        clips: document.clips.map((clip) => {
          if (clip.id !== command.clipID) return clip
          if (clip.kind !== "text" && clip.kind !== "subtitle") {
            throw new TimelineProjectionError("Only text and subtitle clips support timed trimming.")
          }
          return {
            ...clip,
            timelineStartUs: command.timelineStartUs,
            durationUs: command.durationUs,
            updatedAt: timestamp,
          }
        }),
      }
      break
    case "split-clip": {
      const clip = clipByID(document, command.clipID)
      const offsetUs = command.splitTimeUs - clip.timelineStartUs
      if (offsetUs <= 0 || offsetUs >= clip.durationUs) throw new TimelineProjectionError("Split time must be inside the clip.")
      let left: CinemaTimelineClip
      let right: CinemaTimelineClip
      if (clip.kind === "text" || clip.kind === "subtitle") {
        left = { ...clip, durationUs: offsetUs, updatedAt: timestamp }
        right = { ...clip, id: command.rightClipID, timelineStartUs: command.splitTimeUs, durationUs: clip.durationUs - offsetUs, createdAt: timestamp, updatedAt: timestamp }
      } else {
        const leftSourceDurationUs = Math.round(clip.sourceDurationUs * offsetUs / clip.durationUs)
        left = {
          ...clip,
          durationUs: offsetUs,
          sourceDurationUs: leftSourceDurationUs,
          ...(clip.kind === "audio" ? { fadeInUs: Math.min(clip.fadeInUs ?? 0, offsetUs), fadeOutUs: 0 } : {}),
          updatedAt: timestamp,
        }
        right = {
          ...clip,
          id: command.rightClipID,
          timelineStartUs: command.splitTimeUs,
          durationUs: clip.durationUs - offsetUs,
          sourceInUs: clip.sourceInUs + leftSourceDurationUs,
          sourceDurationUs: clip.sourceDurationUs - leftSourceDurationUs,
          ...(clip.kind === "audio" ? { fadeInUs: 0, fadeOutUs: Math.min(clip.fadeOutUs ?? 0, clip.durationUs - offsetUs) } : {}),
          createdAt: timestamp,
          updatedAt: timestamp,
        }
      }
      next = { ...document, clips: document.clips.flatMap((candidate) => candidate.id === clip.id ? [left, right] : [candidate]) }
      break
    }
    case "delete-clips": {
      const ids = new Set(command.clipIDs)
      next = { ...document, clips: document.clips.filter((clip) => !ids.has(clip.id)) }
      break
    }
    case "ripple-delete-clips": {
      const ids = new Set(command.clipIDs)
      const deleted = command.clipIDs.map((clipID) => clipByID(document, clipID))
      const trackIDs = new Set(deleted.map((clip) => clip.trackID))
      if (trackIDs.size !== 1) throw new TimelineProjectionError("Ripple Delete currently requires clips from one track.")
      const trackID = deleted[0]!.trackID
      const intervals = deleted
        .map((clip) => ({ endUs: clip.timelineStartUs + clip.durationUs, durationUs: clip.durationUs }))
        .sort((left, right) => left.endUs - right.endUs)
      next = {
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
      break
    }
    case "update-clip":
      next = {
        ...document,
        clips: document.clips.map((clip) => {
          if (clip.id !== command.clipID) return clip
          const updated = { ...clip, ...command.patch, updatedAt: timestamp } as CinemaTimelineClip
          if (command.patch.fit === null && "fit" in updated) delete updated.fit
          const mutable = updated as CinemaTimelineClip & { fadeInUs?: number; fadeOutUs?: number; transform?: unknown; speaker?: string }
          if (command.patch.transform === null) delete mutable.transform
          if (command.patch.fadeInUs === null) delete mutable.fadeInUs
          if (command.patch.fadeOutUs === null) delete mutable.fadeOutUs
          if (command.patch.speaker === null) delete mutable.speaker
          return updated
        }),
      }
      break
    case "update-clips": {
      const updates = new Map(command.updates.map((update) => [update.clipID, update.patch]))
      next = {
        ...document,
        clips: document.clips.map((clip) => {
          const patch = updates.get(clip.id)
          if (!patch) return clip
          const updated = { ...clip, ...patch, updatedAt: timestamp } as CinemaTimelineClip
          if (patch.fit === null && "fit" in updated) delete updated.fit
          const mutable = updated as CinemaTimelineClip & { fadeInUs?: number; fadeOutUs?: number; transform?: unknown; speaker?: string }
          if (patch.transform === null) delete mutable.transform
          if (patch.fadeInUs === null) delete mutable.fadeInUs
          if (patch.fadeOutUs === null) delete mutable.fadeOutUs
          if (patch.speaker === null) delete mutable.speaker
          return updated
        }),
      }
      break
    }
    case "add-marker":
      next = { ...document, markers: [...document.markers, command.marker] }
      break
    case "move-marker":
      next = { ...document, markers: document.markers.map((marker) => marker.id === command.markerID ? { ...marker, timeUs: command.timeUs } : marker) }
      break
    case "delete-marker":
      next = { ...document, markers: document.markers.filter((marker) => marker.id !== command.markerID) }
      break
    case "update-settings":
      next = { ...document, settings: { ...document.settings, ...command.patch } }
      break
  }

  const parsed = CinemaTimelineDocumentSchema.safeParse(next)
  if (!parsed.success) throw new TimelineProjectionError(parsed.error.issues[0]?.message ?? "Command would produce an invalid Timeline.")
  return parsed.data
}
