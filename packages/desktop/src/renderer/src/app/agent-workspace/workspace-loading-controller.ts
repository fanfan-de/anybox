import { useEffectEvent, type MutableRefObject } from "react"
import type { SerializedDockview } from "dockview-react"
import type {
  CreateSessionTab,
  MobileBridgeEvent,
  SessionDiffState,
  ThreadMessage,
  WorkbenchTabReference,
  WorkspaceFileChangeIPCEvent,
  WorkspaceGroup,
} from "../types"
import {
  handleMobileBridgeEvent,
  handleWorkspaceFileChange,
  useInitialFolderWorkspacesEffect,
  useMobileBridgeEventSubscription,
  useWorkspaceFileChangeSubscription,
  useWorkspaceWatchDirectoriesEffect,
} from "./workspace-loading-hooks"
import type { WorkspaceStateUpdater } from "./workspace-store"

type StateSetter<T> = (update: WorkspaceStateUpdater<T>) => void

interface UseWorkspaceLoadingControllerOptions {
  activeSessionDirectory: string | null
  activeSessionID: string | null
  activeWorkspace: WorkspaceGroup | null
  createCreateSessionTab: (workspaceID: string | null) => CreateSessionTab
  createCreateSessionWorkbenchTab: (createSessionTabID: string) => WorkbenchTabReference
  createSessionWorkbenchTab: (sessionID: string) => WorkbenchTabReference
  gitRefreshSuppressedUntilRef: MutableRefObject<Record<string, number>>
  initialDockviewLayout?: SerializedDockview | null
  initialFolderWorkspacesLoadedRef: MutableRefObject<boolean>
  initialSessionID?: string | null
  isInitialWorkspaceLoadPending: boolean
  lastFocusedSessionIDRef: MutableRefObject<string | null>
  platform: string
  preserveLocalWorkspaceStateOnInitialLoadRef: MutableRefObject<boolean>
  refreshWorkspaceFromDirectory: (directory: string) => Promise<WorkspaceGroup | null>
  scheduleSessionDiffRefreshForSession: (sessionID: string) => void
  setAgentSessions: StateSetter<Record<string, string>>
  setCanLoadSessionHistory: StateSetter<boolean>
  setConversations: StateSetter<Record<string, ThreadMessage[]>>
  setCreateSessionTabs: StateSetter<CreateSessionTab[]>
  setExpandedFolderIDs: StateSetter<string[]>
  setIsInitialWorkspaceLoadPending: StateSetter<boolean>
  setSelectedFolderID: StateSetter<string | null>
  setSessionDiffStateBySession: StateSetter<Record<string, SessionDiffState>>
  setSessionDirectoryBySession: StateSetter<Record<string, string>>
  setDockviewLayout: StateSetter<SerializedDockview | null>
  setWorkspaces: StateSetter<WorkspaceGroup[]>
  watchedWorkspaceDirectoriesKeyRef: MutableRefObject<string>
  workspaceReloadSuppressedUntilRef: MutableRefObject<Record<string, number>>
  workspaces: WorkspaceGroup[]
}

export function useWorkspaceLoadingController({
  activeSessionDirectory,
  activeSessionID,
  activeWorkspace,
  createCreateSessionTab,
  createCreateSessionWorkbenchTab,
  createSessionWorkbenchTab,
  gitRefreshSuppressedUntilRef,
  initialDockviewLayout,
  initialFolderWorkspacesLoadedRef,
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
}: UseWorkspaceLoadingControllerOptions) {
  const handleWorkspaceFileChangeEffect = useEffectEvent((workspaceEvent: WorkspaceFileChangeIPCEvent) => {
    handleWorkspaceFileChange({
      activeSessionDirectory,
      activeSessionID,
      gitRefreshSuppressedUntilRef,
      platform,
      refreshWorkspaceFromDirectory,
      scheduleSessionDiffRefreshForSession,
      setSessionDiffStateBySession,
      workspaceEvent,
      workspaces,
      workspaceReloadSuppressedUntilRef,
    })
  })

  useWorkspaceFileChangeSubscription(handleWorkspaceFileChangeEffect)

  const handleMobileBridgeEventEffect = useEffectEvent((mobileEvent: MobileBridgeEvent) => {
    handleMobileBridgeEvent({
      mobileEvent,
      platform,
      refreshWorkspaceFromDirectory,
      workspaces,
    })
  })

  useMobileBridgeEventSubscription(handleMobileBridgeEventEffect)

  useWorkspaceWatchDirectoriesEffect({
    activeSessionDirectory,
    activeWorkspace,
    isInitialWorkspaceLoadPending,
    platform,
    watchedWorkspaceDirectoriesKeyRef,
    workspaces,
  })

  useInitialFolderWorkspacesEffect({
    createCreateSessionTab,
    createCreateSessionWorkbenchTab,
    createSessionWorkbenchTab,
    initialDockviewLayout,
    initialFolderWorkspacesLoadedRef,
    initialSessionID,
    lastFocusedSessionIDRef,
    preserveLocalWorkspaceStateOnInitialLoadRef,
    setAgentSessions,
    setCanLoadSessionHistory,
    setConversations,
    setCreateSessionTabs,
    setExpandedFolderIDs,
    setIsInitialWorkspaceLoadPending,
    setSelectedFolderID,
    setSessionDirectoryBySession,
    setDockviewLayout,
    setWorkspaces,
  })
}
