import { Component, memo, useEffect, useEffectEvent, useId, useLayoutEffect, useMemo, useRef, useState, type ComponentType, type ErrorInfo, type FormEvent, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject, type WheelEvent as ReactWheelEvent } from "react"
import { createPortal } from "react-dom"
import { getAgentSessionBridge } from "../agent-session/client"
import { Composer } from "../composer/Composer"
import { ComposerConcurrentInputDrawer } from "../composer/ComposerConcurrentInputDrawer"
import {
  COMPOSER_LONG_TEXT_CHARACTER_THRESHOLD,
  COMPOSER_LONG_TEXT_LINE_THRESHOLD,
  createEmptyComposerDraftState,
} from "../composer/draft-state"
import { DiffPreview } from "../diff/DiffPreview"
import {
  ChangesIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CloseIcon,
  CopyIcon,
  DeleteIcon,
  ForkIcon,
  InfoIcon,
  MinimizeIcon,
  PaperclipIcon,
  PlusIcon,
  ResetIcon,
  SideChatIcon,
} from "../icons"
import { joinClassNames, writeTextToClipboard } from "../shared-ui"
import { getSessionMessageIDForMessage, type SessionMessageBranchOption, type SessionMessageTree } from "../session-message-tree"
import { buildThreadMessagesFromHistory } from "../stream"
import {
  getAssistantStreamInsertionUserMessages,
  hasStreamInsertionTarget,
  isPendingSteerUserMessage,
  resolveStreamInsertionItemIndex,
} from "../stream-insertion"
import {
  ThreadMarkdown,
  normalizeMarkdownLinkTarget,
  openExternalThreadLink,
  type MarkdownArtifactLinkTarget,
  type MarkdownLocalFileLinkTarget,
} from "../thread-markdown"
import { ThreadHtml } from "../thread-html"
import { parseAssistantResponseFormat, stripStreamingResponseFormatMarker } from "../thread-response-format"
import { ThreadRichText } from "../thread-rich-text"
import { useI18n } from "../i18n/I18nProvider"
import {
  RendererProfiler,
  createRendererProfilerOnRender,
  logRendererPerf,
  measureRendererPerf,
} from "../perf-profiler"
import { SIDEBAR_RESIZE_END_EVENT } from "../sidebar-resize-events"
import type {
  AssistantTraceDebugEntry,
  AssistantTraceFileChange,
  AssistantTraceItem,
  AssistantTraceItemKind,
  AssistantTraceSectionKey,
  AssistantTraceVisibility,
  AssistantTraceVisibilityKey,
  AssistantThreadMessage,
  AssistantThreadMessagePhase,
  AssistantThreadMessageRuntime,
  ComposerAttachment,
  ComposerDraftState,
  ComposerPastedImageAttachment,
  PendingConversationInput,
  PermissionDecision,
  PermissionRequest,
  ReasoningEffort,
  SessionDiffFile,
  SessionDiffSummary,
  SessionSummary,
  ThreadMessage,
  UserThreadMessage
} from "../types"
import { useProjectComposer } from "../use-project-composer"
import { mergeUserMessagePresentationState, readPersistedUserMessages } from "../user-message-presentation"
import { formatTime } from "../utils"
import { isSideChatSession } from "../workspace"

type ProposedPlanConfirmHandler = (input: { planMarkdown: string }) => void | Promise<void>
type ProposedPlanCardStatus = "idle" | "cancelled" | "confirming" | "confirmed"
export type ThreadMessageMotion = "history" | "new" | "live"
type ThreadScrollMode = "follow" | "detached"

export interface ThreadScrollSnapshot {
  scrollTop: number
  pinnedToBottom: boolean
  updatedAt: number
}

interface ThreadFollowScrollTarget {
  scrollTop: number
  visualScrollTop: number
}

interface ThreadSmoothFollowScroll {
  duration: number
  frameID: number | null
  fromScrollTop: number
  key: string
  startedAt: number
  targetScrollTop: number
}

interface ThreadViewProps {
  activeProjectID?: string | null
  activeSession: SessionSummary | null
  activeSessionDiff?: SessionDiffSummary | null
  activeMessages: ThreadMessage[]
  assistantTraceVisibility: AssistantTraceVisibility
  composerRefreshVersion?: number
  isAgentDebugTraceEnabled: boolean
  isResolvingPermissionRequest: boolean
  isSessionRunning?: boolean
  messageTree?: SessionMessageTree | null
  onBranchSelect?: (messageID: string) => void | Promise<void>
  onFileChangeSelect?: (file: string) => void
  onForkFromMessage?: (messageID: string) => void | Promise<void>
  onArtifactLinkOpen?: (target: MarkdownArtifactLinkTarget) => void
  onLocalFileLinkOpen?: (target: MarkdownLocalFileLinkTarget) => void
  onOpenSideChat?: (anchorMessageID: string) => void | Promise<void>
  onMessageDiffSummaryHydrate?: (messageID: string, diffSummary: SessionDiffSummary) => void | Promise<void>
  onMessageDiffRestore?: (diffs: SessionDiffFile[]) => void | Promise<void>
  onMessageDiffReview?: (files: string[]) => void | Promise<void>
  pendingConversationInputs?: PendingConversationInput[]
  pendingPermissionRequests: PermissionRequest[]
  permissionRequestActionError: string | null
  permissionRequestActionRequestID: string | null
  sideChatAttachments?: ComposerAttachment[]
  sideChatCountsByAnchorMessageID: Record<string, number>
  sideChatDraftState?: ComposerDraftState
  sideChatIsCancelling?: boolean
  sideChatIsInterruptible?: boolean
  sideChatIsSending?: boolean
  sideChatPendingInputs?: PendingConversationInput[]
  sideChatPendingPermissionRequests?: PermissionRequest[]
  sideChatPermissionRequestActionError?: string | null
  sideChatPermissionRequestActionRequestID?: string | null
  sideChatSession?: SessionSummary | null
  sideChatSessionsByAnchorMessageID?: Record<string, SessionSummary[]>
  sideChatMessages?: ThreadMessage[]
  scrollStateKey?: string | null
  threadColumnRef: RefObject<HTMLDivElement | null>
  isThreadVisible?: boolean
  readScrollSnapshot?: (key: string) => ThreadScrollSnapshot | null
  saveScrollSnapshot?: (key: string, snapshot: ThreadScrollSnapshot) => void
  sideChatPlacement?: "inline" | "external"
  onAskUserQuestionAnswer: QuestionAnswerHandler
  onSideChatDraftStateChange?: (value: ComposerDraftState) => void
  onSideChatPickAttachments?: (input: {
    allowImage: boolean
    allowPdf: boolean
    disabledReason: string | null
  }) => void | Promise<void>
  onSideChatPasteImageAttachments?: (input: {
    allowImage: boolean
    disabledReason: string | null
    images: ComposerPastedImageAttachment[]
  }) => void | Promise<void>
  onSideChatRemoveAttachment?: (path: string) => void
  onSideChatCancelSend?: () => void | Promise<void>
  onSideChatSend?: (input: {
    attachmentError?: string | null
    draftStateOverride?: ComposerDraftState
    questionAnswer?: {
      questionID: string
      selectedOptions?: string[]
      freeformText?: string
    }
    selectedReasoningEffort?: ReasoningEffort | null
    selectedModel?: string | null
    selectedSkillIDs: string[]
    steerQueuedMessageID?: string
    submissionMode?: UserThreadMessage["submissionMode"]
    waitForPendingModelSelection: () => Promise<void>
  }) => void | Promise<void>
  onSessionModelSelectionChange?: (sessionID: string, selection: SessionSummary["modelSelection"] | undefined) => void
  onSideChatCreate?: (anchorMessageID: string) => void | Promise<void>
  onSideChatDelete?: (sessionID: string) => void | Promise<void>
  onProposedPlanConfirm?: ProposedPlanConfirmHandler
  onPermissionRequestResponse: PermissionRequestResponseHandler
  onSideChatSelect?: (sessionID: string) => void | Promise<void>
}

type PermissionRequestResponseHandler = (input: {
  sessionID: string
  request: PermissionRequest
  decision: PermissionDecision
  note?: string
}) => void | Promise<void>

type QuestionAnswerHandler = (input: {
  text: string
  questionID?: string
  sessionID?: string | null
  selectedOptions?: string[]
  freeformText?: string
}) => void | Promise<void>

const IMAGE_LIGHTBOX_BODY_CLASS = "is-image-lightbox-open"
const IMAGE_LIGHTBOX_FOCUSABLE_SELECTOR = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
const IMAGE_LIGHTBOX_MIN_ZOOM = 0.5
const IMAGE_LIGHTBOX_MAX_ZOOM = 4
const PROPOSED_PLAN_OPEN_TAG = "<proposed_plan>"
const PROPOSED_PLAN_CLOSE_TAG = "</proposed_plan>"
const IMAGE_LIGHTBOX_ZOOM_STEP = 0.1
const IMAGE_TALL_RATIO_THRESHOLD = 1.8
const THREAD_BOTTOM_LOCK_THRESHOLD_PX = 32
const THREAD_USER_SCROLL_INTENT_WINDOW_MS = 800
const THREAD_COMPLETION_SCROLL_SYNC_SUPPRESS_MS = 600
const THREAD_TOP_RESET_THRESHOLD_PX = 2
const THREAD_FOLLOW_SMOOTH_SCROLL_MIN_DELTA_PX = 6
const THREAD_FOLLOW_SMOOTH_SCROLL_MAX_DELTA_PX = 420
const THREAD_FOLLOW_SMOOTH_SCROLL_MIN_DURATION_MS = 90
const THREAD_FOLLOW_SMOOTH_SCROLL_MAX_DURATION_MS = 220
const THREAD_FOLLOW_SMOOTH_SCROLL_PX_PER_MS = 2.4
const THREAD_STREAMING_RESPONSE_SELECTOR = ".assistant-section.is-response .trace-item.is-streaming[data-kind=\"text\"]"
const THREAD_AUTO_COLLAPSE_MOTION_MS = 240
const THREAD_VIRTUALIZATION_MIN_ROWS = 80
const THREAD_VIRTUAL_OVERSCAN_PX = 900
const THREAD_VIRTUAL_OVERSCAN_ROWS = 2
const THREAD_VIRTUAL_ROW_GAP_PX = 7
const THREAD_VIRTUAL_ROW_MIN_HEIGHT_PX = 12
const THREAD_VIRTUAL_ROW_MEASURE_EPSILON_PX = 1
const LONG_USER_MESSAGE_CHARACTER_THRESHOLD = COMPOSER_LONG_TEXT_CHARACTER_THRESHOLD
const LONG_USER_MESSAGE_LINE_THRESHOLD = COMPOSER_LONG_TEXT_LINE_THRESHOLD
const SHORT_PROCESS_REASONING_CHARACTER_THRESHOLD = 160
const SHORT_PROCESS_REASONING_LINE_THRESHOLD = 3
const COLLAPSED_USER_MESSAGE_ESTIMATED_CHARACTERS = 640
const TRACE_REASONING_PREVIEW_CHARACTER_LIMIT = 480
const TRACE_PATCH_PREVIEW_CHARACTER_LIMIT = 20000
const TRACE_PATCH_PREVIEW_LINE_LIMIT = 200
const threadScrollSnapshots = new Map<string, ThreadScrollSnapshot>()

interface LatestAssistantMessageState {
  id: string
  isStreaming: boolean
}

type ThreadDisplayRow =
  | {
      estimatedHeight: number
      kind: "user-message"
      rowID: string
      message: UserThreadMessage
      messageIndex: number
    }
  | {
      blocks: AssistantTraceBlock[]
      collapsing: boolean
      estimatedHeight: number
      expanded: boolean
      kind: "process-header"
      rowID: string
      shouldCollapseReasoningAndTools: boolean
      message: AssistantThreadMessage
      messageID: string
      messageIndex: number
    }
  | {
      collapsing: boolean
      estimatedHeight: number
      item: AssistantTraceItem
      itemID: string
      kind: "process-item"
      rowID: string
      section: AssistantTraceSectionKey
      shouldCollapseReasoningAndTools: boolean
      message: AssistantThreadMessage
      messageID: string
      messageIndex: number
    }
  | {
      ephemeralHint: string | null
      estimatedHeight: number
      insertedUserMessages: UserThreadMessage[]
      kind: "assistant-message"
      rowID: string
      processPrefixItems: AssistantTraceItem[]
      renderedItems: AssistantTraceItem[]
      message: AssistantThreadMessage
      messageIndex: number
    }
  | {
      estimatedHeight: number
      kind: "permission-request"
      rowID: string
    }

type ThreadViewUiState = {
  processTraceCollapseMotionByMessageID: Record<string, boolean>
  processTraceExpansionByMessageID: Record<string, boolean>
}

interface AssistantTraceRenderSplit {
  stableItems: AssistantTraceItem[]
  liveItems: AssistantTraceItem[]
  isSplit: boolean
}

interface TraceTextPreview {
  text: string
  isTruncated: boolean
  originalLength: number
}

type PatchPreviewState = "summary" | "preview" | "full"

interface ThreadVirtualLayoutItem {
  height: number
  index: number
  row: ThreadDisplayRow
  top: number
}

interface ThreadVirtualLayout {
  items: ThreadVirtualLayoutItem[]
  totalHeight: number
}

interface ThreadVirtualRange {
  endIndex: number
  items: ThreadVirtualLayoutItem[]
  startIndex: number
}

interface ThreadVirtualViewport {
  height: number
  paddingTop: number
  scrollTop: number
}

interface ThreadVirtualViewportSyncOptions {
  forceCommit?: boolean
}

type ImagePreviewFitMode = "fit-width" | "fit-contain"

interface ImagePreviewPayload {
  src: string
  alt: string
  width?: number
  height?: number
  mimeType?: string
  triggerElement?: HTMLButtonElement | null
}

interface ActiveImagePreview extends ImagePreviewPayload {
  openedAt: number
}

function clampImageZoom(value: number) {
  return Math.min(IMAGE_LIGHTBOX_MAX_ZOOM, Math.max(IMAGE_LIGHTBOX_MIN_ZOOM, Math.round(value * 100) / 100))
}

function isTallImage(width?: number, height?: number) {
  if (!width || !height || width <= 0 || height <= 0) return false
  return height / width >= IMAGE_TALL_RATIO_THRESHOLD
}

function getFocusableElements(container: HTMLElement | null) {
  if (!container) return []
  return Array.from(container.querySelectorAll<HTMLElement>(IMAGE_LIGHTBOX_FOCUSABLE_SELECTOR))
}

function isThreadColumnPinnedToBottom(threadColumn: HTMLDivElement) {
  return threadColumn.scrollHeight - threadColumn.scrollTop - threadColumn.clientHeight <= THREAD_BOTTOM_LOCK_THRESHOLD_PX
}

function getThreadScrollMaxTop(threadColumn: HTMLDivElement) {
  return Math.max(0, threadColumn.scrollHeight - threadColumn.clientHeight)
}

function easeThreadFollowScroll(progress: number) {
  return 1 - Math.pow(1 - progress, 3)
}

function getThreadSmoothFollowScrollDuration(delta: number) {
  return Math.min(
    THREAD_FOLLOW_SMOOTH_SCROLL_MAX_DURATION_MS,
    Math.max(THREAD_FOLLOW_SMOOTH_SCROLL_MIN_DURATION_MS, delta / THREAD_FOLLOW_SMOOTH_SCROLL_PX_PER_MS),
  )
}

function isUsableThreadLayoutRect(rect: DOMRect) {
  return (
    Number.isFinite(rect.top) &&
    Number.isFinite(rect.bottom) &&
    Number.isFinite(rect.height) &&
    rect.height > 0
  )
}

function prefersReducedThreadMotion() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false

  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

function clampThreadScrollTop(threadColumn: HTMLDivElement, scrollTop: number) {
  return Math.min(Math.max(0, scrollTop), getThreadScrollMaxTop(threadColumn))
}

function canRepresentThreadScrollTop(threadColumn: HTMLDivElement, scrollTop: number) {
  return getThreadScrollMaxTop(threadColumn) >= scrollTop - THREAD_TOP_RESET_THRESHOLD_PX
}

function readThreadScrollSnapshot(threadColumn: HTMLDivElement): ThreadScrollSnapshot {
  return {
    scrollTop: threadColumn.scrollTop,
    pinnedToBottom: isThreadColumnPinnedToBottom(threadColumn),
    updatedAt: Date.now(),
  }
}

function readLatestAssistantMessageState(messages: ThreadMessage[]): LatestAssistantMessageState | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.kind === "assistant") return { id: message.id, isStreaming: Boolean(message.isStreaming) }
  }

  return null
}

function readAssistantMessageOrderTimestamp(message: AssistantThreadMessage) {
  const traceTimestamps = message.items
    .filter((item) => !item.sourceID?.endsWith(":prompt") && item.kind !== "system")
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

  for (let index = 0; index < orderedMessages.length; index += 1) {
    if (orderedMessages[index]?.kind === "assistant") {
      if (assistantBlockStart < 0) assistantBlockStart = index
      continue
    }

    flushAssistantBlock(index)
  }

  flushAssistantBlock(orderedMessages.length)
  return orderedMessages
}

function resolveAssistantSideChatAnchorMessageID(messages: ThreadMessage[], message: AssistantThreadMessage) {
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

function readThreadColumnPaddingTop(threadColumn: HTMLDivElement) {
  if (typeof window === "undefined") return 0

  const value = Number.parseFloat(window.getComputedStyle(threadColumn).paddingTop)
  return Number.isFinite(value) ? value : 0
}

function readThreadColumnPaddingBottom(threadColumn: HTMLDivElement) {
  if (typeof window === "undefined") return 0

  const value = Number.parseFloat(window.getComputedStyle(threadColumn).paddingBottom)
  return Number.isFinite(value) ? value : 0
}

function getStreamingResponseScrollTarget(threadColumn: HTMLDivElement): ThreadFollowScrollTarget | null {
  const columnRect = threadColumn.getBoundingClientRect()
  if (!isUsableThreadLayoutRect(columnRect)) return null

  const candidates = Array.from(
    threadColumn.querySelectorAll<HTMLElement>(THREAD_STREAMING_RESPONSE_SELECTOR),
  ).reverse()

  for (const element of candidates) {
    if (element.closest(".thread-column") !== threadColumn) continue
    if (!element.closest(".assistant-message[data-thread-message-id]")) continue

    const elementRect = element.getBoundingClientRect()
    if (!isUsableThreadLayoutRect(elementRect)) continue

    const viewportBottom = columnRect.bottom - readThreadColumnPaddingBottom(threadColumn)
    const scrollTop = Math.max(0, threadColumn.scrollTop + elementRect.bottom - viewportBottom)

    return {
      scrollTop,
      visualScrollTop: scrollTop,
    }
  }

  return null
}

function buildThreadVirtualLayout(rows: ThreadDisplayRow[], measuredHeights: Map<string, number>): ThreadVirtualLayout {
  const items: ThreadVirtualLayoutItem[] = []
  let top = 0

  rows.forEach((row, index) => {
    const measuredHeight = measuredHeights.get(row.rowID)
    const height = Math.max(THREAD_VIRTUAL_ROW_MIN_HEIGHT_PX, measuredHeight ?? row.estimatedHeight)
    items.push({
      height,
      index,
      row,
      top,
    })
    top += height
    if (index < rows.length - 1) {
      top += THREAD_VIRTUAL_ROW_GAP_PX
    }
  })

  return {
    items,
    totalHeight: top,
  }
}

function findThreadVirtualRange(layout: ThreadVirtualLayout, viewport: ThreadVirtualViewport): ThreadVirtualRange {
  if (layout.items.length === 0) {
    return {
      endIndex: 0,
      items: [],
      startIndex: 0,
    }
  }

  const viewportTop = Math.max(0, viewport.scrollTop - viewport.paddingTop)
  const startOffset = Math.max(0, viewportTop - THREAD_VIRTUAL_OVERSCAN_PX)
  const endOffset = viewportTop + Math.max(0, viewport.height) + THREAD_VIRTUAL_OVERSCAN_PX
  let startIndex = layout.items.findIndex((item) => item.top + item.height >= startOffset)
  if (startIndex === -1) startIndex = layout.items.length - 1

  let endIndex = startIndex
  while (endIndex < layout.items.length && layout.items[endIndex]!.top <= endOffset) {
    endIndex += 1
  }

  startIndex = Math.max(0, startIndex - THREAD_VIRTUAL_OVERSCAN_ROWS)
  endIndex = Math.min(layout.items.length, endIndex + THREAD_VIRTUAL_OVERSCAN_ROWS)

  return {
    endIndex,
    items: layout.items.slice(startIndex, endIndex),
    startIndex,
  }
}

function readResizeEntryBlockSize(entry: ResizeObserverEntry) {
  const borderBoxSize = Array.isArray(entry.borderBoxSize)
    ? entry.borderBoxSize[0]
    : entry.borderBoxSize
  const height = borderBoxSize?.blockSize ?? entry.contentRect?.height

  return Number.isFinite(height) ? height : null
}

function estimateAssistantTraceItemHeight(item: AssistantTraceItem) {
  const textLength = `${item.title ?? ""}${item.text ?? ""}${item.detail ?? ""}`.length
  const textHeight = Math.min(320, Math.max(42, Math.ceil(textLength / 110) * 22))
  const kindHeight =
    item.kind === "tool" || item.kind === "patch" || item.kind === "file" || item.kind === "image"
      ? 84
      : item.kind === "reasoning"
        ? 58
        : 48
  const draftPatchFileCount = normalizeTraceFileChanges(item.draftPatch?.fileChanges).length
  const draftPatchHeight = draftPatchFileCount > 0 ? Math.min(220, Math.max(48, draftPatchFileCount * 28 + 34)) : 0
  return Math.max(kindHeight + draftPatchHeight, textHeight)
}

function estimateAssistantThreadRowHeight(row: {
  ephemeralHint: string | null
  insertedUserMessages: UserThreadMessage[]
  renderedItems: AssistantTraceItem[]
  message: AssistantThreadMessage
}) {
  if (row.ephemeralHint) return 96 + row.insertedUserMessages.length * 92

  const itemEstimate = row.renderedItems.reduce((height, item) => height + estimateAssistantTraceItemHeight(item), 64)

  return Math.max(row.message.isStreaming ? 180 : 140, itemEstimate + row.insertedUserMessages.length * 92)
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

function buildThreadDisplayRows({
  activeSession,
  activeMessages,
  assistantTraceVisibility,
  isResolvingPermissionRequest,
  pendingPermissionRequests,
  uiState,
}: {
  activeSession: SessionSummary | null
  activeMessages: ThreadMessage[]
  assistantTraceVisibility: AssistantTraceVisibility
  isResolvingPermissionRequest: boolean
  pendingPermissionRequests: PermissionRequest[]
  uiState: ThreadViewUiState
}): ThreadDisplayRow[] {
  if (!activeSession) return []

  const rows: ThreadDisplayRow[] = []
  activeMessages.forEach((message, messageIndex) => {
    if (message.kind === "user") {
      if (hasStreamInsertionTarget(activeMessages, message)) return

      rows.push({
        estimatedHeight: estimateUserThreadRowHeight(message),
        kind: "user-message",
        rowID: message.id,
        message: message,
        messageIndex,
      })
      return
    }

    if (shouldFoldAssistantMessageIntoFinalRunTrace(activeMessages, messageIndex, message)) return

    const processPrefixItems = collectAssistantRunProcessPrefixItems(
      activeMessages,
      messageIndex,
      assistantTraceVisibility,
    )
    const insertedUserMessages = getAssistantStreamInsertionUserMessages(activeMessages, message)
    const renderedItems = filterRenderedAssistantTraceItems(
      message.items,
      !message.isStreaming,
      assistantTraceVisibility,
    )
    const ephemeralHint = renderedItems.length === 0 ? getAssistantEphemeralHint(message) : null
    if (renderedItems.length === 0 && !ephemeralHint && insertedUserMessages.length === 0) return

    const shouldCollapseReasoningAndTools = canCollapseAssistantProcessTrace(message)
    const traceDisplayBlocks = buildAssistantTraceDisplayBlocks({
      items: message.items,
      processPrefixItems,
      showFileChanges: !message.isStreaming,
      shouldCollapseReasoningAndTools,
      traceVisibility: assistantTraceVisibility,
    })
    const processTraceCollapsing = Boolean(uiState.processTraceCollapseMotionByMessageID[message.id])
    const processTraceExpanded =
      (uiState.processTraceExpansionByMessageID[message.id] ?? !shouldCollapseReasoningAndTools) && !processTraceCollapsing

    if (!ephemeralHint && traceDisplayBlocks.shouldRenderProcessTrace) {
      rows.push({
        blocks: traceDisplayBlocks.processBlocks,
        collapsing: processTraceCollapsing,
        estimatedHeight: 34,
        expanded: processTraceExpanded,
        kind: "process-header",
        rowID: `process-header:${message.id}`,
        shouldCollapseReasoningAndTools,
        message: message,
        messageID: message.id,
        messageIndex,
      })

      if (processTraceExpanded || processTraceCollapsing) {
        traceDisplayBlocks.processBlocks.forEach((block, blockIndex) => {
          getAssistantTraceBlockRenderedItems(block).forEach((item, itemIndex) => {
            rows.push({
              collapsing: processTraceCollapsing,
              estimatedHeight: estimateAssistantTraceItemHeight(item),
              item,
              itemID: item.id,
              kind: "process-item",
              rowID: `process-item:${message.id}:${blockIndex}:${item.id}:${itemIndex}`,
              section: block.sectionKey,
              shouldCollapseReasoningAndTools,
              message: message,
              messageID: message.id,
              messageIndex,
            })
          })
        })
      }
    }

    const assistantRenderedItems = traceDisplayBlocks.shouldRenderProcessTrace
      ? flattenAssistantTraceBlockItems(traceDisplayBlocks.mainBlocks)
      : renderedItems

    rows.push({
      ephemeralHint,
      estimatedHeight: estimateAssistantThreadRowHeight({
        ephemeralHint,
        insertedUserMessages,
        renderedItems: assistantRenderedItems,
        message: message,
      }),
      insertedUserMessages,
        kind: "assistant-message",
      processPrefixItems,
      renderedItems: assistantRenderedItems,
      rowID: message.id,
      message: message,
      messageIndex,
    })
  })

  const pendingRequestID = pendingPermissionRequests[0]?.id
  if (pendingRequestID && !isResolvingPermissionRequest) {
    rows.push({
      estimatedHeight: 420,
      kind: "permission-request",
      rowID: `permission-request:${pendingRequestID}`,
    })
  }

  return rows
}

function isSidebarResizeInProgress() {
  return typeof document !== "undefined" && document.body.classList.contains("is-resizing-sidebar")
}

function useSidebarResizeLightweightMode() {
  const [isResizeLightweightMode, setIsResizeLightweightMode] = useState(() => isSidebarResizeInProgress())

  useEffect(() => {
    if (typeof document === "undefined") return

    const syncResizeLightweightMode = () => {
      setIsResizeLightweightMode(isSidebarResizeInProgress())
    }

    syncResizeLightweightMode()

    if (typeof MutationObserver === "undefined") return

    const observer = new MutationObserver(syncResizeLightweightMode)
    observer.observe(document.body, { attributes: true, attributeFilter: ["class"] })
    return () => observer.disconnect()
  }, [])

  return isResizeLightweightMode
}

function getRestorableThreadScrollSnapshot(snapshot: ThreadScrollSnapshot | null) {
  if (!snapshot) return null
  if (snapshot.pinnedToBottom || snapshot.scrollTop <= THREAD_TOP_RESET_THRESHOLD_PX) return null
  return snapshot
}

function getUserMessageBodyText(message: UserThreadMessage) {
  const displayText = message.displayText?.trim() || ""
  const references = message.references ?? []

  return displayText || (references.length > 0 ? references.map((reference) => `@${reference.label}`).join(" ") : message.text)
}

function countTextLines(text: string) {
  if (!text) return 0
  return text.split(/\r\n|\r|\n/).length
}

function shouldCollapseUserMessageText(text: string) {
  return text.length >= LONG_USER_MESSAGE_CHARACTER_THRESHOLD || countTextLines(text) >= LONG_USER_MESSAGE_LINE_THRESHOLD
}

function CollapsibleUserMessageText({
  references,
  text,
}: {
  references?: UserThreadMessage["references"]
  text: string
}) {
  const contentID = useId()
  const contentRef = useRef<HTMLDivElement | null>(null)
  const isCollapsible = shouldCollapseUserMessageText(text)
  const [isExpanded, setIsExpanded] = useState(false)

  useEffect(() => {
    setIsExpanded(false)
  }, [isCollapsible, text])

  function handleToggle() {
    const nextExpanded = !isExpanded
    setIsExpanded(nextExpanded)

    if (nextExpanded) {
      const scrollExpandedMessageToEnd = () => {
        contentRef.current?.scrollIntoView?.({ block: "end", inline: "nearest" })
      }
      if (typeof window.requestAnimationFrame === "function") {
        window.requestAnimationFrame(scrollExpandedMessageToEnd)
      } else {
        window.setTimeout(scrollExpandedMessageToEnd, 0)
      }
    }
  }

  return (
    <>
      <div
        ref={contentRef}
        id={contentID}
        className={joinClassNames(
          "user-bubble-text-frame",
          isCollapsible && "is-collapsible",
          isCollapsible && !isExpanded && "is-collapsed",
          isCollapsible && isExpanded && "is-expanded",
        )}
      >
        <ThreadRichText as="div" className="user-bubble-text" references={references} text={text} />
      </div>
      {isCollapsible ? (
        <button
          className="user-bubble-collapse-button"
          type="button"
          aria-controls={contentID}
          aria-expanded={isExpanded}
          title={isExpanded ? "Collapse message" : "Show full message and jump to the end"}
          onClick={handleToggle}
        >
          {isExpanded ? <ChevronRightIcon /> : <ChevronDownIcon />}
          <span>{isExpanded ? "Collapse message" : "Show full message"}</span>
        </button>
      ) : null}
    </>
  )
}

function UserThreadMessageBubble({ message }: { message: UserThreadMessage }) {
  const displayText = message.displayText?.trim() || ""
  const references = message.references ?? []
  const attachments = message.attachments ?? []
  const hasStructuredContent = Boolean(displayText) || references.length > 0 || attachments.length > 0
  const bodyText = getUserMessageBodyText(message)
  const steerNote = message.submissionMode === "steer"
    ? (
        <div className="user-bubble-steer-note" aria-label="Submitted while the agent is running">
          <span>提交，但不中断模型运行</span>
          <span>下次模型/工具调用后</span>
        </div>
      )
    : null

  if (!hasStructuredContent && !steerNote) {
    return (
      <div className="user-bubble">
        <CollapsibleUserMessageText text={message.text} />
      </div>
    )
  }

  return (
    <div className="user-bubble">
      <div className="user-bubble-content">
        <CollapsibleUserMessageText references={references} text={bodyText} />
        {steerNote}

        {attachments.length > 0 ? (
          <div className="user-bubble-chip-strip" aria-label="Sent attachments">
            {attachments.map((attachment, index) => (
              <div
                key={`${attachment.path ?? attachment.name}:${index}`}
                className="user-bubble-chip user-bubble-attachment-chip"
              >
                <PaperclipIcon />
                <span className="user-bubble-chip-label" title={attachment.path ?? attachment.name}>
                  {attachment.name}
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}

const UserThreadMessageArticle = memo(function UserThreadMessageArticle({
  className,
  copied,
  diffCard,
  message,
  motion,
  onCopy,
}: {
  className?: string
  copied: boolean
  diffCard?: ReactNode
  motion: ThreadMessageMotion
  onCopy: (messageID: string, text: string) => void | Promise<void>
  message: UserThreadMessage
}) {
  const userCopyText = getUserMessageBodyText(message).trim()

  return (
    <article
      className={joinClassNames("thread-message user-message", className)}
      data-thread-message-id={message.id}
      data-thread-message-motion={motion}
    >
      <div className="thread-message-meta">
        <span>You</span>
        <time>{formatTime(message.timestamp)}</time>
      </div>
      <UserThreadMessageBubble message={message} />
      {diffCard}
      {userCopyText ? (
        <div className="user-message-actions">
          <button
            className={joinClassNames(
              "message-action-icon-button user-message-action-button",
              copied && "is-active",
            )}
            type="button"
            aria-label={copied ? "Copied user message" : "Copy user message"}
            title={copied ? "Copied" : "Copy"}
            onClick={() => void onCopy(message.id, userCopyText)}
          >
            <CopyIcon />
          </button>
        </div>
      ) : null}
    </article>
  )
})

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

function buildLargeStringSignature(value: string | undefined) {
  if (!value) return ""
  if (value.length <= 160) return value
  return `${value.length}:${value.slice(0, 80)}:${value.slice(-80)}`
}

function buildFileChangeSignature(change: Pick<AssistantTraceFileChange, "additions" | "deletions" | "file" | "patch">) {
  return `${change.file}\u0000${change.additions}\u0000${change.deletions}\u0000${buildLargeStringSignature(change.patch)}`
}

function hydrateUserMessageFileChangesFromPatchSources(
  fileChanges: AssistantTraceFileChange[],
  patchSourceFileChanges: AssistantTraceFileChange[],
) {
  if (patchSourceFileChanges.length === 0) return fileChanges

  const patchEntries = patchSourceFileChanges
      .filter((change) => change.file.trim() && change.patch?.trim())
      .map((change) => [change.file, change.patch ?? ""] as const)
  if (patchEntries.length === 0) return fileChanges

  const patchByFile = new Map<string, string>()
  for (const [file, patch] of patchEntries) {
    const existingPatch = patchByFile.get(file)
    patchByFile.set(file, existingPatch ? `${existingPatch}\n${patch}` : patch)
  }

  return fileChanges.map((change) => {
    if (change.patch?.trim()) return change

    const patch = patchByFile.get(change.file)
    return patch ? { ...change, patch } : change
  })
}

function hydrateUserMessageFileChangesFromWorkspaceDiff(
  fileChanges: AssistantTraceFileChange[],
  activeSessionDiff?: SessionDiffSummary | null,
) {
  if (!activeSessionDiff?.diffs.length) return fileChanges

  return hydrateUserMessageFileChangesFromPatchSources(fileChanges, activeSessionDiff.diffs)
}

function collectAssistantPatchFileChanges(assistantMessage: AssistantThreadMessage | null): AssistantTraceFileChange[] {
  if (!assistantMessage) return []

  return assistantMessage.items.flatMap((item) =>
    item.fileChanges?.filter((change) => change.file.trim() && change.patch?.trim()) ?? [],
  )
}

function buildHydratedUserMessageDiffSummary(
  diffSummary: SessionDiffSummary | undefined,
  fileChanges: AssistantTraceFileChange[],
): SessionDiffSummary | null {
  if (!diffSummary?.diffs.length) return null

  const patchByFile = new Map(
    fileChanges
      .filter((change) => change.file.trim() && change.patch?.trim())
      .map((change) => [change.file, change.patch ?? ""] as const),
  )
  if (patchByFile.size === 0) return null

  let didHydrate = false
  const diffs = diffSummary.diffs.map((diff) => {
    if (diff.patch?.trim()) return diff

    const patch = patchByFile.get(diff.file)
    if (!patch) return diff

    didHydrate = true
    return {
      ...diff,
      patch,
    }
  })

  return didHydrate ? { ...diffSummary, diffs } : null
}

function buildDiffSummarySignature(diffSummary: SessionDiffSummary | null) {
  return diffSummary?.diffs
    .map(buildFileChangeSignature)
    .join("\u0001") ?? ""
}

function summarizeUserMessageDiffStats(
  diffSummary: SessionDiffSummary | undefined,
  fileChanges: AssistantTraceFileChange[],
) {
  const fallback = fileChanges.reduce(
    (stats, change) => ({
      additions: stats.additions + change.additions,
      deletions: stats.deletions + change.deletions,
      files: stats.files + 1,
    }),
    { additions: 0, deletions: 0, files: 0 },
  )
  const stats = diffSummary?.stats ?? fallback

  return {
    additions: stats.additions,
    deletions: stats.deletions,
    files: stats.files > 0 ? stats.files : fallback.files,
  }
}

function formatUserMessageDiffSummaryLabel(fileCount: number) {
  return `${fileCount} 个文件已更改`
}

function MessageDiffCard({
  onFileChangeSelect,
  activeSessionDiff,
  allowWorkspaceDiffFallback = false,
  onMessageDiffSummaryHydrate,
  patchSourceFileChanges = [],
  onMessageDiffRestore,
  onMessageDiffReview,
  diffSummary,
  messageID,
}: {
  activeSessionDiff?: SessionDiffSummary | null
  allowWorkspaceDiffFallback?: boolean
  diffSummary?: SessionDiffSummary
  onFileChangeSelect?: (file: string) => void
  onMessageDiffSummaryHydrate?: (messageID: string, diffSummary: SessionDiffSummary) => void | Promise<void>
  patchSourceFileChanges?: AssistantTraceFileChange[]
  onMessageDiffRestore?: (diffs: SessionDiffFile[]) => void | Promise<void>
  onMessageDiffReview?: (files: string[]) => void | Promise<void>
  messageID: string
}) {
  const fileChangesFromPatchSources = hydrateUserMessageFileChangesFromPatchSources(
    normalizeMessageDiffSummary(diffSummary),
    patchSourceFileChanges,
  )
  const fileChanges = allowWorkspaceDiffFallback
    ? hydrateUserMessageFileChangesFromWorkspaceDiff(fileChangesFromPatchSources, activeSessionDiff)
    : fileChangesFromPatchSources
  const fileChangeSignature = fileChanges
    .map(buildFileChangeSignature)
    .join("\u0001")
  const [isListExpanded, setIsListExpanded] = useState(true)
  const [expandedFile, setExpandedFile] = useState<string | null>(null)
  const [fullHeightFile, setFullHeightFile] = useState<string | null>(null)
  const [isRestoring, setIsRestoring] = useState(false)
  const [actionErrorMessage, setActionErrorMessage] = useState<string | null>(null)
  const hydratedDiffSummary = buildHydratedUserMessageDiffSummary(diffSummary, fileChanges)
  const hydratedDiffSummarySignature = buildDiffSummarySignature(hydratedDiffSummary)

  useEffect(() => {
    setIsListExpanded(true)
    setExpandedFile(null)
    setFullHeightFile(null)
    setIsRestoring(false)
    setActionErrorMessage(null)
  }, [fileChangeSignature, messageID])

  useEffect(() => {
    if (!hydratedDiffSummary) return
    void onMessageDiffSummaryHydrate?.(messageID, hydratedDiffSummary)
  }, [hydratedDiffSummarySignature, onMessageDiffSummaryHydrate, messageID])

  if (fileChanges.length === 0) return null

  const stats = summarizeUserMessageDiffStats(diffSummary, fileChanges)
  const listID = `user-message-diff-list-${messageID}`
  const summaryLabel = formatUserMessageDiffSummaryLabel(stats.files)
  const filePaths = fileChanges.map((change) => change.file)

  const handleListToggle = () => {
    const nextIsListExpanded = !isListExpanded
    setIsListExpanded(nextIsListExpanded)
    if (!nextIsListExpanded) {
      setExpandedFile(null)
      setFullHeightFile(null)
    }
  }

  const handleReviewClick = async () => {
    if (!onMessageDiffReview) return

    setActionErrorMessage(null)
    try {
      await onMessageDiffReview(filePaths)
    } catch (error) {
      setActionErrorMessage(error instanceof Error ? error.message : String(error))
    }
  }

  const handleRestoreClick = async () => {
    if (!onMessageDiffRestore || isRestoring) return
    const confirmed = window.confirm(
      `尝试反向应用这 ${stats.files} 个文件的变更？不能自动撤销的文件会提示失败，已成功撤销的文件会保留结果。`,
    )
    if (!confirmed) return

    setIsRestoring(true)
    setActionErrorMessage(null)
    try {
      await onMessageDiffRestore(fileChanges)
    } catch (error) {
      setActionErrorMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setIsRestoring(false)
    }
  }

  return (
    <div className="user-message-diff-card">
      <div className="user-message-diff-card-header">
        <button
          type="button"
          className="user-message-diff-card-summary"
          aria-expanded={isListExpanded}
          aria-controls={listID}
          onClick={handleListToggle}
        >
          <span className="user-message-diff-card-title">{summaryLabel}</span>
          <span className="user-message-diff-stats" aria-label={`${stats.additions} additions, ${stats.deletions} deletions`}>
            <span className="is-add">+{stats.additions}</span>
            <span className="is-remove">-{stats.deletions}</span>
          </span>
        </button>
        <div className="user-message-diff-actions" aria-label="Message file change actions">
          <button
            type="button"
            className="user-message-diff-action"
            disabled={!onMessageDiffRestore || isRestoring}
            onClick={() => void handleRestoreClick()}
          >
            <span>{isRestoring ? "撤销中" : "撤销"}</span>
            <ResetIcon />
          </button>
          <button
            type="button"
            className="user-message-diff-action"
            disabled={!onMessageDiffReview}
            onClick={() => void handleReviewClick()}
          >
            <span>审核</span>
            <span aria-hidden="true">↗</span>
          </button>
          <button
            type="button"
            className="user-message-diff-expand"
            aria-label={isListExpanded ? "收起文件变更" : "展开文件变更"}
            aria-expanded={isListExpanded}
            aria-controls={listID}
            onClick={handleListToggle}
          >
            {isListExpanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
          </button>
        </div>
      </div>
      {isListExpanded ? (
        <div id={listID} className="user-message-diff-file-list">
          {fileChanges.map((change, changeIndex) => {
            const hasPatch = Boolean(change.patch?.trim())
            const isExpanded = expandedFile === change.file
            const previewID = `user-message-diff-preview-${messageID}-${changeIndex}`
            const rowContent = (
              <>
                <span className="user-message-diff-file-path">{change.file}</span>
                <span className="user-message-diff-stats" aria-label={`${change.additions} additions, ${change.deletions} deletions`}>
                  <span className="is-add">+{change.additions}</span>
                  <span className="is-remove">-{change.deletions}</span>
                </span>
                <span className="user-message-diff-file-chevron" aria-hidden="true">
                  {hasPatch ? (isExpanded ? <ChevronDownIcon /> : <ChevronRightIcon />) : <ChevronDownIcon />}
                </span>
              </>
            )

            return (
              <div key={`${messageID}-${change.file}-${changeIndex}`} className="user-message-diff-file-entry">
                {hasPatch ? (
                  <button
                    type="button"
                    className="user-message-diff-file-row"
                    aria-label={`${isExpanded ? "收起" : "展开"} ${change.file} 变更`}
                    aria-expanded={isExpanded}
                    aria-controls={previewID}
                    title={change.file}
                    onClick={() => setExpandedFile((current) => current === change.file ? null : change.file)}
                  >
                    {rowContent}
                  </button>
                ) : onFileChangeSelect ? (
                  <button
                    type="button"
                    className="user-message-diff-file-row"
                    aria-label={`审核 ${change.file}`}
                    title={change.file}
                    onClick={() => onFileChangeSelect(change.file)}
                  >
                    {rowContent}
                  </button>
                ) : (
                  <div className="user-message-diff-file-row is-static" title={change.file}>
                    {rowContent}
                  </div>
                )}
                {hasPatch && isExpanded ? (
                  <div id={previewID} className="user-message-diff-file-preview">
                    <DiffPreview
                      className="trace-historical-diff user-message-historical-diff"
                      emptyClassName="trace-historical-diff-empty user-message-historical-diff-empty"
                      file={change.file}
                      isFullHeight={fullHeightFile === change.file}
                      onToggleFullHeight={() =>
                        setFullHeightFile((current) => current === change.file ? null : change.file)
                      }
                      patch={change.patch}
                      viewMode="unified"
                    />
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      ) : null}
      {actionErrorMessage ? (
        <p className="user-message-diff-error" role="alert">{actionErrorMessage}</p>
      ) : null}
    </div>
  )
}

function hasUserMessageDiffSummary(message: UserThreadMessage) {
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

function getAssistantTrailingUserDiffMessage(messages: ThreadMessage[], assistantIndex: number, assistantMessage: AssistantThreadMessage) {
  if (assistantMessage.isStreaming || hasFollowingAssistantBeforeNextUser(messages, assistantIndex)) return null

  const userMessage = findPreviousUserMessage(messages, assistantIndex)
  if (!userMessage || !hasUserMessageDiffSummary(userMessage)) return null

  return userMessage
}

function shouldRenderDiffOnStandaloneUserMessage(messages: ThreadMessage[], userIndex: number, message: UserThreadMessage) {
  return hasUserMessageDiffSummary(message) && !hasFollowingAssistantBeforeNextUser(messages, userIndex)
}

function isAssistantLatestRenderableMessage(messages: ThreadMessage[], assistantIndex: number, assistantMessage: AssistantThreadMessage) {
  if (assistantIndex === messages.length - 1) return true

  const followingMessages = messages.slice(assistantIndex + 1)
  return followingMessages.length > 0 &&
    followingMessages.every(
      (message) => message.kind === "user" && message.streamInsertion?.assistantThreadMessageID === assistantMessage.id,
    )
}

function isAssistantFinalMessageInUserMessage(messages: ThreadMessage[], assistantIndex: number, assistantMessage: AssistantThreadMessage) {
  for (let index = assistantIndex + 1; index < messages.length; index += 1) {
    const candidate = messages[index]
    if (candidate.kind === "user" && candidate.streamInsertion?.assistantThreadMessageID !== assistantMessage.id) return true
    if (candidate.kind === "assistant") return false
  }

  return true
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

function assistantMessageHasTextResponse(message: AssistantThreadMessage) {
  return message.items.some(
    (item) => traceSectionKeyForItem(item) === "response" && item.kind === "text" && Boolean(item.text?.trim()),
  )
}

function isTerminalAssistantMessagePhase(phase: AssistantThreadMessagePhase) {
  return phase === "completed" || phase === "failed" || phase === "cancelled"
}

function canCollapseAssistantProcessTrace(message: AssistantThreadMessage) {
  return !message.isStreaming && isTerminalAssistantMessagePhase(message.runtime.phase)
}

function buildAssistantProcessTraceCollapseEligibilityByMessageID(messages: ThreadMessage[]) {
  const result: Record<string, boolean> = {}
  messages.forEach((message) => {
    if (message.kind !== "assistant") return
    result[message.id] = canCollapseAssistantProcessTrace(message)
  })
  return result
}

function shouldFoldAssistantMessageIntoFinalRunTrace(messages: ThreadMessage[], assistantIndex: number, message: AssistantThreadMessage) {
  const finalAssistantIndex = findAssistantRunFinalMessageIndex(messages, assistantIndex)
  if (finalAssistantIndex <= assistantIndex) return false

  const finalMessage = messages[finalAssistantIndex]
  if (finalMessage?.kind !== "assistant") return false
  if (!canCollapseAssistantProcessTrace(finalMessage) || !assistantMessageHasTextResponse(finalMessage)) return false

  return canCollapseAssistantProcessTrace(message) || Boolean(message.isStreaming)
}

function collectAssistantRunProcessPrefixItems(
  messages: ThreadMessage[],
  finalAssistantIndex: number,
  traceVisibility: AssistantTraceVisibility,
) {
  const runStartIndex = findAssistantRunStartIndex(messages, finalAssistantIndex)
  const items: AssistantTraceItem[] = []

  for (let index = runStartIndex; index < finalAssistantIndex; index += 1) {
    const message = messages[index]
    if (message?.kind !== "assistant") continue
    if (!shouldFoldAssistantMessageIntoFinalRunTrace(messages, index, message)) continue
    items.push(...filterRenderedAssistantTraceItems(message.items, true, traceVisibility))
  }

  return items
}

const primaryPermissionDecisions: PermissionDecision[] = ["deny", "allow"]

function formatPermissionRiskLabel(risk: PermissionRequest["prompt"]["risk"]) {
  return `${risk} risk`
}

function formatPermissionDecisionLabel(decision: PermissionDecision) {
  switch (decision) {
    case "allow":
      return "Allow"
    case "deny":
      return "Deny"
  }
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

function traceVisibilityKeyForItem(item: AssistantTraceItem): AssistantTraceVisibilityKey | null {
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

function traceSectionKeyForItem(item: AssistantTraceItem): AssistantTraceSectionKey {
  return item.section ?? defaultTraceSectionKeyForItem(item)
}

function traceSectionTitle(sectionKey: AssistantTraceSectionKey) {
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

interface AssistantTraceBlock {
  sectionKey: AssistantTraceSectionKey
  title: string
  items: AssistantTraceItem[]
}

function buildAssistantTraceBlocks(items: AssistantTraceItem[]) {
  return items.reduce<AssistantTraceBlock[]>(
    (blocks, item) => {
      const sectionKey = traceSectionKeyForItem(item)
      if (sectionKey === "file-change") {
        const fileChangeBlock = blocks.find((block) => block.sectionKey === "file-change")
        if (fileChangeBlock) {
          fileChangeBlock.items.push(item)
          return blocks
        }

        blocks.push({
          sectionKey,
          title: traceSectionTitle(sectionKey),
          items: [item],
        })
        return blocks
      }

      const fileChangeBlockIndex = blocks.findIndex((block) => block.sectionKey === "file-change")
      const insertIndex = fileChangeBlockIndex === -1 ? blocks.length : fileChangeBlockIndex
      const previousBlock = blocks[insertIndex - 1]

      if (previousBlock && previousBlock.sectionKey === sectionKey) {
        previousBlock.items.push(item)
        return blocks
      }

      blocks.splice(insertIndex, 0, {
        sectionKey,
        title: traceSectionTitle(sectionKey),
        items: [item],
      })
      return blocks
    },
    [],
  )
}

interface AssistantTraceDisplayBlocks {
  blocks: AssistantTraceBlock[]
  mainBlocks: AssistantTraceBlock[]
  processBlocks: AssistantTraceBlock[]
  shouldRenderProcessTrace: boolean
}

function getAssistantTraceBlockRenderedItems(block: AssistantTraceBlock) {
  return block.sectionKey === "file-change" ? summarizeFileChangeItems(block.items) : block.items
}

function flattenAssistantTraceBlockItems(blocks: AssistantTraceBlock[]) {
  return blocks.flatMap((block) => getAssistantTraceBlockRenderedItems(block))
}

function countNonEmptyTraceLines(value?: string) {
  return value?.split(/\r?\n/).filter((line) => line.trim()).length ?? 0
}

function isSingleShortReasoningProcessTrace(blocks: AssistantTraceBlock[], hasProcessPrefix: boolean) {
  if (hasProcessPrefix) return false

  const items = blocks.flatMap((block) => block.items)
  if (items.length !== 1) return false

  const item = items[0]
  if (!item || item.kind !== "reasoning" || traceSectionKeyForItem(item) !== "reasoning") return false
  if (
    item.toolInputText?.trim() ||
    item.toolOutputText?.trim() ||
    item.draftPatch ||
    item.fileChanges?.length ||
    item.filePaths?.length ||
    item.src ||
    item.progressItems?.length ||
    item.debugEntries?.length
  ) {
    return false
  }

  const contentParts = [item.text, item.detail].map((part) => part?.trim()).filter((part): part is string => Boolean(part))
  const characterCount = contentParts.join("\n").length
  const lineCount = countNonEmptyTraceLines(item.text) + countNonEmptyTraceLines(item.detail)
  return characterCount <= SHORT_PROCESS_REASONING_CHARACTER_THRESHOLD && lineCount <= SHORT_PROCESS_REASONING_LINE_THRESHOLD
}

function buildAssistantTraceDisplayBlocks({
  items,
  processPrefixItems = [],
  showFileChanges,
  shouldCollapseReasoningAndTools,
  traceVisibility,
}: {
  items: AssistantTraceItem[]
  processPrefixItems?: AssistantTraceItem[]
  showFileChanges: boolean
  shouldCollapseReasoningAndTools: boolean
  traceVisibility: AssistantTraceVisibility
}): AssistantTraceDisplayBlocks {
  const blocks = buildAssistantTraceBlocks(filterRenderedAssistantTraceItems(items, showFileChanges, traceVisibility))
  const finalResponseBlockIndex = shouldCollapseReasoningAndTools ? findFinalResponseBlockIndex(blocks) : -1
  const processPrefixBlocks = processPrefixItems.length > 0 ? buildAssistantTraceBlocks(processPrefixItems) : []
  const processTraceCandidateBlocks =
    finalResponseBlockIndex >= 0 && (finalResponseBlockIndex > 0 || processPrefixBlocks.length > 0)
      ? [...processPrefixBlocks, ...blocks.slice(0, finalResponseBlockIndex)]
      : []
  const shouldInlineShortReasoningProcessTrace = isSingleShortReasoningProcessTrace(
    processTraceCandidateBlocks,
    processPrefixBlocks.length > 0,
  )
  const shouldRenderProcessTrace = processTraceCandidateBlocks.length > 0 && !shouldInlineShortReasoningProcessTrace
  const processBlocks = shouldRenderProcessTrace
    ? processTraceCandidateBlocks
    : []
  const mainBlocks = shouldRenderProcessTrace ? blocks.slice(finalResponseBlockIndex) : blocks

  return {
    blocks,
    mainBlocks,
    processBlocks,
    shouldRenderProcessTrace,
  }
}

function filterRenderedAssistantTraceItems(
  items: AssistantTraceItem[],
  showFileChanges: boolean,
  traceVisibility: AssistantTraceVisibility,
) {
  return items.filter((item) => {
    const sectionKey = traceSectionKeyForItem(item)
    if (!showFileChanges && sectionKey === "file-change") return false
    const visibilityKey = traceVisibilityKeyForItem(item)
    if (visibilityKey === null) return true
    if (!traceVisibility[visibilityKey]) return false
    return true
  })
}

function buildAssistantResponseCopyText(items: AssistantTraceItem[]) {
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

function getLastAssistantResponseSectionItems(
  items: AssistantTraceItem[],
  traceVisibility: AssistantTraceVisibility,
) {
  const blocks = buildAssistantTraceBlocks(filterRenderedAssistantTraceItems(items, true, traceVisibility))

  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index]
    if (block.sectionKey !== "response") continue
    if (!block.items.some((item) => item.kind === "text" && Boolean(item.text?.trim()))) continue
    return block.items
  }

  return []
}

function findFinalResponseBlockIndex(blocks: AssistantTraceBlock[]) {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index]
    if (block.sectionKey !== "response") continue
    if (!block.items.some((item) => item.kind === "text" && Boolean(item.text?.trim()))) continue
    return index
  }

  return -1
}

function formatDurationMilliseconds(durationMs: number) {
  if (!Number.isFinite(durationMs)) return null

  const normalizedDurationMs = Math.max(0, durationMs)
  if (normalizedDurationMs < 1000) return "<1s"

  const totalSeconds = Math.round(normalizedDurationMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`
}

function formatAssistantTraceDuration(runtime?: AssistantThreadMessageRuntime) {
  if (!runtime) return null
  return formatDurationMilliseconds(runtime.updatedAt - runtime.startedAt)
}

function formatAssistantProcessTraceDuration(blocks: AssistantTraceBlock[], runtime?: AssistantThreadMessageRuntime) {
  const timestamps = blocks
    .flatMap((block) => block.items)
    .map((item) => item.timestamp)
    .filter((timestamp) => Number.isFinite(timestamp))

  if (timestamps.length === 0) return formatAssistantTraceDuration(runtime)

  const itemStartedAt = Math.min(...timestamps)
  const itemUpdatedAt = Math.max(...timestamps)
  const runtimeStartedAt = runtime && Number.isFinite(runtime.startedAt) ? runtime.startedAt : null
  const runtimeUpdatedAt = runtime && Number.isFinite(runtime.updatedAt) ? runtime.updatedAt : null
  const canUseRuntimeRange =
    runtimeStartedAt !== null &&
    runtimeUpdatedAt !== null &&
    runtimeUpdatedAt >= itemStartedAt
  const startedAt = canUseRuntimeRange ? Math.min(itemStartedAt, runtimeStartedAt) : itemStartedAt
  const updatedAt = canUseRuntimeRange ? Math.max(itemUpdatedAt, runtimeUpdatedAt) : itemUpdatedAt

  return formatDurationMilliseconds(updatedAt - startedAt)
}

function pluralizeTraceUnit(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`
}

function summarizeProcessTraceBlocks(blocks: AssistantTraceBlock[]) {
  const items = blocks.flatMap((block) => block.items)
  const toolCount = items.filter((item) => item.kind === "tool").length
  const workflowCount = items.filter((item) => traceSectionKeyForItem(item) === "workflow").length
  const reasoningCount = items.filter((item) => item.kind === "reasoning").length
  const responseCount = items.filter((item) => item.kind === "text" && traceSectionKeyForItem(item) === "response").length
  const fileCount = new Set(
    items.flatMap((item) => [
      ...(item.filePaths ?? []),
      ...(item.fileChanges ?? []).map((change) => change.file),
    ]),
  ).size

  const parts = [
    toolCount > 0 ? pluralizeTraceUnit(toolCount, "tool call") : null,
    workflowCount > 0 ? pluralizeTraceUnit(workflowCount, "workflow event") : null,
    reasoningCount > 0 ? pluralizeTraceUnit(reasoningCount, "reasoning note") : null,
    responseCount > 0 ? pluralizeTraceUnit(responseCount, "progress update") : null,
    fileCount > 0 ? pluralizeTraceUnit(fileCount, "file") : null,
  ].filter((part): part is string => Boolean(part))

  return parts.length > 0 ? parts.join(" · ") : pluralizeTraceUnit(items.length, "event")
}

interface AssistantProcessTraceHeaderProps {
  controlsID?: string
  duration: string | null
  isExpanded: boolean
  onToggle: () => void
  summary: string
}

function AssistantProcessTraceHeader({
  controlsID,
  duration,
  isExpanded,
  onToggle,
  summary,
}: AssistantProcessTraceHeaderProps) {
  const { t } = useI18n()
  const title = t("thread.processTrace.title")
  const toggleAction = t(isExpanded ? "thread.processTrace.collapse" : "thread.processTrace.expand")
  const details = [duration, summary].filter((part): part is string => Boolean(part)).join(" ")
  const toggleLabel = details ? `${toggleAction} ${title} ${details}` : `${toggleAction} ${title}`

  return (
    <button
      className="assistant-process-trace-header"
      type="button"
      aria-label={toggleLabel}
      aria-expanded={isExpanded}
      aria-controls={controlsID}
      title={toggleLabel}
      onClick={onToggle}
    >
      <div className="assistant-process-trace-copy">
        <span className="assistant-process-trace-title">{title}</span>
        {duration ? <span className="assistant-process-trace-duration">{duration}</span> : null}
        <span className="assistant-process-trace-summary">{summary}</span>
      </div>
      <span className="assistant-process-trace-toggle" aria-hidden="true">
        <span className="assistant-process-trace-chevron" aria-hidden="true">
          {isExpanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
        </span>
      </span>
    </button>
  )
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

function summarizeFileChangeItems(items: AssistantTraceItem[]) {
  const imageItems = items.filter((item) => item.kind === "image")
  const latestPatch = [...items].reverse().find((item) => item.kind === "patch")
  const latestNonImageItem = latestPatch ?? [...items].reverse().find((item) => item.kind !== "image")

  if (imageItems.length > 0) {
    const includedIDs = new Set([
      ...imageItems.map((item) => item.id),
      ...(latestNonImageItem ? [latestNonImageItem.id] : []),
    ])
    return items.filter((item) => includedIDs.has(item.id))
  }

  if (latestPatch) return [latestPatch]

  const latestItem = items[items.length - 1]
  return latestItem ? [latestItem] : []
}

function isCollapsibleTraceItem(item: AssistantTraceItem) {
  return item.kind === "reasoning" || item.kind === "tool"
}

function shouldCollapseReasoningTraceItem(item: AssistantTraceItem, shouldCollapseAfterMessageCompletion: boolean) {
  if (shouldCollapseAfterMessageCompletion && isCollapsibleTraceItem(item)) return true
  if (item.kind !== "reasoning" || item.isStreaming) return false
  return item.status === undefined || item.status === "completed"
}

function firstNonEmptyLine(value?: string) {
  return value
    ?.split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)
}

function createTraceTextPreview(
  value: string | null | undefined,
  {
    characterLimit,
    lineLimit,
    trim = true,
  }: {
    characterLimit: number
    lineLimit?: number
    trim?: boolean
  },
): TraceTextPreview {
  const text = value ?? ""
  if (!text) {
    return {
      text: "",
      isTruncated: false,
      originalLength: 0,
    }
  }

  let output = ""
  let lineCount = 1
  let index = 0
  let isTruncated = false

  while (index < text.length) {
    const char = text[index] ?? ""
    const isNewline = char === "\n"
    const nextLineCount = isNewline ? lineCount + 1 : lineCount
    if (lineLimit && isNewline && nextLineCount > lineLimit) {
      isTruncated = true
      break
    }
    if (output.length >= characterLimit) {
      isTruncated = true
      break
    }

    output += char
    lineCount = nextLineCount
    index += 1
  }

  return {
    text: trim ? output.trim() : output,
    isTruncated: isTruncated || index < text.length,
    originalLength: text.length,
  }
}

function firstNonEmptyLinePreview(value: string | null | undefined, characterLimit: number): TraceTextPreview | null {
  const text = value ?? ""
  let lineStart = 0

  for (let index = 0; index <= text.length; index += 1) {
    const isLineEnd = index === text.length || text[index] === "\n"
    if (!isLineEnd) continue

    const rawLine = text.slice(lineStart, index).trim()
    if (rawLine) {
      return createTraceTextPreview(rawLine, { characterLimit })
    }
    lineStart = index + 1
  }

  return null
}

function splitFirstNonEmptyLine(value?: string | null) {
  const lines = value?.split(/\r?\n/) ?? []
  const firstLineIndex = lines.findIndex((line) => line.trim())
  if (firstLineIndex < 0) return null

  return {
    firstLine: lines[firstLineIndex]?.trim() ?? "",
    remainingText: lines.slice(firstLineIndex + 1).join("\n").trim() || null,
  }
}

function getReasoningDisclosureContent(item: AssistantTraceItem, fallbackLine: string) {
  const textSplit = splitFirstNonEmptyLine(item.text)
  if (textSplit) {
    return {
      detail: item.detail,
      firstLine: textSplit.firstLine,
      text: textSplit.remainingText,
    }
  }

  const detailSplit = splitFirstNonEmptyLine(item.detail)
  if (detailSplit) {
    return {
      detail: detailSplit.remainingText,
      firstLine: detailSplit.firstLine,
      text: null,
    }
  }

  return {
    detail: null,
    firstLine: fallbackLine,
    text: null,
  }
}

function normalizeTraceLogText(value?: string | null) {
  return firstNonEmptyLine(value ?? undefined)?.replace(/\s+/g, " ").trim() ?? null
}

function isWorkflowLogItem(item: AssistantTraceItem) {
  return (
    item.kind === "step" ||
    item.kind === "retry" ||
    item.kind === "snapshot" ||
    item.kind === "task-state" ||
    item.kind === "subtask" ||
    item.kind === "compaction"
  )
}

function getTraceLogSummary(item: AssistantTraceItem) {
  return normalizeTraceLogText(item.title) ?? normalizeTraceLogText(item.text) ?? normalizeTraceLogText(item.detail) ?? item.label
}

function hasLazyTraceDetail(item: AssistantTraceItem, debugEntries: AssistantTraceDebugEntry[]) {
  return Boolean(
    item.text?.trim() ||
    item.detail?.trim() ||
    item.progressItems?.length ||
    debugEntries.length > 0,
  )
}

function AssistantTraceSection({
  children,
  sectionKey,
  title,
}: {
  children: ReactNode
  sectionKey: AssistantTraceSectionKey
  title: string
}) {
  return (
    <section className={`assistant-section is-${sectionKey}`} role="region" aria-label={title}>
      <div className="assistant-section-body">{children}</div>
    </section>
  )
}

interface AssistantTraceBlockViewProps {
  answeredQuestionIDs: Set<string>
  assistantMessagePhase?: AssistantThreadMessagePhase
  block: AssistantTraceBlock
  isLatestMessage: boolean
  isQuestionAnswerDisabled?: boolean
  onOpenImagePreview?: (payload: ImagePreviewPayload) => void
  onAskUserQuestionAnswer?: QuestionAnswerHandler
  onFileChangeSelect: ((file: string) => void) | undefined
  onArtifactLinkOpen: ((target: MarkdownArtifactLinkTarget) => void) | undefined
  onLocalFileLinkOpen: ((target: MarkdownLocalFileLinkTarget) => void) | undefined
  onProposedPlanConfirm?: ProposedPlanConfirmHandler
  sectionID: string
  shouldCollapseReasoningAndTools: boolean
  traceVisibility: AssistantTraceVisibility
}

function getAssistantTraceBlockStackClassName(sectionKey: AssistantTraceSectionKey) {
  if (sectionKey === "response") return "assistant-response-stack"
  if (sectionKey === "file-change") return "assistant-file-change-stack"
  if (sectionKey === "tools" || sectionKey === "workflow") return "trace-log-list"
  return "assistant-section-list"
}

function AssistantTraceBlockView({
  answeredQuestionIDs,
  assistantMessagePhase,
  block,
  isLatestMessage,
  isQuestionAnswerDisabled,
  onOpenImagePreview,
  onAskUserQuestionAnswer,
  onFileChangeSelect,
  onArtifactLinkOpen,
  onLocalFileLinkOpen,
  onProposedPlanConfirm,
  sectionID,
  shouldCollapseReasoningAndTools,
  traceVisibility,
}: AssistantTraceBlockViewProps) {
  const renderedItems = getAssistantTraceBlockRenderedItems(block)

  return (
    <AssistantTraceSection
      key={sectionID}
      sectionKey={block.sectionKey}
      title={block.title}
    >
      <div className={getAssistantTraceBlockStackClassName(block.sectionKey)}>
        {renderedItems.map((item) => {
          const questionID = item.questionPrompt?.questionID
          const isQuestionAnswered = Boolean(item.questionPrompt?.answered || (questionID && answeredQuestionIDs.has(questionID)))
          return (
            <TraceItemView
              key={item.id}
              assistantMessagePhase={assistantMessagePhase}
              item={item}
              isQuestionAnswered={isQuestionAnswered}
              isQuestionAnswerDisabled={isQuestionAnswerDisabled}
              onOpenImagePreview={onOpenImagePreview}
              onAskUserQuestionAnswer={onAskUserQuestionAnswer}
              onFileChangeSelect={onFileChangeSelect}
              onArtifactLinkOpen={onArtifactLinkOpen}
              onLocalFileLinkOpen={onLocalFileLinkOpen}
              isLatestMessage={isLatestMessage}
              onProposedPlanConfirm={onProposedPlanConfirm}
              shouldCollapseAfterMessageCompletion={shouldCollapseReasoningAndTools}
              traceVisibility={traceVisibility}
            />
          )
        })}
      </div>
    </AssistantTraceSection>
  )
}

function getReasoningDisclosurePreview(item: AssistantTraceItem, fallbackLine: string): TraceTextPreview {
  return firstNonEmptyLinePreview(item.text, TRACE_REASONING_PREVIEW_CHARACTER_LIMIT) ??
    firstNonEmptyLinePreview(item.detail, TRACE_REASONING_PREVIEW_CHARACTER_LIMIT) ??
    {
      text: fallbackLine,
      isTruncated: false,
      originalLength: fallbackLine.length,
    }
}

function AssistantProcessTraceDisclosure({
  answeredQuestionIDs,
  assistantMessagePhase,
  blocks,
  isLatestMessage,
  isQuestionAnswerDisabled,
  onOpenImagePreview,
  onAskUserQuestionAnswer,
  onFileChangeSelect,
  onArtifactLinkOpen,
  onLocalFileLinkOpen,
  onProposedPlanConfirm,
  runtime,
  shouldCollapseReasoningAndTools,
  traceVisibility,
}: Omit<AssistantTraceBlockViewProps, "block" | "sectionID"> & {
  blocks: AssistantTraceBlock[]
  runtime?: AssistantThreadMessageRuntime
}) {
  const [isExpanded, setIsExpanded] = useState(() => !shouldCollapseReasoningAndTools)
  const { t } = useI18n()
  const processTraceKey = blocks.map((block) => block.items.map((item) => item.id).join(",")).join("|")
  const duration = formatAssistantProcessTraceDuration(blocks, runtime)
  const summary = summarizeProcessTraceBlocks(blocks)
  const contentID = `assistant-process-trace-${(processTraceKey || "empty").replace(/[^a-zA-Z0-9_-]/g, "-")}`

  useLayoutEffect(() => {
    if (shouldCollapseReasoningAndTools) {
      setIsExpanded(false)
      return
    }

    setIsExpanded(true)
  }, [processTraceKey, shouldCollapseReasoningAndTools])

  return (
    <section
      className={joinClassNames("assistant-process-trace", isExpanded ? "is-expanded" : "is-collapsed")}
      role="region"
      aria-label={t("thread.processTrace.region")}
    >
      <AssistantProcessTraceHeader
        controlsID={contentID}
        duration={duration}
        isExpanded={isExpanded}
        summary={summary}
        onToggle={() => setIsExpanded((current) => !current)}
      />

      {isExpanded ? (
        <div id={contentID} className="assistant-process-trace-body">
          {blocks.map((block, index) => (
            <AssistantTraceBlockView
              key={`process-${block.sectionKey}-${index}`}
              answeredQuestionIDs={answeredQuestionIDs}
              assistantMessagePhase={assistantMessagePhase}
              block={block}
              isQuestionAnswerDisabled={isQuestionAnswerDisabled}
              isLatestMessage={isLatestMessage}
              onOpenImagePreview={onOpenImagePreview}
              onAskUserQuestionAnswer={onAskUserQuestionAnswer}
              onFileChangeSelect={onFileChangeSelect}
              onArtifactLinkOpen={onArtifactLinkOpen}
              onLocalFileLinkOpen={onLocalFileLinkOpen}
              onProposedPlanConfirm={onProposedPlanConfirm}
              sectionID={`process-${block.sectionKey}-${index}`}
              shouldCollapseReasoningAndTools={shouldCollapseReasoningAndTools}
              traceVisibility={traceVisibility}
            />
          ))}
        </div>
      ) : null}
    </section>
  )
}

function AssistantMessagePlaceholder({ message }: { message: string }) {
  return (
    <section className="assistant-section assistant-ephemeral-state" aria-live="polite" aria-label="Assistant status">
      <p className="assistant-ephemeral-hint">{message}</p>
    </section>
  )
}

interface AssistantMessageSectionsProps {
  answeredQuestionIDs: Set<string>
  assistantMessagePhase?: AssistantThreadMessagePhase
  isQuestionAnswerDisabled?: boolean
  isLatestMessage: boolean
  items: AssistantTraceItem[]
  onOpenImagePreview?: (payload: ImagePreviewPayload) => void
  onAskUserQuestionAnswer?: QuestionAnswerHandler
  onFileChangeSelect: ((file: string) => void) | undefined
  onArtifactLinkOpen: ((target: MarkdownArtifactLinkTarget) => void) | undefined
  onLocalFileLinkOpen: ((target: MarkdownLocalFileLinkTarget) => void) | undefined
  onProposedPlanConfirm?: ProposedPlanConfirmHandler
  processPrefixItems?: AssistantTraceItem[]
  renderProcessTrace?: boolean
  runtime?: AssistantThreadMessageRuntime
  showFileChanges: boolean
  shouldCollapseReasoningAndTools: boolean
  traceVisibility: AssistantTraceVisibility
}

function isLiveAssistantTraceItem(item: AssistantTraceItem) {
  if (item.isStreaming || item.draftPatch?.isStreaming) return true
  if (item.kind !== "tool") return false
  return item.status === "pending" || item.status === "running" || item.status === "waiting-approval"
}

function splitAssistantTraceItemsForStreaming(items: AssistantTraceItem[]): AssistantTraceRenderSplit {
  let liveStartIndex = items.length

  while (liveStartIndex > 0 && isLiveAssistantTraceItem(items[liveStartIndex - 1]!)) {
    liveStartIndex -= 1
  }

  if (liveStartIndex === items.length || liveStartIndex === 0) {
    return {
      stableItems: items,
      liveItems: [],
      isSplit: false,
    }
  }

  for (let index = 0; index < liveStartIndex; index += 1) {
    if (isLiveAssistantTraceItem(items[index]!)) {
      return {
        stableItems: items,
        liveItems: [],
        isSplit: false,
      }
    }
  }

  return {
    stableItems: items.slice(0, liveStartIndex),
    liveItems: items.slice(liveStartIndex),
    isSplit: true,
  }
}

function useAssistantTraceRenderSplit(items: AssistantTraceItem[]) {
  const previousSplitRef = useRef<AssistantTraceRenderSplit | null>(null)

  return useMemo(() => {
    const nextSplit = splitAssistantTraceItemsForStreaming(items)
    const previousSplit = previousSplitRef.current

    if (nextSplit.isSplit && previousSplit?.isSplit) {
      const stableItems = areArraysShallowEqual(previousSplit.stableItems, nextSplit.stableItems)
        ? previousSplit.stableItems
        : nextSplit.stableItems
      const liveItems = areArraysShallowEqual(previousSplit.liveItems, nextSplit.liveItems)
        ? previousSplit.liveItems
        : nextSplit.liveItems
      const reusedSplit = {
        stableItems,
        liveItems,
        isSplit: true,
      }
      previousSplitRef.current = reusedSplit
      return reusedSplit
    }

    previousSplitRef.current = nextSplit
    return nextSplit
  }, [items])
}

const AssistantMessageSectionsContent = memo(function AssistantMessageSectionsContent({
  answeredQuestionIDs,
  assistantMessagePhase,
  isQuestionAnswerDisabled = false,
  isLatestMessage,
  items,
  onOpenImagePreview,
  onAskUserQuestionAnswer,
  onFileChangeSelect,
  onArtifactLinkOpen,
  onLocalFileLinkOpen,
  onProposedPlanConfirm,
  processPrefixItems = [],
  renderProcessTrace = true,
  runtime,
  showFileChanges,
  shouldCollapseReasoningAndTools,
  traceVisibility,
}: AssistantMessageSectionsProps) {
  const traceDisplayBlocks = measureRendererPerf(
    "AssistantMessageSections.buildTraceBlocks",
    () => buildAssistantTraceDisplayBlocks({
      items,
      processPrefixItems,
      showFileChanges,
      shouldCollapseReasoningAndTools,
      traceVisibility,
    }),
    () => ({
      itemCount: items.length,
      processPrefixItemCount: processPrefixItems.length,
      renderProcessTrace,
      shouldCollapseReasoningAndTools,
      showFileChanges,
    }),
  )
  const shouldRenderProcessTrace = renderProcessTrace && traceDisplayBlocks.shouldRenderProcessTrace
  const processBlocks = shouldRenderProcessTrace ? traceDisplayBlocks.processBlocks : []
  const mainBlocks = traceDisplayBlocks.mainBlocks
  const sectionsProfiler = useMemo(
    () => createRendererProfilerOnRender("AssistantMessageSections commit", () => ({
      assistantMessagePhase: assistantMessagePhase ?? null,
      isLatestMessage,
      itemCount: items.length,
      mainBlockCount: mainBlocks.length,
      processBlockCount: processBlocks.length,
      processPrefixItemCount: processPrefixItems.length,
      shouldRenderProcessTrace,
    })),
    [
      assistantMessagePhase,
      isLatestMessage,
      items.length,
      mainBlocks.length,
      processBlocks.length,
      processPrefixItems.length,
      shouldRenderProcessTrace,
    ],
  )

  return (
    <RendererProfiler id="AssistantMessageSections" onRender={sectionsProfiler}>
      {shouldRenderProcessTrace ? (
        <AssistantProcessTraceDisclosure
          answeredQuestionIDs={answeredQuestionIDs}
          assistantMessagePhase={assistantMessagePhase}
          blocks={processBlocks}
          isQuestionAnswerDisabled={isQuestionAnswerDisabled}
          isLatestMessage={isLatestMessage}
          onOpenImagePreview={onOpenImagePreview}
          onAskUserQuestionAnswer={onAskUserQuestionAnswer}
          onFileChangeSelect={onFileChangeSelect}
          onArtifactLinkOpen={onArtifactLinkOpen}
          onLocalFileLinkOpen={onLocalFileLinkOpen}
          onProposedPlanConfirm={onProposedPlanConfirm}
          runtime={runtime}
          shouldCollapseReasoningAndTools={shouldCollapseReasoningAndTools}
          traceVisibility={traceVisibility}
        />
      ) : null}
      {mainBlocks.map((block, index) => (
        <AssistantTraceBlockView
          key={`${block.sectionKey}-${index}`}
          answeredQuestionIDs={answeredQuestionIDs}
          assistantMessagePhase={assistantMessagePhase}
          block={block}
          isQuestionAnswerDisabled={isQuestionAnswerDisabled}
          isLatestMessage={isLatestMessage}
          onOpenImagePreview={onOpenImagePreview}
          onAskUserQuestionAnswer={onAskUserQuestionAnswer}
          onFileChangeSelect={onFileChangeSelect}
          onArtifactLinkOpen={onArtifactLinkOpen}
          onLocalFileLinkOpen={onLocalFileLinkOpen}
          onProposedPlanConfirm={onProposedPlanConfirm}
          sectionID={`${block.sectionKey}-${index}`}
          shouldCollapseReasoningAndTools={shouldCollapseReasoningAndTools}
          traceVisibility={traceVisibility}
        />
      ))}
    </RendererProfiler>
  )
})

const StableAssistantTraceSections = memo(function StableAssistantTraceSections(props: AssistantMessageSectionsProps) {
  return <AssistantMessageSectionsContent {...props} />
})

const LiveAssistantTraceSections = memo(function LiveAssistantTraceSections(props: AssistantMessageSectionsProps) {
  return <AssistantMessageSectionsContent {...props} />
})

const AssistantMessageSections = memo(function AssistantMessageSections(props: AssistantMessageSectionsProps) {
  const renderProcessTrace = props.renderProcessTrace ?? true
  const canSplitStreamingSuffix = renderProcessTrace === false && (props.processPrefixItems?.length ?? 0) === 0
  const traceRenderSplit = useAssistantTraceRenderSplit(props.items)

  if (!canSplitStreamingSuffix || !traceRenderSplit.isSplit) {
    return <AssistantMessageSectionsContent {...props} />
  }

  return (
    <>
      <StableAssistantTraceSections
        {...props}
        items={traceRenderSplit.stableItems}
      />
      <LiveAssistantTraceSections
        {...props}
        items={traceRenderSplit.liveItems}
        processPrefixItems={[]}
        renderProcessTrace={false}
      />
    </>
  )
})

const AssistantMessageSectionsWithStreamInsertions = memo(function AssistantMessageSectionsWithStreamInsertions({
  answeredQuestionIDs,
  assistantMessagePhase,
  copiedUserThreadMessageID,
  insertedUserMessages,
  isQuestionAnswerDisabled = false,
  isLatestMessage,
  items,
  getMessageMotion,
  onCopyUserMessage,
  onOpenImagePreview,
  onAskUserQuestionAnswer,
  onFileChangeSelect,
  onArtifactLinkOpen,
  onLocalFileLinkOpen,
  onProposedPlanConfirm,
  processPrefixItems = [],
  renderProcessTrace = true,
  runtime,
  showFileChanges,
  shouldCollapseReasoningAndTools,
  traceVisibility,
}: {
  answeredQuestionIDs: Set<string>
  assistantMessagePhase?: AssistantThreadMessagePhase
  copiedUserThreadMessageID: string | null
  insertedUserMessages: UserThreadMessage[]
  isQuestionAnswerDisabled?: boolean
  isLatestMessage: boolean
  items: AssistantTraceItem[]
  getMessageMotion: (messageID: string, isLive?: boolean) => ThreadMessageMotion
  onCopyUserMessage: (messageID: string, text: string) => void | Promise<void>
  onOpenImagePreview?: (payload: ImagePreviewPayload) => void
  onAskUserQuestionAnswer?: QuestionAnswerHandler
  onFileChangeSelect: ((file: string) => void) | undefined
  onArtifactLinkOpen: ((target: MarkdownArtifactLinkTarget) => void) | undefined
  onLocalFileLinkOpen: ((target: MarkdownLocalFileLinkTarget) => void) | undefined
  onProposedPlanConfirm?: ProposedPlanConfirmHandler
  processPrefixItems?: AssistantTraceItem[]
  renderProcessTrace?: boolean
  runtime?: AssistantThreadMessageRuntime
  showFileChanges: boolean
  shouldCollapseReasoningAndTools: boolean
  traceVisibility: AssistantTraceVisibility
}) {
  const insertionSegments = useMemo(() => {
    if (insertedUserMessages.length === 0) return []

    let cursor = 0
    let didRenderProcessPrefix = false
    const segments: Array<
      | {
          kind: "items"
          key: string
          items: AssistantTraceItem[]
          processPrefixItems: AssistantTraceItem[]
        }
      | {
          kind: "user"
          key: string
          message: UserThreadMessage
        }
    > = []

    const pushItemSegment = (segmentItems: AssistantTraceItem[], key: string) => {
      if (segmentItems.length === 0) return
      const segmentProcessPrefixItems = didRenderProcessPrefix ? [] : processPrefixItems
      didRenderProcessPrefix = true
      segments.push({
        kind: "items",
        key,
        items: segmentItems,
        processPrefixItems: segmentProcessPrefixItems,
      })
    }

    insertedUserMessages.forEach((message, index) => {
      const insertionIndex = resolveStreamInsertionItemIndex(items, message, cursor)

      pushItemSegment(items.slice(cursor, insertionIndex), `segment-${index}`)
      segments.push({
        kind: "user",
        key: message.id,
        message: message,
      })
      cursor = insertionIndex
    })

    pushItemSegment(items.slice(cursor), "segment-final")
    return segments
  }, [insertedUserMessages, items, processPrefixItems])

  if (insertedUserMessages.length === 0) {
    return (
      <AssistantMessageSections
        answeredQuestionIDs={answeredQuestionIDs}
        assistantMessagePhase={assistantMessagePhase}
        isQuestionAnswerDisabled={isQuestionAnswerDisabled}
        isLatestMessage={isLatestMessage}
        items={items}
        onOpenImagePreview={onOpenImagePreview}
        onAskUserQuestionAnswer={onAskUserQuestionAnswer}
        onFileChangeSelect={onFileChangeSelect}
        onArtifactLinkOpen={onArtifactLinkOpen}
        onLocalFileLinkOpen={onLocalFileLinkOpen}
        onProposedPlanConfirm={onProposedPlanConfirm}
        processPrefixItems={processPrefixItems}
        renderProcessTrace={renderProcessTrace}
        runtime={runtime}
        showFileChanges={showFileChanges}
        shouldCollapseReasoningAndTools={shouldCollapseReasoningAndTools}
        traceVisibility={traceVisibility}
      />
    )
  }

  return (
    <>
      {insertionSegments.map((segment) => {
        if (segment.kind === "user") {
          return (
            <UserThreadMessageArticle
              key={segment.key}
              className="assistant-stream-insertion-user-message"
              copied={copiedUserThreadMessageID === segment.message.id}
              motion={getMessageMotion(segment.message.id)}
              onCopy={onCopyUserMessage}
              message={segment.message}
            />
          )
        }

        return (
          <AssistantMessageSections
            key={segment.key}
            answeredQuestionIDs={answeredQuestionIDs}
            assistantMessagePhase={assistantMessagePhase}
            isQuestionAnswerDisabled={isQuestionAnswerDisabled}
            isLatestMessage={isLatestMessage}
            items={segment.items}
            onOpenImagePreview={onOpenImagePreview}
            onAskUserQuestionAnswer={onAskUserQuestionAnswer}
            onFileChangeSelect={onFileChangeSelect}
            onArtifactLinkOpen={onArtifactLinkOpen}
            onLocalFileLinkOpen={onLocalFileLinkOpen}
            onProposedPlanConfirm={onProposedPlanConfirm}
            processPrefixItems={segment.processPrefixItems}
            renderProcessTrace={renderProcessTrace}
            runtime={runtime}
            showFileChanges={showFileChanges}
            shouldCollapseReasoningAndTools={shouldCollapseReasoningAndTools}
            traceVisibility={traceVisibility}
          />
        )
      })}
    </>
  )
})

function TraceImagePreview({
  item,
  onOpenImagePreview,
}: {
  item: AssistantTraceItem
  onOpenImagePreview?: (payload: ImagePreviewPayload) => void
}) {
  const src = item.src ?? ""
  const alt = item.alt || item.title || "Image attachment"
  const [loadState, setLoadState] = useState<"loading" | "loaded" | "error">("loading")
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const thumbnailStyle = item.width && item.height ? { aspectRatio: `${item.width} / ${item.height}` } : undefined
  const sizeText = item.width && item.height ? `${item.width} x ${item.height}` : ""
  const metaText = [item.mimeType, sizeText].filter(Boolean).join(" | ")

  useEffect(() => {
    setLoadState("loading")
  }, [src])

  if (!src) return null

  return (
    <div className="trace-image-preview">
      <button
        ref={triggerRef}
        type="button"
        className={joinClassNames("trace-image-thumbnail", `is-${loadState}`)}
        style={thumbnailStyle}
        aria-label={`Preview ${alt}`}
        disabled={loadState === "error"}
        onClick={() => onOpenImagePreview?.({
          src,
          alt,
          width: item.width,
          height: item.height,
          mimeType: item.mimeType,
          triggerElement: triggerRef.current,
        })}
      >
        <img
          className="trace-image-thumbnail-image"
          src={src}
          alt={alt}
          loading="lazy"
          onLoad={() => setLoadState("loaded")}
          onError={() => setLoadState("error")}
        />
        {loadState === "loading" ? <span className="trace-image-state">Loading image...</span> : null}
        {loadState === "error" ? <span className="trace-image-state is-error">Image failed to load</span> : null}
      </button>
      {metaText ? <p className="trace-image-meta">{metaText}</p> : null}
    </div>
  )
}

function ImageLightbox({
  preview,
  onClose,
}: {
  preview: ActiveImagePreview
  onClose: () => void
}) {
  const isDefaultFitWidth = isTallImage(preview.width, preview.height)
  const [fitMode, setFitMode] = useState<ImagePreviewFitMode>(isDefaultFitWidth ? "fit-width" : "fit-contain")
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const backdropRef = useRef<HTMLDivElement | null>(null)
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)
  const dragStateRef = useRef<{
    pointerId: number
    pointerTarget: HTMLDivElement
    originClientX: number
    originClientY: number
    originPanX: number
    originPanY: number
  } | null>(null)
  const effectiveLabel = preview.alt || "Image preview"

  const closePreview = useEffectEvent(() => {
    onClose()
    const trigger = preview.triggerElement
    if (trigger?.isConnected) {
      trigger.focus()
    }
  })

  const adjustZoom = useEffectEvent((delta: number) => {
    setZoom((currentZoom) => clampImageZoom(currentZoom + delta))
  })

  const resetView = useEffectEvent(() => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
    setIsDragging(false)
    dragStateRef.current = null
  })

  useEffect(() => {
    setFitMode(isTallImage(preview.width, preview.height) ? "fit-width" : "fit-contain")
    setZoom(1)
    setPan({ x: 0, y: 0 })
    setIsDragging(false)
    dragStateRef.current = null
  }, [preview.height, preview.src, preview.width])

  useEffect(() => {
    if (zoom > 1) return
    setPan({ x: 0, y: 0 })
    setIsDragging(false)
    const dragState = dragStateRef.current
    if (dragState?.pointerTarget.hasPointerCapture(dragState.pointerId)) {
      dragState.pointerTarget.releasePointerCapture(dragState.pointerId)
    }
    dragStateRef.current = null
  }, [zoom])

  useEffect(() => {
    document.body.classList.add(IMAGE_LIGHTBOX_BODY_CLASS)
    closeButtonRef.current?.focus()
    return () => {
      document.body.classList.remove(IMAGE_LIGHTBOX_BODY_CLASS)
    }
  }, [])

  useEffect(() => {
    function handleWindowKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault()
        closePreview()
        return
      }
      if (event.key === "+" || event.key === "=") {
        event.preventDefault()
        adjustZoom(IMAGE_LIGHTBOX_ZOOM_STEP)
        return
      }
      if (event.key === "-") {
        event.preventDefault()
        adjustZoom(-IMAGE_LIGHTBOX_ZOOM_STEP)
        return
      }
      if (event.key === "0") {
        event.preventDefault()
        resetView()
      }
    }

    window.addEventListener("keydown", handleWindowKeyDown)
    return () => window.removeEventListener("keydown", handleWindowKeyDown)
  }, [adjustZoom, closePreview, resetView])

  function handleBackdropKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Tab") return
    const focusable = getFocusableElements(backdropRef.current)
    if (focusable.length === 0) {
      event.preventDefault()
      return
    }

    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    const activeElement = document.activeElement as HTMLElement | null
    const activeInside = activeElement ? backdropRef.current?.contains(activeElement) : false

    if (event.shiftKey) {
      if (!activeInside || activeElement === first) {
        event.preventDefault()
        last.focus()
      }
      return
    }

    if (!activeInside || activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  function handleViewportWheel(event: ReactWheelEvent<HTMLDivElement>) {
    if (!event.ctrlKey && !event.metaKey) return
    event.preventDefault()
    adjustZoom(event.deltaY < 0 ? IMAGE_LIGHTBOX_ZOOM_STEP : -IMAGE_LIGHTBOX_ZOOM_STEP)
  }

  function handleCanvasPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (zoom <= 1) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragStateRef.current = {
      pointerId: event.pointerId,
      pointerTarget: event.currentTarget,
      originClientX: event.clientX,
      originClientY: event.clientY,
      originPanX: pan.x,
      originPanY: pan.y,
    }
    setIsDragging(true)
  }

  function handleCanvasPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const dragState = dragStateRef.current
    if (!dragState || dragState.pointerId !== event.pointerId) return
    event.preventDefault()
    const deltaX = event.clientX - dragState.originClientX
    const deltaY = event.clientY - dragState.originClientY
    setPan({
      x: dragState.originPanX + deltaX,
      y: dragState.originPanY + deltaY,
    })
  }

  function handleCanvasPointerEnd(event: ReactPointerEvent<HTMLDivElement>) {
    const dragState = dragStateRef.current
    if (!dragState || dragState.pointerId !== event.pointerId) return
    if (dragState.pointerTarget.hasPointerCapture(event.pointerId)) {
      dragState.pointerTarget.releasePointerCapture(event.pointerId)
    }
    dragStateRef.current = null
    setIsDragging(false)
  }

  const zoomPercent = Math.round(zoom * 100)

  if (typeof document === "undefined") return null

  return createPortal(
    <div
      ref={backdropRef}
      className="trace-image-lightbox-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={effectiveLabel}
      tabIndex={-1}
      onClick={closePreview}
      onKeyDown={handleBackdropKeyDown}
    >
      <div className="trace-image-lightbox-panel" onClick={(event) => event.stopPropagation()}>
        <div className="trace-image-lightbox-toolbar">
          <div className="trace-image-lightbox-toolbar-group">
            <button
              type="button"
              className={fitMode === "fit-width" ? "trace-image-lightbox-toolbar-button is-active" : "trace-image-lightbox-toolbar-button"}
              aria-label="Fit width"
              onClick={() => {
                setFitMode("fit-width")
                resetView()
              }}
            >
              Fit width
            </button>
            <button
              type="button"
              className={fitMode === "fit-contain" ? "trace-image-lightbox-toolbar-button is-active" : "trace-image-lightbox-toolbar-button"}
              aria-label="Fit contain"
              onClick={() => {
                setFitMode("fit-contain")
                resetView()
              }}
            >
              Fit contain
            </button>
          </div>

          <div className="trace-image-lightbox-toolbar-group">
            <button
              type="button"
              className="trace-image-lightbox-toolbar-icon-button"
              aria-label="Zoom out"
              onClick={() => adjustZoom(-IMAGE_LIGHTBOX_ZOOM_STEP)}
            >
              <MinimizeIcon />
            </button>
            <button
              type="button"
              className="trace-image-lightbox-toolbar-button trace-image-lightbox-zoom-button"
              aria-label="Reset zoom"
              onClick={resetView}
            >
              <ResetIcon />
              <span>{zoomPercent}%</span>
            </button>
            <button
              type="button"
              className="trace-image-lightbox-toolbar-icon-button"
              aria-label="Zoom in"
              onClick={() => adjustZoom(IMAGE_LIGHTBOX_ZOOM_STEP)}
            >
              <PlusIcon />
            </button>
            <button
              ref={closeButtonRef}
              type="button"
              className="trace-image-lightbox-close"
              aria-label="Close image preview"
              onClick={closePreview}
            >
              <CloseIcon />
            </button>
          </div>
        </div>

        <div className={fitMode === "fit-width" ? "trace-image-lightbox-viewport is-fit-width" : "trace-image-lightbox-viewport"} onWheel={handleViewportWheel}>
          <div
            className={joinClassNames(
              "trace-image-lightbox-canvas",
              `is-${fitMode}`,
              zoom > 1 && "is-zoomed",
              isDragging && "is-dragging",
            )}
            onPointerCancel={handleCanvasPointerEnd}
            onPointerDown={handleCanvasPointerDown}
            onPointerMove={handleCanvasPointerMove}
            onPointerUp={handleCanvasPointerEnd}
          >
            <img
              className="trace-image-lightbox-image"
              src={preview.src}
              alt={preview.alt}
              draggable={false}
              style={{
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              }}
            />
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

export interface InlineSideChatThreadProps {
  activeProjectID: string | null
  attachments: ComposerAttachment[]
  assistantTraceVisibility: AssistantTraceVisibility
  composerRefreshVersion: number
  draftState: ComposerDraftState
  isAgentDebugTraceEnabled: boolean
  isResolvingPermissionRequest: boolean
  isCancelling?: boolean
  isInterruptible?: boolean
  isSending: boolean
  pendingInputs: PendingConversationInput[]
  pendingPermissionRequests: PermissionRequest[]
  permissionRequestActionError: string | null
  permissionRequestActionRequestID: string | null
  session: SessionSummary
  sideChatSessions: SessionSummary[]
  messages: ThreadMessage[]
  isThreadVisible?: boolean
  readScrollSnapshot?: (key: string) => ThreadScrollSnapshot | null
  saveScrollSnapshot?: (key: string, snapshot: ThreadScrollSnapshot) => void
  onDraftStateChange: (value: ComposerDraftState) => void
  onHide: () => void
  onAskUserQuestionAnswer: QuestionAnswerHandler
  onArtifactLinkOpen?: (target: MarkdownArtifactLinkTarget) => void
  onLocalFileLinkOpen?: (target: MarkdownLocalFileLinkTarget) => void
  onPermissionRequestResponse: PermissionRequestResponseHandler
  onPickAttachments: (input: {
    allowImage: boolean
    allowPdf: boolean
    disabledReason: string | null
  }) => void | Promise<void>
  onPasteImageAttachments?: (input: {
    allowImage: boolean
    disabledReason: string | null
    images: ComposerPastedImageAttachment[]
  }) => void | Promise<void>
  onRemoveAttachment: (path: string) => void
  onCancelSend?: () => void | Promise<void>
  onCreateSideChat: () => void | Promise<void>
  onDeleteSideChat: (sessionID: string) => void | Promise<void>
  onSend: (input: {
    attachmentError?: string | null
    draftStateOverride?: ComposerDraftState
    questionAnswer?: {
      questionID: string
      selectedOptions?: string[]
      freeformText?: string
    }
    selectedReasoningEffort?: ReasoningEffort | null
    selectedModel?: string | null
    selectedSkillIDs: string[]
    steerQueuedMessageID?: string
    submissionMode?: UserThreadMessage["submissionMode"]
    waitForPendingModelSelection: () => Promise<void>
  }) => void | Promise<void>
  onSelectSideChat: (sessionID: string) => void | Promise<void>
  onSessionModelSelectionChange?: (sessionID: string, selection: SessionSummary["modelSelection"] | undefined) => void
  ariaLabel?: string
  variant?: "inline" | "sidebar"
}

export function InlineSideChatThread({
  activeProjectID,
  attachments,
  assistantTraceVisibility,
  composerRefreshVersion,
  draftState,
  isAgentDebugTraceEnabled,
  isResolvingPermissionRequest,
  isCancelling = false,
  isInterruptible = false,
  isSending,
  pendingInputs,
  pendingPermissionRequests,
  permissionRequestActionError,
  permissionRequestActionRequestID,
  session,
  sideChatSessions,
  messages,
  isThreadVisible = true,
  readScrollSnapshot,
  saveScrollSnapshot,
  onDraftStateChange,
  onHide,
  onAskUserQuestionAnswer,
  onArtifactLinkOpen,
  onLocalFileLinkOpen,
  onPermissionRequestResponse,
  onPickAttachments,
  onPasteImageAttachments,
  onRemoveAttachment,
  onCancelSend,
  onCreateSideChat,
  onDeleteSideChat,
  onSend,
  onSelectSideChat,
  onSessionModelSelectionChange,
  ariaLabel = "Nested side chat",
  variant = "inline",
}: InlineSideChatThreadProps) {
  const composer = useProjectComposer({
    attachmentPaths: attachments.map((attachment) => attachment.path),
    onSessionModelSelectionChange,
    projectID: activeProjectID,
    refreshToken: composerRefreshVersion,
    sessionModelSelection: session.modelSelection,
    sessionID: session.id,
  })
  const [hydratedMessagesBySessionID, setHydratedMessagesBySessionID] = useState<Record<string, ThreadMessage[]>>({})
  const [isCreatingSideChatTab, setIsCreatingSideChatTab] = useState(false)
  const [deletingSideChatTabID, setDeletingSideChatTabID] = useState<string | null>(null)
  const [sideChatTabMenu, setSideChatTabMenu] = useState<{ sessionID: string; x: number; y: number } | null>(null)
  const sideChatTabMenuRef = useRef<HTMLDivElement | null>(null)
  const threadColumnRef = useRef<HTMLDivElement | null>(null)
  const hydratedMessages = hydratedMessagesBySessionID[session.id] ?? []
  const effectiveMessages = messages.length > 0 ? messages : hydratedMessages
  const sideChatTabs = sideChatSessions.some((sideChat) => sideChat.id === session.id)
    ? sideChatSessions
    : [...sideChatSessions, session]
  const shouldRenderNestedThread =
    effectiveMessages.length > 0 ||
    pendingPermissionRequests.length > 0 ||
    isResolvingPermissionRequest ||
    Boolean(permissionRequestActionError)
  const pendingSubmissionInputs = useMemo(
    () => [...pendingInputs].sort((left, right) => left.createdAt - right.createdAt),
    [pendingInputs],
  )

  useEffect(() => {
    if (messages.length > 0) {
      setHydratedMessagesBySessionID((current) => ({
        ...current,
        [session.id]: messages,
      }))
      return
    }

    const agentSession = getAgentSessionBridge()
    if (!agentSession) {
      return
    }

    let isCancelled = false

    void agentSession.loadHistory({ backendSessionID: session.id })
      .then((messages) => {
        if (isCancelled) return
        const nextMessages = buildThreadMessagesFromHistory(messages)
        const nextHydratedMessages = mergeUserMessagePresentationState(readPersistedUserMessages(session.id), nextMessages)
        setHydratedMessagesBySessionID((current) => ({
          ...current,
          [session.id]: nextHydratedMessages,
        }))
      })
      .catch((error) => {
        if (isCancelled) return
        console.error("[desktop] agentSession.loadHistory failed for inline side chat:", error)
      })

    return () => {
      isCancelled = true
    }
  }, [session.id, messages])

  useEffect(() => {
    if (!sideChatTabMenu) return

    function handlePointerDown(event: PointerEvent) {
      if (sideChatTabMenuRef.current?.contains(event.target as Node)) return
      setSideChatTabMenu(null)
    }

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        setSideChatTabMenu(null)
      }
    }

    function handleBlur() {
      setSideChatTabMenu(null)
    }

    window.addEventListener("pointerdown", handlePointerDown)
    window.addEventListener("keydown", handleKeyDown)
    window.addEventListener("blur", handleBlur)

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown)
      window.removeEventListener("keydown", handleKeyDown)
      window.removeEventListener("blur", handleBlur)
    }
  }, [sideChatTabMenu])

  async function handleCreateSideChat() {
    if (isCreatingSideChatTab) return

    setIsCreatingSideChatTab(true)
    try {
      await onCreateSideChat()
    } finally {
      setIsCreatingSideChatTab(false)
    }
  }

  function openSideChatTabMenu(event: ReactMouseEvent<HTMLElement>, sessionID: string) {
    event.preventDefault()
    event.stopPropagation()

    const menuWidth = 132
    const menuHeight = 42
    const x = Math.min(Math.max(8, event.clientX), Math.max(8, window.innerWidth - menuWidth - 8))
    const y = Math.min(Math.max(8, event.clientY), Math.max(8, window.innerHeight - menuHeight - 8))
    setSideChatTabMenu({ sessionID, x, y })
  }

  function openSideChatTabMenuFromKeyboard(event: KeyboardEvent<HTMLElement>, sessionID: string) {
    const target = event.currentTarget
    const rect = target.getBoundingClientRect()
    const menuWidth = 132
    const x = Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - menuWidth - 8))
    const y = Math.min(Math.max(8, rect.bottom + 4), Math.max(8, window.innerHeight - 50))
    setSideChatTabMenu({ sessionID, x, y })
  }

  async function handleDeleteSideChatTab(sessionID: string) {
    if (deletingSideChatTabID) return

    setDeletingSideChatTabID(sessionID)
    setSideChatTabMenu(null)
    try {
      await onDeleteSideChat(sessionID)
    } finally {
      setDeletingSideChatTabID(null)
    }
  }

  return (
    <section
      className={joinClassNames("inline-side-chat-thread", variant === "sidebar" && "is-sidebar")}
      aria-label={ariaLabel}
    >
      <header className="inline-side-chat-header">
        <div className="inline-side-chat-tabs" aria-label="Side chat tabs">
          <div className="inline-side-chat-tab-list" role="tablist" aria-label="Side chat threads">
            {sideChatTabs.map((sideChat, index) => {
              const isActive = sideChat.id === session.id

              return (
                <button
                  key={sideChat.id}
                  className={isActive ? "inline-side-chat-tab is-active" : "inline-side-chat-tab"}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  aria-label={`Chat ${index + 1}`}
                  title={sideChat.title}
                  onClick={() => {
                    if (!isActive) {
                      void onSelectSideChat(sideChat.id)
                    }
                  }}
                  onContextMenu={(event) => openSideChatTabMenu(event, sideChat.id)}
                  onKeyDown={(event) => {
                    if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
                      event.preventDefault()
                      openSideChatTabMenuFromKeyboard(event, sideChat.id)
                    }
                  }}
                >
                  Chat {index + 1}
                </button>
              )
            })}
          </div>
          <button
            className="inline-side-chat-tab-add"
            type="button"
            aria-label="Create side chat tab"
            title="Create side chat tab"
            disabled={isCreatingSideChatTab}
            onClick={() => void handleCreateSideChat()}
          >
            <PlusIcon />
          </button>
        </div>
        <button
          aria-label="Hide side chat"
          className="inline-side-chat-close"
          title="Hide side chat"
          type="button"
          onClick={onHide}
        >
          <CloseIcon />
        </button>
      </header>

      {sideChatTabMenu
        ? createPortal(
            <div
              ref={sideChatTabMenuRef}
              className="inline-side-chat-tab-menu"
              role="menu"
              aria-label="Side chat tab actions"
              style={{ left: sideChatTabMenu.x, top: sideChatTabMenu.y }}
            >
              <button
                className="inline-side-chat-tab-menu-item"
                type="button"
                role="menuitem"
                data-variant="danger"
                disabled={deletingSideChatTabID !== null}
                onClick={() => void handleDeleteSideChatTab(sideChatTabMenu.sessionID)}
              >
                <span className="inline-side-chat-tab-menu-icon" aria-hidden="true">
                  <DeleteIcon />
                </span>
                <span className="inline-side-chat-tab-menu-label">Archive</span>
              </button>
            </div>,
            document.body,
          )
        : null}

      <div className="inline-side-chat-body">
        {shouldRenderNestedThread ? (
          <ThreadView
            activeProjectID={activeProjectID}
            activeSession={session}
            activeMessages={effectiveMessages}
            assistantTraceVisibility={assistantTraceVisibility}
            composerRefreshVersion={composerRefreshVersion}
            isAgentDebugTraceEnabled={isAgentDebugTraceEnabled}
            isResolvingPermissionRequest={isResolvingPermissionRequest}
            isSessionRunning={isSending || isInterruptible}
            pendingConversationInputs={pendingInputs}
            pendingPermissionRequests={pendingPermissionRequests}
            permissionRequestActionError={permissionRequestActionError}
            permissionRequestActionRequestID={permissionRequestActionRequestID}
            sideChatCountsByAnchorMessageID={{}}
            scrollStateKey={`side-chat:${session.origin?.parentSessionID ?? "unknown"}:${session.id}`}
            threadColumnRef={threadColumnRef}
            isThreadVisible={isThreadVisible}
            readScrollSnapshot={readScrollSnapshot}
            saveScrollSnapshot={saveScrollSnapshot}
            onAskUserQuestionAnswer={(answer) =>
              onAskUserQuestionAnswer({
                ...answer,
                sessionID: session.id,
              })
            }
            onArtifactLinkOpen={onArtifactLinkOpen}
            onLocalFileLinkOpen={onLocalFileLinkOpen}
            onPermissionRequestResponse={onPermissionRequestResponse}
          />
        ) : null}

        <ComposerConcurrentInputDrawer
          canSteer
          hasPendingPermissionRequests={pendingPermissionRequests.length > 0 || isResolvingPermissionRequest}
          isCancelling={isCancelling}
          pendingInputs={pendingSubmissionInputs}
          onSteerQueuedMessage={(input) =>
            void onSend({
              selectedReasoningEffort: composer.selectedReasoningEffort,
              selectedModel: composer.selectedModel,
              selectedSkillIDs: composer.selectedSkillIDs,
              steerQueuedMessageID: input.id,
              waitForPendingModelSelection: composer.awaitPendingModelSelection,
            })
          }
        />
        <Composer
          attachments={attachments}
          attachmentButtonTitle={composer.attachmentButtonTitle}
          attachmentDisabledReason={composer.attachmentDisabledReason}
          attachmentError={composer.attachmentError}
          canSend
          canPasteImageAttachments={
            Boolean(onPasteImageAttachments) && composer.attachmentCapabilities.image && composer.attachmentDisabledReason === null
          }
          draftState={draftState}
          hasPendingPermissionRequests={pendingPermissionRequests.length > 0 || isResolvingPermissionRequest}
          isCancelling={isCancelling}
          isInterruptible={isInterruptible}
          isSending={isSending}
          mcpOptions={composer.mcpOptions}
          modelOptions={composer.modelOptions}
          reasoningEffortOptions={composer.reasoningEffortOptions}
          selectedMcpServerIDs={composer.selectedMcpServerIDs}
          selectedModel={composer.selectedModel}
          selectedModelLabel={composer.selectedModelLabel}
          selectedReasoningEffort={composer.selectedReasoningEffort}
          selectedReasoningEffortLabel={composer.selectedReasoningEffortLabel}
          selectedSkillIDs={composer.selectedSkillIDs}
          showModelSelector={false}
          placeholder="Ask a follow-up about this reply."
          showProjectTagCommands={false}
          skillOptions={composer.skillOptions}
          unsupportedAttachmentPaths={composer.unsupportedAttachmentPaths}
          workspaceDirectory={null}
          onDraftStateChange={onDraftStateChange}
          onModelChange={composer.handleModelChange}
          onReasoningEffortChange={composer.handleReasoningEffortChange}
          onPickAttachments={() =>
            onPickAttachments({
              allowImage: composer.attachmentCapabilities.image,
              allowPdf: composer.attachmentCapabilities.pdf,
              disabledReason: composer.attachmentDisabledReason,
            })
          }
          onPasteImageAttachments={
            onPasteImageAttachments
              ? (images) =>
                  onPasteImageAttachments({
                    allowImage: composer.attachmentCapabilities.image,
                    disabledReason: composer.attachmentDisabledReason,
                    images,
                  })
              : undefined
          }
          onRemoveAttachment={onRemoveAttachment}
          onCancelSend={onCancelSend}
          onSend={(draftStateOverride) =>
            void onSend({
              attachmentError: composer.attachmentError,
              draftStateOverride,
              selectedReasoningEffort: composer.selectedReasoningEffort,
              selectedModel: composer.selectedModel,
              selectedSkillIDs: composer.selectedSkillIDs,
              submissionMode: isSending || isInterruptible ? "queued" : undefined,
              waitForPendingModelSelection: composer.awaitPendingModelSelection,
            })
          }
        />
      </div>
    </section>
  )
}

function formatTraceStatusText(status?: AssistantTraceItem["status"]) {
  switch (status) {
    case "waiting-approval":
      return "waiting approval"
    case "completed":
      return "completed"
    case "running":
      return "running"
    case "pending":
      return "pending"
    case "error":
      return "error"
    case "denied":
      return "denied"
    case "cancelled":
      return "cancelled"
    default:
      return null
  }
}

function parseProposedPlanBlock(text: string | null | undefined) {
  const raw = text?.trim() ?? ""
  const openTagIndex = raw.indexOf(PROPOSED_PLAN_OPEN_TAG)
  if (openTagIndex < 0) return null

  const contentStartIndex = openTagIndex + PROPOSED_PLAN_OPEN_TAG.length
  const closeTagIndex = raw.indexOf(PROPOSED_PLAN_CLOSE_TAG, contentStartIndex)
  const isComplete = closeTagIndex >= 0
  const contentEndIndex = isComplete ? closeTagIndex : raw.length
  const rawEndIndex = isComplete ? closeTagIndex + PROPOSED_PLAN_CLOSE_TAG.length : raw.length
  const markdown = raw.slice(contentStartIndex, contentEndIndex).trim()

  return {
    raw: raw.slice(openTagIndex, rawEndIndex).trim(),
    markdown,
    isComplete,
  }
}

function getProposedPlanStateText(status: ProposedPlanCardStatus) {
  switch (status) {
    case "cancelled":
      return "已取消"
    case "confirmed":
      return "已确认"
    case "confirming":
      return "确认中..."
    case "idle":
      return null
  }
}

function ProposedPlanCard({
  planMarkdown,
  rawPlanMarkdown,
  isComplete,
  isLatestMessage,
  onConfirm,
}: {
  planMarkdown: string
  rawPlanMarkdown: string
  isComplete: boolean
  isLatestMessage: boolean
  onConfirm?: ProposedPlanConfirmHandler
}) {
  const [status, setStatus] = useState<ProposedPlanCardStatus>("idle")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const stateText = getProposedPlanStateText(status)
  const showActions = isLatestMessage && status === "idle"
  const showState = isLatestMessage && Boolean(stateText)
  const isActionDisabled = !isComplete || status !== "idle"

  async function handleConfirm() {
    if (!isComplete || !onConfirm || status !== "idle") return

    setStatus("confirming")
    setErrorMessage(null)
    try {
      await onConfirm({ planMarkdown: rawPlanMarkdown })
      setStatus("confirmed")
    } catch (error) {
      setStatus("idle")
      setErrorMessage(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <article className="proposed-plan-card" aria-label="Proposed plan">
      <div className="proposed-plan-card-body">
        <ThreadMarkdown className="proposed-plan-markdown thread-markdown" text={planMarkdown} />
      </div>
      <div className="proposed-plan-actions">
        {errorMessage ? <span className="proposed-plan-error">{errorMessage}</span> : null}
        {showState ? <span className="proposed-plan-state">{stateText}</span> : null}
        {showActions ? (
          <>
            <button
              className="secondary-button"
              disabled={isActionDisabled}
              type="button"
              onClick={() => setStatus("cancelled")}
            >
              取消
            </button>
            <button
              className="primary-button"
              disabled={!onConfirm || isActionDisabled}
              type="button"
              onClick={() => void handleConfirm()}
            >
              确认实施
            </button>
          </>
        ) : null}
      </div>
    </article>
  )
}

interface TraceItemViewProps {
  assistantMessagePhase?: AssistantThreadMessagePhase
  item: AssistantTraceItem
  isQuestionAnswered?: boolean
  isQuestionAnswerDisabled?: boolean
  isLatestMessage?: boolean
  onOpenImagePreview?: (payload: ImagePreviewPayload) => void
  onAskUserQuestionAnswer?: QuestionAnswerHandler
  onFileChangeSelect?: (file: string) => void
  onArtifactLinkOpen?: (target: MarkdownArtifactLinkTarget) => void
  onLocalFileLinkOpen?: (target: MarkdownLocalFileLinkTarget) => void
  onProposedPlanConfirm?: ProposedPlanConfirmHandler
  shouldCollapseAfterMessageCompletion?: boolean
  traceVisibility: AssistantTraceVisibility
}

type RequiredTraceItemRendererProps = Required<
  Pick<
    TraceItemViewProps,
    "isQuestionAnswerDisabled" | "isLatestMessage" | "shouldCollapseAfterMessageCompletion"
  >
>

type TraceItemRendererProps = RequiredTraceItemRendererProps &
  Pick<
    TraceItemViewProps,
    | "assistantMessagePhase"
    | "item"
    | "isQuestionAnswered"
    | "onAskUserQuestionAnswer"
    | "onArtifactLinkOpen"
    | "onFileChangeSelect"
    | "onLocalFileLinkOpen"
    | "onOpenImagePreview"
    | "onProposedPlanConfirm"
    | "traceVisibility"
  > & {
    className: string
    debugEntries: AssistantTraceDebugEntry[]
    isResponseItem: boolean
  }

function TraceItemDebugEntries({
  debugEntries,
  itemID,
}: {
  debugEntries: AssistantTraceDebugEntry[]
  itemID: string
}) {
  if (debugEntries.length === 0) return null

  return (
    <div className="trace-item-debug">
      {debugEntries.map((entry) => (
        <div key={`${itemID}-${entry.label}`} className="trace-item-debug-row">
          <span className="trace-item-debug-label">{entry.label}</span>
          <span className="trace-item-debug-value">{entry.value}</span>
        </div>
      ))}
    </div>
  )
}

function TraceItemHeader({
  item,
  statusText,
}: {
  item: AssistantTraceItem
  statusText?: string | null
}) {
  return (
    <div className="trace-item-header">
      <span className="trace-item-label">{item.label}</span>
      {item.title ? <strong className="trace-item-title">{item.title}</strong> : null}
      {item.status ? <span className={`trace-item-status is-${item.status}`}>{statusText ?? item.status}</span> : null}
    </div>
  )
}

function CompletedResponseText({
  className,
  onArtifactLinkOpen,
  onLocalFileLinkOpen,
  text,
}: {
  className: string
  onArtifactLinkOpen?: (target: MarkdownArtifactLinkTarget) => void
  onLocalFileLinkOpen?: (target: MarkdownLocalFileLinkTarget) => void
  text: string
}) {
  const response = parseAssistantResponseFormat(text)

  if (response.format === "html") {
    return (
      <ThreadHtml
        className={joinClassNames(className, "thread-html")}
        text={response.text}
        onArtifactLinkOpen={onArtifactLinkOpen}
        onLocalFileLinkOpen={onLocalFileLinkOpen}
      />
    )
  }

  return (
    <ThreadMarkdown
      className={joinClassNames(className, "thread-markdown")}
      text={response.text}
      onArtifactLinkOpen={onArtifactLinkOpen}
      onLocalFileLinkOpen={onLocalFileLinkOpen}
    />
  )
}

function StreamingResponseText({
  className,
  onArtifactLinkOpen,
  onLocalFileLinkOpen,
  text,
}: {
  className: string
  onArtifactLinkOpen?: (target: MarkdownArtifactLinkTarget) => void
  onLocalFileLinkOpen?: (target: MarkdownLocalFileLinkTarget) => void
  text: string
}) {
  const response = parseAssistantResponseFormat(text)
  if (response.marker && response.format === "html") {
    return (
      <ThreadRichText
        className={className}
        text={response.text}
        onArtifactLinkOpen={onArtifactLinkOpen}
        onLocalFileLinkOpen={onLocalFileLinkOpen}
      />
    )
  }

  const markdownText = response.marker ? response.text : stripStreamingResponseFormatMarker(text)
  if (!markdownText) return null

  return (
    <ThreadMarkdown
      className={joinClassNames(className, "thread-markdown")}
      text={markdownText}
      onArtifactLinkOpen={onArtifactLinkOpen}
      onLocalFileLinkOpen={onLocalFileLinkOpen}
    />
  )
}

function ResponseText({
  className,
  isStreaming,
  onArtifactLinkOpen,
  onLocalFileLinkOpen,
  text,
}: {
  className: string
  isStreaming?: boolean
  onArtifactLinkOpen?: (target: MarkdownArtifactLinkTarget) => void
  onLocalFileLinkOpen?: (target: MarkdownLocalFileLinkTarget) => void
  text: string
}) {
  if (isStreaming) {
    return (
      <StreamingResponseText
        className={className}
        text={text}
        onArtifactLinkOpen={onArtifactLinkOpen}
        onLocalFileLinkOpen={onLocalFileLinkOpen}
      />
    )
  }

  return (
    <CompletedResponseText
      className={className}
      text={text}
      onArtifactLinkOpen={onArtifactLinkOpen}
      onLocalFileLinkOpen={onLocalFileLinkOpen}
    />
  )
}

function TraceItemTextBody({
  isResponseItem,
  item,
  onArtifactLinkOpen,
  onLocalFileLinkOpen,
}: {
  isResponseItem: boolean
  item: AssistantTraceItem
  onArtifactLinkOpen?: (target: MarkdownArtifactLinkTarget) => void
  onLocalFileLinkOpen?: (target: MarkdownLocalFileLinkTarget) => void
}) {
  return (
    <>
      {item.text ? (
        isResponseItem ? (
          <ResponseText
            className="trace-item-text"
            text={item.text}
            isStreaming={item.isStreaming}
            onArtifactLinkOpen={onArtifactLinkOpen}
            onLocalFileLinkOpen={onLocalFileLinkOpen}
          />
        ) : (
          <ThreadRichText
            className="trace-item-text"
            text={item.text}
          />
        )
      ) : null}
      {item.detail ? (
        isResponseItem ? (
          <ResponseText
            className="trace-item-detail"
            text={item.detail}
            isStreaming={item.isStreaming}
            onArtifactLinkOpen={onArtifactLinkOpen}
            onLocalFileLinkOpen={onLocalFileLinkOpen}
          />
        ) : (
          <ThreadRichText
            className="trace-item-detail"
            text={item.detail}
          />
        )
      ) : null}
    </>
  )
}

function TraceItemFileActions({
  filePaths,
  itemID,
  onFileChangeSelect,
}: {
  filePaths: string[]
  itemID: string
  onFileChangeSelect?: (file: string) => void
}) {
  if (filePaths.length === 0 || !onFileChangeSelect) return null

  return (
    <div className="trace-item-file-actions">
      {filePaths.map((filePath) => (
        <button
          key={`${itemID}-${filePath}`}
          type="button"
          className="trace-item-file-chip"
          onClick={() => onFileChangeSelect(filePath)}
        >
          {filePath}
        </button>
      ))}
    </div>
  )
}

const TRACE_FILE_CHANGE_OPERATIONS = new Set<NonNullable<AssistantTraceFileChange["operation"]>>([
  "add",
  "delete",
  "move",
  "update",
])

const TRACE_FILE_CHANGE_PREVIEW_STATES = new Set<NonNullable<AssistantTraceFileChange["previewState"]>>([
  "complete",
  "invalid",
  "streaming",
  "truncated",
])

const TRACE_FILE_CHANGE_PREVIEW_ROW_TONES = new Set(["add", "context", "remove"])

function normalizeTraceFileChangeNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

function normalizeTraceFileChangeString(value: unknown) {
  return typeof value === "string" ? value : ""
}

function normalizeTraceFileChangeOperation(value: unknown): AssistantTraceFileChange["operation"] | undefined {
  return typeof value === "string" && TRACE_FILE_CHANGE_OPERATIONS.has(value as NonNullable<AssistantTraceFileChange["operation"]>)
    ? value as NonNullable<AssistantTraceFileChange["operation"]>
    : undefined
}

function normalizeTraceFileChangePreviewState(value: unknown): AssistantTraceFileChange["previewState"] | undefined {
  return typeof value === "string" && TRACE_FILE_CHANGE_PREVIEW_STATES.has(value as NonNullable<AssistantTraceFileChange["previewState"]>)
    ? value as NonNullable<AssistantTraceFileChange["previewState"]>
    : undefined
}

function normalizeTracePreviewHunks(value: unknown): AssistantTraceFileChange["previewHunks"] | undefined {
  if (!Array.isArray(value)) return undefined

  const hunks = value.flatMap((hunk): NonNullable<AssistantTraceFileChange["previewHunks"]> => {
    if (!hunk || typeof hunk !== "object") return []
    const record = hunk as { header?: unknown; rows?: unknown }
    if (!Array.isArray(record.rows)) return []

    const rows = record.rows.flatMap((row): NonNullable<AssistantTraceFileChange["previewHunks"]>[number]["rows"] => {
      if (!row || typeof row !== "object") return []
      const rowRecord = row as { content?: unknown; tone?: unknown }
      if (typeof rowRecord.tone !== "string" || !TRACE_FILE_CHANGE_PREVIEW_ROW_TONES.has(rowRecord.tone)) return []
      return [{
        content: normalizeTraceFileChangeString(rowRecord.content),
        tone: rowRecord.tone as "add" | "context" | "remove",
      }]
    })
    if (rows.length === 0) return []

    return [{
      header: normalizeTraceFileChangeString(record.header).trim() || "Patch hunk",
      rows,
    }]
  })

  return hunks.length > 0 ? hunks : undefined
}

function normalizeTraceFileChanges(value: unknown): AssistantTraceFileChange[] {
  if (!Array.isArray(value)) return []

  return value.flatMap((change): AssistantTraceFileChange[] => {
    if (!change || typeof change !== "object") return []
    const record = change as Record<string, unknown>
    const file = normalizeTraceFileChangeString(record.file).trim()
    if (!file) return []

    const patch = normalizeTraceFileChangeString(record.patch)
    const fromFile = normalizeTraceFileChangeString(record.fromFile).trim()
    const operation = normalizeTraceFileChangeOperation(record.operation)
    const previewHunks = normalizeTracePreviewHunks(record.previewHunks)
    const previewState = normalizeTraceFileChangePreviewState(record.previewState)

    return [{
      file,
      additions: normalizeTraceFileChangeNumber(record.additions),
      deletions: normalizeTraceFileChangeNumber(record.deletions),
      ...(fromFile ? { fromFile } : {}),
      ...(operation ? { operation } : {}),
      ...(patch ? { patch } : {}),
      ...(previewHunks ? { previewHunks } : {}),
      ...(previewState ? { previewState } : {}),
    }]
  })
}

function normalizeTraceFilePaths(value: unknown) {
  if (!Array.isArray(value)) return []
  return value
    .map((file) => normalizeTraceFileChangeString(file).trim())
    .filter(Boolean)
}

function normalizePatchFileChanges(item: AssistantTraceItem): AssistantTraceFileChange[] {
  const itemFileChanges = normalizeTraceFileChanges(item.fileChanges)
  const changes = itemFileChanges.length > 0 ? itemFileChanges : normalizeTraceFileChanges(item.draftPatch?.fileChanges)
  if (changes.length > 0) return changes

  return normalizeTraceFilePaths(item.filePaths)
    .map((file) => ({
      file,
      additions: 0,
      deletions: 0,
    }))
}

function hasFileChangePreview(change: AssistantTraceFileChange) {
  return Boolean(change.patch?.trim()) || Boolean(normalizeTracePreviewHunks(change.previewHunks)?.length)
}

type DraftPatchActionPhase = "live" | "completed" | "error" | "cancelled" | "denied"

function getDraftPatchActionPhase(status: AssistantTraceItem["status"] | undefined, isStreaming: boolean): DraftPatchActionPhase {
  if (isStreaming || status === "running" || status === "pending") return "live"
  if (status === "error") return "error"
  if (status === "cancelled") return "cancelled"
  if (status === "denied") return "denied"
  return "completed"
}

function getDraftPatchActionLabel(change: AssistantTraceFileChange, phase: DraftPatchActionPhase) {
  if (phase === "cancelled") return "已取消"
  if (phase === "denied") return "已拒绝"

  switch (change.operation) {
    case "add":
      return phase === "live" ? "正在创建" : phase === "error" ? "创建失败" : "已创建"
    case "delete":
      return phase === "live" ? "正在删除" : phase === "error" ? "删除失败" : "已删除"
    case "move":
      return phase === "live" ? "正在移动" : phase === "error" ? "移动失败" : "已移动"
    case "update":
      return phase === "live" ? "正在修改" : phase === "error" ? "修改失败" : "已修改"
    default:
      return phase === "live" ? "正在变更" : phase === "error" ? "变更失败" : "已变更"
  }
}

function getFileChangeActionLabel(
  change: AssistantTraceFileChange,
  isDraftPatch: boolean,
  phase: DraftPatchActionPhase,
) {
  if (!isDraftPatch) return "已编辑"
  return getDraftPatchActionLabel(change, phase)
}

function getDraftPatchSummaryLabel(
  fileChanges: AssistantTraceFileChange[],
  phase: DraftPatchActionPhase,
) {
  const operations = new Set(fileChanges.map((change) => change.operation ?? "update"))
  const summaryChange: AssistantTraceFileChange = operations.size === 1
    ? {
        file: "",
        additions: 0,
        deletions: 0,
        operation: fileChanges[0]?.operation ?? "update",
      }
    : {
        file: "",
        additions: 0,
        deletions: 0,
      }
  return `${getDraftPatchActionLabel(summaryChange, phase)} ${fileChanges.length} 个文件`
}

function getFileChangePreviewNote(change: AssistantTraceFileChange) {
  if (change.previewState === "truncated") return "已截断"
  if (change.previewState === "invalid") return "解析失败"
  return ""
}

function getPatchPreviewState(
  change: AssistantTraceFileChange,
  isFullPatchVisible: boolean,
): {
  change: AssistantTraceFileChange
  state: PatchPreviewState
  preview: TraceTextPreview | null
} {
  if (!change.patch || isFullPatchVisible) {
    return {
      change,
      state: isFullPatchVisible ? "full" : "summary",
      preview: null,
    }
  }

  const preview = createTraceTextPreview(change.patch, {
    characterLimit: TRACE_PATCH_PREVIEW_CHARACTER_LIMIT,
    lineLimit: TRACE_PATCH_PREVIEW_LINE_LIMIT,
    trim: false,
  })

  return {
    change: preview.isTruncated
      ? {
          ...change,
          patch: preview.text,
          previewHunks: undefined,
          previewState: "truncated",
        }
      : change,
    state: preview.isTruncated ? "preview" : "full",
    preview,
  }
}

function getPrimaryPatchFileChange(fileChanges: AssistantTraceFileChange[]) {
  return fileChanges.find(hasFileChangePreview) ?? fileChanges[0] ?? null
}

function getPatchPreviewResetSignature(fileChanges: AssistantTraceFileChange[], isDraftPatch: boolean) {
  if (isDraftPatch) {
    return fileChanges
      .map((change) => [change.file, change.fromFile ?? "", change.operation ?? ""].join("\u0000"))
      .join("\u0001")
  }

  return fileChanges
    .map((change) =>
      [
        change.file,
        change.additions,
        change.deletions,
        Boolean(change.patch?.trim()),
        hasFileChangePreview(change),
        change.previewState ?? "",
      ].join("\u0000")
    )
    .join("\u0001")
}

function useToolDraftPatchPreviewState({
  fileChanges,
  id,
  isDraftPatch,
}: {
  fileChanges: AssistantTraceFileChange[]
  id: string
  isDraftPatch: boolean
}) {
  const resetSignature = getPatchPreviewResetSignature(fileChanges, isDraftPatch)
  const [isListExpanded, setIsListExpanded] = useState(false)
  const [expandedFile, setExpandedFile] = useState<string | null>(null)
  const [fullHeightFile, setFullHeightFile] = useState<string | null>(null)
  const [fullPatchFile, setFullPatchFile] = useState<string | null>(null)

  useLayoutEffect(() => {
    setIsListExpanded(false)
    setExpandedFile(null)
    setFullHeightFile(null)
    setFullPatchFile(null)
  }, [id, resetSignature])

  function toggleList() {
    setIsListExpanded((current) => {
      const next = !current
      if (!next) {
        setExpandedFile(null)
        setFullHeightFile(null)
        setFullPatchFile(null)
      }
      return next
    })
  }

  return {
    expandedFile,
    fullPatchFile,
    fullHeightFile,
    isListExpanded,
    listID: `trace-file-change-list-${id}`,
    setExpandedFile,
    setFullPatchFile,
    setFullHeightFile,
    toggleList,
  }
}

function FileChangeInlineSummary({
  actionPlacement = "before",
  change,
  draftPatchStatus,
  isDraftPatch,
  isLive,
  showLiveDot = false,
}: {
  actionPlacement?: "before" | "after" | "none"
  change: AssistantTraceFileChange
  draftPatchStatus?: AssistantTraceItem["status"]
  isDraftPatch: boolean
  isLive: boolean
  showLiveDot?: boolean
}) {
  const phase = getDraftPatchActionPhase(draftPatchStatus, isLive)
  const actionLabel = <span className="trace-file-change-action">{getFileChangeActionLabel(change, isDraftPatch, phase)}</span>

  return (
    <>
      {actionPlacement === "before" ? actionLabel : null}
      <span className="trace-file-change-file">{change.file}</span>
      <span
        className={joinClassNames("trace-file-change-stats", isLive ? "is-live" : undefined)}
        aria-label={`${change.additions} additions, ${change.deletions} deletions`}
      >
        <span className="is-add">+{change.additions}</span>
        <span className="is-remove">-{change.deletions}</span>
      </span>
      {actionPlacement === "after" ? actionLabel : null}
      {showLiveDot ? <span className="trace-file-change-live-dot" aria-label="正在更新" /> : null}
    </>
  )
}

function ToolDraftPatchSummaryButton({
  fileChanges,
  isExpanded,
  isStreaming,
  listID,
  onToggle,
  status,
}: {
  fileChanges: AssistantTraceFileChange[]
  isExpanded: boolean
  isStreaming: boolean
  listID: string
  onToggle: () => void
  status?: AssistantTraceItem["status"]
}) {
  const primaryFileChange = getPrimaryPatchFileChange(fileChanges)
  if (!primaryFileChange) return null
  const phase = getDraftPatchActionPhase(status, isStreaming)
  const summaryLabel = phase === "completed" ? `${fileChanges.length} 个文件` : getDraftPatchSummaryLabel(fileChanges, phase)
  const showsSingleFileSummary = fileChanges.length === 1

  return (
    <button
      type="button"
      className="trace-file-change-summary trace-tool-inline-draft-patch-summary"
      aria-expanded={isExpanded}
      aria-controls={listID}
      onClick={onToggle}
    >
      <span className={joinClassNames("trace-file-change-summary-label", showsSingleFileSummary && "has-file-change")}>
        {showsSingleFileSummary ? (
          <FileChangeInlineSummary
            actionPlacement="none"
            change={primaryFileChange}
            draftPatchStatus={status}
            isDraftPatch
            isLive={isStreaming}
          />
        ) : (
          summaryLabel
        )}
      </span>
      <span
        className={joinClassNames(
          "trace-file-change-live-dot",
          isStreaming ? undefined : "is-hidden",
        )}
        aria-label="正在更新"
        aria-hidden={isStreaming ? undefined : true}
      />
      <span className="trace-file-change-summary-chevron" aria-hidden="true">
        {isExpanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
      </span>
    </button>
  )
}

function ToolDraftPatchFileChangeList({
  expandedFile,
  fileChanges,
  fullPatchFile,
  fullHeightFile,
  id,
  isStreaming,
  listID,
  setExpandedFile,
  setFullPatchFile,
  setFullHeightFile,
  status,
}: {
  expandedFile: string | null
  fileChanges: AssistantTraceFileChange[]
  fullPatchFile: string | null
  fullHeightFile: string | null
  id: string
  isStreaming: boolean
  listID: string
  setExpandedFile: (updater: (current: string | null) => string | null) => void
  setFullPatchFile: (updater: (current: string | null) => string | null) => void
  setFullHeightFile: (updater: (current: string | null) => string | null) => void
  status?: AssistantTraceItem["status"]
}) {
  if (fileChanges.length === 1) {
    const change = fileChanges[0]!
    const hasPatch = hasFileChangePreview(change)
    const patchPreview = getPatchPreviewState(change, fullPatchFile === change.file)
    const previewNote = getFileChangePreviewNote(change)
    const previewID = `trace-file-change-${id}-0`

    return (
      <div id={listID} className="trace-file-change-list is-single-file">
        {!hasPatch && !previewNote ? <span className="trace-file-change-note">仅摘要</span> : null}
        {previewNote ? <span className="trace-file-change-note">{previewNote}</span> : null}
        {hasPatch ? (
          <div id={previewID} className="trace-file-change-preview is-single-file">
            <DiffPreview
              className="trace-historical-diff"
              emptyClassName="trace-historical-diff-empty"
              file={patchPreview.change.file}
              isFullHeight={fullHeightFile === change.file}
              onToggleFullHeight={() =>
                setFullHeightFile((current) => current === change.file ? null : change.file)
              }
              patch={patchPreview.change.patch}
              previewHunks={patchPreview.change.previewHunks}
              stickToBottom={isStreaming}
              viewMode="unified"
            />
            {patchPreview.state === "preview" ? (
              <button
                type="button"
                className="trace-file-change-row is-static"
                onClick={() => setFullPatchFile(() => change.file)}
              >
                Show full diff
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div id={listID} className="trace-file-change-list">
      {fileChanges.map((change, changeIndex) => {
        const hasPatch = hasFileChangePreview(change)
        const isExpanded = expandedFile === change.file
        const patchPreview = getPatchPreviewState(change, fullPatchFile === change.file)
        const previewID = `trace-file-change-${id}-${changeIndex}`
        const previewNote = getFileChangePreviewNote(change)
        const rowContent = (
          <>
            <span className="trace-file-change-toggle-icon" aria-hidden="true">
              {hasPatch ? (isExpanded ? <ChevronDownIcon /> : <ChevronRightIcon />) : null}
            </span>
            <FileChangeInlineSummary
              change={change}
              draftPatchStatus={status}
              isDraftPatch
              isLive={isStreaming}
              showLiveDot={isStreaming}
            />
            {!hasPatch ? <span className="trace-file-change-note">仅摘要</span> : null}
            {previewNote ? <span className="trace-file-change-note">{previewNote}</span> : null}
          </>
        )

        return (
          <div key={`${id}-${change.file}-${changeIndex}`} className="trace-file-change-entry">
            {hasPatch ? (
              <button
                type="button"
                className="trace-file-change-row"
                aria-expanded={isExpanded}
                aria-controls={previewID}
                onClick={() => setExpandedFile((current) => current === change.file ? null : change.file)}
              >
                {rowContent}
              </button>
            ) : (
              <div className="trace-file-change-row is-static">
                {rowContent}
              </div>
            )}
            {hasPatch && isExpanded ? (
              <div id={previewID} className="trace-file-change-preview">
                <DiffPreview
                  className="trace-historical-diff"
                  emptyClassName="trace-historical-diff-empty"
                  file={patchPreview.change.file}
                  isFullHeight={fullHeightFile === change.file}
                  onToggleFullHeight={() =>
                    setFullHeightFile((current) => current === change.file ? null : change.file)
                  }
                  patch={patchPreview.change.patch}
                  previewHunks={patchPreview.change.previewHunks}
                  stickToBottom={isStreaming}
                  viewMode="unified"
                />
                {patchPreview.state === "preview" ? (
                  <button
                    type="button"
                    className="trace-file-change-row is-static"
                    onClick={() => setFullPatchFile(() => change.file)}
                  >
                    Show full diff
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

function GenericTraceItemView({
  className,
  debugEntries,
  isResponseItem,
  item,
  onFileChangeSelect,
  onArtifactLinkOpen,
  onLocalFileLinkOpen,
  showFileActions = false,
}: TraceItemRendererProps & {
  showFileActions?: boolean
}) {
  const selectableFilePaths = showFileActions ? item.filePaths?.filter(Boolean) ?? [] : []

  return (
    <article className={className} data-kind={item.kind} data-trace-item-id={item.id}>
      <TraceItemHeader item={item} />
      <TraceItemTextBody
        item={item}
        isResponseItem={isResponseItem}
        onArtifactLinkOpen={onArtifactLinkOpen}
        onLocalFileLinkOpen={onLocalFileLinkOpen}
      />
      <TraceItemFileActions
        filePaths={selectableFilePaths}
        itemID={item.id}
        onFileChangeSelect={onFileChangeSelect}
      />
      <TraceItemDebugEntries debugEntries={debugEntries} itemID={item.id} />
    </article>
  )
}

function SystemTraceItemView(props: TraceItemRendererProps) {
  return <GenericTraceItemView {...props} />
}

function SourceTraceItemView(props: TraceItemRendererProps) {
  return <GenericTraceItemView {...props} />
}

function FileTraceItemView(props: TraceItemRendererProps) {
  return <GenericTraceItemView {...props} />
}

function PatchFileChangePreview({
  debugEntries = [],
  draftPatchStatus,
  fileChanges,
  id,
  isDraftPatch,
  isStreaming,
  defaultExpanded = false,
}: {
  debugEntries?: AssistantTraceDebugEntry[]
  draftPatchStatus?: AssistantTraceItem["status"]
  fileChanges: AssistantTraceFileChange[]
  id: string
  isDraftPatch: boolean
  isStreaming: boolean
  defaultExpanded?: boolean
}) {
  const fileChangeSignature = fileChanges
    .map((change) =>
      [
        change.file,
        change.additions,
        change.deletions,
        Boolean(change.patch?.trim()),
        hasFileChangePreview(change),
        change.previewState ?? "",
      ].join("\u0000")
    )
    .join("\u0001")
  const fileChangeIdentitySignature = fileChanges
    .map((change) => [change.file, change.fromFile ?? "", change.operation ?? ""].join("\u0000"))
    .join("\u0001")
  const expansionResetSignature = isDraftPatch ? fileChangeIdentitySignature : fileChangeSignature
  const [isListExpanded, setIsListExpanded] = useState(defaultExpanded)
  const [expandedFile, setExpandedFile] = useState<string | null>(null)
  const [fullHeightFile, setFullHeightFile] = useState<string | null>(null)
  const [fullPatchFile, setFullPatchFile] = useState<string | null>(null)

  useEffect(() => {
    setIsListExpanded(defaultExpanded)
    setExpandedFile(null)
    setFullHeightFile(null)
    setFullPatchFile(null)
  }, [defaultExpanded, expansionResetSignature, id])

  const listID = `trace-file-change-list-${id}`
  const primaryFileChange = getPrimaryPatchFileChange(fileChanges)
  const editedFileSummary = `已编辑 ${fileChanges.length} 个文件`
  const draftPatchPhase = getDraftPatchActionPhase(draftPatchStatus, isStreaming)
  const draftFileSummary = getDraftPatchSummaryLabel(fileChanges, draftPatchPhase)
  const handleSummaryToggle = () => {
    const nextIsListExpanded = !isListExpanded
    setIsListExpanded(nextIsListExpanded)
    if (!nextIsListExpanded) {
      setExpandedFile(null)
      setFullHeightFile(null)
      setFullPatchFile(null)
    }
  }

  return (
    <>
      <button
        type="button"
        className="trace-file-change-summary"
        aria-expanded={isListExpanded}
        aria-controls={listID}
        onClick={handleSummaryToggle}
      >
        <span className="trace-file-change-summary-icon" aria-hidden="true">
          <ChangesIcon />
        </span>
        {isDraftPatch && primaryFileChange ? (
          <>
            <span className="trace-file-change-summary-label">{draftFileSummary}</span>
            <span
              className={joinClassNames(
                "trace-file-change-live-dot",
                isStreaming ? undefined : "is-hidden",
              )}
              aria-label="正在更新"
              aria-hidden={isStreaming ? undefined : true}
            />
          </>
        ) : (
          <>
            <span className="trace-file-change-summary-label">{editedFileSummary}</span>
            <span aria-hidden="true" />
          </>
        )}
        <span className="trace-file-change-summary-chevron" aria-hidden="true">
          {isListExpanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
        </span>
      </button>
      {isListExpanded ? (
        <div id={listID} className="trace-file-change-list">
          {fileChanges.map((change, changeIndex) => {
            const hasPatch = hasFileChangePreview(change)
            const isExpanded = expandedFile === change.file
            const patchPreview = getPatchPreviewState(change, fullPatchFile === change.file)
            const previewID = `trace-file-change-${id}-${changeIndex}`
            const previewNote = getFileChangePreviewNote(change)
            const rowContent = (
              <>
                <span className="trace-file-change-toggle-icon" aria-hidden="true">
                  {hasPatch ? (isExpanded ? <ChevronDownIcon /> : <ChevronRightIcon />) : null}
                </span>
                <FileChangeInlineSummary
                  change={change}
                  draftPatchStatus={draftPatchStatus}
                  isDraftPatch={isDraftPatch}
                  isLive={isDraftPatch && isStreaming}
                  showLiveDot={isDraftPatch && isStreaming}
                />
                {!hasPatch ? <span className="trace-file-change-note">仅摘要</span> : null}
                {previewNote ? <span className="trace-file-change-note">{previewNote}</span> : null}
              </>
            )

            return (
              <div key={`${id}-${change.file}-${changeIndex}`} className="trace-file-change-entry">
                {hasPatch ? (
                  <button
                    type="button"
                    className="trace-file-change-row"
                    aria-expanded={isExpanded}
                    aria-controls={previewID}
                    onClick={() => setExpandedFile((current) => current === change.file ? null : change.file)}
                  >
                    {rowContent}
                  </button>
                ) : (
                  <div className="trace-file-change-row is-static">
                    {rowContent}
                  </div>
                )}
                {hasPatch && isExpanded ? (
                  <div id={previewID} className="trace-file-change-preview">
                    <DiffPreview
                      className="trace-historical-diff"
                      emptyClassName="trace-historical-diff-empty"
                      file={patchPreview.change.file}
                      isFullHeight={fullHeightFile === change.file}
                      onToggleFullHeight={() =>
                        setFullHeightFile((current) => current === change.file ? null : change.file)
                      }
                      patch={patchPreview.change.patch}
                      previewHunks={patchPreview.change.previewHunks}
                      stickToBottom={isDraftPatch && isStreaming}
                      viewMode="unified"
                    />
                    {patchPreview.state === "preview" ? (
                      <button
                        type="button"
                        className="trace-file-change-row is-static"
                        onClick={() => setFullPatchFile(() => change.file)}
                      >
                        Show full diff
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            )
          })}
          <TraceItemDebugEntries debugEntries={debugEntries} itemID={id} />
        </div>
      ) : null}
    </>
  )
}

function PatchTraceItemView({
  className,
  debugEntries,
  item,
  onFileChangeSelect,
  ...props
}: TraceItemRendererProps) {
  const fileChanges = normalizePatchFileChanges(item)

  if (fileChanges.length === 0) {
    return (
      <GenericTraceItemView
        className={className}
        debugEntries={debugEntries}
        item={item}
        onFileChangeSelect={onFileChangeSelect}
        showFileActions
        {...props}
      />
    )
  }

  return (
    <article className={className} data-kind={item.kind}>
      <PatchFileChangePreview
        debugEntries={debugEntries}
        draftPatchStatus={item.draftPatch?.status ?? item.status}
        fileChanges={fileChanges}
        id={item.id}
        isDraftPatch={Boolean(item.draftPatch)}
        isStreaming={Boolean(item.draftPatch?.isStreaming ?? item.isStreaming)}
      />
    </article>
  )
}

function WorkflowLogTraceItemView({
  className,
  debugEntries,
  item,
}: TraceItemRendererProps) {
  const statusText = formatTraceStatusText(item.status) ?? item.status
  const [isExpanded, setIsExpanded] = useState(false)
  const summary = getTraceLogSummary(item)
  const detailID = `trace-log-detail-${item.id}`
  const hasDetail = hasLazyTraceDetail(item, debugEntries)
  const rowContent = (
    <>
      <span className={joinClassNames("trace-log-status-dot", item.status && `is-${item.status}`)} aria-hidden="true" />
      <span className="trace-log-label">{item.label}</span>
      <span className="trace-log-summary">{summary}</span>
      <span className="trace-log-meta">
        {statusText ? <span className={`trace-log-status-text is-${item.status}`}>{statusText}</span> : null}
        {hasDetail ? (
          <span className="trace-log-chevron" aria-hidden="true">
            {isExpanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
          </span>
        ) : null}
      </span>
    </>
  )

  return (
    <article className={joinClassNames(className, "trace-log-item")} data-kind={item.kind}>
      {hasDetail ? (
        <button
          type="button"
          className="trace-log-row"
          aria-label={summary}
          aria-expanded={isExpanded}
          aria-controls={detailID}
          onClick={() => setIsExpanded((current) => !current)}
        >
          {rowContent}
        </button>
      ) : (
        <div className="trace-log-row is-static">{rowContent}</div>
      )}
      {hasDetail && isExpanded ? (
        <div id={detailID} className="trace-log-detail">
          {item.text ? <ThreadRichText className="trace-item-text" text={item.text} /> : null}
          {item.detail ? <ThreadRichText className="trace-item-detail" text={item.detail} /> : null}
          {item.progressItems?.length ? (
            <ol className="task-progress-list">
              {item.progressItems.map((progressItem) => (
                <li key={`${item.id}-${progressItem.id}`} className={`task-progress-item is-${progressItem.status}`}>
                  <span className="task-progress-status">{progressItem.status === "in_progress" ? "in progress" : progressItem.status}</span>
                  <span className="task-progress-step">{progressItem.step}</span>
                </li>
              ))}
            </ol>
          ) : null}
          <TraceItemDebugEntries debugEntries={debugEntries} itemID={item.id} />
        </div>
      ) : null}
    </article>
  )
}

function SubtaskTraceItemView(props: TraceItemRendererProps) {
  return <WorkflowLogTraceItemView {...props} />
}

function StepTraceItemView(props: TraceItemRendererProps) {
  return <WorkflowLogTraceItemView {...props} />
}

function RetryTraceItemView(props: TraceItemRendererProps) {
  return <WorkflowLogTraceItemView {...props} />
}

function SnapshotTraceItemView(props: TraceItemRendererProps) {
  return <WorkflowLogTraceItemView {...props} />
}

function ErrorTraceItemView(props: TraceItemRendererProps) {
  return <GenericTraceItemView {...props} />
}

function ImageTraceItemView({
  className,
  debugEntries,
  item,
  onOpenImagePreview,
  ...props
}: TraceItemRendererProps) {
  if (!item.src) {
    return (
      <GenericTraceItemView
        className={className}
        debugEntries={debugEntries}
        item={item}
        onOpenImagePreview={onOpenImagePreview}
        {...props}
      />
    )
  }

  return (
    <article className={className} data-kind={item.kind}>
      <TraceItemHeader item={item} />
      <TraceImagePreview item={item} onOpenImagePreview={onOpenImagePreview} />
      {item.text ? <ThreadRichText className="trace-item-text" text={item.text} /> : null}
      {item.detail ? <ThreadRichText className="trace-item-detail" text={item.detail} /> : null}
      <TraceItemDebugEntries debugEntries={debugEntries} itemID={item.id} />
    </article>
  )
}

function ReasoningTraceItemView({
  className,
  debugEntries,
  item,
  shouldCollapseAfterMessageCompletion,
}: TraceItemRendererProps) {
  const shouldCollapseTraceItem = shouldCollapseReasoningTraceItem(item, shouldCollapseAfterMessageCompletion)
  const [isExpanded, setIsExpanded] = useState(() => !shouldCollapseTraceItem)
  const [isCollapsing, setIsCollapsing] = useState(false)
  const collapseTimerRef = useRef<number | null>(null)
  const contentID = `trace-item-reasoning-${item.id}`
  const reasoningLabel = item.title || item.label || "Reasoning"
  const shouldRenderFullReasoningContent = isExpanded || isCollapsing
  const reasoningPreview = useMemo(
    () => getReasoningDisclosurePreview(item, reasoningLabel),
    [item.detail, item.text, reasoningLabel],
  )
  const reasoningContent = shouldRenderFullReasoningContent
    ? getReasoningDisclosureContent(item, reasoningLabel)
    : null
  const hasReasoningBodyContent = Boolean(reasoningContent?.text || reasoningContent?.detail || debugEntries.length > 0)
  const reasoningSummaryClassName = joinClassNames("trace-item-text trace-item-plain-text", isExpanded ? "" : "trace-item-collapsed-line")

  function clearReasoningCollapseTimer() {
    if (collapseTimerRef.current === null) return
    window.clearTimeout(collapseTimerRef.current)
    collapseTimerRef.current = null
  }

  useLayoutEffect(() => {
    clearReasoningCollapseTimer()

    if (!shouldCollapseTraceItem) {
      setIsCollapsing(false)
      setIsExpanded(true)
      return
    }

    if (!isExpanded) {
      setIsCollapsing(false)
      return
    }

    setIsExpanded(false)
    if (prefersReducedThreadMotion()) {
      setIsCollapsing(false)
      return
    }

    setIsCollapsing(true)
    collapseTimerRef.current = window.setTimeout(() => {
      collapseTimerRef.current = null
      setIsCollapsing(false)
    }, THREAD_AUTO_COLLAPSE_MOTION_MS)

    return clearReasoningCollapseTimer
  }, [item.id, shouldCollapseTraceItem])

  useEffect(() => clearReasoningCollapseTimer, [])

  function handleReasoningToggle(event?: { target: EventTarget | null }) {
    if (event?.target instanceof Element && event.target.closest("a[href]")) return
    clearReasoningCollapseTimer()
    setIsCollapsing(false)
    setIsExpanded((current) => !current)
  }

  function handleReasoningKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Enter" && event.key !== " ") return
    event.preventDefault()
    handleReasoningToggle()
  }

  return (
    <article
      className={joinClassNames(className, isExpanded ? "is-expanded" : "is-collapsed", isCollapsing && "is-collapsing")}
      data-kind={item.kind}
    >
      <div
        className="trace-item-reasoning-toggle"
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
        aria-controls={hasReasoningBodyContent ? contentID : undefined}
        onClick={handleReasoningToggle}
        onKeyDown={handleReasoningKeyDown}
      >
        <ThreadRichText
          as="div"
          className={reasoningSummaryClassName}
          text={reasoningContent?.firstLine ?? reasoningPreview.text}
        />
      </div>
      {shouldRenderFullReasoningContent && hasReasoningBodyContent ? (
        <div
          id={contentID}
          className={joinClassNames("trace-item-reasoning-body trace-reasoning-pane", isCollapsing && "is-collapsing")}
          role="region"
          aria-label={`${reasoningLabel} content`}
        >
          <div className="trace-item-reasoning-body-inner">
            {reasoningContent?.text ? <ThreadRichText className="trace-item-text trace-item-plain-text" text={reasoningContent.text} /> : null}
            {reasoningContent?.detail ? <ThreadRichText className="trace-item-detail trace-item-plain-detail" text={reasoningContent.detail} /> : null}
            <TraceItemDebugEntries debugEntries={debugEntries} itemID={item.id} />
          </div>
        </div>
      ) : null}
    </article>
  )
}

function CompactionTraceItemView(props: TraceItemRendererProps) {
  return <WorkflowLogTraceItemView {...props} />
}

function QuestionTraceItemView({
  className,
  debugEntries,
  isQuestionAnswered,
  isQuestionAnswerDisabled,
  item,
  onAskUserQuestionAnswer,
  ...props
}: TraceItemRendererProps) {
  const { t } = useI18n()
  const [isSubmittingQuestionAnswer, setIsSubmittingQuestionAnswer] = useState(false)
  const [freeformAnswer, setFreeformAnswer] = useState("")
  const [selectedQuestionOptions, setSelectedQuestionOptions] = useState<string[]>([])
  const prompt = item.questionPrompt

  useEffect(() => {
    setIsSubmittingQuestionAnswer(false)
  }, [item.id])

  if (!prompt) {
    return (
      <GenericTraceItemView
        className={className}
        debugEntries={debugEntries}
        isQuestionAnswerDisabled={isQuestionAnswerDisabled}
        item={item}
        onAskUserQuestionAnswer={onAskUserQuestionAnswer}
        {...props}
      />
    )
  }

  const questionID = prompt.questionID
  const canSubmitAnswer = Boolean(onAskUserQuestionAnswer && questionID)
  const isAnswerDisabled = isQuestionAnswered || isQuestionAnswerDisabled || isSubmittingQuestionAnswer || !questionID
  const canUseOptionButtons = prompt.options.length > 0 && !prompt.multiple && canSubmitAnswer
  const canUseMultipleSelection = prompt.options.length > 0 && prompt.multiple && canSubmitAnswer
  const trimmedFreeformAnswer = freeformAnswer.trim()
  const hasSelectedOptions = selectedQuestionOptions.length > 0
  const canSubmitStructuredAnswer = canSubmitAnswer && !isAnswerDisabled && (hasSelectedOptions || Boolean(trimmedFreeformAnswer))
  const questionContext = prompt.header?.trim()
  const note = isQuestionAnswered
    ? prompt.answerText ? t("thread.question.answeredWith", { answer: prompt.answerText }) : t("thread.question.answered")
    : canUseMultipleSelection && prompt.allowFreeform
      ? t("thread.question.noteMultipleFreeform")
      : canUseMultipleSelection
        ? t("thread.question.noteMultiple")
    : prompt.multiple
      ? prompt.allowFreeform
        ? t("thread.question.noteComposerMultipleFreeform")
        : t("thread.question.noteComposer")
      : prompt.allowFreeform
        ? canSubmitAnswer
          ? t("thread.question.noteFreeform")
          : t("thread.question.noteComposerOptional")
        : null

  function handleQuestionOptionToggle(optionValue: string) {
    setSelectedQuestionOptions((current) =>
      current.includes(optionValue)
        ? current.filter((value) => value !== optionValue)
        : [...current, optionValue],
    )
  }

  async function submitQuestionAnswer(input: {
    text: string
    selectedOptions?: string[]
    freeformText?: string
  }) {
    if (!onAskUserQuestionAnswer || isAnswerDisabled || !questionID) return

    setIsSubmittingQuestionAnswer(true)
    try {
      await onAskUserQuestionAnswer({
        text: input.text,
        questionID,
        ...(input.selectedOptions && input.selectedOptions.length > 0 ? { selectedOptions: input.selectedOptions } : {}),
        ...(input.freeformText ? { freeformText: input.freeformText } : {}),
      })
    } finally {
      setIsSubmittingQuestionAnswer(false)
    }
  }

  function handleStructuredAnswerSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isAnswerDisabled) return

    const selectedOptions = selectedQuestionOptions.map((value) => value.trim()).filter(Boolean)
    const nextFreeformAnswer = freeformAnswer.trim()
    const answerText = nextFreeformAnswer || selectedOptions.join(", ")
    if (!answerText) return

    void submitQuestionAnswer({
      text: answerText,
      ...(selectedOptions.length > 0 ? { selectedOptions } : {}),
      ...(nextFreeformAnswer ? { freeformText: nextFreeformAnswer } : {}),
    })

    setFreeformAnswer("")
    setSelectedQuestionOptions([])
  }

  return (
    <article className={`${className} ask-user-question-card`} data-kind={item.kind} role="region" aria-label={item.title || t("thread.question.region")}>
      <div className="ask-user-question-body">
        <div className="ask-user-question-header">
          <span className="ask-user-question-icon" aria-hidden="true">
            <InfoIcon />
          </span>
          <span className="ask-user-question-heading">{t("thread.question.heading")}</span>
          {questionContext ? <span className="ask-user-question-context">{questionContext}</span> : null}
        </div>
        <ThreadRichText className="ask-user-question-text" text={prompt.question} />

        {prompt.options.length > 0 ? (
          <ol className="ask-user-question-options">
            {prompt.options.map((option, index) => (
              <li key={`${item.id}-${option.value}-${index}`} className="ask-user-question-option">
                <span className="ask-user-question-option-number" aria-hidden="true">{index + 1}.</span>
                {canUseOptionButtons ? (
                  <button
                    aria-label={option.label}
                    className="ask-user-question-option-button"
                    disabled={isAnswerDisabled}
                    onClick={() =>
                      void submitQuestionAnswer({
                        text: option.value,
                        selectedOptions: [option.value],
                      })}
                    type="button"
                  >
                    <span className="ask-user-question-option-label">{option.label}</span>
                    {option.description ? <ThreadRichText as="span" className="ask-user-question-option-description" text={option.description} /> : null}
                  </button>
                ) : canUseMultipleSelection ? (
                  <label className="ask-user-question-option-choice">
                    <input
                      checked={selectedQuestionOptions.includes(option.value)}
                      className="ask-user-question-option-checkbox"
                      disabled={isAnswerDisabled}
                      onChange={() => handleQuestionOptionToggle(option.value)}
                      type="checkbox"
                    />
                    <span className="ask-user-question-option-label">{option.label}</span>
                    {option.description ? <ThreadRichText as="span" className="ask-user-question-option-description" text={option.description} /> : null}
                  </label>
                ) : (
                  <div className="ask-user-question-option-static">
                    <span className="ask-user-question-option-label">{option.label}</span>
                    {option.description ? <ThreadRichText as="span" className="ask-user-question-option-description" text={option.description} /> : null}
                  </div>
                )}
              </li>
            ))}
          </ol>
        ) : null}

        {canUseMultipleSelection || (prompt.allowFreeform && canSubmitAnswer) ? (
          <form className="ask-user-question-response-form" onSubmit={handleStructuredAnswerSubmit}>
            {prompt.allowFreeform ? (
              <label className={joinClassNames(
                "ask-user-question-freeform-row",
                prompt.options.length === 0 && "is-standalone",
              )}>
                <input
                  aria-label={t("thread.question.customAnswerLabel")}
                  className="ask-user-question-freeform-input"
                  disabled={isAnswerDisabled}
                  onChange={(event) => setFreeformAnswer(event.target.value)}
                  placeholder={prompt.placeholder || t("thread.question.placeholder")}
                  type="text"
                  value={freeformAnswer}
                />
              </label>
            ) : null}

            <div className="ask-user-question-actions">
              <button
                className="primary-button ask-user-question-submit"
                disabled={!canSubmitStructuredAnswer}
                type="submit"
              >
                {isSubmittingQuestionAnswer ? t("thread.question.sending") : t("thread.question.submit")}
              </button>
            </div>
          </form>
        ) : null}

        {note ? <p className="ask-user-question-note">{note}</p> : null}
      </div>
      <TraceItemDebugEntries debugEntries={debugEntries} itemID={item.id} />
    </article>
  )
}

function TaskStateTraceItemView(props: TraceItemRendererProps) {
  return <WorkflowLogTraceItemView {...props} />
}

type ToolTraceDisplayTone = "preparing" | "running" | "waiting-approval" | "success" | "error" | "denied" | "cancelled" | "idle"
type ToolTraceDisplayIconType = "dot" | "success" | "error" | "tool"

function getToolTraceDisplayState(item: AssistantTraceItem): {
  iconType: ToolTraceDisplayIconType
  isBreathing: boolean
  label: string | null
  shouldShowLabel: boolean
  tone: ToolTraceDisplayTone
} {
  switch (item.status) {
    case "pending":
      return {
        iconType: "tool",
        isBreathing: true,
        label: "准备中",
        shouldShowLabel: true,
        tone: "idle",
      }
    case "running":
      return {
        iconType: "tool",
        isBreathing: true,
        label: "执行中",
        shouldShowLabel: true,
        tone: "idle",
      }
    case "waiting-approval":
      return {
        iconType: "dot",
        isBreathing: true,
        label: "等待确认",
        shouldShowLabel: true,
        tone: "waiting-approval",
      }
    case "completed":
      return {
        iconType: "success",
        isBreathing: false,
        label: null,
        shouldShowLabel: false,
        tone: "success",
      }
    case "error":
      return {
        iconType: "error",
        isBreathing: false,
        label: "失败",
        shouldShowLabel: true,
        tone: "error",
      }
    case "denied":
      return {
        iconType: "error",
        isBreathing: false,
        label: "已拒绝",
        shouldShowLabel: true,
        tone: "denied",
      }
    case "cancelled":
      return {
        iconType: "error",
        isBreathing: false,
        label: "已取消",
        shouldShowLabel: true,
        tone: "cancelled",
      }
    default:
      return {
        iconType: "tool",
        isBreathing: false,
        label: null,
        shouldShowLabel: false,
        tone: "idle",
      }
  }
}

function ToolTraceItemView({
  className,
  debugEntries,
  item,
  shouldCollapseAfterMessageCompletion,
  traceVisibility,
}: TraceItemRendererProps) {
  const shouldCollapseTraceItem = shouldCollapseAfterMessageCompletion && isCollapsibleTraceItem(item)
  const [isExpanded, setIsExpanded] = useState(false)
  const [isDisclosureCollapsing, setIsDisclosureCollapsing] = useState(false)
  const [isInputExpanded, setIsInputExpanded] = useState(false)
  const [isOutputExpanded, setIsOutputExpanded] = useState(false)
  const disclosureCollapseTimerRef = useRef<number | null>(null)
  const { t } = useI18n()
  const summaryTitle = item.title || item.label
  const inputLabel = t("thread.toolTrace.inputLabel")
  const outputLabel = t("thread.toolTrace.outputLabel")
  const inputAriaLabel = t("thread.toolTrace.inputAria")
  const outputAriaLabel = t("thread.toolTrace.outputAria")
  const inputContentLabel = t("thread.toolTrace.inputContent")
  const outputContentLabel = t("thread.toolTrace.outputContent")
  const displayState = getToolTraceDisplayState(item)
  const draftPatchFileChanges = normalizeTraceFileChanges(item.draftPatch?.fileChanges)
  const draftPatch = item.draftPatch && typeof item.draftPatch === "object" && draftPatchFileChanges.length > 0
    ? {
        ...item.draftPatch,
        fileChanges: draftPatchFileChanges,
      }
    : null
  const toolNameStatus = draftPatch?.status ?? item.status
  const isToolNameActive =
    toolNameStatus === "pending" ||
    toolNameStatus === "running" ||
    Boolean(item.isStreaming && item.status !== "completed" && item.status !== "error" && item.status !== "denied" && item.status !== "cancelled")
  const toolNameClassName = joinClassNames(
    "trace-log-summary",
    "trace-tool-name",
    toolNameStatus ? `is-${toolNameStatus}` : undefined,
    isToolNameActive ? "is-active" : undefined,
  )
  const showsToolInputs = item.status === "pending" || item.status === "running" || item.status === "waiting-approval" || item.status === "cancelled"
  const visibleToolInputText = traceVisibility.toolInputs ? item.toolInputText : undefined
  const visibleToolOutputText = traceVisibility.toolOutputs ? item.toolOutputText : undefined
  const inputSectionDetail = showsToolInputs ? item.detail : undefined
  const outputSectionDetail = !showsToolInputs && traceVisibility.toolOutputs ? item.detail : undefined
  const hasInputDisclosureContent = Boolean(visibleToolInputText || inputSectionDetail)
  const hasOutputDisclosureContent = Boolean(visibleToolOutputText || outputSectionDetail)
  const hasDisclosureContent = Boolean(hasInputDisclosureContent || hasOutputDisclosureContent || debugEntries.length > 0)
  const disclosureID = `trace-log-detail-${item.id}`
  const inputDisclosureID = `trace-item-disclosure-input-${item.id}`
  const outputDisclosureID = `trace-item-disclosure-output-${item.id}`
  const draftPatchPreview = useToolDraftPatchPreviewState({
    fileChanges: draftPatch?.fileChanges ?? [],
    id: `${item.id}-draft-patch`,
    isDraftPatch: Boolean(draftPatch),
  })
  const statusText = displayState.shouldShowLabel && displayState.label ? displayState.label : formatTraceStatusText(item.status)
  const rowAriaLabel = displayState.shouldShowLabel && displayState.label ? `${summaryTitle} ${displayState.label}` : summaryTitle
  const shouldRenderToolRowButton = hasDisclosureContent && !draftPatch
  const rowContent = (
    <>
      <span className={toolNameClassName}>{summaryTitle}</span>
      {draftPatch ? (
        <ToolDraftPatchSummaryButton
          fileChanges={draftPatch.fileChanges}
          isExpanded={draftPatchPreview.isListExpanded}
          isStreaming={Boolean(draftPatch.isStreaming)}
          listID={draftPatchPreview.listID}
          onToggle={draftPatchPreview.toggleList}
          status={draftPatch.status}
        />
      ) : null}
      <span className="trace-log-filler" aria-hidden="true" />
      <span className="trace-log-meta">
        {statusText ? <span className={`trace-log-status-text is-${item.status}`}>{statusText}</span> : null}
        {hasDisclosureContent ? (
          draftPatch ? (
            <button
              className="trace-log-inline-toggle"
              type="button"
              aria-label={`${summaryTitle} details`}
              aria-expanded={isExpanded}
              aria-controls={disclosureID}
              onClick={handleToolToggle}
            >
              {isExpanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
            </button>
          ) : (
            <span className="trace-log-chevron" aria-hidden="true">
              {isExpanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
            </span>
          )
        ) : null}
      </span>
    </>
  )

  function clearToolDisclosureCollapseTimer() {
    if (disclosureCollapseTimerRef.current === null) return
    window.clearTimeout(disclosureCollapseTimerRef.current)
    disclosureCollapseTimerRef.current = null
  }

  useLayoutEffect(() => {
    clearToolDisclosureCollapseTimer()

    if (!shouldCollapseTraceItem) {
      setIsDisclosureCollapsing(false)
      return
    }

    if (!isExpanded) {
      setIsDisclosureCollapsing(false)
      setIsInputExpanded(false)
      setIsOutputExpanded(false)
      return
    }

    setIsExpanded(false)
    if (prefersReducedThreadMotion()) {
      setIsDisclosureCollapsing(false)
      setIsInputExpanded(false)
      setIsOutputExpanded(false)
      return
    }

    setIsDisclosureCollapsing(true)
    disclosureCollapseTimerRef.current = window.setTimeout(() => {
      disclosureCollapseTimerRef.current = null
      setIsDisclosureCollapsing(false)
      setIsInputExpanded(false)
      setIsOutputExpanded(false)
    }, THREAD_AUTO_COLLAPSE_MOTION_MS)

    return clearToolDisclosureCollapseTimer
  }, [item.id, shouldCollapseTraceItem])

  useEffect(() => clearToolDisclosureCollapseTimer, [])

  function handleToolToggle() {
    clearToolDisclosureCollapseTimer()
    setIsDisclosureCollapsing(false)
    setIsExpanded((current) => {
      if (current) {
        setIsInputExpanded(false)
        setIsOutputExpanded(false)
      }
      return !current
    })
  }

  return (
    <article className={joinClassNames(className, "trace-log-item", isDisclosureCollapsing && "is-collapsing")} data-kind={item.kind}>
      {shouldRenderToolRowButton ? (
        <button
          className="trace-log-row"
          type="button"
          aria-label={rowAriaLabel}
          aria-expanded={isExpanded}
          aria-controls={disclosureID}
          onClick={handleToolToggle}
        >
          {rowContent}
        </button>
      ) : (
        <div className={joinClassNames("trace-log-row is-static", draftPatch && "has-inline-draft-patch")}>{rowContent}</div>
      )}

      {draftPatch && draftPatchPreview.isListExpanded ? (
        <div className="trace-tool-draft-patch">
          <ToolDraftPatchFileChangeList
            expandedFile={draftPatchPreview.expandedFile}
            fileChanges={draftPatch.fileChanges}
            fullPatchFile={draftPatchPreview.fullPatchFile}
            fullHeightFile={draftPatchPreview.fullHeightFile}
            id={`${item.id}-draft-patch`}
            isStreaming={Boolean(draftPatch.isStreaming)}
            listID={draftPatchPreview.listID}
            setExpandedFile={draftPatchPreview.setExpandedFile}
            setFullPatchFile={draftPatchPreview.setFullPatchFile}
            setFullHeightFile={draftPatchPreview.setFullHeightFile}
            status={draftPatch.status}
          />
        </div>
      ) : null}

      {hasDisclosureContent && (isExpanded || isDisclosureCollapsing) ? (
        <div id={disclosureID} className={joinClassNames("trace-log-detail", isDisclosureCollapsing && "is-collapsing")}>
          {hasInputDisclosureContent ? (
            <div className="trace-item-subsection">
              <button
                className="trace-item-subsection-toggle"
                type="button"
                aria-expanded={isInputExpanded}
                aria-controls={inputDisclosureID}
                aria-label={`${summaryTitle} ${inputAriaLabel}`}
                onClick={() => setIsInputExpanded((current) => !current)}
              >
                <span className="trace-item-subsection-toggle-icon" aria-hidden="true">
                  {isInputExpanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
                </span>
                <span className="trace-item-subsection-toggle-line">
                  <span className="trace-item-subsection-label">{inputLabel}</span>
                </span>
              </button>
              {isInputExpanded ? (
                <div
                  id={inputDisclosureID}
                  className="trace-item-subsection-body trace-tool-io-pane"
                  role="region"
                  aria-label={`${summaryTitle} ${inputContentLabel}`}
                >
                  {visibleToolInputText ? <ThreadRichText className="trace-item-text" text={visibleToolInputText} /> : null}
                  {inputSectionDetail ? <ThreadRichText className="trace-item-detail" text={inputSectionDetail} /> : null}
                </div>
              ) : null}
            </div>
          ) : null}
          {hasOutputDisclosureContent ? (
            <div className="trace-item-subsection">
              <button
                className="trace-item-subsection-toggle"
                type="button"
                aria-expanded={isOutputExpanded}
                aria-controls={outputDisclosureID}
                aria-label={`${summaryTitle} ${outputAriaLabel}`}
                onClick={() => setIsOutputExpanded((current) => !current)}
              >
                <span className="trace-item-subsection-toggle-icon" aria-hidden="true">
                  {isOutputExpanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
                </span>
                <span className="trace-item-subsection-toggle-line">
                  <span className="trace-item-subsection-label">{outputLabel}</span>
                </span>
              </button>
              {isOutputExpanded ? (
                <div
                  id={outputDisclosureID}
                  className="trace-item-subsection-body trace-tool-io-pane"
                  role="region"
                  aria-label={`${summaryTitle} ${outputContentLabel}`}
                >
                  {visibleToolOutputText ? <ThreadRichText className="trace-item-text" text={visibleToolOutputText} /> : null}
                  {outputSectionDetail ? <ThreadRichText className="trace-item-detail" text={outputSectionDetail} /> : null}
                </div>
              ) : null}
            </div>
          ) : null}
          <TraceItemDebugEntries debugEntries={debugEntries} itemID={item.id} />
        </div>
      ) : null}
    </article>
  )
}

function TextTraceItemView({
  isLatestMessage,
  isResponseItem,
  item,
  onProposedPlanConfirm,
  ...props
}: TraceItemRendererProps) {
  const proposedPlan = isResponseItem ? parseProposedPlanBlock(item.text) : null

  if (proposedPlan) {
    return (
      <ProposedPlanCard
        planMarkdown={proposedPlan.markdown}
        rawPlanMarkdown={proposedPlan.raw}
        isComplete={proposedPlan.isComplete}
        isLatestMessage={isLatestMessage}
        onConfirm={onProposedPlanConfirm}
      />
    )
  }

  return (
    <GenericTraceItemView
      isLatestMessage={isLatestMessage}
      isResponseItem={isResponseItem}
      item={item}
      onProposedPlanConfirm={onProposedPlanConfirm}
      {...props}
    />
  )
}

const traceItemRenderers = {
  system: SystemTraceItemView,
  reasoning: ReasoningTraceItemView,
  text: TextTraceItemView,
  question: QuestionTraceItemView,
  tool: ToolTraceItemView,
  source: SourceTraceItemView,
  file: FileTraceItemView,
  image: ImageTraceItemView,
  patch: PatchTraceItemView,
  subtask: SubtaskTraceItemView,
  compaction: CompactionTraceItemView,
  step: StepTraceItemView,
  retry: RetryTraceItemView,
  snapshot: SnapshotTraceItemView,
  "task-state": TaskStateTraceItemView,
  error: ErrorTraceItemView,
} satisfies Record<AssistantTraceItemKind, ComponentType<TraceItemRendererProps>>

interface TraceItemRenderBoundaryProps {
  children: ReactNode
  itemID: string
  itemKind: AssistantTraceItemKind
  itemTitle: string
}

interface TraceItemRenderBoundaryState {
  error: Error | null
}

class TraceItemRenderBoundary extends Component<TraceItemRenderBoundaryProps, TraceItemRenderBoundaryState> {
  state: TraceItemRenderBoundaryState = {
    error: null,
  }

  static getDerivedStateFromError(error: Error): TraceItemRenderBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[desktop][trace-item-render-error]", {
      componentStack: info.componentStack,
      itemID: this.props.itemID,
      itemKind: this.props.itemKind,
      itemTitle: this.props.itemTitle,
      message: error.message,
      stack: error.stack,
    })
  }

  componentDidUpdate(previousProps: TraceItemRenderBoundaryProps) {
    if (!this.state.error) return
    if (previousProps.itemID === this.props.itemID && previousProps.itemKind === this.props.itemKind) return
    this.setState({ error: null })
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <article className="trace-item trace-kind-error trace-item-render-error" data-kind={this.props.itemKind} role="alert">
        <div className="trace-item-header">
          <span className="trace-item-label">Render error</span>
          <span className="trace-item-summary">{this.props.itemTitle || this.props.itemKind}</span>
        </div>
        <p className="trace-item-detail">
          This trace item could not be rendered. The rest of the thread is still available.
        </p>
      </article>
    )
  }
}

const TraceItemView = memo(function TraceItemView({
  assistantMessagePhase,
  item,
  isQuestionAnswered = false,
  isQuestionAnswerDisabled = false,
  isLatestMessage = false,
  onOpenImagePreview,
  onAskUserQuestionAnswer,
  onFileChangeSelect,
  onArtifactLinkOpen,
  onLocalFileLinkOpen,
  onProposedPlanConfirm,
  shouldCollapseAfterMessageCompletion = false,
  traceVisibility,
}: TraceItemViewProps) {
  const renderedItem =
    assistantMessagePhase === "cancelled" &&
    item.kind === "tool" &&
    item.status !== "cancelled" &&
    item.status !== "completed" &&
    item.status !== "denied" &&
    item.status !== "error"
      ? {
          ...item,
          status: "cancelled" as const,
          detail: item.detail || "Prompt cancellation requested.",
          isStreaming: false,
        }
      : item
  const className = [
    "trace-item",
    `trace-kind-${renderedItem.kind}`,
    renderedItem.kind === "reasoning" || renderedItem.kind === "tool" ? "is-plain" : "",
    isWorkflowLogItem(renderedItem) ? "is-workflow-log" : "",
    renderedItem.isStreaming ? "is-streaming" : "",
    renderedItem.status ? `is-${renderedItem.status}` : "",
  ]
    .filter(Boolean)
    .join(" ")
  const debugEntries = traceVisibility.debugMetadata ? renderedItem.debugEntries ?? [] : []
  const isResponseItem = traceSectionKeyForItem(renderedItem) === "response"
  const Renderer = traceItemRenderers[renderedItem.kind]
  const traceItemTextLength =
    (renderedItem.title?.length ?? 0) +
    (renderedItem.text?.length ?? 0) +
    (renderedItem.detail?.length ?? 0)
  const traceItemProfiler = useMemo(
    () => createRendererProfilerOnRender("TraceItemView commit", () => ({
      debugEntryCount: debugEntries.length,
      isLatestMessage,
      isResponseItem,
      isStreaming: Boolean(renderedItem.isStreaming),
      itemID: renderedItem.id,
      itemKind: renderedItem.kind,
      itemStatus: renderedItem.status ?? null,
      textLength: traceItemTextLength,
    })),
    [
      debugEntries.length,
      isLatestMessage,
      isResponseItem,
      renderedItem.id,
      renderedItem.isStreaming,
      renderedItem.kind,
      renderedItem.status,
      traceItemTextLength,
    ],
  )

  return (
    <RendererProfiler id="TraceItemView" onRender={traceItemProfiler}>
      <TraceItemRenderBoundary
        itemID={renderedItem.id}
        itemKind={renderedItem.kind}
        itemTitle={renderedItem.title || renderedItem.label}
      >
        <Renderer
          className={className}
          debugEntries={debugEntries}
          isQuestionAnswered={isQuestionAnswered}
          isLatestMessage={isLatestMessage}
          isQuestionAnswerDisabled={isQuestionAnswerDisabled}
          isResponseItem={isResponseItem}
          item={renderedItem}
          onAskUserQuestionAnswer={onAskUserQuestionAnswer}
          onFileChangeSelect={onFileChangeSelect}
          onArtifactLinkOpen={onArtifactLinkOpen}
          onLocalFileLinkOpen={onLocalFileLinkOpen}
          onOpenImagePreview={onOpenImagePreview}
          onProposedPlanConfirm={onProposedPlanConfirm}
          shouldCollapseAfterMessageCompletion={shouldCollapseAfterMessageCompletion}
          traceVisibility={traceVisibility}
        />
      </TraceItemRenderBoundary>
    </RendererProfiler>
  )
})

function PermissionRequestCard({
  actionError,
  activeSession,
  isResolving,
  request,
  onRespond,
}: {
  actionError: string | null
  activeSession: SessionSummary
  isResolving: boolean
  request: PermissionRequest
  onRespond: PermissionRequestResponseHandler
}) {
  const title = request.prompt.title.trim()
  const detailBody = request.prompt.details?.body?.trim()
  const detailLines = [
    request.prompt.details?.workdir ? { label: "Workdir", value: request.prompt.details.workdir } : null,
    request.prompt.details?.command ? { label: "Command", value: request.prompt.details.command } : null,
    request.prompt.details?.paths && request.prompt.details.paths.length > 0
      ? { label: "Paths", value: request.prompt.details.paths.join(", ") }
      : null,
  ].filter((item): item is { label: string; value: string } => Boolean(item))

  function handleRespond(decision: PermissionDecision) {
    void onRespond({
      sessionID: activeSession.id,
      request,
      decision,
    })
  }

  return (
    <article className="permission-request-card">
      <header className="permission-request-header">
        <div>
          <span className="label">Approval Required</span>
          <h3>{title}</h3>
          <p className="permission-request-subtitle">{request.prompt.summary}</p>
          <p className="permission-request-rationale">{request.prompt.rationale}</p>
        </div>
        <div className="permission-request-badges">
          <span className={`permission-risk-chip is-${request.prompt.risk}`}>{formatPermissionRiskLabel(request.prompt.risk)}</span>
        </div>
      </header>

      <div className="permission-request-controls">
        <div className="settings-inline-actions permission-request-actions">
          {primaryPermissionDecisions.map((decision) => (
            <button
              key={decision}
              className={decision === "allow" ? "primary-button" : "secondary-button"}
              aria-label={`${formatPermissionDecisionLabel(decision)} ${title}`}
              disabled={isResolving}
              onClick={() => handleRespond(decision)}
              type="button"
            >
              {isResolving ? "Applying..." : formatPermissionDecisionLabel(decision)}
            </button>
          ))}
        </div>
      </div>

      {request.prompt.detailsAvailable && (detailLines.length > 0 || detailBody) ? (
        <details className="permission-request-disclosure">
          <summary>View details</summary>
          <div className="permission-request-grid permission-request-grid-compact">
            <div className="permission-request-meta">
              <span className="permission-request-meta-label">Requested</span>
              <strong>{formatTime(request.createdAt)}</strong>
            </div>
            {detailLines.map((item) => (
              <div
                key={item.label}
                className={item.label === "Paths" || item.label === "Command" ? "permission-request-meta permission-request-meta-wide" : "permission-request-meta"}
              >
                <span className="permission-request-meta-label">{item.label}</span>
                <strong>{item.value}</strong>
              </div>
            ))}
            {detailBody ? (
              <div className="permission-request-meta permission-request-meta-wide">
                <span className="permission-request-meta-label">Body</span>
                <pre className="permission-request-body">{detailBody}</pre>
              </div>
            ) : null}
          </div>
        </details>
      ) : null}

      <div className="permission-request-footer">
        <p className="permission-request-note">The session resumes after this decision is recorded.</p>
      </div>

      {actionError ? <p className="permission-request-error">{actionError}</p> : null}
    </article>
  )
}

interface PermissionRequestInlinePromptProps {
  activeSession: SessionSummary | null
  isResolvingPermissionRequest: boolean
  pendingPermissionRequests: PermissionRequest[]
  permissionRequestActionError: string | null
  permissionRequestActionRequestID: string | null
  motion: ThreadMessageMotion
  onPermissionRequestResponse: PermissionRequestResponseHandler
}

function PermissionRequestInlinePrompt({
  activeSession,
  isResolvingPermissionRequest,
  pendingPermissionRequests,
  permissionRequestActionError,
  permissionRequestActionRequestID,
  motion,
  onPermissionRequestResponse,
}: PermissionRequestInlinePromptProps) {
  if (!activeSession || isResolvingPermissionRequest || pendingPermissionRequests.length === 0) return null

  const [request] = pendingPermissionRequests
  const remainingCount = pendingPermissionRequests.length - 1

  return (
    <article
      className="thread-message assistant-message permission-request-message"
      data-thread-message-id={`permission-request:${request.id}`}
      data-thread-message-motion={motion}
    >
      <section className="permission-request-inline" role="region" aria-labelledby="permission-request-title">
        <header className="permission-request-inline-header">
          <div>
            <span className="label">Tool Approval</span>
            <h3 id="permission-request-title">Tool approval request</h3>
            <p className="permission-request-inline-copy">Confirm or deny this tool call directly in the thread shell.</p>
          </div>
          {remainingCount > 0 ? (
            <span className="settings-badge permission-request-count">
              {remainingCount + 1} requests waiting
            </span>
          ) : null}
        </header>

        <PermissionRequestCard
          actionError={
            permissionRequestActionError &&
            (!permissionRequestActionRequestID || permissionRequestActionRequestID === request.id)
              ? permissionRequestActionError
              : null
          }
          activeSession={activeSession}
          isResolving={false}
          request={request}
          onRespond={onPermissionRequestResponse}
        />
      </section>
    </article>
  )
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

function InactiveThreadView({ threadColumnRef }: Pick<ThreadViewProps, "threadColumnRef">) {
  return (
    <section className="thread-shell" aria-hidden="true">
      <div ref={threadColumnRef} className="thread-column" />
    </section>
  )
}

function BranchSwitcher({
  onSelect,
  options,
}: {
  onSelect?: (messageID: string) => void | Promise<void>
  options: SessionMessageBranchOption[]
}) {
  if (options.length <= 1) return null

  const activeOption = options.find((option) => option.isActive) ?? options[0]

  return (
    <label className="assistant-branch-switcher" title="Switch branch">
      <span className="assistant-branch-switcher-label">Branch</span>
      <select
        className="assistant-branch-switcher-select"
        disabled={!onSelect}
        value={activeOption?.leafMessageID ?? ""}
        onChange={(event) => {
          const messageID = event.currentTarget.value
          if (messageID) void onSelect?.(messageID)
        }}
      >
        {options.map((option) => (
          <option key={option.childMessageID} value={option.leafMessageID}>
            {`${option.index + 1}/${option.total} ${option.preview}`}
          </option>
        ))}
      </select>
    </label>
  )
}

function areArraysShallowEqual<T>(left: readonly T[] | undefined, right: readonly T[] | undefined) {
  if (left === right) return true
  if (!left || !right || left.length !== right.length) return false
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false
  }
  return true
}

function areRecordValuesEqual<T>(
  left: Record<string, T> | undefined,
  right: Record<string, T> | undefined,
  areValuesEqual: (leftValue: T, rightValue: T) => boolean,
) {
  if (left === right) return true
  if (!left || !right) return false

  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  if (leftKeys.length !== rightKeys.length) return false

  for (const key of leftKeys) {
    if (!Object.prototype.hasOwnProperty.call(right, key)) return false
    if (!areValuesEqual(left[key], right[key])) return false
  }
  return true
}

function areSessionSummariesEqual(left: SessionSummary | null | undefined, right: SessionSummary | null | undefined) {
  if (left === right) return true
  if (!left || !right) return false

  return (
    left.id === right.id &&
    left.title === right.title &&
    left.modelSelection === right.modelSelection &&
    left.workflow === right.workflow &&
    left.origin === right.origin
  )
}

function getThreadViewPropsChangeReason(left: ThreadViewProps, right: ThreadViewProps) {
  if (left.activeProjectID !== right.activeProjectID) return "activeProjectID"
  if (!areSessionSummariesEqual(left.activeSession, right.activeSession)) return "activeSession"
  if (buildDiffSummarySignature(left.activeSessionDiff ?? null) !== buildDiffSummarySignature(right.activeSessionDiff ?? null)) {
    return "activeSessionDiff"
  }
  if (!areArraysShallowEqual(left.activeMessages, right.activeMessages)) return "activeMessages"
  if (left.assistantTraceVisibility !== right.assistantTraceVisibility) return "assistantTraceVisibility"
  if (left.composerRefreshVersion !== right.composerRefreshVersion) return "composerRefreshVersion"
  if (left.isAgentDebugTraceEnabled !== right.isAgentDebugTraceEnabled) return "isAgentDebugTraceEnabled"
  if (left.isResolvingPermissionRequest !== right.isResolvingPermissionRequest) return "isResolvingPermissionRequest"
  if (left.isSessionRunning !== right.isSessionRunning) return "isSessionRunning"
  if (left.messageTree !== right.messageTree) return "messageTree"
  if (!areArraysShallowEqual(left.pendingConversationInputs, right.pendingConversationInputs)) return "pendingConversationInputs"
  if (!areArraysShallowEqual(left.pendingPermissionRequests, right.pendingPermissionRequests)) return "pendingPermissionRequests"
  if (left.permissionRequestActionError !== right.permissionRequestActionError) return "permissionRequestActionError"
  if (left.permissionRequestActionRequestID !== right.permissionRequestActionRequestID) return "permissionRequestActionRequestID"
  if (!areArraysShallowEqual(left.sideChatAttachments, right.sideChatAttachments)) return "sideChatAttachments"
  if (!areRecordValuesEqual(left.sideChatCountsByAnchorMessageID, right.sideChatCountsByAnchorMessageID, Object.is)) {
    return "sideChatCountsByAnchorMessageID"
  }
  if (left.sideChatDraftState !== right.sideChatDraftState) return "sideChatDraftState"
  if (left.sideChatIsCancelling !== right.sideChatIsCancelling) return "sideChatIsCancelling"
  if (left.sideChatIsInterruptible !== right.sideChatIsInterruptible) return "sideChatIsInterruptible"
  if (left.sideChatIsSending !== right.sideChatIsSending) return "sideChatIsSending"
  if (!areArraysShallowEqual(left.sideChatPendingInputs, right.sideChatPendingInputs)) {
    return "sideChatPendingInputs"
  }
  if (!areArraysShallowEqual(left.sideChatPendingPermissionRequests, right.sideChatPendingPermissionRequests)) {
    return "sideChatPendingPermissionRequests"
  }
  if (left.sideChatPermissionRequestActionError !== right.sideChatPermissionRequestActionError) {
    return "sideChatPermissionRequestActionError"
  }
  if (left.sideChatPermissionRequestActionRequestID !== right.sideChatPermissionRequestActionRequestID) {
    return "sideChatPermissionRequestActionRequestID"
  }
  if (!areSessionSummariesEqual(left.sideChatSession, right.sideChatSession)) return "sideChatSession"
  if (!areRecordValuesEqual(
    left.sideChatSessionsByAnchorMessageID,
    right.sideChatSessionsByAnchorMessageID,
    areArraysShallowEqual,
  )) {
    return "sideChatSessionsByAnchorMessageID"
  }
  if (!areArraysShallowEqual(left.sideChatMessages, right.sideChatMessages)) return "sideChatMessages"
  if (left.sideChatPlacement !== right.sideChatPlacement) return "sideChatPlacement"
  if (left.scrollStateKey !== right.scrollStateKey) return "scrollStateKey"
  if (left.threadColumnRef !== right.threadColumnRef) return "threadColumnRef"
  if (left.isThreadVisible !== right.isThreadVisible) return "isThreadVisible"
  if (left.readScrollSnapshot !== right.readScrollSnapshot) return "readScrollSnapshot"
  if (left.saveScrollSnapshot !== right.saveScrollSnapshot) return "saveScrollSnapshot"
  return null
}

function areThreadViewPropsEqual(left: ThreadViewProps, right: ThreadViewProps) {
  const reason = getThreadViewPropsChangeReason(left, right)
  if (!reason) return true

  logRendererPerf("ThreadView memo miss", {
    reason,
    previousSessionID: left.activeSession?.id ?? null,
    nextSessionID: right.activeSession?.id ?? null,
    previousMessageCount: left.activeMessages.length,
    nextMessageCount: right.activeMessages.length,
  })
  return false
}

export const ThreadView = memo(function ThreadView(props: ThreadViewProps) {
  if (props.isThreadVisible === false) {
    return <InactiveThreadView threadColumnRef={props.threadColumnRef} />
  }

  return <VisibleThreadView {...props} />
}, areThreadViewPropsEqual)

function VisibleThreadView({
  activeProjectID = null,
  activeSession,
  activeSessionDiff = null,
  activeMessages,
  assistantTraceVisibility,
  composerRefreshVersion = 0,
  isAgentDebugTraceEnabled,
  isResolvingPermissionRequest,
  isSessionRunning = false,
  messageTree = null,
  onBranchSelect,
  onFileChangeSelect,
  onForkFromMessage,
  onArtifactLinkOpen,
  onLocalFileLinkOpen,
  onOpenSideChat,
  onMessageDiffSummaryHydrate,
  onMessageDiffRestore,
  onMessageDiffReview,
  onAskUserQuestionAnswer,
  pendingConversationInputs = [],
  pendingPermissionRequests,
  permissionRequestActionError,
  permissionRequestActionRequestID,
  sideChatAttachments = [],
  sideChatCountsByAnchorMessageID,
  sideChatDraftState = createEmptyComposerDraftState(),
  sideChatIsCancelling = false,
  sideChatIsInterruptible = false,
  sideChatIsSending = false,
  sideChatPendingInputs = [],
  sideChatPendingPermissionRequests = [],
  sideChatPermissionRequestActionError = null,
  sideChatPermissionRequestActionRequestID = null,
  sideChatSession = null,
  sideChatSessionsByAnchorMessageID = {},
  sideChatMessages = [],
  sideChatPlacement = "inline",
  scrollStateKey,
  threadColumnRef,
  isThreadVisible = true,
  readScrollSnapshot,
  saveScrollSnapshot,
  onSideChatDraftStateChange,
  onSideChatPickAttachments,
  onSideChatPasteImageAttachments,
  onSideChatRemoveAttachment,
  onSideChatCancelSend,
  onSideChatSend,
  onSessionModelSelectionChange,
  onSideChatCreate,
  onSideChatDelete,
  onProposedPlanConfirm,
  onPermissionRequestResponse,
  onSideChatSelect,
}: ThreadViewProps) {
  const answeredQuestionIDs = useMemo(() => collectAnsweredQuestionIDs(activeMessages), [activeMessages])
  const displayMessages = useMemo(() => orderAdjacentAssistantMessagesForDisplay(activeMessages), [activeMessages])
  const readOnlySideChat = isSideChatSession(activeSession)
  const [copiedResponseMessageID, setCopiedResponseMessageID] = useState<string | null>(null)
  const [copiedUserThreadMessageID, setCopiedUserThreadMessageID] = useState<string | null>(null)
  const [activeImagePreview, setActiveImagePreview] = useState<ActiveImagePreview | null>(null)
  const copiedResponseTimeoutRef = useRef<number | null>(null)
  const copiedUserTimeoutRef = useRef<number | null>(null)
  const scrollModeRef = useRef<ThreadScrollMode>("follow")
  const latestScrollSnapshotRef = useRef<ThreadScrollSnapshot | null>(null)
  const latestScrollSnapshotKeyRef = useRef<string | null>(null)
  const contentResizeObserverRef = useRef<ResizeObserver | null>(null)
  const contentMutationObserverRef = useRef<MutationObserver | null>(null)
  const observedThreadContentRef = useRef<WeakSet<Element>>(new WeakSet())
  const pendingObservedContentScrollSyncFrameRef = useRef<number | null>(null)
  const pendingObservedContentScrollSyncKeyRef = useRef<string | null>(null)
  const pendingSidebarResizeScrollSyncRef = useRef(false)
  const smoothFollowScrollRef = useRef<ThreadSmoothFollowScroll | null>(null)
  const lastUserScrollIntentAtRef = useRef(0)
  const lastUserScrollIntentDirectionRef = useRef<"up" | "down" | null>(null)
  const followScrollSyncSuppressedUntilRef = useRef(0)
  const latestAssistantMessageStateRef = useRef<LatestAssistantMessageState | null>(null)
  const previousActiveMessageCountRef = useRef(activeMessages.length)
  const userScrollIntentConsumedRef = useRef(false)
  const lastKnownScrollTopRef = useRef(0)
  const currentScrollStateKeyRef = useRef<string | null>(null)
  const renderedMessageIDsByScrollKeyRef = useRef<Record<string, Set<string>>>({})
  const threadVirtualHeightCachesRef = useRef<Record<string, Map<string, number>>>({})
  const pendingThreadVirtualMeasurementsRef = useRef<Record<string, Map<string, number>>>({})
  const pendingThreadVirtualMeasurementFrameRef = useRef<number | null>(null)
  const pendingThreadVirtualMeasurementScrollSyncKeyRef = useRef<string | null>(null)
  const pendingThreadVirtualViewportFrameRef = useRef<number | null>(null)
  const previousProcessTraceCollapseEligibilityByMessageIDRef = useRef<Record<string, boolean>>({})
  const [threadVirtualMeasurementVersion, setThreadVirtualMeasurementVersion] = useState(0)
  const [threadViewUiState, setThreadViewUiState] = useState<ThreadViewUiState>(() => ({
    processTraceCollapseMotionByMessageID: {},
    processTraceExpansionByMessageID: {},
  }))
  const [threadVirtualViewport, setThreadVirtualViewport] = useState<ThreadVirtualViewport>({
    height: 0,
    paddingTop: 0,
    scrollTop: 0,
  })
  const threadVirtualViewportRef = useRef(threadVirtualViewport)
  const lastInlineLinkActivationRef = useRef<{
    href: string
    time: number
    x: number
    y: number
  } | null>(null)
  const activeSessionID = activeSession?.id ?? null
  const effectiveScrollStateKey = scrollStateKey ?? activeSessionID ?? "thread:no-session"
  const isResizeLightweightMode = useSidebarResizeLightweightMode()
  const visibleMessageIDs = useMemo(() => {
    const ids = displayMessages.map((message) => message.id)
    const pendingRequestID = pendingPermissionRequests[0]?.id
    return pendingRequestID ? [...ids, `permission-request:${pendingRequestID}`] : ids
  }, [displayMessages, pendingPermissionRequests])
  const visibleMessageIDsKey = visibleMessageIDs.join("\u0000")
  const pendingProcessTraceAutoCollapseMessageIDs = (() => {
    const previousEligibility = previousProcessTraceCollapseEligibilityByMessageIDRef.current
    const ids: string[] = []

    displayMessages.forEach((message) => {
      if (message.kind !== "assistant") return
      if (threadViewUiState.processTraceExpansionByMessageID[message.id] !== undefined) return
      if (previousEligibility[message.id] !== false || !canCollapseAssistantProcessTrace(message)) return
      ids.push(message.id)
    })

    return ids
  })()
  const pendingProcessTraceAutoCollapseKey = pendingProcessTraceAutoCollapseMessageIDs.join("\u0000")
  const effectiveThreadViewUiState = useMemo(() => {
    if (pendingProcessTraceAutoCollapseMessageIDs.length === 0) return threadViewUiState

    const processTraceCollapseMotionByMessageID = {
      ...threadViewUiState.processTraceCollapseMotionByMessageID,
    }
    pendingProcessTraceAutoCollapseMessageIDs.forEach((messageID) => {
      processTraceCollapseMotionByMessageID[messageID] = true
    })

    return {
      ...threadViewUiState,
      processTraceCollapseMotionByMessageID,
    }
  }, [pendingProcessTraceAutoCollapseKey, threadViewUiState])
  const displayRows = useMemo(
    () => measureRendererPerf(
      "ThreadView.buildDisplayRows",
      () => buildThreadDisplayRows({
        activeSession,
        activeMessages: displayMessages,
        assistantTraceVisibility,
        isResolvingPermissionRequest,
        pendingPermissionRequests,
        uiState: effectiveThreadViewUiState,
      }),
      () => ({
        assistantItemCount: displayMessages.reduce(
          (count, message) => count + (message.kind === "assistant" ? message.items.length : 0),
          0,
        ),
        pendingPermissionRequestCount: pendingPermissionRequests.length,
        sessionID: activeSession?.id ?? null,
        messageCount: displayMessages.length,
      }),
    ),
    [
      activeSession,
      displayMessages,
      assistantTraceVisibility,
      isResolvingPermissionRequest,
      pendingPermissionRequests,
      effectiveThreadViewUiState,
    ],
  )
  const shouldVirtualizeThreadRows = displayRows.length >= THREAD_VIRTUALIZATION_MIN_ROWS
  const threadVirtualHeightCache = getThreadVirtualHeightCache(effectiveScrollStateKey)
  const threadVirtualLayout = useMemo(
    () => buildThreadVirtualLayout(displayRows, threadVirtualHeightCache),
    [effectiveScrollStateKey, displayRows, threadVirtualHeightCache, threadVirtualMeasurementVersion],
  )
  const threadVirtualRange = useMemo(
    () => (shouldVirtualizeThreadRows
      ? findThreadVirtualRange(threadVirtualLayout, threadVirtualViewport)
      : {
          endIndex: displayRows.length,
          items: threadVirtualLayout.items,
          startIndex: 0,
        }),
    [shouldVirtualizeThreadRows, displayRows.length, threadVirtualLayout, threadVirtualViewport],
  )
  const threadVirtualRenderedRangeKey = `${threadVirtualRange.startIndex}:${threadVirtualRange.endIndex}:${threadVirtualLayout.totalHeight}`
  const activeProcessTraceCollapseMotionKey = Object.keys(effectiveThreadViewUiState.processTraceCollapseMotionByMessageID)
    .sort()
    .join("\u0000")

  useLayoutEffect(() => {
    previousProcessTraceCollapseEligibilityByMessageIDRef.current =
      buildAssistantProcessTraceCollapseEligibilityByMessageID(displayMessages)
  }, [displayMessages])

  useLayoutEffect(() => {
    if (pendingProcessTraceAutoCollapseMessageIDs.length === 0) return

    setThreadViewUiState((current) => {
      let changed = false
      const processTraceCollapseMotionByMessageID = {
        ...current.processTraceCollapseMotionByMessageID,
      }

      pendingProcessTraceAutoCollapseMessageIDs.forEach((messageID) => {
        if (current.processTraceExpansionByMessageID[messageID] !== undefined) return
        if (processTraceCollapseMotionByMessageID[messageID]) return
        processTraceCollapseMotionByMessageID[messageID] = true
        changed = true
      })

      return changed
        ? {
            ...current,
            processTraceCollapseMotionByMessageID,
          }
        : current
    })
  }, [pendingProcessTraceAutoCollapseKey])

  useEffect(() => {
    if (!activeProcessTraceCollapseMotionKey) return

    const messageIDs = activeProcessTraceCollapseMotionKey.split("\u0000")
    const timerIDs = messageIDs.map((messageID) =>
      window.setTimeout(() => {
        setThreadViewUiState((current) => {
          if (!current.processTraceCollapseMotionByMessageID[messageID]) return current

          const processTraceCollapseMotionByMessageID = {
            ...current.processTraceCollapseMotionByMessageID,
          }
          delete processTraceCollapseMotionByMessageID[messageID]

          return {
            ...current,
            processTraceCollapseMotionByMessageID,
          }
        })
      }, THREAD_AUTO_COLLAPSE_MOTION_MS),
    )

    return () => {
      timerIDs.forEach((timerID) => window.clearTimeout(timerID))
    }
  }, [activeProcessTraceCollapseMotionKey])

  function getThreadVirtualHeightCache(key = effectiveScrollStateKey) {
    const existingCache = threadVirtualHeightCachesRef.current[key]
    if (existingCache) return existingCache

    const nextCache = new Map<string, number>()
    threadVirtualHeightCachesRef.current[key] = nextCache
    return nextCache
  }

  function cancelThreadAnimationFrame(frameID: number | null) {
    if (
      frameID !== null &&
      typeof window !== "undefined" &&
      typeof window.cancelAnimationFrame === "function"
    ) {
      window.cancelAnimationFrame(frameID)
    }
  }

  function threadVirtualRangeWouldChange(nextViewport: ThreadVirtualViewport) {
    if (!shouldVirtualizeThreadRows) return false

    const nextRange = findThreadVirtualRange(threadVirtualLayout, nextViewport)
    return (
      nextRange.startIndex !== threadVirtualRange.startIndex ||
      nextRange.endIndex !== threadVirtualRange.endIndex
    )
  }

  function commitThreadVirtualViewport(
    nextViewport: ThreadVirtualViewport,
    options: ThreadVirtualViewportSyncOptions = {},
  ) {
    const previousViewport = threadVirtualViewportRef.current
    if (
      Math.abs(previousViewport.height - nextViewport.height) < THREAD_VIRTUAL_ROW_MEASURE_EPSILON_PX &&
      Math.abs(previousViewport.paddingTop - nextViewport.paddingTop) < THREAD_VIRTUAL_ROW_MEASURE_EPSILON_PX &&
      Math.abs(previousViewport.scrollTop - nextViewport.scrollTop) < THREAD_VIRTUAL_ROW_MEASURE_EPSILON_PX
    ) {
      return
    }

    threadVirtualViewportRef.current = nextViewport
    if (!options.forceCommit && !threadVirtualRangeWouldChange(nextViewport)) return

    setThreadVirtualViewport(nextViewport)
  }

  function readThreadVirtualViewport(threadColumn: HTMLDivElement): ThreadVirtualViewport {
    return {
      height: threadColumn.clientHeight,
      paddingTop: readThreadColumnPaddingTop(threadColumn),
      scrollTop: threadColumn.scrollTop,
    }
  }

  function syncThreadVirtualViewport(
    threadColumn: HTMLDivElement,
    options: ThreadVirtualViewportSyncOptions = {},
  ) {
    if (!shouldVirtualizeThreadRows) return

    commitThreadVirtualViewport(readThreadVirtualViewport(threadColumn), options)
  }

  function scheduleThreadVirtualViewportSync(threadColumn: HTMLDivElement) {
    if (!shouldVirtualizeThreadRows) return
    if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") {
      syncThreadVirtualViewport(threadColumn)
      return
    }
    if (pendingThreadVirtualViewportFrameRef.current !== null) return

    pendingThreadVirtualViewportFrameRef.current = window.requestAnimationFrame(() => {
      pendingThreadVirtualViewportFrameRef.current = null
      const currentThreadColumn = threadColumnRef.current
      if (!currentThreadColumn) return
      syncThreadVirtualViewport(currentThreadColumn)
    })
  }

  function scheduleObservedContentScrollSync(key = effectiveScrollStateKey) {
    if (isSidebarResizeInProgress()) {
      pendingSidebarResizeScrollSyncRef.current = true
      return
    }

    pendingObservedContentScrollSyncKeyRef.current = key
    if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") {
      pendingObservedContentScrollSyncKeyRef.current = null
      syncThreadScrollAfterContentChange(key, {
        smoothFollow: latestAssistantMessageStateRef.current?.isStreaming === true,
      })
      return
    }
    if (pendingObservedContentScrollSyncFrameRef.current !== null) return

    pendingObservedContentScrollSyncFrameRef.current = window.requestAnimationFrame(() => {
      pendingObservedContentScrollSyncFrameRef.current = null
      const pendingKey = pendingObservedContentScrollSyncKeyRef.current
      pendingObservedContentScrollSyncKeyRef.current = null
      if (!pendingKey) return
      if (smoothFollowScrollRef.current?.key === pendingKey) return
      syncThreadScrollAfterContentChange(pendingKey, {
        smoothFollow: latestAssistantMessageStateRef.current?.isStreaming === true,
      })
    })
  }

  function commitThreadVirtualRowHeight(rowID: string, height: number, key = effectiveScrollStateKey) {
    if (!Number.isFinite(height) || height < THREAD_VIRTUAL_ROW_MIN_HEIGHT_PX) return false

    const normalizedHeight = Math.max(THREAD_VIRTUAL_ROW_MIN_HEIGHT_PX, height)
    const heightCache = getThreadVirtualHeightCache(key)
    const previousHeight = heightCache.get(rowID)
    if (
      previousHeight !== undefined &&
      Math.abs(previousHeight - normalizedHeight) < THREAD_VIRTUAL_ROW_MEASURE_EPSILON_PX
    ) {
      return false
    }

    heightCache.set(rowID, normalizedHeight)
    return true
  }

  function flushQueuedThreadVirtualMeasurements() {
    let didMeasure = false

    for (const [key, measurements] of Object.entries(pendingThreadVirtualMeasurementsRef.current)) {
      for (const [rowID, height] of measurements) {
        didMeasure = commitThreadVirtualRowHeight(rowID, height, key) || didMeasure
      }
    }

    pendingThreadVirtualMeasurementsRef.current = {}
    pendingThreadVirtualMeasurementFrameRef.current = null

    if (didMeasure) {
      setThreadVirtualMeasurementVersion((version) => version + 1)
    }

    const scrollSyncKey = pendingThreadVirtualMeasurementScrollSyncKeyRef.current
    pendingThreadVirtualMeasurementScrollSyncKeyRef.current = null
    if (didMeasure && scrollSyncKey) {
      scheduleObservedContentScrollSync(scrollSyncKey)
    }

    return didMeasure
  }

  function scheduleQueuedThreadVirtualMeasurementsFlush() {
    if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") {
      flushQueuedThreadVirtualMeasurements()
      return
    }
    if (pendingThreadVirtualMeasurementFrameRef.current !== null) return

    pendingThreadVirtualMeasurementFrameRef.current = window.requestAnimationFrame(() => {
      flushQueuedThreadVirtualMeasurements()
    })
  }

  function queueThreadVirtualRowHeight(
    rowID: string,
    height: number,
    key = effectiveScrollStateKey,
    options: { syncScroll?: boolean } = {},
  ) {
    if (!Number.isFinite(height) || height < THREAD_VIRTUAL_ROW_MIN_HEIGHT_PX) return false

    const normalizedHeight = Math.max(THREAD_VIRTUAL_ROW_MIN_HEIGHT_PX, height)
    const existingMeasurements = pendingThreadVirtualMeasurementsRef.current[key]
    const pendingHeight = existingMeasurements?.get(rowID)
    if (
      pendingHeight !== undefined &&
      Math.abs(pendingHeight - normalizedHeight) < THREAD_VIRTUAL_ROW_MEASURE_EPSILON_PX
    ) {
      return false
    }

    const cachedHeight = getThreadVirtualHeightCache(key).get(rowID)
    if (
      pendingHeight === undefined &&
      cachedHeight !== undefined &&
      Math.abs(cachedHeight - normalizedHeight) < THREAD_VIRTUAL_ROW_MEASURE_EPSILON_PX
    ) {
      return false
    }

    const measurements = existingMeasurements ?? new Map<string, number>()
    if (!existingMeasurements) pendingThreadVirtualMeasurementsRef.current[key] = measurements
    measurements.set(rowID, normalizedHeight)

    if (options.syncScroll) {
      pendingThreadVirtualMeasurementScrollSyncKeyRef.current = key
    }
    scheduleQueuedThreadVirtualMeasurementsFlush()
    return true
  }

  function getThreadVirtualScrollMaxTop(threadColumn: HTMLDivElement) {
    const virtualScrollHeight =
      threadVirtualLayout.totalHeight +
      readThreadColumnPaddingTop(threadColumn) +
      readThreadColumnPaddingBottom(threadColumn)
    return Math.max(getThreadScrollMaxTop(threadColumn), virtualScrollHeight - threadColumn.clientHeight)
  }

  function shouldUseStreamingResponseScrollTargetForVirtualRows() {
    for (let index = displayRows.length - 1; index >= 0; index -= 1) {
      const row = displayRows[index]
      if (row?.kind !== "assistant-message") continue

      const streamingResponseIndex = row.renderedItems.findIndex(
        (item) => item.kind === "text" && item.isStreaming && traceSectionKeyForItem(item) === "response",
      )
      return streamingResponseIndex >= 0 && streamingResponseIndex < row.renderedItems.length - 1
    }

    return false
  }

  function getLatestThreadContentScrollTarget(threadColumn: HTMLDivElement): ThreadFollowScrollTarget {
    if (shouldVirtualizeThreadRows) {
      if (shouldUseStreamingResponseScrollTargetForVirtualRows()) {
        const streamingResponseTarget = getStreamingResponseScrollTarget(threadColumn)
        if (streamingResponseTarget) return streamingResponseTarget
      }

      const scrollTop = getThreadVirtualScrollMaxTop(threadColumn)
      return {
        scrollTop,
        visualScrollTop: scrollTop,
      }
    }

    const streamingResponseTarget = getStreamingResponseScrollTarget(threadColumn)
    if (streamingResponseTarget) return streamingResponseTarget

    return {
      scrollTop: threadColumn.scrollHeight,
      visualScrollTop: getThreadScrollMaxTop(threadColumn),
    }
  }

  function scrollThreadColumnToLatestThreadContent(threadColumn: HTMLDivElement) {
    const target = getLatestThreadContentScrollTarget(threadColumn)
    if (!shouldVirtualizeThreadRows) {
      threadColumn.scrollTop = target.scrollTop
      return
    }

    threadColumn.scrollTop = target.scrollTop
    syncThreadVirtualViewport(threadColumn)
  }

  function measureRenderedThreadVirtualRows(options: { syncScroll?: boolean } = {}) {
    const threadColumn = threadColumnRef.current
    if (!threadColumn || !shouldVirtualizeThreadRows) return false

    let didMeasure = false
    for (const element of Array.from(threadColumn.querySelectorAll<HTMLElement>("[data-thread-virtual-row-id]"))) {
      const rowID = element.dataset.threadVirtualRowId
      if (!rowID) continue

      const height = Math.max(element.offsetHeight, element.getBoundingClientRect().height)
      didMeasure = queueThreadVirtualRowHeight(rowID, height, effectiveScrollStateKey, options) || didMeasure
    }

    return didMeasure
  }

  function measureThreadVirtualRowsFromResizeEntries(
    entries: ResizeObserverEntry[],
    options: { syncScroll?: boolean } = {},
  ) {
    if (!shouldVirtualizeThreadRows) return false

    let didMeasure = false
    for (const entry of entries) {
      if (!(entry.target instanceof HTMLElement)) continue
      const rowID = entry.target.dataset.threadVirtualRowId
      if (!rowID) continue

      const height = readResizeEntryBlockSize(entry)
      if (height === null) continue
      didMeasure = queueThreadVirtualRowHeight(rowID, height, effectiveScrollStateKey, options) || didMeasure
    }

    return didMeasure
  }

  function captureThreadScrollSnapshot(
    threadColumn: HTMLDivElement,
    key = effectiveScrollStateKey,
    mode: ThreadScrollMode = scrollModeRef.current,
  ) {
    const snapshot = {
      ...readThreadScrollSnapshot(threadColumn),
      pinnedToBottom: mode === "follow",
    }
    latestScrollSnapshotRef.current = snapshot
    latestScrollSnapshotKeyRef.current = key
    threadScrollSnapshots.set(key, snapshot)
    return snapshot
  }

  function rememberThreadScrollSnapshot(key: string, snapshot: ThreadScrollSnapshot) {
    latestScrollSnapshotRef.current = snapshot
    latestScrollSnapshotKeyRef.current = key
    threadScrollSnapshots.set(key, snapshot)
  }

  function readLatestThreadScrollSnapshotForKey(key = effectiveScrollStateKey) {
    return latestScrollSnapshotKeyRef.current === key ? latestScrollSnapshotRef.current : null
  }

  function readStoredThreadScrollSnapshot(key = effectiveScrollStateKey) {
    return readScrollSnapshot?.(key) ?? threadScrollSnapshots.get(key) ?? null
  }

  function persistThreadScrollSnapshot(
    key = effectiveScrollStateKey,
    mode: ThreadScrollMode = scrollModeRef.current,
  ) {
    const threadColumn = threadColumnRef.current
    if (!threadColumn || !key) return

    const snapshot = captureThreadScrollSnapshot(threadColumn, key, mode)
    saveScrollSnapshot?.(key, snapshot)
  }

  function persistLatestThreadScrollSnapshot(key = effectiveScrollStateKey) {
    const snapshot = readLatestThreadScrollSnapshotForKey(key)
    if (!key || !snapshot) return false

    threadScrollSnapshots.set(key, snapshot)
    saveScrollSnapshot?.(key, snapshot)
    return true
  }

  function saveThreadScrollSnapshotValue(key: string, snapshot: ThreadScrollSnapshot) {
    if (!key) return

    threadScrollSnapshots.set(key, snapshot)
    saveScrollSnapshot?.(key, snapshot)
  }

  function rememberThreadTopScrollSnapshot(threadColumn: HTMLDivElement, key = effectiveScrollStateKey) {
    if (!key) return
    if (getThreadScrollMaxTop(threadColumn) <= THREAD_TOP_RESET_THRESHOLD_PX) return

    cancelSmoothFollowScroll()
    const snapshot: ThreadScrollSnapshot = {
      scrollTop: 0,
      pinnedToBottom: false,
      updatedAt: Date.now(),
    }
    scrollModeRef.current = "detached"
    lastKnownScrollTopRef.current = 0
    rememberThreadScrollSnapshot(key, snapshot)
    saveThreadScrollSnapshotValue(key, snapshot)
  }

  function detachThreadScrollFromFollow(threadColumn: HTMLDivElement, key = effectiveScrollStateKey) {
    if (!key) return false
    if (getThreadScrollMaxTop(threadColumn) <= THREAD_TOP_RESET_THRESHOLD_PX) return false

    cancelSmoothFollowScroll()
    const snapshot: ThreadScrollSnapshot = {
      ...readThreadScrollSnapshot(threadColumn),
      pinnedToBottom: false,
    }
    scrollModeRef.current = "detached"
    lastKnownScrollTopRef.current = threadColumn.scrollTop
    rememberThreadScrollSnapshot(key, snapshot)
    saveThreadScrollSnapshotValue(key, snapshot)
    return true
  }

  function setThreadScrollTop(threadColumn: HTMLDivElement, scrollTop: number) {
    threadColumn.scrollTop = clampThreadScrollTop(threadColumn, scrollTop)
    lastKnownScrollTopRef.current = threadColumn.scrollTop
    syncThreadVirtualViewport(threadColumn)
  }

  function cancelSmoothFollowScroll() {
    const frameID = smoothFollowScrollRef.current?.frameID ?? null
    smoothFollowScrollRef.current = null
    if (
      frameID !== null &&
      typeof window !== "undefined" &&
      typeof window.cancelAnimationFrame === "function"
    ) {
      window.cancelAnimationFrame(frameID)
    }
  }

  function scheduleSmoothFollowLatestThreadContent(threadColumn: HTMLDivElement, key = effectiveScrollStateKey) {
    if (
      typeof window === "undefined" ||
      typeof window.requestAnimationFrame !== "function" ||
      prefersReducedThreadMotion()
    ) {
      return false
    }

    const target = getLatestThreadContentScrollTarget(threadColumn)
    const delta = Math.abs(target.visualScrollTop - threadColumn.scrollTop)
    if (
      delta < THREAD_FOLLOW_SMOOTH_SCROLL_MIN_DELTA_PX ||
      delta > THREAD_FOLLOW_SMOOTH_SCROLL_MAX_DELTA_PX
    ) {
      return false
    }

    cancelSmoothFollowScroll()
    const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now()
    const animation: ThreadSmoothFollowScroll = {
      duration: getThreadSmoothFollowScrollDuration(delta),
      frameID: null,
      fromScrollTop: threadColumn.scrollTop,
      key,
      startedAt,
      targetScrollTop: target.visualScrollTop,
    }

    const pinnedSnapshot: ThreadScrollSnapshot = {
      scrollTop: target.visualScrollTop,
      pinnedToBottom: true,
      updatedAt: Date.now(),
    }
    scrollModeRef.current = "follow"
    rememberThreadScrollSnapshot(key, pinnedSnapshot)
    saveThreadScrollSnapshotValue(key, pinnedSnapshot)

    const step = (timestamp: number) => {
      if (smoothFollowScrollRef.current !== animation) return

      const currentThreadColumn = threadColumnRef.current
      if (
        !currentThreadColumn ||
        currentThreadColumn !== threadColumn ||
        currentScrollStateKeyRef.current !== key ||
        scrollModeRef.current !== "follow"
      ) {
        smoothFollowScrollRef.current = null
        return
      }

      const effectiveTimestamp = timestamp < animation.startedAt
        ? animation.startedAt + animation.duration
        : timestamp
      const progress = Math.min(1, Math.max(0, (effectiveTimestamp - animation.startedAt) / animation.duration))
      const easedProgress = easeThreadFollowScroll(progress)
      const nextScrollTop =
        animation.fromScrollTop +
        (animation.targetScrollTop - animation.fromScrollTop) * easedProgress
      setThreadScrollTop(currentThreadColumn, nextScrollTop)

      if (progress >= 1) {
        smoothFollowScrollRef.current = null
        persistThreadScrollSnapshot(key, "follow")
        return
      }

      animation.frameID = window.requestAnimationFrame(step)
    }

    smoothFollowScrollRef.current = animation
    animation.frameID = window.requestAnimationFrame(step)
    return true
  }

  function followLatestThreadContent(
    threadColumn: HTMLDivElement,
    key = effectiveScrollStateKey,
    options: { smooth?: boolean } = {},
  ) {
    scrollModeRef.current = "follow"
    if (options.smooth && scheduleSmoothFollowLatestThreadContent(threadColumn, key)) return

    cancelSmoothFollowScroll()
    scrollThreadColumnToLatestThreadContent(threadColumn)
    lastKnownScrollTopRef.current = threadColumn.scrollTop
    syncThreadVirtualViewport(threadColumn)
    persistThreadScrollSnapshot(key, "follow")
  }

  function preserveCurrentFollowThreadPosition(threadColumn: HTMLDivElement, key = effectiveScrollStateKey) {
    cancelSmoothFollowScroll()
    scrollModeRef.current = "follow"
    lastKnownScrollTopRef.current = threadColumn.scrollTop
    syncThreadVirtualViewport(threadColumn)
    persistThreadScrollSnapshot(key, "follow")
  }

  function restoreDetachedThreadPosition(
    threadColumn: HTMLDivElement,
    snapshot: ThreadScrollSnapshot,
    key = effectiveScrollStateKey,
  ) {
    cancelSmoothFollowScroll()
    scrollModeRef.current = "detached"
    if (!canRepresentThreadScrollTop(threadColumn, snapshot.scrollTop)) {
      rememberThreadScrollSnapshot(key, snapshot)
      return false
    }

    setThreadScrollTop(threadColumn, snapshot.scrollTop)
    persistThreadScrollSnapshot(key, "detached")
    return true
  }

  function restoreSavedThreadPosition(
    threadColumn: HTMLDivElement,
    snapshot: ThreadScrollSnapshot | null,
    key = effectiveScrollStateKey,
  ) {
    if (!snapshot || snapshot.pinnedToBottom) {
      followLatestThreadContent(threadColumn, key)
      return
    }

    restoreDetachedThreadPosition(threadColumn, snapshot, key)
  }

  function restoreDetachedThreadPositionIfNeeded(key = effectiveScrollStateKey) {
    const threadColumn = threadColumnRef.current
    if (!threadColumn || currentScrollStateKeyRef.current !== key) return false
    if (scrollModeRef.current !== "detached") return false
    if (threadColumn.scrollTop > THREAD_TOP_RESET_THRESHOLD_PX) return false

    const snapshot =
      getRestorableThreadScrollSnapshot(readLatestThreadScrollSnapshotForKey(key)) ??
      getRestorableThreadScrollSnapshot(readStoredThreadScrollSnapshot(key))
    if (!snapshot) return false

    return restoreDetachedThreadPosition(threadColumn, snapshot, key)
  }

  function syncThreadScrollAfterContentChange(
    key = effectiveScrollStateKey,
    options: { preserveFollowPosition?: boolean; smoothFollow?: boolean } = {},
  ) {
    const threadColumn = threadColumnRef.current
    if (!threadColumn || currentScrollStateKeyRef.current !== key) return

    if (scrollModeRef.current === "follow") {
      if (options.preserveFollowPosition || Date.now() <= followScrollSyncSuppressedUntilRef.current) {
        preserveCurrentFollowThreadPosition(threadColumn, key)
        return
      }

      followLatestThreadContent(threadColumn, key, { smooth: options.smoothFollow })
      return
    }

    restoreDetachedThreadPositionIfNeeded(key)
  }

  function syncThreadScrollAfterObservedContentChange(key = effectiveScrollStateKey) {
    scheduleObservedContentScrollSync(key)
  }

  const flushDeferredSidebarResizeScrollSync = useEffectEvent((key: string) => {
    cancelThreadAnimationFrame(pendingObservedContentScrollSyncFrameRef.current)
    pendingObservedContentScrollSyncFrameRef.current = null
    pendingObservedContentScrollSyncKeyRef.current = null
    cancelThreadAnimationFrame(pendingThreadVirtualMeasurementFrameRef.current)
    pendingThreadVirtualMeasurementFrameRef.current = null
    flushQueuedThreadVirtualMeasurements()

    if (!pendingSidebarResizeScrollSyncRef.current) return
    pendingSidebarResizeScrollSyncRef.current = false
    cancelThreadAnimationFrame(pendingObservedContentScrollSyncFrameRef.current)
    pendingObservedContentScrollSyncFrameRef.current = null
    pendingObservedContentScrollSyncKeyRef.current = null
    syncThreadScrollAfterContentChange(key)
  })

  function readThreadMessageMotion(messageID: string, isLive = false): ThreadMessageMotion {
    const renderedMessageIDs = renderedMessageIDsByScrollKeyRef.current[effectiveScrollStateKey]
    if (!renderedMessageIDs || renderedMessageIDs.has(messageID) || !isThreadVisible) return "history"
    return isLive ? "live" : "new"
  }

  useEffect(() => {
    return () => {
      cancelSmoothFollowScroll()
      const latestSnapshotKey = latestScrollSnapshotKeyRef.current
      if (latestSnapshotKey) {
        persistLatestThreadScrollSnapshot(latestSnapshotKey)
      }
      if (copiedResponseTimeoutRef.current !== null) {
        window.clearTimeout(copiedResponseTimeoutRef.current)
      }
      if (copiedUserTimeoutRef.current !== null) {
        window.clearTimeout(copiedUserTimeoutRef.current)
      }
      cancelThreadAnimationFrame(pendingObservedContentScrollSyncFrameRef.current)
      pendingObservedContentScrollSyncFrameRef.current = null
      cancelThreadAnimationFrame(pendingThreadVirtualMeasurementFrameRef.current)
      pendingThreadVirtualMeasurementFrameRef.current = null
      cancelThreadAnimationFrame(pendingThreadVirtualViewportFrameRef.current)
      pendingThreadVirtualViewportFrameRef.current = null
      contentResizeObserverRef.current?.disconnect()
      contentResizeObserverRef.current = null
      contentMutationObserverRef.current?.disconnect()
      contentMutationObserverRef.current = null
    }
  }, [])

  const handleCopyAssistantResponse = useEffectEvent(async (messageID: string, text: string) => {
    try {
      await writeTextToClipboard(text)
      setCopiedResponseMessageID(messageID)

      if (copiedResponseTimeoutRef.current !== null) {
        window.clearTimeout(copiedResponseTimeoutRef.current)
      }

      copiedResponseTimeoutRef.current = window.setTimeout(() => {
        setCopiedResponseMessageID((current) => (current === messageID ? null : current))
        copiedResponseTimeoutRef.current = null
      }, 1600)
    } catch (error) {
      console.error("[desktop] Failed to copy assistant response:", error)
    }
  })

  const handleCopyUserMessage = useEffectEvent(async (messageID: string, text: string) => {
    try {
      await writeTextToClipboard(text)
      setCopiedUserThreadMessageID(messageID)

      if (copiedUserTimeoutRef.current !== null) {
        window.clearTimeout(copiedUserTimeoutRef.current)
      }

      copiedUserTimeoutRef.current = window.setTimeout(() => {
        setCopiedUserThreadMessageID((current) => (current === messageID ? null : current))
        copiedUserTimeoutRef.current = null
      }, 1600)
    } catch (error) {
      console.error("[desktop] Failed to copy user message:", error)
    }
  })

  const handleOpenImagePreview = useEffectEvent((payload: ImagePreviewPayload) => {
    if (!payload.src) return
    setActiveImagePreview({
      ...payload,
      openedAt: Date.now(),
    })
  })

  const handleCloseImagePreview = useEffectEvent(() => {
    setActiveImagePreview(null)
  })

  useEffect(() => {
    function handleInlineThreadLinkActivation(event: MouseEvent | PointerEvent) {
      if (event.defaultPrevented || event.button !== 0) return
      const threadColumn = threadColumnRef.current
      if (!threadColumn) return

      let anchor: HTMLAnchorElement | null = null
      for (const target of event.composedPath()) {
        if (!(target instanceof Element)) continue
        const candidate = target.closest<HTMLAnchorElement>("a[href]")
        if (candidate && threadColumn.contains(candidate)) {
          anchor = candidate
          break
        }
      }

      if (!anchor) {
        const elementsAtPoint = document.elementsFromPoint?.(event.clientX, event.clientY) ?? []
        for (const element of elementsAtPoint) {
          const candidate = element.closest<HTMLAnchorElement>("a[href]")
          if (candidate && threadColumn.contains(candidate)) {
            anchor = candidate
            break
          }
        }
      }

      if (!anchor) return

      const linkTarget = normalizeMarkdownLinkTarget(anchor.getAttribute("href") ?? "")
      if (!linkTarget) return

      const lastActivation = lastInlineLinkActivationRef.current
      const isDuplicateClick =
        event.type === "click" &&
        lastActivation?.href === linkTarget.href &&
        Date.now() - lastActivation.time < 700 &&
        Math.abs(lastActivation.x - event.clientX) < 6 &&
        Math.abs(lastActivation.y - event.clientY) < 6

      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()

      if (isDuplicateClick) return

      lastInlineLinkActivationRef.current = {
        href: linkTarget.href,
        time: Date.now(),
        x: event.clientX,
        y: event.clientY,
      }

      if (linkTarget.kind === "local-file") {
        onLocalFileLinkOpen?.(linkTarget.target)
        return
      }
      if (linkTarget.kind === "artifact") {
        onArtifactLinkOpen?.(linkTarget.target)
        return
      }

      openExternalThreadLink(linkTarget.href)
    }

    document.addEventListener("pointerup", handleInlineThreadLinkActivation, { capture: true })
    document.addEventListener("click", handleInlineThreadLinkActivation, { capture: true })
    return () => {
      document.removeEventListener("pointerup", handleInlineThreadLinkActivation, { capture: true })
      document.removeEventListener("click", handleInlineThreadLinkActivation, { capture: true })
    }
  }, [onArtifactLinkOpen, onLocalFileLinkOpen, threadColumnRef])

  useLayoutEffect(() => {
    const threadColumn = threadColumnRef.current
    if (!threadColumn) return

    const previousScrollStateKey = currentScrollStateKeyRef.current
    if (previousScrollStateKey && previousScrollStateKey !== effectiveScrollStateKey) {
      persistLatestThreadScrollSnapshot(previousScrollStateKey)
    }

    currentScrollStateKeyRef.current = effectiveScrollStateKey
    restoreSavedThreadPosition(threadColumn, readStoredThreadScrollSnapshot(effectiveScrollStateKey), effectiveScrollStateKey)
  }, [effectiveScrollStateKey, readScrollSnapshot, threadColumnRef])

  useLayoutEffect(() => {
    const threadColumn = threadColumnRef.current
    if (!threadColumn || typeof ResizeObserver === "undefined") return

    contentResizeObserverRef.current?.disconnect()
    contentMutationObserverRef.current?.disconnect()

    const resizeObserver = new ResizeObserver((entries) => {
      measureThreadVirtualRowsFromResizeEntries(entries, { syncScroll: true })
      syncThreadScrollAfterObservedContentChange(effectiveScrollStateKey)
    })
    observedThreadContentRef.current = new WeakSet()
    const observeThreadContent = () => {
      if (!observedThreadContentRef.current.has(threadColumn)) {
        resizeObserver.observe(threadColumn)
        observedThreadContentRef.current.add(threadColumn)
      }
      for (const child of Array.from(threadColumn.children)) {
        if (observedThreadContentRef.current.has(child)) continue
        resizeObserver.observe(child)
        observedThreadContentRef.current.add(child)
      }
      if (shouldVirtualizeThreadRows) {
        for (const row of Array.from(threadColumn.querySelectorAll<HTMLElement>("[data-thread-virtual-row-id]"))) {
          if (observedThreadContentRef.current.has(row)) continue
          resizeObserver.observe(row)
          observedThreadContentRef.current.add(row)
        }
      }
    }

    observeThreadContent()
    contentResizeObserverRef.current = resizeObserver

    if (typeof MutationObserver !== "undefined") {
      const mutationObserver = new MutationObserver(() => {
        observeThreadContent()
        syncThreadScrollAfterObservedContentChange(effectiveScrollStateKey)
      })
      mutationObserver.observe(threadColumn, { childList: true, subtree: shouldVirtualizeThreadRows })
      contentMutationObserverRef.current = mutationObserver
    }

    return () => {
      resizeObserver.disconnect()
      if (contentResizeObserverRef.current === resizeObserver) {
        contentResizeObserverRef.current = null
      }
      observedThreadContentRef.current = new WeakSet()
      contentMutationObserverRef.current?.disconnect()
      contentMutationObserverRef.current = null
    }
  }, [effectiveScrollStateKey, shouldVirtualizeThreadRows, threadColumnRef])

  useLayoutEffect(() => {
    const threadColumn = threadColumnRef.current
    if (!threadColumn || !shouldVirtualizeThreadRows) return

    syncThreadVirtualViewport(threadColumn, { forceCommit: true })
  }, [
    effectiveScrollStateKey,
    shouldVirtualizeThreadRows,
    threadColumnRef,
    displayRows.length,
    threadVirtualLayout.totalHeight,
  ])

  useLayoutEffect(() => {
    if (!shouldVirtualizeThreadRows) return

    const didMeasure = measureRenderedThreadVirtualRows({ syncScroll: true })
    if (didMeasure) {
      syncThreadScrollAfterObservedContentChange(effectiveScrollStateKey)
    }
  }, [
    effectiveScrollStateKey,
    shouldVirtualizeThreadRows,
    threadColumnRef,
    threadVirtualRenderedRangeKey,
  ])

  useEffect(() => {
    function handleSidebarResizeEnd() {
      flushDeferredSidebarResizeScrollSync(effectiveScrollStateKey)
    }

    window.addEventListener(SIDEBAR_RESIZE_END_EVENT, handleSidebarResizeEnd)
    return () => {
      window.removeEventListener(SIDEBAR_RESIZE_END_EVENT, handleSidebarResizeEnd)
    }
  }, [effectiveScrollStateKey, flushDeferredSidebarResizeScrollSync])

  useLayoutEffect(() => {
    const threadColumn = threadColumnRef.current
    if (!threadColumn) return

    const previousLatestAssistantMessageState = latestAssistantMessageStateRef.current
    const previousActiveMessageCount = previousActiveMessageCountRef.current
    const latestAssistantMessageState = readLatestAssistantMessageState(displayMessages)
    const isCompletingLatestAssistantMessage = Boolean(
      previousLatestAssistantMessageState &&
      latestAssistantMessageState &&
      previousLatestAssistantMessageState.id === latestAssistantMessageState.id &&
      previousLatestAssistantMessageState.isStreaming &&
      !latestAssistantMessageState.isStreaming,
    )
    const isUpdatingSameStreamingAssistantMessage = Boolean(
      previousLatestAssistantMessageState &&
      latestAssistantMessageState &&
      previousLatestAssistantMessageState.id === latestAssistantMessageState.id &&
      previousLatestAssistantMessageState.isStreaming &&
      latestAssistantMessageState.isStreaming &&
      previousActiveMessageCount === displayMessages.length,
    )

    if (isCompletingLatestAssistantMessage) {
      followScrollSyncSuppressedUntilRef.current = Date.now() + THREAD_COMPLETION_SCROLL_SYNC_SUPPRESS_MS
    }

    syncThreadScrollAfterContentChange(effectiveScrollStateKey, {
      preserveFollowPosition: isCompletingLatestAssistantMessage,
      smoothFollow: isUpdatingSameStreamingAssistantMessage,
    })
    latestAssistantMessageStateRef.current = latestAssistantMessageState
    previousActiveMessageCountRef.current = displayMessages.length
  }, [
    displayMessages,
    effectiveScrollStateKey,
    pendingPermissionRequests.length,
    permissionRequestActionRequestID,
    readScrollSnapshot,
    threadColumnRef,
  ])

  useLayoutEffect(() => {
    restoreDetachedThreadPositionIfNeeded(effectiveScrollStateKey)
  })

  useLayoutEffect(() => {
    const renderedMessageIDs = renderedMessageIDsByScrollKeyRef.current[effectiveScrollStateKey] ?? new Set<string>()
    for (const messageID of visibleMessageIDs) {
      renderedMessageIDs.add(messageID)
    }
    renderedMessageIDsByScrollKeyRef.current[effectiveScrollStateKey] = renderedMessageIDs
  }, [effectiveScrollStateKey, visibleMessageIDsKey])

  function handleThreadScrollIntent(event?: { currentTarget: HTMLDivElement }) {
    cancelSmoothFollowScroll()
    lastUserScrollIntentAtRef.current = Date.now()
    userScrollIntentConsumedRef.current = false
    if (event?.currentTarget) {
      lastKnownScrollTopRef.current = event.currentTarget.scrollTop
    }
  }

  function handleThreadPointerMoveIntent(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType === "mouse" && event.buttons === 0) return
    handleThreadScrollIntent()
  }

  function handleThreadKeyDownIntent(event: KeyboardEvent<HTMLDivElement>) {
    handleThreadScrollIntent(event)

    if (event.key === "ArrowUp" || event.key === "PageUp" || event.key === "Home") {
      lastUserScrollIntentDirectionRef.current = "up"
      detachThreadScrollFromFollow(event.currentTarget)
    } else if (event.key === "ArrowDown" || event.key === "PageDown" || event.key === "End") {
      lastUserScrollIntentDirectionRef.current = "down"
    }
  }

  function handleThreadWheelIntent(event: ReactWheelEvent<HTMLDivElement>) {
    if (event.deltaY < 0) {
      lastUserScrollIntentDirectionRef.current = "up"
      detachThreadScrollFromFollow(event.currentTarget)
    } else if (event.deltaY > 0) {
      lastUserScrollIntentDirectionRef.current = "down"
    }

    handleThreadScrollIntent(event)

    if (event.deltaY < 0 && event.currentTarget.scrollTop <= THREAD_TOP_RESET_THRESHOLD_PX) {
      rememberThreadTopScrollSnapshot(event.currentTarget)
    }
  }

  function hasRecentThreadScrollIntent() {
    return (
      !userScrollIntentConsumedRef.current &&
      Date.now() - lastUserScrollIntentAtRef.current <= THREAD_USER_SCROLL_INTENT_WINDOW_MS
    )
  }

  function hasRecentUpwardThreadScrollIntent() {
    return (
      lastUserScrollIntentDirectionRef.current === "up" &&
      Date.now() - lastUserScrollIntentAtRef.current <= THREAD_USER_SCROLL_INTENT_WINDOW_MS
    )
  }

  function handleThreadScroll() {
    const threadColumn = threadColumnRef.current
    if (!threadColumn) return
    scheduleThreadVirtualViewportSync(threadColumn)

    if (!hasRecentThreadScrollIntent()) {
      if (threadColumn.scrollTop <= THREAD_TOP_RESET_THRESHOLD_PX) {
        if (hasRecentUpwardThreadScrollIntent()) {
          rememberThreadTopScrollSnapshot(threadColumn, effectiveScrollStateKey)
          return
        }
        if (restoreDetachedThreadPositionIfNeeded(effectiveScrollStateKey)) {
          return
        }
      }
      lastKnownScrollTopRef.current = threadColumn.scrollTop
      return
    }
    userScrollIntentConsumedRef.current = true

    const previousScrollTop = lastKnownScrollTopRef.current
    const rawSnapshot = readThreadScrollSnapshot(threadColumn)
    const movedUp = rawSnapshot.scrollTop < previousScrollTop - 1
    const nextMode: ThreadScrollMode = rawSnapshot.pinnedToBottom && !movedUp ? "follow" : "detached"
    const snapshot = {
      ...rawSnapshot,
      pinnedToBottom: nextMode === "follow",
    }

    scrollModeRef.current = nextMode
    lastKnownScrollTopRef.current = rawSnapshot.scrollTop
    rememberThreadScrollSnapshot(effectiveScrollStateKey, snapshot)
    saveThreadScrollSnapshotValue(effectiveScrollStateKey, snapshot)
  }

  function toggleProcessTraceRow(messageID: string, expanded: boolean, collapsing: boolean) {
    const threadColumn = threadColumnRef.current
    if (threadColumn) {
      detachThreadScrollFromFollow(threadColumn, effectiveScrollStateKey)
    }

    setThreadViewUiState((current) => {
      const processTraceCollapseMotionByMessageID = {
        ...current.processTraceCollapseMotionByMessageID,
      }
      delete processTraceCollapseMotionByMessageID[messageID]

      return {
        ...current,
        processTraceCollapseMotionByMessageID,
        processTraceExpansionByMessageID: {
          ...current.processTraceExpansionByMessageID,
          [messageID]: collapsing ? true : !expanded,
        },
      }
    })
  }

  function renderDisplayRow(row: ThreadDisplayRow) {
    if (row.kind === "user-message") {
      const { message, messageIndex } = row
      return (
        <UserThreadMessageArticle
          key={row.rowID}
          copied={copiedUserThreadMessageID === message.id}
          motion={readThreadMessageMotion(message.id)}
          onCopy={handleCopyUserMessage}
          message={message}
          diffCard={
            shouldRenderDiffOnStandaloneUserMessage(displayMessages, messageIndex, message) ? (
              <MessageDiffCard
                messageID={message.id}
                diffSummary={message.diffSummary}
                activeSessionDiff={activeSessionDiff}
                allowWorkspaceDiffFallback={messageIndex === displayMessages.length - 1}
                onFileChangeSelect={onFileChangeSelect}
                onMessageDiffSummaryHydrate={onMessageDiffSummaryHydrate}
                onMessageDiffRestore={onMessageDiffRestore}
                onMessageDiffReview={onMessageDiffReview}
              />
            ) : null
          }
        />
      )
    }

    if (row.kind === "permission-request") {
      return (
        <PermissionRequestInlinePrompt
          key={row.rowID}
          activeSession={activeSession}
          isResolvingPermissionRequest={isResolvingPermissionRequest}
          pendingPermissionRequests={pendingPermissionRequests}
          permissionRequestActionError={permissionRequestActionError}
          permissionRequestActionRequestID={permissionRequestActionRequestID}
          motion={readThreadMessageMotion(
            pendingPermissionRequests[0]?.id ? `permission-request:${pendingPermissionRequests[0].id}` : "permission-request",
          )}
          onPermissionRequestResponse={onPermissionRequestResponse}
        />
      )
    }

    if (row.kind === "process-header") {
      const duration = formatAssistantProcessTraceDuration(row.blocks, row.message.runtime)
      const summary = summarizeProcessTraceBlocks(row.blocks)

      return (
        <article
          key={row.rowID}
          className={joinClassNames(
            "thread-row",
            "assistant-process-trace",
            "assistant-process-trace-row",
            row.expanded ? "is-expanded" : "is-collapsed",
            row.collapsing && "is-collapsing",
          )}
          data-depth="0"
          data-kind="process-header"
          data-thread-message-id={row.messageID}
          data-thread-message-motion={readThreadMessageMotion(row.messageID, row.message.isStreaming)}
        >
          <AssistantProcessTraceHeader
            duration={duration}
            isExpanded={row.expanded}
            summary={summary}
            onToggle={() => toggleProcessTraceRow(row.messageID, row.expanded, row.collapsing)}
          />
        </article>
      )
    }

    if (row.kind === "process-item") {
      const isLatestAssistantMessage = isAssistantLatestRenderableMessage(displayMessages, row.messageIndex, row.message)

      return (
        <article
          key={row.rowID}
          className={joinClassNames(
            "thread-row",
            "assistant-process-item-row",
            "assistant-section",
            `is-${row.section}`,
            row.collapsing && "is-collapsing",
          )}
          data-depth="1"
          data-kind="process-item"
          data-thread-message-id={row.messageID}
          role="region"
          aria-label={traceSectionTitle(row.section)}
        >
          <div className={getAssistantTraceBlockStackClassName(row.section)}>
            <TraceItemView
              assistantMessagePhase={row.message.runtime.phase}
              item={row.item}
              isQuestionAnswered={Boolean(
                row.item.questionPrompt?.answered ||
                (row.item.questionPrompt?.questionID && answeredQuestionIDs.has(row.item.questionPrompt.questionID)),
              )}
              isQuestionAnswerDisabled={isResolvingPermissionRequest || pendingPermissionRequests.length > 0}
              onOpenImagePreview={handleOpenImagePreview}
              onAskUserQuestionAnswer={onAskUserQuestionAnswer}
              onFileChangeSelect={onFileChangeSelect}
              onArtifactLinkOpen={onArtifactLinkOpen}
              onLocalFileLinkOpen={onLocalFileLinkOpen}
              isLatestMessage={isLatestAssistantMessage}
              onProposedPlanConfirm={onProposedPlanConfirm}
              shouldCollapseAfterMessageCompletion={row.shouldCollapseReasoningAndTools}
              traceVisibility={assistantTraceVisibility}
            />
          </div>
        </article>
      )
    }

    const { ephemeralHint, insertedUserMessages, processPrefixItems, message, messageIndex } = row
    const traceItems = message.items
    const sideChatAnchorMessageID = resolveAssistantSideChatAnchorMessageID(displayMessages, message)
    const threadMessageID = getSessionMessageIDForMessage(message)
    const canExposeResponseActions = !isSessionRunning && isAssistantFinalMessageInUserMessage(displayMessages, messageIndex, message)
    const branchOptions = canExposeResponseActions ? messageTree?.branchOptionsByParentID[threadMessageID] ?? [] : []
    const existingSideChatCount = sideChatCountsByAnchorMessageID[sideChatAnchorMessageID] ?? 0
    const lastResponseItems = canExposeResponseActions ? getLastAssistantResponseSectionItems(traceItems, assistantTraceVisibility) : []
    const responseCopyText = canExposeResponseActions ? buildAssistantResponseCopyText(lastResponseItems) : ""
    const canOpenSideChat =
      !readOnlySideChat &&
      !message.isStreaming &&
      canExposeResponseActions &&
      lastResponseItems.length > 0 &&
      Boolean(onOpenSideChat)
    const canForkFromMessage =
      !readOnlySideChat &&
      !message.isStreaming &&
      canExposeResponseActions &&
      Boolean(onForkFromMessage)
    const activeInlineSideChat = sideChatSession?.origin?.anchorMessageID === sideChatAnchorMessageID ? sideChatSession : null
    const rendersSideChatInline = sideChatPlacement === "inline"
    const marksSideChatButtonActive = rendersSideChatInline && Boolean(activeInlineSideChat)
    const sideChatButtonLabel =
      rendersSideChatInline && activeInlineSideChat
        ? "Hide this side chat"
        : existingSideChatCount > 0
          ? `Open side chat (${existingSideChatCount})`
          : "Open side chat"
    const sideChatButtonTitle =
      rendersSideChatInline && activeInlineSideChat
        ? "Hide this side chat"
        : existingSideChatCount > 0
          ? `${existingSideChatCount} side chat thread${existingSideChatCount === 1 ? "" : "s"}`
          : "Open a side chat for this reply"
    const hasAssistantDiffSummary = normalizeMessageDiffSummary(message.diffSummary).length > 0
    const trailingUserDiffMessage = hasAssistantDiffSummary ? null : getAssistantTrailingUserDiffMessage(displayMessages, messageIndex, message)
    const shouldRenderResponseActions = Boolean(
      responseCopyText ||
      canOpenSideChat ||
      canForkFromMessage ||
      branchOptions.length > 1,
    )
    const isLatestAssistantMessage = isAssistantLatestRenderableMessage(displayMessages, messageIndex, message)

    return (
      <article
        key={row.rowID}
        className="thread-message assistant-message"
        data-thread-message-id={message.id}
        data-thread-message-motion={readThreadMessageMotion(message.id, message.isStreaming)}
      >
        <div className={message.isStreaming ? "assistant-shell is-sectioned is-streaming" : "assistant-shell is-sectioned"}>
          {ephemeralHint ? (
            <>
              <AssistantMessagePlaceholder message={ephemeralHint} />
              {insertedUserMessages.map((insertedMessage) => (
                <UserThreadMessageArticle
                  key={insertedMessage.id}
                  className="assistant-stream-insertion-user-message"
                  copied={copiedUserThreadMessageID === insertedMessage.id}
                  motion={readThreadMessageMotion(insertedMessage.id)}
                  onCopy={handleCopyUserMessage}
                  message={insertedMessage}
                />
              ))}
            </>
          ) : (
            <AssistantMessageSectionsWithStreamInsertions
              answeredQuestionIDs={answeredQuestionIDs}
              assistantMessagePhase={message.runtime.phase}
              isQuestionAnswerDisabled={isResolvingPermissionRequest || pendingPermissionRequests.length > 0}
              copiedUserThreadMessageID={copiedUserThreadMessageID}
              insertedUserMessages={insertedUserMessages}
              isLatestMessage={isLatestAssistantMessage}
              items={traceItems}
              getMessageMotion={readThreadMessageMotion}
              onCopyUserMessage={handleCopyUserMessage}
              onOpenImagePreview={handleOpenImagePreview}
              onAskUserQuestionAnswer={onAskUserQuestionAnswer}
              onFileChangeSelect={onFileChangeSelect}
              onArtifactLinkOpen={onArtifactLinkOpen}
              onLocalFileLinkOpen={onLocalFileLinkOpen}
              onProposedPlanConfirm={onProposedPlanConfirm}
              processPrefixItems={processPrefixItems}
              renderProcessTrace={false}
              runtime={message.runtime}
              showFileChanges={!message.isStreaming}
              shouldCollapseReasoningAndTools={canCollapseAssistantProcessTrace(message)}
              traceVisibility={assistantTraceVisibility}
            />
          )}
          {hasAssistantDiffSummary ? (
            <MessageDiffCard
              messageID={message.id}
              diffSummary={message.diffSummary}
              activeSessionDiff={activeSessionDiff}
              allowWorkspaceDiffFallback={isLatestAssistantMessage}
              patchSourceFileChanges={collectAssistantPatchFileChanges(message)}
              onFileChangeSelect={onFileChangeSelect}
              onMessageDiffSummaryHydrate={onMessageDiffSummaryHydrate}
              onMessageDiffRestore={onMessageDiffRestore}
              onMessageDiffReview={onMessageDiffReview}
            />
          ) : trailingUserDiffMessage ? (
            <MessageDiffCard
              messageID={trailingUserDiffMessage.id}
              diffSummary={trailingUserDiffMessage.diffSummary}
              activeSessionDiff={activeSessionDiff}
              allowWorkspaceDiffFallback={isLatestAssistantMessage}
              patchSourceFileChanges={collectAssistantPatchFileChanges(message)}
              onFileChangeSelect={onFileChangeSelect}
              onMessageDiffSummaryHydrate={onMessageDiffSummaryHydrate}
              onMessageDiffRestore={onMessageDiffRestore}
              onMessageDiffReview={onMessageDiffReview}
            />
          ) : null}
          {shouldRenderResponseActions ? (
            <div className="assistant-response-side-chat">
              {rendersSideChatInline &&
              activeInlineSideChat &&
              onSideChatDraftStateChange &&
              onSideChatPickAttachments &&
              onSideChatRemoveAttachment &&
              onSideChatCreate &&
              onSideChatDelete &&
              onSideChatSelect &&
              onSideChatSend ? (
                <InlineSideChatThread
                  activeProjectID={activeProjectID}
                  attachments={sideChatAttachments}
                  assistantTraceVisibility={assistantTraceVisibility}
                  composerRefreshVersion={composerRefreshVersion}
                  draftState={sideChatDraftState}
                  isAgentDebugTraceEnabled={isAgentDebugTraceEnabled}
                  isResolvingPermissionRequest={isResolvingPermissionRequest}
                  isCancelling={sideChatIsCancelling}
                  isInterruptible={sideChatIsInterruptible}
                  isSending={sideChatIsSending}
                  pendingInputs={sideChatPendingInputs}
                  pendingPermissionRequests={sideChatPendingPermissionRequests}
                  permissionRequestActionError={sideChatPermissionRequestActionError}
                  permissionRequestActionRequestID={sideChatPermissionRequestActionRequestID}
                  session={activeInlineSideChat}
                  sideChatSessions={sideChatSessionsByAnchorMessageID[sideChatAnchorMessageID] ?? [activeInlineSideChat]}
                  messages={sideChatMessages}
                  isThreadVisible={isThreadVisible}
                  readScrollSnapshot={readScrollSnapshot}
                  saveScrollSnapshot={saveScrollSnapshot}
                  onDraftStateChange={onSideChatDraftStateChange}
                  onHide={() => void onOpenSideChat?.(sideChatAnchorMessageID)}
                  onAskUserQuestionAnswer={onAskUserQuestionAnswer}
                  onArtifactLinkOpen={onArtifactLinkOpen}
                  onLocalFileLinkOpen={onLocalFileLinkOpen}
                  onPermissionRequestResponse={onPermissionRequestResponse}
                  onPickAttachments={onSideChatPickAttachments}
                  onPasteImageAttachments={onSideChatPasteImageAttachments}
                  onRemoveAttachment={onSideChatRemoveAttachment}
                  onCancelSend={onSideChatCancelSend}
                  onCreateSideChat={() => onSideChatCreate(sideChatAnchorMessageID)}
                  onDeleteSideChat={onSideChatDelete}
                  onSend={onSideChatSend}
                  onSelectSideChat={onSideChatSelect}
                  onSessionModelSelectionChange={onSessionModelSelectionChange}
                />
              ) : null}

              <div className="assistant-response-actions">
                <BranchSwitcher options={branchOptions} onSelect={onBranchSelect} />
                {responseCopyText ? (
                  <button
                    className={joinClassNames(
                      "assistant-response-action-button message-action-icon-button",
                      copiedResponseMessageID === message.id && "is-active",
                    )}
                    type="button"
                    aria-label={copiedResponseMessageID === message.id ? "Copied assistant response" : "Copy assistant response"}
                    title={copiedResponseMessageID === message.id ? "Copied" : "Copy"}
                    onClick={() => void handleCopyAssistantResponse(message.id, responseCopyText)}
                  >
                    <CopyIcon />
                  </button>
                ) : null}
                {canOpenSideChat ? (
                  <button
                    className={joinClassNames(
                      "assistant-response-action-button message-action-icon-button",
                      marksSideChatButtonActive && "is-active",
                    )}
                    type="button"
                    aria-label={sideChatButtonLabel}
                    aria-pressed={marksSideChatButtonActive}
                    title={sideChatButtonTitle}
                    onClick={() => void onOpenSideChat?.(sideChatAnchorMessageID)}
                  >
                    <SideChatIcon />
                  </button>
                ) : null}
                {canForkFromMessage ? (
                  <button
                    className="assistant-response-action-button message-action-icon-button"
                    type="button"
                    aria-label="Fork from here"
                    title="Fork from here"
                    onClick={() => void onForkFromMessage?.(threadMessageID)}
                  >
                    <ForkIcon />
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      </article>
    )
  }

  function renderThreadRows() {
    if (!shouldVirtualizeThreadRows) {
      return displayRows.map((row) => renderDisplayRow(row))
    }

    return (
      <div
        className="thread-virtual-spacer"
        style={{ height: `${threadVirtualLayout.totalHeight}px` }}
      >
        {threadVirtualRange.items.map((item) => (
          <div
            key={item.row.rowID}
            className="thread-virtual-row"
            data-thread-virtual-row-id={item.row.rowID}
            style={{ transform: `translateY(${item.top}px)` }}
          >
            {renderDisplayRow(item.row)}
          </div>
        ))}
      </div>
    )
  }

  return (
    <section className={joinClassNames("thread-shell", isResizeLightweightMode && "thread-resize-lightweight")}>
      <div
        ref={threadColumnRef}
        className={joinClassNames("thread-column", shouldVirtualizeThreadRows && "is-virtualized")}
        onKeyDownCapture={handleThreadKeyDownIntent}
        onPointerDownCapture={handleThreadScrollIntent}
        onPointerMoveCapture={handleThreadPointerMoveIntent}
        onScroll={handleThreadScroll}
        onWheelCapture={handleThreadWheelIntent}
      >
        {!activeSession ? (
          <article className="thread-message assistant-message">
            <div className="assistant-shell">
              <header className="assistant-header">
                <div>
                  <span className="label">Agent Message</span>
                  <h3>No session selected</h3>
                </div>
              </header>

              <div className="assistant-trace-list">
                <TraceItemView
                  item={{
                    id: "empty-no-session",
                    kind: "system",
                    timestamp: Date.now(),
                    label: "System",
                    title: "No session selected",
                    detail: "Load a folder from the sidebar or create a new session to begin.",
                    status: "completed",
                  }}
                  traceVisibility={assistantTraceVisibility}
                />
              </div>
            </div>
          </article>
        ) : (
          renderThreadRows()
        )}
      </div>
      {activeImagePreview ? (
        <ImageLightbox
          key={`${activeImagePreview.src}:${activeImagePreview.openedAt}`}
          preview={activeImagePreview}
          onClose={handleCloseImagePreview}
        />
      ) : null}
    </section>
  )
}
