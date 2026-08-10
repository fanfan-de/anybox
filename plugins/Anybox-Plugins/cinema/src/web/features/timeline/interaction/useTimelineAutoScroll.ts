import { useCallback, useEffect, useRef, type RefObject } from "react"
import {
  timelineAutoScrollLeft,
  timelineAutoScrollVelocity,
} from "./timelineAutoScroll"

type TimelineAutoScrollPointer = {
  pointerID: number
  clientX: number
  clientY: number
}

export function useTimelineAutoScroll({
  scrollRef,
  active,
  leftInset = 0,
  onScrollFrame,
}: {
  scrollRef: RefObject<HTMLElement | null>
  active: boolean
  leftInset?: number
  onScrollFrame: (pointer: TimelineAutoScrollPointer) => void
}) {
  const pointerRef = useRef<TimelineAutoScrollPointer | null>(null)
  const frameRef = useRef<number | null>(null)
  const onScrollFrameRef = useRef(onScrollFrame)
  onScrollFrameRef.current = onScrollFrame

  const stop = useCallback(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
    frameRef.current = null
    pointerRef.current = null
  }, [])

  const updatePointer = useCallback((pointer: TimelineAutoScrollPointer) => {
    pointerRef.current = pointer
  }, [])

  useEffect(() => {
    if (!active) {
      stop()
      return
    }
    const tick = () => {
      const element = scrollRef.current
      const pointer = pointerRef.current
      if (element && pointer) {
        const rect = element.getBoundingClientRect()
        const velocity = timelineAutoScrollVelocity(
          pointer.clientX,
          rect.left + leftInset,
          rect.right,
        )
        const nextScrollLeft = timelineAutoScrollLeft(
          element.scrollLeft,
          velocity,
          element.scrollWidth,
          element.clientWidth,
        )
        if (nextScrollLeft !== element.scrollLeft) {
          element.scrollLeft = nextScrollLeft
          onScrollFrameRef.current(pointer)
        }
      }
      frameRef.current = requestAnimationFrame(tick)
    }
    frameRef.current = requestAnimationFrame(tick)
    return stop
  }, [active, leftInset, scrollRef, stop])

  return { updatePointer, stop }
}

