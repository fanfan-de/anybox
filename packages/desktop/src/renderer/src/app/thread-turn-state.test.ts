import { describe, expect, it } from "vitest"
import type { AssistantThreadMessage, ThreadMessage, ThreadTurn, UserThreadMessage } from "./types"
import {
  appendMessagesToThreadTurns,
  bindPendingThreadTurnToCanonical,
  buildThreadTurnsFromMessages,
  ensureThreadTurn,
  insertUserMessageIntoTurns,
  reconcileThreadTurns,
  removeMessageFromTurns,
  updateAssistantMessageInTurn,
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

function threadTurn(input: {
  turnID: string
  messages: ThreadMessage[]
  resume?: boolean
  status?: ThreadTurn["status"]
  phase?: ThreadTurn["phase"]
  startedAt?: number
  updatedAt?: number
  completedAt?: number
  backendSessionID?: string
  userMessageID?: string
  lastMessageID?: string
  finalSegmentID?: string
}): ThreadTurn {
  return {
    turnID: input.turnID,
    ...(input.resume ? { resume: true } : {}),
    ...(input.backendSessionID ? { backendSessionID: input.backendSessionID } : {}),
    ...(input.lastMessageID ? { lastMessageID: input.lastMessageID } : {}),
    ...(input.finalSegmentID ? { finalSegmentID: input.finalSegmentID } : {}),
    status: input.status ?? "running",
    ...(input.phase ? { phase: input.phase } : {}),
    startedAt: input.startedAt ?? 1,
    updatedAt: input.updatedAt ?? 2,
    ...(input.completedAt !== undefined ? { completedAt: input.completedAt } : {}),
    ...(input.userMessageID ? { userMessageID: input.userMessageID } : {}),
    messages: input.messages,
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

  it("keeps the original turn before a resumed permission continuation when rebuilding shared-user history", () => {
    const user = userMessage("user-permission", 1)
    const blockedAssistant = assistantMessage({
      id: "assistant-blocked",
      text: "Waiting for approval",
      backendTurnID: "turn-blocked",
      timestamp: 2,
    })
    const resumedAssistant = assistantMessage({
      id: "assistant-resumed",
      text: "Final result",
      backendTurnID: "turn-resumed",
      timestamp: 4,
    })
    const previous = [
      threadTurn({
        turnID: "turn-blocked",
        status: "blocked",
        userMessageID: user.id,
        messages: [user, blockedAssistant],
      }),
      threadTurn({
        turnID: "turn-resumed",
        resume: true,
        status: "completed",
        userMessageID: user.id,
        messages: [resumedAssistant],
      }),
    ]

    const rebuilt = buildThreadTurnsFromMessages(
      [user, blockedAssistant, resumedAssistant],
      previous,
    )

    expect(rebuilt.map((turn) => turn.turnID)).toEqual(["turn-blocked", "turn-resumed"])
    expect(rebuilt[0]?.messages.map((message) => message.id)).toEqual([user.id, blockedAssistant.id])
    expect(rebuilt[1]?.messages.map((message) => message.id)).toEqual([resumedAssistant.id])
    expect(rebuilt[1]?.resume).toBe(true)
  })

  it("atomically renames a correlated pending turn and remains idempotent", () => {
    const prompt = {
      ...userMessage("user-local"),
      displayText: "Local presentation",
      attachments: [{ name: "prompt.txt" }],
      delivery: { status: "pending" as const },
    }
    const placeholder = assistantMessage({
      id: "assistant-local",
      text: "Working",
      backendTurnID: "pending:assistant-local",
      segmentID: "pending:assistant-local",
    })
    const unaffected = threadTurn({
      turnID: "turn-unaffected",
      messages: [assistantMessage({
        id: "assistant-unaffected",
        text: "Earlier response",
        backendTurnID: "turn-unaffected",
      })],
    })
    const turns = [
      threadTurn({
        turnID: "pending:user-local",
        userMessageID: "user-local",
        messages: [prompt, placeholder],
      }),
      unaffected,
    ]
    const binding = {
      turnID: "turn-canonical",
      assistantThreadMessageID: "assistant-local",
      optimisticUserMessageID: "user-local",
      backendUserMessageID: "message-user-backend",
    }

    const bound = bindPendingThreadTurnToCanonical(turns, binding)

    expect(bound).toHaveLength(2)
    expect(bound[0]).toMatchObject({
      turnID: "turn-canonical",
      userMessageID: "user-local",
    })
    expect(bound[0]?.messages.map((message) => message.id)).toEqual(["user-local", "assistant-local"])
    expect(bound[0]?.messages[0]).toMatchObject({
      displayText: "Local presentation",
      attachments: [{ name: "prompt.txt" }],
      delivery: { status: "pending" },
    })
    expect(bound[0]?.messages[1]).toMatchObject({ backendTurnID: "turn-canonical" })
    expect(bound[1]).toBe(unaffected)
    expect(bindPendingThreadTurnToCanonical(bound, binding)).toBe(bound)
  })

  it("merges an existing canonical turn without duplicating aliased users and keeps canonical runtime metadata", () => {
    const localUser = {
      ...userMessage("user-local", 1),
      displayText: "Local presentation",
    }
    const backendUser = {
      ...userMessage("message-user-backend", 3),
      text: "Backend prompt",
    }
    const pendingAssistant = assistantMessage({
      id: "assistant-first",
      text: "First phase",
      backendTurnID: "turn-canonical",
      segmentID: "segment-first",
      timestamp: 2,
    })
    const canonicalAssistant = assistantMessage({
      id: "assistant-second",
      text: "Second phase",
      backendTurnID: "turn-canonical",
      segmentID: "segment-second",
      timestamp: 5,
    })
    const turns = [
      threadTurn({
        turnID: "pending:user-local",
        status: "completed",
        phase: "completed",
        startedAt: 1,
        updatedAt: 10,
        completedAt: 10,
        userMessageID: "user-local",
        lastMessageID: "stale-message",
        finalSegmentID: "stale-segment",
        messages: [localUser, pendingAssistant],
      }),
      threadTurn({
        turnID: "turn-canonical",
        status: "running",
        phase: "waiting_llm",
        startedAt: 3,
        updatedAt: 20,
        backendSessionID: "session-canonical",
        userMessageID: "message-user-backend",
        messages: [backendUser, canonicalAssistant],
      }),
    ]

    const bound = bindPendingThreadTurnToCanonical(turns, {
      turnID: "turn-canonical",
      assistantThreadMessageID: "assistant-first",
      optimisticUserMessageID: "user-local",
      backendUserMessageID: "message-user-backend",
    })

    expect(bound).toHaveLength(1)
    expect(bound[0]).toMatchObject({
      turnID: "turn-canonical",
      backendSessionID: "session-canonical",
      status: "running",
      phase: "waiting_llm",
      startedAt: 1,
      updatedAt: 20,
      userMessageID: "user-local",
    })
    expect(bound[0]?.completedAt).toBeUndefined()
    expect(bound[0]?.lastMessageID).toBeUndefined()
    expect(bound[0]?.finalSegmentID).toBeUndefined()
    expect(bound[0]?.messages.map((message) => message.id)).toEqual([
      "user-local",
      "assistant-first",
      "assistant-second",
    ])
    expect(bound[0]?.messages[0]).toMatchObject({
      id: "user-local",
      displayText: "Local presentation",
    })
  })

  it("uses canonical assistant identity when the same placeholder exists in both turns", () => {
    const pendingAssistant = assistantMessage({
      id: "assistant-shared",
      text: "Pending trace",
      backendTurnID: "pending:assistant-shared",
      segmentID: "pending:assistant-shared",
    })
    const canonicalAssistant = assistantMessage({
      id: "assistant-shared",
      text: "Canonical trace",
      backendTurnID: "turn-canonical",
      messageID: "message-canonical",
      segmentID: "segment-canonical",
      timestamp: 4,
    })
    const turns = [
      threadTurn({
        turnID: "pending:assistant-shared",
        messages: [pendingAssistant],
      }),
      threadTurn({
        turnID: "turn-canonical",
        messages: [canonicalAssistant],
      }),
    ]

    const bound = bindPendingThreadTurnToCanonical(turns, {
      turnID: "turn-canonical",
      assistantThreadMessageID: "assistant-shared",
    })

    expect(bound).toHaveLength(1)
    expect(bound[0]?.messages).toHaveLength(1)
    expect(bound[0]?.messages[0]).toMatchObject({
      id: "assistant-shared",
      backendTurnID: "turn-canonical",
      messageID: "message-canonical",
      segmentID: "segment-canonical",
      state: "completed",
    })
    expect(bound[0]?.messages[0]).toMatchObject({
      items: [expect.objectContaining({ text: "Canonical trace" })],
    })
  })

  it("reconciles a pending placeholder after it is assigned a canonical segment that already exists", () => {
    const pendingAssistant = assistantMessage({
      id: "assistant-local",
      text: "Pending trace",
      backendTurnID: "pending:assistant-local",
      segmentID: "pending:assistant-local",
    })
    const canonicalAssistant = assistantMessage({
      id: "assistant-canonical",
      text: "Canonical trace",
      backendTurnID: "turn-canonical",
      messageID: "message-canonical",
      segmentID: "segment-canonical",
      timestamp: 4,
    })
    const bound = bindPendingThreadTurnToCanonical([
      threadTurn({ turnID: "pending:assistant-local", messages: [pendingAssistant] }),
      threadTurn({ turnID: "turn-canonical", messages: [canonicalAssistant] }),
    ], {
      turnID: "turn-canonical",
      assistantThreadMessageID: "assistant-local",
    })

    expect(bound[0]?.messages).toHaveLength(2)

    const assigned = updateAssistantMessageInTurn(bound, {
      turnID: "turn-canonical",
      id: "assistant-local",
      updater: (message) => ({
        ...message,
        backendTurnID: "turn-canonical",
        messageID: "message-canonical",
        segmentID: "segment-canonical",
      }),
    })
    const reconciled = reconcileThreadTurns(assigned)

    expect(reconciled[0]?.messages).toHaveLength(1)
    expect(reconciled[0]?.messages[0]).toMatchObject({
      backendTurnID: "turn-canonical",
      messageID: "message-canonical",
      segmentID: "segment-canonical",
    })
  })

  it("refuses ambiguous or conflicting pending-turn correlations", () => {
    const conflictingBackend = [threadTurn({
      turnID: "pending:assistant-local",
      messages: [assistantMessage({
        id: "assistant-local",
        text: "Wrong turn",
        backendTurnID: "turn-other",
      })],
    })]
    expect(bindPendingThreadTurnToCanonical(conflictingBackend, {
      turnID: "turn-canonical",
      assistantThreadMessageID: "assistant-local",
    })).toBe(conflictingBackend)

    const ambiguous = [
      threadTurn({
        turnID: "pending:user-a",
        userMessageID: "user-a",
        messages: [
          userMessage("user-a"),
          assistantMessage({
            id: "assistant-shared",
            text: "A",
            backendTurnID: "pending:user-a",
          }),
        ],
      }),
      threadTurn({
        turnID: "pending:user-b",
        userMessageID: "user-b",
        messages: [
          userMessage("user-b"),
          assistantMessage({
            id: "assistant-shared",
            text: "B",
            backendTurnID: "pending:user-b",
          }),
        ],
      }),
    ]
    expect(bindPendingThreadTurnToCanonical(ambiguous, {
      turnID: "turn-canonical",
      assistantThreadMessageID: "assistant-shared",
      optimisticUserMessageID: "user-a",
    })).toBe(ambiguous)
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
