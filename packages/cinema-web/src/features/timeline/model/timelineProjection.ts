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

export function projectTimelineCommand(
  document: CinemaTimelineDocument,
  command: CinemaTimelineCommandDraft,
  timestamp = new Date().toISOString(),
) {
  let next: CinemaTimelineDocument
  switch (command.type) {
    case "create-track":
      next = { ...document, tracks: [...document.tracks, command.track] }
      break
    case "update-track":
      next = { ...document, tracks: document.tracks.map((track) => track.id === command.trackID ? { ...track, ...command.patch } : track) }
      break
    case "add-clip":
      next = { ...document, clips: [...document.clips, command.clip] }
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
    case "trim-clip":
      next = {
        ...document,
        clips: document.clips.map((clip) => {
          if (clip.id !== command.clipID) return clip
          if (clip.kind === "text") throw new TimelineProjectionError("Text clips do not have a source range.")
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
    case "split-clip": {
      const clip = clipByID(document, command.clipID)
      const offsetUs = command.splitTimeUs - clip.timelineStartUs
      if (offsetUs <= 0 || offsetUs >= clip.durationUs) throw new TimelineProjectionError("Split time must be inside the clip.")
      let left: CinemaTimelineClip
      let right: CinemaTimelineClip
      if (clip.kind === "text") {
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
    case "update-clip":
      next = {
        ...document,
        clips: document.clips.map((clip) => {
          if (clip.id !== command.clipID) return clip
          const updated = { ...clip, ...command.patch, updatedAt: timestamp } as CinemaTimelineClip
          if (command.patch.fit === null) delete updated.fit
          const mutable = updated as CinemaTimelineClip & { fadeInUs?: number; fadeOutUs?: number }
          if (command.patch.fadeInUs === null) delete mutable.fadeInUs
          if (command.patch.fadeOutUs === null) delete mutable.fadeOutUs
          return updated
        }),
      }
      break
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
