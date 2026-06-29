import { useEffect, useMemo, useRef } from "react"
import type { SessionMessageTree } from "../session-message-tree"
import type {
  AssistantTraceVisibility,
  AssistantThreadMessage,
  AssistantThreadMessagePhase,
  PermissionRequest,
  SessionDiffSummary,
  SessionSummary,
  ThreadMessage,
} from "../types"
import { measureRendererPerf } from "../perf-profiler"
import { isSideChatSession } from "../workspace"
import {
  buildThreadDisplayContext,
  buildThreadDisplayRowsIncremental,
  createThreadDisplayRowsCache,
  decorateThreadDisplayRowsIncremental,
  type ThreadDisplayRowsCache,
  type ThreadDisplayRowsCacheStats,
  type ThreadDisplayContext,
  type ThreadDisplayRow,
} from "./thread-display-rows"

interface ThreadProjectionInput {
  activeMessages: ThreadMessage[]
  activeSession: SessionSummary | null
  activeSessionDiff?: SessionDiffSummary | null
  assistantTraceVisibility: AssistantTraceVisibility
  canForkFromMessage: boolean
  canOpenSideChat: boolean
  isResolvingPermissionRequest: boolean
  isSessionRunning: boolean
  messageTree?: SessionMessageTree | null
  pendingPermissionRequests: PermissionRequest[]
  sideChatCountsByAnchorMessageID: Record<string, number>
  sideChatPlacement: "inline" | "external"
  sideChatSession?: SessionSummary | null
  sideChatSessionsByAnchorMessageID?: Record<string, SessionSummary[]>
}

interface ThreadProjection {
  answeredQuestionIDs: Set<string>
  baseDisplayRows: ThreadDisplayRow[]
  displayMessages: ThreadMessage[]
  displayRows: ThreadDisplayRow[]
  threadDisplayContext: ThreadDisplayContext
  visibleMessageIDs: string[]
  visibleMessageIDsKey: string
}

function readAssistantMessageOrderTimestamp(message: AssistantThreadMessage) {
  const traceTimestamps = message.items
    .filter((item) => !item.sourceID?.endsWith(":stream-placeholder") && item.kind !== "system")
    .map((item) => item.timestamp)
    .filter((timestamp) => Number.isFinite(timestamp))

  if (traceTimestamps.length > 0) return Math.min(...traceTimestamps)

  const runtimeTimestamps = [
    message.runtime.firstVisibleAt,
    message.runtime.startedAt,
    message.timestamp,
  ].filter((timestamp): timestamp is number => Number.isFinite(timestamp))

  return runtimeTimestamps.length > 0 ? Math.min(...runtimeTimestamps) : 0
}

function isTerminalAssistantMessagePhase(phase: AssistantThreadMessagePhase) {
  return phase === "completed" || phase === "failed" || phase === "cancelled"
}

function orderAdjacentAssistantMessagesForDisplay(messages: ThreadMessage[]) {
  const orderedMessages = [...messages]
  let assistantBlockStart = -1

  const flushAssistantBlock = (endIndex: number) => {
    if (assistantBlockStart < 0) return

    const startIndex = assistantBlockStart
    assistantBlockStart = -1
    if (endIndex - startIndex <= 1) return

    const assistantBlock = orderedMessages.slice(startIndex, endIndex)
    const shouldOrderByTraceTime = assistantBlock.some(
      (message) => message.kind === "assistant" && (message.isStreaming || !isTerminalAssistantMessagePhase(message.runtime.phase)),
    )
    if (!shouldOrderByTraceTime) return

    const orderedAssistantBlock = assistantBlock
      .map((message, index) => ({ message, index }))
      .sort((left, right) => {
        const leftMessage = left.message
        const rightMessage = right.message
        if (leftMessage.kind !== "assistant" || rightMessage.kind !== "assistant") return left.index - right.index

        const timestampDelta = readAssistantMessageOrderTimestamp(leftMessage) - readAssistantMessageOrderTimestamp(rightMessage)
        return timestampDelta || left.index - right.index
      })
      .map(({ message }) => message)

    orderedMessages.splice(startIndex, endIndex - startIndex, ...orderedAssistantBlock)
  }

  orderedMessages.forEach((message, index) => {
    if (message.kind === "assistant") {
      if (assistantBlockStart < 0) assistantBlockStart = index
      return
    }

    flushAssistantBlock(index)
  })

  flushAssistantBlock(orderedMessages.length)
  return orderedMessages
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

function emptyThreadDisplayRowsCacheStats(): ThreadDisplayRowsCacheStats {
  return {
    cacheHitCount: 0,
    cacheMissCount: 0,
    invalidatedMessageCount: 0,
  }
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
  baseCache.messageSignaturesByID.forEach((entry, messageID) => {
    cache.messageSignaturesByID.set(messageID, entry)
  })
  committedCache.decorationRowsByOwnerMessageID.forEach((entry, ownerMessageID) => {
    cache.decorationRowsByOwnerMessageID.set(ownerMessageID, entry)
  })
  return cache
}

export function useThreadProjection({
  activeMessages,
  activeSession,
  activeSessionDiff = null,
  assistantTraceVisibility,
  canForkFromMessage,
  canOpenSideChat,
  isResolvingPermissionRequest,
  isSessionRunning,
  messageTree = null,
  pendingPermissionRequests,
  sideChatCountsByAnchorMessageID,
  sideChatPlacement,
  sideChatSession = null,
  sideChatSessionsByAnchorMessageID = {},
}: ThreadProjectionInput): ThreadProjection {
  const threadDisplayRowsCacheRef = useRef<ThreadDisplayRowsCache | null>(null)
  const answeredQuestionIDs = useMemo(() => collectAnsweredQuestionIDs(activeMessages), [activeMessages])
  const displayMessages = useMemo(() => orderAdjacentAssistantMessagesForDisplay(activeMessages), [activeMessages])
  const readOnlySideChat = isSideChatSession(activeSession)

  const visibleMessageIDs = useMemo(() => {
    const ids = displayMessages.map((message) => message.id)
    const pendingRequestID = pendingPermissionRequests[0]?.id
    return pendingRequestID ? [...ids, `permission-request:${pendingRequestID}`] : ids
  }, [displayMessages, pendingPermissionRequests])
  const visibleMessageIDsKey = visibleMessageIDs.join("\u0000")

  const threadDisplayContext = useMemo(
    () => buildThreadDisplayContext(displayMessages),
    [displayMessages],
  )

  const baseDisplayRowsResult = useMemo(
    () => {
      let baseDisplayRowsStats = emptyThreadDisplayRowsCacheStats()

      return measureRendererPerf(
        "ThreadView.buildBaseDisplayRows",
        () => {
          const result = buildThreadDisplayRowsIncremental(
            {
              activeSession,
              activeMessages: displayMessages,
              assistantTraceVisibility,
              context: threadDisplayContext,
              isResolvingPermissionRequest,
              pendingPermissionRequests,
            },
            threadDisplayRowsCacheRef.current,
          )
          baseDisplayRowsStats = result.stats
          return result
        },
        () => ({
          assistantItemCount: displayMessages.reduce(
            (count, message) => count + (message.kind === "assistant" ? message.items.length : 0),
            0,
          ),
          cacheHitCount: baseDisplayRowsStats.cacheHitCount,
          cacheMissCount: baseDisplayRowsStats.cacheMissCount,
          invalidatedMessageCount: baseDisplayRowsStats.invalidatedMessageCount,
          pendingPermissionRequestCount: pendingPermissionRequests.length,
          sessionID: activeSession?.id ?? null,
          messageCount: displayMessages.length,
        }),
      )
    },
    [
      activeSession,
      displayMessages,
      assistantTraceVisibility,
      threadDisplayContext,
      isResolvingPermissionRequest,
      pendingPermissionRequests,
    ],
  )
  const baseDisplayRows = baseDisplayRowsResult.rows

  const displayRowsResult = useMemo(
    () => {
      let decorateDisplayRowsStats = emptyThreadDisplayRowsCacheStats()
      const previousCache = mergeThreadDisplayRowsCachesForDecoration(
        baseDisplayRowsResult.cache,
        threadDisplayRowsCacheRef.current,
      )

      return measureRendererPerf(
        "ThreadView.decorateDisplayRows",
        () => {
          const result = decorateThreadDisplayRowsIncremental(
            {
              activeSessionDiff,
              assistantTraceVisibility,
              baseRows: baseDisplayRows,
              canForkFromMessage,
              canOpenSideChat,
              context: threadDisplayContext,
              isSessionRunning,
              messageTree,
              readOnlySideChat,
              sideChatCountsByAnchorMessageID,
              sideChatPlacement,
              sideChatSession,
              sideChatSessionsByAnchorMessageID,
            },
            previousCache,
          )
          decorateDisplayRowsStats = result.stats
          return result
        },
        () => ({
          baseRowCount: baseDisplayRows.length,
          cacheHitCount: decorateDisplayRowsStats.cacheHitCount,
          cacheMissCount: decorateDisplayRowsStats.cacheMissCount,
          invalidatedMessageCount: decorateDisplayRowsStats.invalidatedMessageCount,
          sessionID: activeSession?.id ?? null,
        }),
      )
    },
    [
      activeSession?.id,
      activeSessionDiff,
      assistantTraceVisibility,
      baseDisplayRows,
      baseDisplayRowsResult.cache,
      canForkFromMessage,
      canOpenSideChat,
      isSessionRunning,
      messageTree,
      readOnlySideChat,
      sideChatCountsByAnchorMessageID,
      sideChatPlacement,
      sideChatSession,
      sideChatSessionsByAnchorMessageID,
      threadDisplayContext,
    ],
  )
  const displayRows = displayRowsResult.rows

  useEffect(() => {
    threadDisplayRowsCacheRef.current = activeSession ? displayRowsResult.cache : null
  }, [activeSession, displayRowsResult.cache])

  return {
    answeredQuestionIDs,
    baseDisplayRows,
    displayMessages,
    displayRows,
    threadDisplayContext,
    visibleMessageIDs,
    visibleMessageIDsKey,
  }
}
