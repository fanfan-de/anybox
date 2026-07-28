import { Fragment } from "react"
import {
  CloseIcon,
  PlusIcon,
} from "../icons"
import { joinClassNames, ShellTopMenu, SidebarToggleButton } from "../shared-ui"
import type {
  CreateSessionTab,
  SessionSummary,
  WorkspaceGroup
} from "../types"

interface CanvasRegionTopMenuProps {
  activeSessionID: string | null
  activeCreateSessionTabID: string | null
  createSessionTabs: CreateSessionTab[]
  sessions: SessionSummary[]
  workspaces: WorkspaceGroup[]
  showLeftSidebarToggleButton: boolean
  isRightSidebarCollapsed: boolean
  onAddCreateSessionTab: () => void
  onCloseCreateSessionTab: (tabID: string) => void
  onSelectCreateSessionTab: (tabID: string) => void
  onSessionClose: (sessionID: string) => void
  onSessionSelect: (sessionID: string) => void
  onToggleLeftSidebar: () => void
  onToggleRightSidebar: () => void
}

function getCreateSessionWorkspaceLabel(tab: CreateSessionTab, workspaces: WorkspaceGroup[]) {
  const workspace = workspaces.find((item) => item.id === tab.workspaceID)
  return workspace ? workspace.name : null
}

function getCreateSessionTabTitle(tab: CreateSessionTab, index: number, workspaces: WorkspaceGroup[]) {
  const workspaceLabel = getCreateSessionWorkspaceLabel(tab, workspaces)
  if (workspaceLabel) {
    return index === 0 ? `Create · ${workspaceLabel}` : `Create ${index + 1} · ${workspaceLabel}`
  }

  return index === 0 ? "Create session" : `Create session ${index + 1}`
}

function getCreateSessionTabSwitchLabel(tab: CreateSessionTab, index: number) {
  return index === 0 ? "Switch to create session tab" : `Switch to create session tab ${index + 1}`
}

function getCreateSessionTabCloseLabel(tab: CreateSessionTab, index: number) {
  return index === 0 ? "Close create session tab" : `Close create session tab ${index + 1}`
}

export function CanvasRegionTopMenu({
  activeSessionID,
  activeCreateSessionTabID,
  createSessionTabs,
  sessions,
  workspaces,
  onAddCreateSessionTab,
  showLeftSidebarToggleButton,
  isRightSidebarCollapsed,
  onCloseCreateSessionTab,
  onSelectCreateSessionTab,
  onSessionClose,
  onSessionSelect,
  onToggleLeftSidebar,
  onToggleRightSidebar,
}: CanvasRegionTopMenuProps) {
  const canCloseCreateSessionTab = sessions.length > 0 || createSessionTabs.length > 1
  const tabNodes = [
    ...sessions.map((session) => {
      const isActive = activeCreateSessionTabID === null && session.id === activeSessionID

      return {
        key: `session:${session.id}`,
        node: (
          <div className={isActive ? "session-tab is-active" : "session-tab"}>
            <button
              className="session-tab-trigger"
              aria-label={`Switch to session ${session.title}`}
              aria-pressed={isActive}
              title={`Switch to session ${session.title}`}
              type="button"
              onClick={() => onSessionSelect(session.id)}
            >
              <span className="session-tab-copy">
                <span className="session-tab-title">{session.title}</span>
              </span>
            </button>
            <button
              className="session-tab-close"
              aria-label={`Close session tab ${session.title}`}
              title={`Close session tab ${session.title}`}
              type="button"
              onClick={() => onSessionClose(session.id)}
            >
              <CloseIcon />
            </button>
          </div>
        ),
      }
    }),
    ...createSessionTabs.map((tab, index) => {
      const isActive = activeCreateSessionTabID === tab.id
      const switchLabel = getCreateSessionTabSwitchLabel(tab, index)
      const closeLabel = getCreateSessionTabCloseLabel(tab, index)

      return {
        key: `create-session:${tab.id}`,
        node: (
          <div className={isActive ? "session-tab is-active is-create-tab" : "session-tab is-create-tab"}>
            <button
              className="session-tab-trigger"
              aria-label={switchLabel}
              aria-pressed={isActive}
              title={switchLabel}
              type="button"
              onClick={() => onSelectCreateSessionTab(tab.id)}
            >
              <span className="session-tab-title">{getCreateSessionTabTitle(tab, index, workspaces)}</span>
            </button>
            {canCloseCreateSessionTab ? (
              <button
                className="session-tab-close"
                aria-label={closeLabel}
                title={closeLabel}
                type="button"
                onClick={() => onCloseCreateSessionTab(tab.id)}
              >
                <CloseIcon />
              </button>
            ) : null}
          </div>
        ),
      }
    }),
  ]

  return (
    <ShellTopMenu
      as="nav"
      ariaLabel="Canvas region top menu"
      className="canvas-region-top-menu"
      contentClassName="canvas-region-top-menu-tabs-shell"
      content={(
        <>
          <div className="canvas-region-top-menu-tabs" aria-label="Session tabs">
            {tabNodes.map((tab, index) => (
              <Fragment key={tab.key}>
                {index > 0 ? <span className="canvas-region-top-menu-tab-separator" aria-hidden="true" /> : null}
                {tab.node}
              </Fragment>
            ))}
          </div>
          <button className="canvas-region-top-menu-add-button" aria-label="Add session tab" title="Add session tab" type="button" onClick={onAddCreateSessionTab}>
            <PlusIcon />
          </button>
        </>
      )}
      controlsSpacerVariant="canvas"
      dragRegion
      layout="three-column"
      leading={showLeftSidebarToggleButton ? (
        <SidebarToggleButton isSidebarCollapsed={true} onToggleSidebar={onToggleLeftSidebar} side="left" variant="top-menu" />
      ) : null}
      leadingClassName="canvas-region-top-menu-leading"
      trailing={(
        <SidebarToggleButton isSidebarCollapsed={isRightSidebarCollapsed} onToggleSidebar={onToggleRightSidebar} side="right" variant="top-menu" />
      )}
      trailingClassName={joinClassNames(
        "canvas-region-top-menu-trailing",
        isRightSidebarCollapsed ? "is-right-sidebar-collapsed" : "is-right-sidebar-expanded",
      )}
    />
  )
}
