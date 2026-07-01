import type { ReactNode } from "react"
import type { VirtualItem } from "@tanstack/react-virtual"
import type { ThreadDisplayRow } from "./thread-display-rows"
import type { ThreadRowVirtualizer } from "./use-thread-virtual-list"

interface ThreadRowsProps {
  displayRows: ThreadDisplayRow[]
  renderRow: (row: ThreadDisplayRow) => ReactNode
  virtualItems: VirtualItem[]
  virtualizer: ThreadRowVirtualizer
  virtualTotalSize: number
}

export function ThreadRows({
  displayRows,
  renderRow,
  virtualItems,
  virtualizer,
  virtualTotalSize,
}: ThreadRowsProps) {
  return (
    <div
      ref={virtualizer.containerRef}
      className="thread-virtual-spacer"
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
