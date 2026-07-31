import { memo } from "react"
import { createPortal } from "react-dom"
import type { AppearanceCodeFontFamily } from "../../../../shared/appearance"
import { TerminalPanel } from "./TerminalPanel"
import { TerminalPanelToggleButton } from "./TerminalPanelToggleButton"
import { useTerminalWorkspace } from "./use-terminal-workspace"

interface TerminalAreaHostProps {
  brandTheme: "terra" | "sage"
  codeFontFamily?: AppearanceCodeFontFamily
  collapsedTogglePortalTarget?: Element | null
  colorMode: "system" | "light" | "dark"
  currentSessionID: string | null
  layout?: "panel" | "fill"
  storageKey?: string
  togglePortalTarget?: Element | null
}

export const TerminalAreaHost = memo(function TerminalAreaHost(props: TerminalAreaHostProps) {
  const {
    brandTheme,
    codeFontFamily = "default",
    collapsedTogglePortalTarget,
    colorMode,
    currentSessionID,
    layout = "panel",
    storageKey,
    togglePortalTarget,
  } = props
  const {
    activeSession,
    creationError,
    handleCloseTerminal,
    handleCreateTerminal,
    handleCreateTerminalForShellProfile,
    handlePanelHeightChange,
    handleShellProfileChange,
    handleSelectTerminal,
    handleTerminalInitialDimensions,
    handleTerminalInitialDimensionsError,
    handleTerminalInput,
    handleTerminalResize,
    handleTerminalSnapshotChange,
    handleTogglePanel,
    isCreatingTerminal,
    isOpen,
    panelHeight,
    pendingCreateRequestID,
    selectedShellProfileID,
    shellProfiles,
    sessions,
    subscribeToTerminalStream,
  } = useTerminalWorkspace({
    currentSessionID,
    storageKey,
  })

  if (!currentSessionID) return null

  const isFillLayout = layout === "fill"
  const effectiveIsOpen = isFillLayout ? true : isOpen
  const hasPersistentTogglePortal = !isFillLayout && Object.prototype.hasOwnProperty.call(props, "togglePortalTarget")
  const toggleButton = <TerminalPanelToggleButton isOpen={isOpen} onToggle={() => void handleTogglePanel()} />

  return (
    <>
      {!isFillLayout && hasPersistentTogglePortal
        ? togglePortalTarget
          ? createPortal(toggleButton, togglePortalTarget)
          : null
        : !isFillLayout && !isOpen
        ? collapsedTogglePortalTarget
          ? createPortal(toggleButton, collapsedTogglePortalTarget)
          : (
            <div className="canvas-terminal-toggle-anchor">
              {toggleButton}
            </div>
          )
        : null}
      <TerminalPanel
        activeSession={activeSession}
        brandTheme={brandTheme}
        codeFontFamily={codeFontFamily}
        colorMode={colorMode}
        creationError={creationError}
        isOpen={effectiveIsOpen}
        isCreatingTerminal={isCreatingTerminal}
        layout={layout}
        panelHeight={panelHeight}
        pendingCreateRequestID={pendingCreateRequestID}
        showToggleButton={!isFillLayout && !hasPersistentTogglePortal}
        sessions={sessions}
        onCloseTerminal={handleCloseTerminal}
        onCreateTerminal={handleCreateTerminal}
        onCreateTerminalForShellProfile={handleCreateTerminalForShellProfile}
        onTerminalInitialDimensions={handleTerminalInitialDimensions}
        onTerminalInitialDimensionsError={handleTerminalInitialDimensionsError}
        onPanelHeightChange={handlePanelHeightChange}
        onShellProfileChange={handleShellProfileChange}
        onSelectTerminal={handleSelectTerminal}
        selectedShellProfileID={selectedShellProfileID}
        shellProfiles={shellProfiles}
        onTerminalInput={handleTerminalInput}
        onTerminalResize={handleTerminalResize}
        onTerminalSnapshotChange={handleTerminalSnapshotChange}
        onTogglePanel={() => void handleTogglePanel()}
        subscribeToTerminalStream={subscribeToTerminalStream}
      />
    </>
  )
})
