import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, shell, type IpcMainInvokeEvent, type MenuItemConstructorOptions, type MessageBoxOptions, type MessageBoxReturnValue, type NativeImage, type OpenDialogOptions, type OpenDialogReturnValue, type SaveDialogOptions, type SaveDialogReturnValue, type WebContents } from "electron"
import { createPlatformAdapter } from "@anybox/platform"
import { DesktopIpcSchemas, createSshWorkspaceUri, isSshWorkspaceUri } from "@anybox/shared"
import type {
  DownloadedRegistrySkill,
  RegistryFile,
  RegistryFileContent,
  RegistryProviderDescriptor,
  RegistrySearchPage,
  RegistrySecuritySnapshot,
  RegistrySkillDetail,
  RegistryVersion,
} from "@anybox/shared"
import { createHash, randomUUID } from "node:crypto"
import { createReadStream } from "node:fs"
import { appendFile, copyFile, mkdir, open, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import type { AppearanceConfigDocument, AppearanceRuntimeState } from "../shared/appearance"
import type {
  CinemaProviderAuthState,
  CinemaProviderWorkflowCatalog,
  CinemaVideoProvider,
} from "@anybox/shared/cinema"
import {
  createDefaultAppearanceRuntimeState,
  normalizeAppearanceRuntimeState,
} from "../shared/appearance"
import type { AppLocale, LocaleConfigDocument } from "../shared/locale"
import type { PermissionResolveInput } from "../shared/permission"
import type {
  DesktopIpcChannel,
  DesktopIpcEventChannel,
  DesktopIpcEventPayload,
  DesktopIpcInput,
  DesktopIpcOutput,
  DesktopRendererErrorReport,
  DesktopRendererMemoryDiagnosticsRecord,
  DesktopRendererMemoryDiagnosticsSnapshot,
  DesktopRechargePaymentOrder,
  DesktopRegistrySkillDeleteResult,
  DesktopRegistrySkillForkResult,
  DesktopRegistrySkillMutationResult,
  DesktopRegistrySkillUpdatePreview,
  DesktopRunningSessionStatus,
  DesktopSessionRollbackInput,
  DesktopSessionRollbackResult,
  DesktopStorageUsageSnapshot,
  DesktopStorageOptimizeResult,
  DesktopSubscriptionOrderResponse,
  DesktopSubscriptionOverview,
  DesktopSubscriptionPlan,
  DesktopSubscriptionSummary,
  DesktopSubscriptionLimit,
  McpServerInput,
} from "../shared/desktop-ipc-contract"
import {
  DESKTOP_APP_UPDATE_STATE_EVENT_CHANNEL,
  DESKTOP_AGENT_SESSION_EVENT_CHANNEL,
  DESKTOP_APPEARANCE_STATE_EVENT_CHANNEL,
  DESKTOP_AUTOMATION_EVENT_CHANNEL,
  DESKTOP_ENVIRONMENT_EVENT_CHANNEL,
  DESKTOP_SEMANTIC_TOKEN_INSPECTOR_EVENT_CHANNEL,
} from "../shared/desktop-ipc-contract"
import { AgentAPIError, getAgentConfig, readAgentSSEStream, requestAgentJSON, resolveAgentURL } from "./agent-client"
import { AgentCompletionNotificationManager } from "./agent-completion-notification"
import { openAppearanceWindow } from "./appearance-window"
import {
  assertConsumerAppearanceThemeID,
  constrainConsumerAppearanceDocument,
  constrainConsumerAppearanceRuntimeState,
  createConsumerAppearanceThemeSnapshot,
  createSafeConsumerAppearanceState,
  migratePackagedAppearanceState,
  resolveConsumerAppearanceTheme,
} from "./appearance-consumer-policy"
import { readAppearanceConfigSnapshot, writeAppearanceConfigSnapshot } from "./appearance-config"
import {
  deleteAppearanceTheme,
  duplicateAppearanceTheme,
  readAppearanceThemesSnapshot,
  renameAppearanceTheme,
  saveAppearanceTheme,
  setActiveAppearanceTheme,
} from "./appearance-themes-config"
import { filterAvailableExternalEditorsForTarget, listAvailableExternalEditors, openInExternalEditor } from "./external-editors"
import { buildFolderWorkspaceForDirectory, buildFolderWorkspaces } from "./folder-workspaces"
import {
  checkoutGitBranch,
  commitGitChanges,
  createGitBranch,
  createGitPullRequest,
  generateGitCommitMessage,
  getGitCapabilities,
  listGitBranches,
  pushGitChanges,
} from "./git"
import type { ApplicationMenus } from "./menu"
import { readLocaleConfigSnapshot, writeLocaleConfigSnapshot } from "./locale-config"
import { detectLocalPreviewServices } from "./local-preview-services"
import { resolveManagedAgentDataDir } from "./managed-agent"
import { getMobileBridgeStatus, refreshMobilePairingCode, revokeMobileDevice, rotateMobileBridgeToken } from "./mobile-bridge-server"
import { openMonitorWindow } from "./monitor-window"
import { readPreviewText, resolvePreviewTarget } from "./preview-targets"
import { PtyProxyManager } from "./pty-proxy"
import {
  deleteRendererMemoryDiagnosticsRecord,
  listRendererMemoryDiagnosticsRecords,
  setRendererMemoryDiagnosticsRecord,
} from "./renderer-memory-diagnostics-store"
import { safeError, safeWarn } from "./safe-console"
import { SemanticTokenInspectorSessionManager } from "./semantic-token-inspector"
import { getDesktopRuntimeCapabilities } from "./runtime-capabilities"
import { sendWebContentsSafely } from "./safe-web-contents-send"
import {
  checkForAppUpdates,
  getAppUpdateSettingsSnapshot,
  getAppUpdateStateSnapshot,
  installDownloadedAppUpdate,
  onAppUpdateStateChanged,
  setAutomaticAppUpdatesEnabled,
} from "./updater"
import type {
  AgentArchivedSessionDeleteResult,
  AgentArchivedSessionSummary,
  AgentAutomationCreateInput,
  AgentAutomationDefinition,
  AgentAutomationDeleteResult,
  AgentAutomationIPCEvent,
  AgentAutomationRun,
  AgentAutomationRunCreateResult,
  AgentAutomationRunListInput,
  AgentAutomationTriageStatus,
  AgentAutomationUpdateInput,
  AgentBuiltinToolSelection,
  AgentBuiltinToolsPayload,
  AgentConnectorDefinition,
  AgentConnectorStatus,
  AgentEnvelope,
  AgentEnvironmentIPCEvent,
  AgentFolderWorkspace,
  AgentGlobalSkillFileDocument,
  AgentGlobalSkillFolderRenameResult,
  AgentGlobalSkillFolderResult,
  AgentGlobalSkillMoveResult,
  AgentGlobalSkillRenameResult,
  AgentGlobalSkillTree,
  AgentSkillGitInstallPreview,
  AgentSkillGitInstallResult,
  AgentMcpServerDiagnostic,
  AgentMcpServerSummary,
  AgentModelCatalogResult,
  AgentInstalledPlugin,
  AgentPluginCatalogItem,
  AgentPluginConnectorStatus,
  AgentPluginDeleteResult,
  AgentPluginMcpControlsResult,
  AgentPluginSkillDirectory,
  AgentPluginSkillFile,
  AgentPermissionRequest,
  AgentPermissionResolveResult,
  AgentProjectDeleteResult,
  AgentProjectInfo,
  AgentProjectMcpSelection,
  AgentProjectModelSelection,
  AgentProjectModelsResult,
  AgentProjectPluginSelection,
  AgentProjectSkillSelection,
  AgentProjectWorkspace,
  AgentWorktreeRecord,
  AgentPromptPresetDocument,
  AgentPromptPresetSelection,
  AgentPromptPresetSummary,
  AgentPromptUrlInstallPreview,
  AgentPromptUrlInstallResult,
  AgentProviderAuthFlow,
  AgentProviderAuthState,
  AgentProviderCatalogItem,
  AgentProviderConnectionTestResult,
  AgentProviderModel,
  AgentPtySessionInfo,
  AgentSessionArchiveResult,
  AgentSessionBackgroundProcessList,
  AgentSessionBackgroundProcessesTerminateAllResult,
  AgentSessionBackgroundProcessTerminateResult,
  AgentSessionBridgeIPCEvent,
  AgentSessionCompactResult,
  AgentSessionDeleteResult,
  AgentSessionDiffScope,
  AgentSessionDiffSummary,
  AgentSessionHistoryMessage,
  AgentSessionInfo,
  AgentSessionRuntimeDebugSnapshot,
  AgentSessionTraceExport,
  AgentSessionTaskListView,
  AgentSessionTurnRequestInput,
  AgentSessionWorkflowUpdateInput,
  AgentSshConnectionTestResult,
  AgentSshDirectoryListing,
  AgentSshProfile,
  AgentSshProfileInput,
  AgentSkillInfo,
  AgentToolPermissionModePayload,
  AgentWorkspaceSession,
  AgentWorkspaceFileDocument,
  AgentWorkspaceDirectoryEntry,
  AgentWorkspaceFileSearchResult,
  MenuAnchor,
  MenuKey,
  WindowAction,
} from "./types"
import { isWindowMaximized, sendWindowState } from "./window-state"
import {
  getWorkspaceGitFileStates,
  getWorkspaceGitDiff,
  restoreWorkspaceDiffFile,
  reverseApplyWorkspaceDiffPatches,
  stageWorkspaceDiffFile,
  unstageWorkspaceDiffFile,
} from "./workspace-diff"
import { listWorkspaceDirectory, readWorkspaceFile, searchWorkspaceFiles } from "./workspace-files"
import { WorkspaceWatchManager } from "./workspace-watch"
import type { WorkbenchWindowManager } from "./workbench-window-manager"

const AGENT_SESSION_EVENT_CHANNEL = DESKTOP_AGENT_SESSION_EVENT_CHANNEL
const AUTOMATION_EVENT_CHANNEL = DESKTOP_AUTOMATION_EVENT_CHANNEL
const ENVIRONMENT_EVENT_CHANNEL = DESKTOP_ENVIRONMENT_EVENT_CHANNEL
const APPEARANCE_STATE_EVENT_CHANNEL = DESKTOP_APPEARANCE_STATE_EVENT_CHANNEL
let appUpdateStateBridgeRegistered = false
let automationEventBridgeRegistered = false
let environmentEventBridgeRegistered = false

const GIT_DIFF_SCOPES = new Set<AgentSessionDiffScope>([
  "git:unstaged",
  "git:staged",
  "git:commit",
  "git:branch",
])

const GIT_DISABLED_DIFF_SCOPES = [
  "git:unstaged",
  "git:staged",
  "git:commit",
  "git:branch",
] satisfies AgentSessionDiffScope[]

type AgentDebugStatusPayload = {
  runningSessions?: {
    count?: unknown
    items?: unknown
  }
}

function normalizeRunningSessionStatus(payload: AgentDebugStatusPayload | null | undefined): DesktopRunningSessionStatus {
  const rawItems = payload?.runningSessions?.items
  const sessionIDs = (Array.isArray(rawItems) ? rawItems : [])
    .map((item) => {
      if (typeof item !== "object" || item === null) return ""
      const sessionID = (item as { sessionID?: unknown }).sessionID
      return typeof sessionID === "string" ? sessionID.trim() : ""
    })
    .filter((sessionID): sessionID is string => Boolean(sessionID))
  const rawCount = payload?.runningSessions?.count
  const parsedCount = typeof rawCount === "number" && Number.isFinite(rawCount)
    ? Math.max(0, Math.floor(rawCount))
    : sessionIDs.length
  const count = Math.max(parsedCount, sessionIDs.length)

  return {
    running: count > 0,
    count,
    sessionIDs,
    checkedAt: Date.now(),
  }
}

async function getRunningSessionStatus(): Promise<DesktopRunningSessionStatus> {
  const result = await requestAgentJSON<AgentDebugStatusPayload>("/api/debug/status")
  return normalizeRunningSessionStatus(result.data)
}

function createNonGitScopeOptions(diff: AgentSessionDiffSummary): AgentSessionDiffSummary["availableScopes"] {
  return [
    ...GIT_DISABLED_DIFF_SCOPES.map((scope) => ({
      scope,
      label: scope === "git:unstaged"
        ? "未暂存"
        : scope === "git:staged"
          ? "已暂存"
          : scope === "git:commit"
            ? "提交"
            : "分支",
      enabled: false,
      reason: "Current project is not managed by Git.",
      ...(scope === "git:commit" ? { hasChildren: true } : {}),
    })),
    {
      scope: "session:last-turn",
      label: "上轮对话",
      enabled: true,
      count: diff.stats?.files ?? diff.diffs.length,
    },
  ]
}

function appendLastTurnScopeOption(
  gitDiff: AgentSessionDiffSummary,
  diff?: AgentSessionDiffSummary,
): AgentSessionDiffSummary["availableScopes"] {
  const options = (gitDiff.availableScopes ?? []).filter((option) => option.scope !== "session:last-turn")
  return [
    ...options,
    {
      scope: "session:last-turn",
      label: "上轮对话",
      enabled: true,
      ...(diff ? { count: diff.stats?.files ?? diff.diffs.length } : {}),
    },
  ]
}

function withLastTurnScope(
  diff: AgentSessionDiffSummary,
  availableScopes: AgentSessionDiffSummary["availableScopes"],
  restoreMode: AgentSessionDiffSummary["restoreMode"] = "none",
): AgentSessionDiffSummary {
  return {
    ...diff,
    scope: "session:last-turn",
    restoreMode,
    availableScopes,
  }
}

async function withWorkspaceGitFileStates(directory: string, diff: AgentSessionDiffSummary) {
  const states = await getWorkspaceGitFileStates(
    directory,
    diff.diffs.map((item) => item.file),
  ).catch((error) => {
    safeWarn("[desktop] getWorkspaceGitFileStates failed:", error)
    return null
  })
  if (!states) return diff

  return {
    ...diff,
    diffs: diff.diffs.map((item) => ({
      ...item,
      gitState: states[item.file] ?? "unknown",
    })),
  } satisfies AgentSessionDiffSummary
}

type Awaitable<T> = T | Promise<T>
type DesktopIpcHandler<Channel extends DesktopIpcChannel> =
  undefined extends DesktopIpcInput<Channel>
    ? (event: IpcMainInvokeEvent, input?: DesktopIpcInput<Channel>) => Awaitable<DesktopIpcOutput<Channel>>
    : (event: IpcMainInvokeEvent, input: DesktopIpcInput<Channel>) => Awaitable<DesktopIpcOutput<Channel>>

function handleDesktopIpc<Channel extends DesktopIpcChannel>(
  channel: Channel,
  handler: DesktopIpcHandler<Channel>,
) {
  ipcMain.handle(channel, (event, input) =>
    (handler as (event: IpcMainInvokeEvent, input?: unknown) => Awaitable<DesktopIpcOutput<Channel>>)(event, input),
  )
}

async function preservePluginAgentErrorCode<T>(operation: () => Promise<T>) {
  try {
    return await operation()
  } catch (error) {
    if (error instanceof AgentAPIError && error.code) {
      throw new Error(`[${error.code}] ${error.message}`)
    }
    throw error
  }
}

function sendDesktopIpcEvent<Channel extends DesktopIpcEventChannel>(
  target: WebContents,
  channel: Channel,
  payload: DesktopIpcEventPayload<Channel>,
) {
  return sendWebContentsSafely(target, channel, payload)
}

function normalizeShowMenuInput(input: MenuKey | { menuKey: MenuKey; anchor?: MenuAnchor }) {
  if (typeof input === "string") {
    return { menuKey: input, anchor: undefined }
  }

  return input
}

function truncateLogString(value: string | undefined, maxLength = 8_000) {
  if (!value) return value
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength)}\n[truncated ${value.length - maxLength} chars]`
}

function normalizeRendererErrorReport(input: DesktopRendererErrorReport): DesktopRendererErrorReport {
  return {
    ...input,
    componentStack: truncateLogString(input.componentStack),
    message: truncateLogString(input.message, 2_000) ?? "Unknown renderer error",
    name: truncateLogString(input.name, 500),
    stack: truncateLogString(input.stack),
    url: truncateLogString(input.url, 2_000),
    userAgent: truncateLogString(input.userAgent, 1_000),
  }
}

async function appendRendererErrorLog(report: DesktopRendererErrorReport & { senderURL?: string; webContentsID?: number }) {
  const logPath = path.join(app.getPath("userData"), "renderer-errors.log")
  const line = `${JSON.stringify(report)}\n`
  await appendFile(logPath, line, "utf8")
}

const rendererMemoryDiagnosticsCleanupTargets = new Set<number>()

function normalizeRendererMemoryDiagnostics(
  input: DesktopRendererMemoryDiagnosticsSnapshot,
  event: IpcMainInvokeEvent,
): DesktopRendererMemoryDiagnosticsRecord {
  return {
    ...input,
    senderURL: event.sender.getURL(),
    webContentsID: event.sender.id,
  }
}

function mapSessionInfo(session: AgentSessionInfo) {
  return {
    id: session.id,
    projectID: session.projectID,
    worktreeID: session.worktreeID,
    directory: session.directory,
    title: session.title,
    pinned: session.pinned,
    policy: session.policy,
    automation: session.automation,
    subagent: session.subagent,
    modelSelection: session.modelSelection,
    created: session.time.created,
    updated: session.time.updated,
    workflow: session.workflow,
  }
}

async function deleteAgentSessionRecord(sessionID: string) {
  const result = await requestAgentJSON<AgentSessionDeleteResult>(`/api/sessions/${encodeURIComponent(sessionID)}`, {
    method: "DELETE",
  })
  return {
    ...result.data,
    requestId: result.requestId,
  }
}

async function loadProjectWorkspace(project: AgentProjectInfo): Promise<AgentProjectWorkspace> {
  const [sessionsResult, worktreesResult] = await Promise.all([
    requestAgentJSON<AgentSessionInfo[]>(`/api/projects/${encodeURIComponent(project.id)}/sessions`),
    requestAgentJSON<AgentWorktreeRecord[]>(`/api/projects/${encodeURIComponent(project.id)}/worktrees`),
  ])

  return {
    ...project,
    sessions: sessionsResult.data.map(mapSessionInfo).sort((left, right) => right.updated - left.updated),
    worktrees: worktreesResult.data,
  }
}

async function listProjectWorkspaces() {
  const result = await requestAgentJSON<AgentProjectInfo[]>("/api/projects")
  const workspaces = await Promise.all(result.data.map((project) => loadProjectWorkspace(project)))

  return workspaces.sort((left, right) => {
    const leftUpdated = left.sessions[0]?.updated ?? left.updated
    const rightUpdated = right.sessions[0]?.updated ?? right.updated
    return rightUpdated - leftUpdated
  })
}

async function listProjectWorktrees(projectID: string) {
  const result = await requestAgentJSON<AgentWorktreeRecord[]>(
    `/api/projects/${encodeURIComponent(projectID)}/worktrees`,
  )
  return result.data
}

async function createProjectWorktree(input: DesktopIpcInput<"desktop:create-project-worktree">) {
  const { projectID, ...body } = input
  const result = await requestAgentJSON<DesktopIpcOutput<"desktop:create-project-worktree">>(
    `/api/projects/${encodeURIComponent(projectID)}/worktrees`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  )
  return result.data
}

async function refreshProjectWorktree(input: DesktopIpcInput<"desktop:refresh-project-worktree">) {
  const result = await requestAgentJSON<AgentWorktreeRecord>(
    `/api/projects/${encodeURIComponent(input.projectID)}/worktrees/${encodeURIComponent(input.worktreeID)}/refresh`,
    {
      method: "POST",
    },
  )
  return result.data
}

async function deleteProjectWorktree(input: DesktopIpcInput<"desktop:delete-project-worktree">) {
  const { projectID, worktreeID, ...body } = input
  const result = await requestAgentJSON<AgentWorktreeRecord>(
    `/api/projects/${encodeURIComponent(projectID)}/worktrees/${encodeURIComponent(worktreeID)}`,
    {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  )
  return result.data
}

async function listFolderWorkspaces() {
  const result = await requestAgentJSON<AgentProjectInfo[]>("/api/projects")
  const projectWorkspaces = await Promise.all(result.data.map((project) => loadProjectWorkspace(project)))
  return buildFolderWorkspaces(result.data, projectWorkspaces)
}

function sanitizeScreenshotFileSegment(value: string) {
  return value
    .trim()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "preview"
}

type PreviewScreenshotCaptureInput = DesktopIpcInput<"desktop:capture-preview-screenshot">
type SaveComposerPastedImagesInput = DesktopIpcInput<"desktop:save-composer-pasted-images">
type CopyImageToClipboardInput = DesktopIpcInput<"desktop:copy-image-to-clipboard">
type SaveImageToFolderInput = DesktopIpcInput<"desktop:save-image-to-folder">

interface PreviewScreenshotCaptureOptions {
  makeDirectory?: (directory: string, options: { recursive: true }) => Promise<unknown>
  now?: Date
  userDataPath?: string
  writeClipboardImage?: (image: NativeImage) => void
  writeImageFile?: (filePath: string, data: Buffer) => Promise<unknown>
}

interface SaveComposerPastedImagesOptions {
  makeDirectory?: (directory: string, options: { recursive: true }) => Promise<unknown>
  now?: Date
  userDataPath?: string
  writeImageFile?: (filePath: string, data: Buffer) => Promise<unknown>
}

interface CopyImageToClipboardOptions {
  createImageFromBuffer?: (buffer: Buffer) => NativeImage
  writeClipboardImage?: (image: NativeImage) => void
}

interface SaveImageToFolderOptions {
  downloadsPath?: string
  now?: Date
  showOpenDialog?: (options: OpenDialogOptions) => Promise<OpenDialogReturnValue>
  writeImageFile?: (filePath: string, data: Buffer) => Promise<unknown>
}

const COMPOSER_PASTED_IMAGE_EXTENSIONS = new Map([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/jpg", "jpg"],
  ["image/gif", "gif"],
  ["image/webp", "webp"],
  ["image/bmp", "bmp"],
  ["image/svg+xml", "svg"],
])

function sanitizeComposerPastedImageName(value: string | undefined, fallback: string) {
  const basename = path.basename(value?.trim() || fallback)
  const withoutExtension = basename.replace(/\.[^.]+$/, "")
  return (
    withoutExtension
      .replace(/[^a-z0-9._-]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || fallback
  )
}

function parseComposerPastedImageDataUrl(dataUrl: string, fallbackMimeType: string) {
  const match = /^data:([^;,]+);base64,([\s\S]+)$/i.exec(dataUrl.trim())
  if (!match) {
    throw new Error("Pasted image data must be a base64 data URL.")
  }

  const mimeType = (match[1] || fallbackMimeType).trim().toLowerCase()
  const extension = COMPOSER_PASTED_IMAGE_EXTENSIONS.get(mimeType)
  if (!extension) {
    throw new Error(`Unsupported pasted image type: ${mimeType || "unknown"}.`)
  }

  const buffer = Buffer.from(match[2].replace(/\s/g, ""), "base64")
  if (buffer.length === 0) {
    throw new Error("Pasted image data is empty.")
  }

  return {
    buffer,
    extension,
  }
}

async function capturePreviewScreenshotFromWindow(
  win: Pick<BrowserWindow, "capturePage">,
  input: PreviewScreenshotCaptureInput,
  options: PreviewScreenshotCaptureOptions = {},
) {
  const bounds = input.bounds
  const rect = {
    height: Math.max(1, Math.round(bounds.height)),
    width: Math.max(1, Math.round(bounds.width)),
    x: Math.max(0, Math.round(bounds.x)),
    y: Math.max(0, Math.round(bounds.y)),
  }
  const image = await win.capturePage(rect)
  const screenshotDirectory = path.join(
    options.userDataPath ?? app.getPath("userData"),
    "preview-comment-screenshots",
  )
  const timestamp = (options.now ?? new Date()).toISOString().replace(/[:.]/g, "-")
  const urlSegment = sanitizeScreenshotFileSegment(input.url ?? "preview")
  const screenshotPath = path.join(screenshotDirectory, `${timestamp}-${urlSegment}.png`)

  await (options.makeDirectory ?? mkdir)(screenshotDirectory, { recursive: true })
  await (options.writeImageFile ?? writeFile)(screenshotPath, image.toPNG())
  if (input.copyToClipboard) {
    (options.writeClipboardImage ?? clipboard.writeImage)(image)
  }

  return { copiedToClipboard: Boolean(input.copyToClipboard), path: screenshotPath }
}

async function saveComposerPastedImages(
  input: SaveComposerPastedImagesInput,
  options: SaveComposerPastedImagesOptions = {},
) {
  const imageDirectory = path.join(
    options.userDataPath ?? app.getPath("userData"),
    "composer-pasted-images",
  )
  const timestamp = (options.now ?? new Date()).toISOString().replace(/[:.]/g, "-")
  const savedPaths: string[] = []

  await (options.makeDirectory ?? mkdir)(imageDirectory, { recursive: true })

  for (const [index, image] of input.images.entries()) {
    const parsedImage = parseComposerPastedImageDataUrl(image.dataUrl, image.mimeType)
    const safeName = sanitizeComposerPastedImageName(image.name, "pasted-image")
    const filePath = path.join(
      imageDirectory,
      `${timestamp}-${String(index + 1).padStart(2, "0")}-${safeName}.${parsedImage.extension}`,
    )

    await (options.writeImageFile ?? writeFile)(filePath, parsedImage.buffer)
    savedPaths.push(filePath)
  }

  return savedPaths
}

function copyImageDataUrlToClipboard(
  input: CopyImageToClipboardInput,
  options: CopyImageToClipboardOptions = {},
) {
  const parsedImage = parseComposerPastedImageDataUrl(input.dataUrl, input.mimeType)
  const image = (options.createImageFromBuffer ?? nativeImage.createFromBuffer)(parsedImage.buffer)
  if (image.isEmpty()) {
    throw new Error("Image data could not be decoded for clipboard.")
  }

  const writeClipboardImage = options.writeClipboardImage ?? ((clipboardImage: NativeImage) => clipboard.writeImage(clipboardImage))
  writeClipboardImage(image)
}

async function saveImageDataUrlToFolder(
  input: SaveImageToFolderInput,
  options: SaveImageToFolderOptions = {},
) {
  const parsedImage = parseComposerPastedImageDataUrl(input.dataUrl, input.mimeType)
  const showOpenDialog = options.showOpenDialog ?? ((dialogOptions: OpenDialogOptions) =>
    dialog.showOpenDialog(dialogOptions))
  const selection = await showOpenDialog({
    buttonLabel: "Save Here",
    defaultPath: options.downloadsPath ?? app.getPath("downloads"),
    properties: ["openDirectory", "createDirectory"],
    title: "Select folder to save image",
  })
  const selectedDirectory = selection.filePaths?.[0]
  if (selection.canceled || !selectedDirectory) {
    return { canceled: true as const }
  }

  const timestamp = (options.now ?? new Date()).toISOString().replace(/[:.]/g, "-")
  const safeName = sanitizeComposerPastedImageName(input.name, "image")
  const filePath = path.join(selectedDirectory, `${timestamp}-${safeName}.${parsedImage.extension}`)

  await (options.writeImageFile ?? writeFile)(filePath, parsedImage.buffer)

  return {
    canceled: false as const,
    path: filePath,
  }
}

async function updateAgentSessionTitle(input: { sessionID: string; title: string }) {
  const sessionID = input.sessionID.trim()
  const title = input.title.trim()
  const result = await requestAgentJSON<AgentSessionInfo>(`/api/sessions/${encodeURIComponent(sessionID)}/title`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ title }),
  })

  return {
    session: mapSessionInfo(result.data),
    requestId: result.requestId,
  }
}

async function updateAgentSessionPinned(input: { sessionID: string; pinned: boolean }) {
  const sessionID = input.sessionID.trim()
  const result = await requestAgentJSON<AgentSessionInfo>(`/api/sessions/${encodeURIComponent(sessionID)}/pinned`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ pinned: input.pinned }),
  })

  return {
    session: mapSessionInfo(result.data),
    requestId: result.requestId,
  }
}

async function getToolPermissionMode() {
  const result = await requestAgentJSON<AgentToolPermissionModePayload>("/api/tools/permission-mode")
  return result.data
}

async function updateToolPermissionMode(input: AgentToolPermissionModePayload) {
  const result = await requestAgentJSON<AgentToolPermissionModePayload>("/api/tools/permission-mode", {
    method: "PUT",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      mode: input.mode,
    }),
  })

  return result.data
}

async function translatePromptPreset(input: DesktopIpcInput<"desktop:translate-prompt-preset">) {
  const result = await requestAgentJSON<AgentPromptPresetDocument>("/api/prompts/translate", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(input),
  })

  return result.data
}

async function updatePromptPresetSelection(input: AgentPromptPresetSelection) {
  const result = await requestAgentJSON<AgentPromptPresetSelection>("/api/prompts/selection", {
    method: "PUT",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(input),
  })

  return result.data
}

type SessionTraceExportInput = DesktopIpcInput<"desktop:get-session-trace-export">
type SaveSessionTraceExportInput = DesktopIpcInput<"desktop:save-session-trace-export">
type SaveSessionTraceExportDirectoryInput = DesktopIpcInput<"desktop:save-session-trace-export-directory">
type SaveSessionTraceExportRawDirectoryInput = DesktopIpcInput<"desktop:save-session-trace-export-raw-directory">
type SaveSessionTraceExportToProjectInput = DesktopIpcInput<"desktop:save-session-trace-export-to-project">
type PrepareSessionBagSubmissionInput = DesktopIpcInput<"desktop:prepare-session-bag-submission">
type UploadSessionBagSubmissionInput = DesktopIpcInput<"desktop:upload-session-bag-submission">
type DiscardSessionBagSubmissionInput = DesktopIpcInput<"desktop:discard-session-bag-submission">

interface SaveSessionTraceExportOptions {
  downloadsPath?: string
  now?: Date
  showSaveDialog?: (options: SaveDialogOptions) => Promise<SaveDialogReturnValue>
  writeTraceFile?: (filePath: string, data: string, encoding: BufferEncoding) => Promise<unknown>
}

interface SaveSessionTraceExportDirectoryOptions {
  downloadsPath?: string
  makeDirectory?: (directory: string, options: { recursive: true }) => Promise<unknown>
  now?: Date
  showOpenDialog?: (options: OpenDialogOptions) => Promise<OpenDialogReturnValue>
  userDataPath?: string
  writeTraceFile?: (filePath: string, data: string, encoding: BufferEncoding) => Promise<unknown>
  loadTraceEventPage?: (input: { sessionID: string; afterPosition: number; limit: number }) => Promise<AgentSessionTraceEventPage>
}

interface SaveSessionTraceExportRawDirectoryOptions extends SaveSessionTraceExportDirectoryOptions {
  agentDataDir?: string
  copyArtifactFile?: (source: string, destination: string) => Promise<unknown>
  showRiskDialog?: (options: MessageBoxOptions) => Promise<MessageBoxReturnValue>
}

interface AgentSessionTraceEventPage {
  schemaVersion: 2
  mode: "safe"
  events: AgentSessionTraceExport["events"]
  redaction: {
    redactedCount: number
    truncatedCount: number
  }
  hasMore: boolean
  nextPosition: number
  totalRetainedEventCount: number
}

interface AnyboxProviderRelaySession {
  connected: boolean
  status: string
  accessToken?: string
  baseURL?: string
  expiresAt?: number
  account?: {
    balanceMicrocents?: number
    currency?: string
    email?: string
    workspaceName?: string
    planLabel?: string
  }
  error?: string
}

interface SessionBagSubmissionRecord {
  accessToken: string
  account?: AnyboxProviderRelaySession["account"]
  baseURL: string
  filename: string
  fileCount: number
  generatedAt: string
  projectID?: string | null
  recordCount: number
  redaction: AgentSessionTraceExport["redaction"]
  rootDirectory: string
  sessionID: string
  sha256: string
  sizeBytes: number
  submissionID: string
  zipPath: string
}

interface PrepareSessionBagSubmissionOptions extends Pick<SaveSessionTraceExportDirectoryOptions, "makeDirectory" | "now" | "userDataPath" | "writeTraceFile"> {
  fetchRelaySession?: () => Promise<AnyboxProviderRelaySession>
  writeZipFile?: (input: { rootDirectory: string; zipPath: string; entries: string[] }) => Promise<void>
}

interface UploadSessionBagSubmissionOptions {
  fetch?: typeof fetch
  removeDirectory?: (directory: string, options: { force: true; recursive: true }) => Promise<unknown>
}

interface DiscardSessionBagSubmissionOptions {
  removeDirectory?: (directory: string, options: { force: true; recursive: true }) => Promise<unknown>
}

const SESSION_BAG_CONTENT_TYPE = "application/zip"
const SESSION_BAG_DESCRIPTION_MAX_LENGTH = 2000
const pendingSessionBagSubmissions = new Map<string, SessionBagSubmissionRecord>()

function getDesktopAppVersion() {
  return app?.getVersion?.() ?? "0.0.0"
}

function sanitizeSessionTraceFileSegment(value: string) {
  return (
    value
      .trim()
      .replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")
      .replace(/[^a-z0-9._-]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "session"
  )
}

function formatSessionTraceTimestamp(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0")
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("")
}

function getSessionTraceExportFolderName(sessionID: string, date: Date) {
  const safeSessionID = sanitizeSessionTraceFileSegment(sessionID)
  return `anybox-trace-${safeSessionID}-${formatSessionTraceTimestamp(date)}`
}

function getProjectSessionTraceExportRoot(
  input: Pick<SaveSessionTraceExportToProjectInput, "directory" | "projectID">,
  options: Pick<SaveSessionTraceExportDirectoryOptions, "userDataPath"> = {},
) {
  const projectID = input.projectID?.trim()
  if (projectID) {
    return path.join(options.userDataPath ?? app.getPath("userData"), "session-traces", sanitizeSessionTraceFileSegment(projectID))
  }

  const projectDirectory = input.directory
  const directory = projectDirectory.trim()
  if (!directory) {
    throw new Error("Project directory is required.")
  }
  if (isSshWorkspaceUri(directory)) {
    throw new Error("Saving trace exports to a project default location only supports local projects.")
  }
  if (!path.isAbsolute(directory)) {
    throw new Error("Project directory must be an absolute local path.")
  }

  const name = sanitizeSessionTraceFileSegment(path.basename(directory))
  const digest = createHash("sha256").update(directory.toLowerCase()).digest("hex").slice(0, 12)
  return path.join(options.userDataPath ?? app.getPath("userData"), "session-traces", `${name}-${digest}`)
}

function getSessionBagStagingRoot(options: Pick<PrepareSessionBagSubmissionOptions, "userDataPath"> = {}) {
  return path.join(options.userDataPath ?? app.getPath("userData"), "session-bags", "staging")
}

function normalizeAnyboxRootURL(value: string | undefined) {
  const baseURL = value?.trim() || process.env.ANYBOX_BASE_URL?.trim() || "https://anybox.com.cn"
  const trimmed = baseURL.replace(/\/+$/g, "")
  return trimmed.endsWith("/v1") ? trimmed.slice(0, -"/v1".length) : trimmed
}

function anyboxBagURL(baseURL: string, pathname: string) {
  return new URL(pathname.replace(/^\/+/, ""), `${normalizeAnyboxRootURL(baseURL)}/`).toString()
}

function normalizeSessionBagDescription(value: string | null | undefined) {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  return trimmed.slice(0, SESSION_BAG_DESCRIPTION_MAX_LENGTH)
}

async function getAnyboxProviderRelaySessionForBag() {
  const result = await requestAgentJSON<AnyboxProviderRelaySession>("/api/providers/anybox/auth/relay-session")
  return result.data
}

function assertConnectedAnyboxSession(session: AnyboxProviderRelaySession) {
  if (!session.connected || !session.accessToken) {
    throw new Error(session.error || "Connect your Anybox account before submitting a report.")
  }

  return {
    accessToken: session.accessToken,
    account: session.account,
    baseURL: normalizeAnyboxRootURL(session.baseURL),
  }
}

const ANYBOX_PROVIDER_ERROR_PREFIX = "ANYBOX_PROVIDER_ERROR:"

async function requestAnyboxSubscriptionJSON<T>(
  pathname: string,
  init: RequestInit = {},
): Promise<{ data: T; session: AnyboxProviderRelaySession }> {
  const session = await getAnyboxProviderRelaySessionForBag()
  const connected = assertConnectedAnyboxSession(session)
  const headers = new Headers(init.headers)
  headers.set("authorization", `Bearer ${connected.accessToken}`)
  headers.set("accept", "application/json")
  const response = await fetch(anyboxBagURL(connected.baseURL, pathname), {
    ...init,
    headers,
  })
  const payload = await response.json().catch(() => null) as T | { error?: { code?: string; message?: string } } | null
  if (!response.ok) {
    const providerError = payload && typeof payload === "object" && "error" in payload
      ? payload.error
      : undefined
    const message = providerError?.message || `Anybox subscription request failed (${response.status}).`
    const code = providerError?.code?.trim()
    throw new Error(code ? `${ANYBOX_PROVIDER_ERROR_PREFIX}${code}:${message}` : message)
  }
  return { data: payload as T, session }
}

async function getAnyboxSubscriptionOverview(): Promise<DesktopSubscriptionOverview> {
  const session = await getAnyboxProviderRelaySessionForBag()
  if (!session.connected || !session.accessToken) {
    return {
      connected: false,
      plans: [],
      subscription: null,
      limits: [],
      ...(session.error ? { error: session.error } : {}),
    }
  }

  const [plansResult, subscriptionResult, limitsResult, pendingOrderResult, pendingRechargeOrderResult] = await Promise.all([
    requestAnyboxSubscriptionJSON<{ data: DesktopSubscriptionPlan[] }>("/api/plans"),
    requestAnyboxSubscriptionJSON<{ subscription: DesktopSubscriptionSummary | null }>("/api/subscription"),
    requestAnyboxSubscriptionJSON<{ limits: DesktopSubscriptionLimit[] }>("/api/usage-limits"),
    requestAnyboxSubscriptionJSON<{
      order: DesktopSubscriptionOrderResponse["order"] | null
      planVersionId: string | null
      upgrade: DesktopSubscriptionOrderResponse["upgrade"]
    }>("/api/subscription/orders/pending"),
    requestAnyboxSubscriptionJSON<{ order: DesktopRechargePaymentOrder | null }>(
      "/api/billing/recharge-orders/pending",
    ),
  ])
  return {
    connected: true,
    balanceMicrocents: session.account?.balanceMicrocents,
    currency: session.account?.currency,
    plans: plansResult.data.data,
    subscription: subscriptionResult.data.subscription,
    limits: limitsResult.data.limits,
    pendingOrder: pendingOrderResult.data.order,
    pendingOrderPlanVersionId: pendingOrderResult.data.planVersionId,
    pendingUpgrade: pendingOrderResult.data.upgrade ?? null,
    pendingRechargeOrder: pendingRechargeOrderResult.data.order,
  }
}

async function cancelAnyboxSubscriptionOrder(orderIdInput: string): Promise<DesktopSubscriptionOrderResponse> {
  const orderId = orderIdInput.trim()
  if (!orderId) throw new Error("Subscription order ID is required.")
  const result = await requestAnyboxSubscriptionJSON<DesktopSubscriptionOrderResponse>(
    `/api/subscription/orders/${encodeURIComponent(orderId)}/cancel`,
    { method: "POST" },
  )
  return result.data
}

async function createAnyboxRechargeOrder(
  input: DesktopIpcInput<"desktop:create-anybox-recharge-order">,
): Promise<DesktopIpcOutput<"desktop:create-anybox-recharge-order">> {
  const result = await requestAnyboxSubscriptionJSON<DesktopIpcOutput<"desktop:create-anybox-recharge-order">>(
    "/api/billing/recharge-orders",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    },
  )
  return result.data
}

async function getAnyboxRechargeOrder(
  orderIdInput: string,
): Promise<DesktopIpcOutput<"desktop:get-anybox-recharge-order">> {
  const orderId = orderIdInput.trim()
  if (!orderId) throw new Error("Recharge order ID is required.")
  const result = await requestAnyboxSubscriptionJSON<DesktopIpcOutput<"desktop:get-anybox-recharge-order">>(
    `/api/billing/recharge-orders/${encodeURIComponent(orderId)}?sync=1`,
  )
  return result.data
}

async function cancelAnyboxRechargeOrder(
  orderIdInput: string,
): Promise<DesktopIpcOutput<"desktop:cancel-anybox-recharge-order">> {
  const orderId = orderIdInput.trim()
  if (!orderId) throw new Error("Recharge order ID is required.")
  const result = await requestAnyboxSubscriptionJSON<DesktopIpcOutput<"desktop:cancel-anybox-recharge-order">>(
    `/api/billing/recharge-orders/${encodeURIComponent(orderId)}/cancel`,
    { method: "POST" },
  )
  return result.data
}

function buildCrc32Table() {
  return Array.from({ length: 256 }, (_, index) => {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1)
    }
    return value >>> 0
  })
}

const CRC32_TABLE = buildCrc32Table()

function crc32(buffer: Buffer) {
  let value = 0xffffffff
  for (const byte of buffer) {
    value = CRC32_TABLE[(value ^ byte) & 0xff]! ^ (value >>> 8)
  }
  return (value ^ 0xffffffff) >>> 0
}

function toDosDateTime(date: Date) {
  const year = Math.max(1980, date.getFullYear())
  return {
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
  }
}

async function listZipEntryFiles(rootDirectory: string, entry: string): Promise<string[]> {
  const absolutePath = path.join(rootDirectory, entry)
  const entryStat = await stat(absolutePath)
  if (entryStat.isFile()) return [entry]
  if (!entryStat.isDirectory()) return []

  const children = await readdir(absolutePath, { withFileTypes: true })
  const files = await Promise.all(children.map((child) => listZipEntryFiles(rootDirectory, path.join(entry, child.name))))
  return files.flat()
}

function toZipPath(value: string) {
  return value.split(path.sep).join("/")
}

async function writeStoredZipFile(input: { rootDirectory: string; zipPath: string; entries: string[] }) {
  const files = (await Promise.all(input.entries.map((entry) => listZipEntryFiles(input.rootDirectory, entry))))
    .flat()
    .map((entry) => ({
      absolutePath: path.join(input.rootDirectory, entry),
      zipPath: toZipPath(entry),
    }))
    .sort((left, right) => left.zipPath.localeCompare(right.zipPath))

  const output = await open(input.zipPath, "w")
  const centralDirectory: Buffer[] = []
  let offset = 0

  async function writeBuffer(buffer: Buffer) {
    await output.write(buffer, 0, buffer.length, offset)
    offset += buffer.length
  }

  try {
    for (const file of files) {
      const content = await readFile(file.absolutePath)
      const fileStat = await stat(file.absolutePath)
      const name = Buffer.from(file.zipPath, "utf8")
      const checksum = crc32(content)
      const size = content.byteLength
      const localOffset = offset
      const dos = toDosDateTime(fileStat.mtime)
      const flags = 0x0800

      if (size > 0xffffffff || localOffset > 0xffffffff) {
        throw new Error("Report zip is too large for the built-in ZIP writer.")
      }

      const localHeader = Buffer.alloc(30)
      localHeader.writeUInt32LE(0x04034b50, 0)
      localHeader.writeUInt16LE(20, 4)
      localHeader.writeUInt16LE(flags, 6)
      localHeader.writeUInt16LE(0, 8)
      localHeader.writeUInt16LE(dos.time, 10)
      localHeader.writeUInt16LE(dos.date, 12)
      localHeader.writeUInt32LE(checksum, 14)
      localHeader.writeUInt32LE(size, 18)
      localHeader.writeUInt32LE(size, 22)
      localHeader.writeUInt16LE(name.byteLength, 26)
      localHeader.writeUInt16LE(0, 28)

      await writeBuffer(localHeader)
      await writeBuffer(name)
      await writeBuffer(content)

      const centralHeader = Buffer.alloc(46)
      centralHeader.writeUInt32LE(0x02014b50, 0)
      centralHeader.writeUInt16LE(20, 4)
      centralHeader.writeUInt16LE(20, 6)
      centralHeader.writeUInt16LE(flags, 8)
      centralHeader.writeUInt16LE(0, 10)
      centralHeader.writeUInt16LE(dos.time, 12)
      centralHeader.writeUInt16LE(dos.date, 14)
      centralHeader.writeUInt32LE(checksum, 16)
      centralHeader.writeUInt32LE(size, 20)
      centralHeader.writeUInt32LE(size, 24)
      centralHeader.writeUInt16LE(name.byteLength, 28)
      centralHeader.writeUInt16LE(0, 30)
      centralHeader.writeUInt16LE(0, 32)
      centralHeader.writeUInt16LE(0, 34)
      centralHeader.writeUInt16LE(0, 36)
      centralHeader.writeUInt32LE(0, 38)
      centralHeader.writeUInt32LE(localOffset, 42)
      centralDirectory.push(Buffer.concat([centralHeader, name]))
    }

    const centralDirectoryOffset = offset
    for (const header of centralDirectory) {
      await writeBuffer(header)
    }
    const centralDirectorySize = offset - centralDirectoryOffset

    if (files.length > 0xffff || centralDirectorySize > 0xffffffff || centralDirectoryOffset > 0xffffffff) {
      throw new Error("Report zip is too large for the built-in ZIP writer.")
    }

    const end = Buffer.alloc(22)
    end.writeUInt32LE(0x06054b50, 0)
    end.writeUInt16LE(0, 4)
    end.writeUInt16LE(0, 6)
    end.writeUInt16LE(files.length, 8)
    end.writeUInt16LE(files.length, 10)
    end.writeUInt32LE(centralDirectorySize, 12)
    end.writeUInt32LE(centralDirectoryOffset, 16)
    end.writeUInt16LE(0, 20)
    await writeBuffer(end)
  } finally {
    await output.close()
  }
}

async function removeSessionBagStaging(record: Pick<SessionBagSubmissionRecord, "rootDirectory">, options: DiscardSessionBagSubmissionOptions = {}) {
  await (options.removeDirectory ?? rm)(record.rootDirectory, { force: true, recursive: true })
}

async function readAnyboxBagError(response: Response) {
  const body = await response.json().catch(() => null)
  const record = readTraceExportRecord(body)
  const error = readTraceExportRecord(record?.error)
  return readTraceExportString(error?.message) ?? readTraceExportString(record?.message) ?? `Anybox report request failed (${response.status})`
}

function readAnyboxBagResponseData<T>(value: unknown): T {
  const envelope = readTraceExportRecord(value)
  if (envelope && "data" in envelope) {
    return envelope.data as T
  }

  return value as T
}

async function requestAnyboxBagJSON<T>(
  record: Pick<SessionBagSubmissionRecord, "accessToken" | "baseURL">,
  pathname: string,
  body: unknown,
  fetchImpl: typeof fetch,
) {
  const response = await fetchImpl(anyboxBagURL(record.baseURL, pathname), {
    method: "POST",
    headers: {
      authorization: `Bearer ${record.accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    throw new Error(await readAnyboxBagError(response))
  }

  return readAnyboxBagResponseData<T>(await response.json())
}

async function prepareSessionBagSubmission(
  input: PrepareSessionBagSubmissionInput,
  options: PrepareSessionBagSubmissionOptions = {},
) {
  const sessionID = input.sessionID.trim()
  if (!sessionID) {
    throw new Error("Session ID is required.")
  }

  const relaySession = await (options.fetchRelaySession ?? getAnyboxProviderRelaySessionForBag)()
  const connectedSession = assertConnectedAnyboxSession(relaySession)
  const now = options.now ?? new Date()
  const generatedAt = now.toISOString()
  const submissionID = `bag-${randomUUID()}`
  const filename = `anybox-bag-${sanitizeSessionTraceFileSegment(sessionID)}-${formatSessionTraceTimestamp(now)}.zip`
  const rootDirectory = path.join(getSessionBagStagingRoot(options), submissionID)
  const traceDirectory = path.join(rootDirectory, "trace")
  const zipPath = path.join(rootDirectory, filename)
  const projectID = input.projectID?.trim() || null
  const workspaceDirectory = input.workspaceDirectory?.trim() || null

  try {
    await (options.makeDirectory ?? mkdir)(rootDirectory, { recursive: true })
    const trace = await getSessionTraceExport({ sessionID })
    const traceResult = await writeSplitSessionTraceExportDirectory(trace, traceDirectory, options)
    const manifest = {
      schemaVersion: 1,
      kind: "session-trace",
      generatedAt,
      appVersion: getDesktopAppVersion(),
      sessionID,
      projectID,
      workspaceDirectory,
      contentType: SESSION_BAG_CONTENT_TYPE,
      filename,
      trace: {
        fileCount: traceResult.fileCount,
        recordCount: traceResult.recordCount,
        redaction: trace.redaction,
      },
    }
    await writeFile(path.join(rootDirectory, "bag-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8")
    await (options.writeZipFile ?? writeStoredZipFile)({
      rootDirectory,
      zipPath,
      entries: ["bag-manifest.json", "trace"],
    })

    const zipContent = await readFile(zipPath)
    const sizeBytes = (await stat(zipPath)).size
    const sha256 = createHash("sha256").update(zipContent).digest("hex")
    const record: SessionBagSubmissionRecord = {
      accessToken: connectedSession.accessToken,
      account: connectedSession.account,
      baseURL: connectedSession.baseURL,
      filename,
      fileCount: traceResult.fileCount,
      generatedAt,
      projectID,
      recordCount: traceResult.recordCount,
      redaction: trace.redaction,
      rootDirectory,
      sessionID,
      sha256,
      sizeBytes,
      submissionID,
      zipPath,
    }
    pendingSessionBagSubmissions.set(submissionID, record)

    return {
      account: record.account,
      baseURL: record.baseURL,
      filename: record.filename,
      fileCount: record.fileCount,
      generatedAt: record.generatedAt,
      projectID: record.projectID,
      recordCount: record.recordCount,
      redaction: record.redaction,
      sessionID: record.sessionID,
      sha256: record.sha256,
      sizeBytes: record.sizeBytes,
      submissionID: record.submissionID,
    } satisfies DesktopIpcOutput<"desktop:prepare-session-bag-submission">
  } catch (error) {
    pendingSessionBagSubmissions.delete(submissionID)
    await rm(rootDirectory, { force: true, recursive: true }).catch((cleanupError) => {
      safeWarn("[desktop] failed to clean up session bag staging after prepare failure:", cleanupError)
    })
    throw error
  }
}

async function uploadSessionBagSubmission(
  input: UploadSessionBagSubmissionInput,
  options: UploadSessionBagSubmissionOptions = {},
) {
  const submissionID = input.submissionID.trim()
  const record = pendingSessionBagSubmissions.get(submissionID)
  if (!record) {
    throw new Error("Session report submission is no longer available.")
  }

  const fetchImpl = options.fetch ?? fetch
  const description = normalizeSessionBagDescription(input.description)
  const initResult = await requestAnyboxBagJSON<{
    bagID: string
    uploadUrl: string
    uploadHeaders?: Record<string, string>
    uploadMethod?: string
  }>(record, "/api/agent/bags/init", {
    kind: "session-trace",
    filename: record.filename,
    contentType: SESSION_BAG_CONTENT_TYPE,
    sizeBytes: record.sizeBytes,
    sha256: record.sha256,
    sessionID: record.sessionID,
    projectID: record.projectID,
    appVersion: getDesktopAppVersion(),
    ...(description ? { description } : {}),
    trace: {
      fileCount: record.fileCount,
      recordCount: record.recordCount,
    },
  }, fetchImpl)

  if (!initResult.bagID || !initResult.uploadUrl) {
    throw new Error("Anybox did not return a report upload target.")
  }

  const uploadResponse = await fetchImpl(initResult.uploadUrl, {
    method: initResult.uploadMethod || "PUT",
    headers: {
      "content-type": SESSION_BAG_CONTENT_TYPE,
      ...(initResult.uploadHeaders ?? {}),
    },
    body: await readFile(record.zipPath),
  })
  if (!uploadResponse.ok) {
    throw new Error(await readAnyboxBagError(uploadResponse))
  }

  const completeResult = await requestAnyboxBagJSON<{
    bagID?: string
    url?: string
  }>(record, "/api/agent/bags/complete", {
    bagID: initResult.bagID,
    sizeBytes: record.sizeBytes,
    sha256: record.sha256,
  }, fetchImpl)

  pendingSessionBagSubmissions.delete(submissionID)
  await removeSessionBagStaging(record, options).catch((cleanupError) => {
    safeWarn("[desktop] failed to clean up session bag staging after upload:", cleanupError)
  })

  return {
    bagID: completeResult.bagID || initResult.bagID,
    url: completeResult.url,
  } satisfies DesktopIpcOutput<"desktop:upload-session-bag-submission">
}

async function discardSessionBagSubmission(
  input: DiscardSessionBagSubmissionInput,
  options: DiscardSessionBagSubmissionOptions = {},
) {
  const submissionID = input.submissionID.trim()
  const record = pendingSessionBagSubmissions.get(submissionID)
  if (!record) {
    return { discarded: false }
  }

  pendingSessionBagSubmissions.delete(submissionID)
  await removeSessionBagStaging(record, options)
  return { discarded: true }
}

function sanitizeSessionTraceFileNamePart(value: string | undefined) {
  return (value ?? "")
    .trim()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 56)
}

function readTraceExportRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function readTraceExportString(value: unknown) {
  return typeof value === "string" ? value : undefined
}

function readTraceExportNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function readTraceExportArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : []
}

function readTraceExportStringArray(value: unknown) {
  return readTraceExportArray(value).filter((item): item is string => typeof item === "string")
}

type TraceFlowToolDiagnostic = {
  code: string
  message?: string
  severity: string
}

function summarizeTraceExportToolDiagnostics(value: unknown): TraceFlowToolDiagnostic[] {
  return readTraceExportArray(value).map((item): TraceFlowToolDiagnostic | undefined => {
    const record = readTraceExportRecord(item)
    const severity = readTraceExportString(record?.severity)
    const code = readTraceExportString(record?.code)
    const message = readTraceExportString(record?.message)
    if (!severity || !code) return undefined

    const diagnostic: TraceFlowToolDiagnostic = {
      severity,
      code,
    }
    if (message) diagnostic.message = message
    return diagnostic
  }).filter((item): item is TraceFlowToolDiagnostic => item !== undefined)
}

function traceExportRelativePath(...parts: string[]) {
  return parts.join("/")
}

function traceExportDiskPath(directory: string, relativePath: string) {
  return path.join(directory, ...relativePath.split("/"))
}

function formatTraceExportRecordFileName(index: number, fallback: string, ...parts: Array<string | undefined>) {
  const ordinal = String(index + 1).padStart(6, "0")
  const slug = parts
    .map((part) => sanitizeSessionTraceFileNamePart(part))
    .filter(Boolean)
    .join("-")
    .slice(0, 96)

  return `${ordinal}-${slug || fallback}.json`
}

function summarizeTraceExportMessage(message: unknown, index: number, file: string) {
  const record = readTraceExportRecord(message)
  const info = readTraceExportRecord(record?.info)
  const pathInfo = readTraceExportRecord(record?.path) ?? readTraceExportRecord(info?.path)

  return {
    index: index + 1,
    file,
    messageID:
      readTraceExportString(record?.id) ??
      readTraceExportString(record?.messageID) ??
      readTraceExportString(info?.id) ??
      readTraceExportString(info?.messageID),
    role: readTraceExportString(record?.role) ?? readTraceExportString(info?.role),
    turnID: readTraceExportString(record?.turnID) ?? readTraceExportString(info?.turnID),
    parentMessageID:
      readTraceExportString(record?.parentMessageID) ??
      readTraceExportString(record?.parentID) ??
      readTraceExportString(info?.parentMessageID) ??
      readTraceExportString(info?.parentID),
    created: readTraceExportNumber(record?.created) ?? readTraceExportNumber(info?.created),
    completed: readTraceExportNumber(record?.completed) ?? readTraceExportNumber(info?.completed),
    providerID: readTraceExportString(record?.providerID) ?? readTraceExportString(info?.providerID),
    modelID: readTraceExportString(record?.modelID) ?? readTraceExportString(info?.modelID),
    agent: readTraceExportString(record?.agent) ?? readTraceExportString(info?.agent),
    cwd: readTraceExportString(pathInfo?.cwd),
  }
}

function summarizeTraceExportTurn(turn: unknown, index: number, file: string) {
  const record = readTraceExportRecord(turn)
  const tools = readTraceExportArray(record?.tools)
  const llmCalls = readTraceExportArray(record?.llmCalls)
  const recentEvents = readTraceExportArray(record?.recentEvents)

  return {
    index: index + 1,
    file,
    turnID: readTraceExportString(record?.turnID),
    status: readTraceExportString(record?.status),
    phase: readTraceExportString(record?.phase),
    startedAt: readTraceExportNumber(record?.startedAt),
    endedAt: readTraceExportNumber(record?.endedAt),
    durationMs: readTraceExportNumber(record?.durationMs),
    lastEventAt: readTraceExportNumber(record?.lastEventAt),
    userMessageID: readTraceExportString(record?.userMessageID),
    agent: readTraceExportString(record?.agent),
    model: readTraceExportString(record?.model),
    toolCount: tools.length,
    llmCallCount: llmCalls.length,
    recentEventCount: recentEvents.length,
  }
}

function summarizeTraceExportToolCall(
  toolCall: unknown,
  index: number,
  file: string,
) {
  const record = readTraceExportRecord(toolCall)
  const failure = readTraceExportRecord(record?.failure)

  return {
    index: index + 1,
    file,
    callID: readTraceExportString(record?.callID),
    tool: readTraceExportString(record?.tool),
    phase: readTraceExportString(record?.phase),
    outcome: readTraceExportString(record?.outcome),
    result: readTraceExportString(record?.result),
    completeness: readTraceExportString(record?.completeness),
    turnControl: readTraceExportString(record?.turnControl),
    sideEffect: readTraceExportString(record?.sideEffect),
    retry: readTraceExportString(record?.retry),
    failureStage: readTraceExportString(failure?.stage),
    failureSource: readTraceExportString(failure?.source),
    failureCode: readTraceExportString(failure?.code),
    failureSeverity: readTraceExportString(failure?.severity),
    failureRetryable: typeof failure?.retryable === "boolean" ? failure.retryable : undefined,
    handlerExecuted: typeof failure?.handlerExecuted === "boolean" ? failure.handlerExecuted : undefined,
    turnID: readTraceExportString(record?.turnID),
    messageID: readTraceExportString(record?.messageID),
    title: readTraceExportString(record?.title),
    startedAt: readTraceExportNumber(record?.startedAt),
    endedAt: readTraceExportNumber(record?.endedAt),
    durationMs: readTraceExportNumber(record?.durationMs),
    eventIDs: readTraceExportStringArray(record?.eventIDs),
    diagnosticStatus: readTraceExportString(record?.diagnosticStatus),
    diagnostics: summarizeTraceExportToolDiagnostics(record?.diagnostics),
  }
}

const TRACE_FLOW_INLINE_VALUE_MAX_CHARS = 420
const TRACE_FLOW_PAYLOAD_REF_MIN_CHARS = 900
const TRACE_FLOW_PAYLOAD_PREVIEW_HEAD_CHARS = 280
const TRACE_FLOW_PAYLOAD_PREVIEW_TAIL_CHARS = 180

type TraceFlowPayloadIndexEntry = {
  id: string
  path: string
  source: "message-part" | "tool-call"
  callID?: string
  partID?: string
  tool?: string
  turnID?: string
  messageID?: string
  fieldPath: string
  chars: number
  sha256: string
  previewHead: string
  previewTail?: string
}

type TraceFlowPayloadFile = {
  content: string
  entry: TraceFlowPayloadIndexEntry
}

type TraceFlowPayloadContext = {
  files: TraceFlowPayloadFile[]
  index: TraceFlowPayloadIndexEntry[]
}

type TraceFlowToolPayloadRefs = {
  input?: string
  modelOutput?: string
  output?: string
  rawInput?: string
}

function stringifyTraceFlowPayload(value: unknown) {
  if (typeof value === "string") return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function compactTraceFlowText(value: string, maxChars: number) {
  const normalized = value
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n/g, "\\n")
    .replace(/\s+/g, " ")
    .trim()
  if (normalized.length <= maxChars) return normalized
  if (maxChars <= 3) return normalized.slice(0, maxChars)
  return `${normalized.slice(0, maxChars - 3)}...`
}

function formatTraceFlowInline(value: unknown, maxChars = TRACE_FLOW_INLINE_VALUE_MAX_CHARS) {
  const text = compactTraceFlowText(stringifyTraceFlowPayload(value), maxChars).replace(/`/g, "'")
  return `\`${text || "-"}\``
}

function escapeTraceFlowMarkdownCell(value: unknown) {
  return String(value ?? "-")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n/g, "<br>")
    .replace(/\|/g, "\\|")
}

function formatTraceFlowTimestamp(timestamp: number | undefined) {
  if (timestamp === undefined) return "-"
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return String(timestamp)
  return date.toISOString()
}

function formatTraceFlowToolDiagnostics(input: {
  diagnosticStatus?: string
  diagnostics?: TraceFlowToolDiagnostic[]
}) {
  if (!input.diagnosticStatus || input.diagnosticStatus === "ok") return "-"
  const diagnostics = input.diagnostics ?? []
  if (diagnostics.length === 0) return input.diagnosticStatus

  return diagnostics.map((diagnostic) => [
    diagnostic.severity,
    diagnostic.code,
    diagnostic.message ? `(${diagnostic.message})` : "",
  ].filter(Boolean).join(":")).join("; ")
}

function formatTraceFlowElapsed(timestamp: number | undefined, firstTimestamp: number | undefined) {
  if (timestamp === undefined || firstTimestamp === undefined) return "-"
  return `+${Math.max(0, timestamp - firstTimestamp)}ms`
}

function createTraceFlowPayloadReference(
  context: TraceFlowPayloadContext,
  input: {
    callID?: string
    fieldPath: string
    messageID?: string
    partID?: string
    source?: TraceFlowPayloadIndexEntry["source"]
    tool?: string
    turnID?: string
    value: unknown
  },
) {
  if (input.value === undefined || input.value === null) return undefined

  const content = stringifyTraceFlowPayload(input.value)
  if (!content || content.length <= TRACE_FLOW_PAYLOAD_REF_MIN_CHARS) return undefined

  const ordinal = context.index.length + 1
  const id = `payload-${String(ordinal).padStart(6, "0")}`
  const extension = typeof input.value === "string" ? "txt" : "json"
  const slug = [
    id,
    sanitizeSessionTraceFileNamePart(input.tool),
    sanitizeSessionTraceFileNamePart(input.callID),
    sanitizeSessionTraceFileNamePart(input.partID),
    sanitizeSessionTraceFileNamePart(input.fieldPath),
  ].filter(Boolean).join("-")
  const file = traceExportRelativePath("payloads", `${slug || id}.${extension}`)
  const sha256 = createHash("sha256").update(content).digest("hex")
  const previewHead = compactTraceFlowText(content.slice(0, TRACE_FLOW_PAYLOAD_PREVIEW_HEAD_CHARS), TRACE_FLOW_PAYLOAD_PREVIEW_HEAD_CHARS)
  const tailSource = content.length > TRACE_FLOW_PAYLOAD_PREVIEW_HEAD_CHARS
    ? content.slice(Math.max(0, content.length - TRACE_FLOW_PAYLOAD_PREVIEW_TAIL_CHARS))
    : ""
  const previewTail = tailSource
    ? compactTraceFlowText(tailSource, TRACE_FLOW_PAYLOAD_PREVIEW_TAIL_CHARS)
    : undefined
  const entry: TraceFlowPayloadIndexEntry = {
    id,
    path: file,
    source: input.source ?? "tool-call",
    callID: input.callID,
    partID: input.partID,
    tool: input.tool,
    turnID: input.turnID,
    messageID: input.messageID,
    fieldPath: input.fieldPath,
    chars: content.length,
    sha256,
    previewHead,
    previewTail,
  }

  context.index.push(entry)
  context.files.push({
    content,
    entry,
  })

  return `[ref:${file} chars=${content.length} sha=${sha256.slice(0, 12)} head=${formatTraceFlowInline(previewHead, 140)}${previewTail ? ` tail=${formatTraceFlowInline(previewTail, 100)}` : ""}]`
}

function buildTraceFlowToolPayloadRefs(
  toolCalls: unknown[],
  context: TraceFlowPayloadContext,
) {
  const refsByCallID = new Map<string, TraceFlowToolPayloadRefs>()
  const fields: Array<keyof TraceFlowToolPayloadRefs> = ["rawInput", "input", "output", "modelOutput"]

  for (const toolCall of toolCalls) {
    const record = readTraceExportRecord(toolCall)
    const callID = readTraceExportString(record?.callID)
    if (!callID) continue

    const refs: TraceFlowToolPayloadRefs = {}
    for (const field of fields) {
      const ref = createTraceFlowPayloadReference(context, {
        callID,
        fieldPath: field,
        messageID: readTraceExportString(record?.messageID),
        tool: readTraceExportString(record?.tool),
        turnID: readTraceExportString(record?.turnID),
        value: record?.[field],
      })
      if (ref) refs[field] = ref
    }

    if (Object.keys(refs).length > 0) {
      refsByCallID.set(callID, refs)
    }
  }

  return refsByCallID
}

function readTraceFlowToolCallID(payload: Record<string, unknown> | null) {
  const part = readTraceExportRecord(payload?.part)
  const request = readTraceExportRecord(payload?.request)

  return (
    readTraceExportString(part?.callID) ??
    readTraceExportString(part?.toolCallID) ??
    readTraceExportString(payload?.toolCallID) ??
    readTraceExportString(request?.toolCallID)
  )
}

function summarizeTraceFlowEventFacts(
  event: unknown,
  recordFile: string,
  toolPayloadRefsByCallID: Map<string, TraceFlowToolPayloadRefs>,
) {
  const record = readTraceExportRecord(event)
  const payload = readTraceExportRecord(record?.payload)
  const part = readTraceExportRecord(payload?.part)
  const state = readTraceExportRecord(part?.state)
  const outcomeRecord = readTraceExportRecord(state?.outcome)
  const control = readTraceExportRecord(state?.control)
  const request = readTraceExportRecord(payload?.request)
  const message = readTraceExportRecord(payload?.message)
  const facts: string[] = []
  const eventID = readTraceExportString(record?.eventID)
  const callID = readTraceFlowToolCallID(payload)
  const tool = readTraceExportString(part?.tool) ?? readTraceExportString(payload?.tool) ?? readTraceExportString(request?.tool)
  const phase = readTraceExportString(state?.phase) ?? readTraceExportString(payload?.phase)
  const outcome = readTraceExportString(outcomeRecord?.kind) ?? readTraceExportString(payload?.outcome)
  const result = readTraceExportString(outcomeRecord?.result) ?? readTraceExportString(payload?.result)
  const completeness = readTraceExportString(outcomeRecord?.completeness) ?? readTraceExportString(payload?.completeness)
  const turnControl = readTraceExportString(control?.mode) ?? readTraceExportString(payload?.turnControl)
  const messageID = readTraceExportString(message?.id) ?? readTraceExportString(payload?.messageID) ?? readTraceExportString(part?.messageID)
  const role = readTraceExportString(message?.role) ?? readTraceExportString(payload?.role)
  const text = readTraceExportString(message?.text) ?? readTraceExportString(payload?.text)
  const parts = readTraceExportArray(message?.parts)

  if (eventID) facts.push(`eventID=${formatTraceFlowInline(eventID, 80)}`)
  if (messageID) facts.push(`messageID=${formatTraceFlowInline(messageID, 80)}`)
  if (role) facts.push(`role=${formatTraceFlowInline(role, 40)}`)
  if (parts.length > 0) facts.push(`parts=${parts.length}`)
  if (text) facts.push(`text=${formatTraceFlowInline(text, 180)}`)
  if (tool) facts.push(`tool=${formatTraceFlowInline(tool, 80)}`)
  if (callID) facts.push(`callID=${formatTraceFlowInline(callID, 80)}`)
  if (phase) facts.push(`phase=${formatTraceFlowInline(phase, 60)}`)
  if (outcome) facts.push(`outcome=${formatTraceFlowInline(outcome, 60)}`)
  if (result) facts.push(`result=${formatTraceFlowInline(result, 60)}`)
  if (completeness) facts.push(`completeness=${formatTraceFlowInline(completeness, 60)}`)
  if (turnControl) facts.push(`control=${formatTraceFlowInline(turnControl, 60)}`)

  if (callID) {
    const refs = toolPayloadRefsByCallID.get(callID)
    if (refs?.rawInput) facts.push(`rawInput=${refs.rawInput}`)
    if (refs?.input) facts.push(`input=${refs.input}`)
    if (refs?.output) facts.push(`output=${refs.output}`)
    if (refs?.modelOutput) facts.push(`modelOutput=${refs.modelOutput}`)
  }

  if (facts.length <= 1 && payload) {
    const payloadText = stringifyTraceFlowPayload(payload)
    if (payloadText.length <= TRACE_FLOW_INLINE_VALUE_MAX_CHARS) {
      facts.push(`payload=${formatTraceFlowInline(payload)}`)
    } else {
      facts.push(`payload=see ${formatTraceFlowInline(recordFile, 120)}`)
    }
  }

  return facts.length > 0 ? facts.join("; ") : "-"
}

function buildSessionTraceEventFlowMarkdown(input: {
  events: unknown[]
  messageIndex: Array<ReturnType<typeof summarizeTraceExportMessage>>
  payloadIndex: TraceFlowPayloadIndexEntry[]
  recordIndex: Array<{
    eventID?: string
    file: string
    index: number
    seq?: number
    timestamp?: number
    turnID?: string
    type?: string
  }>
  runtimeTurnIndex: Array<ReturnType<typeof summarizeTraceExportTurn>>
  toolCallIndex: Array<ReturnType<typeof summarizeTraceExportToolCall>>
  toolPayloadRefsByCallID: Map<string, TraceFlowToolPayloadRefs>
  trace: AgentSessionTraceExport
}) {
  const firstTimestamp = input.recordIndex
    .map((record) => record.timestamp)
    .filter((timestamp): timestamp is number => timestamp !== undefined)
    .sort((left, right) => left - right)[0]
  const session = readTraceExportRecord(input.trace.session)
  const sessionID = readTraceExportString(session?.sessionID) ?? readTraceExportString(session?.id) ?? "-"
  const lines: string[] = [
    "# Anybox Agent Event Flow",
    "",
    "## Manifest",
    `- sessionID: ${formatTraceFlowInline(sessionID, 120)}`,
    `- generatedAt: ${formatTraceFlowTimestamp(input.trace.generatedAt)}`,
    `- eventCount: ${input.events.length}`,
    `- messageCount: ${input.messageIndex.length}`,
    `- turnCount: ${input.runtimeTurnIndex.length}`,
    `- toolCallCount: ${input.toolCallIndex.length}`,
    `- payloadRefCount: ${input.payloadIndex.length}`,
    `- fullEventIndex: ${formatTraceFlowInline("records/index.json", 120)}`,
    `- payloadIndex: ${formatTraceFlowInline("payload-index.json", 120)}`,
    "",
    "## How To Read",
    "- Every row in Event Flow corresponds to one exported event, in exported order.",
    "- The `record` column points to the complete per-event JSON. Large tool inputs and outputs are represented as refs and listed in Payload References.",
    "- Tool calls keep lifecycle (`phase`), execution semantics (`outcome`, `result`, `completeness`), and turn behavior (`turnControl`) separate. Technical failures retain `stage`, `source`, `code`, handler execution, retryability, and severity; use `diagnostics` for command-level details.",
    "- Use `records/index.json`, `tool-calls/index.json`, and `payload-index.json` as machine-readable indexes.",
    "",
    "## Turn Index",
  ]

  if (input.runtimeTurnIndex.length === 0) {
    lines.push("- No runtime turns exported.")
  } else {
    lines.push("| # | turnID | status | phase | started | ended | durationMs | tools | llmCalls | file |")
    lines.push("|---:|---|---|---|---|---|---:|---:|---:|---|")
    for (const turn of input.runtimeTurnIndex) {
      lines.push([
        turn.index,
        turn.turnID ?? "-",
        turn.status ?? "-",
        turn.phase ?? "-",
        formatTraceFlowTimestamp(turn.startedAt),
        formatTraceFlowTimestamp(turn.endedAt),
        turn.durationMs ?? "-",
        turn.toolCount,
        turn.llmCallCount,
        turn.file,
      ].map(escapeTraceFlowMarkdownCell).join(" | ").replace(/^/, "| ").replace(/$/, " |"))
    }
  }

  lines.push("", "## Tool Call Index")
  if (input.toolCallIndex.length === 0) {
    lines.push("- No tool calls exported.")
  } else {
    lines.push("| # | callID | tool | phase | outcome | result | completeness | control | failure | diagnostics | turnID | durationMs | payloadRefs | file |")
    lines.push("|---:|---|---|---|---|---|---|---|---|---|---|---:|---|---|")
    for (const toolCall of input.toolCallIndex) {
      const refs = toolCall.callID ? input.toolPayloadRefsByCallID.get(toolCall.callID) : undefined
      const payloadRefs = refs
        ? Object.entries(refs).map(([field, ref]) => `${field}=${ref}`).join("; ")
        : "-"
      const diagnostics = formatTraceFlowToolDiagnostics(toolCall)
      const failure = toolCall.failureCode
        ? [toolCall.failureStage, toolCall.failureSource, toolCall.failureCode, toolCall.failureSeverity]
            .filter(Boolean)
            .join("/")
        : "-"
      lines.push([
        toolCall.index,
        toolCall.callID ?? "-",
        toolCall.tool ?? "-",
        toolCall.phase ?? "-",
        toolCall.outcome ?? "-",
        toolCall.result ?? "-",
        toolCall.completeness ?? "-",
        toolCall.turnControl ?? "-",
        failure,
        diagnostics,
        toolCall.turnID ?? "-",
        toolCall.durationMs ?? "-",
        payloadRefs,
        toolCall.file,
      ].map(escapeTraceFlowMarkdownCell).join(" | ").replace(/^/, "| ").replace(/$/, " |"))
    }
  }

  lines.push("", "## Event Flow")
  if (input.recordIndex.length === 0) {
    lines.push("- No events exported.")
  } else {
    lines.push("| # | elapsed | timestamp | seq | turnID | type | facts | record |")
    lines.push("|---:|---:|---|---:|---|---|---|---|")
    for (const record of input.recordIndex) {
      const event = input.events[record.index - 1]
      lines.push([
        record.index,
        formatTraceFlowElapsed(record.timestamp, firstTimestamp),
        formatTraceFlowTimestamp(record.timestamp),
        record.seq ?? "-",
        record.turnID ?? "-",
        record.type ?? "-",
        summarizeTraceFlowEventFacts(event, record.file, input.toolPayloadRefsByCallID),
        record.file,
      ].map(escapeTraceFlowMarkdownCell).join(" | ").replace(/^/, "| ").replace(/$/, " |"))
    }
  }

  lines.push("", "## Payload References")
  if (input.payloadIndex.length === 0) {
    lines.push("- No tool payload exceeded the reference threshold.")
  } else {
    lines.push("| id | source | field | chars | sha256 | preview | path |")
    lines.push("|---|---|---|---:|---|---|---|")
    for (const payload of input.payloadIndex) {
      const source = [payload.tool, payload.callID].filter(Boolean).join("/") || payload.source
      lines.push([
        payload.id,
        source,
        payload.fieldPath,
        payload.chars,
        payload.sha256.slice(0, 12),
        payload.previewHead,
        payload.path,
      ].map(escapeTraceFlowMarkdownCell).join(" | ").replace(/^/, "| ").replace(/$/, " |"))
    }
  }

  lines.push("")
  return lines.join("\n")
}

type TraceFlowSourceRecord = {
  eventID?: string
  timestamp?: number
  turnID?: string
}

type TraceFlowSourceIndexes = {
  byCallID: Map<string, TraceFlowSourceRecord[]>
  byMessageID: Map<string, TraceFlowSourceRecord[]>
  byPartID: Map<string, TraceFlowSourceRecord[]>
}

type TraceFlowSemanticRow = {
  detailIndex: string
  facts: string
  kind: string
  order: number
  sourceEvents: string
  subject: string
  timestamp?: number
  turnID?: string
}

function pushTraceFlowSourceRecord(
  map: Map<string, TraceFlowSourceRecord[]>,
  key: string | undefined,
  record: TraceFlowSourceRecord,
) {
  if (!key) return
  const records = map.get(key) ?? []
  records.push(record)
  map.set(key, records)
}

function readTraceFlowPartID(payload: Record<string, unknown> | null) {
  const part = readTraceExportRecord(payload?.part)
  return readTraceExportString(part?.id) ?? readTraceExportString(payload?.partID)
}

function readTraceFlowMessageID(payload: Record<string, unknown> | null) {
  const message = readTraceExportRecord(payload?.message)
  const part = readTraceExportRecord(payload?.part)
  return (
    readTraceExportString(message?.id) ??
    readTraceExportString(payload?.messageID) ??
    readTraceExportString(part?.messageID)
  )
}

function buildTraceFlowSourceIndexes(events: unknown[], recordIndex: Array<TraceFlowSourceRecord>) {
  const indexes: TraceFlowSourceIndexes = {
    byCallID: new Map(),
    byMessageID: new Map(),
    byPartID: new Map(),
  }

  for (const [index, event] of events.entries()) {
    const record = readTraceExportRecord(event)
    const payload = readTraceExportRecord(record?.payload)
    const sourceRecord = recordIndex[index]
    const source = {
      eventID: readTraceExportString(record?.eventID),
      timestamp: readTraceExportNumber(record?.timestamp),
      turnID: readTraceExportString(record?.turnID),
      ...(sourceRecord ?? {}),
    }

    pushTraceFlowSourceRecord(indexes.byCallID, readTraceFlowToolCallID(payload), source)
    pushTraceFlowSourceRecord(indexes.byMessageID, readTraceFlowMessageID(payload), source)
    pushTraceFlowSourceRecord(indexes.byPartID, readTraceFlowPartID(payload), source)
  }

  return indexes
}

function summarizeTraceFlowSourceEvents(records: TraceFlowSourceRecord[] | undefined) {
  const eventIDs = (records ?? []).map((record) => record.eventID).filter((eventID): eventID is string => Boolean(eventID))
  if (eventIDs.length === 0) return "-"
  const preview = eventIDs.slice(0, 6).map((eventID) => formatTraceFlowInline(eventID, 80)).join(", ")
  const suffix = eventIDs.length > 6 ? `, +${eventIDs.length - 6} more` : ""
  return `count=${eventIDs.length}; ids=${preview}${suffix}; index=${formatTraceFlowInline("records/index.json", 120)}`
}

function firstTraceFlowSourceTimestamp(records: TraceFlowSourceRecord[] | undefined) {
  return (records ?? [])
    .map((record) => record.timestamp)
    .filter((timestamp): timestamp is number => timestamp !== undefined)
    .sort((left, right) => left - right)[0]
}

function buildTraceFlowMessageFileByID(messageIndex: Array<ReturnType<typeof summarizeTraceExportMessage>>) {
  const filesByID = new Map<string, string>()
  for (const message of messageIndex) {
    if (message.messageID) filesByID.set(message.messageID, message.file)
  }
  return filesByID
}

function readTraceFlowPartTimestamp(part: Record<string, unknown>, fallback: number | undefined) {
  const time = readTraceExportRecord(part.time)
  return readTraceExportNumber(time?.start) ?? readTraceExportNumber(time?.end) ?? fallback
}

function summarizeTraceFlowPartFacts(input: {
  context: TraceFlowPayloadContext
  kind: string
  messageID?: string
  part: Record<string, unknown>
  turnID?: string
}) {
  const facts: string[] = []
  const partID = readTraceExportString(input.part.id)
  const text = readTraceExportString(input.part.text)
  const type = readTraceExportString(input.part.type)
  const title = readTraceExportString(input.part.title)
  const filename = readTraceExportString(input.part.filename)
  const mime = readTraceExportString(input.part.mime)
  const url = readTraceExportString(input.part.url)
  const sourceID = readTraceExportString(input.part.sourceID)
  const files = readTraceExportStringArray(input.part.files)
  const summary = readTraceExportRecord(input.part.summary)
  const additions = readTraceExportNumber(summary?.additions)
  const deletions = readTraceExportNumber(summary?.deletions)
  const hash = readTraceExportString(input.part.hash)

  if (partID) facts.push(`partID=${formatTraceFlowInline(partID, 80)}`)
  if (text !== undefined) {
    facts.push(`chars=${text.length}`)
    const ref = createTraceFlowPayloadReference(input.context, {
      fieldPath: `${input.kind}.text`,
      messageID: input.messageID,
      partID,
      source: "message-part",
      turnID: input.turnID,
      value: text,
    })
    facts.push(`text=${ref ?? formatTraceFlowInline(text, 220)}`)
  }
  if (title) facts.push(`title=${formatTraceFlowInline(title, 120)}`)
  if (filename) facts.push(`filename=${formatTraceFlowInline(filename, 120)}`)
  if (mime) facts.push(`mime=${formatTraceFlowInline(mime, 80)}`)
  if (url && type === "source-url") facts.push(`url=${formatTraceFlowInline(url, 160)}`)
  if (sourceID) facts.push(`sourceID=${formatTraceFlowInline(sourceID, 80)}`)
  if (files.length > 0) facts.push(`files=${files.length}`)
  if (additions !== undefined || deletions !== undefined) {
    facts.push(`diff=+${additions ?? 0}/-${deletions ?? 0}`)
  }
  if (hash) facts.push(`hash=${formatTraceFlowInline(hash, 80)}`)

  return facts.join("; ") || "-"
}

function traceFlowSemanticKindForPart(type: string | undefined, role: string | undefined) {
  switch (type) {
    case "reasoning":
      return "reasoning"
    case "text":
      return role === "assistant" ? "response" : "message"
    case "source-document":
    case "source-url":
      return "source"
    case "file":
    case "image":
      return "artifact"
    case "patch":
      return "patch"
    case "snapshot":
      return "snapshot"
    case "permission":
      return "approval"
    case "subtask":
      return "subtask"
    case "retry":
      return "retry"
    case "agent":
      return "agent"
    case "compaction":
      return "compaction"
    default:
      return type ? `part:${type}` : "part"
  }
}

function shouldSkipTraceFlowSemanticPart(type: string | undefined) {
  return type === "tool" || type === "step-start" || type === "step-finish"
}

function buildTraceFlowSemanticRows(input: {
  context: TraceFlowPayloadContext
  events: unknown[]
  messageIndex: Array<ReturnType<typeof summarizeTraceExportMessage>>
  messages: unknown[]
  recordIndex: Array<TraceFlowSourceRecord>
  toolCallIndex: Array<ReturnType<typeof summarizeTraceExportToolCall>>
  toolCalls: unknown[]
  toolPayloadRefsByCallID: Map<string, TraceFlowToolPayloadRefs>
}) {
  const sourceIndexes = buildTraceFlowSourceIndexes(input.events, input.recordIndex)
  const messageFileByID = buildTraceFlowMessageFileByID(input.messageIndex)
  const rows: TraceFlowSemanticRow[] = []
  let order = 0

  for (const message of input.messages) {
    const record = readTraceExportRecord(message)
    const info = readTraceExportRecord(record?.info) ?? record
    const parts = readTraceExportArray(record?.parts)
    const messageID = readTraceExportString(info?.id) ?? readTraceExportString(record?.id)
    const role = readTraceExportString(info?.role)
    const turnID = readTraceExportString(info?.turnID) ?? readTraceExportString(record?.turnID)
    const created = readTraceExportNumber(info?.created) ?? readTraceExportNumber(record?.created)
    const messageFile = messageID ? messageFileByID.get(messageID) : undefined

    if (parts.length === 0) {
      order += 1
      rows.push({
        detailIndex: messageFile ?? "messages/index.json",
        facts: [
          messageID ? `messageID=${formatTraceFlowInline(messageID, 80)}` : "",
          role ? `role=${formatTraceFlowInline(role, 40)}` : "",
        ].filter(Boolean).join("; ") || "-",
        kind: role === "assistant" ? "response" : "message",
        order,
        sourceEvents: summarizeTraceFlowSourceEvents(messageID ? sourceIndexes.byMessageID.get(messageID) : undefined),
        subject: role ? `${role} message` : "message",
        timestamp: created,
        turnID,
      })
      continue
    }

    for (const partValue of parts) {
      const part = readTraceExportRecord(partValue)
      const type = readTraceExportString(part?.type)
      if (!part || shouldSkipTraceFlowSemanticPart(type)) continue

      const partID = readTraceExportString(part.id)
      const kind = traceFlowSemanticKindForPart(type, role)
      const subject = [
        kind,
        readTraceExportString(part.tool),
        readTraceExportString(part.filename),
        readTraceExportString(part.title),
        partID,
      ].filter(Boolean).join(" / ")
      const sourceRecords =
        (partID ? sourceIndexes.byPartID.get(partID) : undefined) ??
        (messageID ? sourceIndexes.byMessageID.get(messageID) : undefined)

      order += 1
      rows.push({
        detailIndex: messageFile ?? "messages/index.json",
        facts: summarizeTraceFlowPartFacts({
          context: input.context,
          kind,
          messageID,
          part,
          turnID,
        }),
        kind,
        order,
        sourceEvents: summarizeTraceFlowSourceEvents(sourceRecords),
        subject: subject || kind,
        timestamp: firstTraceFlowSourceTimestamp(sourceRecords) ?? readTraceFlowPartTimestamp(part, created),
        turnID,
      })
    }
  }

  for (const [index, toolCall] of input.toolCalls.entries()) {
    const record = readTraceExportRecord(toolCall)
    const summary = input.toolCallIndex[index]
    const callID = readTraceExportString(record?.callID) ?? summary?.callID
    if (!callID) continue

    const refs = input.toolPayloadRefsByCallID.get(callID)
    const diagnostics = summary ? formatTraceFlowToolDiagnostics(summary) : "-"
    const facts = [
      `callID=${formatTraceFlowInline(callID, 80)}`,
      summary?.phase ? `phase=${formatTraceFlowInline(summary.phase, 60)}` : "",
      summary?.outcome ? `outcome=${formatTraceFlowInline(summary.outcome, 60)}` : "",
      summary?.result ? `result=${formatTraceFlowInline(summary.result, 60)}` : "",
      summary?.completeness ? `completeness=${formatTraceFlowInline(summary.completeness, 60)}` : "",
      summary?.turnControl ? `control=${formatTraceFlowInline(summary.turnControl, 60)}` : "",
      summary?.failureCode
        ? `failure=${formatTraceFlowInline([
            summary.failureStage,
            summary.failureSource,
            summary.failureCode,
            summary.failureSeverity,
          ].filter(Boolean).join("/"), 180)}`
        : "",
      diagnostics !== "-" ? `diagnostics=${formatTraceFlowInline(diagnostics, 220)}` : "",
      summary?.durationMs !== undefined ? `durationMs=${summary.durationMs}` : "",
      summary?.title ? `title=${formatTraceFlowInline(summary.title, 140)}` : "",
      summary?.eventIDs.length ? `sourceEventCount=${summary.eventIDs.length}` : "",
      refs?.rawInput ? `rawInput=${refs.rawInput}` : record?.rawInput !== undefined ? `rawInput=${formatTraceFlowInline(record.rawInput, 160)}` : "",
      refs?.input ? `input=${refs.input}` : record?.input !== undefined ? `input=${formatTraceFlowInline(record.input, 180)}` : "",
      refs?.output ? `output=${refs.output}` : record?.output !== undefined ? `output=${formatTraceFlowInline(record.output, 180)}` : "",
      refs?.modelOutput ? `modelOutput=${refs.modelOutput}` : record?.modelOutput !== undefined ? `modelOutput=${formatTraceFlowInline(record.modelOutput, 180)}` : "",
      summary?.eventIDs.length ? `rawIndex=${formatTraceFlowInline("records/index.json", 120)}` : "",
    ].filter(Boolean)
    const sourceRecords = sourceIndexes.byCallID.get(callID)

    order += 1
    rows.push({
      detailIndex: summary?.file ?? "tool-calls/index.json",
      facts: facts.join("; ") || "-",
      kind: "tool",
      order,
      sourceEvents: summarizeTraceFlowSourceEvents(sourceRecords),
      subject: summary?.tool ?? readTraceExportString(record?.tool) ?? "tool",
      timestamp: summary?.startedAt ?? firstTraceFlowSourceTimestamp(sourceRecords),
      turnID: summary?.turnID ?? readTraceExportString(record?.turnID),
    })
  }

  return rows.sort((left, right) => {
    const leftTime = left.timestamp ?? Number.MAX_SAFE_INTEGER
    const rightTime = right.timestamp ?? Number.MAX_SAFE_INTEGER
    if (leftTime !== rightTime) return leftTime - rightTime
    return left.order - right.order
  })
}

function formatTraceFlowSemanticBlockHeading(row: TraceFlowSemanticRow, index: number) {
  const subject = compactTraceFlowText(row.subject, 140)
  return subject && subject !== row.kind
    ? `### ${index}. ${row.kind} - ${subject}`
    : `### ${index}. ${row.kind}`
}

function formatTraceFlowSemanticBlockFieldValue(value: unknown) {
  if (value === undefined || value === null || value === "") return "-"
  return String(value)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n/g, "\\n")
}

function pushTraceFlowSemanticBlockField(lines: string[], label: string, value: unknown) {
  lines.push(`- ${label}: ${formatTraceFlowSemanticBlockFieldValue(value)}`)
}

function buildSessionTraceSemanticFlowMarkdown(input: {
  context: TraceFlowPayloadContext
  events: unknown[]
  messageIndex: Array<ReturnType<typeof summarizeTraceExportMessage>>
  messages: unknown[]
  recordIndex: Array<TraceFlowSourceRecord>
  runtimeTurnIndex: Array<ReturnType<typeof summarizeTraceExportTurn>>
  toolCallIndex: Array<ReturnType<typeof summarizeTraceExportToolCall>>
  toolCalls: unknown[]
  toolPayloadRefsByCallID: Map<string, TraceFlowToolPayloadRefs>
  trace: AgentSessionTraceExport
}) {
  const rows = buildTraceFlowSemanticRows(input)
  const firstTimestamp = rows
    .map((row) => row.timestamp)
    .filter((timestamp): timestamp is number => timestamp !== undefined)
    .sort((left, right) => left - right)[0]
  const session = readTraceExportRecord(input.trace.session)
  const sessionID = readTraceExportString(session?.sessionID) ?? readTraceExportString(session?.id) ?? "-"
  const lines: string[] = [
    "# Anybox Agent Semantic Flow",
    "",
    "## Manifest",
    `- sessionID: ${formatTraceFlowInline(sessionID, 120)}`,
    `- generatedAt: ${formatTraceFlowTimestamp(input.trace.generatedAt)}`,
    `- semanticEventCount: ${rows.length}`,
    `- rawEventCount: ${input.events.length}`,
    `- turnCount: ${input.runtimeTurnIndex.length}`,
    `- payloadRefCount: ${input.context.index.length}`,
    `- rawEventFlow: ${formatTraceFlowInline("event-flow.md", 120)}`,
    `- rawEventIndex: ${formatTraceFlowInline("records/index.json", 120)}`,
    `- payloadIndex: ${formatTraceFlowInline("payload-index.json", 120)}`,
    "",
    "## How To Read",
    "- This file is a high-level semantic flow. Reasoning text, assistant responses, tool calls, artifacts, approvals, and patches are the minimum units.",
    "- Lifecycle details such as started/completed/delta are intentionally not rows here. Use the source event IDs with records/index.json or open event-flow.md when raw runtime detail is needed.",
    "- Tool facts include `diagnostics` when a completed tool call still has command-level warnings or errors.",
    "- Each semantic event is an individual Markdown block so language models can analyze the flow chunk by chunk without parsing a wide table.",
    "- Large semantic content is represented by refs into payloads/ and indexed by payload-index.json.",
    "",
    "## Semantic Flow",
  ]

  if (rows.length === 0) {
    lines.push("- No semantic events exported.")
  } else {
    for (const [index, row] of rows.entries()) {
      if (index > 0) lines.push("")
      lines.push(formatTraceFlowSemanticBlockHeading(row, index + 1))
      pushTraceFlowSemanticBlockField(lines, "elapsed", formatTraceFlowElapsed(row.timestamp, firstTimestamp))
      pushTraceFlowSemanticBlockField(lines, "timestamp", formatTraceFlowTimestamp(row.timestamp))
      pushTraceFlowSemanticBlockField(lines, "turnID", row.turnID)
      pushTraceFlowSemanticBlockField(lines, "kind", row.kind)
      pushTraceFlowSemanticBlockField(lines, "subject", row.subject)
      pushTraceFlowSemanticBlockField(lines, "facts", row.facts)
      pushTraceFlowSemanticBlockField(lines, "sourceEvents", row.sourceEvents)
      pushTraceFlowSemanticBlockField(lines, "detailIndex", row.detailIndex)
    }
  }

  lines.push("", "## Index Map")
  lines.push("- `messages/index.json`: locate full message files by messageID.")
  lines.push("- `tool-calls/index.json`: locate full tool call files by callID.")
  lines.push("- `records/index.json`: locate raw runtime event files by source event ID.")
  lines.push("- `payload-index.json`: locate large text/tool payload files by payload ref.")
  lines.push("")

  return lines.join("\n")
}

function buildSessionTraceReadmeMarkdown(input: {
  eventCount: number
  messageCount: number
  payloadCount: number
  sessionID: string
  toolCallCount: number
  trace: AgentSessionTraceExport
  turnCount: number
}) {
  const lines = [
    "# README FIRST: Anybox Session Trace",
    "",
    "This directory is a machine-readable debug archive for one Anybox agent session. Start here before opening individual JSON records.",
    "",
    "## Session",
    `- sessionID: ${formatTraceFlowInline(input.sessionID, 120)}`,
    `- generatedAt: ${formatTraceFlowTimestamp(input.trace.generatedAt)}`,
    `- schemaVersion: ${input.trace.schemaVersion}`,
    `- mode: ${formatTraceFlowInline(input.trace.mode, 40)}`,
    `- messages: ${input.messageCount}`,
    `- rawEvents: ${input.eventCount}`,
    `- turns: ${input.turnCount}`,
    `- toolCalls: ${input.toolCallCount}`,
    `- payloadRefs: ${input.payloadCount}`,
    "",
    "## Start Here",
    "- For a compact human/agent timeline, read `semantic-flow.md` first. It groups reasoning, responses, tools, patches, artifacts, approvals, and snapshots into semantic blocks.",
    "- For the raw chronological event stream, read `event-flow.md`. It keeps low-level runtime events and points to exact record files.",
    "- For exact JSON records, use an `index.json` file first, then open the referenced per-record file.",
    "- For large text, tool input, tool output, or patch content, follow `[ref:payloads/...]` links and verify them with `payload-index.json`.",
    "- Tool-call `phase`, `outcome`, `result`, `completeness`, and `turnControl` are independent. Failed calls also preserve structured `failure`; use `diagnosticStatus` and `diagnostics` for command-level details.",
    "",
    "## Directory Map",
    "- `manifest.json`: export metadata, counts, redaction settings, and the canonical layout map.",
    "- `semantic-flow.md`: high-level semantic timeline. Each block includes `sourceEvents` and `detailIndex` so you can jump back to raw records.",
    "- `event-flow.md`: raw event timeline table, useful when debugging runtime order, event seq, or state transitions.",
    "- `messages/index.json`: searchable message index with `messageID`, `role`, `parentMessageID`, `created`, `completed`, `providerID`, `modelID`, `agent`, `cwd`, and `turnID` when available.",
    "- `messages/`: full message records. Open these when you need original message `info` and `parts`.",
    "- `records/index.json`: searchable raw event index by event ID, timestamp, seq, type, turn ID, and related tool-call files.",
    "- `records/`: full raw runtime event records. Use these to prove exactly what happened at a specific event.",
    "- `tool-calls/index.json`: searchable tool-call index by call ID, tool name, phase, outcome, result, completeness, turn control, timing, and related event IDs.",
    "- `tool-calls/`: full canonical tool-call records. Use these for exact input, output, execution certainty, and retry-safety fields.",
    "- `payload-index.json`: index for large payload files. `chars` and `sha256` describe the exact bytes written to `payloads/`.",
    "- `payloads/`: large payload bodies split out from flow files. These files are written exactly as hashed and may not end with a newline.",
    "- `runtime/status.json`: compact runtime state plus pointers to recent events and turn index.",
    "- `runtime/recent-events.json`: recent runtime events captured from runtime state.",
    "- `runtime/turns/index.json`: searchable turn index with `turnID`, status, tool count, LLM call count, and timing.",
    "- `runtime/turns/`: full runtime turn records. Use these to inspect tool/LLM call arrays and final turn state.",
    "",
    "## Lookup Recipes",
    "- Need to understand the session quickly: read `semantic-flow.md`, then follow `detailIndex` and `sourceEvents` only for suspicious blocks.",
    "- Need to debug event ordering: read `records/index.json`, sort or filter by `timestamp`/`seq`, then open the referenced files in `records/`.",
    "- Need to inspect a model answer: find the assistant row in `messages/index.json`, then open its file in `messages/`.",
    "- Need to inspect a tool call: find the call in `tool-calls/index.json`, then open its full file and related raw events.",
    "- Need exact large content: locate the `[ref:payloads/...]` path, open that payload, then compare against `payload-index.json`.",
    "- Need final turn state: read `runtime/status.json`, then open `runtime/turns/index.json` and the referenced turn file.",
    "",
    "## Data Notes",
    "- All paths in indexes are relative to this directory.",
    "- JSON and Markdown files are UTF-8.",
    "- Sensitive keys matching the redaction pattern in `manifest.json` may be replaced with `[REDACTED]`.",
    "- This export uses `schemaVersion: 3`; optional files such as this README are discoverability aids, not required wire fields.",
    "",
  ]

  return lines.join("\n")
}

async function writeSplitSessionTraceExportDirectory(
  trace: AgentSessionTraceExport,
  directory: string,
  options: SaveSessionTraceExportDirectoryOptions,
) {
  const makeDirectory = options.makeDirectory ?? ((target: string, mkdirOptions: { recursive: true }) =>
    mkdir(target, mkdirOptions))
  const writeTraceFile = options.writeTraceFile ?? ((filePath: string, data: string, encoding: BufferEncoding) =>
    writeFile(filePath, data, encoding))
  const directories = [
    directory,
    traceExportDiskPath(directory, "records"),
    traceExportDiskPath(directory, "records/pages"),
    traceExportDiskPath(directory, "messages"),
    traceExportDiskPath(directory, "tool-calls"),
    traceExportDiskPath(directory, "payloads"),
    traceExportDiskPath(directory, "runtime"),
    traceExportDiskPath(directory, "runtime/turns"),
  ]
  let fileCount = 0

  for (const target of directories) {
    await makeDirectory(target, { recursive: true })
  }

  async function writeJSON(relativePath: string, value: unknown) {
    await writeTraceFile(traceExportDiskPath(directory, relativePath), `${JSON.stringify(value, null, 2)}\n`, "utf8")
    fileCount += 1
  }

  async function writeText(relativePath: string, value: string) {
    await writeTraceFile(traceExportDiskPath(directory, relativePath), value.endsWith("\n") ? value : `${value}\n`, "utf8")
    fileCount += 1
  }

  async function writeExactText(relativePath: string, value: string) {
    await writeTraceFile(traceExportDiskPath(directory, relativePath), value, "utf8")
    fileCount += 1
  }

  const messages = readTraceExportArray(trace.messages)
  const events = readTraceExportArray(trace.events)
  const toolCalls = readTraceExportArray(trace.toolCalls)
  const runtimeTurns = readTraceExportArray(trace.runtime?.turns)
  const runtimeRecentEvents = readTraceExportArray(trace.runtime?.recentEvents)
  const session = readTraceExportRecord(trace.session)
  const sessionID = readTraceExportString(session?.sessionID) ?? readTraceExportString(session?.id) ?? "-"
  const toolCallFilesByEventID = new Map<string, string[]>()
  const toolCallIndex = toolCalls.map((toolCall, index) => {
    const record = readTraceExportRecord(toolCall)
    const tool = readTraceExportString(record?.tool)
    const callID = readTraceExportString(record?.callID)
    const eventIDs = readTraceExportStringArray(record?.eventIDs)
    const file = traceExportRelativePath(
      "tool-calls",
      formatTraceExportRecordFileName(index, "tool-call", tool, callID),
    )
    for (const eventID of eventIDs) {
      const files = toolCallFilesByEventID.get(eventID) ?? []
      files.push(file)
      toolCallFilesByEventID.set(eventID, files)
    }

    return summarizeTraceExportToolCall(toolCall, index, file)
  })
  const messageIndex = messages.map((message, index) => {
    const summary = summarizeTraceExportMessage(message, index, "")
    const file = traceExportRelativePath(
      "messages",
      formatTraceExportRecordFileName(index, "message", summary.role, summary.messageID),
    )
    return summarizeTraceExportMessage(message, index, file)
  })
  const runtimeTurnIndex = runtimeTurns.map((turn, index) => {
    const turnRecord = readTraceExportRecord(turn)
    const turnID = readTraceExportString(turnRecord?.turnID)
    const file = traceExportRelativePath(
      "runtime",
      "turns",
      formatTraceExportRecordFileName(index, "turn", turnID),
    )
    return summarizeTraceExportTurn(turn, index, file)
  })
  const recordIndex = events.map((event, index) => {
    const record = readTraceExportRecord(event)
    const eventID = readTraceExportString(record?.eventID)
    const eventType = readTraceExportString(record?.type)
    const seq = readTraceExportNumber(record?.seq)
    const file = traceExportRelativePath(
      "records",
      formatTraceExportRecordFileName(index, "event", eventType, seq === undefined ? undefined : String(seq), eventID),
    )

    return {
      index: index + 1,
      file,
      eventID,
      sessionID: readTraceExportString(record?.sessionID),
      turnID: readTraceExportString(record?.turnID),
      seq,
      timestamp: readTraceExportNumber(record?.timestamp),
      type: eventType,
      relatedToolCallFiles: eventID ? toolCallFilesByEventID.get(eventID) ?? [] : [],
    }
  })
  const payloadContext: TraceFlowPayloadContext = {
    files: [],
    index: [],
  }
  const toolPayloadRefsByCallID = buildTraceFlowToolPayloadRefs(toolCalls, payloadContext)
  const semanticFlowMarkdown = buildSessionTraceSemanticFlowMarkdown({
    context: payloadContext,
    events,
    messageIndex,
    messages,
    recordIndex,
    runtimeTurnIndex,
    toolCallIndex,
    toolCalls,
    toolPayloadRefsByCallID,
    trace,
  })
  const eventFlowMarkdown = buildSessionTraceEventFlowMarkdown({
    events,
    messageIndex,
    payloadIndex: payloadContext.index,
    recordIndex,
    runtimeTurnIndex,
    toolCallIndex,
    toolPayloadRefsByCallID,
    trace,
  })
  const latestTurn = trace.runtime?.latestTurn ?? null
  const runtimeStatus: Partial<AgentSessionTraceExport["runtime"]> = trace.runtime ? { ...trace.runtime } : {}
  delete runtimeStatus.turns
  delete runtimeStatus.recentEvents
  delete runtimeStatus.latestTurn
  const latestTurnRecord = readTraceExportRecord(latestTurn)
  const latestTurnID = readTraceExportString(latestTurnRecord?.turnID)
  const latestTurnIndex = latestTurnID
    ? runtimeTurns.findIndex((turn) => readTraceExportString(readTraceExportRecord(turn)?.turnID) === latestTurnID)
    : -1
  const readmeMarkdown = buildSessionTraceReadmeMarkdown({
    eventCount: events.length,
    messageCount: messages.length,
    payloadCount: payloadContext.index.length,
    sessionID,
    toolCallCount: toolCalls.length,
    trace,
    turnCount: runtimeTurns.length,
  })

  const tracePageIndex: Array<{
    page: number
    file: string
    count: number
    firstPosition?: number
    lastPosition?: number
  }> = []
  let totalTraceRecordCount = events.length
  const writeTracePage = async (pageNumber: number, pageEvents: AgentSessionTraceExport["events"]) => {
    const file = traceExportRelativePath("records", "pages", `page-${String(pageNumber).padStart(6, "0")}.json`)
    await writeJSON(file, {
      schemaVersion: trace.schemaVersion,
      mode: "safe",
      page: pageNumber,
      pageSize: 1_000,
      events: pageEvents,
    })
    tracePageIndex.push({
      page: pageNumber,
      file,
      count: pageEvents.length,
      firstPosition: pageEvents.at(0)?.position,
      lastPosition: pageEvents.at(-1)?.position,
    })
  }

  if (trace.truncation?.eventsTruncated) {
    const loadPage = options.loadTraceEventPage ?? getSessionTraceEventPage
    let afterPosition = 0
    let pageNumber = 0
    while (true) {
      const page = await loadPage({ sessionID, afterPosition, limit: 1_000 })
      totalTraceRecordCount = page.totalRetainedEventCount
      if (page.events.length === 0) break
      pageNumber += 1
      await writeTracePage(pageNumber, page.events)
      if (!page.hasMore) break
      if (page.nextPosition <= afterPosition) {
        throw new Error("Trace page cursor did not advance.")
      }
      afterPosition = page.nextPosition
    }
  } else {
    totalTraceRecordCount = trace.stats.totalRetainedEventCount ?? events.length
    for (let offset = 0; offset < events.length; offset += 1_000) {
      await writeTracePage(Math.floor(offset / 1_000) + 1, events.slice(offset, offset + 1_000) as AgentSessionTraceExport["events"])
    }
  }
  await writeJSON("records/pages/index.json", {
    schemaVersion: trace.schemaVersion,
    mode: "safe",
    pageSize: 1_000,
    totalRetainedEventCount: totalTraceRecordCount,
    pages: tracePageIndex,
  })

  await writeJSON("manifest.json", {
    schemaVersion: trace.schemaVersion,
    exportFormat: "anybox-session-trace-directory",
    generatedAt: trace.generatedAt,
    mode: trace.mode,
    session: trace.session,
    stats: trace.stats,
    redaction: trace.redaction,
    layout: {
      readme: "README_FIRST.md",
      eventFlow: "event-flow.md",
      semanticFlow: "semantic-flow.md",
      records: "records/index.json",
      tracePages: "records/pages/index.json",
      messages: "messages/index.json",
      toolCalls: "tool-calls/index.json",
      payloadIndex: "payload-index.json",
      payloads: "payloads/",
      runtimeStatus: "runtime/status.json",
      runtimeRecentEvents: "runtime/recent-events.json",
      runtimeTurns: "runtime/turns/index.json",
    },
  })
  await writeText("README_FIRST.md", readmeMarkdown)
  await writeText("event-flow.md", eventFlowMarkdown)
  await writeText("semantic-flow.md", semanticFlowMarkdown)
  await writeJSON("payload-index.json", payloadContext.index)
  for (const payload of payloadContext.files) {
    await writeExactText(payload.entry.path, payload.content)
  }

  await writeJSON("records/index.json", recordIndex)
  for (const [index, event] of events.entries()) {
    await writeJSON(recordIndex[index].file, {
      schemaVersion: trace.schemaVersion,
      recordType: "event",
      index: index + 1,
      event,
      relatedToolCallFiles: recordIndex[index].relatedToolCallFiles,
    })
  }

  await writeJSON("messages/index.json", messageIndex)
  for (const [index, message] of messages.entries()) {
    await writeJSON(messageIndex[index].file, {
      schemaVersion: trace.schemaVersion,
      recordType: "message",
      index: index + 1,
      message,
    })
  }

  await writeJSON("tool-calls/index.json", toolCallIndex)
  for (const [index, toolCall] of toolCalls.entries()) {
    await writeJSON(toolCallIndex[index].file, {
      schemaVersion: trace.schemaVersion,
      recordType: "tool-call",
      index: index + 1,
      toolCall,
    })
  }

  await writeJSON("runtime/status.json", {
    schemaVersion: trace.schemaVersion,
    runtime: runtimeStatus,
    latestTurn: latestTurn && latestTurnIndex >= 0
      ? runtimeTurnIndex[latestTurnIndex]
      : latestTurn
        ? {
            turnID: latestTurnID,
            status: readTraceExportString(latestTurnRecord?.status),
            phase: readTraceExportString(latestTurnRecord?.phase),
            startedAt: readTraceExportNumber(latestTurnRecord?.startedAt),
            endedAt: readTraceExportNumber(latestTurnRecord?.endedAt),
            durationMs: readTraceExportNumber(latestTurnRecord?.durationMs),
            lastEventAt: readTraceExportNumber(latestTurnRecord?.lastEventAt),
          }
        : null,
    turns: {
      count: runtimeTurns.length,
      index: "runtime/turns/index.json",
    },
    recentEvents: {
      count: runtimeRecentEvents.length,
      file: "runtime/recent-events.json",
    },
  })
  await writeJSON("runtime/recent-events.json", runtimeRecentEvents)
  await writeJSON("runtime/turns/index.json", runtimeTurnIndex)
  for (const [index, turn] of runtimeTurns.entries()) {
    await writeJSON(runtimeTurnIndex[index].file, {
      schemaVersion: trace.schemaVersion,
      recordType: "runtime-turn",
      index: index + 1,
      turn,
    })
  }

  return {
    fileCount,
    recordCount: totalTraceRecordCount,
  }
}

async function getSessionTraceEventPage(input: { sessionID: string; afterPosition: number; limit: number }) {
  const search = new URLSearchParams({
    afterPosition: String(input.afterPosition),
    limit: String(input.limit),
  })
  const result = await requestAgentJSON<AgentSessionTraceEventPage>(
    `/api/debug/sessions/${encodeURIComponent(input.sessionID)}/trace-events?${search.toString()}`,
  )
  return result.data
}

async function listProjectEnvironments(
  input: DesktopIpcInput<"desktop:list-project-environments">,
) {
  const result = await requestAgentJSON<DesktopIpcOutput<"desktop:list-project-environments">>(
    `/api/projects/${encodeURIComponent(input.projectID)}/environments${queryString({
      directory: input.directory,
    })}`,
  )
  return result.data
}

async function saveProjectEnvironment(
  input: DesktopIpcInput<"desktop:save-project-environment">,
) {
  const { projectID, ...body } = input
  const result = await requestAgentJSON<DesktopIpcOutput<"desktop:save-project-environment">>(
    `/api/projects/${encodeURIComponent(projectID)}/environments/native`,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  )
  return result.data
}

async function importProjectEnvironment(
  input: DesktopIpcInput<"desktop:import-project-environment">,
) {
  const { projectID, ...body } = input
  const result = await requestAgentJSON<DesktopIpcOutput<"desktop:import-project-environment">>(
    `/api/projects/${encodeURIComponent(projectID)}/environments/import-codex`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  )
  return result.data
}

async function updateProjectEnvironmentPreference(
  input: DesktopIpcInput<"desktop:update-project-environment-preference">,
) {
  const { projectID, ...body } = input
  const result = await requestAgentJSON<DesktopIpcOutput<"desktop:update-project-environment-preference">>(
    `/api/projects/${encodeURIComponent(projectID)}/environments/preference`,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  )
  return result.data
}

async function trustProjectEnvironment(
  input: DesktopIpcInput<"desktop:trust-project-environment">,
) {
  const { projectID, key, ...body } = input
  const result = await requestAgentJSON<DesktopIpcOutput<"desktop:trust-project-environment">>(
    `/api/projects/${encodeURIComponent(projectID)}/environments/${encodeURIComponent(key)}/trust`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  )
  return result.data
}

async function revokeProjectEnvironmentTrust(
  input: DesktopIpcInput<"desktop:revoke-project-environment-trust">,
) {
  const { projectID, key, ...body } = input
  const result = await requestAgentJSON<DesktopIpcOutput<"desktop:revoke-project-environment-trust">>(
    `/api/projects/${encodeURIComponent(projectID)}/environments/${encodeURIComponent(key)}/trust`,
    {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  )
  return result.data
}

async function requestEnvironmentRun<Channel extends
  | "desktop:get-environment-run"
  | "desktop:cancel-environment-run"
  | "desktop:retry-environment-run">(
  channel: Channel,
  input: DesktopIpcInput<Channel>,
) {
  const suffix = channel === "desktop:get-environment-run"
    ? ""
    : channel === "desktop:cancel-environment-run"
      ? "/cancel"
      : "/retry"
  const result = await requestAgentJSON<DesktopIpcOutput<Channel>>(
    `/api/environment-runs/${encodeURIComponent(input.runID)}${suffix}`,
    suffix ? { method: "POST" } : undefined,
  )
  return result.data
}

async function startEnvironmentAction(
  input: DesktopIpcInput<"desktop:start-environment-action">,
) {
  const { projectID, environmentKey, actionID, ...body } = input
  const result = await requestAgentJSON<DesktopIpcOutput<"desktop:start-environment-action">>(
    `/api/projects/${encodeURIComponent(projectID)}/environments/${encodeURIComponent(environmentKey)}/actions/${encodeURIComponent(actionID)}/start`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  )
  return result.data
}

async function stopEnvironmentAction(
  input: DesktopIpcInput<"desktop:stop-environment-action">,
) {
  const { projectID, environmentKey, actionID, ...body } = input
  const result = await requestAgentJSON<DesktopIpcOutput<"desktop:stop-environment-action">>(
    `/api/projects/${encodeURIComponent(projectID)}/environments/${encodeURIComponent(environmentKey)}/actions/${encodeURIComponent(actionID)}/stop`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  )
  return result.data
}

async function restartEnvironmentSetup(
  input: DesktopIpcInput<"desktop:restart-environment-setup">,
) {
  const { projectID, environmentKey, ...body } = input
  const result = await requestAgentJSON<DesktopIpcOutput<"desktop:restart-environment-setup">>(
    `/api/projects/${encodeURIComponent(projectID)}/environments/${encodeURIComponent(environmentKey)}/setup`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  )
  return result.data
}

async function getSessionTraceExport(input: SessionTraceExportInput) {
  const sessionID = input.sessionID.trim()
  const result = await requestAgentJSON<AgentSessionTraceExport>(
    `/api/debug/sessions/${encodeURIComponent(sessionID)}/trace-export`,
  )

  return result.data
}

async function getSessionBackgroundProcesses(
  input: DesktopIpcInput<"desktop:get-session-background-processes">,
) {
  const sessionID = input.sessionID.trim()
  const result = await requestAgentJSON<AgentSessionBackgroundProcessList>(
    `/api/sessions/${encodeURIComponent(sessionID)}/background-processes`,
  )

  return result.data
}

async function getSessionPty(input: DesktopIpcInput<"desktop:get-session-pty">) {
  const sessionID = input.sessionID.trim()
  if (!sessionID) {
    throw new Error("PTY lookup requires a sessionID")
  }
  const result = await requestAgentJSON<AgentPtySessionInfo | null>(
    `/api/sessions/${encodeURIComponent(sessionID)}/pty`,
  )

  return result.data
}

async function terminateSessionBackgroundProcess(
  input: DesktopIpcInput<"desktop:terminate-session-background-process">,
) {
  const sessionID = input.sessionID.trim()
  const processID = input.processID.trim()
  const result = await requestAgentJSON<AgentSessionBackgroundProcessTerminateResult>(
    `/api/sessions/${encodeURIComponent(sessionID)}/background-processes/${encodeURIComponent(processID)}/terminate`,
    { method: "POST" },
  )

  return result.data
}

async function terminateAllSessionBackgroundProcesses(
  input: DesktopIpcInput<"desktop:terminate-all-session-background-processes">,
) {
  const sessionID = input.sessionID.trim()
  const result = await requestAgentJSON<AgentSessionBackgroundProcessesTerminateAllResult>(
    `/api/sessions/${encodeURIComponent(sessionID)}/background-processes/terminate-all`,
    { method: "POST" },
  )

  return result.data
}

async function saveSessionTraceExport(
  input: SaveSessionTraceExportInput,
  options: SaveSessionTraceExportOptions = {},
) {
  const trace = await getSessionTraceExport(input)
  const sessionID = input.sessionID.trim()
  const safeSessionID = sanitizeSessionTraceFileSegment(sessionID)
  const timestamp = formatSessionTraceTimestamp(options.now ?? new Date())
  const defaultPath = path.join(
    options.downloadsPath ?? app.getPath("downloads"),
    `anybox-trace-${safeSessionID}-${timestamp}.json`,
  )
  const showSaveDialog = options.showSaveDialog ?? ((dialogOptions: SaveDialogOptions) =>
    dialog.showSaveDialog(dialogOptions))
  const selection = await showSaveDialog({
    defaultPath,
    filters: [
      {
        name: "JSON",
        extensions: ["json"],
      },
    ],
    properties: ["createDirectory", "showOverwriteConfirmation"],
    title: "Save session trace JSON",
  })

  if (selection.canceled || !selection.filePath) {
    return { canceled: true }
  }

  const writeTraceFile = options.writeTraceFile ?? ((filePath: string, data: string, encoding: BufferEncoding) =>
    writeFile(filePath, data, encoding))
  await writeTraceFile(selection.filePath, `${JSON.stringify(trace, null, 2)}\n`, "utf8")

  return {
    canceled: false,
    path: selection.filePath,
  }
}

async function saveSessionTraceExportDirectory(
  input: SaveSessionTraceExportDirectoryInput,
  options: SaveSessionTraceExportDirectoryOptions = {},
) {
  const trace = await getSessionTraceExport(input)
  const folderName = getSessionTraceExportFolderName(input.sessionID, options.now ?? new Date())
  const showOpenDialog = options.showOpenDialog ?? ((dialogOptions: OpenDialogOptions) =>
    dialog.showOpenDialog(dialogOptions))
  const selection = await showOpenDialog({
    buttonLabel: "Export Here",
    defaultPath: options.downloadsPath ?? app.getPath("downloads"),
    properties: ["openDirectory", "createDirectory"],
    title: "Select folder for split session trace",
  })

  const selectedDirectory = selection.filePaths?.[0]
  if (selection.canceled || !selectedDirectory) {
    return { canceled: true }
  }

  const targetDirectory = path.join(selectedDirectory, folderName)
  const result = await writeSplitSessionTraceExportDirectory(trace, targetDirectory, options)

  return {
    canceled: false,
    path: targetDirectory,
    fileCount: result.fileCount,
    recordCount: result.recordCount,
  }
}

type RawArtifactCandidate = {
  sourcePath: string
  sourceRelativePath: string
  mime?: string
  kind?: string
  expectedBytes?: number
  expectedSha256?: string
}

function managedArtifactSessionSegment(sessionID: string) {
  return /^[A-Za-z0-9._-]+$/.test(sessionID) && sessionID !== "." && sessionID !== ".."
    ? sessionID
    : `tool_${createHash("sha256").update(sessionID).digest("hex").slice(0, 16)}`
}

function isStrictChildPath(parent: string, candidate: string) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate))
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

function portableTracePath(...segments: string[]) {
  return segments.join("/").replace(/\\/g, "/").replace(/\/+/g, "/")
}

async function sha256File(filePath: string) {
  const hash = createHash("sha256")
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk as Buffer)
  }
  return hash.digest("hex")
}

async function collectRawArtifactCandidates(input: {
  trace: AgentSessionTraceExport
  sessionID: string
  agentDataDir: string
}) {
  const sessionRoot = path.join(
    input.agentDataDir,
    "state",
    "sessions",
    managedArtifactSessionSegment(input.sessionID),
    "tool-results",
  )
  const candidates = new Map<string, RawArtifactCandidate>()
  const rejectedReferences = new Set<string>()

  const addCandidate = (candidatePath: string, metadata: Record<string, unknown> = {}, relative = false) => {
    const resolved = path.resolve(relative ? path.join(sessionRoot, candidatePath) : candidatePath)
    if (!isStrictChildPath(sessionRoot, resolved)) {
      rejectedReferences.add(candidatePath)
      return
    }
    const key = process.platform === "win32" ? resolved.toLowerCase() : resolved
    const existing = candidates.get(key)
    candidates.set(key, {
      sourcePath: resolved,
      sourceRelativePath: portableTracePath(path.relative(sessionRoot, resolved)),
      mime: typeof metadata.mime === "string" ? metadata.mime : existing?.mime,
      kind: typeof metadata.kind === "string" ? metadata.kind : existing?.kind,
      expectedBytes: typeof metadata.bytes === "number" ? metadata.bytes : existing?.expectedBytes,
      expectedSha256: typeof metadata.sha256 === "string" ? metadata.sha256 : existing?.expectedSha256,
    })
  }

  const visited = new WeakSet<object>()
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return
    if (visited.has(value)) return
    visited.add(value)
    if (Array.isArray(value)) {
      value.forEach(visit)
      return
    }

    const record = value as Record<string, unknown>
    const artifactLike =
      (typeof record.sha256 === "string" && typeof record.bytes === "number") ||
      record.kind === "persisted-tool-output"
    for (const [key, child] of Object.entries(record)) {
      if (typeof child === "string") {
        if (path.isAbsolute(child) && (artifactLike || isStrictChildPath(sessionRoot, child))) {
          addCandidate(child, record)
        }
        if (
          artifactLike &&
          ["path", "relativePath", "manifestRelativePath"].includes(key) &&
          !path.isAbsolute(child)
        ) {
          addCandidate(child, record, true)
        }
      } else {
        visit(child)
      }
    }
  }
  visit(input.trace.messages)
  visit(input.trace.toolCalls)

  for (const candidate of [...candidates.values()]) {
    if (path.basename(candidate.sourcePath).toLowerCase() !== "manifest.json") continue
    try {
      const manifest = JSON.parse(await readFile(candidate.sourcePath, "utf8")) as { files?: unknown }
      if (!Array.isArray(manifest.files)) continue
      for (const file of manifest.files) {
        if (!file || typeof file !== "object" || Array.isArray(file)) continue
        const record = file as Record<string, unknown>
        if (typeof record.path === "string") addCandidate(record.path, record, true)
      }
    } catch {
      // Missing or malformed manifests are reported by the copy pass below.
    }
  }

  return {
    sessionRoot,
    candidates: [...candidates.values()].sort((left, right) => left.sourceRelativePath.localeCompare(right.sourceRelativePath)),
    rejectedReferences: [...rejectedReferences].sort(),
  }
}

async function copyRawSessionArtifacts(input: {
  trace: AgentSessionTraceExport
  sessionID: string
  targetDirectory: string
  options: SaveSessionTraceExportRawDirectoryOptions
}) {
  const collected = await collectRawArtifactCandidates({
    trace: input.trace,
    sessionID: input.sessionID,
    agentDataDir: input.options.agentDataDir ?? resolveManagedAgentDataDir(),
  })
  const rawRoot = path.join(input.targetDirectory, "raw-artifacts")
  const makeDirectory = input.options.makeDirectory ?? ((directory: string, options: { recursive: true }) =>
    mkdir(directory, options))
  const copyArtifact = input.options.copyArtifactFile ?? ((source: string, destination: string) => copyFile(source, destination))
  const writeTraceFile = input.options.writeTraceFile ?? ((filePath: string, data: string, encoding: BufferEncoding) =>
    writeFile(filePath, data, encoding))
  const files: Array<Record<string, unknown>> = []
  const missingFiles: Array<{ sourceRelativePath: string; reason: string }> = []
  const rejectedReferences = new Set(collected.rejectedReferences)
  const realSessionRoot = await realpath(collected.sessionRoot).catch(() => collected.sessionRoot)

  await makeDirectory(rawRoot, { recursive: true })
  for (const candidate of collected.candidates) {
    try {
      const realSourcePath = await realpath(candidate.sourcePath)
      if (!isStrictChildPath(realSessionRoot, realSourcePath)) {
        rejectedReferences.add(candidate.sourcePath)
        continue
      }
      const sourceStat = await stat(realSourcePath)
      if (!sourceStat.isFile()) {
        missingFiles.push({ sourceRelativePath: candidate.sourceRelativePath, reason: "not-a-file" })
        continue
      }
      const destination = path.join(rawRoot, candidate.sourceRelativePath)
      if (!isStrictChildPath(rawRoot, destination)) {
        missingFiles.push({ sourceRelativePath: candidate.sourceRelativePath, reason: "invalid-destination" })
        continue
      }
      await makeDirectory(path.dirname(destination), { recursive: true })
      await copyArtifact(realSourcePath, destination)
      files.push({
        path: portableTracePath("raw-artifacts", candidate.sourceRelativePath),
        sourceRelativePath: candidate.sourceRelativePath,
        mime: candidate.mime,
        kind: candidate.kind,
        bytes: sourceStat.size,
        sha256: await sha256File(realSourcePath),
        expectedBytes: candidate.expectedBytes,
        expectedSha256: candidate.expectedSha256,
      })
    } catch (error) {
      missingFiles.push({
        sourceRelativePath: candidate.sourceRelativePath,
        reason: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const manifestPath = path.join(input.targetDirectory, "raw-artifacts-manifest.json")
  await writeTraceFile(manifestPath, `${JSON.stringify({
    schemaVersion: 2,
    exportFormat: "anybox-session-trace-raw-artifacts",
    containsSensitiveData: true,
    generatedAt: Date.now(),
    sessionID: input.sessionID,
    files,
    missingFiles,
    rejectedReferences: [...rejectedReferences].sort(),
  }, null, 2)}\n`, "utf8")

  return {
    fileCount: files.length + 1,
    copiedArtifactCount: files.length,
    missingArtifactCount: missingFiles.length,
  }
}

async function saveSessionTraceExportRawDirectory(
  input: SaveSessionTraceExportRawDirectoryInput,
  options: SaveSessionTraceExportRawDirectoryOptions = {},
) {
  const showRiskDialog = options.showRiskDialog ?? ((dialogOptions: MessageBoxOptions) =>
    dialog.showMessageBox(dialogOptions))
  const confirmation = await showRiskDialog({
    type: "warning",
    title: "Export raw session trace",
    message: "Raw tool artifacts may contain secrets or private data.",
    detail: "Only share this export with people you trust. Anybox will include original artifact files without redaction.",
    buttons: ["Cancel", "Export raw data"],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  })
  if (confirmation.response !== 1) return { canceled: true }

  const trace = await getSessionTraceExport({ sessionID: input.sessionID })
  const folderName = `${getSessionTraceExportFolderName(input.sessionID, options.now ?? new Date())}-raw`
  const showOpenDialog = options.showOpenDialog ?? ((dialogOptions: OpenDialogOptions) =>
    dialog.showOpenDialog(dialogOptions))
  const selection = await showOpenDialog({
    buttonLabel: "Export Raw Data Here",
    defaultPath: options.downloadsPath ?? app.getPath("downloads"),
    properties: ["openDirectory", "createDirectory"],
    title: "Select folder for raw split session trace",
  })
  const selectedDirectory = selection.filePaths?.[0]
  if (selection.canceled || !selectedDirectory) return { canceled: true }

  const targetDirectory = path.join(selectedDirectory, folderName)
  const traceResult = await writeSplitSessionTraceExportDirectory(trace, targetDirectory, options)
  const artifactResult = await copyRawSessionArtifacts({
    trace,
    sessionID: input.sessionID.trim(),
    targetDirectory,
    options,
  })
  return {
    canceled: false,
    path: targetDirectory,
    fileCount: traceResult.fileCount + artifactResult.fileCount,
    recordCount: traceResult.recordCount,
  }
}

async function saveSessionTraceExportToProject(
  input: SaveSessionTraceExportToProjectInput,
  options: SaveSessionTraceExportDirectoryOptions = {},
) {
  const exportRoot = getProjectSessionTraceExportRoot(input, options)
  const trace = await getSessionTraceExport({ sessionID: input.sessionID })
  const folderName = getSessionTraceExportFolderName(input.sessionID, options.now ?? new Date())
  const targetDirectory = path.join(exportRoot, folderName)
  const result = await writeSplitSessionTraceExportDirectory(trace, targetDirectory, options)

  return {
    canceled: false,
    path: targetDirectory,
    fileCount: result.fileCount,
    recordCount: result.recordCount,
  }
}

type SessionStreamSubscription = {
  lastEventID?: string
  disposed: boolean
  abortController: AbortController | null
  restartTimer: ReturnType<typeof setTimeout> | null
  start(): Promise<void>
  dispose(): void
}

type ActiveAgentSessionRequest = {
  backendSessionID: string
  backendExecutionID?: string
  cancelRequested: boolean
  clientTurnID: string
  controller: AbortController
}

type AgentSessionRequestAbortInput = {
  backendSessionID: string
  clientTurnID?: string
  webContentsID: number
}

type AgentSessionBackendCancelResult = {
  sessionID: string
  cancelled: boolean
  activeCancelled?: boolean
  queuedCancelled?: number
}

type DisposableSessionStreamSubscription = {
  dispose(): void
}

function sessionStreamSubscriptionKey(webContentsID: number, sessionID: string) {
  return `${webContentsID}:${sessionID}`
}

function isSessionStreamSubscriptionKeyForWebContents(key: string, webContentsID: number) {
  return key.startsWith(`${webContentsID}:`)
}

function disposeSessionStreamSubscriptionsForWebContents<TSubscription extends DisposableSessionStreamSubscription>(
  subscriptions: Map<string, TSubscription>,
  webContentsID: number,
) {
  let disposedCount = 0
  for (const [key, streamSubscription] of [...subscriptions.entries()]) {
    if (!isSessionStreamSubscriptionKeyForWebContents(key, webContentsID)) continue
    streamSubscription.dispose()
    subscriptions.delete(key)
    disposedCount += 1
  }
  return disposedCount
}

function agentSessionRequestKey(webContentsID: number, clientTurnID: string) {
  return `${webContentsID}:${clientTurnID}`
}

function abortActiveAgentSessionRequestsInMap(
  activeAgentSessionRequests: Map<string, ActiveAgentSessionRequest>,
  input: AgentSessionRequestAbortInput,
) {
  const requests: ActiveAgentSessionRequest[] = []
  const clientTurnID = input.clientTurnID?.trim()

  if (clientTurnID) {
    const request = activeAgentSessionRequests.get(agentSessionRequestKey(input.webContentsID, clientTurnID))
    if (request && request.backendSessionID === input.backendSessionID) {
      requests.push(request)
    }
  } else {
    const prefix = `${input.webContentsID}:`
    for (const [key, request] of activeAgentSessionRequests.entries()) {
      if (!key.startsWith(prefix)) continue
      if (request.backendSessionID !== input.backendSessionID) continue
      requests.push(request)
    }
  }

  for (const request of requests) {
    request.cancelRequested = true
    request.controller.abort()
  }

  return requests.length
}

async function interruptAgentSessionBackendFirst(input: {
  backendSessionID: string
  clientTurnID?: string
  backendExecutionID?: string
  webContentsID: number
  requestBackendCancel: (
    backendSessionID: string,
    executionID?: string,
  ) => Promise<AgentSessionBackendCancelResult>
}): Promise<DesktopIpcOutput<"desktop:agent-session-interrupt">> {
  const backendSessionID = input.backendSessionID.trim()
  const clientTurnID = input.clientTurnID?.trim() || undefined
  const backendExecutionID = input.backendExecutionID?.trim() || undefined

  try {
    const result = backendExecutionID
      ? await input.requestBackendCancel(backendSessionID, backendExecutionID)
      : await input.requestBackendCancel(backendSessionID)

    return {
      backendSessionID,
      ...(clientTurnID ? { clientTurnID } : {}),
      localRequestsAborted: 0,
      backendCancelled: result.cancelled,
      activeCancelled: result.activeCancelled,
      queuedCancelled: result.queuedCancelled,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    return {
      backendSessionID,
      ...(clientTurnID ? { clientTurnID } : {}),
      localRequestsAborted: 0,
      backendCancelled: false,
      backendCancelError: message,
    }
  }
}

function isAbortError(error: unknown) {
  return typeof error === "object" && error !== null && "name" in error && error.name === "AbortError"
}

function queryString(params: Record<string, string | undefined | null>) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value == null) continue
    search.set(key, value)
  }
  const value = search.toString()
  return value ? `?${value}` : ""
}

async function requestRemoteWorkspaceSearch(directory: string, query: string) {
  const result = await requestAgentJSON<AgentWorkspaceFileSearchResult[]>(
    `/api/workspace-files/search${queryString({ directory, query })}`,
  )
  return result.data
}

async function requestRemoteWorkspaceDirectory(directory: string, directoryPath?: string | null) {
  const result = await requestAgentJSON<AgentWorkspaceDirectoryEntry[]>(
    `/api/workspace-files/directory${queryString({ directory, path: directoryPath ?? undefined })}`,
  )
  return result.data
}

async function requestRemoteWorkspaceFile(directory: string, filePath: string) {
  const result = await requestAgentJSON<AgentWorkspaceFileDocument>(
    `/api/workspace-files/file${queryString({ directory, path: filePath })}`,
  )
  return result.data
}

export interface IpcHandlerOptions {
  mainDir?: string
  onLocaleChanged?: (locale: AppLocale) => void
  rendererEntryUrl?: string
  workbenchWindowManager?: WorkbenchWindowManager
}

interface AutomationEventBridge {
  readonly lastEventID: string | undefined
  readonly disposed: boolean
  start(): void
  dispose(): void
}

function createAutomationEventBridge(): AutomationEventBridge {
  let lastEventID: string | undefined
  let disposed = false
  let abortController: AbortController | null = null
  let restartTimer: ReturnType<typeof setTimeout> | null = null

  const sendToAllWindows = (event: AgentAutomationIPCEvent) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (window.isDestroyed()) continue
      sendDesktopIpcEvent(window.webContents, AUTOMATION_EVENT_CHANNEL, event)
    }
  }

  const scheduleRestart = () => {
    if (disposed || restartTimer) return
    restartTimer = setTimeout(() => {
      restartTimer = null
      void connect()
    }, 500)
  }

  const connect = async () => {
    if (disposed) return

    abortController?.abort()
    abortController = new AbortController()

    try {
      const response = await fetch(resolveAgentURL("/api/automation-events/stream"), {
        headers: lastEventID
          ? {
              "Last-Event-ID": lastEventID,
            }
          : undefined,
        signal: abortController.signal,
      })

      if (!response.ok) {
        const envelope = (await response.json().catch(() => null)) as AgentEnvelope<unknown> | null
        throw new Error(envelope?.error?.message || `Automation event stream failed (${response.status})`)
      }

      await readAgentSSEStream(response, (item) => {
        if (disposed) return
        if (item.id) lastEventID = item.id
        sendToAllWindows({
          id: item.id,
          event: item.event,
          data: item.data,
          receivedAt: Date.now(),
        })
      })

      if (!disposed) scheduleRestart()
    } catch (error) {
      if (disposed || isAbortError(error)) return
      safeWarn("[desktop] automation event stream failed:", error)
      scheduleRestart()
    }
  }

  return {
    get lastEventID() {
      return lastEventID
    },
    get disposed() {
      return disposed
    },
    start() {
      void connect()
    },
    dispose() {
      disposed = true
      if (restartTimer) {
        clearTimeout(restartTimer)
        restartTimer = null
      }
      abortController?.abort()
      abortController = null
    },
  }
}

function createEnvironmentEventBridge(): AutomationEventBridge {
  let lastEventID: string | undefined
  let disposed = false
  let abortController: AbortController | null = null
  let restartTimer: ReturnType<typeof setTimeout> | null = null

  const sendToAllWindows = (event: AgentEnvironmentIPCEvent) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (window.isDestroyed()) continue
      sendDesktopIpcEvent(window.webContents, ENVIRONMENT_EVENT_CHANNEL, event)
    }
  }

  const scheduleRestart = () => {
    if (disposed || restartTimer) return
    restartTimer = setTimeout(() => {
      restartTimer = null
      void connect()
    }, 500)
  }

  const connect = async () => {
    if (disposed) return

    abortController?.abort()
    abortController = new AbortController()

    try {
      const response = await fetch(resolveAgentURL("/api/environment-events/stream"), {
        headers: lastEventID ? { "Last-Event-ID": lastEventID } : undefined,
        signal: abortController.signal,
      })

      if (!response.ok) {
        const envelope = (await response.json().catch(() => null)) as AgentEnvelope<unknown> | null
        throw new Error(envelope?.error?.message || `Environment event stream failed (${response.status})`)
      }

      await readAgentSSEStream(response, (item) => {
        if (disposed) return
        if (item.id) lastEventID = item.id
        sendToAllWindows({
          id: item.id,
          event: item.event,
          data: item.data,
          receivedAt: Date.now(),
        })
      })

      if (!disposed) scheduleRestart()
    } catch (error) {
      if (disposed || isAbortError(error)) return
      safeWarn("[desktop] environment event stream failed:", error)
      scheduleRestart()
    }
  }

  return {
    get lastEventID() {
      return lastEventID
    },
    get disposed() {
      return disposed
    },
    start() {
      void connect()
    },
    dispose() {
      disposed = true
      if (restartTimer) {
        clearTimeout(restartTimer)
        restartTimer = null
      }
      abortController?.abort()
      abortController = null
    },
  }
}

async function downloadSkillRegistrySkill(
  input: DesktopIpcInput<"desktop:download-skill-registry-skill">,
): Promise<DesktopIpcOutput<"desktop:download-skill-registry-skill">> {
  const result = await requestAgentJSON<DownloadedRegistrySkill>("/api/skill-registry/download", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  })
  return result.data
}

async function setDownloadedRegistrySkillEnabled(
  input: DesktopIpcInput<"desktop:set-downloaded-registry-skill-enabled">,
): Promise<DesktopIpcOutput<"desktop:set-downloaded-registry-skill-enabled">> {
  const result = await requestAgentJSON<DesktopRegistrySkillMutationResult>(
    `/api/skill-registry/downloads/${encodeURIComponent(input.id)}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: input.enabled }),
    },
  )
  return result.data
}

async function forkDownloadedRegistrySkill(
  input: DesktopIpcInput<"desktop:fork-downloaded-registry-skill">,
): Promise<DesktopIpcOutput<"desktop:fork-downloaded-registry-skill">> {
  const result = await requestAgentJSON<DesktopRegistrySkillForkResult>(
    `/api/skill-registry/downloads/${encodeURIComponent(input.id)}/fork`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: input.name }),
    },
  )
  return result.data
}

async function previewDownloadedRegistrySkillUpdate(
  input: DesktopIpcInput<"desktop:preview-downloaded-registry-skill-update">,
): Promise<DesktopIpcOutput<"desktop:preview-downloaded-registry-skill-update">> {
  const result = await requestAgentJSON<DesktopRegistrySkillUpdatePreview>(
    `/api/skill-registry/downloads/${encodeURIComponent(input.id)}/update-preview`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ version: input.version }),
    },
  )
  return result.data
}

export function registerIpcHandlers(menus: ApplicationMenus, options: IpcHandlerOptions = {}) {
  const runtimeCapabilities = getDesktopRuntimeCapabilities()
  const platformAdapter = createPlatformAdapter({
    platform: process.platform,
    openPath: shell.openPath,
  })
  const ptyProxyManager = new PtyProxyManager()
  const workspaceWatchManager = new WorkspaceWatchManager()
  const globalSkillsWatchManager = new WorkspaceWatchManager()
  const semanticTokenInspectorManager = new SemanticTokenInspectorSessionManager((target, event) => {
    sendDesktopIpcEvent(target, DESKTOP_SEMANTIC_TOKEN_INSPECTOR_EVENT_CHANNEL, event)
  }, {
    packageRoot: app.getAppPath(),
    packaged: app.isPackaged,
  })
  const externalEditorMenuResolvedIconCache = new Map<string, NativeImage | undefined>()
  const externalEditorMenuIconLoadCache = new Map<string, Promise<NativeImage | undefined>>()
  let cachedAvailableExternalEditors: ReturnType<typeof listAvailableExternalEditors> | null = null
  let lastAppearanceRuntimeState = createDefaultAppearanceRuntimeState()
  let packagedAppearanceMigration:
    | ReturnType<typeof migratePackagedAppearanceState>
    | null = null

  function requireDevelopmentFeatures(feature: string) {
    if (runtimeCapabilities.developmentFeaturesEnabled) return
    throw new Error(`${feature} is unavailable because desktop development features are disabled.`)
  }

  function requireAppearanceAuthoring(feature: string) {
    if (runtimeCapabilities.appearanceAuthoringEnabled) return
    throw new Error(`${feature} is unavailable because appearance authoring is disabled.`)
  }

  handleDesktopIpc(
    "desktop:start-semantic-token-inspector",
    (event) => {
      if (!runtimeCapabilities.developmentFeaturesEnabled) {
        return {
          status: "blocked" as const,
          reason: app.isPackaged ? "packaged" as const : "development-disabled" as const,
          message: app.isPackaged
            ? "Semantic Token Inspector is unavailable in packaged builds."
            : "Semantic Token Inspector requires desktop development features.",
        }
      }
      return semanticTokenInspectorManager.start(event.sender)
    },
  )
  handleDesktopIpc(
    "desktop:inspect-semantic-token-at-point",
    (event, input) => {
      requireDevelopmentFeatures("Semantic Token Inspector")
      return semanticTokenInspectorManager.inspect(event.sender, input)
    },
  )
  handleDesktopIpc(
    "desktop:stop-semantic-token-inspector",
    (event) => semanticTokenInspectorManager.stop(event.sender),
  )
  handleDesktopIpc(
    "desktop:prepare-semantic-token-authoring-commit",
    (event, input) => {
      requireAppearanceAuthoring("Semantic Token authoring")
      return semanticTokenInspectorManager.prepareAuthoringCommit(event.sender, input)
    },
  )
  handleDesktopIpc(
    "desktop:commit-semantic-token-authoring-commit",
    (event, input) => {
      requireAppearanceAuthoring("Semantic Token authoring")
      return semanticTokenInspectorManager.commitAuthoringCommit(event.sender, input)
    },
  )
  handleDesktopIpc(
    "desktop:discard-semantic-token-authoring-commit",
    (event, input) => {
      requireAppearanceAuthoring("Semantic Token authoring")
      return semanticTokenInspectorManager.discardAuthoringCommit(event.sender, input)
    },
  )

  function broadcastAppearanceRuntimeState(state: AppearanceRuntimeState, exceptSender?: WebContents) {
    const normalizedState = normalizeAppearanceRuntimeState(state, lastAppearanceRuntimeState)
    lastAppearanceRuntimeState = normalizedState

    for (const window of BrowserWindow.getAllWindows()) {
      const webContents = window.webContents
      if (exceptSender && webContents.id === exceptSender.id) continue
      sendDesktopIpcEvent(webContents, APPEARANCE_STATE_EVENT_CHANNEL, normalizedState)
    }
  }

  if (!appUpdateStateBridgeRegistered) {
    appUpdateStateBridgeRegistered = true
    onAppUpdateStateChanged((state) => {
      for (const window of BrowserWindow.getAllWindows()) {
        sendDesktopIpcEvent(window.webContents, DESKTOP_APP_UPDATE_STATE_EVENT_CHANNEL, state)
      }
    })
  }

  if (!automationEventBridgeRegistered) {
    automationEventBridgeRegistered = true
    createAutomationEventBridge().start()
  }

  async function loadConsumerAppearanceState() {
    try {
      if (app.isPackaged) {
        packagedAppearanceMigration ??= migratePackagedAppearanceState().catch((error) => {
          packagedAppearanceMigration = null
          throw error
        })
        await packagedAppearanceMigration
      }

      const [configSnapshot, themeSnapshot] = await Promise.all([
        readAppearanceConfigSnapshot(),
        readAppearanceThemesSnapshot(),
      ])
      const activeTheme = resolveConsumerAppearanceTheme(themeSnapshot)
      return {
        activeTheme,
        configSnapshot: {
          ...configSnapshot,
          document: constrainConsumerAppearanceDocument(
            configSnapshot.document,
            activeTheme,
          ),
        },
        themeSnapshot: createConsumerAppearanceThemeSnapshot(themeSnapshot),
        migrationFailed: false,
      }
    } catch (error) {
      safeWarn("[desktop] packaged appearance migration failed; using safe built-in defaults", error)
      const safeState = createSafeConsumerAppearanceState()
      return {
        activeTheme: resolveConsumerAppearanceTheme(safeState.themeSnapshot),
        ...safeState,
        migrationFailed: true,
      }
    }
  }

  if (!environmentEventBridgeRegistered) {
    environmentEventBridgeRegistered = true
    createEnvironmentEventBridge().start()
  }

  function getCachedAvailableExternalEditors() {
    if (!cachedAvailableExternalEditors) {
      cachedAvailableExternalEditors = listAvailableExternalEditors()
    }

    return cachedAvailableExternalEditors
  }

  function normalizeExternalEditorIconCacheKey(iconPath: string) {
    const cacheKey = iconPath.trim().toLowerCase()
    return cacheKey || null
  }

  function loadExternalEditorMenuIcon(iconPath: string) {
    const cacheKey = normalizeExternalEditorIconCacheKey(iconPath)
    if (!cacheKey) return Promise.resolve(undefined)

    if (externalEditorMenuResolvedIconCache.has(cacheKey)) {
      return Promise.resolve(externalEditorMenuResolvedIconCache.get(cacheKey))
    }

    const cached = externalEditorMenuIconLoadCache.get(cacheKey)
    if (cached) return cached

    const nextIconLoad = app
      .getFileIcon(iconPath)
      .then((icon) => {
        const resolvedIcon = icon.isEmpty() ? undefined : icon
        externalEditorMenuResolvedIconCache.set(cacheKey, resolvedIcon)
        return resolvedIcon
      })
      .catch(() => {
        externalEditorMenuResolvedIconCache.set(cacheKey, undefined)
        return undefined
      })
      .finally(() => {
        externalEditorMenuIconLoadCache.delete(cacheKey)
      })
    externalEditorMenuIconLoadCache.set(cacheKey, nextIconLoad)
    return nextIconLoad
  }

  function primeExternalEditorMenuIcon(iconPath: string) {
    void loadExternalEditorMenuIcon(iconPath)
  }

  function peekExternalEditorMenuIcon(iconPath: string) {
    const cacheKey = normalizeExternalEditorIconCacheKey(iconPath)
    if (!cacheKey) return undefined

    return externalEditorMenuResolvedIconCache.get(cacheKey)
  }

  function peekExternalEditorMenuIconDataUrl(iconPath: string) {
    const icon = peekExternalEditorMenuIcon(iconPath)
    return icon ? icon.toDataURL() : undefined
  }
  const sessionStreamSubscriptions = new Map<string, SessionStreamSubscription>()
  const sessionStreamCleanupTargets = new Set<number>()
  const activeAgentSessionRequests = new Map<string, ActiveAgentSessionRequest>()

  function getSessionStreamSubscription(
    webContentsID: number,
    sessionID: string,
  ) {
    return sessionStreamSubscriptions.get(sessionStreamSubscriptionKey(webContentsID, sessionID))
  }

  function removeSessionStreamSubscription(
    webContentsID: number,
    sessionID: string,
  ) {
    const key = sessionStreamSubscriptionKey(webContentsID, sessionID)
    const subscription = sessionStreamSubscriptions.get(key)
    if (!subscription) return false
    subscription.dispose()
    sessionStreamSubscriptions.delete(key)
    return true
  }

  function removeActiveAgentSessionRequest(webContentsID: number, clientTurnID: string, request: ActiveAgentSessionRequest) {
    const key = agentSessionRequestKey(webContentsID, clientTurnID)
    if (activeAgentSessionRequests.get(key) === request) {
      activeAgentSessionRequests.delete(key)
    }
  }

  const agentCompletionNotifications = new AgentCompletionNotificationManager({
    onNotificationClick: ({ sessionID, target, turnID }) => {
      if (!sessionID || target.isDestroyed()) return
      sendDesktopIpcEvent(target, AGENT_SESSION_EVENT_CHANNEL, {
        kind: "focus-session",
        backendSessionID: sessionID,
        turnID,
        receivedAt: Date.now(),
      } satisfies AgentSessionBridgeIPCEvent)
    },
    resolveSessionTitle: async (sessionID) => {
      const result = await requestAgentJSON<AgentSessionInfo>(`/api/sessions/${encodeURIComponent(sessionID)}`)
      return result.data.title
    },
  })

  function createSessionStreamSubscription(
    target: Electron.WebContents,
    sessionID: string,
    options: {
      uiSessionID?: string
    },
  ): SessionStreamSubscription {
    let lastEventID: string | undefined
    let disposed = false
    let abortController: AbortController | null = null
    let restartTimer: ReturnType<typeof setTimeout> | null = null

    const sendUnifiedSubscriptionState = (
      state: Extract<AgentSessionBridgeIPCEvent, { kind: "subscription-state" }>["state"],
      message?: string,
    ) => {
      if (target.isDestroyed()) return
      sendDesktopIpcEvent(target, AGENT_SESSION_EVENT_CHANNEL, {
        kind: "subscription-state",
        backendSessionID: sessionID,
        uiSessionID: options.uiSessionID,
        state,
        message,
        lastEventID,
        receivedAt: Date.now(),
      } satisfies AgentSessionBridgeIPCEvent)
    }

    const scheduleRestart = () => {
      if (disposed || restartTimer || target.isDestroyed()) return
      sendUnifiedSubscriptionState("reconnecting")
      restartTimer = setTimeout(() => {
        restartTimer = null
        void start()
      }, 500)
    }

    const dispose = () => {
      disposed = true
      sendUnifiedSubscriptionState("closed")
      if (restartTimer) {
        clearTimeout(restartTimer)
        restartTimer = null
      }
      abortController?.abort()
      abortController = null
    }

    const start = async () => {
      if (disposed || target.isDestroyed()) return

      abortController?.abort()
      abortController = new AbortController()
      sendUnifiedSubscriptionState("connecting")

      try {
        const response = await fetch(resolveAgentURL(`/api/sessions/${encodeURIComponent(sessionID)}/events/stream`), {
          headers: lastEventID
            ? {
                "Last-Event-ID": lastEventID,
              }
            : undefined,
          signal: abortController.signal,
        })

        if (!response.ok) {
          const envelope = (await response.json().catch(() => null)) as AgentEnvelope<unknown> | null
          throw new Error(envelope?.error?.message || `Session stream failed (${response.status})`)
        }

        sendUnifiedSubscriptionState("connected")

        await readAgentSSEStream(response, (item) => {
          if (disposed || target.isDestroyed()) return
          if (item.event === "resync-required") {
            // The agent epoch changed or the in-memory replay window expired.
            // Reconnects after this point must start from canonical history.
            lastEventID = undefined
          }
          if (item.id) {
            lastEventID = item.id
          }

          void agentCompletionNotifications.handleSessionStreamEvent({
            data: item.data,
            id: item.id,
            event: item.event,
            target,
          })

          sendDesktopIpcEvent(target, AGENT_SESSION_EVENT_CHANNEL, {
            kind: "stream",
            source: "subscription",
            backendSessionID: sessionID,
            uiSessionID: options.uiSessionID,
            id: item.id,
            event: item.event,
            data: item.data,
            receivedAt: Date.now(),
          } satisfies AgentSessionBridgeIPCEvent)
        })

        if (!disposed) {
          scheduleRestart()
        }
      } catch (error) {
        const aborted = error instanceof Error && error.name === "AbortError"
        if (disposed || aborted) return

        const message = error instanceof Error ? error.message : String(error)
        sendUnifiedSubscriptionState("error", message)
        sendDesktopIpcEvent(target, AGENT_SESSION_EVENT_CHANNEL, {
          kind: "stream",
          source: "subscription",
          backendSessionID: sessionID,
          uiSessionID: options.uiSessionID,
          event: "error",
          data: {
            sessionID,
            message,
          },
          receivedAt: Date.now(),
        } satisfies AgentSessionBridgeIPCEvent)
        scheduleRestart()
      }
    }

    return {
      get lastEventID() {
        return lastEventID
      },
      get disposed() {
        return disposed
      },
      get abortController() {
        return abortController
      },
      get restartTimer() {
        return restartTimer
      },
      start,
      dispose,
    }
  }

  handleDesktopIpc("desktop:get-info", () => ({
    platform: process.platform,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  }))

  handleDesktopIpc("desktop:get-runtime-capabilities", () => runtimeCapabilities)

  handleDesktopIpc("desktop:get-app-update-settings", async () => getAppUpdateSettingsSnapshot())

  handleDesktopIpc("desktop:get-app-update-state", async () => getAppUpdateStateSnapshot())

  handleDesktopIpc("desktop:set-automatic-updates-enabled", async (_event, input: { enabled: boolean }) =>
    setAutomaticAppUpdatesEnabled(input.enabled),
  )

  handleDesktopIpc("desktop:check-for-app-updates", async () => checkForAppUpdates({ manual: true }))

  handleDesktopIpc("desktop:install-app-update", async () => installDownloadedAppUpdate())

  handleDesktopIpc("desktop:get-running-session-status", async () => getRunningSessionStatus())

  handleDesktopIpc("desktop:get-storage-paths", async () => {
    const appData = app.getPath("userData")
    const agentRoot = resolveManagedAgentDataDir()
    const paths = {
      appData,
      agentRoot,
      agentData: path.join(agentRoot, "data"),
      agentCache: path.join(agentRoot, "cache"),
      installedPlugins: path.join(agentRoot, "data", "plugins", "installed"),
      pluginRegistryCache: path.join(agentRoot, "data", "plugins", "registry-cache"),
      pluginInstallTemp: path.join(agentRoot, "cache", "plugin-installs"),
    }

    await Promise.all(Object.values(paths).map((directory) => mkdir(directory, { recursive: true })))

    return DesktopIpcSchemas.getStoragePaths.output.parse(paths)
  })

  handleDesktopIpc("desktop:get-storage-usage", async () => {
    const result = await requestAgentJSON<DesktopStorageUsageSnapshot>("/api/storage/usage")
    return DesktopIpcSchemas.getStorageUsage.output.parse(result.data)
  })

  handleDesktopIpc("desktop:get-window-state", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)

    return {
      isMaximized: win ? isWindowMaximized(win) : false,
    }
  })

  handleDesktopIpc("desktop:report-renderer-error", (event, input) => {
    const report = normalizeRendererErrorReport(input)
    const reportWithSender = {
      ...report,
      senderURL: event.sender.getURL(),
      webContentsID: event.sender.id,
    }
    safeError("[desktop][renderer-error]", reportWithSender)
    void appendRendererErrorLog(reportWithSender).catch((error) => {
      safeWarn("[desktop][renderer-error] failed to write renderer error log", error)
    })

    return { ok: true }
  })

  handleDesktopIpc("desktop:report-renderer-memory-diagnostics", (event, input) => {
    const report = normalizeRendererMemoryDiagnostics(input, event)
    const webContentsID = event.sender.id
    setRendererMemoryDiagnosticsRecord(report)
    if (!rendererMemoryDiagnosticsCleanupTargets.has(webContentsID)) {
      rendererMemoryDiagnosticsCleanupTargets.add(webContentsID)
      event.sender.once("destroyed", () => {
        rendererMemoryDiagnosticsCleanupTargets.delete(webContentsID)
        deleteRendererMemoryDiagnosticsRecord(webContentsID)
      })
    }

    return { ok: true }
  })

  handleDesktopIpc("desktop:get-renderer-memory-diagnostics", () => ({
    records: listRendererMemoryDiagnosticsRecords(),
  }))

  handleDesktopIpc("desktop:get-workbench-window-context", (event) => {
    if (!options.workbenchWindowManager) {
      throw new Error("Workbench window manager is unavailable.")
    }
    return options.workbenchWindowManager.getWindowContext(event.sender)
  })

  handleDesktopIpc("desktop:workbench-publish-state-snapshot", (_event, input) => {
    if (!options.workbenchWindowManager) {
      throw new Error("Workbench window manager is unavailable.")
    }
    return options.workbenchWindowManager.publishStateSnapshot(input)
  })

  handleDesktopIpc("desktop:workbench-detach-session-panel", (_event, input) => {
    if (!options.workbenchWindowManager) {
      throw new Error("Workbench window manager is unavailable.")
    }
    return options.workbenchWindowManager.detachSessionPanel(input)
  })

  handleDesktopIpc("desktop:workbench-window-ready", (_event, input) => {
    if (!options.workbenchWindowManager) {
      throw new Error("Workbench window manager is unavailable.")
    }
    return options.workbenchWindowManager.markWindowReady(input)
  })

  handleDesktopIpc("desktop:workbench-panel-mounted", (_event, input) => {
    if (!options.workbenchWindowManager) {
      throw new Error("Workbench window manager is unavailable.")
    }
    return options.workbenchWindowManager.markPanelMounted(input)
  })

  handleDesktopIpc("desktop:workbench-dock-session-panel", (_event, input) => {
    if (!options.workbenchWindowManager) {
      throw new Error("Workbench window manager is unavailable.")
    }
    return options.workbenchWindowManager.dockSessionPanel(input)
  })

  handleDesktopIpc("desktop:workbench-move-session-panel", (_event, input) => {
    if (!options.workbenchWindowManager) {
      throw new Error("Workbench window manager is unavailable.")
    }
    return options.workbenchWindowManager.moveSessionPanel(input)
  })

  handleDesktopIpc("desktop:workbench-focus-session-panel", (_event, input) => {
    if (!options.workbenchWindowManager) {
      throw new Error("Workbench window manager is unavailable.")
    }
    return options.workbenchWindowManager.focusSessionPanel(input)
  })

  handleDesktopIpc("desktop:workbench-begin-panel-drag", (_event, input) => {
    if (!options.workbenchWindowManager) {
      throw new Error("Workbench window manager is unavailable.")
    }
    return options.workbenchWindowManager.beginPanelDrag(input)
  })

  handleDesktopIpc("desktop:workbench-end-panel-drag", (_event, input) => {
    if (!options.workbenchWindowManager) {
      throw new Error("Workbench window manager is unavailable.")
    }
    return options.workbenchWindowManager.endPanelDrag(input)
  })

  handleDesktopIpc("desktop:workbench-get-panel-drag", (_event, input) => {
    if (!options.workbenchWindowManager) {
      throw new Error("Workbench window manager is unavailable.")
    }
    return options.workbenchWindowManager.getPanelDrag(input)
  })

  handleDesktopIpc("desktop:get-appearance-config", async () => {
    if (runtimeCapabilities.appearanceAuthoringEnabled) {
      const snapshot = await readAppearanceConfigSnapshot()
      lastAppearanceRuntimeState = normalizeAppearanceRuntimeState({
        ...lastAppearanceRuntimeState,
        document: snapshot.document,
      }, lastAppearanceRuntimeState)
      return snapshot
    }

    const state = await loadConsumerAppearanceState()
    lastAppearanceRuntimeState = constrainConsumerAppearanceRuntimeState({
      ...lastAppearanceRuntimeState,
      document: state.configSnapshot.document,
    }, state.activeTheme)
    return state.configSnapshot
  })

  handleDesktopIpc("desktop:save-appearance-config", async (event, input: { document: AppearanceConfigDocument }) => {
    const consumerState = runtimeCapabilities.appearanceAuthoringEnabled
      ? null
      : await loadConsumerAppearanceState()
    const document = consumerState
      ? constrainConsumerAppearanceDocument(input.document, consumerState.activeTheme)
      : input.document
    if (consumerState?.migrationFailed) {
      throw new Error("Appearance settings could not be saved after a failed packaged-state migration.")
    }
    const snapshot = await writeAppearanceConfigSnapshot(document)
    const runtimeState = consumerState
      ? constrainConsumerAppearanceRuntimeState({
          ...lastAppearanceRuntimeState,
          document: snapshot.document,
        }, consumerState.activeTheme)
      : {
          ...lastAppearanceRuntimeState,
          document: snapshot.document,
        }
    broadcastAppearanceRuntimeState(runtimeState, event.sender)
    return snapshot
  })

  handleDesktopIpc("desktop:publish-appearance-state", async (event, input: AppearanceRuntimeState) => {
    if (runtimeCapabilities.appearanceAuthoringEnabled) {
      broadcastAppearanceRuntimeState(input, event.sender)
      return
    }

    const state = await loadConsumerAppearanceState()
    broadcastAppearanceRuntimeState(
      constrainConsumerAppearanceRuntimeState(input, state.activeTheme),
      event.sender,
    )
  })

  handleDesktopIpc("desktop:get-appearance-themes", async () => {
    if (runtimeCapabilities.appearanceAuthoringEnabled) {
      return readAppearanceThemesSnapshot()
    }
    return (await loadConsumerAppearanceState()).themeSnapshot
  })

  handleDesktopIpc("desktop:save-appearance-theme", async (_event, input) => {
    requireAppearanceAuthoring("Saving custom themes")
    return saveAppearanceTheme(input.theme)
  })

  handleDesktopIpc("desktop:delete-appearance-theme", async (_event, input) => {
    requireAppearanceAuthoring("Deleting custom themes")
    return deleteAppearanceTheme(input.themeID)
  })

  handleDesktopIpc("desktop:set-active-appearance-theme", async (_event, input) => {
    if (!runtimeCapabilities.appearanceAuthoringEnabled) {
      const consumerState = await loadConsumerAppearanceState()
      if (consumerState.migrationFailed) {
        throw new Error("The active theme could not be changed after a failed packaged-state migration.")
      }
      assertConsumerAppearanceThemeID(input.themeID)
    }
    const snapshot = await setActiveAppearanceTheme(input.themeID)
    return runtimeCapabilities.appearanceAuthoringEnabled
      ? snapshot
      : createConsumerAppearanceThemeSnapshot(snapshot)
  })

  handleDesktopIpc("desktop:duplicate-appearance-theme", async (_event, input) => {
    requireAppearanceAuthoring("Duplicating themes")
    return duplicateAppearanceTheme(input)
  })

  handleDesktopIpc("desktop:rename-appearance-theme", async (_event, input) => {
    requireAppearanceAuthoring("Renaming themes")
    return renameAppearanceTheme(input)
  })

  handleDesktopIpc("desktop:get-locale-config", async () => readLocaleConfigSnapshot())

  handleDesktopIpc("desktop:save-locale-config", async (_event, input: { document: LocaleConfigDocument }) => {
    const snapshot = await writeLocaleConfigSnapshot(input.document)
    options.onLocaleChanged?.(snapshot.document.locale)
    return snapshot
  })

  handleDesktopIpc("desktop:window-action", (event, action: WindowAction) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return

    if (action === "minimize") win.minimize()
    if (action === "toggle-maximize") {
      if (isWindowMaximized(win)) {
        win.unmaximize()
      } else {
        win.maximize()
      }

      sendWindowState(win)
    }
    if (action === "close") win.close()
  })

  handleDesktopIpc("desktop:open-external-url", async (_event, input: { url: string }) => {
    const url = input.url.trim()
    if (!url) {
      throw new Error("A URL is required.")
    }

    await shell.openExternal(url)

    return {
      ok: true as const,
      url,
    }
  })

  handleDesktopIpc("desktop:optimize-storage", async () => {
    const result = await requestAgentJSON<DesktopStorageOptimizeResult>("/api/storage/optimize", {
      method: "POST",
    })
    return DesktopIpcSchemas.optimizeStorage.output.parse(result.data)
  })

  handleDesktopIpc("desktop:open-path", async (_event, input: { targetPath: string }) => {
    const parsedInput = DesktopIpcSchemas.openPath.input.parse(input)
    const targetPath = parsedInput.targetPath.trim()
    if (!targetPath) {
      throw new Error("A path is required.")
    }

    await platformAdapter.openPath(targetPath)

    return DesktopIpcSchemas.openPath.output.parse({
      ok: true as const,
      targetPath,
    })
  })

  handleDesktopIpc("desktop:open-cinema-project", async (_event, input: { projectID: string }) => {
    const parsedInput = DesktopIpcSchemas.openCinemaProject.input.parse(input)
    const projectID = parsedInput.projectID.trim()
    if (!projectID) {
      throw new Error("A project ID is required.")
    }

    const result = await requestAgentJSON<{ url: string }>(
      `/api/cinema/projects/${encodeURIComponent(projectID)}/open-link`,
      { method: "POST" },
    )

    return DesktopIpcSchemas.openCinemaProject.output.parse({
      ok: true as const,
      projectID,
      url: result.data.url,
    })
  })

  handleDesktopIpc("desktop:open-monitor-window", async () => {
    requireDevelopmentFeatures("Agent Monitor")
    return openMonitorWindow()
  })

  handleDesktopIpc("desktop:open-appearance-window", async () => {
    requireAppearanceAuthoring("The standalone appearance window")
    if (!options.mainDir || !options.rendererEntryUrl) {
      throw new Error("Appearance window options are unavailable.")
    }

    return openAppearanceWindow({
      mainDir: options.mainDir,
      rendererEntryUrl: options.rendererEntryUrl,
    })
  })

  handleDesktopIpc("desktop:show-menu", (event, input: MenuKey | { menuKey: MenuKey; anchor?: MenuAnchor }) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return

    const { menuKey, anchor } = normalizeShowMenuInput(input)

    menus.popupMenus[menuKey]?.popup({
      window: win,
      ...(anchor
        ? {
            x: Math.round(anchor.x),
            y: Math.round(anchor.y),
          }
        : {}),
    })
  })

  handleDesktopIpc("desktop:show-external-editor-menu", async (event, input: { targetPath: string; anchor?: MenuAnchor }) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return

    const targetPath = input.targetPath.trim()
    if (!targetPath) {
      throw new Error("A workspace directory is required.")
    }
    if (isSshWorkspaceUri(targetPath)) {
      Menu.buildFromTemplate([{
        label: "External editors are not available for SSH workspaces",
        enabled: false,
      }]).popup({
        window: win,
        ...(input.anchor
          ? {
              x: Math.round(input.anchor.x),
              y: Math.round(input.anchor.y),
            }
          : {}),
      })
      return
    }

    const availableEditors = filterAvailableExternalEditorsForTarget(getCachedAvailableExternalEditors(), targetPath)
    const menuItems: MenuItemConstructorOptions[] =
      availableEditors.length > 0
        ? availableEditors.map((editor) => {
            const iconPath = editor.iconPath ?? editor.executablePath
            primeExternalEditorMenuIcon(iconPath)

            return {
              id: editor.id,
              label: editor.label,
              icon: peekExternalEditorMenuIcon(iconPath),
              click: () => {
                void Promise.resolve(openInExternalEditor({ editorID: editor.id, targetPath }, { openPath: shell.openPath })).catch((error) => {
                  void dialog.showMessageBox(win, {
                    type: "error",
                    title: "Unable to Open Editor",
                    message: error instanceof Error ? error.message : String(error),
                  })
                })
              },
            }
          })
        : [
            {
              label: "No supported editors found",
              enabled: false,
            },
          ]

    Menu.buildFromTemplate(menuItems).popup({
      window: win,
      ...(input.anchor
        ? {
            x: Math.round(input.anchor.x),
            y: Math.round(input.anchor.y),
          }
        : {}),
    })
  })

  handleDesktopIpc("desktop:list-external-editors-for-target", (_event, input: { targetPath: string }) => {
    const targetPath = input.targetPath.trim()
    if (!targetPath) {
      throw new Error("A workspace directory is required.")
    }
    if (isSshWorkspaceUri(targetPath)) return []

    return filterAvailableExternalEditorsForTarget(getCachedAvailableExternalEditors(), targetPath).map((editor) => {
      const iconPath = editor.iconPath ?? editor.executablePath
      primeExternalEditorMenuIcon(iconPath)

      const iconDataUrl = peekExternalEditorMenuIconDataUrl(iconPath)
      return iconDataUrl
        ? {
            ...editor,
            iconDataUrl,
          }
        : editor
    })
  })

  handleDesktopIpc("desktop:open-in-external-editor", async (_event, input: { editorID?: string; targetPath: string }) => {
    if (isSshWorkspaceUri(input.targetPath)) {
      throw new Error("External editors are not available for SSH workspaces.")
    }
    return openInExternalEditor(input, { openPath: shell.openPath })
  })

  handleDesktopIpc("desktop:get-agent-config", () => getAgentConfig())

  handleDesktopIpc("desktop:agent-health", async () => {
    const config = getAgentConfig()

    try {
      const result = await requestAgentJSON<{ ok: boolean }>("/healthz")
      return {
        ok: result.data.ok === true,
        baseURL: config.baseURL,
        requestId: result.requestId,
      }
    } catch (error) {
      return {
        ok: false,
        baseURL: config.baseURL,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  })

  handleDesktopIpc("desktop:get-mobile-bridge-status", () => getMobileBridgeStatus())
  handleDesktopIpc("desktop:refresh-mobile-pairing-code", () => refreshMobilePairingCode())
  handleDesktopIpc("desktop:rotate-mobile-bridge-token", () => rotateMobileBridgeToken())
  handleDesktopIpc("desktop:revoke-mobile-device", (_event, input: DesktopIpcInput<"desktop:revoke-mobile-device">) =>
    revokeMobileDevice(input.deviceID),
  )

  handleDesktopIpc("desktop:list-folder-workspaces", async () => listFolderWorkspaces())
  handleDesktopIpc("desktop:list-project-workspaces", async () => listProjectWorkspaces())
  handleDesktopIpc("desktop:list-project-worktrees", async (_event, input: { projectID: string }) =>
    listProjectWorktrees(input.projectID),
  )
  handleDesktopIpc("desktop:create-project-worktree", async (_event, input: DesktopIpcInput<"desktop:create-project-worktree">) =>
    createProjectWorktree(input),
  )
  handleDesktopIpc("desktop:refresh-project-worktree", async (_event, input: DesktopIpcInput<"desktop:refresh-project-worktree">) =>
    refreshProjectWorktree(input),
  )
  handleDesktopIpc("desktop:delete-project-worktree", async (_event, input: DesktopIpcInput<"desktop:delete-project-worktree">) =>
    deleteProjectWorktree(input),
  )
  handleDesktopIpc("desktop:list-project-environments", async (_event, input: DesktopIpcInput<"desktop:list-project-environments">) =>
    listProjectEnvironments(input),
  )
  handleDesktopIpc("desktop:save-project-environment", async (_event, input: DesktopIpcInput<"desktop:save-project-environment">) =>
    saveProjectEnvironment(input),
  )
  handleDesktopIpc("desktop:import-project-environment", async (_event, input: DesktopIpcInput<"desktop:import-project-environment">) =>
    importProjectEnvironment(input),
  )
  handleDesktopIpc(
    "desktop:update-project-environment-preference",
    async (_event, input: DesktopIpcInput<"desktop:update-project-environment-preference">) =>
      updateProjectEnvironmentPreference(input),
  )
  handleDesktopIpc("desktop:trust-project-environment", async (_event, input: DesktopIpcInput<"desktop:trust-project-environment">) =>
    trustProjectEnvironment(input),
  )
  handleDesktopIpc(
    "desktop:revoke-project-environment-trust",
    async (_event, input: DesktopIpcInput<"desktop:revoke-project-environment-trust">) =>
      revokeProjectEnvironmentTrust(input),
  )
  handleDesktopIpc("desktop:get-environment-run", async (_event, input: DesktopIpcInput<"desktop:get-environment-run">) =>
    requestEnvironmentRun("desktop:get-environment-run", input),
  )
  handleDesktopIpc("desktop:cancel-environment-run", async (_event, input: DesktopIpcInput<"desktop:cancel-environment-run">) =>
    requestEnvironmentRun("desktop:cancel-environment-run", input),
  )
  handleDesktopIpc("desktop:retry-environment-run", async (_event, input: DesktopIpcInput<"desktop:retry-environment-run">) =>
    requestEnvironmentRun("desktop:retry-environment-run", input),
  )
  handleDesktopIpc("desktop:start-environment-action", async (_event, input: DesktopIpcInput<"desktop:start-environment-action">) =>
    startEnvironmentAction(input),
  )
  handleDesktopIpc("desktop:stop-environment-action", async (_event, input: DesktopIpcInput<"desktop:stop-environment-action">) =>
    stopEnvironmentAction(input),
  )
  handleDesktopIpc("desktop:restart-environment-setup", async (_event, input: DesktopIpcInput<"desktop:restart-environment-setup">) =>
    restartEnvironmentSetup(input),
  )
  handleDesktopIpc("desktop:update-workspace-watch-directories", async (event, input: { directories: string[] }) => ({
    directories: workspaceWatchManager.updateDirectories(
      event.sender,
      input.directories.filter((directory) => !isSshWorkspaceUri(directory)),
    ),
  }))

  handleDesktopIpc(
    "desktop:create-pty-session",
    async (
      _event,
      input?: {
        sessionID?: string
        terminalKey?: string
        purpose?: AgentPtySessionInfo["purpose"]
        title?: string
        shell?: string
        rows?: number
        cols?: number
      },
    ) => {
      if (!input?.sessionID?.trim()) {
        throw new Error("PTY session creation requires a sessionID")
      }
      const result = await requestAgentJSON<AgentPtySessionInfo>("/api/pty", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          sessionID: input.sessionID,
          terminalKey: input.terminalKey,
          purpose: input.purpose,
          title: input.title,
          shell: input.shell,
          rows: input.rows,
          cols: input.cols,
        }),
      })

      return result.data
    },
  )

  handleDesktopIpc("desktop:get-session-pty", async (_event, input) => getSessionPty(input))

  handleDesktopIpc("desktop:get-pty-session", async (_event, input: { id: string }) => {
    const id = input.id.trim()
    const result = await requestAgentJSON<AgentPtySessionInfo>(`/api/pty/${encodeURIComponent(id)}`)
    return result.data
  })

  handleDesktopIpc(
    "desktop:update-pty-session",
    async (
      _event,
      input: {
        id: string
        title?: string
        rows?: number
        cols?: number
      },
    ) => {
      const id = input.id.trim()
      const result = await requestAgentJSON<AgentPtySessionInfo>(`/api/pty/${encodeURIComponent(id)}`, {
        method: "PUT",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          title: input.title,
          rows: input.rows,
          cols: input.cols,
        }),
      })

      return result.data
    },
  )

  handleDesktopIpc("desktop:delete-pty-session", async (event, input: { id: string }) => {
    const id = input.id.trim()
    ptyProxyManager.detach(event.sender, id)
    const result = await requestAgentJSON<AgentPtySessionInfo>(`/api/pty/${encodeURIComponent(id)}`, {
      method: "DELETE",
    })

    return result.data
  })

  handleDesktopIpc("desktop:attach-pty-session", async (event, input: { id: string; cursor?: number }) =>
    ptyProxyManager.attach(event.sender, input),
  )

  handleDesktopIpc("desktop:detach-pty-session", async (event, input: { id: string }) =>
    ptyProxyManager.detach(event.sender, input.id),
  )

  handleDesktopIpc("desktop:write-pty-input", async (event, input: { id: string; data: string }) =>
    ptyProxyManager.write(event.sender, input),
  )

  handleDesktopIpc("desktop:pick-project-directory", async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const options = {
      title: "Select folder",
      properties: ["openDirectory"] as Array<"openDirectory">,
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)

    return result.canceled ? null : result.filePaths[0] ?? null
  })

  handleDesktopIpc(
    "desktop:pick-composer-attachments",
    async (event, input?: { allowImage?: boolean; allowPdf?: boolean }) => {
      const allowImage = input?.allowImage ?? true
      const allowPdf = input?.allowPdf ?? true
      const filters = [
        ...(allowImage
          ? [
              {
                name: "Images",
                extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"],
              },
            ]
          : []),
        ...(allowPdf
          ? [
              {
                name: "PDFs",
                extensions: ["pdf"],
              },
            ]
          : []),
      ]

      const title = allowImage && allowPdf ? "Select image or PDF" : allowImage ? "Select image" : "Select PDF"
      const win = BrowserWindow.fromWebContents(event.sender)
      const options = {
        title,
        properties: ["openFile", "multiSelections"] as Array<"openFile" | "multiSelections">,
        ...(filters.length > 0 ? { filters } : {}),
      }
      const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)

      return result.canceled ? [] : result.filePaths
    },
  )

  handleDesktopIpc("desktop:save-composer-pasted-images", async (_event, input) => saveComposerPastedImages(input))

  handleDesktopIpc("desktop:copy-image-to-clipboard", async (_event, input) => copyImageDataUrlToClipboard(input))

  handleDesktopIpc("desktop:save-image-to-folder", async (event, input) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    return saveImageDataUrlToFolder(input, {
      showOpenDialog: (dialogOptions) =>
        win ? dialog.showOpenDialog(win, dialogOptions) : dialog.showOpenDialog(dialogOptions),
    })
  })

  handleDesktopIpc("desktop:capture-preview-screenshot", async (event, input) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) {
      throw new Error("Preview screenshot capture requires an active window.")
    }

    return capturePreviewScreenshotFromWindow(win, input)
  })

  handleDesktopIpc("desktop:detect-local-preview-services", async () => detectLocalPreviewServices())
  handleDesktopIpc("desktop:resolve-preview-target", async (_event, input) => {
    if (input.workspaceRoot && isSshWorkspaceUri(input.workspaceRoot)) {
      return {
        input: input.value,
        normalizedInput: input.value,
        kind: "file" as const,
        mime: "text/plain",
        renderer: "system-open" as const,
        textReadable: false,
        title: input.value,
        workspaceRoot: input.workspaceRoot,
        error: "Local preview is not available for SSH workspaces.",
      }
    }
    return resolvePreviewTarget(input)
  })
  handleDesktopIpc("desktop:read-preview-text", async (_event, input) => {
    if (input.workspaceRoot && isSshWorkspaceUri(input.workspaceRoot)) {
      throw new Error("Local preview is not available for SSH workspaces.")
    }
    return readPreviewText(input)
  })

  handleDesktopIpc("desktop:git-get-capabilities", async (_event, input) => {
    if (isSshWorkspaceUri(input.directory)) {
      const disabled = { enabled: false, reason: "Git shortcuts are not available for SSH workspaces yet." }
      return {
        directory: input.directory,
        root: null,
        branch: null,
        defaultBranch: null,
        isGitRepo: false,
        canCommit: disabled,
        canStageAllCommit: disabled,
        canPush: disabled,
        canCreatePullRequest: disabled,
        canCreateBranch: disabled,
      }
    }
    return getGitCapabilities(input)
  })

  handleDesktopIpc(
    "desktop:git-commit",
    async (_event, input: { projectID: string; directory: string; message: string; stageAll?: boolean }) =>
    commitGitChanges(input),
  )

  handleDesktopIpc(
    "desktop:git-generate-commit-message",
    async (_event, input: { projectID: string; directory: string; stageAll?: boolean }) =>
      generateGitCommitMessage(input),
  )

  handleDesktopIpc("desktop:git-push", async (_event, input: { projectID: string; directory: string }) => pushGitChanges(input))

  handleDesktopIpc("desktop:git-create-branch", async (_event, input: { projectID: string; directory: string; name: string }) =>
    createGitBranch(input),
  )

  handleDesktopIpc("desktop:git-list-branches", async (_event, input: { projectID: string; directory: string }) =>
    listGitBranches(input),
  )

  handleDesktopIpc(
    "desktop:git-checkout-branch",
    async (_event, input: { projectID: string; directory: string; name: string }) => checkoutGitBranch(input),
  )

  handleDesktopIpc("desktop:git-create-pull-request", async (_event, input: { projectID: string; directory: string }) =>
    createGitPullRequest(input),
  )

  handleDesktopIpc("desktop:create-project-workspace", async (_event, input: { directory: string }) => {
    const directory = input.directory.trim()
    const result = await requestAgentJSON<AgentProjectInfo>("/api/projects", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ directory }),
    })

    return loadProjectWorkspace(result.data)
  })

  handleDesktopIpc("desktop:open-folder-workspace", async (_event, input: { directory: string }) => {
    const directory = input.directory.trim()
    const result = await requestAgentJSON<AgentProjectInfo>("/api/projects", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ directory }),
    })
    const projectWorkspace = await loadProjectWorkspace(result.data)
    return buildFolderWorkspaceForDirectory(result.data, projectWorkspace, directory)
  })

  handleDesktopIpc("desktop:list-ssh-profiles", async (): Promise<AgentSshProfile[]> => {
    const result = await requestAgentJSON<AgentSshProfile[]>("/api/remote/ssh/profiles")
    return result.data
  })

  handleDesktopIpc("desktop:save-ssh-profile", async (_event, input: AgentSshProfileInput): Promise<AgentSshProfile> => {
    const result = await requestAgentJSON<AgentSshProfile>("/api/remote/ssh/profiles", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(input),
    })
    return result.data
  })

  handleDesktopIpc("desktop:delete-ssh-profile", async (_event, input: { profileID: string }) => {
    const profileID = input.profileID.trim()
    const result = await requestAgentJSON<{ profileID: string; removed: boolean }>(
      `/api/remote/ssh/profiles/${encodeURIComponent(profileID)}`,
      { method: "DELETE" },
    )
    return result.data
  })

  handleDesktopIpc(
    "desktop:test-ssh-profile",
    async (_event, input: { profileID: string }): Promise<AgentSshConnectionTestResult> => {
      const profileID = input.profileID.trim()
      const result = await requestAgentJSON<AgentSshConnectionTestResult>(
        `/api/remote/ssh/profiles/${encodeURIComponent(profileID)}/test`,
        { method: "POST" },
      )
      return result.data
    },
  )

  handleDesktopIpc(
    "desktop:list-ssh-directory",
    async (_event, input: { profileID: string; path?: string | null }): Promise<AgentSshDirectoryListing> => {
      const profileID = input.profileID.trim()
      const result = await requestAgentJSON<AgentSshDirectoryListing>(
        `/api/remote/ssh/profiles/${encodeURIComponent(profileID)}/directories${queryString({ path: input.path ?? undefined })}`,
      )
      return result.data
    },
  )

  handleDesktopIpc(
    "desktop:open-ssh-folder-workspace",
    async (_event, input: { profileID: string; path: string }): Promise<AgentFolderWorkspace> => {
      const directory = createSshWorkspaceUri(input.profileID.trim(), input.path.trim())
      const result = await requestAgentJSON<AgentProjectInfo>("/api/projects", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ directory }),
      })
      const projectWorkspace = await loadProjectWorkspace(result.data)
      return buildFolderWorkspaceForDirectory(result.data, projectWorkspace, directory)
    },
  )

  handleDesktopIpc("desktop:agent-create-session", async (_event, input?: { directory?: string }) => {
    const config = getAgentConfig()
    const directory = input?.directory?.trim() || config.defaultDirectory
    const result = await requestAgentJSON<AgentSessionInfo>("/api/sessions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ directory }),
    })

    return {
      session: mapSessionInfo(result.data),
      requestId: result.requestId,
    }
  })

  handleDesktopIpc(
    "desktop:create-project-session",
    async (_event, input: { projectID: string; title?: string; directory?: string }) => {
      const projectID = input.projectID.trim()
      const result = await requestAgentJSON<AgentSessionInfo>(`/api/projects/${encodeURIComponent(projectID)}/sessions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          title: input.title?.trim() || undefined,
          directory: input.directory?.trim() || undefined,
        }),
      })

      return {
        session: mapSessionInfo(result.data),
        requestId: result.requestId,
      }
    },
  )

  handleDesktopIpc(
    "desktop:create-folder-session",
    async (_event, input: { projectID: string; directory: string; title?: string }) => {
      const projectID = input.projectID.trim()
      const directory = input.directory.trim()
      const result = await requestAgentJSON<AgentSessionInfo>(`/api/projects/${encodeURIComponent(projectID)}/sessions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          title: input.title?.trim() || undefined,
          directory,
        }),
      })

      return {
        session: mapSessionInfo(result.data),
        requestId: result.requestId,
      }
    },
  )

  handleDesktopIpc(
    "desktop:update-session-title",
    async (_event, input: { sessionID: string; title: string }) => updateAgentSessionTitle(input),
  )

  handleDesktopIpc(
    "desktop:update-session-pinned",
    async (_event, input: { sessionID: string; pinned: boolean }) => updateAgentSessionPinned(input),
  )

  handleDesktopIpc("desktop:delete-project-workspace", async (_event, input: { projectID: string }) => {
    const projectID = input.projectID.trim()
    const result = await requestAgentJSON<AgentProjectDeleteResult>(`/api/projects/${encodeURIComponent(projectID)}`, {
      method: "DELETE",
    })

    return {
      ...result.data,
      requestId: result.requestId,
    }
  })

  handleDesktopIpc("desktop:delete-agent-session", async (_event, input: { sessionID: string }) => {
    const sessionID = input.sessionID.trim()
    const result = await deleteAgentSessionRecord(sessionID)

    return result
  })

  handleDesktopIpc("desktop:archive-agent-session", async (_event, input: { sessionID: string }) => {
    const sessionID = input.sessionID.trim()
    const result = await requestAgentJSON<AgentSessionArchiveResult>(
      `/api/sessions/${encodeURIComponent(sessionID)}/archive`,
      {
        method: "POST",
      },
    )

    return {
      ...result.data,
      requestId: result.requestId,
    }
  })

  handleDesktopIpc("desktop:list-archived-sessions", async () => {
    const result = await requestAgentJSON<AgentArchivedSessionSummary[]>("/api/sessions/archived")
    return result.data
  })

  handleDesktopIpc("desktop:restore-archived-session", async (_event, input: { sessionID: string }) => {
    const sessionID = input.sessionID.trim()
    const result = await requestAgentJSON<AgentSessionInfo>(`/api/sessions/archived/${encodeURIComponent(sessionID)}/restore`, {
      method: "POST",
    })

    return {
      session: mapSessionInfo(result.data),
      requestId: result.requestId,
    }
  })

  handleDesktopIpc("desktop:delete-archived-session", async (_event, input: { sessionID: string }) => {
    const sessionID = input.sessionID.trim()
    const result = await requestAgentJSON<AgentArchivedSessionDeleteResult>(
      `/api/sessions/archived/${encodeURIComponent(sessionID)}`,
      {
        method: "DELETE",
      },
    )

    return {
      ...result.data,
      requestId: result.requestId,
    }
  })

  handleDesktopIpc("desktop:get-session-diff", async (_event, input: { sessionID: string; scope?: AgentSessionDiffScope }) => {
    const sessionID = input.sessionID.trim()
    const sessionResult = await requestAgentJSON<AgentSessionInfo>(`/api/sessions/${encodeURIComponent(sessionID)}`)
    if (isSshWorkspaceUri(sessionResult.data.directory)) {
      const result = await requestAgentJSON<AgentSessionDiffSummary>(
        `/api/sessions/${encodeURIComponent(sessionID)}/diff?scope=latest-turn`,
      )
      return withLastTurnScope(result.data, createNonGitScopeOptions(result.data), "none")
    }

    const requestedScope = input.scope
    const gitScope = requestedScope && GIT_DIFF_SCOPES.has(requestedScope) ? requestedScope as Extract<AgentSessionDiffScope, `git:${string}`> : "git:unstaged"
    const workspaceDiff = await getWorkspaceGitDiff(sessionResult.data.directory, { scope: gitScope }).catch((error) => {
      safeWarn("[desktop] getWorkspaceGitDiff failed:", error)
      return null
    })
    if (workspaceDiff && requestedScope !== "session:last-turn") {
      return {
        ...workspaceDiff,
        availableScopes: appendLastTurnScopeOption(workspaceDiff),
      }
    }

    const result = await requestAgentJSON<AgentSessionDiffSummary>(
      `/api/sessions/${encodeURIComponent(sessionID)}/diff?scope=latest-turn`,
    )
    const lastTurnDiff = workspaceDiff
      ? await withWorkspaceGitFileStates(sessionResult.data.directory, result.data)
      : result.data
    return withLastTurnScope(
      lastTurnDiff,
      workspaceDiff ? appendLastTurnScopeOption(workspaceDiff, lastTurnDiff) : createNonGitScopeOptions(lastTurnDiff),
      workspaceDiff ? "patch" : "none",
    )
  })

  handleDesktopIpc(
    "desktop:restore-workspace-diff-file",
    async (_event, input: { directory: string; file: string }) => restoreWorkspaceDiffFile(input),
  )

  handleDesktopIpc(
    "desktop:stage-workspace-diff-file",
    async (_event, input: { directory: string; file: string }) => stageWorkspaceDiffFile(input),
  )

  handleDesktopIpc(
    "desktop:unstage-workspace-diff-file",
    async (_event, input: { directory: string; file: string }) => unstageWorkspaceDiffFile(input),
  )

  handleDesktopIpc(
    "desktop:reverse-apply-workspace-diff-patches",
    async (_event, input: { directory: string; diffs: Array<{ file: string; patch?: string }> }) =>
      reverseApplyWorkspaceDiffPatches(input),
  )

  handleDesktopIpc(
    "desktop:get-session-runtime-debug",
    async (_event, input: { sessionID: string; limit?: number; turns?: number }) => {
      const sessionID = input.sessionID.trim()
      const search = new URLSearchParams()
      if (typeof input.limit === "number" && Number.isFinite(input.limit) && input.limit > 0) {
        search.set("limit", String(Math.floor(input.limit)))
      }
      if (typeof input.turns === "number" && Number.isFinite(input.turns) && input.turns > 0) {
        search.set("turns", String(Math.floor(input.turns)))
      }

      const suffix = search.size > 0 ? `?${search.toString()}` : ""
      const result = await requestAgentJSON<AgentSessionRuntimeDebugSnapshot>(
        `/api/debug/sessions/${encodeURIComponent(sessionID)}/runtime${suffix}`,
      )

      return result.data
    },
  )

  handleDesktopIpc(
    "desktop:get-session-trace-export",
    async (_event, input: SessionTraceExportInput) => getSessionTraceExport(input),
  )

  handleDesktopIpc(
    "desktop:save-session-trace-export",
    async (_event, input: SaveSessionTraceExportInput) => saveSessionTraceExport(input),
  )

  handleDesktopIpc(
    "desktop:save-session-trace-export-directory",
    async (_event, input: SaveSessionTraceExportDirectoryInput) => saveSessionTraceExportDirectory(input),
  )

  handleDesktopIpc(
    "desktop:save-session-trace-export-raw-directory",
    async (_event, input: SaveSessionTraceExportRawDirectoryInput) => saveSessionTraceExportRawDirectory(input),
  )

  handleDesktopIpc(
    "desktop:save-session-trace-export-to-project",
    async (_event, input: SaveSessionTraceExportToProjectInput) => saveSessionTraceExportToProject(input),
  )

  handleDesktopIpc(
    "desktop:prepare-session-bag-submission",
    async (_event, input: PrepareSessionBagSubmissionInput) => prepareSessionBagSubmission(input),
  )

  handleDesktopIpc(
    "desktop:upload-session-bag-submission",
    async (_event, input: UploadSessionBagSubmissionInput) => uploadSessionBagSubmission(input),
  )

  handleDesktopIpc(
    "desktop:discard-session-bag-submission",
    async (_event, input: DiscardSessionBagSubmissionInput) => discardSessionBagSubmission(input),
  )

  handleDesktopIpc(
    "desktop:update-session-workflow",
    async (_event, input: { sessionID: string } & AgentSessionWorkflowUpdateInput) => {
      const sessionID = input.sessionID.trim()
      const body =
        input.action === "approve-plan"
          ? {
              action: input.action,
              proposedPlanMarkdown: input.proposedPlanMarkdown,
            }
          : {
              action: input.action,
            }
      const result = await requestAgentJSON<AgentSessionInfo>(
        `/api/sessions/${encodeURIComponent(sessionID)}/workflow`,
        {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
        },
      )

      return {
        session: mapSessionInfo(result.data),
        requestId: result.requestId,
      }
    },
  )

  handleDesktopIpc("desktop:get-global-provider-catalog", async () => {
    const result = await requestAgentJSON<AgentProviderCatalogItem[]>("/api/providers/catalog")

    return result.data
  })

  handleDesktopIpc("desktop:get-anybox-subscription-overview", async () => {
    return await getAnyboxSubscriptionOverview()
  })

  handleDesktopIpc("desktop:create-anybox-subscription-order", async (_event, input) => {
    const result = await requestAnyboxSubscriptionJSON<DesktopSubscriptionOrderResponse>("/api/subscription/orders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    })
    return result.data
  })

  handleDesktopIpc("desktop:create-anybox-subscription-upgrade-quote", async (_event, input) => {
    const result = await requestAnyboxSubscriptionJSON<DesktopIpcOutput<"desktop:create-anybox-subscription-upgrade-quote">>(
      "/api/subscription/upgrade-quotes",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      },
    )
    return result.data
  })

  handleDesktopIpc("desktop:create-anybox-subscription-upgrade-order", async (_event, input) => {
    const result = await requestAnyboxSubscriptionJSON<DesktopSubscriptionOrderResponse>(
      "/api/subscription/upgrade-orders",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      },
    )
    return result.data
  })

  handleDesktopIpc("desktop:get-anybox-subscription-order", async (_event, input) => {
    const orderId = input.orderId.trim()
    if (!orderId) throw new Error("Subscription order ID is required.")
    const result = await requestAnyboxSubscriptionJSON<DesktopSubscriptionOrderResponse>(
      `/api/subscription/orders/${encodeURIComponent(orderId)}?sync=1`,
    )
    return result.data
  })

  handleDesktopIpc("desktop:cancel-anybox-subscription-order", async (_event, input) => {
    return await cancelAnyboxSubscriptionOrder(input.orderId)
  })

  handleDesktopIpc("desktop:create-anybox-recharge-order", async (_event, input) => {
    return await createAnyboxRechargeOrder(input)
  })

  handleDesktopIpc("desktop:get-anybox-recharge-order", async (_event, input) => {
    return await getAnyboxRechargeOrder(input.orderId)
  })

  handleDesktopIpc("desktop:cancel-anybox-recharge-order", async (_event, input) => {
    return await cancelAnyboxRechargeOrder(input.orderId)
  })

  handleDesktopIpc("desktop:refresh-global-provider-catalog", async () => {
    const result = await requestAgentJSON<AgentProviderCatalogItem[]>("/api/providers/catalog/refresh", {
      method: "POST",
    })

    return result.data
  })

  handleDesktopIpc("desktop:get-global-provider-auth", async (_event, input: { providerID: string }) => {
    const providerID = input.providerID.trim()
    const result = await requestAgentJSON<AgentProviderAuthState>(`/api/providers/${encodeURIComponent(providerID)}/auth`)
    return result.data
  })

  handleDesktopIpc(
    "desktop:start-global-provider-auth-flow",
    async (
      _event,
      input: {
        providerID: string
        method: string
        baseURL?: string | null
        prompt?: "login" | "select_account"
      },
    ) => {
      const providerID = input.providerID.trim()
      const result = await requestAgentJSON<AgentProviderAuthFlow>(
        `/api/providers/${encodeURIComponent(providerID)}/auth/flows`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            method: input.method,
            baseURL: input.baseURL,
            prompt: input.prompt,
          }),
        },
      )
      return result.data
    },
  )

  handleDesktopIpc(
    "desktop:get-global-provider-auth-flow",
    async (_event, input: { providerID: string; flowID: string }) => {
      const providerID = input.providerID.trim()
      const flowID = input.flowID.trim()
      const result = await requestAgentJSON<AgentProviderAuthFlow>(
        `/api/providers/${encodeURIComponent(providerID)}/auth/flows/${encodeURIComponent(flowID)}`,
      )
      return result.data
    },
  )

  handleDesktopIpc(
    "desktop:cancel-global-provider-auth-flow",
    async (_event, input: { providerID: string; flowID: string }) => {
      const providerID = input.providerID.trim()
      const flowID = input.flowID.trim()
      const result = await requestAgentJSON<AgentProviderAuthFlow>(
        `/api/providers/${encodeURIComponent(providerID)}/auth/flows/${encodeURIComponent(flowID)}`,
        {
          method: "DELETE",
        },
      )
      return result.data
    },
  )

  handleDesktopIpc(
    "desktop:save-global-provider-api-key",
    async (_event, input: { providerID: string; apiKey?: string | null }) => {
      const providerID = input.providerID.trim()
      const result = await requestAgentJSON<AgentProviderAuthState>(
        `/api/providers/${encodeURIComponent(providerID)}/auth/api-key`,
        {
          method: "PUT",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            apiKey: input.apiKey ?? null,
          }),
        },
      )
      return result.data
    },
  )

  handleDesktopIpc("desktop:get-cinema-video-providers", async () => {
    const result = await requestAgentJSON<CinemaVideoProvider[]>("/api/cinema/video-providers")
    return result.data
  })

  handleDesktopIpc("desktop:refresh-cinema-video-provider-catalog", async () => {
    const result = await requestAgentJSON<CinemaVideoProvider[]>("/api/cinema/video-providers/catalog/refresh", {
      method: "POST",
    })
    return result.data
  })

  handleDesktopIpc("desktop:get-cinema-provider-workflows", async (_event, input: { providerID: string }) => {
    const providerID = input.providerID.trim()
    const result = await requestAgentJSON<CinemaProviderWorkflowCatalog>(
      `/api/cinema/video-providers/${encodeURIComponent(providerID)}/workflows`,
    )
    return result.data
  })

  handleDesktopIpc("desktop:refresh-cinema-provider-workflows", async (_event, input: { providerID: string }) => {
    const providerID = input.providerID.trim()
    const result = await requestAgentJSON<CinemaProviderWorkflowCatalog>(
      `/api/cinema/video-providers/${encodeURIComponent(providerID)}/workflows/refresh`,
      { method: "POST" },
    )
    return result.data
  })

  handleDesktopIpc(
    "desktop:save-cinema-video-provider-api-key",
    async (_event, input: { providerID: string; apiKey?: string | null }) => {
      const providerID = input.providerID.trim()
      const result = await requestAgentJSON<CinemaProviderAuthState>(
        `/api/cinema/video-providers/${encodeURIComponent(providerID)}/auth/api-key`,
        {
          method: "PUT",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            apiKey: input.apiKey ?? null,
          }),
        },
      )
      return result.data
    },
  )

  handleDesktopIpc(
    "desktop:save-cinema-video-provider-settings",
    async (_event, input: { providerID: string; baseURL?: string | null; userID?: string | null }) => {
      const providerID = input.providerID.trim()
      const result = await requestAgentJSON<CinemaVideoProvider>(
        `/api/cinema/video-providers/${encodeURIComponent(providerID)}/settings`,
        {
          method: "PUT",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            baseURL: input.baseURL ?? null,
            userID: input.userID ?? null,
          }),
        },
      )
      return result.data
    },
  )

  handleDesktopIpc(
    "desktop:test-cinema-video-provider-connection",
    async (_event, input: { providerID: string; apiKey?: string | null; baseURL?: string | null; userID?: string | null }) => {
      const providerID = input.providerID.trim()
      const result = await requestAgentJSON<AgentProviderConnectionTestResult>(
        `/api/cinema/video-providers/${encodeURIComponent(providerID)}/test-connection`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            apiKey: input.apiKey ?? undefined,
            baseURL: input.baseURL ?? undefined,
            userID: input.userID ?? undefined,
          }),
        },
      )
      return result.data
    },
  )

  handleDesktopIpc("desktop:delete-global-provider-auth-session", async (_event, input: { providerID: string }) => {
    const providerID = input.providerID.trim()
    const result = await requestAgentJSON<AgentProviderAuthState>(
      `/api/providers/${encodeURIComponent(providerID)}/auth/session`,
      {
        method: "DELETE",
      },
    )
    return result.data
  })

  handleDesktopIpc(
    "desktop:test-global-provider-connection",
    async (
      _event,
      input: {
        providerID: string
        method?: string
        credentialMode?: "active" | "manual" | "environment"
        apiKey?: string | null
        baseURL?: string | null
      },
    ) => {
      const providerID = input.providerID.trim()
      const result = await requestAgentJSON<AgentProviderConnectionTestResult>(
        `/api/providers/${encodeURIComponent(providerID)}/auth/test`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            method: input.method,
            credentialMode: input.credentialMode,
            apiKey: input.apiKey ?? undefined,
            baseURL: input.baseURL ?? undefined,
          }),
        },
      )
      return result.data
    },
  )

  handleDesktopIpc(
    "desktop:upsert-custom-provider",
    async (
      _event,
      input: {
        providerID?: string
        apiBaseURL: string
        apiKey: string
        defaultModel: string
        chatEndpoint: string
        supportsImageInput: boolean
        supportsPdfInput: boolean
        supportsReasoning: boolean
      },
    ) => {
      const result = await requestAgentJSON<{
        provider: {
          id: string
          name: string
          available: boolean
          apiKeyConfigured: boolean
          baseURL?: string
        }
        selection: AgentProjectModelSelection
      }>("/api/providers/custom", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          providerID: input.providerID,
          apiBaseURL: input.apiBaseURL,
          apiKey: input.apiKey,
          defaultModel: input.defaultModel,
          chatEndpoint: input.chatEndpoint,
          supportsImageInput: input.supportsImageInput,
          supportsPdfInput: input.supportsPdfInput,
          supportsReasoning: input.supportsReasoning,
        }),
      })
      return result.data
    },
  )

  handleDesktopIpc(
    "desktop:test-custom-provider-connection",
    async (
      _event,
      input: {
        providerID?: string
        apiBaseURL: string
        apiKey: string
        defaultModel: string
        chatEndpoint: string
        supportsImageInput: boolean
        supportsPdfInput: boolean
        supportsReasoning: boolean
      },
    ) => {
      const result = await requestAgentJSON<AgentProviderConnectionTestResult>("/api/providers/custom/test", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          providerID: input.providerID,
          apiBaseURL: input.apiBaseURL,
          apiKey: input.apiKey,
          defaultModel: input.defaultModel,
          chatEndpoint: input.chatEndpoint,
          supportsImageInput: input.supportsImageInput,
          supportsPdfInput: input.supportsPdfInput,
          supportsReasoning: input.supportsReasoning,
        }),
      })
      return result.data
    },
  )

  handleDesktopIpc("desktop:get-global-models", async () => {
    const result = await requestAgentJSON<{
      items: AgentProviderModel[]
      selection: AgentProjectModelSelection
    }>("/api/models")

    return result.data
  })

  handleDesktopIpc("desktop:get-global-model-catalog", async () => {
    const result = await requestAgentJSON<AgentModelCatalogResult>("/api/model-catalog")

    return result.data
  })

  handleDesktopIpc(
    "desktop:update-global-provider",
    async (
      _event,
      input: {
        providerID: string
        provider: {
          name?: string
          env?: string[]
          options?: {
            apiKey?: string
            baseURL?: string
          }
        }
      },
    ) => {
      const providerID = input.providerID.trim()
      const result = await requestAgentJSON<{
        provider: {
          id: string
          name: string
          available: boolean
          apiKeyConfigured: boolean
          baseURL?: string
        }
        selection: AgentProjectModelSelection
      }>(`/api/providers/${encodeURIComponent(providerID)}`, {
        method: "PUT",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(input.provider),
      })

      return result.data
    },
  )

  handleDesktopIpc("desktop:delete-global-provider", async (_event, input: { providerID: string }) => {
    const providerID = input.providerID.trim()
    const result = await requestAgentJSON<{
      providerID: string
      selection: AgentProjectModelSelection
    }>(`/api/providers/${encodeURIComponent(providerID)}`, {
      method: "DELETE",
    })

    return result.data
  })

  handleDesktopIpc(
    "desktop:update-global-model-selection",
    async (
      _event,
      input: {
        model?: string | null
        small_model?: string | null
        reasoning_effort?: AgentProjectModelSelection["reasoning_effort"] | null
        image_model?: string | null
        image_generation?: {
          default_size?: string
          default_count?: number
        } | null
      },
    ) => {
      const result = await requestAgentJSON<AgentProjectModelSelection>("/api/model-selection", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: input.model,
          small_model: input.small_model,
          ...(input.reasoning_effort !== undefined ? { reasoning_effort: input.reasoning_effort } : {}),
          ...(input.image_model !== undefined ? { image_model: input.image_model } : {}),
          ...(input.image_generation !== undefined ? { image_generation: input.image_generation } : {}),
        }),
      })

      return result.data
    },
  )

  handleDesktopIpc("desktop:get-global-mcp-servers", async () => {
    const result = await requestAgentJSON<AgentMcpServerSummary[]>("/api/mcp/servers")

    return result.data
  })

  handleDesktopIpc("desktop:get-global-mcp-server-diagnostic", async (_event, input: { serverID: string }) => {
    const serverID = input.serverID.trim()
    const result = await requestAgentJSON<AgentMcpServerDiagnostic>(
      `/api/mcp/servers/${encodeURIComponent(serverID)}/diagnostic`,
    )

    return result.data
  })

  handleDesktopIpc(
    "desktop:update-global-mcp-server",
    async (
      _event,
      input: {
        serverID: string
        server: McpServerInput
      },
    ) => {
      const serverID = input.serverID.trim()
      const result = await requestAgentJSON<AgentMcpServerSummary>(`/api/mcp/servers/${encodeURIComponent(serverID)}`, {
        method: "PUT",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(input.server),
      })

      return result.data
    },
  )

  handleDesktopIpc("desktop:delete-global-mcp-server", async (_event, input: { serverID: string }) => {
    const serverID = input.serverID.trim()
    const result = await requestAgentJSON<{ serverID: string; removed: boolean }>(
      `/api/mcp/servers/${encodeURIComponent(serverID)}`,
      {
        method: "DELETE",
      },
    )

    return result.data
  })

  handleDesktopIpc("desktop:get-plugin-catalog", async (
    _event,
    input?: DesktopIpcInput<"desktop:get-plugin-catalog">,
  ) => {
    const path = input?.freshness === "cached"
      ? "/api/plugins/catalog?freshness=cached"
      : "/api/plugins/catalog"
    const result = await preservePluginAgentErrorCode(() =>
      requestAgentJSON<AgentPluginCatalogItem[]>(path))

    return result.data
  })

  handleDesktopIpc("desktop:get-installed-plugins", async () => {
    const result = await requestAgentJSON<AgentInstalledPlugin[]>("/api/plugins/installed")

    return result.data
  })

  handleDesktopIpc("desktop:import-plugin-from-url", async (_event, input: { url: string }) => {
    const result = await preservePluginAgentErrorCode(() =>
      requestAgentJSON<AgentPluginCatalogItem>("/api/plugins/import-url", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          url: input.url,
        }),
      }))

    return result.data
  })

  handleDesktopIpc(
    "desktop:install-plugin",
    async (_event, input: { pluginID: string; config?: Record<string, string>; enabled?: boolean }) => {
      const pluginID = input.pluginID.trim()
      const result = await preservePluginAgentErrorCode(() =>
        requestAgentJSON<AgentInstalledPlugin>(
          `/api/plugins/installed/${encodeURIComponent(pluginID)}`,
          {
            method: "PUT",
            headers: {
              "content-type": "application/json",
            },
            body: JSON.stringify({
              config: input.config,
              enabled: input.enabled,
            }),
          },
        ))

      return result.data
    },
  )

  handleDesktopIpc(
    "desktop:update-installed-plugin",
    async (_event, input: { pluginID: string; config?: Record<string, string>; enabled?: boolean }) => {
      const pluginID = input.pluginID.trim()
      const result = await preservePluginAgentErrorCode(() =>
        requestAgentJSON<AgentInstalledPlugin>(
          `/api/plugins/installed/${encodeURIComponent(pluginID)}`,
          {
            method: "PATCH",
            headers: {
              "content-type": "application/json",
            },
            body: JSON.stringify({
              config: input.config,
              enabled: input.enabled,
            }),
          },
        ))

      return result.data
    },
  )

  handleDesktopIpc(
    "desktop:update-installed-plugin-mcp-controls",
    async (_event, input) => {
      const pluginID = input.pluginID.trim()
      const serverID = input.serverID.trim()
      const result = await requestAgentJSON<AgentPluginMcpControlsResult>(
        `/api/plugins/installed/${encodeURIComponent(pluginID)}/mcp/${encodeURIComponent(serverID)}`,
        {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            enabled: input.enabled,
            toolPolicies: input.toolPolicies,
          }),
        },
      )

      return result.data
    },
  )

  handleDesktopIpc(
    "desktop:list-installed-plugin-skill-entries",
    async (_event, input) => {
      const pluginID = input.pluginID.trim()
      const skillID = input.skillID.trim()
      const directoryPath = input.path ?? ""
      const query = directoryPath ? `?path=${encodeURIComponent(directoryPath)}` : ""
      const result = await requestAgentJSON<AgentPluginSkillDirectory>(
        `/api/plugins/installed/${encodeURIComponent(pluginID)}/skills/${encodeURIComponent(skillID)}/entries${query}`,
      )

      return result.data
    },
  )

  handleDesktopIpc(
    "desktop:read-installed-plugin-skill-file",
    async (_event, input) => {
      const pluginID = input.pluginID.trim()
      const skillID = input.skillID.trim()
      const result = await requestAgentJSON<AgentPluginSkillFile>(
        `/api/plugins/installed/${encodeURIComponent(pluginID)}/skills/${encodeURIComponent(skillID)}/file?path=${encodeURIComponent(input.path)}`,
      )

      return result.data
    },
  )

  handleDesktopIpc("desktop:delete-installed-plugin", async (_event, input: { pluginID: string }) => {
    const pluginID = input.pluginID.trim()
    const result = await requestAgentJSON<AgentPluginDeleteResult>(
      `/api/plugins/installed/${encodeURIComponent(pluginID)}`,
      {
        method: "DELETE",
      },
    )

    return result.data
  })

  handleDesktopIpc("desktop:get-installed-plugin-diagnostic", async (_event, input: { pluginID: string }) => {
    const pluginID = input.pluginID.trim()
    const result = await requestAgentJSON<AgentMcpServerDiagnostic>(
      `/api/plugins/installed/${encodeURIComponent(pluginID)}/diagnostic`,
    )

    return result.data
  })

  handleDesktopIpc("desktop:get-connector-catalog", async () => {
    const result = await requestAgentJSON<AgentConnectorDefinition[]>("/api/connectors/catalog")

    return result.data
  })

  handleDesktopIpc("desktop:get-connectors", async () => {
    const result = await requestAgentJSON<AgentConnectorStatus[]>("/api/connectors")

    return result.data
  })

  handleDesktopIpc("desktop:get-connector", async (_event, input: { connectorID: string }) => {
    const connectorID = input.connectorID.trim()
    const result = await requestAgentJSON<AgentConnectorStatus>(
      `/api/connectors/${encodeURIComponent(connectorID)}`,
    )

    return result.data
  })

  handleDesktopIpc(
    "desktop:save-connector-api-key",
    async (_event, input: { connectorID: string; apiKey?: string | null }) => {
      const connectorID = input.connectorID.trim()
      const result = await requestAgentJSON<AgentConnectorStatus>(
        `/api/connectors/${encodeURIComponent(connectorID)}/api-key`,
        {
          method: "PUT",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            apiKey: input.apiKey ?? null,
          }),
        },
      )

      return result.data
    },
  )

  handleDesktopIpc("desktop:delete-connector-api-key", async (_event, input: { connectorID: string }) => {
    const connectorID = input.connectorID.trim()
    const result = await requestAgentJSON<AgentConnectorStatus>(
      `/api/connectors/${encodeURIComponent(connectorID)}/api-key`,
      {
        method: "DELETE",
      },
    )

    return result.data
  })

  handleDesktopIpc("desktop:get-session-tasks", async (_event, input: { sessionID: string }) => {
    const sessionID = input.sessionID.trim()
    const result = await requestAgentJSON<AgentSessionTaskListView>(
      `/api/sessions/${encodeURIComponent(sessionID)}/tasks`,
    )

    return result.data
  })

  handleDesktopIpc("desktop:get-session-background-processes", async (_event, input) =>
    getSessionBackgroundProcesses(input))

  handleDesktopIpc("desktop:terminate-session-background-process", async (_event, input) =>
    terminateSessionBackgroundProcess(input))

  handleDesktopIpc("desktop:terminate-all-session-background-processes", async (_event, input) =>
    terminateAllSessionBackgroundProcesses(input))

  handleDesktopIpc(
    "desktop:save-connector-config",
    async (_event, input: { connectorID: string; config: Record<string, string | null | undefined> }) => {
      const connectorID = input.connectorID.trim()
      const result = await requestAgentJSON<AgentConnectorStatus>(
        `/api/connectors/${encodeURIComponent(connectorID)}/config`,
        {
          method: "PUT",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            config: input.config ?? {},
          }),
        },
      )

      return result.data
    },
  )

  handleDesktopIpc("desktop:delete-connector-config", async (_event, input: { connectorID: string }) => {
    const connectorID = input.connectorID.trim()
    const result = await requestAgentJSON<AgentConnectorStatus>(
      `/api/connectors/${encodeURIComponent(connectorID)}/config`,
      {
        method: "DELETE",
      },
    )

    return result.data
  })

  handleDesktopIpc("desktop:start-connector-auth-flow", async (_event, input: { connectorID: string }) => {
    const connectorID = input.connectorID.trim()
    const result = await requestAgentJSON<AgentProviderAuthFlow>(
      `/api/connectors/${encodeURIComponent(connectorID)}/auth/flows`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({}),
      },
    )

    return result.data
  })

  handleDesktopIpc(
    "desktop:get-connector-auth-flow",
    async (_event, input: { connectorID: string; flowID: string }) => {
      const connectorID = input.connectorID.trim()
      const flowID = input.flowID.trim()
      const result = await requestAgentJSON<AgentProviderAuthFlow | undefined>(
        `/api/connectors/${encodeURIComponent(connectorID)}/auth/flows/${encodeURIComponent(flowID)}`,
      )

      return result.data
    },
  )

  handleDesktopIpc(
    "desktop:cancel-connector-auth-flow",
    async (_event, input: { connectorID: string; flowID: string }) => {
      const connectorID = input.connectorID.trim()
      const flowID = input.flowID.trim()
      const result = await requestAgentJSON<AgentProviderAuthFlow | undefined>(
        `/api/connectors/${encodeURIComponent(connectorID)}/auth/flows/${encodeURIComponent(flowID)}`,
        {
          method: "DELETE",
        },
      )

      return result.data
    },
  )

  handleDesktopIpc("desktop:delete-connector-auth-session", async (_event, input: { connectorID: string }) => {
    const connectorID = input.connectorID.trim()
    const result = await requestAgentJSON<AgentConnectorStatus>(
      `/api/connectors/${encodeURIComponent(connectorID)}/auth/session`,
      {
        method: "DELETE",
      },
    )

    return result.data
  })

  handleDesktopIpc("desktop:get-connector-diagnostic", async (
    _event,
    input: { connectorID: string; runtimeID?: string },
  ) => {
    const connectorID = input.connectorID.trim()
    const runtimeID = input.runtimeID?.trim()
    const runtimeQuery = runtimeID ? `?runtimeID=${encodeURIComponent(runtimeID)}` : ""
    const result = await requestAgentJSON<AgentMcpServerDiagnostic>(
      `/api/connectors/${encodeURIComponent(connectorID)}/diagnostic${runtimeQuery}`,
    )

    return result.data
  })

  handleDesktopIpc("desktop:get-installed-plugin-connectors", async (_event, input: { pluginID: string }) => {
    const pluginID = input.pluginID.trim()
    const result = await requestAgentJSON<AgentPluginConnectorStatus[]>(
      `/api/plugins/installed/${encodeURIComponent(pluginID)}/connectors`,
    )

    return result.data
  })

  handleDesktopIpc(
    "desktop:save-installed-plugin-connector-api-key",
    async (_event, input: { pluginID: string; appID: string; apiKey?: string | null }) => {
      const pluginID = input.pluginID.trim()
      const appID = input.appID.trim()
      const result = await requestAgentJSON<AgentPluginConnectorStatus>(
        `/api/plugins/installed/${encodeURIComponent(pluginID)}/connectors/${encodeURIComponent(appID)}/api-key`,
        {
          method: "PUT",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            apiKey: input.apiKey ?? null,
          }),
        },
      )

      return result.data
    },
  )

  handleDesktopIpc(
    "desktop:delete-installed-plugin-connector-api-key",
    async (_event, input: { pluginID: string; appID: string }) => {
      const pluginID = input.pluginID.trim()
      const appID = input.appID.trim()
      const result = await requestAgentJSON<AgentPluginConnectorStatus>(
        `/api/plugins/installed/${encodeURIComponent(pluginID)}/connectors/${encodeURIComponent(appID)}/api-key`,
        {
          method: "DELETE",
        },
      )

      return result.data
    },
  )

  handleDesktopIpc(
    "desktop:start-installed-plugin-connector-auth-flow",
    async (_event, input: { pluginID: string; appID: string }) => {
      const pluginID = input.pluginID.trim()
      const appID = input.appID.trim()
      const result = await requestAgentJSON<AgentProviderAuthFlow>(
        `/api/plugins/installed/${encodeURIComponent(pluginID)}/connectors/${encodeURIComponent(appID)}/auth/flows`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({}),
        },
      )

      return result.data
    },
  )

  handleDesktopIpc(
    "desktop:get-installed-plugin-connector-auth-flow",
    async (_event, input: { pluginID: string; appID: string; flowID: string }) => {
      const pluginID = input.pluginID.trim()
      const appID = input.appID.trim()
      const flowID = input.flowID.trim()
      const result = await requestAgentJSON<AgentProviderAuthFlow | undefined>(
        `/api/plugins/installed/${encodeURIComponent(pluginID)}/connectors/${encodeURIComponent(appID)}/auth/flows/${encodeURIComponent(flowID)}`,
      )

      return result.data
    },
  )

  handleDesktopIpc(
    "desktop:cancel-installed-plugin-connector-auth-flow",
    async (_event, input: { pluginID: string; appID: string; flowID: string }) => {
      const pluginID = input.pluginID.trim()
      const appID = input.appID.trim()
      const flowID = input.flowID.trim()
      const result = await requestAgentJSON<AgentProviderAuthFlow | undefined>(
        `/api/plugins/installed/${encodeURIComponent(pluginID)}/connectors/${encodeURIComponent(appID)}/auth/flows/${encodeURIComponent(flowID)}`,
        {
          method: "DELETE",
        },
      )

      return result.data
    },
  )

  handleDesktopIpc(
    "desktop:delete-installed-plugin-connector-auth-session",
    async (_event, input: { pluginID: string; appID: string }) => {
      const pluginID = input.pluginID.trim()
      const appID = input.appID.trim()
      const result = await requestAgentJSON<AgentPluginConnectorStatus>(
        `/api/plugins/installed/${encodeURIComponent(pluginID)}/connectors/${encodeURIComponent(appID)}/auth/session`,
        {
          method: "DELETE",
        },
      )

      return result.data
    },
  )

  handleDesktopIpc(
    "desktop:get-installed-plugin-connector-diagnostic",
    async (_event, input: { pluginID: string; appID: string }) => {
      const pluginID = input.pluginID.trim()
      const appID = input.appID.trim()
      const result = await requestAgentJSON<AgentMcpServerDiagnostic>(
        `/api/plugins/installed/${encodeURIComponent(pluginID)}/connectors/${encodeURIComponent(appID)}/diagnostic`,
      )

      return result.data
    },
  )

  handleDesktopIpc("desktop:get-builtin-tools", async () => {
    const result = await requestAgentJSON<AgentBuiltinToolsPayload>("/api/tools/builtins")

    return result.data
  })

  handleDesktopIpc("desktop:update-builtin-tool-selection", async (_event, input: AgentBuiltinToolSelection) => {
    const result = await requestAgentJSON<AgentBuiltinToolSelection>("/api/tools/builtins/selection", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        tools: input.tools,
      }),
    })

    return result.data
  })

  handleDesktopIpc("desktop:get-tool-permission-mode", async () => getToolPermissionMode())

  handleDesktopIpc("desktop:update-tool-permission-mode", async (_event, input: AgentToolPermissionModePayload) =>
    updateToolPermissionMode(input),
  )

  handleDesktopIpc("desktop:list-automations", async () => {
    const result = await requestAgentJSON<AgentAutomationDefinition[]>("/api/automations")
    return result.data
  })

  handleDesktopIpc("desktop:create-automation", async (_event, input: AgentAutomationCreateInput) => {
    const result = await requestAgentJSON<AgentAutomationDefinition>("/api/automations", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(input),
    })
    return result.data
  })

  handleDesktopIpc(
    "desktop:update-automation",
    async (_event, input: { automationID: string; automation: AgentAutomationUpdateInput }) => {
      const automationID = input.automationID.trim()
      const result = await requestAgentJSON<AgentAutomationDefinition>(
        `/api/automations/${encodeURIComponent(automationID)}`,
        {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify(input.automation),
        },
      )
      return result.data
    },
  )

  handleDesktopIpc("desktop:delete-automation", async (_event, input: { automationID: string }) => {
    const automationID = input.automationID.trim()
    const result = await requestAgentJSON<AgentAutomationDeleteResult>(
      `/api/automations/${encodeURIComponent(automationID)}`,
      {
        method: "DELETE",
      },
    )
    return result.data
  })

  handleDesktopIpc("desktop:run-automation", async (_event, input: { automationID: string }) => {
    const automationID = input.automationID.trim()
    const result = await requestAgentJSON<AgentAutomationRunCreateResult>(
      `/api/automations/${encodeURIComponent(automationID)}/run`,
      {
        method: "POST",
      },
    )
    return result.data
  })

  handleDesktopIpc("desktop:list-automation-runs", async (_event, input?: AgentAutomationRunListInput) => {
    const params = new URLSearchParams()
    if (input?.automationID?.trim()) params.set("automationID", input.automationID.trim())
    if (input?.triageStatus) params.set("triageStatus", input.triageStatus)
    if (input?.limit) params.set("limit", String(input.limit))
    const suffix = params.size > 0 ? `?${params.toString()}` : ""
    const result = await requestAgentJSON<AgentAutomationRun[]>(`/api/automation-runs${suffix}`)
    return result.data
  })

  handleDesktopIpc(
    "desktop:update-automation-run-triage",
    async (_event, input: { runID: string; triageStatus: AgentAutomationTriageStatus }) => {
      const runID = input.runID.trim()
      const result = await requestAgentJSON<AgentAutomationRun | null>(
        `/api/automation-runs/${encodeURIComponent(runID)}/triage`,
        {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            triageStatus: input.triageStatus,
          }),
        },
      )
      return result.data
    },
  )

  handleDesktopIpc("desktop:cancel-automation-run", async (_event, input: { runID: string }) => {
    const runID = input.runID.trim()
    const result = await requestAgentJSON<AgentAutomationRun | null>(
      `/api/automation-runs/${encodeURIComponent(runID)}/cancel`,
      {
        method: "POST",
      },
    )
    return result.data
  })

  handleDesktopIpc("desktop:get-global-skills", async () => {
    const result = await requestAgentJSON<AgentSkillInfo[]>("/api/skills")

    return result.data
  })

  handleDesktopIpc("desktop:get-skill-registry-providers", async () => {
    const result = await requestAgentJSON<RegistryProviderDescriptor[]>("/api/skill-registry/providers")
    return result.data
  })

  handleDesktopIpc("desktop:search-skill-registry", async (_event, input) => {
    const result = await requestAgentJSON<RegistrySearchPage>("/api/skill-registry/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    })
    return result.data
  })

  handleDesktopIpc("desktop:get-skill-registry-detail", async (_event, input) => {
    const result = await requestAgentJSON<RegistrySkillDetail>("/api/skill-registry/detail", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    })
    return result.data
  })

  handleDesktopIpc("desktop:get-skill-registry-versions", async (_event, input) => {
    const result = await requestAgentJSON<RegistryVersion[]>("/api/skill-registry/versions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    })
    return result.data
  })

  handleDesktopIpc("desktop:get-skill-registry-files", async (_event, input) => {
    const result = await requestAgentJSON<RegistryFile[]>("/api/skill-registry/files", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    })
    return result.data
  })

  handleDesktopIpc("desktop:read-skill-registry-file", async (_event, input) => {
    const result = await requestAgentJSON<RegistryFileContent>("/api/skill-registry/file", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    })
    return result.data
  })

  handleDesktopIpc("desktop:get-skill-registry-security", async (_event, input) => {
    const result = await requestAgentJSON<RegistrySecuritySnapshot>("/api/skill-registry/security", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    })
    return result.data
  })

  handleDesktopIpc("desktop:download-skill-registry-skill", async (_event, input) => {
    return await downloadSkillRegistrySkill(input)
  })

  handleDesktopIpc("desktop:list-downloaded-registry-skills", async () => {
    const result = await requestAgentJSON<DownloadedRegistrySkill[]>("/api/skill-registry/downloads")
    return result.data
  })

  handleDesktopIpc("desktop:set-downloaded-registry-skill-enabled", async (_event, input) => {
    return await setDownloadedRegistrySkillEnabled(input)
  })

  handleDesktopIpc("desktop:delete-downloaded-registry-skill", async (_event, input) => {
    const result = await requestAgentJSON<DesktopRegistrySkillDeleteResult>(
      `/api/skill-registry/downloads/${encodeURIComponent(input.id)}`,
      { method: "DELETE" },
    )
    return result.data
  })

  handleDesktopIpc("desktop:read-downloaded-registry-skill-file", async (_event, input) => {
    const result = await requestAgentJSON<RegistryFileContent>(
      `/api/skill-registry/downloads/${encodeURIComponent(input.id)}/file`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: input.path, version: input.version }),
      },
    )
    return result.data
  })

  handleDesktopIpc("desktop:list-downloaded-registry-skill-files", async (_event, input) => {
    const result = await requestAgentJSON<RegistryFile[]>(
      `/api/skill-registry/downloads/${encodeURIComponent(input.id)}/files`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ version: input.version }),
      },
    )
    return result.data
  })

  handleDesktopIpc("desktop:fork-downloaded-registry-skill", async (_event, input) => {
    return await forkDownloadedRegistrySkill(input)
  })

  handleDesktopIpc("desktop:preview-downloaded-registry-skill-update", async (_event, input) => {
    return await previewDownloadedRegistrySkillUpdate(input)
  })

  handleDesktopIpc("desktop:update-downloaded-registry-skill", async (_event, input) => {
    const result = await requestAgentJSON<DownloadedRegistrySkill>(
      `/api/skill-registry/downloads/${encodeURIComponent(input.id)}/update`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ version: input.version }),
      },
    )
    return result.data
  })

  handleDesktopIpc("desktop:rollback-downloaded-registry-skill", async (_event, input) => {
    const result = await requestAgentJSON<DesktopRegistrySkillMutationResult>(
      `/api/skill-registry/downloads/${encodeURIComponent(input.id)}/rollback`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ version: input.version }),
      },
    )
    return result.data
  })

  handleDesktopIpc("desktop:get-prompt-presets", async () => {
    const result = await requestAgentJSON<AgentPromptPresetSummary[]>("/api/prompts")

    return result.data
  })

  handleDesktopIpc("desktop:get-prompt-preset-selection", async () => {
    const result = await requestAgentJSON<AgentPromptPresetSelection>("/api/prompts/selection")

    return result.data
  })

  handleDesktopIpc("desktop:read-prompt-preset", async (_event, input: { presetID: string }) => {
    const result = await requestAgentJSON<AgentPromptPresetDocument>(
      `/api/prompts/${encodeURIComponent(input.presetID.trim())}`,
    )

    return result.data
  })

  handleDesktopIpc(
    "desktop:update-prompt-preset",
    async (_event, input: { presetID: string; label?: string; content: string; description?: string }) => {
    const result = await requestAgentJSON<AgentPromptPresetDocument>(
      `/api/prompts/${encodeURIComponent(input.presetID.trim())}`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          label: input.label,
          content: input.content,
          description: input.description,
        }),
      },
    )

    return result.data
    },
  )

  handleDesktopIpc(
    "desktop:update-prompt-preset-selection",
    async (_event, input: AgentPromptPresetSelection) => {
      return updatePromptPresetSelection(input)
    },
  )

  handleDesktopIpc(
    "desktop:create-prompt-preset",
    async (_event, input: { label?: string; content?: string; description?: string }) => {
      const result = await requestAgentJSON<AgentPromptPresetDocument>("/api/prompts", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(input),
      })

      return result.data
    },
  )

  handleDesktopIpc(
    "desktop:translate-prompt-preset",
    async (_event, input: DesktopIpcInput<"desktop:translate-prompt-preset">) => translatePromptPreset(input),
  )

  handleDesktopIpc("desktop:preview-prompt-url-install", async (_event, input: { source: string }) => {
    const result = await requestAgentJSON<AgentPromptUrlInstallPreview>("/api/prompts/url/preview", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        source: input.source,
      }),
    })

    return result.data
  })

  handleDesktopIpc("desktop:install-prompts-from-url", async (_event, input: { previewID: string; promptIDs: string[] }) => {
    const result = await requestAgentJSON<AgentPromptUrlInstallResult>("/api/prompts/url/install", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        previewID: input.previewID,
        promptIDs: input.promptIDs,
      }),
    })

    return result.data
  })

  handleDesktopIpc("desktop:reset-prompt-preset", async (_event, input: { presetID: string }) => {
    const result = await requestAgentJSON<AgentPromptPresetDocument>(
      `/api/prompts/${encodeURIComponent(input.presetID.trim())}`,
      {
        method: "DELETE",
      },
    )

    return result.data
  })

  handleDesktopIpc("desktop:delete-prompt-preset", async (_event, input: { presetID: string }) => {
    const result = await requestAgentJSON<AgentPromptPresetSelection>(
      `/api/prompts/${encodeURIComponent(input.presetID.trim())}/custom`,
      {
        method: "DELETE",
      },
    )

    return result.data
  })

  handleDesktopIpc("desktop:get-global-skills-tree", async (event) => {
    const result = await requestAgentJSON<AgentGlobalSkillTree>("/api/skills/tree")

    globalSkillsWatchManager.updateDirectories(event.sender, [result.data.root])

    return result.data
  })

  handleDesktopIpc("desktop:read-global-skill-file", async (_event, input: { path: string }) => {
    const result = await requestAgentJSON<AgentGlobalSkillFileDocument>(
      `/api/skills/file?path=${encodeURIComponent(input.path.trim())}`,
    )

    return result.data
  })

  handleDesktopIpc(
    "desktop:search-workspace-files",
    async (_event, input: { directory: string; query: string }): Promise<AgentWorkspaceFileSearchResult[]> =>
      isSshWorkspaceUri(input.directory)
        ? requestRemoteWorkspaceSearch(input.directory, input.query)
        : searchWorkspaceFiles(input.directory, input.query),
  )

  handleDesktopIpc(
    "desktop:list-workspace-directory",
    async (_event, input: { directory: string; path?: string | null }): Promise<AgentWorkspaceDirectoryEntry[]> =>
      isSshWorkspaceUri(input.directory)
        ? requestRemoteWorkspaceDirectory(input.directory, input.path)
        : listWorkspaceDirectory(input.directory, input.path),
  )

  handleDesktopIpc(
    "desktop:read-workspace-file",
    async (_event, input: { directory: string; path: string }): Promise<AgentWorkspaceFileDocument> =>
      isSshWorkspaceUri(input.directory)
        ? requestRemoteWorkspaceFile(input.directory, input.path)
        : readWorkspaceFile(input.directory, input.path),
  )

  handleDesktopIpc("desktop:update-global-skill-file", async (_event, input: { path: string; content: string }) => {
    const result = await requestAgentJSON<AgentGlobalSkillFileDocument>("/api/skills/file", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        path: input.path,
        content: input.content,
      }),
    })

    return result.data
  })

  handleDesktopIpc("desktop:create-global-skill", async (_event, input: { name: string; parentDirectory?: string | null }) => {
    const result = await requestAgentJSON<{
      directory: string
      file: AgentGlobalSkillFileDocument
    }>("/api/skills", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: input.name,
        parentDirectory: input.parentDirectory,
      }),
    })

    return result.data
  })

  handleDesktopIpc("desktop:preview-global-skill-git-install", async (_event, input: { source: string; parentDirectory?: string | null }) => {
    const result = await requestAgentJSON<AgentSkillGitInstallPreview>("/api/skills/git/preview", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        source: input.source,
        parentDirectory: input.parentDirectory,
      }),
    })

    return result.data
  })

  handleDesktopIpc("desktop:install-global-skills-from-git", async (_event, input: { previewID: string; skillIDs: string[]; parentDirectory?: string | null }) => {
    const result = await requestAgentJSON<AgentSkillGitInstallResult>("/api/skills/git/install", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        previewID: input.previewID,
        skillIDs: input.skillIDs,
        parentDirectory: input.parentDirectory,
      }),
    })

    return result.data
  })

  handleDesktopIpc("desktop:install-global-skill-from-local-file", async (event, input?: { parentDirectory?: string | null }) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const options = {
      title: "Select SKILL.md",
      filters: [
        {
          name: "Skill Markdown",
          extensions: ["md"],
        },
      ],
      properties: ["openFile"] as Array<"openFile">,
    }
    const selection = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (selection.canceled) return null

    const sourcePath = selection.filePaths[0]
    if (!sourcePath) return null

    const result = await requestAgentJSON<AgentSkillGitInstallResult>("/api/skills/local/install", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        sourcePath,
        parentDirectory: input?.parentDirectory,
      }),
    })

    return result.data
  })

  handleDesktopIpc("desktop:rename-global-skill", async (_event, input: { directory: string; name: string }) => {
    const result = await requestAgentJSON<AgentGlobalSkillRenameResult>("/api/skills", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        directory: input.directory,
        name: input.name,
      }),
    })

    return result.data
  })

  handleDesktopIpc("desktop:delete-global-skill", async (_event, input: { directory: string }) => {
    const result = await requestAgentJSON<{ directory: string; removed: boolean }>(
      `/api/skills?directory=${encodeURIComponent(input.directory.trim())}`,
      {
        method: "DELETE",
      },
    )

    return result.data
  })

  handleDesktopIpc("desktop:create-global-skill-folder", async (_event, input: { name: string; parentDirectory?: string | null }) => {
    const result = await requestAgentJSON<AgentGlobalSkillFolderResult>("/api/skills/folders", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: input.name,
        parentDirectory: input.parentDirectory,
      }),
    })

    return result.data
  })

  handleDesktopIpc("desktop:rename-global-skill-folder", async (_event, input: { directory: string; name: string }) => {
    const result = await requestAgentJSON<AgentGlobalSkillFolderRenameResult>("/api/skills/folders", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        directory: input.directory,
        name: input.name,
      }),
    })

    return result.data
  })

  handleDesktopIpc("desktop:delete-global-skill-folder", async (_event, input: { directory: string }) => {
    const result = await requestAgentJSON<{ directory: string; removed: boolean }>(
      `/api/skills/folders?directory=${encodeURIComponent(input.directory.trim())}`,
      {
        method: "DELETE",
      },
    )

    return result.data
  })

  handleDesktopIpc("desktop:move-global-skill-directory", async (_event, input: { directory: string; parentDirectory?: string | null }) => {
    const result = await requestAgentJSON<AgentGlobalSkillMoveResult>("/api/skills/move", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        directory: input.directory,
        parentDirectory: input.parentDirectory,
      }),
    })

    return result.data
  })

  handleDesktopIpc("desktop:get-project-provider-catalog", async (_event, input: { projectID: string }) => {
    const projectID = input.projectID.trim()
    const result = await requestAgentJSON<AgentProviderCatalogItem[]>(
      `/api/projects/${encodeURIComponent(projectID)}/providers/catalog`,
    )

    return result.data
  })

  handleDesktopIpc("desktop:refresh-project-provider-catalog", async (_event, input: { projectID: string }) => {
    const projectID = input.projectID.trim()
    const result = await requestAgentJSON<AgentProviderCatalogItem[]>(
      `/api/projects/${encodeURIComponent(projectID)}/providers/catalog/refresh`,
      {
        method: "POST",
      },
    )

    return result.data
  })

  handleDesktopIpc("desktop:get-project-models", async (_event, input: { projectID: string }) => {
    const projectID = input.projectID.trim()
    const result = await requestAgentJSON<AgentProjectModelsResult>(`/api/projects/${encodeURIComponent(projectID)}/models`)

    return result.data
  })

  handleDesktopIpc("desktop:get-project-model-catalog", async (_event, input: { projectID: string }) => {
    const projectID = input.projectID.trim()
    const result = await requestAgentJSON<AgentModelCatalogResult>(
      `/api/projects/${encodeURIComponent(projectID)}/model-catalog`,
    )

    return result.data
  })

  handleDesktopIpc("desktop:get-session-models", async (_event, input: { sessionID: string }) => {
    const sessionID = input.sessionID.trim()
    const result = await requestAgentJSON<AgentProjectModelsResult>(`/api/sessions/${encodeURIComponent(sessionID)}/models`)

    return result.data
  })

  handleDesktopIpc(
    "desktop:update-project-provider",
    async (
      _event,
      input: {
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
      },
    ) => {
      const projectID = input.projectID.trim()
      const providerID = input.providerID.trim()
      const result = await requestAgentJSON<{
        provider: {
          id: string
          name: string
          available: boolean
          apiKeyConfigured: boolean
          baseURL?: string
        }
        selection: AgentProjectModelSelection
      }>(`/api/projects/${encodeURIComponent(projectID)}/providers/${encodeURIComponent(providerID)}`, {
        method: "PUT",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(input.provider),
      })

      return result.data
    },
  )

  handleDesktopIpc(
    "desktop:delete-project-provider",
    async (_event, input: { projectID: string; providerID: string }) => {
      const projectID = input.projectID.trim()
      const providerID = input.providerID.trim()
      const result = await requestAgentJSON<{
        providerID: string
        selection: AgentProjectModelSelection
      }>(`/api/projects/${encodeURIComponent(projectID)}/providers/${encodeURIComponent(providerID)}`, {
        method: "DELETE",
      })

      return result.data
    },
  )

  handleDesktopIpc(
    "desktop:update-project-model-selection",
    async (
      _event,
      input: {
        projectID: string
        model?: string | null
        small_model?: string | null
        reasoning_effort?: AgentProjectModelSelection["reasoning_effort"] | null
      },
    ) => {
      const projectID = input.projectID.trim()
      const result = await requestAgentJSON<AgentProjectModelSelection>(
        `/api/projects/${encodeURIComponent(projectID)}/model-selection`,
        {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: input.model,
          small_model: input.small_model,
          ...(input.reasoning_effort !== undefined ? { reasoning_effort: input.reasoning_effort } : {}),
        }),
      },
      )

      return result.data
    },
  )

  handleDesktopIpc(
    "desktop:update-session-model-selection",
    async (
      _event,
      input: {
        sessionID: string
        model?: string | null
        small_model?: string | null
        reasoning_effort?: AgentProjectModelSelection["reasoning_effort"] | null
      },
    ) => {
      const sessionID = input.sessionID.trim()
      const result = await requestAgentJSON<AgentProjectModelSelection>(
        `/api/sessions/${encodeURIComponent(sessionID)}/model-selection`,
        {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: input.model,
            small_model: input.small_model,
            ...(input.reasoning_effort !== undefined ? { reasoning_effort: input.reasoning_effort } : {}),
          }),
        },
      )

      return result.data
    },
  )

  handleDesktopIpc("desktop:get-project-skills", async (_event, input: { projectID: string }) => {
    const projectID = input.projectID.trim()
    const result = await requestAgentJSON<AgentSkillInfo[]>(
      `/api/projects/${encodeURIComponent(projectID)}/skills`,
    )

    return result.data
  })

  handleDesktopIpc("desktop:get-project-skill-selection", async (_event, input: { projectID: string }) => {
    const projectID = input.projectID.trim()
    const result = await requestAgentJSON<AgentProjectSkillSelection>(
      `/api/projects/${encodeURIComponent(projectID)}/skills/selection`,
    )

    return result.data
  })

  handleDesktopIpc(
    "desktop:update-project-skill-selection",
    async (_event, input: { projectID: string; skillIDs: string[] }) => {
      const projectID = input.projectID.trim()
      const result = await requestAgentJSON<AgentProjectSkillSelection>(
        `/api/projects/${encodeURIComponent(projectID)}/skills/selection`,
        {
          method: "PUT",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            skillIDs: input.skillIDs,
          }),
        },
      )

      return result.data
    },
  )

  handleDesktopIpc("desktop:get-project-plugins", async (_event, input: { projectID: string }) => {
    const projectID = input.projectID.trim()
    const result = await requestAgentJSON<AgentInstalledPlugin[]>(
      `/api/projects/${encodeURIComponent(projectID)}/plugins`,
    )

    return result.data
  })

  handleDesktopIpc("desktop:get-project-plugin-selection", async (_event, input: { projectID: string }) => {
    const projectID = input.projectID.trim()
    const result = await requestAgentJSON<AgentProjectPluginSelection>(
      `/api/projects/${encodeURIComponent(projectID)}/plugins/selection`,
    )

    return result.data
  })

  handleDesktopIpc(
    "desktop:update-project-plugin-selection",
    async (_event, input: { projectID: string; pluginIDs: string[] }) => {
      const projectID = input.projectID.trim()
      const result = await requestAgentJSON<AgentProjectPluginSelection>(
        `/api/projects/${encodeURIComponent(projectID)}/plugins/selection`,
        {
          method: "PUT",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            pluginIDs: input.pluginIDs,
          }),
        },
      )

      return result.data
    },
  )

  handleDesktopIpc("desktop:get-project-mcp-selection", async (_event, input: { projectID: string }) => {
    const projectID = input.projectID.trim()
    const result = await requestAgentJSON<AgentProjectMcpSelection>(
      `/api/projects/${encodeURIComponent(projectID)}/mcp/selection`,
    )

    return result.data
  })

  handleDesktopIpc(
    "desktop:update-project-mcp-selection",
    async (_event, input: { projectID: string; serverIDs: string[] }) => {
      const projectID = input.projectID.trim()
      const result = await requestAgentJSON<AgentProjectMcpSelection>(
        `/api/projects/${encodeURIComponent(projectID)}/mcp/selection`,
        {
          method: "PUT",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            serverIDs: input.serverIDs,
          }),
        },
      )

      return result.data
    },
  )

  handleDesktopIpc("desktop:get-project-mcp-servers", async (_event, input: { projectID: string }) => {
    const projectID = input.projectID.trim()
    const result = await requestAgentJSON<AgentMcpServerSummary[]>(
      `/api/projects/${encodeURIComponent(projectID)}/mcp/servers`,
    )

    return result.data
  })

  handleDesktopIpc(
    "desktop:get-project-mcp-server-diagnostic",
    async (_event, input: { projectID: string; serverID: string }) => {
      const projectID = input.projectID.trim()
      const serverID = input.serverID.trim()
      const result = await requestAgentJSON<AgentMcpServerDiagnostic>(
        `/api/projects/${encodeURIComponent(projectID)}/mcp/servers/${encodeURIComponent(serverID)}/diagnostic`,
      )

      return result.data
    },
  )

  handleDesktopIpc(
    "desktop:update-project-mcp-server",
    async (
      _event,
      input: {
        projectID: string
        serverID: string
        server: McpServerInput
      },
    ) => {
      const projectID = input.projectID.trim()
      const serverID = input.serverID.trim()
      const result = await requestAgentJSON<AgentMcpServerSummary>(
        `/api/projects/${encodeURIComponent(projectID)}/mcp/servers/${encodeURIComponent(serverID)}`,
        {
          method: "PUT",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify(input.server),
        },
      )

      return result.data
    },
  )

  handleDesktopIpc(
    "desktop:delete-project-mcp-server",
    async (_event, input: { projectID: string; serverID: string }) => {
      const projectID = input.projectID.trim()
      const serverID = input.serverID.trim()
      const result = await requestAgentJSON<{ serverID: string; removed: boolean }>(
        `/api/projects/${encodeURIComponent(projectID)}/mcp/servers/${encodeURIComponent(serverID)}`,
        {
          method: "DELETE",
        },
      )

      return result.data
    },
  )

  handleDesktopIpc(
    "desktop:agent-session-load-history",
    async (_event, input: {
      backendSessionID: string
      view?: "active" | "all" | "branch"
      headMessageID?: string
    }) => {
      const sessionID = input.backendSessionID.trim()
      const searchParams = new URLSearchParams()
      if (input.view && input.view !== "active") {
        searchParams.set("view", input.view)
      }
      if (input.view === "branch" && input.headMessageID?.trim()) {
        searchParams.set("headMessageID", input.headMessageID.trim())
      }
      const search = searchParams.size > 0 ? `?${searchParams.toString()}` : ""
      const result = await requestAgentJSON<AgentSessionHistoryMessage[]>(
        `/api/sessions/${encodeURIComponent(sessionID)}/messages${search}`,
      )

      return result.data
    },
  )

  handleDesktopIpc(
    "desktop:agent-session-compact",
    async (_event, input: { backendSessionID: string }) => {
      const sessionID = input.backendSessionID.trim()
      const result = await requestAgentJSON<AgentSessionCompactResult>(
        `/api/sessions/${encodeURIComponent(sessionID)}/compact`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        },
      )

      return result.data
    },
  )

  handleDesktopIpc(
    "desktop:update-session-active-message",
    async (_event, input: { sessionID: string; messageID: string }) => {
      const sessionID = input.sessionID.trim()
      const result = await requestAgentJSON<AgentWorkspaceSession>(
        `/api/sessions/${encodeURIComponent(sessionID)}/active-message`,
        {
          method: "PATCH",
          body: JSON.stringify({
            messageID: input.messageID.trim(),
          }),
        },
      )

      return result.data
    },
  )

  handleDesktopIpc(
    "desktop:rollback-session-to-checkpoint",
    async (_event, input: DesktopSessionRollbackInput) => {
      const sessionID = input.sessionID.trim()
      const result = await requestAgentJSON<DesktopSessionRollbackResult>(
        `/api/sessions/${encodeURIComponent(sessionID)}/rollback`,
        {
          method: "POST",
          body: JSON.stringify({
            targetMessageID: input.targetMessageID.trim(),
            reason: input.reason.trim(),
            correctivePrompt: input.correctivePrompt.trim(),
            restoreWorkspace: input.restoreWorkspace === true,
          }),
        },
      )

      return result.data
    },
  )

  handleDesktopIpc(
    "desktop:agent-session-load-permission-requests",
    async (_event, input: { backendSessionID: string }) => {
      const sessionID = input.backendSessionID.trim()
      const result = await requestAgentJSON<AgentPermissionRequest[]>(
        `/api/permissions/requests?status=pending&view=prompt&sessionID=${encodeURIComponent(sessionID)}`,
      )

      return result.data
    },
  )

  handleDesktopIpc(
    "desktop:agent-session-respond-permission-request",
    async (
      _event,
      input: PermissionResolveInput,
    ) => {
      const requestID = input.requestID.trim()
      const result = await requestAgentJSON<AgentPermissionResolveResult>(
        `/api/permissions/requests/${encodeURIComponent(requestID)}/resolve`,
        {
          method: "POST",
          body: JSON.stringify({
            decision: input.decision,
            note: input.note,
            resume: input.resume,
          }),
        },
      )

      return result.data
    },
  )

  function buildAgentSessionTurnRequestBody(input: AgentSessionTurnRequestInput) {
    return {
      text: input.text,
      displayText: input.displayText,
      parentMessageID: input.parentMessageID,
      clientTurnID: input.clientTurnID,
      executionID: input.executionID,
      threadTarget: input.threadTarget,
      quotes: input.quotes,
      attachments: input.attachments,
      questionAnswer: input.questionAnswer,
      concurrentInputMode: input.concurrentInputMode,
      reasoningEffort: input.reasoningEffort,
      model: input.model,
      system: input.system,
      agent: input.agent,
      skills: input.skills,
      turnMcpServerIDs: input.turnMcpServerIDs,
      turnToolModuleIDs: input.turnToolModuleIDs,
    }
  }

  async function streamAgentSessionTurnToRenderer(
    target: Electron.WebContents,
    input: Pick<AgentSessionTurnRequestInput, "backendSessionID" | "clientTurnID"> & Partial<AgentSessionTurnRequestInput>,
    routePath: string,
  ) {
    const clientTurnID = input.clientTurnID.trim()
    const backendSessionID = input.backendSessionID.trim()
    const request: ActiveAgentSessionRequest = {
      backendSessionID,
      backendExecutionID:
        input.threadTarget?.kind === "detached-branch"
          ? input.executionID?.trim() || clientTurnID
          : "active-thread",
      cancelRequested: false,
      clientTurnID,
      controller: new AbortController(),
    }
    activeAgentSessionRequests.set(agentSessionRequestKey(target.id, clientTurnID), request)
    const abortOnTargetDestroyed = () => {
      request.cancelRequested = true
      request.controller.abort()
    }
    target.once("destroyed", abortOnTargetDestroyed)

    let requestId: string | undefined

    try {
      const response = await fetch(resolveAgentURL(routePath), {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(buildAgentSessionTurnRequestBody({
          ...input,
          clientTurnID,
          backendSessionID,
        })),
        signal: request.controller.signal,
      })

      if (!response.ok) {
        const envelope = (await response.json().catch(() => null)) as AgentEnvelope<unknown> | null
        throw new Error(envelope?.error?.message || `Agent session stream failed (${response.status})`)
      }

      requestId = response.headers.get("x-request-id") ?? undefined

      await readAgentSSEStream(response, (item) => {
        void agentCompletionNotifications.handleSessionStreamEvent({
          data: item.data,
          dedupKey: clientTurnID,
          id: item.id,
          event: item.event,
          target,
        })

        sendDesktopIpcEvent(target, AGENT_SESSION_EVENT_CHANNEL, {
          kind: "stream",
          source: "request",
          backendSessionID,
          clientTurnID,
          id: item.id,
          event: item.event,
          data: item.data,
          receivedAt: Date.now(),
        } satisfies AgentSessionBridgeIPCEvent)
      })
    } catch (error) {
      if (request.cancelRequested && isAbortError(error)) {
        return {
          clientTurnID,
          requestId,
        }
      }

      sendDesktopIpcEvent(target, AGENT_SESSION_EVENT_CHANNEL, {
        kind: "stream",
        source: "request",
        backendSessionID,
        clientTurnID,
        event: "error",
        data: {
          sessionID: backendSessionID,
          message: error instanceof Error ? error.message : String(error),
        },
          receivedAt: Date.now(),
        } satisfies AgentSessionBridgeIPCEvent)
    } finally {
      target.off("destroyed", abortOnTargetDestroyed)
      removeActiveAgentSessionRequest(target.id, clientTurnID, request)
    }

    return {
      clientTurnID,
      requestId,
    }
  }

  handleDesktopIpc(
    "desktop:agent-session-send-turn",
    async (_event, input: AgentSessionTurnRequestInput) =>
      streamAgentSessionTurnToRenderer(
        _event.sender,
        input,
        `/api/sessions/${encodeURIComponent(input.backendSessionID.trim())}/messages/stream`,
      ),
  )

  handleDesktopIpc(
    "desktop:agent-session-resume-turn",
    async (_event, input: { clientTurnID: string; backendSessionID: string }) =>
      streamAgentSessionTurnToRenderer(
        _event.sender,
        {
          clientTurnID: input.clientTurnID,
          backendSessionID: input.backendSessionID,
        },
        `/api/sessions/${encodeURIComponent(input.backendSessionID.trim())}/resume/stream`,
      ),
  )

  async function interruptAgentSession(
    event: IpcMainInvokeEvent,
    input: {
      backendSessionID: string
      clientTurnID?: string
      executionID?: string
      reason?: "user-interrupt"
    },
  ): Promise<DesktopIpcOutput<"desktop:agent-session-interrupt">> {
    const activeRequest = input.clientTurnID
      ? activeAgentSessionRequests.get(
          agentSessionRequestKey(event.sender.id, input.clientTurnID.trim()),
        )
      : undefined
    return interruptAgentSessionBackendFirst({
      backendSessionID: input.backendSessionID,
      clientTurnID: input.clientTurnID,
      backendExecutionID: input.executionID?.trim() || activeRequest?.backendExecutionID,
      webContentsID: event.sender.id,
      requestBackendCancel: async (backendSessionID, executionID) => {
        const result = await requestAgentJSON<AgentSessionBackendCancelResult>(
          `/api/sessions/${encodeURIComponent(backendSessionID)}/cancel`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
            },
            body: JSON.stringify({
              cancelQueued: true,
              reason: "user",
              executionID,
            }),
          },
        )
        return result.data
      },
    })
  }

  handleDesktopIpc(
    "desktop:agent-session-interrupt",
    async (event, input: {
      backendSessionID: string
      clientTurnID?: string
      executionID?: string
      reason?: "user-interrupt"
    }) =>
      interruptAgentSession(event, input),
  )

  handleDesktopIpc(
    "desktop:agent-session-cancel-turn",
    async (event, input: { clientTurnID: string; backendSessionID: string; executionID?: string }) => {
      const clientTurnID = input.clientTurnID.trim()
      const backendSessionID = input.backendSessionID.trim()
      const result = await interruptAgentSession(event, {
        backendSessionID,
        clientTurnID,
        executionID: input.executionID,
        reason: "user-interrupt",
      })

      return {
        clientTurnID,
        backendSessionID,
        localRequestAborted: result.localRequestsAborted > 0,
        backendCancelled: result.backendCancelled,
        ...(result.backendCancelError ? { backendCancelError: result.backendCancelError } : {}),
      }
    },
  )

  handleDesktopIpc(
    "desktop:agent-session-abort-turn",
    async (event, input: { clientTurnID: string; backendSessionID: string }) => {
      const clientTurnID = input.clientTurnID.trim()
      const backendSessionID = input.backendSessionID.trim()
      const localRequestsAborted = abortActiveAgentSessionRequestsInMap(activeAgentSessionRequests, {
        backendSessionID,
        clientTurnID,
        webContentsID: event.sender.id,
      })

      return {
        clientTurnID,
        backendSessionID,
        localRequestAborted: localRequestsAborted > 0,
      }
    },
  )

  handleDesktopIpc(
    "desktop:agent-session-answer-question",
    async (_event, input: {
      backendSessionID: string
      questionID: string
      selectedOptions?: string[]
      freeformText?: string
    }) => {
      const backendSessionID = input.backendSessionID.trim()
      const result = await requestAgentJSON<{
        sessionID: string
        questionID: string
        selectedOptions?: string[]
        freeformText?: string
        answerText: string
        answeredAt: number
      }>(
        `/api/sessions/${encodeURIComponent(backendSessionID)}/questions/answer`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            questionID: input.questionID,
            selectedOptions: input.selectedOptions,
            freeformText: input.freeformText,
          }),
        },
      )

      return result.data
    },
  )

  handleDesktopIpc(
    "desktop:agent-session-subscribe",
    async (event, input: { uiSessionID?: string; backendSessionID: string }) => {
      const backendSessionID = input.backendSessionID.trim()
      const target = event.sender
      const existing = getSessionStreamSubscription(target.id, backendSessionID)
      if (existing) {
        return {
          backendSessionID,
          lastEventID: existing.lastEventID,
        }
      }

      const subscription = createSessionStreamSubscription(target, backendSessionID, {
        uiSessionID: input.uiSessionID,
      })
      sessionStreamSubscriptions.set(
        sessionStreamSubscriptionKey(target.id, backendSessionID),
        subscription,
      )

      if (!sessionStreamCleanupTargets.has(target.id)) {
        sessionStreamCleanupTargets.add(target.id)
        target.once("destroyed", () => {
          disposeSessionStreamSubscriptionsForWebContents(sessionStreamSubscriptions, target.id)
          sessionStreamCleanupTargets.delete(target.id)
        })
      }

      void subscription.start()

      return {
        backendSessionID,
        lastEventID: subscription.lastEventID,
      }
    },
  )

  handleDesktopIpc(
    "desktop:agent-session-unsubscribe",
    async (event, input: { backendSessionID: string }) => ({
      backendSessionID: input.backendSessionID.trim(),
      removed: removeSessionStreamSubscription(event.sender.id, input.backendSessionID.trim()),
    }),
  )

}

export const internal = {
  abortActiveAgentSessionRequestsInMap,
  cancelAnyboxRechargeOrder,
  cancelAnyboxSubscriptionOrder,
  createAnyboxRechargeOrder,
  capturePreviewScreenshotFromWindow,
  copyImageDataUrlToClipboard,
  discardSessionBagSubmission,
  downloadSkillRegistrySkill,
  disposeSessionStreamSubscriptionsForWebContents,
  getSessionBackgroundProcesses,
  getSessionPty,
  getSessionTraceExport,
  getAnyboxSubscriptionOverview,
  getAnyboxRechargeOrder,
  getToolPermissionMode,
  interruptAgentSessionBackendFirst,
  isSessionStreamSubscriptionKeyForWebContents,
  preservePluginAgentErrorCode,
  prepareSessionBagSubmission,
  previewDownloadedRegistrySkillUpdate,
  readPreviewText,
  resolvePreviewTarget,
  saveComposerPastedImages,
  saveImageDataUrlToFolder,
  saveSessionTraceExport,
  saveSessionTraceExportDirectory,
  saveSessionTraceExportRawDirectory,
  saveSessionTraceExportToProject,
  setDownloadedRegistrySkillEnabled,
  translatePromptPreset,
  terminateAllSessionBackgroundProcesses,
  terminateSessionBackgroundProcess,
  updateAgentSessionPinned,
  updateAgentSessionTitle,
  updatePromptPresetSelection,
  updateToolPermissionMode,
  uploadSessionBagSubmission,
  forkDownloadedRegistrySkill,
}
