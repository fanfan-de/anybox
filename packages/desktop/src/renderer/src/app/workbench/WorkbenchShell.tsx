import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react"
import {
  DockviewReact,
  type DockviewApi,
  type DockviewReadyEvent,
  type DockviewTheme,
  type IDockviewPanel,
  type IDockviewHeaderActionsProps,
  type IDockviewPanelHeaderProps,
  type IDockviewPanelProps,
  type SerializedDockview,
} from "dockview-react"
import { CloseIcon, PlusIcon } from "../icons"
import { joinClassNames, SidebarToggleButton, SideChatBadge } from "../shared-ui"
import type { MarkdownArtifactLinkTarget, MarkdownLocalFileLinkTarget } from "../thread-markdown"
import type { ThreadNavigationRequest, ThreadScrollSnapshot } from "../thread/ThreadView"
import type { AssistantTraceVisibility, ComposerDraftState, SessionDiffFile, SessionDiffSummary, ToolPermissionMode } from "../types"
import type { ComposerCommandStatus } from "../agent-workspace/composer-controller"
import { createID } from "../utils"
import {
  buildWorkbenchHeaderState,
  buildWorkbenchPaneState,
  buildWorkbenchPanelRenderState,
  buildWorkbenchPanelTitleMap,
  buildWorkbenchTabHeaderState,
  buildWorkspaceDerivedStateInputFromStore,
  getWorkbenchGridPaneIDs,
  workbenchHeaderStatesAreEqual,
  workbenchPaneStatesAreEqual,
  workbenchTabHeaderStatesAreEqual,
  type WorkbenchPaneTab,
} from "../agent-workspace/workspace-derived-state"
import {
  seedWorkspaceIDs,
  shallowEqualArrays,
  shallowEqualObjects,
  useWorkspaceStoreSelector,
  type WorkspaceStoreApi,
} from "../agent-workspace/workspace-store"
import {
  createDockviewActiveStateFromLayout,
  getSerializedDockviewSignature,
  getWorkbenchDockPanelId,
  getWorkbenchDockPanelReference,
  WORKBENCH_DOCK_PANEL_COMPONENT,
  WORKBENCH_DOCK_TAB_COMPONENT,
  type WorkbenchDockviewCommands,
  type WorkbenchDockviewActiveChange,
  type WorkbenchDockviewActiveState,
  type WorkbenchDockPanelReference,
} from "./dockview-state"
import { WorkbenchPaneSurface, type WorkbenchPaneSurfaceProps } from "./WorkbenchPaneSurface"
import {
  queueRendererLayoutWrite,
  type RendererFrameTaskCancel,
} from "../renderer-frame-coordinator"

type DetachedSessionPanelBounds = { x: number; y: number; width: number; height: number }
type DockviewLayoutSize = { width: number; height: number }
type DockviewLayoutDebugEventType = "observed" | "queued" | "coalesced" | "skipped-same-size" | "layout"
type DockviewLayoutDebugSource = "element" | "resize-observer" | "window-resize"
type WorkbenchDropPlacement = "within" | "left" | "right" | "top" | "bottom"
type WorkbenchPanelDragPayload = {
  dragID: string
  panelID: string
  sourceSurfaceID: string
}
type DockviewLayoutDebugSample = {
  force: boolean
  height: number
  lastHeight: number | null
  lastWidth: number | null
  pending: boolean
  source: DockviewLayoutDebugSource
  time: number
  type: DockviewLayoutDebugEventType
  width: number
}
type DockviewLayoutDebugSize = {
  height: number
  width: number
}
type DockviewLayoutDebugSummary = {
  alternatingSizeCount: number
  appliedSamples: number
  firstSize: DockviewLayoutDebugSize | null
  heightDeltas: Record<string, number>
  heightRange: DockviewLayoutDebugSize["height"][] | null
  lastSize: DockviewLayoutDebugSize | null
  maxAbsHeightDelta: number
  maxAbsWidthDelta: number
  sourceCounts: Record<DockviewLayoutDebugSource, number>
  uniqueSizeCount: number
  widthDeltas: Record<string, number>
  widthRange: DockviewLayoutDebugSize["width"][] | null
}
type DockviewLayoutDebugState = {
  applied: number
  coalesced: number
  enabled?: boolean
  observed: number
  queued: number
  samples: DockviewLayoutDebugSample[]
  summary: DockviewLayoutDebugSummary
  skippedSameSize: number
}
type DockviewLayoutDebugWindow = Window & {
  __ANYBOX_DOCKVIEW_LAYOUT_DEBUG__?: DockviewLayoutDebugState
}

const MIN_POPOUT_WIDTH = 720
const MIN_POPOUT_HEIGHT = 520
const WORKBENCH_PANEL_DRAG_MIME = "application/x-anybox-workbench-panel"
const DOCKVIEW_LAYOUT_DEBUG_SAMPLE_LIMIT = 180
const ANYBOX_DOCKVIEW_THEME = {
  name: "anybox",
  className: "dockview-theme-anybox",
  dndOverlayMounting: "absolute",
  dndPanelOverlay: "group",
  dndTabIndicator: "line",
  dndOverlayBorder: "1px solid var(--seg-accent)",
  tabGroupIndicator: "none",
} satisfies DockviewTheme

const emptyDockviewLayoutDebugSummary: DockviewLayoutDebugSummary = {
  alternatingSizeCount: 0,
  appliedSamples: 0,
  firstSize: null,
  heightDeltas: {},
  heightRange: null,
  lastSize: null,
  maxAbsHeightDelta: 0,
  maxAbsWidthDelta: 0,
  sourceCounts: {
    element: 0,
    "resize-observer": 0,
    "window-resize": 0,
  },
  uniqueSizeCount: 0,
  widthDeltas: {},
  widthRange: null,
}

function useWorkbenchPanelState(
  store: WorkspaceStoreApi,
  platform: string,
  groupID: string,
  panelID?: string,
  reference?: WorkbenchDockPanelReference | null,
) {
  return useWorkspaceStoreSelector(
    store,
    (state) => buildWorkbenchPanelRenderState(
      buildWorkspaceDerivedStateInputFromStore(state, platform, seedWorkspaceIDs),
      groupID,
      panelID,
      reference,
    ),
    workbenchPaneStatesAreEqual,
  )
}

function useWorkbenchTabHeaderState(
  store: WorkspaceStoreApi,
  groupID: string,
  panelID: string,
) {
  return useWorkspaceStoreSelector(
    store,
    (state) => buildWorkbenchTabHeaderState({
      createSessionTabs: state.sessions.createSessionTabs,
      dockviewActiveState: state.workbench.dockviewActiveState,
      dockviewLayout: state.workbench.dockviewLayout,
      workspaces: state.sessions.workspaces,
    }, groupID, panelID),
    workbenchTabHeaderStatesAreEqual,
  )
}

function useWorkbenchHeaderState(
  store: WorkspaceStoreApi,
  groupID: string,
  panelID?: string,
) {
  return useWorkspaceStoreSelector(
    store,
    (state) => buildWorkbenchHeaderState({
      createSessionTabs: state.sessions.createSessionTabs,
      dockviewActiveState: state.workbench.dockviewActiveState,
      dockviewLayout: state.workbench.dockviewLayout,
      workspaces: state.sessions.workspaces,
    }, groupID, panelID),
    workbenchHeaderStatesAreEqual,
  )
}

function useWorkbenchPanelTitleMap(store: WorkspaceStoreApi) {
  return useWorkspaceStoreSelector(
    store,
    (state) => buildWorkbenchPanelTitleMap({
      createSessionTabs: state.sessions.createSessionTabs,
      dockviewLayout: state.workbench.dockviewLayout,
      workspaces: state.sessions.workspaces,
    }),
    shallowEqualObjects,
  )
}

function useWorkbenchGridPaneIDs(store: WorkspaceStoreApi) {
  return useWorkspaceStoreSelector(
    store,
    (state) => getWorkbenchGridPaneIDs(state.workbench.dockviewLayout),
    shallowEqualArrays,
  )
}

function readWorkbenchPaneStateForPanel(
  store: WorkspaceStoreApi,
  platform: string,
  groupID: string,
  panelID?: string,
) {
  return buildWorkbenchPaneState(
    buildWorkspaceDerivedStateInputFromStore(store.getState(), platform, seedWorkspaceIDs),
    groupID,
    panelID,
  )
}

function clearDockviewLayout(dockviewApi: DockviewApi) {
  try {
    dockviewApi.clear()
  } catch (error) {
    console.warn("[desktop] Failed to clear Dockview workbench layout.", error)
  }
}

function publishTestDockviewApi(dockviewApi: DockviewApi | null) {
  if (import.meta.env.MODE !== "test") return
  const testWindow = window as Window & { __anyboxWorkbenchDockviewApi?: DockviewApi | null }
  testWindow.__anyboxWorkbenchDockviewApi = dockviewApi
}

function readDockviewActiveState(dockviewApi: DockviewApi): WorkbenchDockviewActiveState {
  const activePanelIDByGroupID: Record<string, string | null> = {}
  for (const group of dockviewApi.groups) {
    activePanelIDByGroupID[group.id] = group.activePanel?.id ?? null
  }

  return {
    activeGroupID: dockviewApi.activeGroup?.id ?? dockviewApi.activePanel?.group.id ?? null,
    activePanelIDByGroupID,
  }
}

function getDockviewActiveSignature(activeState: WorkbenchDockviewActiveState) {
  return [
    activeState.activeGroupID ?? "",
    ...Object.entries(activeState.activePanelIDByGroupID)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([groupID, panelID]) => `${groupID}:${panelID ?? ""}`),
  ].join("\u0000")
}

function createDockviewLayoutSize(width: number, height: number): DockviewLayoutSize | null {
  const roundedWidth = Math.round(width)
  const roundedHeight = Math.round(height)
  if (roundedWidth <= 0 || roundedHeight <= 0) return null
  return {
    height: roundedHeight,
    width: roundedWidth,
  }
}

function readResizeObserverEntrySize(entry: ResizeObserverEntry): DockviewLayoutSize | null {
  const borderBoxSize = entry.borderBoxSize
  const boxSize = Array.isArray(borderBoxSize) ? borderBoxSize[0] : borderBoxSize
  const width = typeof boxSize?.inlineSize === "number" ? boxSize.inlineSize : entry.contentRect.width
  const height = typeof boxSize?.blockSize === "number" ? boxSize.blockSize : entry.contentRect.height
  return createDockviewLayoutSize(width, height)
}

function readElementLayoutSize(element: HTMLElement): DockviewLayoutSize | null {
  const rect = element.getBoundingClientRect()
  return createDockviewLayoutSize(rect.width, rect.height)
}

function dockviewLayoutSizesAreEqual(left: DockviewLayoutSize | null, right: DockviewLayoutSize | null) {
  return left?.width === right?.width && left?.height === right?.height
}

function isDockviewLayoutDebugEnabled() {
  if (typeof window === "undefined") return false
  const debugWindow = window as DockviewLayoutDebugWindow
  if (debugWindow.__ANYBOX_DOCKVIEW_LAYOUT_DEBUG__?.enabled === true) return true

  try {
    return window.localStorage.getItem("anybox:dockview-layout-debug") === "1"
  } catch {
    return false
  }
}

function readDockviewLayoutDebugState(): DockviewLayoutDebugState | null {
  if (!isDockviewLayoutDebugEnabled()) return null

  const debugWindow = window as DockviewLayoutDebugWindow
  const existing = debugWindow.__ANYBOX_DOCKVIEW_LAYOUT_DEBUG__
  if (existing && Array.isArray(existing.samples)) {
    existing.summary ??= emptyDockviewLayoutDebugSummary
    return existing
  }

  const state: DockviewLayoutDebugState = {
    applied: 0,
    coalesced: 0,
    enabled: true,
    observed: 0,
    queued: 0,
    samples: [],
    summary: emptyDockviewLayoutDebugSummary,
    skippedSameSize: 0,
  }
  debugWindow.__ANYBOX_DOCKVIEW_LAYOUT_DEBUG__ = state
  return state
}

function incrementDockviewLayoutDeltaCount(deltaCounts: Record<string, number>, delta: number) {
  const key = delta > 0 ? `+${delta}` : String(delta)
  deltaCounts[key] = (deltaCounts[key] ?? 0) + 1
}

function createDockviewLayoutDebugSummary(samples: DockviewLayoutDebugSample[]): DockviewLayoutDebugSummary {
  const layoutSamples = samples.filter((sample) => sample.type === "layout")
  if (layoutSamples.length === 0) return emptyDockviewLayoutDebugSummary

  const uniqueSizes = new Set<string>()
  const widthDeltas: Record<string, number> = {}
  const heightDeltas: Record<string, number> = {}
  const sourceCounts: Record<DockviewLayoutDebugSource, number> = {
    element: 0,
    "resize-observer": 0,
    "window-resize": 0,
  }
  let minWidth = Number.POSITIVE_INFINITY
  let maxWidth = Number.NEGATIVE_INFINITY
  let minHeight = Number.POSITIVE_INFINITY
  let maxHeight = Number.NEGATIVE_INFINITY
  let maxAbsWidthDelta = 0
  let maxAbsHeightDelta = 0
  let alternatingSizeCount = 0

  for (let i = 0; i < layoutSamples.length; i += 1) {
    const sample = layoutSamples[i]
    uniqueSizes.add(`${sample.width}x${sample.height}`)
    sourceCounts[sample.source] += 1
    minWidth = Math.min(minWidth, sample.width)
    maxWidth = Math.max(maxWidth, sample.width)
    minHeight = Math.min(minHeight, sample.height)
    maxHeight = Math.max(maxHeight, sample.height)

    const previous = layoutSamples[i - 1]
    if (previous) {
      const widthDelta = sample.width - previous.width
      const heightDelta = sample.height - previous.height
      incrementDockviewLayoutDeltaCount(widthDeltas, widthDelta)
      incrementDockviewLayoutDeltaCount(heightDeltas, heightDelta)
      maxAbsWidthDelta = Math.max(maxAbsWidthDelta, Math.abs(widthDelta))
      maxAbsHeightDelta = Math.max(maxAbsHeightDelta, Math.abs(heightDelta))
    }

    const twoBack = layoutSamples[i - 2]
    if (
      previous &&
      twoBack &&
      sample.width === twoBack.width &&
      sample.height === twoBack.height &&
      (sample.width !== previous.width || sample.height !== previous.height)
    ) {
      alternatingSizeCount += 1
    }
  }

  const firstSample = layoutSamples[0]
  const lastSample = layoutSamples[layoutSamples.length - 1]

  return {
    alternatingSizeCount,
    appliedSamples: layoutSamples.length,
    firstSize: {
      height: firstSample.height,
      width: firstSample.width,
    },
    heightDeltas,
    heightRange: [minHeight, maxHeight],
    lastSize: {
      height: lastSample.height,
      width: lastSample.width,
    },
    maxAbsHeightDelta,
    maxAbsWidthDelta,
    sourceCounts,
    uniqueSizeCount: uniqueSizes.size,
    widthDeltas,
    widthRange: [minWidth, maxWidth],
  }
}

function recordDockviewLayoutDebugSample(
  type: DockviewLayoutDebugEventType,
  size: DockviewLayoutSize,
  input: {
    force: boolean
    lastSize: DockviewLayoutSize | null
    pending: boolean
    source: DockviewLayoutDebugSource
  },
) {
  const state = readDockviewLayoutDebugState()
  if (!state) return

  if (type === "observed") state.observed += 1
  if (type === "queued") state.queued += 1
  if (type === "coalesced") state.coalesced += 1
  if (type === "skipped-same-size") state.skippedSameSize += 1
  if (type === "layout") state.applied += 1

  state.samples.push({
    force: input.force,
    height: size.height,
    lastHeight: input.lastSize?.height ?? null,
    lastWidth: input.lastSize?.width ?? null,
    pending: input.pending,
    source: input.source,
    time: Number(performance.now().toFixed(2)),
    type,
    width: size.width,
  })
  if (state.samples.length > DOCKVIEW_LAYOUT_DEBUG_SAMPLE_LIMIT) {
    state.samples.splice(0, state.samples.length - DOCKVIEW_LAYOUT_DEBUG_SAMPLE_LIMIT)
  }
  state.summary = createDockviewLayoutDebugSummary(state.samples)
}

function isPointOutsideElement(element: HTMLElement, clientX: number, clientY: number) {
  const rect = element.getBoundingClientRect()
  return clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom
}

function isDockviewGroupInGrid(group: ReturnType<DockviewApi["getGroup"]> | undefined) {
  return group?.api.location.type === "grid"
}

function resolveDockviewPanelPosition(
  api: DockviewApi,
  options?: { targetGroupID?: string | null; direction?: "left" | "right" | "above" | "below" | "within" },
) {
  const targetGroup = options?.targetGroupID ? api.getGroup(options.targetGroupID) : undefined
  const referenceGroup = isDockviewGroupInGrid(targetGroup)
    ? targetGroup
    : isDockviewGroupInGrid(api.activeGroup)
      ? api.activeGroup
      : api.groups.find((group) => isDockviewGroupInGrid(group))

  return referenceGroup
    ? {
        direction: options?.direction ?? "within",
        referenceGroup: referenceGroup.id,
      }
    : undefined
}

function readWorkbenchPanelDrag(event: DragEvent): WorkbenchPanelDragPayload | null {
  const rawValue = event.dataTransfer?.getData(WORKBENCH_PANEL_DRAG_MIME)
  if (!rawValue) return null

  try {
    const parsed = JSON.parse(rawValue) as {
      dragID?: string
      panelID?: string
      sourceSurfaceID?: string
    }
    return parsed.dragID && parsed.panelID && parsed.sourceSurfaceID
      ? {
          dragID: parsed.dragID,
          panelID: parsed.panelID,
          sourceSurfaceID: parsed.sourceSurfaceID,
        }
      : null
  } catch {
    return null
  }
}

function hasWorkbenchPanelDragType(event: DragEvent) {
  const types = Array.from(event.dataTransfer?.types ?? [])
  return types.includes(WORKBENCH_PANEL_DRAG_MIME) || types.includes("text/plain")
}

function getDropPlacement(rect: DOMRect, clientX: number, clientY: number): WorkbenchDropPlacement {
  const leftRatio = (clientX - rect.left) / Math.max(rect.width, 1)
  const topRatio = (clientY - rect.top) / Math.max(rect.height, 1)
  const rightRatio = 1 - leftRatio
  const bottomRatio = 1 - topRatio
  const edgeThreshold = 0.22
  const nearestEdge = Math.min(leftRatio, rightRatio, topRatio, bottomRatio)
  if (nearestEdge > edgeThreshold) return "within"
  if (nearestEdge === leftRatio) return "left"
  if (nearestEdge === rightRatio) return "right"
  if (nearestEdge === topRatio) return "top"
  return "bottom"
}

function getDropTarget(input: {
  clientX: number
  clientY: number
  root: HTMLElement
}) {
  const paneElement = document.elementFromPoint(input.clientX, input.clientY)?.closest<HTMLElement>("[data-pane-id]")
  if (paneElement && input.root.contains(paneElement)) {
    return {
      placement: getDropPlacement(paneElement.getBoundingClientRect(), input.clientX, input.clientY),
      targetGroupID: paneElement.dataset.paneId ?? null,
    }
  }

  return {
    placement: "within" as const,
    targetGroupID: null,
  }
}

function getDetachedSessionPanelBounds(panel: IDockviewPanel, event?: DragEvent): DetachedSessionPanelBounds {
  const rect = panel.group.element.getBoundingClientRect()
  const width = Math.max(Math.round(rect.width), MIN_POPOUT_WIDTH)
  const height = Math.max(Math.round(rect.height), MIN_POPOUT_HEIGHT)
  const hasScreenPoint = event && Number.isFinite(event.screenX) && Number.isFinite(event.screenY)
  const x = hasScreenPoint ? Math.round(event.screenX - width / 2) : Math.round(window.screenX + rect.left)
  const y = hasScreenPoint ? Math.round(event.screenY - 24) : Math.round(window.screenY + rect.top)

  return {
    height,
    x,
    y,
    width,
  }
}

function activateDockviewPanel(panel: IDockviewPanel) {
  panel.api.setActive()
  panel.group.focus()
}

export interface WorkbenchShellProps {
  assistantTraceVisibility: AssistantTraceVisibility
  composerCommandStatusByTabKey?: Record<string, ComposerCommandStatus>
  composerRefreshVersion: number
  isActivityRailVisible: boolean
  isResolvingPermissionRequest: boolean
  isSavingToolPermissionMode: boolean
  isRightSidebarCollapsed: boolean
  isSidebarCollapsed: boolean
  platform: string
  store: WorkspaceStoreApi
  windowControls?: ReactNode
  surfaceID: string
  permissionRequestActionError: string | null
  permissionRequestActionRequestID: string | null
  toolPermissionMode: ToolPermissionMode
  toolPermissionModeError: string | null
  conversationWorkspaceID?: string | null
  readThreadScrollSnapshot: (key: string) => ThreadScrollSnapshot | null
  saveThreadScrollSnapshot: (key: string, snapshot: ThreadScrollSnapshot) => void
  threadNavigationRequestBySession?: Record<string, ThreadNavigationRequest>
  onCloseCreateSessionTab: (createSessionTabID: string, paneID?: string, options?: { force?: boolean }) => void
  onCloseSessionTab: (sessionID: string, paneID?: string) => void
  onCreateSessionSubmit: (createSessionTabID?: string | null, paneID?: string) => Promise<void>
  onCreateSessionWorkspaceChange: (workspaceID: string, createSessionTabID?: string | null) => void
  onOpenProjectFolder: () => void | Promise<void>
  onActiveDockviewChange: (input: WorkbenchDockviewActiveChange) => void
  onDetachSessionPanel?: (input: {
    bounds: DetachedSessionPanelBounds
    groupID: string
    panelID: string
    reference: Extract<WorkbenchDockPanelReference, { kind: "session" }>
    title: string
  }) => boolean | Promise<boolean>
  onDockBack?: (panelID?: string) => void
  onFocusPane: (paneID: string) => void
  onInspectFileInSidebar: (file: string | null, sessionID: string | null, paneID: string) => void
  onCommandsReady: (commands: WorkbenchDockviewCommands | null) => void
  onLayoutChange: (layout: SerializedDockview | null) => void
  onArtifactLinkOpen?: (input: {
    paneID: string
    sessionID: string | null
    target: MarkdownArtifactLinkTarget
    workspaceDirectory: string | null
    workspaceID: string | null
  }) => void
  onLocalFileLinkOpen: (input: {
    paneID: string
    sessionID: string | null
    target: MarkdownLocalFileLinkTarget
    workspaceDirectory: string | null
    workspaceID: string | null
  }) => void
  onMoveSessionPanel?: (input: {
    panelID: string
    placement: WorkbenchDropPlacement
    sourceSurfaceID: string
    targetGroupID?: string | null
    targetSurfaceID: string
  }) => boolean | Promise<boolean>
  onOpenCreateSessionTab: (preferredWorkspaceID?: string | null, paneID?: string) => void
  onOpenSideChat?: WorkbenchPaneSurfaceProps["onOpenSideChat"]
  onOpenSubagentSession?: WorkbenchPaneSurfaceProps["onOpenSubagentSession"]
  onBranchSelect: WorkbenchPaneSurfaceProps["onBranchSelect"]
  onClearComposerParentMessage: WorkbenchPaneSurfaceProps["onClearComposerParentMessage"]
  onForkFromMessage: WorkbenchPaneSurfaceProps["onForkFromMessage"]
  onAskUserQuestionAnswer: WorkbenchPaneSurfaceProps["onAskUserQuestionAnswer"]
  onApproveProposedPlan: WorkbenchPaneSurfaceProps["onApproveProposedPlan"]
  onPermissionRequestResponse: WorkbenchPaneSurfaceProps["onPermissionRequestResponse"]
  onToolPermissionModeChange: (mode: ToolPermissionMode) => void | Promise<void>
  onPickComposerAttachments: WorkbenchPaneSurfaceProps["onPickComposerAttachments"]
  onPasteComposerImageAttachments: WorkbenchPaneSurfaceProps["onPasteComposerImageAttachments"]
  onRemoveComposerAttachment: (path: string, tabKey?: string | null) => void
  onSelectCreateSessionTab: (createSessionTabID: string, paneID?: string) => void
  onSelectSessionTab: (sessionID: string, paneID?: string) => void
  onCancelSend: WorkbenchPaneSurfaceProps["onCancelSend"]
  onPlanModeToggle: WorkbenchPaneSurfaceProps["onPlanModeToggle"]
  onSend: WorkbenchPaneSurfaceProps["onSend"]
  onSessionModelSelectionChange: WorkbenchPaneSurfaceProps["onSessionModelSelectionChange"]
  onSetDraft: (tabKey: string, value: ComposerDraftState) => void
  onToggleLeftSidebar: () => void
  onToggleRightSidebar: () => void
  onMessageDiffRestore: (diffs: SessionDiffFile[], sessionID: string | null, paneID: string) => void | Promise<void>
  onMessageDiffReview: (files: string[], sessionID: string | null, paneID: string) => void | Promise<void>
  onMessageDiffSummaryHydrate: (messageID: string, diffSummary: SessionDiffSummary, sessionID?: string | null) => void | Promise<void>
  isDetachedWindow?: boolean
}

const WorkbenchShellContext = createContext<WorkbenchShellProps | null>(null)

function useWorkbenchShellContext() {
  const props = useContext(WorkbenchShellContext)
  if (!props) {
    throw new Error("Workbench Dockview components must be rendered inside WorkbenchShell.")
  }
  return props
}

export function WorkbenchShell(props: WorkbenchShellProps) {
  const [api, setApi] = useState<DockviewApi | null>(null)
  const dockviewLayout = useWorkspaceStoreSelector(props.store, (state) => state.workbench.dockviewLayout)
  const panelTitles = useWorkbenchPanelTitleMap(props.store)
  const gridPaneIDs = useWorkbenchGridPaneIDs(props.store)
  const workbenchElementRef = useRef<HTMLDivElement | null>(null)
  const latestPropsRef = useRef(props)
  const latestDragPayloadRef = useRef<WorkbenchPanelDragPayload | null>(null)
  const isApplyingLayoutRef = useRef(false)
  const pendingDetachOperationCountRef = useRef(0)
  const dockviewLayoutTaskKeyRef = useRef(createID("dockview-layout"))
  const pendingDockviewLayoutCancelRef = useRef<RendererFrameTaskCancel | null>(null)
  const pendingDockviewLayoutForceRef = useRef(false)
  const pendingDockviewLayoutSizeRef = useRef<DockviewLayoutSize | null>(null)
  const pendingDockviewLayoutSourceRef = useRef<DockviewLayoutDebugSource>("element")
  const lastDockviewLayoutSizeRef = useRef<DockviewLayoutSize | null>(null)
  const lastAppliedSerializedSignatureRef = useRef<string | null>(null)
  const lastEmittedSerializedSignatureRef = useRef(getSerializedDockviewSignature(dockviewLayout))
  const lastEmittedActiveSignatureRef = useRef<string | null>(null)
  const hasMultiplePanes = gridPaneIDs.length > 1
  latestPropsRef.current = props

  const emitActiveDockviewChangeFromState = useCallback((activeState: WorkbenchDockviewActiveState) => {
    const groupID = activeState.activeGroupID
    const panelID = groupID ? activeState.activePanelIDByGroupID[groupID] ?? null : null
    const reference = panelID ? getWorkbenchDockPanelReference(panelID) : null
    const activeSignature = getDockviewActiveSignature(activeState)
    if (activeSignature === lastEmittedActiveSignatureRef.current) return

    lastEmittedActiveSignatureRef.current = activeSignature
    latestPropsRef.current.onActiveDockviewChange({
      activeState,
      groupID,
      panelID,
      reference,
    })
  }, [])

  const emitActiveDockviewChange = useCallback((dockviewApi: DockviewApi) => {
    emitActiveDockviewChangeFromState(readDockviewActiveState(dockviewApi))
  }, [emitActiveDockviewChangeFromState])

  const emitActiveDockviewPanel = useCallback((dockviewApi: DockviewApi, panel: IDockviewPanel) => {
    const groupID = panel.group.id
    const activeState = readDockviewActiveState(dockviewApi)
    emitActiveDockviewChangeFromState({
      activeGroupID: groupID,
      activePanelIDByGroupID: {
        ...activeState.activePanelIDByGroupID,
        [groupID]: panel.id,
      },
    })
  }, [emitActiveDockviewChangeFromState])

  const emitActiveDockviewChangeFromLayout = useCallback((layout: SerializedDockview | null) => {
    emitActiveDockviewChangeFromState(createDockviewActiveStateFromLayout(layout))
  }, [emitActiveDockviewChangeFromState])

  const queueDockviewLayout = useCallback((dockviewApi: DockviewApi, size: DockviewLayoutSize, options?: { force?: boolean; source?: DockviewLayoutDebugSource }) => {
    const force = options?.force === true
    const source = options?.source ?? "resize-observer"
    const lastSize = lastDockviewLayoutSizeRef.current
    const hasPendingLayout = pendingDockviewLayoutCancelRef.current !== null

    if (!force && !hasPendingLayout && dockviewLayoutSizesAreEqual(lastSize, size)) {
      recordDockviewLayoutDebugSample("skipped-same-size", size, {
        force,
        lastSize,
        pending: false,
        source,
      })
      return
    }

    pendingDockviewLayoutSizeRef.current = size
    pendingDockviewLayoutSourceRef.current = source
    pendingDockviewLayoutForceRef.current = pendingDockviewLayoutForceRef.current || force
    if (hasPendingLayout) {
      recordDockviewLayoutDebugSample("coalesced", size, {
        force,
        lastSize,
        pending: true,
        source,
      })
      return
    }

    recordDockviewLayoutDebugSample("queued", size, {
      force,
      lastSize,
      pending: false,
      source,
    })

    pendingDockviewLayoutCancelRef.current = queueRendererLayoutWrite(dockviewLayoutTaskKeyRef.current, () => {
      pendingDockviewLayoutCancelRef.current = null
      const nextSize = pendingDockviewLayoutSizeRef.current
      const shouldForce = pendingDockviewLayoutForceRef.current
      const pendingSource = pendingDockviewLayoutSourceRef.current
      pendingDockviewLayoutForceRef.current = false
      if (!nextSize) return

      const previousSize = lastDockviewLayoutSizeRef.current
      if (!shouldForce && dockviewLayoutSizesAreEqual(previousSize, nextSize)) {
        recordDockviewLayoutDebugSample("skipped-same-size", nextSize, {
          force: shouldForce,
          lastSize: previousSize,
          pending: false,
          source: pendingSource,
        })
        return
      }

      lastDockviewLayoutSizeRef.current = nextSize
      recordDockviewLayoutDebugSample("layout", nextSize, {
        force: shouldForce,
        lastSize: previousSize,
        pending: false,
        source: pendingSource,
      })
      dockviewApi.layout(nextSize.width, nextSize.height, false)
    })
  }, [])

  const syncDockviewFromLayout = useCallback((dockviewApi: DockviewApi, serialized: SerializedDockview | null) => {
    const serializedSignature = getSerializedDockviewSignature(serialized)
    if (serializedSignature === lastAppliedSerializedSignatureRef.current) return

    isApplyingLayoutRef.current = true
    try {
      let appliedLayout: SerializedDockview | null = null
      if (serialized) {
        dockviewApi.fromJSON(serialized, { reuseExistingPanels: true })
        appliedLayout = dockviewApi.toJSON()
      } else {
        clearDockviewLayout(dockviewApi)
      }
      const appliedSignature = getSerializedDockviewSignature(appliedLayout)
      lastAppliedSerializedSignatureRef.current = appliedSignature
      lastEmittedSerializedSignatureRef.current = appliedSignature
      if (appliedSignature !== serializedSignature) {
        latestPropsRef.current.onLayoutChange(appliedLayout)
      }
      emitActiveDockviewChangeFromLayout(appliedLayout)
    } catch (error) {
      console.warn("[desktop] Failed to apply Dockview workbench layout; using an empty layout.", error)
      clearDockviewLayout(dockviewApi)
      const emptySignature = getSerializedDockviewSignature(null)
      lastAppliedSerializedSignatureRef.current = emptySignature
      lastEmittedSerializedSignatureRef.current = emptySignature
      if (serializedSignature !== emptySignature) {
        latestPropsRef.current.onLayoutChange(null)
      }
      emitActiveDockviewChangeFromLayout(null)
    } finally {
      isApplyingLayoutRef.current = false
    }
  }, [emitActiveDockviewChangeFromLayout])

  const readDockviewSnapshot = useCallback((dockviewApi: DockviewApi): SerializedDockview | null => {
    try {
      if (dockviewApi.totalPanels === 0) return null
      return dockviewApi.toJSON()
    } catch (error) {
      console.warn("[desktop] Failed to serialize Dockview workbench layout.", error)
      return null
    }
  }, [])

  const emitDockviewSnapshot = useCallback((dockviewApi: DockviewApi, options?: { force?: boolean }) => {
    if (!options?.force && isApplyingLayoutRef.current) return readDockviewSnapshot(dockviewApi)
    if (!options?.force && pendingDetachOperationCountRef.current > 0) return readDockviewSnapshot(dockviewApi)

    const serialized = readDockviewSnapshot(dockviewApi)
    const serializedSignature = getSerializedDockviewSignature(serialized)
    lastAppliedSerializedSignatureRef.current = serializedSignature
    if (serializedSignature !== lastEmittedSerializedSignatureRef.current) {
      lastEmittedSerializedSignatureRef.current = serializedSignature
      latestPropsRef.current.onLayoutChange(serialized)
    }
    emitActiveDockviewChangeFromLayout(serialized)
    return serialized
  }, [emitActiveDockviewChangeFromLayout, readDockviewSnapshot])

  const detachSessionPanel = useCallback(async (dockviewApi: DockviewApi, panel: IDockviewPanel, event?: DragEvent) => {
    const reference = getWorkbenchDockPanelReference(panel.id)
    if (reference?.kind !== "session") return false

    const currentProps = latestPropsRef.current
    const pane = readWorkbenchPaneStateForPanel(currentProps.store, currentProps.platform, panel.group.id, panel.id)
    const title = pane?.tabs.find((tab) => tab.key === panel.id)?.title ?? panel.title ?? "Session"
    const detach = currentProps.onDetachSessionPanel
    if (!detach) return false

    let didCloseDetachedPanel = false
    pendingDetachOperationCountRef.current += 1
    try {
      const didDetach = await detach({
        bounds: getDetachedSessionPanelBounds(panel, event),
        groupID: panel.group.id,
        panelID: panel.id,
        reference,
        title,
      })
      if (!didDetach) return false

      panel.api.close()
      didCloseDetachedPanel = true
      return true
    } catch (error) {
      console.warn("[desktop] Failed to detach session panel.", error)
      return false
    } finally {
      pendingDetachOperationCountRef.current = Math.max(0, pendingDetachOperationCountRef.current - 1)
      if (didCloseDetachedPanel) {
        emitDockviewSnapshot(dockviewApi, { force: true })
      }
    }
  }, [emitDockviewSnapshot])

  const handleReady = useCallback((event: DockviewReadyEvent) => {
    setApi(event.api)
    publishTestDockviewApi(event.api)
    const currentProps = latestPropsRef.current
    syncDockviewFromLayout(event.api, currentProps.store.getState().workbench.dockviewLayout)
  }, [syncDockviewFromLayout])

  useEffect(() => {
    return () => publishTestDockviewApi(null)
  }, [])

  useEffect(() => {
    if (!api) return
    syncDockviewFromLayout(api, dockviewLayout)
  }, [api, dockviewLayout, syncDockviewFromLayout])

  useEffect(() => {
    if (!api) return

    const element = workbenchElementRef.current
    if (!element) return

    lastDockviewLayoutSizeRef.current = null

    const queueCurrentLayout = (force = false, source: DockviewLayoutDebugSource = "element") => {
      const size = readElementLayoutSize(element)
      if (!size) return
      recordDockviewLayoutDebugSample("observed", size, {
        force,
        lastSize: lastDockviewLayoutSizeRef.current,
        pending: pendingDockviewLayoutCancelRef.current !== null,
        source,
      })
      queueDockviewLayout(api, size, { force, source })
    }

    queueCurrentLayout(true)

    if (typeof ResizeObserver === "undefined") {
      const handleWindowResize = () => queueCurrentLayout(false, "window-resize")
      window.addEventListener("resize", handleWindowResize)
      return () => {
        window.removeEventListener("resize", handleWindowResize)
        pendingDockviewLayoutCancelRef.current?.()
        pendingDockviewLayoutCancelRef.current = null
        pendingDockviewLayoutSizeRef.current = null
        pendingDockviewLayoutSourceRef.current = "element"
        pendingDockviewLayoutForceRef.current = false
      }
    }

    const resizeObserver = new ResizeObserver((entries) => {
      const size = entries[0] ? readResizeObserverEntrySize(entries[0]) : null
      if (!size) return
      recordDockviewLayoutDebugSample("observed", size, {
        force: false,
        lastSize: lastDockviewLayoutSizeRef.current,
        pending: pendingDockviewLayoutCancelRef.current !== null,
        source: "resize-observer",
      })
      queueDockviewLayout(api, size, { source: "resize-observer" })
    })
    resizeObserver.observe(element)

    return () => {
      resizeObserver.disconnect()
      pendingDockviewLayoutCancelRef.current?.()
      pendingDockviewLayoutCancelRef.current = null
      pendingDockviewLayoutSizeRef.current = null
      pendingDockviewLayoutSourceRef.current = "element"
      pendingDockviewLayoutForceRef.current = false
    }
  }, [api, queueDockviewLayout])

  useEffect(() => {
    if (!api || !dockviewLayout || api.totalPanels > 0) return

    const frameID = window.requestAnimationFrame(() => {
      if (api.totalPanels > 0) return

      const currentLayout = latestPropsRef.current.store.getState().workbench.dockviewLayout
      if (!currentLayout) return

      const emptySignature = getSerializedDockviewSignature(null)
      lastAppliedSerializedSignatureRef.current = emptySignature
      lastEmittedSerializedSignatureRef.current = emptySignature
      latestPropsRef.current.onLayoutChange(null)
      emitActiveDockviewChangeFromLayout(null)
    })

    return () => window.cancelAnimationFrame(frameID)
  }, [api, dockviewLayout, emitActiveDockviewChangeFromLayout])

  useEffect(() => {
    if (!api) return

    for (const [panelID, title] of Object.entries(panelTitles)) {
      const panel = api.getPanel(panelID)
      if (panel && title && panel.title !== title) {
        panel.api.setTitle(title)
      }
    }
  }, [api, panelTitles])

  useEffect(() => {
    if (!api) return

    const disposables = [
      api.onDidLayoutChange(() => emitDockviewSnapshot(api)),
      api.onDidActivePanelChange(() => emitActiveDockviewChange(api)),
      api.onDidActiveGroupChange(() => emitActiveDockviewChange(api)),
    ]

    return () => {
      for (const disposable of disposables) {
        disposable.dispose()
      }
    }
  }, [api, emitActiveDockviewChange, emitDockviewSnapshot])

  useEffect(() => {
    if (!api) return

    const disposable = api.onWillDragPanel((event) => {
      const dragWindow = event.nativeEvent.view
      if (dragWindow && dragWindow !== window) return

      const panel = event.panel
      const reference = getWorkbenchDockPanelReference(panel.id)
      const dragID = createID("workbench-panel-drag")
      if (reference?.kind === "session") {
        const payload = {
          dragID,
          panelID: panel.id,
          sourceSurfaceID: latestPropsRef.current.surfaceID,
        }
        latestDragPayloadRef.current = payload
        try {
          const dataTransfer = "dataTransfer" in event.nativeEvent ? event.nativeEvent.dataTransfer : null
          dataTransfer?.setData(WORKBENCH_PANEL_DRAG_MIME, JSON.stringify(payload))
          dataTransfer?.setData("text/plain", panel.title ?? "Session")
        } catch {
          // Drag metadata is best-effort; the IPC drag token is the fallback for Electron windows.
        }
        void window.desktop?.beginWorkbenchPanelDrag?.(payload)
      }
      const handleDragEnd = (dragEndEvent: DragEvent) => {
        window.setTimeout(() => {
          void window.desktop?.endWorkbenchPanelDrag?.({ dragID })
          if (latestDragPayloadRef.current?.dragID === dragID) {
            latestDragPayloadRef.current = null
          }
        }, 500)
        const root = workbenchElementRef.current
        if (!root || panel.api.location.type !== "grid") return
        const isOutsideViewport =
          dragEndEvent.clientX <= 0 ||
          dragEndEvent.clientY <= 0 ||
          dragEndEvent.clientX >= window.innerWidth ||
          dragEndEvent.clientY >= window.innerHeight
        if (!isOutsideViewport && !isPointOutsideElement(root, dragEndEvent.clientX, dragEndEvent.clientY)) return
        if (latestPropsRef.current.isDetachedWindow && api.totalPanels <= 1) return

        void detachSessionPanel(api, panel, dragEndEvent)
      }

      window.addEventListener("dragend", handleDragEnd, { capture: true, once: true })
    })

    return () => disposable.dispose()
  }, [api, detachSessionPanel])

  useEffect(() => {
    if (!api) {
      latestPropsRef.current.onCommandsReady(null)
      return
    }

    const emitSnapshot = () => {
      return emitDockviewSnapshot(api)
    }
    const emitPanelActive = (panel: IDockviewPanel) => {
      emitActiveDockviewPanel(api, panel)
    }
    const addPanel = (
      reference: WorkbenchDockPanelReference,
      options?: { targetGroupID?: string | null; title?: string; activate?: boolean; direction?: "left" | "right" | "above" | "below" | "within" },
    ) => {
      const id = getWorkbenchDockPanelId(reference)
      const position = resolveDockviewPanelPosition(api, {
        direction: options?.direction,
        targetGroupID: options?.targetGroupID,
      })

      const panelOptions = {
        id,
        component: WORKBENCH_DOCK_PANEL_COMPONENT,
        tabComponent: WORKBENCH_DOCK_TAB_COMPONENT,
        params: reference,
        title: options?.title ?? (reference.kind === "session" ? "Session" : "Create session"),
        inactive: options?.activate === false,
        position,
      }
      let panel: IDockviewPanel
      try {
        panel = api.addPanel(panelOptions)
      } catch (error) {
        if (!position) throw error
        console.warn("[desktop] Failed to add Dockview panel at target group; adding to default group.", error)
        panel = api.addPanel({
          ...panelOptions,
          position: undefined,
        })
      }
      if (options?.activate !== false) {
        activateDockviewPanel(panel)
      }
      return panel
    }
    const openPanel: WorkbenchDockviewCommands["openPanel"] = (reference, options) => {
      const id = getWorkbenchDockPanelId(reference)
      const existing = api.getPanel(id)
      if (existing) {
        let didUpdateTitle = false
        if (options?.title && existing.title !== options.title) {
          existing.api.setTitle(options.title)
          didUpdateTitle = true
        }
        if (options?.activate !== false) {
          activateDockviewPanel(existing)
        }
        if (didUpdateTitle) {
          emitSnapshot()
        } else if (options?.activate !== false) {
          emitPanelActive(existing)
        }
        return true
      }

      const panel = addPanel(reference, {
        activate: options?.activate,
        targetGroupID: options?.targetGroupID,
        title: options?.title,
      })
      emitSnapshot()
      if (options?.activate !== false) {
        emitPanelActive(panel)
      }
      return true
    }
    const focusPanel: WorkbenchDockviewCommands["focusPanel"] = (reference) => {
      const id = getWorkbenchDockPanelId(reference)
      const panel = api.getPanel(id)
      if (!panel) return false
      activateDockviewPanel(panel)
      emitPanelActive(panel)
      return true
    }
    const closePanel: WorkbenchDockviewCommands["closePanel"] = (reference) => {
      const id = getWorkbenchDockPanelId(reference)
      const panel = api.getPanel(id)
      if (!panel) return false
      panel.api.close()
      emitSnapshot()
      return true
    }
    const popoutPanel: WorkbenchDockviewCommands["popoutPanel"] = (reference) => {
      const id = getWorkbenchDockPanelId(reference)
      const panel = api.getPanel(id)
      if (!panel) return false
      void detachSessionPanel(api, panel)
      return true
    }
    const commands: WorkbenchDockviewCommands = {
      openPanel,
      focusPanel,
      closePanel,
      popoutPanel,
      replacePanel: (currentReference, nextReference, options) => {
        const currentID = getWorkbenchDockPanelId(currentReference)
        const nextID = getWorkbenchDockPanelId(nextReference)
        const currentPanel = api.getPanel(currentID)
        const existingNextPanel = api.getPanel(nextID)
        if (existingNextPanel) {
          activateDockviewPanel(existingNextPanel)
          currentPanel?.api.close()
          emitSnapshot()
          emitPanelActive(existingNextPanel)
          return true
        }
        if (!currentPanel) {
          return openPanel(nextReference, { title: options?.title })
        }

        const panel = addPanel(nextReference, {
          targetGroupID: currentPanel.group.id,
          title: options?.title,
        })
        currentPanel.api.close()
        emitSnapshot()
        emitPanelActive(panel)
        return true
      },
      splitPanel: (reference, options) => {
        const id = getWorkbenchDockPanelId(reference)
        const direction = options.direction === "top" ? "above" : options.direction === "bottom" ? "below" : options.direction
        const targetGroupID = options.targetGroupID ?? api.activeGroup?.id ?? null
        const existing = api.getPanel(id)
        const targetGroup = targetGroupID ? api.getGroup(targetGroupID) : undefined
        if (existing && isDockviewGroupInGrid(targetGroup)) {
          existing.api.moveTo({
            group: targetGroup as any,
            position: options.direction === "top" ? "top" : options.direction === "bottom" ? "bottom" : options.direction,
          })
          activateDockviewPanel(existing)
          emitSnapshot()
          emitPanelActive(existing)
          return true
        }
        const panel = addPanel(reference, {
          direction,
          targetGroupID,
          title: options.title,
        })
        emitSnapshot()
        emitPanelActive(panel)
        return true
      },
      getSnapshot: () => readDockviewSnapshot(api),
    }

    latestPropsRef.current.onCommandsReady(commands)
    return () => latestPropsRef.current.onCommandsReady(null)
  }, [api, detachSessionPanel, emitActiveDockviewPanel, emitDockviewSnapshot, readDockviewSnapshot])

  const handleWorkbenchDragOver = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
    const dragPayload = readWorkbenchPanelDrag(event.nativeEvent)
    if (dragPayload?.sourceSurfaceID === latestPropsRef.current.surfaceID) return
    if (!dragPayload && !hasWorkbenchPanelDragType(event.nativeEvent)) return
    if (!latestPropsRef.current.onMoveSessionPanel) return
    event.preventDefault()
    event.dataTransfer.dropEffect = "move"
  }, [])

  const handleWorkbenchDrop = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
    const dragPayload = readWorkbenchPanelDrag(event.nativeEvent) ?? latestDragPayloadRef.current
    if (dragPayload?.sourceSurfaceID === latestPropsRef.current.surfaceID) return
    if (!dragPayload && !hasWorkbenchPanelDragType(event.nativeEvent)) return
    const movePanel = latestPropsRef.current.onMoveSessionPanel
    const root = workbenchElementRef.current
    if (!movePanel || !root) return

    event.preventDefault()
    event.stopPropagation()
    const target = getDropTarget({
      clientX: event.clientX,
      clientY: event.clientY,
      root,
    })
    void (async () => {
      const resolvedPayload = dragPayload ?? await window.desktop?.getWorkbenchPanelDrag?.({ dragID: undefined })
      if (!resolvedPayload || resolvedPayload.sourceSurfaceID === latestPropsRef.current.surfaceID) return
      await movePanel({
        panelID: resolvedPayload.panelID,
        placement: target.placement,
        sourceSurfaceID: resolvedPayload.sourceSurfaceID,
        targetGroupID: target.targetGroupID,
        targetSurfaceID: latestPropsRef.current.surfaceID,
      })
      await window.desktop?.endWorkbenchPanelDrag?.({ dragID: resolvedPayload.dragID })
    })()
  }, [])

  const PanelComponent = useCallback((panelProps: IDockviewPanelProps<WorkbenchDockPanelReference>) => {
    const props = useWorkbenchShellContext()
    const groupID = panelProps.api.group.id
    const reference = panelProps.params ?? getWorkbenchDockPanelReference(panelProps.api.id)
    const pane = useWorkbenchPanelState(
      props.store,
      props.platform,
      groupID,
      panelProps.api.id,
      reference,
    )
    const workspaces = useWorkspaceStoreSelector(props.store, (state) => state.sessions.workspaces)
    const conversationStore = props.store.getState().agentStream.conversationStore
    if (!pane) {
      return (
        <div
          className="workbench-pane dockview-workbench-missing-panel"
          data-dockview-group-id={groupID}
          data-dockview-panel-id={panelProps.api.id}
        />
      )
    }

    return (
      <WorkbenchPaneSurface
        assistantTraceVisibility={props.assistantTraceVisibility}
        composerCommandStatusByTabKey={props.composerCommandStatusByTabKey}
        composerRefreshVersion={props.composerRefreshVersion}
        conversationStore={conversationStore}
        isResolvingPermissionRequest={props.isResolvingPermissionRequest}
        isSavingToolPermissionMode={props.isSavingToolPermissionMode}
        isTopRow={false}
        pane={pane}
        permissionRequestActionError={props.permissionRequestActionError}
        permissionRequestActionRequestID={props.permissionRequestActionRequestID}
        toolPermissionMode={props.toolPermissionMode}
        toolPermissionModeError={props.toolPermissionModeError}
        conversationWorkspaceID={props.conversationWorkspaceID ?? null}
        workspaces={workspaces}
        readThreadScrollSnapshot={props.readThreadScrollSnapshot}
        saveThreadScrollSnapshot={props.saveThreadScrollSnapshot}
        threadNavigationRequestBySession={props.threadNavigationRequestBySession}
        onCreateSessionSubmit={props.onCreateSessionSubmit}
        onCreateSessionWorkspaceChange={props.onCreateSessionWorkspaceChange}
        onOpenProjectFolder={props.onOpenProjectFolder}
        onInspectFileInSidebar={props.onInspectFileInSidebar}
        onArtifactLinkOpen={props.onArtifactLinkOpen}
        onLocalFileLinkOpen={props.onLocalFileLinkOpen}
        onOpenSideChat={props.onOpenSideChat}
        onOpenSubagentSession={props.onOpenSubagentSession}
        onBranchSelect={props.onBranchSelect}
        onClearComposerParentMessage={props.onClearComposerParentMessage}
        onForkFromMessage={props.onForkFromMessage}
        onAskUserQuestionAnswer={props.onAskUserQuestionAnswer}
        onApproveProposedPlan={props.onApproveProposedPlan}
        onPermissionRequestResponse={props.onPermissionRequestResponse}
        onToolPermissionModeChange={props.onToolPermissionModeChange}
        onPickComposerAttachments={props.onPickComposerAttachments}
        onPasteComposerImageAttachments={props.onPasteComposerImageAttachments}
        onRemoveComposerAttachment={props.onRemoveComposerAttachment}
        onCancelSend={props.onCancelSend}
        onPlanModeToggle={props.onPlanModeToggle}
        onSend={props.onSend}
        onSessionModelSelectionChange={props.onSessionModelSelectionChange}
        onSetDraft={props.onSetDraft}
        onMessageDiffRestore={props.onMessageDiffRestore}
        onMessageDiffReview={props.onMessageDiffReview}
        onMessageDiffSummaryHydrate={props.onMessageDiffSummaryHydrate}
      />
    )
  }, [])

  const TabComponent = useCallback((tabProps: IDockviewPanelHeaderProps<WorkbenchDockPanelReference>) => {
    const props = useWorkbenchShellContext()
    const [isActive, setIsActive] = useState(tabProps.api.isActive)
    useEffect(() => {
      const disposable = tabProps.api.onDidActiveChange((event) => {
        setIsActive(event.isActive)
      })

      return () => disposable.dispose()
    }, [tabProps.api])

    const reference = tabProps.params ?? getWorkbenchDockPanelReference(tabProps.api.id)
    const tabState = useWorkbenchTabHeaderState(props.store, tabProps.api.group.id, tabProps.api.id)
    const paneTab = tabState?.tab as WorkbenchPaneTab | undefined
    const isTabActive = tabState?.activeTabKey === tabProps.api.id || isActive
    const title = paneTab?.title ?? tabProps.api.title ?? "Session"
    const createTabIndex = tabState?.createSessionTabIndex ?? -1
    const switchLabel =
      reference?.kind === "session"
        ? `Switch to session ${title}`
        : createTabIndex <= 0
          ? "Switch to create session tab"
          : `Switch to create session tab ${createTabIndex + 1}`
    const closeLabel =
      reference?.kind === "session"
        ? `Close session tab ${title}`
        : createTabIndex <= 0
          ? "Close create session tab"
          : `Close create session tab ${createTabIndex + 1}`
    const tabClassName = joinClassNames(
      "dockview-workbench-tab-content",
      reference?.kind === "create-session" ? "is-create-tab" : null,
    )

    const closePanel = () => {
      if (props.isDetachedWindow) {
        props.onDockBack?.(tabProps.api.id)
        return
      }

      const paneID = tabState?.id ?? tabProps.api.group.id
      if (reference?.kind === "session") {
        props.onCloseSessionTab(reference.sessionID, paneID)
        return
      }

      if (reference?.kind === "create-session") {
        props.onCloseCreateSessionTab(reference.createSessionTabID, paneID)
      }
    }
    const selectPanel = () => {
      tabProps.api.setActive()
    }
    const preserveInactiveSessionDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || isTabActive || reference?.kind !== "session" || props.isDetachedWindow) return
      event.stopPropagation()
    }

    return (
      <div className={tabClassName} onPointerDownCapture={preserveInactiveSessionDrag}>
        <button
          className="dockview-workbench-tab-trigger"
          aria-label={switchLabel}
          aria-pressed={isTabActive}
          title={switchLabel}
          type="button"
          onClick={selectPanel}
        >
          <span className="dockview-workbench-tab-copy">
            <span className="dockview-workbench-tab-title">{title}</span>
            {paneTab?.kind === "session" && paneTab.sessionKind === "side-chat" ? <SideChatBadge compact /> : null}
          </span>
        </button>
        <button
          className="dockview-workbench-tab-close"
          aria-label={closeLabel}
          draggable={false}
          title={closeLabel}
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            closePanel()
          }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <CloseIcon />
        </button>
      </div>
    )
  }, [])

  const LeftHeaderActions = useCallback((headerProps: IDockviewHeaderActionsProps) => {
    const props = useWorkbenchShellContext()
    const pane = useWorkbenchHeaderState(props.store, headerProps.group.id, headerProps.activePanel?.id)
    const gridPaneIDs = useWorkbenchGridPaneIDs(props.store)
    const firstPaneID = gridPaneIDs[0] ?? null
    const paneID = pane?.id ?? headerProps.group.id
    if (props.isDetachedWindow) return null
    if (pane?.location === "popout") return null
    if (paneID !== firstPaneID || props.isActivityRailVisible || !props.isSidebarCollapsed) {
      return null
    }

    return (
      <div className="dockview-workbench-header-actions dockview-workbench-header-leading">
        <SidebarToggleButton
          isSidebarCollapsed={true}
          onToggleSidebar={props.onToggleLeftSidebar}
          side="left"
          variant="top-menu"
        />
      </div>
    )
  }, [])

  const RightHeaderActions = useCallback((headerProps: IDockviewHeaderActionsProps) => {
    const props = useWorkbenchShellContext()
    const pane = useWorkbenchHeaderState(props.store, headerProps.group.id, headerProps.activePanel?.id)
    const gridPaneIDs = useWorkbenchGridPaneIDs(props.store)
    const lastPaneID = gridPaneIDs[gridPaneIDs.length - 1] ?? null
    const paneID = pane?.id ?? headerProps.group.id
    if (props.isDetachedWindow) {
      return (
        <div className="dockview-workbench-header-actions dockview-workbench-header-trailing">
          <button
            className="canvas-region-top-menu-add-button dockview-workbench-dock-back-button"
            aria-label="Dock session back to main window"
            title="Dock session back to main window"
            type="button"
            onClick={() => props.onDockBack?.(headerProps.activePanel?.id)}
          >
            Dock back
          </button>
          {props.windowControls}
        </div>
      )
    }
    if (pane?.location === "popout") return null
    const isLastPane = paneID === lastPaneID

    return (
      <div className="dockview-workbench-header-actions dockview-workbench-header-trailing">
        <button
          className="canvas-region-top-menu-add-button dockview-workbench-add-tab-button"
          aria-label="Add session tab"
          title="Add session tab"
          type="button"
          onClick={() => {
            const existingCreateTab = pane?.tabs.find((tab) => tab.kind === "create-session")
            if (existingCreateTab?.kind === "create-session") {
              const panel = headerProps.panels.find(
                (item) => item.id === `create-session:${existingCreateTab.createSessionTabID}`,
              )
              panel?.api.setActive()
              return
            }
            props.onOpenCreateSessionTab(null, paneID)
          }}
        >
          <PlusIcon />
        </button>
        {isLastPane ? (
          <>
            <SidebarToggleButton
              isSidebarCollapsed={props.isRightSidebarCollapsed}
              onToggleSidebar={props.onToggleRightSidebar}
              side="right"
              variant="top-menu"
            />
            {props.isRightSidebarCollapsed ? props.windowControls : null}
          </>
        ) : null}
      </div>
    )
  }, [])

  const components = useMemo(() => ({
    [WORKBENCH_DOCK_PANEL_COMPONENT]: PanelComponent,
  }), [PanelComponent])
  const tabComponents = useMemo(() => ({
    [WORKBENCH_DOCK_TAB_COMPONENT]: TabComponent,
  }), [TabComponent])

  return (
    <WorkbenchShellContext.Provider value={props}>
      <div
        ref={workbenchElementRef}
        className={joinClassNames(
          "workbench-panes",
          "dockview-workbench-panes",
          hasMultiplePanes ? "has-multiple" : null,
        )}
        onDragOverCapture={handleWorkbenchDragOver}
        onDropCapture={handleWorkbenchDrop}
      >
        <DockviewReact
          className="dockview-theme-anybox"
          components={components}
          defaultTabComponent={TabComponent}
          disableAutoResizing
          disableFloatingGroups
          disableTabsOverflowList
          getTabContextMenuItems={() => []}
          hideBorders
          leftHeaderActionsComponent={LeftHeaderActions}
          noPanelsOverlay="emptyGroup"
          rightHeaderActionsComponent={RightHeaderActions}
          scrollbars="native"
          singleTabMode="default"
          tabComponents={tabComponents}
          tabGroupAccent="off"
          theme={ANYBOX_DOCKVIEW_THEME}
          onReady={handleReady}
        />
      </div>
    </WorkbenchShellContext.Provider>
  )
}
