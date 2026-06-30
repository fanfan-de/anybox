import {
  COMPOSER_LONG_TEXT_CHARACTER_THRESHOLD,
  COMPOSER_LONG_TEXT_LINE_THRESHOLD,
} from "../composer/draft-state"
import { getSessionMessageIDForMessage, type SessionMessageBranchOption, type SessionMessageTree } from "../session-message-tree"
import {
  getAssistantStreamInsertionUserMessages,
  hasStreamInsertionTarget,
  isPendingSteerUserMessage,
  resolveStreamInsertionItemIndex,
} from "../stream-insertion"
import { parseAssistantResponseFormat } from "../thread-response-format"
import type {
  AssistantTraceFileChange,
  AssistantTraceItem,
  AssistantTraceSectionKey,
  AssistantTraceVisibility,
  AssistantTraceVisibilityKey,
  AssistantThreadMessage,
  AssistantThreadMessagePhase,
  PermissionRequest,
  SessionDiffSummary,
  SessionSummary,
  ThreadMessage,
  UserThreadMessage,
} from "../types"

const COLLAPSED_USER_MESSAGE_ESTIMATED_CHARACTERS = 640

export type ThreadDisplayRowKind =
  | "user-message"
  | "permission-request"
  | "assistant-response-row"
  | "assistant-reasoning-row"
  | "assistant-tool-row"
  | "assistant-question-row"
  | "assistant-file-change-row"
  | "assistant-workflow-row"
  | "assistant-debug-row"
  | "assistant-source-row"
  | "assistant-approval-row"
  | "assistant-diff-card"
  | "assistant-actions"
  | "assistant-ephemeral-state"
  | "assistant-inserted-user-message"

export type AssistantTraceItemRowKind =
  | "assistant-response-row"
  | "assistant-reasoning-row"
  | "assistant-tool-row"
  | "assistant-question-row"
  | "assistant-workflow-row"
  | "assistant-debug-row"
  | "assistant-source-row"
  | "assistant-approval-row"

export interface AssistantTraceRowItem {
  item: AssistantTraceItem
  itemID: string
  rawItemIndex: number
  section: AssistantTraceSectionKey
  sourceMessage: AssistantThreadMessage
  sourceMessageID: string
  sourceMessageIndex: number
}

interface BaseThreadDisplayRow {
  estimatedHeight: number
  kind: ThreadDisplayRowKind
  messageID: string
  messageIndex: number
  rowID: string
}

export interface UserMessageRow extends BaseThreadDisplayRow {
  kind: "user-message"
  message: UserThreadMessage
}

export interface PermissionRequestRow extends BaseThreadDisplayRow {
  kind: "permission-request"
  requestID: string
}

interface AssistantDisplayRowBase extends BaseThreadDisplayRow {
  isFinalOperableMessage: boolean
  isLatestMessage: boolean
  message: AssistantThreadMessage
  motionKey: string
  ownerMessageID: string
  ownerMessageIndex: number
  rawItemIndex?: number
  section: AssistantTraceSectionKey
  sourceMessage: AssistantThreadMessage
  sourceMessageID: string
  sourceMessageIndex: number
  visualGroupID: string
}

export interface AssistantTraceItemRow extends AssistantDisplayRowBase {
  item: AssistantTraceItem
  itemID: string
  kind: AssistantTraceItemRowKind
  shouldCollapseTraceItemAfterMessageCompletion: boolean
  traceItem: AssistantTraceRowItem
}

export interface AssistantFileChangeRow extends AssistantDisplayRowBase {
  itemID?: string
  items: AssistantTraceRowItem[]
  kind: "assistant-file-change-row"
  shouldCollapseTraceItemAfterMessageCompletion: boolean
  summaryKey: string
}

export interface AssistantEphemeralStateRow extends AssistantDisplayRowBase {
  ephemeralHint: string
  kind: "assistant-ephemeral-state"
}

export interface AssistantInsertedUserMessageRow extends AssistantDisplayRowBase {
  insertedMessage: UserThreadMessage
  kind: "assistant-inserted-user-message"
}

export interface AssistantDiffCardRow extends AssistantDisplayRowBase {
  allowWorkspaceDiffFallback: boolean
  diffMessage: AssistantThreadMessage | UserThreadMessage
  diffMessageID: string
  diffSummary?: SessionDiffSummary
  kind: "assistant-diff-card"
  patchSourceMessage: AssistantThreadMessage
}

export interface AssistantActionsRow extends AssistantDisplayRowBase {
  branchOptions: SessionMessageBranchOption[]
  canForkFromMessage: boolean
  canOpenSideChat: boolean
  existingSideChatCount: number
  kind: "assistant-actions"
  marksSideChatButtonActive: boolean
  responseCopyText: string
  responseItems: AssistantTraceItem[]
  sideChatAnchorMessageID: string
  sideChatButtonLabel: string
  sideChatButtonTitle: string
  threadMessageID: string
}

export type AssistantDisplayRow =
  | AssistantTraceItemRow
  | AssistantFileChangeRow
  | AssistantDiffCardRow
  | AssistantActionsRow
  | AssistantEphemeralStateRow
  | AssistantInsertedUserMessageRow

export type ThreadDisplayRow =
  | UserMessageRow
  | PermissionRequestRow
  | AssistantDisplayRow

export interface ThreadDisplayContext {
  finalOperableAssistantMessageIDs: Set<string>
  foldedAssistantMessageIDs: Set<string>
  latestRenderableAssistantMessageID: string | null
  messageIndexByID: Map<string, number>
  messages: ThreadMessage[]
  sideChatAnchorMessageIDByAssistantID: Map<string, string>
  streamInsertedUserMessagesByAssistantID: Map<string, UserThreadMessage[]>
}

export interface BuildThreadDisplayRowsInput {
  activeSession?: SessionSummary | null
  activeSessionID?: string | null
  activeMessages: ThreadMessage[]
  assistantTraceVisibility: AssistantTraceVisibility
  context?: ThreadDisplayContext
  isResolvingPermissionRequest: boolean
  pendingPermissionRequests: PermissionRequest[]
}

export interface DecorateThreadDisplayRowsInput {
  assistantTraceVisibility: AssistantTraceVisibility
  baseRows: ThreadDisplayRow[]
  canForkFromMessage: boolean
  canOpenSideChat: boolean
  context: ThreadDisplayContext
  hasPendingPermissionRequests: boolean
  isSessionRunning: boolean
  messageTree?: SessionMessageTree | null
  readOnlySideChat: boolean
  sideChatCountsByAnchorMessageID: Record<string, number>
  sideChatSession?: SessionSummary | null
}

export interface ThreadDisplayRowsCacheStats {
  cacheHitCount: number
  cacheMissCount: number
  invalidatedMessageCount: number
}

interface MainTraceRowEntry {
  endRawItemIndex: number
  row: AssistantTraceItemRow | AssistantFileChangeRow
  startRawItemIndex: number
}

interface MessageContentSignatureCacheEntry {
  message: ThreadMessage
  signature: string
}

interface BaseRowsCacheEntry {
  dependencyMessages: ThreadMessage[]
  key: string
  rows: ThreadDisplayRow[]
}

interface DecorationRowsCacheEntry {
  baseRow: AssistantDisplayRow
  branchOptions: SessionMessageBranchOption[]
  key: string
  rows: ThreadDisplayRow[]
  trailingDiffMessage: AssistantThreadMessage | UserThreadMessage | null
}

export interface ThreadDisplayRowsCache {
  baseRowsByMessageID: Map<string, BaseRowsCacheEntry>
  decorationRowsByOwnerMessageID: Map<string, DecorationRowsCacheEntry>
  messageSignaturesByID: Map<string, MessageContentSignatureCacheEntry>
  sessionID: string | null
  version: number
}

export interface BuildThreadDisplayRowsIncrementalResult {
  cache: ThreadDisplayRowsCache
  rows: ThreadDisplayRow[]
  stats: ThreadDisplayRowsCacheStats
}

export interface DecorateThreadDisplayRowsIncrementalResult {
  cache: ThreadDisplayRowsCache
  rows: ThreadDisplayRow[]
  stats: ThreadDisplayRowsCacheStats
}

const THREAD_DISPLAY_ROWS_CACHE_VERSION = 1
const CACHE_KEY_SEPARATOR = "\u0001"
const EMPTY_BRANCH_OPTIONS: SessionMessageBranchOption[] = []
const ASSISTANT_TRACE_VISIBILITY_SIGNATURE_KEYS: AssistantTraceVisibilityKey[] = [
  "response",
  "reasoning",
  "toolCalls",
  "toolInputs",
  "toolOutputs",
  "sources",
  "files",
  "approvals",
  "workflow",
  "debugMetadata",
]

export function createThreadDisplayRowsCache(sessionID: string | null = null): ThreadDisplayRowsCache {
  return {
    baseRowsByMessageID: new Map(),
    decorationRowsByOwnerMessageID: new Map(),
    messageSignaturesByID: new Map(),
    sessionID,
    version: THREAD_DISPLAY_ROWS_CACHE_VERSION,
  }
}

function createThreadDisplayRowsCacheStats(): ThreadDisplayRowsCacheStats {
  return {
    cacheHitCount: 0,
    cacheMissCount: 0,
    invalidatedMessageCount: 0,
  }
}

function getCompatibleThreadDisplayRowsCache(
  previousCache: ThreadDisplayRowsCache | null | undefined,
  sessionID: string | null,
) {
  if (!previousCache) return null
  if (previousCache.version !== THREAD_DISPLAY_ROWS_CACHE_VERSION) return null
  if (previousCache.sessionID !== sessionID) return null
  return previousCache
}

function getTraceBlockItem<TItem>(value: TItem): AssistantTraceItem {
  return isAssistantTraceRowItem(value) ? value.item : value as AssistantTraceItem
}

function isAssistantTraceRowItem(value: unknown): value is AssistantTraceRowItem {
  return Boolean(value && typeof value === "object" && "item" in value && "rawItemIndex" in value)
}

export function getUserMessageBodyText(message: UserThreadMessage) {
  const displayText = message.displayText?.trim() || ""
  const references = message.references ?? []

  return displayText || (references.length > 0 ? references.map((reference) => `@${reference.label}`).join(" ") : message.text)
}

function countTextLines(text: string) {
  if (!text) return 0
  return text.split(/\r\n|\r|\n/).length
}

export function shouldCollapseUserMessageText(text: string) {
  return text.length >= COMPOSER_LONG_TEXT_CHARACTER_THRESHOLD ||
    countTextLines(text) >= COMPOSER_LONG_TEXT_LINE_THRESHOLD
}

function normalizeMessageDiffSummary(diffSummary: SessionDiffSummary | undefined): AssistantTraceFileChange[] {
  return diffSummary?.diffs
    .filter((change) => change.file.trim())
    .map((change) => ({
      file: change.file,
      additions: change.additions,
      deletions: change.deletions,
      ...(change.patch?.trim() ? { patch: change.patch } : {}),
    })) ?? []
}

export function hasUserMessageDiffSummary(message: UserThreadMessage) {
  return normalizeMessageDiffSummary(message.diffSummary).length > 0
}

function hasAssistantMessageDiffSummary(message: AssistantThreadMessage) {
  return normalizeMessageDiffSummary(message.diffSummary).length > 0
}

function hasFollowingAssistantBeforeNextUser(messages: ThreadMessage[], startIndex: number) {
  for (let index = startIndex + 1; index < messages.length; index += 1) {
    const candidate = messages[index]
    if (candidate.kind === "user") return false
    if (candidate.kind === "assistant") return true
  }

  return false
}

function findPreviousUserMessage(messages: ThreadMessage[], startIndex: number) {
  for (let index = startIndex - 1; index >= 0; index -= 1) {
    const candidate = messages[index]
    if (candidate.kind === "user") return candidate
  }

  return null
}

export function getAssistantTrailingUserDiffMessage(
  messages: ThreadMessage[],
  assistantIndex: number,
  assistantMessage: AssistantThreadMessage,
) {
  if (assistantMessage.isStreaming || hasFollowingAssistantBeforeNextUser(messages, assistantIndex)) return null

  const userMessage = findPreviousUserMessage(messages, assistantIndex)
  if (!userMessage || !hasUserMessageDiffSummary(userMessage)) return null

  return userMessage
}

export function shouldRenderDiffOnStandaloneUserMessage(
  messages: ThreadMessage[],
  userIndex: number,
  message: UserThreadMessage,
) {
  return hasUserMessageDiffSummary(message) && !hasFollowingAssistantBeforeNextUser(messages, userIndex)
}

function estimateAssistantTraceItemHeight(item: AssistantTraceItem) {
  const draftPatchFileCount = Array.isArray(item.draftPatch?.fileChanges) ? item.draftPatch.fileChanges.length : 0
  if (item.kind === "tool" && draftPatchFileCount === 0) return 32

  const textLength = `${item.title ?? ""}${item.text ?? ""}${item.detail ?? ""}`.length
  const textHeight = Math.min(320, Math.max(42, Math.ceil(textLength / 110) * 22))
  const kindHeight =
    item.kind === "tool" || item.kind === "patch" || item.kind === "file" || item.kind === "image"
      ? 84
      : item.kind === "reasoning"
        ? 58
        : 48
  const draftPatchHeight = draftPatchFileCount > 0 ? Math.min(220, Math.max(48, draftPatchFileCount * 28 + 34)) : 0
  return Math.max(kindHeight + draftPatchHeight, textHeight)
}

function estimateUserThreadRowHeight(message: UserThreadMessage) {
  const bodyText = getUserMessageBodyText(message)
  const isCollapsedByDefault = shouldCollapseUserMessageText(bodyText)
  const textLength = isCollapsedByDefault ? Math.min(bodyText.length, COLLAPSED_USER_MESSAGE_ESTIMATED_CHARACTERS) : bodyText.length
  const attachmentCount = message.attachments?.length ?? 0
  const diffHeight = hasUserMessageDiffSummary(message) ? 220 : 0
  const collapseControlHeight = isCollapsedByDefault ? 30 : 0
  return 64 + Math.ceil(textLength / 90) * 22 + collapseControlHeight + attachmentCount * 28 + diffHeight
}

function estimateFileChangeSummaryHeight(items: AssistantTraceRowItem[]) {
  return Math.max(84, items.reduce((height, traceItem) => height + estimateAssistantTraceItemHeight(traceItem.item), 0))
}

function estimateAssistantEphemeralHeight() {
  return 96
}

function isResponseTraceItem(item: AssistantTraceItem) {
  return item.kind === "text" || item.kind === "question"
}

function isToolTraceItem(item: AssistantTraceItem) {
  return item.kind === "tool"
}

function isSourceTraceItem(item: AssistantTraceItem) {
  return item.section === "sources" || item.kind === "source"
}

function isFileChangeTraceItem(item: AssistantTraceItem) {
  return item.section === "file-change" || item.kind === "patch" || item.kind === "file" || item.kind === "image"
}

function defaultTraceSectionKeyForItem(item: AssistantTraceItem): AssistantTraceSectionKey {
  if (isResponseTraceItem(item)) return "response"
  if (isSourceTraceItem(item)) return "sources"
  if (isFileChangeTraceItem(item)) return "file-change"
  if (isToolTraceItem(item)) return "tools"
  if (item.kind === "reasoning") return "reasoning"
  if (item.kind === "compaction") return "workflow"
  if (item.kind === "step" || item.kind === "retry" || item.kind === "snapshot" || item.kind === "subtask" || item.kind === "task-state") {
    return "workflow"
  }
  if (item.kind === "system") return "debug"
  return "workflow"
}

export function traceVisibilityKeyForItem(item: AssistantTraceItem): AssistantTraceVisibilityKey | null {
  if (item.kind === "error") return null
  if (item.kind === "compaction") return null
  if (item.visibilityKey) return item.visibilityKey

  const sectionKey = traceSectionKeyForItem(item)
  switch (sectionKey) {
    case "response":
      return "response"
    case "reasoning":
      return "reasoning"
    case "tools":
      return "toolCalls"
    case "sources":
      return "sources"
    case "approvals":
      return "approvals"
    case "file-change":
      return "files"
    case "debug":
      return "debugMetadata"
    default:
      return "workflow"
  }
}

export function traceSectionKeyForItem(item: AssistantTraceItem): AssistantTraceSectionKey {
  return item.section ?? defaultTraceSectionKeyForItem(item)
}

export function permissionRequestMatchesApprovalTraceItem(request: PermissionRequest, item: AssistantTraceItem) {
  if (traceSectionKeyForItem(item) !== "approvals" || item.status !== "pending") return false

  return Boolean(
    (item.approvalID && item.approvalID === request.approvalID) ||
    (item.toolCallID && item.toolCallID === request.toolCallID),
  )
}

export function traceSectionTitle(sectionKey: AssistantTraceSectionKey) {
  switch (sectionKey) {
    case "tools":
      return "Tools"
    case "sources":
      return "Sources"
    case "approvals":
      return "Approvals"
    case "workflow":
      return "Workflow"
    case "response":
      return "Response"
    case "file-change":
      return "File Changes"
    case "debug":
      return "Debug"
    default:
      return "Reasoning"
  }
}

function filterRenderedTraceItems<TItem>(
  items: TItem[],
  showFileChanges: boolean,
  traceVisibility: AssistantTraceVisibility,
) {
  return items.filter((value) => {
    const item = getTraceBlockItem(value)
    const sectionKey = traceSectionKeyForItem(item)
    if (!showFileChanges && sectionKey === "file-change") return false
    const visibilityKey = traceVisibilityKeyForItem(item)
    if (visibilityKey === null) return true
    if (!traceVisibility[visibilityKey]) return false
    return true
  })
}

export function filterRenderedAssistantTraceItems(
  items: AssistantTraceItem[],
  showFileChanges: boolean,
  traceVisibility: AssistantTraceVisibility,
) {
  return filterRenderedTraceItems(items, showFileChanges, traceVisibility)
}

function assistantMessageHasTextResponse(message: AssistantThreadMessage) {
  return message.items.some(
    (item) => traceSectionKeyForItem(item) === "response" && item.kind === "text" && Boolean(item.text?.trim()),
  )
}

function isTerminalAssistantMessagePhase(phase: AssistantThreadMessagePhase) {
  return phase === "completed" || phase === "failed" || phase === "cancelled"
}

function isFoldableAssistantRunMessage(message: AssistantThreadMessage) {
  return !message.isStreaming && isTerminalAssistantMessagePhase(message.runtime.phase)
}

function isRegularUserRunBoundary(messages: ThreadMessage[], messageIndex: number) {
  const message = messages[messageIndex]
  return message?.kind === "user" &&
    !hasStreamInsertionTarget(messages, message) &&
    !isPendingSteerUserMessage(messages, message)
}

function findAssistantRunStartIndex(messages: ThreadMessage[], assistantIndex: number) {
  for (let index = assistantIndex - 1; index >= 0; index -= 1) {
    if (isRegularUserRunBoundary(messages, index)) return index + 1
  }

  return 0
}

function findAssistantRunEndIndex(messages: ThreadMessage[], assistantIndex: number) {
  for (let index = assistantIndex + 1; index < messages.length; index += 1) {
    if (isRegularUserRunBoundary(messages, index)) return index
  }

  return messages.length
}

function findAssistantRunFinalMessageIndex(messages: ThreadMessage[], assistantIndex: number) {
  const runEndIndex = findAssistantRunEndIndex(messages, assistantIndex)
  for (let index = runEndIndex - 1; index >= assistantIndex; index -= 1) {
    if (messages[index]?.kind === "assistant") return index
  }

  return -1
}

export function shouldFoldAssistantMessageIntoFinalRunTrace(
  messages: ThreadMessage[],
  assistantIndex: number,
  message: AssistantThreadMessage,
) {
  const finalAssistantIndex = findAssistantRunFinalMessageIndex(messages, assistantIndex)
  if (finalAssistantIndex <= assistantIndex) return false

  const finalMessage = messages[finalAssistantIndex]
  if (finalMessage?.kind !== "assistant") return false
  if (!isFoldableAssistantRunMessage(finalMessage) || !assistantMessageHasTextResponse(finalMessage)) return false

  return isFoldableAssistantRunMessage(message) || Boolean(message.isStreaming)
}

export function resolveAssistantSideChatAnchorMessageID(messages: ThreadMessage[], message: AssistantThreadMessage) {
  if (!message.messageID) return message.id

  const hasDuplicateBackendMessageSegment = messages.some(
    (candidate) =>
      candidate.kind === "assistant" &&
      candidate.id !== message.id &&
      candidate.backendTurnID === message.backendTurnID &&
      candidate.messageID === message.messageID &&
      candidate.segmentID !== message.segmentID,
  )

  return hasDuplicateBackendMessageSegment ? message.segmentID : message.messageID
}

export function isAssistantLatestRenderableMessage(
  messages: ThreadMessage[],
  assistantIndex: number,
  assistantMessage: AssistantThreadMessage,
) {
  if (assistantIndex === messages.length - 1) return true

  const followingMessages = messages.slice(assistantIndex + 1)
  return followingMessages.length > 0 &&
    followingMessages.every(
      (message) => message.kind === "user" && message.streamInsertion?.assistantThreadMessageID === assistantMessage.id,
    )
}

export function isAssistantFinalMessageInUserMessage(
  messages: ThreadMessage[],
  assistantIndex: number,
  assistantMessage: AssistantThreadMessage,
) {
  for (let index = assistantIndex + 1; index < messages.length; index += 1) {
    const candidate = messages[index]
    if (candidate.kind === "user" && candidate.streamInsertion?.assistantThreadMessageID !== assistantMessage.id) return true
    if (candidate.kind === "assistant") return false
  }

  return true
}

export function buildThreadDisplayContext(messages: ThreadMessage[]): ThreadDisplayContext {
  const messageIndexByID = new Map<string, number>()
  const foldedAssistantMessageIDs = new Set<string>()
  const finalOperableAssistantMessageIDs = new Set<string>()
  const streamInsertedUserMessagesByAssistantID = new Map<string, UserThreadMessage[]>()
  const sideChatAnchorMessageIDByAssistantID = new Map<string, string>()
  let latestRenderableAssistantMessageID: string | null = null

  messages.forEach((message, index) => {
    messageIndexByID.set(message.id, index)
    if (message.kind !== "assistant") return

    if (shouldFoldAssistantMessageIntoFinalRunTrace(messages, index, message)) {
      foldedAssistantMessageIDs.add(message.id)
    }
    if (isAssistantLatestRenderableMessage(messages, index, message)) {
      latestRenderableAssistantMessageID = message.id
    }
    if (isAssistantFinalMessageInUserMessage(messages, index, message)) {
      finalOperableAssistantMessageIDs.add(message.id)
    }

    streamInsertedUserMessagesByAssistantID.set(
      message.id,
      getAssistantStreamInsertionUserMessages(messages, message),
    )
    sideChatAnchorMessageIDByAssistantID.set(
      message.id,
      resolveAssistantSideChatAnchorMessageID(messages, message),
    )
  })

  return {
    finalOperableAssistantMessageIDs,
    foldedAssistantMessageIDs,
    latestRenderableAssistantMessageID,
    messageIndexByID,
    messages,
    sideChatAnchorMessageIDByAssistantID,
    streamInsertedUserMessagesByAssistantID,
  }
}

function stringifyCacheValue(value: unknown) {
  if (value === undefined) return ""

  try {
    return JSON.stringify(value) ?? ""
  } catch {
    return String(value)
  }
}

function joinCacheKeyParts(parts: Array<string | number | boolean | null | undefined>) {
  return parts.map((part) => part == null ? "" : String(part)).join(CACHE_KEY_SEPARATOR)
}

function assistantTraceVisibilitySignature(visibility: AssistantTraceVisibility) {
  return ASSISTANT_TRACE_VISIBILITY_SIGNATURE_KEYS
    .map((key) => `${key}:${visibility[key] ? 1 : 0}`)
    .join(",")
}

function sessionDiffSummarySignature(diffSummary: SessionDiffSummary | undefined) {
  return stringifyCacheValue(normalizeMessageDiffSummary(diffSummary))
}

function assistantTraceItemSignatureValue(item: AssistantTraceItem) {
  return {
    alt: item.alt,
    backendTurnID: item.backendTurnID,
    debugEntries: item.debugEntries,
    detail: item.detail,
    draftPatch: item.draftPatch,
    fileChanges: item.fileChanges,
    filePaths: item.filePaths,
    height: item.height,
    id: item.id,
    approvalID: item.approvalID,
    isStreaming: item.isStreaming,
    kind: item.kind,
    label: item.label,
    messageID: item.messageID,
    mimeType: item.mimeType,
    partID: item.partID,
    progressItems: item.progressItems,
    questionPrompt: item.questionPrompt,
    section: item.section,
    sourceID: item.sourceID,
    src: item.src,
    status: item.status,
    text: item.text,
    timestamp: item.timestamp,
    title: item.title,
    toolCallID: item.toolCallID,
    toolInputText: item.toolInputText,
    toolOutputText: item.toolOutputText,
    visibilityKey: item.visibilityKey,
    width: item.width,
  }
}

function createAssistantMessageContentSignature(message: AssistantThreadMessage) {
  return stringifyCacheValue({
    backendTurnID: message.backendTurnID,
    diffSummary: sessionDiffSummarySignature(message.diffSummary),
    id: message.id,
    isStreaming: Boolean(message.isStreaming),
    items: message.items.map(assistantTraceItemSignatureValue),
    llmCallID: message.llmCallID,
    messageID: message.messageID,
    runtime: message.runtime,
    segmentID: message.segmentID,
    state: message.state,
    timestamp: message.timestamp,
  })
}

function createUserMessageContentSignature(message: UserThreadMessage) {
  return stringifyCacheValue({
    attachments: message.attachments,
    diffSummary: sessionDiffSummarySignature(message.diffSummary),
    displayText: message.displayText,
    id: message.id,
    questionAnswer: message.questionAnswer,
    references: message.references,
    streamInsertion: message.streamInsertion,
    submissionMode: message.submissionMode,
    text: message.text,
    timestamp: message.timestamp,
  })
}

function readMessageContentSignature(
  message: ThreadMessage,
  previousCache: ThreadDisplayRowsCache | null,
  nextCache: ThreadDisplayRowsCache,
) {
  const previousSignature = previousCache?.messageSignaturesByID.get(message.id)
  if (previousSignature?.message === message) {
    nextCache.messageSignaturesByID.set(message.id, previousSignature)
    return previousSignature.signature
  }

  const signature = message.kind === "assistant"
    ? createAssistantMessageContentSignature(message)
    : createUserMessageContentSignature(message)
  nextCache.messageSignaturesByID.set(message.id, {
    message,
    signature,
  })
  return signature
}

function areSameReferences(left: readonly unknown[], right: readonly unknown[]) {
  if (left.length !== right.length) return false

  return left.every((value, index) => value === right[index])
}

function getFoldedAssistantRunDependencies(
  messages: ThreadMessage[],
  finalAssistantIndex: number,
) {
  const dependencies: AssistantThreadMessage[] = []
  const runStartIndex = findAssistantRunStartIndex(messages, finalAssistantIndex)

  for (let index = runStartIndex; index < finalAssistantIndex; index += 1) {
    const message = messages[index]
    if (message?.kind !== "assistant") continue
    if (!shouldFoldAssistantMessageIntoFinalRunTrace(messages, index, message)) continue
    dependencies.push(message)
  }

  return dependencies
}

function getInsertedUserMessageCacheParts(
  insertedMessages: UserThreadMessage[],
  previousCache: ThreadDisplayRowsCache | null,
  nextCache: ThreadDisplayRowsCache,
) {
  return insertedMessages.map((message) => joinCacheKeyParts([
    message.id,
    readMessageContentSignature(message, previousCache, nextCache),
  ]))
}

function getFoldedAssistantRunCacheParts(
  foldedMessages: AssistantThreadMessage[],
  context: ThreadDisplayContext,
  previousCache: ThreadDisplayRowsCache | null,
  nextCache: ThreadDisplayRowsCache,
) {
  return foldedMessages.map((message) => joinCacheKeyParts([
    context.messageIndexByID.get(message.id) ?? -1,
    message.id,
    readMessageContentSignature(message, previousCache, nextCache),
  ]))
}

function createUserBaseRowsCacheKey({
  activeMessages,
  message,
  messageIndex,
  previousCache,
  nextCache,
}: {
  activeMessages: ThreadMessage[]
  message: UserThreadMessage
  messageIndex: number
  previousCache: ThreadDisplayRowsCache | null
  nextCache: ThreadDisplayRowsCache
}) {
  return joinCacheKeyParts([
    "base:user",
    message.id,
    messageIndex,
    hasStreamInsertionTarget(activeMessages, message) ? 1 : 0,
    readMessageContentSignature(message, previousCache, nextCache),
  ])
}

function createAssistantBaseRowsCacheState({
  assistantTraceVisibility,
  context,
  message,
  messageIndex,
  previousCache,
  nextCache,
}: {
  assistantTraceVisibility: AssistantTraceVisibility
  context: ThreadDisplayContext
  message: AssistantThreadMessage
  messageIndex: number
  previousCache: ThreadDisplayRowsCache | null
  nextCache: ThreadDisplayRowsCache
}) {
  const insertedUserMessages = context.streamInsertedUserMessagesByAssistantID.get(message.id) ?? []
  const foldedRunMessages = getFoldedAssistantRunDependencies(context.messages, messageIndex)
  const key = joinCacheKeyParts([
    "base:assistant",
    message.id,
    messageIndex,
    readMessageContentSignature(message, previousCache, nextCache),
    assistantTraceVisibilitySignature(assistantTraceVisibility),
    context.foldedAssistantMessageIDs.has(message.id) ? 1 : 0,
    context.finalOperableAssistantMessageIDs.has(message.id) ? 1 : 0,
    context.latestRenderableAssistantMessageID === message.id ? 1 : 0,
    context.sideChatAnchorMessageIDByAssistantID.get(message.id) ?? message.id,
    getInsertedUserMessageCacheParts(insertedUserMessages, previousCache, nextCache).join("|"),
    getFoldedAssistantRunCacheParts(foldedRunMessages, context, previousCache, nextCache).join("|"),
  ])

  return {
    dependencyMessages: [
      message,
      ...foldedRunMessages,
      ...insertedUserMessages,
    ],
    key,
  }
}

function createTraceRowItems(message: AssistantThreadMessage, messageIndex: number): AssistantTraceRowItem[] {
  return message.items.map((item, rawItemIndex) => ({
    item,
    itemID: item.id,
    rawItemIndex,
    section: traceSectionKeyForItem(item),
    sourceMessage: message,
    sourceMessageID: message.id,
    sourceMessageIndex: messageIndex,
  }))
}

function collectFoldedAssistantRunTraceRowItems(
  messages: ThreadMessage[],
  finalAssistantIndex: number,
  traceVisibility: AssistantTraceVisibility,
) {
  const runStartIndex = findAssistantRunStartIndex(messages, finalAssistantIndex)
  const items: AssistantTraceRowItem[] = []

  for (let index = runStartIndex; index < finalAssistantIndex; index += 1) {
    const message = messages[index]
    if (message?.kind !== "assistant") continue
    if (!shouldFoldAssistantMessageIntoFinalRunTrace(messages, index, message)) continue
    items.push(...filterRenderedTraceItems(createTraceRowItems(message, index), true, traceVisibility))
  }

  return items
}

function getAssistantEphemeralHint(message: AssistantThreadMessage) {
  switch (message.runtime.phase) {
    case "requesting":
    case "waiting_first_event":
    case "preparing":
      return "Preparing..."
    case "waiting_llm":
      return "Waiting for model..."
    case "reasoning":
      return "Thinking..."
    case "tool_running":
      return message.runtime.toolName ? `Running ${message.runtime.toolName}...` : "Running tools..."
    case "waiting_approval":
      return "Waiting for approval..."
    case "blocked":
      return message.state || "Blocked..."
    case "responding":
      return "Responding..."
    default:
      return null
  }
}

function buildAssistantRowBase<TKind extends ThreadDisplayRowKind>({
  context,
  estimatedHeight,
  kind,
  ownerMessage,
  ownerMessageIndex,
  rowID,
  section = "response",
  sourceMessage = ownerMessage,
  sourceMessageIndex = ownerMessageIndex,
  rawItemIndex,
}: {
  context: ThreadDisplayContext
  estimatedHeight: number
  kind: TKind
  ownerMessage: AssistantThreadMessage
  ownerMessageIndex: number
  rowID: string
  rawItemIndex?: number
  section?: AssistantTraceSectionKey
  sourceMessage?: AssistantThreadMessage
  sourceMessageIndex?: number
}): AssistantDisplayRowBase & { kind: TKind } {
  return {
    estimatedHeight,
    isFinalOperableMessage: context.finalOperableAssistantMessageIDs.has(ownerMessage.id),
    isLatestMessage: context.latestRenderableAssistantMessageID === ownerMessage.id,
    kind,
    message: ownerMessage,
    messageID: ownerMessage.id,
    messageIndex: ownerMessageIndex,
    motionKey: ownerMessage.id,
    ownerMessageID: ownerMessage.id,
    ownerMessageIndex,
    rawItemIndex,
    rowID,
    section,
    sourceMessage,
    sourceMessageID: sourceMessage.id,
    sourceMessageIndex,
    visualGroupID: `assistant:${ownerMessage.id}`,
  }
}

function assistantTraceItemRowKind(traceItem: AssistantTraceRowItem): AssistantTraceItemRowKind {
  switch (traceItem.section) {
    case "response":
      return traceItem.item.kind === "question" ? "assistant-question-row" : "assistant-response-row"
    case "reasoning":
      return "assistant-reasoning-row"
    case "tools":
      return "assistant-tool-row"
    case "sources":
      return "assistant-source-row"
    case "approvals":
      return "assistant-approval-row"
    case "debug":
      return "assistant-debug-row"
    default:
      return "assistant-workflow-row"
  }
}

function assistantTraceRowIDSegment(kind: AssistantTraceItemRowKind) {
  switch (kind) {
    case "assistant-response-row":
      return "response"
    case "assistant-reasoning-row":
      return "reasoning"
    case "assistant-tool-row":
      return "tool"
    case "assistant-question-row":
      return "question"
    case "assistant-source-row":
      return "source"
    case "assistant-approval-row":
      return "approval"
    case "assistant-debug-row":
      return "debug"
    default:
      return "workflow"
  }
}

function buildTraceItemRow({
  context,
  message,
  messageIndex,
  shouldCollapseTraceItemAfterMessageCompletion,
  traceItem,
}: {
  context: ThreadDisplayContext
  message: AssistantThreadMessage
  messageIndex: number
  shouldCollapseTraceItemAfterMessageCompletion: boolean
  traceItem: AssistantTraceRowItem
}): AssistantTraceItemRow {
  const kind = assistantTraceItemRowKind(traceItem)

  return {
    ...buildAssistantRowBase({
      context,
      estimatedHeight: estimateAssistantTraceItemHeight(traceItem.item),
      kind,
      ownerMessage: message,
      ownerMessageIndex: messageIndex,
      rawItemIndex: traceItem.rawItemIndex,
      rowID: `assistant:${message.id}:${assistantTraceRowIDSegment(kind)}:${traceItem.sourceMessageID}:${traceItem.itemID}`,
      section: traceItem.section,
      sourceMessage: traceItem.sourceMessage,
      sourceMessageIndex: traceItem.sourceMessageIndex,
    }),
    item: traceItem.item,
    itemID: traceItem.itemID,
    shouldCollapseTraceItemAfterMessageCompletion,
    traceItem,
  }
}

function buildFileChangeSummaryRow({
  context,
  items,
  message,
  messageIndex,
  shouldCollapseTraceItemAfterMessageCompletion,
}: {
  context: ThreadDisplayContext
  items: AssistantTraceRowItem[]
  message: AssistantThreadMessage
  messageIndex: number
  shouldCollapseTraceItemAfterMessageCompletion: boolean
}): AssistantFileChangeRow {
  const firstItem = items[0]
  const summaryKey = items.map((traceItem) => `${traceItem.sourceMessageID}:${traceItem.itemID}`).join(",") || "empty"

  return {
    ...buildAssistantRowBase({
      context,
      estimatedHeight: estimateFileChangeSummaryHeight(items),
      kind: "assistant-file-change-row",
      ownerMessage: message,
      ownerMessageIndex: messageIndex,
      rawItemIndex: firstItem?.rawItemIndex,
      rowID: `assistant:${message.id}:file-change:${summaryKey}`,
      section: "file-change",
      sourceMessage: firstItem?.sourceMessage ?? message,
      sourceMessageIndex: firstItem?.sourceMessageIndex ?? messageIndex,
    }),
    itemID: firstItem?.itemID,
    items,
    shouldCollapseTraceItemAfterMessageCompletion,
    summaryKey,
  }
}

function buildMainTraceRowEntries({
  context,
  mainTraceItems,
  message,
  messageIndex,
  shouldCollapseTraceItemAfterMessageCompletion,
}: {
  context: ThreadDisplayContext
  mainTraceItems: AssistantTraceRowItem[]
  message: AssistantThreadMessage
  messageIndex: number
  shouldCollapseTraceItemAfterMessageCompletion: boolean
}) {
  const entries: MainTraceRowEntry[] = []

  mainTraceItems.forEach((traceItem) => {
    if (traceItem.section === "file-change") {
      entries.push({
        endRawItemIndex: traceItem.rawItemIndex + 1,
        row: buildFileChangeSummaryRow({
          context,
          items: [traceItem],
          message,
          messageIndex,
          shouldCollapseTraceItemAfterMessageCompletion,
        }),
        startRawItemIndex: traceItem.rawItemIndex,
      })
      return
    }

    entries.push({
      endRawItemIndex: traceItem.rawItemIndex + 1,
      row: buildTraceItemRow({
        context,
        message,
        messageIndex,
        shouldCollapseTraceItemAfterMessageCompletion,
        traceItem,
      }),
      startRawItemIndex: traceItem.rawItemIndex,
    })
  })

  return entries
}

function buildInsertedUserMessageRow({
  context,
  insertedMessage,
  message,
  messageIndex,
}: {
  context: ThreadDisplayContext
  insertedMessage: UserThreadMessage
  message: AssistantThreadMessage
  messageIndex: number
}): AssistantInsertedUserMessageRow {
  const requestedRawItemIndex = insertedMessage.streamInsertion?.afterItemCount ?? 0

  return {
    ...buildAssistantRowBase({
      context,
      estimatedHeight: estimateUserThreadRowHeight(insertedMessage),
      kind: "assistant-inserted-user-message",
      ownerMessage: message,
      ownerMessageIndex: messageIndex,
      rawItemIndex: requestedRawItemIndex,
      rowID: `assistant:${message.id}:inserted-user:${insertedMessage.id}`,
      section: "response",
    }),
    insertedMessage,
    motionKey: insertedMessage.id,
  }
}

function pushMainEntriesWithStreamInsertions({
  context,
  entries,
  insertedUserMessages,
  message,
  messageIndex,
  rows,
}: {
  context: ThreadDisplayContext
  entries: MainTraceRowEntry[]
  insertedUserMessages: UserThreadMessage[]
  message: AssistantThreadMessage
  messageIndex: number
  rows: ThreadDisplayRow[]
}) {
  let entryCursor = 0
  let rawCursor = 0

  insertedUserMessages.forEach((insertedMessage) => {
    const insertionIndex = resolveStreamInsertionItemIndex(message.items, insertedMessage, rawCursor)

    while (entryCursor < entries.length && entries[entryCursor]!.startRawItemIndex < insertionIndex) {
      rows.push(entries[entryCursor]!.row)
      entryCursor += 1
    }

    rows.push(buildInsertedUserMessageRow({
      context,
      insertedMessage,
      message,
      messageIndex,
    }))
    rawCursor = insertionIndex
  })

  while (entryCursor < entries.length) {
    rows.push(entries[entryCursor]!.row)
    entryCursor += 1
  }
}

function buildAssistantMessageRows({
  assistantTraceVisibility,
  context,
  message,
  messageIndex,
  rows,
}: {
  assistantTraceVisibility: AssistantTraceVisibility
  context: ThreadDisplayContext
  message: AssistantThreadMessage
  messageIndex: number
  rows: ThreadDisplayRow[]
}) {
  const foldedRunTraceItems = collectFoldedAssistantRunTraceRowItems(
    context.messages,
    messageIndex,
    assistantTraceVisibility,
  )
  const insertedUserMessages = context.streamInsertedUserMessagesByAssistantID.get(message.id) ?? []
  const ownTraceItems = createTraceRowItems(message, messageIndex)
  const renderedItems = filterRenderedTraceItems(
    ownTraceItems,
    !message.isStreaming,
    assistantTraceVisibility,
  )
  const ephemeralHint = renderedItems.length === 0 ? getAssistantEphemeralHint(message) : null
  if (renderedItems.length === 0 && !ephemeralHint && insertedUserMessages.length === 0) return

  const shouldCollapseTraceItemAfterMessageCompletion = isFoldableAssistantRunMessage(message)

  if (ephemeralHint) {
    rows.push({
      ...buildAssistantRowBase({
        context,
        estimatedHeight: estimateAssistantEphemeralHeight(),
        kind: "assistant-ephemeral-state",
        ownerMessage: message,
        ownerMessageIndex: messageIndex,
        rowID: `assistant:${message.id}:ephemeral`,
        section: "response",
      }),
      ephemeralHint,
    })
    insertedUserMessages.forEach((insertedMessage) => {
      rows.push(buildInsertedUserMessageRow({
        context,
        insertedMessage,
        message,
        messageIndex,
      }))
    })
    return
  }

  const mainEntries = buildMainTraceRowEntries({
    context,
    mainTraceItems: filterRenderedTraceItems(
      [...foldedRunTraceItems, ...ownTraceItems],
      !message.isStreaming,
      assistantTraceVisibility,
    ),
    message,
    messageIndex,
    shouldCollapseTraceItemAfterMessageCompletion,
  })

  pushMainEntriesWithStreamInsertions({
    context,
    entries: mainEntries,
    insertedUserMessages,
    message,
    messageIndex,
    rows,
  })
}

export function buildThreadDisplayRowsIncremental(
  input: BuildThreadDisplayRowsInput,
  previousCache?: ThreadDisplayRowsCache | null,
): BuildThreadDisplayRowsIncrementalResult {
  const {
    activeSession,
    activeSessionID,
    activeMessages,
    assistantTraceVisibility,
    context = buildThreadDisplayContext(activeMessages),
    isResolvingPermissionRequest,
    pendingPermissionRequests,
  } = input
  const sessionID = activeSessionID ?? activeSession?.id ?? null
  const hasActiveSession = Boolean(activeSession ?? sessionID)
  const compatiblePreviousCache = getCompatibleThreadDisplayRowsCache(previousCache, sessionID)
  const cache = createThreadDisplayRowsCache(sessionID)
  const stats = createThreadDisplayRowsCacheStats()

  if (compatiblePreviousCache) {
    compatiblePreviousCache.decorationRowsByOwnerMessageID.forEach((entry, ownerMessageID) => {
      cache.decorationRowsByOwnerMessageID.set(ownerMessageID, entry)
    })
  }

  if (!hasActiveSession) {
    return {
      cache,
      rows: [],
      stats,
    }
  }

  const rows: ThreadDisplayRow[] = []
  activeMessages.forEach((message, messageIndex) => {
    if (message.kind === "user") {
      if (hasStreamInsertionTarget(activeMessages, message)) return

      const key = createUserBaseRowsCacheKey({
        activeMessages,
        message,
        messageIndex,
        nextCache: cache,
        previousCache: compatiblePreviousCache,
      })
      const previousEntry = compatiblePreviousCache?.baseRowsByMessageID.get(message.id)
      const dependencyMessages = [message]
      if (previousEntry?.key === key && areSameReferences(previousEntry.dependencyMessages, dependencyMessages)) {
        cache.baseRowsByMessageID.set(message.id, previousEntry)
        stats.cacheHitCount += 1
        rows.push(...previousEntry.rows)
        return
      }

      if (previousEntry) stats.invalidatedMessageCount += 1
      stats.cacheMissCount += 1

      const messageRows: ThreadDisplayRow[] = [{
        estimatedHeight: estimateUserThreadRowHeight(message),
        kind: "user-message",
        rowID: `user:${message.id}`,
        message,
        messageID: message.id,
        messageIndex,
      }]
      cache.baseRowsByMessageID.set(message.id, {
        dependencyMessages,
        key,
        rows: messageRows,
      })
      rows.push(...messageRows)
      return
    }

    if (context.foldedAssistantMessageIDs.has(message.id)) return

    const { dependencyMessages, key } = createAssistantBaseRowsCacheState({
      assistantTraceVisibility,
      context,
      message,
      messageIndex,
      nextCache: cache,
      previousCache: compatiblePreviousCache,
    })
    const previousEntry = compatiblePreviousCache?.baseRowsByMessageID.get(message.id)
    if (previousEntry?.key === key && areSameReferences(previousEntry.dependencyMessages, dependencyMessages)) {
      cache.baseRowsByMessageID.set(message.id, previousEntry)
      stats.cacheHitCount += 1
      rows.push(...previousEntry.rows)
      return
    }

    if (previousEntry) stats.invalidatedMessageCount += 1
    stats.cacheMissCount += 1

    const messageRows: ThreadDisplayRow[] = []
    buildAssistantMessageRows({
      assistantTraceVisibility,
      context,
      message,
      messageIndex,
      rows: messageRows,
    })
    cache.baseRowsByMessageID.set(message.id, {
      dependencyMessages,
      key,
      rows: messageRows,
    })
    rows.push(...messageRows)
  })

  const pendingRequest = pendingPermissionRequests[0]
  if (pendingRequest && !isResolvingPermissionRequest) {
    const existingApprovalRowIndex = rows.findIndex((row) =>
      row.kind === "assistant-approval-row" &&
      permissionRequestMatchesApprovalTraceItem(pendingRequest, row.traceItem.item),
    )

    if (existingApprovalRowIndex >= 0) {
      const existingApprovalRow = rows[existingApprovalRowIndex]!
      rows[existingApprovalRowIndex] = {
        ...existingApprovalRow,
        estimatedHeight: existingApprovalRow.estimatedHeight + 420,
      }
    } else {
      rows.push({
        estimatedHeight: 420,
        kind: "permission-request",
        messageID: `permission-request:${pendingRequest.id}`,
        messageIndex: activeMessages.length,
        requestID: pendingRequest.id,
        rowID: `permission-request:${pendingRequest.id}`,
      })
    }
  }

  return {
    cache,
    rows,
    stats,
  }
}

export function buildThreadDisplayRows(input: BuildThreadDisplayRowsInput): ThreadDisplayRow[] {
  return buildThreadDisplayRowsIncremental(input).rows
}

export function getLastAssistantResponseSectionItems(
  items: AssistantTraceItem[],
  traceVisibility: AssistantTraceVisibility,
) {
  const visibleItems = filterRenderedAssistantTraceItems(items, true, traceVisibility)
  let latestResponseItems: AssistantTraceItem[] = []
  let currentResponseItems: AssistantTraceItem[] = []

  visibleItems.forEach((item) => {
    if (traceSectionKeyForItem(item) !== "response") {
      if (currentResponseItems.some((responseItem) => responseItem.kind === "text" && Boolean(responseItem.text?.trim()))) {
        latestResponseItems = currentResponseItems
      }
      currentResponseItems = []
      return
    }

    currentResponseItems.push(item)
  })

  if (currentResponseItems.some((item) => item.kind === "text" && Boolean(item.text?.trim()))) {
    latestResponseItems = currentResponseItems
  }

  return latestResponseItems
}

export function buildAssistantResponseCopyText(items: AssistantTraceItem[]) {
  return items
    .filter((item) => item.kind === "text")
    .map((item) => {
      const segments = [item.title, item.text, item.detail]
        .map((value, index) => {
          if (!value) return ""
          return index === 0 ? value.trim() : parseAssistantResponseFormat(value).text.trim()
        })
        .filter((value): value is string => Boolean(value))

      return segments.join("\n\n")
    })
    .filter(Boolean)
    .join("\n\n")
    .trim()
}

function buildAssistantDecorationBase<TKind extends ThreadDisplayRowKind>(
  baseRow: AssistantDisplayRow,
  kind: TKind,
  rowID: string,
  estimatedHeight: number,
): AssistantDisplayRowBase & { kind: TKind } {
  return {
    estimatedHeight,
    isFinalOperableMessage: baseRow.isFinalOperableMessage,
    isLatestMessage: baseRow.isLatestMessage,
    kind,
    message: baseRow.message,
    messageID: baseRow.ownerMessageID,
    messageIndex: baseRow.ownerMessageIndex,
    motionKey: baseRow.motionKey,
    ownerMessageID: baseRow.ownerMessageID,
    ownerMessageIndex: baseRow.ownerMessageIndex,
    rowID,
    section: "response",
    sourceMessage: baseRow.message,
    sourceMessageID: baseRow.ownerMessageID,
    sourceMessageIndex: baseRow.ownerMessageIndex,
    visualGroupID: baseRow.visualGroupID,
  }
}

function buildAssistantDiffRow({
  baseRow,
  context,
}: {
  baseRow: AssistantDisplayRow
  context: ThreadDisplayContext
}): AssistantDiffCardRow | null {
  const message = baseRow.message
  const hasAssistantDiffSummary = hasAssistantMessageDiffSummary(message)
  const trailingUserDiffMessage = hasAssistantDiffSummary
    ? null
    : getAssistantTrailingUserDiffMessage(context.messages, baseRow.ownerMessageIndex, message)

  if (!hasAssistantDiffSummary && !trailingUserDiffMessage) return null

  const diffMessage = hasAssistantDiffSummary ? message : trailingUserDiffMessage!
  return {
    ...buildAssistantDecorationBase(
      baseRow,
      "assistant-diff-card",
      `assistant:${baseRow.ownerMessageID}:diff`,
      220,
    ),
    allowWorkspaceDiffFallback: baseRow.isLatestMessage,
    diffMessage,
    diffMessageID: diffMessage.id,
    diffSummary: diffMessage.diffSummary,
    patchSourceMessage: message,
  }
}

function buildAssistantActionsRow({
  assistantTraceVisibility,
  baseRow,
  canForkFromMessage,
  canOpenSideChat,
  hasPendingPermissionRequests,
  isSessionRunning,
  messageTree,
  readOnlySideChat,
  sideChatAnchorMessageID,
  sideChatCountsByAnchorMessageID,
  sideChatSession,
}: {
  assistantTraceVisibility: AssistantTraceVisibility
  baseRow: AssistantDisplayRow
  canForkFromMessage: boolean
  canOpenSideChat: boolean
  hasPendingPermissionRequests: boolean
  isSessionRunning: boolean
  messageTree?: SessionMessageTree | null
  readOnlySideChat: boolean
  sideChatAnchorMessageID: string
  sideChatCountsByAnchorMessageID: Record<string, number>
  sideChatSession?: SessionSummary | null
}): AssistantActionsRow | null {
  const message = baseRow.message
  const threadMessageID = getSessionMessageIDForMessage(message)
  const canExposeResponseActions = !isSessionRunning && !hasPendingPermissionRequests && baseRow.isFinalOperableMessage
  const branchOptions = canExposeResponseActions ? messageTree?.branchOptionsByParentID[threadMessageID] ?? [] : []
  const existingSideChatCount = sideChatCountsByAnchorMessageID[sideChatAnchorMessageID] ?? 0
  const responseItems = canExposeResponseActions ? getLastAssistantResponseSectionItems(message.items, assistantTraceVisibility) : []
  const responseCopyText = canExposeResponseActions ? buildAssistantResponseCopyText(responseItems) : ""
  const activeSideChatSession = sideChatSession?.origin?.anchorMessageID === sideChatAnchorMessageID ? sideChatSession : null
  const marksSideChatButtonActive = Boolean(activeSideChatSession)
  const sideChatButtonLabel =
    existingSideChatCount > 0
      ? `Open side chat (${existingSideChatCount})`
      : "Open side chat"
  const sideChatButtonTitle =
    existingSideChatCount > 0
      ? `${existingSideChatCount} side chat thread${existingSideChatCount === 1 ? "" : "s"}`
      : "Open a side chat for this reply"
  const rowCanOpenSideChat =
    !readOnlySideChat &&
    !message.isStreaming &&
    canExposeResponseActions &&
    responseItems.length > 0 &&
    canOpenSideChat
  const rowCanForkFromMessage =
    !readOnlySideChat &&
    !message.isStreaming &&
    canExposeResponseActions &&
    canForkFromMessage
  const shouldRenderResponseActions = Boolean(
    responseCopyText ||
    rowCanOpenSideChat ||
    rowCanForkFromMessage ||
    branchOptions.length > 1,
  )
  if (!shouldRenderResponseActions) return null

  return {
    ...buildAssistantDecorationBase(
      baseRow,
      "assistant-actions",
      `assistant:${baseRow.ownerMessageID}:actions`,
      38,
    ),
    branchOptions,
    canForkFromMessage: rowCanForkFromMessage,
    canOpenSideChat: rowCanOpenSideChat,
    existingSideChatCount,
    marksSideChatButtonActive,
    responseCopyText,
    responseItems,
    sideChatAnchorMessageID,
    sideChatButtonLabel,
    sideChatButtonTitle,
    threadMessageID,
  }
}

function isAssistantDecoratableBaseRow(row: ThreadDisplayRow): row is AssistantDisplayRow {
  return "ownerMessageID" in row &&
    row.kind !== "assistant-diff-card" &&
    row.kind !== "assistant-actions"
}

function buildLastDecoratableBaseRowByOwnerID(rows: ThreadDisplayRow[]) {
  const lastBaseRowByOwnerID = new Map<string, AssistantDisplayRow>()

  rows.forEach((row) => {
    if (!isAssistantDecoratableBaseRow(row)) return
    lastBaseRowByOwnerID.set(row.ownerMessageID, row)
  })

  return lastBaseRowByOwnerID
}

function sessionSummarySignature(session: SessionSummary | null | undefined) {
  return session ? stringifyCacheValue(session) : ""
}

function branchOptionsSignature(branchOptions: SessionMessageBranchOption[]) {
  return branchOptions.map((option) => stringifyCacheValue(option)).join("|")
}

function readAssistantDecorationBranchOptions({
  baseRow,
  hasPendingPermissionRequests,
  isSessionRunning,
  messageTree,
}: {
  baseRow: AssistantDisplayRow
  hasPendingPermissionRequests: boolean
  isSessionRunning: boolean
  messageTree?: SessionMessageTree | null
}) {
  if (isSessionRunning || hasPendingPermissionRequests || !baseRow.isFinalOperableMessage) return EMPTY_BRANCH_OPTIONS

  const threadMessageID = getSessionMessageIDForMessage(baseRow.message)
  return messageTree?.branchOptionsByParentID[threadMessageID] ?? EMPTY_BRANCH_OPTIONS
}

function createAssistantDecorationDiffState({
  baseRow,
  context,
}: {
  baseRow: AssistantDisplayRow
  context: ThreadDisplayContext
}) {
  const message = baseRow.message
  const assistantDiffSignature = hasAssistantMessageDiffSummary(message)
    ? sessionDiffSummarySignature(message.diffSummary)
    : ""
  const trailingDiffMessage = assistantDiffSignature
    ? null
    : getAssistantTrailingUserDiffMessage(context.messages, baseRow.ownerMessageIndex, message)
  const trailingDiffSignature = trailingDiffMessage
    ? joinCacheKeyParts([
      trailingDiffMessage.id,
      sessionDiffSummarySignature(trailingDiffMessage.diffSummary),
    ])
    : ""

  return {
    signature: joinCacheKeyParts([
      assistantDiffSignature,
      trailingDiffSignature,
      baseRow.isLatestMessage ? 1 : 0,
    ]),
    trailingDiffMessage,
  }
}

function createAssistantDecorationSideChatState({
  sideChatAnchorMessageID,
  sideChatCountsByAnchorMessageID,
  sideChatSession,
}: {
  sideChatAnchorMessageID: string
  sideChatCountsByAnchorMessageID: Record<string, number>
  sideChatSession?: SessionSummary | null
}) {
  const existingSideChatCount = sideChatCountsByAnchorMessageID[sideChatAnchorMessageID] ?? 0
  const activeSideChatSession = sideChatSession?.origin?.anchorMessageID === sideChatAnchorMessageID ? sideChatSession : null
  const signature = joinCacheKeyParts([
    sideChatAnchorMessageID,
    existingSideChatCount,
    sessionSummarySignature(activeSideChatSession),
  ])

  return {
    signature,
  }
}

function createAssistantDecorationCacheState({
  assistantTraceVisibility,
  baseRow,
  canForkFromMessage,
  canOpenSideChat,
  context,
  hasPendingPermissionRequests,
  isSessionRunning,
  messageTree,
  readOnlySideChat,
  sideChatAnchorMessageID,
  sideChatCountsByAnchorMessageID,
  sideChatSession,
}: DecorateThreadDisplayRowsInput & {
  baseRow: AssistantDisplayRow
  sideChatAnchorMessageID: string
}) {
  const branchOptions = readAssistantDecorationBranchOptions({
    baseRow,
    hasPendingPermissionRequests,
    isSessionRunning,
    messageTree,
  })
  const diffState = createAssistantDecorationDiffState({ baseRow, context })
  const sideChatState = createAssistantDecorationSideChatState({
    sideChatAnchorMessageID,
    sideChatCountsByAnchorMessageID,
    sideChatSession,
  })
  const key = joinCacheKeyParts([
    "decoration:assistant",
    baseRow.ownerMessageID,
    baseRow.rowID,
    baseRow.kind,
    baseRow.isFinalOperableMessage ? 1 : 0,
    baseRow.isLatestMessage ? 1 : 0,
    diffState.signature,
    branchOptionsSignature(branchOptions),
    hasPendingPermissionRequests ? 1 : 0,
    isSessionRunning ? 1 : 0,
    readOnlySideChat ? 1 : 0,
    canForkFromMessage ? 1 : 0,
    canOpenSideChat ? 1 : 0,
    assistantTraceVisibilitySignature(assistantTraceVisibility),
    sideChatState.signature,
  ])

  return {
    branchOptions,
    key,
    trailingDiffMessage: diffState.trailingDiffMessage,
  }
}

function canReuseDecorationRows(
  previousEntry: DecorationRowsCacheEntry | undefined,
  state: ReturnType<typeof createAssistantDecorationCacheState>,
  baseRow: AssistantDisplayRow,
) {
  return Boolean(
    previousEntry &&
    previousEntry.key === state.key &&
    previousEntry.baseRow === baseRow &&
    previousEntry.branchOptions === state.branchOptions &&
    previousEntry.trailingDiffMessage === state.trailingDiffMessage,
  )
}

export function decorateThreadDisplayRowsIncremental(
  input: DecorateThreadDisplayRowsInput,
  previousCache?: ThreadDisplayRowsCache | null,
): DecorateThreadDisplayRowsIncrementalResult {
  const {
    assistantTraceVisibility,
    baseRows,
    canForkFromMessage,
    canOpenSideChat,
    context,
    hasPendingPermissionRequests,
    isSessionRunning,
    messageTree,
    readOnlySideChat,
    sideChatCountsByAnchorMessageID,
    sideChatSession,
  } = input
  const sessionID = previousCache?.sessionID ?? null
  const compatiblePreviousCache = getCompatibleThreadDisplayRowsCache(previousCache, sessionID)
  const cache = createThreadDisplayRowsCache(sessionID)
  const stats = createThreadDisplayRowsCacheStats()

  if (compatiblePreviousCache) {
    compatiblePreviousCache.baseRowsByMessageID.forEach((entry, messageID) => {
      cache.baseRowsByMessageID.set(messageID, entry)
    })
    compatiblePreviousCache.messageSignaturesByID.forEach((entry, messageID) => {
      cache.messageSignaturesByID.set(messageID, entry)
    })
  }

  const rows: ThreadDisplayRow[] = []
  const lastDecoratableBaseRowByOwnerID = buildLastDecoratableBaseRowByOwnerID(baseRows)

  baseRows.forEach((row) => {
    rows.push(row)

    if (!("ownerMessageID" in row)) return
    if (!row.isFinalOperableMessage) return

    const ownerLastBaseRow = lastDecoratableBaseRowByOwnerID.get(row.ownerMessageID)
    if (ownerLastBaseRow !== row) return

    const sideChatAnchorMessageID =
      context.sideChatAnchorMessageIDByAssistantID.get(row.ownerMessageID) ?? row.ownerMessageID
    const cacheState = createAssistantDecorationCacheState({
      ...input,
      baseRow: row,
      sideChatAnchorMessageID,
    })
    const previousEntry = compatiblePreviousCache?.decorationRowsByOwnerMessageID.get(row.ownerMessageID)
    if (canReuseDecorationRows(previousEntry, cacheState, row)) {
      cache.decorationRowsByOwnerMessageID.set(row.ownerMessageID, previousEntry!)
      stats.cacheHitCount += 1
      rows.push(...previousEntry!.rows)
      return
    }

    if (previousEntry) stats.invalidatedMessageCount += 1
    stats.cacheMissCount += 1

    const decorationRows: ThreadDisplayRow[] = []

    const diffRow = buildAssistantDiffRow({ baseRow: row, context })
    if (diffRow) decorationRows.push(diffRow)

    const actionsRow = buildAssistantActionsRow({
      assistantTraceVisibility,
      baseRow: row,
      canForkFromMessage,
      canOpenSideChat,
      hasPendingPermissionRequests,
      isSessionRunning,
      messageTree,
      readOnlySideChat,
      sideChatAnchorMessageID,
      sideChatCountsByAnchorMessageID,
      sideChatSession,
    })
    if (actionsRow) decorationRows.push(actionsRow)

    cache.decorationRowsByOwnerMessageID.set(row.ownerMessageID, {
      baseRow: row,
      branchOptions: cacheState.branchOptions,
      key: cacheState.key,
      rows: decorationRows,
      trailingDiffMessage: cacheState.trailingDiffMessage,
    })
    rows.push(...decorationRows)
  })

  return {
    cache,
    rows,
    stats,
  }
}

export function decorateThreadDisplayRows(input: DecorateThreadDisplayRowsInput): ThreadDisplayRow[] {
  return decorateThreadDisplayRowsIncremental(input).rows
}
