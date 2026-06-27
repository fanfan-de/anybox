import { describe, expect, it } from "vitest"
import type { AssistantTraceItem, AssistantTurn, SessionTaskListView, Turn, UserTurn } from "../types"
import {
  applyExecutionModeToUserTurnPresentation,
  compactHighFrequencyDeltaStreamEvent,
  conversationTurnsAreEquivalent,
  ensureAssistantTurnPresentation,
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
  mergeConversationTurnsFromHistory,
  mergeExternalUserTurnsFromHistory,
  readLatestSessionContextUsageFromHistory,
  readSubagentCreatedChildSessionID,
  readSessionContextUsageFromDoneEventData,
  readSessionContextUsageFromLlmCompletedEventData,
  readSessionTaskListViewFromStreamEvent,
  reconcileConversationTurns,
  revealBackendRecordedUserTurnPresentation,
  revealPendingSteerUserTurnsAtHandoffPresentation,
  resolveExecutionModeRoute,
  resolveStreamMessageID,
  resolveStreamCursor,
  resolveStreamTurnID,
  shouldRefreshRuntimeDebugForStreamEvent,
  STEER_INPUT_CONSUMED_STATE_REASON,
} from "./session-stream-controller"

function createUserTurn(id: string, text: string): UserTurn {
  return {
    id,
    kind: "user",
    text,
    timestamp: 1,
  }
}

function createAssistantTurn(id: string, itemID: string, text: string, sourceID = "source-1", messageID?: string): AssistantTurn {
  return {
    id,
    messageID,
    kind: "assistant",
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

function createCancelledAssistantTurn(id: string, messageID?: string): AssistantTurn {
  return {
    id,
    messageID,
    kind: "assistant",
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
        title: "Turn cancelled",
        detail: "Prompt cancellation requested.",
        status: "completed",
        sourceID: `${id}:cancelled`,
        timestamp: 3,
      },
    ],
  }
}

function createPendingToolAssistantTurn(id: string, messageID?: string): AssistantTurn {
  return {
    id,
    messageID,
    kind: "assistant",
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

function createCancelledToolAssistantTurn(id: string, messageID?: string): AssistantTurn {
  return {
    id,
    messageID,
    kind: "assistant",
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
        title: "Turn cancelled",
        detail: "Prompt cancellation requested.",
        status: "completed",
        sourceID: `${id}:cancelled`,
        timestamp: 4,
      },
    ],
  }
}

function createErroredToolAssistantTurn(id: string, messageID?: string): AssistantTurn {
  return {
    id,
    messageID,
    kind: "assistant",
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
      currentAssistantTurnID: "assistant-temp",
      createdAssistantTurnID: "assistant-temp",
      existingAssistantTurnID: "assistant-backend",
    })).toEqual({
      assistantTurnID: "assistant-backend",
      clearSteerUserTurn: false,
      createAssistantTurn: false,
      removeAssistantTurnID: "assistant-temp",
    })

    expect(resolveExecutionModeRoute({
      mode: "steer",
      requestedMode: "steer",
      currentAssistantTurnID: "assistant-active",
      createdAssistantTurnID: "assistant-steer",
    })).toEqual({
      assistantTurnID: "assistant-steer",
      clearSteerUserTurn: false,
      createAssistantTurn: false,
    })

    expect(resolveExecutionModeRoute({
      mode: "queued",
      requestedMode: "steer",
      currentAssistantTurnID: "assistant-active",
    })).toEqual({
      assistantTurnID: "assistant-active",
      clearSteerUserTurn: true,
      createAssistantTurn: true,
    })

    expect(resolveExecutionModeRoute({
      mode: "new-turn",
      requestedMode: "new-turn",
      currentAssistantTurnID: "assistant-new",
    })).toEqual({
      assistantTurnID: "assistant-new",
      clearSteerUserTurn: false,
      createAssistantTurn: false,
    })

    expect(resolveExecutionModeRoute({
      mode: "queued",
      requestedMode: "queue",
      currentAssistantTurnID: "assistant-queued-placeholder",
    })).toEqual({
      assistantTurnID: "assistant-queued-placeholder",
      clearSteerUserTurn: false,
      createAssistantTurn: false,
    })
  })

  it("applies backend execution mode to pending user turn presentation", () => {
    const pendingUser: UserTurn = {
      ...createUserTurn("user-pending", "Continue with this"),
      submissionMode: "queued",
    }
    const assistant = createPendingToolAssistantTurn("assistant-active")

    const nextTurnTurns = applyExecutionModeToUserTurnPresentation({
      turns: [assistant, pendingUser],
      userTurnID: pendingUser.id,
      assistantTurnID: assistant.id,
      mode: "new-turn",
    })
    expect(nextTurnTurns[1]).toMatchObject({
      id: pendingUser.id,
      kind: "user",
      text: "Continue with this",
    })
    expect(nextTurnTurns[1]).not.toHaveProperty("submissionMode")
    expect(nextTurnTurns[1]).not.toHaveProperty("streamInsertion")

    const queuedTurns = applyExecutionModeToUserTurnPresentation({
      turns: [
        assistant,
        {
          ...pendingUser,
          submissionMode: "steer",
          streamInsertion: {
            assistantTurnID: assistant.id,
            afterItemCount: 1,
            status: "pending",
          },
        },
      ],
      userTurnID: pendingUser.id,
      assistantTurnID: assistant.id,
      mode: "queued",
    })
    expect(queuedTurns[1]).toMatchObject({
      id: pendingUser.id,
      kind: "user",
      submissionMode: "queued",
    })
    expect(queuedTurns[1]).not.toHaveProperty("streamInsertion")

    const steerTurns = applyExecutionModeToUserTurnPresentation({
      turns: [
        assistant,
        {
          ...pendingUser,
          submissionMode: "steer",
          streamInsertion: {
            assistantTurnID: assistant.id,
            afterItemCount: assistant.items.length,
            status: "pending",
          },
        },
      ],
      userTurnID: pendingUser.id,
      assistantTurnID: assistant.id,
      mode: "steer",
    })
    expect(steerTurns[1]).toMatchObject({
      id: pendingUser.id,
      kind: "user",
      submissionMode: "steer",
      streamInsertion: {
        assistantTurnID: assistant.id,
        afterItemCount: assistant.items.length,
        status: "pending",
      },
    })

    const recordedTurns = revealBackendRecordedUserTurnPresentation({
      turns: steerTurns,
      userTurnID: pendingUser.id,
    })
    expect(recordedTurns[1]).toMatchObject({
      id: pendingUser.id,
      kind: "user",
      text: "Continue with this",
    })
    expect(recordedTurns[1]).not.toHaveProperty("submissionMode")
    expect(recordedTurns[1]).not.toHaveProperty("streamInsertion")
  })

  it("reveals pending steer user turns at the continued-by-user handoff boundary", () => {
    const assistant = createPendingToolAssistantTurn("assistant-active")
    const otherAssistant = createPendingToolAssistantTurn("assistant-other")
    const pendingSteer: UserTurn = {
      ...createUserTurn("user-steer", "Stop task"),
      submissionMode: "steer",
    }
    const queued: UserTurn = {
      ...createUserTurn("user-queued", "Run after this"),
      submissionMode: "queued",
    }
    const insertedForAssistant: UserTurn = {
      ...createUserTurn("user-inserted", "Guide here"),
      submissionMode: "steer",
      streamInsertion: {
        assistantTurnID: assistant.id,
        afterItemCount: 1,
        status: "pending",
      },
    }
    const insertedForOtherAssistant: UserTurn = {
      ...createUserTurn("user-other", "Guide elsewhere"),
      submissionMode: "steer",
      streamInsertion: {
        assistantTurnID: otherAssistant.id,
        afterItemCount: 1,
        status: "pending",
      },
    }
    const consumedInsertion: UserTurn = {
      ...createUserTurn("user-consumed", "Already shown"),
      submissionMode: "steer",
      streamInsertion: {
        assistantTurnID: assistant.id,
        afterItemCount: 1,
        status: "consumed",
      },
    }

    const nextTurns = revealPendingSteerUserTurnsAtHandoffPresentation({
      turns: [
        assistant,
        pendingSteer,
        queued,
        insertedForAssistant,
        insertedForOtherAssistant,
        consumedInsertion,
      ],
      assistantTurnID: assistant.id,
    })

    expect(nextTurns[1]).toMatchObject({
      id: pendingSteer.id,
      kind: "user",
      text: pendingSteer.text,
    })
    expect(nextTurns[1]).not.toHaveProperty("submissionMode")
    expect(nextTurns[1]).not.toHaveProperty("streamInsertion")

    expect(nextTurns[2]).toMatchObject({
      id: queued.id,
      kind: "user",
      submissionMode: "queued",
    })

    expect(nextTurns[3]).toMatchObject({
      id: insertedForAssistant.id,
      kind: "user",
      text: insertedForAssistant.text,
    })
    expect(nextTurns[3]).not.toHaveProperty("submissionMode")
    expect(nextTurns[3]).not.toHaveProperty("streamInsertion")

    expect(nextTurns[4]).toMatchObject({
      id: insertedForOtherAssistant.id,
      kind: "user",
      submissionMode: "steer",
      streamInsertion: {
        assistantTurnID: otherAssistant.id,
        status: "pending",
      },
    })
    expect(nextTurns[5]).toMatchObject({
      id: consumedInsertion.id,
      kind: "user",
      submissionMode: "steer",
      streamInsertion: {
        assistantTurnID: assistant.id,
        status: "consumed",
      },
    })
  })

  it("ensures a missing stream assistant target before applying live events", () => {
    const turns: Turn[] = [
      createUserTurn("user-1", "Prompt"),
    ]

    const nextTurns = ensureAssistantTurnPresentation({
      turns,
      assistantTurnID: "assistant-steer",
      detail: "Receiving backend session activity.",
    })

    expect(nextTurns).toHaveLength(2)
    expect(nextTurns[1]).toMatchObject({
      id: "assistant-steer",
      kind: "assistant",
      isStreaming: true,
      state: "Waiting for agent stream",
      items: [
        expect.objectContaining({
          sourceID: "assistant-steer:prompt",
          status: "pending",
        }),
      ],
    })

    expect(ensureAssistantTurnPresentation({
      turns: nextTurns,
      assistantTurnID: "assistant-steer",
    })).toBe(nextTurns)
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
    const previousUser: UserTurn = {
      ...createUserTurn("user-local", "local display"),
      displayText: "local display",
      attachments: [{ name: "design.png", path: "C:/tmp/design.png" }],
      references: [{ id: "ref-1", label: "src/App.tsx", kind: "file" }],
    }
    const previousAssistant = createAssistantTurn("assistant-local", "item-local", "Done", "source-1")
    const nextTurns: Turn[] = [
      createUserTurn("user-history", "history text"),
      createAssistantTurn("assistant-history", "item-history", "Done", "source-1", "msg-assistant-history"),
    ]

    const merged = mergeConversationTurnsFromHistory([previousUser, previousAssistant], nextTurns)

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

  it("inserts externally persisted user turns before the streaming assistant placeholder", () => {
    const streamingAssistant: AssistantTurn = {
      ...createAssistantTurn("assistant-streaming", "item-streaming", "Streaming reply"),
      timestamp: 20,
      isStreaming: true,
      runtime: {
        phase: "waiting_first_event",
        startedAt: 20,
        updatedAt: 20,
      },
      state: "Waiting for agent stream",
    }
    const currentTurns: Turn[] = [
      createUserTurn("user-existing", "Earlier prompt"),
      createAssistantTurn("assistant-existing", "item-existing", "Earlier reply"),
      streamingAssistant,
    ]
    const historyTurns: Turn[] = [
      createUserTurn("user-existing", "Earlier prompt"),
      {
        ...createUserTurn("user-mobile", "Message from mobile"),
        timestamp: 19,
      },
    ]

    const merged = mergeExternalUserTurnsFromHistory(currentTurns, historyTurns, {
      beforeTurnID: "assistant-streaming",
    })

    expect(merged.map((turn) => turn.id)).toEqual([
      "user-existing",
      "assistant-existing",
      "user-mobile",
      "assistant-streaming",
    ])
  })

  it("replaces the optimistic local user turn when subscription history contains the same prompt", () => {
    const streamingAssistant: AssistantTurn = {
      ...createAssistantTurn("assistant-streaming", "item-streaming", "Streaming reply"),
      timestamp: 20,
      isStreaming: true,
      runtime: {
        phase: "waiting_first_event",
        startedAt: 20,
        updatedAt: 20,
      },
      state: "Waiting for agent stream",
    }
    const currentTurns: Turn[] = [
      {
        ...createUserTurn("user-local", "Create a Markdown document"),
        displayText: "Create a Markdown document",
        timestamp: 18,
      },
      streamingAssistant,
    ]
    const historyTurns: Turn[] = [
      {
        ...createUserTurn("message-user-backend", "Create a Markdown document"),
        timestamp: 19,
      },
    ]

    const merged = mergeExternalUserTurnsFromHistory(currentTurns, historyTurns, {
      beforeTurnID: "assistant-streaming",
    })

    expect(merged).toHaveLength(2)
    expect(merged.map((turn) => turn.id)).toEqual([
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
    const previousTurns: Turn[] = [
      {
        ...createUserTurn("user-root", "root"),
        displayText: "root",
      },
      createAssistantTurn("assistant-root", "item-root", "Root answer", "source-root", "assistant-root-message"),
      {
        ...createUserTurn("user-old-branch", "old branch text"),
        displayText: "old branch text",
      },
    ]
    const nextTurns: Turn[] = [
      createUserTurn("user-root", "root"),
      createAssistantTurn("assistant-root-history", "item-root-history", "Root answer", "source-root", "assistant-root-message"),
      createUserTurn("user-new-branch", "new branch text"),
    ]

    const merged = mergeConversationTurnsFromHistory(previousTurns, nextTurns, {
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
    const previousTurn = createAssistantTurn(
      "assistant-local",
      "trace-local",
      "Create the task list first",
      "part-task-text",
      "message-task",
    )
    previousTurn.items = previousTurn.items.map((item) => ({
      ...item,
      timestamp: 500,
    }))

    const historyTurn = createAssistantTurn(
      "assistant-history",
      "trace-history",
      "Create the task list first",
      "part-task-text",
      "message-task",
    )
    historyTurn.items = historyTurn.items.map((item) => ({
      ...item,
      timestamp: 100,
    }))

    const merged = mergeConversationTurnsFromHistory([previousTurn], [historyTurn])

    expect(merged[0]?.id).toBe("assistant-local")
    expect((merged[0] as AssistantTurn).items[0]).toMatchObject({
      id: "trace-local",
      timestamp: 100,
    })
  })

  it("treats equal conversation turns as equivalent for no-op history refreshes", () => {
    const turns: Turn[] = [
      createUserTurn("user-1", "hello"),
      createAssistantTurn("assistant-1", "item-1", "Done", "source-1", "message-1"),
    ]

    expect(conversationTurnsAreEquivalent(turns, turns.map((turn) => ({ ...turn })))).toBe(true)
    expect(conversationTurnsAreEquivalent(turns, [...turns, createUserTurn("user-2", "again")])).toBe(false)
  })

  it("keeps a cancelled assistant turn cancelled when late pending tool history is merged by message id", () => {
    const originalTurn = createCancelledAssistantTurn("assistant-local", "message-tool")
    const latePendingToolTurn = createPendingToolAssistantTurn("assistant-history", "message-tool")

    const reconciled = reconcileConversationTurns([originalTurn, latePendingToolTurn])

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
          title: "Turn cancelled",
        }),
      ]),
    })
  })

  it("keeps a local cancellation when history reloads a late unmatched pending tool turn", () => {
    const previousTurn = createCancelledAssistantTurn("assistant-local")
    const historyTurn = createPendingToolAssistantTurn("assistant-history", "message-tool")

    const merged = mergeConversationTurnsFromHistory([previousTurn], [historyTurn])

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
    const originalTurn = createCancelledToolAssistantTurn("assistant-local", "message-tool")
    const lateErroredToolTurn = createErroredToolAssistantTurn("assistant-history", "message-tool")

    const reconciled = reconcileConversationTurns([originalTurn, lateErroredToolTurn])

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
    const originalTurn: AssistantTurn = {
      id: "assistant-original",
      messageID: "msg-tool",
      kind: "assistant",
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
    const approvalResolutionTurn: AssistantTurn = {
      id: "assistant-resolution",
      messageID: "msg-tool",
      kind: "assistant",
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

    const reconciled = reconcileConversationTurns([originalTurn, approvalResolutionTurn])

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
    expect((reconciled[0] as AssistantTurn).items.some((item) => item.title === "Approval required")).toBe(false)
  })

  it("uses earlier canonical trace timestamps when merging assistant turns by message", () => {
    const currentTurn = createAssistantTurn(
      "assistant-current",
      "trace-task-local",
      "Creating tasks.",
      "part-task-tool",
      "message-task",
    )
    currentTurn.items = [
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

    const incomingTurn = createAssistantTurn(
      "assistant-history",
      "trace-task-history",
      "Creating tasks.",
      "part-task-tool",
      "message-task",
    )
    incomingTurn.items = [
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

    const reconciled = reconcileConversationTurns([currentTurn, incomingTurn])

    expect(reconciled).toHaveLength(1)
    expect((reconciled[0] as AssistantTurn).items[0]).toMatchObject({
      id: "trace-task-local",
      timestamp: 100,
    })
  })

  it("merges task tool traces by tool call id when stream and history part ids differ", () => {
    const currentTurn = createAssistantTurn(
      "assistant-current",
      "trace-task-local",
      "Creating tasks.",
      "stream-task-create",
      "message-task",
    )
    currentTurn.items = [
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

    const incomingTurn = createAssistantTurn(
      "assistant-history",
      "trace-task-history",
      "Creating tasks.",
      "recorded-task-create",
      "message-task",
    )
    incomingTurn.items = [
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

    const reconciled = reconcileConversationTurns([currentTurn, incomingTurn])

    expect(reconciled).toHaveLength(1)
    const assistantTurn = reconciled[0] as AssistantTurn
    const toolItems = assistantTurn.items.filter((item) => item.kind === "tool")
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
    const previousTurn = createAssistantTurn(
      "assistant-local",
      "trace-task-local",
      "Creating tasks.",
      "stream-task-create",
      "message-task",
    )
    previousTurn.items = [
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

    const historyTurn = createAssistantTurn(
      "assistant-history",
      "trace-task-history",
      "Creating tasks.",
      "recorded-task-create",
      "message-task",
    )
    historyTurn.items = [
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

    const merged = mergeConversationTurnsFromHistory([previousTurn], [historyTurn])

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

  it("keeps a merged assistant turn streaming when history refresh reports a running backend phase", () => {
    const currentTurn = createAssistantTurn(
      "assistant-local",
      "trace-task-local",
      "Creating tasks.",
      "stream-task-create",
      "message-task",
    )
    currentTurn.runtime = {
      phase: "tool_running",
      startedAt: 100,
      updatedAt: 150,
      toolName: "task_create",
    }
    currentTurn.state = "Running tools"
    currentTurn.isStreaming = true
    currentTurn.items = [
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

    const historyTurn = createAssistantTurn(
      "assistant-history",
      "trace-task-history",
      "Creating tasks.",
      "recorded-task-create",
      "message-task",
    )
    historyTurn.runtime = {
      phase: "waiting_llm",
      startedAt: 100,
      updatedAt: 200,
    }
    historyTurn.state = "Waiting for model stream"
    historyTurn.isStreaming = true
    historyTurn.items = [
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

    const reconciled = reconcileConversationTurns([currentTurn, historyTurn])

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

  it("merges different assistant messages that belong to the same backend turn", () => {
    const shellTurn = createAssistantTurn(
      "assistant-shell",
      "trace-shell-text",
      "I will inspect the workspace.",
      "part-shell-text",
      "message-shell",
    )
    shellTurn.items = [
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

    const taskTurn = createAssistantTurn(
      "assistant-task",
      "trace-task-text",
      "I will create the task list.",
      "part-task-text",
      "message-task",
    )
    taskTurn.items = [
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

    const reconciled = reconcileConversationTurns([shellTurn, taskTurn])

    expect(reconciled).toHaveLength(1)
    expect((reconciled[0] as AssistantTurn).items.map((item) => item.kind === "tool" ? item.title : item.text)).toEqual([
      "I will inspect the workspace.",
      "powershell_command",
      "I will create the task list.",
      "task_create",
    ])
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
    const currentTurn: AssistantTurn = {
      id: "assistant-local",
      messageID: "message-stream",
      kind: "assistant",
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
    const incomingTurn: AssistantTurn = {
      ...currentTurn,
      id: "assistant-backend",
      runtime: {
        ...currentTurn.runtime,
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

    const merged = reconcileConversationTurns([currentTurn, incomingTurn])
    const mergedTurn = merged[0]

    expect(mergedTurn?.kind).toBe("assistant")
    if (mergedTurn?.kind !== "assistant") return
    completedItems.forEach((item, index) => {
      expect(mergedTurn.items[index]).toBe(item)
    })
    expect(mergedTurn.items[100]).not.toBe(liveItem)
    expect(mergedTurn.items[100]?.text).toBe("Hello world")
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
    const currentTurn: AssistantTurn = {
      id: "assistant-local",
      messageID: "message-tool",
      kind: "assistant",
      timestamp: 1,
      runtime: {
        phase: "completed",
        startedAt: 1,
        updatedAt: 10,
      },
      state: "completed",
      items: [completedTool],
    }
    const incomingTurn: AssistantTurn = {
      ...currentTurn,
      id: "assistant-backend",
      items: [{ ...completedTool, id: "tool-backend", timestamp: 20 }],
    }

    const merged = reconcileConversationTurns([currentTurn, incomingTurn])
    const mergedTurn = merged[0]

    expect(mergedTurn?.kind).toBe("assistant")
    if (mergedTurn?.kind !== "assistant") return
    expect(mergedTurn.items).toBe(currentTurn.items)
    expect(mergedTurn.items[0]).toBe(completedTool)
  })

  it("reuses semantically unchanged trace items when preserving history identities", () => {
    const previousTurn = createAssistantTurn("assistant-local", "trace-local", "Done", "source-history", "message-history")
    const previousItem = previousTurn.items[0]!
    const historyTurn = createAssistantTurn("assistant-history", "trace-history", "Done", "source-history", "message-history")

    const merged = mergeConversationTurnsFromHistory([previousTurn], [historyTurn])
    const mergedTurn = merged[0]

    expect(mergedTurn?.kind).toBe("assistant")
    if (mergedTurn?.kind !== "assistant") return
    expect(mergedTurn.items[0]).toBe(previousItem)
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
    const currentTurn: AssistantTurn = {
      id: "assistant-local",
      messageID: "message-approval",
      kind: "assistant",
      timestamp: 1,
      runtime: {
        phase: "completed",
        startedAt: 1,
        updatedAt: 2,
      },
      state: "completed",
      items: [completedItem],
    }
    const unchangedMerge = reconcileConversationTurns([currentTurn, { ...currentTurn, id: "assistant-backend", items: [] }])
    const unchangedTurn = unchangedMerge[0]
    expect(unchangedTurn?.kind).toBe("assistant")
    if (unchangedTurn?.kind !== "assistant") return
    expect(unchangedTurn.items).toBe(currentTurn.items)

    const turnWithStaleApproval: AssistantTurn = {
      ...currentTurn,
      items: [completedItem, staleApproval],
    }
    const cleanedMerge = reconcileConversationTurns([
      turnWithStaleApproval,
      { ...turnWithStaleApproval, id: "assistant-backend", items: [] },
    ])
    const cleanedTurn = cleanedMerge[0]
    expect(cleanedTurn?.kind).toBe("assistant")
    if (cleanedTurn?.kind !== "assistant") return
    expect(cleanedTurn.items).not.toBe(turnWithStaleApproval.items)
    expect(cleanedTurn.items).toEqual([completedItem])
  })
})
