import { act, renderHook } from "@testing-library/react"
import { useRef, useState, type Dispatch, type SetStateAction } from "react"
import { describe, expect, it, vi } from "vitest"
import { createComposerDraftStateFromPlainText } from "../composer/draft-state"
import type {
  AssistantThreadMessage,
  ComposerAttachment,
  ComposerDraftState,
  CreateSessionTab,
  PendingAgentStream,
  PendingConversationInput,
  PermissionRequest,
  SessionSummary,
  ThreadMessage,
  WorkspaceGroup,
} from "../types"
import { useComposerController } from "./composer-controller"

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

function createWorkspace(session: SessionSummary): WorkspaceGroup {
  return {
    id: "workspace-1",
    name: "Workspace",
    directory: "C:/work/workspace-1",
    created: 1,
    updated: 1,
    project: {
      id: "project-1",
      name: "Project",
      worktree: "C:/work/workspace-1",
    },
    sessions: [session],
  }
}

function createStreamingAssistantThreadMessage(id: string, toolStatus: "pending" | "running" = "running"): AssistantThreadMessage {
  return {
    id,
    kind: "assistant",
    backendTurnID: `turn-${id}`,
    segmentID: id,
    timestamp: 1,
    runtime: {
      phase: "tool_running",
      startedAt: 1,
      updatedAt: 1,
    },
    state: "running",
    items: [
      {
        id: `${id}-tool`,
        kind: "tool",
        timestamp: 1,
        label: "Tool",
        title: "read-file",
        status: toolStatus,
      },
    ],
    isStreaming: true,
  }
}

function applyUpdate<T>(setValue: Dispatch<SetStateAction<T>>, _current: T, update: T | ((value: T) => T)) {
  setValue((current) => (typeof update === "function" ? (update as (value: T) => T)(current) : update))
}

function useComposerHarness(input?: {
  activeCreateSessionTabID?: string | null
  activeSessionID?: string | null
  activeTabKey?: string | null
  agentConnected?: boolean
  createSessionInitialWorkflowMode?: "execution" | "planning"
  initialAgentSessions?: Record<string, string>
  initialIsSendingByTabKey?: Record<string, boolean>
  initialPendingPermissionRequestsBySession?: Record<string, PermissionRequest[]>
  sessionDraftText?: string
}) {
  const session = createSession("session-1")
  const workspace = createWorkspace(session)
  const [agentSessions, setAgentSessionsState] = useState<Record<string, string>>(input?.initialAgentSessions ?? {})
  const [cancellingSessionIDs, setCancellingSessionIDsState] = useState<Record<string, boolean>>({})
  const [attachmentsByTabKey, setAttachmentsByTabKeyState] = useState<Record<string, ComposerAttachment[]>>({})
  const [createSessionTabs, setCreateSessionTabsState] = useState<CreateSessionTab[]>([
    {
      id: "create-1",
      initialWorkflowMode: input?.createSessionInitialWorkflowMode,
      workspaceID: workspace.id,
      title: "",
    },
  ])
  const [draftsByTabKey, setDraftsByTabKeyState] = useState<Record<string, ComposerDraftState>>({
    "session:session-1": createComposerDraftStateFromPlainText(input?.sessionDraftText ?? "Existing prompt"),
    "create-session:create-1": createComposerDraftStateFromPlainText("New prompt"),
  })
  const [composerParentMessageIDByTabKey, setComposerParentMessageIDByTabKeyState] = useState<Record<string, string>>({})
  const [isSendingByTabKey, setIsSendingByTabKeyState] = useState<Record<string, boolean>>(input?.initialIsSendingByTabKey ?? {})
  const [pendingPermissionRequestsBySession, setPendingPermissionRequestsBySessionState] = useState<Record<string, PermissionRequest[]>>(
    input?.initialPendingPermissionRequestsBySession ?? {},
  )
  const [pendingConversationInputsBySession, setPendingConversationInputsBySessionState] = useState<Record<string, PendingConversationInput[]>>({})
  const [sessionDirectoryBySession, setSessionDirectoryBySessionState] = useState<Record<string, string>>({})
  const [workspaces, setWorkspacesState] = useState<WorkspaceGroup[]>([workspace])
  const messagesRef = useRef<Record<string, ThreadMessage[]>>({})
  const pendingStreamsRef = useRef<Record<string, PendingAgentStream>>({})
  const permissionRequestsRequestRef = useRef<Record<string, number>>({})
  const updateAssistantConversationMessage = useRef(vi.fn((
    sessionID: string,
    assistantMessageID: string,
    updater: (message: AssistantThreadMessage) => AssistantThreadMessage,
  ) => {
    messagesRef.current[sessionID] = (messagesRef.current[sessionID] ?? []).map((message) =>
      message.kind === "assistant" && message.id === assistantMessageID ? updater(message) : message,
    )
  })).current
  const createdSession = createSession("created-session-1")
  const createSessionForWorkspace = useRef(vi.fn(async (targetWorkspace: WorkspaceGroup) => {
    const nextWorkspace = {
      ...targetWorkspace,
      sessions: [...targetWorkspace.sessions, createdSession],
    }
    setWorkspacesState((current) =>
      current.map((currentWorkspace) => currentWorkspace.id === targetWorkspace.id ? nextWorkspace : currentWorkspace),
    )
    return {
      backendSessionID: createdSession.id,
      session: createdSession,
      workspace: nextWorkspace,
    }
  })).current

  const controller = useComposerController({
    activeCreateSessionTabID: input && "activeCreateSessionTabID" in input ? input.activeCreateSessionTabID ?? null : null,
    activeSessionID: input && "activeSessionID" in input ? input.activeSessionID ?? null : session.id,
    activeTabKey: input && "activeTabKey" in input ? input.activeTabKey ?? null : "session:session-1",
    agentConnected: input?.agentConnected ?? false,
    agentDefaultDirectory: "C:/work",
    agentSessions,
    cancellingSessionIDs,
    appendConversationMessages: (sessionID, nextMessages) => {
      messagesRef.current[sessionID] = [...(messagesRef.current[sessionID] ?? []), ...nextMessages]
    },
    composerAttachmentsByTabKey: attachmentsByTabKey,
    composerDraftStateByTabKey: draftsByTabKey,
    composerParentMessageIDByTabKey,
    createSessionForWorkspace,
    createSessionTabs,
    getConversationMessages: (sessionID) => messagesRef.current[sessionID] ?? [],
    isSendingByTabKey,
    loadPendingPermissionRequestsForSession: vi.fn(async () => undefined),
    loadSessionDiffForSession: vi.fn(async () => undefined),
    loadSessionRuntimeDebugForSession: vi.fn(async () => undefined),
    pendingConversationInputsBySession,
    pendingPermissionRequestsBySession,
    pendingStreamsRef,
    permissionRequestActionRequestID: null,
    permissionRequestsRequestRef,
    platform: "win32",
    refreshWorkspaceForSession: vi.fn(),
    refreshWorkspaceFromDirectory: vi.fn(),
    reloadSessionHistoryForSession: vi.fn(async () => undefined),
    replaceConversationMessages: (sessionID, nextMessages) => {
      messagesRef.current[sessionID] = nextMessages
    },
    sessionDirectoryBySession,
    setAgentSessions: (update) => applyUpdate(setAgentSessionsState, agentSessions, update),
    setCancellingSessionIDs: (update) => applyUpdate(setCancellingSessionIDsState, cancellingSessionIDs, update),
    setComposerAttachmentsByTabKey: (update) => applyUpdate(setAttachmentsByTabKeyState, attachmentsByTabKey, update),
    setComposerDraftStateByTabKey: (update) => applyUpdate(setDraftsByTabKeyState, draftsByTabKey, update),
    setComposerParentMessageIDByTabKey: (update) =>
      applyUpdate(setComposerParentMessageIDByTabKeyState, composerParentMessageIDByTabKey, update),
    setCreateSessionTabs: (update) => applyUpdate(setCreateSessionTabsState, createSessionTabs, update),
    setIsSendingByTabKey: (update) => applyUpdate(setIsSendingByTabKeyState, isSendingByTabKey, update),
    setPendingConversationInputsBySession: (update) =>
      applyUpdate(setPendingConversationInputsBySessionState, pendingConversationInputsBySession, update),
    setPendingPermissionRequestsBySession: (update) =>
      applyUpdate(setPendingPermissionRequestsBySessionState, pendingPermissionRequestsBySession, update),
    setPermissionRequestActionError: vi.fn(),
    setPermissionRequestActionRequestID: vi.fn(),
    setSessionDirectoryBySession: (update) => applyUpdate(setSessionDirectoryBySessionState, sessionDirectoryBySession, update),
    setWorkspaces: (update) => applyUpdate(setWorkspacesState, workspaces, update),
    updateAssistantConversationMessage,
    workspaces,
  })

  return {
    attachmentsByTabKey,
    cancellingSessionIDs,
    controller,
    createSessionForWorkspace,
    createSessionTabs,
    pendingConversationInputsBySession,
    pendingStreamsRef,
    messagesRef,
    updateAssistantConversationMessage,
    workspaces,
  }
}

describe("composer controller", () => {
  it("sends an existing session draft through the send service", async () => {
    const { result } = renderHook(() => useComposerHarness())

    await act(async () => {
      await result.current.controller.handleSend()
    })

    expect(result.current.messagesRef.current["session-1"]).toHaveLength(2)
    expect(result.current.messagesRef.current["session-1"]?.[0]).toMatchObject({
      kind: "user",
      text: "Existing prompt",
    })
    expect(result.current.messagesRef.current["session-1"]?.[1]).toMatchObject({
      kind: "assistant",
    })
  })

  it("sends a text draft while the current tab is already sending", async () => {
    const { result } = renderHook(() =>
      useComposerHarness({
        initialIsSendingByTabKey: {
          "session:session-1": true,
        },
      }),
    )

    await act(async () => {
      await result.current.controller.handleSend()
    })

    expect(result.current.messagesRef.current["session-1"]?.[0]).toMatchObject({
      kind: "user",
      text: "Existing prompt",
    })
  })

  it("queues running text submissions without interrupting the active stream", async () => {
    const previousDesktop = window.desktop
    const sendTurn = vi.fn(async (input: { clientTurnID: string }) => ({
      clientTurnID: input.clientTurnID,
    }))
    const interrupt = vi.fn()
    const cancelTurn = vi.fn()

    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: {
        createAgentSession: vi.fn(),
        agentSession: {
          sendTurn,
          interrupt,
          cancelTurn,
        },
      } as unknown as typeof window.desktop,
    })

    try {
      const { result } = renderHook(() =>
        useComposerHarness({
          agentConnected: true,
          initialAgentSessions: {
            "session-1": "backend-session-1",
          },
          initialIsSendingByTabKey: {
            "session:session-1": true,
          },
        }),
      )

      result.current.pendingStreamsRef.current["stream-active"] = {
        assistantThreadMessageID: "assistant-active",
        backendSessionID: "backend-session-1",
        backendTurnID: "turn-active",
        sessionID: "session-1",
      }
      result.current.messagesRef.current["session-1"] = [createStreamingAssistantThreadMessage("assistant-active")]

      await act(async () => {
        await result.current.controller.handleSend()
      })

      expect(sendTurn).toHaveBeenCalledWith(expect.objectContaining({
        backendSessionID: "backend-session-1",
        concurrentInputMode: "queue",
        text: "Existing prompt",
      }))
      expect(interrupt).not.toHaveBeenCalled()
      expect(cancelTurn).not.toHaveBeenCalled()
      expect(result.current.messagesRef.current["session-1"]).toHaveLength(1)
      expect(result.current.messagesRef.current["session-1"]?.[0]).toMatchObject({
        kind: "assistant",
      })
      expect(result.current.pendingConversationInputsBySession["session-1"]?.[0]).toMatchObject({
        mode: "queued",
        status: "pending",
        text: "Existing prompt",
      })
      expect(Object.values(result.current.pendingStreamsRef.current)).toContainEqual(
        expect.objectContaining({
          pendingInputID: result.current.pendingConversationInputsBySession["session-1"]?.[0]?.id,
          requestedMode: "queue",
          sessionID: "session-1",
        }),
      )
    } finally {
      Object.defineProperty(window, "desktop", {
        configurable: true,
        value: previousDesktop,
      })
    }
  })

  it("queues running submissions when the active stream outlives the sending flag", async () => {
    const previousDesktop = window.desktop
    const sendTurn = vi.fn(async (input: { clientTurnID: string }) => ({
      clientTurnID: input.clientTurnID,
    }))

    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: {
        createAgentSession: vi.fn(),
        agentSession: {
          sendTurn,
        },
      } as unknown as typeof window.desktop,
    })

    try {
      const { result } = renderHook(() =>
        useComposerHarness({
          agentConnected: true,
          initialAgentSessions: {
            "session-1": "backend-session-1",
          },
        }),
      )

      result.current.pendingStreamsRef.current["stream-active"] = {
        assistantThreadMessageID: "assistant-active",
        backendSessionID: "backend-session-1",
        backendTurnID: "turn-active",
        sessionID: "session-1",
      }
      result.current.messagesRef.current["session-1"] = [createStreamingAssistantThreadMessage("assistant-active")]

      await act(async () => {
        await result.current.controller.handleSend()
      })

      expect(sendTurn).toHaveBeenCalledWith(expect.objectContaining({
        backendSessionID: "backend-session-1",
        concurrentInputMode: "queue",
        text: "Existing prompt",
      }))
      expect(result.current.messagesRef.current["session-1"]).toHaveLength(1)
      expect(result.current.pendingConversationInputsBySession["session-1"]?.[0]).toMatchObject({
        mode: "queued",
        status: "pending",
        text: "Existing prompt",
      })
      expect(Object.values(result.current.pendingStreamsRef.current)).toContainEqual(
        expect.objectContaining({
          pendingInputID: result.current.pendingConversationInputsBySession["session-1"]?.[0]?.id,
          requestedMode: "queue",
          sessionID: "session-1",
        }),
      )
    } finally {
      Object.defineProperty(window, "desktop", {
        configurable: true,
        value: previousDesktop,
      })
    }
  })

  it("converts a queued running submission into an explicit steer from the drawer", async () => {
    const previousDesktop = window.desktop
    const sendTurn = vi.fn(async (input: { clientTurnID: string }) => ({
      clientTurnID: input.clientTurnID,
    }))
    const abortTurn = vi.fn(async (input: { backendSessionID: string; clientTurnID: string }) => ({
      ...input,
      localRequestAborted: true,
    }))
    const interrupt = vi.fn()
    const cancelTurn = vi.fn()

    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: {
        createAgentSession: vi.fn(),
        agentSession: {
          sendTurn,
          abortTurn,
          interrupt,
          cancelTurn,
        },
      } as unknown as typeof window.desktop,
    })

    try {
      const { result } = renderHook(() =>
        useComposerHarness({
          agentConnected: true,
          initialAgentSessions: {
            "session-1": "backend-session-1",
          },
          initialIsSendingByTabKey: {
            "session:session-1": true,
          },
        }),
      )

      result.current.pendingStreamsRef.current["stream-active"] = {
        assistantThreadMessageID: "assistant-active",
        backendSessionID: "backend-session-1",
        backendTurnID: "turn-active",
        sessionID: "session-1",
      }
      result.current.messagesRef.current["session-1"] = [createStreamingAssistantThreadMessage("assistant-active")]

      await act(async () => {
        await result.current.controller.handleSend()
      })

      const queuedInput = result.current.pendingConversationInputsBySession["session-1"]?.find(
        (input) => input.mode === "queued",
      )
      const queuedStreamEntry = Object.entries(result.current.pendingStreamsRef.current).find(
        ([, stream]) => stream.requestedMode === "queue",
      )
      const queuedAssistantThreadMessageID = queuedStreamEntry?.[1].createdAssistantThreadMessageID

      expect(queuedInput).toBeDefined()
      expect(queuedStreamEntry).toBeDefined()
      expect(queuedAssistantThreadMessageID).toBeTruthy()
      if (!queuedInput || !queuedStreamEntry || !queuedAssistantThreadMessageID) {
        throw new Error("Expected queued pending input, stream, and assistant placeholder")
      }

      await act(async () => {
        await result.current.controller.handleSend({
          steerQueuedMessageID: queuedInput.id,
        })
      })

      expect(abortTurn).toHaveBeenCalledWith({
        backendSessionID: "backend-session-1",
        clientTurnID: queuedStreamEntry[0],
      })
      expect(interrupt).not.toHaveBeenCalled()
      expect(cancelTurn).not.toHaveBeenCalled()
      expect(sendTurn).toHaveBeenCalledTimes(2)
      expect(sendTurn.mock.calls[1]?.[0]).toEqual(expect.objectContaining({
        backendSessionID: "backend-session-1",
        concurrentInputMode: "steer",
        text: "Existing prompt",
      }))

      const steerStreamEntry = Object.entries(result.current.pendingStreamsRef.current).find(
        ([, stream]) => stream.requestedMode === "steer",
      )
      const steerAssistantThreadMessageID = steerStreamEntry?.[1].createdAssistantThreadMessageID
      expect(steerStreamEntry).toBeDefined()
      expect(steerAssistantThreadMessageID).toBeTruthy()
      expect(steerAssistantThreadMessageID).not.toBe("assistant-active")
      if (!steerStreamEntry || !steerAssistantThreadMessageID) {
        throw new Error("Expected steer stream and assistant placeholder")
      }

      const nextMessages = result.current.messagesRef.current["session-1"] ?? []
      expect(nextMessages.find((message) => message.id === queuedInput.id)).toBeUndefined()
      expect(nextMessages.find((message) => message.id === queuedAssistantThreadMessageID)).toBeUndefined()
      expect(nextMessages.some((message) => message.kind === "user" && message.text === "Existing prompt")).toBe(false)
      expect(nextMessages.find((message) => message.id === steerAssistantThreadMessageID)).toBeUndefined()
      const steerInput = result.current.pendingConversationInputsBySession["session-1"]?.find(
        (input) => input.mode === "steer",
      )
      expect(steerInput).toMatchObject({
        mode: "steer",
        status: "pending",
        text: "Existing prompt",
      })
      expect(result.current.pendingStreamsRef.current[queuedStreamEntry[0]]).toBeUndefined()
      expect(Object.values(result.current.pendingStreamsRef.current)).toContainEqual(
        expect.objectContaining({
          assistantThreadMessageID: steerAssistantThreadMessageID,
          createdAssistantThreadMessageID: steerAssistantThreadMessageID,
          pendingInputID: steerInput?.id,
          requestedMode: "steer",
          sessionID: "session-1",
        }),
      )
    } finally {
      Object.defineProperty(window, "desktop", {
        configurable: true,
        value: previousDesktop,
      })
    }
  })

  it("leaves preparing tool input interruption to the backend", async () => {
    const previousDesktop = window.desktop
    const sendTurn = vi.fn(async (input: { clientTurnID: string }) => ({
      clientTurnID: input.clientTurnID,
    }))
    const interrupt = vi.fn(async (input: { backendSessionID: string; clientTurnID?: string }) => ({
      ...input,
      localRequestsAborted: 0,
      backendCancelled: true,
      activeCancelled: true,
      queuedCancelled: 0,
    }))

    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: {
        createAgentSession: vi.fn(),
        agentSession: {
          sendTurn,
          interrupt,
        },
      } as unknown as typeof window.desktop,
    })

    try {
      const { result } = renderHook(() =>
        useComposerHarness({
          agentConnected: true,
          initialAgentSessions: {
            "session-1": "backend-session-1",
          },
          initialIsSendingByTabKey: {
            "session:session-1": true,
          },
        }),
      )

      result.current.pendingStreamsRef.current["stream-active"] = {
        assistantThreadMessageID: "assistant-active",
        backendSessionID: "backend-session-1",
        backendTurnID: "turn-active",
        sessionID: "session-1",
      }
      result.current.messagesRef.current["session-1"] = [createStreamingAssistantThreadMessage("assistant-active", "pending")]

      await act(async () => {
        await result.current.controller.handleSend({
          submissionMode: "steer",
        })
      })

      expect(interrupt).not.toHaveBeenCalled()
      expect(sendTurn).toHaveBeenCalledWith(expect.objectContaining({
        backendSessionID: "backend-session-1",
        concurrentInputMode: "steer",
        text: "Existing prompt",
      }))
      expect(result.current.pendingStreamsRef.current["stream-active"]?.cancelRequested).toBeUndefined()
      expect(result.current.messagesRef.current["session-1"]?.[0]).toMatchObject({
        kind: "assistant",
        runtime: {
          phase: "tool_running",
        },
        isStreaming: true,
        items: [
          expect.objectContaining({
            kind: "tool",
            status: "pending",
          }),
        ],
      })
      const steerStream = Object.values(result.current.pendingStreamsRef.current).find(
        (stream) => stream.requestedMode === "steer",
      )
      expect(steerStream).toBeDefined()
      expect(steerStream?.assistantThreadMessageID).not.toBe("assistant-active")
      expect(result.current.messagesRef.current["session-1"]).toHaveLength(1)
      expect(result.current.pendingConversationInputsBySession["session-1"]?.[0]).toMatchObject({
        mode: "steer",
        status: "pending",
        text: "Existing prompt",
      })
      expect(Object.values(result.current.pendingStreamsRef.current)).toContainEqual(
        expect.objectContaining({
          assistantThreadMessageID: steerStream?.assistantThreadMessageID,
          createdAssistantThreadMessageID: steerStream?.assistantThreadMessageID,
          pendingInputID: result.current.pendingConversationInputsBySession["session-1"]?.[0]?.id,
          requestedMode: "steer",
          sessionID: "session-1",
        }),
      )
    } finally {
      Object.defineProperty(window, "desktop", {
        configurable: true,
        value: previousDesktop,
      })
    }
  })

  it("does not send an empty draft while the current tab is already sending", async () => {
    const { result } = renderHook(() =>
      useComposerHarness({
        initialIsSendingByTabKey: {
          "session:session-1": true,
        },
        sessionDraftText: "   ",
      }),
    )

    await act(async () => {
      await result.current.controller.handleSend()
    })

    expect(result.current.messagesRef.current["session-1"]).toBeUndefined()
  })

  it("does not send while permission requests are pending", async () => {
    const { result } = renderHook(() =>
      useComposerHarness({
        initialPendingPermissionRequestsBySession: {
          "session-1": [
            {
              id: "permission-1",
              approvalID: "approval-1",
              sessionID: "session-1",
              messageID: "message-1",
              toolCallID: "tool-1",
              projectID: "project-1",
              agent: "agent",
              status: "pending",
              createdAt: 1,
              prompt: {
                title: "Approval required",
                summary: "Pending approval",
                rationale: "",
                risk: "medium",
                detailsAvailable: false,
                allowedDecisions: ["allow", "deny"],
                recommendedDecision: "allow",
              },
            },
          ],
        },
      }),
    )

    await act(async () => {
      await result.current.controller.handleSend()
    })

    expect(result.current.messagesRef.current["session-1"]).toBeUndefined()
  })

  it("creates a session before sending from a create-session tab", async () => {
    const { result } = renderHook(() =>
      useComposerHarness({
        activeCreateSessionTabID: "create-1",
        activeSessionID: null,
        activeTabKey: "create-session:create-1",
      }),
    )

    await act(async () => {
      await result.current.controller.handleSend()
    })

    expect(result.current.createSessionForWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ id: "workspace-1" }),
      expect.objectContaining({
        closeCreateTab: true,
        createSessionTabID: "create-1",
        skipInitialHistoryLoad: true,
      }),
    )
    expect(result.current.messagesRef.current["created-session-1"]).toHaveLength(2)
  })

  it("uses a saved model selection for the first create-session prompt", async () => {
    const previousDesktop = window.desktop
    const sendTurn = vi.fn(async (input: { clientTurnID: string }) => ({
      clientTurnID: input.clientTurnID,
    }))
    const updateSessionModelSelection = vi.fn(async () => ({
      model: "deepseek/deepseek-reasoner",
      reasoning_effort: "high" as const,
    }))
    const updateProjectModelSelection = vi.fn(async () => ({
      model: "deepseek/deepseek-reasoner",
      reasoning_effort: "high" as const,
    }))

    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: {
        createAgentSession: vi.fn(),
        updateProjectModelSelection,
        updateSessionModelSelection,
        agentSession: {
          sendTurn,
        },
      } as unknown as typeof window.desktop,
    })

    try {
      const { result } = renderHook(() =>
        useComposerHarness({
          activeCreateSessionTabID: "create-1",
          activeSessionID: null,
          activeTabKey: "create-session:create-1",
          agentConnected: true,
        }),
      )

      await act(async () => {
        await result.current.controller.handleSend({
          selectedModel: "deepseek/deepseek-reasoner",
          selectedReasoningEffort: "high",
        })
      })

      expect(updateSessionModelSelection).toHaveBeenCalledWith({
        sessionID: "created-session-1",
        model: "deepseek/deepseek-reasoner",
        reasoning_effort: "high",
      })
      expect(updateProjectModelSelection).toHaveBeenCalledWith({
        projectID: "project-1",
        model: "deepseek/deepseek-reasoner",
        reasoning_effort: "high",
      })
      expect(sendTurn).toHaveBeenCalledWith(expect.objectContaining({
        backendSessionID: "created-session-1",
        reasoningEffort: "high",
        model: {
          providerID: "deepseek",
          modelID: "deepseek-reasoner",
        },
      }))
    } finally {
      Object.defineProperty(window, "desktop", {
        configurable: true,
        value: previousDesktop,
      })
    }
  })

  it("drops an unsaved model selection for the first create-session prompt", async () => {
    const previousDesktop = window.desktop
    const sendTurn = vi.fn(async (input: { clientTurnID: string }) => ({
      clientTurnID: input.clientTurnID,
    }))
    const updateSessionModelSelection = vi.fn(async () => {
      throw new Error("model unavailable")
    })
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)

    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: {
        createAgentSession: vi.fn(),
        updateSessionModelSelection,
        agentSession: {
          sendTurn,
        },
      } as unknown as typeof window.desktop,
    })

    try {
      const { result } = renderHook(() =>
        useComposerHarness({
          activeCreateSessionTabID: "create-1",
          activeSessionID: null,
          activeTabKey: "create-session:create-1",
          agentConnected: true,
        }),
      )

      await act(async () => {
        await result.current.controller.handleSend({
          selectedModel: "missing/model",
        })
      })

      expect(updateSessionModelSelection).toHaveBeenCalledWith({
        sessionID: "created-session-1",
        model: "missing/model",
      })
      expect(sendTurn).toHaveBeenCalledTimes(1)
      expect(sendTurn.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
        backendSessionID: "created-session-1",
        text: "New prompt",
      }))
      expect(sendTurn.mock.calls[0]?.[0]).not.toHaveProperty("model")
    } finally {
      consoleError.mockRestore()
      Object.defineProperty(window, "desktop", {
        configurable: true,
        value: previousDesktop,
      })
    }
  })

  it("toggles plan mode for an existing session", async () => {
    const previousDesktop = window.desktop
    const updateSessionWorkflow = vi.fn(async () => ({
      requestId: "request-1",
      session: {
        ...createSession("session-1"),
        workflow: {
          mode: "planning" as const,
          plan: {
            status: "idle" as const,
            updatedAt: 10,
          },
        },
      },
    }))

    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: {
        updateSessionWorkflow,
      } as unknown as typeof window.desktop,
    })

    try {
      const { result } = renderHook(() => useComposerHarness())

      await act(async () => {
        await result.current.controller.handlePlanModeToggle({ sessionID: "session-1" })
      })

      expect(updateSessionWorkflow).toHaveBeenCalledWith({
        sessionID: "session-1",
        action: "enter-plan",
      })
      expect(result.current.workspaces[0]?.sessions[0]?.workflow?.mode).toBe("planning")
    } finally {
      Object.defineProperty(window, "desktop", {
        configurable: true,
        value: previousDesktop,
      })
    }
  })

  it("toggles pending plan mode on a create-session tab without touching the backend", async () => {
    const previousDesktop = window.desktop
    const updateSessionWorkflow = vi.fn()

    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: {
        updateSessionWorkflow,
      } as unknown as typeof window.desktop,
    })

    try {
      const { result } = renderHook(() =>
        useComposerHarness({
          activeCreateSessionTabID: "create-1",
          activeSessionID: null,
          activeTabKey: "create-session:create-1",
        }),
      )

      await act(async () => {
        await result.current.controller.handlePlanModeToggle({ createSessionTabID: "create-1" })
      })

      expect(updateSessionWorkflow).not.toHaveBeenCalled()
      expect(result.current.createSessionTabs[0]?.initialWorkflowMode).toBe("planning")

      await act(async () => {
        await result.current.controller.handlePlanModeToggle({ createSessionTabID: "create-1" })
      })

      expect(result.current.createSessionTabs[0]?.initialWorkflowMode).toBe("execution")
    } finally {
      Object.defineProperty(window, "desktop", {
        configurable: true,
        value: previousDesktop,
      })
    }
  })

  it("enters plan mode before sending the first prompt from a pending planning create-session tab", async () => {
    const previousDesktop = window.desktop
    const updateSessionWorkflow = vi.fn(async () => ({
      requestId: "request-1",
      session: {
        ...createSession("created-session-1"),
        workflow: {
          mode: "planning" as const,
          plan: {
            status: "idle" as const,
            updatedAt: 10,
          },
        },
      },
    }))

    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: {
        updateSessionWorkflow,
      } as unknown as typeof window.desktop,
    })

    try {
      const { result } = renderHook(() =>
        useComposerHarness({
          activeCreateSessionTabID: "create-1",
          activeSessionID: null,
          activeTabKey: "create-session:create-1",
          createSessionInitialWorkflowMode: "planning",
        }),
      )

      await act(async () => {
        await result.current.controller.handleSend()
      })

      expect(result.current.createSessionForWorkspace).toHaveBeenCalled()
      expect(updateSessionWorkflow).toHaveBeenCalledWith({
        sessionID: "created-session-1",
        action: "enter-plan",
      })
      expect(result.current.messagesRef.current["created-session-1"]).toHaveLength(2)
      expect(result.current.workspaces[0]?.sessions.find((session) => session.id === "created-session-1")?.workflow?.mode).toBe(
        "planning",
      )
    } finally {
      Object.defineProperty(window, "desktop", {
        configurable: true,
        value: previousDesktop,
      })
    }
  })

  it("does not send the first create-session prompt when entering plan mode fails", async () => {
    const previousDesktop = window.desktop
    const updateSessionWorkflow = vi.fn(async () => {
      throw new Error("Cannot enter plan mode")
    })

    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: {
        updateSessionWorkflow,
      } as unknown as typeof window.desktop,
    })

    try {
      const { result } = renderHook(() =>
        useComposerHarness({
          activeCreateSessionTabID: "create-1",
          activeSessionID: null,
          activeTabKey: "create-session:create-1",
          createSessionInitialWorkflowMode: "planning",
        }),
      )

      await act(async () => {
        await result.current.controller.handleSend()
      })

      expect(updateSessionWorkflow).toHaveBeenCalledWith({
        sessionID: "created-session-1",
        action: "enter-plan",
      })
      expect(result.current.messagesRef.current["created-session-1"]).toHaveLength(1)
      expect(result.current.messagesRef.current["created-session-1"]?.[0]).toMatchObject({
        kind: "assistant",
        runtime: {
          errorMessage: "Cannot enter plan mode",
        },
      })
    } finally {
      Object.defineProperty(window, "desktop", {
        configurable: true,
        value: previousDesktop,
      })
    }
  })

  it("cancels the active pending stream for the current session", async () => {
    const previousDesktop = window.desktop
    const cancelTurn = vi.fn(async (input: { backendSessionID: string; clientTurnID: string }) => ({
      ...input,
      localRequestAborted: true,
      backendCancelled: true,
    }))

    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: {
        agentSession: {
          cancelTurn,
        },
      } as unknown as typeof window.desktop,
    })

    try {
      const { result } = renderHook(() => useComposerHarness())

      result.current.pendingStreamsRef.current["stream-1"] = {
        assistantThreadMessageID: "assistant-1",
        backendSessionID: "backend-session-1",
        sessionID: "session-1",
      }

      await act(async () => {
        await result.current.controller.handleCancelSend()
      })

      expect(cancelTurn).toHaveBeenCalledWith({
        backendSessionID: "backend-session-1",
        clientTurnID: "stream-1",
      })
      expect(result.current.pendingStreamsRef.current["stream-1"]?.cancelRequested).toBe(true)
    } finally {
      Object.defineProperty(window, "desktop", {
        configurable: true,
        value: previousDesktop,
      })
    }
  })

  it("interrupts a running session even when there is no pending request stream", async () => {
    const previousDesktop = window.desktop
    const interrupt = vi.fn(async (input: { backendSessionID: string; clientTurnID?: string }) => ({
      ...input,
      localRequestsAborted: 0,
      backendCancelled: true,
      activeCancelled: true,
      queuedCancelled: 0,
    }))

    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: {
        agentSession: {
          interrupt,
        },
      } as unknown as typeof window.desktop,
    })

    try {
      const { result } = renderHook(() => useComposerHarness())

      await act(async () => {
        await result.current.controller.handleCancelSend()
      })

      expect(interrupt).toHaveBeenCalledWith({
        backendSessionID: "session-1",
        reason: "user-interrupt",
      })
      expect(result.current.cancellingSessionIDs["session-1"]).toBe(true)
    } finally {
      Object.defineProperty(window, "desktop", {
        configurable: true,
        value: previousDesktop,
      })
    }
  })

  it("passes the pending client turn id to session interrupt", async () => {
    const previousDesktop = window.desktop
    const interrupt = vi.fn(async (input: { backendSessionID: string; clientTurnID?: string }) => ({
      ...input,
      localRequestsAborted: 0,
      backendCancelled: true,
      activeCancelled: true,
      queuedCancelled: 0,
    }))

    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: {
        agentSession: {
          interrupt,
        },
      } as unknown as typeof window.desktop,
    })

    try {
      const { result } = renderHook(() => useComposerHarness())

      result.current.pendingStreamsRef.current["stream-1"] = {
        assistantThreadMessageID: "assistant-1",
        backendSessionID: "backend-session-1",
        sessionID: "session-1",
      }

      await act(async () => {
        await result.current.controller.handleCancelSend()
      })

      expect(interrupt).toHaveBeenCalledWith({
        backendSessionID: "backend-session-1",
        clientTurnID: "stream-1",
        reason: "user-interrupt",
      })
      expect(result.current.pendingStreamsRef.current["stream-1"]?.cancelRequested).toBe(true)
    } finally {
      Object.defineProperty(window, "desktop", {
        configurable: true,
        value: previousDesktop,
      })
    }
  })

  it("restores the pending stream state when backend interrupt is rejected", async () => {
    const previousDesktop = window.desktop
    const interrupt = vi.fn(async (input: { backendSessionID: string; clientTurnID?: string }) => ({
      ...input,
      localRequestsAborted: 0,
      backendCancelled: false,
      backendCancelError: "agent offline",
    }))

    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: {
        agentSession: {
          interrupt,
        },
      } as unknown as typeof window.desktop,
    })

    try {
      const { result } = renderHook(() => useComposerHarness())

      result.current.pendingStreamsRef.current["stream-1"] = {
        assistantThreadMessageID: "assistant-1",
        backendSessionID: "backend-session-1",
        sessionID: "session-1",
      }

      await act(async () => {
        await result.current.controller.handleCancelSend()
      })

      expect(interrupt).toHaveBeenCalledWith({
        backendSessionID: "backend-session-1",
        clientTurnID: "stream-1",
        reason: "user-interrupt",
      })
      expect(result.current.pendingStreamsRef.current["stream-1"]?.cancelRequested).toBe(false)
      expect(result.current.cancellingSessionIDs["session-1"]).toBeUndefined()
    } finally {
      Object.defineProperty(window, "desktop", {
        configurable: true,
        value: previousDesktop,
      })
    }
  })

  it("leaves the visible running tool trace unchanged while waiting for backend cancellation", async () => {
    const previousDesktop = window.desktop
    const interrupt = vi.fn(async (input: { backendSessionID: string; clientTurnID?: string }) => ({
      ...input,
      localRequestsAborted: 0,
      backendCancelled: true,
      activeCancelled: true,
      queuedCancelled: 0,
    }))

    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: {
        agentSession: {
          interrupt,
        },
      } as unknown as typeof window.desktop,
    })

    try {
      const { result } = renderHook(() => useComposerHarness())

      result.current.pendingStreamsRef.current["stream-1"] = {
        assistantThreadMessageID: "assistant-active",
        backendSessionID: "backend-session-1",
        sessionID: "session-1",
      }
      result.current.messagesRef.current["session-1"] = [createStreamingAssistantThreadMessage("assistant-active")]

      await act(async () => {
        await result.current.controller.handleCancelSend()
      })

      expect(interrupt).toHaveBeenCalledWith({
        backendSessionID: "backend-session-1",
        clientTurnID: "stream-1",
        reason: "user-interrupt",
      })
      expect(result.current.pendingStreamsRef.current["stream-1"]?.cancelRequested).toBe(true)
      expect(result.current.cancellingSessionIDs["session-1"]).toBe(true)
      expect(result.current.messagesRef.current["session-1"]?.[0]).toMatchObject({
        kind: "assistant",
        runtime: {
          phase: "tool_running",
        },
        isStreaming: true,
        items: [
          expect.objectContaining({
            kind: "tool",
            status: "running",
          }),
        ],
      })
    } finally {
      Object.defineProperty(window, "desktop", {
        configurable: true,
        value: previousDesktop,
      })
    }
  })

  it("does not mark stale or visible tool traces as cancelled without a backend stream event", async () => {
    const previousDesktop = window.desktop
    const interrupt = vi.fn(async (input: { backendSessionID: string; clientTurnID?: string }) => ({
      ...input,
      localRequestsAborted: 0,
      backendCancelled: true,
      activeCancelled: true,
      queuedCancelled: 0,
    }))

    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: {
        agentSession: {
          interrupt,
        },
      } as unknown as typeof window.desktop,
    })

    try {
      const { result } = renderHook(() => useComposerHarness())

      result.current.pendingStreamsRef.current["stream-1"] = {
        assistantThreadMessageID: "assistant-stale",
        backendSessionID: "backend-session-1",
        sessionID: "session-1",
      }
      result.current.messagesRef.current["session-1"] = [createStreamingAssistantThreadMessage("assistant-visible")]

      await act(async () => {
        await result.current.controller.handleCancelSend()
      })

      expect(interrupt).toHaveBeenCalledWith({
        backendSessionID: "backend-session-1",
        clientTurnID: "stream-1",
        reason: "user-interrupt",
      })
      expect(result.current.messagesRef.current["session-1"]?.[0]).toMatchObject({
        kind: "assistant",
        runtime: {
          phase: "tool_running",
        },
        isStreaming: true,
        items: [
          expect.objectContaining({
            kind: "tool",
            status: "running",
          }),
        ],
      })
    } finally {
      Object.defineProperty(window, "desktop", {
        configurable: true,
        value: previousDesktop,
      })
    }
  })

  it("saves pasted images and adds the resulting files as composer attachments", async () => {
    const previousDesktop = window.desktop
    const saveComposerPastedImages = vi.fn(async () => ["C:\\Temp\\pasted-image.png"])

    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: {
        saveComposerPastedImages,
      } as unknown as typeof window.desktop,
    })

    try {
      const { result } = renderHook(() => useComposerHarness())

      await act(async () => {
        await result.current.controller.handlePasteComposerImageAttachments({
          allowImage: true,
          images: [
            {
              dataUrl: "data:image/png;base64,aW1hZ2U=",
              mimeType: "image/png",
              name: "screenshot.png",
            },
          ],
        })
      })

      expect(saveComposerPastedImages).toHaveBeenCalledWith({
        images: [
          {
            dataUrl: "data:image/png;base64,aW1hZ2U=",
            mimeType: "image/png",
            name: "screenshot.png",
          },
        ],
      })
      expect(result.current.attachmentsByTabKey["session:session-1"]).toEqual([
        {
          path: "C:\\Temp\\pasted-image.png",
          name: "pasted-image.png",
        },
      ])
    } finally {
      Object.defineProperty(window, "desktop", {
        configurable: true,
        value: previousDesktop,
      })
    }
  })
})
