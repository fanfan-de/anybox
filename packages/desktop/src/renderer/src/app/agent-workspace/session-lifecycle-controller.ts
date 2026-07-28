import type { MouseEvent, MutableRefObject } from "react"
import type { SerializedDockview } from "dockview-react"
import { getAgentSessionBridge } from "../agent-session/client"
import {
  ensureAgentSessions,
  ensureConversationSessions,
  removeAgentSession,
  removeConversationSession,
} from "../conversation-state"
import type {
  CreateSessionTab,
  ComposerAttachment,
  ComposerDraftState,
  LoadedFolderWorkspace,
  PendingAgentStream,
  PermissionRequest,
  SessionContextUsage,
  SessionDiffState,
  SessionDiffSummary,
  SessionRuntimeDebugSnapshot,
  SessionRuntimeDebugState,
  SessionTaskListView,
  SessionSummary,
  SidebarActionKey,
  ThreadMessage,
  WorkspaceGroup,
} from "../types"
import type { SessionMessageTree } from "../session-message-tree"
import {
  getActiveDockviewPanelReference,
  normalizeDockviewLayout,
  type WorkbenchDockviewCommands,
} from "../workbench/dockview-state"
import {
  findWorkspaceByID,
  getPrimaryWorkspaceSessions,
  isWorkspaceAvailable,
  mapLoadedSession,
  mapLoadedWorkspace,
  sameWorkspaceDirectory,
  sortWorkspaceGroups,
  upsertSessionInWorkspace,
  upsertWorkspaceGroup,
} from "../workspace"
import { openExternalEditor } from "../external-editor/client"
import {
  createCreateSessionWorkbenchTab,
  createSessionWorkbenchTab,
  getWorkbenchTabKey,
  resolveCreateSessionWorkspaceID,
} from "./workspace-derived-state"
import { collectSessionDirectoryMap } from "./workspace-loading-hooks"
import {
  buildDockviewPanelTitles,
  buildValidDockviewReferences,
  resolveWorkspaceIDForDockviewReference,
} from "./dockview-workspace"
import {
  clearSessionDataLoadCacheForSession,
  type SessionDataLoadCache,
  type SessionDataLoadOptions,
} from "./session-data-load-cache"
import {
  ensureExpandedFolderID,
  removeExpandedFolderID,
  type WorkspaceStateUpdater,
} from "./workspace-store"

type StateSetter<T> = (update: WorkspaceStateUpdater<T>) => void

export function removePendingStreamsForSessions(
  pendingStreams: Record<string, PendingAgentStream>,
  sessionIDs: Set<string>,
) {
  for (const [streamID, target] of Object.entries(pendingStreams)) {
    if (sessionIDs.has(target.sessionID)) {
      delete pendingStreams[streamID]
    }
  }
}

export function removeSubscribedSessionStreamsForCleanup(
  subscribedSessionStreams: Record<string, string>,
  sessionIDs: Set<string>,
) {
  const backendSessionIDs = new Set<string>()

  for (const [uiSessionID, backendSessionID] of Object.entries(subscribedSessionStreams)) {
    if (!sessionIDs.has(uiSessionID) && !sessionIDs.has(backendSessionID)) continue
    if (backendSessionID.trim()) {
      backendSessionIDs.add(backendSessionID)
    }
    delete subscribedSessionStreams[uiSessionID]
  }

  return backendSessionIDs
}

interface UseSessionLifecycleControllerOptions {
  activeCreateSessionTab: CreateSessionTab | null
  activeCreateSessionTabID: string | null
  agentDefaultDirectory: string
  activeWorkspace: WorkspaceGroup | null
  agentSessionStoreRef: MutableRefObject<{
    dispatch(action: { type: "session.cleanup"; sessionID: string }): void
  }>
  canLoadSessionHistory: boolean
  createSessionTabs: CreateSessionTab[]
  createSessionWorkspaceID: string | null
  deletingSessionID: string | null
  dockviewLayout: SerializedDockview | null
  expandedFolderIDs: string[]
  focusExistingCreateSessionTabAcrossPanes: (preferredWorkspaceID?: string | null) => boolean
  focusSession: (workspaceID: string, sessionID: string, paneID?: string) => void
  focusedPane: { id: string } | null
  focusedPaneID: string | null
  initialFolderWorkspacesLoadedRef: MutableRefObject<boolean>
  isCreateSessionTabActive: boolean
  isCreatingProject: boolean
  isCreatingSessionByTabKey: Record<string, boolean>
  lastFocusedSessionIDRef: MutableRefObject<string | null>
  ensurePendingPermissionRequestsLoaded: (sessionID: string, backendSessionID?: string, options?: SessionDataLoadOptions) => Promise<void>
  ensureSessionHistoryLoaded: (sessionID: string, backendSessionID?: string, options?: SessionDataLoadOptions) => Promise<void>
  openCreateSessionTab: (preferredWorkspaceID?: string | null, paneID?: string | null, workspaceScope?: WorkspaceGroup[]) => void
  pendingStreamsRef: MutableRefObject<Record<string, PendingAgentStream>>
  permissionRequestsRequestRef: MutableRefObject<Record<string, number>>
  preserveLocalWorkspaceStateOnInitialLoadRef: MutableRefObject<boolean>
  runtimeDebugRequestRef: MutableRefObject<Record<string, number>>
  sessionDiffRequestRef: MutableRefObject<Record<string, number>>
  sessionDataLoadCacheRef: MutableRefObject<SessionDataLoadCache>
  sessionEventRouterRef: MutableRefObject<{
    cleanupUISession(sessionID: string): void
  }>
  setAgentSessions: StateSetter<Record<string, string>>
  setCanLoadSessionHistory: StateSetter<boolean>
  setComposerAttachmentsByTabKey: StateSetter<Record<string, ComposerAttachment[]>>
  setComposerDraftStateByTabKey: StateSetter<Record<string, ComposerDraftState>>
  setComposerParentMessageIDByTabKey: StateSetter<Record<string, string>>
  setConversations: StateSetter<Record<string, ThreadMessage[]>>
  setContextUsageBySession: StateSetter<Record<string, SessionContextUsage>>
  setCreateSessionTabs: StateSetter<CreateSessionTab[]>
  setDeletingSessionID: StateSetter<string | null>
  setExpandedFolderIDs: StateSetter<string[]>
  setHoveredFolderID: StateSetter<string | null>
  setIsCreatingProject: StateSetter<boolean>
  setIsCreatingSessionByTabKey: StateSetter<Record<string, boolean>>
  setIsSendingByTabKey: StateSetter<Record<string, boolean>>
  setPendingPermissionRequestsBySession: StateSetter<Record<string, PermissionRequest[]>>
  setMessageTreeBySession: StateSetter<Record<string, SessionMessageTree>>
  setSelectedDiffFileBySession: StateSetter<Record<string, string | null>>
  setSelectedFolderID: StateSetter<string | null>
  setSessionDiffBySession: StateSetter<Record<string, SessionDiffSummary>>
  setSessionDiffStateBySession: StateSetter<Record<string, SessionDiffState>>
  setSessionDirectoryBySession: StateSetter<Record<string, string>>
  setSessionRuntimeDebugBySession: StateSetter<Record<string, SessionRuntimeDebugSnapshot>>
  setSessionRuntimeDebugStateBySession: StateSetter<Record<string, SessionRuntimeDebugState>>
  setSessionTasksBySession: StateSetter<Record<string, SessionTaskListView>>
  setDockviewLayout: StateSetter<SerializedDockview | null>
  setWorkspaces: StateSetter<WorkspaceGroup[]>
  refreshWorkspaceFromDirectory: (directory: string) => Promise<WorkspaceGroup | null>
  reportSessionActionError: (message: string) => void
  clearRuntimeDebugRefreshTimer: (sessionID: string) => void
  clearSessionDiffRefreshTimer: (sessionID: string) => void
  handleCreateSessionWorkspaceChange: (workspaceID: string, createSessionTabID?: string | null) => void
  historyRequestRef: MutableRefObject<Record<string, number>>
  selectedFolderID: string | null
  skipNextHistoryLoadRef: MutableRefObject<Record<string, boolean>>
  subscribedSessionStreamsRef: MutableRefObject<Record<string, string>>
  workbenchDockviewCommandsRef: MutableRefObject<WorkbenchDockviewCommands | null>
  workspaces: WorkspaceGroup[]
  conversationVersionRef: MutableRefObject<Record<string, number>>
}

export function useSessionLifecycleController({
  activeCreateSessionTab,
  activeCreateSessionTabID,
  agentDefaultDirectory,
  activeWorkspace,
  agentSessionStoreRef,
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
  pendingStreamsRef,
  permissionRequestsRequestRef,
  preserveLocalWorkspaceStateOnInitialLoadRef,
  runtimeDebugRequestRef,
  sessionDiffRequestRef,
  sessionDataLoadCacheRef,
  sessionEventRouterRef,
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
  reportSessionActionError,
  clearRuntimeDebugRefreshTimer,
  clearSessionDiffRefreshTimer,
  selectedFolderID,
  skipNextHistoryLoadRef,
  subscribedSessionStreamsRef,
  workbenchDockviewCommandsRef,
  workspaces,
}: UseSessionLifecycleControllerOptions) {
  function applyLoadedFolderWorkspace(loadedWorkspace: LoadedFolderWorkspace) {
    const nextWorkspace = mapLoadedWorkspace(loadedWorkspace)
    const loadedSessionIDs = loadedWorkspace.sessions.map((session) => session.id)
    setWorkspaces((prev) => upsertWorkspaceGroup(prev, nextWorkspace))
    setConversations((prev) => ensureConversationSessions(prev, loadedSessionIDs))
    setAgentSessions((prev) => ensureAgentSessions(prev, loadedSessionIDs))
    setSessionDirectoryBySession((prev) => ({
      ...prev,
      ...collectSessionDirectoryMap([loadedWorkspace]),
    }))
    setCanLoadSessionHistory(true)
    return nextWorkspace
  }

  function isDefaultConversationWorkspace(workspace: WorkspaceGroup) {
    return sameWorkspaceDirectory(workspace.directory, agentDefaultDirectory)
  }

  function cleanupSessionState(sessionIDs: Set<string>) {
    setConversations((prev) => {
      const next = { ...prev }
      for (const sessionID of sessionIDs) {
        delete next[sessionID]
      }
      return next
    })

    setAgentSessions((prev) => {
      const next = { ...prev }
      for (const sessionID of sessionIDs) {
        delete next[sessionID]
      }
      return next
    })

    setPendingPermissionRequestsBySession((prev) => {
      const next = { ...prev }
      for (const sessionID of sessionIDs) {
        delete next[sessionID]
      }
      return next
    })

    setMessageTreeBySession((prev) => {
      const next = { ...prev }
      for (const sessionID of sessionIDs) {
        delete next[sessionID]
      }
      return next
    })

    setSessionDiffBySession((prev) => {
      const next = { ...prev }
      for (const sessionID of sessionIDs) {
        delete next[sessionID]
      }
      return next
    })

    setSessionDiffStateBySession((prev) => {
      const next = { ...prev }
      for (const sessionID of sessionIDs) {
        delete next[sessionID]
      }
      return next
    })

    setSessionRuntimeDebugBySession((prev) => {
      const next = { ...prev }
      for (const sessionID of sessionIDs) {
        delete next[sessionID]
      }
      return next
    })

    setSessionRuntimeDebugStateBySession((prev) => {
      const next = { ...prev }
      for (const sessionID of sessionIDs) {
        delete next[sessionID]
      }
      return next
    })

    setSessionTasksBySession((prev) => {
      const next = { ...prev }
      for (const sessionID of sessionIDs) {
        delete next[sessionID]
      }
      return next
    })

    setSelectedDiffFileBySession((prev) => {
      const next = { ...prev }
      for (const sessionID of sessionIDs) {
        delete next[sessionID]
      }
      return next
    })

    setSessionDirectoryBySession((prev) => {
      const next = { ...prev }
      for (const sessionID of sessionIDs) {
        delete next[sessionID]
      }
      return next
    })

    setContextUsageBySession((prev) => {
      const next = { ...prev }
      for (const sessionID of sessionIDs) {
        delete next[sessionID]
      }
      return next
    })

    const tabKeys = new Set([...sessionIDs].map((sessionID) => getWorkbenchTabKey(createSessionWorkbenchTab(sessionID))))

    setComposerDraftStateByTabKey((prev) => {
      const next = { ...prev }
      for (const tabKey of tabKeys) {
        delete next[tabKey]
      }
      return next
    })

    setComposerParentMessageIDByTabKey((prev) => {
      const next = { ...prev }
      for (const tabKey of tabKeys) {
        delete next[tabKey]
      }
      return next
    })

    setComposerAttachmentsByTabKey((prev) => {
      const next = { ...prev }
      for (const tabKey of tabKeys) {
        delete next[tabKey]
      }
      return next
    })

    setIsSendingByTabKey((prev) => {
      const next = { ...prev }
      for (const tabKey of tabKeys) {
        delete next[tabKey]
      }
      return next
    })

    for (const sessionID of sessionIDs) {
      delete conversationVersionRef.current[sessionID]
      delete historyRequestRef.current[sessionID]
      delete permissionRequestsRequestRef.current[sessionID]
      delete sessionDiffRequestRef.current[sessionID]
      clearSessionDataLoadCacheForSession(sessionDataLoadCacheRef.current, sessionID)
      clearSessionDiffRefreshTimer(sessionID)
      delete runtimeDebugRequestRef.current[sessionID]
      clearRuntimeDebugRefreshTimer(sessionID)
      sessionEventRouterRef.current.cleanupUISession(sessionID)
      agentSessionStoreRef.current.dispatch({
        type: "session.cleanup",
        sessionID,
      })
    }

    const agentSession = getAgentSessionBridge()
    const backendSessionIDs = removeSubscribedSessionStreamsForCleanup(subscribedSessionStreamsRef.current, sessionIDs)
    if (agentSession) {
      for (const backendSessionID of backendSessionIDs) {
        void agentSession.unsubscribe({ backendSessionID }).catch((error) => {
          console.error("[desktop] agentSession.unsubscribe failed during session cleanup:", error)
        })
      }
    }

    removePendingStreamsForSessions(pendingStreamsRef.current, sessionIDs)
  }

  async function createSessionForWorkspace(
    workspace: WorkspaceGroup,
    options?: {
      createSessionTabID?: string | null
      closeCreateTab?: boolean
      paneID?: string | null
      skipInitialHistoryLoad?: boolean
      title?: string
    },
  ) {
    const createTabKey = options?.createSessionTabID ? `create-session:${options.createSessionTabID}` : null
    if ((createTabKey && isCreatingSessionByTabKey[createTabKey]) || !window.desktop?.createFolderSession) return null

    if (createTabKey) {
      setIsCreatingSessionByTabKey((current) => ({
        ...current,
        [createTabKey]: true,
      }))
    }
    try {
      const nextTitle = options?.title?.trim()
      const created = await window.desktop.createFolderSession({
        projectID: workspace.project.id,
        directory: workspace.directory,
        title: nextTitle || undefined,
      })
      const nextSession = mapLoadedSession(created.session, workspace.sessions.length)
      setWorkspaces((prev) => upsertSessionInWorkspace(prev, workspace.id, nextSession))
      setConversations((prev) => ({
        ...prev,
        [created.session.id]: prev[created.session.id] ?? [],
      }))
      setAgentSessions((prev) => ({
        ...prev,
        [created.session.id]: created.session.id,
      }))
      setSessionDirectoryBySession((prev) => ({
        ...prev,
        [created.session.id]: created.session.directory,
      }))
      setCanLoadSessionHistory(true)
      if (options?.skipInitialHistoryLoad) {
        skipNextHistoryLoadRef.current[created.session.id] = true
      }

      if (options?.closeCreateTab && options.createSessionTabID) {
        setCreateSessionTabs((current) => current.filter((tab) => tab.id !== options.createSessionTabID))
        workbenchDockviewCommandsRef.current?.replacePanel(
          createCreateSessionWorkbenchTab(options.createSessionTabID),
          createSessionWorkbenchTab(created.session.id),
          { title: nextSession.title },
        )
      } else if (options?.createSessionTabID) {
        setCreateSessionTabs((current) =>
          current.map((tab) =>
            tab.id === options.createSessionTabID
              ? {
                  ...tab,
                  title: "",
                  workspaceID: workspace.id,
                }
              : tab,
          ),
        )
        workbenchDockviewCommandsRef.current?.replacePanel(
          createCreateSessionWorkbenchTab(options.createSessionTabID),
          createSessionWorkbenchTab(created.session.id),
          { title: nextSession.title },
        )
      } else if (options?.paneID) {
        workbenchDockviewCommandsRef.current?.openPanel(createSessionWorkbenchTab(created.session.id), {
          targetGroupID: options.paneID,
          title: nextSession.title,
        })
      }

      focusSession(workspace.id, created.session.id, options?.paneID ?? undefined)
      return {
        backendSessionID: created.session.id,
        session: nextSession,
        workspace,
      }
    } catch (error) {
      console.error("[desktop] createFolderSession failed:", error)
      return null
    } finally {
      if (createTabKey) {
        setIsCreatingSessionByTabKey((current) => {
          if (!(createTabKey in current)) return current
          const next = { ...current }
          delete next[createTabKey]
          return next
        })
      }
    }
  }

  async function handleCreateSessionSubmit(createSessionTabID = activeCreateSessionTabID, paneID = focusedPaneID ?? focusedPane?.id ?? null) {
    if (!createSessionTabID) return
    const currentCreateSessionTab = createSessionTabs.find((tab) => tab.id === createSessionTabID)
    if (!currentCreateSessionTab) return

    const workspace = findWorkspaceByID(workspaces, currentCreateSessionTab.workspaceID)
    if (!workspace) return

    await createSessionForWorkspace(workspace, {
      closeCreateTab: true,
      createSessionTabID,
      paneID,
    })
  }

  async function handleSidebarAction(action: SidebarActionKey) {
    if (action === "conversation") {
      const defaultDirectory = agentDefaultDirectory.trim()
      if (!defaultDirectory) return

      let targetWorkspace = workspaces.find((workspace) => sameWorkspaceDirectory(workspace.directory, defaultDirectory)) ?? null

      if (!targetWorkspace) {
        if (isCreatingProject || !window.desktop?.openFolderWorkspace) return

        setIsCreatingProject(true)
        try {
          const loadedWorkspace = await window.desktop.openFolderWorkspace({ directory: defaultDirectory })
          if (!initialFolderWorkspacesLoadedRef.current) {
            preserveLocalWorkspaceStateOnInitialLoadRef.current = true
          }
          targetWorkspace = applyLoadedFolderWorkspace(loadedWorkspace)
        } catch (error) {
          console.error("[desktop] open default conversation workspace failed:", error)
          return
        } finally {
          setIsCreatingProject(false)
        }
      }

      if (!targetWorkspace) return

      setSelectedFolderID(targetWorkspace.id)
      setExpandedFolderIDs((current) => ensureExpandedFolderID(current, targetWorkspace.id))
      if (focusExistingCreateSessionTabAcrossPanes(targetWorkspace.id)) return
      const workspaceScope = workspaces.some((workspace) => workspace.id === targetWorkspace.id)
        ? workspaces
        : [...workspaces, targetWorkspace]
      openCreateSessionTab(targetWorkspace.id, focusedPaneID ?? focusedPane?.id ?? null, workspaceScope)
      return
    }

    if (action === "project") {
      if (isCreatingProject || !window.desktop?.pickProjectDirectory || !window.desktop?.openFolderWorkspace) {
        return
      }

      setIsCreatingProject(true)
      try {
        const directory = await window.desktop.pickProjectDirectory()
        if (!directory) return

        const createdWorkspace = await window.desktop.openFolderWorkspace({ directory })
        if (!initialFolderWorkspacesLoadedRef.current) {
          preserveLocalWorkspaceStateOnInitialLoadRef.current = true
        }
        const nextWorkspace = applyLoadedFolderWorkspace(createdWorkspace)
        setExpandedFolderIDs((current) => ensureExpandedFolderID(current, createdWorkspace.id))
        setSelectedFolderID(createdWorkspace.id)
        const [initialWorkspaceSession] = getPrimaryWorkspaceSessions(nextWorkspace.sessions)
        if (initialWorkspaceSession) {
          focusSession(createdWorkspace.id, initialWorkspaceSession.id)
        } else if (!focusExistingCreateSessionTabAcrossPanes(createdWorkspace.id)) {
          openCreateSessionTab(createdWorkspace.id, undefined, [...workspaces, nextWorkspace])
        }
        lastFocusedSessionIDRef.current = initialWorkspaceSession?.id ?? null
      } catch (error) {
        console.error("[desktop] openFolderWorkspace failed:", error)
      } finally {
        setIsCreatingProject(false)
      }
      return
    }

  }

  function handleProjectClick(workspace: WorkspaceGroup) {
    const isExpanded = expandedFolderIDs.includes(workspace.id)
    setSelectedFolderID(workspace.id)

    if (isExpanded) {
      setExpandedFolderIDs((current) => removeExpandedFolderID(current, workspace.id))
      return
    }

    setExpandedFolderIDs((current) => ensureExpandedFolderID(current, workspace.id))
  }

  function handleSessionSelect(workspaceID: string, sessionID: string) {
    focusSession(workspaceID, sessionID, focusedPaneID ?? focusedPane?.id ?? undefined)
  }

  async function handleProjectCreateSession(workspace: WorkspaceGroup, event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation()
    if (!isWorkspaceAvailable(workspace)) return
    if (focusExistingCreateSessionTabAcrossPanes(workspace.id)) return
    openCreateSessionTab(workspace.id)
  }

  async function handleCreateSessionForDirectory(projectID: string, directory: string) {
    const trimmedProjectID = projectID.trim()
    const trimmedDirectory = directory.trim()
    if (!trimmedProjectID || !trimmedDirectory) return null

    const refreshedWorkspace = await refreshWorkspaceFromDirectory(trimmedDirectory)
    const targetWorkspace =
      refreshedWorkspace ??
      workspaces.find((workspace) => (
        workspace.project.id === trimmedProjectID &&
        workspace.directory.trim().toLowerCase() === trimmedDirectory.toLowerCase()
      )) ??
      null

    if (!targetWorkspace) {
      console.error("[desktop] create session for worktree failed: workspace was not loaded.", {
        directory: trimmedDirectory,
        projectID: trimmedProjectID,
      })
      return null
    }

    if (targetWorkspace.project.id !== trimmedProjectID) {
      console.error("[desktop] create session for worktree failed: project mismatch.", {
        expectedProjectID: trimmedProjectID,
        actualProjectID: targetWorkspace.project.id,
        directory: trimmedDirectory,
      })
      return null
    }

    return createSessionForWorkspace(targetWorkspace, {
      paneID: focusedPaneID ?? focusedPane?.id ?? null,
    })
  }

  function handleProjectRemove(workspace: WorkspaceGroup, event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation()
    if (isDefaultConversationWorkspace(workspace)) return

    const nextWorkspaces = workspaces.filter((item) => item.id !== workspace.id)
    const removedSessionIDs = new Set(workspace.sessions.map((session) => session.id))
    const nextCreateSessionWorkspaceID = resolveCreateSessionWorkspaceID(
      nextWorkspaces,
      activeCreateSessionTab?.workspaceID === workspace.id ? null : activeCreateSessionTab?.workspaceID ?? null,
      selectedFolderID,
    )
    const nextCreateSessionTabs = createSessionTabs.map((tab) => {
      const nextWorkspaceID =
        (tab.workspaceID && tab.workspaceID !== workspace.id ? findWorkspaceByID(nextWorkspaces, tab.workspaceID)?.id : null) ??
        nextCreateSessionWorkspaceID

      return nextWorkspaceID === tab.workspaceID
        ? tab
        : {
            ...tab,
            workspaceID: nextWorkspaceID,
          }
    })
    for (const sessionID of removedSessionIDs) {
      workbenchDockviewCommandsRef.current?.closePanel(createSessionWorkbenchTab(sessionID))
    }
    const nextDockviewLayout = normalizeDockviewLayout(
      workbenchDockviewCommandsRef.current?.getSnapshot() ?? dockviewLayout,
      buildValidDockviewReferences(nextWorkspaces, nextCreateSessionTabs),
      buildDockviewPanelTitles(nextWorkspaces, nextCreateSessionTabs),
    )
    const nextFocusedTab = getActiveDockviewPanelReference(nextDockviewLayout)
    const nextFocusedWorkspaceID = resolveWorkspaceIDForDockviewReference(
      nextFocusedTab,
      nextWorkspaces,
      nextCreateSessionTabs,
    )

    setWorkspaces(nextWorkspaces)
    setDockviewLayout(nextDockviewLayout)
    cleanupSessionState(removedSessionIDs)
    setCreateSessionTabs(nextCreateSessionTabs)
    setHoveredFolderID((current) => (current === workspace.id ? null : current))
    setSelectedFolderID(nextFocusedWorkspaceID ?? nextCreateSessionWorkspaceID)
    setExpandedFolderIDs((current) =>
      ensureExpandedFolderID(
        removeExpandedFolderID(current, workspace.id),
        nextFocusedWorkspaceID ?? nextCreateSessionWorkspaceID,
      ),
    )
  }

  function applyArchivedSessions(archivedSessionIDs: Set<string>, fallbackWorkspaceID: string) {
    const nextWorkspaces = sortWorkspaceGroups(
      workspaces.map((item) => ({
        ...item,
        sessions: item.sessions.filter((existing) => !archivedSessionIDs.has(existing.id)),
      })),
    )
    const nextCreateSessionWorkspaceID = resolveCreateSessionWorkspaceID(
      nextWorkspaces,
      activeCreateSessionTab?.workspaceID ?? createSessionWorkspaceID,
      fallbackWorkspaceID,
    )
    const nextCreateSessionTabs = createSessionTabs.map((tab) => {
      const nextWorkspaceID = findWorkspaceByID(nextWorkspaces, tab.workspaceID ?? "")?.id ?? nextCreateSessionWorkspaceID

      return nextWorkspaceID === tab.workspaceID
        ? tab
        : {
            ...tab,
            workspaceID: nextWorkspaceID,
          }
    })
    for (const sessionID of archivedSessionIDs) {
      workbenchDockviewCommandsRef.current?.closePanel(createSessionWorkbenchTab(sessionID))
    }
    const nextDockviewLayout = normalizeDockviewLayout(
      workbenchDockviewCommandsRef.current?.getSnapshot() ?? dockviewLayout,
      buildValidDockviewReferences(nextWorkspaces, nextCreateSessionTabs),
      buildDockviewPanelTitles(nextWorkspaces, nextCreateSessionTabs),
    )
    const nextFocusedTab = getActiveDockviewPanelReference(nextDockviewLayout)
    const nextFocusedWorkspaceID = resolveWorkspaceIDForDockviewReference(
      nextFocusedTab,
      nextWorkspaces,
      nextCreateSessionTabs,
    )

    setWorkspaces(nextWorkspaces)
    setDockviewLayout(nextDockviewLayout)
    setCreateSessionTabs(nextCreateSessionTabs)
    setConversations((prev) => {
      let next = prev
      for (const archivedSessionID of archivedSessionIDs) {
        next = removeConversationSession(next, archivedSessionID)
      }
      return next
    })
    setAgentSessions((prev) => {
      let next = prev
      for (const archivedSessionID of archivedSessionIDs) {
        next = removeAgentSession(next, archivedSessionID)
      }
      return next
    })
    cleanupSessionState(archivedSessionIDs)
    setSelectedFolderID(nextFocusedWorkspaceID ?? nextCreateSessionWorkspaceID ?? nextWorkspaces[0]?.id ?? null)
    setExpandedFolderIDs((current) =>
      ensureExpandedFolderID(current, nextFocusedWorkspaceID ?? nextCreateSessionWorkspaceID ?? null),
    )
  }

  async function handleProjectOpenInExplorer(workspace: WorkspaceGroup) {
    if (!isWorkspaceAvailable(workspace)) return

    try {
      await openExternalEditor({
        editorID: "explorer",
        targetPath: workspace.directory,
      })
    } catch (error) {
      if (!window.desktop?.openPath) {
        console.error("[desktop] open project in explorer failed:", error)
        return
      }

      try {
        await window.desktop.openPath({
          targetPath: workspace.directory,
        })
      } catch (fallbackError) {
        console.error("[desktop] open project path failed:", fallbackError)
      }
    }
  }

  async function handleProjectArchiveSessions(workspace: WorkspaceGroup) {
    if (deletingSessionID || !window.desktop?.archiveAgentSession) return

    const targetSessions = workspace.sessions
    if (targetSessions.length === 0) return

    setDeletingSessionID(targetSessions[0]?.id ?? workspace.id)
    try {
      const archivedSessionIDs = new Set<string>()
      for (const session of targetSessions) {
        if (archivedSessionIDs.has(session.id)) continue
        const archiveResult = await window.desktop.archiveAgentSession({ sessionID: session.id })
        archivedSessionIDs.add(archiveResult.sessionID || session.id)
      }

      if (archivedSessionIDs.size > 0) {
        applyArchivedSessions(archivedSessionIDs, workspace.id)
      }
    } catch (error) {
      console.error("[desktop] archive workspace sessions failed:", error)
    } finally {
      setDeletingSessionID(null)
    }
  }

  async function handleSessionDelete(workspace: WorkspaceGroup, session: SessionSummary, event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation()
    if (deletingSessionID || !window.desktop?.archiveAgentSession) return

    setDeletingSessionID(session.id)
    try {
      const archiveResult = await window.desktop.archiveAgentSession({ sessionID: session.id })
      const archivedSessionIDs = new Set([archiveResult.sessionID || session.id])
      applyArchivedSessions(archivedSessionIDs, workspace.id)
    } catch (error) {
      console.error("[desktop] archiveAgentSession failed:", error)
      const message = error instanceof Error ? error.message : String(error)
      reportSessionActionError(`归档会话失败：${message}`)
    } finally {
      setDeletingSessionID(null)
    }
  }

  return {
    cleanupSessionState,
    createSessionForWorkspace,
    handleCreateSessionForDirectory,
    handleCreateSessionSubmit,
    handleProjectClick,
    handleProjectArchiveSessions,
    handleProjectCreateSession,
    handleProjectOpenInExplorer,
    handleProjectRemove,
    handleSessionDelete,
    handleSessionSelect,
    handleSidebarAction,
  }
}
