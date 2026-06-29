import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { SerializedDockview } from "dockview-react"
import { ActivityRail } from "./app/sidebar/ActivityRail"
import { BuiltinToolsPage } from "./app/tools/BuiltinToolsPage"
import { ConnectionsPage } from "./app/connections/ConnectionsPage"
import { MobileConnectionPage } from "./app/connections/MobileConnectionPage"
import { SshConnectionsPage } from "./app/connections/SshConnectionsPage"
import { McpServersPage } from "./app/mcp/McpServersPage"
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
import { useConversationMessages } from "./app/agent-workspace/conversation-store"
import { WorkspaceStoreProvider } from "./app/agent-workspace/workspace-store-context"
import { resolveWorkspaceRelativePath } from "./app/agent-workspace/workspace-loading-hooks"
import type { MarkdownArtifactLinkTarget, MarkdownLocalFileLinkTarget } from "./app/thread-markdown"
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
  WindowAction,
  WorkspaceGroup,
} from "./app/types"
import { useAgentWorkspace } from "./app/use-agent-workspace"
import { useAppearanceState } from "./app/use-appearance-state"
import { useDesktopShell } from "./app/use-desktop-shell"
import { useGlobalSkills } from "./app/use-global-skills"
import { useSettingsPage } from "./app/use-settings-page"
import { ToastProvider, useToast } from "./app/toast"
import { RendererProfiler, createRendererProfilerOnRender } from "./app/perf-profiler"
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
  AgentProjectWorkspace,
  DesktopAppUpdateState,
  WorkbenchSharedState,
  WorkbenchWindowContext,
} from "../../shared/desktop-ipc-contract"
import {
  checkForAppUpdates,
  getAppUpdateState,
  installAppUpdate,
  setAutomaticUpdatesEnabled,
} from "./app/settings/client"
import { UpdateDialog, type AppUpdateStatus } from "./app/update/UpdateDialog"
import { useI18n } from "./app/i18n/I18nProvider"
import type { TranslationKey } from "./app/i18n/translations"
import { PromptSkillsPage, type PromptSkillMode } from "./app/prompts/PromptSkillsPage"

const GlobalSkillsPage = lazy(() => import("./app/skills/GlobalSkillsPage").then((module) => ({ default: module.GlobalSkillsPage })))
const ConnectorsPage = lazy(() => import("./app/connectors/ConnectorsPage").then((module) => ({ default: module.ConnectorsPage })))
const PluginsPage = lazy(() => import("./app/plugins/PluginsPage").then((module) => ({ default: module.PluginsPage })))
const PromptPresetsPage = lazy(() => import("./app/prompts/PromptPresetsPage").then((module) => ({ default: module.PromptPresetsPage })))
const AutomationsPage = lazy(() => import("./app/automations/AutomationsPage").then((module) => ({ default: module.AutomationsPage })))
const CalendarPage = lazy(() => import("./app/calendar/CalendarPage").then((module) => ({ default: module.CalendarPage })))

function importSettingsPage() {
  return import("./app/settings/SettingsPage").then((module) => ({ default: module.SettingsPage }))
}

let settingsPageImportPromise: ReturnType<typeof importSettingsPage> | null = null

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
  ssh: "",
  mobile: "",
}
const EMPTY_SIDE_CHAT_DRAFT_STATE = createEmptyComposerDraftState()
const EMPTY_SIDE_CHAT_ATTACHMENTS: ComposerAttachment[] = []
const EMPTY_SIDE_CHAT_PENDING_INPUTS: PendingConversationInput[] = []
const EMPTY_SIDE_CHAT_PERMISSION_REQUESTS: PermissionRequest[] = []
const EMPTY_SIDE_CHAT_MESSAGES: ThreadMessage[] = []
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
    left.workspaceDirectory === right.workspaceDirectory &&
    left.workspaceID === right.workspaceID
  )
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
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
  } = useDesktopShell()
  const {
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
  const autoPromptedDownloadingUpdateRef = useRef<string | null>(null)
  const autoPromptedDownloadedUpdateRef = useRef<string | null>(null)
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

  useEffect(() => {
    if (!appUpdateState?.updateChecksSupported) return

    const updateKey = appUpdateState.latestVersion ?? appUpdateState.version ?? "unknown"
    if (appUpdateState.phase === "downloading") {
      if (autoPromptedDownloadingUpdateRef.current !== updateKey) {
        autoPromptedDownloadingUpdateRef.current = updateKey
        setIsUpdateDialogOpen(true)
      }
      return
    }

    if (appUpdateState.phase === "downloaded" && autoPromptedDownloadedUpdateRef.current !== updateKey) {
      autoPromptedDownloadedUpdateRef.current = updateKey
      setIsUpdateDialogOpen(true)
    }
  }, [appUpdateState])

  const {
    activeSession,
    activeSessionDirectory,
    activeWorkspaceFileScopeDirectory,
    activeWorkspaceFileScopeName,
    canInsertWorkspaceFileCommentsIntoDraft,
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
    handleSessionSelect,
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
    diagnoseInstalledPlugin,
    diagnoseInstalledPluginConnector,
    diagnosingPluginID,
    diagnosingPluginConnectorID,
    diagnosingConnectorID,
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
    isOpen,
    isPromptDirty,
    isPromptUrlInstallDialogOpen,
    isBuiltinToolSelectionDirty,
    isRefreshingProviderCatalog,
    isDeletingAllArchivedSessions,
    isInstallingPromptUrlPrompts,
    isPreviewingPromptUrlInstall,
    isTranslatingPromptPreset,
    isSavingPromptPresetSelection,
    isSavingBuiltinTools,
    loadError,
    loadArchivedSessions,
    mcpServerDraft,
    mcpServers,
    models,
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
    customProviderDraft,
    createPromptPreset,
    deletePromptPreset,
    closePromptUrlInstallDialog,
    openPromptFolder,
    openPromptUrlInstallDialog,
    previewPromptUrlInstall,
    refreshProviderCatalog,
    resetBuiltinTools,
    resetPromptPreset,
    resettingPromptPresetID,
    restoringArchivedSessionID,
    restoreArchivedSession,
    saveBuiltinTools,
    saveConnectorApiKey,
    saveConnectorConfig,
    saveInstalledPluginConfig,
    saveInstalledPluginConnectorApiKey,
    saveMcpServer,
    savePromptPreset,
    saveProviderApiKey,
    saveProvider,
    saveCustomProvider,
    savingMcpServerID,
    savingConnectorID,
    savingPromptPresetID,
    savingProviderID,
    savingPluginConnectorID,
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
    setConnectorApiKeyDraft,
    setMcpServerDraftValue,
    setMcpToolPolicy,
    setPluginDraftAppApiKey,
    setPluginDraftConfigValue,
    setBuiltinToolEnabled,
    setPromptDraftValue,
    setProviderDraftValue,
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

  function handleOpenSettings() {
    if (isOpen || isPreparingSettingsPage) return

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
        cleanupPolicy: "manual",
        ownerType: "manual",
      })
      const createdSession = await handleCreateSessionForDirectory(projectID, created.path)
      const label = input.name.trim() || created.branch?.trim() || created.path
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

  async function refreshAppUpdateState() {
    const state = await getAppUpdateState()
    if (state) {
      setAppUpdateState(state)
    }
    return state
  }

  async function handleCheckForUpdates() {
    if (isCheckingAppUpdate) return

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

    setIsInstallingAppUpdate(true)
    setAppUpdateStatus(null)

    try {
      const result = await installAppUpdate()
      if (!result?.ok) {
        setAppUpdateStatus({
          tone: "error",
          text: result?.reason === "update-not-downloaded"
            ? t("updates.status.notDownloaded")
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

  function handleOpenUpdateCenter() {
    setIsUpdateDialogOpen(true)
  }

  const isCreatingSession = useWorkspaceStoreSelector(
    workspaceStore,
    (state) => Object.values(state.composer.isCreatingSessionByTabKey).some(Boolean),
  )
  const [activeBuiltinToolKind, setActiveBuiltinToolKind] = useState<BuiltinToolKindKey | null>(null)
  const [activeConnectionsTab, setActiveConnectionsTab] = useState<ConnectionsTab>("plugins")
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
  const liveRightSidebarSideChatPanelState = useMemo(() => {
    if (!rightSidebarSideChatPanelState) return null
    return {
      ...rightSidebarSideChatPanelState,
      messages: liveRightSidebarSideChatMessages.length > 0
        ? liveRightSidebarSideChatMessages
        : rightSidebarSideChatPanelState.messages,
    }
  }, [liveRightSidebarSideChatMessages, rightSidebarSideChatPanelState])
  const rightSidebarThreadLinkContext = liveRightSidebarSideChatPanelState
  const rightSidebarProfiler = useMemo(
    () => createRendererProfilerOnRender("RightSidebar commit", () => ({
      activeTabID: activeRightSidebarTab?.id ?? null,
      activeTabKind: activeRightSidebarTab?.kind ?? null,
      activeSessionID: activeSession?.id ?? null,
      tabCount: rightSidebar.tabs.length,
    })),
    [activeRightSidebarTab?.id, activeRightSidebarTab?.kind, activeSession?.id, rightSidebar.tabs.length],
  )

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
    setActiveConnectionsTab("ssh")
    handleLeftSidebarViewChange("connections")
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
  const isBuiltinToolsView = leftSidebarView === "tools"
  const isShellSidebarManagedView = isResourcesView || isBuiltinToolsView
  const isFullSurfaceView = isConnectionsView || isAutomationsView || isCalendarView
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
  const workbenchWindowControls = useMemo(
    () => (
      isMacOS
        ? <NativeMacWindowControlsSlot controlsRef={null} />
        : <WindowChrome controlsRef={null} isWindowMaximized={isWindowMaximized} onWindowAction={handleWindowAction} />
    ),
    [handleWindowAction, isMacOS, isWindowMaximized],
  )
  const appShellClassName = isOpen ? "app-shell is-settings-open" : "app-shell"
  const effectiveAppShellStyle = isShellSidebarManagedView
    ? {
        ...appShellStyle,
        "--right-sidebar-display-width": "0px",
        "--right-sidebar-resizer-width": "0px",
      }
    : appShellStyle
  return (
    <WorkspaceStoreProvider store={workspaceStore}>
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
              onProjectCreateSession={handleProjectCreateSession}
              onProjectCreateWorktree={handleProjectCreateWorktree}
              onProjectClick={handleProjectClick}
              onProjectOpenInExplorer={handleProjectOpenInExplorer}
              onProjectPin={handleProjectPin}
              onProjectRemove={handleProjectRemove}
              onConversationClick={() => handleSidebarAction("conversation")}
              onSessionDelete={handleSessionDelete}
              onSessionSelect={handleSessionSelect}
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
          ) : isAutomationsView ? (
            <Suspense fallback={null}>
              <AutomationsPage
                projects={workspaces.map((workspace) => ({
                  directory: workspace.directory,
                  id: workspace.id,
                  name: workspace.name,
                  projectID: workspace.project.id,
                  projectKind: workspace.project.kind,
                  repositoryRoot: workspace.project.repositoryRoot,
                  vcs: workspace.project.vcs,
                  worktree: workspace.project.worktree,
                  workspaceRoots: workspace.project.workspaceRoots,
                }))}
                windowControls={windowControls}
                onOpenSession={(sessionID) => handleCanvasSessionTabSelect(sessionID)}
              />
            </Suspense>
          ) : isConnectionsView ? (
            <ConnectionsPage
              activeTab={activeConnectionsTab}
              connectorCount={connectorCatalog.length}
              mcpCount={mcpServers.length}
              pluginCount={pluginCatalog.length}
              sshCount={0}
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
                    savingPluginConnectorID={savingPluginConnectorID}
                    searchQuery={connectionSearchQueries.plugins}
                    updatingPluginID={updatingPluginID}
                    onCancelInstalledPluginConnectorAuthFlow={cancelInstalledPluginConnectorAuthFlow}
                    onDeleteInstalledPlugin={deleteInstalledPlugin}
                    onDeleteInstalledPluginConnectorApiKey={deleteInstalledPluginConnectorApiKey}
                    onDeleteInstalledPluginConnectorAuthSession={deleteInstalledPluginConnectorAuthSession}
                    onDiagnoseInstalledPlugin={diagnoseInstalledPlugin}
                    onDiagnoseInstalledPluginConnector={diagnoseInstalledPluginConnector}
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
                    diagnosingConnectorID={diagnosingConnectorID}
                    hideTopMenu
                    isLoading={isLoadingConnectors}
                    savingConnectorID={savingConnectorID}
                    searchQuery={connectionSearchQueries.connectors}
                    onCancelConnectorAuthFlow={cancelConnectorAuthFlow}
                    onConnectorApiKeyDraftChange={setConnectorApiKeyDraft}
                    onConnectorConfigDraftChange={setConnectorConfigDraft}
                    onConnectorSelect={selectConnector}
                    onDeleteConnectorApiKey={deleteConnectorApiKey}
                    onDeleteConnectorConfig={deleteConnectorConfig}
                    onDeleteConnectorAuthSession={deleteConnectorAuthSession}
                    onDiagnoseConnector={diagnoseConnector}
                    onSaveConnectorApiKey={saveConnectorApiKey}
                    onSaveConnectorConfig={saveConnectorConfig}
                    onSearchQueryChange={handleConnectionSearchQueryChange}
                    onStartConnectorAuthFlow={startConnectorAuthFlow}
                  />
                </Suspense>
              ) : activeConnectionsTab === "mcp" ? (
                <McpServersPage
                  activeMcpServerID={activeMcpServerID}
                  activeMcpServerDiagnostic={activeMcpServerDiagnostic}
                  deletingMcpServerID={deletingMcpServerID}
                  hideTopMenu
                  isLoading={isLoading}
                  loadError={loadError}
                  installedPlugins={installedPlugins}
                  mcpServerDraft={mcpServerDraft}
                  mcpServers={mcpServers}
                  pluginCatalog={pluginCatalog}
                  savingMcpServerID={savingMcpServerID}
                  isImportingMcpConfigJson={isImportingMcpConfigJson}
                  searchQuery={connectionSearchQueries.mcp}
                  onDeleteMcpServer={deleteMcpServer}
                  onImportMcpConfigJson={importMcpConfigJson}
                  onMcpServerDraftChange={setMcpServerDraftValue}
                  onMcpToolPolicyChange={setMcpToolPolicy}
                  onMcpServerSelect={selectMcpServer}
                  onSaveMcpServer={saveMcpServer}
                  onSearchQueryChange={handleConnectionSearchQueryChange}
                  onStartNewMcpServer={startNewMcpServer}
                />
              ) : activeConnectionsTab === "mobile" ? (
                <MobileConnectionPage />
              ) : (
                <SshConnectionsPage
                  searchQuery={connectionSearchQueries.ssh}
                  onWorkspaceOpened={async (workspace) => {
                    await refreshWorkspaceFromDirectory(workspace.directory)
                  }}
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
                  composerRefreshVersion={composerRefreshVersion}
                  assistantTraceVisibility={assistantTraceVisibility}
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

            <RendererProfiler id="MainApp.RightSidebar" onRender={rightSidebarProfiler}>
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
                rightSidebar={rightSidebar}
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
            </RendererProfiler>
          </>
        ) : null}

        {isOpen ? (
          <Suspense fallback={null}>
            <SettingsPage
              activeMcpServerID={activeMcpServerID}
              activeMcpServerDiagnostic={activeMcpServerDiagnostic}
              archivedSessions={archivedSessions}
              archivedSessionsError={archivedSessionsError}
              catalog={catalog}
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
              isDeletingAllArchivedSessions={isDeletingAllArchivedSessions}
              isLoading={isLoading}
              isLoadingArchivedSessions={isLoadingArchivedSessions}
              isOpen={isOpen}
              appUpdateState={appUpdateState}
              appUpdateStatus={appUpdateStatus}
              isCheckingAppUpdate={isCheckingAppUpdate}
              isSavingAutomaticUpdates={isSavingAutomaticUpdates}
              isRefreshingProviderCatalog={isRefreshingProviderCatalog}
              installedPlugins={installedPlugins}
              loadError={loadError}
              mcpServerDraft={mcpServerDraft}
              mcpServers={mcpServers}
              models={models}
              pluginCatalog={pluginCatalog}
              providerDrafts={providerDrafts}
              customProviderDraft={customProviderDraft}
              restoringArchivedSessionID={restoringArchivedSessionID}
              savingMcpServerID={savingMcpServerID}
              savingProviderID={savingProviderID}
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
              onRefreshProviderCatalog={refreshProviderCatalog}
              onLoadArchivedSessions={loadArchivedSessions}
              onOpenUpdateCenter={handleOpenUpdateCenter}
              onRestoreArchivedSession={restoreArchivedSession}
              onSaveMcpServer={saveMcpServer}
              onSaveProviderApiKey={saveProviderApiKey}
              onSaveProvider={saveProvider}
              onSaveCustomProvider={saveCustomProvider}
              onSelectionChange={setSelectionDraftValue}
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
    </WorkspaceStoreProvider>
  )
}
