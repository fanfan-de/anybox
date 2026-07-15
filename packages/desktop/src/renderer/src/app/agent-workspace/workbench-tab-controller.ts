import { useEffect, type MutableRefObject } from "react"
import type { SerializedDockview } from "dockview-react"
import type { CreateSessionTab, WorkspaceGroup } from "../types"
import type { WorkbenchSharedState } from "../../../../shared/desktop-ipc-contract"
import {
  createInitialDockviewLayout,
  createDockviewActiveStateWithFocusedGroup,
  findDockviewGroupForPanel,
  getActiveDockviewPanelIDFromState,
  getActiveDockviewPanelReferenceFromState,
  getActivePanelForGroupFromState,
  getDockviewPanelIDs,
  getFocusedDockviewGroupIDFromState,
  getWorkbenchDockPanelReference,
  getWorkbenchDockPanelId,
  normalizeDockviewActiveState,
  normalizeDockviewLayout,
  type WorkbenchDockviewCommands,
  type WorkbenchDockviewActiveChange,
  type WorkbenchDockviewActiveState,
  type WorkbenchDockPanelReference,
} from "../workbench/dockview-state"
import { findSession } from "../workspace"
import {
  buildDockviewPanelTitles,
  buildValidDockviewReferences,
  getCreateSessionTitle,
  resolveWorkspaceIDForDockviewReference,
} from "./dockview-workspace"
import {
  createCreateSessionTab,
  createCreateSessionWorkbenchTab,
  createSessionWorkbenchTab,
  resolveCreateSessionWorkspaceID,
} from "./workspace-derived-state"
import { ensureExpandedFolderID, filterExpandedFolderIDs, type WorkspaceStateUpdater } from "./workspace-store"

type StateSetter<T> = (update: WorkspaceStateUpdater<T>) => void

interface UseWorkbenchTabControllerOptions {
  activeCreateSessionTab: CreateSessionTab | null
  activeCreateSessionTabID: string | null
  activeSessionID: string | null
  activeWorkspace: WorkspaceGroup | null
  createSessionTabs: CreateSessionTab[]
  dockviewActiveState: WorkbenchDockviewActiveState
  dockviewLayout: SerializedDockview | null
  focusedPane: { id: string } | null
  focusedPaneID: string | null
  isCreateSessionTabActive: boolean
  lastFocusedSessionIDRef: MutableRefObject<string | null>
  projectRowRefs: MutableRefObject<Record<string, HTMLButtonElement | null>>
  selectedFolderID: string | null
  setCreateSessionTabs: StateSetter<CreateSessionTab[]>
  setDockviewActiveState: StateSetter<WorkbenchDockviewActiveState>
  setDockviewLayout: StateSetter<SerializedDockview | null>
  setExpandedFolderIDs: StateSetter<string[]>
  setSelectedFolderID: StateSetter<string | null>
  surfaceID: string
  workbenchDockviewCommandsRef: MutableRefObject<WorkbenchDockviewCommands | null>
  workbenchState: WorkbenchSharedState | null
  workspaces: WorkspaceGroup[]
}

export function useWorkbenchTabController({
  activeCreateSessionTab,
  activeCreateSessionTabID,
  activeWorkspace,
  createSessionTabs,
  dockviewActiveState,
  dockviewLayout,
  focusedPane,
  focusedPaneID,
  isCreateSessionTabActive,
  lastFocusedSessionIDRef,
  projectRowRefs,
  selectedFolderID,
  setCreateSessionTabs,
  setDockviewActiveState,
  setDockviewLayout,
  setExpandedFolderIDs,
  setSelectedFolderID,
  surfaceID,
  workbenchDockviewCommandsRef,
  workbenchState,
  workspaces,
}: UseWorkbenchTabControllerOptions) {
  function resolveTargetGroupID(preferredPaneID?: string | null) {
    return preferredPaneID ?? focusedPaneID ?? focusedPane?.id ?? getFocusedDockviewGroupIDFromState(dockviewLayout, dockviewActiveState)
  }

  function resolvePanelTitle(reference: WorkbenchDockPanelReference) {
    if (reference.kind === "session") {
      return findSession(workspaces, reference.sessionID).session?.title ?? "Session"
    }

    return getCreateSessionTitle(
      createSessionTabs.find((tab) => tab.id === reference.createSessionTabID),
      workspaces,
    )
  }

  function setActiveDockviewReference(reference: WorkbenchDockPanelReference, preferredPaneID?: string | null) {
    const panelID = getWorkbenchDockPanelId(reference)
    const groupID =
      findDockviewGroupForPanel(dockviewLayout, panelID)?.id ??
      preferredPaneID ??
      resolveTargetGroupID()
    if (!groupID) return

    const activeState = normalizeDockviewActiveState(dockviewLayout, dockviewActiveState)
    setDockviewActiveState({
      activeGroupID: groupID,
      activePanelIDByGroupID: {
        ...activeState.activePanelIDByGroupID,
        [groupID]: panelID,
      },
    })
  }

  function getRemotePanelOwnership(reference: WorkbenchDockPanelReference) {
    if (reference.kind !== "session") return null

    const panelID = getWorkbenchDockPanelId(reference)
    const ownership = workbenchState?.ownership.find((item) => item.panelID === panelID) ?? null
    const ownerSurfaceID = ownership?.ownerSurfaceID ?? ownership?.ownerWindowID ?? null
    if (!ownership || !ownerSurfaceID || ownerSurfaceID === surfaceID) return null
    return ownership
  }

  function openLocalPanel(reference: WorkbenchDockPanelReference, paneID: string | null | undefined, title: string) {
    const targetGroupID = resolveTargetGroupID(paneID)
    const didOpen = Boolean(workbenchDockviewCommandsRef.current?.openPanel(reference, {
      targetGroupID,
      title,
    }))
    if (didOpen) {
      setActiveDockviewReference(reference, targetGroupID)
    }
    return didOpen
  }

  function openOrFocusPanel(reference: WorkbenchDockPanelReference, paneID?: string | null) {
    const commands = workbenchDockviewCommandsRef.current
    const title = resolvePanelTitle(reference)
    if (commands?.focusPanel(reference)) {
      setActiveDockviewReference(reference, paneID)
      return true
    }

    const remoteOwnership = getRemotePanelOwnership(reference)
    const focusRemotePanel = window.desktop?.focusWorkbenchPanel
    if (remoteOwnership && focusRemotePanel) {
      const panelID = getWorkbenchDockPanelId(reference)
      void focusRemotePanel({ panelID }).then((result) => {
        if (result.ok) return
        openLocalPanel(reference, paneID, title)
      }).catch((error) => {
        console.error("[desktop] Failed to focus remote workbench panel:", error)
        openLocalPanel(reference, paneID, title)
      })
      return true
    }

    return openLocalPanel(reference, paneID, title)
  }

  function setFocusedPaneID(nextPaneID: string | null) {
    const activeReference = getActiveDockviewPanelReferenceFromState(
      dockviewLayout,
      dockviewActiveState,
      nextPaneID ?? undefined,
    )
    if (activeReference) {
      workbenchDockviewCommandsRef.current?.focusPanel(activeReference)
    }
  }

  function activateSessionTab(workspaceID: string, sessionID: string, paneID: string | null = resolveTargetGroupID()) {
    lastFocusedSessionIDRef.current = sessionID
    setSelectedFolderID(workspaceID)
    setExpandedFolderIDs((current) => ensureExpandedFolderID(current, workspaceID))
    openOrFocusPanel(createSessionWorkbenchTab(sessionID), paneID)
  }

  function focusSession(workspaceID: string, sessionID: string, paneID: string | null = resolveTargetGroupID()) {
    const reference = createSessionWorkbenchTab(sessionID)
    const existingGroupID = findDockviewGroupForPanel(dockviewLayout, getWorkbenchDockPanelId(reference))?.id ?? null
    activateSessionTab(workspaceID, sessionID, existingGroupID ?? paneID)
  }

  function focusCreateSessionTab(createSessionTabID: string, paneID: string | null = resolveTargetGroupID()) {
    const nextCreateSessionTab = createSessionTabs.find((tab) => tab.id === createSessionTabID)
    if (!nextCreateSessionTab) return

    openOrFocusPanel(createCreateSessionWorkbenchTab(nextCreateSessionTab.id), paneID)
    setSelectedFolderID(nextCreateSessionTab.workspaceID)
    setExpandedFolderIDs((current) => ensureExpandedFolderID(current, nextCreateSessionTab.workspaceID))
  }

  function openCreateSessionTab(
    preferredWorkspaceID?: string | null,
    paneID: string | null = resolveTargetGroupID(),
    workspaceScope = workspaces,
  ) {
    const nextWorkspaceID = resolveCreateSessionWorkspaceID(
      workspaceScope,
      preferredWorkspaceID,
      selectedFolderID,
      activeWorkspace?.id ?? null,
    )
    const nextCreateSessionTab = createCreateSessionTab(nextWorkspaceID)
    const reference = createCreateSessionWorkbenchTab(nextCreateSessionTab.id)

    setCreateSessionTabs((current) => [...current, nextCreateSessionTab])
    const didOpen = workbenchDockviewCommandsRef.current?.openPanel(reference, {
      targetGroupID: paneID,
      title: getCreateSessionTitle(nextCreateSessionTab, workspaceScope),
    })
    if (didOpen) {
      setActiveDockviewReference(reference, paneID)
    }

    setSelectedFolderID(nextWorkspaceID)
    setExpandedFolderIDs((current) => ensureExpandedFolderID(current, nextWorkspaceID))
  }

  function focusMostRecentCreateSessionTab(
    preferredWorkspaceID?: string | null,
    paneID: string | null = resolveTargetGroupID(),
  ) {
    const activeReference = getActivePanelForGroupFromState(dockviewLayout, dockviewActiveState, paneID ?? null)
    const nextCreateSessionTabID =
      (activeReference?.kind === "create-session" ? activeReference.createSessionTabID : null) ??
      createSessionTabs[createSessionTabs.length - 1]?.id ??
      null
    if (nextCreateSessionTabID) {
      focusCreateSessionTab(nextCreateSessionTabID, paneID)
      return
    }

    openCreateSessionTab(preferredWorkspaceID, paneID)
  }

  function focusExistingCreateSessionTabAcrossPanes(preferredWorkspaceID?: string | null) {
    const nextCreateSessionTabID = createSessionTabs[createSessionTabs.length - 1]?.id ?? null
    if (!nextCreateSessionTabID) return false

    focusCreateSessionTab(nextCreateSessionTabID)
    if (preferredWorkspaceID) {
      handleCreateSessionWorkspaceChange(preferredWorkspaceID, nextCreateSessionTabID)
    }
    return true
  }

  function handleCanvasSessionTabSelect(sessionID: string, paneID?: string) {
    const nextSelection = findSession(workspaces, sessionID)
    if (!nextSelection.workspace || !nextSelection.session) return

    focusSession(nextSelection.workspace.id, nextSelection.session.id, paneID)
  }

  function handleCanvasSessionTabClose(sessionID: string) {
    workbenchDockviewCommandsRef.current?.closePanel(createSessionWorkbenchTab(sessionID))
  }

  function handleCreateSessionTabSelect(createSessionTabID: string, paneID?: string) {
    focusCreateSessionTab(createSessionTabID, paneID)
  }

  function handleOpenCreateSessionTab(preferredWorkspaceID?: string | null, paneID?: string) {
    openCreateSessionTab(preferredWorkspaceID, paneID)
  }

  function handleCloseCreateSessionTab(createSessionTabID: string, _paneID?: string, options?: { force?: boolean }) {
    if (!options?.force && getDockviewPanelIDs(dockviewLayout).length <= 1) return

    setCreateSessionTabs((current) => current.filter((tab) => tab.id !== createSessionTabID))
    workbenchDockviewCommandsRef.current?.closePanel(createCreateSessionWorkbenchTab(createSessionTabID))
  }

  function handleCreateSessionWorkspaceChange(workspaceID: string, createSessionTabID = activeCreateSessionTabID) {
    if (!createSessionTabID) return

    setCreateSessionTabs((current) =>
      current.map((tab) =>
        tab.id === createSessionTabID
          ? {
              ...tab,
              workspaceID,
            }
          : tab,
      ),
    )
    setSelectedFolderID(workspaceID)
    setExpandedFolderIDs((current) => ensureExpandedFolderID(current, workspaceID))
  }

  function handleCreateSessionTitleChange(value: string, createSessionTabID = activeCreateSessionTabID) {
    if (!createSessionTabID) return

    setCreateSessionTabs((current) =>
      current.map((tab) =>
        tab.id === createSessionTabID
          ? {
              ...tab,
              title: value,
            }
          : tab,
      ),
    )
  }

  function handleDockviewActiveChange(input: WorkbenchDockviewActiveChange) {
    setDockviewActiveState(input.activeState)
    const nextActiveTab =
      input.reference ??
      getActiveDockviewPanelReferenceFromState(dockviewLayout, input.activeState, input.groupID ?? undefined)
    const nextWorkspaceID = resolveWorkspaceIDForDockviewReference(nextActiveTab, workspaces, createSessionTabs)

    if (nextActiveTab?.kind === "session") {
      lastFocusedSessionIDRef.current = nextActiveTab.sessionID
    }

    setSelectedFolderID(nextWorkspaceID)
    setExpandedFolderIDs((current) => ensureExpandedFolderID(current, nextWorkspaceID))
  }

  function handlePaneFocus(paneID: string) {
    const activeState = createDockviewActiveStateWithFocusedGroup(dockviewLayout, dockviewActiveState, paneID)
    handleDockviewActiveChange({
      activeState,
      groupID: paneID,
      panelID: getActiveDockviewPanelIDFromState(dockviewLayout, activeState, paneID),
      reference: getActiveDockviewPanelReferenceFromState(dockviewLayout, activeState, paneID),
    })
  }

  function handleSplitResize() {
    // Deprecated: Dockview owns sash resizing; this exists for older callers.
  }

  function handlePaneTabDrop() {
    // Deprecated: Dockview owns drag/drop between groups.
  }

  function handlePaneSplit(paneID: string | null = resolveTargetGroupID()) {
    if (!paneID) return

    const nextWorkspaceID = resolveCreateSessionWorkspaceID(
      workspaces,
      selectedFolderID,
      selectedFolderID,
      activeWorkspace?.id ?? null,
    )
    const nextCreateSessionTab = createCreateSessionTab(nextWorkspaceID)
    const reference = createCreateSessionWorkbenchTab(nextCreateSessionTab.id)

    setCreateSessionTabs((current) => [...current, nextCreateSessionTab])
    workbenchDockviewCommandsRef.current?.splitPanel(reference, {
      direction: "right",
      targetGroupID: paneID,
      title: getCreateSessionTitle(nextCreateSessionTab, workspaces),
    })
    setSelectedFolderID(nextWorkspaceID)
    setExpandedFolderIDs((current) => ensureExpandedFolderID(current, nextWorkspaceID))
  }

  async function handleSessionSplitRight(workspaceID: string, sessionID: string) {
    const reference = createSessionWorkbenchTab(sessionID)
    const targetGroupID = resolveTargetGroupID()
    const title = resolvePanelTitle(reference)
    const remoteOwnership = getRemotePanelOwnership(reference)

    if (remoteOwnership) {
      const moveWorkbenchPanel = window.desktop?.moveWorkbenchPanel
      if (!moveWorkbenchPanel) {
        throw new Error("Workbench panel move is unavailable.")
      }
      const result = await moveWorkbenchPanel({
        panelID: getWorkbenchDockPanelId(reference),
        placement: "right",
        sourceSurfaceID: remoteOwnership.ownerSurfaceID ?? remoteOwnership.ownerWindowID,
        targetGroupID,
        targetSurfaceID: surfaceID,
      })
      if (!result.ok) {
        throw new Error(result.reason || "Unable to move the session into the current window.")
      }
    } else {
      const didSplit = workbenchDockviewCommandsRef.current?.splitPanel(reference, {
        direction: "right",
        targetGroupID,
        title,
      })
      if (!didSplit) {
        throw new Error("Workbench split view is unavailable.")
      }
      setActiveDockviewReference(reference, targetGroupID)
    }

    lastFocusedSessionIDRef.current = sessionID
    setSelectedFolderID(workspaceID)
    setExpandedFolderIDs((current) => ensureExpandedFolderID(current, workspaceID))
  }

  async function handleSessionPopout(sessionID: string) {
    const reference = createSessionWorkbenchTab(sessionID)
    const panelID = getWorkbenchDockPanelId(reference)
    const remoteOwnership = getRemotePanelOwnership(reference)

    if (remoteOwnership) {
      const focusWorkbenchPanel = window.desktop?.focusWorkbenchPanel
      if (!focusWorkbenchPanel) {
        throw new Error("Workbench window focus is unavailable.")
      }
      const result = await focusWorkbenchPanel({ panelID })
      if (!result.ok) {
        throw new Error(result.reason || "Unable to focus the session window.")
      }
      return
    }

    if (await workbenchDockviewCommandsRef.current?.popoutPanel(reference)) return

    const detachSessionPanel = window.desktop?.detachSessionPanel
    if (!detachSessionPanel) {
      throw new Error("Session popout is unavailable.")
    }
    const result = await detachSessionPanel({
      lastMainGroupID: resolveTargetGroupID(),
      panelID,
      sessionID,
      sourceSurfaceID: surfaceID,
      title: resolvePanelTitle(reference),
    })
    if (!result.ok) {
      throw new Error(result.reason || "Unable to open the session in a new window.")
    }
  }

  function handleMovePanelIntoSurface(input: {
    panelID: string
    placement?: "within" | "left" | "right" | "top" | "bottom"
    targetGroupID?: string | null
    title?: string
  }) {
    const reference = getWorkbenchDockPanelReference(input.panelID)
    if (reference?.kind !== "session") return false

    const title = input.title ?? resolvePanelTitle(reference)
    if (input.placement && input.placement !== "within") {
      return Boolean(workbenchDockviewCommandsRef.current?.splitPanel(reference, {
        direction: input.placement,
        targetGroupID: input.targetGroupID ?? resolveTargetGroupID(),
        title,
      }))
    }

    return openOrFocusPanel(reference, input.targetGroupID ?? resolveTargetGroupID())
  }

  function handleMovePanelOutOfSurface(panelID: string) {
    const reference = getWorkbenchDockPanelReference(panelID)
    if (reference?.kind !== "session") return false
    return Boolean(workbenchDockviewCommandsRef.current?.closePanel(reference))
  }

  useEffect(() => {
    if (!selectedFolderID) return

    const projectRow = projectRowRefs.current[selectedFolderID]
    projectRow?.scrollIntoView?.({
      block: "nearest",
    })
  }, [selectedFolderID, workspaces])

  useEffect(() => {
    const validWorkspaceIDs = new Set(workspaces.map((workspace) => workspace.id))
    const fallbackWorkspaceID = resolveCreateSessionWorkspaceID(workspaces, selectedFolderID, activeWorkspace?.id ?? null)

    setExpandedFolderIDs((current) => filterExpandedFolderIDs(current, validWorkspaceIDs))
    setCreateSessionTabs((current) => {
      let changed = false
      const next = current.map((tab) => {
        const nextWorkspaceID = tab.workspaceID && validWorkspaceIDs.has(tab.workspaceID) ? tab.workspaceID : fallbackWorkspaceID
        if (nextWorkspaceID === tab.workspaceID) return tab

        changed = true
        return {
          ...tab,
          workspaceID: nextWorkspaceID,
        }
      })

      return changed ? next : current
    })
  }, [activeWorkspace?.id, selectedFolderID, setCreateSessionTabs, setExpandedFolderIDs, workspaces])

  useEffect(() => {
    const validReferences = buildValidDockviewReferences(workspaces, createSessionTabs)
    const panelTitles = buildDockviewPanelTitles(workspaces, createSessionTabs)
    setDockviewLayout((current) => normalizeDockviewLayout(current, validReferences, panelTitles))
  }, [createSessionTabs, setDockviewLayout, workspaces])

  useEffect(() => {
    if (getDockviewPanelIDs(dockviewLayout).length > 0) return

    const fallbackWorkspaceID = resolveCreateSessionWorkspaceID(
      workspaces,
      activeCreateSessionTab?.workspaceID ?? null,
      selectedFolderID,
      activeWorkspace?.id ?? null,
    )
    const fallbackCreateSessionTab =
      activeCreateSessionTab ??
      createSessionTabs[createSessionTabs.length - 1] ??
      createCreateSessionTab(fallbackWorkspaceID)

    if (createSessionTabs.length === 0) {
      setCreateSessionTabs([fallbackCreateSessionTab])
    }

    setDockviewLayout(createInitialDockviewLayout(
      createCreateSessionWorkbenchTab(fallbackCreateSessionTab.id),
      getCreateSessionTitle(fallbackCreateSessionTab, workspaces),
    ))

    if (fallbackCreateSessionTab.workspaceID !== selectedFolderID) {
      setSelectedFolderID(fallbackCreateSessionTab.workspaceID)
      setExpandedFolderIDs((current) => ensureExpandedFolderID(current, fallbackCreateSessionTab.workspaceID))
    }
  }, [
    activeCreateSessionTab,
    activeWorkspace?.id,
    createSessionTabs,
    dockviewLayout,
    selectedFolderID,
    setCreateSessionTabs,
    setDockviewLayout,
    setExpandedFolderIDs,
    setSelectedFolderID,
    workspaces,
  ])

  return {
    activateSessionTab,
    focusExistingCreateSessionTabAcrossPanes,
    focusMostRecentCreateSessionTab,
    focusSession,
    handleCanvasSessionTabClose,
    handleCanvasSessionTabSelect,
    handleCloseCreateSessionTab,
    handleCreateSessionTabSelect,
    handleCreateSessionTitleChange,
    handleCreateSessionWorkspaceChange,
    handleOpenCreateSessionTab,
    handleDockviewActiveChange,
    handlePaneFocus,
    handleMovePanelIntoSurface,
    handleMovePanelOutOfSurface,
    handlePaneSplit,
    handleSessionPopout,
    handleSessionSplitRight,
    handlePaneTabDrop,
    handleSplitResize,
    isCreateSessionTabActive,
    openCreateSessionTab,
    setFocusedPaneID,
  }
}
