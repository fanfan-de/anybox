import * as Orchestrator from "#session/runtime/orchestrator.ts"
import * as EventStore from "#session/runtime/event-store.ts"
import * as RunningState from "#session/runtime/running-state.ts"
import * as SessionRunner from "#session/runtime/session-runner.ts"
import * as RuntimeEvent from "#session/runtime/runtime-event.ts"
import type * as StoredTrace from "#session/runtime/stored-trace-event.ts"
import * as Session from "#session/core/session.ts"
import * as Task from "#session/tasks/task.ts"
import * as Log from "#util/log.ts"

type RuntimeEventTone = "info" | "success" | "warning" | "error"

export type RuntimeEventSummary = {
  eventID: string
  type: string
  sessionID: string
  turnID: string | null
  seq: number
  timestamp: number
  cursor: string
  title: string
  detail?: string
  tone: RuntimeEventTone
  summary?: Record<string, unknown>
}

export type RuntimeToolSummary = {
  callID: string
  tool: string
  title?: string
  status: string
  startedAt?: number
  endedAt?: number
  durationMs?: number
  approvalID?: string
  inputPreview?: string
  outputPreview?: string
  error?: string
}

export type RuntimeLlmCallSummary = {
  id: string
  messageID: string
  providerID: string
  modelID: string
  agent?: string
  iteration?: number
  status: "running" | "completed" | "failed"
  startedAt: number
  endedAt?: number
  durationMs?: number
  messageCount: number
  toolCount?: number
  requestedToolCount?: number
  toolsDisabledReason?: "model_does_not_support_toolcall"
  hasAttachments?: boolean
  topLevelImageParts?: number
  toolResultImageParts?: number
  totalImageBytes?: number
  images?: Array<{
    location: "top-level" | "tool-result"
    mime: string
    bytes?: number
    width?: number
    height?: number
    sha256?: string
    sourceTool?: string
  }>
  finishReason?: string
  usage?: {
    inputTokens?: number
    outputTokens?: number
    reasoningTokens?: number
    cacheReadTokens?: number
    cacheWriteTokens?: number
  }
  error?: string
  retryable?: boolean
}

export type RuntimeErrorContextSummary = {
  phase?: RuntimeEvent.TurnRuntimePhase
  messageID?: string
  agent?: string
  model?: string
  iteration?: number
  error: {
    name?: string
    message: string
    code?: string
    statusCode?: number
    retryable?: boolean
  }
  activeTools: Array<{
    callID: string
    tool: string
    status: string
  }>
  latestTool?: {
    callID: string
    tool: string
    status: string
  }
}

export type RuntimeTurnSummary = {
  id: string
  turnID: string
  startedAt?: number
  endedAt?: number
  durationMs?: number
  lastEventAt?: number
  status: "running" | "completed" | "blocked" | "stopped" | "failed" | "continued_by_user"
  phase?: RuntimeEvent.TurnRuntimePhase
  phaseReason?: string
  phaseUpdatedAt?: number
  userMessageID?: string
  agent?: string
  model?: string
  resume: boolean
  finishReason?: string
  message?: {
    messageID?: string
    role?: string
    created?: number
    completed?: number
    finishReason?: string
    providerID?: string
    modelID?: string
    agent?: string
    error?: string
  } | null
  llmCalls: RuntimeLlmCallSummary[]
  tools: RuntimeToolSummary[]
  error?: {
    name?: string
    message: string
    code?: string
    statusCode?: number
    retryable?: boolean
    messageID?: string
    providerID?: string
    modelID?: string
    agent?: string
  } | null
  errorContext?: RuntimeErrorContextSummary | null
  recentEvents: RuntimeEventSummary[]
}

export type SessionRuntimeDebugSnapshot = {
  generatedAt: number
  logging: ReturnType<typeof Log.status>
  session: {
    id: string
    projectID?: string
    directory?: string
    title?: string
    created?: number
    updated?: number
    missing: boolean
  }
  status: {
    type: "busy" | "idle"
    phase?: RuntimeEvent.TurnRuntimePhase
  }
  running: RunningState.RunningSessionSnapshot | {
    sessionID: string
    startedAt: null
    activeForMs: 0
    reason?: string
  }
  runner: SessionRunner.SessionRunnerSnapshot | null
  executions: SessionRunner.SessionRunnerSnapshot[]
  runnerLimits: ReturnType<typeof SessionRunner.runtimeLimitsSnapshot>
  activeTurnID: string | null
  turn: RuntimeTurnSummary | null
  latestTurn: RuntimeTurnSummary | null
  turns: RuntimeTurnSummary[]
  recentEvents: RuntimeEventSummary[]
  tasks: Task.SessionTaskListView
  diagnostics: {
    blockedOnApproval: boolean
    activeToolCount: number
    failedToolCount: number
    llmFailureCount: number
    lastErrorMessage?: string
  }
}

type MutableTurnSummary = Omit<RuntimeTurnSummary, "tools" | "llmCalls" | "recentEvents"> & {
  tools: Map<string, RuntimeToolSummary>
  llmCalls: RuntimeLlmCallSummary[]
  recentEvents: RuntimeEventSummary[]
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function readString(value: unknown) {
  return typeof value === "string" ? value : ""
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function truncate(value: string, maxLength = 180) {
  if (value.length <= maxLength) return value
  return `${value.slice(0, Math.max(0, maxLength - 1))}…`
}

function summarizeStructuredValue(value: unknown, fallback = "") {
  if (typeof value === "string") {
    return truncate(value.trim(), 180)
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value)
  }

  if (value == null) return fallback

  try {
    return truncate(JSON.stringify(value), 180)
  } catch {
    return truncate(String(value), 180)
  }
}

function summarizeUsage(value: {
  inputTokens?: number
  outputTokens?: number
  reasoningTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
} | undefined) {
  if (!value) return undefined

  return {
    inputTokens: value.inputTokens,
    outputTokens: value.outputTokens,
    reasoningTokens: value.reasoningTokens,
    cacheReadTokens: value.cacheReadTokens,
    cacheWriteTokens: value.cacheWriteTokens,
  }
}

function summarizeModelRef(model: { providerID: string; modelID: string } | undefined) {
  if (!model?.providerID || !model.modelID) return undefined
  return `${model.providerID}/${model.modelID}`
}

function summarizeMessage(value: unknown) {
  const message = readRecord(value)
  if (!message) return null

  return {
    messageID: readString(message.id) || undefined,
    role: readString(message.role) || undefined,
    created: readNumber(message.created),
    completed: readNumber(message.completed),
    finishReason: readString(message.finishReason) || undefined,
    providerID: readString(message.providerID) || undefined,
    modelID: readString(message.modelID) || undefined,
    agent: readString(message.agent) || undefined,
    error: readString(readRecord(message.error)?.message) || undefined,
  }
}

function summarizeToolState(part: {
  callID: string
  tool: string
  state: Record<string, unknown>
}) {
  const status = readString(part.state.status) || "unknown"
  const startedAt = readNumber(readRecord(part.state.time)?.start)
  const endedAt = readNumber(readRecord(part.state.time)?.end)

  return {
    callID: part.callID,
    tool: part.tool,
    title: readString(part.state.title) || undefined,
    status,
    startedAt,
    endedAt,
    durationMs:
      typeof startedAt === "number" && typeof endedAt === "number"
        ? Math.max(0, endedAt - startedAt)
        : undefined,
    approvalID: readString(part.state.approvalID) || undefined,
    inputPreview: summarizeStructuredValue(part.state.input),
    outputPreview:
      status === "completed"
        ? summarizeStructuredValue(part.state.output ?? part.state.modelOutput)
        : undefined,
    error: readString(part.state.error) || readString(part.state.reason) || undefined,
  } satisfies RuntimeToolSummary
}

function summarizeRuntimeEvent(event: RuntimeEvent.RuntimeEvent): RuntimeEventSummary {
  const base = {
    eventID: event.eventID,
    type: event.type,
    sessionID: event.sessionID,
    turnID: event.turnID,
    seq: event.seq,
    timestamp: event.timestamp,
    cursor: RuntimeEvent.serializeCursor(RuntimeEvent.cursorOf(event)),
  }

  switch (event.type) {
    case "turn.started":
      return {
        ...base,
        title: "Turn started",
        detail: [
          event.payload.agent ? `agent=${event.payload.agent}` : null,
          event.payload.model ? `model=${event.payload.model.providerID}/${event.payload.model.modelID}` : null,
          event.payload.resume ? "resume" : null,
        ].filter(Boolean).join(" · ") || undefined,
        tone: "info",
        summary: {
          userMessageID: event.payload.userMessageID,
          agent: event.payload.agent,
          model: summarizeModelRef(event.payload.model),
          resume: event.payload.resume ?? false,
        },
      }
    case "turn.state.changed":
      return {
        ...base,
        title: `Phase: ${event.payload.phase}`,
        detail: [
          event.payload.toolName ? `tool=${event.payload.toolName}` : null,
          event.payload.reason ?? null,
        ].filter(Boolean).join(" · ") || undefined,
        tone:
          event.payload.phase === "waiting_approval"
            ? "warning"
            : event.payload.phase === "cancelled"
              ? "warning"
            : event.payload.phase === "failed"
              ? "error"
              : event.payload.phase === "completed"
                ? "success"
                : "info",
        summary: {
          phase: event.payload.phase,
          reason: event.payload.reason,
          messageID: event.payload.messageID,
          toolCallID: event.payload.toolCallID,
          toolName: event.payload.toolName,
          iteration: event.payload.iteration,
        },
      }
    case "llm.call.started":
      return {
        ...base,
        title: "LLM request started",
        detail: `${event.payload.providerID}/${event.payload.modelID} · messages=${event.payload.messageCount}`,
        tone: "info",
        summary: {
          messageID: event.payload.messageID,
          providerID: event.payload.providerID,
          modelID: event.payload.modelID,
          agent: event.payload.agent,
          iteration: event.payload.iteration,
          messageCount: event.payload.messageCount,
          toolCount: event.payload.toolCount,
          requestedToolCount: event.payload.requestedToolCount,
          toolsDisabledReason: event.payload.toolsDisabledReason,
          hasAttachments: event.payload.hasAttachments,
          topLevelImageParts: event.payload.topLevelImageParts,
          toolResultImageParts: event.payload.toolResultImageParts,
          totalImageBytes: event.payload.totalImageBytes,
          images: event.payload.images,
        },
      }
    case "llm.call.completed":
      return {
        ...base,
        title: "LLM request completed",
        detail: [
          `${event.payload.providerID}/${event.payload.modelID}`,
          event.payload.finishReason ? `finish=${event.payload.finishReason}` : null,
        ].filter(Boolean).join(" · "),
        tone: "success",
        summary: {
          messageID: event.payload.messageID,
          providerID: event.payload.providerID,
          modelID: event.payload.modelID,
          agent: event.payload.agent,
          iteration: event.payload.iteration,
          messageCount: event.payload.messageCount,
          toolCount: event.payload.toolCount,
          requestedToolCount: event.payload.requestedToolCount,
          toolsDisabledReason: event.payload.toolsDisabledReason,
          hasAttachments: event.payload.hasAttachments,
          topLevelImageParts: event.payload.topLevelImageParts,
          toolResultImageParts: event.payload.toolResultImageParts,
          totalImageBytes: event.payload.totalImageBytes,
          images: event.payload.images,
          finishReason: event.payload.finishReason,
          usage: summarizeUsage(event.payload.usage),
        },
      }
    case "llm.call.failed":
      return {
        ...base,
        title: "LLM request failed",
        detail: truncate(event.payload.error, 180),
        tone: "error",
        summary: {
          messageID: event.payload.messageID,
          providerID: event.payload.providerID,
          modelID: event.payload.modelID,
          agent: event.payload.agent,
          iteration: event.payload.iteration,
          error: event.payload.error,
          retryable: event.payload.retryable,
          messageCount: event.payload.messageCount,
          toolCount: event.payload.toolCount,
          requestedToolCount: event.payload.requestedToolCount,
          toolsDisabledReason: event.payload.toolsDisabledReason,
          hasAttachments: event.payload.hasAttachments,
          topLevelImageParts: event.payload.topLevelImageParts,
          toolResultImageParts: event.payload.toolResultImageParts,
          totalImageBytes: event.payload.totalImageBytes,
          images: event.payload.images,
        },
      }
    case "message.recorded": {
      const message = summarizeMessage(event.payload.message)
      return {
        ...base,
        title: "Message recorded",
        detail: [
          message?.role ? `role=${message.role}` : null,
          message?.messageID ? `id=${message.messageID}` : null,
        ].filter(Boolean).join(" · ") || undefined,
        tone: "info",
        summary: message ?? undefined,
      }
    }
    case "part.recorded":
      return {
        ...base,
        title: "Part recorded",
        detail: `type=${readString(readRecord(event.payload.part)?.type) || "unknown"}`,
        tone: "info",
      }
    case "part.removed":
      return {
        ...base,
        title: "Part removed",
        detail: event.payload.partID,
        tone: "warning",
        summary: {
          partID: event.payload.partID,
          messageID: event.payload.messageID,
        },
      }
    case "permission.requested": {
      const request = readRecord(event.payload.request)
      return {
        ...base,
        title: "Approval requested",
        detail: readString(readRecord(event.payload.part)?.tool) || readString(request?.toolName) || undefined,
        tone: "warning",
        summary: {
          requestID: readString(request?.id) || undefined,
          status: readString(request?.status) || undefined,
          toolCallID: readString(readRecord(event.payload.part)?.toolCallID) || undefined,
        },
      }
    }
    case "permission.resolved": {
      const request = readRecord(event.payload.request)
      return {
        ...base,
        title: "Approval resolved",
        detail: readString(request?.status) || undefined,
        tone: "info",
        summary: {
          requestID: readString(request?.id) || undefined,
          status: readString(request?.status) || undefined,
        },
      }
    }
    case "text.part.started":
    case "reasoning.part.started":
      return {
        ...base,
        title: `${event.payload.kind === "reasoning" ? "Reasoning" : "Response"} started`,
        detail: `message=${event.payload.messageID}`,
        tone: "info",
      }
    case "text.part.delta":
    case "reasoning.part.delta":
      return {
        ...base,
        title: `${event.payload.kind === "reasoning" ? "Reasoning" : "Response"} delta`,
        detail: `delta=${event.payload.delta.length} chars`,
        tone: "info",
      }
    case "text.part.completed":
    case "reasoning.part.completed":
      return {
        ...base,
        title: `${event.payload.part.type === "reasoning" ? "Reasoning" : "Response"} completed`,
        detail: `length=${event.payload.part.text.length} chars`,
        tone: "success",
      }
    case "tool.call.pending": {
      const summary = summarizeToolState({
        callID: event.payload.part.callID,
        tool: event.payload.part.tool,
        state: readRecord(event.payload.part.state) ?? {},
      })
      return {
        ...base,
        title: `Tool input streaming: ${summary.tool}`,
        detail: summary.inputPreview,
        tone: "info",
        summary,
      }
    }
    case "tool.call.started": {
      const summary = summarizeToolState({
        callID: event.payload.part.callID,
        tool: event.payload.part.tool,
        state: readRecord(event.payload.part.state) ?? {},
      })
      return {
        ...base,
        title: `Tool started: ${summary.tool}`,
        detail: summary.title ?? summary.inputPreview,
        tone: "info",
        summary,
      }
    }
    case "tool.call.waiting_approval": {
      const summary = summarizeToolState({
        callID: event.payload.part.callID,
        tool: event.payload.part.tool,
        state: readRecord(event.payload.part.state) ?? {},
      })
      return {
        ...base,
        title: `Tool waiting for approval: ${summary.tool}`,
        detail: summary.title ?? summary.inputPreview,
        tone: "warning",
        summary,
      }
    }
    case "tool.call.approved":
      return {
        ...base,
        title: `Tool approved: ${event.payload.part.tool}`,
        detail: event.payload.part.callID,
        tone: "info",
      }
    case "tool.call.denied": {
      const summary = summarizeToolState({
        callID: event.payload.part.callID,
        tool: event.payload.part.tool,
        state: readRecord(event.payload.part.state) ?? {},
      })
      return {
        ...base,
        title: `Tool denied: ${summary.tool}`,
        detail: summary.error,
        tone: "warning",
        summary,
      }
    }
    case "tool.call.cancelled": {
      const summary = summarizeToolState({
        callID: event.payload.part.callID,
        tool: event.payload.part.tool,
        state: readRecord(event.payload.part.state) ?? {},
      })
      return {
        ...base,
        title: `Tool cancelled: ${summary.tool}`,
        detail: summary.error,
        tone: "warning",
        summary,
      }
    }
    case "tool.call.completed": {
      const summary = summarizeToolState({
        callID: event.payload.part.callID,
        tool: event.payload.part.tool,
        state: readRecord(event.payload.part.state) ?? {},
      })
      return {
        ...base,
        title: `Tool completed: ${summary.tool}`,
        detail: summary.outputPreview,
        tone: "success",
        summary,
      }
    }
    case "tool.call.failed": {
      const summary = summarizeToolState({
        callID: event.payload.part.callID,
        tool: event.payload.part.tool,
        state: readRecord(event.payload.part.state) ?? {},
      })
      return {
        ...base,
        title: `Tool failed: ${summary.tool}`,
        detail: summary.error,
        tone: "error",
        summary,
      }
    }
    case "source.recorded":
      return {
        ...base,
        title: event.payload.part.type === "source-url" ? "Source recorded" : "Document source recorded",
        detail:
          event.payload.part.type === "source-url"
            ? event.payload.part.title ?? event.payload.part.url
            : event.payload.part.title,
        tone: "info",
        summary:
          event.payload.part.type === "source-url"
            ? {
                sourceID: event.payload.part.sourceID,
                url: event.payload.part.url,
                title: event.payload.part.title,
              }
            : {
                sourceID: event.payload.part.sourceID,
                mediaType: event.payload.part.mediaType,
                title: event.payload.part.title,
                filename: event.payload.part.filename,
              },
      }
    case "file.generated":
      return {
        ...base,
        title: event.payload.part.type === "image" ? "Image generated" : "File generated",
        detail: event.payload.part.filename ?? event.payload.part.mime,
        tone: "success",
        summary: {
          type: event.payload.part.type,
          mime: event.payload.part.mime,
          filename: event.payload.part.filename,
        },
      }
    case "patch.generated":
      return {
        ...base,
        title: "Patch generated",
        detail: `${event.payload.part.files.length} file(s) changed`,
        tone: "success",
        summary: {
          fileCount: event.payload.part.files.length,
          files: event.payload.part.files,
        },
      }
    case "snapshot.captured":
      return {
        ...base,
        title: "Snapshot captured",
        detail: event.payload.phase ? `phase=${event.payload.phase}` : undefined,
        tone: "info",
        summary: {
          phase: event.payload.phase,
          snapshotBytes: event.payload.part.snapshot.length,
        },
      }
    case "retry.scheduled":
      return {
        ...base,
        title: "Retry scheduled",
        detail: [
          `attempt=${event.payload.attempt}`,
          event.payload.reason ?? null,
        ].filter(Boolean).join(" · "),
        tone: "warning",
        summary: {
          attempt: event.payload.attempt,
          reason: event.payload.reason,
        },
      }
    case "task.state.updated":
      return {
        ...base,
        title: "Task state updated",
        detail: `${event.payload.state.summary.completed}/${event.payload.state.summary.total} completed`,
        tone: "info",
        summary: {
          action: event.payload.action,
          changedTaskIDs: event.payload.changedTaskIDs,
          total: event.payload.state.summary.total,
          completed: event.payload.state.summary.completed,
          inProgress: event.payload.state.summary.inProgress,
          blocked: event.payload.state.summary.blocked,
        },
      }
    case "subagent.created":
      return {
        ...base,
        title: "Subagent created",
        detail: `${event.payload.title} (${event.payload.agent})`,
        tone: "info",
        summary: {
          taskID: event.payload.taskID,
          childSessionID: event.payload.childSessionID,
          title: event.payload.title,
          agent: event.payload.agent,
          status: event.payload.status,
          updatedAt: event.payload.updatedAt,
        },
      }
    case "turn.completed":
      return {
        ...base,
        title: "Turn completed",
        detail: [
          `status=${event.payload.status}`,
          event.payload.finishReason ? `finish=${event.payload.finishReason}` : null,
        ].filter(Boolean).join(" · "),
        tone: event.payload.status === "completed" ? "success" : "warning",
        summary: {
          status: event.payload.status,
          finishReason: event.payload.finishReason,
          message: summarizeMessage(event.payload.message),
          partCount: event.payload.parts?.length ?? 0,
        },
      }
    case "turn.failed":
      return {
        ...base,
        title: "Turn failed",
        detail: truncate(
          event.payload.errorInfo?.name
            ? `${event.payload.errorInfo.name}: ${event.payload.error}`
            : event.payload.error,
          180,
        ),
        tone: "error",
        summary: {
          error: event.payload.error,
          errorInfo: event.payload.errorInfo,
          message: summarizeMessage(event.payload.message),
          partCount: event.payload.parts?.length ?? 0,
        },
      }
    case "turn.cancelled":
      return {
        ...base,
        title: "Turn cancelled",
        detail: truncate(event.payload.detail ?? event.payload.reason ?? "cancelled", 180),
        tone: "warning",
        summary: {
          reason: event.payload.reason,
          detail: event.payload.detail,
          message: summarizeMessage(event.payload.message),
          partCount: event.payload.parts?.length ?? 0,
        },
      }
    case "turn.error.context":
      return {
        ...base,
        title: "Failure context captured",
        detail: truncate(event.payload.error.message, 180),
        tone: "error",
        summary: {
          phase: event.payload.phase,
          agent: event.payload.agent,
          model: summarizeModelRef(event.payload.model),
          iteration: event.payload.iteration,
          error: event.payload.error,
          activeTools: event.payload.activeTools,
          latestTool: event.payload.latestTool,
        },
      }
  }
  return {
    ...base,
    title: event.type,
    detail: "Runtime event",
    tone: "info",
  }
}

function summarizeStoredTraceEvent(event: StoredTrace.StoredTraceEvent): RuntimeEventSummary {
  const payload = event.payload
  const failed = event.type.endsWith(".failed") || event.type === "turn.error.context"
  const warning = event.type.includes("waiting_approval") || event.type.endsWith(".denied") || event.type.endsWith(".cancelled")
  const success = event.type.endsWith(".completed")
  const subject = payload.toolName
    ? `${payload.toolName}${payload.status ? ` · ${payload.status}` : ""}`
    : payload.phase ?? payload.status ?? payload.finishReason
  return {
    eventID: event.eventID,
    type: event.type,
    sessionID: event.sessionID,
    turnID: event.turnID,
    seq: event.seq,
    timestamp: event.timestamp,
    cursor: `trace.${event.position}`,
    title: event.type,
    detail: payload.error ? truncate(payload.error, 180) : subject,
    tone: failed ? "error" : warning ? "warning" : success ? "success" : "info",
    summary: payload,
  }
}

function updateTurnFromStoredTrace(
  turn: MutableTurnSummary,
  event: StoredTrace.StoredTraceEvent,
  eventLimit: number,
) {
  const payload = event.payload
  turn.lastEventAt = event.timestamp
  const summary = summarizeStoredTraceEvent(event)
  turn.recentEvents.push(summary)
  if (turn.recentEvents.length > eventLimit) {
    turn.recentEvents.splice(0, turn.recentEvents.length - eventLimit)
  }

  if (event.type === "turn.started") {
    turn.startedAt ??= event.timestamp
    turn.status = "running"
  }
  if (event.type === "turn.state.changed" && payload.phase) {
    turn.phase = RuntimeEvent.TurnRuntimePhase.safeParse(payload.phase).success
      ? payload.phase as RuntimeEvent.TurnRuntimePhase
      : turn.phase
    turn.phaseUpdatedAt = event.timestamp
  }
  if (event.type === "llm.call.started") {
    turn.llmCalls.push({
      id: event.eventID,
      messageID: payload.messageID ?? `unknown:${event.eventID}`,
      providerID: payload.providerID ?? "unknown",
      modelID: payload.modelID ?? "unknown",
      agent: payload.agent,
      iteration: payload.iteration,
      status: "running",
      startedAt: event.timestamp,
      messageCount: payload.messageCount ?? 0,
      toolCount: payload.toolCount,
      requestedToolCount: payload.requestedToolCount,
      toolsDisabledReason: payload.toolsDisabledReason,
      hasAttachments: payload.hasAttachments,
      topLevelImageParts: payload.topLevelImageParts,
      toolResultImageParts: payload.toolResultImageParts,
      totalImageBytes: payload.totalImageBytes,
      images: payload.images,
    })
    return
  }
  if (event.type === "llm.call.completed" || event.type === "llm.call.failed") {
    const existing = payload.messageID
      ? findOpenLlmCall(turn, payload.messageID, payload.iteration)
      : undefined
    const status = event.type === "llm.call.completed" ? "completed" : "failed"

    if (existing) {
      existing.status = status
      existing.endedAt = event.timestamp
      existing.durationMs = Math.max(0, event.timestamp - existing.startedAt)
      existing.providerID = payload.providerID ?? existing.providerID
      existing.modelID = payload.modelID ?? existing.modelID
      existing.agent = payload.agent ?? existing.agent
      existing.messageCount = payload.messageCount ?? existing.messageCount
      existing.toolCount = payload.toolCount ?? existing.toolCount
      existing.requestedToolCount = payload.requestedToolCount ?? existing.requestedToolCount
      existing.toolsDisabledReason = payload.toolsDisabledReason ?? existing.toolsDisabledReason
      existing.hasAttachments = payload.hasAttachments ?? existing.hasAttachments
      existing.topLevelImageParts = payload.topLevelImageParts ?? existing.topLevelImageParts
      existing.toolResultImageParts = payload.toolResultImageParts ?? existing.toolResultImageParts
      existing.totalImageBytes = payload.totalImageBytes ?? existing.totalImageBytes
      existing.images = payload.images ?? existing.images
      if (status === "completed") {
        existing.finishReason = payload.finishReason
        existing.usage = summarizeUsage(payload.usage)
      } else {
        existing.error = payload.error
        existing.retryable = payload.retryable
      }
      return
    }

    turn.llmCalls.push({
      id: event.eventID,
      messageID: payload.messageID ?? `unknown:${event.eventID}`,
      providerID: payload.providerID ?? "unknown",
      modelID: payload.modelID ?? "unknown",
      agent: payload.agent,
      iteration: payload.iteration,
      status,
      startedAt: event.timestamp,
      endedAt: event.timestamp,
      durationMs: 0,
      messageCount: payload.messageCount ?? 0,
      toolCount: payload.toolCount,
      requestedToolCount: payload.requestedToolCount,
      toolsDisabledReason: payload.toolsDisabledReason,
      hasAttachments: payload.hasAttachments,
      topLevelImageParts: payload.topLevelImageParts,
      toolResultImageParts: payload.toolResultImageParts,
      totalImageBytes: payload.totalImageBytes,
      images: payload.images,
      finishReason: status === "completed" ? payload.finishReason : undefined,
      usage: status === "completed" ? summarizeUsage(payload.usage) : undefined,
      error: status === "failed" ? payload.error : undefined,
      retryable: status === "failed" ? payload.retryable : undefined,
    })
    return
  }
  if (event.type.startsWith("tool.call.") && payload.callID) {
    const previous = turn.tools.get(payload.callID)
    const terminal = event.type.endsWith(".completed") || event.type.endsWith(".failed") || event.type.endsWith(".denied") || event.type.endsWith(".cancelled")
    turn.tools.set(payload.callID, {
      callID: payload.callID,
      tool: payload.toolName ?? previous?.tool ?? "unknown",
      status: payload.status ?? event.type.slice("tool.call.".length).replaceAll("_", "-"),
      startedAt: previous?.startedAt ?? (event.type.endsWith(".started") ? event.timestamp : undefined),
      endedAt: terminal ? event.timestamp : previous?.endedAt,
      durationMs: payload.durationMs ?? previous?.durationMs,
      error: payload.error,
    })
  }
  if (event.type === "turn.completed") {
    turn.endedAt = event.timestamp
    turn.status = payload.status === "blocked"
      ? "blocked"
      : payload.status === "continued_by_user"
        ? "continued_by_user"
        : payload.status === "stopped"
          ? "stopped"
          : "completed"
    turn.finishReason = payload.finishReason
  } else if (event.type === "turn.failed") {
    turn.endedAt = event.timestamp
    turn.status = "failed"
    turn.error = payload.error ? { message: payload.error, code: payload.errorCode, retryable: payload.retryable } : null
  } else if (event.type === "turn.cancelled") {
    turn.endedAt = event.timestamp
    turn.status = "stopped"
    turn.phase = "cancelled"
    turn.phaseReason = payload.error
  }
}

function createTurnSummary(turnID: string): MutableTurnSummary {
  return {
    id: turnID,
    turnID,
    status: "running",
    resume: false,
    tools: new Map(),
    llmCalls: [],
    recentEvents: [],
    error: null,
    errorContext: null,
    message: null,
  }
}

function upsertTool(turn: MutableTurnSummary, part: { callID: string; tool: string; state: Record<string, unknown> }) {
  turn.tools.set(part.callID, summarizeToolState(part))
}

function findOpenLlmCall(turn: MutableTurnSummary, messageID: string, iteration?: number) {
  return [...turn.llmCalls]
    .reverse()
    .find((call) => call.messageID === messageID && call.endedAt === undefined && (iteration === undefined || call.iteration === iteration))
}

function updateTurnFromEvent(turn: MutableTurnSummary, event: RuntimeEvent.RuntimeEvent, eventLimit: number) {
  turn.lastEventAt = event.timestamp
  const eventSummary = summarizeRuntimeEvent(event)
  turn.recentEvents.push(eventSummary)
  if (turn.recentEvents.length > eventLimit) {
    turn.recentEvents.splice(0, turn.recentEvents.length - eventLimit)
  }

  switch (event.type) {
    case "turn.started":
      turn.startedAt = event.timestamp
      turn.status = "running"
      turn.userMessageID = event.payload.userMessageID
      turn.agent = event.payload.agent
      turn.model = summarizeModelRef(event.payload.model)
      turn.resume = event.payload.resume ?? false
      return
    case "turn.state.changed":
      turn.phase = event.payload.phase
      turn.phaseReason = event.payload.reason
      turn.phaseUpdatedAt = event.timestamp
      return
    case "llm.call.started":
      turn.llmCalls.push({
        id: event.eventID,
        messageID: event.payload.messageID,
        providerID: event.payload.providerID,
        modelID: event.payload.modelID,
        agent: event.payload.agent,
        iteration: event.payload.iteration,
        status: "running",
        startedAt: event.timestamp,
        messageCount: event.payload.messageCount,
        toolCount: event.payload.toolCount,
        requestedToolCount: event.payload.requestedToolCount,
        toolsDisabledReason: event.payload.toolsDisabledReason,
        hasAttachments: event.payload.hasAttachments,
        topLevelImageParts: event.payload.topLevelImageParts,
        toolResultImageParts: event.payload.toolResultImageParts,
        totalImageBytes: event.payload.totalImageBytes,
        images: event.payload.images,
      })
      return
    case "llm.call.completed": {
      const existing = findOpenLlmCall(turn, event.payload.messageID, event.payload.iteration)
      if (existing) {
        existing.status = "completed"
        existing.endedAt = event.timestamp
        existing.durationMs = Math.max(0, event.timestamp - existing.startedAt)
        existing.finishReason = event.payload.finishReason
        existing.usage = summarizeUsage(event.payload.usage)
        return
      }

      turn.llmCalls.push({
        id: event.eventID,
        messageID: event.payload.messageID,
        providerID: event.payload.providerID,
        modelID: event.payload.modelID,
        agent: event.payload.agent,
        iteration: event.payload.iteration,
        status: "completed",
        startedAt: event.timestamp,
        endedAt: event.timestamp,
        durationMs: 0,
        messageCount: event.payload.messageCount,
        toolCount: event.payload.toolCount,
        requestedToolCount: event.payload.requestedToolCount,
        toolsDisabledReason: event.payload.toolsDisabledReason,
        hasAttachments: event.payload.hasAttachments,
        topLevelImageParts: event.payload.topLevelImageParts,
        toolResultImageParts: event.payload.toolResultImageParts,
        totalImageBytes: event.payload.totalImageBytes,
        images: event.payload.images,
        finishReason: event.payload.finishReason,
        usage: summarizeUsage(event.payload.usage),
      })
      return
    }
    case "llm.call.failed": {
      const existing = findOpenLlmCall(turn, event.payload.messageID, event.payload.iteration)
      if (existing) {
        existing.status = "failed"
        existing.endedAt = event.timestamp
        existing.durationMs = Math.max(0, event.timestamp - existing.startedAt)
        existing.error = event.payload.error
        existing.retryable = event.payload.retryable
        return
      }

      turn.llmCalls.push({
        id: event.eventID,
        messageID: event.payload.messageID,
        providerID: event.payload.providerID,
        modelID: event.payload.modelID,
        agent: event.payload.agent,
        iteration: event.payload.iteration,
        status: "failed",
        startedAt: event.timestamp,
        endedAt: event.timestamp,
        durationMs: 0,
        messageCount: event.payload.messageCount,
        toolCount: event.payload.toolCount,
        requestedToolCount: event.payload.requestedToolCount,
        toolsDisabledReason: event.payload.toolsDisabledReason,
        hasAttachments: event.payload.hasAttachments,
        topLevelImageParts: event.payload.topLevelImageParts,
        toolResultImageParts: event.payload.toolResultImageParts,
        totalImageBytes: event.payload.totalImageBytes,
        images: event.payload.images,
        error: event.payload.error,
        retryable: event.payload.retryable,
      })
      return
    }
    case "tool.call.pending":
    case "tool.call.started":
    case "tool.call.waiting_approval":
    case "tool.call.approved":
    case "tool.call.denied":
    case "tool.call.cancelled":
    case "tool.call.completed":
    case "tool.call.failed":
      upsertTool(turn, {
        callID: event.payload.part.callID,
        tool: event.payload.part.tool,
        state: readRecord(event.payload.part.state) ?? {},
      })
      return
    case "turn.completed":
      turn.endedAt = event.timestamp
      turn.status = event.payload.status
      turn.finishReason = event.payload.finishReason
      turn.message = summarizeMessage(event.payload.message)
      return
    case "turn.failed":
      turn.endedAt = event.timestamp
      turn.status = "failed"
      turn.error = {
        message: event.payload.error,
        name: event.payload.errorInfo?.name,
        code: event.payload.errorInfo?.code,
        statusCode: event.payload.errorInfo?.statusCode,
        retryable: event.payload.errorInfo?.retryable,
        ...(summarizeMessage(event.payload.message) ?? {}),
      }
      turn.message = summarizeMessage(event.payload.message)
      return
    case "turn.cancelled":
      turn.endedAt = event.timestamp
      turn.status = "stopped"
      turn.phase = "cancelled"
      turn.phaseReason = event.payload.detail ?? event.payload.reason
      turn.message = summarizeMessage(event.payload.message)
      return
    case "turn.error.context":
      turn.errorContext = {
        phase: event.payload.phase,
        messageID: event.payload.messageID,
        agent: event.payload.agent,
        model: summarizeModelRef(event.payload.model),
        iteration: event.payload.iteration,
        error: {
          name: event.payload.error.name,
          message: event.payload.error.message,
          code: event.payload.error.code,
          retryable: event.payload.error.retryable,
        },
        activeTools: event.payload.activeTools ?? [],
        latestTool: event.payload.latestTool,
      }
      return
    default:
      return
  }
}

function finalizeTurnSummary(turn: MutableTurnSummary): RuntimeTurnSummary {
  const startedAt = turn.startedAt
  const endedAt = turn.endedAt

  return {
    ...turn,
    id: turn.turnID,
    durationMs:
      typeof startedAt === "number"
        ? Math.max(0, (typeof endedAt === "number" ? endedAt : Date.now()) - startedAt)
        : undefined,
    tools: [...turn.tools.values()].sort((left, right) => {
      const leftStart = left.startedAt ?? 0
      const rightStart = right.startedAt ?? 0
      if (leftStart !== rightStart) return rightStart - leftStart
      return left.callID.localeCompare(right.callID)
    }),
    llmCalls: [...turn.llmCalls].sort((left, right) => right.startedAt - left.startedAt),
    recentEvents: [...turn.recentEvents],
  }
}

function summarizeSession(session: Session.SessionInfo | null, sessionID: string) {
  if (!session) {
    return {
      id: sessionID,
      missing: true,
    }
  }

  return {
    id: session.id,
    projectID: session.projectID,
    directory: session.directory,
    title: session.title,
    created: session.time.created,
    updated: session.time.updated,
    missing: false,
  }
}

export function getSessionRuntimeDebugSnapshot(input: {
  sessionID: string
  eventLimit?: number
  turnLimit?: number
  recentOnly?: boolean
}): SessionRuntimeDebugSnapshot {
  const eventLimit = Math.max(5, Math.min(input.eventLimit ?? 25, 100))
  const turnLimit = Math.max(1, Math.min(input.turnLimit ?? 6, 20))
  const session = Session.DataBaseRead("sessions", input.sessionID) as Session.SessionInfo | null
  const running = RunningState.info(input.sessionID)
  const runner = SessionRunner.info(input.sessionID)
  const executions = SessionRunner.snapshot().filter(
    (execution) => execution.sessionID === input.sessionID,
  )
  const activeTurn = Orchestrator.activeTurn(input.sessionID)
  const events = input.recentOnly
    ? EventStore.listRecentSessionEvents({
        sessionID: input.sessionID,
        limit: Math.max(eventLimit, 100),
      })
    : EventStore.listSessionEvents({ sessionID: input.sessionID })
  const turns = new Map<string, MutableTurnSummary>()
  for (const canonical of Session.listTurns(input.sessionID)) {
    const turn = createTurnSummary(canonical.id)
    turn.startedAt = canonical.createdAt
    turn.endedAt = canonical.completedAt
    turn.lastEventAt = canonical.updatedAt
    turn.status = canonical.status === "cancelled" ? "stopped" : canonical.status
    const parsedPhase = RuntimeEvent.TurnRuntimePhase.safeParse(canonical.phase)
    turn.phase = parsedPhase.success ? parsedPhase.data : undefined
    turn.userMessageID = canonical.userMessageID
    turn.agent = canonical.agent
    turn.model = summarizeModelRef(canonical.model)
    turn.resume = canonical.resume ?? false
    turn.finishReason = canonical.finishReason
    turn.error = canonical.error ? {
      message: canonical.error,
      name: canonical.errorInfo?.name,
      code: canonical.errorInfo?.code,
      statusCode: canonical.errorInfo?.statusCode,
      retryable: canonical.errorInfo?.retryable,
    } : null
    turns.set(canonical.id, turn)
  }
  const recentEvents: RuntimeEventSummary[] = []

  for (const event of events) {
    if (event.turnID) {
      const turn = turns.get(event.turnID) ?? createTurnSummary(event.turnID)
      turns.set(event.turnID, turn)
      updateTurnFromStoredTrace(turn, event, eventLimit)
    }

    const eventSummary = summarizeStoredTraceEvent(event)
    recentEvents.push(eventSummary)
    if (recentEvents.length > eventLimit) {
      recentEvents.splice(0, recentEvents.length - eventLimit)
    }
  }

  const finalizedTurns = [...turns.values()]
    .map(finalizeTurnSummary)
    .sort((left, right) => {
      const rightStart = right.startedAt ?? right.lastEventAt ?? 0
      const leftStart = left.startedAt ?? left.lastEventAt ?? 0
      if (rightStart !== leftStart) return rightStart - leftStart
      return right.turnID.localeCompare(left.turnID)
    })
  const latestTurn = finalizedTurns[0] ?? null

  return {
    generatedAt: Date.now(),
    logging: Log.status(),
    session: summarizeSession(session, input.sessionID),
    status: {
      type: running || activeTurn ? "busy" : "idle",
      phase: latestTurn?.status === "running" ? latestTurn.phase : undefined,
    },
    running: running ?? {
      sessionID: input.sessionID,
      startedAt: null,
      activeForMs: 0,
      reason: undefined,
    },
    runner,
    executions,
    runnerLimits: SessionRunner.runtimeLimitsSnapshot(),
    activeTurnID: activeTurn?.turnID ?? null,
    turn: latestTurn,
    latestTurn,
    turns: finalizedTurns.slice(0, turnLimit),
    recentEvents,
    tasks: Task.listSessionTasks(input.sessionID),
    diagnostics: {
      blockedOnApproval: latestTurn?.phase === "waiting_approval" || latestTurn?.status === "blocked",
      activeToolCount: latestTurn?.tools.filter((tool) =>
        tool.status === "running" || tool.status === "pending" || tool.status === "waiting-approval"
      ).length ?? 0,
      failedToolCount: latestTurn?.tools.filter((tool) => tool.status === "error" || tool.status === "denied").length ?? 0,
      llmFailureCount: latestTurn?.llmCalls.filter((call) => call.status === "failed").length ?? 0,
      lastErrorMessage:
        latestTurn?.error?.message ??
        latestTurn?.errorContext?.error.message ??
        latestTurn?.tools.find((tool) => tool.error)?.error,
    },
  }
}
