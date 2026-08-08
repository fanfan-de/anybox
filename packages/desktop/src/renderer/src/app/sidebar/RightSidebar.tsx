import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import type { AppearanceCodeFontFamily } from "../../../../shared/appearance"
import { ChangesPanel } from "../changes/ChangesPanel"
import { WorkspaceFilesPanel } from "../files/WorkspaceFilesPanel"
import {
  ChangesIcon,
  CloseIcon,
  FileSearchIcon,
  ForkIcon,
  PlusIcon,
  PreviewIcon,
  InfoIcon,
  TerminalIcon,
} from "../icons"
import { useI18n } from "../i18n/I18nProvider"
import { UnifiedPreviewPanel } from "../preview/UnifiedPreviewPanel"
import { ShellTopMenu, SidebarToggleButton } from "../shared-ui"
import { TerminalView } from "../terminal/TerminalView"
import {
  TerminalWorkspaceProvider,
  useOptionalTerminalWorkspace,
} from "../terminal/TerminalWorkspaceProvider"
import type { ShellRegionRole } from "../shell-layout"
import type { CodeHighlightTheme } from "../code-theme"
import {
  listBranchAnchorOptions,
  listRecentBranchThreads,
  type RecentBranchThread,
  type SessionMessageTree,
} from "../session-message-tree"
import type {
  AssistantTraceVisibility,
  BrandTheme,
  ColorMode,
  PreviewInteractionCommitInput,
  PreviewInteractionPluginID,
  RightSidebarState,
  RightSidebarTab,
  RightSidebarTabUpdate,
  SessionDiffState,
  SessionDiffScope,
  SessionDiffSummary,
  SessionRuntimeDebugSnapshot,
  SessionSummary,
  WorkspaceGroup,
} from "../types"
import type { MarkdownArtifactLinkTarget, MarkdownLocalFileLinkTarget } from "../thread-markdown"
import { SessionMessageInspectorPanel } from "./SessionMessageInspectorPanel"
import {
  BranchChatPanel,
  type BranchChatThreadPaneContext,
  type OpenBranchChatInput,
} from "./BranchChatPanel"

export interface RenderTerminalTabInput {
  onTitleChange: (title: string) => void
  sessionID: string | null
}

interface RightSidebarProps {
  activeSession: SessionSummary | null
  activeSessionRuntimeDebug?: SessionRuntimeDebugSnapshot | null
  activeSessionDirectory: string | null
  activeWorkspaceFileScopeDirectory: string | null
  activeWorkspaceFileScopeName: string | null
  canInsertWorkspaceFileCommentsIntoDraft: boolean
  canOpenReview: boolean
  canOpenTerminal: boolean
  assistantTraceVisibility: AssistantTraceVisibility
  codeTheme: CodeHighlightTheme
  rightSidebar: RightSidebarState
  threadPaneContext?: BranchChatThreadPaneContext | null
  selectedDiffFileBySession: Record<string, string | null>
  sessionDiffBySession: Record<string, SessionDiffSummary>
  sessionDiffStateBySession: Record<string, SessionDiffState>
  messageTreeBySession: Record<string, SessionMessageTree>
  workspaces: WorkspaceGroup[]
  onActivateTab: (tabID: string) => void
  onCloseTab: (tabID: string) => void
  onUpdateTab: (tabID: string, update: RightSidebarTabUpdate) => void
  onDiffFileRestore: (file: string, sessionID?: string | null) => void | Promise<void>
  onDiffFileSelect: (file: string | null, sessionID?: string | null) => void
  onSessionDiffScopeLoad?: (sessionID: string, scope: SessionDiffScope) => Promise<SessionDiffSummary>
  onArtifactLinkOpen?: (target: MarkdownArtifactLinkTarget) => void
  onLocalFileLinkOpen?: (target: MarkdownLocalFileLinkTarget) => void
  onOpenBrowserTab: () => void
  onOpenFilesTab: () => void
  onOpenReviewTab: () => void
  onOpenTerminalTab: () => void
  onOpenBranchChat: (input: OpenBranchChatInput) => void
  onLocateBranchAnchor?: (input: {
    messageID: string
    paneID: string
    sessionID: string
  }) => void
  onPreviewActiveInteractionChange: (pluginID: PreviewInteractionPluginID | null) => void
  onPreviewBack: () => void
  onPreviewCommitInteraction: (input: PreviewInteractionCommitInput) => void
  onPreviewDraftUrlChange: (value: string) => void
  onPreviewForward: () => void
  onPreviewOpen: () => void
  onPreviewOpenExternal: () => void | Promise<void>
  onPreviewOpenUrl: (url: string) => void
  onOpenCinemaProviderSettings?: (providerID: string) => void
  onPreviewReload: () => void
  onWorkspaceFileCommentCancel: () => void
  onWorkspaceFileCommentChange: (text: string) => void
  onWorkspaceFileCommentConfirm: () => void
  onWorkspaceFileCommentStart: (startLineNumber: number, endLineNumber?: number) => void
  onWorkspaceDirectoryLoad: (path: string) => void
  onWorkspaceDirectoryToggle: (path: string) => void
  onWorkspaceFileTreeInvalidate: (paths: string[]) => void
  onWorkspaceFileQueryChange: (value: string) => void
  onWorkspaceFileSelect: (path: string, options?: { linkedLineRange?: MarkdownLocalFileLinkTarget["lineRange"] }) => void
  renderTerminalTab: (input: RenderTerminalTabInput) => ReactNode
  terminalWorkspace?: {
    brandTheme: BrandTheme
    codeFontFamily?: AppearanceCodeFontFamily
    colorMode: ColorMode
    currentSessionID: string | null
    discoveryKey?: string
    storageKey?: string
  }
  isCompanionCollapsed?: boolean
  isRegionHidden?: boolean
  onToggleCompanion?: () => void
  regionRole?: ShellRegionRole
  showCompanionToggle?: boolean
  windowControls?: ReactNode
}

type RightSidebarLauncherTabKind = Exclude<
  RightSidebarTab["kind"],
  "message-inspector"
>

interface LauncherCard {
  disabled?: boolean
  icon: ReactNode
  key: RightSidebarLauncherTabKind
  title: string
}

interface LauncherCardButtonProps {
  card: LauncherCard
  onOpen: () => void
}

function LauncherCardButton({ card, onOpen }: LauncherCardButtonProps) {
  return (
    <button
      type="button"
      className={`right-sidebar-launcher-card is-${card.key}`}
      disabled={card.disabled}
      onClick={onOpen}
    >
      <span className="right-sidebar-launcher-card-icon">{card.icon}</span>
      <span className="right-sidebar-launcher-card-copy">
        <span className="right-sidebar-launcher-card-title">{card.title}</span>
      </span>
    </button>
  )
}

function TerminalLauncherCard({
  brandTheme,
  card,
  codeFontFamily,
  colorMode,
  onOpen,
}: LauncherCardButtonProps & {
  brandTheme: BrandTheme
  codeFontFamily?: AppearanceCodeFontFamily
  colorMode: ColorMode
}) {
  const workspace = useOptionalTerminalWorkspace()
  const session = workspace?.activeSession
  const canPreview = Boolean(
    !card.disabled &&
    session &&
    session.purpose === "interactive" &&
    session.terminalKey === "interactive" &&
    session.status === "running",
  )

  if (!workspace || !session || !canPreview) {
    return <LauncherCardButton card={card} onOpen={onOpen} />
  }

  return (
    <div className="right-sidebar-launcher-card is-terminal is-terminal-preview">
      <div className="right-sidebar-terminal-preview-content" aria-hidden="true" inert>
        <TerminalView
          brandTheme={brandTheme}
          codeFontFamily={codeFontFamily}
          colorMode={colorMode}
          panelHeight={0}
          session={session}
          variant="preview"
          onInput={workspace.handleTerminalInput}
          onResize={workspace.handleTerminalResize}
          onSnapshotChange={workspace.handleTerminalSnapshotChange}
          subscribeToTerminalStream={workspace.subscribeToTerminalStream}
        />
      </div>
      <button
        type="button"
        className="right-sidebar-terminal-preview-open"
        aria-label={card.title}
        title={card.title}
        onClick={onOpen}
      />
    </div>
  )
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

function findWorkspaceBySessionID(workspaces: WorkspaceGroup[], sessionID: string | null | undefined) {
  if (!sessionID) return null
  return workspaces.find((workspace) => workspace.sessions.some((session) => session.id === sessionID)) ?? null
}

function listRecentBranchesWithRuntimeStatus(
  messageTree: SessionMessageTree | null,
  runtimeDebug: SessionRuntimeDebugSnapshot | null | undefined,
): RecentBranchThread[] {
  const executions =
    runtimeDebug && messageTree && runtimeDebug.session.id === messageTree.sessionID
      ? runtimeDebug.executions ?? []
      : []

  return listRecentBranchThreads(messageTree).map((branch) => {
    const execution = executions.find(
      (candidate) =>
        candidate.targetKind === "detached-branch" &&
        candidate.headMessageID === branch.headMessageID,
    )
    if (!execution) return branch
    return {
      ...branch,
      status:
        execution.queueLength > 0
          ? "queued"
          : execution.status === "running" || execution.status === "cancelling"
            ? "generating"
            : branch.status,
    }
  })
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
    case "message-inspector":
      return <InfoIcon />
    case "branch-thread":
      return <ForkIcon />
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
    case "message-inspector":
      return "right-sidebar-view-host is-message-inspector"
    case "branch-thread":
      return "right-sidebar-view-host is-branch-thread"
  }
}

export function RightSidebar({
  assistantTraceVisibility,
  activeSession,
  activeSessionRuntimeDebug,
  activeSessionDirectory,
  activeWorkspaceFileScopeDirectory,
  activeWorkspaceFileScopeName,
  canInsertWorkspaceFileCommentsIntoDraft,
  canOpenReview,
  canOpenTerminal,
  codeTheme,
  rightSidebar,
  threadPaneContext,
  selectedDiffFileBySession,
  sessionDiffBySession,
  sessionDiffStateBySession,
  messageTreeBySession,
  workspaces,
  onActivateTab,
  onCloseTab,
  onUpdateTab,
  onDiffFileRestore,
  onDiffFileSelect,
  onSessionDiffScopeLoad,
  onArtifactLinkOpen,
  onLocalFileLinkOpen,
  onOpenBrowserTab,
  onOpenFilesTab,
  onOpenReviewTab,
  onOpenTerminalTab,
  onOpenBranchChat,
  onLocateBranchAnchor,
  onPreviewActiveInteractionChange,
  onPreviewBack,
  onPreviewCommitInteraction,
  onPreviewDraftUrlChange,
  onPreviewForward,
  onPreviewOpen,
  onPreviewOpenExternal,
  onPreviewOpenUrl,
  onOpenCinemaProviderSettings,
  onPreviewReload,
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
  terminalWorkspace,
  isCompanionCollapsed = false,
  isRegionHidden = false,
  onToggleCompanion,
  regionRole = "companion",
  showCompanionToggle = false,
  windowControls,
}: RightSidebarProps) {
  const { t } = useI18n()
  const [isLauncherVisible, setIsLauncherVisible] = useState(() => !rightSidebar.activeTabID)
  const lastActiveTabIDRef = useRef<string | null>(null)
  const activeTab = rightSidebar.tabs.find((tab) => tab.id === rightSidebar.activeTabID) ?? null
  const viewHostClassName = getViewHostClassName(activeTab, isLauncherVisible)
  const activeMessageTree = activeSession ? messageTreeBySession[activeSession.id] ?? null : null
  const branchAnchorOptions = useMemo(
    () => listBranchAnchorOptions(activeMessageTree),
    [activeMessageTree],
  )
  const launcherCards = useMemo<LauncherCard[]>(() => [
    {
      key: "branch-thread",
      title: t("branchChat.name"),
      disabled: branchAnchorOptions.length === 0,
      icon: <ForkIcon />,
    },
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
  ], [activeSession, branchAnchorOptions.length, canOpenReview, canOpenTerminal, t])

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

  useEffect(() => {
    if (activeTab?.kind === "message-inspector") {
      setIsLauncherVisible(false)
    }
  }, [activeTab])

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
      case "branch-thread": {
        const defaultAnchor = branchAnchorOptions.at(-1)
        if (!activeSession || !defaultAnchor) return
        onOpenBranchChat({
          anchorStrategy: "latest-at-send",
          sessionID: activeSession.id,
          originMessageID: defaultAnchor.messageID,
        })
        break
      }
    }
    setIsLauncherVisible(false)
  }

  function renderLauncher() {
    return (
      <div className="right-sidebar-launcher" aria-label="Right sidebar launcher">
        <div className="right-sidebar-launcher-shell">
          <div className="right-sidebar-launcher-tile-grid">
            {launcherCards.map((card) => card.key === "terminal" && terminalWorkspace
              ? (
                  <TerminalLauncherCard
                    key={card.key}
                    brandTheme={terminalWorkspace.brandTheme}
                    card={card}
                    codeFontFamily={terminalWorkspace.codeFontFamily}
                    colorMode={terminalWorkspace.colorMode}
                    onOpen={() => handleOpenLauncherCard(card.key)}
                  />
                )
              : (
                  <LauncherCardButton
                    key={card.key}
                    card={card}
                    onOpen={() => handleOpenLauncherCard(card.key)}
                  />
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
            onOpenCinemaProviderSettings={onOpenCinemaProviderSettings}
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
        return renderTerminalTab({
          sessionID: activeTab.sessionID,
          onTitleChange: (title) => {
            if (activeTab.title === title) return
            onUpdateTab(activeTab.id, { title })
          },
        })
      case "message-inspector": {
        const messageTree = messageTreeBySession[activeTab.sessionID] ?? null
        return (
          <SessionMessageInspectorPanel
            messageID={activeTab.messageID}
            messageTree={messageTree}
            onArtifactLinkOpen={onArtifactLinkOpen}
            onLocalFileLinkOpen={onLocalFileLinkOpen}
            onOpenBranchChat={(messageID) => {
              const existingBranch = listRecentBranchThreads(messageTree)
                .find((branch) => branch.headMessageID === messageID)
              onOpenBranchChat(existingBranch
                ? {
                    anchorStrategy: "selected",
                    sessionID: existingBranch.sessionID,
                    originMessageID: existingBranch.originMessageID,
                    headMessageID: existingBranch.headMessageID,
                    phase: "committed",
                    title: existingBranch.title,
                  }
                : {
                    anchorStrategy: "selected",
                    sessionID: activeTab.sessionID,
                    originMessageID: messageID,
                  })
            }}
          />
        )
      }
      case "branch-thread":
        return null
    }
  }

  const topMenuTrailing = showCompanionToggle || windowControls
    ? (
        <>
          {showCompanionToggle && onToggleCompanion ? (
            <SidebarToggleButton
              isSidebarCollapsed={isCompanionCollapsed}
              onToggleSidebar={onToggleCompanion}
              side="right"
              variant="top-menu"
            />
          ) : null}
          {windowControls}
        </>
      )
    : null

  const sidebar = (
    <aside
      id="app-sidebar-right"
      className={[
        "sidebar is-right",
        isRegionHidden ? "is-shell-region-hidden" : "",
      ].filter(Boolean).join(" ")}
      aria-hidden={isRegionHidden || undefined}
      aria-label={regionRole === "primary" ? t("shellLayout.toolsSurface") : t("rightSidebar.inspector")}
      data-shell-region={regionRole}
      data-shell-surface="tools"
      inert={isRegionHidden || undefined}
      role={regionRole === "primary" ? "region" : undefined}
      tabIndex={regionRole === "primary" ? -1 : undefined}
    >
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
        trailing={topMenuTrailing}
        trailingClassName="right-sidebar-top-menu-window-controls"
      />

      <div className="right-sidebar-main-stack">
        <div className={viewHostClassName}>
          {rightSidebar.tabs.flatMap((tab) => {
            if (tab.kind !== "branch-thread") return []
            const workspace = findWorkspaceBySessionID(workspaces, tab.sessionID)
            const messageTree = messageTreeBySession[tab.sessionID] ?? null
            return [
              <BranchChatPanel
                key={tab.id}
                assistantTraceVisibility={assistantTraceVisibility}
                codeTheme={codeTheme}
                isActive={!isLauncherVisible && activeTab?.id === tab.id}
                messageTree={messageTree}
                recentBranches={listRecentBranchesWithRuntimeStatus(
                  messageTree,
                  activeSessionRuntimeDebug,
                )}
                session={findSessionByID(workspaces, tab.sessionID)}
                tab={tab}
                threadPaneContext={threadPaneContext}
                workspace={workspace}
                onArtifactLinkOpen={onArtifactLinkOpen}
                onLocalFileLinkOpen={onLocalFileLinkOpen}
                onOpenBranchChat={onOpenBranchChat}
                onLocateAnchor={onLocateBranchAnchor}
                onUpdateTab={onUpdateTab}
              />,
            ]
          })}
          {isLauncherVisible
            ? renderLauncher()
            : activeTab?.kind === "branch-thread"
              ? null
              : renderActiveTab()}
        </div>
      </div>
    </aside>
  )

  if (!terminalWorkspace) return sidebar

  const terminalWorkspaceSessionID = !isLauncherVisible && activeTab?.kind === "terminal"
    ? activeTab.sessionID
    : terminalWorkspace.currentSessionID
  const terminalConnectionEnabled = !isRegionHidden && (
    isLauncherVisible ? canOpenTerminal : activeTab?.kind === "terminal"
  )
  const terminalDiscoveryKey = terminalWorkspaceSessionID === terminalWorkspace.currentSessionID
    ? terminalWorkspace.discoveryKey
    : undefined

  return (
    <TerminalWorkspaceProvider
      connectionEnabled={terminalConnectionEnabled}
      currentSessionID={terminalWorkspaceSessionID}
      discoveryKey={terminalDiscoveryKey}
      storageKey={terminalWorkspace.storageKey}
    >
      {sidebar}
    </TerminalWorkspaceProvider>
  )
}
