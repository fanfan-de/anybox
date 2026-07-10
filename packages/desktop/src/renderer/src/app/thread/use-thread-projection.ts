import { useEffect, useMemo, useRef } from "react"
import type { SessionMessageTree } from "../session-message-tree"
import type {
  AssistantTraceVisibility,
  AssistantThreadMessage,
  AssistantThreadMessagePhase,
  PermissionRequest,
  SessionSummary,
  ThreadMessage,
} from "../types"
import { isSideChatSession } from "../workspace"
import {
  buildThreadDisplayContext,
  buildThreadDisplayRowsIncremental,
  createThreadDisplayRowsCache,
  decorateThreadDisplayRowsIncremental,
  type ThreadDisplayRowsCache,
  type ThreadDisplayContext,
  type ThreadDisplayRow,
} from "./thread-display-rows"

interface ThreadProjectionInput {
  activeMessages: ThreadMessage[]
  activeSession: SessionSummary | null
  assistantTraceVisibility: AssistantTraceVisibility
  canForkFromMessage: boolean
  canOpenSideChat: boolean
  isResolvingPermissionRequest: boolean
  isSessionRunning: boolean
  messageTree?: SessionMessageTree | null
  pendingPermissionRequests: PermissionRequest[]
  sideChatCountsByAnchorMessageID: Record<string, number>
  sideChatSession?: SessionSummary | null
}

interface ThreadProjection {
  answeredQuestionIDs: Set<string>
  baseDisplayRows: ThreadDisplayRow[]
  displayMessages: ThreadMessage[]
  displayRows: ThreadDisplayRow[]
  threadDisplayContext: ThreadDisplayContext
}

const ASSISTANT_ORDER_TIMESTAMP_BY_MESSAGE = new WeakMap<AssistantThreadMessage, number>()

function readAssistantMessageOrderTimestamp(message: AssistantThreadMessage) {
  const cachedTimestamp = ASSISTANT_ORDER_TIMESTAMP_BY_MESSAGE.get(message)
  if (cachedTimestamp !== undefined) return cachedTimestamp

  let earliestTraceTimestamp = Number.POSITIVE_INFINITY
  for (const item of message.items) {
    if (item.sourceID?.endsWith(":stream-placeholder") || item.kind === "system") continue
    if (Number.isFinite(item.timestamp)) earliestTraceTimestamp = Math.min(earliestTraceTimestamp, item.timestamp)
  }

  if (Number.isFinite(earliestTraceTimestamp)) {
    ASSISTANT_ORDER_TIMESTAMP_BY_MESSAGE.set(message, earliestTraceTimestamp)
    return earliestTraceTimestamp
  }

  const runtimeTimestamps = [
    message.runtime.firstVisibleAt,
    message.runtime.startedAt,
    message.timestamp,
  ].filter((timestamp): timestamp is number => Number.isFinite(timestamp))

  const timestamp = runtimeTimestamps.length > 0 ? Math.min(...runtimeTimestamps) : 0
  ASSISTANT_ORDER_TIMESTAMP_BY_MESSAGE.set(message, timestamp)
  return timestamp
}

function isTerminalAssistantMessagePhase(phase: AssistantThreadMessagePhase) {
  return phase === "completed" || phase === "failed" || phase === "cancelled"
}

function orderAdjacentAssistantMessagesForDisplay(messages: ThreadMessage[]) {
  let orderedMessages: ThreadMessage[] | null = null
  let assistantBlockStart = -1

  const readMessages = () => orderedMessages ?? messages
  const ensureOrderedMessages = () => {
    if (!orderedMessages) orderedMessages = [...messages]
    return orderedMessages
  }

  const flushAssistantBlock = (endIndex: number) => {
    if (assistantBlockStart < 0) return

    const startIndex = assistantBlockStart
    assistantBlockStart = -1
    if (endIndex - startIndex <= 1) return

    const sourceMessages = readMessages()
    const assistantBlock = sourceMessages.slice(startIndex, endIndex)
    const shouldOrderByTraceTime = assistantBlock.some(
      (message) => message.kind === "assistant" && (message.isStreaming || !isTerminalAssistantMessagePhase(message.runtime.phase)),
    )
    if (!shouldOrderByTraceTime) return

    const orderedAssistantBlock = assistantBlock
      .map((message, index) => ({
        index,
        message,
        timestamp: message.kind === "assistant" ? readAssistantMessageOrderTimestamp(message) : 0,
      }))
      .sort((left, right) => {
        const leftMessage = left.message
        const rightMessage = right.message
        if (leftMessage.kind !== "assistant" || rightMessage.kind !== "assistant") return left.index - right.index

        const timestampDelta = left.timestamp - right.timestamp
        return timestampDelta || left.index - right.index
      })
      .map(({ message }) => message)

    const didReorder = orderedAssistantBlock.some((message, index) => message !== assistantBlock[index])
    if (!didReorder) return

    ensureOrderedMessages().splice(startIndex, endIndex - startIndex, ...orderedAssistantBlock)
  }

  for (let index = 0; index < messages.length; index += 1) {
    const message = readMessages()[index]!
    if (message.kind === "assistant") {
      if (assistantBlockStart < 0) assistantBlockStart = index
      continue
    }

    flushAssistantBlock(index)
  }

  flushAssistantBlock(messages.length)
  return orderedMessages ?? messages
}

function collectAnsweredQuestionIDs(messages: ThreadMessage[]) {
  const answeredQuestionIDs = new Set<string>()

  for (const message of messages) {
    if (message.kind !== "user") continue

    const questionID = message.questionAnswer?.questionID
    if (!questionID) continue
    answeredQuestionIDs.add(questionID)
  }

  return answeredQuestionIDs
}

function mergeThreadDisplayRowsCachesForDecoration(
  baseCache: ThreadDisplayRowsCache,
  committedCache: ThreadDisplayRowsCache | null,
) {
  if (
    !committedCache ||
    committedCache.version !== baseCache.version ||
    committedCache.sessionID !== baseCache.sessionID
  ) {
    return baseCache
  }

  const cache = createThreadDisplayRowsCache(baseCache.sessionID)
  baseCache.baseRowsByMessageID.forEach((entry, messageID) => {
    cache.baseRowsByMessageID.set(messageID, entry)
  })
  committedCache.decorationRowsByOwnerMessageID.forEach((entry, ownerMessageID) => {
    cache.decorationRowsByOwnerMessageID.set(ownerMessageID, entry)
  })
  return cache
}

export function useThreadProjection({
  activeMessages,
  activeSession,
  assistantTraceVisibility,
  canForkFromMessage,
  canOpenSideChat,
  isResolvingPermissionRequest,
  isSessionRunning,
  messageTree = null,
  pendingPermissionRequests,
  sideChatCountsByAnchorMessageID,
  sideChatSession = null,
}: ThreadProjectionInput): ThreadProjection {
  const threadDisplayRowsCacheRef = useRef<ThreadDisplayRowsCache | null>(null)
  const activeSessionID = activeSession?.id ?? null
  const pendingPermissionRequestID = pendingPermissionRequests[0]?.id ?? null
  const pendingPermissionRequestCount = pendingPermissionRequests.length
  const answeredQuestionIDs = useMemo(() => collectAnsweredQuestionIDs(activeMessages), [activeMessages])
  const displayMessages = useMemo(() => orderAdjacentAssistantMessagesForDisplay(activeMessages), [activeMessages])
  const readOnlySideChat = isSideChatSession(activeSession)

  const threadDisplayContext = useMemo(
    () => buildThreadDisplayContext(displayMessages),
    [displayMessages],
  )

  const baseDisplayRowsResult = useMemo(
    () => {
      return buildThreadDisplayRowsIncremental(
        {
          activeSessionID,
          activeMessages: displayMessages,
          assistantTraceVisibility,
          context: threadDisplayContext,
          isResolvingPermissionRequest,
          pendingPermissionRequests,
        },
        threadDisplayRowsCacheRef.current,
      )
    },
    [
      activeSessionID,
      displayMessages,
      assistantTraceVisibility,
      threadDisplayContext,
      isResolvingPermissionRequest,
      pendingPermissionRequestCount,
      pendingPermissionRequestID,
    ],
  )
  const baseDisplayRows = baseDisplayRowsResult.rows

  const displayRowsResult = useMemo(
    () => {
      const previousCache = mergeThreadDisplayRowsCachesForDecoration(
        baseDisplayRowsResult.cache,
        threadDisplayRowsCacheRef.current,
      )

      return decorateThreadDisplayRowsIncremental(
        {
          assistantTraceVisibility,
          baseRows: baseDisplayRows,
          canForkFromMessage,
          canOpenSideChat,
          context: threadDisplayContext,
          hasPendingPermissionRequests: pendingPermissionRequestCount > 0,
          isSessionRunning,
          messageTree,
          readOnlySideChat,
          sideChatCountsByAnchorMessageID,
          sideChatSession,
        },
        previousCache,
      )
    },
    [
      activeSessionID,
      assistantTraceVisibility,
      baseDisplayRows,
      baseDisplayRowsResult.cache,
      canForkFromMessage,
      canOpenSideChat,
      isSessionRunning,
      messageTree,
      pendingPermissionRequestCount,
      readOnlySideChat,
      sideChatCountsByAnchorMessageID,
      sideChatSession,
      threadDisplayContext,
    ],
  )
  const displayRows = displayRowsResult.rows

  useEffect(() => {
    threadDisplayRowsCacheRef.current = activeSessionID ? displayRowsResult.cache : null
  }, [activeSessionID, displayRowsResult.cache])

  return {
    answeredQuestionIDs,
    baseDisplayRows,
    displayMessages,
    displayRows,
    threadDisplayContext,
  }
}
