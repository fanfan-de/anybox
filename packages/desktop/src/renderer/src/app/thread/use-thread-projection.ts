import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import type { SessionMessageTree } from "../session-message-tree"
import type {
  AssistantTraceVisibility,
  AssistantThreadMessage,
  AssistantThreadMessagePhase,
  PermissionRequest,
  SessionSummary,
  ThreadMessage,
  ThreadTurn,
  UserThreadMessage,
} from "../types"
import {
  buildThreadDisplayContext,
  buildThreadDisplayRowsIncremental,
  createThreadDisplayRowsCache,
  decorateThreadDisplayRowsIncremental,
  type ThreadDisplayRowsCache,
  type ThreadDisplayContext,
  type ThreadDisplayRow,
} from "./thread-display-rows"
import {
  deriveThreadExecutionGroups,
  projectThreadDisplayRowsWithExecutionGroups,
  resolveExecutionGroupExpanded,
  type ThreadExecutionGroup,
} from "./thread-execution-groups"
import {
  selectProcessDisclosurePreference,
  type ThreadPresentationStoreApi,
} from "./thread-presentation-store"

interface ThreadProjectionInput {
  activeMessages: ThreadMessage[]
  activeSession: SessionSummary | null
  activeTurns?: ThreadTurn[] | null
  assistantTraceVisibility: AssistantTraceVisibility
  canForkFromMessage: boolean
  isResolvingPermissionRequest: boolean
  isSessionRunning: boolean
  messageTree?: SessionMessageTree | null
  pendingPermissionRequests: PermissionRequest[]
  presentationScopeID: string
  presentationStore: ThreadPresentationStoreApi
}

interface ThreadProjection {
  baseDisplayRows: ThreadDisplayRow[]
  commitPendingAutoCollapse: (groupIDs: readonly string[]) => void
  displayMessages: ThreadMessage[]
  displayRows: ThreadDisplayRow[]
  executionGroups: ThreadExecutionGroup[]
  pendingAutoCollapseGroups: ThreadExecutionGroup[]
  questionAnswersByID: Map<string, NonNullable<UserThreadMessage["questionAnswer"]>>
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
  let assistantBlockBackendTurnID: string | null = null

  const readMessages = () => orderedMessages ?? messages
  const ensureOrderedMessages = () => {
    if (!orderedMessages) orderedMessages = [...messages]
    return orderedMessages
  }

  const flushAssistantBlock = (endIndex: number) => {
    if (assistantBlockStart < 0) return

    const startIndex = assistantBlockStart
    assistantBlockStart = -1
    assistantBlockBackendTurnID = null
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
      if (assistantBlockStart >= 0 && assistantBlockBackendTurnID !== message.backendTurnID) {
        flushAssistantBlock(index)
      }
      if (assistantBlockStart < 0) {
        assistantBlockStart = index
        assistantBlockBackendTurnID = message.backendTurnID
      }
      continue
    }

    flushAssistantBlock(index)
  }

  flushAssistantBlock(messages.length)
  return orderedMessages ?? messages
}

function collectQuestionAnswersByID(messages: ThreadMessage[]) {
  const questionAnswersByID = new Map<string, NonNullable<UserThreadMessage["questionAnswer"]>>()

  for (const message of messages) {
    if (message.kind !== "user") continue

    const questionAnswer = message.questionAnswer
    if (!questionAnswer?.questionID) continue
    questionAnswersByID.set(questionAnswer.questionID, questionAnswer)
  }

  return questionAnswersByID
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

function applyCanonicalFinalAssistantOwners(
  context: ThreadDisplayContext,
  rows: ThreadDisplayRow[],
  turns: ThreadTurn[] | null | undefined,
  groups: ThreadExecutionGroup[],
) {
  if (!turns) return { context, rows }

  const canonicalAssistantMessageIDs = new Set<string>()
  for (const turn of turns) {
    for (const message of turn.messages) {
      if (message.kind === "assistant") canonicalAssistantMessageIDs.add(message.id)
    }
  }
  for (const group of groups) {
    if (!group.canonical) continue
    group.assistantMessageIDs.forEach((messageID) => canonicalAssistantMessageIDs.add(messageID))
  }
  if (canonicalAssistantMessageIDs.size === 0) return { context, rows }

  const finalOperableAssistantMessageIDs = new Set(context.finalOperableAssistantMessageIDs)
  canonicalAssistantMessageIDs.forEach((messageID) => finalOperableAssistantMessageIDs.delete(messageID))
  groups.forEach((group) => {
    if (group.canonical && group.finalMessageID) {
      finalOperableAssistantMessageIDs.add(group.finalMessageID)
    }
  })

  let didChangeRows = false
  const nextRows = rows.map((row) => {
    if (!("isFinalOperableMessage" in row)) return row
    const isFinalOperableMessage = finalOperableAssistantMessageIDs.has(row.message.id)
    if (row.isFinalOperableMessage === isFinalOperableMessage) return row
    didChangeRows = true
    return { ...row, isFinalOperableMessage }
  })

  return {
    context: {
      ...context,
      finalOperableAssistantMessageIDs,
    },
    rows: didChangeRows ? nextRows : rows,
  }
}

function executionGroupReferenceSignature(group: ThreadExecutionGroup) {
  return [
    group.status,
    group.assistantMessageIDs.join(","),
    group.autoCollapseReady ? 1 : 0,
    group.canonical ? 1 : 0,
    group.durationMs ?? "",
    group.eligible ? 1 : 0,
    group.finalMessageID ?? "",
    group.finalSegmentID ?? "",
    group.hasInsertedUserBoundary ? 1 : 0,
    group.hasVisiblePrefix ? 1 : 0,
    group.messageID,
    group.messageIndex,
    group.summaryInsertBeforeRowID ?? "",
    group.prefixRowIDs.join(","),
    group.outcomeRowIDs.join(","),
  ].join("|")
}

function deriveExecutionGroupIDAliases(
  previousGroupIDByAssistantMessageID: ReadonlyMap<string, string>,
  groups: readonly ThreadExecutionGroup[],
) {
  const currentGroupByID = new Map(groups.map((group) => [group.groupID, group] as const))
  const currentGroupIDByAssistantMessageID = new Map<string, string>()
  groups.forEach((group) => {
    group.assistantMessageIDs.forEach((messageID) => {
      currentGroupIDByAssistantMessageID.set(messageID, group.groupID)
    })
  })

  const previousAssistantMessageIDsByGroupID = new Map<string, string[]>()
  previousGroupIDByAssistantMessageID.forEach((previousGroupID, messageID) => {
    const messageIDs = previousAssistantMessageIDsByGroupID.get(previousGroupID) ?? []
    messageIDs.push(messageID)
    previousAssistantMessageIDsByGroupID.set(previousGroupID, messageIDs)
  })

  const aliasesByGroupID = new Map<string, string[]>()
  previousAssistantMessageIDsByGroupID.forEach((messageIDs, previousGroupID) => {
    const destinationGroupIDs = new Set<string>()
    for (const messageID of messageIDs) {
      const destinationGroupID = currentGroupIDByAssistantMessageID.get(messageID)
      if (!destinationGroupID) return
      destinationGroupIDs.add(destinationGroupID)
    }
    if (destinationGroupIDs.size !== 1) return

    const destinationGroupID = [...destinationGroupIDs][0]!
    const destinationGroup = currentGroupByID.get(destinationGroupID)
    if (
      destinationGroupID === previousGroupID ||
      currentGroupByID.has(previousGroupID) ||
      !destinationGroup?.canonical ||
      !destinationGroupID.startsWith("turn:") ||
      destinationGroupID.startsWith("turn:pending:")
    ) {
      return
    }
    const aliases = aliasesByGroupID.get(destinationGroupID) ?? []
    aliases.push(previousGroupID)
    aliasesByGroupID.set(destinationGroupID, aliases)
  })
  return aliasesByGroupID
}

export function useThreadProjection({
  activeMessages,
  activeSession,
  activeTurns,
  assistantTraceVisibility,
  canForkFromMessage,
  isResolvingPermissionRequest,
  isSessionRunning,
  messageTree = null,
  pendingPermissionRequests,
  presentationScopeID,
  presentationStore,
}: ThreadProjectionInput): ThreadProjection {
  const threadDisplayRowsCacheRef = useRef<ThreadDisplayRowsCache | null>(null)
  const executionGroupEligibilityLocksRef = useRef<Map<string, ReadonlySet<string>>>(new Map())
  const executionGroupReferenceCacheRef = useRef<Map<
    string,
    Map<string, { group: ThreadExecutionGroup; signature: string }>
  >>(new Map())
  const executionGroupIDByAssistantMessageIDRef = useRef<Map<string, Map<string, string>>>(new Map())
  const presentationEntries = useSyncExternalStore(
    presentationStore.subscribe,
    () => presentationStore.getState().entries,
    () => presentationStore.getState().entries,
  )
  const committedAutoCollapseReadinessRef = useRef<{
    scopeID: string
    values: ReadonlyMap<string, boolean>
  }>({ scopeID: presentationScopeID, values: new Map() })
  const deferredAutoCollapseGroupIDsRef = useRef<{
    scopeID: string
    values: Set<string>
  }>({ scopeID: presentationScopeID, values: new Set() })
  const [autoCollapseRevision, setAutoCollapseRevision] = useState(0)
  const activeSessionID = activeSession?.id ?? null
  const pendingPermissionRequestID = pendingPermissionRequests[0]?.id ?? null
  const pendingPermissionRequestCount = pendingPermissionRequests.length
  const questionAnswersByID = useMemo(() => collectQuestionAnswersByID(activeMessages), [activeMessages])
  const answeredQuestionIDs = useMemo(() => new Set(questionAnswersByID.keys()), [questionAnswersByID])
  const displayMessages = useMemo(() => orderAdjacentAssistantMessagesForDisplay(activeMessages), [activeMessages])
  const hasCanonicalTurns = activeTurns !== undefined && activeTurns !== null

  const threadDisplayContext = useMemo(
    () => buildThreadDisplayContext(displayMessages, {
      disableAssistantRunFolding: hasCanonicalTurns,
    }),
    [displayMessages, hasCanonicalTurns],
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

  const executionGroupsResult = useMemo(() => {
    const eligibilityLocks = executionGroupEligibilityLocksRef.current.get(presentationScopeID) ?? new Set<string>()
    let result = deriveThreadExecutionGroups({
      answeredQuestionIDs,
      eligibilityLocks,
      messages: displayMessages,
      rows: baseDisplayRows,
      turns: activeTurns,
    })
    const previousGroupIDByAssistantMessageID =
      executionGroupIDByAssistantMessageIDRef.current.get(presentationScopeID) ?? new Map<string, string>()
    let groupIDAliases = deriveExecutionGroupIDAliases(previousGroupIDByAssistantMessageID, result.groups)
    const migratedEligibilityLocks = new Set(result.eligibilityLocks)
    let didMigrateEligibilityLock = false
    groupIDAliases.forEach((aliases, groupID) => {
      if (aliases.some((alias) => eligibilityLocks.has(alias)) && !migratedEligibilityLocks.has(groupID)) {
        migratedEligibilityLocks.add(groupID)
        didMigrateEligibilityLock = true
      }
    })
    if (didMigrateEligibilityLock) {
      result = deriveThreadExecutionGroups({
        answeredQuestionIDs,
        eligibilityLocks: migratedEligibilityLocks,
        messages: displayMessages,
        rows: baseDisplayRows,
        turns: activeTurns,
      })
      groupIDAliases = deriveExecutionGroupIDAliases(previousGroupIDByAssistantMessageID, result.groups)
    }
    executionGroupEligibilityLocksRef.current.set(presentationScopeID, result.eligibilityLocks)
    const scopeCache = executionGroupReferenceCacheRef.current.get(presentationScopeID) ?? new Map()
    const nextScopeCache = new Map<string, { group: ThreadExecutionGroup; signature: string }>()
    const groups = result.groups.map((group) => {
      const signature = executionGroupReferenceSignature(group)
      const cached = scopeCache.get(group.groupID)
      const stableGroup = cached?.signature === signature ? cached.group : group
      nextScopeCache.set(group.groupID, { group: stableGroup, signature })
      return stableGroup
    })
    executionGroupReferenceCacheRef.current.set(presentationScopeID, nextScopeCache)
    return { ...result, groupIDAliases, groups }
  }, [activeTurns, answeredQuestionIDs, baseDisplayRows, displayMessages, presentationScopeID])
  const executionGroups = executionGroupsResult.groups
  const executionGroupIDAliases = executionGroupsResult.groupIDAliases
  const canonicalFinalOwnerProjection = useMemo(
    () => applyCanonicalFinalAssistantOwners(
      threadDisplayContext,
      baseDisplayRows,
      activeTurns,
      executionGroups,
    ),
    [activeTurns, baseDisplayRows, executionGroups, threadDisplayContext],
  )
  const projectionBaseDisplayRows = canonicalFinalOwnerProjection.rows
  const projectionThreadDisplayContext = canonicalFinalOwnerProjection.context
  if (deferredAutoCollapseGroupIDsRef.current.scopeID !== presentationScopeID) {
    deferredAutoCollapseGroupIDsRef.current = {
      scopeID: presentationScopeID,
      values: new Set(),
    }
  }
  const previousAutoCollapseReadiness = committedAutoCollapseReadinessRef.current.scopeID === presentationScopeID
    ? committedAutoCollapseReadinessRef.current.values
    : new Map<string, boolean>()
  const deferredAutoCollapseGroupIDs = deferredAutoCollapseGroupIDsRef.current.values
  executionGroupIDAliases.forEach((aliases, groupID) => {
    let didMigrate = false
    aliases.forEach((alias) => {
      didMigrate = deferredAutoCollapseGroupIDs.delete(alias) || didMigrate
    })
    if (didMigrate) deferredAutoCollapseGroupIDs.add(groupID)
  })
  const preferenceForGroup = (groupID: string) => {
    const groupIDs = [groupID, ...(executionGroupIDAliases.get(groupID) ?? [])]
    let preference = "auto" as ReturnType<typeof selectProcessDisclosurePreference>
    for (const candidateGroupID of groupIDs) {
      const candidatePreference = selectProcessDisclosurePreference(
        { entries: presentationEntries },
        presentationScopeID,
        candidateGroupID,
      )
      if (candidatePreference === "expanded") return "expanded"
      if (candidatePreference === "collapsed") preference = "collapsed"
    }
    return preference
  }
  const previousAutoCollapseReadinessForGroup = (groupID: string) => {
    const groupIDs = [groupID, ...(executionGroupIDAliases.get(groupID) ?? [])]
    const values = groupIDs.flatMap((candidateGroupID) => {
      const value = previousAutoCollapseReadiness.get(candidateGroupID)
      return value === undefined ? [] : [value]
    })
    if (values.includes(false)) return false
    return values.includes(true) ? true : undefined
  }
  executionGroups.forEach((group) => {
    if (
      group.eligible &&
      group.hasVisiblePrefix &&
      group.autoCollapseReady &&
      previousAutoCollapseReadinessForGroup(group.groupID) === false &&
      preferenceForGroup(group.groupID) === "auto"
    ) {
      deferredAutoCollapseGroupIDs.add(group.groupID)
    }
  })
  const pendingAutoCollapseGroups = executionGroups.filter((group) =>
    deferredAutoCollapseGroupIDs.has(group.groupID),
  )
  const commitPendingAutoCollapse = useCallback((groupIDs: readonly string[]) => {
    let didChange = false
    for (const groupID of groupIDs) {
      didChange = deferredAutoCollapseGroupIDsRef.current.values.delete(groupID) || didChange
    }
    if (didChange) setAutoCollapseRevision((revision) => revision + 1)
  }, [])

  useLayoutEffect(() => {
    const groupIDByAssistantMessageID = new Map<string, string>()
    executionGroups.forEach((group) => {
      group.assistantMessageIDs.forEach((messageID: string) => {
        groupIDByAssistantMessageID.set(messageID, group.groupID)
      })
    })
    executionGroupIDByAssistantMessageIDRef.current.set(presentationScopeID, groupIDByAssistantMessageID)
    executionGroupIDAliases.forEach((aliases, groupID) => {
      aliases.forEach((alias) => {
        presentationStore.getState().migrateProcessDisclosurePreference(presentationScopeID, alias, groupID)
      })
    })
    committedAutoCollapseReadinessRef.current = {
      scopeID: presentationScopeID,
      values: new Map(executionGroups.map((group) => [group.groupID, group.autoCollapseReady])),
    }
  }, [executionGroupIDAliases, executionGroups, presentationScopeID, presentationStore])

  const displayRowsResult = useMemo(
    () => {
      const previousCache = mergeThreadDisplayRowsCachesForDecoration(
        baseDisplayRowsResult.cache,
        threadDisplayRowsCacheRef.current,
      )

      return decorateThreadDisplayRowsIncremental(
        {
          assistantTraceVisibility,
          baseRows: projectionBaseDisplayRows,
          canForkFromMessage,
          context: projectionThreadDisplayContext,
          hasPendingPermissionRequests: pendingPermissionRequestCount > 0,
          isSessionRunning,
          messageTree,
        },
        previousCache,
      )
    },
    [
      activeSessionID,
      assistantTraceVisibility,
      projectionBaseDisplayRows,
      baseDisplayRowsResult.cache,
      canForkFromMessage,
      isSessionRunning,
      messageTree,
      pendingPermissionRequestCount,
      projectionThreadDisplayContext,
    ],
  )
  const displayRows = useMemo(() => projectThreadDisplayRowsWithExecutionGroups({
    groups: executionGroups,
    resolveExpanded: (group) => deferredAutoCollapseGroupIDs.has(group.groupID) || resolveExecutionGroupExpanded(
      group,
      preferenceForGroup(group.groupID),
    ),
    rows: displayRowsResult.rows,
  }), [autoCollapseRevision, displayRowsResult.rows, executionGroups, presentationEntries, presentationScopeID])

  useEffect(() => {
    threadDisplayRowsCacheRef.current = activeSessionID ? displayRowsResult.cache : null
  }, [activeSessionID, displayRowsResult.cache])

  return {
    baseDisplayRows: projectionBaseDisplayRows,
    commitPendingAutoCollapse,
    displayMessages,
    displayRows,
    executionGroups,
    pendingAutoCollapseGroups,
    questionAnswersByID,
    threadDisplayContext: projectionThreadDisplayContext,
  }
}
