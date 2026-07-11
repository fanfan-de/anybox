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
    case "add-clips":
      return { undo: [{ type: "delete-clips", clipIDs: command.clips.map((clip) => clip.id) }], redo }
    case "create-track-with-clips":
      return { undo: [{ type: "delete-track", trackID: command.track.id, deleteClips: true }], redo }
    case "move-clip": {
      const clip = document.clips.find((candidate) => candidate.id === command.clipID)
      return clip ? { undo: [{ type: "move-clip", clipID: clip.id, trackID: clip.trackID, timelineStartUs: clip.timelineStartUs }], redo } : null
    }
    case "move-clips": {
      const clips = new Map(document.clips.map((clip) => [clip.id, clip]))
      const placements = command.placements.flatMap((placement) => {
        const clip = clips.get(placement.clipID)
        return clip ? [{ clipID: clip.id, trackID: clip.trackID, timelineStartUs: clip.timelineStartUs }] : []
      })
      return placements.length === command.placements.length
        ? { undo: [{ type: "move-clips", placements }], redo }
        : null
    }
    case "trim-clip": {
      const clip = document.clips.find((candidate) => candidate.id === command.clipID)
      return clip && clip.kind !== "text" && clip.kind !== "subtitle" ? {
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
    case "trim-timed-clip": {
      const clip = document.clips.find((candidate) => candidate.id === command.clipID)
      return clip && (clip.kind === "text" || clip.kind === "subtitle") ? {
        undo: [{
          type: "trim-timed-clip",
          clipID: clip.id,
          timelineStartUs: clip.timelineStartUs,
          durationUs: clip.durationUs,
        }],
        redo,
      } : null
    }
    case "split-clip": {
      const clip = document.clips.find((candidate) => candidate.id === command.clipID)
      if (!clip) return null
      return clip.kind === "text" || clip.kind === "subtitle"
        ? {
            undo: [
              { type: "delete-clips", clipIDs: [command.rightClipID] },
              { type: "trim-timed-clip", clipID: clip.id, timelineStartUs: clip.timelineStartUs, durationUs: clip.durationUs },
            ],
            redo,
          }
        : {
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
          }
    }
    case "delete-clips": {
      const deleted = command.clipIDs
        .map((clipID) => document.clips.find((clip) => clip.id === clipID))
        .filter((clip) => clip !== undefined)
      return deleted.length > 0 ? { undo: deleted.map((clip) => ({ type: "add-clip", clip })), redo } : null
    }
    case "ripple-delete-clips": {
      const ids = new Set(command.clipIDs)
      const deleted = command.clipIDs
        .map((clipID) => document.clips.find((clip) => clip.id === clipID))
        .filter((clip) => clip !== undefined)
      if (deleted.length !== command.clipIDs.length) return null
      const trackIDs = new Set(deleted.map((clip) => clip.trackID))
      if (trackIDs.size !== 1) return null
      const trackID = deleted[0]!.trackID
      const earliestEndUs = Math.min(...deleted.map((clip) => clip.timelineStartUs + clip.durationUs))
      const moved = document.clips
        .filter((clip) => !ids.has(clip.id) && clip.trackID === trackID && clip.timelineStartUs >= earliestEndUs)
        .map((clip) => ({ clipID: clip.id, trackID: clip.trackID, timelineStartUs: clip.timelineStartUs }))
      return {
        undo: [
          ...(moved.length > 0 ? [{ type: "move-clips" as const, placements: moved }] : []),
          { type: "add-clips", clips: deleted },
        ],
        redo,
      }
    }
    case "update-clip": {
      const clip = document.clips.find((candidate) => candidate.id === command.clipID)
      if (!clip) return null
      const patch: Record<string, unknown> = {}
      for (const key of Object.keys(command.patch) as Array<keyof typeof command.patch>) {
        if (key === "fit") patch.fit = "fit" in clip ? clip.fit ?? null : null
        else if (key === "transform") patch.transform = "transform" in clip ? clip.transform ?? null : null
        else if (key === "fadeInUs" && clip.kind === "audio") patch.fadeInUs = clip.fadeInUs ?? null
        else if (key === "fadeOutUs" && clip.kind === "audio") patch.fadeOutUs = clip.fadeOutUs ?? null
        else if (key === "cueText") patch.cueText = clip.kind === "subtitle" ? clip.cueText : undefined
        else if (key === "speaker") patch.speaker = clip.kind === "subtitle" ? clip.speaker ?? null : null
        else patch[key] = clip[key as keyof typeof clip]
      }
      return { undo: [{ type: "update-clip", clipID: clip.id, patch: patch as typeof command.patch }], redo }
    }
    case "update-clips": {
      const clips = new Map(document.clips.map((clip) => [clip.id, clip]))
      const updates = command.updates.flatMap((update) => {
        const clip = clips.get(update.clipID)
        if (!clip) return []
        const patch: Record<string, unknown> = {}
        for (const key of Object.keys(update.patch) as Array<keyof typeof update.patch>) {
          if (key === "fit") patch.fit = "fit" in clip ? clip.fit ?? null : null
          else if (key === "transform") patch.transform = "transform" in clip ? clip.transform ?? null : null
          else if (key === "fadeInUs" && clip.kind === "audio") patch.fadeInUs = clip.fadeInUs ?? null
          else if (key === "fadeOutUs" && clip.kind === "audio") patch.fadeOutUs = clip.fadeOutUs ?? null
          else if (key === "cueText") patch.cueText = clip.kind === "subtitle" ? clip.cueText : undefined
          else if (key === "speaker") patch.speaker = clip.kind === "subtitle" ? clip.speaker ?? null : null
          else patch[key] = clip[key as keyof typeof clip]
        }
        return [{ clipID: clip.id, patch: patch as typeof update.patch }]
      })
      return updates.length === command.updates.length
        ? { undo: [{ type: "update-clips", updates }], redo }
        : null
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
      for (const key of Object.keys(command.patch) as Array<keyof typeof command.patch>) {
        if (key in track) patch[key] = track[key as keyof typeof track]
      }
      return { undo: [{ type: "update-track", trackID: track.id, patch: patch as typeof command.patch }], redo }
    }
    case "delete-track": {
      const track = document.tracks.find((candidate) => candidate.id === command.trackID)
      if (!track) return null
      const clips = document.clips.filter((clip) => clip.trackID === track.id)
      return {
        undo: [
          { type: "create-track", track },
          ...(clips.length > 0 ? [{ type: "add-clips" as const, clips }] : []),
        ],
        redo,
      }
    }
    case "reorder-tracks":
      return {
        undo: [{
          type: "reorder-tracks",
          trackIDs: [...document.tracks]
            .sort((left, right) => left.order - right.order)
            .map((track) => track.id),
        }],
        redo,
      }
    case "update-settings": {
      const patch: Record<string, unknown> = {}
      for (const key of Object.keys(command.patch) as Array<keyof typeof command.patch>) patch[key] = document.settings[key]
      return { undo: [{ type: "update-settings", patch: patch as typeof command.patch }], redo }
    }
    case "create-track":
      return { undo: [{ type: "delete-track", trackID: command.track.id, deleteClips: false }], redo }
  }
}
