import type {
  PermissionDecision,
  PermissionPromptDetails,
  PermissionPromptSnapshot,
  PermissionRequestPrompt as PermissionRequest,
  PermissionRequestResolutionRecord,
  PermissionRequestStatus,
  PermissionRisk,
  PermissionToolKind,
  ToolPermissionMode,
} from "../../../shared/permission"
import type { ReasoningEffort as SharedReasoningEffort } from "@anybox/shared"
import type {
  CinemaProviderAuthState as SharedCinemaProviderAuthState,
  CinemaProviderWorkflowCatalog as SharedCinemaProviderWorkflowCatalog,
  CinemaVideoProvider as SharedCinemaVideoProvider,
} from "@anybox/shared/cinema"
import type {
  DesktopPreviewRenderer,
  DesktopResolvedPreviewTarget,
  MobileBridgeDesktopEvent as DesktopMobileBridgeEvent,
} from "../../../shared/desktop-ipc-contract"

export type {
  PermissionDecision,
  PermissionPromptDetails,
  PermissionPromptSnapshot,
  PermissionRequest,
  PermissionRequestResolutionRecord,
  PermissionRequestStatus,
  PermissionRisk,
  PermissionToolKind,
  ToolPermissionMode
}

export type SessionStatus = "Live" | "Review" | "Ready"
export type SidebarActionKey = "project" | "conversation"
export type LeftSidebarView = "workspace" | "calendar" | "automations" | "resources" | "connections" | "mobile" | "tools"
export type ConnectionsTab = "plugins" | "connectors" | "mcp"
export type AppMode = "Autopilot" | "Review"
export type ProjectKind = "directory" | "git"
export type ProjectVcs = "git"
export type WindowAction = "minimize" | "toggle-maximize" | "close"
export type PreviewLoadStatus = "idle" | "resolving" | "ready" | "error"
export type PreviewRenderer = DesktopPreviewRenderer
export type ResolvedPreviewTarget = DesktopResolvedPreviewTarget
export type MobileBridgeEvent = DesktopMobileBridgeEvent
export type PreviewErrorKind =
  | "empty-url"
  | "invalid-url"
  | "unsupported-protocol"
  | "connection-refused"
  | "dns"
  | "connection-reset"
  | "timeout"
  | "certificate"
  | "embedded-blocked"
  | "script"
  | "webview-init"
  | "unknown"

export interface SessionWorkflowSummary {
  mode: "execution" | "planning"
  plan: {
    status: "idle" | "draft" | "pending-approval" | "approved"
    updatedAt: number
    approvedAt?: number
  }
}

export type SessionTaskStatus = "pending" | "in_progress" | "completed"

export interface SessionTaskPeer {
  id: string
  subject: string
  status: SessionTaskStatus
  owner: string
}

export interface SessionTaskSummary {
  id: string
  sessionID: string
  subject: string
  description: string
  activeForm: string
  owner: string
  status: SessionTaskStatus
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
  blockingTasks: SessionTaskPeer[]
  blockedTasks: SessionTaskPeer[]
}

export interface SessionTaskOwnerActivity {
  owner: string
  current?: SessionTaskSummary
  next?: SessionTaskSummary
}

export interface SessionTaskTeammateActivity {
  id: string
  owner: string
  title: string
  status: string
  active: boolean
  childSessionID?: string
  updatedAt?: number
}

export interface SessionTaskListView {
  sessionID: string
  generatedAt: number
  tasks: SessionTaskSummary[]
  current: SessionTaskSummary[]
  next: SessionTaskSummary[]
  blocked: SessionTaskSummary[]
  owners: SessionTaskOwnerActivity[]
  teammateActivity: SessionTaskTeammateActivity[]
  summary: {
    total: number
    completed: number
    pending: number
    inProgress: number
    blocked: number
  }
}

export type SessionToolPolicy = "default" | "read-only"

export interface SessionPolicy {
  toolPolicy: SessionToolPolicy
  ignoreFullAccess?: boolean
}

export interface SessionAutomationMetadata {
  automationID: string
  runID: string
  name: string
  trigger: "manual" | "schedule"
}

export interface SessionSubagentOrigin {
  taskID: string
  parentSessionID: string
  parentMessageID: string
  parentToolCallID?: string
  agent: string
  status: "running" | "completed" | "blocked" | "stopped" | "failed" | "cancelled" | "continued_by_user"
  active: boolean
  updatedAt: number
}

export interface SessionModelSelection {
  model?: string
  small_model?: string
  reasoning_effort?: ReasoningEffort
}

export interface SessionSummary {
  id: string
  title: string
  pinned?: boolean
  worktreeID?: string
  branch: string
  status: SessionStatus
  created?: number
  updated: number
  focus: string
  summary: string
  policy?: SessionPolicy
  automation?: SessionAutomationMetadata
  subagent?: SessionSubagentOrigin
  workflow?: SessionWorkflowSummary
  modelSelection?: SessionModelSelection
}

export interface CreateSessionTab {
  id: string
  initialWorkflowMode?: "execution" | "planning"
  workspaceID: string | null
  title: string
}

export type WorkbenchTabKind = "session" | "create-session"

export type WorkbenchTabReference =
  | {
      kind: "session"
      sessionID: string
    }
  | {
      kind: "create-session"
      createSessionTabID: string
    }

export interface ProjectWorktreeCreateRequest {
  name: string
  branchName?: string
  environment?: {
    key: string
    expectedHash: string
    runSetup: boolean
  }
}

export interface WorkspaceGroup {
  id: string
  name: string
  directory: string
  exists?: boolean
  created: number
  updated: number
  project: {
    id: string
    kind?: ProjectKind
    name: string
    repositoryRoot?: string
    workspaceRoots?: string[]
    worktree: string
    vcs?: ProjectVcs
  }
  sessions: SessionSummary[]
}

export interface LoadedSessionSnapshot {
  id: string
  projectID: string
  worktreeID?: string
  directory: string
  title: string
  pinned?: boolean
  policy?: SessionPolicy
  automation?: SessionAutomationMetadata
  subagent?: SessionSubagentOrigin
  created: number
  updated: number
  workflow?: SessionWorkflowSummary
  modelSelection?: SessionModelSelection
}

export interface ArchivedSessionSummary {
  id: string
  projectID: string
  projectName: string | null
  projectMissing: boolean
  directory: string
  title: string
  policy?: SessionPolicy
  created: number
  updated: number
  archivedAt: number
  messageCount: number
  eventCount: number
}

export interface LoadedFolderWorkspace {
  id: string
  directory: string
  name: string
  exists?: boolean
  created: number
  updated: number
  project: {
    id: string
    kind?: ProjectKind
    name: string
    repositoryRoot?: string
    workspaceRoots?: string[]
    worktree: string
    vcs?: ProjectVcs
  }
  sessions: LoadedSessionSnapshot[]
}

export interface LoadedSessionHistoryInfo {
  id: string
  sessionID: string
  role: "user" | "assistant"
  created: number
  parentMessageID?: string | null
  completed?: number
  diffSummary?: SessionDiffSummary
  error?: {
    message?: string
    [key: string]: unknown
  }
  [key: string]: unknown
}

export interface LoadedSessionHistoryTurnErrorInfo {
  name?: string
  message: string
  code?: string
  statusCode?: number
  retryable?: boolean
  providerID?: string
  modelID?: string
}

export interface LoadedSessionHistoryTurn {
  id: string
  sessionID: string
  projectID: string
  executionID?: string
  threadTargetKind?: "active-thread" | "detached-branch"
  initialParentMessageID?: string | null
  userMessageID?: string
  resume?: boolean
  agent?: string
  model?: {
    providerID: string
    modelID: string
  }
  status: "running" | "completed" | "blocked" | "failed" | "cancelled" | "continued_by_user"
  phase?: string
  lastMessageID?: string
  finishReason?: string
  error?: string
  errorInfo?: LoadedSessionHistoryTurnErrorInfo
  createdAt: number
  updatedAt: number
  completedAt?: number
}

export interface LoadedSessionHistoryMessage {
  info: LoadedSessionHistoryInfo
  parts: unknown[]
  turn?: LoadedSessionHistoryTurn
}

export interface SessionDiffFile {
  file: string
  additions: number
  deletions: number
  patch?: string
  gitState?: "clean" | "mixed" | "staged" | "unknown" | "unstaged" | "untracked"
}

export type SessionDiffScope =
  | "git:unstaged"
  | "git:staged"
  | "git:commit"
  | "git:branch"
  | "session:last-turn"

export type SessionDiffRestoreMode = "git-file" | "patch" | "none"

export interface SessionDiffScopeOption {
  scope: SessionDiffScope
  label: string
  enabled: boolean
  count?: number
  reason?: string
  hasChildren?: boolean
}

export interface SessionDiffSummary {
  title?: string
  body?: string
  stats?: {
    additions: number
    deletions: number
    files: number
  }
  scope?: SessionDiffScope
  restoreMode?: SessionDiffRestoreMode
  availableScopes?: SessionDiffScopeOption[]
  diffs: SessionDiffFile[]
}

export type SessionDiffStatus = "idle" | "loading" | "refreshing" | "ready" | "empty" | "error"

export interface SessionDiffState {
  status: SessionDiffStatus
  errorMessage: string | null
  updatedAt: number | null
  isStale: boolean
}

export type PreviewInteractionPluginID = "web.comment" | (string & {})

export interface PreviewInteractionRect {
  bottom?: number
  height: number
  left: number
  right?: number
  top: number
  width: number
}

export type PreviewInteractionAnchor =
  | {
      type: "coordinate"
    }
  | {
      type: "element"
      label?: string
      offsetX?: number
      offsetY?: number
      path?: string
      rect?: PreviewInteractionRect
      selector?: string
      tagName?: string
      text?: string
    }

export interface WebCommentInteractionPayload {
  kind: "web-comment"
  anchor?: PreviewInteractionAnchor
  documentX?: number
  documentY?: number
  frame?: string
  nodePosition?: string
  pageUrl: string
  screenshotPath?: string | null
  text: string
  x: number
  y: number
}

export type PreviewInteractionPayload =
  | WebCommentInteractionPayload
  | {
      kind: string
      [key: string]: unknown
    }

export interface PreviewInteractionRecord {
  id: string
  pluginID: PreviewInteractionPluginID
  targetKey: string
  renderer: PreviewRenderer
  createdAt: number
  payload: PreviewInteractionPayload
  snapshot?: {
    mime?: string
    path?: string
    title?: string
    url?: string
  }
}

export interface PreviewInteractionCommitInput {
  pluginID: PreviewInteractionPluginID
  targetKey: string
  renderer: PreviewRenderer
  payload: PreviewInteractionPayload
  snapshot?: PreviewInteractionRecord["snapshot"]
}

export interface WorkspacePreviewState {
  activeTargetInput: string | null
  activeInteractionID: PreviewInteractionPluginID | null
  draftUrl: string
  draftTarget: string
  committedUrl: string | null
  reloadToken: number
  errorKind: PreviewErrorKind | null
  errorMessage: string | null
  navigationHistory: string[]
  navigationIndex: number
  interactions: PreviewInteractionRecord[]
  resolvedTarget: ResolvedPreviewTarget | null
  status: PreviewLoadStatus
}

export interface WorkspaceFileSearchResult {
  path: string
  absolutePath?: string
  name: string
  extension: string | null
}

export interface WorkspaceDirectoryEntry {
  path: string
  name: string
  kind: "directory" | "file"
  extension: string | null
  hasChildren: boolean
}

export interface WorkspaceFileLineRange {
  startLineNumber: number
  endLineNumber: number
}

export interface WorkspaceFileComment extends WorkspaceFileLineRange {
  id: string
  filePath: string
  text: string
  createdAt: number
}

export interface WorkspaceFilePendingComment extends WorkspaceFileLineRange {
  text: string
}

export type WorkspaceFileReviewStatus = "idle" | "searching" | "reading" | "ready" | "empty" | "unsupported" | "error"

export interface WorkspaceFileReviewState {
  scopeDirectory: string | null
  query: string
  results: WorkspaceFileSearchResult[]
  treeEntriesByDirectoryPath: Record<string, WorkspaceDirectoryEntry[]>
  treeErrorByDirectoryPath: Record<string, string>
  treeExpandedDirectoryPaths: string[]
  treeLoadingDirectoryPaths: string[]
  selectedFilePath: string | null
  selectedFileContent: string | null
  selectedFileKind: "text" | "image" | "video" | "unsupported" | null
  selectedFileExtension: string | null
  selectedFileMimeType: string | null
  selectedFilePreviewUrl: string | null
  selectedFileSize: number | null
  status: WorkspaceFileReviewStatus
  errorMessage: string | null
  comments: WorkspaceFileComment[]
  linkedLineRange: WorkspaceFileLineRange | null
  pendingComment: WorkspaceFilePendingComment | null
}

export type RightSidebarTabKind =
  | "files"
  | "browser"
  | "review"
  | "terminal"
  | "message-tree"
  | "message-inspector"
  | "branch-thread"

interface RightSidebarBaseTab {
  id: string
  kind: RightSidebarTabKind
  title: string
  targetKey: string
  createdAt: number
}

export interface RightSidebarFilesTab extends RightSidebarBaseTab {
  kind: "files"
  scopeDirectory: string | null
  scopeName: string | null
  state: WorkspaceFileReviewState
}

export interface RightSidebarBrowserTab extends RightSidebarBaseTab {
  kind: "browser"
  workspaceID: string | null
  workspaceRoot: string | null
  state: WorkspacePreviewState
}

export interface RightSidebarReviewTab extends RightSidebarBaseTab {
  kind: "review"
  sessionID: string | null
}

export interface RightSidebarTerminalTab extends RightSidebarBaseTab {
  kind: "terminal"
  sessionID: string | null
}

export interface RightSidebarMessageTreeTab extends RightSidebarBaseTab {
  kind: "message-tree"
  sessionID: string
}

export interface RightSidebarMessageInspectorTab extends RightSidebarBaseTab {
  kind: "message-inspector"
  messageID: string
  sessionID: string
}

export interface BranchChatQuote {
  sourceMessageID: string
  text: string
}

export interface RightSidebarBranchThreadTab extends RightSidebarBaseTab {
  anchorStrategy: "latest-at-send" | "selected"
  kind: "branch-thread"
  sessionID: string
  originMessageID: string
  headMessageID: string
  executionID: string
  phase: "draft" | "committed"
  initialQuotes: BranchChatQuote[]
}

export type RightSidebarTab =
  | RightSidebarFilesTab
  | RightSidebarBrowserTab
  | RightSidebarReviewTab
  | RightSidebarTerminalTab
  | RightSidebarMessageTreeTab
  | RightSidebarMessageInspectorTab
  | RightSidebarBranchThreadTab

export interface RightSidebarState {
  tabs: RightSidebarTab[]
  activeTabID: string | null
}

export type RightSidebarOpenTabInput =
  | {
      kind: "files"
      filePath?: string | null
      scopeDirectory: string | null
      scopeName: string | null
      targetKey?: string
      title?: string
    }
  | {
      kind: "browser"
      target?: string | null
      targetKey?: string
      title?: string
      workspaceID: string | null
      workspaceRoot: string | null
    }
  | {
      kind: "review"
      sessionID: string | null
      targetKey?: string
      title?: string
    }
  | {
      kind: "terminal"
      sessionID: string | null
      targetKey?: string
      title?: string
    }
  | {
      kind: "message-tree"
      sessionID: string
      targetKey?: string
      title?: string
    }
  | {
      kind: "message-inspector"
      messageID: string
      sessionID: string
      targetKey?: string
      title?: string
    }
  | {
      kind: "branch-thread"
      anchorStrategy?: "latest-at-send" | "selected"
      sessionID: string
      originMessageID: string
      headMessageID?: string
      executionID?: string
      phase?: "draft" | "committed"
      initialQuotes?: BranchChatQuote[]
      targetKey?: string
      title?: string
    }

export interface RightSidebarTabUpdate {
  anchorStrategy?: "latest-at-send" | "selected"
  executionID?: string
  messageID?: string
  originMessageID?: string
  headMessageID?: string
  phase?: "draft" | "committed"
  initialQuotes?: BranchChatQuote[]
  scopeDirectory?: string | null
  scopeName?: string | null
  sessionID?: string | null
  targetKey?: string
  title?: string
  workspaceID?: string | null
  workspaceRoot?: string | null
}

export type RuntimeDebugLoadStatus = "idle" | "loading" | "refreshing" | "ready" | "error"

export interface SessionRuntimeDebugState {
  status: RuntimeDebugLoadStatus
  errorMessage: string | null
  updatedAt: number | null
  isStale: boolean
}

export type RuntimePhase =
  | "preparing"
  | "waiting_llm"
  | "reasoning"
  | "executing_tool"
  | "waiting_approval"
  | "responding"
  | "retrying"
  | "blocked"
  | "continued_by_user"
  | "completed"
  | "cancelled"
  | "failed"

export interface SessionRuntimeEventSummary {
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

export interface SessionRuntimeToolSummary {
  callID: string
  tool: string
  title?: string
  status: string
  startedAt?: number
  endedAt?: number
  durationMs?: number
  approvalID?: string
  inputPreview?: string
  outputPreview?: string
  error?: string
}

export interface SessionRuntimeLlmCallSummary {
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

export interface SessionRuntimeErrorContext {
  phase?: RuntimePhase
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
    status: string
  }>
  latestTool?: {
    callID: string
    tool: string
    status: string
  }
}

export interface SessionRuntimeTurnSummary {
  turnID: string
  startedAt?: number
  endedAt?: number
  durationMs?: number
  lastEventAt?: number
  status: "running" | "completed" | "blocked" | "stopped" | "failed" | "continued_by_user"
  phase?: RuntimePhase
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
  llmCalls: SessionRuntimeLlmCallSummary[]
  tools: SessionRuntimeToolSummary[]
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
  errorContext?: SessionRuntimeErrorContext | null
  recentEvents: SessionRuntimeEventSummary[]
}

export interface SessionRuntimeDebugSnapshot {
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
    phase?: RuntimePhase
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
  latestTurn: SessionRuntimeTurnSummary | null
  turns: SessionRuntimeTurnSummary[]
  recentEvents: SessionRuntimeEventSummary[]
  tasks?: SessionTaskListView
  diagnostics: {
    blockedOnApproval: boolean
    activeToolCount: number
    failedToolCount: number
    llmFailureCount: number
    lastErrorMessage?: string
  }
}

export interface SessionContextUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  reasoningTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  measuredAt: number
}

export interface UserThreadMessage {
  id: string
  kind: "user"
  text: string
  displayText?: string
  attachments?: UserThreadMessageAttachment[]
  messageQuotes?: BranchChatQuote[]
  references?: UserThreadMessageReference[]
  questionAnswer?: {
    questionID: string
    selectedOptions?: string[]
    freeformText?: string
  }
  turnMcpServerIDs?: string[]
  diffSummary?: SessionDiffSummary
  submissionMode?: "steer" | "queued"
  streamInsertion?: {
    assistantThreadMessageID?: string
    afterItemCount: number
    status?: "pending" | "consumed"
  }
  timestamp: number
}

export interface PendingConversationInput {
  id: string
  sessionID: string
  text: string
  transportText?: string
  displayText?: string
  attachments?: UserThreadMessageAttachment[]
  references?: UserThreadMessageReference[]
  questionAnswer?: UserThreadMessage["questionAnswer"]
  turnMcpServerIDs?: string[]
  mode: "queued" | "steer"
  status: "pending" | "accepted" | "consumed" | "cancelled" | "failed"
  targetAssistantThreadMessageID?: string
  afterItemCount?: number
  createdAt: number
}

export interface UserThreadMessageAttachment {
  name: string
  path?: string
}

export interface UserThreadMessageReference {
  id: string
  label: string
  title?: string
  kind?: "comment" | "file"
}

export type AssistantTraceItemKind =
  | "system"
  | "reasoning"
  | "text"
  | "question"
  | "tool"
  | "source"
  | "file"
  | "image"
  | "patch"
  | "subtask"
  | "compaction"
  | "step"
  | "retry"
  | "snapshot"
  | "task-state"
  | "error"

export type AssistantTraceSectionKey =
  | "reasoning"
  | "tools"
  | "sources"
  | "response"
  | "approvals"
  | "workflow"
  | "file-change"
  | "debug"

export type AssistantTraceVisibilityKey =
  | "response"
  | "reasoning"
  | "toolCalls"
  | "toolInputs"
  | "toolOutputs"
  | "sources"
  | "files"
  | "approvals"
  | "workflow"
  | "debugMetadata"

export interface AssistantTraceVisibility {
  response: boolean
  reasoning: boolean
  toolCalls: boolean
  toolInputs: boolean
  toolOutputs: boolean
  sources: boolean
  files: boolean
  approvals: boolean
  workflow: boolean
  debugMetadata: boolean
}

export const DEFAULT_ASSISTANT_TRACE_VISIBILITY: AssistantTraceVisibility = {
  response: true,
  reasoning: true,
  toolCalls: true,
  toolInputs: false,
  toolOutputs: true,
  sources: true,
  files: true,
  approvals: true,
  workflow: false,
  debugMetadata: false,
}

export type AssistantTraceStatus =
  | "pending"
  | "running"
  | "completed"
  | "error"
  | "waiting-approval"
  | "denied"
  | "cancelled"

export type AssistantThreadMessagePhase =
  | "requesting"
  | "waiting_first_event"
  | "preparing"
  | "waiting_llm"
  | "reasoning"
  | "tool_running"
  | "waiting_approval"
  | "blocked"
  | "continued_by_user"
  | "responding"
  | "completed"
  | "cancelled"
  | "failed"

export interface AssistantThreadMessageRuntime {
  phase: AssistantThreadMessagePhase
  startedAt: number
  updatedAt: number
  firstVisibleAt?: number
  toolName?: string
  approvalRequestID?: string
  errorMessage?: string
}

export interface AssistantTraceDebugEntry {
  label: string
  value: string
}

export interface AssistantQuestionOption {
  label: string
  value: string
  description?: string
}

export interface AssistantQuestionPrompt {
  questionID?: string
  header?: string
  question: string
  options: AssistantQuestionOption[]
  allowFreeform: boolean
  placeholder?: string
  multiple: boolean
  required: boolean
  answered?: boolean
  answerText?: string
  selectedOptions?: string[]
  freeformText?: string
  answeredAt?: number
}

export interface AssistantTraceProgressItem {
  id: string
  step: string
  status: SessionTaskStatus
}

export type AssistantTraceFileChangePreviewState = "streaming" | "complete" | "invalid" | "truncated"

export interface AssistantTracePreviewDiffRow {
  content: string
  tone: "add" | "context" | "remove"
}

export interface AssistantTracePreviewDiffHunk {
  header: string
  rows: AssistantTracePreviewDiffRow[]
}

export type AssistantTraceFileChangeOperation = "add" | "update" | "delete" | "move"

export interface AssistantTraceDraftPatchPreview {
  detail: string
  fileChanges: AssistantTraceFileChange[]
  filePaths: string[]
  isStreaming: boolean
  status: AssistantTraceStatus
  title: string
}

export interface AssistantTraceFileChange {
  file: string
  additions: number
  deletions: number
  fromFile?: string
  operation?: AssistantTraceFileChangeOperation
  patch?: string
  previewHunks?: AssistantTracePreviewDiffHunk[]
  previewState?: AssistantTraceFileChangePreviewState
}

export interface AssistantTraceItem {
  id: string
  kind: AssistantTraceItemKind
  timestamp: number
  label: string
  title?: string
  toolName?: string
  text?: string
  detail?: string
  src?: string
  mimeType?: string
  width?: number
  height?: number
  alt?: string
  toolInputText?: string
  toolOutputText?: string
  draftPatch?: AssistantTraceDraftPatchPreview
  fileChanges?: AssistantTraceFileChange[]
  filePaths?: string[]
  status?: AssistantTraceStatus
  sourceID?: string
  messageID?: string
  backendTurnID?: string
  partID?: string
  approvalID?: string
  toolCallID?: string
  section?: AssistantTraceSectionKey
  visibilityKey?: AssistantTraceVisibilityKey
  isStreaming?: boolean
  debugEntries?: AssistantTraceDebugEntry[]
  questionPrompt?: AssistantQuestionPrompt
  progressItems?: AssistantTraceProgressItem[]
}

export interface AssistantThreadMessage {
  id: string
  messageID?: string
  kind: "assistant"
  backendTurnID: string
  segmentID: string
  llmCallID?: string
  timestamp: number
  diffSummary?: SessionDiffSummary
  runtime: AssistantThreadMessageRuntime
  state: string
  items: AssistantTraceItem[]
  isStreaming?: boolean
}

export type ThreadMessage = UserThreadMessage | AssistantThreadMessage

export type ThreadTurnStatus =
  | "running"
  | "completed"
  | "blocked"
  | "stopped"
  | "continued_by_user"
  | "failed"
  | "cancelled"

export interface ThreadTurn {
  turnID: string
  backendSessionID?: string
  resume?: boolean
  lastMessageID?: string
  finalSegmentID?: string
  status: ThreadTurnStatus
  phase?: RuntimePhase | AssistantThreadMessagePhase
  startedAt: number
  updatedAt: number
  completedAt?: number
  userMessageID?: string
  messages: ThreadMessage[]
}

export type ConversationTurnMap = Record<string, ThreadTurn[]>

export interface AgentStreamEvent {
  id?: string
  event: string
  data: unknown
}

export interface AgentRuntimeEvent {
  schemaVersion?: 2
  scope?: "turn" | "session"
  eventID: string
  sessionID: string
  turnID: string | null
  executionID?: string
  targetKind?: "active-thread" | "detached-branch"
  seq: number
  timestamp: number
  type: string
  payload: Record<string, unknown>
}

export interface AgentStreamIPCEvent extends AgentStreamEvent {
  streamID: string
}

export interface AgentSessionStreamIPCEvent extends AgentStreamEvent {
  sessionID: string
}

export type AgentSessionExecutionMode = "new-turn" | "queued" | "steer"

export interface WorkspaceFileChangeIPCEvent {
  directory: string
  paths: string[]
}

export interface PendingAgentStream {
  sessionID: string
  backendSessionID?: string
  assistantThreadMessageID: string
  backendTurnID?: string
  pendingInput?: PendingConversationInput
  pendingInputID?: string
  userThreadMessageID?: string
  requestedMode?: "new-turn" | "queue" | "steer"
  executionMode?: AgentSessionExecutionMode
  createdAssistantThreadMessageID?: string
  cancelRequested?: boolean
}

export interface ProviderCatalogItem {
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
  authCapabilities: ProviderAuthCapability[]
  authState: ProviderAuthState
  authScope: "global"
  activeAuthMethod?: string
  connectionLabel?: string
  lastAuthError?: string
}

export type CinemaProviderAuthState = SharedCinemaProviderAuthState
export type CinemaProviderWorkflowCatalog = SharedCinemaProviderWorkflowCatalog
export type CinemaVideoProvider = SharedCinemaVideoProvider
export type CinemaVideoProviderModel = CinemaVideoProvider["manifest"]["models"][number]

export interface CinemaVideoProviderDraftState {
  apiKey: string
  baseURL: string
  userID?: string
}

export interface ProviderAuthCapability {
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

export interface ProviderAuthAccountSummary {
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

export interface ProviderAuthFlow {
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
  account?: ProviderAuthAccountSummary
}

export interface ProviderAuthState {
  providerID: string
  scope: "global"
  activeMethod?: string
  status: "connected" | "pending" | "expired" | "error" | "not_connected"
  connectionLabel?: string
  lastError?: string
  expiresAt?: number
  account?: ProviderAuthAccountSummary
  capabilities: ProviderAuthCapability[]
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
  flow?: ProviderAuthFlow
}

export interface ProviderModelCapabilitiesModalities {
  text: boolean
  audio: boolean
  image: boolean
  video: boolean
  pdf: boolean
}

export interface ProviderModelCapabilities {
  temperature: boolean
  reasoning: boolean
  attachment: boolean
  toolcall: boolean
  input: ProviderModelCapabilitiesModalities
  output: ProviderModelCapabilitiesModalities
}

export interface ProviderModel {
  id: string
  providerID: string
  providerName?: string
  name: string
  family?: string
  status: "alpha" | "beta" | "deprecated" | "active"
  available: boolean
  capabilities: ProviderModelCapabilities
  limit: {
    context: number
    input?: number
    output: number
  }
}

export interface ModelCatalogItemCapabilities extends Partial<Pick<
  ProviderModelCapabilities,
  "temperature" | "reasoning" | "attachment" | "toolcall"
>> {
  input: ProviderModelCapabilitiesModalities
  output: ProviderModelCapabilitiesModalities
  taskModes: string[]
}

export interface ModelCatalogItem {
  registryID: string
  providerID: string
  modelID: string
  name: string
  providerName: string
  family?: string
  runtimeKind: "ai-sdk" | "cinema-task"
  selectable: boolean
  available: boolean
  capabilities: ModelCatalogItemCapabilities
  status: "alpha" | "beta" | "deprecated" | "active"
  source: "provider" | "cinema"
  metadata?: Record<string, unknown>
}

export interface ProjectModelSelection {
  model: string | null
  smallModel: string | null
  reasoningEffort: ReasoningEffort | null
  imageModel: string | null
  imageDefaultSize: string | null
  imageDefaultCount: number | null
}

export interface ProjectSkillSelection {
  skillIDs: string[]
}

export interface ProjectMcpSelection {
  serverIDs: string[]
}

export interface ProjectPluginSelection {
  pluginIDs: string[]
}

export type PromptPresetSource = "bundled" | "custom"

export interface PromptPresetSelection {
  systemPromptPresetID: string
  planModePromptPresetID: string
  gitCommitPromptPresetID: string
  cinemaTextGenerationPromptPresetID: string
}

export interface PromptPresetSummary {
  id: string
  label: string
  description: string
  source: PromptPresetSource
  hasOverride: boolean
  editable: boolean
  sourcePath?: string
  filePath?: string
  root?: string
}

export interface PromptPresetDocument extends PromptPresetSummary {
  content: string
}

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

export interface PromptUrlInstallCandidate {
  id: string
  label: string
  description: string
  sourcePath: string
  available: boolean
  reason?: string
}

export interface PromptUrlInstallPreview {
  previewID: string
  source: string
  prompts: PromptUrlInstallCandidate[]
}

export interface PromptUrlInstallResult {
  installed: PromptPresetDocument[]
}

export type BuiltinToolKind =
  | "read"
  | "write"
  | "search"
  | "exec"
  | "workflow"
  | "interaction"
  | "delegation"
  | "other"
export type BuiltinToolConcurrency = "safe" | "exclusive"

export interface BuiltinToolCapabilities {
  kind?: BuiltinToolKind
  readOnly?: boolean
  destructive?: boolean
  concurrency?: BuiltinToolConcurrency
  needsShell?: boolean
}

export interface BuiltinToolSummary {
  id: string
  title: string
  description: string
  inputSchema?: unknown
  aliases: string[]
  capabilities: BuiltinToolCapabilities
  enabled: boolean
}

export interface BuiltinToolSelection {
  tools: Record<string, boolean>
}

export interface BuiltinToolsPayload {
  items: BuiltinToolSummary[]
  selection: BuiltinToolSelection
}

export interface ComposerAttachment {
  path: string
  name: string
}

export interface ComposerPastedImageAttachment {
  dataUrl: string
  mimeType: string
  name?: string
}

export interface ComposerFileCommentReference {
  source: "file"
  id: string
  filePath: string
  startLineNumber: number
  endLineNumber: number
  label: string
  title: string
  prompt: string
}

export interface ComposerPreviewInteractionReference {
  source: "preview"
  id: string
  label: string
  title: string
  prompt: string
  interaction: PreviewInteractionRecord
  pageUrl: string
}

export type ComposerCommentReference =
  | ComposerFileCommentReference
  | ComposerPreviewInteractionReference

export interface ComposerDraftState {
  lexicalJSON: string
  plainText: string
}

export interface ComposerFileTagData {
  kind: "file"
  id: string
  label: string
  filePath: string
}

export interface ComposerFileCommentTagData {
  kind: "comment"
  source: "file"
  id: string
  label: string
  filePath: string
  startLineNumber: number
  endLineNumber: number
  title: string
  prompt: string
}

export interface ComposerPreviewInteractionTagData {
  kind: "comment"
  source: "preview"
  id: string
  label: string
  title: string
  prompt: string
  interaction: PreviewInteractionRecord
  pageUrl: string
}

export type ComposerCommentTagData =
  | ComposerFileCommentTagData
  | ComposerPreviewInteractionTagData

export interface ComposerSkillTagData {
  kind: "skill"
  id: string
  label: string
  skillID: string
  description?: string
}

export interface ComposerMcpTagData {
  kind: "mcp"
  id: string
  label: string
  serverID: string
  description?: string
}

export interface ComposerPluginTagData {
  kind: "plugin"
  id: string
  label: string
  pluginID: string
  description?: string
}

export interface ComposerLongTextTagData {
  kind: "long-text"
  id: string
  label: string
  text: string
  characterCount: number
  lineCount: number
}

export type ComposerTagData =
  | ComposerFileTagData
  | ComposerCommentTagData
  | ComposerSkillTagData
  | ComposerMcpTagData
  | ComposerPluginTagData
  | ComposerLongTextTagData

export type ColorMode = "system" | "light" | "dark"
export type BrandTheme = "terra" | "sage"

export type ReasoningEffort = SharedReasoningEffort
export type OpenAIReasoningEffort = ReasoningEffort

export interface ComposerModelOption {
  value: string
  label: string
  providerID: string
  providerLabel: string
}

export interface ComposerReasoningEffortOption {
  value: ReasoningEffort
  label: string
  description: string
}

export interface ComposerSkillOption {
  value: string
  label: string
  description: string
}

export interface ComposerMcpOption {
  value: string
  label: string
  description: string
}

export interface ComposerPluginOption {
  value: string
  label: string
  description: string
  icon?: string
  iconUrl?: string
}

export interface ProviderDraftState {
  apiKey: string
  baseURL: string
  selectedAuthMethod: string | null
  activeFlow?: ProviderAuthFlow | null
}

export interface CustomProviderDraftState {
  apiBaseURL: string
  apiKey: string
  defaultModel: string
  chatEndpoint: string
}

export interface SkillInfo {
  id: string
  name: string
  description: string
  path: string
  scope: "project" | "user" | "plugin"
}

export interface GlobalSkillTreeNode {
  name: string
  path: string
  kind: "directory" | "file"
  role?: "folder" | "skill" | "resource"
  readOnly?: boolean
  scope?: "user" | "plugin"
  pluginID?: string
  enabled?: boolean
  children?: GlobalSkillTreeNode[]
}

export interface GlobalSkillTree {
  root: string
  items: GlobalSkillTreeNode[]
}

export interface GlobalSkillFileDocument {
  path: string
  content: string
  readOnly?: boolean
  scope?: "user" | "plugin"
  pluginID?: string
}

export interface SkillInstallCandidate {
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

export interface SkillGitInstallPreview {
  previewID: string
  source: string
  cloneUrl: string
  ref?: string
  subpath?: string
  skills: SkillInstallCandidate[]
}

export interface InstalledGlobalSkill {
  id: string
  name: string
  directory: string
  filePath: string
}

export interface SkillGitInstallResult {
  installed: InstalledGlobalSkill[]
}

export type McpAllowedTools =
  | string[]
  | {
      readOnly?: boolean
      toolNames?: string[]
    }

export type McpToolPolicyValue = "disabled" | "ask" | "auto"

export type McpToolPolicies = Record<string, {
  policy: McpToolPolicyValue
}>

export type McpRequireApproval =
  | "always"
  | "never"
  | {
      never?: {
        toolNames?: string[]
      }
    }

export type McpServerOwner =
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

export interface StdioMcpServerSummary {
  id: string
  name?: string
  owner?: McpServerOwner
  transport: "stdio"
  command: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  toolPolicies?: McpToolPolicies
  enabled: boolean
  timeoutMs?: number
}

export interface RemoteMcpServerSummary {
  id: string
  name?: string
  owner?: McpServerOwner
  transport: "remote"
  provider?: "openai"
  serverUrl?: string
  connectorId?: string
  connectorRuntimeId?: string
  authorization?: string
  headers?: Record<string, string>
  serverDescription?: string
  allowedTools?: McpAllowedTools
  toolPolicies?: McpToolPolicies
  requireApproval?: McpRequireApproval
  enabled: boolean
  timeoutMs?: number
}

export interface ConnectorMcpServerSummary {
  id: string
  name?: string
  owner?: McpServerOwner
  transport: "connector"
  provider?: "openai"
  connectorId: string
  connectorRuntimeId?: string
  serverDescription?: string
  allowedTools?: McpAllowedTools
  toolPolicies?: McpToolPolicies
  requireApproval?: McpRequireApproval
  enabled: boolean
  timeoutMs?: number
}

export type McpServerSummary = StdioMcpServerSummary | RemoteMcpServerSummary | ConnectorMcpServerSummary

export interface McpToolDiagnostic {
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
  recommendedPolicy: McpToolPolicyValue
  configuredPolicy?: McpToolPolicyValue
}

export interface McpServerDiagnostic {
  serverID: string
  enabled: boolean
  ok: boolean
  toolCount: number
  toolNames: string[]
  tools: McpToolDiagnostic[]
  error?: string
}

export type PluginCategory = "Code" | "Browser" | "Git" | "Database" | "Docs" | "Automation" | "Design"
export type PluginRisk = "low" | "medium" | "high" | "critical"

export interface PluginToolPreview {
  name: string
  title?: string
  description: string
  readOnly?: boolean
  destructive?: boolean
}

export type ConnectorRisk = "low" | "medium" | "high" | "critical"

export interface ConnectorApiKeyCredential {
  kind: "api_key"
  key: string
  label: string
  type?: "text" | "password"
  required?: boolean
  secret?: boolean
  placeholder?: string
  description?: string
}

export type ConnectorOAuthTokenPlacement =
  | {
      type: "authorization_bearer"
    }
  | {
      type: "header"
      name: string
      value?: string
    }

export interface ConnectorOAuthCredential {
  kind: "oauth"
  label: string
  clientID?: string
  clientIDConfigKey?: string
  clientSecretConfigKey?: string
  authorizationURL: string
  tokenURL: string
  scopes: string[]
  revocationURL?: string
  tokenPlacement?: ConnectorOAuthTokenPlacement
  authorizationParams?: Record<string, string>
  tokenParams?: Record<string, string>
  tokenEndpointAuthMethod?: "none" | "client_secret_post" | "client_secret_basic"
  tokenRequestFormat?: "form" | "json"
  description?: string
}

export type ConnectorCredential = ConnectorApiKeyCredential | ConnectorOAuthCredential

export interface ConnectorConfigField {
  key: string
  label: string
  type?: "text" | "password" | "url" | "path"
  required?: boolean
  secret?: boolean
  placeholder?: string
  defaultValue?: string
  description?: string
}

export interface ConnectorStdioRuntime {
  transport: "stdio"
  command: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  serverDescription?: string
  allowedTools?: McpAllowedTools
  toolPolicies?: McpToolPolicies
  requireApproval?: McpRequireApproval
  timeoutMs?: number
}

export interface ConnectorRemoteRuntime {
  transport: "remote"
  provider?: "openai"
  serverUrl?: string
  authorization?: string
  headers?: Record<string, string>
  serverDescription?: string
  allowedTools?: McpAllowedTools
  toolPolicies?: McpToolPolicies
  requireApproval?: McpRequireApproval
  timeoutMs?: number
}

export type ConnectorRuntime = ConnectorStdioRuntime | ConnectorRemoteRuntime

export interface ConnectorStdioMcpRuntime extends ConnectorStdioRuntime {
  id: string
  name?: string
  available: boolean
}

export interface ConnectorRemoteMcpRuntime extends ConnectorRemoteRuntime {
  id: string
  name?: string
  available: boolean
}

export type ConnectorMcpRuntime = ConnectorStdioMcpRuntime | ConnectorRemoteMcpRuntime

export interface ConnectorMcpBinding {
  runtimeID: string
  serverID: string
  name?: string
}

export interface ConnectorDefinition {
  id: string
  name: string
  description: string
  category?: "account_connector"
  publisher: string
  icon?: string
  risk: ConnectorRisk
  permissions: string[]
  tools: PluginToolPreview[]
  configFields: ConnectorConfigField[]
  oauthCallbackURL?: string
  credential?: ConnectorCredential
  mcpRuntimes?: ConnectorMcpRuntime[]
  runtime?: ConnectorRuntime
  installReview: string[]
  source: "platform" | "registry"
  available: boolean
}

export interface ConnectorRequirement {
  connector: string
  tools?: string[]
  permissions?: string[]
  required?: boolean
  reason?: string
}

export interface McpRequirement {
  mcp: string
  tools?: string[]
  permissions?: string[]
  required?: boolean
  reason?: string
}

export interface ConnectorStatus {
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
  account?: ProviderAuthAccountSummary
  email?: string
  expiresAt?: number
  activeFlow?: ProviderAuthFlow
  mcpBindings?: ConnectorMcpBinding[]
  generatedMcpServerID?: string
  lastDiagnostic?: McpServerDiagnostic
}

export interface PluginConfigField {
  key: string
  label: string
  type?: "text" | "password" | "url" | "path"
  required?: boolean
  secret?: boolean
  placeholder?: string
  defaultValue?: string
  description?: string
}

export interface PluginApiKeyAppCredential extends PluginConfigField {
  kind?: "api_key"
}

export type PluginOAuthTokenPlacement =
  | {
      type: "authorization_bearer"
    }
  | {
      type: "header"
      name: string
      value?: string
    }

export interface PluginOAuthClientRegistration {
  registrationURL: string
  initialAccessToken?: string
  metadata?: Record<string, unknown>
}

export interface PluginOAuthAppCredential {
  kind: "oauth"
  label: string
  clientID?: string
  clientSecret?: string
  authorizationURL: string
  tokenURL: string
  scopes: string[]
  revocationURL?: string
  tokenPlacement?: PluginOAuthTokenPlacement
  authorizationParams?: Record<string, string>
  tokenParams?: Record<string, string>
  tokenEndpointAuthMethod?: "none" | "client_secret_post" | "client_secret_basic"
  registration?: PluginOAuthClientRegistration
  description?: string
}

export type PluginAppCredential = PluginApiKeyAppCredential | PluginOAuthAppCredential

export type PluginPackageDownload =
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

export interface PluginLocalizedText {
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

export interface PluginCatalogLocalization {
  name?: PluginLocalizedText
  description?: PluginLocalizedText
  longDescription?: PluginLocalizedText
}

export interface PluginStdioRuntime {
  transport: "stdio"
  command: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  toolPolicies?: McpToolPolicies
  timeoutMs?: number
}

export interface PluginRemoteRuntime {
  transport: "remote"
  provider?: "openai"
  serverUrl?: string
  connectorId?: string
  authorization?: string
  headers?: Record<string, string>
  serverDescription?: string
  allowedTools?: McpAllowedTools
  toolPolicies?: McpToolPolicies
  requireApproval?: McpRequireApproval
  timeoutMs?: number
}

export type PluginRuntimeTemplate = PluginStdioRuntime | PluginRemoteRuntime

export interface PluginMcpServerCatalogEntry {
  id: string
  name: string
  description?: string
  risk?: PluginRisk
  permissions?: string[]
  tools: PluginToolPreview[]
  configFields?: PluginConfigField[]
  runtime: PluginRuntimeTemplate
  installReview?: string[]
}

export interface PluginSkillPreview {
  id: string
  name: string
  description: string
  directory: string
}

export interface PluginSkillEntry {
  name: string
  path: string
  kind: "file" | "directory"
  size?: number
  mimeType?: string
  hasChildren?: boolean
}

export interface PluginSkillDirectory {
  pluginID: string
  skillID: string
  skillName: string
  path: string
  entries: PluginSkillEntry[]
  readOnly: true
}

export interface PluginSkillFile {
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

export interface PluginAppConnector {
  id?: string
  appID: string
  name: string
  description?: string
  icon?: string
  risk?: PluginRisk
  permissions?: string[]
  tools?: PluginToolPreview[]
  configFields?: PluginConfigField[]
  credential: PluginAppCredential
  runtime: PluginRuntimeTemplate
  installReview?: string[]
}

export interface PluginCatalogItem {
  id: string
  name: string
  description: string
  longDescription?: string
  localized?: PluginCatalogLocalization
  version: string
  publisher: string
  category: PluginCategory
  icon?: string
  iconUrl?: string
  thumbnailUrl?: string
  heroImageUrl?: string
  screenshots: string[]
  tags: string[]
  brandColor?: string
  homepage?: string
  documentationUrl?: string
  risk: PluginRisk
  permissions: string[]
  tools: PluginToolPreview[]
  configFields: PluginConfigField[]
  runtime?: PluginRuntimeTemplate
  mcpServers: PluginMcpServerCatalogEntry[]
  mcpRequirements: McpRequirement[]
  skills: PluginSkillPreview[]
  connectorRequirements: ConnectorRequirement[]
  connectors: PluginAppConnector[]
  apps: PluginAppConnector[]
  installReview?: string[]
  source?: "package" | "registry"
  download?: PluginPackageDownload
  installable?: boolean
}

export interface InstalledPlugin {
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
  lastDiagnostic?: McpServerDiagnostic
  lastConnectorDiagnostics?: Record<string, McpServerDiagnostic>
  packageRoot?: string
  missingPackage?: boolean
}

export interface PluginConnectorStatus {
  pluginID: string
  appID: string
  connectorID: string
  connected: boolean
  credentialKind: "api_key" | "oauth"
  authStatus: "connected" | "not_connected" | "pending" | "expired" | "error"
  credentialLabel?: string
  account?: ProviderAuthAccountSummary
  email?: string
  expiresAt?: number
  activeFlow?: ProviderAuthFlow
  generatedMcpServerID: string
  lastDiagnostic?: McpServerDiagnostic
}

export interface PluginDraftState {
  pluginID: string | null
  config: Record<string, string>
  appApiKeys: Record<string, string>
}

export interface McpServerDraftState {
  id: string
  name: string
  transport: "stdio" | "remote" | "connector"
  command: string
  args: string
  env: string
  cwd: string
  serverUrl: string
  connectorId: string
  connectorRuntimeId?: string
  authorization: string
  headers: string
  allowedToolsMode: "all" | "names" | "read-only" | "read-only-names"
  allowedToolNames: string
  toolPolicies: Record<string, McpToolPolicyValue>
  enabled: boolean
  timeoutMs: string
}
