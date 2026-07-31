import { memo, useEffect, useEffectEvent } from "react"
import { createPortal } from "react-dom"
import type { AppearanceCodeFontFamily } from "../../../../shared/appearance"
import { useI18n } from "../i18n/I18nProvider"
import { TerminalHeaderActions } from "./TerminalHeaderActions"
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
  onTabTitleChange?: (title: string) => void
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
    onTabTitleChange,
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
    handleRestartTerminal,
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

  const { t } = useI18n()
  const emitTabTitleChange = useEffectEvent((title: string) => onTabTitleChange?.(title))
  const tabTitle = activeSession
    ? `${t("terminal.title")} · ${activeSession.title}`
    : t("terminal.title")

  useEffect(() => {
    if (layout !== "fill" || !currentSessionID) return
    emitTabTitleChange(tabTitle)
  }, [currentSessionID, layout, tabTitle])

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
        floatingActions={isFillLayout && activeSession ? (
          <TerminalHeaderActions
            isBusy={isCreatingTerminal}
            session={activeSession}
            shellProfiles={shellProfiles}
            onCloseTerminal={handleCloseTerminal}
            onRestartTerminal={handleRestartTerminal}
          />
        ) : null}
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
