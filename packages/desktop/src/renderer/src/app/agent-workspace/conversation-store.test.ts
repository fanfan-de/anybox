import { describe, expect, it, vi } from "vitest"
import type { AssistantThreadMessage, ThreadMessage, UserThreadMessage } from "../types"
import { deriveActiveMessages } from "../thread-turn-state"
import { createConversationStore } from "./conversation-store"

function userMessage(id: string): UserThreadMessage {
  return {
    id,
    kind: "user",
    text: "Prompt",
    timestamp: 1,
  }
}

function assistantMessage(id: string, segmentID: string, text: string): AssistantThreadMessage {
  return {
    id,
    kind: "assistant",
    backendTurnID: "turn-1",
    segmentID,
    timestamp: 2,
    runtime: {
      phase: "completed",
      startedAt: 2,
      updatedAt: 3,
    },
    state: "completed",
    items: [
      {
        id: `${id}-text`,
        kind: "text",
        label: "Response",
        text,
        timestamp: 3,
      },
    ],
  }
}

describe("conversation store canonical turns", () => {
  it("stores turns canonically and exposes flat messages as a derived view", () => {
    const messages: ThreadMessage[] = [
      userMessage("user-1"),
      assistantMessage("assistant-a", "segment-a", "Answer A"),
      assistantMessage("assistant-b", "segment-b", "Answer B"),
    ]
    const store = createConversationStore({ "session-1": messages })

    const turns = store.getSessionTurns("session-1")

    expect(turns).toHaveLength(1)
    expect(turns[0]?.turnID).toBe("turn-1")
    expect(turns[0]?.messages.map((message) => message.id)).toEqual(["user-1", "assistant-a", "assistant-b"])
    expect(store.getSessionMessages("session-1")).toEqual(deriveActiveMessages(turns))
    expect(store.getConversations()["session-1"]).toEqual(deriveActiveMessages(turns))
  })

  it("notifies only the changed session when turns are replaced", () => {
    const store = createConversationStore({
      "session-1": [userMessage("user-1")],
      "session-2": [userMessage("user-2")],
    })
    const sessionOneListener = vi.fn()
    const sessionTwoListener = vi.fn()
    store.subscribeSession("session-1", sessionOneListener)
    store.subscribeSession("session-2", sessionTwoListener)

    store.replaceTurns({
      ...store.getTurns(),
      "session-1": [
        {
          turnID: "turn-1",
          status: "completed",
          startedAt: 1,
          updatedAt: 3,
          messages: [userMessage("user-1"), assistantMessage("assistant-1", "segment-1", "Done")],
        },
      ],
    })

    expect(sessionOneListener).toHaveBeenCalledTimes(1)
    expect(sessionTwoListener).not.toHaveBeenCalled()
    expect(store.getSessionMessages("session-1").map((message) => message.id)).toEqual(["user-1", "assistant-1"])
  })
})
