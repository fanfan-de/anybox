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

interface StreamInsertionItemIndex {
  nextToolIndexAtOrAfter: number[]
}

const STREAM_INSERTION_ITEM_INDEX_BY_ITEMS = new WeakMap<AssistantTraceItem[], StreamInsertionItemIndex>()

export interface StreamInsertionIndex {
  insertionItemIndexByUserMessageID: Map<string, number>
  insertedUserMessagesByAssistantID: Map<string, UserThreadMessage[]>
  pendingSteerUserMessageIDs: Set<string>
  targetAssistantMessageIDByUserMessageID: Map<string, string>
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

function buildStreamInsertionItemIndex(items: AssistantTraceItem[]): StreamInsertionItemIndex {
  const cachedIndex = STREAM_INSERTION_ITEM_INDEX_BY_ITEMS.get(items)
  if (cachedIndex) return cachedIndex

  const nextToolIndexAtOrAfter = new Array<number>(items.length + 1).fill(-1)
  let nextToolIndex = -1

  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (items[index]?.kind === "tool") nextToolIndex = index
    nextToolIndexAtOrAfter[index] = nextToolIndex
  }

  const itemIndex = { nextToolIndexAtOrAfter }
  STREAM_INSERTION_ITEM_INDEX_BY_ITEMS.set(items, itemIndex)
  return itemIndex
}

function getNextToolIndexAtOrAfter(itemIndex: StreamInsertionItemIndex, requestedIndex: number) {
  // afterItemCount is an integer in the protocol. Rounding only protects persisted
  // malformed values while preserving Array.find(index >= requestedIndex) semantics.
  return itemIndex.nextToolIndexAtOrAfter[Math.ceil(requestedIndex)] ?? -1
}

function isStreamInsertionReadyForAssistant(
  assistantMessage: AssistantThreadMessage,
  message: UserThreadMessage,
  itemIndex: StreamInsertionItemIndex,
) {
  const requestedIndex = getStreamInsertionRequestedIndex(assistantMessage.items, message, 0)
  if (assistantMessage.items.length <= requestedIndex) return false

  if (getActiveToolBeforeInsertionIndex(assistantMessage.items, requestedIndex)) return false

  const followingToolIndex = getNextToolIndexAtOrAfter(itemIndex, requestedIndex)
  if (followingToolIndex >= 0) {
    return isToolInsertionBoundaryReady(assistantMessage.items[followingToolIndex]!)
  }

  return true
}

function resolveStreamInsertionItemIndexFromIndex(
  items: AssistantTraceItem[],
  message: UserThreadMessage,
  cursor: number,
  itemIndex: StreamInsertionItemIndex,
) {
  const requestedIndex = getStreamInsertionRequestedIndex(items, message, cursor)
  const followingToolIndex = getNextToolIndexAtOrAfter(itemIndex, requestedIndex)

  return followingToolIndex < 0 ? requestedIndex : followingToolIndex + 1
}

function compareStreamInsertionMessages(left: UserThreadMessage, right: UserThreadMessage) {
  const leftIndex = left.streamInsertion?.afterItemCount ?? 0
  const rightIndex = right.streamInsertion?.afterItemCount ?? 0
  if (leftIndex !== rightIndex) return leftIndex - rightIndex
  return left.timestamp - right.timestamp
}

/**
 * Builds all stream-insertion presentation facts in one pass over messages plus
 * one reverse pass over the items of each targeted assistant. Thread projection
 * uses this instead of resolving every inserted user message independently.
 */
export function buildStreamInsertionIndex(messages: ThreadMessage[]): StreamInsertionIndex {
  const assistantMessageByID = new Map<string, AssistantThreadMessage>()
  const targetedUserMessagesByAssistantID = new Map<string, UserThreadMessage[]>()
  const targetAssistantMessageIDByUserMessageID = new Map<string, string>()
  const pendingSteerUserMessageIDs = new Set<string>()

  for (const message of messages) {
    if (message.kind === "assistant" && !assistantMessageByID.has(message.id)) {
      assistantMessageByID.set(message.id, message)
    }
  }

  for (const message of messages) {
    if (message.kind !== "user") continue

    const targetAssistantMessageID = readStreamInsertionAssistantThreadMessageID(message)
    const targetAssistantMessage = targetAssistantMessageID
      ? assistantMessageByID.get(targetAssistantMessageID)
      : undefined

    if (targetAssistantMessageID && targetAssistantMessage) {
      targetAssistantMessageIDByUserMessageID.set(message.id, targetAssistantMessageID)
      const targetedMessages = targetedUserMessagesByAssistantID.get(targetAssistantMessageID)
      if (targetedMessages) targetedMessages.push(message)
      else targetedUserMessagesByAssistantID.set(targetAssistantMessageID, [message])
      continue
    }

    if (
      message.submissionMode === "steer" &&
      message.streamInsertion?.status !== "consumed"
    ) {
      pendingSteerUserMessageIDs.add(message.id)
    }
  }

  const insertedUserMessagesByAssistantID = new Map<string, UserThreadMessage[]>()
  const insertionItemIndexByUserMessageID = new Map<string, number>()

  targetedUserMessagesByAssistantID.forEach((targetedMessages, assistantMessageID) => {
    const assistantMessage = assistantMessageByID.get(assistantMessageID)
    if (!assistantMessage) return

    const itemIndex = buildStreamInsertionItemIndex(assistantMessage.items)
    const insertedMessages: UserThreadMessage[] = []

    for (const message of targetedMessages) {
      const isReady = isStreamInsertionReadyForAssistant(assistantMessage, message, itemIndex)
      if (message.submissionMode === "steer" && (
        message.streamInsertion?.status === "pending" ||
        !isStreamInsertionConsumed(message) ||
        !isReady
      )) {
        pendingSteerUserMessageIDs.add(message.id)
      }

      if (isStreamInsertionConsumed(message) && isReady) insertedMessages.push(message)
    }

    insertedMessages.sort(compareStreamInsertionMessages)
    let cursor = 0
    for (const message of insertedMessages) {
      const insertionItemIndex = resolveStreamInsertionItemIndexFromIndex(
        assistantMessage.items,
        message,
        cursor,
        itemIndex,
      )
      insertionItemIndexByUserMessageID.set(message.id, insertionItemIndex)
      cursor = insertionItemIndex
    }

    insertedUserMessagesByAssistantID.set(assistantMessageID, insertedMessages)
  })

  return {
    insertionItemIndexByUserMessageID,
    insertedUserMessagesByAssistantID,
    pendingSteerUserMessageIDs,
    targetAssistantMessageIDByUserMessageID,
  }
}

export function hasStreamInsertionTarget(messages: ThreadMessage[], message: UserThreadMessage) {
  return Boolean(getStreamInsertionAssistantMessage(messages, message))
}

export function isStreamInsertionReady(messages: ThreadMessage[], message: UserThreadMessage) {
  const assistantMessage = getStreamInsertionAssistantMessage(messages, message)
  if (!assistantMessage) return false
  return isStreamInsertionReadyForAssistant(
    assistantMessage,
    message,
    buildStreamInsertionItemIndex(assistantMessage.items),
  )
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
  const index = buildStreamInsertionIndex(messages)
  return messages.filter(
    (message): message is UserThreadMessage =>
      message.kind === "user" &&
      index.pendingSteerUserMessageIDs.has(message.id),
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
  return buildStreamInsertionIndex(messages).insertedUserMessagesByAssistantID.get(assistantMessage.id) ?? []
}

export function resolveStreamInsertionItemIndex(items: AssistantTraceItem[], message: UserThreadMessage, cursor: number) {
  return resolveStreamInsertionItemIndexFromIndex(
    items,
    message,
    cursor,
    buildStreamInsertionItemIndex(items),
  )
}
