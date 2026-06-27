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
    backendTurnID: "turn-live",
    segmentID: "assistant-live",
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
  const { streamInsertion: _streamInsertion, ...message } = steerMessage()
  return message
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
  it("keeps steer messages pending while the following tool is still running", () => {
    const message = steerMessage()
    const messages: ThreadMessage[] = [assistantMessage("running"), message]

    expect(isStreamInsertionReady(messages, message)).toBe(false)
    expect(getPendingStreamInsertionUserMessages(messages)).toEqual([message])
    expect(getAssistantStreamInsertionUserMessages(messages, assistantMessage("running"))).toEqual([])
  })

  it("keeps steer messages pending when the insertion point is after an active tool", () => {
    const message = steerMessageAfterCurrentTool()
    const messages: ThreadMessage[] = [assistantMessage("running"), message]

    expect(isStreamInsertionReady(messages, message)).toBe(false)
    expect(getPendingStreamInsertionUserMessages(messages)).toEqual([message])
    expect(getAssistantStreamInsertionUserMessages(messages, assistantMessage("running"))).toEqual([])
  })

  it("keeps steer messages without insertion metadata pending while the previous assistant is streaming", () => {
    const message = steerMessageWithoutInsertion()
    const messages: ThreadMessage[] = [assistantMessage("running"), message]

    expect(isPendingSteerUserMessage(messages, message)).toBe(true)
    expect(getPendingStreamInsertionUserMessages(messages)).toEqual([message])
  })

  it("keeps steer messages without insertion metadata pending until execution mode resolves", () => {
    const assistant: AssistantThreadMessage = {
      ...assistantMessage("completed"),
      isStreaming: false,
    }
    const message = steerMessageWithoutInsertion()
    const messages: ThreadMessage[] = [assistant, message]

    expect(isPendingSteerUserMessage(messages, message)).toBe(true)
    expect(getPendingStreamInsertionUserMessages(messages)).toEqual([message])
  })

  it("keeps pending steer messages in the drawer after the insertion point is otherwise ready", () => {
    const assistant = assistantMessage("completed")
    const message = pendingSteerMessage()
    const messages: ThreadMessage[] = [assistant, message]

    expect(isStreamInsertionReady(messages, message)).toBe(true)
    expect(getPendingStreamInsertionUserMessages(messages)).toEqual([message])
    expect(getAssistantStreamInsertionUserMessages(messages, assistant)).toEqual([])
  })

  it("moves consumed steer messages into the thread after the insertion point is ready", () => {
    const assistant = assistantMessage("completed")
    const message = consumedSteerMessage()
    const messages: ThreadMessage[] = [assistant, message]

    expect(isStreamInsertionReady(messages, message)).toBe(true)
    expect(getPendingStreamInsertionUserMessages(messages)).toEqual([])
    expect(getAssistantStreamInsertionUserMessages(messages, assistant)).toEqual([message])
  })

  it("moves steer messages into the thread after the following tool boundary", () => {
    const assistant = assistantMessage("completed")
    const message = steerMessage()
    const messages: ThreadMessage[] = [assistant, message]

    expect(isStreamInsertionReady(messages, message)).toBe(true)
    expect(getPendingStreamInsertionUserMessages(messages)).toEqual([])
    expect(getAssistantStreamInsertionUserMessages(messages, assistant)).toEqual([message])
    expect(resolveStreamInsertionItemIndex(assistant.items, message, 0)).toBe(2)
  })

  it("moves steer messages into the thread after the active tool at the insertion point completes", () => {
    const assistant = assistantMessage("completed")
    const message = steerMessageAfterCurrentTool()
    const messages: ThreadMessage[] = [assistant, message]

    expect(isStreamInsertionReady(messages, message)).toBe(true)
    expect(getPendingStreamInsertionUserMessages(messages)).toEqual([])
    expect(getAssistantStreamInsertionUserMessages(messages, assistant)).toEqual([message])
    expect(resolveStreamInsertionItemIndex(assistant.items, message, 0)).toBe(2)
  })

  it("moves steer messages into the thread after a tool boundary is cancelled", () => {
    const assistant = assistantMessage("cancelled")
    const message = steerMessage()
    const messages: ThreadMessage[] = [assistant, message]

    expect(isStreamInsertionReady(messages, message)).toBe(true)
    expect(getPendingStreamInsertionUserMessages(messages)).toEqual([])
    expect(getAssistantStreamInsertionUserMessages(messages, assistant)).toEqual([message])
    expect(resolveStreamInsertionItemIndex(assistant.items, message, 0)).toBe(2)
  })

  it("keeps queued user messages pending until execution mode resolves", () => {
    const message = queuedMessage()
    const streamingAssistant = assistantMessage("running")
    const streamingMessages: ThreadMessage[] = [streamingAssistant, message]

    expect(isPendingQueuedUserMessage(streamingMessages, message)).toBe(true)
    expect(getPendingQueuedUserMessages(streamingMessages)).toEqual([message])

    const completedAssistant: AssistantThreadMessage = {
      ...streamingAssistant,
      isStreaming: false,
    }
    const completedMessages: ThreadMessage[] = [completedAssistant, message]

    expect(isPendingQueuedUserMessage(completedMessages, message)).toBe(true)
    expect(getPendingQueuedUserMessages(completedMessages)).toEqual([message])
  })
})
