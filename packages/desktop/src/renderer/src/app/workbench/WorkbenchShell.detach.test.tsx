import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { SerializedDockview } from "dockview-react"
import { createWorkspaceStore } from "../agent-workspace/workspace-store"
import { DEFAULT_ASSISTANT_TRACE_VISIBILITY } from "../types"
import { WorkbenchShell, type WorkbenchShellProps } from "./WorkbenchShell"

const dockviewMock = vi.hoisted(() => {
  const activeGroupListeners = new Set<(group: any) => void>()
  const activePanelListeners = new Set<(panel: any) => void>()
  const layoutListeners = new Set<() => void>()
  const willDragPanelListeners = new Set<(event: any) => void>()
  const groupElement = document.createElement("div")
  let snapshot: SerializedDockview | null = null

  Object.defineProperty(groupElement, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      bottom: 480,
      height: 420,
      left: 40,
      right: 760,
      top: 60,
      width: 720,
      x: 40,
      y: 60,
    }),
  })

  const group = {
    activePanel: null as any,
    element: groupElement,
    id: "group-1",
  }
  const panel = {
    group,
    id: "session:session-1",
    title: "Session 1",
    api: {
      close: vi.fn(() => {
        snapshot = {
          activeGroup: "group-1",
          grid: {
            height: 800,
            orientation: "HORIZONTAL",
            root: {
              data: [],
              type: "branch",
            },
            width: 1200,
          },
          panels: {},
        } as unknown as SerializedDockview
        for (const listener of layoutListeners) {
          listener()
        }
      }),
      location: {
        type: "grid",
      },
    },
  }
  const secondaryPanel = {
    group,
    id: "session:session-2",
    title: "Session 2",
    api: panel.api,
  }
  group.activePanel = panel

  const api = {
    activeGroup: group as any,
    activePanel: panel as any,
    clear: vi.fn(),
    fromJSON: vi.fn(),
    getPanel: vi.fn(() => null),
    groups: [group] as any[],
    onDidActiveGroupChange: vi.fn((listener: (group: any) => void) => {
      activeGroupListeners.add(listener)
      return {
        dispose: () => activeGroupListeners.delete(listener),
      }
    }),
    onDidActivePanelChange: vi.fn((listener: (panel: any) => void) => {
      activePanelListeners.add(listener)
      return {
        dispose: () => activePanelListeners.delete(listener),
      }
    }),
    onDidLayoutChange: vi.fn((listener: () => void) => {
      layoutListeners.add(listener)
      return {
        dispose: () => layoutListeners.delete(listener),
      }
    }),
    onWillDragPanel: vi.fn((listener: (event: any) => void) => {
      willDragPanelListeners.add(listener)
      return {
        dispose: () => willDragPanelListeners.delete(listener),
      }
    }),
    toJSON: vi.fn(() => snapshot),
    totalPanels: 1,
  }
  const headerPanelApi = {
    close: vi.fn(),
    group: {
      id: "group-1",
    },
    id: "session:session-1",
    isActive: false,
    onDidActiveChange: vi.fn(() => ({ dispose: vi.fn() })),
    setActive: vi.fn(),
    title: "Session 1",
  }
  const tabPointerDown = vi.fn()

  return {
    activePanelListeners,
    activateSecondaryPanel: () => {
      group.activePanel = secondaryPanel
      api.activeGroup = group as any
      api.activePanel = secondaryPanel as any
      for (const listener of activePanelListeners) {
        listener(secondaryPanel)
      }
    },
    api,
    group,
    headerPanelApi,
    panel,
    reset: () => {
      activeGroupListeners.clear()
      activePanelListeners.clear()
      layoutListeners.clear()
      willDragPanelListeners.clear()
      group.activePanel = panel
      api.activeGroup = group as any
      api.activePanel = panel as any
      snapshot = {
        activeGroup: "group-1",
        grid: {
          height: 800,
          orientation: "HORIZONTAL",
          root: {
            data: [
              {
                data: {
                  activeView: "session:session-1",
                  id: "group-1",
                  views: ["session:session-1"],
                },
                size: 1000,
                type: "leaf",
              },
            ],
            type: "branch",
          },
          width: 1200,
        },
        panels: {
          "session:session-1": {
            contentComponent: "workbench-panel",
            id: "session:session-1",
            params: {
              kind: "session",
              sessionID: "session-1",
            },
            tabComponent: "workbench-tab",
            title: "Session 1",
          },
        },
      } as unknown as SerializedDockview
      panel.api.close.mockClear()
      api.clear.mockClear()
      api.fromJSON.mockClear()
      api.getPanel.mockClear()
      api.onDidActiveGroupChange.mockClear()
      api.onDidActivePanelChange.mockClear()
      api.onDidLayoutChange.mockClear()
      api.onWillDragPanel.mockClear()
      api.toJSON.mockClear()
      api.totalPanels = 1
      headerPanelApi.close.mockClear()
      headerPanelApi.isActive = false
      headerPanelApi.onDidActiveChange.mockClear()
      headerPanelApi.setActive.mockClear()
      tabPointerDown.mockClear()
    },
    tabPointerDown,
    willDragPanelListeners,
  }
})

vi.mock("dockview-react", async () => {
  const React = await vi.importActual<typeof import("react")>("react")

  return {
    DockviewReact: (props: {
      defaultTabComponent?: React.FunctionComponent<any>
      onReady?: (event: { api: typeof dockviewMock.api }) => void
    }) => {
      React.useEffect(() => {
        props.onReady?.({ api: dockviewMock.api })
      }, [props])

      const TabComponent = props.defaultTabComponent

      return React.createElement(
        "div",
        {
          "data-testid": "dockview",
          onPointerDown: dockviewMock.tabPointerDown,
        },
        TabComponent
          ? React.createElement(TabComponent, {
              api: dockviewMock.headerPanelApi,
              containerApi: dockviewMock.api,
              params: {
                kind: "session",
                sessionID: "session-1",
              },
              tabLocation: "header",
            })
          : null,
      )
    },
    Orientation: {
      HORIZONTAL: "HORIZONTAL",
      VERTICAL: "VERTICAL",
    },
  }
})

function createDragEvent(type: string, init: Partial<DragEvent>) {
  const event = new Event(type) as DragEvent

  for (const [key, value] of Object.entries(init)) {
    Object.defineProperty(event, key, {
      configurable: true,
      value,
    })
  }

  return event
}

function createProps(overrides: Partial<WorkbenchShellProps> = {}): WorkbenchShellProps {
  return {
    assistantTraceVisibility: DEFAULT_ASSISTANT_TRACE_VISIBILITY,
    composerRefreshVersion: 0,
    isActivityRailVisible: false,
    isAgentDebugTraceEnabled: false,
    isDetachedWindow: false,
    isResolvingPermissionRequest: false,
    isRightSidebarCollapsed: true,
    isSavingToolPermissionMode: false,
    isSidebarCollapsed: true,
    platform: "win32",
    permissionRequestActionError: null,
    permissionRequestActionRequestID: null,
    store: createWorkspaceStore({
      hasFolderWorkspaceLoader: true,
      initialComposerTabKey: null,
      initialCreateSessionTab: null,
      initialDockviewLayout: null,
    }),
    toolPermissionMode: "default",
    toolPermissionModeError: null,
    windowControls: null,
    readThreadScrollSnapshot: vi.fn(() => null),
    saveThreadScrollSnapshot: vi.fn(),
    surfaceID: "main",
    onActiveDockviewChange: vi.fn(),
    onApproveProposedPlan: vi.fn(),
    onAskUserQuestionAnswer: vi.fn(),
    onCancelSend: vi.fn(),
    onCloseCreateSessionTab: vi.fn(),
    onCloseSessionTab: vi.fn(),
    onCommandsReady: vi.fn(),
    onCreateSessionSubmit: vi.fn(async () => undefined),
    onCreateSessionWorkspaceChange: vi.fn(),
    onCreateSideChatTab: vi.fn(),
    onDeleteSideChatTab: vi.fn(),
    onBranchSelect: vi.fn(async () => undefined),
    onClearComposerParentMessage: vi.fn(),
    onDetachSessionPanel: vi.fn(async () => true),
    onDockBack: vi.fn(),
    onFocusPane: vi.fn(),
    onForkFromMessage: vi.fn(),
    onInspectFileInSidebar: vi.fn(),
    onLayoutChange: vi.fn(),
    onLocalFileLinkOpen: vi.fn(),
    onOpenCreateSessionTab: vi.fn(),
    onOpenProjectFolder: vi.fn(),
    onOpenSideChat: vi.fn(),
    onPasteComposerImageAttachments: vi.fn(),
    onPermissionRequestResponse: vi.fn(),
    onPickComposerAttachments: vi.fn(),
    onPlanModeToggle: vi.fn(),
    onRemoveComposerAttachment: vi.fn(),
    onSelectCreateSessionTab: vi.fn(),
    onSelectSessionTab: vi.fn(),
    onSelectSideChatTab: vi.fn(),
    onSend: vi.fn(),
    onSessionModelSelectionChange: vi.fn(),
    onSetDraft: vi.fn(),
    onToggleLeftSidebar: vi.fn(),
    onToggleRightSidebar: vi.fn(),
    onToolPermissionModeChange: vi.fn(),
    onTurnDiffRestore: vi.fn(),
    onTurnDiffReview: vi.fn(),
    onTurnDiffSummaryHydrate: vi.fn(),
    ...overrides,
  }
}

describe("WorkbenchShell detach", () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it("clears stale store layout when Dockview rejects the restored layout", async () => {
    dockviewMock.reset()
    const staleLayout = {
      activeGroup: "group-1",
      grid: {
        height: 800,
        orientation: "HORIZONTAL",
        root: {
          data: [
            {
              data: {
                activeView: "session:session-1",
                id: "group-1",
                views: ["session:session-1"],
              },
              size: 1000,
              type: "leaf",
            },
          ],
          type: "branch",
        },
        width: 1200,
      },
      panels: {
        "session:session-1": {
          contentComponent: "workbench-panel",
          id: "session:session-1",
          params: {
            kind: "session",
            sessionID: "session-1",
          },
          tabComponent: "workbench-tab",
          title: "Session 1",
        },
      },
    } as unknown as SerializedDockview
    const store = createWorkspaceStore({
      hasFolderWorkspaceLoader: true,
      initialComposerTabKey: null,
      initialCreateSessionTab: null,
      initialDockviewLayout: staleLayout,
    })
    const onLayoutChange = vi.fn()
    dockviewMock.api.fromJSON.mockImplementationOnce(() => {
      throw new Error("Cannot apply layout")
    })

    render(<WorkbenchShell {...createProps({ onLayoutChange, store })} />)

    await waitFor(() => {
      expect(dockviewMock.api.clear).toHaveBeenCalledTimes(1)
      expect(onLayoutChange).toHaveBeenCalledWith(null)
    })
  })

  it("clears stale store layout when restored panels are not mounted", async () => {
    dockviewMock.reset()
    dockviewMock.api.totalPanels = 0
    const staleLayout = {
      activeGroup: "group-1",
      grid: {
        height: 800,
        orientation: "HORIZONTAL",
        root: {
          data: [
            {
              data: {
                activeView: "session:session-1",
                id: "group-1",
                views: ["session:session-1"],
              },
              size: 1000,
              type: "leaf",
            },
          ],
          type: "branch",
        },
        width: 1200,
      },
      panels: {
        "session:session-1": {
          contentComponent: "workbench-panel",
          id: "session:session-1",
          params: {
            kind: "session",
            sessionID: "session-1",
          },
          tabComponent: "workbench-tab",
          title: "Session 1",
        },
      },
    } as unknown as SerializedDockview
    const store = createWorkspaceStore({
      hasFolderWorkspaceLoader: true,
      initialComposerTabKey: null,
      initialCreateSessionTab: null,
      initialDockviewLayout: staleLayout,
    })
    const onLayoutChange = vi.fn()

    render(<WorkbenchShell {...createProps({ onLayoutChange, store })} />)

    await waitFor(() => {
      expect(onLayoutChange).toHaveBeenCalledWith(null)
    })
  })

  it("emits active panel changes without serializing the Dockview layout", async () => {
    dockviewMock.reset()
    const onActiveDockviewChange = vi.fn()
    const onLayoutChange = vi.fn()

    render(<WorkbenchShell {...createProps({ onActiveDockviewChange, onLayoutChange })} />)

    await waitFor(() => {
      expect(dockviewMock.activePanelListeners.size).toBe(1)
    })

    onActiveDockviewChange.mockClear()
    onLayoutChange.mockClear()
    dockviewMock.api.toJSON.mockClear()

    dockviewMock.activateSecondaryPanel()

    expect(onActiveDockviewChange).toHaveBeenCalledWith({
      activeState: {
        activeGroupID: "group-1",
        activePanelIDByGroupID: {
          "group-1": "session:session-2",
        },
      },
      groupID: "group-1",
      panelID: "session:session-2",
      reference: {
        kind: "session",
        sessionID: "session-2",
      },
    })
    expect(onLayoutChange).not.toHaveBeenCalled()
    expect(dockviewMock.api.toJSON).not.toHaveBeenCalled()
  })

  it("emits the closed panel layout after a successful drag detach", async () => {
    dockviewMock.reset()
    const onLayoutChange = vi.fn()

    render(<WorkbenchShell {...createProps({ onLayoutChange })} />)

    await waitFor(() => {
      expect(dockviewMock.willDragPanelListeners.size).toBe(1)
    })

    const dragStartEvent = createDragEvent("dragstart", {})
    const dragEndEvent = createDragEvent("dragend", {
      clientX: -1,
      clientY: 120,
      screenX: 1300,
      screenY: 200,
    })

    for (const listener of dockviewMock.willDragPanelListeners) {
      listener({
        nativeEvent: dragStartEvent,
        panel: dockviewMock.panel,
      })
    }
    window.dispatchEvent(dragEndEvent)

    await waitFor(() => {
      expect(dockviewMock.panel.api.close).toHaveBeenCalledTimes(1)
      expect(onLayoutChange).toHaveBeenCalledWith(expect.objectContaining({
        panels: {},
      }))
    })
  })

  it("leaves inactive session tab pointerdown available for native drag", async () => {
    dockviewMock.reset()

    render(<WorkbenchShell {...createProps()} />)

    const tabTrigger = await screen.findByRole("button", { name: "Switch to session Session 1" })

    fireEvent.pointerDown(tabTrigger, { button: 0 })

    expect(dockviewMock.tabPointerDown).not.toHaveBeenCalled()
    expect(dockviewMock.headerPanelApi.setActive).not.toHaveBeenCalled()

    fireEvent.click(tabTrigger)

    expect(dockviewMock.headerPanelApi.setActive).toHaveBeenCalledTimes(1)
  })
})
