import { createEmptyComposerDraftState } from "../composer/draft-state"
import type { SerializedDockview } from "dockview-react"
import type {
  ComposerAttachment,
  ComposerDraftState,
  CreateSessionTab,
  PendingConversationInput,
  PermissionRequest,
  SessionContextUsage,
  SessionDiffState,
  SessionDiffSummary,
  SessionRuntimeDebugSnapshot,
  SessionRuntimeDebugState,
  SessionTaskListView,
  SessionSummary,
  ThreadMessage,
  WorkbenchTabReference,
  WorkspaceFileComment,
  WorkspaceFileReviewState,
  WorkspaceGroup,
  WorkspacePreviewState,
} from "../types"
import type { SessionMessageTree } from "../session-message-tree"
import { createID } from "../utils"
import {
  getActiveDockviewPanelReferenceFromState,
  getActivePanelForGroupFromState,
  getDockviewGroupsInOrder,
  getFocusedDockviewGroupIDFromState,
  getOpenSessionIDs,
  getVisibleSessionIDsFromState,
  getWorkbenchDockPanelId,
  normalizeDockviewActiveState,
  type WorkbenchDockviewActiveState,
  type WorkbenchDockviewGroupLocation,
} from "../workbench/dockview-state"
import { findWorkspaceByID, isSideChatSession, isWorkspaceAvailable } from "../workspace"
import type { WorkbenchPaneRenderSnapshot } from "../../../../shared/desktop-ipc-contract"
import type { ConversationActivityMap } from "./conversation-store"
import {
  DEFAULT_SESSION_DIFF_STATE,
  DEFAULT_SESSION_RUNTIME_DEBUG_STATE,
  DEFAULT_WORKSPACE_PREVIEW_STATE,
  getWorkspaceFileCommentKey,
  resolvePreviewScopeID,
} from "./review-preview-state"
import type { WorkspaceStore } from "./workspace-store"

const EMPTY_COMPOSER_ATTACHMENTS: ComposerAttachment[] = []
const EMPTY_COMPOSER_DRAFT_STATE = createEmptyComposerDraftState()
const EMPTY_PENDING_CONVERSATION_INPUTS: PendingConversationInput[] = []
const EMPTY_PERMISSION_REQUESTS: PermissionRequest[] = []
const EMPTY_SIDE_CHAT_COUNTS_BY_ANCHOR_MESSAGE_ID: Record<string, number> = {}
const EMPTY_SIDE_CHAT_SESSIONS_BY_ANCHOR_MESSAGE_ID: Record<string, SessionSummary[]> = {}
const EMPTY_MESSAGES: ThreadMessage[] = []
const sideChatSessionsByParentCache = new WeakMap<WorkspaceGroup[], Map<string, Record<string, SessionSummary[]>>>()
const runningSessionIDsCache = new WeakMap<Record<string, ThreadMessage[]>, WeakMap<Record<string, boolean>, string[]>>()

function getSideChatCreatedAt(session: SessionSummary) {
  return session.created ?? session.updated
}

function compareSideChatSessions(left: SessionSummary, right: SessionSummary) {
  const createdDelta = getSideChatCreatedAt(left) - getSideChatCreatedAt(right)
  if (createdDelta !== 0) return createdDelta

  const updatedDelta = left.updated - right.updated
  if (updatedDelta !== 0) return updatedDelta

  return left.id.localeCompare(right.id)
}

export function collectSideChatSessionsByAnchorMessageID(workspaces: WorkspaceGroup[], parentSessionID: string) {
  const cachedByParentSessionID = sideChatSessionsByParentCache.get(workspaces)
  const cached = cachedByParentSessionID?.get(parentSessionID)
  if (cached) return cached

  const sessionsByAnchorMessageID: Record<string, SessionSummary[]> = {}

  for (const workspace of workspaces) {
    for (const session of workspace.sessions) {
      if (!isSideChatSession(session)) continue
      if (session.origin?.parentSessionID !== parentSessionID) continue
      const anchorMessageID = session.origin.anchorMessageID
      sessionsByAnchorMessageID[anchorMessageID] = [...(sessionsByAnchorMessageID[anchorMessageID] ?? []), session]
    }
  }

  for (const [anchorMessageID, sessions] of Object.entries(sessionsByAnchorMessageID)) {
    sessionsByAnchorMessageID[anchorMessageID] = [...sessions].sort(compareSideChatSessions)
  }

  const nextCachedByParentSessionID = cachedByParentSessionID ?? new Map<string, Record<string, SessionSummary[]>>()
  if (!cachedByParentSessionID) {
    sideChatSessionsByParentCache.set(workspaces, nextCachedByParentSessionID)
  }
  nextCachedByParentSessionID.set(parentSessionID, sessionsByAnchorMessageID)

  return sessionsByAnchorMessageID
}

export function collectSideChatCountsFromSessionsByAnchorMessageID(sessionsByAnchorMessageID: Record<string, SessionSummary[]>) {
  const counts: Record<string, number> = {}

  for (const [anchorMessageID, sessions] of Object.entries(sessionsByAnchorMessageID)) {
    counts[anchorMessageID] = sessions.length
  }

  return counts
}

export function collectSideChatCountsForParentSession(workspaces: WorkspaceGroup[], parentSessionID: string) {
  return collectSideChatCountsFromSessionsByAnchorMessageID(collectSideChatSessionsByAnchorMessageID(workspaces, parentSessionID))
}

export function findLatestSideChatForAnchor(
  workspaces: WorkspaceGroup[],
  parentSessionID: string,
  anchorMessageID: string,
) {
  let match: { workspace: WorkspaceGroup; session: SessionSummary } | null = null

  for (const workspace of workspaces) {
    for (const session of workspace.sessions) {
      if (!isSideChatSession(session)) continue
      if (session.origin?.parentSessionID !== parentSessionID) continue
      if (session.origin.anchorMessageID !== anchorMessageID) continue
      if (!match || compareSideChatSessions(match.session, session) < 0) {
        match = { workspace, session }
      }
    }
  }

  return match
}

export function getUniqueSessionIDs(sessionIDs: string[]) {
  const seen = new Set<string>()
  const nextSessionIDs: string[] = []

  for (const sessionID of sessionIDs) {
    if (seen.has(sessionID)) continue
    seen.add(sessionID)
    nextSessionIDs.push(sessionID)
  }

  return nextSessionIDs
}

export function createSessionWorkbenchTab(sessionID: string): WorkbenchTabReference {
  return {
    kind: "session",
    sessionID,
  }
}

export function createCreateSessionWorkbenchTab(createSessionTabID: string): WorkbenchTabReference {
  return {
    kind: "create-session",
    createSessionTabID,
  }
}

export function getWorkbenchTabKey(tab: WorkbenchTabReference) {
  return tab.kind === "session" ? `session:${tab.sessionID}` : `create-session:${tab.createSessionTabID}`
}

export function getWorkbenchTabReferenceFromKey(tabKey: string): WorkbenchTabReference | null {
  if (tabKey.startsWith("session:")) {
    return {
      kind: "session",
      sessionID: tabKey.slice("session:".length),
    }
  }

  if (tabKey.startsWith("create-session:")) {
    return {
      kind: "create-session",
      createSessionTabID: tabKey.slice("create-session:".length),
    }
  }

  return null
}

export function createCreateSessionTab(workspaceID: string | null): CreateSessionTab {
  return {
    id: createID("create-session-tab"),
    workspaceID,
    title: "",
  }
}

export function resolveCreateSessionWorkspaceID(
  workspaces: WorkspaceGroup[],
  preferredWorkspaceID?: string | null,
  selectedFolderID?: string | null,
  activeWorkspaceID?: string | null,
) {
  const candidateIDs = [preferredWorkspaceID, selectedFolderID, activeWorkspaceID]

  for (const candidateID of candidateIDs) {
    if (!candidateID) continue
    const workspace = findWorkspaceByID(workspaces, candidateID)
    if (workspace && isWorkspaceAvailable(workspace)) return candidateID
  }

  return workspaces.find((workspace) => isWorkspaceAvailable(workspace))?.id ?? workspaces[0]?.id ?? null
}

interface WorkspaceLookupIndex {
  sessionSelectionByID: Map<string, { workspace: WorkspaceGroup; session: SessionSummary }>
  workspaceByID: Map<string, WorkspaceGroup>
}

const workspaceLookupIndexCache = new WeakMap<WorkspaceGroup[], WorkspaceLookupIndex>()

function getWorkspaceLookupIndex(workspaces: WorkspaceGroup[]) {
  const cached = workspaceLookupIndexCache.get(workspaces)
  if (cached) return cached

  const sessionSelectionByID = new Map<string, { workspace: WorkspaceGroup; session: SessionSummary }>()
  const workspaceByID = new Map<string, WorkspaceGroup>()
  for (const workspace of workspaces) {
    workspaceByID.set(workspace.id, workspace)
    for (const session of workspace.sessions) {
      sessionSelectionByID.set(session.id, { workspace, session })
    }
  }

  const index = { sessionSelectionByID, workspaceByID }
  workspaceLookupIndexCache.set(workspaces, index)
  return index
}

function findIndexedSession(workspaces: WorkspaceGroup[], sessionID: string | null | undefined) {
  if (!sessionID) {
    return {
      workspace: null,
      session: null,
    }
  }

  return getWorkspaceLookupIndex(workspaces).sessionSelectionByID.get(sessionID) ?? {
    workspace: null,
    session: null,
  }
}

function findIndexedWorkspaceByID(workspaces: WorkspaceGroup[], workspaceID: string | null | undefined) {
  if (!workspaceID) return null
  return getWorkspaceLookupIndex(workspaces).workspaceByID.get(workspaceID) ?? null
}

function getSessionIDFromTabKey(tabKey: string) {
  return tabKey.startsWith("session:") ? tabKey.slice("session:".length) : null
}

function getRunningSessionIDs(
  conversations: Record<string, ThreadMessage[]>,
  isSendingByTabKey: Record<string, boolean>,
  conversationActivityBySession?: ConversationActivityMap,
) {
  if (conversationActivityBySession) {
    const sessionIDs = new Set<string>()

    for (const [tabKey, isSending] of Object.entries(isSendingByTabKey)) {
      const sessionID = isSending ? getSessionIDFromTabKey(tabKey) : null
      if (sessionID) sessionIDs.add(sessionID)
    }

    for (const [sessionID, activity] of Object.entries(conversationActivityBySession)) {
      if (activity.hasStreamingAssistantMessage) {
        sessionIDs.add(sessionID)
      }
    }

    return Array.from(sessionIDs)
  }

  const cachedBySendingState = runningSessionIDsCache.get(conversations)
  const cached = cachedBySendingState?.get(isSendingByTabKey)
  if (cached) return cached

  const sessionIDs = new Set<string>()

  for (const [tabKey, isSending] of Object.entries(isSendingByTabKey)) {
    const sessionID = isSending ? getSessionIDFromTabKey(tabKey) : null
    if (sessionID) sessionIDs.add(sessionID)
  }

  for (const [sessionID, turns] of Object.entries(conversations)) {
    if (turns.some((turn) => turn.kind === "assistant" && turn.isStreaming)) {
      sessionIDs.add(sessionID)
    }
  }

  const nextSessionIDs = Array.from(sessionIDs)
  const nextCachedBySendingState = cachedBySendingState ?? new WeakMap<Record<string, boolean>, string[]>()
  if (!cachedBySendingState) {
    runningSessionIDsCache.set(conversations, nextCachedBySendingState)
  }
  nextCachedBySendingState.set(isSendingByTabKey, nextSessionIDs)
  return nextSessionIDs
}

function hasStreamingAssistantMessage(turns: ThreadMessage[]) {
  return turns.some((turn) => turn.kind === "assistant" && turn.isStreaming)
}

function isRuntimeDebugBusy(debug: SessionRuntimeDebugSnapshot | null | undefined) {
  return debug?.status.type === "busy" || Boolean(debug?.activeTurnID)
}

function isSessionInterruptible(input: {
  cancellingSessionIDs: Record<string, boolean>
  conversationActivityBySession?: ConversationActivityMap
  conversations: Record<string, ThreadMessage[]>
  isSendingByTabKey: Record<string, boolean>
  sessionID: string | null | undefined
  sessionRuntimeDebugBySession: Record<string, SessionRuntimeDebugSnapshot>
  tabKey: string | null | undefined
}) {
  if (!input.sessionID) return false
  return (
    Boolean(input.tabKey && input.isSendingByTabKey[input.tabKey]) ||
    Boolean(input.cancellingSessionIDs[input.sessionID]) ||
    (
      input.conversationActivityBySession
        ? Boolean(input.conversationActivityBySession[input.sessionID]?.hasStreamingAssistantMessage)
        : hasStreamingAssistantMessage(input.conversations[input.sessionID] ?? [])
    ) ||
    isRuntimeDebugBusy(input.sessionRuntimeDebugBySession[input.sessionID])
  )
}

export type WorkbenchPaneTab =
  | {
      key: string
      kind: "session"
      sessionID: string
      title: string
      sessionKind?: SessionSummary["kind"]
      workflow?: SessionSummary["workflow"]
    }
  | {
      key: string
      kind: "create-session"
      createSessionTabID: string
      title: string
    }

export interface BuildWorkspaceDerivedStateInput {
  activeSideChatSessionIDByParentSessionID: Record<string, string>
  cancellingSessionIDs: Record<string, boolean>
  composerAttachmentsByTabKey: Record<string, ComposerAttachment[]>
  composerDraftStateByTabKey: Record<string, ComposerDraftState>
  composerParentMessageIDByTabKey?: Record<string, string>
  conversationActivityBySession?: ConversationActivityMap
  contextUsageBySession: Record<string, SessionContextUsage>
  conversations: Record<string, ThreadMessage[]>
  messageTreeBySession?: Record<string, SessionMessageTree>
  createSessionTabs: CreateSessionTab[]
  isCreatingSessionByTabKey: Record<string, boolean>
  isInitialWorkspaceLoadPending: boolean
  isSendingByTabKey: Record<string, boolean>
  pendingConversationInputsBySession?: Record<string, PendingConversationInput[]>
  pendingPermissionRequestsBySession: Record<string, PermissionRequest[]>
  platform: string
  previewByWorkspaceID: Record<string, WorkspacePreviewState>
  selectedDiffFileBySession: Record<string, string | null>
  selectedFolderID: string | null
  sessionDiffBySession: Record<string, SessionDiffSummary>
  sessionDiffStateBySession: Record<string, SessionDiffState>
  sessionDirectoryBySession: Record<string, string>
  sessionRuntimeDebugBySession: Record<string, SessionRuntimeDebugSnapshot>
  sessionRuntimeDebugStateBySession: Record<string, SessionRuntimeDebugState>
  sessionTasksBySession?: Record<string, SessionTaskListView>
  seedWorkspaceIDs: Set<string>
  dockviewActiveState: WorkbenchDockviewActiveState
  dockviewLayout: SerializedDockview | null
  includeWorkbenchSurfaces?: boolean
  workspaceFileCommentsByTarget: Record<string, WorkspaceFileComment[]>
  workspaceFileReviewState: WorkspaceFileReviewState
  workspaces: WorkspaceGroup[]
}

export interface WorkbenchSurfaceStateInput {
  id: string
  isActivePanel: boolean
  isFocused: boolean
  location: WorkbenchDockviewGroupLocation
  reference: WorkbenchTabReference | null
  tabs: WorkbenchPaneTab[]
}

export function buildWorkbenchPaneTabs(
  input: Pick<BuildWorkspaceDerivedStateInput, "createSessionTabs" | "workspaces">,
  tabs: WorkbenchTabReference[],
) {
  const paneTabs: WorkbenchPaneTab[] = []

  for (const tab of tabs) {
    if (tab.kind === "session") {
      const { session } = findIndexedSession(input.workspaces, tab.sessionID)
      if (!session) continue
      paneTabs.push({
        key: getWorkbenchTabKey(tab),
        kind: tab.kind,
        sessionID: tab.sessionID,
        title: session.title,
        sessionKind: session.kind,
        workflow: session.workflow,
      })
      continue
    }

    const createTab = input.createSessionTabs.find((item) => item.id === tab.createSessionTabID)
    const workspace = findIndexedWorkspaceByID(input.workspaces, createTab?.workspaceID ?? null)
    paneTabs.push({
      key: getWorkbenchTabKey(tab),
      kind: tab.kind,
      createSessionTabID: tab.createSessionTabID,
      title: workspace ? `Create / ${workspace.name}` : "Create session",
    })
  }

  return paneTabs
}

function workbenchPaneTabIsEqual(left: WorkbenchPaneTab | null, right: WorkbenchPaneTab | null) {
  if (Object.is(left, right)) return true
  if (!left || !right || left.kind !== right.kind || left.key !== right.key || left.title !== right.title) {
    return false
  }
  if (left.kind === "session" && right.kind === "session") {
    return left.sessionID === right.sessionID && left.sessionKind === right.sessionKind && left.workflow === right.workflow
  }
  return left.kind === "create-session" && right.kind === "create-session" && left.createSessionTabID === right.createSessionTabID
}

export interface WorkbenchTabHeaderState {
  activeTabKey: string | null
  createSessionTabIndex: number
  id: string
  tab: WorkbenchPaneTab | null
}

export function buildWorkbenchTabHeaderState(
  input: Pick<BuildWorkspaceDerivedStateInput, "createSessionTabs" | "dockviewActiveState" | "dockviewLayout" | "workspaces">,
  groupID: string,
  panelID: string,
) {
  const groups = getDockviewGroupsInOrder(input.dockviewLayout)
  const group =
    groups.find((candidate) => candidate.id === groupID) ??
    groups.find((candidate) => candidate.panelIDs.includes(panelID))
  if (!group) return null

  const normalizedDockviewActiveState = normalizeDockviewActiveState(input.dockviewLayout, input.dockviewActiveState)
  const currentActiveTab = getActivePanelForGroupFromState(input.dockviewLayout, normalizedDockviewActiveState, group.id)
  const activeTabKey = currentActiveTab ? getWorkbenchTabKey(currentActiveTab) : null
  const tabs = buildWorkbenchPaneTabs(input, group.views)
  const tab = tabs.find((candidate) => candidate.key === panelID) ?? null
  const createSessionTabIndex = tab?.kind === "create-session"
    ? tabs.slice(0, tabs.findIndex((candidate) => candidate.key === tab.key) + 1).filter((candidate) => candidate.kind === "create-session").length - 1
    : -1

  return {
    activeTabKey,
    createSessionTabIndex,
    id: group.id,
    tab,
  }
}

export function workbenchTabHeaderStatesAreEqual(
  left: WorkbenchTabHeaderState | null,
  right: WorkbenchTabHeaderState | null,
) {
  if (Object.is(left, right)) return true
  if (!left || !right) return false
  return (
    left.activeTabKey === right.activeTabKey &&
    left.createSessionTabIndex === right.createSessionTabIndex &&
    left.id === right.id &&
    workbenchPaneTabIsEqual(left.tab, right.tab)
  )
}

export interface WorkbenchHeaderState {
  id: string
  location: WorkbenchDockviewGroupLocation
  tabs: WorkbenchPaneTab[]
  workspaceID: string | null
}

export function buildWorkbenchHeaderState(
  input: Pick<BuildWorkspaceDerivedStateInput, "createSessionTabs" | "dockviewActiveState" | "dockviewLayout" | "workspaces">,
  groupID: string,
  panelID?: string,
) {
  const groups = getDockviewGroupsInOrder(input.dockviewLayout)
  const group =
    groups.find((candidate) => candidate.id === groupID) ??
    groups.find((candidate) =>
      panelID ? candidate.panelIDs.includes(panelID) : false,
    )
  if (!group) return null

  const normalizedDockviewActiveState = normalizeDockviewActiveState(input.dockviewLayout, input.dockviewActiveState)
  const currentActiveTab = getActivePanelForGroupFromState(input.dockviewLayout, normalizedDockviewActiveState, group.id)
  const activeCreateSessionTab =
    currentActiveTab?.kind === "create-session"
      ? input.createSessionTabs.find((tab) => tab.id === currentActiveTab.createSessionTabID) ?? null
      : null
  const activeSessionSelection = currentActiveTab?.kind === "session"
    ? findIndexedSession(input.workspaces, currentActiveTab.sessionID)
    : { workspace: null, session: null }

  return {
    id: group.id,
    location: group.location,
    tabs: buildWorkbenchPaneTabs(input, group.views),
    workspaceID: activeSessionSelection.workspace?.id ?? activeCreateSessionTab?.workspaceID ?? null,
  }
}

export function workbenchHeaderStatesAreEqual(
  left: WorkbenchHeaderState | null,
  right: WorkbenchHeaderState | null,
) {
  if (Object.is(left, right)) return true
  if (!left || !right) return false
  return (
    left.id === right.id &&
    left.location === right.location &&
    left.workspaceID === right.workspaceID &&
    workbenchPaneTabsAreEqual(left.tabs, right.tabs)
  )
}

export function buildWorkbenchSurfaceState(
  input: BuildWorkspaceDerivedStateInput,
  surface: WorkbenchSurfaceStateInput,
) {
  const shouldBuildVisibleThreadState = surface.isActivePanel
  const currentActiveTab = surface.reference
  const currentActiveTabKey = currentActiveTab ? getWorkbenchTabKey(currentActiveTab) : null
  const currentActiveSessionID = currentActiveTab?.kind === "session" ? currentActiveTab.sessionID : null
  const currentActiveCreateSessionTab =
    currentActiveTab?.kind === "create-session"
      ? input.createSessionTabs.find((tab) => tab.id === currentActiveTab.createSessionTabID) ?? null
      : null
  const currentSessionSelection = findIndexedSession(input.workspaces, currentActiveSessionID)
  const currentWorkspace =
    currentSessionSelection.workspace ??
    findIndexedWorkspaceByID(input.workspaces, currentActiveCreateSessionTab?.workspaceID ?? null) ??
    null
  const currentSession = currentSessionSelection.session
  const currentSessionIsSideChat = isSideChatSession(currentSession)
  const paneSideChatSessionsByAnchorMessageID =
    shouldBuildVisibleThreadState && currentSession && !currentSessionIsSideChat
      ? collectSideChatSessionsByAnchorMessageID(input.workspaces, currentSession.id)
      : EMPTY_SIDE_CHAT_SESSIONS_BY_ANCHOR_MESSAGE_ID
  const paneActiveSideChatSessionID =
    shouldBuildVisibleThreadState && currentSession && !currentSessionIsSideChat
      ? input.activeSideChatSessionIDByParentSessionID[currentSession.id] ?? null
      : null
  const paneActiveSideChatSelection = findIndexedSession(input.workspaces, paneActiveSideChatSessionID)
  const paneActiveSideChatSession =
    currentSession &&
    !currentSessionIsSideChat &&
    paneActiveSideChatSelection.session?.origin?.parentSessionID === currentSession.id
      ? paneActiveSideChatSelection.session
      : null
  const paneActiveSideChatTabKey = paneActiveSideChatSession
    ? getWorkbenchTabKey(createSessionWorkbenchTab(paneActiveSideChatSession.id))
    : null
  const paneActiveSideChatIsCancelling = paneActiveSideChatSession
    ? Boolean(input.cancellingSessionIDs[paneActiveSideChatSession.id])
    : false
  const paneActiveSideChatIsInterruptible =
    shouldBuildVisibleThreadState &&
    isSessionInterruptible({
      cancellingSessionIDs: input.cancellingSessionIDs,
      conversationActivityBySession: input.conversationActivityBySession,
      conversations: input.conversations,
      isSendingByTabKey: input.isSendingByTabKey,
      sessionID: paneActiveSideChatSession?.id,
      sessionRuntimeDebugBySession: input.sessionRuntimeDebugBySession,
      tabKey: paneActiveSideChatTabKey,
    })

  return {
    id: surface.id,
    location: surface.location,
    isActivePanel: surface.isActivePanel,
    isFocused: surface.isFocused,
    activeTabKey: currentActiveTabKey,
    activeSession: currentSession,
    activeSessionContextUsage: currentActiveSessionID ? input.contextUsageBySession[currentActiveSessionID] ?? null : null,
    activeSessionDiff: currentActiveSessionID ? input.sessionDiffBySession[currentActiveSessionID] ?? null : null,
    activeSessionDiffState: currentActiveSessionID
      ? input.sessionDiffStateBySession[currentActiveSessionID] ?? DEFAULT_SESSION_DIFF_STATE
      : DEFAULT_SESSION_DIFF_STATE,
    activeSessionRuntimeDebug: currentActiveSessionID ? input.sessionRuntimeDebugBySession[currentActiveSessionID] ?? null : null,
    activeSessionRuntimeDebugState: currentActiveSessionID
      ? input.sessionRuntimeDebugStateBySession[currentActiveSessionID] ?? DEFAULT_SESSION_RUNTIME_DEBUG_STATE
      : DEFAULT_SESSION_RUNTIME_DEBUG_STATE,
    activeSessionTasks: currentActiveSessionID ? input.sessionTasksBySession?.[currentActiveSessionID] ?? null : null,
    activeSideChatAttachments: paneActiveSideChatTabKey
      ? input.composerAttachmentsByTabKey[paneActiveSideChatTabKey] ?? EMPTY_COMPOSER_ATTACHMENTS
      : EMPTY_COMPOSER_ATTACHMENTS,
    activeSideChatDraftState: paneActiveSideChatTabKey
      ? input.composerDraftStateByTabKey[paneActiveSideChatTabKey] ?? EMPTY_COMPOSER_DRAFT_STATE
      : EMPTY_COMPOSER_DRAFT_STATE,
    activeSideChatIsSending: paneActiveSideChatTabKey ? Boolean(input.isSendingByTabKey[paneActiveSideChatTabKey]) : false,
    activeSideChatIsCancelling: paneActiveSideChatIsCancelling,
    activeSideChatIsInterruptible: paneActiveSideChatIsInterruptible,
    activeSideChatPendingPermissionRequests: paneActiveSideChatSession
      ? input.pendingPermissionRequestsBySession[paneActiveSideChatSession.id] ?? EMPTY_PERMISSION_REQUESTS
      : EMPTY_PERMISSION_REQUESTS,
    activeSideChatPendingInputs: paneActiveSideChatSession
      ? input.pendingConversationInputsBySession?.[paneActiveSideChatSession.id] ?? EMPTY_PENDING_CONVERSATION_INPUTS
      : EMPTY_PENDING_CONVERSATION_INPUTS,
    activeSideChatSession: paneActiveSideChatSession,
    activeSideChatTabKey: paneActiveSideChatTabKey,
    activeSideChatMessages: paneActiveSideChatSession ? input.conversations[paneActiveSideChatSession.id] ?? EMPTY_MESSAGES : EMPTY_MESSAGES,
    activeSessionDirectory: currentActiveSessionID
      ? input.sessionDirectoryBySession[currentActiveSessionID] ?? currentWorkspace?.directory ?? null
      : null,
    activeSessionSelectedDiffFile: currentActiveSessionID ? input.selectedDiffFileBySession[currentActiveSessionID] ?? null : null,
    activeMessages: currentActiveSessionID ? input.conversations[currentActiveSessionID] ?? EMPTY_MESSAGES : EMPTY_MESSAGES,
    messageTree: currentActiveSessionID ? input.messageTreeBySession?.[currentActiveSessionID] ?? null : null,
    composerAttachments: currentActiveTabKey ? input.composerAttachmentsByTabKey[currentActiveTabKey] ?? EMPTY_COMPOSER_ATTACHMENTS : EMPTY_COMPOSER_ATTACHMENTS,
    composerParentMessageID: currentActiveTabKey ? input.composerParentMessageIDByTabKey?.[currentActiveTabKey] ?? null : null,
    composerProjectID:
      input.isInitialWorkspaceLoadPending && currentWorkspace && input.seedWorkspaceIDs.has(currentWorkspace.id)
        ? null
        : currentWorkspace?.project.id ?? null,
    contextLabel: currentActiveCreateSessionTab ? "Create session" : currentSessionIsSideChat ? "Side chat" : "Session",
    contextTitle: currentSession
      ? currentSession.title
      : currentWorkspace
        ? `${currentWorkspace.project.name} / ${currentWorkspace.name}`
        : "No project selected",
    createSessionTabID: currentActiveCreateSessionTab?.id ?? null,
    createSessionInitialWorkflowMode: currentActiveCreateSessionTab?.initialWorkflowMode ?? "execution",
    createSessionWorkspaceID: currentActiveCreateSessionTab?.workspaceID ?? null,
    draftState: currentActiveTabKey
      ? input.composerDraftStateByTabKey[currentActiveTabKey] ?? EMPTY_COMPOSER_DRAFT_STATE
      : EMPTY_COMPOSER_DRAFT_STATE,
    isCreatingSession:
      currentActiveTabKey && currentActiveCreateSessionTab
        ? Boolean(input.isCreatingSessionByTabKey[currentActiveTabKey])
        : false,
    isSending: currentActiveTabKey ? Boolean(input.isSendingByTabKey[currentActiveTabKey]) : false,
    isCancelling: currentSession ? Boolean(input.cancellingSessionIDs[currentSession.id]) : false,
    isInterruptible:
      shouldBuildVisibleThreadState &&
      isSessionInterruptible({
        cancellingSessionIDs: input.cancellingSessionIDs,
        conversationActivityBySession: input.conversationActivityBySession,
        conversations: input.conversations,
        isSendingByTabKey: input.isSendingByTabKey,
        sessionID: currentSession?.id,
        sessionRuntimeDebugBySession: input.sessionRuntimeDebugBySession,
        tabKey: currentActiveTabKey,
      }),
    pendingPermissionRequests: currentActiveSessionID ? input.pendingPermissionRequestsBySession[currentActiveSessionID] ?? EMPTY_PERMISSION_REQUESTS : EMPTY_PERMISSION_REQUESTS,
    pendingConversationInputs: currentActiveSessionID
      ? input.pendingConversationInputsBySession?.[currentActiveSessionID] ?? EMPTY_PENDING_CONVERSATION_INPUTS
      : EMPTY_PENDING_CONVERSATION_INPUTS,
    projectID:
      input.isInitialWorkspaceLoadPending && currentWorkspace && input.seedWorkspaceIDs.has(currentWorkspace.id)
        ? null
        : currentWorkspace?.project.id ?? null,
    size: 1,
    sessionID: currentSession?.id ?? null,
    sideChatCountsByAnchorMessageID: currentSession && !currentSessionIsSideChat
      ? collectSideChatCountsFromSessionsByAnchorMessageID(paneSideChatSessionsByAnchorMessageID)
      : EMPTY_SIDE_CHAT_COUNTS_BY_ANCHOR_MESSAGE_ID,
    sideChatSessionsByAnchorMessageID: paneSideChatSessionsByAnchorMessageID,
    tabKey: currentActiveTabKey,
    tabs: surface.tabs,
    workspace: currentWorkspace,
  }
}

export type WorkbenchPaneState = ReturnType<typeof buildWorkbenchSurfaceState>

function createInactiveWorkbenchSurfaceState(surface: Pick<WorkbenchSurfaceStateInput, "id" | "isActivePanel" | "isFocused" | "location">): WorkbenchPaneState {
  return {
    id: surface.id,
    location: surface.location,
    isActivePanel: surface.isActivePanel,
    isFocused: surface.isFocused,
    activeTabKey: null,
    activeSession: null,
    activeSessionContextUsage: null,
    activeSessionDiff: null,
    activeSessionDiffState: DEFAULT_SESSION_DIFF_STATE,
    activeSessionRuntimeDebug: null,
    activeSessionRuntimeDebugState: DEFAULT_SESSION_RUNTIME_DEBUG_STATE,
    activeSessionTasks: null,
    activeSideChatAttachments: EMPTY_COMPOSER_ATTACHMENTS,
    activeSideChatDraftState: EMPTY_COMPOSER_DRAFT_STATE,
    activeSideChatIsSending: false,
    activeSideChatIsCancelling: false,
    activeSideChatIsInterruptible: false,
    activeSideChatPendingPermissionRequests: EMPTY_PERMISSION_REQUESTS,
    activeSideChatPendingInputs: EMPTY_PENDING_CONVERSATION_INPUTS,
    activeSideChatSession: null,
    activeSideChatTabKey: null,
    activeSideChatMessages: EMPTY_MESSAGES,
    activeSessionDirectory: null,
    activeSessionSelectedDiffFile: null,
    activeMessages: EMPTY_MESSAGES,
    messageTree: null,
    composerAttachments: EMPTY_COMPOSER_ATTACHMENTS,
    composerParentMessageID: null,
    composerProjectID: null,
    contextLabel: "Session",
    contextTitle: "Session",
    createSessionTabID: null,
    createSessionInitialWorkflowMode: "execution",
    createSessionWorkspaceID: null,
    draftState: EMPTY_COMPOSER_DRAFT_STATE,
    isCreatingSession: false,
    isSending: false,
    isCancelling: false,
    isInterruptible: false,
    pendingPermissionRequests: EMPTY_PERMISSION_REQUESTS,
    pendingConversationInputs: EMPTY_PENDING_CONVERSATION_INPUTS,
    projectID: null,
    size: 1,
    sessionID: null,
    sideChatCountsByAnchorMessageID: EMPTY_SIDE_CHAT_COUNTS_BY_ANCHOR_MESSAGE_ID,
    sideChatSessionsByAnchorMessageID: EMPTY_SIDE_CHAT_SESSIONS_BY_ANCHOR_MESSAGE_ID,
    tabKey: null,
    tabs: [],
    workspace: null,
  }
}

function shallowEqualRecords<T>(
  left: Record<string, T>,
  right: Record<string, T>,
  equalValue: (leftValue: T, rightValue: T) => boolean = Object.is,
) {
  if (Object.is(left, right)) return true
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  if (leftKeys.length !== rightKeys.length) return false
  return leftKeys.every((key) => Object.prototype.hasOwnProperty.call(right, key) && equalValue(left[key], right[key]))
}

function shallowEqualSessionArrays(left: SessionSummary[], right: SessionSummary[]) {
  if (Object.is(left, right)) return true
  if (left.length !== right.length) return false
  return left.every((item, index) => Object.is(item, right[index]))
}

function areStringArraysEqual(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function workbenchPaneTabsAreEqual(left: WorkbenchPaneTab[], right: WorkbenchPaneTab[]) {
  if (Object.is(left, right)) return true
  if (left.length !== right.length) return false
  return left.every((leftTab, index) => workbenchPaneTabIsEqual(leftTab, right[index] ?? null))
}

export function workbenchPaneStatesAreEqual(left: WorkbenchPaneState | null, right: WorkbenchPaneState | null) {
  if (Object.is(left, right)) return true
  if (!left || !right) return false
  const leftKeys = Object.keys(left) as Array<keyof WorkbenchPaneState>
  const rightKeys = Object.keys(right) as Array<keyof WorkbenchPaneState>
  if (leftKeys.length !== rightKeys.length) return false

  for (const key of leftKeys) {
    if (!Object.prototype.hasOwnProperty.call(right, key)) return false
    if (key === "activeMessages" || key === "activeSideChatMessages") {
      continue
    }
    if (key === "tabs") {
      if (!workbenchPaneTabsAreEqual(left.tabs, right.tabs)) return false
      continue
    }
    if (key === "sideChatCountsByAnchorMessageID") {
      if (!shallowEqualRecords(left.sideChatCountsByAnchorMessageID, right.sideChatCountsByAnchorMessageID)) return false
      continue
    }
    if (key === "sideChatSessionsByAnchorMessageID") {
      if (!shallowEqualRecords(left.sideChatSessionsByAnchorMessageID, right.sideChatSessionsByAnchorMessageID, shallowEqualSessionArrays)) {
        return false
      }
      continue
    }
    if (!Object.is(left[key], right[key])) return false
  }

  return true
}

export function workbenchPaneStateArraysAreEqual(left: WorkbenchPaneState[], right: WorkbenchPaneState[]) {
  if (Object.is(left, right)) return true
  if (left.length !== right.length) return false
  return left.every((item, index) => workbenchPaneStatesAreEqual(item, right[index] ?? null))
}

export function buildWorkspaceDerivedStateInputFromStore(
  state: WorkspaceStore,
  platform: string,
  seedWorkspaceIDs: Set<string>,
): BuildWorkspaceDerivedStateInput {
  return {
    activeSideChatSessionIDByParentSessionID: state.sessions.activeSideChatSessionIDByParentSessionID,
    cancellingSessionIDs: state.agentStream.cancellingSessionIDs,
    composerAttachmentsByTabKey: state.composer.composerAttachmentsByTabKey,
    composerDraftStateByTabKey: state.composer.composerDraftStateByTabKey,
    composerParentMessageIDByTabKey: state.composer.composerParentMessageIDByTabKey,
    conversationActivityBySession: state.agentStream.conversationActivityBySession,
    contextUsageBySession: state.agentStream.contextUsageBySession,
    conversations: state.agentStream.conversationStore.getConversations(),
    createSessionTabs: state.sessions.createSessionTabs,
    isCreatingSessionByTabKey: state.composer.isCreatingSessionByTabKey,
    isInitialWorkspaceLoadPending: state.sessions.isInitialWorkspaceLoadPending,
    isSendingByTabKey: state.composer.isSendingByTabKey,
    messageTreeBySession: state.agentStream.messageTreeBySession,
    pendingConversationInputsBySession: state.agentStream.pendingConversationInputsBySession,
    pendingPermissionRequestsBySession: state.agentStream.pendingPermissionRequestsBySession,
    platform,
    previewByWorkspaceID: state.review.previewByWorkspaceID,
    selectedDiffFileBySession: state.review.selectedDiffFileBySession,
    selectedFolderID: state.sessions.selectedFolderID,
    sessionDiffBySession: state.review.sessionDiffBySession,
    sessionDiffStateBySession: state.review.sessionDiffStateBySession,
    sessionDirectoryBySession: state.agentStream.sessionDirectoryBySession,
    sessionRuntimeDebugBySession: state.review.sessionRuntimeDebugBySession,
    sessionRuntimeDebugStateBySession: state.review.sessionRuntimeDebugStateBySession,
    sessionTasksBySession: state.review.sessionTasksBySession,
    seedWorkspaceIDs,
    dockviewActiveState: state.workbench.dockviewActiveState,
    dockviewLayout: state.workbench.dockviewLayout,
    workspaceFileCommentsByTarget: state.review.workspaceFileCommentsByTarget,
    workspaceFileReviewState: state.review.workspaceFileReviewState,
    workspaces: state.sessions.workspaces,
  }
}

export function buildWorkbenchPaneStates(input: BuildWorkspaceDerivedStateInput) {
  const orderedDockviewGroups = getDockviewGroupsInOrder(input.dockviewLayout)
  const normalizedDockviewActiveState = normalizeDockviewActiveState(input.dockviewLayout, input.dockviewActiveState)
  const focusedPaneID = getFocusedDockviewGroupIDFromState(input.dockviewLayout, normalizedDockviewActiveState)

  return orderedDockviewGroups.map((pane) => {
    const currentActiveTab = getActivePanelForGroupFromState(input.dockviewLayout, normalizedDockviewActiveState, pane.id)
    return buildWorkbenchSurfaceState(input, {
      id: pane.id,
      location: pane.location,
      isActivePanel: true,
      isFocused: pane.id === focusedPaneID,
      reference: currentActiveTab,
      tabs: buildWorkbenchPaneTabs(input, pane.views),
    })
  })
}

export function buildWorkbenchPaneStateByID(input: BuildWorkspaceDerivedStateInput) {
  return Object.fromEntries(buildWorkbenchPaneStates(input).map((pane) => [pane.id, pane]))
}

export function buildWorkbenchPanelState(
  input: BuildWorkspaceDerivedStateInput,
  groupID: string,
  panelID: string | undefined,
  reference: WorkbenchTabReference | null | undefined,
) {
  const orderedDockviewGroups = getDockviewGroupsInOrder(input.dockviewLayout)
  const group =
    orderedDockviewGroups.find((candidate) => candidate.id === groupID) ??
    orderedDockviewGroups.find((candidate) =>
      panelID ? candidate.views.some((view) => getWorkbenchDockPanelId(view) === panelID) : false,
    )
  if (!group) return null

  const normalizedDockviewActiveState = normalizeDockviewActiveState(input.dockviewLayout, input.dockviewActiveState)
  const focusedPaneID = getFocusedDockviewGroupIDFromState(input.dockviewLayout, normalizedDockviewActiveState)
  const activeReference = getActivePanelForGroupFromState(input.dockviewLayout, normalizedDockviewActiveState, group.id)
  const resolvedReference =
    reference ??
    (panelID ? group.views.find((view) => getWorkbenchDockPanelId(view) === panelID) ?? null : null)
  if (!resolvedReference) return null

  return buildWorkbenchSurfaceState(input, {
    id: group.id,
    location: group.location,
    isActivePanel: Boolean(activeReference && getWorkbenchTabKey(activeReference) === getWorkbenchTabKey(resolvedReference)),
    isFocused: group.id === focusedPaneID,
    reference: resolvedReference,
    tabs: buildWorkbenchPaneTabs(input, group.views),
  })
}

export function buildWorkbenchPanelRenderState(
  input: BuildWorkspaceDerivedStateInput,
  groupID: string,
  panelID: string | undefined,
  reference: WorkbenchTabReference | null | undefined,
) {
  const orderedDockviewGroups = getDockviewGroupsInOrder(input.dockviewLayout)
  const group =
    orderedDockviewGroups.find((candidate) => candidate.id === groupID) ??
    orderedDockviewGroups.find((candidate) =>
      panelID ? candidate.views.some((view) => getWorkbenchDockPanelId(view) === panelID) : false,
    )
  if (!group) return null

  const normalizedDockviewActiveState = normalizeDockviewActiveState(input.dockviewLayout, input.dockviewActiveState)
  const focusedPaneID = getFocusedDockviewGroupIDFromState(input.dockviewLayout, normalizedDockviewActiveState)
  const activeReference = getActivePanelForGroupFromState(input.dockviewLayout, normalizedDockviewActiveState, group.id)
  const resolvedReference =
    reference ??
    (panelID ? group.views.find((view) => getWorkbenchDockPanelId(view) === panelID) ?? null : null)
  if (!resolvedReference) return null

  const resolvedPanelID = getWorkbenchTabKey(resolvedReference)
  const activePanelID =
    activeReference ? getWorkbenchTabKey(activeReference) : group.activePanelID ?? (group.panelIDs.length === 1 ? group.panelIDs[0] ?? null : null)
  const isActivePanel = activePanelID ? activePanelID === resolvedPanelID : true
  if (!isActivePanel) {
    return createInactiveWorkbenchSurfaceState({
      id: group.id,
      location: group.location,
      isActivePanel: false,
      isFocused: group.id === focusedPaneID,
    })
  }

  return buildWorkbenchSurfaceState(input, {
    id: group.id,
    location: group.location,
    isActivePanel,
    isFocused: group.id === focusedPaneID,
    reference: resolvedReference,
    tabs: buildWorkbenchPaneTabs(input, group.views),
  })
}

export function buildWorkbenchPaneState(
  input: BuildWorkspaceDerivedStateInput,
  groupID: string,
  panelID?: string,
) {
  const orderedDockviewGroups = getDockviewGroupsInOrder(input.dockviewLayout)
  const group =
    orderedDockviewGroups.find((candidate) => candidate.id === groupID) ??
    orderedDockviewGroups.find((candidate) =>
      panelID ? candidate.views.some((view) => getWorkbenchDockPanelId(view) === panelID) : false,
    )
  if (!group) return null

  const normalizedDockviewActiveState = normalizeDockviewActiveState(input.dockviewLayout, input.dockviewActiveState)
  const currentActiveTab = getActivePanelForGroupFromState(input.dockviewLayout, normalizedDockviewActiveState, group.id)
  const focusedPaneID = getFocusedDockviewGroupIDFromState(input.dockviewLayout, normalizedDockviewActiveState)

  return buildWorkbenchSurfaceState(input, {
    id: group.id,
    location: group.location,
    isActivePanel: true,
    isFocused: group.id === focusedPaneID,
    reference: currentActiveTab,
    tabs: buildWorkbenchPaneTabs(input, group.views),
  })
}

export function buildWorkbenchPanelStateByID(input: BuildWorkspaceDerivedStateInput) {
  const orderedDockviewGroups = getDockviewGroupsInOrder(input.dockviewLayout)
  const normalizedDockviewActiveState = normalizeDockviewActiveState(input.dockviewLayout, input.dockviewActiveState)
  const focusedPaneID = getFocusedDockviewGroupIDFromState(input.dockviewLayout, normalizedDockviewActiveState)

  return Object.fromEntries(
    orderedDockviewGroups.flatMap((pane) => {
      const paneTabs = buildWorkbenchPaneTabs(input, pane.views)
      const currentActiveTab = getActivePanelForGroupFromState(input.dockviewLayout, normalizedDockviewActiveState, pane.id)
      return pane.views.map((reference) => [
        getWorkbenchDockPanelId(reference),
        buildWorkbenchSurfaceState(input, {
          id: pane.id,
          location: pane.location,
          isActivePanel: Boolean(currentActiveTab && getWorkbenchTabKey(currentActiveTab) === getWorkbenchTabKey(reference)),
          isFocused: pane.id === focusedPaneID,
          reference,
          tabs: paneTabs,
        }),
      ] as const)
    }),
  )
}

export function buildWorkbenchPanelTitleMap(input: Pick<BuildWorkspaceDerivedStateInput, "createSessionTabs" | "dockviewLayout" | "workspaces">) {
  const titles: Record<string, string | undefined> = {}
  for (const group of getDockviewGroupsInOrder(input.dockviewLayout)) {
    for (const tab of buildWorkbenchPaneTabs(input, group.views)) {
      titles[tab.key] = tab.title
    }
  }
  return titles
}

export interface WorkbenchPublishSnapshot {
  ownedPanelIDs: string[]
  panels: Record<string, WorkbenchPaneRenderSnapshot>
}

export function buildWorkbenchPublishSnapshot(input: Pick<BuildWorkspaceDerivedStateInput, "createSessionTabs" | "dockviewLayout" | "workspaces">): WorkbenchPublishSnapshot {
  const ownedPanelIDs: string[] = []
  const panels: Record<string, WorkbenchPaneRenderSnapshot> = {}
  const seenPanelIDs = new Set<string>()

  for (const group of getDockviewGroupsInOrder(input.dockviewLayout)) {
    for (const tab of buildWorkbenchPaneTabs(input, group.views)) {
      if (tab.kind !== "session" || seenPanelIDs.has(tab.key)) continue
      seenPanelIDs.add(tab.key)
      ownedPanelIDs.push(tab.key)
      panels[tab.key] = {
        panelID: tab.key,
        reference: {
          kind: "session",
          sessionID: tab.sessionID,
        },
        title: tab.title,
      }
    }
  }

  return {
    ownedPanelIDs,
    panels,
  }
}

function workbenchPanelSnapshotsAreEqual(left: WorkbenchPaneRenderSnapshot | undefined, right: WorkbenchPaneRenderSnapshot | undefined) {
  if (Object.is(left, right)) return true
  if (!left || !right) return false
  return (
    left.panelID === right.panelID &&
    left.title === right.title &&
    left.reference.kind === right.reference.kind &&
    left.reference.sessionID === right.reference.sessionID
  )
}

export function workbenchPublishSnapshotsAreEqual(left: WorkbenchPublishSnapshot, right: WorkbenchPublishSnapshot) {
  if (Object.is(left, right)) return true
  if (!areStringArraysEqual(left.ownedPanelIDs, right.ownedPanelIDs)) return false

  const leftPanelIDs = Object.keys(left.panels)
  const rightPanelIDs = Object.keys(right.panels)
  if (!areStringArraysEqual(leftPanelIDs, rightPanelIDs)) return false

  return leftPanelIDs.every((panelID) => workbenchPanelSnapshotsAreEqual(left.panels[panelID], right.panels[panelID]))
}

export function getWorkbenchGridPaneIDs(dockviewLayout: SerializedDockview | null) {
  return getDockviewGroupsInOrder(dockviewLayout)
    .filter((group) => group.location === "grid")
    .map((group) => group.id)
}

export function buildWorkspaceDerivedState({
  activeSideChatSessionIDByParentSessionID,
  cancellingSessionIDs,
  composerAttachmentsByTabKey,
  composerDraftStateByTabKey,
  composerParentMessageIDByTabKey = {},
  conversationActivityBySession,
  contextUsageBySession,
  conversations,
  createSessionTabs,
  isCreatingSessionByTabKey,
  isInitialWorkspaceLoadPending,
  isSendingByTabKey,
  messageTreeBySession = {},
  pendingConversationInputsBySession,
  pendingPermissionRequestsBySession,
  platform,
  previewByWorkspaceID,
  selectedDiffFileBySession,
  selectedFolderID,
  sessionDiffBySession,
  sessionDiffStateBySession,
  sessionDirectoryBySession,
  sessionRuntimeDebugBySession,
  sessionRuntimeDebugStateBySession,
  sessionTasksBySession = {},
  seedWorkspaceIDs,
  dockviewActiveState,
  dockviewLayout,
  includeWorkbenchSurfaces = true,
  workspaceFileCommentsByTarget,
  workspaceFileReviewState,
  workspaces,
}: BuildWorkspaceDerivedStateInput) {
  const orderedDockviewGroups = getDockviewGroupsInOrder(dockviewLayout)
  const normalizedDockviewActiveState = normalizeDockviewActiveState(dockviewLayout, dockviewActiveState)
  const focusedPaneID = getFocusedDockviewGroupIDFromState(dockviewLayout, normalizedDockviewActiveState)
  const focusedPane = focusedPaneID
    ? orderedDockviewGroups.find((group) => group.id === focusedPaneID) ?? null
    : null
  const activeTab = getActiveDockviewPanelReferenceFromState(dockviewLayout, normalizedDockviewActiveState, focusedPaneID)
  const activeTabKey = activeTab ? getWorkbenchTabKey(activeTab) : null
  const activeSessionID = activeTab?.kind === "session" ? activeTab.sessionID : null
  const activeCreateSessionTabID = activeTab?.kind === "create-session" ? activeTab.createSessionTabID : null
  const openCanvasSessionIDs = getOpenSessionIDs(dockviewLayout)
  const visibleCanvasSessionIDs = getVisibleSessionIDsFromState(dockviewLayout, normalizedDockviewActiveState)
  const { workspace: activeWorkspace, session: activeSession } = findIndexedSession(workspaces, activeSessionID)
  const activeCreateSessionTab = createSessionTabs.find((tab) => tab.id === activeCreateSessionTabID) ?? null
  const focusedPaneCreateSessionTab =
    activeTab?.kind === "create-session"
      ? createSessionTabs.find((tab) => tab.id === activeTab.createSessionTabID) ?? null
      : null
  const activeTabWorkspaceID =
    activeTab?.kind === "session"
      ? findIndexedSession(workspaces, activeTab.sessionID).workspace?.id ?? null
      : createSessionTabs.find((item) => item.id === activeTab?.createSessionTabID)?.workspaceID ?? null
  const selectedWorkspace =
    findIndexedWorkspaceByID(workspaces, selectedFolderID) ??
    findIndexedWorkspaceByID(workspaces, activeTabWorkspaceID) ??
    activeWorkspace ??
    workspaces[0] ??
    null
  const focusedPaneWorkspace =
    activeWorkspace ??
    findIndexedWorkspaceByID(workspaces, focusedPaneCreateSessionTab?.workspaceID ?? null) ??
    null
  const activePreviewScopeID = resolvePreviewScopeID(selectedWorkspace?.id ?? null)
  const activeWorkspaceFileScopeDirectory = focusedPaneWorkspace?.directory ?? selectedWorkspace?.directory ?? null
  const activeWorkspaceFileScopeName = focusedPaneWorkspace?.name ?? selectedWorkspace?.name ?? null
  const activeWorkspaceFileCommentKey = getWorkspaceFileCommentKey(
    activeWorkspaceFileScopeDirectory,
    workspaceFileReviewState.selectedFilePath,
    platform,
  )
  const activeWorkspaceFileState: WorkspaceFileReviewState =
    activeWorkspaceFileCommentKey
      ? {
          ...workspaceFileReviewState,
          comments: workspaceFileCommentsByTarget[activeWorkspaceFileCommentKey] ?? [],
        }
      : {
          ...workspaceFileReviewState,
          comments: [],
        }
  const selectedProjectID =
    isInitialWorkspaceLoadPending && selectedWorkspace && seedWorkspaceIDs.has(selectedWorkspace.id)
      ? null
      : selectedWorkspace?.project.id ?? null
  const activeMessages = activeSession ? conversations[activeSession.id] ?? [] : []
  const activeSessionDiff = activeSession ? sessionDiffBySession[activeSession.id] ?? null : null
  const activeSessionDiffState = activeSession
    ? sessionDiffStateBySession[activeSession.id] ?? DEFAULT_SESSION_DIFF_STATE
    : DEFAULT_SESSION_DIFF_STATE
  const activeSessionRuntimeDebug = activeSession ? sessionRuntimeDebugBySession[activeSession.id] ?? null : null
  const activeSessionRuntimeDebugState = activeSession
    ? sessionRuntimeDebugStateBySession[activeSession.id] ?? DEFAULT_SESSION_RUNTIME_DEBUG_STATE
    : DEFAULT_SESSION_RUNTIME_DEBUG_STATE
  const activeSessionTasks = activeSession ? sessionTasksBySession[activeSession.id] ?? null : null
  const activeSessionDirectory = activeSession
    ? sessionDirectoryBySession[activeSession.id] ?? activeWorkspace?.directory ?? null
    : null
  const activeSessionSelectedDiffFile = activeSession ? selectedDiffFileBySession[activeSession.id] ?? null : null
  const activePendingPermissionRequests = activeSession ? pendingPermissionRequestsBySession[activeSession.id] ?? [] : []
  const activePendingConversationInputs =
    activeSession ? pendingConversationInputsBySession?.[activeSession.id] ?? [] : []
  const activeSessionContextUsage = activeSession ? contextUsageBySession[activeSession.id] ?? null : null
  const activeSessionIsSideChat = isSideChatSession(activeSession)
  const activeSideChatSessionID =
    activeSession && !activeSessionIsSideChat
      ? activeSideChatSessionIDByParentSessionID[activeSession.id] ?? null
      : null
  const activeSideChatSelection = findIndexedSession(workspaces, activeSideChatSessionID)
  const activeSideChatSession =
    activeSession &&
    !activeSessionIsSideChat &&
    activeSideChatSelection.session?.origin?.parentSessionID === activeSession.id
      ? activeSideChatSelection.session
      : null
  const activeSideChatTabKey = activeSideChatSession ? getWorkbenchTabKey(createSessionWorkbenchTab(activeSideChatSession.id)) : null
  const activeSideChatMessages = activeSideChatSession ? conversations[activeSideChatSession.id] ?? [] : []
  const activeSideChatPendingPermissionRequests =
    activeSideChatSession ? pendingPermissionRequestsBySession[activeSideChatSession.id] ?? [] : []
  const activeSideChatPendingInputs =
    activeSideChatSession ? pendingConversationInputsBySession?.[activeSideChatSession.id] ?? [] : []
  const activeSideChatDraftState = activeSideChatTabKey
    ? composerDraftStateByTabKey[activeSideChatTabKey] ?? createEmptyComposerDraftState()
    : createEmptyComposerDraftState()
  const activeSideChatAttachments = activeSideChatTabKey ? composerAttachmentsByTabKey[activeSideChatTabKey] ?? [] : []
  const activeSideChatIsSending = activeSideChatTabKey ? Boolean(isSendingByTabKey[activeSideChatTabKey]) : false
  const activeSideChatIsCancelling = activeSideChatSession ? Boolean(cancellingSessionIDs[activeSideChatSession.id]) : false
  const activeSideChatIsInterruptible = isSessionInterruptible({
    cancellingSessionIDs,
    conversationActivityBySession,
    conversations,
    isSendingByTabKey,
    sessionID: activeSideChatSession?.id,
    sessionRuntimeDebugBySession,
    tabKey: activeSideChatTabKey,
  })
  const activeSideChatSessionsByAnchorMessageID =
    activeSession && !activeSessionIsSideChat ? collectSideChatSessionsByAnchorMessageID(workspaces, activeSession.id) : {}
  const activeSideChatCountsByAnchorMessageID =
    collectSideChatCountsFromSessionsByAnchorMessageID(activeSideChatSessionsByAnchorMessageID)
  const isCreateSessionTabActive = activeCreateSessionTab !== null
  const createSessionWorkspaceID = activeCreateSessionTab?.workspaceID ?? null
  const createSessionTitle = activeCreateSessionTab?.title ?? ""
  const draftState = activeTabKey
    ? composerDraftStateByTabKey[activeTabKey] ?? createEmptyComposerDraftState()
    : createEmptyComposerDraftState()
  const activePreviewState = previewByWorkspaceID[activePreviewScopeID] ?? DEFAULT_WORKSPACE_PREVIEW_STATE
  const canInsertPreviewInteractionsIntoDraft = Boolean(activeTabKey)
  const canInsertWorkspaceFileCommentsIntoDraft = Boolean(activeTabKey)
  const composerAttachments = activeTabKey ? composerAttachmentsByTabKey[activeTabKey] ?? [] : []
  const isSending = activeTabKey ? Boolean(isSendingByTabKey[activeTabKey]) : false
  const isCancelling = activeSession ? Boolean(cancellingSessionIDs[activeSession.id]) : false
  const isInterruptible = isSessionInterruptible({
    cancellingSessionIDs,
    conversationActivityBySession,
    conversations,
    isSendingByTabKey,
    sessionID: activeSession?.id,
    sessionRuntimeDebugBySession,
    tabKey: activeTabKey,
  })
  const isCreatingSession = activeTabKey ? Boolean(isCreatingSessionByTabKey[activeTabKey]) : false
  const runningSessionIDs = getRunningSessionIDs(conversations, isSendingByTabKey, conversationActivityBySession)
  const canvasSessionTabs = focusedPane
    ? focusedPane.views.flatMap((reference) => {
        if (reference.kind !== "session") return []
        const { session } = findIndexedSession(workspaces, reference.sessionID)
        return session ? [session] : []
      })
    : []
  const derivedInput = {
    activeSideChatSessionIDByParentSessionID,
    cancellingSessionIDs,
    composerAttachmentsByTabKey,
    composerDraftStateByTabKey,
    composerParentMessageIDByTabKey,
    conversationActivityBySession,
    contextUsageBySession,
    conversations,
    createSessionTabs,
    isCreatingSessionByTabKey,
    isInitialWorkspaceLoadPending,
    isSendingByTabKey,
    messageTreeBySession,
    pendingPermissionRequestsBySession,
    platform,
    previewByWorkspaceID,
    selectedDiffFileBySession,
    selectedFolderID,
    sessionDiffBySession,
    sessionDiffStateBySession,
    sessionDirectoryBySession,
    sessionRuntimeDebugBySession,
    sessionRuntimeDebugStateBySession,
    sessionTasksBySession,
    seedWorkspaceIDs,
    dockviewActiveState,
    dockviewLayout,
    workspaceFileCommentsByTarget,
    workspaceFileReviewState,
    workspaces,
  }
  const workbenchPaneStates = includeWorkbenchSurfaces ? buildWorkbenchPaneStates(derivedInput) : []
  const workbenchPanelStateByID = includeWorkbenchSurfaces ? buildWorkbenchPanelStateByID(derivedInput) : {}
  const workbenchPaneStateByID = includeWorkbenchSurfaces
    ? Object.fromEntries(workbenchPaneStates.map((pane) => [pane.id, pane]))
    : {}

  return {
    activeCreateSessionTab,
    activeCreateSessionTabID,
    activePendingPermissionRequests,
    activePendingConversationInputs,
    activePreviewState,
    activeSession,
    activeSessionContextUsage,
    activeSessionDiff,
    activeSessionDiffState,
    activeSessionDirectory,
    activeSessionID,
    activeSessionIsSideChat,
    activeSessionRuntimeDebug,
    activeSessionRuntimeDebugState,
    activeSessionTasks,
    activeSessionSelectedDiffFile,
    activeSideChatAttachments,
    activeSideChatCountsByAnchorMessageID,
    activeSideChatDraftState,
    activeSideChatIsCancelling,
    activeSideChatIsInterruptible,
    activeSideChatIsSending,
    activeSideChatPendingPermissionRequests,
    activeSideChatPendingInputs,
    activeSideChatSession,
    activeSideChatSessionsByAnchorMessageID,
    activeSideChatTabKey,
    activeSideChatMessages,
    activeTab,
    activeTabKey,
    activeWorkspace,
    activeWorkspaceFileScopeDirectory,
    activeWorkspaceFileScopeName,
    activeWorkspaceFileState,
    activeMessages,
    canvasSessionTabs,
    canInsertPreviewInteractionsIntoDraft,
    canInsertWorkspaceFileCommentsIntoDraft,
    composerAttachments,
    createSessionTitle,
    createSessionWorkspaceID,
    draftState,
    focusedPane,
    focusedPaneID,
    isCreateSessionTabActive,
    isCancelling,
    isCreatingSession,
    isInterruptible,
    isSending,
    openCanvasSessionIDs,
    runningSessionIDs,
    selectedProjectID,
    selectedWorkspace,
    visibleCanvasSessionIDs,
    workbenchPanelStateByID,
    workbenchPaneStateByID,
    workbenchPaneStates,
  }
}
