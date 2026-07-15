import { describe, expect, it } from "vitest"
import type { AssistantThreadMessage, UserThreadMessage } from "./types"
import {
  appendMessagesToThreadTurns,
  buildThreadTurnsFromMessages,
  ensureThreadTurn,
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
    expect(nextTurns[0]).toMatchObject({
      finalSegmentID: "assistant-1",
      lastMessageID: "assistant-1",
    })
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

  it("clears terminal outcome metadata when the same turn resumes and rejects a stale segment for a new last message", () => {
    const completed = ensureThreadTurn([], {
      turnID: "turn-retry",
      status: "completed",
      lastMessageID: "message-a",
      finalSegmentID: "segment-a",
      timestamp: 10,
    }).map((turn) => ({ ...turn, completedAt: 10 }))

    const running = ensureThreadTurn(completed, {
      turnID: "turn-retry",
      status: "running",
      timestamp: 20,
    })
    expect(running[0]).toMatchObject({ status: "running" })
    expect(running[0]?.completedAt).toBeUndefined()
    expect(running[0]?.lastMessageID).toBeUndefined()
    expect(running[0]?.finalSegmentID).toBeUndefined()

    const nextTerminal = ensureThreadTurn(running.map((turn) => ({
      ...turn,
      lastMessageID: "message-a",
      finalSegmentID: "segment-a",
    })), {
      turnID: "turn-retry",
      status: "completed",
      lastMessageID: "message-b",
      timestamp: 30,
    })
    expect(nextTerminal[0]?.lastMessageID).toBe("message-b")
    expect(nextTerminal[0]?.finalSegmentID).toBeUndefined()
  })

  it("preserves authoritative terminal final metadata while rebuilding later assistant segments", () => {
    const first = assistantMessage({
      id: "assistant-a",
      text: "Canonical final",
      backendTurnID: "turn-authoritative-final",
      messageID: "message-a",
      segmentID: "segment-a",
    })
    const later = assistantMessage({
      id: "assistant-b",
      text: "Later metadata",
      backendTurnID: "turn-authoritative-final",
      messageID: "message-b",
      segmentID: "segment-b",
      timestamp: 4,
    })
    const previous = [{
      turnID: "turn-authoritative-final",
      status: "completed" as const,
      startedAt: 1,
      updatedAt: 5,
      completedAt: 5,
      lastMessageID: "message-a",
      finalSegmentID: "segment-a",
      messages: [first],
    }]

    const rebuilt = buildThreadTurnsFromMessages([first, later], previous)

    expect(rebuilt[0]).toMatchObject({
      finalSegmentID: "segment-a",
      lastMessageID: "message-a",
    })
    expect(rebuilt[0]?.messages.map((message) => message.id)).toEqual(["assistant-a", "assistant-b"])
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
