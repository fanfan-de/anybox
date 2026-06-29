import type { ReactNode } from "react"
import type { ThreadDisplayRow } from "./thread-display-rows"
import type { ThreadVirtualLayout, ThreadVirtualRange } from "./use-thread-virtual-list"

interface ThreadRowsProps {
  displayRows: ThreadDisplayRow[]
  renderRow: (row: ThreadDisplayRow) => ReactNode
  shouldVirtualize: boolean
  virtualLayout: ThreadVirtualLayout
  virtualRange: ThreadVirtualRange
}

export function ThreadRows({
  displayRows,
  renderRow,
  shouldVirtualize,
  virtualLayout,
  virtualRange,
}: ThreadRowsProps) {
  if (!shouldVirtualize) {
    return <>{displayRows.map((row) => renderRow(row))}</>
  }

  return (
    <div
      className="thread-virtual-spacer"
      style={{ height: `${virtualLayout.totalHeight}px` }}
    >
      {virtualRange.items.map((item) => (
        <div
          key={item.row.rowID}
          className="thread-virtual-row"
          data-thread-virtual-row-id={item.row.rowID}
          data-thread-row-kind={item.row.kind}
          data-thread-message-id={item.row.messageID}
          style={{ transform: `translateY(${item.top}px)` }}
        >
          {renderRow(item.row)}
        </div>
      ))}
    </div>
  )
}
