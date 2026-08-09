import * as  Log from "#util/log.ts"
import * as Bus from "#bus/project-bus.ts"
import * as LLM from '#session/core/llm.ts';
import * as Message from "#session/core/message.ts"
import * as  Identifier from "#id/id.ts";
import { Instance } from "#project/instance.ts"
import * as Permission from "#permission/permission.ts"
import * as Session from "#session/core/session.ts"
import { Flag } from "#flag/flag.ts"
import { getProcessEnvValue } from "#env/compat.ts"
import type { LanguageModelUsage } from "ai"
import type { TurnContext } from "#session/runtime/orchestrator.ts"
import * as StreamEvents from "#session/runtime/stream-events.ts"
import * as TurnError from "#session/core/turn-error.ts"
import * as ToolResultPersistence from "#session/support/tool-result-persistence.ts"
import {
    createAskUserQuestionMetadataFromInput,
} from "#tool/ask-user-question.ts"
import * as Tool from "#tool/tool.ts"
import { createHash } from "node:crypto"
import { readImageDimensions } from "#session/support/image-assets.ts"
import { ToolCallTurnControlSchema, type ToolCallTurnControl } from "@anybox/shared"

const log = Log.create({ service: "session.processor" })
const ENABLE_STREAM_STDOUT_DEBUG = Flag.ANYBOX_DEBUG_STREAM_STDOUT
const SLOW_FULLSTREAM_CHUNK_HANDLE_MS = 100
const SLOW_FULLSTREAM_CHUNK_WAIT_MS = 10_000

type AssistantOutputDraftPart =
    | Message.TextPart
    | Message.ReasoningPart
    | Message.SourceUrlPart
    | Message.SourceDocumentPart
    | Message.FilePart
    | Message.ImagePart
    | Message.StepStartPart
    | Message.StepFinishPart

function createAssistantOutputDraft() {
    const order: string[] = []
    const parts = new Map<string, AssistantOutputDraftPart>()

    function remember<T extends AssistantOutputDraftPart>(part: T) {
        if (!parts.has(part.id)) {
            order.push(part.id)
        }
        parts.set(part.id, part)
        return part
    }

    function snapshot() {
        return order
            .map((partID) => parts.get(partID))
            .filter((part): part is AssistantOutputDraftPart => Boolean(part))
    }

    function textParts() {
        return snapshot().filter((part): part is Message.TextPart => part.type === "text")
    }

    function reasoningParts() {
        return snapshot().filter((part): part is Message.ReasoningPart => part.type === "reasoning")
    }

    function hasSource(sourceID: string) {
        return snapshot().some(
            (part) =>
                (part.type === "source-url" || part.type === "source-document") &&
                part.sourceID === sourceID,
        )
    }

    function hasFile(url: string) {
        return snapshot().some(
            (part) =>
                (part.type === "file" || part.type === "image") &&
                part.url === url,
        )
    }

    return {
        remember,
        snapshot,
        textParts,
        reasoningParts,
        hasSource,
        hasFile,
    }
}

function normalizeToolError(error: unknown): string {
    if (error instanceof Error && error.message) {
        return error.message
    }

    if (typeof error === "string") {
        return error
    }

    try {
        const serialized = JSON.stringify(error)
        if (serialized) return serialized
    } catch {
        // ignore and fall through to String(error)
    }

    return String(error)
}

function isAbortSignalAborted(signal: AbortSignal | undefined) {
    return signal?.aborted === true
}

function throwIfAborted(signal: AbortSignal | undefined) {
    if (isAbortSignalAborted(signal)) {
        throw new Error("Prompt aborted")
    }
}

function writeStreamDebug(value: string) {
    if (!ENABLE_STREAM_STDOUT_DEBUG) return
    process.stdout.write(value)
}

function isFullStreamChunkProbeEnabled() {
    const value = getProcessEnvValue("ANYBOX_DEBUG_FULLSTREAM_PROBE")?.toLowerCase()
    return Flag.ANYBOX_DEBUG_FULLSTREAM_PROBE || value === "true" || value === "1"
}

type FullStreamProbeValue = { type?: unknown } & Record<string, unknown>

function roundProbeMs(value: number) {
    return Math.round(value * 100) / 100
}

function readProbeString(value: FullStreamProbeValue, key: string) {
    const raw = value[key]
    return typeof raw === "string" && raw.length > 0 ? raw : undefined
}

function summarizeFullStreamProbeValue(value: FullStreamProbeValue) {
    const chunkType = readProbeString(value, "type") ?? "unknown"
    const text =
        readProbeString(value, "text") ??
        readProbeString(value, "delta") ??
        readProbeString(value, "argsTextDelta")
    const toolCallID =
        readProbeString(value, "toolCallId") ??
        readProbeString(value, "id")
    const extra: Record<string, unknown> = {
        chunkType,
    }

    if (text) extra.textLength = text.length
    if (toolCallID) extra.toolCallID = toolCallID
    const toolName = readProbeString(value, "toolName")
    if (toolName) extra.toolName = toolName
    const finishReason = readProbeString(value, "finishReason")
    if (finishReason) extra.finishReason = finishReason

    return extra
}

function deferSideEffect(action: () => PromiseLike<unknown> | unknown) {
    return new Promise<void>((resolve, reject) => {
        setTimeout(() => {
            Promise.resolve()
                .then(action)
                .then(
                    () => resolve(),
                    (error) => reject(error),
                )
        }, 0)
    })
}

function hasProjectBusContext() {
    try {
        void Instance.directory
        return true
    } catch {
        return false
    }
}

function applyUsageToAssistantMessage(
    message: Message.Assistant,
    usage: LanguageModelUsage | undefined,
    inputMode: "replace" | "peak" | "preserve" = "replace",
) {
    if (!usage) {
        return
    }

    const measuredInputTokens = usage.inputTokens ?? message.tokens.input
    let nextInputTokens = measuredInputTokens

    if (inputMode === "peak") {
        nextInputTokens = Math.max(message.tokens.input, measuredInputTokens)
    } else if (inputMode === "preserve" && message.tokens.input > 0) {
        nextInputTokens = message.tokens.input
    }

    message.tokens = {
        input: nextInputTokens,
        output: usage.outputTokens ?? message.tokens.output,
        reasoning:
            usage.outputTokenDetails?.reasoningTokens ??
            message.tokens.reasoning,
        cache: {
            read:
                usage.inputTokenDetails?.cacheReadTokens ??
                message.tokens.cache.read,
            write:
                usage.inputTokenDetails?.cacheWriteTokens ??
                message.tokens.cache.write,
        },
    }
}

function summarizeLlmUsage(usage: LanguageModelUsage | undefined) {
    if (!usage) {
        return undefined
    }

    return {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        reasoningTokens: usage.outputTokenDetails?.reasoningTokens,
        cacheReadTokens: usage.inputTokenDetails?.cacheReadTokens,
        cacheWriteTokens: usage.inputTokenDetails?.cacheWriteTokens,
    }
}

function readToolRaw(part: Message.ToolPart | undefined) {
    return part?.input.raw ?? ""
}

function serializeToolInput(value: unknown) {
    if (typeof value === "string") return value

    try {
        const serialized = JSON.stringify(value)
        if (serialized) return serialized
    } catch {
        // ignore and fall through to String(value)
    }

    return value === undefined ? "" : String(value)
}

function normalizeToolInput(
    value: unknown,
    fallbackRaw = "",
): { input: Record<string, unknown>; raw: string } {
    if (value && typeof value === "object" && !Array.isArray(value)) {
        return {
            input: value as Record<string, unknown>,
            raw: fallbackRaw,
        }
    }

    const raw = serializeToolInput(value) || fallbackRaw
    if (typeof value === "string") {
        try {
            const parsed = JSON.parse(value)
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                return {
                    input: parsed as Record<string, unknown>,
                    raw,
                }
            }
        } catch {
            // Keep the raw value for diagnostics, but store a schema-safe input.
        }
    }

    return {
        input: {},
        raw,
    }
}

function normalizeToolArgumentFailureMessage(message: string) {
    return `Tool argument validation failed: ${message}`
}

function isToolArgumentShapeError(message: string) {
    const normalized = message.toLowerCase()
    return (
        normalized.includes("expected record") ||
        normalized.includes("received string") ||
        normalized.includes("expected object") ||
        normalized.includes("invalid input") ||
        normalized.includes("invalid arguments") ||
        normalized.includes("tool argument") ||
        normalized.includes("tool input") ||
        (
            normalized.includes("schema") &&
            (normalized.includes("tool") || normalized.includes("argument") || normalized.includes("input"))
        )
    )
}

function buildStepTokens(usage: LanguageModelUsage | undefined) {
    return {
        input: usage?.inputTokens ?? 0,
        output: usage?.outputTokens ?? 0,
        reasoning: usage?.outputTokenDetails?.reasoningTokens ?? 0,
        cache: {
            read: usage?.inputTokenDetails?.cacheReadTokens ?? 0,
            write: usage?.inputTokenDetails?.cacheWriteTokens ?? 0,
        },
    }
}

function inlineImageBytes(value: unknown): Uint8Array | undefined {
    if (value instanceof Uint8Array) return value
    if (value instanceof ArrayBuffer) return new Uint8Array(value)
    if (typeof value !== "string" || !value.startsWith("data:")) return undefined

    const comma = value.indexOf(",")
    if (comma < 0) return undefined
    try {
        const header = value.slice(0, comma).toLowerCase()
        const body = value.slice(comma + 1)
        return header.includes(";base64")
            ? new Uint8Array(Buffer.from(body, "base64"))
            : new TextEncoder().encode(decodeURIComponent(body))
    } catch {
        return undefined
    }
}

function summarizeImageForTrace(input: {
    location: "top-level" | "tool-result"
    mime: string
    data: unknown
    sourceTool?: string
}) {
    const bytes = inlineImageBytes(input.data)
    const dimensions = bytes ? readImageDimensions(bytes, input.mime) : {}
    return {
        location: input.location,
        mime: input.mime,
        ...(bytes ? {
            bytes: bytes.byteLength,
            sha256: createHash("sha256").update(bytes).digest("hex"),
        } : {}),
        ...dimensions,
        ...(input.sourceTool ? { sourceTool: input.sourceTool } : {}),
    }
}

function summarizeLlmCallInput(streamInput: LLM.StreamInput) {
    let hasAttachments = false
    const images: Array<ReturnType<typeof summarizeImageForTrace>> = []

    for (const message of streamInput.messages) {
        if (!Array.isArray(message.content)) continue
        for (const part of message.content) {
            if (part.type === "image") {
                hasAttachments = true
                images.push(summarizeImageForTrace({
                    location: "top-level",
                    mime: part.mediaType ?? "image/unknown",
                    data: part.image,
                }))
                continue
            }

            if (part.type === "file") {
                hasAttachments = true
                if (part.mediaType.toLowerCase().startsWith("image/")) {
                    images.push(summarizeImageForTrace({
                        location: "top-level",
                        mime: part.mediaType,
                        data: part.data,
                    }))
                }
                continue
            }

            if (part.type !== "tool-result") continue
            const output = part.output
            if (!output || output.type !== "content") continue
            for (const content of output.value) {
                if (content.type !== "file" || !content.mediaType.toLowerCase().startsWith("image/")) continue
                hasAttachments = true
                images.push(summarizeImageForTrace({
                    location: "tool-result",
                    mime: content.mediaType,
                    data: content.data.type === "data" ? content.data.data : undefined,
                    sourceTool: part.toolName,
                }))
            }
        }
    }

    const topLevelImageParts = images.filter((image) => image.location === "top-level").length
    const toolResultImageParts = images.filter((image) => image.location === "tool-result").length
    const totalImageBytes = images.reduce((total, image) => total + (image.bytes ?? 0), 0)

    const requestedToolCount = (
        streamInput.activeTools ??
        Object.keys(streamInput.tools ?? {})
    ).filter((toolName) => toolName !== "invalid" && Boolean(streamInput.tools?.[toolName])).length
    const supportsToolCalls = streamInput.model.capabilities?.toolcall !== false
    const toolsDisabledReason: "model_does_not_support_toolcall" | undefined =
        !supportsToolCalls && requestedToolCount > 0
            ? "model_does_not_support_toolcall"
            : undefined

    return {
        messageCount: streamInput.messages.length,
        toolCount: toolsDisabledReason ? 0 : requestedToolCount,
        requestedToolCount,
        toolsDisabledReason,
        hasAttachments,
        topLevelImageParts,
        toolResultImageParts,
        totalImageBytes,
        images,
    }
}

function toAttachmentPart(
    value: unknown,
    toolPart: Message.ToolPart,
): Message.AttachmentPart | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return undefined
    }

    const candidate = value as Record<string, unknown>
    if (typeof candidate.url !== "string" || typeof candidate.mime !== "string") {
        return undefined
    }
    const metadata = candidate.metadata && typeof candidate.metadata === "object" && !Array.isArray(candidate.metadata)
        ? candidate.metadata as Record<string, unknown>
        : undefined
    const width = typeof candidate.width === "number"
        ? candidate.width
        : typeof metadata?.width === "number"
            ? metadata.width
            : undefined
    const height = typeof candidate.height === "number"
        ? candidate.height
        : typeof metadata?.height === "number"
            ? metadata.height
            : undefined

    const base = {
        id: Identifier.ascending("part"),
        sessionID: toolPart.sessionID,
        messageID: toolPart.messageID,
        url: candidate.url,
        mime: candidate.mime,
        filename: typeof candidate.filename === "string" ? candidate.filename : undefined,
        metadata,
    }

    if (candidate.mime.toLowerCase().startsWith("image/")) {
        return {
            ...base,
            type: "image",
            width,
            height,
        }
    }

    return {
        type: "file",
        ...base,
    }
}

async function toGeneratedFilePart(
    value: unknown,
    assistant: Message.Assistant,
): Promise<Message.FilePart | Message.ImagePart | undefined> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return undefined
    }

    const candidate = value as Record<string, unknown>
    const mime =
        typeof candidate.mediaType === "string"
            ? candidate.mediaType
            : typeof candidate.mime === "string"
                ? candidate.mime
                : ""
    const base64 =
        typeof candidate.base64 === "string"
            ? candidate.base64
            : candidate.uint8Array instanceof Uint8Array
                ? Buffer.from(candidate.uint8Array).toString("base64")
                : ""
    const url =
        typeof candidate.url === "string"
            ? candidate.url
            : mime && base64
                ? `data:${mime};base64,${base64}`
                : ""

    if (!mime || !url) {
        return undefined
    }

    const id = Identifier.ascending("part")
    const filename = typeof candidate.filename === "string" ? candidate.filename : undefined
    const providerMetadata = candidate.providerMetadata && typeof candidate.providerMetadata === "object" && !Array.isArray(candidate.providerMetadata)
        ? candidate.providerMetadata as Record<string, unknown>
        : {}
    const processed = await ToolResultPersistence.maybePersistToolResult({
        sessionID: assistant.sessionID,
        toolCallID: id,
        toolName: "generated-file",
        output: filename ? `Generated file: ${filename}` : "Generated file attachment",
        metadata: providerMetadata,
        modelOutput: undefined,
        attachments: [{ url, mime, filename }],
        rawResult: { attachments: [{ url, mime, filename }] },
        maxResultSizeChars: Infinity,
    })
    const resolvedUrl = processed.attachments?.[0]?.url ?? url
    const base = {
        id,
        sessionID: assistant.sessionID,
        messageID: assistant.id,
        mime,
        url: resolvedUrl,
        filename,
        metadata: Object.keys(processed.metadata).length > 0 ? processed.metadata : undefined,
    }

    if (mime.startsWith("image/")) {
        return {
            ...base,
            type: "image",
        }
    }

    return {
        ...base,
        type: "file",
    }
}

function toSourcePart(
    value: unknown,
    assistant: Message.Assistant,
): Message.SourceUrlPart | Message.SourceDocumentPart | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return undefined
    }

    const candidate = value as Record<string, unknown>
    const sourceID =
        typeof candidate.sourceId === "string"
            ? candidate.sourceId
            : typeof candidate.id === "string"
                ? candidate.id
                : ""
    const providerMetadata =
        candidate.providerMetadata && typeof candidate.providerMetadata === "object" && !Array.isArray(candidate.providerMetadata)
            ? candidate.providerMetadata as Record<string, unknown>
            : undefined

    if (!sourceID) {
        return undefined
    }

    if (
        candidate.type === "source-url" ||
        candidate.sourceType === "url" ||
        typeof candidate.url === "string"
    ) {
        if (typeof candidate.url !== "string") {
            return undefined
        }

        return {
            id: Identifier.ascending("part"),
            sessionID: assistant.sessionID,
            messageID: assistant.id,
            type: "source-url",
            sourceID,
            url: candidate.url,
            title: typeof candidate.title === "string" ? candidate.title : undefined,
            providerMetadata,
        }
    }

    if (
        candidate.type === "source-document" ||
        candidate.sourceType === "document" ||
        typeof candidate.mediaType === "string"
    ) {
        if (typeof candidate.mediaType !== "string" || typeof candidate.title !== "string") {
            return undefined
        }

        return {
            id: Identifier.ascending("part"),
            sessionID: assistant.sessionID,
            messageID: assistant.id,
            type: "source-document",
            sourceID,
            mediaType: candidate.mediaType,
            title: candidate.title,
            filename: typeof candidate.filename === "string" ? candidate.filename : undefined,
            providerMetadata,
        }
    }

    return undefined
}

async function applyFinalStreamResultToDraft(
    draft: ReturnType<typeof createAssistantOutputDraft>,
    event: unknown,
    assistant: Message.Assistant,
) {
    if (!isRecord(event)) {
        return
    }

    const textParts = draft.textParts()
    if (typeof event.text === "string") {
        if (textParts.length === 1) {
            const textPart = textParts[0]
            if (!textPart) return
            textPart.text = event.text.trimEnd()
            textPart.time = {
                ...(textPart.time ?? { start: Date.now() }),
                end: textPart.time?.end ?? Date.now(),
            }
        } else if (textParts.length === 0 && event.text.length > 0) {
            draft.remember({
                id: Identifier.ascending("part"),
                sessionID: assistant.sessionID,
                messageID: assistant.id,
                type: "text",
                text: event.text.trimEnd(),
                time: {
                    start: Date.now(),
                    end: Date.now(),
                },
            })
        }
    }

    const reasoningParts = draft.reasoningParts()
    const reasoning = Array.isArray(event.reasoning) ? event.reasoning : []
    if (reasoning.length > 0) {
        reasoning.forEach((item, index) => {
            if (!isRecord(item) || typeof item.text !== "string") {
                return
            }

            const existing = reasoningParts[index]
            if (existing) {
                existing.text = item.text.trimEnd()
                existing.time = {
                    ...existing.time,
                    end: existing.time.end ?? Date.now(),
                }
                if (isRecord(item.providerMetadata)) {
                    existing.metadata = item.providerMetadata
                }
                return
            }

            draft.remember({
                id: Identifier.ascending("part"),
                sessionID: assistant.sessionID,
                messageID: assistant.id,
                type: "reasoning",
                text: item.text.trimEnd(),
                time: {
                    start: Date.now(),
                    end: Date.now(),
                },
                metadata: isRecord(item.providerMetadata) ? item.providerMetadata : undefined,
            })
        })
    } else if (typeof event.reasoningText === "string" && event.reasoningText.length > 0 && reasoningParts.length === 0) {
        draft.remember({
            id: Identifier.ascending("part"),
            sessionID: assistant.sessionID,
            messageID: assistant.id,
            type: "reasoning",
            text: event.reasoningText.trimEnd(),
            time: {
                start: Date.now(),
                end: Date.now(),
            },
        })
    }

    if (Array.isArray(event.sources)) {
        for (const source of event.sources) {
            if (!isRecord(source)) {
                continue
            }
            const sourceID =
                typeof source.id === "string"
                    ? source.id
                    : typeof source.sourceId === "string"
                        ? source.sourceId
                        : ""
            if (sourceID && draft.hasSource(sourceID)) {
                continue
            }

            const sourcePart = toSourcePart(source, assistant)
            if (sourcePart) {
                draft.remember(sourcePart)
            }
        }
    }

    if (Array.isArray(event.files)) {
        for (const file of event.files) {
            const filePart = await toGeneratedFilePart(file, assistant)
            if (filePart && draft.hasFile(filePart.url)) {
                continue
            }
            if (filePart) {
                draft.remember(filePart)
            }
        }
    }
}

async function extractToolResultState(
    output: unknown,
    fallbackTitle?: string,
    fallbackMetadata?: Record<string, unknown>,
    toolPart?: Message.ToolPart,
) {
    let text = Message.normalizeToolOutputText(output)
    let title = typeof fallbackTitle === "string" ? fallbackTitle : ""
    let metadata = fallbackMetadata ?? {}
    let data: unknown
    let toolAttachments: Tool.ToolAttachment[] | undefined
    let attachments: Message.AttachmentPart[] | undefined
    let result: "success" | "negative" | undefined
    let completeness: "complete" | "partial" | undefined
    let sideEffect: "none" | "possible" | "confirmed" | "unknown" | undefined
    let retry: "safe" | "unsafe" | "unknown" | undefined
    let control: ToolCallTurnControl | undefined

    if (output && typeof output === "object" && !Array.isArray(output)) {
        const candidate = output as Record<string, unknown>

        if (typeof candidate.text === "string") {
            text = candidate.text
        }

        if (typeof candidate.title === "string") {
            title = candidate.title
        }

        if (candidate.metadata && typeof candidate.metadata === "object" && !Array.isArray(candidate.metadata)) {
            metadata = {
                ...metadata,
                ...candidate.metadata as Record<string, unknown>,
            }
        }

        data = candidate.data
        result = candidate.result === "success" || candidate.result === "negative"
            ? candidate.result
            : undefined
        completeness = candidate.completeness === "complete" || candidate.completeness === "partial"
            ? candidate.completeness
            : undefined
        sideEffect = ["none", "possible", "confirmed", "unknown"].includes(String(candidate.sideEffect))
            ? candidate.sideEffect as typeof sideEffect
            : undefined
        retry = ["safe", "unsafe", "unknown"].includes(String(candidate.retry))
            ? candidate.retry as typeof retry
            : undefined
        control = ToolCallTurnControlSchema.safeParse(candidate.control).data
        if (Array.isArray(candidate.attachments)) {
            toolAttachments = candidate.attachments
                .filter((attachment): attachment is Tool.ToolAttachment => Boolean(
                    attachment &&
                    typeof attachment === "object" &&
                    !Array.isArray(attachment) &&
                    typeof (attachment as Record<string, unknown>).url === "string" &&
                    typeof (attachment as Record<string, unknown>).mime === "string",
                ))
        }
    }

    const alreadyPersisted = ToolResultPersistence.readPersistedOutputMetadata(metadata)
    if (alreadyPersisted) {
        if (toolPart && toolAttachments) {
            const mapped = toolAttachments
                .map((attachment) => toAttachmentPart(attachment, toolPart))
                .filter((attachment): attachment is Message.AttachmentPart => Boolean(attachment))
            attachments = mapped.length > 0 ? mapped : undefined
        }
        return {
            output: text,
            title,
            metadata,
            attachments,
            modelOutput: undefined,
            result,
            completeness,
            sideEffect,
            retry,
            control,
        }
    }

    const processed = toolPart
        ? await ToolResultPersistence.maybePersistToolResult({
            sessionID: toolPart.sessionID,
            toolCallID: toolPart.callID,
            toolName: toolPart.tool,
            output: text,
            metadata,
            modelOutput: output,
            data,
            attachments: toolAttachments,
            rawResult: output,
        })
        : {
            output: text,
            metadata,
            modelOutput: output,
            data,
            attachments: toolAttachments,
        }

    if (toolPart && processed.attachments) {
        const mapped = processed.attachments
            .map((attachment) => toAttachmentPart(attachment, toolPart))
            .filter((attachment): attachment is Message.AttachmentPart => Boolean(attachment))
        attachments = mapped.length > 0 ? mapped : undefined
    }

    return {
        output: processed.output,
        title,
        metadata: processed.metadata,
        attachments,
        modelOutput: processed.modelOutput,
        result,
        completeness,
        sideEffect,
        retry,
        control,
    }
}

function structuredToolOutcome(
    normalized: Awaited<ReturnType<typeof extractToolResultState>>,
    capabilities?: Tool.ToolCapabilities,
) {
    return Tool.returnedToolOutcome({
        text: normalized.output,
        title: normalized.title,
        metadata: normalized.metadata,
        result: normalized.result ?? "success",
        completeness: normalized.completeness ?? "complete",
        sideEffect: normalized.sideEffect,
        retry: normalized.retry,
    }, {
        capabilities,
        modelOutput: normalized.modelOutput,
        attachments: normalized.attachments,
    })
}

function isAskUserQuestionToolName(toolName: string | undefined) {
    if (!toolName) return false
    return ["ask_user_question", "question"].includes(Tool.toModelToolName(toolName))
}

type FinalToolResultCandidate = {
    toolCallId: string
    toolName?: string
    input?: unknown
    output?: unknown
    result?: unknown
    title?: string
    providerMetadata?: Record<string, unknown>
    providerExecuted?: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
}

function toToolResultCandidate(
    value: unknown,
    options?: {
        unwrapOutput?: boolean
    },
): FinalToolResultCandidate | undefined {
    if (!isRecord(value) || value.type !== "tool-result" || typeof value.toolCallId !== "string") {
        return undefined
    }

    const output =
        options?.unwrapOutput === true
            ? unwrapFinalToolOutput(value.output)
            : value.output

    const providerMetadata = isRecord(value.providerMetadata) ? value.providerMetadata : undefined

    return {
        toolCallId: value.toolCallId,
        toolName: typeof value.toolName === "string" ? value.toolName : undefined,
        input: "input" in value ? value.input : undefined,
        output,
        result: value.result,
        title: typeof value.title === "string" ? value.title : undefined,
        providerMetadata,
        providerExecuted: value.providerExecuted === true ? true : undefined,
    }
}

function unwrapFinalToolOutput(output: unknown): unknown {
    if (!isRecord(output) || typeof output.type !== "string") {
        return output
    }

    if (
        output.type === "json" ||
        output.type === "error-json" ||
        output.type === "text" ||
        output.type === "error-text"
    ) {
        return "value" in output ? output.value : output
    }

    if (output.type === "execution-denied") {
        return {
            reason: typeof output.reason === "string" ? output.reason : "Tool execution was denied.",
        }
    }

    return output
}

function collectStepToolResultCandidates(steps: unknown): FinalToolResultCandidate[] {
    if (!Array.isArray(steps)) {
        return []
    }

    const results: FinalToolResultCandidate[] = []
    for (const step of steps) {
        if (!isRecord(step) || !Array.isArray(step.content)) {
            continue
        }

        for (const item of step.content) {
            const candidate = toToolResultCandidate(item)
            if (candidate) {
                results.push(candidate)
            }
        }
    }

    return results
}

function collectResponseToolResultCandidates(response: unknown): FinalToolResultCandidate[] {
    if (!isRecord(response) || !Array.isArray(response.messages)) {
        return []
    }

    const results: FinalToolResultCandidate[] = []
    for (const message of response.messages) {
        if (!isRecord(message) || !Array.isArray(message.content)) {
            continue
        }

        for (const item of message.content) {
            const candidate = toToolResultCandidate(item, { unwrapOutput: true })
            if (candidate) {
                results.push(candidate)
            }
        }
    }

    return results
}

/**
 * create a processor (handle single LLM prompt, not loop)
 * Handles both the LLM stream output and the tool execution process.
 * @param input 
 * @returns 
 */
export function create(input: {
    Assistant: Message.Assistant
    abort?: AbortSignal
    turn?: TurnContext
    toolSources?: Readonly<Record<string, Tool.ToolSource>>
}) {
    const canonicalTurnID = input.turn?.turnID ?? input.Assistant.turnID
    if (!canonicalTurnID) {
        throw new Error("ToolCall v3 requires a canonical turn ID before stream processing starts.")
    }
    const toolcalls: Record<string, Message.ToolPart> = {}
    let snapshot: string | undefined
    let blocked = false
    let restartLoop = false
    let requestedTurnControl: ToolCallTurnControl | undefined
    let attempt = 0
    let needsCompaction = false
    const toolTurnControlPriority: Record<ToolCallTurnControl["mode"], number> = {
        "continue-model": 0,
        "restart-loop": 1,
        "finish-turn": 2,
        "wait-user": 3,
        "fail-turn": 4,
        "cancel-turn": 5,
    }
    const requestToolTurnControl = (control: ToolCallTurnControl) => {
        if (
            !requestedTurnControl ||
            toolTurnControlPriority[control.mode] > toolTurnControlPriority[requestedTurnControl.mode]
        ) {
            requestedTurnControl = control
        }

        if (control.mode === "wait-user") blocked = true
        if (control.mode === "restart-loop") restartLoop = true
    }
    const requestSettledToolTurnControl = (part: Message.ToolPart) => {
        if (part.state.phase !== "settled") {
            throw new Error(`Tool '${part.callID}' did not enter the settled phase.`)
        }
        requestToolTurnControl(part.state.control)
    }
    const emitRuntimeEvent = input.turn?.emit.bind(input.turn)
    const emitStreamRuntimeEvent = input.turn?.emitStream?.bind(input.turn) ?? emitRuntimeEvent
    const emittedCanonicalPartIDs = new Set<string>()
    let currentPhase: string | undefined
    const toolCallSource = (
        providerExecuted = false,
        metadata?: Record<string, unknown>,
    ) => ({
        kind: providerExecuted ? "provider" as const : "model" as const,
        providerID: input.Assistant.providerID,
        modelID: input.Assistant.modelID,
        metadata,
    })
    const createPendingToolCall = (value: {
        id?: string
        callID: string
        tool: string
        input?: Record<string, unknown>
        raw?: string
        providerExecuted?: boolean
        providerMetadata?: Record<string, unknown>
        createdAt?: number
    }) => Message.createToolPart({
        id: value.id ?? Identifier.ascending("part"),
        sessionID: input.Assistant.sessionID,
        turnID: canonicalTurnID,
        messageID: input.Assistant.id,
        executionID: input.turn?.executionID,
        callID: value.callID,
        tool: value.tool,
        input: value.input ?? {},
        raw: value.raw ?? "",
        source: toolCallSource(value.providerExecuted, value.providerMetadata),
        createdAt: value.createdAt,
    })
    const metadataWithToolSource = (
        toolName: string,
        ...metadataValues: Array<Record<string, unknown> | undefined>
    ) => {
        const metadata = Object.assign({}, ...metadataValues.filter(Boolean)) as Record<string, unknown>
        const source = input.toolSources?.[toolName]
        if (source) {
            metadata.toolSource = {
                kind: source.kind,
                id: source.id,
                moduleID: source.moduleID,
                name: source.name,
                description: source.description,
                provider: source.provider,
            }
        }
        return Object.keys(metadata).length > 0 ? metadata : undefined
    }
    const persistPart = async (part: Message.Part) => {
        if (emitRuntimeEvent) {
            return
        }

        await Session.updatePart(part)
    }
    const emitCanonicalPartRecorded = (part: Message.Part) => {
        if (!emitRuntimeEvent) {
            return false
        }

        if (emittedCanonicalPartIDs.has(part.id)) {
            return true
        }

        emittedCanonicalPartIDs.add(part.id)
        emitRuntimeEvent("part.recorded", { part })
        return true
    }
    const persistCanonicalPart = async (part: Message.Part) => {
        if (emitCanonicalPartRecorded(part)) {
            return
        }

        await Session.updatePart(part)
    }
    const persistAssistantMessage = async () => {
        if (emitRuntimeEvent) {
            emitRuntimeEvent("message.recorded", { message: input.Assistant })
            return
        }

        await Session.recordActiveMessage(input.Assistant)
    }

    const emitRuntimePhase = (
        phase: "waiting_llm" | "reasoning" | "executing_tool" | "waiting_approval" | "responding" | "retrying",
        payload?: {
            reason?: string
            toolCallID?: string
            toolName?: string
            iteration?: number
        },
    ) => {
        if (!emitRuntimeEvent || currentPhase === phase) {
            return
        }

        currentPhase = phase
        emitRuntimeEvent("turn.state.changed", {
            phase,
            reason: payload?.reason,
            messageID: input.Assistant.id,
            toolCallID: payload?.toolCallID,
            toolName: payload?.toolName,
            iteration: payload?.iteration,
        })
    }

    const result = {
        get message() {
            return input.Assistant
        },
        get turnControl() {
            return requestedTurnControl
        },
        partFromToolCall(toolCallID: string) {
            return toolcalls[toolCallID]
        },
        async process(streamInput: LLM.StreamInput) {
            const pendingStreamSideEffects = new Set<Promise<void>>()
            const busAvailable = hasProjectBusContext()
            const unsubscribeStreamSideEffects: Array<() => void> = []

            const trackStreamSideEffect = (promise: Promise<void>) => {
                let tracked: Promise<void>
                tracked = promise.finally(() => {
                    pendingStreamSideEffects.delete(tracked)
                })
                pendingStreamSideEffects.add(tracked)
                return tracked
            }

            const flushStreamSideEffects = async () => {
                while (pendingStreamSideEffects.size > 0) {
                    await Promise.all([...pendingStreamSideEffects])
                }
            }

            const publishStreamChunk = (value: { type?: unknown } & Record<string, unknown>) => {
                if (!busAvailable) return

                Bus.publishDetached(
                    StreamEvents.Event.ChunkReceived,
                    {
                        sessionID: input.Assistant.sessionID,
                        turnID: input.turn?.turnID,
                        messageID: input.Assistant.id,
                        iteration: attempt,
                        chunkType: typeof value.type === "string" ? value.type : "unknown",
                        chunk: value,
                    },
                    { silent: true, global: false },
                )
            }

            const requestPartPersistence = (part: Message.Part) => {
                const persist = () => persistPart(part)
                if (!busAvailable) {
                    trackStreamSideEffect(deferSideEffect(persist))
                    return
                }

                trackStreamSideEffect(
                    Bus.publishDeferred(
                        StreamEvents.Event.PartPersistenceRequested,
                        {
                            sessionID: input.Assistant.sessionID,
                            messageID: input.Assistant.id,
                            part,
                        },
                        { silent: true, global: false },
                    ),
                )
            }

            const requestToolApprovalRegistration = (toolPart: Message.ToolPart) => {
                const register = () =>
                    Permission.registerApprovalRequest({
                        assistant: {
                            ...input.Assistant,
                            path: {
                                cwd: input.Assistant.path.cwd || Instance.directory,
                                root: input.Assistant.path.root || Instance.worktree,
                            },
                        },
                        toolPart,
                        turn: input.turn,
                    })

                if (!busAvailable) {
                    trackStreamSideEffect(deferSideEffect(register))
                    return
                }

                trackStreamSideEffect(
                    Bus.publishDeferred(
                        StreamEvents.Event.ToolApprovalRegistrationRequested,
                        {
                            sessionID: input.Assistant.sessionID,
                            messageID: input.Assistant.id,
                            assistant: input.Assistant,
                            toolPart,
                            turn: input.turn,
                        },
                        { silent: true, global: false },
                    ),
                )
            }

            const flushPendingToolInput = (toolCallID: string, options?: { emitDelta?: boolean }) => {
                const current = toolcalls[toolCallID]
                const pendingState = Message.ToolStatePending.safeParse(current?.state)

                if (!current || !pendingState.success) {
                    return current
                }

                if (!current.input.raw || current.input.value !== undefined) {
                    return current
                }
                if (!options?.emitDelta) return current

                const normalizedInput = normalizeToolInput(current.input.raw, current.input.raw)
                const pendingPart = Message.appendToolPartInput(current, {
                    delta: "",
                    value: normalizedInput.input,
                })

                toolcalls[toolCallID] = pendingPart
                emitRuntimeEvent?.("tool.call.input_delta", {
                    part: pendingPart,
                    messageID: pendingPart.messageID,
                    partID: pendingPart.id,
                    toolCallID: pendingPart.callID,
                    toolName: pendingPart.tool,
                    delta: "",
                    rawLength: pendingPart.input.raw.length,
                    metadata: pendingPart.presentation?.metadata,
                })

                return pendingPart
            }

            if (busAvailable) {
                unsubscribeStreamSideEffects.push(
                    Bus.subscribe(StreamEvents.Event.PartPersistenceRequested, async (event) => {
                        if (event.properties.sessionID !== input.Assistant.sessionID) return
                        if (event.properties.messageID !== input.Assistant.id) return
                        await persistPart(event.properties.part)
                    }),
                    Bus.subscribe(StreamEvents.Event.ToolApprovalRegistrationRequested, async (event) => {
                        if (event.properties.sessionID !== input.Assistant.sessionID) return
                        if (event.properties.messageID !== input.Assistant.id) return
                        await Permission.registerApprovalRequest({
                            assistant: {
                                ...event.properties.assistant,
                                path: {
                                    cwd: event.properties.assistant.path.cwd || Instance.directory,
                                    root: event.properties.assistant.path.root || Instance.worktree,
                                },
                            },
                            toolPart: event.properties.toolPart,
                            turn: event.properties.turn,
                        })
                    }),
                )
            }

            try {
            const settleOpenToolCalls = async (
                reason: string,
                kind: "failed" | "cancelled" = "failed",
            ) => {
                const end = Date.now()

                for (const [toolCallID, original] of Object.entries(toolcalls)) {
                    const current = flushPendingToolInput(toolCallID) ?? original
                    if (current.state.phase === "settled" || current.state.phase === "waiting-approval") {
                        continue
                    }

                    const metadata = Message.toolPartMetadata(current) ?? {}
                    const execution = Tool.toolExecutionSemantics(undefined)
                    const settled = Message.settleToolPart(
                        current,
                        kind === "cancelled"
                            ? {
                                kind: "cancelled",
                                reason,
                                by: "framework",
                                metadata,
                                execution,
                            }
                            : {
                                kind: "failed",
                                error: Tool.toolFailure(reason, {
                                    stage: "internal",
                                    source: "runtime",
                                    code: "TOOL_CALL_INTERRUPTED",
                                    handlerExecuted: current.state.phase === "running",
                                    severity: "turn-fatal",
                                }),
                                metadata,
                                execution,
                            },
                        { mode: kind === "cancelled" ? "cancel-turn" : "fail-turn", reason },
                        { timestamp: end },
                    )
                    requestSettledToolTurnControl(settled)

                    toolcalls[toolCallID] = settled
                    emitRuntimeEvent?.("tool.call.settled", {
                        part: settled,
                    })
                    await persistPart(settled)
                }
            }

            const failOpenToolCalls = (reason: string) => settleOpenToolCalls(reason, "failed")
            const cancelOpenToolCalls = (reason: string) => settleOpenToolCalls(reason, "cancelled")

            const settleToolArgumentFailures = async (reason: string) => {
                const end = Date.now()

                for (const [toolCallID, original] of Object.entries(toolcalls)) {
                    const current = flushPendingToolInput(toolCallID) ?? original
                    if (current.state.phase !== "pending" && current.state.phase !== "running") continue

                    const metadata = Message.toolPartMetadata(current) ?? {}
                    const execution = Tool.toolExecutionSemantics(undefined, {
                        sideEffect: current.state.phase === "pending" ? "none" : "possible",
                        retry: current.state.phase === "pending" ? "safe" : "unknown",
                    })
                    const outcome = current.state.phase === "pending"
                        ? {
                            kind: "blocked" as const,
                            reason,
                            code: "TOOL_INPUT_VALIDATION_BLOCKED",
                            metadata,
                            execution,
                        }
                        : {
                            kind: "failed" as const,
                            error: Tool.toolFailure(reason, {
                                stage: "validation",
                                source: "model",
                                code: "TOOL_INPUT_VALIDATION_INTERRUPTED",
                                handlerExecuted: true,
                                severity: "recoverable",
                            }),
                            metadata,
                            execution,
                        }
                    const settled = Message.settleToolPart(
                        current,
                        outcome,
                        { mode: "continue-model", reason },
                        { timestamp: end },
                    )
                    requestSettledToolTurnControl(settled)

                    toolcalls[toolCallID] = settled
                    emitRuntimeEvent?.("tool.call.settled", { part: settled })
                    await persistPart(settled)
                }
            }

            const listActiveToolCalls = () =>
                Object.keys(toolcalls)
                    .map((toolCallID) => flushPendingToolInput(toolCallID) ?? toolcalls[toolCallID])
                    .filter(
                        (part): part is Message.ToolPart => {
                            if (!part) return false

                            return part.state.phase === "pending" || part.state.phase === "running"
                        },
                    )

            const recoverToolArgumentFailure = async (message: string) => {
                const activeToolCalls = listActiveToolCalls()
                if (activeToolCalls.length === 0 || !isToolArgumentShapeError(message)) {
                    return false
                }

                const reason = normalizeToolArgumentFailureMessage(message)
                input.Assistant.error = undefined
                input.Assistant.finishReason = "tool-calls"
                input.Assistant.completed = input.Assistant.completed ?? Date.now()
                await settleToolArgumentFailures(reason)
                await persistAssistantMessage()
                log.warn("converted tool argument validation failure into tool errors", {
                    error: message,
                    activeToolCalls: activeToolCalls.map((part) => ({
                        callID: part.callID,
                        tool: part.tool,
                        phase: part.state.phase,
                    })),
                })
                return true
            }

            const describeOpenToolCallFailure = (
                activeToolCalls: Message.ToolPart[],
                streamAbortReason?: string,
            ) => {
                if (!streamAbortReason) {
                    return "Tool call did not complete before the model response finished."
                }

                const pending = activeToolCalls.find((part) => part.state.phase === "pending")
                const rawLength =
                    pending?.state.phase === "pending"
                        ? pending.input.raw.length
                        : undefined

                const detail = rawLength && rawLength > 0
                    ? ` Buffered tool input size: ${rawLength} characters.`
                    : ""

                return [
                    `Model stream aborted before the tool call finished: ${streamAbortReason}`,
                    detail.trim(),
                    "Increase ANYBOX_EXPERIMENTAL_LLM_TOTAL_TIMEOUT_MS or ANYBOX_EXPERIMENTAL_LLM_STEP_TIMEOUT_MS if this tool needs more time to stream large arguments.",
                ]
                    .filter((item) => item.length > 0)
                    .join(" ")
            }

            const reconcileOpenToolCalls = async (stream: LLM.StreamOutput) => {
                const activeToolCalls = listActiveToolCalls()
                if (activeToolCalls.length === 0) {
                    return 0
                }

                const candidates = new Map<string, FinalToolResultCandidate>()
                const remember = (candidate: FinalToolResultCandidate | undefined) => {
                    if (!candidate) {
                        return
                    }

                    candidates.set(candidate.toolCallId, candidate)
                }

                try {
                    const settled = await Promise.allSettled([
                        stream.toolResults,
                        stream.steps,
                        stream.response,
                    ])

                    const [toolResultsResult, stepsResult, responseResult] = settled

                    if (toolResultsResult?.status === "fulfilled" && Array.isArray(toolResultsResult.value)) {
                        for (const item of toolResultsResult.value) {
                            remember(toToolResultCandidate(item))
                        }
                    }

                    if (stepsResult?.status === "fulfilled") {
                        for (const candidate of collectStepToolResultCandidates(stepsResult.value)) {
                            remember(candidate)
                        }
                    }

                    if (responseResult?.status === "fulfilled") {
                        for (const candidate of collectResponseToolResultCandidates(responseResult.value)) {
                            remember(candidate)
                        }
                    }

                    let reconciled = 0
                    for (const current of activeToolCalls) {
                        const candidate = candidates.get(current.callID)
                        if (!candidate) {
                            continue
                        }

                        const rawToolOutput = candidate.output ?? candidate.result
                        const fallbackTitle = candidate.title ?? Message.toolPartTitle(current)
                        const fallbackMetadata =
                            candidate.providerMetadata ??
                            Message.toolPartMetadata(current) ??
                            {}
                        const normalized = await extractToolResultState(
                            rawToolOutput,
                            fallbackTitle,
                            fallbackMetadata,
                            current,
                        )
                        const normalizedInput = normalizeToolInput(
                            candidate.input === undefined ? Message.toolPartInput(current) : candidate.input,
                            readToolRaw(current),
                        )
                        let running = current
                        if (running.state.phase === "pending") {
                            if (normalizedInput.raw.startsWith(running.input.raw)) {
                                running = Message.appendToolPartInput(running, {
                                    delta: normalizedInput.raw.slice(running.input.raw.length),
                                    value: normalizedInput.input,
                                })
                            }
                            running = Message.changeToolPartPhase(running, { phase: "running" }, {
                                presentation: {
                                    title: fallbackTitle,
                                    metadata: fallbackMetadata,
                                },
                            })
                            emitRuntimeEvent?.("tool.call.phase_changed", {
                                part: running,
                                previousPhase: "pending",
                            })
                        }
                        const control = normalized.control ?? { mode: "continue-model" as const }
                        const match = Message.settleToolPart(
                            running,
                            structuredToolOutcome(normalized),
                            control,
                            {
                                presentation: {
                                    title: normalized.title || fallbackTitle,
                                    metadata: normalized.metadata,
                                },
                            },
                        )
                        requestSettledToolTurnControl(match)

                        toolcalls[current.callID] = match
                        emitRuntimeEvent?.("tool.call.settled", {
                            part: match,
                        })
                        await persistPart(match)
                        reconciled += 1
                    }

                    if (reconciled > 0) {
                        log.warn("reconciled tool results after the stream ended", {
                            reconciled,
                            activeToolCalls: activeToolCalls.map((part) => ({
                                callID: part.callID,
                                tool: part.tool,
                                phase: part.state.phase,
                            })),
                        })
                    }

                    return reconciled
                } catch (error) {
                    log.warn("failed to reconcile tool results after the stream ended", {
                        error: normalizeToolError(error),
                    })
                    return 0
                }
            }

            while (true) {
                let llmSummary = summarizeLlmCallInput(streamInput)
                let llmCallSettled = false
                let streamAbortReason: string | undefined
                let persistPartialDraftOnce: ((reason: string) => Promise<void>) | undefined
                try {
                    attempt += 1
                    emitRuntimePhase("waiting_llm", {
                        reason: "Awaiting the next model stream.",
                        iteration: attempt,
                    })
                    emitRuntimeEvent?.("llm.call.started", {
                        messageID: input.Assistant.id,
                        providerID: streamInput.model.providerID,
                        modelID: streamInput.model.id,
                        agent: streamInput.agent.name,
                        iteration: attempt,
                        messageCount: llmSummary.messageCount,
                        toolCount: llmSummary.toolCount,
                        requestedToolCount: llmSummary.requestedToolCount,
                        toolsDisabledReason: llmSummary.toolsDisabledReason,
                        hasAttachments: llmSummary.hasAttachments,
                        topLevelImageParts: llmSummary.topLevelImageParts,
                        toolResultImageParts: llmSummary.toolResultImageParts,
                        totalImageBytes: llmSummary.totalImageBytes,
                        images: llmSummary.images,
                    })

                    const draft = createAssistantOutputDraft()
                    let currentText: Message.TextPart | undefined = undefined
                    // Some models, such as Claude and Gemini, can stream multiple reasoning chains; track them by id.
                    let reasoningMap: Record<string, Message.ReasoningPart> = {}
                    let outputDraftPersisted = false
                    let lifecyclePersistence: Promise<void> | undefined

                    const persistDraftParts = async () => {
                        for (const part of draft.snapshot()) {
                            await persistCanonicalPart(part)
                        }
                    }

                    const persistSuccessfulDraft = async (event: unknown) => {
                        if (outputDraftPersisted) {
                            return
                        }

                        outputDraftPersisted = true
                        await applyFinalStreamResultToDraft(draft, event, input.Assistant)

                        if (isRecord(event)) {
                            const finishReason =
                                typeof event.finishReason === "string"
                                    ? event.finishReason
                                    : this.message.finishReason
                            if (finishReason) {
                                this.message.finishReason = finishReason
                            }
                            applyUsageToAssistantMessage(
                                this.message,
                                event.totalUsage as LanguageModelUsage | undefined,
                                "preserve",
                            )
                        }

                        this.message.completed = this.message.completed ?? Date.now()
                        await persistDraftParts()
                        await persistAssistantMessage()
                    }

                    persistPartialDraftOnce = async (reason: string) => {
                        if (outputDraftPersisted) {
                            return
                        }

                        outputDraftPersisted = true
                        const now = Date.now()
                        for (const part of draft.snapshot()) {
                            if (part.type === "text") {
                                part.text = part.text.trimEnd()
                                part.time = {
                                    ...(part.time ?? { start: now }),
                                    end: part.time?.end ?? now,
                                }
                            }
                            if (part.type === "reasoning") {
                                part.text = part.text.trimEnd()
                                part.time = {
                                    ...part.time,
                                    end: part.time.end ?? now,
                                }
                            }
                        }

                        input.Assistant.error = input.Assistant.error ?? {
                            name: "UnknownError",
                            data: {
                                message: reason,
                            },
                        } as Message.Assistant["error"]
                        input.Assistant.completed = input.Assistant.completed ?? now
                        await persistDraftParts()
                        await persistAssistantMessage()
                    }

                    throwIfAborted(streamInput.abort ?? input.abort)
                    const stream = await LLM.stream({
                        ...streamInput,
                        onFinish: (event) => {
                            lifecyclePersistence = persistSuccessfulDraft(event)
                            return lifecyclePersistence
                        },
                        onAbort: () => {
                            const reason = "The model stream was aborted."
                            streamAbortReason = streamAbortReason ?? reason
                            input.Assistant.error = input.Assistant.error ?? {
                                name: "MessageAbortedError",
                                data: {
                                    message: streamAbortReason,
                                },
                            } as Message.Assistant["error"]
                            lifecyclePersistence = persistPartialDraftOnce!(streamAbortReason)
                            return lifecyclePersistence
                        },
                        onError: (event) => {
                            const reason = normalizeToolError(event.error)
                            if (isToolArgumentShapeError(reason) && listActiveToolCalls().length > 0) {
                                log.warn("deferring recoverable tool argument stream error to fullStream handling", {
                                    error: reason,
                                })
                                return
                            }

                            input.Assistant.error = TurnError.toAssistantError(event.error)
                            lifecyclePersistence = persistPartialDraftOnce!(reason)
                            return lifecyclePersistence
                        },
                    })
                    const fullStreamProbeBase = {
                        sessionID: input.Assistant.sessionID,
                        messageID: input.Assistant.id,
                        providerID: streamInput.model.providerID,
                        modelID: streamInput.model.id,
                        agent: streamInput.agent.name,
                        iteration: attempt,
                    }
                    const fullStreamProbeStartedAt = performance.now()
                    let fullStreamProbeLastHandledAt = fullStreamProbeStartedAt
                    let fullStreamProbeChunkCount = 0
                    log.debug("fullStream.consume.started", fullStreamProbeBase)
                    for await (const streamValue of stream.fullStream) {
                        throwIfAborted(streamInput.abort ?? input.abort)
                        const fullStreamProbePulledAt = performance.now()
                        const fullStreamProbeSequence = fullStreamProbeChunkCount
                        const fullStreamProbeWaitMs = fullStreamProbePulledAt - fullStreamProbeLastHandledAt
                        let fullStreamProbeValue: FullStreamProbeValue | undefined
                        try {
                        const value = streamValue as typeof streamValue | (
                            { type: "source-url" | "source-document" } & Record<string, unknown>
                        )
                        fullStreamProbeValue = value as FullStreamProbeValue
                        publishStreamChunk(value as { type?: unknown } & Record<string, unknown>)
                        switch (value.type) {
                            case "text-start":
                                emitRuntimePhase("responding", {
                                    reason: "The model started streaming a visible response.",
                                    iteration: attempt,
                                })
                                currentText = {
                                    id: Identifier.ascending("part"),
                                    sessionID: input.Assistant.sessionID,
                                    messageID: input.Assistant.id,
                                    type: "text",
                                    text: "",
                                    time: {
                                        start: Date.now(),
                                    },
                                    metadata: value.providerMetadata,
                                }
                                draft.remember(currentText)
                                emitStreamRuntimeEvent?.("text.part.started", {
                                    messageID: currentText.messageID,
                                    partID: currentText.id,
                                    kind: "text",
                                    text: currentText.text,
                                    metadata: currentText.metadata,
                                })
                                writeStreamDebug("text-start:")
                                break;
                            case "text-end":
                                if (currentText) {
                                    currentText.text = currentText.text.trimEnd()
                                    if (currentText.time)
                                        currentText.time.end = Date.now()
                                    if (value.providerMetadata)
                                        currentText.metadata = value.providerMetadata
                                    emitStreamRuntimeEvent?.("text.part.completed", {
                                        part: currentText,
                                    })
                                    currentText = undefined
                                    writeStreamDebug("\n")

                                }
                                break;
                            case 'text-delta':
                                if (currentText) {
                                    currentText.text += value.text
                                    if (value.providerMetadata)
                                        currentText.metadata = value.providerMetadata
                                    emitStreamRuntimeEvent?.("text.part.delta", {
                                        messageID: currentText.messageID,
                                        partID: currentText.id,
                                        kind: "text",
                                        delta: value.text,
                                        metadata: currentText.metadata,
                                    })

                                    writeStreamDebug(value.text)
                                }
                                break;
                            case "reasoning-start":
                                emitRuntimePhase("reasoning", {
                                    reason: "The model started streaming reasoning output.",
                                    iteration: attempt,
                                })
                                if (value.id in reasoningMap)
                                    continue

                                const reasoningPart: Message.ReasoningPart = {
                                    id: Identifier.ascending("part"),
                                    sessionID: input.Assistant.sessionID,
                                    messageID: input.Assistant.id,
                                    type: "reasoning",
                                    text: "",
                                    time: { start: Date.now() },
                                    metadata: value.providerMetadata,
                                }
                                reasoningMap[value.id] = reasoningPart
                                draft.remember(reasoningPart)
                                emitStreamRuntimeEvent?.("reasoning.part.started", {
                                    messageID: reasoningPart.messageID,
                                    partID: reasoningPart.id,
                                    kind: "reasoning",
                                    text: reasoningPart.text,
                                    metadata: reasoningPart.metadata,
                                })

                                writeStreamDebug("reasoning start")

                                break;
                            case "reasoning-end":
                                if (value.id in reasoningMap) {
                                    const part = reasoningMap[value.id]
                                    if (part) {
                                        part!.text = part!.text.trimEnd()

                                        part!.time = {
                                            ...part!.time,
                                            end: Date.now(),
                                        }
                                        if (value.providerMetadata) part!.metadata = value.providerMetadata
                                        emitStreamRuntimeEvent?.("reasoning.part.completed", {
                                            part: part!,
                                        })

                                        delete reasoningMap[value.id]
                                    }
                                }
                                writeStreamDebug("\n")
                                break;
                            case "reasoning-delta":
                                if (value.id in reasoningMap) {
                                    const part = reasoningMap[value.id]
                                    part!.text += value.text
                                    if (value.providerMetadata) part!.metadata = value.providerMetadata
                                    emitStreamRuntimeEvent?.("reasoning.part.delta", {
                                        messageID: part!.messageID,
                                        partID: part!.id,
                                        kind: "reasoning",
                                        delta: value.text,
                                        metadata: part!.metadata,
                                    })
                                    writeStreamDebug(value.text)
                                }
                                break

                            case "tool-input-start":
                                const pendingPart = createPendingToolCall({
                                    callID: value.id,
                                    tool: value.toolName,
                                    providerMetadata: value.providerMetadata,
                                })
                                toolcalls[value.id] = pendingPart
                                emitRuntimeEvent?.("tool.call.created", {
                                    part: pendingPart,
                                })

                                // This stage only maintains in-memory state; persistence happens after the tool call starts.
                                // try {
                                //     await Session.updatePart(pendingPart)
                                // } catch (error) {
                                //     console.error("failed to persist tool-input-start part", pendingPart)
                                //     throw error
                                // }
                                break;
                            case "tool-input-end":
                                flushPendingToolInput(value.id, { emitDelta: true })
                                break;
                            case "tool-input-delta":
                                if (value.id in toolcalls && typeof value.delta === "string") {
                                    const current = toolcalls[value.id]
                                    const pendingState = Message.ToolStatePending.safeParse(current?.state)
                                    if (current && pendingState.success) {
                                        const next = Message.appendToolPartInput(current, { delta: value.delta })
                                        toolcalls[value.id] = next
                                        emitStreamRuntimeEvent?.("tool.call.input_delta", {
                                            part: next,
                                            messageID: next.messageID,
                                            partID: next.id,
                                            toolCallID: next.callID,
                                            toolName: next.tool,
                                            delta: value.delta,
                                            rawLength: next.input.raw.length,
                                            metadata: next.presentation?.metadata,
                                        })
                                    }
                                }
                                break;
                            case "source":
                            case "source-url":
                            case "source-document": {
                                const sourcePart = toSourcePart(value, input.Assistant)
                                if (!sourcePart) {
                                    break
                                }

                                emitRuntimeEvent?.("source.recorded", {
                                    part: sourcePart,
                                })
                                draft.remember(sourcePart)
                                break
                            }
                            case "file": {
                                const filePart = await toGeneratedFilePart(value, input.Assistant)
                                if (!filePart) {
                                    break
                                }

                                emitRuntimeEvent?.("file.generated", {
                                    part: filePart,
                                })
                                draft.remember(filePart)
                                break
                            }
                            case 'tool-call':
                                emitRuntimePhase("executing_tool", {
                                    reason: "The model issued a tool call.",
                                    toolCallID: value.toolCallId,
                                    toolName: value.toolName,
                                    iteration: attempt,
                                })
                                // value.toolCallId 工具调用 ID
                                // value.toolName 工具名称
                                // value.args 工具参数
                                const match = flushPendingToolInput(value.toolCallId)
                                const rawToolInput = readToolRaw(match)
                                const normalizedInput = normalizeToolInput(value.input, rawToolInput)
                                const askUserQuestionMetadata = isAskUserQuestionToolName(value.toolName)
                                    ? createAskUserQuestionMetadataFromInput(normalizedInput.input, {
                                        toolCallID: value.toolCallId,
                                    })
                                    : undefined
                                const runningStateMetadata = metadataWithToolSource(
                                    value.toolName,
                                    askUserQuestionMetadata,
                                )
                                let part = match
                                if (!part) {
                                    part = createPendingToolCall({
                                        callID: value.toolCallId,
                                        tool: value.toolName,
                                        input: normalizedInput.input,
                                        raw: normalizedInput.raw,
                                        providerExecuted: value.providerExecuted === true,
                                        providerMetadata: value.providerMetadata,
                                    })
                                    toolcalls[value.toolCallId] = part
                                    emitRuntimeEvent?.("tool.call.created", { part })
                                }

                                const beforeInputUpdate = part
                                if (part.state.phase === "pending") {
                                    if (normalizedInput.raw.startsWith(part.input.raw) && (
                                        normalizedInput.raw !== part.input.raw ||
                                        part.input.value === undefined ||
                                        value.title !== undefined ||
                                        runningStateMetadata !== undefined ||
                                        value.providerExecuted === true
                                    )) {
                                        part = Message.appendToolPartInput(part, {
                                            delta: normalizedInput.raw.slice(part.input.raw.length),
                                            value: normalizedInput.input,
                                            presentation: {
                                                title: value.title,
                                                metadata: runningStateMetadata,
                                            },
                                            source: toolCallSource(
                                                value.providerExecuted === true || part.source.kind === "provider",
                                                { ...part.source.metadata, ...value.providerMetadata },
                                            ),
                                        })
                                    }
                                }
                                if (part.revision > beforeInputUpdate.revision) {
                                    emitRuntimeEvent?.("tool.call.input_delta", {
                                        part,
                                        messageID: part.messageID,
                                        partID: part.id,
                                        toolCallID: part.callID,
                                        toolName: part.tool,
                                        delta: part.input.raw.startsWith(beforeInputUpdate.input.raw)
                                            ? part.input.raw.slice(beforeInputUpdate.input.raw.length)
                                            : "",
                                        rawLength: part.input.raw.length,
                                        metadata: part.presentation?.metadata,
                                    })
                                }

                                if (part.state.phase === "pending" && askUserQuestionMetadata) {
                                    const previousPhase = part.state.phase
                                    part = Message.changeToolPartPhase(part, { phase: "running" })
                                    emitRuntimeEvent?.("tool.call.phase_changed", { part, previousPhase })
                                }

                                toolcalls[value.toolCallId] = part
                                requestPartPersistence(part)
                                break;
                            case 'tool-result':
                                if (
                                    toolcalls[value.toolCallId]?.state.phase === "pending" ||
                                    toolcalls[value.toolCallId]?.state.phase === "running"
                                ) {
                                    let current = toolcalls[value.toolCallId]!
                                    if (current.state.phase === "pending") {
                                        const previousPhase = current.state.phase
                                        current = Message.changeToolPartPhase(current, { phase: "running" }, {
                                            source: toolCallSource(
                                                value.providerExecuted === true || current.source.kind === "provider",
                                                { ...current.source.metadata, ...value.providerMetadata },
                                            ),
                                        })
                                        emitRuntimeEvent?.("tool.call.phase_changed", { part: current, previousPhase })
                                    }
                                    const resultValue = value as { output?: unknown; result?: unknown }
                                    const rawToolOutput = resultValue.output ?? resultValue.result
                                    const normalized = await extractToolResultState(
                                        rawToolOutput,
                                        value.title,
                                        metadataWithToolSource(
                                            current.tool,
                                            value.providerMetadata,
                                        ) ?? {},
                                        current,
                                    )
                                    const control = normalized.control ?? { mode: "continue-model" as const }
                                    const match = Message.settleToolPart(
                                        current,
                                        structuredToolOutcome(normalized),
                                        control,
                                        {
                                            presentation: {
                                                title: normalized.title || Message.toolPartTitle(current),
                                                metadata: normalized.metadata,
                                            },
                                        },
                                    )
                                    requestSettledToolTurnControl(match)

                                    toolcalls[value.toolCallId] = match
                                    emitRuntimeEvent?.("tool.call.settled", {
                                        part: match,
                                    })
                                    requestPartPersistence(match)

                                }
                                break;

                            case "tool-error":
                                if (
                                    toolcalls[value.toolCallId]?.state.phase === "pending" ||
                                    toolcalls[value.toolCallId]?.state.phase === "running"
                                ) {
                                    let current = toolcalls[value.toolCallId]!
                                    if (current.state.phase === "pending") {
                                        const previousPhase = current.state.phase
                                        current = Message.changeToolPartPhase(current, { phase: "running" }, {
                                            source: toolCallSource(
                                                value.providerExecuted === true || current.source.kind === "provider",
                                                { ...current.source.metadata, ...value.providerMetadata },
                                            ),
                                        })
                                        emitRuntimeEvent?.("tool.call.phase_changed", { part: current, previousPhase })
                                    }
                                    const signal = Tool.findToolControlSignal(value.error)
                                    const structuredFailure = Tool.findToolFailureError(value.error)
                                    const errorMessage = normalizeToolError(value.error)
                                    const metadata = metadataWithToolSource(
                                        current.tool,
                                        value.providerMetadata,
                                    ) ?? {}
                                    const match = Message.settleToolPart(current, signal?.outcome ?? {
                                        kind: "failed" as const,
                                        error: Tool.toolFailure(value.error, {
                                            message: errorMessage,
                                            source: value.providerExecuted === true ? "provider" : "tool",
                                            code: value.providerExecuted === true
                                                ? "PROVIDER_TOOL_ERROR"
                                                : "TOOL_EXECUTION_ERROR",
                                        }),
                                        partialOutput: structuredFailure?.partialOutput,
                                        metadata,
                                        execution: Tool.toolExecutionSemantics(undefined),
                                    }, signal?.control ?? {
                                        mode: "continue-model" as const,
                                        reason: errorMessage,
                                    }, {
                                        presentation: { metadata },
                                    })
                                    requestSettledToolTurnControl(match)

                                    toolcalls[value.toolCallId] = match
                                    emitRuntimeEvent?.("tool.call.settled", {
                                        part: match,
                                    })
                                    requestPartPersistence(match)
                                }
                                break;
                            case "tool-output-denied":
                                if (
                                    toolcalls[value.toolCallId] &&
                                    (
                                        toolcalls[value.toolCallId]?.state.phase === "running" ||
                                        toolcalls[value.toolCallId]?.state.phase === "waiting-approval"
                                    )
                                ) {
                                    const current = toolcalls[value.toolCallId]!
                                    const metadata = Message.toolPartMetadata(current) ?? {}
                                    const match = Message.settleToolPart(current, {
                                        kind: "denied",
                                        approvalID: current.state.phase === "waiting-approval"
                                            ? current.state.approval.id
                                            : undefined,
                                        reason: "Tool execution was denied.",
                                        metadata,
                                        execution: Tool.toolExecutionSemantics(undefined, {
                                            sideEffect: "none",
                                            retry: "safe",
                                        }),
                                    }, { mode: "continue-model" })
                                    requestSettledToolTurnControl(match)

                                    toolcalls[value.toolCallId] = match
                                    emitRuntimeEvent?.("tool.call.settled", {
                                        part: match,
                                    })
                                    requestPartPersistence(match)
                                }
                                break;
                            case "start-step":
                                const stepStartPart: Message.StepStartPart = {
                                    id: Identifier.ascending("part"),
                                    sessionID: input.Assistant.sessionID,
                                    messageID: input.Assistant.id,
                                    type: "step-start",
                                    snapshot:
                                        typeof (value as unknown as { snapshot?: unknown }).snapshot === "string"
                                            ? (value as unknown as { snapshot: string }).snapshot
                                            : undefined,
                                }
                                draft.remember(stepStartPart)
                                emitCanonicalPartRecorded(stepStartPart)
                                break;
                            case "start":
                                //SessionStatus.set(input.sessionID, { type: "busy" })
                                //console.log(value)
                                break;
                            case 'finish':

                                // 处理完成事件
                                // value.finishReason 完成原因
                                // value.usage 使用统计（token 数量等）
                                // TODO: 更新消息的完成状态和时间
                                // TODO: Record usage and billing data.
                                // TODO: 发送完成事件通知 UI
                                // TODO: Maybe trigger message compaction.
                                this.message.finishReason = value.finishReason
                                applyUsageToAssistantMessage(this.message, value.totalUsage, "preserve")
                                emitRuntimeEvent?.("llm.call.completed", {
                                    messageID: input.Assistant.id,
                                    providerID: streamInput.model.providerID,
                                    modelID: streamInput.model.id,
                                    agent: streamInput.agent.name,
                                    iteration: attempt,
                                    messageCount: llmSummary.messageCount,
                                    toolCount: llmSummary.toolCount,
                                    requestedToolCount: llmSummary.requestedToolCount,
                                    toolsDisabledReason: llmSummary.toolsDisabledReason,
                                    hasAttachments: llmSummary.hasAttachments,
                                    topLevelImageParts: llmSummary.topLevelImageParts,
                                    toolResultImageParts: llmSummary.toolResultImageParts,
                                    totalImageBytes: llmSummary.totalImageBytes,
                                    images: llmSummary.images,
                                    finishReason: value.finishReason,
                                    usage: summarizeLlmUsage(value.totalUsage),
                                })
                                llmCallSettled = true
                                break;
                            case "abort":
                                streamAbortReason =
                                    typeof value.reason === "string" && value.reason.length > 0
                                        ? value.reason
                                        : "The model stream aborted."
                                break;
                            case "raw":
                                break;
                            case 'error':
                                const streamErrorMessage = normalizeToolError(value.error)
                                if (await recoverToolArgumentFailure(streamErrorMessage)) {
                                    llmCallSettled = true
                                    break
                                }

                                input.Assistant.error = TurnError.toAssistantError(value.error)
                                emitRuntimeEvent?.("llm.call.failed", {
                                    messageID: input.Assistant.id,
                                    providerID: streamInput.model.providerID,
                                    modelID: streamInput.model.id,
                                    agent: streamInput.agent.name,
                                    iteration: attempt,
                                    messageCount: llmSummary.messageCount,
                                    toolCount: llmSummary.toolCount,
                                    requestedToolCount: llmSummary.requestedToolCount,
                                    toolsDisabledReason: llmSummary.toolsDisabledReason,
                                    hasAttachments: llmSummary.hasAttachments,
                                    topLevelImageParts: llmSummary.topLevelImageParts,
                                    toolResultImageParts: llmSummary.toolResultImageParts,
                                    totalImageBytes: llmSummary.totalImageBytes,
                                    images: llmSummary.images,
                                    error: streamErrorMessage,
                                    retryable: false,
                                })
                                llmCallSettled = true
                                log.error("stream error", { error: value.error })
                                await persistPartialDraftOnce?.(streamErrorMessage)
                                break;
                            case "finish-step":
                                // This value means the LLM step has finished.
                                this.message.finishReason = value.finishReason
                                applyUsageToAssistantMessage(this.message, value.usage, "peak")
                                const stepFinishPart: Message.StepFinishPart = {
                                    id: Identifier.ascending("part"),
                                    sessionID: input.Assistant.sessionID,
                                    messageID: input.Assistant.id,
                                    type: "step-finish",
                                    reason:
                                        typeof value.finishReason === "string" && value.finishReason.length > 0
                                            ? value.finishReason
                                            : "Reasoning step completed.",
                                    snapshot:
                                        typeof (value as unknown as { snapshot?: unknown }).snapshot === "string"
                                            ? (value as unknown as { snapshot: string }).snapshot
                                            : undefined,
                                    cost: 0,
                                    tokens: buildStepTokens(value.usage),
                                }
                                draft.remember(stepFinishPart)
                                emitCanonicalPartRecorded(stepFinishPart)

                                break;
                            case "tool-approval-request":
                                const approvalToolCallID =
                                    value.toolCall?.toolCallId ??
                                    (value as { toolCallId?: string }).toolCallId
                                emitRuntimePhase("waiting_approval", {
                                    reason: "Waiting for an approval decision before continuing the tool.",
                                    toolCallID: approvalToolCallID,
                                    toolName: approvalToolCallID ? toolcalls[approvalToolCallID]?.tool : undefined,
                                    iteration: attempt,
                                })
                                if (!approvalToolCallID) {
                                    log.warn("tool approval request arrived without a tool call id", {
                                        approvalId: value.approvalId,
                                    })
                                    break
                                }
                                flushPendingToolInput(approvalToolCallID, { emitDelta: true })
                                if (
                                    toolcalls[approvalToolCallID] &&
                                    toolcalls[approvalToolCallID]?.state.phase === "pending"
                                ) {
                                    const current = toolcalls[approvalToolCallID]!
                                    const waiting = Message.changeToolPartPhase(current, {
                                        phase: "waiting-approval",
                                        approval: {
                                            id: value.approvalId,
                                            metadata: current.presentation?.metadata,
                                        },
                                    })

                                    toolcalls[approvalToolCallID] = waiting
                                    emitRuntimeEvent?.("tool.call.phase_changed", {
                                        part: waiting,
                                        previousPhase: "pending",
                                    })
                                    requestPartPersistence(waiting)
                                    requestToolApprovalRegistration(waiting)
                                    blocked = true
                                }
                                break;
                            default:
                                // 处理未知事件类型
                                log.warn(`Unknown stream value type: ${(value as any).type}`);
                                break;
                        }
                        } finally {
                            const fullStreamProbeHandledAt = performance.now()
                            const fullStreamProbeHandleMs = fullStreamProbeHandledAt - fullStreamProbePulledAt
                            const fullStreamProbeSummary = {
                                ...fullStreamProbeBase,
                                sequence: fullStreamProbeSequence,
                                waitMs: roundProbeMs(fullStreamProbeWaitMs),
                                handleMs: roundProbeMs(fullStreamProbeHandleMs),
                                elapsedMs: roundProbeMs(fullStreamProbeHandledAt - fullStreamProbeStartedAt),
                                pendingSideEffects: pendingStreamSideEffects.size,
                                ...(fullStreamProbeValue
                                    ? summarizeFullStreamProbeValue(fullStreamProbeValue)
                                    : { chunkType: "unknown" }),
                            }
                            if (isFullStreamChunkProbeEnabled()) {
                                log.debug("fullStream.chunk.consumed", fullStreamProbeSummary)
                            } else if (
                                fullStreamProbeHandleMs >= SLOW_FULLSTREAM_CHUNK_HANDLE_MS ||
                                fullStreamProbeWaitMs >= SLOW_FULLSTREAM_CHUNK_WAIT_MS
                            ) {
                                log.warn("fullStream.chunk.slow", fullStreamProbeSummary)
                            }
                            fullStreamProbeLastHandledAt = performance.now()
                            fullStreamProbeChunkCount = fullStreamProbeSequence + 1
                        }
                        throwIfAborted(streamInput.abort ?? input.abort)
                    }
                    log.debug("fullStream.consume.completed", {
                        ...fullStreamProbeBase,
                        chunkCount: fullStreamProbeChunkCount,
                        totalMs: roundProbeMs(performance.now() - fullStreamProbeStartedAt),
                        pendingSideEffects: pendingStreamSideEffects.size,
                    })

                    if (currentText) {
                        currentText.text = currentText.text.trimEnd()
                        currentText.time = {
                            ...(currentText.time ?? { start: Date.now() }),
                            end: currentText.time?.end ?? Date.now(),
                        }
                    }

                    for (const part of Object.values(reasoningMap)) {
                        part.text = part.text.trimEnd()
                        part.time = {
                            ...part.time,
                            end: part.time.end ?? Date.now(),
                        }
                    }

                    if (!llmCallSettled && streamAbortReason) {
                        emitRuntimeEvent?.("llm.call.failed", {
                            messageID: input.Assistant.id,
                            providerID: streamInput.model.providerID,
                            modelID: streamInput.model.id,
                            agent: streamInput.agent.name,
                            iteration: attempt,
                            messageCount: llmSummary.messageCount,
                            toolCount: llmSummary.toolCount,
                            requestedToolCount: llmSummary.requestedToolCount,
                            toolsDisabledReason: llmSummary.toolsDisabledReason,
                            hasAttachments: llmSummary.hasAttachments,
                            topLevelImageParts: llmSummary.topLevelImageParts,
                            toolResultImageParts: llmSummary.toolResultImageParts,
                            totalImageBytes: llmSummary.totalImageBytes,
                            images: llmSummary.images,
                            error: streamAbortReason,
                            retryable: false,
                        })
                        llmCallSettled = true
                        input.Assistant.error = input.Assistant.error ?? {
                            name: "MessageAbortedError",
                            data: {
                                message: streamAbortReason,
                            },
                        } as Message.Assistant["error"]
                        await persistPartialDraftOnce?.(streamAbortReason)
                    }

                    if (lifecyclePersistence) {
                        await lifecyclePersistence
                    }

                    if (isAbortSignalAborted(streamInput.abort ?? input.abort)) {
                        await cancelOpenToolCalls("Prompt cancellation requested.")
                        throwIfAborted(streamInput.abort ?? input.abort)
                    } else {
                        await reconcileOpenToolCalls(stream)

                        const activeToolCalls = listActiveToolCalls()
                        if (activeToolCalls.length > 0) {
                            const reason = describeOpenToolCallFailure(activeToolCalls, streamAbortReason)
                            await failOpenToolCalls(reason)
                            log.warn("stopping processor because tool calls were left unresolved", {
                                reason,
                                activeToolCalls: activeToolCalls.map((part) => ({
                                    callID: part.callID,
                                    tool: part.tool,
                                    phase: part.state.phase,
                                })),
                            })
                            return "stop"
                        }
                    }
                }
                catch (e: any) {
                    const aborted = isAbortSignalAborted(streamInput.abort ?? input.abort)
                    const errorMessage = aborted ? "Prompt cancellation requested." : normalizeToolError(e)
                    if (!aborted && await recoverToolArgumentFailure(errorMessage)) {
                        llmCallSettled = true
                        log.warn("processor recovered from tool argument validation failure", {
                            error: errorMessage,
                        })
                        return "continue"
                    }

                    if (!llmCallSettled) {
                        emitRuntimeEvent?.("llm.call.failed", {
                            messageID: input.Assistant.id,
                            providerID: streamInput.model.providerID,
                            modelID: streamInput.model.id,
                            agent: streamInput.agent.name,
                            iteration: attempt,
                            messageCount: llmSummary.messageCount,
                            toolCount: llmSummary.toolCount,
                            requestedToolCount: llmSummary.requestedToolCount,
                            toolsDisabledReason: llmSummary.toolsDisabledReason,
                            hasAttachments: llmSummary.hasAttachments,
                            topLevelImageParts: llmSummary.topLevelImageParts,
                            toolResultImageParts: llmSummary.toolResultImageParts,
                            totalImageBytes: llmSummary.totalImageBytes,
                            images: llmSummary.images,
                            error: errorMessage,
                            retryable: Boolean(e?.isRetryable === true),
                        })
                    }
                    if (aborted) {
                        input.Assistant.error = input.Assistant.error ?? {
                            name: "MessageAbortedError",
                            data: {
                                message: errorMessage,
                            },
                        } as Message.Assistant["error"]
                        await persistPartialDraftOnce?.(errorMessage)
                        await cancelOpenToolCalls("Prompt cancellation requested.")
                    } else {
                        await persistPartialDraftOnce?.(errorMessage)
                        await failOpenToolCalls(errorMessage)
                    }
                    if (aborted) {
                        log.info("processor cancelled", { error: e.message })
                    } else {
                        log.error("processor failure", { error: e.message, stack: e.stack })
                    }
                    throw e  // 重新抛出错误
                }
                const turnControl = requestedTurnControl
                if (turnControl?.mode === "cancel-turn") {
                    const reason = turnControl.reason ?? "A tool requested cancellation of the current turn."
                    input.Assistant.error = input.Assistant.error ?? {
                        name: "MessageAbortedError",
                        data: { message: reason },
                    } as Message.Assistant["error"]
                    input.Assistant.completed = input.Assistant.completed ?? Date.now()
                    await persistAssistantMessage()
                    return "cancel"
                }
                if (turnControl?.mode === "fail-turn") {
                    const reason = turnControl.reason ?? "A tool requested failure of the current turn."
                    input.Assistant.error = input.Assistant.error ?? TurnError.toAssistantError(new Error(reason))
                    input.Assistant.completed = input.Assistant.completed ?? Date.now()
                    await persistAssistantMessage()
                    return "fail"
                }
                if (turnControl?.mode === "wait-user" || blocked) return "stop"
                if (turnControl?.mode === "finish-turn") {
                    input.Assistant.finishReason = "stop"
                    input.Assistant.completed = input.Assistant.completed ?? Date.now()
                    await persistAssistantMessage()
                    return "finish"
                }
                if (turnControl?.mode === "restart-loop" || restartLoop) {
                    input.Assistant.finishReason = "tool-calls"
                    return "restart"
                }
                if (needsCompaction) return "compact"
                if (input.Assistant.error) return "stop"
                return "continue"
            }
            } finally {
                try {
                    input.turn?.flushStreamEvents?.()
                    await flushStreamSideEffects()
                } finally {
                    for (const unsubscribe of unsubscribeStreamSideEffects.splice(0)) {
                        unsubscribe()
                    }
                }
            }
        }
    }
    return result
}
