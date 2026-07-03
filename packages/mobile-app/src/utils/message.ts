import type { MobileMessage, MobileStreamEvent } from "@/api/mobile-api"

export interface PendingPromptOverlay {
  id: string
  text: string
  anchorMessageID?: string | null
}

export type AssistantTextContentKind = "reasoning" | "response"
export type AssistantContentKind = AssistantTextContentKind | "tool"
export type MessageToolStatus = "pending" | "running" | "waiting-approval" | "completed" | "failed" | "denied" | "cancelled" | "unknown"

export interface MessageTextContentSegment {
  kind: AssistantTextContentKind
  text: string
}

export interface MessageToolContentSegment {
  kind: "tool"
  callID: string
  tool: string
  status: MessageToolStatus
  title?: string
  questionPrompt?: MobileQuestionPrompt
  input?: Record<string, unknown>
  inputPreview?: string
  outputPreview?: string
  error?: string
  reason?: string
  rawInput?: string
}

export type MessageContentSegment = MessageTextContentSegment | MessageToolContentSegment

export interface MobileQuestionOption {
  label: string
  value: string
  description?: string
}

export interface MobileQuestionPrompt {
  questionID?: string
  header?: string
  question: string
  options: MobileQuestionOption[]
  allowFreeform: boolean
  placeholder?: string
  multiple: boolean
  required: boolean
  answered: boolean
  answerText?: string
  selectedOptions?: string[]
  freeformText?: string
  answeredAt?: number
}

export interface StreamingAssistantOverlay {
  id: string
  segments: MessageContentSegment[]
  anchorMessageID?: string | null
}

export function messageRole(message: MobileMessage) {
  return message.info?.role || "assistant"
}

export function messageText(message: MobileMessage) {
  const text = extractText(message.parts)
  if (text) return text
  if (extractContentSegments(message.parts).length) return ""
  if (message.parts == null) return ""
  if (Array.isArray(message.parts) && message.parts.length === 0) return ""
  if (isNonDisplayablePartPayload(message.parts)) return ""
  return JSON.stringify(message.parts, null, 2)
}

export function messageContentSegments(message: MobileMessage): MessageContentSegment[] {
  return extractContentSegments(message.parts)
}

export function messageHasVisibleContent(message: MobileMessage) {
  if (message.info?.internal === true) return false
  const segments = messageContentSegments(message)
  if (segments.some((segment) => segment.kind === "tool" || segment.text.trim())) return true
  return Boolean(messageText(message).trim())
}

export function extractText(value: unknown): string {
  if (typeof value === "string") return value
  if (Array.isArray(value)) return value.map(extractText).filter(Boolean).join("\n")
  if (!value || typeof value !== "object") return ""

  const record = value as Record<string, unknown>
  if (typeof record.text === "string") return record.text
  if (typeof record.content === "string") return record.content
  if (typeof record.value === "string") return record.value
  if (Array.isArray(record.parts)) return extractText(record.parts)
  return ""
}

export function appendMessageContentSegment(
  segments: MessageContentSegment[],
  kind: AssistantTextContentKind,
  text: string,
): MessageContentSegment[] {
  if (!text) return segments
  const last = segments.at(-1)
  if (last?.kind === kind) {
    return [
      ...segments.slice(0, -1),
      { ...last, text: `${last.text}${text}` },
    ]
  }
  return [...segments, { kind, text }]
}

export function applyMobileStreamToolEvent(segments: MessageContentSegment[], event: MobileStreamEvent): MessageContentSegment[] {
  const update = readMobileStreamToolUpdate(event)
  if (!update) return segments

  const index = segments.findIndex((segment) => segment.kind === "tool" && segment.callID === update.callID)
  const previous = index >= 0 ? segments[index] as MessageToolContentSegment : undefined
  const next = mergeToolSegmentUpdate(previous, update)

  if (index >= 0) {
    return [
      ...segments.slice(0, index),
      next,
      ...segments.slice(index + 1),
    ]
  }

  return [...segments, next]
}

export function mergeOptimisticMessages(
  messages: MobileMessage[],
  pendingPrompt: PendingPromptOverlay | null,
  streamingAssistant: StreamingAssistantOverlay | null,
) {
  const nextMessages = [...messages]
  const searchStart = pendingPrompt
    ? findOverlaySearchStart(nextMessages, pendingPrompt.anchorMessageID, 0)
    : findOverlaySearchStart(nextMessages, streamingAssistant?.anchorMessageID, nextMessages.length)
  let promptIndex = -1

  if (pendingPrompt) {
    const pendingText = normalizeMessageText(pendingPrompt.text)
    promptIndex = nextMessages.findIndex((message, index) => (
      index >= searchStart &&
      messageRole(message) === "user" &&
      normalizeMessageText(extractText(message.parts)) === pendingText
    ))

    if (promptIndex === -1) {
      promptIndex = nextMessages.length
      nextMessages.push(createOverlayMessage(pendingPrompt.id, "user", pendingPrompt.text))
    }
  }

  if (streamingAssistant) {
    const assistantSearchStart = promptIndex >= 0 ? promptIndex + 1 : searchStart
    const assistantIndex = nextMessages.findIndex((message, index) => (
      index >= assistantSearchStart &&
      messageRole(message) === "assistant"
    ))
    const assistantMessage = createAssistantOverlayMessage(streamingAssistant.id, streamingAssistant.segments)

    if (assistantIndex >= 0) {
      nextMessages[assistantIndex] = assistantMessage
    } else {
      nextMessages.push(assistantMessage)
    }
  }

  return nextMessages satisfies MobileMessage[]
}

function findOverlaySearchStart(messages: MobileMessage[], anchorMessageID: string | null | undefined, fallback: number) {
  if (anchorMessageID === null) return 0
  if (!anchorMessageID) return fallback
  const anchorIndex = messages.findIndex((message) => message.info?.id === anchorMessageID)
  return anchorIndex >= 0 ? anchorIndex + 1 : fallback
}

function createOverlayMessage(id: string, role: "user" | "assistant", text: string): MobileMessage {
  const now = Date.now()
  return {
    info: {
      id,
      role,
      created: now,
      updated: now,
    },
    parts: [{ type: "text", text }],
  }
}

function createAssistantOverlayMessage(id: string, segments: MessageContentSegment[]): MobileMessage {
  const now = Date.now()
  const parts = segments
    .map((segment) => (
      segment.kind === "tool"
        ? toolSegmentToPart(id, segment, now)
        : segment.text
          ? {
              type: segment.kind === "reasoning" ? "reasoning" : "text",
              text: segment.text,
            }
          : null
    ))
    .filter(Boolean)

  return {
    info: {
      id,
      pending: true,
      role: "assistant",
      created: now,
      updated: now,
    },
    parts: parts.length ? parts : [{ type: "text", text: "..." }],
  }
}

function normalizeMessageText(text: string) {
  return text.replace(/\s+/g, " ").trim()
}

function extractContentSegments(value: unknown, fallbackKind: AssistantContentKind = "response"): MessageContentSegment[] {
  if (typeof value === "string") return value && fallbackKind !== "tool" ? [{ kind: fallbackKind, text: value }] : []
  if (Array.isArray(value)) {
    return mergeAdjacentSegments(value.flatMap((item) => extractContentSegments(item, fallbackKind)))
  }
  if (!value || typeof value !== "object") return []

  const record = value as Record<string, unknown>
  const toolSegment = extractToolSegment(record)
  if (toolSegment) return [toolSegment]
  const kind = contentKind(record, fallbackKind)
  const directText = directRecordText(record)
  if (directText && kind !== "tool") return [{ kind, text: directText }]
  if (Array.isArray(record.parts)) return extractContentSegments(record.parts, kind)
  if (Array.isArray(record.content)) return extractContentSegments(record.content, kind)
  return []
}

function contentKind(record: Record<string, unknown>, fallbackKind: AssistantContentKind): AssistantContentKind {
  if (record.type === "tool" || record.kind === "tool") return "tool"
  if (record.type === "reasoning" || record.kind === "reasoning" || record.reasoning === true) return "reasoning"
  if (record.type === "response" || record.kind === "response") return "response"
  return fallbackKind
}

function directRecordText(record: Record<string, unknown>) {
  if (typeof record.text === "string") return record.text
  if (typeof record.content === "string") return record.content
  if (typeof record.value === "string") return record.value
  return ""
}

function mergeAdjacentSegments(segments: MessageContentSegment[]) {
  return segments.reduce<MessageContentSegment[]>((result, segment) => (
    segment.kind === "tool"
      ? [...result, segment]
      : appendMessageContentSegment(result, segment.kind, segment.text)
  ), [])
}

const NON_DISPLAYABLE_PART_TYPES = new Set([
  "agent",
  "compaction",
  "permission",
  "retry",
  "snapshot",
  "source-document",
  "source-url",
  "step-finish",
  "step-start",
])

function isNonDisplayablePartPayload(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0 && value.every(isNonDisplayablePartPayload)
  const record = readRecord(value)
  if (!record) return false
  const type = readString(record.type)
  return Boolean(type && NON_DISPLAYABLE_PART_TYPES.has(type))
}

interface ToolSegmentUpdate {
  callID: string
  tool?: string
  status?: MessageToolStatus
  title?: string
  questionPrompt?: MobileQuestionPrompt
  input?: Record<string, unknown>
  output?: unknown
  error?: string
  reason?: string
  rawInput?: string
  inputDelta?: string
}

function readMobileStreamToolUpdate(event: MobileStreamEvent): ToolSegmentUpdate | null {
  if (event.event !== "runtime") return null
  const data = readRecord(event.data)
  if (!data) return null
  const type = typeof data?.type === "string" ? data.type : ""
  if (!type.startsWith("tool.")) return null

  const payload = readRecord(data.payload)
  if (!payload) return null

  if (type === "tool.input.delta") {
    const callID = readString(payload.toolCallID)
    const delta = readString(payload.delta)
    if (!callID || !delta) return null
    return {
      callID,
      inputDelta: delta,
      status: "pending",
      tool: readString(payload.toolName) || undefined,
    }
  }

  const part = readRecord(payload.part)
  if (!part) return null
  const callID = readString(part.callID)
  if (!callID) return null
  const state = readRecord(part.state)
  const status = normalizeToolStatus(readString(state?.status), statusFromRuntimeEventType(type))
  return {
    callID,
    error: readString(state?.error) || undefined,
    input: readRecord(state?.input) ?? undefined,
    output: state && "output" in state ? state.output : undefined,
    questionPrompt: readAskUserQuestionPrompt(state?.metadata) ?? undefined,
    rawInput: readString(state?.raw) || undefined,
    reason: readString(state?.reason) || undefined,
    status,
    title: readString(state?.title) || undefined,
    tool: readString(part.tool) || undefined,
  }
}

function mergeToolSegmentUpdate(previous: MessageToolContentSegment | undefined, update: ToolSegmentUpdate): MessageToolContentSegment {
  const rawInput = update.inputDelta
    ? `${previous?.rawInput ?? ""}${update.inputDelta}`
    : update.rawInput ?? previous?.rawInput
  const input = update.input ?? previous?.input
  const outputPreview = update.output === undefined ? previous?.outputPreview : compactPreview(update.output)
  const next: MessageToolContentSegment = {
    kind: "tool",
    callID: update.callID,
    tool: update.tool ?? previous?.tool ?? "tool",
    status: update.status ?? previous?.status ?? "unknown",
    title: update.title ?? previous?.title,
    questionPrompt: update.questionPrompt ?? previous?.questionPrompt,
    input,
    inputPreview: summarizeToolInput(input, rawInput) || previous?.inputPreview,
    outputPreview,
    error: update.error ?? previous?.error,
    reason: update.reason ?? previous?.reason,
    rawInput,
  }
  return next
}

function extractToolSegment(record: Record<string, unknown>): MessageToolContentSegment | null {
  if (record.type !== "tool" && record.kind !== "tool") return null
  const callID = readString(record.callID) || readString(record.toolCallID) || readString(record.id) || "tool"
  const tool = readString(record.tool) || readString(record.toolName) || "tool"
  const state = readRecord(record.state)
  const status = normalizeToolStatus(readString(state?.status) || readString(record.status), "unknown")
  const input = readRecord(state?.input) ?? readRecord(record.input) ?? undefined
  const rawInput = readString(state?.raw) || readString(record.raw) || undefined
  const output = state && "output" in state ? state.output : record.output
  const questionPrompt = readAskUserQuestionPrompt(state?.metadata ?? record.metadata) ?? undefined
  return {
    kind: "tool",
    callID,
    tool,
    status,
    title: readString(state?.title) || readString(record.title) || undefined,
    questionPrompt,
    input,
    inputPreview: summarizeToolInput(input, rawInput),
    outputPreview: output === undefined ? undefined : compactPreview(output),
    error: readString(state?.error) || readString(record.error) || undefined,
    reason: readString(state?.reason) || readString(record.reason) || undefined,
    rawInput,
  }
}

function toolSegmentToPart(messageID: string, segment: MessageToolContentSegment, now: number) {
  const state = {
    status: partStatusFromToolStatus(segment.status),
    input: segment.input ?? {},
    raw: segment.rawInput ?? "",
    ...(segment.title ? { title: segment.title } : {}),
    ...(segment.questionPrompt
      ? {
          metadata: {
            kind: "ask-user-question",
            version: 1,
            ...segment.questionPrompt,
          },
        }
      : {}),
    ...(segment.outputPreview ? { output: segment.outputPreview } : {}),
    ...(segment.error ? { error: segment.error } : {}),
    ...(segment.reason ? { reason: segment.reason } : {}),
    time: {
      start: now,
      ...(isTerminalToolStatus(segment.status) ? { end: now } : {}),
    },
  }
  return {
    id: `part-${segment.callID}`,
    messageID,
    type: "tool",
    callID: segment.callID,
    tool: segment.tool,
    state,
  }
}

function statusFromRuntimeEventType(type: string): MessageToolStatus {
  if (type === "tool.call.pending") return "pending"
  if (type === "tool.call.started" || type === "tool.call.approved") return "running"
  if (type === "tool.call.waiting_approval") return "waiting-approval"
  if (type === "tool.call.completed") return "completed"
  if (type === "tool.call.failed") return "failed"
  if (type === "tool.call.denied") return "denied"
  if (type === "tool.call.cancelled") return "cancelled"
  return "unknown"
}

function normalizeToolStatus(value: string | undefined, fallback: MessageToolStatus): MessageToolStatus {
  if (value === "pending") return "pending"
  if (value === "running") return "running"
  if (value === "waiting-approval") return "waiting-approval"
  if (value === "completed") return "completed"
  if (value === "error" || value === "failed") return "failed"
  if (value === "denied") return "denied"
  if (value === "cancelled") return "cancelled"
  return fallback
}

function partStatusFromToolStatus(status: MessageToolStatus) {
  if (status === "failed") return "error"
  if (status === "unknown") return "pending"
  return status
}

function isTerminalToolStatus(status: MessageToolStatus) {
  return status === "completed" || status === "failed" || status === "denied" || status === "cancelled"
}

function readAskUserQuestionPrompt(value: unknown): MobileQuestionPrompt | null {
  const metadata = readRecord(value)
  if (!metadata || readString(metadata.kind) !== "ask-user-question") return null

  const question = readString(metadata.question)
  if (!question) return null

  const options = Array.isArray(metadata.options)
    ? metadata.options
        .map((option) => readRecord(option))
        .filter((option): option is Record<string, unknown> => Boolean(option))
        .map((option): MobileQuestionOption | null => {
          const label = readString(option.label)
          const value = readString(option.value) || label
          const description = readString(option.description) || undefined
          if (!label || !value) return null
          return {
            label,
            value,
            ...(description ? { description } : {}),
          }
        })
        .filter((option): option is MobileQuestionOption => Boolean(option))
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

function summarizeToolInput(input: Record<string, unknown> | undefined, rawInput: string | undefined) {
  if (input && Object.keys(input).length > 0) {
    for (const key of ["command", "cmd", "path", "file", "pattern", "query", "q", "description", "prompt", "url"]) {
      const value = input[key]
      if (typeof value === "string" && value.trim()) return compactPreview(`${key}: ${value}`)
    }
    return compactPreview(input)
  }
  return rawInput ? compactPreview(rawInput) : undefined
}

function compactPreview(value: unknown, maxLength = 180) {
  let text = ""
  if (typeof value === "string") {
    text = value
  } else if (value !== undefined && value !== null) {
    try {
      text = JSON.stringify(value)
    } catch {
      text = String(value)
    }
  }
  text = text.replace(/\s+/g, " ").trim()
  if (!text) return undefined
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : ""
}

function readBoolean(value: unknown) {
  return value === true
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}
