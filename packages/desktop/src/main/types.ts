import type {
  PermissionDecision as AgentPermissionDecision,
  PermissionPromptSnapshot as AgentPermissionPromptSnapshot,
  PermissionRequestPrompt as AgentPermissionRequest,
  PermissionRequestResolutionRecord as AgentPermissionRequestResolutionRecord,
  PermissionRequestStatus as AgentPermissionRequestStatus,
  PermissionResolveResult as AgentPermissionResolveResult,
  PermissionRisk as AgentPermissionRisk,
  PermissionToolKind as AgentPermissionToolKind,
  ToolPermissionMode as AgentToolPermissionMode,
  ToolPermissionModePayload as AgentToolPermissionModePayload,
} from "../shared/permission"
import type {
  ReasoningEffort,
  ToolCallOutcome,
  ToolCallFailure,
  ToolCallPhase,
  ToolCallResultCompleteness,
  ToolCallResultPolarity,
  ToolCallSideEffectCertainty,
  ToolCallRetrySafety,
  ToolCallTurnControlMode,
  ToolModuleActivationMode,
  ToolModuleActivationScope,
  ToolModuleDiscoveryMode,
  ToolModuleProviderKind,
} from "@anybox/shared"

export type MenuKey = "file" | "edit" | "view" | "window" | "help"
export type WindowAction = "minimize" | "toggle-maximize" | "close"

export interface MenuAnchor {
  x: number
  y: number
}

export interface AgentConfig {
  baseURL: string
  defaultDirectory: string
}

export interface AgentProjectInfo {
  id: string
  kind?: "directory" | "git"
  repositoryRoot?: string
  workspaceRoots?: string[]
  worktree: string
  vcs?: "git"
  name?: string
  created: number
  updated: number
  sandboxes: string[]
}

export type AgentWorktreeKind = "primary" | "external" | "managed"
export type AgentWorktreeOwnerType = "session" | "automation-run" | "subagent" | "manual"
export type AgentWorktreeStatus = "active" | "missing" | "dirty" | "archived" | "removing" | "removed" | "failed"
export type AgentWorktreeCleanupPolicy = "never" | "on-session-archive" | "on-success-if-clean" | "manual"

export interface AgentWorktreeRecord {
  id: string
  projectID: string
  path: string
  sourceDirectory?: string
  workingDirectory?: string
  branch?: string | null
  baseRef?: string | null
  baseSha?: string | null
  kind: AgentWorktreeKind
  managed: boolean
  ownerType?: AgentWorktreeOwnerType
  ownerSessionID?: string
  ownerRunID?: string
  status: AgentWorktreeStatus
  cleanupPolicy: AgentWorktreeCleanupPolicy
  createdAt: number
  updatedAt: number
  lastSeenAt?: number
}

export interface AgentEnvironmentScripts {
  default?: string
  windows?: string
  macos?: string
  linux?: string
}

export interface AgentEnvironmentSetup {
  scripts: AgentEnvironmentScripts
  cwd: string
  timeoutSeconds: number
}

export interface AgentEnvironmentAction {
  id: string
  name: string
  icon: string
  scripts: AgentEnvironmentScripts
  cwd: string
}

export interface AgentEnvironmentDefinition {
  version: 1
  name: string
  setup?: AgentEnvironmentSetup
  actions: AgentEnvironmentAction[]
}

export interface AgentEnvironmentIssue {
  code: string
  message: string
  path?: string
  severity: "warning" | "error"
}

export interface AgentEnvironmentCandidate {
  key: string
  projectID: string
  requestedDirectory: string
  rootDirectory: string
  configPath: string
  source: "anybox-jsonc" | "codex-toml" | "legacy-start"
  scope: "direct" | "ancestor" | "bound"
  contentHash: string
  readonly: boolean
  trusted: boolean
  definition: AgentEnvironmentDefinition | null
  issues: AgentEnvironmentIssue[]
  bindingID?: string
  setupRunID?: string
  setupRunStatus?: AgentEnvironmentRunStatus
}

export interface AgentEnvironmentListResult {
  projectID: string
  directory: string
  boundaryRoot: string
  items: AgentEnvironmentCandidate[]
  selectedKey?: string
  autoSetup: boolean
}

export interface AgentEnvironmentPreference {
  id: string
  projectID: string
  directory: string
  selectedKey?: string | null
  autoSetup: boolean
  createdAt: number
  updatedAt: number
}

export interface AgentWorktreeEnvironmentBinding {
  id: string
  projectID: string
  worktreeID: string
  sourceDirectory: string
  targetDirectory: string
  sourceConfigPath: string
  sourceRoot: string
  targetRoot: string
  environmentKey: string
  contentHash: string
  source: AgentEnvironmentCandidate["source"]
  definition: AgentEnvironmentDefinition
  createdAt: number
  updatedAt: number
}

export type AgentEnvironmentRunStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "timed-out"

export interface AgentEnvironmentRunRecord {
  id: string
  projectID: string
  environmentKey: string
  contentHash: string
  kind: "setup" | "action"
  actionID?: string
  worktreeID?: string
  sessionID?: string
  bindingID?: string
  cwd: string
  status: AgentEnvironmentRunStatus
  exitCode?: number | null
  output: string
  outputTruncated: boolean
  error?: string
  ptyID?: string
  createdAt: number
  startedAt?: number
  finishedAt?: number
  updatedAt: number
}

export interface AgentPreparedWorktreeResult {
  worktree: AgentWorktreeRecord
  binding?: AgentWorktreeEnvironmentBinding
  setupRun?: AgentEnvironmentRunRecord
}

export interface AgentEnvironmentActionStartResult {
  run: AgentEnvironmentRunRecord
  pty: AgentPtySessionInfo
  reused: boolean
}

export interface AgentEnvironmentIPCEvent extends AgentSSEEvent {
  receivedAt: number
}

export type AgentAutomationKind = "project" | "thread"
export type AgentAutomationStatus = "active" | "paused" | "deleted"
export type AgentAutomationRunStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "blocked"
  | "cancelled"
  | "skipped"
export type AgentAutomationRunTrigger = "manual" | "schedule"
export type AgentAutomationTriageStatus = "inbox" | "read" | "archived" | "none"

export interface AgentAutomationSchedule {
  type: "rrule" | "cron"
  expression: string
  timezone: string
}

export interface AgentAutomationScope {
  projectIDs?: string[]
  directories?: string[]
  sessionID?: string
}

export interface AgentAutomationExecution {
  environment: "local" | "worktree"
  model?: string
  small_model?: string
  reasoning_effort?: ReasoningEffort
  permissionMode?: "read-only" | "default" | "full_access"
  selectedSkillIDs?: string[]
  selectedPluginIDs?: string[]
  selectedMcpServerIDs?: string[]
}

export interface AgentAutomationOutputPolicy {
  triage: "findings-only" | "always" | "never"
  autoArchiveNoFindings: boolean
}

export interface AgentAutomationDefinition {
  id: string
  name: string
  kind: AgentAutomationKind
  status: AgentAutomationStatus
  schedule: AgentAutomationSchedule
  scope: AgentAutomationScope
  execution: AgentAutomationExecution
  prompt: string
  promptVersion: number
  outputPolicy: AgentAutomationOutputPolicy
  createdAt: number
  updatedAt: number
  lastRunAt?: number
  nextRunAt?: number
  leaseOwner?: string
  leaseExpiresAt?: number
  runningRunID?: string
}

export interface AgentAutomationCreateInput {
  name: string
  kind?: AgentAutomationKind
  status?: Exclude<AgentAutomationStatus, "deleted">
  schedule: AgentAutomationSchedule
  scope: AgentAutomationScope
  execution?: Partial<AgentAutomationExecution>
  prompt: string
  outputPolicy?: Partial<AgentAutomationOutputPolicy>
}

export type AgentAutomationUpdateInput = Omit<Partial<AgentAutomationCreateInput>, "status"> & {
  status?: AgentAutomationStatus
}

export interface AgentAutomationRun {
  id: string
  automationID: string
  trigger: AgentAutomationRunTrigger
  status: AgentAutomationRunStatus
  projectID?: string
  directory?: string
  sessionID?: string
  turnID?: string
  promptSnapshot?: string
  promptVersion?: number
  startedAt?: number
  completedAt?: number
  summary?: string
  findingCount: number
  triageStatus: AgentAutomationTriageStatus
  error?: string
  worktreeID?: string
  worktreePath?: string
  metadata?: Record<string, unknown>
  createdAt: number
  updatedAt: number
}

export interface AgentAutomationRunListInput {
  automationID?: string
  triageStatus?: AgentAutomationTriageStatus
  limit?: number
}

export interface AgentAutomationRunCreateResult {
  runs: AgentAutomationRun[]
}

export interface AgentAutomationDeleteResult {
  automationID: string
  deleted: boolean
}

export interface AgentAutomationIPCEvent extends AgentSSEEvent {
  receivedAt: number
}

export interface AgentSessionWorkflowSummary {
  mode: "execution" | "planning"
  plan: {
    status: "idle" | "draft" | "pending-approval" | "approved"
    updatedAt: number
    approvedAt?: number
  }
}

export type AgentSessionTaskStatus = "pending" | "in_progress" | "completed"

export interface AgentSessionTaskPeer {
  id: string
  subject: string
  status: AgentSessionTaskStatus
  owner: string
}

export interface AgentSessionTaskSummary {
  id: string
  sessionID: string
  subject: string
  description: string
  activeForm: string
  owner: string
  status: AgentSessionTaskStatus
  sortIndex: number
  blocks: string[]
  blockedBy: string[]
  metadata: Record<string, unknown>
  createdAt: number
  updatedAt: number
  startedAt?: number
  completedAt?: number
  sourceAssistantMessageID?: string
  sourceUserMessageID?: string
  toolCallID?: string
  isBlocked: boolean
  blockingTasks: AgentSessionTaskPeer[]
  blockedTasks: AgentSessionTaskPeer[]
}

export interface AgentSessionTaskOwnerActivity {
  owner: string
  current?: AgentSessionTaskSummary
  next?: AgentSessionTaskSummary
}

export interface AgentSessionTaskTeammateActivity {
  id: string
  owner: string
  title: string
  status: string
  active: boolean
  childSessionID?: string
  updatedAt?: number
}

export interface AgentSessionTaskListView {
  sessionID: string
  generatedAt: number
  tasks: AgentSessionTaskSummary[]
  current: AgentSessionTaskSummary[]
  next: AgentSessionTaskSummary[]
  blocked: AgentSessionTaskSummary[]
  owners: AgentSessionTaskOwnerActivity[]
  teammateActivity: AgentSessionTaskTeammateActivity[]
  summary: {
    total: number
    completed: number
    pending: number
    inProgress: number
    blocked: number
  }
}

export interface AgentSessionBackgroundProcess {
  id: string
  title: string
  command: string
  cwd: string
  shell: string
  tty: boolean
  status: "running"
  createdAt: number
  updatedAt: number
}

export interface AgentSessionBackgroundProcessList {
  sessionID: string
  generatedAt: number
  items: AgentSessionBackgroundProcess[]
}

export interface AgentSessionBackgroundProcessTerminateResult {
  sessionID: string
  processID: string
  terminated: boolean
}

export interface AgentSessionBackgroundProcessesTerminateAllResult {
  sessionID: string
  terminatedProcessIDs: string[]
}

export type AgentSessionToolPolicy = "default" | "read-only"

export interface AgentSessionPolicy {
  toolPolicy: AgentSessionToolPolicy
  ignoreFullAccess?: boolean
}

export interface AgentSessionAutomationMetadata {
  automationID: string
  runID: string
  name: string
  trigger: "manual" | "schedule"
}

export interface AgentSessionSubagentOrigin {
  taskID: string
  parentSessionID: string
  parentMessageID: string
  parentToolCallID?: string
  agent: string
  status: "running" | "completed" | "blocked" | "stopped" | "failed" | "cancelled"
  active: boolean
  updatedAt: number
}

export interface AgentSessionModelSelection {
  model?: string
  small_model?: string
}

export interface AgentSessionInfo {
  id: string
  projectID: string
  worktreeID?: string
  directory: string
  title: string
  pinned?: boolean
  version?: string
  policy?: AgentSessionPolicy
  automation?: AgentSessionAutomationMetadata
  subagent?: AgentSessionSubagentOrigin
  workflow?: AgentSessionWorkflowSummary
  modelSelection?: AgentSessionModelSelection
  time: {
    created: number
    updated: number
  }
}

export interface AgentWorkspaceSession {
  id: string
  projectID: string
  worktreeID?: string
  directory: string
  title: string
  pinned?: boolean
  policy?: AgentSessionPolicy
  automation?: AgentSessionAutomationMetadata
  subagent?: AgentSessionSubagentOrigin
  created: number
  updated: number
  workflow?: AgentSessionWorkflowSummary
  modelSelection?: AgentSessionModelSelection
}

export interface AgentProjectWorkspace {
  id: string
  kind?: "directory" | "git"
  repositoryRoot?: string
  workspaceRoots?: string[]
  worktree: string
  vcs?: "git"
  name?: string
  created: number
  updated: number
  sessions: AgentWorkspaceSession[]
  worktrees?: AgentWorktreeRecord[]
}

export interface AgentFolderProjectSummary {
  id: string
  kind?: "directory" | "git"
  name: string
  repositoryRoot?: string
  workspaceRoots?: string[]
  worktree: string
  vcs?: "git"
}

export interface AgentFolderWorkspace {
  id: string
  directory: string
  name: string
  exists: boolean
  created: number
  updated: number
  project: AgentFolderProjectSummary
  sessions: AgentWorkspaceSession[]
}

export interface AgentProjectDeleteResult {
  projectID: string
  deletedSessionIDs: string[]
}

export interface AgentSessionDeleteResult {
  sessionID: string
  projectID: string
}

export interface AgentSessionArchiveResult {
  sessionID: string
  projectID: string
  directory: string
  archivedAt: number
}

export interface AgentArchivedSessionSummary {
  id: string
  projectID: string
  projectName: string | null
  projectMissing: boolean
  directory: string
  title: string
  policy?: AgentSessionPolicy
  automation?: AgentSessionAutomationMetadata
  created: number
  updated: number
  archivedAt: number
  messageCount: number
  eventCount: number
}

export interface AgentArchivedSessionDeleteResult {
  sessionID: string
}

export interface AgentEnvelope<T> {
  success: boolean
  data?: T
  error?: {
    code?: string
    message?: string
  }
}

export type AgentBuiltinToolKind =
  | "read"
  | "write"
  | "search"
  | "exec"
  | "workflow"
  | "interaction"
  | "delegation"
  | "other"
export type AgentBuiltinToolConcurrency = "safe" | "exclusive"

export interface AgentBuiltinToolCapabilities {
  kind?: AgentBuiltinToolKind
  readOnly?: boolean
  destructive?: boolean
  concurrency?: AgentBuiltinToolConcurrency
  needsShell?: boolean
}

export interface AgentBuiltinToolModuleSummary {
  id: string
  title: string
  description: string
  provider: {
    kind: ToolModuleProviderKind
    id: string
    name?: string
  }
  activation: {
    mode: ToolModuleActivationMode
    scope: ToolModuleActivationScope
    discovery: ToolModuleDiscoveryMode
  }
  toolIDs: string[]
}

export interface AgentBuiltinToolSummary {
  id: string
  title: string
  description: string
  inputSchema?: unknown
  aliases: string[]
  capabilities: AgentBuiltinToolCapabilities
  moduleID: string
  defaultEnabled: boolean
  enabled: boolean
}

export type AgentOnDemandToolSummary = Omit<AgentBuiltinToolSummary, "defaultEnabled" | "enabled">

export interface AgentToolModuleInspectionFailure {
  moduleID: string
  message: string
}

export interface AgentBuiltinToolSelection {
  tools: Record<string, boolean>
}

export interface AgentBuiltinToolsPayload {
  modules: AgentBuiltinToolModuleSummary[]
  items: AgentBuiltinToolSummary[]
  selection: AgentBuiltinToolSelection
  onDemand: {
    modules: AgentBuiltinToolModuleSummary[]
    items: AgentOnDemandToolSummary[]
    failures: AgentToolModuleInspectionFailure[]
  }
}

export interface AgentSSEEvent {
  id?: string
  event: string
  data: unknown
}

export interface AgentStreamIPCEvent extends AgentSSEEvent {
  streamID: string
}

export interface AgentSessionStreamIPCEvent extends AgentSSEEvent {
  sessionID: string
}

export interface AgentSessionComposerAttachmentInput {
  path: string
  name?: string
}

export interface AgentSessionQuestionAnswerInput {
  questionID: string
  selectedOptions?: string[]
  freeformText?: string
}

export interface AgentSessionQuestionAnswerResult extends AgentSessionQuestionAnswerInput {
  sessionID: string
  answerText: string
  answeredAt: number
}

export interface AgentSessionTurnRequestInput {
  clientTurnID: string
  executionID?: string
  backendSessionID: string
  text?: string
  displayText?: string
  parentMessageID?: string | null
  threadTarget?:
    | {
        kind: "active-thread"
        parentMessageID?: string | null
      }
    | {
        kind: "detached-branch"
        parentMessageID: string
      }
  quotes?: Array<{
    sourceMessageID: string
    text: string
  }>
  attachments?: AgentSessionComposerAttachmentInput[]
  questionAnswer?: AgentSessionQuestionAnswerInput
  concurrentInputMode?: "queue" | "steer"
  reasoningEffort?: ReasoningEffort
  model?: {
    providerID: string
    modelID: string
  }
  system?: string
  agent?: string
  skills?: string[]
  turnMcpServerIDs?: string[]
  turnToolModuleIDs?: string[]
}

export interface AgentSessionCompactResult {
  sessionID: string
  status: "compacted" | "noop"
  reason?: "not-enough-history"
  compactedMessageID?: string
  compactionID?: string
  compactedFromMessageID?: string
  compactedToMessageID?: string
  sourceMessageCount: number
  estimatedTokens?: number
}

export type AgentSessionWorkflowUpdateInput =
  | { action: "enter-plan" }
  | { action: "leave-plan" }
  | { action: "approve-plan"; proposedPlanMarkdown: string }

export type AgentSessionBridgeIPCEvent =
  | {
      kind: "stream"
      source: "request" | "subscription"
      backendSessionID: string
      uiSessionID?: string
      clientTurnID?: string
      id?: string
      event: string
      data: unknown
      receivedAt: number
    }
  | {
      kind: "subscription-state"
      backendSessionID: string
      uiSessionID?: string
      state: "connecting" | "connected" | "reconnecting" | "closed" | "error"
      message?: string
      lastEventID?: string
      receivedAt: number
    }
  | {
      kind: "focus-session"
      backendSessionID: string
      turnID?: string
      receivedAt: number
    }

export interface AgentSessionHistoryInfo {
  id: string
  sessionID: string
  role: "user" | "assistant"
  created: number
  completed?: number
  diffSummary?: AgentSessionDiffSummary
  error?: {
    message?: string
    [key: string]: unknown
  }
  [key: string]: unknown
}

export interface AgentSessionHistoryTurnErrorInfo {
  name?: string
  message: string
  code?: string
  statusCode?: number
  retryable?: boolean
  providerID?: string
  modelID?: string
}

export interface AgentSessionHistoryTurn {
  id: string
  sessionID: string
  projectID: string
  userMessageID?: string
  resume?: boolean
  agent?: string
  model?: {
    providerID: string
    modelID: string
  }
  status: "running" | "completed" | "blocked" | "failed" | "cancelled"
  phase?: string
  lastMessageID?: string
  finishReason?: string
  error?: string
  errorInfo?: AgentSessionHistoryTurnErrorInfo
  createdAt: number
  updatedAt: number
  completedAt?: number
}

export interface AgentSessionHistoryMessage {
  info: AgentSessionHistoryInfo
  parts: unknown[]
  turn?: AgentSessionHistoryTurn
}

export interface AgentSessionDiffFile {
  file: string
  additions: number
  deletions: number
  patch?: string
  gitState?: "clean" | "mixed" | "staged" | "unknown" | "unstaged" | "untracked"
}

export type AgentSessionDiffScope =
  | "git:unstaged"
  | "git:staged"
  | "git:commit"
  | "git:branch"
  | "session:last-turn"

export type AgentSessionDiffRestoreMode = "git-file" | "patch" | "none"

export interface AgentSessionDiffScopeOption {
  scope: AgentSessionDiffScope
  label: string
  enabled: boolean
  count?: number
  reason?: string
  hasChildren?: boolean
}

export interface AgentSessionDiffSummary {
  title?: string
  body?: string
  stats?: {
    additions: number
    deletions: number
    files: number
  }
  scope?: AgentSessionDiffScope
  restoreMode?: AgentSessionDiffRestoreMode
  availableScopes?: AgentSessionDiffScopeOption[]
  diffs: AgentSessionDiffFile[]
}

export interface AgentWorkspaceFileSearchResult {
  path: string
  absolutePath?: string
  name: string
  extension: string | null
}

export interface AgentWorkspaceDirectoryEntry {
  path: string
  name: string
  kind: "directory" | "file"
  extension: string | null
  hasChildren: boolean
}

export interface AgentWorkspaceFileDocument {
  path: string
  name: string
  extension: string | null
  kind: "text" | "image" | "video" | "unsupported"
  content?: string
  mimeType?: string
  previewUrl?: string
  size?: number
  unsupportedReason?: string
}

export interface AgentSshProfile {
  id: string
  name: string
  host: string
  port: number
  username: string
  privateKeyPath: string
  defaultRemotePath: string
  createdAt: number
  updatedAt: number
  lastConnectedAt?: number
  hasPassphrase: boolean
}

export interface AgentSshProfileInput {
  id?: string
  name: string
  host: string
  port?: number
  username: string
  privateKeyPath: string
  defaultRemotePath?: string
  passphrase?: string | null
}

export interface AgentSshDirectoryEntry {
  name: string
  path: string
  uri: string
  type: "file" | "directory" | "other"
  size: number
  modifiedAt: number
}

export interface AgentSshDirectoryListing {
  profileID: string
  path: string
  entries: AgentSshDirectoryEntry[]
}

export interface AgentSshConnectionTestResult {
  ok: true
  profileID: string
  remotePath: string
}

export interface AgentSessionRuntimeEventSummary {
  eventID: string
  type: string
  sessionID: string
  turnID: string
  seq: number
  timestamp: number
  cursor: string
  title: string
  detail?: string
  tone: "info" | "success" | "warning" | "error"
  summary?: Record<string, unknown>
}

export interface AgentSessionRuntimeToolSummary {
  callID: string
  tool: string
  title?: string
  phase: ToolCallPhase
  outcome?: ToolCallOutcome["kind"]
  result?: ToolCallResultPolarity
  completeness?: ToolCallResultCompleteness
  turnControl?: ToolCallTurnControlMode
  failure?: ToolCallFailure
  startedAt?: number
  endedAt?: number
  durationMs?: number
  approvalID?: string
  inputPreview?: string
  outputPreview?: string
  error?: string
}

export interface AgentSessionRuntimeLlmCallSummary {
  id: string
  messageID: string
  providerID: string
  modelID: string
  agent?: string
  iteration?: number
  status: "running" | "completed" | "failed"
  startedAt: number
  endedAt?: number
  durationMs?: number
  messageCount: number
  toolCount?: number
  hasAttachments?: boolean
  finishReason?: string
  usage?: {
    inputTokens?: number
    outputTokens?: number
    reasoningTokens?: number
    cacheReadTokens?: number
    cacheWriteTokens?: number
  }
  error?: string
  retryable?: boolean
}

export interface AgentSessionRuntimeErrorContext {
  phase?:
    | "preparing"
    | "waiting_llm"
    | "reasoning"
    | "executing_tool"
    | "waiting_approval"
    | "responding"
    | "retrying"
    | "blocked"
    | "completed"
    | "cancelled"
    | "failed"
  messageID?: string
  agent?: string
  model?: string
  iteration?: number
  error: {
    name?: string
    message: string
    code?: string
    statusCode?: number
    retryable?: boolean
  }
  activeTools: Array<{
    callID: string
    tool: string
    phase: ToolCallPhase
    outcome?: ToolCallOutcome["kind"]
    result?: ToolCallResultPolarity
    completeness?: ToolCallResultCompleteness
    turnControl?: ToolCallTurnControlMode
  }>
  latestTool?: {
    callID: string
    tool: string
    phase: ToolCallPhase
    outcome?: ToolCallOutcome["kind"]
    result?: ToolCallResultPolarity
    completeness?: ToolCallResultCompleteness
    turnControl?: ToolCallTurnControlMode
  }
}

export interface AgentSessionRuntimeTurnSummary {
  turnID: string
  startedAt?: number
  endedAt?: number
  durationMs?: number
  lastEventAt?: number
  status: "running" | "completed" | "blocked" | "stopped" | "failed"
  phase?:
    | "preparing"
    | "waiting_llm"
    | "reasoning"
    | "executing_tool"
    | "waiting_approval"
    | "responding"
    | "retrying"
    | "blocked"
    | "completed"
    | "cancelled"
    | "failed"
  phaseReason?: string
  phaseUpdatedAt?: number
  userMessageID?: string
  agent?: string
  model?: string
  resume: boolean
  finishReason?: string
  message?: {
    messageID?: string
    role?: string
    created?: number
    completed?: number
    finishReason?: string
    providerID?: string
    modelID?: string
    agent?: string
    error?: string
  } | null
  llmCalls: AgentSessionRuntimeLlmCallSummary[]
  tools: AgentSessionRuntimeToolSummary[]
  error?: {
    name?: string
    message: string
    code?: string
    statusCode?: number
    retryable?: boolean
    messageID?: string
    providerID?: string
    modelID?: string
    agent?: string
  } | null
  errorContext?: AgentSessionRuntimeErrorContext | null
  recentEvents: AgentSessionRuntimeEventSummary[]
}

export interface AgentSessionRuntimeDebugSnapshot {
  generatedAt: number
  logging: Record<string, unknown>
  session: {
    id: string
    projectID?: string
    directory?: string
    title?: string
    created?: number
    updated?: number
    missing: boolean
  }
  status: {
    type: "busy" | "idle"
    phase?:
      | "preparing"
      | "waiting_llm"
      | "reasoning"
      | "executing_tool"
      | "waiting_approval"
      | "responding"
      | "retrying"
      | "blocked"
      | "completed"
      | "cancelled"
      | "failed"
  }
  running: {
    sessionID: string
    startedAt: number | null
    activeForMs: number
    reason?: string
  }
  executions?: Array<{
    sessionID: string
    executionID: string
    targetKind: "active-thread" | "detached-branch"
    headMessageID: string | null
    status: "idle" | "running" | "cancelling" | "stopped"
    startedAt: number | null
    activeForMs: number
    activeTurnID: string | null
    queueLength: number
    queuedOpCount: number
    pendingSteerCount: number
  }>
  activeTurnID: string | null
  latestTurn: AgentSessionRuntimeTurnSummary | null
  turns: AgentSessionRuntimeTurnSummary[]
  recentEvents: AgentSessionRuntimeEventSummary[]
  tasks?: AgentSessionTaskListView
  diagnostics: {
    blockedOnApproval: boolean
    activeToolCount: number
    failedToolCount: number
    llmFailureCount: number
    lastErrorMessage?: string
  }
}

export interface AgentSessionTraceExport {
  schemaVersion: 3
  generatedAt: number
  mode: "safe"
  session: AgentSessionRuntimeDebugSnapshot["session"]
  stats: {
    messageCount: number
    eventCount: number
    turnCount: number
    toolCallCount: number
    redactedCount: number
    truncatedCount: number
    totalRetainedEventCount: number
    omittedEventCount: number
  }
  redaction: {
    enabled: true
    maxStringLength: number
    redactedKeyPattern: string
  }
  messages: unknown[]
  events: Array<{
    position: number
    eventID: string
    sessionID: string
    turnID: string | null
    seq: number
    timestamp: number
    type: string
    payload: unknown
  }>
  runtime: AgentSessionRuntimeDebugSnapshot
  truncation: {
    eventsTruncated: boolean
    maxEvents: number
    omittedEvents: number
  }
  toolCalls: Array<{
    callID: string
    tool: string
    phase: ToolCallPhase
    outcome?: ToolCallOutcome["kind"]
    result?: ToolCallResultPolarity
    completeness?: ToolCallResultCompleteness
    turnControl?: ToolCallTurnControlMode
    sideEffect?: ToolCallSideEffectCertainty
    retry?: ToolCallRetrySafety
    turnID?: string
    messageID?: string
    title?: string
    input?: unknown
    rawInput?: string
    output?: unknown
    modelOutput?: unknown
    error?: string
    failure?: ToolCallFailure
    approvalID?: string
    startedAt?: number
    endedAt?: number
    durationMs?: number
    eventIDs: string[]
  }>
}

export type {
  AgentPermissionDecision,
  AgentPermissionPromptSnapshot,
  AgentPermissionRequest,
  AgentPermissionRequestResolutionRecord,
  AgentPermissionRequestStatus,
  AgentPermissionResolveResult,
  AgentPermissionRisk,
  AgentPermissionToolKind,
  AgentToolPermissionMode,
  AgentToolPermissionModePayload
}

export interface AgentProviderCatalogItem {
  id: string
  name: string
  source: "env" | "config" | "custom" | "api"
  env: string[]
  configured: boolean
  isCustomProvider?: boolean
  available: boolean
  apiKeyConfigured: boolean
  baseURL?: string
  customChatEndpoint?: string
  customDefaultModel?: string
  modelCount: number
  authCapabilities: AgentProviderAuthCapability[]
  authState: AgentProviderAuthState
  authScope: "global"
  activeAuthMethod?: string
  connectionLabel?: string
  lastAuthError?: string
}

export interface AgentProviderAuthCapability {
  method: string
  label: string
  description?: string
  kind: "browser_oauth" | "device_code" | "api_key"
  recommended?: boolean
  supportsPolling?: boolean
  supportsRefresh?: boolean
  supportsDisconnect?: boolean
}

export interface WorkspaceSubscription {
  id?: string | null
  workspaceId?: string
  planCode?: string
  status?: string
  source?: string | null
  currentPeriodStart?: number | null
  currentPeriodEnd?: number | null
  cancelAtPeriodEnd?: boolean
}

export interface WorkspaceEntitlements {
  modelGatewayEnabled?: boolean
  relayEnabled?: boolean
  maxDesktopDevices?: number
  maxMobileDevices?: number
}

export interface AgentProviderAuthAccountSummary {
  accountID?: string
  userID?: string
  email?: string
  planType?: string
  planLabel?: string
  subscription?: WorkspaceSubscription | null
  entitlements?: WorkspaceEntitlements
  workspaceID?: string
  workspaceName?: string
  balanceMicrocents?: number
  currency?: string
  rechargeUrl?: string
  label?: string
}

export interface AgentProviderAuthFlow {
  id: string
  providerID: string
  method: string
  kind: "browser_oauth" | "device_code" | "api_key"
  status: "pending" | "waiting_user" | "authorizing" | "connected" | "error" | "expired" | "cancelled"
  startedAt: number
  updatedAt: number
  expiresAt?: number
  authorizationURL?: string
  verificationURI?: string
  userCode?: string
  errorMessage?: string
  errorCode?: string
  diagnostics?: Record<string, unknown>
  connectionLabel?: string
  account?: AgentProviderAuthAccountSummary
}

export interface AgentProviderAuthState {
  providerID: string
  scope: "global"
  activeMethod?: string
  status: "connected" | "pending" | "expired" | "error" | "not_connected"
  connectionLabel?: string
  lastError?: string
  expiresAt?: number
  account?: AgentProviderAuthAccountSummary
  capabilities: AgentProviderAuthCapability[]
  credentials: Array<{
    method: string
    kind: "api_key" | "oauth_session"
    source: "credential_store" | "legacy_config" | "environment" | "external_cache"
    configured: boolean
    expiresAt?: number
    label?: string
    email?: string
    planType?: string
    planLabel?: string
    subscription?: WorkspaceSubscription | null
    entitlements?: WorkspaceEntitlements
    workspaceID?: string
    workspaceName?: string
    balanceMicrocents?: number
    currency?: string
    rechargeUrl?: string
  }>
  flow?: AgentProviderAuthFlow
}

export interface AgentProviderConnectionTestResult {
  providerID: string
  ok: boolean
  status:
    | "working"
    | "not_connected"
    | "auth_error"
    | "network_error"
    | "config_error"
    | "unsupported"
    | "unknown_error"
    | "ready"
    | "offline"
    | "incompatible"
    | "missing_models"
  checkedAt: number
  message: string
  errorCode?: string
  diagnostics?: Record<string, unknown>
}

export interface AgentProviderModelCapabilitiesModalities {
  text: boolean
  audio: boolean
  image: boolean
  video: boolean
  pdf: boolean
}

export interface AgentProviderModelCapabilities {
  temperature: boolean
  reasoning: boolean
  attachment: boolean
  toolcall: boolean
  input: AgentProviderModelCapabilitiesModalities
  output: AgentProviderModelCapabilitiesModalities
}

export interface AgentProviderModel {
  id: string
  providerID: string
  providerName?: string
  name: string
  family?: string
  status: "alpha" | "beta" | "deprecated" | "active"
  available: boolean
  capabilities: AgentProviderModelCapabilities
  limit: {
    context: number
    input?: number
    output: number
  }
}

export interface AgentModelCatalogItemCapabilities extends Partial<Pick<
  AgentProviderModelCapabilities,
  "temperature" | "reasoning" | "attachment" | "toolcall"
>> {
  input: AgentProviderModelCapabilitiesModalities
  output: AgentProviderModelCapabilitiesModalities
  taskModes: string[]
}

export interface AgentModelCatalogItem {
  registryID: string
  providerID: string
  modelID: string
  name: string
  providerName: string
  family?: string
  runtimeKind: "ai-sdk"
  selectable: boolean
  available: boolean
  capabilities: AgentModelCatalogItemCapabilities
  status: "alpha" | "beta" | "deprecated" | "active"
  source: "provider"
  metadata?: Record<string, unknown>
}

export interface AgentModelCatalogResult {
  items: AgentModelCatalogItem[]
}

export interface AgentProjectModelSelection {
  model?: string
  small_model?: string
  reasoning_effort?: ReasoningEffort
  image_model?: string
  image_generation?: {
    default_size?: string
    default_count?: number
  }
}

export interface AgentProjectModelsResult {
  items: AgentProviderModel[]
  selection: AgentProjectModelSelection
  effectiveModel?: AgentProviderModel | null
}

export interface AgentProjectSkillSelection {
  skillIDs: string[]
}

export interface AgentProjectMcpSelection {
  serverIDs: string[]
}

export interface AgentProjectPluginSelection {
  pluginIDs: string[]
}

export interface AgentSkillInfo {
  id: string
  name: string
  description: string
  path: string
  scope: "project" | "user" | "plugin"
}

export interface AgentGlobalSkillTreeNode {
  name: string
  path: string
  kind: "directory" | "file"
  role: "folder" | "skill" | "resource"
  readOnly?: boolean
  scope?: "user" | "plugin"
  pluginID?: string
  enabled?: boolean
  children?: AgentGlobalSkillTreeNode[]
}

export interface AgentGlobalSkillTree {
  root: string
  items: AgentGlobalSkillTreeNode[]
}

export interface AgentGlobalSkillFileDocument {
  path: string
  content: string
  readOnly?: boolean
  scope?: "user" | "plugin"
  pluginID?: string
}

export interface AgentGlobalSkillRenameResult {
  previousDirectory: string
  directory: string
  filePath: string | null
}

export interface AgentGlobalSkillFolderResult {
  directory: string
}

export interface AgentGlobalSkillFolderRenameResult {
  previousDirectory: string
  directory: string
}

export interface AgentGlobalSkillMoveResult {
  previousDirectory: string
  directory: string
  filePath: string | null
}

export interface AgentSkillInstallCandidate {
  id: string
  name: string
  description: string
  relativePath: string
  directoryName: string
  targetDirectory: string
  available: boolean
  reason?: string
  filePath: string
}

export interface AgentSkillGitInstallPreview {
  previewID: string
  source: string
  cloneUrl: string
  ref?: string
  subpath?: string
  skills: AgentSkillInstallCandidate[]
}

export interface AgentInstalledGlobalSkill {
  id: string
  name: string
  directory: string
  filePath: string
}

export interface AgentSkillGitInstallResult {
  installed: AgentInstalledGlobalSkill[]
}

export type AgentPromptPresetSource = "bundled" | "custom"

export interface AgentPromptPresetSelection {
  systemPromptPresetID: string
  planModePromptPresetID: string
  gitCommitPromptPresetID: string
}

export interface AgentPromptPresetSummary {
  id: string
  label: string
  description: string
  source: AgentPromptPresetSource
  hasOverride: boolean
  editable: boolean
  sourcePath?: string
  filePath?: string
  root?: string
}

export interface AgentPromptPresetDocument extends AgentPromptPresetSummary {
  content: string
}

export interface AgentPromptUrlInstallCandidate {
  id: string
  label: string
  description: string
  sourcePath: string
  available: boolean
  reason?: string
}

export interface AgentPromptUrlInstallPreview {
  previewID: string
  source: string
  prompts: AgentPromptUrlInstallCandidate[]
}

export interface AgentPromptUrlInstallResult {
  installed: AgentPromptPresetDocument[]
}

export type AgentMcpAllowedTools =
  | string[]
  | {
      readOnly?: boolean
      toolNames?: string[]
    }

export type AgentMcpToolPolicyValue = "disabled" | "ask" | "auto"

export type AgentMcpToolPolicies = Record<string, {
  policy: AgentMcpToolPolicyValue
}>

export type AgentMcpRequireApproval =
  | "always"
  | "never"
  | {
      never?: {
        toolNames?: string[]
      }
    }

export type AgentMcpServerOwner =
  | {
      kind: "connector"
      connectorId: string
      runtimeID: string
    }
  | {
      kind: "plugin"
      pluginID: string
      bindingID: string
    }
  | {
      kind: "anybox"
      bindingID: string
    }
  | {
      kind: "user"
    }

export interface AgentStdioMcpServerSummary {
  id: string
  name?: string
  owner?: AgentMcpServerOwner
  transport: "stdio"
  command: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  toolPolicies?: AgentMcpToolPolicies
  enabled: boolean
  timeoutMs?: number
}

export interface AgentRemoteMcpServerSummary {
  id: string
  name?: string
  owner?: AgentMcpServerOwner
  transport: "remote"
  provider?: "openai"
  serverUrl?: string
  connectorId?: string
  connectorRuntimeId?: string
  authorization?: string
  headers?: Record<string, string>
  serverDescription?: string
  allowedTools?: AgentMcpAllowedTools
  toolPolicies?: AgentMcpToolPolicies
  requireApproval?: AgentMcpRequireApproval
  enabled: boolean
  timeoutMs?: number
}

export interface AgentConnectorMcpServerSummary {
  id: string
  name?: string
  owner?: AgentMcpServerOwner
  transport: "connector"
  provider?: "openai"
  connectorId: string
  connectorRuntimeId?: string
  serverDescription?: string
  allowedTools?: AgentMcpAllowedTools
  toolPolicies?: AgentMcpToolPolicies
  requireApproval?: AgentMcpRequireApproval
  enabled: boolean
  timeoutMs?: number
}

export type AgentMcpServerSummary = AgentStdioMcpServerSummary | AgentRemoteMcpServerSummary | AgentConnectorMcpServerSummary

export interface AgentMcpToolDiagnostic {
  name: string
  title?: string
  displayName: string
  description?: string
  inputSchema?: unknown
  annotations?: {
    title?: string
    readOnlyHint?: boolean
    destructiveHint?: boolean
    idempotentHint?: boolean
    openWorldHint?: boolean
  }
  riskHint: "read-only" | "destructive" | "open-world" | "unknown"
  recommendedPolicy: AgentMcpToolPolicyValue
  configuredPolicy?: AgentMcpToolPolicyValue
}

export interface AgentMcpServerDiagnostic {
  serverID: string
  enabled: boolean
  ok: boolean
  toolCount: number
  toolNames: string[]
  tools: AgentMcpToolDiagnostic[]
  error?: string
}

export type AgentPluginCategory = "Code" | "Browser" | "Git" | "Database" | "Docs" | "Automation" | "Design"
export type AgentPluginRisk = "low" | "medium" | "high" | "critical"

export interface AgentPluginToolPreview {
  name: string
  title?: string
  description: string
  readOnly?: boolean
  destructive?: boolean
}

export type AgentConnectorRisk = "low" | "medium" | "high" | "critical"

export interface AgentConnectorApiKeyCredential {
  kind: "api_key"
  key: string
  label: string
  type?: "text" | "password"
  required?: boolean
  secret?: boolean
  placeholder?: string
  description?: string
}

export type AgentConnectorOAuthTokenPlacement =
  | {
      type: "authorization_bearer"
    }
  | {
      type: "header"
      name: string
      value?: string
    }

export interface AgentConnectorOAuthCredential {
  kind: "oauth"
  label: string
  clientID?: string
  clientIDConfigKey?: string
  clientSecretConfigKey?: string
  authorizationURL: string
  tokenURL: string
  scopes: string[]
  revocationURL?: string
  tokenPlacement?: AgentConnectorOAuthTokenPlacement
  authorizationParams?: Record<string, string>
  tokenParams?: Record<string, string>
  tokenEndpointAuthMethod?: "none" | "client_secret_post" | "client_secret_basic"
  tokenRequestFormat?: "form" | "json"
  description?: string
}

export type AgentConnectorCredential = AgentConnectorApiKeyCredential | AgentConnectorOAuthCredential

export interface AgentConnectorConfigField {
  key: string
  label: string
  type?: "text" | "password" | "url" | "path"
  required?: boolean
  secret?: boolean
  placeholder?: string
  defaultValue?: string
  description?: string
}

export interface AgentConnectorStdioRuntime {
  transport: "stdio"
  command: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  serverDescription?: string
  allowedTools?: AgentMcpAllowedTools
  toolPolicies?: AgentMcpToolPolicies
  requireApproval?: AgentMcpRequireApproval
  timeoutMs?: number
}

export interface AgentConnectorRemoteRuntime {
  transport: "remote"
  provider?: "openai"
  serverUrl?: string
  authorization?: string
  headers?: Record<string, string>
  serverDescription?: string
  allowedTools?: AgentMcpAllowedTools
  toolPolicies?: AgentMcpToolPolicies
  requireApproval?: AgentMcpRequireApproval
  timeoutMs?: number
}

export type AgentConnectorRuntime = AgentConnectorStdioRuntime | AgentConnectorRemoteRuntime

export interface AgentConnectorStdioMcpRuntime extends AgentConnectorStdioRuntime {
  id: string
  name?: string
  available: boolean
}

export interface AgentConnectorRemoteMcpRuntime extends AgentConnectorRemoteRuntime {
  id: string
  name?: string
  available: boolean
}

export type AgentConnectorMcpRuntime =
  | AgentConnectorStdioMcpRuntime
  | AgentConnectorRemoteMcpRuntime

export interface AgentConnectorMcpBinding {
  runtimeID: string
  serverID: string
  name?: string
}

export interface AgentConnectorDefinition {
  id: string
  name: string
  description: string
  category?: "account_connector"
  publisher: string
  icon?: string
  risk: AgentConnectorRisk
  permissions: string[]
  tools: AgentPluginToolPreview[]
  configFields: AgentConnectorConfigField[]
  oauthCallbackURL?: string
  credential?: AgentConnectorCredential
  mcpRuntimes?: AgentConnectorMcpRuntime[]
  runtime?: AgentConnectorRuntime
  installReview: string[]
  source: "platform" | "registry"
  available: boolean
}

export interface AgentConnectorRequirement {
  connector: string
  tools?: string[]
  permissions?: string[]
  required?: boolean
  reason?: string
}

export interface AgentMcpRequirement {
  mcp: string
  tools?: string[]
  permissions?: string[]
  required?: boolean
  reason?: string
}

export interface AgentConnectorStatus {
  connectorID: string
  definitionID: string
  name: string
  connected: boolean
  available: boolean
  configured?: boolean
  configurationLabel?: string
  authStatus: "connected" | "not_connected" | "pending" | "expired" | "error" | "unavailable"
  credentialKind?: "api_key" | "oauth"
  credentialLabel?: string
  account?: AgentProviderAuthAccountSummary
  email?: string
  expiresAt?: number
  activeFlow?: AgentProviderAuthFlow
  mcpBindings?: AgentConnectorMcpBinding[]
  generatedMcpServerID?: string
  lastDiagnostic?: AgentMcpServerDiagnostic
}

export interface AgentPluginConfigField {
  key: string
  label: string
  type?: "text" | "password" | "url" | "path"
  required?: boolean
  secret?: boolean
  placeholder?: string
  defaultValue?: string
  description?: string
}

export interface AgentPluginApiKeyAppCredential extends AgentPluginConfigField {
  kind?: "api_key"
}

export type AgentPluginOAuthTokenPlacement =
  | {
      type: "authorization_bearer"
    }
  | {
      type: "header"
      name: string
      value?: string
    }

export interface AgentPluginOAuthClientRegistration {
  registrationURL: string
  initialAccessToken?: string
  metadata?: Record<string, unknown>
}

export interface AgentPluginOAuthAppCredential {
  kind: "oauth"
  label: string
  clientID?: string
  clientSecret?: string
  authorizationURL: string
  tokenURL: string
  scopes: string[]
  revocationURL?: string
  tokenPlacement?: AgentPluginOAuthTokenPlacement
  authorizationParams?: Record<string, string>
  tokenParams?: Record<string, string>
  tokenEndpointAuthMethod?: "none" | "client_secret_post" | "client_secret_basic"
  registration?: AgentPluginOAuthClientRegistration
  description?: string
}

export type AgentPluginAppCredential = AgentPluginApiKeyAppCredential | AgentPluginOAuthAppCredential

export type AgentPluginPackageDownload =
  | {
    type: "zip"
    url?: string
    sha256?: string
    size?: number
  }
  | {
    type: "github-tree"
    url: string
  }

export interface AgentPluginLocalizedText {
  "en-US"?: string
  "zh-CN"?: string
  "zh-TW"?: string
  "ja-JP"?: string
  "ko-KR"?: string
  "pt-BR"?: string
  "es-419"?: string
  "de-DE"?: string
  "fr-FR"?: string
  "id-ID"?: string
  "it-IT"?: string
  "pl-PL"?: string
  "tr-TR"?: string
  "vi-VN"?: string
}

export interface AgentPluginCatalogLocalization {
  name?: AgentPluginLocalizedText
  description?: AgentPluginLocalizedText
  longDescription?: AgentPluginLocalizedText
}

export interface AgentPluginStdioRuntime {
  transport: "stdio"
  command: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  toolPolicies?: AgentMcpToolPolicies
  timeoutMs?: number
}

export interface AgentPluginRemoteRuntime {
  transport: "remote"
  provider?: "openai"
  serverUrl?: string
  connectorId?: string
  authorization?: string
  headers?: Record<string, string>
  serverDescription?: string
  allowedTools?: AgentMcpAllowedTools
  toolPolicies?: AgentMcpToolPolicies
  requireApproval?: AgentMcpRequireApproval
  timeoutMs?: number
}

export type AgentPluginRuntimeTemplate = AgentPluginStdioRuntime | AgentPluginRemoteRuntime

export interface AgentPluginMcpServerCatalogEntry {
  id: string
  name: string
  description?: string
  risk?: AgentPluginRisk
  permissions?: string[]
  tools: AgentPluginToolPreview[]
  configFields?: AgentPluginConfigField[]
  runtime: AgentPluginRuntimeTemplate
  installReview?: string[]
}

export interface AgentPluginSkillPreview {
  id: string
  name: string
  description: string
  directory: string
}

export interface AgentPluginSkillEntry {
  name: string
  path: string
  kind: "file" | "directory"
  size?: number
  mimeType?: string
  hasChildren?: boolean
}

export interface AgentPluginSkillDirectory {
  pluginID: string
  skillID: string
  skillName: string
  path: string
  entries: AgentPluginSkillEntry[]
  readOnly: true
}

export interface AgentPluginSkillFile {
  pluginID: string
  skillID: string
  skillName: string
  path: string
  name: string
  kind: "text" | "image" | "binary"
  mimeType: string
  size: number
  content?: string
  previewUrl?: string
  tooLarge: boolean
  readOnly: true
}

export interface AgentPluginAppConnector {
  id?: string
  appID: string
  name: string
  description?: string
  icon?: string
  risk?: AgentPluginRisk
  permissions?: string[]
  tools?: AgentPluginToolPreview[]
  configFields?: AgentPluginConfigField[]
  credential: AgentPluginAppCredential
  runtime: AgentPluginRuntimeTemplate
  installReview?: string[]
}

export interface AgentPluginView {
  id: string
  title: string
  location: "right-sidebar"
  entry: string
}

export interface AgentPluginAppRuntime {
  type: "local-http"
  command: string
  args?: string[]
  cwd?: string
  healthcheckPath: string
  startupTimeoutMs: number
  idleTimeoutMs: number
}

export interface AgentPluginAppPermissions {
  workspace: "none" | "request"
  network: string[]
  system: Array<"file-picker" | "notifications" | "open-external" | "clipboard">
}

export interface AgentInstalledPluginView {
  pluginID: string
  pluginVersion: string
  viewID: string
  title: string
  location: "right-sidebar"
  entry: string
  packageRoot: string
  icon?: string
  iconUrl?: string
  workspaceAccess?: boolean
  safePreviewUrl?: string
}

export interface AgentPluginCatalogItem {
  id: string
  name: string
  description: string
  longDescription?: string
  localized?: AgentPluginCatalogLocalization
  version: string
  publisher: string
  category: AgentPluginCategory
  icon?: string
  iconUrl?: string
  thumbnailUrl?: string
  heroImageUrl?: string
  screenshots: string[]
  tags: string[]
  brandColor?: string
  homepage?: string
  documentationUrl?: string
  risk: AgentPluginRisk
  permissions: string[]
  tools: AgentPluginToolPreview[]
  configFields: AgentPluginConfigField[]
  runtime?: AgentPluginRuntimeTemplate
  mcpServers: AgentPluginMcpServerCatalogEntry[]
  mcpRequirements: AgentMcpRequirement[]
  skills: AgentPluginSkillPreview[]
  connectorRequirements: AgentConnectorRequirement[]
  connectors: AgentPluginAppConnector[]
  apps: AgentPluginAppConnector[]
  views?: AgentPluginView[]
  appRuntime?: AgentPluginAppRuntime
  appPermissions?: AgentPluginAppPermissions
  installReview?: string[]
  source?: "package" | "registry"
  download?: AgentPluginPackageDownload
  installable?: boolean
}

export interface AgentInstalledPlugin {
  pluginID: string
  version: string
  enabled: boolean
  mcpServerID?: string
  mcpServerIDs: string[]
  mcpServerEnabled: Record<string, boolean>
  skillIDs: string[]
  connectorIDs: string[]
  mcpRequirementIDs: string[]
  connectorRequirementIDs: string[]
  config: Record<string, string>
  installedAt: number
  updatedAt: number
  lastDiagnostic?: AgentMcpServerDiagnostic
  lastConnectorDiagnostics?: Record<string, AgentMcpServerDiagnostic>
  packageRoot?: string
  missingPackage?: boolean
  views?: AgentInstalledPluginView[]
}

export interface AgentPluginInstallInput {
  pluginID: string
  config?: Record<string, string>
  enabled?: boolean
}

export interface AgentPluginImportURLInput {
  url: string
}

export interface AgentPluginUpdateInput {
  pluginID: string
  config?: Record<string, string>
  enabled?: boolean
}

export interface AgentPluginMcpControlsInput {
  pluginID: string
  serverID: string
  enabled?: boolean
  toolPolicies?: AgentMcpToolPolicies
}

export interface AgentPluginMcpControlsResult {
  plugin: AgentInstalledPlugin
  server: AgentMcpServerSummary
}

export interface AgentPluginDeleteResult {
  pluginID: string
  mcpServerID?: string
  mcpServerIDs: string[]
  connectorIDs: string[]
  removed: boolean
}

export interface AgentPluginConnectorStatus {
  pluginID: string
  appID: string
  connectorID: string
  connected: boolean
  credentialKind: "api_key" | "oauth"
  authStatus: "connected" | "not_connected" | "pending" | "expired" | "error"
  credentialLabel?: string
  account?: AgentProviderAuthAccountSummary
  email?: string
  expiresAt?: number
  activeFlow?: AgentProviderAuthFlow
  generatedMcpServerID: string
  lastDiagnostic?: AgentMcpServerDiagnostic
}

export interface AgentPtySessionInfo {
  id: string
  sessionID: string
  terminalKey: string
  purpose: "interactive" | "environment-action"
  title: string
  cwd: string
  shell: string
  rows: number
  cols: number
  status: "running" | "exited" | "deleted"
  exitCode: number | null
  createdAt: number
  updatedAt: number
  cursor: number
}

export interface AgentPtyReplayPayload {
  mode: "delta" | "reset"
  buffer: string
  cursor: number
  startCursor: number
}

export type AgentPtySocketMessage =
  | {
      type: "ready"
      session: AgentPtySessionInfo
      replay: AgentPtyReplayPayload
    }
  | {
      type: "output"
      id: string
      data: string
      cursor: number
    }
  | {
      type: "state"
      session: AgentPtySessionInfo
    }
  | {
      type: "exited"
      session: AgentPtySessionInfo
    }
  | {
      type: "deleted"
      session: AgentPtySessionInfo
    }
  | {
      type: "error"
      code: string
      message: string
    }

export type PtyTransportIPCEvent =
  | {
      ptyID: string
      type: "transport"
      state: "connecting" | "connected" | "disconnected" | "error"
      code?: number
      reason?: string
      userInitiated?: boolean
      message?: string
    }
  | ({
      ptyID: string
    } & AgentPtySocketMessage)
