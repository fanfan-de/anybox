import { describe, expect, it } from "vitest"
import {
  applyAgentStreamEventToThreadMessage,
  LIVE_SESSION_ACTIVITY_PRESENTATION,
  RECONNECTING_SESSION_STREAM_PRESENTATION,
} from "../stream"
import type {
  AssistantTraceItem,
  AssistantThreadMessage,
  PendingAgentStream,
  SessionTaskListView,
  ThreadMessage,
  UserThreadMessage,
} from "../types"
import {
  applyExecutionModeToUserMessagePresentation,
  compactHighFrequencyDeltaStreamEvent,
  conversationMessagesAreEquivalent,
  clearSessionStreamReconnectReplayWindow,
  ensureAssistantThreadMessagePresentation,
  findPendingStreamForBackendTurn,
  isBackendUserMessageRecordedStreamEvent,
  isCompletedStreamEvent,
  isHighFrequencyDeltaStreamEvent,
  isLlmCompletedStreamEvent,
  isPermissionRequestStreamEvent,
  isSteerHandoffBoundaryStreamEvent,
  isSteerInputConsumedStreamEvent,
  isSubagentCreatedStreamEvent,
  isTaskStateStreamEvent,
  isTerminalStreamEvent,
  mergeConversationMessagesFromHistory,
  mergeExternalUserMessagesFromHistory,
  noteSessionStreamSubscriptionStateForPresentation,
  readLatestSessionContextUsageFromHistory,
  readSubagentCreatedChildSessionID,
  readSessionContextUsageFromDoneEventData,
  readSessionContextUsageFromLlmCompletedEventData,
  readSessionTaskListViewFromStreamEvent,
  reconcileConversationMessages,
  revealBackendRecordedUserMessagePresentation,
  revealPendingSteerUserMessagesAtHandoffPresentation,
  resolveExecutionModeRoute,
  resolveRuntimeThreadTurnStatus,
  resolveSessionStreamPlaceholderPresentation,
  resolveStreamMessageID,
  resolveStreamCursor,
  resolveStreamTurnID,
  SESSION_STREAM_RECONNECT_REPLAY_WINDOW_MS,
  type SessionStreamReconnectReplayWindows,
  shouldRefreshRuntimeDebugForStreamEvent,
  STEER_INPUT_CONSUMED_STATE_REASON,
} from "./session-stream-controller"
import { createConversationStore } from "./conversation-store"

function createUserThreadMessage(id: string, text: string): UserThreadMessage {
  return {
    id,
    kind: "user",
    text,
    timestamp: 1,
  }
}

describe("resolveRuntimeThreadTurnStatus", () => {
  it("maps every terminal state carried by runtime state changes", () => {
    expect(resolveRuntimeThreadTurnStatus({ eventType: "turn.state.changed", payloadPhase: "blocked" })).toBe("blocked")
    expect(resolveRuntimeThreadTurnStatus({ eventType: "turn.state.changed", payloadStatus: "stopped" })).toBe("stopped")
    expect(resolveRuntimeThreadTurnStatus({ eventType: "turn.state.changed", payloadPhase: "continued_by_user" })).toBe(
      "continued_by_user",
    )
  })

  it("returns to running and gives explicit terminal events precedence", () => {
    expect(resolveRuntimeThreadTurnStatus({ eventType: "turn.state.changed", payloadPhase: "waiting_llm" })).toBe("running")
    expect(resolveRuntimeThreadTurnStatus({ eventType: "turn.failed", payloadStatus: "completed" })).toBe("failed")
    expect(resolveRuntimeThreadTurnStatus({ eventType: "turn.cancelled", payloadStatus: "completed" })).toBe("cancelled")
    expect(resolveRuntimeThreadTurnStatus({ eventType: "turn.completed" })).toBe("completed")
  })
})

function createAssistantThreadMessage(id: string, itemID: string, text: string, sourceID = "source-1", messageID?: string): AssistantThreadMessage {
  return {
    id,
    messageID,
    kind: "assistant",
    backendTurnID: "turn-test",
    segmentID: messageID ? `${messageID}:1` : id,
    timestamp: 2,
    runtime: {
      phase: "completed",
      startedAt: 2,
      updatedAt: 3,
    },
    state: "completed",
    items: [
      {
        id: itemID,
        kind: "text",
        label: "Response",
        sourceID,
        text,
        timestamp: 3,
      },
    ],
  }
}

function createCancelledAssistantThreadMessage(id: string, messageID?: string): AssistantThreadMessage {
  return {
    id,
    messageID,
    kind: "assistant",
    backendTurnID: "turn-test",
    segmentID: messageID ? `${messageID}:1` : id,
    timestamp: 2,
    runtime: {
      phase: "cancelled",
      startedAt: 2,
      updatedAt: 3,
    },
    state: "Backend stream cancelled",
    isStreaming: false,
    items: [
      {
        id: `${id}-cancelled`,
        kind: "system",
        label: "System",
        title: "Execution cancelled",
        detail: "Prompt cancellation requested.",
        status: "completed",
        sourceID: `${id}:cancelled`,
        timestamp: 3,
      },
    ],
  }
}

function createPendingToolAssistantThreadMessage(id: string, messageID?: string): AssistantThreadMessage {
  return {
    id,
    messageID,
    kind: "assistant",
    backendTurnID: "turn-test",
    segmentID: messageID ? `${messageID}:1` : id,
    timestamp: 4,
    runtime: {
      phase: "tool_running",
      startedAt: 4,
      updatedAt: 5,
      toolName: "replace-text",
    },
    state: "Backend response in progress",
    isStreaming: true,
    items: [
      {
        id: `${id}-tool`,
        kind: "tool",
        label: "Tool",
        title: "replace-text",
        status: "pending",
        sourceID: "late-tool-input-part",
        partID: "late-tool-input-part",
        messageID,
        toolCallID: "late-tool-call",
        toolInputText: "{\"path\":\"game.ts\"",
        timestamp: 5,
      },
    ],
  }
}

function createCancelledToolAssistantThreadMessage(id: string, messageID?: string): AssistantThreadMessage {
  return {
    id,
    messageID,
    kind: "assistant",
    backendTurnID: "turn-test",
    segmentID: messageID ? `${messageID}:1` : id,
    timestamp: 2,
    runtime: {
      phase: "cancelled",
      startedAt: 2,
      updatedAt: 3,
    },
    state: "Backend stream cancelled",
    isStreaming: false,
    items: [
      {
        id: `${id}-tool`,
        kind: "tool",
        label: "Tool",
        title: "replace-text",
        status: "cancelled",
        sourceID: "late-tool-input-part",
        partID: "late-tool-input-part",
        messageID,
        toolCallID: "late-tool-call",
        toolInputText: "{\"path\":\"game.ts\"",
        timestamp: 3,
        isStreaming: false,
      },
      {
        id: `${id}-cancelled`,
        kind: "system",
        label: "System",
        title: "Execution cancelled",
        detail: "Prompt cancellation requested.",
        status: "completed",
        sourceID: `${id}:cancelled`,
        timestamp: 4,
      },
    ],
  }
}

function createErroredToolAssistantThreadMessage(id: string, messageID?: string): AssistantThreadMessage {
  return {
    id,
    messageID,
    kind: "assistant",
    backendTurnID: "turn-test",
    segmentID: messageID ? `${messageID}:1` : id,
    timestamp: 4,
    runtime: {
      phase: "failed",
      startedAt: 4,
      updatedAt: 5,
      errorMessage: "Late tool failure",
    },
    state: "Backend request failed",
    isStreaming: false,
    items: [
      {
        id: `${id}-tool`,
        kind: "tool",
        label: "Tool",
        title: "replace-text",
        status: "error",
        sourceID: "late-tool-input-part",
        partID: "late-tool-input-part",
        messageID,
        toolCallID: "late-tool-call",
        timestamp: 5,
        isStreaming: false,
      },
    ],
  }
}

function createRuntimeEvent(type: string, payload: Record<string, unknown> = {}) {
  return {
    type,
    eventID: "runtime-cursor-1",
    sessionID: "backend-session-1",
    turnID: "backend-turn-1",
    seq: 7,
    timestamp: 456,
    payload,
  }
}

function createTaskListView(): SessionTaskListView {
  const task = {
    id: "task-1",
    sessionID: "backend-session-1",
    subject: "Run checks",
    description: "",
    activeForm: "Running checks",
    owner: "codex",
    status: "in_progress" as const,
    sortIndex: 1,
    blocks: [],
    blockedBy: [],
    metadata: {},
    createdAt: 1,
    updatedAt: 2,
    startedAt: 2,
    isBlocked: false,
    blockingTasks: [],
    blockedTasks: [],
  }

  return {
    sessionID: "backend-session-1",
    generatedAt: 3,
    tasks: [task],
    current: [task],
    next: [],
    blocked: [],
    owners: [
      {
        owner: "codex",
        current: task,
      },
    ],
    teammateActivity: [],
    summary: {
      total: 1,
      completed: 0,
      pending: 0,
      inProgress: 1,
      blocked: 0,
    },
  }
}

describe("session stream controller helpers", () => {
  it("resolves request/session cursors and backend turn IDs from runtime and legacy events", () => {
    const runtimeData = createRuntimeEvent("turn.completed")

    expect(resolveStreamCursor({ id: "runtime-cursor-1", data: runtimeData })).toBe("456:backend-turn-1:7")
    expect(resolveStreamCursor({ data: runtimeData })).toBe("456:backend-turn-1:7")
    expect(resolveStreamTurnID({ data: runtimeData })).toBe("backend-turn-1")

    expect(resolveStreamCursor({ data: { cursor: "legacy-cursor-1", turnID: "legacy-turn-1" } })).toBe("legacy-cursor-1")
    expect(resolveStreamTurnID({ data: { cursor: "legacy-cursor-1", turnID: "legacy-turn-1" } })).toBe("legacy-turn-1")
  })

  it("resolves assistant message IDs from runtime part and terminal events", () => {
    expect(resolveStreamMessageID({
      data: createRuntimeEvent("text.part.delta", {
        messageID: "message-assistant-direct",
        partID: "part-text-1",
        delta: "token",
      }),
    })).toBe("message-assistant-direct")
    expect(resolveStreamMessageID({
      data: createRuntimeEvent("tool.call.completed", {
        part: {
          id: "part-tool-1",
          messageID: "message-assistant-1",
          type: "tool",
        },
      }),
    })).toBe("message-assistant-1")
    expect(resolveStreamMessageID({
      data: createRuntimeEvent("turn.completed", {
        message: {
          id: "message-assistant-2",
        },
      }),
    })).toBe("message-assistant-2")
    expect(resolveStreamMessageID({
      data: createRuntimeEvent("turn.completed", {
        message: {
          id: "message-assistant-final",
        },
        parts: [
          {
            id: "part-old-tool",
            messageID: "message-assistant-old-tool",
            type: "tool",
          },
        ],
      }),
    })).toBe("message-assistant-final")
    expect(resolveStreamMessageID({
      data: {
        parts: [
          {
            id: "part-tool-2",
            messageID: "message-assistant-3",
            type: "tool",
          },
        ],
      },
    })).toBe("message-assistant-3")
  })

  it("classifies terminal, completed, and permission events across stream formats", () => {
    expect(isTerminalStreamEvent({ event: "runtime", data: createRuntimeEvent("turn.failed") })).toBe(true)
    expect(isCompletedStreamEvent({ event: "runtime", data: createRuntimeEvent("turn.completed") })).toBe(true)
    expect(isLlmCompletedStreamEvent({ event: "runtime", data: createRuntimeEvent("llm.call.completed") })).toBe(true)
    expect(isPermissionRequestStreamEvent({ event: "runtime", data: createRuntimeEvent("permission.requested") })).toBe(true)
    expect(isPermissionRequestStreamEvent({
      event: "part",
      data: {
        part: {
          type: "permission",
          action: "ask",
        },
      },
    })).toBe(true)
    expect(isTaskStateStreamEvent({ event: "runtime", data: createRuntimeEvent("task.state.updated") })).toBe(true)
    expect(isTaskStateStreamEvent({
      event: "part",
      data: {
        part: {
          type: "tool",
          state: {
            status: "completed",
            metadata: {
              kind: "task-state",
            },
          },
        },
      },
    })).toBe(true)
    expect(isSubagentCreatedStreamEvent({
      event: "runtime",
      data: createRuntimeEvent("subagent.created", {
        taskID: "task-subagent-1",
        childSessionID: "ses_child_1",
        title: "Inspect docs",
        agent: "default",
        status: "running",
        updatedAt: 123,
      }),
    })).toBe(true)
    expect(readSubagentCreatedChildSessionID({
      event: "runtime",
      data: createRuntimeEvent("subagent.created", {
        taskID: "task-subagent-1",
        childSessionID: "ses_child_1",
        title: "Inspect docs",
        agent: "default",
        status: "running",
        updatedAt: 123,
      }),
    })).toBe("ses_child_1")
    expect(isSubagentCreatedStreamEvent({
      event: "part",
      data: {
        part: {
          type: "tool",
          tool: "spawn_subagent",
          state: {
            status: "completed",
          },
        },
      },
    })).toBe(false)
    expect(readSubagentCreatedChildSessionID({
      event: "part",
      data: {
        part: {
          type: "tool",
          tool: "spawn_subagent",
          state: {
            status: "completed",
          },
        },
      },
    })).toBeNull()
  })

  it("detects steer consumption from runtime state events", () => {
    expect(isSteerInputConsumedStreamEvent({
      event: "runtime",
      data: createRuntimeEvent("turn.state.changed", {
        phase: "waiting_llm",
        reason: STEER_INPUT_CONSUMED_STATE_REASON,
      }),
    })).toBe(true)

    expect(isSteerInputConsumedStreamEvent({
      event: "runtime",
      data: createRuntimeEvent("turn.state.changed", {
        phase: "waiting_llm",
        reason: "Waiting for model stream",
      }),
    })).toBe(false)

    expect(isSteerInputConsumedStreamEvent({
      event: "runtime",
      data: createRuntimeEvent("llm.call.started"),
    })).toBe(false)
  })

  it("detects backend-recorded user messages from runtime events", () => {
    expect(isBackendUserMessageRecordedStreamEvent({
      event: "runtime",
      data: createRuntimeEvent("message.recorded", {
        message: {
          id: "message-user",
          role: "user",
        },
      }),
    })).toBe(true)

    expect(isBackendUserMessageRecordedStreamEvent({
      event: "runtime",
      data: createRuntimeEvent("message.recorded", {
        message: {
          id: "message-assistant",
          role: "assistant",
        },
      }),
    })).toBe(false)

    expect(isBackendUserMessageRecordedStreamEvent({
      event: "runtime",
      data: createRuntimeEvent("turn.started"),
    })).toBe(false)
  })

  it("detects steer handoff boundaries from runtime events", () => {
    expect(isSteerHandoffBoundaryStreamEvent({
      event: "runtime",
      data: createRuntimeEvent("turn.state.changed", {
        phase: "continued_by_user",
        reason: "Continued by user input.",
      }),
    })).toBe(true)

    expect(isSteerHandoffBoundaryStreamEvent({
      event: "runtime",
      data: createRuntimeEvent("turn.completed", {
        status: "continued_by_user",
      }),
    })).toBe(true)

    expect(isSteerHandoffBoundaryStreamEvent({
      event: "runtime",
      data: createRuntimeEvent("turn.completed", {
        status: "completed",
      }),
    })).toBe(false)

    expect(isSteerHandoffBoundaryStreamEvent({
      event: "runtime",
      data: createRuntimeEvent("message.recorded", {
        message: {
          id: "message-user",
          role: "user",
        },
      }),
    })).toBe(false)
  })

  it("routes execution mode metadata", () => {
    expect(resolveExecutionModeRoute({
      mode: "steer",
      requestedMode: "steer",
      currentAssistantThreadMessageID: "assistant-temp",
      createdAssistantThreadMessageID: "assistant-temp",
      existingAssistantThreadMessageID: "assistant-backend",
    })).toEqual({
      assistantThreadMessageID: "assistant-backend",
      clearSteerUserMessage: false,
      createAssistantThreadMessage: false,
      removeAssistantThreadMessageID: "assistant-temp",
    })

    expect(resolveExecutionModeRoute({
      mode: "steer",
      requestedMode: "steer",
      currentAssistantThreadMessageID: "assistant-active",
      createdAssistantThreadMessageID: "assistant-steer",
    })).toEqual({
      assistantThreadMessageID: "assistant-steer",
      clearSteerUserMessage: false,
      createAssistantThreadMessage: false,
    })

    expect(resolveExecutionModeRoute({
      mode: "queued",
      requestedMode: "steer",
      currentAssistantThreadMessageID: "assistant-active",
    })).toEqual({
      assistantThreadMessageID: "assistant-active",
      clearSteerUserMessage: true,
      createAssistantThreadMessage: true,
    })

    expect(resolveExecutionModeRoute({
      mode: "new-turn",
      requestedMode: "new-turn",
      currentAssistantThreadMessageID: "assistant-new",
    })).toEqual({
      assistantThreadMessageID: "assistant-new",
      clearSteerUserMessage: false,
      createAssistantThreadMessage: false,
    })

    expect(resolveExecutionModeRoute({
      mode: "queued",
      requestedMode: "queue",
      currentAssistantThreadMessageID: "assistant-queued-placeholder",
    })).toEqual({
      assistantThreadMessageID: "assistant-queued-placeholder",
      clearSteerUserMessage: false,
      createAssistantThreadMessage: false,
    })
  })

  it("applies backend execution mode to pending user message presentation", () => {
    const pendingUser: UserThreadMessage = {
      ...createUserThreadMessage("user-pending", "Continue with this"),
      submissionMode: "queued",
    }
    const assistant = createPendingToolAssistantThreadMessage("assistant-active")

    const nextMessages = applyExecutionModeToUserMessagePresentation({
      messages: [assistant, pendingUser],
      userThreadMessageID: pendingUser.id,
      assistantThreadMessageID: assistant.id,
      mode: "new-turn",
    })
    expect(nextMessages[1]).toMatchObject({
      id: pendingUser.id,
      kind: "user",
      text: "Continue with this",
    })
    expect(nextMessages[1]).not.toHaveProperty("submissionMode")
    expect(nextMessages[1]).not.toHaveProperty("streamInsertion")

    const queuedMessages = applyExecutionModeToUserMessagePresentation({
      messages: [
        assistant,
        {
          ...pendingUser,
          submissionMode: "steer",
          streamInsertion: {
            assistantThreadMessageID: assistant.id,
            afterItemCount: 1,
            status: "pending",
          },
        },
      ],
      userThreadMessageID: pendingUser.id,
      assistantThreadMessageID: assistant.id,
      mode: "queued",
    })
    expect(queuedMessages[1]).toMatchObject({
      id: pendingUser.id,
      kind: "user",
      submissionMode: "queued",
    })
    expect(queuedMessages[1]).not.toHaveProperty("streamInsertion")

    const steerMessages = applyExecutionModeToUserMessagePresentation({
      messages: [
        assistant,
        {
          ...pendingUser,
          submissionMode: "steer",
          streamInsertion: {
            assistantThreadMessageID: assistant.id,
            afterItemCount: assistant.items.length,
            status: "pending",
          },
        },
      ],
      userThreadMessageID: pendingUser.id,
      assistantThreadMessageID: assistant.id,
      mode: "steer",
    })
    expect(steerMessages[1]).toMatchObject({
      id: pendingUser.id,
      kind: "user",
      submissionMode: "steer",
      streamInsertion: {
        assistantThreadMessageID: assistant.id,
        afterItemCount: assistant.items.length,
        status: "pending",
      },
    })

    const recordedMessages = revealBackendRecordedUserMessagePresentation({
      messages: steerMessages,
      userThreadMessageID: pendingUser.id,
    })
    expect(recordedMessages[1]).toMatchObject({
      id: pendingUser.id,
      kind: "user",
      text: "Continue with this",
    })
    expect(recordedMessages[1]).not.toHaveProperty("submissionMode")
    expect(recordedMessages[1]).not.toHaveProperty("streamInsertion")
  })

  it("reveals pending steer user messages at the continued-by-user handoff boundary", () => {
    const assistant = createPendingToolAssistantThreadMessage("assistant-active")
    const otherAssistant = createPendingToolAssistantThreadMessage("assistant-other")
    const pendingSteer: UserThreadMessage = {
      ...createUserThreadMessage("user-steer", "Stop task"),
      submissionMode: "steer",
    }
    const queued: UserThreadMessage = {
      ...createUserThreadMessage("user-queued", "Run after this"),
      submissionMode: "queued",
    }
    const insertedForAssistant: UserThreadMessage = {
      ...createUserThreadMessage("user-inserted", "Guide here"),
      submissionMode: "steer",
      streamInsertion: {
        assistantThreadMessageID: assistant.id,
        afterItemCount: 1,
        status: "pending",
      },
    }
    const insertedForOtherAssistant: UserThreadMessage = {
      ...createUserThreadMessage("user-other", "Guide elsewhere"),
      submissionMode: "steer",
      streamInsertion: {
        assistantThreadMessageID: otherAssistant.id,
        afterItemCount: 1,
        status: "pending",
      },
    }
    const consumedInsertion: UserThreadMessage = {
      ...createUserThreadMessage("user-consumed", "Already shown"),
      submissionMode: "steer",
      streamInsertion: {
        assistantThreadMessageID: assistant.id,
        afterItemCount: 1,
        status: "consumed",
      },
    }

    const nextMessages = revealPendingSteerUserMessagesAtHandoffPresentation({
      messages: [
        assistant,
        pendingSteer,
        queued,
        insertedForAssistant,
        insertedForOtherAssistant,
        consumedInsertion,
      ],
      assistantThreadMessageID: assistant.id,
    })

    expect(nextMessages[1]).toMatchObject({
      id: pendingSteer.id,
      kind: "user",
      text: pendingSteer.text,
    })
    expect(nextMessages[1]).not.toHaveProperty("submissionMode")
    expect(nextMessages[1]).not.toHaveProperty("streamInsertion")

    expect(nextMessages[2]).toMatchObject({
      id: queued.id,
      kind: "user",
      submissionMode: "queued",
    })

    expect(nextMessages[3]).toMatchObject({
      id: insertedForAssistant.id,
      kind: "user",
      text: insertedForAssistant.text,
    })
    expect(nextMessages[3]).not.toHaveProperty("submissionMode")
    expect(nextMessages[3]).not.toHaveProperty("streamInsertion")

    expect(nextMessages[4]).toMatchObject({
      id: insertedForOtherAssistant.id,
      kind: "user",
      submissionMode: "steer",
      streamInsertion: {
        assistantThreadMessageID: otherAssistant.id,
        status: "pending",
      },
    })
    expect(nextMessages[5]).toMatchObject({
      id: consumedInsertion.id,
      kind: "user",
      submissionMode: "steer",
      streamInsertion: {
        assistantThreadMessageID: assistant.id,
        status: "consumed",
      },
    })
  })

  it("ensures a missing stream assistant target before applying live events", () => {
    const messages: ThreadMessage[] = [
      createUserThreadMessage("user-1", "Prompt"),
    ]

    const nextMessages = ensureAssistantThreadMessagePresentation({
      messages,
      assistantThreadMessageID: "assistant-steer",
      presentation: LIVE_SESSION_ACTIVITY_PRESENTATION,
    })

    expect(nextMessages).toHaveLength(2)
    expect(nextMessages[1]).toMatchObject({
      id: "assistant-steer",
      kind: "assistant",
      isStreaming: true,
      state: "Waiting for agent stream",
      items: [
        expect.objectContaining({
          sourceID: "assistant-steer:stream-placeholder",
          title: "Receiving backend session activity",
          detail: "Applying live backend session updates.",
          status: "pending",
        }),
      ],
    })

    expect(ensureAssistantThreadMessagePresentation({
      messages: nextMessages,
      assistantThreadMessageID: "assistant-steer",
    })).toBe(nextMessages)
  })

  it("selects reconnect presentation only for the active reconnect replay window", () => {
    const windows: SessionStreamReconnectReplayWindows = {}

    expect(resolveSessionStreamPlaceholderPresentation({
      windows,
      backendSessionID: "backend-1",
      backendTurnID: "turn-live",
      now: 100,
    })).toBe(LIVE_SESSION_ACTIVITY_PRESENTATION)

    noteSessionStreamSubscriptionStateForPresentation(windows, {
      kind: "subscription-state",
      backendSessionID: "backend-1",
      state: "reconnecting",
      receivedAt: 100,
    }, 100)
    noteSessionStreamSubscriptionStateForPresentation(windows, {
      kind: "subscription-state",
      backendSessionID: "backend-1",
      state: "connected",
      receivedAt: 110,
    }, 110)

    expect(resolveSessionStreamPlaceholderPresentation({
      windows,
      backendSessionID: "backend-1",
      backendTurnID: "turn-replay",
      now: 120,
    })).toBe(RECONNECTING_SESSION_STREAM_PRESENTATION)
    expect(windows["backend-1"]?.turnID).toBe("turn-replay")
    expect(resolveSessionStreamPlaceholderPresentation({
      windows,
      backendSessionID: "backend-1",
      backendTurnID: "turn-live",
      now: 130,
    })).toBe(LIVE_SESSION_ACTIVITY_PRESENTATION)
    expect(resolveSessionStreamPlaceholderPresentation({
      windows,
      backendSessionID: "backend-1",
      backendTurnID: "turn-replay",
      isTerminal: true,
      now: 140,
    })).toBe(RECONNECTING_SESSION_STREAM_PRESENTATION)
    expect(windows["backend-1"]).toBeUndefined()
  })

  it("expires and clears reconnect replay windows", () => {
    const windows: SessionStreamReconnectReplayWindows = {}

    noteSessionStreamSubscriptionStateForPresentation(windows, {
      kind: "subscription-state",
      backendSessionID: "backend-1",
      state: "reconnecting",
      receivedAt: 100,
    }, 100)
    expect(resolveSessionStreamPlaceholderPresentation({
      windows,
      backendSessionID: "backend-1",
      backendTurnID: "turn-expired",
      now: 101 + SESSION_STREAM_RECONNECT_REPLAY_WINDOW_MS,
    })).toBe(LIVE_SESSION_ACTIVITY_PRESENTATION)
    expect(windows["backend-1"]).toBeUndefined()

    noteSessionStreamSubscriptionStateForPresentation(windows, {
      kind: "subscription-state",
      backendSessionID: "backend-1",
      state: "reconnecting",
      receivedAt: 200,
    }, 200)
    clearSessionStreamReconnectReplayWindow(windows, "backend-1")
    expect(resolveSessionStreamPlaceholderPresentation({
      windows,
      backendSessionID: "backend-1",
      backendTurnID: "turn-cleared",
      now: 210,
    })).toBe(LIVE_SESSION_ACTIVITY_PRESENTATION)
  })

  it("matches pending streams by exact turn before unique unbound fallback", () => {
    const exact: PendingAgentStream = {
      sessionID: "session-1",
      backendSessionID: "backend-1",
      backendTurnID: "turn-1",
      assistantThreadMessageID: "assistant-exact",
    }
    const unbound: PendingAgentStream = {
      sessionID: "session-1",
      backendSessionID: "backend-1",
      assistantThreadMessageID: "assistant-unbound",
    }

    expect(findPendingStreamForBackendTurn({ exact, unbound }, {
      sessionID: "session-1",
      backendSessionID: "backend-1",
      turnID: "turn-1",
    })).toBe(exact)
    expect(findPendingStreamForBackendTurn({ unbound }, {
      sessionID: "session-1",
      backendSessionID: "backend-1",
      turnID: "turn-2",
    })).toBe(unbound)
  })

  it("does not guess between multiple unbound pending streams", () => {
    const first: PendingAgentStream = {
      sessionID: "session-1",
      backendSessionID: "backend-1",
      assistantThreadMessageID: "assistant-first",
    }
    const second: PendingAgentStream = {
      sessionID: "session-1",
      backendSessionID: "backend-1",
      assistantThreadMessageID: "assistant-second",
    }

    expect(findPendingStreamForBackendTurn({ first, second }, {
      sessionID: "session-1",
      backendSessionID: "backend-1",
      turnID: "turn-2",
    })).toBeUndefined()
  })

  it("reads task snapshots directly from runtime and tool part events", () => {
    const taskList = createTaskListView()

    expect(readSessionTaskListViewFromStreamEvent({
      event: "runtime",
      data: createRuntimeEvent("task.state.updated", {
        state: taskList,
      }),
    })).toBe(taskList)

    expect(readSessionTaskListViewFromStreamEvent({
      event: "part",
      data: {
        part: {
          type: "tool",
          state: {
            status: "completed",
            metadata: {
              kind: "task-state",
              state: taskList,
            },
          },
        },
      },
    })).toBe(taskList)
  })

  it("skips runtime debug refreshes for high-frequency text deltas", () => {
    expect(shouldRefreshRuntimeDebugForStreamEvent({
      event: "runtime",
      data: createRuntimeEvent("text.part.delta"),
    })).toBe(false)
    expect(shouldRefreshRuntimeDebugForStreamEvent({
      event: "runtime",
      data: createRuntimeEvent("reasoning.part.delta"),
    })).toBe(false)
    expect(shouldRefreshRuntimeDebugForStreamEvent({
      event: "runtime",
      data: createRuntimeEvent("tool.input.delta"),
    })).toBe(false)
    expect(shouldRefreshRuntimeDebugForStreamEvent({
      event: "delta",
      data: { kind: "text", delta: "token" },
    })).toBe(false)
    expect(shouldRefreshRuntimeDebugForStreamEvent({
      event: "runtime",
      data: createRuntimeEvent("turn.state.changed"),
    })).toBe(true)
    expect(shouldRefreshRuntimeDebugForStreamEvent({
      event: "runtime",
      data: createRuntimeEvent("turn.completed"),
    })).toBe(true)
  })

  it("classifies only text delta events as high-frequency batch candidates", () => {
    expect(isHighFrequencyDeltaStreamEvent({
      event: "runtime",
      data: createRuntimeEvent("text.part.delta"),
    })).toBe(true)
    expect(isHighFrequencyDeltaStreamEvent({
      event: "runtime",
      data: createRuntimeEvent("reasoning.part.delta"),
    })).toBe(true)
    expect(isHighFrequencyDeltaStreamEvent({
      event: "runtime",
      data: createRuntimeEvent("tool.input.delta"),
    })).toBe(true)
    expect(isHighFrequencyDeltaStreamEvent({
      event: "delta",
      data: { kind: "text", delta: "token" },
    })).toBe(true)
    expect(isHighFrequencyDeltaStreamEvent({
      event: "runtime",
      data: createRuntimeEvent("text.part.started"),
    })).toBe(false)
    expect(isHighFrequencyDeltaStreamEvent({
      event: "runtime",
      data: createRuntimeEvent("tool.call.pending"),
    })).toBe(false)
    expect(isHighFrequencyDeltaStreamEvent({
      event: "runtime",
      data: createRuntimeEvent("turn.completed"),
    })).toBe(false)
  })

  it("drops cumulative text from queued high-frequency delta events", () => {
    const compacted = compactHighFrequencyDeltaStreamEvent({
      id: "cursor-1",
      event: "runtime",
      data: createRuntimeEvent("text.part.delta", {
        delta: "token",
        text: "large cumulative response",
        messageID: "message-1",
        partID: "part-1",
      }),
    })

    expect((compacted.data as { payload: Record<string, unknown> }).payload).toEqual({
      delta: "token",
      messageID: "message-1",
      partID: "part-1",
    })

    const legacyCompacted = compactHighFrequencyDeltaStreamEvent({
      event: "delta",
      data: {
        delta: "token",
        kind: "text",
        text: "large cumulative response",
      },
    })

    expect(legacyCompacted.data).toEqual({
      delta: "token",
      kind: "text",
    })
  })

  it("applies high-frequency delta batches only to the targeted assistant in turn storage", () => {
    const targetMessage = {
      ...createAssistantThreadMessage("assistant-target", "target-part", "Hello", "target-part", "message-target"),
      runtime: {
        phase: "responding" as const,
        startedAt: 2,
        updatedAt: 3,
      },
      isStreaming: true,
    }
    const otherMessage = createAssistantThreadMessage("assistant-other", "other-part", "Other", "other-part", "message-other")
    const store = createConversationStore({
      "session-1": [targetMessage, otherMessage],
    })
    const originalOtherMessage = store.getSessionMessages("session-1")[1]
    const streamEvents = [
      {
        event: "runtime",
        data: createRuntimeEvent("text.part.delta", {
          delta: " world",
          messageID: "message-target",
          partID: "target-part",
        }),
      },
      {
        event: "runtime",
        data: createRuntimeEvent("text.part.delta", {
          delta: "!",
          messageID: "message-target",
          partID: "target-part",
        }),
      },
    ]

    const didUpdate = store.appendAssistantDelta("session-1", "assistant-target", (message) =>
      streamEvents.reduce(
        (nextMessage, streamEvent) => applyAgentStreamEventToThreadMessage(nextMessage, streamEvent),
        message,
      ),
    )
    const messages = store.getSessionMessages("session-1")

    expect(didUpdate).toBe(true)
    expect(messages[1]).toBe(originalOtherMessage)
    expect(messages[0]?.kind).toBe("assistant")
    if (messages[0]?.kind !== "assistant") return
    expect(messages[0].items.find((item) => item.sourceID === "target-part")?.text).toBe("Hello world!")
  })

  it("reads context usage from in-turn LLM completion events", () => {
    expect(readSessionContextUsageFromLlmCompletedEventData(createRuntimeEvent("llm.call.completed", {
      usage: {
        inputTokens: 64_000,
        outputTokens: 800,
        reasoningTokens: 120,
        cacheReadTokens: 32_000,
        cacheWriteTokens: 16,
      },
    }))).toEqual({
      inputTokens: 64_000,
      outputTokens: 800,
      totalTokens: 64_800,
      reasoningTokens: 120,
      cacheReadTokens: 32_000,
      cacheWriteTokens: 16,
      measuredAt: 456,
    })

    expect(readSessionContextUsageFromLlmCompletedEventData(createRuntimeEvent("turn.completed", {
      usage: {
        inputTokens: 64_000,
      },
    }))).toBeNull()
  })

  it("reads context usage from stream completion payloads and history messages", () => {
    const message = {
      id: "message-1",
      sessionID: "session-1",
      role: "assistant",
      created: 100,
      tokens: {
        input: 10,
        output: 5,
        reasoning: 3,
        cache: {
          read: 2,
          write: 1,
        },
      },
      completed: 123,
    } as const

    expect(readSessionContextUsageFromDoneEventData(createRuntimeEvent("turn.completed", { message }))).toEqual({
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      reasoningTokens: 3,
      cacheReadTokens: 2,
      cacheWriteTokens: 1,
      measuredAt: 123,
    })
    expect(readLatestSessionContextUsageFromHistory([
      {
        info: {
          id: "message-user-with-tokens",
          sessionID: "session-1",
          role: "user",
          created: 80,
          tokens: {
            input: 1000,
            output: 1000,
          },
        },
        parts: [],
      },
    ])).toBeNull()
    expect(readLatestSessionContextUsageFromHistory([
      {
        info: {
          id: "message-user-with-tokens",
          sessionID: "session-1",
          role: "user",
          created: 80,
          tokens: {
            input: 1000,
            output: 1000,
          },
        },
        parts: [],
      },
      {
        info: {
          id: "message-0",
          sessionID: "session-1",
          role: "user",
          created: 90,
        },
        parts: [],
      },
      { info: message, parts: [] },
    ])).toMatchObject({
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
    })
  })

  it("preserves user presentation and assistant identity when history reloads", () => {
    const previousUser: UserThreadMessage = {
      ...createUserThreadMessage("user-local", "local display"),
      displayText: "local display",
      attachments: [{ name: "design.png", path: "C:/tmp/design.png" }],
      references: [{ id: "ref-1", label: "src/App.tsx", kind: "file" }],
    }
    const previousAssistant = createAssistantThreadMessage("assistant-local", "item-local", "Done", "source-1")
    const nextMessages: ThreadMessage[] = [
      createUserThreadMessage("user-history", "history text"),
      createAssistantThreadMessage("assistant-history", "item-history", "Done", "source-1", "msg-assistant-history"),
    ]

    const merged = mergeConversationMessagesFromHistory([previousUser, previousAssistant], nextMessages)

    expect(merged[0]).toMatchObject({
      id: "user-history",
      kind: "user",
      displayText: "local display",
      attachments: previousUser.attachments,
      references: previousUser.references,
    })
    expect(merged[1]).toMatchObject({
      id: "assistant-local",
      messageID: "msg-assistant-history",
      items: [
        expect.objectContaining({
          id: "item-local",
          sourceID: "source-1",
        }),
      ],
    })
  })

  it("inserts externally persisted user messages before the streaming assistant placeholder", () => {
    const streamingAssistant: AssistantThreadMessage = {
      ...createAssistantThreadMessage("assistant-streaming", "item-streaming", "Streaming reply"),
      timestamp: 20,
      isStreaming: true,
      runtime: {
        phase: "waiting_first_event",
        startedAt: 20,
        updatedAt: 20,
      },
      state: "Waiting for agent stream",
    }
    const currentMessages: ThreadMessage[] = [
      createUserThreadMessage("user-existing", "Earlier prompt"),
      createAssistantThreadMessage("assistant-existing", "item-existing", "Earlier reply"),
      streamingAssistant,
    ]
    const historyMessages: ThreadMessage[] = [
      createUserThreadMessage("user-existing", "Earlier prompt"),
      {
        ...createUserThreadMessage("user-mobile", "Message from mobile"),
        timestamp: 19,
      },
    ]

    const merged = mergeExternalUserMessagesFromHistory(currentMessages, historyMessages, {
      beforeMessageID: "assistant-streaming",
    })

    expect(merged.map((message) => message.id)).toEqual([
      "user-existing",
      "assistant-existing",
      "user-mobile",
      "assistant-streaming",
    ])
  })

  it("replaces the optimistic local user message when subscription history contains the same prompt", () => {
    const streamingAssistant: AssistantThreadMessage = {
      ...createAssistantThreadMessage("assistant-streaming", "item-streaming", "Streaming reply"),
      timestamp: 20,
      isStreaming: true,
      runtime: {
        phase: "waiting_first_event",
        startedAt: 20,
        updatedAt: 20,
      },
      state: "Waiting for agent stream",
    }
    const currentMessages: ThreadMessage[] = [
      {
        ...createUserThreadMessage("user-local", "Create a Markdown document"),
        displayText: "Create a Markdown document",
        timestamp: 18,
      },
      streamingAssistant,
    ]
    const historyMessages: ThreadMessage[] = [
      {
        ...createUserThreadMessage("message-user-backend", "Create a Markdown document"),
        timestamp: 19,
      },
    ]

    const merged = mergeExternalUserMessagesFromHistory(currentMessages, historyMessages, {
      beforeMessageID: "assistant-streaming",
    })

    expect(merged).toHaveLength(2)
    expect(merged.map((message) => message.id)).toEqual([
      "message-user-backend",
      "assistant-streaming",
    ])
    expect(merged[0]).toMatchObject({
      kind: "user",
      displayText: "Create a Markdown document",
      text: "Create a Markdown document",
    })
  })

  it("can replace user presentation when switching active branch history", () => {
    const previousMessages: ThreadMessage[] = [
      {
        ...createUserThreadMessage("user-root", "root"),
        displayText: "root",
      },
      createAssistantThreadMessage("assistant-root", "item-root", "Root answer", "source-root", "assistant-root-message"),
      {
        ...createUserThreadMessage("user-old-branch", "old branch text"),
        displayText: "old branch text",
      },
    ]
    const nextMessages: ThreadMessage[] = [
      createUserThreadMessage("user-root", "root"),
      createAssistantThreadMessage("assistant-root-history", "item-root-history", "Root answer", "source-root", "assistant-root-message"),
      createUserThreadMessage("user-new-branch", "new branch text"),
    ]

    const merged = mergeConversationMessagesFromHistory(previousMessages, nextMessages, {
      preserveUserPresentation: false,
    })

    expect(merged[2]).toMatchObject({
      id: "user-new-branch",
      kind: "user",
      text: "new branch text",
    })
    expect(merged[2]).not.toHaveProperty("displayText", "old branch text")
  })

  it("preserves trace item identity without keeping stale local timestamps", () => {
    const previousMessage = createAssistantThreadMessage(
      "assistant-local",
      "trace-local",
      "Create the task list first",
      "part-task-text",
      "message-task",
    )
    previousMessage.items = previousMessage.items.map((item) => ({
      ...item,
      timestamp: 500,
    }))

    const historyMessage = createAssistantThreadMessage(
      "assistant-history",
      "trace-history",
      "Create the task list first",
      "part-task-text",
      "message-task",
    )
    historyMessage.items = historyMessage.items.map((item) => ({
      ...item,
      timestamp: 100,
    }))

    const merged = mergeConversationMessagesFromHistory([previousMessage], [historyMessage])

    expect(merged[0]?.id).toBe("assistant-local")
    expect((merged[0] as AssistantThreadMessage).items[0]).toMatchObject({
      id: "trace-local",
      timestamp: 100,
    })
  })

  it("treats equal conversation messages as equivalent for no-op history refreshes", () => {
    const messages: ThreadMessage[] = [
      createUserThreadMessage("user-1", "hello"),
      createAssistantThreadMessage("assistant-1", "item-1", "Done", "source-1", "message-1"),
    ]

    expect(conversationMessagesAreEquivalent(messages, messages.map((message) => ({ ...message })))).toBe(true)
    expect(conversationMessagesAreEquivalent(messages, [...messages, createUserThreadMessage("user-2", "again")])).toBe(false)
  })

  it("keeps a cancelled assistant message cancelled when late pending tool history is merged by message id", () => {
    const originalMessage = createCancelledAssistantThreadMessage("assistant-local", "message-tool")
    const latePendingToolMessage = createPendingToolAssistantThreadMessage("assistant-history", "message-tool")

    const reconciled = reconcileConversationMessages([originalMessage, latePendingToolMessage])

    expect(reconciled).toHaveLength(1)
    expect(reconciled[0]).toMatchObject({
      id: "assistant-local",
      kind: "assistant",
      runtime: {
        phase: "cancelled",
        toolName: undefined,
      },
      isStreaming: false,
      items: expect.arrayContaining([
        expect.objectContaining({
          kind: "tool",
          title: "replace-text",
          status: "cancelled",
          isStreaming: false,
        }),
        expect.objectContaining({
          kind: "system",
          title: "Execution cancelled",
        }),
      ]),
    })
  })

  it("keeps a local cancellation when history reloads a late unmatched pending tool message", () => {
    const previousMessage = createCancelledAssistantThreadMessage("assistant-local")
    const historyMessage = createPendingToolAssistantThreadMessage("assistant-history", "message-tool")

    const merged = mergeConversationMessagesFromHistory([previousMessage], [historyMessage])

    expect(merged).toHaveLength(1)
    expect(merged[0]).toMatchObject({
      id: "assistant-local",
      kind: "assistant",
      messageID: "message-tool",
      runtime: {
        phase: "cancelled",
        toolName: undefined,
      },
      isStreaming: false,
      items: expect.arrayContaining([
        expect.objectContaining({
          kind: "tool",
          title: "replace-text",
          status: "cancelled",
          isStreaming: false,
        }),
      ]),
    })
  })

  it("keeps a cancelled tool trace when a late matching tool error history is merged", () => {
    const originalMessage = createCancelledToolAssistantThreadMessage("assistant-local", "message-tool")
    const lateErroredToolMessage = createErroredToolAssistantThreadMessage("assistant-history", "message-tool")

    const reconciled = reconcileConversationMessages([originalMessage, lateErroredToolMessage])

    expect(reconciled).toHaveLength(1)
    expect(reconciled[0]).toMatchObject({
      id: "assistant-local",
      kind: "assistant",
      runtime: {
        phase: "cancelled",
        toolName: undefined,
        errorMessage: undefined,
      },
      isStreaming: false,
      items: expect.arrayContaining([
        expect.objectContaining({
          kind: "tool",
          title: "replace-text",
          status: "cancelled",
          isStreaming: false,
        }),
      ]),
    })
  })

  it("reconciles approval-resolution tool updates back into the original assistant message", () => {
    const originalMessage: AssistantThreadMessage = {
      id: "assistant-original",
      messageID: "msg-tool",
      kind: "assistant",
      backendTurnID: "turn-tool",
      segmentID: "msg-tool:1",
      timestamp: 2,
      runtime: {
        phase: "waiting_approval",
        startedAt: 2,
        updatedAt: 3,
        toolName: "replace-text",
        approvalRequestID: "approval-1",
      },
      state: "Waiting for permission approval",
      items: [
        {
          id: "trace-tool-local",
          kind: "tool",
          label: "Tool",
          title: "replace-text",
          status: "waiting-approval",
          sourceID: "part-tool-html",
          partID: "part-tool-html",
          messageID: "msg-tool",
          toolCallID: "call-html",
          timestamp: 3,
        },
        {
          id: "assistant-original-blocked",
          kind: "system",
          label: "Completion",
          title: "Approval required",
          status: "pending",
          sourceID: "assistant-original:blocked",
          section: "approvals",
          visibilityKey: "approvals",
          timestamp: 4,
        },
      ],
    }
    const approvalResolutionMessage: AssistantThreadMessage = {
      id: "assistant-resolution",
      messageID: "msg-tool",
      kind: "assistant",
      backendTurnID: "turn-tool",
      segmentID: "msg-tool:1",
      timestamp: 5,
      runtime: {
        phase: "completed",
        startedAt: 5,
        updatedAt: 6,
      },
      state: "Backend response received",
      items: [
        {
          id: "trace-tool-resolution",
          kind: "tool",
          label: "Tool",
          title: "replace-text",
          status: "completed",
          sourceID: "part-tool-html",
          partID: "part-tool-html",
          messageID: "msg-tool",
          toolCallID: "call-html",
          toolOutputText: "index.html updated",
          timestamp: 6,
        },
      ],
    }

    const reconciled = reconcileConversationMessages([originalMessage, approvalResolutionMessage])

    expect(reconciled).toHaveLength(1)
    expect(reconciled[0]).toMatchObject({
      id: "assistant-original",
      kind: "assistant",
      messageID: "msg-tool",
      runtime: {
        phase: "completed",
        toolName: undefined,
        approvalRequestID: undefined,
      },
      items: [
        expect.objectContaining({
          id: "trace-tool-local",
          sourceID: "part-tool-html",
          status: "completed",
          toolOutputText: "index.html updated",
        }),
      ],
    })
    expect((reconciled[0] as AssistantThreadMessage).items.some((item) => item.title === "Approval required")).toBe(false)
  })

  it("keeps assistant segments separate when only backend turn identity is shared", () => {
    const firstMessage = {
      ...createAssistantThreadMessage("assistant-a", "trace-a", "Answer A"),
      backendTurnID: "turn-shared",
      segmentID: "segment-a",
    }
    const secondMessage = {
      ...createAssistantThreadMessage("assistant-b", "trace-b", "Answer B"),
      backendTurnID: "turn-shared",
      segmentID: "segment-b",
    }

    const reconciled = reconcileConversationMessages([firstMessage, secondMessage])

    expect(reconciled).toHaveLength(2)
    expect(reconciled.map((message) => message.id)).toEqual(["assistant-a", "assistant-b"])
  })

  it("merges assistant deltas that target the same segment", () => {
    const currentMessage = {
      ...createAssistantThreadMessage("assistant-local", "trace-local", "Hello"),
      backendTurnID: "turn-shared",
      segmentID: "segment-a",
    }
    const incomingMessage = {
      ...createAssistantThreadMessage("assistant-backend", "trace-backend", "Hello world"),
      backendTurnID: "turn-shared",
      segmentID: "segment-a",
    }

    const reconciled = reconcileConversationMessages([currentMessage, incomingMessage])

    expect(reconciled).toHaveLength(1)
    expect(reconciled[0]?.id).toBe("assistant-local")
    expect((reconciled[0] as AssistantThreadMessage).items.map((item) => item.text)).toContain("Hello world")
  })

  it("uses earlier canonical trace timestamps when merging assistant messages by message id", () => {
    const currentMessage = createAssistantThreadMessage(
      "assistant-current",
      "trace-task-local",
      "Creating tasks.",
      "part-task-tool",
      "message-task",
    )
    currentMessage.items = [
      {
        id: "trace-task-local",
        kind: "tool",
        label: "Tool",
        title: "task_create",
        status: "completed",
        sourceID: "part-task-tool",
        partID: "part-task-tool",
        messageID: "message-task",
        toolCallID: "call-task",
        timestamp: 500,
      },
    ]

    const incomingMessage = createAssistantThreadMessage(
      "assistant-history",
      "trace-task-history",
      "Creating tasks.",
      "part-task-tool",
      "message-task",
    )
    incomingMessage.items = [
      {
        id: "trace-task-history",
        kind: "tool",
        label: "Tool",
        title: "task_create",
        status: "completed",
        sourceID: "part-task-tool",
        partID: "part-task-tool",
        messageID: "message-task",
        toolCallID: "call-task",
        timestamp: 100,
      },
    ]

    const reconciled = reconcileConversationMessages([currentMessage, incomingMessage])

    expect(reconciled).toHaveLength(1)
    expect((reconciled[0] as AssistantThreadMessage).items[0]).toMatchObject({
      id: "trace-task-local",
      timestamp: 100,
    })
  })

  it("merges task tool traces by tool call id when stream and history part ids differ", () => {
    const currentMessage = createAssistantThreadMessage(
      "assistant-current",
      "trace-task-local",
      "Creating tasks.",
      "stream-task-create",
      "message-task",
    )
    currentMessage.items = [
      {
        id: "trace-task-local",
        kind: "tool",
        label: "Tool",
        title: "task_create",
        status: "pending",
        sourceID: "stream-task-create",
        partID: "stream-task-create",
        messageID: "message-task",
        toolCallID: "call-task",
        toolInputText: "{\"tasks\":[{\"subject\":\"Implement\"}]}",
        timestamp: 500,
      },
    ]

    const incomingMessage = createAssistantThreadMessage(
      "assistant-history",
      "trace-task-history",
      "Creating tasks.",
      "recorded-task-create",
      "message-task",
    )
    incomingMessage.items = [
      {
        id: "trace-task-history",
        kind: "tool",
        label: "Tool",
        title: "task_create",
        status: "completed",
        sourceID: "recorded-task-create",
        partID: "recorded-task-create",
        messageID: "message-task",
        toolCallID: "call-task",
        toolOutputText: "Tasks created",
        timestamp: 100,
      },
    ]

    const reconciled = reconcileConversationMessages([currentMessage, incomingMessage])

    expect(reconciled).toHaveLength(1)
    const assistantMessage = reconciled[0] as AssistantThreadMessage
    const toolItems = assistantMessage.items.filter((item) => item.kind === "tool")
    expect(toolItems).toHaveLength(1)
    expect(toolItems[0]).toMatchObject({
      id: "trace-task-local",
      sourceID: "recorded-task-create",
      partID: "recorded-task-create",
      toolCallID: "call-task",
      status: "completed",
      toolOutputText: "Tasks created",
      timestamp: 100,
    })
  })

  it("preserves streamed tool trace identity during history refresh by message and tool call id", () => {
    const previousMessage = createAssistantThreadMessage(
      "assistant-local",
      "trace-task-local",
      "Creating tasks.",
      "stream-task-create",
      "message-task",
    )
    previousMessage.items = [
      {
        id: "trace-task-local",
        kind: "tool",
        label: "Tool",
        title: "task_create",
        status: "pending",
        sourceID: "stream-task-create",
        partID: "stream-task-create",
        messageID: "message-task",
        toolCallID: "call-task",
        timestamp: 500,
      },
    ]

    const historyMessage = createAssistantThreadMessage(
      "assistant-history",
      "trace-task-history",
      "Creating tasks.",
      "recorded-task-create",
      "message-task",
    )
    historyMessage.items = [
      {
        id: "trace-task-history",
        kind: "tool",
        label: "Tool",
        title: "task_create",
        status: "completed",
        sourceID: "recorded-task-create",
        partID: "recorded-task-create",
        messageID: "message-task",
        toolCallID: "call-task",
        toolOutputText: "Tasks created",
        timestamp: 100,
      },
    ]

    const merged = mergeConversationMessagesFromHistory([previousMessage], [historyMessage])

    expect(merged).toHaveLength(1)
    expect(merged[0]).toMatchObject({
      id: "assistant-local",
      kind: "assistant",
      items: [
        expect.objectContaining({
          id: "trace-task-local",
          sourceID: "recorded-task-create",
          partID: "recorded-task-create",
          toolCallID: "call-task",
          status: "completed",
        }),
      ],
    })
  })

  it("keeps a merged assistant message streaming when history refresh reports a running backend phase", () => {
    const currentMessage = createAssistantThreadMessage(
      "assistant-local",
      "trace-task-local",
      "Creating tasks.",
      "stream-task-create",
      "message-task",
    )
    currentMessage.runtime = {
      phase: "tool_running",
      startedAt: 100,
      updatedAt: 150,
      toolName: "task_create",
    }
    currentMessage.state = "Running tools"
    currentMessage.isStreaming = true
    currentMessage.items = [
      {
        id: "trace-task-local",
        kind: "tool",
        label: "Tool",
        title: "task_create",
        status: "pending",
        sourceID: "stream-task-create",
        partID: "stream-task-create",
        messageID: "message-task",
        toolCallID: "call-task",
        timestamp: 150,
      },
    ]

    const historyMessage = createAssistantThreadMessage(
      "assistant-history",
      "trace-task-history",
      "Creating tasks.",
      "recorded-task-create",
      "message-task",
    )
    historyMessage.runtime = {
      phase: "waiting_llm",
      startedAt: 100,
      updatedAt: 200,
    }
    historyMessage.state = "Waiting for model stream"
    historyMessage.isStreaming = true
    historyMessage.items = [
      {
        id: "trace-task-history",
        kind: "tool",
        label: "Tool",
        title: "task_create",
        status: "completed",
        sourceID: "recorded-task-create",
        partID: "recorded-task-create",
        messageID: "message-task",
        toolCallID: "call-task",
        toolOutputText: "Tasks created",
        timestamp: 180,
      },
    ]

    const reconciled = reconcileConversationMessages([currentMessage, historyMessage])

    expect(reconciled).toHaveLength(1)
    expect(reconciled[0]).toMatchObject({
      id: "assistant-local",
      kind: "assistant",
      isStreaming: true,
      runtime: expect.objectContaining({
        phase: "waiting_llm",
      }),
      items: [
        expect.objectContaining({
          id: "trace-task-local",
          status: "completed",
          toolCallID: "call-task",
        }),
      ],
    })
  })

  it("keeps different assistant segments separate when they belong to the same backend turn", () => {
    const shellMessage = createAssistantThreadMessage(
      "assistant-shell",
      "trace-shell-text",
      "I will inspect the workspace.",
      "part-shell-text",
      "message-shell",
    )
    shellMessage.backendTurnID = "turn-runtime"
    shellMessage.segmentID = "message-shell:1"
    shellMessage.items = [
      {
        id: "trace-shell-text",
        kind: "text",
        label: "Response",
        text: "I will inspect the workspace.",
        sourceID: "part-shell-text",
        messageID: "message-shell",
        backendTurnID: "turn-runtime",
        timestamp: 100,
      },
      {
        id: "trace-shell-tool",
        kind: "tool",
        label: "Tool",
        title: "powershell_command",
        status: "completed",
        sourceID: "part-shell-tool",
        partID: "part-shell-tool",
        messageID: "message-shell",
        backendTurnID: "turn-runtime",
        toolCallID: "call-shell",
        timestamp: 120,
      },
    ]

    const taskMessage = createAssistantThreadMessage(
      "assistant-task",
      "trace-task-text",
      "I will create the task list.",
      "part-task-text",
      "message-task",
    )
    taskMessage.backendTurnID = "turn-runtime"
    taskMessage.segmentID = "message-task:1"
    taskMessage.items = [
      {
        id: "trace-task-text",
        kind: "text",
        label: "Response",
        text: "I will create the task list.",
        sourceID: "part-task-text",
        messageID: "message-task",
        backendTurnID: "turn-runtime",
        timestamp: 200,
      },
      {
        id: "trace-task-tool",
        kind: "tool",
        label: "Tool",
        title: "task_create",
        status: "completed",
        sourceID: "part-task-tool",
        partID: "part-task-tool",
        messageID: "message-task",
        backendTurnID: "turn-runtime",
        toolCallID: "call-task",
        timestamp: 220,
      },
    ]

    const reconciled = reconcileConversationMessages([shellMessage, taskMessage])

    expect(reconciled).toHaveLength(2)
    expect(reconciled.map((message) => message.id)).toEqual(["assistant-shell", "assistant-task"])
  })

  it("preserves completed trace item references when only the live response changes", () => {
    const completedItems: AssistantTraceItem[] = Array.from({ length: 100 }, (_, index) => ({
      id: `completed-${index}`,
      kind: "reasoning",
      label: "Reasoning",
      status: "completed",
      text: `Completed reasoning ${index}`,
      timestamp: index + 1,
    }))
    const liveItem: AssistantTraceItem = {
      id: "live-response",
      kind: "text",
      label: "Assistant",
      status: "running",
      text: "Hello",
      timestamp: 200,
      isStreaming: true,
    }
    const currentMessage: AssistantThreadMessage = {
      id: "assistant-local",
      messageID: "message-stream",
      kind: "assistant",
      backendTurnID: "turn-stream",
      segmentID: "message-stream:1",
      timestamp: 1,
      runtime: {
        phase: "responding",
        startedAt: 1,
        updatedAt: 200,
      },
      state: "responding",
      isStreaming: true,
      items: [...completedItems, liveItem],
    }
    const incomingMessage: AssistantThreadMessage = {
      ...currentMessage,
      id: "assistant-backend",
      runtime: {
        ...currentMessage.runtime,
        updatedAt: 220,
      },
      items: [
        {
          ...liveItem,
          text: "Hello world",
          timestamp: 220,
        },
      ],
    }

    const merged = reconcileConversationMessages([currentMessage, incomingMessage])
    const mergedMessage = merged[0]

    expect(mergedMessage?.kind).toBe("assistant")
    if (mergedMessage?.kind !== "assistant") return
    completedItems.forEach((item, index) => {
      expect(mergedMessage.items[index]).toBe(item)
    })
    expect(mergedMessage.items[100]).not.toBe(liveItem)
    expect(mergedMessage.items[100]?.text).toBe("Hello world")
  })

  it("reuses an unchanged completed tool item and items array during trace merge", () => {
    const completedTool: AssistantTraceItem = {
      id: "tool-completed",
      kind: "tool",
      label: "Tool",
      title: "task_create",
      status: "completed",
      sourceID: "task-create-source",
      partID: "task-create-part",
      toolCallID: "task-create-call",
      toolOutputText: "Tasks created",
      timestamp: 10,
    }
    const currentMessage: AssistantThreadMessage = {
      id: "assistant-local",
      messageID: "message-tool",
      kind: "assistant",
      backendTurnID: "turn-tool",
      segmentID: "message-tool:1",
      timestamp: 1,
      runtime: {
        phase: "completed",
        startedAt: 1,
        updatedAt: 10,
      },
      state: "completed",
      items: [completedTool],
    }
    const incomingMessage: AssistantThreadMessage = {
      ...currentMessage,
      id: "assistant-backend",
      items: [{ ...completedTool, id: "tool-backend", timestamp: 20 }],
    }

    const merged = reconcileConversationMessages([currentMessage, incomingMessage])
    const mergedMessage = merged[0]

    expect(mergedMessage?.kind).toBe("assistant")
    if (mergedMessage?.kind !== "assistant") return
    expect(mergedMessage.items).toBe(currentMessage.items)
    expect(mergedMessage.items[0]).toBe(completedTool)
  })

  it("reuses semantically unchanged trace items when preserving history identities", () => {
    const previousMessage = createAssistantThreadMessage("assistant-local", "trace-local", "Done", "source-history", "message-history")
    const previousItem = previousMessage.items[0]!
    const historyMessage = createAssistantThreadMessage("assistant-history", "trace-history", "Done", "source-history", "message-history")

    const merged = mergeConversationMessagesFromHistory([previousMessage], [historyMessage])
    const mergedMessage = merged[0]

    expect(mergedMessage?.kind).toBe("assistant")
    if (mergedMessage?.kind !== "assistant") return
    expect(mergedMessage.items[0]).toBe(previousItem)
  })

  it("keeps item arrays stable unless stale approval blockers are removed", () => {
    const completedItem: AssistantTraceItem = {
      id: "response",
      kind: "text",
      label: "Assistant",
      text: "Done",
      timestamp: 1,
    }
    const staleApproval: AssistantTraceItem = {
      id: "approval-stale",
      kind: "system",
      label: "Approval",
      title: "Approval required",
      status: "pending",
      visibilityKey: "approvals",
      timestamp: 2,
    }
    const currentMessage: AssistantThreadMessage = {
      id: "assistant-local",
      messageID: "message-approval",
      kind: "assistant",
      backendTurnID: "turn-approval",
      segmentID: "message-approval:1",
      timestamp: 1,
      runtime: {
        phase: "completed",
        startedAt: 1,
        updatedAt: 2,
      },
      state: "completed",
      items: [completedItem],
    }
    const unchangedMerge = reconcileConversationMessages([currentMessage, { ...currentMessage, id: "assistant-backend", items: [] }])
    const unchangedMessage = unchangedMerge[0]
    expect(unchangedMessage?.kind).toBe("assistant")
    if (unchangedMessage?.kind !== "assistant") return
    expect(unchangedMessage.items).toBe(currentMessage.items)

    const messageWithStaleApproval: AssistantThreadMessage = {
      ...currentMessage,
      items: [completedItem, staleApproval],
    }
    const cleanedMerge = reconcileConversationMessages([
      messageWithStaleApproval,
      { ...messageWithStaleApproval, id: "assistant-backend", items: [] },
    ])
    const cleanedMessage = cleanedMerge[0]
    expect(cleanedMessage?.kind).toBe("assistant")
    if (cleanedMessage?.kind !== "assistant") return
    expect(cleanedMessage.items).not.toBe(messageWithStaleApproval.items)
    expect(cleanedMessage.items).toEqual([completedItem])
  })
})
