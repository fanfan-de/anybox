import { describe, expect, it } from "vitest"
import {
  canBindOptimisticUserAttemptToBackendTurn,
  isCurrentOptimisticUserAttempt,
  matchesOptimisticUserAttempt,
  matchesRetiredOptimisticUserAttempt,
  readOptimisticSubmissionError,
  resetUserMessageTurnForRetry,
  updateUserMessageDeliveryInTurns,
} from "./optimistic-user-submission"
import type {
  AssistantThreadMessage,
  ThreadTurn,
  UserThreadMessage,
} from "./types"

function userMessage(
  delivery: UserThreadMessage["delivery"] = { status: "pending" },
): UserThreadMessage {
  return {
    id: "user-local",
    kind: "user",
    text: "Keep the original request",
    timestamp: 10,
    ...(delivery ? { delivery } : {}),
  }
}

function assistantMessage(): AssistantThreadMessage {
  return {
    id: "assistant-local",
    kind: "assistant",
    backendTurnID: "turn-backend",
    segmentID: "assistant-local",
    timestamp: 11,
    runtime: {
      phase: "failed",
      startedAt: 11,
      updatedAt: 12,
    },
    state: "failed",
    items: [],
    isStreaming: false,
  }
}

function turn(message = userMessage()): ThreadTurn {
  return {
    turnID: "turn-backend",
    status: "failed",
    startedAt: 10,
    updatedAt: 12,
    completedAt: 12,
    userMessageID: message.id,
    messages: [message, assistantMessage()],
  }
}

describe("optimistic user submission state", () => {
  it("confirms a pending user message in place and remains idempotent", () => {
    const turns = [turn()]

    const confirmed = updateUserMessageDeliveryInTurns(
      turns,
      "user-local",
      undefined,
    )
    const confirmedMessage = confirmed[0]?.messages[0]

    expect(confirmed).toHaveLength(1)
    expect(confirmed[0]?.turnID).toBe("turn-backend")
    expect(confirmedMessage).toMatchObject({
      id: "user-local",
      kind: "user",
    })
    expect(
      confirmedMessage?.kind === "user" ? confirmedMessage.delivery : null,
    ).toBeUndefined()
    expect(
      updateUserMessageDeliveryInTurns(confirmed, "user-local", undefined),
    ).toBe(confirmed)
  })

  it("marks the same message failed without changing its turn or row identity", () => {
    const turns = [turn()]

    const failed = updateUserMessageDeliveryInTurns(turns, "user-local", {
      status: "failed",
      error: "Network unavailable",
    })

    expect(failed[0]?.turnID).toBe("turn-backend")
    expect(failed[0]?.messages[0]).toMatchObject({
      id: "user-local",
      delivery: {
        status: "failed",
        error: "Network unavailable",
      },
    })
    expect(
      updateUserMessageDeliveryInTurns(failed, "user-local", {
        status: "failed",
        error: "Network unavailable",
      }),
    ).toBe(failed)
  })

  it("resets a failed canonical turn for retry while preserving the user row", () => {
    const failedUser = userMessage({
      status: "failed",
      error: "Request rejected",
    })

    const retried = resetUserMessageTurnForRetry(
      [turn(failedUser)],
      failedUser.id,
    )

    expect(retried).toHaveLength(1)
    expect(retried[0]).toMatchObject({
      turnID: "pending:user-local",
      status: "running",
      userMessageID: "user-local",
      messages: [
        {
          id: "user-local",
          kind: "user",
          delivery: { status: "pending" },
        },
      ],
    })
    expect(retried[0]?.completedAt).toBeUndefined()
  })

  it("reads useful nested backend failure details with a stable fallback", () => {
    expect(readOptimisticSubmissionError({
      payload: {
        message: "Provider rejected the request",
      },
    })).toBe("Provider rejected the request")
    expect(readOptimisticSubmissionError(null, "Fallback failure")).toBe(
      "Fallback failure",
    )
  })

  it("matches only the current retry attempt identity", () => {
    const currentAttempt = {
      activeClientTurnID: "client-new",
      backendTurnID: "turn-new",
      userThreadMessageID: "user-local",
    }

    expect(
      isCurrentOptimisticUserAttempt(currentAttempt, "client-new"),
    ).toBe(true)
    expect(
      isCurrentOptimisticUserAttempt(currentAttempt, "client-old"),
    ).toBe(false)
    expect(
      matchesOptimisticUserAttempt(currentAttempt, {
        backendTurnID: "turn-old",
        clientTurnID: "client-old",
      }),
    ).toBe(false)
    expect(
      matchesOptimisticUserAttempt(currentAttempt, {
        backendTurnID: "turn-new",
      }),
    ).toBe(true)
    expect(
      matchesRetiredOptimisticUserAttempt(
        {
          retiredBackendTurnIDs: ["turn-old"],
          retiredClientTurnIDs: ["client-old"],
        },
        {
          backendTurnID: "turn-old",
          clientTurnID: "client-old",
        },
      ),
    ).toBe(true)
  })

  it("does not bind an uncorrelated subscription turn onto a retried attempt", () => {
    expect(
      canBindOptimisticUserAttemptToBackendTurn({}, "turn-first-attempt"),
    ).toBe(true)
    expect(
      canBindOptimisticUserAttemptToBackendTurn(
        {
          retiredClientTurnIDs: ["client-old"],
          retiredBackendTurnIDs: ["turn-old"],
        },
        "turn-old",
      ),
    ).toBe(false)
    expect(
      canBindOptimisticUserAttemptToBackendTurn(
        {
          retiredClientTurnIDs: ["client-old"],
        },
        "turn-unknown",
      ),
    ).toBe(false)
    expect(
      canBindOptimisticUserAttemptToBackendTurn(
        {
          backendTurnID: "turn-new",
          retiredClientTurnIDs: ["client-old"],
        },
        "turn-new",
      ),
    ).toBe(true)
  })
})
