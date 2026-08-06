import { type KeyboardEvent, type PointerEvent } from "react"
import { type SidebarSide } from "../shared-ui"

interface SidebarResizerProps {
  ariaLabel?: string
  controlsID?: string
  isSidebarResizing: boolean
  maxWidth: number
  minWidth: number
  side: SidebarSide
  sidebarWidth: number
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void
}

export function SidebarResizer({
  ariaLabel: ariaLabelOverride,
  controlsID: controlsIDOverride,
  isSidebarResizing,
  maxWidth,
  minWidth,
  side,
  sidebarWidth,
  onKeyDown,
  onPointerDown,
}: SidebarResizerProps) {
  const resizerClassName = side === "right"
    ? isSidebarResizing ? "sidebar-resizer is-right is-active" : "sidebar-resizer is-right"
    : isSidebarResizing ? "sidebar-resizer is-active" : "sidebar-resizer"
  const ariaLabel = ariaLabelOverride ?? (side === "right" ? "Resize right sidebar" : "Resize left sidebar")
  const controlsID = controlsIDOverride ?? (side === "right" ? "app-sidebar-right" : "app-sidebar")
  const testID = side === "right" ? "right-sidebar-resizer" : "sidebar-resizer"

  return (
    <div
      className={resizerClassName}
      role="separator"
      aria-label={ariaLabel}
      aria-controls={controlsID}
      aria-orientation="vertical"
      aria-valuemin={Math.round(minWidth)}
      aria-valuemax={Math.round(maxWidth)}
      aria-valuenow={sidebarWidth}
      data-testid={testID}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
    />
  )
}
