import type {
  PermissionRequestPrompt,
  PermissionResolveInput,
  PermissionResolveResult,
} from "../../../../shared/permission"
import type {
  AgentStreamEvent,
  ComposerAttachment,
  LoadedSessionHistoryMessage,
  ReasoningEffort,
} from "../types"

export type AgentSessionBridgeEvent =
  | {
      kind: "stream"
      source: "request" | "subscription"
      backendSessionID: string
      uiSessionID?: string
      clientTurnID?: string
      id?: string
      event: string
      data: unknown
      receivedAt: number
    }
  | {
      kind: "subscription-state"
      backendSessionID: string
      uiSessionID?: string
      state: "connecting" | "connected" | "reconnecting" | "closed" | "error"
      message?: string
      lastEventID?: string
      receivedAt: number
    }
  | {
      kind: "focus-session"
      backendSessionID: string
      receivedAt: number
    }

export interface AgentSessionTurnInput {
  clientTurnID: string
  backendSessionID: string
  text?: string
  displayText?: string
  parentMessageID?: string | null
  attachments?: Array<Pick<ComposerAttachment, "path" | "name">>
  questionAnswer?: {
    questionID: string
    selectedOptions?: string[]
    freeformText?: string
  }
  concurrentInputMode?: "queue" | "steer"
  reasoningEffort?: ReasoningEffort
  model?: {
    providerID: string
    modelID: string
  }
  system?: string
  agent?: string
  skills?: string[]
}

export interface AgentSessionSendTurnResult {
  clientTurnID: string
  requestId?: string
  events?: AgentStreamEvent[]
}

export interface AgentSessionCancelTurnResult {
  clientTurnID: string
  backendSessionID: string
  localRequestAborted: boolean
  backendCancelled: boolean
  backendCancelError?: string
}

export interface AgentSessionAbortTurnResult {
  clientTurnID: string
  backendSessionID: string
  localRequestAborted: boolean
}

export interface AgentSessionCompactResult {
  sessionID: string
  status: "compacted" | "noop"
  reason?: "not-enough-history"
  compactedMessageID?: string
  compactionID?: string
  compactedFromMessageID?: string
  compactedToMessageID?: string
  sourceMessageCount: number
  estimatedTokens?: number
}

export interface AgentSessionInterruptResult {
  backendSessionID: string
  clientTurnID?: string
  localRequestsAborted: number
  backendCancelled: boolean
  activeCancelled?: boolean
  queuedCancelled?: number
  backendCancelError?: string
}

export interface AgentSessionBridge {
  canStream: boolean
  canResumeStream: boolean
  loadHistory(input: { backendSessionID: string; view?: "active" | "all" }): Promise<LoadedSessionHistoryMessage[]>
  compact?(input: { backendSessionID: string }): Promise<AgentSessionCompactResult>
  sendTurn(input: AgentSessionTurnInput): Promise<AgentSessionSendTurnResult>
  resumeTurn(input: { clientTurnID: string; backendSessionID: string }): Promise<AgentSessionSendTurnResult>
  cancelTurn(input: { clientTurnID: string; backendSessionID: string }): Promise<AgentSessionCancelTurnResult>
  abortTurn?(input: { clientTurnID: string; backendSessionID: string }): Promise<AgentSessionAbortTurnResult>
  interrupt(input: { backendSessionID: string; clientTurnID?: string; reason?: "user-interrupt" }): Promise<AgentSessionInterruptResult>
  answerQuestion(input: {
    backendSessionID: string
    questionID: string
    selectedOptions?: string[]
    freeformText?: string
  }): Promise<{
    sessionID: string
    questionID: string
    selectedOptions?: string[]
    freeformText?: string
    answerText: string
    answeredAt: number
  }>
  subscribe(input: { uiSessionID: string; backendSessionID: string }): Promise<{
    backendSessionID: string
    lastEventID?: string
  }>
  unsubscribe(input: { backendSessionID: string }): Promise<{
    backendSessionID: string
    removed: boolean
  }>
  loadPermissionRequests(input: { backendSessionID: string }): Promise<PermissionRequestPrompt[]>
  respondPermissionRequest(input: PermissionResolveInput): Promise<PermissionResolveResult>
  onEvent(listener: (event: AgentSessionBridgeEvent) => void): () => void
}

function createModernAgentSessionBridge(desktop: NonNullable<Window["desktop"]>): AgentSessionBridge | null {
  const modern = desktop.agentSession
  if (!modern) return null
  const compact = modern.compact

  return {
    canStream: true,
    canResumeStream: true,
    loadHistory: modern.loadHistory,
    compact: compact ? (input) => compact(input) : undefined,
    sendTurn: modern.sendTurn,
    resumeTurn: modern.resumeTurn,
    cancelTurn: modern.cancelTurn,
    abortTurn: modern.abortTurn,
    interrupt: modern.interrupt,
    answerQuestion: modern.answerQuestion,
    subscribe: (input) => modern.subscribe(input),
    unsubscribe: modern.unsubscribe,
    loadPermissionRequests: modern.loadPermissionRequests,
    respondPermissionRequest: modern.respondPermissionRequest,
    onEvent: modern.onEvent,
  }
}

export function getAgentSessionBridge(): AgentSessionBridge | null {
  const desktop = window.desktop
  if (!desktop) return null
  return createModernAgentSessionBridge(desktop)
}
