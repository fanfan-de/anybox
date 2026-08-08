import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react"
import { createPortal } from "react-dom"
import type { PermissionDecision } from "../../../../shared/permission"
import {
  getAgentSessionBridge,
  type AgentSessionBridgeEvent,
  type AgentSessionTurnInput,
} from "../agent-session/client"
import { Composer } from "../composer/Composer"
import { buildComposerAttachment } from "../composer/attachment-utils"
import {
  compileComposerSubmission,
  createEmptyComposerDraftState,
} from "../composer/draft-state"
import {
  CheckIcon,
  CloseIcon,
  ForkIcon,
  InfoIcon,
  LocateIcon,
  MoreIcon,
} from "../icons"
import { useI18n } from "../i18n/I18nProvider"
import {
  isCompletedAssistantResponse,
  listBranchAnchorOptions,
  type RecentBranchThread,
  type SessionMessageTree,
} from "../session-message-tree"
import {
  applyAgentStreamEventToThreadMessage,
  buildSessionStreamingAssistantThreadMessage,
  buildThreadTurnsFromHistory,
  buildUserThreadMessage,
  LIVE_SESSION_ACTIVITY_PRESENTATION,
} from "../stream"
import { ThreadView } from "../thread/ThreadView"
import {
  appendMessagesToThreadTurns,
  bindPendingThreadTurnToCanonical,
  deriveActiveMessages,
} from "../thread-turn-state"
import {
  applyUserMessageDelivery,
  isCurrentOptimisticUserAttempt,
  matchesOptimisticUserAttempt,
  matchesRetiredOptimisticUserAttempt,
  readOptimisticSubmissionError,
} from "../optimistic-user-submission"
import type { CodeHighlightTheme } from "../code-theme"
import type {
  AssistantThreadMessage,
  AssistantTraceVisibility,
  BranchChatQuote,
  ComposerAttachment,
  ComposerDraftState,
  ComposerPastedImageAttachment,
  LoadedSessionHistoryMessage,
  OptimisticUserAttempt,
  PermissionRequest,
  ReasoningEffort,
  RightSidebarBranchThreadTab,
  RightSidebarTabUpdate,
  SessionContextUsage,
  SessionSummary,
  ThreadTurn,
  UserThreadMessage,
  WorkspaceGroup,
} from "../types"
import { createID } from "../utils"
import { useProjectComposer } from "../use-project-composer"
import type {
  MarkdownArtifactLinkTarget,
  MarkdownLocalFileLinkTarget,
} from "../thread-markdown"

interface OpenBranchChatInput {
  anchorStrategy?: "latest-at-send" | "selected"
  headMessageID?: string
  initialQuotes?: BranchChatQuote[]
  originMessageID: string
  phase?: "draft" | "committed"
  sessionID: string
  title?: string
}

interface BranchChatPanelProps {
  assistantTraceVisibility: AssistantTraceVisibility
  codeTheme: CodeHighlightTheme
  isActive: boolean
  messageTree: SessionMessageTree | null
  recentBranches: RecentBranchThread[]
  session: SessionSummary | null
  tab: RightSidebarBranchThreadTab
  threadPaneContext?: BranchChatThreadPaneContext | null
  workspace: WorkspaceGroup | null
  onArtifactLinkOpen?: (target: MarkdownArtifactLinkTarget) => void
  onLocalFileLinkOpen?: (target: MarkdownLocalFileLinkTarget) => void
  onOpenBranchChat: (input: OpenBranchChatInput) => void
  onLocateAnchor?: (input: {
    messageID: string
    paneID: string
    sessionID: string
  }) => void
  onUpdateTab: (tabID: string, update: RightSidebarTabUpdate) => void
}

export interface BranchChatThreadPaneContext {
  paneID: string
  sessionID: string
}

interface RuntimeEnvelope {
  eventID: string
  executionID: string | null
  payload: Record<string, unknown>
  targetKind: string | null
  turnID: string | null
  type: string
}

interface ExecutionModeEnvelope {
  executionID: string
  headMessageID: string | null
  targetKind: string
  turnID: string
}

interface BranchOptimisticSubmission extends OptimisticUserAttempt<
  Omit<AgentSessionTurnInput, "clientTurnID" | "executionID">
> {
  activeClientTurnID: string
  executionID: string
  message: UserThreadMessage
}

interface BranchToolbarPopoverPosition {
  left: number
  maxHeight: number
  top: number
  width: number
}

const BRANCH_TOOLBAR_POPOVER_GAP = 6
const BRANCH_TOOLBAR_POPOVER_VIEWPORT_PADDING = 8
const BRANCH_TOOLBAR_POPOVER_MAX_WIDTH = 360
const BRANCH_TOOLBAR_POPOVER_MIN_HEIGHT = 160

function getBranchToolbarPopoverPosition(
  trigger: HTMLElement,
  align: "start" | "end",
): BranchToolbarPopoverPosition {
  const rect = trigger.getBoundingClientRect()
  const viewportPadding = BRANCH_TOOLBAR_POPOVER_VIEWPORT_PADDING
  const width = Math.max(
    0,
    Math.min(
      BRANCH_TOOLBAR_POPOVER_MAX_WIDTH,
      window.innerWidth - viewportPadding * 2,
    ),
  )
  const preferredLeft = align === "start" ? rect.left : rect.right - width
  const left = Math.max(
    viewportPadding,
    Math.min(
      preferredLeft,
      window.innerWidth - width - viewportPadding,
    ),
  )
  const availableBelow =
    window.innerHeight - rect.bottom - BRANCH_TOOLBAR_POPOVER_GAP - viewportPadding
  const availableAbove =
    rect.top - BRANCH_TOOLBAR_POPOVER_GAP - viewportPadding
  const shouldOpenAbove =
    availableBelow < BRANCH_TOOLBAR_POPOVER_MIN_HEIGHT &&
    availableAbove > availableBelow
  const maxHeight = Math.max(
    80,
    shouldOpenAbove ? availableAbove : availableBelow,
  )
  const top = shouldOpenAbove
    ? Math.max(viewportPadding, rect.top - BRANCH_TOOLBAR_POPOVER_GAP - maxHeight)
    : rect.bottom + BRANCH_TOOLBAR_POPOVER_GAP

  return { left, maxHeight, top, width }
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function readString(value: unknown) {
  return typeof value === "string" ? value : ""
}

function readRuntimeEnvelope(event: AgentSessionBridgeEvent): RuntimeEnvelope | null {
  if (event.kind !== "stream" || event.event !== "runtime") return null
  const record = readRecord(event.data)
  const type = readString(record?.type)
  if (!record || !type) return null
  return {
    eventID: readString(record.eventID).trim() || event.id || "",
    executionID: readString(record.executionID).trim() || null,
    payload: readRecord(record.payload) ?? {},
    targetKind: readString(record.targetKind).trim() || null,
    turnID: readString(record.turnID).trim() || null,
    type,
  }
}

function readExecutionModeEnvelope(
  event: AgentSessionBridgeEvent,
): ExecutionModeEnvelope | null {
  if (event.kind !== "stream" || event.event !== "execution.mode") return null
  const record = readRecord(event.data)
  const executionID = readString(record?.executionID).trim()
  const targetKind = readString(record?.targetKind).trim()
  const turnID = readString(record?.turnID).trim()
  if (!record || !executionID || !targetKind || !turnID) return null
  return {
    executionID,
    headMessageID:
      typeof record.headMessageID === "string"
        ? record.headMessageID.trim() || null
        : null,
    targetKind,
    turnID,
  }
}

function isTerminalTurnStatus(status: string | undefined) {
  return Boolean(status && ["blocked", "cancelled", "completed", "continued_by_user", "failed"].includes(status))
}

function isTerminalRuntimeEvent(type: string) {
  return type === "turn.completed" || type === "turn.cancelled" || type === "turn.failed"
}

function parseModelSelection(value: string | null) {
  if (!value) return undefined
  const separator = value.indexOf("/")
  if (separator <= 0 || separator === value.length - 1) return undefined
  return {
    providerID: value.slice(0, separator),
    modelID: value.slice(separator + 1),
  }
}

function summarizeText(value: string, maxLength = 64) {
  const compact = value.replace(/\s+/g, " ").trim()
  if (!compact) return ""
  return compact.length > maxLength ? `${compact.slice(0, maxLength - 1)}…` : compact
}

function findOriginIndex(messages: LoadedSessionHistoryMessage[], originMessageID: string) {
  return messages.findIndex((message) => message.info.id === originMessageID)
}

function readHistoryMessageText(message: LoadedSessionHistoryMessage | undefined) {
  if (!message) return ""
  const displayText = readString(message.info.displayText).trim()
  if (displayText) return displayText
  return message.parts
    .flatMap((part) => {
      const record = readRecord(part)
      return readString(record?.type) === "text" ? [readString(record?.text)] : []
    })
    .filter(Boolean)
    .join("\n\n")
    .trim()
}

function resolveBranchTitle(messages: LoadedSessionHistoryMessage[], originIndex: number) {
  const firstUser = messages
    .slice(originIndex + 1)
    .find((message) => message.info.role === "user")
  if (!firstUser) return "Branch Chat"

  const textTitle = summarizeText(readHistoryMessageText(firstUser))
  if (textTitle && textTitle !== "Sent a non-text message.") return textTitle

  const quote = firstUser.parts.find((part) => readString(readRecord(part)?.type) === "message-quote")
  return summarizeText(readString(readRecord(quote)?.text)) || "Quoted response"
}

function getAttachmentPaths(attachments: ComposerAttachment[]) {
  return attachments.map((attachment) => attachment.path)
}

function readReasoningEffort(value: unknown): ReasoningEffort | null {
  return [
    "none",
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
  ].includes(readString(value))
    ? readString(value) as ReasoningEffort
    : null
}

function readTokenCount(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

function readBranchContextUsage(
  messages: LoadedSessionHistoryMessage[],
): SessionContextUsage | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.info.role !== "assistant") continue
    const tokens = readRecord(message.info.tokens)
    if (!tokens) continue
    const cache = readRecord(tokens.cache)
    const inputTokens = readTokenCount(tokens.input)
    const outputTokens = readTokenCount(tokens.output)
    const reasoningTokens = readTokenCount(tokens.reasoning)
    const cacheReadTokens = readTokenCount(cache?.read)
    const cacheWriteTokens = readTokenCount(cache?.write)
    if (
      inputTokens === 0 &&
      outputTokens === 0 &&
      reasoningTokens === 0 &&
      cacheReadTokens === 0 &&
      cacheWriteTokens === 0
    ) continue
    return {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      reasoningTokens,
      cacheReadTokens,
      cacheWriteTokens,
      measuredAt: Number(message.info.completed) || Number(message.info.created) || Date.now(),
    }
  }
  return null
}

function threadTurnStatusForLiveAssistant(message: AssistantThreadMessage): ThreadTurn["status"] {
  switch (message.runtime.phase) {
    case "blocked":
      return "blocked"
    case "cancelled":
      return "cancelled"
    case "completed":
      return "completed"
    case "continued_by_user":
      return "continued_by_user"
    case "failed":
      return "failed"
    default:
      return "running"
  }
}

function overlayLiveAssistantTurns(
  turns: ThreadTurn[],
  liveAssistantByTurnID: Record<string, AssistantThreadMessage>,
) {
  const retainedTurnIDs = new Set<string>()
  const nextTurns = turns.map((turn): ThreadTurn => {
    const liveAssistant = liveAssistantByTurnID[turn.turnID]
    if (!liveAssistant) return turn
    retainedTurnIDs.add(turn.turnID)

    let replacementIndex = -1
    for (let index = turn.messages.length - 1; index >= 0; index -= 1) {
      const message = turn.messages[index]
      if (message?.kind !== "assistant") continue
      if (!liveAssistant.messageID || message.messageID === liveAssistant.messageID) {
        replacementIndex = index
        break
      }
    }
    const messages = [...turn.messages]
    if (replacementIndex >= 0) {
      messages[replacementIndex] = liveAssistant
    } else {
      messages.push(liveAssistant)
    }

    return {
      ...turn,
      status: threadTurnStatusForLiveAssistant(liveAssistant),
      phase: liveAssistant.runtime.phase,
      updatedAt: liveAssistant.runtime.updatedAt,
      messages,
    }
  })

  for (const [turnID, liveAssistant] of Object.entries(liveAssistantByTurnID)) {
    if (retainedTurnIDs.has(turnID)) continue
    nextTurns.push({
      turnID,
      status: threadTurnStatusForLiveAssistant(liveAssistant),
      phase: liveAssistant.runtime.phase,
      startedAt: liveAssistant.runtime.startedAt,
      updatedAt: liveAssistant.runtime.updatedAt,
      messages: [liveAssistant],
    })
  }

  return nextTurns
}

export function overlayBranchOptimisticUserTurns(
  turns: ThreadTurn[],
  submissions: Record<string, BranchOptimisticSubmission>,
) {
  let nextTurns = turns
  for (const submission of Object.values(submissions)) {
    nextTurns = appendMessagesToThreadTurns(nextTurns, [submission.message])
    if (!submission.backendTurnID) continue
    nextTurns = bindPendingThreadTurnToCanonical(nextTurns, {
      turnID: submission.backendTurnID,
      optimisticUserMessageID: submission.message.id,
      backendUserMessageID: submission.backendUserMessageID,
    })
  }
  return nextTurns
}

function findBranchOptimisticSubmission(
  submissions: Record<string, BranchOptimisticSubmission>,
  input: {
    backendTurnID?: string | null
    clientTurnID?: string | null
    executionID?: string | null
  },
) {
  return Object.values(submissions).find((submission) =>
    matchesOptimisticUserAttempt(submission, input),
  )
}

export function BranchChatPanel({
  assistantTraceVisibility,
  codeTheme,
  isActive,
  messageTree,
  recentBranches,
  session,
  tab,
  threadPaneContext,
  workspace,
  onArtifactLinkOpen,
  onLocalFileLinkOpen,
  onOpenBranchChat,
  onLocateAnchor,
  onUpdateTab,
}: BranchChatPanelProps) {
  const { t } = useI18n()
  const bridge = useMemo(() => getAgentSessionBridge(), [])
  const threadColumnRef = useRef<HTMLDivElement | null>(null)
  const recentTriggerRef = useRef<HTMLButtonElement | null>(null)
  const recentPopoverRef = useRef<HTMLDivElement | null>(null)
  const recentListboxRef = useRef<HTMLDivElement | null>(null)
  const advancedTriggerRef = useRef<HTMLButtonElement | null>(null)
  const advancedPopoverRef = useRef<HTMLDivElement | null>(null)
  const advancedListboxRef = useRef<HTMLDivElement | null>(null)
  const recentPopoverID = useId()
  const recentListboxID = useId()
  const advancedPopoverID = useId()
  const advancedListboxID = useId()
  const initialModelSelectionRef = useRef(session?.modelSelection)
  const tabRef = useRef(tab)
  const loadVersionRef = useRef(0)
  const ownedTurnIDsRef = useRef(new Set<string>())
  const seenRuntimeEventIDsRef = useRef(new Set<string>())
  const activeClientTurnIDsRef = useRef(new Set<string>())
  const lastClientTurnIDRef = useRef<string | null>(null)
  const optimisticSubmissionsRef = useRef<Record<string, BranchOptimisticSubmission>>({})
  const didRestoreComposerPreferencesRef = useRef(tab.phase === "draft")
  const [history, setHistory] = useState<LoadedSessionHistoryMessage[]>([])
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [isLoadingHistory, setIsLoadingHistory] = useState(true)
  const [liveAssistantByTurnID, setLiveAssistantByTurnID] = useState<
    Record<string, AssistantThreadMessage>
  >({})
  const [optimisticSubmissions, setOptimisticSubmissions] = useState<
    Record<string, BranchOptimisticSubmission>
  >({})
  const [isSending, setIsSending] = useState(false)
  const [isCancelling, setIsCancelling] = useState(false)
  const [submissionMode, setSubmissionMode] = useState<"queue" | "steer">("queue")
  const [draftState, setDraftState] = useState<ComposerDraftState>(() => createEmptyComposerDraftState())
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([])
  const [quotes, setQuotes] = useState<BranchChatQuote[]>(() => tab.initialQuotes)
  const [permissionRequests, setPermissionRequests] = useState<PermissionRequest[]>([])
  const [isResolvingPermissionRequest, setIsResolvingPermissionRequest] = useState(false)
  const [permissionRequestActionError, setPermissionRequestActionError] = useState<string | null>(null)
  const [permissionRequestActionRequestID, setPermissionRequestActionRequestID] = useState<string | null>(null)
  const [sendError, setSendError] = useState<string | null>(null)
  const [isRecentOpen, setIsRecentOpen] = useState(false)
  const [activeRecentIndex, setActiveRecentIndex] = useState(0)
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false)
  const [activeAnchorIndex, setActiveAnchorIndex] = useState(0)
  const [recentPopoverPosition, setRecentPopoverPosition] = useState<BranchToolbarPopoverPosition | null>(null)
  const [advancedPopoverPosition, setAdvancedPopoverPosition] = useState<BranchToolbarPopoverPosition | null>(null)

  tabRef.current = tab

  const updateOptimisticSubmissions = useCallback((
    updater: (
      current: Record<string, BranchOptimisticSubmission>,
    ) => Record<string, BranchOptimisticSubmission>,
  ) => {
    const next = updater(optimisticSubmissionsRef.current)
    optimisticSubmissionsRef.current = next
    setOptimisticSubmissions(next)
  }, [])

  const composer = useProjectComposer({
    attachmentPaths: getAttachmentPaths(attachments),
    persistSelection: false,
    projectID: workspace?.project.id ?? null,
    sessionID: tab.sessionID,
    sessionModelSelection: initialModelSelectionRef.current,
  })

  const anchorOptions = useMemo(() => listBranchAnchorOptions(messageTree), [messageTree])
  const anchorStrategy = tab.anchorStrategy ?? "selected"
  const latestAnchorOption = anchorOptions.at(-1) ?? null
  const latestAnchorMessageIDRef = useRef<string | null>(latestAnchorOption?.messageID ?? null)
  latestAnchorMessageIDRef.current = latestAnchorOption?.messageID ?? null
  const advancedAnchorMessageID =
    tab.phase === "draft" && anchorStrategy === "latest-at-send"
      ? latestAnchorOption?.messageID ?? tab.originMessageID
      : tab.originMessageID
  const anchorNode = messageTree?.nodesByID[tab.originMessageID] ?? null
  const advancedAnchorNode = messageTree?.nodesByID[advancedAnchorMessageID] ?? null
  const historyOriginIndex = useMemo(
    () => findOriginIndex(history, tab.originMessageID),
    [history, tab.originMessageID],
  )
  const historyOrigin = historyOriginIndex >= 0 ? history[historyOriginIndex] : undefined
  const directAnchorIsValid = Boolean(
    anchorNode?.role === "assistant" &&
    anchorNode.isCompletedResponse,
  ) || Boolean(historyOrigin && isCompletedAssistantResponse(historyOrigin))
  const anchorIsValid =
    tab.phase === "committed" ||
    (anchorStrategy === "latest-at-send" ? Boolean(latestAnchorOption) : directAnchorIsValid)
  const effectiveAnchorOptions = useMemo(() => {
    if (
      (tab.phase === "draft" && anchorStrategy === "latest-at-send") ||
      !directAnchorIsValid ||
      anchorOptions.some((option) => option.messageID === tab.originMessageID)
    ) {
      return anchorOptions
    }
    return [
      {
        messageID: tab.originMessageID,
        preview: anchorNode?.preview ?? (summarizeText(readHistoryMessageText(historyOrigin)) || t("branchChat.start.selectedResponse")),
        created: anchorNode?.created ?? (Number(historyOrigin?.info.created) || Date.now()),
        promptPreview: t("branchChat.start.selectedBranchResponse"),
      },
      ...anchorOptions,
    ].sort((left, right) => left.created - right.created)
  }, [
    anchorNode,
    anchorOptions,
    anchorStrategy,
    directAnchorIsValid,
    historyOrigin,
    t,
    tab.originMessageID,
    tab.phase,
  ])
  const visibleHistory = historyOriginIndex >= 0 ? history.slice(historyOriginIndex + 1) : []
  const persistedTurns = useMemo(
    () => buildThreadTurnsFromHistory(visibleHistory),
    [visibleHistory],
  )
  const activeTurns = useMemo(
    () => overlayBranchOptimisticUserTurns(
      overlayLiveAssistantTurns(persistedTurns, liveAssistantByTurnID),
      optimisticSubmissions,
    ),
    [liveAssistantByTurnID, optimisticSubmissions, persistedTurns],
  )
  const activeMessages = useMemo(() => deriveActiveMessages(activeTurns), [activeTurns])
  const visibleTurnIDs = useMemo(
    () => new Set(visibleHistory.map((message) => message.turn?.id).filter((value): value is string => Boolean(value))),
    [visibleHistory],
  )
  const pendingPermissionRequests = useMemo(
    () => permissionRequests.filter((request) => !request.turnID || visibleTurnIDs.has(request.turnID)),
    [permissionRequests, visibleTurnIDs],
  )
  const anchorPreview =
    advancedAnchorNode?.content.trim() ||
    readHistoryMessageText(historyOrigin) ||
    t("branchChat.start.unavailable")
  const anchorTime =
    advancedAnchorNode?.completed ??
    advancedAnchorNode?.created ??
    (Number(historyOrigin?.info.created) || null)
  const selectedAnchorOption = effectiveAnchorOptions.find(
    (option) => option.messageID === advancedAnchorMessageID,
  )
  const hasSubmittableContent = Boolean(
    draftState.plainText.trim() ||
    attachments.length > 0 ||
    quotes.length > 0,
  )
  const canLocateAnchor = Boolean(
    onLocateAnchor &&
    threadPaneContext?.sessionID === tab.sessionID &&
    anchorOptions.some((option) => option.messageID === advancedAnchorMessageID),
  )
  const canSend = Boolean(bridge && session && anchorIsValid && hasSubmittableContent)
  const lastBranchUserMessage = useMemo(
    () => [...visibleHistory].reverse().find((message) => message.info.role === "user"),
    [visibleHistory],
  )
  const branchContextUsage = useMemo(
    () => readBranchContextUsage(history),
    [history],
  )

  const applyAnchor = useCallback((messageID: string) => {
    const target = tabRef.current
    if (
      target.phase !== "draft" ||
      !messageID ||
      (
        target.originMessageID === messageID &&
        (target.anchorStrategy ?? "selected") === "selected"
      )
    ) {
      return
    }
    tabRef.current = {
      ...target,
      anchorStrategy: "selected",
      originMessageID: messageID,
      headMessageID: messageID,
    }
    onUpdateTab(target.id, {
      anchorStrategy: "selected",
      originMessageID: messageID,
      headMessageID: messageID,
    })
  }, [onUpdateTab])

  useEffect(() => {
    if (
      didRestoreComposerPreferencesRef.current ||
      tab.phase !== "committed" ||
      composer.modelOptions.length === 0 ||
      !lastBranchUserMessage
    ) return

    didRestoreComposerPreferencesRef.current = true
    const model = readRecord(lastBranchUserMessage.info.model)
    const providerID = readString(model?.providerID).trim()
    const modelID = readString(model?.modelID).trim()
    const modelValue = providerID && modelID ? `${providerID}/${modelID}` : null
    const modelIsAvailable = Boolean(
      modelValue && composer.modelOptions.some((option) => option.value === modelValue),
    )
    const reasoningEffort = readReasoningEffort(lastBranchUserMessage.info.reasoningEffort)

    void (async () => {
      if (modelIsAvailable) await composer.handleModelChange(modelValue)
      if (reasoningEffort) composer.handleReasoningEffortChange(reasoningEffort)
    })()
  }, [
    composer.handleModelChange,
    composer.handleReasoningEffortChange,
    composer.modelOptions,
    lastBranchUserMessage,
    tab.phase,
  ])

  const loadPermissionRequests = useCallback(async () => {
    if (!bridge) return
    try {
      const requests = await bridge.loadPermissionRequests({ backendSessionID: tabRef.current.sessionID })
      setPermissionRequests(requests)
    } catch (error) {
      console.error("[desktop] Branch Chat permission request load failed:", error)
    }
  }, [bridge])

  const loadHistory = useCallback(async (headMessageID?: string) => {
    if (!bridge) {
      setHistoryError(t("branchChat.bridgeUnavailable"))
      setIsLoadingHistory(false)
      return
    }
    const target = tabRef.current
    const requestedHead = headMessageID ?? target.headMessageID
    const version = loadVersionRef.current + 1
    loadVersionRef.current = version
    setIsLoadingHistory(true)
    try {
      const messages = await bridge.loadHistory({
        backendSessionID: target.sessionID,
        view: "branch",
        headMessageID: requestedHead,
      })
      if (version !== loadVersionRef.current) return
      setHistory(messages)
      setHistoryError(null)

      const originIndex = findOriginIndex(messages, target.originMessageID)
      const title = resolveBranchTitle(messages, originIndex)
      if (target.phase === "committed" && title !== target.title) {
        onUpdateTab(target.id, { title })
      }

      const branchTurns = messages
        .slice(Math.max(0, originIndex + 1))
        .map((message) => message.turn)
        .filter((turn): turn is NonNullable<LoadedSessionHistoryMessage["turn"]> => Boolean(turn))
      for (const turn of branchTurns) {
        ownedTurnIDsRef.current.add(turn.id)
      }
      const runningTurn = [...branchTurns].reverse().find((turn) => !isTerminalTurnStatus(turn.status))
      if (runningTurn) {
        setIsSending(true)
        if (runningTurn.executionID && runningTurn.executionID !== target.executionID) {
          tabRef.current = {
            ...target,
            executionID: runningTurn.executionID,
          }
          onUpdateTab(target.id, { executionID: runningTurn.executionID })
        }
      } else if (activeClientTurnIDsRef.current.size === 0) {
        setIsSending(false)
      }
    } catch (error) {
      if (version !== loadVersionRef.current) return
      setHistoryError(error instanceof Error ? error.message : String(error))
    } finally {
      if (version === loadVersionRef.current) setIsLoadingHistory(false)
    }
  }, [bridge, onUpdateTab, t])

  useEffect(() => {
    void loadHistory(tab.headMessageID)
    void loadPermissionRequests()
  }, [loadHistory, loadPermissionRequests, tab.headMessageID, tab.originMessageID])

  const bindOptimisticSubmissionToTurn = useCallback((
    userThreadMessageID: string,
    backendTurnID: string,
  ) => {
    updateOptimisticSubmissions((current) => {
      const submission = current[userThreadMessageID]
      if (!submission || submission.backendTurnID === backendTurnID) return current
      return {
        ...current,
        [userThreadMessageID]: {
          ...submission,
          backendTurnID,
        },
      }
    })
  }, [updateOptimisticSubmissions])

  const failBranchOptimisticSubmission = useCallback((input: {
    activeClientTurnID?: string
    error?: string
    reason?: "cancelled"
    userThreadMessageID: string
  }) => {
    const currentSubmission = optimisticSubmissionsRef.current[input.userThreadMessageID]
    if (!currentSubmission || currentSubmission.confirmed) return false
    if (
      !isCurrentOptimisticUserAttempt(
        currentSubmission,
        input.activeClientTurnID,
      )
    ) {
      return false
    }

    updateOptimisticSubmissions((current) => {
      const submission = current[input.userThreadMessageID]
      if (!submission) return current
      return {
        ...current,
        [input.userThreadMessageID]: {
          ...submission,
          message: applyUserMessageDelivery(submission.message, {
              status: "failed",
              ...(input.error ? { error: input.error } : {}),
              ...(input.reason ? { reason: input.reason } : {}),
          }),
        },
      }
    })
    if (currentSubmission.backendTurnID) {
      setLiveAssistantByTurnID((current) => {
        if (!(currentSubmission.backendTurnID! in current)) return current
        const next = { ...current }
        delete next[currentSubmission.backendTurnID!]
        return next
      })
    }
    return true
  }, [updateOptimisticSubmissions])

  const confirmBranchOptimisticSubmission = useCallback((input: {
    backendTurnID: string
    backendUserMessageID: string
    userThreadMessageID: string
  }) => {
    updateOptimisticSubmissions((current) => {
      const submission = current[input.userThreadMessageID]
      if (!submission) return current
      const { request: _request, ...confirmedSubmission } = submission
      return {
        ...current,
        [input.userThreadMessageID]: {
          ...confirmedSubmission,
          backendTurnID: input.backendTurnID,
          backendUserMessageID: input.backendUserMessageID,
          confirmed: true,
          message: applyUserMessageDelivery(submission.message, undefined),
        },
      }
    })
  }, [updateOptimisticSubmissions])

  useEffect(() => {
    if (!bridge) return

    return bridge.onEvent((event) => {
      if (event.kind !== "stream" || event.backendSessionID !== tabRef.current.sessionID) return
      if (event.event === "error" && event.clientTurnID) {
        const optimisticSubmission = findBranchOptimisticSubmission(
          optimisticSubmissionsRef.current,
          { clientTurnID: event.clientTurnID },
        )
        if (
          optimisticSubmission &&
          failBranchOptimisticSubmission({
            activeClientTurnID: event.clientTurnID,
            error: readOptimisticSubmissionError(event.data),
            userThreadMessageID: optimisticSubmission.message.id,
          })
        ) {
          activeClientTurnIDsRef.current.delete(event.clientTurnID)
          setIsSending(activeClientTurnIDsRef.current.size > 0)
          setIsCancelling(false)
          return
        }
      }
      const executionMode = readExecutionModeEnvelope(event)
      if (executionMode) {
        if (
          Object.values(optimisticSubmissionsRef.current).some((submission) =>
            matchesRetiredOptimisticUserAttempt(submission, {
              backendTurnID: executionMode.turnID,
              clientTurnID: event.clientTurnID,
            }),
          )
        ) {
          return
        }
        const target = tabRef.current
        if (
          executionMode.targetKind === "detached-branch" &&
          executionMode.executionID === target.executionID
        ) {
          ownedTurnIDsRef.current.add(executionMode.turnID)
          const optimisticSubmission = findBranchOptimisticSubmission(
            optimisticSubmissionsRef.current,
            {
              clientTurnID: event.clientTurnID,
              executionID: executionMode.executionID,
            },
          )
          if (optimisticSubmission) {
            bindOptimisticSubmissionToTurn(
              optimisticSubmission.message.id,
              executionMode.turnID,
            )
          }
          const headMessageID = executionMode.headMessageID ?? target.headMessageID
          tabRef.current = {
            ...target,
            anchorStrategy: "selected",
            headMessageID,
            phase: "committed",
          }
          onUpdateTab(target.id, {
            anchorStrategy: "selected",
            headMessageID,
            phase: "committed",
          })
          setIsSending(true)
        }
        return
      }
      const runtime = readRuntimeEnvelope(event)
      if (!runtime) return
      if (runtime.eventID && seenRuntimeEventIDsRef.current.has(runtime.eventID)) return
      if (runtime.eventID) {
        seenRuntimeEventIDsRef.current.add(runtime.eventID)
        if (seenRuntimeEventIDsRef.current.size > 4_000) {
          const oldestEventID = seenRuntimeEventIDsRef.current.values().next().value
          if (oldestEventID) seenRuntimeEventIDsRef.current.delete(oldestEventID)
        }
      }

      const target = tabRef.current
      const runtimeExecutionID =
        runtime.executionID ??
        (readString(runtime.payload.executionID).trim() || null)
      if (
        Object.values(optimisticSubmissionsRef.current).some((submission) =>
          matchesRetiredOptimisticUserAttempt(submission, {
            backendTurnID: runtime.turnID,
            clientTurnID: event.clientTurnID,
          }),
        )
      ) {
        return
      }
      if (
        runtime.type === "turn.started" &&
        runtimeExecutionID === target.executionID &&
        (runtime.targetKind ?? readString(runtime.payload.targetKind)) === "detached-branch" &&
        runtime.turnID
      ) {
        ownedTurnIDsRef.current.add(runtime.turnID)
        const optimisticSubmission = findBranchOptimisticSubmission(
          optimisticSubmissionsRef.current,
          {
            clientTurnID: event.clientTurnID,
            executionID: runtimeExecutionID,
          },
        )
        if (optimisticSubmission) {
          bindOptimisticSubmissionToTurn(
            optimisticSubmission.message.id,
            runtime.turnID,
          )
        }
        tabRef.current = {
          ...target,
          anchorStrategy: "selected",
          phase: "committed",
        }
        onUpdateTab(target.id, {
          anchorStrategy: "selected",
          phase: "committed",
        })
        setIsSending(true)
      }

      if (!runtime.turnID || !ownedTurnIDsRef.current.has(runtime.turnID)) return

      setLiveAssistantByTurnID((current) => {
        const existing = current[runtime.turnID!] ??
          buildSessionStreamingAssistantThreadMessage(
            LIVE_SESSION_ACTIVITY_PRESENTATION,
            { backendTurnID: runtime.turnID! },
          )
        const next = applyAgentStreamEventToThreadMessage(existing, {
          id: event.id,
          event: event.event,
          data: event.data,
        })
        return next === existing
          ? current
          : {
              ...current,
              [runtime.turnID!]: next,
            }
      })

      if (runtime.type === "message.recorded") {
        const message = readRecord(runtime.payload.message)
        const messageID = readString(message?.id).trim()
        const messageRole = readString(message?.role).trim()
        if (messageID && messageRole === "user") {
          const optimisticSubmission = findBranchOptimisticSubmission(
            optimisticSubmissionsRef.current,
            {
              backendTurnID: runtime.turnID,
              clientTurnID: event.clientTurnID,
              executionID: runtimeExecutionID,
            },
          )
          if (optimisticSubmission) {
            confirmBranchOptimisticSubmission({
              backendTurnID: runtime.turnID,
              backendUserMessageID: messageID,
              userThreadMessageID: optimisticSubmission.message.id,
            })
          }
        }
        if (messageID) {
          tabRef.current = {
            ...tabRef.current,
            anchorStrategy: "selected",
            headMessageID: messageID,
            phase: "committed",
          }
          onUpdateTab(target.id, {
            anchorStrategy: "selected",
            headMessageID: messageID,
            phase: "committed",
          })
          void loadHistory(messageID)
        }
      } else if (
        runtime.type === "part.recorded" ||
        runtime.type.endsWith(".completed") ||
        runtime.type === "permission.requested" ||
        runtime.type === "permission.resolved"
      ) {
        void loadHistory()
      }

      if (runtime.type === "permission.requested" || runtime.type === "permission.resolved") {
        void loadPermissionRequests()
      }

      if (isTerminalRuntimeEvent(runtime.type)) {
        if (runtime.type === "turn.failed" || runtime.type === "turn.cancelled") {
          const optimisticSubmission = findBranchOptimisticSubmission(
            optimisticSubmissionsRef.current,
            {
              backendTurnID: runtime.turnID,
              clientTurnID: event.clientTurnID,
              executionID: runtimeExecutionID,
            },
          )
          if (optimisticSubmission) {
            failBranchOptimisticSubmission({
              activeClientTurnID: optimisticSubmission.activeClientTurnID,
              error: runtime.type === "turn.cancelled"
                ? undefined
                : readOptimisticSubmissionError(runtime.payload),
              reason: runtime.type === "turn.cancelled" ? "cancelled" : undefined,
              userThreadMessageID: optimisticSubmission.message.id,
            })
          }
        }
        setIsSending(activeClientTurnIDsRef.current.size > 0)
        setIsCancelling(false)
        void (async () => {
          await loadHistory()
          setLiveAssistantByTurnID((current) => {
            if (!(runtime.turnID! in current)) return current
            const next = { ...current }
            delete next[runtime.turnID!]
            return next
          })
        })()
      }
    })
  }, [
    bindOptimisticSubmissionToTurn,
    bridge,
    confirmBranchOptimisticSubmission,
    failBranchOptimisticSubmission,
    loadHistory,
    loadPermissionRequests,
    onUpdateTab,
  ])

  async function handleSend(draftStateOverride?: ComposerDraftState) {
    if (!bridge || !session) return
    const submittedDraft = draftStateOverride ?? draftState
    const compiled = compileComposerSubmission({
      draftState: submittedDraft,
      selectedSkillIDs: composer.selectedSkillIDs,
    })
    if (!compiled.transportText.trim() && attachments.length === 0 && quotes.length === 0) return

    const clientTurnID = createID("branch-turn")
    let target = tabRef.current
    const submittedAttachments = attachments
    const submittedQuotes = quotes
    const wasRunning = isSending || activeClientTurnIDsRef.current.size > 0
    if (
      !wasRunning &&
      target.phase === "draft" &&
      (target.anchorStrategy ?? "selected") === "latest-at-send"
    ) {
      const latestAnchorMessageID = latestAnchorMessageIDRef.current
      if (!latestAnchorMessageID) {
        setSendError(t("branchChat.start.unavailable"))
        return
      }
      if (
        target.originMessageID !== latestAnchorMessageID ||
        target.headMessageID !== latestAnchorMessageID
      ) {
        target = {
          ...target,
          originMessageID: latestAnchorMessageID,
          headMessageID: latestAnchorMessageID,
        }
        tabRef.current = target
        onUpdateTab(target.id, {
          originMessageID: latestAnchorMessageID,
          headMessageID: latestAnchorMessageID,
        })
      }
    } else if (!anchorIsValid) {
      setSendError(t("branchChat.start.invalid"))
      return
    }

    const executionID = wasRunning ? target.executionID : clientTurnID
    if (!wasRunning && executionID !== target.executionID) {
      target = {
        ...target,
        executionID,
      }
      tabRef.current = target
      onUpdateTab(target.id, { executionID })
    }
    const turnMcpServerIDs = [
      ...new Set([
        ...composer.selectedMcpServerIDs,
        ...compiled.taggedMcpServerIDs,
      ]),
    ]
    const turnToolModuleIDs = [...new Set(compiled.taggedToolModuleIDs)]
    const sendTurnRequest: Omit<AgentSessionTurnInput, "clientTurnID" | "executionID"> = {
      backendSessionID: target.sessionID,
      text: compiled.transportText || undefined,
      displayText: compiled.displayText || undefined,
      attachments: submittedAttachments.map((attachment) => ({ ...attachment })),
      quotes: submittedQuotes.map((quote) => ({ ...quote })),
      threadTarget: {
        kind: "detached-branch",
        parentMessageID: target.headMessageID,
      },
      concurrentInputMode: wasRunning ? submissionMode : undefined,
      model: parseModelSelection(composer.selectedModel),
      reasoningEffort: composer.selectedReasoningEffort ?? undefined,
      skills: [...compiled.selectedSkillIDs],
      turnMcpServerIDs,
      turnToolModuleIDs,
    }
    if (!wasRunning) {
      const optimisticMessage: UserThreadMessage = {
        ...buildUserThreadMessage({
          attachments: submittedAttachments.map((attachment) => ({
            name: attachment.name,
            path: attachment.path,
          })),
          displayText: compiled.displayText || undefined,
          fallbackText: compiled.transportText,
          messageQuotes: submittedQuotes.map((quote) => ({ ...quote })),
          turnMcpServerIDs,
          turnToolModuleIDs,
        }),
        delivery: { status: "pending" },
      }
      updateOptimisticSubmissions((current) => ({
        ...current,
        [optimisticMessage.id]: {
          activeClientTurnID: clientTurnID,
          executionID,
          message: optimisticMessage,
          request: sendTurnRequest,
          userThreadMessageID: optimisticMessage.id,
        },
      }))
    }
    activeClientTurnIDsRef.current.add(clientTurnID)
    lastClientTurnIDRef.current = clientTurnID
    setIsSending(true)
    setSendError(null)
    setDraftState(createEmptyComposerDraftState())
    setAttachments([])
    setQuotes([])

    try {
      await composer.awaitPendingModelSelection()
      await bridge.sendTurn({
        ...sendTurnRequest,
        clientTurnID,
        executionID,
      })
      const acceptedTarget = tabRef.current
      if (
        acceptedTarget.phase === "draft" &&
        (acceptedTarget.anchorStrategy ?? "selected") === "latest-at-send"
      ) {
        tabRef.current = {
          ...acceptedTarget,
          anchorStrategy: "selected",
        }
        onUpdateTab(acceptedTarget.id, {
          anchorStrategy: "selected",
        })
      }
      activeClientTurnIDsRef.current.delete(clientTurnID)
      if (activeClientTurnIDsRef.current.size === 0) setIsSending(false)
      await loadHistory()
    } catch (error) {
      activeClientTurnIDsRef.current.delete(clientTurnID)
      if (activeClientTurnIDsRef.current.size === 0) setIsSending(false)
      const optimisticSubmission = findBranchOptimisticSubmission(
        optimisticSubmissionsRef.current,
        { clientTurnID },
      )
      if (optimisticSubmission) {
        failBranchOptimisticSubmission({
          activeClientTurnID: clientTurnID,
          error: error instanceof Error ? error.message : String(error),
          userThreadMessageID: optimisticSubmission.message.id,
        })
      } else {
        setSendError(error instanceof Error ? error.message : String(error))
        setDraftState((current) => current.plainText.trim() ? current : submittedDraft)
        setAttachments((current) => current.length > 0 ? current : submittedAttachments)
        setQuotes((current) => current.length > 0 ? current : submittedQuotes)
      }
    }
  }

  async function handleRetryUserMessage(userThreadMessageID: string) {
    if (!bridge) return
    const submission = optimisticSubmissionsRef.current[userThreadMessageID]
    if (
      !submission?.request ||
      submission.confirmed ||
      submission.message.delivery?.status !== "failed"
    ) {
      return
    }

    const clientTurnID = createID("branch-turn")
    const executionID = clientTurnID
    const target = tabRef.current
    tabRef.current = {
      ...target,
      executionID,
    }
    onUpdateTab(target.id, { executionID })

    updateOptimisticSubmissions((current) => {
      const currentSubmission = current[userThreadMessageID]
      if (!currentSubmission?.request) return current
      const {
        backendTurnID: _backendTurnID,
        backendUserMessageID: _backendUserMessageID,
        confirmed: _confirmed,
        ...retrySubmission
      } = currentSubmission
      const retiredClientTurnIDs = [
        ...new Set([
          ...(currentSubmission.retiredClientTurnIDs ?? []),
          currentSubmission.activeClientTurnID,
        ]),
      ]
      const retiredBackendTurnIDs = [
        ...new Set([
          ...(currentSubmission.retiredBackendTurnIDs ?? []),
          ...(currentSubmission.backendTurnID
            ? [currentSubmission.backendTurnID]
            : []),
        ]),
      ]
      return {
        ...current,
        [userThreadMessageID]: {
          ...retrySubmission,
          activeClientTurnID: clientTurnID,
          executionID,
          ...(retiredBackendTurnIDs.length > 0
            ? { retiredBackendTurnIDs }
            : {}),
          retiredClientTurnIDs,
          message: {
            ...applyUserMessageDelivery(
              currentSubmission.message,
              { status: "pending" },
            ),
          },
        },
      }
    })
    activeClientTurnIDsRef.current.add(clientTurnID)
    lastClientTurnIDRef.current = clientTurnID
    setIsSending(true)
    setSendError(null)

    try {
      await bridge.sendTurn({
        ...submission.request,
        clientTurnID,
        executionID,
      })
      activeClientTurnIDsRef.current.delete(clientTurnID)
      if (activeClientTurnIDsRef.current.size === 0) setIsSending(false)
      await loadHistory()
    } catch (error) {
      activeClientTurnIDsRef.current.delete(clientTurnID)
      if (activeClientTurnIDsRef.current.size === 0) setIsSending(false)
      failBranchOptimisticSubmission({
        activeClientTurnID: clientTurnID,
        error: error instanceof Error ? error.message : String(error),
        userThreadMessageID,
      })
    }
  }

  async function handleCancelSend() {
    if (!bridge || isCancelling) return
    setIsCancelling(true)
    setSendError(null)
    try {
      const target = tabRef.current
      const clientTurnID = lastClientTurnIDRef.current
      const result = await bridge.interrupt({
        backendSessionID: target.sessionID,
        clientTurnID: clientTurnID ?? undefined,
        executionID: target.executionID,
        reason: "user-interrupt",
      })
      if (clientTurnID && (result.backendCancelled || result.localRequestsAborted > 0)) {
        const optimisticSubmission = findBranchOptimisticSubmission(
          optimisticSubmissionsRef.current,
          { clientTurnID },
        )
        if (optimisticSubmission) {
          failBranchOptimisticSubmission({
            activeClientTurnID: clientTurnID,
            reason: "cancelled",
            userThreadMessageID: optimisticSubmission.message.id,
          })
        }
        activeClientTurnIDsRef.current.delete(clientTurnID)
        setIsSending(activeClientTurnIDsRef.current.size > 0)
        setIsCancelling(false)
      } else if (!result.backendCancelled) {
        setIsCancelling(false)
      }
    } catch (error) {
      setSendError(error instanceof Error ? error.message : String(error))
      setIsCancelling(false)
    }
  }

  async function handlePickAttachments() {
    if (composer.attachmentDisabledReason || !window.desktop?.pickComposerAttachments) return
    try {
      const paths = await window.desktop.pickComposerAttachments({
        allowImage: composer.attachmentCapabilities.image,
        allowPdf: composer.attachmentCapabilities.pdf,
      })
      setAttachments((current) => {
        const byPath = new Map(current.map((attachment) => [attachment.path, attachment]))
        for (const path of paths ?? []) byPath.set(path, buildComposerAttachment(path))
        return [...byPath.values()]
      })
    } catch (error) {
      setSendError(error instanceof Error ? error.message : String(error))
    }
  }

  async function handlePasteImageAttachments(
    images: ComposerPastedImageAttachment[],
  ) {
    if (!composer.attachmentCapabilities.image || !window.desktop?.saveComposerPastedImages) return
    try {
      const paths = await window.desktop.saveComposerPastedImages({ images })
      setAttachments((current) => {
        const byPath = new Map(current.map((attachment) => [attachment.path, attachment]))
        for (const path of paths) byPath.set(path, buildComposerAttachment(path))
        return [...byPath.values()]
      })
    } catch (error) {
      setSendError(error instanceof Error ? error.message : String(error))
    }
  }

  async function handlePermissionResponse(input: {
    request: PermissionRequest
    decision: PermissionDecision
    note?: string
  }) {
    if (!bridge || isResolvingPermissionRequest) return
    setIsResolvingPermissionRequest(true)
    setPermissionRequestActionRequestID(input.request.id)
    setPermissionRequestActionError(null)
    try {
      await bridge.respondPermissionRequest({
        requestID: input.request.id,
        decision: input.decision,
        note: input.note,
        resume: true,
      })
      await loadPermissionRequests()
      await loadHistory()
    } catch (error) {
      setPermissionRequestActionError(error instanceof Error ? error.message : String(error))
    } finally {
      setIsResolvingPermissionRequest(false)
      setPermissionRequestActionRequestID(null)
    }
  }

  function locateAnchorInMainThread(messageID: string) {
    if (
      !onLocateAnchor ||
      !threadPaneContext ||
      threadPaneContext.sessionID !== tab.sessionID ||
      !anchorOptions.some((option) => option.messageID === messageID)
    ) {
      return
    }
    onLocateAnchor({
      messageID,
      paneID: threadPaneContext.paneID,
      sessionID: tab.sessionID,
    })
  }

  function handleLocateAnchor() {
    if (!canLocateAnchor) return
    locateAnchorInMainThread(advancedAnchorMessageID)
  }

  function handleDraftStateChange(nextDraftState: ComposerDraftState) {
    setDraftState(nextDraftState)
  }

  const selectedRecentIndex = recentBranches.findIndex(
    (branch) => branch.headMessageID === tab.headMessageID,
  )
  const selectedAnchorIndex = effectiveAnchorOptions.findIndex(
    (option) => option.messageID === advancedAnchorMessageID,
  )
  const canChooseAnchor = tab.phase === "draft" && !isSending

  function closeRecentPopover({ restoreFocus = true }: { restoreFocus?: boolean } = {}) {
    setIsRecentOpen(false)
    if (restoreFocus) recentTriggerRef.current?.focus()
  }

  function openRecentPopover(
    preferredIndex = selectedRecentIndex >= 0 ? selectedRecentIndex : 0,
  ) {
    if (recentBranches.length === 0) return
    setIsAdvancedOpen(false)
    setActiveRecentIndex(Math.max(0, preferredIndex))
    setIsRecentOpen(true)
  }

  function commitRecentBranch(index: number) {
    const branch = recentBranches[index]
    if (!branch) return
    setActiveRecentIndex(index)
    closeRecentPopover({ restoreFocus: false })
    onOpenBranchChat({
      anchorStrategy: "selected",
      sessionID: branch.sessionID,
      originMessageID: branch.originMessageID,
      headMessageID: branch.headMessageID,
      phase: "committed",
      title: branch.title,
    })
  }

  function handleRecentTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return
    event.preventDefault()
    const fallbackIndex = event.key === "ArrowUp"
      ? Math.max(0, recentBranches.length - 1)
      : 0
    openRecentPopover(selectedRecentIndex >= 0 ? selectedRecentIndex : fallbackIndex)
  }

  function handleRecentPopoverKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault()
      event.stopPropagation()
      closeRecentPopover()
      return
    }
    if (recentBranches.length === 0) return

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault()
      const direction = event.key === "ArrowDown" ? 1 : -1
      setActiveRecentIndex((current) =>
        (current + direction + recentBranches.length) % recentBranches.length)
      return
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault()
      setActiveRecentIndex(event.key === "Home" ? 0 : recentBranches.length - 1)
      return
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      commitRecentBranch(activeRecentIndex)
    }
  }

  function closeAdvancedPopover({ restoreFocus = true }: { restoreFocus?: boolean } = {}) {
    setIsAdvancedOpen(false)
    if (restoreFocus) advancedTriggerRef.current?.focus()
  }

  function openAdvancedPopover(preferredIndex = selectedAnchorIndex >= 0 ? selectedAnchorIndex : 0) {
    setIsRecentOpen(false)
    setActiveAnchorIndex(Math.max(0, preferredIndex))
    setIsAdvancedOpen(true)
  }

  function commitAnchorOption(index: number) {
    if (!canChooseAnchor) return
    const option = effectiveAnchorOptions[index]
    if (!option) return
    setActiveAnchorIndex(index)
    applyAnchor(option.messageID)
    locateAnchorInMainThread(option.messageID)
  }

  function handleAdvancedTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return
    event.preventDefault()
    const fallbackIndex = event.key === "ArrowUp"
      ? Math.max(0, effectiveAnchorOptions.length - 1)
      : 0
    openAdvancedPopover(selectedAnchorIndex >= 0 ? selectedAnchorIndex : fallbackIndex)
  }

  function handleAdvancedPopoverKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault()
      event.stopPropagation()
      closeAdvancedPopover()
      return
    }
    if (!canChooseAnchor || effectiveAnchorOptions.length === 0) return

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault()
      const direction = event.key === "ArrowDown" ? 1 : -1
      setActiveAnchorIndex((current) =>
        (current + direction + effectiveAnchorOptions.length) % effectiveAnchorOptions.length)
      return
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault()
      setActiveAnchorIndex(event.key === "Home" ? 0 : effectiveAnchorOptions.length - 1)
      return
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      commitAnchorOption(activeAnchorIndex)
    }
  }

  useLayoutEffect(() => {
    if (!isRecentOpen) {
      setRecentPopoverPosition(null)
      return
    }

    const trigger = recentTriggerRef.current
    if (!trigger) return
    setRecentPopoverPosition(getBranchToolbarPopoverPosition(trigger, "start"))
  }, [isRecentOpen])

  useLayoutEffect(() => {
    if (!isRecentOpen || !recentPopoverPosition) return
    const focusTarget = recentListboxRef.current ?? recentPopoverRef.current
    focusTarget?.focus()
  }, [isRecentOpen, recentPopoverPosition])

  useLayoutEffect(() => {
    if (!isRecentOpen || !recentPopoverPosition) return
    const activeOption = recentListboxRef.current
      ?.querySelectorAll<HTMLElement>('[role="option"]')
      .item(activeRecentIndex)
    activeOption?.scrollIntoView?.({ block: "nearest", inline: "nearest" })
  }, [activeRecentIndex, isRecentOpen, recentPopoverPosition])

  useEffect(() => {
    if (!isRecentOpen) return

    function updatePosition() {
      const trigger = recentTriggerRef.current
      if (trigger) {
        setRecentPopoverPosition(getBranchToolbarPopoverPosition(trigger, "start"))
      }
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target
      if (!(target instanceof Node)) return
      if (
        recentTriggerRef.current?.contains(target) ||
        recentPopoverRef.current?.contains(target)
      ) {
        return
      }
      closeRecentPopover({ restoreFocus: false })
    }

    window.addEventListener("resize", updatePosition)
    window.addEventListener("scroll", updatePosition, true)
    document.addEventListener("pointerdown", handlePointerDown)
    return () => {
      window.removeEventListener("resize", updatePosition)
      window.removeEventListener("scroll", updatePosition, true)
      document.removeEventListener("pointerdown", handlePointerDown)
    }
  }, [isRecentOpen])

  useEffect(() => {
    if (!isRecentOpen) return
    if (recentBranches.length === 0) {
      setIsRecentOpen(false)
      return
    }
    setActiveRecentIndex((current) => Math.min(current, recentBranches.length - 1))
  }, [isRecentOpen, recentBranches.length])

  useLayoutEffect(() => {
    if (!isAdvancedOpen) {
      setAdvancedPopoverPosition(null)
      return
    }

    const trigger = advancedTriggerRef.current
    if (!trigger) return
    setAdvancedPopoverPosition(getBranchToolbarPopoverPosition(trigger, "end"))
  }, [isAdvancedOpen])

  useLayoutEffect(() => {
    if (!isAdvancedOpen || !advancedPopoverPosition) return
    if (canChooseAnchor) {
      (advancedListboxRef.current ?? advancedPopoverRef.current)?.focus()
    } else {
      advancedPopoverRef.current?.focus()
    }
  }, [advancedPopoverPosition, canChooseAnchor, isAdvancedOpen])

  useLayoutEffect(() => {
    if (!isAdvancedOpen || !advancedPopoverPosition || !canChooseAnchor) return
    const activeOption = advancedListboxRef.current
      ?.querySelectorAll<HTMLElement>('[role="option"]')
      .item(activeAnchorIndex)
    activeOption?.scrollIntoView?.({ block: "nearest", inline: "nearest" })
  }, [
    activeAnchorIndex,
    advancedPopoverPosition,
    canChooseAnchor,
    isAdvancedOpen,
  ])

  useEffect(() => {
    if (!isAdvancedOpen) return

    function updatePosition() {
      const trigger = advancedTriggerRef.current
      if (trigger) {
        setAdvancedPopoverPosition(getBranchToolbarPopoverPosition(trigger, "end"))
      }
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target
      if (!(target instanceof Node)) return
      if (
        advancedTriggerRef.current?.contains(target) ||
        advancedPopoverRef.current?.contains(target)
      ) {
        return
      }
      closeAdvancedPopover({ restoreFocus: false })
    }

    window.addEventListener("resize", updatePosition)
    window.addEventListener("scroll", updatePosition, true)
    document.addEventListener("pointerdown", handlePointerDown)
    return () => {
      window.removeEventListener("resize", updatePosition)
      window.removeEventListener("scroll", updatePosition, true)
      document.removeEventListener("pointerdown", handlePointerDown)
    }
  }, [isAdvancedOpen])

  useEffect(() => {
    if (isActive) return
    setIsRecentOpen(false)
    setIsAdvancedOpen(false)
  }, [isActive])

  useEffect(() => {
    if (!isAdvancedOpen) return
    const nextIndex = effectiveAnchorOptions.findIndex(
      (option) => option.messageID === advancedAnchorMessageID,
    )
    setActiveAnchorIndex(nextIndex >= 0 ? nextIndex : 0)
  }, [advancedAnchorMessageID, effectiveAnchorOptions, isAdvancedOpen])

  const recentPopover =
    isRecentOpen &&
    recentPopoverPosition &&
    typeof document !== "undefined"
      ? createPortal(
          <div
            ref={recentPopoverRef}
            id={recentPopoverID}
            className="branch-chat-recent-popover"
            role="dialog"
            aria-label={t("branchChat.recent.region")}
            tabIndex={-1}
            style={{
              left: recentPopoverPosition.left,
              maxHeight: recentPopoverPosition.maxHeight,
              top: recentPopoverPosition.top,
              width: recentPopoverPosition.width,
            }}
            onKeyDown={handleRecentPopoverKeyDown}
          >
            <header className="branch-chat-recent-popover-header">
              <strong>{t("branchChat.recent.title")}</strong>
              <span>{t("branchChat.recent.description")}</span>
            </header>
            <div
              ref={recentListboxRef}
              id={recentListboxID}
              className="branch-chat-recent-options"
              role="listbox"
              aria-label={t("branchChat.recent.region")}
              aria-activedescendant={`${recentListboxID}-option-${String(activeRecentIndex)}`}
              tabIndex={0}
            >
              {recentBranches.map((branch, index) => {
                const isSelected = branch.headMessageID === tab.headMessageID
                const isActiveOption = index === activeRecentIndex
                return (
                  <button
                    key={branch.headMessageID}
                    id={`${recentListboxID}-option-${String(index)}`}
                    type="button"
                    className={[
                      "branch-chat-recent-option",
                      isSelected ? "is-selected" : "",
                      isActiveOption ? "is-active" : "",
                    ].filter(Boolean).join(" ")}
                    role="option"
                    aria-selected={isSelected}
                    tabIndex={-1}
                    onClick={() => commitRecentBranch(index)}
                    onMouseEnter={() => setActiveRecentIndex(index)}
                  >
                    <span className="branch-chat-recent-option-main">
                      <strong>{branch.title}</strong>
                      <span>{branch.leafPreview}</span>
                    </span>
                    <span className="branch-chat-recent-option-meta">
                      <span>{branch.status.replaceAll("_", " ")}</span>
                      <time>{new Date(branch.updatedAt).toLocaleString()}</time>
                    </span>
                  </button>
                )
              })}
            </div>
          </div>,
          document.body,
        )
      : null

  const advancedPopover =
    isAdvancedOpen &&
    advancedPopoverPosition &&
    typeof document !== "undefined"
      ? createPortal(
          <div
            ref={advancedPopoverRef}
            id={advancedPopoverID}
            className="branch-chat-start-popover"
            role="dialog"
            aria-label={t("branchChat.start.dialog")}
            tabIndex={-1}
            style={{
              left: advancedPopoverPosition.left,
              maxHeight: advancedPopoverPosition.maxHeight,
              top: advancedPopoverPosition.top,
              width: advancedPopoverPosition.width,
            }}
            onKeyDown={handleAdvancedPopoverKeyDown}
          >
            <header className="branch-chat-start-popover-header">
              <strong>{t("branchChat.start.title")}</strong>
              <span>{canChooseAnchor
                ? t("branchChat.start.description")
                : t("branchChat.start.readOnly")}</span>
            </header>
            {canChooseAnchor ? (
              effectiveAnchorOptions.length > 0 ? (
                <div
                  ref={advancedListboxRef}
                  id={advancedListboxID}
                  className="branch-chat-start-options"
                  role="listbox"
                  aria-label={t("branchChat.start.choose")}
                  aria-activedescendant={`${advancedListboxID}-option-${String(activeAnchorIndex)}`}
                  tabIndex={0}
                >
                  {effectiveAnchorOptions.map((option, index) => {
                    const isSelected = option.messageID === advancedAnchorMessageID
                    const isActive = index === activeAnchorIndex
                    return (
                      <button
                        key={option.messageID}
                        id={`${advancedListboxID}-option-${String(index)}`}
                        type="button"
                        className={[
                          "branch-chat-start-option",
                          isSelected ? "is-selected" : "",
                          isActive ? "is-active" : "",
                        ].filter(Boolean).join(" ")}
                        role="option"
                        aria-selected={isSelected}
                        tabIndex={-1}
                        onClick={() => commitAnchorOption(index)}
                        onMouseEnter={() => setActiveAnchorIndex(index)}
                      >
                        <span className="branch-chat-start-option-copy">
                          <strong>{option.promptPreview}</strong>
                          <span>{option.preview}</span>
                        </span>
                        <span className="branch-chat-start-option-mark" aria-hidden="true">
                          {isSelected ? <CheckIcon /> : null}
                        </span>
                      </button>
                    )
                  })}
                </div>
              ) : (
                <p className="branch-chat-start-empty">{t("branchChat.start.unavailable")}</p>
              )
            ) : (
              <div className="branch-chat-start-read-only">
                <strong>{selectedAnchorOption?.promptPreview ?? t("branchChat.start.selectedResponse")}</strong>
                <p>{selectedAnchorOption?.preview ?? anchorPreview}</p>
                {anchorTime ? <time>{new Date(anchorTime).toLocaleString()}</time> : null}
              </div>
            )}
            <footer className="branch-chat-start-popover-footer">
              <button
                type="button"
                className="branch-chat-start-locate"
                disabled={!canLocateAnchor}
                onClick={handleLocateAnchor}
              >
                <LocateIcon />
                <span>{t("branchChat.start.locate")}</span>
              </button>
            </footer>
          </div>,
          document.body,
        )
      : null

  return (
    <section
      className="branch-chat-panel"
      aria-label={t("branchChat.name")}
      hidden={!isActive}
    >
      <div
        className="branch-chat-toolbar"
        role="toolbar"
        aria-label={t("branchChat.advanced.toolbar")}
      >
        <button
          ref={recentTriggerRef}
          type="button"
          className={isRecentOpen
            ? "branch-chat-recent-trigger is-open"
            : "branch-chat-recent-trigger"}
          aria-controls={isRecentOpen ? recentPopoverID : undefined}
          aria-expanded={isRecentOpen}
          aria-haspopup="dialog"
          aria-label={t("branchChat.recent.open")}
          title={recentBranches.length > 0
            ? t("branchChat.recent.open")
            : t("branchChat.recent.empty")}
          disabled={recentBranches.length === 0}
          onClick={() => {
            if (isRecentOpen) {
              closeRecentPopover({ restoreFocus: false })
            } else {
              openRecentPopover()
            }
          }}
          onKeyDown={handleRecentTriggerKeyDown}
        >
          <ForkIcon />
          <span>{t("branchChat.recent.title")}</span>
        </button>
        <div className="branch-chat-toolbar-actions">
          <button
            ref={advancedTriggerRef}
            type="button"
            className={isAdvancedOpen
              ? "branch-chat-advanced-trigger is-open"
              : "branch-chat-advanced-trigger"}
            aria-controls={isAdvancedOpen ? advancedPopoverID : undefined}
            aria-expanded={isAdvancedOpen}
            aria-haspopup="dialog"
            aria-label={t("branchChat.advanced.open")}
            title={t("branchChat.advanced.open")}
            onClick={() => {
              if (isAdvancedOpen) {
                closeAdvancedPopover({ restoreFocus: false })
              } else {
                openAdvancedPopover()
              }
            }}
            onKeyDown={handleAdvancedTriggerKeyDown}
          >
            <MoreIcon />
          </button>
          <span
            className="branch-chat-read-only-badge"
            title={t("branchChat.readOnlyTitle")}
          >
            <InfoIcon />
            <span>{t("branchChat.readOnly")}</span>
          </span>
        </div>
      </div>
      {recentPopover}
      {advancedPopover}

      <div className="branch-chat-thread">
        {historyError ? <p className="branch-chat-inline-error" role="alert">{historyError}</p> : null}
        {isLoadingHistory && visibleHistory.length === 0 ? (
          <p className="branch-chat-loading" role="status">{t("branchChat.loading")}</p>
        ) : (
          <ThreadView
            activeSession={session}
            activeMessages={activeMessages}
            activeTurns={activeTurns}
            assistantTraceVisibility={assistantTraceVisibility}
            codeTheme={codeTheme}
            isResolvingPermissionRequest={isResolvingPermissionRequest}
            isSessionRunning={isSending}
            isThreadVisible={isActive}
            messageTree={messageTree}
            pendingPermissionRequests={pendingPermissionRequests}
            permissionRequestActionError={permissionRequestActionError}
            permissionRequestActionRequestID={permissionRequestActionRequestID}
            scrollStateKey={`branch-chat:${tab.id}`}
            showTurnNavigator={false}
            threadColumnRef={threadColumnRef}
            workspaceDirectory={workspace?.directory ?? null}
            onArtifactLinkOpen={onArtifactLinkOpen}
            onLocalFileLinkOpen={onLocalFileLinkOpen}
            onRetryUserMessage={handleRetryUserMessage}
            onForkFromMessage={(messageID) => onOpenBranchChat({
              anchorStrategy: "selected",
              sessionID: tab.sessionID,
              originMessageID: messageID,
            })}
            onBranchChatFromSelection={({ messageID, text }) => onOpenBranchChat({
              anchorStrategy: "selected",
              sessionID: tab.sessionID,
              originMessageID: messageID,
              initialQuotes: [{ sourceMessageID: messageID, text }],
            })}
            onAskUserQuestionAnswer={async (answer) => {
              if (!bridge || !answer.questionID) return
              await bridge.answerQuestion({
                backendSessionID: tab.sessionID,
                questionID: answer.questionID,
                selectedOptions: answer.selectedOptions,
                freeformText: answer.freeformText,
              })
              await loadHistory()
            }}
            onPermissionRequestResponse={({ request, decision, note }) =>
              handlePermissionResponse({ request, decision, note })}
          />
        )}
      </div>

      <div className="branch-chat-composer-stack">
        {quotes.length > 0 ? (
          <div className="branch-chat-quote-list" aria-label={t("branchChat.quote.region")}>
            {quotes.map((quote, index) => (
              <article key={`${quote.sourceMessageID}:${index}`} className="branch-chat-quote-card">
                <div>
                  <span>{t("branchChat.quote.label")}</span>
                  <p>{quote.text}</p>
                </div>
                <button
                  type="button"
                  aria-label={t("branchChat.quote.remove")}
                  onClick={() => setQuotes((current) => current.filter((_, quoteIndex) => quoteIndex !== index))}
                >
                  <CloseIcon />
                </button>
              </article>
            ))}
          </div>
        ) : null}
        {isSending ? (
          <div className="branch-chat-concurrent-mode" role="group" aria-label={t("branchChat.concurrent.region")}>
            <span>{t("branchChat.concurrent.next")}</span>
            <button
              type="button"
              className={submissionMode === "queue" ? "is-active" : undefined}
              aria-pressed={submissionMode === "queue"}
              onClick={() => setSubmissionMode("queue")}
            >
              {t("branchChat.concurrent.queue")}
            </button>
            <button
              type="button"
              className={submissionMode === "steer" ? "is-active" : undefined}
              aria-pressed={submissionMode === "steer"}
              onClick={() => setSubmissionMode("steer")}
            >
              {t("branchChat.concurrent.steer")}
            </button>
          </div>
        ) : null}
        {sendError ? <p className="branch-chat-inline-error" role="alert">{sendError}</p> : null}
        <Composer
          attachments={attachments}
          attachmentButtonTitle={composer.attachmentButtonTitle}
          attachmentDisabledReason={composer.attachmentDisabledReason}
          attachmentError={composer.attachmentError}
          canPasteImageAttachments={composer.attachmentCapabilities.image && composer.attachmentDisabledReason === null}
          canSend={canSend}
          contextUsage={branchContextUsage}
          contextWindow={composer.contextWindow}
          draftState={draftState}
          hasPendingPermissionRequests={pendingPermissionRequests.length > 0 || isResolvingPermissionRequest}
          hasSupplementalSubmitContent={quotes.length > 0}
          isCancelling={isCancelling}
          isInterruptible={isSending}
          isSending={isSending}
          mcpOptions={composer.mcpOptions}
          modelOptions={composer.modelOptions}
          onCancelSend={handleCancelSend}
          onDraftStateChange={handleDraftStateChange}
          onModelChange={composer.handleModelChange}
          onPasteImageAttachments={handlePasteImageAttachments}
          onPickAttachments={handlePickAttachments}
          onPluginToggle={composer.handlePluginToggle}
          onReasoningEffortChange={composer.handleReasoningEffortChange}
          onRemoveAttachment={(path) => setAttachments((current) => current.filter((attachment) => attachment.path !== path))}
          onSend={handleSend}
          pluginOptions={composer.pluginOptions}
          reasoningEffortOptions={composer.reasoningEffortOptions}
          selectedMcpServerIDs={composer.selectedMcpServerIDs}
          selectedModel={composer.selectedModel}
          selectedModelLabel={composer.selectedModelLabel}
          selectedPluginIDs={composer.selectedPluginIDs}
          selectedReasoningEffort={composer.selectedReasoningEffort}
          selectedReasoningEffortLabel={composer.selectedReasoningEffortLabel}
          selectedSkillIDs={composer.selectedSkillIDs}
          showModelSelector
          showProjectTagCommands
          skillOptions={composer.skillOptions}
          unsupportedAttachmentPaths={composer.unsupportedAttachmentPaths}
          workspaceDirectory={workspace?.directory ?? null}
          placeholder={t("branchChat.placeholder")}
        />
      </div>
    </section>
  )
}

export type { OpenBranchChatInput }
