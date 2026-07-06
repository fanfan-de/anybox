import { Instance } from "#project/instance.ts";
import * as Log from "#util/log.ts";
import z from "zod";
import * as Identifier from "#id/id.ts";
import { fn } from "#util/fn.ts";
import * as Status from "#session/runtime/status.ts";
import * as Session from "#session/core/session.ts";
import * as Processor from "#session/core/processor.ts";
import * as ModelRegistry from "#model/registry.ts"
import * as Provider from "#provider/provider.ts";
import * as db from "#database/Sqlite.ts";
import * as Agent from "#agent/agent.ts";
import * as SystemPrompt from "#session/core/system.ts"
import * as Skill from "#skill/skill.ts"
import * as Snapshot  from "#snapshot/snapshot.ts"
import * as SessionDiff from "#session/diff/diff.ts"
import { Flag } from "#flag/flag.ts"
import * as Orchestrator from "#session/runtime/orchestrator.ts"
import * as EventStore from "#session/runtime/event-store.ts"
import * as RunningState from "#session/runtime/running-state.ts"
import * as SessionRunner from "#session/runtime/session-runner.ts"
import * as ContextWindow from "#session/core/context-window.ts"
import * as RuntimeEvent from "#session/runtime/runtime-event.ts"
import * as SessionTitle from "#session/support/title.ts"
import * as PromptPresets from "#session/support/prompt-presets.ts"
import * as TurnError from "#session/core/turn-error.ts"

import * as Message from "./message";
import { resolveTools } from "./resolve-tools.ts";

/**
 * Agent prompt 编排层。
 *
 * 核心流向：
 * 1. prompt(): 新建 user message / parts，并启动本轮对话。
 * 2. resume(): 不创建新 user message，只继续推进已有对话。
 * 3. runLoop(): 每轮重建上下文，拼装 system/messages/tools，交给 Processor 执行。
 *
 * 约束：数据库是会话真相；SessionRunner 只保存当前进程内运行队列和 AbortController。
 */

const log = Log.create({ service: "session.prompt" });
const DEFAULT_PROMPT_LOOP_LIMIT = Number.POSITIVE_INFINITY
const HARD_PROMPT_LOOP_LIMIT = Flag.ANYBOX_EXPERIMENTAL_AGENT_LOOP_LIMIT
const DANGLING_TOOL_CALL_ERROR =
    "Recovered dangling tool call from an earlier interrupted run before resuming."
const MODEL_CALL_PATCH_MAX_PATCH_BYTES = 128 * 1024
const MODEL_CALL_PATCH_MAX_FILES = 200
const MODEL_CALL_PATCH_MAX_TOTAL_PATCH_BYTES = 512 * 1024

// ---------------------------------------------------------------------------
// 输入协议与运行态
// ---------------------------------------------------------------------------

// 当前正在执行的 session loop 控制器；历史消息始终以数据库为准。
export function state() {
    return RunningState.state();
}

// 外部 prompt API 入参。保存时会被拆成 message 和 part 两层结构。
export const PromptInput = z.object({
    sessionID: Identifier.schema("session"),
    parentMessageID: Identifier.schema("message").nullable().optional(),
    model: z
        .object({
            providerID: z.string(),
            modelID: z.string(),
        })
        .optional(),
    agent: z.string().optional(),
    noReply: z.boolean().optional(),
    internal: z.boolean().optional(),
    system: z.string().optional(),
    displayText: z.string().optional(),
    skills: z.array(z.string()).optional(),
    concurrentInputMode: z.enum(["queue", "steer"]).optional(),
    variant: z.string().optional(),
    reasoningEffort: Message.ReasoningEffort.optional(),
    parts: z.array(
        z.discriminatedUnion("type", [
            Message.TextPart.omit({
                messageID: true,
                sessionID: true,
            })
                .partial({
                    id: true,
                })
                .meta({
                    ref: "TextPartInput",
                }),
            Message.FilePart.omit({
                messageID: true,
                sessionID: true,
            })
                .partial({
                    id: true,
                })
                .meta({
                    ref: "FilePartInput",
                }),
            Message.ImagePart.omit({
                messageID: true,
                sessionID: true,
            })
                .partial({
                    id: true,
                })
                .meta({
                    ref: "ImagePartInput",
                }),
            Message.AgentPart.omit({
                messageID: true,
                sessionID: true,
            })
                .partial({
                    id: true,
                })
                .meta({
                    ref: "AgentPartInput",
                }),
            Message.SubtaskPart.omit({
                messageID: true,
                sessionID: true,
            })
                .partial({
                    id: true,
                })
                .meta({
                    ref: "SubtaskPartInput",
                }),
        ]),
    ),
});
export type PromptInput = z.infer<typeof PromptInput>;

async function persistMessageRecord(
    message: Message.MessageInfo,
    turn?: Orchestrator.TurnContext,
) {
    if (turn) {
        turn.emit("message.recorded", {
            message,
        })
        return
    }

    await Session.recordMessage(message)
}

async function persistRecoveredToolError(
    part: Message.ToolPart,
    turn?: Orchestrator.TurnContext,
) {
    if (turn) {
        turn.emit("tool.call.failed", {
            part,
        })
        return
    }

    await Session.updatePart(part)
}

async function captureSnapshot(input: {
    context: string
    sessionID: string
    messageID?: string
}) {
    return Snapshot.track().catch((error) => {
        log.warn(`failed to capture ${input.context} snapshot`, {
            sessionID: input.sessionID,
            messageID: input.messageID,
            error: error instanceof Error ? error.message : String(error),
        })
        return undefined
    })
}

function removeAssistantDiffSummary(message: Message.Assistant): Message.Assistant {
    const nextMessage = { ...message }
    delete nextMessage.diffSummary
    return nextMessage
}

async function persistAssistantTurnDiffSummary(input: {
    message: Message.Assistant
    fromSnapshot?: string
    toSnapshot?: string
    turn?: Orchestrator.TurnContext
}) {
    if (!input.fromSnapshot || !input.toSnapshot) return input.message

    const detailed = await SessionDiff.computeDetailedDiffBetweenSnapshots(
        input.fromSnapshot,
        input.toSnapshot,
        {
            includeContent: false,
            maxPatchBytes: MODEL_CALL_PATCH_MAX_PATCH_BYTES,
        },
    )
    const changes = toPatchFileChangeSummary(detailed.diffs)
    const summary: Message.MessageDiffSummary | undefined = changes.length > 0
        ? {
            ...SessionDiff.buildDiffSummary(changes),
            diffs: changes,
        }
        : undefined
    const nextMessage = summary
        ? {
            ...input.message,
            diffSummary: summary,
        }
        : removeAssistantDiffSummary(input.message)

    if (!summary && !input.message.diffSummary) return nextMessage

    await persistMessageRecord(nextMessage, input.turn)
    return nextMessage
}

async function removePartRecord(
    partID: string,
    turn?: Orchestrator.TurnContext,
    messageID?: string,
) {
    if (turn) {
        turn.emit("part.removed", {
            partID,
            messageID,
        })
        return
    }

    Session.deletePart(partID)
}

function normalizePromptErrorMessage(error: unknown) {
    if (error instanceof Error && error.message) {
        return error.message
    }

    return String(error)
}

function buildSideChatSystemPrompt(link: Session.SideChatLink) {
    const lines = [
        "<side_chat_context>",
    ]

    if (link.snapshot.userText?.trim()) {
        lines.push("", "Anchoring user question:", link.snapshot.userText.trim())
    }

    lines.push("", "Anchoring assistant reply:", link.snapshot.assistantText.trim())

    if ((link.snapshot.sources?.length ?? 0) > 0) {
        lines.push("", "Anchoring sources:")
        for (const source of link.snapshot.sources ?? []) {
            lines.push(`- ${source.kind}: ${source.title}${source.url ? ` (${source.url})` : ""}`)
        }
    }

    if ((link.snapshot.toolSummaries?.length ?? 0) > 0) {
        lines.push("", "Anchoring tool outcomes:")
        for (const summary of link.snapshot.toolSummaries ?? []) {
            lines.push(`- ${summary.tool} [${summary.status}]: ${summary.summary}`)
        }
    }

    if ((link.snapshot.filePaths?.length ?? 0) > 0) {
        lines.push("", "Anchoring files:", ...(link.snapshot.filePaths ?? []).map((filePath) => `- ${filePath}`))
    }

    lines.push("</side_chat_context>")
    return lines.join("\n")
}

function resolveUserMessageAgentName(session: Session.SessionInfo, requestedAgentName?: string) {
    if (Session.isSideChatSession(session)) {
        return Agent.SIDECHAT_AGENT_NAME
    }

    if (requestedAgentName === Agent.SIDECHAT_AGENT_NAME) {
        throw new Error("Agent 'sidechat' can only be used by side chat sessions.")
    }

    return requestedAgentName ?? "default"
}

function resolveRuntimeAgentName(session: Session.SessionInfo, requestedAgentName?: string) {
    if (Session.isSideChatSession(session)) {
        return Agent.SIDECHAT_AGENT_NAME
    }

    if (requestedAgentName === Agent.SIDECHAT_AGENT_NAME) {
        throw new Error("Agent 'sidechat' can only be used by side chat sessions.")
    }

    const workflow = Session.normalizeWorkflowState(session.workflow)
    return workflow.mode === "planning" ? "plan" : requestedAgentName ?? "default"
}

function summarizeRuntimeTool(part: Message.ToolPart) {
    return {
        callID: part.callID,
        tool: part.tool,
        status: part.state.status,
    }
}

function isAskUserQuestionPart(part: Message.Part): part is Message.ToolPart & {
    state: Message.ToolStateCompleted
} {
    if (part.type !== "tool" || part.state.status !== "completed") {
        return false
    }

    const metadata = part.state.metadata
    return Boolean(
        metadata &&
        typeof metadata === "object" &&
        !Array.isArray(metadata) &&
        metadata.kind === "ask-user-question" &&
        metadata.answered !== true,
    )
}

function inferFailurePhase(parts: Message.Part[]): RuntimeEvent.TurnRuntimePhase | undefined {
    const toolParts = parts.filter((part): part is Message.ToolPart => part.type === "tool")

    if (toolParts.some((part) => part.state.status === "waiting-approval")) {
        return "waiting_approval"
    }

    if (toolParts.some((part) => part.state.status === "running" || part.state.status === "pending")) {
        return "executing_tool"
    }

    if (parts.some((part) => part.type === "text")) {
        return "responding"
    }

    if (parts.some((part) => part.type === "reasoning")) {
        return "reasoning"
    }

    return undefined
}

function emitTurnFailureContext(input: {
    turn: Orchestrator.TurnContext
    error?: unknown
    errorInfo?: TurnError.TurnErrorInfo
    assistant?: Message.Assistant
    parts: Message.Part[]
}) {
    const toolParts = input.parts.filter((part): part is Message.ToolPart => part.type === "tool")
    const activeTools = toolParts
        .filter((part) =>
            part.state.status === "pending" ||
            part.state.status === "running" ||
            part.state.status === "waiting-approval",
        )
        .map(summarizeRuntimeTool)
    const latestTool = toolParts.length > 0 ? summarizeRuntimeTool(toolParts[toolParts.length - 1]!) : undefined
    const errorInfo = input.errorInfo ?? TurnError.fromUnknown(input.error)

    input.turn.emit("turn.error.context", {
        phase: inferFailurePhase(input.parts),
        messageID: input.assistant?.id,
        agent: input.assistant?.agent,
        model: input.assistant
            ? {
                providerID: input.assistant.providerID,
                modelID: input.assistant.modelID,
            }
            : undefined,
        error: {
            name: errorInfo.name,
            message: errorInfo.message,
            code: errorInfo.code,
            statusCode: errorInfo.statusCode,
            retryable: errorInfo.retryable,
        },
        activeTools,
        latestTool,
    })
}

function throwIfAborted(abort: AbortSignal, message = "Prompt aborted") {
    if (abort.aborted) throw new Error(message)
}

function isTurnAbort(runtime: SessionRunner.PromptRuntime) {
    return runtime.abort.aborted
}

function emitTurnCancelled(input: {
    turn: Orchestrator.TurnContext
    reason?: RuntimeEvent.RuntimeEventPayloadByType["turn.cancelled"]["reason"]
    detail?: string
}) {
    input.turn.emit("turn.state.changed", {
        phase: "cancelled",
        reason: input.detail ?? "Prompt cancellation requested.",
    })
    input.turn.emit("turn.cancelled", {
        reason: input.reason ?? "user",
        detail: input.detail ?? "Prompt cancellation requested.",
    })
}

function emitTurnCancellationRequested(input: {
    turn: Orchestrator.TurnContext
    detail?: string
}) {
    input.turn.emit("turn.state.changed", {
        phase: "cancelled",
        reason: input.detail ?? "Prompt cancellation requested.",
    })
}

function emitQueuedTurnCancelled(input: {
    sessionID: string
    turnID: string
    reason?: RuntimeEvent.RuntimeEventPayloadByType["turn.cancelled"]["reason"]
    detail?: string
}) {
    const factory = RuntimeEvent.createRuntimeEventFactory({
        sessionID: input.sessionID,
        turnID: input.turnID,
    })
    EventStore.appendAndProject(factory.next("turn.cancelled", {
        reason: input.reason ?? "user",
        detail: input.detail ?? "Queued prompt operation was cancelled before it started.",
    }))
}

function finishPromptTurnFromResult(
    turn: Orchestrator.TurnContext,
    result: RunLoopResult,
) {
    const phase = result.status === "blocked"
        ? "blocked"
        : result.status === "failed"
            ? "failed"
            : result.status === "continued_by_user"
                ? "continued_by_user"
                : "completed"

    Session.updateTurn(turn.turnID, {
        status: result.status,
        phase,
        lastMessageID: result.latest.info.id,
        finishReason: result.finishReason,
        error: result.errorInfo?.message,
        errorInfo: result.errorInfo,
    })

    if (result.status === "failed") {
        const errorInfo = result.errorInfo ?? TurnError.fromMessage("Assistant turn failed.", "TurnFailed")
        emitTurnFailureContext({
            turn,
            errorInfo,
            assistant: result.latest.info.role === "assistant" ? result.latest.info : undefined,
            parts: result.latest.parts,
        })
        turn.emit("turn.state.changed", {
            phase: "failed",
            reason: errorInfo.message,
            messageID: result.latest.info.id,
        })
        turn.emit("turn.failed", {
            error: errorInfo.message,
            errorInfo,
            message: result.latest.info,
            parts: result.latest.parts,
        })
        return
    }

    turn.emit("turn.state.changed", {
        phase,
        reason: result.status === "continued_by_user" ? "Continued by user input." : result.finishReason,
        messageID: result.latest.info.id,
    })

    turn.emit("turn.completed", {
        status: result.status,
        finishReason: result.finishReason,
        message: result.latest.info,
        parts: result.latest.parts,
    })
}

export function cancelSession(sessionID: string, options?: { cancelQueued?: boolean; reason?: RuntimeEvent.RuntimeEventPayloadByType["turn.cancelled"]["reason"] }) {
    const turn = Orchestrator.activeTurn(sessionID)
    if (turn) {
        Session.updateTurn(turn.turnID, {
            status: "cancelled",
            phase: "cancelled",
            error: "Prompt cancellation requested.",
        })
        emitTurnCancellationRequested({
            turn,
        })
    }

    const result = RunningState.cancelSession(sessionID, {
        cancelQueued: options?.cancelQueued,
    });
    for (const turnID of result.queuedCancelledTurnIDs) {
        emitQueuedTurnCancelled({
            sessionID,
            turnID,
            reason: options?.reason ?? "user",
        })
    }
    return result
}

export function cancel(sessionID: string) {
    return cancelSession(sessionID).cancelled
}

type RunLoopResult = {
    latest: Message.WithParts
    status: "completed" | "blocked" | "failed" | "continued_by_user"
    finishReason?: string
    errorInfo?: TurnError.TurnErrorInfo
}

type AssistantWithParts = Message.WithParts & {
    info: Message.Assistant
}

function isInternalUserMessage(message: Message.WithParts) {
    return message.info.role === "user" && message.info.internal === true
}

function hasInternalUserMessageAfter(messages: Message.WithParts[], assistantID: string) {
    const assistantIndex = messages.findIndex((message) => message.info.id === assistantID)
    if (assistantIndex < 0) return false

    return messages
        .slice(assistantIndex + 1)
        .some((message) => message.info.role === "user" && message.info.internal === true)
}

function isLegacyCompactionAssistantMessage(message: Message.WithParts) {
    return message.info.role === "assistant" && message.parts.some((part) => part.type === "compaction")
}

// ---------------------------------------------------------------------------
// 推理循环
// ---------------------------------------------------------------------------

// session 级状态机：一个用户输入可能经过多轮模型调用和工具调用，直到最终回答或阻塞。
async function runLoop(input: LoopRuntimeInput): Promise<RunLoopResult> {
    const { sessionID, abort, controller, turn } = input;
    throwIfAborted(abort)
    const session = Session.DataBaseRead("sessions", sessionID) as Session.SessionInfo | null;
    if (!session) {
        throw new Error(`Session '${sessionID}' was not found.`);
    }
    const sideChatLink = Session.isSideChatSession(session)
        ? Session.getSideChatLink(sessionID)
        : null

    let currentAssistant: Message.Assistant | undefined;
    let turnDiffStartSnapshot: string | undefined;
    let turnDiffEndSnapshot: string | undefined;
    let continuedByUser = false;
    let iteration = 0;
    try {
        while (true) {
            if (abort.aborted) throw new Error("Prompt aborted");

            Status.set(sessionID, { type: "busy" });
            // 每轮从数据库重建历史，确保工具结果、恢复补写、diff part 都进入上下文。
            const messages = loadMessagesWithParts(sessionID);

            let lastUser: Message.User | undefined;
            let lastAssistant: Message.Assistant | undefined;
            let lastFinished: Message.Assistant | undefined;

            for (let i = messages.length - 1; i >= 0; i--) {
                const message = messages[i]!;

                if (!lastUser && message.info.role === "user" && !isInternalUserMessage(message)) {
                    lastUser = message.info as Message.User;
                }

                if (!lastAssistant && message.info.role === "assistant" && !isLegacyCompactionAssistantMessage(message)) {
                    lastAssistant = message.info as Message.Assistant;
                }

                if (!lastFinished && message.info.role === "assistant" && !isLegacyCompactionAssistantMessage(message) && message.info.finishReason) {
                    lastFinished = message.info as Message.Assistant;
                }

                if (lastUser && lastFinished) break;
            }

            if (!lastUser) {
                throw new Error("No user message found in stream. This should never happen.");
            }

            const activeSession = Session.DataBaseRead("sessions", sessionID) as Session.SessionInfo | null;
            if (!activeSession) {
                throw new Error(`Session '${sessionID}' was not found.`);
            }

            const effectiveAgentName = resolveRuntimeAgentName(activeSession, lastUser.agent);
            const agent = (await Agent.get(effectiveAgentName)) ?? Agent.planAgent;
            throwIfAborted(abort)
            const maxLoopIterations = resolvePromptLoopLimit(agent);
            iteration += 1;
            if (Number.isFinite(maxLoopIterations) && iteration > maxLoopIterations) {
                log.error("prompt loop exceeded maximum iterations", {
                    sessionID,
                    userMessageID: lastUser.id,
                    agent: agent.name,
                    maxLoopIterations,
                });
                throw new Error(
                    `Prompt loop exceeded ${maxLoopIterations} iterations without reaching a final response. ` +
                    `If this task legitimately needs more tool steps, increase or unset ANYBOX_EXPERIMENTAL_AGENT_LOOP_LIMIT.`,
                );
            }

            const recoveredDanglingToolCalls = await recoverDanglingToolCallsAfterUser(
                messages,
                lastUser.id,
                turn,
            )
            throwIfAborted(abort)
            if (recoveredDanglingToolCalls > 0) {
                log.warn("recovered dangling tool calls before resuming the prompt loop", {
                    sessionID,
                    userMessageID: lastUser.id,
                    recoveredDanglingToolCalls,
                })
                iteration -= 1
                continue
            }

            const blockingInteraction = findBlockingAssistantInteractionAfterUser(messages, lastUser.id);
            if (blockingInteraction) {
                log.warn("stopping prompt loop because the latest user turn is waiting on a blocking assistant interaction", {
                    sessionID,
                    assistantID: blockingInteraction.assistant.id,
                    toolCallID: blockingInteraction.toolPart.callID,
                    tool: blockingInteraction.toolPart.tool,
                    status: blockingInteraction.toolPart.state.status,
                    interaction: blockingInteraction.kind,
                    questionID:
                        blockingInteraction.kind === "question"
                            ? blockingInteraction.questionID
                            : undefined,
                });
                turn.setAcceptingSteer(false)
                break;
            }

            if (
                lastAssistant &&
                isFinalFinishReason(lastAssistant.finishReason) &&
                lastUser.id < lastAssistant.id &&
                !hasInternalUserMessageAfter(messages, lastAssistant.id)
            ) {
                log.info("exiting loop", { sessionID });
                turn.setAcceptingSteer(false)
                break;
            }

            // 本轮实际执行所需的模型、assistant 壳消息和工具集。
            const model = await ModelRegistry.getAISDKModel(
                lastUser.model.providerID,
                lastUser.model.modelID,
                Instance.project.id,
            );
            throwIfAborted(abort)

            const assistantMessageID = Identifier.ascending("message")

            const tools = await resolveTools({
                agent,
                sessionID,
                messageID: assistantMessageID,
                abort,
            });
            throwIfAborted(abort)

            // system prompt 由 agent 基础规则、侧聊上下文、项目环境、skills 和用户追加规则组成。
            const system: string[] = [
                ...await SystemPrompt.defaultPrompt({
                    agent,
                    session: activeSession,
                }),
                ...SystemPrompt.tools(Object.keys(tools)),
                ...(sideChatLink ? [buildSideChatSystemPrompt(sideChatLink)] : []),
                ...await SystemPrompt.environment(model),
                ...await SystemPrompt.skills(sessionID, lastUser.skills ?? []),
                ...(lastUser.system ? [lastUser.system] : []),
            ].filter((item): item is string => typeof item === "string")
            throwIfAborted(abort)

            const promptContext = await ContextWindow.preparePromptContext({
                sessionID,
                model,
                system,
                messages,
                reasoningEffort: lastUser.reasoningEffort,
                tools,
                recordCompactionMessage: async ({ message, parts }) => {
                    await persistMessageRecord(message, turn)
                    for (const part of parts) {
                        if (turn) {
                            turn.emit("part.recorded", { part })
                        } else {
                            await Session.updatePart(part)
                        }
                    }
                },
                disableCompaction: Session.isSideChatSession(activeSession),
            })
            throwIfAborted(abort)

            const assistantParentMessageID = Session.getActiveMessageID(sessionID) ?? lastUser.id
            const assistantMessage = createAssistantMessage(
                sessionID,
                lastUser,
                model,
                agent.name,
                assistantMessageID,
                turn.turnID,
                assistantParentMessageID,
            );
            currentAssistant = assistantMessage;
            await persistMessageRecord(assistantMessage, turn);
            Session.updateTurn(turn.turnID, {
                phase: "waiting_llm",
                lastMessageID: assistantMessage.id,
            })

            const processor = Processor.create({
                Assistant: assistantMessage,
                abort,
                turn,
            });

            const modelCallSnapshot = await Snapshot.track().catch((error) => {
                log.warn("failed to capture model-call snapshot", {
                    sessionID,
                    assistantMessageID: assistantMessage.id,
                    iteration,
                    error: error instanceof Error ? error.message : String(error),
                })
                return undefined
            })
            turnDiffStartSnapshot ??= modelCallSnapshot
            throwIfAborted(abort)
            let processResult: Awaited<ReturnType<typeof processor.process>>;
            try {
                processResult = await processor.process({
                    user: lastUser,
                    sessionID,
                    messageID: assistantMessage.id,
                    model,
                    agent,
                    system: promptContext.system,
                    abort,
                    reasoningEffort: lastUser.reasoningEffort,
                    messages: await Message.toModelMessages(promptContext.messages, model, {
                        agent,
                    }),
                    tools,
                });
            } catch (error) {
                assistantMessage.error = TurnError.toAssistantError(error);
                await persistMessageRecord(assistantMessage, turn);
                const modelCallEndSnapshot = await persistModelCallPatchPart({
                    sessionID,
                    assistantMessageID: assistantMessage.id,
                    fromSnapshot: modelCallSnapshot,
                    iteration,
                    turn,
                }).catch((persistError) => {
                    log.warn("failed to persist model-call patch after processor error", {
                        sessionID,
                        assistantMessageID: assistantMessage.id,
                        iteration,
                        error: persistError instanceof Error ? persistError.message : String(persistError),
                    })
                    return undefined
                })
                turnDiffEndSnapshot = modelCallEndSnapshot ?? turnDiffEndSnapshot
                assistantMessage.diffSummary = (await persistAssistantTurnDiffSummary({
                    message: assistantMessage,
                    fromSnapshot: turnDiffStartSnapshot,
                    toSnapshot: turnDiffEndSnapshot,
                    turn,
                }).catch((persistError) => {
                    log.warn("failed to persist assistant turn diff after processor error", {
                        sessionID,
                        assistantMessageID: assistantMessage.id,
                        iteration,
                        error: persistError instanceof Error ? persistError.message : String(persistError),
                    })
                    return assistantMessage
                })).diffSummary
                throw error;
            }

            // Processor already persists the finalized assistant message through lifecyclePersistence.
            // await persistMessageRecord(assistantMessage, turn);
            const modelCallEndSnapshot = await persistModelCallPatchPart({
                sessionID,
                assistantMessageID: assistantMessage.id,
                fromSnapshot: modelCallSnapshot,
                iteration,
                turn,
            }).catch((error) => {
                log.warn("failed to persist model-call patch", {
                    sessionID,
                    assistantMessageID: assistantMessage.id,
                    iteration,
                    error: error instanceof Error ? error.message : String(error),
                })
                return undefined
            })
            turnDiffEndSnapshot = modelCallEndSnapshot ?? turnDiffEndSnapshot

            if (await SessionRunner.consumePendingSteer(sessionID, turn.turnID) > 0) {
                continuedByUser = true
                turn.setAcceptingSteer(false)
                log.info("ending prompt turn for steer handoff", {
                    sessionID,
                    turnID: turn.turnID,
                    iteration,
                })
                break
            }

            if (isFinalFinishReason(processor.message.finishReason)) {
                turn.setAcceptingSteer(false)
                log.info("model-finish", {
                    sessionID,
                    finishReason: processor.message.finishReason,
                    iteration,
                });
                break;
            }

            if (processResult === "stop") {
                turn.setAcceptingSteer(false)
                break;
            }
        }

        let latest = currentAssistant
            ? {
                info: currentAssistant,
                parts: db.findManyWithSchema("parts", Message.Part, {
                    where: [{ column: "messageID", value: currentAssistant.id }],
                    orderBy: [{ column: "id", direction: "ASC" }],
                }),
            }
            : latestAssistantWithParts(sessionID);

        if (!latest) {
            throw new Error("No assistant message was created.");
        }

        if (latest.info.role === "assistant") {
            const nextAssistant = await persistAssistantTurnDiffSummary({
                message: latest.info,
                fromSnapshot: turnDiffStartSnapshot,
                toSnapshot: turnDiffEndSnapshot,
                turn,
            }).catch((error) => {
                log.warn("failed to persist assistant turn diff summary", {
                    sessionID,
                    assistantMessageID: latest?.info.id,
                    error: error instanceof Error ? error.message : String(error),
                })
                return latest?.info.role === "assistant" ? latest.info : undefined
            })
            if (nextAssistant) {
                latest = {
                    ...latest,
                    info: nextAssistant,
                }
                currentAssistant = nextAssistant
            }
        }

        const finishReason = latest.info.role === "assistant" ? latest.info.finishReason : undefined
        const blockedByApproval = latest.parts.some(
            (part): part is Message.ToolPart =>
                part.type === "tool" && part.state.status === "waiting-approval",
        )
        const blockedByQuestion = latest.parts.some(isAskUserQuestionPart)
        const blocked = blockedByApproval || blockedByQuestion
        const assistantErrorInfo = latest.info.role === "assistant"
            ? TurnError.fromAssistantError(latest.info.error)
            : undefined
        const stoppedWithoutCompletion = !continuedByUser && !blocked && !assistantErrorInfo && !isFinalFinishReason(finishReason)
            ? TurnError.fromMessage(
                "Assistant turn stopped before producing a final response.",
                "TurnStoppedWithoutCompletion",
            )
            : undefined
        const errorInfo = assistantErrorInfo ?? stoppedWithoutCompletion

        return {
            latest,
            status: continuedByUser ? "continued_by_user" : blocked ? "blocked" : errorInfo ? "failed" : "completed",
            finishReason,
            errorInfo: errorInfo
                ? TurnError.withModelContext(
                    errorInfo,
                    latest.info.role === "assistant"
                        ? {
                            providerID: latest.info.providerID,
                            modelID: latest.info.modelID,
                        }
                        : undefined,
                )
                : undefined,
        };
    } finally {
        void controller
    }
}

// ---------------------------------------------------------------------------
// 对外入口
// ---------------------------------------------------------------------------

// 新用户输入入口：交给 per-session runner 决定新 turn、排队或 steer。
function createPromptExecutionHandle(input: PromptInput) {
    const session = Session.DataBaseRead("sessions", input.sessionID) as Session.SessionInfo | null;
    if (!session) {
        throw new Error(`Session '${input.sessionID}' was not found.`);
    }

    return SessionRunner.enqueuePrompt({
        sessionID: input.sessionID,
        directory: session.directory,
        type: "prompt",
        execute: (runtime) => runPromptOperation(input, runtime),
        allowSteer: input.concurrentInputMode === "steer",
    })
}

export const promptExecution = fn(PromptInput, createPromptExecutionHandle);

export const prompt = fn(PromptInput, async (input) => createPromptExecutionHandle(input).promise);

// 新用户输入的真实执行：先记录 user message / parts，再启动 runLoop。
async function runPromptOperation(input: PromptInput, runtime: SessionRunner.PromptRuntime) {
    throwIfAborted(runtime.abort)
    const existingMessages = loadMessagesWithParts(input.sessionID)
    const session = Session.DataBaseRead("sessions", input.sessionID) as Session.SessionInfo | null;
    if (!session) {
        throw new Error(`Session '${input.sessionID}' was not found.`);
    }

    const shouldAutoGenerateTitle =
        Session.isDefaultSessionTitle(session.title) &&
        existingMessages.length === 0
    const agentName = resolveUserMessageAgentName(session, input.agent)

    const baselineSnapshot = await captureSnapshot({
        context: "pre-turn",
        sessionID: input.sessionID,
    })
    throwIfAborted(runtime.abort)
    const nextInput: PromptInput = {
        ...input,
        agent: agentName,
        skills: await Skill.resolveTurnSkillIDs({
            projectID: session.projectID,
            projectRoot: Instance.worktree,
            requestedSkillIDs: input.skills,
        }),
    }
    throwIfAborted(runtime.abort)

    let userMessage: Awaited<ReturnType<typeof createUserMessage>>
    let turn: Orchestrator.TurnContext | undefined
    let sessionTitlePromise: Promise<void> | undefined


    try {
        userMessage = await createUserMessage(nextInput, {
            snapshot: baselineSnapshot,
        });
        throwIfAborted(runtime.abort)
        if (shouldAutoGenerateTitle) {
            sessionTitlePromise = autoGenerateSessionTitle({
                sessionID: input.sessionID,
                projectID: session.projectID,
                model: userMessage.messageinfo.model,
                parts: userMessage.parts,
            })
        }
    } catch (error) {
        Status.set(input.sessionID, { type: "idle" });
        throw error;
    }

    try {
        throwIfAborted(runtime.abort)
        turn = Orchestrator.startTurn({
            sessionID: input.sessionID,
            turnID: runtime.turnID,
            userMessageID: userMessage.messageinfo.id,
            agent: userMessage.messageinfo.agent,
            model: userMessage.messageinfo.model,
        })
        Session.createTurn({
            id: turn.turnID,
            sessionID: input.sessionID,
            projectID: session.projectID,
            userMessageID: userMessage.messageinfo.id,
            agent: userMessage.messageinfo.agent,
            model: userMessage.messageinfo.model,
            phase: "preparing",
        })
        userMessage.messageinfo = {
            ...userMessage.messageinfo,
            turnID: turn.turnID,
        }

        turn.emit("turn.state.changed", {
            phase: "preparing",
            reason: "User turn recorded and prompt loop is preparing the next model call.",
            messageID: userMessage.messageinfo.id,
        })

        turn.emit("message.recorded", {
            message: userMessage.messageinfo,
        })

        for (const part of userMessage.parts) {
            if (part.type === "snapshot") {
                turn.emit("snapshot.captured", {
                    part,
                    phase: "turn-start",
                })
                continue
            }

            turn.emit("part.recorded", {
                part,
            })
        }
        clearPendingWorkflowInstruction(input.sessionID)

        const result = await runLoop({
            sessionID: input.sessionID,
            abort: runtime.abort,
            controller: runtime.controller,
            turn,
        });
        throwIfAborted(runtime.abort)

        await sessionTitlePromise
        throwIfAborted(runtime.abort)

        finishPromptTurnFromResult(turn, result)

        return result.latest as AssistantWithParts
    } catch (error) {
        const latestAssistant = latestAssistantWithPartsAfter(
            input.sessionID,
            userMessage.messageinfo.id,
        )
        if (isTurnAbort(runtime)) {
            void sessionTitlePromise?.catch((titleError) => {
                log.warn("session title generation failed after prompt cancellation", {
                    sessionID: input.sessionID,
                    error: titleError instanceof Error ? titleError.message : String(titleError),
                })
            })
        } else {
            await sessionTitlePromise
        }

        if (turn) {
            const status = runtime.abort.aborted ? "cancelled" : "failed"
            const assistantErrorInfo = latestAssistant?.info.role === "assistant"
                ? TurnError.fromAssistantError(latestAssistant.info.error)
                : undefined
            const errorInfo = TurnError.withModelContext(
                assistantErrorInfo ?? TurnError.fromUnknown(error),
                latestAssistant?.info.role === "assistant"
                    ? {
                        providerID: latestAssistant.info.providerID,
                        modelID: latestAssistant.info.modelID,
                    }
                    : undefined,
            )
            Session.updateTurn(turn.turnID, {
                status,
                phase: status,
                error: errorInfo.message,
                errorInfo,
                lastMessageID: latestAssistant?.info.id,
            })
            if (status === "cancelled") {
                emitTurnCancelled({
                    turn,
                    detail: errorInfo.message,
                })
            } else {
                emitTurnFailureContext({
                    turn,
                    errorInfo,
                    assistant: latestAssistant?.info.role === "assistant" ? latestAssistant.info : undefined,
                    parts: latestAssistant?.parts ?? [],
                })
                turn.emit("turn.state.changed", {
                    phase: "failed",
                    reason: errorInfo.message,
                    messageID: latestAssistant?.info.id,
                })
                turn.emit("turn.failed", {
                    error: errorInfo.message,
                    errorInfo,
                    message: latestAssistant?.info,
                    parts: latestAssistant?.parts,
                })
            }
        }

        throw error
    } finally {
        if (turn) {
            Orchestrator.finishTurn(turn)
        }
        Status.set(input.sessionID, { type: "idle" })
    }
}

export const ResumeInput = z.object({
    sessionID: Identifier.schema("session"),
});
export type ResumeInput = z.infer<typeof ResumeInput>;

// 恢复入口：进入 per-session runner 队列后，基于最近一次 user message 继续推进。
function createResumeExecutionHandle(input: ResumeInput) {
    const session = Session.DataBaseRead("sessions", input.sessionID) as Session.SessionInfo | null;
    if (!session) {
        throw new Error(`Session '${input.sessionID}' was not found.`);
    }

    return SessionRunner.enqueueResume({
        sessionID: input.sessionID,
        directory: session.directory,
        type: "resume",
        execute: (runtime) => runResumeOperation(input, runtime),
    })
}

export const resumeExecution = fn(ResumeInput, createResumeExecutionHandle);

export const resume = fn(ResumeInput, async (input) => createResumeExecutionHandle(input).promise);

async function runResumeOperation(input: ResumeInput, runtime: SessionRunner.PromptRuntime) {
    throwIfAborted(runtime.abort)
    const session = Session.DataBaseRead("sessions", input.sessionID) as Session.SessionInfo | null;
    if (!session) {
        throw new Error(`Session '${input.sessionID}' was not found.`);
    }

    const latestUser = SessionDiff.findLatestUserMessageWithSnapshot(input.sessionID)
    let turn: Orchestrator.TurnContext | undefined

    try {
        throwIfAborted(runtime.abort)
        turn = Orchestrator.startTurn({
            sessionID: input.sessionID,
            turnID: runtime.turnID,
            userMessageID: latestUser?.message.id,
            agent: latestUser?.message.agent,
            model: latestUser?.message.model,
            resume: true,
        })
        Session.createTurn({
            id: turn.turnID,
            sessionID: input.sessionID,
            projectID: session.projectID,
            userMessageID: latestUser?.message.id,
            resume: true,
            agent: latestUser?.message.agent,
            model: latestUser?.message.model,
            phase: "preparing",
        })

        turn.emit("turn.state.changed", {
            phase: "preparing",
            reason: "Resume requested and the prompt loop is preparing the next model call.",
            messageID: latestUser?.message.id,
        })

        const result = await runLoop({
            sessionID: input.sessionID,
            abort: runtime.abort,
            controller: runtime.controller,
            turn,
        });
        throwIfAborted(runtime.abort)

        finishPromptTurnFromResult(turn, result)

        return result.latest as AssistantWithParts
    } catch (error) {
        const latestAssistant = latestAssistantWithPartsAfter(
            input.sessionID,
            latestUser?.message.id,
        )
        if (turn) {
            const status = runtime.abort.aborted ? "cancelled" : "failed"
            const assistantErrorInfo = latestAssistant?.info.role === "assistant"
                ? TurnError.fromAssistantError(latestAssistant.info.error)
                : undefined
            const errorInfo = TurnError.withModelContext(
                assistantErrorInfo ?? TurnError.fromUnknown(error),
                latestAssistant?.info.role === "assistant"
                    ? {
                        providerID: latestAssistant.info.providerID,
                        modelID: latestAssistant.info.modelID,
                    }
                    : undefined,
            )
            Session.updateTurn(turn.turnID, {
                status,
                phase: status,
                error: errorInfo.message,
                errorInfo,
                lastMessageID: latestAssistant?.info.id,
            })
            if (status === "cancelled") {
                emitTurnCancelled({
                    turn,
                    detail: errorInfo.message,
                })
            } else {
                emitTurnFailureContext({
                    turn,
                    errorInfo,
                    assistant: latestAssistant?.info.role === "assistant" ? latestAssistant.info : undefined,
                    parts: latestAssistant?.parts ?? [],
                })
                turn.emit("turn.state.changed", {
                    phase: "failed",
                    reason: errorInfo.message,
                    messageID: latestAssistant?.info.id,
                })
                turn.emit("turn.failed", {
                    error: errorInfo.message,
                    errorInfo,
                    message: latestAssistant?.info,
                    parts: latestAssistant?.parts,
                })
            }
        }

        throw error
    } finally {
        if (turn) {
            Orchestrator.finishTurn(turn)
        }
        Status.set(input.sessionID, { type: "idle" })
    }
}

type LoopRuntimeInput = {
    sessionID: string
    abort: AbortSignal
    controller: AbortController
    turn: Orchestrator.TurnContext
}

// ---------------------------------------------------------------------------
// 上下文重建与恢复保护
// ---------------------------------------------------------------------------

// 从 messages + parts 重建模型上下文，避免内存态与数据库脱节。
function loadMessagesWithParts(sessionID: string): Message.WithParts[] {
    return Message.listActiveBranch(sessionID)
}

function findBlockingAssistantInteractionAfterUser(
    messages: Message.WithParts[],
    userMessageID: string,
) {
    let afterUser = false;

    for (const message of messages) {
        if (!afterUser) {
            afterUser = message.info.id === userMessageID;
            continue;
        }

        if (message.info.role !== "assistant") continue;
        if (isLegacyCompactionAssistantMessage(message)) continue;

        const toolPart = message.parts.find(
            (part): part is Message.ToolPart =>
                part.type === "tool" &&
                (
                    part.state.status === "pending" ||
                    part.state.status === "running" ||
                    part.state.status === "waiting-approval"
                ),
        );

        if (toolPart) {
            return {
                kind: "tool" as const,
                assistant: message.info as Message.Assistant,
                toolPart,
            };
        }

        const questionPart = message.parts.find(isAskUserQuestionPart)
        if (questionPart) {
            const metadata = questionPart.state.metadata as Record<string, unknown>
            return {
                kind: "question" as const,
                assistant: message.info as Message.Assistant,
                toolPart: questionPart,
                questionID: typeof metadata.questionID === "string" ? metadata.questionID : undefined,
            }
        }
    }
}

async function recoverDanglingToolCallsAfterUser(
    messages: Message.WithParts[],
    userMessageID: string,
    turn?: Orchestrator.TurnContext,
) {
    let afterUser = false
    let recovered = 0

    for (const message of messages) {
        if (!afterUser) {
            afterUser = message.info.id === userMessageID
            continue
        }

        if (message.info.role !== "assistant") continue
        if (isLegacyCompactionAssistantMessage(message)) continue

        for (const part of message.parts) {
            if (part.type !== "tool") continue
            if (part.state.status !== "pending" && part.state.status !== "running") continue

            const end = Date.now()
            const repaired = Message.ToolPart.parse({
                ...part,
                state: {
                    status: "error",
                    input: part.state.input,
                    raw: part.state.raw,
                    error: DANGLING_TOOL_CALL_ERROR,
                    metadata:
                        part.state.status === "running"
                            ? part.state.metadata
                            : undefined,
                    time: {
                        start:
                            part.state.status === "running"
                                ? part.state.time.start
                                : end,
                        end,
                    },
                },
            })

            await persistRecoveredToolError(repaired, turn)
            recovered += 1
        }
    }

    return recovered
}

function resolvePromptLoopLimit(agent: Agent.AgentInfo) {
    const requestedLimit =
        agent.steps === undefined || !Number.isFinite(agent.steps)
            ? DEFAULT_PROMPT_LOOP_LIMIT
            : agent.steps

    return HARD_PROMPT_LOOP_LIMIT
        ? Math.min(requestedLimit, HARD_PROMPT_LOOP_LIMIT)
        : requestedLimit
}

function isFinalFinishReason(finishReason?: string) {
    // `tool-calls` / `unknown` 表示还可能需要继续工具循环。
    return Boolean(finishReason && !["tool-calls", "unknown"].includes(finishReason));
}

function latestAssistantWithParts(sessionID: string): Message.WithParts | undefined {
    const messages = loadMessagesWithParts(sessionID);
    for (let index = messages.length - 1; index >= 0; index--) {
        const item = messages[index]!;
        if (item.info.role === "assistant" && !isLegacyCompactionAssistantMessage(item)) return item;
    }
}

function latestAssistantWithPartsAfter(
    sessionID: string,
    userMessageID?: string,
): Message.WithParts | undefined {
    if (!userMessageID) return

    const messages = loadMessagesWithParts(sessionID)
    let afterUser = false
    let latestAssistant: Message.WithParts | undefined

    for (const message of messages) {
        if (!afterUser) {
            afterUser = message.info.id === userMessageID
            continue
        }

        if (message.info.role === "assistant" && !isLegacyCompactionAssistantMessage(message)) {
            latestAssistant = message
        }
    }

    return latestAssistant
}

function readModelCallPatchPart(messageID: string): Message.PatchPart | undefined {
    const parts = db.findManyWithSchema("parts", Message.Part, {
        where: [{ column: "messageID", value: messageID }],
        orderBy: [{ column: "id", direction: "ASC" }],
    })

    return parts.find((part): part is Message.PatchPart => part.type === "patch" && part.scope === "model-call")
}

function toPatchFileChangeSummary(
    diffs: SessionDiff.DetailedDiffSummary["diffs"],
): Message.PatchFileChangeSummary[] {
    let storedPatchBytes = 0

    return diffs.slice(0, MODEL_CALL_PATCH_MAX_FILES).map((diff) => {
        const change: Message.PatchFileChangeSummary = {
            file: diff.file,
            additions: diff.additions,
            deletions: diff.deletions,
        }

        if (!diff.patch) return change

        const patchBytes = Buffer.byteLength(diff.patch, "utf8")
        if (storedPatchBytes + patchBytes > MODEL_CALL_PATCH_MAX_TOTAL_PATCH_BYTES) {
            return change
        }

        storedPatchBytes += patchBytes
        return {
            ...change,
            patch: diff.patch,
        }
    })
}

async function persistModelCallPatchPart(input: {
    sessionID: string
    assistantMessageID: string
    fromSnapshot: string | undefined
    iteration: number
    turn?: Orchestrator.TurnContext
}) {
    if (!input.fromSnapshot) return undefined

    const existingPatch = readModelCallPatchPart(input.assistantMessageID)
    const toSnapshot = await Snapshot.track()
    if (!toSnapshot) return undefined

    if (input.fromSnapshot === toSnapshot) {
        if (existingPatch) {
            await removePartRecord(existingPatch.id, input.turn, existingPatch.messageID)
        }
        return toSnapshot
    }

    const diffSummary = await SessionDiff.computeDetailedDiffBetweenSnapshots(
        input.fromSnapshot,
        toSnapshot,
        {
            includeContent: false,
            maxPatchBytes: MODEL_CALL_PATCH_MAX_PATCH_BYTES,
        },
    )

    if (diffSummary.diffs.length === 0) {
        if (existingPatch) {
            await removePartRecord(existingPatch.id, input.turn, existingPatch.messageID)
        }
        return toSnapshot
    }

    const changes = toPatchFileChangeSummary(diffSummary.diffs)

    const patchPart: Message.PatchPart = Message.PatchPart.parse({
        id: existingPatch?.id ?? Identifier.ascending("part"),
        sessionID: input.sessionID,
        messageID: input.assistantMessageID,
        type: "patch",
        scope: "model-call",
        iteration: input.iteration,
        fromSnapshot: input.fromSnapshot,
        hash: toSnapshot,
        files: changes.map((change) => change.file),
        changes,
        summary: diffSummary.stats,
    })

    if (input.turn) {
        input.turn.emit("patch.generated", {
            part: patchPart,
        })
        return toSnapshot
    }

    await Session.updatePart(patchPart)
    return toSnapshot
}

// ---------------------------------------------------------------------------
// 消息构造与附属任务
// ---------------------------------------------------------------------------

// 先创建 assistant message 的“骨架记录”。
// 真正的文本、推理链、工具调用结果会在 Processor 执行期间作为 part 持续补齐。
function createAssistantMessage(
    sessionID: string,
    lastUser: Message.User,
    model: Provider.Model,
    agentName: string,
    messageID: string = Identifier.ascending("message"),
    turnID?: string,
    parentMessageID?: string | null,
): Message.Assistant {
    const normalizedParentMessageID = parentMessageID ?? lastUser.id ?? null
    return {
        id: messageID,
        sessionID,
        turnID,
        parentMessageID: normalizedParentMessageID,
        role: "assistant",
        created: Date.now(),
        parentID: normalizedParentMessageID ?? "",
        modelID: model.id,
        providerID: model.providerID,
        agent: agentName,
        path: {
            cwd: Instance.directory,
            root: Instance.worktree,
        },
        cost: 0,
        tokens: {
            input: 0,
            output: 0,
            reasoning: 0,
            cache: {
                read: 0,
                write: 0,
            },
        },
    };
}

// 把外部 prompt part 归一化为数据库统一使用的 Part 结构。
function toUserPart(
    part: PromptInput["parts"][number],
    messageID: string,
    sessionID: string,
): Message.Part {
    const base = {
        id: Identifier.ascending("part"),
        messageID,
        sessionID,
    };

    switch (part.type) {
        case "file":
            return {
                ...base,
                ...part,
            } as Message.FilePart;
        case "image":
            return {
                ...base,
                ...part,
            } as Message.ImagePart;
        case "agent":
            return {
                ...base,
                ...part,
            } as Message.AgentPart;
        case "text":
            return {
                ...base,
                ...part,
            } as Message.TextPart;
        case "subtask":
            return {
                ...base,
                ...part,
            } as Message.SubtaskPart;
    }
}

// 用户输入先落成一条 user message，再拆成多条 part，供模型、UI 和工具链复用。
function parseSelectedModelReference(value: string | undefined): Provider.ModelReference | undefined {
    if (!value) return undefined
    const [providerID, ...rest] = value.split("/")
    const modelID = rest.join("/")
    if (!providerID || !modelID) return undefined
    return {
        providerID,
        modelID,
    }
}

async function resolvePromptModel(input: PromptInput): Promise<Provider.ModelReference> {
    if (input.model) return input.model

    const selectedModel = Session.getSessionModelSelection(input.sessionID)?.model
    const selectedReference = parseSelectedModelReference(selectedModel)
    if (selectedReference) {
        try {
            await ModelRegistry.getAISDKModel(selectedReference.providerID, selectedReference.modelID, Instance.project.id)
            return selectedReference
        } catch {
            // Fall through to the project default if the stored session model is no longer valid.
        }
    }

    return Provider.getDefaultModelRef(Instance.project.id)
}

function wrapWorkflowInstruction(tag: string, body: string) {
    return [
        `<${tag}>`,
        body.trim(),
        `</${tag}>`,
    ].join("\n")
}

async function buildPendingWorkflowInstruction(workflow: Session.SessionWorkflowState) {
    switch (workflow.plan.pendingInstruction) {
        case "plan-mode": {
            const selection = await PromptPresets.getPromptPresetSelection()
            return wrapWorkflowInstruction(
                "plan_mode_instruction",
                await PromptPresets.getResolvedPromptPresetContent(selection.planModePromptPresetID),
            )
        }
        case "exit-plan":
            return wrapWorkflowInstruction(
                "plan_mode_exit_instruction",
                [
                    "Plan Mode has ended. You are back in normal execution mode.",
                    "Do not continue planning unless the user explicitly switches back into Plan Mode.",
                ].join("\n"),
            )
        case "execute-approved-plan": {
            const approvedPlan = workflow.plan.approvedMarkdown?.trim()
            return wrapWorkflowInstruction(
                "plan_mode_exit_instruction",
                [
                    "Plan Mode has ended. Execute the approved implementation plan now.",
                    approvedPlan
                        ? [
                            "<approved_plan>",
                            approvedPlan,
                            "</approved_plan>",
                        ].join("\n")
                        : undefined,
                ].filter((line): line is string => typeof line === "string").join("\n\n"),
            )
        }
        default:
            return undefined
    }
}

function injectWorkflowInstructionIntoParts(
    parts: z.infer<typeof PromptInput>["parts"],
    instruction: string | undefined,
): z.infer<typeof PromptInput>["parts"] {
    const normalizedInstruction = instruction?.trim()
    if (!normalizedInstruction) return parts

    let injected = false
    const nextParts = parts.map((part) => {
        if (injected || part.type !== "text") return part
        injected = true
        return {
            ...part,
            text: [normalizedInstruction, part.text.trim()].filter(Boolean).join("\n\n"),
        }
    })

    if (injected) return nextParts

    return [
        {
            type: "text",
            text: normalizedInstruction,
        },
        ...nextParts,
    ]
}

function clearPendingWorkflowInstruction(sessionID: string) {
    Session.updateSessionWorkflow(sessionID, (workflow) => ({
        ...workflow,
        plan: {
            ...workflow.plan,
            pendingInstruction: undefined,
            updatedAt: Date.now(),
        },
    }))
}

function resolveUserParentMessageID(input: PromptInput, session: Session.SessionInfo | null) {
    if (!Object.prototype.hasOwnProperty.call(input, "parentMessageID")) {
        return session?.activeMessageID ?? null
    }

    const parentMessageID = input.parentMessageID
    if (parentMessageID === undefined) {
        return session?.activeMessageID ?? null
    }
    if (parentMessageID === null) return null

    const parentMessage = Session.DataBaseRead("messages", parentMessageID) as Message.MessageInfo | null
    if (!parentMessage) {
        throw new Error(`Parent message '${parentMessageID}' was not found.`)
    }
    if (parentMessage.sessionID !== input.sessionID) {
        throw new Error("Parent message must belong to the same session.")
    }
    if (parentMessage.role === "user" && parentMessage.internal) {
        throw new Error("Internal messages cannot be used as branch parents.")
    }

    return parentMessage.id
}

async function createUserMessage(input: PromptInput, options?: { snapshot?: string }) {
    const session = Session.DataBaseRead("sessions", input.sessionID) as Session.SessionInfo | null
    const workflow = Session.normalizeWorkflowState(session?.workflow)
    const pendingWorkflowInstruction = await buildPendingWorkflowInstruction(workflow)
    const inputParts = injectWorkflowInstructionIntoParts(input.parts, pendingWorkflowInstruction)
    const messageinfo: Message.User = {
        id: Identifier.ascending("message"),
        sessionID: input.sessionID,
        parentMessageID: resolveUserParentMessageID(input, session),
        role: "user",
        created: Date.now(),
        agent: input.agent ?? "default",
        model: await resolvePromptModel(input),
        system: input.system,
        displayText: input.displayText?.trim() || undefined,
        skills: input.skills,
        internal: input.internal,
        reasoningEffort: input.reasoningEffort,
    };

    const parts = inputParts.map((part) =>
        toUserPart(part, messageinfo.id, input.sessionID),
    );

    if (options?.snapshot) {
        parts.push({
            id: Identifier.ascending("part"),
            sessionID: input.sessionID,
            messageID: messageinfo.id,
            type: "snapshot",
            snapshot: options.snapshot,
        } satisfies Message.SnapshotPart)
    }


    // 这里仅记录校验问题，避免单个异常 part 阻断整条用户消息。
    parts.forEach((part, index) => {
        const parsedPart = Message.Part.safeParse(part);
        if (parsedPart.success) return;

        log.error("invalid user part before save", {
            sessionID: input.sessionID,
            messageID: messageinfo.id,
            partID: part.id,
            partType: part.type,
            index,
            issues: parsedPart.error.issues,
            part,
        });
    });

    return {
        messageinfo,
        parts,
    };
}

function isSessionTitleSourcePart(part: Message.Part) {
    return part.type === "text" || part.type === "file" || part.type === "image"
}

async function autoGenerateSessionTitle(input: {
    sessionID: string
    projectID: string
    model: Provider.ModelReference
    parts: Message.Part[]
}) {
    const titleSourceParts = input.parts.filter(isSessionTitleSourcePart)
    if (titleSourceParts.length === 0) return

    try {
        const fallbackModel = await ModelRegistry.getAISDKModel(
            input.model.providerID,
            input.model.modelID,
            input.projectID,
        )
        const title = await SessionTitle.generateSessionTitle({
            projectID: input.projectID,
            fallbackModel,
            parts: titleSourceParts,
        })
        if (!title) return

        Session.updateSessionTitle(input.sessionID, title, {
            ifCurrentTitle: Session.DEFAULT_SESSION_TITLE,
        })
    } catch (error) {
        log.warn("automatic session title generation failed", {
            sessionID: input.sessionID,
            projectID: input.projectID,
            error: error instanceof Error ? error.message : String(error),
        })
    }
}
