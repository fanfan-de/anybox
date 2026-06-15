import { useRef } from "react"
import type {
  SessionDiffState,
  SessionRuntimeDebugState,
  WorkspaceFileReviewState,
  WorkspacePreviewState
} from "../types"
import { useWorkspaceStoreSelector, type WorkspaceStoreApi } from "./workspace-store"

const PREVIEW_FALLBACK_SCOPE_ID = "__preview_global__"

export const DEFAULT_SESSION_DIFF_STATE: SessionDiffState = {
  status: "idle",
  errorMessage: null,
  updatedAt: null,
  isStale: false,
}

export const DEFAULT_SESSION_RUNTIME_DEBUG_STATE: SessionRuntimeDebugState = {
  status: "idle",
  errorMessage: null,
  updatedAt: null,
  isStale: false,
}

export const DEFAULT_WORKSPACE_PREVIEW_STATE: WorkspacePreviewState = {
  activeTargetInput: null,
  activeInteractionID: null,
  draftUrl: "http://localhost:3000",
  draftTarget: "http://localhost:3000",
  committedUrl: null,
  reloadToken: 0,
  errorKind: null,
  errorMessage: null,
  navigationHistory: [],
  navigationIndex: -1,
  interactions: [],
  resolvedTarget: null,
  status: "idle",
}

export const DEFAULT_WORKSPACE_FILE_REVIEW_STATE: WorkspaceFileReviewState = {
  scopeDirectory: null,
  query: "",
  results: [],
  treeEntriesByDirectoryPath: {},
  treeErrorByDirectoryPath: {},
  treeExpandedDirectoryPaths: [],
  treeLoadingDirectoryPaths: [],
  selectedFilePath: null,
  selectedFileContent: null,
  selectedFileKind: null,
  selectedFileExtension: null,
  selectedFileMimeType: null,
  selectedFilePreviewUrl: null,
  selectedFileSize: null,
  status: "idle",
  errorMessage: null,
  comments: [],
  linkedLineRange: null,
  pendingComment: null,
}

export function resolvePreviewScopeID(workspaceID: string | null | undefined) {
  return workspaceID ?? PREVIEW_FALLBACK_SCOPE_ID
}

function normalizeWorkspacePath(value: string, platform: string) {
  const normalized = value.trim().replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "")
  return platform === "win32" ? normalized.toLowerCase() : normalized
}

export function getWorkspaceFileCommentKey(
  directory: string | null | undefined,
  filePath: string | null | undefined,
  platform: string,
) {
  if (!directory || !filePath) return null
  return `${normalizeWorkspacePath(directory, platform)}::${filePath.replace(/\\/g, "/")}`
}

export function resolveWorkspaceFileReviewStatus(
  state: Pick<
    WorkspaceFileReviewState,
    | "errorMessage"
    | "query"
    | "results"
    | "selectedFileContent"
    | "selectedFileKind"
    | "selectedFilePath"
    | "selectedFilePreviewUrl"
  >,
): WorkspaceFileReviewState["status"] {
  if (state.errorMessage) return "error"
  if (state.selectedFileKind === "unsupported") return "unsupported"
  if (state.selectedFilePath && state.selectedFileKind === "text" && state.selectedFileContent !== null) return "ready"
  if (state.selectedFilePath && state.selectedFileKind === "image" && state.selectedFilePreviewUrl) return "ready"
  if (state.selectedFilePath && state.selectedFileKind === "video" && state.selectedFilePreviewUrl) return "ready"
  if (state.query.trim() && state.results.length === 0) return "empty"
  return "idle"
}

export function useReviewPreviewState(store: WorkspaceStoreApi) {
  const sessionDiffRequestRef = useRef<Record<string, number>>({})
  const sessionDiffRefreshTimerRef = useRef<Record<string, number>>({})
  const runtimeDebugRequestRef = useRef<Record<string, number>>({})
  const runtimeDebugRefreshTimerRef = useRef<Record<string, number>>({})
  const workspaceFileSearchRequestRef = useRef(0)
  const workspaceFileReadRequestRef = useRef(0)

  const previewByWorkspaceID = useWorkspaceStoreSelector(store, (state) => state.review.previewByWorkspaceID)
  const selectedDiffFileBySession = useWorkspaceStoreSelector(store, (state) => state.review.selectedDiffFileBySession)
  const sessionDiffBySession = useWorkspaceStoreSelector(store, (state) => state.review.sessionDiffBySession)
  const sessionDiffStateBySession = useWorkspaceStoreSelector(store, (state) => state.review.sessionDiffStateBySession)
  const sessionRuntimeDebugBySession = useWorkspaceStoreSelector(
    store,
    (state) => state.review.sessionRuntimeDebugBySession,
  )
  const sessionRuntimeDebugStateBySession = useWorkspaceStoreSelector(
    store,
    (state) => state.review.sessionRuntimeDebugStateBySession,
  )
  const sessionTasksBySession = useWorkspaceStoreSelector(store, (state) => state.review.sessionTasksBySession)
  const workspaceFileCommentsByTarget = useWorkspaceStoreSelector(
    store,
    (state) => state.review.workspaceFileCommentsByTarget,
  )
  const workspaceFileReviewState = useWorkspaceStoreSelector(store, (state) => state.review.workspaceFileReviewState)
  const setPreviewByWorkspaceID = useWorkspaceStoreSelector(store, (state) => state.reviewActions.setPreviewByWorkspaceID)
  const setSelectedDiffFileBySession = useWorkspaceStoreSelector(
    store,
    (state) => state.reviewActions.setSelectedDiffFileBySession,
  )
  const setSessionDiffBySession = useWorkspaceStoreSelector(store, (state) => state.reviewActions.setSessionDiffBySession)
  const setSessionDiffStateBySession = useWorkspaceStoreSelector(
    store,
    (state) => state.reviewActions.setSessionDiffStateBySession,
  )
  const setSessionRuntimeDebugBySession = useWorkspaceStoreSelector(
    store,
    (state) => state.reviewActions.setSessionRuntimeDebugBySession,
  )
  const setSessionRuntimeDebugStateBySession = useWorkspaceStoreSelector(
    store,
    (state) => state.reviewActions.setSessionRuntimeDebugStateBySession,
  )
  const setSessionTasksBySession = useWorkspaceStoreSelector(
    store,
    (state) => state.reviewActions.setSessionTasksBySession,
  )
  const setWorkspaceFileCommentsByTarget = useWorkspaceStoreSelector(
    store,
    (state) => state.reviewActions.setWorkspaceFileCommentsByTarget,
  )
  const setWorkspaceFileReviewState = useWorkspaceStoreSelector(
    store,
    (state) => state.reviewActions.setWorkspaceFileReviewState,
  )

  return {
    previewByWorkspaceID,
    runtimeDebugRefreshTimerRef,
    runtimeDebugRequestRef,
    selectedDiffFileBySession,
    sessionDiffBySession,
    sessionDiffRefreshTimerRef,
    sessionDiffRequestRef,
    sessionDiffStateBySession,
    sessionRuntimeDebugBySession,
    sessionRuntimeDebugStateBySession,
    sessionTasksBySession,
    setPreviewByWorkspaceID,
    setSelectedDiffFileBySession,
    setSessionDiffBySession,
    setSessionDiffStateBySession,
    setSessionRuntimeDebugBySession,
    setSessionRuntimeDebugStateBySession,
    setSessionTasksBySession,
    setWorkspaceFileCommentsByTarget,
    setWorkspaceFileReviewState,
    workspaceFileCommentsByTarget,
    workspaceFileReadRequestRef,
    workspaceFileReviewState,
    workspaceFileSearchRequestRef,
  }
}
