import { memo, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react"
import type { AppearanceCodeFontFamily } from "../../../../shared/appearance"
import type { BrandTheme, ColorMode } from "../types"
import { TerminalInitialDimensionsProbe } from "./TerminalInitialDimensionsProbe"
import { TerminalShellPicker, TerminalTabs } from "./TerminalTabs"
import { TerminalView } from "./TerminalView"
import type { TerminalSessionRecord, TerminalShellProfile, TerminalStreamEvent } from "./types"

interface TerminalPanelProps {
  activeSession: TerminalSessionRecord | null
  brandTheme: BrandTheme
  codeFontFamily?: AppearanceCodeFontFamily
  colorMode: ColorMode
  creationError?: string | null
  isOpen: boolean
  isCreatingTerminal?: boolean
  layout?: "panel" | "fill"
  panelHeight: number
  pendingCreateRequestID?: number | null
  showToggleButton?: boolean
  sessions: TerminalSessionRecord[]
  onCloseTerminal: (ptyID: string) => void | Promise<void>
  onCreateTerminal: () => void | Promise<void>
  onCreateTerminalForShellProfile: (profileID: string) => void | Promise<void>
  onTerminalInitialDimensions: (requestID: number, dimensions: { rows: number; cols: number }) => void | Promise<void>
  onTerminalInitialDimensionsError: (requestID: number, message: string) => void
  onPanelHeightChange: (height: number) => void
  onShellProfileChange: (profileID: string) => void
  onSelectTerminal: (ptyID: string) => void
  selectedShellProfileID: string
  shellProfiles: TerminalShellProfile[]
  onTerminalInput: (ptyID: string, data: string) => void | Promise<void>
  onTerminalResize: (ptyID: string, rows: number, cols: number) => void
  onTerminalSnapshotChange: (ptyID: string, input: { scrollTop?: number }) => void
  onTogglePanel: () => void | Promise<void>
  subscribeToTerminalStream: (ptyID: string, listener: (event: TerminalStreamEvent) => void) => () => void
}

const MIN_PANEL_HEIGHT = 220
const MAX_PANEL_HEIGHT = 560

function clampHeight(value: number) {
  return Math.max(MIN_PANEL_HEIGHT, Math.min(MAX_PANEL_HEIGHT, value))
}

export const TerminalPanel = memo(function TerminalPanel({
  activeSession,
  brandTheme,
  codeFontFamily = "default",
  colorMode,
  creationError,
  isOpen,
  isCreatingTerminal = false,
  layout = "panel",
  panelHeight,
  pendingCreateRequestID = null,
  showToggleButton = true,
  sessions,
  onCloseTerminal,
  onCreateTerminal,
  onCreateTerminalForShellProfile,
  onTerminalInitialDimensions,
  onTerminalInitialDimensionsError,
  onPanelHeightChange,
  onShellProfileChange,
  onSelectTerminal,
  selectedShellProfileID,
  shellProfiles,
  onTerminalInput,
  onTerminalResize,
  onTerminalSnapshotChange,
  onTogglePanel,
  subscribeToTerminalStream,
}: TerminalPanelProps) {
  const [isResizing, setIsResizing] = useState(false)
  const [previewHeight, setPreviewHeight] = useState(panelHeight)
  const startRef = useRef<{ pointerY: number; height: number } | null>(null)
  const previewHeightRef = useRef(panelHeight)
  const animationFrameRef = useRef<number | null>(null)

  useEffect(() => {
    if (isResizing) return
    previewHeightRef.current = panelHeight
    setPreviewHeight(panelHeight)
  }, [isResizing, panelHeight])

  useEffect(() => {
    return () => {
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (!isResizing) return

    const queuePreviewHeight = (height: number) => {
      previewHeightRef.current = height
      if (animationFrameRef.current !== null) return

      animationFrameRef.current = window.requestAnimationFrame(() => {
        animationFrameRef.current = null
        setPreviewHeight(previewHeightRef.current)
      })
    }

    const handlePointerMove = (event: globalThis.PointerEvent) => {
      if (!startRef.current) return
      const delta = startRef.current.pointerY - event.clientY
      queuePreviewHeight(clampHeight(startRef.current.height + delta))
    }

    const stopResize = () => {
      const committedHeight = startRef.current?.height ?? panelHeight
      const nextHeight = previewHeightRef.current
      startRef.current = null
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }
      setPreviewHeight(nextHeight)
      setIsResizing(false)
      if (nextHeight !== committedHeight) {
        onPanelHeightChange(nextHeight)
      }
    }

    document.body.classList.add("is-resizing-terminal-panel")
    window.addEventListener("pointermove", handlePointerMove)
    window.addEventListener("pointerup", stopResize)
    window.addEventListener("pointercancel", stopResize)

    return () => {
      document.body.classList.remove("is-resizing-terminal-panel")
      window.removeEventListener("pointermove", handlePointerMove)
      window.removeEventListener("pointerup", stopResize)
      window.removeEventListener("pointercancel", stopResize)
    }
  }, [isResizing, onPanelHeightChange, panelHeight])

  if (!isOpen) return null

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (layout === "fill") return
    if (event.button !== 0) return
    previewHeightRef.current = panelHeight
    setPreviewHeight(panelHeight)
    startRef.current = {
      pointerY: event.clientY,
      height: panelHeight,
    }
    setIsResizing(true)
  }

  const renderedHeight = isResizing ? previewHeight : panelHeight
  const canCreateTerminal = sessions.length === 0
  const isFillLayout = layout === "fill"
  const panelClassName = [
    "terminal-panel",
    isResizing ? "is-resizing" : "",
    isFillLayout ? "is-fill" : "",
  ].filter(Boolean).join(" ")
  const panelStyle = isFillLayout ? undefined : { height: `${String(renderedHeight)}px` }

  return (
    <section className={panelClassName} style={panelStyle}>
      {isFillLayout ? null : (
        <div
          className={isResizing ? "terminal-panel-resizer is-active" : "terminal-panel-resizer"}
          onPointerDown={handlePointerDown}
          role="separator"
          aria-label="Resize terminal panel"
          aria-orientation="horizontal"
        />
      )}

      {isFillLayout ? null : (
        <TerminalTabs
          activePtyID={activeSession?.ptyID ?? null}
          canCreateTerminal={canCreateTerminal}
          isCreatingTerminal={isCreatingTerminal}
          showToggleButton={showToggleButton}
          sessions={sessions}
          onCloseTerminal={onCloseTerminal}
          onCreateTerminal={onCreateTerminalForShellProfile}
          onShellProfileChange={onShellProfileChange}
          onSelectTerminal={onSelectTerminal}
          selectedShellProfileID={selectedShellProfileID}
          shellProfiles={shellProfiles}
          onTogglePanel={onTogglePanel}
        />
      )}

      {activeSession ? (
        <TerminalView
          brandTheme={brandTheme}
          codeFontFamily={codeFontFamily}
          colorMode={colorMode}
          panelHeight={renderedHeight}
          session={activeSession}
          ariaLabel={isFillLayout ? activeSession.title : undefined}
          onInput={onTerminalInput}
          onResize={onTerminalResize}
          onSnapshotChange={onTerminalSnapshotChange}
          subscribeToTerminalStream={subscribeToTerminalStream}
        />
      ) : isCreatingTerminal && !creationError && pendingCreateRequestID !== null ? (
        <TerminalInitialDimensionsProbe
          key={pendingCreateRequestID}
          brandTheme={brandTheme}
          codeFontFamily={codeFontFamily}
          colorMode={colorMode}
          panelHeight={renderedHeight}
          requestID={pendingCreateRequestID}
          onDimensions={onTerminalInitialDimensions}
          onMeasurementError={onTerminalInitialDimensionsError}
        />
      ) : (
        <div className="terminal-empty-state">
          {creationError ? (
            <p className="terminal-empty-error" role="alert">
              {creationError}
            </p>
          ) : (
            <p>No terminal session is open.</p>
          )}
          <div className={isFillLayout ? "terminal-empty-launcher" : undefined}>
            {isFillLayout ? (
              <div className="terminal-empty-shell-picker">
                <span className="terminal-shell-picker-label">Shell</span>
                <TerminalShellPicker
                  disabled={isCreatingTerminal}
                  onChange={onShellProfileChange}
                  profiles={shellProfiles}
                  selectedProfileID={selectedShellProfileID}
                />
              </div>
            ) : null}
            <button
              className="secondary-button"
              disabled={!canCreateTerminal || isCreatingTerminal}
              onClick={() => void (
                isFillLayout
                  ? onCreateTerminalForShellProfile(selectedShellProfileID)
                  : onCreateTerminal()
              )}
              type="button"
            >
              {isCreatingTerminal ? "Creating..." : creationError ? "Retry" : "Create terminal"}
            </button>
          </div>
        </div>
      )}
    </section>
  )
})
