import { startTransition, useEffect, useEffectEvent, useRef, useState, type MutableRefObject } from "react"
import { getAgentSessionBridge, type AgentSessionBridgeEvent } from "../agent-session/client"
import { AgentSessionEventRouter } from "../agent-session/event-router"
import {
  appendConversationTurns as appendConversationTurnsToMap,
  updateAssistantTurn as updateAssistantTurnInMap,
} from "../conversation-state"
import {
  applyAgentStreamEventToTurn,
  buildSessionStreamingAssistantTurn,
  buildTurnsFromHistory,
} from "../stream"
import type {
  AgentSessionStreamIPCEvent,
  AgentSessionExecutionMode,
  AgentStreamIPCEvent,
  AssistantTraceItem,
  AssistantTurn,
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
  Turn,
  UserTurn,
  WorkspaceGroup,
} from "../types"
import { buildSessionMessageTree, type SessionMessageTree } from "../session-message-tree"
import {
  pendingConversationInputToUserTurn,
  removePendingConversationInput,
  updatePendingConversationInput,
} from "../pending-conversation-inputs"
import { mergeUserTurnPresentationState, persistUserTurns, readPersistedUserTurns } from "../user-turn-presentation"
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
import { clearRendererPerformanceEntries } from "../perf-profiler"

const STREAM_DELTA_FLUSH_INTERVAL_MS = 32
const STREAM_DELTA_EVENTS_PER_FRAME = 240
const STREAM_DELTA_PENDING_EVENT_LIMIT = 1_600
const STREAM_DELTA_BACKPRESSURE_LOG_INTERVAL_MS = 5_000
const EXTERNAL_TURN_HISTORY_REFRESH_RETRY_MS = 500
export const STEER_INPUT_CONSUMED_STATE_REASON = "Steer input consumed."

type StreamEventUpdateTarget = {
  assistantTurnID: string
  sessionID: string
}

type PendingStreamDeltaUpdate = {
  event: AgentSessionStreamIPCEvent | AgentStreamIPCEvent
  target: StreamEventUpdateTarget
}

type ExecutionModeEventPayload = {
  sessionID: string
  turnID: string
  mode: AgentSessionExecutionMode
}

export type ExecutionModeRouteDecision = {
  assistantTurnID: string
  clearSteerUserTurn: boolean
  createAssistantTurn: boolean
  removeAssistantTurnID?: string
}

export function resolveExecutionModeRoute(input: {
  mode: AgentSessionExecutionMode
  requestedMode?: PendingAgentStream["requestedMode"]
  currentAssistantTurnID: string
  createdAssistantTurnID?: string
  existingAssistantTurnID?: string
}): ExecutionModeRouteDecision {
  if (input.mode === "steer") {
    const assistantTurnID =
      input.existingAssistantTurnID ??
      input.createdAssistantTurnID ??
      input.currentAssistantTurnID
    return {
      assistantTurnID,
      clearSteerUserTurn: false,
      createAssistantTurn: false,
      ...(input.createdAssistantTurnID && input.createdAssistantTurnID !== assistantTurnID
        ? { removeAssistantTurnID: input.createdAssistantTurnID }
        : {}),
    }
  }

  if (input.requestedMode === "steer") {
    if (input.existingAssistantTurnID) {
      return {
        assistantTurnID: input.existingAssistantTurnID,
        clearSteerUserTurn: true,
        createAssistantTurn: false,
      }
    }
    if (input.createdAssistantTurnID) {
      return {
        assistantTurnID: input.createdAssistantTurnID,
        clearSteerUserTurn: true,
        createAssistantTurn: false,
      }
    }
    return {
      assistantTurnID: input.currentAssistantTurnID,
      clearSteerUserTurn: true,
      createAssistantTurn: true,
    }
  }

  return {
    assistantTurnID: input.currentAssistantTurnID,
    clearSteerUserTurn: false,
    createAssistantTurn: false,
  }
}

export function applyExecutionModeToUserTurnPresentation(input: {
  turns: Turn[]
  userTurnID: string
  assistantTurnID: string
  mode: AgentSessionExecutionMode
}) {
  let didUpdate = false

  const nextTurns = input.turns.map((turn): Turn => {
    if (turn.kind !== "user" || turn.id !== input.userTurnID) return turn

    if (input.mode === "steer") {
      return turn
    }

    if (input.mode === "queued") {
      const { streamInsertion: _streamInsertion, ...queuedTurn } = turn
      const nextTurn: UserTurn = {
        ...queuedTurn,
        submissionMode: "queued",
      }
      didUpdate =
        turn.submissionMode !== nextTurn.submissionMode ||
        Boolean(turn.streamInsertion)
      return didUpdate ? nextTurn : turn
    }

    const { submissionMode: _submissionMode, streamInsertion: _streamInsertion, ...regularTurn } = turn
    didUpdate = Boolean(turn.submissionMode || turn.streamInsertion)
    return didUpdate ? regularTurn : turn
  })

  return didUpdate ? nextTurns : input.turns
}

export function revealBackendRecordedUserTurnPresentation(input: {
  turns: Turn[]
  userTurnID: string
}) {
  let didUpdate = false

  const nextTurns = input.turns.map((turn): Turn => {
    if (turn.kind !== "user" || turn.id !== input.userTurnID) return turn
    const {
      submissionMode: _submissionMode,
      streamInsertion: _streamInsertion,
      ...regularTurn
    } = turn
    didUpdate = Boolean(turn.submissionMode || turn.streamInsertion)
    return didUpdate ? regularTurn : turn
  })

  return didUpdate ? nextTurns : input.turns
}

export function revealPendingSteerUserTurnsAtHandoffPresentation(input: {
  turns: Turn[]
  assistantTurnID: string
}) {
  let didUpdate = false

  const nextTurns = input.turns.map((turn): Turn => {
    if (turn.kind !== "user" || turn.submissionMode !== "steer") return turn
    if (
      turn.streamInsertion &&
      (turn.streamInsertion.assistantTurnID !== input.assistantTurnID ||
        turn.streamInsertion.status === "consumed")
    ) {
      return turn
    }

    const { submissionMode: _submissionMode, streamInsertion: _streamInsertion, ...regularTurn } = turn
    didUpdate = true
    return regularTurn
  })

  return didUpdate ? nextTurns : input.turns
}

function buildSessionStreamingAssistantTurnWithID(assistantTurnID: string, detail?: string): AssistantTurn {
  const turn = buildSessionStreamingAssistantTurn(detail)
  return {
    ...turn,
    id: assistantTurnID,
    items: turn.items.map((item) => ({
      ...item,
      sourceID: item.sourceID === `${turn.id}:prompt` ? `${assistantTurnID}:prompt` : item.sourceID,
    })),
  }
}

export function ensureAssistantTurnPresentation(input: {
  turns: Turn[]
  assistantTurnID: string
  detail?: string
}) {
  if (input.turns.some((turn) => turn.kind === "assistant" && turn.id === input.assistantTurnID)) {
    return input.turns
  }

  return [
    ...input.turns,
    buildSessionStreamingAssistantTurnWithID(input.assistantTurnID, input.detail),
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

function updateConversationMapWithDeltaGroups(
  conversations: Record<string, Turn[]>,
  groupedUpdates: Map<string, Map<string, Array<AgentSessionStreamIPCEvent | AgentStreamIPCEvent>>>,
) {
  let nextConversations = conversations

  for (const [sessionID, updatesByTurnID] of groupedUpdates) {
    const currentTurns = nextConversations[sessionID] ?? []
    let didUpdateSession = false
    const nextTurns = currentTurns.map((turn) => {
      if (turn.kind !== "assistant") return turn
      const streamEvents = updatesByTurnID.get(turn.id)
      if (!streamEvents?.length) return turn

      didUpdateSession = true
      return streamEvents.reduce(
        (nextTurn, streamEvent) => applyAgentStreamEventToTurn(nextTurn, streamEvent),
        turn,
      )
    })

    if (!didUpdateSession) continue
    nextConversations = {
      ...nextConversations,
      [sessionID]: reconcileConversationTurns(nextTurns),
    }
  }

  return nextConversations
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

    return {
      ...nextItem,
      id: previousItem.id,
      timestamp: Math.min(previousItem.timestamp, nextItem.timestamp),
    }
  })
}

function isTerminalTraceStatus(status: AssistantTraceItem["status"]) {
  return status === "completed" || status === "error" || status === "denied" || status === "cancelled"
}

function canIncomingTurnOverrideCancellation(turn: AssistantTurn) {
  return turn.runtime.phase === "completed" || turn.runtime.phase === "failed"
}

function shouldPreserveCancelledTurn(current: AssistantTurn, incoming: AssistantTurn) {
  return current.runtime.phase === "cancelled" &&
    (!canIncomingTurnOverrideCancellation(incoming) || isLateToolFailureForCancelledTurn(current, incoming))
}

function cancelInterruptedToolTraceItems(items: AssistantTraceItem[]) {
  return items.map((item) =>
    item.kind === "tool" && !isTerminalTraceStatus(item.status)
      ? {
          ...item,
          status: "cancelled" as const,
          detail: item.detail || "Prompt cancellation requested.",
          isStreaming: false,
        }
      : item,
  )
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

function isLateToolFailureForCancelledTurn(current: AssistantTurn, incoming: AssistantTurn) {
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
    return {
      ...existing,
      messageID: existing.messageID ?? nextItem.messageID,
      backendTurnID: existing.backendTurnID ?? nextItem.backendTurnID,
      partID: existing.partID ?? nextItem.partID,
      toolCallID: existing.toolCallID ?? nextItem.toolCallID,
      debugEntries: mergeTraceDebugEntries(existing.debugEntries, nextItem.debugEntries),
    }
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
    return {
      ...merged,
      text: existing.text,
    }
  }

  if (existing.kind === "tool" && nextItem.kind === "tool") {
    return {
      ...merged,
      text: nextItem.text ?? existing.text,
      toolInputText: nextItem.toolInputText ?? existing.toolInputText,
      toolOutputText: nextItem.toolOutputText ?? existing.toolOutputText,
    }
  }

  return merged
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
  return items.flatMap((item, index) => {
    if (index === firstIndex) return [merged]
    if (duplicateIndices.has(index)) return []
    return [item]
  })
}

function removeStaleApprovalBlockers(items: AssistantTraceItem[]) {
  const hasWaitingTool = items.some((item) => item.kind === "tool" && item.status === "waiting-approval")
  if (hasWaitingTool) return items

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

function assistantRuntimeAfterTraceMerge(current: AssistantTurn, incoming: AssistantTurn, items: AssistantTraceItem[]) {
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
      toolName: waitingTool?.title ?? nextRuntime.toolName ?? existingRuntime.toolName,
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
      toolName: activeTool?.title ?? nextRuntime.toolName ?? existingRuntime.toolName,
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

function isTerminalAssistantRuntimePhase(phase: AssistantTurn["runtime"]["phase"]) {
  return (
    phase === "completed" ||
    phase === "cancelled" ||
    phase === "failed" ||
    phase === "blocked" ||
    phase === "continued_by_user"
  )
}

function mergeAssistantTurnsByMessageID(current: AssistantTurn, incoming: AssistantTurn): AssistantTurn {
  const preserveCancellation = shouldPreserveCancelledTurn(current, incoming)
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

export function reconcileConversationTurns(turns: Turn[]) {
  const result: Turn[] = []
  const assistantIndexByMessageID = new Map<string, number>()
  const assistantIndexByBackendTurnID = new Map<string, number>()

  function registerAssistantTurnIndex(turn: AssistantTurn, index: number) {
    if (turn.messageID) {
      assistantIndexByMessageID.set(turn.messageID, index)
    }
    for (const backendTurnID of getAssistantTurnBackendTurnIDs(turn)) {
      assistantIndexByBackendTurnID.set(backendTurnID, index)
    }
  }

  function findExistingAssistantTurnIndex(turn: AssistantTurn) {
    if (turn.messageID) {
      const messageIndex = assistantIndexByMessageID.get(turn.messageID)
      if (messageIndex !== undefined) return messageIndex
    }

    for (const backendTurnID of getAssistantTurnBackendTurnIDs(turn)) {
      const backendTurnIndex = assistantIndexByBackendTurnID.get(backendTurnID)
      if (backendTurnIndex !== undefined) return backendTurnIndex
    }

    return undefined
  }

  for (const turn of turns) {
    if (turn.kind !== "assistant") {
      result.push(turn)
      continue
    }

    const existingIndex = findExistingAssistantTurnIndex(turn)
    if (existingIndex === undefined) {
      const nextTurn = {
        ...turn,
        items: removeStaleApprovalBlockers(turn.items),
      }
      registerAssistantTurnIndex(nextTurn, result.length)
      result.push({
        ...nextTurn,
      })
      continue
    }

    const existingTurn = result[existingIndex]
    if (!existingTurn || existingTurn.kind !== "assistant") {
      result.push(turn)
      continue
    }

    const mergedTurn = mergeAssistantTurnsByMessageID(existingTurn, turn)
    result[existingIndex] = mergedTurn
    registerAssistantTurnIndex(mergedTurn, existingIndex)
  }

  return result
}

function getAssistantTurnResponseText(turn: AssistantTurn) {
  return turn.items
    .filter((item) => item.kind === "text" || item.kind === "question")
    .map((item) => normalizeTraceText(item.text))
    .filter(Boolean)
    .join("\n\n")
}

function getAssistantTurnSourceIDs(turn: AssistantTurn) {
  return new Set(
    turn.items
      .map((item) => item.sourceID)
      .filter((sourceID): sourceID is string => Boolean(sourceID)),
  )
}

function getAssistantTurnBackendTurnIDs(turn: AssistantTurn) {
  return new Set(
    turn.items
      .map((item) => item.backendTurnID)
      .filter((backendTurnID): backendTurnID is string => Boolean(backendTurnID)),
  )
}

function assistantTurnsAreCompatible(previousTurn: AssistantTurn, nextTurn: AssistantTurn) {
  if (previousTurn.id === nextTurn.id) return true
  if (previousTurn.messageID && nextTurn.messageID && previousTurn.messageID === nextTurn.messageID) return true

  const previousBackendTurnIDs = getAssistantTurnBackendTurnIDs(previousTurn)
  if (previousBackendTurnIDs.size > 0) {
    for (const backendTurnID of getAssistantTurnBackendTurnIDs(nextTurn)) {
      if (previousBackendTurnIDs.has(backendTurnID)) return true
    }
  }

  const previousSourceIDs = getAssistantTurnSourceIDs(previousTurn)
  if (previousSourceIDs.size > 0) {
    for (const sourceID of getAssistantTurnSourceIDs(nextTurn)) {
      if (previousSourceIDs.has(sourceID)) return true
    }
  }

  const previousResponseText = getAssistantTurnResponseText(previousTurn)
  const nextResponseText = getAssistantTurnResponseText(nextTurn)
  return Boolean(previousResponseText && previousResponseText === nextResponseText)
}

function findMatchingAssistantTurnIndex(
  previousAssistantTurns: AssistantTurn[],
  nextTurn: AssistantTurn,
  preferredIndex: number,
  usedIndices: Set<number>,
) {
  const idMatchIndex = previousAssistantTurns.findIndex(
    (turn, index) => !usedIndices.has(index) && turn.id === nextTurn.id,
  )
  if (idMatchIndex !== -1) return idMatchIndex

  const preferredTurn = previousAssistantTurns[preferredIndex]
  if (
    preferredTurn &&
    !usedIndices.has(preferredIndex) &&
    assistantTurnsAreCompatible(preferredTurn, nextTurn)
  ) {
    return preferredIndex
  }

  if (
    preferredTurn &&
    !usedIndices.has(preferredIndex) &&
    shouldPreserveCancelledTurn(preferredTurn, nextTurn)
  ) {
    return preferredIndex
  }

  return previousAssistantTurns.findIndex(
    (turn, index) => !usedIndices.has(index) && assistantTurnsAreCompatible(turn, nextTurn),
  )
}

function preserveAssistantTurnIdentity(previousTurns: Turn[], nextTurns: Turn[]) {
  const previousAssistantTurns = previousTurns.filter((turn): turn is AssistantTurn => turn.kind === "assistant")
  if (previousAssistantTurns.length === 0) return nextTurns

  const usedIndices = new Set<number>()
  let nextAssistantIndex = 0

  return nextTurns.map((turn) => {
    if (turn.kind !== "assistant") return turn

    const matchIndex = findMatchingAssistantTurnIndex(
      previousAssistantTurns,
      turn,
      nextAssistantIndex,
      usedIndices,
    )
    nextAssistantIndex += 1

    if (matchIndex === -1) return turn

    const previousTurn = previousAssistantTurns[matchIndex]
    if (!previousTurn) return turn

    usedIndices.add(matchIndex)

    const turnWithPreservedIdentity = {
      ...turn,
      id: previousTurn.id,
      items: preserveTraceItemIdentity(previousTurn.items, turn.items),
    }
    return shouldPreserveCancelledTurn(previousTurn, turn)
      ? mergeAssistantTurnsByMessageID(previousTurn, turnWithPreservedIdentity)
      : turnWithPreservedIdentity
  })
}

function isLocalGeneratedUserTurn(turn: UserTurn) {
  return turn.id.startsWith("user-")
}

function normalizeUserTurnIdentityText(turn: UserTurn) {
  return (turn.displayText ?? turn.text).replace(/\s+/g, " ").trim()
}

function userTurnsAreCompatible(previousTurn: UserTurn, nextTurn: UserTurn) {
  if (previousTurn.id === nextTurn.id) return true

  const previousQuestionID = previousTurn.questionAnswer?.questionID ?? ""
  const nextQuestionID = nextTurn.questionAnswer?.questionID ?? ""
  if (previousQuestionID || nextQuestionID) return previousQuestionID === nextQuestionID

  const previousText = normalizeUserTurnIdentityText(previousTurn)
  const nextText = normalizeUserTurnIdentityText(nextTurn)
  return Boolean(previousText && previousText === nextText)
}

export function mergeConversationTurnsFromHistory(
  previousTurns: Turn[],
  nextTurns: Turn[],
  options?: { preserveUserPresentation?: boolean },
) {
  const turnsWithUserPresentation = options?.preserveUserPresentation === false
    ? nextTurns
    : mergeUserTurnPresentationState(previousTurns, nextTurns)
  return preserveAssistantTurnIdentity(previousTurns, turnsWithUserPresentation)
}

export function mergeExternalUserTurnsFromHistory(
  previousTurns: Turn[],
  historyTurns: Turn[],
  options?: { beforeTurnID?: string },
) {
  const previousUserTurnIDs = new Set(
    previousTurns
      .filter((turn): turn is UserTurn => turn.kind === "user")
      .map((turn) => turn.id),
  )
  const missingUserTurns = historyTurns
    .filter((turn): turn is UserTurn => turn.kind === "user" && !previousUserTurnIDs.has(turn.id))
    .sort((left, right) => left.timestamp - right.timestamp)

  if (missingUserTurns.length === 0) return previousTurns

  const nextTurns = [...previousTurns]
  const replacedLocalUserTurnIndices = new Set<number>()

  function findLocalUserTurnReplacementIndex(userTurn: UserTurn) {
    const anchorIndex = options?.beforeTurnID ? nextTurns.findIndex((turn) => turn.id === options.beforeTurnID) : -1
    if (anchorIndex < 0) return -1

    for (let index = anchorIndex - 1; index >= 0; index -= 1) {
      const candidate = nextTurns[index]
      if (!candidate) continue
      if (candidate.kind === "assistant") break
      if (candidate.kind !== "user") continue
      if (replacedLocalUserTurnIndices.has(index)) continue
      if (!isLocalGeneratedUserTurn(candidate)) continue
      if (!userTurnsAreCompatible(candidate, userTurn)) continue
      return index
    }

    return -1
  }

  for (const userTurn of missingUserTurns) {
    const replacementIndex = findLocalUserTurnReplacementIndex(userTurn)
    if (replacementIndex >= 0) {
      const currentTurn = nextTurns[replacementIndex]
      if (currentTurn?.kind === "user") {
        const [mergedUserTurn] = mergeUserTurnPresentationState([currentTurn], [userTurn])
        nextTurns[replacementIndex] = mergedUserTurn ?? userTurn
        replacedLocalUserTurnIndices.add(replacementIndex)
        previousUserTurnIDs.add(userTurn.id)
        continue
      }
    }

    const timestampIndex = nextTurns.findIndex(
      (turn) => turn.timestamp > userTurn.timestamp || (turn.kind === "assistant" && turn.timestamp === userTurn.timestamp),
    )
    const anchorIndex = options?.beforeTurnID ? nextTurns.findIndex((turn) => turn.id === options.beforeTurnID) : -1
    const insertIndex = anchorIndex >= 0 && (timestampIndex < 0 || anchorIndex < timestampIndex)
      ? anchorIndex
      : timestampIndex

    if (insertIndex < 0) {
      nextTurns.push(userTurn)
    } else {
      nextTurns.splice(insertIndex, 0, userTurn)
    }
  }

  return reconcileConversationTurns(nextTurns)
}

export function conversationTurnsAreEquivalent(leftTurns: Turn[], rightTurns: Turn[]) {
  if (leftTurns === rightTurns) return true
  if (leftTurns.length !== rightTurns.length) return false

  return leftTurns.every((leftTurn, index) => JSON.stringify(leftTurn) === JSON.stringify(rightTurns[index]))
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
  canLoadSessionHistory: boolean
  contextUsageBySession: Record<string, SessionContextUsage>
  conversationVersionRef: MutableRefObject<Record<string, number>>
  conversationStore: ConversationStoreApi
  historyRequestRef: MutableRefObject<Record<string, number>>
  isRuntimeDebugEnabled: boolean
  openCanvasSessionIDs: string[]
  visibleCanvasSessionIDs: string[]
  onFocusSession: (sessionID: string) => void
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
  setConversations: StateSetter<Record<string, Turn[]>>
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
  workspaceRefreshRequestRef: MutableRefObject<Record<string, number>>
  workspaces: WorkspaceGroup[]
}

export function useSessionStreamController({
  agentConnected,
  agentDefaultDirectory,
  agentSessionStoreRef,
  agentSessions,
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
  workspaceRefreshRequestRef,
  workspaces,
}: UseSessionStreamControllerOptions) {
  const pendingDeltaUpdatesRef = useRef<PendingStreamDeltaUpdate[]>([])
  const pendingDeltaFlushHandleRef = useRef<{ id: number; kind: "frame" | "timer" } | null>(null)
  const lastDeltaBackpressureLogAtRef = useRef(0)
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

    setConversations((prev) => (
      Object.prototype.hasOwnProperty.call(prev, sessionID)
        ? prev
        : {
            ...prev,
            [sessionID]: [],
          }
    ))
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

  function findAssistantTurnIDByMessageID(sessionID: string, messageID: string | undefined) {
    if (!messageID) return undefined
    const turn = conversationStore.getSessionTurns(sessionID).find(
      (candidate): candidate is AssistantTurn =>
        candidate.kind === "assistant" &&
        (candidate.messageID === messageID || candidate.items.some((item) => item.messageID === messageID)),
    )
    return turn?.id
  }

  function findAssistantTurnIDByBackendTurnID(sessionID: string, backendTurnID: string | undefined) {
    if (!backendTurnID) return undefined
    const turns = conversationStore.getSessionTurns(sessionID)
    for (let index = turns.length - 1; index >= 0; index -= 1) {
      const turn = turns[index]
      if (turn?.kind !== "assistant") continue
      if (isTerminalAssistantRuntimePhase(turn.runtime.phase)) continue
      if (turn.items.some((item) => item.backendTurnID === backendTurnID)) return turn.id
    }
    return undefined
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

  function replaceConversationTurns(sessionID: string, nextTurns: Turn[]) {
    bumpConversationVersion(sessionID)
    setConversations((prev) => ({
      ...prev,
      [sessionID]: reconcileConversationTurns(nextTurns),
    }))
  }

  function appendConversationTurns(sessionID: string, nextTurns: Turn[]) {
    bumpConversationVersion(sessionID)
    setConversations((prev) => {
      const next = appendConversationTurnsToMap(prev, sessionID, nextTurns)
      next[sessionID] = reconcileConversationTurns(next[sessionID] ?? [])
      persistUserTurns(sessionID, next[sessionID] ?? [])
      return next
    })
  }

  function clearLatestSteerUserTurnForAssistant(sessionID: string, assistantTurnID: string) {
    setConversations((prev) => {
      const current = prev[sessionID] ?? []
      let targetIndex = -1
      for (let index = current.length - 1; index >= 0; index -= 1) {
        const turn = current[index]
        if (
          turn?.kind === "user" &&
          turn.submissionMode === "steer" &&
          (!turn.streamInsertion || turn.streamInsertion.assistantTurnID === assistantTurnID)
        ) {
          targetIndex = index
          break
        }
      }

      if (targetIndex < 0) return prev

      bumpConversationVersion(sessionID)
      const nextTurns = current.map((turn, index): Turn => {
        if (index !== targetIndex || turn.kind !== "user") return turn
        const { submissionMode: _submissionMode, streamInsertion: _streamInsertion, ...regularTurn } = turn
        return regularTurn
      })
      const reconciled = reconcileConversationTurns(nextTurns)
      persistUserTurns(sessionID, reconciled)
      return {
        ...prev,
        [sessionID]: reconciled,
      }
    })
  }

  function applyExecutionModeToUserTurn(input: {
    sessionID: string
    userTurnID: string
    assistantTurnID: string
    mode: AgentSessionExecutionMode
  }) {
    setConversations((prev) => {
      const current = prev[input.sessionID] ?? []
      const nextTurns = applyExecutionModeToUserTurnPresentation({
        turns: current,
        userTurnID: input.userTurnID,
        assistantTurnID: input.assistantTurnID,
        mode: input.mode,
      })

      if (nextTurns === current) return prev
      bumpConversationVersion(input.sessionID)
      const reconciled = reconcileConversationTurns(nextTurns)
      persistUserTurns(input.sessionID, reconciled)
      return {
        ...prev,
        [input.sessionID]: reconciled,
      }
    })
  }

  function revealBackendRecordedUserTurn(input: {
    sessionID: string
    userTurnID: string
    beforeTurnID?: string
  }) {
    if (commitPendingConversationInputAsUserTurn({
      sessionID: input.sessionID,
      inputID: input.userTurnID,
      beforeTurnID: input.beforeTurnID,
    })) {
      return
    }

    setConversations((prev) => {
      const current = prev[input.sessionID] ?? []
      const nextTurns = revealBackendRecordedUserTurnPresentation({
        turns: current,
        userTurnID: input.userTurnID,
      })

      if (nextTurns === current) return prev
      bumpConversationVersion(input.sessionID)
      const reconciled = reconcileConversationTurns(nextTurns)
      persistUserTurns(input.sessionID, reconciled)
      return {
        ...prev,
        [input.sessionID]: reconciled,
      }
    })
  }

  function findPendingConversationInput(sessionID: string, inputID: string) {
    const stateInput = (pendingConversationInputsBySessionRef.current[sessionID] ?? []).find((input) => input.id === inputID)
    if (stateInput) return stateInput

    return Object.values(pendingStreamsRef.current).find((stream) =>
      stream.sessionID === sessionID &&
      stream.pendingInputID === inputID
    )?.pendingInput ?? null
  }

  function readAssistantItemCount(sessionID: string, assistantTurnID: string | undefined) {
    if (!assistantTurnID) return 0
    const assistantTurn = conversationStore.getSessionTurns(sessionID).find(
      (turn): turn is AssistantTurn => turn.kind === "assistant" && turn.id === assistantTurnID,
    )
    return assistantTurn?.items.length ?? 0
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

  function insertCommittedUserTurn(
    turns: Turn[],
    userTurn: UserTurn,
    beforeTurnID: string | undefined,
  ) {
    if (turns.some((turn) => turn.id === userTurn.id)) return turns
    if (!beforeTurnID) return [...turns, userTurn]

    const beforeIndex = turns.findIndex((turn) => turn.id === beforeTurnID)
    if (beforeIndex === -1) return [...turns, userTurn]

    return [
      ...turns.slice(0, beforeIndex),
      userTurn,
      ...turns.slice(beforeIndex),
    ]
  }

  function commitPendingConversationInputAsUserTurn(input: {
    sessionID: string
    inputID: string
    beforeTurnID?: string
    streamInsertion?: UserTurn["streamInsertion"]
  }) {
    const pendingInput = findPendingConversationInput(input.sessionID, input.inputID)
    if (!pendingInput) return false

    const userTurn = pendingConversationInputToUserTurn(pendingInput, {
      ...(input.streamInsertion ? { streamInsertion: input.streamInsertion } : {}),
    })
    setConversations((prev) => {
      const current = prev[input.sessionID] ?? []
      const nextTurns = insertCommittedUserTurn(current, userTurn, input.beforeTurnID)
      if (nextTurns === current) return prev

      bumpConversationVersion(input.sessionID)
      const reconciled = reconcileConversationTurns(nextTurns)
      persistUserTurns(input.sessionID, reconciled)
      return {
        ...prev,
        [input.sessionID]: reconciled,
      }
    })
    removePendingConversationInputForSession(input.sessionID, input.inputID)
    return true
  }

  function commitPendingSteerInputAsConsumedInsertion(input: {
    sessionID: string
    inputID: string
    assistantTurnID: string
  }) {
    const pendingInput = findPendingConversationInput(input.sessionID, input.inputID)
    if (!pendingInput || pendingInput.mode !== "steer") return false

    return commitPendingConversationInputAsUserTurn({
      sessionID: input.sessionID,
      inputID: input.inputID,
      beforeTurnID: undefined,
      streamInsertion: {
        assistantTurnID: input.assistantTurnID,
        afterItemCount: pendingInput.afterItemCount ?? readAssistantItemCount(input.sessionID, input.assistantTurnID),
        status: "consumed",
      },
    })
  }

  function revealPendingSteerUserTurnsAtHandoff(input: {
    sessionID: string
    assistantTurnID: string
  }) {
    setConversations((prev) => {
      const current = prev[input.sessionID] ?? []
      const nextTurns = revealPendingSteerUserTurnsAtHandoffPresentation({
        turns: current,
        assistantTurnID: input.assistantTurnID,
      })

      if (nextTurns === current) return prev
      bumpConversationVersion(input.sessionID)
      const reconciled = reconcileConversationTurns(nextTurns)
      persistUserTurns(input.sessionID, reconciled)
      return {
        ...prev,
        [input.sessionID]: reconciled,
      }
    })
  }

  function revealPendingUserTurnForBackendEvent(input: {
    uiSessionID: string
    backendSessionID: string
    backendTurnID: string
  }) {
    const pending = Object.values(pendingStreamsRef.current).find((target) =>
      target.sessionID === input.uiSessionID &&
      (target.backendSessionID ?? input.backendSessionID) === input.backendSessionID &&
      target.backendTurnID === input.backendTurnID &&
      Boolean(target.userTurnID)
    )
    if (!pending?.userTurnID) return
    revealBackendRecordedUserTurn({
      sessionID: pending.sessionID,
      userTurnID: pending.userTurnID,
      beforeTurnID: pending.assistantTurnID,
    })
  }

  function markPendingSteerUserTurnsConsumed(sessionID: string, assistantTurnID: string) {
    setConversations((prev) => {
      const current = prev[sessionID] ?? []
      let didUpdate = false
      const nextTurns = current.map((turn): Turn => {
        if (
          turn.kind !== "user" ||
          turn.submissionMode !== "steer" ||
          turn.streamInsertion?.assistantTurnID !== assistantTurnID ||
          turn.streamInsertion.status !== "pending"
        ) {
          return turn
        }

        didUpdate = true
        return {
          ...turn,
          streamInsertion: {
            ...turn.streamInsertion,
            status: "consumed",
          },
        }
      })

      if (!didUpdate) return prev
      bumpConversationVersion(sessionID)
      const reconciled = reconcileConversationTurns(nextTurns)
      persistUserTurns(sessionID, reconciled)
      return {
        ...prev,
        [sessionID]: reconciled,
      }
    })
  }

  function removeConversationTurn(sessionID: string, turnID: string) {
    setConversations((prev) => {
      const current = prev[sessionID] ?? []
      if (!current.some((turn) => turn.id === turnID)) return prev
      bumpConversationVersion(sessionID)
      const reconciled = reconcileConversationTurns(current.filter((turn) => turn.id !== turnID))
      persistUserTurns(sessionID, reconciled)
      return {
        ...prev,
        [sessionID]: reconciled,
      }
    })
  }

  function ensureAssistantConversationTurn(input: {
    sessionID: string
    assistantTurnID: string
    detail?: string
  }) {
    if (conversationStore.getSessionTurns(input.sessionID).some(
      (turn) => turn.kind === "assistant" && turn.id === input.assistantTurnID,
    )) {
      return
    }

    setConversations((prev) => {
      const current = prev[input.sessionID] ?? []
      const nextTurns = ensureAssistantTurnPresentation({
        turns: current,
        assistantTurnID: input.assistantTurnID,
        detail: input.detail,
      })
      if (nextTurns === current) return prev

      bumpConversationVersion(input.sessionID)
      return {
        ...prev,
        [input.sessionID]: reconcileConversationTurns(nextTurns),
      }
    })
  }

  function updateAssistantConversationTurn(
    sessionID: string,
    turnID: string,
    updater: Parameters<typeof updateAssistantTurnInMap>[3],
  ) {
    bumpConversationVersion(sessionID)
    setConversations((prev) => {
      const next = updateAssistantTurnInMap(prev, sessionID, turnID, updater)
      if (next === prev) return prev
      return {
        ...next,
        [sessionID]: reconcileConversationTurns(next[sessionID] ?? []),
      }
    })
  }

  function clearPendingDeltaFlushTimer() {
    const handle = pendingDeltaFlushHandleRef.current
    if (!handle) return
    if (handle.kind === "frame") {
      window.cancelAnimationFrame(handle.id)
    } else {
      window.clearTimeout(handle.id)
    }
    pendingDeltaFlushHandleRef.current = null
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
      const updatesByTurnID = groupedUpdates.get(update.target.sessionID) ?? new Map<string, PendingStreamDeltaUpdate["event"][]>()
      const events = updatesByTurnID.get(update.target.assistantTurnID) ?? []
      events.push(update.event)
      updatesByTurnID.set(update.target.assistantTurnID, events)
      groupedUpdates.set(update.target.sessionID, updatesByTurnID)
    }

    for (const sessionID of groupedUpdates.keys()) {
      bumpConversationVersion(sessionID)
    }

    startTransition(() => {
      setConversations((prev) => updateConversationMapWithDeltaGroups(prev, groupedUpdates))
    })

    if (pendingDeltaUpdatesRef.current.length > 0) {
      schedulePendingDeltaFlush()
    }
  }

  function schedulePendingDeltaFlush() {
    if (pendingDeltaFlushHandleRef.current !== null) return

    if (window.requestAnimationFrame) {
      pendingDeltaFlushHandleRef.current = {
        id: window.requestAnimationFrame(() => {
          pendingDeltaFlushHandleRef.current = null
          flushPendingDeltaUpdates()
        }),
        kind: "frame",
      }
      return
    }

    pendingDeltaFlushHandleRef.current = {
      id: window.setTimeout(() => {
        pendingDeltaFlushHandleRef.current = null
        flushPendingDeltaUpdates()
      }, STREAM_DELTA_FLUSH_INTERVAL_MS),
      kind: "timer",
    }
  }

  function applyStreamEventToAssistantTurn(
    target: StreamEventUpdateTarget,
    streamEvent: AgentSessionStreamIPCEvent | AgentStreamIPCEvent,
  ) {
    ensureAssistantConversationTurn({
      sessionID: target.sessionID,
      assistantTurnID: target.assistantTurnID,
      detail: "Receiving backend session activity.",
    })

    if (isHighFrequencyDeltaStreamEvent(streamEvent)) {
      enqueuePendingDeltaUpdate({ target, event: streamEvent })
      return
    }

    flushPendingDeltaUpdates({ forceAll: true })
    startTransition(() => {
      updateAssistantConversationTurn(target.sessionID, target.assistantTurnID, (turn) =>
        applyAgentStreamEventToTurn(turn, streamEvent),
      )
    })
  }

  useEffect(() => {
    return () => {
      pendingDeltaUpdatesRef.current = []
      clearPendingDeltaFlushTimer()
    }
  }, [])

  function replaceConversationTurnsFromHistory(
    sessionID: string,
    nextTurns: Turn[],
    options?: { preserveUserPresentation?: boolean },
  ) {
    bumpConversationVersion(sessionID)
    setConversations((prev) => {
      const currentTurns = prev[sessionID] ?? []
      const previousTurns = currentTurns.length ? currentTurns : readPersistedUserTurns(sessionID)
      const mergedTurns = reconcileConversationTurns(mergeConversationTurnsFromHistory(previousTurns, nextTurns, {
        preserveUserPresentation: options?.preserveUserPresentation,
      }))
      if (conversationTurnsAreEquivalent(currentTurns, mergedTurns)) return prev

      persistUserTurns(sessionID, mergedTurns)
      return {
        ...prev,
        [sessionID]: mergedTurns,
      }
    })
  }

  function ensureAssistantTurnForBackendTurn(input: {
    uiSessionID: string
    backendSessionID: string
    turnID: string
  }) {
    const existing = sessionEventRouterRef.current.getTurnTarget(input.backendSessionID, input.turnID)
    if (existing) {
      return existing.assistantTurnID
    }

    const pending = Object.values(pendingStreamsRef.current).find(
      (target) =>
        target.sessionID === input.uiSessionID &&
        target.backendSessionID === input.backendSessionID &&
        (!target.backendTurnID || target.backendTurnID === input.turnID),
    )

    if (pending) {
      pending.backendTurnID = input.turnID
      sessionEventRouterRef.current.setTurnTarget(input.backendSessionID, input.turnID, {
        sessionID: input.uiSessionID,
        assistantTurnID: pending.assistantTurnID,
      })
      return pending.assistantTurnID
    }

    const streamingTurn = buildSessionStreamingAssistantTurn()
    sessionEventRouterRef.current.setTurnTarget(input.backendSessionID, input.turnID, {
      sessionID: input.uiSessionID,
      assistantTurnID: streamingTurn.id,
    })

    appendConversationTurns(input.uiSessionID, [streamingTurn])

    return streamingTurn.id
  }

  async function mergeExternalTurnUserHistory(input: {
    uiSessionID: string
    backendSessionID: string
    backendTurnID: string
    assistantTurnID: string
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
      const historyTurns = buildTurnsFromHistory(messages)
      const currentTurns = conversationStore.getSessionTurns(input.uiSessionID)
      const candidateTurns = mergeExternalUserTurnsFromHistory(currentTurns, historyTurns, {
        beforeTurnID: input.assistantTurnID,
      })
      if (conversationTurnsAreEquivalent(currentTurns, candidateTurns)) return

      externalTurnUserHistoryMergedRef.current.add(refreshKey)
      startTransition(() => {
        setConversations((prev) => {
          const currentTurns = prev[input.uiSessionID] ?? []
          const mergedTurns = mergeExternalUserTurnsFromHistory(currentTurns, historyTurns, {
            beforeTurnID: input.assistantTurnID,
          })
          if (conversationTurnsAreEquivalent(currentTurns, mergedTurns)) return prev
          bumpConversationVersion(input.uiSessionID)
          persistUserTurns(input.uiSessionID, mergedTurns)
          return {
            ...prev,
            [input.uiSessionID]: mergedTurns,
          }
        })
      })
    } catch (error) {
      console.error("[desktop] external session turn user history refresh failed:", error)
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

    const previousAssistantTurnID = target.assistantTurnID
    target.backendSessionID = backendSessionID
    target.backendTurnID = backendTurnID
    target.executionMode = executionMode.mode

    const existingTarget = sessionEventRouterRef.current.getTurnTarget(backendSessionID, backendTurnID)

    const route = resolveExecutionModeRoute({
      mode: executionMode.mode,
      requestedMode: target.requestedMode,
      currentAssistantTurnID: target.assistantTurnID,
      createdAssistantTurnID: target.createdAssistantTurnID,
      existingAssistantTurnID: existingTarget?.assistantTurnID,
    })

    if (route.createAssistantTurn) {
      const streamingTurn = buildSessionStreamingAssistantTurn()
      target.assistantTurnID = streamingTurn.id
      target.createdAssistantTurnID = streamingTurn.id
      appendConversationTurns(target.sessionID, [streamingTurn])
    } else {
      target.assistantTurnID = route.assistantTurnID
    }

    if (route.removeAssistantTurnID) {
      removeConversationTurn(target.sessionID, route.removeAssistantTurnID)
    }

    if (target.pendingInputID) {
      if (executionMode.mode === "new-turn") {
        commitPendingConversationInputAsUserTurn({
          sessionID: target.sessionID,
          inputID: target.pendingInputID,
          beforeTurnID: target.assistantTurnID,
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
                  targetAssistantTurnID: target.assistantTurnID,
                  afterItemCount: pendingInput.afterItemCount ?? readAssistantItemCount(target.sessionID, target.assistantTurnID),
                }
              : {}),
          }),
        )
      }
    }

    if (target.userTurnID && !target.pendingInputID) {
      applyExecutionModeToUserTurn({
        sessionID: target.sessionID,
        userTurnID: target.userTurnID,
        assistantTurnID: target.assistantTurnID,
        mode: executionMode.mode,
      })
    } else if (route.clearSteerUserTurn) {
      clearLatestSteerUserTurnForAssistant(target.sessionID, previousAssistantTurnID)
    }

    sessionEventRouterRef.current.setTurnTarget(backendSessionID, backendTurnID, {
      sessionID: target.sessionID,
      assistantTurnID: target.assistantTurnID,
    })
  }

  function handleRequestStreamEvent(streamEvent: AgentStreamIPCEvent) {
    const target = pendingStreamsRef.current[streamEvent.streamID]
    if (!target) return

    const executionMode = readExecutionModeEvent(streamEvent)
    if (executionMode) {
      applyExecutionModeToPendingRequest(streamEvent.streamID, executionMode)
      return
    }

    const cursor = resolveStreamCursor(streamEvent)
    if (cursor && sessionEventRouterRef.current.rememberSeenCursor(target.sessionID, cursor)) {
      const backendTurnID = resolveStreamTurnID(streamEvent)
      const backendSessionID = target.backendSessionID ?? resolveBackendSessionID(target.sessionID)
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
    const messageAssistantTurnID = findAssistantTurnIDByMessageID(target.sessionID, streamMessageID)
    const backendAssistantTurnID = findAssistantTurnIDByBackendTurnID(target.sessionID, backendTurnID)
    if (backendTurnID) {
      const backendSessionID = target.backendSessionID ?? resolveBackendSessionID(target.sessionID)
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
      sessionEventRouterRef.current.setTurnTarget(backendSessionID, backendTurnID, {
        sessionID: target.sessionID,
        assistantTurnID: messageAssistantTurnID ?? backendAssistantTurnID ?? target.assistantTurnID,
      })
    }

    const assistantTurnID = messageAssistantTurnID ?? backendAssistantTurnID ?? target.assistantTurnID
    applyStreamEventToAssistantTurn(
      {
        sessionID: target.sessionID,
        assistantTurnID,
      },
      streamEvent,
    )
    if (target.userTurnID && isBackendUserMessageRecordedStreamEvent(streamEvent)) {
      revealBackendRecordedUserTurn({
        sessionID: target.sessionID,
        userTurnID: target.userTurnID,
        beforeTurnID: assistantTurnID,
      })
    }
    if (isSteerHandoffBoundaryStreamEvent(streamEvent)) {
      if (target.pendingInputID) {
        commitPendingConversationInputAsUserTurn({
          sessionID: target.sessionID,
          inputID: target.pendingInputID,
        })
      }
      revealPendingSteerUserTurnsAtHandoff({
        sessionID: target.sessionID,
        assistantTurnID,
      })
    }
    if (isSteerInputConsumedStreamEvent(streamEvent)) {
      if (
        !target.pendingInputID ||
        !commitPendingSteerInputAsConsumedInsertion({
          sessionID: target.sessionID,
          inputID: target.pendingInputID,
          assistantTurnID,
        })
      ) {
        markPendingSteerUserTurnsConsumed(target.sessionID, assistantTurnID)
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
      clearRendererPerformanceEntries("session-stream-terminal")
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

    if (sessionEventRouterRef.current.hasBackendTurnSettled(streamEvent.sessionID, backendTurnID)) return

    const streamMessageID = resolveStreamMessageID(streamEvent)
    const messageAssistantTurnID = findAssistantTurnIDByMessageID(uiSessionID, streamMessageID)
    const backendAssistantTurnID = findAssistantTurnIDByBackendTurnID(uiSessionID, backendTurnID)
    const assistantTurnID = messageAssistantTurnID ?? backendAssistantTurnID ?? ensureAssistantTurnForBackendTurn({
      uiSessionID,
      backendSessionID: streamEvent.sessionID,
      turnID: backendTurnID,
    })
    if (!messageAssistantTurnID && !backendAssistantTurnID) {
      void mergeExternalTurnUserHistory({
        uiSessionID,
        backendSessionID: streamEvent.sessionID,
        backendTurnID,
        assistantTurnID,
      })
    }
    if (messageAssistantTurnID || backendAssistantTurnID) {
      sessionEventRouterRef.current.setTurnTarget(streamEvent.sessionID, backendTurnID, {
        sessionID: uiSessionID,
        assistantTurnID,
      })
    }

    applyStreamEventToAssistantTurn(
      {
        sessionID: uiSessionID,
        assistantTurnID,
      },
      streamEvent,
    )
    if (isBackendUserMessageRecordedStreamEvent(streamEvent)) {
      revealPendingUserTurnForBackendEvent({
        uiSessionID,
        backendSessionID: streamEvent.sessionID,
        backendTurnID,
      })
    }
    if (isSteerHandoffBoundaryStreamEvent(streamEvent)) {
      revealPendingSteerUserTurnsAtHandoff({
        sessionID: uiSessionID,
        assistantTurnID,
      })
    }
    if (isSteerInputConsumedStreamEvent(streamEvent)) {
      markPendingSteerUserTurnsConsumed(uiSessionID, assistantTurnID)
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
      clearRendererPerformanceEntries("session-stream-terminal")
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
      agentSessionStoreRef.current.dispatch({
        type: "subscription.state",
        event: sessionEvent,
      })
      return
    }

    if (sessionEvent.kind === "focus-session") {
      onFocusSession(sessionEvent.backendSessionID)
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
        replaceConversationTurnsFromHistory(sessionID, buildTurnsFromHistory(messages), {
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
    await ensurePendingPermissionRequestsLoaded(sessionID, backendSessionID, {
      force: true,
      mode: "silent",
      reason: "manual",
      ...options,
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
    appendConversationTurns,
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
    replaceConversationTurns,
    resolveBackendSessionID,
    scheduleRuntimeDebugRefresh,
    scheduleSessionDiffRefreshForSession,
    updateAssistantConversationTurn,
    updateSessionContextUsage,
  }
}
