import { describe, expect, it } from "vitest"
import type { AssistantThreadMessage, UserThreadMessage } from "./types"
import {
  appendMessagesToThreadTurns,
  buildThreadTurnsFromMessages,
  insertUserMessageIntoTurns,
  removeMessageFromTurns,
} from "./thread-turn-state"

function userMessage(id: string, timestamp = 1): UserThreadMessage {
  return {
    id,
    kind: "user",
    text: "Prompt",
    timestamp,
  }
}

function assistantMessage(input: {
  id: string
  text: string
  backendTurnID?: string
  messageID?: string
  segmentID?: string
  timestamp?: number
}): AssistantThreadMessage {
  const timestamp = input.timestamp ?? 2
  return {
    id: input.id,
    ...(input.messageID ? { messageID: input.messageID } : {}),
    kind: "assistant",
    backendTurnID: input.backendTurnID ?? "turn-1",
    segmentID: input.segmentID ?? input.messageID ?? input.id,
    timestamp,
    runtime: {
      phase: "completed",
      startedAt: timestamp,
      updatedAt: timestamp + 1,
    },
    state: "completed",
    items: [
      {
        id: `${input.id}-text`,
        kind: "text",
        label: "Response",
        text: input.text,
        timestamp: timestamp + 1,
      },
    ],
  }
}

describe("thread turn state helpers", () => {
  it("appends an assistant placeholder to the pending user turn for its backend turn", () => {
    const user = userMessage("user-1")
    const assistant = assistantMessage({ id: "assistant-1", text: "Done", backendTurnID: "turn-backend" })
    const turns = buildThreadTurnsFromMessages([user])

    const nextTurns = appendMessagesToThreadTurns(turns, [assistant])

    expect(nextTurns).toHaveLength(1)
    expect(nextTurns[0]?.turnID).toBe("turn-backend")
    expect(nextTurns[0]?.messages.map((message) => message.id)).toEqual(["user-1", "assistant-1"])
  })

  it("inserts a pending user message before a target assistant in the same turn", () => {
    const assistant = assistantMessage({ id: "assistant-1", text: "Streaming", backendTurnID: "turn-backend" })
    const turns = buildThreadTurnsFromMessages([assistant])

    const nextTurns = insertUserMessageIntoTurns(turns, userMessage("user-1"), {
      beforeMessageID: "assistant-1",
    })

    expect(nextTurns).toHaveLength(1)
    expect(nextTurns[0]?.turnID).toBe("turn-backend")
    expect(nextTurns[0]?.messages.map((message) => message.id)).toEqual(["user-1", "assistant-1"])
  })

  it("keeps duplicate backend message ids separate when segment ids differ", () => {
    const first = assistantMessage({
      id: "assistant-a",
      text: "First",
      backendTurnID: "turn-shared",
      messageID: "message-shared",
      segmentID: "message-shared:1",
    })
    const second = assistantMessage({
      id: "assistant-b",
      text: "Second",
      backendTurnID: "turn-shared",
      messageID: "message-shared",
      segmentID: "message-shared:2",
    })

    const turns = appendMessagesToThreadTurns([], [first, second])

    expect(turns).toHaveLength(1)
    expect(turns[0]?.messages.map((message) => message.id)).toEqual(["assistant-a", "assistant-b"])
  })

  it("removes empty turns while preserving non-empty turns", () => {
    const user = userMessage("user-1")
    const assistant = assistantMessage({ id: "assistant-1", text: "Done", backendTurnID: "turn-backend" })
    const populatedTurns = buildThreadTurnsFromMessages([user, assistant])
    const assistantOnlyTurns = buildThreadTurnsFromMessages([assistant])

    const withoutAssistant = removeMessageFromTurns(populatedTurns, "assistant-1")
    const withoutOnlyMessage = removeMessageFromTurns(assistantOnlyTurns, "assistant-1")

    expect(withoutAssistant).toHaveLength(1)
    expect(withoutAssistant[0]?.messages.map((message) => message.id)).toEqual(["user-1"])
    expect(withoutOnlyMessage).toEqual([])
  })
})
