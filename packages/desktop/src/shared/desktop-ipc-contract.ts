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
  AgentBuiltinToolModuleSummary,
  AgentBuiltinToolSummary,
  AgentBuiltinToolsPayload,
  AgentConfig,
  AgentConnectorDefinition,
  AgentConnectorStatus,
  AgentFolderWorkspace,
  AgentEnvironmentActionStartResult,
  AgentEnvironmentCandidate,
  AgentEnvironmentDefinition,
  AgentEnvironmentIPCEvent,
  AgentEnvironmentListResult,
  AgentEnvironmentPreference,
  AgentEnvironmentRunRecord,
  AgentGlobalSkillFileDocument,
  AgentGlobalSkillFolderRenameResult,
  AgentGlobalSkillFolderResult,
  AgentGlobalSkillMoveResult,
  AgentGlobalSkillRenameResult,
  AgentGlobalSkillTree,
  AgentInstalledGlobalSkill,
  AgentMcpServerDiagnostic,
  AgentMcpServerSummary,
  AgentModelCatalogResult,
  AgentInstalledPlugin,
  AgentPluginCatalogItem,
  AgentPluginConnectorStatus,
  AgentPluginDeleteResult,
  AgentPluginImportURLInput,
  AgentPluginInstallInput,
  AgentPluginMcpControlsInput,
  AgentPluginMcpControlsResult,
  AgentPluginSkillDirectory,
  AgentPluginSkillFile,
  AgentPluginUpdateInput,
  AgentProjectDeleteResult,
  AgentProjectMcpSelection,
  AgentProjectModelSelection,
  AgentProjectModelsResult,
  AgentProjectPluginSelection,
  AgentProjectSkillSelection,
  AgentProjectWorkspace,
  AgentPromptPresetDocument,
  AgentPromptPresetSelection,
  AgentPromptPresetSummary,
  AgentPromptUrlInstallCandidate,
  AgentPromptUrlInstallPreview,
  AgentPromptUrlInstallResult,
  AgentPreparedWorktreeResult,
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
  AgentSessionQuestionAnswerInput,
  AgentSessionQuestionAnswerResult,
  AgentSessionRuntimeDebugSnapshot,
  AgentSessionTaskListView,
  AgentSessionTraceExport,
  AgentSessionTurnRequestInput,
  AgentSessionWorkflowUpdateInput,
  AgentSkillGitInstallPreview,
  AgentSkillInfo,
  AgentSkillInstallCandidate,
  AgentSkillGitInstallResult,
  AgentToolPermissionModePayload,
  AgentWorkspaceFileDocument,
  AgentWorkspaceDirectoryEntry,
  AgentWorkspaceFileSearchResult,
  AgentSshConnectionTestResult,
  AgentSshDirectoryEntry,
  AgentSshDirectoryListing,
  AgentSshProfile,
  AgentSshProfileInput,
  AgentWorkspaceSession,
  AgentWorktreeRecord,
  MenuAnchor,
  MenuKey,
  PtyTransportIPCEvent,
  WindowAction,
} from "../main/types"
import type {
  DesktopOpenCinemaProjectInput,
  DesktopOpenCinemaProjectResult,
  DesktopOpenPathInput,
  DesktopOpenPathResult,
  DeletedRegistrySkillResult,
  DownloadedRegistrySkill,
  DownloadedRegistrySkillSelectionResult,
  DesktopStorageUsageSnapshot,
  DesktopStorageOptimizeResult,
  RegistryFile,
  RegistryFileContent,
  RegistryFileRef,
  RegistryProviderDescriptor,
  RegistrySearchInput,
  RegistrySearchPage,
  RegistrySecuritySnapshot,
  RegistrySkillDetail,
  RegistrySkillRef,
  RegistryUpdatePreview,
  RegistryVersion,
  RegistryVersionRef,
  ReasoningEffort,
} from "@anybox/shared"

import type {
  CinemaProviderAuthState,
  CinemaProviderWorkflowCatalog,
  CinemaVideoProvider,
} from "@anybox/shared/cinema"
import type { AppearanceConfigDocument, AppearanceConfigSnapshot, AppearanceRuntimeState } from "./appearance"
import type {
  AppearanceThemeDuplicateInput,
  AppearanceThemeLibrarySnapshot,
  AppearanceThemeMutationResult,
  AppearanceThemeRenameInput,
  AppearanceThemeSaveInput,
} from "./appearance-themes"
import type { LocaleConfigDocument, LocaleConfigSnapshot } from "./locale"
import type {
  PermissionRequestPrompt,
  PermissionResolveInput,
  PermissionResolveResult,
} from "./permission"
import {
  SEMANTIC_TOKEN_INSPECTOR_EVENT_CHANNEL,
  type SemanticTokenInspectorEvent,
  type SemanticTokenInspectorInspectInput,
  type SemanticTokenInspectorInspectResult,
  type SemanticTokenInspectorStartResult,
  type SemanticTokenInspectorStopResult,
} from "./semantic-token-inspector"
import type {
  CommitSemanticTokenAuthoringCommitInput,
  CommitSemanticTokenAuthoringCommitResult,
  DiscardSemanticTokenAuthoringCommitInput,
  DiscardSemanticTokenAuthoringCommitResult,
  PrepareSemanticTokenAuthoringCommitInput,
  PrepareSemanticTokenAuthoringCommitResult,
} from "./semantic-token-authoring"

export const DESKTOP_AGENT_SESSION_EVENT_CHANNEL = "desktop:agent-session-event"
export const DESKTOP_AUTOMATION_EVENT_CHANNEL = "desktop:automation-event"
export const DESKTOP_ENVIRONMENT_EVENT_CHANNEL = "desktop:environment-event"
export const DESKTOP_MOBILE_BRIDGE_EVENT_CHANNEL = "desktop:mobile-bridge-event"
export const DESKTOP_WORKSPACE_FILE_CHANGE_EVENT_CHANNEL = "desktop:workspace-file-change"
export const DESKTOP_PTY_EVENT_CHANNEL = "desktop:pty-event"
export const DESKTOP_WINDOW_STATE_EVENT_CHANNEL = "desktop:window-state-changed"
export const DESKTOP_WORKBENCH_STATE_EVENT_CHANNEL = "desktop:workbench-state-changed"
export const DESKTOP_APP_UPDATE_STATE_EVENT_CHANNEL = "desktop:app-update-state-changed"
export const DESKTOP_APPEARANCE_STATE_EVENT_CHANNEL = "desktop:appearance-state-changed"
export const DESKTOP_SEMANTIC_TOKEN_INSPECTOR_EVENT_CHANNEL = SEMANTIC_TOKEN_INSPECTOR_EVENT_CHANNEL

export type {
  SemanticTokenInspection,
  SemanticTokenInspectorBreadcrumb,
  SemanticTokenInspectorConfidence,
  SemanticTokenInspectorDiagnosis,
  SemanticTokenInspectorEvent,
  SemanticTokenInspectorInspectInput,
  SemanticTokenInspectorInspectResult,
  SemanticTokenInspectorPropertyResult,
  SemanticTokenInspectorResolvedColorMode,
  SemanticTokenInspectorSeverity,
  SemanticTokenInspectorStartResult,
  SemanticTokenInspectorStopResult,
  SemanticTokenInspectorTarget,
  SemanticTokenInspectorTokenNode,
} from "./semantic-token-inspector"
export type {
  CommitSemanticTokenAuthoringCommitInput,
  CommitSemanticTokenAuthoringCommitResult,
  DiscardSemanticTokenAuthoringCommitInput,
  DiscardSemanticTokenAuthoringCommitResult,
  PrepareSemanticTokenAuthoringCommitInput,
  PrepareSemanticTokenAuthoringCommitResult,
  SemanticTokenAuthoringCapability,
  SemanticTokenAuthoringDraft,
  SemanticTokenAuthoringOperation,
  SemanticTokenAuthoringReviewFile,
  SemanticTokenAuthoringReviewSummary,
  SemanticTokenBindingEdit,
  SemanticTokenColorChannelResult,
  SemanticTokenCreation,
  SemanticTokenThemeValueEdit,
} from "./semantic-token-authoring"

export interface DesktopPluginCatalogInput {
  freshness?: "cached" | "fresh"
}

export type DesktopRegistrySkillUpdatePreview = RegistryUpdatePreview

export type DesktopRegistrySkillMutationResult = DownloadedRegistrySkillSelectionResult

export type DesktopRegistrySkillDeleteResult = DeletedRegistrySkillResult

export interface DesktopRegistrySkillForkResult {
  id: string
  sourceSkillID: string
  directory: string
  filePath: string
}

export type {
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
  AgentBuiltinToolModuleSummary,
  AgentBuiltinToolSummary,
  AgentBuiltinToolsPayload,
  AgentConfig,
  AgentConnectorDefinition,
  AgentConnectorStatus,
  AgentFolderWorkspace,
  AgentEnvironmentActionStartResult,
  AgentEnvironmentCandidate,
  AgentEnvironmentDefinition,
  AgentEnvironmentIPCEvent,
  AgentEnvironmentListResult,
  AgentEnvironmentPreference,
  AgentEnvironmentRunRecord,
  AgentGlobalSkillFileDocument,
  AgentGlobalSkillFolderRenameResult,
  AgentGlobalSkillFolderResult,
  AgentGlobalSkillMoveResult,
  AgentGlobalSkillRenameResult,
  AgentGlobalSkillTree,
  AgentInstalledGlobalSkill,
  AgentMcpServerDiagnostic,
  AgentMcpServerSummary,
  AgentModelCatalogResult,
  AgentInstalledPlugin,
  AgentPluginCatalogItem,
  AgentPluginConnectorStatus,
  AgentPluginDeleteResult,
  AgentPluginInstallInput,
  AgentPluginMcpControlsInput,
  AgentPluginMcpControlsResult,
  AgentPluginSkillDirectory,
  AgentPluginSkillFile,
  AgentPluginUpdateInput,
  AgentProjectDeleteResult,
  AgentProjectMcpSelection,
  AgentProjectModelSelection,
  AgentProjectModelsResult,
  AgentProjectPluginSelection,
  AgentProjectSkillSelection,
  AgentProjectWorkspace,
  AgentPromptPresetDocument,
  AgentPromptPresetSelection,
  AgentPromptPresetSummary,
  AgentPromptUrlInstallCandidate,
  AgentPromptUrlInstallPreview,
  AgentPromptUrlInstallResult,
  AgentPreparedWorktreeResult,
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
  AgentSessionDiffSummary,
  AgentSessionHistoryMessage,
  AgentSessionQuestionAnswerInput,
  AgentSessionQuestionAnswerResult,
  AgentSessionRuntimeDebugSnapshot,
  AgentSessionTraceExport,
  AgentSessionTurnRequestInput,
  AgentSessionWorkflowUpdateInput,
  AgentSkillGitInstallPreview,
  AgentSkillInfo,
  AgentSkillInstallCandidate,
  AgentSkillGitInstallResult,
  AgentToolPermissionModePayload,
  AgentWorkspaceFileDocument,
  AgentWorkspaceDirectoryEntry,
  AgentWorkspaceFileSearchResult,
  AgentSshConnectionTestResult,
  AgentSshDirectoryEntry,
  AgentSshDirectoryListing,
  AgentSshProfile,
  AgentSshProfileInput,
  AgentWorkspaceSession,
  AgentWorktreeRecord,
  AppearanceConfigDocument,
  AppearanceConfigSnapshot,
  LocaleConfigDocument,
  LocaleConfigSnapshot,
  MenuAnchor,
  MenuKey,
  PermissionRequestPrompt,
  PermissionResolveInput,
  PermissionResolveResult,
  WindowAction
}

export type {
  AppearanceTheme,
  AppearanceThemeDocument,
  AppearanceThemeDuplicateInput,
  AppearanceThemeLibrarySnapshot,
  AppearanceThemeMutationResult,
  AppearanceThemePreset,
  AppearanceThemeRenameInput,
  AppearanceThemeSaveInput,
  AppearanceThemeSource,
} from "./appearance-themes"

export type AgentSessionSummary = AgentWorkspaceSession
export type ExternalEditorSummary = {
  id: string
  label: string
  executablePath: string
  iconPath?: string
  iconDataUrl?: string
}
export type GitActionResult = {
  directory: string
  root: string
  branch: string | null
  stdout: string
  stderr: string
  summary: string
  url?: string
}
export type GitCapabilityState = {
  enabled: boolean
  reason?: string
}
export type GitCapabilities = {
  directory: string
  root: string | null
  branch: string | null
  defaultBranch: string | null
  isGitRepo: boolean
  canCommit: GitCapabilityState
  canStageAllCommit: GitCapabilityState
  canPush: GitCapabilityState
  canCreatePullRequest: GitCapabilityState
  canCreateBranch: GitCapabilityState
}
export type GitGetCapabilitiesInput = {
  projectID: string
  directory: string
  includePullRequestRemoteCheck?: boolean
}
export type GitBranchSummary = {
  name: string
  kind: "local" | "remote"
  current: boolean
}
export type WorkspaceDiffFileRestoreResult = {
  directory: string
  file: string
}
export type WorkspaceDiffPatchReverseApplyInput = {
  directory: string
  diffs: Array<{
    file: string
    patch?: string
  }>
}
export type WorkspaceDiffPatchReverseApplyResult = {
  directory: string
  restored: Array<{ file: string }>
  failed: Array<{ file: string; message: string }>
}
export type McpServerSummary = AgentMcpServerSummary
export type McpServerDiagnostic = AgentMcpServerDiagnostic
export type McpServerInput = AgentMcpServerSummary extends infer Server
  ? Server extends unknown
    ? Omit<Server, "id" | "owner">
    : never
  : never
export type ProjectMcpSelection = AgentProjectMcpSelection
export type ProjectSkillSelection = AgentProjectSkillSelection
export type ProjectPluginSelection = AgentProjectPluginSelection
export type ConnectorDefinition = AgentConnectorDefinition
export type ConnectorStatus = AgentConnectorStatus
export type PluginCatalogItem = AgentPluginCatalogItem
export type InstalledPlugin = AgentInstalledPlugin
export type PluginConnectorStatus = AgentPluginConnectorStatus
export type PluginInstallInput = AgentPluginInstallInput
export type PluginImportURLInput = AgentPluginImportURLInput
export type PluginUpdateInput = AgentPluginUpdateInput
export type PluginDeleteResult = AgentPluginDeleteResult
export type PtyIPCEvent = PtyTransportIPCEvent
export type PtySessionInfo = AgentPtySessionInfo
export type SkillInfo = AgentSkillInfo
export type SkillInstallCandidate = AgentSkillInstallCandidate
export type SkillGitInstallPreview = AgentSkillGitInstallPreview
export type InstalledGlobalSkill = AgentInstalledGlobalSkill
export type SkillGitInstallResult = AgentSkillGitInstallResult
export type WorkspaceFileChangeIPCEvent = {
  directory: string
  paths: string[]
}
export type MobileBridgeDesktopEvent = {
  type: "workspace.updated" | "session.created" | "session.updated" | "approval.updated"
  source: "mobile"
  generatedAt: number
  workspaceID?: string
  directory?: string
  sessionID?: string
  approvalID?: string
}
export type WorkspaceFileDocument = AgentWorkspaceFileDocument
export type WorkspaceDirectoryEntry = AgentWorkspaceDirectoryEntry
export type WorkspaceFileSearchResult = AgentWorkspaceFileSearchResult
export type GlobalSkillFileDocument = AgentGlobalSkillFileDocument
export type GlobalSkillTree = AgentGlobalSkillTree
export type PromptPresetDocument = AgentPromptPresetDocument
export type PromptPresetSelection = AgentPromptPresetSelection
export type PromptPresetSummary = AgentPromptPresetSummary
export type PromptTranslationLanguageID =
  | "en"
  | "zh-Hans"
  | "zh-Hant"
  | "es"
  | "fr"
  | "de"
  | "pt"
  | "it"
  | "ja"
  | "ko"
  | "nl"
  | "ru"
export interface PromptPresetTranslationInput {
  sourcePresetID?: string
  sourceLabel: string
  content: string
  languageID: PromptTranslationLanguageID
  model: string
}
export type PromptUrlInstallCandidate = AgentPromptUrlInstallCandidate
export type PromptUrlInstallPreview = AgentPromptUrlInstallPreview
export type PromptUrlInstallResult = AgentPromptUrlInstallResult
export type BuiltinToolSummary = AgentBuiltinToolSummary
export type BuiltinToolModuleSummary = AgentBuiltinToolModuleSummary
export type BuiltinToolSelection = AgentBuiltinToolSelection
export type BuiltinToolsPayload = AgentBuiltinToolsPayload
export type ToolPermissionModePayload = AgentToolPermissionModePayload

export interface DesktopInfo {
  platform: string
  electron: string
  chrome: string
  node: string
}

export interface DesktopAppUpdateSettings {
  version: string
  automaticUpdates: boolean
  updateChecksSupported: boolean
}

export type DesktopAppUpdatePhase =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "downloaded"
  | "up-to-date"
  | "error"
  | "unsupported"

export interface DesktopAppUpdateState extends DesktopAppUpdateSettings {
  phase: DesktopAppUpdatePhase
  latestVersion: string | null
  downloadPercent: number | null
  downloadTransferredBytes: number | null
  downloadTotalBytes: number | null
  downloadBytesPerSecond: number | null
  error: string | null
  lastCheckedAt: number | null
  releaseNotes: string | null
}

export interface DesktopAppUpdateCheckResult {
  ok: boolean
  skipped?: boolean
  reason?: string
  error?: string
  state?: DesktopAppUpdateState
}

export interface DesktopAppUpdateInstallResult {
  ok: boolean
  reason?: string
}

export interface DesktopRunningSessionStatus {
  running: boolean
  count: number
  sessionIDs: string[]
  checkedAt: number
}

export interface DesktopStoragePaths {
  appData: string
  agentRoot: string
  agentData: string
  agentCache: string
  installedPlugins: string
  pluginRegistryCache: string
  pluginInstallTemp: string
}

export type DesktopSubscriptionPaymentProvider = "alipay" | "wechat_pay"

export interface DesktopSubscriptionPlan {
  planId: string
  code: string
  name: string
  planVersionId: string
  version: number
  currency: string
  priceCents: number
  billingInterval: string
  weeklyLimitMicrocents: number
  terms: Record<string, unknown>
}

export type DesktopSubscriptionUpgradeStatus =
  | "quoted"
  | "pending"
  | "applied"
  | "credited_fallback"
  | "expired"
  | "failed"
  | "canceled"

export interface DesktopSubscriptionUpgradeQuote {
  id: string
  status: DesktopSubscriptionUpgradeStatus
  sourceSubscriptionPeriodId: string
  sourcePlanVersionId: string
  targetPlanVersionId: string
  scheduledSubscriptionPeriodId: string | null
  sourcePlanCode: string
  sourcePlanName: string
  targetPlanCode: string
  targetPlanName: string
  sourceGrossPriceCents: number
  targetGrossPriceCents: number
  unusedCreditCents: number
  amountCents: number
  currency: string
  targetWeeklyLimitMicrocents: number
  quotedAt: string
  quoteExpiresAt: string
  sourcePeriodStartsAt: string
  sourcePeriodEndsAt: string
  scheduledPeriodStartsAt: string | null
  scheduledPeriodEndsAt: string | null
}

export interface DesktopSubscriptionUpgradeDetail {
  id: string
  status: DesktopSubscriptionUpgradeStatus
  sourcePlanVersionId: string
  targetPlanVersionId: string
  scheduledSubscriptionPeriodId: string | null
  sourceGrossPriceCents: number
  targetGrossPriceCents: number
  unusedCreditCents: number
  amountCents: number
  currency: string
  quotedAt: string
  quoteExpiresAt: string
  sourcePeriodStartsAt: string
  sourcePeriodEndsAt: string
  appliedAt?: string | null
  fallbackCreditedAt?: string | null
  sourcePlan?: { code: string; name: string } | null
  targetPlan?: { code: string; name: string; weeklyLimitMicrocents: number } | null
}

export interface DesktopSubscriptionSummary {
  id: string
  status: string
  planCode: string
  planName: string
  planVersion: number
  priceCents: number
  currency: string
  overageMode: "blocked" | "prepaid_balance"
  cancelAtPeriodEnd: boolean
  currentPeriodStartsAt: string | null
  currentPeriodEndsAt: string | null
  upcomingPeriodStartsAt: string | null
  upcomingPeriodEndsAt: string | null
  upcomingPlanVersionId?: string | null
  upcomingPlanCode?: string | null
  upcomingPlanName?: string | null
}

export interface DesktopSubscriptionLimit {
  type: "weekly"
  limitMicrocents: number
  adjustmentMicrocents: number
  usedMicrocents: number
  reservedMicrocents: number
  remainingMicrocents: number
  resetsAt: string | null
}

export interface DesktopSubscriptionOverview {
  connected: boolean
  balanceMicrocents?: number
  currency?: string
  plans: DesktopSubscriptionPlan[]
  subscription: DesktopSubscriptionSummary | null
  limits: DesktopSubscriptionLimit[]
  pendingOrder?: DesktopSubscriptionPaymentOrder | null
  pendingOrderPlanVersionId?: string | null
  pendingUpgrade?: DesktopSubscriptionUpgradeDetail | null
  pendingRechargeOrder?: DesktopRechargePaymentOrder | null
  error?: string
}

export type DesktopSubscriptionPaymentOrderStatus =
  | "created"
  | "pending"
  | "paid"
  | "failed"
  | "expired"
  | "canceled"

export interface DesktopSubscriptionPaymentOrder {
  id: string
  provider: DesktopSubscriptionPaymentProvider
  codeUrl: string | null
  amountCents: number
  currency?: string
  purpose?: "subscription_purchase" | "subscription_renewal" | "subscription_upgrade"
  status: DesktopSubscriptionPaymentOrderStatus
  outTradeNo?: string
  paidAt?: string | null
  expiresAt?: string | null
}

export interface DesktopSubscriptionOrderResponse {
  order: DesktopSubscriptionPaymentOrder
  upgrade?: DesktopSubscriptionUpgradeDetail | null
  paymentUrl?: string
  reused?: boolean
  sync?: {
    checked: boolean
    tradeState?: string
    error?: string
  }
}

export interface DesktopRechargePaymentOrder {
  id: string
  provider: DesktopSubscriptionPaymentProvider
  codeUrl: string | null
  amountCents: number
  currency?: string
  status: DesktopSubscriptionPaymentOrderStatus
  outTradeNo?: string
  paidAt?: string | null
  expiresAt?: string | null
}

export interface DesktopRechargeOrderResponse {
  order: DesktopRechargePaymentOrder
  paymentUrl?: string
  sync?: {
    checked: boolean
    tradeState?: string
    error?: string
  }
}

export type { DesktopStorageUsageSnapshot, DesktopStorageOptimizeResult }

export interface DesktopWindowState {
  isMaximized: boolean
}

export interface DesktopRendererErrorReport {
  colno?: number
  componentStack?: string
  filename?: string
  lineno?: number
  message: string
  name?: string
  source: "error-boundary" | "unhandled-rejection" | "window-error"
  stack?: string
  timestamp: number
  url?: string
  userAgent?: string
}

export interface DesktopRendererMemoryHeapSnapshot {
  jsHeapSizeLimit?: number
  totalJSHeapSize?: number
  usedJSHeapSize?: number
}

export interface DesktopRendererPerformanceEntryCounts {
  mark: number
  measure: number
  navigation: number
  paint: number
  resource: number
  total: number
}

export interface DesktopRendererSessionMemoryDiagnostics {
  assistantMessageCount: number
  currentSessionID: string | null
  diffChars: number
  draftPatchChars: number
  maxTraceItemChars: number
  messageTreeContentChars: number
  messageTreeNodeCount: number
  streamingAssistantMessageCount: number
  toolInputChars: number
  toolOutputChars: number
  traceItemCount: number
  traceTextChars: number
  messageCount: number
  updatedAt: number
}

export interface DesktopRendererMemoryDiagnosticsSnapshot {
  currentSession: DesktopRendererSessionMemoryDiagnostics
  heap: DesktopRendererMemoryHeapSnapshot
  performanceEntries: DesktopRendererPerformanceEntryCounts
  reason?: string
  source: "renderer"
  timestamp: number
  url?: string
  userAgent?: string
}

export interface DesktopRendererMemoryDiagnosticsRecord extends DesktopRendererMemoryDiagnosticsSnapshot {
  senderURL?: string
  webContentsID: number
}

export type WorkbenchWindowKind = "main" | "session-popout"
export type WorkbenchSurfaceKind = "main" | "session-popout"
export type WorkbenchPanelPlacement = "within" | "left" | "right" | "top" | "bottom"

export interface WorkbenchPanelReference {
  kind: "session"
  sessionID: string
}

export interface WorkbenchWindowSummary {
  id: string
  kind: WorkbenchWindowKind
  ownedPanelIDs: string[]
  surfaceID?: string
}

export interface WorkbenchSurfaceSummary {
  surfaceID: string
  kind: WorkbenchSurfaceKind
  windowID: string
  ownedPanelIDs: string[]
  layout?: unknown
}

export interface WorkbenchPanelOwnership {
  panelID: string
  ownerWindowID: string
  ownerSurfaceID?: string
  reference: WorkbenchPanelReference
  lastMainGroupID?: string | null
  title?: string
}

export interface WorkbenchPaneRenderSnapshot {
  panelID: string
  reference: WorkbenchPanelReference
  title?: string
}

export interface WorkbenchSharedState {
  version: number
  windows: WorkbenchWindowSummary[]
  surfaces?: WorkbenchSurfaceSummary[]
  ownership: WorkbenchPanelOwnership[]
  panels: Record<string, WorkbenchPaneRenderSnapshot>
}

export interface WorkbenchWindowContext {
  windowID: string
  kind: WorkbenchWindowKind
  surfaceID?: string
  ownedPanelIDs: string[]
  panelID?: string
  reference?: WorkbenchPanelReference | null
  state: WorkbenchSharedState
}

export interface WorkbenchWindowBounds {
  height: number
  width: number
  x?: number
  y?: number
}

export interface WorkbenchDetachSessionPanelInput {
  bounds?: WorkbenchWindowBounds
  lastMainGroupID?: string | null
  panelID: string
  sessionID: string
  sourceSurfaceID?: string | null
  title?: string
}

export interface WorkbenchDetachSessionPanelResult {
  ok: boolean
  panelID: string
  reason?: string
  windowID: string
  state: WorkbenchSharedState
}

export interface WorkbenchWindowReadyInput {
  windowID: string
}

export interface WorkbenchPanelMountedInput {
  panelID: string
  windowID: string
}

export interface WorkbenchDockSessionPanelInput {
  panelID: string
  reason?: "button" | "close" | "crash" | "timeout"
  targetGroupID?: string | null
  windowID?: string
}

export interface WorkbenchMoveSessionPanelInput {
  panelID: string
  placement?: WorkbenchPanelPlacement
  sourceSurfaceID?: string | null
  targetGroupID?: string | null
  targetSurfaceID: string
}

export interface WorkbenchMoveSessionPanelResult {
  ok: boolean
  reason?: string
  state: WorkbenchSharedState
}

export interface WorkbenchFocusSessionPanelInput {
  panelID: string
}

export interface WorkbenchFocusSessionPanelResult {
  ok: boolean
  panelID: string
  reason?: string
  state: WorkbenchSharedState
  windowID?: string
}

export interface WorkbenchPanelDragInput {
  dragID: string
  panelID: string
  sourceSurfaceID: string
}

export interface WorkbenchPanelDragState extends WorkbenchPanelDragInput {
  startedAt: number
}

export interface WorkbenchPanelMoveEvent {
  panelID: string
  placement: WorkbenchPanelPlacement
  reference: WorkbenchPanelReference
  sourceSurfaceID: string
  targetGroupID?: string | null
  targetSurfaceID: string
  title?: string
}

export interface WorkbenchStateEvent {
  reason: "snapshot" | "detached" | "dock" | "restored" | "move" | "focus"
  panelID?: string
  move?: WorkbenchPanelMoveEvent
  state: WorkbenchSharedState
}

export interface DesktopAgentHealth {
  ok: boolean
  baseURL: string
  requestId?: string
  error?: string
}

export interface DesktopMobileDeviceSummary {
  id: string
  name: string
  createdAt: number
  lastSeenAt: number
  revokedAt?: number
  capabilities: string[]
}

export interface DesktopCloudRelayStatus {
  enabled: boolean
  state: "disabled" | "idle" | "registering" | "connecting" | "connected" | "error"
  baseUrl: string | null
  desktopID: string | null
  pairingCode: string | null
  pairingExpiresAt: number | null
  pairingDeepLink: string | null
  connectedAt: number | null
  account: DesktopCloudRelayAccountStatus
  lastError?: string
}

export interface DesktopCloudRelayAccountStatus {
  state: "unknown" | "not_connected" | "connected" | "error"
  email?: string
  workspaceName?: string
  expiresAt?: number
  lastError?: string
}

export interface DesktopMobileBridgeStatus {
  running: boolean
  host: string
  port: number | null
  token: string
  publicUrl: string | null
  localUrl: string | null
  urls: string[]
  publicPairingUrl: string | null
  pairingLocalUrl: string | null
  pairingUrls: string[]
  pairingExpiresAt: number | null
  startedAt: number | null
  devices: DesktopMobileDeviceSummary[]
  cloudRelay: DesktopCloudRelayStatus
}

export interface DesktopComposerPastedImageAttachment {
  dataUrl: string
  mimeType: string
  name?: string
}

export interface DesktopSaveComposerPastedImagesInput {
  images: DesktopComposerPastedImageAttachment[]
}

export interface DesktopCopyImageToClipboardInput {
  dataUrl: string
  mimeType: string
}

export interface DesktopSaveImageToFolderInput {
  dataUrl: string
  mimeType: string
  name?: string
}

export type DesktopSaveImageToFolderResult =
  | { canceled: true }
  | { canceled: false; path: string }

export interface DesktopPreviewScreenshotCaptureInput {
  bounds: {
    height: number
    width: number
    x: number
    y: number
  }
  copyToClipboard?: boolean
  url?: string
}

export interface DesktopPreviewScreenshotCaptureResult {
  copiedToClipboard?: boolean
  path: string
}

export interface DesktopLocalPreviewService {
  port: number
  statusCode: number
  url: string
}

export type DesktopPreviewTargetKind = "url" | "artifact" | "file"
export type DesktopPreviewRenderer =
  | "url-webview"
  | "markdown-preview"
  | "html-preview"
  | "svg-preview"
  | "json-viewer"
  | "table-preview"
  | "image-preview"
  | "code-viewer"
  | "system-open"

export interface DesktopResolvePreviewTargetInput {
  value: string
  workspaceRoot?: string | null
}

export interface DesktopPreviewExternalOpenTarget {
  kind: "url" | "path"
  value: string
}

export interface DesktopResolvedPreviewTarget {
  artifactID?: string
  artifactType?: string
  entry?: string
  error?: string
  externalOpenTarget?: DesktopPreviewExternalOpenTarget
  input: string
  kind: DesktopPreviewTargetKind
  mime: string
  normalizedInput: string
  path?: string
  renderer: DesktopPreviewRenderer
  safePreviewUrl?: string
  textReadable: boolean
  title: string
  workspaceRoot?: string
}

export interface DesktopReadPreviewTextInput {
  path: string
  workspaceRoot?: string | null
}

export interface DesktopReadPreviewTextResult {
  content: string
  path: string
}

export interface DesktopSessionMutationResult {
  session: AgentSessionSummary
  requestId?: string
}

export interface DesktopSessionRollbackInput {
  sessionID: string
  targetMessageID: string
  reason: string
  correctivePrompt: string
  restoreWorkspace?: boolean
}

export interface DesktopSessionRollbackResult {
  session: AgentSessionSummary
  targetMessageID: string
  correctiveMessageID: string
  restoreWorkspace: boolean
  targetSnapshot?: string
  preRestoreSnapshot?: string
  restoredFiles: string[]
}

export interface DesktopDeleteProjectWorkspaceResult extends AgentProjectDeleteResult {
  requestId?: string
}

export interface DesktopDeleteAgentSessionResult extends AgentSessionDeleteResult {
  requestId?: string
}

export interface DesktopArchiveAgentSessionResult extends AgentSessionArchiveResult {
  requestId?: string
}

export interface DesktopDeleteArchivedSessionResult extends AgentArchivedSessionDeleteResult {
  requestId?: string
}

export interface DesktopProviderMutationInput {
  name?: string
  env?: string[]
  options?: {
    apiKey?: string
    baseURL?: string
  }
}

export interface DesktopProviderMutationSummary {
  id: string
  name: string
  available: boolean
  apiKeyConfigured: boolean
  baseURL?: string
}

export interface DesktopProviderMutationResult {
  provider: DesktopProviderMutationSummary
  selection: AgentProjectModelSelection
}

export interface DesktopProviderDeleteResult {
  providerID: string
  selection: AgentProjectModelSelection
}

export interface DesktopProviderConnectionTestInput {
  providerID: string
  method?: string
  credentialMode?: "active" | "manual" | "environment"
  apiKey?: string | null
  baseURL?: string | null
}

export interface DesktopCinemaVideoProviderConnectionTestInput {
  providerID: string
  apiKey?: string | null
  baseURL?: string | null
  userID?: string | null
}

export interface DesktopCustomProviderInput {
  providerID?: string
  apiBaseURL: string
  apiKey: string
  defaultModel: string
  chatEndpoint: string
  supportsImageInput: boolean
  supportsPdfInput: boolean
  supportsReasoning: boolean
}

export type DesktopProviderAuthPrompt = "login" | "select_account"

export interface DesktopModelSelectionUpdateInput {
  model?: string | null
  small_model?: string | null
  reasoning_effort?: ReasoningEffort | null
  image_model?: string | null
  image_generation?: {
    default_size?: string
    default_count?: number
  } | null
}

export interface DesktopAgentSessionTurnResult {
  clientTurnID: string
  requestId?: string
}

export interface DesktopAgentSessionCancelTurnResult {
  clientTurnID: string
  backendSessionID: string
  localRequestAborted: boolean
  backendCancelled: boolean
  backendCancelError?: string
}

export interface DesktopAgentSessionAbortTurnResult {
  clientTurnID: string
  backendSessionID: string
  localRequestAborted: boolean
}

export interface DesktopAgentSessionInterruptResult {
  backendSessionID: string
  clientTurnID?: string
  localRequestsAborted: number
  backendCancelled: boolean
  activeCancelled?: boolean
  queuedCancelled?: number
  backendCancelError?: string
}

export interface DesktopAgentSessionSubscriptionResult {
  backendSessionID: string
  lastEventID?: string
}

export interface DesktopAgentSessionUnsubscribeResult {
  backendSessionID: string
  removed: boolean
}

export interface DesktopSaveSessionTraceExportResult {
  canceled: boolean
  path?: string
}

export interface DesktopSaveSessionTraceExportDirectoryResult {
  canceled: boolean
  path?: string
  fileCount?: number
  recordCount?: number
}

export interface DesktopSessionBagAccountSummary {
  email?: string
  workspaceName?: string
  planLabel?: string
}

export interface DesktopPrepareSessionBagSubmissionResult {
  account?: DesktopSessionBagAccountSummary
  baseURL?: string
  filename: string
  fileCount: number
  generatedAt: string
  projectID?: string | null
  recordCount: number
  redaction: AgentSessionTraceExport["redaction"]
  sessionID: string
  sha256: string
  sizeBytes: number
  submissionID: string
}

export interface DesktopUploadSessionBagSubmissionResult {
  bagID: string
  url?: string
}

export interface DesktopIpcContract {
  "desktop:get-info": {
    input: void
    output: DesktopInfo
  }
  "desktop:get-runtime-capabilities": {
    input: void
    output: DesktopRuntimeCapabilities
  }
  "desktop:start-semantic-token-inspector": {
    input: void
    output: SemanticTokenInspectorStartResult
  }
  "desktop:inspect-semantic-token-at-point": {
    input: SemanticTokenInspectorInspectInput
    output: SemanticTokenInspectorInspectResult
  }
  "desktop:stop-semantic-token-inspector": {
    input: void
    output: SemanticTokenInspectorStopResult
  }
  "desktop:prepare-semantic-token-authoring-commit": {
    input: PrepareSemanticTokenAuthoringCommitInput
    output: PrepareSemanticTokenAuthoringCommitResult
  }
  "desktop:commit-semantic-token-authoring-commit": {
    input: CommitSemanticTokenAuthoringCommitInput
    output: CommitSemanticTokenAuthoringCommitResult
  }
  "desktop:discard-semantic-token-authoring-commit": {
    input: DiscardSemanticTokenAuthoringCommitInput
    output: DiscardSemanticTokenAuthoringCommitResult
  }
  "desktop:get-app-update-settings": {
    input: void
    output: DesktopAppUpdateSettings
  }
  "desktop:get-app-update-state": {
    input: void
    output: DesktopAppUpdateState
  }
  "desktop:set-automatic-updates-enabled": {
    input: { enabled: boolean }
    output: DesktopAppUpdateSettings
  }
  "desktop:check-for-app-updates": {
    input: void
    output: DesktopAppUpdateCheckResult
  }
  "desktop:install-app-update": {
    input: void
    output: DesktopAppUpdateInstallResult
  }
  "desktop:get-running-session-status": {
    input: void
    output: DesktopRunningSessionStatus
  }
  "desktop:get-storage-paths": {
    input: void
    output: DesktopStoragePaths
  }
  "desktop:get-storage-usage": {
    input: void
    output: DesktopStorageUsageSnapshot
  }
  "desktop:optimize-storage": {
    input: void
    output: DesktopStorageOptimizeResult
  }
  "desktop:get-window-state": {
    input: void
    output: DesktopWindowState
  }
  "desktop:report-renderer-error": {
    input: DesktopRendererErrorReport
    output: { ok: boolean }
  }
  "desktop:report-renderer-memory-diagnostics": {
    input: DesktopRendererMemoryDiagnosticsSnapshot
    output: { ok: boolean }
  }
  "desktop:get-renderer-memory-diagnostics": {
    input: void
    output: { records: DesktopRendererMemoryDiagnosticsRecord[] }
  }
  "desktop:get-workbench-window-context": {
    input: void
    output: WorkbenchWindowContext
  }
  "desktop:workbench-publish-state-snapshot": {
    input: WorkbenchSharedState
    output: WorkbenchSharedState
  }
  "desktop:workbench-detach-session-panel": {
    input: WorkbenchDetachSessionPanelInput
    output: WorkbenchDetachSessionPanelResult
  }
  "desktop:workbench-window-ready": {
    input: WorkbenchWindowReadyInput
    output: void
  }
  "desktop:workbench-panel-mounted": {
    input: WorkbenchPanelMountedInput
    output: WorkbenchSharedState
  }
  "desktop:workbench-dock-session-panel": {
    input: WorkbenchDockSessionPanelInput
    output: WorkbenchSharedState
  }
  "desktop:workbench-move-session-panel": {
    input: WorkbenchMoveSessionPanelInput
    output: WorkbenchMoveSessionPanelResult
  }
  "desktop:workbench-focus-session-panel": {
    input: WorkbenchFocusSessionPanelInput
    output: WorkbenchFocusSessionPanelResult
  }
  "desktop:workbench-begin-panel-drag": {
    input: WorkbenchPanelDragInput
    output: WorkbenchPanelDragState
  }
  "desktop:workbench-end-panel-drag": {
    input: { dragID: string }
    output: void
  }
  "desktop:workbench-get-panel-drag": {
    input: { dragID?: string }
    output: WorkbenchPanelDragState | null
  }
  "desktop:get-appearance-config": {
    input: void
    output: AppearanceConfigSnapshot
  }
  "desktop:save-appearance-config": {
    input: { document: AppearanceConfigDocument }
    output: AppearanceConfigSnapshot
  }
  "desktop:publish-appearance-state": {
    input: AppearanceRuntimeState
    output: void
  }
  "desktop:get-appearance-themes": {
    input: void
    output: AppearanceThemeLibrarySnapshot
  }
  "desktop:save-appearance-theme": {
    input: { theme: AppearanceThemeSaveInput }
    output: AppearanceThemeMutationResult
  }
  "desktop:delete-appearance-theme": {
    input: { themeID: string }
    output: AppearanceThemeLibrarySnapshot
  }
  "desktop:set-active-appearance-theme": {
    input: { themeID: string }
    output: AppearanceThemeLibrarySnapshot
  }
  "desktop:duplicate-appearance-theme": {
    input: AppearanceThemeDuplicateInput
    output: AppearanceThemeMutationResult
  }
  "desktop:rename-appearance-theme": {
    input: AppearanceThemeRenameInput
    output: AppearanceThemeMutationResult
  }
  "desktop:get-locale-config": {
    input: void
    output: LocaleConfigSnapshot
  }
  "desktop:save-locale-config": {
    input: { document: LocaleConfigDocument }
    output: LocaleConfigSnapshot
  }
  "desktop:window-action": {
    input: WindowAction
    output: void
  }
  "desktop:open-external-url": {
    input: { url: string }
    output: { ok: true; url: string }
  }
  "desktop:open-path": {
    input: DesktopOpenPathInput
    output: DesktopOpenPathResult
  }
  "desktop:open-cinema-project": {
    input: DesktopOpenCinemaProjectInput
    output: DesktopOpenCinemaProjectResult
  }
  "desktop:open-monitor-window": {
    input: void
    output:
      | { ok: true; reused: false; source: "dev-server"; url: string }
      | { filePath: string; ok: true; reused: false; source: "file" }
      | { ok: true; reused: true; source: "existing" }
  }
  "desktop:open-appearance-window": {
    input: void
    output: { ok: true; reused: boolean }
  }
  "desktop:show-menu": {
    input: MenuKey | { menuKey: MenuKey; anchor?: MenuAnchor }
    output: void
  }
  "desktop:show-external-editor-menu": {
    input: { targetPath: string; anchor?: MenuAnchor }
    output: void
  }
  "desktop:list-external-editors-for-target": {
    input: { targetPath: string }
    output: ExternalEditorSummary[]
  }
  "desktop:open-in-external-editor": {
    input: { targetPath: string; editorID?: string }
    output: { ok: true; editor: ExternalEditorSummary; targetPath: string }
  }
  "desktop:get-agent-config": {
    input: void
    output: AgentConfig
  }
  "desktop:agent-health": {
    input: void
    output: DesktopAgentHealth
  }
  "desktop:get-mobile-bridge-status": {
    input: void
    output: DesktopMobileBridgeStatus
  }
  "desktop:refresh-mobile-pairing-code": {
    input: void
    output: DesktopMobileBridgeStatus
  }
  "desktop:rotate-mobile-bridge-token": {
    input: void
    output: DesktopMobileBridgeStatus
  }
  "desktop:revoke-mobile-device": {
    input: { deviceID: string }
    output: DesktopMobileBridgeStatus
  }
  "desktop:list-folder-workspaces": {
    input: void
    output: AgentFolderWorkspace[]
  }
  "desktop:list-project-workspaces": {
    input: void
    output: AgentProjectWorkspace[]
  }
  "desktop:list-project-worktrees": {
    input: { projectID: string }
    output: AgentWorktreeRecord[]
  }
  "desktop:create-project-worktree": {
    input: {
      projectID: string
      baseRef?: string
      branchName?: string
      sourceDirectory?: string
      environment?: {
        key: string
        expectedHash: string
        runSetup: boolean
      }
      cleanupPolicy?: AgentWorktreeRecord["cleanupPolicy"]
      ownerRunID?: string
      ownerSessionID?: string
      ownerType?: AgentWorktreeRecord["ownerType"]
    }
    output: AgentPreparedWorktreeResult
  }
  "desktop:refresh-project-worktree": {
    input: { projectID: string; worktreeID: string }
    output: AgentWorktreeRecord
  }
  "desktop:delete-project-worktree": {
    input: { projectID: string; worktreeID: string; force?: boolean; ownerRunID?: string; ownerSessionID?: string }
    output: AgentWorktreeRecord
  }
  "desktop:update-workspace-watch-directories": {
    input: { directories: string[] }
    output: { directories: string[] }
  }
  "desktop:create-pty-session": {
    input: {
      sessionID: string
      terminalKey?: string
      purpose?: AgentPtySessionInfo["purpose"]
      title?: string
      shell?: string
      rows?: number
      cols?: number
    }
    output: AgentPtySessionInfo
  }
  "desktop:list-project-environments": {
    input: { projectID: string; directory: string }
    output: AgentEnvironmentListResult
  }
  "desktop:save-project-environment": {
    input: {
      projectID: string
      directory: string
      definition: AgentEnvironmentDefinition
      expectedHash: string | null
      trust: boolean
    }
    output: AgentEnvironmentCandidate
  }
  "desktop:import-project-environment": {
    input: {
      projectID: string
      directory: string
      key: string
      expectedHash: string
      trust: boolean
    }
    output: AgentEnvironmentCandidate
  }
  "desktop:update-project-environment-preference": {
    input: {
      projectID: string
      directory: string
      selectedKey?: string | null
      autoSetup?: boolean
    }
    output: AgentEnvironmentPreference
  }
  "desktop:trust-project-environment": {
    input: {
      projectID: string
      directory: string
      key: string
      expectedHash: string
    }
    output: AgentEnvironmentCandidate
  }
  "desktop:revoke-project-environment-trust": {
    input: {
      projectID: string
      directory: string
      key: string
      expectedHash?: string
    }
    output: AgentEnvironmentCandidate
  }
  "desktop:get-environment-run": {
    input: { runID: string }
    output: AgentEnvironmentRunRecord
  }
  "desktop:cancel-environment-run": {
    input: { runID: string }
    output: AgentEnvironmentRunRecord
  }
  "desktop:retry-environment-run": {
    input: { runID: string }
    output: AgentEnvironmentRunRecord
  }
  "desktop:start-environment-action": {
    input: {
      projectID: string
      environmentKey: string
      expectedHash: string
      actionID: string
      sessionID: string
    }
    output: AgentEnvironmentActionStartResult
  }
  "desktop:stop-environment-action": {
    input: {
      projectID: string
      environmentKey: string
      actionID: string
      sessionID: string
    }
    output: AgentEnvironmentRunRecord
  }
  "desktop:restart-environment-setup": {
    input: {
      projectID: string
      environmentKey: string
      expectedHash: string
      sessionID: string
    }
    output: AgentEnvironmentRunRecord | undefined
  }
  "desktop:get-pty-session": {
    input: { id: string }
    output: AgentPtySessionInfo
  }
  "desktop:update-pty-session": {
    input: { id: string; title?: string; rows?: number; cols?: number }
    output: AgentPtySessionInfo
  }
  "desktop:delete-pty-session": {
    input: { id: string }
    output: AgentPtySessionInfo
  }
  "desktop:attach-pty-session": {
    input: { id: string; cursor?: number }
    output: AgentPtySessionInfo
  }
  "desktop:detach-pty-session": {
    input: { id: string }
    output: boolean
  }
  "desktop:write-pty-input": {
    input: { id: string; data: string }
    output: void
  }
  "desktop:pick-project-directory": {
    input: void
    output: string | null
  }
  "desktop:pick-composer-attachments": {
    input: { allowImage?: boolean; allowPdf?: boolean } | undefined
    output: string[]
  }
  "desktop:save-composer-pasted-images": {
    input: DesktopSaveComposerPastedImagesInput
    output: string[]
  }
  "desktop:copy-image-to-clipboard": {
    input: DesktopCopyImageToClipboardInput
    output: void
  }
  "desktop:save-image-to-folder": {
    input: DesktopSaveImageToFolderInput
    output: DesktopSaveImageToFolderResult
  }
  "desktop:capture-preview-screenshot": {
    input: DesktopPreviewScreenshotCaptureInput
    output: DesktopPreviewScreenshotCaptureResult
  }
  "desktop:detect-local-preview-services": {
    input: void
    output: DesktopLocalPreviewService[]
  }
  "desktop:resolve-preview-target": {
    input: DesktopResolvePreviewTargetInput
    output: DesktopResolvedPreviewTarget
  }
  "desktop:read-preview-text": {
    input: DesktopReadPreviewTextInput
    output: DesktopReadPreviewTextResult
  }
  "desktop:git-get-capabilities": {
    input: GitGetCapabilitiesInput
    output: GitCapabilities
  }
  "desktop:git-commit": {
    input: { projectID: string; directory: string; message: string; stageAll?: boolean }
    output: GitActionResult
  }
  "desktop:git-generate-commit-message": {
    input: { projectID: string; directory: string; stageAll?: boolean }
    output: { message: string }
  }
  "desktop:git-push": {
    input: { projectID: string; directory: string }
    output: GitActionResult
  }
  "desktop:git-create-branch": {
    input: { projectID: string; directory: string; name: string }
    output: GitActionResult
  }
  "desktop:git-list-branches": {
    input: { projectID: string; directory: string }
    output: GitBranchSummary[]
  }
  "desktop:git-checkout-branch": {
    input: { projectID: string; directory: string; name: string }
    output: GitActionResult
  }
  "desktop:git-create-pull-request": {
    input: { projectID: string; directory: string }
    output: GitActionResult
  }
  "desktop:create-project-workspace": {
    input: { directory: string }
    output: AgentProjectWorkspace
  }
  "desktop:open-folder-workspace": {
    input: { directory: string }
    output: AgentFolderWorkspace
  }
  "desktop:list-ssh-profiles": {
    input: void
    output: AgentSshProfile[]
  }
  "desktop:save-ssh-profile": {
    input: AgentSshProfileInput
    output: AgentSshProfile
  }
  "desktop:delete-ssh-profile": {
    input: { profileID: string }
    output: { profileID: string; removed: boolean }
  }
  "desktop:test-ssh-profile": {
    input: { profileID: string }
    output: AgentSshConnectionTestResult
  }
  "desktop:list-ssh-directory": {
    input: { profileID: string; path?: string | null }
    output: AgentSshDirectoryListing
  }
  "desktop:open-ssh-folder-workspace": {
    input: { profileID: string; path: string }
    output: AgentFolderWorkspace
  }
  "desktop:agent-create-session": {
    input: { directory?: string } | undefined
    output: DesktopSessionMutationResult
  }
  "desktop:create-folder-session": {
    input: { projectID: string; directory: string; title?: string }
    output: DesktopSessionMutationResult
  }
  "desktop:create-project-session": {
    input: { projectID: string; title?: string; directory?: string }
    output: DesktopSessionMutationResult
  }
  "desktop:update-session-title": {
    input: { sessionID: string; title: string }
    output: DesktopSessionMutationResult
  }
  "desktop:update-session-pinned": {
    input: { sessionID: string; pinned: boolean }
    output: DesktopSessionMutationResult
  }
  "desktop:delete-project-workspace": {
    input: { projectID: string }
    output: DesktopDeleteProjectWorkspaceResult
  }
  "desktop:delete-agent-session": {
    input: { sessionID: string }
    output: DesktopDeleteAgentSessionResult
  }
  "desktop:archive-agent-session": {
    input: { sessionID: string }
    output: DesktopArchiveAgentSessionResult
  }
  "desktop:list-archived-sessions": {
    input: void
    output: AgentArchivedSessionSummary[]
  }
  "desktop:restore-archived-session": {
    input: { sessionID: string }
    output: DesktopSessionMutationResult
  }
  "desktop:delete-archived-session": {
    input: { sessionID: string }
    output: DesktopDeleteArchivedSessionResult
  }
  "desktop:get-session-diff": {
    input: { sessionID: string; scope?: AgentSessionDiffScope }
    output: AgentSessionDiffSummary
  }
  "desktop:get-session-tasks": {
    input: { sessionID: string }
    output: AgentSessionTaskListView
  }
  "desktop:get-session-background-processes": {
    input: { sessionID: string }
    output: AgentSessionBackgroundProcessList
  }
  "desktop:terminate-session-background-process": {
    input: { sessionID: string; processID: string }
    output: AgentSessionBackgroundProcessTerminateResult
  }
  "desktop:terminate-all-session-background-processes": {
    input: { sessionID: string }
    output: AgentSessionBackgroundProcessesTerminateAllResult
  }
  "desktop:restore-workspace-diff-file": {
    input: { directory: string; file: string }
    output: WorkspaceDiffFileRestoreResult
  }
  "desktop:stage-workspace-diff-file": {
    input: { directory: string; file: string }
    output: WorkspaceDiffFileRestoreResult
  }
  "desktop:unstage-workspace-diff-file": {
    input: { directory: string; file: string }
    output: WorkspaceDiffFileRestoreResult
  }
  "desktop:reverse-apply-workspace-diff-patches": {
    input: WorkspaceDiffPatchReverseApplyInput
    output: WorkspaceDiffPatchReverseApplyResult
  }
  "desktop:get-session-runtime-debug": {
    input: { sessionID: string; limit?: number; turns?: number }
    output: AgentSessionRuntimeDebugSnapshot
  }
  "desktop:get-session-trace-export": {
    input: { sessionID: string }
    output: AgentSessionTraceExport
  }
  "desktop:save-session-trace-export": {
    input: { sessionID: string }
    output: DesktopSaveSessionTraceExportResult
  }
  "desktop:save-session-trace-export-directory": {
    input: { sessionID: string }
    output: DesktopSaveSessionTraceExportDirectoryResult
  }
  "desktop:save-session-trace-export-raw-directory": {
    input: { sessionID: string }
    output: DesktopSaveSessionTraceExportDirectoryResult
  }
  "desktop:save-session-trace-export-to-project": {
    input: { sessionID: string; directory: string; projectID?: string | null }
    output: DesktopSaveSessionTraceExportDirectoryResult
  }
  "desktop:prepare-session-bag-submission": {
    input: { sessionID: string; projectID?: string | null; workspaceDirectory?: string | null }
    output: DesktopPrepareSessionBagSubmissionResult
  }
  "desktop:upload-session-bag-submission": {
    input: { submissionID: string; description?: string | null }
    output: DesktopUploadSessionBagSubmissionResult
  }
  "desktop:discard-session-bag-submission": {
    input: { submissionID: string }
    output: { discarded: boolean }
  }
  "desktop:update-session-workflow": {
    input: { sessionID: string } & AgentSessionWorkflowUpdateInput
    output: DesktopSessionMutationResult
  }
  "desktop:get-global-provider-catalog": {
    input: void
    output: AgentProviderCatalogItem[]
  }
  "desktop:get-anybox-subscription-overview": {
    input: void
    output: DesktopSubscriptionOverview
  }
  "desktop:create-anybox-subscription-order": {
    input: { planVersionId: string; provider: DesktopSubscriptionPaymentProvider; replaceOrderId?: string }
    output: DesktopSubscriptionOrderResponse
  }
  "desktop:create-anybox-subscription-upgrade-quote": {
    input: { planVersionId: string }
    output: { quote: DesktopSubscriptionUpgradeQuote }
  }
  "desktop:create-anybox-subscription-upgrade-order": {
    input: { quoteId: string; provider: DesktopSubscriptionPaymentProvider; replaceOrderId?: string }
    output: DesktopSubscriptionOrderResponse
  }
  "desktop:get-anybox-subscription-order": {
    input: { orderId: string }
    output: DesktopSubscriptionOrderResponse
  }
  "desktop:cancel-anybox-subscription-order": {
    input: { orderId: string }
    output: DesktopSubscriptionOrderResponse
  }
  "desktop:create-anybox-recharge-order": {
    input: { amountCents: number; provider: DesktopSubscriptionPaymentProvider }
    output: DesktopRechargeOrderResponse
  }
  "desktop:get-anybox-recharge-order": {
    input: { orderId: string }
    output: DesktopRechargeOrderResponse
  }
  "desktop:cancel-anybox-recharge-order": {
    input: { orderId: string }
    output: DesktopRechargeOrderResponse
  }
  "desktop:refresh-global-provider-catalog": {
    input: void
    output: AgentProviderCatalogItem[]
  }
  "desktop:get-global-provider-auth": {
    input: { providerID: string }
    output: AgentProviderAuthState
  }
  "desktop:start-global-provider-auth-flow": {
    input: {
      providerID: string
      method: string
      baseURL?: string | null
      prompt?: DesktopProviderAuthPrompt
    }
    output: AgentProviderAuthFlow
  }
  "desktop:get-global-provider-auth-flow": {
    input: { providerID: string; flowID: string }
    output: AgentProviderAuthFlow
  }
  "desktop:cancel-global-provider-auth-flow": {
    input: { providerID: string; flowID: string }
    output: AgentProviderAuthFlow
  }
  "desktop:save-global-provider-api-key": {
    input: { providerID: string; apiKey?: string | null }
    output: AgentProviderAuthState
  }
  "desktop:get-cinema-video-providers": {
    input: void
    output: CinemaVideoProvider[]
  }
  "desktop:refresh-cinema-video-provider-catalog": {
    input: void
    output: CinemaVideoProvider[]
  }
  "desktop:get-cinema-provider-workflows": {
    input: { providerID: string }
    output: CinemaProviderWorkflowCatalog
  }
  "desktop:refresh-cinema-provider-workflows": {
    input: { providerID: string }
    output: CinemaProviderWorkflowCatalog
  }
  "desktop:save-cinema-video-provider-api-key": {
    input: { providerID: string; apiKey?: string | null }
    output: CinemaProviderAuthState
  }
  "desktop:save-cinema-video-provider-settings": {
    input: { providerID: string; baseURL?: string | null; userID?: string | null }
    output: CinemaVideoProvider
  }
  "desktop:test-cinema-video-provider-connection": {
    input: DesktopCinemaVideoProviderConnectionTestInput
    output: AgentProviderConnectionTestResult
  }
  "desktop:delete-global-provider-auth-session": {
    input: { providerID: string }
    output: AgentProviderAuthState
  }
  "desktop:test-global-provider-connection": {
    input: DesktopProviderConnectionTestInput
    output: AgentProviderConnectionTestResult
  }
  "desktop:upsert-custom-provider": {
    input: DesktopCustomProviderInput
    output: DesktopProviderMutationResult
  }
  "desktop:test-custom-provider-connection": {
    input: DesktopCustomProviderInput
    output: AgentProviderConnectionTestResult
  }
  "desktop:get-global-models": {
    input: void
    output: { items: AgentProviderModel[]; selection: AgentProjectModelSelection }
  }
  "desktop:get-global-model-catalog": {
    input: void
    output: AgentModelCatalogResult
  }
  "desktop:update-global-provider": {
    input: { providerID: string; provider: DesktopProviderMutationInput }
    output: DesktopProviderMutationResult
  }
  "desktop:delete-global-provider": {
    input: { providerID: string }
    output: DesktopProviderDeleteResult
  }
  "desktop:update-global-model-selection": {
    input: DesktopModelSelectionUpdateInput
    output: AgentProjectModelSelection
  }
  "desktop:get-global-mcp-servers": {
    input: void
    output: AgentMcpServerSummary[]
  }
  "desktop:get-global-mcp-server-diagnostic": {
    input: { serverID: string }
    output: AgentMcpServerDiagnostic
  }
  "desktop:update-global-mcp-server": {
    input: { serverID: string; server: McpServerInput }
    output: AgentMcpServerSummary
  }
  "desktop:delete-global-mcp-server": {
    input: { serverID: string }
    output: { serverID: string; removed: boolean }
  }
  "desktop:get-plugin-catalog": {
    input: DesktopPluginCatalogInput | void
    output: AgentPluginCatalogItem[]
  }
  "desktop:get-installed-plugins": {
    input: void
    output: AgentInstalledPlugin[]
  }
  "desktop:import-plugin-from-url": {
    input: AgentPluginImportURLInput
    output: AgentPluginCatalogItem
  }
  "desktop:install-plugin": {
    input: AgentPluginInstallInput
    output: AgentInstalledPlugin
  }
  "desktop:update-installed-plugin": {
    input: AgentPluginUpdateInput
    output: AgentInstalledPlugin
  }
  "desktop:update-installed-plugin-mcp-controls": {
    input: AgentPluginMcpControlsInput
    output: AgentPluginMcpControlsResult
  }
  "desktop:list-installed-plugin-skill-entries": {
    input: { pluginID: string; skillID: string; path?: string }
    output: AgentPluginSkillDirectory
  }
  "desktop:read-installed-plugin-skill-file": {
    input: { pluginID: string; skillID: string; path: string }
    output: AgentPluginSkillFile
  }
  "desktop:delete-installed-plugin": {
    input: { pluginID: string }
    output: AgentPluginDeleteResult
  }
  "desktop:get-installed-plugin-diagnostic": {
    input: { pluginID: string }
    output: AgentMcpServerDiagnostic
  }
  "desktop:get-connector-catalog": {
    input: void
    output: AgentConnectorDefinition[]
  }
  "desktop:get-connectors": {
    input: void
    output: AgentConnectorStatus[]
  }
  "desktop:get-connector": {
    input: { connectorID: string }
    output: AgentConnectorStatus
  }
  "desktop:save-connector-api-key": {
    input: { connectorID: string; apiKey?: string | null }
    output: AgentConnectorStatus
  }
  "desktop:delete-connector-api-key": {
    input: { connectorID: string }
    output: AgentConnectorStatus
  }
  "desktop:save-connector-config": {
    input: { connectorID: string; config: Record<string, string | null | undefined> }
    output: AgentConnectorStatus
  }
  "desktop:delete-connector-config": {
    input: { connectorID: string }
    output: AgentConnectorStatus
  }
  "desktop:start-connector-auth-flow": {
    input: { connectorID: string }
    output: AgentProviderAuthFlow
  }
  "desktop:get-connector-auth-flow": {
    input: { connectorID: string; flowID: string }
    output: AgentProviderAuthFlow | undefined
  }
  "desktop:cancel-connector-auth-flow": {
    input: { connectorID: string; flowID: string }
    output: AgentProviderAuthFlow | undefined
  }
  "desktop:delete-connector-auth-session": {
    input: { connectorID: string }
    output: AgentConnectorStatus
  }
  "desktop:get-connector-diagnostic": {
    input: { connectorID: string; runtimeID?: string }
    output: AgentMcpServerDiagnostic
  }
  "desktop:get-installed-plugin-connectors": {
    input: { pluginID: string }
    output: AgentPluginConnectorStatus[]
  }
  "desktop:save-installed-plugin-connector-api-key": {
    input: { pluginID: string; appID: string; apiKey?: string | null }
    output: AgentPluginConnectorStatus
  }
  "desktop:delete-installed-plugin-connector-api-key": {
    input: { pluginID: string; appID: string }
    output: AgentPluginConnectorStatus
  }
  "desktop:start-installed-plugin-connector-auth-flow": {
    input: { pluginID: string; appID: string }
    output: AgentProviderAuthFlow
  }
  "desktop:get-installed-plugin-connector-auth-flow": {
    input: { pluginID: string; appID: string; flowID: string }
    output: AgentProviderAuthFlow | undefined
  }
  "desktop:cancel-installed-plugin-connector-auth-flow": {
    input: { pluginID: string; appID: string; flowID: string }
    output: AgentProviderAuthFlow | undefined
  }
  "desktop:delete-installed-plugin-connector-auth-session": {
    input: { pluginID: string; appID: string }
    output: AgentPluginConnectorStatus
  }
  "desktop:get-installed-plugin-connector-diagnostic": {
    input: { pluginID: string; appID: string }
    output: AgentMcpServerDiagnostic
  }
  "desktop:get-builtin-tools": {
    input: void
    output: AgentBuiltinToolsPayload
  }
  "desktop:update-builtin-tool-selection": {
    input: AgentBuiltinToolSelection
    output: AgentBuiltinToolSelection
  }
  "desktop:get-tool-permission-mode": {
    input: void
    output: AgentToolPermissionModePayload
  }
  "desktop:update-tool-permission-mode": {
    input: AgentToolPermissionModePayload
    output: AgentToolPermissionModePayload
  }
  "desktop:list-automations": {
    input: void
    output: AgentAutomationDefinition[]
  }
  "desktop:create-automation": {
    input: AgentAutomationCreateInput
    output: AgentAutomationDefinition
  }
  "desktop:update-automation": {
    input: { automationID: string; automation: AgentAutomationUpdateInput }
    output: AgentAutomationDefinition
  }
  "desktop:delete-automation": {
    input: { automationID: string }
    output: AgentAutomationDeleteResult
  }
  "desktop:run-automation": {
    input: { automationID: string }
    output: AgentAutomationRunCreateResult
  }
  "desktop:list-automation-runs": {
    input: AgentAutomationRunListInput | undefined
    output: AgentAutomationRun[]
  }
  "desktop:update-automation-run-triage": {
    input: { runID: string; triageStatus: AgentAutomationTriageStatus }
    output: AgentAutomationRun | null
  }
  "desktop:cancel-automation-run": {
    input: { runID: string }
    output: AgentAutomationRun | null
  }
  "desktop:get-global-skills": {
    input: void
    output: AgentSkillInfo[]
  }
  "desktop:get-skill-registry-providers": {
    input: void
    output: RegistryProviderDescriptor[]
  }
  "desktop:search-skill-registry": {
    input: RegistrySearchInput
    output: RegistrySearchPage
  }
  "desktop:get-skill-registry-detail": {
    input: RegistrySkillRef
    output: RegistrySkillDetail
  }
  "desktop:get-skill-registry-versions": {
    input: RegistryVersionRef
    output: RegistryVersion[]
  }
  "desktop:get-skill-registry-files": {
    input: RegistryVersionRef
    output: RegistryFile[]
  }
  "desktop:read-skill-registry-file": {
    input: RegistryFileRef
    output: RegistryFileContent
  }
  "desktop:get-skill-registry-security": {
    input: RegistryVersionRef
    output: RegistrySecuritySnapshot
  }
  "desktop:download-skill-registry-skill": {
    input: RegistryVersionRef
    output: DownloadedRegistrySkill
  }
  "desktop:list-downloaded-registry-skills": {
    input: void
    output: DownloadedRegistrySkill[]
  }
  "desktop:set-downloaded-registry-skill-enabled": {
    input: { id: string; enabled: boolean }
    output: DesktopRegistrySkillMutationResult
  }
  "desktop:delete-downloaded-registry-skill": {
    input: { id: string }
    output: DesktopRegistrySkillDeleteResult
  }
  "desktop:read-downloaded-registry-skill-file": {
    input: { id: string; path: string; version?: string }
    output: RegistryFileContent
  }
  "desktop:list-downloaded-registry-skill-files": {
    input: { id: string; version?: string }
    output: RegistryFile[]
  }
  "desktop:fork-downloaded-registry-skill": {
    input: { id: string; name?: string }
    output: DesktopRegistrySkillForkResult
  }
  "desktop:preview-downloaded-registry-skill-update": {
    input: { id: string; version?: string }
    output: DesktopRegistrySkillUpdatePreview
  }
  "desktop:update-downloaded-registry-skill": {
    input: { id: string; version?: string }
    output: DownloadedRegistrySkill
  }
  "desktop:rollback-downloaded-registry-skill": {
    input: { id: string; version?: string }
    output: DesktopRegistrySkillMutationResult
  }
  "desktop:get-prompt-presets": {
    input: void
    output: AgentPromptPresetSummary[]
  }
  "desktop:get-prompt-preset-selection": {
    input: void
    output: AgentPromptPresetSelection
  }
  "desktop:read-prompt-preset": {
    input: { presetID: string }
    output: AgentPromptPresetDocument
  }
  "desktop:update-prompt-preset": {
    input: { presetID: string; label?: string; content: string; description?: string }
    output: AgentPromptPresetDocument
  }
  "desktop:update-prompt-preset-selection": {
    input: AgentPromptPresetSelection
    output: AgentPromptPresetSelection
  }
  "desktop:create-prompt-preset": {
    input: { label?: string; content?: string; description?: string }
    output: AgentPromptPresetDocument
  }
  "desktop:translate-prompt-preset": {
    input: PromptPresetTranslationInput
    output: AgentPromptPresetDocument
  }
  "desktop:preview-prompt-url-install": {
    input: { source: string }
    output: AgentPromptUrlInstallPreview
  }
  "desktop:install-prompts-from-url": {
    input: { previewID: string; promptIDs: string[] }
    output: AgentPromptUrlInstallResult
  }
  "desktop:reset-prompt-preset": {
    input: { presetID: string }
    output: AgentPromptPresetDocument
  }
  "desktop:delete-prompt-preset": {
    input: { presetID: string }
    output: AgentPromptPresetSelection
  }
  "desktop:get-global-skills-tree": {
    input: void
    output: AgentGlobalSkillTree
  }
  "desktop:read-global-skill-file": {
    input: { path: string }
    output: AgentGlobalSkillFileDocument
  }
  "desktop:search-workspace-files": {
    input: { directory: string; query: string }
    output: AgentWorkspaceFileSearchResult[]
  }
  "desktop:list-workspace-directory": {
    input: { directory: string; path?: string | null }
    output: AgentWorkspaceDirectoryEntry[]
  }
  "desktop:read-workspace-file": {
    input: { directory: string; path: string }
    output: AgentWorkspaceFileDocument
  }
  "desktop:update-global-skill-file": {
    input: { path: string; content: string }
    output: AgentGlobalSkillFileDocument
  }
  "desktop:create-global-skill": {
    input: { name: string; parentDirectory?: string | null }
    output: { directory: string; file: AgentGlobalSkillFileDocument }
  }
  "desktop:preview-global-skill-git-install": {
    input: { source: string; parentDirectory?: string | null }
    output: AgentSkillGitInstallPreview
  }
  "desktop:install-global-skills-from-git": {
    input: { previewID: string; skillIDs: string[]; parentDirectory?: string | null }
    output: AgentSkillGitInstallResult
  }
  "desktop:install-global-skill-from-local-file": {
    input: { parentDirectory?: string | null } | undefined
    output: AgentSkillGitInstallResult | null
  }
  "desktop:rename-global-skill": {
    input: { directory: string; name: string }
    output: AgentGlobalSkillRenameResult
  }
  "desktop:delete-global-skill": {
    input: { directory: string }
    output: { directory: string; removed: boolean }
  }
  "desktop:create-global-skill-folder": {
    input: { name: string; parentDirectory?: string | null }
    output: AgentGlobalSkillFolderResult
  }
  "desktop:rename-global-skill-folder": {
    input: { directory: string; name: string }
    output: AgentGlobalSkillFolderRenameResult
  }
  "desktop:delete-global-skill-folder": {
    input: { directory: string }
    output: { directory: string; removed: boolean }
  }
  "desktop:move-global-skill-directory": {
    input: { directory: string; parentDirectory?: string | null }
    output: AgentGlobalSkillMoveResult
  }
  "desktop:get-project-provider-catalog": {
    input: { projectID: string }
    output: AgentProviderCatalogItem[]
  }
  "desktop:refresh-project-provider-catalog": {
    input: { projectID: string }
    output: AgentProviderCatalogItem[]
  }
  "desktop:get-project-models": {
    input: { projectID: string }
    output: AgentProjectModelsResult
  }
  "desktop:get-project-model-catalog": {
    input: { projectID: string }
    output: AgentModelCatalogResult
  }
  "desktop:get-session-models": {
    input: { sessionID: string }
    output: AgentProjectModelsResult
  }
  "desktop:update-project-provider": {
    input: { projectID: string; providerID: string; provider: DesktopProviderMutationInput }
    output: DesktopProviderMutationResult
  }
  "desktop:delete-project-provider": {
    input: { projectID: string; providerID: string }
    output: DesktopProviderDeleteResult
  }
  "desktop:update-project-model-selection": {
    input: { projectID: string } & DesktopModelSelectionUpdateInput
    output: AgentProjectModelSelection
  }
  "desktop:update-session-model-selection": {
    input: { sessionID: string } & DesktopModelSelectionUpdateInput
    output: AgentProjectModelSelection
  }
  "desktop:get-project-skills": {
    input: { projectID: string }
    output: AgentSkillInfo[]
  }
  "desktop:get-project-skill-selection": {
    input: { projectID: string }
    output: AgentProjectSkillSelection
  }
  "desktop:update-project-skill-selection": {
    input: { projectID: string; skillIDs: string[] }
    output: AgentProjectSkillSelection
  }
  "desktop:get-project-plugins": {
    input: { projectID: string }
    output: AgentInstalledPlugin[]
  }
  "desktop:get-project-plugin-selection": {
    input: { projectID: string }
    output: AgentProjectPluginSelection
  }
  "desktop:update-project-plugin-selection": {
    input: { projectID: string; pluginIDs: string[] }
    output: AgentProjectPluginSelection
  }
  "desktop:get-project-mcp-selection": {
    input: { projectID: string }
    output: AgentProjectMcpSelection
  }
  "desktop:update-project-mcp-selection": {
    input: { projectID: string; serverIDs: string[] }
    output: AgentProjectMcpSelection
  }
  "desktop:get-project-mcp-servers": {
    input: { projectID: string }
    output: AgentMcpServerSummary[]
  }
  "desktop:get-project-mcp-server-diagnostic": {
    input: { projectID: string; serverID: string }
    output: AgentMcpServerDiagnostic
  }
  "desktop:update-project-mcp-server": {
    input: { projectID: string; serverID: string; server: McpServerInput }
    output: AgentMcpServerSummary
  }
  "desktop:delete-project-mcp-server": {
    input: { projectID: string; serverID: string }
    output: { serverID: string; removed: boolean }
  }
  "desktop:agent-session-load-history": {
    input: {
      backendSessionID: string
      view?: "active" | "all" | "branch"
      headMessageID?: string
    }
    output: AgentSessionHistoryMessage[]
  }
  "desktop:agent-session-compact": {
    input: { backendSessionID: string }
    output: AgentSessionCompactResult
  }
  "desktop:update-session-active-message": {
    input: { sessionID: string; messageID: string }
    output: AgentWorkspaceSession
  }
  "desktop:rollback-session-to-checkpoint": {
    input: DesktopSessionRollbackInput
    output: DesktopSessionRollbackResult
  }
  "desktop:agent-session-send-turn": {
    input: AgentSessionTurnRequestInput
    output: DesktopAgentSessionTurnResult
  }
  "desktop:agent-session-resume-turn": {
    input: { clientTurnID: string; backendSessionID: string }
    output: DesktopAgentSessionTurnResult
  }
  "desktop:agent-session-cancel-turn": {
    input: { clientTurnID: string; backendSessionID: string; executionID?: string }
    output: DesktopAgentSessionCancelTurnResult
  }
  "desktop:agent-session-abort-turn": {
    input: { clientTurnID: string; backendSessionID: string }
    output: DesktopAgentSessionAbortTurnResult
  }
  "desktop:agent-session-interrupt": {
    input: {
      backendSessionID: string
      clientTurnID?: string
      executionID?: string
      reason?: "user-interrupt"
    }
    output: DesktopAgentSessionInterruptResult
  }
  "desktop:agent-session-answer-question": {
    input: { backendSessionID: string } & AgentSessionQuestionAnswerInput
    output: AgentSessionQuestionAnswerResult
  }
  "desktop:agent-session-subscribe": {
    input: { uiSessionID?: string; backendSessionID: string }
    output: DesktopAgentSessionSubscriptionResult
  }
  "desktop:agent-session-unsubscribe": {
    input: { backendSessionID: string }
    output: DesktopAgentSessionUnsubscribeResult
  }
  "desktop:agent-session-load-permission-requests": {
    input: { backendSessionID: string }
    output: PermissionRequestPrompt[]
  }
  "desktop:agent-session-respond-permission-request": {
    input: PermissionResolveInput
    output: PermissionResolveResult
  }
}

export interface DesktopIpcEventPayloads {
  [DESKTOP_APP_UPDATE_STATE_EVENT_CHANNEL]: DesktopAppUpdateState
  [DESKTOP_AGENT_SESSION_EVENT_CHANNEL]: AgentSessionBridgeIPCEvent
  [DESKTOP_AUTOMATION_EVENT_CHANNEL]: AgentAutomationIPCEvent
  [DESKTOP_ENVIRONMENT_EVENT_CHANNEL]: AgentEnvironmentIPCEvent
  [DESKTOP_MOBILE_BRIDGE_EVENT_CHANNEL]: MobileBridgeDesktopEvent
  [DESKTOP_WORKSPACE_FILE_CHANGE_EVENT_CHANNEL]: WorkspaceFileChangeIPCEvent
  [DESKTOP_PTY_EVENT_CHANNEL]: PtyTransportIPCEvent
  [DESKTOP_WINDOW_STATE_EVENT_CHANNEL]: DesktopWindowState
  [DESKTOP_WORKBENCH_STATE_EVENT_CHANNEL]: WorkbenchStateEvent
  [DESKTOP_APPEARANCE_STATE_EVENT_CHANNEL]: AppearanceRuntimeState
  [DESKTOP_SEMANTIC_TOKEN_INSPECTOR_EVENT_CHANNEL]: SemanticTokenInspectorEvent
}

export type DesktopIpcChannel = keyof DesktopIpcContract
export type DesktopIpcEventChannel = keyof DesktopIpcEventPayloads
export type DesktopIpcInput<Channel extends DesktopIpcChannel> = DesktopIpcContract[Channel]["input"]
export type DesktopIpcOutput<Channel extends DesktopIpcChannel> = DesktopIpcContract[Channel]["output"]
export type DesktopIpcEventPayload<Channel extends DesktopIpcEventChannel> = DesktopIpcEventPayloads[Channel]

export interface DesktopAgentSessionApi {
  loadHistory(input: DesktopIpcInput<"desktop:agent-session-load-history">): Promise<DesktopIpcOutput<"desktop:agent-session-load-history">>
  compact?(input: DesktopIpcInput<"desktop:agent-session-compact">): Promise<DesktopIpcOutput<"desktop:agent-session-compact">>
  sendTurn(input: DesktopIpcInput<"desktop:agent-session-send-turn">): Promise<DesktopIpcOutput<"desktop:agent-session-send-turn">>
  resumeTurn(input: DesktopIpcInput<"desktop:agent-session-resume-turn">): Promise<DesktopIpcOutput<"desktop:agent-session-resume-turn">>
  cancelTurn(input: DesktopIpcInput<"desktop:agent-session-cancel-turn">): Promise<DesktopIpcOutput<"desktop:agent-session-cancel-turn">>
  abortTurn?(input: DesktopIpcInput<"desktop:agent-session-abort-turn">): Promise<DesktopIpcOutput<"desktop:agent-session-abort-turn">>
  interrupt(input: DesktopIpcInput<"desktop:agent-session-interrupt">): Promise<DesktopIpcOutput<"desktop:agent-session-interrupt">>
  answerQuestion(input: DesktopIpcInput<"desktop:agent-session-answer-question">): Promise<DesktopIpcOutput<"desktop:agent-session-answer-question">>
  subscribe(input: DesktopIpcInput<"desktop:agent-session-subscribe">): Promise<DesktopIpcOutput<"desktop:agent-session-subscribe">>
  unsubscribe(input: DesktopIpcInput<"desktop:agent-session-unsubscribe">): Promise<DesktopIpcOutput<"desktop:agent-session-unsubscribe">>
  loadPermissionRequests(input: DesktopIpcInput<"desktop:agent-session-load-permission-requests">): Promise<DesktopIpcOutput<"desktop:agent-session-load-permission-requests">>
  respondPermissionRequest(input: DesktopIpcInput<"desktop:agent-session-respond-permission-request">): Promise<DesktopIpcOutput<"desktop:agent-session-respond-permission-request">>
  onEvent(listener: (event: DesktopIpcEventPayload<typeof DESKTOP_AGENT_SESSION_EVENT_CHANNEL>) => void): () => void
}

export interface DesktopApiBase {
  platform: string
  previewGuestPreloadPath?: string
  versions: Partial<NodeJS.ProcessVersions>
}

export interface DesktopRuntimeCapabilities {
  developmentFeaturesEnabled: boolean
  appearanceAuthoringEnabled: boolean
}

export interface DesktopApiMethods {
  getInfo(): Promise<DesktopIpcOutput<"desktop:get-info">>
  getRuntimeCapabilities(): Promise<DesktopIpcOutput<"desktop:get-runtime-capabilities">>
  startSemanticTokenInspector(): Promise<DesktopIpcOutput<"desktop:start-semantic-token-inspector">>
  inspectSemanticTokenAtPoint(
    input: DesktopIpcInput<"desktop:inspect-semantic-token-at-point">,
  ): Promise<DesktopIpcOutput<"desktop:inspect-semantic-token-at-point">>
  stopSemanticTokenInspector(): Promise<DesktopIpcOutput<"desktop:stop-semantic-token-inspector">>
  prepareSemanticTokenAuthoringCommit(
    input: DesktopIpcInput<"desktop:prepare-semantic-token-authoring-commit">,
  ): Promise<DesktopIpcOutput<"desktop:prepare-semantic-token-authoring-commit">>
  commitSemanticTokenAuthoringCommit(
    input: DesktopIpcInput<"desktop:commit-semantic-token-authoring-commit">,
  ): Promise<DesktopIpcOutput<"desktop:commit-semantic-token-authoring-commit">>
  discardSemanticTokenAuthoringCommit(
    input: DesktopIpcInput<"desktop:discard-semantic-token-authoring-commit">,
  ): Promise<DesktopIpcOutput<"desktop:discard-semantic-token-authoring-commit">>
  onSemanticTokenInspectorEvent(
    listener: (
      event: DesktopIpcEventPayload<typeof DESKTOP_SEMANTIC_TOKEN_INSPECTOR_EVENT_CHANNEL>
    ) => void,
  ): () => void
  getAppUpdateSettings(): Promise<DesktopIpcOutput<"desktop:get-app-update-settings">>
  getAppUpdateState(): Promise<DesktopIpcOutput<"desktop:get-app-update-state">>
  setAutomaticUpdatesEnabled(
    input: DesktopIpcInput<"desktop:set-automatic-updates-enabled">,
  ): Promise<DesktopIpcOutput<"desktop:set-automatic-updates-enabled">>
  checkForAppUpdates(): Promise<DesktopIpcOutput<"desktop:check-for-app-updates">>
  installAppUpdate(): Promise<DesktopIpcOutput<"desktop:install-app-update">>
  getRunningSessionStatus?(): Promise<DesktopIpcOutput<"desktop:get-running-session-status">>
  onAppUpdateStateChange(
    listener: (state: DesktopIpcEventPayload<typeof DESKTOP_APP_UPDATE_STATE_EVENT_CHANNEL>) => void,
  ): () => void
  getStoragePaths(): Promise<DesktopIpcOutput<"desktop:get-storage-paths">>
  getStorageUsage(): Promise<DesktopIpcOutput<"desktop:get-storage-usage">>
  optimizeStorage(): Promise<DesktopIpcOutput<"desktop:optimize-storage">>
  getWindowState(): Promise<DesktopIpcOutput<"desktop:get-window-state">>
  reportRendererError(input: DesktopIpcInput<"desktop:report-renderer-error">): Promise<DesktopIpcOutput<"desktop:report-renderer-error">>
  reportRendererMemoryDiagnostics(input: DesktopIpcInput<"desktop:report-renderer-memory-diagnostics">): Promise<DesktopIpcOutput<"desktop:report-renderer-memory-diagnostics">>
  getRendererMemoryDiagnostics(): Promise<DesktopIpcOutput<"desktop:get-renderer-memory-diagnostics">>
  getWorkbenchWindowContext(): Promise<DesktopIpcOutput<"desktop:get-workbench-window-context">>
  publishWorkbenchSnapshot(input: DesktopIpcInput<"desktop:workbench-publish-state-snapshot">): Promise<DesktopIpcOutput<"desktop:workbench-publish-state-snapshot">>
  detachSessionPanel(input: DesktopIpcInput<"desktop:workbench-detach-session-panel">): Promise<DesktopIpcOutput<"desktop:workbench-detach-session-panel">>
  markWorkbenchWindowReady(input: DesktopIpcInput<"desktop:workbench-window-ready">): Promise<DesktopIpcOutput<"desktop:workbench-window-ready">>
  markWorkbenchPanelMounted(input: DesktopIpcInput<"desktop:workbench-panel-mounted">): Promise<DesktopIpcOutput<"desktop:workbench-panel-mounted">>
  dockSessionPanel(input: DesktopIpcInput<"desktop:workbench-dock-session-panel">): Promise<DesktopIpcOutput<"desktop:workbench-dock-session-panel">>
  moveWorkbenchPanel(input: DesktopIpcInput<"desktop:workbench-move-session-panel">): Promise<DesktopIpcOutput<"desktop:workbench-move-session-panel">>
  focusWorkbenchPanel(input: DesktopIpcInput<"desktop:workbench-focus-session-panel">): Promise<DesktopIpcOutput<"desktop:workbench-focus-session-panel">>
  beginWorkbenchPanelDrag(input: DesktopIpcInput<"desktop:workbench-begin-panel-drag">): Promise<DesktopIpcOutput<"desktop:workbench-begin-panel-drag">>
  endWorkbenchPanelDrag(input: DesktopIpcInput<"desktop:workbench-end-panel-drag">): Promise<DesktopIpcOutput<"desktop:workbench-end-panel-drag">>
  getWorkbenchPanelDrag(input: DesktopIpcInput<"desktop:workbench-get-panel-drag">): Promise<DesktopIpcOutput<"desktop:workbench-get-panel-drag">>
  getAppearanceConfig(): Promise<DesktopIpcOutput<"desktop:get-appearance-config">>
  saveAppearanceConfig(input: DesktopIpcInput<"desktop:save-appearance-config">): Promise<DesktopIpcOutput<"desktop:save-appearance-config">>
  publishAppearanceState(input: DesktopIpcInput<"desktop:publish-appearance-state">): Promise<DesktopIpcOutput<"desktop:publish-appearance-state">>
  getAppearanceThemes(): Promise<DesktopIpcOutput<"desktop:get-appearance-themes">>
  saveAppearanceTheme(input: DesktopIpcInput<"desktop:save-appearance-theme">): Promise<DesktopIpcOutput<"desktop:save-appearance-theme">>
  deleteAppearanceTheme(input: DesktopIpcInput<"desktop:delete-appearance-theme">): Promise<DesktopIpcOutput<"desktop:delete-appearance-theme">>
  setActiveAppearanceTheme(input: DesktopIpcInput<"desktop:set-active-appearance-theme">): Promise<DesktopIpcOutput<"desktop:set-active-appearance-theme">>
  duplicateAppearanceTheme(input: DesktopIpcInput<"desktop:duplicate-appearance-theme">): Promise<DesktopIpcOutput<"desktop:duplicate-appearance-theme">>
  renameAppearanceTheme(input: DesktopIpcInput<"desktop:rename-appearance-theme">): Promise<DesktopIpcOutput<"desktop:rename-appearance-theme">>
  getLocaleConfig(): Promise<DesktopIpcOutput<"desktop:get-locale-config">>
  saveLocaleConfig(input: DesktopIpcInput<"desktop:save-locale-config">): Promise<DesktopIpcOutput<"desktop:save-locale-config">>
  showMenu(menuKey: MenuKey, anchor?: MenuAnchor): Promise<DesktopIpcOutput<"desktop:show-menu">>
  showExternalEditorMenu(input: DesktopIpcInput<"desktop:show-external-editor-menu">): Promise<DesktopIpcOutput<"desktop:show-external-editor-menu">>
  listExternalEditorsForTarget(input: DesktopIpcInput<"desktop:list-external-editors-for-target">): Promise<DesktopIpcOutput<"desktop:list-external-editors-for-target">>
  openInExternalEditor(input: DesktopIpcInput<"desktop:open-in-external-editor">): Promise<DesktopIpcOutput<"desktop:open-in-external-editor">>
  openExternalUrl(input: DesktopIpcInput<"desktop:open-external-url">): Promise<DesktopIpcOutput<"desktop:open-external-url">>
  openPath(input: DesktopIpcInput<"desktop:open-path">): Promise<DesktopIpcOutput<"desktop:open-path">>
  openCinemaProject(input: DesktopIpcInput<"desktop:open-cinema-project">): Promise<DesktopIpcOutput<"desktop:open-cinema-project">>
  openMonitorWindow(): Promise<DesktopIpcOutput<"desktop:open-monitor-window">>
  openAppearanceWindow(): Promise<DesktopIpcOutput<"desktop:open-appearance-window">>
  windowAction(action: DesktopIpcInput<"desktop:window-action">): Promise<DesktopIpcOutput<"desktop:window-action">>
  getAgentConfig(): Promise<DesktopIpcOutput<"desktop:get-agent-config">>
  getAgentHealth(): Promise<DesktopIpcOutput<"desktop:agent-health">>
  getMobileBridgeStatus(): Promise<DesktopIpcOutput<"desktop:get-mobile-bridge-status">>
  refreshMobilePairingCode(): Promise<DesktopIpcOutput<"desktop:refresh-mobile-pairing-code">>
  rotateMobileBridgeToken(): Promise<DesktopIpcOutput<"desktop:rotate-mobile-bridge-token">>
  revokeMobileDevice(input: DesktopIpcInput<"desktop:revoke-mobile-device">): Promise<DesktopIpcOutput<"desktop:revoke-mobile-device">>
  createPtySession(input: DesktopIpcInput<"desktop:create-pty-session">): Promise<DesktopIpcOutput<"desktop:create-pty-session">>
  getPtySession(input: DesktopIpcInput<"desktop:get-pty-session">): Promise<DesktopIpcOutput<"desktop:get-pty-session">>
  updatePtySession(input: DesktopIpcInput<"desktop:update-pty-session">): Promise<DesktopIpcOutput<"desktop:update-pty-session">>
  deletePtySession(input: DesktopIpcInput<"desktop:delete-pty-session">): Promise<DesktopIpcOutput<"desktop:delete-pty-session">>
  attachPtySession(input: DesktopIpcInput<"desktop:attach-pty-session">): Promise<DesktopIpcOutput<"desktop:attach-pty-session">>
  detachPtySession(input: DesktopIpcInput<"desktop:detach-pty-session">): Promise<DesktopIpcOutput<"desktop:detach-pty-session">>
  writePtyInput(input: DesktopIpcInput<"desktop:write-pty-input">): Promise<DesktopIpcOutput<"desktop:write-pty-input">>
  pickProjectDirectory(): Promise<DesktopIpcOutput<"desktop:pick-project-directory">>
  pickComposerAttachments(input?: DesktopIpcInput<"desktop:pick-composer-attachments">): Promise<DesktopIpcOutput<"desktop:pick-composer-attachments">>
  saveComposerPastedImages(input: DesktopIpcInput<"desktop:save-composer-pasted-images">): Promise<DesktopIpcOutput<"desktop:save-composer-pasted-images">>
  copyImageToClipboard?(input: DesktopIpcInput<"desktop:copy-image-to-clipboard">): Promise<DesktopIpcOutput<"desktop:copy-image-to-clipboard">>
  saveImageToFolder?(input: DesktopIpcInput<"desktop:save-image-to-folder">): Promise<DesktopIpcOutput<"desktop:save-image-to-folder">>
  capturePreviewScreenshot(input: DesktopIpcInput<"desktop:capture-preview-screenshot">): Promise<DesktopIpcOutput<"desktop:capture-preview-screenshot">>
  detectLocalPreviewServices(): Promise<DesktopIpcOutput<"desktop:detect-local-preview-services">>
  resolvePreviewTarget(input: DesktopIpcInput<"desktop:resolve-preview-target">): Promise<DesktopIpcOutput<"desktop:resolve-preview-target">>
  readPreviewText(input: DesktopIpcInput<"desktop:read-preview-text">): Promise<DesktopIpcOutput<"desktop:read-preview-text">>
  gitGetCapabilities(input: DesktopIpcInput<"desktop:git-get-capabilities">): Promise<DesktopIpcOutput<"desktop:git-get-capabilities">>
  gitCommit(input: DesktopIpcInput<"desktop:git-commit">): Promise<DesktopIpcOutput<"desktop:git-commit">>
  gitGenerateCommitMessage(input: DesktopIpcInput<"desktop:git-generate-commit-message">): Promise<DesktopIpcOutput<"desktop:git-generate-commit-message">>
  gitPush(input: DesktopIpcInput<"desktop:git-push">): Promise<DesktopIpcOutput<"desktop:git-push">>
  gitCreateBranch(input: DesktopIpcInput<"desktop:git-create-branch">): Promise<DesktopIpcOutput<"desktop:git-create-branch">>
  gitListBranches(input: DesktopIpcInput<"desktop:git-list-branches">): Promise<DesktopIpcOutput<"desktop:git-list-branches">>
  gitCheckoutBranch(input: DesktopIpcInput<"desktop:git-checkout-branch">): Promise<DesktopIpcOutput<"desktop:git-checkout-branch">>
  gitCreatePullRequest(input: DesktopIpcInput<"desktop:git-create-pull-request">): Promise<DesktopIpcOutput<"desktop:git-create-pull-request">>
  updateWorkspaceWatchDirectories(input: DesktopIpcInput<"desktop:update-workspace-watch-directories">): Promise<DesktopIpcOutput<"desktop:update-workspace-watch-directories">>
  listFolderWorkspaces(): Promise<DesktopIpcOutput<"desktop:list-folder-workspaces">>
  listProjectWorkspaces(): Promise<DesktopIpcOutput<"desktop:list-project-workspaces">>
  listProjectWorktrees(input: DesktopIpcInput<"desktop:list-project-worktrees">): Promise<DesktopIpcOutput<"desktop:list-project-worktrees">>
  createProjectWorktree(input: DesktopIpcInput<"desktop:create-project-worktree">): Promise<DesktopIpcOutput<"desktop:create-project-worktree">>
  refreshProjectWorktree(input: DesktopIpcInput<"desktop:refresh-project-worktree">): Promise<DesktopIpcOutput<"desktop:refresh-project-worktree">>
  deleteProjectWorktree(input: DesktopIpcInput<"desktop:delete-project-worktree">): Promise<DesktopIpcOutput<"desktop:delete-project-worktree">>
  listProjectEnvironments(input: DesktopIpcInput<"desktop:list-project-environments">): Promise<DesktopIpcOutput<"desktop:list-project-environments">>
  saveProjectEnvironment(input: DesktopIpcInput<"desktop:save-project-environment">): Promise<DesktopIpcOutput<"desktop:save-project-environment">>
  importProjectEnvironment(input: DesktopIpcInput<"desktop:import-project-environment">): Promise<DesktopIpcOutput<"desktop:import-project-environment">>
  updateProjectEnvironmentPreference(
    input: DesktopIpcInput<"desktop:update-project-environment-preference">,
  ): Promise<DesktopIpcOutput<"desktop:update-project-environment-preference">>
  trustProjectEnvironment(input: DesktopIpcInput<"desktop:trust-project-environment">): Promise<DesktopIpcOutput<"desktop:trust-project-environment">>
  revokeProjectEnvironmentTrust(
    input: DesktopIpcInput<"desktop:revoke-project-environment-trust">,
  ): Promise<DesktopIpcOutput<"desktop:revoke-project-environment-trust">>
  getEnvironmentRun(input: DesktopIpcInput<"desktop:get-environment-run">): Promise<DesktopIpcOutput<"desktop:get-environment-run">>
  cancelEnvironmentRun(input: DesktopIpcInput<"desktop:cancel-environment-run">): Promise<DesktopIpcOutput<"desktop:cancel-environment-run">>
  retryEnvironmentRun(input: DesktopIpcInput<"desktop:retry-environment-run">): Promise<DesktopIpcOutput<"desktop:retry-environment-run">>
  startEnvironmentAction(input: DesktopIpcInput<"desktop:start-environment-action">): Promise<DesktopIpcOutput<"desktop:start-environment-action">>
  stopEnvironmentAction(input: DesktopIpcInput<"desktop:stop-environment-action">): Promise<DesktopIpcOutput<"desktop:stop-environment-action">>
  restartEnvironmentSetup(input: DesktopIpcInput<"desktop:restart-environment-setup">): Promise<DesktopIpcOutput<"desktop:restart-environment-setup">>
  onEnvironmentEvent(
    listener: (event: DesktopIpcEventPayload<typeof DESKTOP_ENVIRONMENT_EVENT_CHANNEL>) => void,
  ): () => void
  openFolderWorkspace(input: DesktopIpcInput<"desktop:open-folder-workspace">): Promise<DesktopIpcOutput<"desktop:open-folder-workspace">>
  listSshProfiles(): Promise<DesktopIpcOutput<"desktop:list-ssh-profiles">>
  saveSshProfile(input: DesktopIpcInput<"desktop:save-ssh-profile">): Promise<DesktopIpcOutput<"desktop:save-ssh-profile">>
  deleteSshProfile(input: DesktopIpcInput<"desktop:delete-ssh-profile">): Promise<DesktopIpcOutput<"desktop:delete-ssh-profile">>
  testSshProfile(input: DesktopIpcInput<"desktop:test-ssh-profile">): Promise<DesktopIpcOutput<"desktop:test-ssh-profile">>
  listSshDirectory(input: DesktopIpcInput<"desktop:list-ssh-directory">): Promise<DesktopIpcOutput<"desktop:list-ssh-directory">>
  openSshFolderWorkspace(input: DesktopIpcInput<"desktop:open-ssh-folder-workspace">): Promise<DesktopIpcOutput<"desktop:open-ssh-folder-workspace">>
  createProjectWorkspace(input: DesktopIpcInput<"desktop:create-project-workspace">): Promise<DesktopIpcOutput<"desktop:create-project-workspace">>
  createAgentSession(input?: DesktopIpcInput<"desktop:agent-create-session">): Promise<DesktopIpcOutput<"desktop:agent-create-session">>
  createFolderSession(input: DesktopIpcInput<"desktop:create-folder-session">): Promise<DesktopIpcOutput<"desktop:create-folder-session">>
  createProjectSession(input: DesktopIpcInput<"desktop:create-project-session">): Promise<DesktopIpcOutput<"desktop:create-project-session">>
  updateSessionTitle(input: DesktopIpcInput<"desktop:update-session-title">): Promise<DesktopIpcOutput<"desktop:update-session-title">>
  updateSessionPinned(input: DesktopIpcInput<"desktop:update-session-pinned">): Promise<DesktopIpcOutput<"desktop:update-session-pinned">>
  updateSessionWorkflow(input: DesktopIpcInput<"desktop:update-session-workflow">): Promise<DesktopIpcOutput<"desktop:update-session-workflow">>
  updateSessionActiveMessage(input: DesktopIpcInput<"desktop:update-session-active-message">): Promise<DesktopIpcOutput<"desktop:update-session-active-message">>
  rollbackSessionToCheckpoint(input: DesktopIpcInput<"desktop:rollback-session-to-checkpoint">): Promise<DesktopIpcOutput<"desktop:rollback-session-to-checkpoint">>
  deleteProjectWorkspace(input: DesktopIpcInput<"desktop:delete-project-workspace">): Promise<DesktopIpcOutput<"desktop:delete-project-workspace">>
  deleteAgentSession(input: DesktopIpcInput<"desktop:delete-agent-session">): Promise<DesktopIpcOutput<"desktop:delete-agent-session">>
  archiveAgentSession(input: DesktopIpcInput<"desktop:archive-agent-session">): Promise<DesktopIpcOutput<"desktop:archive-agent-session">>
  listArchivedSessions(): Promise<DesktopIpcOutput<"desktop:list-archived-sessions">>
  restoreArchivedSession(input: DesktopIpcInput<"desktop:restore-archived-session">): Promise<DesktopIpcOutput<"desktop:restore-archived-session">>
  deleteArchivedSession(input: DesktopIpcInput<"desktop:delete-archived-session">): Promise<DesktopIpcOutput<"desktop:delete-archived-session">>
  getSessionDiff(input: DesktopIpcInput<"desktop:get-session-diff">): Promise<DesktopIpcOutput<"desktop:get-session-diff">>
  getSessionTasks(input: DesktopIpcInput<"desktop:get-session-tasks">): Promise<DesktopIpcOutput<"desktop:get-session-tasks">>
  getSessionBackgroundProcesses(input: DesktopIpcInput<"desktop:get-session-background-processes">): Promise<DesktopIpcOutput<"desktop:get-session-background-processes">>
  terminateSessionBackgroundProcess(input: DesktopIpcInput<"desktop:terminate-session-background-process">): Promise<DesktopIpcOutput<"desktop:terminate-session-background-process">>
  terminateAllSessionBackgroundProcesses(input: DesktopIpcInput<"desktop:terminate-all-session-background-processes">): Promise<DesktopIpcOutput<"desktop:terminate-all-session-background-processes">>
  restoreWorkspaceDiffFile(input: DesktopIpcInput<"desktop:restore-workspace-diff-file">): Promise<DesktopIpcOutput<"desktop:restore-workspace-diff-file">>
  stageWorkspaceDiffFile(input: DesktopIpcInput<"desktop:stage-workspace-diff-file">): Promise<DesktopIpcOutput<"desktop:stage-workspace-diff-file">>
  unstageWorkspaceDiffFile(input: DesktopIpcInput<"desktop:unstage-workspace-diff-file">): Promise<DesktopIpcOutput<"desktop:unstage-workspace-diff-file">>
  reverseApplyWorkspaceDiffPatches(input: DesktopIpcInput<"desktop:reverse-apply-workspace-diff-patches">): Promise<DesktopIpcOutput<"desktop:reverse-apply-workspace-diff-patches">>
  getSessionRuntimeDebug(input: DesktopIpcInput<"desktop:get-session-runtime-debug">): Promise<DesktopIpcOutput<"desktop:get-session-runtime-debug">>
  getSessionTraceExport(input: DesktopIpcInput<"desktop:get-session-trace-export">): Promise<DesktopIpcOutput<"desktop:get-session-trace-export">>
  saveSessionTraceExport(input: DesktopIpcInput<"desktop:save-session-trace-export">): Promise<DesktopIpcOutput<"desktop:save-session-trace-export">>
  saveSessionTraceExportDirectory(input: DesktopIpcInput<"desktop:save-session-trace-export-directory">): Promise<DesktopIpcOutput<"desktop:save-session-trace-export-directory">>
  saveSessionTraceExportRawDirectory(input: DesktopIpcInput<"desktop:save-session-trace-export-raw-directory">): Promise<DesktopIpcOutput<"desktop:save-session-trace-export-raw-directory">>
  saveSessionTraceExportToProject(input: DesktopIpcInput<"desktop:save-session-trace-export-to-project">): Promise<DesktopIpcOutput<"desktop:save-session-trace-export-to-project">>
  prepareSessionBagSubmission(input: DesktopIpcInput<"desktop:prepare-session-bag-submission">): Promise<DesktopIpcOutput<"desktop:prepare-session-bag-submission">>
  uploadSessionBagSubmission(input: DesktopIpcInput<"desktop:upload-session-bag-submission">): Promise<DesktopIpcOutput<"desktop:upload-session-bag-submission">>
  discardSessionBagSubmission(input: DesktopIpcInput<"desktop:discard-session-bag-submission">): Promise<DesktopIpcOutput<"desktop:discard-session-bag-submission">>
  agentSession: DesktopAgentSessionApi
  getGlobalProviderCatalog(): Promise<DesktopIpcOutput<"desktop:get-global-provider-catalog">>
  getAnyboxSubscriptionOverview(): Promise<DesktopIpcOutput<"desktop:get-anybox-subscription-overview">>
  createAnyboxSubscriptionOrder(input: DesktopIpcInput<"desktop:create-anybox-subscription-order">): Promise<DesktopIpcOutput<"desktop:create-anybox-subscription-order">>
  createAnyboxSubscriptionUpgradeQuote(input: DesktopIpcInput<"desktop:create-anybox-subscription-upgrade-quote">): Promise<DesktopIpcOutput<"desktop:create-anybox-subscription-upgrade-quote">>
  createAnyboxSubscriptionUpgradeOrder(input: DesktopIpcInput<"desktop:create-anybox-subscription-upgrade-order">): Promise<DesktopIpcOutput<"desktop:create-anybox-subscription-upgrade-order">>
  getAnyboxSubscriptionOrder(input: DesktopIpcInput<"desktop:get-anybox-subscription-order">): Promise<DesktopIpcOutput<"desktop:get-anybox-subscription-order">>
  cancelAnyboxSubscriptionOrder(input: DesktopIpcInput<"desktop:cancel-anybox-subscription-order">): Promise<DesktopIpcOutput<"desktop:cancel-anybox-subscription-order">>
  createAnyboxRechargeOrder(input: DesktopIpcInput<"desktop:create-anybox-recharge-order">): Promise<DesktopIpcOutput<"desktop:create-anybox-recharge-order">>
  getAnyboxRechargeOrder(input: DesktopIpcInput<"desktop:get-anybox-recharge-order">): Promise<DesktopIpcOutput<"desktop:get-anybox-recharge-order">>
  cancelAnyboxRechargeOrder(input: DesktopIpcInput<"desktop:cancel-anybox-recharge-order">): Promise<DesktopIpcOutput<"desktop:cancel-anybox-recharge-order">>
  refreshGlobalProviderCatalog(): Promise<DesktopIpcOutput<"desktop:refresh-global-provider-catalog">>
  getGlobalProviderAuth(input: DesktopIpcInput<"desktop:get-global-provider-auth">): Promise<DesktopIpcOutput<"desktop:get-global-provider-auth">>
  startGlobalProviderAuthFlow(input: DesktopIpcInput<"desktop:start-global-provider-auth-flow">): Promise<DesktopIpcOutput<"desktop:start-global-provider-auth-flow">>
  getGlobalProviderAuthFlow(input: DesktopIpcInput<"desktop:get-global-provider-auth-flow">): Promise<DesktopIpcOutput<"desktop:get-global-provider-auth-flow">>
  cancelGlobalProviderAuthFlow(input: DesktopIpcInput<"desktop:cancel-global-provider-auth-flow">): Promise<DesktopIpcOutput<"desktop:cancel-global-provider-auth-flow">>
  saveGlobalProviderApiKey(input: DesktopIpcInput<"desktop:save-global-provider-api-key">): Promise<DesktopIpcOutput<"desktop:save-global-provider-api-key">>
  getCinemaVideoProviders(): Promise<DesktopIpcOutput<"desktop:get-cinema-video-providers">>
  refreshCinemaVideoProviderCatalog(): Promise<DesktopIpcOutput<"desktop:refresh-cinema-video-provider-catalog">>
  getCinemaProviderWorkflows(input: DesktopIpcInput<"desktop:get-cinema-provider-workflows">): Promise<DesktopIpcOutput<"desktop:get-cinema-provider-workflows">>
  refreshCinemaProviderWorkflows(input: DesktopIpcInput<"desktop:refresh-cinema-provider-workflows">): Promise<DesktopIpcOutput<"desktop:refresh-cinema-provider-workflows">>
  saveCinemaVideoProviderApiKey(input: DesktopIpcInput<"desktop:save-cinema-video-provider-api-key">): Promise<DesktopIpcOutput<"desktop:save-cinema-video-provider-api-key">>
  saveCinemaVideoProviderSettings(input: DesktopIpcInput<"desktop:save-cinema-video-provider-settings">): Promise<DesktopIpcOutput<"desktop:save-cinema-video-provider-settings">>
  testCinemaVideoProviderConnection(input: DesktopIpcInput<"desktop:test-cinema-video-provider-connection">): Promise<DesktopIpcOutput<"desktop:test-cinema-video-provider-connection">>
  deleteGlobalProviderAuthSession(input: DesktopIpcInput<"desktop:delete-global-provider-auth-session">): Promise<DesktopIpcOutput<"desktop:delete-global-provider-auth-session">>
  testGlobalProviderConnection(input: DesktopIpcInput<"desktop:test-global-provider-connection">): Promise<DesktopIpcOutput<"desktop:test-global-provider-connection">>
  upsertCustomProvider(input: DesktopIpcInput<"desktop:upsert-custom-provider">): Promise<DesktopIpcOutput<"desktop:upsert-custom-provider">>
  testCustomProviderConnection(input: DesktopIpcInput<"desktop:test-custom-provider-connection">): Promise<DesktopIpcOutput<"desktop:test-custom-provider-connection">>
  getGlobalModels(): Promise<DesktopIpcOutput<"desktop:get-global-models">>
  getGlobalModelCatalog(): Promise<DesktopIpcOutput<"desktop:get-global-model-catalog">>
  updateGlobalProvider(input: DesktopIpcInput<"desktop:update-global-provider">): Promise<DesktopIpcOutput<"desktop:update-global-provider">>
  deleteGlobalProvider(input: DesktopIpcInput<"desktop:delete-global-provider">): Promise<DesktopIpcOutput<"desktop:delete-global-provider">>
  updateGlobalModelSelection(input: DesktopIpcInput<"desktop:update-global-model-selection">): Promise<DesktopIpcOutput<"desktop:update-global-model-selection">>
  getGlobalMcpServers(): Promise<DesktopIpcOutput<"desktop:get-global-mcp-servers">>
  getGlobalMcpServerDiagnostic(input: DesktopIpcInput<"desktop:get-global-mcp-server-diagnostic">): Promise<DesktopIpcOutput<"desktop:get-global-mcp-server-diagnostic">>
  updateGlobalMcpServer(input: DesktopIpcInput<"desktop:update-global-mcp-server">): Promise<DesktopIpcOutput<"desktop:update-global-mcp-server">>
  deleteGlobalMcpServer(input: DesktopIpcInput<"desktop:delete-global-mcp-server">): Promise<DesktopIpcOutput<"desktop:delete-global-mcp-server">>
  getPluginCatalog(input?: DesktopIpcInput<"desktop:get-plugin-catalog">): Promise<DesktopIpcOutput<"desktop:get-plugin-catalog">>
  getInstalledPlugins(): Promise<DesktopIpcOutput<"desktop:get-installed-plugins">>
  importPluginFromURL(input: DesktopIpcInput<"desktop:import-plugin-from-url">): Promise<DesktopIpcOutput<"desktop:import-plugin-from-url">>
  installPlugin(input: DesktopIpcInput<"desktop:install-plugin">): Promise<DesktopIpcOutput<"desktop:install-plugin">>
  updateInstalledPlugin(input: DesktopIpcInput<"desktop:update-installed-plugin">): Promise<DesktopIpcOutput<"desktop:update-installed-plugin">>
  updateInstalledPluginMcpControls(input: DesktopIpcInput<"desktop:update-installed-plugin-mcp-controls">): Promise<DesktopIpcOutput<"desktop:update-installed-plugin-mcp-controls">>
  listInstalledPluginSkillEntries(input: DesktopIpcInput<"desktop:list-installed-plugin-skill-entries">): Promise<DesktopIpcOutput<"desktop:list-installed-plugin-skill-entries">>
  readInstalledPluginSkillFile(input: DesktopIpcInput<"desktop:read-installed-plugin-skill-file">): Promise<DesktopIpcOutput<"desktop:read-installed-plugin-skill-file">>
  deleteInstalledPlugin(input: DesktopIpcInput<"desktop:delete-installed-plugin">): Promise<DesktopIpcOutput<"desktop:delete-installed-plugin">>
  getInstalledPluginDiagnostic(input: DesktopIpcInput<"desktop:get-installed-plugin-diagnostic">): Promise<DesktopIpcOutput<"desktop:get-installed-plugin-diagnostic">>
  getConnectorCatalog(): Promise<DesktopIpcOutput<"desktop:get-connector-catalog">>
  getConnectors(): Promise<DesktopIpcOutput<"desktop:get-connectors">>
  getConnector(input: DesktopIpcInput<"desktop:get-connector">): Promise<DesktopIpcOutput<"desktop:get-connector">>
  saveConnectorApiKey(input: DesktopIpcInput<"desktop:save-connector-api-key">): Promise<DesktopIpcOutput<"desktop:save-connector-api-key">>
  deleteConnectorApiKey(input: DesktopIpcInput<"desktop:delete-connector-api-key">): Promise<DesktopIpcOutput<"desktop:delete-connector-api-key">>
  saveConnectorConfig(input: DesktopIpcInput<"desktop:save-connector-config">): Promise<DesktopIpcOutput<"desktop:save-connector-config">>
  deleteConnectorConfig(input: DesktopIpcInput<"desktop:delete-connector-config">): Promise<DesktopIpcOutput<"desktop:delete-connector-config">>
  startConnectorAuthFlow(input: DesktopIpcInput<"desktop:start-connector-auth-flow">): Promise<DesktopIpcOutput<"desktop:start-connector-auth-flow">>
  getConnectorAuthFlow(input: DesktopIpcInput<"desktop:get-connector-auth-flow">): Promise<DesktopIpcOutput<"desktop:get-connector-auth-flow">>
  cancelConnectorAuthFlow(input: DesktopIpcInput<"desktop:cancel-connector-auth-flow">): Promise<DesktopIpcOutput<"desktop:cancel-connector-auth-flow">>
  deleteConnectorAuthSession(input: DesktopIpcInput<"desktop:delete-connector-auth-session">): Promise<DesktopIpcOutput<"desktop:delete-connector-auth-session">>
  getConnectorDiagnostic(input: DesktopIpcInput<"desktop:get-connector-diagnostic">): Promise<DesktopIpcOutput<"desktop:get-connector-diagnostic">>
  getInstalledPluginConnectors(input: DesktopIpcInput<"desktop:get-installed-plugin-connectors">): Promise<DesktopIpcOutput<"desktop:get-installed-plugin-connectors">>
  saveInstalledPluginConnectorApiKey(input: DesktopIpcInput<"desktop:save-installed-plugin-connector-api-key">): Promise<DesktopIpcOutput<"desktop:save-installed-plugin-connector-api-key">>
  deleteInstalledPluginConnectorApiKey(input: DesktopIpcInput<"desktop:delete-installed-plugin-connector-api-key">): Promise<DesktopIpcOutput<"desktop:delete-installed-plugin-connector-api-key">>
  startInstalledPluginConnectorAuthFlow(input: DesktopIpcInput<"desktop:start-installed-plugin-connector-auth-flow">): Promise<DesktopIpcOutput<"desktop:start-installed-plugin-connector-auth-flow">>
  getInstalledPluginConnectorAuthFlow(input: DesktopIpcInput<"desktop:get-installed-plugin-connector-auth-flow">): Promise<DesktopIpcOutput<"desktop:get-installed-plugin-connector-auth-flow">>
  cancelInstalledPluginConnectorAuthFlow(input: DesktopIpcInput<"desktop:cancel-installed-plugin-connector-auth-flow">): Promise<DesktopIpcOutput<"desktop:cancel-installed-plugin-connector-auth-flow">>
  deleteInstalledPluginConnectorAuthSession(input: DesktopIpcInput<"desktop:delete-installed-plugin-connector-auth-session">): Promise<DesktopIpcOutput<"desktop:delete-installed-plugin-connector-auth-session">>
  getInstalledPluginConnectorDiagnostic(input: DesktopIpcInput<"desktop:get-installed-plugin-connector-diagnostic">): Promise<DesktopIpcOutput<"desktop:get-installed-plugin-connector-diagnostic">>
  getBuiltinTools(): Promise<DesktopIpcOutput<"desktop:get-builtin-tools">>
  updateBuiltinToolSelection(input: DesktopIpcInput<"desktop:update-builtin-tool-selection">): Promise<DesktopIpcOutput<"desktop:update-builtin-tool-selection">>
  getToolPermissionMode(): Promise<DesktopIpcOutput<"desktop:get-tool-permission-mode">>
  updateToolPermissionMode(input: DesktopIpcInput<"desktop:update-tool-permission-mode">): Promise<DesktopIpcOutput<"desktop:update-tool-permission-mode">>
  listAutomations(): Promise<DesktopIpcOutput<"desktop:list-automations">>
  createAutomation(input: DesktopIpcInput<"desktop:create-automation">): Promise<DesktopIpcOutput<"desktop:create-automation">>
  updateAutomation(input: DesktopIpcInput<"desktop:update-automation">): Promise<DesktopIpcOutput<"desktop:update-automation">>
  deleteAutomation(input: DesktopIpcInput<"desktop:delete-automation">): Promise<DesktopIpcOutput<"desktop:delete-automation">>
  runAutomation(input: DesktopIpcInput<"desktop:run-automation">): Promise<DesktopIpcOutput<"desktop:run-automation">>
  listAutomationRuns(input?: DesktopIpcInput<"desktop:list-automation-runs">): Promise<DesktopIpcOutput<"desktop:list-automation-runs">>
  updateAutomationRunTriage(input: DesktopIpcInput<"desktop:update-automation-run-triage">): Promise<DesktopIpcOutput<"desktop:update-automation-run-triage">>
  cancelAutomationRun(input: DesktopIpcInput<"desktop:cancel-automation-run">): Promise<DesktopIpcOutput<"desktop:cancel-automation-run">>
  onAutomationEvent(listener: (event: DesktopIpcEventPayload<typeof DESKTOP_AUTOMATION_EVENT_CHANNEL>) => void): () => void
  getGlobalSkills(): Promise<DesktopIpcOutput<"desktop:get-global-skills">>
  getSkillRegistryProviders(): Promise<DesktopIpcOutput<"desktop:get-skill-registry-providers">>
  searchSkillRegistry(input: DesktopIpcInput<"desktop:search-skill-registry">): Promise<DesktopIpcOutput<"desktop:search-skill-registry">>
  getSkillRegistryDetail(input: DesktopIpcInput<"desktop:get-skill-registry-detail">): Promise<DesktopIpcOutput<"desktop:get-skill-registry-detail">>
  getSkillRegistryVersions(input: DesktopIpcInput<"desktop:get-skill-registry-versions">): Promise<DesktopIpcOutput<"desktop:get-skill-registry-versions">>
  getSkillRegistryFiles(input: DesktopIpcInput<"desktop:get-skill-registry-files">): Promise<DesktopIpcOutput<"desktop:get-skill-registry-files">>
  readSkillRegistryFile(input: DesktopIpcInput<"desktop:read-skill-registry-file">): Promise<DesktopIpcOutput<"desktop:read-skill-registry-file">>
  getSkillRegistrySecurity(input: DesktopIpcInput<"desktop:get-skill-registry-security">): Promise<DesktopIpcOutput<"desktop:get-skill-registry-security">>
  downloadSkillRegistrySkill(input: DesktopIpcInput<"desktop:download-skill-registry-skill">): Promise<DesktopIpcOutput<"desktop:download-skill-registry-skill">>
  listDownloadedRegistrySkills(): Promise<DesktopIpcOutput<"desktop:list-downloaded-registry-skills">>
  setDownloadedRegistrySkillEnabled(input: DesktopIpcInput<"desktop:set-downloaded-registry-skill-enabled">): Promise<DesktopIpcOutput<"desktop:set-downloaded-registry-skill-enabled">>
  deleteDownloadedRegistrySkill(input: DesktopIpcInput<"desktop:delete-downloaded-registry-skill">): Promise<DesktopIpcOutput<"desktop:delete-downloaded-registry-skill">>
  readDownloadedRegistrySkillFile(input: DesktopIpcInput<"desktop:read-downloaded-registry-skill-file">): Promise<DesktopIpcOutput<"desktop:read-downloaded-registry-skill-file">>
  listDownloadedRegistrySkillFiles(input: DesktopIpcInput<"desktop:list-downloaded-registry-skill-files">): Promise<DesktopIpcOutput<"desktop:list-downloaded-registry-skill-files">>
  forkDownloadedRegistrySkill(input: DesktopIpcInput<"desktop:fork-downloaded-registry-skill">): Promise<DesktopIpcOutput<"desktop:fork-downloaded-registry-skill">>
  previewDownloadedRegistrySkillUpdate(input: DesktopIpcInput<"desktop:preview-downloaded-registry-skill-update">): Promise<DesktopIpcOutput<"desktop:preview-downloaded-registry-skill-update">>
  updateDownloadedRegistrySkill(input: DesktopIpcInput<"desktop:update-downloaded-registry-skill">): Promise<DesktopIpcOutput<"desktop:update-downloaded-registry-skill">>
  rollbackDownloadedRegistrySkill(input: DesktopIpcInput<"desktop:rollback-downloaded-registry-skill">): Promise<DesktopIpcOutput<"desktop:rollback-downloaded-registry-skill">>
  getPromptPresets(): Promise<DesktopIpcOutput<"desktop:get-prompt-presets">>
  getPromptPresetSelection(): Promise<DesktopIpcOutput<"desktop:get-prompt-preset-selection">>
  readPromptPreset(input: DesktopIpcInput<"desktop:read-prompt-preset">): Promise<DesktopIpcOutput<"desktop:read-prompt-preset">>
  createPromptPreset(input: DesktopIpcInput<"desktop:create-prompt-preset">): Promise<DesktopIpcOutput<"desktop:create-prompt-preset">>
  translatePromptPreset(input: DesktopIpcInput<"desktop:translate-prompt-preset">): Promise<DesktopIpcOutput<"desktop:translate-prompt-preset">>
  previewPromptUrlInstall(input: DesktopIpcInput<"desktop:preview-prompt-url-install">): Promise<DesktopIpcOutput<"desktop:preview-prompt-url-install">>
  installPromptsFromUrl(input: DesktopIpcInput<"desktop:install-prompts-from-url">): Promise<DesktopIpcOutput<"desktop:install-prompts-from-url">>
  getGlobalSkillsTree(): Promise<DesktopIpcOutput<"desktop:get-global-skills-tree">>
  readGlobalSkillFile(input: DesktopIpcInput<"desktop:read-global-skill-file">): Promise<DesktopIpcOutput<"desktop:read-global-skill-file">>
  searchWorkspaceFiles(input: DesktopIpcInput<"desktop:search-workspace-files">): Promise<DesktopIpcOutput<"desktop:search-workspace-files">>
  listWorkspaceDirectory(input: DesktopIpcInput<"desktop:list-workspace-directory">): Promise<DesktopIpcOutput<"desktop:list-workspace-directory">>
  readWorkspaceFile(input: DesktopIpcInput<"desktop:read-workspace-file">): Promise<DesktopIpcOutput<"desktop:read-workspace-file">>
  updateGlobalSkillFile(input: DesktopIpcInput<"desktop:update-global-skill-file">): Promise<DesktopIpcOutput<"desktop:update-global-skill-file">>
  updatePromptPreset(input: DesktopIpcInput<"desktop:update-prompt-preset">): Promise<DesktopIpcOutput<"desktop:update-prompt-preset">>
  updatePromptPresetSelection(input: DesktopIpcInput<"desktop:update-prompt-preset-selection">): Promise<DesktopIpcOutput<"desktop:update-prompt-preset-selection">>
  resetPromptPreset(input: DesktopIpcInput<"desktop:reset-prompt-preset">): Promise<DesktopIpcOutput<"desktop:reset-prompt-preset">>
  deletePromptPreset(input: DesktopIpcInput<"desktop:delete-prompt-preset">): Promise<DesktopIpcOutput<"desktop:delete-prompt-preset">>
  createGlobalSkill(input: DesktopIpcInput<"desktop:create-global-skill">): Promise<DesktopIpcOutput<"desktop:create-global-skill">>
  previewGlobalSkillGitInstall(input: DesktopIpcInput<"desktop:preview-global-skill-git-install">): Promise<DesktopIpcOutput<"desktop:preview-global-skill-git-install">>
  installGlobalSkillsFromGit(input: DesktopIpcInput<"desktop:install-global-skills-from-git">): Promise<DesktopIpcOutput<"desktop:install-global-skills-from-git">>
  installGlobalSkillFromLocalFile(input?: DesktopIpcInput<"desktop:install-global-skill-from-local-file">): Promise<DesktopIpcOutput<"desktop:install-global-skill-from-local-file">>
  renameGlobalSkill(input: DesktopIpcInput<"desktop:rename-global-skill">): Promise<DesktopIpcOutput<"desktop:rename-global-skill">>
  deleteGlobalSkill(input: DesktopIpcInput<"desktop:delete-global-skill">): Promise<DesktopIpcOutput<"desktop:delete-global-skill">>
  createGlobalSkillFolder(input: DesktopIpcInput<"desktop:create-global-skill-folder">): Promise<DesktopIpcOutput<"desktop:create-global-skill-folder">>
  renameGlobalSkillFolder(input: DesktopIpcInput<"desktop:rename-global-skill-folder">): Promise<DesktopIpcOutput<"desktop:rename-global-skill-folder">>
  deleteGlobalSkillFolder(input: DesktopIpcInput<"desktop:delete-global-skill-folder">): Promise<DesktopIpcOutput<"desktop:delete-global-skill-folder">>
  moveGlobalSkillDirectory(input: DesktopIpcInput<"desktop:move-global-skill-directory">): Promise<DesktopIpcOutput<"desktop:move-global-skill-directory">>
  getProjectProviderCatalog(input: DesktopIpcInput<"desktop:get-project-provider-catalog">): Promise<DesktopIpcOutput<"desktop:get-project-provider-catalog">>
  refreshProjectProviderCatalog(input: DesktopIpcInput<"desktop:refresh-project-provider-catalog">): Promise<DesktopIpcOutput<"desktop:refresh-project-provider-catalog">>
  getProjectModels(input: DesktopIpcInput<"desktop:get-project-models">): Promise<DesktopIpcOutput<"desktop:get-project-models">>
  getProjectModelCatalog(input: DesktopIpcInput<"desktop:get-project-model-catalog">): Promise<DesktopIpcOutput<"desktop:get-project-model-catalog">>
  getSessionModels(input: DesktopIpcInput<"desktop:get-session-models">): Promise<DesktopIpcOutput<"desktop:get-session-models">>
  getProjectSkills(input: DesktopIpcInput<"desktop:get-project-skills">): Promise<DesktopIpcOutput<"desktop:get-project-skills">>
  getProjectSkillSelection(input: DesktopIpcInput<"desktop:get-project-skill-selection">): Promise<DesktopIpcOutput<"desktop:get-project-skill-selection">>
  updateProjectSkillSelection(input: DesktopIpcInput<"desktop:update-project-skill-selection">): Promise<DesktopIpcOutput<"desktop:update-project-skill-selection">>
  getProjectPlugins(input: DesktopIpcInput<"desktop:get-project-plugins">): Promise<DesktopIpcOutput<"desktop:get-project-plugins">>
  getProjectPluginSelection(input: DesktopIpcInput<"desktop:get-project-plugin-selection">): Promise<DesktopIpcOutput<"desktop:get-project-plugin-selection">>
  updateProjectPluginSelection(input: DesktopIpcInput<"desktop:update-project-plugin-selection">): Promise<DesktopIpcOutput<"desktop:update-project-plugin-selection">>
  getProjectMcpSelection(input: DesktopIpcInput<"desktop:get-project-mcp-selection">): Promise<DesktopIpcOutput<"desktop:get-project-mcp-selection">>
  updateProjectMcpSelection(input: DesktopIpcInput<"desktop:update-project-mcp-selection">): Promise<DesktopIpcOutput<"desktop:update-project-mcp-selection">>
  getProjectMcpServers(input: DesktopIpcInput<"desktop:get-project-mcp-servers">): Promise<DesktopIpcOutput<"desktop:get-project-mcp-servers">>
  getProjectMcpServerDiagnostic(input: DesktopIpcInput<"desktop:get-project-mcp-server-diagnostic">): Promise<DesktopIpcOutput<"desktop:get-project-mcp-server-diagnostic">>
  updateProjectMcpServer(input: DesktopIpcInput<"desktop:update-project-mcp-server">): Promise<DesktopIpcOutput<"desktop:update-project-mcp-server">>
  deleteProjectMcpServer(input: DesktopIpcInput<"desktop:delete-project-mcp-server">): Promise<DesktopIpcOutput<"desktop:delete-project-mcp-server">>
  updateProjectProvider(input: DesktopIpcInput<"desktop:update-project-provider">): Promise<DesktopIpcOutput<"desktop:update-project-provider">>
  deleteProjectProvider(input: DesktopIpcInput<"desktop:delete-project-provider">): Promise<DesktopIpcOutput<"desktop:delete-project-provider">>
  updateProjectModelSelection(input: DesktopIpcInput<"desktop:update-project-model-selection">): Promise<DesktopIpcOutput<"desktop:update-project-model-selection">>
  updateSessionModelSelection(input: DesktopIpcInput<"desktop:update-session-model-selection">): Promise<DesktopIpcOutput<"desktop:update-session-model-selection">>
  onMobileBridgeEvent(listener: (event: DesktopIpcEventPayload<typeof DESKTOP_MOBILE_BRIDGE_EVENT_CHANNEL>) => void): () => void
  onWorkspaceFileChange(listener: (event: DesktopIpcEventPayload<typeof DESKTOP_WORKSPACE_FILE_CHANGE_EVENT_CHANNEL>) => void): () => void
  onPtyEvent(listener: (event: DesktopIpcEventPayload<typeof DESKTOP_PTY_EVENT_CHANNEL>) => void): () => void
  onWindowStateChange(listener: (state: DesktopIpcEventPayload<typeof DESKTOP_WINDOW_STATE_EVENT_CHANNEL>) => void): () => void
  onWorkbenchStateChange(listener: (event: DesktopIpcEventPayload<typeof DESKTOP_WORKBENCH_STATE_EVENT_CHANNEL>) => void): () => void
  onAppearanceStateChange(listener: (state: DesktopIpcEventPayload<typeof DESKTOP_APPEARANCE_STATE_EVENT_CHANNEL>) => void): () => void
}

export type DesktopPreloadApi = DesktopApiBase & DesktopApiMethods
export type DesktopApi = DesktopApiBase & Pick<DesktopApiMethods, "getInfo"> & Partial<DesktopApiMethods>
