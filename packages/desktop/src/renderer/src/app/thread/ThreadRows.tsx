import { useCallback, useLayoutEffect, useRef, type ReactNode } from "react"
import type { VirtualItem } from "@tanstack/react-virtual"
import { SIDEBAR_RESIZE_END_EVENT } from "../sidebar-resize-events"
import type { ThreadDisplayRow } from "./thread-display-rows"
import { measureThreadVirtualRowElement, type ThreadRowVirtualizer } from "./use-thread-virtual-list"

interface ThreadRowsProps {
  displayRows: ThreadDisplayRow[]
  renderRow: (row: ThreadDisplayRow) => ReactNode
  virtualItems: VirtualItem[]
  virtualizer: ThreadRowVirtualizer
  virtualMeasurementKey?: string | null
  virtualTotalSize: number
}

export function ThreadRows({
  displayRows,
  renderRow,
  virtualItems,
  virtualizer,
  virtualMeasurementKey,
  virtualTotalSize,
}: ThreadRowsProps) {
  const spacerRef = useRef<HTMLDivElement | null>(null)
  const pendingMeasurementFrameRef = useRef<number | null>(null)
  const pendingFollowupMeasurementFrameRef = useRef<number | null>(null)
  const pendingSidebarResizeMeasurementRef = useRef(false)

  const setSpacerRef = useCallback((node: HTMLDivElement | null) => {
    spacerRef.current = node
    virtualizer.containerRef(node)
  }, [virtualizer])

  const measureRenderedRows = useCallback(() => {
    if (document.body.classList.contains("is-resizing-sidebar")) {
      pendingSidebarResizeMeasurementRef.current = true
      return
    }

    const spacer = spacerRef.current
    if (!spacer) return

    const rowElements = spacer.querySelectorAll<HTMLDivElement>(".thread-virtual-row")
    const measurements: Array<{ index: number; size: number }> = []
    for (const rowElement of Array.from(rowElements)) {
      const index = Number(rowElement.dataset.index)
      if (!Number.isInteger(index)) continue

      const measuredSize = measureThreadVirtualRowElement(rowElement)
      if (measuredSize === null) continue
      measurements.push({ index, size: measuredSize })
    }

    pendingSidebarResizeMeasurementRef.current = false
    for (const measurement of measurements) {
      virtualizer.resizeItem(measurement.index, measurement.size)
    }
  }, [virtualizer])

  const scheduleRenderedRowMeasurement = useCallback(() => {
    if (document.body.classList.contains("is-resizing-sidebar")) {
      pendingSidebarResizeMeasurementRef.current = true
      return
    }

    if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") {
      measureRenderedRows()
      return
    }

    if (pendingMeasurementFrameRef.current !== null || pendingFollowupMeasurementFrameRef.current !== null) return
    pendingMeasurementFrameRef.current = window.requestAnimationFrame(() => {
      pendingMeasurementFrameRef.current = null
      measureRenderedRows()
      pendingFollowupMeasurementFrameRef.current = window.requestAnimationFrame(() => {
        pendingFollowupMeasurementFrameRef.current = null
        measureRenderedRows()
      })
    })
  }, [measureRenderedRows])

  useLayoutEffect(() => {
    measureRenderedRows()
  }, [displayRows, measureRenderedRows, virtualItems])

  useLayoutEffect(() => {
    measureRenderedRows()

    if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") return

    let firstFrame: number | null = null
    let secondFrame: number | null = null
    firstFrame = window.requestAnimationFrame(() => {
      firstFrame = null
      measureRenderedRows()
      secondFrame = window.requestAnimationFrame(() => {
        secondFrame = null
        measureRenderedRows()
      })
    })

    return () => {
      if (firstFrame !== null && typeof window.cancelAnimationFrame === "function") {
        window.cancelAnimationFrame(firstFrame)
      }
      if (secondFrame !== null && typeof window.cancelAnimationFrame === "function") {
        window.cancelAnimationFrame(secondFrame)
      }
    }
  }, [measureRenderedRows, virtualMeasurementKey])

  useLayoutEffect(() => {
    const spacer = spacerRef.current
    const threadColumn = spacer?.closest<HTMLDivElement>(".thread-column")
    if (!threadColumn || typeof ResizeObserver === "undefined") return

    const resizeObserver = new ResizeObserver(() => {
      scheduleRenderedRowMeasurement()
    })
    resizeObserver.observe(threadColumn)

    return () => {
      resizeObserver.disconnect()
    }
  }, [scheduleRenderedRowMeasurement])

  useLayoutEffect(() => {
    function handleSidebarResizeEnd() {
      if (!pendingSidebarResizeMeasurementRef.current) return
      scheduleRenderedRowMeasurement()
    }

    window.addEventListener(SIDEBAR_RESIZE_END_EVENT, handleSidebarResizeEnd)
    return () => {
      window.removeEventListener(SIDEBAR_RESIZE_END_EVENT, handleSidebarResizeEnd)
    }
  }, [scheduleRenderedRowMeasurement])

  useLayoutEffect(() => {
    const spacer = spacerRef.current
    if (!spacer || typeof MutationObserver === "undefined") return

    const mutationObserver = new MutationObserver((records) => {
      const hasRowContentChange = records.some((record) => {
        if (record.type === "childList") return record.addedNodes.length > 0 || record.removedNodes.length > 0
        if (record.type !== "attributes") return false

        const target = record.target
        if (!(target instanceof HTMLElement)) return false
        if (target.classList.contains("thread-virtual-spacer")) return false
        if (target.classList.contains("thread-virtual-row")) return false

        return true
      })

      if (hasRowContentChange) {
        scheduleRenderedRowMeasurement()
      }
    })
    mutationObserver.observe(spacer, {
      attributeFilter: ["aria-expanded", "class", "data-state", "hidden", "open"],
      attributes: true,
      childList: true,
      subtree: true,
    })

    return () => {
      mutationObserver.disconnect()
    }
  }, [scheduleRenderedRowMeasurement])

  useLayoutEffect(() => {
    return () => {
      if (
        pendingMeasurementFrameRef.current !== null &&
        typeof window !== "undefined" &&
        typeof window.cancelAnimationFrame === "function"
      ) {
        window.cancelAnimationFrame(pendingMeasurementFrameRef.current)
      }
      pendingMeasurementFrameRef.current = null
      if (
        pendingFollowupMeasurementFrameRef.current !== null &&
        typeof window !== "undefined" &&
        typeof window.cancelAnimationFrame === "function"
      ) {
        window.cancelAnimationFrame(pendingFollowupMeasurementFrameRef.current)
      }
      pendingFollowupMeasurementFrameRef.current = null
    }
  }, [])

  return (
    <div
      ref={setSpacerRef}
      className="thread-virtual-spacer"
      onClickCapture={scheduleRenderedRowMeasurement}
      onKeyUpCapture={scheduleRenderedRowMeasurement}
      onTransitionEndCapture={scheduleRenderedRowMeasurement}
      style={{ height: `${virtualTotalSize}px` }}
    >
      {virtualItems.map((virtualItem) => {
        const row = displayRows[virtualItem.index]
        if (!row) return null

        return (
          <div
            key={virtualItem.key}
            ref={virtualizer.measureElement}
            className="thread-virtual-row"
            data-index={virtualItem.index}
            data-thread-virtual-row-id={row.rowID}
            style={{ transform: `translateY(${virtualItem.start}px)` }}
          >
            {renderRow(row)}
          </div>
        )
      })}
    </div>
  )
}
