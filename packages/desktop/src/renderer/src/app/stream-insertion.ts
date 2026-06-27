import type { AssistantTraceItem, AssistantThreadMessage, ThreadMessage, UserThreadMessage } from "./types"

function readLegacyAssistantThreadMessageID(value: unknown) {
  // Read-only compatibility for persisted steer insertions written before the message rename.
  const legacyMessageID = (value as { assistantTurnID?: unknown } | null | undefined)?.assistantTurnID
  return typeof legacyMessageID === "string" ? legacyMessageID : undefined
}

function readStreamInsertionAssistantThreadMessageID(message: UserThreadMessage) {
  return message.streamInsertion?.assistantThreadMessageID ?? readLegacyAssistantThreadMessageID(message.streamInsertion)
}

function getStreamInsertionAssistantMessage(messages: ThreadMessage[], message: UserThreadMessage) {
  const assistantThreadMessageID = readStreamInsertionAssistantThreadMessageID(message)
  if (!assistantThreadMessageID) return null

  return messages.find(
    (candidate): candidate is AssistantThreadMessage =>
      candidate.kind === "assistant" && candidate.id === assistantThreadMessageID,
  ) ?? null
}

function isToolInsertionBoundaryReady(item: AssistantTraceItem) {
  return item.status === "completed" ||
    item.status === "error" ||
    item.status === "denied" ||
    item.status === "cancelled" ||
    item.status === "waiting-approval"
}

function getActiveToolBeforeInsertionIndex(items: AssistantTraceItem[], requestedIndex: number) {
  const previousItem = items[requestedIndex - 1]
  return previousItem?.kind === "tool" && !isToolInsertionBoundaryReady(previousItem)
    ? previousItem
    : null
}

function getStreamInsertionRequestedIndex(items: AssistantTraceItem[], message: UserThreadMessage, cursor: number) {
  return Math.min(
    items.length,
    Math.max(cursor, message.streamInsertion?.afterItemCount ?? cursor),
  )
}

export function hasStreamInsertionTarget(messages: ThreadMessage[], message: UserThreadMessage) {
  return Boolean(getStreamInsertionAssistantMessage(messages, message))
}

export function isStreamInsertionReady(messages: ThreadMessage[], message: UserThreadMessage) {
  const assistantMessage = getStreamInsertionAssistantMessage(messages, message)
  if (!assistantMessage) return false

  const requestedIndex = getStreamInsertionRequestedIndex(assistantMessage.items, message, 0)
  if (assistantMessage.items.length <= requestedIndex) return false

  if (getActiveToolBeforeInsertionIndex(assistantMessage.items, requestedIndex)) return false

  const followingTool = assistantMessage.items.find(
    (item, index) => index >= requestedIndex && item.kind === "tool",
  )
  if (followingTool) return isToolInsertionBoundaryReady(followingTool)

  return true
}

function isStreamInsertionConsumed(message: UserThreadMessage) {
  return message.streamInsertion?.status !== "pending"
}

export function isPendingSteerUserMessage(messages: ThreadMessage[], message: UserThreadMessage) {
  if (message.submissionMode !== "steer") return false

  if (message.streamInsertion?.status === "pending") return true
  if (hasStreamInsertionTarget(messages, message)) {
    return !isStreamInsertionConsumed(message) || !isStreamInsertionReady(messages, message)
  }
  if (message.streamInsertion?.status === "consumed") return false

  return true
}

export function getPendingStreamInsertionUserMessages(messages: ThreadMessage[]) {
  return messages.filter(
    (message): message is UserThreadMessage =>
      message.kind === "user" &&
      isPendingSteerUserMessage(messages, message),
  )
}

export function isPendingQueuedUserMessage(_messages: ThreadMessage[], message: UserThreadMessage) {
  return message.submissionMode === "queued"
}

export function getPendingQueuedUserMessages(messages: ThreadMessage[]) {
  return messages.filter(
    (message): message is UserThreadMessage =>
      message.kind === "user" &&
      isPendingQueuedUserMessage(messages, message),
  )
}

export function getAssistantStreamInsertionUserMessages(messages: ThreadMessage[], assistantMessage: AssistantThreadMessage) {
  return messages
    .filter(
      (message): message is UserThreadMessage =>
        message.kind === "user" &&
        readStreamInsertionAssistantThreadMessageID(message) === assistantMessage.id &&
        isStreamInsertionConsumed(message) &&
        isStreamInsertionReady(messages, message),
    )
    .sort((left, right) => {
      const leftIndex = left.streamInsertion?.afterItemCount ?? 0
      const rightIndex = right.streamInsertion?.afterItemCount ?? 0
      if (leftIndex !== rightIndex) return leftIndex - rightIndex
      return left.timestamp - right.timestamp
    })
}

export function resolveStreamInsertionItemIndex(items: AssistantTraceItem[], message: UserThreadMessage, cursor: number) {
  const requestedIndex = getStreamInsertionRequestedIndex(items, message, cursor)
  const followingToolIndex = items.findIndex((item, index) => index >= requestedIndex && item.kind === "tool")

  return followingToolIndex === -1 ? requestedIndex : followingToolIndex + 1
}
