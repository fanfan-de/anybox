import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { SerializedDockview } from "dockview-react"
import { ActivityRail } from "./app/sidebar/ActivityRail"
import { BuiltinToolsPage } from "./app/tools/BuiltinToolsPage"
import { ConnectionsPage } from "./app/connections/ConnectionsPage"
import { MobileConnectionPage, type MobileConnectionPanel } from "./app/connections/MobileConnectionPage"
import { McpServersPage } from "./app/mcp/McpServersPage"
import { filterMcpInventoryServers } from "./app/mcp/mcp-server-source"
import { isAccountConnectorDefinition } from "./app/connectors/connector-presentation"
import { RightSidebar } from "./app/sidebar/RightSidebar"
import { Sidebar } from "./app/sidebar/Sidebar"
import { SidebarResizer } from "./app/sidebar/SidebarResizer"
import { NativeMacWindowControlsSlot, WindowChrome } from "./app/chrome/WindowChrome"
import { HtmlBackgroundLayer } from "./app/html-background/HtmlBackgroundLayer"
import { resolveHtmlBackgroundAppearance } from "./app/html-background/html-background-config"
import { TerminalAreaHost } from "./app/terminal/TerminalAreaHost"
import {
  useWorkspaceStoreSelector,
} from "./app/agent-workspace/workspace-store"
import { useConversationMessages, useConversationTurns } from "./app/agent-workspace/conversation-store"
import { WorkspaceStoreProvider } from "./app/agent-workspace/workspace-store-context"
import { resolveWorkspaceRelativePath } from "./app/agent-workspace/workspace-loading-hooks"
import type { MarkdownArtifactLinkTarget, MarkdownLocalFileLinkTarget } from "./app/thread-markdown"
import { ThreadLinkRoutingProvider } from "./app/thread-link-routing"
import type {
  ComposerAttachment,
  ComposerDraftState,
  ConnectionsTab,
  PendingConversationInput,
  PermissionRequest,
  ProjectWorktreeCreateRequest,
  SessionDiffFile,
  SessionDiffScope,
  SessionDiffSummary,
  SessionSummary,
  ToolPermissionMode,
  ThreadMessage,
  ThreadTurn,
  WindowAction,
  WorkspaceGroup,
} from "./app/types"
import { useAgentWorkspace } from "./app/use-agent-workspace"
import { useAppearanceState } from "./app/use-appearance-state"
import { useDesktopShell } from "./app/use-desktop-shell"
import { useGlobalSkills } from "./app/use-global-skills"
import { useSettingsPage } from "./app/use-settings-page"
import { ToastProvider, useToast } from "./app/toast"
import { createEmptyComposerDraftState } from "./app/composer/draft-state"
import type { BuiltinToolKindKey } from "./app/tools/BuiltinToolsPage"
import { findSession, isGitWorkspaceProject, isSideChatSession, sameWorkspaceDirectory } from "./app/workspace"
import { WorkbenchShell } from "./app/workbench/WorkbenchShell"
import {
  createInitialDockviewLayout,
  getActivePanelForGroupFromState,
  getFocusedDockviewGroupIDFromState,
} from "./app/workbench/dockview-state"
import {
  buildWorkbenchPublishSnapshot,
  collectSideChatSessionsByAnchorMessageID,
  createSessionWorkbenchTab,
  getWorkbenchTabKey,
  workbenchPublishSnapshotsAreEqual,
} from "./app/agent-workspace/workspace-derived-state"
import type {
  AgentAutomationIPCEvent,
  AgentEnvironmentRunRecord,
  AgentProjectWorkspace,
  DesktopAppUpdateState,
  WorkbenchSharedState,
  WorkbenchWindowContext,
} from "../../shared/desktop-ipc-contract"
import {
  checkForAppUpdates,
  getAppUpdateState,
  getRunningSessionStatus,
  installAppUpdate,
  setAutomaticUpdatesEnabled,
} from "./app/settings/client"
import { UpdateDialog, type AppUpdateStatus } from "./app/update/UpdateDialog"
import { useI18n } from "./app/i18n/I18nProvider"
import type { TranslationKey } from "./app/i18n/translations"
import { PromptSkillsPage, type PromptSkillMode } from "./app/prompts/PromptSkillsPage"
import { SkillsWorkspacePage, type SkillLibraryMode } from "./app/skills/SkillsWorkspacePage"
import {
  ENVIRONMENT_SETTINGS_SECTION_STORAGE_KEY,
  OPEN_ENVIRONMENT_SETTINGS_EVENT,
} from "./app/settings/events"

const GlobalSkillsPage = lazy(() => import("./app/skills/GlobalSkillsPage").then((module) => ({ default: module.GlobalSkillsPage })))
const ConnectorsPage = lazy(() => import("./app/connectors/ConnectorsPage").then((module) => ({ default: module.ConnectorsPage })))
const PluginsPage = lazy(() => import("./app/plugins/PluginsPage").then((module) => ({ default: module.PluginsPage })))
const PromptPresetsPage = lazy(() => import("./app/prompts/PromptPresetsPage").then((module) => ({ default: module.PromptPresetsPage })))
const AutomationsPage = lazy(() => import("./app/automations/AutomationsPage").then((module) => ({ default: module.AutomationsPage })))
const AutomationCreatePanel = lazy(() => import("./app/automations/AutomationsPage").then((module) => ({ default: module.AutomationCreatePanel })))
const CalendarPage = lazy(() => import("./app/calendar/CalendarPage").then((module) => ({ default: module.CalendarPage })))

function importSettingsPage() {
  return import("./app/settings/SettingsPage").then((module) => ({ default: module.SettingsPage }))
}

let settingsPageImportPromise: ReturnType<typeof importSettingsPage> | null = null
const UPDATE_PROMPT_RETRY_DELAY_MS = 10_000

function loadSettingsPage() {
  settingsPageImportPromise ??= importSettingsPage()
  return settingsPageImportPromise
}

const SettingsPage = lazy(loadSettingsPage)
const AppearanceSettingsPanel = lazy(() =>
  import("./app/settings/SettingsPage").then((module) => ({ default: module.AppearanceSettingsPanel })),
)

const WORKBENCH_TERMINAL_STORAGE_KEY = "desktop.terminal.workspace.v3:workbench"
const EMPTY_CONNECTION_SEARCH_QUERIES: Record<ConnectionsTab, string> = {
  plugins: "",
  connectors: "",
  mcp: "",
}
const EMPTY_SIDE_CHAT_DRAFT_STATE = createEmptyComposerDraftState()
const EMPTY_SIDE_CHAT_ATTACHMENTS: ComposerAttachment[] = []
const EMPTY_SIDE_CHAT_PENDING_INPUTS: PendingConversationInput[] = []
const EMPTY_SIDE_CHAT_PERMISSION_REQUESTS: PermissionRequest[] = []
const EMPTY_SIDE_CHAT_MESSAGES: ThreadMessage[] = []
const EMPTY_SIDE_CHAT_TURNS: ThreadTurn[] = []
const WINDOWS_DRIVE_PATH_PATTERN = /^[A-Za-z]:[\\/]/
const WINDOWS_UNC_PATH_PATTERN = /^(?:\\\\|\/\/)[^\\/]+[\\/][^\\/]+/
const URI_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/i
const URI_WITH_AUTHORITY_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//i

function getCalendarProjectFallbackName(directory: string | undefined, fallback: string) {
  const trimmed = directory?.trim()
  if (!trimmed) return fallback
  const withoutTrailingSlash = trimmed.replace(/[\\/]+$/, "")
  return withoutTrailingSlash.split(/[\\/]/).filter(Boolean).pop() || trimmed
}

function mapProjectWorkspaceToCalendarProject(project: AgentProjectWorkspace): CalendarProjectOption {
  const directory = project.repositoryRoot ?? project.worktree
  return {
    directory,
    id: project.id,
    name: project.name?.trim() || getCalendarProjectFallbackName(directory, project.id),
  }
}

function mapWorkspaceGroupToCalendarProject(workspace: WorkspaceGroup): CalendarProjectOption {
  const directory = workspace.project.repositoryRoot ?? workspace.project.worktree ?? workspace.directory
  return {
    directory,
    id: workspace.project.id,
    name: workspace.project.name.trim() || workspace.name,
  }
}

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
  turns: ThreadTurn[]
  workspaceDirectory: string | null
  workspaceID: string | null
}

interface CalendarProjectOption {
  directory?: string
  id: string
  name: string
}

function rightSidebarSideChatPanelStatesAreEqual(
  left: RightSidebarSideChatPanelState | null,
  right: RightSidebarSideChatPanelState | null,
) {
  if (left === right) return true
  if (!left || !right) return false

  return (
    left.activeProjectID === right.activeProjectID &&
    left.activeTabID === right.activeTabID &&
    left.anchorMessageID === right.anchorMessageID &&
    left.attachments === right.attachments &&
    left.draftState === right.draftState &&
    left.isCancelling === right.isCancelling &&
    left.isInterruptible === right.isInterruptible &&
    left.isSending === right.isSending &&
    left.parentSessionID === right.parentSessionID &&
    left.pendingInputs === right.pendingInputs &&
    left.pendingPermissionRequests === right.pendingPermissionRequests &&
    left.session === right.session &&
    left.sideChatSessions.length === right.sideChatSessions.length &&
    left.sideChatSessions.every((session, index) => session === right.sideChatSessions[index]) &&
    left.tabKey === right.tabKey &&
    left.messages === right.messages &&
    left.turns === right.turns &&
    left.workspaceDirectory === right.workspaceDirectory &&
    left.workspaceID === right.workspaceID
  )
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function environmentRunIsComplete(run: AgentEnvironmentRunRecord) {
  return !["queued", "running"].includes(run.status)
}

async function waitForEnvironmentRun(run: AgentEnvironmentRunRecord) {
  let current = run
  while (!environmentRunIsComplete(current)) {
    await new Promise<void>((resolve) => window.setTimeout(resolve, 500))
    const getRun = window.desktop?.getEnvironmentRun
    if (!getRun) throw new Error("环境运行状态服务不可用。")
    current = await getRun({ runID: current.id })
  }
  return current
}

function readObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readOptionalString(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function readAutomationSessionRefreshTarget(event: AgentAutomationIPCEvent) {
  if (event.event === "automation.session.created") {
    const data = readObject(event.data)
    const sessionID = readOptionalString(data?.sessionID)
    const directory = readOptionalString(data?.directory)
    return sessionID && directory ? { sessionID, directory } : null
  }

  const data = readObject(event.data)
  const run = readObject(data?.run)
  const sessionID = readOptionalString(run?.sessionID)
  const directory = readOptionalString(run?.directory)
  return sessionID && directory ? { sessionID, directory } : null
}

function getManualUpdateCheckStatusText(
  result: Awaited<ReturnType<typeof checkForAppUpdates>> | null,
  translate: (key: TranslationKey, params?: Record<string, string | number>) => string,
) {
  if (!result) return translate("updates.status.manualRequested")
  if (!result.ok) {
    return result.error
      ? translate("updates.status.checkFailedWithMessage", { message: result.error })
      : translate("updates.status.checkFailed")
  }
  if (result.reason === "not-packaged") return translate("updates.status.notPackaged")
  if (result.reason === "already-checking") return translate("updates.status.alreadyChecking")
  return translate("updates.status.checkStarted")
}

function createFallbackAppUpdateState(enabled: boolean, version = "Unknown"): DesktopAppUpdateState {
  return {
    phase: "idle",
    version,
    automaticUpdates: enabled,
    updateChecksSupported: false,
    latestVersion: null,
    downloadPercent: null,
    downloadTransferredBytes: null,
    downloadTotalBytes: null,
    downloadBytesPerSecond: null,
    error: null,
    lastCheckedAt: null,
    releaseNotes: null,
  }
}

async function hasRunningSessionBlockingAppUpdate(localRunningSessionIDs: string[]) {
  if (localRunningSessionIDs.length > 0) return true

  try {
    const status = await getRunningSessionStatus()
    return status?.running === true
  } catch (error) {
    console.warn("[desktop] running session status check failed; deferring update prompt", error)
    return true
  }
}

interface LocalFileLinkOpenInput {
  paneID: string
  sessionID: string | null
  target: MarkdownLocalFileLinkTarget
  workspaceDirectory: string | null
  workspaceID: string | null
}

interface ArtifactLinkOpenInput {
  paneID: string
  sessionID: string | null
  target: MarkdownArtifactLinkTarget
  workspaceDirectory: string | null
  workspaceID: string | null
}

function encodeFilePathSegment(value: string) {
  return encodeURIComponent(value).replace(/%3A/i, ":")
}

function toFileUrl(targetPath: string) {
  const trimmedPath = targetPath.trim()
  if (!trimmedPath) return null
  if (trimmedPath.toLowerCase().startsWith("file://")) return trimmedPath

  const normalizedPath = trimmedPath.replace(/\\/g, "/")
  const uncMatch = normalizedPath.match(/^\/\/([^/]+)\/(.+)$/)
  if (uncMatch) {
    const encodedPath = uncMatch[2].split("/").map(encodeFilePathSegment).join("/")
    return `file://${uncMatch[1]}/${encodedPath}`
  }

  if (/^[A-Za-z]:\//.test(normalizedPath)) {
    const encodedPath = normalizedPath.split("/").map(encodeFilePathSegment).join("/")
    return `file:///${encodedPath}`
  }

  if (normalizedPath.startsWith("/")) {
    const encodedPath = normalizedPath.split("/").map(encodeFilePathSegment).join("/")
    return `file://${encodedPath}`
  }

  return null
}

function uniqueNonEmptyPaths(paths: string[]) {
  const seen = new Set<string>()
  const uniquePaths: string[] = []

  for (const path of paths) {
    const trimmedPath = path.trim()
    if (!trimmedPath || seen.has(trimmedPath)) continue
    seen.add(trimmedPath)
    uniquePaths.push(trimmedPath)
  }

  return uniquePaths
}

async function openSystemLocalPath(targetPath: string, fallbackTargetPaths: string[] = []) {
  const targetPaths = uniqueNonEmptyPaths([targetPath, ...fallbackTargetPaths])
  const openPath = window.desktop?.openPath
  if (openPath) {
    for (const candidatePath of targetPaths) {
      try {
        await openPath({ targetPath: candidatePath })
        return
      } catch (error) {
        console.error("[desktop] Failed to open local file path:", error)
      }
    }
  }

  const openExternalUrl = window.desktop?.openExternalUrl
  if (!openExternalUrl) return

  for (const candidatePath of targetPaths) {
    const fileUrl = toFileUrl(candidatePath)
    if (!fileUrl) continue

    try {
      await openExternalUrl({ url: fileUrl })
      return
    } catch (error) {
      console.error("[desktop] Failed to open local file URL:", error)
    }
  }
}

function isMarkdownDocumentPath(path: string) {
  return /\.(?:md|markdown)$/i.test(path.trim())
}

function isRemoteWorkspaceDirectory(directory: string | null | undefined) {
  const trimmedDirectory = directory?.trim() ?? ""
  return URI_WITH_AUTHORITY_PATTERN.test(trimmedDirectory) && !WINDOWS_DRIVE_PATH_PATTERN.test(trimmedDirectory)
}

function isLocalAbsolutePathForPlatform(targetPath: string, platform: string) {
  const trimmedPath = targetPath.trim()
  if (!trimmedPath) return false
  if (WINDOWS_DRIVE_PATH_PATTERN.test(trimmedPath) || WINDOWS_UNC_PATH_PATTERN.test(trimmedPath)) return true
  if (platform === "win32" && /^[\\/]+[A-Za-z]:[\\/]/.test(trimmedPath)) return true
  return platform !== "win32" && trimmedPath.startsWith("/")
}

function normalizeLocalFileLinkPathForPlatform(targetPath: string, platform: string) {
  const trimmedPath = targetPath.trim()
  if (platform === "win32") {
    return trimmedPath.replace(/^[\\/]+([A-Za-z]:[\\/])/, "$1")
  }
  return trimmedPath
}

function normalizeWorkspaceRelativeLinkPath(targetPath: string, platform: string) {
  const trimmedPath = normalizeLocalFileLinkPathForPlatform(targetPath, platform)
  if (!trimmedPath) return null
  if (isLocalAbsolutePathForPlatform(trimmedPath, platform)) return null
  if (URI_SCHEME_PATTERN.test(trimmedPath) && !WINDOWS_DRIVE_PATH_PATTERN.test(trimmedPath)) return null

  const normalizedTarget = trimmedPath.replace(/^[\\/]+/, "").replace(/\\/g, "/")
  const resolvedSegments: string[] = []

  for (const segment of normalizedTarget.split("/")) {
    if (!segment || segment === ".") continue
    if (segment === "..") {
      if (resolvedSegments.length === 0) return null
      resolvedSegments.pop()
      continue
    }
    resolvedSegments.push(segment)
  }

  return resolvedSegments.join("/")
}

function joinLocalWorkspacePath(workspaceDirectory: string, workspaceRelativePath: string) {
  const trimmedWorkspaceDirectory = workspaceDirectory.trim().replace(/[\\/]+$/, "")
  const separator = trimmedWorkspaceDirectory.includes("\\") ? "\\" : "/"
  const relativeSegments = workspaceRelativePath.split("/").filter(Boolean)
  if (relativeSegments.length === 0) return trimmedWorkspaceDirectory
  return `${trimmedWorkspaceDirectory}${separator}${relativeSegments.join(separator)}`
}

function resolveLocalFileLinkWorkspacePath(
  workspaceDirectory: string | null,
  targetPath: string,
  platform: string,
) {
  if (!workspaceDirectory || isRemoteWorkspaceDirectory(workspaceDirectory)) return null

  const normalizedTargetPath = normalizeLocalFileLinkPathForPlatform(targetPath, platform)
  const workspaceRelativePath = resolveWorkspaceRelativePath(workspaceDirectory, normalizedTargetPath, platform)
  if (workspaceRelativePath !== null) {
    return {
      absolutePath: normalizedTargetPath,
      relativePath: workspaceRelativePath,
    }
  }

  const relativePath = normalizeWorkspaceRelativeLinkPath(normalizedTargetPath, platform)
  if (relativePath === null) return null

  return {
    absolutePath: joinLocalWorkspacePath(workspaceDirectory, relativePath),
    relativePath,
  }
}

const FALLBACK_WORKBENCH_STATE: WorkbenchSharedState = {
  version: 0,
  windows: [
    {
      id: "main",
      kind: "main",
      ownedPanelIDs: [],
      surfaceID: "main",
    },
  ],
  surfaces: [
    {
      surfaceID: "main",
      kind: "main",
      windowID: "main",
      ownedPanelIDs: [],
      layout: null,
    },
  ],
  ownership: [],
  panels: {},
}

const FALLBACK_WORKBENCH_CONTEXT: WorkbenchWindowContext = {
  windowID: "main",
  kind: "main",
  surfaceID: "main",
  ownedPanelIDs: [],
  reference: null,
  state: FALLBACK_WORKBENCH_STATE,
}

function hasExplicitWorkbenchWindowID() {
  if (typeof window === "undefined") return false
  return new URLSearchParams(window.location.search).has("workbenchWindowID")
}

function getAppWindowMode() {
  if (typeof window === "undefined") return null
  return new URLSearchParams(window.location.search).get("appWindow")
}

function areStringArraysEqual(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function areWorkbenchReferencesEqual(
  left: WorkbenchWindowContext["reference"],
  right: WorkbenchWindowContext["reference"],
) {
  if (!left || !right) return left === right
  return left.kind === right.kind && left.sessionID === right.sessionID
}

function getWorkbenchSurfaceID(context: WorkbenchWindowContext) {
  return context.surfaceID ?? (context.kind === "main" ? "main" : context.windowID)
}

function getContextSurfaceLayout(context: WorkbenchWindowContext) {
  const surfaceID = getWorkbenchSurfaceID(context)
  return (context.state.surfaces?.find((surface) => surface.surfaceID === surfaceID)?.layout ?? null) as SerializedDockview | null
}

function getContextPanelTitle(context: WorkbenchWindowContext, panelID: string | null | undefined) {
  if (!panelID) return undefined
  return (
    context.state.ownership.find((ownership) => ownership.panelID === panelID)?.title ??
    context.state.panels[panelID]?.title
  )
}

function getWorkbenchPanelOwnershipSurfaceID(ownership: WorkbenchSharedState["ownership"][number]) {
  return ownership.ownerSurfaceID ?? ownership.ownerWindowID
}

function createFallbackPopoutLayout(context: WorkbenchWindowContext) {
  const sessionID = context.reference?.sessionID
  if (!sessionID) return null
  return createInitialDockviewLayout(
    {
      kind: "session",
      sessionID,
    },
    getContextPanelTitle(context, context.panelID) ?? "Session",
  )
}

function getWorkbenchPublishSignature(snapshot: WorkbenchSharedState) {
  const { version: _version, ...content } = snapshot
  return JSON.stringify(content)
}

function useToolPermissionModeState() {
  const [toolPermissionMode, setToolPermissionMode] = useState<ToolPermissionMode>("default")
  const [toolPermissionModeError, setToolPermissionModeError] = useState<string | null>(null)
  const [isSavingToolPermissionMode, setIsSavingToolPermissionMode] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function loadToolPermissionMode() {
      try {
        const result = await window.desktop?.getToolPermissionMode?.()
        if (cancelled || !result) return
        setToolPermissionMode(result.mode)
        setToolPermissionModeError(null)
      } catch (error) {
        if (cancelled) return
        setToolPermissionModeError(getErrorMessage(error))
      }
    }

    void loadToolPermissionMode()

    return () => {
      cancelled = true
    }
  }, [])

  async function handleToolPermissionModeChange(mode: ToolPermissionMode) {
    if (mode === toolPermissionMode || isSavingToolPermissionMode) return
    const previousMode = toolPermissionMode

    setToolPermissionMode(mode)
    setToolPermissionModeError(null)
    setIsSavingToolPermissionMode(true)

    try {
      const result = await window.desktop?.updateToolPermissionMode?.({ mode })
      setToolPermissionMode(result?.mode ?? mode)
    } catch (error) {
      setToolPermissionMode(previousMode)
      setToolPermissionModeError(getErrorMessage(error))
    } finally {
      setIsSavingToolPermissionMode(false)
    }
  }

  return {
    handleToolPermissionModeChange,
    isSavingToolPermissionMode,
    toolPermissionMode,
    toolPermissionModeError,
  }
}

function AppContent() {
  if (getAppWindowMode() === "appearance") {
    return <AppearanceWindowApp />
  }

  const [workbenchContext, setWorkbenchContext] = useState<WorkbenchWindowContext | null>(() =>
    hasExplicitWorkbenchWindowID() ? null : FALLBACK_WORKBENCH_CONTEXT,
  )

  useEffect(() => {
    let cancelled = false

    async function loadWorkbenchContext() {
      const getContext = window.desktop?.getWorkbenchWindowContext
      if (!getContext) {
        setWorkbenchContext(FALLBACK_WORKBENCH_CONTEXT)
        return
      }

      try {
        const context = await getContext()
        if (!cancelled) {
          setWorkbenchContext(context)
        }
      } catch (error) {
        console.error("[desktop] Failed to load workbench window context:", error)
        if (!cancelled) {
          setWorkbenchContext(FALLBACK_WORKBENCH_CONTEXT)
        }
      }
    }

    void loadWorkbenchContext()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const unsubscribe = window.desktop?.onWorkbenchStateChange?.((event) => {
      setWorkbenchContext((current) => {
        if (!current) return current
        const windowSummary = event.state.windows.find((item) => item.id === current.windowID)
        const surfaceID = windowSummary?.surfaceID ?? current.surfaceID ?? (current.kind === "main" ? "main" : undefined)
        const surface = event.state.surfaces?.find((item) => item.surfaceID === surfaceID)
        const ownedPanelIDs = surface?.ownedPanelIDs ?? windowSummary?.ownedPanelIDs ?? current.ownedPanelIDs
        const panelID = current.panelID && ownedPanelIDs.includes(current.panelID)
          ? current.panelID
          : ownedPanelIDs[0] ?? current.panelID
        const ownership = panelID
          ? event.state.ownership.find((item) => item.panelID === panelID) ?? null
          : null
        const reference = ownership?.reference ?? current.reference ?? null

        if (
          event.reason === "snapshot" &&
          current.surfaceID === surfaceID &&
          current.panelID === panelID &&
          areStringArraysEqual(current.ownedPanelIDs, ownedPanelIDs) &&
          areWorkbenchReferencesEqual(current.reference, reference)
        ) {
          return current
        }

        return {
          ...current,
          ownedPanelIDs,
          panelID,
          reference,
          state: event.state,
          surfaceID,
        }
      })
    })

    return unsubscribe
  }, [])

  if (!workbenchContext) {
    return <div className="app-loading-screen" />
  }

  if (workbenchContext.kind === "session-popout") {
    return <SessionPopoutApp workbenchContext={workbenchContext} />
  }

  return <MainApp workbenchContext={workbenchContext} />
}

function useStandaloneWindowControls() {
  const [isWindowMaximized, setIsWindowMaximized] = useState(false)

  useEffect(() => {
    let mounted = true

    window.desktop
      ?.getWindowState?.()
      .then((state) => {
        if (mounted) setIsWindowMaximized(state.isMaximized)
      })
      .catch(() => undefined)

    const unsubscribe = window.desktop?.onWindowStateChange?.((state) => {
      if (mounted) setIsWindowMaximized(state.isMaximized)
    })

    return () => {
      mounted = false
      unsubscribe?.()
    }
  }, [])

  const handleWindowAction = useCallback((action: WindowAction) => {
    if (!window.desktop?.windowAction) {
      console.warn("[desktop] windowAction is unavailable. preload may not be loaded.")
      return
    }

    void window.desktop.windowAction(action).catch((error) => {
      console.error("[desktop] windowAction failed:", error)
    })
  }, [])

  return { handleWindowAction, isWindowMaximized }
}

function AppearanceWindowApp() {
  const {
    appearanceConfigError,
    appearanceConfigPath,
    appearanceConfigPreview,
    appearanceOverrides,
    appearanceThemeError,
    appearanceThemes,
    activeAppearanceThemeID,
    appearanceTokenValues,
    colorMode,
    fontFamily,
    handleAppearancePaletteReset,
    handleAppearanceThemeApply,
    handleAppearanceThemeDelete,
    handleAppearanceThemeDuplicate,
    handleAppearanceThemeRename,
    handleAppearanceThemeSaveCurrent,
    handleAppearanceTokenChange,
    handleAppearanceTokenReset,
    handleColorModeChange,
    handleFontFamilyChange,
    handleHtmlBackgroundConfigChange,
    htmlBackgroundConfig,
  } = useAppearanceState()
  const { handleWindowAction, isWindowMaximized } = useStandaloneWindowControls()
  const platform = typeof window === "undefined" ? "Desktop" : window.desktop?.platform ?? "Desktop"
  const isWindows = platform === "win32"
  const htmlBackgroundAppearance = resolveHtmlBackgroundAppearance(htmlBackgroundConfig)
  const hasHtmlBackground = htmlBackgroundAppearance.hasHtmlBackground
  const windowShellClassName = [
    "window-shell",
    "appearance-window-shell",
    hasHtmlBackground ? "has-html-background" : "",
    isWindows ? "is-windows" : "",
  ].filter(Boolean).join(" ")
  return (
    <div
      className={windowShellClassName}
      data-background-mode={htmlBackgroundAppearance.backgroundMode}
    >
      <HtmlBackgroundLayer config={htmlBackgroundConfig} />
      <main className="appearance-window-app-shell">
        <header className="appearance-window-header">
          <div className="appearance-window-title">
            <span className="label">Appearance</span>
            <strong>Theme Monitor</strong>
          </div>
          <WindowChrome controlsRef={null} isWindowMaximized={isWindowMaximized} onWindowAction={handleWindowAction} />
        </header>
        <section className="settings-page-main appearance-window-main" aria-label="Theme Monitor">
          <Suspense fallback={null}>
            <AppearanceSettingsPanel
              appearanceConfigError={appearanceConfigError}
              appearanceConfigPath={appearanceConfigPath}
              appearanceConfigPreview={appearanceConfigPreview}
              appearanceOverrides={appearanceOverrides}
              appearanceThemeError={appearanceThemeError}
              appearanceThemes={appearanceThemes}
              activeAppearanceThemeID={activeAppearanceThemeID}
              appearanceTokenValues={appearanceTokenValues}
              colorMode={colorMode}
              fontFamily={fontFamily}
              htmlBackgroundConfig={htmlBackgroundConfig}
              onAppearancePaletteReset={handleAppearancePaletteReset}
              onAppearanceThemeApply={handleAppearanceThemeApply}
              onAppearanceThemeDelete={handleAppearanceThemeDelete}
              onAppearanceThemeDuplicate={handleAppearanceThemeDuplicate}
              onAppearanceThemeRename={handleAppearanceThemeRename}
              onAppearanceThemeSaveCurrent={handleAppearanceThemeSaveCurrent}
              onAppearanceTokenChange={handleAppearanceTokenChange}
              onAppearanceTokenReset={handleAppearanceTokenReset}
              onColorModeChange={handleColorModeChange}
              onFontFamilyChange={handleFontFamilyChange}
              onHtmlBackgroundConfigChange={handleHtmlBackgroundConfigChange}
            />
          </Suspense>
        </section>
      </main>
    </div>
  )
}

function SessionPopoutApp({ workbenchContext }: { workbenchContext: WorkbenchWindowContext }) {
  const targetSessionID = workbenchContext.reference?.sessionID ?? null
  const surfaceID = getWorkbenchSurfaceID(workbenchContext)
  const initialDockviewLayout = getContextSurfaceLayout(workbenchContext) ?? createFallbackPopoutLayout(workbenchContext)
  const {
    agentConnected,
    agentDefaultDirectory,
    appShellRef,
    appShellStyle,
    assistantTraceVisibility,
    handleWindowAction,
    isAgentDebugTraceEnabled,
    isWindowMaximized,
    platform,
    resolvedCodeTheme,
  } = useDesktopShell()
  const {
    composerCommandStatusByTabKey,
    composerRefreshVersion,
    handleApproveProposedPlan,
    handleCancelSend,
    handleCanvasSessionTabClose,
    handleCanvasSessionTabSelect,
    handleCreateSessionSubmit,
    handleCreateSessionWorkspaceChange,
    handleClearComposerParentMessage,
    handleDockviewActiveChange,
    handleForkFromMessage,
    handleMovePanelIntoSurface,
    handleMovePanelOutOfSurface,
    handlePaneFocus,
    handlePermissionRequestResponse,
    handleAskUserQuestionAnswer,
    handlePickComposerAttachments,
    handlePasteComposerImageAttachments,
    handleRemoveComposerAttachment,
    handleSend,
    handlePlanModeToggle,
    handleSessionBranchSelect,
    handleSessionModelSelectionChange,
    handleMessageDiffSummaryHydrate,
    isResolvingPermissionRequest,
    permissionRequestActionError,
    permissionRequestActionRequestID,
    readThreadScrollSnapshot,
    setDraftForTab,
    saveThreadScrollSnapshot,
    threadNavigationRequestBySession,
    handleWorkbenchDockviewCommandsReady,
    setDockviewLayout,
    dockviewLayout,
    workspaceStore,
  } = useAgentWorkspace({
    agentConnected,
    agentDefaultDirectory,
    disableDockviewPersistence: true,
    initialDockviewLayout,
    initialSessionID: targetSessionID,
    isRuntimeDebugEnabled: isAgentDebugTraceEnabled,
    platform,
    surfaceID,
    workbenchState: workbenchContext.state,
  })
  const workbenchPublishSnapshot = useWorkspaceStoreSelector(
    workspaceStore,
    (state) => buildWorkbenchPublishSnapshot({
      createSessionTabs: state.sessions.createSessionTabs,
      dockviewLayout: state.workbench.dockviewLayout,
      workspaces: state.sessions.workspaces,
    }),
    workbenchPublishSnapshotsAreEqual,
  )
  const {
    handleToolPermissionModeChange,
    isSavingToolPermissionMode,
    toolPermissionMode,
    toolPermissionModeError,
  } = useToolPermissionModeState()
  const didMarkMountedRef = useRef(false)
  const lastPublishedWorkbenchSnapshotSignatureRef = useRef<string | null>(null)
  const isMacOS = platform === "darwin"
  const isWindows = platform === "win32"
  const windowControls = useMemo(
    () => (
      isMacOS
        ? <NativeMacWindowControlsSlot controlsRef={null} />
        : <WindowChrome controlsRef={null} isWindowMaximized={isWindowMaximized} onWindowAction={handleWindowAction} />
    ),
    [handleWindowAction, isMacOS, isWindowMaximized],
  )
  const sessionPopoutShellClassName = [
    "session-popout-shell",
    isMacOS ? "is-macos" : "",
    isWindows ? "is-windows" : "",
  ].filter(Boolean).join(" ")

  async function handleDetachSessionPanel(input: {
    bounds: { height: number; width: number; x: number; y: number }
    groupID: string
    panelID: string
    reference: { kind: "session"; sessionID: string }
    title: string
  }) {
    const detachSessionPanel = window.desktop?.detachSessionPanel
    if (!detachSessionPanel) return false

    const result = await detachSessionPanel({
      bounds: input.bounds,
      lastMainGroupID: input.groupID,
      panelID: input.panelID,
      sessionID: input.reference.sessionID,
      sourceSurfaceID: surfaceID,
      title: input.title,
    })
    return result.ok
  }

  async function handleMoveSessionPanel(input: {
    panelID: string
    placement: "within" | "left" | "right" | "top" | "bottom"
    sourceSurfaceID: string
    targetGroupID?: string | null
    targetSurfaceID: string
  }) {
    const result = await window.desktop?.moveWorkbenchPanel?.(input)
    return Boolean(result?.ok)
  }

  useEffect(() => {
    void window.desktop?.markWorkbenchWindowReady?.({ windowID: workbenchContext.windowID })
  }, [workbenchContext.windowID])

  useEffect(() => {
    const panelID = workbenchContext.panelID
    if (!panelID || didMarkMountedRef.current) return
    const hasPanel = workbenchPublishSnapshot.ownedPanelIDs.includes(panelID)
    if (!hasPanel) return
    didMarkMountedRef.current = true
    void window.desktop?.markWorkbenchPanelMounted?.({
      panelID,
      windowID: workbenchContext.windowID,
    }).catch((error) => {
      didMarkMountedRef.current = false
      console.error("[desktop] Failed to mark session popout mounted:", error)
    })
  }, [didMarkMountedRef, workbenchContext.panelID, workbenchContext.windowID, workbenchPublishSnapshot.ownedPanelIDs])

  const handleDockBack = (preferredPanelID?: string) => {
    const panelID = preferredPanelID ?? workbenchContext.panelID
    if (!panelID) return
    void window.desktop?.moveWorkbenchPanel?.({
      panelID,
      sourceSurfaceID: surfaceID,
      targetSurfaceID: "main",
    })
  }

  useEffect(() => {
    const publishWorkbenchSnapshot = window.desktop?.publishWorkbenchSnapshot
    if (!publishWorkbenchSnapshot) return
    const snapshot: WorkbenchSharedState = {
      version: 0,
      windows: [],
      surfaces: [
        {
          surfaceID,
          kind: "session-popout",
          windowID: workbenchContext.windowID,
          ownedPanelIDs: workbenchPublishSnapshot.ownedPanelIDs,
          layout: dockviewLayout,
        },
      ],
      ownership: [],
      panels: workbenchPublishSnapshot.panels,
    }
    const signature = getWorkbenchPublishSignature(snapshot)
    if (signature === lastPublishedWorkbenchSnapshotSignatureRef.current) return
    lastPublishedWorkbenchSnapshotSignatureRef.current = signature

    void publishWorkbenchSnapshot(snapshot).catch((error) => {
      if (lastPublishedWorkbenchSnapshotSignatureRef.current === signature) {
        lastPublishedWorkbenchSnapshotSignatureRef.current = null
      }
      console.error("[desktop] Failed to publish workbench popout snapshot:", error)
    })
  }, [dockviewLayout, surfaceID, workbenchContext.windowID, workbenchPublishSnapshot])

  useEffect(() => {
    const unsubscribe = window.desktop?.onWorkbenchStateChange?.((event) => {
      if (event.reason === "focus" && event.panelID) {
        const ownership = event.state.ownership.find((item) => item.panelID === event.panelID)
        if (ownership && getWorkbenchPanelOwnershipSurfaceID(ownership) === surfaceID) {
          handleCanvasSessionTabSelect(ownership.reference.sessionID)
        }
        return
      }

      const move = event.move
      if (!move) return
      if (move.targetSurfaceID === surfaceID) {
        handleMovePanelIntoSurface({
          panelID: move.panelID,
          placement: move.placement,
          targetGroupID: move.targetGroupID,
          title: move.title,
        })
      }
      if (move.sourceSurfaceID === surfaceID) {
        handleMovePanelOutOfSurface(move.panelID)
      }
    })

    return unsubscribe
  }, [handleCanvasSessionTabSelect, handleMovePanelIntoSurface, handleMovePanelOutOfSurface, surfaceID])

  const handleLocalFileLinkOpen = ({ target }: LocalFileLinkOpenInput) => {
    void openSystemLocalPath(target.path)
  }

  const handleArtifactLinkOpen = (_input: ArtifactLinkOpenInput) => {
    // Artifact preview is hosted by the main window right sidebar in v1.
  }

  const handlePopoutDiffNoop = async () => {
    // Diff review and restore are routed through the main window sidebars in v1.
  }

  return (
    <WorkspaceStoreProvider store={workspaceStore}>
      <div className={sessionPopoutShellClassName}>
        <main ref={appShellRef} className="session-popout-app" style={appShellStyle}>
          <WorkbenchShell
            assistantTraceVisibility={assistantTraceVisibility}
            codeTheme={resolvedCodeTheme}
            composerCommandStatusByTabKey={composerCommandStatusByTabKey}
            composerRefreshVersion={composerRefreshVersion}
            isActivityRailVisible={false}
            isDetachedWindow
            isResolvingPermissionRequest={isResolvingPermissionRequest}
            isRightSidebarCollapsed
            isSavingToolPermissionMode={isSavingToolPermissionMode}
            isSidebarCollapsed
            platform={platform}
            store={workspaceStore}
            windowControls={windowControls}
            readThreadScrollSnapshot={readThreadScrollSnapshot}
            saveThreadScrollSnapshot={saveThreadScrollSnapshot}
            threadNavigationRequestBySession={threadNavigationRequestBySession}
            permissionRequestActionError={permissionRequestActionError}
            permissionRequestActionRequestID={permissionRequestActionRequestID}
            toolPermissionMode={toolPermissionMode}
            toolPermissionModeError={toolPermissionModeError}
            surfaceID={surfaceID}
            onActiveDockviewChange={handleDockviewActiveChange}
            onApproveProposedPlan={handleApproveProposedPlan}
            onAskUserQuestionAnswer={handleAskUserQuestionAnswer}
            onCancelSend={handleCancelSend}
            onCloseCreateSessionTab={handleDockBack}
            onCloseSessionTab={handleCanvasSessionTabClose}
            onCommandsReady={handleWorkbenchDockviewCommandsReady}
            onCreateSessionSubmit={handleCreateSessionSubmit}
            onCreateSessionWorkspaceChange={handleCreateSessionWorkspaceChange}
            onOpenProjectFolder={() => undefined}
            onBranchSelect={handleSessionBranchSelect}
            onClearComposerParentMessage={handleClearComposerParentMessage}
            onDetachSessionPanel={handleDetachSessionPanel}
            onDockBack={handleDockBack}
            onFocusPane={handlePaneFocus}
            onForkFromMessage={handleForkFromMessage}
            onInspectFileInSidebar={() => undefined}
            onLayoutChange={setDockviewLayout}
            onArtifactLinkOpen={handleArtifactLinkOpen}
            onLocalFileLinkOpen={handleLocalFileLinkOpen}
            onMoveSessionPanel={handleMoveSessionPanel}
            onOpenCreateSessionTab={() => undefined}
            onPasteComposerImageAttachments={handlePasteComposerImageAttachments}
            onPermissionRequestResponse={handlePermissionRequestResponse}
            onPickComposerAttachments={handlePickComposerAttachments}
            onPlanModeToggle={handlePlanModeToggle}
            onRemoveComposerAttachment={handleRemoveComposerAttachment}
            onSelectCreateSessionTab={() => undefined}
            onSelectSessionTab={handleCanvasSessionTabSelect}
            onSend={handleSend}
            onSessionModelSelectionChange={handleSessionModelSelectionChange}
            onSetDraft={setDraftForTab}
            onToggleLeftSidebar={() => undefined}
            onToggleRightSidebar={() => undefined}
            onToolPermissionModeChange={handleToolPermissionModeChange}
            onMessageDiffRestore={handlePopoutDiffNoop}
            onMessageDiffReview={handlePopoutDiffNoop}
            onMessageDiffSummaryHydrate={handleMessageDiffSummaryHydrate}
          />
        </main>
      </div>
    </WorkspaceStoreProvider>
  )
}

export function App() {
  return (
    <ToastProvider>
      <AppContent />
    </ToastProvider>
  )
}

function MainApp({ workbenchContext }: { workbenchContext: WorkbenchWindowContext }) {
  const { t } = useI18n()
  const surfaceID = getWorkbenchSurfaceID(workbenchContext)
  const [appUpdateState, setAppUpdateState] = useState<DesktopAppUpdateState | null>(null)
  const [appUpdateStatus, setAppUpdateStatus] = useState<AppUpdateStatus | null>(null)
  const [isUpdateDialogOpen, setIsUpdateDialogOpen] = useState(false)
  const [isCheckingAppUpdate, setIsCheckingAppUpdate] = useState(false)
  const [isInstallingAppUpdate, setIsInstallingAppUpdate] = useState(false)
  const [isSavingAutomaticUpdates, setIsSavingAutomaticUpdates] = useState(false)
  const [isPreparingSettingsPage, setIsPreparingSettingsPage] = useState(false)
  const [promptSkillMode, setPromptSkillMode] = useState<PromptSkillMode>("prompts")
  const [skillLibraryMode, setSkillLibraryMode] = useState<SkillLibraryMode>("all")
  const [isSkillMarketplaceOpen, setIsSkillMarketplaceOpen] = useState(false)
  const [automationCreateProjectID, setAutomationCreateProjectID] = useState<string | null>(null)
  const autoPromptedDownloadingUpdateRef = useRef<string | null>(null)
  const autoPromptedDownloadedUpdateRef = useRef<string | null>(null)
  const updatePromptRetryTimerRef = useRef<number | null>(null)
  const [updatePromptRetryTick, setUpdatePromptRetryTick] = useState(0)
  const [creatingWorktreeProjectID, setCreatingWorktreeProjectID] = useState<string | null>(null)
  const creatingWorktreeProjectIDRef = useRef<string | null>(null)
  const toast = useToast()

  useEffect(() => {
    const preloadTimer = window.setTimeout(() => {
      void loadSettingsPage()
    }, 0)

    return () => window.clearTimeout(preloadTimer)
  }, [])

  const {
    agentConnected,
    agentDefaultDirectory,
    appearanceConfigError,
    appearanceConfigPath,
    appearanceConfigPreview,
    appearanceOverrides,
    appearanceThemeError,
    appearanceThemes,
    activeAppearanceThemeID,
    appearanceTokenValues,
    assistantTraceVisibility,
    appShellRef,
    appShellStyle,
    brandTheme,
    fontFamily,
    handleActivityRailVisibilityChange,
    handleAppearancePaletteReset,
    handleAppearanceThemeApply,
    handleAppearanceThemeDelete,
    handleAppearanceThemeDuplicate,
    handleAppearanceThemeRename,
    handleAppearanceThemeSaveCurrent,
    handleAppearanceTokenChange,
    handleAppearanceTokenReset,
    handleAssistantTraceVisibilityChange,
    handleAgentDebugTraceChange,
    handleDebugLineColorsChange,
    handleDebugUiRegionsChange,
    handleMobileConnectionAdvancedInfoChange,
    handleRightSidebarResizerKeyDown,
    handleRightSidebarResizerPointerDown,
    handleRightSidebarToggle,
    handleSidebarResizerKeyDown,
    handleSidebarResizerPointerDown,
    handleSidebarToggle,
    handleWindowAction,
    colorMode,
    handleColorModeChange,
    handleFontFamilyChange,
    handleHtmlBackgroundConfigChange,
    htmlBackgroundConfig,
    isActivityRailVisible,
    isAgentDebugTraceEnabled,
    isDebugLineColorsEnabled,
    isDebugUiRegionsEnabled,
    isMobileConnectionAdvancedInfoEnabled,
    isRightSidebarCollapsed,
    isRightSidebarResizing,
    isSidebarCollapsed,
    isSidebarResizing,
    isWindowMaximized,
    platform,
    rightSidebarWidthBounds,
    rightSidebarWidth,
    resolvedCodeTheme,
    sidebarWidthBounds,
    sidebarWidth,
    windowControlsRef,
  } = useDesktopShell()

  useEffect(() => {
    let disposed = false

    void getAppUpdateState()
      .then((state) => {
        if (disposed || !state) return
        setAppUpdateState(state)
      })
      .catch((error: unknown) => {
        if (disposed) return
        const message = getErrorMessage(error)
        setAppUpdateStatus({
          tone: "error",
          text: t("updates.status.loadSettingsFailed", { message }),
        })
      })

    const unsubscribe = window.desktop?.onAppUpdateStateChange?.((state) => {
      if (!disposed) {
        setAppUpdateState(state)
      }
    })

    return () => {
      disposed = true
      unsubscribe?.()
    }
  }, [t])

  useEffect(() => {
    if (!isUpdateDialogOpen) return

    function handleUpdateDialogKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return

      event.preventDefault()
      event.stopPropagation()
      setIsUpdateDialogOpen(false)
    }

    window.addEventListener("keydown", handleUpdateDialogKeyDown, { capture: true })
    return () => window.removeEventListener("keydown", handleUpdateDialogKeyDown, { capture: true })
  }, [isUpdateDialogOpen])

  const {
    activeSession,
    activeSessionDirectory,
    activeWorkspaceFileScopeDirectory,
    activeWorkspaceFileScopeName,
    canInsertWorkspaceFileCommentsIntoDraft,
    composerCommandStatusByTabKey,
    composerRefreshVersion,
    deletingSessionID,
    handleApproveProposedPlan,
    expandedFolderIDs,
    handleCancelSend,
    handleCanvasSessionTabClose,
    handleCanvasSessionTabSelect,
    handleCreateSessionTabSelect,
    handleActiveSessionDiffFileSelect,
    handleActiveSessionDiffFileRestore,
    handleActiveSessionDiffPatchesReverseApply,
    handleActiveSessionDiffRefresh,
    handleCloseCreateSessionTab,
    handleCreateSessionSubmit,
    handleCreateSideChatTab,
    handleDeleteSideChatTab,
    handleCreateSessionWorkspaceChange,
    handleLeftSidebarViewChange,
    handleOpenSideChat,
    handleClearComposerParentMessage,
    handleOpenCreateSessionTab,
    activateRightSidebarTab,
    closeRightSidebarTab,
    openOrFocusRightSidebarTab,
    updateRightSidebarTab,
    handleDockviewActiveChange,
    handleForkFromMessage,
    handleMovePanelIntoSurface,
    handleMovePanelOutOfSurface,
    handlePaneFocus,
    handlePermissionRequestResponse,
    handleAskUserQuestionAnswer,
    handlePickComposerAttachments,
    handlePasteComposerImageAttachments,
    handlePreviewActiveInteractionChange,
    handlePreviewBack,
    handlePreviewCommitInteraction,
    handlePreviewDraftUrlChange,
    handlePreviewForward,
    handlePreviewOpen,
    handlePreviewOpenExternal,
    handlePreviewOpenTarget,
    handlePreviewOpenUrl,
    handlePreviewReload,
    handleWorkspaceFileCommentCancel,
    handleWorkspaceFileCommentChange,
    handleWorkspaceFileCommentConfirm,
    handleWorkspaceFileCommentStart,
    handleWorkspaceDirectoryLoad,
    handleWorkspaceDirectoryToggle,
    handleWorkspaceFileTreeInvalidate,
    handleWorkspaceFileQueryChange,
    handleWorkspaceFileSelect,
    handleProjectArchiveSessions,
    handleProjectCreateSession,
    handleCreateSessionForDirectory,
    handleProjectClick,
    handleProjectOpenInExplorer,
    handleProjectPin,
    handleProjectRemove,
    handleRemoveComposerAttachment,
    handleSend,
    handlePlanModeToggle,
    handleSessionBranchSelect,
    handleSessionDelete,
    handleSessionPin,
    handleSessionPopout,
    handleSessionRename,
    handleSessionSelect,
    handleSessionSplitRight,
    handleSelectSideChatTab,
    handleSessionModelSelectionChange,
    handleMessageDiffSummaryHydrate,
    handleSidebarAction,
    hoveredFolderID,
    isCreatingProject,
    isResolvingPermissionRequest,
    leftSidebarView,
    messageTreeBySession,
    permissionRequestActionError,
    permissionRequestActionRequestID,
    pinnedWorkspaceIDs,
    projectRowRefs,
    readThreadScrollSnapshot,
    refreshComposerMcp,
    refreshComposerModels,
    refreshComposerSkills,
    refreshWorkspaceFromDirectory,
    resolveBackendSessionID,
    rightSidebar,
    runningSessionIDs,
    selectedDiffFileBySession,
    selectedFolderID,
    selectedWorkspace,
    sessionDiffBySession,
    sessionDiffStateBySession,
    sessionCanvasUnreadBySession,
    setDraftForTab,
    saveThreadScrollSnapshot,
    threadNavigationRequestBySession,
    handleWorkbenchDockviewCommandsReady,
    setHoveredFolderID,
    setDockviewLayout,
    visibleCanvasSessionIDs,
    dockviewLayout,
    workspaceStore,
    workspaces,
  } = useAgentWorkspace({
    agentConnected,
    agentDefaultDirectory,
    isRuntimeDebugEnabled: isAgentDebugTraceEnabled,
    platform,
    surfaceID,
    workbenchState: workbenchContext.state,
  })
  const shouldDeferAppUpdateForRunningSession = useCallback(
    () => hasRunningSessionBlockingAppUpdate(runningSessionIDs),
    [runningSessionIDs],
  )
  const notifyAppUpdateDeferredForRunningSession = useCallback(
    (messageKey: TranslationKey) => {
      const text = t(messageKey)
      setAppUpdateStatus({
        tone: "muted",
        text,
      })
      toast.info(text)
    },
    [t, toast],
  )
  const deferAppUpdateDialogIfSessionRunning = useCallback(
    async (messageKey: TranslationKey) => {
      if (!(await shouldDeferAppUpdateForRunningSession())) return false
      notifyAppUpdateDeferredForRunningSession(messageKey)
      return true
    },
    [notifyAppUpdateDeferredForRunningSession, shouldDeferAppUpdateForRunningSession],
  )
  useEffect(() => {
    if (!appUpdateState?.updateChecksSupported) return
    if (appUpdateState.phase !== "downloading" && appUpdateState.phase !== "downloaded") return

    const updateKey = appUpdateState.latestVersion ?? appUpdateState.version ?? "unknown"
    const promptedUpdateRef = appUpdateState.phase === "downloading"
      ? autoPromptedDownloadingUpdateRef
      : autoPromptedDownloadedUpdateRef
    if (promptedUpdateRef.current === updateKey) return

    let cancelled = false
    if (updatePromptRetryTimerRef.current !== null) {
      window.clearTimeout(updatePromptRetryTimerRef.current)
      updatePromptRetryTimerRef.current = null
    }

    const schedulePromptRetry = () => {
      if (cancelled || updatePromptRetryTimerRef.current !== null) return
      updatePromptRetryTimerRef.current = window.setTimeout(() => {
        updatePromptRetryTimerRef.current = null
        setUpdatePromptRetryTick((current) => current + 1)
      }, UPDATE_PROMPT_RETRY_DELAY_MS)
    }

    void shouldDeferAppUpdateForRunningSession().then((shouldDefer) => {
      if (cancelled) return
      if (shouldDefer) {
        schedulePromptRetry()
        return
      }

      promptedUpdateRef.current = updateKey
      setIsUpdateDialogOpen(true)
    })

    return () => {
      cancelled = true
      if (updatePromptRetryTimerRef.current !== null) {
        window.clearTimeout(updatePromptRetryTimerRef.current)
        updatePromptRetryTimerRef.current = null
      }
    }
  }, [appUpdateState, shouldDeferAppUpdateForRunningSession, updatePromptRetryTick])
  const [loadedCalendarProjects, setLoadedCalendarProjects] = useState<CalendarProjectOption[]>([])
  useEffect(() => {
    const listProjectWorkspaces = window.desktop?.listProjectWorkspaces
    if (!listProjectWorkspaces || !agentConnected) return

    let cancelled = false
    listProjectWorkspaces()
      .then((projects) => {
        if (cancelled) return
        setLoadedCalendarProjects(projects.map(mapProjectWorkspaceToCalendarProject))
      })
      .catch((error) => {
        console.error("[desktop] calendar project list failed:", error)
      })

    return () => {
      cancelled = true
    }
  }, [agentConnected])
  const isConnectionsPageOpen = leftSidebarView === "connections"
  const isResourcesPageOpen = leftSidebarView === "resources"
  const workbenchPublishSnapshot = useWorkspaceStoreSelector(
    workspaceStore,
    (state) => buildWorkbenchPublishSnapshot({
      createSessionTabs: state.sessions.createSessionTabs,
      dockviewLayout: state.workbench.dockviewLayout,
      workspaces: state.sessions.workspaces,
    }),
    workbenchPublishSnapshotsAreEqual,
  )

  const {
    creatingGlobalSkillName,
    creatingGlobalSkillDraftKind,
    creatingGlobalSkillParentDirectory,
    deletingGlobalSkillDirectory,
    expandedSkillPaths,
    globalSkillFolderOptions,
    globalSkillsRoot,
    globalSkillsTree,
    gitInstallTargetDirectory,
    gitInstallPreview,
    gitInstallSource,
    handleCreateGlobalSkill,
    handleCreateGlobalSkillDraftCancel,
    handleCreateGlobalSkillDraftChange,
    handleCreateGlobalSkillDraftStart,
    handleDeleteGlobalSkill,
    handleGitInstallDialogClose,
    handleGitInstallDialogOpen,
    handleGitInstallSkillToggle,
    handleGitInstallSourceChange,
    handleGitInstallTargetDirectoryChange,
    handleGlobalSkillDirectoryToggle,
    handleGlobalSkillDraftChange,
    handleGlobalSkillFileSelect,
    handleInstallGitSkills,
    handleInstallLocalSkillFile,
    handleLocalInstallDialogClose,
    handleLocalInstallDialogOpen,
    handleLocalInstallTargetDirectoryChange,
    handleMoveGlobalSkillDirectory,
    handleMoveGlobalSkillDirectoryCancel,
    handleMoveGlobalSkillDirectoryStart,
    handleMoveGlobalSkillTargetDirectoryChange,
    handleOpenGlobalSkillsFolder,
    handlePreviewGitSkillInstall,
    handleRenameGlobalSkill,
    handleRenameGlobalSkillDraftCancel,
    handleRenameGlobalSkillDraftChange,
    handleRenameGlobalSkillDraftStart,
    handleSaveGlobalSkillFile,
    isCreateGlobalSkillDraftVisible,
    isCreatingGlobalSkill,
    isDirtyGlobalSkillFile,
    isGitInstallDialogOpen,
    isInstallingGitSkills,
    isInstallingLocalSkill,
    isLocalInstallDialogOpen,
    isLoadingGlobalSkillFile,
    isLoadingGlobalSkillsTree,
    isMoveGlobalSkillDialogOpen,
    isMovingGlobalSkillDirectory,
    isPreviewingGitInstall,
    isSavingGlobalSkillFile,
    localInstallTargetDirectory,
    moveGlobalSkillTargetOptions,
    movingGlobalSkillDirectory,
    movingGlobalSkillTargetDirectory,
    renamingGlobalSkillDirectory,
    renamingGlobalSkillDraftDirectory,
    renamingGlobalSkillName,
    refreshGlobalSkillsTree,
    selectedGlobalSkillDirectory,
    selectedGlobalSkillFileContent,
    selectedGlobalSkillFilePath,
    selectedGlobalSkillFileReadOnly,
    selectedGitInstallSkillIDs,
  } = useGlobalSkills({
    onSkillsUpdated: refreshComposerSkills,
  })

  const {
    activeConnectorID,
    activeMcpServerID,
    activeMcpServerDiagnostic,
    activePluginID,
    archivedSessions,
    archivedSessionsError,
    builtinTools,
    builtinToolsError,
    cancelConnectorAuthFlow,
    cancelInstalledPluginConnectorAuthFlow,
    catalog,
    cinemaVideoProviders,
    closeSettings,
    clearPluginSelection,
    connectorApiKeyDrafts,
    connectorCatalog,
    connectorConfigDrafts,
    connectorsError,
    connectorStatuses,
    deleteAllArchivedSessions,
    deleteArchivedSession,
    deleteConnectorApiKey,
    deleteConnectorConfig,
    deleteConnectorAuthSession,
    deleteInstalledPlugin,
    deleteInstalledPluginConnectorApiKey,
    deleteInstalledPluginConnectorAuthSession,
    deleteMcpServer,
    deleteProvider,
    deleteProviderAuthSession,
    deletingArchivedSessionID,
    deletingMcpServerID,
    deletingPluginID,
    deletingPromptPresetID,
    deletingProviderID,
    diagnoseConnector,
    diagnoseMcpServer,
    diagnoseInstalledPlugin,
    diagnoseInstalledPluginConnector,
    diagnosingPluginID,
    diagnosingPluginConnectorID,
    diagnosingConnectorMcpServerID,
    diagnosingMcpServerID,
    importPluginFromURL,
    installPlugin,
    installPromptsFromUrl,
    importMcpConfigJson,
    installingPluginID,
    installedPlugins,
    isCreatingPromptPreset,
    isImportingMcpConfigJson,
    isLoading,
    isLoadingBuiltinTools,
    isLoadingConnectors,
    isLoadingPlugins,
    isLoadingPromptPreset,
    isLoadingPrompts,
    isLoadingArchivedSessions,
    isLoadingStorageUsage,
    isOpen,
    isPromptDirty,
    isPromptUrlInstallDialogOpen,
    isBuiltinToolSelectionDirty,
    isRefreshingProviderCatalog,
    isRefreshingCinemaVideoProviderCatalog,
    isDeletingAllArchivedSessions,
    isInstallingPromptUrlPrompts,
    isPreviewingPromptUrlInstall,
    isTranslatingPromptPreset,
    isSavingPromptPresetSelection,
    isSavingBuiltinTools,
    loadError,
    loadArchivedSessions,
    loadStorageUsage,
    mcpDiagnostics,
    mcpServerDraft,
    mcpServers,
    models,
    modelCatalog,
    openSettings,
    pluginCatalog,
    pluginConnectorStatuses,
    pluginDiagnostics,
    pluginDraft,
    pluginsError,
    promptDraftLabel,
    promptDraftContent,
    promptLoadError,
    promptRoot,
    promptPresets,
    promptPresetSelection,
    promptUrlInstallMessage,
    promptUrlInstallPreview,
    promptUrlInstallSource,
    providerDrafts,
    cinemaVideoProviderDrafts,
    customProviderDraft,
    createPromptPreset,
    deletePromptPreset,
    closePromptUrlInstallDialog,
    openPromptFolder,
    openPromptUrlInstallDialog,
    previewPromptUrlInstall,
    refreshProviderCatalog,
    refreshCinemaVideoProviderCatalog,
    resetBuiltinTools,
    resetPromptPreset,
    resettingPromptPresetID,
    restoringArchivedSessionID,
    storageUsage,
    storageUsageError,
    storageOptimizeMessage,
    isOptimizingStorage,
    optimizeStorage,
    restoreArchivedSession,
    saveBuiltinTools,
    saveConnectorApiKey,
    saveConnectorConfig,
    saveInstalledPluginConfig,
    saveInstalledPluginConnectorApiKey,
    saveMcpServer,
    savePromptPreset,
    saveProviderApiKey,
    saveCinemaVideoProviderApiKey,
    saveProvider,
    saveCustomProvider,
    savingMcpServerID,
    savingConnectorID,
    savingPromptPresetID,
    savingProviderID,
    savingCinemaVideoProviderID,
    savingPluginConnectorID,
    testCinemaVideoProviderConnection,
    testProviderConnection,
    testCustomProviderConnection,
    testingProviderID,
    translatePromptPreset,
    selectedPromptPreset,
    selectedPromptUrlInstallIDs,
    setConnectorConfigDraft,
    setProviderAuthMethod,
    setPromptDraftLabelValue,
    setPromptPresetSelectionValue,
    setPromptUrlInstallSourceValue,
    selectConnector,
    selectPromptPreset,
    selectMcpServer,
    selectPlugin,
    selectionDraft,
    setInstalledPluginEnabled,
    setInstalledPluginMcpEnabled,
    setInstalledPluginMcpToolPolicy,
    setConnectorApiKeyDraft,
    setConnectorMcpEnabled,
    setConnectorMcpToolPolicy,
    setMcpServerDraftValue,
    setMcpToolPolicy,
    setPluginDraftAppApiKey,
    setPluginDraftConfigValue,
    setBuiltinToolEnabled,
    setPromptDraftValue,
    setProviderDraftValue,
    setCinemaVideoProviderDraftValue,
    setCustomProviderDraftValue,
    resetCustomProviderDraft,
    setSelectionDraftValue,
    togglePromptUrlInstallPrompt,
    startInstalledPluginConnectorAuthFlow,
    startConnectorAuthFlow,
    startProviderAuthFlow,
    startNewMcpServer,
    cancelProviderAuthFlow,
    updatingPluginID,
  } = useSettingsPage({
    isBuiltinToolsPageOpen: leftSidebarView === "tools",
    isConnectorsPageOpen: isConnectionsPageOpen,
    isMcpServersPageOpen: isConnectionsPageOpen,
    isPluginsPageOpen: isConnectionsPageOpen,
    isPromptPresetEditorOpen: isResourcesPageOpen && promptSkillMode === "prompts",
    onArchivedSessionRestored: async (session) => {
      await refreshWorkspaceFromDirectory(session.directory)
    },
    onMcpUpdated: refreshComposerMcp,
    onSkillsUpdated: refreshComposerSkills,
    onProviderModelsUpdated: refreshComposerModels,
  })
  const mcpInventoryServers = useMemo(
    () => filterMcpInventoryServers(
      mcpServers,
      installedPlugins,
      pluginCatalog,
      connectorCatalog,
    ),
    [connectorCatalog, installedPlugins, mcpServers, pluginCatalog],
  )
  const accountConnectorCount = useMemo(
    () => connectorCatalog.filter(isAccountConnectorDefinition).length,
    [connectorCatalog],
  )

  useEffect(() => {
    if (
      activeMcpServerID
      && !mcpInventoryServers.some((server) => server.id === activeMcpServerID)
    ) {
      startNewMcpServer()
    }
  }, [activeMcpServerID, mcpInventoryServers, startNewMcpServer])

  const automationRefreshKnownSessionIDsRef = useRef<Set<string>>(new Set())
  const refreshWorkspaceFromDirectoryRef = useRef(refreshWorkspaceFromDirectory)

  useEffect(() => {
    refreshWorkspaceFromDirectoryRef.current = refreshWorkspaceFromDirectory
  }, [refreshWorkspaceFromDirectory])

  useEffect(() => {
    const knownSessionIDs = automationRefreshKnownSessionIDsRef.current
    for (const workspace of workspaces) {
      for (const session of workspace.sessions) {
        knownSessionIDs.add(session.id)
      }
    }
  }, [workspaces])

  useEffect(() => {
    return window.desktop?.onAutomationEvent?.((event) => {
      const target = readAutomationSessionRefreshTarget(event)
      if (!target) return
      if (automationRefreshKnownSessionIDsRef.current.has(target.sessionID)) return

      automationRefreshKnownSessionIDsRef.current.add(target.sessionID)
      void Promise.resolve(refreshWorkspaceFromDirectoryRef.current(target.directory)).catch(() => {
        automationRefreshKnownSessionIDsRef.current.delete(target.sessionID)
      })
    })
  }, [])

  useEffect(() => {
    const openEnvironmentSettings = () => {
      window.sessionStorage.setItem(ENVIRONMENT_SETTINGS_SECTION_STORAGE_KEY, "true")
      handleOpenSettings()
    }
    window.addEventListener(OPEN_ENVIRONMENT_SETTINGS_EVENT, openEnvironmentSettings)
    return () => window.removeEventListener(OPEN_ENVIRONMENT_SETTINGS_EVENT, openEnvironmentSettings)
  })

  function handleOpenSettings() {
    if (isOpen || isPreparingSettingsPage) return

    setIsSkillMarketplaceOpen(false)
    setIsPreparingSettingsPage(true)
    void loadSettingsPage()
      .then(() => {
        openSettings()
      })
      .catch((error) => {
        console.error("[desktop] Failed to preload settings page:", error)
        openSettings()
      })
      .finally(() => {
        setIsPreparingSettingsPage(false)
      })
  }

  async function handleProjectCreateWorktree(workspace: WorkspaceGroup, input: ProjectWorktreeCreateRequest) {
    const projectID = workspace.project.id.trim()
    if (!projectID || creatingWorktreeProjectIDRef.current || creatingWorktreeProjectID || !isGitWorkspaceProject(workspace)) return false

    const createProjectWorktree = window.desktop?.createProjectWorktree
    if (!createProjectWorktree) {
      toast.error("创建工作树不可用。")
      return false
    }

    creatingWorktreeProjectIDRef.current = projectID
    setCreatingWorktreeProjectID(projectID)
    try {
      const created = await createProjectWorktree({
        projectID,
        branchName: input.branchName?.trim() || undefined,
        sourceDirectory: workspace.directory,
        environment: input.environment,
        cleanupPolicy: "manual",
        ownerType: "manual",
      })
      const targetDirectory = created.worktree.workingDirectory ?? created.worktree.path
      if (created.setupRun) {
        toast.info("创建工作树 ✓  →  正在初始化环境  →  打开会话")
        let setupRun = await waitForEnvironmentRun(created.setupRun)
        if (setupRun.status !== "succeeded") {
          console.error("[desktop] environment setup failed:", setupRun)
          const shouldRetry =
            typeof window.confirm === "function" &&
            window.confirm(
              `环境初始化失败：${setupRun.error || `退出码 ${setupRun.exitCode ?? "未知"}`}\n\n选择“确定”重试初始化；选择“取消”跳过初始化并打开会话。`,
            )
          if (shouldRetry) {
            const retried = await window.desktop?.retryEnvironmentRun?.({ runID: setupRun.id })
            if (retried) setupRun = await waitForEnvironmentRun(retried)
          }
          if (setupRun.status !== "succeeded") {
            const shouldSkip =
              shouldRetry &&
              typeof window.confirm === "function" &&
              window.confirm(
                `重试仍未成功。是否跳过初始化并打开会话？\n\n${setupRun.output.slice(-4_000)}`,
              )
            if (shouldRetry && !shouldSkip) {
              toast.error("工作树已保留；环境初始化未完成，可稍后从环境菜单重新初始化。")
              return true
            }
          }
        }
      }
      const createdSession = await handleCreateSessionForDirectory(projectID, targetDirectory)
      const label = input.name.trim() || created.worktree.branch?.trim() || targetDirectory
      if (createdSession) {
        toast.success(`已创建工作树：${label}`)
      } else {
        toast.info(`工作树已创建，但未能自动打开会话：${label}`)
      }
      return true
    } catch (error) {
      console.error("[desktop] create project worktree failed:", error)
      toast.error(`创建工作树失败：${getErrorMessage(error)}`)
      return false
    } finally {
      if (creatingWorktreeProjectIDRef.current === projectID) {
        creatingWorktreeProjectIDRef.current = null
      }
      setCreatingWorktreeProjectID((current) => (current === projectID ? null : current))
    }
  }

  async function handleProjectOpenCinema(workspace: WorkspaceGroup) {
    const projectID = workspace.project.id.trim()
    if (!projectID) {
      toast.error("Cinema 需要有效的项目 ID。")
      return
    }

    const openCinemaProject = window.desktop?.openCinemaProject
    if (!openCinemaProject) {
      toast.error("Cinema 入口不可用。")
      return
    }

    try {
      const result = await openCinemaProject({ projectID })
      handlePreviewOpenUrl(result.url, workspace.id)
    } catch (error) {
      console.error("[desktop] open cinema project failed:", error)
      toast.error(`打开 Cinema 失败：${getErrorMessage(error)}`)
    }
  }

  async function refreshAppUpdateState() {
    const state = await getAppUpdateState()
    if (state) {
      setAppUpdateState(state)
    }
    return state
  }

  async function handleCheckForUpdates() {
    if (isCheckingAppUpdate) return
    if (await deferAppUpdateDialogIfSessionRunning("updates.status.deferredForRunningSession")) return

    setIsUpdateDialogOpen(true)
    setIsCheckingAppUpdate(true)
    setAppUpdateStatus(null)

    try {
      const result = await checkForAppUpdates()
      if (result?.state) {
        setAppUpdateState(result.state)
      }
      if (!result || result.ok === false || result.reason === "already-checking") {
        setAppUpdateStatus({
          tone: result?.ok === false ? "error" : "muted",
          text: getManualUpdateCheckStatusText(result, t),
        })
      }
      await refreshAppUpdateState()
    } catch (error) {
      const message = getErrorMessage(error)
      setAppUpdateStatus({
        tone: "error",
        text: t("updates.status.checkFailedWithMessage", { message }),
      })
    } finally {
      setIsCheckingAppUpdate(false)
    }
  }

  async function handleInstallAppUpdate() {
    if (isInstallingAppUpdate) return
    if (await deferAppUpdateDialogIfSessionRunning("updates.status.installBlockedForRunningSession")) return

    setIsInstallingAppUpdate(true)
    setAppUpdateStatus(null)

    try {
      const result = await installAppUpdate()
      if (!result?.ok) {
        setAppUpdateStatus({
          tone: "error",
          text: result?.reason === "update-not-downloaded"
            ? t("updates.status.notDownloaded")
            : result?.reason === "session-running"
              ? t("updates.status.installBlockedForRunningSession")
            : t("updates.status.installFailed"),
        })
      }
    } catch (error) {
      const message = getErrorMessage(error)
      setAppUpdateStatus({
        tone: "error",
        text: t("updates.status.installFailedWithMessage", { message }),
      })
    } finally {
      setIsInstallingAppUpdate(false)
    }
  }

  async function handleAutomaticUpdatesToggle() {
    if (!appUpdateState || isSavingAutomaticUpdates) return

    const enabled = !appUpdateState.automaticUpdates
    setIsSavingAutomaticUpdates(true)
    setAppUpdateStatus(null)

    try {
      const settings = await setAutomaticUpdatesEnabled(enabled)
      setAppUpdateState((current) => {
        if (current) {
          return {
            ...current,
            automaticUpdates: settings?.automaticUpdates ?? enabled,
            updateChecksSupported: settings?.updateChecksSupported ?? current.updateChecksSupported,
            version: settings?.version ?? current.version,
          }
        }

        return createFallbackAppUpdateState(settings?.automaticUpdates ?? enabled, settings?.version)
      })
      setAppUpdateStatus({
        tone: "success",
        text: enabled ? t("updates.status.automaticEnabled") : t("updates.status.automaticDisabled"),
      })
    } catch (error) {
      const message = getErrorMessage(error)
      setAppUpdateStatus({
        tone: "error",
        text: t("updates.status.saveAutomaticFailedWithMessage", { message }),
      })
    } finally {
      setIsSavingAutomaticUpdates(false)
    }
  }

  async function handleOpenUpdateCenter() {
    if (await deferAppUpdateDialogIfSessionRunning("updates.status.deferredForRunningSession")) return
    setIsUpdateDialogOpen(true)
  }

  const isCreatingSession = useWorkspaceStoreSelector(
    workspaceStore,
    (state) => Object.values(state.composer.isCreatingSessionByTabKey).some(Boolean),
  )
  const [activeBuiltinToolKind, setActiveBuiltinToolKind] = useState<BuiltinToolKindKey | null>(null)
  const [activeConnectionsTab, setActiveConnectionsTab] = useState<ConnectionsTab>("plugins")
  const [activeMobileConnectionPanel, setActiveMobileConnectionPanel] = useState<MobileConnectionPanel>("this-mac")
  const [connectionSearchQueries, setConnectionSearchQueries] = useState<Record<ConnectionsTab, string>>(
    EMPTY_CONNECTION_SEARCH_QUERIES,
  )
  const [toolPermissionMode, setToolPermissionMode] = useState<ToolPermissionMode>("default")
  const [toolPermissionModeError, setToolPermissionModeError] = useState<string | null>(null)
  const [isSavingToolPermissionMode, setIsSavingToolPermissionMode] = useState(false)
  const lastPublishedWorkbenchSnapshotSignatureRef = useRef<string | null>(null)
  const terminalSessionID = useWorkspaceStoreSelector(workspaceStore, (state) => {
    const focusedPaneID = getFocusedDockviewGroupIDFromState(
      state.workbench.dockviewLayout,
      state.workbench.dockviewActiveState,
    )
    const reference = getActivePanelForGroupFromState(
      state.workbench.dockviewLayout,
      state.workbench.dockviewActiveState,
      focusedPaneID,
    )
    if (reference?.kind !== "session") return null

    const { session } = findSession(state.sessions.workspaces, reference.sessionID)
    return session && !isSideChatSession(session) ? session.id : null
  })
  const activeRightSidebarTab = rightSidebar.tabs.find((tab) => tab.id === rightSidebar.activeTabID) ?? null
  const conversationWorkspaceID = useMemo(() => {
    const defaultDirectory = agentDefaultDirectory.trim()
    if (!defaultDirectory) return null
    return workspaces.find((workspace) => sameWorkspaceDirectory(workspace.directory, defaultDirectory))?.id ?? null
  }, [agentDefaultDirectory, workspaces])
  const protectedWorkspaceIDs = useMemo(
    () => (conversationWorkspaceID ? [conversationWorkspaceID] : []),
    [conversationWorkspaceID],
  )
  const rightSidebarSideChatPanelState = useWorkspaceStoreSelector(
    workspaceStore,
    (state): RightSidebarSideChatPanelState | null => {
      const tab = state.sessions.rightSidebar.tabs.find((candidate) => (
        candidate.id === state.sessions.rightSidebar.activeTabID
      ))
      if (!tab || tab.kind !== "side-chat") return null

      const sideChatSessionsByAnchorMessageID = collectSideChatSessionsByAnchorMessageID(
        state.sessions.workspaces,
        tab.parentSessionID,
      )
      const sideChatSessions = sideChatSessionsByAnchorMessageID[tab.anchorMessageID] ?? []
      const activeMappedSessionID = state.sessions.activeSideChatSessionIDByParentSessionID[tab.parentSessionID] ?? null
      const activeMappedSelection = findSession(state.sessions.workspaces, activeMappedSessionID)
      const activeMappedSession =
        activeMappedSelection.session?.origin?.parentSessionID === tab.parentSessionID &&
        activeMappedSelection.session.origin.anchorMessageID === tab.anchorMessageID
          ? activeMappedSelection.session
          : null
      const tabSessionSelection = findSession(state.sessions.workspaces, tab.sessionID)
      const tabSession =
        tabSessionSelection.session?.origin?.parentSessionID === tab.parentSessionID &&
        tabSessionSelection.session.origin.anchorMessageID === tab.anchorMessageID
          ? tabSessionSelection.session
          : null
      const session = activeMappedSession ?? tabSession ?? sideChatSessions[sideChatSessions.length - 1] ?? null
      if (!session) return null

      const sessionSelection = findSession(state.sessions.workspaces, session.id)
      const tabKey = getWorkbenchTabKey(createSessionWorkbenchTab(session.id))
      const messages = state.agentStream.conversations[session.id] ?? EMPTY_SIDE_CHAT_MESSAGES
      const activity = state.agentStream.conversationActivityBySession[session.id]
      const isInterruptible = Boolean(
        state.composer.isSendingByTabKey[tabKey] ||
        state.agentStream.cancellingSessionIDs[session.id] ||
        activity?.hasStreamingAssistantMessage ||
        messages.some((message) => message.kind === "assistant" && message.isStreaming),
      )

      return {
        activeProjectID: sessionSelection.workspace?.project.id ?? null,
        activeTabID: tab.id,
        anchorMessageID: tab.anchorMessageID,
        attachments: state.composer.composerAttachmentsByTabKey[tabKey] ?? EMPTY_SIDE_CHAT_ATTACHMENTS,
        draftState: state.composer.composerDraftStateByTabKey[tabKey] ?? EMPTY_SIDE_CHAT_DRAFT_STATE,
        isCancelling: Boolean(state.agentStream.cancellingSessionIDs[session.id]),
        isInterruptible,
        isSending: Boolean(state.composer.isSendingByTabKey[tabKey]),
        parentSessionID: tab.parentSessionID,
        pendingInputs: state.agentStream.pendingConversationInputsBySession[session.id] ?? EMPTY_SIDE_CHAT_PENDING_INPUTS,
        pendingPermissionRequests:
          state.agentStream.pendingPermissionRequestsBySession[session.id] ?? EMPTY_SIDE_CHAT_PERMISSION_REQUESTS,
        session,
        sideChatSessions: sideChatSessions.some((sideChat) => sideChat.id === session.id)
          ? sideChatSessions
          : [...sideChatSessions, session],
        tabKey,
        messages,
        turns: EMPTY_SIDE_CHAT_TURNS,
        workspaceDirectory: sessionSelection.workspace?.directory ?? null,
        workspaceID: sessionSelection.workspace?.id ?? null,
      }
    },
    rightSidebarSideChatPanelStatesAreEqual,
  )
  const conversationStore = useWorkspaceStoreSelector(workspaceStore, (state) => state.agentStream.conversationStore)
  const liveRightSidebarSideChatMessages = useConversationMessages(
    conversationStore,
    rightSidebarSideChatPanelState?.session.id ?? null,
  )
  const liveRightSidebarSideChatTurns = useConversationTurns(
    conversationStore,
    rightSidebarSideChatPanelState?.session.id ?? null,
  )
  const liveRightSidebarSideChatPanelState = useMemo(() => {
    if (!rightSidebarSideChatPanelState) return null
    return {
      ...rightSidebarSideChatPanelState,
      messages: liveRightSidebarSideChatMessages.length > 0
        ? liveRightSidebarSideChatMessages
        : rightSidebarSideChatPanelState.messages,
      turns: liveRightSidebarSideChatTurns.length > 0
        ? liveRightSidebarSideChatTurns
        : rightSidebarSideChatPanelState.turns,
    }
  }, [liveRightSidebarSideChatMessages, liveRightSidebarSideChatTurns, rightSidebarSideChatPanelState])
  const rightSidebarThreadLinkContext = liveRightSidebarSideChatPanelState

  function handleOpenRightSidebarFilesTab() {
    openOrFocusRightSidebarTab({
      kind: "files",
      filePath: null,
      scopeDirectory: activeWorkspaceFileScopeDirectory,
      scopeName: activeWorkspaceFileScopeName,
      title: "Files",
    })
  }

  function handleOpenRightSidebarBrowserTab() {
    openOrFocusRightSidebarTab({
      kind: "browser",
      target: null,
      title: "Browser",
      workspaceID: selectedWorkspace?.id ?? null,
      workspaceRoot: selectedWorkspace?.directory ?? activeSessionDirectory ?? activeWorkspaceFileScopeDirectory,
    })
  }

  function handleOpenRightSidebarReviewTab() {
    if (!activeSession?.id) return
    openOrFocusRightSidebarTab({
      kind: "review",
      sessionID: activeSession.id,
      title: "Review",
    })
  }

  async function handleSessionDiffScopeLoad(sessionID: string, scope: SessionDiffScope): Promise<SessionDiffSummary> {
    const getSessionDiff = window.desktop?.getSessionDiff
    if (!getSessionDiff) {
      throw new Error("Workspace diff bridge is unavailable.")
    }

    return getSessionDiff({
      sessionID: resolveBackendSessionID(sessionID),
      scope,
    })
  }

  function handleOpenRightSidebarTerminalTab() {
    if (!terminalSessionID) return
    openOrFocusRightSidebarTab({
      kind: "terminal",
      sessionID: terminalSessionID,
      title: "Terminal",
    })
  }

  function handleOpenRightSidebarMessageTreeTab() {
    if (!activeSession?.id) return
    openOrFocusRightSidebarTab({
      kind: "message-tree",
      sessionID: activeSession.id,
      title: "Tree",
    })
  }

  async function handleOpenSubagentSessionTab(sessionID: string) {
    const trimmedSessionID = sessionID.trim()
    if (!trimmedSessionID) return

    const currentSelection = findSession(workspaces, trimmedSessionID)
    if (currentSelection.workspace && currentSelection.session) {
      handleSessionSelect(currentSelection.workspace.id, currentSelection.session.id)
      return
    }

    const parentWorkspace = activeSession?.id
      ? findSession(workspaces, activeSession.id).workspace
      : null
    const refreshedWorkspace = parentWorkspace
      ? await refreshWorkspaceFromDirectory(parentWorkspace.directory)
      : null
    const refreshedSession = refreshedWorkspace?.sessions.find((session) => session.id === trimmedSessionID) ?? null
    if (refreshedWorkspace && refreshedSession) {
      handleSessionSelect(refreshedWorkspace.id, refreshedSession.id)
    }
  }

  async function handleMessageTreeNodeSelect(sessionID: string, messageID: string) {
    if (!messageID.trim()) return

    const sessionSelection = findSession(workspaces, sessionID)
    if (sessionSelection.workspace && activeSession?.id !== sessionID) {
      handleSessionSelect(sessionSelection.workspace.id, sessionID)
    }

    await handleSessionBranchSelect({ sessionID, messageID })
  }

  async function handleOpenSideChatInRightSidebar(
    anchorMessageID: string,
    options?: { parentSessionID?: string | null; paneID?: string | null },
  ) {
    if (isRightSidebarCollapsed) {
      handleRightSidebarToggle()
    }

    await handleOpenSideChat(anchorMessageID, options)
  }

  async function handleSelectSideChatTabInRightSidebar(sessionID: string, tabID = activeRightSidebarTab?.id ?? null) {
    await handleSelectSideChatTab(sessionID)
    if (tabID) {
      updateRightSidebarTab(tabID, {
        sessionID,
      })
    }
  }

  function handleActivateRightSidebarTab(tabID: string) {
    const tab = rightSidebar.tabs.find((candidate) => candidate.id === tabID) ?? null
    activateRightSidebarTab(tabID)
    if (tab?.kind === "side-chat" && tab.sessionID) {
      void handleSelectSideChatTabInRightSidebar(tab.sessionID, tab.id)
    }
  }

  useEffect(() => {
    let cancelled = false

    async function loadToolPermissionMode() {
      try {
        const result = await window.desktop?.getToolPermissionMode?.()
        if (cancelled || !result) return
        setToolPermissionMode(result.mode)
        setToolPermissionModeError(null)
      } catch (error) {
        if (cancelled) return
        setToolPermissionModeError(getErrorMessage(error))
      }
    }

    void loadToolPermissionMode()

    return () => {
      cancelled = true
    }
  }, [])

  async function handleToolPermissionModeChange(mode: ToolPermissionMode) {
    if (mode === toolPermissionMode || isSavingToolPermissionMode) return
    const previousMode = toolPermissionMode

    setToolPermissionMode(mode)
    setToolPermissionModeError(null)
    setIsSavingToolPermissionMode(true)

    try {
      const result = await window.desktop?.updateToolPermissionMode?.({ mode })
      setToolPermissionMode(result?.mode ?? mode)
    } catch (error) {
      setToolPermissionMode(previousMode)
      setToolPermissionModeError(getErrorMessage(error))
    } finally {
      setIsSavingToolPermissionMode(false)
    }
  }

  function handleInspectFileInSidebar(file: string | null, sessionID: string | null, paneID: string) {
    if (isRightSidebarCollapsed) {
      handleRightSidebarToggle()
    }
    handlePaneFocus(paneID)
    handleActiveSessionDiffFileSelect(file, sessionID)
  }

  async function handleMessageDiffReview(_files: string[], sessionID: string | null, paneID: string) {
    if (isRightSidebarCollapsed) {
      handleRightSidebarToggle()
    }
    handlePaneFocus(paneID)
    handleActiveSessionDiffFileSelect(null, sessionID)
    await handleActiveSessionDiffRefresh(sessionID)
  }

  async function handleMessageDiffRestore(diffs: SessionDiffFile[], sessionID: string | null, paneID: string) {
    if (isRightSidebarCollapsed) {
      handleRightSidebarToggle()
    }
    handlePaneFocus(paneID)
    handleActiveSessionDiffFileSelect(null, sessionID)
    await handleActiveSessionDiffPatchesReverseApply(diffs, sessionID)
  }

  function handleLocalFileLinkOpen({
    paneID,
    target,
    workspaceDirectory,
    workspaceID,
  }: LocalFileLinkOpenInput) {
    if (isRightSidebarCollapsed) {
      handleRightSidebarToggle()
    }
    handlePaneFocus(paneID)

    const workspaceLinkPath = resolveLocalFileLinkWorkspacePath(workspaceDirectory, target.path, platform)

    if (workspaceDirectory && workspaceLinkPath) {
      if (target.lineRange || isMarkdownDocumentPath(workspaceLinkPath.relativePath)) {
        void handleWorkspaceFileSelect(workspaceLinkPath.relativePath, {
          linkedLineRange: target.lineRange ?? null,
          scopeDirectory: workspaceDirectory,
        })
        return
      }

      void handlePreviewOpenTarget(workspaceLinkPath.absolutePath, workspaceID, workspaceDirectory)
      return
    }

    void openSystemLocalPath(target.path)
  }

  function handleArtifactLinkOpen({
    paneID,
    target,
    workspaceDirectory,
    workspaceID,
  }: ArtifactLinkOpenInput) {
    if (isRightSidebarCollapsed) {
      handleRightSidebarToggle()
    }
    handlePaneFocus(paneID)
    void handlePreviewOpenTarget(target.href, workspaceID, workspaceDirectory)
  }

  function handleOpenThreadLinkInAnybox(href: string) {
    if (isRightSidebarCollapsed) {
      handleRightSidebarToggle()
    }
    void handlePreviewOpenTarget(
      href,
      selectedWorkspace?.id ?? null,
      selectedWorkspace?.directory ?? activeSessionDirectory ?? null,
    )
  }

  async function handleDetachSessionPanel(input: {
    bounds: { height: number; width: number; x: number; y: number }
    groupID: string
    panelID: string
    reference: { kind: "session"; sessionID: string }
    title: string
  }) {
    const detachSessionPanel = window.desktop?.detachSessionPanel
    if (!detachSessionPanel) return false

    const result = await detachSessionPanel({
      bounds: input.bounds,
      lastMainGroupID: input.groupID,
      panelID: input.panelID,
      sessionID: input.reference.sessionID,
      sourceSurfaceID: surfaceID,
      title: input.title,
    })
    return result.ok
  }

  async function handleMoveSessionPanel(input: {
    panelID: string
    placement: "within" | "left" | "right" | "top" | "bottom"
    sourceSurfaceID: string
    targetGroupID?: string | null
    targetSurfaceID: string
  }) {
    const result = await window.desktop?.moveWorkbenchPanel?.(input)
    return Boolean(result?.ok)
  }

  useEffect(() => {
    if (workbenchContext.kind !== "main") return
    const publishWorkbenchSnapshot = window.desktop?.publishWorkbenchSnapshot
    if (!publishWorkbenchSnapshot) return

    const snapshot: WorkbenchSharedState = {
      version: 0,
      windows: [],
      surfaces: [
        {
          surfaceID,
          kind: "main",
          windowID: workbenchContext.windowID,
          ownedPanelIDs: workbenchPublishSnapshot.ownedPanelIDs,
          layout: dockviewLayout,
        },
      ],
      ownership: [],
      panels: workbenchPublishSnapshot.panels,
    }
    const signature = getWorkbenchPublishSignature(snapshot)
    if (signature === lastPublishedWorkbenchSnapshotSignatureRef.current) return
    lastPublishedWorkbenchSnapshotSignatureRef.current = signature

    void publishWorkbenchSnapshot(snapshot).catch((error) => {
      if (lastPublishedWorkbenchSnapshotSignatureRef.current === signature) {
        lastPublishedWorkbenchSnapshotSignatureRef.current = null
      }
      console.error("[desktop] Failed to publish workbench snapshot:", error)
    })
  }, [dockviewLayout, surfaceID, workbenchContext.kind, workbenchContext.windowID, workbenchPublishSnapshot])

  useEffect(() => {
    if (workbenchContext.kind !== "main") return
    const unsubscribe = window.desktop?.onWorkbenchStateChange?.((event) => {
      if (event.reason === "focus" && event.panelID) {
        const ownership = event.state.ownership.find((item) => item.panelID === event.panelID)
        if (ownership && getWorkbenchPanelOwnershipSurfaceID(ownership) === surfaceID) {
          handleCanvasSessionTabSelect(ownership.reference.sessionID, ownership.lastMainGroupID ?? undefined)
        }
        return
      }

      const move = event.move
      if (move) {
        if (move.targetSurfaceID === surfaceID) {
          handleMovePanelIntoSurface({
            panelID: move.panelID,
            placement: move.placement,
            targetGroupID: move.targetGroupID,
            title: move.title,
          })
        }
        if (move.sourceSurfaceID === surfaceID) {
          handleMovePanelOutOfSurface(move.panelID)
        }
        return
      }
      if (event.reason !== "dock" && event.reason !== "restored") return
      const ownership = event.panelID
        ? event.state.ownership.find((item) => item.panelID === event.panelID)
        : null
      if (!ownership || ownership.ownerWindowID !== workbenchContext.windowID) return
      handleCanvasSessionTabSelect(ownership.reference.sessionID, ownership.lastMainGroupID ?? undefined)
    })

    return unsubscribe
  }, [
    handleCanvasSessionTabSelect,
    handleMovePanelIntoSurface,
    handleMovePanelOutOfSurface,
    surfaceID,
    workbenchContext.kind,
    workbenchContext.windowID,
  ])

  function handleConnectionSearchQueryChange(value: string) {
    setConnectionSearchQueries((current) => ({
      ...current,
      [activeConnectionsTab]: value,
    }))
  }

  function handleOpenRemoteFolderConfig() {
    setActiveMobileConnectionPanel("ssh")
    handleLeftSidebarViewChange("mobile")
  }

  function handlePromptSkillModeChange(nextMode: PromptSkillMode) {
    if (nextMode === promptSkillMode) return

    if (
      promptSkillMode === "prompts" &&
      isPromptDirty &&
      typeof window.confirm === "function" &&
      !window.confirm(t("resources.confirm.switchFromPrompt"))
    ) {
      return
    }

    if (
      promptSkillMode === "skills" &&
      isDirtyGlobalSkillFile &&
      typeof window.confirm === "function" &&
      !window.confirm(t("resources.confirm.switchFromSkill"))
    ) {
      return
    }

    setPromptSkillMode(nextMode)
  }

  function handleSkillLibraryModeChange(nextMode: SkillLibraryMode) {
    if (nextMode === skillLibraryMode) return true
    if (
      nextMode === "downloaded" &&
      isDirtyGlobalSkillFile &&
      typeof window.confirm === "function" &&
      !window.confirm(t("skillLibrary.confirm.leaveLocal"))
    ) {
      return false
    }
    setSkillLibraryMode(nextMode)
    return true
  }

  function handleOpenSkillMarketplace() {
    if (isPreparingSettingsPage) return
    if (isOpen) closeSettings()
    setIsSkillMarketplaceOpen(true)
  }

  const isMacOS = platform === "darwin"
  const isWindows = platform === "win32"
  const htmlBackgroundAppearance = resolveHtmlBackgroundAppearance(htmlBackgroundConfig)
  const hasHtmlBackground = htmlBackgroundAppearance.hasHtmlBackground
  const windowShellClassName = [
    "window-shell",
    hasHtmlBackground ? "has-html-background" : "",
    isMacOS ? "is-macos" : "",
    isWindows ? "is-windows" : "",
    isDebugLineColorsEnabled ? "debug-line-colors" : "",
    isDebugUiRegionsEnabled ? "debug-ui-regions" : "",
    isWindowMaximized ? "is-maximized" : "",
  ]
    .filter(Boolean)
    .join(" ")
  const isResourcesView = leftSidebarView === "resources"
  const isAutomationsView = leftSidebarView === "automations"
  const isCalendarView = leftSidebarView === "calendar"
  const isConnectionsView = leftSidebarView === "connections"
  const isMobileView = leftSidebarView === "mobile"
  const isBuiltinToolsView = leftSidebarView === "tools"
  const isShellSidebarManagedView = isResourcesView || isBuiltinToolsView
  const isRegistrySkillLibraryView = isResourcesView && promptSkillMode === "skills"
  const isFullSurfaceView = isConnectionsView || isMobileView || isAutomationsView || isCalendarView || isRegistrySkillLibraryView
  useEffect(() => {
    if (isResourcesView && promptSkillMode === "skills") return
    setIsSkillMarketplaceOpen(false)
  }, [isResourcesView, promptSkillMode])
  const windowControls = useMemo(
    () => (
      isMacOS
        ? <NativeMacWindowControlsSlot controlsRef={windowControlsRef} />
        : <WindowChrome controlsRef={windowControlsRef} isWindowMaximized={isWindowMaximized} onWindowAction={handleWindowAction} />
    ),
    [handleWindowAction, isMacOS, isWindowMaximized, windowControlsRef],
  )
  const openCalendarProjects = useMemo(() => {
    const projectsByID = new Map<string, CalendarProjectOption>()
    for (const workspace of workspaces) {
      const project = mapWorkspaceGroupToCalendarProject(workspace)
      const id = project.id.trim()
      if (!id || projectsByID.has(id)) continue
      projectsByID.set(id, {
        ...project,
        id,
        name: project.name.trim() || getCalendarProjectFallbackName(project.directory, id),
      })
    }
    return Array.from(projectsByID.values()).sort((left, right) => left.name.localeCompare(right.name))
  }, [workspaces])
  const calendarProjects = useMemo(() => {
    const projectsByID = new Map<string, CalendarProjectOption>()
    for (const project of loadedCalendarProjects) {
      const id = project.id.trim()
      if (!id) continue
      projectsByID.set(id, {
        ...project,
        id,
        name: project.name.trim() || getCalendarProjectFallbackName(project.directory, id),
      })
    }
    for (const project of openCalendarProjects) {
      const id = project.id.trim()
      if (!id || projectsByID.has(id)) continue
      projectsByID.set(id, { ...project, id })
    }
    return Array.from(projectsByID.values()).sort((left, right) => left.name.localeCompare(right.name))
  }, [loadedCalendarProjects, openCalendarProjects])
  const automationProjects = useMemo(() => workspaces.map((workspace) => ({
    directory: workspace.directory,
    id: workspace.id,
    name: workspace.name,
    projectID: workspace.project.id,
    projectKind: workspace.project.kind,
    repositoryRoot: workspace.project.repositoryRoot,
    vcs: workspace.project.vcs,
    worktree: workspace.project.worktree,
    workspaceRoots: workspace.project.workspaceRoots,
  })), [workspaces])
  const workbenchWindowControls = useMemo(
    () => (
      isMacOS
        ? <NativeMacWindowControlsSlot controlsRef={null} />
        : <WindowChrome controlsRef={null} isWindowMaximized={isWindowMaximized} onWindowAction={handleWindowAction} />
    ),
    [handleWindowAction, isMacOS, isWindowMaximized],
  )
  const appShellClassName = [
    "app-shell",
    isOpen ? "is-settings-open" : "",
    isSkillMarketplaceOpen ? "is-skill-marketplace-open" : "",
  ].filter(Boolean).join(" ")
  const effectiveAppShellStyle = isShellSidebarManagedView
    ? {
        ...appShellStyle,
        "--right-sidebar-display-width": "0px",
        "--right-sidebar-resizer-width": "0px",
      }
    : appShellStyle
  return (
    <WorkspaceStoreProvider store={workspaceStore}>
      <ThreadLinkRoutingProvider openInAnybox={handleOpenThreadLinkInAnybox}>
        <div
          className={windowShellClassName}
          data-background-mode={htmlBackgroundAppearance.backgroundMode}
        >
        <HtmlBackgroundLayer config={htmlBackgroundConfig} />
        <main ref={appShellRef} className={appShellClassName} style={effectiveAppShellStyle}>
        {isActivityRailVisible ? (
          <ActivityRail
            activeView={leftSidebarView}
            isSettingsOpen={isOpen}
            isSidebarCollapsed={isSidebarCollapsed}
            onOpenSettings={handleOpenSettings}
            onViewChange={handleLeftSidebarViewChange}
            onToggleSidebar={handleSidebarToggle}
            side="left"
          />
        ) : null}

        {!isSidebarCollapsed && !isFullSurfaceView ? (
          <>
            <Sidebar
              activeSessionID={activeSession?.id ?? null}
              activeView={leftSidebarView}
              deletingSessionID={deletingSessionID}
              expandedFolderIDs={expandedFolderIDs}
              globalSkillsNavigatorProps={{
                creatingGlobalSkillName,
                creatingGlobalSkillDraftKind,
                creatingGlobalSkillParentDirectory,
                deletingGlobalSkillDirectory,
                expandedSkillPaths,
                globalSkillsRoot,
                globalSkillsTree,
                isCreateGlobalSkillDraftVisible,
                isCreatingGlobalSkill,
                isInstallingLocalSkill,
                isLoadingSkillsTree: isLoadingGlobalSkillsTree,
                renamingGlobalSkillDirectory,
                renamingGlobalSkillDraftDirectory,
                renamingGlobalSkillName,
                selectedGlobalSkillFilePath,
                onCreateGlobalSkill: handleCreateGlobalSkill,
                onCreateGlobalSkillDraftCancel: handleCreateGlobalSkillDraftCancel,
                onCreateGlobalSkillDraftChange: handleCreateGlobalSkillDraftChange,
                onCreateGlobalSkillDraftStart: handleCreateGlobalSkillDraftStart,
                onDeleteGlobalSkill: handleDeleteGlobalSkill,
                onGitInstallDialogOpen: handleGitInstallDialogOpen,
                onGlobalSkillDirectoryToggle: handleGlobalSkillDirectoryToggle,
                onGlobalSkillFileSelect: handleGlobalSkillFileSelect,
                onLocalInstallDialogOpen: handleLocalInstallDialogOpen,
                onMoveGlobalSkillDirectoryStart: handleMoveGlobalSkillDirectoryStart,
                onOpenGlobalSkillsFolder: handleOpenGlobalSkillsFolder,
                onRenameGlobalSkill: handleRenameGlobalSkill,
                onRenameGlobalSkillDraftCancel: handleRenameGlobalSkillDraftCancel,
                onRenameGlobalSkillDraftChange: handleRenameGlobalSkillDraftChange,
                onRenameGlobalSkillDraftStart: handleRenameGlobalSkillDraftStart,
              }}
              hoveredFolderID={hoveredFolderID}
              isCreatingProject={isCreatingProject}
              isCreatingSession={isCreatingSession}
              creatingWorktreeProjectID={creatingWorktreeProjectID}
              isSettingsOpen={isOpen}
              promptSkillMode={promptSkillMode}
              promptPresetsSidebarProps={{
                deletingPromptPresetID,
                isCreatingPromptPreset,
                isInstallingPromptUrlPrompts,
                isPreviewingPromptUrlInstall,
                isPromptDirty,
                promptRoot,
                promptPresets,
                promptPresetSelection,
                selectedPromptPreset,
                onCreatePromptPreset: createPromptPreset,
                onDeletePromptPreset: deletePromptPreset,
                onOpenPromptFolder: openPromptFolder,
                onPromptPresetSelect: selectPromptPreset,
                onPromptUrlInstallDialogOpen: openPromptUrlInstallDialog,
              }}
              showSettingsButton={!isActivityRailVisible}
              showSidebarToggleButton={!isActivityRailVisible}
              builtinToolsSidebarProps={{
                activeToolKind: activeBuiltinToolKind,
                builtinTools,
                onActiveToolKindChange: setActiveBuiltinToolKind,
              }}
              projectRowRefs={projectRowRefs}
              conversationWorkspaceID={conversationWorkspaceID}
              protectedWorkspaceIDs={protectedWorkspaceIDs}
              runningSessionIDs={runningSessionIDs}
              selectedFolderID={selectedFolderID}
              sessionCanvasUnreadBySession={sessionCanvasUnreadBySession}
              visibleCanvasSessionIDs={visibleCanvasSessionIDs}
              workspaces={workspaces}
              pinnedWorkspaceIDs={pinnedWorkspaceIDs}
              onHoveredFolderChange={setHoveredFolderID}
              onOpenSettings={handleOpenSettings}
              onOpenRemoteFolderConfig={handleOpenRemoteFolderConfig}
              onProjectArchiveSessions={handleProjectArchiveSessions}
              onProjectCreateAutomation={(workspace) => setAutomationCreateProjectID(workspace.id)}
              onProjectCreateSession={handleProjectCreateSession}
              onProjectCreateWorktree={handleProjectCreateWorktree}
              onProjectClick={handleProjectClick}
              onProjectOpenCinema={handleProjectOpenCinema}
              onProjectOpenInExplorer={handleProjectOpenInExplorer}
              onProjectPin={handleProjectPin}
              onProjectRemove={handleProjectRemove}
              onConversationClick={() => handleSidebarAction("conversation")}
              onSessionDelete={handleSessionDelete}
              onSessionPin={handleSessionPin}
              onSessionPopout={handleSessionPopout}
              onSessionRename={handleSessionRename}
              onSessionSelect={handleSessionSelect}
              onSessionSplitRight={handleSessionSplitRight}
              onSidebarAction={handleSidebarAction}
              onToggleSidebar={handleSidebarToggle}
            />

            <SidebarResizer
              isSidebarResizing={isSidebarResizing}
              maxWidth={sidebarWidthBounds.max}
              minWidth={sidebarWidthBounds.min}
              side="left"
              sidebarWidth={sidebarWidth}
              onKeyDown={handleSidebarResizerKeyDown}
              onPointerDown={handleSidebarResizerPointerDown}
            />
          </>
        ) : null}

        <section
          className={
            isFullSurfaceView
              ? "canvas is-workbench is-full-surface"
              : "canvas is-workbench"
          }
        >
          {isResourcesView ? (
            <PromptSkillsPage
              mode={promptSkillMode}
              windowControls={windowControls}
              onModeChange={handlePromptSkillModeChange}
            >
              <Suspense fallback={null}>
                {promptSkillMode === "prompts" ? (
                  <PromptPresetsPage
                    deletingPromptPresetID={deletingPromptPresetID}
                    hideNavigator
                    hideTopMenu
                    isCreatingPromptPreset={isCreatingPromptPreset}
                    isLoadingPromptPreset={isLoadingPromptPreset}
                    isLoadingPrompts={isLoadingPrompts}
                    isInstallingPromptUrlPrompts={isInstallingPromptUrlPrompts}
                    isPreviewingPromptUrlInstall={isPreviewingPromptUrlInstall}
                    isPromptDirty={isPromptDirty}
                    isPromptUrlInstallDialogOpen={isPromptUrlInstallDialogOpen}
                    isSavingPromptPresetSelection={isSavingPromptPresetSelection}
                    isTranslatingPromptPreset={isTranslatingPromptPreset}
                    models={models}
                    promptDraftContent={promptDraftContent}
                    promptDraftLabel={promptDraftLabel}
                    promptLoadError={promptLoadError}
                    promptRoot={promptRoot}
                    promptPresets={promptPresets}
                    promptPresetSelection={promptPresetSelection}
                    promptUrlInstallMessage={promptUrlInstallMessage}
                    promptUrlInstallPreview={promptUrlInstallPreview}
                    promptUrlInstallSource={promptUrlInstallSource}
                    resettingPromptPresetID={resettingPromptPresetID}
                    savingPromptPresetID={savingPromptPresetID}
                    selectedPromptPreset={selectedPromptPreset}
                    selectedPromptUrlInstallIDs={selectedPromptUrlInstallIDs}
                    onCreatePromptPreset={createPromptPreset}
                    onDeletePromptPreset={deletePromptPreset}
                    onInstallPromptsFromUrl={installPromptsFromUrl}
                    onPromptUrlInstallDialogClose={closePromptUrlInstallDialog}
                    onPromptUrlInstallDialogOpen={openPromptUrlInstallDialog}
                    onPromptUrlInstallPromptToggle={togglePromptUrlInstallPrompt}
                    onPromptUrlInstallSourceChange={setPromptUrlInstallSourceValue}
                    onPromptDraftChange={setPromptDraftValue}
                    onPromptDraftLabelChange={setPromptDraftLabelValue}
                    onPromptPresetSelect={selectPromptPreset}
                    onPromptPresetSelectionChange={setPromptPresetSelectionValue}
                    onPreviewPromptUrlInstall={previewPromptUrlInstall}
                    onOpenPromptFolder={openPromptFolder}
                    onResetPromptPreset={resetPromptPreset}
                    onSavePromptPreset={savePromptPreset}
                    onTranslatePromptPreset={translatePromptPreset}
                  />
                ) : (
                  <SkillsWorkspacePage
                    isMarketplaceOpen={isSkillMarketplaceOpen}
                    localNavigatorProps={{
                      creatingGlobalSkillName,
                      creatingGlobalSkillDraftKind,
                      creatingGlobalSkillParentDirectory,
                      deletingGlobalSkillDirectory,
                      expandedSkillPaths,
                      globalSkillsRoot,
                      globalSkillsTree,
                      isCreateGlobalSkillDraftVisible,
                      isCreatingGlobalSkill,
                      isInstallingLocalSkill,
                      isLoadingSkillsTree: isLoadingGlobalSkillsTree,
                      renamingGlobalSkillDirectory,
                      renamingGlobalSkillDraftDirectory,
                      renamingGlobalSkillName,
                      selectedGlobalSkillFilePath,
                      onCreateGlobalSkill: handleCreateGlobalSkill,
                      onCreateGlobalSkillDraftCancel: handleCreateGlobalSkillDraftCancel,
                      onCreateGlobalSkillDraftChange: handleCreateGlobalSkillDraftChange,
                      onCreateGlobalSkillDraftStart: handleCreateGlobalSkillDraftStart,
                      onDeleteGlobalSkill: handleDeleteGlobalSkill,
                      onGitInstallDialogOpen: handleGitInstallDialogOpen,
                      onGlobalSkillDirectoryToggle: handleGlobalSkillDirectoryToggle,
                      onGlobalSkillFileSelect: handleGlobalSkillFileSelect,
                      onLocalInstallDialogOpen: handleLocalInstallDialogOpen,
                      onMoveGlobalSkillDirectoryStart: handleMoveGlobalSkillDirectoryStart,
                      onOpenGlobalSkillsFolder: handleOpenGlobalSkillsFolder,
                      onRenameGlobalSkill: handleRenameGlobalSkill,
                      onRenameGlobalSkillDraftCancel: handleRenameGlobalSkillDraftCancel,
                      onRenameGlobalSkillDraftChange: handleRenameGlobalSkillDraftChange,
                      onRenameGlobalSkillDraftStart: handleRenameGlobalSkillDraftStart,
                    }}
                    mode={skillLibraryMode}
                    onMarketplaceClose={() => setIsSkillMarketplaceOpen(false)}
                    onMarketplaceOpen={handleOpenSkillMarketplace}
                    onModeChange={handleSkillLibraryModeChange}
                    onBeforeForkToLocal={() => {
                      if (!isDirtyGlobalSkillFile) return true
                      return typeof window.confirm === "function"
                        ? window.confirm(t("skillLibrary.forkDirtyConfirm"))
                        : false
                    }}
                    onBeforeSelectDownloaded={() => {
                      if (!isDirtyGlobalSkillFile) return true
                      return typeof window.confirm === "function"
                        ? window.confirm(t("skillLibrary.confirm.leaveLocal"))
                        : false
                    }}
                    onForkedToLocal={async (result) => {
                      await refreshGlobalSkillsTree(result.filePath)
                      await refreshComposerSkills()
                      setSkillLibraryMode("local")
                    }}
                  >
                    <GlobalSkillsPage
                    creatingGlobalSkillName={creatingGlobalSkillName}
                    creatingGlobalSkillDraftKind={creatingGlobalSkillDraftKind}
                    creatingGlobalSkillParentDirectory={creatingGlobalSkillParentDirectory}
                    deletingGlobalSkillDirectory={deletingGlobalSkillDirectory}
                    expandedSkillPaths={expandedSkillPaths}
                    globalSkillFolderOptions={globalSkillFolderOptions}
                    globalSkillsRoot={globalSkillsRoot}
                    globalSkillsTree={globalSkillsTree}
                    hideNavigator
                    hideTopMenu
                    gitInstallTargetDirectory={gitInstallTargetDirectory}
                    gitInstallPreview={gitInstallPreview}
                    gitInstallSource={gitInstallSource}
                    isCreateGlobalSkillDraftVisible={isCreateGlobalSkillDraftVisible}
                    isCreatingGlobalSkill={isCreatingGlobalSkill}
                    isDirty={isDirtyGlobalSkillFile}
                    isGitInstallDialogOpen={isGitInstallDialogOpen}
                    isInstallingGitSkills={isInstallingGitSkills}
                    isInstallingLocalSkill={isInstallingLocalSkill}
                    isLocalInstallDialogOpen={isLocalInstallDialogOpen}
                    isLoadingFile={isLoadingGlobalSkillFile}
                    isLoadingSkillsTree={isLoadingGlobalSkillsTree}
                    isMoveGlobalSkillDialogOpen={isMoveGlobalSkillDialogOpen}
                    isMovingGlobalSkillDirectory={isMovingGlobalSkillDirectory}
                    isPreviewingGitInstall={isPreviewingGitInstall}
                    isSavingFile={isSavingGlobalSkillFile}
                    localInstallTargetDirectory={localInstallTargetDirectory}
                    moveGlobalSkillTargetOptions={moveGlobalSkillTargetOptions}
                    movingGlobalSkillDirectory={movingGlobalSkillDirectory}
                    movingGlobalSkillTargetDirectory={movingGlobalSkillTargetDirectory}
                    renamingGlobalSkillDirectory={renamingGlobalSkillDirectory}
                    renamingGlobalSkillDraftDirectory={renamingGlobalSkillDraftDirectory}
                    renamingGlobalSkillName={renamingGlobalSkillName}
                    selectedFileContent={selectedGlobalSkillFileContent}
                    selectedFilePath={selectedGlobalSkillFilePath}
                    selectedFileReadOnly={selectedGlobalSkillFileReadOnly}
                    selectedGitInstallSkillIDs={selectedGitInstallSkillIDs}
                    selectedSkillDirectoryName={selectedGlobalSkillDirectory?.name ?? null}
                    onChange={handleGlobalSkillDraftChange}
                    onCreateGlobalSkill={handleCreateGlobalSkill}
                    onCreateGlobalSkillDraftCancel={handleCreateGlobalSkillDraftCancel}
                    onCreateGlobalSkillDraftChange={handleCreateGlobalSkillDraftChange}
                    onCreateGlobalSkillDraftStart={handleCreateGlobalSkillDraftStart}
                    onDelete={handleDeleteGlobalSkill}
                    onDeleteGlobalSkill={handleDeleteGlobalSkill}
                    onGitInstallDialogClose={handleGitInstallDialogClose}
                    onGitInstallDialogOpen={handleGitInstallDialogOpen}
                    onGitInstallSkillToggle={handleGitInstallSkillToggle}
                    onGitInstallSourceChange={handleGitInstallSourceChange}
                    onGitInstallTargetDirectoryChange={handleGitInstallTargetDirectoryChange}
                    onGlobalSkillDirectoryToggle={handleGlobalSkillDirectoryToggle}
                    onGlobalSkillFileSelect={handleGlobalSkillFileSelect}
                    onInstallGitSkills={handleInstallGitSkills}
                    onInstallLocalSkillFile={handleInstallLocalSkillFile}
                    onLocalInstallDialogClose={handleLocalInstallDialogClose}
                    onLocalInstallDialogOpen={handleLocalInstallDialogOpen}
                    onLocalInstallTargetDirectoryChange={handleLocalInstallTargetDirectoryChange}
                    onMoveGlobalSkillDirectory={handleMoveGlobalSkillDirectory}
                    onMoveGlobalSkillDirectoryCancel={handleMoveGlobalSkillDirectoryCancel}
                    onMoveGlobalSkillDirectoryStart={handleMoveGlobalSkillDirectoryStart}
                    onMoveGlobalSkillTargetDirectoryChange={handleMoveGlobalSkillTargetDirectoryChange}
                    onOpenGlobalSkillsFolder={handleOpenGlobalSkillsFolder}
                    onPreviewGitSkillInstall={handlePreviewGitSkillInstall}
                    onRenameGlobalSkill={handleRenameGlobalSkill}
                    onRenameGlobalSkillDraftCancel={handleRenameGlobalSkillDraftCancel}
                    onRenameGlobalSkillDraftChange={handleRenameGlobalSkillDraftChange}
                    onRenameGlobalSkillDraftStart={handleRenameGlobalSkillDraftStart}
                      onSave={handleSaveGlobalSkillFile}
                    />
                  </SkillsWorkspacePage>
                )}
              </Suspense>
            </PromptSkillsPage>
          ) : isCalendarView ? (
            <Suspense fallback={null}>
              <CalendarPage
                projects={calendarProjects}
                quickAddProjects={openCalendarProjects}
                windowControls={windowControls}
              />
            </Suspense>
          ) : isMobileView ? (
            <MobileConnectionPage
              activePanel={activeMobileConnectionPanel}
              windowControls={windowControls}
              onActivePanelChange={setActiveMobileConnectionPanel}
              onWorkspaceOpened={async (workspace) => {
                await refreshWorkspaceFromDirectory(workspace.directory)
              }}
              showAdvancedInfo={isMobileConnectionAdvancedInfoEnabled}
            />
          ) : isAutomationsView ? (
            <Suspense fallback={null}>
              <AutomationsPage
                projects={automationProjects}
                windowControls={windowControls}
                onOpenSession={(sessionID) => handleCanvasSessionTabSelect(sessionID)}
              />
            </Suspense>
          ) : isConnectionsView ? (
            <ConnectionsPage
              activeTab={activeConnectionsTab}
              connectorCount={accountConnectorCount}
              mcpCount={mcpInventoryServers.length}
              pluginCount={pluginCatalog.length}
              searchQuery={connectionSearchQueries[activeConnectionsTab]}
              windowControls={windowControls}
              onSearchQueryChange={handleConnectionSearchQueryChange}
              onTabChange={setActiveConnectionsTab}
            >
              {activeConnectionsTab === "plugins" ? (
                <Suspense fallback={null}>
                  <PluginsPage
                    activePluginID={activePluginID}
                    connectorStatuses={connectorStatuses}
                    deletingPluginID={deletingPluginID}
                    diagnosingPluginConnectorID={diagnosingPluginConnectorID}
                    diagnosingPluginID={diagnosingPluginID}
                    hideTopMenu
                    installingPluginID={installingPluginID}
                    installedPlugins={installedPlugins}
                    isLoading={isLoadingPlugins}
                    loadError={pluginsError}
                    pluginCatalog={pluginCatalog}
                    pluginConnectorStatuses={pluginConnectorStatuses}
                    pluginDiagnostics={pluginDiagnostics}
                    pluginDraft={pluginDraft}
                    diagnosingMcpServerID={diagnosingMcpServerID}
                    mcpDiagnostics={mcpDiagnostics}
                    mcpServers={mcpServers}
                    savingPluginConnectorID={savingPluginConnectorID}
                    savingMcpServerID={savingMcpServerID}
                    searchQuery={connectionSearchQueries.plugins}
                    updatingPluginID={updatingPluginID}
                    onCancelInstalledPluginConnectorAuthFlow={cancelInstalledPluginConnectorAuthFlow}
                    onDeleteInstalledPlugin={deleteInstalledPlugin}
                    onDeleteInstalledPluginConnectorApiKey={deleteInstalledPluginConnectorApiKey}
                    onDeleteInstalledPluginConnectorAuthSession={deleteInstalledPluginConnectorAuthSession}
                    onDiagnoseInstalledPlugin={diagnoseInstalledPlugin}
                    onDiagnoseInstalledPluginConnector={diagnoseInstalledPluginConnector}
                    onDiagnoseMcpServer={diagnoseMcpServer}
                    onImportPluginFromURL={importPluginFromURL}
                    onInstallPlugin={installPlugin}
                    onPluginDraftAppApiKeyChange={setPluginDraftAppApiKey}
                    onPluginDraftConfigChange={setPluginDraftConfigValue}
                    onPluginDeselect={clearPluginSelection}
                    onPluginSelect={selectPlugin}
                    onSaveInstalledPluginConnectorApiKey={saveInstalledPluginConnectorApiKey}
                    onSaveInstalledPluginConfig={saveInstalledPluginConfig}
                    onSearchQueryChange={handleConnectionSearchQueryChange}
                    onSetInstalledPluginEnabled={setInstalledPluginEnabled}
                    onSetInstalledPluginMcpEnabled={setInstalledPluginMcpEnabled}
                    onSetInstalledPluginMcpToolPolicy={setInstalledPluginMcpToolPolicy}
                    onManageConnector={(connectorID) => {
                      setActiveConnectionsTab("connectors")
                      selectConnector(connectorID)
                    }}
                    onManageMcpServer={(serverID) => {
                      setActiveConnectionsTab("mcp")
                      selectMcpServer(serverID)
                    }}
                    onStartInstalledPluginConnectorAuthFlow={startInstalledPluginConnectorAuthFlow}
                  />
                </Suspense>
              ) : activeConnectionsTab === "connectors" ? (
                <Suspense fallback={null}>
                  <ConnectorsPage
                    activeConnectorID={activeConnectorID}
                    connectorApiKeyDrafts={connectorApiKeyDrafts}
                    connectorCatalog={connectorCatalog}
                    connectorConfigDrafts={connectorConfigDrafts}
                    connectorStatuses={connectorStatuses}
                    connectorsError={connectorsError}
                    diagnosingConnectorMcpServerID={diagnosingConnectorMcpServerID}
                    hideTopMenu
                    isLoading={isLoadingConnectors}
                    mcpDiagnostics={mcpDiagnostics}
                    mcpServers={mcpServers}
                    savingConnectorID={savingConnectorID}
                    savingConnectorMcpServerID={savingMcpServerID}
                    searchQuery={connectionSearchQueries.connectors}
                    onCancelConnectorAuthFlow={cancelConnectorAuthFlow}
                    onConnectorApiKeyDraftChange={setConnectorApiKeyDraft}
                    onConnectorConfigDraftChange={setConnectorConfigDraft}
                    onConnectorSelect={selectConnector}
                    onDeleteConnectorApiKey={deleteConnectorApiKey}
                    onDeleteConnectorConfig={deleteConnectorConfig}
                    onDeleteConnectorAuthSession={deleteConnectorAuthSession}
                    onDiagnoseConnector={diagnoseConnector}
                    onConnectorMcpEnabledChange={setConnectorMcpEnabled}
                    onConnectorMcpToolPolicyChange={setConnectorMcpToolPolicy}
                    onSaveConnectorApiKey={saveConnectorApiKey}
                    onSaveConnectorConfig={saveConnectorConfig}
                    onSearchQueryChange={handleConnectionSearchQueryChange}
                    onStartConnectorAuthFlow={startConnectorAuthFlow}
                  />
                </Suspense>
              ) : (
                <McpServersPage
                  activeMcpServerID={activeMcpServerID}
                  activeMcpServerDiagnostic={activeMcpServerDiagnostic}
                  connectorCatalog={connectorCatalog}
                  deletingMcpServerID={deletingMcpServerID}
                  diagnosingMcpServerID={diagnosingMcpServerID}
                  hideTopMenu
                  isLoading={isLoading}
                  loadError={loadError}
                  installedPlugins={installedPlugins}
                  mcpServerDraft={mcpServerDraft}
                  mcpServers={mcpInventoryServers}
                  pluginCatalog={pluginCatalog}
                  savingMcpServerID={savingMcpServerID}
                  isImportingMcpConfigJson={isImportingMcpConfigJson}
                  searchQuery={connectionSearchQueries.mcp}
                  onDeleteMcpServer={deleteMcpServer}
                  onDiagnoseMcpServer={diagnoseMcpServer}
                  onImportMcpConfigJson={importMcpConfigJson}
                  onMcpServerDraftChange={setMcpServerDraftValue}
                  onMcpToolPolicyChange={setMcpToolPolicy}
                  onMcpServerSelect={selectMcpServer}
                  onSaveMcpServer={saveMcpServer}
                  onSearchQueryChange={handleConnectionSearchQueryChange}
                  onStartNewMcpServer={startNewMcpServer}
                />
              )}
            </ConnectionsPage>
          ) : isBuiltinToolsView ? (
            <BuiltinToolsPage
              activeToolKind={activeBuiltinToolKind}
              builtinTools={builtinTools}
              builtinToolsError={builtinToolsError}
              hideNavigator
              isBuiltinToolSelectionDirty={isBuiltinToolSelectionDirty}
              isLoadingBuiltinTools={isLoadingBuiltinTools}
              isSavingBuiltinTools={isSavingBuiltinTools}
              windowControls={windowControls}
              onActiveToolKindChange={setActiveBuiltinToolKind}
              onBuiltinToolToggle={setBuiltinToolEnabled}
              onResetBuiltinTools={resetBuiltinTools}
              onSaveBuiltinTools={saveBuiltinTools}
            />
          ) : (
            <>
              <WorkbenchShell
                composerCommandStatusByTabKey={composerCommandStatusByTabKey}
                composerRefreshVersion={composerRefreshVersion}
                assistantTraceVisibility={assistantTraceVisibility}
                codeTheme={resolvedCodeTheme}
                isActivityRailVisible={isActivityRailVisible}
                isResolvingPermissionRequest={isResolvingPermissionRequest}
                isSavingToolPermissionMode={isSavingToolPermissionMode}
                isRightSidebarCollapsed={isRightSidebarCollapsed}
                isSidebarCollapsed={isSidebarCollapsed}
                platform={platform}
                store={workspaceStore}
                windowControls={isRightSidebarCollapsed ? workbenchWindowControls : null}
                readThreadScrollSnapshot={readThreadScrollSnapshot}
                saveThreadScrollSnapshot={saveThreadScrollSnapshot}
                threadNavigationRequestBySession={threadNavigationRequestBySession}
                permissionRequestActionError={permissionRequestActionError}
                permissionRequestActionRequestID={permissionRequestActionRequestID}
                toolPermissionMode={toolPermissionMode}
                toolPermissionModeError={toolPermissionModeError}
                conversationWorkspaceID={conversationWorkspaceID}
                surfaceID={surfaceID}
                onCloseCreateSessionTab={handleCloseCreateSessionTab}
                onCloseSessionTab={handleCanvasSessionTabClose}
                onCreateSessionSubmit={handleCreateSessionSubmit}
                onCreateSessionWorkspaceChange={handleCreateSessionWorkspaceChange}
                onOpenProjectFolder={() => handleSidebarAction("project")}
                onActiveDockviewChange={handleDockviewActiveChange}
                onDetachSessionPanel={handleDetachSessionPanel}
                onFocusPane={handlePaneFocus}
                onInspectFileInSidebar={handleInspectFileInSidebar}
                onCommandsReady={handleWorkbenchDockviewCommandsReady}
                onLayoutChange={setDockviewLayout}
                onArtifactLinkOpen={handleArtifactLinkOpen}
                onLocalFileLinkOpen={handleLocalFileLinkOpen}
                onMoveSessionPanel={handleMoveSessionPanel}
                onBranchSelect={handleSessionBranchSelect}
                onClearComposerParentMessage={handleClearComposerParentMessage}
                onOpenCreateSessionTab={handleOpenCreateSessionTab}
                onOpenSideChat={handleOpenSideChatInRightSidebar}
                onOpenSubagentSession={handleOpenSubagentSessionTab}
                onForkFromMessage={handleForkFromMessage}
                onPermissionRequestResponse={handlePermissionRequestResponse}
                onApproveProposedPlan={handleApproveProposedPlan}
                onToolPermissionModeChange={handleToolPermissionModeChange}
                onAskUserQuestionAnswer={handleAskUserQuestionAnswer}
                onPickComposerAttachments={handlePickComposerAttachments}
                onPasteComposerImageAttachments={handlePasteComposerImageAttachments}
                onRemoveComposerAttachment={handleRemoveComposerAttachment}
                onSelectCreateSessionTab={handleCreateSessionTabSelect}
                onSelectSessionTab={handleCanvasSessionTabSelect}
                onCancelSend={handleCancelSend}
                onPlanModeToggle={handlePlanModeToggle}
                onSend={handleSend}
                onSessionModelSelectionChange={handleSessionModelSelectionChange}
                onSetDraft={setDraftForTab}
                onToggleLeftSidebar={handleSidebarToggle}
                onToggleRightSidebar={handleRightSidebarToggle}
                onMessageDiffRestore={handleMessageDiffRestore}
                onMessageDiffReview={handleMessageDiffReview}
                onMessageDiffSummaryHydrate={handleMessageDiffSummaryHydrate}
              />
            </>
          )}
        </section>

        {!isFullSurfaceView && !isShellSidebarManagedView && !isRightSidebarCollapsed ? (
          <>
            <SidebarResizer
              isSidebarResizing={isRightSidebarResizing}
              maxWidth={rightSidebarWidthBounds.max}
              minWidth={rightSidebarWidthBounds.min}
              side="right"
              sidebarWidth={rightSidebarWidth}
              onKeyDown={handleRightSidebarResizerKeyDown}
              onPointerDown={handleRightSidebarResizerPointerDown}
            />

            <RightSidebar
              activeWorkspaceFileScopeDirectory={activeWorkspaceFileScopeDirectory}
              activeWorkspaceFileScopeName={activeWorkspaceFileScopeName}
              activeSessionDirectory={activeSessionDirectory}
              activeSession={activeSession}
              assistantTraceVisibility={assistantTraceVisibility}
              canOpenReview={Boolean(activeSession)}
              canOpenTerminal={Boolean(terminalSessionID)}
              codeTheme={resolvedCodeTheme}
              canInsertWorkspaceFileCommentsIntoDraft={canInsertWorkspaceFileCommentsIntoDraft}
              composerRefreshVersion={composerRefreshVersion}
              isAgentDebugTraceEnabled={isAgentDebugTraceEnabled}
              isResolvingPermissionRequest={isResolvingPermissionRequest}
              permissionRequestActionError={permissionRequestActionError}
              permissionRequestActionRequestID={permissionRequestActionRequestID}
              readThreadScrollSnapshot={readThreadScrollSnapshot}
              rightSidebar={rightSidebar}
              saveThreadScrollSnapshot={saveThreadScrollSnapshot}
              selectedDiffFileBySession={selectedDiffFileBySession}
              sessionDiffBySession={sessionDiffBySession}
              sessionDiffStateBySession={sessionDiffStateBySession}
              messageTreeBySession={messageTreeBySession}
              sideChatPanelState={liveRightSidebarSideChatPanelState}
              workspaces={workspaces}
              onActivateTab={handleActivateRightSidebarTab}
              onCloseTab={closeRightSidebarTab}
              onAskUserQuestionAnswer={handleAskUserQuestionAnswer}
              onArtifactLinkOpen={(target) =>
                handleArtifactLinkOpen({
                  paneID: "right-sidebar",
                  sessionID: rightSidebarThreadLinkContext?.session.id ?? null,
                  target,
                  workspaceDirectory: rightSidebarThreadLinkContext?.workspaceDirectory ?? null,
                  workspaceID: rightSidebarThreadLinkContext?.workspaceID ?? null,
                })
              }
              onDiffFileSelect={handleActiveSessionDiffFileSelect}
              onDiffFileRestore={handleActiveSessionDiffFileRestore}
              onSessionDiffScopeLoad={handleSessionDiffScopeLoad}
              onLocalFileLinkOpen={(target) =>
                handleLocalFileLinkOpen({
                  paneID: "right-sidebar",
                  sessionID: rightSidebarThreadLinkContext?.session.id ?? null,
                  target,
                  workspaceDirectory: rightSidebarThreadLinkContext?.workspaceDirectory ?? null,
                  workspaceID: rightSidebarThreadLinkContext?.workspaceID ?? null,
                })
              }
              onPreviewActiveInteractionChange={handlePreviewActiveInteractionChange}
              onPreviewBack={handlePreviewBack}
              onPreviewCommitInteraction={handlePreviewCommitInteraction}
              onPreviewDraftUrlChange={handlePreviewDraftUrlChange}
              onPreviewForward={handlePreviewForward}
              onPreviewOpen={handlePreviewOpen}
              onPreviewOpenExternal={handlePreviewOpenExternal}
              onPreviewOpenUrl={handlePreviewOpenUrl}
              onPreviewReload={handlePreviewReload}
              onPermissionRequestResponse={handlePermissionRequestResponse}
              onWorkspaceFileCommentCancel={handleWorkspaceFileCommentCancel}
              onWorkspaceFileCommentChange={handleWorkspaceFileCommentChange}
              onWorkspaceFileCommentConfirm={handleWorkspaceFileCommentConfirm}
              onWorkspaceFileCommentStart={handleWorkspaceFileCommentStart}
              onWorkspaceDirectoryLoad={handleWorkspaceDirectoryLoad}
              onWorkspaceDirectoryToggle={handleWorkspaceDirectoryToggle}
              onWorkspaceFileTreeInvalidate={handleWorkspaceFileTreeInvalidate}
              onWorkspaceFileQueryChange={handleWorkspaceFileQueryChange}
              onWorkspaceFileSelect={handleWorkspaceFileSelect}
              onOpenBrowserTab={handleOpenRightSidebarBrowserTab}
              onOpenFilesTab={handleOpenRightSidebarFilesTab}
              onOpenMessageTreeTab={handleOpenRightSidebarMessageTreeTab}
              onOpenReviewTab={handleOpenRightSidebarReviewTab}
              onOpenTerminalTab={handleOpenRightSidebarTerminalTab}
              onMessageTreeNodeSelect={handleMessageTreeNodeSelect}
              onSideChatCancelSend={() => handleCancelSend({
                sessionID: rightSidebarSideChatPanelState?.session.id,
                tabKey: rightSidebarSideChatPanelState?.tabKey,
              })}
              onSideChatCreate={(anchorMessageID, parentSessionID) =>
                handleCreateSideChatTab(anchorMessageID, {
                  parentSessionID,
                })
              }
              onSideChatDelete={handleDeleteSideChatTab}
              onSideChatDraftStateChange={(value) => {
                const tabKey = rightSidebarSideChatPanelState?.tabKey
                if (tabKey) {
                  setDraftForTab(tabKey, value)
                }
              }}
              onSideChatPasteImageAttachments={({ allowImage, disabledReason, images }) =>
                handlePasteComposerImageAttachments({
                  allowImage,
                  disabledReason,
                  images,
                  tabKey: rightSidebarSideChatPanelState?.tabKey,
                })
              }
              onSideChatPickAttachments={({ allowImage, allowPdf, disabledReason }) =>
                handlePickComposerAttachments({
                  allowImage,
                  allowPdf,
                  disabledReason,
                  tabKey: rightSidebarSideChatPanelState?.tabKey,
                })
              }
              onSideChatRemoveAttachment={(path) => handleRemoveComposerAttachment(path, rightSidebarSideChatPanelState?.tabKey)}
              onSideChatSelect={handleSelectSideChatTabInRightSidebar}
              onSideChatSend={(input) =>
                handleSend({
                  attachmentError: input.attachmentError,
                  draftStateOverride: input.draftStateOverride,
                  preserveComposerState: Boolean(input.questionAnswer),
                  questionAnswer: input.questionAnswer,
                  selectedReasoningEffort: input.selectedReasoningEffort,
                  selectedModel: input.selectedModel,
                  selectedSkillIDs: input.selectedSkillIDs,
                  sessionID: rightSidebarSideChatPanelState?.session.id,
                  submissionMode: input.submissionMode,
                  tabKey: rightSidebarSideChatPanelState?.tabKey,
                  waitForPendingModelSelection: input.waitForPendingModelSelection,
                })
              }
              onSessionModelSelectionChange={handleSessionModelSelectionChange}
              renderTerminalTab={(sessionID) => (
                <TerminalAreaHost
                  brandTheme={brandTheme}
                  colorMode={colorMode}
                  currentSessionID={sessionID}
                  layout="fill"
                  storageKey={WORKBENCH_TERMINAL_STORAGE_KEY}
                />
              )}
              windowControls={windowControls}
            />
          </>
        ) : null}

        {automationCreateProjectID ? (
          <Suspense fallback={null}>
            <AutomationCreatePanel
              initialProjectID={automationCreateProjectID}
              isOpen
              portal
              projects={automationProjects}
              onClose={() => setAutomationCreateProjectID(null)}
            />
          </Suspense>
        ) : null}

        {isOpen ? (
          <Suspense fallback={null}>
            <SettingsPage
              activeMcpServerID={activeMcpServerID}
              activeMcpServerDiagnostic={activeMcpServerDiagnostic}
              archivedSessions={archivedSessions}
              archivedSessionsError={archivedSessionsError}
              catalog={catalog}
              cinemaVideoProviders={cinemaVideoProviders}
              deletingArchivedSessionID={deletingArchivedSessionID}
              deletingMcpServerID={deletingMcpServerID}
              deletingProviderID={deletingProviderID}
              appearanceConfigError={appearanceConfigError}
              appearanceConfigPath={appearanceConfigPath}
              appearanceConfigPreview={appearanceConfigPreview}
              appearanceOverrides={appearanceOverrides}
              appearanceThemeError={appearanceThemeError}
              appearanceThemes={appearanceThemes}
              activeAppearanceThemeID={activeAppearanceThemeID}
              appearanceTokenValues={appearanceTokenValues}
              assistantTraceVisibility={assistantTraceVisibility}
              colorMode={colorMode}
              fontFamily={fontFamily}
              htmlBackgroundConfig={htmlBackgroundConfig}
              isActivityRailVisible={isActivityRailVisible}
              isAgentDebugTraceEnabled={isAgentDebugTraceEnabled}
              isDebugLineColorsEnabled={isDebugLineColorsEnabled}
              isDebugUiRegionsEnabled={isDebugUiRegionsEnabled}
              isMobileConnectionAdvancedInfoEnabled={isMobileConnectionAdvancedInfoEnabled}
              isDeletingAllArchivedSessions={isDeletingAllArchivedSessions}
              isLoading={isLoading}
              isLoadingArchivedSessions={isLoadingArchivedSessions}
              isLoadingStorageUsage={isLoadingStorageUsage}
              isOptimizingStorage={isOptimizingStorage}
              isOpen={isOpen}
              appUpdateState={appUpdateState}
              appUpdateStatus={appUpdateStatus}
              isCheckingAppUpdate={isCheckingAppUpdate}
              isSavingAutomaticUpdates={isSavingAutomaticUpdates}
              isRefreshingProviderCatalog={isRefreshingProviderCatalog}
              isRefreshingCinemaVideoProviderCatalog={isRefreshingCinemaVideoProviderCatalog}
              installedPlugins={installedPlugins}
              loadError={loadError}
              mcpServerDraft={mcpServerDraft}
              mcpServers={mcpInventoryServers}
              models={models}
              modelCatalog={modelCatalog}
              pluginCatalog={pluginCatalog}
              providerDrafts={providerDrafts}
              cinemaVideoProviderDrafts={cinemaVideoProviderDrafts}
              customProviderDraft={customProviderDraft}
              restoringArchivedSessionID={restoringArchivedSessionID}
              savingMcpServerID={savingMcpServerID}
              savingProviderID={savingProviderID}
              savingCinemaVideoProviderID={savingCinemaVideoProviderID}
              testingProviderID={testingProviderID}
              selectionDraft={selectionDraft}
              onColorModeChange={handleColorModeChange}
              onFontFamilyChange={handleFontFamilyChange}
              onHtmlBackgroundConfigChange={handleHtmlBackgroundConfigChange}
              onActivityRailVisibilityChange={handleActivityRailVisibilityChange}
              onAppearancePaletteReset={handleAppearancePaletteReset}
              onAppearanceThemeApply={handleAppearanceThemeApply}
              onAppearanceThemeDelete={handleAppearanceThemeDelete}
              onAppearanceThemeDuplicate={handleAppearanceThemeDuplicate}
              onAppearanceThemeRename={handleAppearanceThemeRename}
              onAppearanceThemeSaveCurrent={handleAppearanceThemeSaveCurrent}
              onAppearanceTokenChange={handleAppearanceTokenChange}
              onAppearanceTokenReset={handleAppearanceTokenReset}
              onAssistantTraceVisibilityChange={handleAssistantTraceVisibilityChange}
              onAgentDebugTraceChange={handleAgentDebugTraceChange}
              onDebugLineColorsChange={handleDebugLineColorsChange}
              onDebugUiRegionsChange={handleDebugUiRegionsChange}
              onMobileConnectionAdvancedInfoChange={handleMobileConnectionAdvancedInfoChange}
              onAutomaticUpdatesToggle={() => void handleAutomaticUpdatesToggle()}
              onCheckForUpdates={() => void handleCheckForUpdates()}
              onClose={closeSettings}
              onDeleteAllArchivedSessions={deleteAllArchivedSessions}
              onDeleteArchivedSession={deleteArchivedSession}
              onDeleteMcpServer={deleteMcpServer}
              onDeleteProvider={deleteProvider}
              onDeleteProviderAuthSession={deleteProviderAuthSession}
              onMcpServerDraftChange={setMcpServerDraftValue}
              onMcpToolPolicyChange={setMcpToolPolicy}
              onMcpServerSelect={selectMcpServer}
              onProviderAuthMethodChange={setProviderAuthMethod}
              onProviderDraftChange={setProviderDraftValue}
              onCinemaVideoProviderDraftChange={setCinemaVideoProviderDraftValue}
              onRefreshProviderCatalog={refreshProviderCatalog}
              onRefreshCinemaVideoProviderCatalog={refreshCinemaVideoProviderCatalog}
              onLoadArchivedSessions={loadArchivedSessions}
              onLoadStorageUsage={loadStorageUsage}
              onOptimizeStorage={optimizeStorage}
              onOpenUpdateCenter={() => void handleOpenUpdateCenter()}
              onRestoreArchivedSession={restoreArchivedSession}
              storageUsage={storageUsage}
              storageUsageError={storageUsageError}
              storageOptimizeMessage={storageOptimizeMessage}
              onSaveMcpServer={saveMcpServer}
              onSaveProviderApiKey={saveProviderApiKey}
              onSaveCinemaVideoProviderApiKey={saveCinemaVideoProviderApiKey}
              onSaveProvider={saveProvider}
              onSaveCustomProvider={saveCustomProvider}
              onSelectionChange={setSelectionDraftValue}
              onTestCinemaVideoProviderConnection={testCinemaVideoProviderConnection}
              onTestProviderConnection={testProviderConnection}
              onTestCustomProviderConnection={testCustomProviderConnection}
              onStartProviderAuthFlow={startProviderAuthFlow}
              onStartNewMcpServer={startNewMcpServer}
              onCancelProviderAuthFlow={cancelProviderAuthFlow}
              onCustomProviderDraftChange={setCustomProviderDraftValue}
              onCustomProviderDraftReset={resetCustomProviderDraft}
            />
          </Suspense>
        ) : null}

        {isUpdateDialogOpen ? (
          <UpdateDialog
            state={appUpdateState}
            status={appUpdateStatus}
            isChecking={isCheckingAppUpdate}
            isInstalling={isInstallingAppUpdate}
            onCheck={() => void handleCheckForUpdates()}
            onClose={() => setIsUpdateDialogOpen(false)}
            onInstall={() => void handleInstallAppUpdate()}
          />
        ) : null}
        </main>
        </div>
      </ThreadLinkRoutingProvider>
    </WorkspaceStoreProvider>
  )
}
