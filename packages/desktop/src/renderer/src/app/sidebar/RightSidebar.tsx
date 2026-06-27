import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { ChangesPanel } from "../changes/ChangesPanel"
import { WorkspaceFilesPanel } from "../files/WorkspaceFilesPanel"
import {
  ChangesIcon,
  CloseIcon,
  FileSearchIcon,
  PlusIcon,
  PreviewIcon,
  SessionTreeIcon,
  SideChatIcon,
  TerminalIcon,
} from "../icons"
import { useI18n } from "../i18n/I18nProvider"
import { UnifiedPreviewPanel } from "../preview/UnifiedPreviewPanel"
import { ShellTopMenu } from "../shared-ui"
import type { CodeHighlightTheme } from "../code-theme"
import type { SessionMessageTree } from "../session-message-tree"
import { InlineSideChatThread } from "../thread/ThreadView"
import type {
  AssistantTraceVisibility,
  ComposerAttachment,
  ComposerDraftState,
  ComposerPastedImageAttachment,
  PreviewInteractionCommitInput,
  PreviewInteractionPluginID,
  PendingConversationInput,
  PermissionDecision,
  PermissionRequest,
  ReasoningEffort,
  RightSidebarState,
  RightSidebarTab,
  SessionDiffState,
  SessionDiffScope,
  SessionDiffSummary,
  SessionSummary,
  ThreadMessage,
  UserThreadMessage,
  WorkspaceGroup,
} from "../types"
import type { MarkdownArtifactLinkTarget, MarkdownLocalFileLinkTarget } from "../thread-markdown"
import { SessionMessageTreePanel } from "./SessionMessageTreePanel"

interface RightSidebarSideChatPanelState {
  activeProjectID: string | null
  activeTabID: string
  anchorMessageID: string
  attachments: ComposerAttachment[]
  draftState: ComposerDraftState
  isCancelling: boolean
  isInterruptible: boolean
  isSending: boolean
  parentSessionID: string
  pendingInputs: PendingConversationInput[]
  pendingPermissionRequests: PermissionRequest[]
  session: SessionSummary
  sideChatSessions: SessionSummary[]
  tabKey: string
  messages: ThreadMessage[]
}

interface RightSidebarProps {
  activeSession: SessionSummary | null
  activeSessionDirectory: string | null
  activeWorkspaceFileScopeDirectory: string | null
  activeWorkspaceFileScopeName: string | null
  assistantTraceVisibility: AssistantTraceVisibility
  canInsertWorkspaceFileCommentsIntoDraft: boolean
  canOpenReview: boolean
  canOpenTerminal: boolean
  codeTheme: CodeHighlightTheme
  composerRefreshVersion: number
  isAgentDebugTraceEnabled: boolean
  isResolvingPermissionRequest: boolean
  permissionRequestActionError: string | null
  permissionRequestActionRequestID: string | null
  rightSidebar: RightSidebarState
  selectedDiffFileBySession: Record<string, string | null>
  sessionDiffBySession: Record<string, SessionDiffSummary>
  sessionDiffStateBySession: Record<string, SessionDiffState>
  messageTreeBySession: Record<string, SessionMessageTree>
  sideChatPanelState: RightSidebarSideChatPanelState | null
  workspaces: WorkspaceGroup[]
  onActivateTab: (tabID: string) => void
  onCloseTab: (tabID: string) => void
  onAskUserQuestionAnswer: (input: {
    freeformText?: string
    questionID?: string
    selectedOptions?: string[]
    sessionID?: string | null
    tabKey?: string | null
    text: string
  }) => void | Promise<void>
  onDiffFileRestore: (file: string, sessionID?: string | null) => void | Promise<void>
  onDiffFileSelect: (file: string | null, sessionID?: string | null) => void
  onSessionDiffScopeLoad?: (sessionID: string, scope: SessionDiffScope) => Promise<SessionDiffSummary>
  onArtifactLinkOpen?: (target: MarkdownArtifactLinkTarget) => void
  onLocalFileLinkOpen?: (target: MarkdownLocalFileLinkTarget) => void
  onOpenBrowserTab: () => void
  onOpenFilesTab: () => void
  onOpenMessageTreeTab: () => void
  onOpenReviewTab: () => void
  onOpenTerminalTab: () => void
  onMessageTreeNodeSelect: (sessionID: string, messageID: string) => void | Promise<void>
  onPreviewActiveInteractionChange: (pluginID: PreviewInteractionPluginID | null) => void
  onPreviewBack: () => void
  onPreviewCommitInteraction: (input: PreviewInteractionCommitInput) => void
  onPreviewDraftUrlChange: (value: string) => void
  onPreviewForward: () => void
  onPreviewOpen: () => void
  onPreviewOpenExternal: () => void | Promise<void>
  onPreviewOpenUrl: (url: string) => void
  onPreviewReload: () => void
  onPermissionRequestResponse: (input: {
    sessionID: string
    request: PermissionRequest
    decision: PermissionDecision
    note?: string
  }) => void | Promise<void>
  onSideChatCancelSend?: () => void | Promise<void>
  onSideChatCreate: (anchorMessageID: string, parentSessionID: string) => void | Promise<void>
  onSideChatDelete: (sessionID: string) => void | Promise<void>
  onSideChatDraftStateChange: (value: ComposerDraftState) => void
  onSideChatPasteImageAttachments?: (input: {
    allowImage: boolean
    disabledReason: string | null
    images: ComposerPastedImageAttachment[]
  }) => void | Promise<void>
  onSideChatPickAttachments: (input: {
    allowImage: boolean
    allowPdf: boolean
    disabledReason: string | null
  }) => void | Promise<void>
  onSideChatRemoveAttachment: (path: string) => void
  onSideChatSelect: (sessionID: string) => void | Promise<void>
  onSideChatSend: (input: {
    attachmentError?: string | null
    draftStateOverride?: ComposerDraftState
    questionAnswer?: {
      questionID: string
      selectedOptions?: string[]
      freeformText?: string
    }
    selectedReasoningEffort?: ReasoningEffort | null
    selectedModel?: string | null
    selectedSkillIDs: string[]
    steerQueuedMessageID?: string
    submissionMode?: UserThreadMessage["submissionMode"]
    waitForPendingModelSelection: () => Promise<void>
  }) => void | Promise<void>
  onSessionModelSelectionChange?: (sessionID: string, selection: SessionSummary["modelSelection"] | undefined) => void
  onWorkspaceFileCommentCancel: () => void
  onWorkspaceFileCommentChange: (text: string) => void
  onWorkspaceFileCommentConfirm: () => void
  onWorkspaceFileCommentStart: (startLineNumber: number, endLineNumber?: number) => void
  onWorkspaceDirectoryLoad: (path: string) => void
  onWorkspaceDirectoryToggle: (path: string) => void
  onWorkspaceFileTreeInvalidate: (paths: string[]) => void
  onWorkspaceFileQueryChange: (value: string) => void
  onWorkspaceFileSelect: (path: string, options?: { linkedLineRange?: MarkdownLocalFileLinkTarget["lineRange"] }) => void
  renderTerminalTab: (sessionID: string | null) => ReactNode
  windowControls?: ReactNode
}

type RightSidebarLauncherTabKind = Exclude<RightSidebarTab["kind"], "side-chat">

interface LauncherCard {
  disabled?: boolean
  icon: ReactNode
  key: RightSidebarLauncherTabKind
  title: string
}

function findSessionByID(workspaces: WorkspaceGroup[], sessionID: string | null | undefined) {
  if (!sessionID) return null

  for (const workspace of workspaces) {
    const session = workspace.sessions.find((candidate) => candidate.id === sessionID)
    if (session) return session
  }

  return null
}

function findSessionDirectoryByID(workspaces: WorkspaceGroup[], sessionID: string | null | undefined) {
  if (!sessionID) return null

  for (const workspace of workspaces) {
    if (workspace.sessions.some((candidate) => candidate.id === sessionID)) {
      return workspace.directory
    }
  }

  return null
}

function getTabIcon(kind: RightSidebarTab["kind"]) {
  switch (kind) {
    case "files":
      return <FileSearchIcon />
    case "browser":
      return <PreviewIcon />
    case "review":
      return <ChangesIcon />
    case "terminal":
      return <TerminalIcon />
    case "message-tree":
      return <SessionTreeIcon />
    case "side-chat":
      return <SideChatIcon />
  }
}

function getViewHostClassName(tab: RightSidebarTab | null, isLauncherVisible: boolean) {
  if (isLauncherVisible || !tab) return "right-sidebar-view-host is-launcher"

  switch (tab.kind) {
    case "browser":
      return "right-sidebar-view-host is-preview"
    case "files":
      return "right-sidebar-view-host is-files"
    case "review":
      return "right-sidebar-view-host is-changes"
    case "terminal":
      return "right-sidebar-view-host is-terminal"
    case "message-tree":
      return "right-sidebar-view-host is-message-tree"
    case "side-chat":
      return "right-sidebar-view-host is-side-chat"
  }
}

export function RightSidebar({
  activeSession,
  activeSessionDirectory,
  activeWorkspaceFileScopeDirectory,
  activeWorkspaceFileScopeName,
  assistantTraceVisibility,
  canInsertWorkspaceFileCommentsIntoDraft,
  canOpenReview,
  canOpenTerminal,
  codeTheme,
  composerRefreshVersion,
  isAgentDebugTraceEnabled,
  isResolvingPermissionRequest,
  permissionRequestActionError,
  permissionRequestActionRequestID,
  rightSidebar,
  selectedDiffFileBySession,
  sessionDiffBySession,
  sessionDiffStateBySession,
  messageTreeBySession,
  sideChatPanelState,
  workspaces,
  onActivateTab,
  onCloseTab,
  onAskUserQuestionAnswer,
  onDiffFileRestore,
  onDiffFileSelect,
  onSessionDiffScopeLoad,
  onArtifactLinkOpen,
  onLocalFileLinkOpen,
  onOpenBrowserTab,
  onOpenFilesTab,
  onOpenMessageTreeTab,
  onOpenReviewTab,
  onOpenTerminalTab,
  onMessageTreeNodeSelect,
  onPreviewActiveInteractionChange,
  onPreviewBack,
  onPreviewCommitInteraction,
  onPreviewDraftUrlChange,
  onPreviewForward,
  onPreviewOpen,
  onPreviewOpenExternal,
  onPreviewOpenUrl,
  onPreviewReload,
  onPermissionRequestResponse,
  onSideChatCancelSend,
  onSideChatCreate,
  onSideChatDelete,
  onSideChatDraftStateChange,
  onSideChatPasteImageAttachments,
  onSideChatPickAttachments,
  onSideChatRemoveAttachment,
  onSideChatSelect,
  onSideChatSend,
  onSessionModelSelectionChange,
  onWorkspaceFileCommentCancel,
  onWorkspaceFileCommentChange,
  onWorkspaceFileCommentConfirm,
  onWorkspaceFileCommentStart,
  onWorkspaceDirectoryLoad,
  onWorkspaceDirectoryToggle,
  onWorkspaceFileTreeInvalidate,
  onWorkspaceFileQueryChange,
  onWorkspaceFileSelect,
  renderTerminalTab,
  windowControls,
}: RightSidebarProps) {
  const { t } = useI18n()
  const [isLauncherVisible, setIsLauncherVisible] = useState(() => !rightSidebar.activeTabID)
  const lastActiveTabIDRef = useRef<string | null>(null)
  const activeTab = rightSidebar.tabs.find((tab) => tab.id === rightSidebar.activeTabID) ?? null
  const viewHostClassName = getViewHostClassName(activeTab, isLauncherVisible)
  const launcherCards = useMemo<LauncherCard[]>(() => [
    {
      key: "files",
      title: t("rightSidebar.launcher.filesTitle"),
      icon: <FileSearchIcon />,
    },
    {
      key: "browser",
      title: t("rightSidebar.launcher.browserTitle"),
      icon: <PreviewIcon />,
    },
    {
      key: "message-tree",
      title: t("rightSidebar.launcher.messageTreeTitle"),
      disabled: !activeSession,
      icon: <SessionTreeIcon />,
    },
    {
      key: "review",
      title: t("rightSidebar.launcher.reviewTitle"),
      disabled: !canOpenReview,
      icon: <ChangesIcon />,
    },
    {
      key: "terminal",
      title: t("rightSidebar.launcher.terminalTitle"),
      disabled: !canOpenTerminal,
      icon: <TerminalIcon />,
    },
  ], [activeSession, canOpenReview, canOpenTerminal, t])

  useEffect(() => {
    if (rightSidebar.tabs.length === 0) {
      setIsLauncherVisible(true)
    }
  }, [rightSidebar.tabs.length])

  useEffect(() => {
    const previousActiveTabID = lastActiveTabIDRef.current
    lastActiveTabIDRef.current = rightSidebar.activeTabID
    if (rightSidebar.activeTabID && rightSidebar.activeTabID !== previousActiveTabID) {
      setIsLauncherVisible(false)
    }
  }, [rightSidebar.activeTabID])

  function handleActivateTab(tabID: string) {
    setIsLauncherVisible(false)
    onActivateTab(tabID)
  }

  function handleCloseTab(tabID: string) {
    if (rightSidebar.tabs.length <= 1) {
      setIsLauncherVisible(true)
    }
    onCloseTab(tabID)
  }

  function handleOpenLauncherCard(kind: RightSidebarLauncherTabKind) {
    switch (kind) {
      case "files":
        onOpenFilesTab()
        break
      case "browser":
        onOpenBrowserTab()
        break
      case "review":
        if (!canOpenReview) return
        onOpenReviewTab()
        break
      case "terminal":
        if (!canOpenTerminal) return
        onOpenTerminalTab()
        break
      case "message-tree":
        if (!activeSession) return
        onOpenMessageTreeTab()
        break
    }
    setIsLauncherVisible(false)
  }

  function renderLauncher() {
    return (
      <div className="right-sidebar-launcher" aria-label="Right sidebar launcher">
        <div className="right-sidebar-launcher-shell">
          <div className="right-sidebar-launcher-tile-grid">
            {launcherCards.map((card) => (
              <button
                key={card.key}
                type="button"
                className={`right-sidebar-launcher-card is-${card.key}`}
                disabled={card.disabled}
                onClick={() => handleOpenLauncherCard(card.key)}
              >
                <span className="right-sidebar-launcher-card-icon">{card.icon}</span>
                <span className="right-sidebar-launcher-card-copy">
                  <span className="right-sidebar-launcher-card-title">{card.title}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    )
  }

  function renderActiveTab() {
    if (!activeTab) return renderLauncher()

    switch (activeTab.kind) {
      case "files":
        return (
          <WorkspaceFilesPanel
            canInsertCommentsIntoDraft={canInsertWorkspaceFileCommentsIntoDraft}
            codeTheme={codeTheme}
            scopeDirectory={activeTab.scopeDirectory ?? activeWorkspaceFileScopeDirectory}
            scopeName={activeTab.scopeName ?? activeWorkspaceFileScopeName}
            state={activeTab.state}
            onPendingCommentCancel={onWorkspaceFileCommentCancel}
            onPendingCommentChange={onWorkspaceFileCommentChange}
            onPendingCommentConfirm={onWorkspaceFileCommentConfirm}
            onPendingCommentStart={onWorkspaceFileCommentStart}
            onDirectoryLoad={onWorkspaceDirectoryLoad}
            onDirectoryToggle={onWorkspaceDirectoryToggle}
            onTreeInvalidate={onWorkspaceFileTreeInvalidate}
            onQueryChange={onWorkspaceFileQueryChange}
            onSelectFile={onWorkspaceFileSelect}
          />
        )
      case "browser":
        return (
          <UnifiedPreviewPanel
            codeTheme={codeTheme}
            state={activeTab.state}
            onBack={onPreviewBack}
            onDraftUrlChange={onPreviewDraftUrlChange}
            onForward={onPreviewForward}
            onActiveInteractionChange={onPreviewActiveInteractionChange}
            onCommitInteraction={onPreviewCommitInteraction}
            onOpen={onPreviewOpen}
            onOpenExternal={onPreviewOpenExternal}
            onOpenUrl={onPreviewOpenUrl}
            onReload={onPreviewReload}
            workspaceRoot={activeTab.workspaceRoot ?? activeWorkspaceFileScopeDirectory ?? activeSessionDirectory}
          />
        )
      case "review": {
        const reviewSessionID = activeTab.sessionID ?? activeSession?.id ?? null
        const reviewSession = reviewSessionID ? findSessionByID(workspaces, reviewSessionID) : activeSession
        const reviewSessionDirectory = reviewSessionID
          ? findSessionDirectoryByID(workspaces, reviewSessionID) ?? (reviewSessionID === activeSession?.id ? activeSessionDirectory : null)
          : activeSessionDirectory
        return (
          <ChangesPanel
            activeSession={reviewSession}
            activeSessionDirectory={reviewSessionDirectory}
            activeSessionDiff={reviewSessionID ? sessionDiffBySession[reviewSessionID] ?? null : null}
            activeSessionDiffState={reviewSessionID ? sessionDiffStateBySession[reviewSessionID] : undefined}
            selectedDiffFile={reviewSessionID ? selectedDiffFileBySession[reviewSessionID] ?? null : null}
            onDiffFileSelect={(file) => onDiffFileSelect(file, reviewSessionID)}
            onDiffFileRestore={(file) => onDiffFileRestore(file, reviewSessionID)}
            onDiffScopeLoad={reviewSessionID && onSessionDiffScopeLoad
              ? (scope) => onSessionDiffScopeLoad(reviewSessionID, scope)
              : undefined}
          />
        )
      }
      case "terminal":
        return renderTerminalTab(activeTab.sessionID)
      case "message-tree": {
        const treeSession = findSessionByID(workspaces, activeTab.sessionID)
        return (
          <SessionMessageTreePanel
            session={treeSession}
            messageTree={messageTreeBySession[activeTab.sessionID] ?? null}
            onArtifactLinkOpen={onArtifactLinkOpen}
            onLocalFileLinkOpen={onLocalFileLinkOpen}
            onSelectMessage={onMessageTreeNodeSelect}
          />
        )
      }
      case "side-chat":
        if (!sideChatPanelState || sideChatPanelState.activeTabID !== activeTab.id) {
          return (
            <div className="right-sidebar-empty" role="status">
              <p>Side chat is unavailable.</p>
            </div>
          )
        }

        return (
          <div className="right-sidebar-side-chat-panel">
            <InlineSideChatThread
              activeProjectID={sideChatPanelState.activeProjectID}
              ariaLabel="Side chat"
              attachments={sideChatPanelState.attachments}
              assistantTraceVisibility={assistantTraceVisibility}
              composerRefreshVersion={composerRefreshVersion}
              draftState={sideChatPanelState.draftState}
              isAgentDebugTraceEnabled={isAgentDebugTraceEnabled}
              isResolvingPermissionRequest={isResolvingPermissionRequest}
              isCancelling={sideChatPanelState.isCancelling}
              isInterruptible={sideChatPanelState.isInterruptible}
              isSending={sideChatPanelState.isSending}
              pendingInputs={sideChatPanelState.pendingInputs}
              pendingPermissionRequests={sideChatPanelState.pendingPermissionRequests}
              permissionRequestActionError={permissionRequestActionError}
              permissionRequestActionRequestID={permissionRequestActionRequestID}
              session={sideChatPanelState.session}
              sideChatSessions={sideChatPanelState.sideChatSessions}
              messages={sideChatPanelState.messages}
              onAskUserQuestionAnswer={(answer) =>
                onAskUserQuestionAnswer({
                  freeformText: answer.freeformText,
                  questionID: answer.questionID,
                  selectedOptions: answer.selectedOptions,
                  sessionID: sideChatPanelState.session.id,
                  tabKey: sideChatPanelState.tabKey,
                  text: answer.text,
                })
              }
              onArtifactLinkOpen={onArtifactLinkOpen}
              onCancelSend={onSideChatCancelSend}
              onCreateSideChat={() =>
                onSideChatCreate(sideChatPanelState.anchorMessageID, sideChatPanelState.parentSessionID)
              }
              onDeleteSideChat={onSideChatDelete}
              onDraftStateChange={onSideChatDraftStateChange}
              onHide={() => handleCloseTab(activeTab.id)}
              onLocalFileLinkOpen={onLocalFileLinkOpen}
              onPasteImageAttachments={onSideChatPasteImageAttachments}
              onPermissionRequestResponse={onPermissionRequestResponse}
              onPickAttachments={onSideChatPickAttachments}
              onRemoveAttachment={onSideChatRemoveAttachment}
              onSelectSideChat={onSideChatSelect}
              onSend={onSideChatSend}
              onSessionModelSelectionChange={onSessionModelSelectionChange}
              variant="sidebar"
            />
          </div>
        )
    }
  }

  return (
    <aside id="app-sidebar-right" className="sidebar is-right" aria-label="Inspector sidebar">
      <ShellTopMenu
        as="header"
        ariaLabel="Right sidebar top menu"
        className="right-sidebar-top-menu right-sidebar-tab-menu"
        contentClassName="right-sidebar-top-menu-tabs right-sidebar-dynamic-tabs"
        content={(
          <>
            <div className="right-sidebar-tab-strip" role="tablist" aria-label="Right sidebar tabs">
              {rightSidebar.tabs.map((tab) => {
                const isActive = !isLauncherVisible && activeTab?.id === tab.id

                return (
                  <div key={tab.id} className={isActive ? "right-sidebar-tab is-active" : "right-sidebar-tab"}>
                    <button
                      type="button"
                      className="right-sidebar-tab-trigger"
                      role="tab"
                      aria-selected={isActive}
                      title={tab.title}
                      onClick={() => handleActivateTab(tab.id)}
                    >
                      <span className="right-sidebar-tab-kind-icon" aria-hidden="true">
                        {getTabIcon(tab.kind)}
                      </span>
                      <span className="right-sidebar-tab-title">{tab.title}</span>
                    </button>
                    <button
                      type="button"
                      className="right-sidebar-tab-close"
                      aria-label={`Close ${tab.title}`}
                      onClick={() => handleCloseTab(tab.id)}
                    >
                      <CloseIcon />
                    </button>
                  </div>
                )
              })}
              <button
                type="button"
                className={isLauncherVisible ? "right-sidebar-add-tab-button is-active" : "right-sidebar-add-tab-button"}
                aria-label="Open right sidebar launcher"
                aria-pressed={isLauncherVisible}
                onClick={() => setIsLauncherVisible(true)}
              >
                <PlusIcon />
              </button>
            </div>
          </>
        )}
        dragRegion
        trailing={windowControls}
        trailingClassName="right-sidebar-top-menu-window-controls"
      />

      <div className="right-sidebar-main-stack">
        <div className={viewHostClassName}>
          {isLauncherVisible ? renderLauncher() : renderActiveTab()}
        </div>
      </div>
    </aside>
  )
}
