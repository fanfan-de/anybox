import { useEffect, useEffectEvent, useLayoutEffect, useRef, type RefObject } from "react"
import { SIDEBAR_RESIZE_END_EVENT } from "../sidebar-resize-events"

interface UseThreadContentObserverInput {
  isSidebarResizeInProgress: () => boolean
  isSmoothFollowScrollActiveForKey: (key: string) => boolean
  shouldSmoothFollowObservedContentChange: () => boolean
  scrollStateKey: string
  syncThreadScrollAfterContentChange: (
    key?: string,
    options?: { preserveFollowPosition?: boolean; smoothFollow?: boolean },
  ) => void
  threadColumnRef: RefObject<HTMLDivElement | null>
  threadVirtualRenderedRangeKey: string
}

function cancelThreadAnimationFrame(frameID: number | null) {
  if (
    frameID !== null &&
    typeof window !== "undefined" &&
    typeof window.cancelAnimationFrame === "function"
  ) {
    window.cancelAnimationFrame(frameID)
  }
}

export function useThreadContentObserver({
  isSidebarResizeInProgress,
  isSmoothFollowScrollActiveForKey,
  shouldSmoothFollowObservedContentChange,
  scrollStateKey,
  syncThreadScrollAfterContentChange,
  threadColumnRef,
  threadVirtualRenderedRangeKey,
}: UseThreadContentObserverInput) {
  const contentResizeObserverRef = useRef<ResizeObserver | null>(null)
  const contentMutationObserverRef = useRef<MutationObserver | null>(null)
  const observedThreadContentRef = useRef<WeakSet<Element>>(new WeakSet())
  const observeThreadContentRef = useRef<(() => void) | null>(null)
  const pendingObservedContentScrollSyncFrameRef = useRef<number | null>(null)
  const pendingObservedContentScrollSyncKeyRef = useRef<string | null>(null)
  const pendingSidebarResizeScrollSyncRef = useRef(false)
  const pendingSidebarResizeContentObservationRef = useRef(false)

  function scheduleObservedContentScrollSync(key = scrollStateKey) {
    if (isSidebarResizeInProgress()) {
      pendingSidebarResizeScrollSyncRef.current = true
      return
    }

    pendingObservedContentScrollSyncKeyRef.current = key
    if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") {
      pendingObservedContentScrollSyncKeyRef.current = null
      syncThreadScrollAfterContentChange(key, {
        smoothFollow: shouldSmoothFollowObservedContentChange(),
      })
      return
    }
    if (pendingObservedContentScrollSyncFrameRef.current !== null) return

    pendingObservedContentScrollSyncFrameRef.current = window.requestAnimationFrame(() => {
      pendingObservedContentScrollSyncFrameRef.current = null
      const pendingKey = pendingObservedContentScrollSyncKeyRef.current
      pendingObservedContentScrollSyncKeyRef.current = null
      if (!pendingKey) return
      if (isSmoothFollowScrollActiveForKey(pendingKey)) return
      syncThreadScrollAfterContentChange(pendingKey, {
        smoothFollow: shouldSmoothFollowObservedContentChange(),
      })
    })
  }

  const flushDeferredSidebarResizeScrollSync = useEffectEvent((key: string) => {
    cancelThreadAnimationFrame(pendingObservedContentScrollSyncFrameRef.current)
    pendingObservedContentScrollSyncFrameRef.current = null
    pendingObservedContentScrollSyncKeyRef.current = null

    if (pendingSidebarResizeContentObservationRef.current) {
      pendingSidebarResizeContentObservationRef.current = false
      observeThreadContentRef.current?.()
    }

    if (!pendingSidebarResizeScrollSyncRef.current) return
    pendingSidebarResizeScrollSyncRef.current = false
    syncThreadScrollAfterContentChange(key)
  })

  useLayoutEffect(() => {
    const threadColumn = threadColumnRef.current
    if (!threadColumn || typeof ResizeObserver === "undefined") return

    contentResizeObserverRef.current?.disconnect()
    contentMutationObserverRef.current?.disconnect()

    const resizeObserver = new ResizeObserver(() => {
      if (isSidebarResizeInProgress()) {
        pendingSidebarResizeScrollSyncRef.current = true
        pendingSidebarResizeContentObservationRef.current = true
        return
      }

      scheduleObservedContentScrollSync(scrollStateKey)
    })

    observedThreadContentRef.current = new WeakSet()
    const observeThreadContent = () => {
      if (!observedThreadContentRef.current.has(threadColumn)) {
        resizeObserver.observe(threadColumn)
        observedThreadContentRef.current.add(threadColumn)
      }

      const observedElements = threadColumn.querySelectorAll<HTMLElement>(
        ".thread-virtual-spacer, [data-thread-virtual-row-id]",
      )
      for (const element of Array.from(observedElements)) {
        if (element.closest(".thread-column") !== threadColumn) continue
        if (observedThreadContentRef.current.has(element)) continue
        resizeObserver.observe(element)
        observedThreadContentRef.current.add(element)
      }
    }

    observeThreadContent()
    observeThreadContentRef.current = observeThreadContent
    contentResizeObserverRef.current = resizeObserver

    if (typeof MutationObserver !== "undefined") {
      const mutationObserver = new MutationObserver(() => {
        if (isSidebarResizeInProgress()) {
          pendingSidebarResizeScrollSyncRef.current = true
          pendingSidebarResizeContentObservationRef.current = true
          return
        }

        observeThreadContent()
        scheduleObservedContentScrollSync(scrollStateKey)
      })
      mutationObserver.observe(threadColumn, { childList: true, subtree: true })
      contentMutationObserverRef.current = mutationObserver
    }

    return () => {
      resizeObserver.disconnect()
      if (contentResizeObserverRef.current === resizeObserver) {
        contentResizeObserverRef.current = null
      }
      if (observeThreadContentRef.current === observeThreadContent) {
        observeThreadContentRef.current = null
      }
      observedThreadContentRef.current = new WeakSet()
      contentMutationObserverRef.current?.disconnect()
      contentMutationObserverRef.current = null
    }
  }, [scrollStateKey, threadColumnRef, threadVirtualRenderedRangeKey])

  useEffect(() => {
    function handleSidebarResizeEnd() {
      flushDeferredSidebarResizeScrollSync(scrollStateKey)
    }

    window.addEventListener(SIDEBAR_RESIZE_END_EVENT, handleSidebarResizeEnd)
    return () => {
      window.removeEventListener(SIDEBAR_RESIZE_END_EVENT, handleSidebarResizeEnd)
    }
  }, [scrollStateKey, flushDeferredSidebarResizeScrollSync])

  useEffect(() => {
    return () => {
      cancelThreadAnimationFrame(pendingObservedContentScrollSyncFrameRef.current)
      pendingObservedContentScrollSyncFrameRef.current = null
      contentResizeObserverRef.current?.disconnect()
      contentResizeObserverRef.current = null
      contentMutationObserverRef.current?.disconnect()
      contentMutationObserverRef.current = null
      observeThreadContentRef.current = null
    }
  }, [])

  return {
    scheduleObservedContentScrollSync,
  }
}
