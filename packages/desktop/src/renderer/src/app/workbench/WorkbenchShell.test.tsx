import { describe, expect, it } from "vitest"
import { Orientation, type SerializedDockview } from "dockview-react"
import type { SessionSummary, WorkbenchTabReference, WorkspaceGroup } from "../types"
import {
  createDockviewActiveStateFromLayout,
  getWorkbenchDockPanelId,
  WORKBENCH_DOCK_PANEL_COMPONENT,
  WORKBENCH_DOCK_TAB_COMPONENT,
} from "./dockview-state"
import { DEFAULT_WORKSPACE_FILE_REVIEW_STATE } from "../agent-workspace/review-preview-state"
import {
  buildWorkbenchPaneState,
  buildWorkbenchPanelState,
  createSessionWorkbenchTab,
  getWorkbenchTabKey,
  workbenchPaneStatesAreEqual,
  type BuildWorkspaceDerivedStateInput,
} from "../agent-workspace/workspace-derived-state"
import { createComposerDraftStateFromPlainText } from "../composer/draft-state"

function createDockviewLayout(tabs: WorkbenchTabReference[], groupID = "group-1", activeTabIndex = 0): SerializedDockview {
  const panels: SerializedDockview["panels"] = {}
  const panelIDs = tabs.map((tab) => {
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
    activeGroup: groupID,
    grid: {
      height: 800,
      orientation: Orientation.HORIZONTAL,
      root: {
        data: [
          {
            data: {
              activeView: panelIDs[activeTabIndex] ?? panelIDs[0],
              id: groupID,
              views: panelIDs,
            },
            size: 1000,
            type: "leaf",
          },
        ],
        type: "branch",
      },
      width: 1200,
    },
    panels,
  }
}

function createSession(id: string): SessionSummary {
  return {
    branch: "main",
    focus: "",
    id,
    status: "Ready",
    summary: "",
    title: id,
    updated: 100,
  }
}

function createWorkspace(sessions: SessionSummary[]): WorkspaceGroup {
  return {
    created: 1,
    directory: "C:/work/project",
    exists: true,
    id: "workspace-1",
    name: "Workspace",
    project: {
      id: "project-1",
      name: "Project",
      worktree: "C:/work/project",
    },
    sessions,
    updated: 2,
  }
}

function buildInput(overrides: Partial<BuildWorkspaceDerivedStateInput> = {}): BuildWorkspaceDerivedStateInput {
  const dockviewLayout = overrides.dockviewLayout ?? null
  return {
    cancellingSessionIDs: {},
    composerAttachmentsByTabKey: {},
    composerDraftStateByTabKey: {},
    contextUsageBySession: {},
    conversations: {},
    createSessionTabs: [],
    dockviewActiveState: createDockviewActiveStateFromLayout(dockviewLayout),
    dockviewLayout,
    isCreatingSessionByTabKey: {},
    isInitialWorkspaceLoadPending: false,
    isSendingByTabKey: {},
    pendingPermissionRequestsBySession: {},
    platform: "win32",
    previewByWorkspaceID: {},
    seedWorkspaceIDs: new Set(),
    selectedDiffFileBySession: {},
    selectedFolderID: null,
    sessionDiffBySession: {},
    sessionDiffStateBySession: {},
    sessionDirectoryBySession: {},
    sessionRuntimeDebugBySession: {},
    sessionRuntimeDebugStateBySession: {},
    workspaceFileCommentsByTarget: {},
    workspaceFileReviewState: DEFAULT_WORKSPACE_FILE_REVIEW_STATE,
    workspaces: [],
    ...overrides,
  }
}

describe("workbench surface selectors", () => {
  it("falls back to the pane containing the Dockview panel when group ids diverge", () => {
    const session = createSession("session-chat-1")
    const dockviewLayout = createDockviewLayout([createSessionWorkbenchTab(session.id)], "legacy-pane-1")
    const pane = buildWorkbenchPaneState(
      buildInput({
        dockviewLayout,
        workspaces: [createWorkspace([session])],
      }),
      "dockview-restored-group",
      "session:session-chat-1",
    )

    expect(pane?.id).toBe("legacy-pane-1")
  })

  it("uses the panel-bound state and overlays the live group identity", () => {
    const sessionA = createSession("session-a")
    const sessionB = createSession("session-b")
    const dockviewLayout = createDockviewLayout([
      createSessionWorkbenchTab(sessionA.id),
      createSessionWorkbenchTab(sessionB.id),
    ])
    const resolved = buildWorkbenchPanelState(
      buildInput({
        dockviewLayout,
        workspaces: [createWorkspace([sessionA, sessionB])],
      }),
      "group-1",
      "session:session-b",
      null,
    )

    expect(resolved).toMatchObject({
      id: "group-1",
      isFocused: true,
      sessionID: "session-b",
    })
  })

  it("returns null when a Dockview panel has no panel-bound state", () => {
    expect(buildWorkbenchPanelState(buildInput(), "group-1", "session:missing", null)).toBeNull()
  })

  it("keeps unrelated panel selector state equal when another tab draft changes", () => {
    const sessionA = createSession("session-a")
    const sessionB = createSession("session-b")
    const tabA = createSessionWorkbenchTab(sessionA.id)
    const tabB = createSessionWorkbenchTab(sessionB.id)
    const dockviewLayout = createDockviewLayout([tabA, tabB])
    const baseInput = buildInput({
      dockviewLayout,
      workspaces: [createWorkspace([sessionA, sessionB])],
    })
    const nextInput = {
      ...baseInput,
      composerDraftStateByTabKey: {
        [getWorkbenchTabKey(tabB)]: createComposerDraftStateFromPlainText("draft for B"),
      },
    }

    expect(workbenchPaneStatesAreEqual(
      buildWorkbenchPanelState(baseInput, "group-1", getWorkbenchTabKey(tabA), null),
      buildWorkbenchPanelState(nextInput, "group-1", getWorkbenchTabKey(tabA), null),
    )).toBe(true)
    expect(workbenchPaneStatesAreEqual(
      buildWorkbenchPanelState(baseInput, "group-1", getWorkbenchTabKey(tabB), null),
      buildWorkbenchPanelState(nextInput, "group-1", getWorkbenchTabKey(tabB), null),
    )).toBe(false)
  })
})
