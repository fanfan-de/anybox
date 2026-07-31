import { describe, expect, it } from "vitest"
import type { ThreadTurn, UserThreadMessage } from "../types"
import { overlayBranchOptimisticUserTurns } from "./BranchChatPanel"

function localUserMessage(
  delivery: UserThreadMessage["delivery"] = { status: "pending" },
): UserThreadMessage {
  return {
    id: "user-local",
    kind: "user",
    text: "Branch request",
    displayText: "Branch request",
    timestamp: 10,
    ...(delivery ? { delivery } : {}),
  }
}

describe("BranchChatPanel optimistic user overlay", () => {
  it("adds a pending user turn without waiting for branch history", () => {
    const message = localUserMessage()

    const turns = overlayBranchOptimisticUserTurns([], {
      [message.id]: {
        activeClientTurnID: "client-1",
        executionID: "execution-1",
        message,
        userThreadMessageID: message.id,
      },
    })

    expect(turns).toHaveLength(1)
    expect(turns[0]).toMatchObject({
      turnID: "pending:user-local",
      status: "running",
      userMessageID: "user-local",
      messages: [
        {
          id: "user-local",
          delivery: { status: "pending" },
        },
      ],
    })
  })

  it("reconciles canonical history to one stable optimistic user row", () => {
    const canonicalUser: UserThreadMessage = {
      id: "message-user-backend",
      kind: "user",
      text: "Branch request",
      timestamp: 11,
    }
    const canonicalTurn: ThreadTurn = {
      turnID: "turn-backend",
      status: "running",
      startedAt: 11,
      updatedAt: 11,
      userMessageID: canonicalUser.id,
      messages: [canonicalUser],
    }
    const message = localUserMessage(undefined)

    const turns = overlayBranchOptimisticUserTurns([canonicalTurn], {
      [message.id]: {
        activeClientTurnID: "client-1",
        backendTurnID: "turn-backend",
        backendUserMessageID: canonicalUser.id,
        confirmed: true,
        executionID: "execution-1",
        message,
        userThreadMessageID: message.id,
      },
    })

    expect(turns).toHaveLength(1)
    expect(turns[0]).toMatchObject({
      turnID: "turn-backend",
      userMessageID: "user-local",
    })
    expect(turns[0]?.messages).toHaveLength(1)
    expect(turns[0]?.messages[0]).toMatchObject({
      id: "user-local",
      kind: "user",
      displayText: "Branch request",
    })
  })

  it("keeps a failed branch message available in the same row", () => {
    const message = localUserMessage({
      status: "failed",
      error: "Connection lost",
    })

    const turns = overlayBranchOptimisticUserTurns([], {
      [message.id]: {
        activeClientTurnID: "client-1",
        executionID: "execution-1",
        message,
        request: {
          backendSessionID: "session-branch",
          text: "raw branch request",
          displayText: "Branch request",
          threadTarget: {
            kind: "detached-branch",
            parentMessageID: "assistant-parent",
          },
        },
        userThreadMessageID: message.id,
      },
    })

    expect(turns[0]?.messages[0]).toMatchObject({
      id: "user-local",
      delivery: {
        status: "failed",
        error: "Connection lost",
      },
    })
  })
})
