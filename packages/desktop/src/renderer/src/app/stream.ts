import { STREAM_PENDING_PREFIX } from "./constants"
import type {
  AgentStreamEvent,
  AgentRuntimeEvent,
  AssistantQuestionPrompt,
  AssistantTraceDebugEntry,
  AssistantTraceDraftPatchPreview,
  AssistantTraceItem,
  AssistantTraceSectionKey,
  AssistantTraceStatus,
  AssistantTraceVisibilityKey,
  AssistantTurn,
  AssistantTurnPhase,
  AssistantTurnRuntime,
  LoadedSessionHistoryMessage,
  SessionDiffSummary,
  SessionTaskSummary,
  SessionSummary,
  Turn,
  UserTurn,
  UserTurnAttachment,
  UserTurnReference,
} from "./types"
import { toDraftPatchPreview } from "./streaming-patch-preview"
import { compactText, createID } from "./utils"

const STREAM_TEXT_RENDER_LIMIT = 160_000
const STREAM_TOOL_INPUT_RENDER_LIMIT = 120_000
const STREAM_RENDER_TRUNCATION_MARKER = "\n\n[Renderer truncated this live stream item to keep the desktop responsive.]"

function readString(value: unknown) {
  return typeof value === "string" ? value : ""
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

function readOptionalNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function readSessionDiffSummary(value: unknown): SessionDiffSummary | undefined {
  const record = readRecord(value)
  if (!record) return undefined

  const rawDiffs = Array.isArray(record.diffs) ? record.diffs : []
  const diffs = rawDiffs
    .map((item) => {
      const diff = readRecord(item)
      if (!diff) return null

      const file = readString(diff.file).trim()
      if (!file) return null

      const additions = readNumber(diff.additions)
      const deletions = readNumber(diff.deletions)
      const patch = readString(diff.patch).trim()
      return {
        file,
        additions,
        deletions,
        ...(patch ? { patch } : {}),
      }
    })
    .filter((item): item is SessionDiffSummary["diffs"][number] => item !== null)

  if (diffs.length === 0) return undefined

  const statsRecord = readRecord(record.stats)
  const stats = statsRecord
    ? {
        additions: readNumber(statsRecord.additions),
        deletions: readNumber(statsRecord.deletions),
        files: readNumber(statsRecord.files),
      }
    : undefined
  const title = readString(record.title).trim()
  const body = readString(record.body).trim()

  return {
    ...(title ? { title } : {}),
    ...(body ? { body } : {}),
    ...(stats ? { stats } : {}),
    diffs,
  }
}

function readMessageID(value: unknown) {
  const message = readRecord(value)
  return readString(message?.id)
}

function applyAssistantMessageMetadata(turn: AssistantTurn, messageValue: unknown): AssistantTurn {
  const message = readRecord(messageValue)
  if (!message) return turn

  const diffSummary = readSessionDiffSummary(message.diffSummary)
  const nextTurn: AssistantTurn = {
    ...turn,
    messageID: readString(message.id) || turn.messageID,
  }
  if (diffSummary) {
    nextTurn.diffSummary = diffSummary
  } else {
    delete nextTurn.diffSummary
  }
  return nextTurn
}

function resolvePayloadMessageID(payload: Record<string, unknown>) {
  return readString(payload.messageID) || readMessageID(payload.message)
}

function readRuntimeEvent(item: AgentStreamEvent): AgentRuntimeEvent | null {
  if (item.event !== "runtime") return null

  const event = readRecord(item.data)
  const payload = readRecord(event?.payload)
  const eventID = readString(event?.eventID)
  const sessionID = readString(event?.sessionID)
  const turnID = readString(event?.turnID)
  const type = readString(event?.type)
  const seq = readNumber(event?.seq)
  const timestamp = readNumber(event?.timestamp)

  if (!eventID || !sessionID || !turnID || !type || seq <= 0) return null

  return {
    eventID,
    sessionID,
    turnID,
    seq,
    timestamp,
    type,
    payload: payload ?? {},
  }
}

function isSettledRuntimePhase(phase: string) {
  return phase === "completed" || phase === "blocked" || phase === "continued_by_user" || phase === "cancelled" || phase === "failed"
}

function isSettledAssistantPhase(phase: AssistantTurnPhase) {
  return phase === "completed" || phase === "blocked" || phase === "continued_by_user" || phase === "cancelled" || phase === "failed"
}

function isTerminalTraceStatus(status: AssistantTraceStatus | undefined) {
  return status === "completed" || status === "error" || status === "denied" || status === "cancelled"
}

function isTerminalRuntimeEventType(type: string) {
  return type === "turn.completed" || type === "turn.failed" || type === "turn.cancelled"
}

function isTerminalLegacyStreamEvent(event: string) {
  return event === "done" || event === "error"
}

function canInferLifecycleFromTrace(phase: AssistantTurnPhase) {
  return !isSettledAssistantPhase(phase) && phase !== "waiting_approval"
}

function canInferModelWaitFromRuntimePhase(phase: AssistantTurnPhase) {
  return phase === "requesting" || phase === "waiting_first_event" || phase === "preparing"
}

function describeOptionalStructuredValue(
  value: unknown,
  options?: {
    maxLength?: number
    pretty?: boolean
  },
) {
  if (typeof value === "string") {
    const normalized = options?.maxLength ? compactText(value, options.maxLength) : value
    return normalized || undefined
  }

  if (value == null) return undefined

  try {
    const serialized = JSON.stringify(value, null, options?.pretty ? 2 : undefined)
    const normalized = options?.maxLength ? compactText(serialized, options.maxLength) : serialized
    return normalized || undefined
  } catch {
    return undefined
  }
}

function describeStructuredValue(
  value: unknown,
  fallback: string,
  options?: {
    maxLength?: number
    pretty?: boolean
  },
) {
  return describeOptionalStructuredValue(value, options) || fallback
}

function createTraceItem(
  input: Omit<AssistantTraceItem, "id" | "timestamp"> & {
    id?: string
    timestamp?: number
  },
): AssistantTraceItem {
  return {
    id: input.id ?? createID("trace"),
    timestamp: input.timestamp ?? Date.now(),
    ...input,
  }
}

type TraceItemOwnership = Pick<AssistantTraceItem, "messageID" | "backendTurnID">

function normalizeTraceItemOwnership(input?: TraceItemOwnership): TraceItemOwnership {
  return {
    messageID: readString(input?.messageID) || undefined,
    backendTurnID: readString(input?.backendTurnID) || undefined,
  }
}

function traceItemOwnershipFromPart(
  part: Record<string, unknown>,
  fallback?: TraceItemOwnership,
): TraceItemOwnership {
  return normalizeTraceItemOwnership({
    messageID: readString(part.messageID) || fallback?.messageID,
    backendTurnID: readString(part.backendTurnID) || readString(part.turnID) || fallback?.backendTurnID,
  })
}

function traceItemOwnershipFromHistoryMessage(message: LoadedSessionHistoryMessage): TraceItemOwnership {
  return normalizeTraceItemOwnership({
    messageID: message.info.id,
    backendTurnID: message.turn?.id || readString(message.info.turnID),
  })
}

function applyTraceItemOwnership<T extends AssistantTraceItem>(
  item: T,
  ownership?: TraceItemOwnership,
): T {
  const normalized = normalizeTraceItemOwnership(ownership)
  if (!normalized.messageID && !normalized.backendTurnID) return item

  return {
    ...item,
    messageID: item.messageID ?? normalized.messageID,
    backendTurnID: item.backendTurnID ?? normalized.backendTurnID,
  }
}

function applyTraceItemsOwnership<T extends AssistantTraceItem>(
  items: T[],
  ownership?: TraceItemOwnership,
): T[] {
  return items.map((item) => applyTraceItemOwnership(item, ownership))
}

function readTraceTimestamp(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function mergeTraceTimestamp(currentTimestamp: number, nextTimestamp: number) {
  const current = readTraceTimestamp(currentTimestamp)
  const next = readTraceTimestamp(nextTimestamp)
  if (current === null) return next ?? Date.now()
  if (next === null) return current
  return Math.min(current, next)
}

function readPartTimeTimestamp(value: unknown) {
  const range = readRecord(value)
  if (!range) return null

  return readTraceTimestamp(range.start) ?? readTraceTimestamp(range.end)
}

function readCanonicalPartTimestamp(part: Record<string, unknown>) {
  const state = readRecord(part.state)
  const stateTime = readPartTimeTimestamp(state?.time)
  if (stateTime !== null) return stateTime

  return readPartTimeTimestamp(part.time)
}

function isPromptTraceItem(item: AssistantTraceItem) {
  return Boolean(item.sourceID?.endsWith(":prompt"))
}

function insertTraceItemByTimestamp(items: AssistantTraceItem[], nextItem: AssistantTraceItem) {
  const nextTimestamp = readTraceTimestamp(nextItem.timestamp)
  if (nextTimestamp === null) return [...items, nextItem]

  let insertIndex = items.length
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]
    if (!item) continue
    if (isPromptTraceItem(item)) break

    const itemTimestamp = readTraceTimestamp(item.timestamp)
    if (itemTimestamp === null || itemTimestamp <= nextTimestamp) break
    insertIndex = index
  }

  if (insertIndex === items.length) return [...items, nextItem]
  return [
    ...items.slice(0, insertIndex),
    nextItem,
    ...items.slice(insertIndex),
  ]
}

function readBoolean(value: unknown) {
  return value === true
}

function formatDebugTimestamp(value: number) {
  return new Date(value).toISOString()
}

function stringifyDebugValue(value: unknown, maxLength = 240) {
  if (typeof value === "string") {
    return compactText(value, maxLength)
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value)
  }

  if (value == null) return ""

  try {
    const serialized = JSON.stringify(value)
    return compactText(serialized, maxLength)
  } catch {
    return compactText(String(value), maxLength)
  }
}

function appendDebugEntry(entries: AssistantTraceDebugEntry[], label: string, value: unknown, maxLength = 240) {
  const normalized = stringifyDebugValue(value, maxLength)
  if (!normalized) return

  entries.push({
    label,
    value: normalized,
  })
}

function mergeDebugEntries(
  existing?: AssistantTraceDebugEntry[],
  next?: AssistantTraceDebugEntry[],
) {
  if ((!existing || existing.length === 0) && (!next || next.length === 0)) {
    return undefined
  }

  if (!existing || existing.length === 0) return next
  if (!next || next.length === 0) return existing

  const merged = [...existing]
  const indexByLabel = new Map(existing.map((entry, index) => [entry.label, index]))

  for (const entry of next) {
    const existingIndex = indexByLabel.get(entry.label)
    if (existingIndex === undefined) {
      indexByLabel.set(entry.label, merged.length)
      merged.push(entry)
      continue
    }

    merged[existingIndex] = entry
  }

  return merged
}

function truncateStreamRenderText(value: string, limit: number) {
  if (value.includes(STREAM_RENDER_TRUNCATION_MARKER)) {
    return {
      text: value,
      truncated: true,
    }
  }
  if (value.length <= limit) {
    return {
      text: value,
      truncated: false,
    }
  }

  return {
    text: `${value.slice(0, limit)}${STREAM_RENDER_TRUNCATION_MARKER}`,
    truncated: true,
  }
}

function appendStreamRenderText(existingText: string | undefined, delta: string, fullText: string | undefined, limit: number) {
  const currentText = existingText ?? ""
  if (!fullText && currentText.includes(STREAM_RENDER_TRUNCATION_MARKER)) {
    return {
      text: currentText,
      truncated: true,
    }
  }

  return truncateStreamRenderText(fullText ?? `${currentText}${delta}`, limit)
}

function appendTruncationDebugEntry(entries: AssistantTraceDebugEntry[] | undefined, truncated: boolean) {
  if (!truncated) return entries

  return mergeDebugEntries(entries, [
    {
      label: "stream.render.truncated",
      value: "true",
    },
  ])
}

function formatDebugTimeRange(value: unknown) {
  const range = readRecord(value)
  if (!range) return ""

  const start = typeof range.start === "number" ? formatDebugTimestamp(range.start) : ""
  const end = typeof range.end === "number" ? formatDebugTimestamp(range.end) : ""
  const compacted = typeof range.compacted === "number" ? formatDebugTimestamp(range.compacted) : ""

  if (start && end && compacted) {
    return `${start} -> ${end} (compacted ${compacted})`
  }

  if (start && end) {
    return `${start} -> ${end}`
  }

  return start || end || compacted
}

function buildPartDebugEntries(input: unknown) {
  const part = readRecord(input)
  if (!part) return undefined

  const entries: AssistantTraceDebugEntry[] = []
  const type = readString(part.type)

  appendDebugEntry(entries, "part.id", readString(part.id))
  appendDebugEntry(entries, "message.id", readString(part.messageID))

  if (type === "text" || type === "reasoning") {
    appendDebugEntry(entries, "part.time", formatDebugTimeRange(part.time))
    appendDebugEntry(entries, "part.metadata", part.metadata, 320)
  }

  if (type === "tool") {
    const state = readRecord(part.state)
    appendDebugEntry(entries, "tool.call", readString(part.callID))
    appendDebugEntry(entries, "tool.status", readString(state?.status))
    appendDebugEntry(entries, "tool.raw", state?.raw, 320)
    appendDebugEntry(entries, "tool.input", state?.input, 320)
    appendDebugEntry(entries, "tool.metadata", state?.metadata ?? part.metadata, 320)
    appendDebugEntry(entries, "tool.time", formatDebugTimeRange(state?.time))
    if (typeof part.providerExecuted === "boolean") {
      appendDebugEntry(entries, "tool.providerExecuted", part.providerExecuted)
    }
  }

  if (type === "source-url") {
    appendDebugEntry(entries, "source.id", readString(part.sourceID))
    appendDebugEntry(entries, "source.url", readString(part.url), 320)
    appendDebugEntry(entries, "source.metadata", part.providerMetadata, 320)
  }

  if (type === "source-document") {
    appendDebugEntry(entries, "source.id", readString(part.sourceID))
    appendDebugEntry(entries, "source.mediaType", readString(part.mediaType))
    appendDebugEntry(entries, "source.filename", readString(part.filename))
    appendDebugEntry(entries, "source.metadata", part.providerMetadata, 320)
  }

  if (type === "file" || type === "image") {
    appendDebugEntry(entries, "attachment.mime", readString(part.mime))
    appendDebugEntry(entries, "attachment.filename", readString(part.filename))
    appendDebugEntry(entries, "attachment.url", readString(part.url), 320)
    appendDebugEntry(entries, "attachment.width", part.width)
    appendDebugEntry(entries, "attachment.height", part.height)
  }

  if (type === "patch") {
    appendDebugEntry(entries, "patch.hash", readString(part.hash))
    appendDebugEntry(entries, "patch.scope", readString(part.scope))
    appendDebugEntry(entries, "patch.iteration", part.iteration)
    appendDebugEntry(entries, "patch.from", readString(part.fromSnapshot))
  }

  if (type === "snapshot") {
    const snapshot = readString(part.snapshot)
    appendDebugEntry(entries, "snapshot.size", snapshot ? `${snapshot.length} chars` : "")
  }

  if (type === "permission") {
    appendDebugEntry(entries, "approval.id", readString(part.approvalID))
    appendDebugEntry(entries, "tool.call", readString(part.toolCallID))
    if (typeof part.created === "number") {
      appendDebugEntry(entries, "approval.created", formatDebugTimestamp(part.created))
    }
  }

  if (type === "subtask") {
    const model = readRecord(part.model)
    appendDebugEntry(entries, "subtask.agent", readString(part.agent))
    appendDebugEntry(entries, "subtask.model", model ? `${readString(model.providerID)}/${readString(model.modelID)}` : "")
    appendDebugEntry(entries, "subtask.command", readString(part.command))
  }

  if (type === "step-start") {
    const snapshot = readString(part.snapshot)
    appendDebugEntry(entries, "snapshot.size", snapshot ? `${snapshot.length} chars` : "")
  }

  if (type === "step-finish") {
    const tokens = readRecord(part.tokens)
    const cache = readRecord(tokens?.cache)
    appendDebugEntry(entries, "step.cost", part.cost)
    appendDebugEntry(entries, "tokens.input", tokens?.input)
    appendDebugEntry(entries, "tokens.output", tokens?.output)
    appendDebugEntry(entries, "tokens.reasoning", tokens?.reasoning)
    appendDebugEntry(entries, "tokens.cache.read", cache?.read)
    appendDebugEntry(entries, "tokens.cache.write", cache?.write)
  }

  if (type === "retry") {
    const time = readRecord(part.time)
    if (typeof time?.created === "number") {
      appendDebugEntry(entries, "retry.created", formatDebugTimestamp(time.created))
    }
  }

  if (type === "agent") {
    appendDebugEntry(entries, "agent.name", readString(part.name))
  }

  if (type === "compaction") {
    appendDebugEntry(entries, "compaction.auto", Boolean(part.auto))
    appendDebugEntry(entries, "compaction.from", readString(part.compactedFromMessageID))
    appendDebugEntry(entries, "compaction.to", readString(part.compactedToMessageID))
    appendDebugEntry(entries, "compaction.version", part.summaryVersion)
  }

  return entries.length > 0 ? entries : undefined
}

function buildStreamEventDebugEntries(
  eventName: string,
  payload: Record<string, unknown> | null,
  extra?: Record<string, unknown>,
) {
  const entries: AssistantTraceDebugEntry[] = []
  appendDebugEntry(entries, "stream.event", eventName)
  appendDebugEntry(entries, "stream.eventID", readString(payload?.eventID))
  appendDebugEntry(entries, "stream.cursor", readString(payload?.cursor))

  if (typeof payload?.seq === "number") {
    appendDebugEntry(entries, "stream.seq", payload.seq)
  }

  if (typeof payload?.timestamp === "number") {
    appendDebugEntry(entries, "stream.at", formatDebugTimestamp(payload.timestamp))
  }

  for (const [label, value] of Object.entries(extra ?? {})) {
    appendDebugEntry(entries, label, value, 320)
  }

  return entries.length > 0 ? entries : undefined
}

function buildRuntimeEventDebugEntries(
  event: AgentRuntimeEvent,
  cursor?: string,
  extra?: Record<string, unknown>,
) {
  return buildStreamEventDebugEntries("runtime", {
    eventID: event.eventID,
    cursor,
    seq: event.seq,
    timestamp: event.timestamp,
  }, {
    "runtime.type": event.type,
    "session.id": event.sessionID,
    "turn.id": event.turnID,
    ...extra,
  })
}

function isVisibleAssistantTraceItem(item: AssistantTraceItem) {
  if (item.kind === "error") return true
  if (item.kind === "compaction") return true
  if (item.visibilityKey === "debugMetadata" || item.section === "debug") return false
  return item.kind !== "system" || Boolean(item.section)
}

function formatTokenCount(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? String(value) : ""
}

function buildUsageSummary(value: unknown) {
  const tokens = readRecord(value)
  if (!tokens) return ""

  const cache = readRecord(tokens.cache)
  const parts = [
    formatTokenCount(tokens.input) ? `in ${formatTokenCount(tokens.input)}` : "",
    formatTokenCount(tokens.output) ? `out ${formatTokenCount(tokens.output)}` : "",
    formatTokenCount(tokens.reasoning) ? `reason ${formatTokenCount(tokens.reasoning)}` : "",
    formatTokenCount(cache?.read) ? `cache read ${formatTokenCount(cache?.read)}` : "",
    formatTokenCount(cache?.write) ? `cache write ${formatTokenCount(cache?.write)}` : "",
  ].filter(Boolean)

  return parts.length > 0 ? `Tokens: ${parts.join(", ")}` : ""
}

function buildCompletionDetail(input: {
  finishReason?: unknown
  message?: unknown
}) {
  const finishReason = readString(input.finishReason) || readString(readRecord(input.message)?.finishReason)
  const usageSummary = buildUsageSummary(readRecord(input.message)?.tokens)
  const parts = [
    finishReason ? `Finish reason: ${finishReason}` : "",
    usageSummary,
  ].filter(Boolean)

  return parts.length > 0 ? parts.join(" | ") : "Backend finished streaming this turn."
}

function buildCompletionTraceItem(input: {
  id: string
  sourceID: string
  finishReason?: unknown
  message?: unknown
  messageID?: string
  backendTurnID?: string
  status?: AssistantTraceStatus
  timestamp?: number
  debugEntries?: AssistantTraceDebugEntry[]
}) {
  return createTraceItem({
    id: input.id,
    sourceID: input.sourceID,
    kind: "system",
    label: "Workflow",
    title: input.status === "pending" ? "Approval required" : "Response complete",
    timestamp: input.timestamp,
    messageID: input.messageID,
    backendTurnID: input.backendTurnID,
    detail: input.status === "pending"
      ? "The backend paused this turn until a permission decision is made."
      : buildCompletionDetail({
          finishReason: input.finishReason,
          message: input.message,
        }),
    status: input.status ?? "completed",
    section: input.status === "pending" ? "approvals" : "workflow",
    visibilityKey: input.status === "pending" ? "approvals" : "workflow",
    debugEntries: input.debugEntries,
  })
}

function createToolTraceDetail(status: AssistantTraceStatus, state: Record<string, unknown> | null) {
  if (status === "completed") {
    return readString(state?.title) || "Tool completed."
  }

  if (status === "error") {
    return "Tool failed."
  }

  if (status === "denied") {
    return "Tool execution was denied."
  }

  if (status === "cancelled") {
    return readString(state?.title) || "Tool call was cancelled."
  }

  if (status === "waiting-approval") {
    return "Waiting for permission approval before the tool can continue."
  }

  return readString(state?.title) || "Preparing tool call."
}

function createToolTraceInputText(status: AssistantTraceStatus, state: Record<string, unknown> | null) {
  if (status === "completed" || status === "error" || status === "denied" || status === "cancelled") {
    return describeOptionalStructuredValue(state?.input, {
      pretty: true,
    })
  }

  if (status === "waiting-approval" || status === "running" || status === "pending") {
    return readString(state?.raw) || describeOptionalStructuredValue(state?.input, {
      pretty: true,
    })
  }

  return undefined
}

function createToolTraceOutputText(status: AssistantTraceStatus, state: Record<string, unknown> | null) {
  if (status === "completed") {
    return describeStructuredValue(state?.output ?? state?.modelOutput, "Tool completed.", {
      pretty: true,
    })
  }

  if (status === "error") {
    return readString(state?.error) || "Tool failed."
  }

  if (status === "denied") {
    return readString(state?.reason) || "Tool execution was denied."
  }

  if (status === "cancelled") {
    return readString(state?.reason) || readString(state?.title) || "Tool call was cancelled."
  }

  return undefined
}

function readAskUserQuestionPrompt(value: unknown): AssistantQuestionPrompt | null {
  const metadata = readRecord(value)
  if (!metadata || readString(metadata.kind) !== "ask-user-question") return null

  const question = readString(metadata.question)
  if (!question) return null

  const options = Array.isArray(metadata.options)
    ? metadata.options
        .map((option) => readRecord(option))
        .filter((option): option is Record<string, unknown> => Boolean(option))
        .map((option) => {
          const label = readString(option.label)
          const value = readString(option.value) || label
          const description = readString(option.description) || undefined
          if (!label || !value) return null
          return {
            label,
            value,
            description,
          }
        })
        .filter((option): option is NonNullable<typeof option> => Boolean(option))
    : []

  return {
    questionID: readString(metadata.questionID) || undefined,
    header: readString(metadata.header) || undefined,
    question,
    options,
    allowFreeform: readBoolean(metadata.allowFreeform),
    placeholder: readString(metadata.placeholder) || undefined,
    multiple: readBoolean(metadata.multiple),
    required: metadata.required !== false,
    answered: readBoolean(metadata.answered),
    answerText: readString(metadata.answerText) || undefined,
    selectedOptions: Array.isArray(metadata.selectedOptions)
      ? metadata.selectedOptions
          .map((value) => readString(value).trim())
          .filter(Boolean)
      : undefined,
    freeformText: readString(metadata.freeformText) || undefined,
    answeredAt: readNumber(metadata.answeredAt) || undefined,
  }
}

function createAskUserQuestionTraceDetail(prompt: AssistantQuestionPrompt) {
  if (prompt.multiple) {
    return prompt.allowFreeform
      ? "Select one or more options, or reply in the composer to continue."
      : "Reply in the composer with one or more selections to continue."
  }

  if (prompt.options.length > 0 && prompt.allowFreeform) {
    return "Choose an option or reply in the composer to continue."
  }

  if (prompt.options.length > 0) {
    return "Choose an option to continue."
  }

  return "Reply in the composer to continue."
}

function readTaskSummary(value: unknown): SessionTaskSummary | null {
  const task = readRecord(value)
  const id = readString(task?.id)
  const sessionID = readString(task?.sessionID)
  const subject = readString(task?.subject)
  const description = readString(task?.description)
  const activeForm = readString(task?.activeForm)
  const owner = readString(task?.owner)
  const status = readString(task?.status)

  if (!id || !sessionID || !subject || !description || !activeForm || !owner) return null
  if (status !== "pending" && status !== "in_progress" && status !== "completed") return null

  return {
    id,
    sessionID,
    subject,
    description,
    activeForm,
    owner,
    status,
    sortIndex: readNumber(task?.sortIndex),
    blocks: Array.isArray(task?.blocks) ? task.blocks.map(readString).filter(Boolean) : [],
    blockedBy: Array.isArray(task?.blockedBy) ? task.blockedBy.map(readString).filter(Boolean) : [],
    metadata: readRecord(task?.metadata) ?? {},
    createdAt: readNumber(task?.createdAt),
    updatedAt: readNumber(task?.updatedAt),
    startedAt: typeof task?.startedAt === "number" ? task.startedAt : undefined,
    completedAt: typeof task?.completedAt === "number" ? task.completedAt : undefined,
    sourceAssistantMessageID: readString(task?.sourceAssistantMessageID) || undefined,
    sourceUserMessageID: readString(task?.sourceUserMessageID) || undefined,
    toolCallID: readString(task?.toolCallID) || undefined,
    isBlocked: readBoolean(task?.isBlocked),
    blockingTasks: [],
    blockedTasks: [],
  }
}

function readTaskState(value: unknown) {
  const rawState = readRecord(value)
  const rawTasks = Array.isArray(rawState?.tasks) ? rawState.tasks : []
  const tasks = rawTasks
    .map(readTaskSummary)
    .filter((task): task is SessionTaskSummary => Boolean(task))

  if (tasks.length === 0) return null

  return {
    tasks,
    completed: tasks.filter((task) => task.status === "completed").length,
    active: tasks.find((task) => task.status === "in_progress"),
  }
}

function createTaskStateTraceItem(input: {
  sourceID: string
  taskState: NonNullable<ReturnType<typeof readTaskState>>
  messageID?: string
  backendTurnID?: string
  timestamp?: number
  debugEntries?: AssistantTraceDebugEntry[]
}) {
  const status: AssistantTraceStatus =
    input.taskState.completed === input.taskState.tasks.length
      ? "completed"
      : input.taskState.active
        ? "running"
        : "pending"

  return createTraceItem({
    id: input.sourceID,
    sourceID: input.sourceID,
    kind: "task-state",
    label: "Tasks",
    title: `${input.taskState.completed}/${input.taskState.tasks.length} tasks`,
    timestamp: input.timestamp,
    messageID: input.messageID,
    backendTurnID: input.backendTurnID,
    detail: input.taskState.active?.activeForm,
    status,
    section: "workflow",
    visibilityKey: "workflow",
    progressItems: input.taskState.tasks.map((task) => ({
      id: task.id,
      step: `${task.subject} (${task.owner})`,
      status: task.status,
    })),
    debugEntries: input.debugEntries,
  })
}

function buildToolAttachmentTraceItems(
  sourceID: string,
  state: Record<string, unknown> | null,
  debugEntries?: AssistantTraceDebugEntry[],
) {
  const attachments = Array.isArray(state?.attachments) ? state.attachments : []

  return attachments
    .map((attachment) => readRecord(attachment))
    .filter((attachment): attachment is Record<string, unknown> => Boolean(attachment))
    .map((attachment, index) => {
      const mime = readString(attachment.mime)
      const kind = mime.startsWith("image/") ? "image" : "file"
      const metadata = readRecord(attachment.metadata)
      const width = readOptionalNumber(attachment.width) ?? readOptionalNumber(metadata?.width)
      const height = readOptionalNumber(attachment.height) ?? readOptionalNumber(metadata?.height)
      const src = readString(attachment.url) || readString(attachment.src)
      const title = readString(attachment.filename) || `Tool attachment ${index + 1}`
      const dimensions = width && height ? `${width}x${height}` : ""
      const detail = [mime, dimensions].filter(Boolean).join(" | ")

      return createTraceItem({
        id: `${sourceID}:attachment:${index}`,
        sourceID: `${sourceID}:attachment:${index}`,
        kind,
        label: kind === "image" ? "Image" : "File",
        title,
        detail: detail || "Attachment returned from the tool.",
        src: kind === "image" ? src : undefined,
        mimeType: mime || undefined,
        width,
        height,
        alt: readString(attachment.alt) || readString(metadata?.alt) || readString(metadata?.prompt) || title,
        status: "completed",
        section: "file-change",
        visibilityKey: "files",
        debugEntries,
      })
    })
}

function createCompactionTraceItem(input: {
  sourceID: string
  auto?: boolean
  debugEntries?: AssistantTraceDebugEntry[]
}) {
  return createTraceItem({
    id: input.sourceID,
    sourceID: input.sourceID,
    kind: "compaction",
    label: "Context",
    title: input.auto ? "Context auto-compacted" : "Context compacted",
    status: "completed",
    section: "workflow",
    debugEntries: input.debugEntries,
  })
}

function createAssistantTurnRuntime(input: {
  phase: AssistantTurnPhase
  startedAt?: number
  updatedAt?: number
  items?: AssistantTraceItem[]
  toolName?: string
  approvalRequestID?: string
  errorMessage?: string
}): AssistantTurnRuntime {
  const startedAt = input.startedAt ?? Date.now()
  const updatedAt = input.updatedAt ?? startedAt
  const hasVisibleItems = (input.items ?? []).some(isVisibleAssistantTraceItem)

  return {
    phase: input.phase,
    startedAt,
    updatedAt,
    ...(hasVisibleItems ? { firstVisibleAt: startedAt } : {}),
    ...(input.toolName ? { toolName: input.toolName } : {}),
    ...(input.approvalRequestID ? { approvalRequestID: input.approvalRequestID } : {}),
    ...(input.errorMessage ? { errorMessage: input.errorMessage } : {}),
  }
}

function updateAssistantTurnLifecycle(
  turn: AssistantTurn,
  input: {
    phase?: AssistantTurnPhase
    state?: string
    startedAt?: number
    updatedAt?: number
    toolName?: string | null
    approvalRequestID?: string | null
    errorMessage?: string | null
  },
  items = turn.items,
): AssistantTurn {
  const updatedAt = input.updatedAt ?? Date.now()
  const startedAt = input.startedAt ?? (
    input.updatedAt !== undefined && input.updatedAt < turn.runtime.startedAt
      ? input.updatedAt
      : turn.runtime.startedAt
  )
  const nextRuntime: AssistantTurnRuntime = {
    ...turn.runtime,
    startedAt,
    ...(input.phase ? { phase: input.phase } : {}),
    updatedAt,
    ...("toolName" in input ? { toolName: input.toolName ?? undefined } : {}),
    ...("approvalRequestID" in input ? { approvalRequestID: input.approvalRequestID ?? undefined } : {}),
    ...("errorMessage" in input ? { errorMessage: input.errorMessage ?? undefined } : {}),
  }

  if (!nextRuntime.firstVisibleAt && items.some(isVisibleAssistantTraceItem)) {
    nextRuntime.firstVisibleAt = updatedAt
  }

  return {
    ...turn,
    ...(input.state ? { state: input.state } : {}),
    runtime: nextRuntime,
    items,
  }
}

function clearStreamingItems(items: AssistantTraceItem[]) {
  return items.map((item) => (item.isStreaming ? { ...item, isStreaming: false } : item))
}

function cancelInterruptedToolTraceItems(items: AssistantTraceItem[], detail: string) {
  return clearStreamingItems(items).map((item) =>
    item.kind === "tool" && !isTerminalTraceStatus(item.status)
      ? {
          ...item,
          status: "cancelled" as const,
          detail: item.detail || detail,
          isStreaming: false,
        }
      : item,
  )
}

function settleQueuedPrompt(items: AssistantTraceItem[], turnID: string, status: AssistantTraceStatus = "completed") {
  const promptSourceID = `${turnID}:prompt`
  return items.map((item) =>
    item.sourceID === promptSourceID && item.status === "pending"
      ? {
          ...item,
          status,
        }
      : item,
  )
}

function isApplyPatchToolName(value?: string) {
  return value === "apply_patch" || value === "apply-patch"
}

function settleDraftPatchPreview(
  draftPatch: AssistantTraceDraftPatchPreview | undefined,
  status: AssistantTraceStatus | undefined,
) {
  if (!draftPatch || !status || !isTerminalTraceStatus(status)) return draftPatch
  const fileChanges = Array.isArray(draftPatch.fileChanges) ? draftPatch.fileChanges : []

  return {
    ...draftPatch,
    status,
    detail: status === "completed"
      ? "Patch tool completed. Waiting for workspace diff confirmation."
      : draftPatch.detail,
    isStreaming: false,
    fileChanges: fileChanges.map((change) => ({
      ...change,
      previewState: status === "completed" && change.previewState === "streaming"
        ? "complete" as const
        : change.previewState,
    })),
  }
}

function settleDraftPatchPreviews(items: AssistantTraceItem[], status: AssistantTraceStatus) {
  return items.map((item) =>
    item.draftPatch
      ? {
          ...item,
          draftPatch: settleDraftPatchPreview(item.draftPatch, status),
        }
      : item,
  )
}

function appendTraceItem(items: AssistantTraceItem[], nextItem: AssistantTraceItem) {
  return insertTraceItemByTimestamp(items, nextItem)
}

function upsertTraceItems(items: AssistantTraceItem[], nextItems: AssistantTraceItem[]) {
  return nextItems.reduce((result, nextItem) => upsertTraceItem(result, nextItem), items)
}

function mergeTraceItem(existing: AssistantTraceItem, nextItem: AssistantTraceItem): AssistantTraceItem {
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
      debugEntries: mergeDebugEntries(existing.debugEntries, nextItem.debugEntries),
    }
  }

  const merged = {
    ...existing,
    ...nextItem,
    id: existing.id,
    messageID: nextItem.messageID ?? existing.messageID,
    backendTurnID: nextItem.backendTurnID ?? existing.backendTurnID,
    timestamp: mergeTraceTimestamp(existing.timestamp, nextItem.timestamp),
    debugEntries: mergeDebugEntries(existing.debugEntries, nextItem.debugEntries),
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
    const draftPatch = settleDraftPatchPreview(nextItem.draftPatch ?? existing.draftPatch, nextItem.status ?? existing.status)
    return {
      ...merged,
      text: nextItem.text ?? existing.text,
      toolInputText: nextItem.toolInputText ?? existing.toolInputText,
      toolOutputText: nextItem.toolOutputText ?? existing.toolOutputText,
      ...(draftPatch ? { draftPatch } : {}),
    }
  }

  return merged
}

function traceItemsShareToolCallIdentity(left: AssistantTraceItem, right: AssistantTraceItem) {
  return left.kind === "tool" &&
    right.kind === "tool" &&
    Boolean(left.toolCallID && right.toolCallID && left.toolCallID === right.toolCallID)
}

function upsertTraceItem(items: AssistantTraceItem[], nextItem: AssistantTraceItem) {
  const matchingIndices = items.reduce<number[]>((result, item, index) => {
    if (
      (nextItem.sourceID && item.sourceID ? item.sourceID === nextItem.sourceID : item.id === nextItem.id) ||
      traceItemsShareToolCallIdentity(item, nextItem)
    ) {
      result.push(index)
    }

    return result
  }, [])

  if (matchingIndices.length === 0) {
    return appendTraceItem(items, nextItem)
  }

  const firstIndex = matchingIndices[0]
  const existing = items[firstIndex]
  const merged = mergeTraceItem(existing, nextItem)

  const duplicateIndices = new Set(matchingIndices.slice(1))

  return items.flatMap((item, index) => {
    if (index === firstIndex) return [merged]
    if (duplicateIndices.has(index)) return []
    return [item]
  })
}

function appendTraceDelta(
  items: AssistantTraceItem[],
  input: {
    kind: "reasoning" | "text"
    delta: string
    fullText?: string
    sourceID?: string
    messageID?: string
    backendTurnID?: string
    timestamp?: number
    debugEntries?: AssistantTraceDebugEntry[]
  },
) {
  const nextItems = clearStreamingItems(items)
  const existingIndex = input.sourceID
    ? nextItems.findIndex((item) => item.kind === input.kind && item.sourceID === input.sourceID)
    : nextItems.length > 0 &&
        nextItems[nextItems.length - 1]?.kind === input.kind &&
        nextItems[nextItems.length - 1]?.sourceID === undefined
      ? nextItems.length - 1
      : -1

  if (existingIndex !== -1) {
    const existing = nextItems[existingIndex]
    const nextText = appendStreamRenderText(existing?.text, input.delta, input.fullText, STREAM_TEXT_RENDER_LIMIT)
    const debugEntries = appendTruncationDebugEntry(
      mergeDebugEntries(existing?.debugEntries, input.debugEntries),
      nextText.truncated,
    )

    return nextItems.map((item, index) =>
      index === existingIndex
        ? {
            ...existing,
            text: nextText.text,
            messageID: existing?.messageID ?? input.messageID,
            backendTurnID: existing?.backendTurnID ?? input.backendTurnID,
            isStreaming: true,
            debugEntries,
          }
        : item,
    )
  }

  const nextText = appendStreamRenderText(undefined, input.delta, input.fullText, STREAM_TEXT_RENDER_LIMIT)

  return appendTraceItem(
    nextItems,
    createTraceItem({
      kind: input.kind,
      label: input.kind === "reasoning" ? "Reasoning" : "Response",
      text: nextText.text,
      sourceID: input.sourceID,
      messageID: input.messageID,
      backendTurnID: input.backendTurnID,
      timestamp: input.timestamp,
      isStreaming: true,
      debugEntries: appendTruncationDebugEntry(input.debugEntries, nextText.truncated),
    }),
  )
}

function appendToolInputDelta(
  items: AssistantTraceItem[],
  input: {
    delta: string
    sourceID: string
    messageID?: string
    backendTurnID?: string
    toolCallID?: string
    toolName?: string
    status?: AssistantTraceStatus
    detail?: string
    timestamp?: number
    debugEntries?: AssistantTraceDebugEntry[]
  },
) {
  const nextItems = clearStreamingItems(items)
  const existing = nextItems.find((item) =>
    item.kind === "tool" &&
    (
      item.sourceID === input.sourceID ||
      (input.toolCallID ? item.toolCallID === input.toolCallID : false)
    )
  )
  const nextToolInput = appendStreamRenderText(
    existing?.toolInputText,
    input.delta,
    undefined,
    STREAM_TOOL_INPUT_RENDER_LIMIT,
  )
  const nextToolInputText = nextToolInput.text
  const status = input.status ?? (existing?.kind === "tool" && existing.status && !isTerminalTraceStatus(existing.status)
    ? existing.status
    : "pending")
  const isApplyPatchTool = isApplyPatchToolName(input.toolName || existing?.title)
  const parsedDraftPatch = isApplyPatchTool && input.toolCallID
    ? toDraftPatchPreview({
        rawToolInput: nextToolInputText,
        status,
      })
    : null
  const draftPatch = parsedDraftPatch ?? existing?.draftPatch
  const nextItem = createTraceItem({
    id: existing?.id ?? input.sourceID,
    sourceID: existing?.sourceID ?? input.sourceID,
    kind: "tool",
    label: "Tool",
    title: input.toolName || existing?.title || "Tool",
    text: existing?.toolOutputText ?? nextToolInputText,
    detail: input.detail || existing?.detail || "Preparing tool call.",
    timestamp: existing?.timestamp ?? input.timestamp,
    toolInputText: nextToolInputText,
    toolOutputText: existing?.toolOutputText,
    status,
    messageID: input.messageID || existing?.messageID,
    backendTurnID: input.backendTurnID || existing?.backendTurnID,
    partID: existing?.partID ?? input.sourceID,
    toolCallID: input.toolCallID || existing?.toolCallID,
    ...(draftPatch ? { draftPatch: settleDraftPatchPreview(draftPatch, status) } : {}),
    section: "tools",
    visibilityKey: "toolCalls",
    isStreaming: status === "running" || status === "pending",
    debugEntries: appendTruncationDebugEntry(input.debugEntries, nextToolInput.truncated),
  })

  return upsertTraceItem(nextItems, nextItem)
}

function buildTraceItemFromPart(
  input: unknown,
  options?: {
    debugEntries?: AssistantTraceDebugEntry[]
    messageID?: string
    backendTurnID?: string
  },
): AssistantTraceItem[] {
  const part = readRecord(input)
  if (!part) return []

  const sourceID = readString(part.id) || createID("trace")
  const type = readString(part.type)
  const debugEntries = mergeDebugEntries(buildPartDebugEntries(part), options?.debugEntries)
  const timestamp = readCanonicalPartTimestamp(part)
  const ownership = traceItemOwnershipFromPart(part, options)
  const createPartTraceItem = (item: Parameters<typeof createTraceItem>[0]) =>
    createTraceItem({
      ...item,
      messageID: item.messageID ?? ownership.messageID,
      backendTurnID: item.backendTurnID ?? ownership.backendTurnID,
    })

  if (type === "reasoning" || type === "text") {
    const renderedText = truncateStreamRenderText(readString(part.text), STREAM_TEXT_RENDER_LIMIT)
    return [createPartTraceItem({
      id: sourceID,
      sourceID,
      kind: type,
      label: type === "reasoning" ? "Reasoning" : "Response",
      text: renderedText.text,
      timestamp: timestamp ?? undefined,
      section: type === "reasoning" ? "reasoning" : "response",
      visibilityKey: type === "reasoning" ? "reasoning" : "response",
      isStreaming: false,
      debugEntries: appendTruncationDebugEntry(debugEntries, renderedText.truncated),
    })]
  }

  if (type === "tool") {
    const state = readRecord(part.state)
    const rawStatus = readString(state?.status)
    const status: AssistantTraceStatus =
      rawStatus === "completed"
        ? "completed"
        : rawStatus === "error"
          ? "error"
          : rawStatus === "pending"
            ? "pending"
            : rawStatus === "waiting-approval"
              ? "waiting-approval"
              : rawStatus === "denied"
                ? "denied"
                : rawStatus === "cancelled" || rawStatus === "canceled"
                  ? "cancelled"
                  : "running"
    const toolName = readString(part.tool) || "Tool"
    const messageID = ownership.messageID
    const toolCallID = readString(part.callID)
    const rawToolInputText = createToolTraceInputText(status, state)
    const rawToolOutputText = createToolTraceOutputText(status, state)
    const toolInput = rawToolInputText
      ? truncateStreamRenderText(rawToolInputText, STREAM_TOOL_INPUT_RENDER_LIMIT)
      : null
    const toolOutput = rawToolOutputText
      ? truncateStreamRenderText(rawToolOutputText, STREAM_TEXT_RENDER_LIMIT)
      : null
    const toolInputText = toolInput?.text
    const toolOutputText = toolOutput?.text
    const toolDebugEntries = appendTruncationDebugEntry(
      debugEntries,
      Boolean(toolInput?.truncated || toolOutput?.truncated),
    )
    const draftPatch = isApplyPatchToolName(toolName) && toolInputText
      ? toDraftPatchPreview({
          rawToolInput: toolInputText,
          status,
        })
      : null
    const questionPrompt = readAskUserQuestionPrompt(state?.metadata)

    if (questionPrompt && !questionPrompt.answered) {
      return [createPartTraceItem({
        id: sourceID,
        sourceID,
        kind: "question",
        label: "Question",
        title: questionPrompt.header || "Question for you",
        text: questionPrompt.question,
        detail: createAskUserQuestionTraceDetail(questionPrompt),
        status,
        section: "response",
        visibilityKey: "response",
        debugEntries: toolDebugEntries,
        questionPrompt,
      })]
    }

    return [
      createPartTraceItem({
        id: sourceID,
        sourceID,
        kind: "tool",
        label: "Tool",
        title: toolName,
        text: toolOutputText ?? toolInputText,
        detail: createToolTraceDetail(status, state),
        toolInputText,
        toolOutputText,
        status,
        messageID,
        backendTurnID: ownership.backendTurnID,
        partID: sourceID,
        toolCallID,
        timestamp: timestamp ?? undefined,
        ...(draftPatch ? { draftPatch } : {}),
        section: "tools",
        visibilityKey: "toolCalls",
        isStreaming: status === "running" || status === "pending",
        debugEntries: toolDebugEntries,
      }),
      ...applyTraceItemsOwnership(buildToolAttachmentTraceItems(sourceID, state, toolDebugEntries), ownership),
    ]
  }

  if (type === "source-url") {
    return [createPartTraceItem({
      id: sourceID,
      sourceID,
      kind: "source",
      label: "Source",
      title: readString(part.title) || "Referenced URL",
      detail: readString(part.url) || "The model cited a URL source.",
      status: "completed",
      timestamp: timestamp ?? undefined,
      section: "sources",
      visibilityKey: "sources",
      debugEntries,
    })]
  }

  if (type === "source-document") {
    const detail = [readString(part.filename), readString(part.mediaType)].filter(Boolean).join(" | ")
    return [createPartTraceItem({
      id: sourceID,
      sourceID,
      kind: "source",
      label: "Source",
      title: readString(part.title) || "Referenced document",
      detail: detail || "The model cited a document source.",
      status: "completed",
      timestamp: timestamp ?? undefined,
      section: "sources",
      visibilityKey: "sources",
      debugEntries,
    })]
  }

  if (type === "file" || type === "image") {
    const metadata = readRecord(part.metadata)
    const mime = readString(part.mime) || readString(part.mimeType)
    const width = readOptionalNumber(part.width) ?? readOptionalNumber(metadata?.width)
    const height = readOptionalNumber(part.height) ?? readOptionalNumber(metadata?.height)
    const src = readString(part.url) || readString(part.src)
    const title = readString(part.filename) || "Attachment"
    const dimensions = width && height ? `${width}x${height}` : ""
    const detail = [mime, dimensions].filter(Boolean).join(" | ")

    return [createPartTraceItem({
      id: sourceID,
      sourceID,
      kind: type,
      label: type === "image" ? "Image" : "File",
      title,
      detail: detail || describeStructuredValue(part.url, "Attachment returned from the agent."),
      src: type === "image" ? src : undefined,
      mimeType: mime || undefined,
      width,
      height,
      alt: readString(part.alt) || readString(metadata?.alt) || readString(metadata?.prompt) || title,
      status: "completed",
      timestamp: timestamp ?? undefined,
      section: "file-change",
      visibilityKey: "files",
      debugEntries,
    })]
  }

  if (type === "patch") {
    const scope = readString(part.scope)
    const files = Array.isArray(part.files) ? part.files.filter((item): item is string => typeof item === "string") : []
    const changes = Array.isArray(part.changes)
      ? part.changes
          .map((change) => readRecord(change))
          .filter((change): change is Record<string, unknown> => Boolean(change))
          .map((change) => ({
            file: readString(change.file),
            additions: readNumber(change.additions),
            deletions: readNumber(change.deletions),
            patch: readString(change.patch) || undefined,
          }))
          .filter((change) => Boolean(change.file))
      : []
    const summary = readRecord(part.summary)
    const additions = readNumber(summary?.additions) || changes.reduce((count, change) => count + change.additions, 0)
    const deletions = readNumber(summary?.deletions) || changes.reduce((count, change) => count + change.deletions, 0)
    const fileCount = readNumber(summary?.files) || changes.length || files.length
    const detail = changes.length > 0
      ? compactText(
          changes
            .map((change) => `${change.file} (+${change.additions} -${change.deletions})`)
            .join("\n"),
          240,
        )
      : files.length > 0
        ? compactText(files.join(", "), 220)
        : scope === "model-call"
          ? "Model call patch metadata received from the backend."
          : "Patch metadata received from the backend."

    return [createPartTraceItem({
      id: sourceID,
      sourceID,
      kind: "patch",
      label: scope === "model-call" ? "Model call" : "Patch",
      title: fileCount > 0
        ? `${fileCount} file change${fileCount === 1 ? "" : "s"} (+${additions} -${deletions})`
        : "Patch update",
      detail,
      fileChanges: changes,
      filePaths: changes.length > 0 ? changes.map((change) => change.file) : files,
      status: "completed",
      timestamp: timestamp ?? undefined,
      section: "file-change",
      visibilityKey: "files",
      debugEntries,
    })]
  }

  if (type === "permission") {
    const action = readString(part.action)
    const reason = readString(part.reason)
    const status: AssistantTraceStatus = action === "deny" ? "denied" : action === "ask" ? "pending" : "completed"
    const title =
      action === "deny"
        ? "Permission denied"
        : action === "allow"
          ? "Permission allowed"
          : "Permission requested"
    const detail = compactText(
      [
        readString(part.tool),
        reason || null,
      ]
        .filter(Boolean)
        .join(" · "),
      220,
    ) || "The backend recorded a permission lifecycle update."

    return [createPartTraceItem({
      id: sourceID,
      sourceID,
      kind: "system",
      label: "Permission",
      title,
      detail,
      status,
      timestamp: timestamp ?? undefined,
      section: "approvals",
      visibilityKey: "approvals",
      debugEntries,
    })]
  }

  if (type === "subtask") {
    return [createPartTraceItem({
      id: sourceID,
      sourceID,
      kind: "subtask",
      label: "Subtask",
      title: readString(part.description) || readString(part.agent) || "Delegated task",
      detail: compactText(readString(part.prompt), 220) || "The assistant delegated part of the request.",
      status: "completed",
      timestamp: timestamp ?? undefined,
      section: "workflow",
      visibilityKey: "workflow",
      debugEntries,
    })]
  }

  if (type === "step-start") {
    return [createPartTraceItem({
      id: sourceID,
      sourceID,
      kind: "step",
      label: "Step",
      title: "Model step started",
      detail: "The model started a new generation step.",
      status: "pending",
      timestamp: timestamp ?? undefined,
      section: "workflow",
      visibilityKey: "workflow",
      debugEntries,
    })]
  }

  if (type === "step-finish") {
    return [createPartTraceItem({
      id: sourceID,
      sourceID,
      kind: "step",
      label: "Step",
      title: "Model step finished",
      detail: readString(part.reason) || "The model completed one generation step.",
      status: "completed",
      timestamp: timestamp ?? undefined,
      section: "workflow",
      visibilityKey: "workflow",
      debugEntries,
    })]
  }

  if (type === "retry") {
    return [createPartTraceItem({
      id: sourceID,
      sourceID,
      kind: "retry",
      label: "Retry",
      title: "Retry scheduled",
      detail: `Attempt ${String(part.attempt ?? "?")}`,
      status: "pending",
      section: "workflow",
      visibilityKey: "workflow",
      debugEntries,
    })]
  }

  if (type === "snapshot") {
    return [createPartTraceItem({
      id: sourceID,
      sourceID,
      kind: "snapshot",
      label: "Snapshot",
      title: "Workspace snapshot",
      detail: "The backend captured a workspace snapshot during the run.",
      status: "completed",
      timestamp: timestamp ?? undefined,
      section: "workflow",
      visibilityKey: "workflow",
      debugEntries,
    })]
  }

  if (type === "agent") {
    return [createPartTraceItem({
      id: sourceID,
      sourceID,
      kind: "system",
      label: "Agent",
      title: readString(part.name) || "Agent update",
      detail: "The backend recorded the active agent for this turn.",
      status: "completed",
      section: "workflow",
      visibilityKey: "workflow",
      debugEntries,
    })]
  }

  if (type === "compaction") {
    return [
      applyTraceItemOwnership(
        createCompactionTraceItem({
          sourceID,
          auto: readBoolean(part.auto),
          debugEntries,
        }),
        ownership,
      ),
    ]
  }

  return []
}

function mergeTraceParts(items: AssistantTraceItem[], parts: unknown[], ownership?: TraceItemOwnership) {
  return parts.reduce<AssistantTraceItem[]>((result, part) => {
    const nextItems = buildTraceItemFromPart(part, ownership)
    return nextItems.length > 0 ? upsertTraceItems(result, nextItems) : result
  }, items)
}

function alignAnonymousTraceItemsWithParts(items: AssistantTraceItem[], parts: unknown[], ownership?: TraceItemOwnership) {
  const nextItems = [...items]
  const anonymousIndices = {
    reasoning: [] as number[],
    text: [] as number[],
  }

  nextItems.forEach((item, index) => {
    if ((item.kind === "reasoning" || item.kind === "text") && !item.sourceID) {
      anonymousIndices[item.kind].push(index)
    }
  })

  for (const part of parts) {
    const nextItem = buildTraceItemFromPart(part, ownership)[0]
    if (!nextItem || (nextItem.kind !== "reasoning" && nextItem.kind !== "text") || !nextItem.sourceID) {
      continue
    }

    const hasMatchedSource = nextItems.some((item) => item.sourceID === nextItem.sourceID)
    if (hasMatchedSource) continue

    const anonymousIndex = anonymousIndices[nextItem.kind].shift()
    if (anonymousIndex === undefined) continue

    const existing = nextItems[anonymousIndex]
    if (!existing) continue

    nextItems[anonymousIndex] = {
      ...existing,
      ...nextItem,
      id: existing.id,
      timestamp: existing.timestamp,
    }
  }

  return nextItems
}

function appendSystemTrace(
  items: AssistantTraceItem[],
  turnID: string,
  title: string,
  detail: string,
  status: AssistantTraceStatus = "completed",
  debugEntries?: AssistantTraceDebugEntry[],
  section: AssistantTraceSectionKey = "workflow",
  visibilityKey: AssistantTraceVisibilityKey = "workflow",
  timestamp?: number,
  ownership?: TraceItemOwnership,
) {
  const nextItems = clearStreamingItems(settleQueuedPrompt(items, turnID))
  return appendTraceItem(
    nextItems,
    createTraceItem({
      kind: "system",
      label: "System",
      title,
      detail,
      status,
      timestamp,
      messageID: ownership?.messageID,
      backendTurnID: ownership?.backendTurnID,
      section,
      visibilityKey,
      debugEntries,
    }),
  )
}

function extractTextParts(parts: unknown[]) {
  return parts
    .map((part) => readRecord(part))
    .filter((part): part is Record<string, unknown> => Boolean(part))
    .filter((part) => readString(part.type) === "text")
    .map((part) => readString(part.text))
    .filter(Boolean)
}

function extractAttachmentNames(parts: unknown[]) {
  return parts
    .map((part) => readRecord(part))
    .filter((part): part is Record<string, unknown> => Boolean(part))
    .filter((part) => {
      const type = readString(part.type)
      return type === "file" || type === "image"
    })
    .map((part) => readString(part.filename) || "Attachment")
}

function extractQuestionAnswer(parts: unknown[]) {
  for (const input of parts) {
    const part = readRecord(input)
    if (!part || readString(part.type) !== "text") continue

    const metadata = readRecord(part.metadata)
    if (!metadata || readString(metadata.kind) !== "question-answer") continue

    const questionID = readString(metadata.questionID)
    if (!questionID) continue

    const selectedOptions = Array.isArray(metadata.selectedOptions)
      ? metadata.selectedOptions
          .map((value) => readString(value).trim())
          .filter(Boolean)
      : []
    const freeformText = readString(metadata.freeformText).trim()

    return {
      questionID,
      ...(selectedOptions.length > 0 ? { selectedOptions } : {}),
      ...(freeformText ? { freeformText } : {}),
    }
  }

  return undefined
}

function summarizeAttachmentNames(attachmentNames: string[]) {
  if (attachmentNames.length === 0) return ""
  if (attachmentNames.length === 1) return attachmentNames[0] ?? "Attachment"
  return compactText(attachmentNames.join(", "), 140)
}

function summarizeReferenceLabels(referenceLabels: string[]) {
  if (referenceLabels.length === 0) return ""
  if (referenceLabels.length === 1) return referenceLabels[0] ?? "Reference"
  return compactText(referenceLabels.join(", "), 140)
}

function buildHistoryFileReferenceLabel(filePath: string) {
  const normalizedPath = filePath.trim().replace(/\\/g, "/")
  if (!normalizedPath) return "Reference"
  if (!/^(?:[a-z]:\/|\/)/i.test(normalizedPath)) return normalizedPath

  const segments = normalizedPath.split("/").filter(Boolean)
  if (segments.length >= 2) {
    return `${segments[segments.length - 2]}/${segments[segments.length - 1]}`
  }

  return segments[segments.length - 1] ?? filePath
}

function extractReferencedFilePathsFromText(text: string) {
  if (!text.includes("Referenced files:")) {
    return {
      displayText: text.trim(),
      references: [] as UserTurnReference[],
    }
  }

  const lines = text.split("\n")
  const keptLines: string[] = []
  const filePaths: string[] = []

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim() ?? ""
    if (line !== "Referenced files:") {
      keptLines.push(lines[index] ?? "")
      continue
    }

    const sectionPaths: string[] = []
    let cursor = index + 1
    while (cursor < lines.length) {
      const itemLine = lines[cursor] ?? ""
      if (!itemLine.startsWith("- ")) break
      const filePath = itemLine.slice(2).trim()
      if (filePath) {
        sectionPaths.push(filePath)
      }
      cursor += 1
    }

    if (sectionPaths.length === 0) {
      keptLines.push(lines[index] ?? "")
      continue
    }

    filePaths.push(...sectionPaths)
    index = cursor - 1
  }

  const displayText = keptLines.join("\n").replace(/\n{3,}/g, "\n\n").trim()
  const references = [...new Set(filePaths)].map((filePath) => ({
    id: `file:${filePath}`,
    kind: "file" as const,
    label: buildHistoryFileReferenceLabel(filePath),
    title: filePath,
  }))

  return {
    displayText,
    references,
  }
}

export function buildUserTurnText(input: {
  text?: string
  attachmentNames?: string[]
  referenceLabels?: string[]
}) {
  const text = readString(input.text).trim()
  const attachmentNames = (input.attachmentNames ?? []).filter(Boolean)
  const referenceLabels = (input.referenceLabels ?? []).filter(Boolean)

  if (attachmentNames.length === 0 && referenceLabels.length === 0) {
    return text || "Sent a non-text message."
  }

  const attachmentSummary = summarizeAttachmentNames(attachmentNames)
  const referenceSummary = summarizeReferenceLabels(referenceLabels)
  if (!text && referenceLabels.length > 0 && attachmentNames.length === 0) {
    return referenceLabels.length === 1
      ? `Sent reference: ${referenceSummary}`
      : `Sent ${referenceLabels.length} references: ${referenceSummary}`
  }

  if (!text && attachmentNames.length > 0 && referenceLabels.length === 0) {
    return attachmentNames.length === 1
      ? `Sent attachment: ${attachmentSummary}`
      : `Sent ${attachmentNames.length} attachments: ${attachmentSummary}`
  }

  if (!text) {
    return [
      referenceLabels.length === 1 ? `Reference: ${referenceSummary}` : `References: ${referenceSummary}`,
      attachmentNames.length === 1 ? `Attachment: ${attachmentSummary}` : `Attachments: ${attachmentSummary}`,
    ].join("\n")
  }

  const sections = [text]
  if (referenceLabels.length > 0) {
    sections.push(`References: ${referenceSummary}`)
  }
  if (attachmentNames.length > 0) {
    sections.push(`Attachments: ${attachmentSummary}`)
  }

  return sections.join("\n\n")
}

export function buildUserTurn(input: {
  attachments?: UserTurnAttachment[]
  diffSummary?: SessionDiffSummary
  displayText?: string
  fallbackText?: string
  id?: string
  questionAnswer?: UserTurn["questionAnswer"]
  references?: UserTurnReference[]
  submissionMode?: UserTurn["submissionMode"]
  streamInsertion?: UserTurn["streamInsertion"]
  timestamp?: number
}) {
  const displayText = readString(input.displayText).trim()
  const fallbackText = readString(input.fallbackText).trim()
  const attachments = (input.attachments ?? []).filter((attachment) => attachment.name.trim().length > 0)
  const references = (input.references ?? []).filter((reference) => reference.label.trim().length > 0)
  const text = buildUserTurnText({
    text: displayText || fallbackText,
    attachmentNames: attachments.map((attachment) => attachment.name),
    referenceLabels: references.map((reference) => reference.label),
  })

  return {
    id: input.id ?? createID("user"),
    kind: "user",
    text,
    ...(displayText ? { displayText } : {}),
    ...(attachments.length > 0 ? { attachments } : {}),
    ...(references.length > 0 ? { references } : {}),
    ...(input.questionAnswer ? { questionAnswer: input.questionAnswer } : {}),
    ...(input.diffSummary?.diffs.length ? { diffSummary: input.diffSummary } : {}),
    ...(input.submissionMode ? { submissionMode: input.submissionMode } : {}),
    ...(input.streamInsertion ? { streamInsertion: input.streamInsertion } : {}),
    timestamp: input.timestamp ?? Date.now(),
  } satisfies UserTurn
}

type HistoryErrorPresentation = {
  name?: string
  message: string
  code?: string
  statusCode?: number
  retryable?: boolean
}

function readHistoryErrorPresentation(value: unknown): HistoryErrorPresentation | null {
  const record = readRecord(value)
  const message = readString(record?.message).trim()
  if (!record || !message) return null

  return {
    name: readString(record.name).trim() || undefined,
    message,
    code: readString(record.code).trim() || undefined,
    statusCode: readOptionalNumber(record.statusCode),
    retryable: typeof record.retryable === "boolean" ? record.retryable : undefined,
  }
}

function readAssistantNamedErrorPresentation(value: unknown): HistoryErrorPresentation | null {
  const record = readRecord(value)
  if (!record) return null

  const data = readRecord(record.data)
  const metadata = readRecord(data?.metadata)
  const message = (readString(record.message) || readString(data?.message)).trim()
  if (!message) return null

  return {
    name: readString(metadata?.sourceName).trim() || readString(record.name).trim() || undefined,
    message,
    code: readString(metadata?.code).trim() || undefined,
    statusCode: readOptionalNumber(data?.statusCode),
    retryable: typeof data?.isRetryable === "boolean" ? data.isRetryable : undefined,
  }
}

function isCancellationNamedError(value: unknown) {
  const record = readRecord(value)
  if (!record) return false

  const data = readRecord(record.data)
  const name = readString(record.name).toLowerCase()
  const message = (readString(record.message) || readString(data?.message)).toLowerCase()

  return (
    name === "messageabortederror" ||
    name === "aborterror" ||
    message === "prompt aborted" ||
    message === "the model stream was aborted." ||
    message === "prompt cancellation requested."
  )
}

function readAssistantHistoryFailure(message: LoadedSessionHistoryMessage): HistoryErrorPresentation | null {
  if (isAssistantHistoryCancelled(message)) return null

  if (message.turn?.status === "failed") {
    const turnError = readHistoryErrorPresentation(message.turn.errorInfo)
    if (turnError) return turnError

    const turnErrorMessage = readString(message.turn.error).trim()
    if (turnErrorMessage) return { message: turnErrorMessage }
  }

  return readAssistantNamedErrorPresentation(message.info.error)
}

function formatErrorTraceTitle(baseTitle: string, error: HistoryErrorPresentation | null) {
  return error?.name ? `${baseTitle}: ${error.name}` : baseTitle
}

function isToolArgumentValidationFailure(error: HistoryErrorPresentation | null) {
  return readString(error?.message).toLowerCase().includes("tool argument validation failed")
}

function assistantFailureBaseTitle(error: HistoryErrorPresentation | null) {
  return isToolArgumentValidationFailure(error) ? "Tool argument validation failed" : "Backend request failed"
}

function isAssistantHistoryFailed(message: LoadedSessionHistoryMessage) {
  return Boolean(readAssistantHistoryFailure(message))
}

function hasAssistantHistoryCompletionMarker(items: AssistantTraceItem[]) {
  return items.some(
    (item) =>
      item.kind === "system" &&
      item.title === "Response complete" &&
      item.status === "completed" &&
      Boolean(item.sourceID?.endsWith(":complete")),
  )
}

function resolveSettledAssistantHistoryPhase(
  items: AssistantTraceItem[],
  message: LoadedSessionHistoryMessage,
): AssistantTurnPhase | null {
  const turnStatus = readString(message.turn?.status).toLowerCase()
  const infoStatus = readString(message.info.status).toLowerCase()

  if (turnStatus === "running") return null
  if (turnStatus === "blocked" || infoStatus === "blocked") return "blocked"
  if (turnStatus === "continued_by_user" || infoStatus === "continued_by_user") return "continued_by_user"
  if (
    turnStatus === "completed" ||
    infoStatus === "completed" ||
    readNumber(message.info.completed) > 0 ||
    hasAssistantHistoryCompletionMarker(items)
  ) {
    return "completed"
  }

  return null
}

function resolveRunningAssistantHistoryPhase(
  items: AssistantTraceItem[],
  message: LoadedSessionHistoryMessage,
): AssistantTurnPhase | null {
  const turnStatus = readString(message.turn?.status).toLowerCase()
  if (turnStatus !== "running") return null

  const turnPhase = readString(message.turn?.phase).toLowerCase()
  switch (turnPhase) {
    case "preparing":
    case "waiting_llm":
    case "reasoning":
    case "waiting_approval":
    case "responding":
      return turnPhase
    case "executing_tool":
      return "tool_running"
  }

  if (items.some((item) => item.status === "running" || item.status === "pending")) return "tool_running"
  if (items.some((item) => item.kind === "text")) return "responding"
  if (items.some((item) => item.kind === "reasoning")) return "reasoning"
  return "waiting_llm"
}

function assistantHistoryStateForRunningPhase(phase: AssistantTurnPhase | null) {
  if (phase === "preparing") return "Preparing agent stream"
  if (phase === "waiting_llm") return "Waiting for model stream"
  if (phase === "reasoning") return "Agent is reasoning"
  if (phase === "tool_running") return "Running tools"
  if (phase === "waiting_approval") return "Waiting for permission approval"
  if (phase === "responding") return "Streaming response"
  return null
}

function assistantHistoryStateForSettledPhase(phase: AssistantTurnPhase | null) {
  if (phase === "blocked") return "Backend response blocked"
  if (phase === "continued_by_user") return "Continued by user input"
  if (phase === "completed") return "Backend response received"
  return null
}

function resolveAssistantHistoryState(items: AssistantTraceItem[], message: LoadedSessionHistoryMessage) {
  if (isAssistantHistoryCancelled(message) || items.some((item) => item.status === "cancelled")) return "Backend stream cancelled"
  const failure = readAssistantHistoryFailure(message)
  if (failure) return assistantFailureBaseTitle(failure)
  if (items.some((item) => item.kind === "question")) return "Waiting for your answer"
  if (items.some((item) => item.status === "waiting-approval")) return "Waiting for permission approval"
  if (items.some((item) => item.status === "denied")) return "Tool execution denied"
  const runningState = assistantHistoryStateForRunningPhase(resolveRunningAssistantHistoryPhase(items, message))
  if (runningState) return runningState
  const settledState = assistantHistoryStateForSettledPhase(resolveSettledAssistantHistoryPhase(items, message))
  if (settledState) return settledState
  if (items.some((item) => item.status === "running" || item.status === "pending")) return "Backend response in progress"
  if (items.some((item) => item.kind === "text")) return "Backend response received"
  if (items.some((item) => item.kind === "tool")) return "Tool history restored"
  return "Session history restored"
}

function resolveAssistantHistoryPhase(items: AssistantTraceItem[], message: LoadedSessionHistoryMessage): AssistantTurnPhase {
  if (isAssistantHistoryCancelled(message) || items.some((item) => item.status === "cancelled")) return "cancelled"
  if (isAssistantHistoryFailed(message)) return "failed"
  if (items.some((item) => item.kind === "question")) return "blocked"
  if (items.some((item) => item.status === "waiting-approval")) return "waiting_approval"
  const runningPhase = resolveRunningAssistantHistoryPhase(items, message)
  if (runningPhase) return runningPhase
  const settledPhase = resolveSettledAssistantHistoryPhase(items, message)
  if (settledPhase) return settledPhase
  if (items.some((item) => item.status === "running" || item.status === "pending")) return "tool_running"
  if (items.some((item) => item.kind === "text")) return "completed"
  return "completed"
}

function isStreamingAssistantHistoryPhase(phase: AssistantTurnPhase) {
  return phase !== "completed" &&
    phase !== "cancelled" &&
    phase !== "failed" &&
    phase !== "blocked" &&
    phase !== "continued_by_user"
}

function resolveAssistantHistoryToolName(items: AssistantTraceItem[]) {
  return items.find((item) => item.kind === "tool" && (item.status === "running" || item.status === "pending" || item.status === "waiting-approval"))
    ?.title
}

function isAssistantHistoryCancelled(message: LoadedSessionHistoryMessage) {
  const info = message.info
  const finishReason = readString(info.finishReason).toLowerCase()
  const status = readString(info.status).toLowerCase()
  const reason = readString(info.reason).toLowerCase()
  const turnStatus = readString(message.turn?.status).toLowerCase()
  const turnPhase = readString(message.turn?.phase).toLowerCase()

  return (
    finishReason === "cancelled" ||
    finishReason === "canceled" ||
    status === "cancelled" ||
    status === "canceled" ||
    reason === "cancelled" ||
    reason === "canceled" ||
    turnStatus === "cancelled" ||
    turnStatus === "canceled" ||
    turnPhase === "cancelled" ||
    turnPhase === "canceled" ||
    isCancellationNamedError(info.error)
  )
}

function buildUserTurnFromHistory(message: LoadedSessionHistoryMessage) {
  const textParts = extractTextParts(message.parts)
  const attachmentNames = extractAttachmentNames(message.parts)
  const attachments = attachmentNames.map((name) => ({ name }))
  const questionAnswer = extractQuestionAnswer(message.parts)
  const persistedDisplayText = readString(message.info.displayText).trim()
  const presentation = extractReferencedFilePathsFromText(
    persistedDisplayText || textParts.join("\n\n").trim(),
  )

  return buildUserTurn({
    id: message.info.id || createID("user"),
    attachments,
    diffSummary: readSessionDiffSummary(message.info.diffSummary),
    displayText: presentation.displayText,
    questionAnswer,
    references: presentation.references,
    timestamp: readNumber(message.info.created) || Date.now(),
  }) satisfies Turn
}

function buildAssistantTurnFromHistory(message: LoadedSessionHistoryMessage) {
  const ownership = traceItemOwnershipFromHistoryMessage(message)
  let items = mergeTraceParts([], message.parts, ownership)
  const failure = readAssistantHistoryFailure(message)
  const errorMessage = failure?.message ?? ""
  const isCancelled = isAssistantHistoryCancelled(message)
  const isBackendTurnRunning = readString(message.turn?.status).toLowerCase() === "running"

  if (errorMessage) {
    items = appendTraceItem(
      items,
      createTraceItem({
        kind: "error",
        label: "Error",
        title: formatErrorTraceTitle(assistantFailureBaseTitle(failure), failure),
        detail: errorMessage,
        status: "error",
        messageID: ownership.messageID,
        backendTurnID: ownership.backendTurnID,
      }),
    )
  }

  if (!errorMessage && !isCancelled && !isBackendTurnRunning && readNumber(message.info.completed) > 0) {
    items = upsertTraceItem(
      items,
      buildCompletionTraceItem({
        id: `${message.info.id}-complete`,
        sourceID: `${message.info.id}:complete`,
        finishReason: message.info.finishReason,
        message: message.info,
        messageID: ownership.messageID,
        backendTurnID: ownership.backendTurnID,
      }),
    )
  }

  if (!errorMessage && isCancelled) {
    items = upsertTraceItem(
      cancelInterruptedToolTraceItems(items, "Prompt cancellation requested."),
      createTraceItem({
        kind: "system",
        label: "System",
        title: "Turn cancelled",
        detail: "Prompt cancellation requested.",
        status: "completed",
        sourceID: `${message.info.id}:cancelled`,
        messageID: ownership.messageID,
        backendTurnID: ownership.backendTurnID,
        section: "workflow",
        visibilityKey: "workflow",
      }),
    )
  }

  if (items.length === 0) {
    items = [
      createTraceItem({
        kind: "system",
        label: "System",
        title: "No visible output",
        detail: "The backend stored this assistant turn without replayable trace items.",
        status: "completed",
        messageID: ownership.messageID,
        backendTurnID: ownership.backendTurnID,
        section: "response",
        visibilityKey: "response",
      }),
    ]
  }

  const runtimePhase = resolveAssistantHistoryPhase(items, message)
  const createdAt = readNumber(message.info.created) || Date.now()
  const completedAt = isBackendTurnRunning
    ? readNumber(message.turn?.updatedAt) || readNumber(message.info.completed) || createdAt
    : readNumber(message.info.completed) || createdAt

  return {
    id: message.info.id || createID("assistant"),
    messageID: message.info.id || undefined,
    kind: "assistant",
    timestamp: createdAt,
    diffSummary: readSessionDiffSummary(message.info.diffSummary),
    runtime: createAssistantTurnRuntime({
      phase: runtimePhase,
      startedAt: createdAt,
      updatedAt: completedAt,
      items,
      toolName: resolveAssistantHistoryToolName(items),
      errorMessage: errorMessage || undefined,
    }),
    state: resolveAssistantHistoryState(items, message),
    items,
    isStreaming: isBackendTurnRunning && isStreamingAssistantHistoryPhase(runtimePhase),
  } satisfies Turn
}

function isInternalHistoryMessage(message: LoadedSessionHistoryMessage) {
  return readBoolean(message.info.internal)
}

function isCompactionHistoryMessage(message: LoadedSessionHistoryMessage) {
  if (!isInternalHistoryMessage(message)) return false
  if (readString(message.info.agent) === "compaction") return true
  return message.parts.some((part) => readString(readRecord(part)?.type) === "compaction")
}

function buildCompactionItemsFromHistory(message: LoadedSessionHistoryMessage) {
  const compactionParts = message.parts.filter((part) => readString(readRecord(part)?.type) === "compaction")
  const ownership = traceItemOwnershipFromHistoryMessage(message)
  const items = mergeTraceParts([], compactionParts, ownership)
  if (items.length > 0) return items

  return [
    applyTraceItemOwnership(
      createCompactionTraceItem({
        sourceID: `${message.info.id || createID("trace")}:compaction`,
        auto: true,
      }),
      ownership,
    ),
  ]
}

function prependAssistantItems(turn: AssistantTurn, items: AssistantTraceItem[]) {
  if (items.length === 0) return turn
  const nextItems = upsertTraceItems(items, turn.items)
  return {
    ...turn,
    items: nextItems,
    runtime: {
      ...turn.runtime,
      firstVisibleAt: turn.runtime.firstVisibleAt ?? turn.runtime.startedAt,
    },
  }
}

function buildCompactionMarkerTurn(message: LoadedSessionHistoryMessage, items: AssistantTraceItem[]) {
  const createdAt = readNumber(message.info.created) || Date.now()
  const ownership = traceItemOwnershipFromHistoryMessage(message)
  const nextItems = items.length > 0
    ? items
    : [
        applyTraceItemOwnership(
          createCompactionTraceItem({
            sourceID: `${message.info.id || createID("trace")}:compaction`,
            auto: true,
          }),
          ownership,
        ),
      ]

  return {
    id: message.info.id || createID("assistant"),
    messageID: message.info.id || undefined,
    kind: "assistant",
    timestamp: createdAt,
    runtime: createAssistantTurnRuntime({
      phase: "completed",
      startedAt: createdAt,
      updatedAt: createdAt,
      items: nextItems,
    }),
    state: "Context compacted",
    items: nextItems,
    isStreaming: false,
  } satisfies AssistantTurn
}

export function buildTurnsFromHistory(messages: LoadedSessionHistoryMessage[]) {
  const turns: Turn[] = []
  let pendingCompactionItems: AssistantTraceItem[] = []
  const hasParentMetadata = messages.some((message) =>
    Object.prototype.hasOwnProperty.call(message.info, "parentMessageID"),
  )
  const orderedMessages = hasParentMetadata
    ? messages
    : [...messages].sort((left, right) => {
        const leftCreated = readNumber(left.info.created)
        const rightCreated = readNumber(right.info.created)
        if (leftCreated !== rightCreated) return leftCreated - rightCreated
        return left.info.id.localeCompare(right.info.id)
      })

  for (const message of orderedMessages) {
    if (isCompactionHistoryMessage(message)) {
      pendingCompactionItems = upsertTraceItems(pendingCompactionItems, buildCompactionItemsFromHistory(message))
      continue
    }

    if (isInternalHistoryMessage(message)) continue

    if (message.info.role === "user") {
      turns.push(buildUserTurnFromHistory(message))
      continue
    }

    const assistantTurn = buildAssistantTurnFromHistory(message)
    turns.push(prependAssistantItems(assistantTurn, pendingCompactionItems))
    pendingCompactionItems = []
  }

  if (pendingCompactionItems.length > 0) {
    turns.push(buildCompactionMarkerTurn(messages[messages.length - 1]!, pendingCompactionItems))
  }

  return turns
}

export function buildStreamingAssistantTurn(prompt: string): AssistantTurn {
  const compactPrompt = compactText(prompt, 72)
  const turnID = createID("assistant")
  const items = [
    createTraceItem({
      kind: "system",
      label: "Prompt",
      title: STREAM_PENDING_PREFIX.replace(":", ""),
      text: `"${compactPrompt}"`,
      detail: "Waiting for backend response.",
      status: "pending",
      sourceID: `${turnID}:prompt`,
      section: "workflow",
      visibilityKey: "workflow",
    }),
  ]

  return {
    id: turnID,
    kind: "assistant",
    timestamp: Date.now(),
    runtime: createAssistantTurnRuntime({
      phase: "waiting_first_event",
      items,
    }),
    state: "Waiting for agent stream",
    items,
    isStreaming: true,
  }
}

export function buildSessionStreamingAssistantTurn(detail = "Replaying backend session activity.") : AssistantTurn {
  const turnID = createID("assistant")
  const items = [
    createTraceItem({
      kind: "system",
      label: "System",
      title: "Reconnecting session stream",
      detail,
      status: "pending",
      sourceID: `${turnID}:prompt`,
      section: "workflow",
      visibilityKey: "workflow",
    }),
  ]

  return {
    id: turnID,
    kind: "assistant",
    timestamp: Date.now(),
    runtime: createAssistantTurnRuntime({
      phase: "waiting_first_event",
      items,
    }),
    state: "Waiting for agent stream",
    items,
    isStreaming: true,
  }
}

export function buildFailureTurn(
  message: string,
  existingTurn?: AssistantTurn,
  debugEntries?: AssistantTraceDebugEntry[],
): AssistantTurn {
  const turnID = existingTurn?.id ?? createID("assistant")
  const baseItems = clearStreamingItems(settleQueuedPrompt(existingTurn?.items ?? [], turnID, "error"))
  const updatedAt = Date.now()
  const items = appendTraceItem(
    baseItems,
    createTraceItem({
      kind: "error",
      label: "Error",
      title: "Stream request failed",
      detail: message,
      status: "error",
      debugEntries,
    }),
  )

  return {
    id: turnID,
    kind: "assistant",
    timestamp: existingTurn?.timestamp ?? updatedAt,
    runtime: existingTurn?.runtime
      ? {
          ...existingTurn.runtime,
          phase: "failed",
          updatedAt,
          firstVisibleAt: existingTurn.runtime.firstVisibleAt ?? updatedAt,
          errorMessage: message,
        }
      : createAssistantTurnRuntime({
          phase: "failed",
          startedAt: updatedAt,
          updatedAt,
          items,
          errorMessage: message,
        }),
    state: "Backend request failed",
    items,
    isStreaming: false,
  }
}

export function markAssistantTurnInterrupted(
  turn: AssistantTurn,
  detail = "Prompt cancellation requested.",
): AssistantTurn {
  const updatedAt = Date.now()
  const baseItems = cancelInterruptedToolTraceItems(
    settleQueuedPrompt(turn.items, turn.id, "cancelled"),
    detail,
  )
  const items = upsertTraceItem(
    baseItems,
    createTraceItem({
      kind: "system",
      label: "System",
      title: "Turn cancelled",
      detail,
      status: "completed",
      sourceID: `${turn.id}:cancelled`,
      section: "workflow",
      visibilityKey: "workflow",
    }),
  )

  return updateAssistantTurnLifecycle(
    {
      ...turn,
      isStreaming: false,
    },
    {
      phase: "cancelled",
      state: "Backend stream cancelled",
      updatedAt,
      toolName: null,
      approvalRequestID: null,
      errorMessage: null,
    },
    items,
  )
}

export function finalizeStreamAssistantTurn(
  turn: AssistantTurn,
  input?: {
    status?: string
    finishReason?: string
    message?: unknown
    backendTurnID?: string
    debugEntries?: AssistantTraceDebugEntry[]
    updatedAt?: number
  },
): AssistantTurn {
  const items = clearStreamingItems(settleQueuedPrompt(turn.items, turn.id))
  const waitingQuestion = items.find((item) => item.kind === "question")
  const messageTurn = applyAssistantMessageMetadata(turn, input?.message)
  const nextMessageID = messageTurn.messageID
  const ownership = normalizeTraceItemOwnership({
    messageID: nextMessageID,
    backendTurnID: input?.backendTurnID,
  })
  const lifecycleClock = input?.updatedAt === undefined ? {} : { updatedAt: input.updatedAt }

  if (turn.runtime.phase === "failed") {
    return updateAssistantTurnLifecycle(
      {
        ...messageTurn,
        messageID: nextMessageID,
        isStreaming: false,
      },
      {
        phase: "failed",
        state: turn.state,
        ...lifecycleClock,
      },
      items,
    )
  }

  if (waitingQuestion) {
    return updateAssistantTurnLifecycle(
      {
        ...messageTurn,
        messageID: nextMessageID,
        isStreaming: false,
      },
      {
        phase: "blocked",
        state: "Waiting for your answer",
        toolName: null,
        approvalRequestID: null,
        errorMessage: null,
        ...lifecycleClock,
      },
      items,
    )
  }

  const waitingTool = items.find((item) => item.kind === "tool" && item.status === "waiting-approval")
  if (waitingTool) {
    const nextItems = upsertTraceItem(
      items,
      buildCompletionTraceItem({
        id: `${turn.id}-blocked`,
        sourceID: `${turn.id}:blocked`,
        status: "pending",
        messageID: ownership.messageID,
        backendTurnID: ownership.backendTurnID,
        timestamp: input?.updatedAt,
        debugEntries: input?.debugEntries,
      }),
    )

    return updateAssistantTurnLifecycle(
      {
        ...messageTurn,
        messageID: nextMessageID,
        isStreaming: false,
      },
      {
        phase: "waiting_approval",
        state: "Waiting for permission approval",
        toolName: waitingTool?.title ?? null,
        ...lifecycleClock,
      },
      nextItems,
    )
  }

  if (input?.status === "blocked") {
    return updateAssistantTurnLifecycle(
      {
        ...messageTurn,
        messageID: nextMessageID,
        isStreaming: false,
      },
      {
        phase: "blocked",
        state: "Backend response blocked",
        toolName: null,
        approvalRequestID: null,
        errorMessage: null,
        ...lifecycleClock,
      },
      items,
    )
  }

  if (input?.status === "continued_by_user") {
    return updateAssistantTurnLifecycle(
      {
        ...messageTurn,
        messageID: nextMessageID,
        isStreaming: false,
      },
      {
        phase: "continued_by_user",
        state: "Continued by user input",
        toolName: null,
        approvalRequestID: null,
        errorMessage: null,
        ...lifecycleClock,
      },
      items,
    )
  }

  return updateAssistantTurnLifecycle(
    {
      ...messageTurn,
      messageID: nextMessageID,
      isStreaming: false,
    },
    {
      phase: "completed",
      state: "Backend response received",
      toolName: null,
      approvalRequestID: null,
      errorMessage: null,
      ...lifecycleClock,
    },
    upsertTraceItem(
      items,
      buildCompletionTraceItem({
        id: `${turn.id}-complete`,
        sourceID: `${turn.id}:complete`,
        finishReason: input?.finishReason,
        message: input?.message,
        messageID: ownership.messageID,
        backendTurnID: ownership.backendTurnID,
        timestamp: input?.updatedAt,
        debugEntries: input?.debugEntries,
      }),
    ),
  )
}

function mapRuntimePhaseToAssistantLifecycle(payload: Record<string, unknown>) {
  const phase = readString(payload.phase)
  const toolName = readString(payload.toolName) || null
  const reason = readString(payload.reason)

  switch (phase) {
    case "preparing":
      return {
        phase: "preparing" as const,
        state: reason || "Preparing agent request",
        toolName: null,
      }
    case "waiting_llm":
      return {
        phase: "waiting_llm" as const,
        state: reason || "Waiting for model stream",
        toolName: null,
      }
    case "reasoning":
      return {
        phase: "reasoning" as const,
        state: reason || "Agent is reasoning",
        toolName: null,
      }
    case "executing_tool":
      return {
        phase: "tool_running" as const,
        state: reason || "Running tools",
        toolName,
      }
    case "waiting_approval":
      return {
        phase: "waiting_approval" as const,
        state: reason || "Waiting for permission approval",
        toolName,
      }
    case "responding":
      return {
        phase: "responding" as const,
        state: reason || "Streaming response",
        toolName: null,
      }
    case "blocked":
      return {
        phase: "blocked" as const,
        state: reason || "Backend response blocked",
        toolName,
      }
    case "continued_by_user":
      return {
        phase: "continued_by_user" as const,
        state: reason || "Continued by user input",
        toolName: null,
      }
    case "completed":
      return {
        phase: "completed" as const,
        state: reason || "Backend response received",
        toolName: null,
      }
    case "cancelled":
      return {
        phase: "cancelled" as const,
        state: reason || "Backend stream cancelled",
        toolName: null,
      }
    case "failed":
      return {
        phase: "failed" as const,
        state: reason || "Backend stream failed",
        toolName: null,
      }
    default:
      return null
  }
}

function inferToolLifecycleFromTraceItem(
  turn: AssistantTurn,
  item: AssistantTraceItem,
  approvalRequestID: string | null,
) {
  if (item.kind !== "tool" || !canInferLifecycleFromTrace(turn.runtime.phase)) {
    return null
  }

  if (item.status === "waiting-approval") {
    return {
      phase: "waiting_approval" as const,
      state: "Waiting for permission approval",
      toolName: item.title ?? null,
      ...(approvalRequestID ? { approvalRequestID } : {}),
    }
  }

  if (item.status === "running" || item.status === "pending") {
    return {
      phase: "tool_running" as const,
      state: "Running tools",
      toolName: item.title ?? null,
      approvalRequestID: null,
    }
  }

  return null
}

function applyRuntimeEventToTurn(
  turn: AssistantTurn,
  item: AgentStreamEvent,
  event: AgentRuntimeEvent,
): AssistantTurn {
  const allowCancelledToolInputDelta = turn.runtime.phase === "cancelled" && event.type === "tool.input.delta"
  if (isSettledAssistantPhase(turn.runtime.phase) && !isTerminalRuntimeEventType(event.type) && !allowCancelledToolInputDelta) {
    return turn
  }

  const payload = event.payload
  const preparedItems = settleQueuedPrompt(turn.items, turn.id)
  const debugEntries = buildRuntimeEventDebugEntries(event, item.id)
  const eventTimestamp = event.timestamp > 0 ? event.timestamp : undefined
  const eventBackendTurnID = event.turnID || undefined
  const eventOwnership = (messageID?: string): TraceItemOwnership => ({
    messageID: messageID || undefined,
    backendTurnID: eventBackendTurnID,
  })
  const updateRuntimeTurnLifecycle = (
    nextTurn: AssistantTurn,
    input: Parameters<typeof updateAssistantTurnLifecycle>[1],
    items = nextTurn.items,
  ) => updateAssistantTurnLifecycle(
    nextTurn,
    eventTimestamp === undefined
      ? input
      : {
          ...input,
          startedAt: input.startedAt ?? (event.type === "turn.started" ? eventTimestamp : undefined),
          updatedAt: input.updatedAt ?? eventTimestamp,
        },
    items,
  )

  if (event.type === "turn.started") {
    return updateRuntimeTurnLifecycle(
      {
        ...turn,
        isStreaming: true,
      },
      {
        phase: "preparing",
        state: readBoolean(payload.resume) ? "Resuming agent stream" : "Agent stream connected",
      },
      appendSystemTrace(
        preparedItems,
        turn.id,
        readBoolean(payload.resume) ? "Agent stream resumed" : "Agent stream connected",
        "Renderer subscribed to canonical runtime updates.",
        "completed",
        debugEntries,
        "workflow",
        "workflow",
        eventTimestamp,
        eventOwnership(),
      ),
    )
  }

  if (event.type === "turn.state.changed") {
    const lifecycle = mapRuntimePhaseToAssistantLifecycle(payload)
    if (!lifecycle) return turn
    const runtimePhase = readString(payload.phase)
    const messageID = resolvePayloadMessageID(payload) || turn.messageID

    return updateRuntimeTurnLifecycle(
      {
        ...turn,
        messageID,
        isStreaming: !isSettledRuntimePhase(runtimePhase),
      },
      {
        phase: lifecycle.phase,
        state: lifecycle.state,
        toolName: lifecycle.toolName,
      },
      preparedItems,
    )
  }

  if (event.type === "llm.call.started") {
    if (!canInferModelWaitFromRuntimePhase(turn.runtime.phase)) return turn
    const messageID = resolvePayloadMessageID(payload) || turn.messageID

    return updateRuntimeTurnLifecycle(
      {
        ...turn,
        messageID,
        isStreaming: true,
      },
      {
        phase: "waiting_llm",
        state: "Waiting for model stream",
        toolName: null,
      },
      preparedItems,
    )
  }

  if (event.type === "text.part.started" || event.type === "text.part.delta") {
    const messageID = resolvePayloadMessageID(payload) || turn.messageID

    return updateRuntimeTurnLifecycle(
      {
        ...turn,
        messageID,
        isStreaming: true,
      },
      {
        phase: "responding",
        state: "Streaming response",
      },
      appendTraceDelta(preparedItems, {
        kind: "text",
        delta: readString(payload.delta) || readString(payload.text),
        fullText: readString(payload.text) || undefined,
        sourceID: readString(payload.partID) || undefined,
        messageID,
        backendTurnID: eventBackendTurnID,
        timestamp: eventTimestamp,
        debugEntries: buildRuntimeEventDebugEntries(event, item.id, {
          "message.id": readString(payload.messageID),
          "part.id": readString(payload.partID),
        }),
      }),
    )
  }

  if (event.type === "reasoning.part.started" || event.type === "reasoning.part.delta") {
    const messageID = resolvePayloadMessageID(payload) || turn.messageID

    return updateRuntimeTurnLifecycle(
      {
        ...turn,
        messageID,
        isStreaming: true,
      },
      {
        phase: "reasoning",
        state: "Agent is reasoning",
      },
      appendTraceDelta(preparedItems, {
        kind: "reasoning",
        delta: readString(payload.delta) || readString(payload.text),
        fullText: readString(payload.text) || undefined,
        sourceID: readString(payload.partID) || undefined,
        messageID,
        backendTurnID: eventBackendTurnID,
        timestamp: eventTimestamp,
        debugEntries: buildRuntimeEventDebugEntries(event, item.id, {
          "message.id": readString(payload.messageID),
          "part.id": readString(payload.partID),
        }),
      }),
    )
  }

  if (event.type === "tool.input.delta") {
    const messageID = resolvePayloadMessageID(payload) || turn.messageID
    const toolCallID = readString(payload.toolCallID)
    const partID = readString(payload.partID)
    const sourceID = partID || (toolCallID ? `tool-input:${toolCallID}` : "")
    const delta = readString(payload.delta)
    if (!sourceID || !delta) return turn
    const rawLength = readNumber(payload.rawLength)
    const isAlreadyCancelled = turn.runtime.phase === "cancelled"
    const cancelledDetail = "Prompt cancellation requested."

    return updateRuntimeTurnLifecycle(
      {
        ...turn,
        messageID,
        isStreaming: !isAlreadyCancelled,
      },
      {
        phase: isAlreadyCancelled ? "cancelled" : "tool_running",
        state: isAlreadyCancelled ? turn.state : "Preparing tool call",
        toolName: isAlreadyCancelled ? null : readString(payload.toolName) || null,
      },
      appendToolInputDelta(preparedItems, {
        delta,
        sourceID,
        messageID,
        backendTurnID: eventBackendTurnID,
        toolCallID,
        toolName: readString(payload.toolName),
        status: isAlreadyCancelled ? "cancelled" : undefined,
        detail: isAlreadyCancelled ? cancelledDetail : undefined,
        timestamp: eventTimestamp,
        debugEntries: buildRuntimeEventDebugEntries(event, item.id, {
          "message.id": readString(payload.messageID),
          "part.id": partID,
          "tool.call": toolCallID,
          "tool.raw.length": rawLength > 0 ? rawLength : undefined,
        }),
      }),
    )
  }

  if (event.type === "part.removed") {
    const partID = readString(payload.partID)
    if (!partID) return turn

    return updateRuntimeTurnLifecycle(
      {
        ...turn,
        isStreaming: true,
      },
      {},
      preparedItems.filter((traceItem) => traceItem.sourceID !== partID && traceItem.id !== partID),
    )
  }

  if (event.type === "task.state.updated") {
    const taskState = readTaskState(payload.state)
    if (!taskState) return turn
    const sourceID = `task-state:${event.turnID}`
    const baseItems = clearStreamingItems(preparedItems).filter(
      (traceItem) => traceItem.kind !== "task-state" || traceItem.sourceID === sourceID,
    )
    const nextItems = upsertTraceItem(
      baseItems,
      createTaskStateTraceItem({
        sourceID,
        taskState,
        backendTurnID: eventBackendTurnID,
        timestamp: eventTimestamp,
        debugEntries,
      }),
    )

    return updateRuntimeTurnLifecycle(
      {
        ...turn,
        isStreaming: !isSettledAssistantPhase(turn.runtime.phase),
      },
      {},
      nextItems,
    )
  }

  if (event.type === "part.recorded") {
    const partRecord = readRecord(payload.part)
    if (readString(partRecord?.type) !== "compaction") return turn

    const traceItems = buildTraceItemFromPart(partRecord, {
      debugEntries,
      backendTurnID: eventBackendTurnID,
    })
    if (traceItems.length === 0) return turn

    const nextItems = upsertTraceItems(clearStreamingItems(preparedItems), traceItems)

    return updateRuntimeTurnLifecycle(
      {
        ...turn,
        isStreaming: !isSettledAssistantPhase(turn.runtime.phase),
      },
      {},
      nextItems,
    )
  }

  const part = payload.part
  if (
    event.type === "permission.requested" ||
    event.type === "permission.resolved" ||
    event.type === "text.part.completed" ||
    event.type === "reasoning.part.completed" ||
    event.type.startsWith("tool.call.") ||
    event.type === "source.recorded" ||
    event.type === "file.generated" ||
    event.type === "patch.generated" ||
    event.type === "snapshot.captured"
  ) {
    const partRecord = readRecord(part)
    const messageID = readString(partRecord?.messageID) || resolvePayloadMessageID(payload) || turn.messageID
    const traceItems = buildTraceItemFromPart(part, {
      debugEntries,
      messageID,
      backendTurnID: eventBackendTurnID,
    })
    if (traceItems.length === 0) return turn

    let nextItems = upsertTraceItems(clearStreamingItems(preparedItems), traceItems)
    const primaryItem = traceItems[0]
    const partState = readRecord(partRecord?.state)
    const approvalRequestID = readString(partState?.approvalID) || null
    const isStreaming = !isSettledAssistantPhase(turn.runtime.phase)

    if (primaryItem?.kind === "tool") {
      const inferredLifecycle = inferToolLifecycleFromTraceItem(turn, primaryItem, approvalRequestID)

      return updateRuntimeTurnLifecycle(
        {
          ...turn,
          messageID,
          isStreaming,
        },
        inferredLifecycle ?? (
          primaryItem.status === "waiting-approval" && turn.runtime.phase === "waiting_approval" && approvalRequestID
            ? { approvalRequestID }
            : {}
        ),
        nextItems,
      )
    }

    return updateRuntimeTurnLifecycle(
      {
        ...turn,
        messageID,
        isStreaming,
      },
      {},
      nextItems,
    )
  }

  if (event.type === "turn.completed") {
    const parts = Array.isArray(payload.parts) ? payload.parts : []
    const messageID = resolvePayloadMessageID(payload) || turn.messageID
    const ownership = eventOwnership(messageID)
    const baseItems = settleDraftPatchPreviews(preparedItems, "completed")
    const finalizedItems = alignAnonymousTraceItemsWithParts(clearStreamingItems(baseItems), parts, ownership)
    const nextItems = mergeTraceParts(finalizedItems, parts, ownership)

    return finalizeStreamAssistantTurn({
      ...turn,
      messageID,
      runtime: eventTimestamp === undefined
        ? turn.runtime
        : {
            ...turn.runtime,
            startedAt: eventTimestamp < turn.runtime.startedAt ? eventTimestamp : turn.runtime.startedAt,
            updatedAt: eventTimestamp,
          },
      state: "Backend response received",
      items: nextItems,
    }, {
      status: readString(payload.status) || undefined,
      finishReason: readString(payload.finishReason) || undefined,
      message: payload.message,
      backendTurnID: eventBackendTurnID,
      debugEntries,
      updatedAt: eventTimestamp,
    })
  }

  if (event.type === "turn.failed") {
    const parts = Array.isArray(payload.parts) ? payload.parts : []
    const failure = readHistoryErrorPresentation(payload.errorInfo)
    const message = failure?.message || readString(payload.error) || "Unknown backend error"
    const messageID = resolvePayloadMessageID(payload) || turn.messageID
    const ownership = eventOwnership(messageID)
    const messageTurn = applyAssistantMessageMetadata(turn, payload.message)
    const baseItems = settleDraftPatchPreviews(preparedItems, "error")
    const nextItems = appendTraceItem(
      mergeTraceParts(clearStreamingItems(baseItems), parts, ownership),
      createTraceItem({
        kind: "error",
        label: "Error",
        title: formatErrorTraceTitle("Runtime turn failed", failure),
        detail: message,
        status: "error",
        messageID: ownership.messageID,
        backendTurnID: ownership.backendTurnID,
        debugEntries,
      }),
    )

    return updateRuntimeTurnLifecycle(
      {
        ...messageTurn,
        messageID,
        isStreaming: false,
      },
      {
        phase: "failed",
        state: "Backend stream failed",
        errorMessage: message,
      },
      nextItems,
    )
  }

  if (event.type === "turn.cancelled") {
    const parts = Array.isArray(payload.parts) ? payload.parts : []
    const detail = readString(payload.detail) || readString(payload.reason) || "The turn was cancelled."
    const messageID = resolvePayloadMessageID(payload) || turn.messageID
    const ownership = eventOwnership(messageID)
    const cancelledTurn = markAssistantTurnInterrupted(applyAssistantMessageMetadata(turn, payload.message), detail)
    const cancelledItems = settleDraftPatchPreviews(cancelledTurn.items, "cancelled")
    const nextItems = upsertTraceItem(
      mergeTraceParts(cancelledItems, parts, ownership),
      createTraceItem({
        kind: "system",
        label: "System",
        title: "Turn cancelled",
        detail,
        status: "completed",
        sourceID: `${turn.id}:cancelled`,
        messageID: ownership.messageID,
        backendTurnID: ownership.backendTurnID,
        section: "workflow",
        visibilityKey: "workflow",
        timestamp: eventTimestamp,
        debugEntries,
      }),
    )

    return updateRuntimeTurnLifecycle(
      {
        ...cancelledTurn,
        messageID,
        isStreaming: false,
      },
      {
        phase: "cancelled",
        state: "Backend stream cancelled",
        toolName: null,
        approvalRequestID: null,
        errorMessage: null,
      },
      nextItems,
    )
  }

  return turn
}

export function applyAgentStreamEventToTurn(turn: AssistantTurn, item: AgentStreamEvent): AssistantTurn {
  const runtimeEvent = readRuntimeEvent(item)
  if (runtimeEvent) {
    return applyRuntimeEventToTurn(turn, item, runtimeEvent)
  }

  if (isSettledAssistantPhase(turn.runtime.phase) && !isTerminalLegacyStreamEvent(item.event)) {
    return turn
  }

  const payload = readRecord(item.data)
  const preparedItems = settleQueuedPrompt(turn.items, turn.id)
  const payloadBackendTurnID = readString(payload?.backendTurnID) || readString(payload?.turnID) || undefined
  const payloadOwnership = (messageID?: string): TraceItemOwnership => ({
    messageID: messageID || undefined,
    backendTurnID: payloadBackendTurnID,
  })

  if (item.event === "started") {
    const debugEntries = buildStreamEventDebugEntries("started", payload)

    return updateAssistantTurnLifecycle(
      {
        ...turn,
        isStreaming: true,
      },
      {
        phase: "reasoning",
        state: "Agent stream connected",
      },
      appendSystemTrace(
        preparedItems,
        turn.id,
        "Agent stream connected",
        "Renderer subscribed to live backend updates.",
        "completed",
        debugEntries,
        "workflow",
        "workflow",
        undefined,
        payloadOwnership(),
      ),
    )
  }

  if (item.event === "delta") {
    const delta = readString(payload?.delta)
    const fullText = readString(payload?.text)
    const kind = readString(payload?.kind) || "text"
    const sourceID = readString(payload?.partID) || undefined
    const messageID = resolvePayloadMessageID(payload ?? {}) || turn.messageID
    const debugEntries = buildStreamEventDebugEntries("delta", payload, {
      "message.id": readString(payload?.messageID),
      "part.id": sourceID ?? "",
    })

    if (kind === "reasoning") {
      return updateAssistantTurnLifecycle(
        {
          ...turn,
          messageID,
          isStreaming: true,
        },
        {
          phase: "reasoning",
          state: "Agent is reasoning",
        },
        appendTraceDelta(preparedItems, {
          kind: "reasoning",
          delta,
          fullText: fullText || undefined,
          sourceID,
          messageID,
          backendTurnID: payloadBackendTurnID,
          debugEntries,
        }),
      )
    }

    return updateAssistantTurnLifecycle(
      {
        ...turn,
        messageID,
        isStreaming: true,
      },
      {
        phase: "responding",
        state: "Streaming response",
      },
      appendTraceDelta(preparedItems, {
        kind: "text",
        delta,
        fullText: fullText || undefined,
        sourceID,
        messageID,
        backendTurnID: payloadBackendTurnID,
        debugEntries,
      }),
    )
  }

  if (item.event === "part") {
    const partRecord = readRecord(payload?.part)
    const messageID = readString(partRecord?.messageID) || resolvePayloadMessageID(payload ?? {}) || turn.messageID
    const traceItems = buildTraceItemFromPart(payload?.part, {
      debugEntries: buildStreamEventDebugEntries("part", payload),
      messageID,
      backendTurnID: payloadBackendTurnID,
    })
    if (traceItems.length === 0) return turn
    const nextItems = upsertTraceItems(clearStreamingItems(preparedItems), traceItems)
    const primaryItem = traceItems[0]
    const partState = readRecord(partRecord?.state)
    const approvalRequestID = readString(partState?.approvalID) || null
    const isStreaming = !isSettledAssistantPhase(turn.runtime.phase)

    if (primaryItem?.kind === "tool") {
      const inferredLifecycle = inferToolLifecycleFromTraceItem(turn, primaryItem, approvalRequestID)

      return updateAssistantTurnLifecycle(
        {
          ...turn,
          messageID,
          isStreaming,
        },
        inferredLifecycle ?? (
          primaryItem.status === "waiting-approval" && turn.runtime.phase === "waiting_approval" && approvalRequestID
            ? { approvalRequestID }
            : {}
        ),
        nextItems,
      )
    }

    return updateAssistantTurnLifecycle(
      {
        ...turn,
        messageID,
        isStreaming,
      },
      {},
      nextItems,
    )
  }

  if (item.event === "done") {
    const parts = Array.isArray(payload?.parts) ? payload.parts : []
    const messageID = resolvePayloadMessageID(payload ?? {}) || turn.messageID
    const ownership = payloadOwnership(messageID)
    const finalizedItems = alignAnonymousTraceItemsWithParts(clearStreamingItems(preparedItems), parts, ownership)
    const nextItems = mergeTraceParts(finalizedItems, parts, ownership)
    const debugEntries = buildStreamEventDebugEntries("done", payload, {
      status: readString(payload?.status),
      finishReason: readString(payload?.finishReason),
    })

    return finalizeStreamAssistantTurn({
      ...turn,
      messageID,
      state: "Backend response received",
      items: nextItems,
    }, {
      status: readString(payload?.status) || undefined,
      finishReason: readString(payload?.finishReason) || undefined,
      message: payload?.message,
      backendTurnID: payloadBackendTurnID,
      debugEntries,
    })
  }

  if (item.event === "error") {
    const message = readString(payload?.message) || "Unknown backend error"
    const messageID = resolvePayloadMessageID(payload ?? {}) || turn.messageID
    const ownership = payloadOwnership(messageID)
    const debugEntries = buildStreamEventDebugEntries("error", payload)
    const nextItems = appendTraceItem(
      clearStreamingItems(preparedItems),
      createTraceItem({
        kind: "error",
        label: "Error",
        title: "API stream error",
        detail: message,
        status: "error",
        messageID: ownership.messageID,
        backendTurnID: ownership.backendTurnID,
        debugEntries,
      }),
    )

    return updateAssistantTurnLifecycle(
      {
        ...turn,
        messageID,
        isStreaming: false,
      },
      {
        phase: "failed",
        state: "Backend stream failed",
        errorMessage: message,
      },
      nextItems,
    )
  }

  return turn
}

export function buildAgentTurn(prompt: string, session: SessionSummary, workspaceName: string, platform: string): AssistantTurn {
  const compactPrompt = prompt.replace(/\s+/g, " ").trim()
  const focusLine = compactPrompt.length > 56 ? `${compactPrompt.slice(0, 56)}...` : compactPrompt
  const items = [
    createTraceItem({
      kind: "system",
      label: "Prompt",
      title: "Prompt captured",
      text: `"${focusLine}"`,
      detail: `Working inside ${workspaceName} / ${session.title}.`,
      status: "completed",
    }),
    createTraceItem({
      kind: "reasoning",
      label: "Reasoning",
      text: "Keep the shell hierarchy obvious before wiring real-time state.",
    }),
    createTraceItem({
      kind: "reasoning",
      label: "Reasoning",
      text: "Preserve the Anybox-like restraint while making the assistant output read like an operational trace.",
    }),
    createTraceItem({
      kind: "text",
      label: "Response",
      text: `I captured "${focusLine}" and will align the ${workspaceName} context around ${session.title} before deciding which pieces belong in the shell versus the agent lane.`,
    }),
    createTraceItem({
      kind: "patch",
      label: "Patch",
      title: "UI shell boundary",
      detail: "Sidebar, thread lane, and composer keep a clear ownership boundary for later backend wiring.",
      status: "completed",
    }),
    createTraceItem({
      kind: "system",
      label: "System",
      title: "Next direction",
      detail: `Treat ${platform} as the primary runtime so window and density choices stay desktop-first.`,
      status: "completed",
    }),
  ]

  return {
    id: createID("assistant"),
    kind: "assistant",
    timestamp: Date.now(),
    runtime: createAssistantTurnRuntime({
      phase: "completed",
      items,
    }),
    state: "Implementation draft generated",
    items,
  }
}

export function buildAgentTurnFromEvents(events: AgentStreamEvent[], prompt: string): AssistantTurn {
  let turn = buildStreamingAssistantTurn(prompt)
  for (const event of events) {
    turn = applyAgentStreamEventToTurn(turn, event)
  }

  return turn.isStreaming ? finalizeStreamAssistantTurn(turn) : turn
}
