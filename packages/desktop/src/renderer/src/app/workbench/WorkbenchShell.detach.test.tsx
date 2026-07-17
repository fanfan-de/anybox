import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { SerializedDockview } from "dockview-react"
import { createWorkspaceStore } from "../agent-workspace/workspace-store"
import { DEFAULT_ASSISTANT_TRACE_VISIBILITY } from "../types"
import { flushRendererFrameNow, resetRendererFrameCoordinatorForTest } from "../renderer-frame-coordinator"
import { WorkbenchShell, type WorkbenchShellProps } from "./WorkbenchShell"

const dockviewMock = vi.hoisted(() => {
  const activeGroupListeners = new Set<(group: any) => void>()
  const activePanelListeners = new Set<(panel: any) => void>()
  const layoutListeners = new Set<() => void>()
  const willDragPanelListeners = new Set<(event: any) => void>()
  const groupElement = document.createElement("div")
  let lastProps: any = null
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
    api: {
      location: {
        type: "grid",
      },
    },
    element: groupElement,
    focus: vi.fn(),
    id: "group-1",
  }
  const floatingGroup = {
    ...group,
    api: {
      location: {
        type: "floating",
      },
    },
    id: "floating-group",
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
      setActive: vi.fn(),
      setTitle: vi.fn(),
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
    addPanel: vi.fn((options: any) => {
      const nextPanel = {
        group,
        id: options.id,
        title: options.title,
        api: {
          close: vi.fn(),
          location: {
            type: "grid",
          },
          setActive: vi.fn(),
          setTitle: vi.fn(),
        },
      }
      snapshot = {
        activeGroup: "group-1",
        grid: {
          height: 800,
          orientation: "HORIZONTAL",
          root: {
            data: [
              {
                data: {
                  activeView: options.id,
                  id: "group-1",
                  views: [options.id],
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
          [options.id]: {
            contentComponent: options.component,
            id: options.id,
            params: options.params,
            tabComponent: options.tabComponent,
            title: options.title,
          },
        },
      } as unknown as SerializedDockview
      return nextPanel
    }),
    clear: vi.fn(),
    fromJSON: vi.fn(),
    getGroup: vi.fn((id: string) => {
      if (id === group.id) return group
      if (id === floatingGroup.id) return floatingGroup
      return undefined
    }),
    getPanel: vi.fn(() => null),
    groups: [group] as any[],
    layout: vi.fn(),
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
    get lastProps() {
      return lastProps
    },
    set lastProps(value: any) {
      lastProps = value
    },
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
      group.focus.mockClear()
      panel.api.close.mockClear()
      panel.api.setActive.mockClear()
      panel.api.setTitle.mockClear()
      api.addPanel.mockClear()
      api.clear.mockClear()
      api.fromJSON.mockClear()
      api.getGroup.mockClear()
      api.getPanel.mockClear()
      api.layout.mockClear()
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
      lastProps = null
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
      disableAutoResizing?: boolean
      onReady?: (event: { api: typeof dockviewMock.api }) => void
      scrollbars?: "custom" | "native"
    }) => {
      dockviewMock.lastProps = props
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
    codeTheme: "github-light",
    composerRefreshVersion: 0,
    isActivityRailVisible: false,
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
    onSend: vi.fn(),
    onSessionModelSelectionChange: vi.fn(),
    onSetDraft: vi.fn(),
    onToggleLeftSidebar: vi.fn(),
    onToggleRightSidebar: vi.fn(),
    onToolPermissionModeChange: vi.fn(),
    onMessageDiffRestore: vi.fn(),
    onMessageDiffReview: vi.fn(),
    onMessageDiffSummaryHydrate: vi.fn(),
    ...overrides,
  }
}

describe("WorkbenchShell detach", () => {
  afterEach(() => {
    resetRendererFrameCoordinatorForTest()
    vi.clearAllMocks()
  })

  it("configures Dockview for manual queued resizing and native tab scrolling", async () => {
    dockviewMock.reset()

    render(<WorkbenchShell {...createProps()} />)

    await waitFor(() => {
      expect(dockviewMock.lastProps?.disableAutoResizing).toBe(true)
    })
    expect(dockviewMock.lastProps?.scrollbars).toBe("native")
  })

  it("queues Dockview layouts from observed workbench size changes", async () => {
    dockviewMock.reset()
    const originalResizeObserver = globalThis.ResizeObserver
    let resizeCallback: ResizeObserverCallback | null = null

    class ManualResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resizeCallback = callback
      }

      disconnect = vi.fn()
      observe = vi.fn()
      unobserve = vi.fn()
    }

    globalThis.ResizeObserver = ManualResizeObserver as unknown as typeof ResizeObserver

    try {
      render(<WorkbenchShell {...createProps()} />)

      await waitFor(() => {
        expect(resizeCallback).not.toBeNull()
      })

      dockviewMock.api.layout.mockClear()

      const dispatchResize = (callback: ResizeObserverCallback | null, width = 642.4, height = 419.6) => {
        if (!callback) throw new Error("ResizeObserver callback was not registered.")
        callback([
          {
            borderBoxSize: [{ blockSize: height, inlineSize: width }] as ResizeObserverSize[],
            contentRect: { height, width } as DOMRectReadOnly,
            target: document.createElement("div"),
          } as unknown as ResizeObserverEntry,
        ], {} as ResizeObserver)
      }

      dispatchResize(resizeCallback)
      flushRendererFrameNow("workbench-test")

      expect(dockviewMock.api.layout).toHaveBeenCalledWith(642, 420, false)
      expect(dockviewMock.api.layout).toHaveBeenCalledTimes(1)

      dispatchResize(resizeCallback)
      flushRendererFrameNow("workbench-test")

      expect(dockviewMock.api.layout).toHaveBeenCalledTimes(1)

      dispatchResize(resizeCallback, 643.4, 419.6)
      flushRendererFrameNow("workbench-test")

      expect(dockviewMock.api.layout).toHaveBeenLastCalledWith(643, 420, false)
      expect(dockviewMock.api.layout).toHaveBeenCalledTimes(2)
    } finally {
      globalThis.ResizeObserver = originalResizeObserver
    }
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

  it("opens panels in a grid group when the requested target group is floating", async () => {
    dockviewMock.reset()
    const onCommandsReady = vi.fn()

    render(<WorkbenchShell {...createProps({ onCommandsReady })} />)

    await waitFor(() => {
      expect(onCommandsReady).toHaveBeenCalledWith(expect.objectContaining({ openPanel: expect.any(Function) }))
    })
    const commands = onCommandsReady.mock.calls.find(([value]) => value)?.[0]!

    commands.openPanel({ kind: "session", sessionID: "session-3" }, {
      targetGroupID: "floating-group",
      title: "Session 3",
    })

    expect(dockviewMock.api.addPanel).toHaveBeenCalledWith(expect.objectContaining({
      id: "session:session-3",
      position: {
        direction: "within",
        referenceGroup: "group-1",
      },
    }))
  })

  it("retries opening a panel without position if Dockview rejects the target location", async () => {
    dockviewMock.reset()
    const onCommandsReady = vi.fn()
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    dockviewMock.api.addPanel.mockImplementationOnce((options: any) => {
      if (options.position) throw new Error("invalid location")
      return dockviewMock.panel
    })

    try {
      render(<WorkbenchShell {...createProps({ onCommandsReady })} />)

      await waitFor(() => {
        expect(onCommandsReady).toHaveBeenCalledWith(expect.objectContaining({ openPanel: expect.any(Function) }))
      })
      const commands = onCommandsReady.mock.calls.find(([value]) => value)?.[0]!

      commands.openPanel({ kind: "session", sessionID: "session-4" }, {
        targetGroupID: "group-1",
        title: "Session 4",
      })

      expect(dockviewMock.api.addPanel).toHaveBeenNthCalledWith(1, expect.objectContaining({
        id: "session:session-4",
        position: {
          direction: "within",
          referenceGroup: "group-1",
        },
      }))
      expect(dockviewMock.api.addPanel).toHaveBeenNthCalledWith(2, expect.objectContaining({
        id: "session:session-4",
        position: undefined,
      }))
    } finally {
      warnSpy.mockRestore()
    }
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
