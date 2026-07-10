import type { CinemaTimelineCommand, CinemaTimelineDocument } from "@anybox/shared/cinema-timeline"
import type { CinemaTimelineCommandDraft } from "../state/TimelineCommandQueue"

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

export type CinemaTimelineCommandTemplate = DistributiveOmit<
  CinemaTimelineCommand,
  "id" | "timelineID" | "baseRevision" | "actor"
>

export type CinemaTimelineHistoryEntry = {
  undo: CinemaTimelineCommandTemplate[]
  redo: CinemaTimelineCommandTemplate[]
}

export function timelineCommandTemplate(command: CinemaTimelineCommandDraft): CinemaTimelineCommandTemplate {
  const { id: _id, timelineID: _timelineID, actor: _actor, ...template } = command
  return template as CinemaTimelineCommandTemplate
}

export function materializeTimelineCommand(
  template: CinemaTimelineCommandTemplate,
  envelope: { id: string; timelineID: string; actor: string },
): CinemaTimelineCommandDraft {
  return { ...envelope, ...template } as CinemaTimelineCommandDraft
}

export function createTimelineHistoryEntry(
  document: CinemaTimelineDocument,
  command: CinemaTimelineCommandDraft,
): CinemaTimelineHistoryEntry | null {
  const redo = [timelineCommandTemplate(command)]
  switch (command.type) {
    case "add-clip":
      return { undo: [{ type: "delete-clips", clipIDs: [command.clip.id] }], redo }
    case "move-clip": {
      const clip = document.clips.find((candidate) => candidate.id === command.clipID)
      return clip ? { undo: [{ type: "move-clip", clipID: clip.id, trackID: clip.trackID, timelineStartUs: clip.timelineStartUs }], redo } : null
    }
    case "trim-clip": {
      const clip = document.clips.find((candidate) => candidate.id === command.clipID)
      return clip && clip.kind !== "text" ? {
        undo: [{
          type: "trim-clip",
          clipID: clip.id,
          timelineStartUs: clip.timelineStartUs,
          durationUs: clip.durationUs,
          sourceInUs: clip.sourceInUs,
          sourceDurationUs: clip.sourceDurationUs,
        }],
        redo,
      } : null
    }
    case "split-clip": {
      const clip = document.clips.find((candidate) => candidate.id === command.clipID)
      return clip && clip.kind !== "text" ? {
        undo: [
          { type: "delete-clips", clipIDs: [command.rightClipID] },
          {
            type: "trim-clip",
            clipID: clip.id,
            timelineStartUs: clip.timelineStartUs,
            durationUs: clip.durationUs,
            sourceInUs: clip.sourceInUs,
            sourceDurationUs: clip.sourceDurationUs,
          },
        ],
        redo,
      } : null
    }
    case "delete-clips": {
      const deleted = command.clipIDs
        .map((clipID) => document.clips.find((clip) => clip.id === clipID))
        .filter((clip) => clip !== undefined)
      return deleted.length > 0 ? { undo: deleted.map((clip) => ({ type: "add-clip", clip })), redo } : null
    }
    case "update-clip": {
      const clip = document.clips.find((candidate) => candidate.id === command.clipID)
      if (!clip) return null
      const patch: Record<string, unknown> = {}
      for (const key of Object.keys(command.patch) as Array<keyof typeof command.patch>) {
        if (key === "fit") patch.fit = clip.fit ?? null
        else if (key === "fadeInUs" && clip.kind === "audio") patch.fadeInUs = clip.fadeInUs ?? null
        else if (key === "fadeOutUs" && clip.kind === "audio") patch.fadeOutUs = clip.fadeOutUs ?? null
        else patch[key] = clip[key as keyof typeof clip]
      }
      return { undo: [{ type: "update-clip", clipID: clip.id, patch: patch as typeof command.patch }], redo }
    }
    case "add-marker":
      return { undo: [{ type: "delete-marker", markerID: command.marker.id }], redo }
    case "move-marker": {
      const marker = document.markers.find((candidate) => candidate.id === command.markerID)
      return marker ? { undo: [{ type: "move-marker", markerID: marker.id, timeUs: marker.timeUs }], redo } : null
    }
    case "delete-marker": {
      const marker = document.markers.find((candidate) => candidate.id === command.markerID)
      return marker ? { undo: [{ type: "add-marker", marker }], redo } : null
    }
    case "update-track": {
      const track = document.tracks.find((candidate) => candidate.id === command.trackID)
      if (!track) return null
      const patch: Record<string, unknown> = {}
      for (const key of Object.keys(command.patch) as Array<keyof typeof command.patch>) patch[key] = track[key]
      return { undo: [{ type: "update-track", trackID: track.id, patch: patch as typeof command.patch }], redo }
    }
    case "update-settings": {
      const patch: Record<string, unknown> = {}
      for (const key of Object.keys(command.patch) as Array<keyof typeof command.patch>) patch[key] = document.settings[key]
      return { undo: [{ type: "update-settings", patch: patch as typeof command.patch }], redo }
    }
    case "create-track":
      return null
  }
}
