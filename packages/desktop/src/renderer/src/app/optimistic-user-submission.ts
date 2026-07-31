import { mapMessageInTurns } from "./thread-turn-state"
import type {
  OptimisticUserAttempt,
  ThreadTurn,
  UserMessageDelivery,
  UserThreadMessage,
} from "./types"

export function applyUserMessageDelivery(
  message: UserThreadMessage,
  delivery: UserMessageDelivery | undefined,
) {
  if (!delivery) {
    if (!message.delivery) return message
    const { delivery: _delivery, ...confirmedMessage } = message
    return confirmedMessage
  }
  if (
    message.delivery?.status === "pending" &&
    delivery.status === "pending"
  ) {
    return message
  }
  if (
    message.delivery?.status === "failed" &&
    delivery.status === "failed" &&
    message.delivery.error === delivery.error &&
    message.delivery.reason === delivery.reason
  ) {
    return message
  }
  return {
    ...message,
    delivery,
  }
}

export function isCurrentOptimisticUserAttempt(
  submission: Pick<OptimisticUserAttempt, "activeClientTurnID">,
  activeClientTurnID?: string,
) {
  return Boolean(
    !activeClientTurnID ||
    !submission.activeClientTurnID ||
    submission.activeClientTurnID === activeClientTurnID,
  )
}

export function matchesOptimisticUserAttempt(
  submission: Pick<
    OptimisticUserAttempt,
    "activeClientTurnID" | "backendTurnID"
  > & { executionID?: string },
  input: {
    backendTurnID?: string | null
    clientTurnID?: string | null
    executionID?: string | null
  },
) {
  return Boolean(
    (input.clientTurnID &&
      submission.activeClientTurnID === input.clientTurnID) ||
    (input.executionID && submission.executionID === input.executionID) ||
    (input.backendTurnID && submission.backendTurnID === input.backendTurnID),
  )
}

export function matchesRetiredOptimisticUserAttempt(
  submission: Pick<
    OptimisticUserAttempt,
    "retiredBackendTurnIDs" | "retiredClientTurnIDs"
  >,
  input: {
    backendTurnID?: string | null
    clientTurnID?: string | null
  },
) {
  return Boolean(
    (input.clientTurnID &&
      submission.retiredClientTurnIDs?.includes(input.clientTurnID)) ||
    (input.backendTurnID &&
      submission.retiredBackendTurnIDs?.includes(input.backendTurnID)),
  )
}

export function canBindOptimisticUserAttemptToBackendTurn(
  submission: Pick<
    OptimisticUserAttempt,
    "backendTurnID" | "retiredBackendTurnIDs" | "retiredClientTurnIDs"
  >,
  backendTurnID: string,
) {
  if (submission.retiredBackendTurnIDs?.includes(backendTurnID)) return false
  if (submission.backendTurnID) {
    return submission.backendTurnID === backendTurnID
  }
  return !submission.retiredClientTurnIDs?.length
}

export function updateUserMessageDeliveryInTurns(
  turns: ThreadTurn[],
  messageID: string,
  delivery: UserMessageDelivery | undefined,
) {
  return mapMessageInTurns(turns, (message) => {
    if (message.kind !== "user" || message.id !== messageID) return message
    return applyUserMessageDelivery(message, delivery)
  })
}

export function resetUserMessageTurnForRetry(
  turns: ThreadTurn[],
  messageID: string,
) {
  const targetIndex = turns.findIndex((turn) =>
    turn.messages.some((message) => message.kind === "user" && message.id === messageID),
  )
  if (targetIndex < 0) return turns

  const targetTurn = turns[targetIndex]!
  const userMessage = targetTurn.messages.find(
    (message): message is UserThreadMessage => message.kind === "user" && message.id === messageID,
  )
  if (!userMessage) return turns

  const pendingMessage: UserThreadMessage = {
    ...userMessage,
    delivery: { status: "pending" },
  }
  const timestamp = Date.now()
  const resetTurn: ThreadTurn = {
    turnID: `pending:${messageID}`,
    status: "running",
    startedAt: userMessage.timestamp,
    updatedAt: Math.max(timestamp, userMessage.timestamp),
    userMessageID: messageID,
    messages: [pendingMessage],
  }

  return turns.map((turn, index) => (index === targetIndex ? resetTurn : turn))
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

export function readOptimisticSubmissionError(data: unknown, fallback = "Unable to send message.") {
  const record = readRecord(data)
  const nestedError = readRecord(record?.error)
  const payload = readRecord(record?.payload)
  const payloadError = readRecord(payload?.error)
  return (
    readString(record?.message) ||
    readString(payload?.message) ||
    readString(payload?.reason) ||
    readString(nestedError?.message) ||
    readString(payloadError?.message) ||
    readString(record?.error) ||
    readString(payload?.error) ||
    fallback
  )
}
