import { type Ref } from "react"
import { CloseIcon, MaximizeIcon, MinimizeIcon, WindowRestoreIcon } from "../icons"
import type { WindowAction } from "../types"

interface WindowChromeProps {
  controlsRef: Ref<HTMLDivElement>
  isWindowMaximized: boolean
  onWindowAction: (action: WindowAction) => void
}

export function WindowChrome({ controlsRef, isWindowMaximized, onWindowAction }: WindowChromeProps) {
  return (
    <div ref={controlsRef} className="window-controls" role="group" aria-label="Window controls">
      <button className="window-control" aria-label="Minimize window" type="button" onClick={() => onWindowAction("minimize")}>
        <MinimizeIcon />
      </button>
      <button
        className="window-control"
        aria-label={isWindowMaximized ? "Restore window" : "Maximize window"}
        type="button"
        onClick={() => onWindowAction("toggle-maximize")}
      >
        {isWindowMaximized ? <WindowRestoreIcon /> : <MaximizeIcon />}
      </button>
      <button className="window-control is-close" aria-label="Close window" type="button" onClick={() => onWindowAction("close")}>
        <CloseIcon />
      </button>
    </div>
  )
}

export function NativeMacWindowControlsSlot({ controlsRef }: { controlsRef: Ref<HTMLDivElement> }) {
  return <div ref={controlsRef} className="window-controls is-native-macos" aria-hidden="true" />
}
