import { timelinePixelsToTime } from "../model/timelineTime"
import type { TimelinePointerInteraction } from "./timelineInteractionTypes"

export function projectTimelinePlayhead(
  clientX: number,
  rulerLeft: number,
  pixelsPerSecond: number,
) {
  return timelinePixelsToTime(Math.max(0, clientX - rulerLeft), pixelsPerSecond)
}

export function beginTimelinePlayheadScrub(input: {
  pointerID: number
  clientX: number
  rulerLeft: number
  pixelsPerSecond: number
  originalPlayheadUs: number
}): TimelinePointerInteraction {
  return {
    type: "scrubbing-playhead",
    pointerID: input.pointerID,
    originalPlayheadUs: input.originalPlayheadUs,
    draftPlayheadUs: projectTimelinePlayhead(
      input.clientX,
      input.rulerLeft,
      input.pixelsPerSecond,
    ),
  }
}

export function updateTimelinePlayheadScrub(
  interaction: TimelinePointerInteraction,
  clientX: number,
  rulerLeft: number,
  pixelsPerSecond: number,
): TimelinePointerInteraction {
  return interaction.type === "scrubbing-playhead" ? {
    ...interaction,
    draftPlayheadUs: projectTimelinePlayhead(clientX, rulerLeft, pixelsPerSecond),
  } : interaction
}

