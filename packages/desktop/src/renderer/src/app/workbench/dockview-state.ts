import { Orientation, type SerializedDockview, type SerializedGridObject } from "dockview-react"
import type { WorkbenchTabReference } from "../types"
import { createID } from "../utils"

export const WORKBENCH_DOCK_PANEL_COMPONENT = "workbench-panel"
export const WORKBENCH_DOCK_TAB_COMPONENT = "workbench-tab"
export const WORKBENCH_DOCKVIEW_STORAGE_KEY = "desktop.workbench.dockviewLayout.v1"

export type WorkbenchDockPanelReference = WorkbenchTabReference
export type WorkbenchDockDirection = "left" | "right" | "top" | "bottom"
export type WorkbenchDockviewGroupLocation = "grid" | "floating" | "popout"

export interface WorkbenchDockviewCommands {
  openPanel: (
    reference: WorkbenchDockPanelReference,
    options?: {
      activate?: boolean
      targetGroupID?: string | null
      title?: string
    },
  ) => boolean
  focusPanel: (reference: WorkbenchDockPanelReference) => boolean
  closePanel: (reference: WorkbenchDockPanelReference) => boolean
  popoutPanel: (reference: WorkbenchDockPanelReference) => Promise<boolean>
  replacePanel: (
    currentReference: WorkbenchDockPanelReference,
    nextReference: WorkbenchDockPanelReference,
    options?: {
      title?: string
    },
  ) => boolean
  splitPanel: (
    reference: WorkbenchDockPanelReference,
    options: {
      direction: WorkbenchDockDirection
      targetGroupID?: string | null
      title?: string
    },
  ) => boolean
  getSnapshot: () => SerializedDockview | null
}

interface SerializedDockviewPanelState {
  id: string
  contentComponent?: string
  tabComponent?: string
  title?: string
  params?: Record<string, any>
}

interface SerializedDockviewGroupState {
  id: string
  views: string[]
  activeView?: string
}

export interface WorkbenchDockviewGroupSnapshot {
  id: string
  location: WorkbenchDockviewGroupLocation
  panelIDs: string[]
  views: WorkbenchDockPanelReference[]
  activePanelID: string | null
  activeView: WorkbenchDockPanelReference | null
}

export interface WorkbenchDockviewActiveState {
  activeGroupID: string | null
  activePanelIDByGroupID: Record<string, string | null>
}

export interface WorkbenchDockviewActiveChange {
  activeState: WorkbenchDockviewActiveState
  groupID: string | null
  panelID: string | null
  reference: WorkbenchDockPanelReference | null
}

const DEFAULT_DOCKVIEW_WIDTH = 1200
const DEFAULT_DOCKVIEW_HEIGHT = 800
const DEFAULT_DOCKVIEW_SIZE = 1000

function isSerializedGroupState(value: unknown): value is SerializedDockviewGroupState {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as SerializedDockviewGroupState).id === "string" &&
    Array.isArray((value as SerializedDockviewGroupState).views)
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function createPanelState(reference: WorkbenchDockPanelReference, title: string | undefined): SerializedDockviewPanelState {
  const panelID = getWorkbenchDockPanelId(reference)
  return {
    id: panelID,
    contentComponent: WORKBENCH_DOCK_PANEL_COMPONENT,
    tabComponent: WORKBENCH_DOCK_TAB_COMPONENT,
    title,
    params: reference,
  }
}

function cloneSerializedDockview(layout: SerializedDockview): SerializedDockview {
  return JSON.parse(JSON.stringify(layout)) as SerializedDockview
}

function isKnownWorkbenchPanelState(panelID: string, panelState: unknown): panelState is SerializedDockviewPanelState {
  if (!isRecord(panelState)) return false
  if (typeof panelState.id === "string" && panelState.id !== panelID) return false
  if (typeof panelState.contentComponent === "string" && panelState.contentComponent !== WORKBENCH_DOCK_PANEL_COMPONENT) {
    return false
  }
  if (typeof panelState.tabComponent === "string" && panelState.tabComponent !== WORKBENCH_DOCK_TAB_COMPONENT) {
    return false
  }

  const reference = getWorkbenchDockPanelReference(panelID, panelState as unknown as SerializedDockviewPanelState)
  return Boolean(reference && getWorkbenchDockPanelId(reference) === panelID)
}

export function getWorkbenchDockPanelId(reference: WorkbenchDockPanelReference) {
  return reference.kind === "session"
    ? `session:${reference.sessionID}`
    : `create-session:${reference.createSessionTabID}`
}

export function getWorkbenchDockPanelReference(
  panelID: string,
  panelState?: SerializedDockviewPanelState | undefined,
): WorkbenchDockPanelReference | null {
  const params = panelState?.params
  if (params?.kind === "session" && typeof params.sessionID === "string" && params.sessionID) {
    return {
      kind: "session",
      sessionID: params.sessionID,
    }
  }

  if (
    params?.kind === "create-session" &&
    typeof params.createSessionTabID === "string" &&
    params.createSessionTabID
  ) {
    return {
      kind: "create-session",
      createSessionTabID: params.createSessionTabID,
    }
  }

  if (panelID.startsWith("session:")) {
    const sessionID = panelID.slice("session:".length)
    return sessionID ? { kind: "session", sessionID } : null
  }

  if (panelID.startsWith("create-session:")) {
    const createSessionTabID = panelID.slice("create-session:".length)
    return createSessionTabID ? { kind: "create-session", createSessionTabID } : null
  }

  return null
}

export function createInitialDockviewLayout(reference: WorkbenchDockPanelReference, title?: string): SerializedDockview {
  const panelID = getWorkbenchDockPanelId(reference)
  const groupID = createID("group")

  return {
    grid: {
      root: {
        type: "branch",
        data: [
          {
            type: "leaf",
            data: {
              id: groupID,
              views: [panelID],
              activeView: panelID,
            },
            size: DEFAULT_DOCKVIEW_SIZE,
          },
        ],
      },
      height: DEFAULT_DOCKVIEW_HEIGHT,
      width: DEFAULT_DOCKVIEW_WIDTH,
      orientation: Orientation.HORIZONTAL,
    },
    panels: {
      [panelID]: createPanelState(reference, title),
    },
    activeGroup: groupID,
  }
}

export function getSerializedDockviewSignature(serialized: SerializedDockview | null) {
  return JSON.stringify(serialized)
}

export function getDockviewGroupsInOrder(layout: SerializedDockview | null): WorkbenchDockviewGroupSnapshot[] {
  if (!layout) return []
  const sourceLayout = layout
  const groups: WorkbenchDockviewGroupSnapshot[] = []

  function appendGroup(group: SerializedDockviewGroupState, location: WorkbenchDockviewGroupLocation) {
    if (!isSerializedGroupState(group)) return

    groups.push({
      id: group.id,
      location,
      panelIDs: [...group.views],
      views: group.views.flatMap((panelID) => {
        const reference = getWorkbenchDockPanelReference(
          panelID,
          sourceLayout.panels[panelID] as SerializedDockviewPanelState | undefined,
        )
        return reference ? [reference] : []
      }),
      activePanelID: group.activeView ?? null,
      activeView: group.activeView
        ? getWorkbenchDockPanelReference(
            group.activeView,
            sourceLayout.panels[group.activeView] as SerializedDockviewPanelState | undefined,
          )
        : null,
    })
  }

  function visit(node: SerializedGridObject<SerializedDockviewGroupState>) {
    if (node.type === "leaf") {
      appendGroup(node.data as SerializedDockviewGroupState, "grid")
      return
    }

    const children = Array.isArray(node.data) ? node.data : []
    for (const child of children as SerializedGridObject<SerializedDockviewGroupState>[]) {
      visit(child)
    }
  }

  visit(layout.grid.root as SerializedGridObject<SerializedDockviewGroupState>)
  for (const floatingGroup of layout.floatingGroups ?? []) {
    appendGroup(floatingGroup.data as SerializedDockviewGroupState, "floating")
  }
  for (const popoutGroup of layout.popoutGroups ?? []) {
    appendGroup(popoutGroup.data as SerializedDockviewGroupState, "popout")
  }
  return groups
}

function getLayoutActiveGroupID(
  layout: SerializedDockview | null | undefined,
  groups: WorkbenchDockviewGroupSnapshot[],
): string | null {
  if (layout?.activeGroup && groups.some((group) => group.id === layout.activeGroup)) {
    return layout.activeGroup
  }
  return groups[0]?.id ?? null
}

function getValidActivePanelIDForGroup(
  group: WorkbenchDockviewGroupSnapshot,
  activeState: WorkbenchDockviewActiveState | null | undefined,
): string | null {
  const activePanelID = activeState?.activePanelIDByGroupID[group.id]
  if (activePanelID && group.panelIDs.includes(activePanelID)) {
    return activePanelID
  }
  if (group.activePanelID && group.panelIDs.includes(group.activePanelID)) {
    return group.activePanelID
  }
  return group.panelIDs[0] ?? null
}

export function createDockviewActiveStateFromLayout(
  layout: SerializedDockview | null | undefined,
): WorkbenchDockviewActiveState {
  return normalizeDockviewActiveState(layout, null)
}

export function dockviewActiveStatesAreEqual(
  left: WorkbenchDockviewActiveState | null | undefined,
  right: WorkbenchDockviewActiveState | null | undefined,
): boolean {
  const leftGroupID = left?.activeGroupID ?? null
  const rightGroupID = right?.activeGroupID ?? null
  if (leftGroupID !== rightGroupID) {
    return false
  }

  const leftMap = left?.activePanelIDByGroupID ?? {}
  const rightMap = right?.activePanelIDByGroupID ?? {}
  const keys = new Set([...Object.keys(leftMap), ...Object.keys(rightMap)])
  for (const key of keys) {
    if ((leftMap[key] ?? null) !== (rightMap[key] ?? null)) {
      return false
    }
  }
  return true
}

export function normalizeDockviewActiveState(
  layout: SerializedDockview | null | undefined,
  activeState: WorkbenchDockviewActiveState | null | undefined,
): WorkbenchDockviewActiveState {
  const groups = getDockviewGroupsInOrder(layout ?? null)
  if (!groups.length) {
    return {
      activeGroupID: null,
      activePanelIDByGroupID: {},
    }
  }

  const activePanelIDByGroupID: Record<string, string | null> = {}
  for (const group of groups) {
    activePanelIDByGroupID[group.id] = getValidActivePanelIDForGroup(group, activeState)
  }

  const requestedActiveGroupID = activeState?.activeGroupID ?? null
  const activeGroupID =
    requestedActiveGroupID && groups.some((group) => group.id === requestedActiveGroupID)
      ? requestedActiveGroupID
      : getLayoutActiveGroupID(layout, groups)

  return {
    activeGroupID,
    activePanelIDByGroupID,
  }
}

export function createDockviewActiveStateWithFocusedGroup(
  layout: SerializedDockview | null | undefined,
  activeState: WorkbenchDockviewActiveState | null | undefined,
  groupID: string | null | undefined,
): WorkbenchDockviewActiveState {
  const normalizedActiveState = normalizeDockviewActiveState(layout, activeState)
  if (!groupID || !(groupID in normalizedActiveState.activePanelIDByGroupID)) {
    return normalizedActiveState
  }
  if (normalizedActiveState.activeGroupID === groupID) {
    return normalizedActiveState
  }
  return {
    ...normalizedActiveState,
    activeGroupID: groupID,
  }
}

export function getFocusedDockviewGroupIDFromState(
  layout: SerializedDockview | null | undefined,
  activeState: WorkbenchDockviewActiveState | null | undefined,
): string | null {
  return normalizeDockviewActiveState(layout, activeState).activeGroupID
}

export function getActiveDockviewPanelIDFromState(
  layout: SerializedDockview | null | undefined,
  activeState: WorkbenchDockviewActiveState | null | undefined,
  groupID?: string | null,
): string | null {
  const normalizedActiveState = normalizeDockviewActiveState(layout, activeState)
  const resolvedGroupID = groupID ?? normalizedActiveState.activeGroupID
  return resolvedGroupID
    ? normalizedActiveState.activePanelIDByGroupID[resolvedGroupID] ?? null
    : null
}

export function getActivePanelForGroupFromState(
  layout: SerializedDockview | null | undefined,
  activeState: WorkbenchDockviewActiveState | null | undefined,
  groupID: string | null | undefined,
): WorkbenchDockPanelReference | null {
  if (!groupID) {
    return null
  }
  const panelID = getActiveDockviewPanelIDFromState(layout, activeState, groupID)
  return panelID ? getWorkbenchDockPanelReference(panelID) : null
}

export function getActiveDockviewPanelReferenceFromState(
  layout: SerializedDockview | null | undefined,
  activeState: WorkbenchDockviewActiveState | null | undefined,
  groupID?: string | null,
): WorkbenchDockPanelReference | null {
  const normalizedActiveState = normalizeDockviewActiveState(layout, activeState)
  const resolvedGroupID = groupID ?? normalizedActiveState.activeGroupID
  return getActivePanelForGroupFromState(layout, normalizedActiveState, resolvedGroupID)
}

export function findDockviewGroupForPanel(layout: SerializedDockview | null, panelID: string) {
  return getDockviewGroupsInOrder(layout).find((group) => group.panelIDs.includes(panelID)) ?? null
}

export function getActivePanelForGroup(layout: SerializedDockview | null, groupID: string | null | undefined) {
  if (!layout || !groupID) return null
  const group = getDockviewGroupsInOrder(layout).find((item) => item.id === groupID)
  if (!group || group.panelIDs.length === 0) return null
  const activePanelID = group.activePanelID && group.panelIDs.includes(group.activePanelID)
    ? group.activePanelID
    : group.panelIDs[0] ?? null
  return activePanelID
    ? getWorkbenchDockPanelReference(activePanelID, layout.panels[activePanelID] as SerializedDockviewPanelState | undefined)
    : null
}

export function getActiveDockviewPanelID(layout: SerializedDockview | null, groupID = getFocusedDockviewGroupID(layout)) {
  if (!layout || !groupID) return null
  const group = getDockviewGroupsInOrder(layout).find((item) => item.id === groupID)
  if (!group || group.panelIDs.length === 0) return null
  return group.activePanelID && group.panelIDs.includes(group.activePanelID)
    ? group.activePanelID
    : group.panelIDs[0] ?? null
}

export function getFocusedDockviewGroupID(layout: SerializedDockview | null) {
  const groups = getDockviewGroupsInOrder(layout)
  if (layout?.activeGroup && groups.some((group) => group.id === layout.activeGroup)) {
    return layout.activeGroup
  }
  return groups[0]?.id ?? null
}

export function getActiveDockviewPanelReference(layout: SerializedDockview | null, groupID = getFocusedDockviewGroupID(layout)) {
  return getActivePanelForGroup(layout, groupID)
}

export function getOpenSessionIDs(layout: SerializedDockview | null) {
  if (!layout) return []
  const sessionIDs: string[] = []
  const seen = new Set<string>()

  for (const panelID of Object.keys(layout.panels)) {
    const reference = getWorkbenchDockPanelReference(panelID, layout.panels[panelID] as SerializedDockviewPanelState | undefined)
    if (reference?.kind !== "session" || seen.has(reference.sessionID)) continue
    seen.add(reference.sessionID)
    sessionIDs.push(reference.sessionID)
  }

  return sessionIDs
}

export function getVisibleSessionIDs(layout: SerializedDockview | null) {
  const sessionIDs: string[] = []
  const seen = new Set<string>()

  for (const group of getDockviewGroupsInOrder(layout)) {
    const reference = getActivePanelForGroup(layout, group.id)
    if (reference?.kind !== "session" || seen.has(reference.sessionID)) continue
    seen.add(reference.sessionID)
    sessionIDs.push(reference.sessionID)
  }

  return sessionIDs
}

export function getVisibleSessionIDsFromState(
  layout: SerializedDockview | null | undefined,
  activeState: WorkbenchDockviewActiveState | null | undefined,
) {
  const sessionIDs: string[] = []
  const seen = new Set<string>()

  for (const group of getDockviewGroupsInOrder(layout ?? null)) {
    const reference = getActivePanelForGroupFromState(layout, activeState, group.id)
    if (reference?.kind !== "session" || seen.has(reference.sessionID)) continue
    seen.add(reference.sessionID)
    sessionIDs.push(reference.sessionID)
  }

  return sessionIDs
}

export function getDockviewPanelIDs(layout: SerializedDockview | null) {
  return layout ? Object.keys(layout.panels) : []
}

export function sanitizeDockviewLayout(layout: SerializedDockview | null | unknown): SerializedDockview | null {
  if (!isRecord(layout) || !isRecord(layout.grid) || !isRecord(layout.grid.root) || !isRecord(layout.panels)) {
    return null
  }

  let sourceLayout: SerializedDockview
  try {
    sourceLayout = cloneSerializedDockview(layout as unknown as SerializedDockview)
  } catch {
    return null
  }
  const validPanelIDs = new Set<string>()
  const sanitizedPanels: SerializedDockview["panels"] = {}

  for (const [panelID, panelState] of Object.entries(sourceLayout.panels)) {
    if (!isKnownWorkbenchPanelState(panelID, panelState)) continue
    const reference = getWorkbenchDockPanelReference(panelID, panelState as SerializedDockviewPanelState)
    if (!reference) continue
    const title = typeof (panelState as SerializedDockviewPanelState).title === "string"
      ? (panelState as SerializedDockviewPanelState).title
      : undefined
    validPanelIDs.add(panelID)
    sanitizedPanels[panelID] = {
      ...(panelState as SerializedDockviewPanelState),
      ...createPanelState(reference, title),
    }
  }

  if (validPanelIDs.size === 0) return null

  function sanitizeGroup(group: SerializedDockviewGroupState): SerializedDockviewGroupState | null {
    if (!isSerializedGroupState(group)) return null

    const views = group.views.filter((panelID) => validPanelIDs.has(panelID))
    if (views.length === 0) return null

    return {
      ...group,
      views,
      activeView: group.activeView && views.includes(group.activeView) ? group.activeView : views[0],
    }
  }

  function sanitizeNode(
    node: SerializedGridObject<SerializedDockviewGroupState>,
  ): SerializedGridObject<SerializedDockviewGroupState> | null {
    if (node.type === "leaf") {
      const group = sanitizeGroup(node.data as SerializedDockviewGroupState)
      if (!group) return null

      return {
        ...node,
        data: group,
      }
    }

    const children = (Array.isArray(node.data) ? node.data : [])
      .map((child) => sanitizeNode(child as SerializedGridObject<SerializedDockviewGroupState>))
      .filter((child): child is SerializedGridObject<SerializedDockviewGroupState> => child !== null)

    if (children.length === 0) return null

    return {
      ...node,
      data: children,
    }
  }

  const nextRoot = sanitizeNode(sourceLayout.grid.root as SerializedGridObject<SerializedDockviewGroupState>)
  const floatingGroups = (sourceLayout.floatingGroups ?? [])
    .map((group) => {
      const data = sanitizeGroup(group.data as SerializedDockviewGroupState)
      return data ? { ...group, data } : null
    })
    .filter((group): group is NonNullable<typeof group> => group !== null)
  const popoutGroups = (sourceLayout.popoutGroups ?? [])
    .map((group) => {
      const data = sanitizeGroup(group.data as SerializedDockviewGroupState)
      return data ? { ...group, data } : null
    })
    .filter((group): group is NonNullable<typeof group> => group !== null)

  sourceLayout.grid.root = nextRoot
    ? nextRoot.type === "branch"
      ? nextRoot
      : {
          type: "branch",
          data: [nextRoot],
        }
    : {
        type: "branch",
        data: [],
      }
  sourceLayout.panels = sanitizedPanels
  if (floatingGroups.length > 0) {
    sourceLayout.floatingGroups = floatingGroups
  } else {
    delete sourceLayout.floatingGroups
  }
  if (popoutGroups.length > 0) {
    sourceLayout.popoutGroups = popoutGroups
  } else {
    delete sourceLayout.popoutGroups
  }
  const groups = getDockviewGroupsInOrder(sourceLayout)
  sourceLayout.activeGroup = sourceLayout.activeGroup && groups.some((group) => group.id === sourceLayout.activeGroup)
    ? sourceLayout.activeGroup
    : groups[0]?.id

  return groups.length > 0 ? sourceLayout : null
}

export function normalizeDockviewLayout(
  layout: SerializedDockview | null,
  validReferences: WorkbenchDockPanelReference[],
  panelTitles: Record<string, string | undefined> | Map<string, string | undefined> = {},
): SerializedDockview | null {
  const sanitizedLayout = sanitizeDockviewLayout(layout)
  if (!sanitizedLayout) return null

  const validPanelIDs = new Set(validReferences.map(getWorkbenchDockPanelId))
  const resolvePanelTitle = (panelID: string) =>
    panelTitles instanceof Map ? panelTitles.get(panelID) : panelTitles[panelID]
  const nextLayout = cloneSerializedDockview(sanitizedLayout)
  const nextPanels: SerializedDockview["panels"] = {}

  function normalizeGroup(group: SerializedDockviewGroupState): SerializedDockviewGroupState | null {
    if (!isSerializedGroupState(group)) return null

    const views = group.views.filter((panelID) => validPanelIDs.has(panelID) && Boolean(nextLayout.panels[panelID]))
    if (views.length === 0) return null
    const activeView = group.activeView && views.includes(group.activeView) ? group.activeView : views[0]

    for (const panelID of views) {
      const reference = getWorkbenchDockPanelReference(
        panelID,
        nextLayout.panels[panelID] as SerializedDockviewPanelState | undefined,
      )
      if (!reference) continue
      nextPanels[panelID] = {
        ...(nextLayout.panels[panelID] as SerializedDockviewPanelState),
        ...createPanelState(reference, resolvePanelTitle(panelID)),
      }
    }

    return {
      ...group,
      views,
      activeView,
    }
  }

  function normalizeNode(
    node: SerializedGridObject<SerializedDockviewGroupState>,
  ): SerializedGridObject<SerializedDockviewGroupState> | null {
    if (node.type === "leaf") {
      const group = normalizeGroup(node.data as SerializedDockviewGroupState)
      if (!group) return null

      return {
        ...node,
        data: group,
      }
    }

    const children = (Array.isArray(node.data) ? node.data : [])
      .map((child) => normalizeNode(child as SerializedGridObject<SerializedDockviewGroupState>))
      .filter((child): child is SerializedGridObject<SerializedDockviewGroupState> => child !== null)

    if (children.length === 0) return null

    return {
      ...node,
      data: children,
    }
  }

  const nextRoot = normalizeNode(nextLayout.grid.root as SerializedGridObject<SerializedDockviewGroupState>)
  const floatingGroups = (nextLayout.floatingGroups ?? [])
    .map((group) => {
      const data = normalizeGroup(group.data as SerializedDockviewGroupState)
      return data ? { ...group, data } : null
    })
    .filter((group): group is NonNullable<typeof group> => group !== null)
  const popoutGroups = (nextLayout.popoutGroups ?? [])
    .map((group) => {
      const data = normalizeGroup(group.data as SerializedDockviewGroupState)
      return data ? { ...group, data } : null
    })
    .filter((group): group is NonNullable<typeof group> => group !== null)

  nextLayout.grid.root = nextRoot
    ? nextRoot.type === "branch"
      ? nextRoot
      : {
          type: "branch",
          data: [nextRoot],
        }
    : {
        type: "branch",
        data: [],
      }
  nextLayout.panels = nextPanels
  if (floatingGroups.length > 0) {
    nextLayout.floatingGroups = floatingGroups
  } else {
    delete nextLayout.floatingGroups
  }
  if (popoutGroups.length > 0) {
    nextLayout.popoutGroups = popoutGroups
  } else {
    delete nextLayout.popoutGroups
  }
  const groups = getDockviewGroupsInOrder(nextLayout)
  nextLayout.activeGroup = nextLayout.activeGroup && groups.some((group) => group.id === nextLayout.activeGroup)
    ? nextLayout.activeGroup
    : groups[0]?.id

  return groups.length > 0 ? nextLayout : null
}

function createPersistableDockviewLayout(layout: SerializedDockview | null) {
  const sanitizedLayout = sanitizeDockviewLayout(layout)
  if (!sanitizedLayout) return null

  const sourceLayout = sanitizedLayout
  const seenPanelIDs = new Set<string>()
  const nextPanels: SerializedDockview["panels"] = {}

  function createPersistableGroup(group: SerializedDockviewGroupState): SerializedDockviewGroupState | null {
    if (!isSerializedGroupState(group)) return null

    const views = group.views.filter((panelID) => {
      if (seenPanelIDs.has(panelID)) return false
      const reference = getWorkbenchDockPanelReference(
        panelID,
        sourceLayout.panels[panelID] as SerializedDockviewPanelState | undefined,
      )
      return reference?.kind === "session"
    })
    if (views.length === 0) return null

    for (const panelID of views) {
      const reference = getWorkbenchDockPanelReference(
        panelID,
        sourceLayout.panels[panelID] as SerializedDockviewPanelState | undefined,
      )
      if (!reference) continue
      seenPanelIDs.add(panelID)
      const title = (sourceLayout.panels[panelID] as SerializedDockviewPanelState | undefined)?.title
      nextPanels[panelID] = createPanelState(reference, title)
    }

    return {
      ...group,
      views,
      activeView: group.activeView && views.includes(group.activeView) ? group.activeView : views[0],
    }
  }

  function createPersistableLeaf(group: SerializedDockviewGroupState): SerializedGridObject<SerializedDockviewGroupState> | null {
    const data = createPersistableGroup(group)
    if (!data) return null

    return {
      type: "leaf",
      data,
      size: DEFAULT_DOCKVIEW_SIZE,
    }
  }

  function filterPersistableNode(
    node: SerializedGridObject<SerializedDockviewGroupState>,
  ): SerializedGridObject<SerializedDockviewGroupState> | null {
    if (node.type === "leaf") {
      const group = createPersistableGroup(node.data as SerializedDockviewGroupState)
      if (!group) return null

      return {
        ...node,
        data: group,
      }
    }

    const children = (Array.isArray(node.data) ? node.data : [])
      .map((child) => filterPersistableNode(child as SerializedGridObject<SerializedDockviewGroupState>))
      .filter((child): child is SerializedGridObject<SerializedDockviewGroupState> => child !== null)

    if (children.length === 0) return null

    return {
      ...node,
      data: children,
    }
  }

  const gridRoot = filterPersistableNode(sourceLayout.grid.root as SerializedGridObject<SerializedDockviewGroupState>)
  const detachedLeaves = [
    ...(sourceLayout.floatingGroups ?? []),
    ...(sourceLayout.popoutGroups ?? []),
  ]
    .map((group) => createPersistableLeaf(group.data as SerializedDockviewGroupState))
    .filter((node): node is SerializedGridObject<SerializedDockviewGroupState> => node !== null)
  const hasPersistedPanels = Object.keys(nextPanels).length > 0
  if (!hasPersistedPanels) return null

  let root: SerializedGridObject<SerializedDockviewGroupState> = gridRoot
    ? gridRoot.type === "branch"
      ? gridRoot
      : {
          type: "branch",
          data: [gridRoot],
          size: gridRoot.size,
        }
    : {
        type: "branch",
        data: [],
      }

  if (detachedLeaves.length > 0) {
    const rootChildren = root.type === "branch" && Array.isArray(root.data)
      ? root.data as SerializedGridObject<SerializedDockviewGroupState>[]
      : [root]
    root = {
      ...root,
      type: "branch",
      data: [...rootChildren, ...detachedLeaves],
    }
  }

  const nextLayout: SerializedDockview = {
    grid: {
      root,
      height: sourceLayout.grid.height || DEFAULT_DOCKVIEW_HEIGHT,
      width: sourceLayout.grid.width || DEFAULT_DOCKVIEW_WIDTH,
      orientation: sourceLayout.grid.orientation ?? Orientation.HORIZONTAL,
    },
    panels: nextPanels,
  }
  const groups = getDockviewGroupsInOrder(nextLayout)
  nextLayout.activeGroup = sourceLayout.activeGroup && groups.some((group) => group.id === sourceLayout.activeGroup)
    ? sourceLayout.activeGroup
    : groups[0]?.id

  return groups.length > 0 ? nextLayout : null
}

export function readPersistedDockviewLayout() {
  if (typeof window === "undefined") return null

  try {
    const rawValue = window.localStorage.getItem(WORKBENCH_DOCKVIEW_STORAGE_KEY)
    if (!rawValue) return null
    return sanitizeDockviewLayout(JSON.parse(rawValue))
  } catch {
    return null
  }
}

export function writePersistedDockviewLayout(layout: SerializedDockview | null) {
  if (typeof window === "undefined") return

  try {
    const persistableLayout = createPersistableDockviewLayout(layout)
    if (!persistableLayout) {
      window.localStorage.removeItem(WORKBENCH_DOCKVIEW_STORAGE_KEY)
      return
    }

    window.localStorage.setItem(WORKBENCH_DOCKVIEW_STORAGE_KEY, JSON.stringify(persistableLayout))
  } catch {
    // Persistence is best-effort; the in-memory Dockview layout remains authoritative.
  }
}
