import type { LoadedFolderWorkspace, LoadedSessionSnapshot, SessionModelSelection, SessionSummary, WorkspaceGroup } from "./types"

export function isWorkspaceAvailable(workspace: Pick<WorkspaceGroup, "exists"> | null | undefined) {
  return workspace?.exists !== false
}

export function isGitWorkspaceProject(workspace: Pick<WorkspaceGroup, "project"> | null | undefined) {
  return workspace?.project.kind === "git" || workspace?.project.vcs === "git"
}

export function isSideChatSession(session: Pick<SessionSummary, "kind"> | null | undefined) {
  return session?.kind === "side-chat"
}

export function normalizeWorkspaceDirectoryKey(value: string) {
  return value.trim().replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase()
}

export function sameWorkspaceDirectory(left: string, right: string) {
  const normalizedLeft = normalizeWorkspaceDirectoryKey(left)
  const normalizedRight = normalizeWorkspaceDirectoryKey(right)
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight)
}

export function normalizeSessionModelSelection(
  selection?: { model?: string | null; small_model?: string | null; reasoning_effort?: SessionModelSelection["reasoning_effort"] | null } | null,
): SessionModelSelection | undefined {
  const model = selection?.model?.trim()
  const smallModel = selection?.small_model?.trim()
  const reasoningEffort = selection?.reasoning_effort ?? undefined
  if (!model && !smallModel && !reasoningEffort) return undefined

  return {
    ...(model ? { model } : {}),
    ...(smallModel ? { small_model: smallModel } : {}),
    ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
  }
}

export function updateSessionModelSelectionInWorkspaces(
  workspaces: WorkspaceGroup[],
  sessionID: string,
  selection?: { model?: string | null; small_model?: string | null } | null,
) {
  const nextSelection = normalizeSessionModelSelection(selection)

  return workspaces.map((workspace) => ({
    ...workspace,
    sessions: workspace.sessions.map((session) => {
      if (session.id !== sessionID) return session

      if (!nextSelection) {
        return {
          ...session,
          modelSelection: undefined,
        }
      }

      return {
        ...session,
        modelSelection: nextSelection,
      }
    }),
  }))
}

export function updateSessionInWorkspaces(
  workspaces: WorkspaceGroup[],
  sessionID: string,
  updater: (session: SessionSummary) => SessionSummary,
) {
  return workspaces.map((workspace) => ({
    ...workspace,
    sessions: workspace.sessions.map((session) => (session.id === sessionID ? updater(session) : session)),
  }))
}

export function getPrimaryWorkspaceSessions<T extends Pick<SessionSummary, "kind">>(sessions: T[]) {
  return sessions.filter((session) => !isSideChatSession(session))
}

function getPreferredWorkspaces(workspaces: WorkspaceGroup[]) {
  const available = workspaces.filter((workspace) => isWorkspaceAvailable(workspace))
  return available.length > 0 ? available : workspaces
}

export function sortWorkspaceGroups(input: WorkspaceGroup[], pinnedWorkspaceIDs: string[] = []) {
  const getWorkspaceUpdated = (workspace: WorkspaceGroup) => workspace.sessions[0]?.updated ?? workspace.updated
  const pinnedRankByID = new Map(pinnedWorkspaceIDs.map((workspaceID, index) => [workspaceID, index]))

  return [...input].sort((left, right) => {
    const leftPinnedRank = pinnedRankByID.get(left.id)
    const rightPinnedRank = pinnedRankByID.get(right.id)
    if (leftPinnedRank !== undefined || rightPinnedRank !== undefined) {
      if (leftPinnedRank === undefined) return 1
      if (rightPinnedRank === undefined) return -1
      return leftPinnedRank - rightPinnedRank
    }

    const leftUpdated = getWorkspaceUpdated(left)
    const rightUpdated = getWorkspaceUpdated(right)
    return rightUpdated - leftUpdated
  })
}

export function sortWorkspaceSessions<T extends Pick<SessionSummary, "pinned" | "updated">>(sessions: T[]) {
  return [...sessions].sort((left, right) => {
    const pinnedDelta = Number(Boolean(right.pinned)) - Number(Boolean(left.pinned))
    return pinnedDelta || right.updated - left.updated
  })
}

export function mapLoadedSession(session: LoadedSessionSnapshot, sessionIndex: number): SessionSummary {
  const sideChat = isSideChatSession(session)
  return {
    id: session.id,
    title: session.title.trim() || `Session ${sessionIndex + 1}`,
    pinned: session.pinned,
    worktreeID: session.worktreeID,
    branch: session.directory,
    status: "Ready",
    created: session.created,
    updated: session.updated,
    focus: sideChat ? "Side chat" : "Backend",
    summary: sideChat
      ? session.origin?.anchorPreview || "Read-only side chat"
      : `Loaded from ${session.directory}`,
    kind: session.kind,
    policy: session.policy,
    automation: session.automation,
    origin: session.origin,
    subagent: session.subagent,
    workflow: session.workflow,
    modelSelection: session.modelSelection,
  }
}

export function mapLoadedWorkspace(workspace: LoadedFolderWorkspace): WorkspaceGroup {
  return {
    id: workspace.id,
    name: workspace.name.trim() || workspace.directory,
    directory: workspace.directory,
    exists: workspace.exists !== false,
    created: workspace.created,
    updated: workspace.updated,
    project: workspace.project,
    sessions: sortWorkspaceSessions(workspace.sessions).map(mapLoadedSession),
  }
}

export function mapLoadedWorkspaces(input: LoadedFolderWorkspace[]) {
  return sortWorkspaceGroups(
    [...input]
      .sort((left, right) => {
        const leftUpdated = left.sessions[0]?.updated ?? left.updated
        const rightUpdated = right.sessions[0]?.updated ?? right.updated
        return rightUpdated - leftUpdated
      })
      .map(mapLoadedWorkspace),
  )
}

export function upsertWorkspaceGroup(existing: WorkspaceGroup[], nextWorkspace: WorkspaceGroup) {
  const withoutCurrent = existing.filter((workspace) => workspace.id !== nextWorkspace.id)
  return sortWorkspaceGroups([...withoutCurrent, nextWorkspace])
}

export function upsertSessionInWorkspace(existing: WorkspaceGroup[], workspaceID: string, nextSession: SessionSummary) {
  return sortWorkspaceGroups(
    existing.map((workspace) =>
      workspace.id === workspaceID
        ? {
            ...workspace,
            updated: Math.max(workspace.updated, nextSession.updated),
            sessions: sortWorkspaceSessions([
              nextSession,
              ...workspace.sessions.filter((session) => session.id !== nextSession.id),
            ]),
          }
        : workspace,
    ),
  )
}

export function findFirstSession(workspaces: WorkspaceGroup[]) {
  for (const workspace of getPreferredWorkspaces(workspaces)) {
    const [session] = getPrimaryWorkspaceSessions(workspace.sessions)
    if (session) {
      return {
        workspace,
        session,
      }
    }
  }

  const preferredWorkspaces = getPreferredWorkspaces(workspaces)

  return {
    workspace: preferredWorkspaces[0] ?? null,
    session: null,
  }
}

export function findSession(workspaces: WorkspaceGroup[], sessionID: string | null) {
  if (!sessionID) {
    return {
      workspace: null,
      session: null,
    }
  }

  for (const workspace of workspaces) {
    const session = workspace.sessions.find((item) => item.id === sessionID)
    if (session) return { workspace, session }
  }

  return {
    workspace: null,
    session: null,
  }
}

export function findWorkspaceByID(workspaces: WorkspaceGroup[], workspaceID: string | null) {
  if (!workspaceID) return null
  return workspaces.find((workspace) => workspace.id === workspaceID) ?? null
}

export function selectAfterSessionDelete(
  workspaces: WorkspaceGroup[],
  workspaceID: string,
  deletedSessionID: string,
  activeSessionID: string | null,
) {
  if (activeSessionID && activeSessionID !== deletedSessionID) {
    const currentSelection = findSession(workspaces, activeSessionID)
    if (currentSelection.session) {
      return currentSelection
    }
  }

  const sameWorkspace = workspaces.find((workspace) => workspace.id === workspaceID) ?? null
  if (sameWorkspace) {
    const [session] = getPrimaryWorkspaceSessions(sameWorkspace.sessions)
    return {
      workspace: sameWorkspace,
      session: session ?? null,
    }
  }

  return findFirstSession(workspaces)
}
