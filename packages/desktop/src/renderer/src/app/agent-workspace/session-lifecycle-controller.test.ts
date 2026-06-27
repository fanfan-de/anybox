import { act, renderHook } from "@testing-library/react"
import { useRef, useState, type MouseEvent } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { PendingAgentStream, SessionSummary, SideChatLink, WorkspaceGroup } from "../types"
import { createSessionDataLoadCache } from "./session-data-load-cache"
import {
  filterSideChatMappingForCleanup,
  removePendingStreamsForSessions,
  removeSubscribedSessionStreamsForCleanup,
  sideChatLinkHasRealResponse,
  useSessionLifecycleController,
} from "./session-lifecycle-controller"

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
      name: id,
      worktree: `C:/work/${id}`,
    },
    sessions,
  }
}

function useProjectClickHarness(
  focusSession = vi.fn(),
  input: {
    agentDefaultDirectory?: string
    focusExistingCreateSessionTabAcrossPanes?: (preferredWorkspaceID?: string | null) => boolean
    openCreateSessionTab?: (preferredWorkspaceID?: string | null, paneID?: string | null, workspaceScope?: WorkspaceGroup[]) => void
    refreshWorkspaceFromDirectory?: (directory: string) => Promise<WorkspaceGroup | null>
    setWorkspaces?: Parameters<typeof useSessionLifecycleController>[0]["setWorkspaces"]
    workspaces?: WorkspaceGroup[]
  } = {},
) {
  const workspace = createWorkspace("workspace-1", [createSession("session-1")])
  const workspaces = input.workspaces ?? [workspace]
  const [selectedFolderID, setSelectedFolderID] = useState<string | null>(null)
  const [expandedFolderIDs, setExpandedFolderIDs] = useState<string[]>([])
  const noop = vi.fn()
  const setWorkspaces = input.setWorkspaces ?? noop
  const focusExistingCreateSessionTabAcrossPanes = input.focusExistingCreateSessionTabAcrossPanes ?? vi.fn(() => false)
  const openCreateSessionTab = input.openCreateSessionTab ?? vi.fn()

  const controller = useSessionLifecycleController({
    activeCreateSessionTab: null,
    activeCreateSessionTabID: null,
    agentDefaultDirectory: input.agentDefaultDirectory ?? "C:/work/default-chat",
    activeSessionID: "session-outside-workspace",
    activeSideChatSessionIDByParentSessionID: {},
    activeWorkspace: null,
    agentSessionStoreRef: useRef({ dispatch: vi.fn() }),
    canLoadSessionHistory: true,
    conversationVersionRef: useRef({}),
    createSessionTabs: [],
    createSessionWorkspaceID: null,
    deletingSessionID: null,
    dockviewLayout: null,
    expandedFolderIDs,
    focusExistingCreateSessionTabAcrossPanes,
    focusSession,
    focusedPane: null,
    focusedPaneID: null,
    handleCreateSessionWorkspaceChange: vi.fn(),
    historyRequestRef: useRef({}),
    initialFolderWorkspacesLoadedRef: useRef(true),
    isCreateSessionTabActive: false,
    isCreatingProject: false,
    isCreatingSessionByTabKey: {},
    lastFocusedSessionIDRef: useRef(null),
    ensurePendingPermissionRequestsLoaded: vi.fn(async () => {}),
    ensureSessionHistoryLoaded: vi.fn(async () => {}),
    openCreateSessionTab,
    openOrFocusRightSidebarTab: vi.fn(() => "tab-1"),
    pendingStreamsRef: useRef({}),
    permissionRequestsRequestRef: useRef({}),
    preserveLocalWorkspaceStateOnInitialLoadRef: useRef(false),
    runtimeDebugRequestRef: useRef({}),
    sessionDiffRequestRef: useRef({}),
    sessionDataLoadCacheRef: useRef(createSessionDataLoadCache()),
    sessionEventRouterRef: useRef({ cleanupUISession: vi.fn() }),
    setActiveSideChatSessionIDByParentSessionID: noop,
    setAgentSessions: noop,
    setCanLoadSessionHistory: noop,
    setComposerAttachmentsByTabKey: noop,
    setComposerDraftStateByTabKey: noop,
    setComposerParentMessageIDByTabKey: noop,
    setContextUsageBySession: noop,
    setConversations: noop,
    setCreateSessionTabs: noop,
    setDeletingSessionID: noop,
    setDockviewLayout: noop,
    setExpandedFolderIDs,
    setHoveredFolderID: noop,
    setIsCreatingProject: noop,
    setIsCreatingSessionByTabKey: noop,
    setIsSendingByTabKey: noop,
    setMessageTreeBySession: noop,
    setPendingPermissionRequestsBySession: noop,
    setSelectedDiffFileBySession: noop,
    setSelectedFolderID,
    setSessionDiffBySession: noop,
    setSessionDiffStateBySession: noop,
    setSessionDirectoryBySession: noop,
    setSessionRuntimeDebugBySession: noop,
    setSessionRuntimeDebugStateBySession: noop,
    setSessionTasksBySession: noop,
    setWorkspaces,
    refreshWorkspaceFromDirectory: input.refreshWorkspaceFromDirectory ?? vi.fn(async () => workspace),
    updateRightSidebarTab: noop,
    clearRuntimeDebugRefreshTimer: noop,
    clearSessionDiffRefreshTimer: noop,
    selectedFolderID,
    skipNextHistoryLoadRef: useRef({}),
    subscribedSessionStreamsRef: useRef({}),
    workbenchDockviewCommandsRef: useRef(null),
    workspaces,
  })

  return {
    controller,
    expandedFolderIDs,
    focusExistingCreateSessionTabAcrossPanes,
    openCreateSessionTab,
    selectedFolderID,
    setWorkspaces,
    workspace,
  }
}

describe("session lifecycle cleanup helpers", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    delete (window as typeof window & { desktop?: unknown }).desktop
  })

  it("toggles folder expansion without focusing a session when the project row is clicked", () => {
    const focusSession = vi.fn()
    const { result } = renderHook(() => useProjectClickHarness(focusSession))

    act(() => {
      result.current.controller.handleProjectClick(result.current.workspace)
    })

    expect(result.current.selectedFolderID).toBe("workspace-1")
    expect(result.current.expandedFolderIDs).toEqual(["workspace-1"])
    expect(focusSession).not.toHaveBeenCalled()

    act(() => {
      result.current.controller.handleProjectClick(result.current.workspace)
    })

    expect(result.current.selectedFolderID).toBe("workspace-1")
    expect(result.current.expandedFolderIDs).toEqual([])
    expect(focusSession).not.toHaveBeenCalled()
  })

  it("refreshes a worktree directory before creating a session there", async () => {
    const focusSession = vi.fn()
    const refreshedWorkspace = createWorkspace("worktree-1", [])
    refreshedWorkspace.directory = "C:/work/worktree-1"
    refreshedWorkspace.project.id = "project-workspace-1"
    const refreshWorkspaceFromDirectory = vi.fn(async () => refreshedWorkspace)
    const createFolderSession = vi.fn(async () => ({
      session: {
        id: "session-worktree",
        projectID: "project-workspace-1",
        directory: "C:/work/worktree-1",
        title: "Worktree session",
        created: 1,
        updated: 2,
      },
    }))
    Object.defineProperty(window, "desktop", {
      configurable: true,
      writable: true,
      value: {
        createFolderSession,
      },
    })

    const { result } = renderHook(() => useProjectClickHarness(focusSession, { refreshWorkspaceFromDirectory }))

    await act(async () => {
      await result.current.controller.handleCreateSessionForDirectory("project-workspace-1", "C:/work/worktree-1")
    })

    expect(refreshWorkspaceFromDirectory).toHaveBeenCalledWith("C:/work/worktree-1")
    expect(createFolderSession).toHaveBeenCalledWith({
      projectID: "project-workspace-1",
      directory: "C:/work/worktree-1",
      title: undefined,
    })
    expect(focusSession).toHaveBeenCalledWith("worktree-1", "session-worktree", undefined)
  })

  it("opens a create-session tab for an existing default conversation workspace", async () => {
    const openCreateSessionTab = vi.fn()
    const { result } = renderHook(() => useProjectClickHarness(vi.fn(), {
      agentDefaultDirectory: "C:/work/workspace-1",
      openCreateSessionTab,
    }))

    await act(async () => {
      await result.current.controller.handleSidebarAction("conversation")
    })

    expect(result.current.selectedFolderID).toBe("workspace-1")
    expect(result.current.expandedFolderIDs).toEqual(["workspace-1"])
    expect(openCreateSessionTab).toHaveBeenCalledWith(
      "workspace-1",
      null,
      expect.any(Array),
    )
  })

  it("loads the default conversation workspace before opening the composer", async () => {
    const loadedWorkspace = {
      id: "C:/default-chat",
      name: "default-chat",
      directory: "C:/default-chat",
      created: 1,
      updated: 1,
      project: {
        id: "project-default-chat",
        name: "default-chat",
        worktree: "C:/default-chat",
      },
      sessions: [],
    }
    const openFolderWorkspace = vi.fn(async () => loadedWorkspace)
    Object.defineProperty(window, "desktop", {
      configurable: true,
      writable: true,
      value: {
        openFolderWorkspace,
      },
    })

    const openCreateSessionTab = vi.fn()
    const { result } = renderHook(() => useProjectClickHarness(vi.fn(), {
      agentDefaultDirectory: "C:/default-chat",
      openCreateSessionTab,
      workspaces: [],
    }))

    await act(async () => {
      await result.current.controller.handleSidebarAction("conversation")
    })

    expect(openFolderWorkspace).toHaveBeenCalledWith({ directory: "C:/default-chat" })
    expect(result.current.selectedFolderID).toBe("C:/default-chat")
    expect(openCreateSessionTab).toHaveBeenCalledWith(
      "C:/default-chat",
      null,
      expect.arrayContaining([expect.objectContaining({ id: "C:/default-chat" })]),
    )
  })

  it("keeps the default conversation workspace from being removed", () => {
    const setWorkspaces = vi.fn()
    const { result } = renderHook(() => useProjectClickHarness(vi.fn(), {
      agentDefaultDirectory: "C:/work/workspace-1",
      setWorkspaces,
    }))
    const event = { stopPropagation: vi.fn() } as unknown as MouseEvent<HTMLButtonElement>

    act(() => {
      result.current.controller.handleProjectRemove(result.current.workspace, event)
    })

    expect(event.stopPropagation).toHaveBeenCalledTimes(1)
    expect(setWorkspaces).not.toHaveBeenCalled()
  })

  it("removes side chat mappings when either parent or side chat session is cleaned up", () => {
    const mapping = {
      "parent-1": "side-1",
      "parent-2": "side-2",
      "parent-3": "side-3",
    }

    expect(filterSideChatMappingForCleanup(mapping, new Set(["parent-1", "side-2"]))).toEqual({
      "parent-3": "side-3",
    })
  })

  it("keeps side chat mapping object identity when no entries are removed", () => {
    const mapping = {
      "parent-1": "side-1",
    }

    expect(filterSideChatMappingForCleanup(mapping, new Set(["unrelated"]))).toBe(mapping)
  })

  it("removes pending streams owned by cleaned sessions", () => {
    const pendingStreams: Record<string, PendingAgentStream> = {
      "stream-1": {
        sessionID: "session-1",
        assistantThreadMessageID: "assistant-1",
      },
      "stream-2": {
        sessionID: "session-2",
        assistantThreadMessageID: "assistant-2",
      },
    }

    removePendingStreamsForSessions(pendingStreams, new Set(["session-1"]))

    expect(pendingStreams).toEqual({
      "stream-2": {
        sessionID: "session-2",
        assistantThreadMessageID: "assistant-2",
      },
    })
  })

  it("collects and removes subscribed streams by UI session id", () => {
    const subscribed = {
      "ui-session-1": "backend-session-1",
      "ui-session-2": "backend-session-2",
    }

    const backendSessionIDs = removeSubscribedSessionStreamsForCleanup(subscribed, new Set(["ui-session-1"]))

    expect([...backendSessionIDs]).toEqual(["backend-session-1"])
    expect(subscribed).toEqual({
      "ui-session-2": "backend-session-2",
    })
  })

  it("collects and removes subscribed streams by backend session id without duplicates", () => {
    const subscribed = {
      "ui-session-1": "backend-session-1",
      "backend-session-1": "backend-session-1",
      "ui-session-2": "backend-session-2",
    }

    const backendSessionIDs = removeSubscribedSessionStreamsForCleanup(subscribed, new Set(["backend-session-1"]))

    expect([...backendSessionIDs]).toEqual(["backend-session-1"])
    expect(subscribed).toEqual({
      "ui-session-2": "backend-session-2",
    })
  })

  it("detects whether side chat link snapshots contain a real response", () => {
    const createLink = (assistantText: string): SideChatLink => ({
      sessionID: "side-1",
      parentSessionID: "parent-1",
      anchorMessageID: "assistant-1",
      createdAt: 1,
      anchorPreview: "Parent response",
      snapshotVersion: 1,
      snapshot: {
        assistantText,
      },
    })

    expect(sideChatLinkHasRealResponse(createLink(""))).toBe(false)
    expect(sideChatLinkHasRealResponse(createLink("   "))).toBe(false)
    expect(sideChatLinkHasRealResponse(createLink("<!-- anybox-response-format: markdown -->"))).toBe(false)
    expect(sideChatLinkHasRealResponse(createLink("<!-- anybox-response-format: markdown -->\nA real answer."))).toBe(true)
  })
})
