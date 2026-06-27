import { useEffect, type MutableRefObject } from "react"
import type { SerializedDockview } from "dockview-react"
import {
  ensureAgentSessions,
  ensureConversationSessions,
} from "../conversation-state"
import { notifyGitStateChanged } from "../git-events"
import type {
  CreateSessionTab,
  LoadedFolderWorkspace,
  SessionDiffState,
  ThreadMessage,
  WorkbenchTabReference,
  MobileBridgeEvent,
  WorkspaceFileChangeIPCEvent,
  WorkspaceGroup,
} from "../types"
import {
  createInitialDockviewLayout,
  getActiveDockviewPanelReference,
  normalizeDockviewLayout,
  readPersistedDockviewLayout,
} from "../workbench/dockview-state"
import {
  findFirstSession,
  isWorkspaceAvailable,
  mapLoadedWorkspace,
  mapLoadedWorkspaces,
  sortWorkspaceGroups,
  upsertWorkspaceGroup,
} from "../workspace"
import { DEFAULT_SESSION_DIFF_STATE } from "./review-preview-state"
import {
  buildDockviewPanelTitles,
  buildValidDockviewReferences,
  resolveWorkspaceIDForDockviewReference,
} from "./dockview-workspace"
import { seedWorkspaceIDs, type WorkspaceStateUpdater } from "./workspace-store"

const GIT_REFRESH_SUPPRESSION_MS = 1000
const WORKSPACE_RELOAD_SUPPRESSION_MS = 1500

export function collectSessionDirectoryMap(
  workspaces: Array<{
    sessions: Array<{
      id: string
      directory: string
    }>
  }>,
) {
  return Object.fromEntries(
    workspaces.flatMap((workspace) =>
      workspace.sessions.map((session) => [session.id, session.directory] as const),
    ),
  )
}

export function normalizeWorkspacePath(value: string, platform: string) {
  const normalized = value.trim().replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "")
  return platform === "win32" ? normalized.toLowerCase() : normalized
}

export function resolveWorkspaceRelativePath(directory: string, target: string, platform: string) {
  const normalizedDirectory = normalizeWorkspacePath(directory, platform)
  const normalizedTarget = normalizeWorkspacePath(target, platform)
  if (!normalizedDirectory || !normalizedTarget) return null
  if (normalizedTarget === normalizedDirectory) return ""
  const prefix = `${normalizedDirectory}/`
  if (!normalizedTarget.startsWith(prefix)) return null
  return normalizedTarget.slice(prefix.length)
}

function shouldReloadWorkspaceFromRelativePath(relativePath: string) {
  return relativePath === ".git" || relativePath === ".git/config"
}

function isGitInternalRelativePath(relativePath: string) {
  return relativePath === ".git" || relativePath.startsWith(".git/")
}

export function shouldRefreshWorkspaceDiffFromRelativePaths(relativePaths: string[]) {
  if (relativePaths.length === 0) return true
  return relativePaths.some((relativePath) => !isGitInternalRelativePath(relativePath))
}

interface RefreshWorkspaceFromDirectoryInput {
  directory: string
  setAgentSessions: (update: (current: Record<string, string>) => Record<string, string>) => void
  setCanLoadSessionHistory: (update: boolean) => void
  setConversations: (update: (current: Record<string, ThreadMessage[]>) => Record<string, ThreadMessage[]>) => void
  setSessionDirectoryBySession: (update: (current: Record<string, string>) => Record<string, string>) => void
  setWorkspaces: (update: (current: WorkspaceGroup[]) => WorkspaceGroup[]) => void
  workspaceRefreshRequestRef: MutableRefObject<Record<string, number>>
}

export async function refreshWorkspaceFromDirectory({
  directory,
  setAgentSessions,
  setCanLoadSessionHistory,
  setConversations,
  setSessionDirectoryBySession,
  setWorkspaces,
  workspaceRefreshRequestRef,
}: RefreshWorkspaceFromDirectoryInput) {
  const openFolderWorkspace = window.desktop?.openFolderWorkspace
  const trimmedDirectory = directory.trim()
  if (!trimmedDirectory || !openFolderWorkspace) return null

  const requestID = (workspaceRefreshRequestRef.current[trimmedDirectory] ?? 0) + 1
  workspaceRefreshRequestRef.current[trimmedDirectory] = requestID

  try {
    const loadedWorkspace = await openFolderWorkspace({ directory: trimmedDirectory })
    if (!loadedWorkspace) return null
    if (workspaceRefreshRequestRef.current[trimmedDirectory] !== requestID) return null

    const nextWorkspace = mapLoadedWorkspace(loadedWorkspace)
    const loadedSessionIDs = loadedWorkspace.sessions.map((session) => session.id)
    setWorkspaces((prev) => upsertWorkspaceGroup(prev, nextWorkspace))
    setConversations((prev) => ensureConversationSessions(prev, loadedSessionIDs))
    setAgentSessions((prev) => ensureAgentSessions(prev, loadedSessionIDs))
    setSessionDirectoryBySession((prev) => ({
      ...prev,
      ...collectSessionDirectoryMap([loadedWorkspace]),
    }))
    setCanLoadSessionHistory(true)

    return nextWorkspace
  } catch (error) {
    if (workspaceRefreshRequestRef.current[trimmedDirectory] === requestID) {
      console.error("[desktop] workspace refresh failed:", error)
    }
    return null
  }
}

interface UseWorkspaceFileChangeEffectsOptions {
  activeSessionDirectory: string | null
  activeSessionID: string | null
  gitRefreshSuppressedUntilRef: MutableRefObject<Record<string, number>>
  platform: string
  refreshWorkspaceFromDirectory: (directory: string) => void | Promise<WorkspaceGroup | null>
  scheduleSessionDiffRefreshForSession: (sessionID: string) => void
  setSessionDiffStateBySession: (
    update: WorkspaceStateUpdater<Record<string, SessionDiffState>>,
  ) => void
  workspaces: WorkspaceGroup[]
  workspaceReloadSuppressedUntilRef: MutableRefObject<Record<string, number>>
  workspaceEvent: WorkspaceFileChangeIPCEvent
}

export function handleWorkspaceFileChange({
  activeSessionDirectory,
  activeSessionID,
  gitRefreshSuppressedUntilRef,
  platform,
  refreshWorkspaceFromDirectory,
  scheduleSessionDiffRefreshForSession,
  setSessionDiffStateBySession,
  workspaces,
  workspaceEvent,
  workspaceReloadSuppressedUntilRef,
}: UseWorkspaceFileChangeEffectsOptions) {
  const normalizedEventDirectory = normalizeWorkspacePath(workspaceEvent.directory, platform)
  const normalizedActiveSessionDirectory = activeSessionDirectory
    ? normalizeWorkspacePath(activeSessionDirectory, platform)
    : null
  const now = Date.now()

  if (activeSessionID && normalizedActiveSessionDirectory === normalizedEventDirectory) {
    const activeRelativePaths = workspaceEvent.paths
      .map((changedPath) =>
        resolveWorkspaceRelativePath(activeSessionDirectory ?? workspaceEvent.directory, changedPath, platform),
      )
      .filter((value): value is string => value !== null)

    if (shouldRefreshWorkspaceDiffFromRelativePaths(activeRelativePaths)) {
      setSessionDiffStateBySession((prev) => {
        const current = prev[activeSessionID] ?? DEFAULT_SESSION_DIFF_STATE
        return {
          ...prev,
          [activeSessionID]: {
            ...current,
            isStale: true,
          },
        }
      })
      scheduleSessionDiffRefreshForSession(activeSessionID)
    }
  }

  const matchingWorkspace = workspaces.find(
    (workspace) => normalizeWorkspacePath(workspace.directory, platform) === normalizedEventDirectory,
  )
  if (!matchingWorkspace) return

  const relativePaths = workspaceEvent.paths
    .map((changedPath) => resolveWorkspaceRelativePath(matchingWorkspace.directory, changedPath, platform))
    .filter((value): value is string => value !== null)
  const requiresWorkspaceReload = relativePaths.some(shouldReloadWorkspaceFromRelativePath)

  if (now >= (gitRefreshSuppressedUntilRef.current[normalizedEventDirectory] ?? 0)) {
    gitRefreshSuppressedUntilRef.current[normalizedEventDirectory] = now + GIT_REFRESH_SUPPRESSION_MS
    notifyGitStateChanged({
      directory: matchingWorkspace.directory,
    })
  }

  if (!requiresWorkspaceReload) return
  if (now < (workspaceReloadSuppressedUntilRef.current[normalizedEventDirectory] ?? 0)) return

  workspaceReloadSuppressedUntilRef.current[normalizedEventDirectory] = now + WORKSPACE_RELOAD_SUPPRESSION_MS
  void refreshWorkspaceFromDirectory(matchingWorkspace.directory)
}

interface HandleMobileBridgeEventOptions {
  mobileEvent: MobileBridgeEvent
  platform: string
  refreshWorkspaceFromDirectory: (directory: string) => void | Promise<WorkspaceGroup | null>
  workspaces: WorkspaceGroup[]
}

export function resolveMobileBridgeEventWorkspaceDirectory({
  mobileEvent,
  platform,
  workspaces,
}: Omit<HandleMobileBridgeEventOptions, "refreshWorkspaceFromDirectory">) {
  const explicitDirectory = mobileEvent.directory?.trim()
  if (explicitDirectory) return explicitDirectory

  if (mobileEvent.workspaceID?.trim()) {
    const normalizedWorkspaceID = normalizeWorkspacePath(mobileEvent.workspaceID, platform)
    const matchingWorkspace = workspaces.find((workspace) =>
      normalizeWorkspacePath(workspace.id, platform) === normalizedWorkspaceID ||
      normalizeWorkspacePath(workspace.directory, platform) === normalizedWorkspaceID
    )
    if (matchingWorkspace) return matchingWorkspace.directory
  }

  if (mobileEvent.sessionID?.trim()) {
    const matchingWorkspace = workspaces.find((workspace) =>
      workspace.sessions.some((session) => session.id === mobileEvent.sessionID),
    )
    if (matchingWorkspace) return matchingWorkspace.directory
  }

  return null
}

export function handleMobileBridgeEvent({
  mobileEvent,
  platform,
  refreshWorkspaceFromDirectory,
  workspaces,
}: HandleMobileBridgeEventOptions) {
  const directory = resolveMobileBridgeEventWorkspaceDirectory({
    mobileEvent,
    platform,
    workspaces,
  })
  if (!directory) return

  void refreshWorkspaceFromDirectory(directory)
}

export function useMobileBridgeEventSubscription(
  handler: (mobileEvent: MobileBridgeEvent) => void,
) {
  useEffect(() => {
    const unsubscribe = window.desktop?.onMobileBridgeEvent?.((mobileEvent: MobileBridgeEvent) => {
      handler(mobileEvent)
    })

    return () => {
      unsubscribe?.()
    }
  }, [])
}

export function useWorkspaceFileChangeSubscription(
  handler: (workspaceEvent: WorkspaceFileChangeIPCEvent) => void,
) {
  useEffect(() => {
    const unsubscribe = window.desktop?.onWorkspaceFileChange?.((workspaceEvent: WorkspaceFileChangeIPCEvent) => {
      handler(workspaceEvent)
    })

    return () => {
      unsubscribe?.()
    }
  }, [])
}

interface UseWorkspaceWatchDirectoriesEffectOptions {
  activeSessionDirectory: string | null
  activeWorkspace: WorkspaceGroup | null
  isInitialWorkspaceLoadPending: boolean
  platform: string
  watchedWorkspaceDirectoriesKeyRef: MutableRefObject<string>
  workspaces: WorkspaceGroup[]
}

export function useWorkspaceWatchDirectoriesEffect({
  activeSessionDirectory,
  activeWorkspace,
  isInitialWorkspaceLoadPending,
  platform,
  watchedWorkspaceDirectoriesKeyRef,
  workspaces,
}: UseWorkspaceWatchDirectoriesEffectOptions) {
  useEffect(() => {
    const updateWorkspaceWatchDirectories = window.desktop?.updateWorkspaceWatchDirectories
    if (!updateWorkspaceWatchDirectories) return

    const activeWorkspaceID = activeWorkspace?.id ?? null
    const shouldWatchActiveSessionDirectory =
      Boolean(activeSessionDirectory?.trim()) &&
      activeWorkspaceID !== null &&
      isWorkspaceAvailable(activeWorkspace) &&
      !(isInitialWorkspaceLoadPending && seedWorkspaceIDs.has(activeWorkspaceID))
    const uniqueDirectories = [
      ...new Set(
        [
          ...workspaces
            .filter((workspace) => !seedWorkspaceIDs.has(workspace.id) && isWorkspaceAvailable(workspace))
            .map((workspace) => workspace.directory.trim()),
          shouldWatchActiveSessionDirectory ? activeSessionDirectory?.trim() ?? "" : "",
        ].filter(Boolean),
      ),
    ]
    const normalizedKey = uniqueDirectories
      .map((directory) =>
        platform === "win32" ? directory.replace(/\//g, "\\").toLowerCase() : directory.replace(/\\/g, "/"),
      )
      .sort()
      .join("\n")

    if (normalizedKey === watchedWorkspaceDirectoriesKeyRef.current) return
    watchedWorkspaceDirectoriesKeyRef.current = normalizedKey

    void updateWorkspaceWatchDirectories({
      directories: uniqueDirectories,
    }).catch((error) => {
      console.error("[desktop] updateWorkspaceWatchDirectories failed:", error)
    })
  }, [activeSessionDirectory, activeWorkspace, isInitialWorkspaceLoadPending, platform, workspaces])
}

interface UseInitialFolderWorkspacesEffectOptions {
  createCreateSessionTab: (workspaceID: string | null) => CreateSessionTab
  createCreateSessionWorkbenchTab: (createSessionTabID: string) => WorkbenchTabReference
  createSessionWorkbenchTab: (sessionID: string) => WorkbenchTabReference
  initialDockviewLayout?: SerializedDockview | null
  initialFolderWorkspacesLoadedRef: MutableRefObject<boolean>
  initialSessionID?: string | null
  lastFocusedSessionIDRef: MutableRefObject<string | null>
  preserveLocalWorkspaceStateOnInitialLoadRef: MutableRefObject<boolean>
  setAgentSessions: (update: (current: Record<string, string>) => Record<string, string>) => void
  setCanLoadSessionHistory: (update: boolean) => void
  setConversations: (update: (current: Record<string, ThreadMessage[]>) => Record<string, ThreadMessage[]>) => void
  setCreateSessionTabs: (update: CreateSessionTab[]) => void
  setExpandedFolderIDs: (update: string[]) => void
  setIsInitialWorkspaceLoadPending: (update: boolean) => void
  setSelectedFolderID: (update: string | null) => void
  setSessionDirectoryBySession: (update: (current: Record<string, string>) => Record<string, string>) => void
  setDockviewLayout: (update: SerializedDockview | null) => void
  setWorkspaces: (update: (current: WorkspaceGroup[]) => WorkspaceGroup[]) => void
}

export function useInitialFolderWorkspacesEffect({
  createCreateSessionTab,
  createCreateSessionWorkbenchTab,
  createSessionWorkbenchTab,
  initialDockviewLayout,
  initialFolderWorkspacesLoadedRef,
  initialSessionID,
  lastFocusedSessionIDRef,
  preserveLocalWorkspaceStateOnInitialLoadRef,
  setAgentSessions,
  setCanLoadSessionHistory,
  setConversations,
  setCreateSessionTabs,
  setExpandedFolderIDs,
  setIsInitialWorkspaceLoadPending,
  setSelectedFolderID,
  setSessionDirectoryBySession,
  setDockviewLayout,
  setWorkspaces,
}: UseInitialFolderWorkspacesEffectOptions) {
  useEffect(() => {
    let mounted = true

    const listFolderWorkspaces = window.desktop?.listFolderWorkspaces
    if (!listFolderWorkspaces) {
      return () => {
        mounted = false
      }
    }

    listFolderWorkspaces()
      .then((loadedWorkspaces: LoadedFolderWorkspace[]) => {
        if (!mounted) return

        const nextWorkspaces = mapLoadedWorkspaces(loadedWorkspaces)
        const loadedSessionIDs = loadedWorkspaces.flatMap((workspace) => workspace.sessions.map((session) => session.id))
        const preserveLocalWorkspaceState = preserveLocalWorkspaceStateOnInitialLoadRef.current
        setWorkspaces((current) => {
          if (!preserveLocalWorkspaceState) {
            return nextWorkspaces
          }

          const loadedWorkspaceIDs = new Set(nextWorkspaces.map((workspace) => workspace.id))
          const preservedWorkspaces = current.filter(
            (workspace) => !loadedWorkspaceIDs.has(workspace.id) && !seedWorkspaceIDs.has(workspace.id),
          )

          return sortWorkspaceGroups([...nextWorkspaces, ...preservedWorkspaces])
        })
        setConversations((prev) => ensureConversationSessions(prev, loadedSessionIDs))
        setAgentSessions((prev) => ensureAgentSessions(prev, loadedSessionIDs))
        setSessionDirectoryBySession((prev) => ({
          ...prev,
          ...collectSessionDirectoryMap(loadedWorkspaces),
        }))

        if (!preserveLocalWorkspaceState) {
          const initialSessionSelection = initialSessionID
            ? nextWorkspaces.reduce<{
                sessionID: string
                title: string
                workspaceID: string
              } | null>((match, workspace) => {
                if (match) return match
                const session = workspace.sessions.find((item) => item.id === initialSessionID)
                return session
                  ? {
                      sessionID: session.id,
                      title: session.title,
                      workspaceID: workspace.id,
                    }
                  : null
              }, null)
            : null
          const initialSurfaceLayout = initialDockviewLayout
            ? normalizeDockviewLayout(
                initialDockviewLayout,
                buildValidDockviewReferences(nextWorkspaces, []),
                buildDockviewPanelTitles(nextWorkspaces, []),
              )
            : null
          const restoredDockviewLayout = initialSessionSelection || initialSurfaceLayout
            ? null
            : normalizeDockviewLayout(
                readPersistedDockviewLayout(),
                buildValidDockviewReferences(nextWorkspaces, []),
                buildDockviewPanelTitles(nextWorkspaces, []),
              )

          if (initialSurfaceLayout) {
            const initialSurfaceReference = getActiveDockviewPanelReference(initialSurfaceLayout)
            const initialSurfaceFolderID =
              resolveWorkspaceIDForDockviewReference(initialSurfaceReference, nextWorkspaces, []) ??
              nextWorkspaces[0]?.id ??
              null
            setSelectedFolderID(initialSurfaceFolderID)
            setExpandedFolderIDs(initialSurfaceFolderID ? [initialSurfaceFolderID] : [])
            setCreateSessionTabs([])
            setDockviewLayout(initialSurfaceLayout)
            lastFocusedSessionIDRef.current = initialSurfaceReference?.kind === "session" ? initialSurfaceReference.sessionID : null
          } else if (initialSessionSelection) {
            const initialReference = createSessionWorkbenchTab(initialSessionSelection.sessionID)
            setSelectedFolderID(initialSessionSelection.workspaceID)
            setExpandedFolderIDs([initialSessionSelection.workspaceID])
            setCreateSessionTabs([])
            setDockviewLayout(createInitialDockviewLayout(initialReference, initialSessionSelection.title))
            lastFocusedSessionIDRef.current = initialSessionSelection.sessionID
          } else if (restoredDockviewLayout) {
            const restoredReference = getActiveDockviewPanelReference(restoredDockviewLayout)
            const restoredFolderID =
              resolveWorkspaceIDForDockviewReference(restoredReference, nextWorkspaces, []) ??
              nextWorkspaces[0]?.id ??
              null
            setSelectedFolderID(restoredFolderID)
            setExpandedFolderIDs(restoredFolderID ? [restoredFolderID] : [])
            setCreateSessionTabs([])
            setDockviewLayout(restoredDockviewLayout)
            lastFocusedSessionIDRef.current = restoredReference?.kind === "session" ? restoredReference.sessionID : null
          } else {
            const nextSelection = findFirstSession(nextWorkspaces)
            const nextFolderID = nextSelection.workspace?.id ?? nextWorkspaces[0]?.id ?? null
            const nextCreateSessionTab = nextSelection.session === null ? createCreateSessionTab(nextFolderID) : null
            const nextInitialTab =
              nextSelection.session !== null
                ? createSessionWorkbenchTab(nextSelection.session.id)
                : nextCreateSessionTab
                  ? createCreateSessionWorkbenchTab(nextCreateSessionTab.id)
                  : null
            setSelectedFolderID(nextFolderID)
            setExpandedFolderIDs(nextFolderID ? [nextFolderID] : [])
            setCreateSessionTabs(nextCreateSessionTab ? [nextCreateSessionTab] : [])
            setDockviewLayout(nextInitialTab ? createInitialDockviewLayout(nextInitialTab) : null)
            lastFocusedSessionIDRef.current = nextSelection.session?.id ?? null
          }
        }

        setCanLoadSessionHistory(true)
        initialFolderWorkspacesLoadedRef.current = true
        setIsInitialWorkspaceLoadPending(false)
      })
      .catch(() => {
        setIsInitialWorkspaceLoadPending(false)
      })

    return () => {
      mounted = false
    }
  }, [])
}
