import { describe, expect, it } from "vitest"
import { Orientation, type SerializedDockview } from "dockview-react"
import type { SessionSummary, WorkbenchTabReference, WorkspaceGroup } from "../types"
import {
  createDockviewActiveStateFromLayout,
  getWorkbenchDockPanelId,
  WORKBENCH_DOCK_PANEL_COMPONENT,
  WORKBENCH_DOCK_TAB_COMPONENT,
} from "../workbench/dockview-state"
import { DEFAULT_WORKSPACE_FILE_REVIEW_STATE } from "./review-preview-state"
import {
  buildWorkbenchPublishSnapshot,
  buildWorkspaceDerivedState,
  createCreateSessionWorkbenchTab,
  createSessionWorkbenchTab,
  getWorkbenchTabKey,
  resolveCreateSessionWorkspaceID,
  workbenchPublishSnapshotsAreEqual,
} from "./workspace-derived-state"

function createWorkbenchPane(tabs: WorkbenchTabReference[], id: string, activeTabIndex = 0) {
  return { activeTabIndex, id, tabs }
}

function createDockviewLayoutFromPanes(panes: Array<ReturnType<typeof createWorkbenchPane>>): SerializedDockview | null {
  if (panes.length === 0) return null

  const panels: SerializedDockview["panels"] = {}
  const rootChildren = panes.map((pane) => {
    const panelIDs = pane.tabs.map((tab) => {
      const panelID = getWorkbenchDockPanelId(tab)
      panels[panelID] = {
        id: panelID,
        contentComponent: WORKBENCH_DOCK_PANEL_COMPONENT,
        tabComponent: WORKBENCH_DOCK_TAB_COMPONENT,
        title: panelID,
        params: tab,
      }
      return panelID
    })

    return {
      type: "leaf" as const,
      data: {
        id: pane.id,
        views: panelIDs,
        activeView: panelIDs[pane.activeTabIndex] ?? panelIDs[0],
      },
      size: 1000,
    }
  })

  return {
    grid: {
      root: {
        type: "branch",
        data: rootChildren,
      },
      height: 800,
      width: 1200,
      orientation: Orientation.HORIZONTAL,
    },
    panels,
    activeGroup: panes[0]?.id,
  }
}

function createSession(id: string, title = id): SessionSummary {
  return {
    id,
    title,
    branch: "main",
    status: "Ready",
    updated: 100,
    focus: "",
    summary: "",
  }
}

function createWorkspace(id: string, sessions: SessionSummary[], exists = true): WorkspaceGroup {
  return {
    id,
    name: id,
    directory: `C:/work/${id}`,
    exists,
    created: 1,
    updated: 2,
    project: {
      id: `project-${id}`,
      name: `Project ${id}`,
      worktree: `C:/work/${id}`,
    },
    sessions,
  }
}

function buildDerivedState(overrides: Partial<Parameters<typeof buildWorkspaceDerivedState>[0]> = {}) {
  return buildWorkspaceDerivedState({
    cancellingSessionIDs: {},
    composerAttachmentsByTabKey: {},
    composerDraftStateByTabKey: {},
    contextUsageBySession: {},
    conversations: {},
    createSessionTabs: [],
    isCreatingSessionByTabKey: {},
    isInitialWorkspaceLoadPending: false,
    isSendingByTabKey: {},
    pendingPermissionRequestsBySession: {},
    platform: "win32",
    previewByWorkspaceID: {},
    selectedDiffFileBySession: {},
    selectedFolderID: null,
    sessionDiffBySession: {},
    sessionDiffStateBySession: {},
    sessionDirectoryBySession: {},
    sessionRuntimeDebugBySession: {},
    sessionRuntimeDebugStateBySession: {},
    seedWorkspaceIDs: new Set(),
    dockviewActiveState: createDockviewActiveStateFromLayout(null),
    dockviewLayout: null,
    workspaceFileCommentsByTarget: {},
    workspaceFileReviewState: DEFAULT_WORKSPACE_FILE_REVIEW_STATE,
    workspaces: [],
    ...overrides,
  })
}

describe("workspace derived state", () => {

  it("keeps panel states bound to their own session or create-session reference", () => {
    const sessionA = createSession("session-a", "Session A")
    const sessionB = createSession("session-b", "Session B")
    const workspace = createWorkspace("workspace-1", [sessionA, sessionB])
    const createSessionTab = {
      id: "create-1",
      initialWorkflowMode: "planning" as const,
      workspaceID: workspace.id,
      title: "",
    }
    const sessionATab = createSessionWorkbenchTab(sessionA.id)
    const sessionBTab = createSessionWorkbenchTab(sessionB.id)
    const createTab = createCreateSessionWorkbenchTab(createSessionTab.id)
    const panelAID = getWorkbenchDockPanelId(sessionATab)
    const panelBID = getWorkbenchDockPanelId(sessionBTab)
    const createPanelID = getWorkbenchDockPanelId(createTab)
    const createTabKey = getWorkbenchTabKey(createTab)
    const stateSlices = {
      composerAttachmentsByTabKey: {
        [panelBID]: [{ name: "b.txt", path: "C:/work/workspace-1/b.txt" }],
      },
      composerDraftStateByTabKey: {
        [panelAID]: { lexicalJSON: "{}", plainText: "draft A" },
        [panelBID]: { lexicalJSON: "{}", plainText: "draft B" },
        [createTabKey]: { lexicalJSON: "{}", plainText: "draft create" },
      },
      conversations: {
        [sessionA.id]: [{ id: "message-a", kind: "user" as const, text: "from A", timestamp: 1 }],
        [sessionB.id]: [{ id: "message-b", kind: "user" as const, text: "from B", timestamp: 2 }],
      },
      createSessionTabs: [createSessionTab],
      isCreatingSessionByTabKey: {
        [createTabKey]: true,
      },
      selectedFolderID: workspace.id,
      workspaces: [workspace],
    }
    const tabs = [sessionATab, sessionBTab, createTab]

    const derivedWithAActive = buildDerivedState({
      ...stateSlices,
      dockviewLayout: createDockviewLayoutFromPanes([createWorkbenchPane(tabs, "pane-1", 0)]),
    })

    expect(derivedWithAActive.workbenchPaneStateByID["pane-1"]?.sessionID).toBe(sessionA.id)
    expect(derivedWithAActive.workbenchPanelStateByID[panelAID]).toMatchObject({
      activeTabKey: panelAID,
      sessionID: sessionA.id,
    })
    expect(derivedWithAActive.workbenchPanelStateByID[panelAID]?.activeMessages[0]?.id).toBe("message-a")
    expect(derivedWithAActive.workbenchPanelStateByID[panelAID]?.draftState.plainText).toBe("draft A")
    expect(derivedWithAActive.workbenchPanelStateByID[panelBID]).toMatchObject({
      activeTabKey: panelBID,
      sessionID: sessionB.id,
    })
    expect(derivedWithAActive.workbenchPanelStateByID[panelBID]?.activeMessages[0]?.id).toBe("message-b")
    expect(derivedWithAActive.workbenchPanelStateByID[panelBID]?.composerAttachments).toEqual([
      { name: "b.txt", path: "C:/work/workspace-1/b.txt" },
    ])
    expect(derivedWithAActive.workbenchPanelStateByID[createPanelID]).toMatchObject({
      activeTabKey: createTabKey,
      createSessionInitialWorkflowMode: "planning",
      createSessionTabID: createSessionTab.id,
      createSessionWorkspaceID: workspace.id,
      isCreatingSession: true,
      sessionID: null,
    })
    expect(derivedWithAActive.workbenchPanelStateByID[createPanelID]?.draftState.plainText).toBe("draft create")

    const derivedWithBActive = buildDerivedState({
      ...stateSlices,
      dockviewLayout: createDockviewLayoutFromPanes([createWorkbenchPane(tabs, "pane-1", 1)]),
    })

    expect(derivedWithBActive.workbenchPaneStateByID["pane-1"]?.sessionID).toBe(sessionB.id)
    expect(derivedWithBActive.workbenchPanelStateByID[panelAID]?.sessionID).toBe(sessionA.id)
    expect(derivedWithBActive.workbenchPanelStateByID[panelBID]?.sessionID).toBe(sessionB.id)
  })

  it("builds lightweight workbench publish snapshots without runtime state", () => {
    const sessionA = createSession("session-a", "Session A")
    const sessionB = createSession("session-b", "Session B")
    const workspace = createWorkspace("workspace-1", [sessionA, sessionB])
    const createSessionTab = {
      id: "create-1",
      initialWorkflowMode: "planning" as const,
      workspaceID: workspace.id,
      title: "",
    }
    const sessionATab = createSessionWorkbenchTab(sessionA.id)
    const sessionBTab = createSessionWorkbenchTab(sessionB.id)
    const createTab = createCreateSessionWorkbenchTab(createSessionTab.id)
    const panelAID = getWorkbenchDockPanelId(sessionATab)
    const panelBID = getWorkbenchDockPanelId(sessionBTab)
    const createPanelID = getWorkbenchDockPanelId(createTab)
    const layout = createDockviewLayoutFromPanes([createWorkbenchPane([sessionATab, createTab, sessionBTab], "pane-1")])

    const publishSnapshot = buildWorkbenchPublishSnapshot({
      createSessionTabs: [createSessionTab],
      dockviewLayout: layout,
      workspaces: [workspace],
    })

    expect(publishSnapshot.ownedPanelIDs).toEqual([panelAID, panelBID])
    expect(publishSnapshot.panels[panelAID]).toEqual({
      panelID: panelAID,
      reference: {
        kind: "session",
        sessionID: sessionA.id,
      },
      title: "Session A",
    })
    expect(publishSnapshot.panels[panelAID]).not.toHaveProperty("pane")
    expect(publishSnapshot.panels[panelAID]).not.toHaveProperty("workspaces")
    expect(publishSnapshot.panels).not.toHaveProperty(createPanelID)

    const derivedWithMessages = buildDerivedState({
      conversations: {
        [sessionA.id]: [{ id: "message-a", kind: "user", text: "from A", timestamp: 1 }],
      },
      createSessionTabs: [createSessionTab],
      dockviewLayout: layout,
      workspaces: [workspace],
    })
    expect(derivedWithMessages.workbenchPanelStateByID[panelAID]?.activeMessages).toHaveLength(1)

    const publishSnapshotAfterMessages = buildWorkbenchPublishSnapshot({
      createSessionTabs: [createSessionTab],
      dockviewLayout: layout,
      workspaces: [workspace],
    })
    expect(workbenchPublishSnapshotsAreEqual(publishSnapshot, publishSnapshotAfterMessages)).toBe(true)

    const renamedSnapshot = buildWorkbenchPublishSnapshot({
      createSessionTabs: [createSessionTab],
      dockviewLayout: layout,
      workspaces: [createWorkspace("workspace-1", [{ ...sessionA, title: "Renamed A" }, sessionB])],
    })
    expect(workbenchPublishSnapshotsAreEqual(publishSnapshot, renamedSnapshot)).toBe(false)
  })

  it("derives running sessions from sending tabs and streaming assistant messages", () => {
    const sendingSession = createSession("session-sending", "Sending")
    const streamingSession = createSession("session-streaming", "Streaming")
    const idleSession = createSession("session-idle", "Idle")
    const workspace = createWorkspace("workspace-1", [sendingSession, streamingSession, idleSession])

    const derived = buildWorkspaceDerivedState({
      cancellingSessionIDs: {},
      composerAttachmentsByTabKey: {},
      composerDraftStateByTabKey: {},
      contextUsageBySession: {},
      conversations: {
        [streamingSession.id]: [
          {
            id: "assistant-1",
            kind: "assistant",
            backendTurnID: "turn-assistant-1",
            segmentID: "assistant-1",
            timestamp: 1,
            runtime: {
              phase: "reasoning",
              startedAt: 1,
              updatedAt: 1,
            },
            state: "Reasoning",
            items: [],
            isStreaming: true,
          },
        ],
        [idleSession.id]: [
          {
            id: "assistant-2",
            kind: "assistant",
            backendTurnID: "turn-assistant-2",
            segmentID: "assistant-2",
            timestamp: 2,
            runtime: {
              phase: "completed",
              startedAt: 2,
              updatedAt: 2,
            },
            state: "Done",
            items: [],
            isStreaming: false,
          },
        ],
      },
      createSessionTabs: [],
      isCreatingSessionByTabKey: {},
      isInitialWorkspaceLoadPending: false,
      isSendingByTabKey: {
        [`session:${sendingSession.id}`]: true,
        [`session:${idleSession.id}`]: false,
        "create-session:create-1": true,
      },
      pendingPermissionRequestsBySession: {},
      platform: "win32",
      previewByWorkspaceID: {},
      selectedDiffFileBySession: {},
      selectedFolderID: workspace.id,
      sessionDiffBySession: {},
      sessionDiffStateBySession: {},
      sessionDirectoryBySession: {},
      sessionRuntimeDebugBySession: {},
      sessionRuntimeDebugStateBySession: {},
      seedWorkspaceIDs: new Set(),
      dockviewActiveState: createDockviewActiveStateFromLayout(null),
      dockviewLayout: null,
      workspaceFileCommentsByTarget: {},
      workspaceFileReviewState: DEFAULT_WORKSPACE_FILE_REVIEW_STATE,
      workspaces: [workspace],
    })

    expect([...derived.runningSessionIDs].sort()).toEqual([sendingSession.id, streamingSession.id].sort())
  })

  it("exposes pending workflow mode for the active create-session tab", () => {
    const workspace = createWorkspace("workspace-1", [])
    const createSessionTab = {
      id: "create-1",
      initialWorkflowMode: "planning" as const,
      workspaceID: workspace.id,
      title: "",
    }
    const layout = createDockviewLayoutFromPanes([
      createWorkbenchPane([createCreateSessionWorkbenchTab(createSessionTab.id)], "pane-1"),
    ])

    const derived = buildWorkspaceDerivedState({
      cancellingSessionIDs: {},
      composerAttachmentsByTabKey: {},
      composerDraftStateByTabKey: {},
      contextUsageBySession: {},
      conversations: {},
      createSessionTabs: [createSessionTab],
      isCreatingSessionByTabKey: {},
      isInitialWorkspaceLoadPending: false,
      isSendingByTabKey: {},
      pendingPermissionRequestsBySession: {},
      platform: "win32",
      previewByWorkspaceID: {},
      selectedDiffFileBySession: {},
      selectedFolderID: workspace.id,
      sessionDiffBySession: {},
      sessionDiffStateBySession: {},
      sessionDirectoryBySession: {},
      sessionRuntimeDebugBySession: {},
      sessionRuntimeDebugStateBySession: {},
      seedWorkspaceIDs: new Set(),
      dockviewActiveState: createDockviewActiveStateFromLayout(layout),
      dockviewLayout: layout,
      workspaceFileCommentsByTarget: {},
      workspaceFileReviewState: DEFAULT_WORKSPACE_FILE_REVIEW_STATE,
      workspaces: [workspace],
    })

    expect(derived.workbenchPaneStates[0]?.createSessionInitialWorkflowMode).toBe("planning")
  })

  it("separates open canvas sessions from the visible active canvas sessions", () => {
    const sessionA = createSession("session-a", "A")
    const sessionB = createSession("session-b", "B")
    const sessionC = createSession("session-c", "C")
    const workspace = createWorkspace("workspace-1", [sessionA, sessionB, sessionC])
    const layout = createDockviewLayoutFromPanes([
      createWorkbenchPane([
        createSessionWorkbenchTab(sessionA.id),
        createSessionWorkbenchTab(sessionB.id),
      ], "pane-1"),
      createWorkbenchPane([
        createSessionWorkbenchTab(sessionC.id),
      ], "pane-2"),
    ])

    const derived = buildWorkspaceDerivedState({
      cancellingSessionIDs: {},
      composerAttachmentsByTabKey: {},
      composerDraftStateByTabKey: {},
      contextUsageBySession: {},
      conversations: {},
      createSessionTabs: [],
      isCreatingSessionByTabKey: {},
      isInitialWorkspaceLoadPending: false,
      isSendingByTabKey: {},
      pendingPermissionRequestsBySession: {},
      platform: "win32",
      previewByWorkspaceID: {},
      selectedDiffFileBySession: {},
      selectedFolderID: workspace.id,
      sessionDiffBySession: {},
      sessionDiffStateBySession: {},
      sessionDirectoryBySession: {},
      sessionRuntimeDebugBySession: {},
      sessionRuntimeDebugStateBySession: {},
      seedWorkspaceIDs: new Set(),
      dockviewActiveState: createDockviewActiveStateFromLayout(layout),
      dockviewLayout: layout,
      workspaceFileCommentsByTarget: {},
      workspaceFileReviewState: DEFAULT_WORKSPACE_FILE_REVIEW_STATE,
      workspaces: [workspace],
    })

    expect(derived.openCanvasSessionIDs).toEqual([sessionA.id, sessionB.id, sessionC.id])
    expect(derived.visibleCanvasSessionIDs).toEqual([sessionA.id, sessionC.id])
  })

  it("uses dockview active state for focused and visible sessions without changing open sessions", () => {
    const sessionA = createSession("session-a", "A")
    const sessionB = createSession("session-b", "B")
    const sessionC = createSession("session-c", "C")
    const workspace = createWorkspace("workspace-1", [sessionA, sessionB, sessionC])
    const sessionATab = createSessionWorkbenchTab(sessionA.id)
    const sessionBTab = createSessionWorkbenchTab(sessionB.id)
    const sessionCTab = createSessionWorkbenchTab(sessionC.id)
    const panelAID = getWorkbenchDockPanelId(sessionATab)
    const panelBID = getWorkbenchDockPanelId(sessionBTab)
    const panelCID = getWorkbenchDockPanelId(sessionCTab)
    const layout = createDockviewLayoutFromPanes([
      createWorkbenchPane([sessionATab, sessionBTab], "pane-1", 0),
      createWorkbenchPane([sessionCTab], "pane-2", 0),
    ])

    const derived = buildDerivedState({
      dockviewActiveState: {
        activeGroupID: "pane-2",
        activePanelIDByGroupID: {
          "pane-1": panelBID,
          "pane-2": panelCID,
        },
      },
      dockviewLayout: layout,
      selectedFolderID: workspace.id,
      workspaces: [workspace],
    })

    expect(derived.activeSessionID).toBe(sessionC.id)
    expect(derived.openCanvasSessionIDs).toEqual([sessionA.id, sessionB.id, sessionC.id])
    expect(derived.visibleCanvasSessionIDs).toEqual([sessionB.id, sessionC.id])
    expect(derived.workbenchPanelStateByID[panelAID]?.isActivePanel).toBe(false)
    expect(derived.workbenchPanelStateByID[panelBID]?.isActivePanel).toBe(true)
    expect(derived.workbenchPanelStateByID[panelCID]?.isActivePanel).toBe(true)
  })

  it("falls back to layout active views when dockview active state is stale", () => {
    const sessionA = createSession("session-a", "A")
    const sessionB = createSession("session-b", "B")
    const workspace = createWorkspace("workspace-1", [sessionA, sessionB])
    const sessionATab = createSessionWorkbenchTab(sessionA.id)
    const sessionBTab = createSessionWorkbenchTab(sessionB.id)
    const layout = createDockviewLayoutFromPanes([
      createWorkbenchPane([sessionATab, sessionBTab], "pane-1", 1),
    ])

    const derived = buildDerivedState({
      dockviewActiveState: {
        activeGroupID: "missing-pane",
        activePanelIDByGroupID: {
          "pane-1": "missing-panel",
          "missing-pane": "session:missing",
        },
      },
      dockviewLayout: layout,
      selectedFolderID: workspace.id,
      workspaces: [workspace],
    })

    expect(derived.focusedPaneID).toBe("pane-1")
    expect(derived.activeSessionID).toBe(sessionB.id)
    expect(derived.visibleCanvasSessionIDs).toEqual([sessionB.id])
  })

  it("resolves create-session workspace using preferred, selected, active, then available fallback order", () => {
    const unavailable = createWorkspace("workspace-unavailable", [], false)
    const selected = createWorkspace("workspace-selected", [])
    const active = createWorkspace("workspace-active", [])

    expect(resolveCreateSessionWorkspaceID([unavailable, selected, active], unavailable.id, selected.id, active.id)).toBe(selected.id)
    expect(resolveCreateSessionWorkspaceID([unavailable, active], null, null, active.id)).toBe(active.id)
    expect(resolveCreateSessionWorkspaceID([unavailable], null, null, null)).toBe(unavailable.id)
  })
})
