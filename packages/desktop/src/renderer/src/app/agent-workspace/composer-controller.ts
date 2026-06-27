import type { MutableRefObject } from "react"
import { buildComposerAttachment, isComposerAttachmentSupported } from "../composer/attachment-utils"
import {
  compileComposerSubmission,
  createComposerDraftStateFromPlainText,
  createEmptyComposerDraftState,
  normalizeComposerDraftState,
} from "../composer/draft-state"
import type {
  AssistantThreadMessage,
  ComposerAttachment,
  ComposerCommentReference,
  ComposerDraftState,
  ComposerPastedImageAttachment,
  CreateSessionTab,
  PendingAgentStream,
  PendingConversationInput,
  PermissionDecision,
  PermissionRequest,
  ReasoningEffort,
  SessionSummary,
  ThreadMessage,
  UserThreadMessage,
  WorkspaceGroup,
} from "../types"
import { getAgentSessionBridge } from "../agent-session/client"
import { buildFailureThreadMessage } from "../stream"
import {
  findSession,
  findWorkspaceByID,
  normalizeSessionModelSelection,
  updateSessionInWorkspaces,
  updateSessionModelSelectionInWorkspaces,
} from "../workspace"
import {
  removePendingConversationInput,
  updatePendingConversationInput,
} from "../pending-conversation-inputs"
import {
  normalizeQuestionAnswerText,
  sendPromptToSession as sendPromptToSessionService,
} from "./composer-send-service"
import { respondPermissionRequest } from "./permission-requests-service"
import { getWorkbenchTabReferenceFromKey } from "./workspace-derived-state"
import type { WorkspaceStateUpdater } from "./workspace-store"

type StateSetter<T> = (update: WorkspaceStateUpdater<T>) => void

interface CreateSessionResult {
  backendSessionID: string
  session: SessionSummary
  workspace: WorkspaceGroup
}

interface UseComposerControllerOptions {
  activeCreateSessionTabID: string | null
  activeSessionID: string | null
  activeTabKey: string | null
  agentConnected: boolean
  agentDefaultDirectory: string
  agentSessions: Record<string, string>
  cancellingSessionIDs: Record<string, boolean>
  appendConversationMessages: (sessionID: string, nextMessages: ThreadMessage[]) => void
  replaceConversationMessages: (sessionID: string, nextMessages: ThreadMessage[]) => void
  composerAttachmentsByTabKey: Record<string, ComposerAttachment[]>
  composerDraftStateByTabKey: Record<string, ComposerDraftState>
  composerParentMessageIDByTabKey: Record<string, string>
  createSessionForWorkspace: (
    workspace: WorkspaceGroup,
    options?: {
      createSessionTabID?: string | null
      closeCreateTab?: boolean
      paneID?: string | null
      skipInitialHistoryLoad?: boolean
      title?: string
    },
  ) => Promise<CreateSessionResult | null>
  createSessionTabs: CreateSessionTab[]
  isSendingByTabKey: Record<string, boolean>
  getConversationMessages: (sessionID: string) => ThreadMessage[]
  loadPendingPermissionRequestsForSession: (sessionID: string, backendSessionID?: string) => Promise<void>
  loadSessionDiffForSession: (sessionID: string, backendSessionID?: string) => Promise<void>
  loadSessionRuntimeDebugForSession: (sessionID: string, backendSessionID?: string) => Promise<void>
  pendingConversationInputsBySession: Record<string, PendingConversationInput[]>
  pendingPermissionRequestsBySession: Record<string, PermissionRequest[]>
  pendingStreamsRef: MutableRefObject<Record<string, PendingAgentStream>>
  permissionRequestActionRequestID: string | null
  permissionRequestsRequestRef: MutableRefObject<Record<string, number>>
  platform: string
  refreshWorkspaceForSession: (sessionID: string) => void
  refreshWorkspaceFromDirectory: (directory: string) => void | Promise<WorkspaceGroup | null>
  reloadSessionHistoryForSession: (sessionID: string, backendSessionID?: string) => Promise<void>
  sessionDirectoryBySession: Record<string, string>
  setAgentSessions: StateSetter<Record<string, string>>
  setCancellingSessionIDs: StateSetter<Record<string, boolean>>
  setComposerAttachmentsByTabKey: StateSetter<Record<string, ComposerAttachment[]>>
  setComposerDraftStateByTabKey: StateSetter<Record<string, ComposerDraftState>>
  setComposerParentMessageIDByTabKey: StateSetter<Record<string, string>>
  setCreateSessionTabs: StateSetter<CreateSessionTab[]>
  setIsSendingByTabKey: StateSetter<Record<string, boolean>>
  setPendingConversationInputsBySession: StateSetter<Record<string, PendingConversationInput[]>>
  setPendingPermissionRequestsBySession: StateSetter<Record<string, PermissionRequest[]>>
  setPermissionRequestActionError: StateSetter<string | null>
  setPermissionRequestActionRequestID: StateSetter<string | null>
  setSessionDirectoryBySession: StateSetter<Record<string, string>>
  setWorkspaces: StateSetter<WorkspaceGroup[]>
  updateAssistantConversationMessage: (
    sessionID: string,
    assistantMessageID: string,
    updater: (message: AssistantThreadMessage) => AssistantThreadMessage,
  ) => void
  workspaces: WorkspaceGroup[]
}

export function useComposerController({
  activeCreateSessionTabID,
  activeSessionID,
  activeTabKey,
  agentConnected,
  agentDefaultDirectory,
  agentSessions,
  cancellingSessionIDs,
  appendConversationMessages,
  replaceConversationMessages,
  composerAttachmentsByTabKey,
  composerDraftStateByTabKey,
  composerParentMessageIDByTabKey,
  createSessionForWorkspace,
  createSessionTabs,
  getConversationMessages,
  isSendingByTabKey,
  loadPendingPermissionRequestsForSession,
  loadSessionDiffForSession,
  loadSessionRuntimeDebugForSession,
  pendingConversationInputsBySession,
  pendingPermissionRequestsBySession,
  pendingStreamsRef,
  permissionRequestActionRequestID,
  permissionRequestsRequestRef,
  platform,
  refreshWorkspaceForSession,
  refreshWorkspaceFromDirectory,
  reloadSessionHistoryForSession,
  sessionDirectoryBySession,
  setAgentSessions,
  setCancellingSessionIDs,
  setComposerAttachmentsByTabKey,
  setComposerDraftStateByTabKey,
  setComposerParentMessageIDByTabKey,
  setCreateSessionTabs,
  setIsSendingByTabKey,
  setPendingConversationInputsBySession,
  setPendingPermissionRequestsBySession,
  setPermissionRequestActionError,
  setPermissionRequestActionRequestID,
  setSessionDirectoryBySession,
  setWorkspaces,
  updateAssistantConversationMessage,
  workspaces,
}: UseComposerControllerOptions) {
  function setDraftForTab(tabKey: string, value: ComposerDraftState) {
    setComposerDraftStateByTabKey((current) => {
      const nextDraftState = normalizeComposerDraftState(value)
      const currentDraftState = current[tabKey]
      if (
        currentDraftState?.lexicalJSON === nextDraftState.lexicalJSON &&
        currentDraftState.plainText === nextDraftState.plainText
      ) {
        return current
      }

      return {
        ...current,
        [tabKey]: nextDraftState,
      }
    })
  }

  function setDraft(value: ComposerDraftState) {
    if (!activeTabKey) return
    setDraftForTab(activeTabKey, value)
  }

  function hasPendingStreamForSession(sessionID: string | null | undefined) {
    if (!sessionID) return false
    return Object.values(pendingStreamsRef.current).some(
      (stream) => stream.sessionID === sessionID && !stream.cancelRequested,
    )
  }

  async function sendPromptToSession(input: {
    attachments: ComposerAttachment[]
    backendSessionID?: string | null
    commentReferences?: ComposerCommentReference[]
    displayText?: string
    preserveComposerState?: boolean
    parentMessageID?: string | null
    questionAnswer?: {
      questionID: string
      selectedOptions?: string[]
      freeformText?: string
    }
    reasoningEffort?: ReasoningEffort | null
    references?: UserThreadMessage["references"]
    selectedModel?: string | null
    session: SessionSummary
    selectedSkillIDs: string[]
    submissionMode?: UserThreadMessage["submissionMode"]
    tabKey: string
    text: string
    workspace: WorkspaceGroup
  }) {
    await sendPromptToSessionService(input, {
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
    })
  }

  async function rememberProjectModelSelection(
    workspace: WorkspaceGroup,
    selection: SessionSummary["modelSelection"] | undefined,
  ) {
    const updateProjectModelSelection = window.desktop?.updateProjectModelSelection
    if (!updateProjectModelSelection) return

    const model = selection?.model?.trim()
    const smallModel = selection?.small_model?.trim()
    const reasoningEffort = selection?.reasoning_effort
    if (!model && !smallModel && !reasoningEffort) return

    try {
      await updateProjectModelSelection({
        projectID: workspace.project.id,
        ...(model ? { model } : {}),
        ...(smallModel ? { small_model: smallModel } : {}),
        ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
      })
    } catch (error) {
      console.error("[desktop] rememberProjectModelSelection failed:", error)
    }
  }

  async function handleSend(input?: {
    attachmentError?: string | null
    attachmentsOverride?: ComposerAttachment[]
    createSessionTabID?: string | null
    draftStateOverride?: ComposerDraftState
    paneID?: string | null
    preserveComposerState?: boolean
    questionAnswer?: {
      questionID: string
      selectedOptions?: string[]
      freeformText?: string
    }
    selectedReasoningEffort?: ReasoningEffort | null
    selectedModel?: string | null
    selectedSkillIDs?: string[]
    sessionID?: string | null
    steerQueuedMessageID?: string
    submissionMode?: UserThreadMessage["submissionMode"]
    tabKey?: string | null
    waitForPendingModelSelection?: (() => Promise<void>) | null
  }) {
    const targetTabKey = input?.tabKey ?? activeTabKey
    const targetSessionID = input?.sessionID ?? activeSessionID
    const targetCreateSessionTabID = input?.createSessionTabID ?? activeCreateSessionTabID
    const attachments = input?.attachmentsOverride ?? (targetTabKey ? composerAttachmentsByTabKey[targetTabKey] ?? [] : [])
    const draftState = normalizeComposerDraftState(
      input?.draftStateOverride ??
        (targetTabKey ? composerDraftStateByTabKey[targetTabKey] ?? createEmptyComposerDraftState() : createEmptyComposerDraftState()),
    )
    const compiledSubmission = compileComposerSubmission({
      draftState,
      selectedSkillIDs: input?.selectedSkillIDs ?? [],
    })
    const normalizedQuestionAnswerText = normalizeQuestionAnswerText(input?.questionAnswer)
    const effectiveText = compiledSubmission.transportText || normalizedQuestionAnswerText
    const pendingPermissionRequests = targetSessionID ? pendingPermissionRequestsBySession[targetSessionID] ?? [] : []
    const isSending = Boolean(targetTabKey && isSendingByTabKey[targetTabKey])
    const isConcurrentSessionInput = isSending || hasPendingStreamForSession(targetSessionID)

    if (input?.steerQueuedMessageID) {
      await handleSteerQueuedSubmission({
        selectedReasoningEffort: input.selectedReasoningEffort,
        selectedModel: input.selectedModel,
        selectedSkillIDs: input.selectedSkillIDs ?? [],
        sessionID: targetSessionID,
        tabKey: targetTabKey,
        turnID: input.steerQueuedMessageID,
        waitForPendingModelSelection: input.waitForPendingModelSelection,
      })
      return
    }

    const submissionMode = input?.submissionMode ?? (isConcurrentSessionInput ? "queued" : undefined)
    const parentMessageID =
      targetTabKey && targetSessionID && !submissionMode
        ? composerParentMessageIDByTabKey[targetTabKey] ?? undefined
        : undefined
    if (
      !targetTabKey ||
      (!effectiveText && attachments.length === 0) ||
      pendingPermissionRequests.length > 0
    ) return
    if (input?.waitForPendingModelSelection) {
      await input.waitForPendingModelSelection().catch(() => undefined)
    }
    if (input?.attachmentError) return

    if (targetSessionID) {
      const nextSelection = findSession(workspaces, targetSessionID)
      if (!nextSelection.workspace || !nextSelection.session) return
      await sendPromptToSession({
        attachments,
        commentReferences: compiledSubmission.commentReferences,
        displayText: compiledSubmission.displayText,
        preserveComposerState: input?.preserveComposerState,
        parentMessageID,
        questionAnswer: input?.questionAnswer,
        reasoningEffort: input?.selectedReasoningEffort,
        references: compiledSubmission.userReferences,
        selectedModel: input?.selectedModel,
        selectedSkillIDs: compiledSubmission.selectedSkillIDs,
        session: nextSelection.session,
        submissionMode,
        tabKey: targetTabKey,
        text: effectiveText,
        workspace: nextSelection.workspace,
      })
      if (parentMessageID && targetTabKey) {
        setComposerParentMessageIDByTabKey((current) => {
          if (!(targetTabKey in current)) return current
          const next = { ...current }
          delete next[targetTabKey]
          return next
        })
      }
      return
    }

    if (!targetCreateSessionTabID) return

    const currentCreateSessionTab = createSessionTabs.find((tab) => tab.id === targetCreateSessionTabID)
    if (!currentCreateSessionTab) return

    const workspace = findWorkspaceByID(workspaces, currentCreateSessionTab.workspaceID)
    if (!workspace) return
    const shouldStartInPlanning = currentCreateSessionTab.initialWorkflowMode === "planning"

    const created = await createSessionForWorkspace(workspace, {
      closeCreateTab: true,
      createSessionTabID: targetCreateSessionTabID,
      paneID: input?.paneID,
      skipInitialHistoryLoad: true,
    })
    if (!created) return

    let createdSession = created.session
    if (input?.selectedModel || input?.selectedReasoningEffort) {
      const selection = await window.desktop?.updateSessionModelSelection?.({
        sessionID: created.session.id,
        ...(input.selectedModel ? { model: input.selectedModel } : {}),
        ...(input.selectedReasoningEffort ? { reasoning_effort: input.selectedReasoningEffort } : {}),
      }).catch((error) => {
        console.error("[desktop] updateSessionModelSelection for new session failed:", error)
        return null
      })

      if (selection) {
        const modelSelection = normalizeSessionModelSelection(selection)
        createdSession = {
          ...created.session,
          modelSelection,
        }
        setWorkspaces((current) =>
          updateSessionModelSelectionInWorkspaces(current, created.session.id, modelSelection),
        )
        await rememberProjectModelSelection(created.workspace, modelSelection)
      }
    }

    if (shouldStartInPlanning) {
      if (!window.desktop?.updateSessionWorkflow) {
        appendConversationMessages(created.session.id, [buildFailureThreadMessage("Plan Mode is unavailable for this session.")])
        return
      }

      try {
        const result = await window.desktop.updateSessionWorkflow({
          sessionID: created.session.id,
          action: "enter-plan",
        })
        createdSession = {
          ...createdSession,
          ...result.session,
        }
        setWorkspaces((currentWorkspaces) =>
          updateSessionInWorkspaces(currentWorkspaces, created.session.id, (session) => ({
            ...session,
            ...result.session,
          })),
        )
      } catch (error) {
        console.error("[desktop] enter plan mode for new session failed:", error)
        appendConversationMessages(created.session.id, [buildFailureThreadMessage(error instanceof Error ? error.message : String(error))])
        return
      }
    }

    await sendPromptToSession({
      attachments,
      backendSessionID: created.backendSessionID,
      commentReferences: compiledSubmission.commentReferences,
      displayText: compiledSubmission.displayText,
      preserveComposerState: input?.preserveComposerState,
      questionAnswer: input?.questionAnswer,
      reasoningEffort: input?.selectedReasoningEffort,
      references: compiledSubmission.userReferences,
      selectedModel: input?.selectedModel,
      selectedSkillIDs: compiledSubmission.selectedSkillIDs,
      session: createdSession,
      submissionMode,
      tabKey: targetTabKey,
      text: effectiveText,
      workspace: created.workspace,
    })
  }

  async function handleSteerQueuedSubmission(input: {
    selectedReasoningEffort?: ReasoningEffort | null
    selectedModel?: string | null
    selectedSkillIDs: string[]
    sessionID?: string | null
    tabKey?: string | null
    turnID: string
    waitForPendingModelSelection?: (() => Promise<void>) | null
  }) {
    const sessionID = input.sessionID
    const tabKey = input.tabKey
    if (!sessionID || !tabKey) return

    const queuedInput = (pendingConversationInputsBySession[sessionID] ?? []).find(
      (pendingInput) =>
        pendingInput.id === input.turnID &&
        pendingInput.mode === "queued",
    )
    if (!queuedInput) return

    const pendingEntry = Object.entries(pendingStreamsRef.current).find(([, stream]) =>
      stream.sessionID === sessionID &&
      (stream.pendingInputID === queuedInput.id || stream.userThreadMessageID === queuedInput.id) &&
      stream.requestedMode === "queue" &&
      !stream.cancelRequested
    )
    if (!pendingEntry) return

    const [streamID, stream] = pendingEntry
    const backendSessionID = stream.backendSessionID ?? agentSessions[sessionID]
    const agentSession = getAgentSessionBridge()
    if (!agentSession?.abortTurn || !backendSessionID) return

    stream.cancelRequested = true
    setPendingConversationInputsBySession((current) =>
      updatePendingConversationInput(current, sessionID, queuedInput.id, (pendingInput) => ({
        ...pendingInput,
        status: "cancelled",
      })),
    )
    const abortResult = await agentSession.abortTurn({
      backendSessionID,
      clientTurnID: streamID,
    }).catch((error) => {
      console.error("[desktop] queued turn abort before steer failed:", error)
      return null
    })

    if (!abortResult?.localRequestAborted) {
      stream.cancelRequested = false
      setPendingConversationInputsBySession((current) =>
        updatePendingConversationInput(current, sessionID, queuedInput.id, (pendingInput) => ({
          ...pendingInput,
          status: "pending",
        })),
      )
      return
    }

    delete pendingStreamsRef.current[streamID]
    const assistantThreadMessageID = stream.createdAssistantThreadMessageID ?? stream.assistantThreadMessageID
    setPendingConversationInputsBySession((current) =>
      removePendingConversationInput(current, sessionID, queuedInput.id),
    )
    replaceConversationMessages(
      sessionID,
      getConversationMessages(sessionID).filter((turn) => turn.id !== assistantThreadMessageID),
    )

    await handleSend({
      attachmentsOverride: queuedInput.attachments
        ?.flatMap((attachment) => attachment.path ? [{ name: attachment.name, path: attachment.path }] : []) ?? [],
      draftStateOverride: createComposerDraftStateFromPlainText(queuedInput.displayText ?? queuedInput.text),
      preserveComposerState: true,
      selectedReasoningEffort: input.selectedReasoningEffort,
      selectedModel: input.selectedModel,
      selectedSkillIDs: input.selectedSkillIDs,
      sessionID,
      submissionMode: "steer",
      tabKey,
      waitForPendingModelSelection: input.waitForPendingModelSelection,
    })
  }

  async function handlePlanModeToggle(input?: {
    createSessionTabID?: string | null
    sessionID?: string | null
  }) {
    const targetCreateSessionTabID = input?.createSessionTabID ?? null
    if (targetCreateSessionTabID) {
      setCreateSessionTabs((current) =>
        current.map((tab) =>
          tab.id === targetCreateSessionTabID
            ? {
                ...tab,
                initialWorkflowMode: tab.initialWorkflowMode === "planning" ? "execution" : "planning",
              }
            : tab,
        ),
      )
      return
    }

    const targetSessionID = input?.sessionID ?? activeSessionID
    if (!targetSessionID || !window.desktop?.updateSessionWorkflow) return

    const current = findSession(workspaces, targetSessionID).session
    if (!current) return

    const action = current.workflow?.mode === "planning" ? "leave-plan" : "enter-plan"
    try {
      const result = await window.desktop.updateSessionWorkflow({
        sessionID: targetSessionID,
        action,
      })
      setWorkspaces((currentWorkspaces) =>
        updateSessionInWorkspaces(currentWorkspaces, targetSessionID, (session) => ({
          ...session,
          ...result.session,
        })),
      )
      void refreshWorkspaceForSession(targetSessionID)
    } catch (error) {
      console.error("[desktop] updateSessionWorkflow failed:", error)
    }
  }

  async function handleApproveProposedPlan(input: {
    planMarkdown: string
    selectedReasoningEffort?: ReasoningEffort | null
    selectedModel?: string | null
    selectedSkillIDs?: string[]
    sessionID?: string | null
    tabKey?: string | null
    waitForPendingModelSelection?: (() => Promise<void>) | null
  }) {
    const targetSessionID = input.sessionID ?? activeSessionID
    const targetTabKey = input.tabKey ?? activeTabKey
    const planMarkdown = input.planMarkdown.trim()
    if (!targetSessionID || !targetTabKey || !planMarkdown || !window.desktop?.updateSessionWorkflow) return

    try {
      const result = await window.desktop.updateSessionWorkflow({
        sessionID: targetSessionID,
        action: "approve-plan",
        proposedPlanMarkdown: planMarkdown,
      })
      setWorkspaces((currentWorkspaces) =>
        updateSessionInWorkspaces(currentWorkspaces, targetSessionID, (session) => ({
          ...session,
          ...result.session,
        })),
      )
    } catch (error) {
      console.error("[desktop] approve proposed plan failed:", error)
      appendConversationMessages(targetSessionID, [buildFailureThreadMessage(error instanceof Error ? error.message : String(error))])
      return
    }

    await handleSend({
      draftStateOverride: createComposerDraftStateFromPlainText("实施计划"),
      preserveComposerState: true,
      selectedReasoningEffort: input.selectedReasoningEffort,
      selectedModel: input.selectedModel,
      selectedSkillIDs: input.selectedSkillIDs,
      sessionID: targetSessionID,
      tabKey: targetTabKey,
      waitForPendingModelSelection: input.waitForPendingModelSelection,
    })
  }

  async function handleCancelSend(input?: {
    sessionID?: string | null
    tabKey?: string | null
  }) {
    const agentSession = getAgentSessionBridge()
    if (!agentSession?.interrupt && !agentSession?.cancelTurn) return

    const tabKey = input?.tabKey ?? activeTabKey
    const tabReference = tabKey ? getWorkbenchTabReferenceFromKey(tabKey) : null
    const sessionID = input?.sessionID ?? (tabReference?.kind === "session" ? tabReference.sessionID : activeSessionID)
    if (!sessionID) return
    if (cancellingSessionIDs[sessionID]) return

    const pending = Object.entries(pendingStreamsRef.current).find(([, stream]) => stream.sessionID === sessionID)
    const clientTurnID = pending?.[0]
    const stream = pending?.[1]
    const backendSessionID = stream?.backendSessionID ?? agentSessions[sessionID] ?? sessionID
    if (!backendSessionID) return
    if (stream?.cancelRequested) return

    if (stream) {
      stream.cancelRequested = true
    }
    setCancellingSessionIDs((current) => ({
      ...current,
      [sessionID]: true,
    }))

    try {
      const result = agentSession.interrupt
        ? await agentSession.interrupt({
            backendSessionID,
            ...(clientTurnID ? { clientTurnID } : {}),
            reason: "user-interrupt",
          })
        : clientTurnID
          ? await agentSession.cancelTurn({
              clientTurnID,
              backendSessionID,
            }).then((cancelResult) => ({
              backendSessionID,
              clientTurnID,
              localRequestsAborted: cancelResult.localRequestAborted ? 1 : 0,
              backendCancelled: cancelResult.backendCancelled,
              backendCancelError: cancelResult.backendCancelError,
            }))
          : null

      if (!result || result.backendCancelError || !result.backendCancelled) {
        if (stream) {
          stream.cancelRequested = false
        }
        setCancellingSessionIDs((current) => {
          if (!current[sessionID]) return current
          const next = { ...current }
          delete next[sessionID]
          return next
        })
      }
    } catch (error) {
      if (stream) {
        stream.cancelRequested = false
      }
      setCancellingSessionIDs((current) => {
        if (!current[sessionID]) return current
        const next = { ...current }
        delete next[sessionID]
        return next
      })
      console.error("[desktop] agentSession interrupt failed:", error)
    }
  }

  async function handleAskUserQuestionAnswer(input: {
    freeformText?: string
    questionID?: string
    selectedOptions?: string[]
    sessionID?: string | null
    tabKey?: string | null
    text: string
  }) {
    const sessionID = input.sessionID ?? activeSessionID
    const tabKey = input.tabKey ?? activeTabKey
    const questionID = input.questionID?.trim()
    if (!sessionID || !tabKey || !questionID) return

    const agentSession = getAgentSessionBridge()
    const backendSessionID = agentSessions[sessionID]
    if (!agentSession?.answerQuestion || !backendSessionID) {
      console.error("[desktop] Cannot answer question because the backend session is unavailable.")
      return
    }

    const selectedOptions = (input.selectedOptions ?? []).map((value) => value.trim()).filter(Boolean)
    const freeformText = input.freeformText?.trim()
    const answerText = input.text.trim() || freeformText || selectedOptions.join(", ")
    if (!answerText) return

    try {
      await agentSession.answerQuestion({
        backendSessionID,
        questionID,
        ...(selectedOptions.length > 0 ? { selectedOptions } : {}),
        ...(freeformText ? { freeformText } : {}),
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      appendConversationMessages(sessionID, [buildFailureThreadMessage(message)])
    }
  }

  async function handlePermissionRequestResponse(input: {
    sessionID: string
    request: PermissionRequest
    decision: PermissionDecision
    note?: string
  }) {
    await respondPermissionRequest({
      appendConversationMessages,
      input,
      loadPendingPermissionRequestsForSession,
      loadSessionDiffForSession,
      loadSessionRuntimeDebugForSession,
      pendingStreamsRef,
      permissionRequestActionRequestID,
      permissionRequestsRequestRef,
      refreshWorkspaceForSession,
      reloadSessionHistoryForSession,
      setPendingPermissionRequestsBySession,
      setPermissionRequestActionError,
      setPermissionRequestActionRequestID,
      updateAssistantConversationMessage,
    })
  }

  async function handlePickComposerAttachments(input?: {
    allowImage: boolean
    allowPdf: boolean
    disabledReason?: string | null
    tabKey?: string | null
  }) {
    const pickComposerAttachments = window.desktop?.pickComposerAttachments
    if (!pickComposerAttachments) return

    const tabKey = input?.tabKey ?? activeTabKey
    const allowImage = input?.allowImage ?? false
    const allowPdf = input?.allowPdf ?? false
    const disabledReason = input?.disabledReason ?? null
    if (disabledReason) return
    if (!tabKey) return

    try {
      const pickedPaths = await pickComposerAttachments({
        allowImage,
        allowPdf,
      })
      if (!pickedPaths || pickedPaths.length === 0) return

      appendComposerAttachmentPaths(tabKey, pickedPaths, { image: allowImage, pdf: allowPdf })
    } catch (error) {
      console.error("[desktop] pickComposerAttachments failed:", error)
    }
  }

  async function handlePasteComposerImageAttachments(input: {
    allowImage: boolean
    disabledReason?: string | null
    images: ComposerPastedImageAttachment[]
    tabKey?: string | null
  }) {
    const saveComposerPastedImages = window.desktop?.saveComposerPastedImages
    const tabKey = input.tabKey ?? activeTabKey
    if (!input.allowImage) return
    if (input.disabledReason) return
    if (!tabKey || input.images.length === 0 || !saveComposerPastedImages) return

    try {
      const savedPaths = await saveComposerPastedImages({
        images: input.images,
      })
      if (savedPaths.length === 0) return

      appendComposerAttachmentPaths(tabKey, savedPaths, { image: true, pdf: false })
    } catch (error) {
      console.error("[desktop] saveComposerPastedImages failed:", error)
    }
  }

  function appendComposerAttachmentPaths(
    tabKey: string,
    paths: string[],
    supportedCapabilities: { image: boolean; pdf: boolean },
  ) {
    setComposerAttachmentsByTabKey((current) => {
      const existingAttachments = current[tabKey] ?? []
      const seen = new Set(existingAttachments.map((attachment) => attachment.path))
      const nextAttachments = [...existingAttachments]

      for (const path of paths) {
        if (!isComposerAttachmentSupported(path, supportedCapabilities)) continue
        if (seen.has(path)) continue
        seen.add(path)
        nextAttachments.push(buildComposerAttachment(path))
      }

      return {
        ...current,
        [tabKey]: nextAttachments,
      }
    })
  }

  function handleRemoveComposerAttachment(path: string, tabKey = activeTabKey) {
    if (!tabKey) return
    setComposerAttachmentsByTabKey((current) => ({
      ...current,
      [tabKey]: (current[tabKey] ?? []).filter((attachment) => attachment.path !== path),
    }))
  }

  return {
    handlePermissionRequestResponse,
    handlePickComposerAttachments,
    handlePasteComposerImageAttachments,
    handleRemoveComposerAttachment,
    handleAskUserQuestionAnswer,
    handleApproveProposedPlan,
    handleCancelSend,
    handlePlanModeToggle,
    handleSend,
    sendPromptToSession,
    setDraft,
    setDraftForTab,
  }
}
