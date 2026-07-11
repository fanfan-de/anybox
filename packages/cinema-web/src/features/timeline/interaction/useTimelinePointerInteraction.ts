import { useCallback, useEffect, useRef, useState } from "react"
import {
  IDLE_TIMELINE_POINTER_INTERACTION,
  type TimelineClipPlacement,
  type TimelineMovingClip,
  type TimelineMoveTarget,
  type TimelinePointerInteraction,
  type TimelineTrimDraft,
} from "./timelineInteractionTypes"
import {
  beginTimelineClipMove,
  committedTimelineClipMove,
  invalidateTimelineClipMove,
  updateTimelineClipMove,
} from "./timelinePointerProjection"
import {
  beginTimelineTrim,
  committedTimelineTrim,
  updateTimelineTrim,
} from "./timelineTrimProjection"
import {
  beginTimelinePlayheadScrub,
  updateTimelinePlayheadScrub,
} from "./timelineScrubProjection"
import {
  timelineMarqueeSelectedClipIDs,
  type TimelineSelectionRect,
} from "../model/timelineSelection"

export function useTimelinePointerInteraction({
  pixelsPerSecond,
  onCommitMove,
  onCommitTrim,
  onScrubPlayhead,
  onSelectionChange,
}: {
  pixelsPerSecond: number
  onCommitMove: (placements: readonly TimelineClipPlacement[]) => void
  onCommitTrim: (clipID: string, draft: TimelineTrimDraft) => void
  onScrubPlayhead: (playheadUs: number) => void
  onSelectionChange: (clipIDs: string[]) => void
}) {
  const [interaction, setInteraction] = useState<TimelinePointerInteraction>(IDLE_TIMELINE_POINTER_INTERACTION)
  const interactionRef = useRef<TimelinePointerInteraction>(IDLE_TIMELINE_POINTER_INTERACTION)
  const captureTargetRef = useRef<HTMLElement | null>(null)
  const onCommitMoveRef = useRef(onCommitMove)
  const onCommitTrimRef = useRef(onCommitTrim)
  const onScrubPlayheadRef = useRef(onScrubPlayhead)
  const onSelectionChangeRef = useRef(onSelectionChange)
  onCommitMoveRef.current = onCommitMove
  onCommitTrimRef.current = onCommitTrim
  onScrubPlayheadRef.current = onScrubPlayhead
  onSelectionChangeRef.current = onSelectionChange

  const setCurrentInteraction = useCallback((next: TimelinePointerInteraction) => {
    interactionRef.current = next
    setInteraction(next)
  }, [])

  const releasePointerCapture = useCallback((pointerID: number) => {
    const target = captureTargetRef.current
    captureTargetRef.current = null
    if (target?.hasPointerCapture(pointerID)) target.releasePointerCapture(pointerID)
  }, [])

  const cancel = useCallback((pointerID?: number) => {
    const current = interactionRef.current
    if (current.type === "idle" || (pointerID !== undefined && current.pointerID !== pointerID)) return false
    if (current.type === "scrubbing-playhead") {
      onScrubPlayheadRef.current(current.originalPlayheadUs)
    } else if (current.type === "marquee-selecting") {
      onSelectionChangeRef.current([...current.originalSelectedClipIDs])
    }
    interactionRef.current = IDLE_TIMELINE_POINTER_INTERACTION
    setInteraction(IDLE_TIMELINE_POINTER_INTERACTION)
    releasePointerCapture(current.pointerID)
    return true
  }, [releasePointerCapture])

  const beginClipMove = useCallback((input: {
    pointerID: number
    clientX: number
    clipLeft: number
    snapCandidates: readonly number[]
    activeClipID: string
    clips: readonly TimelineMovingClip[]
    captureTarget: HTMLElement
  }) => {
    if (interactionRef.current.type !== "idle") cancel()
    input.captureTarget.setPointerCapture(input.pointerID)
    captureTargetRef.current = input.captureTarget
    setCurrentInteraction(beginTimelineClipMove({
      ...input,
      pixelsPerSecond,
    }))
  }, [cancel, pixelsPerSecond, setCurrentInteraction])

  const updateClipMove = useCallback((input: {
    pointerID: number
    clientX: number
    target: TimelineMoveTarget | null
    targetTrackIDs?: Readonly<Record<string, string>>
    validTarget?: boolean
  }) => {
    const current = interactionRef.current
    if (current.type !== "moving-clip" || current.pointerID !== input.pointerID) return
    if (!input.target) {
      setCurrentInteraction(invalidateTimelineClipMove(current))
      return
    }
    const validTarget = input.validTarget ?? !input.target.locked
    setCurrentInteraction(updateTimelineClipMove(current, {
      clientX: input.clientX,
      laneLeft: input.target.laneLeft,
      targetTrackID: input.target.trackID,
      targetTrackIDs: input.targetTrackIDs,
      pixelsPerSecond,
      validTarget,
    }))
  }, [pixelsPerSecond, setCurrentInteraction])

  const commitClipMove = useCallback((pointerID: number) => {
    const current = interactionRef.current
    if (current.type !== "moving-clip" || current.pointerID !== pointerID) return false
    const placements = committedTimelineClipMove(current)
    interactionRef.current = IDLE_TIMELINE_POINTER_INTERACTION
    setInteraction(IDLE_TIMELINE_POINTER_INTERACTION)
    releasePointerCapture(pointerID)
    if (placements) onCommitMoveRef.current(placements)
    return placements !== null
  }, [releasePointerCapture])

  const beginTrim = useCallback((input: {
    pointerID: number
    clientX: number
    clipID: string
    edge: "start" | "end"
    originalClip: TimelineTrimDraft
    minimumDurationUs: number
    assetDurationUs: number | null
    snapCandidates: readonly number[]
    captureTarget: HTMLElement
  }) => {
    if (interactionRef.current.type !== "idle") cancel()
    input.captureTarget.setPointerCapture(input.pointerID)
    captureTargetRef.current = input.captureTarget
    setCurrentInteraction(beginTimelineTrim(input))
  }, [cancel, setCurrentInteraction])

  const updateTrim = useCallback((input: {
    pointerID: number
    clientX: number
  }) => {
    const current = interactionRef.current
    if (current.type !== "trimming-clip" || current.pointerID !== input.pointerID) return
    setCurrentInteraction(updateTimelineTrim(current, input.clientX, pixelsPerSecond))
  }, [pixelsPerSecond, setCurrentInteraction])

  const commitTrim = useCallback((pointerID: number) => {
    const current = interactionRef.current
    if (current.type !== "trimming-clip" || current.pointerID !== pointerID) return false
    const committed = committedTimelineTrim(current)
    interactionRef.current = IDLE_TIMELINE_POINTER_INTERACTION
    setInteraction(IDLE_TIMELINE_POINTER_INTERACTION)
    releasePointerCapture(pointerID)
    if (committed) onCommitTrimRef.current(committed.clipID, committed.draft)
    return committed !== null
  }, [releasePointerCapture])

  const beginScrub = useCallback((input: {
    pointerID: number
    clientX: number
    rulerLeft: number
    originalPlayheadUs: number
    captureTarget: HTMLElement
  }) => {
    if (interactionRef.current.type !== "idle") cancel()
    input.captureTarget.setPointerCapture(input.pointerID)
    captureTargetRef.current = input.captureTarget
    const next = beginTimelinePlayheadScrub({ ...input, pixelsPerSecond })
    setCurrentInteraction(next)
    if (next.type === "scrubbing-playhead") onScrubPlayheadRef.current(next.draftPlayheadUs)
  }, [cancel, pixelsPerSecond, setCurrentInteraction])

  const updateScrub = useCallback((input: {
    pointerID: number
    clientX: number
    rulerLeft: number
  }) => {
    const current = interactionRef.current
    if (current.type !== "scrubbing-playhead" || current.pointerID !== input.pointerID) return
    const next = updateTimelinePlayheadScrub(
      current,
      input.clientX,
      input.rulerLeft,
      pixelsPerSecond,
    )
    setCurrentInteraction(next)
    if (next.type === "scrubbing-playhead") onScrubPlayheadRef.current(next.draftPlayheadUs)
  }, [pixelsPerSecond, setCurrentInteraction])

  const commitScrub = useCallback((pointerID: number) => {
    const current = interactionRef.current
    if (current.type !== "scrubbing-playhead" || current.pointerID !== pointerID) return false
    interactionRef.current = IDLE_TIMELINE_POINTER_INTERACTION
    setInteraction(IDLE_TIMELINE_POINTER_INTERACTION)
    releasePointerCapture(pointerID)
    return true
  }, [releasePointerCapture])

  const beginMarquee = useCallback((input: {
    pointerID: number
    origin: { x: number; y: number }
    originalSelectedClipIDs: readonly string[]
    captureTarget: HTMLElement
  }) => {
    if (interactionRef.current.type !== "idle") cancel()
    input.captureTarget.setPointerCapture(input.pointerID)
    captureTargetRef.current = input.captureTarget
    setCurrentInteraction({
      type: "marquee-selecting",
      pointerID: input.pointerID,
      origin: input.origin,
      current: input.origin,
      originalSelectedClipIDs: [...input.originalSelectedClipIDs],
      draftSelectedClipIDs: [],
    })
    onSelectionChangeRef.current([])
  }, [cancel, setCurrentInteraction])

  const updateMarquee = useCallback((input: {
    pointerID: number
    current: { x: number; y: number }
    clipRects: readonly TimelineSelectionRect[]
  }) => {
    const interaction = interactionRef.current
    if (interaction.type !== "marquee-selecting" || interaction.pointerID !== input.pointerID) return
    const draftSelectedClipIDs = timelineMarqueeSelectedClipIDs(
      input.clipRects,
      interaction.origin,
      input.current,
    )
    setCurrentInteraction({
      ...interaction,
      current: input.current,
      draftSelectedClipIDs,
    })
    onSelectionChangeRef.current(draftSelectedClipIDs)
  }, [setCurrentInteraction])

  const commitMarquee = useCallback((pointerID: number) => {
    const current = interactionRef.current
    if (current.type !== "marquee-selecting" || current.pointerID !== pointerID) return false
    interactionRef.current = IDLE_TIMELINE_POINTER_INTERACTION
    setInteraction(IDLE_TIMELINE_POINTER_INTERACTION)
    releasePointerCapture(pointerID)
    return true
  }, [releasePointerCapture])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || interactionRef.current.type === "idle") return
      event.preventDefault()
      event.stopImmediatePropagation()
      cancel()
    }
    const onWindowBlur = () => cancel()
    window.addEventListener("keydown", onKeyDown, true)
    window.addEventListener("blur", onWindowBlur)
    return () => {
      window.removeEventListener("keydown", onKeyDown, true)
      window.removeEventListener("blur", onWindowBlur)
      const current = interactionRef.current
      interactionRef.current = IDLE_TIMELINE_POINTER_INTERACTION
      if (current.type !== "idle") {
        if (current.type === "scrubbing-playhead") {
          onScrubPlayheadRef.current(current.originalPlayheadUs)
        } else if (current.type === "marquee-selecting") {
          onSelectionChangeRef.current([...current.originalSelectedClipIDs])
        }
        releasePointerCapture(current.pointerID)
      }
    }
  }, [cancel, releasePointerCapture])

  return {
    interaction,
    beginClipMove,
    updateClipMove,
    commitClipMove,
    beginTrim,
    updateTrim,
    commitTrim,
    beginScrub,
    updateScrub,
    commitScrub,
    beginMarquee,
    updateMarquee,
    commitMarquee,
    cancel,
  }
}
