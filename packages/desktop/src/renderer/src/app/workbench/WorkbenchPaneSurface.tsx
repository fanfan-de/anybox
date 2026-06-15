import { memo, useLayoutEffect, useMemo, useRef } from "react"
import { CreateSessionCanvas } from "../canvas/CreateSessionCanvas"
import { SessionCanvasTopMenu } from "../canvas/SessionCanvasTopMenu"
import { Composer } from "../composer/Composer"
import { ComposerConcurrentInputDrawer } from "../composer/ComposerConcurrentInputDrawer"
import { createComposerDraftStateFromPlainText, normalizeComposerDraftState } from "../composer/draft-state"
import { useDeferredComposerDraftSync } from "../composer/use-deferred-composer-draft-sync"
import { ComposerUtilityBar } from "../ComposerUtilityBar"
import { getSessionWorkflowBadge, type SessionWorkflowBadge as SessionWorkflowBadgeInfo } from "../session-workflow"
import type { MarkdownArtifactLinkTarget, MarkdownLocalFileLinkTarget } from "../thread-markdown"
import type {
  AssistantTraceVisibility,
  ComposerDraftState,
  ComposerPastedImageAttachment,
  PermissionDecision,
  PermissionRequest,
  ReasoningEffort,
  SessionDiffFile,
  SessionDiffSummary,
  SessionModelSelection,
  ToolPermissionMode,
  UserTurn,
  WorkspaceGroup,
} from "../types"
import { useProjectComposer } from "../use-project-composer"
import { RendererProfiler, createRendererProfilerOnRender } from "../perf-profiler"
import { isSideChatSession } from "../workspace"
import { ThreadView, type ThreadScrollSnapshot } from "../thread/ThreadView"
import type { WorkbenchPaneState } from "../agent-workspace/workspace-derived-state"
import { useConversationTurns, type ConversationStoreApi } from "../agent-workspace/conversation-store"

const THREAD_TOP_RESET_THRESHOLD_PX = 2

function ComposerPlanModeNotice({ workflow }: { workflow: SessionWorkflowBadgeInfo }) {
  return (
    <div className="composer-plan-mode-notice" role="status" title={workflow.description}>
      <span className="composer-plan-mode-dot" aria-hidden="true" />
      <span className="composer-plan-mode-label">{workflow.label}</span>
      <span className="composer-plan-mode-detail">Read-only research</span>
    </div>
  )
}

function ComposerBranchParentNotice({
  messagePreview,
  onClear,
}: {
  messagePreview?: string
  onClear: () => void
}) {
  return (
    <div className="composer-branch-parent-notice" role="status">
      <span className="composer-branch-parent-label">Continuing from</span>
      <span className="composer-branch-parent-preview">{messagePreview || "selected message"}</span>
      <button className="composer-branch-parent-clear" type="button" onClick={onClear}>
        Clear
      </button>
    </div>
  )
}

export interface WorkbenchPaneSurfaceProps {
  assistantTraceVisibility: AssistantTraceVisibility
  composerRefreshVersion: number
  conversationStore: ConversationStoreApi
  isResolvingPermissionRequest: boolean
  isAgentDebugTraceEnabled: boolean
  isSavingToolPermissionMode: boolean
  isTopRow: boolean
  pane: WorkbenchPaneState
  permissionRequestActionError: string | null
  permissionRequestActionRequestID: string | null
  toolPermissionMode: ToolPermissionMode
  toolPermissionModeError: string | null
  workspaces: WorkspaceGroup[]
  readThreadScrollSnapshot: (key: string) => ThreadScrollSnapshot | null
  saveThreadScrollSnapshot: (key: string, snapshot: ThreadScrollSnapshot) => void
  sideChatPlacement?: "inline" | "right-sidebar"
  onCreateSessionSubmit: (createSessionTabID?: string | null, paneID?: string) => Promise<void>
  onCreateSessionWorkspaceChange: (workspaceID: string, createSessionTabID?: string | null) => void
  onOpenProjectFolder: () => void | Promise<void>
  onInspectFileInSidebar: (file: string | null, sessionID: string | null, paneID: string) => void
  onArtifactLinkOpen?: (input: {
    paneID: string
    sessionID: string | null
    target: MarkdownArtifactLinkTarget
    workspaceDirectory: string | null
    workspaceID: string | null
  }) => void
  onLocalFileLinkOpen: (input: {
    paneID: string
    sessionID: string | null
    target: MarkdownLocalFileLinkTarget
    workspaceDirectory: string | null
    workspaceID: string | null
  }) => void
  onCreateSideChatTab: (anchorMessageID: string, options?: { paneID?: string | null; parentSessionID?: string | null; placement?: "inline" | "right-sidebar" }) => Promise<void>
  onDeleteSideChatTab: (sessionID: string) => Promise<void>
  onOpenSideChat: (anchorMessageID: string, options?: { paneID?: string | null; parentSessionID?: string | null; placement?: "inline" | "right-sidebar" }) => Promise<void>
  onOpenSubagentSession?: (sessionID: string, title?: string) => void | Promise<void>
  onBranchSelect: (input: { messageID: string; sessionID?: string | null }) => Promise<void>
  onClearComposerParentMessage: (input?: { tabKey?: string | null }) => void
  onForkFromMessage: (messageID: string, options?: { tabKey?: string | null }) => void
  onAskUserQuestionAnswer: (input: {
    freeformText?: string
    questionID?: string
    selectedOptions?: string[]
    sessionID?: string | null
    tabKey?: string | null
    text: string
  }) => Promise<void>
  onApproveProposedPlan: (input: {
    planMarkdown: string
    selectedReasoningEffort?: ReasoningEffort | null
    selectedModel?: string | null
    selectedSkillIDs?: string[]
    sessionID?: string | null
    tabKey?: string | null
    waitForPendingModelSelection?: (() => Promise<void>) | null
  }) => Promise<void>
  onPermissionRequestResponse: (input: {
    sessionID: string
    request: PermissionRequest
    decision: PermissionDecision
    note?: string
  }) => Promise<void>
  onToolPermissionModeChange: (mode: ToolPermissionMode) => void | Promise<void>
  onPickComposerAttachments: (input: { allowImage: boolean; allowPdf: boolean; disabledReason: string | null; tabKey?: string | null }) => Promise<void>
  onPasteComposerImageAttachments: (input: { allowImage: boolean; disabledReason?: string | null; images: ComposerPastedImageAttachment[]; tabKey?: string | null }) => Promise<void>
  onRemoveComposerAttachment: (path: string, tabKey?: string | null) => void
  onSelectSideChatTab: (sessionID: string) => void
  onCancelSend: (input?: { sessionID?: string | null; tabKey?: string | null }) => Promise<void>
  onPlanModeToggle: (input: { createSessionTabID?: string | null; sessionID?: string | null }) => Promise<void>
  onSend: (input?: {
    attachmentError?: string | null
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
    steerQueuedTurnID?: string
    submissionMode?: UserTurn["submissionMode"]
    tabKey?: string | null
    waitForPendingModelSelection?: (() => Promise<void>) | null
  }) => Promise<void>
  onSessionModelSelectionChange: (sessionID: string, selection: SessionModelSelection | undefined) => void
  onSetDraft: (tabKey: string, value: ComposerDraftState) => void
  onTurnDiffRestore: (diffs: SessionDiffFile[], sessionID: string | null, paneID: string) => void | Promise<void>
  onTurnDiffReview: (files: string[], sessionID: string | null, paneID: string) => void | Promise<void>
  onTurnDiffSummaryHydrate: (turnID: string, diffSummary: SessionDiffSummary, sessionID?: string | null) => void | Promise<void>
}

function InactiveWorkbenchPaneSurface({
  isTopRow,
  pane,
}: Pick<WorkbenchPaneSurfaceProps, "isTopRow" | "pane">) {
  return (
    <section
      className={pane.isFocused ? "workbench-pane is-focused" : "workbench-pane"}
      data-is-top-row={isTopRow ? "true" : "false"}
      data-pane-id={pane.id}
    >
      <div className="workbench-pane-stage">
        <div className="workbench-pane-live-region is-dockview-managed" />
      </div>
    </section>
  )
}

export const WorkbenchPaneSurface = memo(function WorkbenchPaneSurface(props: WorkbenchPaneSurfaceProps) {
  const lastActivePropsRef = useRef<WorkbenchPaneSurfaceProps | null>(null)

  if (props.pane.isActivePanel || import.meta.env.MODE === "test") {
    lastActivePropsRef.current = props
    return <ActiveWorkbenchPaneSurface {...props} />
  }

  const cachedProps = lastActivePropsRef.current
  if (cachedProps) {
    return <ActiveWorkbenchPaneSurface {...cachedProps} />
  }

  if (!props.pane.isActivePanel) {
    return <InactiveWorkbenchPaneSurface isTopRow={props.isTopRow} pane={props.pane} />
  }

  return <ActiveWorkbenchPaneSurface {...props} />
})

const ActiveWorkbenchPaneSurface = memo(function ActiveWorkbenchPaneSurface({
  assistantTraceVisibility,
  composerRefreshVersion,
  conversationStore,
  isResolvingPermissionRequest,
  isAgentDebugTraceEnabled,
  isSavingToolPermissionMode,
  isTopRow,
  pane,
  permissionRequestActionError,
  permissionRequestActionRequestID,
  toolPermissionMode,
  toolPermissionModeError,
  workspaces,
  readThreadScrollSnapshot,
  saveThreadScrollSnapshot,
  sideChatPlacement = "inline",
  onCreateSessionSubmit,
  onCreateSessionWorkspaceChange,
  onOpenProjectFolder,
  onInspectFileInSidebar,
  onArtifactLinkOpen,
  onLocalFileLinkOpen,
  onCreateSideChatTab,
  onDeleteSideChatTab,
  onOpenSideChat,
  onOpenSubagentSession,
  onBranchSelect,
  onClearComposerParentMessage,
  onForkFromMessage,
  onAskUserQuestionAnswer,
  onApproveProposedPlan,
  onPermissionRequestResponse,
  onToolPermissionModeChange,
  onPickComposerAttachments,
  onPasteComposerImageAttachments,
  onRemoveComposerAttachment,
  onSelectSideChatTab,
  onCancelSend,
  onPlanModeToggle,
  onSend,
  onSessionModelSelectionChange,
  onSetDraft,
  onTurnDiffRestore,
  onTurnDiffReview,
  onTurnDiffSummaryHydrate,
}: WorkbenchPaneSurfaceProps) {
  const threadColumnRef = useRef<HTMLDivElement | null>(null)
  const activeTurns = useConversationTurns(conversationStore, pane.sessionID)
  const activeSideChatTurns = useConversationTurns(conversationStore, pane.activeSideChatSession?.id ?? null)
  const composerParentMessagePreview = pane.composerParentMessageID
    ? pane.messageTree?.nodesByID[pane.composerParentMessageID]?.preview
    : undefined

  useLayoutEffect(() => {
    const threadColumn = threadColumnRef.current
    const scrollStateKey = pane.tabKey
    if (!threadColumn || !scrollStateKey) return
    if (threadColumn.scrollTop > THREAD_TOP_RESET_THRESHOLD_PX) return

    const snapshot = readThreadScrollSnapshot(scrollStateKey)
    if (!snapshot || snapshot.pinnedToBottom || snapshot.scrollTop <= THREAD_TOP_RESET_THRESHOLD_PX) return

    const maxScrollTop = Math.max(0, threadColumn.scrollHeight - threadColumn.clientHeight)
    if (maxScrollTop <= THREAD_TOP_RESET_THRESHOLD_PX) return

    threadColumn.scrollTop = Math.min(snapshot.scrollTop, maxScrollTop)
  })

  const composer = useProjectComposer({
    attachmentPaths: pane.composerAttachments.map((attachment) => attachment.path),
    onSessionModelSelectionChange,
    projectID: pane.composerProjectID,
    refreshToken: composerRefreshVersion,
    sessionModelSelection: pane.activeSession?.modelSelection,
    sessionID: pane.sessionID,
  })
  const readOnlySideChat = isSideChatSession(pane.activeSession)
  const showGitControls = pane.isActivePanel && !readOnlySideChat
  const pendingSubmissionInputs = useMemo(
    () => [...pane.pendingConversationInputs].sort((left, right) => left.createdAt - right.createdAt),
    [pane.pendingConversationInputs],
  )
  const {
    flushDraftSync,
    scheduleDraftSync,
  } = useDeferredComposerDraftSync({
    draftKey: pane.tabKey,
    onSync: onSetDraft,
  })
  const composerWorkflowBadge = !readOnlySideChat ? getSessionWorkflowBadge(pane.activeSession?.workflow) : null
  const createSessionWorkflowBadge =
    pane.createSessionInitialWorkflowMode === "planning"
      ? getSessionWorkflowBadge({
          mode: "planning",
          plan: {
            status: "idle",
            updatedAt: 0,
          },
        })
      : null

  function handleCreateSessionPromptExampleSelect(text: string) {
    const tabKey = pane.tabKey
    if (!tabKey) return

    const flushedDraft = flushDraftSync()
    const baseDraftState = flushedDraft?.draftKey === tabKey ? flushedDraft.draftState : pane.draftState
    const normalizedDraftState = normalizeComposerDraftState(baseDraftState)
    const currentText = normalizedDraftState.plainText.trim()
    const nextText = currentText ? `${normalizedDraftState.plainText.trimEnd()}\n\n${text}` : text
    onSetDraft(tabKey, createComposerDraftStateFromPlainText(nextText))
  }

  const composerProfiler = useMemo(
    () => createRendererProfilerOnRender("Composer commit", () => ({
      paneID: pane.id,
      sessionID: pane.sessionID,
      tabKey: pane.tabKey,
      isCreateSession: Boolean(pane.createSessionTabID),
    })),
    [pane.createSessionTabID, pane.id, pane.sessionID, pane.tabKey],
  )
  const topMenuProfiler = useMemo(
    () => createRendererProfilerOnRender("SessionCanvasTopMenu commit", () => ({
      paneID: pane.id,
      sessionID: pane.sessionID,
      tabKey: pane.tabKey,
      pendingPermissionRequestCount: pane.pendingPermissionRequests.length,
    })),
    [pane.id, pane.pendingPermissionRequests.length, pane.sessionID, pane.tabKey],
  )
  const createSessionCanvasProfiler = useMemo(
    () => createRendererProfilerOnRender("CreateSessionCanvas commit", () => ({
      paneID: pane.id,
      createSessionTabID: pane.createSessionTabID,
      selectedWorkspaceID: pane.createSessionWorkspaceID,
    })),
    [pane.createSessionTabID, pane.createSessionWorkspaceID, pane.id],
  )
  const threadViewProfiler = useMemo(
    () => createRendererProfilerOnRender("ThreadView commit", () => ({
      paneID: pane.id,
      sessionID: pane.sessionID,
      tabKey: pane.tabKey,
      turnCount: activeTurns.length,
      sideChatTurnCount: activeSideChatTurns.length,
      isThreadVisible: pane.isActivePanel,
    })),
    [activeSideChatTurns.length, activeTurns.length, pane.id, pane.isActivePanel, pane.sessionID, pane.tabKey],
  )

  return (
    <section
      className={pane.isFocused ? "workbench-pane is-focused" : "workbench-pane"}
      data-is-top-row={isTopRow ? "true" : "false"}
      data-pane-id={pane.id}
    >
      <div className="workbench-pane-stage">
        <div className="workbench-pane-live-region is-dockview-managed">
          <RendererProfiler id="WorkbenchPaneSurface.SessionCanvasTopMenu" onRender={topMenuProfiler}>
            <SessionCanvasTopMenu
              activeSession={pane.activeSession}
              sessionTasks={pane.activeSessionTasks ?? pane.activeSessionRuntimeDebug?.tasks ?? null}
              gitProjectID={pane.projectID}
              gitDirectory={pane.workspace?.directory ?? null}
              showGitControls={showGitControls}
              isSavingToolPermissionMode={isSavingToolPermissionMode}
              mcpOptions={composer.mcpOptions}
              pluginOptions={composer.pluginOptions}
              pendingPermissionRequests={pane.pendingPermissionRequests}
              selectedMcpServerIDs={composer.selectedMcpServerIDs}
              selectedMcpServerLabel={composer.selectedMcpLabel}
              onMcpServerToggle={composer.handleMcpToggle}
              selectedPluginIDs={composer.selectedPluginIDs}
              selectedPluginLabel={composer.selectedPluginLabel}
              onPluginToggle={composer.handlePluginToggle}
              toolPermissionMode={toolPermissionMode}
              toolPermissionModeError={toolPermissionModeError}
              onToolPermissionModeChange={onToolPermissionModeChange}
              onOpenReview={() => onTurnDiffReview([], pane.sessionID, pane.id)}
              onOpenSubagentSession={onOpenSubagentSession}
              skillOptions={composer.skillOptions}
              selectedSkillIDs={composer.selectedSkillIDs}
              selectedSkillLabel={composer.selectedSkillLabel}
              onSkillToggle={composer.handleSkillToggle}
            />
          </RendererProfiler>
          {pane.createSessionTabID ? (
            <>
              <RendererProfiler id="WorkbenchPaneSurface.CreateSessionCanvas" onRender={createSessionCanvasProfiler}>
                <CreateSessionCanvas
                  isCreatingSession={pane.isCreatingSession}
                  selectedWorkspaceID={pane.createSessionWorkspaceID}
                  workspaces={workspaces}
                  onOpenProjectFolder={onOpenProjectFolder}
                  onPromptExampleSelect={handleCreateSessionPromptExampleSelect}
                  onWorkspaceChange={(workspaceID) => onCreateSessionWorkspaceChange(workspaceID, pane.createSessionTabID)}
                />
              </RendererProfiler>
              <div className="composer-stack">
                <RendererProfiler id="WorkbenchPaneSurface.CreateSessionComposer" onRender={composerProfiler}>
                  <Composer
                    attachments={pane.composerAttachments}
                    attachmentButtonTitle={composer.attachmentButtonTitle}
                    attachmentDisabledReason={composer.attachmentDisabledReason}
                    attachmentError={composer.attachmentError}
                    canSend={Boolean(pane.createSessionWorkspaceID)}
                    canPasteImageAttachments={composer.attachmentCapabilities.image && composer.attachmentDisabledReason === null}
                    draftState={pane.draftState}
                    hasPendingPermissionRequests={false}
                    isCancelling={pane.isCancelling}
                    isInterruptible={pane.isInterruptible || pane.isCreatingSession}
                    isSending={pane.isSending || pane.isCreatingSession}
                    mcpOptions={composer.mcpOptions}
                    modelOptions={composer.modelOptions}
                    onDraftStateChange={scheduleDraftSync}
                    onMcpToggle={composer.handleMcpToggle}
                    onPluginToggle={composer.handlePluginToggle}
                    pluginOptions={composer.pluginOptions}
                    reasoningEffortOptions={composer.reasoningEffortOptions}
                    selectedMcpServerIDs={composer.selectedMcpServerIDs}
                    selectedModel={composer.selectedModel}
                    selectedModelLabel={composer.selectedModelLabel}
                    selectedPluginIDs={composer.selectedPluginIDs}
                    selectedReasoningEffort={composer.selectedReasoningEffort}
                    selectedReasoningEffortLabel={composer.selectedReasoningEffortLabel}
                    selectedSkillIDs={composer.selectedSkillIDs}
                    showModelSelector
                    showProjectTagCommands
                    skillOptions={composer.skillOptions}
                    unsupportedAttachmentPaths={composer.unsupportedAttachmentPaths}
                    workspaceDirectory={pane.workspace?.directory ?? null}
                    onModelChange={composer.handleModelChange}
                    onReasoningEffortChange={composer.handleReasoningEffortChange}
                    onPickAttachments={() =>
                      onPickComposerAttachments({
                        allowImage: composer.attachmentCapabilities.image,
                        allowPdf: composer.attachmentCapabilities.pdf,
                        disabledReason: composer.attachmentDisabledReason,
                        tabKey: pane.tabKey,
                      })
                    }
                    onPasteImageAttachments={(images) =>
                      onPasteComposerImageAttachments({
                        allowImage: composer.attachmentCapabilities.image,
                        disabledReason: composer.attachmentDisabledReason,
                        images,
                        tabKey: pane.tabKey,
                      })
                    }
                    onPlanModeToggle={
                      pane.createSessionTabID
                        ? () => void onPlanModeToggle({ createSessionTabID: pane.createSessionTabID })
                        : readOnlySideChat
                        ? undefined
                        : () => void onPlanModeToggle({ sessionID: pane.sessionID })
                    }
                    onRemoveAttachment={(path) => onRemoveComposerAttachment(path, pane.tabKey)}
                    onCancelSend={() => void onCancelSend({ tabKey: pane.tabKey })}
                    onSend={(draftStateOverride) => {
                      flushDraftSync()
                      void onSend({
                        attachmentError: composer.attachmentError,
                        createSessionTabID: pane.createSessionTabID,
                        draftStateOverride,
                        paneID: pane.id,
                        selectedReasoningEffort: composer.selectedReasoningEffort,
                        selectedModel: composer.selectedModel,
                        selectedSkillIDs: composer.selectedSkillIDs,
                        tabKey: pane.tabKey,
                        waitForPendingModelSelection: composer.awaitPendingModelSelection,
                      })
                    }}
                  />
                </RendererProfiler>
                {createSessionWorkflowBadge ? <ComposerPlanModeNotice workflow={createSessionWorkflowBadge} /> : null}
                <ComposerUtilityBar
                  contextWindow={composer.contextWindow}
                  gitDirectory={pane.workspace?.directory ?? null}
                  gitProjectID={pane.projectID}
                  showGitControls={pane.isActivePanel}
                  usage={null}
                />
              </div>
            </>
          ) : (
            <>
              <RendererProfiler id="WorkbenchPaneSurface.ThreadView" onRender={threadViewProfiler}>
                <ThreadView
                  activeProjectID={pane.projectID}
                  activeSession={pane.activeSession}
                  activeSessionDiff={pane.activeSessionDiff}
                  assistantTraceVisibility={assistantTraceVisibility}
                  composerRefreshVersion={composerRefreshVersion}
                  isResolvingPermissionRequest={isResolvingPermissionRequest}
                  isAgentDebugTraceEnabled={isAgentDebugTraceEnabled}
                  isSessionRunning={pane.isSending || pane.isInterruptible}
                  pendingPermissionRequests={pane.pendingPermissionRequests}
                  pendingConversationInputs={pane.pendingConversationInputs}
                  permissionRequestActionError={permissionRequestActionError}
                  permissionRequestActionRequestID={permissionRequestActionRequestID}
                  activeTurns={activeTurns}
                  messageTree={pane.messageTree}
                  sideChatAttachments={pane.activeSideChatAttachments}
                  sideChatCountsByAnchorMessageID={pane.sideChatCountsByAnchorMessageID}
                  sideChatDraftState={pane.activeSideChatDraftState}
                  sideChatIsCancelling={pane.activeSideChatIsCancelling}
                  sideChatIsInterruptible={pane.activeSideChatIsInterruptible}
                  sideChatIsSending={pane.activeSideChatIsSending}
                  sideChatPendingInputs={pane.activeSideChatPendingInputs}
                  sideChatPendingPermissionRequests={pane.activeSideChatPendingPermissionRequests}
                  sideChatPermissionRequestActionError={permissionRequestActionError}
                  sideChatPermissionRequestActionRequestID={permissionRequestActionRequestID}
                  sideChatSession={pane.activeSideChatSession}
                  sideChatSessionsByAnchorMessageID={pane.sideChatSessionsByAnchorMessageID}
                  sideChatTurns={activeSideChatTurns}
                  sideChatPlacement={sideChatPlacement === "right-sidebar" ? "external" : "inline"}
                  scrollStateKey={pane.tabKey}
                  threadColumnRef={threadColumnRef}
                  isThreadVisible={pane.isActivePanel}
                  readScrollSnapshot={readThreadScrollSnapshot}
                  saveScrollSnapshot={saveThreadScrollSnapshot}
                  onSessionModelSelectionChange={onSessionModelSelectionChange}
                  onBranchSelect={(messageID) => onBranchSelect({ messageID, sessionID: pane.sessionID })}
                  onForkFromMessage={(messageID) => onForkFromMessage(messageID, { tabKey: pane.tabKey })}
                  onAskUserQuestionAnswer={(answer) =>
                    onAskUserQuestionAnswer({
                      freeformText: answer.freeformText,
                      questionID: answer.questionID,
                      selectedOptions: answer.selectedOptions,
                      sessionID: pane.sessionID,
                      tabKey: pane.tabKey,
                      text: answer.text,
                    })
                  }
                  onFileChangeSelect={(file) => onInspectFileInSidebar(file, pane.sessionID, pane.id)}
                  onTurnDiffRestore={(files) => onTurnDiffRestore(files, pane.sessionID, pane.id)}
                  onTurnDiffReview={(files) => onTurnDiffReview(files, pane.sessionID, pane.id)}
                  onTurnDiffSummaryHydrate={(turnID, diffSummary) => onTurnDiffSummaryHydrate(turnID, diffSummary, pane.sessionID)}
                  onArtifactLinkOpen={(target) =>
                    onArtifactLinkOpen?.({
                      paneID: pane.id,
                      sessionID: pane.sessionID,
                      target,
                      workspaceDirectory: pane.workspace?.directory ?? null,
                      workspaceID: pane.workspace?.id ?? null,
                    })
                  }
                  onLocalFileLinkOpen={(target) =>
                    onLocalFileLinkOpen({
                      paneID: pane.id,
                      sessionID: pane.sessionID,
                      target,
                      workspaceDirectory: pane.workspace?.directory ?? null,
                      workspaceID: pane.workspace?.id ?? null,
                    })
                  }
                  onOpenSideChat={(anchorMessageID) =>
                    void onOpenSideChat(anchorMessageID, {
                      paneID: pane.id,
                      parentSessionID: pane.sessionID,
                      placement: sideChatPlacement,
                    })
                  }
                  onSideChatCreate={(anchorMessageID) =>
                    void onCreateSideChatTab(anchorMessageID, {
                      paneID: pane.id,
                      parentSessionID: pane.sessionID,
                      placement: sideChatPlacement,
                    })
                  }
                  onSideChatDelete={(sessionID) => void onDeleteSideChatTab(sessionID)}
                  onSideChatSelect={(sessionID) => void onSelectSideChatTab(sessionID)}
                  onSideChatDraftStateChange={(value) => {
                    if (pane.activeSideChatTabKey) {
                      onSetDraft(pane.activeSideChatTabKey, value)
                    }
                  }}
                  onSideChatPickAttachments={({ allowImage, allowPdf, disabledReason }) =>
                    onPickComposerAttachments({
                      allowImage,
                      allowPdf,
                      disabledReason,
                      tabKey: pane.activeSideChatTabKey,
                    })
                  }
                  onSideChatPasteImageAttachments={({ allowImage, disabledReason, images }) =>
                    onPasteComposerImageAttachments({
                      allowImage,
                      disabledReason,
                      images,
                      tabKey: pane.activeSideChatTabKey,
                    })
                  }
                  onSideChatRemoveAttachment={(path) => onRemoveComposerAttachment(path, pane.activeSideChatTabKey)}
                  onSideChatCancelSend={() => void onCancelSend({
                    sessionID: pane.activeSideChatSession?.id,
                    tabKey: pane.activeSideChatTabKey,
                  })}
                  onSideChatSend={(input) =>
                    void onSend({
                      attachmentError: input.attachmentError,
                      draftStateOverride: input.draftStateOverride,
                      paneID: pane.id,
                      preserveComposerState: Boolean(input.questionAnswer),
                      questionAnswer: input.questionAnswer,
                      selectedReasoningEffort: input.selectedReasoningEffort,
                      selectedModel: input.selectedModel,
                      selectedSkillIDs: input.selectedSkillIDs,
                      sessionID: pane.activeSideChatSession?.id,
                      steerQueuedTurnID: input.steerQueuedTurnID,
                      submissionMode: input.submissionMode,
                      tabKey: pane.activeSideChatTabKey,
                      waitForPendingModelSelection: input.waitForPendingModelSelection,
                    })
                  }
                  onProposedPlanConfirm={(input) =>
                    onApproveProposedPlan({
                      planMarkdown: input.planMarkdown,
                      selectedReasoningEffort: composer.selectedReasoningEffort,
                      selectedModel: composer.selectedModel,
                      selectedSkillIDs: composer.selectedSkillIDs,
                      sessionID: pane.sessionID,
                      tabKey: pane.tabKey,
                      waitForPendingModelSelection: composer.awaitPendingModelSelection,
                    })
                  }
                  onPermissionRequestResponse={onPermissionRequestResponse}
                />
              </RendererProfiler>
              <div className="composer-stack">
                <ComposerConcurrentInputDrawer
                  canSteer={Boolean(pane.activeSession)}
                  hasPendingPermissionRequests={pane.pendingPermissionRequests.length > 0 || isResolvingPermissionRequest}
                  isCancelling={pane.isCancelling}
                  pendingInputs={pendingSubmissionInputs}
                  onSteerQueuedTurn={(input) => {
                    void onSend({
                      paneID: pane.id,
                      selectedReasoningEffort: composer.selectedReasoningEffort,
                      selectedModel: composer.selectedModel,
                      selectedSkillIDs: composer.selectedSkillIDs,
                      sessionID: pane.sessionID,
                      steerQueuedTurnID: input.id,
                      tabKey: pane.tabKey,
                      waitForPendingModelSelection: composer.awaitPendingModelSelection,
                    })
                  }}
                />
                <RendererProfiler id="WorkbenchPaneSurface.Composer" onRender={composerProfiler}>
                  <Composer
                    attachments={pane.composerAttachments}
                    attachmentButtonTitle={composer.attachmentButtonTitle}
                    attachmentDisabledReason={composer.attachmentDisabledReason}
                    attachmentError={composer.attachmentError}
                    canSend={Boolean(pane.activeSession)}
                    canPasteImageAttachments={composer.attachmentCapabilities.image && composer.attachmentDisabledReason === null}
                    draftState={pane.draftState}
                    hasPendingPermissionRequests={pane.pendingPermissionRequests.length > 0 || isResolvingPermissionRequest}
                    isCancelling={pane.isCancelling}
                    isInterruptible={pane.isInterruptible}
                    isSending={pane.isSending}
                    mcpOptions={composer.mcpOptions}
                    modelOptions={composer.modelOptions}
                    onDraftStateChange={scheduleDraftSync}
                    onMcpToggle={readOnlySideChat ? undefined : composer.handleMcpToggle}
                    onPluginToggle={readOnlySideChat ? undefined : composer.handlePluginToggle}
                    pluginOptions={composer.pluginOptions}
                    reasoningEffortOptions={composer.reasoningEffortOptions}
                    selectedMcpServerIDs={composer.selectedMcpServerIDs}
                    selectedModel={composer.selectedModel}
                    selectedModelLabel={composer.selectedModelLabel}
                    selectedPluginIDs={composer.selectedPluginIDs}
                    selectedReasoningEffort={composer.selectedReasoningEffort}
                    selectedReasoningEffortLabel={composer.selectedReasoningEffortLabel}
                    selectedSkillIDs={composer.selectedSkillIDs}
                    showModelSelector={!readOnlySideChat}
                    showProjectTagCommands={!readOnlySideChat}
                    skillOptions={composer.skillOptions}
                    unsupportedAttachmentPaths={composer.unsupportedAttachmentPaths}
                    workspaceDirectory={pane.workspace?.directory ?? null}
                    onModelChange={composer.handleModelChange}
                    onReasoningEffortChange={composer.handleReasoningEffortChange}
                    onPickAttachments={() =>
                      onPickComposerAttachments({
                        allowImage: composer.attachmentCapabilities.image,
                        allowPdf: composer.attachmentCapabilities.pdf,
                        disabledReason: composer.attachmentDisabledReason,
                        tabKey: pane.tabKey,
                      })
                    }
                    onPasteImageAttachments={(images) =>
                      onPasteComposerImageAttachments({
                        allowImage: composer.attachmentCapabilities.image,
                        disabledReason: composer.attachmentDisabledReason,
                        images,
                        tabKey: pane.tabKey,
                      })
                    }
                    onPlanModeToggle={
                      readOnlySideChat
                        ? undefined
                        : () => void onPlanModeToggle({ sessionID: pane.sessionID })
                    }
                    onRemoveAttachment={(path) => onRemoveComposerAttachment(path, pane.tabKey)}
                    onCancelSend={() => void onCancelSend({
                      sessionID: pane.sessionID,
                      tabKey: pane.tabKey,
                    })}
                    onSend={(draftStateOverride) => {
                      flushDraftSync()
                      void onSend({
                        attachmentError: composer.attachmentError,
                        draftStateOverride,
                        paneID: pane.id,
                        selectedReasoningEffort: composer.selectedReasoningEffort,
                        selectedModel: composer.selectedModel,
                        selectedSkillIDs: composer.selectedSkillIDs,
                        sessionID: pane.sessionID,
                        submissionMode: pane.isSending || pane.isInterruptible ? "queued" : undefined,
                        tabKey: pane.tabKey,
                        waitForPendingModelSelection: composer.awaitPendingModelSelection,
                      })
                    }}
                  />
                </RendererProfiler>
                {pane.composerParentMessageID ? (
                  <ComposerBranchParentNotice
                    messagePreview={composerParentMessagePreview}
                    onClear={() => onClearComposerParentMessage({ tabKey: pane.tabKey })}
                  />
                ) : null}
                {composerWorkflowBadge ? <ComposerPlanModeNotice workflow={composerWorkflowBadge} /> : null}
                <ComposerUtilityBar
                  contextWindow={composer.contextWindow}
                  gitDirectory={pane.workspace?.directory ?? null}
                  gitProjectID={pane.projectID}
                  showGitControls={showGitControls}
                  usage={pane.activeSessionContextUsage}
                />
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  )
})
