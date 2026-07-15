import type {
  AssistantTraceItem,
  AssistantThreadMessage,
  ThreadMessage,
  ThreadTurn,
  ThreadTurnStatus,
} from "../types"
import type { ThreadDisplayRow } from "./thread-display-rows"
import {
  findLastNonemptyAssistantResponseBlock,
} from "./thread-final-response"

export const EXECUTION_GROUP_MIN_ROW_COUNT = 2
export const EXECUTION_GROUP_MIN_ESTIMATED_HEIGHT = 180
export const EXECUTION_GROUP_MIN_TEXT_LENGTH = 160
export const EXECUTION_GROUP_MIN_NONEMPTY_LINE_COUNT = 3
export const EXECUTION_SUMMARY_ESTIMATED_HEIGHT = 42

export type ProcessDisclosurePreference = "auto" | "expanded" | "collapsed"

type AtomicAssistantDisplayRow = Extract<ThreadDisplayRow, { sourceMessageID: string }>

type ThreadTurnWithFinalMetadata = ThreadTurn & {
  finalSegmentID?: string
  lastMessageID?: string
}

interface ExecutionGroupCandidate {
  assistantMessages: AssistantThreadMessage[]
  canonical: boolean
  durationMs?: number
  groupID: string
  hasUserBoundary: boolean
  status: ThreadTurnStatus
  summaryRowID: string
  turnID: string
  turn?: ThreadTurnWithFinalMetadata
}

export interface ThreadExecutionGroup {
  assistantMessageIDs: string[]
  autoCollapseReady: boolean
  canonical: boolean
  durationMs?: number
  eligible: boolean
  finalMessageID?: string
  finalSegmentID?: string
  groupID: string
  hasInsertedUserBoundary: boolean
  hasVisiblePrefix: boolean
  messageID: string
  messageIndex: number
  outcomeRowIDs: string[]
  prefixRowIDs: string[]
  status: ThreadTurnStatus
  summaryInsertBeforeRowID?: string
  summaryRowID: string
  turnID: string
}

export interface AssistantExecutionSummaryRow {
  durationMs?: number
  eligible: boolean
  estimatedHeight: number
  expanded: boolean
  groupID: string
  hiddenRowCount: number
  kind: "assistant-execution-summary"
  messageID: string
  messageIndex: number
  rowID: string
  status: ThreadTurnStatus
  turnID: string
}

export type ExecutionProjectedThreadDisplayRow = ThreadDisplayRow

export interface DeriveThreadExecutionGroupsInput {
  eligibilityLocks?: ReadonlySet<string>
  messages: ThreadMessage[]
  rows: ThreadDisplayRow[]
  turns?: ThreadTurn[] | null
}

export interface DeriveThreadExecutionGroupsResult {
  eligibilityLocks: ReadonlySet<string>
  groupByRowID: ReadonlyMap<string, ThreadExecutionGroup>
  groups: ThreadExecutionGroup[]
}

export interface ProjectThreadDisplayRowsWithExecutionGroupsInput {
  expandedByGroupID?: ReadonlyMap<string, boolean> | Readonly<Record<string, boolean>>
  groups: ThreadExecutionGroup[]
  resolveExpanded?: (group: ThreadExecutionGroup) => boolean
  rows: ThreadDisplayRow[]
}

const SUMMARY_ROWS_BY_GROUP = new WeakMap<
  ThreadExecutionGroup,
  { collapsed?: AssistantExecutionSummaryRow; expanded?: AssistantExecutionSummaryRow }
>()

function isAtomicAssistantDisplayRow(row: ThreadDisplayRow): row is AtomicAssistantDisplayRow {
  return "sourceMessageID" in row && typeof row.sourceMessageID === "string"
}

function isTerminalTurnStatus(status: ThreadTurnStatus) {
  return status !== "running"
}

function statusForLegacyMessage(message: AssistantThreadMessage): ThreadTurnStatus {
  switch (message.runtime.phase) {
    case "completed":
      return "completed"
    case "failed":
      return "failed"
    case "cancelled":
      return "cancelled"
    case "blocked":
      return "blocked"
    case "continued_by_user":
      return "continued_by_user"
    default:
      return "running"
  }
}

function finiteDuration(startedAt: number, endedAt: number | undefined) {
  if (!Number.isFinite(startedAt) || endedAt === undefined || !Number.isFinite(endedAt) || endedAt < startedAt) {
    return undefined
  }
  return endedAt - startedAt
}

function durationForTurn(turn: ThreadTurn) {
  const endedAt = isTerminalTurnStatus(turn.status)
    ? turn.completedAt ?? turn.updatedAt
    : turn.updatedAt
  return finiteDuration(turn.startedAt, endedAt)
}

function durationForLegacyMessage(message: AssistantThreadMessage) {
  return finiteDuration(message.runtime.startedAt, message.runtime.updatedAt) ?? durationFromAssistantTrace([message])
}

function durationFromAssistantTrace(messages: AssistantThreadMessage[]) {
  const timestamps = messages.flatMap((message) => [
    message.runtime.startedAt,
    message.runtime.updatedAt,
    message.timestamp,
    ...message.items.map((item) => item.timestamp),
  ]).filter((timestamp): timestamp is number => Number.isFinite(timestamp))
  if (timestamps.length < 2) return undefined
  return finiteDuration(Math.min(...timestamps), Math.max(...timestamps))
}

function messageMatchesLastMessageID(message: AssistantThreadMessage, lastMessageID: string) {
  return message.id === lastMessageID || message.messageID === lastMessageID
}

function findLastAssistantMessage(
  messages: AssistantThreadMessage[],
  predicate: (message: AssistantThreadMessage) => boolean,
) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!
    if (predicate(message)) return message
  }
  return null
}

function resolveFinalMessage(candidate: ExecutionGroupCandidate) {
  const { assistantMessages, turn } = candidate
  const finalSegmentID = turn?.finalSegmentID
  if (finalSegmentID) {
    const message = findLastAssistantMessage(assistantMessages, (value) => value.segmentID === finalSegmentID)
    return {
      authoritativeMetadataPending: !message,
      message: message ?? null,
      responseBlock: message ? findLastNonemptyAssistantResponseBlock(message.items) : null,
    }
  }

  const lastMessageID = turn?.lastMessageID
  if (lastMessageID) {
    const message = findLastAssistantMessage(
      assistantMessages,
      (value) => messageMatchesLastMessageID(value, lastMessageID),
    )
    return {
      authoritativeMetadataPending: !message,
      message: message ?? null,
      responseBlock: message ? findLastNonemptyAssistantResponseBlock(message.items) : null,
    }
  }

  for (let index = assistantMessages.length - 1; index >= 0; index -= 1) {
    const message = assistantMessages[index]!
    const responseBlock = findLastNonemptyAssistantResponseBlock(message.items)
    if (responseBlock) {
      return {
        authoritativeMetadataPending: false,
        message,
        responseBlock,
      }
    }
  }

  return {
    authoritativeMetadataPending: false,
    message: assistantMessages.at(-1) ?? null,
    responseBlock: null,
  }
}

function isUnresolvedPromptRow(row: AtomicAssistantDisplayRow) {
  if (row.kind === "assistant-question-row") {
    const prompt = row.item.questionPrompt
    if (prompt) return prompt.answered !== true
    return row.item.status === "pending" || row.item.status === "waiting-approval"
  }
  if (row.kind === "assistant-approval-row") {
    return row.item.status === "pending" || row.item.status === "waiting-approval"
  }
  return false
}

function isFailureOutcomeRow(row: AtomicAssistantDisplayRow) {
  return traceItemsForRow(row).some((item) =>
    item.kind === "error" ||
    item.status === "error" ||
    item.status === "cancelled" ||
    item.status === "denied",
  )
}

function isTerminalizedTraceOutcomeRow(
  row: AtomicAssistantDisplayRow,
  status: ThreadTurnStatus,
) {
  if (status === "completed" || status === "running" || status === "continued_by_user") return false
  if (
    row.kind !== "assistant-tool-row" &&
    row.kind !== "assistant-workflow-row" &&
    row.kind !== "assistant-file-change-row"
  ) {
    return false
  }

  return traceItemsForRow(row).some((item) =>
    item.status === undefined || item.status === "pending" || item.status === "running",
  )
}

function isAlwaysOutcomeRow(row: AtomicAssistantDisplayRow) {
  return row.kind === "assistant-actions" ||
    row.kind === "assistant-diff-card" ||
    isUnresolvedPromptRow(row)
}

function textPartsForTraceItem(item: AssistantTraceItem) {
  const debugText = item.debugEntries?.flatMap((entry) => [entry.label, entry.value]) ?? []
  const progressText = item.progressItems?.flatMap((entry) => [entry.step, entry.status]) ?? []
  const fileChangeText = item.fileChanges?.flatMap((change) => [change.file, change.fromFile, change.patch]) ?? []
  const draftPatchText = item.draftPatch
    ? [
        item.draftPatch.title,
        item.draftPatch.detail,
        ...(Array.isArray(item.draftPatch.filePaths) ? item.draftPatch.filePaths : []),
        ...(Array.isArray(item.draftPatch.fileChanges)
          ? item.draftPatch.fileChanges.flatMap((change) => [change.file, change.fromFile, change.patch])
          : []),
      ]
    : []

  return [
    item.title,
    item.text,
    item.detail,
    item.toolInputText,
    item.toolOutputText,
    item.src,
    ...debugText,
    ...progressText,
    ...fileChangeText,
    ...draftPatchText,
  ].filter((value): value is string => typeof value === "string" && value.length > 0)
}

function traceItemsForRow(row: AtomicAssistantDisplayRow) {
  if (row.kind === "assistant-file-change-row") return row.items.map((entry) => entry.item)
  if ("item" in row) return [row.item]
  return []
}

function textForRow(row: AtomicAssistantDisplayRow) {
  if (row.kind === "assistant-ephemeral-state") return row.ephemeralHint
  return traceItemsForRow(row).flatMap(textPartsForTraceItem).join("\n")
}

function hasHeavyPayload(row: AtomicAssistantDisplayRow) {
  const items = traceItemsForRow(row)
  if (row.kind === "assistant-file-change-row") {
    return items.some((item) =>
      item.kind === "image" ||
      Boolean(item.src?.trim()) ||
      Boolean(item.draftPatch) ||
      Boolean(item.fileChanges?.some((change) => Boolean(change.patch?.trim()) || Boolean(change.file))),
    )
  }
  if (row.kind === "assistant-tool-row") {
    return items.some((item) => Boolean(item.toolInputText?.trim()) || Boolean(item.toolOutputText?.trim()))
  }
  if (row.kind === "assistant-debug-row") {
    return items.some((item) => Boolean(item.detail?.trim()) || Boolean(item.debugEntries?.length))
  }
  if (row.kind === "assistant-workflow-row") {
    return items.some((item) =>
      Boolean(item.detail?.trim()) ||
      Boolean(item.progressItems?.length) ||
      Boolean(item.draftPatch) ||
      Boolean(item.toolInputText?.trim()) ||
      Boolean(item.toolOutputText?.trim()),
    )
  }
  return false
}

function processPrefixMeetsThreshold(rows: AtomicAssistantDisplayRow[]) {
  if (rows.length >= EXECUTION_GROUP_MIN_ROW_COUNT) return true
  if (rows.reduce((total, row) => total + row.estimatedHeight, 0) >= EXECUTION_GROUP_MIN_ESTIMATED_HEIGHT) {
    return true
  }

  const normalizedText = rows
    .map(textForRow)
    .join("\n")
    .replace(/\s+/g, " ")
    .trim()
  if (normalizedText.length > EXECUTION_GROUP_MIN_TEXT_LENGTH) return true

  const nonemptyLineCount = rows
    .flatMap((row) => textForRow(row).split(/\r?\n/))
    .filter((line) => Boolean(line.trim()))
    .length
  if (nonemptyLineCount > EXECUTION_GROUP_MIN_NONEMPTY_LINE_COUNT) return true

  return rows.some(hasHeavyPayload)
}

function normalizedAssistantMessages(
  values: ThreadMessage[],
  activeMessageByID: ReadonlyMap<string, ThreadMessage>,
) {
  return values
    .filter((message): message is AssistantThreadMessage => message.kind === "assistant")
    .map((message) => {
      const activeMessage = activeMessageByID.get(message.id)
      return activeMessage?.kind === "assistant" ? activeMessage : message
    })
}

function createExecutionGroupCandidates(
  messages: ThreadMessage[],
  turns: ThreadTurn[] | null | undefined,
) {
  const activeMessageByID = new Map(messages.map((message) => [message.id, message] as const))
  const activeMessageIndexByID = new Map(messages.map((message, index) => [message.id, index] as const))
  const claimedAssistantMessageIDs = new Set<string>()
  const candidates: ExecutionGroupCandidate[] = []

  const hasUserBoundaryBetweenAssistants = (
    orderedMessages: ThreadMessage[],
    assistantMessageIDs: ReadonlySet<string>,
  ) => {
    const assistantIndexes = orderedMessages.flatMap((message, index) => (
      message.kind === "assistant" && assistantMessageIDs.has(message.id) ? [index] : []
    ))
    if (assistantIndexes.length < 2) return false
    const firstIndex = assistantIndexes[0]!
    const lastIndex = assistantIndexes[assistantIndexes.length - 1]!
    return orderedMessages.slice(firstIndex + 1, lastIndex).some((message) => message.kind === "user")
  }

  turns?.forEach((plainTurn) => {
    const turn = plainTurn as ThreadTurnWithFinalMetadata
    const assistantMessages = normalizedAssistantMessages(turn.messages, activeMessageByID)
    const canonicalAssistantMessageIDs = new Set(assistantMessages.map((message) => message.id))
    for (const message of messages) {
      if (
        message.kind !== "assistant" ||
        message.backendTurnID !== turn.turnID ||
        canonicalAssistantMessageIDs.has(message.id)
      ) {
        continue
      }
      canonicalAssistantMessageIDs.add(message.id)
      assistantMessages.push(message)
    }
    assistantMessages.sort((left, right) => {
      const leftIndex = activeMessageIndexByID.get(left.id)
      const rightIndex = activeMessageIndexByID.get(right.id)
      if (leftIndex === undefined) return rightIndex === undefined ? 0 : 1
      if (rightIndex === undefined) return -1
      return leftIndex - rightIndex
    })
    const uniqueAssistantMessages = assistantMessages
      .filter((message) => {
        if (claimedAssistantMessageIDs.has(message.id)) return false
        claimedAssistantMessageIDs.add(message.id)
        return true
      })
    if (uniqueAssistantMessages.length === 0) return
    const uniqueAssistantMessageIDs = new Set(uniqueAssistantMessages.map((message) => message.id))

    candidates.push({
      assistantMessages: uniqueAssistantMessages,
      canonical: true,
      durationMs: turn.status === "running"
        ? undefined
        : durationForTurn(turn) ?? durationFromAssistantTrace(uniqueAssistantMessages),
      groupID: `turn:${turn.turnID}`,
      hasUserBoundary:
        hasUserBoundaryBetweenAssistants(messages, uniqueAssistantMessageIDs) ||
        hasUserBoundaryBetweenAssistants(turn.messages, uniqueAssistantMessageIDs),
      status: turn.status,
      summaryRowID: `turn:${turn.turnID}:execution-summary`,
      turn,
      turnID: turn.turnID,
    })
  })

  messages.forEach((message) => {
    if (message.kind !== "assistant" || claimedAssistantMessageIDs.has(message.id)) return
    candidates.push({
      assistantMessages: [message],
      canonical: false,
      durationMs: statusForLegacyMessage(message) === "running"
        ? undefined
        : durationForLegacyMessage(message),
      groupID: `legacy:${message.backendTurnID}:${message.id}`,
      hasUserBoundary: false,
      status: statusForLegacyMessage(message),
      summaryRowID: `legacy:${message.backendTurnID}:${message.id}:execution-summary`,
      turnID: message.backendTurnID,
    })
  })

  return candidates.sort((left, right) => {
    const leftIndex = Math.min(...left.assistantMessages.map((message) => activeMessageIndexByID.get(message.id) ?? Number.MAX_SAFE_INTEGER))
    const rightIndex = Math.min(...right.assistantMessages.map((message) => activeMessageIndexByID.get(message.id) ?? Number.MAX_SAFE_INTEGER))
    return leftIndex - rightIndex
  })
}

function rawItemIndexForRow(row: AtomicAssistantDisplayRow) {
  if (typeof row.rawItemIndex === "number") return row.rawItemIndex
  if (row.kind === "assistant-file-change-row") return row.items[0]?.rawItemIndex
  return undefined
}

function deriveGroup(
  candidate: ExecutionGroupCandidate,
  rows: ThreadDisplayRow[],
  messageIndexByID: ReadonlyMap<string, number>,
  eligibilityLocks: ReadonlySet<string>,
) {
  const assistantMessageIDSet = new Set(candidate.assistantMessages.map((message) => message.id))
  const assistantMessageOrdinalByID = new Map(candidate.assistantMessages.map((message, index) => [message.id, index] as const))
  const groupRows = rows.filter((row): row is AtomicAssistantDisplayRow =>
    isAtomicAssistantDisplayRow(row) && assistantMessageIDSet.has(row.sourceMessageID),
  )
  const finalResolution = resolveFinalMessage(candidate)
  const finalMessage = finalResolution.message
  const finalMessageOrdinal = finalMessage ? assistantMessageOrdinalByID.get(finalMessage.id) : undefined
  const responseStartRawItemIndex = finalResolution.responseBlock?.startRawItemIndex
  const protectedRowIDs = new Set(
    groupRows.filter(isAlwaysOutcomeRow).map((row) => row.rowID),
  )
  const lastFailureRow = [...groupRows].reverse().find((row) =>
    isFailureOutcomeRow(row) || isTerminalizedTraceOutcomeRow(row, candidate.status),
  )
  if (lastFailureRow) protectedRowIDs.add(lastFailureRow.rowID)

  const isAtOrAfterFinalResponse = (row: AtomicAssistantDisplayRow) => {
    if (finalMessageOrdinal === undefined || responseStartRawItemIndex === undefined) return false
    const sourceOrdinal = assistantMessageOrdinalByID.get(row.sourceMessageID)
    if (sourceOrdinal === undefined) return false
    if (sourceOrdinal > finalMessageOrdinal) return true
    if (sourceOrdinal < finalMessageOrdinal) return false
    const rawItemIndex = rawItemIndexForRow(row)
    return rawItemIndex !== undefined && rawItemIndex >= responseStartRawItemIndex
  }

  const prefixRows = groupRows.filter((row) =>
    !protectedRowIDs.has(row.rowID) && !isAtOrAfterFinalResponse(row),
  )
  const prefixRowIDSet = new Set(prefixRows.map((row) => row.rowID))
  const outcomeRows = groupRows.filter((row) => !prefixRowIDSet.has(row.rowID))
  const hasInsertedUserBoundary = candidate.hasUserBoundary ||
    prefixRows.some((row) => row.kind === "assistant-inserted-user-message")
  const thresholdReached = !hasInsertedUserBoundary && processPrefixMeetsThreshold(prefixRows)
  const eligible = !hasInsertedUserBoundary &&
    (eligibilityLocks.has(candidate.groupID) || thresholdReached)
  const ownerMessage = finalMessage ?? candidate.assistantMessages.at(-1)!
  const firstGroupRow = groupRows[0]
  const messageIndex = messageIndexByID.get(ownerMessage.id) ?? firstGroupRow?.messageIndex ?? 0
  const abnormalTerminalStatus = isTerminalTurnStatus(candidate.status) && candidate.status !== "completed"
  const autoCollapseReady = isTerminalTurnStatus(candidate.status) && (
    abnormalTerminalStatus ||
    (!finalResolution.authoritativeMetadataPending && Boolean(finalResolution.responseBlock))
  )

  return {
    assistantMessageIDs: candidate.assistantMessages.map((message) => message.id),
    autoCollapseReady,
    canonical: candidate.canonical,
    durationMs: candidate.durationMs,
    eligible,
    finalMessageID: finalMessage?.id,
    finalSegmentID: finalMessage?.segmentID,
    groupID: candidate.groupID,
    hasInsertedUserBoundary,
    hasVisiblePrefix: prefixRows.length > 0,
    messageID: ownerMessage.id,
    messageIndex,
    outcomeRowIDs: outcomeRows.map((row) => row.rowID),
    prefixRowIDs: prefixRows.map((row) => row.rowID),
    status: candidate.status,
    summaryInsertBeforeRowID: prefixRows[0]?.rowID,
    summaryRowID: candidate.summaryRowID,
    thresholdReached,
    turnID: candidate.turnID,
  }
}

export function deriveThreadExecutionGroups({
  eligibilityLocks = new Set(),
  messages,
  rows,
  turns,
}: DeriveThreadExecutionGroupsInput): DeriveThreadExecutionGroupsResult {
  const messageIndexByID = new Map(messages.map((message, index) => [message.id, index] as const))
  const nextEligibilityLocks = new Set(eligibilityLocks)
  const groups = createExecutionGroupCandidates(messages, turns).map((candidate) => {
    const group = deriveGroup(candidate, rows, messageIndexByID, eligibilityLocks)
    if (group.thresholdReached && !group.hasInsertedUserBoundary) nextEligibilityLocks.add(group.groupID)
    const { thresholdReached: _thresholdReached, ...publicGroup } = group
    return publicGroup
  })
  const groupByRowID = new Map<string, ThreadExecutionGroup>()
  groups.forEach((group) => {
    group.prefixRowIDs.forEach((rowID) => groupByRowID.set(rowID, group))
    group.outcomeRowIDs.forEach((rowID) => groupByRowID.set(rowID, group))
  })

  return {
    eligibilityLocks: nextEligibilityLocks,
    groupByRowID,
    groups,
  }
}

export function resolveExecutionGroupExpanded(
  group: ThreadExecutionGroup,
  preference: ProcessDisclosurePreference = "auto",
) {
  if (preference === "expanded") return true
  if (preference === "collapsed") return false
  return !group.autoCollapseReady
}

export function createAssistantExecutionSummaryRow(
  group: ThreadExecutionGroup,
  expanded: boolean,
): AssistantExecutionSummaryRow {
  const cachedRows = SUMMARY_ROWS_BY_GROUP.get(group) ?? {}
  const cacheKey = expanded ? "expanded" : "collapsed"
  const cachedRow = cachedRows[cacheKey]
  if (cachedRow) return cachedRow

  const row: AssistantExecutionSummaryRow = {
    durationMs: group.durationMs,
    eligible: group.eligible,
    estimatedHeight: EXECUTION_SUMMARY_ESTIMATED_HEIGHT,
    expanded,
    groupID: group.groupID,
    hiddenRowCount: expanded ? 0 : group.prefixRowIDs.length,
    kind: "assistant-execution-summary",
    messageID: group.messageID,
    messageIndex: group.messageIndex,
    rowID: group.summaryRowID,
    status: group.status,
    turnID: group.turnID,
  }
  cachedRows[cacheKey] = row
  SUMMARY_ROWS_BY_GROUP.set(group, cachedRows)
  return row
}

function expandedFromInput(
  input: ProjectThreadDisplayRowsWithExecutionGroupsInput,
  group: ThreadExecutionGroup,
) {
  if (input.resolveExpanded) return input.resolveExpanded(group)
  const values = input.expandedByGroupID
  if (values && "get" in values && typeof values.get === "function") {
    return values.get(group.groupID) ?? resolveExecutionGroupExpanded(group)
  }
  if (values) {
    return (values as Readonly<Record<string, boolean>>)[group.groupID] ?? resolveExecutionGroupExpanded(group)
  }
  return resolveExecutionGroupExpanded(group)
}

export function projectThreadDisplayRowsWithExecutionGroups(
  input: ProjectThreadDisplayRowsWithExecutionGroupsInput,
): ExecutionProjectedThreadDisplayRow[] {
  const visibleGroups = input.groups.filter((group) =>
    group.eligible && group.hasVisiblePrefix && Boolean(group.summaryInsertBeforeRowID),
  )
  if (visibleGroups.length === 0) return input.rows

  const prefixGroupByRowID = new Map<string, ThreadExecutionGroup>()
  const prefixGroupByIntermediateOwnerMessageID = new Map<string, ThreadExecutionGroup>()
  const rowByID = new Map(input.rows.map((row) => [row.rowID, row] as const))
  visibleGroups.forEach((group) => {
    group.prefixRowIDs.forEach((rowID) => {
      prefixGroupByRowID.set(rowID, group)
      const row = rowByID.get(rowID)
      if (
        !row ||
        !("ownerMessageID" in row) ||
        row.ownerMessageID === group.finalMessageID
      ) {
        return
      }
      prefixGroupByIntermediateOwnerMessageID.set(row.ownerMessageID, group)
    })
  })
  const insertedSummaryGroupIDs = new Set<string>()
  const projectedRows: ExecutionProjectedThreadDisplayRow[] = []

  input.rows.forEach((row) => {
    const group = prefixGroupByRowID.get(row.rowID)
    if (!group) {
      if (row.kind === "assistant-diff-card") {
        const ownerGroup = prefixGroupByIntermediateOwnerMessageID.get(row.ownerMessageID)
        if (ownerGroup && !expandedFromInput(input, ownerGroup)) return
      }
      projectedRows.push(row)
      return
    }

    const expanded = expandedFromInput(input, group)
    if (!insertedSummaryGroupIDs.has(group.groupID)) {
      insertedSummaryGroupIDs.add(group.groupID)
      projectedRows.push(createAssistantExecutionSummaryRow(group, expanded))
    }
    if (expanded) {
      if (
        group.status !== "running" &&
        row.kind === "assistant-reasoning-row" &&
        !row.suppressReasoningMessageCompletionCollapse
      ) {
        projectedRows.push({
          ...row,
          suppressReasoningMessageCompletionCollapse: true,
        })
      } else {
        projectedRows.push(row)
      }
    }
  })

  return projectedRows
}
