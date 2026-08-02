import { Component, memo, useCallback, useEffect, useEffectEvent, useId, useLayoutEffect, useMemo, useRef, useState, type ComponentType, type ErrorInfo, type FormEvent, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject, type WheelEvent as ReactWheelEvent } from "react"
import { createPortal } from "react-dom"
import { createContext, useContext, useSyncExternalStore, type FocusEvent as ReactFocusEvent } from "react"
import { toLocalImageProtocolUrl } from "../../../../shared/local-image-protocol"
import { CodeBlockPreview } from "../code-highlight"
import {
  DEFAULT_LIGHT_CODE_THEME,
  type CodeHighlightTheme,
} from "../code-theme"
import { DiffPreview } from "../diff/DiffPreview"
import {
  ChangesIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CloseIcon,
  CopyIcon,
  DownloadIcon,
  ErrorStatusIcon,
  ExpandIcon,
  FileImageIcon,
  InfoIcon,
  MinimizeIcon,
  PaperclipIcon,
  PlusIcon,
  ResetIcon,
  SessionRunningIcon,
  ForkIcon,
} from "../icons"
import { joinClassNames, writeTextToClipboard } from "../shared-ui"
import {
  getSessionMessageIDForMessage,
  type SessionMessageBranchOption,
  type SessionMessageTree,
} from "../session-message-tree"
import {
  ThreadMarkdown,
  normalizeMarkdownLinkTarget,
  type MarkdownArtifactLinkTarget,
  type MarkdownLocalFileLinkTarget,
} from "../thread-markdown"
import { openExternalThreadLink, useThreadLinkRouting } from "../thread-link-routing"
import { ThreadHtml } from "../thread-html"
import { parseAssistantResponseFormat, stripStreamingResponseFormatMarker } from "../thread-response-format"
import { ThreadRichText } from "../thread-rich-text"
import { useI18n } from "../i18n/I18nProvider"
import { translateLiteral, type TranslationKey } from "../i18n/translations"
import type {
  AssistantTraceDebugEntry,
  AssistantTraceFileChange,
  AssistantTraceItem,
  AssistantTraceItemKind,
  AssistantTraceSectionKey,
  AssistantTraceVisibility,
  AssistantThreadMessage,
  AssistantThreadMessagePhase,
  ComposerPastedImageAttachment,
  PendingConversationInput,
  PermissionDecision,
  PermissionRequest,
  SessionDiffFile,
  SessionDiffSummary,
  SessionSummary,
  ThreadMessage,
  ThreadTurn,
  UserThreadMessage,
  UserThreadMessageAttachment
} from "../types"
import { formatTime } from "../utils"
import {
  getUserMessageBodyText,
  shouldCollapseUserMessageText,
  traceSectionKeyForItem,
  type ThreadDisplayRow,
} from "./thread-display-rows"
import {
  ThreadRowRenderer,
  type ImagePreviewPayload,
  type PermissionRequestResponseHandler,
  type ProposedPlanConfirmHandler,
  type QuestionAnswerHandler,
  type ThreadMessageMotion,
  type ThreadRowRendererComponents,
  type TraceRowItemRenderInput,
} from "./ThreadRowRenderer"
import { ThreadRows } from "./ThreadRows"
import { ThreadTurnNavigator } from "./ThreadTurnNavigator"
import { CompletedThreadMarkdown } from "./CompletedThreadMarkdown"
import { SizeAwareStreamingMarkdown } from "./SizeAwareStreamingMarkdown"
import {
  getAssistantTraceErrorDiagnosticEntry,
  getAssistantTraceErrorPresentation,
} from "./thread-error-presentation"
import {
  createThreadInteractionStore,
  selectThreadInteractionEntry,
  type ThreadInteractionRowRef,
  type ThreadInteractionStoreApi,
} from "./thread-interaction-store"
import {
  createThreadPresentationStore,
  type ThreadPresentationStoreApi,
} from "./thread-presentation-store"
import { useThreadContentObserver } from "./use-thread-content-observer"
import type { AssistantExecutionSummaryRow, ThreadExecutionGroup } from "./thread-execution-groups"
import { useThreadProjection } from "./use-thread-projection"
import {
  useThreadScrollController,
  type ThreadFollowScrollTarget,
  type ThreadProjectionLayoutTransaction,
  type ThreadScrollSnapshot,
} from "./use-thread-scroll-controller"
import {
  buildThreadTurnNavigationItems,
  findThreadMessageNavigationRowIndex,
  useThreadTurnNavigation,
  type ThreadTurnNavigationItem,
} from "./use-thread-turn-navigation"
import { useThreadVirtualList } from "./use-thread-virtual-list"

export type { ThreadScrollSnapshot } from "./use-thread-scroll-controller"

export interface ThreadNavigationRequest {
  messageID?: string
  paneID?: string
  requestID: number
  turnID?: string
}

const EMPTY_FILE_CHANGES: AssistantTraceFileChange[] = []
const ThreadCodeThemeContext = createContext<CodeHighlightTheme>(DEFAULT_LIGHT_CODE_THEME)

const EXECUTION_STATUS_TRANSLATION_KEYS: Record<ThreadTurn["status"], TranslationKey> = {
  blocked: "thread.execution.blocked",
  cancelled: "thread.execution.cancelled",
  completed: "thread.execution.completed",
  continued_by_user: "thread.execution.continued",
  failed: "thread.execution.failed",
  running: "thread.execution.processing",
  stopped: "thread.execution.stopped",
}

export function formatThreadExecutionDuration(durationMs: number | undefined) {
  if (durationMs === undefined || !Number.isFinite(durationMs) || durationMs < 0) return ""
  if (durationMs < 1_000) return "<1s"

  const totalSeconds = Math.floor(durationMs / 1_000)
  const hours = Math.floor(totalSeconds / 3_600)
  const minutes = Math.floor((totalSeconds % 3_600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}

function AssistantExecutionSummary({
  onToggle,
  row,
}: {
  onToggle: (row: AssistantExecutionSummaryRow) => void
  row: AssistantExecutionSummaryRow
}) {
  const { t } = useI18n()
  const statusLabel = t(EXECUTION_STATUS_TRANSLATION_KEYS[row.status])
  const duration = row.status === "running" ? "" : formatThreadExecutionDuration(row.durationMs)
  const actionLabel = t(row.expanded ? "thread.execution.collapse" : "thread.execution.expand")
  const accessibleName = `${actionLabel}: ${statusLabel}${duration ? ` ${duration}` : ""}`

  return (
    <button
      type="button"
      className="assistant-execution-summary-button"
      aria-expanded={row.expanded}
      aria-label={accessibleName}
      data-thread-execution-group-id={row.groupID}
      onClick={() => onToggle(row)}
    >
      <span className="assistant-execution-summary-copy">
        <span className="assistant-execution-summary-label">{statusLabel}</span>
        {duration ? <span className="assistant-execution-summary-duration">{duration}</span> : null}
      </span>
      <span className="assistant-execution-summary-chevron" aria-hidden="true">
        {row.expanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
      </span>
    </button>
  )
}

function readOwnedThreadVirtualRows(threadColumn: HTMLDivElement) {
  return Array.from(
    threadColumn.querySelectorAll<HTMLElement>("[data-thread-virtual-row-id]"),
  ).filter((element) => element.closest(".thread-column") === threadColumn)
}

function findOwnedThreadVirtualRow(threadColumn: HTMLDivElement, rowID: string) {
  return readOwnedThreadVirtualRows(threadColumn).find(
    (element) => element.dataset.threadVirtualRowId === rowID,
  ) ?? null
}

function readOwnedThreadRowIDForNode(threadColumn: HTMLDivElement, node: Node | null) {
  const element = node instanceof Element ? node : node?.parentElement
  const row = element?.closest<HTMLElement>("[data-thread-virtual-row-id]") ?? null
  if (!row || row.closest(".thread-column") !== threadColumn) return null
  return row.dataset.threadVirtualRowId ?? null
}

function clearSelectionInsideThreadRows(
  threadColumn: HTMLDivElement,
  rowIDs: ReadonlySet<string>,
) {
  const selection = threadColumn.ownerDocument.defaultView?.getSelection()
  if (!selection || selection.rangeCount === 0) return
  const anchorRowID = readOwnedThreadRowIDForNode(threadColumn, selection.anchorNode)
  const focusRowID = readOwnedThreadRowIDForNode(threadColumn, selection.focusNode)
  if (rowIDs.has(anchorRowID ?? "") || rowIDs.has(focusRowID ?? "")) {
    selection.removeAllRanges()
    return
  }

  const removedRows = readOwnedThreadVirtualRows(threadColumn).filter(
    (row) => rowIDs.has(row.dataset.threadVirtualRowId ?? ""),
  )
  for (let rangeIndex = 0; rangeIndex < selection.rangeCount; rangeIndex += 1) {
    const range = selection.getRangeAt(rangeIndex)
    if (removedRows.some((row) => {
      try {
        return range.intersectsNode(row)
      } catch {
        return false
      }
    })) {
      selection.removeAllRanges()
      return
    }
  }
}

function projectThreadScrollSnapshotToExecutionGroups(
  snapshot: ThreadScrollSnapshot,
  groups: readonly ThreadExecutionGroup[],
  rows: readonly ThreadDisplayRow[],
) {
  const anchor = snapshot.anchor
  if (!anchor || rows.some((row) => row.rowID === anchor.rowID)) return snapshot

  const group = groups.find((candidate) => candidate.prefixRowIDs.includes(anchor.rowID))
  if (!group || !rows.some((row) => row.rowID === group.summaryRowID)) return snapshot
  return {
    ...snapshot,
    anchor: {
      ...anchor,
      rowID: group.summaryRowID,
      turnID: group.turnID,
    },
  }
}

type ProposedPlanCardStatus = "idle" | "cancelled" | "confirming" | "confirmed"

export interface ThreadViewProps {
  activeSession: SessionSummary | null
  activeSessionDiff?: SessionDiffSummary | null
  activeMessages: ThreadMessage[]
  activeTurns?: ThreadTurn[]
  assistantTraceVisibility: AssistantTraceVisibility
  codeTheme?: CodeHighlightTheme
  isResolvingPermissionRequest: boolean
  isSessionRunning?: boolean
  messageTree?: SessionMessageTree | null
  onBranchSelect?: (messageID: string) => void | Promise<void>
  onFileChangeSelect?: (file: string) => void
  onForkFromMessage?: (messageID: string) => void | Promise<void>
  onBranchChatFromSelection?: (input: { messageID: string; text: string }) => void | Promise<void>
  onArtifactLinkOpen?: (target: MarkdownArtifactLinkTarget) => void
  onLocalFileLinkOpen?: (target: MarkdownLocalFileLinkTarget) => void
  onMessageDiffSummaryHydrate?: (messageID: string, diffSummary: SessionDiffSummary) => void | Promise<void>
  onMessageDiffRestore?: (diffs: SessionDiffFile[]) => void | Promise<void>
  onMessageDiffReview?: (files: string[]) => void | Promise<void>
  onRetryUserMessage?: (messageID: string) => void | Promise<void>
  pendingConversationInputs?: PendingConversationInput[]
  pendingPermissionRequests: PermissionRequest[]
  permissionRequestActionError: string | null
  permissionRequestActionRequestID: string | null
  onAddToComposer?: (text: string) => void | Promise<void>
  onAddImageToComposer?: (images: ComposerPastedImageAttachment[]) => void | Promise<void>
  addImageToComposerDisabledReason?: string | null
  interactionStore?: ThreadInteractionStoreApi
  presentationStore?: ThreadPresentationStoreApi
  scrollStateKey?: string | null
  threadColumnRef: RefObject<HTMLDivElement | null>
  isThreadVisible?: boolean
  navigationRequest?: ThreadNavigationRequest | null
  virtualMeasurementKey?: string | null
  readScrollSnapshot?: (key: string) => ThreadScrollSnapshot | null
  saveScrollSnapshot?: (key: string, snapshot: ThreadScrollSnapshot) => void
  showTurnNavigator?: boolean
  onAskUserQuestionAnswer: QuestionAnswerHandler
  onProposedPlanConfirm?: ProposedPlanConfirmHandler
  onPermissionRequestResponse: PermissionRequestResponseHandler
}

type ThreadViewActionPropName =
  | "onBranchSelect"
  | "onFileChangeSelect"
  | "onForkFromMessage"
  | "onBranchChatFromSelection"
  | "onArtifactLinkOpen"
  | "onLocalFileLinkOpen"
  | "onMessageDiffSummaryHydrate"
  | "onMessageDiffRestore"
  | "onMessageDiffReview"
  | "onAddToComposer"
  | "onAddImageToComposer"
  | "onAskUserQuestionAnswer"
  | "onProposedPlanConfirm"
  | "onPermissionRequestResponse"

type ThreadViewActionSource = Pick<ThreadViewProps, ThreadViewActionPropName>

interface ThreadViewActions {
  onBranchSelect: NonNullable<ThreadViewProps["onBranchSelect"]>
  onFileChangeSelect: NonNullable<ThreadViewProps["onFileChangeSelect"]>
  onForkFromMessage: NonNullable<ThreadViewProps["onForkFromMessage"]>
  onBranchChatFromSelection: NonNullable<ThreadViewProps["onBranchChatFromSelection"]>
  onArtifactLinkOpen: NonNullable<ThreadViewProps["onArtifactLinkOpen"]>
  onLocalFileLinkOpen: NonNullable<ThreadViewProps["onLocalFileLinkOpen"]>
  onMessageDiffSummaryHydrate: NonNullable<ThreadViewProps["onMessageDiffSummaryHydrate"]>
  onMessageDiffRestore: NonNullable<ThreadViewProps["onMessageDiffRestore"]>
  onMessageDiffReview: NonNullable<ThreadViewProps["onMessageDiffReview"]>
  onAddToComposer: NonNullable<ThreadViewProps["onAddToComposer"]>
  onAddImageToComposer: NonNullable<ThreadViewProps["onAddImageToComposer"]>
  onAskUserQuestionAnswer: QuestionAnswerHandler
  onProposedPlanConfirm: ProposedPlanConfirmHandler
  onPermissionRequestResponse: PermissionRequestResponseHandler
}

interface ThreadViewActionCapabilities {
  canSelectBranch: boolean
  canSelectFileChange: boolean
  canForkFromMessage: boolean
  canBranchChatFromSelection: boolean
  canOpenArtifactLink: boolean
  canOpenLocalFileLink: boolean
  canHydrateMessageDiffSummary: boolean
  canRestoreMessageDiff: boolean
  canReviewMessageDiff: boolean
  canAddToComposer: boolean
  canAddImageToComposer: boolean
  canConfirmProposedPlan: boolean
}

type ThreadViewViewportProps = Omit<ThreadViewProps, ThreadViewActionPropName | "interactionStore" | "presentationStore"> & {
  actions: ThreadViewActions
  actionCapabilities: ThreadViewActionCapabilities
  interactionStore: ThreadInteractionStoreApi
  presentationStore: ThreadPresentationStoreApi
}

function useThreadViewActions(source: ThreadViewActionSource) {
  const committedSourceRef = useRef(source)

  useLayoutEffect(() => {
    committedSourceRef.current = source
  })

  return useMemo<ThreadViewActions>(() => ({
    onBranchSelect(messageID) {
      return committedSourceRef.current.onBranchSelect?.(messageID)
    },
    onFileChangeSelect(file) {
      return committedSourceRef.current.onFileChangeSelect?.(file)
    },
    onForkFromMessage(messageID) {
      return committedSourceRef.current.onForkFromMessage?.(messageID)
    },
    onBranchChatFromSelection(input) {
      return committedSourceRef.current.onBranchChatFromSelection?.(input)
    },
    onArtifactLinkOpen(target) {
      return committedSourceRef.current.onArtifactLinkOpen?.(target)
    },
    onLocalFileLinkOpen(target) {
      return committedSourceRef.current.onLocalFileLinkOpen?.(target)
    },
    onMessageDiffSummaryHydrate(messageID, diffSummary) {
      return committedSourceRef.current.onMessageDiffSummaryHydrate?.(messageID, diffSummary)
    },
    onMessageDiffRestore(diffs) {
      return committedSourceRef.current.onMessageDiffRestore?.(diffs)
    },
    onMessageDiffReview(files) {
      return committedSourceRef.current.onMessageDiffReview?.(files)
    },
    onAddToComposer(text) {
      return committedSourceRef.current.onAddToComposer?.(text)
    },
    onAddImageToComposer(images) {
      return committedSourceRef.current.onAddImageToComposer?.(images)
    },
    onAskUserQuestionAnswer(input) {
      return committedSourceRef.current.onAskUserQuestionAnswer(input)
    },
    onProposedPlanConfirm(input) {
      return committedSourceRef.current.onProposedPlanConfirm?.(input)
    },
    onPermissionRequestResponse(input) {
      return committedSourceRef.current.onPermissionRequestResponse(input)
    },
  }), [])
}

interface ThreadInteractionContextValue {
  scopeID: string
  store: ThreadInteractionStoreApi
}

const ThreadInteractionContext = createContext<ThreadInteractionContextValue | null>(null)

function useThreadInteractionEntry(rowID: string) {
  const context = useContext(ThreadInteractionContext)
  if (!context) {
    throw new Error("Thread interaction state is unavailable outside ThreadView.")
  }

  const { scopeID, store } = context
  const getSnapshot = useCallback(
    () => selectThreadInteractionEntry(store.getState(), scopeID, rowID),
    [rowID, scopeID, store],
  )
  const entry = useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot)

  return { entry, scopeID, store }
}

function useThreadInteractionScopeID() {
  const context = useContext(ThreadInteractionContext)
  if (!context) {
    throw new Error("Thread interaction scope is unavailable outside ThreadView.")
  }

  return context.scopeID
}

const IMAGE_LIGHTBOX_BODY_CLASS = "is-image-lightbox-open"
const IMAGE_LIGHTBOX_FOCUSABLE_SELECTOR = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
const IMAGE_LIGHTBOX_MIN_ZOOM = 0.5
const IMAGE_LIGHTBOX_MAX_ZOOM = 4
const PROPOSED_PLAN_OPEN_TAG = "<proposed_plan>"
const PROPOSED_PLAN_CLOSE_TAG = "</proposed_plan>"
const IMAGE_LIGHTBOX_ZOOM_STEP = 0.1
const USER_MESSAGE_THUMBNAIL_IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp"])
const IMAGE_TALL_RATIO_THRESHOLD = 1.8
const THREAD_STREAMING_RESPONSE_SELECTOR = ".assistant-section.is-response .trace-item.is-streaming[data-kind=\"text\"]"
const THREAD_AUTO_COLLAPSE_MOTION_MS = 240
const TRACE_REASONING_PREVIEW_CHARACTER_LIMIT = 480
const TRACE_PATCH_PREVIEW_CHARACTER_LIMIT = 20000
const TRACE_PATCH_PREVIEW_LINE_LIMIT = 200
const THREAD_COPY_CONTEXT_MENU_WIDTH = 184
const THREAD_TEXT_CONTEXT_MENU_HEIGHT = 82
const THREAD_IMAGE_CONTEXT_MENU_HEIGHT = 116

function buildThreadInteractionRevision(value: string) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `${value.length}:${(hash >>> 0).toString(36)}`
}

interface LatestAssistantMessageState {
  id: string
  isStreaming: boolean
}

interface TraceTextPreview {
  text: string
  isTruncated: boolean
  originalLength: number
}

type PatchPreviewState = "summary" | "preview" | "full"

type ImagePreviewFitMode = "fit-width" | "fit-contain"

type ThreadCopyContextMenuKind = "assistant" | "user" | "selection"

interface ActiveImagePreview extends ImagePreviewPayload {
  openedAt: number
}

interface ThreadTextCopyContextMenuState {
  target: "text"
  kind: ThreadCopyContextMenuKind
  messageID: string | null
  text: string
  x: number
  y: number
}

interface ThreadImageCopyContextMenuState {
  target: "image"
  alt: string
  name: string
  src: string
  x: number
  y: number
}

type ThreadClipboardItemConstructor = new (items: Record<string, Blob>) => ClipboardItem

type ThreadCopyContextMenuState = ThreadTextCopyContextMenuState | ThreadImageCopyContextMenuState

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

function readLatestAssistantMessageState(messages: ThreadMessage[]): LatestAssistantMessageState | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.kind === "assistant") return { id: message.id, isStreaming: Boolean(message.isStreaming) }
  }

  return null
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
    if (!element.closest("[data-thread-row-kind=\"assistant-response-row\"][data-thread-message-id]")) continue

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

function isSidebarResizeInProgress() {
  return typeof document !== "undefined" && document.body.classList.contains("is-resizing-sidebar")
}

function clampThreadCopyContextMenuPosition(x: number, y: number, height = THREAD_TEXT_CONTEXT_MENU_HEIGHT) {
  if (typeof window === "undefined") return { x, y }

  return {
    x: Math.min(Math.max(8, x), Math.max(8, window.innerWidth - THREAD_COPY_CONTEXT_MENU_WIDTH - 8)),
    y: Math.min(Math.max(8, y), Math.max(8, window.innerHeight - height - 8)),
  }
}

function getThreadCopyContextMenuCoordinates(event: ReactMouseEvent<HTMLElement>, height = THREAD_TEXT_CONTEXT_MENU_HEIGHT) {
  if (event.clientX || event.clientY) {
    return clampThreadCopyContextMenuPosition(event.clientX, event.clientY, height)
  }

  const rect = event.currentTarget.getBoundingClientRect()
  return clampThreadCopyContextMenuPosition(rect.left + 12, rect.top + 12, height)
}

function nodeIsInsideElement(node: Node | null, element: HTMLElement) {
  if (!node) return false
  if (node === element) return true
  return element.contains(node)
}

function selectionIntersectsThreadElement(selection: Selection, element: HTMLElement) {
  for (let index = 0; index < selection.rangeCount; index += 1) {
    const range = selection.getRangeAt(index)
    const commonAncestor =
      range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
        ? range.commonAncestorContainer
        : range.commonAncestorContainer.parentNode
    if (nodeIsInsideElement(commonAncestor, element)) return true

    if (typeof range.intersectsNode === "function") {
      try {
        if (range.intersectsNode(element)) return true
      } catch {
        // Detached ranges can be ignored; another range may still intersect the thread.
      }
    }
  }

  return false
}

function readOwnedAssistantResponseMessageID(threadColumn: HTMLDivElement, node: Node | null) {
  const element = node instanceof Element ? node : node?.parentElement
  const row = element?.closest<HTMLElement>(
    '[data-thread-row-kind="assistant-response-row"][data-thread-message-id]',
  ) ?? null
  if (!row || row.closest(".thread-column") !== threadColumn) return null
  return row.dataset.threadMessageId?.trim() || null
}

function readSelectedThreadText(threadColumn: HTMLDivElement) {
  if (typeof window === "undefined") return null

  const selection = window.getSelection()
  const selectedText = selection?.toString().trim() ?? ""
  if (!selection || selection.isCollapsed || !selectedText) return null
  if (!selectionIntersectsThreadElement(selection, threadColumn)) return null

  let messageID: string | null = null
  for (let index = 0; index < selection.rangeCount; index += 1) {
    const range = selection.getRangeAt(index)
    const startMessageID = readOwnedAssistantResponseMessageID(threadColumn, range.startContainer)
    const endMessageID = readOwnedAssistantResponseMessageID(threadColumn, range.endContainer)
    if (!startMessageID || startMessageID !== endMessageID) {
      messageID = null
      break
    }
    if (messageID && messageID !== startMessageID) {
      messageID = null
      break
    }
    messageID = startMessageID
  }

  return { messageID, text: selectedText }
}

function getThreadContextMenuEventPath(event: ReactMouseEvent<HTMLElement>) {
  return typeof event.nativeEvent.composedPath === "function"
    ? event.nativeEvent.composedPath()
    : [event.target]
}

function readThreadImageSourceName(src: string) {
  try {
    const parsed = new URL(src, typeof window === "undefined" ? undefined : window.location.href)
    const source = parsed.searchParams.get("source") || parsed.pathname
    const decodedSource = decodeURIComponent(source)
    return decodedSource.split(/[\\/]/).filter(Boolean).pop()?.trim() || null
  } catch {
    return null
  }
}

function guessImageMimeTypeFromSource(src: string) {
  const dataUrlMatch = /^data:(image\/[a-z0-9.+-]+)[;,]/i.exec(src.trim())
  if (dataUrlMatch) return dataUrlMatch[1].toLowerCase()

  const sourceName = readThreadImageSourceName(src)?.toLowerCase() ?? src.toLowerCase()
  if (sourceName.endsWith(".jpg") || sourceName.endsWith(".jpeg")) return "image/jpeg"
  if (sourceName.endsWith(".png")) return "image/png"
  if (sourceName.endsWith(".gif")) return "image/gif"
  if (sourceName.endsWith(".webp")) return "image/webp"
  if (sourceName.endsWith(".bmp")) return "image/bmp"
  if (sourceName.endsWith(".svg")) return "image/svg+xml"
  return null
}

function normalizeThreadImageMimeType(value: string | null | undefined) {
  const mimeType = value?.trim().toLowerCase()
  return mimeType?.startsWith("image/") ? mimeType : null
}

function buildThreadImageAttachmentName(src: string, alt: string) {
  const sourceName = readThreadImageSourceName(src)
  if (sourceName) return sourceName

  const altText = alt.trim()
  return altText || "thread-image"
}

function readThreadContextMenuImageTarget(
  event: ReactMouseEvent<HTMLElement>,
  threadColumn: HTMLDivElement,
): ThreadImageCopyContextMenuState | null {
  for (const target of getThreadContextMenuEventPath(event)) {
    if (!(target instanceof Element)) continue

    const image = target.closest<HTMLImageElement>("img")
    if (!image || !threadColumn.contains(image)) continue

    const src = (image.currentSrc || image.getAttribute("src") || image.src || "").trim()
    if (!src) continue

    const alt = image.alt.trim() || image.getAttribute("aria-label")?.trim() || "Image"
    const position = getThreadCopyContextMenuCoordinates(event, THREAD_IMAGE_CONTEXT_MENU_HEIGHT)
    return {
      target: "image",
      alt,
      name: buildThreadImageAttachmentName(src, alt),
      src,
      ...position,
    }
  }

  return null
}

function getThreadClipboardItemConstructor() {
  return (globalThis as typeof globalThis & { ClipboardItem?: ThreadClipboardItemConstructor }).ClipboardItem
}

function canWriteThreadImageClipboard() {
  return Boolean(window.desktop?.copyImageToClipboard) ||
    (typeof navigator.clipboard?.write === "function" && typeof getThreadClipboardItemConstructor() === "function")
}

function canSaveThreadImageToFolder() {
  return Boolean(window.desktop?.saveImageToFolder)
}

async function fetchThreadImageBlob(src: string) {
  const response = await fetch(src)
  if (!response.ok) {
    throw new Error(`Image request failed with status ${String(response.status)}.`)
  }

  const blob = await response.blob()
  if (blob.size === 0) {
    throw new Error("Image data is empty.")
  }

  const mimeType = normalizeThreadImageMimeType(blob.type) ?? guessImageMimeTypeFromSource(src) ?? "image/png"
  return blob.type === mimeType ? blob : new Blob([blob], { type: mimeType })
}

function readThreadImageBlobAsDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read image data."))
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("Image data could not be converted to a data URL."))
        return
      }

      resolve(reader.result)
    }
    reader.readAsDataURL(blob)
  })
}

async function writeThreadImageToClipboard(menu: ThreadImageCopyContextMenuState) {
  const blob = await fetchThreadImageBlob(menu.src)
  const mimeType = normalizeThreadImageMimeType(blob.type) ?? "image/png"
  const desktopCopyImageToClipboard = window.desktop?.copyImageToClipboard
  if (desktopCopyImageToClipboard) {
    await desktopCopyImageToClipboard({
      dataUrl: await readThreadImageBlobAsDataUrl(blob),
      mimeType,
    })
    return
  }

  const ClipboardItemConstructor = getThreadClipboardItemConstructor()
  if (typeof navigator.clipboard?.write !== "function" || !ClipboardItemConstructor) {
    throw new Error("Image clipboard writes are not available.")
  }

  await navigator.clipboard.write([
    new ClipboardItemConstructor({
      [blob.type]: blob,
    }),
  ])
}

async function createThreadImageComposerAttachment(menu: ThreadImageCopyContextMenuState): Promise<ComposerPastedImageAttachment> {
  const blob = await fetchThreadImageBlob(menu.src)
  return {
    dataUrl: await readThreadImageBlobAsDataUrl(blob),
    mimeType: normalizeThreadImageMimeType(blob.type) ?? "image/png",
    name: menu.name,
  }
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

function getUserMessageAttachmentExtension(attachment: UserThreadMessageAttachment) {
  const source = attachment.path ?? attachment.name
  return source.trim().toLowerCase().split(".").pop() ?? ""
}

function getUserMessageAttachmentThumbnailUrl(attachment: UserThreadMessageAttachment) {
  if (!attachment.path) return null
  if (!USER_MESSAGE_THUMBNAIL_IMAGE_EXTENSIONS.has(getUserMessageAttachmentExtension(attachment))) return null
  return toLocalImageProtocolUrl(attachment.path)
}

function UserBubbleAttachmentFileChip({ attachment }: { attachment: UserThreadMessageAttachment }) {
  return (
    <div className="user-bubble-chip user-bubble-attachment-chip">
      <PaperclipIcon />
      <span className="user-bubble-chip-label" title={attachment.path ?? attachment.name}>
        {attachment.name}
      </span>
    </div>
  )
}

function UserBubbleAttachmentItem({ attachment }: { attachment: UserThreadMessageAttachment }) {
  const previewUrl = getUserMessageAttachmentThumbnailUrl(attachment)
  const [hasPreviewError, setHasPreviewError] = useState(false)

  useEffect(() => {
    setHasPreviewError(false)
  }, [previewUrl])

  if (!previewUrl || hasPreviewError) {
    return <UserBubbleAttachmentFileChip attachment={attachment} />
  }

  return (
    <div
      className="user-bubble-chip user-bubble-attachment-chip is-image-preview"
      title={attachment.path ?? attachment.name}
    >
      <img
        alt={attachment.name}
        className="user-bubble-attachment-thumbnail"
        decoding="async"
        loading="lazy"
        onError={() => setHasPreviewError(true)}
        src={previewUrl}
      />
    </div>
  )
}

function UserThreadMessageBubble({ message }: { message: UserThreadMessage }) {
  const { t } = useI18n()
  const displayText = message.displayText?.trim() || ""
  const references = message.references ?? []
  const attachments = message.attachments ?? []
  const messageQuotes = message.messageQuotes ?? []
  const hasStructuredContent = Boolean(displayText) || references.length > 0 || attachments.length > 0 || messageQuotes.length > 0
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
        {messageQuotes.length > 0 ? (
          <div className="user-bubble-message-quotes" aria-label={t("branchChat.quote.region")}>
            {messageQuotes.map((quote, index) => (
              <blockquote
                key={`${quote.sourceMessageID}:${index}`}
                className="user-bubble-message-quote"
                data-source-message-id={quote.sourceMessageID}
              >
                <span className="user-bubble-message-quote-label">{t("branchChat.quote.label")}</span>
                <span className="user-bubble-message-quote-text">{quote.text}</span>
              </blockquote>
            ))}
          </div>
        ) : null}
        {displayText || references.length > 0 || messageQuotes.length === 0 ? (
          <CollapsibleUserMessageText references={references} text={bodyText} />
        ) : null}
        {steerNote}

        {attachments.length > 0 ? (
          <div className="user-bubble-chip-strip" aria-label="Sent attachments">
            {attachments.map((attachment, index) => (
              <UserBubbleAttachmentItem
                key={`${attachment.path ?? attachment.name}:${index}`}
                attachment={attachment}
              />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function getUserMessageCopyText(message: UserThreadMessage) {
  const messageQuotes = message.messageQuotes ?? []
  const bodyText = getUserMessageBodyText(message).trim()
  const isQuoteOnlyFallback =
    messageQuotes.length > 0 &&
    !message.displayText?.trim() &&
    (message.references?.length ?? 0) === 0 &&
    bodyText === "Sent a non-text message."

  return [
    ...messageQuotes.map((quote) => quote.text.trim()).filter(Boolean),
    isQuoteOnlyFallback ? "" : bodyText,
  ].filter(Boolean).join("\n\n")
}

const UserThreadMessageArticle = memo(function UserThreadMessageArticle({
  className,
  copied,
  diffCard,
  message,
  motion,
  onCopy,
  onRetry,
  rowKind = "user-message",
}: {
  className?: string
  copied: boolean
  diffCard?: ReactNode
  motion: ThreadMessageMotion
  onCopy: (messageID: string, text: string) => void | Promise<void>
  onRetry?: (messageID: string) => void | Promise<void>
  message: UserThreadMessage
  rowKind?: string
}) {
  const { t } = useI18n()
  const userCopyText = getUserMessageCopyText(message)
  const delivery = message.delivery
  const failureLabel = delivery?.status === "failed"
    ? t(delivery.reason === "cancelled"
      ? "thread.userMessage.cancelled"
      : "thread.userMessage.failed")
    : ""
  const failureTitle = delivery?.status === "failed" && delivery.error
    ? `${failureLabel}: ${delivery.error}`
    : failureLabel

  return (
    <article
      className={joinClassNames("thread-message user-message", className)}
      data-thread-row-kind={rowKind}
      data-thread-message-id={message.id}
      data-thread-message-motion={motion}
    >
      <div className="thread-message-meta">
        <span>You</span>
        <time>{formatTime(message.timestamp)}</time>
      </div>
      <div
        className={joinClassNames(
          "user-message-bubble-row",
          delivery && "has-delivery-status",
        )}
      >
        {delivery?.status === "pending" ? (
          <span
            className="user-message-delivery-status is-pending"
            role="status"
            aria-label={t("thread.userMessage.sending")}
            title={t("thread.userMessage.sending")}
          >
            <SessionRunningIcon />
          </span>
        ) : null}
        {delivery?.status === "failed" ? (
          <span
            className="user-message-delivery-status is-failed"
            role="group"
            aria-label={failureTitle}
            title={failureTitle}
          >
            <span className="user-message-delivery-error" aria-hidden="true">
              <ErrorStatusIcon />
            </span>
            {onRetry ? (
              <button
                className="message-action-icon-button user-message-delivery-retry"
                type="button"
                aria-label={t("thread.userMessage.retry")}
                title={t("thread.userMessage.retry")}
                onClick={() => void onRetry(message.id)}
              >
                <ResetIcon />
              </button>
            ) : null}
          </span>
        ) : null}
        <UserThreadMessageBubble message={message} />
      </div>
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
    })) ?? EMPTY_FILE_CHANGES
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
  if (!assistantMessage) return EMPTY_FILE_CHANGES

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

interface MessageDiffFileRowProps {
  change: AssistantTraceFileChange
  changeIndex: number
  isExpanded: boolean
  isFullHeight: boolean
  messageID: string
  onFileChangeSelect?: (file: string) => void
  onFullHeightToggle: (file: string) => void
  onToggle: (file: string) => void
}

const MessageDiffFileRow = memo(function MessageDiffFileRow({
  change,
  changeIndex,
  isExpanded,
  isFullHeight,
  messageID,
  onFileChangeSelect,
  onFullHeightToggle,
  onToggle,
}: MessageDiffFileRowProps) {
  const hasPatch = Boolean(change.patch?.trim())
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
    <div className="user-message-diff-file-entry">
      {hasPatch ? (
        <button
          type="button"
          className="user-message-diff-file-row"
          aria-label={`${isExpanded ? "收起" : "展开"} ${change.file} 变更`}
          aria-expanded={isExpanded}
          aria-controls={previewID}
          title={change.file}
          onClick={() => onToggle(change.file)}
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
            isFullHeight={isFullHeight}
            onToggleFullHeight={() => onFullHeightToggle(change.file)}
            patch={change.patch}
            viewMode="unified"
          />
        </div>
      ) : null}
    </div>
  )
})

function MessageDiffCard({
  onFileChangeSelect,
  activeSessionDiff,
  allowWorkspaceDiffFallback = false,
  onMessageDiffSummaryHydrate,
  patchSourceFileChanges = EMPTY_FILE_CHANGES,
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
  const normalizedDiffFileChanges = useMemo(
    () => normalizeMessageDiffSummary(diffSummary),
    [diffSummary],
  )
  const fileChangesFromPatchSources = useMemo(
    () => hydrateUserMessageFileChangesFromPatchSources(normalizedDiffFileChanges, patchSourceFileChanges),
    [normalizedDiffFileChanges, patchSourceFileChanges],
  )
  const fileChanges = useMemo(
    () => allowWorkspaceDiffFallback
      ? hydrateUserMessageFileChangesFromWorkspaceDiff(fileChangesFromPatchSources, activeSessionDiff)
      : fileChangesFromPatchSources,
    [activeSessionDiff, allowWorkspaceDiffFallback, fileChangesFromPatchSources],
  )
  const fileChangeSignature = useMemo(
    () => fileChanges.map(buildFileChangeSignature).join("\u0001"),
    [fileChanges],
  )
  const interactionRowID = `message-diff:${messageID}`
  const interactionRevision = useMemo(
    () => buildThreadInteractionRevision(fileChangeSignature),
    [fileChangeSignature],
  )
  const { entry, scopeID, store } = useThreadInteractionEntry(interactionRowID)
  const isRestoring = entry?.operation.status === "submitting" || entry?.operation.status === "submitted"
  const isRestoreSubmitted = entry?.operation.status === "submitted"
  const restoreErrorMessage = entry?.operation.status === "failed" ? entry.operation.error : null
  const [isListExpanded, setIsListExpanded] = useState(false)
  const [expandedFile, setExpandedFile] = useState<string | null>(null)
  const [fullHeightFile, setFullHeightFile] = useState<string | null>(null)
  const [actionErrorMessage, setActionErrorMessage] = useState<string | null>(null)
  const hydratedDiffSummary = useMemo(
    () => buildHydratedUserMessageDiffSummary(diffSummary, fileChanges),
    [diffSummary, fileChanges],
  )
  const hydratedDiffSummarySignature = useMemo(
    () => buildDiffSummarySignature(hydratedDiffSummary),
    [hydratedDiffSummary],
  )
  const stats = useMemo(
    () => summarizeUserMessageDiffStats(diffSummary, fileChanges),
    [diffSummary, fileChanges],
  )
  const filePaths = useMemo(
    () => fileChanges.map((change) => change.file),
    [fileChanges],
  )
  const handleListToggle = useCallback(() => {
    const nextIsListExpanded = !isListExpanded
    setIsListExpanded(nextIsListExpanded)
    if (!nextIsListExpanded) {
      setExpandedFile(null)
      setFullHeightFile(null)
    }
  }, [isListExpanded])

  const handleFileToggle = useCallback((file: string) => {
    setExpandedFile((current) => current === file ? null : file)
  }, [])

  const handleFullHeightToggle = useCallback((file: string) => {
    setFullHeightFile((current) => current === file ? null : file)
  }, [])

  useEffect(() => {
    store.getState().ensureRevision(scopeID, interactionRowID, interactionRevision)
  }, [interactionRevision, interactionRowID, scopeID, store])

  useEffect(() => {
    setIsListExpanded(false)
    setExpandedFile(null)
    setFullHeightFile(null)
    setActionErrorMessage(null)
  }, [fileChangeSignature, messageID])

  useEffect(() => {
    if (!hydratedDiffSummary) return
    void onMessageDiffSummaryHydrate?.(messageID, hydratedDiffSummary)
  }, [hydratedDiffSummarySignature, onMessageDiffSummaryHydrate, messageID])

  if (fileChanges.length === 0) return null

  const listID = `user-message-diff-list-${messageID}`
  const summaryLabel = formatUserMessageDiffSummaryLabel(stats.files)

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

    const operationToken = store.getState().beginOperation(scopeID, interactionRowID)
    if (!operationToken) return

    setActionErrorMessage(null)
    try {
      await onMessageDiffRestore(fileChanges)
      store.getState().completeOperation(scopeID, interactionRowID, operationToken)
    } catch (error) {
      store.getState().failOperation(
        scopeID,
        interactionRowID,
        operationToken,
        error instanceof Error ? error.message : String(error),
      )
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
            <span>{isRestoreSubmitted ? "已撤销" : isRestoring ? "撤销中" : "撤销"}</span>
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
          {fileChanges.map((change, changeIndex) => (
            <MessageDiffFileRow
              key={`${messageID}-${change.file}-${changeIndex}`}
              change={change}
              changeIndex={changeIndex}
              isExpanded={expandedFile === change.file}
              isFullHeight={fullHeightFile === change.file}
              messageID={messageID}
              onFileChangeSelect={onFileChangeSelect}
              onFullHeightToggle={handleFullHeightToggle}
              onToggle={handleFileToggle}
            />
          ))}
        </div>
      ) : null}
      {restoreErrorMessage || actionErrorMessage ? (
        <p className="user-message-diff-error" role="alert">{restoreErrorMessage ?? actionErrorMessage}</p>
      ) : null}
    </div>
  )
}

const primaryPermissionDecisions: PermissionDecision[] = [
  "deny",
  "allow-once",
  "allow-session",
  "allow",
]

type PermissionRequestDetailKey = "rationale" | "workdir" | "command" | "paths" | "body"
type PermissionTextLocale = Parameters<typeof translateLiteral>[0]

const permissionRiskTranslationKeys = {
  low: "thread.permission.risk.low",
  medium: "thread.permission.risk.medium",
  high: "thread.permission.risk.high",
  critical: "thread.permission.risk.critical",
} satisfies Record<PermissionRequest["prompt"]["risk"], TranslationKey>

const permissionDecisionTranslationKeys = {
  allow: "thread.permission.action.allow",
  "allow-once": "thread.permission.action.allowOnce",
  "allow-session": "thread.permission.action.allowSession",
  deny: "thread.permission.action.deny",
} satisfies Record<PermissionDecision, TranslationKey>

const permissionDetailLabelTranslationKeys = {
  rationale: "thread.permission.detail.rationale",
  workdir: "thread.permission.detail.workdir",
  command: "thread.permission.detail.command",
  paths: "thread.permission.detail.paths",
  body: "thread.permission.detail.body",
} satisfies Record<PermissionRequestDetailKey, TranslationKey>

function getAllowedPermissionDecisions(request: PermissionRequest) {
  const allowedDecisions = request.prompt.allowedDecisions.length > 0
    ? request.prompt.allowedDecisions
    : primaryPermissionDecisions
  const orderedDecisions = primaryPermissionDecisions.filter((decision) => allowedDecisions.includes(decision))
  return orderedDecisions.length > 0 ? orderedDecisions : primaryPermissionDecisions
}

function formatPermissionRiskLabel(risk: PermissionRequest["prompt"]["risk"], translate: (key: TranslationKey) => string) {
  return translate(permissionRiskTranslationKeys[risk])
}

function formatPermissionDecisionLabel(
  decision: PermissionDecision,
  translate: (key: TranslationKey) => string,
) {
  return translate(permissionDecisionTranslationKeys[decision])
}

function translatePermissionText(locale: PermissionTextLocale, value?: string | null) {
  const trimmed = value?.trim()
  return trimmed ? translateLiteral(locale, trimmed) : ""
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

function getReasoningLiveText(item: AssistantTraceItem, fallbackLine: string) {
  const text = item.text ?? ""
  const detail = item.detail ?? ""

  if (text && detail) return `${text}\n${detail}`
  return text || detail || fallbackLine
}

function normalizeTraceLogText(value?: string | null) {
  return firstNonEmptyLine(value ?? undefined)?.replace(/\s+/g, " ").trim() ?? null
}

function getToolTraceName(item: AssistantTraceItem) {
  return normalizeTraceLogText(item.toolName) ?? "Tool"
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
  if (item.kind === "tool") return getToolTraceName(item)
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

function getAssistantTraceBlockStackClassName(sectionKey: AssistantTraceSectionKey) {
  if (sectionKey === "response") return "assistant-response-stack"
  if (sectionKey === "file-change") return "assistant-file-change-stack"
  if (sectionKey === "tools" || sectionKey === "workflow") return "trace-log-list"
  return "assistant-section-list"
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

function AssistantMessagePlaceholder({ message }: { message: string }) {
  return (
    <section className="assistant-section assistant-ephemeral-state" aria-live="polite" aria-label="Assistant status">
      <p className="assistant-ephemeral-hint">{message}</p>
    </section>
  )
}

const GENERIC_IMAGE_TRACE_TITLES = new Set(["attachment", "image", "image attachment", "thread-image", "图像", "附件"])

function isImageMimeTypeText(value: string) {
  return /^image\/[a-z0-9.+-]+$/i.test(value.trim())
}

function getMeaningfulImageTraceTitle(item: AssistantTraceItem) {
  const title = item.title?.trim()
  if (!title) return null

  const normalizedTitle = title.replace(/\s+/g, " ")
  const normalizedTitleLower = normalizedTitle.toLowerCase()
  const normalizedMimeType = item.mimeType?.trim().toLowerCase()

  if (GENERIC_IMAGE_TRACE_TITLES.has(normalizedTitleLower)) return null
  if (isImageMimeTypeText(normalizedTitle)) return null
  if (normalizedMimeType && normalizedTitleLower === normalizedMimeType) return null

  return normalizedTitle
}

function getVisibleImageTraceStatus(status: AssistantTraceItem["status"]) {
  if (!status || status === "completed") return null
  return status
}

function hasImageDimensions(item: AssistantTraceItem) {
  return (
    typeof item.width === "number" &&
    Number.isFinite(item.width) &&
    item.width > 0 &&
    typeof item.height === "number" &&
    Number.isFinite(item.height) &&
    item.height > 0
  )
}

function getImageTraceMetaText(item: AssistantTraceItem) {
  const mimeType = item.mimeType?.trim()
  const sizeText = hasImageDimensions(item) ? `${item.width} x ${item.height}` : ""
  return [mimeType, sizeText].filter(Boolean).join(" · ")
}

function isRedundantImageTraceBodyText(item: AssistantTraceItem, value: string | undefined) {
  const text = value?.trim()
  if (!text) return false

  const normalizedText = text.replace(/\s+/g, " ")
  const normalizedTextLower = normalizedText.toLowerCase()
  const normalizedMimeType = item.mimeType?.trim().toLowerCase()
  const normalizedMetaText = getImageTraceMetaText(item).toLowerCase()

  return (
    GENERIC_IMAGE_TRACE_TITLES.has(normalizedTextLower) ||
    isImageMimeTypeText(normalizedText) ||
    Boolean(normalizedMimeType && normalizedTextLower === normalizedMimeType) ||
    Boolean(normalizedMetaText && normalizedTextLower === normalizedMetaText)
  )
}

function ImageTraceItemHeader({ item }: { item: AssistantTraceItem }) {
  const title = getMeaningfulImageTraceTitle(item)
  const visibleStatus = getVisibleImageTraceStatus(item.status)

  return (
    <div className="trace-item-header trace-image-header">
      <span className="trace-item-label">{item.label || "Image"}</span>
      {title ? <strong className="trace-item-title">{title}</strong> : null}
      {visibleStatus ? <span className={`trace-item-status is-${visibleStatus}`}>{visibleStatus}</span> : null}
    </div>
  )
}

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
  const thumbnailStyle = hasImageDimensions(item) ? { aspectRatio: `${item.width} / ${item.height}` } : undefined
  const metaText = getImageTraceMetaText(item)

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
  interactionRowID,
  planMarkdown,
  rawPlanMarkdown,
  isComplete,
  isLatestMessage,
  onConfirm,
}: {
  interactionRowID: string
  planMarkdown: string
  rawPlanMarkdown: string
  isComplete: boolean
  isLatestMessage: boolean
  onConfirm?: ProposedPlanConfirmHandler
}) {
  const { entry, scopeID, store } = useThreadInteractionEntry(interactionRowID)
  const interactionRevision = useMemo(
    () => buildThreadInteractionRevision(rawPlanMarkdown),
    [rawPlanMarkdown],
  )
  useEffect(() => {
    store.getState().ensureRevision(scopeID, interactionRowID, interactionRevision)
  }, [interactionRevision, interactionRowID, scopeID, store])
  const status: ProposedPlanCardStatus = entry?.planCancelled
    ? "cancelled"
    : entry?.operation.status === "submitting"
      ? "confirming"
      : entry?.operation.status === "submitted"
        ? "confirmed"
        : "idle"
  const errorMessage = entry?.operation.status === "failed" ? entry.operation.error : null
  const stateText = getProposedPlanStateText(status)
  const showActions = isLatestMessage && status === "idle"
  const showState = isLatestMessage && Boolean(stateText)
  const isActionDisabled = !isComplete || status !== "idle"

  async function handleConfirm() {
    if (!isComplete || !onConfirm || status !== "idle") return

    const operationToken = store.getState().beginOperation(scopeID, interactionRowID)
    if (!operationToken) return

    try {
      await onConfirm({ planMarkdown: rawPlanMarkdown })
      store.getState().completeOperation(scopeID, interactionRowID, operationToken)
    } catch (error) {
      store.getState().failOperation(
        scopeID,
        interactionRowID,
        operationToken,
        error instanceof Error ? error.message : String(error),
      )
    }
  }

  function handleCancel() {
    store.getState().setPlanCancelled(scopeID, interactionRowID, true)
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
              onClick={handleCancel}
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
  interactionRowID?: string
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
  suppressReasoningMessageCompletionCollapse?: boolean
  traceVisibility: AssistantTraceVisibility
}

type RequiredTraceItemRendererProps = Required<
  Pick<
    TraceItemViewProps,
    "isQuestionAnswerDisabled" | "isLatestMessage" | "shouldCollapseAfterMessageCompletion" | "suppressReasoningMessageCompletionCollapse"
  >
>

type TraceItemRendererProps = RequiredTraceItemRendererProps &
  Pick<
    TraceItemViewProps,
    | "assistantMessagePhase"
    | "interactionRowID"
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
          <span className="trace-item-debug-value" data-i18n-skip>{entry.value}</span>
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
  documentID,
  onArtifactLinkOpen,
  onLocalFileLinkOpen,
  text,
}: {
  className: string
  documentID: string
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
    <CompletedThreadMarkdown
      className={joinClassNames(className, "thread-markdown")}
      documentID={documentID}
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
    <SizeAwareStreamingMarkdown
      className={joinClassNames(className, "thread-markdown")}
      isStreaming
      text={markdownText}
      onArtifactLinkOpen={onArtifactLinkOpen}
      onLocalFileLinkOpen={onLocalFileLinkOpen}
    />
  )
}

function ResponseText({
  className,
  documentID,
  isStreaming,
  onArtifactLinkOpen,
  onLocalFileLinkOpen,
  text,
}: {
  className: string
  documentID: string
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
      documentID={documentID}
      text={text}
      onArtifactLinkOpen={onArtifactLinkOpen}
      onLocalFileLinkOpen={onLocalFileLinkOpen}
    />
  )
}

function TraceItemTextBody({
  interactionRowID,
  isResponseItem,
  item,
  onArtifactLinkOpen,
  onLocalFileLinkOpen,
}: {
  interactionRowID: string
  isResponseItem: boolean
  item: AssistantTraceItem
  onArtifactLinkOpen?: (target: MarkdownArtifactLinkTarget) => void
  onLocalFileLinkOpen?: (target: MarkdownLocalFileLinkTarget) => void
}) {
  const interactionScopeID = useThreadInteractionScopeID()

  return (
    <>
      {item.text ? (
        isResponseItem ? (
          <ResponseText
            className="trace-item-text"
            documentID={`${interactionScopeID}\u0000${interactionRowID}\u0000${item.id}\u0000text`}
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
            documentID={`${interactionScopeID}\u0000${interactionRowID}\u0000${item.id}\u0000detail`}
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

interface PatchFileChangeSummaryButtonProps {
  isExpanded: boolean
  label: string
  listID: string
  onToggle: () => void
  reserveLiveDot?: boolean
  showLiveDot?: boolean
}

const PatchFileChangeSummaryButton = memo(function PatchFileChangeSummaryButton({
  isExpanded,
  label,
  listID,
  onToggle,
  reserveLiveDot = false,
  showLiveDot = false,
}: PatchFileChangeSummaryButtonProps) {
  return (
    <button
      type="button"
      className="trace-file-change-summary"
      aria-expanded={isExpanded}
      aria-controls={listID}
      onClick={onToggle}
    >
      <span className="trace-file-change-summary-icon" aria-hidden="true">
        <ChangesIcon />
      </span>
      <span className="trace-file-change-summary-label">{label}</span>
      {reserveLiveDot ? (
        <span
          className={joinClassNames(
            "trace-file-change-live-dot",
            showLiveDot ? undefined : "is-hidden",
          )}
          aria-label="正在更新"
          aria-hidden={showLiveDot ? undefined : true}
        />
      ) : null}
      <span className="trace-file-change-summary-chevron" aria-hidden="true">
        {isExpanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
      </span>
    </button>
  )
})

function GenericTraceItemView({
  className,
  debugEntries,
  interactionRowID,
  isResponseItem,
  item,
  onFileChangeSelect,
  onArtifactLinkOpen,
  onLocalFileLinkOpen,
  showFileActions = false,
  statusText,
}: TraceItemRendererProps & {
  showFileActions?: boolean
  statusText?: string | null
}) {
  const resolvedInteractionRowID = interactionRowID ?? item.id
  const selectableFilePaths = showFileActions ? item.filePaths?.filter(Boolean) ?? [] : []

  return (
    <article className={className} data-kind={item.kind} data-trace-item-id={item.id}>
      <TraceItemHeader item={item} statusText={statusText} />
      <TraceItemTextBody
        interactionRowID={resolvedInteractionRowID}
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
  const fileChangeSignature = useMemo(
    () => fileChanges
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
      .join("\u0001"),
    [fileChanges],
  )
  const fileChangeIdentitySignature = useMemo(
    () => fileChanges
      .map((change) => [change.file, change.fromFile ?? "", change.operation ?? ""].join("\u0000"))
      .join("\u0001"),
    [fileChanges],
  )
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
  const primaryFileChange = useMemo(
    () => getPrimaryPatchFileChange(fileChanges),
    [fileChanges],
  )
  const editedFileSummary = useMemo(
    () => `已编辑 ${fileChanges.length} 个文件`,
    [fileChanges.length],
  )
  const draftPatchPhase = getDraftPatchActionPhase(draftPatchStatus, isStreaming)
  const draftFileSummary = useMemo(
    () => getDraftPatchSummaryLabel(fileChanges, draftPatchPhase),
    [draftPatchPhase, fileChanges],
  )
  const summaryLabel = isDraftPatch && primaryFileChange ? draftFileSummary : editedFileSummary
  const reservesLiveDot = isDraftPatch && Boolean(primaryFileChange)
  const handleSummaryToggle = useCallback(() => {
    const nextIsListExpanded = !isListExpanded
    setIsListExpanded(nextIsListExpanded)
    if (!nextIsListExpanded) {
      setExpandedFile(null)
      setFullHeightFile(null)
      setFullPatchFile(null)
    }
  }, [isListExpanded])

  return (
    <>
      <PatchFileChangeSummaryButton
        isExpanded={isListExpanded}
        label={summaryLabel}
        listID={listID}
        onToggle={handleSummaryToggle}
        reserveLiveDot={reservesLiveDot}
        showLiveDot={reservesLiveDot && isStreaming}
      />
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

function ErrorTraceItemView({
  debugEntries,
  item,
  traceVisibility,
  ...props
}: TraceItemRendererProps) {
  const { t } = useI18n()
  const presentation = getAssistantTraceErrorPresentation(item, t)
  const renderedItem: AssistantTraceItem = {
    ...item,
    label: presentation.label,
    title: presentation.title,
    text: undefined,
    detail: presentation.detail,
  }
  const renderedDebugEntries = traceVisibility.debugMetadata
    ? [getAssistantTraceErrorDiagnosticEntry(item, t), ...debugEntries]
    : debugEntries

  return (
    <GenericTraceItemView
      {...props}
      debugEntries={renderedDebugEntries}
      item={renderedItem}
      statusText={presentation.status}
      traceVisibility={traceVisibility}
    />
  )
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

  const text = isRedundantImageTraceBodyText(item, item.text) ? null : item.text
  const detail = isRedundantImageTraceBodyText(item, item.detail) ? null : item.detail

  return (
    <article className={className} data-kind={item.kind}>
      <ImageTraceItemHeader item={item} />
      <TraceImagePreview item={item} onOpenImagePreview={onOpenImagePreview} />
      {text ? <ThreadRichText className="trace-item-text" text={text} /> : null}
      {detail ? <ThreadRichText className="trace-item-detail" text={detail} /> : null}
      <TraceItemDebugEntries debugEntries={debugEntries} itemID={item.id} />
    </article>
  )
}

function ReasoningLiveLine({ text }: { text: string }) {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)

  const followLatestVisualLine = useCallback(() => {
    const viewport = viewportRef.current
    if (!viewport) return

    const nextScrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight)

    if (viewport.scrollTop !== nextScrollTop) {
      viewport.scrollTop = nextScrollTop
    }
  }, [])

  useLayoutEffect(() => {
    followLatestVisualLine()
  }, [followLatestVisualLine, text])

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    const content = contentRef.current
    if (!viewport || typeof ResizeObserver === "undefined") return

    const resizeObserver = new ResizeObserver(followLatestVisualLine)
    resizeObserver.observe(viewport)
    if (content) resizeObserver.observe(content)

    return () => {
      resizeObserver.disconnect()
    }
  }, [followLatestVisualLine])

  return (
    <div
      ref={viewportRef}
      className="trace-item-reasoning-live-viewport"
      data-reasoning-live-viewport="true"
    >
      <div
        ref={contentRef}
        className="trace-item-reasoning-live-content-shell"
      >
        <ThreadRichText
          as="div"
          className="trace-item-text trace-item-plain-text trace-item-reasoning-live-content"
          text={text}
        />
      </div>
    </div>
  )
}

type ReasoningDisclosurePreference = "auto" | "expanded" | "collapsed"

function ReasoningTraceItemView({
  className,
  debugEntries,
  item,
  shouldCollapseAfterMessageCompletion,
  suppressReasoningMessageCompletionCollapse,
}: TraceItemRendererProps) {
  const shouldCollapseTraceItem = shouldCollapseReasoningTraceItem(item, shouldCollapseAfterMessageCompletion)
  const [isExpanded, setIsExpanded] = useState(() => !item.isStreaming && !shouldCollapseTraceItem)
  const [isCollapsing, setIsCollapsing] = useState(false)
  const [disclosurePreference, setDisclosurePreference] = useState<{
    itemID: string
    value: ReasoningDisclosurePreference
  }>(() => ({
    itemID: item.id,
    value: "auto",
  }))
  const collapseTimerRef = useRef<number | null>(null)
  const contentID = `trace-item-reasoning-${item.id}`
  const reasoningLabel = item.title || item.label || "Reasoning"
  const currentDisclosurePreference =
    disclosurePreference.itemID === item.id ? disclosurePreference.value : "auto"
  const isLiveCompact = Boolean(item.isStreaming) && !isExpanded && !isCollapsing
  const shouldRenderFullReasoningContent = isExpanded || isCollapsing
  const reasoningPreview = useMemo(
    () => getReasoningDisclosurePreview(item, reasoningLabel),
    [item.detail, item.text, reasoningLabel],
  )
  const reasoningLiveText = useMemo(
    () => getReasoningLiveText(item, reasoningLabel),
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

    if (currentDisclosurePreference === "expanded") {
      setIsCollapsing(false)
      setIsExpanded(true)
      return
    }

    if (currentDisclosurePreference === "collapsed") {
      setIsCollapsing(false)
      setIsExpanded(false)
      return
    }

    if (item.isStreaming) {
      setIsCollapsing(false)
      setIsExpanded(false)
      return
    }

    if (
      suppressReasoningMessageCompletionCollapse &&
      isExpanded
    ) {
      setIsCollapsing(false)
      return
    }

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
  }, [
    currentDisclosurePreference,
    item.id,
    item.isStreaming,
    shouldCollapseTraceItem,
    suppressReasoningMessageCompletionCollapse,
  ])

  useEffect(() => clearReasoningCollapseTimer, [])

  function handleReasoningToggle(event?: { target: EventTarget | null }) {
    if (event?.target instanceof Element && event.target.closest("a[href]")) return
    clearReasoningCollapseTimer()
    setIsCollapsing(false)
    const nextIsExpanded = !isExpanded
    setDisclosurePreference({
      itemID: item.id,
      value: nextIsExpanded ? "expanded" : "collapsed",
    })
    setIsExpanded(nextIsExpanded)
  }

  function handleReasoningKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Enter" && event.key !== " ") return
    event.preventDefault()
    handleReasoningToggle()
  }

  return (
    <article
      className={joinClassNames(
        className,
        isExpanded ? "is-expanded" : "is-collapsed",
        isCollapsing && "is-collapsing",
        isLiveCompact && "is-live-compact",
      )}
      data-kind={item.kind}
      data-reasoning-display-mode={
        isLiveCompact ? "live-compact" : isExpanded ? "expanded" : "completed-collapsed"
      }
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
        {isLiveCompact ? (
          <ReasoningLiveLine text={reasoningLiveText} />
        ) : (
          <ThreadRichText
            as="div"
            className={reasoningSummaryClassName}
            text={reasoningContent?.firstLine ?? reasoningPreview.text}
          />
        )}
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
  interactionRowID = item.id,
  onAskUserQuestionAnswer,
  ...props
}: TraceItemRendererProps) {
  const { t } = useI18n()
  const { entry, scopeID, store } = useThreadInteractionEntry(interactionRowID)
  const freeformAnswer = entry?.question.draft ?? ""
  const selectedQuestionOptions = entry?.question.selectedOptions ?? []
  const operationStatus = entry?.operation.status ?? "idle"
  const isSubmittingQuestionAnswer = operationStatus === "submitting" || operationStatus === "submitted"
  const questionAnswerError = operationStatus === "failed" ? entry?.operation.error ?? null : null
  const prompt = item.questionPrompt
  const interactionRevision = useMemo(() => buildThreadInteractionRevision(
    prompt
      ? [
          prompt.questionID,
          prompt.question,
          prompt.header ?? "",
          prompt.placeholder ?? "",
          String(prompt.multiple),
          String(prompt.allowFreeform),
          ...prompt.options.flatMap((option) => [option.value, option.label, option.description ?? ""]),
        ].join("\u0001")
      : item.id,
  ), [item.id, prompt])

  useEffect(() => {
    store.getState().ensureRevision(scopeID, interactionRowID, interactionRevision)
  }, [interactionRevision, interactionRowID, scopeID, store])

  useEffect(() => {
    if (!isQuestionAnswered) return
    store.getState().clearRow(scopeID, interactionRowID)
  }, [interactionRowID, isQuestionAnswered, scopeID, store])

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
    if (operationStatus === "failed") {
      store.getState().resetOperation(scopeID, interactionRowID)
    }
    store.getState().setQuestionSelectedOptions(
      scopeID,
      interactionRowID,
      selectedQuestionOptions.includes(optionValue)
        ? selectedQuestionOptions.filter((value) => value !== optionValue)
        : [...selectedQuestionOptions, optionValue],
    )
  }

  function handleQuestionDraftChange(draft: string) {
    if (operationStatus === "failed") {
      store.getState().resetOperation(scopeID, interactionRowID)
    }
    store.getState().setQuestionDraft(scopeID, interactionRowID, draft)
  }

  async function submitQuestionAnswer(input: {
    text: string
    selectedOptions?: string[]
    freeformText?: string
  }) {
    if (!onAskUserQuestionAnswer || isAnswerDisabled || !questionID) return

    const operationToken = store.getState().beginOperation(scopeID, interactionRowID)
    if (!operationToken) return

    try {
      await onAskUserQuestionAnswer({
        text: input.text,
        questionID,
        ...(input.selectedOptions && input.selectedOptions.length > 0 ? { selectedOptions: input.selectedOptions } : {}),
        ...(input.freeformText ? { freeformText: input.freeformText } : {}),
      })
      store.getState().completeOperation(scopeID, interactionRowID, operationToken)
    } catch (error) {
      store.getState().failOperation(
        scopeID,
        interactionRowID,
        operationToken,
        error instanceof Error ? error.message : String(error),
      )
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
                  onChange={(event) => handleQuestionDraftChange(event.target.value)}
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

        {questionAnswerError ? (
          <p className="ask-user-question-error" role="alert">{questionAnswerError}</p>
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
type ToolTraceIoPaneKind = "input" | "output"

const TOOL_TRACE_JSON_STRING_PARSE_MAX_DEPTH = 6

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

function joinToolTracePaneText(text: string | undefined, detail: string | undefined) {
  return [text, detail].filter((value): value is string => Boolean(value)).join("\n\n")
}

function parseToolTraceJsonObject(text: string) {
  const trimmedText = text.trim()
  if (!trimmedText || (!trimmedText.startsWith("{") && !trimmedText.startsWith("["))) return null

  try {
    const parsed = JSON.parse(text) as unknown
    return parsed && typeof parsed === "object" ? parsed : null
  } catch {
    return null
  }
}

interface FormattedToolTraceJson {
  containsEmbeddedJson: boolean
  containsMultilineString: boolean
  lines: string[]
}

function appendToolTraceJsonComma(lines: string[]) {
  if (lines.length === 0) return lines
  return lines.map((line, index) => index === lines.length - 1 ? `${line},` : line)
}

function formatToolTraceJsonValue(
  value: unknown,
  indentationLevel = 0,
  embeddedJsonDepth = 0,
): FormattedToolTraceJson {
  const indentation = "  ".repeat(indentationLevel)
  const childIndentation = "  ".repeat(indentationLevel + 1)

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return {
        containsEmbeddedJson: false,
        containsMultilineString: false,
        lines: ["[]"],
      }
    }

    let containsEmbeddedJson = false
    let containsMultilineString = false
    const lines = ["["]

    value.forEach((item, index) => {
      const formattedItem = formatToolTraceJsonValue(item, indentationLevel + 1, embeddedJsonDepth)
      containsEmbeddedJson ||= formattedItem.containsEmbeddedJson
      containsMultilineString ||= formattedItem.containsMultilineString
      const itemLines = [
        `${childIndentation}${formattedItem.lines[0]}`,
        ...formattedItem.lines.slice(1),
      ]
      lines.push(...(index < value.length - 1 ? appendToolTraceJsonComma(itemLines) : itemLines))
    })
    lines.push(`${indentation}]`)

    return {
      containsEmbeddedJson,
      containsMultilineString,
      lines,
    }
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value)
    if (entries.length === 0) {
      return {
        containsEmbeddedJson: false,
        containsMultilineString: false,
        lines: ["{}"],
      }
    }

    let containsEmbeddedJson = false
    let containsMultilineString = false
    const lines = ["{"]

    entries.forEach(([key, nestedValue], index) => {
      const formattedValue = formatToolTraceJsonValue(nestedValue, indentationLevel + 1, embeddedJsonDepth)
      containsEmbeddedJson ||= formattedValue.containsEmbeddedJson
      containsMultilineString ||= formattedValue.containsMultilineString
      const propertyLines = [
        `${childIndentation}${JSON.stringify(key)}: ${formattedValue.lines[0]}`,
        ...formattedValue.lines.slice(1),
      ]
      lines.push(...(index < entries.length - 1 ? appendToolTraceJsonComma(propertyLines) : propertyLines))
    })
    lines.push(`${indentation}}`)

    return {
      containsEmbeddedJson,
      containsMultilineString,
      lines,
    }
  }

  if (typeof value !== "string") {
    return {
      containsEmbeddedJson: false,
      containsMultilineString: false,
      lines: [JSON.stringify(value) ?? "null"],
    }
  }

  const embeddedJson = embeddedJsonDepth < TOOL_TRACE_JSON_STRING_PARSE_MAX_DEPTH
    ? parseToolTraceJsonObject(value)
    : null
  if (embeddedJson) {
    const formattedEmbeddedJson = formatToolTraceJsonValue(
      embeddedJson,
      indentationLevel + 1,
      embeddedJsonDepth + 1,
    )
    return {
      containsEmbeddedJson: true,
      containsMultilineString: formattedEmbeddedJson.containsMultilineString,
      lines: [
        'json"""',
        `${childIndentation}${formattedEmbeddedJson.lines[0]}`,
        ...formattedEmbeddedJson.lines.slice(1),
        `${indentation}"""`,
      ],
    }
  }

  if (value.includes("\n") || value.includes("\r")) {
    const normalizedLines = value.replace(/\r\n?/g, "\n").split("\n")
    return {
      containsEmbeddedJson: false,
      containsMultilineString: true,
      lines: [
        '"""',
        ...normalizedLines.map((line) => `${childIndentation}${line}`),
        `${indentation}"""`,
      ],
    }
  }

  return {
    containsEmbeddedJson: false,
    containsMultilineString: false,
    lines: [JSON.stringify(value)],
  }
}

function formatToolTraceJson(text: string) {
  const parsedJson = parseToolTraceJsonObject(text)
  if (!parsedJson) return null

  const formattedJson = formatToolTraceJsonValue(parsedJson)
  return {
    containsEmbeddedJson: formattedJson.containsEmbeddedJson,
    containsMultilineString: formattedJson.containsMultilineString,
    text: formattedJson.lines.join("\n"),
  }
}

function parseExecToolInputCode(text: string | undefined) {
  if (!text) return null

  try {
    const parsed = JSON.parse(text) as unknown
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null

    const input = parsed as Record<string, unknown>
    const inputKeys = Object.keys(input)
    if (inputKeys.length !== 1 || inputKeys[0] !== "code") return null

    const code = input.code
    return typeof code === "string" && code.trim().length > 0 ? code : null
  } catch {
    return null
  }
}

function ExecToolInputCode({ code }: { code: string }) {
  const codeTheme = useContext(ThreadCodeThemeContext)

  return (
    <div className="trace-tool-exec-input">
      <div className="trace-tool-exec-language">JavaScript · async body</div>
      <CodeBlockPreview
        className="trace-tool-exec-code"
        content={code}
        language="javascript"
        theme={codeTheme}
      />
    </div>
  )
}

function ToolTraceIoPane({
  content,
  contentLabel,
  detail,
  id,
  kind,
  summaryTitle,
  text,
}: {
  content?: ReactNode
  contentLabel: string
  detail?: string
  id: string
  kind: ToolTraceIoPaneKind
  summaryTitle: string
  text?: string
}) {
  const [isCopied, setIsCopied] = useState(false)
  const [isExpanded, setIsExpanded] = useState(false)
  const copiedTimeoutRef = useRef<number | null>(null)
  const { t } = useI18n()
  const copyText = joinToolTracePaneText(text, detail)
  const regionLabel = `${summaryTitle} ${contentLabel}`
  const labelParams = { title: summaryTitle, label: contentLabel }
  const copyLabel = t("thread.toolTrace.copyContent", labelParams)
  const copiedLabel = t("thread.toolTrace.copiedContent", labelParams)
  const expandLabel = t("thread.toolTrace.expandContent", labelParams)
  const collapseLabel = t("thread.toolTrace.collapseContent", labelParams)
  const contentID = `${id}-content`
  const formattedJson = useMemo(
    () => content === undefined && text ? formatToolTraceJson(text) : null,
    [content, text],
  )

  function clearCopiedTimeout() {
    if (copiedTimeoutRef.current === null) return
    window.clearTimeout(copiedTimeoutRef.current)
    copiedTimeoutRef.current = null
  }

  useEffect(() => clearCopiedTimeout, [])

  async function handleCopy() {
    if (!copyText) return

    try {
      await writeTextToClipboard(copyText)
      setIsCopied(true)
      clearCopiedTimeout()
      copiedTimeoutRef.current = window.setTimeout(() => {
        setIsCopied(false)
        copiedTimeoutRef.current = null
      }, 1600)
    } catch (error) {
      console.error("[desktop] Failed to copy tool trace content:", error)
    }
  }

  return (
    <div
      id={id}
      className={joinClassNames("trace-tool-io-pane", isExpanded && "is-expanded")}
      role="region"
      aria-label={regionLabel}
      data-tool-io-kind={kind}
    >
      <div className="trace-tool-io-toolbar" aria-label={`${regionLabel} actions`}>
        <button
          className={joinClassNames("trace-tool-io-action", isCopied && "is-active")}
          type="button"
          aria-label={isCopied ? copiedLabel : copyLabel}
          title={isCopied ? copiedLabel : copyLabel}
          disabled={!copyText}
          onClick={handleCopy}
        >
          <CopyIcon />
        </button>
        <button
          className="trace-tool-io-action"
          type="button"
          aria-label={isExpanded ? collapseLabel : expandLabel}
          title={isExpanded ? collapseLabel : expandLabel}
          aria-expanded={isExpanded}
          aria-controls={contentID}
          onClick={() => setIsExpanded((current) => !current)}
        >
          {isExpanded ? <MinimizeIcon /> : <ExpandIcon />}
        </button>
      </div>
      <div id={contentID} className="trace-tool-io-content">
        {content ?? (formattedJson ? (
          <pre
            className="trace-tool-io-json"
            data-expanded-json-string={formattedJson.containsEmbeddedJson || undefined}
            data-expanded-multiline-string={formattedJson.containsMultilineString || undefined}
            title={
              formattedJson.containsEmbeddedJson || formattedJson.containsMultilineString
                ? "String values are expanded for reading. Copy keeps the original content."
                : undefined
            }
          >
            {formattedJson.text}
          </pre>
        ) : text ? <ThreadRichText className="trace-item-text" text={text} /> : null)}
        {detail ? <ThreadRichText className="trace-item-detail" text={detail} /> : null}
      </div>
    </div>
  )
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
  const disclosureCollapseTimerRef = useRef<number | null>(null)
  const { t } = useI18n()
  const summaryTitle = getToolTraceName(item)
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
  const execInputCode = item.toolName === "exec" ? parseExecToolInputCode(visibleToolInputText) : null
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
      <span className={toolNameClassName} title={summaryTitle}>{summaryTitle}</span>
      {item.toolSource ? (
        <span
          className="trace-tool-source-chip"
          title={`${item.toolSource.name} · ${item.toolSource.provider?.kind ?? item.toolSource.kind}`}
        >
          {item.toolSource.moduleID ?? item.toolSource.id}
        </span>
      ) : null}
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
      return
    }

    setIsExpanded(false)
    if (prefersReducedThreadMotion()) {
      setIsDisclosureCollapsing(false)
      return
    }

    setIsDisclosureCollapsing(true)
    disclosureCollapseTimerRef.current = window.setTimeout(() => {
      disclosureCollapseTimerRef.current = null
      setIsDisclosureCollapsing(false)
    }, THREAD_AUTO_COLLAPSE_MOTION_MS)

    return clearToolDisclosureCollapseTimer
  }, [item.id, shouldCollapseTraceItem])

  useEffect(() => clearToolDisclosureCollapseTimer, [])

  function handleToolToggle() {
    clearToolDisclosureCollapseTimer()
    setIsDisclosureCollapsing(false)
    setIsExpanded((current) => !current)
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
          {hasInputDisclosureContent || hasOutputDisclosureContent ? (
            <div className="trace-tool-io-stack">
              {hasInputDisclosureContent ? (
                <ToolTraceIoPane
                  id={inputDisclosureID}
                  kind="input"
                  summaryTitle={summaryTitle}
                  contentLabel={inputContentLabel}
                  content={execInputCode !== null ? <ExecToolInputCode code={execInputCode} /> : undefined}
                  text={visibleToolInputText}
                  detail={inputSectionDetail}
                />
              ) : null}
              {hasOutputDisclosureContent ? (
                <ToolTraceIoPane
                  id={outputDisclosureID}
                  kind="output"
                  summaryTitle={summaryTitle}
                  contentLabel={outputContentLabel}
                  text={visibleToolOutputText}
                  detail={outputSectionDetail}
                />
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
  interactionRowID = item.id,
  onProposedPlanConfirm,
  ...props
}: TraceItemRendererProps) {
  const proposedPlan = isResponseItem ? parseProposedPlanBlock(item.text) : null

  if (proposedPlan) {
    return (
      <ProposedPlanCard
        interactionRowID={interactionRowID}
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
  interactionRowID,
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
  suppressReasoningMessageCompletionCollapse = false,
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

  return (
    <TraceItemRenderBoundary
      itemID={renderedItem.id}
      itemKind={renderedItem.kind}
      itemTitle={renderedItem.kind === "tool" ? getToolTraceName(renderedItem) : renderedItem.title || renderedItem.label}
    >
      <Renderer
        className={className}
        debugEntries={debugEntries}
        interactionRowID={interactionRowID ?? renderedItem.id}
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
        suppressReasoningMessageCompletionCollapse={suppressReasoningMessageCompletionCollapse}
        traceVisibility={traceVisibility}
      />
    </TraceItemRenderBoundary>
  )
})

function renderTraceItemForRow({
  isQuestionAnswerDisabled,
  isQuestionAnswered,
  onArtifactLinkOpen,
  onAskUserQuestionAnswer,
  onFileChangeSelect,
  onLocalFileLinkOpen,
  onOpenImagePreview,
  onProposedPlanConfirm,
  row,
  traceItem,
  traceVisibility,
}: TraceRowItemRenderInput) {
  return (
    <TraceItemView
      key={`${traceItem.sourceMessageID}:${traceItem.itemID}`}
      assistantMessagePhase={row.message.runtime.phase}
      interactionRowID={row.rowID}
      item={traceItem.item}
      isQuestionAnswered={isQuestionAnswered}
      isQuestionAnswerDisabled={isQuestionAnswerDisabled}
      onOpenImagePreview={onOpenImagePreview}
      onAskUserQuestionAnswer={onAskUserQuestionAnswer}
      onFileChangeSelect={onFileChangeSelect}
      onArtifactLinkOpen={onArtifactLinkOpen}
      onLocalFileLinkOpen={onLocalFileLinkOpen}
      isLatestMessage={row.isLatestMessage}
      onProposedPlanConfirm={onProposedPlanConfirm}
      shouldCollapseAfterMessageCompletion={row.shouldCollapseTraceItemAfterMessageCompletion}
      suppressReasoningMessageCompletionCollapse={row.suppressReasoningMessageCompletionCollapse}
      traceVisibility={traceVisibility}
    />
  )
}

function PermissionRequestCard({
  actionError,
  activeSession,
  isResolving,
  queueCount,
  request,
  onRespond,
}: {
  actionError: string | null
  activeSession: SessionSummary
  isResolving: boolean
  queueCount?: number
  request: PermissionRequest
  onRespond: PermissionRequestResponseHandler
}) {
  const { locale, t } = useI18n()
  const title = request.prompt.title.trim()
  const summary = translatePermissionText(locale, request.prompt.summary)
  const rationale = translatePermissionText(locale, request.prompt.rationale)
  const detailBody = request.prompt.details?.body?.trim()
  const permissionDecisions = getAllowedPermissionDecisions(request)
  const detailLines = [
    rationale && rationale !== summary
      ? { key: "rationale", label: t(permissionDetailLabelTranslationKeys.rationale), value: rationale, isWide: true }
      : null,
    request.prompt.details?.workdir
      ? { key: "workdir", label: t(permissionDetailLabelTranslationKeys.workdir), value: request.prompt.details.workdir, isWide: false }
      : null,
    request.prompt.details?.command
      ? { key: "command", label: t(permissionDetailLabelTranslationKeys.command), value: request.prompt.details.command, isWide: true }
      : null,
    request.prompt.details?.paths && request.prompt.details.paths.length > 0
      ? { key: "paths", label: t(permissionDetailLabelTranslationKeys.paths), value: request.prompt.details.paths.join(", "), isWide: true }
      : null,
  ].filter((item): item is { key: PermissionRequestDetailKey; label: string; value: string; isWide: boolean } => Boolean(item))

  function handleRespond(decision: PermissionDecision) {
    void onRespond({
      sessionID: activeSession.id,
      request,
      decision,
    })
  }

  return (
    <article className="permission-request-card" aria-label={t("thread.permission.cardAria", { title })}>
      <header className="permission-request-header">
        <div>
          <div className="permission-request-context">
            <span className="permission-request-context-label">{t("thread.permission.trace.label")}</span>
            <span className="permission-request-context-title">{t("thread.permission.trace.requested")}</span>
          </div>
          <h3>{title}</h3>
          {summary ? <p className="permission-request-summary">{summary}</p> : null}
        </div>
        <div className="permission-request-badges">
          {queueCount && queueCount > 1 ? (
            <span className="settings-badge permission-request-count">
              {t("thread.permission.requestsWaiting", { count: queueCount })}
            </span>
          ) : null}
          <span className={`permission-risk-chip is-${request.prompt.risk}`}>{formatPermissionRiskLabel(request.prompt.risk, t)}</span>
        </div>
      </header>

      <div className="permission-request-controls">
        <div className="settings-inline-actions permission-request-actions">
          {permissionDecisions.map((decision) => {
            const decisionLabel = formatPermissionDecisionLabel(decision, t)
            return (
              <button
                key={decision}
                className={decision === request.prompt.recommendedDecision ? "primary-button" : "secondary-button"}
                aria-label={t("thread.permission.decisionAria", { decision: decisionLabel, title })}
                disabled={isResolving}
                onClick={() => handleRespond(decision)}
                type="button"
              >
                {isResolving ? t("thread.permission.applying") : decisionLabel}
              </button>
            )
          })}
        </div>
      </div>

      {request.prompt.detailsAvailable && (detailLines.length > 0 || detailBody) ? (
        <details className="permission-request-disclosure">
          <summary>{t("thread.permission.details")}</summary>
          <div className="permission-request-grid permission-request-grid-compact">
            <div className="permission-request-meta">
              <span className="permission-request-meta-label">{t("thread.permission.requested")}</span>
              <strong>{formatTime(request.createdAt)}</strong>
            </div>
            {detailLines.map((item) => (
              <div
                key={item.key}
                className={item.isWide ? "permission-request-meta permission-request-meta-wide" : "permission-request-meta"}
              >
                <span className="permission-request-meta-label">{item.label}</span>
                <strong>{item.value}</strong>
              </div>
            ))}
            {detailBody ? (
              <div className="permission-request-meta permission-request-meta-wide">
                <span className="permission-request-meta-label">{t(permissionDetailLabelTranslationKeys.body)}</span>
                <pre className="permission-request-body">{detailBody}</pre>
              </div>
            ) : null}
          </div>
        </details>
      ) : null}

      <div className="permission-request-footer">
        <p className="permission-request-note">{t("thread.permission.note")}</p>
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
  if (!activeSession || pendingPermissionRequests.length === 0) return null

  const [request] = pendingPermissionRequests
  const isRequestResolving = permissionRequestActionRequestID === request.id ||
    (isResolvingPermissionRequest && !permissionRequestActionRequestID)

  return (
    <article
      className="thread-row permission-request-message"
      data-thread-row-kind="permission-request"
      data-thread-message-id={`permission-request:${request.id}`}
      data-thread-message-motion={motion}
    >
      <section className="permission-request-inline">
        <PermissionRequestCard
          actionError={
            permissionRequestActionError &&
            (!permissionRequestActionRequestID || permissionRequestActionRequestID === request.id)
              ? permissionRequestActionError
              : null
          }
          activeSession={activeSession}
          isResolving={isRequestResolving}
          queueCount={pendingPermissionRequests.length}
          request={request}
          onRespond={onPermissionRequestResponse}
        />
      </section>
    </article>
  )
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

const THREAD_ROW_RENDERER_COMPONENTS = {
  AssistantMessagePlaceholder,
  AssistantTraceSection,
  BranchSwitcher,
  MessageDiffCard,
  PermissionRequestCard,
  PermissionRequestInlinePrompt,
  UserThreadMessageArticle,
  collectAssistantPatchFileChanges,
  getAssistantTraceBlockStackClassName,
  renderTraceItemForRow,
} satisfies ThreadRowRendererComponents

function areArraysShallowEqual<T>(left: readonly T[] | undefined, right: readonly T[] | undefined) {
  if (left === right) return true
  if (!left || !right || left.length !== right.length) return false
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false
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
    left.workflow === right.workflow
  )
}

function getThreadViewPropsChangeReason(left: ThreadViewViewportProps, right: ThreadViewViewportProps) {
  if (!areSessionSummariesEqual(left.activeSession, right.activeSession)) return "activeSession"
  if (buildDiffSummarySignature(left.activeSessionDiff ?? null) !== buildDiffSummarySignature(right.activeSessionDiff ?? null)) {
    return "activeSessionDiff"
  }
  if (!areArraysShallowEqual(left.activeMessages, right.activeMessages)) return "activeMessages"
  if (!areArraysShallowEqual(left.activeTurns, right.activeTurns)) return "activeTurns"
  if (left.assistantTraceVisibility !== right.assistantTraceVisibility) return "assistantTraceVisibility"
  if (left.codeTheme !== right.codeTheme) return "codeTheme"
  if (left.isResolvingPermissionRequest !== right.isResolvingPermissionRequest) return "isResolvingPermissionRequest"
  if (left.isSessionRunning !== right.isSessionRunning) return "isSessionRunning"
  if (left.messageTree !== right.messageTree) return "messageTree"
  if (!areArraysShallowEqual(left.pendingConversationInputs, right.pendingConversationInputs)) return "pendingConversationInputs"
  if (!areArraysShallowEqual(left.pendingPermissionRequests, right.pendingPermissionRequests)) return "pendingPermissionRequests"
  if (left.permissionRequestActionError !== right.permissionRequestActionError) return "permissionRequestActionError"
  if (left.permissionRequestActionRequestID !== right.permissionRequestActionRequestID) return "permissionRequestActionRequestID"
  if (left.onRetryUserMessage !== right.onRetryUserMessage) return "onRetryUserMessage"
  if (left.addImageToComposerDisabledReason !== right.addImageToComposerDisabledReason) {
    return "addImageToComposerDisabledReason"
  }
  if (left.scrollStateKey !== right.scrollStateKey) return "scrollStateKey"
  if (left.threadColumnRef !== right.threadColumnRef) return "threadColumnRef"
  if (left.isThreadVisible !== right.isThreadVisible) return "isThreadVisible"
  if (left.navigationRequest?.requestID !== right.navigationRequest?.requestID) return "navigationRequest"
  if (left.navigationRequest?.messageID !== right.navigationRequest?.messageID) return "navigationRequest"
  if (left.navigationRequest?.paneID !== right.navigationRequest?.paneID) return "navigationRequest"
  if (left.navigationRequest?.turnID !== right.navigationRequest?.turnID) return "navigationRequest"
  if (left.virtualMeasurementKey !== right.virtualMeasurementKey) return "virtualMeasurementKey"
  if (left.readScrollSnapshot !== right.readScrollSnapshot) return "readScrollSnapshot"
  if (left.saveScrollSnapshot !== right.saveScrollSnapshot) return "saveScrollSnapshot"
  if (left.showTurnNavigator !== right.showTurnNavigator) return "showTurnNavigator"
  if (left.interactionStore !== right.interactionStore) return "interactionStore"
  if (left.presentationStore !== right.presentationStore) return "presentationStore"
  if (left.actions !== right.actions) return "actions"
  if (left.actionCapabilities !== right.actionCapabilities) return "actionCapabilities"
  return null
}

function areThreadViewPropsEqual(left: ThreadViewViewportProps, right: ThreadViewViewportProps) {
  const reason = getThreadViewPropsChangeReason(left, right)
  if (!reason) return true

  return false
}

const MemoVisibleThreadView = memo(VisibleThreadView, areThreadViewPropsEqual)

export function ThreadView(props: ThreadViewProps) {
  const inheritedCodeTheme = useContext(ThreadCodeThemeContext)
  const codeTheme = props.codeTheme ?? inheritedCodeTheme
  const actions = useThreadViewActions(props)
  const localInteractionStoreRef = useRef<ThreadInteractionStoreApi | null>(null)
  if (!localInteractionStoreRef.current) {
    localInteractionStoreRef.current = createThreadInteractionStore()
  }
  const interactionStore = props.interactionStore ?? localInteractionStoreRef.current
  const localPresentationStoreRef = useRef<ThreadPresentationStoreApi | null>(null)
  if (!localPresentationStoreRef.current) {
    localPresentationStoreRef.current = createThreadPresentationStore()
  }
  const presentationStore = props.presentationStore ?? localPresentationStoreRef.current
  const canSelectBranch = Boolean(props.onBranchSelect)
  const canSelectFileChange = Boolean(props.onFileChangeSelect)
  const canForkFromMessage = Boolean(props.onForkFromMessage)
  const canBranchChatFromSelection = Boolean(props.onBranchChatFromSelection)
  const canOpenArtifactLink = Boolean(props.onArtifactLinkOpen)
  const canOpenLocalFileLink = Boolean(props.onLocalFileLinkOpen)
  const canHydrateMessageDiffSummary = Boolean(props.onMessageDiffSummaryHydrate)
  const canRestoreMessageDiff = Boolean(props.onMessageDiffRestore)
  const canReviewMessageDiff = Boolean(props.onMessageDiffReview)
  const canAddToComposer = Boolean(props.onAddToComposer)
  const canAddImageToComposer = Boolean(props.onAddImageToComposer)
  const canConfirmProposedPlan = Boolean(props.onProposedPlanConfirm)
  const actionCapabilities = useMemo<ThreadViewActionCapabilities>(() => ({
    canBranchChatFromSelection,
    canSelectBranch,
    canSelectFileChange,
    canForkFromMessage,
    canOpenArtifactLink,
    canOpenLocalFileLink,
    canHydrateMessageDiffSummary,
    canRestoreMessageDiff,
    canReviewMessageDiff,
    canAddToComposer,
    canAddImageToComposer,
    canConfirmProposedPlan,
  }), [
    canBranchChatFromSelection,
    canAddImageToComposer,
    canAddToComposer,
    canConfirmProposedPlan,
    canForkFromMessage,
    canHydrateMessageDiffSummary,
    canOpenArtifactLink,
    canOpenLocalFileLink,
    canRestoreMessageDiff,
    canReviewMessageDiff,
    canSelectBranch,
    canSelectFileChange,
  ])

  const view = props.isThreadVisible === false
    ? <InactiveThreadView threadColumnRef={props.threadColumnRef} />
    : (
      <MemoVisibleThreadView
        {...props}
        actions={actions}
        actionCapabilities={actionCapabilities}
        interactionStore={interactionStore}
        presentationStore={presentationStore}
      />
    )

  return (
    <ThreadCodeThemeContext.Provider value={codeTheme}>
      {view}
    </ThreadCodeThemeContext.Provider>
  )
}

function VisibleThreadView({
  actions,
  actionCapabilities,
  activeSession,
  activeSessionDiff = null,
  activeMessages,
  activeTurns,
  assistantTraceVisibility,
  isResolvingPermissionRequest,
  isSessionRunning = false,
  interactionStore,
  presentationStore,
  navigationRequest = null,
  messageTree = null,
  addImageToComposerDisabledReason = null,
  pendingConversationInputs = [],
  pendingPermissionRequests,
  onRetryUserMessage,
  permissionRequestActionError,
  permissionRequestActionRequestID,
  scrollStateKey,
  threadColumnRef,
  isThreadVisible = true,
  virtualMeasurementKey,
  readScrollSnapshot,
  saveScrollSnapshot,
  showTurnNavigator = true,
}: ThreadViewViewportProps) {
  const { t } = useI18n()
  const threadLinkRouting = useThreadLinkRouting()
  const activeSessionID = activeSession?.id ?? null
  const effectiveScrollStateKey = scrollStateKey ?? activeSessionID ?? "thread:no-session"
  const onBranchSelect = actionCapabilities.canSelectBranch ? actions.onBranchSelect : undefined
  const onFileChangeSelect = actionCapabilities.canSelectFileChange ? actions.onFileChangeSelect : undefined
  const onForkFromMessage = actionCapabilities.canForkFromMessage ? actions.onForkFromMessage : undefined
  const onBranchChatFromSelection = actionCapabilities.canBranchChatFromSelection
    ? actions.onBranchChatFromSelection
    : undefined
  const onArtifactLinkOpen = actionCapabilities.canOpenArtifactLink ? actions.onArtifactLinkOpen : undefined
  const onLocalFileLinkOpen = actionCapabilities.canOpenLocalFileLink ? actions.onLocalFileLinkOpen : undefined
  const onMessageDiffSummaryHydrate = actionCapabilities.canHydrateMessageDiffSummary
    ? actions.onMessageDiffSummaryHydrate
    : undefined
  const onMessageDiffRestore = actionCapabilities.canRestoreMessageDiff ? actions.onMessageDiffRestore : undefined
  const onMessageDiffReview = actionCapabilities.canReviewMessageDiff ? actions.onMessageDiffReview : undefined
  const onAddToComposer = actionCapabilities.canAddToComposer ? actions.onAddToComposer : undefined
  const onAddImageToComposer = actionCapabilities.canAddImageToComposer ? actions.onAddImageToComposer : undefined
  const onAskUserQuestionAnswer = actions.onAskUserQuestionAnswer
  const onProposedPlanConfirm = actionCapabilities.canConfirmProposedPlan ? actions.onProposedPlanConfirm : undefined
  const onPermissionRequestResponse = actions.onPermissionRequestResponse
  const {
    answeredQuestionIDs,
    commitPendingAutoCollapse,
    displayMessages,
    displayRows,
    executionGroups,
    pendingAutoCollapseGroups,
  } = useThreadProjection({
    activeMessages,
    activeSession,
    activeTurns,
    assistantTraceVisibility,
    canForkFromMessage: Boolean(onForkFromMessage),
    isResolvingPermissionRequest,
    isSessionRunning,
    messageTree,
    pendingPermissionRequests,
    presentationScopeID: effectiveScrollStateKey,
    presentationStore,
  })
  const [copiedResponseMessageID, setCopiedResponseMessageID] = useState<string | null>(null)
  const [copiedUserThreadMessageID, setCopiedUserThreadMessageID] = useState<string | null>(null)
  const [focusedVirtualRow, setFocusedVirtualRow] = useState<ThreadInteractionRowRef | null>(null)
  const [projectionPinnedRowIDs, setProjectionPinnedRowIDs] = useState<string[]>([])
  const [releasedRestorationPinIdentity, setReleasedRestorationPinIdentity] = useState<string | null>(null)
  const [threadCopyContextMenu, setThreadCopyContextMenu] = useState<ThreadCopyContextMenuState | null>(null)
  const [activeImagePreview, setActiveImagePreview] = useState<ActiveImagePreview | null>(null)
  const copiedResponseTimeoutRef = useRef<number | null>(null)
  const copiedUserTimeoutRef = useRef<number | null>(null)
  const threadCopyContextMenuRef = useRef<HTMLDivElement | null>(null)
  const activeProjectionTransactionRef = useRef<ThreadProjectionLayoutTransaction | null>(null)
  const pendingExecutionSummaryFocusRowIDRef = useRef<string | null>(null)
  const projectionPinReleaseFrameRef = useRef<number | null>(null)
  const observedContentScrollSyncRef = useRef<((key?: string) => void) | null>(null)
  const latestAssistantMessageStateRef = useRef<LatestAssistantMessageState | null>(null)
  const previousActiveMessageCountRef = useRef(activeMessages.length)
  const previousDisplayMessageIDsByScrollKeyRef = useRef<Record<string, Set<string>>>({})
  const renderedMessageIDsByScrollKeyRef = useRef<Record<string, Set<string>>>({})
  const lastInlineLinkActivationRef = useRef<{
    href: string
    time: number
    x: number
    y: number
  } | null>(null)
  const handledNavigationRequestIDRef = useRef<number | null>(null)
  const projectScrollSnapshotForCurrentProjection = useCallback(
    (snapshot: ThreadScrollSnapshot) => projectThreadScrollSnapshotToExecutionGroups(
      snapshot,
      executionGroups,
      displayRows,
    ),
    [displayRows, executionGroups],
  )
  const initialRestorationSnapshot = useMemo(() => {
    const snapshot = readScrollSnapshot?.(effectiveScrollStateKey)
    return snapshot ? projectScrollSnapshotForCurrentProjection(snapshot) : null
  }, [effectiveScrollStateKey, projectScrollSnapshotForCurrentProjection, readScrollSnapshot])
  const restorationAnchorRowID = initialRestorationSnapshot && !initialRestorationSnapshot.pinnedToBottom
    ? initialRestorationSnapshot.anchor?.rowID ?? null
    : null
  const restorationPinIdentity = restorationAnchorRowID
    ? `${effectiveScrollStateKey}\u0000${restorationAnchorRowID}`
    : null
  const restorationPinnedRowID = restorationPinIdentity !== releasedRestorationPinIdentity
    ? restorationAnchorRowID
    : null
  const focusedVirtualRowID = focusedVirtualRow?.scopeID === effectiveScrollStateKey
    ? focusedVirtualRow.rowID
    : null
  const threadInteractionContextValue = useMemo<ThreadInteractionContextValue>(() => ({
    scopeID: effectiveScrollStateKey,
    store: interactionStore,
  }), [effectiveScrollStateKey, interactionStore])
  const pinnedVirtualRowIDs = useMemo(
    () => Array.from(new Set([
      ...(focusedVirtualRowID ? [focusedVirtualRowID] : []),
      ...(restorationPinnedRowID ? [restorationPinnedRowID] : []),
      ...projectionPinnedRowIDs,
    ])),
    [focusedVirtualRowID, projectionPinnedRowIDs, restorationPinnedRowID],
  )
  const {
    getThreadVirtualOffsetForRowIndex,
    getThreadVirtualScrollMaxTop,
    rowVirtualizer,
    scrollToThreadVirtualOffset,
    threadVirtualItems,
    threadVirtualRenderedRangeKey,
    threadVirtualTotalSize,
  } = useThreadVirtualList({
    displayRows,
    getInitialOffset: getInitialThreadVirtualOffset,
    pinnedRowIDs: pinnedVirtualRowIDs,
    suppressScrollCompensation: projectionPinnedRowIDs.length > 0,
    threadColumnRef,
    virtualListKey: effectiveScrollStateKey,
  })
  const handleThreadFocusCapture = useCallback((event: ReactFocusEvent<HTMLDivElement>) => {
    const target = event.target
    if (!(target instanceof Element)) return

    const row = target.closest<HTMLElement>("[data-thread-virtual-row-id]")
    const rowID = row?.dataset.threadVirtualRowId ?? null
    setFocusedVirtualRow(rowID ? { scopeID: effectiveScrollStateKey, rowID } : null)
    if (rowID) {
      interactionStore.getState().focusRow(effectiveScrollStateKey, rowID)
    }
  }, [effectiveScrollStateKey, interactionStore])
  const handleThreadBlurCapture = useCallback((event: ReactFocusEvent<HTMLDivElement>) => {
    const currentTarget = event.target
    const currentRow = currentTarget instanceof Element
      ? currentTarget.closest<HTMLElement>("[data-thread-virtual-row-id]")
      : null
    const nextTarget = event.relatedTarget
    if (nextTarget instanceof Element && event.currentTarget.contains(nextTarget)) {
      const nextRow = nextTarget.closest<HTMLElement>("[data-thread-virtual-row-id]")
      const nextRowID = nextRow?.dataset.threadVirtualRowId ?? null
      setFocusedVirtualRow(nextRowID ? { scopeID: effectiveScrollStateKey, rowID: nextRowID } : null)
      if (nextRowID) {
        interactionStore.getState().focusRow(effectiveScrollStateKey, nextRowID)
      }
      return
    }

    setFocusedVirtualRow(null)
    const currentRowID = currentRow?.dataset.threadVirtualRowId
    if (currentRowID) {
      interactionStore.getState().blurRow(effectiveScrollStateKey, currentRowID)
    }
  }, [effectiveScrollStateKey, interactionStore])
  useEffect(() => {
    return () => {
      const focusedRow = interactionStore.getState().focusedRow
      if (focusedRow?.scopeID === effectiveScrollStateKey) {
        interactionStore.getState().blurRow(focusedRow.scopeID, focusedRow.rowID)
      }
    }
  }, [effectiveScrollStateKey, interactionStore])
  const renderedVirtualMessageIDsKey = useMemo(() => {
    const messageIDs = new Set<string>()
    for (const virtualItem of threadVirtualItems) {
      const row = displayRows[virtualItem.index]
      if (row) messageIDs.add(row.messageID)
    }

    return Array.from(messageIDs).join("\u0001")
  }, [displayRows, threadVirtualItems])
  const displayMessageIDs = useMemo(
    () => displayMessages.map((message) => message.id),
    [displayMessages],
  )
  const threadCopyTargets = useMemo(() => {
    const assistant = new Map<string, string>()
    const user = new Map<string, string>()

    for (const row of displayRows) {
      if (row.kind === "assistant-actions" && row.responseCopyText) {
        assistant.set(row.ownerMessageID, row.responseCopyText)
      } else if (row.kind === "user-message") {
        const text = getUserMessageCopyText(row.message)
        if (text) user.set(row.message.id, text)
      } else if (row.kind === "assistant-inserted-user-message") {
        const text = getUserMessageCopyText(row.insertedMessage)
        if (text) user.set(row.insertedMessage.id, text)
      }
    }

    return { assistant, user }
  }, [displayRows])
  const newDisplayMessageIDs = useMemo(() => {
    const previousMessageIDs = previousDisplayMessageIDsByScrollKeyRef.current[effectiveScrollStateKey]
    if (!previousMessageIDs) return new Set<string>()

    return new Set(displayMessageIDs.filter((messageID) => !previousMessageIDs.has(messageID)))
  }, [displayMessageIDs, effectiveScrollStateKey])
  const {
    beginThreadProjectionLayoutTransaction,
    cancelThreadProjectionLayoutTransaction,
    completeThreadProjectionLayoutTransaction,
    handleThreadKeyDownIntent,
    handleThreadPointerMoveIntent,
    handleThreadScroll,
    handleThreadScrollIntent,
    handleThreadWheelIntent,
    isSmoothFollowScrollActiveForKey,
    isThreadScrollFollowing,
    navigateThreadToOffset,
    restoreDetachedThreadPositionIfNeeded,
    suppressFollowScrollSync,
    syncThreadScrollAfterContentChange,
  } = useThreadScrollController({
    getLatestThreadContentScrollTarget,
    isSidebarResizeInProgress,
    projectScrollSnapshot: projectScrollSnapshotForCurrentProjection,
    readScrollSnapshot,
    saveScrollSnapshot,
    scrollToThreadOffset: scrollToThreadVirtualOffset,
    scrollStateKey: effectiveScrollStateKey,
    threadColumnRef,
  })
  const cancelProjectionTransactionRef = useRef(cancelThreadProjectionLayoutTransaction)
  cancelProjectionTransactionRef.current = cancelThreadProjectionLayoutTransaction
  const pinProjectionRows = useCallback((rowIDs: readonly string[]) => {
    if (projectionPinReleaseFrameRef.current !== null && typeof window !== "undefined") {
      window.cancelAnimationFrame(projectionPinReleaseFrameRef.current)
      projectionPinReleaseFrameRef.current = null
    }
    setProjectionPinnedRowIDs((current) => Array.from(new Set([...current, ...rowIDs])))
  }, [])
  const releaseProjectionPinsAfterCorrection = useCallback((transaction?: ThreadProjectionLayoutTransaction) => {
    const finish = () => {
      if (!transaction || activeProjectionTransactionRef.current?.id === transaction.id) {
        activeProjectionTransactionRef.current = null
      }
      setProjectionPinnedRowIDs([])
    }
    if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") {
      finish()
      return
    }
    if (projectionPinReleaseFrameRef.current !== null) {
      window.cancelAnimationFrame(projectionPinReleaseFrameRef.current)
    }
    projectionPinReleaseFrameRef.current = window.requestAnimationFrame(() => {
      projectionPinReleaseFrameRef.current = window.requestAnimationFrame(() => {
        projectionPinReleaseFrameRef.current = window.requestAnimationFrame(() => {
          projectionPinReleaseFrameRef.current = null
          finish()
        })
      })
    })
  }, [])
  const handleExecutionSummaryToggle = useCallback((row: AssistantExecutionSummaryRow) => {
    const transaction = beginThreadProjectionLayoutTransaction({
      anchorRowID: row.rowID,
      sourceRowID: row.rowID,
      turnID: row.turnID,
    })
    if (transaction) {
      activeProjectionTransactionRef.current = transaction
      pinProjectionRows([row.rowID])
    }
    presentationStore.getState().toggleProcessDisclosure(
      effectiveScrollStateKey,
      row.groupID,
      row.expanded,
    )
  }, [
    beginThreadProjectionLayoutTransaction,
    effectiveScrollStateKey,
    pinProjectionRows,
    presentationStore,
  ])

  useLayoutEffect(() => {
    const transaction = activeProjectionTransactionRef.current
    if (!transaction) return
    if (!displayRows.some((row) => row.rowID === transaction.anchor.rowID)) return

    completeThreadProjectionLayoutTransaction(transaction)
    releaseProjectionPinsAfterCorrection(transaction)
  }, [completeThreadProjectionLayoutTransaction, displayRows, releaseProjectionPinsAfterCorrection])

  useLayoutEffect(() => {
    const rowID = pendingExecutionSummaryFocusRowIDRef.current
    const threadColumn = threadColumnRef.current
    if (!rowID || !threadColumn) return
    const row = findOwnedThreadVirtualRow(threadColumn, rowID)
    const button = row?.querySelector<HTMLButtonElement>(".assistant-execution-summary-button")
    if (!button) return
    pendingExecutionSummaryFocusRowIDRef.current = null
    button.focus({ preventScroll: true })
  }, [displayRows, threadColumnRef])

  useLayoutEffect(() => {
    const groups = pendingAutoCollapseGroups
    const threadColumn = threadColumnRef.current
    if (groups.length === 0 || !threadColumn || activeProjectionTransactionRef.current) return

    const prefixGroupByRowID = new Map<string, (typeof groups)[number]>()
    const outcomeGroupByRowID = new Map<string, (typeof groups)[number]>()
    groups.forEach((group) => {
      group.prefixRowIDs.forEach((rowID) => prefixGroupByRowID.set(rowID, group))
      group.outcomeRowIDs.forEach((rowID) => outcomeGroupByRowID.set(rowID, group))
    })
    const prefixRowIDSet = new Set(prefixGroupByRowID.keys())
    const activeElementRowID = readOwnedThreadRowIDForNode(
      threadColumn,
      threadColumn.ownerDocument.activeElement,
    )
    const focusedGroup = activeElementRowID ? prefixGroupByRowID.get(activeElementRowID) : undefined
    if (focusedGroup) {
      pendingExecutionSummaryFocusRowIDRef.current = focusedGroup.summaryRowID
    }
    clearSelectionInsideThreadRows(threadColumn, prefixRowIDSet)

    const ownedRows = readOwnedThreadVirtualRows(threadColumn)
    const columnRect = threadColumn.getBoundingClientRect()
    const prefixRows = ownedRows
      .filter((row) => prefixRowIDSet.has(row.dataset.threadVirtualRowId ?? ""))
      .map((row) => ({ row, rect: row.getBoundingClientRect() }))
      .sort((left, right) => left.rect.top - right.rect.top)
    const isFollowingBottom = isThreadScrollFollowing(effectiveScrollStateKey)
    let anchorRowID: string | null = null
    let sourceRowID: string | undefined
    let viewportOffset: number | undefined
    let anchorTurnID = groups.at(-1)?.turnID

    if (isFollowingBottom) {
      const outcomeRow = [...displayRows]
        .reverse()
        .filter((row) => outcomeGroupByRowID.has(row.rowID))
        .map((row) => findOwnedThreadVirtualRow(threadColumn, row.rowID))
        .find((row): row is HTMLElement => Boolean(row))
      const fallbackGroup = groups.at(-1)!
      const fallbackSource = prefixRows.at(-1)?.row ??
        findOwnedThreadVirtualRow(threadColumn, fallbackGroup.summaryRowID)
      const source = outcomeRow ?? fallbackSource
      if (source) {
        anchorRowID = outcomeRow?.dataset.threadVirtualRowId ?? fallbackGroup.summaryRowID
        sourceRowID = source.dataset.threadVirtualRowId
        viewportOffset = source.getBoundingClientRect().top - columnRect.top
        anchorTurnID = outcomeGroupByRowID.get(anchorRowID)?.turnID ?? fallbackGroup.turnID
      }
    } else if (prefixRows.length > 0 && prefixRows.every(({ rect }) => rect.bottom <= columnRect.top)) {
      const survivingRow = ownedRows
        .filter((row) => !prefixRowIDSet.has(row.dataset.threadVirtualRowId ?? ""))
        .map((row) => ({ row, rect: row.getBoundingClientRect() }))
        .filter(({ rect }) => rect.bottom > columnRect.top)
        .sort((left, right) => left.rect.top - right.rect.top)[0]
      if (survivingRow) {
        anchorRowID = survivingRow.row.dataset.threadVirtualRowId ?? null
        sourceRowID = anchorRowID ?? undefined
        viewportOffset = survivingRow.rect.top - columnRect.top
      }
    } else if (prefixRows.length > 0 && prefixRows.every(({ rect }) => rect.top >= columnRect.bottom)) {
      // Removing rows entirely below the viewport cannot move the current visual position.
    } else {
      const firstPrefixIndex = displayRows.findIndex((row) => prefixRowIDSet.has(row.rowID))
      let lastPrefixIndex = -1
      for (let index = displayRows.length - 1; index >= 0; index -= 1) {
        if (!prefixRowIDSet.has(displayRows[index]!.rowID)) continue
        lastPrefixIndex = index
        break
      }
      const firstRenderedIndex = threadVirtualItems[0]?.index ?? 0
      const isEntirePrefixBelowViewport = firstPrefixIndex >= 0 && firstPrefixIndex > (threadVirtualItems.at(-1)?.index ?? -1)
      const isEntirePrefixAboveViewport = lastPrefixIndex >= 0 && lastPrefixIndex < firstRenderedIndex

      if (!isEntirePrefixBelowViewport) {
        const source = prefixRows.find(({ rect }) => rect.bottom > columnRect.top)?.row
        if (source) {
          const sourceGroup = prefixGroupByRowID.get(source.dataset.threadVirtualRowId ?? "")
          anchorRowID = sourceGroup?.summaryRowID ?? groups[0]!.summaryRowID
          sourceRowID = source.dataset.threadVirtualRowId
          viewportOffset = source.getBoundingClientRect().top - columnRect.top
          anchorTurnID = sourceGroup?.turnID ?? groups[0]!.turnID
        } else if (isEntirePrefixAboveViewport) {
          const survivingRow = ownedRows
            .filter((row) => !prefixRowIDSet.has(row.dataset.threadVirtualRowId ?? ""))
            .sort((left, right) => left.getBoundingClientRect().top - right.getBoundingClientRect().top)[0]
          if (survivingRow) {
            anchorRowID = survivingRow.dataset.threadVirtualRowId ?? null
            sourceRowID = anchorRowID ?? undefined
            viewportOffset = survivingRow.getBoundingClientRect().top - columnRect.top
          }
        }
      }
    }

    if (anchorRowID && sourceRowID && viewportOffset !== undefined) {
      const transaction = beginThreadProjectionLayoutTransaction({
        anchorRowID,
        sourceRowID,
        viewportOffset,
        turnID: anchorTurnID,
      })
      if (transaction) {
        activeProjectionTransactionRef.current = transaction
        pinProjectionRows([anchorRowID, ...groups.map((group) => group.summaryRowID)])
      }
    }
    commitPendingAutoCollapse(groups.map((group) => group.groupID))
  }, [
    beginThreadProjectionLayoutTransaction,
    commitPendingAutoCollapse,
    displayRows,
    effectiveScrollStateKey,
    isThreadScrollFollowing,
    pendingAutoCollapseGroups,
    pinProjectionRows,
    projectionPinnedRowIDs.length,
    threadColumnRef,
    threadVirtualItems,
  ])

  useEffect(() => () => {
    if (projectionPinReleaseFrameRef.current !== null && typeof window !== "undefined") {
      window.cancelAnimationFrame(projectionPinReleaseFrameRef.current)
    }
    const transaction = activeProjectionTransactionRef.current
    if (transaction) cancelProjectionTransactionRef.current(transaction)
  }, [])
  const threadTurnNavigationItems = useMemo(
    () => buildThreadTurnNavigationItems(activeTurns ?? [], displayRows),
    [activeTurns, displayRows],
  )
  const {
    currentIndex: currentThreadTurnNavigationIndex,
    updateCurrentIndex: updateThreadTurnNavigationIndex,
    visibleIndexes: visibleThreadTurnNavigationIndexes,
  } = useThreadTurnNavigation({
    items: threadTurnNavigationItems,
    measurementKey: `${effectiveScrollStateKey}:${virtualMeasurementKey ?? "default"}:${threadVirtualRenderedRangeKey}`,
    resetKey: effectiveScrollStateKey,
    threadColumnRef,
    virtualizer: rowVirtualizer,
  })
  const handleNavigateThreadTurn = useCallback((item: ThreadTurnNavigationItem) => {
    const offset = getThreadVirtualOffsetForRowIndex(item.rowIndex, 16)
    if (offset === null) return
    navigateThreadToOffset(offset, effectiveScrollStateKey)
  }, [effectiveScrollStateKey, getThreadVirtualOffsetForRowIndex, navigateThreadToOffset])

  useLayoutEffect(() => {
    if (!navigationRequest || handledNavigationRequestIDRef.current === navigationRequest.requestID) return
    if (!isThreadVisible) return

    if (navigationRequest.messageID) {
      const requestedRowIndex = findThreadMessageNavigationRowIndex(
        displayRows,
        navigationRequest.messageID,
      )
      if (requestedRowIndex < 0) return

      const offset = getThreadVirtualOffsetForRowIndex(requestedRowIndex, 16)
      if (offset === null) return

      navigateThreadToOffset(offset, effectiveScrollStateKey)
      handledNavigationRequestIDRef.current = navigationRequest.requestID
      return
    }

    if (threadTurnNavigationItems.length === 0) return

    const requestedItem = threadTurnNavigationItems.find((item) => item.turnID === navigationRequest.turnID)
    const targetItem = requestedItem ?? threadTurnNavigationItems.at(-1)
    if (!targetItem) return

    const offset = getThreadVirtualOffsetForRowIndex(targetItem.rowIndex, 16)
    if (offset === null) return

    navigateThreadToOffset(offset, effectiveScrollStateKey)
    if (requestedItem || !navigationRequest.turnID) {
      handledNavigationRequestIDRef.current = navigationRequest.requestID
    }
  }, [
    displayRows,
    effectiveScrollStateKey,
    getThreadVirtualOffsetForRowIndex,
    isThreadVisible,
    navigationRequest,
    navigateThreadToOffset,
    threadTurnNavigationItems,
  ])
  const handleThreadColumnScroll = useCallback(() => {
    handleThreadScroll()
    updateThreadTurnNavigationIndex()
  }, [handleThreadScroll, updateThreadTurnNavigationIndex])

  function getInitialThreadVirtualOffset() {
    const rawSnapshot = readScrollSnapshot?.(effectiveScrollStateKey)
    const snapshot = rawSnapshot ? projectScrollSnapshotForCurrentProjection(rawSnapshot) : null
    if (!snapshot || snapshot.pinnedToBottom) return 0
    return snapshot.scrollTop
  }

  function shouldUseStreamingResponseScrollTargetForVirtualRows() {
    for (let index = displayRows.length - 1; index >= 0; index -= 1) {
      const row = displayRows[index]
      if (row?.kind !== "assistant-response-row") continue

      if (row.item.kind !== "text" || !row.item.isStreaming || traceSectionKeyForItem(row.item) !== "response") {
        continue
      }
      for (let candidateIndex = index + 1; candidateIndex < displayRows.length; candidateIndex += 1) {
        const candidate = displayRows[candidateIndex]
        if (candidate && "ownerMessageID" in candidate && candidate.ownerMessageID === row.ownerMessageID) {
          return true
        }
      }
      return false
    }

    return false
  }

  function getLatestThreadContentScrollTarget(
    threadColumn: HTMLDivElement,
    options: { skipStreamingResponseMeasurement?: boolean } = {},
  ): ThreadFollowScrollTarget {
    const canMeasureStreamingResponse = options.skipStreamingResponseMeasurement !== true

    if (canMeasureStreamingResponse && shouldUseStreamingResponseScrollTargetForVirtualRows()) {
      const streamingResponseTarget = getStreamingResponseScrollTarget(threadColumn)
      if (streamingResponseTarget) return streamingResponseTarget
    }

    const scrollTop = getThreadVirtualScrollMaxTop(threadColumn)
    return {
      scrollTop,
      visualScrollTop: scrollTop,
    }
  }

  const {
    scheduleObservedContentScrollSync: scheduleObservedContentScrollSyncFromObserver,
  } = useThreadContentObserver({
    isSidebarResizeInProgress,
    isSmoothFollowScrollActiveForKey,
    shouldSmoothFollowObservedContentChange: () => latestAssistantMessageStateRef.current?.isStreaming === true,
    scrollStateKey: effectiveScrollStateKey,
    syncThreadScrollAfterContentChange,
    threadColumnRef,
    threadVirtualRenderedRangeKey,
  })
  observedContentScrollSyncRef.current = scheduleObservedContentScrollSyncFromObserver

  function readThreadMessageMotion(messageID: string, isLive = false): ThreadMessageMotion {
    const renderedMessageIDs = renderedMessageIDsByScrollKeyRef.current[effectiveScrollStateKey]
    if (newDisplayMessageIDs.has(messageID) && isThreadVisible) return isLive ? "live" : "new"
    if (!renderedMessageIDs || renderedMessageIDs.has(messageID) || !isThreadVisible) return "history"
    return isLive ? "live" : "new"
  }

  useEffect(() => {
    return () => {
      if (copiedResponseTimeoutRef.current !== null) {
        window.clearTimeout(copiedResponseTimeoutRef.current)
      }
      if (copiedUserTimeoutRef.current !== null) {
        window.clearTimeout(copiedUserTimeoutRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!threadCopyContextMenu) return

    function closeThreadCopyContextMenu() {
      setThreadCopyContextMenu(null)
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target
      if (target instanceof Node && threadCopyContextMenuRef.current?.contains(target)) return
      closeThreadCopyContextMenu()
    }

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        closeThreadCopyContextMenu()
      }
    }

    const threadColumn = threadColumnRef.current
    window.addEventListener("pointerdown", handlePointerDown)
    window.addEventListener("keydown", handleKeyDown)
    window.addEventListener("blur", closeThreadCopyContextMenu)
    threadColumn?.addEventListener("scroll", closeThreadCopyContextMenu, { passive: true })
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown)
      window.removeEventListener("keydown", handleKeyDown)
      window.removeEventListener("blur", closeThreadCopyContextMenu)
      threadColumn?.removeEventListener("scroll", closeThreadCopyContextMenu)
    }
  }, [threadColumnRef, threadCopyContextMenu])

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

  const handleCopySelectedThreadText = useEffectEvent(async (text: string) => {
    try {
      await writeTextToClipboard(text)
    } catch (error) {
      console.error("[desktop] Failed to copy selected thread text:", error)
    }
  })

  function handleThreadContextMenu(event: ReactMouseEvent<HTMLDivElement>) {
    if (event.defaultPrevented) return

    const threadColumn = threadColumnRef.current
    if (!threadColumn) return

    const imageTarget = readThreadContextMenuImageTarget(event, threadColumn)
    if (imageTarget) {
      event.preventDefault()
      event.stopPropagation()
      setThreadCopyContextMenu(imageTarget)
      return
    }

    const selectedText = readSelectedThreadText(threadColumn)
    const selectedResponseMessageID = selectedText?.messageID
      ? (() => {
          const selectedMessage = displayMessages.find(
            (message) => message.kind === "assistant" && message.id === selectedText.messageID,
          )
          if (selectedMessage?.kind !== "assistant") return null
          const persistedMessageID = getSessionMessageIDForMessage(selectedMessage)
          return messageTree?.nodesByID[persistedMessageID]?.isCompletedResponse
            ? persistedMessageID
            : null
        })()
      : null
    const position = getThreadCopyContextMenuCoordinates(
      event,
      selectedResponseMessageID && onBranchChatFromSelection ? 124 : THREAD_TEXT_CONTEXT_MENU_HEIGHT,
    )

    if (selectedText) {
      event.preventDefault()
      event.stopPropagation()
      setThreadCopyContextMenu({
        target: "text",
        kind: "selection",
        messageID: selectedResponseMessageID,
        text: selectedText.text,
        ...position,
      })
      return
    }

    let messageElement: HTMLElement | null = null
    for (const target of getThreadContextMenuEventPath(event)) {
      if (!(target instanceof Element)) continue
      const candidate = target.closest<HTMLElement>("[data-thread-message-id][data-thread-row-kind]")
      if (candidate && threadColumn.contains(candidate)) {
        messageElement = candidate
        break
      }
    }

    const messageID = messageElement?.dataset.threadMessageId
    const rowKind = messageElement?.dataset.threadRowKind
    if (!messageID || !rowKind) return

    const userText = threadCopyTargets.user.get(messageID)
    if (userText && (rowKind === "user-message" || rowKind === "assistant-inserted-user-message")) {
      event.preventDefault()
      event.stopPropagation()
      setThreadCopyContextMenu({
        target: "text",
        kind: "user",
        messageID,
        text: userText,
        ...position,
      })
      return
    }

    const assistantText = threadCopyTargets.assistant.get(messageID)
    if (assistantText && (rowKind === "assistant-response-row" || rowKind === "assistant-actions")) {
      event.preventDefault()
      event.stopPropagation()
      setThreadCopyContextMenu({
        target: "text",
        kind: "assistant",
        messageID,
        text: assistantText,
        ...position,
      })
    }
  }

  async function handleThreadCopyContextMenuCopy(menu: ThreadCopyContextMenuState) {
    setThreadCopyContextMenu(null)

    if (menu.target === "image") {
      try {
        await writeThreadImageToClipboard(menu)
      } catch (error) {
        console.error("[desktop] Failed to copy thread image:", error)
      }
      return
    }

    if (menu.kind === "selection") {
      await handleCopySelectedThreadText(menu.text)
      return
    }

    if (menu.kind === "assistant" && menu.messageID) {
      await handleCopyAssistantResponse(menu.messageID, menu.text)
      return
    }

    if (menu.kind === "user" && menu.messageID) {
      await handleCopyUserMessage(menu.messageID, menu.text)
    }
  }

  async function handleThreadCopyContextMenuAddToComposer(menu: ThreadCopyContextMenuState) {
    setThreadCopyContextMenu(null)

    if (menu.target === "image") {
      if (!onAddImageToComposer || addImageToComposerDisabledReason) return

      try {
        const image = await createThreadImageComposerAttachment(menu)
        await onAddImageToComposer([image])
      } catch (error) {
        console.error("[desktop] Failed to add thread image to composer:", error)
      }
      return
    }

    await onAddToComposer?.(menu.text)
  }

  function handleThreadCopyContextMenuBranchChat(menu: ThreadTextCopyContextMenuState) {
    setThreadCopyContextMenu(null)
    if (menu.kind !== "selection" || !menu.messageID) return
    void onBranchChatFromSelection?.({
      messageID: menu.messageID,
      text: menu.text,
    })
  }

  async function handleThreadCopyContextMenuSaveImage(menu: ThreadImageCopyContextMenuState) {
    setThreadCopyContextMenu(null)

    const saveImageToFolder = window.desktop?.saveImageToFolder
    if (!saveImageToFolder) return

    try {
      const image = await createThreadImageComposerAttachment(menu)
      await saveImageToFolder({
        dataUrl: image.dataUrl,
        mimeType: image.mimeType,
        name: image.name,
      })
    } catch (error) {
      console.error("[desktop] Failed to save thread image:", error)
    }
  }

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

      if (threadLinkRouting) {
        threadLinkRouting.openInAnybox(linkTarget.href)
      } else {
        openExternalThreadLink(linkTarget.href)
      }
    }

    document.addEventListener("pointerup", handleInlineThreadLinkActivation, { capture: true })
    document.addEventListener("click", handleInlineThreadLinkActivation, { capture: true })
    return () => {
      document.removeEventListener("pointerup", handleInlineThreadLinkActivation, { capture: true })
      document.removeEventListener("click", handleInlineThreadLinkActivation, { capture: true })
    }
  }, [onArtifactLinkOpen, onLocalFileLinkOpen, threadColumnRef, threadLinkRouting])

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
      suppressFollowScrollSync()
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
    const didRestore = restoreDetachedThreadPositionIfNeeded(effectiveScrollStateKey)
    if (
      didRestore &&
      restorationPinIdentity &&
      releasedRestorationPinIdentity !== restorationPinIdentity
    ) {
      setReleasedRestorationPinIdentity(restorationPinIdentity)
    }
  })

  useEffect(() => {
    const renderedMessageIDs = renderedMessageIDsByScrollKeyRef.current[effectiveScrollStateKey] ?? new Set<string>()
    for (const messageID of renderedVirtualMessageIDsKey.split("\u0001")) {
      if (messageID) renderedMessageIDs.add(messageID)
    }
    renderedMessageIDsByScrollKeyRef.current[effectiveScrollStateKey] = renderedMessageIDs
  }, [effectiveScrollStateKey, renderedVirtualMessageIDsKey])

  useEffect(() => {
    previousDisplayMessageIDsByScrollKeyRef.current[effectiveScrollStateKey] = new Set(displayMessageIDs)
  }, [displayMessageIDs, effectiveScrollStateKey])

  function isTraceItemQuestionAnswered(item: AssistantTraceItem) {
    const questionID = item.questionPrompt?.questionID
    return Boolean(item.questionPrompt?.answered || (questionID && answeredQuestionIDs.has(questionID)))
  }

  function renderDisplayRow(row: ThreadDisplayRow) {
    if (row.kind === "assistant-execution-summary") {
      return (
        <div
          className="assistant-execution-summary-row"
          data-thread-row-kind="assistant-execution-summary"
        >
          <AssistantExecutionSummary row={row} onToggle={handleExecutionSummaryToggle} />
        </div>
      )
    }

    return (
      <ThreadRowRenderer
        key={row.rowID}
        activeSession={activeSession}
        activeSessionDiff={activeSessionDiff}
        assistantTraceVisibility={assistantTraceVisibility}
        components={THREAD_ROW_RENDERER_COMPONENTS}
        copiedResponseMessageID={copiedResponseMessageID}
        copiedUserThreadMessageID={copiedUserThreadMessageID}
        displayMessages={displayMessages}
        isResolvingPermissionRequest={isResolvingPermissionRequest}
        isTraceItemQuestionAnswered={isTraceItemQuestionAnswered}
        onArtifactLinkOpen={onArtifactLinkOpen}
        onAskUserQuestionAnswer={onAskUserQuestionAnswer}
        onBranchSelect={onBranchSelect}
        onCopyAssistantResponse={handleCopyAssistantResponse}
        onCopyUserMessage={handleCopyUserMessage}
        onFileChangeSelect={onFileChangeSelect}
        onForkFromMessage={onForkFromMessage}
        onLocalFileLinkOpen={onLocalFileLinkOpen}
        onMessageDiffSummaryHydrate={onMessageDiffSummaryHydrate}
        onMessageDiffRestore={onMessageDiffRestore}
        onMessageDiffReview={onMessageDiffReview}
        onOpenImagePreview={handleOpenImagePreview}
        onPermissionRequestResponse={onPermissionRequestResponse}
        onProposedPlanConfirm={onProposedPlanConfirm}
        onRetryUserMessage={onRetryUserMessage}
        pendingPermissionRequests={pendingPermissionRequests}
        permissionRequestActionError={permissionRequestActionError}
        permissionRequestActionRequestID={permissionRequestActionRequestID}
        readThreadMessageMotion={readThreadMessageMotion}
        row={row}
      />
    )
  }
  return (
    <ThreadInteractionContext.Provider value={threadInteractionContextValue}>
      <section className="thread-shell">
      {showTurnNavigator && activeSession && threadTurnNavigationItems.length > 0 ? (
        <ThreadTurnNavigator
          currentIndex={currentThreadTurnNavigationIndex}
          items={threadTurnNavigationItems}
          onNavigate={handleNavigateThreadTurn}
          visibleIndexes={visibleThreadTurnNavigationIndexes}
        />
      ) : null}
      <div
        ref={threadColumnRef}
        className={joinClassNames(
          "thread-column",
          activeSession && "is-virtualized",
        )}
        onBlurCapture={handleThreadBlurCapture}
        onFocusCapture={handleThreadFocusCapture}
        onKeyDownCapture={handleThreadKeyDownIntent}
        onPointerDownCapture={handleThreadScrollIntent}
        onPointerMoveCapture={handleThreadPointerMoveIntent}
        onContextMenu={handleThreadContextMenu}
        onScroll={handleThreadColumnScroll}
        onWheelCapture={handleThreadWheelIntent}
      >
        {!activeSession ? (
          <article className="thread-row assistant-empty-state-row" data-thread-row-kind="assistant-empty-state">
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
          <ThreadRows
            displayRows={displayRows}
            renderRow={renderDisplayRow}
            virtualItems={threadVirtualItems}
            virtualizer={rowVirtualizer}
            virtualMeasurementKey={virtualMeasurementKey ?? effectiveScrollStateKey}
            virtualTotalSize={threadVirtualTotalSize}
          />
        )}
      </div>
      {threadCopyContextMenu
        ? createPortal(
            <div
              ref={threadCopyContextMenuRef}
              className="thread-copy-context-menu"
              role="menu"
              aria-label={threadCopyContextMenu.target === "image" ? "Thread image actions" : "Thread copy actions"}
              style={{ left: threadCopyContextMenu.x, top: threadCopyContextMenu.y }}
              onContextMenu={(event) => event.preventDefault()}
            >
              <button
                className="thread-copy-context-menu-item"
                type="button"
                role="menuitem"
                disabled={threadCopyContextMenu.target === "image" && !canWriteThreadImageClipboard()}
                title={
                  threadCopyContextMenu.target === "image" && !canWriteThreadImageClipboard()
                    ? "Image clipboard writes are not available."
                    : undefined
                }
                onClick={() => void handleThreadCopyContextMenuCopy(threadCopyContextMenu)}
              >
                <span className="thread-copy-context-menu-icon" aria-hidden="true">
                  <CopyIcon />
                </span>
                <span className="thread-copy-context-menu-label">
                  {threadCopyContextMenu.target === "image" ? "复制图片" : "复制"}
                </span>
              </button>
              {threadCopyContextMenu.target === "image" && canSaveThreadImageToFolder() ? (
                <button
                  className="thread-copy-context-menu-item"
                  type="button"
                  role="menuitem"
                  onClick={() => void handleThreadCopyContextMenuSaveImage(threadCopyContextMenu)}
                >
                  <span className="thread-copy-context-menu-icon" aria-hidden="true">
                    <DownloadIcon />
                  </span>
                  <span className="thread-copy-context-menu-label">保存图片</span>
                </button>
              ) : null}
              {threadCopyContextMenu.target === "text" && onAddToComposer ? (
                <button
                  className="thread-copy-context-menu-item"
                  type="button"
                  role="menuitem"
                  onClick={() => void handleThreadCopyContextMenuAddToComposer(threadCopyContextMenu)}
                >
                  <span className="thread-copy-context-menu-icon" aria-hidden="true">
                    <PlusIcon />
                  </span>
                  <span className="thread-copy-context-menu-label">加入 Composer</span>
                </button>
              ) : null}
              {threadCopyContextMenu.target === "text" &&
              threadCopyContextMenu.kind === "selection" &&
              threadCopyContextMenu.messageID &&
              onBranchChatFromSelection ? (
                <button
                  className="thread-copy-context-menu-item"
                  type="button"
                  role="menuitem"
                  onClick={() => handleThreadCopyContextMenuBranchChat(threadCopyContextMenu)}
                >
                  <span className="thread-copy-context-menu-icon" aria-hidden="true">
                    <ForkIcon />
                  </span>
                  <span className="thread-copy-context-menu-label">{t("branchChat.name")}</span>
                </button>
              ) : null}
              {threadCopyContextMenu.target === "image" && onAddImageToComposer ? (
                <button
                  className="thread-copy-context-menu-item"
                  type="button"
                  role="menuitem"
                  disabled={Boolean(addImageToComposerDisabledReason)}
                  title={addImageToComposerDisabledReason ?? undefined}
                  onClick={() => void handleThreadCopyContextMenuAddToComposer(threadCopyContextMenu)}
                >
                  <span className="thread-copy-context-menu-icon" aria-hidden="true">
                    <FileImageIcon />
                  </span>
                  <span className="thread-copy-context-menu-label">加入 Composer</span>
                </button>
              ) : null}
            </div>,
            document.body,
          )
        : null}
      {activeImagePreview
        ? createPortal(
            <ImageLightbox
              key={`${activeImagePreview.src}:${activeImagePreview.openedAt}`}
              preview={activeImagePreview}
              onClose={handleCloseImagePreview}
            />,
            document.body,
          )
        : null}
      </section>
    </ThreadInteractionContext.Provider>
  )
}
