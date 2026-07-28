import { useEffect, type MutableRefObject } from "react"
import type {
  SessionDiffState,
  SessionDiffSummary,
  SessionRuntimeDebugSnapshot,
  SessionRuntimeDebugState,
  SessionTaskListView,
  WorkspaceFileReviewState,
} from "../types"
import { DEFAULT_SESSION_DIFF_STATE, DEFAULT_SESSION_RUNTIME_DEBUG_STATE, DEFAULT_WORKSPACE_FILE_REVIEW_STATE } from "./review-preview-state"
import type { SessionDataLoadOptions } from "./session-data-load-cache"
import { normalizeWorkspacePath } from "./workspace-loading-hooks"
import type { WorkspaceStateUpdater } from "./workspace-store"

const WORKSPACE_DIFF_REFRESH_DEBOUNCE_MS = 500

export function buildSessionDiffSummarySignature(diff: SessionDiffSummary | null | undefined) {
  if (!diff) return ""
  return JSON.stringify({
    availableScopes: diff.availableScopes ?? null,
    body: diff.body ?? "",
    diffs: diff.diffs.map((item) => ({
      additions: item.additions,
      deletions: item.deletions,
      file: item.file,
      patch: item.patch ?? "",
    })),
    restoreMode: diff.restoreMode ?? "",
    scope: diff.scope ?? "",
    stats: diff.stats ?? null,
    title: diff.title ?? "",
  })
}

export function sessionDiffSummariesAreEquivalent(
  left: SessionDiffSummary | null | undefined,
  right: SessionDiffSummary | null | undefined,
) {
  return buildSessionDiffSummarySignature(left) === buildSessionDiffSummarySignature(right)
}

export function buildSessionRuntimeDebugSignature(snapshot: SessionRuntimeDebugSnapshot | null | undefined) {
  if (!snapshot) return ""
  return JSON.stringify({
    activeTurnID: snapshot.activeTurnID,
    diagnostics: snapshot.diagnostics,
    executions: snapshot.executions ?? [],
    latestTurn: snapshot.latestTurn,
    running: {
      reason: snapshot.running.reason,
      sessionID: snapshot.running.sessionID,
      startedAt: snapshot.running.startedAt,
    },
    session: snapshot.session,
    status: snapshot.status,
    tasks: snapshot.tasks ?? null,
    turns: snapshot.turns,
  })
}

export function sessionRuntimeDebugSnapshotsAreEquivalent(
  left: SessionRuntimeDebugSnapshot | null | undefined,
  right: SessionRuntimeDebugSnapshot | null | undefined,
) {
  return buildSessionRuntimeDebugSignature(left) === buildSessionRuntimeDebugSignature(right)
}

export function buildSessionTaskListSignature(tasks: SessionTaskListView | null | undefined) {
  if (!tasks) return ""
  return JSON.stringify({
    blocked: tasks.blocked.map((task) => task.id),
    current: tasks.current.map((task) => task.id),
    next: tasks.next.map((task) => task.id),
    owners: tasks.owners.map((owner) => ({
      owner: owner.owner,
      current: owner.current?.id,
      next: owner.next?.id,
    })),
    summary: tasks.summary,
    tasks: tasks.tasks.map((task) => ({
      activeForm: task.activeForm,
      blockedBy: task.blockedBy,
      blocks: task.blocks,
      completedAt: task.completedAt,
      description: task.description,
      id: task.id,
      isBlocked: task.isBlocked,
      owner: task.owner,
      sortIndex: task.sortIndex,
      startedAt: task.startedAt,
      status: task.status,
      subject: task.subject,
      updatedAt: task.updatedAt,
    })),
    teammateActivity: tasks.teammateActivity,
  })
}

export function sessionTaskListsAreEquivalent(
  left: SessionTaskListView | null | undefined,
  right: SessionTaskListView | null | undefined,
) {
  return buildSessionTaskListSignature(left) === buildSessionTaskListSignature(right)
}

export async function loadSessionTasksForSession({
  backendSessionID,
  sessionID,
  setSessionTasksBySession,
}: {
  backendSessionID: string
  sessionID: string
  setSessionTasksBySession: (
    update: WorkspaceStateUpdater<Record<string, SessionTaskListView>>,
  ) => void
}) {
  const getSessionTasks = window.desktop?.getSessionTasks
  if (!getSessionTasks) return

  const nextTasks = await getSessionTasks({ sessionID: backendSessionID })
  setSessionTasksBySession((prev) => (
    sessionTaskListsAreEquivalent(prev[sessionID], nextTasks)
      ? prev
      : {
          ...prev,
          [sessionID]: nextTasks,
        }
  ))
}

interface SessionDiffRequestStateInput {
  hasExistingSummary: boolean
  sessionID: string
  setSessionDiffStateBySession: (
    update: WorkspaceStateUpdater<Record<string, SessionDiffState>>,
  ) => void
}

export function setSessionDiffRequestState({
  hasExistingSummary,
  sessionID,
  setSessionDiffStateBySession,
}: SessionDiffRequestStateInput) {
  setSessionDiffStateBySession((prev) => {
    const current = prev[sessionID] ?? DEFAULT_SESSION_DIFF_STATE
    return {
      ...prev,
      [sessionID]: {
        ...current,
        status: hasExistingSummary ? "refreshing" : "loading",
        errorMessage: null,
      },
    }
  })
}

export function clearSessionDiffRefreshTimer(
  sessionID: string,
  sessionDiffRefreshTimerRef: MutableRefObject<Record<string, number>>,
) {
  const timerID = sessionDiffRefreshTimerRef.current[sessionID]
  if (timerID === undefined) return
  window.clearTimeout(timerID)
  delete sessionDiffRefreshTimerRef.current[sessionID]
}

export function scheduleSessionDiffRefreshForSession({
  loadSessionDiffForSession,
  sessionDiffRefreshTimerRef,
  sessionID,
}: {
  loadSessionDiffForSession: (sessionID: string, backendSessionID?: string, options?: SessionDataLoadOptions) => Promise<void>
  sessionDiffRefreshTimerRef: MutableRefObject<Record<string, number>>
  sessionID: string
}) {
  clearSessionDiffRefreshTimer(sessionID, sessionDiffRefreshTimerRef)
  sessionDiffRefreshTimerRef.current[sessionID] = window.setTimeout(() => {
    delete sessionDiffRefreshTimerRef.current[sessionID]
    void loadSessionDiffForSession(sessionID, undefined, { force: true, mode: "silent", reason: "stream" }).catch((error) => {
      console.error("[desktop] workspace diff refresh failed:", error)
    })
  }, WORKSPACE_DIFF_REFRESH_DEBOUNCE_MS)
}

interface LoadSessionDiffInput {
  backendSessionID: string
  sessionDiffBySession: Record<string, SessionDiffSummary>
  sessionDiffRefreshTimerRef: MutableRefObject<Record<string, number>>
  sessionDiffRequestRef: MutableRefObject<Record<string, number>>
  sessionID: string
  setSessionDiffBySession: (
    update: WorkspaceStateUpdater<Record<string, SessionDiffSummary>>,
  ) => void
  setSessionDiffStateBySession: (
    update: WorkspaceStateUpdater<Record<string, SessionDiffState>>,
  ) => void
  options?: SessionDataLoadOptions
}

export async function loadSessionDiffForSession({
  backendSessionID,
  sessionDiffBySession,
  sessionDiffRefreshTimerRef,
  sessionDiffRequestRef,
  sessionID,
  setSessionDiffBySession,
  setSessionDiffStateBySession,
  options,
}: LoadSessionDiffInput) {
  const getSessionDiff = window.desktop?.getSessionDiff
  if (!getSessionDiff) return

  clearSessionDiffRefreshTimer(sessionID, sessionDiffRefreshTimerRef)
  const requestID = (sessionDiffRequestRef.current[sessionID] ?? 0) + 1
  sessionDiffRequestRef.current[sessionID] = requestID
  const hasExistingSummary = Boolean(sessionDiffBySession[sessionID])
  const isSilent = options?.mode === "silent"
  if (!isSilent) {
    setSessionDiffRequestState({
      hasExistingSummary,
      sessionID,
      setSessionDiffStateBySession,
    })
  }

  try {
    const nextDiff = await getSessionDiff({ sessionID: backendSessionID })
    if (sessionDiffRequestRef.current[sessionID] !== requestID) return
    let didChangeDiff = false

    setSessionDiffBySession((prev) => {
      didChangeDiff = !sessionDiffSummariesAreEquivalent(prev[sessionID], nextDiff)
      return didChangeDiff
        ? {
            ...prev,
            [sessionID]: nextDiff,
          }
        : prev
    })
    setSessionDiffStateBySession((prev) => {
      const current = prev[sessionID] ?? DEFAULT_SESSION_DIFF_STATE
      const nextState: SessionDiffState = {
        status: nextDiff.diffs.length > 0 ? "ready" : "empty",
        errorMessage: null,
        updatedAt: didChangeDiff ? Date.now() : current.updatedAt,
        isStale: false,
      }
      if (
        isSilent &&
        !didChangeDiff &&
        current.status === nextState.status &&
        current.errorMessage === nextState.errorMessage &&
        current.updatedAt === nextState.updatedAt &&
        current.isStale === nextState.isStale
      ) {
        return prev
      }
      if (
        current.status === nextState.status &&
        current.errorMessage === nextState.errorMessage &&
        current.updatedAt === nextState.updatedAt &&
        current.isStale === nextState.isStale
      ) {
        return prev
      }
      return {
        ...prev,
        [sessionID]: nextState,
      }
    })
  } catch (error) {
    if (sessionDiffRequestRef.current[sessionID] !== requestID) return
    const message = error instanceof Error ? error.message : String(error)
    setSessionDiffStateBySession((prev) => {
      const current = prev[sessionID] ?? DEFAULT_SESSION_DIFF_STATE
      return {
        ...prev,
        [sessionID]: {
          ...current,
          status: "error",
          errorMessage: message,
          isStale: hasExistingSummary || current.isStale,
        },
      }
    })
    console.error("[desktop] getSessionDiff failed:", error)
  }
}

interface RuntimeDebugRequestStateInput {
  hasExistingSnapshot: boolean
  sessionID: string
  setSessionRuntimeDebugStateBySession: (
    update: WorkspaceStateUpdater<Record<string, SessionRuntimeDebugState>>,
  ) => void
}

export function setSessionRuntimeDebugRequestState({
  hasExistingSnapshot,
  sessionID,
  setSessionRuntimeDebugStateBySession,
}: RuntimeDebugRequestStateInput) {
  setSessionRuntimeDebugStateBySession((prev) => {
    const current = prev[sessionID] ?? DEFAULT_SESSION_RUNTIME_DEBUG_STATE
    return {
      ...prev,
      [sessionID]: {
        ...current,
        status: hasExistingSnapshot ? "refreshing" : "loading",
        errorMessage: null,
      },
    }
  })
}

export function clearRuntimeDebugRefreshTimer(
  sessionID: string,
  runtimeDebugRefreshTimerRef: MutableRefObject<Record<string, number>>,
) {
  const timerID = runtimeDebugRefreshTimerRef.current[sessionID]
  if (timerID === undefined) return
  window.clearTimeout(timerID)
  delete runtimeDebugRefreshTimerRef.current[sessionID]
}

interface LoadSessionRuntimeDebugInput {
  backendSessionID: string
  runtimeDebugRefreshTimerRef: MutableRefObject<Record<string, number>>
  runtimeDebugRequestRef: MutableRefObject<Record<string, number>>
  sessionID: string
  sessionRuntimeDebugBySession: Record<string, SessionRuntimeDebugSnapshot>
  setSessionRuntimeDebugBySession: (
    update: WorkspaceStateUpdater<Record<string, SessionRuntimeDebugSnapshot>>,
  ) => void
  setSessionRuntimeDebugStateBySession: (
    update: WorkspaceStateUpdater<Record<string, SessionRuntimeDebugState>>,
  ) => void
  options?: {
    limit?: number
    turns?: number
  } & SessionDataLoadOptions
}

export async function loadSessionRuntimeDebugForSession({
  backendSessionID,
  runtimeDebugRefreshTimerRef,
  runtimeDebugRequestRef,
  sessionID,
  sessionRuntimeDebugBySession,
  setSessionRuntimeDebugBySession,
  setSessionRuntimeDebugStateBySession,
  options,
}: LoadSessionRuntimeDebugInput) {
  const getSessionRuntimeDebug = window.desktop?.getSessionRuntimeDebug
  if (!getSessionRuntimeDebug) return

  clearRuntimeDebugRefreshTimer(sessionID, runtimeDebugRefreshTimerRef)

  const requestID = (runtimeDebugRequestRef.current[sessionID] ?? 0) + 1
  runtimeDebugRequestRef.current[sessionID] = requestID
  const hasExistingSnapshot = Boolean(sessionRuntimeDebugBySession[sessionID])
  const isSilent = options?.mode === "silent"
  if (!isSilent) {
    setSessionRuntimeDebugRequestState({
      hasExistingSnapshot,
      sessionID,
      setSessionRuntimeDebugStateBySession,
    })
  }

  try {
    const nextRuntimeDebug = await getSessionRuntimeDebug({
      sessionID: backendSessionID,
      limit: options?.limit,
      turns: options?.turns,
    })
    if (runtimeDebugRequestRef.current[sessionID] !== requestID) return
    let didChangeRuntimeDebug = false

    setSessionRuntimeDebugBySession((prev) => {
      didChangeRuntimeDebug = !sessionRuntimeDebugSnapshotsAreEquivalent(prev[sessionID], nextRuntimeDebug)
      return didChangeRuntimeDebug
        ? {
            ...prev,
            [sessionID]: nextRuntimeDebug,
          }
        : prev
    })
    setSessionRuntimeDebugStateBySession((prev) => {
      const current = prev[sessionID] ?? DEFAULT_SESSION_RUNTIME_DEBUG_STATE
      const nextState: SessionRuntimeDebugState = {
        status: "ready",
        errorMessage: null,
        updatedAt: didChangeRuntimeDebug ? Date.now() : current.updatedAt,
        isStale: false,
      }
      if (
        isSilent &&
        !didChangeRuntimeDebug &&
        current.status === nextState.status &&
        current.errorMessage === nextState.errorMessage &&
        current.updatedAt === nextState.updatedAt &&
        current.isStale === nextState.isStale
      ) {
        return prev
      }
      if (
        current.status === nextState.status &&
        current.errorMessage === nextState.errorMessage &&
        current.updatedAt === nextState.updatedAt &&
        current.isStale === nextState.isStale
      ) {
        return prev
      }
      return {
        ...prev,
        [sessionID]: nextState,
      }
    })
  } catch (error) {
    if (runtimeDebugRequestRef.current[sessionID] !== requestID) return
    const message = error instanceof Error ? error.message : String(error)
    setSessionRuntimeDebugStateBySession((prev) => {
      const current = prev[sessionID] ?? DEFAULT_SESSION_RUNTIME_DEBUG_STATE
      return {
        ...prev,
        [sessionID]: {
          ...current,
          status: "error",
          errorMessage: message,
          isStale: hasExistingSnapshot || current.isStale,
        },
      }
    })
    console.error("[desktop] getSessionRuntimeDebug failed:", error)
  }
}

export function scheduleRuntimeDebugRefresh({
  backendSessionID,
  delayMs = 160,
  loadSessionRuntimeDebugForSession,
  runtimeDebugRefreshTimerRef,
  sessionID,
}: {
  backendSessionID: string
  delayMs?: number
  loadSessionRuntimeDebugForSession: (sessionID: string, backendSessionID: string, options?: SessionDataLoadOptions) => Promise<void>
  runtimeDebugRefreshTimerRef: MutableRefObject<Record<string, number>>
  sessionID: string
}) {
  if (!window.desktop?.getSessionRuntimeDebug) return

  clearRuntimeDebugRefreshTimer(sessionID, runtimeDebugRefreshTimerRef)
  runtimeDebugRefreshTimerRef.current[sessionID] = window.setTimeout(() => {
    delete runtimeDebugRefreshTimerRef.current[sessionID]
    void loadSessionRuntimeDebugForSession(sessionID, backendSessionID, { force: true, mode: "silent", reason: "stream" }).catch((error) => {
      console.error("[desktop] session runtime debug refresh failed:", error)
    })
  }, delayMs)
}

export function useOpenSessionReviewPreloadEffects({
  openSessionIDs,
  agentSessions,
  canLoadSessionHistory,
  ensurePendingPermissionRequestsLoaded,
  ensureSessionDiffLoaded,
  ensureSessionRuntimeDebugLoaded,
  ensureSessionTasksLoaded,
  isRuntimeDebugEnabled,
}: {
  openSessionIDs: string[]
  agentSessions: Record<string, string>
  canLoadSessionHistory: boolean
  ensurePendingPermissionRequestsLoaded: (sessionID: string) => Promise<void>
  ensureSessionDiffLoaded: (sessionID: string) => Promise<void>
  ensureSessionRuntimeDebugLoaded: (sessionID: string) => Promise<void>
  ensureSessionTasksLoaded: (sessionID: string) => Promise<void>
  isRuntimeDebugEnabled: boolean
}) {
  const openSessionKey = openSessionIDs.join("\u0000")

  useEffect(() => {
    if (!canLoadSessionHistory) return

    for (const sessionID of openSessionIDs) {
      void ensureSessionDiffLoaded(sessionID).catch((error) => {
        console.error("[desktop] open session diff preload failed:", error)
      })
      void ensurePendingPermissionRequestsLoaded(sessionID).catch((error) => {
        console.error("[desktop] open session permission preload failed:", error)
      })
      void ensureSessionTasksLoaded(sessionID).catch((error) => {
        console.error("[desktop] open session tasks preload failed:", error)
      })
      if (isRuntimeDebugEnabled) {
        void ensureSessionRuntimeDebugLoaded(sessionID).catch((error) => {
          console.error("[desktop] open session runtime preload failed:", error)
        })
      }
    }
  }, [openSessionKey, canLoadSessionHistory, agentSessions, isRuntimeDebugEnabled])
}

export function useReviewRefreshCleanupEffect({
  clearRuntimeDebugRefreshTimer,
  clearSessionDiffRefreshTimer,
  runtimeDebugRefreshTimerRef,
  sessionDiffRefreshTimerRef,
}: {
  clearRuntimeDebugRefreshTimer: (sessionID: string) => void
  clearSessionDiffRefreshTimer: (sessionID: string) => void
  runtimeDebugRefreshTimerRef: MutableRefObject<Record<string, number>>
  sessionDiffRefreshTimerRef: MutableRefObject<Record<string, number>>
}) {
  useEffect(() => {
    return () => {
      for (const sessionID of Object.keys(sessionDiffRefreshTimerRef.current)) {
        clearSessionDiffRefreshTimer(sessionID)
      }
      for (const sessionID of Object.keys(runtimeDebugRefreshTimerRef.current)) {
        clearRuntimeDebugRefreshTimer(sessionID)
      }
    }
  }, [])
}

export function useWorkspaceFileReviewScopeEffects({
  activeWorkspaceFileScopeDirectory,
  platform,
  setWorkspaceFileReviewState,
  workspaceFileReadRequestRef,
  workspaceFileSearchRequestRef,
}: {
  activeWorkspaceFileScopeDirectory: string | null
  platform: string
  setWorkspaceFileReviewState: (update: WorkspaceStateUpdater<WorkspaceFileReviewState>) => void
  workspaceFileReadRequestRef: MutableRefObject<number>
  workspaceFileSearchRequestRef: MutableRefObject<number>
}) {
  useEffect(() => {
    const nextScopeKey = activeWorkspaceFileScopeDirectory
      ? normalizeWorkspacePath(activeWorkspaceFileScopeDirectory, platform)
      : null

    setWorkspaceFileReviewState((current) => {
      const currentScopeKey = current.scopeDirectory ? normalizeWorkspacePath(current.scopeDirectory, platform) : null
      if (currentScopeKey === nextScopeKey) return current

      workspaceFileSearchRequestRef.current += 1
      workspaceFileReadRequestRef.current += 1
      return {
        ...DEFAULT_WORKSPACE_FILE_REVIEW_STATE,
        scopeDirectory: activeWorkspaceFileScopeDirectory,
      }
    })
  }, [activeWorkspaceFileScopeDirectory, platform])

}
