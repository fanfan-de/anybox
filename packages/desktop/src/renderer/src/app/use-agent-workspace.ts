import { useCallback, useEffect, useRef } from "react"
import { useComposerController } from "./agent-workspace/composer-controller"
import { useComposerDraftState } from "./agent-workspace/composer-draft-state"
import { useReviewPanelController } from "./agent-workspace/review-panel-controller"
import { useReviewPreviewState } from "./agent-workspace/review-preview-state"
import { useSessionLifecycleController } from "./agent-workspace/session-lifecycle-controller"
import { useSessionStreamController } from "./agent-workspace/session-stream-controller"
import { useStreamPermissionController } from "./agent-workspace/stream-permission-controller"
import { useWorkbenchState } from "./agent-workspace/workbench-state"
import { useWorkbenchTabController } from "./agent-workspace/workbench-tab-controller"
import {
  buildWorkspaceDerivedState,
  createCreateSessionTab,
  createCreateSessionWorkbenchTab,
  createSessionWorkbenchTab,
  getWorkbenchTabKey,
} from "./agent-workspace/workspace-derived-state"
import { useWorkspaceLoadingController } from "./agent-workspace/workspace-loading-controller"
import { useWorkspaceSessionStore } from "./agent-workspace/workspace-session-store"
import { createWorkspaceStore, seedWorkspaceIDs, type WorkspaceStoreApi } from "./agent-workspace/workspace-store"
import { initialSelection } from "./seed-data"
import { isRendererPerfProfilerEnabled, logRendererPerf, measureRendererPerf } from "./perf-profiler"
import {
  buildRendererSessionMemoryDiagnostics,
  reportRendererMemoryDiagnostics,
  updateRendererCurrentSessionDiagnostics,
} from "./renderer-memory-diagnostics"
import type { LeftSidebarView, SessionDiffSummary, SessionModelSelection, ThreadMessage, WorkspaceGroup } from "./types"
import type { ThreadScrollSnapshot } from "./thread/ThreadView"
import { persistUserMessages } from "./user-message-presentation"
import { findSession, updateSessionInWorkspaces, updateSessionModelSelectionInWorkspaces } from "./workspace"
import {
  createInitialDockviewLayout,
  writePersistedDockviewLayout,
  type WorkbenchDockviewCommands,
} from "./workbench/dockview-state"
import type { DesktopIpcInput, WorkbenchSharedState } from "../../../shared/desktop-ipc-contract"

interface UseAgentWorkspaceOptions {
  agentConnected: boolean
  agentDefaultDirectory: string
  disableDockviewPersistence?: boolean
  initialDockviewLayout?: ReturnType<typeof createInitialDockviewLayout> | null
  initialSessionID?: string | null
  isRuntimeDebugEnabled: boolean
  platform: string
  surfaceID?: string
  workbenchState?: WorkbenchSharedState | null
}

function createInitialWorkspaceState(shouldUseSeedData: boolean) {
  if (!shouldUseSeedData) {
    return {
      initialComposerTabKey: null,
      initialCreateSessionTab: null,
      initialDockviewLayout: null,
    }
  }

  const initialCreateSessionTab = initialSelection.session === null
    ? createCreateSessionTab(initialSelection.workspace?.id ?? null)
    : null
  const initialWorkbenchTab =
    initialSelection.session !== null
      ? createSessionWorkbenchTab(initialSelection.session.id)
      : initialCreateSessionTab
        ? createCreateSessionWorkbenchTab(initialCreateSessionTab.id)
        : null

  return {
    initialComposerTabKey: initialWorkbenchTab ? getWorkbenchTabKey(initialWorkbenchTab) : null,
    initialCreateSessionTab,
    initialDockviewLayout: initialWorkbenchTab ? createInitialDockviewLayout(initialWorkbenchTab) : null,
  }
}

function buildSessionDiffSummarySignature(diffSummary: SessionDiffSummary | undefined) {
  return diffSummary?.diffs
    .map((diff) => `${diff.file}\u0000${diff.additions}\u0000${diff.deletions}\u0000${diff.patch ?? ""}`)
    .join("\u0001") ?? ""
}

function hydrateMessageDiffSummary(
  messages: ThreadMessage[],
  messageID: string,
  diffSummary: SessionDiffSummary,
) {
  let didUpdate = false
  const nextMessages = messages.map((message) => {
    if (message.id !== messageID) return message
    if (buildSessionDiffSummarySignature(message.diffSummary) === buildSessionDiffSummarySignature(diffSummary)) return message

    didUpdate = true
    return {
      ...message,
      diffSummary,
    }
  })

  return didUpdate ? nextMessages : messages
}

function isThreadScrollKeyStale(key: string, validSessionIDs: Set<string>) {
  if (key.startsWith("session:")) {
    return !validSessionIDs.has(key.slice("session:".length))
  }

  if (key.startsWith("side-chat:")) {
    const [, parentSessionID, sideChatSessionID] = key.split(":")
    return !parentSessionID || !sideChatSessionID || !validSessionIDs.has(parentSessionID) || !validSessionIDs.has(sideChatSessionID)
  }

  return false
}

function deleteThreadScrollSnapshotsForSession(
  snapshots: Record<string, ThreadScrollSnapshot>,
  sessionID: string,
) {
  for (const key of Object.keys(snapshots)) {
    if (key === `session:${sessionID}` || key.startsWith(`side-chat:${sessionID}:`) || key.endsWith(`:${sessionID}`)) {
      delete snapshots[key]
    }
  }
}

export function useAgentWorkspace({
  agentConnected,
  agentDefaultDirectory,
  disableDockviewPersistence = false,
  initialDockviewLayout = null,
  initialSessionID = null,
  isRuntimeDebugEnabled,
  platform,
  surfaceID = "main",
  workbenchState = null,
}: UseAgentWorkspaceOptions) {
  const workbenchDockviewCommandsRef = useRef<WorkbenchDockviewCommands | null>(null)
  const dockviewPersistenceTimerRef = useRef<number | null>(null)
  const focusSessionFromAgentEventRef = useRef<(sessionID: string) => void>(() => undefined)
  const threadScrollSnapshotsRef = useRef<Record<string, ThreadScrollSnapshot>>({})
  const workspaceStoreRef = useRef<WorkspaceStoreApi | null>(null)
  const renderStartRef = useRef<number | null>(null)
  if (isRendererPerfProfilerEnabled()) {
    renderStartRef.current = performance.now()
  }
  if (!workspaceStoreRef.current) {
    const hasFolderWorkspaceLoader = Boolean(window.desktop?.listFolderWorkspaces)
    const initialWorkspaceState = createInitialWorkspaceState(!hasFolderWorkspaceLoader)

    workspaceStoreRef.current = createWorkspaceStore({
      hasFolderWorkspaceLoader,
      initialComposerTabKey: initialWorkspaceState.initialComposerTabKey,
      initialCreateSessionTab: initialWorkspaceState.initialCreateSessionTab,
      initialDockviewLayout: initialDockviewLayout ?? initialWorkspaceState.initialDockviewLayout,
    })
  }
  const workspaceStore = workspaceStoreRef.current
  const { dockviewActiveState, dockviewLayout, setDockviewActiveState, setDockviewLayout } = useWorkbenchState({
    store: workspaceStore,
  })
  const handleWorkbenchDockviewCommandsReady = useCallback((commands: WorkbenchDockviewCommands | null) => {
    workbenchDockviewCommandsRef.current = commands
  }, [])
  const readThreadScrollSnapshot = useCallback((key: string) => {
    return threadScrollSnapshotsRef.current[key] ?? null
  }, [])
  const saveThreadScrollSnapshot = useCallback((key: string, snapshot: ThreadScrollSnapshot) => {
    threadScrollSnapshotsRef.current[key] = snapshot
  }, [])
  const clearThreadScrollSnapshotsForSession = useCallback((sessionID: string) => {
    deleteThreadScrollSnapshotsForSession(threadScrollSnapshotsRef.current, sessionID)
  }, [])
  const {
    activeSideChatSessionIDByParentSessionID,
    canLoadSessionHistory,
    createSessionTabs,
    deletingSessionID,
    expandedFolderIDs,
    gitRefreshSuppressedUntilRef,
    hoveredFolderID,
    initialFolderWorkspacesLoadedRef,
    isCreatingProject,
    isInitialWorkspaceLoadPending,
    leftSidebarView,
    pinnedWorkspaceIDs,
    preserveLocalWorkspaceStateOnInitialLoadRef,
    projectRowRefs,
    rightSidebar,
    selectedFolderID,
    sessionCanvasUnreadBySession,
    setActiveSideChatSessionIDByParentSessionID,
    setCanLoadSessionHistory,
    setCreateSessionTabs,
    setDeletingSessionID,
    setExpandedFolderIDs,
    setHoveredFolderID,
    setIsCreatingProject,
    setIsInitialWorkspaceLoadPending,
    setLeftSidebarView,
    setPinnedWorkspaceIDs,
    activateRightSidebarTab,
    closeRightSidebarTab,
    openOrFocusRightSidebarTab,
    setRightSidebarFileState,
    setRightSidebarPreviewState,
    updateRightSidebarTab,
    setSelectedFolderID,
    setSessionCanvasUnreadBySession,
    setWorkspaces,
    watchedWorkspaceDirectoriesKeyRef,
    workspaceRefreshRequestRef,
    workspaceReloadSuppressedUntilRef,
    workspaces,
  } = useWorkspaceSessionStore({ store: workspaceStore })
  const {
    previewByWorkspaceID,
    runtimeDebugRefreshTimerRef,
    runtimeDebugRequestRef,
    selectedDiffFileBySession,
    sessionDiffBySession,
    sessionDiffRefreshTimerRef,
    sessionDiffRequestRef,
    sessionDiffStateBySession,
    sessionRuntimeDebugBySession,
    sessionRuntimeDebugStateBySession,
    sessionTasksBySession,
    setSelectedDiffFileBySession,
    setSessionDiffBySession,
    setSessionDiffStateBySession,
    setSessionRuntimeDebugBySession,
    setSessionRuntimeDebugStateBySession,
    setSessionTasksBySession,
    setWorkspaceFileCommentsByTarget,
    workspaceFileCommentsByTarget,
    workspaceFileReadRequestRef,
    workspaceFileReviewState,
    workspaceFileSearchRequestRef,
  } = useReviewPreviewState(workspaceStore)
  const {
    composerAttachmentsByTabKey,
    composerDraftStateByTabKey,
    composerParentMessageIDByTabKey,
    composerRefreshVersion,
    isCreatingSessionByTabKey,
    isSendingByTabKey,
    setComposerAttachmentsByTabKey,
    setComposerDraftStateByTabKey,
    setComposerParentMessageIDByTabKey,
    setComposerRefreshVersion,
    setIsCreatingSessionByTabKey,
    setIsSendingByTabKey,
  } = useComposerDraftState({ store: workspaceStore })
  const {
    agentSessionStoreRef,
    agentSessions,
    cancellingSessionIDs,
    contextUsageBySession,
    conversationActivityBySession,
    conversationVersionRef,
    conversationStore,
    historyRequestRef,
    lastFocusedSessionIDRef,
    messageTreeBySession,
    pendingConversationInputsBySession,
    pendingPermissionRequestsBySession,
    pendingStreamsRef,
    permissionRequestActionError,
    permissionRequestActionRequestID,
    permissionRequestsRequestRef,
    sessionDataLoadCacheRef,
    sessionDirectoryBySession,
    sessionEventRouterRef,
    setAgentSessions,
    setCancellingSessionIDs,
    setContextUsageBySession,
    setConversations,
    setMessageTreeBySession,
    setPendingConversationInputsBySession,
    setPendingPermissionRequestsBySession,
    setPermissionRequestActionError,
    setPermissionRequestActionRequestID,
    setSessionDirectoryBySession,
    skipNextHistoryLoadRef,
    subscribedSessionStreamsRef,
  } = useStreamPermissionController({ initialSessionID: initialSelection.session?.id ?? null, store: workspaceStore })
  const workspaceDerivedState = measureRendererPerf("useAgentWorkspace.buildWorkspaceDerivedState", () => buildWorkspaceDerivedState({
    activeSideChatSessionIDByParentSessionID,
    composerAttachmentsByTabKey,
    composerDraftStateByTabKey,
    composerParentMessageIDByTabKey,
    contextUsageBySession,
    conversationActivityBySession,
    conversations: conversationStore.getConversations(),
    createSessionTabs,
    isCreatingSessionByTabKey,
    isInitialWorkspaceLoadPending,
    isSendingByTabKey,
    cancellingSessionIDs,
    messageTreeBySession,
    pendingPermissionRequestsBySession,
    pendingConversationInputsBySession,
    platform,
    includeWorkbenchSurfaces: false,
    previewByWorkspaceID,
    selectedDiffFileBySession,
    selectedFolderID,
    sessionDiffBySession,
    sessionDiffStateBySession,
    sessionDirectoryBySession,
    sessionRuntimeDebugBySession,
    sessionRuntimeDebugStateBySession,
    sessionTasksBySession,
    seedWorkspaceIDs,
    dockviewActiveState,
    dockviewLayout,
    workspaceFileCommentsByTarget,
    workspaceFileReviewState,
    workspaces,
  }), () => ({
    activeGroupID: dockviewActiveState.activeGroupID,
    activePanelCount: Object.keys(dockviewActiveState.activePanelIDByGroupID).length,
    workspaceCount: workspaces.length,
    sessionCount: workspaces.reduce((count, workspace) => count + workspace.sessions.length, 0),
  }))

  const {
    activeCreateSessionTab,
    activeCreateSessionTabID,
    activePendingConversationInputs,
    activePendingPermissionRequests,
    activePreviewState,
    activeSession,
    activeSessionContextUsage,
    activeSessionDiff,
    activeSessionDiffState,
    activeSessionDirectory,
    activeSessionID,
    activeSessionIsSideChat,
    activeSessionRuntimeDebug,
    activeSessionRuntimeDebugState,
    activeSessionSelectedDiffFile,
    activeSideChatAttachments,
    activeSideChatCountsByAnchorMessageID,
    activeSideChatDraftState,
    activeSideChatIsCancelling,
    activeSideChatIsInterruptible,
    activeSideChatIsSending,
    activeSideChatPendingInputs,
    activeSideChatPendingPermissionRequests,
    activeSideChatSession,
    activeSideChatSessionsByAnchorMessageID,
    activeSideChatTabKey,
    activeSideChatMessages,
    activeTabKey,
    activeWorkspace,
    activeWorkspaceFileScopeDirectory,
    activeWorkspaceFileScopeName,
    activeWorkspaceFileState,
    activeMessages,
    canvasSessionTabs,
    canInsertPreviewInteractionsIntoDraft,
    canInsertWorkspaceFileCommentsIntoDraft,
    composerAttachments,
    createSessionTitle,
    createSessionWorkspaceID,
    draftState,
    focusedPane,
    focusedPaneID,
    isCreateSessionTabActive,
    isCancelling,
    isCreatingSession,
    isInterruptible,
    isSending,
    openCanvasSessionIDs,
    runningSessionIDs,
    selectedProjectID,
    selectedWorkspace,
    visibleCanvasSessionIDs,
  } = workspaceDerivedState

  const visibleCanvasSessionKey = visibleCanvasSessionIDs.join("\0")
  const activeMessageTree = activeSessionID ? messageTreeBySession[activeSessionID] ?? null : null

  useEffect(() => {
    const diagnostics = buildRendererSessionMemoryDiagnostics({
      diffSummary: activeSessionDiff,
      messageTree: activeMessageTree,
      sessionID: activeSessionID,
      messages: activeMessages,
    })
    updateRendererCurrentSessionDiagnostics(diagnostics)
    reportRendererMemoryDiagnostics("active-session-update")
  }, [activeMessageTree, activeSessionDiff, activeSessionID, activeMessages])

  useEffect(() => {
    if (!isRendererPerfProfilerEnabled()) return

    const startedAt = renderStartRef.current
    logRendererPerf("useAgentWorkspace.renderToCommit", {
      durationMs: startedAt === null ? null : Number((performance.now() - startedAt).toFixed(2)),
      activeSessionID,
      activeTabKey,
      focusedPaneID,
      visibleCanvasSessionCount: visibleCanvasSessionIDs.length,
    })
  })

  useEffect(() => {
    if (dockviewPersistenceTimerRef.current !== null) {
      window.clearTimeout(dockviewPersistenceTimerRef.current)
      dockviewPersistenceTimerRef.current = null
    }
    if (isInitialWorkspaceLoadPending || disableDockviewPersistence) return

    dockviewPersistenceTimerRef.current = window.setTimeout(() => {
      dockviewPersistenceTimerRef.current = null
      writePersistedDockviewLayout(dockviewLayout)
    }, 200)

    return () => {
      if (dockviewPersistenceTimerRef.current !== null) {
        window.clearTimeout(dockviewPersistenceTimerRef.current)
        dockviewPersistenceTimerRef.current = null
      }
    }
  }, [disableDockviewPersistence, dockviewLayout, isInitialWorkspaceLoadPending])

  useEffect(() => {
    const visibleSessionIDs = new Set(visibleCanvasSessionIDs)
    const validSessionIDs = new Set(
      workspaces.flatMap((workspace) => workspace.sessions.map((session) => session.id)),
    )

    setSessionCanvasUnreadBySession((current) => {
      let changed = false
      const next: Record<string, boolean> = {}

      for (const [sessionID, unread] of Object.entries(current)) {
        if (!unread || visibleSessionIDs.has(sessionID) || !validSessionIDs.has(sessionID)) {
          changed = true
          continue
        }

        next[sessionID] = unread
      }

      return changed ? next : current
    })
  }, [setSessionCanvasUnreadBySession, visibleCanvasSessionKey, workspaces])

  useEffect(() => {
    const validSessionIDs = new Set(
      workspaces.flatMap((workspace) => workspace.sessions.map((session) => session.id)),
    )

    for (const key of Object.keys(threadScrollSnapshotsRef.current)) {
      if (isThreadScrollKeyStale(key, validSessionIDs)) {
        delete threadScrollSnapshotsRef.current[key]
      }
    }
  }, [workspaces])

  function markSessionCanvasUnread(sessionID: string) {
    if (visibleCanvasSessionIDs.includes(sessionID)) return
    if (!workspaces.some((workspace) => workspace.sessions.some((session) => session.id === sessionID))) return

    setSessionCanvasUnreadBySession((current) => (
      current[sessionID]
        ? current
        : {
            ...current,
            [sessionID]: true,
          }
    ))
  }

  const streamController = useSessionStreamController({
    agentConnected,
    agentDefaultDirectory,
    agentSessionStoreRef,
    agentSessions,
    canLoadSessionHistory,
    contextUsageBySession,
    conversationVersionRef,
    conversationStore,
    historyRequestRef,
    isRuntimeDebugEnabled,
    openCanvasSessionIDs,
    visibleCanvasSessionIDs,
    onFocusSession: (sessionID) => {
      focusSessionFromAgentEventRef.current(sessionID)
    },
    onSessionCanvasActivity: markSessionCanvasUnread,
    pendingStreamsRef,
    pendingConversationInputsBySession,
    permissionRequestsRequestRef,
    platform,
    runtimeDebugRefreshTimerRef,
    runtimeDebugRequestRef,
    sessionDiffBySession,
    sessionDiffRefreshTimerRef,
    sessionDiffRequestRef,
    sessionDirectoryBySession,
    sessionDataLoadCacheRef,
    sessionEventRouterRef,
    sessionRuntimeDebugBySession,
    setAgentSessions,
    setCancellingSessionIDs,
    setCanLoadSessionHistory,
    setContextUsageBySession,
    setConversations,
    setMessageTreeBySession,
    setPendingConversationInputsBySession,
    setPendingPermissionRequestsBySession,
    setSessionDiffBySession,
    setSessionDiffStateBySession,
    setSessionDirectoryBySession,
    setSessionRuntimeDebugBySession,
    setSessionRuntimeDebugStateBySession,
    setSessionTasksBySession,
    setWorkspaces,
    skipNextHistoryLoadRef,
    subscribedSessionStreamsRef,
    workspaceRefreshRequestRef,
    workspaces,
  })
  const {
    appendConversationMessages,
    replaceConversationMessages,
    clearRuntimeDebugRefreshTimer,
    clearSessionDiffRefreshTimer,
    ensurePendingPermissionRequestsLoaded,
    ensureSessionHistoryLoaded,
    loadPendingPermissionRequestsForSession,
    loadSessionDiffForSession,
    loadSessionRuntimeDebugForSession,
    refreshWorkspaceForSession,
    refreshWorkspaceFromDirectory,
    reloadSessionHistoryForSession,
    resolveBackendSessionID,
    scheduleSessionDiffRefreshForSession,
    updateAssistantConversationMessage,
  } = streamController

  useWorkspaceLoadingController({
    activeSessionDirectory,
    activeSessionID,
    activeWorkspace,
    createCreateSessionTab,
    createCreateSessionWorkbenchTab,
    createSessionWorkbenchTab,
    gitRefreshSuppressedUntilRef,
    initialFolderWorkspacesLoadedRef,
    initialDockviewLayout,
    initialSessionID,
    isInitialWorkspaceLoadPending,
    lastFocusedSessionIDRef,
    platform,
    preserveLocalWorkspaceStateOnInitialLoadRef,
    refreshWorkspaceFromDirectory,
    scheduleSessionDiffRefreshForSession,
    setAgentSessions,
    setCanLoadSessionHistory,
    setConversations,
    setCreateSessionTabs,
    setExpandedFolderIDs,
    setIsInitialWorkspaceLoadPending,
    setSelectedFolderID,
    setSessionDiffStateBySession,
    setSessionDirectoryBySession,
    setDockviewLayout,
    setWorkspaces,
    watchedWorkspaceDirectoriesKeyRef,
    workspaceReloadSuppressedUntilRef,
    workspaces,
  })

  const {
    focusExistingCreateSessionTabAcrossPanes,
    focusSession,
    handleCanvasSessionTabClose,
    handleCanvasSessionTabSelect,
    handleCloseCreateSessionTab,
    handleCreateSessionTabSelect,
    handleCreateSessionTitleChange,
    handleCreateSessionWorkspaceChange,
    handleOpenCreateSessionTab,
    handleDockviewActiveChange,
    handleMovePanelIntoSurface,
    handleMovePanelOutOfSurface,
    handlePaneFocus,
    handlePaneSplit,
    handlePaneTabDrop,
    handleSplitResize,
    openCreateSessionTab,
  } = useWorkbenchTabController({
    activeCreateSessionTab,
    activeCreateSessionTabID,
    activeSessionID,
    activeWorkspace,
    createSessionTabs,
    dockviewActiveState,
    dockviewLayout,
    focusedPane,
    focusedPaneID,
    isCreateSessionTabActive,
    lastFocusedSessionIDRef,
    projectRowRefs,
    selectedFolderID,
    setCreateSessionTabs,
    setDockviewActiveState,
    setDockviewLayout,
    setExpandedFolderIDs,
    setSelectedFolderID,
    surfaceID,
    workbenchDockviewCommandsRef,
    workbenchState,
    workspaces,
  })

  focusSessionFromAgentEventRef.current = (sessionID: string) => {
    const selection = findSession(workspaces, sessionID)
    if (!selection.workspace || !selection.session) {
      console.warn("[desktop] Cannot focus notification session; session is not loaded.", {
        sessionID,
      })
      return
    }

    focusSession(selection.workspace.id, selection.session.id)
  }

  const {
    createSessionForWorkspace,
    handleCreateSessionForDirectory,
    handleCreateSessionSubmit,
    handleCreateSideChatTab,
    handleDeleteSideChatTab,
    handleOpenSideChat,
    handleOpenSideChatInTab,
    handleProjectClick,
    handleProjectArchiveSessions,
    handleProjectCreateSession,
    handleProjectOpenInExplorer,
    handleProjectRemove,
    handleSessionDelete,
    handleSessionSelect,
    handleSelectSideChatTab,
    handleSidebarAction,
  } = useSessionLifecycleController({
    activeCreateSessionTab,
    activeCreateSessionTabID,
    agentDefaultDirectory,
    activeSessionID,
    activeSideChatSessionIDByParentSessionID,
    activeWorkspace,
    agentSessionStoreRef,
    canLoadSessionHistory,
    conversationVersionRef,
    createSessionTabs,
    createSessionWorkspaceID,
    deletingSessionID,
    dockviewLayout,
    expandedFolderIDs,
    focusExistingCreateSessionTabAcrossPanes,
    focusSession,
    focusedPane,
    focusedPaneID,
    handleCreateSessionWorkspaceChange,
    historyRequestRef,
    initialFolderWorkspacesLoadedRef,
    isCreateSessionTabActive,
    isCreatingProject,
    isCreatingSessionByTabKey,
    lastFocusedSessionIDRef,
    ensurePendingPermissionRequestsLoaded,
    ensureSessionHistoryLoaded,
    openCreateSessionTab,
    openOrFocusRightSidebarTab,
    pendingStreamsRef,
    permissionRequestsRequestRef,
    preserveLocalWorkspaceStateOnInitialLoadRef,
    runtimeDebugRequestRef,
    sessionDiffRequestRef,
    sessionDataLoadCacheRef,
    sessionEventRouterRef,
    setActiveSideChatSessionIDByParentSessionID,
    setAgentSessions,
    setCanLoadSessionHistory,
    setComposerAttachmentsByTabKey,
    setComposerDraftStateByTabKey,
    setComposerParentMessageIDByTabKey,
    setContextUsageBySession,
    setConversations,
    setCreateSessionTabs,
    setDeletingSessionID,
    setExpandedFolderIDs,
    setHoveredFolderID,
    setIsCreatingProject,
    setIsCreatingSessionByTabKey,
    setIsSendingByTabKey,
    setMessageTreeBySession,
    setPendingPermissionRequestsBySession,
    setSelectedDiffFileBySession,
    setSelectedFolderID,
    setSessionDiffBySession,
    setSessionDiffStateBySession,
    setSessionDirectoryBySession,
    setSessionRuntimeDebugBySession,
    setSessionRuntimeDebugStateBySession,
    setSessionTasksBySession,
    setDockviewLayout,
    setWorkspaces,
    refreshWorkspaceFromDirectory,
    updateRightSidebarTab,
    clearRuntimeDebugRefreshTimer,
    clearSessionDiffRefreshTimer,
    selectedFolderID,
    skipNextHistoryLoadRef,
    subscribedSessionStreamsRef,
    workbenchDockviewCommandsRef,
    workspaces,
  })

  const {
    handleApproveProposedPlan,
    handleCancelSend,
    handlePermissionRequestResponse,
    handleAskUserQuestionAnswer,
    handlePickComposerAttachments,
    handlePasteComposerImageAttachments,
    handleRemoveComposerAttachment,
    handlePlanModeToggle,
    handleSend,
    setDraft,
    setDraftForTab,
  } = useComposerController({
    activeCreateSessionTabID,
    activeSessionID,
    activeTabKey,
    agentConnected,
    agentDefaultDirectory,
    agentSessions,
    cancellingSessionIDs,
    appendConversationMessages,
    replaceConversationMessages,
    composerParentMessageIDByTabKey,
    composerAttachmentsByTabKey,
    composerDraftStateByTabKey,
    createSessionForWorkspace,
    createSessionTabs,
    getConversationMessages: (sessionID) => conversationStore.getSessionMessages(sessionID),
    isSendingByTabKey,
    loadPendingPermissionRequestsForSession,
    loadSessionDiffForSession,
    loadSessionRuntimeDebugForSession,
    pendingConversationInputsBySession,
    pendingPermissionRequestsBySession,
    pendingStreamsRef,
    permissionRequestActionRequestID,
    permissionRequestsRequestRef,
    platform,
    refreshWorkspaceForSession,
    refreshWorkspaceFromDirectory,
    reloadSessionHistoryForSession,
    sessionDirectoryBySession,
    setAgentSessions,
    setCancellingSessionIDs,
    setComposerAttachmentsByTabKey,
    setComposerDraftStateByTabKey,
    setComposerParentMessageIDByTabKey,
    setCreateSessionTabs,
    setIsSendingByTabKey,
    setPendingConversationInputsBySession,
    setPendingPermissionRequestsBySession,
    setPermissionRequestActionError,
    setPermissionRequestActionRequestID,
    setSessionDirectoryBySession,
    setWorkspaces,
    updateAssistantConversationMessage,
    workspaces,
  })

  const activeRightSidebarTab = rightSidebar.tabs.find((tab) => tab.id === rightSidebar.activeTabID) ?? null
  const rightSidebarTabs = rightSidebar.tabs
  const resolveSessionDirectory = useCallback((sessionID: string | null | undefined) => {
    if (!sessionID) return null
    return sessionDirectoryBySession[sessionID] ?? findSession(workspaces, sessionID).workspace?.directory ?? null
  }, [sessionDirectoryBySession, workspaces])

  const {
    handleActiveSessionDiffFileSelect,
    handleActiveSessionDiffRefresh,
    handleActiveSessionRuntimeDebugRefresh,
    handlePreviewActiveInteractionChange,
    handlePreviewBack,
    handlePreviewCommitInteraction,
    handlePreviewDeleteInteraction,
    handlePreviewDraftUrlChange,
    handlePreviewForward,
    handlePreviewInsertInteractionsIntoDraft,
    handlePreviewOpen,
    handlePreviewOpenExternal,
    handlePreviewOpenTarget,
    handlePreviewOpenUrl,
    handlePreviewReload,
    handleWorkspaceFileCommentCancel,
    handleWorkspaceFileCommentChange,
    handleWorkspaceFileCommentConfirm,
    handleWorkspaceFileCommentStart,
    handleWorkspaceDirectoryLoad,
    handleWorkspaceDirectoryToggle,
    handleWorkspaceFileTreeInvalidate,
    handleWorkspaceFileQueryChange,
    handleWorkspaceFileSelect,
    handleActiveSessionDiffFileRestore,
    handleActiveSessionDiffFilesRestore,
    handleActiveSessionDiffPatchesReverseApply,
  } = useReviewPanelController({
    activeSessionDirectory,
    activeSessionID,
    activeTabKey,
    activeRightSidebarTab,
    activeWorkspaceFileScopeDirectory,
    activeWorkspaceFileScopeName,
    loadSessionDiffForSession,
    loadSessionRuntimeDebugForSession,
    openOrFocusRightSidebarTab,
    platform,
    resolveSessionDirectory,
    rightSidebarTabs,
    selectedWorkspace,
    setComposerDraftStateByTabKey,
    setRightSidebarFileState,
    setRightSidebarPreviewState,
    setSelectedDiffFileBySession,
    setWorkspaceFileCommentsByTarget,
    updateRightSidebarTab,
    workspaceFileCommentsByTarget,
    workspaceFileReadRequestRef,
    workspaceFileSearchRequestRef,
  })

  function handleLeftSidebarViewChange(nextView: LeftSidebarView) {
    setLeftSidebarView(nextView)
  }

  function handleProjectPin(workspace: WorkspaceGroup) {
    setPinnedWorkspaceIDs((current) => [workspace.id, ...current.filter((workspaceID) => workspaceID !== workspace.id)])
  }

  function invalidateProjectComposer() {
    setComposerRefreshVersion((current) => current + 1)
  }

  function refreshComposerModels() {
    invalidateProjectComposer()
  }

  function refreshComposerSkills() {
    invalidateProjectComposer()
  }

  function refreshComposerMcp() {
    invalidateProjectComposer()
  }

  function handleSessionModelSelectionChange(
    sessionID: string,
    selection: SessionModelSelection | undefined,
  ) {
    setWorkspaces((current) => updateSessionModelSelectionInWorkspaces(current, sessionID, selection))
  }

  function handleMessageDiffSummaryHydrate(
    messageID: string,
    diffSummary: SessionDiffSummary,
    sessionID = activeSessionID,
  ) {
    if (!sessionID) return

    setConversations((prev) => {
      const currentMessages = prev[sessionID] ?? []
      const nextMessages = hydrateMessageDiffSummary(currentMessages, messageID, diffSummary)
      if (nextMessages === currentMessages) return prev

      persistUserMessages(sessionID, nextMessages)
      return {
        ...prev,
        [sessionID]: nextMessages,
      }
    })
  }

  function handleCanvasSessionTabCloseWithScrollCleanup(sessionID: string, paneID?: string) {
    clearThreadScrollSnapshotsForSession(sessionID)
    handleCanvasSessionTabClose(sessionID)
  }

  function handleForkFromMessage(messageID: string, input?: { tabKey?: string | null }) {
    const targetTabKey = input?.tabKey ?? activeTabKey
    if (!targetTabKey || !messageID.trim()) return

    setComposerParentMessageIDByTabKey((current) => ({
      ...current,
      [targetTabKey]: messageID,
    }))
  }

  function handleClearComposerParentMessage(input?: { tabKey?: string | null }) {
    const targetTabKey = input?.tabKey ?? activeTabKey
    if (!targetTabKey) return

    setComposerParentMessageIDByTabKey((current) => {
      if (!(targetTabKey in current)) return current
      const next = { ...current }
      delete next[targetTabKey]
      return next
    })
  }

  async function handleSessionBranchSelect(input: {
    messageID: string
    sessionID?: string | null
  }) {
    const sessionID = input.sessionID ?? activeSessionID
    const messageID = input.messageID.trim()
    if (!sessionID || !messageID || !window.desktop?.updateSessionActiveMessage) return

    const backendSessionID = resolveBackendSessionID(sessionID)
    await window.desktop.updateSessionActiveMessage({
      sessionID: backendSessionID,
      messageID,
    })
    await reloadSessionHistoryForSession(sessionID, backendSessionID, {
      force: true,
      mode: "silent",
      preserveUserPresentation: false,
      reason: "manual",
    })
    refreshWorkspaceForSession(sessionID)
  }

  async function handleSessionRollbackToCheckpoint(input: {
    sessionID?: string | null
    targetMessageID: string
    reason: string
    correctivePrompt: string
    restoreWorkspace?: boolean
  }) {
    const sessionID = input.sessionID ?? activeSessionID
    const targetMessageID = input.targetMessageID.trim()
    const reason = input.reason.trim()
    const correctivePrompt = input.correctivePrompt.trim()
    if (!sessionID || !targetMessageID || !reason || !correctivePrompt) {
      return
    }
    if (!window.desktop?.rollbackSessionToCheckpoint) {
      throw new Error("Rollback bridge is unavailable.")
    }

    const backendSessionID = resolveBackendSessionID(sessionID)
    const payload: DesktopIpcInput<"desktop:rollback-session-to-checkpoint"> = {
      sessionID: backendSessionID,
      targetMessageID,
      reason,
      correctivePrompt,
      restoreWorkspace: input.restoreWorkspace === true,
    }
    const result = await window.desktop.rollbackSessionToCheckpoint(payload)

    setWorkspaces((current) => updateSessionInWorkspaces(current, sessionID, (session) => ({
      ...session,
      title: result.session.title,
      updated: result.session.updated,
      workflow: result.session.workflow,
      modelSelection: result.session.modelSelection,
    })))
    await reloadSessionHistoryForSession(sessionID, backendSessionID, {
      force: true,
      mode: "silent",
      preserveUserPresentation: false,
      reason: "manual",
    })
    refreshWorkspaceForSession(sessionID)
  }

  return {
    activeCreateSessionTabID,
    activePreviewState,
    activeRightSidebarTab,
    activePendingConversationInputs,
    activeSession,
    activeSessionDirectory,
    activeSessionContextUsage,
    activeSessionDiff,
    activeSessionDiffState,
    activeSessionRuntimeDebug,
    activeSessionRuntimeDebugState,
    activePendingPermissionRequests,
    activeSideChatAttachments,
    activeSessionSelectedDiffFile,
    activeSideChatDraftState,
    activeSideChatIsCancelling,
    activeSideChatIsInterruptible,
    activeSideChatIsSending,
    activeSessionIsSideChat,
    activeSideChatCountsByAnchorMessageID,
    activeSideChatPendingInputs,
    activeSideChatPendingPermissionRequests,
    activeSideChatSession,
    activeSideChatSessionsByAnchorMessageID,
    activeSideChatTabKey,
    activeSideChatMessages,
    activeWorkspaceFileScopeDirectory,
    activeWorkspaceFileScopeName,
    activeWorkspaceFileState,
    activeMessages,
    canvasSessionTabs,
    canInsertPreviewInteractionsIntoDraft,
    canInsertWorkspaceFileCommentsIntoDraft,
    composerAttachments,
    composerRefreshVersion,
    createSessionTabs,
    createSessionTitle,
    createSessionWorkspaceID,
    deletingSessionID,
    draftState,
    ensureSessionHistoryLoaded,
    expandedFolderIDs,
    handleCanvasSessionTabClose: handleCanvasSessionTabCloseWithScrollCleanup,
    handleCanvasSessionTabSelect,
    handleCancelSend,
    handleCreateSessionTabSelect,
    handleCloseCreateSessionTab,
    handleCreateSessionSubmit,
    handleCreateSessionForDirectory,
    handleCreateSideChatTab,
    handleClearComposerParentMessage,
    handleDeleteSideChatTab,
    handleCreateSessionTitleChange,
    handleCreateSessionWorkspaceChange,
    handleLeftSidebarViewChange,
    handleOpenSideChat,
    handleOpenSideChatInTab,
    handleOpenCreateSessionTab,
    activateRightSidebarTab,
    closeRightSidebarTab,
    openOrFocusRightSidebarTab,
    updateRightSidebarTab,
    handleMovePanelIntoSurface,
    handleMovePanelOutOfSurface,
    handlePaneFocus,
    handleDockviewActiveChange,
    handleSplitResize,
    handlePaneTabDrop,
    handlePaneSplit,
    handleForkFromMessage,
    handleApproveProposedPlan,
    handlePermissionRequestResponse,
    handleAskUserQuestionAnswer,
    handlePickComposerAttachments,
    handlePasteComposerImageAttachments,
    handleActiveSessionDiffFileSelect,
    handleActiveSessionDiffFileRestore,
    handleActiveSessionDiffFilesRestore,
    handleActiveSessionDiffPatchesReverseApply,
    handleActiveSessionDiffRefresh,
    handleActiveSessionRuntimeDebugRefresh,
    handlePreviewActiveInteractionChange,
    handlePreviewBack,
    handlePreviewCommitInteraction,
    handlePreviewDeleteInteraction,
    handlePreviewDraftUrlChange,
    handlePreviewForward,
    handlePreviewInsertInteractionsIntoDraft,
    handlePreviewOpen,
    handlePreviewOpenExternal,
    handlePreviewOpenTarget,
    handlePreviewOpenUrl,
    handlePreviewReload,
    handleWorkspaceFileCommentCancel,
    handleWorkspaceFileCommentChange,
    handleWorkspaceFileCommentConfirm,
    handleWorkspaceFileCommentStart,
    handleWorkspaceDirectoryLoad,
    handleWorkspaceDirectoryToggle,
    handleWorkspaceFileTreeInvalidate,
    handleWorkspaceFileQueryChange,
    handleWorkspaceFileSelect,
    handleProjectCreateSession,
    handleProjectClick,
    handleProjectArchiveSessions,
    handleProjectOpenInExplorer,
    handleProjectPin,
    handleProjectRemove,
    handleRemoveComposerAttachment,
    handleSend,
    handlePlanModeToggle,
    handleSessionDelete,
    handleSessionBranchSelect,
    handleSessionRollbackToCheckpoint,
    handleSessionSelect,
    handleSelectSideChatTab,
    handleSidebarAction,
    handleSessionModelSelectionChange,
    handleMessageDiffSummaryHydrate,
    readThreadScrollSnapshot,
    saveThreadScrollSnapshot,
    focusedPaneID,
    hoveredFolderID,
    isCreateSessionTabActive,
    isCancelling,
    isCreatingProject,
    isCreatingSession,
    isInterruptible,
    isResolvingPermissionRequest: permissionRequestActionRequestID !== null,
    isSending,
    leftSidebarView,
    permissionRequestActionError,
    permissionRequestActionRequestID,
    messageTreeBySession,
    pinnedWorkspaceIDs,
    projectRowRefs,
    refreshComposerMcp,
    refreshComposerModels,
    refreshComposerSkills,
    refreshWorkspaceFromDirectory,
    resolveBackendSessionID,
    rightSidebar,
    rightSidebarTabs,
    runningSessionIDs,
    selectedProjectID,
    selectedWorkspace,
    selectedFolderID,
    sessionCanvasUnreadBySession,
    setDraft,
    setDraftForTab,
    setHoveredFolderID,
    handleWorkbenchDockviewCommandsReady,
    setDockviewLayout,
    dockviewActiveState,
    visibleCanvasSessionIDs,
    dockviewLayout,
    selectedDiffFileBySession,
    sessionDiffBySession,
    sessionDiffStateBySession,
    workspaceStore,
    workspaces,
  }
}
