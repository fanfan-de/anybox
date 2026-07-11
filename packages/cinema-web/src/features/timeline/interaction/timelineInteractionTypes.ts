import type { CinemaTimelineTrackKind } from "@anybox/shared/cinema-timeline"

export type TimelineClipPlacement = {
  clipID: string
  trackID: string
  timelineStartUs: number
}

export type TimelineMovingClip = TimelineClipPlacement & {
  durationUs: number
}

export type TimelineMoveTarget = {
  trackID: string
  trackKind: CinemaTimelineTrackKind
  locked: boolean
  laneLeft: number
}

export type TimelineTrimDraft = {
  timelineStartUs: number
  durationUs: number
  sourceInUs: number
  sourceDurationUs: number
}

export type TimelinePoint = {
  x: number
  y: number
}

export type TimelinePointerInteraction =
  | { type: "idle" }
  | {
      type: "moving-clip"
      pointerID: number
      originClientX: number
      grabOffsetUs: number
      activeClipID: string
      groupStartUs: number
      groupDurationUs: number
      snapCandidates: readonly number[]
      originalClips: readonly TimelineMovingClip[]
      draftClips: readonly TimelineClipPlacement[]
      validTarget: boolean
      snapGuideUs: number | null
      snappedEdge: "start" | "end" | null
    }
  | {
      type: "trimming-clip"
      pointerID: number
      edge: "start" | "end"
      clipID: string
      originClientX: number
      sourceRatio: number
      minimumDeltaUs: number
      maximumDeltaUs: number
      snapCandidates: readonly number[]
      originalClip: TimelineTrimDraft
      draft: TimelineTrimDraft
      snapGuideUs: number | null
    }
  | {
      type: "scrubbing-playhead"
      pointerID: number
      originalPlayheadUs: number
      draftPlayheadUs: number
    }
  | {
      type: "marquee-selecting"
      pointerID: number
      origin: TimelinePoint
      current: TimelinePoint
      originalSelectedClipIDs: readonly string[]
      draftSelectedClipIDs: readonly string[]
    }

export const IDLE_TIMELINE_POINTER_INTERACTION: TimelinePointerInteraction = { type: "idle" }
