import {
  type TimelinePointerInteraction,
  type TimelineTrimDraft,
} from "./timelineInteractionTypes"
import { snapTimelineTime } from "../model/timelineSnap"

function pointerDeltaUs(
  clientX: number,
  originClientX: number,
  pixelsPerSecond: number,
) {
  return Math.round((clientX - originClientX) / pixelsPerSecond * 1_000_000)
}

export function beginTimelineTrim(input: {
  pointerID: number
  clientX: number
  clipID: string
  edge: "start" | "end"
  originalClip: TimelineTrimDraft
  minimumDurationUs: number
  assetDurationUs: number | null
  snapCandidates: readonly number[]
}): TimelinePointerInteraction {
  const sourceRatio = input.originalClip.sourceDurationUs / input.originalClip.durationUs
  const minimumDeltaUs = input.edge === "start"
    ? -Math.round(input.originalClip.sourceInUs / Math.max(sourceRatio, Number.EPSILON))
    : -input.originalClip.durationUs + input.minimumDurationUs
  const maximumDeltaUs = input.edge === "start"
    ? input.originalClip.durationUs - input.minimumDurationUs
    : input.assetDurationUs === null
      ? Number.MAX_SAFE_INTEGER
      : Math.round((
          input.assetDurationUs
          - input.originalClip.sourceInUs
          - input.originalClip.sourceDurationUs
        ) / Math.max(sourceRatio, Number.EPSILON))
  return {
    type: "trimming-clip",
    pointerID: input.pointerID,
    edge: input.edge,
    clipID: input.clipID,
    originClientX: input.clientX,
    sourceRatio,
    minimumDeltaUs,
    maximumDeltaUs,
    snapCandidates: input.snapCandidates,
    originalClip: input.originalClip,
    draft: input.originalClip,
    snapGuideUs: null,
  }
}

export function updateTimelineTrim(
  interaction: TimelinePointerInteraction,
  clientX: number,
  pixelsPerSecond: number,
): TimelinePointerInteraction {
  if (interaction.type !== "trimming-clip") return interaction
  const rawDeltaUs = pointerDeltaUs(clientX, interaction.originClientX, pixelsPerSecond)
  const constrainedDeltaUs = Math.max(
    interaction.minimumDeltaUs,
    Math.min(interaction.maximumDeltaUs, rawDeltaUs),
  )
  const originalEdgeUs = interaction.edge === "start"
    ? interaction.originalClip.timelineStartUs
    : interaction.originalClip.timelineStartUs + interaction.originalClip.durationUs
  const proposedEdgeUs = originalEdgeUs + constrainedDeltaUs
  const snapped = snapTimelineTime(
    proposedEdgeUs,
    interaction.snapCandidates,
    pixelsPerSecond,
  )
  const snappedDeltaUs = snapped.timeUs - originalEdgeUs
  const deltaUs = snapped.snapped
    && snappedDeltaUs >= interaction.minimumDeltaUs
    && snappedDeltaUs <= interaction.maximumDeltaUs
    ? snappedDeltaUs
    : constrainedDeltaUs
  const snapGuideUs = snapped.snapped && deltaUs === snappedDeltaUs ? snapped.timeUs : null
  const sourceDeltaUs = Math.round(deltaUs * interaction.sourceRatio)
  const original = interaction.originalClip
  const draft = interaction.edge === "start" ? {
    timelineStartUs: original.timelineStartUs + deltaUs,
    durationUs: original.durationUs - deltaUs,
    sourceInUs: original.sourceInUs + sourceDeltaUs,
    sourceDurationUs: original.sourceDurationUs - sourceDeltaUs,
  } : {
    timelineStartUs: original.timelineStartUs,
    durationUs: original.durationUs + deltaUs,
    sourceInUs: original.sourceInUs,
    sourceDurationUs: original.sourceDurationUs + sourceDeltaUs,
  }
  return { ...interaction, draft, snapGuideUs }
}

export function committedTimelineTrim(
  interaction: TimelinePointerInteraction,
) {
  if (interaction.type !== "trimming-clip") return null
  const original = interaction.originalClip
  const draft = interaction.draft
  if (
    original.timelineStartUs === draft.timelineStartUs
    && original.durationUs === draft.durationUs
    && original.sourceInUs === draft.sourceInUs
    && original.sourceDurationUs === draft.sourceDurationUs
  ) return null
  return { clipID: interaction.clipID, draft }
}
