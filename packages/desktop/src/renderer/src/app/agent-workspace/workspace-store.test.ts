import { describe, expect, it } from "vitest"
import { createComposerDraftStateFromPlainText } from "../composer/draft-state"
import type { PermissionRequest, WorkspacePreviewState } from "../types"
import { createInitialDockviewLayout } from "../workbench/dockview-state"
import { DEFAULT_SESSION_DIFF_STATE, DEFAULT_WORKSPACE_FILE_REVIEW_STATE, DEFAULT_WORKSPACE_PREVIEW_STATE } from "./review-preview-state"
import { createWorkspaceStore } from "./workspace-store"

function createTestStore(options?: {
  initialComposerTabKey?: string | null
  initialDockviewLayout?: ReturnType<typeof createInitialDockviewLayout> | null
}) {
  return createWorkspaceStore({
    hasFolderWorkspaceLoader: false,
    initialComposerTabKey: options?.initialComposerTabKey ?? null,
    initialCreateSessionTab: null,
    initialDockviewLayout: options?.initialDockviewLayout ?? null,
  })
}

describe("workspace store", () => {
  it("updates dockview layout through value and functional actions", () => {
    const store = createTestStore()
    const nextLayout = createInitialDockviewLayout({ kind: "session", sessionID: "session-1" })

    store.getState().workbenchActions.setDockviewLayout(nextLayout)
    expect(store.getState().workbench.dockviewLayout?.activeGroup).toBe(nextLayout.activeGroup)

    store.getState().workbenchActions.setDockviewLayout((current) => current && ({
      ...current,
      activeGroup: undefined,
    }))

    expect(store.getState().workbench.dockviewLayout?.activeGroup).toBeUndefined()
  })

  it("keeps composer draft, attachment, and sending state isolated by tab", () => {
    const store = createTestStore({ initialComposerTabKey: "session:alpha" })
    const betaDraft = createComposerDraftStateFromPlainText("Follow up")

    store.getState().composerActions.setComposerDraftStateByTabKey((current) => ({
      ...current,
      "session:beta": betaDraft,
    }))
    store.getState().composerActions.setComposerAttachmentsByTabKey({
      "session:beta": [{ path: "C:/tmp/a.png", name: "a.png" }],
    })
    store.getState().composerActions.setIsSendingByTabKey({
      "session:beta": true,
    })

    expect(store.getState().composer.composerDraftStateByTabKey["session:alpha"]).toBeDefined()
    expect(store.getState().composer.composerDraftStateByTabKey["session:beta"]).toBe(betaDraft)
    expect(store.getState().composer.composerAttachmentsByTabKey["session:alpha"]).toBeUndefined()
    expect(store.getState().composer.composerAttachmentsByTabKey["session:beta"]).toHaveLength(1)
    expect(store.getState().composer.isSendingByTabKey["session:beta"]).toBe(true)
  })

  it("opens, focuses, updates, and closes dynamic right sidebar tabs", () => {
    const store = createTestStore()

    const filesTabID = store.getState().sessionsActions.openOrFocusRightSidebarTab({
      kind: "files",
      filePath: "src/App.tsx",
      scopeDirectory: "C:/work/project",
      scopeName: "Project",
      title: "App.tsx",
    })
    const browserTabID = store.getState().sessionsActions.openOrFocusRightSidebarTab({
      kind: "browser",
      target: "http://localhost:3000",
      workspaceID: "workspace-1",
      workspaceRoot: "C:/work/project",
      title: "localhost:3000",
    })
    const messageTreeTabID = store.getState().sessionsActions.openOrFocusRightSidebarTab({
      kind: "message-tree",
      sessionID: "session-1",
      title: "Tree",
    })

    expect(store.getState().sessions.rightSidebar.tabs).toHaveLength(3)
    expect(store.getState().sessions.rightSidebar.activeTabID).toBe(messageTreeTabID)

    const focusedFilesTabID = store.getState().sessionsActions.openOrFocusRightSidebarTab({
      kind: "files",
      filePath: "src/App.tsx",
      scopeDirectory: "C:/work/project",
      scopeName: "Project",
    })

    expect(focusedFilesTabID).toBe(filesTabID)
    expect(store.getState().sessions.rightSidebar.tabs).toHaveLength(3)
    expect(store.getState().sessions.rightSidebar.activeTabID).toBe(filesTabID)

    const focusedMessageTreeTabID = store.getState().sessionsActions.openOrFocusRightSidebarTab({
      kind: "message-tree",
      sessionID: "session-1",
    })

    expect(focusedMessageTreeTabID).toBe(messageTreeTabID)
    expect(store.getState().sessions.rightSidebar.tabs).toHaveLength(3)
    expect(store.getState().sessions.rightSidebar.activeTabID).toBe(messageTreeTabID)

    store.getState().sessionsActions.setRightSidebarFileState(filesTabID, (current) => ({
      ...current,
      query: "App",
    }))
    store.getState().sessionsActions.updateRightSidebarTab(filesTabID, {
      title: "Renamed",
    })
    store.getState().sessionsActions.updateRightSidebarTab(messageTreeTabID, {
      title: "Session tree",
    })

    const filesTab = store.getState().sessions.rightSidebar.tabs.find((tab) => tab.id === filesTabID)
    const messageTreeTab = store.getState().sessions.rightSidebar.tabs.find((tab) => tab.id === messageTreeTabID)
    expect(filesTab?.title).toBe("Renamed")
    expect(filesTab?.kind === "files" ? filesTab.state.query : "").toBe("App")
    expect(messageTreeTab?.title).toBe("Session tree")
    expect(messageTreeTab?.kind === "message-tree" ? messageTreeTab.sessionID : null).toBe("session-1")

    store.getState().sessionsActions.closeRightSidebarTab(filesTabID)

    expect(store.getState().sessions.rightSidebar.tabs.map((tab) => tab.id)).toEqual([browserTabID, messageTreeTabID])
    expect(store.getState().sessions.rightSidebar.activeTabID).toBe(messageTreeTabID)

    store.getState().sessionsActions.closeRightSidebarTab(messageTreeTabID)

    expect(store.getState().sessions.rightSidebar.tabs.map((tab) => tab.id)).toEqual([browserTabID])
    expect(store.getState().sessions.rightSidebar.activeTabID).toBe(browserTabID)

    store.getState().sessionsActions.closeRightSidebarTab(browserTabID)

    expect(store.getState().sessions.rightSidebar.tabs).toEqual([])
    expect(store.getState().sessions.rightSidebar.activeTabID).toBeNull()
  })

  it("reuses one contextual message inspector tab and updates its inspected message", () => {
    const store = createTestStore()

    const firstTabID = store.getState().sessionsActions.openOrFocusRightSidebarTab({
      kind: "message-inspector",
      messageID: "message-1",
      sessionID: "session-1",
      title: "Conversation",
    })
    const focusedTabID = store.getState().sessionsActions.openOrFocusRightSidebarTab({
      kind: "message-inspector",
      messageID: "message-2",
      sessionID: "session-2",
      title: "Conversation",
    })
    store.getState().sessionsActions.updateRightSidebarTab(focusedTabID, {
      messageID: "message-2",
      sessionID: "session-2",
    })

    expect(focusedTabID).toBe(firstTabID)
    expect(store.getState().sessions.rightSidebar.tabs).toHaveLength(1)
    const inspectorTab = store.getState().sessions.rightSidebar.tabs[0]
    expect(inspectorTab?.kind).toBe("message-inspector")
    expect(inspectorTab?.kind === "message-inspector" ? inspectorTab.messageID : null).toBe("message-2")
    expect(inspectorTab?.kind === "message-inspector" ? inspectorTab.sessionID : null).toBe("session-2")
  })

  it("keeps draft branch chats independent and focuses an already-open committed leaf", () => {
    const store = createTestStore()

    const firstDraftID = store.getState().sessionsActions.openOrFocusRightSidebarTab({
      kind: "branch-thread",
      sessionID: "session-1",
      originMessageID: "response-1",
    })
    const secondDraftID = store.getState().sessionsActions.openOrFocusRightSidebarTab({
      kind: "branch-thread",
      sessionID: "session-1",
      originMessageID: "response-1",
    })

    expect(secondDraftID).not.toBe(firstDraftID)
    expect(store.getState().sessions.rightSidebar.tabs).toHaveLength(2)

    store.getState().sessionsActions.updateRightSidebarTab(firstDraftID, {
      phase: "committed",
      headMessageID: "branch-response-1",
      title: "Investigate the branch",
    })

    const reopenedID = store.getState().sessionsActions.openOrFocusRightSidebarTab({
      kind: "branch-thread",
      sessionID: "session-1",
      originMessageID: "response-1",
      headMessageID: "branch-response-1",
      phase: "committed",
    })

    expect(reopenedID).toBe(firstDraftID)
    expect(store.getState().sessions.rightSidebar.tabs).toHaveLength(2)
    expect(store.getState().sessions.rightSidebar.activeTabID).toBe(firstDraftID)

    const committed = store.getState().sessions.rightSidebar.tabs.find((tab) => tab.id === firstDraftID)
    expect(committed?.kind).toBe("branch-thread")
    expect(committed?.kind === "branch-thread" ? committed.headMessageID : null).toBe("branch-response-1")
    expect(committed?.kind === "branch-thread" ? committed.executionID : null).toBe(firstDraftID)
    expect(committed?.kind === "branch-thread" ? committed.anchorStrategy : null).toBe("selected")
  })

  it("stores the send-time strategy and preserves it across provisional start updates", () => {
    const store = createTestStore()
    const tabID = store.getState().sessionsActions.openOrFocusRightSidebarTab({
      kind: "branch-thread",
      anchorStrategy: "latest-at-send",
      sessionID: "session-1",
      originMessageID: "response-1",
    })

    store.getState().sessionsActions.updateRightSidebarTab(tabID, {
      originMessageID: "response-2",
      headMessageID: "response-2",
    })

    const tab = store.getState().sessions.rightSidebar.tabs.find(
      (candidate) => candidate.id === tabID,
    )
    expect(tab?.kind === "branch-thread" ? tab.anchorStrategy : null).toBe("latest-at-send")
    expect(tab?.kind === "branch-thread" ? tab.originMessageID : null).toBe("response-2")
  })

  it("starts without seed workspaces while the desktop workspace loader is available", () => {
    const store = createWorkspaceStore({
      hasFolderWorkspaceLoader: true,
      initialComposerTabKey: null,
      initialCreateSessionTab: null,
      initialDockviewLayout: null,
    })

    expect(store.getState().sessions.workspaces).toEqual([])
    expect(store.getState().sessions.selectedFolderID).toBeNull()
    expect(store.getState().sessions.expandedFolderIDs).toEqual([])
    expect(store.getState().sessions.isInitialWorkspaceLoadPending).toBe(true)
    expect(store.getState().agentStream.conversations).toEqual({})
  })

  it("starts with the seed selected workspace expanded when seed data is used", () => {
    const store = createTestStore()

    expect(store.getState().sessions.selectedFolderID).not.toBeNull()
    expect(store.getState().sessions.expandedFolderIDs).toEqual([
      store.getState().sessions.selectedFolderID,
    ])
  })

  it("tracks stream permissions and request lifecycle state", () => {
    const store = createTestStore()
    const permissionRequest = {
      id: "approval-1",
      status: "pending",
    } as PermissionRequest

    store.getState().agentStreamActions.setAgentSessions({
      "session-1": "backend-1",
    })
    store.getState().agentStreamActions.setPendingPermissionRequestsBySession({
      "session-1": [permissionRequest],
    })
    store.getState().agentStreamActions.setPermissionRequestActionRequestID("approval-1")

    expect(store.getState().agentStream.agentSessions["session-1"]).toBe("backend-1")
    expect(store.getState().agentStream.pendingPermissionRequestsBySession["session-1"]).toEqual([permissionRequest])
    expect(store.getState().agentStream.permissionRequestActionRequestID).toBe("approval-1")
  })

  it("updates review, preview, and file comment state independently", () => {
    const store = createTestStore()
    const preview: WorkspacePreviewState = {
      ...DEFAULT_WORKSPACE_PREVIEW_STATE,
      activeInteractionID: null,
      committedUrl: null,
      draftUrl: "http://localhost:5173",
      draftTarget: "http://localhost:5173",
      errorKind: null,
      errorMessage: null,
      interactions: [],
      navigationHistory: [],
      navigationIndex: -1,
      reloadToken: 1,
    }

    store.getState().reviewActions.setPreviewByWorkspaceID({
      "workspace-1": preview,
    })
    store.getState().reviewActions.setSessionDiffStateBySession({
      "session-1": {
        ...DEFAULT_SESSION_DIFF_STATE,
        isStale: true,
      },
    })
    store.getState().reviewActions.setWorkspaceFileReviewState({
      ...DEFAULT_WORKSPACE_FILE_REVIEW_STATE,
      query: "App.tsx",
    })

    expect(store.getState().review.previewByWorkspaceID["workspace-1"]).toBe(preview)
    expect(store.getState().review.sessionDiffStateBySession["session-1"]?.isStale).toBe(true)
    expect(store.getState().review.workspaceFileReviewState.query).toBe("App.tsx")
  })
})
