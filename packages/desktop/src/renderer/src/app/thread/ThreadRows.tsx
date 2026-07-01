import { useCallback, useLayoutEffect, useRef, type ReactNode } from "react"
import type { VirtualItem } from "@tanstack/react-virtual"
import type { ThreadDisplayRow } from "./thread-display-rows"
import { measureThreadVirtualRowElement, type ThreadRowVirtualizer } from "./use-thread-virtual-list"

interface ThreadRowsProps {
  displayRows: ThreadDisplayRow[]
  renderRow: (row: ThreadDisplayRow) => ReactNode
  virtualItems: VirtualItem[]
  virtualizer: ThreadRowVirtualizer
}

export function ThreadRows({
  displayRows,
  renderRow,
  virtualItems,
  virtualizer,
}: ThreadRowsProps) {
  const spacerRef = useRef<HTMLDivElement | null>(null)
  const pendingMeasurementFrameRef = useRef<number | null>(null)

  const setSpacerRef = useCallback((node: HTMLDivElement | null) => {
    spacerRef.current = node
    virtualizer.containerRef(node)
  }, [virtualizer])

  const measureRenderedRows = useCallback(() => {
    const spacer = spacerRef.current
    if (!spacer) return

    const rowElements = spacer.querySelectorAll<HTMLDivElement>(".thread-virtual-row")
    for (const rowElement of Array.from(rowElements)) {
      const index = Number(rowElement.dataset.index)
      if (!Number.isInteger(index)) continue

      const measuredSize = measureThreadVirtualRowElement(rowElement)
      if (measuredSize === null) continue

      virtualizer.resizeItem(index, measuredSize)
    }
  }, [virtualizer])

  const scheduleRenderedRowMeasurement = useCallback(() => {
    if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") {
      measureRenderedRows()
      return
    }

    if (pendingMeasurementFrameRef.current !== null) return
    pendingMeasurementFrameRef.current = window.requestAnimationFrame(() => {
      pendingMeasurementFrameRef.current = null
      measureRenderedRows()
    })
  }, [measureRenderedRows])

  useLayoutEffect(() => {
    measureRenderedRows()
  }, [displayRows, measureRenderedRows, virtualItems])

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
    return () => {
      if (
        pendingMeasurementFrameRef.current !== null &&
        typeof window !== "undefined" &&
        typeof window.cancelAnimationFrame === "function"
      ) {
        window.cancelAnimationFrame(pendingMeasurementFrameRef.current)
      }
      pendingMeasurementFrameRef.current = null
    }
  }, [])

  return (
    <div
      ref={setSpacerRef}
      className="thread-virtual-spacer"
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
          >
            {renderRow(row)}
          </div>
        )
      })}
    </div>
  )
}
