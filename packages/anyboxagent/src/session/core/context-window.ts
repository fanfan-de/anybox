import { generateText, type ModelMessage, type ToolSet } from "ai"
import * as Config from "#config/config.ts"
import { Flag } from "#flag/flag.ts"
import * as Log from "#util/log.ts"
import * as Message from "#session/core/message.ts"
import * as ModelRuntime from "#model/runtime.ts"
import * as Provider from "#provider/provider.ts"
import * as ProviderTransform from "#provider/transform.ts"
import * as Session from "#session/core/session.ts"
import { Instance } from "#project/instance.ts"
import * as Identifier from "#id/id.ts"

const log = Log.create({ service: "session.context-window" })

const DEFAULT_CONTEXT_LIMIT = 128_000
const DEFAULT_OUTPUT_LIMIT = 8_192
const RESERVED_OUTPUT_MIN = 2_048
const RESERVED_OUTPUT_MAX = 16_384
const DEFAULT_SOFT_RATIO = 0.72
const DEFAULT_HARD_RATIO = 0.82
const MAX_COMPACTION_ATTEMPTS = 4
const RECENT_TURNS_TO_KEEP = 6
const MIN_TURNS_TO_KEEP = 2
const MAX_COMPACTION_BATCH_TOKENS = 12_000
const PRUNED_TOOL_OUTPUT_CHARS = 1_200
const EMERGENCY_TOOL_OUTPUT_CHARS = 320
const FALLBACK_TOOL_INPUT_CHARS = 600
const MEMORY_BLOCK_MAX_CHARS = 10_000
const MEMORY_BLOCK_MIN_CHARS = 1_500
export const CURRENT_SUMMARY_VERSION = 1

const COMPACTION_COMMAND = [
  "<compaction_instruction>",
  "Compress the prior conversation messages into durable continuation context.",
  "Return only the content that belongs inside <compacted_history>; do not include the XML tags themselves.",
  "Preserve facts needed to continue the task: goals, repository state, important files and code details, decisions, errors, tool outcomes, current progress, and next steps.",
  "The latest raw messages retained outside this request will be more authoritative than this compacted history if there is a conflict.",
  "Use the language that best matches the conversation. Do not invent facts.",
  "</compaction_instruction>",
].join("\n")

type SessionTurn = {
  messages: Message.WithParts[]
  userMessageID: string
  lastMessageID: string
}

type PromptBudget = {
  maxPromptTokens: number
  softThreshold: number
  hardThreshold: number
  reservedOutputTokens: number
  maxCompactionBatchTokens: number
}

type BuiltPromptWindow = {
  system: string[]
  messages: Message.WithParts[]
  compactedHistory: Message.WithParts | null
  estimatedTokens: number
  budget: PromptBudget
}

type SummaryGenerator = (input: {
  system: string[]
  messages: Message.WithParts[]
  model: Provider.Model
  reasoningEffort?: Message.ReasoningEffort
  tools?: ToolSet
}) => Promise<string>

type CompactionMessageRecorder = (input: {
  message: Message.User
  parts: Message.Part[]
}) => Promise<void> | void

export type PreparedPromptContext = {
  system: string[]
  messages: Message.WithParts[]
  compactedHistory: Message.WithParts | null
  estimatedTokens: number
  budget: PromptBudget
}

export type ForcedCompactionResult = {
  status: "compacted" | "noop"
  reason?: "not-enough-history"
  compactedMessageID?: string
  compactionID?: string
  compactedFromMessageID?: string
  compactedToMessageID?: string
  sourceMessageCount: number
  estimatedTokens: number
  budget: PromptBudget
}

export async function preparePromptContext(input: {
  sessionID: string
  model: Provider.Model
  system: string[]
  messages: Message.WithParts[]
  reasoningEffort?: Message.ReasoningEffort
  tools?: ToolSet
  generateSummary?: SummaryGenerator
  recordCompactionMessage?: CompactionMessageRecorder
  disableCompaction?: boolean
}): Promise<PreparedPromptContext> {
  const autoCompact = input.disableCompaction ? false : await isAutoCompactionEnabled()
  const summaryGenerator = input.generateSummary ?? generateCompactionSummary
  let workingMessages = [...input.messages]

  for (let attempt = 0; autoCompact && attempt < MAX_COMPACTION_ATTEMPTS; attempt += 1) {
    const window = buildPromptWindow({
      system: input.system,
      messages: workingMessages,
      model: input.model,
      allowTurnDropping: false,
    })

    if (window.estimatedTokens <= window.budget.softThreshold) {
      return {
        system: window.system,
        messages: window.messages,
        compactedHistory: window.compactedHistory,
        estimatedTokens: window.estimatedTokens,
        budget: window.budget,
      }
    }

    const rawMessages = filterRawConversationMessages(workingMessages)
    const compactedBoundary = window.compactedHistory
      ? readCompactionBoundary(window.compactedHistory)?.compactedToMessageID
      : undefined
    const turns = turnsAfterCompactionBoundary(rawMessages, compactedBoundary)
    const selectedTurns = selectTurnsForCompaction(turns, window.budget)
    if (selectedTurns.length === 0) {
      return {
        system: window.system,
        messages: window.messages,
        compactedHistory: window.compactedHistory,
        estimatedTokens: window.estimatedTokens,
        budget: window.budget,
      }
    }

    const compactedHistory = await compactTurns({
      sessionID: input.sessionID,
      existing: window.compactedHistory,
      turns: selectedTurns,
      system: input.system,
      model: input.model,
      reasoningEffort: input.reasoningEffort,
      tools: input.tools,
      generateSummary: summaryGenerator,
      auto: true,
    })

    await recordCompactedHistoryMessage(compactedHistory, input.recordCompactionMessage)
    workingMessages = [...workingMessages, compactedHistory]

    const boundary = readCompactionBoundary(compactedHistory)
    log.info("session history compacted", {
      sessionID: input.sessionID,
      compactionID: boundary?.compactionID,
      compactedToMessageID: boundary?.compactedToMessageID,
      sourceMessageCount: selectedTurns.reduce((total, turn) => total + turn.messages.length, 0),
      estimatedTokens: estimateMessagesTokens([compactedHistory]),
    })
  }

  const window = buildPromptWindow({
    system: input.system,
    messages: workingMessages,
    model: input.model,
  })

  return {
    system: window.system,
    messages: window.messages,
    compactedHistory: window.compactedHistory,
    estimatedTokens: window.estimatedTokens,
    budget: window.budget,
  }
}

export async function compactPromptContext(input: {
  sessionID: string
  model: Provider.Model
  system: string[]
  messages: Message.WithParts[]
  reasoningEffort?: Message.ReasoningEffort
  tools?: ToolSet
  generateSummary?: SummaryGenerator
  recordCompactionMessage?: CompactionMessageRecorder
  auto?: boolean
}): Promise<ForcedCompactionResult> {
  const summaryGenerator = input.generateSummary ?? generateCompactionSummary
  const window = buildPromptWindow({
    system: input.system,
    messages: input.messages,
    model: input.model,
    allowTurnDropping: false,
  })
  const compactedBoundary = window.compactedHistory
    ? readCompactionBoundary(window.compactedHistory)?.compactedToMessageID
    : undefined
  const rawMessages = filterRawConversationMessages(input.messages)
  const turns = turnsAfterCompactionBoundary(rawMessages, compactedBoundary)
  const selectedTurns = selectTurnsForCompaction(turns, window.budget)
  if (selectedTurns.length === 0) {
    return {
      status: "noop",
      reason: "not-enough-history",
      sourceMessageCount: 0,
      estimatedTokens: window.estimatedTokens,
      budget: window.budget,
    }
  }

  const compactedHistory = await compactTurns({
    sessionID: input.sessionID,
    existing: window.compactedHistory,
    turns: selectedTurns,
    system: input.system,
    model: input.model,
    reasoningEffort: input.reasoningEffort,
    tools: input.tools,
    generateSummary: summaryGenerator,
    auto: input.auto ?? false,
  })

  await recordCompactedHistoryMessage(compactedHistory, input.recordCompactionMessage)
  const boundary = readCompactionBoundary(compactedHistory)
  const sourceMessageCount = selectedTurns.reduce((total, turn) => total + turn.messages.length, 0)
  log.info("session history compacted", {
    sessionID: input.sessionID,
    compactionID: boundary?.compactionID,
    compactedToMessageID: boundary?.compactedToMessageID,
    sourceMessageCount,
    estimatedTokens: estimateMessagesTokens([compactedHistory]),
    auto: input.auto ?? false,
  })

  return {
    status: "compacted",
    compactedMessageID: compactedHistory.info.id,
    compactionID: boundary?.compactionID,
    compactedFromMessageID: boundary?.compactedFromMessageID,
    compactedToMessageID: boundary?.compactedToMessageID,
    sourceMessageCount,
    estimatedTokens: estimateMessagesTokens([compactedHistory]),
    budget: window.budget,
  }
}

function buildPromptWindow(input: {
  system: string[]
  messages: Message.WithParts[]
  model: Provider.Model
  allowTurnDropping?: boolean
}): BuiltPromptWindow {
  const budget = resolvePromptBudget(input.model)
  const compactedHistory = readLatestCompactedHistoryMessage(input.messages)
  const compactedBoundary = compactedHistory
    ? readCompactionBoundary(compactedHistory)?.compactedToMessageID
    : undefined
  const rawMessages = filterRawConversationMessages(input.messages)
  const rawTurns = turnsAfterCompactionBoundary(rawMessages, compactedBoundary)
  let activeTurns = rawTurns
  let activeMessages = flattenTurns(activeTurns)
  let activeCompactedHistory = compactedHistory
  let messages = prependCompactedHistoryMessage(activeMessages, activeCompactedHistory)
  let estimatedTokens = estimatePromptTokens(input.system, messages)

  if (estimatedTokens > budget.hardThreshold) {
    activeMessages = pruneToolOutputsInMessages(activeMessages, PRUNED_TOOL_OUTPUT_CHARS)
    messages = prependCompactedHistoryMessage(activeMessages, activeCompactedHistory)
    estimatedTokens = estimatePromptTokens(input.system, messages)
  }

  if (estimatedTokens > budget.hardThreshold) {
    activeMessages = pruneToolOutputsInMessages(activeMessages, EMERGENCY_TOOL_OUTPUT_CHARS)
    messages = prependCompactedHistoryMessage(activeMessages, activeCompactedHistory)
    estimatedTokens = estimatePromptTokens(input.system, messages)
  }

  if (input.allowTurnDropping !== false && estimatedTokens > budget.hardThreshold && activeTurns.length > 0) {
    const minimumTurnsToKeep = Math.min(MIN_TURNS_TO_KEEP, activeTurns.length)
    while (activeTurns.length > minimumTurnsToKeep && estimatedTokens > budget.hardThreshold) {
      activeTurns = activeTurns.slice(1)
      activeMessages = flattenTurns(activeTurns)
      activeMessages = pruneToolOutputsInMessages(activeMessages, EMERGENCY_TOOL_OUTPUT_CHARS)
      messages = prependCompactedHistoryMessage(activeMessages, activeCompactedHistory)
      estimatedTokens = estimatePromptTokens(input.system, messages)
    }
  }

  if (estimatedTokens > budget.hardThreshold && activeCompactedHistory) {
    activeCompactedHistory = shrinkCompactedHistoryMessage({
      system: input.system,
      messages: activeMessages,
      compactedHistory: activeCompactedHistory,
      budget,
    })
    messages = prependCompactedHistoryMessage(activeMessages, activeCompactedHistory)
    estimatedTokens = estimatePromptTokens(input.system, messages)
  }

  return {
    system: [...input.system],
    messages,
    compactedHistory: activeCompactedHistory,
    estimatedTokens,
    budget,
  }
}

function isInternalUserMessage(message: Message.WithParts) {
  return message.info.role === "user" && message.info.internal === true
}

function readCompactedHistoryTextPart(message: Message.WithParts) {
  return message.parts.find((part): part is Message.TextPart => {
    if (part.type !== "text") return false
    const metadata = part.metadata
    return Boolean(
      metadata &&
        typeof metadata === "object" &&
        !Array.isArray(metadata) &&
        metadata.kind === "compacted-history",
    )
  })
}

function readCompactionBoundary(message: Message.WithParts) {
  return message.parts.find((part): part is Message.CompactionPart => part.type === "compaction")
}

function isCompactedHistoryMessage(message: Message.WithParts) {
  if (!isInternalUserMessage(message)) return false
  return Boolean(readCompactedHistoryTextPart(message) && readCompactionBoundary(message))
}

function isLegacyCompactionAssistantMessage(message: Message.WithParts) {
  return message.info.role === "assistant" && message.parts.some((part) => part.type === "compaction")
}

function readLatestCompactedHistoryMessage(messages: Message.WithParts[]) {
  let latest: Message.WithParts | null = null
  for (const message of messages) {
    if (!isCompactedHistoryMessage(message)) continue
    if (!latest) {
      latest = message
      continue
    }

    const messageCreated = readCompactionBoundary(message)?.createdAt ?? message.info.created
    const latestCreated = readCompactionBoundary(latest)?.createdAt ?? latest.info.created
    if (messageCreated > latestCreated || (messageCreated === latestCreated && message.info.id > latest.info.id)) {
      latest = message
    }
  }

  return latest
}

function filterRawConversationMessages(messages: Message.WithParts[]) {
  return messages.filter(
    (message) => !isInternalUserMessage(message) && !isLegacyCompactionAssistantMessage(message),
  )
}

function prependCompactedHistoryMessage(
  messages: Message.WithParts[],
  compactedHistory: Message.WithParts | null,
) {
  if (!compactedHistory) return messages
  return [compactedHistory, ...messages]
}

function resolvePromptBudget(model: Provider.Model): PromptBudget {
  const contextLimit = positiveInteger(model?.limit?.context) ?? DEFAULT_CONTEXT_LIMIT
  const modelOutputLimit = positiveInteger(model?.limit?.output) ?? DEFAULT_OUTPUT_LIMIT
  const modelInputLimit = positiveInteger(model?.limit?.input)
  const reservedOutputTokens = clamp(
    Math.min(modelOutputLimit, Math.floor(contextLimit * 0.2)),
    RESERVED_OUTPUT_MIN,
    RESERVED_OUTPUT_MAX,
  )

  const inputCap = modelInputLimit ?? Math.max(256, contextLimit - reservedOutputTokens)
  const maxPromptTokens = Math.max(256, Math.min(inputCap, contextLimit - Math.floor(reservedOutputTokens / 2)))
  const hardThreshold = Math.max(128, Math.floor(maxPromptTokens * DEFAULT_HARD_RATIO))
  const softThreshold = Math.max(128, Math.floor(maxPromptTokens * DEFAULT_SOFT_RATIO))

  return {
    maxPromptTokens,
    softThreshold,
    hardThreshold,
    reservedOutputTokens,
    maxCompactionBatchTokens: Math.min(MAX_COMPACTION_BATCH_TOKENS, Math.floor(maxPromptTokens * 0.4)),
  }
}

async function isAutoCompactionEnabled() {
  if (Flag.ANYBOX_DISABLE_AUTOCOMPACT) return false
  const config = await Config.get(Instance.project.id).catch(() => undefined)
  return config?.compaction?.auto !== false
}

async function compactTurns(input: {
  sessionID: string
  existing: Message.WithParts | null
  turns: SessionTurn[]
  system: string[]
  model: Provider.Model
  reasoningEffort?: Message.ReasoningEffort
  tools?: ToolSet
  generateSummary: SummaryGenerator
  auto?: boolean
}) {
  const sourceMessages = [
    ...(input.existing ? [input.existing] : []),
    ...flattenTurns(input.turns),
  ]
  const generatedSummary = await input.generateSummary({
    system: input.system,
    messages: sourceMessages,
    model: input.model,
    reasoningEffort: input.reasoningEffort,
    tools: input.tools,
  })

  const existingBoundary = input.existing ? readCompactionBoundary(input.existing) : undefined
  const compactedFromMessageID = existingBoundary?.compactedFromMessageID ?? input.turns[0]!.userMessageID
  const compactedToMessageID = input.turns[input.turns.length - 1]!.lastMessageID
  const summaryText = normalizeCompactedHistoryBody(generatedSummary) || buildFallbackSummary(sourceMessages)

  return createCompactedHistoryMessage({
    sessionID: input.sessionID,
    model: input.model,
    summaryText,
    compactedFromMessageID,
    compactedToMessageID,
    auto: input.auto ?? true,
  })
}

function createCompactedHistoryMessage(input: {
  sessionID: string
  model: Provider.Model
  summaryText: string
  compactedFromMessageID: string
  compactedToMessageID: string
  auto?: boolean
}): Message.WithParts {
  const createdAt = Date.now()
  const compactionID = Identifier.ascending("compaction")
  const message = Message.User.parse({
    id: Identifier.ascending("message"),
    sessionID: input.sessionID,
    role: "user",
    created: createdAt,
    agent: "compaction",
    internal: true,
    model: {
      providerID: input.model.providerID,
      modelID: input.model.id,
    },
  })

  const text = Message.TextPart.parse({
    id: Identifier.ascending("part"),
    sessionID: input.sessionID,
    messageID: message.id,
    type: "text",
    synthetic: true,
    metadata: {
      kind: "compacted-history",
      compactionID,
      compactedFromMessageID: input.compactedFromMessageID,
      compactedToMessageID: input.compactedToMessageID,
      summaryVersion: CURRENT_SUMMARY_VERSION,
    },
    text: wrapCompactedHistoryText(input.summaryText),
  })

  const marker = Message.CompactionPart.parse({
    id: Identifier.ascending("part"),
    sessionID: input.sessionID,
    messageID: message.id,
    type: "compaction",
    auto: input.auto ?? true,
    compactionID,
    compactedFromMessageID: input.compactedFromMessageID,
    compactedToMessageID: input.compactedToMessageID,
    summaryVersion: CURRENT_SUMMARY_VERSION,
    createdAt,
  })

  return {
    info: message,
    parts: [text, marker],
  }
}

async function recordCompactedHistoryMessage(
  compactedHistory: Message.WithParts,
  recorder?: CompactionMessageRecorder,
) {
  const message = compactedHistory.info
  if (message.role !== "user") {
    throw new Error("Compacted history must be recorded as a user message.")
  }

  if (recorder) {
    await recorder({ message, parts: compactedHistory.parts })
    return
  }

  Session.upsertMessage(message)
  for (const part of compactedHistory.parts) {
    Session.upsertPart(part)
  }
}

async function generateCompactionSummary(input: {
  system: string[]
  messages: Message.WithParts[]
  model: Provider.Model
  reasoningEffort?: Message.ReasoningEffort
  tools?: ToolSet
}) {
  try {
    const languageModel = await ModelRuntime.getLanguage(input.model, Instance.project.id)
    const modelMessages = await Message.toModelMessages(input.messages, input.model)
    const systemPrompt = input.system.join("\n")
    const providerOptions = ProviderTransform.buildProviderOptions({
      model: input.model,
      systemPrompt,
      reasoningEffort: input.reasoningEffort,
    })
    const prompt: ModelMessage[] = [
      ...modelMessages,
      {
        role: "user",
        content: [
          {
            type: "text",
            text: COMPACTION_COMMAND,
          },
        ],
      } as ModelMessage,
    ]

    try {
      const withTools = await callCompactionModel({
        languageModel,
        system: ProviderTransform.isOpenAICodexModel(input.model) ? undefined : systemPrompt || undefined,
        providerOptions,
        prompt,
        tools: input.tools,
        useTools: true,
      })
      if (withTools.trim()) return normalizeCompactedHistoryBody(withTools)
    } catch (toolError) {
      if (!input.tools || Object.keys(input.tools).length === 0) {
        throw toolError
      }

      log.warn("llm compaction with tools failed, retrying without tools", {
        providerID: input.model.providerID,
        modelID: input.model.id,
        error: toolError instanceof Error ? toolError.message : String(toolError),
      })

      const withoutTools = await callCompactionModel({
        languageModel,
        system: ProviderTransform.isOpenAICodexModel(input.model) ? undefined : systemPrompt || undefined,
        providerOptions,
        prompt,
        useTools: false,
      })
      if (withoutTools.trim()) return normalizeCompactedHistoryBody(withoutTools)
    }
  } catch (error) {
    log.warn("llm compaction failed", {
      providerID: input.model.providerID,
      modelID: input.model.id,
      error: error instanceof Error ? error.message : String(error),
    })
  }

  return buildFallbackSummary(input.messages)
}

async function callCompactionModel(input: {
  languageModel: unknown
  system?: string
  providerOptions?: Record<string, unknown>
  prompt: ModelMessage[]
  tools?: ToolSet
  useTools: boolean
}) {
  const settings: Record<string, unknown> = {
    model: input.languageModel,
    temperature: 0,
    system: input.system,
    prompt: input.prompt,
    providerOptions: input.providerOptions,
  }

  if (input.useTools && input.tools && Object.keys(input.tools).length > 0) {
    settings.tools = input.tools
    settings.toolChoice = "none"
  }

  const result = await generateText(settings as any)
  if (hasToolCalls(result)) {
    throw new Error("Compaction model returned tool calls.")
  }

  return result.text.trim()
}

function hasToolCalls(result: unknown) {
  const candidate = result as { toolCalls?: unknown }
  return Array.isArray(candidate.toolCalls) && candidate.toolCalls.length > 0
}

function buildFallbackSummary(messages: Message.WithParts[]) {
  const transcriptExcerpt = renderMessagesForSummary(messages).trim().slice(0, MEMORY_BLOCK_MAX_CHARS)
  return [
    "Continue the active task based on the compacted transcript excerpt below.",
    "",
    "Use the preserved summary plus the latest raw turns as the source of truth. Reconstruct file context from the transcript excerpt when needed.",
    "",
    transcriptExcerpt || "(empty transcript)",
  ].join("\n")
}

function partitionTurns(messages: Message.WithParts[]) {
  const turns: SessionTurn[] = []
  let current: SessionTurn | undefined

  for (const message of messages) {
    if (message.info.role === "user") {
      if (current) turns.push(current)
      current = {
        messages: [message],
        userMessageID: message.info.id,
        lastMessageID: message.info.id,
      }
      continue
    }

    if (!current) continue
    current.messages.push(message)
    current.lastMessageID = message.info.id
  }

  if (current) turns.push(current)
  return turns
}

function turnsAfterCompactionBoundary(messages: Message.WithParts[], compactedToMessageID?: string) {
  const turns = partitionTurns(messages)
  if (!compactedToMessageID) return turns

  const boundaryIndex = turns.findIndex((turn) =>
    turn.messages.some((message) => message.info.id === compactedToMessageID),
  )
  if (boundaryIndex >= 0) return turns.slice(boundaryIndex + 1)

  return turns.filter((turn) => turn.userMessageID > compactedToMessageID)
}

function selectTurnsForCompaction(turns: SessionTurn[], budget: PromptBudget) {
  const compactableCount = Math.max(0, turns.length - RECENT_TURNS_TO_KEEP)
  if (compactableCount === 0) return []

  const compactableTurns = turns.slice(0, compactableCount)
  const selected: SessionTurn[] = []
  let accumulatedTokens = 0

  for (const turn of compactableTurns) {
    const turnTokens = estimateMessagesTokens(turn.messages)
    if (
      selected.length > 0 &&
      accumulatedTokens + turnTokens > budget.maxCompactionBatchTokens
    ) {
      break
    }

    selected.push(turn)
    accumulatedTokens += turnTokens
  }

  return selected.length > 0 ? selected : compactableTurns.slice(0, 1)
}

function flattenTurns(turns: SessionTurn[]) {
  return turns.flatMap((turn) => turn.messages)
}

function renderMessagesForSummary(messages: Message.WithParts[]) {
  return messages.map(renderMessageForSummary).join("\n\n")
}

function renderMessageForSummary(message: Message.WithParts) {
  const role = message.info.role.toUpperCase()
  const parts = message.parts
    .map((part) => renderPartForSummary(part))
    .filter(Boolean)
    .join("\n")

  return `${role} ${message.info.id}\n${parts}`.trim()
}

function renderPartForSummary(part: Message.Part) {
  switch (part.type) {
    case "text":
      return `- text: ${truncateInline(part.text, 800)}`
    case "source-url":
      return `- source: ${part.title ?? part.url}`
    case "source-document":
      return `- source document: ${part.title}${part.filename ? ` (${part.filename})` : ""}`
    case "file":
      return `- file: ${part.filename ?? part.url} (${part.mime})`
    case "image":
      return `- image: ${part.filename ?? part.url} (${part.mime})`
    case "subtask":
      return `- subtask: ${truncateInline(part.description, 400)}`
    case "patch":
      return `- patch: ${part.files.join(", ")}`
    case "tool":
      return renderToolPartForSummary(part)
    case "compaction":
      return ""
    default:
      return ""
  }
}

function renderToolPartForSummary(part: Message.ToolPart) {
  const state = part.state
  const input = truncateInline(safeStringify(state.input), FALLBACK_TOOL_INPUT_CHARS)
  const header = `- tool ${part.tool}${input ? ` input: ${input}` : ""}`

  if (state.status === "completed") {
    return `${header}\n  completed: ${truncateInline(state.output, 1_000)}`
  }
  if (state.status === "error") {
    return `${header}\n  error: ${truncateInline(state.error, 600)}`
  }
  if (state.status === "denied") {
    return `${header}\n  denied: ${truncateInline(state.reason, 300)}`
  }
  if (state.status === "waiting-approval") {
    return `${header}\n  waiting for approval`
  }
  return `${header}\n  pending`
}

function pruneToolOutputsInMessages(messages: Message.WithParts[], maxChars: number) {
  return messages.map((message) => ({
    ...message,
    parts: message.parts.map((part) => prunePartForContext(part, maxChars)),
  }))
}

function prunePartForContext(part: Message.Part, maxChars: number): Message.Part {
  if (part.type !== "tool") return part

  const state = part.state
  if (state.status === "completed") {
    const output = truncateText(state.output, maxChars)
    return {
      ...part,
      state: {
        ...state,
        output,
        modelOutput: undefined,
        metadata: {
          ...(state.metadata ?? {}),
          truncatedForContext: output !== state.output,
        },
      },
    }
  }

  if (state.status === "error") {
    return {
      ...part,
      state: {
        ...state,
        error: truncateText(state.error, maxChars),
      },
    }
  }

  if (state.status === "denied") {
    return {
      ...part,
      state: {
        ...state,
        reason: truncateText(state.reason, maxChars),
      },
    }
  }

  return part
}

function shrinkCompactedHistoryMessage(input: {
  system: string[]
  messages: Message.WithParts[]
  compactedHistory: Message.WithParts
  budget: PromptBudget
}) {
  let body = extractCompactedHistoryBody(input.compactedHistory)
  let compactedHistory = input.compactedHistory
  let messages = prependCompactedHistoryMessage(input.messages, compactedHistory)
  let estimatedTokens = estimatePromptTokens(input.system, messages)

  while (body.length > MEMORY_BLOCK_MIN_CHARS && estimatedTokens > input.budget.hardThreshold) {
    const nextLength = Math.max(MEMORY_BLOCK_MIN_CHARS, Math.floor(body.length * 0.85))
    body = truncateText(body, nextLength)
    compactedHistory = replaceCompactedHistoryBody(compactedHistory, body)
    messages = prependCompactedHistoryMessage(input.messages, compactedHistory)
    estimatedTokens = estimatePromptTokens(input.system, messages)
  }

  return compactedHistory
}

function replaceCompactedHistoryBody(message: Message.WithParts, body: string): Message.WithParts {
  const textPart = readCompactedHistoryTextPart(message)
  if (!textPart) return message

  return {
    ...message,
    parts: message.parts.map((part) =>
      part.id === textPart.id
        ? {
            ...part,
            text: wrapCompactedHistoryText(body),
          }
        : part,
    ),
  }
}

function extractCompactedHistoryBody(message: Message.WithParts) {
  const textPart = readCompactedHistoryTextPart(message)
  if (!textPart) return ""
  return normalizeCompactedHistoryBody(textPart.text)
}

function normalizeCompactedHistoryBody(value: string) {
  const trimmed = value.trim()
  const match = trimmed.match(/^<compacted_history>\s*([\s\S]*?)\s*<\/compacted_history>$/i)
  const body = (match ? match[1] ?? "" : trimmed).trim()
  return body.slice(0, MEMORY_BLOCK_MAX_CHARS * 2)
}

function wrapCompactedHistoryText(summaryText: string) {
  return [
    "<compacted_history>",
    normalizeCompactedHistoryBody(summaryText),
    "</compacted_history>",
  ].join("\n")
}

function estimatePromptTokens(system: string[], messages: Message.WithParts[]) {
  const systemTokens = system.reduce((total, item) => total + estimateStringTokens(item) + 8, 0)
  return systemTokens + estimateMessagesTokens(messages)
}

function estimateMessagesTokens(messages: Message.WithParts[]) {
  return messages.reduce((total, message) => total + estimateMessageTokens(message), 0)
}

function estimateMessageTokens(message: Message.WithParts) {
  const roleOverhead = message.info.role === "assistant" ? 10 : 8
  return roleOverhead + message.parts.reduce((total, part) => total + estimatePartTokens(part), 0)
}

function estimatePartTokens(part: Message.Part): number {
  switch (part.type) {
    case "text":
      if (part.ignored) return 0
      return estimateStringTokens(part.text) + 4
    case "reasoning":
      return 0
    case "source-url":
      return estimateStringTokens(part.title ?? part.url) + 12
    case "source-document":
      return estimateStringTokens(part.title) + estimateStringTokens(part.filename ?? "") + 14
    case "file":
      return 700
    case "image":
      return 900
    case "patch":
      return estimateStringTokens(part.files.join(", ")) + 12
    case "subtask":
      return estimateStringTokens(part.prompt) + estimateStringTokens(part.description) + 12
    case "tool":
      return estimateToolPartTokens(part)
    case "compaction":
      return 0
    default:
      return 6
  }
}

function estimateToolPartTokens(part: Message.ToolPart) {
  const state = part.state
  const inputTokens = estimateStringTokens(safeStringify(state.input))

  switch (state.status) {
    case "completed":
      return inputTokens + estimateStringTokens(state.output) + 24
    case "error":
      return inputTokens + estimateStringTokens(state.error) + 16
    case "denied":
      return inputTokens + estimateStringTokens(state.reason) + 16
    case "waiting-approval":
      return inputTokens + 16
    default:
      return inputTokens + 12
  }
}

function estimateStringTokens(value: string) {
  if (!value) return 0
  return Math.ceil(value.length / 4)
}

function safeStringify(value: unknown) {
  try {
    return JSON.stringify(value) ?? ""
  } catch {
    return String(value)
  }
}

function truncateInline(value: string, maxChars: number) {
  return truncateText(value.replace(/\s+/g, " ").trim(), maxChars)
}

function truncateText(value: string, maxChars: number) {
  if (value.length <= maxChars) return value
  const head = Math.max(64, Math.floor(maxChars * 0.65))
  const tail = Math.max(32, maxChars - head - 24)
  return `${value.slice(0, head)}\n...[truncated]...\n${value.slice(-tail)}`
}

function positiveInteger(value: unknown) {
  if (typeof value !== "number") return undefined
  if (!Number.isFinite(value) || value <= 0) return undefined
  return Math.floor(value)
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}
