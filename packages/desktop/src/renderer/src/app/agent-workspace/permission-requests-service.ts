import { startTransition, type MutableRefObject } from "react"
import { getAgentSessionBridge } from "../agent-session/client"
import { buildFailureThreadMessage, buildStreamingAssistantThreadMessage } from "../stream"
import type {
  AssistantThreadMessage,
  PendingAgentStream,
  PermissionDecision,
  PermissionRequest,
  ThreadMessage,
} from "../types"
import { createID } from "../utils"
import type { SessionDataLoadOptions } from "./session-data-load-cache"
import type { WorkspaceStateUpdater } from "./workspace-store"

function buildPermissionRequestsSignature(requests: PermissionRequest[]) {
  return requests
    .map((request) => [
      request.id,
      request.status,
      request.sessionID,
      request.messageID,
      request.toolCallID,
      request.prompt.title,
      request.prompt.summary,
      request.prompt.risk,
    ].join("\u0000"))
    .sort()
    .join("\u0001")
}

interface LoadPendingPermissionRequestsInput {
  backendSessionID: string
  permissionRequestsRequestRef: MutableRefObject<Record<string, number>>
  sessionID: string
  setPendingPermissionRequestsBySession: (
    update: WorkspaceStateUpdater<Record<string, PermissionRequest[]>>,
  ) => void
  options?: SessionDataLoadOptions
}

export async function loadPendingPermissionRequestsForSession({
  backendSessionID,
  permissionRequestsRequestRef,
  sessionID,
  setPendingPermissionRequestsBySession,
}: LoadPendingPermissionRequestsInput) {
  const agentSession = getAgentSessionBridge()
  if (!agentSession) return

  const requestID = (permissionRequestsRequestRef.current[sessionID] ?? 0) + 1
  permissionRequestsRequestRef.current[sessionID] = requestID

  try {
    const nextRequests = await agentSession.loadPermissionRequests({ backendSessionID })
    if (permissionRequestsRequestRef.current[sessionID] !== requestID) return

    const nextPendingRequests = nextRequests.filter((request) => request.status === "pending")
    setPendingPermissionRequestsBySession((prev) => {
      const currentRequests = prev[sessionID] ?? []
      if (buildPermissionRequestsSignature(currentRequests) === buildPermissionRequestsSignature(nextPendingRequests)) {
        return prev
      }

      return {
        ...prev,
        [sessionID]: nextPendingRequests,
      }
    })
  } catch (error) {
    if (permissionRequestsRequestRef.current[sessionID] !== requestID) return
    console.error("[desktop] agentSession.loadPermissionRequests failed:", error)
  }
}

interface RespondPermissionRequestInput {
  appendConversationMessages: (sessionID: string, nextMessages: ThreadMessage[]) => void
  input: {
    sessionID: string
    request: PermissionRequest
    decision: PermissionDecision
    note?: string
  }
  loadPendingPermissionRequestsForSession: (sessionID: string, backendSessionID: string, options?: SessionDataLoadOptions) => Promise<void>
  loadSessionDiffForSession: (sessionID: string, backendSessionID: string, options?: SessionDataLoadOptions) => Promise<void>
  loadSessionRuntimeDebugForSession: (sessionID: string, backendSessionID: string, options?: SessionDataLoadOptions) => Promise<void>
  pendingStreamsRef: MutableRefObject<Record<string, PendingAgentStream>>
  permissionRequestActionRequestID: string | null
  permissionRequestsRequestRef: MutableRefObject<Record<string, number>>
  refreshWorkspaceForSession: (sessionID: string) => void
  reloadSessionHistoryForSession: (sessionID: string, backendSessionID: string, options?: SessionDataLoadOptions) => Promise<void>
  setPendingPermissionRequestsBySession: (
    update: WorkspaceStateUpdater<Record<string, PermissionRequest[]>>,
  ) => void
  setPermissionRequestActionError: (update: string | null) => void
  setPermissionRequestActionRequestID: (update: string | null) => void
  updateAssistantConversationMessage: (
    sessionID: string,
    assistantMessageID: string,
    updater: (message: AssistantThreadMessage) => AssistantThreadMessage,
  ) => void
}

export async function respondPermissionRequest({
  appendConversationMessages,
  input,
  loadPendingPermissionRequestsForSession,
  loadSessionDiffForSession,
  loadSessionRuntimeDebugForSession,
  pendingStreamsRef,
  permissionRequestActionRequestID,
  permissionRequestsRequestRef,
  refreshWorkspaceForSession,
  reloadSessionHistoryForSession,
  setPendingPermissionRequestsBySession,
  setPermissionRequestActionError,
  setPermissionRequestActionRequestID,
  updateAssistantConversationMessage,
}: RespondPermissionRequestInput) {
  const agentSession = getAgentSessionBridge()
  if (!agentSession || permissionRequestActionRequestID) return

  permissionRequestsRequestRef.current[input.sessionID] = (permissionRequestsRequestRef.current[input.sessionID] ?? 0) + 1
  const removedRequest = input.request
  const canStreamResume = agentSession.canResumeStream
  let requestResolved = false
  setPermissionRequestActionRequestID(input.request.id)
  setPermissionRequestActionError(null)
  setPendingPermissionRequestsBySession((prev) => {
    const current = prev[input.sessionID] ?? []
    return {
      ...prev,
      [input.sessionID]: current.filter((request) => request.id !== input.request.id),
    }
  })

  try {
    await agentSession.respondPermissionRequest({
      requestID: input.request.id,
      decision: input.decision,
      note: input.note?.trim() || undefined,
      resume: !canStreamResume,
    })
    requestResolved = true

    await reloadSessionHistoryForSession(input.sessionID, input.request.sessionID, {
      force: true,
      mode: "silent",
      reason: "permission",
    }).catch((error) => {
      console.error("[desktop] permission history refresh failed:", error)
    })
    await loadSessionDiffForSession(input.sessionID, input.request.sessionID, {
      force: true,
      mode: "silent",
      reason: "permission",
    }).catch((error) => {
      console.error("[desktop] permission diff refresh failed:", error)
    })
    await loadSessionRuntimeDebugForSession(input.sessionID, input.request.sessionID, {
      force: true,
      mode: "silent",
      reason: "permission",
    }).catch((error) => {
      console.error("[desktop] permission runtime refresh failed:", error)
    })
    await loadPendingPermissionRequestsForSession(input.sessionID, input.request.sessionID, {
      force: true,
      mode: "silent",
      reason: "permission",
    }).catch((error) => {
      console.error("[desktop] permission request refresh failed:", error)
    })
    refreshWorkspaceForSession(input.sessionID)

    if (canStreamResume) {
      const streamID = createID("stream")
      const streamingMessage = buildStreamingAssistantThreadMessage(
        input.decision === "deny" ? "Continue after denial" : "Continue after approval",
        {
          backendTurnID: input.request.messageID,
          messageID: input.request.messageID,
          segmentID: input.request.messageID,
        },
      )
      pendingStreamsRef.current[streamID] = {
        sessionID: input.sessionID,
        backendSessionID: input.request.sessionID,
        assistantThreadMessageID: streamingMessage.id,
        requestedMode: "new-turn",
        createdAssistantThreadMessageID: streamingMessage.id,
      }

      appendConversationMessages(input.sessionID, [streamingMessage])

      try {
        await agentSession.resumeTurn({
          clientTurnID: streamID,
          backendSessionID: input.request.sessionID,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        delete pendingStreamsRef.current[streamID]
        startTransition(() => {
          updateAssistantConversationMessage(input.sessionID, streamingMessage.id, (current) =>
            buildFailureThreadMessage(message, current),
          )
        })
        throw error
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error("[desktop] respondPermissionRequest failed:", error)

    if (!requestResolved) {
      setPermissionRequestActionError(message)
      setPendingPermissionRequestsBySession((prev) => {
        const current = prev[input.sessionID] ?? []
        if (current.some((request) => request.id === removedRequest.id)) {
          return prev
        }

        return {
          ...prev,
          [input.sessionID]: [removedRequest, ...current],
        }
      })
    }
  } finally {
    setPermissionRequestActionRequestID(null)
  }
}
