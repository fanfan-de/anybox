import { describe, expect, it } from "vitest"
import type { AssistantThreadMessage, ThreadMessage, UserThreadMessage } from "./types"
import {
  getAssistantStreamInsertionUserMessages,
  getPendingQueuedUserMessages,
  getPendingStreamInsertionUserMessages,
  isPendingQueuedUserMessage,
  isPendingSteerUserMessage,
  isStreamInsertionReady,
  resolveStreamInsertionItemIndex,
} from "./stream-insertion"

function assistantMessage(status: "running" | "completed" | "cancelled"): AssistantThreadMessage {
  return {
    id: "assistant-live",
    kind: "assistant",
    timestamp: 1,
    runtime: {
      phase: status === "running" ? "tool_running" : status === "cancelled" ? "cancelled" : "responding",
      startedAt: 1,
      updatedAt: 1,
    },
    state: "running",
    items: [
      {
        id: "assistant-before",
        kind: "text",
        timestamp: 1,
        label: "Assistant",
        text: "Before steer",
        status: "completed",
      },
      {
        id: "assistant-tool",
        kind: "tool",
        timestamp: 2,
        label: "Tool",
        title: "load-skill",
        status,
      },
      {
        id: "assistant-after",
        kind: "text",
        timestamp: 3,
        label: "Assistant",
        text: "After steer",
        status: "running",
      },
    ],
    isStreaming: true,
  }
}

function steerMessage(): UserThreadMessage {
  return {
    id: "user-steer",
    kind: "user",
    text: "Hello",
    submissionMode: "steer",
    streamInsertion: {
      assistantThreadMessageID: "assistant-live",
      afterItemCount: 1,
    },
    timestamp: 2,
  }
}

function pendingSteerMessage(): UserThreadMessage {
  return {
    ...steerMessage(),
    streamInsertion: {
      assistantThreadMessageID: "assistant-live",
      afterItemCount: 1,
      status: "pending",
    },
  }
}

function consumedSteerMessage(): UserThreadMessage {
  return {
    ...steerMessage(),
    streamInsertion: {
      assistantThreadMessageID: "assistant-live",
      afterItemCount: 1,
      status: "consumed",
    },
  }
}

function steerMessageWithoutInsertion(): UserThreadMessage {
  const { streamInsertion: _streamInsertion, ...turn } = steerMessage()
  return turn
}

function steerMessageAfterCurrentTool(): UserThreadMessage {
  return {
    ...steerMessage(),
    streamInsertion: {
      assistantThreadMessageID: "assistant-live",
      afterItemCount: 2,
    },
  }
}

function queuedMessage(): UserThreadMessage {
  return {
    id: "user-queued",
    kind: "user",
    text: "Next prompt",
    submissionMode: "queued",
    timestamp: 2,
  }
}

describe("stream insertion presentation", () => {
  it("keeps steer turns pending while the following tool is still running", () => {
    const turn = steerMessage()
    const turns: ThreadMessage[] = [assistantMessage("running"), turn]

    expect(isStreamInsertionReady(turns, turn)).toBe(false)
    expect(getPendingStreamInsertionUserMessages(turns)).toEqual([turn])
    expect(getAssistantStreamInsertionUserMessages(turns, assistantMessage("running"))).toEqual([])
  })

  it("keeps steer turns pending when the insertion point is after an active tool", () => {
    const turn = steerMessageAfterCurrentTool()
    const turns: ThreadMessage[] = [assistantMessage("running"), turn]

    expect(isStreamInsertionReady(turns, turn)).toBe(false)
    expect(getPendingStreamInsertionUserMessages(turns)).toEqual([turn])
    expect(getAssistantStreamInsertionUserMessages(turns, assistantMessage("running"))).toEqual([])
  })

  it("keeps steer turns without insertion metadata pending while the previous assistant is streaming", () => {
    const turn = steerMessageWithoutInsertion()
    const turns: ThreadMessage[] = [assistantMessage("running"), turn]

    expect(isPendingSteerUserMessage(turns, turn)).toBe(true)
    expect(getPendingStreamInsertionUserMessages(turns)).toEqual([turn])
  })

  it("keeps steer turns without insertion metadata pending until execution mode resolves", () => {
    const assistant: AssistantThreadMessage = {
      ...assistantMessage("completed"),
      isStreaming: false,
    }
    const turn = steerMessageWithoutInsertion()
    const turns: ThreadMessage[] = [assistant, turn]

    expect(isPendingSteerUserMessage(turns, turn)).toBe(true)
    expect(getPendingStreamInsertionUserMessages(turns)).toEqual([turn])
  })

  it("keeps pending steer turns in the drawer after the insertion point is otherwise ready", () => {
    const assistant = assistantMessage("completed")
    const turn = pendingSteerMessage()
    const turns: ThreadMessage[] = [assistant, turn]

    expect(isStreamInsertionReady(turns, turn)).toBe(true)
    expect(getPendingStreamInsertionUserMessages(turns)).toEqual([turn])
    expect(getAssistantStreamInsertionUserMessages(turns, assistant)).toEqual([])
  })

  it("moves consumed steer turns into the thread after the insertion point is ready", () => {
    const assistant = assistantMessage("completed")
    const turn = consumedSteerMessage()
    const turns: ThreadMessage[] = [assistant, turn]

    expect(isStreamInsertionReady(turns, turn)).toBe(true)
    expect(getPendingStreamInsertionUserMessages(turns)).toEqual([])
    expect(getAssistantStreamInsertionUserMessages(turns, assistant)).toEqual([turn])
  })

  it("moves steer turns into the thread after the following tool boundary", () => {
    const assistant = assistantMessage("completed")
    const turn = steerMessage()
    const turns: ThreadMessage[] = [assistant, turn]

    expect(isStreamInsertionReady(turns, turn)).toBe(true)
    expect(getPendingStreamInsertionUserMessages(turns)).toEqual([])
    expect(getAssistantStreamInsertionUserMessages(turns, assistant)).toEqual([turn])
    expect(resolveStreamInsertionItemIndex(assistant.items, turn, 0)).toBe(2)
  })

  it("moves steer turns into the thread after the active tool at the insertion point completes", () => {
    const assistant = assistantMessage("completed")
    const turn = steerMessageAfterCurrentTool()
    const turns: ThreadMessage[] = [assistant, turn]

    expect(isStreamInsertionReady(turns, turn)).toBe(true)
    expect(getPendingStreamInsertionUserMessages(turns)).toEqual([])
    expect(getAssistantStreamInsertionUserMessages(turns, assistant)).toEqual([turn])
    expect(resolveStreamInsertionItemIndex(assistant.items, turn, 0)).toBe(2)
  })

  it("moves steer turns into the thread after a tool boundary is cancelled", () => {
    const assistant = assistantMessage("cancelled")
    const turn = steerMessage()
    const turns: ThreadMessage[] = [assistant, turn]

    expect(isStreamInsertionReady(turns, turn)).toBe(true)
    expect(getPendingStreamInsertionUserMessages(turns)).toEqual([])
    expect(getAssistantStreamInsertionUserMessages(turns, assistant)).toEqual([turn])
    expect(resolveStreamInsertionItemIndex(assistant.items, turn, 0)).toBe(2)
  })

  it("keeps queued user turns pending until execution mode resolves", () => {
    const turn = queuedMessage()
    const streamingAssistant = assistantMessage("running")
    const streamingMessages: ThreadMessage[] = [streamingAssistant, turn]

    expect(isPendingQueuedUserMessage(streamingMessages, turn)).toBe(true)
    expect(getPendingQueuedUserMessages(streamingMessages)).toEqual([turn])

    const completedAssistant: AssistantThreadMessage = {
      ...streamingAssistant,
      isStreaming: false,
    }
    const completedTurns: ThreadMessage[] = [completedAssistant, turn]

    expect(isPendingQueuedUserMessage(completedTurns, turn)).toBe(true)
    expect(getPendingQueuedUserMessages(completedTurns)).toEqual([turn])
  })
})
