import { Magnet, Maximize2, MousePointer2, Redo2, Scissors, Undo2, ZoomIn, ZoomOut } from "lucide-react"

export function TimelineToolbar({
  snapEnabled,
  canSplit,
  canUndo,
  canRedo,
  onSplit,
  onToggleSnap,
  onUndo,
  onRedo,
  onZoomOut,
  onZoomIn,
  onFit,
}: {
  snapEnabled: boolean
  canSplit: boolean
  canUndo: boolean
  canRedo: boolean
  onSplit: () => void
  onToggleSnap: () => void
  onUndo: () => void
  onRedo: () => void
  onZoomOut: () => void
  onZoomIn: () => void
  onFit: () => void
}) {
  const tools = [
    ["Select", MousePointer2, undefined, false],
    ["Split at playhead", Scissors, onSplit, !canSplit],
    ["Snap", Magnet, onToggleSnap, false],
    ["Undo", Undo2, onUndo, !canUndo],
    ["Redo", Redo2, onRedo, !canRedo],
    ["Zoom out", ZoomOut, onZoomOut, false],
    ["Zoom in", ZoomIn, onZoomIn, false],
    ["Fit timeline", Maximize2, onFit, false],
  ] as const
  return (
    <div className="cinema-timeline-toolbar" role="toolbar" aria-label="Timeline tools">
      {tools.map(([label, Icon, onClick, disabled], index) => (
        <button key={label} type="button" className={index === 0 || (index === 2 && snapEnabled) ? "is-active" : ""} aria-label={label} title={label} aria-pressed={index === 0 ? true : index === 2 ? snapEnabled : undefined} disabled={disabled} onClick={onClick}>
          <Icon aria-hidden="true" />
        </button>
      ))}
    </div>
  )
}
