import * as AI from "ai";
import z from "zod"
import * as Snapshot  from "#snapshot/snapshot.ts"
import {
    //     APICallError,
    //     convertToModelMessages,
    //     LoadAPIKeyError,
    type ModelMessage,
    type UIMessage,
    type UserModelMessage,
    type SystemModelMessage,
    type AssistantModelMessage,
    type ToolModelMessage,
    //     type UserContent,
    //     type TextPart, //as aiTextPart,
    //     type FilePart, //as aiFilePart,
    //     type ImagePart,//as aiImagePart
    //     type ReasoningUIPart,
    //     type ToolContent,
} from "ai"
import { NamedError } from "#util/error.ts"
import { define } from "#bus/bus-event.ts"
import { iife } from "#util/iife.ts"
import * as  Identifier from "#id/id.ts";
import { fn } from "#util/fn.ts";
import * as db from "#database/Sqlite.ts"
import type * as Agent from "#agent/agent.ts"
import * as Provider from "#provider/provider.ts"
import * as Permission from "#permission/schema.ts"
import * as Log from "#util/log.ts"
import * as ToolResultPersistence from "#session/support/tool-result-persistence.ts"
import * as Tool from "#tool/tool.ts"
import { TOOL_SEARCH_ID, TOOL_SEARCH_MODEL_NAME } from "#tool/tool-search.ts"
import { ReasoningEffortSchema, ToolModuleIDSchema } from "@anybox/shared"

export const OutputLengthError = NamedError.create("MessageOutputLengthError", z.object({}))
export const AbortedError = NamedError.create("MessageAbortedError", z.object({ message: z.string() }))
export const AuthError = NamedError.create(
    "ProviderAuthError",
    z.object({
        providerID: z.string(),
        message: z.string(),
    }),
)
export const APIError = NamedError.create(
    "APIError",
    z.object({
        message: z.string(),
        statusCode: z.number().optional(),
        isRetryable: z.boolean(),
        responseHeaders: z.record(z.string(), z.string()).optional(),
        responseBody: z.string().optional(),
        metadata: z.record(z.string(), z.string()).optional(),
    }),
)
export type APIError = z.infer<typeof APIError.Schema>

const log = Log.create({ service: "session.message" })

function modelSafeToolName(toolName: string, providerExecuted = false) {
    const modelName = Tool.toModelToolName(toolName)
    // Old Anybox turns persisted the ordinary deferred-search function under
    // OpenAI's reserved `tool_search` name. Rewrite only Anybox-executed calls
    // during replay; a provider-executed native call must keep its protocol name.
    if (!providerExecuted && modelName === TOOL_SEARCH_ID) return TOOL_SEARCH_MODEL_NAME
    return modelName
}

function summarizeAttachmentPartForLog(part: FilePart | ImagePart) {
    return {
        type: part.type,
        mime: part.mime,
        filename: part.filename,
        urlScheme: part.url.startsWith("data:") ? "data" : "remote",
    }
}

function decodeDataUrlAttachment(url: string) {
    if (!url.trim().toLowerCase().startsWith("data:")) return undefined

    const match = /^data:([^;,]+)(?:;[^,]*)?;base64,([\s\S]*)$/i.exec(url.trim())
    if (!match) {
        throw new Error("Attachment data URL must use base64 encoding.")
    }

    const mediaType = match[1]?.trim() ?? ""
    const base64 = match[2]?.replace(/\s/g, "") ?? ""
    if (!mediaType || !base64) {
        throw new Error("Attachment data URL is missing media type or data.")
    }

    const data = Buffer.from(base64, "base64")
    if (data.length === 0) {
        throw new Error("Attachment data URL is empty.")
    }

    return {
        data: new Uint8Array(data),
        mediaType,
    }
}

function summarizeModelCapabilitiesForLog(model: Provider.Model) {
    return {
        attachment: model.capabilities.attachment,
        imageInput: model.capabilities.input.image,
        pdfInput: model.capabilities.input.pdf,
        reasoning: model.capabilities.reasoning,
        replayAssistantReasoning: model.capabilities.replayAssistantReasoning ?? true,
    }
}

function shouldReplayAssistantReasoning(model: Provider.Model) {
    return model.capabilities.replayAssistantReasoning !== false
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

function providerOptionsFromMetadata(metadata: Record<string, unknown> | undefined) {
    if (!metadata) return undefined

    const providerOptions = Object.fromEntries(
        Object.entries(metadata).filter(([, value]) => isRecordValue(value)),
    )

    return Object.keys(providerOptions).length > 0 ? providerOptions : undefined
}

function summarizeQuestionAnswerForModel(part: TextPart) {
    const metadata = part.metadata
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
        return part.text
    }

    if (metadata.kind !== "question-answer") {
        return part.text
    }

    const questionID = typeof metadata.questionID === "string" ? metadata.questionID : ""
    const selectedOptions = Array.isArray(metadata.selectedOptions)
        ? metadata.selectedOptions.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        : []
    const freeformText = typeof metadata.freeformText === "string" ? metadata.freeformText.trim() : ""
    const answerText = part.text.trim()

    const lines = [
        "<question-answer>",
        questionID ? `question_id: ${questionID}` : "",
        selectedOptions.length > 0 ? `selected_options: ${selectedOptions.join(", ")}` : "",
        freeformText ? `freeform_answer: ${freeformText}` : "",
        `answer: ${answerText || freeformText || selectedOptions.join(", ")}`,
        "</question-answer>",
    ].filter(Boolean)

    return lines.join("\n")
}

const PartBase = z.object({
    id: z.string(),
    sessionID: z.string(),
    messageID: z.string()
})

export const SnapshotPart = PartBase.extend({
    type: z.literal("snapshot"),
    snapshot: z.string(),
}).meta({
    ref: "SnapshotPart",
})
export type SnapshotPart = z.infer<typeof SnapshotPart>

export const FileChangeSummary = z
    .object({
        file: z.string(),
        additions: z.number(),
        deletions: z.number(),
    })
    .meta({
        ref: "FileChangeSummary",
    })
export type FileChangeSummary = z.infer<typeof FileChangeSummary>

export const PatchFileChangeSummary = FileChangeSummary.extend({
    patch: z.string().optional(),
}).meta({
    ref: "PatchFileChangeSummary",
})
export type PatchFileChangeSummary = z.infer<typeof PatchFileChangeSummary>

export const MessageDiffSummary = z
    .object({
        title: z.string().optional(),
        body: z.string().optional(),
        stats: z
            .object({
                additions: z.number(),
                deletions: z.number(),
                files: z.number(),
            })
            .optional(),
        diffs: PatchFileChangeSummary.array(),
    })
    .meta({
        ref: "MessageDiffSummary",
    })
export type MessageDiffSummary = z.infer<typeof MessageDiffSummary>

export const PatchPart = PartBase.extend({
    type: z.literal("patch"),
    hash: z.string(),
    files: z.string().array(),
    scope: z.literal("model-call").optional(),
    iteration: z.number().optional(),
    fromSnapshot: z.string().optional(),
    changes: PatchFileChangeSummary.array().optional(),
    summary: z
        .object({
            additions: z.number(),
            deletions: z.number(),
            files: z.number(),
        })
        .optional(),
}).meta({
    ref: "PatchPart",
})
export type PatchPart = z.infer<typeof PatchPart>

export const TextPart = PartBase.extend({
    type: z.literal("text"),
    text: z.string(),
    synthetic: z.boolean().optional(), // 标记是否为系统合成的文本，而非模型生成的内容
    ignored: z.boolean().optional(),   // 标记该文本是否应发送给 LLM，例如仅用于 UI 展示的提示
    time: z
        .object({
            start: z.number(),
            end: z.number().optional(),
        })
        .optional(),
    metadata: z.record(z.string(), z.any()).optional(),
}).meta({
    ref: "TextPart",
})
export type TextPart = z.infer<typeof TextPart>

export const MessageQuotePart = PartBase.extend({
    type: z.literal("message-quote"),
    sourceMessageID: z.string(),
    text: z.string(),
}).meta({
    ref: "MessageQuotePart",
})
export type MessageQuotePart = z.infer<typeof MessageQuotePart>

export const ReasoningPart = PartBase.extend({
    type: z.literal("reasoning"),
    text: z.string(),
    metadata: z.record(z.string(), z.any()).optional(),
    time: z.object({
        start: z.number(),
        end: z.number().optional(),
    }),
}).meta({
    ref: "ReasoningPart",
})
export type ReasoningPart = z.infer<typeof ReasoningPart>

const FilePartSourceBase = z.object({
    text: z
        .object({
            value: z.string(),
            start: z.number().int(),
            end: z.number().int(),
        })
        .meta({
            ref: "FilePartSourceText",
        }),
})

export const FileSource = FilePartSourceBase.extend({
    type: z.literal("file"),
    path: z.string(),
}).meta({
    ref: "FileSource",
})

export const SymbolSource = FilePartSourceBase.extend({
    type: z.literal("symbol"), // 来自 LSP (Language Server Protocol) 的符号定义
    path: z.string(),
    //range: LSP.Range,
    name: z.string(),
    kind: z.number().int(),
}).meta({
    ref: "SymbolSource",
})

export const ResourceSource = FilePartSourceBase.extend({
    type: z.literal("resource"), // 外部资源，例如文档链接内容
    clientName: z.string(),
    uri: z.string(),
}).meta({
    ref: "ResourceSource",
})

export const FilePartSource = z.discriminatedUnion("type", [FileSource, SymbolSource, ResourceSource]).meta({
    ref: "FilePartSource",
})

export const SourceUrlPart = PartBase.extend({
    type: z.literal("source-url"),
    sourceID: z.string(),
    url: z.string(),
    title: z.string().optional(),
    providerMetadata: z.record(z.string(), z.any()).optional(),
}).meta({
    ref: "SourceUrlPart",
})
export type SourceUrlPart = z.infer<typeof SourceUrlPart>

export const SourceDocumentPart = PartBase.extend({
    type: z.literal("source-document"),
    sourceID: z.string(),
    mediaType: z.string(),
    title: z.string(),
    filename: z.string().optional(),
    providerMetadata: z.record(z.string(), z.any()).optional(),
}).meta({
    ref: "SourceDocumentPart",
})
export type SourceDocumentPart = z.infer<typeof SourceDocumentPart>

export const FilePart = PartBase.extend({
    type: z.literal("file"),
    mime: z.string(),
    filename: z.string().optional(),
    url: z.string(), // 通常是 Data URL 或内部存储链接
    source: FilePartSource.optional(),
    metadata: z.record(z.string(), z.any()).optional(),
}).meta({
    ref: "FilePart",
})
export type FilePart = z.infer<typeof FilePart>

export const ImagePart = PartBase.extend({
    type: z.literal("image"),
    mime: z.string(),
    filename: z.string().optional(),
    url: z.string(), // 通常是 Data URL 或内部存储链接
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    source: FilePartSource.optional(),
    metadata: z.record(z.string(), z.any()).optional(),
}).meta({
    ref: "ImagePart",
})
export type ImagePart = z.infer<typeof ImagePart>

export const AttachmentPart = z.discriminatedUnion("type", [FilePart, ImagePart]).meta({
    ref: "AttachmentPart",
})
export type AttachmentPart = z.infer<typeof AttachmentPart>

export const AgentPart = PartBase.extend({
    type: z.literal("agent"),
    name: z.string(),
    source: z
        .object({
            value: z.string(),
            start: z.number().int(),
            end: z.number().int(),
        })
        .optional(),
}).meta({
    ref: "AgentPart",
})
export type AgentPart = z.infer<typeof AgentPart>

export const CompactionPart = PartBase.extend({
    type: z.literal("compaction"),
    auto: z.boolean(),
    compactionID: z.string().optional(),
    compactedFromMessageID: z.string().optional(),
    compactedToMessageID: z.string().optional(),
    summaryVersion: z.number().int().positive().optional(),
    createdAt: z.number().int().nonnegative().optional(),
}).meta({
    ref: "CompactionPart",
})
export type CompactionPart = z.infer<typeof CompactionPart>

export const ToolStatePending = z
    .object({
        status: z.literal("pending"),
        input: z.record(z.string(), z.any()),
        raw: z.string(), // 原始 JSON 字符串，用于调试解析错误
    })
    .meta({
        ref: "ToolStatePending",
    })
export type ToolStatePending = z.infer<typeof ToolStatePending>

export const ToolStateRunning = z
    .object({
        status: z.literal("running"),
        input: z.record(z.string(), z.any()),
        raw: z.string().optional(),
        title: z.string().optional(),
        metadata: z.record(z.string(), z.any()).optional(),
        time: z.object({
            start: z.number(),
        }),
    })
    .meta({
        ref: "ToolStateRunning",
    })
export type ToolStateRunning = z.infer<typeof ToolStateRunning>

export const ToolStateCompleted = z
    .object({
        status: z.literal("completed"),
        input: z.record(z.string(), z.any()),
        raw: z.string().optional(),
        output: z.preprocess((value) => normalizeToolOutputText(value), z.string()),
        modelOutput: z.any().optional(),
        title: z.string(),
        metadata: z.record(z.string(), z.any()),
        time: z.object({
            start: z.number(),
            end: z.number(),
            compacted: z.number().optional(), // 如果工具输出过长被压缩，记录压缩发生的时间
        }),
        attachments: AttachmentPart.array().optional(), // 工具可以返回文件，例如生成的图片
    })
    .meta({
        ref: "ToolStateCompleted",
    })
export type ToolStateCompleted = z.infer<typeof ToolStateCompleted>

export const ToolStateWaitingApproval = z
    .object({
        status: z.literal("waiting-approval"),
        approvalID: z.string(),
        input: z.record(z.string(), z.any()),
        raw: z.string().optional(),
        title: z.string().optional(),
        metadata: z.record(z.string(), z.any()).optional(),
        time: z.object({
            start: z.number(),
        }),
    })
    .meta({
        ref: "ToolStateWaitingApproval",
    })
export type ToolStateWaitingApproval = z.infer<typeof ToolStateWaitingApproval>

export const ToolStateDenied = z
    .object({
        status: z.literal("denied"),
        approvalID: z.string().optional(),
        input: z.record(z.string(), z.any()),
        raw: z.string().optional(),
        reason: z.string(),
        metadata: z.record(z.string(), z.any()).optional(),
        time: z.object({
            start: z.number(),
            end: z.number(),
        }),
    })
    .meta({
        ref: "ToolStateDenied",
    })
export type ToolStateDenied = z.infer<typeof ToolStateDenied>

export const ToolStateCancelled = z
    .object({
        status: z.literal("cancelled"),
        input: z.record(z.string(), z.any()),
        raw: z.string().optional(),
        reason: z.string(),
        metadata: z.record(z.string(), z.any()).optional(),
        time: z.object({
            start: z.number(),
            end: z.number(),
        }),
    })
    .meta({
        ref: "ToolStateCancelled",
    })
export type ToolStateCancelled = z.infer<typeof ToolStateCancelled>

export const ToolStateError = z
    .object({
        status: z.literal("error"),
        input: z.record(z.string(), z.any()),
        raw: z.string().optional(),
        error: z.string(),
        metadata: z.record(z.string(), z.any()).optional(),
        time: z.object({
            start: z.number(),
            end: z.number(),
        }),
    })
    .meta({
        ref: "ToolStateError",
    })
export type ToolStateError = z.infer<typeof ToolStateError>

export function normalizeToolOutputText(output: unknown): string {
    if (typeof output === "string") return output
    if (output == null) return ""

    if (typeof output === "object") {
        const candidate = output as Record<string, unknown>
        if (typeof candidate.result === "string") return candidate.result
        if (typeof candidate.value === "string") return candidate.value
        if (typeof candidate.text === "string") return candidate.text

        try {
            const serialized = JSON.stringify(output)
            if (serialized) return serialized
        } catch {
            // ignore and fall through to String(output)
        }
    }

    return String(output)
}

export const ToolState = z
    .discriminatedUnion("status", [
        ToolStatePending,
        ToolStateRunning,
        ToolStateWaitingApproval,
        ToolStateCompleted,
        ToolStateDenied,
        ToolStateCancelled,
        ToolStateError,
    ])
    .meta({
        ref: "ToolState",
    })

export const ToolPart = PartBase.extend({
    type: z.literal("tool"),
    callID: z.string(),
    tool: z.string(),
    providerExecuted: z.boolean().optional(),
    state: ToolState,
    metadata: z.record(z.string(), z.any()).optional(),
}).meta({
    ref: "ToolPart",
})
export type ToolPart = z.infer<typeof ToolPart>

export const PermissionPart = PartBase.extend({
    type: z.literal("permission"),
    approvalID: z.string(),
    toolCallID: z.string(),
    tool: z.string(),
    action: Permission.Action,
    reason: z.string().optional(),
    created: z.number(),
}).meta({
    ref: "PermissionPart",
})
export type PermissionPart = z.infer<typeof PermissionPart>

export const SubtaskPart = PartBase.extend({
    type: z.literal("subtask"),
    prompt: z.string(),
    description: z.string(),
    agent: z.string(),
    model: z
        .object({
            providerID: z.string(),
            modelID: z.string(),
        })
        .optional(),
    command: z.string().optional(),
}).meta({
    ref: "SubtaskPart",
})
export type SubtaskPart = z.infer<typeof SubtaskPart>

export const StepStartPart = PartBase.extend({
    type: z.literal("step-start"),
    snapshot: z.string().optional(),
}).meta({
    ref: "StepStartPart",
})
export type StepStartPart = z.infer<typeof StepStartPart>

export const StepFinishPart = PartBase.extend({
    type: z.literal("step-finish"),
    reason: z.string(),
    snapshot: z.string().optional(),
    cost: z.number(),
    tokens: z.object({
        input: z.number(),
        output: z.number(),
        reasoning: z.number(),
        cache: z.object({
            read: z.number(),
            write: z.number(),
        }),
    }),
}).meta({
    ref: "StepFinishPart",
})
export type StepFinishPart = z.infer<typeof StepFinishPart>

export const RetryPart = PartBase.extend({
    type: z.literal("retry"),
    attempt: z.number(),
    //error: APIError.Schema,
    time: z.object({
        created: z.number(),
    }),
}).meta({
    ref: "RetryPart",
})
export type RetryPart = z.infer<typeof RetryPart>

export const Part = z
    .discriminatedUnion("type", [
        TextPart,
        MessageQuotePart,
        SubtaskPart,
        ReasoningPart,
        SourceUrlPart,
        SourceDocumentPart,
        FilePart,
        ToolPart,
        PermissionPart,
        StepStartPart,
        StepFinishPart,
        SnapshotPart,
        PatchPart,
        AgentPart,
        RetryPart,
        CompactionPart,
        ImagePart,
    ])
    .meta({
        ref: "Part",
    })
export type Part = z.infer<typeof Part>


//---------------消息元数据----------------------------------------------------------------------------

const Base = z.object({
    id: z.string(),
    sessionID: z.string(),
    turnID: Identifier.schema("turn").optional(),
    parentMessageID: z.string().nullable().optional(),
})
export const ReasoningEffort = ReasoningEffortSchema.meta({
    ref: "ReasoningEffort",
})
export type ReasoningEffort = z.infer<typeof ReasoningEffort>
export const OpenAIReasoningEffort = ReasoningEffort.meta({
    ref: "OpenAIReasoningEffort",
})
export type OpenAIReasoningEffort = ReasoningEffort
export const User = Base.extend({
    role: z.literal("user"),
    created: z.number(),
    diffSummary: MessageDiffSummary.optional(),
    agent: z.string(),
    model: z.object({
        providerID: z.string(),
        modelID: z.string(),
    }),
    system: z.string().optional(),
    displayText: z.string().optional(),
    skills: z.array(z.string()).optional(),
    turnMcpServerIDs: z.array(z.string()).optional(),
    turnToolModuleIDs: z.array(ToolModuleIDSchema).optional(),
    tools: z.record(z.string(), z.boolean()).optional(),
    internal: z.boolean().optional(),
    variant: z.string().optional(),
    reasoningEffort: ReasoningEffort.optional(),
}).meta({
    ref: "UserMessage",
})
export type User = z.infer<typeof User>

export const Assistant = Base.extend({
    role: z.literal("assistant"),
    created: z.number(),
    completed: z.number().optional(),
    diffSummary: MessageDiffSummary.optional(),
    error: z
        .discriminatedUnion("name", [
            AuthError.Schema,
            NamedError.Unknown.Schema,
            OutputLengthError.Schema,
            AbortedError.Schema,
            APIError.Schema,
        ])
        .optional(),
    parentID: z.string(),
    modelID: z.string(),
    providerID: z.string(),
    agent: z.string(),
    path: z.object({
        cwd: z.string(),
        root: z.string(),
    }),
    cost: z.number(),
    tokens: z.object({
        input: z.number(),
        output: z.number(),
        reasoning: z.number(),
        cache: z.object({
            read: z.number(),
            write: z.number(),
        }),
    }),
    finishReason: z.string().optional(),
}).meta({
    ref: "AssistantMessage",
})
export type Assistant = z.infer<typeof Assistant>

export const System = Base.extend({
    role: z.literal("system"),
    created: z.number(),
    modelID: z.string(),
    providerID: z.string(),
    agent: z.string(),
}).meta({
    ref: "SystemMessage",
})
export type System = z.infer<typeof System>

export const MessageInfo = z.discriminatedUnion("role", [User, Assistant,System]).meta({
    ref: "Message",
})
export type MessageInfo = z.infer<typeof MessageInfo>

// message 的 content + meta，可以理解为一条完整消息
export const WithParts = z.object({
    info: MessageInfo,//元数据
    parts: z.array(Part),//消息的具体内容
})
export type WithParts = z.infer<typeof WithParts>

// function Create<T extends z.ZodObject>(rawshape: z.ZodRawShape): T {
//     const result = z.object(rawshape)
//     return result
// }


// TODO: move message events out of message.ts after the schema settles.
export const Event = {
    Updated: define(
        "message.updated",
        z.object({
            info: MessageInfo,
        }),
    ),
    Removed: define(
        "message.removed",
        z.object({
            sessionID: z.string(),
            messageID: z.string(),
        }),
    ),
    PartUpdated: define(
        "message.part.updated",
        z.object({
            part: Part,
            delta: z.string().optional(),
        }),
    ),
    PartRemoved: define(
        "message.part.removed",
        z.object({
            sessionID: z.string(),
            messageID: z.string(),
            partID: z.string(),
        }),
    ),
    PartDelta: define(
        "message.part.delta",
        z.object({
            sessionID: z.string(),
            messageID: z.string(),
            partID: z.string(),
            field: z.string(),
            delta: z.string(),
        })
    )
}

function loadSessionMessages(sessionID: string): MessageInfo[] {
    const messages = db.findManyWithSchema("messages", MessageInfo, {
        where: [{ column: "sessionID", value: sessionID }],
        orderBy: [
            { column: "created", direction: "ASC" },
            { column: "id", direction: "ASC" },
        ],
    })

    return messages
}

function attachParts(messages: MessageInfo[]): WithParts[] {
    if (messages.length === 0) return []

    const sessionID = messages[0]!.sessionID
    const parts = db.findManyWithSchema("parts", Part, {
        where: [{ column: "sessionID", value: sessionID }],
        orderBy: [{ column: "id", direction: "ASC" }],
    })

    const partsByMessageID = new Map<string, Part[]>()
    for (const part of parts) {
        const list = partsByMessageID.get(part.messageID) ?? []
        list.push(part)
        partsByMessageID.set(part.messageID, list)
    }

    return messages.map((message) => ({
        info: message,
        parts: partsByMessageID.get(message.id) ?? [],
    }))
}

function readActiveMessageID(sessionID: string): string | null | undefined {
    try {
        const row = db.db
            .prepare(`SELECT "activeMessageID" FROM "sessions" WHERE "id" = ? LIMIT 1`)
            .get(sessionID) as { activeMessageID?: unknown } | undefined
        if (!row) return undefined
        return typeof row.activeMessageID === "string" && row.activeMessageID.trim()
            ? row.activeMessageID
            : null
    } catch (error) {
        log.warn("failed to read session active message head", {
            sessionID,
            error: error instanceof Error ? error.message : String(error),
        })
        return undefined
    }
}

function fallbackToLinearHistory(sessionID: string, messages: MessageInfo[], reason: string, details?: Record<string, unknown>) {
    log.warn("falling back to linear session history", {
        sessionID,
        reason,
        ...details,
    })
    return messages
}

function resolveBranchMessages(sessionID: string, headMessageID: string, messages: MessageInfo[]): MessageInfo[] {
    const messageByID = new Map(messages.map((message) => [message.id, message]))
    let currentID: string | null | undefined = headMessageID
    const seen = new Set<string>()
    const path: MessageInfo[] = []

    while (currentID) {
        if (seen.has(currentID)) {
            throw new Error(`Message branch contains a cycle at '${currentID}'.`)
        }
        seen.add(currentID)

        const message = messageByID.get(currentID)
        if (!message) {
            const referenced = db.findById("messages", MessageInfo, currentID)
            if (referenced) {
                throw new Error(`Message '${currentID}' belongs to a different session.`)
            }
            throw new Error(`Message branch references missing message '${currentID}'.`)
        }

        if (message.sessionID !== sessionID) {
            throw new Error(`Message '${message.id}' belongs to a different session.`)
        }

        path.push(message)
        currentID = message.parentMessageID
    }

    return path.reverse()
}

export function listAllWithParts(sessionID: string): WithParts[] {
    return attachParts(loadSessionMessages(sessionID))
}

export function listBranch(sessionID: string, headMessageID: string): WithParts[] {
    const normalizedHeadMessageID = headMessageID.trim()
    if (!normalizedHeadMessageID) {
        throw new Error("Branch head message ID is required.")
    }
    const messages = loadSessionMessages(sessionID)
    return attachParts(resolveBranchMessages(sessionID, normalizedHeadMessageID, messages))
}

export function listActiveBranch(sessionID: string): WithParts[] {
    const messages = loadSessionMessages(sessionID)
    if (messages.length === 0) return []
    const activeMessageID = readActiveMessageID(sessionID)
    if (!activeMessageID) {
        return attachParts(fallbackToLinearHistory(sessionID, messages, "missing_active_message_id"))
    }
    try {
        return attachParts(resolveBranchMessages(sessionID, activeMessageID, messages))
    } catch (error) {
        return attachParts(fallbackToLinearHistory(sessionID, messages, "invalid_active_branch", {
            activeMessageID,
            error: error instanceof Error ? error.message : String(error),
        }))
    }
}

// TODO: move message streaming/query helpers out of message.ts after the schema settles.
export async function* stream(sessionID: string): AsyncGenerator<WithParts> {
    for (const message of listActiveBranch(sessionID)) {
        yield message
    }
}

/**
 * 将项目内部的消息格式 `WithParts[]` 转换为 AI SDK 使用的 `ModelMessage[]`。
 *
 * 该函数会遍历每条消息，根据角色将内部消息映射为 AI SDK 的消息角色，
 * 并把消息中的各类 part 转换为 AI SDK 可识别的内容类型，例如
 * `text`、`reasoning`、`file`、`image`、`tool-call` 和 `tool-result`。
 *
 * 转换过程中会结合模型能力配置 `capabilities` 过滤掉目标模型不支持的内容类型。
 *
 * @param input 项目内部消息数组。每条消息都包含元数据 `info` 和内容片段 `parts`
 * @param model 目标模型信息，包含模型能力配置，用于过滤不支持的内容类型
 * @returns 符合 AI SDK 格式的消息数组，可直接用于模型调用
 */
export type ModelMessageImageWindowOptions = {
    maxHistoricalImageParts: number
    preserveAllImagePartsForMessageID?: string
}

function isImageAttachmentPart(part: Part): part is ImagePart | FilePart {
    return part.type === "image" || (part.type === "file" && part.mime.trim().toLowerCase().startsWith("image/"))
}

function normalizeImageWindowLimit(value: number) {
    if (!Number.isFinite(value)) return 0
    return Math.max(0, Math.floor(value))
}

function omittedImageWindowText(part: ImagePart | FilePart) {
    const filename = part.filename?.trim()
    return `Earlier image omitted from model input due to the image history window: mime=${part.mime}${filename ? `, filename=${filename}` : ""}.`
}

// TODO: move model message conversion out of message.ts after the schema settles.
export async function toModelMessages(
    input: WithParts[],
    model: Provider.Model,
    options?: {
        agent?: Agent.AgentInfo
        imageWindow?: ModelMessageImageWindowOptions
    },
): Promise<ModelMessage[]> {
    const result: ModelMessage[] = []
    const toolRuntimeCache = new Map<string, Promise<any | undefined>>()
    const modelLabel = `${model.providerID}/${model.id}`
    const replayAssistantReasoning = shouldReplayAssistantReasoning(model)
    const imageWindow = options?.imageWindow ?? (model.capabilities.output?.image
        ? { maxHistoricalImageParts: 1 }
        : undefined)
    const omittedImagePartIDs = new Set<string>()
    const imageCount = input.reduce((count, item) => count + item.parts.filter((part) => part.type === "image").length, 0)
    const fileCount = input.reduce((count, item) => count + item.parts.filter((part) => part.type === "file").length, 0)

    if (imageWindow) {
        let remainingHistoricalImages = normalizeImageWindowLimit(imageWindow.maxHistoricalImageParts)
        for (let itemIndex = input.length - 1; itemIndex >= 0; itemIndex -= 1) {
            const item = input[itemIndex]
            if (!item) continue
            const preserveAllImagesInMessage = Boolean(imageWindow.preserveAllImagePartsForMessageID && item.info.id === imageWindow.preserveAllImagePartsForMessageID)
            const orderedParts = [...item.parts].sort((a, b) => b.id.localeCompare(a.id))
            for (const part of orderedParts) {
                if (!isImageAttachmentPart(part)) continue
                if (preserveAllImagesInMessage) continue
                if (remainingHistoricalImages > 0) {
                    remainingHistoricalImages -= 1
                    continue
                }
                omittedImagePartIDs.add(part.id)
            }
        }
    }

    if (imageCount > 0 || fileCount > 0) {
        log.info("preparing model messages with attachments", {
            model: modelLabel,
            messageCount: input.length,
            imageCount,
            fileCount,
            imageWindow: imageWindow ? {
                maxHistoricalImageParts: normalizeImageWindowLimit(imageWindow.maxHistoricalImageParts),
                preserveAllImagePartsForMessageID: imageWindow.preserveAllImagePartsForMessageID,
                omittedImagePartCount: omittedImagePartIDs.size,
            } : undefined,
            capabilities: summarizeModelCapabilitiesForLog(model),
        })
    }

    async function getToolModules() {
        const [toolModule, registryModule] = await Promise.all([
            import("#tool/tool.ts"),
            import("#tool/registry.ts"),
        ])

        return {
            Tool: toolModule,
            ToolRegistry: registryModule,
        }
    }

    function unsupportedAttachmentMessage(part: FilePart | ImagePart, model: Provider.Model) {
        if (part.type === "image") {
            if (!model.capabilities.input.image) {
                const message = `Model '${modelLabel}' does not support image input. Select a multimodal model before sending images.`
                log.warn("image attachment rejected by model capabilities", {
                    model: modelLabel,
                    part: summarizeAttachmentPartForLog(part),
                    capabilities: summarizeModelCapabilitiesForLog(model),
                })
                return message
            }
            return
        }

        if (!model.capabilities.attachment) {
            const message = `Model '${modelLabel}' does not support file attachments.`
            log.warn("file attachment rejected by model capabilities", {
                model: modelLabel,
                part: summarizeAttachmentPartForLog(part),
                capabilities: summarizeModelCapabilitiesForLog(model),
            })
            return message
        }

        if (part.mime.toLowerCase() === "application/pdf" && !model.capabilities.input.pdf) {
            const message = `Model '${modelLabel}' does not support PDF input. Select a model with PDF support before sending PDFs.`
            log.warn("pdf attachment rejected by model capabilities", {
                model: modelLabel,
                part: summarizeAttachmentPartForLog(part),
                capabilities: summarizeModelCapabilitiesForLog(model),
            })
            return message
        }
    }

    function escapeMessageQuoteText(value: string) {
        return value
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
    }

    function convertPartToAIPart(part: Part, model: Provider.Model, aiRole: "user" | "assistant"): any | any[] | null {
        switch (part.type) {
            case "text":
                if (part.ignored) return null
                return {
                    type: "text" as const,
                    text: summarizeQuestionAnswerForModel(part),
                }
            case "message-quote":
                return {
                    type: "text" as const,
                    text: [
                        `<message-quote source_message_id="${escapeMessageQuoteText(part.sourceMessageID)}">`,
                        escapeMessageQuoteText(part.text),
                        "</message-quote>",
                    ].join("\n"),
                }
            case "reasoning":
                if (!replayAssistantReasoning) {
                    // Keep reasoning parts available for local UI/debugging when
                    // a provider or model explicitly opts out of replay.
                    return null
                }
                const reasoningProviderOptions = providerOptionsFromMetadata(part.metadata)
                return {
                    type: "reasoning" as const,
                    text: part.text,
                    ...(reasoningProviderOptions ? { providerOptions: reasoningProviderOptions } : {}),
                }
            case "file":
                if (isImageAttachmentPart(part) && omittedImagePartIDs.has(part.id)) {
                    return {
                        type: "text" as const,
                        text: omittedImageWindowText(part),
                    }
                }
                {
                    const message = unsupportedAttachmentMessage(part, model)
                    if (message) throw new Error(message)
                }
                log.info("converting file attachment for model input", {
                    model: modelLabel,
                    part: summarizeAttachmentPartForLog(part),
                })
                const decodedFile = decodeDataUrlAttachment(part.url)
                return {
                    type: "file" as const,
                    data: decodedFile?.data ?? part.url,
                    mediaType: decodedFile?.mediaType ?? part.mime,
                    filename: part.filename,
                }
            case "image":
                if (omittedImagePartIDs.has(part.id)) {
                    return {
                        type: "text" as const,
                        text: omittedImageWindowText(part),
                    }
                }
                {
                    const message = unsupportedAttachmentMessage(part, model)
                    if (message) throw new Error(message)
                }
                log.info("converting image attachment for model input", {
                    model: modelLabel,
                    part: summarizeAttachmentPartForLog(part),
                    aiRole,
                })
                const decodedImage = decodeDataUrlAttachment(part.url)
                if (aiRole === "assistant") {
                    return {
                        type: "file" as const,
                        data: decodedImage?.data ?? part.url,
                        mediaType: decodedImage?.mediaType ?? part.mime,
                        filename: part.filename,
                    }
                }
                return {
                    type: "image" as const,
                    image: decodedImage?.data ?? part.url,
                    mediaType: decodedImage?.mediaType ?? part.mime,
                }
            case "tool":
            case "permission":
            case "compaction":
                return null
            default:
                return null
        }
    }

    async function resolveToolModelOutput(part: ToolPart): Promise<{
        type: "text" | "json" | "error-text" | "error-json" | "execution-denied"
        value?: unknown
        reason?: string
    }> {
        const state = part.state
        if (state.status === "completed") {
            const persisted = ToolResultPersistence.readPersistedOutputMetadata(state.metadata)
            if (persisted) {
                return {
                    type: "text",
                    value: persisted.replacement,
                }
            }
        }

        if (part.providerExecuted && state.status === "completed" && state.modelOutput !== undefined) {
            return state.modelOutput as {
                type: "text" | "json" | "error-text" | "error-json" | "execution-denied"
                value?: unknown
                reason?: string
            }
        }

        if (state.status === "denied") {
            return {
                type: "execution-denied",
                reason: state.reason,
            }
        }

        if (state.status === "error") {
            return {
                type: "error-text",
                value: state.error,
            }
        }

        if (state.status === "cancelled") {
            return {
                type: "error-text",
                value: state.reason,
            }
        }

        const cachedRuntime = toolRuntimeCache.get(part.tool) ?? (async () => {
            const { ToolRegistry } = await getToolModules()
            const info = await ToolRegistry.get(part.tool)
            if (!info) return undefined
            return info.init(options?.agent ? { agent: options.agent } : undefined)
        })()

        toolRuntimeCache.set(part.tool, cachedRuntime)
        const runtime = await cachedRuntime
        const completed = state as ToolStateCompleted
        const reconstructed = {
            text: completed.output,
            title: completed.title,
            metadata: completed.metadata,
            attachments: completed.attachments?.map((attachment) => ({
                url: attachment.url,
                mime: attachment.mime,
                filename: attachment.filename,
            })),
        }

        const { Tool } = await getToolModules()
        if (!runtime?.toModelOutput) {
            return Tool.normalizeToolModelOutput(reconstructed.text)
        }

        return Tool.normalizeToolModelOutput(await runtime.toModelOutput(reconstructed))
    }

    for (const item of input) {
        const role = item.info.role
        let aiRole: "user" | "assistant"
        if (role === "user") {
            aiRole = "user"
        } else if (role === "assistant") {
            aiRole = "assistant"
        } else {
            continue
        }

        const orderedParts = [...item.parts].sort((a, b) => a.id.localeCompare(b.id))
        const approvalsByToolCallID = new Map<string, PermissionPart[]>()
        for (const part of orderedParts) {
            if (part.type !== "permission") continue
            const list = approvalsByToolCallID.get(part.toolCallID) ?? []
            list.push(part)
            approvalsByToolCallID.set(part.toolCallID, list)
        }

        const assistantContent: any[] = []
        const toolContent: any[] = []

        for (const part of orderedParts) {
            if (aiRole === "assistant" && part.type === "tool") {
                const state = part.state
                const approvals = approvalsByToolCallID.get(part.callID) ?? []
                const approvalRequest = approvals.find((approval) => approval.action === "ask")
                const approvalResponse = approvals.find(
                    (approval) => approval.action === "allow" || approval.action === "deny",
                )

                if (
                    state.status === "waiting-approval" ||
                    state.status === "completed" ||
                    state.status === "error" ||
                    state.status === "denied" ||
                    state.status === "cancelled"
                ) {
                    const toolName = modelSafeToolName(part.tool, part.providerExecuted)
                    const toolCallProviderOptions = providerOptionsFromMetadata(part.metadata)
                    assistantContent.push({
                        type: "tool-call" as const,
                        toolCallId: part.callID,
                        toolName,
                        input: state.input,
                        ...(part.providerExecuted ? { providerExecuted: true } : {}),
                        ...(toolCallProviderOptions ? { providerOptions: toolCallProviderOptions } : {}),
                    })

                    if (approvalRequest) {
                        assistantContent.push({
                            type: "tool-approval-request" as const,
                            approvalId: approvalRequest.approvalID,
                            toolCallId: part.callID,
                        })
                    }

                    if (part.providerExecuted && (state.status === "completed" || state.status === "error" || state.status === "cancelled")) {
                        const toolResultProviderOptions = providerOptionsFromMetadata(state.metadata)
                        assistantContent.push({
                            type: "tool-result" as const,
                            toolCallId: part.callID,
                            toolName,
                            output: await resolveToolModelOutput(part),
                            ...(toolResultProviderOptions ? { providerOptions: toolResultProviderOptions } : {}),
                        })
                    }
                    if (approvalRequest && approvalResponse) {
                        toolContent.push({
                            type: "tool-approval-response" as const,
                            approvalId: approvalRequest.approvalID,
                            approved: approvalResponse.action === "allow",
                            reason: approvalResponse.reason,
                            ...(part.providerExecuted ? { providerExecuted: true } : {}),
                        })
                    }

                    if (!part.providerExecuted && (state.status === "completed" || state.status === "error" || state.status === "denied" || state.status === "cancelled")) {
                        toolContent.push({
                            type: "tool-result" as const,
                            toolCallId: part.callID,
                            toolName,
                            output: await resolveToolModelOutput(part),
                        })
                    }

                    continue
                }
            }

            const aiPart = convertPartToAIPart(part, model, aiRole)
            if (!aiPart) continue

            if (Array.isArray(aiPart)) {
                assistantContent.push(...aiPart)
            } else {
                assistantContent.push(aiPart)
            }
        }

        if (assistantContent.length > 0) {
            result.push({
                role: aiRole,
                content: [...assistantContent],
            } as ModelMessage)
        }

        if (aiRole === "assistant" && toolContent.length > 0) {
            result.push({
                role: "tool",
                content: toolContent as any,
            } as ModelMessage)
        }
    }

    return result
}
