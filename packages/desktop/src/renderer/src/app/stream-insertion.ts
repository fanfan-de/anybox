import type { AssistantTraceItem, AssistantThreadMessage, ThreadMessage, UserThreadMessage } from "./types"

function readStreamInsertionAssistantThreadMessageID(turn: UserThreadMessage) {
  return turn.streamInsertion?.assistantThreadMessageID ?? turn.streamInsertion?.assistantTurnID
}

function getStreamInsertionAssistantMessage(turns: ThreadMessage[], turn: UserThreadMessage) {
  const assistantThreadMessageID = readStreamInsertionAssistantThreadMessageID(turn)
  if (!assistantThreadMessageID) return null

  return turns.find(
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

function getStreamInsertionRequestedIndex(items: AssistantTraceItem[], turn: UserThreadMessage, cursor: number) {
  return Math.min(
    items.length,
    Math.max(cursor, turn.streamInsertion?.afterItemCount ?? cursor),
  )
}

export function hasStreamInsertionTarget(turns: ThreadMessage[], turn: UserThreadMessage) {
  return Boolean(getStreamInsertionAssistantMessage(turns, turn))
}

export function isStreamInsertionReady(turns: ThreadMessage[], turn: UserThreadMessage) {
  const assistantMessage = getStreamInsertionAssistantMessage(turns, turn)
  if (!assistantMessage) return false

  const requestedIndex = getStreamInsertionRequestedIndex(assistantMessage.items, turn, 0)
  if (assistantMessage.items.length <= requestedIndex) return false

  if (getActiveToolBeforeInsertionIndex(assistantMessage.items, requestedIndex)) return false

  const followingTool = assistantMessage.items.find(
    (item, index) => index >= requestedIndex && item.kind === "tool",
  )
  if (followingTool) return isToolInsertionBoundaryReady(followingTool)

  return true
}

function isStreamInsertionConsumed(turn: UserThreadMessage) {
  return turn.streamInsertion?.status !== "pending"
}

export function isPendingSteerUserMessage(turns: ThreadMessage[], turn: UserThreadMessage) {
  if (turn.submissionMode !== "steer") return false

  if (turn.streamInsertion?.status === "pending") return true
  if (hasStreamInsertionTarget(turns, turn)) {
    return !isStreamInsertionConsumed(turn) || !isStreamInsertionReady(turns, turn)
  }
  if (turn.streamInsertion?.status === "consumed") return false

  return true
}

export function getPendingStreamInsertionUserMessages(turns: ThreadMessage[]) {
  return turns.filter(
    (turn): turn is UserThreadMessage =>
      turn.kind === "user" &&
      isPendingSteerUserMessage(turns, turn),
  )
}

export function isPendingQueuedUserMessage(_turns: ThreadMessage[], turn: UserThreadMessage) {
  return turn.submissionMode === "queued"
}

export function getPendingQueuedUserMessages(turns: ThreadMessage[]) {
  return turns.filter(
    (turn): turn is UserThreadMessage =>
      turn.kind === "user" &&
      isPendingQueuedUserMessage(turns, turn),
  )
}

export function getAssistantStreamInsertionUserMessages(turns: ThreadMessage[], assistantMessage: AssistantThreadMessage) {
  return turns
    .filter(
      (turn): turn is UserThreadMessage =>
        turn.kind === "user" &&
        readStreamInsertionAssistantThreadMessageID(turn) === assistantMessage.id &&
        isStreamInsertionConsumed(turn) &&
        isStreamInsertionReady(turns, turn),
    )
    .sort((left, right) => {
      const leftIndex = left.streamInsertion?.afterItemCount ?? 0
      const rightIndex = right.streamInsertion?.afterItemCount ?? 0
      if (leftIndex !== rightIndex) return leftIndex - rightIndex
      return left.timestamp - right.timestamp
    })
}

export function resolveStreamInsertionItemIndex(items: AssistantTraceItem[], turn: UserThreadMessage, cursor: number) {
  const requestedIndex = getStreamInsertionRequestedIndex(items, turn, cursor)
  const followingToolIndex = items.findIndex((item, index) => index >= requestedIndex && item.kind === "tool")

  return followingToolIndex === -1 ? requestedIndex : followingToolIndex + 1
}
