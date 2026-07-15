import { act, renderHook } from "@testing-library/react"
import { useMemo, useRef, useState } from "react"
import { describe, expect, it, vi } from "vitest"
import type { SerializedDockview } from "dockview-react"
import type { WorkbenchSharedState } from "../../../../shared/desktop-ipc-contract"
import type { CreateSessionTab, SessionSummary, WorkspaceGroup } from "../types"
import {
  createDockviewActiveStateFromLayout,
  createInitialDockviewLayout,
  getWorkbenchDockPanelId,
  WORKBENCH_DOCK_PANEL_COMPONENT,
  WORKBENCH_DOCK_TAB_COMPONENT,
  type WorkbenchDockviewCommands,
} from "../workbench/dockview-state"
import { DEFAULT_WORKSPACE_FILE_REVIEW_STATE } from "./review-preview-state"
import { useWorkbenchTabController } from "./workbench-tab-controller"
import {
  buildWorkspaceDerivedState,
  createCreateSessionWorkbenchTab,
  createSessionWorkbenchTab,
} from "./workspace-derived-state"

function createSession(id: string): SessionSummary {
  return {
    id,
    title: id,
    branch: "main",
    status: "Ready",
    updated: 1,
    focus: "",
    summary: "",
  }
}

function createWorkspace(id: string, sessions: SessionSummary[]): WorkspaceGroup {
  return {
    id,
    name: id,
    directory: `C:/work/${id}`,
    created: 1,
    updated: 1,
    project: {
      id: `project-${id}`,
      name: `Project ${id}`,
      worktree: `C:/work/${id}`,
    },
    sessions,
  }
}

function createHarnessDockviewLayout(sessionID: string, createSessionTabID: string) {
  const sessionReference = createSessionWorkbenchTab(sessionID)
  const createReference = createCreateSessionWorkbenchTab(createSessionTabID)
  const sessionPanelID = getWorkbenchDockPanelId(sessionReference)
  const createPanelID = getWorkbenchDockPanelId(createReference)
  const layout = createInitialDockviewLayout(sessionReference, sessionID)
  const root = layout.grid.root
  if (root.type === "branch" && Array.isArray(root.data)) {
    const leaf = root.data[0]
    if (leaf?.type === "leaf") {
      ;(leaf.data as { views: string[] }).views = [sessionPanelID, createPanelID]
    }
  }
  layout.panels[createPanelID] = {
    id: createPanelID,
    contentComponent: WORKBENCH_DOCK_PANEL_COMPONENT,
    tabComponent: WORKBENCH_DOCK_TAB_COMPONENT,
    title: "Create session",
    params: createReference,
  }
  return layout
}

function useWorkbenchHarness(options: { surfaceID?: string; workbenchState?: WorkbenchSharedState | null } = {}) {
  const session = useMemo(() => createSession("session-1"), [])
  const secondarySession = useMemo(() => createSession("session-2"), [])
  const workspace = useMemo(() => createWorkspace("workspace-1", [session]), [session])
  const secondaryWorkspace = useMemo(() => createWorkspace("workspace-2", [secondarySession]), [secondarySession])
  const workspaces = useMemo(() => [workspace, secondaryWorkspace], [secondaryWorkspace, workspace])
  const [createSessionTabs, setCreateSessionTabs] = useState<CreateSessionTab[]>([
    {
      id: "create-1",
      workspaceID: workspace.id,
      title: "",
    },
  ])
  const [selectedFolderID, setSelectedFolderID] = useState<string | null>(workspace.id)
  const [expandedFolderIDs, setExpandedFolderIDs] = useState<string[]>([workspace.id])
  const [dockviewLayout, setDockviewLayout] = useState<SerializedDockview | null>(() =>
    createHarnessDockviewLayout(session.id, "create-1"),
  )
  const [dockviewActiveState, setDockviewActiveState] = useState(() =>
    createDockviewActiveStateFromLayout(dockviewLayout),
  )
  const lastFocusedSessionIDRef = useRef<string | null>(null)
  const projectRowRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const commandsRef = useRef<WorkbenchDockviewCommands | null>(null)
  if (!commandsRef.current) {
    commandsRef.current = {
      closePanel: vi.fn(() => true),
      focusPanel: vi.fn(() => false),
      getSnapshot: vi.fn(() => null),
      openPanel: vi.fn(() => true),
      popoutPanel: vi.fn(async () => true),
      replacePanel: vi.fn(() => true),
      splitPanel: vi.fn(() => true),
    }
  }
  vi.mocked(commandsRef.current.getSnapshot).mockReturnValue(dockviewLayout)
  const derived = buildWorkspaceDerivedState({
    activeSideChatSessionIDByParentSessionID: {},
    cancellingSessionIDs: {},
    composerAttachmentsByTabKey: {},
    composerDraftStateByTabKey: {},
    contextUsageBySession: {},
    conversations: {},
    createSessionTabs,
    isCreatingSessionByTabKey: {},
    isInitialWorkspaceLoadPending: false,
    isSendingByTabKey: {},
    pendingPermissionRequestsBySession: {},
    platform: "win32",
    previewByWorkspaceID: {},
    selectedDiffFileBySession: {},
    selectedFolderID,
    sessionDiffBySession: {},
    sessionDiffStateBySession: {},
    sessionDirectoryBySession: {},
    sessionRuntimeDebugBySession: {},
    sessionRuntimeDebugStateBySession: {},
    seedWorkspaceIDs: new Set(),
    dockviewActiveState,
    dockviewLayout,
    workspaceFileCommentsByTarget: {},
    workspaceFileReviewState: DEFAULT_WORKSPACE_FILE_REVIEW_STATE,
    workspaces,
  })

  const controller = useWorkbenchTabController({
    activeCreateSessionTab: derived.activeCreateSessionTab,
    activeCreateSessionTabID: derived.activeCreateSessionTabID,
    activeSessionID: derived.activeSessionID,
    activeWorkspace: derived.activeWorkspace,
    createSessionTabs,
    dockviewActiveState,
    dockviewLayout,
    focusedPane: derived.focusedPane,
    focusedPaneID: derived.focusedPaneID,
    isCreateSessionTabActive: derived.isCreateSessionTabActive,
    lastFocusedSessionIDRef,
    projectRowRefs,
    selectedFolderID,
    setCreateSessionTabs,
    setDockviewActiveState,
    setDockviewLayout,
    setExpandedFolderIDs,
    setSelectedFolderID,
    surfaceID: options.surfaceID ?? "main",
    workbenchDockviewCommandsRef: commandsRef,
    workbenchState: options.workbenchState ?? null,
    workspaces,
  })

  return {
    ...controller,
    commands: commandsRef.current,
    createSessionTabs,
    dockviewActiveState,
    dockviewLayout,
    expandedFolderIDs,
    lastFocusedSessionID: lastFocusedSessionIDRef.current,
    selectedFolderID,
  }
}

describe("workbench tab controller", () => {
  it("selects and closes create-session tabs through Dockview commands", () => {
    const { result } = renderHook(() => useWorkbenchHarness())

    act(() => {
      result.current.handleCreateSessionTabSelect("create-1", "group-1")
    })

    expect(result.current.commands.openPanel).toHaveBeenCalledWith(
      createCreateSessionWorkbenchTab("create-1"),
      expect.objectContaining({ targetGroupID: "group-1" }),
    )

    act(() => {
      result.current.handleCloseCreateSessionTab("create-1")
    })

    expect(result.current.createSessionTabs).toEqual([])
    expect(result.current.commands.closePanel).toHaveBeenCalledWith(createCreateSessionWorkbenchTab("create-1"))
  })

  it("splits a pane by creating a scoped create-session panel", () => {
    const { result } = renderHook(() => useWorkbenchHarness())

    act(() => {
      result.current.handlePaneSplit("group-1")
    })

    expect(result.current.createSessionTabs).toHaveLength(2)
    expect(result.current.createSessionTabs[1]?.workspaceID).toBe("workspace-1")
    expect(result.current.commands.splitPanel).toHaveBeenCalledWith(
      createCreateSessionWorkbenchTab(result.current.createSessionTabs[1]!.id),
      expect.objectContaining({ direction: "right", targetGroupID: "group-1" }),
    )
  })

  it("opens a selected session in the right split", async () => {
    const { result } = renderHook(() => useWorkbenchHarness())

    await act(async () => {
      await result.current.handleSessionSplitRight("workspace-2", "session-2")
    })

    expect(result.current.commands.splitPanel).toHaveBeenCalledWith(
      createSessionWorkbenchTab("session-2"),
      expect.objectContaining({ direction: "right", title: "session-2" }),
    )
    expect(result.current.selectedFolderID).toBe("workspace-2")
    expect(result.current.expandedFolderIDs).toContain("workspace-2")
  })

  it("opens an existing session panel in a popout window", async () => {
    const { result } = renderHook(() => useWorkbenchHarness())

    await act(async () => {
      await result.current.handleSessionPopout("session-1")
    })

    expect(result.current.commands.popoutPanel).toHaveBeenCalledWith(createSessionWorkbenchTab("session-1"))
  })

  it("detaches an unopened session directly into a new window", async () => {
    const previousDesktop = window.desktop
    const detachSessionPanel = vi.fn().mockResolvedValue({
      ok: true,
      panelID: "session:session-2",
      state: { version: 1, windows: [], ownership: [], panels: {} },
      windowID: "session-popout:session-2",
    })
    window.desktop = { ...(previousDesktop ?? {}), detachSessionPanel } as typeof window.desktop

    try {
      const { result } = renderHook(() => useWorkbenchHarness())
      vi.mocked(result.current.commands.popoutPanel).mockResolvedValueOnce(false)

      await act(async () => {
        await result.current.handleSessionPopout("session-2")
      })

      expect(detachSessionPanel).toHaveBeenCalledWith(expect.objectContaining({
        panelID: "session:session-2",
        sessionID: "session-2",
        sourceSurfaceID: "main",
        title: "session-2",
      }))
    } finally {
      window.desktop = previousDesktop
    }
  })

  it("selects a session through Dockview focus or open commands", () => {
    const { result } = renderHook(() => useWorkbenchHarness())

    act(() => {
      result.current.handleCanvasSessionTabSelect("session-2")
    })

    expect(result.current.commands.focusPanel).toHaveBeenCalledWith(createSessionWorkbenchTab("session-2"))
    expect(result.current.commands.openPanel).toHaveBeenCalledWith(
      createSessionWorkbenchTab("session-2"),
      expect.objectContaining({ title: "session-2" }),
    )
    expect(result.current.selectedFolderID).toBe("workspace-2")
    expect(result.current.expandedFolderIDs).toContain("workspace-2")
  })

  it("focuses a remotely owned session instead of opening a duplicate panel", () => {
    const remoteState: WorkbenchSharedState = {
      version: 1,
      windows: [
        {
          id: "main",
          kind: "main",
          ownedPanelIDs: ["session:session-1"],
          surfaceID: "main",
        },
        {
          id: "popout-1",
          kind: "session-popout",
          ownedPanelIDs: ["session:session-2"],
          surfaceID: "popout-1",
        },
      ],
      surfaces: [
        {
          surfaceID: "main",
          kind: "main",
          windowID: "main",
          ownedPanelIDs: ["session:session-1"],
        },
        {
          surfaceID: "popout-1",
          kind: "session-popout",
          windowID: "popout-1",
          ownedPanelIDs: ["session:session-2"],
        },
      ],
      ownership: [
        {
          panelID: "session:session-2",
          ownerSurfaceID: "popout-1",
          ownerWindowID: "popout-1",
          reference: { kind: "session", sessionID: "session-2" },
        },
      ],
      panels: {},
    }
    const previousDesktop = window.desktop
    const focusWorkbenchPanel = vi.fn().mockResolvedValue({
      ok: true,
      panelID: "session:session-2",
      state: remoteState,
      windowID: "popout-1",
    })
    window.desktop = {
      ...(previousDesktop ?? {}),
      focusWorkbenchPanel,
    } as typeof window.desktop

    try {
      const { result } = renderHook(() => useWorkbenchHarness({ workbenchState: remoteState }))

      act(() => {
        result.current.handleCanvasSessionTabSelect("session-2")
      })

      expect(focusWorkbenchPanel).toHaveBeenCalledWith({ panelID: "session:session-2" })
      expect(result.current.commands.openPanel).not.toHaveBeenCalledWith(
        createSessionWorkbenchTab("session-2"),
        expect.anything(),
      )
      expect(result.current.selectedFolderID).toBe("workspace-2")
      expect(result.current.expandedFolderIDs).toContain("workspace-2")
    } finally {
      window.desktop = previousDesktop
    }
  })

  it("moves a remotely owned session into the right split", async () => {
    const remoteState: WorkbenchSharedState = {
      version: 1,
      windows: [
        { id: "main", kind: "main", ownedPanelIDs: [], surfaceID: "main" },
        { id: "popout-1", kind: "session-popout", ownedPanelIDs: ["session:session-2"], surfaceID: "popout-1" },
      ],
      surfaces: [
        { surfaceID: "main", kind: "main", windowID: "main", ownedPanelIDs: [] },
        { surfaceID: "popout-1", kind: "session-popout", windowID: "popout-1", ownedPanelIDs: ["session:session-2"] },
      ],
      ownership: [
        {
          panelID: "session:session-2",
          ownerSurfaceID: "popout-1",
          ownerWindowID: "popout-1",
          reference: { kind: "session", sessionID: "session-2" },
        },
      ],
      panels: {},
    }
    const previousDesktop = window.desktop
    const moveWorkbenchPanel = vi.fn().mockResolvedValue({ ok: true, state: remoteState })
    window.desktop = { ...(previousDesktop ?? {}), moveWorkbenchPanel } as typeof window.desktop

    try {
      const { result } = renderHook(() => useWorkbenchHarness({ workbenchState: remoteState }))

      await act(async () => {
        await result.current.handleSessionSplitRight("workspace-2", "session-2")
      })

      expect(moveWorkbenchPanel).toHaveBeenCalledWith(expect.objectContaining({
        panelID: "session:session-2",
        placement: "right",
        sourceSurfaceID: "popout-1",
        targetSurfaceID: "main",
      }))
      expect(result.current.commands.splitPanel).not.toHaveBeenCalledWith(
        createSessionWorkbenchTab("session-2"),
        expect.anything(),
      )
    } finally {
      window.desktop = previousDesktop
    }
  })

  it("syncs business focus from Dockview active changes", () => {
    const { result } = renderHook(() => useWorkbenchHarness())

    act(() => {
      result.current.handleDockviewActiveChange({
        activeState: {
          activeGroupID: "group-2",
          activePanelIDByGroupID: {
            "group-2": "session:session-2",
          },
        },
        groupID: "group-2",
        panelID: "session:session-2",
        reference: createSessionWorkbenchTab("session-2"),
      })
    })

    expect(result.current.selectedFolderID).toBe("workspace-2")
    expect(result.current.expandedFolderIDs).toContain("workspace-2")
    expect(result.current.lastFocusedSessionID).toBe("session-2")
    expect(result.current.dockviewActiveState.activeGroupID).toBe("group-2")
  })
})
