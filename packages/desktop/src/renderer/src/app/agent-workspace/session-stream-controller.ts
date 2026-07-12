import { startTransition, useEffect, useEffectEvent, useRef, useState, type MutableRefObject } from "react"
import { getAgentSessionBridge, type AgentSessionBridgeEvent } from "../agent-session/client"
import { AgentSessionEventRouter } from "../agent-session/event-router"
import {
  appendMessagesToThreadTurns,
  buildThreadTurnsFromMessages,
  deriveActiveMessages,
  ensureConversationTurnSessions,
  ensureThreadTurn,
  insertUserMessageIntoTurns,
  mapMessageInTurns,
  removeMessageFromTurns,
} from "../thread-turn-state"
import {
  applyAgentStreamEventToThreadMessage,
  buildSessionStreamingAssistantThreadMessage,
  buildThreadMessagesFromHistory,
  LIVE_SESSION_ACTIVITY_PRESENTATION,
  RECONNECTING_SESSION_STREAM_PRESENTATION,
  type SessionStreamingPresentation,
} from "../stream"
import type {
  AgentSessionStreamIPCEvent,
  AgentSessionExecutionMode,
  AgentStreamIPCEvent,
  AssistantTraceItem,
  AssistantThreadMessage,
  ConversationTurnMap,
  LoadedSessionHistoryMessage,
  PendingAgentStream,
  PendingConversationInput,
  PermissionRequest,
  SessionContextUsage,
  SessionDiffState,
  SessionDiffSummary,
  SessionRuntimeDebugSnapshot,
  SessionRuntimeDebugState,
  SessionTaskListView,
  ThreadMessage,
  UserThreadMessage,
  WorkspaceGroup,
} from "../types"
import { buildSessionMessageTree, type SessionMessageTree } from "../session-message-tree"
import {
  pendingConversationInputToUserThreadMessage,
  removePendingConversationInput,
  updatePendingConversationInput,
} from "../pending-conversation-inputs"
import { mergeUserMessagePresentationState, persistUserMessages, readPersistedUserMessages } from "../user-message-presentation"
import { findSession } from "../workspace"
import {
  loadPendingPermissionRequestsForSession as loadPendingPermissionRequestsForSessionService,
} from "./permission-requests-service"
import {
  clearRuntimeDebugRefreshTimer as clearRuntimeDebugRefreshTimerService,
  clearSessionDiffRefreshTimer as clearSessionDiffRefreshTimerService,
  loadSessionTasksForSession as loadSessionTasksForSessionService,
  loadSessionDiffForSession as loadSessionDiffForSessionService,
  loadSessionRuntimeDebugForSession as loadSessionRuntimeDebugForSessionService,
  scheduleRuntimeDebugRefresh as scheduleRuntimeDebugRefreshService,
  scheduleSessionDiffRefreshForSession as scheduleSessionDiffRefreshForSessionService,
  sessionTaskListsAreEquivalent as sessionTaskListsAreEquivalentService,
  useOpenSessionReviewPreloadEffects,
  useReviewRefreshCleanupEffect,
} from "./review-diff-runtime-hooks"
import type {
  SessionDataLoadOptions,
  SessionDataLoadCache,
} from "./session-data-load-cache"
import { ensureSessionDataLoad } from "./session-data-load-cache"
import { useAgentSessionStreamEffects } from "./session-stream-hooks"
import { refreshWorkspaceFromDirectory as refreshWorkspaceFromDirectoryService } from "./workspace-loading-hooks"
import type { ConversationStoreApi } from "./conversation-store"
import type { WorkspaceStateUpdater } from "./workspace-store"
import {
  queueRendererStreamFlush,
  type RendererFrameTaskCancel,
} from "../renderer-frame-coordinator"

const STREAM_DELTA_FLUSH_INTERVAL_MS = 1_000
const STREAM_DELTA_EVENTS_PER_FRAME = 240
const STREAM_DELTA_PENDING_EVENT_LIMIT = 1_600
const STREAM_DELTA_BACKPRESSURE_LOG_INTERVAL_MS = 5_000
export const SESSION_STREAM_RECONNECT_REPLAY_WINDOW_MS = 30_000
const EXTERNAL_TURN_HISTORY_REFRESH_RETRY_MS = 500
export const STEER_INPUT_CONSUMED_STATE_REASON = "Steer input consumed."

type StreamEventUpdateTarget = {
  assistantThreadMessageID: string
  sessionID: string
  identity?: Partial<Pick<AssistantThreadMessage, "backendTurnID" | "segmentID" | "messageID" | "llmCallID">>
}

type PendingStreamDeltaUpdate = {
  event: AgentSessionStreamIPCEvent | AgentStreamIPCEvent
  target: StreamEventUpdateTarget
}

export interface SessionStreamReconnectReplayWindow {
  expiresAt: number
  turnID?: string
}

export type SessionStreamReconnectReplayWindows = Record<string, SessionStreamReconnectReplayWindow>

type ExecutionModeEventPayload = {
  sessionID: string
  turnID: string
  mode: AgentSessionExecutionMode
}

export function noteSessionStreamSubscriptionStateForPresentation(
  windows: SessionStreamReconnectReplayWindows,
  event: Extract<AgentSessionBridgeEvent, { kind: "subscription-state" }>,
  now = Date.now(),
) {
  if (event.state === "reconnecting") {
    windows[event.backendSessionID] = {
      expiresAt: now + SESSION_STREAM_RECONNECT_REPLAY_WINDOW_MS,
    }
    return
  }

  if (event.state === "closed") {
    delete windows[event.backendSessionID]
  }
}

export function clearSessionStreamReconnectReplayWindow(
  windows: SessionStreamReconnectReplayWindows,
  backendSessionID: string | undefined,
) {
  if (!backendSessionID) return
  delete windows[backendSessionID]
}

export function resolveSessionStreamPlaceholderPresentation(input: {
  backendSessionID: string
  backendTurnID?: string
  isTerminal?: boolean
  now?: number
  windows: SessionStreamReconnectReplayWindows
}): SessionStreamingPresentation {
  const now = input.now ?? Date.now()
  const window = input.windows[input.backendSessionID]
  if (!window) return LIVE_SESSION_ACTIVITY_PRESENTATION

  if (window.expiresAt <= now) {
    delete input.windows[input.backendSessionID]
    return LIVE_SESSION_ACTIVITY_PRESENTATION
  }

  if (!input.backendTurnID) {
    return LIVE_SESSION_ACTIVITY_PRESENTATION
  }

  if (!window.turnID) {
    window.turnID = input.backendTurnID
  }

  const isReconnectReplayTurn = window.turnID === input.backendTurnID
  if (input.isTerminal) {
    delete input.windows[input.backendSessionID]
  }

  return isReconnectReplayTurn
    ? RECONNECTING_SESSION_STREAM_PRESENTATION
    : LIVE_SESSION_ACTIVITY_PRESENTATION
}

export type ExecutionModeRouteDecision = {
  assistantThreadMessageID: string
  clearSteerUserMessage: boolean
  createAssistantThreadMessage: boolean
  removeAssistantThreadMessageID?: string
}

export function resolveExecutionModeRoute(input: {
  mode: AgentSessionExecutionMode
  requestedMode?: PendingAgentStream["requestedMode"]
  currentAssistantThreadMessageID: string
  createdAssistantThreadMessageID?: string
  existingAssistantThreadMessageID?: string
}): ExecutionModeRouteDecision {
  if (input.mode === "steer") {
    const assistantThreadMessageID =
      input.existingAssistantThreadMessageID ??
      input.createdAssistantThreadMessageID ??
      input.currentAssistantThreadMessageID
    return {
      assistantThreadMessageID,
      clearSteerUserMessage: false,
      createAssistantThreadMessage: false,
      ...(input.createdAssistantThreadMessageID && input.createdAssistantThreadMessageID !== assistantThreadMessageID
        ? { removeAssistantThreadMessageID: input.createdAssistantThreadMessageID }
        : {}),
    }
  }

  if (input.requestedMode === "steer") {
    if (input.existingAssistantThreadMessageID) {
      return {
        assistantThreadMessageID: input.existingAssistantThreadMessageID,
        clearSteerUserMessage: true,
        createAssistantThreadMessage: false,
      }
    }
    if (input.createdAssistantThreadMessageID) {
      return {
        assistantThreadMessageID: input.createdAssistantThreadMessageID,
        clearSteerUserMessage: true,
        createAssistantThreadMessage: false,
      }
    }
    return {
      assistantThreadMessageID: input.currentAssistantThreadMessageID,
      clearSteerUserMessage: true,
      createAssistantThreadMessage: true,
    }
  }

  return {
    assistantThreadMessageID: input.currentAssistantThreadMessageID,
    clearSteerUserMessage: false,
    createAssistantThreadMessage: false,
  }
}

export function applyExecutionModeToUserMessagePresentation(input: {
  messages: ThreadMessage[]
  userThreadMessageID: string
  assistantThreadMessageID: string
  mode: AgentSessionExecutionMode
}) {
  let didUpdate = false

  const nextMessages = input.messages.map((message): ThreadMessage => {
    if (message.kind !== "user" || message.id !== input.userThreadMessageID) return message

    if (input.mode === "steer") {
      return message
    }

    if (input.mode === "queued") {
      const { streamInsertion: _streamInsertion, ...queuedMessage } = message
      const nextMessage: UserThreadMessage = {
        ...queuedMessage,
        submissionMode: "queued",
      }
      didUpdate =
        message.submissionMode !== nextMessage.submissionMode ||
        Boolean(message.streamInsertion)
      return didUpdate ? nextMessage : message
    }

    const { submissionMode: _submissionMode, streamInsertion: _streamInsertion, ...regularMessage } = message
    didUpdate = Boolean(message.submissionMode || message.streamInsertion)
    return didUpdate ? regularMessage : message
  })

  return didUpdate ? nextMessages : input.messages
}

export function findPendingStreamForBackendTurn(
  streams: Record<string, PendingAgentStream>,
  input: {
    backendSessionID: string
    sessionID: string
    turnID: string
  },
) {
  const candidates = Object.values(streams).filter((target) =>
    target.sessionID === input.sessionID &&
    target.backendSessionID === input.backendSessionID,
  )
  const exact = candidates.find((target) => target.backendTurnID === input.turnID)
  if (exact) return exact

  const unbound = candidates.filter((target) => !target.backendTurnID)
  return unbound.length === 1 ? unbound[0] : undefined
}

export function revealBackendRecordedUserMessagePresentation(input: {
  messages: ThreadMessage[]
  userThreadMessageID: string
}) {
  let didUpdate = false

  const nextMessages = input.messages.map((message): ThreadMessage => {
    if (message.kind !== "user" || message.id !== input.userThreadMessageID) return message
    const {
      submissionMode: _submissionMode,
      streamInsertion: _streamInsertion,
      ...regularMessage
    } = message
    didUpdate = Boolean(message.submissionMode || message.streamInsertion)
    return didUpdate ? regularMessage : message
  })

  return didUpdate ? nextMessages : input.messages
}

export function revealPendingSteerUserMessagesAtHandoffPresentation(input: {
  messages: ThreadMessage[]
  assistantThreadMessageID: string
}) {
  let didUpdate = false

  const nextMessages = input.messages.map((message): ThreadMessage => {
    if (message.kind !== "user" || message.submissionMode !== "steer") return message
    if (
      message.streamInsertion &&
      (message.streamInsertion.assistantThreadMessageID !== input.assistantThreadMessageID ||
        message.streamInsertion.status === "consumed")
    ) {
      return message
    }

    const { submissionMode: _submissionMode, streamInsertion: _streamInsertion, ...regularMessage } = message
    didUpdate = true
    return regularMessage
  })

  return didUpdate ? nextMessages : input.messages
}

function buildSessionStreamingAssistantThreadMessageWithID(
  assistantThreadMessageID: string,
  presentation: SessionStreamingPresentation,
  identity: Partial<Pick<AssistantThreadMessage, "backendTurnID" | "segmentID" | "messageID" | "llmCallID">> = {},
): AssistantThreadMessage {
  const assistantMessage = buildSessionStreamingAssistantThreadMessage(presentation, identity)
  return {
    ...assistantMessage,
    id: assistantThreadMessageID,
    segmentID: identity.segmentID ?? assistantMessage.segmentID,
    backendTurnID: identity.backendTurnID ?? assistantMessage.backendTurnID,
    ...(identity.messageID ? { messageID: identity.messageID } : {}),
    ...(identity.llmCallID ? { llmCallID: identity.llmCallID } : {}),
    items: assistantMessage.items.map((item) => ({
      ...item,
      sourceID: item.sourceID === `${assistantMessage.id}:stream-placeholder`
        ? `${assistantThreadMessageID}:stream-placeholder`
        : item.sourceID,
    })),
  }
}

export function ensureAssistantThreadMessagePresentation(input: {
  messages: ThreadMessage[]
  assistantThreadMessageID: string
  presentation?: SessionStreamingPresentation
  identity?: Partial<Pick<AssistantThreadMessage, "backendTurnID" | "segmentID" | "messageID" | "llmCallID">>
}) {
  if (input.messages.some((message) => message.kind === "assistant" && message.id === input.assistantThreadMessageID)) {
    return input.messages
  }

  return [
    ...input.messages,
    buildSessionStreamingAssistantThreadMessageWithID(
      input.assistantThreadMessageID,
      input.presentation ?? LIVE_SESSION_ACTIVITY_PRESENTATION,
      input.identity,
    ),
  ]
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function readString(value: unknown) {
  return typeof value === "string" ? value : undefined
}

function isAgentSessionExecutionMode(value: unknown): value is AgentSessionExecutionMode {
  return value === "new-turn" || value === "queued" || value === "steer"
}

function readExecutionModeEvent(streamEvent: { event: string; data: unknown }): ExecutionModeEventPayload | null {
  if (streamEvent.event !== "execution.mode") return null
  const data = readRecord(streamEvent.data)
  if (!data) return null

  const sessionID = readString(data.sessionID)
  const turnID = readString(data.turnID)
  const mode = data.mode
  if (!sessionID || !turnID || !isAgentSessionExecutionMode(mode)) return null

  return {
    sessionID,
    turnID,
    mode,
  }
}

function readRuntimeStreamEvent(value: unknown) {
  const event = readRecord(value)
  if (!event || !readString(event.type) || !readString(event.eventID)) return null
  if (!readString(event.sessionID) || !readString(event.turnID)) return null
  if (!readRecord(event.payload)) return null
  return event
}

function readRuntimeStreamPayload(value: unknown) {
  return readRecord(readRuntimeStreamEvent(value)?.payload)
}

function readRuntimeStreamType(streamEvent: { event: string; data: unknown }) {
  if (streamEvent.event !== "runtime") return undefined
  return readString(readRuntimeStreamEvent(streamEvent.data)?.type)
}

type LlmCallSegmentIdentity = {
  backendTurnID: string
  llmCallID: string
  messageID?: string
  segmentID: string
}

function resolveLlmCallSegmentIdentity(
  streamEvent: { event: string; data: unknown },
  backendTurnID: string | undefined,
): LlmCallSegmentIdentity | null {
  const runtimeEvent = readRuntimeStreamEvent(streamEvent.data)
  if (!runtimeEvent || runtimeEvent.type !== "llm.call.started") return null

  const turnID = backendTurnID || readString(runtimeEvent.turnID)
  if (!turnID) return null

  const payload = readRecord(runtimeEvent.payload)
  const messageID = resolveStreamMessageID(streamEvent)
  const iteration = readStreamNumber(payload?.iteration) ?? 1
  const eventID = readString(runtimeEvent.eventID)
  if (!eventID) return null

  return {
    backendTurnID: turnID,
    llmCallID: eventID,
    ...(messageID ? { messageID } : {}),
    segmentID: messageID ? `${messageID}:${iteration}` : `llm:${eventID}`,
  }
}

export function isSteerInputConsumedStreamEvent(streamEvent: { event: string; data: unknown }) {
  if (readRuntimeStreamType(streamEvent) !== "turn.state.changed") return false
  const payload = readRuntimeStreamPayload(streamEvent.data)
  return (
    readString(payload?.phase) === "waiting_llm" &&
    readString(payload?.reason) === STEER_INPUT_CONSUMED_STATE_REASON
  )
}

export function isBackendUserMessageRecordedStreamEvent(streamEvent: { event: string; data: unknown }) {
  if (readRuntimeStreamType(streamEvent) !== "message.recorded") return false
  const payload = readRuntimeStreamPayload(streamEvent.data)
  const message = readRecord(payload?.message)
  return readString(message?.role) === "user"
}

export function isSteerHandoffBoundaryStreamEvent(streamEvent: { event: string; data: unknown }) {
  const type = readRuntimeStreamType(streamEvent)
  if (type !== "turn.state.changed" && type !== "turn.completed") return false

  const payload = readRuntimeStreamPayload(streamEvent.data)
  if (type === "turn.state.changed") {
    return readString(payload?.phase) === "continued_by_user"
  }

  return readString(payload?.status) === "continued_by_user"
}

export function shouldRefreshRuntimeDebugForStreamEvent(streamEvent: { event: string; data: unknown }) {
  const runtimeType = readRuntimeStreamType(streamEvent)
  if (runtimeType === "text.part.delta" || runtimeType === "reasoning.part.delta" || runtimeType === "tool.input.delta") return false
  if (!runtimeType && streamEvent.event === "delta") return false
  return true
}

export function isHighFrequencyDeltaStreamEvent(streamEvent: { event: string; data: unknown }) {
  const runtimeType = readRuntimeStreamType(streamEvent)
  if (runtimeType === "text.part.delta" || runtimeType === "reasoning.part.delta" || runtimeType === "tool.input.delta") return true
  return !runtimeType && streamEvent.event === "delta"
}

export function compactHighFrequencyDeltaStreamEvent<T extends { event: string; data: unknown }>(streamEvent: T): T {
  const runtimeEvent = readRuntimeStreamEvent(streamEvent.data)
  if (
    runtimeEvent &&
    (runtimeEvent.type === "text.part.delta" ||
      runtimeEvent.type === "reasoning.part.delta" ||
      runtimeEvent.type === "tool.input.delta")
  ) {
    const payload = readRecord(runtimeEvent.payload)
    if (!payload || !readString(payload.delta)) return streamEvent
    const { raw: _raw, text: _text, ...compactPayload } = payload
    return {
      ...streamEvent,
      data: {
        ...runtimeEvent,
        payload: compactPayload,
      },
    }
  }

  if (streamEvent.event === "delta") {
    const payload = readRecord(streamEvent.data)
    if (!payload || !readString(payload.delta) || !readString(payload.text)) return streamEvent
    const { text: _text, ...compactPayload } = payload
    return {
      ...streamEvent,
      data: compactPayload,
    }
  }

  return streamEvent
}

export function isTerminalStreamEvent(streamEvent: { event: string; data: unknown }) {
  const runtimeType = readRuntimeStreamType(streamEvent)
  if (runtimeType) {
    return runtimeType === "turn.completed" || runtimeType === "turn.failed" || runtimeType === "turn.cancelled"
  }

  return streamEvent.event === "done" || streamEvent.event === "error"
}

export function isCompletedStreamEvent(streamEvent: { event: string; data: unknown }) {
  const runtimeType = readRuntimeStreamType(streamEvent)
  if (runtimeType) return runtimeType === "turn.completed"
  return streamEvent.event === "done"
}

export function isLlmCompletedStreamEvent(streamEvent: { event: string; data: unknown }) {
  return readRuntimeStreamType(streamEvent) === "llm.call.completed"
}

export function isPermissionRequestStreamEvent(streamEvent: { event: string; data: unknown }) {
  const runtimeType = readRuntimeStreamType(streamEvent)
  if (runtimeType) {
    if (runtimeType === "permission.requested" || runtimeType === "tool.call.waiting_approval") return true
  }

  if (streamEvent.event !== "part") return false
  const data = readRecord(streamEvent.data)
  const part = readRecord(data?.part)
  return readString(part?.type) === "permission" && readString(part?.action) === "ask"
}

export function isTaskStateStreamEvent(streamEvent: { event: string; data: unknown }) {
  const runtimeType = readRuntimeStreamType(streamEvent)
  if (runtimeType) return runtimeType === "task.state.updated"

  if (streamEvent.event !== "part") return false
  const data = readRecord(streamEvent.data)
  const part = readRecord(data?.part)
  if (readString(part?.type) !== "tool") return false

  const state = readRecord(part?.state)
  const metadata = readRecord(state?.metadata)
  return readString(metadata?.kind) === "task-state"
}

export function isSubagentCreatedStreamEvent(streamEvent: { event: string; data: unknown }) {
  return readRuntimeStreamType(streamEvent) === "subagent.created"
}

export function readSubagentCreatedChildSessionID(streamEvent: { event: string; data: unknown }) {
  if (!isSubagentCreatedStreamEvent(streamEvent)) return null
  const payload = readRuntimeStreamPayload(streamEvent.data)
  const childSessionID = readString(payload?.childSessionID)?.trim()
  return childSessionID || null
}

function readSessionTaskListView(value: unknown): SessionTaskListView | null {
  const state = readRecord(value)
  const summary = readRecord(state?.summary)
  if (!state || !summary || !Array.isArray(state.tasks)) return null
  if (!readString(state.sessionID)) return null
  if (readStreamNumber(summary.total) === null) return null
  if (readStreamNumber(summary.completed) === null) return null
  if (readStreamNumber(summary.pending) === null) return null
  if (readStreamNumber(summary.inProgress) === null) return null
  if (readStreamNumber(summary.blocked) === null) return null

  return state as unknown as SessionTaskListView
}

export function readSessionTaskListViewFromStreamEvent(streamEvent: { event: string; data: unknown }) {
  const runtimePayload = readRuntimeStreamPayload(streamEvent.data)
  const runtimeTasks = readSessionTaskListView(runtimePayload?.state)
  if (runtimeTasks) return runtimeTasks

  if (streamEvent.event !== "part") return null
  const data = readRecord(streamEvent.data)
  const part = readRecord(data?.part)
  if (readString(part?.type) !== "tool") return null

  const state = readRecord(part?.state)
  const metadata = readRecord(state?.metadata)
  if (readString(metadata?.kind) !== "task-state") return null
  return readSessionTaskListView(metadata?.state)
}

function readStreamString(value: unknown) {
  return typeof value === "string" ? value : ""
}

function readStreamNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function readStreamRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function normalizeTraceText(value: string | undefined) {
  return (value ?? "").trim()
}

function readToolTraceName(item: AssistantTraceItem | undefined) {
  if (!item || item.kind !== "tool") return undefined
  return normalizeTraceText(item.toolName) || normalizeTraceText(item.title) || undefined
}

function traceValueIsEquivalent(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (typeof left !== typeof right) return false
  if (!left || !right || typeof left !== "object") return false

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return false
    if (left.length !== right.length) return false
    return left.every((value, index) => traceValueIsEquivalent(value, right[index]))
  }

  const leftRecord = left as Record<string, unknown>
  const rightRecord = right as Record<string, unknown>
  const keys = new Set([...Object.keys(leftRecord), ...Object.keys(rightRecord)])

  for (const key of keys) {
    if (!traceValueIsEquivalent(leftRecord[key], rightRecord[key])) return false
  }
  return true
}

function traceItemIsEquivalent(left: AssistantTraceItem, right: AssistantTraceItem) {
  return traceValueIsEquivalent(left, right)
}

function findMatchingTraceItemIndex(
  previousItems: AssistantTraceItem[],
  nextItem: AssistantTraceItem,
  usedIndices: Set<number>,
) {
  if (nextItem.kind === "tool") {
    const toolIdentityMatchIndex = previousItems.findIndex(
      (item, index) => !usedIndices.has(index) && toolTraceItemsShareIdentity(item, nextItem),
    )
    if (toolIdentityMatchIndex !== -1) return toolIdentityMatchIndex
  }

  if (nextItem.sourceID) {
    const sourceMatchIndex = previousItems.findIndex(
      (item, index) => !usedIndices.has(index) && item.sourceID === nextItem.sourceID,
    )
    if (sourceMatchIndex !== -1) return sourceMatchIndex
  }

  const idMatchIndex = previousItems.findIndex(
    (item, index) => !usedIndices.has(index) && item.id === nextItem.id,
  )
  if (idMatchIndex !== -1) return idMatchIndex

  const nextText = normalizeTraceText(nextItem.text)
  if (nextText) {
    const textMatchIndex = previousItems.findIndex(
      (item, index) =>
        !usedIndices.has(index) &&
        item.kind === nextItem.kind &&
        normalizeTraceText(item.text) === nextText,
    )
    if (textMatchIndex !== -1) return textMatchIndex
  }

  const nextTitle = normalizeTraceText(nextItem.title)
  const nextDetail = normalizeTraceText(nextItem.detail)
  if (nextTitle || nextDetail || nextItem.status) {
    return previousItems.findIndex(
      (item, index) =>
        !usedIndices.has(index) &&
        item.kind === nextItem.kind &&
        normalizeTraceText(item.title) === nextTitle &&
        normalizeTraceText(item.detail) === nextDetail &&
        (item.status ?? "") === (nextItem.status ?? ""),
    )
  }

  return -1
}

function preserveTraceItemIdentity(
  previousItems: AssistantTraceItem[],
  nextItems: AssistantTraceItem[],
) {
  if (previousItems.length === 0 || nextItems.length === 0) return nextItems

  const usedIndices = new Set<number>()

  return nextItems.map((nextItem) => {
    const matchIndex = findMatchingTraceItemIndex(previousItems, nextItem, usedIndices)
    if (matchIndex === -1) return nextItem

    const previousItem = previousItems[matchIndex]
    if (!previousItem) return nextItem

    usedIndices.add(matchIndex)

    const nextItemWithPreservedIdentity = {
      ...nextItem,
      id: previousItem.id,
      timestamp: Math.min(previousItem.timestamp, nextItem.timestamp),
    }
    return traceItemIsEquivalent(previousItem, nextItemWithPreservedIdentity)
      ? previousItem
      : nextItemWithPreservedIdentity
  })
}

function isTerminalTraceStatus(status: AssistantTraceItem["status"]) {
  return status === "completed" || status === "error" || status === "denied" || status === "cancelled"
}

function canIncomingMessageOverrideCancellation(message: AssistantThreadMessage) {
  return message.runtime.phase === "completed" || message.runtime.phase === "failed"
}

function shouldPreserveCancelledMessage(current: AssistantThreadMessage, incoming: AssistantThreadMessage) {
  return current.runtime.phase === "cancelled" &&
    (!canIncomingMessageOverrideCancellation(incoming) || isLateToolFailureForCancelledMessage(current, incoming))
}

function cancelInterruptedToolTraceItems(items: AssistantTraceItem[]) {
  let didUpdate = false
  const nextItems = items.map((item) => {
    if (item.kind !== "tool" || isTerminalTraceStatus(item.status)) return item

    const nextItem = {
      ...item,
      status: "cancelled" as const,
      detail: item.detail || "Prompt cancellation requested.",
      isStreaming: false,
    }
    if (traceItemIsEquivalent(item, nextItem)) return item

    didUpdate = true
    return nextItem
  })

  return didUpdate ? nextItems : items
}

function getToolTraceIdentity(item: AssistantTraceItem) {
  if (item.kind !== "tool") return null
  if (item.partID) return `part:${item.partID}`
  if (item.sourceID) return `source:${item.sourceID}`
  if (item.messageID && item.toolCallID) return `tool:${item.messageID}:${item.toolCallID}`
  if (item.toolCallID) return `tool:${item.toolCallID}`
  return null
}

function getToolTraceIdentities(item: AssistantTraceItem) {
  if (item.kind !== "tool") return []

  return [
    item.partID ? `part:${item.partID}` : "",
    item.sourceID ? `source:${item.sourceID}` : "",
    item.messageID && item.toolCallID ? `tool:${item.messageID}:${item.toolCallID}` : "",
    item.toolCallID ? `tool:${item.toolCallID}` : "",
  ].filter(Boolean)
}

function toolTraceItemsShareIdentity(left: AssistantTraceItem, right: AssistantTraceItem) {
  const leftIdentities = getToolTraceIdentities(left)
  if (leftIdentities.length === 0) return false
  const rightIdentities = new Set(getToolTraceIdentities(right))
  return leftIdentities.some((identity) => rightIdentities.has(identity))
}

function isLateToolFailureForCancelledMessage(current: AssistantThreadMessage, incoming: AssistantThreadMessage) {
  if (incoming.runtime.phase !== "failed") return false
  if (incoming.items.some((item) => item.kind === "error")) return false

  const cancelledToolIdentities = new Set(
    current.items
      .filter((item) => item.kind === "tool" && item.status === "cancelled")
      .flatMap(getToolTraceIdentities),
  )
  if (cancelledToolIdentities.size === 0) return false

  return incoming.items.some((item) => {
    if (item.kind !== "tool" || item.status !== "error") return false
    const identity = getToolTraceIdentity(item)
    return Boolean(identity && cancelledToolIdentities.has(identity))
  })
}

function mergeTraceDebugEntries(
  first: AssistantTraceItem["debugEntries"],
  second: AssistantTraceItem["debugEntries"],
) {
  if (!first?.length) return second
  if (!second?.length) return first

  const seen = new Set<string>()
  const merged: NonNullable<AssistantTraceItem["debugEntries"]> = []
  for (const entry of [...first, ...second]) {
    const key = `${entry.label}\u0000${entry.value}`
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(entry)
  }
  return merged
}

function mergeAssistantTraceItem(existing: AssistantTraceItem, nextItem: AssistantTraceItem): AssistantTraceItem {
  const keepsTerminalToolState =
    existing.kind === "tool" &&
    nextItem.kind === "tool" &&
    isTerminalTraceStatus(existing.status) &&
    !isTerminalTraceStatus(nextItem.status)
  const keepsCancelledToolState =
    existing.kind === "tool" &&
    nextItem.kind === "tool" &&
    existing.status === "cancelled" &&
    nextItem.status === "error"

  if (keepsTerminalToolState || keepsCancelledToolState) {
    const merged = {
      ...existing,
      messageID: existing.messageID ?? nextItem.messageID,
      backendTurnID: existing.backendTurnID ?? nextItem.backendTurnID,
      partID: existing.partID ?? nextItem.partID,
      toolCallID: existing.toolCallID ?? nextItem.toolCallID,
      debugEntries: mergeTraceDebugEntries(existing.debugEntries, nextItem.debugEntries),
    }
    return traceItemIsEquivalent(existing, merged) ? existing : merged
  }

  const merged = {
    ...existing,
    ...nextItem,
    id: existing.id,
    messageID: nextItem.messageID ?? existing.messageID,
    backendTurnID: nextItem.backendTurnID ?? existing.backendTurnID,
    timestamp: Math.min(existing.timestamp, nextItem.timestamp),
    debugEntries: mergeTraceDebugEntries(existing.debugEntries, nextItem.debugEntries),
  }

  if (
    existing.kind === nextItem.kind &&
    (nextItem.kind === "reasoning" || nextItem.kind === "text") &&
    existing.text &&
    !nextItem.text
  ) {
    const mergedWithText = {
      ...merged,
      text: existing.text,
    }
    return traceItemIsEquivalent(existing, mergedWithText) ? existing : mergedWithText
  }

  if (existing.kind === "tool" && nextItem.kind === "tool") {
    const mergedTool = {
      ...merged,
      text: nextItem.text ?? existing.text,
      toolInputText: nextItem.toolInputText ?? existing.toolInputText,
      toolOutputText: nextItem.toolOutputText ?? existing.toolOutputText,
    }
    return traceItemIsEquivalent(existing, mergedTool) ? existing : mergedTool
  }

  return traceItemIsEquivalent(existing, merged) ? existing : merged
}

function upsertAssistantTraceItem(items: AssistantTraceItem[], nextItem: AssistantTraceItem) {
  const nextToolIdentity = getToolTraceIdentity(nextItem)
  const matchingIndices = items.reduce<number[]>((result, item, index) => {
    const matchesToolIdentity =
      (nextToolIdentity && getToolTraceIdentity(item) === nextToolIdentity) ||
      toolTraceItemsShareIdentity(item, nextItem)
    const matchesSource = nextItem.sourceID && item.sourceID && item.sourceID === nextItem.sourceID
    const matchesID = item.id === nextItem.id
    if (matchesToolIdentity || matchesSource || matchesID) {
      result.push(index)
    }
    return result
  }, [])

  if (matchingIndices.length === 0) {
    return [...items, nextItem]
  }

  const firstIndex = matchingIndices[0]
  const existing = items[firstIndex]
  if (!existing) return items

  const merged = mergeAssistantTraceItem(existing, nextItem)
  const duplicateIndices = new Set(matchingIndices.slice(1))
  if (duplicateIndices.size === 0 && Object.is(merged, existing)) return items

  const nextItems: AssistantTraceItem[] = []
  items.forEach((item, index) => {
    if (index === firstIndex) {
      nextItems.push(merged)
      return
    }
    if (!duplicateIndices.has(index)) {
      nextItems.push(item)
    }
  })
  return nextItems
}

function removeStaleApprovalBlockers(items: AssistantTraceItem[]) {
  const hasWaitingTool = items.some((item) => item.kind === "tool" && item.status === "waiting-approval")
  if (hasWaitingTool) return items

  const hasStaleApprovalBlocker = items.some(
    (item) =>
      item.title === "Approval required" &&
      item.status === "pending" &&
      item.visibilityKey === "approvals",
  )
  if (!hasStaleApprovalBlocker) return items

  return items.filter(
    (item) =>
      !(
        item.title === "Approval required" &&
        item.status === "pending" &&
        item.visibilityKey === "approvals"
      ),
  )
}

function mergeAssistantTraceItems(currentItems: AssistantTraceItem[], nextItems: AssistantTraceItem[]) {
  return removeStaleApprovalBlockers(
    nextItems.reduce((result, nextItem) => upsertAssistantTraceItem(result, nextItem), currentItems),
  )
}

function assistantRuntimeAfterTraceMerge(current: AssistantThreadMessage, incoming: AssistantThreadMessage, items: AssistantTraceItem[]) {
  const hasWaitingTool = items.some((item) => item.kind === "tool" && item.status === "waiting-approval")
  const hasActiveTool = items.some(
    (item) => item.kind === "tool" && (item.status === "pending" || item.status === "running"),
  )
  const existingRuntime = current.runtime
  const nextRuntime = incoming.runtime
  const updatedAt = Math.max(existingRuntime.updatedAt, nextRuntime.updatedAt)

  if (hasWaitingTool) {
    const waitingTool = items.find((item) => item.kind === "tool" && item.status === "waiting-approval")
    return {
      ...existingRuntime,
      ...nextRuntime,
      phase: "waiting_approval" as const,
      updatedAt,
      firstVisibleAt: existingRuntime.firstVisibleAt ?? nextRuntime.firstVisibleAt,
      toolName: readToolTraceName(waitingTool) ?? nextRuntime.toolName ?? existingRuntime.toolName,
    }
  }

  if (hasActiveTool) {
    const activeTool = items.find(
      (item) => item.kind === "tool" && (item.status === "pending" || item.status === "running"),
    )
    return {
      ...existingRuntime,
      ...nextRuntime,
      phase: "tool_running" as const,
      updatedAt,
      firstVisibleAt: existingRuntime.firstVisibleAt ?? nextRuntime.firstVisibleAt,
      toolName: readToolTraceName(activeTool) ?? nextRuntime.toolName ?? existingRuntime.toolName,
      approvalRequestID: undefined,
    }
  }

  if (existingRuntime.phase === "waiting_approval" || nextRuntime.phase === "waiting_approval") {
    return {
      ...existingRuntime,
      ...nextRuntime,
      phase: "completed" as const,
      updatedAt,
      firstVisibleAt: existingRuntime.firstVisibleAt ?? nextRuntime.firstVisibleAt,
      toolName: undefined,
      approvalRequestID: undefined,
      errorMessage: undefined,
    }
  }

  return {
    ...existingRuntime,
    ...nextRuntime,
    updatedAt,
    firstVisibleAt: existingRuntime.firstVisibleAt ?? nextRuntime.firstVisibleAt,
  }
}

function isTerminalAssistantRuntimePhase(phase: AssistantThreadMessage["runtime"]["phase"]) {
  return (
    phase === "completed" ||
    phase === "cancelled" ||
    phase === "failed" ||
    phase === "blocked" ||
    phase === "continued_by_user"
  )
}

function mergeAssistantMessagesByMessageID(current: AssistantThreadMessage, incoming: AssistantThreadMessage): AssistantThreadMessage {
  const preserveCancellation = shouldPreserveCancelledMessage(current, incoming)
  const mergedItems = mergeAssistantTraceItems(current.items, incoming.items)
  const items = preserveCancellation ? cancelInterruptedToolTraceItems(mergedItems) : mergedItems
  const mergedRuntime = assistantRuntimeAfterTraceMerge(current, incoming, items)
  const runtime = preserveCancellation
    ? {
        ...mergedRuntime,
        phase: "cancelled" as const,
        toolName: undefined,
        approvalRequestID: undefined,
        errorMessage: undefined,
      }
    : mergedRuntime
  return {
    ...current,
    ...incoming,
    id: current.id,
    backendTurnID: incoming.backendTurnID || current.backendTurnID,
    segmentID: incoming.segmentID || current.segmentID,
    llmCallID: incoming.llmCallID ?? current.llmCallID,
    timestamp: current.timestamp,
    messageID: current.messageID ?? incoming.messageID,
    runtime,
    state: preserveCancellation
      ? current.state || "Backend stream cancelled"
      : runtime.phase === "completed" &&
        (current.runtime.phase === "waiting_approval" || incoming.runtime.phase === "waiting_approval")
        ? "Backend response received"
        : incoming.state || current.state,
    isStreaming: preserveCancellation
      ? false
      : isTerminalAssistantRuntimePhase(runtime.phase)
        ? false
        : Boolean(current.isStreaming || incoming.isStreaming),
    items,
  }
}

export function reconcileConversationMessages(messages: ThreadMessage[]) {
  const result: ThreadMessage[] = []
  const assistantIndexByID = new Map<string, number>()
  const assistantIndexBySegmentID = new Map<string, number>()
  const assistantIndexByMessageID = new Map<string, number>()

  function registerAssistantMessageIndex(message: AssistantThreadMessage, index: number) {
    assistantIndexByID.set(message.id, index)
    if (message.segmentID) {
      assistantIndexBySegmentID.set(message.segmentID, index)
    }
    if (message.messageID && (!message.segmentID || message.segmentID === message.messageID)) {
      assistantIndexByMessageID.set(message.messageID, index)
    }
  }

  function findExistingAssistantMessageIndex(message: AssistantThreadMessage) {
    const idIndex = assistantIndexByID.get(message.id)
    if (idIndex !== undefined) return idIndex

    if (message.segmentID) {
      const segmentIndex = assistantIndexBySegmentID.get(message.segmentID)
      if (segmentIndex !== undefined) return segmentIndex
    }

    if (message.messageID && (!message.segmentID || message.segmentID === message.messageID)) {
      const messageIndex = assistantIndexByMessageID.get(message.messageID)
      if (messageIndex !== undefined) return messageIndex
    }

    return undefined
  }

  for (const message of messages) {
    if (message.kind !== "assistant") {
      result.push(message)
      continue
    }

    const existingIndex = findExistingAssistantMessageIndex(message)
    if (existingIndex === undefined) {
      const nextMessage = {
        ...message,
        items: removeStaleApprovalBlockers(message.items),
      }
      registerAssistantMessageIndex(nextMessage, result.length)
      result.push({
        ...nextMessage,
      })
      continue
    }

    const existingMessage = result[existingIndex]
    if (!existingMessage || existingMessage.kind !== "assistant") {
      result.push(message)
      continue
    }

    const mergedMessage = mergeAssistantMessagesByMessageID(existingMessage, message)
    result[existingIndex] = mergedMessage
    registerAssistantMessageIndex(mergedMessage, existingIndex)
  }

  return result
}

function getAssistantMessageResponseText(message: AssistantThreadMessage) {
  return message.items
    .filter((item) => item.kind === "text" || item.kind === "question")
    .map((item) => normalizeTraceText(item.text))
    .filter(Boolean)
    .join("\n\n")
}

function getAssistantMessageSourceIDs(message: AssistantThreadMessage) {
  return new Set(
    message.items
      .map((item) => item.sourceID)
      .filter((sourceID): sourceID is string => Boolean(sourceID)),
  )
}

function assistantMessagesAreCompatible(previousMessage: AssistantThreadMessage, nextMessage: AssistantThreadMessage) {
  if (previousMessage.id === nextMessage.id) return true
  if (previousMessage.segmentID && nextMessage.segmentID && previousMessage.segmentID === nextMessage.segmentID) return true
  if (
    previousMessage.messageID &&
    nextMessage.messageID &&
    previousMessage.messageID === nextMessage.messageID &&
    (!previousMessage.segmentID || !nextMessage.segmentID || previousMessage.segmentID === nextMessage.segmentID)
  ) {
    return true
  }

  const previousSourceIDs = getAssistantMessageSourceIDs(previousMessage)
  if (previousSourceIDs.size > 0) {
    for (const sourceID of getAssistantMessageSourceIDs(nextMessage)) {
      if (previousSourceIDs.has(sourceID)) return true
    }
  }

  const previousResponseText = getAssistantMessageResponseText(previousMessage)
  const nextResponseText = getAssistantMessageResponseText(nextMessage)
  return Boolean(previousResponseText && previousResponseText === nextResponseText)
}

function findMatchingAssistantMessageIndex(
  previousAssistantMessages: AssistantThreadMessage[],
  nextMessage: AssistantThreadMessage,
  preferredIndex: number,
  usedIndices: Set<number>,
) {
  const idMatchIndex = previousAssistantMessages.findIndex(
    (message, index) => !usedIndices.has(index) && message.id === nextMessage.id,
  )
  if (idMatchIndex !== -1) return idMatchIndex

  const preferredMessage = previousAssistantMessages[preferredIndex]
  if (
    preferredMessage &&
    !usedIndices.has(preferredIndex) &&
    assistantMessagesAreCompatible(preferredMessage, nextMessage)
  ) {
    return preferredIndex
  }

  if (
    preferredMessage &&
    !usedIndices.has(preferredIndex) &&
    shouldPreserveCancelledMessage(preferredMessage, nextMessage)
  ) {
    return preferredIndex
  }

  return previousAssistantMessages.findIndex(
    (message, index) => !usedIndices.has(index) && assistantMessagesAreCompatible(message, nextMessage),
  )
}

function preserveAssistantMessageIdentity(previousMessages: ThreadMessage[], nextMessages: ThreadMessage[]) {
  const previousAssistantMessages = previousMessages.filter(
    (message): message is AssistantThreadMessage => message.kind === "assistant",
  )
  if (previousAssistantMessages.length === 0) return nextMessages

  const usedIndices = new Set<number>()
  let nextAssistantIndex = 0

  return nextMessages.map((message) => {
    if (message.kind !== "assistant") return message

    const matchIndex = findMatchingAssistantMessageIndex(
      previousAssistantMessages,
      message,
      nextAssistantIndex,
      usedIndices,
    )
    nextAssistantIndex += 1

    if (matchIndex === -1) return message

    const previousMessage = previousAssistantMessages[matchIndex]
    if (!previousMessage) return message

    usedIndices.add(matchIndex)

    const messageWithPreservedIdentity = {
      ...message,
      id: previousMessage.id,
      items: preserveTraceItemIdentity(previousMessage.items, message.items),
    }
    return shouldPreserveCancelledMessage(previousMessage, message)
      ? mergeAssistantMessagesByMessageID(previousMessage, messageWithPreservedIdentity)
      : messageWithPreservedIdentity
  })
}

function isLocalGeneratedUserMessage(message: UserThreadMessage) {
  return message.id.startsWith("user-")
}

function normalizeUserMessageIdentityText(message: UserThreadMessage) {
  return (message.displayText ?? message.text).replace(/\s+/g, " ").trim()
}

function userMessagesAreCompatible(previousMessage: UserThreadMessage, nextMessage: UserThreadMessage) {
  if (previousMessage.id === nextMessage.id) return true

  const previousQuestionID = previousMessage.questionAnswer?.questionID ?? ""
  const nextQuestionID = nextMessage.questionAnswer?.questionID ?? ""
  if (previousQuestionID || nextQuestionID) return previousQuestionID === nextQuestionID

  const previousText = normalizeUserMessageIdentityText(previousMessage)
  const nextText = normalizeUserMessageIdentityText(nextMessage)
  return Boolean(previousText && previousText === nextText)
}

export function mergeConversationMessagesFromHistory(
  previousMessages: ThreadMessage[],
  nextMessages: ThreadMessage[],
  options?: { preserveUserPresentation?: boolean },
) {
  const messagesWithUserPresentation = options?.preserveUserPresentation === false
    ? nextMessages
    : mergeUserMessagePresentationState(previousMessages, nextMessages)
  return preserveAssistantMessageIdentity(previousMessages, messagesWithUserPresentation)
}

export function mergeExternalUserMessagesFromHistory(
  previousMessages: ThreadMessage[],
  historyMessages: ThreadMessage[],
  options?: { beforeMessageID?: string },
) {
  const previousUserThreadMessageIDs = new Set(
    previousMessages
      .filter((message): message is UserThreadMessage => message.kind === "user")
      .map((message) => message.id),
  )
  const missingUserMessages = historyMessages
    .filter((message): message is UserThreadMessage => message.kind === "user" && !previousUserThreadMessageIDs.has(message.id))
    .sort((left, right) => left.timestamp - right.timestamp)

  if (missingUserMessages.length === 0) return previousMessages

  const nextMessages = [...previousMessages]
  const replacedLocalUserMessageIndices = new Set<number>()

  function findLocalUserMessageReplacementIndex(userMessage: UserThreadMessage) {
    const anchorIndex = options?.beforeMessageID ? nextMessages.findIndex((message) => message.id === options.beforeMessageID) : -1
    if (anchorIndex < 0) return -1

    for (let index = anchorIndex - 1; index >= 0; index -= 1) {
      const candidate = nextMessages[index]
      if (!candidate) continue
      if (candidate.kind === "assistant") break
      if (candidate.kind !== "user") continue
      if (replacedLocalUserMessageIndices.has(index)) continue
      if (!isLocalGeneratedUserMessage(candidate)) continue
      if (!userMessagesAreCompatible(candidate, userMessage)) continue
      return index
    }

    return -1
  }

  for (const userMessage of missingUserMessages) {
    const replacementIndex = findLocalUserMessageReplacementIndex(userMessage)
    if (replacementIndex >= 0) {
      const currentMessage = nextMessages[replacementIndex]
      if (currentMessage?.kind === "user") {
        const [mergedUserMessage] = mergeUserMessagePresentationState([currentMessage], [userMessage])
        nextMessages[replacementIndex] = mergedUserMessage ?? userMessage
        replacedLocalUserMessageIndices.add(replacementIndex)
        previousUserThreadMessageIDs.add(userMessage.id)
        continue
      }
    }

    const timestampIndex = nextMessages.findIndex(
      (message) => message.timestamp > userMessage.timestamp || (message.kind === "assistant" && message.timestamp === userMessage.timestamp),
    )
    const anchorIndex = options?.beforeMessageID ? nextMessages.findIndex((message) => message.id === options.beforeMessageID) : -1
    const insertIndex = anchorIndex >= 0 && (timestampIndex < 0 || anchorIndex < timestampIndex)
      ? anchorIndex
      : timestampIndex

    if (insertIndex < 0) {
      nextMessages.push(userMessage)
    } else {
      nextMessages.splice(insertIndex, 0, userMessage)
    }
  }

  return reconcileConversationMessages(nextMessages)
}

export function conversationMessagesAreEquivalent(leftMessages: ThreadMessage[], rightMessages: ThreadMessage[]) {
  if (leftMessages === rightMessages) return true
  if (leftMessages.length !== rightMessages.length) return false

  return leftMessages.every((leftMessage, index) => JSON.stringify(leftMessage) === JSON.stringify(rightMessages[index]))
}

function readSessionContextUsageFromMessageInfo(value: unknown): SessionContextUsage | null {
  const message = readStreamRecord(value)
  if (!message || readStreamString(message.role) !== "assistant") return null

  const tokens = readStreamRecord(message.tokens)
  if (!tokens) return null

  const inputTokens = readStreamNumber(tokens.input) ?? 0
  const outputTokens = readStreamNumber(tokens.output) ?? 0
  const reasoningTokens = readStreamNumber(tokens.reasoning) ?? 0
  const cache = readStreamRecord(tokens.cache)
  const cacheReadTokens = readStreamNumber(cache?.read) ?? 0
  const cacheWriteTokens = readStreamNumber(cache?.write) ?? 0
  const totalTokens = inputTokens + outputTokens

  if (inputTokens <= 0 && outputTokens <= 0 && reasoningTokens <= 0 && cacheReadTokens <= 0 && cacheWriteTokens <= 0) {
    return null
  }

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    reasoningTokens,
    cacheReadTokens,
    cacheWriteTokens,
    measuredAt: readStreamNumber(message.completed) ?? readStreamNumber(message.created) ?? Date.now(),
  }
}

export function readSessionContextUsageFromDoneEventData(value: unknown) {
  const runtimePayload = readRuntimeStreamPayload(value)
  if (runtimePayload) {
    return readSessionContextUsageFromMessageInfo(runtimePayload.message)
  }

  const payload = readStreamRecord(value)
  return readSessionContextUsageFromMessageInfo(payload?.message)
}

export function readSessionContextUsageFromLlmCompletedEventData(value: unknown): SessionContextUsage | null {
  const runtimeEvent = readRuntimeStreamEvent(value)
  if (!runtimeEvent || readStreamString(runtimeEvent.type) !== "llm.call.completed") return null

  const payload = readStreamRecord(runtimeEvent.payload)
  const usage = readStreamRecord(payload?.usage)
  if (!usage) return null

  const inputTokens = readStreamNumber(usage.inputTokens) ?? 0
  const outputTokens = readStreamNumber(usage.outputTokens) ?? 0
  const reasoningTokens = readStreamNumber(usage.reasoningTokens) ?? 0
  const cacheReadTokens = readStreamNumber(usage.cacheReadTokens) ?? 0
  const cacheWriteTokens = readStreamNumber(usage.cacheWriteTokens) ?? 0
  const totalTokens = inputTokens + outputTokens

  if (inputTokens <= 0 && outputTokens <= 0 && reasoningTokens <= 0 && cacheReadTokens <= 0 && cacheWriteTokens <= 0) {
    return null
  }

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    reasoningTokens,
    cacheReadTokens,
    cacheWriteTokens,
    measuredAt: readStreamNumber(runtimeEvent.timestamp) ?? Date.now(),
  }
}

export function readLatestSessionContextUsageFromHistory(messages: LoadedSessionHistoryMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const usage = readSessionContextUsageFromMessageInfo(messages[index]?.info)
    if (usage) return usage
  }

  return null
}

export function resolveStreamCursor(event: { id?: string; data: unknown }) {
  const runtimeEvent = readRuntimeStreamEvent(event.data)
  if (runtimeEvent) {
    const timestamp = readStreamNumber(runtimeEvent.timestamp)
    const seq = readStreamNumber(runtimeEvent.seq)
    const turnID = readStreamString(runtimeEvent.turnID)
    if (timestamp !== null && seq !== null && turnID) {
      return `${timestamp}:${turnID}:${seq}`
    }
    return event.id || readStreamString(runtimeEvent.eventID)
  }

  const payload = readStreamRecord(event.data)
  return readStreamString(payload?.cursor) || event.id || ""
}

export function resolveStreamTurnID(event: { data: unknown }) {
  const runtimeEvent = readRuntimeStreamEvent(event.data)
  if (runtimeEvent) {
    return readStreamString(runtimeEvent.turnID) || undefined
  }

  const payload = readStreamRecord(event.data)
  return readStreamString(payload?.turnID) || undefined
}

function readMessageIDFromStreamPart(value: unknown) {
  const part = readStreamRecord(value)
  return readStreamString(part?.messageID) || undefined
}

export function resolveStreamMessageID(event: { data: unknown }) {
  const runtimePayload = readRuntimeStreamPayload(event.data)
  const payload = runtimePayload ?? readStreamRecord(event.data)
  if (!payload) return undefined

  const directMessageID = readStreamString(payload.messageID)
  if (directMessageID) return directMessageID

  const message = readStreamRecord(payload.message)
  const messageID = readStreamString(message?.id)
  if (messageID) return messageID

  const partMessageID = readMessageIDFromStreamPart(payload.part)
  if (partMessageID) return partMessageID

  if (Array.isArray(payload.parts)) {
    for (const part of payload.parts) {
      const partListMessageID = readMessageIDFromStreamPart(part)
      if (partListMessageID) return partListMessageID
    }
  }

  return undefined
}

type StateSetter<T> = (update: WorkspaceStateUpdater<T>) => void

interface UseSessionStreamControllerOptions {
  agentConnected: boolean
  agentDefaultDirectory: string
  agentSessionStoreRef: MutableRefObject<{
    dispatch(action: { type: "subscription.state"; event: Extract<AgentSessionBridgeEvent, { kind: "subscription-state" }> } | { type: "session.cleanup"; sessionID: string } | { type: "subscription.remove"; backendSessionID: string }): void
  }>
  agentSessions: Record<string, string>
  appendAssistantDelta: (
    sessionID: string,
    assistantMessageID: string,
    updater: (message: AssistantThreadMessage) => AssistantThreadMessage,
  ) => boolean
  canLoadSessionHistory: boolean
  contextUsageBySession: Record<string, SessionContextUsage>
  conversationVersionRef: MutableRefObject<Record<string, number>>
  conversationStore: ConversationStoreApi
  historyRequestRef: MutableRefObject<Record<string, number>>
  isRuntimeDebugEnabled: boolean
  openCanvasSessionIDs: string[]
  visibleCanvasSessionIDs: string[]
  onFocusSession: (sessionID: string, turnID?: string) => void
  onSessionCanvasActivity: (sessionID: string) => void
  pendingConversationInputsBySession: Record<string, PendingConversationInput[]>
  pendingStreamsRef: MutableRefObject<Record<string, PendingAgentStream>>
  permissionRequestsRequestRef: MutableRefObject<Record<string, number>>
  platform: string
  runtimeDebugRefreshTimerRef: MutableRefObject<Record<string, number>>
  runtimeDebugRequestRef: MutableRefObject<Record<string, number>>
  sessionDiffBySession: Record<string, SessionDiffSummary>
  sessionDiffRefreshTimerRef: MutableRefObject<Record<string, number>>
  sessionDiffRequestRef: MutableRefObject<Record<string, number>>
  sessionDirectoryBySession: Record<string, string>
  sessionDataLoadCacheRef: MutableRefObject<SessionDataLoadCache>
  sessionEventRouterRef: MutableRefObject<AgentSessionEventRouter>
  sessionRuntimeDebugBySession: Record<string, SessionRuntimeDebugSnapshot>
  setAgentSessions: StateSetter<Record<string, string>>
  setCancellingSessionIDs: StateSetter<Record<string, boolean>>
  setCanLoadSessionHistory: StateSetter<boolean>
  setContextUsageBySession: StateSetter<Record<string, SessionContextUsage>>
  setConversations: StateSetter<Record<string, ThreadMessage[]>>
  setMessageTreeBySession: StateSetter<Record<string, SessionMessageTree>>
  setPendingConversationInputsBySession: StateSetter<Record<string, PendingConversationInput[]>>
  setPendingPermissionRequestsBySession: StateSetter<Record<string, PermissionRequest[]>>
  setSessionDiffBySession: StateSetter<Record<string, SessionDiffSummary>>
  setSessionDiffStateBySession: StateSetter<Record<string, SessionDiffState>>
  setSessionDirectoryBySession: StateSetter<Record<string, string>>
  setSessionRuntimeDebugBySession: StateSetter<Record<string, SessionRuntimeDebugSnapshot>>
  setSessionRuntimeDebugStateBySession: StateSetter<Record<string, SessionRuntimeDebugState>>
  setSessionTasksBySession: StateSetter<Record<string, SessionTaskListView>>
  setWorkspaces: StateSetter<WorkspaceGroup[]>
  skipNextHistoryLoadRef: MutableRefObject<Record<string, boolean>>
  subscribedSessionStreamsRef: MutableRefObject<Record<string, string>>
  updateConversationTurns: (update: WorkspaceStateUpdater<ConversationTurnMap>) => boolean
  workspaceRefreshRequestRef: MutableRefObject<Record<string, number>>
  workspaces: WorkspaceGroup[]
}

export function useSessionStreamController({
  agentConnected,
  agentDefaultDirectory,
  agentSessionStoreRef,
  agentSessions,
  appendAssistantDelta,
  canLoadSessionHistory,
  conversationVersionRef,
  conversationStore,
  historyRequestRef,
  isRuntimeDebugEnabled,
  openCanvasSessionIDs,
  visibleCanvasSessionIDs,
  onFocusSession,
  onSessionCanvasActivity,
  pendingConversationInputsBySession,
  pendingStreamsRef,
  permissionRequestsRequestRef,
  platform,
  runtimeDebugRefreshTimerRef,
  runtimeDebugRequestRef,
  sessionDiffBySession,
  sessionDiffRefreshTimerRef,
  sessionDiffRequestRef,
  sessionDirectoryBySession,
  sessionDataLoadCacheRef,
  sessionEventRouterRef,
  sessionRuntimeDebugBySession,
  setAgentSessions,
  setCancellingSessionIDs,
  setCanLoadSessionHistory,
  setContextUsageBySession,
  setConversations,
  setMessageTreeBySession,
  setPendingConversationInputsBySession,
  setPendingPermissionRequestsBySession,
  setSessionDiffBySession,
  setSessionDiffStateBySession,
  setSessionDirectoryBySession,
  setSessionRuntimeDebugBySession,
  setSessionRuntimeDebugStateBySession,
  setSessionTasksBySession,
  setWorkspaces,
  skipNextHistoryLoadRef,
  subscribedSessionStreamsRef,
  updateConversationTurns,
  workspaceRefreshRequestRef,
  workspaces,
}: UseSessionStreamControllerOptions) {
  const pendingDeltaUpdatesRef = useRef<PendingStreamDeltaUpdate[]>([])
  const pendingDeltaFlushCancelRef = useRef<RendererFrameTaskCancel | null>(null)
  const lastDeltaBackpressureLogAtRef = useRef(0)
  const reconnectReplayWindowsRef = useRef<SessionStreamReconnectReplayWindows>({})
  const externalTurnUserHistoryMergedRef = useRef<Set<string>>(new Set())
  const externalTurnHistoryRefreshInFlightRef = useRef<Set<string>>(new Set())
  const externalTurnHistoryLastAttemptAtRef = useRef<Record<string, number>>({})
  const [backgroundObservedSessionIDs, setBackgroundObservedSessionIDs] = useState<string[]>([])
  const pendingConversationInputsBySessionRef = useRef(pendingConversationInputsBySession)
  pendingConversationInputsBySessionRef.current = pendingConversationInputsBySession

  function updateSessionContextUsage(sessionID: string, usage: SessionContextUsage | null) {
    setContextUsageBySession((prev) => {
      if (!usage) {
        if (!(sessionID in prev)) return prev
        const next = { ...prev }
        delete next[sessionID]
        return next
      }

      const current = prev[sessionID]
      if (
        current &&
        current.inputTokens === usage.inputTokens &&
        current.outputTokens === usage.outputTokens &&
        current.totalTokens === usage.totalTokens &&
        current.reasoningTokens === usage.reasoningTokens &&
        current.cacheReadTokens === usage.cacheReadTokens &&
        current.cacheWriteTokens === usage.cacheWriteTokens &&
        current.measuredAt === usage.measuredAt
      ) {
        return prev
      }

      return {
        ...prev,
        [sessionID]: usage,
      }
    })
  }

  function syncSessionContextUsageFromHistory(sessionID: string, usage: SessionContextUsage | null) {
    setContextUsageBySession((prev) => {
      if (!usage) {
        return prev
      }

      const current = prev[sessionID]
      if (
        current &&
        current.inputTokens === usage.inputTokens &&
        current.outputTokens === usage.outputTokens &&
        current.totalTokens === usage.totalTokens &&
        current.reasoningTokens === usage.reasoningTokens &&
        current.cacheReadTokens === usage.cacheReadTokens &&
        current.cacheWriteTokens === usage.cacheWriteTokens &&
        current.measuredAt === usage.measuredAt
      ) {
        return prev
      }

      return {
        ...prev,
        [sessionID]: usage,
      }
    })
  }

  function bumpConversationVersion(sessionID: string) {
    conversationVersionRef.current[sessionID] = (conversationVersionRef.current[sessionID] ?? 0) + 1
  }

  function persistCurrentSessionUserMessages(sessionID: string) {
    persistUserMessages(sessionID, conversationStore.getSessionMessages(sessionID))
  }

  function commitSessionTurnUpdate(
    sessionID: string,
    updater: (turns: ConversationTurnMap[string]) => ConversationTurnMap[string],
    options: { persistUsers?: boolean } = {},
  ) {
    const didUpdate = updateConversationTurns((current) => {
      const currentTurns = current[sessionID] ?? []
      const nextTurns = updater(currentTurns)
      return nextTurns === currentTurns ? current : { ...current, [sessionID]: nextTurns }
    })

    if (didUpdate) {
      bumpConversationVersion(sessionID)
      if (options.persistUsers) {
        persistCurrentSessionUserMessages(sessionID)
      }
    }

    return didUpdate
  }

  function applyRuntimeTurnEventToConversationTurns(input: {
    backendSessionID: string
    fallbackUserMessageID?: string
    streamEvent: { event: string; data: unknown }
    uiSessionID: string
  }) {
    const runtimeEvent = readRuntimeStreamEvent(input.streamEvent.data)
    if (!runtimeEvent) return

    const turnID = readString(runtimeEvent.turnID)
    if (!turnID) return

    const timestamp = readStreamNumber(runtimeEvent.timestamp) ?? Date.now()
    const payload = readRecord(runtimeEvent.payload)
    const payloadPhase = readString(payload?.phase)
    const payloadStatus = readString(payload?.status)
    const userMessageID = readString(payload?.userMessageID) ?? input.fallbackUserMessageID
    const isTerminalTurnEvent =
      runtimeEvent.type === "turn.completed" ||
      runtimeEvent.type === "turn.failed" ||
      runtimeEvent.type === "turn.cancelled"
    const status =
      runtimeEvent.type === "turn.failed"
        ? "failed"
        : runtimeEvent.type === "turn.cancelled"
          ? "cancelled"
          : isTerminalTurnEvent
            ? payloadStatus || "completed"
            : "running"

    if (
      runtimeEvent.type !== "turn.started" &&
      runtimeEvent.type !== "turn.state.changed" &&
      !isTerminalTurnEvent
    ) {
      return
    }

    const didUpdate = updateConversationTurns((current) => {
      const currentTurns = current[input.uiSessionID] ?? []
      const ensuredTurns = ensureThreadTurn(currentTurns, {
        turnID,
        backendSessionID: input.backendSessionID,
        status: status as Parameters<typeof ensureThreadTurn>[1]["status"],
        phase: payloadPhase as Parameters<typeof ensureThreadTurn>[1]["phase"],
        userMessageID,
        timestamp,
      })
      const nextTurns = isTerminalTurnEvent
        ? ensuredTurns.map((turn) => (
            turn.turnID === turnID
              ? {
                  ...turn,
                  completedAt: timestamp,
                  updatedAt: Math.max(turn.updatedAt, timestamp),
                }
              : turn
          ))
        : ensuredTurns

      return nextTurns === currentTurns ? current : { ...current, [input.uiSessionID]: nextTurns }
    })

    if (didUpdate) bumpConversationVersion(input.uiSessionID)
  }

  function clearSessionDiffRefreshTimer(sessionID: string) {
    clearSessionDiffRefreshTimerService(sessionID, sessionDiffRefreshTimerRef)
  }

  function scheduleSessionDiffRefreshForSession(sessionID: string) {
    scheduleSessionDiffRefreshForSessionService({
      loadSessionDiffForSession,
      sessionDiffRefreshTimerRef,
      sessionID,
    })
  }

  function clearRuntimeDebugRefreshTimer(sessionID: string) {
    clearRuntimeDebugRefreshTimerService(sessionID, runtimeDebugRefreshTimerRef)
  }

  function applySessionTasksSnapshot(sessionID: string, tasks: SessionTaskListView | null) {
    if (!tasks) return
    setSessionTasksBySession((prev) => (
      sessionTaskListsAreEquivalentService(prev[sessionID], tasks)
        ? prev
        : {
            ...prev,
            [sessionID]: tasks,
          }
    ))
  }

  function ensureBackgroundObservedSession(sessionID: string | null) {
    if (!sessionID) return

    updateConversationTurns((current) => ensureConversationTurnSessions(current, [sessionID]))
    setBackgroundObservedSessionIDs((current) => (
      current.includes(sessionID)
        ? current
        : [...current, sessionID]
    ))
  }

  function clearBackgroundObservedSession(sessionID: string) {
    setBackgroundObservedSessionIDs((current) => (
      current.includes(sessionID)
        ? current.filter((candidate) => candidate !== sessionID)
        : current
    ))
  }

  function refreshSessionTasksForStreamEvent(input: {
    sessionID: string
    backendSessionID?: string
    streamEvent: { event: string; data: unknown }
    errorPrefix: string
  }) {
    const isTaskStateEvent = isTaskStateStreamEvent(input.streamEvent)
    const childSessionID = readSubagentCreatedChildSessionID(input.streamEvent)
    if (!isTaskStateEvent && !childSessionID) return

    refreshWorkspaceForSession(input.sessionID)
    ensureBackgroundObservedSession(childSessionID)
    if (isTaskStateEvent) {
      applySessionTasksSnapshot(input.sessionID, readSessionTaskListViewFromStreamEvent(input.streamEvent))
    }
    void loadSessionTasksForSession(input.sessionID, input.backendSessionID ?? resolveBackendSessionID(input.sessionID), {
      force: true,
      mode: "silent",
      reason: "stream",
    }).catch((error) => {
      console.error(input.errorPrefix, error)
    })
  }

  useEffect(() => {
    if (isRuntimeDebugEnabled) return
    for (const sessionID of Object.keys(runtimeDebugRefreshTimerRef.current)) {
      clearRuntimeDebugRefreshTimer(sessionID)
    }
  }, [isRuntimeDebugEnabled])

  async function refreshWorkspaceFromDirectory(directory: string) {
    return refreshWorkspaceFromDirectoryService({
      directory,
      setAgentSessions,
      setCanLoadSessionHistory,
      setConversations,
      setSessionDirectoryBySession,
      setWorkspaces,
      workspaceRefreshRequestRef,
    })
  }

  function refreshWorkspaceForSession(sessionID: string) {
    const { workspace } = findSession(workspaces, sessionID)
    if (!workspace) return
    void refreshWorkspaceFromDirectory(workspace.directory)
  }

  function resolveUISessionID(backendSessionID: string) {
    const directMatch = agentSessions[backendSessionID]
    if (directMatch === backendSessionID || conversationStore.hasSession(backendSessionID)) {
      return backendSessionID
    }

    for (const [uiSessionID, mappedBackendSessionID] of Object.entries(agentSessions)) {
      if (mappedBackendSessionID === backendSessionID) {
        return uiSessionID
      }
    }

    return conversationStore.hasSession(backendSessionID) ? backendSessionID : null
  }

  function resolveBackendSessionID(sessionID: string) {
    return agentSessions[sessionID] ?? sessionID
  }

  function findAssistantThreadMessageIDByMessageID(sessionID: string, messageID: string | undefined) {
    if (!messageID) return undefined
    const message = conversationStore.getSessionMessages(sessionID).find(
      (candidate): candidate is AssistantThreadMessage =>
        candidate.kind === "assistant" &&
        (candidate.messageID === messageID || candidate.items.some((item) => item.messageID === messageID)),
    )
    return message?.id
  }

  function findAssistantThreadMessageIDBySegmentID(sessionID: string, segmentID: string | undefined) {
    if (!segmentID) return undefined
    const messages = conversationStore.getSessionMessages(sessionID)
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index]
      if (message?.kind !== "assistant") continue
      if (message.segmentID === segmentID) return message.id
    }
    return undefined
  }

  function findAssistantThreadMessageIDByTurnTarget(sessionID: string, currentSegmentID: string | undefined, assistantThreadMessageID: string | undefined) {
    return findAssistantThreadMessageIDBySegmentID(sessionID, currentSegmentID) ?? assistantThreadMessageID
  }

  function cleanupTurnTarget(backendSessionID: string | undefined, turnID: string | undefined) {
    sessionEventRouterRef.current.cleanupTurnTarget(backendSessionID, turnID)
  }

  function cleanupPendingStreamsForBackendTurn(backendSessionID: string | undefined, turnID: string | undefined) {
    if (!backendSessionID || !turnID) return

    for (const [streamID, target] of Object.entries(pendingStreamsRef.current)) {
      if (target.backendSessionID === backendSessionID && target.backendTurnID === turnID) {
        delete pendingStreamsRef.current[streamID]
        if (target.pendingInputID) {
          removePendingConversationInputForSession(target.sessionID, target.pendingInputID)
        }
      }
    }
  }

  function clearCancellingSession(sessionID: string) {
    setCancellingSessionIDs((current) => {
      if (!current[sessionID]) return current
      const next = { ...current }
      delete next[sessionID]
      return next
    })
  }

  function replaceConversationMessages(sessionID: string, nextMessages: ThreadMessage[]) {
    bumpConversationVersion(sessionID)
    setConversations((prev) => ({
      ...prev,
      [sessionID]: reconcileConversationMessages(nextMessages),
    }))
  }

  function appendConversationMessages(sessionID: string, nextMessages: ThreadMessage[]) {
    commitSessionTurnUpdate(
      sessionID,
      (currentTurns) => appendMessagesToThreadTurns(currentTurns, nextMessages),
      { persistUsers: nextMessages.some((message) => message.kind === "user") },
    )
  }

  function clearLatestSteerUserMessageForAssistant(sessionID: string, assistantThreadMessageID: string) {
    commitSessionTurnUpdate(sessionID, (currentTurns) => {
      const current = deriveActiveMessages(currentTurns)
      let targetIndex = -1
      for (let index = current.length - 1; index >= 0; index -= 1) {
        const message = current[index]
        if (
          message?.kind === "user" &&
          message.submissionMode === "steer" &&
          (!message.streamInsertion || message.streamInsertion.assistantThreadMessageID === assistantThreadMessageID)
        ) {
          targetIndex = index
          break
        }
      }

      if (targetIndex < 0) return currentTurns

      const targetMessageID = current[targetIndex]?.id
      return mapMessageInTurns(currentTurns, (message) => {
        if (message.id !== targetMessageID || message.kind !== "user") return message
        const { submissionMode: _submissionMode, streamInsertion: _streamInsertion, ...regularMessage } = message
        return regularMessage
      })
    }, { persistUsers: true })
  }

  function applyExecutionModeToUserThreadMessage(input: {
    sessionID: string
    userThreadMessageID: string
    assistantThreadMessageID: string
    mode: AgentSessionExecutionMode
  }) {
    commitSessionTurnUpdate(input.sessionID, (currentTurns) =>
      mapMessageInTurns(currentTurns, (message) => {
        if (message.kind !== "user" || message.id !== input.userThreadMessageID) return message

        if (input.mode === "steer") {
          return message
        }

        if (input.mode === "queued") {
          const { streamInsertion: _streamInsertion, ...queuedMessage } = message
          const nextMessage: UserThreadMessage = {
            ...queuedMessage,
            submissionMode: "queued",
          }
          return message.submissionMode !== nextMessage.submissionMode || Boolean(message.streamInsertion)
            ? nextMessage
            : message
        }

        const { submissionMode: _submissionMode, streamInsertion: _streamInsertion, ...regularMessage } = message
        return message.submissionMode || message.streamInsertion ? regularMessage : message
      }), { persistUsers: true })
  }

  function revealBackendRecordedUserThreadMessage(input: {
    sessionID: string
    userThreadMessageID: string
    beforeMessageID?: string
  }) {
    if (commitPendingConversationInputAsUserThreadMessage({
      sessionID: input.sessionID,
      inputID: input.userThreadMessageID,
      beforeMessageID: input.beforeMessageID,
    })) {
      return
    }

    commitSessionTurnUpdate(input.sessionID, (currentTurns) =>
      mapMessageInTurns(currentTurns, (message) => {
        if (message.kind !== "user" || message.id !== input.userThreadMessageID) return message
        const {
          submissionMode: _submissionMode,
          streamInsertion: _streamInsertion,
          ...regularMessage
        } = message
        return message.submissionMode || message.streamInsertion ? regularMessage : message
      }), { persistUsers: true })
  }

  function findPendingConversationInput(sessionID: string, inputID: string) {
    const stateInput = (pendingConversationInputsBySessionRef.current[sessionID] ?? []).find((input) => input.id === inputID)
    if (stateInput) return stateInput

    return Object.values(pendingStreamsRef.current).find((stream) =>
      stream.sessionID === sessionID &&
      stream.pendingInputID === inputID
    )?.pendingInput ?? null
  }

  function readAssistantItemCount(sessionID: string, assistantThreadMessageID: string | undefined) {
    if (!assistantThreadMessageID) return 0
    const assistantMessage = conversationStore.getSessionMessages(sessionID).find(
      (message): message is AssistantThreadMessage => message.kind === "assistant" && message.id === assistantThreadMessageID,
    )
    return assistantMessage?.items.length ?? 0
  }

  function removePendingConversationInputForSession(sessionID: string, inputID: string) {
    setPendingConversationInputsBySession((current) =>
      removePendingConversationInput(current, sessionID, inputID),
    )
    for (const stream of Object.values(pendingStreamsRef.current)) {
      if (stream.sessionID === sessionID && stream.pendingInputID === inputID) {
        delete stream.pendingInput
      }
    }
  }

  function updatePendingConversationInputForSession(
    sessionID: string,
    inputID: string,
    updater: (input: PendingConversationInput) => PendingConversationInput,
  ) {
    setPendingConversationInputsBySession((current) =>
      updatePendingConversationInput(current, sessionID, inputID, updater),
    )
    for (const stream of Object.values(pendingStreamsRef.current)) {
      if (stream.sessionID !== sessionID || stream.pendingInputID !== inputID || !stream.pendingInput) continue
      stream.pendingInput = updater(stream.pendingInput)
    }
  }

  function commitPendingConversationInputAsUserThreadMessage(input: {
    sessionID: string
    inputID: string
    beforeMessageID?: string
    streamInsertion?: UserThreadMessage["streamInsertion"]
  }) {
    const pendingInput = findPendingConversationInput(input.sessionID, input.inputID)
    if (!pendingInput) return false

    const userMessage = pendingConversationInputToUserThreadMessage(pendingInput, {
      ...(input.streamInsertion ? { streamInsertion: input.streamInsertion } : {}),
    })
    commitSessionTurnUpdate(
      input.sessionID,
      (currentTurns) => insertUserMessageIntoTurns(currentTurns, userMessage, { beforeMessageID: input.beforeMessageID }),
      { persistUsers: true },
    )
    removePendingConversationInputForSession(input.sessionID, input.inputID)
    return true
  }

  function commitPendingSteerInputAsConsumedInsertion(input: {
    sessionID: string
    inputID: string
    assistantThreadMessageID: string
  }) {
    const pendingInput = findPendingConversationInput(input.sessionID, input.inputID)
    if (!pendingInput || pendingInput.mode !== "steer") return false

    return commitPendingConversationInputAsUserThreadMessage({
      sessionID: input.sessionID,
      inputID: input.inputID,
      beforeMessageID: undefined,
      streamInsertion: {
        assistantThreadMessageID: input.assistantThreadMessageID,
        afterItemCount: pendingInput.afterItemCount ?? readAssistantItemCount(input.sessionID, input.assistantThreadMessageID),
        status: "consumed",
      },
    })
  }

  function revealPendingSteerUserMessagesAtHandoff(input: {
    sessionID: string
    assistantThreadMessageID: string
  }) {
    commitSessionTurnUpdate(input.sessionID, (currentTurns) =>
      mapMessageInTurns(currentTurns, (message) => {
        if (message.kind !== "user" || message.submissionMode !== "steer") return message
        if (
          message.streamInsertion &&
          (message.streamInsertion.assistantThreadMessageID !== input.assistantThreadMessageID ||
            message.streamInsertion.status === "consumed")
        ) {
          return message
        }

        const { submissionMode: _submissionMode, streamInsertion: _streamInsertion, ...regularMessage } = message
        return regularMessage
      }), { persistUsers: true })
  }

  function revealPendingUserThreadMessageForBackendEvent(input: {
    uiSessionID: string
    backendSessionID: string
    backendTurnID: string
  }) {
    const pending = Object.values(pendingStreamsRef.current).find((target) =>
      target.sessionID === input.uiSessionID &&
      (target.backendSessionID ?? input.backendSessionID) === input.backendSessionID &&
      target.backendTurnID === input.backendTurnID &&
      Boolean(target.userThreadMessageID)
    )
    if (!pending?.userThreadMessageID) return
    revealBackendRecordedUserThreadMessage({
      sessionID: pending.sessionID,
      userThreadMessageID: pending.userThreadMessageID,
      beforeMessageID: pending.assistantThreadMessageID,
    })
  }

  function markPendingSteerUserMessagesConsumed(sessionID: string, assistantThreadMessageID: string) {
    commitSessionTurnUpdate(sessionID, (currentTurns) =>
      mapMessageInTurns(currentTurns, (message) => {
        if (
          message.kind !== "user" ||
          message.submissionMode !== "steer" ||
          message.streamInsertion?.assistantThreadMessageID !== assistantThreadMessageID ||
          message.streamInsertion.status !== "pending"
        ) {
          return message
        }

        return {
          ...message,
          streamInsertion: {
            ...message.streamInsertion,
            status: "consumed",
          },
        }
      }), { persistUsers: true })
  }

  function removeConversationMessage(sessionID: string, messageID: string) {
    commitSessionTurnUpdate(
      sessionID,
      (currentTurns) => removeMessageFromTurns(currentTurns, messageID),
      { persistUsers: true },
    )
  }

  function ensureAssistantConversationMessage(input: {
    sessionID: string
    assistantThreadMessageID: string
    presentation: SessionStreamingPresentation
    identity?: Partial<Pick<AssistantThreadMessage, "backendTurnID" | "segmentID" | "messageID" | "llmCallID">>
  }) {
    if (conversationStore.getSessionMessages(input.sessionID).some(
      (message) => message.kind === "assistant" && message.id === input.assistantThreadMessageID,
    )) {
      return
    }

    commitSessionTurnUpdate(input.sessionID, (currentTurns) =>
      appendMessagesToThreadTurns(currentTurns, [
        buildSessionStreamingAssistantThreadMessageWithID(
          input.assistantThreadMessageID,
          input.presentation,
          input.identity,
        ),
      ]))
  }

  function updateAssistantConversationMessage(
    sessionID: string,
    assistantMessageID: string,
    updater: (message: AssistantThreadMessage) => AssistantThreadMessage,
  ) {
    if (appendAssistantDelta(sessionID, assistantMessageID, updater)) {
      bumpConversationVersion(sessionID)
    }
  }

  function clearPendingDeltaFlushTimer() {
    pendingDeltaFlushCancelRef.current?.()
    pendingDeltaFlushCancelRef.current = null
  }

  function logStreamDeltaBackpressure(
    droppedCount: number,
    queuedCount: number,
    event: AgentSessionStreamIPCEvent | AgentStreamIPCEvent,
  ) {
    const now = Date.now()
    if (now - lastDeltaBackpressureLogAtRef.current < STREAM_DELTA_BACKPRESSURE_LOG_INTERVAL_MS) return
    lastDeltaBackpressureLogAtRef.current = now

    console.warn("[desktop] stream delta backpressure; dropped live renderer delta events", {
      droppedCount,
      event: event.event,
      eventID: event.id,
      queuedCount,
      sessionID: "sessionID" in event ? event.sessionID : undefined,
      streamID: "streamID" in event ? event.streamID : undefined,
    })
  }

  function enqueuePendingDeltaUpdate(update: PendingStreamDeltaUpdate) {
    const pendingUpdates = pendingDeltaUpdatesRef.current
    pendingUpdates.push({
      ...update,
      event: compactHighFrequencyDeltaStreamEvent(update.event),
    })

    if (pendingUpdates.length > STREAM_DELTA_PENDING_EVENT_LIMIT) {
      const droppedCount = pendingUpdates.length - STREAM_DELTA_PENDING_EVENT_LIMIT
      pendingUpdates.splice(0, droppedCount)
      logStreamDeltaBackpressure(droppedCount, pendingUpdates.length, update.event)
    }

    schedulePendingDeltaFlush()
  }

  function flushPendingDeltaUpdates(options: { forceAll?: boolean } = {}) {
    const pendingUpdates = pendingDeltaUpdatesRef.current
    if (pendingUpdates.length === 0) {
      clearPendingDeltaFlushTimer()
      return
    }

    const flushCount = options.forceAll
      ? pendingUpdates.length
      : Math.min(pendingUpdates.length, STREAM_DELTA_EVENTS_PER_FRAME)
    const updatesToFlush = pendingUpdates.slice(0, flushCount)
    pendingDeltaUpdatesRef.current = pendingUpdates.slice(flushCount)
    clearPendingDeltaFlushTimer()

    const groupedUpdates = new Map<string, Map<string, PendingStreamDeltaUpdate["event"][]>>()

    for (const update of updatesToFlush) {
      const updatesByAssistantThreadMessageID =
        groupedUpdates.get(update.target.sessionID) ?? new Map<string, PendingStreamDeltaUpdate["event"][]>()
      const events = updatesByAssistantThreadMessageID.get(update.target.assistantThreadMessageID) ?? []
      events.push(update.event)
      updatesByAssistantThreadMessageID.set(update.target.assistantThreadMessageID, events)
      groupedUpdates.set(update.target.sessionID, updatesByAssistantThreadMessageID)
    }

    startTransition(() => {
      for (const [sessionID, updatesByAssistantThreadMessageID] of groupedUpdates) {
        let didUpdateSession = false
        for (const [assistantThreadMessageID, streamEvents] of updatesByAssistantThreadMessageID) {
          const didUpdateMessage = appendAssistantDelta(sessionID, assistantThreadMessageID, (message) =>
            streamEvents.reduce(
              (nextMessage, streamEvent) => applyAgentStreamEventToThreadMessage(nextMessage, streamEvent),
              message,
            ),
          )
          didUpdateSession ||= didUpdateMessage
        }

        if (didUpdateSession) {
          bumpConversationVersion(sessionID)
        }
      }
    })

    if (pendingDeltaUpdatesRef.current.length > 0) {
      schedulePendingDeltaFlush()
    }
  }

  function schedulePendingDeltaFlush() {
    if (pendingDeltaFlushCancelRef.current !== null) return

    pendingDeltaFlushCancelRef.current = queueRendererStreamFlush(() => {
      pendingDeltaFlushCancelRef.current = null
      flushPendingDeltaUpdates()
    }, {
      interactiveIntervalMs: STREAM_DELTA_FLUSH_INTERVAL_MS,
    })
  }

  function applyStreamEventToAssistantMessage(
    target: StreamEventUpdateTarget,
    streamEvent: AgentSessionStreamIPCEvent | AgentStreamIPCEvent,
    presentation: SessionStreamingPresentation,
  ) {
    ensureAssistantConversationMessage({
      sessionID: target.sessionID,
      assistantThreadMessageID: target.assistantThreadMessageID,
      presentation,
      identity: target.identity,
    })

    if (isHighFrequencyDeltaStreamEvent(streamEvent)) {
      enqueuePendingDeltaUpdate({ target, event: streamEvent })
      return
    }

    flushPendingDeltaUpdates({ forceAll: true })
    startTransition(() => {
      updateAssistantConversationMessage(target.sessionID, target.assistantThreadMessageID, (message) =>
        applyAgentStreamEventToThreadMessage(message, streamEvent),
      )
    })
  }

  useEffect(() => {
    return () => {
      pendingDeltaUpdatesRef.current = []
      clearPendingDeltaFlushTimer()
    }
  }, [])

  function replaceConversationMessagesFromHistory(
    sessionID: string,
    nextMessages: ThreadMessage[],
    options?: { preserveUserPresentation?: boolean },
  ) {
    bumpConversationVersion(sessionID)
    setConversations((prev) => {
      const currentMessages = prev[sessionID] ?? []
      const previousMessages = currentMessages.length ? currentMessages : readPersistedUserMessages(sessionID)
      const mergedMessages = reconcileConversationMessages(mergeConversationMessagesFromHistory(previousMessages, nextMessages, {
        preserveUserPresentation: options?.preserveUserPresentation,
      }))
      if (conversationMessagesAreEquivalent(currentMessages, mergedMessages)) return prev

      persistUserMessages(sessionID, mergedMessages)
      return {
        ...prev,
        [sessionID]: mergedMessages,
      }
    })
  }

  function ensureAssistantMessageForBackendTurn(input: {
    uiSessionID: string
    backendSessionID: string
    turnID: string
    presentation: SessionStreamingPresentation
  }) {
    const existing = sessionEventRouterRef.current.getTurnTarget(input.backendSessionID, input.turnID)
    if (existing?.assistantThreadMessageID) {
      return existing.assistantThreadMessageID
    }

    const pending = findPendingStreamForBackendTurn(pendingStreamsRef.current, {
      sessionID: input.uiSessionID,
      backendSessionID: input.backendSessionID,
      turnID: input.turnID,
    })

    if (pending) {
      if (!pending.backendTurnID) {
        pending.backendTurnID = input.turnID
      }
      sessionEventRouterRef.current.setTurnTarget(input.backendSessionID, input.turnID, {
        sessionID: input.uiSessionID,
        turnID: input.turnID,
        assistantThreadMessageID: pending.assistantThreadMessageID,
      })
      return pending.assistantThreadMessageID
    }

    const streamingMessage = buildSessionStreamingAssistantThreadMessage(input.presentation, {
      backendTurnID: input.turnID,
      segmentID: `pending:${input.turnID}`,
    })
    sessionEventRouterRef.current.setTurnTarget(input.backendSessionID, input.turnID, {
      sessionID: input.uiSessionID,
      turnID: input.turnID,
      assistantThreadMessageID: streamingMessage.id,
    })

    appendConversationMessages(input.uiSessionID, [streamingMessage])

    return streamingMessage.id
  }

  function getAssistantConversationMessage(sessionID: string, assistantThreadMessageID: string | undefined) {
    if (!assistantThreadMessageID) return null
    return conversationStore.getSessionMessages(sessionID).find(
      (message): message is AssistantThreadMessage => message.kind === "assistant" && message.id === assistantThreadMessageID,
    ) ?? null
  }

  function canBindAssistantPlaceholderToSegment(
    message: AssistantThreadMessage | null,
    identity: LlmCallSegmentIdentity,
    currentSegmentID: string | undefined,
  ) {
    if (!message || currentSegmentID) return false
    if (message.messageID && identity.messageID && message.messageID !== identity.messageID) return false
    if (message.messageID && !identity.messageID) return false
    return (
      message.segmentID === message.id ||
      message.segmentID.startsWith("pending:") ||
      message.segmentID === identity.segmentID
    )
  }

  function bindAssistantMessageToSegment(
    sessionID: string,
    assistantThreadMessageID: string,
    identity: LlmCallSegmentIdentity,
  ) {
    updateAssistantConversationMessage(sessionID, assistantThreadMessageID, (message) => ({
      ...message,
      backendTurnID: identity.backendTurnID,
      segmentID: identity.segmentID,
      llmCallID: identity.llmCallID,
      ...(identity.messageID ? { messageID: identity.messageID } : {}),
    }))
  }

  function ensureAssistantSegmentForLlmCall(input: {
    uiSessionID: string
    backendSessionID: string
    turnID: string
    identity: LlmCallSegmentIdentity
    presentation: SessionStreamingPresentation
  }) {
    const existingSegmentAssistantThreadMessageID = findAssistantThreadMessageIDBySegmentID(
      input.uiSessionID,
      input.identity.segmentID,
    )
    if (existingSegmentAssistantThreadMessageID) return existingSegmentAssistantThreadMessageID

    const existingTarget = sessionEventRouterRef.current.getTurnTarget(input.backendSessionID, input.turnID)
    const targetAssistant = getAssistantConversationMessage(input.uiSessionID, existingTarget?.assistantThreadMessageID)
    if (
      existingTarget?.assistantThreadMessageID &&
      canBindAssistantPlaceholderToSegment(targetAssistant, input.identity, existingTarget.currentSegmentID)
    ) {
      bindAssistantMessageToSegment(input.uiSessionID, existingTarget.assistantThreadMessageID, input.identity)
      return existingTarget.assistantThreadMessageID
    }

    const pending = findPendingStreamForBackendTurn(pendingStreamsRef.current, {
      sessionID: input.uiSessionID,
      backendSessionID: input.backendSessionID,
      turnID: input.turnID,
    })
    const pendingAssistant = getAssistantConversationMessage(input.uiSessionID, pending?.assistantThreadMessageID)
    if (
      pending?.assistantThreadMessageID &&
      canBindAssistantPlaceholderToSegment(pendingAssistant, input.identity, existingTarget?.currentSegmentID)
    ) {
      if (!pending.backendTurnID) {
        pending.backendTurnID = input.turnID
      }
      bindAssistantMessageToSegment(input.uiSessionID, pending.assistantThreadMessageID, input.identity)
      return pending.assistantThreadMessageID
    }

    const streamingMessage = buildSessionStreamingAssistantThreadMessage(input.presentation, input.identity)
    appendConversationMessages(input.uiSessionID, [streamingMessage])
    return streamingMessage.id
  }

  async function mergeExternalTurnUserHistory(input: {
    uiSessionID: string
    backendSessionID: string
    backendTurnID: string
    assistantThreadMessageID: string
  }) {
    if (!canLoadSessionHistory) return
    const refreshKey = `${input.backendSessionID}:${input.backendTurnID}`
    if (externalTurnUserHistoryMergedRef.current.has(refreshKey)) return
    if (externalTurnHistoryRefreshInFlightRef.current.has(refreshKey)) return

    const now = Date.now()
    const lastAttemptAt = externalTurnHistoryLastAttemptAtRef.current[refreshKey] ?? 0
    if (now - lastAttemptAt < EXTERNAL_TURN_HISTORY_REFRESH_RETRY_MS) return
    externalTurnHistoryLastAttemptAtRef.current[refreshKey] = now
    externalTurnHistoryRefreshInFlightRef.current.add(refreshKey)

    const agentSession = getAgentSessionBridge()
    if (!agentSession) {
      externalTurnHistoryRefreshInFlightRef.current.delete(refreshKey)
      return
    }

    try {
      const messages = await agentSession.loadHistory({ backendSessionID: input.backendSessionID }) ?? []
      const historyMessages = buildThreadMessagesFromHistory(messages)
      const currentMessages = conversationStore.getSessionMessages(input.uiSessionID)
      const candidateMessages = mergeExternalUserMessagesFromHistory(currentMessages, historyMessages, {
        beforeMessageID: input.assistantThreadMessageID,
      })
      if (conversationMessagesAreEquivalent(currentMessages, candidateMessages)) return

      externalTurnUserHistoryMergedRef.current.add(refreshKey)
      startTransition(() => {
        const didUpdate = updateConversationTurns((current) => {
          const currentTurns = current[input.uiSessionID] ?? []
          const currentMessages = deriveActiveMessages(currentTurns)
          const mergedMessages = mergeExternalUserMessagesFromHistory(currentMessages, historyMessages, {
            beforeMessageID: input.assistantThreadMessageID,
          })
          if (conversationMessagesAreEquivalent(currentMessages, mergedMessages)) return current
          const nextTurns = buildThreadTurnsFromMessages(mergedMessages, currentTurns)
          return {
            ...current,
            [input.uiSessionID]: nextTurns,
          }
        })
        if (didUpdate) {
          bumpConversationVersion(input.uiSessionID)
          persistCurrentSessionUserMessages(input.uiSessionID)
        }
      })
    } catch (error) {
      console.error("[desktop] external session user message history refresh failed:", error)
    } finally {
      externalTurnHistoryRefreshInFlightRef.current.delete(refreshKey)
    }
  }

  function applyExecutionModeToPendingRequest(streamID: string, executionMode: ExecutionModeEventPayload) {
    const target = pendingStreamsRef.current[streamID]
    if (!target) return

    const backendSessionID = executionMode.sessionID || target.backendSessionID || resolveBackendSessionID(target.sessionID)
    const backendTurnID = executionMode.turnID
    if (sessionEventRouterRef.current.hasBackendTurnSettled(backendSessionID, backendTurnID)) {
      delete pendingStreamsRef.current[streamID]
      if (target.pendingInputID) {
        removePendingConversationInputForSession(target.sessionID, target.pendingInputID)
      }
      cleanupTurnTarget(backendSessionID, backendTurnID)
      return
    }

    const previousAssistantThreadMessageID = target.assistantThreadMessageID
    target.backendSessionID = backendSessionID
    target.backendTurnID = backendTurnID
    target.executionMode = executionMode.mode

    const existingTarget = sessionEventRouterRef.current.getTurnTarget(backendSessionID, backendTurnID)

    const route = resolveExecutionModeRoute({
      mode: executionMode.mode,
      requestedMode: target.requestedMode,
      currentAssistantThreadMessageID: target.assistantThreadMessageID,
      createdAssistantThreadMessageID: target.createdAssistantThreadMessageID,
      existingAssistantThreadMessageID: existingTarget?.assistantThreadMessageID,
    })

    if (route.createAssistantThreadMessage) {
      const streamingMessage = buildSessionStreamingAssistantThreadMessage(LIVE_SESSION_ACTIVITY_PRESENTATION)
      target.assistantThreadMessageID = streamingMessage.id
      target.createdAssistantThreadMessageID = streamingMessage.id
      appendConversationMessages(target.sessionID, [streamingMessage])
    } else {
      target.assistantThreadMessageID = route.assistantThreadMessageID
    }

    if (route.removeAssistantThreadMessageID) {
      removeConversationMessage(target.sessionID, route.removeAssistantThreadMessageID)
    }

    if (target.pendingInputID) {
      if (executionMode.mode === "new-turn") {
        commitPendingConversationInputAsUserThreadMessage({
          sessionID: target.sessionID,
          inputID: target.pendingInputID,
          beforeMessageID: target.assistantThreadMessageID,
        })
      } else {
        updatePendingConversationInputForSession(
          target.sessionID,
          target.pendingInputID,
          (pendingInput) => ({
            ...pendingInput,
            status: executionMode.mode === "steer" ? "accepted" : "pending",
            ...(executionMode.mode === "steer"
              ? {
                  targetAssistantThreadMessageID: target.assistantThreadMessageID,
                  afterItemCount: pendingInput.afterItemCount ?? readAssistantItemCount(target.sessionID, target.assistantThreadMessageID),
                }
              : {}),
          }),
        )
      }
    }

    if (target.userThreadMessageID && !target.pendingInputID) {
      applyExecutionModeToUserThreadMessage({
        sessionID: target.sessionID,
        userThreadMessageID: target.userThreadMessageID,
        assistantThreadMessageID: target.assistantThreadMessageID,
        mode: executionMode.mode,
      })
    } else if (route.clearSteerUserMessage) {
      clearLatestSteerUserMessageForAssistant(target.sessionID, previousAssistantThreadMessageID)
    }

    sessionEventRouterRef.current.setTurnTarget(backendSessionID, backendTurnID, {
      sessionID: target.sessionID,
      turnID: backendTurnID,
      currentSegmentID: existingTarget?.currentSegmentID,
      assistantThreadMessageID: target.assistantThreadMessageID,
    })
  }

  function handleRequestStreamEvent(streamEvent: AgentStreamIPCEvent) {
    const target = pendingStreamsRef.current[streamEvent.streamID]
    if (!target) return

    const backendSessionID = target.backendSessionID ?? resolveBackendSessionID(target.sessionID)
    clearSessionStreamReconnectReplayWindow(reconnectReplayWindowsRef.current, backendSessionID)

    const executionMode = readExecutionModeEvent(streamEvent)
    if (executionMode) {
      applyExecutionModeToPendingRequest(streamEvent.streamID, executionMode)
      return
    }

    const cursor = resolveStreamCursor(streamEvent)
    if (cursor && sessionEventRouterRef.current.rememberSeenCursor(target.sessionID, cursor)) {
      const backendTurnID = resolveStreamTurnID(streamEvent)
      if (backendTurnID && isTerminalStreamEvent(streamEvent)) {
        delete pendingStreamsRef.current[streamEvent.streamID]
        if (target.pendingInputID) {
          removePendingConversationInputForSession(target.sessionID, target.pendingInputID)
        }
        cleanupTurnTarget(backendSessionID, backendTurnID)
      }
      return
    }

    onSessionCanvasActivity(target.sessionID)

    const backendTurnID = resolveStreamTurnID(streamEvent)
    const streamMessageID = resolveStreamMessageID(streamEvent)
    const turnTarget = backendTurnID ? sessionEventRouterRef.current.getTurnTarget(backendSessionID, backendTurnID) : null
    const llmSegmentIdentity = resolveLlmCallSegmentIdentity(streamEvent, backendTurnID)
    const segmentAssistantThreadMessageID = findAssistantThreadMessageIDBySegmentID(
      target.sessionID,
      llmSegmentIdentity?.segmentID ?? turnTarget?.currentSegmentID,
    )
    const messageAssistantThreadMessageID = turnTarget?.currentSegmentID
      ? undefined
      : findAssistantThreadMessageIDByMessageID(target.sessionID, streamMessageID)
    if (backendTurnID) {
      if (sessionEventRouterRef.current.hasBackendTurnSettled(backendSessionID, backendTurnID)) {
        delete pendingStreamsRef.current[streamEvent.streamID]
        if (target.pendingInputID) {
          removePendingConversationInputForSession(target.sessionID, target.pendingInputID)
        }
        cleanupTurnTarget(backendSessionID, backendTurnID)
        return
      }

      target.backendSessionID = backendSessionID
      target.backendTurnID = backendTurnID
      applyRuntimeTurnEventToConversationTurns({
        uiSessionID: target.sessionID,
        backendSessionID,
        streamEvent,
        fallbackUserMessageID: target.userThreadMessageID,
      })
    }

    const assistantThreadMessageID = llmSegmentIdentity && backendTurnID
      ? ensureAssistantSegmentForLlmCall({
          uiSessionID: target.sessionID,
          backendSessionID,
          turnID: backendTurnID,
          identity: llmSegmentIdentity,
          presentation: LIVE_SESSION_ACTIVITY_PRESENTATION,
        })
      : segmentAssistantThreadMessageID ??
        messageAssistantThreadMessageID ??
        findAssistantThreadMessageIDByTurnTarget(
          target.sessionID,
          turnTarget?.currentSegmentID,
          turnTarget?.assistantThreadMessageID,
        ) ??
        target.assistantThreadMessageID
    if (llmSegmentIdentity) {
      target.assistantThreadMessageID = assistantThreadMessageID
    }

    if (backendTurnID) {
      sessionEventRouterRef.current.setTurnTarget(backendSessionID, backendTurnID, {
        sessionID: target.sessionID,
        turnID: backendTurnID,
        currentSegmentID: llmSegmentIdentity?.segmentID ?? turnTarget?.currentSegmentID,
        assistantThreadMessageID,
      })
    }

    applyStreamEventToAssistantMessage(
      {
        sessionID: target.sessionID,
        assistantThreadMessageID,
        identity: llmSegmentIdentity ?? undefined,
      },
      streamEvent,
      LIVE_SESSION_ACTIVITY_PRESENTATION,
    )
    if (target.userThreadMessageID && isBackendUserMessageRecordedStreamEvent(streamEvent)) {
      revealBackendRecordedUserThreadMessage({
        sessionID: target.sessionID,
        userThreadMessageID: target.userThreadMessageID,
        beforeMessageID: assistantThreadMessageID,
      })
    }
    if (isSteerHandoffBoundaryStreamEvent(streamEvent)) {
      if (target.pendingInputID) {
        commitPendingConversationInputAsUserThreadMessage({
          sessionID: target.sessionID,
          inputID: target.pendingInputID,
        })
      }
      revealPendingSteerUserMessagesAtHandoff({
        sessionID: target.sessionID,
        assistantThreadMessageID,
      })
    }
    if (isSteerInputConsumedStreamEvent(streamEvent)) {
      if (
        !target.pendingInputID ||
        !commitPendingSteerInputAsConsumedInsertion({
          sessionID: target.sessionID,
          inputID: target.pendingInputID,
          assistantThreadMessageID,
        })
      ) {
        markPendingSteerUserMessagesConsumed(target.sessionID, assistantThreadMessageID)
      }
    }

    if (isLlmCompletedStreamEvent(streamEvent)) {
      const usage = readSessionContextUsageFromLlmCompletedEventData(streamEvent.data)
      if (usage) {
        updateSessionContextUsage(target.sessionID, usage)
      }
    }

    if (isPermissionRequestStreamEvent(streamEvent)) {
      refreshWorkspaceForSession(target.sessionID)
      void loadPendingPermissionRequestsForSession(target.sessionID).catch((error) => {
        console.error("[desktop] stream permission request refresh failed:", error)
      })
    }

    refreshSessionTasksForStreamEvent({
      sessionID: target.sessionID,
      backendSessionID: target.backendSessionID,
      streamEvent,
      errorPrefix: "[desktop] stream task refresh failed:",
    })

    if (shouldRefreshRuntimeDebugForStreamEvent(streamEvent)) {
      scheduleRuntimeDebugRefresh(
        target.sessionID,
        target.backendSessionID ?? resolveBackendSessionID(target.sessionID),
      )
    }

    if (isTerminalStreamEvent(streamEvent)) {
      clearCancellingSession(target.sessionID)
      clearBackgroundObservedSession(target.sessionID)
      if (isCompletedStreamEvent(streamEvent)) {
        updateSessionContextUsage(target.sessionID, readSessionContextUsageFromDoneEventData(streamEvent.data))
      }
      sessionEventRouterRef.current.markBackendTurnSettled(target.backendSessionID, target.backendTurnID)
      delete pendingStreamsRef.current[streamEvent.streamID]
      if (target.pendingInputID) {
        removePendingConversationInputForSession(target.sessionID, target.pendingInputID)
      }
      cleanupTurnTarget(target.backendSessionID, target.backendTurnID)
      refreshWorkspaceForSession(target.sessionID)

      if (canLoadSessionHistory) {
        void reloadSessionHistoryForSession(target.sessionID).catch((error) => {
          console.error("[desktop] stream history refresh failed:", error)
        })
        void loadSessionDiffForSession(target.sessionID, undefined, { force: true, mode: "silent", reason: "stream" }).catch((error) => {
          console.error("[desktop] stream diff refresh failed:", error)
        })
        void loadPendingPermissionRequestsForSession(target.sessionID).catch((error) => {
          console.error("[desktop] stream permission refresh failed:", error)
        })
      }
    }
  }

  function handleSessionStreamEvent(streamEvent: AgentSessionStreamIPCEvent) {
    const uiSessionID = resolveUISessionID(streamEvent.sessionID)
    if (!uiSessionID) return

    const cursor = resolveStreamCursor(streamEvent)
    if (cursor && sessionEventRouterRef.current.rememberSeenCursor(uiSessionID, cursor)) {
      return
    }

    onSessionCanvasActivity(uiSessionID)

    const backendTurnID = resolveStreamTurnID(streamEvent)
    if (!backendTurnID) {
      if (isTerminalStreamEvent(streamEvent)) {
        clearSessionStreamReconnectReplayWindow(reconnectReplayWindowsRef.current, streamEvent.sessionID)
        clearCancellingSession(uiSessionID)
        clearBackgroundObservedSession(uiSessionID)
        if (isCompletedStreamEvent(streamEvent)) {
          updateSessionContextUsage(uiSessionID, readSessionContextUsageFromDoneEventData(streamEvent.data))
        }
        refreshWorkspaceForSession(uiSessionID)
        if (shouldRefreshRuntimeDebugForStreamEvent(streamEvent)) {
          scheduleRuntimeDebugRefresh(uiSessionID, streamEvent.sessionID)
        }
        void reloadSessionHistoryForSession(uiSessionID, streamEvent.sessionID).catch((error) => {
          console.error("[desktop] session stream history refresh failed:", error)
        })
      }
      return
    }

    if (sessionEventRouterRef.current.hasBackendTurnSettled(streamEvent.sessionID, backendTurnID)) {
      if (isTerminalStreamEvent(streamEvent)) {
        clearSessionStreamReconnectReplayWindow(reconnectReplayWindowsRef.current, streamEvent.sessionID)
      }
      return
    }

    const sessionStreamPresentation = resolveSessionStreamPlaceholderPresentation({
      windows: reconnectReplayWindowsRef.current,
      backendSessionID: streamEvent.sessionID,
      backendTurnID,
      isTerminal: isTerminalStreamEvent(streamEvent),
    })

    const runtimeType = readRuntimeStreamType(streamEvent)
    const existingTurnTarget = sessionEventRouterRef.current.getTurnTarget(streamEvent.sessionID, backendTurnID)
    applyRuntimeTurnEventToConversationTurns({
      uiSessionID,
      backendSessionID: streamEvent.sessionID,
      streamEvent,
    })
    if (runtimeType === "turn.started" && !existingTurnTarget?.assistantThreadMessageID) {
      sessionEventRouterRef.current.setTurnTarget(streamEvent.sessionID, backendTurnID, {
        sessionID: uiSessionID,
        turnID: backendTurnID,
      })
      if (shouldRefreshRuntimeDebugForStreamEvent(streamEvent)) {
        scheduleRuntimeDebugRefresh(uiSessionID, streamEvent.sessionID)
      }
      return
    }

    const streamMessageID = resolveStreamMessageID(streamEvent)
    const llmSegmentIdentity = resolveLlmCallSegmentIdentity(streamEvent, backendTurnID)
    const segmentAssistantThreadMessageID = findAssistantThreadMessageIDBySegmentID(
      uiSessionID,
      llmSegmentIdentity?.segmentID ?? existingTurnTarget?.currentSegmentID,
    )
    const messageAssistantThreadMessageID = existingTurnTarget?.currentSegmentID
      ? undefined
      : findAssistantThreadMessageIDByMessageID(uiSessionID, streamMessageID)
    const assistantThreadMessageID = llmSegmentIdentity
      ? ensureAssistantSegmentForLlmCall({
          uiSessionID,
          backendSessionID: streamEvent.sessionID,
          turnID: backendTurnID,
          identity: llmSegmentIdentity,
          presentation: sessionStreamPresentation,
        })
      : segmentAssistantThreadMessageID ??
        messageAssistantThreadMessageID ??
        findAssistantThreadMessageIDByTurnTarget(
          uiSessionID,
          existingTurnTarget?.currentSegmentID,
          existingTurnTarget?.assistantThreadMessageID,
        ) ??
        ensureAssistantMessageForBackendTurn({
          uiSessionID,
          backendSessionID: streamEvent.sessionID,
          turnID: backendTurnID,
          presentation: sessionStreamPresentation,
        })
    if (!messageAssistantThreadMessageID && !segmentAssistantThreadMessageID && !existingTurnTarget?.assistantThreadMessageID) {
      void mergeExternalTurnUserHistory({
        uiSessionID,
        backendSessionID: streamEvent.sessionID,
        backendTurnID,
        assistantThreadMessageID,
      })
    }
    sessionEventRouterRef.current.setTurnTarget(streamEvent.sessionID, backendTurnID, {
      sessionID: uiSessionID,
      turnID: backendTurnID,
      currentSegmentID: llmSegmentIdentity?.segmentID ?? existingTurnTarget?.currentSegmentID,
      assistantThreadMessageID,
    })

    applyStreamEventToAssistantMessage(
      {
        sessionID: uiSessionID,
        assistantThreadMessageID,
        identity: llmSegmentIdentity ?? undefined,
      },
      streamEvent,
      sessionStreamPresentation,
    )
    if (isBackendUserMessageRecordedStreamEvent(streamEvent)) {
      revealPendingUserThreadMessageForBackendEvent({
        uiSessionID,
        backendSessionID: streamEvent.sessionID,
        backendTurnID,
      })
    }
    if (isSteerHandoffBoundaryStreamEvent(streamEvent)) {
      revealPendingSteerUserMessagesAtHandoff({
        sessionID: uiSessionID,
        assistantThreadMessageID,
      })
    }
    if (isSteerInputConsumedStreamEvent(streamEvent)) {
      markPendingSteerUserMessagesConsumed(uiSessionID, assistantThreadMessageID)
    }

    if (isLlmCompletedStreamEvent(streamEvent)) {
      const usage = readSessionContextUsageFromLlmCompletedEventData(streamEvent.data)
      if (usage) {
        updateSessionContextUsage(uiSessionID, usage)
      }
    }

    if (isPermissionRequestStreamEvent(streamEvent)) {
      refreshWorkspaceForSession(uiSessionID)
      void loadPendingPermissionRequestsForSession(uiSessionID, streamEvent.sessionID).catch((error) => {
        console.error("[desktop] session stream permission request refresh failed:", error)
      })
    }

    refreshSessionTasksForStreamEvent({
      sessionID: uiSessionID,
      backendSessionID: streamEvent.sessionID,
      streamEvent,
      errorPrefix: "[desktop] session stream task refresh failed:",
    })

    if (shouldRefreshRuntimeDebugForStreamEvent(streamEvent)) {
      scheduleRuntimeDebugRefresh(uiSessionID, streamEvent.sessionID)
    }

    if (isTerminalStreamEvent(streamEvent)) {
      clearCancellingSession(uiSessionID)
      clearBackgroundObservedSession(uiSessionID)
      if (isCompletedStreamEvent(streamEvent)) {
        updateSessionContextUsage(uiSessionID, readSessionContextUsageFromDoneEventData(streamEvent.data))
      }
      sessionEventRouterRef.current.markBackendTurnSettled(streamEvent.sessionID, backendTurnID)
      cleanupPendingStreamsForBackendTurn(streamEvent.sessionID, backendTurnID)
      cleanupTurnTarget(streamEvent.sessionID, backendTurnID)
      refreshWorkspaceForSession(uiSessionID)
      if (canLoadSessionHistory) {
        void reloadSessionHistoryForSession(uiSessionID, streamEvent.sessionID).catch((error) => {
          console.error("[desktop] session stream history refresh failed:", error)
        })
        void loadSessionDiffForSession(uiSessionID, streamEvent.sessionID, { force: true, mode: "silent", reason: "stream" }).catch((error) => {
          console.error("[desktop] session stream diff refresh failed:", error)
        })
        void loadPendingPermissionRequestsForSession(uiSessionID, streamEvent.sessionID).catch((error) => {
          console.error("[desktop] session stream permission refresh failed:", error)
        })
      }
    }
  }

  function handleAgentSessionBridgeEvent(sessionEvent: AgentSessionBridgeEvent) {
    if (sessionEvent.kind === "subscription-state") {
      noteSessionStreamSubscriptionStateForPresentation(reconnectReplayWindowsRef.current, sessionEvent)
      agentSessionStoreRef.current.dispatch({
        type: "subscription.state",
        event: sessionEvent,
      })
      return
    }

    if (sessionEvent.kind === "focus-session") {
      onFocusSession(sessionEvent.backendSessionID, sessionEvent.turnID)
      return
    }

    if (sessionEvent.source === "request") {
      if (!sessionEvent.clientTurnID) return
      handleRequestStreamEvent({
        streamID: sessionEvent.clientTurnID,
        id: sessionEvent.id,
        event: sessionEvent.event,
        data: sessionEvent.data,
      })
      return
    }

    handleSessionStreamEvent({
      sessionID: sessionEvent.backendSessionID,
      id: sessionEvent.id,
      event: sessionEvent.event,
      data: sessionEvent.data,
    })
  }

  async function ensureSessionHistoryLoaded(
    sessionID: string,
    backendSessionID = resolveBackendSessionID(sessionID),
    options: SessionDataLoadOptions = { mode: "silent", reason: "open" },
  ) {
    const agentSession = getAgentSessionBridge()
    if (!agentSession) return

    await ensureSessionDataLoad(sessionDataLoadCacheRef.current, "history", sessionID, backendSessionID, options, async () => {
      const requestID = (historyRequestRef.current[sessionID] ?? 0) + 1
      historyRequestRef.current[sessionID] = requestID
      const baselineVersion = conversationVersionRef.current[sessionID] ?? 0
      const messages = await agentSession.loadHistory({ backendSessionID }) ?? []
      const activeMessageID = messages[messages.length - 1]?.info.id ?? null
      const allMessages = await Promise.resolve(agentSession.loadHistory({ backendSessionID, view: "all" }))
        .then((nextMessages) => nextMessages ?? messages)
        .catch((error) => {
          console.error("[desktop] session message tree refresh failed:", error)
          return messages
        })
      if (historyRequestRef.current[sessionID] !== requestID) return
      if (!options.force && (conversationVersionRef.current[sessionID] ?? 0) !== baselineVersion) return
      const nextContextUsage = readLatestSessionContextUsageFromHistory(messages)
      const nextMessageTree = buildSessionMessageTree(allMessages, activeMessageID)
      startTransition(() => {
        replaceConversationMessagesFromHistory(sessionID, buildThreadMessagesFromHistory(messages), {
          preserveUserPresentation: options.preserveUserPresentation,
        })
        setMessageTreeBySession((current) => {
          if (!nextMessageTree) {
            if (!(sessionID in current)) return current
            const next = { ...current }
            delete next[sessionID]
            return next
          }
          return {
            ...current,
            [sessionID]: nextMessageTree,
          }
        })
        syncSessionContextUsageFromHistory(sessionID, nextContextUsage)
      })
    })
  }

  async function reloadSessionHistoryForSession(
    sessionID: string,
    backendSessionID = resolveBackendSessionID(sessionID),
    options: SessionDataLoadOptions = {},
  ) {
    await ensureSessionHistoryLoaded(sessionID, backendSessionID, {
      force: true,
      mode: "silent",
      reason: "manual",
      ...options,
    })
  }

  async function ensureSessionDiffLoaded(
    sessionID: string,
    backendSessionID = resolveBackendSessionID(sessionID),
    options: SessionDataLoadOptions = { mode: "silent", reason: "open" },
  ) {
    await ensureSessionDataLoad(sessionDataLoadCacheRef.current, "diff", sessionID, backendSessionID, options, async () => {
      await loadSessionDiffForSessionService({
        backendSessionID,
        sessionDiffBySession,
        sessionDiffRefreshTimerRef,
        sessionDiffRequestRef,
        sessionID,
        setSessionDiffBySession,
        setSessionDiffStateBySession,
        options,
      })
    })
  }

  async function loadSessionDiffForSession(
    sessionID: string,
    backendSessionID = resolveBackendSessionID(sessionID),
    options: SessionDataLoadOptions = {},
  ) {
    await ensureSessionDiffLoaded(sessionID, backendSessionID, {
      force: true,
      mode: "visible",
      reason: "manual",
      ...options,
    })
  }

  async function ensureSessionRuntimeDebugLoaded(
    sessionID: string,
    backendSessionID = resolveBackendSessionID(sessionID),
    options?: {
      limit?: number
      turns?: number
    } & SessionDataLoadOptions,
  ) {
    if (!isRuntimeDebugEnabled) {
      clearRuntimeDebugRefreshTimer(sessionID)
      return
    }

    await ensureSessionDataLoad(sessionDataLoadCacheRef.current, "runtime", sessionID, backendSessionID, options ?? { mode: "silent", reason: "open" }, async () => {
      await loadSessionRuntimeDebugForSessionService({
        backendSessionID,
        runtimeDebugRefreshTimerRef,
        runtimeDebugRequestRef,
        sessionID,
        sessionRuntimeDebugBySession,
        setSessionRuntimeDebugBySession,
        setSessionRuntimeDebugStateBySession,
        options,
      })
    })
  }

  async function loadSessionRuntimeDebugForSession(
    sessionID: string,
    backendSessionID = resolveBackendSessionID(sessionID),
    options?: {
      limit?: number
      turns?: number
    } & SessionDataLoadOptions,
  ) {
    await ensureSessionRuntimeDebugLoaded(sessionID, backendSessionID, {
      force: true,
      mode: "visible",
      reason: "manual",
      ...options,
    })
  }

  async function ensureSessionTasksLoaded(
    sessionID: string,
    backendSessionID = resolveBackendSessionID(sessionID),
    options: SessionDataLoadOptions = { mode: "silent", reason: "open" },
  ) {
    await ensureSessionDataLoad(sessionDataLoadCacheRef.current, "tasks", sessionID, backendSessionID, options, async () => {
      await loadSessionTasksForSessionService({
        backendSessionID,
        sessionID,
        setSessionTasksBySession,
      })
    })
  }

  async function loadSessionTasksForSession(
    sessionID: string,
    backendSessionID = resolveBackendSessionID(sessionID),
    options: SessionDataLoadOptions = {},
  ) {
    await ensureSessionTasksLoaded(sessionID, backendSessionID, {
      force: true,
      mode: "silent",
      reason: "manual",
      ...options,
    })
  }

  function scheduleRuntimeDebugRefresh(
    sessionID: string,
    backendSessionID = resolveBackendSessionID(sessionID),
    delayMs = 160,
  ) {
    if (!isRuntimeDebugEnabled) {
      clearRuntimeDebugRefreshTimer(sessionID)
      return
    }

    scheduleRuntimeDebugRefreshService({
      backendSessionID,
      delayMs,
      loadSessionRuntimeDebugForSession,
      runtimeDebugRefreshTimerRef,
      sessionID,
    })
  }

  async function ensurePendingPermissionRequestsLoaded(
    sessionID: string,
    backendSessionID = resolveBackendSessionID(sessionID),
    options: SessionDataLoadOptions = { mode: "silent", reason: "open" },
  ) {
    await ensureSessionDataLoad(sessionDataLoadCacheRef.current, "permissions", sessionID, backendSessionID, options, async () => {
      await loadPendingPermissionRequestsForSessionService({
        backendSessionID,
        permissionRequestsRequestRef,
        sessionID,
        setPendingPermissionRequestsBySession,
        options,
      })
    })
  }

  async function loadPendingPermissionRequestsForSession(
    sessionID: string,
    backendSessionID = resolveBackendSessionID(sessionID),
    options: SessionDataLoadOptions = {},
  ) {
    return loadPendingPermissionRequestsForSessionService({
      backendSessionID,
      permissionRequestsRequestRef,
      sessionID,
      setPendingPermissionRequestsBySession,
      options: {
        force: true,
        mode: "silent",
        reason: "manual",
        ...options,
      },
    })
  }

  const handleAgentSessionBridgeEventEffect = useEffectEvent((sessionEvent: AgentSessionBridgeEvent) => {
    handleAgentSessionBridgeEvent(sessionEvent)
  })

  useAgentSessionStreamEffects({
    agentConnected,
    agentSessions,
    backgroundSessionIDs: backgroundObservedSessionIDs,
    canLoadSessionHistory,
    openCanvasSessionIDs,
    pendingStreamsRef,
    resolveBackendSessionID,
    subscribedSessionStreamsRef,
    onSessionEvent: handleAgentSessionBridgeEventEffect,
  })

  const visibleCanvasSessionKey = visibleCanvasSessionIDs.join("\u0000")
  useEffect(() => {
    if (!canLoadSessionHistory) return

    for (const sessionID of visibleCanvasSessionIDs) {
      if (skipNextHistoryLoadRef.current[sessionID]) {
        delete skipNextHistoryLoadRef.current[sessionID]
        continue
      }

      void ensureSessionHistoryLoaded(sessionID, resolveBackendSessionID(sessionID), {
        mode: "silent",
        reason: "open",
      }).catch((error) => {
        console.error("[desktop] open session history preload failed:", error)
      })
    }
  }, [visibleCanvasSessionKey, canLoadSessionHistory, agentSessions])

  useOpenSessionReviewPreloadEffects({
    openSessionIDs: visibleCanvasSessionIDs,
    agentSessions,
    canLoadSessionHistory,
    ensurePendingPermissionRequestsLoaded,
    ensureSessionDiffLoaded,
    ensureSessionRuntimeDebugLoaded,
    ensureSessionTasksLoaded,
    isRuntimeDebugEnabled,
  })

  useReviewRefreshCleanupEffect({
    clearRuntimeDebugRefreshTimer,
    clearSessionDiffRefreshTimer,
    runtimeDebugRefreshTimerRef,
    sessionDiffRefreshTimerRef,
  })

  return {
    appendConversationMessages,
    clearRuntimeDebugRefreshTimer,
    clearSessionDiffRefreshTimer,
    loadPendingPermissionRequestsForSession,
    ensurePendingPermissionRequestsLoaded,
    ensureSessionHistoryLoaded,
    loadSessionDiffForSession,
    loadSessionRuntimeDebugForSession,
    loadSessionTasksForSession,
    refreshWorkspaceForSession,
    refreshWorkspaceFromDirectory,
    reloadSessionHistoryForSession,
    replaceConversationMessages,
    resolveBackendSessionID,
    scheduleRuntimeDebugRefresh,
    scheduleSessionDiffRefreshForSession,
    updateAssistantConversationMessage,
    updateSessionContextUsage,
  }
}
