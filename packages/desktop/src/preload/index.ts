import { contextBridge, ipcRenderer } from "electron"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import type {
  AgentArchivedSessionSummary,
  AgentAutomationIPCEvent,
  AgentFolderWorkspace,
  AgentProjectModelSelection,
  AgentProjectWorkspace,
  AgentWorktreeRecord,
  AgentProviderAuthFlow,
  AgentProviderAuthState,
  AgentProviderCatalogItem,
  AgentProviderConnectionTestResult,
  AgentProviderModel,
  AgentSessionBridgeIPCEvent,
  AgentSessionHistoryMessage,
  AgentSessionRuntimeDebugSnapshot,
  AgentSessionTraceExport,
  AgentSessionSummary,
  AgentSessionTurnRequestInput,
  AgentSideChatLink,
  AgentSshConnectionTestResult,
  AgentSshDirectoryListing,
  AgentSshProfile,
  AgentSshProfileInput,
  AppearanceConfigDocument,
  AppearanceConfigSnapshot,
  LocaleConfigDocument,
  LocaleConfigSnapshot,
  BuiltinToolSelection,
  BuiltinToolsPayload,
  ConnectorDefinition,
  ConnectorStatus,
  DesktopAppUpdateCheckResult,
  DesktopAppUpdateSettings,
  DesktopAppUpdateState,
  DesktopIpcChannel,
  DesktopIpcInput,
  DesktopIpcOutput,
  DesktopLocalPreviewService,
  DesktopReadPreviewTextResult,
  DesktopResolvedPreviewTarget,
  DesktopSaveSessionTraceExportDirectoryResult,
  DesktopSaveSessionTraceExportResult,
  DesktopPreloadApi,
  WorkbenchStateEvent,
  WorkbenchSharedState,
  WorkbenchWindowContext,
  ExternalEditorSummary,
  GitActionResult,
  GitBranchSummary,
  GitCapabilities,
  GlobalSkillFileDocument,
  GlobalSkillTree,
  InstalledPlugin,
  McpServerDiagnostic,
  McpServerInput,
  McpServerSummary,
  MenuAnchor,
  MenuKey,
  PluginCatalogItem,
  PluginConnectorStatus,
  PluginDeleteResult,
  PluginImportURLInput,
  PluginInstallInput,
  PluginUpdateInput,
  PermissionRequestPrompt,
  PermissionResolveInput,
  PermissionResolveResult,
  ProjectMcpSelection,
  ProjectPluginSelection,
  ProjectSkillSelection,
  PromptPresetDocument,
  PromptPresetSelection,
  PromptPresetSummary,
  PromptUrlInstallPreview,
  PromptUrlInstallResult,
  PtyIPCEvent,
  PtySessionInfo,
  SkillGitInstallPreview,
  SkillGitInstallResult,
  SkillInfo,
  ToolPermissionModePayload,
  WindowAction,
  MobileBridgeDesktopEvent,
  WorkspaceFileChangeIPCEvent,
  WorkspaceDirectoryEntry,
  WorkspaceFileDocument,
  WorkspaceFileSearchResult,
  WorkspaceDiffFileRestoreResult,
  WorkspaceDiffPatchReverseApplyResult,
} from "../shared/desktop-ipc-contract"
import {
  DESKTOP_APP_UPDATE_STATE_EVENT_CHANNEL,
  DESKTOP_AGENT_SESSION_EVENT_CHANNEL,
  DESKTOP_APPEARANCE_STATE_EVENT_CHANNEL,
  DESKTOP_AUTOMATION_EVENT_CHANNEL,
  DESKTOP_MOBILE_BRIDGE_EVENT_CHANNEL,
  DESKTOP_PTY_EVENT_CHANNEL,
  DESKTOP_WORKBENCH_STATE_EVENT_CHANNEL,
  DESKTOP_WINDOW_STATE_EVENT_CHANNEL,
  DESKTOP_WORKSPACE_FILE_CHANGE_EVENT_CHANNEL,
} from "../shared/desktop-ipc-contract"
import type { AppearanceRuntimeState } from "../shared/appearance"

const safeProcess = typeof process !== "undefined" ? process : undefined
const preloadDirPath = path.dirname(fileURLToPath(import.meta.url))

function resolvePreviewGuestPreloadPath() {
  const candidatePaths = [
    path.join(preloadDirPath, "preview-webview.mjs"),
    path.join(preloadDirPath, "preview-webview.js"),
  ]

  const resolved = candidatePaths.find((candidate) => fs.existsSync(candidate))
  if (!resolved) {
    console.error("[desktop] preview webview preload not found, candidates:", candidatePaths)
    return undefined
  }

  return pathToFileURL(resolved).toString()
}

function invokeDesktop<Channel extends DesktopIpcChannel>(
  channel: Channel,
  ...args: undefined extends DesktopIpcInput<Channel>
    ? [input?: DesktopIpcInput<Channel>]
    : [input: DesktopIpcInput<Channel>]
) {
  return ipcRenderer.invoke(channel, ...args) as Promise<DesktopIpcOutput<Channel>>
}

try {
  contextBridge.exposeInMainWorld("desktop", {
    platform: safeProcess?.platform ?? "unknown",
    previewGuestPreloadPath: resolvePreviewGuestPreloadPath(),
    versions: safeProcess?.versions ?? {},
    getInfo: () =>
      invokeDesktop("desktop:get-info") as Promise<{
        platform: string
        electron: string
        chrome: string
        node: string
      }>,
    getAppUpdateSettings: () =>
      invokeDesktop("desktop:get-app-update-settings") as Promise<DesktopAppUpdateSettings>,
    getAppUpdateState: () =>
      invokeDesktop("desktop:get-app-update-state") as Promise<DesktopAppUpdateState>,
    setAutomaticUpdatesEnabled: (input: { enabled: boolean }) =>
      invokeDesktop("desktop:set-automatic-updates-enabled", input) as Promise<DesktopAppUpdateSettings>,
    checkForAppUpdates: () =>
      invokeDesktop("desktop:check-for-app-updates") as Promise<DesktopAppUpdateCheckResult>,
    installAppUpdate: () =>
      invokeDesktop("desktop:install-app-update") as Promise<DesktopIpcOutput<"desktop:install-app-update">>,
    getStoragePaths: () =>
      invokeDesktop("desktop:get-storage-paths") as Promise<DesktopIpcOutput<"desktop:get-storage-paths">>,
    getWindowState: () =>
      invokeDesktop("desktop:get-window-state") as Promise<{
        isMaximized: boolean
      }>,
    reportRendererError: (input: DesktopIpcInput<"desktop:report-renderer-error">) =>
      invokeDesktop("desktop:report-renderer-error", input) as Promise<DesktopIpcOutput<"desktop:report-renderer-error">>,
    reportRendererMemoryDiagnostics: (input: DesktopIpcInput<"desktop:report-renderer-memory-diagnostics">) =>
      invokeDesktop("desktop:report-renderer-memory-diagnostics", input) as Promise<DesktopIpcOutput<"desktop:report-renderer-memory-diagnostics">>,
    getRendererMemoryDiagnostics: () =>
      invokeDesktop("desktop:get-renderer-memory-diagnostics") as Promise<DesktopIpcOutput<"desktop:get-renderer-memory-diagnostics">>,
    getWorkbenchWindowContext: () =>
      invokeDesktop("desktop:get-workbench-window-context") as Promise<WorkbenchWindowContext>,
    publishWorkbenchSnapshot: (input: DesktopIpcInput<"desktop:workbench-publish-state-snapshot">) =>
      invokeDesktop("desktop:workbench-publish-state-snapshot", input) as Promise<WorkbenchSharedState>,
    detachSessionPanel: (input: DesktopIpcInput<"desktop:workbench-detach-session-panel">) =>
      invokeDesktop("desktop:workbench-detach-session-panel", input) as Promise<DesktopIpcOutput<"desktop:workbench-detach-session-panel">>,
    markWorkbenchWindowReady: (input: DesktopIpcInput<"desktop:workbench-window-ready">) =>
      invokeDesktop("desktop:workbench-window-ready", input) as Promise<void>,
    markWorkbenchPanelMounted: (input: DesktopIpcInput<"desktop:workbench-panel-mounted">) =>
      invokeDesktop("desktop:workbench-panel-mounted", input) as Promise<WorkbenchSharedState>,
    dockSessionPanel: (input: DesktopIpcInput<"desktop:workbench-dock-session-panel">) =>
      invokeDesktop("desktop:workbench-dock-session-panel", input) as Promise<WorkbenchSharedState>,
    moveWorkbenchPanel: (input: DesktopIpcInput<"desktop:workbench-move-session-panel">) =>
      invokeDesktop("desktop:workbench-move-session-panel", input) as Promise<DesktopIpcOutput<"desktop:workbench-move-session-panel">>,
    focusWorkbenchPanel: (input: DesktopIpcInput<"desktop:workbench-focus-session-panel">) =>
      invokeDesktop("desktop:workbench-focus-session-panel", input) as Promise<DesktopIpcOutput<"desktop:workbench-focus-session-panel">>,
    beginWorkbenchPanelDrag: (input: DesktopIpcInput<"desktop:workbench-begin-panel-drag">) =>
      invokeDesktop("desktop:workbench-begin-panel-drag", input) as Promise<DesktopIpcOutput<"desktop:workbench-begin-panel-drag">>,
    endWorkbenchPanelDrag: (input: DesktopIpcInput<"desktop:workbench-end-panel-drag">) =>
      invokeDesktop("desktop:workbench-end-panel-drag", input) as Promise<DesktopIpcOutput<"desktop:workbench-end-panel-drag">>,
    getWorkbenchPanelDrag: (input: DesktopIpcInput<"desktop:workbench-get-panel-drag">) =>
      invokeDesktop("desktop:workbench-get-panel-drag", input) as Promise<DesktopIpcOutput<"desktop:workbench-get-panel-drag">>,
    getAppearanceConfig: () =>
      invokeDesktop("desktop:get-appearance-config") as Promise<AppearanceConfigSnapshot>,
    saveAppearanceConfig: (input: { document: AppearanceConfigDocument }) =>
      invokeDesktop("desktop:save-appearance-config", input) as Promise<AppearanceConfigSnapshot>,
    publishAppearanceState: (input: DesktopIpcInput<"desktop:publish-appearance-state">) =>
      invokeDesktop("desktop:publish-appearance-state", input),
    getLocaleConfig: () =>
      invokeDesktop("desktop:get-locale-config") as Promise<LocaleConfigSnapshot>,
    saveLocaleConfig: (input: { document: LocaleConfigDocument }) =>
      invokeDesktop("desktop:save-locale-config", input) as Promise<LocaleConfigSnapshot>,
    showMenu: (menuKey: MenuKey, anchor?: MenuAnchor) => invokeDesktop("desktop:show-menu", { menuKey, anchor }),
    showExternalEditorMenu: (input: { targetPath: string; anchor?: MenuAnchor }) =>
      invokeDesktop("desktop:show-external-editor-menu", input) as Promise<void>,
    listExternalEditorsForTarget: (input: { targetPath: string }) =>
      invokeDesktop("desktop:list-external-editors-for-target", input) as Promise<ExternalEditorSummary[]>,
    openInExternalEditor: (input: { targetPath: string; editorID?: string }) =>
      invokeDesktop("desktop:open-in-external-editor", input) as Promise<{
        ok: true
        editor: ExternalEditorSummary
        targetPath: string
      }>,
    openExternalUrl: (input: { url: string }) =>
      invokeDesktop("desktop:open-external-url", input) as Promise<{
        ok: true
        url: string
      }>,
    openPath: (input: DesktopIpcInput<"desktop:open-path">) =>
      invokeDesktop("desktop:open-path", input) as Promise<DesktopIpcOutput<"desktop:open-path">>,
    openMonitorWindow: () => invokeDesktop("desktop:open-monitor-window") as Promise<DesktopIpcOutput<"desktop:open-monitor-window">>,
    openAppearanceWindow: () =>
      invokeDesktop("desktop:open-appearance-window") as Promise<DesktopIpcOutput<"desktop:open-appearance-window">>,
    windowAction: (action: WindowAction) => invokeDesktop("desktop:window-action", action),
    getAgentConfig: () =>
      invokeDesktop("desktop:get-agent-config") as Promise<{
        baseURL: string
        defaultDirectory: string
      }>,
    getAgentHealth: () =>
      invokeDesktop("desktop:agent-health") as Promise<{
        ok: boolean
        baseURL: string
        requestId?: string
        error?: string
      }>,
    getMobileBridgeStatus: () =>
      invokeDesktop("desktop:get-mobile-bridge-status") as Promise<DesktopIpcOutput<"desktop:get-mobile-bridge-status">>,
    refreshMobilePairingCode: () =>
      invokeDesktop("desktop:refresh-mobile-pairing-code") as Promise<DesktopIpcOutput<"desktop:refresh-mobile-pairing-code">>,
    rotateMobileBridgeToken: () =>
      invokeDesktop("desktop:rotate-mobile-bridge-token") as Promise<DesktopIpcOutput<"desktop:rotate-mobile-bridge-token">>,
    revokeMobileDevice: (input: DesktopIpcInput<"desktop:revoke-mobile-device">) =>
      invokeDesktop("desktop:revoke-mobile-device", input) as Promise<DesktopIpcOutput<"desktop:revoke-mobile-device">>,
    createPtySession: (input: { sessionID: string; title?: string; shell?: string; rows?: number; cols?: number }) =>
      invokeDesktop("desktop:create-pty-session", input) as Promise<PtySessionInfo>,
    getPtySession: (input: { id: string }) =>
      invokeDesktop("desktop:get-pty-session", input) as Promise<PtySessionInfo>,
    updatePtySession: (input: { id: string; title?: string; rows?: number; cols?: number }) =>
      invokeDesktop("desktop:update-pty-session", input) as Promise<PtySessionInfo>,
    deletePtySession: (input: { id: string }) =>
      invokeDesktop("desktop:delete-pty-session", input) as Promise<PtySessionInfo>,
    attachPtySession: (input: { id: string; cursor?: number }) =>
      invokeDesktop("desktop:attach-pty-session", input) as Promise<PtySessionInfo>,
    detachPtySession: (input: { id: string }) =>
      invokeDesktop("desktop:detach-pty-session", input) as Promise<boolean>,
    writePtyInput: (input: { id: string; data: string }) =>
      invokeDesktop("desktop:write-pty-input", input) as Promise<void>,
    pickProjectDirectory: () => invokeDesktop("desktop:pick-project-directory") as Promise<string | null>,
    pickComposerAttachments: (input?: { allowImage?: boolean; allowPdf?: boolean }) =>
      invokeDesktop("desktop:pick-composer-attachments", input) as Promise<string[]>,
    saveComposerPastedImages: (input: DesktopIpcInput<"desktop:save-composer-pasted-images">) =>
      invokeDesktop("desktop:save-composer-pasted-images", input) as Promise<string[]>,
    capturePreviewScreenshot: (input: DesktopIpcInput<"desktop:capture-preview-screenshot">) =>
      invokeDesktop("desktop:capture-preview-screenshot", input) as Promise<DesktopIpcOutput<"desktop:capture-preview-screenshot">>,
    detectLocalPreviewServices: () =>
      invokeDesktop("desktop:detect-local-preview-services") as Promise<DesktopLocalPreviewService[]>,
    resolvePreviewTarget: (input: DesktopIpcInput<"desktop:resolve-preview-target">) =>
      invokeDesktop("desktop:resolve-preview-target", input) as Promise<DesktopResolvedPreviewTarget>,
    readPreviewText: (input: DesktopIpcInput<"desktop:read-preview-text">) =>
      invokeDesktop("desktop:read-preview-text", input) as Promise<DesktopReadPreviewTextResult>,
    gitGetCapabilities: (input: DesktopIpcInput<"desktop:git-get-capabilities">) =>
      invokeDesktop("desktop:git-get-capabilities", input) as Promise<GitCapabilities>,
    gitCommit: (input: { projectID: string; directory: string; message: string; stageAll?: boolean }) =>
      invokeDesktop("desktop:git-commit", input) as Promise<GitActionResult>,
    gitGenerateCommitMessage: (input: DesktopIpcInput<"desktop:git-generate-commit-message">) =>
      invokeDesktop("desktop:git-generate-commit-message", input) as Promise<DesktopIpcOutput<"desktop:git-generate-commit-message">>,
    gitPush: (input: { projectID: string; directory: string }) =>
      invokeDesktop("desktop:git-push", input) as Promise<GitActionResult>,
    gitCreateBranch: (input: { projectID: string; directory: string; name: string }) =>
      invokeDesktop("desktop:git-create-branch", input) as Promise<GitActionResult>,
    gitListBranches: (input: { projectID: string; directory: string }) =>
      invokeDesktop("desktop:git-list-branches", input) as Promise<GitBranchSummary[]>,
    gitCheckoutBranch: (input: { projectID: string; directory: string; name: string }) =>
      invokeDesktop("desktop:git-checkout-branch", input) as Promise<GitActionResult>,
    gitCreatePullRequest: (input: { projectID: string; directory: string }) =>
      invokeDesktop("desktop:git-create-pull-request", input) as Promise<GitActionResult>,
    updateWorkspaceWatchDirectories: (input: { directories: string[] }) =>
      invokeDesktop("desktop:update-workspace-watch-directories", input) as Promise<{
        directories: string[]
      }>,
    listFolderWorkspaces: () =>
      invokeDesktop("desktop:list-folder-workspaces") as Promise<AgentFolderWorkspace[]>,
    listProjectWorkspaces: () =>
      invokeDesktop("desktop:list-project-workspaces") as Promise<AgentProjectWorkspace[]>,
    listProjectWorktrees: (input: { projectID: string }) =>
      invokeDesktop("desktop:list-project-worktrees", input) as Promise<AgentWorktreeRecord[]>,
    createProjectWorktree: (input: DesktopIpcInput<"desktop:create-project-worktree">) =>
      invokeDesktop("desktop:create-project-worktree", input) as Promise<AgentWorktreeRecord>,
    refreshProjectWorktree: (input: DesktopIpcInput<"desktop:refresh-project-worktree">) =>
      invokeDesktop("desktop:refresh-project-worktree", input) as Promise<AgentWorktreeRecord>,
    deleteProjectWorktree: (input: DesktopIpcInput<"desktop:delete-project-worktree">) =>
      invokeDesktop("desktop:delete-project-worktree", input) as Promise<AgentWorktreeRecord>,
    openFolderWorkspace: (input: { directory: string }) =>
      invokeDesktop("desktop:open-folder-workspace", input) as Promise<AgentFolderWorkspace>,
    listSshProfiles: () =>
      invokeDesktop("desktop:list-ssh-profiles") as Promise<AgentSshProfile[]>,
    saveSshProfile: (input: AgentSshProfileInput) =>
      invokeDesktop("desktop:save-ssh-profile", input) as Promise<AgentSshProfile>,
    deleteSshProfile: (input: { profileID: string }) =>
      invokeDesktop("desktop:delete-ssh-profile", input) as Promise<{ profileID: string; removed: boolean }>,
    testSshProfile: (input: { profileID: string }) =>
      invokeDesktop("desktop:test-ssh-profile", input) as Promise<AgentSshConnectionTestResult>,
    listSshDirectory: (input: { profileID: string; path?: string | null }) =>
      invokeDesktop("desktop:list-ssh-directory", input) as Promise<AgentSshDirectoryListing>,
    openSshFolderWorkspace: (input: { profileID: string; path: string }) =>
      invokeDesktop("desktop:open-ssh-folder-workspace", input) as Promise<AgentFolderWorkspace>,
    createProjectWorkspace: (input: { directory: string }) =>
      invokeDesktop("desktop:create-project-workspace", input) as Promise<AgentProjectWorkspace>,
    createAgentSession: (input?: { directory?: string }) =>
      invokeDesktop("desktop:agent-create-session", input) as Promise<{
        session: AgentSessionSummary
        requestId?: string
      }>,
    createFolderSession: (input: { projectID: string; directory: string; title?: string }) =>
      invokeDesktop("desktop:create-folder-session", input) as Promise<{
        session: AgentSessionSummary
        requestId?: string
      }>,
    createProjectSession: (input: { projectID: string; title?: string; directory?: string }) =>
      invokeDesktop("desktop:create-project-session", input) as Promise<{
        session: AgentSessionSummary
        requestId?: string
      }>,
    createSideChat: (input: { parentSessionID: string; anchorMessageID: string }) =>
      invokeDesktop("desktop:create-side-chat", input) as Promise<{
        session: AgentSessionSummary
        requestId?: string
      }>,
    listSideChats: (input: { parentSessionID: string; anchorMessageID?: string }) =>
      invokeDesktop("desktop:list-side-chats", input) as Promise<AgentSideChatLink[]>,
    getSideChatLink: (input: { sessionID: string }) =>
      invokeDesktop("desktop:get-side-chat-link", input) as Promise<AgentSideChatLink>,
    deleteProjectWorkspace: (input: { projectID: string }) =>
      invokeDesktop("desktop:delete-project-workspace", input) as Promise<{
        projectID: string
        deletedSessionIDs: string[]
        requestId?: string
      }>,
    deleteAgentSession: (input: { sessionID: string }) =>
      invokeDesktop("desktop:delete-agent-session", input) as Promise<{
        sessionID: string
        projectID: string
        requestId?: string
      }>,
    archiveAgentSession: (input: { sessionID: string }) =>
      invokeDesktop("desktop:archive-agent-session", input) as Promise<{
        sessionID: string
        projectID: string
        directory: string
        archivedAt: number
        requestId?: string
      }>,
    listArchivedSessions: () =>
      invokeDesktop("desktop:list-archived-sessions") as Promise<AgentArchivedSessionSummary[]>,
    restoreArchivedSession: (input: { sessionID: string }) =>
      invokeDesktop("desktop:restore-archived-session", input) as Promise<{
        session: AgentSessionSummary
        requestId?: string
      }>,
    deleteArchivedSession: (input: { sessionID: string }) =>
      invokeDesktop("desktop:delete-archived-session", input) as Promise<{
        sessionID: string
        requestId?: string
      }>,
    getSessionDiff: (input: DesktopIpcInput<"desktop:get-session-diff">) =>
      invokeDesktop("desktop:get-session-diff", input) as Promise<DesktopIpcOutput<"desktop:get-session-diff">>,
    getSessionTasks: (input: DesktopIpcInput<"desktop:get-session-tasks">) =>
      invokeDesktop("desktop:get-session-tasks", input) as Promise<DesktopIpcOutput<"desktop:get-session-tasks">>,
    restoreWorkspaceDiffFile: (input: { directory: string; file: string }) =>
      invokeDesktop("desktop:restore-workspace-diff-file", input) as Promise<WorkspaceDiffFileRestoreResult>,
    stageWorkspaceDiffFile: (input: { directory: string; file: string }) =>
      invokeDesktop("desktop:stage-workspace-diff-file", input) as Promise<WorkspaceDiffFileRestoreResult>,
    unstageWorkspaceDiffFile: (input: { directory: string; file: string }) =>
      invokeDesktop("desktop:unstage-workspace-diff-file", input) as Promise<WorkspaceDiffFileRestoreResult>,
    reverseApplyWorkspaceDiffPatches: (input: {
      directory: string
      diffs: Array<{
        file: string
        patch?: string
      }>
    }) =>
      invokeDesktop("desktop:reverse-apply-workspace-diff-patches", input) as Promise<WorkspaceDiffPatchReverseApplyResult>,
    getSessionRuntimeDebug: (input: { sessionID: string; limit?: number; turns?: number }) =>
      invokeDesktop("desktop:get-session-runtime-debug", input) as Promise<AgentSessionRuntimeDebugSnapshot>,
    getSessionTraceExport: (input: { sessionID: string }) =>
      invokeDesktop("desktop:get-session-trace-export", input) as Promise<AgentSessionTraceExport>,
    saveSessionTraceExport: (input: { sessionID: string }) =>
      invokeDesktop("desktop:save-session-trace-export", input) as Promise<DesktopSaveSessionTraceExportResult>,
    saveSessionTraceExportDirectory: (input: { sessionID: string }) =>
      invokeDesktop("desktop:save-session-trace-export-directory", input) as Promise<DesktopSaveSessionTraceExportDirectoryResult>,
    saveSessionTraceExportToProject: (input: { sessionID: string; directory: string; projectID?: string | null }) =>
      invokeDesktop("desktop:save-session-trace-export-to-project", input) as Promise<DesktopSaveSessionTraceExportDirectoryResult>,
    prepareSessionBagSubmission: (input: DesktopIpcInput<"desktop:prepare-session-bag-submission">) =>
      invokeDesktop("desktop:prepare-session-bag-submission", input) as Promise<DesktopIpcOutput<"desktop:prepare-session-bag-submission">>,
    uploadSessionBagSubmission: (input: DesktopIpcInput<"desktop:upload-session-bag-submission">) =>
      invokeDesktop("desktop:upload-session-bag-submission", input) as Promise<DesktopIpcOutput<"desktop:upload-session-bag-submission">>,
    discardSessionBagSubmission: (input: DesktopIpcInput<"desktop:discard-session-bag-submission">) =>
      invokeDesktop("desktop:discard-session-bag-submission", input) as Promise<DesktopIpcOutput<"desktop:discard-session-bag-submission">>,
    updateSessionWorkflow: (input: DesktopIpcInput<"desktop:update-session-workflow">) =>
      invokeDesktop("desktop:update-session-workflow", input) as Promise<DesktopIpcOutput<"desktop:update-session-workflow">>,
    updateSessionActiveMessage: (input: DesktopIpcInput<"desktop:update-session-active-message">) =>
      invokeDesktop("desktop:update-session-active-message", input) as Promise<DesktopIpcOutput<"desktop:update-session-active-message">>,
    rollbackSessionToCheckpoint: (input: DesktopIpcInput<"desktop:rollback-session-to-checkpoint">) =>
      invokeDesktop("desktop:rollback-session-to-checkpoint", input) as Promise<DesktopIpcOutput<"desktop:rollback-session-to-checkpoint">>,
    agentSession: {
      loadHistory: (input: { backendSessionID: string; view?: "active" | "all" }) =>
        invokeDesktop("desktop:agent-session-load-history", input) as Promise<AgentSessionHistoryMessage[]>,
      sendTurn: (input: AgentSessionTurnRequestInput) =>
        invokeDesktop("desktop:agent-session-send-turn", input) as Promise<{
          clientTurnID: string
          requestId?: string
        }>,
      resumeTurn: (input: { clientTurnID: string; backendSessionID: string }) =>
        invokeDesktop("desktop:agent-session-resume-turn", input) as Promise<{
          clientTurnID: string
          requestId?: string
        }>,
      cancelTurn: (input: { clientTurnID: string; backendSessionID: string }) =>
        invokeDesktop("desktop:agent-session-cancel-turn", input) as Promise<{
          clientTurnID: string
          backendSessionID: string
          localRequestAborted: boolean
          backendCancelled: boolean
          backendCancelError?: string
        }>,
      abortTurn: (input: DesktopIpcInput<"desktop:agent-session-abort-turn">) =>
        invokeDesktop("desktop:agent-session-abort-turn", input) as Promise<DesktopIpcOutput<"desktop:agent-session-abort-turn">>,
      interrupt: (input: DesktopIpcInput<"desktop:agent-session-interrupt">) =>
        invokeDesktop("desktop:agent-session-interrupt", input) as Promise<DesktopIpcOutput<"desktop:agent-session-interrupt">>,
      answerQuestion: (input: { backendSessionID: string; questionID: string; selectedOptions?: string[]; freeformText?: string }) =>
        invokeDesktop("desktop:agent-session-answer-question", input) as Promise<{
          sessionID: string
          questionID: string
          selectedOptions?: string[]
          freeformText?: string
          answerText: string
          answeredAt: number
        }>,
      subscribe: (input: { uiSessionID?: string; backendSessionID: string }) =>
        invokeDesktop("desktop:agent-session-subscribe", input) as Promise<{
          backendSessionID: string
          lastEventID?: string
        }>,
      unsubscribe: (input: { backendSessionID: string }) =>
        invokeDesktop("desktop:agent-session-unsubscribe", input) as Promise<{
          backendSessionID: string
          removed: boolean
        }>,
      loadPermissionRequests: (input: { backendSessionID: string }) =>
        invokeDesktop("desktop:agent-session-load-permission-requests", input) as Promise<PermissionRequestPrompt[]>,
      respondPermissionRequest: (input: PermissionResolveInput) =>
        invokeDesktop("desktop:agent-session-respond-permission-request", input) as Promise<PermissionResolveResult>,
      onEvent: (listener: (event: AgentSessionBridgeIPCEvent) => void) => {
        const wrappedListener = (_event: Electron.IpcRendererEvent, sessionEvent: AgentSessionBridgeIPCEvent) => {
          listener(sessionEvent)
        }

        ipcRenderer.on(DESKTOP_AGENT_SESSION_EVENT_CHANNEL, wrappedListener)

        return () => {
          ipcRenderer.removeListener(DESKTOP_AGENT_SESSION_EVENT_CHANNEL, wrappedListener)
        }
      },
    },
    getGlobalProviderCatalog: () =>
      invokeDesktop("desktop:get-global-provider-catalog") as Promise<AgentProviderCatalogItem[]>,
    refreshGlobalProviderCatalog: () =>
      invokeDesktop("desktop:refresh-global-provider-catalog") as Promise<AgentProviderCatalogItem[]>,
    getGlobalProviderAuth: (input: { providerID: string }) =>
      invokeDesktop("desktop:get-global-provider-auth", input) as Promise<AgentProviderAuthState>,
    startGlobalProviderAuthFlow: (input: {
      providerID: string
      method: string
      baseURL?: string | null
      prompt?: "login" | "select_account"
    }) =>
      invokeDesktop("desktop:start-global-provider-auth-flow", input) as Promise<AgentProviderAuthFlow>,
    getGlobalProviderAuthFlow: (input: { providerID: string; flowID: string }) =>
      invokeDesktop("desktop:get-global-provider-auth-flow", input) as Promise<AgentProviderAuthFlow>,
    cancelGlobalProviderAuthFlow: (input: { providerID: string; flowID: string }) =>
      invokeDesktop("desktop:cancel-global-provider-auth-flow", input) as Promise<AgentProviderAuthFlow>,
    saveGlobalProviderApiKey: (input: { providerID: string; apiKey?: string | null }) =>
      invokeDesktop("desktop:save-global-provider-api-key", input) as Promise<AgentProviderAuthState>,
    deleteGlobalProviderAuthSession: (input: { providerID: string }) =>
      invokeDesktop("desktop:delete-global-provider-auth-session", input) as Promise<AgentProviderAuthState>,
    testGlobalProviderConnection: (input: {
      providerID: string
      method?: string
      credentialMode?: "active" | "manual" | "environment"
      apiKey?: string | null
      baseURL?: string | null
    }) =>
      invokeDesktop("desktop:test-global-provider-connection", input) as Promise<AgentProviderConnectionTestResult>,
    upsertCustomProvider: (input: {
      providerID?: string
      apiBaseURL: string
      apiKey: string
      defaultModel: string
      chatEndpoint: string
    }) =>
      invokeDesktop("desktop:upsert-custom-provider", input) as Promise<{
        provider: {
          id: string
          name: string
          available: boolean
          apiKeyConfigured: boolean
          baseURL?: string
        }
        selection: AgentProjectModelSelection
      }>,
    testCustomProviderConnection: (input: {
      providerID?: string
      apiBaseURL: string
      apiKey: string
      defaultModel: string
      chatEndpoint: string
    }) =>
      invokeDesktop("desktop:test-custom-provider-connection", input) as Promise<AgentProviderConnectionTestResult>,
    getGlobalModels: () =>
      invokeDesktop("desktop:get-global-models") as Promise<{
        items: AgentProviderModel[]
        selection: AgentProjectModelSelection
      }>,
    updateGlobalProvider: (input: {
      providerID: string
      provider: {
        name?: string
        env?: string[]
        options?: {
          apiKey?: string
          baseURL?: string
        }
      }
    }) =>
      invokeDesktop("desktop:update-global-provider", input) as Promise<{
        provider: {
          id: string
          name: string
          available: boolean
          apiKeyConfigured: boolean
          baseURL?: string
        }
        selection: {
          model?: string
          small_model?: string
        }
      }>,
    deleteGlobalProvider: (input: { providerID: string }) =>
      invokeDesktop("desktop:delete-global-provider", input) as Promise<{
        providerID: string
        selection: {
          model?: string
          small_model?: string
        }
      }>,
    updateGlobalModelSelection: (input: {
      model?: string | null
      small_model?: string | null
      reasoning_effort?: AgentProjectModelSelection["reasoning_effort"] | null
      image_model?: string | null
      image_generation?: {
        default_size?: string
        default_count?: number
      } | null
    }) =>
      invokeDesktop("desktop:update-global-model-selection", input) as Promise<{
        model?: string
        small_model?: string
        reasoning_effort?: AgentProjectModelSelection["reasoning_effort"]
        image_model?: string
        image_generation?: {
          default_size?: string
          default_count?: number
        }
      }>,
    getGlobalMcpServers: () =>
      invokeDesktop("desktop:get-global-mcp-servers") as Promise<McpServerSummary[]>,
    getGlobalMcpServerDiagnostic: (input: { serverID: string }) =>
      invokeDesktop("desktop:get-global-mcp-server-diagnostic", input) as Promise<McpServerDiagnostic>,
    updateGlobalMcpServer: (input: {
      serverID: string
      server: McpServerInput
    }) =>
      invokeDesktop("desktop:update-global-mcp-server", input) as Promise<McpServerSummary>,
    deleteGlobalMcpServer: (input: { serverID: string }) =>
      invokeDesktop("desktop:delete-global-mcp-server", input) as Promise<{
        serverID: string
        removed: boolean
      }>,
    getPluginCatalog: (input?: { freshness?: "cached" | "fresh" }) =>
      invokeDesktop("desktop:get-plugin-catalog", input) as Promise<PluginCatalogItem[]>,
    getInstalledPlugins: () =>
      invokeDesktop("desktop:get-installed-plugins") as Promise<InstalledPlugin[]>,
    importPluginFromURL: (input: PluginImportURLInput) =>
      invokeDesktop("desktop:import-plugin-from-url", input) as Promise<PluginCatalogItem>,
    installPlugin: (input: PluginInstallInput) =>
      invokeDesktop("desktop:install-plugin", input) as Promise<InstalledPlugin>,
    updateInstalledPlugin: (input: PluginUpdateInput) =>
      invokeDesktop("desktop:update-installed-plugin", input) as Promise<InstalledPlugin>,
    deleteInstalledPlugin: (input: { pluginID: string }) =>
      invokeDesktop("desktop:delete-installed-plugin", input) as Promise<PluginDeleteResult>,
    getInstalledPluginDiagnostic: (input: { pluginID: string }) =>
      invokeDesktop("desktop:get-installed-plugin-diagnostic", input) as Promise<McpServerDiagnostic>,
    getConnectorCatalog: () =>
      invokeDesktop("desktop:get-connector-catalog") as Promise<ConnectorDefinition[]>,
    getConnectors: () =>
      invokeDesktop("desktop:get-connectors") as Promise<ConnectorStatus[]>,
    getConnector: (input: { connectorID: string }) =>
      invokeDesktop("desktop:get-connector", input) as Promise<ConnectorStatus>,
    saveConnectorApiKey: (input: { connectorID: string; apiKey?: string | null }) =>
      invokeDesktop("desktop:save-connector-api-key", input) as Promise<ConnectorStatus>,
    deleteConnectorApiKey: (input: { connectorID: string }) =>
      invokeDesktop("desktop:delete-connector-api-key", input) as Promise<ConnectorStatus>,
    saveConnectorConfig: (input: { connectorID: string; config: Record<string, string | null | undefined> }) =>
      invokeDesktop("desktop:save-connector-config", input) as Promise<ConnectorStatus>,
    deleteConnectorConfig: (input: { connectorID: string }) =>
      invokeDesktop("desktop:delete-connector-config", input) as Promise<ConnectorStatus>,
    startConnectorAuthFlow: (input: { connectorID: string }) =>
      invokeDesktop("desktop:start-connector-auth-flow", input) as Promise<AgentProviderAuthFlow>,
    getConnectorAuthFlow: (input: { connectorID: string; flowID: string }) =>
      invokeDesktop("desktop:get-connector-auth-flow", input) as Promise<AgentProviderAuthFlow | undefined>,
    cancelConnectorAuthFlow: (input: { connectorID: string; flowID: string }) =>
      invokeDesktop("desktop:cancel-connector-auth-flow", input) as Promise<AgentProviderAuthFlow | undefined>,
    deleteConnectorAuthSession: (input: { connectorID: string }) =>
      invokeDesktop("desktop:delete-connector-auth-session", input) as Promise<ConnectorStatus>,
    getConnectorDiagnostic: (input: { connectorID: string }) =>
      invokeDesktop("desktop:get-connector-diagnostic", input) as Promise<McpServerDiagnostic>,
    getInstalledPluginConnectors: (input: { pluginID: string }) =>
      invokeDesktop("desktop:get-installed-plugin-connectors", input) as Promise<PluginConnectorStatus[]>,
    saveInstalledPluginConnectorApiKey: (input: { pluginID: string; appID: string; apiKey?: string | null }) =>
      invokeDesktop("desktop:save-installed-plugin-connector-api-key", input) as Promise<PluginConnectorStatus>,
    deleteInstalledPluginConnectorApiKey: (input: { pluginID: string; appID: string }) =>
      invokeDesktop("desktop:delete-installed-plugin-connector-api-key", input) as Promise<PluginConnectorStatus>,
    startInstalledPluginConnectorAuthFlow: (input: { pluginID: string; appID: string }) =>
      invokeDesktop("desktop:start-installed-plugin-connector-auth-flow", input) as Promise<AgentProviderAuthFlow>,
    getInstalledPluginConnectorAuthFlow: (input: { pluginID: string; appID: string; flowID: string }) =>
      invokeDesktop("desktop:get-installed-plugin-connector-auth-flow", input) as Promise<AgentProviderAuthFlow | undefined>,
    cancelInstalledPluginConnectorAuthFlow: (input: { pluginID: string; appID: string; flowID: string }) =>
      invokeDesktop("desktop:cancel-installed-plugin-connector-auth-flow", input) as Promise<AgentProviderAuthFlow | undefined>,
    deleteInstalledPluginConnectorAuthSession: (input: { pluginID: string; appID: string }) =>
      invokeDesktop("desktop:delete-installed-plugin-connector-auth-session", input) as Promise<PluginConnectorStatus>,
    getInstalledPluginConnectorDiagnostic: (input: { pluginID: string; appID: string }) =>
      invokeDesktop("desktop:get-installed-plugin-connector-diagnostic", input) as Promise<McpServerDiagnostic>,
    getBuiltinTools: () =>
      invokeDesktop("desktop:get-builtin-tools") as Promise<BuiltinToolsPayload>,
    updateBuiltinToolSelection: (input: BuiltinToolSelection) =>
      invokeDesktop("desktop:update-builtin-tool-selection", input) as Promise<BuiltinToolSelection>,
    getToolPermissionMode: () =>
      invokeDesktop("desktop:get-tool-permission-mode") as Promise<ToolPermissionModePayload>,
    updateToolPermissionMode: (input: ToolPermissionModePayload) =>
      invokeDesktop("desktop:update-tool-permission-mode", input) as Promise<ToolPermissionModePayload>,
    listAutomations: () =>
      invokeDesktop("desktop:list-automations") as Promise<DesktopIpcOutput<"desktop:list-automations">>,
    createAutomation: (input: DesktopIpcInput<"desktop:create-automation">) =>
      invokeDesktop("desktop:create-automation", input) as Promise<DesktopIpcOutput<"desktop:create-automation">>,
    updateAutomation: (input: DesktopIpcInput<"desktop:update-automation">) =>
      invokeDesktop("desktop:update-automation", input) as Promise<DesktopIpcOutput<"desktop:update-automation">>,
    deleteAutomation: (input: DesktopIpcInput<"desktop:delete-automation">) =>
      invokeDesktop("desktop:delete-automation", input) as Promise<DesktopIpcOutput<"desktop:delete-automation">>,
    runAutomation: (input: DesktopIpcInput<"desktop:run-automation">) =>
      invokeDesktop("desktop:run-automation", input) as Promise<DesktopIpcOutput<"desktop:run-automation">>,
    listAutomationRuns: (input?: DesktopIpcInput<"desktop:list-automation-runs">) =>
      invokeDesktop("desktop:list-automation-runs", input) as Promise<DesktopIpcOutput<"desktop:list-automation-runs">>,
    updateAutomationRunTriage: (input: DesktopIpcInput<"desktop:update-automation-run-triage">) =>
      invokeDesktop("desktop:update-automation-run-triage", input) as Promise<DesktopIpcOutput<"desktop:update-automation-run-triage">>,
    cancelAutomationRun: (input: DesktopIpcInput<"desktop:cancel-automation-run">) =>
      invokeDesktop("desktop:cancel-automation-run", input) as Promise<DesktopIpcOutput<"desktop:cancel-automation-run">>,
    getGlobalSkills: () =>
      invokeDesktop("desktop:get-global-skills") as Promise<SkillInfo[]>,
    getPromptPresets: () =>
      invokeDesktop("desktop:get-prompt-presets") as Promise<PromptPresetSummary[]>,
    getPromptPresetSelection: () =>
      invokeDesktop("desktop:get-prompt-preset-selection") as Promise<PromptPresetSelection>,
    readPromptPreset: (input: { presetID: string }) =>
      invokeDesktop("desktop:read-prompt-preset", input) as Promise<PromptPresetDocument>,
    createPromptPreset: (input: { label?: string; content?: string; description?: string }) =>
      invokeDesktop("desktop:create-prompt-preset", input) as Promise<PromptPresetDocument>,
    translatePromptPreset: (input: DesktopIpcInput<"desktop:translate-prompt-preset">) =>
      invokeDesktop("desktop:translate-prompt-preset", input) as Promise<DesktopIpcOutput<"desktop:translate-prompt-preset">>,
    previewPromptUrlInstall: (input: { source: string }) =>
      invokeDesktop("desktop:preview-prompt-url-install", input) as Promise<PromptUrlInstallPreview>,
    installPromptsFromUrl: (input: { previewID: string; promptIDs: string[] }) =>
      invokeDesktop("desktop:install-prompts-from-url", input) as Promise<PromptUrlInstallResult>,
    getGlobalSkillsTree: () =>
      invokeDesktop("desktop:get-global-skills-tree") as Promise<GlobalSkillTree>,
    readGlobalSkillFile: (input: { path: string }) =>
      invokeDesktop("desktop:read-global-skill-file", input) as Promise<GlobalSkillFileDocument>,
    searchWorkspaceFiles: (input: { directory: string; query: string }) =>
      invokeDesktop("desktop:search-workspace-files", input) as Promise<WorkspaceFileSearchResult[]>,
    listWorkspaceDirectory: (input: { directory: string; path?: string | null }) =>
      invokeDesktop("desktop:list-workspace-directory", input) as Promise<WorkspaceDirectoryEntry[]>,
    readWorkspaceFile: (input: { directory: string; path: string }) =>
      invokeDesktop("desktop:read-workspace-file", input) as Promise<WorkspaceFileDocument>,
    updateGlobalSkillFile: (input: { path: string; content: string }) =>
      invokeDesktop("desktop:update-global-skill-file", input) as Promise<GlobalSkillFileDocument>,
    updatePromptPreset: (input: { presetID: string; label?: string; content: string; description?: string }) =>
      invokeDesktop("desktop:update-prompt-preset", input) as Promise<PromptPresetDocument>,
    updatePromptPresetSelection: (input: PromptPresetSelection) =>
      invokeDesktop("desktop:update-prompt-preset-selection", input) as Promise<PromptPresetSelection>,
    resetPromptPreset: (input: { presetID: string }) =>
      invokeDesktop("desktop:reset-prompt-preset", input) as Promise<PromptPresetDocument>,
    deletePromptPreset: (input: { presetID: string }) =>
      invokeDesktop("desktop:delete-prompt-preset", input) as Promise<PromptPresetSelection>,
    createGlobalSkill: (input: { name: string; parentDirectory?: string | null }) =>
      invokeDesktop("desktop:create-global-skill", input) as Promise<{
        directory: string
        file: GlobalSkillFileDocument
      }>,
    previewGlobalSkillGitInstall: (input: { source: string; parentDirectory?: string | null }) =>
      invokeDesktop("desktop:preview-global-skill-git-install", input) as Promise<SkillGitInstallPreview>,
    installGlobalSkillsFromGit: (input: { previewID: string; skillIDs: string[]; parentDirectory?: string | null }) =>
      invokeDesktop("desktop:install-global-skills-from-git", input) as Promise<SkillGitInstallResult>,
    installGlobalSkillFromLocalFile: (input?: { parentDirectory?: string | null }) =>
      invokeDesktop("desktop:install-global-skill-from-local-file", input) as Promise<SkillGitInstallResult | null>,
    renameGlobalSkill: (input: { directory: string; name: string }) =>
      invokeDesktop("desktop:rename-global-skill", input) as Promise<{
        previousDirectory: string
        directory: string
        filePath: string | null
      }>,
    deleteGlobalSkill: (input: { directory: string }) =>
      invokeDesktop("desktop:delete-global-skill", input) as Promise<{
        directory: string
        removed: boolean
      }>,
    createGlobalSkillFolder: (input: { name: string; parentDirectory?: string | null }) =>
      invokeDesktop("desktop:create-global-skill-folder", input) as Promise<{
        directory: string
      }>,
    renameGlobalSkillFolder: (input: { directory: string; name: string }) =>
      invokeDesktop("desktop:rename-global-skill-folder", input) as Promise<{
        previousDirectory: string
        directory: string
      }>,
    deleteGlobalSkillFolder: (input: { directory: string }) =>
      invokeDesktop("desktop:delete-global-skill-folder", input) as Promise<{
        directory: string
        removed: boolean
      }>,
    moveGlobalSkillDirectory: (input: { directory: string; parentDirectory?: string | null }) =>
      invokeDesktop("desktop:move-global-skill-directory", input) as Promise<{
        previousDirectory: string
        directory: string
        filePath: string | null
      }>,
    getProjectProviderCatalog: (input: { projectID: string }) =>
      invokeDesktop("desktop:get-project-provider-catalog", input) as Promise<AgentProviderCatalogItem[]>,
    refreshProjectProviderCatalog: (input: { projectID: string }) =>
      invokeDesktop("desktop:refresh-project-provider-catalog", input) as Promise<AgentProviderCatalogItem[]>,
    getProjectModels: (input: { projectID: string }) =>
      invokeDesktop("desktop:get-project-models", input) as Promise<{
        items: Array<{
          id: string
          providerID: string
          name: string
          family?: string
          status: "alpha" | "beta" | "deprecated" | "active"
          available: boolean
          capabilities: {
            temperature: boolean
            reasoning: boolean
            attachment: boolean
            toolcall: boolean
            input: {
              text: boolean
              audio: boolean
              image: boolean
              video: boolean
              pdf: boolean
            }
            output: {
              text: boolean
              audio: boolean
              image: boolean
              video: boolean
              pdf: boolean
            }
          }
          limit: {
            context: number
            input?: number
            output: number
          }
        }>
        selection: {
          model?: string
          small_model?: string
        }
        effectiveModel?: {
          id: string
          providerID: string
          name: string
          family?: string
          status: "alpha" | "beta" | "deprecated" | "active"
          available: boolean
          capabilities: {
            temperature: boolean
            reasoning: boolean
            attachment: boolean
            toolcall: boolean
            input: {
              text: boolean
              audio: boolean
              image: boolean
              video: boolean
              pdf: boolean
            }
            output: {
              text: boolean
              audio: boolean
              image: boolean
              video: boolean
              pdf: boolean
            }
          }
          limit: {
            context: number
            input?: number
            output: number
          }
        } | null
      }>,
    getSessionModels: (input: { sessionID: string }) =>
      invokeDesktop("desktop:get-session-models", input) as Promise<{
        items: AgentProviderModel[]
        selection: AgentProjectModelSelection
        effectiveModel?: AgentProviderModel | null
      }>,
    getProjectSkills: (input: { projectID: string }) =>
      invokeDesktop("desktop:get-project-skills", input) as Promise<SkillInfo[]>,
    getProjectSkillSelection: (input: { projectID: string }) =>
      invokeDesktop("desktop:get-project-skill-selection", input) as Promise<ProjectSkillSelection>,
    updateProjectSkillSelection: (input: { projectID: string; skillIDs: string[] }) =>
      invokeDesktop("desktop:update-project-skill-selection", input) as Promise<ProjectSkillSelection>,
    getProjectPlugins: (input: { projectID: string }) =>
      invokeDesktop("desktop:get-project-plugins", input) as Promise<InstalledPlugin[]>,
    getProjectPluginSelection: (input: { projectID: string }) =>
      invokeDesktop("desktop:get-project-plugin-selection", input) as Promise<ProjectPluginSelection>,
    updateProjectPluginSelection: (input: { projectID: string; pluginIDs: string[] }) =>
      invokeDesktop("desktop:update-project-plugin-selection", input) as Promise<ProjectPluginSelection>,
    getProjectMcpSelection: (input: { projectID: string }) =>
      invokeDesktop("desktop:get-project-mcp-selection", input) as Promise<ProjectMcpSelection>,
    updateProjectMcpSelection: (input: { projectID: string; serverIDs: string[] }) =>
      invokeDesktop("desktop:update-project-mcp-selection", input) as Promise<ProjectMcpSelection>,
    getProjectMcpServers: (input: { projectID: string }) =>
      invokeDesktop("desktop:get-project-mcp-servers", input) as Promise<McpServerSummary[]>,
    getProjectMcpServerDiagnostic: (input: { projectID: string; serverID: string }) =>
      invokeDesktop("desktop:get-project-mcp-server-diagnostic", input) as Promise<McpServerDiagnostic>,
    updateProjectMcpServer: (input: {
      projectID: string
      serverID: string
      server: McpServerInput
    }) =>
      invokeDesktop("desktop:update-project-mcp-server", input) as Promise<McpServerSummary>,
    deleteProjectMcpServer: (input: { projectID: string; serverID: string }) =>
      invokeDesktop("desktop:delete-project-mcp-server", input) as Promise<{
        serverID: string
        removed: boolean
      }>,
    updateProjectProvider: (input: {
      projectID: string
      providerID: string
      provider: {
        name?: string
        env?: string[]
        options?: {
          apiKey?: string
          baseURL?: string
        }
      }
    }) =>
      invokeDesktop("desktop:update-project-provider", input) as Promise<{
        provider: {
          id: string
          name: string
          available: boolean
          apiKeyConfigured: boolean
          baseURL?: string
        }
        selection: {
          model?: string
          small_model?: string
        }
      }>,
    deleteProjectProvider: (input: { projectID: string; providerID: string }) =>
      invokeDesktop("desktop:delete-project-provider", input) as Promise<{
        providerID: string
        selection: {
          model?: string
          small_model?: string
        }
      }>,
    updateProjectModelSelection: (input: {
      projectID: string
      model?: string | null
      small_model?: string | null
      reasoning_effort?: AgentProjectModelSelection["reasoning_effort"] | null
    }) =>
      invokeDesktop("desktop:update-project-model-selection", input) as Promise<{
        model?: string
        small_model?: string
        reasoning_effort?: AgentProjectModelSelection["reasoning_effort"]
      }>,
    updateSessionModelSelection: (input: {
      sessionID: string
      model?: string | null
      small_model?: string | null
      reasoning_effort?: AgentProjectModelSelection["reasoning_effort"] | null
    }) =>
      invokeDesktop("desktop:update-session-model-selection", input) as Promise<{
        model?: string
        small_model?: string
        reasoning_effort?: AgentProjectModelSelection["reasoning_effort"]
      }>,
    onAppUpdateStateChange: (listener: (state: DesktopAppUpdateState) => void) => {
      const wrappedListener = (_event: Electron.IpcRendererEvent, state: DesktopAppUpdateState) => {
        listener(state)
      }

      ipcRenderer.on(DESKTOP_APP_UPDATE_STATE_EVENT_CHANNEL, wrappedListener)

      return () => {
        ipcRenderer.removeListener(DESKTOP_APP_UPDATE_STATE_EVENT_CHANNEL, wrappedListener)
      }
    },
    onAutomationEvent: (listener: (event: AgentAutomationIPCEvent) => void) => {
      const wrappedListener = (_event: Electron.IpcRendererEvent, automationEvent: AgentAutomationIPCEvent) => {
        listener(automationEvent)
      }

      ipcRenderer.on(DESKTOP_AUTOMATION_EVENT_CHANNEL, wrappedListener)

      return () => {
        ipcRenderer.removeListener(DESKTOP_AUTOMATION_EVENT_CHANNEL, wrappedListener)
      }
    },
    onMobileBridgeEvent: (listener: (event: MobileBridgeDesktopEvent) => void) => {
      const wrappedListener = (_event: Electron.IpcRendererEvent, mobileEvent: MobileBridgeDesktopEvent) => {
        listener(mobileEvent)
      }

      ipcRenderer.on(DESKTOP_MOBILE_BRIDGE_EVENT_CHANNEL, wrappedListener)

      return () => {
        ipcRenderer.removeListener(DESKTOP_MOBILE_BRIDGE_EVENT_CHANNEL, wrappedListener)
      }
    },
    onWorkspaceFileChange: (listener: (event: WorkspaceFileChangeIPCEvent) => void) => {
      const wrappedListener = (_event: Electron.IpcRendererEvent, workspaceEvent: WorkspaceFileChangeIPCEvent) => {
        listener(workspaceEvent)
      }

      ipcRenderer.on(DESKTOP_WORKSPACE_FILE_CHANGE_EVENT_CHANNEL, wrappedListener)

      return () => {
        ipcRenderer.removeListener(DESKTOP_WORKSPACE_FILE_CHANGE_EVENT_CHANNEL, wrappedListener)
      }
    },
    onPtyEvent: (listener: (event: PtyIPCEvent) => void) => {
      const wrappedListener = (_event: Electron.IpcRendererEvent, ptyEvent: PtyIPCEvent) => {
        listener(ptyEvent)
      }

      ipcRenderer.on(DESKTOP_PTY_EVENT_CHANNEL, wrappedListener)

      return () => {
        ipcRenderer.removeListener(DESKTOP_PTY_EVENT_CHANNEL, wrappedListener)
      }
    },
    onWindowStateChange: (listener: (state: { isMaximized: boolean }) => void) => {
      const wrappedListener = (_event: Electron.IpcRendererEvent, state: { isMaximized: boolean }) => {
        listener(state)
      }

      ipcRenderer.on(DESKTOP_WINDOW_STATE_EVENT_CHANNEL, wrappedListener)

      return () => {
        ipcRenderer.removeListener(DESKTOP_WINDOW_STATE_EVENT_CHANNEL, wrappedListener)
      }
    },
    onWorkbenchStateChange: (listener: (event: WorkbenchStateEvent) => void) => {
      const wrappedListener = (_event: Electron.IpcRendererEvent, workbenchEvent: WorkbenchStateEvent) => {
        listener(workbenchEvent)
      }

      ipcRenderer.on(DESKTOP_WORKBENCH_STATE_EVENT_CHANNEL, wrappedListener)

      return () => {
        ipcRenderer.removeListener(DESKTOP_WORKBENCH_STATE_EVENT_CHANNEL, wrappedListener)
      }
    },
    onAppearanceStateChange: (listener: (state: AppearanceRuntimeState) => void) => {
      const wrappedListener = (
        _event: Electron.IpcRendererEvent,
        appearanceState: AppearanceRuntimeState,
      ) => {
        listener(appearanceState)
      }

      ipcRenderer.on(DESKTOP_APPEARANCE_STATE_EVENT_CHANNEL, wrappedListener)

      return () => {
        ipcRenderer.removeListener(DESKTOP_APPEARANCE_STATE_EVENT_CHANNEL, wrappedListener)
      }
    },
  } satisfies DesktopPreloadApi)
} catch (error) {
  console.error("[desktop] preload expose failed:", error)
}
