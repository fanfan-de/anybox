import { useRef } from "react"
import { createAgentSessionEventRouter } from "../agent-session/event-router"
import { createAgentSessionStore } from "../agent-session/store"
import type {
  OptimisticUserSubmission,
  PendingAgentStream,
  PendingConversationInput,
  PermissionRequest
} from "../types"
import { createSessionDataLoadCache } from "./session-data-load-cache"
import { useWorkspaceStoreSelector, type WorkspaceStoreApi } from "./workspace-store"

interface StreamPermissionControllerOptions {
  initialSessionID: string | null
  store: WorkspaceStoreApi
}

export function useStreamPermissionController({ initialSessionID, store }: StreamPermissionControllerOptions) {
  const pendingStreamsRef = useRef<Record<string, PendingAgentStream>>({})
  const optimisticUserSubmissionsRef = useRef<Record<string, OptimisticUserSubmission>>({})
  const historyRequestRef = useRef<Record<string, number>>({})
  const sessionDataLoadCacheRef = useRef(createSessionDataLoadCache())
  const permissionRequestsRequestRef = useRef<Record<string, number>>({})
  const conversationVersionRef = useRef<Record<string, number>>({})
  const skipNextHistoryLoadRef = useRef<Record<string, boolean>>({})
  const subscribedSessionStreamsRef = useRef<Record<string, string>>({})
  const sessionEventRouterRef = useRef(createAgentSessionEventRouter())
  const agentSessionStoreRef = useRef(createAgentSessionStore())
  const lastFocusedSessionIDRef = useRef<string | null>(initialSessionID)

  const agentSessions = useWorkspaceStoreSelector(store, (state) => state.agentStream.agentSessions)
  const cancellingSessionIDs = useWorkspaceStoreSelector(store, (state) => state.agentStream.cancellingSessionIDs)
  const conversationActivityBySession = useWorkspaceStoreSelector(
    store,
    (state) => state.agentStream.conversationActivityBySession,
  )
  const conversationStore = useWorkspaceStoreSelector(store, (state) => state.agentStream.conversationStore)
  const contextUsageBySession = useWorkspaceStoreSelector(store, (state) => state.agentStream.contextUsageBySession)
  const messageTreeBySession = useWorkspaceStoreSelector(store, (state) => state.agentStream.messageTreeBySession)
  const pendingConversationInputsBySession = useWorkspaceStoreSelector(
    store,
    (state) => state.agentStream.pendingConversationInputsBySession as Record<string, PendingConversationInput[]>,
  )
  const pendingPermissionRequestsBySession = useWorkspaceStoreSelector(
    store,
    (state) => state.agentStream.pendingPermissionRequestsBySession as Record<string, PermissionRequest[]>,
  )
  const permissionRequestActionError = useWorkspaceStoreSelector(
    store,
    (state) => state.agentStream.permissionRequestActionError,
  )
  const permissionRequestActionRequestID = useWorkspaceStoreSelector(
    store,
    (state) => state.agentStream.permissionRequestActionRequestID,
  )
  const sessionDirectoryBySession = useWorkspaceStoreSelector(
    store,
    (state) => state.agentStream.sessionDirectoryBySession,
  )
  const setAgentSessions = useWorkspaceStoreSelector(store, (state) => state.agentStreamActions.setAgentSessions)
  const setCancellingSessionIDs = useWorkspaceStoreSelector(store, (state) => state.agentStreamActions.setCancellingSessionIDs)
  const setContextUsageBySession = useWorkspaceStoreSelector(
    store,
    (state) => state.agentStreamActions.setContextUsageBySession,
  )
  const setConversations = useWorkspaceStoreSelector(store, (state) => state.agentStreamActions.setConversations)
  const setMessageTreeBySession = useWorkspaceStoreSelector(store, (state) => state.agentStreamActions.setMessageTreeBySession)
  const setPendingConversationInputsBySession = useWorkspaceStoreSelector(
    store,
    (state) => state.agentStreamActions.setPendingConversationInputsBySession,
  )
  const setPendingPermissionRequestsBySession = useWorkspaceStoreSelector(
    store,
    (state) => state.agentStreamActions.setPendingPermissionRequestsBySession,
  )
  const setPermissionRequestActionError = useWorkspaceStoreSelector(
    store,
    (state) => state.agentStreamActions.setPermissionRequestActionError,
  )
  const setPermissionRequestActionRequestID = useWorkspaceStoreSelector(
    store,
    (state) => state.agentStreamActions.setPermissionRequestActionRequestID,
  )
  const setSessionDirectoryBySession = useWorkspaceStoreSelector(
    store,
    (state) => state.agentStreamActions.setSessionDirectoryBySession,
  )
  const appendAssistantDelta = useWorkspaceStoreSelector(store, (state) => state.agentStreamActions.appendAssistantDelta)
  const updateConversationTurns = useWorkspaceStoreSelector(store, (state) => state.agentStreamActions.updateConversationTurns)

  return {
    agentSessionStoreRef,
    agentSessions,
    appendAssistantDelta,
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
    optimisticUserSubmissionsRef,
    pendingStreamsRef,
    permissionRequestActionError,
    permissionRequestActionRequestID,
    permissionRequestsRequestRef,
    sessionDirectoryBySession,
    sessionDataLoadCacheRef,
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
    updateConversationTurns,
  }
}
