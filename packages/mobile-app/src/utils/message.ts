import type { MobileMessage, MobileStreamEvent } from "@/api/mobile-api"

export type AssistantTextContentKind = "reasoning" | "response"
export type AssistantContentKind = AssistantTextContentKind | "tool"
export type MessageToolStatus = "pending" | "running" | "waiting-approval" | "completed" | "failed" | "denied" | "cancelled" | "unknown"

export interface MessageTextContentSegment {
  kind: AssistantTextContentKind
  text: string
  sourceID?: string
  sequence?: number
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
  sourceID?: string
  sequence?: number
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

export type ActiveStreamStatus = "streaming" | "settling" | "error"

export interface ActiveMobileStream {
  sessionID: string
  anchorMessageID?: string | null
  createdAt: number
  updatedAt: number
  status: ActiveStreamStatus
  error?: string
  prompt: {
    id: string
    text: string
  }
  assistant: {
    id: string
    segments: MessageContentSegment[]
  }
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

export function orderMobileMessagesForDisplay(messages: MobileMessage[]) {
  const dedupedMessages = new Map<string, { index: number; message: MobileMessage }>()
  const anonymousMessages: Array<{ index: number; message: MobileMessage }> = []

  messages.forEach((message, index) => {
    const id = message.info?.id
    if (!id) {
      anonymousMessages.push({ index, message })
      return
    }

    const previous = dedupedMessages.get(id)
    if (!previous) {
      dedupedMessages.set(id, { index, message })
      return
    }

    const previousUpdated = readNumber(previous.message.info?.updated) ?? readNumber(previous.message.info?.created) ?? previous.index
    const nextUpdated = readNumber(message.info?.updated) ?? readNumber(message.info?.created) ?? index
    if (nextUpdated >= previousUpdated) {
      dedupedMessages.set(id, { index: previous.index, message })
    }
  })

  return [...dedupedMessages.values(), ...anonymousMessages]
    .sort((left, right) => {
      const leftCreated = readNumber(left.message.info?.created)
      const rightCreated = readNumber(right.message.info?.created)
      const leftHasCreated = leftCreated !== undefined
      const rightHasCreated = rightCreated !== undefined

      if (leftHasCreated && rightHasCreated && leftCreated !== rightCreated) {
        return leftCreated - rightCreated
      }

      if (leftHasCreated !== rightHasCreated) {
        return leftHasCreated ? -1 : 1
      }

      const leftUpdated = readNumber(left.message.info?.updated)
      const rightUpdated = readNumber(right.message.info?.updated)
      if (leftUpdated !== undefined && rightUpdated !== undefined && leftUpdated !== rightUpdated) {
        return leftUpdated - rightUpdated
      }

      return left.index - right.index
    })
    .map(({ message }) => message)
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

function nextSegmentSequence(segments: MessageContentSegment[]) {
  return segments.reduce((max, segment, index) => {
    const sequence = segment.sequence ?? index
    return sequence > max ? sequence : max
  }, -1) + 1
}

function orderMessageContentSegments(segments: MessageContentSegment[]) {
  return segments
    .map((segment, index) => ({ index, segment }))
    .sort((left, right) => {
      const sourceOrder = compareSegmentSourceID(left.segment.sourceID, right.segment.sourceID)
      if (sourceOrder !== 0) return sourceOrder

      const leftSequence = left.segment.sequence ?? left.index
      const rightSequence = right.segment.sequence ?? right.index
      if (leftSequence !== rightSequence) return leftSequence - rightSequence

      return left.index - right.index
    })
    .map(({ segment }) => segment)
}

function compareSegmentSourceID(left: string | undefined, right: string | undefined) {
  if (!left || !right || left === right) return 0
  return compareNaturalIdentifier(left, right)
}

function compareNaturalIdentifier(left: string, right: string) {
  if (/^[a-z]+_[0-9a-f]{12}/i.test(left) && /^[a-z]+_[0-9a-f]{12}/i.test(right)) {
    return left < right ? -1 : left > right ? 1 : 0
  }

  const leftParts = left.match(/\d+|\D+/g) ?? [left]
  const rightParts = right.match(/\d+|\D+/g) ?? [right]
  const length = Math.max(leftParts.length, rightParts.length)

  for (let index = 0; index < length; index += 1) {
    const leftPart = leftParts[index]
    const rightPart = rightParts[index]
    if (leftPart === undefined) return -1
    if (rightPart === undefined) return 1
    if (leftPart === rightPart) continue

    const leftNumber = readSafeNaturalNumber(leftPart)
    const rightNumber = readSafeNaturalNumber(rightPart)
    if (leftNumber !== undefined && rightNumber !== undefined && leftNumber !== rightNumber) {
      return leftNumber - rightNumber
    }

    return leftPart < rightPart ? -1 : 1
  }

  return 0
}

function readSafeNaturalNumber(value: string) {
  if (!/^\d+$/.test(value)) return undefined
  if (value.length > 12) return undefined
  const number = Number(value)
  return Number.isSafeInteger(number) ? number : undefined
}

export function appendMessageContentSegment(
  segments: MessageContentSegment[],
  kind: AssistantTextContentKind,
  text: string,
  sourceID?: string,
): MessageContentSegment[] {
  if (!text) return segments
  if (sourceID) {
    const index = segments.findIndex((segment) => segment.kind === kind && segment.sourceID === sourceID)
    if (index >= 0) {
      const previous = segments[index] as MessageTextContentSegment
      const next = [
        ...segments.slice(0, index),
        { ...previous, text: `${previous.text}${text}` },
        ...segments.slice(index + 1),
      ]
      return orderMessageContentSegments(next)
    }

    return orderMessageContentSegments([
      ...segments,
      { kind, text, sourceID, sequence: nextSegmentSequence(segments) },
    ])
  }

  const last = segments.length ? segments[segments.length - 1] : undefined
  if (last?.kind === kind && !last.sourceID) {
    return [
      ...segments.slice(0, -1),
      { ...last, text: `${last.text}${text}` },
    ]
  }
  return [...segments, { kind, text, sequence: nextSegmentSequence(segments) }]
}

export function applyMobileStreamToolEvent(segments: MessageContentSegment[], event: MobileStreamEvent): MessageContentSegment[] {
  const update = readMobileStreamToolUpdate(event)
  if (!update) return segments

  const index = segments.findIndex((segment) => segment.kind === "tool" && segment.callID === update.callID)
  const previous = index >= 0 ? segments[index] as MessageToolContentSegment : undefined
  const next = {
    ...mergeToolSegmentUpdate(previous, update),
    sequence: previous?.sequence ?? nextSegmentSequence(segments),
  }

  if (index >= 0) {
    return orderMessageContentSegments([
      ...segments.slice(0, index),
      next,
      ...segments.slice(index + 1),
    ])
  }

  return orderMessageContentSegments([...segments, next])
}

export function mergeActiveStreamMessages(
  messages: MobileMessage[],
  activeStream: ActiveMobileStream | null,
) {
  const nextMessages = orderMobileMessagesForDisplay(messages)
  if (!activeStream) return nextMessages

  const searchStart = findOverlaySearchStart(nextMessages, activeStream.anchorMessageID, nextMessages.length)
  const promptText = normalizeMessageText(activeStream.prompt.text)
  let promptIndex = findActivePromptIndex(nextMessages, searchStart, promptText)

  if (promptIndex === -1) {
    promptIndex = searchStart
    nextMessages.splice(
      promptIndex,
      0,
      createOverlayMessage(activeStream.prompt.id, "user", activeStream.prompt.text, activeStream.createdAt),
    )
  }

  const assistantMessage = createAssistantOverlayMessage(
    activeStream.assistant.id,
    activeStream.assistant.segments,
    activeStream.status,
    activeStream.createdAt + 1,
    activeStream.updatedAt,
  )
  const assistantIndex = findActiveAssistantIndex(nextMessages, promptIndex + 1)

  if (assistantIndex >= 0) {
    nextMessages[assistantIndex] = assistantMessage
  } else {
    nextMessages.splice(promptIndex + 1, 0, assistantMessage)
  }

  return nextMessages satisfies MobileMessage[]
}

function findOverlaySearchStart(messages: MobileMessage[], anchorMessageID: string | null | undefined, fallback: number) {
  if (anchorMessageID === null) return 0
  if (!anchorMessageID) return fallback
  const anchorIndex = messages.findIndex((message) => message.info?.id === anchorMessageID)
  return anchorIndex >= 0 ? anchorIndex + 1 : fallback
}

function findActivePromptIndex(messages: MobileMessage[], searchStart: number, promptText: string) {
  return messages.findIndex((message, index) => (
    index >= searchStart &&
    messageRole(message) === "user" &&
    normalizeMessageText(extractText(message.parts)) === promptText
  ))
}

function findActiveAssistantIndex(messages: MobileMessage[], searchStart: number) {
  for (let index = searchStart; index < messages.length; index += 1) {
    const role = messageRole(messages[index]!)
    if (role === "assistant") return index
    if (role === "user") return -1
  }
  return -1
}

function createOverlayMessage(id: string, role: "user" | "assistant", text: string, createdAt: number): MobileMessage {
  return {
    info: {
      id,
      role,
      created: createdAt,
      updated: createdAt,
    },
    parts: [{ type: "text", text }],
  }
}

function createAssistantOverlayMessage(
  id: string,
  segments: MessageContentSegment[],
  status: ActiveStreamStatus,
  createdAt: number,
  updatedAt: number,
): MobileMessage {
  const parts = segments
    .map((segment) => (
      segment.kind === "tool"
        ? toolSegmentToPart(id, segment, updatedAt)
        : segment.text
          ? {
              ...(segment.sourceID ? { id: segment.sourceID } : {}),
              type: segment.kind === "reasoning" ? "reasoning" : "text",
              text: segment.text,
            }
          : null
    ))
    .filter(Boolean)

  return {
    info: {
      id,
      pending: status !== "error",
      role: "assistant",
      created: createdAt,
      updated: updatedAt,
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
  if (isNonDisplayablePartPayload(record)) return []
  const toolSegment = extractToolSegment(record)
  if (toolSegment) return [toolSegment]
  const kind = contentKind(record, fallbackKind)
  const directText = directRecordText(record)
  if (directText && kind !== "tool") {
    return [{
      kind,
      text: directText,
      sourceID: readString(record.id) || readString(record.partID) || undefined,
    }]
  }
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
      : appendMessageContentSegment(result, segment.kind, segment.text, segment.sourceID)
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
  sourceID?: string
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
      sourceID: readString(payload.partID) || undefined,
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
    sourceID: readString(part.id) || readString(payload.partID) || undefined,
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
    sourceID: update.sourceID ?? previous?.sourceID,
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
    sourceID: readString(record.id) || readString(record.partID) || undefined,
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
    id: segment.sourceID ?? `part-${segment.callID}`,
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
