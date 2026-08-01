import { startTransition, type MutableRefObject } from "react"
import { getAgentSessionBridge } from "../agent-session/client"
import { createEmptyComposerDraftState } from "../composer/draft-state"
import {
  buildAgentThreadMessage,
  buildAgentThreadMessageFromEvents,
  buildFailureThreadMessage,
  buildStreamingAssistantThreadMessage,
  buildUserThreadMessage,
} from "../stream"
import { appendPendingConversationInput, removePendingConversationInput } from "../pending-conversation-inputs"
import type {
  AssistantThreadMessage,
  ComposerAttachment,
  ComposerCommentReference,
  ComposerDraftState,
  OptimisticUserSubmission,
  PendingAgentStream,
  PendingConversationInput,
  ReasoningEffort,
  SessionSummary,
  ThreadMessage,
  UserThreadMessage,
  WorkspaceGroup,
} from "../types"
import { createID } from "../utils"
import type { WorkspaceStateUpdater } from "./workspace-store"

export function resolveComposerSkillSelectionForSession(
  _session: SessionSummary | null | undefined,
  selectedSkillIDs: string[],
) {
  return selectedSkillIDs
}

export function normalizeQuestionAnswerText(input?: {
  selectedOptions?: string[]
  freeformText?: string
}) {
  const freeformText = input?.freeformText?.trim()
  if (freeformText) return freeformText

  const selectedOptions = (input?.selectedOptions ?? []).map((value) => value.trim()).filter(Boolean)
  if (selectedOptions.length > 0) return selectedOptions.join(", ")

  return ""
}

export function parseComposerModelValue(value: string | null | undefined) {
  if (!value) return undefined
  const [providerID, ...rest] = value.split("/")
  const modelID = rest.join("/")
  if (!providerID || !modelID) return undefined
  return {
    providerID,
    modelID,
  }
}

function resolveComposerTurnModel(
  selectedModel: string | null | undefined,
  session: Pick<SessionSummary, "modelSelection">,
) {
  const modelValue = selectedModel?.trim()
  if (!modelValue) return undefined

  const persistedModelValue = session.modelSelection?.model?.trim()
  if (!persistedModelValue || persistedModelValue !== modelValue) return undefined

  return parseComposerModelValue(modelValue)
}

interface SendPromptToSessionInput {
  attachments: ComposerAttachment[]
  backendSessionID?: string | null
  commentReferences?: ComposerCommentReference[]
  displayText?: string
  modelOverride?: {
    providerID: string
    modelID: string
  }
  parentMessageID?: string | null
  prepareBeforeSend?: (() => Promise<void>) | null
  preserveComposerState?: boolean
  questionAnswer?: {
    questionID: string
    selectedOptions?: string[]
    freeformText?: string
  }
  reasoningEffort?: ReasoningEffort | null
  references?: UserThreadMessage["references"]
  resolveModelBeforeSend?: (() => Promise<{
    providerID: string
    modelID: string
  } | undefined>) | null
  retryUserMessageID?: string
  selectedModel?: string | null
  selectedSkillIDs: string[]
  turnMcpServerIDs: string[]
  turnToolModuleIDs: string[]
  session: SessionSummary
  submissionMode?: UserThreadMessage["submissionMode"]
  tabKey: string
  text: string
  waitForPendingModelSelection?: (() => Promise<void>) | null
  workspace: WorkspaceGroup
}

interface SendPromptToSessionEnvironment {
  agentConnected: boolean
  agentDefaultDirectory: string
  agentSessions: Record<string, string>
  appendConversationMessages: (sessionID: string, nextMessages: ThreadMessage[]) => void
  replaceConversationMessages: (sessionID: string, nextMessages: ThreadMessage[]) => void
  getConversationMessages: (sessionID: string) => ThreadMessage[]
  optimisticUserSubmissionsRef: MutableRefObject<Record<string, OptimisticUserSubmission>>
  pendingStreamsRef: MutableRefObject<Record<string, PendingAgentStream>>
  platform: string
  refreshWorkspaceFromDirectory: (directory: string) => void | Promise<WorkspaceGroup | null>
  reloadSessionHistoryForSession: (sessionID: string, backendSessionID?: string) => Promise<void>
  prepareUserMessageRetry: (sessionID: string, userThreadMessageID: string) => boolean
  removeConversationMessage: (sessionID: string, messageID: string) => void
  sessionDirectoryBySession: Record<string, string>
  setAgentSessions: (update: WorkspaceStateUpdater<Record<string, string>>) => void
  setComposerAttachmentsByTabKey: (
    update: WorkspaceStateUpdater<Record<string, ComposerAttachment[]>>,
  ) => void
  setComposerDraftStateByTabKey: (
    update: WorkspaceStateUpdater<Record<string, ComposerDraftState>>,
  ) => void
  setIsSendingByTabKey: (update: WorkspaceStateUpdater<Record<string, boolean>>) => void
  setPendingConversationInputsBySession: (
    update: WorkspaceStateUpdater<Record<string, PendingConversationInput[]>>,
  ) => void
  setSessionDirectoryBySession: (update: WorkspaceStateUpdater<Record<string, string>>) => void
  setWorkspaces: (update: WorkspaceStateUpdater<WorkspaceGroup[]>) => void
  updateAssistantConversationMessage: (
    sessionID: string,
    assistantMessageID: string,
    updater: (message: AssistantThreadMessage) => AssistantThreadMessage,
  ) => void
  updateUserMessageDelivery: (
    sessionID: string,
    userThreadMessageID: string,
    delivery: UserThreadMessage["delivery"],
  ) => boolean
}

export async function sendPromptToSession(
  input: SendPromptToSessionInput,
  environment: SendPromptToSessionEnvironment,
) {
  const {
    agentConnected,
    agentDefaultDirectory,
    agentSessions,
    appendConversationMessages,
    replaceConversationMessages,
    getConversationMessages,
    optimisticUserSubmissionsRef,
    pendingStreamsRef,
    platform,
    refreshWorkspaceFromDirectory,
    reloadSessionHistoryForSession,
    prepareUserMessageRetry,
    removeConversationMessage,
    sessionDirectoryBySession,
    setAgentSessions,
    setComposerAttachmentsByTabKey,
    setComposerDraftStateByTabKey,
    setIsSendingByTabKey,
    setPendingConversationInputsBySession,
    setSessionDirectoryBySession,
    setWorkspaces,
    updateAssistantConversationMessage,
    updateUserMessageDelivery,
  } = environment
  const {
    attachments,
    displayText,
    modelOverride,
    parentMessageID,
    preserveComposerState,
    questionAnswer,
    reasoningEffort,
    references = [],
    retryUserMessageID,
    selectedModel,
    session,
    selectedSkillIDs,
    turnMcpServerIDs,
    turnToolModuleIDs,
    submissionMode,
    tabKey,
    text,
    waitForPendingModelSelection,
    workspace,
  } = input
  const uiSessionID = session.id
  const agentSession = getAgentSessionBridge()
  const canStream = Boolean(agentSession?.canStream)
  const concurrentInputMode = submissionMode === "steer" ? "steer" : submissionMode === "queued" ? "queue" : undefined
  const usesBackendStream = agentConnected && Boolean(window.desktop?.createAgentSession) && Boolean(agentSession) && canStream
  const pendingInputMode = usesBackendStream && (submissionMode === "queued" || submissionMode === "steer")
    ? submissionMode
    : null
  const usesOptimisticUserMessage = usesBackendStream && !pendingInputMode
  const normalizedText = text.trim() || normalizeQuestionAnswerText(questionAnswer)
  const attachmentInputs = attachments.map((attachment) => ({
    path: attachment.path,
    name: attachment.name,
  }))
  let model = modelOverride ?? resolveComposerTurnModel(selectedModel, session)
  const effectiveSelectedSkillIDs = resolveComposerSkillSelectionForSession(session, selectedSkillIDs)
  const userMessageDisplayText = displayText?.trim() || normalizeQuestionAnswerText(questionAnswer) || undefined
  const userMessage: UserThreadMessage = buildUserThreadMessage({
    attachments: attachmentInputs,
    displayText: userMessageDisplayText,
    fallbackText: normalizedText,
    questionAnswer,
    references,
    turnMcpServerIDs,
    turnToolModuleIDs,
    ...(retryUserMessageID ? { id: retryUserMessageID } : {}),
  })
  const optimisticUserMessage: UserThreadMessage = usesOptimisticUserMessage
    ? {
        ...userMessage,
        delivery: { status: "pending" },
      }
    : userMessage
  const renderedUserMessage = optimisticUserMessage
  const pendingInput: PendingConversationInput | null = pendingInputMode
    ? {
        id: renderedUserMessage.id,
        sessionID: uiSessionID,
        text: renderedUserMessage.text,
        ...(normalizedText ? { transportText: normalizedText } : {}),
        ...(renderedUserMessage.displayText ? { displayText: renderedUserMessage.displayText } : {}),
        ...(renderedUserMessage.attachments?.length ? { attachments: renderedUserMessage.attachments } : {}),
        ...(renderedUserMessage.references?.length ? { references: renderedUserMessage.references } : {}),
        ...(renderedUserMessage.questionAnswer ? { questionAnswer: renderedUserMessage.questionAnswer } : {}),
        ...(renderedUserMessage.turnMcpServerIDs?.length ? { turnMcpServerIDs: renderedUserMessage.turnMcpServerIDs } : {}),
        ...(renderedUserMessage.turnToolModuleIDs?.length ? { turnToolModuleIDs: renderedUserMessage.turnToolModuleIDs } : {}),
        mode: pendingInputMode,
        status: "pending",
        createdAt: renderedUserMessage.timestamp,
      }
    : null

  if (usesOptimisticUserMessage) {
    const existingSubmission = optimisticUserSubmissionsRef.current[renderedUserMessage.id]
    const request = existingSubmission?.request ?? {
      attachments: attachments.map((attachment) => ({ ...attachment })),
      ...(displayText ? { displayText } : {}),
      ...(parentMessageID ? { parentMessageID } : {}),
      ...(questionAnswer
        ? {
            questionAnswer: {
              ...questionAnswer,
              ...(questionAnswer.selectedOptions
                ? { selectedOptions: [...questionAnswer.selectedOptions] }
                : {}),
            },
          }
        : {}),
      ...(reasoningEffort ? { reasoningEffort } : {}),
      ...(references.length ? { references: references.map((reference) => ({ ...reference })) } : {}),
      ...(model ? { model: { ...model } } : {}),
      selectedSkillIDs: [...effectiveSelectedSkillIDs],
      tabKey,
      text: normalizedText,
      turnMcpServerIDs: [...turnMcpServerIDs],
      turnToolModuleIDs: [...turnToolModuleIDs],
    }
    const retiredClientTurnIDs = [
      ...new Set([
        ...(existingSubmission?.retiredClientTurnIDs ?? []),
        ...(existingSubmission?.activeClientTurnID
          ? [existingSubmission.activeClientTurnID]
          : []),
      ]),
    ]
    const retiredBackendTurnIDs = [
      ...new Set([
        ...(existingSubmission?.retiredBackendTurnIDs ?? []),
        ...(existingSubmission?.backendTurnID
          ? [existingSubmission.backendTurnID]
          : []),
      ]),
    ]
    optimisticUserSubmissionsRef.current[renderedUserMessage.id] = {
      ...(existingSubmission?.backendSessionID
        ? { backendSessionID: existingSubmission.backendSessionID }
        : {}),
      ...(input.backendSessionID ? { backendSessionID: input.backendSessionID } : {}),
      request,
      ...(retiredBackendTurnIDs.length > 0 ? { retiredBackendTurnIDs } : {}),
      ...(retiredClientTurnIDs.length > 0 ? { retiredClientTurnIDs } : {}),
      retrying: Boolean(retryUserMessageID),
      sessionID: uiSessionID,
      userThreadMessageID: renderedUserMessage.id,
    }
  }

  if (!preserveComposerState && !retryUserMessageID) {
    setComposerDraftStateByTabKey((current) => ({
      ...current,
      [tabKey]: createEmptyComposerDraftState(),
    }))
    setComposerAttachmentsByTabKey((current) => ({
      ...current,
      [tabKey]: [],
    }))
  }

  if (pendingInput) {
    setPendingConversationInputsBySession((current) => appendPendingConversationInput(current, pendingInput))
  } else if (retryUserMessageID) {
    prepareUserMessageRetry(uiSessionID, retryUserMessageID)
  } else if (parentMessageID) {
    const currentMessages = getConversationMessages(uiSessionID)
    const parentMessageIndex = currentMessages.findIndex((message) =>
      message.kind === "assistant"
        ? (message.messageID ?? message.id) === parentMessageID
        : message.id === parentMessageID,
    )
    const parentPathMessages = parentMessageIndex >= 0 ? currentMessages.slice(0, parentMessageIndex + 1) : currentMessages
    replaceConversationMessages(uiSessionID, [...parentPathMessages, renderedUserMessage])
  } else {
    appendConversationMessages(uiSessionID, [renderedUserMessage])
  }
  setWorkspaces((prev) => {
    const nextUpdatedAt = Date.now()

    return prev.map((currentWorkspace) => ({
      ...currentWorkspace,
      sessions: currentWorkspace.sessions.map((currentSession) =>
            currentSession.id === uiSessionID
        ? {
            ...currentSession,
            status: "Live",
            summary: renderedUserMessage.text,
            updated: nextUpdatedAt,
          }
        : currentSession,
      ),
    }))
  })

  const createAgentSession = window.desktop?.createAgentSession
  const hasAgentTransport = Boolean(
    agentConnected &&
    createAgentSession &&
    agentSession,
  )
  if (hasAgentTransport) {
    setIsSendingByTabKey((current) => ({
      ...current,
      [tabKey]: true,
    }))
  }
  let streamingMessageID: string | null = null
  let streamID: string | null = null

  try {
    if (waitForPendingModelSelection) {
      await waitForPendingModelSelection().catch(() => undefined)
    }
    if (input.resolveModelBeforeSend) {
      model = await input.resolveModelBeforeSend()
      const optimisticSubmission = usesOptimisticUserMessage
        ? optimisticUserSubmissionsRef.current[renderedUserMessage.id]
        : undefined
      if (optimisticSubmission) {
        const {
          model: _previousModel,
          ...requestWithoutModel
        } = optimisticSubmission.request
        optimisticSubmission.request = model
          ? {
              ...requestWithoutModel,
              model: { ...model },
            }
          : requestWithoutModel
      }
    }
    if (input.prepareBeforeSend) {
      await input.prepareBeforeSend()
    }

    if (!hasAgentTransport || !agentSession || !createAgentSession) {
      const fallback = buildAgentThreadMessage(renderedUserMessage.text, session, workspace.name, platform)
      startTransition(() => {
        appendConversationMessages(uiSessionID, [fallback])
      })
      return
    }

    let backendSessionID = input.backendSessionID ?? agentSessions[uiSessionID]
    if (!backendSessionID) {
      const requestedSessionDirectory = sessionDirectoryBySession[uiSessionID] ?? workspace.directory
      const created = await createAgentSession({
        directory: requestedSessionDirectory || agentDefaultDirectory || undefined,
      })
      backendSessionID = created.session.id
      setAgentSessions((prev) => ({
        ...prev,
        [uiSessionID]: backendSessionID!,
      }))
      setSessionDirectoryBySession((prev) => ({
        ...prev,
        [uiSessionID]: created.session.directory,
      }))
    }

    if (!backendSessionID) {
      throw new Error("Backend session id is missing")
    }
    const optimisticSubmission = usesOptimisticUserMessage
      ? optimisticUserSubmissionsRef.current[renderedUserMessage.id]
      : undefined
    if (optimisticSubmission) {
      optimisticSubmission.backendSessionID = backendSessionID
    }

    if (canStream) {
      const streamingMessage = buildStreamingAssistantThreadMessage(
        renderedUserMessage.text,
        usesOptimisticUserMessage
          ? { backendTurnID: `pending:${renderedUserMessage.id}` }
          : {},
      )
      const assistantThreadMessageID = streamingMessage.id
      if (!assistantThreadMessageID) {
        throw new Error("Assistant stream target is missing")
      }

      streamingMessageID = streamingMessage?.id ?? null
      streamID = createID("stream")
      pendingStreamsRef.current[streamID] = {
        sessionID: uiSessionID,
        backendSessionID,
        assistantThreadMessageID,
        ...(pendingInput ? { pendingInput } : {}),
        ...(pendingInput ? { pendingInputID: pendingInput.id } : {}),
        userThreadMessageID: renderedUserMessage.id,
        requestedMode: pendingInput?.mode === "steer" ? "steer" : pendingInput?.mode === "queued" ? "queue" : "new-turn",
        createdAssistantThreadMessageID: streamingMessage.id,
      }
      if (optimisticSubmission) {
        optimisticSubmission.activeClientTurnID = streamID
        optimisticSubmission.assistantThreadMessageID = streamingMessage.id
      }

      if (!pendingInput) {
        appendConversationMessages(uiSessionID, [streamingMessage])
      }

      await agentSession.sendTurn({
        clientTurnID: streamID,
        backendSessionID,
        ...(normalizedText ? { text: normalizedText } : {}),
        ...(userMessageDisplayText ? { displayText: userMessageDisplayText } : {}),
        ...(parentMessageID ? { parentMessageID } : {}),
        ...(attachmentInputs.length > 0 ? { attachments: attachmentInputs } : {}),
        ...(questionAnswer ? { questionAnswer } : {}),
        ...(concurrentInputMode ? { concurrentInputMode } : {}),
        ...(reasoningEffort ? { reasoningEffort } : {}),
        ...(model ? { model } : {}),
        skills: effectiveSelectedSkillIDs,
        turnMcpServerIDs,
        turnToolModuleIDs,
      })

      return
    }

    const result = await agentSession.sendTurn({
      clientTurnID: createID("turn"),
      backendSessionID,
      ...(normalizedText ? { text: normalizedText } : {}),
      ...(userMessageDisplayText ? { displayText: userMessageDisplayText } : {}),
      ...(parentMessageID ? { parentMessageID } : {}),
      ...(attachmentInputs.length > 0 ? { attachments: attachmentInputs } : {}),
      ...(questionAnswer ? { questionAnswer } : {}),
      ...(concurrentInputMode ? { concurrentInputMode } : {}),
      ...(reasoningEffort ? { reasoningEffort } : {}),
      ...(model ? { model } : {}),
      skills: effectiveSelectedSkillIDs,
      turnMcpServerIDs,
      turnToolModuleIDs,
    })

    if (!result.events) {
      throw new Error("Desktop preload did not return batch agent events")
    }

    const assistantMessage = buildAgentThreadMessageFromEvents(result.events, renderedUserMessage.text)
    startTransition(() => {
      appendConversationMessages(uiSessionID, [assistantMessage])
    })
    void reloadSessionHistoryForSession(uiSessionID, backendSessionID).catch((error) => {
      console.error("[desktop] session history refresh failed after send:", error)
    })
    void refreshWorkspaceFromDirectory(workspace.directory)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const optimisticSubmission = usesOptimisticUserMessage
      ? optimisticUserSubmissionsRef.current[renderedUserMessage.id]
      : undefined
    const failedOptimisticSubmission = Boolean(
      optimisticSubmission &&
      (
        !streamID ||
        !optimisticSubmission.activeClientTurnID ||
        optimisticSubmission.activeClientTurnID === streamID
      ),
    )
    if (failedOptimisticSubmission && optimisticSubmission) {
      optimisticSubmission.retrying = false
      updateUserMessageDelivery(uiSessionID, renderedUserMessage.id, {
        status: "failed",
        error: message,
      })
      if (streamingMessageID) {
        removeConversationMessage(uiSessionID, streamingMessageID)
      }
    }
    if (streamID) {
      delete pendingStreamsRef.current[streamID]
    }
    if (pendingInput) {
      setPendingConversationInputsBySession((current) =>
        removePendingConversationInput(current, pendingInput.sessionID, pendingInput.id),
      )
    }

    if (!failedOptimisticSubmission) {
      startTransition(() => {
        if (streamingMessageID) {
          const failedMessageID = streamingMessageID
          updateAssistantConversationMessage(uiSessionID, failedMessageID, (current) => buildFailureThreadMessage(message, current))
          return
        }

        appendConversationMessages(uiSessionID, [buildFailureThreadMessage(message)])
      })
    }
  } finally {
    if (hasAgentTransport) {
      setIsSendingByTabKey((current) => {
        if (!(tabKey in current)) return current
        const next = { ...current }
        delete next[tabKey]
        return next
      })
    }
  }
}
