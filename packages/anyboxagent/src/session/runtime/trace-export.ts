import * as Message from "#session/core/message.ts"
import type * as StoredTrace from "#session/runtime/stored-trace-event.ts"
import type { SessionRuntimeDebugSnapshot } from "#session/runtime/runtime-debug.ts"
import type { ToolCallFailure } from "@anybox/shared"

const MAX_SAFE_STRING_LENGTH = 20_000
export const MAX_SINGLE_TRACE_EVENTS = 5_000
const REDACTED_VALUE = "[REDACTED]"
const SENSITIVE_KEY_PATTERN = /^(?:.*(?:api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|auth[_-]?token|client[_-]?secret|private[_-]?key)|token|secret|authorization|password|passwd|credential|cookie|set-cookie)$/i
const SENSITIVE_INLINE_KEY_SOURCE = "api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|auth[_-]?token|token|secret|authorization|password|passwd|credential|cookie|set-cookie|private[_-]?key"
const STRUCTURED_RAW_STRING_KEY_PATTERN = /^raw(Input)?$/i
const SENSITIVE_INLINE_VALUE_PATTERN = new RegExp(
  `((?:"|')?(?:${SENSITIVE_INLINE_KEY_SOURCE})(?:"|')?\\s*[:=]\\s*)("[^"]*"|'[^']*'|[^\\s,;}&]+)`,
  "gi",
)

export interface TraceExportRedactionStats {
  redactedCount: number
  truncatedCount: number
}

export type TraceToolDiagnosticSeverity = "warning" | "error"

export interface TraceToolDiagnostic {
  severity: TraceToolDiagnosticSeverity
  code: string
  message: string
}

export type TraceToolDiagnosticStatus = "ok" | TraceToolDiagnosticSeverity

export interface AgentSessionTraceExport {
  schemaVersion: 3
  generatedAt: number
  mode: "safe"
  session: SessionRuntimeDebugSnapshot["session"]
  stats: {
    messageCount: number
    eventCount: number
    turnCount: number
    toolCallCount: number
    redactedCount: number
    truncatedCount: number
    totalRetainedEventCount: number
    omittedEventCount: number
  }
  redaction: {
    enabled: true
    maxStringLength: number
    redactedKeyPattern: string
  }
  messages: unknown[]
  events: Array<{
    position: number
    eventID: string
    sessionID: string
    turnID: string | null
    seq: number
    timestamp: number
    type: string
    payload: unknown
  }>
  runtime: SessionRuntimeDebugSnapshot
  truncation: {
    eventsTruncated: boolean
    maxEvents: number
    omittedEvents: number
  }
  toolCalls: Array<{
    callID: string
    tool: string
    phase: "pending" | "waiting-approval" | "running" | "settled"
    outcome?: "returned" | "blocked" | "denied" | "cancelled" | "timeout" | "failed"
    result?: "success" | "negative"
    completeness?: "complete" | "partial"
    turnControl?: "continue-model" | "wait-user" | "restart-loop" | "finish-turn" | "cancel-turn" | "fail-turn"
    sideEffect?: "none" | "possible" | "confirmed" | "unknown"
    retry?: "safe" | "unsafe" | "unknown"
    turnID?: string
    messageID?: string
    title?: string
    input?: unknown
    rawInput?: string
    output?: unknown
    modelOutput?: unknown
    error?: string
    failure?: ToolCallFailure
    diagnosticStatus: TraceToolDiagnosticStatus
    diagnostics: TraceToolDiagnostic[]
    approvalID?: string
    startedAt?: number
    endedAt?: number
    durationMs?: number
    eventIDs: string[]
  }>
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function readString(value: unknown) {
  return typeof value === "string" ? value : ""
}

export function buildSafeStoredTraceEventPage(events: StoredTrace.StoredTraceEvent[]) {
  const redactionStats: TraceExportRedactionStats = {
    redactedCount: 0,
    truncatedCount: 0,
  }
  return {
    events: events.map((event) => ({
      position: event.position,
      eventID: event.eventID,
      sessionID: event.sessionID,
      turnID: event.turnID,
      seq: event.seq,
      timestamp: event.timestamp,
      type: event.type,
      payload: sanitizeTraceExportValue(event.payload, redactionStats),
    })),
    redaction: redactionStats,
  }
}

function readOptionalString(value: unknown) {
  return typeof value === "string" ? value : undefined
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function readBoolean(value: unknown) {
  return typeof value === "boolean" ? value : undefined
}

function readToolModelOutputValue(modelOutput: unknown) {
  const record = readRecord(modelOutput)
  if (!record) return null

  const jsonValue = readRecord(record.value)
  if (record.type === "json" && jsonValue) return jsonValue

  return record
}

function readToolOutputMetadata(output: unknown) {
  return readRecord(readRecord(output)?.metadata)
}

function firstDefined<T>(values: Array<T | undefined>): T | undefined {
  return values.find((value) => value !== undefined)
}

function buildTraceToolDiagnostics(input: {
  error?: string
  failure?: ToolCallFailure
  modelOutput?: unknown
  outcome?: string
  output?: unknown
  result?: "success" | "negative"
  completeness?: "complete" | "partial"
}): TraceToolDiagnostic[] {
  const diagnostics: TraceToolDiagnostic[] = []
  const seen = new Set<string>()
  const addDiagnostic = (diagnostic: TraceToolDiagnostic) => {
    if (seen.has(diagnostic.code)) return
    seen.add(diagnostic.code)
    diagnostics.push(diagnostic)
  }
  const metadataRecords = [
    readToolModelOutputValue(input.modelOutput),
    readToolOutputMetadata(input.output),
  ].filter((record): record is Record<string, unknown> => record !== null)
  const metadataValue = <T>(reader: (value: unknown) => T | undefined, key: string) =>
    firstDefined(metadataRecords.map((record) => reader(record[key])))

  if (input.outcome === "failed") {
    addDiagnostic({
      severity: "error",
      code: input.failure?.code ?? "tool.lifecycle_error",
      message: input.failure
        ? `${input.failure.stage}/${input.failure.source}: ${input.failure.message}`
        : input.error
          ? `Tool execution failed: ${input.error}`
          : "Tool execution failed.",
    })
  } else if (input.outcome === "timeout") {
    addDiagnostic({
      severity: "warning",
      code: "tool.timeout",
      message: input.error ?? "Tool execution timed out.",
    })
  } else if (input.result === "negative") {
    addDiagnostic({
      severity: "warning",
      code: "tool.negative_result",
      message: "The tool returned a valid negative result.",
    })
  }

  if (input.completeness === "partial") {
    addDiagnostic({
      severity: "warning",
      code: "tool.partial_result",
      message: "The tool returned a partial result.",
    })
  }

  const exitCode = metadataValue(readNumber, "exitCode")
  const stderr = metadataValue(readOptionalString, "stderr")?.trim()
  const stdoutTruncated = metadataValue(readBoolean, "stdoutTruncated") ?? false
  const stderrTruncated = metadataValue(readBoolean, "stderrTruncated") ?? false

  if (input.result === "negative" && exitCode !== undefined && exitCode !== 0) {
    addDiagnostic({
      severity: "warning",
      code: "shell.exit_nonzero",
      message: `Shell command exited with code ${exitCode}.`,
    })
  }

  if (stderr) {
    addDiagnostic({
      severity: "warning",
      code: "shell.stderr",
      message: "Shell command wrote to stderr.",
    })
  }

  if (stdoutTruncated || stderrTruncated) {
    const streams = [
      stdoutTruncated ? "stdout" : "",
      stderrTruncated ? "stderr" : "",
    ].filter(Boolean).join(" and ")
    addDiagnostic({
      severity: "warning",
      code: "shell.output_truncated",
      message: `Shell command ${streams} output was truncated.`,
    })
  }

  return diagnostics
}

function getTraceToolDiagnosticStatus(diagnostics: TraceToolDiagnostic[]): TraceToolDiagnosticStatus {
  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) return "error"
  if (diagnostics.some((diagnostic) => diagnostic.severity === "warning")) return "warning"
  return "ok"
}

function sanitizeString(value: string, stats: TraceExportRedactionStats) {
  let redactedValue = value.replace(/data:(?:([a-z0-9.+/-]+))?(?:;[^,\s"']*)?,[^\s"']+/gi, (_match, mime?: string) => {
    stats.redactedCount += 1
    return `[DATA_URL:${mime || "application/octet-stream"};redacted]`
  })
  redactedValue = redactedValue.replace(/\bAuthorization\s*[:=]\s*(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, (match) => {
    stats.redactedCount += 1
    const separator = match.includes("=") ? "=" : ":"
    return `Authorization${separator} ${REDACTED_VALUE}`
  })
  redactedValue = redactedValue.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, () => {
    stats.redactedCount += 1
    return REDACTED_VALUE
  })
  redactedValue = redactedValue.replace(/\b(?:Cookie|Set-Cookie)\s*:\s*[^\r\n]+/gi, (match) => {
    stats.redactedCount += 1
    return `${match.slice(0, match.indexOf(":"))}: ${REDACTED_VALUE}`
  })
  redactedValue = redactedValue.replace(
    /([?&](?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|passwd|credential)=)[^&#\s"']*/gi,
    (_match, prefix: string) => {
      stats.redactedCount += 1
      return `${prefix}${encodeURIComponent(REDACTED_VALUE)}`
    },
  )
  redactedValue = redactedValue.replace(SENSITIVE_INLINE_VALUE_PATTERN, (match, prefix: string, sensitiveValue: string) => {
    const normalized = sensitiveValue.replace(/^['"]|['"]$/g, "")
    if (normalized.startsWith(REDACTED_VALUE) || normalized.toUpperCase().startsWith("%5BREDACTED%5D")) {
      return match
    }
    stats.redactedCount += 1
    const quote = sensitiveValue.startsWith("\"") ? "\"" : sensitiveValue.startsWith("'") ? "'" : ""
    return `${prefix}${quote}${REDACTED_VALUE}${quote}`
  })

  if (redactedValue.length <= MAX_SAFE_STRING_LENGTH) return redactedValue

  stats.truncatedCount += 1
  return `${redactedValue.slice(0, MAX_SAFE_STRING_LENGTH)}\n[TRUNCATED originalLength=${redactedValue.length} maxLength=${MAX_SAFE_STRING_LENGTH}]`
}

function sanitizeStructuredRawString(value: string, stats: TraceExportRedactionStats) {
  const trimmed = value.trim()
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return undefined

  try {
    return JSON.stringify(sanitizeTraceExportValue(JSON.parse(trimmed), stats))
  } catch {
    return undefined
  }
}

export function sanitizeTraceExportValue(
  value: unknown,
  stats: TraceExportRedactionStats,
  key = "",
  ancestors = new WeakSet<object>(),
): unknown {
  if (key && SENSITIVE_KEY_PATTERN.test(key)) {
    stats.redactedCount += 1
    return REDACTED_VALUE
  }

  if (typeof value === "string") {
    if (STRUCTURED_RAW_STRING_KEY_PATTERN.test(key)) {
      const safeRaw = sanitizeStructuredRawString(value, stats)
      if (safeRaw !== undefined) return sanitizeString(safeRaw, stats)
    }

    return sanitizeString(value, stats)
  }

  if (typeof value !== "object" || value === null) {
    return value
  }

  if (ancestors.has(value)) {
    stats.redactedCount += 1
    return "[CIRCULAR]"
  }
  ancestors.add(value)

  try {
    if (Array.isArray(value)) {
      return value.map((item) => sanitizeTraceExportValue(item, stats, "", ancestors))
    }

    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        sanitizeTraceExportValue(entryValue, stats, entryKey, ancestors),
      ]),
    )
  } finally {
    ancestors.delete(value)
  }
}

function readToolEventCallID(event: StoredTrace.StoredTraceEvent) {
  const payload = readRecord(event.payload)
  const part = readRecord(payload?.part)
  const request = readRecord(payload?.request)

  return (
    readString(part?.callID) ||
    readString(part?.toolCallID) ||
    readString(payload?.toolCallID) ||
    readString(request?.toolCallID) ||
    readString(payload?.callID)
  )
}

function buildToolEventIDsByCallID(events: StoredTrace.StoredTraceEvent[]) {
  const eventIDsByCallID = new Map<string, string[]>()

  for (const event of events) {
    const callID = readToolEventCallID(event)
    if (!callID) continue

    const eventIDs = eventIDsByCallID.get(callID) ?? []
    eventIDs.push(event.eventID)
    eventIDsByCallID.set(callID, eventIDs)
  }

  return eventIDsByCallID
}

function buildRuntimeToolSummaryByCallID(runtime: SessionRuntimeDebugSnapshot) {
  const summaries = new Map<string, SessionRuntimeDebugSnapshot["turns"][number]["tools"][number]>()

  for (const turn of runtime.turns) {
    for (const tool of turn.tools) {
      summaries.set(tool.callID, tool)
    }
  }

  return summaries
}

function buildToolCalls(input: {
  events: StoredTrace.StoredTraceEvent[]
  messages: Message.WithParts[]
  runtime: SessionRuntimeDebugSnapshot
}) {
  const eventIDsByCallID = buildToolEventIDsByCallID(input.events)
  const runtimeToolSummaryByCallID = buildRuntimeToolSummaryByCallID(input.runtime)
  const toolCalls = new Map<string, AgentSessionTraceExport["toolCalls"][number]>()

  for (const message of input.messages) {
    for (const part of message.parts) {
      if (part.type !== "tool") continue

      const state = part.state
      const outcome = Message.toolPartOutcome(part)
      const returned = Message.toolPartReturnedOutcome(part)
      const runtimeTool = runtimeToolSummaryByCallID.get(part.callID)
      const endedAt = part.timestamps.settledAt ?? runtimeTool?.endedAt
      const output = returned?.output ?? (
        outcome?.kind === "blocked"
          ? outcome.output
          : outcome?.kind === "timeout"
            ? outcome.partialOutput
            : outcome?.kind === "failed"
              ? outcome.partialOutput
            : undefined
      )
      const toolCallWithoutDiagnostics = {
        callID: part.callID,
        tool: part.tool,
        phase: state.phase,
        outcome: outcome?.kind,
        result: returned?.result,
        completeness: returned?.completeness,
        turnControl: state.phase === "settled" ? state.control.mode : undefined,
        sideEffect: outcome?.execution.sideEffect,
        retry: outcome?.execution.retry,
        turnID: message.info.turnID,
        messageID: part.messageID,
        title: Message.toolPartTitle(part) ?? runtimeTool?.title,
        input: Message.toolPartInput(part),
        rawInput: part.input.raw || undefined,
        output,
        modelOutput: returned?.modelOutput,
        failure: outcome?.kind === "failed" ? outcome.error : undefined,
        error: outcome?.kind === "failed"
          ? outcome.error.message
          : outcome && outcome.kind !== "returned"
            ? outcome.reason
            : runtimeTool?.error,
        approvalID: state.phase === "waiting-approval"
          ? state.approval.id
          : outcome?.kind === "denied"
            ? outcome.approvalID
            : runtimeTool?.approvalID,
        startedAt: part.timestamps.startedAt ?? runtimeTool?.startedAt,
        endedAt,
        durationMs: runtimeTool?.durationMs,
        eventIDs: eventIDsByCallID.get(part.callID) ?? [],
      }
      const diagnostics = buildTraceToolDiagnostics(toolCallWithoutDiagnostics)
      const toolCall: AgentSessionTraceExport["toolCalls"][number] = {
        ...toolCallWithoutDiagnostics,
        diagnosticStatus: getTraceToolDiagnosticStatus(diagnostics),
        diagnostics,
      }

      toolCalls.set(part.callID, toolCall)
    }
  }

  return [...toolCalls.values()]
}

export function buildAgentSessionTraceExport(input: {
  events: StoredTrace.StoredTraceEvent[]
  generatedAt?: number
  messages: Message.WithParts[]
  runtime: SessionRuntimeDebugSnapshot
  totalRetainedEventCount?: number
}): AgentSessionTraceExport {
  const generatedAt = input.generatedAt ?? Date.now()
  const redactionStats: TraceExportRedactionStats = {
    redactedCount: 0,
    truncatedCount: 0,
  }
  const retainedEvents = input.events.slice(-MAX_SINGLE_TRACE_EVENTS)
  const totalRetainedEventCount = Math.max(input.totalRetainedEventCount ?? input.events.length, input.events.length)
  const omittedEventCount = Math.max(0, totalRetainedEventCount - retainedEvents.length)
  const rawToolCalls = buildToolCalls({ ...input, events: retainedEvents })
  const safeMessages = sanitizeTraceExportValue(input.messages, redactionStats) as unknown[]
  const safeEvents = retainedEvents.map((event) => ({
    position: event.position,
    eventID: event.eventID,
    sessionID: event.sessionID,
    turnID: event.turnID,
    seq: event.seq,
    timestamp: event.timestamp,
    type: event.type,
    payload: sanitizeTraceExportValue(event.payload, redactionStats),
  }))
  const safeRuntime = sanitizeTraceExportValue(input.runtime, redactionStats) as SessionRuntimeDebugSnapshot
  const safeToolCalls = sanitizeTraceExportValue(
    rawToolCalls,
    redactionStats,
  ) as AgentSessionTraceExport["toolCalls"]

  return {
    schemaVersion: 3,
    generatedAt,
    mode: "safe",
    session: safeRuntime.session,
    stats: {
      messageCount: input.messages.length,
      eventCount: retainedEvents.length,
      turnCount: input.runtime.turns.length,
      toolCallCount: safeToolCalls.length,
      redactedCount: redactionStats.redactedCount,
      truncatedCount: redactionStats.truncatedCount,
      totalRetainedEventCount,
      omittedEventCount,
    },
    redaction: {
      enabled: true,
      maxStringLength: MAX_SAFE_STRING_LENGTH,
      redactedKeyPattern: SENSITIVE_KEY_PATTERN.source,
    },
    messages: safeMessages,
    events: safeEvents,
    runtime: safeRuntime,
    truncation: {
      eventsTruncated: omittedEventCount > 0,
      maxEvents: MAX_SINGLE_TRACE_EVENTS,
      omittedEvents: omittedEventCount,
    },
    toolCalls: safeToolCalls,
  }
}
