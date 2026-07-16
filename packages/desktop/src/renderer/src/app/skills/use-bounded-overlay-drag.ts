import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react"

interface OverlayOffset {
  x: number
  y: number
}

interface OverlayDragBounds {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

interface OverlayDragState {
  dragTarget: HTMLElement
  pointerID: number
  startClientX: number
  startClientY: number
  startOffset: OverlayOffset
}

export interface UseBoundedOverlayDragOptions {
  boundaryMargin?: number
  open: boolean
}

export interface BoundedOverlayDragState {
  isDragging: boolean
  offset: OverlayOffset
  onDragHandlePointerDown: (event: ReactPointerEvent<HTMLElement>) => void
  overlayRef: RefObject<HTMLDivElement | null>
  positionerRef: RefObject<HTMLDivElement | null>
}

const DEFAULT_BOUNDARY_MARGIN = 12
const INITIAL_OFFSET: OverlayOffset = { x: 0, y: 0 }
const INTERACTIVE_DRAG_TARGET_SELECTOR = [
  "button",
  "a[href]",
  "input",
  "select",
  "textarea",
  "summary",
  "[contenteditable='true']",
  "[role='button']",
  "[role='checkbox']",
  "[role='link']",
  "[role='switch']",
  "[data-overlay-drag-ignore]",
].join(",")

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum)
}

function resolveDragBounds(
  overlayRect: DOMRect,
  positionerRect: DOMRect,
  currentOffset: OverlayOffset,
  boundaryMargin: number,
): OverlayDragBounds {
  const leftLimit = currentOffset.x + overlayRect.left + boundaryMargin - positionerRect.left
  const rightLimit = currentOffset.x + overlayRect.right - boundaryMargin - positionerRect.right
  const topLimit = currentOffset.y + overlayRect.top + boundaryMargin - positionerRect.top
  const bottomLimit = currentOffset.y + overlayRect.bottom - boundaryMargin - positionerRect.bottom

  return {
    minX: Math.min(leftLimit, rightLimit),
    maxX: Math.max(leftLimit, rightLimit),
    minY: Math.min(topLimit, bottomLimit),
    maxY: Math.max(topLimit, bottomLimit),
  }
}

function clampOffset(offset: OverlayOffset, bounds: OverlayDragBounds): OverlayOffset {
  return {
    x: clamp(offset.x, bounds.minX, bounds.maxX),
    y: clamp(offset.y, bounds.minY, bounds.maxY),
  }
}

function isInteractiveDragTarget(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest(INTERACTIVE_DRAG_TARGET_SELECTOR))
}

export function useBoundedOverlayDrag({
  boundaryMargin = DEFAULT_BOUNDARY_MARGIN,
  open,
}: UseBoundedOverlayDragOptions): BoundedOverlayDragState {
  const overlayRef = useRef<HTMLDivElement | null>(null)
  const positionerRef = useRef<HTMLDivElement | null>(null)
  const dragStateRef = useRef<OverlayDragState | null>(null)
  const offsetRef = useRef<OverlayOffset>(INITIAL_OFFSET)
  const [offset, setOffset] = useState<OverlayOffset>(INITIAL_OFFSET)
  const [isDragging, setIsDragging] = useState(false)

  const updateOffset = useCallback((nextOffset: OverlayOffset) => {
    offsetRef.current = nextOffset
    setOffset((currentOffset) =>
      currentOffset.x === nextOffset.x && currentOffset.y === nextOffset.y
        ? currentOffset
        : nextOffset,
    )
  }, [])

  const stopDragging = useCallback((pointerID?: number) => {
    const dragState = dragStateRef.current
    if (dragState && typeof pointerID === "number" && pointerID !== dragState.pointerID) return

    if (dragState) {
      const capturedPointerID = dragState.pointerID
      try {
        if (
          typeof dragState.dragTarget.hasPointerCapture === "function" &&
          dragState.dragTarget.hasPointerCapture(capturedPointerID)
        ) {
          dragState.dragTarget.releasePointerCapture(capturedPointerID)
        }
      } catch {
        // The browser may already have released capture after the pointer left the window.
      }
    }

    dragStateRef.current = null
    setIsDragging(false)
  }, [])

  const clampIntoOverlay = useCallback(() => {
    const overlayElement = overlayRef.current
    const positionerElement = positionerRef.current
    if (!overlayElement || !positionerElement) return

    const bounds = resolveDragBounds(
      overlayElement.getBoundingClientRect(),
      positionerElement.getBoundingClientRect(),
      offsetRef.current,
      boundaryMargin,
    )
    updateOffset(clampOffset(offsetRef.current, bounds))
  }, [boundaryMargin, updateOffset])

  useEffect(() => {
    if (open) return

    dragStateRef.current = null
    setIsDragging(false)
    updateOffset(INITIAL_OFFSET)
  }, [open, updateOffset])

  useEffect(() => {
    if (!open) return

    function handlePointerMove(event: globalThis.PointerEvent) {
      const dragState = dragStateRef.current
      if (!dragState || event.pointerId !== dragState.pointerID) return

      const overlayElement = overlayRef.current
      const positionerElement = positionerRef.current
      if (!overlayElement || !positionerElement) return

      event.preventDefault()
      const bounds = resolveDragBounds(
        overlayElement.getBoundingClientRect(),
        positionerElement.getBoundingClientRect(),
        offsetRef.current,
        boundaryMargin,
      )
      updateOffset(clampOffset({
        x: dragState.startOffset.x + event.clientX - dragState.startClientX,
        y: dragState.startOffset.y + event.clientY - dragState.startClientY,
      }, bounds))
    }

    function handlePointerStop(event: globalThis.PointerEvent) {
      stopDragging(event.pointerId)
    }

    function handleWindowBlur() {
      stopDragging()
    }

    window.addEventListener("pointermove", handlePointerMove)
    window.addEventListener("pointerup", handlePointerStop)
    window.addEventListener("pointercancel", handlePointerStop)
    window.addEventListener("blur", handleWindowBlur)
    return () => {
      window.removeEventListener("pointermove", handlePointerMove)
      window.removeEventListener("pointerup", handlePointerStop)
      window.removeEventListener("pointercancel", handlePointerStop)
      window.removeEventListener("blur", handleWindowBlur)
    }
  }, [boundaryMargin, open, stopDragging, updateOffset])

  useLayoutEffect(() => {
    if (!open) return

    let animationFrame: number | null = null
    const scheduleClamp = () => {
      if (animationFrame !== null && typeof window.cancelAnimationFrame === "function") {
        window.cancelAnimationFrame(animationFrame)
      }

      if (typeof window.requestAnimationFrame === "function") {
        animationFrame = window.requestAnimationFrame(() => {
          animationFrame = null
          clampIntoOverlay()
        })
        return
      }

      clampIntoOverlay()
    }

    const handleResize = () => {
      stopDragging()
      scheduleClamp()
    }

    scheduleClamp()
    window.addEventListener("resize", handleResize)

    const resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(scheduleClamp)
    if (overlayRef.current) resizeObserver?.observe(overlayRef.current)
    if (positionerRef.current) resizeObserver?.observe(positionerRef.current)

    return () => {
      window.removeEventListener("resize", handleResize)
      resizeObserver?.disconnect()
      if (animationFrame !== null && typeof window.cancelAnimationFrame === "function") {
        window.cancelAnimationFrame(animationFrame)
      }
    }
  }, [clampIntoOverlay, open, stopDragging])

  const onDragHandlePointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || event.isPrimary === false || isInteractiveDragTarget(event.target)) return
    if (!overlayRef.current || !positionerRef.current) return

    event.preventDefault()
    if (typeof event.currentTarget.setPointerCapture === "function") {
      try {
        event.currentTarget.setPointerCapture(event.pointerId)
      } catch {
        // Pointer capture is an enhancement; window listeners still keep drag functional.
      }
    }
    dragStateRef.current = {
      dragTarget: event.currentTarget,
      pointerID: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startOffset: offsetRef.current,
    }
    setIsDragging(true)
  }, [])

  return {
    isDragging,
    offset,
    onDragHandlePointerDown,
    overlayRef,
    positionerRef,
  }
}
