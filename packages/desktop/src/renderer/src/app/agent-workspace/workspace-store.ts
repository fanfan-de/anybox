import { type SetStateAction, useRef, useSyncExternalStore } from "react"
import type { SerializedDockview } from "dockview-react"
import { createStore, type StoreApi } from "zustand/vanilla"
import { createComposerDraftStateFromPlainText } from "../composer/draft-state"
import { initialConversations, initialSelection, seedWorkspaces } from "../seed-data"
import type {
  AssistantThreadMessage,
  ComposerAttachment,
  ComposerDraftState,
  ConversationTurnMap,
  CreateSessionTab,
  LeftSidebarView,
  PendingConversationInput,
  PermissionRequest,
  RightSidebarOpenTabInput,
  RightSidebarState,
  RightSidebarTab,
  RightSidebarTabUpdate,
  SessionContextUsage,
  SessionDiffState,
  SessionDiffSummary,
  SessionRuntimeDebugSnapshot,
  SessionRuntimeDebugState,
  SessionTaskListView,
  WorkspaceFileComment,
  WorkspaceFileReviewState,
  WorkspaceGroup,
  WorkspacePreviewState,
} from "../types"
import type { SessionMessageTree } from "../session-message-tree"
import { createID } from "../utils"
import {
  createDockviewActiveStateFromLayout,
  dockviewActiveStatesAreEqual,
  normalizeDockviewActiveState,
  type WorkbenchDockviewActiveState,
} from "../workbench/dockview-state"
import { sortWorkspaceGroups } from "../workspace"
import {
  DEFAULT_WORKSPACE_FILE_REVIEW_STATE,
  DEFAULT_WORKSPACE_PREVIEW_STATE,
} from "./review-preview-state"
import {
  conversationActivityMapsAreEqual,
  createConversationStore,
  type ConversationActivityMap,
  type ConversationMessageMap,
  type ConversationStoreApi,
} from "./conversation-store"

export const seedWorkspaceIDs = new Set(seedWorkspaces.map((workspace) => workspace.id))
const PINNED_WORKSPACE_IDS_STORAGE_KEY = "desktop.workspace.pinnedWorkspaceIDs.v1"

export type WorkspaceStateUpdater<T> = SetStateAction<T>

export function ensureExpandedFolderID(current: string[], folderID: string | null | undefined) {
  if (!folderID || current.includes(folderID)) return current
  return [...current, folderID]
}

export function removeExpandedFolderID(current: string[], folderID: string | null | undefined) {
  if (!folderID || !current.includes(folderID)) return current
  return current.filter((item) => item !== folderID)
}

export function filterExpandedFolderIDs(current: string[], validFolderIDs: Set<string>) {
  const next = current.filter((folderID) => validFolderIDs.has(folderID))
  return next.length === current.length ? current : next
}

function readPinnedWorkspaceIDs() {
  if (typeof window === "undefined") return []

  try {
    const parsed = JSON.parse(window.localStorage.getItem(PINNED_WORKSPACE_IDS_STORAGE_KEY) ?? "[]")
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
  } catch {
    return []
  }
}

function writePinnedWorkspaceIDs(workspaceIDs: string[]) {
  if (typeof window === "undefined") return

  try {
    window.localStorage.setItem(PINNED_WORKSPACE_IDS_STORAGE_KEY, JSON.stringify(workspaceIDs))
  } catch {
    // Ignore storage failures; the in-memory ordering still works for the current window.
  }
}

function createDefaultWorkspaceFileReviewState(scopeDirectory: string | null): WorkspaceFileReviewState {
  return {
    ...DEFAULT_WORKSPACE_FILE_REVIEW_STATE,
    results: [],
    comments: [],
    scopeDirectory,
  }
}

function createDefaultWorkspacePreviewState(): WorkspacePreviewState {
  return {
    ...DEFAULT_WORKSPACE_PREVIEW_STATE,
    navigationHistory: [],
    interactions: [],
  }
}

function normalizeRightSidebarTargetSegment(value: string | null | undefined) {
  return value?.trim().replace(/\\/g, "/").toLowerCase() || "__none__"
}

function getRightSidebarPathName(path: string | null | undefined) {
  const normalized = path?.trim().replace(/\\/g, "/") ?? ""
  const name = normalized.split("/").filter(Boolean).pop()
  return name || null
}

function getRightSidebarTabTargetKey(input: RightSidebarOpenTabInput) {
  if (input.targetKey?.trim()) return input.targetKey.trim()

  switch (input.kind) {
    case "files":
      return [
        "files",
        normalizeRightSidebarTargetSegment(input.scopeDirectory),
        normalizeRightSidebarTargetSegment(input.filePath),
      ].join(":")
    case "browser":
      return [
        "browser",
        normalizeRightSidebarTargetSegment(input.workspaceID),
        normalizeRightSidebarTargetSegment(input.target),
      ].join(":")
    case "review":
      return ["review", normalizeRightSidebarTargetSegment(input.sessionID)].join(":")
    case "terminal":
      return ["terminal", normalizeRightSidebarTargetSegment(input.sessionID)].join(":")
    case "message-inspector":
      return "message-inspector"
    case "branch-thread":
      return [
        "branch-thread",
        normalizeRightSidebarTargetSegment(input.sessionID),
        normalizeRightSidebarTargetSegment(input.headMessageID ?? input.originMessageID),
      ].join(":")
  }
}

function getRightSidebarTabTitle(input: RightSidebarOpenTabInput) {
  if (input.title?.trim()) return input.title.trim()

  switch (input.kind) {
    case "files":
      return getRightSidebarPathName(input.filePath) ?? "Files"
    case "browser":
      return input.target?.trim() || "Browser"
    case "review":
      return "Review"
    case "terminal":
      return "Terminal"
    case "message-inspector":
      return "Conversation"
    case "branch-thread":
      return "Branch Chat"
  }
}

function createRightSidebarTab(input: RightSidebarOpenTabInput): RightSidebarTab {
  const targetKey = getRightSidebarTabTargetKey(input)
  const base = {
    id: createID("right-tab"),
    kind: input.kind,
    title: getRightSidebarTabTitle(input),
    targetKey,
    createdAt: Date.now(),
  }

  switch (input.kind) {
    case "files":
      return {
        ...base,
        kind: "files",
        scopeDirectory: input.scopeDirectory,
        scopeName: input.scopeName,
        state: createDefaultWorkspaceFileReviewState(input.scopeDirectory),
      }
    case "browser":
      return {
        ...base,
        kind: "browser",
        workspaceID: input.workspaceID,
        workspaceRoot: input.workspaceRoot,
        state: createDefaultWorkspacePreviewState(),
      }
    case "review":
      return {
        ...base,
        kind: "review",
        sessionID: input.sessionID,
      }
    case "terminal":
      return {
        ...base,
        kind: "terminal",
        sessionID: input.sessionID,
      }
    case "message-inspector":
      return {
        ...base,
        kind: "message-inspector",
        messageID: input.messageID,
        sessionID: input.sessionID,
      }
    case "branch-thread":
      return {
        ...base,
        kind: "branch-thread",
        anchorStrategy: input.anchorStrategy ?? "selected",
        sessionID: input.sessionID,
        originMessageID: input.originMessageID,
        headMessageID: input.headMessageID ?? input.originMessageID,
        executionID: input.executionID ?? base.id,
        phase: input.phase ?? "draft",
        initialQuotes: input.initialQuotes ?? [],
      }
  }
}

function updateRightSidebarTab(
  tab: RightSidebarTab,
  update: RightSidebarTabUpdate,
): RightSidebarTab {
  const title = update.title ?? tab.title
  const targetKey = update.targetKey ?? tab.targetKey

  switch (tab.kind) {
    case "files":
      return {
        ...tab,
        kind: "files",
        title,
        targetKey,
        scopeDirectory: update.scopeDirectory ?? tab.scopeDirectory,
        scopeName: update.scopeName ?? tab.scopeName,
      }
    case "browser":
      return {
        ...tab,
        kind: "browser",
        title,
        targetKey,
        workspaceID: update.workspaceID ?? tab.workspaceID,
        workspaceRoot: update.workspaceRoot ?? tab.workspaceRoot,
      }
    case "review":
      return {
        ...tab,
        kind: "review",
        title,
        targetKey,
        sessionID: update.sessionID ?? tab.sessionID,
      }
    case "terminal":
      return {
        ...tab,
        kind: "terminal",
        title,
        targetKey,
        sessionID: update.sessionID ?? tab.sessionID,
      }
    case "message-inspector":
      return {
        ...tab,
        kind: "message-inspector",
        title,
        targetKey,
        messageID: update.messageID ?? tab.messageID,
        sessionID: update.sessionID ?? tab.sessionID,
      }
    case "branch-thread": {
      const sessionID = update.sessionID ?? tab.sessionID
      const originMessageID = update.originMessageID ?? tab.originMessageID
      const headMessageID = update.headMessageID ?? tab.headMessageID
      const phase = update.phase ?? tab.phase
      const branchTargetKey = update.targetKey ?? [
        "branch-thread",
        normalizeRightSidebarTargetSegment(sessionID),
        normalizeRightSidebarTargetSegment(headMessageID),
      ].join(":")
      return {
        ...tab,
        kind: "branch-thread",
        anchorStrategy: update.anchorStrategy ?? tab.anchorStrategy ?? "selected",
        title,
        targetKey: branchTargetKey,
        sessionID,
        originMessageID,
        headMessageID,
        executionID: update.executionID ?? tab.executionID,
        phase,
        initialQuotes: update.initialQuotes ?? tab.initialQuotes,
      }
    }
  }
}

export interface WorkbenchSliceState {
  dockviewActiveState: WorkbenchDockviewActiveState
  dockviewLayout: SerializedDockview | null
}

export interface SessionsSliceState {
  canLoadSessionHistory: boolean
  createSessionTabs: CreateSessionTab[]
  deletingSessionID: string | null
  expandedFolderIDs: string[]
  hoveredFolderID: string | null
  isCreatingProject: boolean
  isInitialWorkspaceLoadPending: boolean
  leftSidebarView: LeftSidebarView
  pinnedWorkspaceIDs: string[]
  rightSidebar: RightSidebarState
  selectedFolderID: string | null
  sessionCanvasUnreadBySession: Record<string, boolean>
  workspaces: WorkspaceGroup[]
}

export interface ComposerSliceState {
  composerAttachmentsByTabKey: Record<string, ComposerAttachment[]>
  composerDraftStateByTabKey: Record<string, ComposerDraftState>
  composerParentMessageIDByTabKey: Record<string, string>
  composerRefreshVersion: number
  isCreatingSessionByTabKey: Record<string, boolean>
  isSendingByTabKey: Record<string, boolean>
}

export interface AgentStreamSliceState {
  agentSessions: Record<string, string>
  cancellingSessionIDs: Record<string, boolean>
  conversationActivityBySession: ConversationActivityMap
  conversationStore: ConversationStoreApi
  contextUsageBySession: Record<string, SessionContextUsage>
  conversations: ConversationMessageMap
  messageTreeBySession: Record<string, SessionMessageTree>
  pendingConversationInputsBySession: Record<string, PendingConversationInput[]>
  pendingPermissionRequestsBySession: Record<string, PermissionRequest[]>
  permissionRequestActionError: string | null
  permissionRequestActionRequestID: string | null
  sessionDirectoryBySession: Record<string, string>
}

export interface ReviewSliceState {
  previewByWorkspaceID: Record<string, WorkspacePreviewState>
  selectedDiffFileBySession: Record<string, string | null>
  sessionDiffBySession: Record<string, SessionDiffSummary>
  sessionDiffStateBySession: Record<string, SessionDiffState>
  sessionRuntimeDebugBySession: Record<string, SessionRuntimeDebugSnapshot>
  sessionRuntimeDebugStateBySession: Record<string, SessionRuntimeDebugState>
  sessionTasksBySession: Record<string, SessionTaskListView>
  workspaceFileCommentsByTarget: Record<string, WorkspaceFileComment[]>
  workspaceFileReviewState: WorkspaceFileReviewState
}

export interface WorkbenchSliceActions {
  setDockviewActiveState: (update: WorkspaceStateUpdater<WorkbenchDockviewActiveState>) => void
  setDockviewLayout: (update: WorkspaceStateUpdater<SerializedDockview | null>) => void
}

export interface SessionsSliceActions {
  activateRightSidebarTab: (tabID: string | null) => void
  closeRightSidebarTab: (tabID: string) => void
  openOrFocusRightSidebarTab: (input: RightSidebarOpenTabInput) => string
  setRightSidebarFileState: (tabID: string, update: WorkspaceStateUpdater<WorkspaceFileReviewState>) => void
  setRightSidebarPreviewState: (tabID: string, update: WorkspaceStateUpdater<WorkspacePreviewState>) => void
  updateRightSidebarTab: (tabID: string, update: RightSidebarTabUpdate) => void
  setCanLoadSessionHistory: (update: WorkspaceStateUpdater<boolean>) => void
  setCreateSessionTabs: (update: WorkspaceStateUpdater<CreateSessionTab[]>) => void
  setDeletingSessionID: (update: WorkspaceStateUpdater<string | null>) => void
  setExpandedFolderIDs: (update: WorkspaceStateUpdater<string[]>) => void
  setHoveredFolderID: (update: WorkspaceStateUpdater<string | null>) => void
  setIsCreatingProject: (update: WorkspaceStateUpdater<boolean>) => void
  setIsInitialWorkspaceLoadPending: (update: WorkspaceStateUpdater<boolean>) => void
  setLeftSidebarView: (update: WorkspaceStateUpdater<LeftSidebarView>) => void
  setPinnedWorkspaceIDs: (update: WorkspaceStateUpdater<string[]>) => void
  setSelectedFolderID: (update: WorkspaceStateUpdater<string | null>) => void
  setSessionCanvasUnreadBySession: (
    update: WorkspaceStateUpdater<Record<string, boolean>>,
  ) => void
  setWorkspaces: (update: WorkspaceStateUpdater<WorkspaceGroup[]>) => void
}

export interface ComposerSliceActions {
  setComposerAttachmentsByTabKey: (
    update: WorkspaceStateUpdater<Record<string, ComposerAttachment[]>>,
  ) => void
  setComposerDraftStateByTabKey: (
    update: WorkspaceStateUpdater<Record<string, ComposerDraftState>>,
  ) => void
  setComposerParentMessageIDByTabKey: (
    update: WorkspaceStateUpdater<Record<string, string>>,
  ) => void
  setComposerRefreshVersion: (update: WorkspaceStateUpdater<number>) => void
  setIsCreatingSessionByTabKey: (update: WorkspaceStateUpdater<Record<string, boolean>>) => void
  setIsSendingByTabKey: (update: WorkspaceStateUpdater<Record<string, boolean>>) => void
}

export interface AgentStreamSliceActions {
  appendAssistantDelta: (
    sessionID: string,
    assistantMessageID: string,
    updater: (message: AssistantThreadMessage) => AssistantThreadMessage,
  ) => boolean
  setAgentSessions: (update: WorkspaceStateUpdater<Record<string, string>>) => void
  setCancellingSessionIDs: (update: WorkspaceStateUpdater<Record<string, boolean>>) => void
  setContextUsageBySession: (
    update: WorkspaceStateUpdater<Record<string, SessionContextUsage>>,
  ) => void
  setConversations: (update: WorkspaceStateUpdater<ConversationMessageMap>) => void
  setMessageTreeBySession: (update: WorkspaceStateUpdater<Record<string, SessionMessageTree>>) => void
  setPendingConversationInputsBySession: (
    update: WorkspaceStateUpdater<Record<string, PendingConversationInput[]>>,
  ) => void
  setPendingPermissionRequestsBySession: (
    update: WorkspaceStateUpdater<Record<string, PermissionRequest[]>>,
  ) => void
  setPermissionRequestActionError: (update: WorkspaceStateUpdater<string | null>) => void
  setPermissionRequestActionRequestID: (update: WorkspaceStateUpdater<string | null>) => void
  setSessionDirectoryBySession: (update: WorkspaceStateUpdater<Record<string, string>>) => void
  updateConversationTurns: (update: WorkspaceStateUpdater<ConversationTurnMap>) => boolean
}

export interface ReviewSliceActions {
  setPreviewByWorkspaceID: (update: WorkspaceStateUpdater<Record<string, WorkspacePreviewState>>) => void
  setSelectedDiffFileBySession: (update: WorkspaceStateUpdater<Record<string, string | null>>) => void
  setSessionDiffBySession: (update: WorkspaceStateUpdater<Record<string, SessionDiffSummary>>) => void
  setSessionDiffStateBySession: (update: WorkspaceStateUpdater<Record<string, SessionDiffState>>) => void
  setSessionRuntimeDebugBySession: (
    update: WorkspaceStateUpdater<Record<string, SessionRuntimeDebugSnapshot>>,
  ) => void
  setSessionRuntimeDebugStateBySession: (
    update: WorkspaceStateUpdater<Record<string, SessionRuntimeDebugState>>,
  ) => void
  setSessionTasksBySession: (update: WorkspaceStateUpdater<Record<string, SessionTaskListView>>) => void
  setWorkspaceFileCommentsByTarget: (
    update: WorkspaceStateUpdater<Record<string, WorkspaceFileComment[]>>,
  ) => void
  setWorkspaceFileReviewState: (update: WorkspaceStateUpdater<WorkspaceFileReviewState>) => void
}

export interface WorkspaceStoreState {
  agentStream: AgentStreamSliceState
  composer: ComposerSliceState
  review: ReviewSliceState
  sessions: SessionsSliceState
  workbench: WorkbenchSliceState
}

export interface WorkspaceStoreActions {
  agentStreamActions: AgentStreamSliceActions
  composerActions: ComposerSliceActions
  reviewActions: ReviewSliceActions
  sessionsActions: SessionsSliceActions
  workbenchActions: WorkbenchSliceActions
}

export type WorkspaceStore = WorkspaceStoreState & WorkspaceStoreActions
export type WorkspaceStoreApi = StoreApi<WorkspaceStore>

interface CreateWorkspaceStoreOptions {
  hasFolderWorkspaceLoader: boolean
  initialCreateSessionTab: CreateSessionTab | null
  initialComposerTabKey: string | null
  initialDockviewLayout: SerializedDockview | null
}

function resolveStateUpdate<T>(current: T, update: WorkspaceStateUpdater<T>): T {
  return typeof update === "function" ? (update as (value: T) => T)(current) : update
}

function stringArraysAreEqual(left: string[], right: string[]) {
  if (left === right) return true
  if (left.length !== right.length) return false
  return left.every((item, index) => item === right[index])
}

export function createWorkspaceStore({
  hasFolderWorkspaceLoader,
  initialComposerTabKey,
  initialCreateSessionTab,
  initialDockviewLayout,
}: CreateWorkspaceStoreOptions) {
  const shouldUseSeedData = !hasFolderWorkspaceLoader
  const initialWorkspace = shouldUseSeedData ? initialSelection.workspace : null
  const initialPinnedWorkspaceIDs = readPinnedWorkspaceIDs()
  const initialDockviewActiveState = createDockviewActiveStateFromLayout(initialDockviewLayout)
  const conversationStore = createConversationStore(shouldUseSeedData ? initialConversations : {})

  return createStore<WorkspaceStore>((set) => ({
    workbench: {
      dockviewActiveState: initialDockviewActiveState,
      dockviewLayout: initialDockviewLayout,
    },
    sessions: {
      canLoadSessionHistory: false,
      createSessionTabs: initialCreateSessionTab ? [initialCreateSessionTab] : [],
      deletingSessionID: null,
      expandedFolderIDs: initialWorkspace ? [initialWorkspace.id] : [],
      hoveredFolderID: null,
      isCreatingProject: false,
      isInitialWorkspaceLoadPending: hasFolderWorkspaceLoader,
      leftSidebarView: "workspace",
      pinnedWorkspaceIDs: initialPinnedWorkspaceIDs,
      rightSidebar: {
        tabs: [],
        activeTabID: null,
      },
      selectedFolderID: initialWorkspace?.id ?? null,
      sessionCanvasUnreadBySession: {},
      workspaces: shouldUseSeedData ? sortWorkspaceGroups(seedWorkspaces, initialPinnedWorkspaceIDs) : [],
    },
    composer: {
      composerAttachmentsByTabKey: {},
      composerDraftStateByTabKey: initialComposerTabKey
        ? {
            [initialComposerTabKey]: createComposerDraftStateFromPlainText(
              "Help me align the desktop sidebar with the Pencil design.",
            ),
          }
        : {},
      composerParentMessageIDByTabKey: {},
      composerRefreshVersion: 0,
      isCreatingSessionByTabKey: {},
      isSendingByTabKey: {},
    },
    agentStream: {
      agentSessions: {},
      cancellingSessionIDs: {},
      conversationActivityBySession: conversationStore.getActivityBySession(),
      conversationStore,
      contextUsageBySession: {},
      conversations: conversationStore.getConversations(),
      messageTreeBySession: {},
      pendingConversationInputsBySession: {},
      pendingPermissionRequestsBySession: {},
      permissionRequestActionError: null,
      permissionRequestActionRequestID: null,
      sessionDirectoryBySession: {},
    },
    review: {
      previewByWorkspaceID: {},
      selectedDiffFileBySession: {},
      sessionDiffBySession: {},
      sessionDiffStateBySession: {},
      sessionRuntimeDebugBySession: {},
      sessionRuntimeDebugStateBySession: {},
      sessionTasksBySession: {},
      workspaceFileCommentsByTarget: {},
      workspaceFileReviewState: DEFAULT_WORKSPACE_FILE_REVIEW_STATE,
    },
    workbenchActions: {
      setDockviewActiveState: (update) =>
        set((state) => {
          const dockviewActiveState = resolveStateUpdate(state.workbench.dockviewActiveState, update)
          if (dockviewActiveStatesAreEqual(state.workbench.dockviewActiveState, dockviewActiveState)) {
            return state
          }
          return {
            workbench: {
              ...state.workbench,
              dockviewActiveState,
            },
          }
        }),
      setDockviewLayout: (update) =>
        set((state) => {
          const dockviewLayout = resolveStateUpdate(state.workbench.dockviewLayout, update)
          const dockviewActiveState = normalizeDockviewActiveState(
            dockviewLayout,
            state.workbench.dockviewActiveState,
          )
          return {
            workbench: {
              ...state.workbench,
              dockviewActiveState,
              dockviewLayout,
            },
          }
        }),
    },
    sessionsActions: {
      activateRightSidebarTab: (tabID) =>
        set((state) => {
          const activeTabID = tabID && state.sessions.rightSidebar.tabs.some((tab) => tab.id === tabID)
            ? tabID
            : null
          if (state.sessions.rightSidebar.activeTabID === activeTabID) return state

          return {
            sessions: {
              ...state.sessions,
              rightSidebar: {
                ...state.sessions.rightSidebar,
                activeTabID,
              },
            },
          }
        }),
      closeRightSidebarTab: (tabID) =>
        set((state) => {
          const tabs = state.sessions.rightSidebar.tabs
          const tabIndex = tabs.findIndex((tab) => tab.id === tabID)
          if (tabIndex === -1) return state

          const nextTabs = tabs.filter((tab) => tab.id !== tabID)
          const currentActiveTabID = state.sessions.rightSidebar.activeTabID
          let activeTabID = currentActiveTabID
          if (currentActiveTabID === tabID) {
            activeTabID = nextTabs[Math.max(0, tabIndex - 1)]?.id ?? nextTabs[0]?.id ?? null
          } else if (activeTabID && !nextTabs.some((tab) => tab.id === activeTabID)) {
            activeTabID = nextTabs[0]?.id ?? null
          }

          return {
            sessions: {
              ...state.sessions,
              rightSidebar: {
                activeTabID,
                tabs: nextTabs,
              },
            },
          }
        }),
      openOrFocusRightSidebarTab: (input) => {
        let resolvedTabID = ""
        set((state) => {
          const targetKey = getRightSidebarTabTargetKey(input)
          const existingTab =
            input.kind === "branch-thread" && (input.phase ?? "draft") === "draft"
              ? undefined
              : state.sessions.rightSidebar.tabs.find(
                  (tab) => tab.kind === input.kind && tab.targetKey === targetKey,
                )
          if (existingTab) {
            resolvedTabID = existingTab.id
            if (state.sessions.rightSidebar.activeTabID === existingTab.id) return state

            return {
              sessions: {
                ...state.sessions,
                rightSidebar: {
                  ...state.sessions.rightSidebar,
                  activeTabID: existingTab.id,
                },
              },
            }
          }

          const nextTab = createRightSidebarTab(input)
          resolvedTabID = nextTab.id
          return {
            sessions: {
              ...state.sessions,
              rightSidebar: {
                activeTabID: nextTab.id,
                tabs: [...state.sessions.rightSidebar.tabs, nextTab],
              },
            },
          }
        })
        return resolvedTabID
      },
      setRightSidebarFileState: (tabID, update) =>
        set((state) => {
          let changed = false
          const tabs = state.sessions.rightSidebar.tabs.map((tab) => {
            if (tab.id !== tabID || tab.kind !== "files") return tab
            const nextState = resolveStateUpdate(tab.state, update)
            if (nextState === tab.state) return tab
            changed = true
            return {
              ...tab,
              state: nextState,
            }
          })
          if (!changed) return state

          return {
            sessions: {
              ...state.sessions,
              rightSidebar: {
                ...state.sessions.rightSidebar,
                tabs,
              },
            },
          }
        }),
      setRightSidebarPreviewState: (tabID, update) =>
        set((state) => {
          let changed = false
          const tabs = state.sessions.rightSidebar.tabs.map((tab) => {
            if (tab.id !== tabID || tab.kind !== "browser") return tab
            const nextState = resolveStateUpdate(tab.state, update)
            if (nextState === tab.state) return tab
            changed = true
            return {
              ...tab,
              state: nextState,
            }
          })
          if (!changed) return state

          return {
            sessions: {
              ...state.sessions,
              rightSidebar: {
                ...state.sessions.rightSidebar,
                tabs,
              },
            },
          }
        }),
      updateRightSidebarTab: (tabID, update) =>
        set((state) => {
          let changed = false
          const tabs = state.sessions.rightSidebar.tabs.map((tab) => {
            if (tab.id !== tabID) return tab
            const nextTab = updateRightSidebarTab(tab, update)
            if (nextTab === tab) return tab
            changed = true
            return nextTab
          })
          if (!changed) return state

          return {
            sessions: {
              ...state.sessions,
              rightSidebar: {
                ...state.sessions.rightSidebar,
                tabs,
              },
            },
          }
        }),
      setCanLoadSessionHistory: (update) =>
        set((state) => ({
          sessions: {
            ...state.sessions,
            canLoadSessionHistory: resolveStateUpdate(state.sessions.canLoadSessionHistory, update),
          },
        })),
      setCreateSessionTabs: (update) =>
        set((state) => ({
          sessions: {
            ...state.sessions,
            createSessionTabs: resolveStateUpdate(state.sessions.createSessionTabs, update),
          },
        })),
      setDeletingSessionID: (update) =>
        set((state) => ({
          sessions: {
            ...state.sessions,
            deletingSessionID: resolveStateUpdate(state.sessions.deletingSessionID, update),
          },
        })),
      setExpandedFolderIDs: (update) =>
        set((state) => {
          const expandedFolderIDs = resolveStateUpdate(state.sessions.expandedFolderIDs, update)
          if (stringArraysAreEqual(state.sessions.expandedFolderIDs, expandedFolderIDs)) {
            return state
          }
          return {
            sessions: {
              ...state.sessions,
              expandedFolderIDs,
            },
          }
        }),
      setHoveredFolderID: (update) =>
        set((state) => ({
          sessions: {
            ...state.sessions,
            hoveredFolderID: resolveStateUpdate(state.sessions.hoveredFolderID, update),
          },
        })),
      setIsCreatingProject: (update) =>
        set((state) => ({
          sessions: {
            ...state.sessions,
            isCreatingProject: resolveStateUpdate(state.sessions.isCreatingProject, update),
          },
        })),
      setIsInitialWorkspaceLoadPending: (update) =>
        set((state) => ({
          sessions: {
            ...state.sessions,
            isInitialWorkspaceLoadPending: resolveStateUpdate(state.sessions.isInitialWorkspaceLoadPending, update),
          },
        })),
      setLeftSidebarView: (update) =>
        set((state) => ({
          sessions: {
            ...state.sessions,
            leftSidebarView: resolveStateUpdate(state.sessions.leftSidebarView, update),
          },
        })),
      setPinnedWorkspaceIDs: (update) =>
        set((state) => {
          const pinnedWorkspaceIDs = [...new Set(resolveStateUpdate(state.sessions.pinnedWorkspaceIDs, update))]
          writePinnedWorkspaceIDs(pinnedWorkspaceIDs)

          return {
            sessions: {
              ...state.sessions,
              pinnedWorkspaceIDs,
              workspaces: sortWorkspaceGroups(state.sessions.workspaces, pinnedWorkspaceIDs),
            },
          }
        }),
      setSelectedFolderID: (update) =>
        set((state) => {
          const selectedFolderID = resolveStateUpdate(state.sessions.selectedFolderID, update)
          if (state.sessions.selectedFolderID === selectedFolderID) {
            return state
          }
          return {
            sessions: {
              ...state.sessions,
              selectedFolderID,
            },
          }
        }),
      setSessionCanvasUnreadBySession: (update) =>
        set((state) => ({
          sessions: {
            ...state.sessions,
            sessionCanvasUnreadBySession: resolveStateUpdate(
              state.sessions.sessionCanvasUnreadBySession,
              update,
            ),
          },
        })),
      setWorkspaces: (update) =>
        set((state) => ({
          sessions: {
            ...state.sessions,
            workspaces: sortWorkspaceGroups(
              resolveStateUpdate(state.sessions.workspaces, update),
              state.sessions.pinnedWorkspaceIDs,
            ),
          },
        })),
    },
    composerActions: {
      setComposerAttachmentsByTabKey: (update) =>
        set((state) => ({
          composer: {
            ...state.composer,
            composerAttachmentsByTabKey: resolveStateUpdate(state.composer.composerAttachmentsByTabKey, update),
          },
        })),
      setComposerDraftStateByTabKey: (update) =>
        set((state) => ({
          composer: {
            ...state.composer,
            composerDraftStateByTabKey: resolveStateUpdate(state.composer.composerDraftStateByTabKey, update),
          },
        })),
      setComposerParentMessageIDByTabKey: (update) =>
        set((state) => ({
          composer: {
            ...state.composer,
            composerParentMessageIDByTabKey: resolveStateUpdate(state.composer.composerParentMessageIDByTabKey, update),
          },
        })),
      setComposerRefreshVersion: (update) =>
        set((state) => ({
          composer: {
            ...state.composer,
            composerRefreshVersion: resolveStateUpdate(state.composer.composerRefreshVersion, update),
          },
        })),
      setIsCreatingSessionByTabKey: (update) =>
        set((state) => ({
          composer: {
            ...state.composer,
            isCreatingSessionByTabKey: resolveStateUpdate(state.composer.isCreatingSessionByTabKey, update),
          },
        })),
      setIsSendingByTabKey: (update) =>
        set((state) => ({
          composer: {
            ...state.composer,
            isSendingByTabKey: resolveStateUpdate(state.composer.isSendingByTabKey, update),
          },
        })),
    },
    agentStreamActions: {
      appendAssistantDelta: (sessionID, assistantMessageID, updater) => {
        let didUpdate = false
        set((state) => {
          const previousActivityBySession = state.agentStream.conversationStore.getActivityBySession()
          didUpdate = state.agentStream.conversationStore.appendAssistantDelta(sessionID, assistantMessageID, updater)
          if (!didUpdate) return state

          const conversationActivityBySession = state.agentStream.conversationStore.getActivityBySession()
          if (conversationActivityMapsAreEqual(previousActivityBySession, conversationActivityBySession)) {
            return state
          }

          return {
            agentStream: {
              ...state.agentStream,
              conversationActivityBySession,
              conversations: state.agentStream.conversationStore.getConversations(),
            },
          }
        })
        return didUpdate
      },
      setAgentSessions: (update) =>
        set((state) => ({
          agentStream: {
            ...state.agentStream,
            agentSessions: resolveStateUpdate(state.agentStream.agentSessions, update),
          },
        })),
      setCancellingSessionIDs: (update) =>
        set((state) => ({
          agentStream: {
            ...state.agentStream,
            cancellingSessionIDs: resolveStateUpdate(state.agentStream.cancellingSessionIDs, update),
          },
        })),
      setContextUsageBySession: (update) =>
        set((state) => ({
          agentStream: {
            ...state.agentStream,
            contextUsageBySession: resolveStateUpdate(state.agentStream.contextUsageBySession, update),
          },
        })),
      setConversations: (update) =>
        set((state) => {
          const previousActivityBySession = state.agentStream.conversationStore.getActivityBySession()
          const didUpdate = state.agentStream.conversationStore.updateConversations(update)
          if (!didUpdate) return state

          const conversationActivityBySession = state.agentStream.conversationStore.getActivityBySession()
          if (conversationActivityMapsAreEqual(previousActivityBySession, conversationActivityBySession)) {
            return state
          }

          return {
            agentStream: {
              ...state.agentStream,
              conversationActivityBySession,
              conversations: state.agentStream.conversationStore.getConversations(),
            },
          }
        }),
      updateConversationTurns: (update) => {
        let didUpdate = false
        set((state) => {
          const previousActivityBySession = state.agentStream.conversationStore.getActivityBySession()
          didUpdate = state.agentStream.conversationStore.updateTurns(update)
          if (!didUpdate) return state

          const conversationActivityBySession = state.agentStream.conversationStore.getActivityBySession()
          if (conversationActivityMapsAreEqual(previousActivityBySession, conversationActivityBySession)) {
            return state
          }

          return {
            agentStream: {
              ...state.agentStream,
              conversationActivityBySession,
              conversations: state.agentStream.conversationStore.getConversations(),
            },
          }
        })
        return didUpdate
      },
      setMessageTreeBySession: (update) =>
        set((state) => ({
          agentStream: {
            ...state.agentStream,
            messageTreeBySession: resolveStateUpdate(state.agentStream.messageTreeBySession, update),
          },
        })),
      setPendingConversationInputsBySession: (update) =>
        set((state) => ({
          agentStream: {
            ...state.agentStream,
            pendingConversationInputsBySession: resolveStateUpdate(
              state.agentStream.pendingConversationInputsBySession,
              update,
            ),
          },
        })),
      setPendingPermissionRequestsBySession: (update) =>
        set((state) => ({
          agentStream: {
            ...state.agentStream,
            pendingPermissionRequestsBySession: resolveStateUpdate(
              state.agentStream.pendingPermissionRequestsBySession,
              update,
            ),
          },
        })),
      setPermissionRequestActionError: (update) =>
        set((state) => ({
          agentStream: {
            ...state.agentStream,
            permissionRequestActionError: resolveStateUpdate(state.agentStream.permissionRequestActionError, update),
          },
        })),
      setPermissionRequestActionRequestID: (update) =>
        set((state) => ({
          agentStream: {
            ...state.agentStream,
            permissionRequestActionRequestID: resolveStateUpdate(
              state.agentStream.permissionRequestActionRequestID,
              update,
            ),
          },
        })),
      setSessionDirectoryBySession: (update) =>
        set((state) => ({
          agentStream: {
            ...state.agentStream,
            sessionDirectoryBySession: resolveStateUpdate(state.agentStream.sessionDirectoryBySession, update),
          },
        })),
    },
    reviewActions: {
      setPreviewByWorkspaceID: (update) =>
        set((state) => ({
          review: {
            ...state.review,
            previewByWorkspaceID: resolveStateUpdate(state.review.previewByWorkspaceID, update),
          },
        })),
      setSelectedDiffFileBySession: (update) =>
        set((state) => ({
          review: {
            ...state.review,
            selectedDiffFileBySession: resolveStateUpdate(state.review.selectedDiffFileBySession, update),
          },
        })),
      setSessionDiffBySession: (update) =>
        set((state) => ({
          review: {
            ...state.review,
            sessionDiffBySession: resolveStateUpdate(state.review.sessionDiffBySession, update),
          },
        })),
      setSessionDiffStateBySession: (update) =>
        set((state) => ({
          review: {
            ...state.review,
            sessionDiffStateBySession: resolveStateUpdate(state.review.sessionDiffStateBySession, update),
          },
        })),
      setSessionRuntimeDebugBySession: (update) =>
        set((state) => ({
          review: {
            ...state.review,
            sessionRuntimeDebugBySession: resolveStateUpdate(state.review.sessionRuntimeDebugBySession, update),
          },
        })),
      setSessionRuntimeDebugStateBySession: (update) =>
        set((state) => ({
          review: {
            ...state.review,
            sessionRuntimeDebugStateBySession: resolveStateUpdate(state.review.sessionRuntimeDebugStateBySession, update),
          },
        })),
      setSessionTasksBySession: (update) =>
        set((state) => ({
          review: {
            ...state.review,
            sessionTasksBySession: resolveStateUpdate(state.review.sessionTasksBySession, update),
          },
        })),
      setWorkspaceFileCommentsByTarget: (update) =>
        set((state) => ({
          review: {
            ...state.review,
            workspaceFileCommentsByTarget: resolveStateUpdate(state.review.workspaceFileCommentsByTarget, update),
          },
        })),
      setWorkspaceFileReviewState: (update) =>
        set((state) => ({
          review: {
            ...state.review,
            workspaceFileReviewState: resolveStateUpdate(state.review.workspaceFileReviewState, update),
          },
        })),
    },
  }))
}

export function useWorkspaceStoreSelector<T>(
  store: WorkspaceStoreApi,
  selector: (state: WorkspaceStore) => T,
  equalityFn?: (left: T, right: T) => boolean,
) {
  const storeRef = useRef(store)
  const latestSelectorRef = useRef(selector)
  const latestEqualityRef = useRef(equalityFn ?? Object.is)
  const latestSelectionRef = useRef<T | null>(null)
  const hasSelectionRef = useRef(false)

  if (storeRef.current !== store) {
    storeRef.current = store
    latestSelectionRef.current = null
    hasSelectionRef.current = false
  }

  latestSelectorRef.current = selector
  latestEqualityRef.current = equalityFn ?? Object.is

  const getSnapshot = () => {
    const nextSelection = latestSelectorRef.current(storeRef.current.getState())
    if (
      hasSelectionRef.current &&
      latestEqualityRef.current(latestSelectionRef.current as T, nextSelection)
    ) {
      return latestSelectionRef.current as T
    }

    hasSelectionRef.current = true
    latestSelectionRef.current = nextSelection
    return nextSelection
  }

  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot)
}

export function shallowEqualObjects<T extends Record<string, unknown>>(left: T, right: T) {
  if (Object.is(left, right)) return true
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  if (leftKeys.length !== rightKeys.length) return false
  return leftKeys.every((key) => Object.is(left[key], right[key]))
}

export function shallowEqualArrays<T>(left: readonly T[], right: readonly T[]) {
  if (Object.is(left, right)) return true
  if (left.length !== right.length) return false
  return left.every((item, index) => Object.is(item, right[index]))
}

export const workspaceStoreSelectors = {
  activeSessionReviewState: (state: WorkspaceStore) => ({
    previewByWorkspaceID: state.review.previewByWorkspaceID,
    selectedDiffFileBySession: state.review.selectedDiffFileBySession,
    sessionDiffBySession: state.review.sessionDiffBySession,
    sessionDiffStateBySession: state.review.sessionDiffStateBySession,
    sessionRuntimeDebugBySession: state.review.sessionRuntimeDebugBySession,
    sessionRuntimeDebugStateBySession: state.review.sessionRuntimeDebugStateBySession,
    sessionTasksBySession: state.review.sessionTasksBySession,
  }),
  composerStateForTab:
    (tabKey: string | null) =>
    (state: WorkspaceStore) => ({
      attachments: tabKey ? state.composer.composerAttachmentsByTabKey[tabKey] ?? [] : [],
      draftState: tabKey ? state.composer.composerDraftStateByTabKey[tabKey] : undefined,
      isCreatingSession: tabKey ? Boolean(state.composer.isCreatingSessionByTabKey[tabKey]) : false,
      isSending: tabKey ? Boolean(state.composer.isSendingByTabKey[tabKey]) : false,
    }),
  dockviewLayout: (state: WorkspaceStore) => state.workbench.dockviewLayout,
}
