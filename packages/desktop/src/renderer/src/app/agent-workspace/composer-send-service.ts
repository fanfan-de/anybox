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
  PendingAgentStream,
  PendingConversationInput,
  ReasoningEffort,
  SessionSummary,
  ThreadMessage,
  UserThreadMessage,
  WorkspaceGroup,
} from "../types"
import { createID } from "../utils"
import { isSideChatSession } from "../workspace"
import type { WorkspaceStateUpdater } from "./workspace-store"

export function resolveComposerSkillSelectionForSession(
  session: Pick<SessionSummary, "kind"> | null | undefined,
  selectedSkillIDs: string[],
) {
  return isSideChatSession(session) ? [] : selectedSkillIDs
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

function parseComposerModelValue(value: string | null | undefined) {
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
  parentMessageID?: string | null
  preserveComposerState?: boolean
  questionAnswer?: {
    questionID: string
    selectedOptions?: string[]
    freeformText?: string
  }
  reasoningEffort?: ReasoningEffort | null
  references?: UserThreadMessage["references"]
  selectedModel?: string | null
  selectedSkillIDs: string[]
  session: SessionSummary
  submissionMode?: UserThreadMessage["submissionMode"]
  tabKey: string
  text: string
  workspace: WorkspaceGroup
}

interface SendPromptToSessionEnvironment {
  agentConnected: boolean
  agentDefaultDirectory: string
  agentSessions: Record<string, string>
  appendConversationMessages: (sessionID: string, nextMessages: ThreadMessage[]) => void
  replaceConversationMessages: (sessionID: string, nextMessages: ThreadMessage[]) => void
  getConversationMessages: (sessionID: string) => ThreadMessage[]
  pendingStreamsRef: MutableRefObject<Record<string, PendingAgentStream>>
  platform: string
  refreshWorkspaceFromDirectory: (directory: string) => void | Promise<WorkspaceGroup | null>
  reloadSessionHistoryForSession: (sessionID: string, backendSessionID?: string) => Promise<void>
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
    pendingStreamsRef,
    platform,
    refreshWorkspaceFromDirectory,
    reloadSessionHistoryForSession,
    sessionDirectoryBySession,
    setAgentSessions,
    setComposerAttachmentsByTabKey,
    setComposerDraftStateByTabKey,
    setIsSendingByTabKey,
    setPendingConversationInputsBySession,
    setSessionDirectoryBySession,
    setWorkspaces,
    updateAssistantConversationMessage,
  } = environment
  const {
    attachments,
    displayText,
    parentMessageID,
    preserveComposerState,
    questionAnswer,
    reasoningEffort,
    references = [],
    selectedModel,
    session,
    selectedSkillIDs,
    submissionMode,
    tabKey,
    text,
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
  const normalizedText = text.trim() || normalizeQuestionAnswerText(questionAnswer)
  const attachmentInputs = attachments.map((attachment) => ({
    path: attachment.path,
    name: attachment.name,
  }))
  const model = resolveComposerTurnModel(selectedModel, session)
  const effectiveSelectedSkillIDs = resolveComposerSkillSelectionForSession(session, selectedSkillIDs)
  const userMessageDisplayText = displayText?.trim() || normalizeQuestionAnswerText(questionAnswer) || undefined
  const userMessage: UserThreadMessage = buildUserThreadMessage({
    attachments: attachmentInputs,
    displayText: userMessageDisplayText,
    fallbackText: normalizedText,
    questionAnswer,
    references,
  })
  const pendingInput: PendingConversationInput | null = pendingInputMode
    ? {
        id: userMessage.id,
        sessionID: uiSessionID,
        text: userMessage.text,
        ...(userMessage.displayText ? { displayText: userMessage.displayText } : {}),
        ...(userMessage.attachments?.length ? { attachments: userMessage.attachments } : {}),
        ...(userMessage.references?.length ? { references: userMessage.references } : {}),
        ...(userMessage.questionAnswer ? { questionAnswer: userMessage.questionAnswer } : {}),
        mode: pendingInputMode,
        status: "pending",
        createdAt: userMessage.timestamp,
      }
    : null

  if (!preserveComposerState) {
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
  } else if (parentMessageID) {
    const currentMessages = getConversationMessages(uiSessionID)
    const parentMessageIndex = currentMessages.findIndex((message) =>
      message.kind === "assistant"
        ? (message.messageID ?? message.id) === parentMessageID
        : message.id === parentMessageID,
    )
    const parentPathMessages = parentMessageIndex >= 0 ? currentMessages.slice(0, parentMessageIndex + 1) : currentMessages
    replaceConversationMessages(uiSessionID, [...parentPathMessages, userMessage])
  } else {
    appendConversationMessages(uiSessionID, [userMessage])
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
            summary: userMessage.text,
            updated: nextUpdatedAt,
          }
        : currentSession,
      ),
    }))
  })

  if (!agentConnected || !window.desktop?.createAgentSession || !agentSession) {
    const fallback = buildAgentThreadMessage(userMessage.text, session, workspace.name, platform)
    startTransition(() => {
      appendConversationMessages(uiSessionID, [fallback])
    })
    return
  }

  setIsSendingByTabKey((current) => ({
    ...current,
    [tabKey]: true,
  }))
  let streamingMessageID: string | null = null
  let streamID: string | null = null

  try {
    let backendSessionID = input.backendSessionID ?? agentSessions[uiSessionID]
    if (!backendSessionID) {
      const requestedSessionDirectory = sessionDirectoryBySession[uiSessionID] ?? workspace.directory
      const created = await window.desktop.createAgentSession({
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

    if (canStream) {
      const streamingMessage = buildStreamingAssistantThreadMessage(userMessage.text)
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
        userThreadMessageID: userMessage.id,
        requestedMode: pendingInput?.mode === "steer" ? "steer" : pendingInput?.mode === "queued" ? "queue" : "new-turn",
        createdAssistantThreadMessageID: streamingMessage.id,
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
    })

    if (!result.events) {
      throw new Error("Desktop preload did not return batch agent events")
    }

    const assistantMessage = buildAgentThreadMessageFromEvents(result.events, userMessage.text)
    startTransition(() => {
      appendConversationMessages(uiSessionID, [assistantMessage])
    })
    void reloadSessionHistoryForSession(uiSessionID, backendSessionID).catch((error) => {
      console.error("[desktop] session history refresh failed after send:", error)
    })
    void refreshWorkspaceFromDirectory(workspace.directory)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (streamID) {
      delete pendingStreamsRef.current[streamID]
    }
    if (pendingInput) {
      setPendingConversationInputsBySession((current) =>
        removePendingConversationInput(current, pendingInput.sessionID, pendingInput.id),
      )
    }

    startTransition(() => {
      if (streamingMessageID) {
        const failedMessageID = streamingMessageID
        updateAssistantConversationMessage(uiSessionID, failedMessageID, (current) => buildFailureThreadMessage(message, current))
        return
      }

      appendConversationMessages(uiSessionID, [buildFailureThreadMessage(message)])
    })
  } finally {
    setIsSendingByTabKey((current) => {
      if (!(tabKey in current)) return current
      const next = { ...current }
      delete next[tabKey]
      return next
    })
  }
}
