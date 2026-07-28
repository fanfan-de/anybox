import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react"
import { ExpandIcon, ForkIcon, MinimizeIcon, PlusIcon, SessionRunningIcon, SessionTreeIcon } from "../icons"
import { useI18n } from "../i18n/I18nProvider"
import type { SessionMessageTree } from "../session-message-tree"
import { joinClassNames } from "../shared-ui"
import { buildBranchThreadLayout, type BranchThreadLayoutEdge } from "./branch-thread-layout"

const MIN_GRAPH_ZOOM = 0.45
const MAX_GRAPH_ZOOM = 1.6
const GRAPH_VIEWPORT_PADDING = 40

interface BranchThreadPan {
  x: number
  y: number
}

interface BranchThreadPanGesture {
  pointerID: number
  startClientX: number
  startClientY: number
  startPanX: number
  startPanY: number
}

export interface BranchThreadViewSnapshot {
  focusedMessageID: string | null
  inspectedMessageID: string | null
  pan: BranchThreadPan
  sessionID: string
  zoom: number
}

interface BranchThreadViewProps {
  initialSnapshot?: BranchThreadViewSnapshot | null
  isSessionRunning?: boolean
  messageTree: SessionMessageTree | null
  onContinueFromMessage?: (messageID: string) => void
  onInspectMessage?: (messageID: string) => void
  onSnapshotChange?: (snapshot: BranchThreadViewSnapshot) => void
}

function clampGraphZoom(value: number) {
  return Math.min(MAX_GRAPH_ZOOM, Math.max(MIN_GRAPH_ZOOM, value))
}

function countBranchPoints(messageTree: SessionMessageTree) {
  return Object.entries(messageTree.childIDsByParentID).filter(([parentID, childIDs]) => (
    Boolean(messageTree.nodesByID[parentID]) && childIDs.length > 1
  )).length
}

function buildEdgePath(edge: BranchThreadLayoutEdge) {
  const middleY = edge.fromY + (edge.toY - edge.fromY) / 2
  return `M ${edge.fromX} ${edge.fromY} C ${edge.fromX} ${middleY}, ${edge.toX} ${middleY}, ${edge.toX} ${edge.toY}`
}

function resolveInitialMessageID(
  messageTree: SessionMessageTree,
  initialSnapshot?: BranchThreadViewSnapshot | null,
) {
  if (
    initialSnapshot?.sessionID === messageTree.sessionID &&
    initialSnapshot.inspectedMessageID &&
    messageTree.nodesByID[initialSnapshot.inspectedMessageID]
  ) {
    return initialSnapshot.inspectedMessageID
  }
  if (messageTree.activeMessageID && messageTree.nodesByID[messageTree.activeMessageID]) {
    return messageTree.activeMessageID
  }
  return messageTree.rootMessageIDs[0] ?? null
}

export function BranchThreadView({
  initialSnapshot = null,
  isSessionRunning = false,
  messageTree,
  onContinueFromMessage,
  onInspectMessage,
  onSnapshotChange,
}: BranchThreadViewProps) {
  const { t } = useI18n()
  const layout = useMemo(
    () => (messageTree ? buildBranchThreadLayout(messageTree) : null),
    [messageTree],
  )
  const initialMessageID = messageTree ? resolveInitialMessageID(messageTree, initialSnapshot) : null
  const hasRestoredCamera = Boolean(
    messageTree &&
    initialSnapshot?.sessionID === messageTree.sessionID,
  )
  const [inspectedMessageID, setInspectedMessageID] = useState<string | null>(initialMessageID)
  const [focusedMessageID, setFocusedMessageID] = useState<string | null>(
    initialSnapshot?.sessionID === messageTree?.sessionID
      ? initialSnapshot?.focusedMessageID ?? initialMessageID
      : initialMessageID,
  )
  const [pan, setPan] = useState<BranchThreadPan>(
    hasRestoredCamera ? initialSnapshot!.pan : { x: GRAPH_VIEWPORT_PADDING, y: GRAPH_VIEWPORT_PADDING },
  )
  const [zoom, setZoom] = useState(
    hasRestoredCamera ? clampGraphZoom(initialSnapshot!.zoom) : 1,
  )
  const [isPanning, setIsPanning] = useState(false)
  const canvasRef = useRef<HTMLDivElement | null>(null)
  const nodeRefs = useRef(new Map<string, HTMLButtonElement>())
  const panGestureRef = useRef<BranchThreadPanGesture | null>(null)
  const fittedSessionIDRef = useRef<string | null>(hasRestoredCamera ? messageTree?.sessionID ?? null : null)
  const previousSessionIDRef = useRef<string | null>(messageTree?.sessionID ?? null)

  useEffect(() => {
    const sessionID = messageTree?.sessionID ?? null
    if (sessionID === previousSessionIDRef.current) return
    previousSessionIDRef.current = sessionID

    if (!messageTree) {
      setInspectedMessageID(null)
      setFocusedMessageID(null)
      return
    }

    const nextMessageID = resolveInitialMessageID(messageTree, initialSnapshot)
    const canRestore = initialSnapshot?.sessionID === messageTree.sessionID
    setInspectedMessageID(nextMessageID)
    setFocusedMessageID(canRestore ? initialSnapshot.focusedMessageID ?? nextMessageID : nextMessageID)
    setPan(canRestore ? initialSnapshot.pan : { x: GRAPH_VIEWPORT_PADDING, y: GRAPH_VIEWPORT_PADDING })
    setZoom(canRestore ? clampGraphZoom(initialSnapshot.zoom) : 1)
    fittedSessionIDRef.current = canRestore ? messageTree.sessionID : null
  }, [initialSnapshot, messageTree])

  useEffect(() => {
    if (!messageTree) return
    const inspectedExists = Boolean(inspectedMessageID && messageTree.nodesByID[inspectedMessageID])
    const focusedExists = Boolean(focusedMessageID && messageTree.nodesByID[focusedMessageID])
    const fallbackMessageID = resolveInitialMessageID(messageTree, initialSnapshot)
    if (!inspectedExists) setInspectedMessageID(fallbackMessageID)
    if (!focusedExists) setFocusedMessageID(fallbackMessageID)
  }, [focusedMessageID, initialSnapshot, inspectedMessageID, messageTree])

  useEffect(() => {
    if (!messageTree) return
    onSnapshotChange?.({
      focusedMessageID,
      inspectedMessageID,
      pan,
      sessionID: messageTree.sessionID,
      zoom,
    })
  }, [focusedMessageID, inspectedMessageID, messageTree, onSnapshotChange, pan, zoom])

  function fitGraph() {
    const canvas = canvasRef.current
    if (!canvas || !layout || !messageTree) return
    const availableWidth = Math.max(1, canvas.clientWidth - GRAPH_VIEWPORT_PADDING * 2)
    const availableHeight = Math.max(1, canvas.clientHeight - GRAPH_VIEWPORT_PADDING * 2)
    const nextZoom = clampGraphZoom(Math.min(1, availableWidth / layout.width, availableHeight / layout.height))
    setZoom(nextZoom)
    setPan({
      x: Math.round((canvas.clientWidth - layout.width * nextZoom) / 2),
      y: Math.round((canvas.clientHeight - layout.height * nextZoom) / 2),
    })
    fittedSessionIDRef.current = messageTree.sessionID
  }

  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !layout || !messageTree) return

    const ensureInitialFit = () => {
      if (fittedSessionIDRef.current === messageTree.sessionID) return
      if (canvas.clientWidth <= 0 || canvas.clientHeight <= 0) return
      fitGraph()
    }

    ensureInitialFit()
    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(ensureInitialFit)
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [layout, messageTree])

  function zoomAroundPoint(nextZoomValue: number, pointX: number, pointY: number) {
    const nextZoom = clampGraphZoom(nextZoomValue)
    if (nextZoom === zoom) return
    const scale = nextZoom / zoom
    setPan((current) => ({
      x: pointX - (pointX - current.x) * scale,
      y: pointY - (pointY - current.y) * scale,
    }))
    setZoom(nextZoom)
  }

  function zoomFromCanvasCenter(delta: number) {
    const canvas = canvasRef.current
    if (!canvas) return
    zoomAroundPoint(
      zoom + delta,
      canvas.clientWidth / 2,
      canvas.clientHeight / 2,
    )
  }

  function locateActiveMessage() {
    const canvas = canvasRef.current
    const activeNode = layout?.nodes.find((node) => node.id === messageTree?.activeMessageID)
    if (!canvas || !activeNode) return
    setPan({
      x: canvas.clientWidth / 2 - (activeNode.x + activeNode.width / 2) * zoom,
      y: canvas.clientHeight / 2 - (activeNode.y + activeNode.height / 2) * zoom,
    })
    setInspectedMessageID(activeNode.id)
    setFocusedMessageID(activeNode.id)
    onInspectMessage?.(activeNode.id)
    nodeRefs.current.get(activeNode.id)?.focus()
  }

  function handleCanvasPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    const target = event.target as HTMLElement | null
    if (target?.closest("[data-branch-thread-node-id]")) return
    panGestureRef.current = {
      pointerID: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startPanX: pan.x,
      startPanY: pan.y,
    }
    event.currentTarget.setPointerCapture?.(event.pointerId)
    setIsPanning(true)
  }

  function handleCanvasPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const gesture = panGestureRef.current
    if (!gesture || gesture.pointerID !== event.pointerId) return
    setPan({
      x: gesture.startPanX + event.clientX - gesture.startClientX,
      y: gesture.startPanY + event.clientY - gesture.startClientY,
    })
  }

  function finishCanvasPan(event: ReactPointerEvent<HTMLDivElement>) {
    const gesture = panGestureRef.current
    if (!gesture || gesture.pointerID !== event.pointerId) return
    panGestureRef.current = null
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    setIsPanning(false)
  }

  function handleCanvasWheel(event: ReactWheelEvent<HTMLDivElement>) {
    event.preventDefault()
    if (event.ctrlKey || event.metaKey) {
      const rect = event.currentTarget.getBoundingClientRect()
      zoomAroundPoint(
        zoom - event.deltaY * 0.0014,
        event.clientX - rect.left,
        event.clientY - rect.top,
      )
      return
    }
    setPan((current) => ({
      x: current.x - event.deltaX,
      y: current.y - event.deltaY,
    }))
  }

  function focusGraphNode(messageID: string | null | undefined) {
    if (!messageID || !messageTree?.nodesByID[messageID]) return
    setFocusedMessageID(messageID)
    nodeRefs.current.get(messageID)?.focus()
  }

  function handleNodeKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, messageID: string) {
    if (!layout || !messageTree) return
    const currentIndex = layout.nodeIDsInNavigationOrder.indexOf(messageID)
    let targetMessageID: string | null | undefined

    if (event.key === "ArrowDown") {
      targetMessageID = layout.nodeIDsInNavigationOrder[currentIndex + 1]
    } else if (event.key === "ArrowUp") {
      targetMessageID = layout.nodeIDsInNavigationOrder[currentIndex - 1]
    } else if (event.key === "ArrowLeft") {
      targetMessageID = messageTree.nodesByID[messageID]?.parentMessageID
    } else if (event.key === "ArrowRight") {
      targetMessageID = messageTree.childIDsByParentID[messageID]?.[0]
    } else if (event.key === "Home") {
      targetMessageID = layout.nodeIDsInNavigationOrder[0]
    } else if (event.key === "End") {
      targetMessageID = layout.nodeIDsInNavigationOrder.at(-1)
    } else {
      return
    }

    if (!targetMessageID) return
    event.preventDefault()
    focusGraphNode(targetMessageID)
  }

  if (!messageTree || !layout) {
    return (
      <section className="branch-thread-view is-empty" aria-label={t("branchView.mapAria")}>
        <div className="branch-thread-empty">
          <SessionTreeIcon />
          <strong>{t("branchView.emptyTitle")}</strong>
          <span>{t("branchView.emptyDescription")}</span>
        </div>
      </section>
    )
  }

  const activePathSet = new Set(messageTree.activePathMessageIDs)
  const branchPointCount = countBranchPoints(messageTree)

  return (
    <section className="branch-thread-view" aria-label={t("branchView.mapAria")}>
      <header className="branch-thread-toolbar">
        <div className="branch-thread-toolbar-copy">
          <strong>{t("branchView.mode.branch")}</strong>
          <span>
            {t("branchView.summary", {
              branches: branchPointCount,
              messages: layout.nodes.length,
            })}
          </span>
          <span className="branch-thread-continue-hint">{t("branchView.continueHint")}</span>
        </div>
        <div className="branch-thread-toolbar-actions">
          {onContinueFromMessage ? (
            <button
              type="button"
              className="top-menu-view-button branch-thread-tool-button"
              aria-label={t("branchView.continueFromSelected")}
              title={t("branchView.continueFromSelected")}
              disabled={!inspectedMessageID}
              onClick={() => {
                if (inspectedMessageID) onContinueFromMessage(inspectedMessageID)
              }}
            >
              <ForkIcon />
            </button>
          ) : null}
          <button
            type="button"
            className="top-menu-view-button branch-thread-tool-button"
            aria-label={t("branchView.locateActive")}
            title={t("branchView.locateActive")}
            onClick={locateActiveMessage}
          >
            <SessionTreeIcon />
          </button>
          <button
            type="button"
            className="top-menu-view-button branch-thread-tool-button"
            aria-label={t("branchView.fit")}
            title={t("branchView.fit")}
            onClick={fitGraph}
          >
            <ExpandIcon />
          </button>
          <button
            type="button"
            className="top-menu-view-button branch-thread-tool-button"
            aria-label={t("branchView.zoomOut")}
            title={t("branchView.zoomOut")}
            disabled={zoom <= MIN_GRAPH_ZOOM}
            onClick={() => zoomFromCanvasCenter(-0.15)}
          >
            <MinimizeIcon />
          </button>
          <span className="branch-thread-zoom-value" aria-live="polite">{Math.round(zoom * 100)}%</span>
          <button
            type="button"
            className="top-menu-view-button branch-thread-tool-button"
            aria-label={t("branchView.zoomIn")}
            title={t("branchView.zoomIn")}
            disabled={zoom >= MAX_GRAPH_ZOOM}
            onClick={() => zoomFromCanvasCenter(0.15)}
          >
            <PlusIcon />
          </button>
        </div>
      </header>

      <div className="branch-thread-workspace">
        <div
          ref={canvasRef}
          className={joinClassNames("branch-thread-canvas", isPanning && "is-panning")}
          onPointerDown={handleCanvasPointerDown}
          onPointerMove={handleCanvasPointerMove}
          onPointerUp={finishCanvasPan}
          onPointerCancel={finishCanvasPan}
          onWheel={handleCanvasWheel}
        >
          <div
            className="branch-thread-graph"
            role="tree"
            aria-label={t("branchView.mapAria")}
            style={{
              height: `${layout.height}px`,
              transform: `matrix(${zoom}, 0, 0, ${zoom}, ${pan.x}, ${pan.y})`,
              width: `${layout.width}px`,
            }}
          >
            <svg
              className="branch-thread-edges"
              width={layout.width}
              height={layout.height}
              viewBox={`0 0 ${layout.width} ${layout.height}`}
              aria-hidden="true"
            >
              {layout.edges.map((edge) => (
                <path
                  key={`${edge.fromID}-${edge.toID}`}
                  className={joinClassNames(
                    "branch-thread-edge",
                    edge.isActivePath && "is-active-path",
                  )}
                  d={buildEdgePath(edge)}
                />
              ))}
            </svg>

            {layout.nodes.map((layoutNode) => {
              const node = messageTree.nodesByID[layoutNode.id]
              const isActive = node.id === messageTree.activeMessageID
              const isActivePath = activePathSet.has(node.id)
              const isInspected = node.id === inspectedMessageID
              const roleLabel = node.role === "user"
                ? t("branchView.userMessage")
                : t("branchView.assistantResponse")

              return (
                <button
                  key={node.id}
                  ref={(element) => {
                    if (element) nodeRefs.current.set(node.id, element)
                    else nodeRefs.current.delete(node.id)
                  }}
                  type="button"
                  role="treeitem"
                  aria-current={isActive ? "true" : undefined}
                  aria-label={`${roleLabel}: ${node.preview}${isActive ? `, ${t("branchView.current")}` : ""}`}
                  aria-level={layoutNode.depth + 1}
                  aria-selected={isInspected}
                  className={joinClassNames(
                    "branch-thread-node",
                    `is-${node.role}`,
                    isActivePath && "is-active-path",
                    isActive && "is-active",
                    isInspected && "is-inspected",
                  )}
                  data-branch-thread-node-id={node.id}
                  style={{
                    height: `${layoutNode.height}px`,
                    left: `${layoutNode.x}px`,
                    top: `${layoutNode.y}px`,
                    width: `${layoutNode.width}px`,
                  }}
                  tabIndex={node.id === focusedMessageID ? 0 : -1}
                  onClick={() => {
                    setInspectedMessageID(node.id)
                    setFocusedMessageID(node.id)
                    onInspectMessage?.(node.id)
                  }}
                  onFocus={() => setFocusedMessageID(node.id)}
                  onKeyDown={(event) => handleNodeKeyDown(event, node.id)}
                >
                  <span className="branch-thread-node-heading">
                    <span className="branch-thread-node-role">
                      <span className="branch-thread-node-dot" aria-hidden="true" />
                      {roleLabel}
                    </span>
                    {isActive ? (
                      <span className="branch-thread-node-current">
                        {isSessionRunning ? <SessionRunningIcon /> : null}
                        {t("branchView.current")}
                      </span>
                    ) : null}
                  </span>
                  <span className="branch-thread-node-preview">{node.preview}</span>
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </section>
  )
}
