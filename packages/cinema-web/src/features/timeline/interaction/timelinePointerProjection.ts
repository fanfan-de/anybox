import { timelinePixelsToTime } from "../model/timelineTime"
import { snapTimelineClipEdges } from "../model/timelineSnap"
import {
  IDLE_TIMELINE_POINTER_INTERACTION,
  type TimelineClipPlacement,
  type TimelineMovingClip,
  type TimelinePointerInteraction,
} from "./timelineInteractionTypes"

export function timelineClipGrabOffsetUs(
  clientX: number,
  clipLeft: number,
  clipDurationUs: number,
  pixelsPerSecond: number,
) {
  return Math.min(
    Math.max(0, clipDurationUs),
    timelinePixelsToTime(Math.max(0, clientX - clipLeft), pixelsPerSecond),
  )
}

export function projectTimelineClipMove(
  clientX: number,
  laneLeft: number,
  grabOffsetUs: number,
  pixelsPerSecond: number,
) {
  const pointerTimeUs = timelinePixelsToTime(Math.max(0, clientX - laneLeft), pixelsPerSecond)
  return Math.max(0, pointerTimeUs - Math.max(0, grabOffsetUs))
}

export function beginTimelineClipMove(input: {
  pointerID: number
  clientX: number
  clipLeft: number
  pixelsPerSecond: number
  snapCandidates: readonly number[]
  activeClipID: string
  clips: readonly TimelineMovingClip[]
}): TimelinePointerInteraction {
  const activeClip = input.clips.find((clip) => clip.clipID === input.activeClipID)
  if (!activeClip || input.clips.length === 0) return IDLE_TIMELINE_POINTER_INTERACTION
  const groupStartUs = Math.min(...input.clips.map((clip) => clip.timelineStartUs))
  const groupEndUs = Math.max(...input.clips.map((clip) => clip.timelineStartUs + clip.durationUs))
  return {
    type: "moving-clip",
    pointerID: input.pointerID,
    originClientX: input.clientX,
    grabOffsetUs: timelineClipGrabOffsetUs(
      input.clientX,
      input.clipLeft,
      activeClip.durationUs,
      input.pixelsPerSecond,
    ),
    activeClipID: input.activeClipID,
    groupStartUs,
    groupDurationUs: groupEndUs - groupStartUs,
    snapCandidates: input.snapCandidates,
    originalClips: input.clips.map((clip) => ({ ...clip })),
    draftClips: input.clips.map(({ durationUs: _durationUs, ...clip }) => clip),
    validTarget: true,
    snapGuideUs: null,
    snappedEdge: null,
  }
}

export function updateTimelineClipMove(
  interaction: TimelinePointerInteraction,
  input: {
    clientX: number
    laneLeft: number
    targetTrackID: string
    targetTrackIDs?: Readonly<Record<string, string>>
    pixelsPerSecond: number
    validTarget: boolean
  },
): TimelinePointerInteraction {
  if (interaction.type !== "moving-clip") return interaction
  const activeClip = interaction.originalClips.find((clip) => clip.clipID === interaction.activeClipID)
  if (!activeClip) return invalidateTimelineClipMove(interaction)
  const pointerTimeUs = timelinePixelsToTime(Math.max(0, input.clientX - input.laneLeft), input.pixelsPerSecond)
  const rawDeltaUs = Math.max(
    -interaction.groupStartUs,
    pointerTimeUs - interaction.grabOffsetUs - activeClip.timelineStartUs,
  )
  const proposedGroupStartUs = interaction.groupStartUs + rawDeltaUs
  const snapped = input.validTarget
    ? snapTimelineClipEdges(
        proposedGroupStartUs,
        interaction.groupDurationUs,
        interaction.snapCandidates,
        input.pixelsPerSecond,
      )
    : { timelineStartUs: proposedGroupStartUs, snapGuideUs: null, snappedEdge: null }
  const deltaUs = snapped.timelineStartUs - interaction.groupStartUs
  return {
    ...interaction,
    draftClips: interaction.originalClips.map((clip) => ({
      clipID: clip.clipID,
      trackID: input.targetTrackIDs?.[clip.clipID] ?? (clip.clipID === interaction.activeClipID ? input.targetTrackID : clip.trackID),
      timelineStartUs: clip.timelineStartUs + deltaUs,
    })),
    validTarget: input.validTarget,
    snapGuideUs: snapped.snapGuideUs,
    snappedEdge: snapped.snappedEdge,
  }
}

export function invalidateTimelineClipMove(
  interaction: TimelinePointerInteraction,
): TimelinePointerInteraction {
  return interaction.type === "moving-clip"
    ? { ...interaction, validTarget: false, snapGuideUs: null, snappedEdge: null }
    : interaction
}

export function committedTimelineClipMove(
  interaction: TimelinePointerInteraction,
) {
  if (interaction.type !== "moving-clip" || !interaction.validTarget) return null
  const originalByID = new Map(interaction.originalClips.map((clip) => [clip.clipID, clip]))
  const changed = interaction.draftClips.some((draft) => {
    const original = originalByID.get(draft.clipID)
    return original?.trackID !== draft.trackID || original.timelineStartUs !== draft.timelineStartUs
  })
  return changed ? interaction.draftClips : null
}

export function cancelTimelinePointerInteraction(): TimelinePointerInteraction {
  return IDLE_TIMELINE_POINTER_INTERACTION
}
