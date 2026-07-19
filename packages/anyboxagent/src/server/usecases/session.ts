import { readFile } from "node:fs/promises"
import { basename, extname } from "node:path"
import { AgentRouteSchemas, SessionAttachmentBodySchema, isSshWorkspaceUri } from "@anybox/shared"
import z from "zod"
import * as Agent from "#agent/agent.ts"
import * as Config from "#config/config.ts"
import * as ModelRegistry from "#model/registry.ts"
import * as ModelSelection from "#model/selection.ts"
import type { PublicModel } from "#model/types.ts"
import * as Mcp from "#mcp/manager.ts"
import * as Project from "#project/project.ts"
import { clearInProcessPermissionSession } from "#permission/permission.ts"
import type { PtyRegistry } from "#pty/registry.ts"
import { Instance } from "#project/instance.ts"
import { ApiError } from "#server/error.ts"
import * as ContextWindow from "#session/core/context-window.ts"
import * as Message from "#session/core/message.ts"
import * as Prompt from "#session/core/prompt.ts"
import * as RunningState from "#session/runtime/running-state.ts"
import * as Session from "#session/core/session.ts"
import * as SessionRollback from "#session/core/rollback.ts"
import * as SessionDiff from "#session/diff/diff.ts"
import * as SystemPrompt from "#session/core/system.ts"
import * as Subtask from "#session/tasks/subtask.ts"
import * as Task from "#session/tasks/task.ts"
import * as Provider from "#provider/provider.ts"
import * as Log from "#util/log.ts"
import {
  createSessionEventStream,
  createSessionExecutionErrorStream,
  createSessionExecutionStream,
  parseReplayCursor,
  parseSinceSeq,
  serializeReplayCursor,
} from "#server/usecases/session-stream.ts"
import { isSessionLimitError } from "#session/runtime/session-limits.ts"
import {
  findModelByReference,
  listProjectModelsWithFallback,
  resolveEffectiveModelWithFallback,
} from "#server/usecases/model-list-cache.ts"
import { answerAskUserQuestion } from "#tool/ask-user-question.ts"

export { createSessionExecutionStream } from "#server/usecases/session-stream.ts"

export const CreateSessionBody = AgentRouteSchemas.sessions.create.body

export const CreateSideChatBody = AgentRouteSchemas.sessions.createSideChat.body

export const RollbackSessionBody = AgentRouteSchemas.sessions.rollback.body

export const UpdateSessionModelSelectionBody = Config.ModelSelection

export const UpdateSessionTitleBody = z.object({
  title: z.string().trim().min(1).max(160),
})

export const UpdateSessionPinnedBody = z.object({
  pinned: z.boolean(),
})

export const UpdateSessionWorkflowBody = AgentRouteSchemas.sessions.updateWorkflow.body

export const StreamSessionAttachmentBody = SessionAttachmentBodySchema

export const StreamSessionQuestionAnswerBody = AgentRouteSchemas.sessions.answerQuestion.body

export const AnswerSessionQuestionBody = StreamSessionQuestionAnswerBody

export const StreamSessionMessageBody = AgentRouteSchemas.sessions.streamMessage.body

export const UpdateSessionActiveMessageBody = z.object({
  messageID: z.string().min(1),
})

export const CancelSessionBody = z.object({
  cancelQueued: z.boolean().optional(),
  reason: z.enum(["user", "client-disconnect", "shutdown", "unknown"]).optional(),
}).optional().default({})

const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  ".apng": "image/apng",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".gif": "image/gif",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
}

const FILE_MIME_BY_EXTENSION: Record<string, string> = {
  ".csv": "text/csv",
  ".html": "text/html",
  ".json": "application/json",
  ".md": "text/markdown",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".xml": "application/xml",
}

const log = Log.create({ service: "server.session" })

type StreamSessionMessageInput = z.infer<typeof StreamSessionMessageBody>
type CancelSessionInput = z.infer<typeof CancelSessionBody>

type SessionStreamResult = {
  info: Message.MessageInfo
  parts: Message.Part[]
}

function normalizePromptText(text: string | undefined) {
  const trimmed = text?.trim()
  return trimmed ? trimmed : undefined
}

function throwIfAborted(signal: AbortSignal | undefined) {
  if (signal?.aborted) {
    const error = new Error("Session stream request was aborted.")
    error.name = "AbortError"
    throw error
  }
}

function normalizeQuestionAnswerText(
  answer: z.infer<typeof StreamSessionQuestionAnswerBody> | undefined,
) {
  if (!answer) return undefined

  const freeformText = normalizePromptText(answer.freeformText)
  if (freeformText) return freeformText

  const selectedOptions = Array.isArray(answer.selectedOptions)
    ? answer.selectedOptions.map((option) => option.trim()).filter(Boolean)
    : []

  if (selectedOptions.length > 0) {
    return selectedOptions.join(", ")
  }

  return undefined
}

function buildDataURL(mime: string, buffer: Buffer) {
  return `data:${mime};base64,${buffer.toString("base64")}`
}

function normalizeLogError(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function summarizeAttachmentInput(attachment: z.infer<typeof StreamSessionAttachmentBody>) {
  const extension = extname(attachment.path).toLowerCase()
  return {
    path: attachment.path,
    name: attachment.name?.trim() || basename(attachment.path),
    extension,
  }
}

function summarizeResolvedPart(part: z.infer<typeof Prompt.PromptInput>["parts"][number]) {
  if (part.type === "text") {
    return {
      type: "text",
      textLength: part.text.length,
    }
  }

  if (part.type === "file" || part.type === "image") {
    return {
      type: part.type,
      mime: part.mime,
      filename: part.filename,
      urlScheme: part.url.startsWith("data:") ? "data" : "remote",
    }
  }

  return {
    type: part.type,
  }
}

async function resolveAttachmentPart(
  attachment: z.infer<typeof StreamSessionAttachmentBody>,
  options?: { signal?: AbortSignal },
): Promise<z.infer<typeof Prompt.PromptInput>["parts"][number]> {
  throwIfAborted(options?.signal)
  const attachmentSummary = summarizeAttachmentInput(attachment)

  try {
    const buffer = await readFile(attachment.path)
    throwIfAborted(options?.signal)
    const extension = extname(attachment.path).toLowerCase()
    const filename = attachment.name?.trim() || basename(attachment.path)

    const imageMime = IMAGE_MIME_BY_EXTENSION[extension]
    if (imageMime) {
      log.info("resolved stream attachment", {
        ...attachmentSummary,
        kind: "image",
        mime: imageMime,
        bytes: buffer.byteLength,
      })
      return {
        type: "image",
        mime: imageMime,
        filename,
        url: buildDataURL(imageMime, buffer),
      }
    }

    const fileMime = FILE_MIME_BY_EXTENSION[extension] ?? "application/octet-stream"
    log.info("resolved stream attachment", {
      ...attachmentSummary,
      kind: "file",
      mime: fileMime,
      bytes: buffer.byteLength,
    })
    return {
      type: "file",
      mime: fileMime,
      filename,
      url: buildDataURL(fileMime, buffer),
    }
  } catch (error) {
    log.error("failed to resolve stream attachment", {
      ...attachmentSummary,
      error: normalizeLogError(error),
    })
    throw error
  }
}

async function resolvePromptPartsFromStreamPayload(
  payload: StreamSessionMessageInput,
  options?: { signal?: AbortSignal },
) {
  throwIfAborted(options?.signal)
  const parts: z.infer<typeof Prompt.PromptInput>["parts"] = []
  const normalizedText = normalizePromptText(payload.text) ?? normalizeQuestionAnswerText(payload.questionAnswer)

  if (normalizedText) {
    parts.push({
      type: "text",
      text: normalizedText,
      ...(payload.questionAnswer
        ? {
            metadata: {
              kind: "question-answer",
              questionID: payload.questionAnswer.questionID,
              selectedOptions: payload.questionAnswer.selectedOptions ?? [],
              freeformText: payload.questionAnswer.freeformText,
            },
          }
        : {}),
    })
  }

  for (const attachment of payload.attachments ?? []) {
    throwIfAborted(options?.signal)
    parts.push(await resolveAttachmentPart(attachment, options))
  }
  throwIfAborted(options?.signal)

  log.info("resolved stream payload parts", {
    hasText: Boolean(normalizedText),
    attachmentCount: payload.attachments?.length ?? 0,
    parts: parts.map((part) => summarizeResolvedPart(part)),
  })

  return parts
}

function safeReadSession(sessionID: string): Session.SessionInfo | null {
  try {
    return Session.DataBaseRead("sessions", sessionID) as Session.SessionInfo | null
  } catch {
    return null
  }
}

function safeReadArchivedSession(sessionID: string): Session.ArchivedSessionRecord | null {
  try {
    return Session.readArchivedSession(sessionID)
  } catch {
    return null
  }
}

function requireSession(sessionID: string) {
  const session = safeReadSession(sessionID)
  if (!session) {
    throw new ApiError(404, "SESSION_NOT_FOUND", `Session '${sessionID}' not found`)
  }

  return session
}

function requireMainSession(sessionID: string) {
  const session = requireSession(sessionID)
  if (Session.isSideChatSession(session)) {
    throw new ApiError(409, "TERMINAL_UNAVAILABLE", "Side chat sessions do not support terminals")
  }

  return session
}

function mapSessionSummary(session: Session.SessionInfo) {
  const normalized = Session.normalizeSessionInfo(session)
  return {
    ...normalized,
    origin: Session.getSessionOrigin(normalized.id),
    subagent: Subtask.getSubtaskSessionOrigin(normalized.id),
  }
}

function mapSideChatLink(link: Session.SideChatLink) {
  const activeSession = safeReadSession(link.sessionID)
  const archivedSession = safeReadArchivedSession(link.sessionID)
  return {
    ...link,
    session: activeSession
      ? mapSessionSummary(activeSession)
      : archivedSession
        ? mapSessionSummary(Session.normalizeSessionInfo(archivedSession.snapshot.session))
        : undefined,
    archived: !activeSession && Boolean(archivedSession),
  }
}

function mapArchivedSessionSummary(record: Session.ArchivedSessionRecord | Session.ArchivedSessionSummaryRecord) {
  const project = Project.get(record.projectID)
  const normalized = "snapshot" in record ? Session.normalizeSessionInfo(record.snapshot.session) : null

  return {
    id: record.sessionID,
    projectID: record.projectID,
    projectName: project?.name ?? null,
    projectMissing: !project,
    directory: record.directory,
    title: record.title,
    created: record.createdAt,
    updated: record.updatedAt,
    archivedAt: record.archivedAt,
    messageCount: record.messageCount,
    eventCount: record.eventCount,
    kind: normalized?.kind,
    policy: normalized?.policy,
    origin: Session.getSessionOrigin(record.sessionID),
  }
}

export async function createSession(input: z.infer<typeof CreateSessionBody>) {
  const { project } = await Project.fromDirectory(input.directory)
  const session = await Session.createSession({
    directory: input.directory,
    projectID: project.id,
  })

  return mapSessionSummary(session)
}

export function listArchivedSessions() {
  return Session.listArchivedSessionSummaries().map(mapArchivedSessionSummary)
}

export function archiveSession(sessionID: string, options?: { ptyRegistry?: PtyRegistry }) {
  const session = safeReadSession(sessionID)
  if (!session) {
    throw new ApiError(404, "SESSION_NOT_FOUND", `Session '${sessionID}' not found`)
  }

  if (RunningState.isRunning(sessionID)) {
    throw new ApiError(409, "SESSION_RUNNING", `Session '${sessionID}' is currently running and cannot be archived`)
  }

  if (safeReadArchivedSession(sessionID)) {
    throw new ApiError(409, "SESSION_ALREADY_ARCHIVED", `Session '${sessionID}' is already archived`)
  }

  const sessionsToArchive = Session.listArchivableSessions(sessionID)
  const runningSession = sessionsToArchive.find((candidate) => RunningState.isRunning(candidate.id))
  if (runningSession) {
    throw new ApiError(409, "SESSION_RUNNING", `Session '${runningSession.id}' is currently running and cannot be archived`)
  }

  const archivedRecords = Session.archiveSessionCascade(sessionID)
  for (const record of archivedRecords) {
    options?.ptyRegistry?.deleteBySession(record.sessionID)
  }
  const archived = archivedRecords[0]
  if (!archived) {
    throw new ApiError(404, "SESSION_NOT_FOUND", `Session '${sessionID}' not found`)
  }

  return {
    sessionID: archived.sessionID,
    projectID: archived.projectID,
    directory: archived.directory,
    archivedAt: archived.archivedAt,
    archivedSessionIDs: archivedRecords.map((record) => record.sessionID),
  }
}

export function restoreArchivedSession(sessionID: string) {
  const archived = safeReadArchivedSession(sessionID)
  if (!archived) {
    throw new ApiError(404, "ARCHIVED_SESSION_NOT_FOUND", `Archived session '${sessionID}' not found`)
  }

  if (safeReadSession(sessionID)) {
    throw new ApiError(409, "SESSION_ALREADY_EXISTS", `Session '${sessionID}' already exists`)
  }

  const project = Project.get(archived.projectID)
  if (!project) {
    throw new ApiError(
      409,
      "PROJECT_NOT_FOUND",
      `Project '${archived.projectID}' no longer exists, so session '${sessionID}' cannot be restored`,
    )
  }

  const restored = Session.restoreArchivedSession(sessionID)
  if (!restored) {
    throw new ApiError(404, "ARCHIVED_SESSION_NOT_FOUND", `Archived session '${sessionID}' not found`)
  }

  return mapSessionSummary(restored)
}

export function deleteArchivedSession(sessionID: string) {
  const archived = Session.deleteArchivedSession(sessionID)
  if (!archived) {
    throw new ApiError(404, "ARCHIVED_SESSION_NOT_FOUND", `Archived session '${sessionID}' not found`)
  }

  return {
    sessionID: archived.sessionID,
  }
}

export async function createSideChat(
  parentSessionID: string,
  input: z.infer<typeof CreateSideChatBody>,
) {
  const parentSession = safeReadSession(parentSessionID)
  if (!parentSession) {
    throw new ApiError(404, "SESSION_NOT_FOUND", `Session '${parentSessionID}' not found`)
  }

  if (Session.isSideChatSession(parentSession)) {
    throw new ApiError(409, "INVALID_PARENT_SESSION", "Side chats can only be created from main sessions")
  }

  try {
    const sideChat = await Session.createSideChat({
      parentSessionID,
      anchorMessageID: input.anchorMessageID,
    })

    return mapSessionSummary(sideChat)
  } catch (error) {
    throw new ApiError(
      400,
      "SIDE_CHAT_CREATE_FAILED",
      error instanceof Error ? error.message : String(error),
    )
  }
}

export function listSideChats(parentSessionID: string, anchorMessageID?: string) {
  const parentSession = safeReadSession(parentSessionID) ?? safeReadArchivedSession(parentSessionID)?.snapshot.session
  if (!parentSession) {
    throw new ApiError(404, "SESSION_NOT_FOUND", `Session '${parentSessionID}' not found`)
  }

  if (Session.isSideChatSession(parentSession)) {
    throw new ApiError(409, "INVALID_PARENT_SESSION", "Side chats can only be listed from main sessions")
  }

  return Session.listSideChats(parentSessionID, anchorMessageID).map(mapSideChatLink)
}

export function getSideChatLink(sessionID: string) {
  const link = Session.getSideChatLink(sessionID)
  if (!link) {
    throw new ApiError(404, "SIDE_CHAT_NOT_FOUND", `Side chat '${sessionID}' not found`)
  }

  return mapSideChatLink(link)
}

export function getSideChatContext(sessionID: string) {
  const context = Session.getSideChatContext(sessionID)
  if (!context) {
    throw new ApiError(404, "SIDE_CHAT_NOT_FOUND", `Side chat '${sessionID}' not found`)
  }

  return {
    session: mapSessionSummary(context.session),
    link: mapSideChatLink(context.link),
    messages: context.messages,
  }
}

export function getSession(sessionID: string) {
  return mapSessionSummary(requireSession(sessionID))
}

export function updateSessionActiveMessage(
  sessionID: string,
  input: z.infer<typeof UpdateSessionActiveMessageBody>,
) {
  requireSession(sessionID)
  const message = Session.DataBaseRead("messages", input.messageID) as Message.MessageInfo | null
  if (!message || message.sessionID !== sessionID) {
    throw new ApiError(404, "MESSAGE_NOT_FOUND", `Message '${input.messageID}' was not found in this session`)
  }
  if (message.role === "user" && message.internal) {
    throw new ApiError(409, "INVALID_ACTIVE_MESSAGE", "Internal messages cannot be used as the active branch head")
  }

  const session = Session.updateActiveMessageID(sessionID, message.id, { touch: true })
  if (!session) {
    throw new ApiError(404, "SESSION_NOT_FOUND", `Session '${sessionID}' not found`)
  }

  return mapSessionSummary(session)
}

export async function rollbackSessionToCheckpoint(
  sessionID: string,
  input: z.infer<typeof RollbackSessionBody>,
) {
  const session = requireSession(sessionID)

  try {
    return await Instance.provide({
      directory: session.directory,
      fn: async () => {
        const workspaceRestore = input.restoreWorkspace
          ? await SessionRollback.restoreWorkspaceToRollbackSnapshot({
            sessionID,
            targetMessageID: input.targetMessageID,
          })
          : undefined
        const branch = await SessionRollback.createCorrectiveBranch({
          sessionID,
          targetMessageID: input.targetMessageID,
          reason: input.reason,
          correctivePrompt: input.correctivePrompt,
          restoreWorkspace: workspaceRestore,
        })

        return {
          session: mapSessionSummary(branch.session),
          targetMessageID: branch.targetMessage.id,
          correctiveMessageID: branch.assistantMessage.id,
          restoreWorkspace: Boolean(input.restoreWorkspace),
          targetSnapshot: workspaceRestore?.targetSnapshot,
          preRestoreSnapshot: workspaceRestore?.preRestoreSnapshot,
          restoredFiles: workspaceRestore?.restoredFiles ?? [],
        }
      },
    })
  } catch (error) {
    throw new ApiError(
      400,
      "SESSION_ROLLBACK_FAILED",
      error instanceof Error ? error.message : String(error),
    )
  }
}

export function getSessionPty(sessionID: string, options: { ptyRegistry: PtyRegistry }) {
  const session = requireMainSession(sessionID)
  if (isSshWorkspaceUri(session.directory)) {
    throw new ApiError(409, "PTY_UNAVAILABLE_FOR_SSH", "Interactive terminal sessions are not available for SSH workspaces")
  }
  return options.ptyRegistry.infoBySession(sessionID)
}

export async function createSessionPty(sessionID: string, options: { ptyRegistry: PtyRegistry }) {
  const session = requireMainSession(sessionID)
  if (isSshWorkspaceUri(session.directory)) {
    throw new ApiError(409, "PTY_UNAVAILABLE_FOR_SSH", "Interactive terminal sessions are not available for SSH workspaces")
  }
  return await options.ptyRegistry.create({
    sessionID: session.id,
    cwd: session.directory,
  })
}

export function listSessionTasks(sessionID: string, input?: {
  owner?: string
  status?: string
  includeCompleted?: string
}) {
  requireSession(sessionID)
  const status = Task.SessionTaskStatus.safeParse(input?.status)
  return Task.listSessionTasks(sessionID, {
    owner: input?.owner?.trim() || undefined,
    status: status.success ? status.data : undefined,
    includeCompleted:
      input?.includeCompleted === undefined
        ? undefined
        : input.includeCompleted !== "false",
  })
}

export function getSessionTask(sessionID: string, taskID: string) {
  requireSession(sessionID)
  const task = Task.getSessionTask(sessionID, taskID)
  if (!task) {
    throw new ApiError(404, "TASK_NOT_FOUND", `Task '${taskID}' not found`)
  }
  return task
}

export async function listSessionMessages(sessionID: string, input?: { view?: string }) {
  requireSession(sessionID)

  const messages: Message.WithParts[] =
    input?.view === "all"
      ? Message.listAllWithParts(sessionID)
      : []
  if (input?.view !== "all") {
    for await (const item of Message.stream(sessionID)) {
      messages.push(item)
    }
  }

  const turns = Session.listTurns(sessionID)
  const turnsByID = new Map(turns.map((turn) => [turn.id, turn]))
  const turnsByUserMessageID = new Map(
    turns
      .filter((turn) => turn.userMessageID)
      .map((turn) => [turn.userMessageID!, turn]),
  )
  const turnsByLastMessageID = new Map(
    turns
      .filter((turn) => turn.lastMessageID)
      .map((turn) => [turn.lastMessageID!, turn]),
  )

  return messages.map((message) => ({
    ...message,
    turn:
      turnsByID.get(message.info.turnID ?? "") ??
      (message.info.role === "user"
        ? turnsByUserMessageID.get(message.info.id)
        : turnsByLastMessageID.get(message.info.id)),
  }))
}

export async function getSessionDiff(sessionID: string, options?: { scope?: string }) {
  const session = requireSession(sessionID)
  const diff = await Instance.provide({
    directory: session.directory,
    fn: () => options?.scope === "latest-turn"
      ? SessionDiff.computeLatestTurnDetailedDiff(sessionID)
      : SessionDiff.computeSessionDetailedDiff(sessionID),
  })

  return diff ?? SessionDiff.buildDetailedDiffSummary([])
}

function toSessionModelSelectionPayload(selection: Session.SessionModelSelection | undefined) {
  return {
    model: selection?.model,
    small_model: selection?.small_model,
    reasoning_effort: selection?.reasoning_effort,
  }
}

async function resolveEffectiveModel(
  projectID: string,
  items: PublicModel[],
  selection: Session.SessionModelSelection | undefined,
) {
  return findModelByReference(items, selection?.model) ?? resolveEffectiveModelWithFallback(projectID, items)
}

async function resolveSessionCompactionModel(session: Session.SessionInfo) {
  const selection = Session.getSessionModelSelection(session.id)
  const selectedReference = ModelSelection.parseModelReference(selection?.model)
  if (selectedReference) {
    try {
      return await ModelRegistry.getAISDKModel(
        selectedReference.providerID,
        selectedReference.modelID,
        session.projectID,
      )
    } catch {
      // Fall through to the project default if the stored session model is no longer available.
    }
  }

  const fallbackReference = await Provider.getDefaultModelRef(session.projectID)
  return ModelRegistry.getAISDKModel(
    fallbackReference.providerID,
    fallbackReference.modelID,
    session.projectID,
  )
}

export async function listSessionModels(sessionID: string) {
  const session = requireSession(sessionID)
  const items = await listProjectModelsWithFallback(session.projectID)
  const selection = Session.getSessionModelSelection(sessionID)

  return {
    effectiveModel: await resolveEffectiveModel(session.projectID, items, selection),
    items,
    selection: toSessionModelSelectionPayload(selection),
  }
}

export async function updateSessionModelSelection(
  sessionID: string,
  input: z.infer<typeof UpdateSessionModelSelectionBody>,
) {
  const session = requireSession(sessionID)

  if (input.model) {
    await ModelSelection.resolveSelectableModel(input.model, session.projectID)
  }

  if (input.small_model) {
    await ModelSelection.resolveSelectableModel(input.small_model, session.projectID)
  }

  const updated = Session.updateSessionModelSelection(sessionID, input)
  if (!updated) {
    throw new ApiError(404, "SESSION_NOT_FOUND", `Session '${sessionID}' not found`)
  }

  return toSessionModelSelectionPayload(Session.getSessionModelSelection(sessionID))
}

export async function compactSession(sessionID: string) {
  const session = requireSession(sessionID)
  if (Session.isSideChatSession(session)) {
    throw new ApiError(409, "INVALID_COMPACTION_SESSION", "Side chat sessions do not support manual compaction")
  }
  if (RunningState.isRunning(sessionID)) {
    throw new ApiError(409, "SESSION_RUNNING", `Session '${sessionID}' is currently running and cannot be compacted`)
  }

  return Instance.provide({
    directory: session.directory,
    async fn() {
      const activeSession = requireSession(sessionID)
      const model = await resolveSessionCompactionModel(activeSession)
      const agent = await Agent.get("default")
      const selection = Session.getSessionModelSelection(sessionID)
      const messages: Message.WithParts[] = []
      for await (const message of Message.stream(sessionID)) {
        messages.push(message)
      }

      const system = [
        ...await SystemPrompt.defaultPrompt({
          agent,
          session: activeSession,
        }),
        ...await SystemPrompt.environment(model),
      ].filter((item): item is string => typeof item === "string")

      const result = await ContextWindow.compactPromptContext({
        sessionID,
        model,
        system,
        messages,
        reasoningEffort: selection?.reasoning_effort,
        tools: {},
        auto: false,
      })

      return {
        sessionID,
        ...result,
      }
    },
  })
}

export function updateSessionTitle(
  sessionID: string,
  input: z.infer<typeof UpdateSessionTitleBody>,
) {
  requireSession(sessionID)
  const updated = Session.updateSessionTitle(sessionID, input.title)
  if (!updated) {
    throw new ApiError(404, "SESSION_NOT_FOUND", `Session '${sessionID}' not found`)
  }

  return mapSessionSummary(updated)
}

export function updateSessionPinned(
  sessionID: string,
  input: z.infer<typeof UpdateSessionPinnedBody>,
) {
  requireSession(sessionID)
  const updated = Session.updateSessionPinned(sessionID, input.pinned)
  if (!updated) {
    throw new ApiError(404, "SESSION_NOT_FOUND", `Session '${sessionID}' not found`)
  }

  return mapSessionSummary(updated)
}

export function updateSessionWorkflow(
  sessionID: string,
  input: z.infer<typeof UpdateSessionWorkflowBody>,
) {
  requireSession(sessionID)

  const updated = Session.updateSessionWorkflow(sessionID, (workflow) => {
    const now = Date.now()

    switch (input.action) {
      case "enter-plan":
        return {
          mode: "planning",
          plan: {
            status: "draft",
            draftMarkdown: undefined,
            pendingRequestID: undefined,
            approvedMarkdown: undefined,
            approvedAt: undefined,
            pendingInstruction: "plan-mode",
            updatedAt: now,
          },
        }
      case "leave-plan":
        return {
          mode: "execution",
          plan: {
            status: "idle",
            draftMarkdown: workflow.plan.draftMarkdown,
            pendingRequestID: undefined,
            approvedMarkdown: undefined,
            approvedAt: undefined,
            pendingInstruction: "exit-plan",
            updatedAt: now,
          },
        }
      case "approve-plan": {
        const approvedMarkdown = input.proposedPlanMarkdown.trim()
        if (!approvedMarkdown) {
          throw new ApiError(400, "EMPTY_PLAN", "Approved plan markdown must not be empty")
        }

        return {
          mode: "execution",
          plan: {
            status: "approved",
            draftMarkdown: approvedMarkdown,
            pendingRequestID: undefined,
            approvedMarkdown,
            approvedAt: now,
            pendingInstruction: "execute-approved-plan",
            updatedAt: now,
          },
        }
      }
    }
  })

  if (!updated) {
    throw new ApiError(404, "SESSION_NOT_FOUND", `Session '${sessionID}' not found`)
  }

  return mapSessionSummary(updated)
}

export async function deleteSession(sessionID: string, options?: { ptyRegistry?: PtyRegistry }) {
  const session = requireSession(sessionID)
  await Instance.provide({
    directory: session.directory,
    async fn() {
      await Mcp.notifyNodeReplLifecycleIfConnected({
        type: "session-end",
        context: {
          sessionID,
          turnID: `session-end-${sessionID}`,
        },
        detail: {
          reason: "session-deleted",
        },
      }).catch(() => false)
      await clearInProcessPermissionSession(sessionID)
    },
  })
  Session.removeSession(sessionID)
  options?.ptyRegistry?.deleteBySession(sessionID)

  return {
    sessionID: session.id,
    projectID: session.projectID,
  }
}

export async function cancelSession(sessionID: string, input: CancelSessionInput = {}) {
  requireSession(sessionID)
  const result = Prompt.cancelSession(sessionID, {
    cancelQueued: input.cancelQueued ?? false,
    reason: input.reason ?? "user",
  })
  const subtasks = await Subtask.cancelRunningSubtasksByParentSession(sessionID, {
    cancelQueued: true,
  })

  return {
    sessionID,
    cancelled: result.cancelled || subtasks.cancelled,
    activeCancelled: result.activeCancelled,
    queuedCancelled: result.queuedCancelled,
  }
}

export function answerSessionQuestion(
  sessionID: string,
  input: z.infer<typeof AnswerSessionQuestionBody>,
) {
  requireSession(sessionID)

  try {
    return answerAskUserQuestion({
      sessionID,
      questionID: input.questionID,
      selectedOptions: input.selectedOptions,
      freeformText: input.freeformText,
    })
  } catch (error) {
    throw new ApiError(
      409,
      "QUESTION_NOT_WAITING",
      error instanceof Error ? error.message : String(error),
    )
  }
}

export function createEventStreamResponse(input: {
  sessionID: string
  requestId?: string
  replayCursor?: string
}) {
  const session = requireSession(input.sessionID)

  let since: ReturnType<typeof parseReplayCursor>
  try {
    since = parseReplayCursor(input.replayCursor)
  } catch {
    throw new ApiError(400, "INVALID_REPLAY_CURSOR", "Query 'since' or header 'Last-Event-ID' is invalid")
  }

  log.info("received session event stream request", {
    sessionID: input.sessionID,
    requestId: input.requestId,
    directory: session.directory,
    replayFrom: since ? serializeReplayCursor(since) : undefined,
  })

  return createSessionEventStream({
    sessionID: input.sessionID,
    requestId: input.requestId,
    since,
  })
}

export async function createMessageStreamResponse(input: {
  sessionID: string
  payload: StreamSessionMessageInput
  requestId?: string
  replayTurnID?: string
  sinceSeq?: string
  signal?: AbortSignal
}) {
  const session = requireSession(input.sessionID)
  throwIfAborted(input.signal)
  const normalizedText = normalizePromptText(input.payload.text)

  log.info("received session stream request", {
    sessionID: input.sessionID,
    requestId: input.requestId,
    directory: session.directory,
    textLength: normalizedText?.length ?? 0,
    questionAnswerID: input.payload.questionAnswer?.questionID,
    questionAnswerOptions: input.payload.questionAnswer?.selectedOptions?.length ?? 0,
    attachmentCount: input.payload.attachments?.length ?? 0,
    attachments: (input.payload.attachments ?? []).map((attachment) => summarizeAttachmentInput(attachment)),
    reasoningEffort: input.payload.reasoningEffort ?? "default",
    model: input.payload.model ? `${input.payload.model.providerID}/${input.payload.model.modelID}` : "default",
    skillCount: input.payload.skills?.length ?? 0,
  })

  let handle: ReturnType<typeof Prompt.promptExecution>
  try {
    handle = await Instance.provide({
      directory: session.directory,
      fn: async () => {
        const parts = await resolvePromptPartsFromStreamPayload(input.payload, {
          signal: input.signal,
        })
        throwIfAborted(input.signal)
        const handle = Prompt.promptExecution({
          sessionID: input.sessionID,
          parentMessageID: input.payload.parentMessageID,
          parts,
          system: input.payload.system,
          agent: input.payload.agent,
          skills: input.payload.skills,
          turnMcpServerIDs: input.payload.turnMcpServerIDs,
          concurrentInputMode: input.payload.concurrentInputMode,
          reasoningEffort: input.payload.reasoningEffort,
          model: input.payload.model,
          displayText: input.payload.displayText,
        })
        if (input.signal?.aborted) {
          handle.cancel()
          throwIfAborted(input.signal)
        }
        return handle
      },
    })
  } catch (error) {
    if (isSessionLimitError(error)) {
      return createSessionExecutionErrorStream({
        sessionID: input.sessionID,
        requestId: input.requestId,
        turnID: input.replayTurnID,
        error,
      })
    }
    throw error
  }

  return createSessionExecutionStream({
    sessionID: input.sessionID,
    requestId: input.requestId,
    replayTurnID: input.replayTurnID,
    sinceSeq: parseSinceSeq(input.sinceSeq),
    handle,
  })
}

export async function createResumeStreamResponse(input: {
  sessionID: string
  requestId?: string
  replayTurnID?: string
  sinceSeq?: string
  signal?: AbortSignal
}) {
  const session = requireSession(input.sessionID)
  throwIfAborted(input.signal)
  let handle: ReturnType<typeof Prompt.resumeExecution>
  try {
    handle = await Instance.provide({
      directory: session.directory,
      fn: () => {
        const nextHandle = Prompt.resumeExecution({ sessionID: input.sessionID })
        if (input.signal?.aborted) {
          nextHandle.cancel()
          throwIfAborted(input.signal)
        }
        return nextHandle
      },
    })
  } catch (error) {
    if (isSessionLimitError(error)) {
      return createSessionExecutionErrorStream({
        sessionID: input.sessionID,
        requestId: input.requestId,
        turnID: input.replayTurnID,
        error,
      })
    }
    throw error
  }

  return createSessionExecutionStream({
    sessionID: input.sessionID,
    requestId: input.requestId,
    replayTurnID: input.replayTurnID,
    sinceSeq: parseSinceSeq(input.sinceSeq),
    handle,
  })
}
