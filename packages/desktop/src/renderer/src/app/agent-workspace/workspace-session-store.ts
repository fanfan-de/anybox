import { useRef } from "react"
import { seedWorkspaces } from "../seed-data"
import { useWorkspaceStoreSelector, type WorkspaceStoreApi } from "./workspace-store"

interface WorkspaceSessionStoreOptions {
  store: WorkspaceStoreApi
}

export const seedWorkspaceIDs = new Set(seedWorkspaces.map((workspace) => workspace.id))

export function useWorkspaceSessionStore({ store }: WorkspaceSessionStoreOptions) {
  const projectRowRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const initialFolderWorkspacesLoadedRef = useRef(false)
  const preserveLocalWorkspaceStateOnInitialLoadRef = useRef(false)
  const workspaceRefreshRequestRef = useRef<Record<string, number>>({})
  const watchedWorkspaceDirectoriesKeyRef = useRef("")
  const gitRefreshSuppressedUntilRef = useRef<Record<string, number>>({})
  const workspaceReloadSuppressedUntilRef = useRef<Record<string, number>>({})

  const canLoadSessionHistory = useWorkspaceStoreSelector(store, (state) => state.sessions.canLoadSessionHistory)
  const createSessionTabs = useWorkspaceStoreSelector(store, (state) => state.sessions.createSessionTabs)
  const deletingSessionID = useWorkspaceStoreSelector(store, (state) => state.sessions.deletingSessionID)
  const expandedFolderIDs = useWorkspaceStoreSelector(store, (state) => state.sessions.expandedFolderIDs)
  const hoveredFolderID = useWorkspaceStoreSelector(store, (state) => state.sessions.hoveredFolderID)
  const isCreatingProject = useWorkspaceStoreSelector(store, (state) => state.sessions.isCreatingProject)
  const isInitialWorkspaceLoadPending = useWorkspaceStoreSelector(
    store,
    (state) => state.sessions.isInitialWorkspaceLoadPending,
  )
  const leftSidebarView = useWorkspaceStoreSelector(store, (state) => state.sessions.leftSidebarView)
  const pinnedWorkspaceIDs = useWorkspaceStoreSelector(store, (state) => state.sessions.pinnedWorkspaceIDs)
  const rightSidebar = useWorkspaceStoreSelector(store, (state) => state.sessions.rightSidebar)
  const selectedFolderID = useWorkspaceStoreSelector(store, (state) => state.sessions.selectedFolderID)
  const sessionCanvasUnreadBySession = useWorkspaceStoreSelector(
    store,
    (state) => state.sessions.sessionCanvasUnreadBySession,
  )
  const workspaces = useWorkspaceStoreSelector(store, (state) => state.sessions.workspaces)
  const setCanLoadSessionHistory = useWorkspaceStoreSelector(
    store,
    (state) => state.sessionsActions.setCanLoadSessionHistory,
  )
  const setCreateSessionTabs = useWorkspaceStoreSelector(store, (state) => state.sessionsActions.setCreateSessionTabs)
  const setDeletingSessionID = useWorkspaceStoreSelector(store, (state) => state.sessionsActions.setDeletingSessionID)
  const setExpandedFolderIDs = useWorkspaceStoreSelector(store, (state) => state.sessionsActions.setExpandedFolderIDs)
  const setHoveredFolderID = useWorkspaceStoreSelector(store, (state) => state.sessionsActions.setHoveredFolderID)
  const setIsCreatingProject = useWorkspaceStoreSelector(store, (state) => state.sessionsActions.setIsCreatingProject)
  const setIsInitialWorkspaceLoadPending = useWorkspaceStoreSelector(
    store,
    (state) => state.sessionsActions.setIsInitialWorkspaceLoadPending,
  )
  const setLeftSidebarView = useWorkspaceStoreSelector(store, (state) => state.sessionsActions.setLeftSidebarView)
  const setPinnedWorkspaceIDs = useWorkspaceStoreSelector(store, (state) => state.sessionsActions.setPinnedWorkspaceIDs)
  const activateRightSidebarTab = useWorkspaceStoreSelector(
    store,
    (state) => state.sessionsActions.activateRightSidebarTab,
  )
  const closeRightSidebarTab = useWorkspaceStoreSelector(store, (state) => state.sessionsActions.closeRightSidebarTab)
  const openOrFocusRightSidebarTab = useWorkspaceStoreSelector(
    store,
    (state) => state.sessionsActions.openOrFocusRightSidebarTab,
  )
  const setRightSidebarFileState = useWorkspaceStoreSelector(
    store,
    (state) => state.sessionsActions.setRightSidebarFileState,
  )
  const setRightSidebarPreviewState = useWorkspaceStoreSelector(
    store,
    (state) => state.sessionsActions.setRightSidebarPreviewState,
  )
  const updateRightSidebarTab = useWorkspaceStoreSelector(
    store,
    (state) => state.sessionsActions.updateRightSidebarTab,
  )
  const setSelectedFolderID = useWorkspaceStoreSelector(store, (state) => state.sessionsActions.setSelectedFolderID)
  const setSessionCanvasUnreadBySession = useWorkspaceStoreSelector(
    store,
    (state) => state.sessionsActions.setSessionCanvasUnreadBySession,
  )
  const setWorkspaces = useWorkspaceStoreSelector(store, (state) => state.sessionsActions.setWorkspaces)

  return {
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
    activateRightSidebarTab,
    closeRightSidebarTab,
    openOrFocusRightSidebarTab,
    pinnedWorkspaceIDs,
    preserveLocalWorkspaceStateOnInitialLoadRef,
    projectRowRefs,
    rightSidebar,
    selectedFolderID,
    setCanLoadSessionHistory,
    setCreateSessionTabs,
    setDeletingSessionID,
    setExpandedFolderIDs,
    setHoveredFolderID,
    setIsCreatingProject,
    setIsInitialWorkspaceLoadPending,
    setLeftSidebarView,
    setPinnedWorkspaceIDs,
    setRightSidebarFileState,
    setRightSidebarPreviewState,
    updateRightSidebarTab,
    setSelectedFolderID,
    setSessionCanvasUnreadBySession,
    setWorkspaces,
    sessionCanvasUnreadBySession,
    watchedWorkspaceDirectoriesKeyRef,
    workspaceRefreshRequestRef,
    workspaceReloadSuppressedUntilRef,
    workspaces,
  }
}
