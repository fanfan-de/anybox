import {
  CinemaTimelineClipSchema,
  CinemaTimelineDocumentSchema,
  isCinemaTimelineClipCompatibleWithTrack,
  type CinemaTimelineClip,
  type CinemaTimelineDocument,
  type CinemaTimelineTrackKind,
} from "@anybox/cinema-plugin/contracts/timeline"
import { orderedTimelineClipIDs } from "./timelineSelection"

export type TimelineClipboardTrack = {
  id: string
  kind: CinemaTimelineTrackKind
  order: number
}

export type TimelineClipboard = {
  projectID: string
  originStartUs: number
  durationUs: number
  tracks: TimelineClipboardTrack[]
  clips: CinemaTimelineClip[]
}

export type TimelineClipboardPaste = {
  clips: CinemaTimelineClip[]
  selectedClipIDs: string[]
}

export class TimelineClipboardError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "TimelineClipboardError"
  }
}

export function copyTimelineClips(
  document: CinemaTimelineDocument,
  selectedClipIDs: readonly string[],
): TimelineClipboard | null {
  const clipsByID = new Map(document.clips.map((clip) => [clip.id, clip]))
  const clips = orderedTimelineClipIDs(selectedClipIDs).flatMap((clipID) => {
    const clip = clipsByID.get(clipID)
    return clip ? [CinemaTimelineClipSchema.parse(clip)] : []
  })
  if (clips.length === 0) return null
  const selectedTrackIDs = new Set(clips.map((clip) => clip.trackID))
  const originStartUs = Math.min(...clips.map((clip) => clip.timelineStartUs))
  const endUs = Math.max(...clips.map((clip) => clip.timelineStartUs + clip.durationUs))
  return {
    projectID: document.projectID,
    originStartUs,
    durationUs: endUs - originStartUs,
    tracks: [...document.tracks]
      .sort((left, right) => left.order - right.order)
      .filter((track) => selectedTrackIDs.has(track.id))
      .map((track) => ({ id: track.id, kind: track.kind, order: track.order })),
    clips,
  }
}

function mapClipboardTracks(
  clipboard: TimelineClipboard,
  document: CinemaTimelineDocument,
) {
  const targetTracks = [...document.tracks].sort((left, right) => left.order - right.order)
  const usedTargetIDs = new Set<string>()
  const trackIDs = new Map<string, string>()
  for (const sourceTrack of [...clipboard.tracks].sort((left, right) => left.order - right.order)) {
    const sameTrack = targetTracks.find((track) => (
      track.id === sourceTrack.id
      && track.kind === sourceTrack.kind
      && !track.locked
      && !usedTargetIDs.has(track.id)
    ))
    const targetTrack = sameTrack ?? targetTracks
      .filter((track) => track.kind === sourceTrack.kind && !track.locked && !usedTargetIDs.has(track.id))
      .sort((left, right) => (
        Math.abs(left.order - sourceTrack.order) - Math.abs(right.order - sourceTrack.order)
        || left.order - right.order
      ))[0]
    if (!targetTrack) {
      throw new TimelineClipboardError(`No unlocked ${sourceTrack.kind} track is available for the pasted clips.`)
    }
    usedTargetIDs.add(targetTrack.id)
    trackIDs.set(sourceTrack.id, targetTrack.id)
  }
  return trackIDs
}

export function pasteTimelineClipboard(
  clipboard: TimelineClipboard,
  document: CinemaTimelineDocument,
  insertionTimeUs: number,
  createClipID: () => string,
  timestamp = new Date().toISOString(),
): TimelineClipboardPaste {
  if (clipboard.projectID !== document.projectID) {
    throw new TimelineClipboardError("Timeline clipboard clips belong to another project.")
  }
  const targetTrackIDs = mapClipboardTracks(clipboard, document)
  const existingIDs = new Set(document.clips.map((clip) => clip.id))
  const generatedIDs = new Set<string>()
  const insertionUs = Math.max(0, Math.round(insertionTimeUs))
  const clips = clipboard.clips.map((sourceClip) => {
    const id = createClipID()
    const trackID = targetTrackIDs.get(sourceClip.trackID)
    if (!id || existingIDs.has(id) || generatedIDs.has(id)) {
      throw new TimelineClipboardError("Paste must generate a unique Clip ID for every copied clip.")
    }
    if (!trackID) throw new TimelineClipboardError(`Clipboard track '${sourceClip.trackID}' could not be mapped.`)
    const targetTrack = document.tracks.find((track) => track.id === trackID)
    if (!targetTrack || !isCinemaTimelineClipCompatibleWithTrack(targetTrack.kind, sourceClip.kind)) {
      throw new TimelineClipboardError(`${sourceClip.kind} clips cannot be pasted onto '${trackID}'.`)
    }
    generatedIDs.add(id)
    return CinemaTimelineClipSchema.parse({
      ...sourceClip,
      id,
      trackID,
      timelineStartUs: insertionUs + sourceClip.timelineStartUs - clipboard.originStartUs,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
  })
  const result = CinemaTimelineDocumentSchema.safeParse({
    ...document,
    clips: [...document.clips, ...clips],
  })
  if (!result.success) {
    throw new TimelineClipboardError(result.error.issues[0]?.message ?? "Pasted clips would make the Timeline invalid.")
  }
  return { clips, selectedClipIDs: clips.map((clip) => clip.id) }
}

export function duplicateTimelineClips(
  document: CinemaTimelineDocument,
  selectedClipIDs: readonly string[],
  createClipID: () => string,
  timestamp = new Date().toISOString(),
) {
  const clipboard = copyTimelineClips(document, selectedClipIDs)
  if (!clipboard) return null
  return pasteTimelineClipboard(
    clipboard,
    document,
    clipboard.originStartUs + clipboard.durationUs,
    createClipID,
    timestamp,
  )
}
